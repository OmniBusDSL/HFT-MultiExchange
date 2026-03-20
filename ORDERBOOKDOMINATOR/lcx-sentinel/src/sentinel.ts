import WebSocket from 'ws';
import chalk from 'chalk';
import { Oracle } from './oracle.js';
import { getActiveOrdersFromDb } from './monitor-db.js';
import Database from 'better-sqlite3';

const db = new Database('monitor.db');

interface OrderLevel { price: number; qty: number; }
interface Orderbook { buy: OrderLevel[]; sell: OrderLevel[]; }

export class Sentinel {
  private ws: WebSocket | null = null;
  private orderbooks = new Map<string, Orderbook>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(private oracle?: Oracle) {}

  public start() { this.connectLcx(); }

  private connectLcx() {
    this.ws = new WebSocket('wss://exchange-api.lcx.com/ws');
    
    this.ws.on('open', () => {
      console.log(chalk.green(`[WS] Connected. Sending subscriptions...`));
      this.subscribeAll();
      this.startPing();
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      const str = raw.toString();
      if (str === 'Subscribed Successfully' || str === 'pong') return;

      try {
        const msg = JSON.parse(str);
        
        // LCX incoming messages use lowercase keys (proven in orderbook-monitor)
        const type = msg.type as string;
        const topic = msg.topic as string;
        const pair = (msg.pair as string || '').toUpperCase().replace('_', '/');
        const data = msg.data;

        if (type === 'orderbook') {
          this.handleOrderbookMessage(pair, topic, data);
        }
      } catch (e) {
        // Silent for heartbeats
      }
    });

    this.ws.on('close', () => {
      this.stopPing();
      setTimeout(() => this.connectLcx(), 3000);
    });
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Ping uses Uppercase Topic (proven in orderbook-monitor)
        this.ws.send(JSON.stringify({ Topic: 'ping' }));
      }
    }, 30000);
  }

  private stopPing() { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; } }

  private subscribeAll() {
    const orders = getActiveOrdersFromDb();
    const uniquePairs = new Set(orders.map(o => o.pair.toUpperCase().replace('_', '/')));
    
    uniquePairs.forEach(pair => {
      console.log(chalk.gray(`[WS] Subscribing to: ${pair}`));
      // Subscribe uses Uppercase keys (proven in orderbook-monitor)
      this.ws?.send(JSON.stringify({ 
        Topic: 'subscribe', 
        Type: 'orderbook', 
        Pair: pair 
      }));
    });
  }

  private handleOrderbookMessage(pair: string, topic: string, data: any) {
    if (!this.orderbooks.has(pair)) this.orderbooks.set(pair, { buy: [], sell: [] });
    const book = this.orderbooks.get(pair)!;

    if (topic === 'snapshot') {
      const toLevels = (arr: [number, number][]) => arr.map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
      book.buy = toLevels(data.buy || []).sort((a, b) => b.price - a.price);
      book.sell = toLevels(data.sell || []).sort((a, b) => a.price - b.price);
    } else if (topic === 'update' || Array.isArray(data)) {
      // Delta update
      const updates = Array.isArray(data) ? data : [];
      for (const update of updates) {
        const [price, qty, side] = update;
        const levels = side.toLowerCase() === 'buy' ? book.buy : book.sell;
        const pNum = Number(price);
        const qNum = Number(qty);
        
        const idx = levels.findIndex(l => l.price === pNum);
        if (qNum === 0) {
          if (idx !== -1) levels.splice(idx, 1);
        } else if (idx !== -1) {
          levels[idx].qty = qNum;
        } else {
          levels.push({ price: pNum, qty: qNum });
        }
      }
      book.buy.sort((a, b) => b.price - a.price);
      book.sell.sort((a, b) => a.price - b.price);
    }

    this.analyzeQueue(pair, book);
  }

  private analyzeQueue(pair: string, book: Orderbook) {
    const activeOrders = getActiveOrdersFromDb();
    const myOrders = activeOrders.filter(o => o.pair.toUpperCase().replace('_', '/') === pair);

    if (myOrders.length === 0) return;

    const bestBid = book.buy[0]?.price || 0;
    const bestAsk = book.sell[0]?.price || 0;

    const updateStmt = db.prepare(`
      UPDATE my_orders 
      SET best_bid_ask = ?, queue_position = ?, orders_in_front = ?, volume_in_front = ?, last_sync = ? 
      WHERE order_id = ?
    `);

    myOrders.forEach(order => {
      const isBuy = order.side.toUpperCase() === 'BUY';
      const levels = isBuy ? book.buy : book.sell;
      const target = isBuy ? bestBid : bestAsk;
      
      let ordersInFront = 0;
      let volumeInFront = 0;
      let position = 1;
      let found = false;

      for (const level of levels) {
        // Floating point comparison safety
        if (Math.abs(level.price - order.price) < 0.00000001) {
          found = true;
          break;
        }
        const isBetter = isBuy ? level.price > order.price : level.price < order.price;
        if (isBetter) {
          ordersInFront++;
          volumeInFront += level.qty;
          position++;
        } else { break; }
      }

      if (!found && levels.length > 0) position = 999; 
      if (target > 0) {
        updateStmt.run(target, position, ordersInFront, volumeInFront, Date.now(), order.order_id);
      }
    });
  }
}
