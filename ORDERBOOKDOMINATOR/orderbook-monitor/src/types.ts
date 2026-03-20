export interface OrderLevel {
  price: number;
  qty: number;
}

export interface Orderbook {
  buy: OrderLevel[];
  sell: OrderLevel[];
  updatedAt: Date;
  hasSnapshot: boolean;
}

export interface TradingPair {
  symbol: string;
  base: string;
  quote: string;
  status: string;
}

export interface Ticker {
  pair: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  updatedAt: Date;
}

export interface WsMessage {
  Topic?: string;
  Type?: string;
  Pair?: string;
  Data?: any;
}

export interface AuthHeaders {
  'x-access-key': string;
  'x-access-sign': string;
  'x-access-timestamp': string;
}
