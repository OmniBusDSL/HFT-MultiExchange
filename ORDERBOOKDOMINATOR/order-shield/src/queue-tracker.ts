/**
 * Queue Position Tracker — Rigtorp PIQ Algorithm (L2 adaptation)
 *
 * Reference: https://rigtorp.se/2013/06/08/estimating-order-queue-position.html
 *
 * Core idea (FIFO exchange):
 *   When our limit order is placed at price P, all volume that existed at P
 *   before our order MUST be ahead of us (FIFO priority).
 *   Every subsequent volume decrease at P reduces our volumeAhead (orders
 *   ahead are getting filled or cancelled).
 *   If volume INCREASES at P after our order, those new arrivals go BEHIND us.
 *
 * With L2 data (aggregated qty, no individual order visibility) we use a
 * log-probabilistic model to split decreases between "consumed from front"
 * (reduces volumeAhead) and "cancelled from back" (does not reduce it).
 *
 *   prob_ahead = ln(1 + volumeAhead) / [ ln(1 + volumeAhead) + ln(1 + volumeBehind) ]
 *   volumeAhead_new = max(volumeAhead + prob_ahead × ΔQty, 0)
 *
 * Alerts:
 *   LARGE_CANCEL — a large volume spike appeared then vanished within 500ms
 *                  (potential spoofing / layering at our price level)
 */

import type { LobLevel, QueueSnapshot, Alert, AlertType } from './types.js';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** An order that appears and vanishes within this many ms is a large-cancel candidate. */
const LARGE_CANCEL_WINDOW_MS = 500;

/** Volume must be at least this multiple of the rolling average to be "large". */
const LARGE_ORDER_SIZE_RATIO = 3;

// ─── Queue Tracker (one instance per open order) ─────────────────────────────

export class QueueTracker {
  readonly orderId: string;
  readonly pair:    string;
  readonly side:    'buy' | 'sell';
  readonly price:   number;

  private myRemaining:  number;
  private volumeAhead:  number;
  private totalAtLevel: number;

  // For large-cancel detection
  private prevPeakQty:   number = 0;
  private peakTimestamp: number = 0;

  // Rolling average qty at our level (for "large" order detection)
  private qtyHistory:    number[] = [];
  private readonly HISTORY_SIZE = 20;

  constructor(
    orderId:         string,
    pair:            string,
    side:            'buy' | 'sell',
    price:           number,
    mySize:          number,
    levelQtyAtEntry: number   // total qty at our price level when order was placed
  ) {
    this.orderId      = orderId;
    this.pair         = pair;
    this.side         = side;
    this.price        = price;
    this.myRemaining  = mySize;

    // All volume at our level before our order is ahead of us (conservative/FIFO)
    this.volumeAhead  = Math.max(levelQtyAtEntry - mySize, 0);
    this.totalAtLevel = levelQtyAtEntry;

    this.prevPeakQty   = levelQtyAtEntry;
    this.peakTimestamp = Date.now();
    this.qtyHistory    = [levelQtyAtEntry];
  }

  // ─── External fill update ─────────────────────────────────────────────────
  // Called when private WS reports our order got partially or fully filled

  applyFill(filledQty: number): void {
    this.myRemaining = Math.max(this.myRemaining - filledQty, 0);
  }

  // ─── LOB level update ────────────────────────────────────────────────────
  // Called on every public orderbook delta that touches our price level.
  // Returns any alerts generated.

  update(newTotalQty: number): Alert[] {
    const alerts:  Alert[] = [];
    const now      = Date.now();
    const deltaQty = newTotalQty - this.totalAtLevel;

    // Track rolling average for large-cancel detection
    this.qtyHistory.push(newTotalQty);
    if (this.qtyHistory.length > this.HISTORY_SIZE) this.qtyHistory.shift();
    const avgQty = this.qtyHistory.reduce((a, b) => a + b, 0) / this.qtyHistory.length;

    if (deltaQty > 0) {
      // ── Volume INCREASED ──────────────────────────────────────────────────
      // New arrivals go BEHIND us (FIFO) — volumeAhead does NOT increase.
      // Track the peak for large-cancel detection.

      if (newTotalQty > this.prevPeakQty) {
        this.prevPeakQty   = newTotalQty;
        this.peakTimestamp = now;
      }

    } else if (deltaQty < 0) {
      // ── Volume DECREASED ──────────────────────────────────────────────────
      // Could be fills from front or cancellations from anywhere.
      // Use log-probability model to estimate how much was ahead of us.

      const volumeBehind = Math.max(
        this.totalAtLevel - this.myRemaining - this.volumeAhead,
        0
      );
      const logAhead  = Math.log1p(this.volumeAhead);
      const logBehind = Math.log1p(volumeBehind);
      const probAhead = logAhead / (logAhead + logBehind + 1e-12);

      this.volumeAhead = Math.max(this.volumeAhead + probAhead * deltaQty, 0);

      // ── Large-cancel detection ────────────────────────────────────────────
      // A big block appeared recently and now the level has dropped sharply.
      // This pattern (spike then fast disappear) is characteristic of spoofing.

      const levelDropFromPeak = this.prevPeakQty - newTotalQty;
      const timeSincePeak     = now - this.peakTimestamp;
      const wasLarge          = this.prevPeakQty > avgQty * LARGE_ORDER_SIZE_RATIO;

      if (wasLarge && timeSincePeak < LARGE_CANCEL_WINDOW_MS && levelDropFromPeak > 0) {
        alerts.push(this.makeAlert(
          'LARGE_CANCEL',
          `${levelDropFromPeak.toFixed(4)} qty appeared and vanished in ${timeSincePeak}ms at ${this.price} (${(this.prevPeakQty / avgQty).toFixed(1)}× avg)`,
          levelDropFromPeak
        ));
        // Reset peak after firing to avoid repeated alerts for same event
        this.prevPeakQty   = newTotalQty;
        this.peakTimestamp = now;
      }
    }

    this.totalAtLevel = newTotalQty;
    return alerts;
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  snapshot(priceLevelsAhead = 0): QueueSnapshot {
    return {
      orderId:          this.orderId,
      pair:             this.pair,
      side:             this.side,
      price:            this.price,
      volumeAhead:      this.volumeAhead,
      totalAtLevel:     this.totalAtLevel,
      myRemaining:      this.myRemaining,
      priceLevelsAhead,
      timestamp:        Date.now(),
    };
  }

  // Treat as exhausted if remaining is zero OR negligibly small (float precision artifacts)
  isExhausted(): boolean {
    return this.myRemaining < 1e-9;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private makeAlert(type: AlertType, message: string, deltaVol: number): Alert {
    return {
      orderId:     this.orderId,
      pair:        this.pair,
      type,
      message,
      volumeAhead: this.volumeAhead,
      deltaVol,
      timestamp:   Date.now(),
    };
  }
}

// ─── Multi-order registry ─────────────────────────────────────────────────────

export class QueueRegistry {
  private trackers = new Map<string, QueueTracker>();  // orderId → tracker

  register(
    orderId:       string,
    pair:          string,
    side:          'buy' | 'sell',
    price:         number,
    size:          number,
    currentLevels: LobLevel[]
  ): void {
    if (this.trackers.has(orderId)) return;

    // Find total qty at our specific price level from current LOB state
    const levelQty = currentLevels
      .filter(l => l.price === price)
      .reduce((s, l) => s + l.qty, 0);

    const tracker = new QueueTracker(orderId, pair, side, price, size, levelQty);
    this.trackers.set(orderId, tracker);
    process.stdout.write(
      `[Queue] Tracking ${orderId.slice(0, 8)}… ${side.toUpperCase()} ${size} @ ${price}` +
      ` | volumeAhead: ${tracker.snapshot().volumeAhead.toFixed(4)}\n`
    );
  }

  unregister(orderId: string): void {
    this.trackers.delete(orderId);
  }

  applyFill(orderId: string, filledQty: number): void {
    this.trackers.get(orderId)?.applyFill(filledQty);
  }

  onLobUpdate(pair: string, side: 'buy' | 'sell', price: number, newQty: number): Alert[] {
    const alerts: Alert[] = [];
    for (const tracker of this.trackers.values()) {
      if (tracker.pair === pair && tracker.side === side && tracker.price === price) {
        alerts.push(...tracker.update(newQty));
      }
    }
    return alerts;
  }

  // getLobLevels: optional callback to get current LOB levels for a pair+side
  // Used to calculate priceLevelsAhead (how many price levels are better than ours)
  snapshots(getLobLevels?: (pair: string, side: 'buy' | 'sell') => Map<number, number>): QueueSnapshot[] {
    return [...this.trackers.values()].map(t => {
      let priceLevelsAhead = 0;
      if (getLobLevels) {
        const levels = getLobLevels(t.pair, t.side);
        // BUY order: levels with price > our price are better (closer to ask, higher priority)
        // SELL order: levels with price < our price are better (closer to bid, higher priority)
        for (const [p] of levels) {
          if (t.side === 'buy'  && p > t.price) priceLevelsAhead++;
          if (t.side === 'sell' && p < t.price) priceLevelsAhead++;
        }
      }
      return t.snapshot(priceLevelsAhead);
    });
  }

  // canPurge: optional guard — if provided, only purge when it returns true for that orderId
  purgeExhausted(canPurge?: (orderId: string) => boolean): string[] {
    const removed: string[] = [];
    for (const [id, t] of this.trackers) {
      if (t.isExhausted() && (!canPurge || canPurge(id))) {
        this.trackers.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  has(orderId: string): boolean { return this.trackers.has(orderId); }
  size(): number { return this.trackers.size; }
}
