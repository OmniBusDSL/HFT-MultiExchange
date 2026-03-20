# WebSocket Implementation Plan - Learning from ORDERBOOKDOMINATOR

## Key Insights Found in ORDERBOOKDOMINATOR

### 1. **LCX WebSocket - Public Orderbook** (`websocket.ts`)
- **Endpoint**: `wss://exchange-api.lcx.com/ws`
- **Auth**: None required
- **Subscribe Message**: `{ Topic: 'subscribe', Type: 'orderbook', Pair: pair }`
- **Data Format**:
  - Snapshot: `{ type: 'orderbook', topic: 'snapshot', pair, data: { buy: [[price, amount], ...], sell: [...] } }`
  - Update: `{ type: 'orderbook', topic: 'update', pair, data: [[price, amount, side], ...] }`
- **Ping**: `{ Topic: 'ping' }` every 30 seconds
- **Rate Limiting**: 50 pairs/connection, 1 subscribe every 200ms (5/sec per connection)
- **Connection Strategy**: Stagger connection starts by 1s to spread initial load

### 2. **LCX WebSocket - Private Orders** (`lcx-private-ws.ts`)  ⭐ **CRITICAL**
- **Endpoint**: `wss://exchange-api.lcx.com/api/auth/ws`
- **Auth in URL**: `?x-access-key=KEY&x-access-sign=SIG&x-access-timestamp=TS`
- **Signature Format**:
  ```typescript
  message = 'GET' + '/api/auth/ws' + '{}'  // Note: EMPTY JSON OBJECT
  signature = HMAC-SHA256(message, secret).digest('base64')
  ```
- **CRITICAL BUG FIX**: Signature is NOT URL-encoded (base64 +/= sent raw as query param)
- **Subscribe**: `{ Topic: 'subscribe', Type: 'user_orders' }`
- **After Subscribe**: Get "Subscribed Successfully" → then **fetch `/api/open` via REST** to get existing orders
- **Real-time Updates**: `{ type: 'user_orders', data: { Id, Pair, Side, Status, Price, Amount, ... } }`
- **Order Status Values**:
  - CREATE: new order placed (Status: 'OPEN')
  - UPDATE: partial fill (Status: 'PARTIAL')
  - UPDATE: cancelled (Status: 'CANCEL')
  - UPDATE: fully executed (Status: 'FILLED')
- **Ping**: `{ Topic: 'ping' }` every 55 seconds
- **Reconnect**: 5 seconds exponential backoff

### 3. **REST Signature for `/api/open` and `/api/orderHistory`**
```typescript
message = 'GET' + endpoint + '{}'  // Always include {}
signature = HMAC-SHA256(message, secret).digest('base64')
headers = {
  'x-access-key': apiKey,
  'x-access-sign': signature,
  'x-access-timestamp': Date.now().toString()
}
```
- **URLs**: `/api/open?offset=1` (note: offset starts at 1, not 0!)
- **Query params NOT included in signature**

### 4. **Kraken & Coinbase** (Not detailed in ORDERBOOKDOMINATOR files found)
- Likely have similar patterns but different auth schemes
- Kraken: HMAC-SHA512 with base64-decoded secret
- Coinbase: ES256 JWT with EC private key

---

## Implementation Plan for Zig Backend

### Phase 1: WebSocket Infrastructure (Core)
**Goal**: Basic WebSocket client library for Zig

Tasks:
1. Create `src/ws/ws_client.zig` — thin WebSocket wrapper
   - Use standard Zig `std.http` for WebSocket upgrade
   - Handle connection open/close/message/error events
   - Implement ping/pong mechanism
   - Exponential backoff reconnection

2. Create `src/ws/types.zig` — shared WebSocket types
   ```zig
   WsMessage = struct {
     text: []const u8,  // raw JSON message
   };

   WsEventHandler = fn(event: WsEvent) void;

   WsEvent = union {
     opened: void,
     message: WsMessage,
     closed: u16,  // code
     error: []const u8,
   };
   ```

3. **Testing**: Create `test-ws-connect.zig` to verify basic connection

---

### Phase 2: LCX Public Orderbook WebSocket
**Goal**: Real-time order book for LCX

Tasks:
1. Create `src/ws/lcx_orderbook_ws.zig`
   - Connect to `wss://exchange-api.lcx.com/ws`
   - Implement subscribe message: `{ Topic: 'subscribe', Type: 'orderbook', Pair: pair }`
   - Parse snapshot messages
   - Parse update delta messages
   - Maintain local orderbook state (best bid/ask cache)
   - Ping every 30s

2. **OrderBook State Manager**:
   ```zig
   OrderBook = struct {
     bids: PriceLevel[],  // sorted descending
     asks: PriceLevel[],  // sorted ascending
     lastUpdate: i64,     // timestamp
   };
   ```

3. **Testing**: `test-lcx-orderbook-ws.zig`
   - Connect to LCX WS
   - Subscribe to BTC/EUR
   - Log snapshot + 10 updates
   - Verify bid/ask progression

---

### Phase 3: LCX Private Orders WebSocket  ⭐ **HIGHEST PRIORITY**
**Goal**: Real-time user order events (critical fix found!)

Tasks:
1. Create `src/ws/lcx_private_ws.zig`
   - **Fix signature generation**: `GET/api/auth/ws{}` NOT query params in signature
   - Build auth URL with raw base64 (NOT URL-encoded!)
   - Connect to `wss://exchange-api.lcx.com/api/auth/ws?x-access-key=...&x-access-sign=...&x-access-timestamp=...`
   - Subscribe to `user_orders`
   - On "Subscribed Successfully" → fetch `/api/open` via REST (get existing orders)
   - Parse real-time order events
   - Emit order snapshots + updates

2. **Order State Manager**:
   ```zig
   PrivateOrders = struct {
     openOrders: Order[],
     onOrderSnapshot: fn(order: Order) void,
     onOrderUpdate: fn(order: Order) void,
   };
   ```

3. **Testing**: `test-lcx-private-ws.zig`
   - Real LCX credentials
   - Connect and authenticate
   - Log existing orders snapshot
   - Trigger order if possible (or mock updates)

---

### Phase 4: Kraken & Coinbase WebSocket (Future)
- Kraken WS endpoint: `wss://ws.kraken.com`
- Coinbase WS endpoint: `wss://ws-feed.exchange.coinbase.com`
- Different message formats and authentication methods
- Can reuse Phase 1 infrastructure

---

### Phase 5: Frontend Integration
**Goal**: Show real-time data in UI

Tasks:
1. Expose WebSocket connection status in `/health` endpoint
2. Add WebSocket event stream to HTTP (SSE or polling fallback)
3. Update `TradePage.tsx` to use real-time order book
4. Update order status display with real-time updates

---

## Critical Fixes Found

### 🔴 **LCX Signature Bug**
**Problem**: REST `/api/open` fails with "Signature not matched"

**Root Cause**: We discovered the issue!
- Signature should be: `GET/api/open{}`
- Query string `?offset=1` should NOT be in signature
- Signature passed as base64 raw (NOT URL-encoded)

**Solution**:
1. Change REST call: sign with `GET/api/open{}`, not `GET/api/open?offset=1{}`
2. Query param goes in URL only, not in signature
3. Use raw base64 in query param (don't use `encodeURIComponent`)

### 🟡 **WebSocket Auth**
- Query params must be raw base64 (+ / = not encoded)
- Use full endpoint `/api/auth/ws` in signature (no query params)
- Format: `GET/api/auth/ws{}`

---

## Implementation Priority

1. **FIRST**: Fix REST signature for `/api/open` (quick win!)
   - Change `endpoint_path` back to just path without query
   - Remove query from signature calculation
   - Keep query in final URL

2. **SECOND**: Implement Phase 1 WebSocket infrastructure

3. **THIRD**: Implement LCX private WebSocket (fix order history!)

4. **LATER**: Kraken/Coinbase WebSocket support

---

## Testing Strategy

```bash
# Phase 1 - WebSocket basics
zig run test-ws-connect.zig

# Phase 2 - Public orderbook
zig run test-lcx-orderbook-ws.zig

# Phase 3 - Private orders (the big one!)
zig run test-lcx-private-ws.zig  # WITH REAL CREDENTIALS

# Phase 4 - Frontend
npm run frontend  # Watch real-time order book updates
```

---

## Success Criteria

✅ LCX public orderbook updates in real-time
✅ LCX private orders via WebSocket (snapshot + updates)
✅ Open orders show on frontend (no REST polling needed)
✅ Order status updates in real-time
✅ No memory leaks on long-running connections
✅ Graceful reconnection on network errors

---

## Expected Benefits

- **Low latency**: WebSocket instead of REST polling
- **Lower API rate limits**: Subscribe once instead of polling every N seconds
- **Real-time UI**: Order book and balances update instantly
- **Better UX**: No delay between user action and UI update
- **Foundation**: For automated trading/arbitrage features

