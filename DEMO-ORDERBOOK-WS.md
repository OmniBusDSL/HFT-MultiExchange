# WebSocket Orderbook Manager - Demo Guide

## Quick Start

### 1. Start Backend
```bash
cd backend
zig build run
```

Expected output:
```
[SERVER] Zig Exchange Server starting on http://127.0.0.1:8000
[ROUTES] GET /health | POST /register | POST /login
[WS-MANAGER] Orderbook polling started

[LCX-POLL] Thread started
[KRAKEN-POLL] Thread started
[COINBASE-POLL] Thread started

[LCX-POLL] Starting fetch cycle 1...
[LCX-POLL] Fetching LCX/USDC...
[LCX-POLL] ✓ Cached LCX/USDC (bids=24 asks=221)
...
```

### 2. Start Frontend
```bash
cd frontend
npm run dev
```

Navigate to: **http://localhost:5173/orderbook-ws**

---

## Demo: ETH/USD + LCX/USDC Side-by-Side Comparison

### Frontend Page: Tab 2 (Comparison)

The comparison tab displays 3 exchanges in a fixed 3-column grid layout:

```
┌────────────────────────────────────────────────────────┐
│  Select Pair: [LCX/USDC ▼]  [Refresh ⟲]                │
├──────────────────┬──────────────────┬──────────────────┤
│    LCX/USDC      │   Kraken         │   Coinbase       │
│  (ETH/EUR)       │   (ETH/USD)      │   (ETH/USD)      │
├──────────────────┼──────────────────┼──────────────────┤
│ Best Bid: 1974.5 │ Best Bid: 1974.3 │ Best Bid: 1974.2 │
│ Best Ask: 1975.0 │ Best Ask: 1974.8 │ Best Ask: 1975.1 │
│ Spread: 0.5      │ Spread: 0.5      │ Spread: 0.9      │
│ Midpoint: 1974.8 │ Midpoint: 1974.5 │ Midpoint: 1974.7 │
│                  │                  │                  │
│ Bids (10):       │ Bids (10):       │ Bids (10):       │
│ 1974.5 @ 1.25    │ 1974.3 @ 2.50    │ 1974.2 @ 1.75    │
│ 1974.0 @ 2.00    │ 1974.0 @ 3.00    │ 1973.9 @ 2.25    │
│ ...              │ ...              │ ...              │
│                  │                  │                  │
│ Asks (10):       │ Asks (10):       │ Asks (10):       │
│ 1975.0 @ 1.50    │ 1974.8 @ 2.75    │ 1975.1 @ 1.80    │
│ 1975.5 @ 1.25    │ 1975.2 @ 2.00    │ 1975.6 @ 2.50    │
│ ...              │ ...              │ ...              │
└──────────────────┴──────────────────┴──────────────────┘
```

---

## API Testing

### Test 1: LCX/USDC (Available on LCX)
```bash
curl "http://127.0.0.1:8000/public/orderbook-ws?exchange=lcx&symbol=LCX/USDC"
```

Expected: 200 OK with real LCX/USDC data

### Test 2: ETH/EUR (Available on LCX)
```bash
curl "http://127.0.0.1:8000/public/orderbook-ws?exchange=lcx&symbol=ETH/EUR"
```

Expected: 200 OK with real ETH/EUR data

### Test 3: ETH/USD on Kraken
```bash
curl "http://127.0.0.1:8000/public/orderbook-ws?exchange=kraken&symbol=ETH/USD"
```

Expected: 200 OK with real Kraken ETH/USD data

### Test 4: ETH/USD on Coinbase
```bash
curl "http://127.0.0.1:8000/public/orderbook-ws?exchange=coinbase&symbol=ETH/USD"
```

Expected: 200 OK with real Coinbase ETH/USD data

---

## Response Format

### Success Response (200 OK)
```json
{
  "exchange": "lcx",
  "symbol": "LCX/USDC",
  "bestBid": 0.044,
  "bestAsk": 0.045,
  "spread": 0.001,
  "midpoint": 0.0445,
  "timestamp": 1709481234,
  "bidCount": 24,
  "askCount": 221,
  "bids": [
    {"price": 0.044, "amount": 100},
    {"price": 0.0439, "amount": 150},
    ...
  ],
  "asks": [
    {"price": 0.045, "amount": 200},
    {"price": 0.0451, "amount": 175},
    ...
  ]
}
```

### Error Response (400/500)
```json
{
  "error": "Failed to fetch order book"
}
```

---

## Backend Architecture

### 1. Polling Threads (OrderbookWsManager)
- **LCX Thread**: Fetches 6 pairs every 10 seconds
- **Kraken Thread**: Fetches 4 pairs every 10 seconds
- **Coinbase Thread**: Fetches 3 pairs every 10 seconds
- **Cache**: Thread-safe StringHashMap with Mutex protection

### 2. API Endpoint Handler
- Route: `GET /public/orderbook-ws?exchange=X&symbol=Y`
- Fetches fresh data via `factory.fetchOrderBook()`
- Calculates spread, midpoint, bid/ask counts
- Returns JSON response

### 3. Frontend Integration
- Tab 1: Single exchange orderbook view
- Tab 2: Multi-exchange comparison (3-column grid)
- Auto-refresh every 2 seconds per exchange
- Handles missing data gracefully

---

## Debugging

### Check Backend Logs
Monitor the console output from backend for polling status:
```
[LCX-POLL] Starting fetch cycle 1...
[LCX-POLL] Fetching LCX/USDC...
[LCX-POLL] ✓ Cached LCX/USDC (bids=24 asks=221)
```

### Test with curl
```bash
# Pretty-print JSON response
curl -s "http://127.0.0.1:8000/public/orderbook-ws?exchange=lcx&symbol=LCX/USDC" | jq .

# Check specific fields
curl -s "http://127.0.0.1:8000/public/orderbook-ws?exchange=kraken&symbol=ETH/USD" | jq '.bestBid, .bestAsk, .spread'
```

### Check Available Symbols
```bash
curl -s "http://127.0.0.1:8000/public/exchange-symbols?exchange=lcx" | jq .
```

---

## Key Features

✅ Real-time orderbook data from 3 major exchanges
✅ Automatic polling (10-second intervals)
✅ Thread-safe caching
✅ Public REST API (no authentication required)
✅ Multi-exchange comparison UI
✅ Fault tolerant (handles exchange failures gracefully)
✅ Memory efficient (proper allocator management)

---

## Pairs Available for Testing

| Exchange | Available Pairs |
|----------|-----------------|
| **LCX** | LCX/USDC, BTC/EUR, ETH/EUR, BTC/USDC, XRP/EUR, BTC/USD |
| **Kraken** | BTC/USD, ETH/USD, BTC/EUR, SOL/USD |
| **Coinbase** | BTC/USD, ETH/USD, SOL/USD |

**Recommended Demo Combinations:**
- LCX/USDC + Kraken ETH/USD + Coinbase ETH/USD
- LCX ETH/EUR + Kraken ETH/USD + Coinbase ETH/USD (same crypto, different exchanges)
- BTC/USD across all 3 exchanges (if available on all)
