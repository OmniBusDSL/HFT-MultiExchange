# Zig Exchange Server Backend

A high-performance crypto trading exchange server built with **Zig** and **Zap** framework.

## Architecture

```
src/
├── main.zig              # HTTP server & route handlers
├── auth/
│   └── auth.zig          # Password hashing & JWT generation
├── db/
│   └── database.zig      # SQLite database layer
├── models/
│   └── models.zig        # Request/Response data structures
├── middleware/           # (Planned) Auth middleware, rate limiting
├── utils/                # (Planned) Helper utilities
└── routes/               # (Planned) Separated route handlers
```

## Prerequisites

- **Zig** `0.14.0` or later
- **Git** (for dependency management)

### Install Zig

- **Windows:** https://ziglang.org/download/
- **Mac/Linux:** Use package manager or download from https://ziglang.org/download/

Verify installation:
```bash
zig version
```

## Project Setup

### 1. Initialize Dependencies

```bash
cd backend
zig fetch https://github.com/zigzap/zap/archive/refs/heads/master.tar.gz
zig fetch https://github.com/vrischmann/zig-sqlite/archive/refs/heads/master.tar.gz
```

### 2. Build the Project

```bash
zig build
```

### 3. Run the Server

```bash
zig build run
```

The server will start on `http://0.0.0.0:8000`

## API Endpoints

### Health Check
```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1772245446,
  "users": 0
}
```

### Register User
```
POST /register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### Login User
```
POST /login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### Get Orderbook
```
GET /orderbook
```

### Place Order
```
POST /order
```

### Get Balance
```
GET /balance
```

## Features (In Progress)

- ✅ Project structure & Zig setup
- ✅ HTTP server with Zap framework
- ⏳ User registration with SQLite
- ⏳ Login with JWT tokens
- ⏳ Password hashing (bcrypt/PBKDF2)
- ⏳ CORS support
- ⏳ Rate limiting
- ⏳ Order management
- ⏳ WebSocket support (real-time data)

## Development

### Add a New Route

Edit `src/main.zig`:

```zig
try router.handle_func("GET", "/newroute", newRouteHandler);

fn newRouteHandler(r: *zap.Request) void {
    r.sendJson("{}") catch |err| {
        std.debug.print("[ERROR] {}\n", .{err});
    };
}
```

### Database Operations

Use `src/db/database.zig`:

```zig
var db = try Database.init(allocator, "users.db");
defer db.deinit();
try db.initSchema();
```

## Common Issues

### "zig: command not found"
- Add Zig to PATH: https://ziglang.org/documentation/master/#Getting-Started

### Dependency fetch fails
- Ensure internet connection
- Try: `zig fetch --save <url>` to manually add dependencies

## Next Steps

1. **Implement Register Handler** - Connect to SQLite, hash password
2. **Implement Login Handler** - Verify password, return JWT token
3. **Add CORS Support** - Enable frontend communication
4. **Error Handling** - Proper error responses
5. **Production Build** - Optimize for deployment

## Resources

- [Zig Documentation](https://ziglang.org/documentation/)
- [Zap Framework](https://github.com/zigzap/zap)
- [zig-sqlite](https://github.com/vrischmann/zig-sqlite)

## License

MIT
