// ─── LCX Order ────────────────────────────────────────────────────────────────

export type OrderSide   = 'BUY' | 'SELL';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'CLOSED' | 'CANCEL';
export type OrderType   = 'LIMIT' | 'MARKET';

export interface LcxOrder {
  id:         string;
  pair:       string;
  price:      number;
  amount:     number;   // original size
  filled:     number;   // how much has been executed
  remaining:  number;   // amount - filled
  side:       OrderSide;
  type:       OrderType;
  status:     OrderStatus;
  createdAt:  number;   // Unix ms
  updatedAt:  number;   // Unix ms
}

// ─── Private WebSocket events ────────────────────────────────────────────────

export interface PrivateWsOrderEvent {
  type:    'user_orders';
  topic:   'snapshot' | 'update';
  method:  'create' | 'update';
  data:    LcxRawOrder | LcxRawOrder[];
}

export interface LcxRawOrder {
  Id:         string;
  Pair:       string;
  Price:      string | number;
  Amount:     string | number;
  Filled:     string | number;
  FilledPer:  string | number;
  Side:       string;
  OrderType:  string;
  Status:     string;
  CreatedAt:  number;
  UpdatedAt:  number;
}

// ─── Queue Position ───────────────────────────────────────────────────────────

export interface QueueSnapshot {
  orderId:       string;
  pair:          string;
  side:          'buy' | 'sell';
  price:         number;
  volumeAhead:   number;   // estimated qty in the queue ahead of our order
  totalAtLevel:  number;   // total qty currently at our price level
  myRemaining:   number;   // our order's remaining unfilled qty
  priceLevelsAhead: number; // how many price levels are better than ours in the LOB
  timestamp:     number;   // Unix ms
}

// ─── Frontrun Alert ───────────────────────────────────────────────────────────

export type AlertType =
  | 'QUEUE_WORSENED'      // volumeAhead increased after order placement (FIFO violation)
  | 'LARGE_CANCEL'        // big volume appeared then cancelled quickly at our level
  | 'FILL_PARTIAL'        // our order got partially filled
  | 'FILL_COMPLETE';      // our order fully executed

export interface Alert {
  id?:            number;  // SQLite rowid
  orderId:        string;
  pair:           string;
  type:           AlertType;
  message:        string;
  volumeAhead:    number | null;
  deltaVol:       number | null;  // how much volume changed at our level
  timestamp:      number;
}

// ─── LOB Level (from public WS) ───────────────────────────────────────────────

export interface LobLevel {
  price: number;
  qty:   number;
}

export interface LobDelta {
  price: number;
  qty:   number;
  side:  'buy' | 'sell';
}
