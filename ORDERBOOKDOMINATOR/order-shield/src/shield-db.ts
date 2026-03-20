/**
 * SQLite persistence for order-shield.
 * One DB file: shield.db
 *
 * Tables:
 *   orders          — snapshot of our current open/partial orders
 *   alerts          — every queue event or fill detected
 *   queue_snapshots — periodic PIQ snapshots per order (for history)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { LcxOrder, Alert, QueueSnapshot } from './types.js';

const DB_DIR  = 'data';
const DB_PATH = path.join(DB_DIR, 'shield.db');

let db: Database.Database | null = null;

// ─── Init ────────────────────────────────────────────────────────────────────

export function openDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id                  TEXT PRIMARY KEY,
      pair                TEXT NOT NULL,
      side                TEXT NOT NULL,
      type                TEXT NOT NULL,
      status              TEXT NOT NULL,
      price               REAL NOT NULL,
      amount              REAL NOT NULL,
      filled              REAL NOT NULL DEFAULT 0,
      remaining           REAL NOT NULL,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      registered_in_queue INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     TEXT    NOT NULL,
      pair         TEXT    NOT NULL,
      type         TEXT    NOT NULL,
      message      TEXT    NOT NULL,
      volume_ahead REAL,
      delta_vol    REAL,
      ts           INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_order ON alerts(order_id, ts);
    CREATE INDEX IF NOT EXISTS idx_alerts_ts    ON alerts(ts);

    CREATE TABLE IF NOT EXISTS queue_snapshots (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id           TEXT    NOT NULL,
      pair               TEXT    NOT NULL,
      side               TEXT    NOT NULL DEFAULT 'buy',
      price              REAL    NOT NULL,
      volume_ahead       REAL    NOT NULL,
      total_level        REAL    NOT NULL,
      my_remaining       REAL    NOT NULL,
      price_levels_ahead INTEGER NOT NULL DEFAULT 0,
      ts                 INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qs_order ON queue_snapshots(order_id, ts);
  `);

  // Migrate: add registered_in_queue if upgrading from old schema
  const cols = db.prepare(`PRAGMA table_info(orders)`).all() as { name: string }[];
  if (!cols.find(c => c.name === 'registered_in_queue')) {
    db.exec(`ALTER TABLE orders ADD COLUMN registered_in_queue INTEGER NOT NULL DEFAULT 0`);
  }

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export function upsertOrder(o: LcxOrder): void {
  openDb().prepare(`
    INSERT INTO orders (id, pair, side, type, status, price, amount, filled, remaining, created_at, updated_at, registered_in_queue)
    VALUES (@id, @pair, @side, @type, @status, @price, @amount, @filled, @remaining, @created_at, @updated_at, 0)
    ON CONFLICT(id) DO UPDATE SET
      status     = excluded.status,
      filled     = excluded.filled,
      remaining  = excluded.remaining,
      updated_at = excluded.updated_at
  `).run({
    id:         o.id,
    pair:       o.pair,
    side:       o.side,
    type:       o.type,
    status:     o.status,
    price:      o.price,
    amount:     o.amount,
    filled:     o.filled,
    remaining:  o.remaining,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  });
}

export function markOrderRegistered(orderId: string): void {
  openDb()
    .prepare(`UPDATE orders SET registered_in_queue = 1 WHERE id = ?`)
    .run(orderId);
}

export function getActiveOrders(): LcxOrder[] {
  const rows = openDb()
    .prepare(`SELECT * FROM orders WHERE status IN ('OPEN','PARTIAL') ORDER BY created_at`)
    .all() as any[];

  return rows.map(r => ({
    id:        r.id,
    pair:      r.pair,
    side:      r.side,
    type:      r.type,
    status:    r.status,
    price:     r.price,
    amount:    r.amount,
    filled:    r.filled,
    remaining: r.remaining,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getOrderById(orderId: string): LcxOrder | null {
  const r = openDb()
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .get(orderId) as any;
  if (!r) return null;
  return {
    id:        r.id,
    pair:      r.pair,
    side:      r.side,
    type:      r.type,
    status:    r.status,
    price:     r.price,
    amount:    r.amount,
    filled:    r.filled,
    remaining: r.remaining,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function markOrderClosed(orderId: string, status: 'CLOSED' | 'CANCEL'): void {
  openDb()
    .prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, Date.now(), orderId);
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export function saveAlert(a: Alert): void {
  openDb().prepare(`
    INSERT INTO alerts (order_id, pair, type, message, volume_ahead, delta_vol, ts)
    VALUES (@order_id, @pair, @type, @message, @volume_ahead, @delta_vol, @ts)
  `).run({
    order_id:     a.orderId,
    pair:         a.pair,
    type:         a.type,
    message:      a.message,
    volume_ahead: a.volumeAhead,
    delta_vol:    a.deltaVol,
    ts:           a.timestamp,
  });
}

export function getRecentAlerts(limitRows = 100): Alert[] {
  const rows = openDb()
    .prepare(`SELECT * FROM alerts ORDER BY ts DESC LIMIT ?`)
    .all(limitRows) as any[];

  return rows.map(r => ({
    id:          r.id,
    orderId:     r.order_id,
    pair:        r.pair,
    type:        r.type,
    message:     r.message,
    volumeAhead: r.volume_ahead,
    deltaVol:    r.delta_vol,
    timestamp:   r.ts,
  }));
}

// ─── Queue snapshots ──────────────────────────────────────────────────────────

export function saveQueueSnapshot(s: QueueSnapshot): void {
  openDb().prepare(`
    INSERT INTO queue_snapshots (order_id, pair, side, price, volume_ahead, total_level, my_remaining, price_levels_ahead, ts)
    VALUES (@order_id, @pair, @side, @price, @volume_ahead, @total_level, @my_remaining, @price_levels_ahead, @ts)
  `).run({
    order_id:           s.orderId,
    pair:               s.pair,
    side:               s.side,
    price:              s.price,
    volume_ahead:       s.volumeAhead,
    total_level:        s.totalAtLevel,
    my_remaining:       s.myRemaining,
    price_levels_ahead: s.priceLevelsAhead,
    ts:                 s.timestamp,
  });
}

export function getQueueHistory(orderId: string, limitRows = 200): QueueSnapshot[] {
  const rows = openDb()
    .prepare(`SELECT * FROM queue_snapshots WHERE order_id = ? ORDER BY ts DESC LIMIT ?`)
    .all(orderId, limitRows) as any[];

  return rows.map(r => ({
    orderId:          r.order_id,
    pair:             r.pair,
    side:             r.side ?? 'buy',
    price:            r.price,
    volumeAhead:      r.volume_ahead,
    totalAtLevel:     r.total_level,
    myRemaining:      r.my_remaining,
    priceLevelsAhead: r.price_levels_ahead ?? 0,
    timestamp:        r.ts,
  }));
}
