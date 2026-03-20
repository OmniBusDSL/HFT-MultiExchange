import fs from 'fs';
import Database from 'better-sqlite3';
import chalk from 'chalk';

const db = new Database('discovery.db');
const CACHE_FILE = './discovery_cache.json';

db.exec(`
  CREATE TABLE IF NOT EXISTS external_sources (
    symbol TEXT PRIMARY KEY,
    coin_id TEXT,
    exchange TEXT,
    pair TEXT,
    volume REAL,
    last_updated INTEGER
  )
`);

async function migrate() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.log(chalk.yellow('No discovery_cache.json found to migrate.'));
    return;
  }

  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO external_sources (symbol, exchange, pair, volume, last_updated)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((data) => {
    for (const [symbol, source] of Object.entries(data)) {
      const s = source as any;
      insert.run(symbol, s.exchange, s.pair, s.volume, Date.now());
    }
  });

  transaction(cache);
  console.log(chalk.green(`Successfully migrated ${Object.keys(cache).length} entries to discovery.db`));
}

migrate();
