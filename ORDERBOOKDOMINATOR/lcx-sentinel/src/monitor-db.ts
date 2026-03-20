import Database from 'better-sqlite3';
import path from 'path';

const db = new Database('monitor.db');

// --- DATABASE INITIALIZATION ---
db.exec(`
  CREATE TABLE IF NOT EXISTS my_orders (
    order_id TEXT PRIMARY KEY,
    pair TEXT,
    side TEXT,
    price REAL,
    amount REAL,
    filled REAL,
    status TEXT,
    is_protected INTEGER DEFAULT 1,
    is_attacked INTEGER DEFAULT 0,
    last_sync INTEGER
  );

  CREATE TABLE IF NOT EXISTS frontrun_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    pair TEXT,
    my_price REAL,
    competitor_price REAL,
    competitor_qty REAL,
    oracle_price REAL,
    is_fallback INTEGER,
    timestamp INTEGER,
    FOREIGN KEY(order_id) REFERENCES my_orders(order_id)
  );
`);

export interface OrderRecord {
  order_id: string;
  pair: string;
  side: string;
  price: number;
  amount: number;
  filled: number;
  status: string;
  is_protected: number;
  is_attacked: number;
  last_sync: number;
}

// --- DB OPERATIONS ---

export function upsertOrder(order: any) {
  const stmt = db.prepare(`
    INSERT INTO my_orders (order_id, pair, side, price, amount, filled, status, last_sync)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      filled = excluded.filled,
      status = excluded.status,
      last_sync = excluded.last_sync
  `);
  
  stmt.run(
    order.Id, 
    order.Pair, 
    order.Side, 
    order.Price, 
    order.Amount, 
    order.Filled, 
    order.Status, 
    Date.now()
  );
}

export function markOrderAttack(orderId: string, isAttacked: boolean) {
  db.prepare('UPDATE my_orders SET is_attacked = ? WHERE order_id = ?').run(isAttacked ? 1 : 0, orderId);
}

export function logFrontrun(log: any) {
  const stmt = db.prepare(`
    INSERT INTO frontrun_logs (order_id, pair, my_price, competitor_price, competitor_qty, oracle_price, is_fallback, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.orderId,
    log.pair,
    log.myPrice,
    log.competitorPrice,
    log.competitorQty,
    log.oraclePrice,
    log.isFallback ? 1 : 0,
    Date.now()
  );
}

export function getActiveOrdersFromDb(): OrderRecord[] {
  return db.prepare("SELECT * FROM my_orders WHERE status = 'OPEN' OR status = 'PARTIAL'").all() as OrderRecord[];
}

export function cleanOldOrders() {
  // Mark orders as CLOSED if they haven't been synced in the last 5 minutes
  const fiveMinsAgo = Date.now() - (5 * 60 * 1000);
  db.prepare("UPDATE my_orders SET status = 'CLOSED' WHERE last_sync < ? AND status IN ('OPEN', 'PARTIAL')").run(fiveMinsAgo);
}
