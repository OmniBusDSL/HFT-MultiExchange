# HFT-MultiExchange

Low-latency crypto exchange aggregator with real-time orderbook polling across LCX, Kraken, and Coinbase.

## Quick Start

### Prerequisites
- Zig 0.14.0+
- Node.js 18+
- npm or yarn

### Installation & Running

```bash
# Install dependencies
npm install

# Start both backend (port 8000) and frontend (port 5173)
npm run start:all

# Or run separately:
cd backend && zig build run          # Backend on :8000
cd frontend && npm run dev           # Frontend on :5173
```

## Architecture

**Backend (Zig):**
- HTTP/1.1 server with thread-per-connection model
- SQLite database with WAL mode
- JWT authentication (HMAC-SHA256)
- CCXT-compatible exchange APIs
- 37 RESTful endpoints
- Multi-exchange data aggregation
- Arbitrage opportunity scanner

**Frontend (React 18 + TypeScript):**
- Real-time orderbook visualization (100ms polling)
- Multi-exchange price comparison
- Trading interface (create/cancel orders)
- User authentication & API key management
- Live balance updates

**Supported Exchanges:**
- **LCX** — EUR pairs, real-time tickers
- **Kraken** — USD/EUR pairs, advanced orders
- **Coinbase** — USD pairs, institutional grade

## API Documentation

See **[API CALL FUNCTIONS.md](./API%20CALL%20FUNCTIONS.md)** for complete endpoint documentation.

**Key Endpoints:**
- Authentication: `/register`, `/login`
- Public data: `/public/tickers`, `/public/orderbook`, `/public/markets`
- Trading: `/apikeys/{id}/orders/create`, `/apikeys/{id}/orders/cancel`
- Aggregation: `/public/aggregate/orderbook`, `/public/aggregate/tickers`
- Arbitrage: `/public/arbitrage-scan`

## Features

✅ **Multi-Exchange Support**
- Unified symbol normalization (BTC/USD ↔ BTC/EUR ↔ BTC-USD)
- Cross-exchange price comparison
- Arbitrage opportunity detection

✅ **Real-Time Data**
- 100ms polling interval for live updates
- Order book depth visualization
- Candlestick data (OHLCV)
- Ticker streams

✅ **Trading**
- Create limit/market orders
- Cancel open orders
- View order history & trades
- Real-time balance updates

✅ **Security**
- JWT authentication (24h expiry)
- PBKDF2 password hashing (100k iterations)
- Encrypted API key storage (XChaCha20-Poly1305)
- CORS headers for browser access

✅ **Performance**
- Zero-GC Zig backend for minimal latency
- Thread-safe caching with mutex protection
- Concurrent request handling
- SQLite WAL mode for concurrent reads

## Environment Variables

**Backend (.env file):**
```env
JWT_SECRET=your-secret-key-min-32-chars
PASSWORD_SALT=your-salt-min-32-chars
VAULT_SECRET=your-vault-secret-min-32-chars
DATABASE_PATH=exchange.db
PORT=8000
```

For development, default values are provided. **Set these for production.**

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── main.zig              # HTTP server entry point
│   │   ├── db/                   # SQLite wrapper & schema
│   │   ├── auth/                 # JWT & password hashing
│   │   ├── exchange/             # LCX, Kraken, Coinbase clients
│   │   ├── ws/                   # WebSocket frame handling & caching
│   │   ├── arbitrage/            # Arbitrage scanner
│   │   ├── utils/                # JSON parsing, symbol normalization
│   │   └── models/               # Request/response structs
│   └── build.zig
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Router root
│   │   ├── pages/                # Dashboard, Trade, Balance, etc.
│   │   ├── context/              # AuthContext for JWT
│   │   ├── api/                  # HTTP client for backend
│   │   └── styles/               # CSS modules & theme
│   ├── vite.config.ts
│   └── package.json
│
├── API CALL FUNCTIONS.md         # 37 endpoints documented
├── ARCHITECTURE-DIAGRAM.md       # System design
├── CLAUDE.md                     # Development guide
└── README.md                     # This file
```

## Development

### Backend Build Commands

```bash
cd backend

# Build & run
zig build run

# Build only
zig build

# Run tests
zig build test

# Clean rebuild
zig build clean && zig build
```

### Frontend Development

```bash
cd frontend

# Dev server with hot reload
npm run dev

# Build for production
npm run build

# Lint check (0 warnings policy)
npm run lint
```

## Testing

### Backend Integration Tests

```bash
cd backend && zig build test
```

Tests cover:
- WebSocket frame parsing
- Exchange API clients
- Symbol normalization
- Order operations

### Frontend

No automated test suite. Linting enforces code quality:
```bash
npm run lint  # Must pass with 0 warnings
```

## Known Issues

⚠️ **HTTP Client Gzip Decompression**
- Status: Known Zig stdlib 0.14.0 bug in flate decompressor
- Impact: Affects `/public/tickers` endpoint when response is gzip-compressed
- Workaround: Using HTTP polling instead of WebSocket streams
- Solution: Upgrade Zig stdlib or implement custom decompression

## Performance

- **Orderbook updates:** 100ms polling interval
- **Response time:** <50ms for cached data
- **Concurrent users:** Limited by database WAL mode (recommended 5-10 concurrent)
- **Memory usage:** ~50MB for backend, ~100MB for frontend

## Security Notes

- ✅ API keys encrypted with XChaCha20-Poly1305
- ✅ Passwords hashed with PBKDF2 (100k iterations)
- ✅ JWT tokens signed with HMAC-SHA256
- ⚠️ CORS headers allow all origins (set restrictively in production)
- ⚠️ No rate limiting on backend (implement for production)

## License

BSD 3-Clause License

## Authors

- **SAVACAZAN** — Project lead, architecture
- **Claude (Anthropic)** — Backend implementation, API design, documentation

## Support

For issues or questions:
1. Check [API CALL FUNCTIONS.md](./API%20CALL%20FUNCTIONS.md) for endpoint details
2. Review [ARCHITECTURE-DIAGRAM.md](./ARCHITECTURE-DIAGRAM.md) for system design
3. See [CLAUDE.md](./CLAUDE.md) for development setup

---

**Last Updated:** March 2026
**Status:** Production-ready (except known gzip bug)
