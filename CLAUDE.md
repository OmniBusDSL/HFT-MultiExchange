# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

### Both servers (from repo root)
```bash
bash start-dev.sh        # Linux/Mac — checks prereqs, installs deps, starts both
start-dev.bat            # Windows
npm run start:all        # direct: runs Zig backend + Vite frontend concurrently
```

### Backend (Zig) — port 8000
```bash
cd backend && zig build run              # compile and run
cd backend && zig build                  # compile only (no run)
cd backend && zig build clean && zig build  # clean rebuild
cd backend && zig build test             # run all integration tests
cd backend && zig run test-name.zig      # run a single test file
```

### Environment Variables (Backend)

**Required for Production:**
```bash
export JWT_SECRET="your-secret-key-min-32-chars"        # JWT signing secret
export PASSWORD_SALT="your-salt-min-32-chars"            # Password hashing salt
export VAULT_SECRET="your-vault-secret-min-32-chars"     # API key encryption master secret
```

**Optional (defaults provided):**
```bash
export DATABASE_PATH="exchange.db"       # SQLite database file path
export PORT="8000"                       # Server port
```

**Note on VAULT_SECRET:** If not set, falls back to `JWT_SECRET` for development convenience. However, set a separate `VAULT_SECRET` in production for defense-in-depth.

**Example startup with environment:**
```bash
JWT_SECRET="secure-key-$(openssl rand -hex 16)" \
PASSWORD_SALT="secure-salt-$(openssl rand -hex 16)" \
VAULT_SECRET="vault-secret-$(openssl rand -hex 16)" \
zig build run
```

**Development (.env file - not for production):**
Create `backend/.env`:
```env
JWT_SECRET=dev-secret-only-for-testing-change-me
PASSWORD_SALT=dev-salt-only-for-testing-change-me
VAULT_SECRET=dev-vault-secret-only-for-testing-change-me
DATABASE_PATH=exchange.db
PORT=8000
```

⚠️ **Security:** Never commit `.env` file to Git. Add to `.gitignore`:
```bash
echo "backend/.env" >> .gitignore
```

### Frontend (React + Vite) — port 5173
```bash
cd frontend && npm install               # first-time setup
cd frontend && npm run dev               # dev server with hot reload
cd frontend && npm run build             # production build
cd frontend && npm run lint              # ESLint validation (0 warnings policy enforced)
```

## Architecture Overview

Low-latency crypto exchange with local aggregation layer. Design philosophy (see `Propose.md`):
- **Zig** orchestrator: zero-GC async I/O for WebSocket streams and HTTP routing
- **SQLite WAL mode**: local buffer that decouples external exchange data from UI rendering
- **Multi-exchange support**: LCX, Kraken, Coinbase via unified CCXT-compatible interface
- **Vite/React frontend**: connects only to local Zig server (never directly to exchanges; API keys stay backend-only)

### Backend (`backend/src/`)

Raw async TCP/HTTP server built with Zig stdlib (no framework). Entry: `main.zig`.

**Core modules:**
| Module | Files | Role |
|--------|-------|------|
| **Configuration** | `config/config.zig` | Loads secrets from environment variables (JWT_SECRET, PASSWORD_SALT, etc.) |
| **HTTP routing** | `main.zig` | TCP accept loop, request parsing, CORS headers, route dispatch |
| **Auth** | `auth/jwt.zig`, `auth/auth.zig` | JWT (HMAC-SHA256) generation/verify, PBKDF2 password hashing |
| **Database** | `db/database.zig`, `db/users.zig` | SQLite C FFI wrapper, schema, all CRUD operations |
| **Exchange APIs** | `exchange/{lcx,kraken,coinbase}.zig` | CCXT-compatible HTTP clients for 12 operations each (markets, tickers, balances, orders, trades) |
| **WebSockets** | `ws/ws_client.zig`, `ws/lcx_{orderbook,private}_ws.zig` | RFC 6455 frames, connection state, LCX orderbook + private order feeds |
| **Utilities** | `utils/json.zig`, `models/models.zig` | JSON parse/serialize, request/response struct defs |

**SQLite schema** (initialized at startup):
- `users` — email, password_hash, referral_code, referred_by, created_at
- `orders` — user_id, pair, side, price, quantity, status, created_at
- `api_keys` — user_id, name, exchange, api_key, api_secret, status
- `price_feed` — pair, price_int (integer × 10^8; avoids float precision issues), timestamp

WAL mode enabled for concurrent read/write without blocking.

**Security notes:**
- ✅ JWT secret & password salt now loaded from environment variables (`JWT_SECRET`, `PASSWORD_SALT`)
- ✅ Sensible defaults for development (will warn if env vars not set in production)
- ⚠️ API keys are stored in database — encrypt before deploying to production
- ⚠️ CORS headers allow all origins (localhost dev only — restrict in production)
- 📝 Never commit `.env` file or environment variables to Git

### Frontend (`frontend/src/`)

React 18 + TypeScript + React Router v6. No state management library (auth lives in context).

| Path | Purpose |
|------|---------|
| `App.tsx` | Router root; `ProtectedRoute` wraps authenticated pages in `AppLayout` |
| `context/AuthContext.tsx` | Manages auth state; persists token + user to `localStorage`; backend calls to `http://127.0.0.1:8000` |
| `api/exchange.ts` | `ExchangeAPI` (HTTP client) + `ExchangeWebSocket` (WS with exponential backoff) |
| `pages/{Dashboard,Trade,Balance,APIKeys,Profile,Login,Register}.tsx` | Route handlers |
| `layouts/AppLayout.tsx` | Sidebar + navigation for authenticated views |

**Client-side routing:**
- Unauthenticated → redirected to `/login`
- Authenticated users on `/login` or `/register` → redirected to `/dashboard`
- Vite proxy: `/api/*` → `http://localhost:8000` (strips `/api` prefix during development)

**Testing:** Frontend has no Jest/Vitest suite. Linting with ESLint enforces 0-warning policy; run `npm run lint` before commits.

## Testing

### Backend Tests

Test files are standalone Zig executables in the `backend/` root directory:

```bash
# Run all integration tests (as defined in build.zig)
cd backend && zig build test

# Run specific test file
cd backend && zig run test-ws-connect.zig
cd backend && zig run test-lcx-orderbook.zig
cd backend && zig run test-lcx-private-ws.zig
cd backend && zig run test-open-orders.zig
```

**Available test files:**
- `test-ws-connect.zig` — WebSocket frame parsing, connection handshake
- `test-lcx-orderbook.zig` — LCX public orderbook feed (snapshot + deltas)
- `test-lcx-private-ws.zig` — LCX authenticated private orders feed
- `test-open-orders.zig` — Multi-exchange order fetching (LCX, Kraken, Coinbase)
- `test-*-signatures.zig`, `test-symbol-norm.zig` — Exchange-specific auth and data normalization

Tests read API credentials from environment variables or database. Most require valid API keys to execute.

### Frontend Tests

No automated test suite. Linting is the primary quality gate:
```bash
cd frontend && npm run lint  # Must pass with 0 warnings before merge
```

## Key Implementation Patterns

**Error handling:** Most operations return `!Type` (error union). Use `try`, `catch`, or `orelse` for handling.

**Memory:** Backend uses `std.heap.GeneralPurposeAllocator` with `defer` for cleanup. Arena allocators for request scopes.

**JSON:** Manual parsing in `src/utils/json.zig` with string slicing; no codegen. See exchange modules for examples.

**HTTP:** Raw socket reads with custom header parsing (no HTTP library). Route handlers call `r.sendJson()` or write raw responses.

**Async:** WebSocket connections spawn per-feed; communication via channels or shared state with mutex guards.

**Frontend styling:** CSS modules or inline styles. Glassmorphism theme applied globally in `App.css`.
