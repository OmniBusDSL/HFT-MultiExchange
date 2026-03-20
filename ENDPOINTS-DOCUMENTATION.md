# 📡 Backend API Endpoints Documentation

All endpoints run on `http://127.0.0.1:8000` (development) or deployed server (production).

---

## 🟢 PUBLIC ENDPOINTS (No Authentication Required)

These endpoints do NOT require a JWT token. Anyone can call them.

### Health & Status
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Server health check - returns user count |

**Response:**
```json
{
  "status": "ok",
  "users": 42
}
```

---

### Market Data (Individual Exchange)

#### 1. **GET `/public/markets`**
Get all trading pairs available on an exchange
- **Query params:** `exchange=lcx` (or `kraken`, `coinbase`)
- **Response:** Array of market objects with symbol, base, quote, limits, fees

#### 2. **GET `/public/tickers`**
Get price tickers for specific pair(s)
- **Query params:**
  - `exchange=lcx` (required)
  - `symbol=BTC/USD` (optional - if omitted, returns all)
- **Response:** Array of ticker data (last price, bid, ask, volume, high, low)

#### 3. **GET `/public/ticker`**
Get single ticker (alternative format)
- **Query params:** `exchange=lcx&symbol=BTC/USD`
- **Response:** Single ticker object

#### 4. **GET `/public/orderbook`**
Get live orderbook (bids/asks with depth)
- **Query params:**
  - `exchange=lcx`
  - `symbol=BTC/USD`
  - `depth=25` (optional - default 10)
- **Response:** Orderbook with bids[], asks[], spread, midpoint

#### 5. **GET `/public/ohlcv`**
Get candlestick data (OHLCV = Open, High, Low, Close, Volume)
- **Query params:**
  - `exchange=lcx`
  - `symbol=BTC/USD`
  - `timeframe=1h` (optional - e.g., 1m, 5m, 15m, 1h, 4h, 1d)
- **Response:** Array of [timestamp, open, high, low, close, volume]

#### 6. **GET `/public/exchange-symbols`** ⭐ MOST USED BY FRONTEND
Get list of available trading pairs for an exchange
- **Query params:** `exchange=lcx` (or `kraken`, `coinbase`)
- **Response:**
```json
{
  "symbols": ["BTC/USD", "ETH/USD", "SOL/USD", ...]
}
```

---

### Multi-Exchange Aggregation (All 3 Exchanges at Once)

#### 7. **GET `/public/aggregate/ticker`**
Get same pair across multiple exchanges with aggregated stats
- **Query params:**
  - `symbol=BTC/USD` (required)
  - `exchanges=lcx,kraken,coinbase` (optional - default all)
- **Response:** `{ meta, tier1: {lcx: {}, kraken: {}}, tier2: {avg_price, best_bid, best_ask, spread} }`

#### 8. **GET `/public/aggregate/tickers`**
Get multiple pairs across exchanges
- **Query params:**
  - `symbols=BTC/USD,ETH/USD` (required)
  - `exchanges=lcx,kraken` (optional)
- **Response:** Multiple ticker results aggregated

#### 9. **GET `/public/aggregate/orderbook`**
Get orderbook for same pair on all exchanges
- **Query params:**
  - `symbol=BTC/USD`
  - `depth=10` (optional)
  - `exchanges=lcx,kraken,coinbase` (optional)
- **Response:** Aggregated orderbook data per exchange

#### 10. **GET `/public/aggregate/markets`**
Get all markets (pairs) available on specified exchanges
- **Query params:** `exchanges=lcx,kraken`
- **Response:** Markets list per exchange

---

## 🔴 PROTECTED ENDPOINTS (Require JWT Token)

These require sending HTTP header: `Authorization: Bearer <JWT_TOKEN>`

The JWT token is obtained by logging in.

### Authentication
| Method | Endpoint | Purpose | Body |
|--------|----------|---------|------|
| POST | `/login` | Get JWT token | `{email, password}` |
| POST | `/register` | Create new account | `{email, password, referred_by?}` |

**Login Response:**
```json
{
  "success": true,
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "data": {
    "id": 123,
    "email": "user@example.com",
    "referral_code": "ABC123XYZ"
  }
}
```

---

### Referral System
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/referral/check?code=ABC123` | Check if referral code exists |
| GET | `/profile/referrals` | Get list of users you referred |
| PUT | `/profile/referral-code` | Update your referral code |

---

### API Keys Management
| Method | Endpoint | Purpose | Parameters |
|--------|----------|---------|------------|
| GET | `/apikeys` | List all stored API keys | - |
| POST | `/apikeys/add` | Add new exchange API key | `{exchange, name, api_key, api_secret}` |
| POST | `/apikeys/test` | Test if API key works | `{exchange, api_key, api_secret}` |
| DELETE | `/apikeys/{id}` | Remove API key | - |

---

### Trading Operations (Per Exchange API Key)

All these use the stored API credentials from the database.

#### Using API Key Stored in Database
Format: `/apikeys/{api_key_id}/{operation}`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/apikeys/{id}/balance` | Get account balance |
| GET | `/apikeys/{id}/orders/open` | List open orders |
| GET | `/apikeys/{id}/orders/closed` | List closed/historical orders |
| GET | `/apikeys/{id}/trades` | List executed trades |
| POST | `/apikeys/{id}/orders/create` | Place new order |
| POST | `/apikeys/{id}/orders/cancel` | Cancel existing order |

**Create Order Body:**
```json
{
  "symbol": "BTC/USD",
  "side": "buy",
  "amount": 0.5,
  "price": 42000
}
```

---

### Internal Caching (API routes, not public)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/cache-tickers` | Cache ticker prices to avoid API spam |
| GET | `/api/cached-tickers` | Get cached ticker prices |

---

## 🔗 EXTERNAL EXCHANGE INTEGRATIONS

These are the APIs we call FROM our backend to get market data. Frontend never accesses these directly.

### LCX (https://lcx.com)
- **REST API Base:** `https://api.lcx.com`
- **WebSocket:** `wss://exchange-api.lcx.com/ws`
- **Auth:** HMAC-SHA256 with timestamp
- **Implemented Operations:**
  - `GET /api/v2/markets` → Fetch markets
  - `GET /api/v2/ticker` → Fetch tickers
  - `GET /api/v2/orderbook` → Fetch orderbook
  - `GET /api/v2/trades` → Fetch trades
  - `GET /api/v2/ohlc` → Fetch candlesticks
  - WebSocket orderbook feed (public - no auth)
  - WebSocket private orders feed (authenticated)

### Kraken (https://kraken.com)
- **REST API Base:** `https://api.kraken.com`
- **WebSocket v2:** `wss://ws.kraken.com/v2` (public)
- **WebSocket Auth:** `wss://ws-auth.kraken.com/v1` (requires credentials)
- **Auth:** HMAC-SHA512 with API key + private key
- **Implemented Operations:**
  - `GET /0/public/AssetPairs` → Markets
  - `GET /0/public/Ticker` → Tickers
  - `GET /0/public/Depth` → Orderbook
  - `GET /0/public/Trades` → Trades
  - `GET /0/public/OHLC` → Candlesticks
  - WebSocket v2 book channel (public)
  - Private balance/orders via WebSocket (with auth)

### Coinbase (https://coinbase.com)
- **REST API Base:** `https://api.exchange.coinbase.com`
- **WebSocket:** `wss://ws-feed.exchange.coinbase.com` (public)
- **Auth:** None for public WebSocket; JWT for authenticated operations
- **Implemented Operations:**
  - `GET /products` → Markets
  - `GET /products/{id}/ticker` → Tickers
  - `GET /products/{id}/book` → Orderbook
  - `GET /products/{id}/trades` → Trades
  - WebSocket ticker channel (public - no auth)
  - WebSocket level2 channel (requires auth)

---

## 📊 Example API Calls

### Get LCX Markets
```bash
curl "http://127.0.0.1:8000/public/markets?exchange=lcx"
```

### Get ETH/USD Price on All Exchanges
```bash
curl "http://127.0.0.1:8000/public/aggregate/ticker?symbol=ETH/USD"
```

### Get BTC/USD Orderbook on Kraken
```bash
curl "http://127.0.0.1:8000/public/orderbook?exchange=kraken&symbol=BTC/USD&depth=10"
```

### Get Available Pairs (for pair search dropdown)
```bash
curl "http://127.0.0.1:8000/public/exchange-symbols?exchange=lcx"
```

### Register User
```bash
curl -X POST "http://127.0.0.1:8000/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"securepass123"}'
```

### Login (Get JWT Token)
```bash
curl -X POST "http://127.0.0.1:8000/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"securepass123"}'
```

### Get Balance (Protected - Requires JWT)
```bash
curl "http://127.0.0.1:8000/apikeys/1/balance" \
  -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc..."
```

---

## 🎯 Frontend Usage Summary

### Public Endpoints Used
| Page | Endpoint | Purpose |
|------|----------|---------|
| OrderbookWsPage | `/public/exchange-symbols` | Load pair dropdown |
| OrderbookWsPage | `/public/markets` | Get all pairs for exchange |
| OrderbookWsPage | `/public/tickers` | Get ticker data |
| OrderbookAggregatesPage | `/public/exchange-symbols` | Load pair search |
| OrderbookAggregatesPage | `/public/orderbook` | Get orderbook for comparison |
| OrderbookAggregatesPage | `/public/aggregate/ticker` | Get multi-exchange stats |

### Protected Endpoints Used
| Page | Endpoint | Purpose |
|------|----------|---------|
| LoginPage | `/login` | Authenticate user |
| RegisterPage | `/register` | Create new account |
| BalancePage | `/apikeys/{id}/balance` | Show account balance |
| TradePage | `/apikeys/{id}/orders/create` | Place order |
| OrderHistoryPage | `/apikeys/{id}/orders/open` | Show open orders |
| OrderHistoryPage | `/apikeys/{id}/trades` | Show trade history |

---

## ⚙️ Query Parameters Reference

| Parameter | Example | Used In | Notes |
|-----------|---------|---------|-------|
| `exchange` | `lcx`, `kraken`, `coinbase` | Most endpoints | Specifies which exchange |
| `symbol` | `BTC/USD`, `ETH/EUR` | Market data endpoints | Trading pair |
| `depth` | `5`, `10`, `25` | Orderbook endpoints | Number of price levels |
| `timeframe` | `1h`, `4h`, `1d` | OHLCV endpoint | Candlestick period |
| `exchanges` | `lcx,kraken,coinbase` | Aggregate endpoints | Multiple exchanges (comma-separated) |
| `symbols` | `BTC/USD,ETH/USD` | Aggregate endpoints | Multiple pairs (comma-separated) |

---

## 🔐 Security Notes

1. **Public Endpoints**: No authentication needed. Safe to call from frontend.
2. **Protected Endpoints**: Require JWT token. Only call from authenticated users.
3. **API Keys**: Stored encrypted in database. Never exposed to frontend.
4. **External APIs**: Backend maintains connections using stored credentials.
5. **CORS**: All responses include CORS headers for browser compatibility (dev mode).

---

**Last Updated:** 2026-03-04
**Backend Version:** Zig (stable)
**API Version:** v2
