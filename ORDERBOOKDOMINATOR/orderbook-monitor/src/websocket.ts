import WebSocket from 'ws';
import { applySnapshot, applyDelta } from './orderbook.js';

const WS_URL = 'wss://exchange-api.lcx.com/ws';

// Rate limit: 25 req/sec per IP (REST). WS subscribe messages treated conservatively.
// 50 pairs/connection, 1 subscribe every 200ms = 5/sec per connection.
// Connections start 1s apart → max concurrent subscribe burst = 5 req/sec total.
const PAIRS_PER_CONNECTION = 50;
const SUBSCRIBE_INTERVAL_MS = 200;  // 5 subscribes/sec per connection
const CONNECTION_STAGGER_MS = 1000; // 1s between connection starts
const PING_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

interface ConnectionState {
  id: number;
  pairs: string[];
  ws: WebSocket | null;
  status: 'connecting' | 'connected' | 'disconnected';
  pingTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
}

const connections: ConnectionState[] = [];
let isShuttingDown = false;

export function getWsStatus(): { connected: number; total: number } {
  const connected = connections.filter((c) => c.status === 'connected').length;
  return { connected, total: connections.length };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function sendSubscribe(ws: WebSocket, pair: string): void {
  ws.send(JSON.stringify({ Topic: 'subscribe', Type: 'orderbook', Pair: pair }));
}

function handleMessage(raw: WebSocket.RawData): void {
  const str = raw.toString();
  if (str === 'Subscribed Successfully' || str === 'pong') return;

  let msg: Record<string, unknown>;
  try { msg = JSON.parse(str); } catch { return; }

  const type = msg.type as string;
  const topic = msg.topic as string;
  const pair = msg.pair as string;
  const data = msg.data;

  if (!type || !pair || !data) return;

  if (type === 'orderbook') {
    if (topic === 'snapshot') {
      applySnapshot(pair, data as { buy: [number, number][]; sell: [number, number][] });
    } else if (topic === 'update' || Array.isArray(data)) {
      applyDelta(pair, data as [number, number, string][]);
    }
  }
}

function startPing(conn: ConnectionState): void {
  conn.pingTimer = setInterval(() => {
    if (conn.ws?.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ Topic: 'ping' }));
    }
  }, PING_INTERVAL_MS);
}

function stopPing(conn: ConnectionState): void {
  if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
}

function connectOne(conn: ConnectionState): void {
  conn.status = 'connecting';
  conn.ws = new WebSocket(WS_URL);

  conn.ws.on('open', () => {
    conn.status = 'connected';
    conn.reconnectAttempt = 0;

    // Subscribe to this connection's pairs with rate-limited throttle
    conn.pairs.forEach((pair, i) => {
      setTimeout(() => {
        if (conn.ws?.readyState === WebSocket.OPEN) sendSubscribe(conn.ws, pair);
      }, i * SUBSCRIBE_INTERVAL_MS);
    });

    startPing(conn);
  });

  conn.ws.on('message', handleMessage);

  conn.ws.on('close', () => {
    conn.status = 'disconnected';
    stopPing(conn);
    if (!isShuttingDown) scheduleReconnect(conn);
  });

  conn.ws.on('error', (err) => {
    process.stderr.write(`[WS #${conn.id}] ${err.message}\n`);
  });
}

function scheduleReconnect(conn: ConnectionState): void {
  const delay = Math.min(1000 * 2 ** conn.reconnectAttempt, MAX_BACKOFF_MS);
  conn.reconnectAttempt++;
  setTimeout(() => connectOne(conn), delay);
}

export function startWebSocket(pairs: string[]): void {
  const chunks = chunk(pairs, PAIRS_PER_CONNECTION);

  chunks.forEach((pairChunk, i) => {
    const conn: ConnectionState = {
      id: i + 1,
      pairs: pairChunk,
      ws: null,
      status: 'disconnected',
      pingTimer: null,
      reconnectAttempt: 0,
    };
    connections.push(conn);

    // Stagger connection starts to spread initial subscribe burst
    setTimeout(() => connectOne(conn), i * CONNECTION_STAGGER_MS);
  });
}

export function shutdown(): void {
  isShuttingDown = true;
  for (const conn of connections) {
    stopPing(conn);
    conn.ws?.close();
  }
}
