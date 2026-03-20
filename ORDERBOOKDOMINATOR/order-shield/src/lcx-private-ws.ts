/**
 * LCX Private WebSocket — authenticated order event stream
 *
 * Endpoint: wss://exchange-api.lcx.com/api/auth/ws
 * Auth:     query params — signature must NOT be URL-encoded (base64 +/= sent raw)
 *
 * IMPORTANT: LCX does NOT send a snapshot of existing orders on connect.
 * After "Subscribed Successfully", we fetch GET /api/open via REST to get
 * current open orders, then emit them as 'snapshot' events to the caller.
 * Subsequent WS messages are real-time 'update' events.
 *
 * WS message methods:
 *   method: 'create'  + Status: 'OPEN'    → new order placed
 *   method: 'update'  + Status: 'PARTIAL' → partial fill
 *   method: 'update'  + Status: 'CANCEL'  → cancelled
 *   method: 'update'  + Status: 'FILLED'  → fully executed
 */

import crypto    from 'crypto';
import WebSocket from 'ws';
import type { LcxOrder, LcxRawOrder } from './types.js';

const BASE_URL      = 'https://exchange-api.lcx.com';
const BASE_WS       = 'wss://exchange-api.lcx.com';
const ENDPOINT      = '/api/auth/ws';
const OPEN_EP       = '/api/open';
const HISTORY_EP    = '/api/orderHistory';
const PING_MS       = 55_000;
const RECONNECT     = 5_000;

export type OrderEventHandler = (order: LcxOrder, topic: 'snapshot' | 'update') => void;

// ─── Public REST helpers (used by index.ts for startup reconciliation) ────────

const FETCH_TIMEOUT_MS = 10_000;

/** Fetch with AbortController timeout. Throws on timeout or network error. */
async function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch ALL currently open/partial orders from LCX in one call.
 * Returns { ok: true, orders: Map } on success (even if 0 orders — user has none).
 * Returns { ok: false, orders: Map } on API/network failure — caller must skip reconcile.
 */
export async function fetchAllOpenOrders(
  apiKey: string,
  secret: string,
): Promise<{ ok: boolean; orders: Map<string, LcxOrder> }> {
  const orders = new Map<string, LcxOrder>();

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const headers = restHeaders(apiKey, secret, OPEN_EP);
      const res     = await fetchWithTimeout(`${BASE_URL}${OPEN_EP}?offset=1`, { headers });

      if (!res.ok) {
        process.stderr.write(`[Reconcile] /api/open ${res.status} (attempt ${attempt}/2)\n`);
      } else {
        const json = await res.json() as { data?: LcxRawOrder[] };
        for (const raw of json.data ?? []) {
          try {
            const order = parseOrder(raw);
            orders.set(order.id, order);
          } catch { /* skip malformed */ }
        }
        return { ok: true, orders };  // success — even if 0 orders (legitimately empty)
      }
    } catch (err: any) {
      process.stderr.write(`[Reconcile] fetchAllOpenOrders error (attempt ${attempt}/2): ${err.message}\n`);
    }

    if (attempt < 2) await new Promise(r => setTimeout(r, 1_500));
  }

  return { ok: false, orders }; // total failure — caller must keep current state
}

/**
 * Fetch terminal statuses for a set of disappeared order IDs from /api/orderHistory.
 * Paginates up to MAX_HISTORY_PAGES pages (100 orders/page) until all IDs are found
 * or pages are exhausted.
 * fromDateMs: oldest updatedAt among the disappeared orders — stop paging when we
 * pass that date (history is sorted newest-first).
 */
export async function fetchTerminalStatuses(
  apiKey: string,
  secret: string,
  orderIds: Set<string>,
  fromDateMs: number,
): Promise<Map<string, 'CLOSED' | 'CANCEL'>> {
  const result   = new Map<string, 'CLOSED' | 'CANCEL'>();
  const needed   = new Set(orderIds);
  const MAX_PAGES = 5;

  for (let page = 1; page <= MAX_PAGES && needed.size > 0; page++) {
    try {
      const headers = restHeaders(apiKey, secret, HISTORY_EP);
      const url     = `${BASE_URL}${HISTORY_EP}?offset=${page}`;
      const res     = await fetchWithTimeout(url, { headers });
      if (!res.ok) break;

      const json = await res.json() as { data?: LcxRawOrder[] };
      const rows  = json.data ?? [];
      if (rows.length === 0) break;

      for (const row of rows) {
        if (needed.has(row.Id)) {
          const status = mapStatus((row.Status ?? '').toUpperCase());
          result.set(row.Id, status === 'CANCEL' ? 'CANCEL' : 'CLOSED');
          needed.delete(row.Id);
        }

        // Stop paging if we've passed the oldest order we're looking for
        const rowUpdated = row.UpdatedAt > 1e10 ? row.UpdatedAt : row.UpdatedAt * 1000;
        if (rowUpdated < fromDateMs - 60_000) break; // 1min buffer
      }
    } catch (err: any) {
      process.stderr.write(`[Reconcile] fetchTerminalStatuses page ${page} error: ${err.message}\n`);
      break;
    }
  }

  return result;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

function buildWsUrl(apiKey: string, secret: string): string {
  const timestamp = Date.now().toString();
  const message   = 'GET' + ENDPOINT + JSON.stringify({});
  const sig       = crypto.createHmac('sha256', secret).update(message).digest('base64');
  // Raw base64 — NOT encodeURIComponent (+ and / must be sent as-is)
  return `${BASE_WS}${ENDPOINT}?x-access-key=${apiKey}&x-access-sign=${sig}&x-access-timestamp=${timestamp}`;
}

function restHeaders(apiKey: string, secret: string, endpoint: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const message   = 'GET' + endpoint + '{}';
  const sig       = crypto.createHmac('sha256', secret).update(message).digest('base64');
  return {
    'Content-Type':       'application/json',
    'x-access-key':       apiKey,
    'x-access-sign':      sig,
    'x-access-timestamp': timestamp,
  };
}

// ─── Raw → typed order ───────────────────────────────────────────────────────

function parseOrder(raw: LcxRawOrder): LcxOrder {
  const amount = Number(raw.Amount);
  const filled = Number(raw.Filled);
  // CreatedAt/UpdatedAt from LCX are Unix seconds — convert to ms
  const createdAt = raw.CreatedAt > 1e10 ? raw.CreatedAt : raw.CreatedAt * 1000;
  const updatedAt = raw.UpdatedAt > 1e10 ? raw.UpdatedAt : raw.UpdatedAt * 1000;
  return {
    id:        raw.Id,
    pair:      raw.Pair,
    price:     Number(raw.Price),
    amount,
    filled,
    remaining: amount - filled,
    side:      (raw.Side ?? '').toUpperCase() as LcxOrder['side'],
    type:      ((raw.OrderType as string) ?? 'LIMIT').toUpperCase() as LcxOrder['type'],
    status:    mapStatus((raw.Status ?? '').toUpperCase()),
    createdAt,
    updatedAt,
  };
}

function mapStatus(s: string): LcxOrder['status'] {
  if (s === 'FILLED' || s === 'COMPLETED') return 'CLOSED';
  if (s === 'PARTIALLY_FILLED' || s === 'PARTIAL') return 'PARTIAL';
  if (s === 'CANCELLED' || s === 'CANCEL') return 'CANCEL';
  return 'OPEN';
}

// ─── Private WS ──────────────────────────────────────────────────────────────

export class LcxPrivateWs {
  private readonly apiKey:      string;
  private readonly secret:      string;
  private readonly onOrder:     OrderEventHandler;
  private readonly onReconnect: (() => void) | null;

  private ws:          WebSocket | null = null;
  private pingTimer:   NodeJS.Timeout | null = null;
  private reconnTimer: NodeJS.Timeout | null = null;
  private stopped      = false;
  private connected    = false;
  private connectCount = 0;   // incremented on each successful connect

  constructor(
    apiKey:      string,
    secret:      string,
    onOrder:     OrderEventHandler,
    onReconnect: (() => void) | null = null,
  ) {
    this.apiKey      = apiKey;
    this.secret      = secret;
    this.onOrder     = onOrder;
    this.onReconnect = onReconnect;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean { return this.connected; }

  // ─── Connection ────────────────────────────────────────────────────────────

  private connect(): void {
    const url = buildWsUrl(this.apiKey, this.secret);
    process.stdout.write('[PrivateWS] Connecting...\n');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.connectCount++;
      process.stdout.write('[PrivateWS] Connected — subscribing to user_orders\n');
      this.send({ Topic: 'subscribe', Type: 'user_orders' });
      this.startPing();
      // Fire reconnect callback on every reconnect (not the very first connect)
      if (this.connectCount > 1 && this.onReconnect) {
        this.onReconnect();
      }
    });

    this.ws.on('message', (raw) => {
      const str = raw.toString();
      if (str === 'pong') return;

      // After subscribe, LCX sends "Subscribed Successfully" — then fetch existing orders
      if (str === 'Subscribed Successfully') {
        process.stdout.write('[PrivateWS] Subscribed — fetching existing open orders via REST\n');
        this.fetchOpenOrders();
        return;
      }

      this.handleMessage(str);
    });

    this.ws.on('close', (code) => {
      this.connected = false;
      this.clearTimers();
      process.stderr.write(`[PrivateWS] Closed (${code}) — reconnecting in ${RECONNECT / 1000}s\n`);
      if (!this.stopped) {
        this.reconnTimer = setTimeout(() => this.connect(), RECONNECT);
      }
    });

    this.ws.on('error', (err) => {
      process.stderr.write(`[PrivateWS] Error: ${err.message}\n`);
    });

    this.ws.on('unexpected-response', (_req: any, res: any) => {
      let body = '';
      res.on('data', (d: Buffer) => body += d.toString());
      res.on('end', () => {
        process.stderr.write(`[PrivateWS] HTTP ${res.statusCode}: ${body}\n`);
      });
    });
  }

  // ─── REST snapshot — existing open orders ─────────────────────────────────
  // Called once after WS subscribe confirmation.
  // LCX does NOT send existing orders over WS — must poll REST.

  private async fetchOpenOrders(): Promise<void> {
    try {
      const headers = restHeaders(this.apiKey, this.secret, OPEN_EP);
      const url     = `${BASE_URL}${OPEN_EP}?offset=1`;
      const res     = await fetchWithTimeout(url, { headers });

      if (!res.ok) {
        process.stderr.write(`[PrivateWS] REST ${res.status} fetching open orders\n`);
        return;
      }

      const json = await res.json() as { data?: LcxRawOrder[] };
      const rows = json.data ?? [];

      process.stdout.write(`[PrivateWS] Loaded ${rows.length} existing open orders from REST\n`);

      for (const raw of rows) {
        try {
          const order = parseOrder(raw);
          if (order.status === 'OPEN' || order.status === 'PARTIAL') {
            this.onOrder(order, 'snapshot');
          }
        } catch (e: any) {
          process.stderr.write(`[PrivateWS] Parse error (REST): ${e.message}\n`);
        }
      }
    } catch (err: any) {
      process.stderr.write(`[PrivateWS] Error fetching open orders: ${err.message}\n`);
    }
  }

  // ─── WS message handling ──────────────────────────────────────────────────

  private handleMessage(str: string): void {
    let msg: any;
    try { msg = JSON.parse(str); } catch { return; }

    const type = (msg.type as string | undefined)?.toLowerCase();
    if (type !== 'user_orders') return;

    const data = msg.data;
    if (!data) return;

    const orders: LcxRawOrder[] = Array.isArray(data) ? data : [data];

    for (const raw of orders) {
      try {
        this.onOrder(parseOrder(raw), 'update');
      } catch (e: any) {
        process.stderr.write(`[PrivateWS] Parse error (WS): ${e.message}\n`);
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.send({ Topic: 'ping' });
    }, PING_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer)   { clearInterval(this.pingTimer);  this.pingTimer   = null; }
    if (this.reconnTimer) { clearTimeout(this.reconnTimer); this.reconnTimer = null; }
  }
}
