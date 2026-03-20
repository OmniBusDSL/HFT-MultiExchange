# 🏗️ System Architecture & Data Flow

## Overview Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
│  http://localhost:5173                                          │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │  LoginPage     │  │ OrderbookWsPage│  │OrderbookAggPage│   │
│  │  RegisterPage  │  │  BalancePage   │  │  TradePage     │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
│           │                  │                    │             │
│           └──────────────────┼────────────────────┘             │
│                              │                                   │
│                    AuthContext + HTTP Fetch                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ HTTP Requests with JWT Token
                               │
                    ┌──────────▼──────────┐
                    │  VITE Dev Proxy    │
                    │  Strips /api prefix │
                    └──────────┬──────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                   BACKEND (Zig Server)                          │
│             http://127.0.0.1:8000                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Route Dispatcher (main.zig)                │   │
│  │  Parses HTTP method + path → calls handler function     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                  │                       │
│       ┌──────────────┼──────────────────┼──────────────────┐   │
│       │              │                  │                  │   │
│  ┌────▼───┐  ┌──────▼──────┐  ┌────────▼────┐  ┌─────────▼──┐│
│  │  Auth  │  │ Public API  │  │   Trading  │  │ Database  ││
│  │ Module │  │  Module     │  │   Module   │  │  Module   ││
│  │        │  │             │  │            │  │           ││
│  │ /login │  │ /public/*   │  │ /apikeys/* │  │ SQLite    ││
│  │/register│ │ Aggregation │  │ /orders    │  │ WAL mode  ││
│  │        │  │             │  │ /balance   │  │           ││
│  └────────┘  └─────────────┘  └────────────┘  └───────────┘│
│       │              │                                       │
│  JWT tokens    No auth needed              Encrypted        │
│  PBKDF2 hash   Public routes              API keys          │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
    │                  │                  │
┌───▼────┐        ┌───▼────┐        ┌───▼────┐
│  LCX   │        │ Kraken │        │Coinbase│
│        │        │        │        │        │
│REST API│        │REST API│        │REST API│
│WebSocket       │WebSocket       │WebSocket
│        │        │        │        │        │
└────────┘        └────────┘        └────────┘
(Real Market Data via HTTPS)
```

---

## Request Flow: Get Ticker Data

```
USER ACTION (Frontend)
    │
    ▼
Click on pair → "BTC/USD"
    │
    ▼
OrderbookWsPage.tsx calls:
fetch('http://127.0.0.1:8000/public/tickers?exchange=lcx&symbol=BTC/USD')
    │
    ▼
Vite Dev Proxy removes /api (not used here, direct URL)
    │
    ▼
Backend: handlePublicTickers()
    │
    ├─ Parse query params: exchange="lcx", symbol="BTC/USD"
    │
    ├─ Call factory.fetchTicker(allocator, "lcx", "", "", "BTC/USD", null)
    │
    ├─ factory.zig dispatches:
    │   └─ lcx.zig: makeHttpsRequest() to https://api.lcx.com/api/v2/ticker
    │
    ├─ LCX HTTP Response:
    │   ```json
    │   {
    │     "data": {
    │       "ask": "42500.50",
    │       "bid": "42499.00",
    │       "last": "42500.00",
    │       "volume": "1234.56"
    │     }
    │   }
    │   ```
    │
    ├─ Parse + Format response
    │
    ├─ Calculate spread & midpoint
    │
    ├─ Return JSON to frontend
    │
    ▼
Frontend receives:
{
  "symbol": "BTC/USD",
  "last": 42500,
  "bid": 42499,
  "ask": 42500.50,
  "spread": 1.50,
  "midpoint": 42499.75,
  "volume": 1234.56
}
    │
    ▼
Update React state → Re-render component with price data
```

---

## Request Flow: Multi-Exchange Aggregation

```
USER ACTION (Frontend)
    │
    ▼
OrderbookAggregatesPage:
  ✓ LCX (checked)
  ✗ Kraken (unchecked)
  ✓ Coinbase (checked)

  Pair: "BTC/USD"
    │
    ▼
fetchAllOrderbooks() called
    │
    ├─ For LCX:
    │  └─ fetch('/public/orderbook-ws?exchange=lcx&symbol=BTC/USD')
    │     └─ Backend: factory.fetchOrderBook()
    │        └─ HTTPS to LCX
    │           └─ Parse bids[], asks[]
    │              └─ Return { bestBid, bestAsk, spread, midpoint, bids, asks }
    │
    ├─ For Coinbase:
    │  └─ fetch('/public/orderbook-ws?exchange=coinbase&symbol=BTC/USD')
    │     └─ Backend: factory.fetchOrderBook()
    │        └─ HTTPS to Coinbase
    │           └─ Parse response
    │              └─ Return formatted orderbook
    │
    ├─ Kraken: SKIPPED (unchecked)
    │
    ▼
Frontend collects results:
{
  "lcx": { bids: [...], asks: [...], spread: 1.0, ... },
  "coinbase": { bids: [...], asks: [...], spread: 1.2, ... }
}
    │
    ▼
Render 2 cards side-by-side (LCX + Coinbase)
    │
    ▼
Auto-refresh every 3 seconds
```

---

## Database Schema (SQLite)

```
users
├─ id (INTEGER PRIMARY KEY)
├─ email (TEXT UNIQUE)
├─ password_hash (TEXT) - PBKDF2
├─ referral_code (TEXT)
├─ referred_by (TEXT) - code of who referred them
└─ created_at (INTEGER timestamp)

api_keys
├─ id (INTEGER PRIMARY KEY)
├─ user_id (INTEGER FK → users.id)
├─ exchange (TEXT) - "lcx", "kraken", "coinbase"
├─ name (TEXT) - user-friendly name
├─ api_key (TEXT ENCRYPTED)
├─ api_secret (TEXT ENCRYPTED)
├─ status (TEXT) - "active", "inactive"
└─ created_at (INTEGER timestamp)

orders
├─ id (INTEGER PRIMARY KEY)
├─ user_id (INTEGER FK → users.id)
├─ exchange (TEXT)
├─ pair (TEXT) - "BTC/USD"
├─ side (TEXT) - "buy", "sell"
├─ price (REAL)
├─ amount (REAL)
├─ status (TEXT) - "open", "filled", "cancelled"
└─ created_at (INTEGER timestamp)

price_feed (for caching)
├─ id (INTEGER PRIMARY KEY)
├─ pair (TEXT) - "BTC/USD"
├─ price_int (INTEGER) - price × 10^8 (avoids float precision)
├─ timestamp (INTEGER)
└─ exchange (TEXT OPTIONAL)
```

---

## HTTP Request Headers

### Frontend → Backend

```http
GET /public/tickers?exchange=lcx&symbol=BTC/USD HTTP/1.1
Host: 127.0.0.1:8000
Content-Type: application/json
CORS origin: http://localhost:5173
```

### For Protected Routes (with JWT)

```http
GET /apikeys/1/balance HTTP/1.1
Host: 127.0.0.1:8000
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
Content-Type: application/json
```

### Backend → Exchange APIs

```http
GET /api/v2/ticker?symbol=BTC/USD HTTP/1.1
Host: api.lcx.com
X-Access-Key: your-api-key
X-Access-Sign: HMAC-SHA256(body, secret)
X-Access-Timestamp: 1709481234
Content-Type: application/json
```

---

## Data Formats Conversion

### Symbol Formats (Important!)

Frontend sends standardized format: **BTC/USD**

Backend converts per exchange:

```
Frontend Input: "BTC/USD"
      │
      ├─ For LCX:  "BTC/USD"      (no change)
      ├─ For Kraken: "BTCUSD"     (remove "/" for REST API)
      └─ For Coinbase: "BTC-USD"  (replace "/" with "-")
            │
            └─ Exchange API returns different formats
                      │
                      ├─ LCX JSON: {"symbol": "BTC/USD", ...}
                      ├─ Kraken JSON: {"symbol": "XBTZUSD", ...}
                      └─ Coinbase JSON: {"id": "BTC-USD", ...}
                            │
                            └─ Normalize back to "BTC/USD"
                                      │
                                      └─ Frontend receives standardized format
```

---

## Token Flow (JWT)

```
1. User submits email + password
        │
        ▼
2. Backend: handleLogin()
   - Query user by email
   - Verify password hash (PBKDF2)
   - Generate JWT token
        │
        ▼
3. JWT Structure:
   {
     header: { typ: "JWT", alg: "HS256" },
     payload: { user_id: 123, email: "user@test.com", exp: 1234567890 },
     signature: HMAC-SHA256(header.payload, JWT_SECRET)
   }
        │
        ▼
4. Frontend stores token in localStorage
        │
        ▼
5. Every subsequent request:
   Header: "Authorization: Bearer <JWT_TOKEN>"
        │
        ▼
6. Backend: Verify JWT
   - Decode token
   - Check signature (must match JWT_SECRET)
   - Check expiration
   - If valid: extract user_id, allow request
   - If invalid: return 401 Unauthorized
```

---

## Deployment Architecture

```
                    ┌────────────────────┐
                    │  Load Balancer     │
                    │  (nginx/Caddy)     │
                    └────────┬───────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
      ┌─────▼──────┐   ┌─────▼──────┐   ┌───▼──────┐
      │  Backend 1 │   │  Backend 2 │   │Backend 3 │
      │  :8000     │   │  :8001     │   │  :8002   │
      └─────┬──────┘   └─────┬──────┘   └───┬──────┘
            │                │              │
            └────────────────┼──────────────┘
                             │
                    ┌────────▼──────────┐
                    │  Shared SQLite    │
                    │  Database         │
                    │  /data/db.db      │
                    │  (WAL mode for    │
                    │   concurrent R/W) │
                    └───────────────────┘
```

---

## Environment Variables

### Backend (Required in Production)

```bash
JWT_SECRET=your-secret-key-min-32-chars
PASSWORD_SALT=your-salt-min-32-chars
VAULT_SECRET=your-vault-secret-min-32-chars
DATABASE_PATH=/data/exchange.db
PORT=8000
```

### Frontend (.env.local)

```bash
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_URL=ws://127.0.0.1:8000
```

---

## Performance Characteristics

| Component | Latency | Notes |
|-----------|---------|-------|
| Frontend → Backend | <5ms | Local network |
| Backend → Exchange API | 50-200ms | HTTPS to external APIs |
| Database Query | <10ms | SQLite with WAL |
| JWT Verification | <1ms | HMAC-SHA256 |
| Public API Response | <300ms | Includes exchange call |
| Protected API Response | <300ms | Includes JWT verify + DB query |

---

**Last Updated:** 2026-03-04
