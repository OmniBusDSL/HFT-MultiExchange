import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getAllOrderbooks, getBestBidAsk } from './orderbook.js';
import { getLastOracleResult } from './oracle.js';

const FLUSH_INTERVAL_MS = 30_000;
const LOGS_DIR = 'logs';
const DB_PATH = path.join(LOGS_DIR, 'orderbook.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  db = new Database(DB_PATH);

  // WAL mode: concurrent reads without blocking writes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      pair        TEXT    NOT NULL,
      ts          INTEGER NOT NULL,          -- Unix ms
      bid         REAL,
      ask         REAL,
      spread      REAL,
      oracle      REAL,
      deviation   REAL,
      imbalance   REAL,
      microprice  REAL,
      vamp        REAL,
      bids_json   TEXT,                      -- top 20 bids [{price,qty},...]
      asks_json   TEXT                       -- top 20 asks [{price,qty},...]
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_pair_ts ON snapshots(pair, ts);
  `);

  return db;
}

function flushAll(): void {
  const database = getDb();
  const ts = Date.now();

  const insert = database.prepare(`
    INSERT INTO snapshots
      (pair, ts, bid, ask, spread, oracle, deviation, imbalance, microprice, vamp, bids_json, asks_json)
    VALUES
      (@pair, @ts, @bid, @ask, @spread, @oracle, @deviation, @imbalance, @microprice, @vamp, @bids_json, @asks_json)
  `);

  const flushMany = database.transaction(() => {
    for (const [pair, book] of getAllOrderbooks()) {
      if (!book.hasSnapshot) continue;

      const { bid, ask, spread } = getBestBidAsk(pair);
      const oracle = getLastOracleResult(pair);

      insert.run({
        pair,
        ts,
        bid:        bid ?? null,
        ask:        ask ?? null,
        spread:     spread ?? null,
        oracle:     oracle?.oraclePrice ?? null,
        deviation:  oracle?.deviation ?? null,
        imbalance:  oracle?.imbalance ?? null,
        microprice: oracle?.microprice ?? null,
        vamp:       oracle?.vamp ?? null,
        bids_json:  JSON.stringify(book.buy.slice(0, 20)),
        asks_json:  JSON.stringify(book.sell.slice(0, 20)),
      });
    }
  });

  flushMany();
}

let flushTimer: NodeJS.Timeout | null = null;

export function startLogger(): void {
  getDb(); // ensure DB + table created on startup
  flushAll();
  flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
}

export function stopLogger(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  flushAll();
  db?.close();
  db = null;
}
