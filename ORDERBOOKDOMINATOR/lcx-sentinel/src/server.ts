import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import ccxt from 'ccxt';
import 'dotenv/config';

const app = express();
const dbDiscovery = new Database('discovery.db');
const dbMonitor = new Database('monitor.db');

app.use(cors());
app.use(express.json());

// --- CCXT INSTANCE CACHE ---
const exchangeInstances = new Map<string, any>();

async function getTicker(exchangeId: string, pair: string) {
  if (exchangeId === 'coingecko' || pair === 'DIRECT') return null;
  
  try {
    if (!exchangeInstances.has(exchangeId)) {
      const ExchangeClass = (ccxt as any)[exchangeId];
      if (!ExchangeClass) return null;
      exchangeInstances.set(exchangeId, new ExchangeClass({ timeout: 5000 }));
    }
    
    const ex = exchangeInstances.get(exchangeId);
    const ticker = await ex.fetchTicker(pair);
    return { bid: ticker.bid, ask: ticker.ask };
  } catch (e) {
    return null;
  }
}

// --- DISCOVERY API ---

app.get('/api/discovery', async (req, res) => {
  const sources = dbDiscovery.prepare('SELECT * FROM external_sources ORDER BY symbol ASC').all() as any[];
  
  // Enrich with live prices from CCXT
  const enriched = await Promise.all(sources.map(async (s) => {
    const live = await getTicker(s.exchange, s.pair);
    return {
      ...s,
      live_bid: live?.bid || null,
      live_ask: live?.ask || null
    };
  }));

  res.json(enriched);
});

app.post('/api/discovery', (req, res) => {
  const { symbol, coin_id, exchange, pair, volume, direct_price } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  const upsert = dbDiscovery.prepare(`
    INSERT OR REPLACE INTO external_sources (symbol, coin_id, exchange, pair, volume, direct_price, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    upsert.run(symbol, coin_id, exchange, pair, volume || 0, direct_price || null, Date.now());
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/discovery/:symbol', (req, res) => {
  try {
    dbDiscovery.prepare('DELETE FROM external_sources WHERE symbol = ?').run(req.params.symbol);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// --- STATUS ---

const startTime = Date.now();

app.get('/api/status', (req, res) => {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const orders = dbMonitor.prepare("SELECT COUNT(*) as cnt FROM my_orders WHERE status IN ('OPEN', 'PARTIAL')").get() as any;
  res.json({
    activeOrders:  orders?.cnt ?? 0,
    trackedOrders: orders?.cnt ?? 0,
    uptime: uptimeSec,
  });
});

// --- SHIELD API ---

app.get('/api/shield/orders', (req, res) => {
  const orders = dbMonitor.prepare("SELECT * FROM my_orders WHERE status IN ('OPEN', 'PARTIAL') ORDER BY last_sync DESC").all();
  res.json(orders);
});

app.get('/api/shield/logs', (req, res) => {
  const logs = dbMonitor.prepare('SELECT * FROM frontrun_logs ORDER BY timestamp DESC LIMIT 50').all();
  res.json(logs);
});

// Aliases used by dashboard poll()
app.get('/api/orders', (req, res) => {
  const orders = dbMonitor.prepare("SELECT * FROM my_orders WHERE status IN ('OPEN', 'PARTIAL') ORDER BY last_sync DESC").all();
  res.json(orders);
});

app.get('/api/queue', (_req, res) => {
  res.json([]);
});

app.get('/api/alerts', (req, res) => {
  const logs = dbMonitor.prepare('SELECT * FROM frontrun_logs ORDER BY timestamp DESC LIMIT 50').all();
  res.json(logs);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`[Discovery API] Running at http://localhost:${PORT}`);
});
