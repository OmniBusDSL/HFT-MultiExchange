/**
 * Exchange API Bridge
 * Communicates with the Zig backend via HTTP and WebSocket
 */

export interface OrderBook {
  count: number;
  pairs: string;
}

export interface Order {
  id: number;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  status: 'pending' | 'open' | 'filled' | 'partially_filled' | 'cancelled';
}

export interface Balance {
  user_id: number;
  asset: string;
  available: number;
  locked: number;
  total: number;
}

export interface HealthCheck {
  status: string;
  timestamp: number;
  users: number;
}

/**
 * HTTP API Client
 */
export class ExchangeAPI {
  private baseURL: string;

  constructor(baseURL: string = 'http://localhost:8000') {
    this.baseURL = baseURL;
  }

  /**
   * Get server health status
   */
  async getHealth(): Promise<HealthCheck> {
    const response = await fetch(`${this.baseURL}/health`);
    if (!response.ok) throw new Error(`Health check failed: ${response.statusText}`);
    return response.json();
  }

  /**
   * Get orderbook information
   */
  async getOrderBook(): Promise<{ success: boolean; orderbooks: OrderBook }> {
    const response = await fetch(`${this.baseURL}/orderbook`);
    if (!response.ok) throw new Error(`Failed to fetch orderbook: ${response.statusText}`);
    return response.json();
  }

  /**
   * Place a new order
   */
  async placeOrder(pair: string, side: 'buy' | 'sell', price: number, quantity: number): Promise<Order> {
    const response = await fetch(`${this.baseURL}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair, side, price, quantity })
    });
    if (!response.ok) throw new Error(`Failed to place order: ${response.statusText}`);
    const data = await response.json();
    return data.order;
  }

  /**
   * Get user balance
   */
  async getBalance(): Promise<Balance> {
    const response = await fetch(`${this.baseURL}/balance`);
    if (!response.ok) throw new Error(`Failed to fetch balance: ${response.statusText}`);
    return response.json();
  }
}

/**
 * WebSocket Bridge for Real-Time Updates
 */
export class ExchangeWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(url: string = 'ws://localhost:8001') {
    this.url = url;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[WS] Connected to exchange server');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onerror = (event) => {
          console.error('[WS] Connection error:', event);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          console.log('[WS] Connection closed');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Subscribe to updates (balance, orderbook depth, trades)
   */
  subscribe(channel: string, userId?: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot subscribe: not connected');
      return;
    }

    const message = {
      type: 'subscribe',
      channel,
      user_id: userId
    };

    this.ws.send(JSON.stringify(message));
    console.log(`[WS] Subscribed to ${channel}`);
  }

  /**
   * Unsubscribe from updates
   */
  unsubscribe(channel: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'unsubscribe',
      channel
    };

    this.ws.send(JSON.stringify(message));
    console.log(`[WS] Unsubscribed from ${channel}`);
  }

  /**
   * Listen to updates
   */
  on(callback: (data: any) => void): void {
    if (!this.ws) {
      console.warn('[WS] WebSocket not initialized');
      return;
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        callback(data);
      } catch (error) {
        console.error('[WS] Failed to parse message:', error);
      }
    };
  }

  /**
   * Send a message
   */
  send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send: not connected');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[WS] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[WS] Reconnection failed:', error);
      });
    }, delay);
  }
}
