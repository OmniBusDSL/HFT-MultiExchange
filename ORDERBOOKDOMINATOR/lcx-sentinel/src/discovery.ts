import axios from 'axios';
import ccxt from 'ccxt';
import Database from 'better-sqlite3';
import chalk from 'chalk';
import 'dotenv/config';

const db = new Database('discovery.db');
const CG_API_KEY = process.env.CG_API_KEY || '';
const CG_BASE_URL = 'https://api.coingecko.com/api/v3';

// Initialize Database structure
db.exec(`
  CREATE TABLE IF NOT EXISTS coin_id_map (
    symbol TEXT,
    coin_id TEXT PRIMARY KEY,
    name TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_symbol ON coin_id_map(symbol);

  CREATE TABLE IF NOT EXISTS external_sources (
    symbol TEXT PRIMARY KEY,
    coin_id TEXT,
    exchange TEXT,
    pair TEXT,
    volume REAL,
    direct_price REAL,
    last_updated INTEGER
  );
`);

export interface ExternalSource {
  exchange: string;
  pair: string;
  volume: number;
  directPrice?: number;
  coinId?: string;
}

// ─── Throttling & Rate Limit Management ─────────────────────────────────────

let lastRequestTime = 0;
const REQUEST_INTERVAL_MS = 2500; // 2.5s = 24 req/min (sub 30/min limit)

async function throttle() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < REQUEST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS - timeSinceLast));
  }
  lastRequestTime = Date.now();
}

async function cgGet(endpoint: string, params: any = {}): Promise<any> {
  const headers = CG_API_KEY ? { 'x-cg-demo-api-key': CG_API_KEY } : {};
  
  try {
    await throttle();
    return await axios.get(`${CG_BASE_URL}${endpoint}`, { headers, params });
  } catch (err: any) {
    if (err.response?.status === 429) {
      const retryAfter = parseInt(err.response.headers['retry-after']) || 30;
      console.log(chalk.bgYellow.black(`[Discovery] Rate limited! Waiting ${retryAfter}s...`));
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return cgGet(endpoint, params); // Recursive retry
    }
    throw err;
  }
}

// ─── Sync Coin List (The big ID Map) ────────────────────────────────────────

export async function syncCoinList() {
  const countRes = db.prepare('SELECT COUNT(*) as cnt FROM coin_id_map').get() as any;
  if (countRes.cnt > 0) return;

  console.log(chalk.blue('[Discovery] First run: Syncing CoinGecko ID Map...'));
  try {
    const res = await cgGet('/coins/list');
    const coins = res.data;

    const insert = db.prepare('INSERT OR REPLACE INTO coin_id_map (symbol, coin_id, name) VALUES (?, ?, ?)');
    const transaction = db.transaction((list) => {
      for (const coin of list) {
        insert.run(coin.symbol.toLowerCase(), coin.id, coin.name);
      }
    });

    transaction(coins);
    console.log(chalk.green(`[Discovery] Synced ${coins.length} coins to local DB.`));
  } catch (err: any) {
    console.error(chalk.red(`[Discovery] Failed to sync coin list: ${err.message}`));
  }
}

export async function discoverAllLcxPairs(pairs: string[]) {
  console.log(chalk.blue(`[Discovery] Checking discovery for all ${pairs.length} LCX pairs...`));
  
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const symbol = pair.includes('/') ? pair.split('/')[0] : pair.split('_')[0];
    
    // Check if we already have it in external_sources
    const exists = db.prepare('SELECT 1 FROM external_sources WHERE symbol = ?').get(symbol);
    
    if (!exists) {
      console.log(chalk.white(`[Discovery] [${i+1}/${pairs.length}] New pair detected: ${pair}`));
      await findBestExternalSource(symbol); // This will handle throttling and saving to DB
    }
  }
  
  console.log(chalk.green('[Discovery] All LCX pairs are now in the discovery database.'));
}

// ─── Discovery Engine ───────────────────────────────────────────────────────

const PREFERRED_IDS: Record<string, string> = {
  'ARC': 'arc-block',
  'DOGE': 'dogecoin',
  'SOL': 'solana',
  'ADA': 'cardano',
  'MATIC': 'matic-network'
};

export async function findBestExternalSource(symbol: string): Promise<ExternalSource | null> {
  const sym = symbol.toLowerCase();

  // 1. Check Sources Cache (24h)
  const cached = db.prepare('SELECT * FROM external_sources WHERE symbol = ?').get(symbol) as any;
  if (cached && (Date.now() - cached.last_updated < 24 * 60 * 60 * 1000)) {
    return { exchange: cached.exchange, pair: cached.pair, volume: cached.volume };
  }

  // Ensure ID map is ready
  await syncCoinList();

  // 2. Find correct Coin ID
  let coinId = PREFERRED_IDS[symbol.toUpperCase()];
  if (!coinId) {
    const matches = db.prepare('SELECT coin_id FROM coin_id_map WHERE symbol = ?').all(sym) as any[];
    if (matches.length === 0) {
      console.log(chalk.yellow(`[Discovery] Symbol ${symbol} not found in CoinGecko list.`));
      return null;
    }
    coinId = matches.sort((a, b) => a.coin_id.length - b.coin_id.length)[0].coin_id;
  }

  console.log(chalk.gray(`[Discovery] Fetching tickers for ${symbol} (ID: ${coinId})...`));

  try {
    const response = await cgGet(`/coins/${coinId}/tickers`);
    const tickers = response.data.tickers;

    if (!tickers || tickers.length === 0) return null;

    const supportedExchanges = ccxt.exchanges;
    const sources = tickers
      .filter((t: any) => 
        supportedExchanges.includes(t.market.identifier) && 
        ['USDT', 'USDC', 'EUR', 'BTC', 'ETH'].includes(t.target)
      )
      .map((t: any) => ({
        exchange: t.market.identifier,
        pair: `${t.base}/${t.target}`,
        volume: t.converted_volume.usd
      }))
      .sort((a: any, b: any) => b.volume - a.volume);

    if (sources.length > 0) {
      const best = sources[0];
      console.log(chalk.green(`[Discovery] Found: ${symbol} -> ${best.exchange} (${best.pair})`));
      
      db.prepare(`
        INSERT OR REPLACE INTO external_sources (symbol, coin_id, exchange, pair, volume, last_updated)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(symbol, coinId, best.exchange, best.pair, best.volume, Date.now());

      return { ...best, coinId };
    } else {
      // Fallback: No CCXT exchange found, get direct price from CoinGecko
      console.log(chalk.yellow(`[Discovery] No CCXT exchange for ${symbol}. Fetching direct CoinGecko price...`));
      const priceRes = await cgGet(`/simple/price`, { ids: coinId, vs_currencies: 'eur,usd' });
      const data = priceRes.data[coinId];
      const directPrice = data?.eur || data?.usd || 0;

      if (directPrice > 0) {
        console.log(chalk.cyan(`[Discovery] Using CoinGecko Price Fallback for ${symbol}: ${directPrice}`));
        db.prepare(`
          INSERT OR REPLACE INTO external_sources (symbol, coin_id, exchange, pair, volume, direct_price, last_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(symbol, coinId, 'coingecko', 'DIRECT', 0, directPrice, Date.now());
        
        return { exchange: 'coingecko', pair: 'DIRECT', volume: 0, directPrice, coinId };
      }
    }
  } catch (error: any) {
    console.error(chalk.red(`[Discovery] Error for ${symbol}: ${error.message}`));
  }

  return cached ? { exchange: cached.exchange, pair: cached.pair, volume: cached.volume } : null;
}
