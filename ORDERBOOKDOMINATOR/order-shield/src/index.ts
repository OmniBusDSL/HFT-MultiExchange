/**
 * order-shield — main orchestrator
 *
 * Startup flow:
 *   1. openDb() — load existing OPEN/PARTIAL orders from SQLite
 *   2. reconcileDbOrders() — parallel REST check of each DB order against LCX
 *      → orders filled/cancelled offline are marked CLOSED/CANCEL and dropped
 *   3. startPublicWs() — connect to public orderbook WS
 *   4. privateWs.start() → connects → "Subscribed Successfully"
 *      → fetchOpenOrders() REST → emit each as 'snapshot'
 *      → onOrderEvent(order, 'snapshot') → ensureSubscribed(pair)
 *                                        → if LOB ready: register in queue
 *                                        → if LOB not ready: add to pending
 *   5. When Public WS sends LOB snapshot for a pair:
 *      → process all pending orders for that pair → register in queue
 *
 * Runtime flow:
 *   Private WS 'update' event:
 *     status=OPEN   (create) → upsert DB, ensureSubscribed, register/pending
 *     status=PARTIAL (update) → diff fill vs DB prev, applyFill, alert FILL_PARTIAL
 *     status=CANCEL  (update) → markClosed, unregister, remove from pending
 *     status=CLOSED  (update) → markClosed, unregister, alert FILL_COMPLETE
 *
 *   Public WS delta at tracked price:
 *     → QueueTracker.update() → LARGE_CANCEL alert if spoofing detected
 *
 *   Periodic (every 5 min):
 *     → reconcileDbOrders() — catches fills/cancels missed by WS while online
 *
 *   Private WS reconnect:
 *     → reconcileDbOrders() — catches fills/cancels during disconnect window
 */

import 'dotenv/config';
import WebSocket from 'ws';
import chalk from 'chalk';
import { LcxPrivateWs, fetchAllOpenOrders, fetchTerminalStatuses } from './lcx-private-ws.js';
import { QueueRegistry } from './queue-tracker.js';
import {
  openDb, closeDb,
  upsertOrder, getActiveOrders, getOrderById, markOrderClosed, markOrderRegistered,
  saveAlert, saveQueueSnapshot, getRecentAlerts,
} from './shield-db.js';
import { startServer } from './server.js';
import type { LcxOrder, Alert, LobDelta } from './types.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const LCX_API_KEY    = process.env.LCX_API_KEY    ?? '';
const LCX_API_SECRET = process.env.LCX_API_SECRET ?? '';

if (!LCX_API_KEY || !LCX_API_SECRET) {
  console.error(chalk.red('[Shield] Missing LCX_API_KEY or LCX_API_SECRET in .env'));
  process.exit(1);
}

const PUBLIC_WS_URL        = 'wss://exchange-api.lcx.com/ws';
const SUBSCRIBE_INTERVAL_MS = 200;
const PING_INTERVAL_MS      = 30_000;
const SNAPSHOT_INTERVAL_MS  = 5_000;
// If a LOB snapshot doesn't arrive within this time after subscribing,
// treat the pair as "ready with empty LOB" so pending orders can register.
const LOB_SNAPSHOT_TIMEOUT_MS = 30_000;

// ─── State ────────────────────────────────────────────────────────────────────

const registry = new QueueRegistry();

// Pairs subscribed on public WS
const subscribedPairs = new Set<string>();

// LOB state: pair → Map<price, qty>
type LevelMap = Map<number, number>;
const lobBids = new Map<string, LevelMap>();
const lobAsks = new Map<string, LevelMap>();

// Pairs for which we have received the initial LOB snapshot
const lobSnapshotReady = new Set<string>();

// Orders waiting to be registered once the LOB snapshot arrives for their pair
const pendingOrders = new Map<string, LcxOrder[]>(); // pair → orders

// Timers that fire if LOB snapshot doesn't arrive within LOB_SNAPSHOT_TIMEOUT_MS.
// On timeout we treat the pair as "ready with empty LOB" so orders can register.
const lobTimeouts = new Map<string, NodeJS.Timeout>(); // pair → timer

function scheduleLobTimeout(pair: string): void {
  if (lobTimeouts.has(pair) || lobSnapshotReady.has(pair)) return;
  const timer = setTimeout(() => {
    lobTimeouts.delete(pair);
    if (lobSnapshotReady.has(pair)) return; // snapshot arrived in time
    process.stdout.write(
      `[Shield] LOB snapshot timeout for ${pair} — registering ${pendingOrders.get(pair)?.length ?? 0} pending order(s) with empty book\n`
    );
    lobSnapshotReady.add(pair);
    const pending = pendingOrders.get(pair) ?? [];
    for (const order of pending) registerOrder(order);
    pendingOrders.delete(pair);
  }, LOB_SNAPSHOT_TIMEOUT_MS);
  lobTimeouts.set(pair, timer);
}

// ─── LOB helpers ──────────────────────────────────────────────────────────────

function getLevels(pair: string, side: 'buy' | 'sell'): LevelMap {
  const map = side === 'buy' ? lobBids : lobAsks;
  if (!map.has(pair)) map.set(pair, new Map());
  return map.get(pair)!;
}

function levelArray(pair: string, side: 'buy' | 'sell') {
  return [...getLevels(pair, side).entries()].map(([price, qty]) => ({ price, qty }));
}

function applyDelta(pair: string, deltas: LobDelta[]): void {
  for (const { price, qty, side } of deltas) {
    const levels = getLevels(pair, side);
    if (qty === 0) {
      levels.delete(price);
    } else {
      levels.set(price, qty);
    }

    const newQty = levels.get(price) ?? 0;
    const alerts = registry.onLobUpdate(pair, side, price, newQty);
    for (const alert of alerts) handleAlert(alert);
  }
}

// ─── Register an order in the queue ──────────────────────────────────────────
// Called once we have LOB snapshot data for the order's pair.

function registerOrder(order: LcxOrder): void {
  if (registry.has(order.id)) return;
  const side   = order.side.toLowerCase() as 'buy' | 'sell';
  const levels = levelArray(order.pair, side);
  registry.register(order.id, order.pair, side, order.price, order.remaining, levels);
  markOrderRegistered(order.id);
}

// ─── Alert handler ────────────────────────────────────────────────────────────

function handleAlert(alert: Alert): void {
  saveAlert(alert);
  const color =
    alert.type === 'LARGE_CANCEL'  ? chalk.yellow :
    alert.type === 'FILL_COMPLETE' ? chalk.green  :
    chalk.cyan;
  console.log(
    color(`[${alert.type}]`) +
    chalk.gray(` ${alert.pair} order ${alert.orderId.slice(0, 8)}… `) +
    alert.message
  );
}

// ─── Order event handler (from private WS) ────────────────────────────────────

function onOrderEvent(order: LcxOrder, topic: 'snapshot' | 'update'): void {
  // Read prev BEFORE upsert so FILL_PARTIAL can diff filled amounts correctly
  const prevFilled = topic === 'update' ? (getOrderById(order.id)?.filled ?? 0) : 0;

  upsertOrder(order);

  if (order.status === 'OPEN' || order.status === 'PARTIAL') {
    ensureSubscribed(order.pair);

    if (topic === 'snapshot') {
      // Existing order loaded at startup via REST
      if (lobSnapshotReady.has(order.pair)) {
        registerOrder(order);
      } else {
        // LOB not ready yet — queue for later registration
        const list = pendingOrders.get(order.pair) ?? [];
        if (!list.find(o => o.id === order.id)) {
          list.push(order);
          pendingOrders.set(order.pair, list);
        }
        scheduleLobTimeout(order.pair);
        process.stdout.write(
          `[Shield] Order ${order.id.slice(0, 8)}… pending LOB snapshot for ${order.pair}\n`
        );
      }
    } else {
      // Real-time new order (method=create)
      if (lobSnapshotReady.has(order.pair)) {
        registerOrder(order);
      } else {
        const list = pendingOrders.get(order.pair) ?? [];
        if (!list.find(o => o.id === order.id)) {
          list.push(order);
          pendingOrders.set(order.pair, list);
        }
        scheduleLobTimeout(order.pair);
      }
      console.log(
        chalk.blue(`[ORDER] New ${order.side} ${order.amount} ${order.pair} @ ${order.price}`)
      );
    }
  }

  if (order.status === 'PARTIAL' && topic === 'update') {
    const newFill = order.filled - prevFilled;
    if (newFill > 0) {
      registry.applyFill(order.id, newFill);
      handleAlert({
        orderId:     order.id,
        pair:        order.pair,
        type:        'FILL_PARTIAL',
        message:     `Filled +${newFill.toFixed(4)} — remaining: ${order.remaining.toFixed(4)}`,
        volumeAhead: registry.snapshots().find(s => s.orderId === order.id)?.volumeAhead ?? null,
        deltaVol:    newFill,
        timestamp:   Date.now(),
      });
    }
  }

  if (order.status === 'CLOSED' && topic === 'update') {
    markOrderClosed(order.id, 'CLOSED');
    registry.unregister(order.id);
    handleAlert({
      orderId:     order.id,
      pair:        order.pair,
      type:        'FILL_COMPLETE',
      message:     `Order fully executed @ avg ${order.price}`,
      volumeAhead: 0,
      deltaVol:    order.amount,
      timestamp:   Date.now(),
    });
    console.log(chalk.green(`[ORDER] Fully filled ${order.pair} @ ${order.price}`));
  }

  if (order.status === 'CANCEL' && topic === 'update') {
    markOrderClosed(order.id, 'CANCEL');
    registry.unregister(order.id);
    // Remove from pending if it never got registered
    const list = pendingOrders.get(order.pair);
    if (list) {
      const filtered = list.filter(o => o.id !== order.id);
      filtered.length ? pendingOrders.set(order.pair, filtered) : pendingOrders.delete(order.pair);
    }
    console.log(chalk.gray(`[ORDER] Cancelled ${order.pair} @ ${order.price}`));
  }
}

// ─── Public WS ───────────────────────────────────────────────────────────────

let publicWs: WebSocket | null = null;
let publicPingTimer: NodeJS.Timeout | null = null;

function startPublicWs(): void {
  publicWs = new WebSocket(PUBLIC_WS_URL);

  publicWs.on('open', () => {
    process.stdout.write(chalk.green('[PublicWS] Connected\n'));
    startPublicPing();
    [...subscribedPairs].forEach((pair, i) => {
      setTimeout(() => sendPublicSubscribe(pair), i * SUBSCRIBE_INTERVAL_MS);
    });
  });

  publicWs.on('message', (raw) => {
    const str = raw.toString();
    if (str === 'pong' || str === 'Subscribed Successfully') return;
    try {
      const msg   = JSON.parse(str) as Record<string, unknown>;
      const type  = (msg.type  as string)?.toLowerCase();
      const topic = (msg.topic as string)?.toLowerCase();
      const pair  = msg.pair  as string;
      const data  = msg.data;

      if (type === 'orderbook' && pair) {
        if (topic === 'snapshot') {
          // Full LOB reset for this pair
          const snap = data as { buy: [number, number][]; sell: [number, number][] };
          const bMap = new Map<number, number>();
          const aMap = new Map<number, number>();
          (snap.buy  ?? []).forEach(([p, q]) => { if (q > 0) bMap.set(p, q); });
          (snap.sell ?? []).forEach(([p, q]) => { if (q > 0) aMap.set(p, q); });
          lobBids.set(pair, bMap);
          lobAsks.set(pair, aMap);

          // Mark LOB as ready for this pair
          const wasReady = lobSnapshotReady.has(pair);
          lobSnapshotReady.add(pair);

          // Register any orders that were waiting for this snapshot
          if (!wasReady) {
            // Cancel the timeout timer — snapshot arrived before deadline
            const t = lobTimeouts.get(pair);
            if (t) { clearTimeout(t); lobTimeouts.delete(pair); }

            const pending = pendingOrders.get(pair) ?? [];
            if (pending.length) {
              process.stdout.write(
                `[Shield] LOB ready for ${pair} — registering ${pending.length} pending order(s)\n`
              );
              for (const order of pending) registerOrder(order);
              pendingOrders.delete(pair);
            }
          }

        } else if (topic === 'update' && Array.isArray(data)) {
          const deltas = (data as [number, number, string][]).map(([price, qty, side]) => ({
            price,
            qty,
            side: side.toLowerCase() as 'buy' | 'sell',
          }));
          applyDelta(pair, deltas);
        }
      }
    } catch { /* ignore parse errors */ }
  });

  publicWs.on('close', () => {
    process.stdout.write(chalk.yellow('[PublicWS] Disconnected — reconnecting...\n'));
    stopPublicPing();
    // Clear snapshot ready flags so pending re-registration works correctly on reconnect
    lobSnapshotReady.clear();
    // Cancel any pending LOB timeout timers — they'll be re-scheduled after reconnect
    for (const [, t] of lobTimeouts) clearTimeout(t);
    lobTimeouts.clear();
    setTimeout(startPublicWs, 5_000);
  });

  publicWs.on('error', (err) => {
    process.stderr.write(`[PublicWS] ${err.message}\n`);
  });
}

function sendPublicSubscribe(pair: string): void {
  if (publicWs?.readyState === WebSocket.OPEN) {
    publicWs.send(JSON.stringify({ Topic: 'subscribe', Type: 'orderbook', Pair: pair }));
  }
}

function ensureSubscribed(pair: string): void {
  if (subscribedPairs.has(pair)) return;
  subscribedPairs.add(pair);
  sendPublicSubscribe(pair);
  console.log(chalk.gray(`[PublicWS] Subscribed to ${pair} orderbook`));
}

function startPublicPing(): void {
  publicPingTimer = setInterval(() => {
    if (publicWs?.readyState === WebSocket.OPEN) {
      publicWs.send(JSON.stringify({ Topic: 'ping' }));
    }
  }, PING_INTERVAL_MS);
}

function stopPublicPing(): void {
  if (publicPingTimer) { clearInterval(publicPingTimer); publicPingTimer = null; }
}

// ─── Periodic snapshot saver ──────────────────────────────────────────────────

function getSnapshotsWithLob() {
  return registry.snapshots((pair, side) => getLevels(pair, side));
}

// Track last saved state per order to avoid writing duplicate rows to queue_snapshots
const lastSnapshotState = new Map<string, { volumeAhead: number; priceLevelsAhead: number }>();

function saveSnapshots(): void {
  for (const snap of getSnapshotsWithLob()) {
    const prev = lastSnapshotState.get(snap.orderId);
    const changed = !prev
      || Math.abs(snap.volumeAhead    - prev.volumeAhead)    > 1e-9
      || snap.priceLevelsAhead !== prev.priceLevelsAhead;

    if (changed) {
      saveQueueSnapshot(snap);
      lastSnapshotState.set(snap.orderId, {
        volumeAhead:      snap.volumeAhead,
        priceLevelsAhead: snap.priceLevelsAhead,
      });
    }
  }

  // Only purge from registry if DB confirms the order is no longer active.
  // If an exhausted order is still OPEN/PARTIAL in DB, trigger immediate reconcile
  // so we can close it quickly rather than waiting for the 5-min periodic cycle.
  const exhaustedStillActive: LcxOrder[] = [];
  const purged = registry.purgeExhausted((orderId) => {
    const dbOrder = getOrderById(orderId);
    if (dbOrder === null) return true;                                // already gone from DB
    if (dbOrder.status !== 'OPEN' && dbOrder.status !== 'PARTIAL') return true; // closed
    exhaustedStillActive.push(dbOrder);
    return false; // keep in registry until reconcile confirms it's closed
  });

  if (purged.length) {
    purged.forEach(id => {
      lastSnapshotState.delete(id);
      console.log(chalk.gray(`[Queue] Purged exhausted order ${id.slice(0, 8)}…`));
    });
  }

  // Trigger immediate reconcile for exhausted orders still showing as active in DB
  if (exhaustedStillActive.length > 0) {
    process.stdout.write(
      `[Queue] ${exhaustedStillActive.length} exhausted order(s) still active in DB — reconciling now\n`
    );
    reconcileDbOrders(exhaustedStillActive).then(stillActive => {
      const activeIds = new Set(stillActive.map(o => o.id));
      for (const o of exhaustedStillActive) {
        if (!activeIds.has(o.id)) registry.unregister(o.id);
      }
    }).catch(err => {
      process.stderr.write(`[Queue] Exhausted reconcile error: ${err.message}\n`);
    });
  }
}

// ─── Reconciliation ───────────────────────────────────────────────────────────
// Strategy: ONE call to /api/open returns all currently active orders.
// Any DB order NOT in that set has reached a terminal state (filled or cancelled).
// For those, a paginated /api/orderHistory lookup (up to 5 pages) finds CLOSED vs CANCEL.
// Called at startup AND on every private WS reconnect AND every 5 minutes.

async function reconcileDbOrders(dbOrders: LcxOrder[]): Promise<LcxOrder[]> {
  if (dbOrders.length === 0) return [];

  process.stdout.write(`[Reconcile] Checking ${dbOrders.length} DB order(s) against LCX...\n`);

  // Single REST call — get all currently open orders from LCX
  const { ok, orders: liveMap } = await fetchAllOpenOrders(LCX_API_KEY, LCX_API_SECRET);

  if (!ok) {
    // API unreachable — safe fallback: keep current state, try again later
    process.stdout.write('[Reconcile] Could not reach /api/open — skipping reconciliation\n');
    return dbOrders;
  }

  // ok=true but liveMap.size===0 is valid: user has 0 active orders on LCX
  const stillActive: LcxOrder[] = [];
  const disappeared: LcxOrder[] = [];

  for (const local of dbOrders) {
    const live = liveMap.get(local.id);
    if (live) {
      upsertOrder(live);  // refresh fill amount in DB
      stillActive.push(live);
    } else {
      disappeared.push(local);
    }
  }

  // Batch history lookup for all disappeared orders — paginate until all found or exhausted
  if (disappeared.length > 0) {
    process.stdout.write(`[Reconcile] ${disappeared.length} order(s) gone from /api/open — checking history...\n`);

    // Use oldest updatedAt as fromDate so we stop paging early
    const fromDateMs  = Math.min(...disappeared.map(o => o.updatedAt));
    const disappearedIds = new Set(disappeared.map(o => o.id));
    const terminalMap = await fetchTerminalStatuses(LCX_API_KEY, LCX_API_SECRET, disappearedIds, fromDateMs);

    for (const local of disappeared) {
      const terminal = terminalMap.get(local.id) ?? 'CLOSED'; // not in history = assume filled
      if (terminal === 'CANCEL') {
        markOrderClosed(local.id, 'CANCEL');
        console.log(chalk.gray(`[Reconcile] ${local.pair} ${local.id.slice(0, 8)}… CANCELLED offline`));
      } else {
        markOrderClosed(local.id, 'CLOSED');
        console.log(chalk.gray(`[Reconcile] ${local.pair} ${local.id.slice(0, 8)}… FILLED offline`));
      }
    }
  }

  process.stdout.write(
    `[Reconcile] Done — ${stillActive.length} active, ${disappeared.length} closed offline\n`
  );
  return stillActive;
}

// ─── Status display ───────────────────────────────────────────────────────────

function printStatus(): void {
  const snaps = getSnapshotsWithLob();
  if (snaps.length === 0) return;

  console.log(chalk.bold('\n── Queue Positions ──────────────────────────────────────────'));
  for (const s of snaps) {
    const pct = s.totalAtLevel > 0
      ? (s.volumeAhead / s.totalAtLevel * 100).toFixed(1)
      : '—';
    const levelStr = s.priceLevelsAhead === 0
      ? chalk.green('BEST')
      : chalk.red(`L+${s.priceLevelsAhead}`);
    console.log(
      chalk.cyan(`  ${s.pair}`) +
      ` ${chalk.magenta(s.side.toUpperCase())}` +
      chalk.gray(` @ ${s.price}`) +
      `  [${levelStr}]` +
      `  volAhead: ` + chalk.yellow(s.volumeAhead.toFixed(4)) +
      chalk.gray(`  (${pct}%)`) +
      `  rem: ` + chalk.green(s.myRemaining.toFixed(4))
    );
  }
  console.log(chalk.bold('─────────────────────────────────────────────────────────────\n'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(chalk.bold.blue('\n╔══════════════════════════════╗'));
  console.log(chalk.bold.blue('║     ORDER SHIELD v1.0        ║'));
  console.log(chalk.bold.blue('╚══════════════════════════════╝\n'));

  openDb();

  // Reconcile DB orders against LCX — mark as closed any that filled/cancelled offline
  const rawDbOrders    = getActiveOrders();
  const activeDbOrders = rawDbOrders.length > 0
    ? await reconcileDbOrders(rawDbOrders)
    : [];

  // Pre-subscribe to pairs for orders that are still active after reconciliation
  if (activeDbOrders.length) {
    console.log(chalk.gray(`[DB] ${activeDbOrders.length} active order(s) from previous session`));
    for (const o of activeDbOrders) ensureSubscribed(o.pair);
  }

  startPublicWs();

  // On every WS reconnect: reconcile + re-register any active orders that left registry
  const onPrivateWsReconnect = (): void => {
    const current = getActiveOrders();
    if (current.length === 0) return;
    process.stdout.write(`[Reconcile] WS reconnected — re-checking ${current.length} active order(s)\n`);
    reconcileDbOrders(current).then(active => {
      const activeIds = new Set(active.map(o => o.id));
      for (const o of current) {
        if (!activeIds.has(o.id)) {
          // Closed while disconnected — remove from registry
          registry.unregister(o.id);
        }
      }
      // Re-register any still-active orders that dropped out of registry
      // (e.g. were purged due to exhaustion or never registered)
      for (const o of active) {
        if (!registry.has(o.id) && lobSnapshotReady.has(o.pair)) {
          registerOrder(o);
        }
      }
    }).catch(err => {
      process.stderr.write(`[Reconcile] WS reconnect reconcile error: ${err.message}\n`);
    });
  };

  const privateWs = new LcxPrivateWs(LCX_API_KEY, LCX_API_SECRET, onOrderEvent, onPrivateWsReconnect);
  privateWs.start();

  setInterval(saveSnapshots, SNAPSHOT_INTERVAL_MS);
  setInterval(printStatus,   10_000);

  startServer(
    () => getSnapshotsWithLob(),
    () => getActiveOrders(),
    () => getRecentAlerts(200),
    (pair, side) => getLevels(pair, side),
  );

  // Periodic reconciliation — catches any fills/cancels missed by WS while online
  setInterval(() => {
    const current = getActiveOrders();
    if (current.length === 0) return;
    reconcileDbOrders(current).then(active => {
      const activeIds = new Set(active.map(o => o.id));
      for (const o of current) {
        if (!activeIds.has(o.id)) registry.unregister(o.id);
      }
    }).catch(err => {
      process.stderr.write(`[Reconcile] Periodic error: ${err.message}\n`);
    });
  }, 5 * 60_000);

  console.log(chalk.green('[Shield] Active — waiting for orders...\n'));
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(): void {
  console.log(chalk.yellow('\n[Shield] Shutting down...'));
  stopPublicPing();
  publicWs?.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  console.error(chalk.red('[Shield] Fatal:'), err);
  process.exit(1);
});
