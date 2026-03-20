/**
 * order-shield REST API — port 3001
 *
 * GET /api/orders       — all active (OPEN/PARTIAL) orders from DB
 * GET /api/alerts       — last 200 alerts, newest first
 * GET /api/queue        — current queue snapshots (live, from registry callback)
 * GET /api/status       — uptime + counts
 */

import http from 'node:http';
import type { QueueSnapshot, LcxOrder, Alert } from './types.js';

const PORT = 3_001;

type SnapshotsFn = () => QueueSnapshot[];
type OrdersFn    = () => LcxOrder[];
type AlertsFn    = () => Alert[];
type LobFn       = (pair: string, side: 'buy' | 'sell') => Map<number, number>;

let _snapshots: SnapshotsFn = () => [];
let _orders:    OrdersFn    = () => [];
let _alerts:    AlertsFn    = () => [];
let _lob:       LobFn       = () => new Map();

const startedAt = Date.now();

export function startServer(
  getSnapshots: SnapshotsFn,
  getOrders:    OrdersFn,
  getAlerts:    AlertsFn,
  getLob:       LobFn,
): void {
  _snapshots = getSnapshots;
  _orders    = getOrders;
  _alerts    = getAlerts;
  _lob       = getLob;

  const server = http.createServer((req, res) => {
    const url = req.url?.split('?')[0] ?? '/';

    // CORS — allow dashboard on any origin
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

    let body: unknown;

    if (url === '/api/orders') {
      body = _orders();
    } else if (url === '/api/alerts') {
      body = _alerts();
    } else if (url === '/api/queue') {
      body = _snapshots();
    } else if (url === '/api/status') {
      const snaps  = _snapshots();
      const orders = _orders();
      body = {
        uptime:        Math.floor((Date.now() - startedAt) / 1000),
        activeOrders:  orders.length,
        trackedOrders: snaps.length,
        port:          PORT,
      };
    } else if (url.startsWith('/api/lob/')) {
      // GET /api/lob/BTC%2FUSDC → all bids + asks for that pair
      const pair = decodeURIComponent(url.slice('/api/lob/'.length));
      const bidsMap = _lob(pair, 'buy');
      const asksMap = _lob(pair, 'sell');

      const bids = [...bidsMap.entries()]
        .map(([price, qty]) => ({ price, qty }))
        .sort((a, b) => b.price - a.price);  // best bid first (descending)

      const asks = [...asksMap.entries()]
        .map(([price, qty]) => ({ price, qty }))
        .sort((a, b) => a.price - b.price);  // best ask first (ascending)

      body = { pair, bids, asks };
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  server.listen(PORT, () => {
    process.stdout.write(`[Server] REST API listening on http://localhost:${PORT}\n`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`[Server] Port ${PORT} already in use — skipping REST API\n`);
    } else {
      process.stderr.write(`[Server] Error: ${err.message}\n`);
    }
  });
}
