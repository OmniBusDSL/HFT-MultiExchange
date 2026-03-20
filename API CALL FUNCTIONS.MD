# API Call Functions — Zig Exchange Server

Base URL: `http://localhost:8000`

All endpoints return JSON responses with appropriate HTTP status codes. Requests and responses use standard HTTP conventions.

---

## Authentication Endpoints

### POST /register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure_password",
  "referred_by": "referral_code_optional"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "status": 201,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "referral_code": "abc123xyz",
    "referred_by": "",
    "created_at": 1234567890
  },
  "token": "eyJhbGc..."
}
```

**Errors:**
- `400` — Missing email or password
- `409` — User already exists

---

### POST /login
Authenticate and get JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "status": 200,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "referral_code": "abc123xyz",
    "referred_by": "",
    "created_at": 1234567890
  },
  "token": "eyJhbGc..."
}
```

**Errors:**
- `400` — Missing email or password
- `401` — Invalid credentials

---

### GET /health
Server health check.

**Response (200 OK):**
```json
{
  "status": "ok",
  "users": 42
}
```

---

## User Profile Endpoints

### PUT /profile/referral-code
Update user's referral code.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Request Body:**
```json
{
  "referral_code": "new_code_123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "referral_code": "new_code_123"
}
```

**Errors:**
- `401` — Unauthorized (invalid or missing token)
- `400` — Invalid request body

---

### GET /profile/referrals
Get list of users who were referred by this user.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Query Parameters:**
- None

**Response (200 OK):**
```json
{
  "referrals": [
    {
      "id": 2,
      "email": "referred_user@example.com",
      "referred_at": 1234567890
    }
  ]
}
```

**Errors:**
- `401` — Unauthorized

---

### GET /referral/check?code=ABC123
Check if a referral code is valid.

**Query Parameters:**
- `code` — The referral code to validate

**Response (200 OK):**
```json
{
  "valid": true,
  "code": "ABC123"
}
```

---

## API Keys Management

### GET /apikeys
Get all API keys for authenticated user.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Response (200 OK):**
```json
{
  "apikeys": [
    {
      "id": 1,
      "name": "LCX Trading",
      "exchange": "lcx",
      "status": "active",
      "created_at": 1234567890
    }
  ]
}
```

---

### POST /apikeys/add
Add a new API key.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Request Body:**
```json
{
  "name": "LCX Trading",
  "exchange": "lcx",
  "api_key": "lcx_key_...",
  "api_secret": "lcx_secret_..."
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "apikey_id": 1,
  "message": "API key added successfully"
}
```

**Errors:**
- `400` — Missing required fields
- `401` — Unauthorized

---

### POST /apikeys/test
Test if an API key is valid by verifying credentials.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Request Body:**
```json
{
  "apikey_id": 1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "API key is valid"
}
```

**Errors:**
- `400` — Invalid API key
- `401` — Unauthorized
- `404` — API key not found

---

### DELETE /apikeys/{id}
Delete an API key.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "API key deleted"
}
```

**Errors:**
- `401` — Unauthorized
- `404` — API key not found

---

## Trading Endpoints (require API key)

### GET /apikeys/{id}/balance
Get account balance for an exchange.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "balances": {
    "BTC": { "free": 1.5, "used": 0.5, "total": 2.0 },
    "ETH": { "free": 10.0, "used": 5.0, "total": 15.0 },
    "USD": { "free": 5000.0, "used": 0, "total": 5000.0 }
  }
}
```

---

### POST /apikeys/{id}/orders/create
Create a new order.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Request Body:**
```json
{
  "symbol": "BTC/USD",
  "side": "buy",
  "type": "limit",
  "price": 45000,
  "amount": 0.1
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "order_id": "order_123",
  "symbol": "BTC/USD",
  "side": "buy",
  "status": "open"
}
```

---

### POST /apikeys/{id}/orders/cancel
Cancel an open order.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Request Body:**
```json
{
  "order_id": "order_123",
  "symbol": "BTC/USD"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Order cancelled"
}
```

---

### GET /apikeys/{id}/orders/open
Get all open orders.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Query Parameters:**
- `symbol` — Optional, filter by trading pair (e.g., `BTC/USD`)

**Response (200 OK):**
```json
{
  "orders": [
    {
      "id": "order_123",
      "symbol": "BTC/USD",
      "side": "buy",
      "price": 45000,
      "amount": 0.1,
      "filled": 0.05,
      "status": "open"
    }
  ]
}
```

---

### GET /apikeys/{id}/orders/closed
Get all closed orders.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Query Parameters:**
- `symbol` — Optional, filter by trading pair
- `limit` — Optional, number of orders to return (default: 50)

**Response (200 OK):**
```json
{
  "orders": [
    {
      "id": "order_456",
      "symbol": "ETH/USD",
      "side": "sell",
      "price": 2500,
      "amount": 1.0,
      "filled": 1.0,
      "status": "closed"
    }
  ]
}
```

---

### GET /apikeys/{id}/trades
Get trade history.

**Headers:**
- `Authorization: Bearer <JWT_TOKEN>`

**Query Parameters:**
- `symbol` — Optional, filter by trading pair
- `limit` — Optional, number of trades to return (default: 100)

**Response (200 OK):**
```json
{
  "trades": [
    {
      "id": "trade_123",
      "order_id": "order_123",
      "symbol": "BTC/USD",
      "side": "buy",
      "price": 45000,
      "amount": 0.05,
      "cost": 2250,
      "fee": 5.62,
      "timestamp": 1234567890
    }
  ]
}
```

---

## Public Market Data Endpoints

### GET /public/health
(Alias for `/health`) Server status check.

---

### GET /public/markets?exchange={exchange}
Get list of available markets.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "markets": [
    {
      "id": "BTC/EUR",
      "symbol": "BTC/EUR",
      "base": "BTC",
      "quote": "EUR",
      "active": true
    }
  ]
}
```

---

### GET /public/tickers?exchange={exchange}
Get all tickers for an exchange.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "tickers": [
    {
      "symbol": "BTC/EUR",
      "last": 45000,
      "bid": 44999,
      "ask": 45001,
      "change": 2.5,
      "changePercent": 0.5,
      "timestamp": 1234567890
    }
  ]
}
```

---

### GET /public/ticker?exchange={exchange}&symbol={symbol}
Get ticker for a specific pair.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`
- `symbol` — Trading pair (e.g., `BTC/EUR`, `BTC/USD`)

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "symbol": "BTC/EUR",
  "last": 45000,
  "bid": 44999,
  "ask": 45001,
  "high": 46000,
  "low": 44500,
  "change": 2.5,
  "changePercent": 0.5,
  "volume": 1234.56,
  "timestamp": 1234567890
}
```

---

### GET /public/orderbook?exchange={exchange}&symbol={symbol}
Get order book (bid/ask levels).

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`
- `symbol` — Trading pair
- `limit` — Optional, number of levels (default: 25)

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "symbol": "BTC/EUR",
  "bestBid": 44999,
  "bestAsk": 45001,
  "spread": 2,
  "midpoint": 45000,
  "bids": [
    { "price": 44999, "amount": 1.5 },
    { "price": 44998, "amount": 2.0 }
  ],
  "asks": [
    { "price": 45001, "amount": 1.5 },
    { "price": 45002, "amount": 2.0 }
  ],
  "timestamp": 1234567890
}
```

---

### GET /public/ohlcv?exchange={exchange}&symbol={symbol}&timeframe={tf}
Get candlestick data.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`
- `symbol` — Trading pair
- `timeframe` — `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- `limit` — Optional, number of candles (default: 100)

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "symbol": "BTC/EUR",
  "timeframe": "1h",
  "ohlcv": [
    {
      "timestamp": 1234567800,
      "open": 44900,
      "high": 45100,
      "low": 44800,
      "close": 45000,
      "volume": 250
    }
  ]
}
```

---

### GET /public/exchange-symbols?exchange={exchange}
Get all symbols/pairs for an exchange.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "symbols": [
    "BTC/EUR",
    "ETH/EUR",
    "LCX/USDC",
    "XRP/EUR"
  ]
}
```

---

## Aggregator Endpoints (Multi-Exchange)

### GET /public/aggregate/tickers
Get aggregated tickers across all exchanges.

**Response (200 OK):**
```json
{
  "aggregated": [
    {
      "symbol": "BTC/USD",
      "exchanges": {
        "lcx": { "last": 45000, "bid": 44999, "ask": 45001 },
        "kraken": { "last": 44980, "bid": 44979, "ask": 44981 },
        "coinbase": { "last": 45010, "bid": 45009, "ask": 45011 }
      },
      "best_bid": 44999,
      "best_ask": 45001,
      "spread": 2
    }
  ]
}
```

---

### GET /public/aggregate/ticker?symbol={symbol}
Get aggregated ticker for a specific pair across all exchanges.

**Query Parameters:**
- `symbol` — Trading pair (e.g., `BTC/USD`)

**Response (200 OK):**
```json
{
  "symbol": "BTC/USD",
  "exchanges": {
    "lcx": { "last": 45000, "bid": 44999, "ask": 45001, "timestamp": 1234567890 },
    "kraken": { "last": 44980, "bid": 44979, "ask": 44981, "timestamp": 1234567890 },
    "coinbase": { "last": 45010, "bid": 45009, "ask": 45011, "timestamp": 1234567890 }
  },
  "best_bid": 44999,
  "best_ask": 45001,
  "spread": 2
}
```

---

### GET /public/aggregate/orderbook?symbol={symbol}
Get aggregated order book from all exchanges.

**Query Parameters:**
- `symbol` — Trading pair

**Response (200 OK):**
```json
{
  "symbol": "BTC/USD",
  "aggregated_bids": [
    { "price": 44999, "amount": 1.5, "exchange": "lcx" },
    { "price": 44998, "amount": 2.0, "exchange": "kraken" }
  ],
  "aggregated_asks": [
    { "price": 45001, "amount": 1.5, "exchange": "lcx" },
    { "price": 45002, "amount": 2.0, "exchange": "coinbase" }
  ]
}
```

---

### GET /public/aggregate/markets
Get all markets across all exchanges (deduplicated).

**Response (200 OK):**
```json
{
  "markets": [
    {
      "symbol": "BTC/USD",
      "on_exchanges": ["lcx", "kraken", "coinbase"],
      "base": "BTC",
      "quote": "USD"
    }
  ]
}
```

---

## Arbitrage Endpoints

### GET /public/arbitrage-scan-all
Scan all pairs across all exchanges for arbitrage opportunities.

**Response (200 OK):**
```json
{
  "opportunities": [
    {
      "symbol": "BTC/USD",
      "buy_exchange": "kraken",
      "buy_price": 44980,
      "sell_exchange": "lcx",
      "sell_price": 45000,
      "profit_percent": 0.04,
      "spread": 20
    }
  ],
  "scan_timestamp": 1234567890
}
```

---

### GET /public/arbitrage-scan?symbol={symbol}
Scan a specific pair for arbitrage opportunities.

**Query Parameters:**
- `symbol` — Trading pair

**Response (200 OK):**
```json
{
  "symbol": "BTC/USD",
  "opportunities": [
    {
      "buy_exchange": "kraken",
      "buy_price": 44980,
      "sell_exchange": "lcx",
      "sell_price": 45000,
      "profit_percent": 0.04,
      "spread": 20
    }
  ]
}
```

---

## LCX Specific Endpoints

### GET /public/lcx-pairs
Get all LCX trading pairs.

**Response (200 OK):**
```json
{
  "pairs": ["BTC/EUR", "ETH/EUR", "LCX/USDC", "XRP/EUR"]
}
```

---

### GET /public/lcx-vs-coinbase
Compare LCX prices with Coinbase for common pairs.

**Response (200 OK):**
```json
{
  "comparisons": [
    {
      "symbol": "BTC/USD",
      "lcx_symbol": "BTC/EUR",
      "lcx_price": 45000,
      "coinbase_price": 45010,
      "difference": 10,
      "difference_percent": 0.02
    }
  ]
}
```

---

### GET /public/lcx-vs-kraken
Compare LCX prices with Kraken for common pairs.

**Response (200 OK):**
```json
{
  "comparisons": [
    {
      "symbol": "BTC/USD",
      "lcx_symbol": "BTC/EUR",
      "lcx_price": 45000,
      "kraken_price": 44980,
      "difference": 20,
      "difference_percent": 0.04
    }
  ]
}
```

---

### GET /public/lcx-eur-vs-exchanges
Compare LCX EUR pairs with other exchanges (converting to EUR).

**Response (200 OK):**
```json
{
  "comparisons": [
    {
      "symbol": "BTC/EUR",
      "lcx_price": 45000,
      "kraken_usd": 44980,
      "kraken_eur_equiv": 42000,
      "difference": 3000
    }
  ]
}
```

---

## Admin Endpoints

### POST /admin/sync-exchange-pairs
Sync and update all exchange trading pairs from their APIs.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Exchange pairs synchronized",
  "lcx": 25,
  "kraken": 18,
  "coinbase": 15
}
```

---

### POST /admin/populate-grouped-pairs
Populate database with grouped trading pair data.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Grouped pairs populated",
  "total_groups": 42
}
```

---

## Ticker Caching Endpoints

### POST /api/cache-tickers?exchange={exchange}
Cache tickers for an exchange.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`

**Response (200 OK):**
```json
{
  "cached": true,
  "exchange": "lcx",
  "count": 25,
  "timestamp": 1234567890
}
```

---

### GET /api/cached-tickers?exchange={exchange}
Get cached tickers for an exchange.

**Query Parameters:**
- `exchange` — `lcx`, `kraken`, or `coinbase`

**Response (200 OK):**
```json
{
  "exchange": "lcx",
  "cached": true,
  "tickers": [
    {
      "symbol": "BTC/EUR",
      "last": 45000,
      "bid": 44999,
      "ask": 45001
    }
  ],
  "cached_at": 1234567890
}
```

---

## CoinGecko Proxy

### GET /public/coingecko/{path}
Proxy requests to CoinGecko API with caching to avoid rate limits.

**Query Parameters:**
- Any CoinGecko API query parameters

**Example:**
```
GET /public/coingecko/simple/price?ids=bitcoin&vs_currencies=usd
```

**Response (200 OK):**
```json
{
  "bitcoin": { "usd": 45000 }
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error message describing the issue"
}
```

**Common HTTP Status Codes:**
- `200` — OK, request succeeded
- `201` — Created, resource created successfully
- `204` — No Content, successful but no response body
- `400` — Bad Request, invalid parameters or malformed request
- `401` — Unauthorized, missing or invalid authentication token
- `404` — Not Found, endpoint or resource doesn't exist
- `409` — Conflict, resource already exists
- `500` — Internal Server Error, server-side issue

---

## Authentication

Most endpoints require JWT authentication. Include the token in the request header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Obtain a token via `/login` or `/register` endpoint.

---

## Rate Limits & Polling

- Frontend polls `/public/orderbook` every **100ms** for live updates
- CoinGecko proxy caches responses for **5 minutes** to avoid rate limits
- No explicit rate limiting on backend endpoints (adjust in production)

---

## Notes

- **Symbols** are exchange-specific:
  - LCX: `BTC/EUR`, `ETH/EUR`, `LCX/USDC`
  - Kraken: `BTC/USD`, `ETH/USD`, `LCX/USD`
  - Coinbase: `BTC-USD`, `ETH-USD`, `LCX-USDC`

- **Timestamps** are Unix epoch (seconds since 1970-01-01 00:00:00 UTC)

- **All responses** include CORS headers for browser access:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization`

---

**Last Updated:** March 2026
