import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { getAllOrderbooks, getBestBidAsk } from './orderbook.js';
import { getLastOracleResult } from './oracle.js';
import { getWsStatus } from './websocket.js';
import { getExternalOracleStatus, getExternalPrice } from './external-oracle.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// ─── API Routes ──────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const { connected, total } = getWsStatus();
  const ext = getExternalOracleStatus();
  res.json({
    lcx: { connected, total },
    external: ext,
    uptime: process.uptime()
  });
});

app.get('/api/pairs', (req, res) => {
  const rows: any[] = [];
  const allPairs = req.query.all === '1';

  for (const [pair, book] of getAllOrderbooks()) {
    if (!allPairs && !book.hasSnapshot) continue;
    const { bid, ask, spread } = getBestBidAsk(pair);
    const oracle = getLastOracleResult(pair);

    const extP = getExternalPrice(pair);
    rows.push({
      pair,
      bid,
      ask,
      spread,
      oracle: oracle?.oraclePrice ?? null,
      dev: oracle?.deviation ?? 0,
      ext: oracle?.externalMid ?? null,
      dev2: oracle?.tier2Deviation ?? null,
      imbalance: oracle?.imbalance ?? 0.5,
      lastPrice:   extP?.lastPrice   ?? null,
      extBid:      extP?.extBid      ?? null,
      extAsk:      extP?.extAsk      ?? null,
      extExchange: extP?.extExchange ?? null,
      cgPrice:     extP?.externalMid ?? null,
      updatedAt: book.updatedAt
    });
  }
  res.json(rows);
});

app.get('/api/pair/:symbol', (req, res) => {
  const { symbol } = req.params;
  const book = getAllOrderbooks().get(symbol);
  if (!book) return res.status(404).json({ error: 'Pair not found' });

  const oracle = getLastOracleResult(symbol);
  const ext = getExternalPrice(symbol);
  res.json({
    pair: symbol,
    bids: book.buy.slice(0, 50),
    asks: book.sell.slice(0, 50),
    oracle,
    extSource: ext?.ccxtSource ?? null,
  });
});

// ─── Socket.io Update Loop ──────────────────────────────────────────────────

const UPDATE_INTERVAL_MS = 1000;

setInterval(() => {
  const rows: any[] = [];
  for (const [pair, book] of getAllOrderbooks()) {
    if (!book.hasSnapshot) continue;
    const { bid, ask, spread } = getBestBidAsk(pair);
    const oracle = getLastOracleResult(pair);
    const extP = getExternalPrice(pair);
    rows.push({
      pair,
      bid,
      ask,
      spread,
      dev: oracle?.deviation ?? 0,
      dev2: oracle?.tier2Deviation ?? null,
      imbalance: oracle?.imbalance ?? 0.5,
      lastPrice: extP?.lastPrice ?? null,
    });
  }
  io.emit('market_update', rows);
}, UPDATE_INTERVAL_MS);

// ─── Server Control ──────────────────────────────────────────────────────────

let serverInstance: any = null;

export function startServer(port = 3000): void {
  serverInstance = httpServer.listen(port, () => {
    console.log(`[Web Dashboard] Server running at http://localhost:${port}`);
  });
}

export function stopServer(): void {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}
