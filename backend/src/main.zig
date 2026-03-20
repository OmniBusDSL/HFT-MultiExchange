const std = @import("std");
const net = std.net;
const mem = std.mem;
const json_util = @import("utils/json.zig");
const database = @import("db/database.zig");
const users_module = @import("db/users.zig");
const jwt_module = @import("auth/jwt.zig");
const exchange_factory = @import("exchange/factory.zig");
const exchange_symbols = @import("exchange/exchange_symbols.zig");
const aggregator = @import("exchange/aggregator.zig");
const config_module = @import("config/config.zig");
const orderbook_ws_manager = @import("ws/orderbook_ws_manager.zig");
const arb_scanner = @import("arbitrage/scanner.zig");
const http_client = @import("exchange/http_client.zig");

var global_db: database.Database = undefined;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CoinGecko API Proxy Cache — Simple in-memory cache to avoid rate limiting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CacheEntry = struct {
    url: [512]u8 = [_]u8{0} ** 512,
    url_len: usize = 0,
    body: [8192]u8 = [_]u8{0} ** 8192,
    body_len: usize = 0,
    timestamp: i64 = 0,
};

const COINGECKO_CACHE_SIZE = 50;
const COINGECKO_CACHE_TTL = 300; // 5 minutes in seconds
var coingecko_cache_mutex = std.Thread.Mutex{};
var coingecko_cache: [COINGECKO_CACHE_SIZE]CacheEntry = [_]CacheEntry{.{}} ** COINGECKO_CACHE_SIZE;
var coingecko_cache_count: usize = 0;

const CORS =
    "Access-Control-Allow-Origin: *\r\n" ++
    "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n" ++
    "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Initialize configuration from environment variables
    try config_module.initGlobalConfig(allocator);
    defer config_module.deinitGlobalConfig();

    global_db = try database.Database.init(allocator, "exchange.db");
    defer global_db.deinit();

    // Fetch and cache available symbols for all exchanges
    std.debug.print("[SYMBOLS] Loading available symbols...\n", .{});
    exchange_symbols.ExchangeSymbols.fetchAndCacheAllSymbols(allocator, &global_db) catch |err| {
        std.debug.print("[SYMBOLS] Warning: Could not pre-load symbols: {}\n", .{err});
    };

    // Orderbook polling disabled - using REST API instead
    // const ws_mgr = try orderbook_ws_manager.OrderbookWsManager.init(allocator);
    // orderbook_ws_manager.g_manager = ws_mgr;
    // try ws_mgr.startAll();

    std.debug.print("[SERVER] Zig Exchange Server starting on http://127.0.0.1:8000\n", .{});
    std.debug.print("[ROUTES] GET /health | POST /register | POST /login\n", .{});

    const address = try net.Address.parseIp("0.0.0.0", 8000);
    var server = try address.listen(.{ .reuse_address = true });
    defer server.deinit();

    while (true) {
        const conn = server.accept() catch |err| {
            std.debug.print("[ERROR] Accept: {}\n", .{err});
            continue;
        };
        const thread = std.Thread.spawn(.{}, handleConnectionThread, .{conn.stream}) catch |err| {
            std.debug.print("[ERROR] Thread spawn: {}\n", .{err});
            conn.stream.close();
            continue;
        };
        thread.detach();
    }
}

fn handleConnectionThread(stream: net.Stream) void {
    defer stream.close();
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    handleConnection(stream, allocator) catch |err| {
        std.debug.print("[ERROR] Connection: {}\n", .{err});
    };
}

fn handleConnection(stream: net.Stream, allocator: mem.Allocator) !void {
    var buf: [8192]u8 = undefined;
    const n = stream.read(&buf) catch |err| {
        std.debug.print("[ERROR] Read: {}\n", .{err});
        return;
    };
    if (n == 0) return;
    const request = buf[0..n];

    // Parse method + path from first line
    const line_end = std.mem.indexOf(u8, request, "\r\n") orelse
        std.mem.indexOf(u8, request, "\n") orelse return;
    var parts = std.mem.splitScalar(u8, request[0..line_end], ' ');
    const method = parts.next() orelse return;
    var path_with_query = parts.next() orelse return;

    // Strip query parameters from path
    const query_pos = std.mem.indexOf(u8, path_with_query, "?");
    const path = if (query_pos) |pos| path_with_query[0..pos] else path_with_query;

    std.debug.print("[REQ] {s} {s}\n", .{ method, path });

    // CORS preflight
    if (std.mem.eql(u8, method, "OPTIONS")) {
        _ = try stream.writeAll("HTTP/1.1 204 No Content\r\n" ++ CORS ++ "\r\n");
        return;
    }

    const response = blk: {
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/health")) {
            break :blk try handleHealth(allocator);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/register")) {
            break :blk try handleRegister(allocator, request);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/login")) {
            break :blk try handleLogin(allocator, request);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/admin/sync-exchange-pairs")) {
            break :blk try handleSyncExchangePairs(allocator);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/admin/populate-grouped-pairs")) {
            break :blk try handleAdminPopulateGroupedPairs(allocator);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/referral/check")) {
            break :blk try handleCheckReferralCode(allocator, path);
        }
        if (std.mem.eql(u8, method, "PUT") and std.mem.eql(u8, path, "/profile/referral-code")) {
            break :blk try handleUpdateReferralCode(allocator, request);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/profile/referrals")) {
            break :blk try handleGetReferrals(allocator, request);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/apikeys")) {
            break :blk try handleGetApiKeys(allocator, request);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/apikeys/add")) {
            break :blk try handleAddApiKey(allocator, request);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/apikeys/test")) {
            break :blk try handleTestApiKey(allocator, request);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/apikeys/") and std.mem.endsWith(u8, path, "/balance")) {
            break :blk try handleGetBalance(allocator, request, path);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.startsWith(u8, path, "/apikeys/") and std.mem.endsWith(u8, path, "/orders/create")) {
            break :blk try handleCreateOrder(allocator, request, path);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.startsWith(u8, path, "/apikeys/") and std.mem.endsWith(u8, path, "/orders/cancel")) {
            break :blk try handleCancelOrder(allocator, request, path);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/apikeys/") and std.mem.endsWith(u8, path, "/orders/open")) {
            break :blk try handleFetchOpenOrders(allocator, request, path);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/apikeys/") and std.mem.endsWith(u8, path, "/orders/closed")) {
            break :blk try handleFetchClosedOrders(allocator, request, path);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/apikeys/") and std.mem.endsWith(u8, path, "/trades")) {
            break :blk try handleFetchMyTrades(allocator, request, path);
        }
        if (std.mem.eql(u8, method, "POST") and std.mem.eql(u8, path, "/api/cache-tickers")) {
            break :blk try handleCacheTickers(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/api/cached-tickers")) {
            break :blk try handleGetCachedTickers(allocator, path_with_query);
        }
        // Multi-exchange aggregator routes (must come before /public/ routes)
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/aggregate/tickers")) {
            break :blk try handleAggregatedTickers(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/aggregate/ticker")) {
            break :blk try handleAggregatedTicker(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/aggregate/orderbook")) {
            break :blk try handleAggregatedOrderBook(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/aggregate/markets")) {
            break :blk try handleAggregatedMarkets(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/markets")) {
            break :blk try handlePublicMarkets(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/tickers")) {
            break :blk try handlePublicTickers(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/ticker")) {
            break :blk try handlePublicTicker(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/orderbook")) {
            break :blk try handlePublicOrderBook(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/ohlcv")) {
            break :blk try handlePublicOHLCV(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/exchange-symbols")) {
            break :blk try handlePublicExchangeSymbols(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/public/arbitrage-scan-all")) {
            break :blk try handleArbitrageScanAll(allocator);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/public/lcx-pairs")) {
            break :blk try handleLcxPairs(allocator);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/public/lcx-vs-coinbase")) {
            break :blk try handleLcxVsCoinbase(allocator);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/public/lcx-vs-kraken")) {
            break :blk try handleLcxVsKraken(allocator);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.eql(u8, path, "/public/lcx-eur-vs-exchanges")) {
            break :blk try handleLcxEurVsExchanges(allocator);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/arbitrage-scan")) {
            break :blk try handleArbitrageScan(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "GET") and std.mem.startsWith(u8, path, "/public/coingecko/")) {
            break :blk try handleCoingeckoProxy(allocator, path_with_query);
        }
        if (std.mem.eql(u8, method, "DELETE") and std.mem.startsWith(u8, path, "/apikeys/")) {
            break :blk try handleDeleteApiKey(allocator, request, path);
        }
        break :blk try errResp(allocator, 404, "Not Found", "Route not found");
    };
    defer allocator.free(response);

    _ = try stream.writeAll(response);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn errResp(allocator: mem.Allocator, code: u16, status: []const u8, msg: []const u8) ![]u8 {
    const body = try std.fmt.allocPrint(allocator, "{{\"error\":\"{s}\"}}", .{msg});
    defer allocator.free(body);
    return std.fmt.allocPrint(allocator,
        "HTTP/1.1 {d} {s}\r\n" ++ CORS ++ "Content-Type: application/json\r\nContent-Length: {d}\r\n\r\n{s}",
        .{ code, status, body.len, body });
}

fn okResp(allocator: mem.Allocator, code: u16, status: []const u8, body: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator,
        "HTTP/1.1 {d} {s}\r\n" ++ CORS ++ "Content-Type: application/json\r\nContent-Length: {d}\r\n\r\n{s}",
        .{ code, status, body.len, body });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

fn handleHealth(allocator: mem.Allocator) ![]u8 {
    const count = global_db.getUserCount() catch 0;
    const body = try std.fmt.allocPrint(allocator, "{{\"status\":\"ok\",\"users\":{d}}}", .{count});
    defer allocator.free(body);
    return okResp(allocator, 200, "OK", body);
}

fn handleRegister(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const body = json_util.extractBody(request) catch
        return errResp(allocator, 400, "Bad Request", "Invalid request body");

    const email = (try json_util.getStringValue(allocator, body, "email")) orelse
        return errResp(allocator, 400, "Bad Request", "Email required");

    const password = (try json_util.getStringValue(allocator, body, "password")) orelse
        return errResp(allocator, 400, "Bad Request", "Password required");

    const referred_by_raw = try json_util.getStringValue(allocator, body, "referred_by");
    const referred_by: ?[]const u8 = if (referred_by_raw) |r| (if (r.len > 0) r else null) else null;

    // Validate referral code exists if provided
    if (referred_by) |ref_code| {
        const valid = global_db.referralCodeExists(ref_code) catch false;
        if (!valid) {
            return errResp(allocator, 400, "Bad Request", "Referral code does not exist");
        }
    }

    const referral_code = try users_module.generateReferralCode(allocator);
    defer allocator.free(referral_code);

    const password_hash = try users_module.hashPassword(allocator, password);
    defer allocator.free(password_hash);

    const user_id = global_db.createUser(email, password_hash, referral_code, referred_by) catch |err| {
        if (err == error.UserAlreadyExists)
            return errResp(allocator, 409, "Conflict", "User already exists");
        std.debug.print("[REGISTER] DB error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    };

    const token = jwt_module.generateToken(allocator, user_id, email) catch
        return errResp(allocator, 500, "Internal Server Error", "Token generation failed");
    defer allocator.free(token);

    const now = std.time.timestamp();
    const ref_str = referred_by orelse "";
    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"success\":true,\"status\":201," ++
        "\"data\":{{\"id\":{d},\"email\":\"{s}\",\"referral_code\":\"{s}\",\"referred_by\":\"{s}\",\"created_at\":{d}}}," ++
        "\"token\":\"{s}\"}}",
        .{ user_id, email, referral_code, ref_str, now, token });
    defer allocator.free(resp_body);

    std.debug.print("[REGISTER] ✓ id={d} email={s}\n", .{ user_id, email });
    return okResp(allocator, 201, "Created", resp_body);
}

fn handleLogin(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const body = json_util.extractBody(request) catch
        return errResp(allocator, 400, "Bad Request", "Invalid request body");

    const email = (try json_util.getStringValue(allocator, body, "email")) orelse
        return errResp(allocator, 400, "Bad Request", "Email required");

    const password = (try json_util.getStringValue(allocator, body, "password")) orelse
        return errResp(allocator, 400, "Bad Request", "Password required");

    const user = (global_db.getUserByEmail(allocator, email) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error")) orelse
        return errResp(allocator, 401, "Unauthorized", "Invalid credentials");
    defer user.deinit(allocator);

    const valid = users_module.verifyPassword(allocator, password, user.password_hash) catch false;
    if (!valid) return errResp(allocator, 401, "Unauthorized", "Invalid credentials");

    const token = jwt_module.generateToken(allocator, user.id, user.email) catch
        return errResp(allocator, 500, "Internal Server Error", "Token generation failed");
    defer allocator.free(token);

    const ref_str = user.referred_by orelse "";
    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"success\":true,\"status\":200," ++
        "\"user\":{{\"id\":{d},\"email\":\"{s}\",\"referral_code\":\"{s}\",\"referred_by\":\"{s}\",\"created_at\":{d}}}," ++
        "\"token\":\"{s}\"}}",
        .{ user.id, user.email, user.referral_code, ref_str, user.created_at, token });
    defer allocator.free(resp_body);

    std.debug.print("[LOGIN] ✓ email={s}\n", .{email});
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleUpdateReferralCode(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    const body = json_util.extractBody(request) catch
        return errResp(allocator, 400, "Bad Request", "Invalid request body");

    const new_code_raw = (try json_util.getStringValue(allocator, body, "referral_code")) orelse
        return errResp(allocator, 400, "Bad Request", "referral_code required");

    if (new_code_raw.len < 4 or new_code_raw.len > 16) {
        return errResp(allocator, 400, "Bad Request", "Code must be 4-16 characters");
    }

    const new_code = try allocator.alloc(u8, new_code_raw.len);
    defer allocator.free(new_code);
    for (new_code_raw, 0..) |c, i| {
        new_code[i] = std.ascii.toUpper(c);
    }

    const exists = global_db.referralCodeExists(new_code) catch false;
    if (exists) return errResp(allocator, 409, "Conflict", "Referral code already taken");

    const ok = global_db.updateReferralCodeCascade(allocator, user_id, new_code) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    if (!ok) return errResp(allocator, 404, "Not Found", "User not found");

    std.debug.print("[PROFILE] ✓ user_id={d} new_code={s}\n", .{ user_id, new_code });

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"success\":true,\"referral_code\":\"{s}\"}}",
        .{new_code});
    defer allocator.free(resp_body);
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleGetReferrals(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    // Get current user to find their referral_code
    const user = (global_db.getUserById(allocator, user_id) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error")) orelse
        return errResp(allocator, 404, "Not Found", "User not found");
    defer user.deinit(allocator);

    // Get all users referred by this user's code
    const referred = global_db.getReferredUsers(allocator, user.referral_code) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    defer {
        for (referred) |*u| u.deinit(allocator);
        allocator.free(referred);
    }

    // Build JSON array
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "[");
    for (referred, 0..) |ref_user, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        const entry = try std.fmt.allocPrint(allocator,
            "{{\"id\":{d},\"email\":\"{s}\",\"created_at\":{d}}}",
            .{ ref_user.id, ref_user.email, ref_user.created_at });
        defer allocator.free(entry);
        try json.appendSlice(allocator, entry);
    }
    try json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"success\":true,\"count\":{d},\"referrals\":{s}}}",
        .{ referred.len, json.items });
    defer allocator.free(resp_body);

    std.debug.print("[REFERRALS] user_id={d} count={d}\n", .{ user_id, referred.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleCheckReferralCode(allocator: mem.Allocator, path: []const u8) ![]u8 {
    // path = "/referral/check?code=XXXXXXXXX"
    const prefix = "/referral/check?code=";
    if (!std.mem.startsWith(u8, path, prefix)) {
        return errResp(allocator, 400, "Bad Request", "Missing code parameter");
    }
    const code = path[prefix.len..];
    if (code.len == 0) {
        return errResp(allocator, 400, "Bad Request", "Code is empty");
    }

    const exists = global_db.referralCodeExists(code) catch false;
    const body = try std.fmt.allocPrint(allocator,
        "{{\"valid\":{s},\"code\":\"{s}\"}}",
        .{ if (exists) "true" else "false", code });
    defer allocator.free(body);

    std.debug.print("[CHECK] code={s} valid={}\n", .{ code, exists });
    return okResp(allocator, 200, "OK", body);
}

fn handleGetApiKeys(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    const keys = global_db.getApiKeysByUserId(allocator, user_id) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    defer {
        for (keys) |*k| k.deinit(allocator);
        allocator.free(keys);
    }

    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "[");
    for (keys, 0..) |key, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        const entry = try std.fmt.allocPrint(allocator,
            "{{\"id\":{d},\"name\":\"{s}\",\"exchange\":\"{s}\",\"apiKey\":\"{s}\",\"apiSecret\":\"***\",\"status\":\"{s}\",\"createdAt\":{d}}}",
            .{ key.id, key.name, key.exchange, key.api_key, key.status, key.created_at });
        defer allocator.free(entry);
        try json.appendSlice(allocator, entry);
    }
    try json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"keys\":{s}}}",
        .{json.items});
    defer allocator.free(resp_body);

    std.debug.print("[APIKEYS] user_id={d} count={d}\n", .{ user_id, keys.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleAddApiKey(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    const body = json_util.extractBody(request) catch
        return errResp(allocator, 400, "Bad Request", "Invalid request body");

    const name = (try json_util.getStringValue(allocator, body, "name")) orelse
        return errResp(allocator, 400, "Bad Request", "name required");
    const exchange = (try json_util.getStringValue(allocator, body, "exchange")) orelse
        return errResp(allocator, 400, "Bad Request", "exchange required");
    const api_key = (try json_util.getStringValue(allocator, body, "apiKey")) orelse
        return errResp(allocator, 400, "Bad Request", "apiKey required");
    const api_secret = (try json_util.getStringValue(allocator, body, "apiSecret")) orelse
        return errResp(allocator, 400, "Bad Request", "apiSecret required");

    const key_id = global_db.addApiKey(user_id, name, exchange, api_key, api_secret) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"success\":true,\"id\":{d}}}",
        .{key_id});
    defer allocator.free(resp_body);

    std.debug.print("[APIKEYS] ✓ Added key_id={d} user_id={d} exchange={s}\n",
        .{ key_id, user_id, exchange });
    return okResp(allocator, 201, "Created", resp_body);
}

fn handleDeleteApiKey(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    const id_str = path["/apikeys/".len..];
    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");

    const deleted = global_db.deleteApiKey(key_id, user_id) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    if (!deleted) return errResp(allocator, 404, "Not Found", "API key not found");

    const resp_body = try std.fmt.allocPrint(allocator, "{{\"success\":true}}", .{});
    defer allocator.free(resp_body);

    std.debug.print("[APIKEYS] ✓ Deleted key_id={d} user_id={d}\n", .{ key_id, user_id });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleTestApiKey(allocator: mem.Allocator, request: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    const body = json_util.extractBody(request) catch
        return errResp(allocator, 400, "Bad Request", "Invalid request body");

    std.debug.print("[TEST] Body length: {d}, content: {s}\n", .{body.len, body[0..@min(200, body.len)]});

    // Try to extract ID - handle both string and numeric formats
    var key_id: u32 = 0;
    var found_id = false;

    // First try numeric format (which is more common from JSON)
    if (std.mem.indexOf(u8, body, "\"id\"")) |idx| {
        var i = idx + 4; // Skip "\"id\""
        while (i < body.len and (body[i] == ' ' or body[i] == ':' or body[i] == '\t')) i += 1; // Skip : and whitespace

        // Try numeric value first
        if (i < body.len and body[i] >= '0' and body[i] <= '9') {
            var j = i;
            while (j < body.len and body[j] >= '0' and body[j] <= '9') j += 1;
            if (j > i) {
                key_id = std.fmt.parseUnsigned(u32, body[i..j], 10) catch 0;
                found_id = true;
            }
        }
        // Try quoted string format
        else if (i < body.len and body[i] == '"') {
            i += 1; // Skip opening quote
            var j = i;
            while (j < body.len and body[j] != '"') j += 1;
            if (j > i) {
                key_id = std.fmt.parseUnsigned(u32, body[i..j], 10) catch 0;
                found_id = true;
            }
        }
    }

    if (!found_id) {
        return errResp(allocator, 400, "Bad Request", "id required");
    }

    const key = (global_db.getApiKeyById(allocator, key_id, user_id) catch
        return errResp(allocator, 500, "Internal Server Error", "Server error")) orelse
        return errResp(allocator, 404, "Not Found", "API key not found");
    var key_mut = key;
    defer key_mut.deinit(allocator);

    std.debug.print("[TEST] user_id={d} key_id={d} exchange={s}\n",
        .{ user_id, key_id, key_mut.exchange });

    var result = exchange_factory.testExchange(
        allocator,
        key_mut.exchange,
        key_mut.api_key,
        key_mut.api_secret,
    ) catch |err| blk: {
        std.debug.print("[TEST] exchange error: {}\n", .{err});
        break :blk try @import("exchange/types.zig").TestResult.failFmt(
            allocator, "Test error: {}", .{err});
    };
    defer result.deinit(allocator);

    std.debug.print("[TEST] ✓ exchange={s} success={} msg={s}\n",
        .{ key_mut.exchange, result.success, result.message });

    // Escape message for JSON
    const escaped = try escapeJsonString(allocator, result.message);
    defer allocator.free(escaped);

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"success\":{s},\"message\":\"{s}\"}}",
        .{ if (result.success) "true" else "false", escaped });
    defer allocator.free(resp_body);

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleGetBalance(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    std.debug.print("[BALANCE] Received request for path: {s}\n", .{path});

    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    std.debug.print("[BALANCE] Extracted user_id: {d}\n", .{user_id});

    // Extract ID from path: /apikeys/{id}/balance
    const prefix = "/apikeys/";
    const suffix = "/balance";
    if (!std.mem.startsWith(u8, path, prefix)) {
        std.debug.print("[BALANCE] Path does not start with {s}\n", .{prefix});
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    }

    const id_part = path[prefix.len..];
    std.debug.print("[BALANCE] id_part: {s}\n", .{id_part});

    const id_end = std.mem.indexOf(u8, id_part, suffix) orelse {
        std.debug.print("[BALANCE] Could not find suffix {s} in {s}\n", .{ suffix, id_part });
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    };
    const id_str = id_part[0..id_end];

    std.debug.print("[BALANCE] Parsed key_id string: {s}\n", .{id_str});

    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch {
        std.debug.print("[BALANCE] Failed to parse key_id\n", .{});
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");
    };

    std.debug.print("[BALANCE] Looking up key_id={d} for user_id={d}\n", .{ key_id, user_id });

    var key = (global_db.getApiKeyById(allocator, key_id, user_id) catch |err| {
        std.debug.print("[BALANCE] Database error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    }) orelse {
        std.debug.print("[BALANCE] API key not found for user_id={d} key_id={d}\n", .{ user_id, key_id });
        return errResp(allocator, 404, "Not Found", "API key not found");
    };
    defer key.deinit(allocator);

    std.debug.print("[BALANCE] ✓ Found key: user_id={d} key_id={d} exchange={s}\n",
        .{ user_id, key_id, key.exchange });

    var balance_result = exchange_factory.fetchBalance(
        allocator,
        key.exchange,
        key.api_key,
        key.api_secret,
    ) catch |err| {
        std.debug.print("[BALANCE] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch balance");
    };
    defer balance_result.deinit(allocator);

    // Build JSON response: {"balances": [...], "free": ..., "used": ..., "total": ...}
    var balances_json: std.ArrayList(u8) = .empty;
    defer balances_json.deinit(allocator);

    try balances_json.appendSlice(allocator, "[");
    for (balance_result.balances, 0..) |balance, i| {
        if (i > 0) try balances_json.appendSlice(allocator, ",");
        const balance_str = try std.fmt.allocPrint(allocator,
            "{{\"currency\":\"{s}\",\"free\":{d},\"used\":{d},\"total\":{d}}}",
            .{ balance.currency, balance.free, balance.used, balance.total });
        defer allocator.free(balance_str);
        try balances_json.appendSlice(allocator, balance_str);
    }
    try balances_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"balances\":{s},\"free\":{?d},\"used\":{?d},\"total\":{?d}}}",
        .{
            key.exchange,
            balances_json.items,
            balance_result.free,
            balance_result.used,
            balance_result.total,
        });
    defer allocator.free(resp_body);

    std.debug.print("[BALANCE] ✓ exchange={s} count={d}\n",
        .{ key.exchange, balance_result.balances.len });

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleCacheTickers(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract query param: ?exchange=lcx or ?exchange=kraken or ?exchange=coinbase
    var exchange_name: ?[]const u8 = null;
    if (std.mem.indexOf(u8, path_with_query, "?")) |query_pos| {
        const query_str = path_with_query[query_pos + 1..];
        if (std.mem.startsWith(u8, query_str, "exchange=")) {
            const exch_start = 9;
            const exch_end = std.mem.indexOf(u8, query_str[exch_start..], "&") orelse query_str[exch_start..].len;
            exchange_name = query_str[exch_start .. exch_start + exch_end];
        }
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");

    // Fetch tickers from the exchange
    const tickers_result = exchange_factory.fetchTickers(allocator, exch, "", "", null) catch |err| {
        std.debug.print("[CACHE-TICKERS] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch tickers");
    };
    defer {
        for (tickers_result) |*ticker| {
            ticker.deinit(allocator);
        }
        allocator.free(tickers_result);
    }

    // Clear existing cached tickers for this exchange
    global_db.clearCachedTickersByExchange(exch) catch |err| {
        std.debug.print("[CACHE-TICKERS] clear error: {}\n", .{err});
    };

    // Cache each ticker in the database
    var cached_count: usize = 0;
    for (tickers_result) |ticker| {
        global_db.cacheMarketTicker(exch, ticker.symbol) catch |err| {
            std.debug.print("[CACHE-TICKERS] cache error for {s}: {}\n", .{ ticker.symbol, err });
            continue;
        };
        cached_count += 1;
    }

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"cached_count\":{d},\"total_count\":{d}}}",
        .{ exch, cached_count, tickers_result.len });
    defer allocator.free(resp_body);

    std.debug.print("[CACHE-TICKERS] ✓ exchange={s} cached={d}/{d}\n", .{ exch, cached_count, tickers_result.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleGetCachedTickers(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract query param: ?exchange=lcx
    var exchange_name: ?[]const u8 = null;
    if (std.mem.indexOf(u8, path_with_query, "?")) |query_pos| {
        const query_str = path_with_query[query_pos + 1..];
        if (std.mem.startsWith(u8, query_str, "exchange=")) {
            const exch_start = 9;
            const exch_end = std.mem.indexOf(u8, query_str[exch_start..], "&") orelse query_str[exch_start..].len;
            exchange_name = query_str[exch_start .. exch_start + exch_end];
        }
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");

    // Get cached tickers from database
    const cached_symbols = global_db.getCachedTickersByExchange(allocator, exch) catch |err| {
        std.debug.print("[GET-CACHED-TICKERS] error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch cached tickers");
    };
    defer {
        for (cached_symbols) |sym| {
            allocator.free(sym);
        }
        allocator.free(cached_symbols);
    }

    // Format response
    var symbols_json: std.ArrayList(u8) = .empty;
    defer symbols_json.deinit(allocator);

    try symbols_json.appendSlice(allocator, "[");
    for (cached_symbols, 0..) |symbol, i| {
        if (i > 0) try symbols_json.appendSlice(allocator, ",");
        try symbols_json.appendSlice(allocator, "\"");
        try symbols_json.appendSlice(allocator, symbol);
        try symbols_json.appendSlice(allocator, "\"");
    }
    try symbols_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"symbols\":{s},\"count\":{d}}}",
        .{ exch, symbols_json.items, cached_symbols.len });
    defer allocator.free(resp_body);

    std.debug.print("[GET-CACHED-TICKERS] ✓ exchange={s} count={d}\n", .{ exch, cached_symbols.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handlePublicMarkets(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract exchange from query param: ?exchange=lcx
    var exchange_name: ?[]const u8 = null;
    if (std.mem.indexOf(u8, path_with_query, "?")) |query_pos| {
        const query_str = path_with_query[query_pos + 1..];
        if (std.mem.startsWith(u8, query_str, "exchange=")) {
            const exch_start = 9; // length of "exchange="
            const exch_end = std.mem.indexOf(u8, query_str[exch_start..], "&") orelse query_str[exch_start..].len;
            exchange_name = query_str[exch_start .. exch_start + exch_end];
        }
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");

    // Fetch both markets and tickers to get complete data with bid/ask
    const markets_result = exchange_factory.fetchMarkets(
        allocator,
        exch,
        "",
        "",
    ) catch |err| {
        std.debug.print("[MARKETS] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch markets");
    };
    defer {
        for (markets_result) |*market| {
            market.deinit(allocator);
        }
        allocator.free(markets_result);
    }

    // Fetch tickers to get bid/ask/last data
    const tickers_result = exchange_factory.fetchTickers(allocator, exch, "", "", null) catch |err| {
        std.debug.print("[MARKETS] failed to fetch tickers: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch tickers");
    };
    defer {
        for (tickers_result) |*ticker| {
            ticker.deinit(allocator);
        }
        allocator.free(tickers_result);
    }

    // Build a map of symbol -> ticker for quick lookup
    var markets_json: std.ArrayList(u8) = .empty;
    defer markets_json.deinit(allocator);

    try markets_json.appendSlice(allocator, "[");
    for (markets_result, 0..) |market, i| {
        if (i > 0) try markets_json.appendSlice(allocator, ",");

        // Find matching ticker for this market
        var bid: f64 = 0;
        var ask: f64 = 0;
        var last: f64 = 0;
        var volume: f64 = 0;

        for (tickers_result) |ticker| {
            if (std.mem.eql(u8, market.symbol, ticker.symbol)) {
                bid = ticker.bid;
                ask = ticker.ask;
                last = ticker.last;
                volume = ticker.baseVolume;
                break;
            }
        }

        const market_str = try std.fmt.allocPrint(allocator,
            "{{\"id\":\"{s}\",\"symbol\":\"{s}\",\"base\":\"{s}\",\"quote\":\"{s}\",\"last\":{d},\"bid\":{d},\"ask\":{d},\"baseVolume\":{d},\"maker\":{d},\"taker\":{d}}}",
            .{ market.id, market.symbol, market.base, market.quote, last, bid, ask, volume, market.maker, market.taker });
        defer allocator.free(market_str);
        try markets_json.appendSlice(allocator, market_str);
    }
    try markets_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"markets\":{s}}}",
        .{ exch, markets_json.items });
    defer allocator.free(resp_body);

    std.debug.print("[MARKETS] ✓ exchange={s} count={d} with tickers\n", .{ exch, markets_result.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handlePublicTicker(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract exchange and symbol from query params
    var exchange_name: ?[]const u8 = null;
    var symbol_name: ?[]const u8 = null;

    if (std.mem.indexOf(u8, path_with_query, "?")) |query_pos| {
        const query_str = path_with_query[query_pos + 1..];

        // Parse exchange=...
        if (std.mem.startsWith(u8, query_str, "exchange=")) {
            const exch_start = 9;
            const exch_end = std.mem.indexOf(u8, query_str[exch_start..], "&") orelse query_str[exch_start..].len;
            exchange_name = query_str[exch_start .. exch_start + exch_end];
        }

        // Parse symbol=...
        if (std.mem.indexOf(u8, query_str, "symbol=")) |sym_pos| {
            const sym_start = sym_pos + 7;
            const sym_end = std.mem.indexOf(u8, query_str[sym_start..], "&") orelse query_str[sym_start..].len;
            symbol_name = query_str[sym_start .. sym_start + sym_end];
        }
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");
    const sym = symbol_name orelse return errResp(allocator, 400, "Bad Request", "symbol parameter required");

    var ticker_result = exchange_factory.fetchTicker(allocator, exch, "", "", sym) catch |err| {
        std.debug.print("[TICKER] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch ticker");
    };
    defer ticker_result.deinit(allocator);

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"symbol\":\"{s}\",\"last\":{d},\"bid\":{d},\"ask\":{d},\"high\":{d},\"low\":{d},\"baseVolume\":{d}}}",
        .{ exch, ticker_result.symbol, ticker_result.last, ticker_result.bid, ticker_result.ask, ticker_result.high, ticker_result.low, ticker_result.baseVolume });
    defer allocator.free(resp_body);

    std.debug.print("[TICKER] ✓ exchange={s} symbol={s}\n", .{ exch, sym });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handlePublicTickers(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract exchange from query param (works in any position)
    var exchange_name: ?[]const u8 = null;
    if (std.mem.indexOf(u8, path_with_query, "exchange=")) |exch_idx| {
        const exch_start = exch_idx + 9;
        var exch_end = exch_start;
        while (exch_end < path_with_query.len and path_with_query[exch_end] != '&' and path_with_query[exch_end] != ' ') : (exch_end += 1) {}
        exchange_name = path_with_query[exch_start..exch_end];
    }

    // Extract symbols from query param (works in any position)
    var symbols_param: ?[]const u8 = null;
    if (std.mem.indexOf(u8, path_with_query, "symbols=")) |sym_idx| {
        const sym_start = sym_idx + 8;
        var sym_end = sym_start;
        while (sym_end < path_with_query.len and path_with_query[sym_end] != '&' and path_with_query[sym_end] != ' ') : (sym_end += 1) {}
        symbols_param = path_with_query[sym_start..sym_end];
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");

    const tickers_result = exchange_factory.fetchTickers(allocator, exch, "", "", null) catch |err| {
        std.debug.print("[TICKERS] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch tickers");
    };
    defer {
        for (tickers_result) |*ticker| {
            ticker.deinit(allocator);
        }
        allocator.free(tickers_result);
    }

    var tickers_json: std.ArrayList(u8) = .empty;
    defer tickers_json.deinit(allocator);

    try tickers_json.appendSlice(allocator, "[");
    var match_count: usize = 0;
    for (tickers_result) |ticker| {
        // If symbols specified, filter to only those
        if (symbols_param) |sym_param| {
            var sym_iter = std.mem.splitScalar(u8, sym_param, ',');
            var found = false;
            while (sym_iter.next()) |requested_symbol| {
                if (std.mem.eql(u8, ticker.symbol, requested_symbol)) {
                    found = true;
                    break;
                }
            }
            if (!found) continue;
        }

        if (match_count > 0) try tickers_json.appendSlice(allocator, ",");
        match_count += 1;

        // For Kraken, symbols are already normalized from fetchTickers
        // For other exchanges, normalize symbol format
        const normalized_symbol = if (std.mem.eql(u8, exch, "kraken"))
            ticker.symbol
        else
            (exchange_factory.normalizeSymbol(allocator, exch, ticker.symbol) catch ticker.symbol);
        defer if (!std.mem.eql(u8, exch, "kraken") and !std.mem.eql(u8, normalized_symbol, ticker.symbol)) allocator.free(normalized_symbol);

        const ticker_str = try std.fmt.allocPrint(allocator,
            "{{\"symbol\":\"{s}\",\"last\":{d},\"bid\":{d},\"ask\":{d},\"high\":{d},\"low\":{d},\"baseVolume\":{d}}}",
            .{ normalized_symbol, ticker.last, ticker.bid, ticker.ask, ticker.high, ticker.low, ticker.baseVolume });
        defer allocator.free(ticker_str);
        try tickers_json.appendSlice(allocator, ticker_str);
    }
    try tickers_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"tickers\":{s}}}",
        .{ exch, tickers_json.items });
    defer allocator.free(resp_body);

    std.debug.print("[TICKERS] ✓ exchange={s} requested={s} count={d}\n", .{ exch, symbols_param orelse "all", match_count });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handlePublicOrderBook(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract query params: ?exchange=lcx&symbol=BTC/EUR&limit=20 (in any order)
    var exchange_name: ?[]const u8 = null;
    var symbol: ?[]const u8 = null;
    var limit: ?i64 = null;

    // Parse exchange=
    if (std.mem.indexOf(u8, path_with_query, "exchange=")) |exch_idx| {
        const exch_start = exch_idx + 9;
        var exch_end = exch_start;
        while (exch_end < path_with_query.len and path_with_query[exch_end] != '&' and path_with_query[exch_end] != ' ') : (exch_end += 1) {}
        exchange_name = path_with_query[exch_start..exch_end];
    }

    // Parse symbol=
    if (std.mem.indexOf(u8, path_with_query, "symbol=")) |sym_idx| {
        const sym_start = sym_idx + 7;
        var sym_end = sym_start;
        while (sym_end < path_with_query.len and path_with_query[sym_end] != '&' and path_with_query[sym_end] != ' ') : (sym_end += 1) {}
        symbol = path_with_query[sym_start..sym_end];
    }

    // Parse limit=
    if (std.mem.indexOf(u8, path_with_query, "limit=")) |lim_idx| {
        const lim_start = lim_idx + 6;
        var lim_end = lim_start;
        while (lim_end < path_with_query.len and path_with_query[lim_end] != '&' and path_with_query[lim_end] != ' ') : (lim_end += 1) {}
        const limit_str = path_with_query[lim_start..lim_end];
        if (std.fmt.parseInt(i64, limit_str, 10)) |l| {
            limit = l;
        } else |_| {}
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");
    const sym = symbol orelse return errResp(allocator, 400, "Bad Request", "symbol parameter required");

    var orderbook_result = exchange_factory.fetchOrderBook(allocator, exch, "", "", sym, limit) catch {
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch order book");
    };
    defer orderbook_result.deinit(allocator);

    // Calculate orderbook statistics
    var best_bid: f64 = 0;
    var best_ask: f64 = 0;
    var total_bid_amount: f64 = 0;
    var total_ask_amount: f64 = 0;

    if (orderbook_result.bids.len > 0) {
        best_bid = orderbook_result.bids[0].price;
        for (orderbook_result.bids) |bid| {
            total_bid_amount += bid.amount;
        }
    }

    if (orderbook_result.asks.len > 0) {
        best_ask = orderbook_result.asks[0].price;
        for (orderbook_result.asks) |ask| {
            total_ask_amount += ask.amount;
        }
    }

    const spread: f64 = if (best_bid > 0 and best_ask > 0) best_ask - best_bid else 0;
    const midpoint: f64 = if (best_bid > 0 and best_ask > 0) (best_bid + best_ask) / 2.0 else 0;
    const timestamp = @as(i64, @intCast(std.time.timestamp()));

    // Format bids as JSON array of objects
    var bids_json: std.ArrayList(u8) = .empty;
    defer bids_json.deinit(allocator);
    try bids_json.appendSlice(allocator, "[");
    for (orderbook_result.bids, 0..) |bid, i| {
        if (i > 0) try bids_json.appendSlice(allocator, ",");
        const bid_str = try std.fmt.allocPrint(allocator, "{{\"price\":{d},\"amount\":{d}}}", .{ bid.price, bid.amount });
        defer allocator.free(bid_str);
        try bids_json.appendSlice(allocator, bid_str);
    }
    try bids_json.appendSlice(allocator, "]");

    // Format asks as JSON array of objects
    var asks_json: std.ArrayList(u8) = .empty;
    defer asks_json.deinit(allocator);
    try asks_json.appendSlice(allocator, "[");
    for (orderbook_result.asks, 0..) |ask, i| {
        if (i > 0) try asks_json.appendSlice(allocator, ",");
        const ask_str = try std.fmt.allocPrint(allocator, "{{\"price\":{d},\"amount\":{d}}}", .{ ask.price, ask.amount });
        defer allocator.free(ask_str);
        try asks_json.appendSlice(allocator, ask_str);
    }
    try asks_json.appendSlice(allocator, "]");

    // Symbol from URL is already normalized from frontend, use as-is
    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"symbol\":\"{s}\",\"bestBid\":{d},\"bestAsk\":{d},\"spread\":{d},\"midpoint\":{d},\"totalBidAmount\":{d},\"totalAskAmount\":{d},\"timestamp\":{d},\"bids\":{s},\"asks\":{s}}}",
        .{ exch, sym, best_bid, best_ask, spread, midpoint, total_bid_amount, total_ask_amount, timestamp, bids_json.items, asks_json.items });
    defer allocator.free(resp_body);

    std.debug.print("[ORDERBOOK] ✓ exchange={s} symbol={s} bid={d} ask={d} spread={d} bids={d} asks={d}\n", .{ exch, sym, best_bid, best_ask, spread, orderbook_result.bids.len, orderbook_result.asks.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handlePublicExchangeSymbols(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract query params: ?exchange=lcx
    var exchange_name: ?[]const u8 = null;

    if (std.mem.indexOf(u8, path_with_query, "exchange=")) |exch_idx| {
        const exch_start = exch_idx + 9;
        var exch_end = exch_start;
        while (exch_end < path_with_query.len and path_with_query[exch_end] != '&' and path_with_query[exch_end] != ' ') : (exch_end += 1) {}
        exchange_name = path_with_query[exch_start..exch_end];
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");

    // Read pairs from database (primary source)
    var symbols: std.ArrayList([]const u8) = .empty;
    defer {
        for (symbols.items) |sym| {
            allocator.free(sym);
        }
        symbols.deinit(allocator);
    }

    // Try to get pairs from database first
    const db_pairs = global_db.getPairsForExchange(allocator, exch) catch |err| {
        std.debug.print("[SYMBOLS] ERROR reading database: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to read pairs from database");
    };
    defer {
        for (db_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(db_pairs);
    }

    if (db_pairs.len > 0) {
        // Database has pairs - use them
        try symbols.appendSlice(allocator, db_pairs);
        std.debug.print("[SYMBOLS] ✓ exchange={s} count={d} (from database)\n", .{ exch, db_pairs.len });
    } else {
        // Database is empty - try to sync from API
        std.debug.print("[SYMBOLS] Database empty for exchange={s}, attempting API sync...\n", .{exch});
        const api_result = exchange_factory.fetchMarkets(allocator, exch, "", "") catch null;

        if (api_result) |markets| {
            defer allocator.free(markets);

            if (markets.len > 0) {
                // Store in database for future use
                var market_symbols: std.ArrayList([]const u8) = .empty;
                defer market_symbols.deinit(allocator);

                for (markets) |market| {
                    try market_symbols.append(allocator, market.symbol);
                }

                // Save to database
                if (global_db.storePairsForExchange(exch, market_symbols.items)) |_| {
                    try symbols.appendSlice(allocator, market_symbols.items);
                    std.debug.print("[SYMBOLS] ✓ exchange={s} count={d} (from API, stored in DB)\n", .{ exch, markets.len });
                } else |err| {
                    std.debug.print("[SYMBOLS] WARNING: Could not store to database: {}, but returning API data\n", .{err});
                    try symbols.appendSlice(allocator, market_symbols.items);
                }
            } else {
                return errResp(allocator, 503, "Service Unavailable", "Exchange API returned no pairs");
            }
        } else {
            return errResp(allocator, 503, "Service Unavailable", "Failed to fetch pairs from exchange API. Run /admin/sync-exchange-pairs to populate database.");
        }
    }

    // Build JSON array of symbols
    var symbols_json: std.ArrayList(u8) = .empty;
    defer symbols_json.deinit(allocator);
    try symbols_json.appendSlice(allocator, "[");
    for (symbols.items, 0..) |symbol, i| {
        if (i > 0) try symbols_json.appendSlice(allocator, ",");
        const sym_str = try std.fmt.allocPrint(allocator, "\"{s}\"", .{symbol});
        defer allocator.free(sym_str);
        try symbols_json.appendSlice(allocator, sym_str);
    }
    try symbols_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"symbols\":{s},\"count\":{d}}}",
        .{ exch, symbols_json.items, symbols.items.len });
    defer allocator.free(resp_body);

    return okResp(allocator, 200, "OK", resp_body);
}

/// Sync all pairs from all 3 exchanges and store in database
fn handlePublicOHLCV(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract query params: ?exchange=lcx&symbol=BTC/EUR&timeframe=1h&limit=100
    var exchange_name: ?[]const u8 = null;
    var symbol: ?[]const u8 = null;
    var timeframe: ?[]const u8 = null;
    var limit: ?i64 = null;

    if (std.mem.indexOf(u8, path_with_query, "?")) |query_pos| {
        const query_str = path_with_query[query_pos + 1..];
        var remaining = query_str;

        // Parse exchange=
        if (std.mem.startsWith(u8, remaining, "exchange=")) {
            const start = 9;
            const end = std.mem.indexOf(u8, remaining[start..], "&") orelse remaining[start..].len;
            exchange_name = remaining[start .. start + end];
            remaining = remaining[start + end..];
        }

        // Parse symbol=
        if (std.mem.indexOf(u8, remaining, "symbol=")) |sym_pos| {
            const sym_start = sym_pos + 7;
            const sym_end = std.mem.indexOf(u8, remaining[sym_start..], "&") orelse remaining[sym_start..].len;
            symbol = remaining[sym_start .. sym_start + sym_end];
        }

        // Parse timeframe=
        if (std.mem.indexOf(u8, remaining, "timeframe=")) |tf_pos| {
            const tf_start = tf_pos + 10;
            const tf_end = std.mem.indexOf(u8, remaining[tf_start..], "&") orelse remaining[tf_start..].len;
            timeframe = remaining[tf_start .. tf_start + tf_end];
        }

        // Parse limit=
        if (std.mem.indexOf(u8, remaining, "limit=")) |lim_pos| {
            const lim_start = lim_pos + 6;
            const lim_end = std.mem.indexOf(u8, remaining[lim_start..], "&") orelse remaining[lim_start..].len;
            const limit_str = remaining[lim_start .. lim_start + lim_end];
            if (std.fmt.parseInt(i64, limit_str, 10)) |l| {
                limit = l;
            } else |_| {}
        }
    }

    const exch = exchange_name orelse return errResp(allocator, 400, "Bad Request", "exchange parameter required");
    const sym = symbol orelse return errResp(allocator, 400, "Bad Request", "symbol parameter required");
    const tf = timeframe orelse "1h";

    var ohlcv_result = exchange_factory.fetchOHLCV(allocator, exch, "", "", sym, tf, null, limit) catch |err| {
        std.debug.print("[OHLCV] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch OHLCV data");
    };
    defer ohlcv_result.deinit(allocator);

    // Format OHLCV as JSON array
    var ohlcv_json: std.ArrayList(u8) = .empty;
    defer ohlcv_json.deinit(allocator);
    try ohlcv_json.appendSlice(allocator, "[");
    for (ohlcv_result.data, 0..) |candle, i| {
        if (i > 0) try ohlcv_json.appendSlice(allocator, ",");
        const candle_str = try std.fmt.allocPrint(
            allocator,
            "{{\"timestamp\":{d},\"open\":{d},\"high\":{d},\"low\":{d},\"close\":{d},\"volume\":{d}}}",
            .{ candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume },
        );
        defer allocator.free(candle_str);
        try ohlcv_json.appendSlice(allocator, candle_str);
    }
    try ohlcv_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(
        allocator,
        "{{\"exchange\":\"{s}\",\"symbol\":\"{s}\",\"timeframe\":\"{s}\",\"ohlcv\":{s}}}",
        .{ exch, sym, tf, ohlcv_json.items },
    );
    defer allocator.free(resp_body);

    std.debug.print("[OHLCV] ✓ exchange={s} symbol={s} timeframe={s} candles={d}\n", .{ exch, sym, tf, ohlcv_result.data.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleCreateOrder(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    // Extract ID from path: /apikeys/{id}/orders/create
    const prefix = "/apikeys/";
    const suffix = "/orders/create";
    if (!std.mem.startsWith(u8, path, prefix)) {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    }

    const id_part = path[prefix.len..];
    const id_end = std.mem.indexOf(u8, id_part, suffix) orelse {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    };
    const id_str = id_part[0..id_end];

    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch {
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");
    };

    var key = (global_db.getApiKeyById(allocator, key_id, user_id) catch |err| {
        std.debug.print("[CREATE_ORDER] Database error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    }) orelse {
        return errResp(allocator, 404, "Not Found", "API key not found");
    };
    defer key.deinit(allocator);

    // Parse request body to extract order parameters
    // Expected: {"symbol": "BTC/EUR", "side": "buy", "amount": 0.5, "price": 54000, "type": "limit"}
    var symbol: []const u8 = "";
    var side: []const u8 = "";
    var amount: f64 = 0;
    var price: f64 = 0;
    var order_type: []const u8 = "limit";

    // Extract body from request
    if (std.mem.indexOf(u8, request, "\r\n\r\n")) |pos| {
        const body = request[pos + 4..];

        // Parse JSON manually
        if (json_util.getStringValue(allocator, body, "symbol") catch null) |s| {
            symbol = s;
        }

        if (json_util.getStringValue(allocator, body, "side") catch null) |s| {
            side = s;
        }

        if (json_util.getNumberValue(body, "amount") catch null) |a| {
            amount = a;
        }

        if (json_util.getNumberValue(body, "price") catch null) |p| {
            price = p;
        }

        if (json_util.getStringValue(allocator, body, "type") catch null) |t| {
            order_type = t;
        }
    }

    if (symbol.len == 0 or side.len == 0 or amount == 0) {
        return errResp(allocator, 400, "Bad Request", "Missing required parameters");
    }

    var order_result = exchange_factory.createOrder(
        allocator,
        key.exchange,
        key.api_key,
        key.api_secret,
        symbol,
        order_type,
        side,
        amount,
        price,
    ) catch |err| {
        std.debug.print("[CREATE_ORDER] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to create order");
    };
    defer order_result.deinit(allocator);

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"id\":\"{s}\",\"symbol\":\"{s}\",\"side\":\"{s}\",\"price\":{d},\"amount\":{d},\"status\":\"{s}\"}}",
        .{ order_result.id, order_result.symbol, order_result.side, order_result.price, order_result.amount, order_result.status });
    defer allocator.free(resp_body);

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleCancelOrder(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    // Extract ID from path: /apikeys/{id}/orders/cancel
    const prefix = "/apikeys/";
    const suffix = "/orders/cancel";
    if (!std.mem.startsWith(u8, path, prefix)) {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    }

    const id_part = path[prefix.len..];
    const id_end = std.mem.indexOf(u8, id_part, suffix) orelse {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    };
    const id_str = id_part[0..id_end];

    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch {
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");
    };

    var key = (global_db.getApiKeyById(allocator, key_id, user_id) catch |err| {
        std.debug.print("[CANCEL_ORDER] Database error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    }) orelse {
        return errResp(allocator, 404, "Not Found", "API key not found");
    };
    defer key.deinit(allocator);

    // Parse request body to extract order_id
    var order_id: []const u8 = "";

    if (std.mem.indexOf(u8, request, "\r\n\r\n")) |pos| {
        const body = request[pos + 4..];
        const oid_opt = json_util.getStringValue(allocator, body, "order_id") catch null;
        if (oid_opt) |oid| {
            order_id = try allocator.dupe(u8, oid);
        }
    }

    if (order_id.len == 0) {
        return errResp(allocator, 400, "Bad Request", "Missing order_id");
    }

    var cancel_result = exchange_factory.cancelOrder(
        allocator,
        key.exchange,
        key.api_key,
        key.api_secret,
        order_id,
        "",
    ) catch |err| {
        std.debug.print("[CANCEL_ORDER] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to cancel order");
    };
    defer cancel_result.deinit(allocator);

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"id\":\"{s}\",\"status\":\"{s}\"}}",
        .{ cancel_result.id, cancel_result.status });
    defer allocator.free(resp_body);

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleFetchOpenOrders(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    // Extract ID from path: /apikeys/{id}/orders/open
    const prefix = "/apikeys/";
    const suffix = "/orders/open";
    if (!std.mem.startsWith(u8, path, prefix)) {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    }

    const id_part = path[prefix.len..];
    const id_end = std.mem.indexOf(u8, id_part, suffix) orelse {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    };
    const id_str = id_part[0..id_end];

    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch {
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");
    };

    var key = (global_db.getApiKeyById(allocator, key_id, user_id) catch |err| {
        std.debug.print("[FETCH_ORDERS] Database error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    }) orelse {
        return errResp(allocator, 404, "Not Found", "API key not found");
    };
    defer key.deinit(allocator);

    var orders_result = exchange_factory.fetchOpenOrders(
        allocator,
        key.exchange,
        key.api_key,
        key.api_secret,
        null,
    ) catch |err| {
        std.debug.print("[FETCH_ORDERS] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch orders");
    };
    defer orders_result.deinit(allocator);

    // Build JSON response: {"data": [...]}
    var orders_json: std.ArrayList(u8) = .empty;
    defer orders_json.deinit(allocator);

    try orders_json.appendSlice(allocator, "[");
    for (orders_result.data, 0..) |order, i| {
        if (i > 0) try orders_json.appendSlice(allocator, ",");
        const order_str = try std.fmt.allocPrint(allocator,
            "{{\"id\":\"{s}\",\"symbol\":\"{s}\",\"side\":\"{s}\",\"price\":{d},\"amount\":{d},\"status\":\"{s}\"}}",
            .{ order.id, order.symbol, order.side, order.price, order.amount, order.status });
        defer allocator.free(order_str);
        try orders_json.appendSlice(allocator, order_str);
    }
    try orders_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"data\":{s}}}",
        .{orders_json.items});
    defer allocator.free(resp_body);

    std.debug.print("[FETCH_ORDERS] ✓ exchange={s} count={d}\n", .{ key.exchange, orders_result.data.len });

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleFetchClosedOrders(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    // Extract ID from path: /apikeys/{id}/orders/closed
    const prefix = "/apikeys/";
    const suffix = "/orders/closed";
    if (!std.mem.startsWith(u8, path, prefix)) {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    }

    const id_part = path[prefix.len..];
    const id_end = std.mem.indexOf(u8, id_part, suffix) orelse {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    };
    const id_str = id_part[0..id_end];

    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch {
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");
    };

    var key = (global_db.getApiKeyById(allocator, key_id, user_id) catch |err| {
        std.debug.print("[FETCH_CLOSED_ORDERS] Database error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    }) orelse {
        return errResp(allocator, 404, "Not Found", "API key not found");
    };
    defer key.deinit(allocator);

    var orders_result = exchange_factory.fetchClosedOrders(
        allocator,
        key.exchange,
        key.api_key,
        key.api_secret,
        null,
    ) catch |err| {
        std.debug.print("[FETCH_CLOSED_ORDERS] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch closed orders");
    };
    defer orders_result.deinit(allocator);

    // Build JSON response: {"data": [...]}
    var orders_json: std.ArrayList(u8) = .empty;
    defer orders_json.deinit(allocator);

    try orders_json.appendSlice(allocator, "[");
    for (orders_result.data, 0..) |order, i| {
        if (i > 0) try orders_json.appendSlice(allocator, ",");
        const order_str = try std.fmt.allocPrint(allocator,
            "{{\"id\":\"{s}\",\"symbol\":\"{s}\",\"side\":\"{s}\",\"price\":{d},\"amount\":{d},\"status\":\"{s}\"}}",
            .{ order.id, order.symbol, order.side, order.price, order.amount, order.status });
        defer allocator.free(order_str);
        try orders_json.appendSlice(allocator, order_str);
    }
    try orders_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"data\":{s}}}",
        .{orders_json.items});
    defer allocator.free(resp_body);

    std.debug.print("[FETCH_CLOSED_ORDERS] ✓ exchange={s} count={d}\n", .{ key.exchange, orders_result.data.len });

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleFetchMyTrades(allocator: mem.Allocator, request: []const u8, path: []const u8) ![]u8 {
    const user_id = (jwt_module.extractUserIdFromRequest(request) catch
        return errResp(allocator, 401, "Unauthorized", "Invalid token")) orelse
        return errResp(allocator, 401, "Unauthorized", "Missing token");

    // Extract ID from path: /apikeys/{id}/trades
    const prefix = "/apikeys/";
    const suffix = "/trades";
    if (!std.mem.startsWith(u8, path, prefix)) {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    }

    const id_part = path[prefix.len..];
    const id_end = std.mem.indexOf(u8, id_part, suffix) orelse {
        return errResp(allocator, 400, "Bad Request", "Invalid path");
    };
    const id_str = id_part[0..id_end];

    const key_id = std.fmt.parseUnsigned(u32, id_str, 10) catch {
        return errResp(allocator, 400, "Bad Request", "Invalid key ID");
    };

    var key = (global_db.getApiKeyById(allocator, key_id, user_id) catch |err| {
        std.debug.print("[FETCH_TRADES] Database error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Server error");
    }) orelse {
        return errResp(allocator, 404, "Not Found", "API key not found");
    };
    defer key.deinit(allocator);

    var trades_result = exchange_factory.fetchMyTrades(
        allocator,
        key.exchange,
        key.api_key,
        key.api_secret,
        null,
    ) catch |err| {
        std.debug.print("[FETCH_TRADES] exchange error: {}\n", .{err});
        return errResp(allocator, 500, "Internal Server Error", "Failed to fetch trades");
    };
    defer trades_result.deinit(allocator);

    // Build JSON response: {"data": [...]}
    var trades_json: std.ArrayList(u8) = .empty;
    defer trades_json.deinit(allocator);

    try trades_json.appendSlice(allocator, "[");
    for (trades_result.data, 0..) |trade, i| {
        if (i > 0) try trades_json.appendSlice(allocator, ",");
        const fee_str = if (trade.fee) |f|
            try std.fmt.allocPrint(allocator, "{d}", .{f})
        else
            try allocator.dupe(u8, "null");
        defer allocator.free(fee_str);

        const trade_str = try std.fmt.allocPrint(allocator,
            "{{\"id\":\"{s}\",\"symbol\":\"{s}\",\"side\":\"{s}\",\"price\":{d},\"amount\":{d},\"timestamp\":{d},\"fee\":{s}}}",
            .{ trade.id, trade.symbol, trade.side, trade.price, trade.amount, trade.timestamp, fee_str });
        defer allocator.free(trade_str);
        try trades_json.appendSlice(allocator, trade_str);
    }
    try trades_json.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"data\":{s}}}",
        .{trades_json.items});
    defer allocator.free(resp_body);

    std.debug.print("[FETCH_TRADES] ✓ exchange={s} count={d}\n", .{ key.exchange, trades_result.data.len });

    return okResp(allocator, 200, "OK", resp_body);
}

fn escapeJsonString(allocator: mem.Allocator, s: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    for (s) |c| {
        switch (c) {
            '"' => try out.appendSlice(allocator, "\\\""),
            '\\' => try out.appendSlice(allocator, "\\\\"),
            '\n' => try out.appendSlice(allocator, "\\n"),
            '\r' => try out.appendSlice(allocator, "\\r"),
            '\t' => try out.appendSlice(allocator, "\\t"),
            else => try out.append(allocator, c),
        }
    }
    return out.toOwnedSlice(allocator);
}

// ============================================================================
// Multi-Exchange Aggregator Handlers
// ============================================================================

fn handleAggregatedTicker(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Parse query params: exchanges=lcx,kraken&symbol=BTC/USD
    var exchanges_param: ?[]const u8 = null;
    var symbol_param: ?[]const u8 = null;

    if (std.mem.indexOf(u8, path_with_query, "?")) |query_pos| {
        const query_str = path_with_query[query_pos + 1 ..];
        var remaining = query_str;

        if (std.mem.startsWith(u8, remaining, "exchanges=")) {
            const start = 10;
            const end = std.mem.indexOf(u8, remaining[start..], "&") orelse remaining[start..].len;
            exchanges_param = remaining[start .. start + end];
            remaining = remaining[start + end..];
        }

        if (std.mem.indexOf(u8, remaining, "symbol=")) |sym_pos| {
            const sym_start = sym_pos + 7;
            const sym_end = std.mem.indexOf(u8, remaining[sym_start..], "&") orelse remaining[sym_start..].len;
            symbol_param = remaining[sym_start .. sym_start + sym_end];
        }
    }

    const symbol = symbol_param orelse return errResp(allocator, 400, "Bad Request", "symbol parameter required");

    // Parse exchanges list (defaults to all if not specified)
    const exchanges_list = aggregator.parseExchangeList(exchanges_param);

    if (exchanges_list.len == 0) {
        return errResp(allocator, 400, "Bad Request", "No valid exchanges specified");
    }

    // Fetch from all exchanges
    const results = try aggregator.fetchMultiTicker(allocator, exchanges_list, symbol);
    defer aggregator.deinitResults(results, allocator);

    // Check if at least one succeeded
    var any_success = false;
    for (results) |result| {
        if (result.err_msg.len == 0) {
            any_success = true;
            break;
        }
    }

    if (!any_success) {
        return errResp(allocator, 500, "Internal Server Error", "All exchanges failed");
    }

    // Build response
    const resp_body = try aggregator.buildFullResponse(allocator, results, symbol, exchanges_list);
    defer allocator.free(resp_body);

    std.debug.print("[AGG-TICKER] ✓ symbol={s} exchanges={d}\n", .{ symbol, exchanges_list.len });
    return okResp(allocator, 200, "OK", resp_body);
}

fn handleAggregatedTickers(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Parse ?symbols=BTC/USD,ETH/USD&exchanges=lcx,kraken
    var symbols: [10][]const u8 = undefined;
    var symbol_count: usize = 0;
    var exchange_param: ?[]const u8 = null;

    // Extract symbols parameter
    if (std.mem.indexOf(u8, path_with_query, "symbols=")) |idx| {
        const start = idx + 8;
        var end = start;
        while (end < path_with_query.len and path_with_query[end] != '&') : (end += 1) {}

        const symbols_str = path_with_query[start..end];
        var current_start: usize = 0;
        for (symbols_str, 0..) |ch, i| {
            if (ch == ',' or i == symbols_str.len - 1) {
                const sym_end = if (ch == ',') i else i + 1;
                if (symbol_count < 10) {
                    symbols[symbol_count] = symbols_str[current_start..sym_end];
                    symbol_count += 1;
                }
                current_start = i + 1;
            }
        }

        // Extract exchanges parameter if present
        if (std.mem.indexOf(u8, path_with_query, "exchanges=")) |ex_idx| {
            const ex_start = ex_idx + 10;
            var ex_end = ex_start;
            while (ex_end < path_with_query.len and path_with_query[ex_end] != ' ' and path_with_query[ex_end] != '\r') : (ex_end += 1) {}
            exchange_param = path_with_query[ex_start..ex_end];
        }
    }

    if (symbol_count == 0) {
        return errResp(allocator, 400, "Bad Request", "Missing or invalid 'symbols' parameter");
    }

    // Build response with tickers for each symbol
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"tickers\":{");

    for (symbols[0..symbol_count], 0..) |symbol, i| {
        if (i > 0) try json.appendSlice(allocator, ",");

        const exchanges = aggregator.parseExchangeList(exchange_param);
        const results = try aggregator.fetchMultiTicker(allocator, exchanges, symbol);
        defer aggregator.deinitResults(results, allocator);

        const stats = aggregator.computeAggregatedStats(results);

        try json.appendSlice(allocator, "\"");
        try json.appendSlice(allocator, symbol);
        try json.appendSlice(allocator, "\":{");
        try json.appendSlice(allocator, "\"sources\":");

        const sources_str = try std.fmt.allocPrint(allocator, "{d}", .{stats.sources});
        defer allocator.free(sources_str);
        try json.appendSlice(allocator, sources_str);

        const avg_str = try std.fmt.allocPrint(allocator, ",\"avg_price\":{d},\"best_bid\":{d},\"best_ask\":{d}", .{ stats.avg_price, stats.best_bid, stats.best_ask });
        defer allocator.free(avg_str);
        try json.appendSlice(allocator, avg_str);

        try json.appendSlice(allocator, "}");
    }

    try json.appendSlice(allocator, "}}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleAggregatedOrderBook(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Parse ?symbol=BTC/USD&depth=10&exchanges=lcx,kraken
    var symbol: []const u8 = "";
    var depth: usize = 5;
    var exchange_param: ?[]const u8 = null;

    // Extract symbol parameter
    if (std.mem.indexOf(u8, path_with_query, "symbol=")) |idx| {
        const start = idx + 7;
        var end = start;
        while (end < path_with_query.len and path_with_query[end] != '&' and path_with_query[end] != ' ') : (end += 1) {}
        symbol = path_with_query[start..end];
    }

    // Extract depth parameter
    if (std.mem.indexOf(u8, path_with_query, "depth=")) |idx| {
        const start = idx + 6;
        var end = start;
        while (end < path_with_query.len and std.ascii.isDigit(path_with_query[end])) : (end += 1) {}
        if (std.fmt.parseInt(usize, path_with_query[start..end], 10)) |d| {
            depth = d;
        } else |_| {}
    }

    // Extract exchanges parameter
    if (std.mem.indexOf(u8, path_with_query, "exchanges=")) |idx| {
        const start = idx + 10;
        var end = start;
        while (end < path_with_query.len and path_with_query[end] != ' ' and path_with_query[end] != '\r') : (end += 1) {}
        exchange_param = path_with_query[start..end];
    }

    if (symbol.len == 0) {
        return errResp(allocator, 400, "Bad Request", "Missing 'symbol' parameter");
    }

    // Fetch tickers from selected exchanges to get bids/asks
    const exchanges = aggregator.parseExchangeList(exchange_param);
    const results = try aggregator.fetchMultiTicker(allocator, exchanges, symbol);
    defer aggregator.deinitResults(results, allocator);

    const stats = aggregator.computeAggregatedStats(results);

    // Build merged orderbook response
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    const meta_json = try aggregator.buildMetaJson(allocator, exchanges, results, symbol);
    defer allocator.free(meta_json);

    try json.appendSlice(allocator, "{\"meta\":");
    try json.appendSlice(allocator, meta_json);

    try json.appendSlice(allocator, ",\"aggregated\":{\"depth\":");
    const depth_str = try std.fmt.allocPrint(allocator, "{d}", .{depth});
    defer allocator.free(depth_str);
    try json.appendSlice(allocator, depth_str);

    const agg_str = try std.fmt.allocPrint(allocator, ",\"best_bid\":{d},\"best_ask\":{d},\"spread\":{d},\"sources\":{d}", .{ stats.best_bid, stats.best_ask, stats.spread, stats.sources });
    defer allocator.free(agg_str);
    try json.appendSlice(allocator, agg_str);
    try json.appendSlice(allocator, "}}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleAggregatedMarkets(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Parse ?exchanges=lcx,kraken
    var exchange_param: ?[]const u8 = null;

    if (std.mem.indexOf(u8, path_with_query, "exchanges=")) |idx| {
        const start = idx + 10;
        var end = start;
        while (end < path_with_query.len and path_with_query[end] != ' ' and path_with_query[end] != '\r') : (end += 1) {}
        exchange_param = path_with_query[start..end];
    }

    const exchanges = aggregator.parseExchangeList(exchange_param);

    // Build response listing available markets per exchange
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"markets\":{");

    for (exchanges, 0..) |exchange, i| {
        if (i > 0) try json.appendSlice(allocator, ",");

        try json.appendSlice(allocator, "\"");
        try json.appendSlice(allocator, exchange);
        try json.appendSlice(allocator, "\":{\"status\":\"available\",\"pairs_count\":150}");
    }

    try json.appendSlice(allocator, "}}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleSyncExchangePairs(allocator: mem.Allocator) ![]u8 {
    std.debug.print("[SYNC] Starting manual sync of exchange pairs...\n", .{});

    const exchanges = [_][]const u8{ "lcx", "kraken", "coinbase" };
    var results: std.ArrayList(u8) = .empty;
    defer results.deinit(allocator);

    try results.appendSlice(allocator, "[");

    for (exchanges, 0..) |exchange, i| {
        if (i > 0) try results.appendSlice(allocator, ",");

        std.debug.print("[SYNC] Fetching pairs for {s}...\n", .{exchange});

        const markets = exchange_factory.fetchMarkets(allocator, exchange, "", "") catch |err| {
            std.debug.print("[SYNC] Failed to fetch {s}: {}\n", .{ exchange, err });
            try results.appendSlice(allocator, "{\"exchange\":\"");
            try results.appendSlice(allocator, exchange);
            try results.appendSlice(allocator, "\",\"status\":\"failed\",\"error\":\"API fetch failed\"}");
            continue;
        };
        defer allocator.free(markets);

        if (markets.len == 0) {
            try results.appendSlice(allocator, "{\"exchange\":\"");
            try results.appendSlice(allocator, exchange);
            try results.appendSlice(allocator, "\",\"status\":\"failed\",\"error\":\"No pairs returned\"}");
            continue;
        }

        var symbols: std.ArrayList([]const u8) = .empty;
        defer symbols.deinit(allocator);

        for (markets) |market| {
            try symbols.append(allocator, market.symbol);
        }

        global_db.storePairsForExchange(exchange, symbols.items) catch |err| {
            std.debug.print("[SYNC] Failed to store {s}: {}\n", .{ exchange, err });
            try results.appendSlice(allocator, "{\"exchange\":\"");
            try results.appendSlice(allocator, exchange);
            try results.appendSlice(allocator, "\",\"status\":\"failed\",\"error\":\"Database store failed\"}");
            continue;
        };

        std.debug.print("[SYNC] ✓ {s}: {d} pairs\n", .{ exchange, markets.len });
        try results.appendSlice(allocator, "{\"exchange\":\"");
        try results.appendSlice(allocator, exchange);
        try results.appendSlice(allocator, "\",\"status\":\"success\",\"count\":");
        const count_str = try std.fmt.allocPrint(allocator, "{d}", .{markets.len});
        defer allocator.free(count_str);
        try results.appendSlice(allocator, count_str);
        try results.appendSlice(allocator, "}");
    }

    try results.appendSlice(allocator, "]");

    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"status\":\"completed\",\"results\":{s}}}",
        .{results.items});
    defer allocator.free(resp_body);

    return okResp(allocator, 200, "OK", resp_body);
}

fn handleLcxPairs(allocator: mem.Allocator) ![]u8 {
    // Fetch only LCX pairs from database, grouped by quote
    const lcx_pairs = global_db.getPairsForExchange(allocator, "lcx") catch |err| {
        std.debug.print("[LCX-PAIRS] ERROR: Failed to get LCX pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch LCX pairs");
    };
    defer {
        for (lcx_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(lcx_pairs);
    }

    var usd_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (usd_pairs.items) |pair| {
            allocator.free(pair);
        }
        usd_pairs.deinit(allocator);
    }

    var eur_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (eur_pairs.items) |pair| {
            allocator.free(pair);
        }
        eur_pairs.deinit(allocator);
    }

    // Separate pairs by quote currency
    for (lcx_pairs) |pair| {
        if (std.mem.endsWith(u8, pair, "USD") or std.mem.endsWith(u8, pair, "USDC")) {
            try usd_pairs.append(allocator, try allocator.dupe(u8, pair));
        } else if (std.mem.endsWith(u8, pair, "EUR")) {
            try eur_pairs.append(allocator, try allocator.dupe(u8, pair));
        }
    }

    // Sort pairs alphabetically
    std.mem.sort([]const u8, usd_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    std.mem.sort([]const u8, eur_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    std.debug.print("[LCX-PAIRS] Loaded {d} USD/USDC pairs and {d} EUR pairs\n", .{ usd_pairs.items.len, eur_pairs.items.len });

    // Build JSON response
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"exchange\":\"lcx\",\"groups\":{\"USD_USDC\":{\"pair_count\":");
    const usd_count = try std.fmt.allocPrint(allocator, "{d}", .{usd_pairs.items.len});
    defer allocator.free(usd_count);
    try json.appendSlice(allocator, usd_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (usd_pairs.items, 0..) |pair, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\"}");
    }

    try json.appendSlice(allocator, "]},\"EUR\":{\"pair_count\":");
    const eur_count = try std.fmt.allocPrint(allocator, "{d}", .{eur_pairs.items.len});
    defer allocator.free(eur_count);
    try json.appendSlice(allocator, eur_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (eur_pairs.items, 0..) |pair, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\"}");
    }

    try json.appendSlice(allocator, "]}},\"total_pairs\":");
    const total_pairs = try std.fmt.allocPrint(allocator, "{d}", .{usd_pairs.items.len + eur_pairs.items.len});
    defer allocator.free(total_pairs);
    try json.appendSlice(allocator, total_pairs);

    try json.appendSlice(allocator, ",\"message\":\"✅ LCX pairs loaded from database\"}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleLcxVsCoinbase(allocator: mem.Allocator) ![]u8 {
    const lcx_pairs = global_db.getPairsForExchange(allocator, "lcx") catch |err| {
        std.debug.print("[LCX-VS-CB] ERROR: Failed to get LCX pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch LCX pairs");
    };
    defer {
        for (lcx_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(lcx_pairs);
    }

    const cb_pairs = global_db.getPairsForExchange(allocator, "coinbase") catch |err| {
        std.debug.print("[LCX-VS-CB] ERROR: Failed to get Coinbase pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch Coinbase pairs");
    };
    defer {
        for (cb_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(cb_pairs);
    }

    // Create a set of normalized Coinbase pairs for fast lookup
    var cb_set = std.StringHashMap(bool).init(allocator);
    defer cb_set.deinit();

    for (cb_pairs) |pair| {
        var normalized: [256]u8 = undefined;
        var normalized_len: usize = 0;
        for (pair) |ch| {
            if (ch == '-') {
                normalized[normalized_len] = '/';
            } else {
                normalized[normalized_len] = ch;
            }
            normalized_len += 1;
        }
        const normalized_pair = try allocator.dupe(u8, normalized[0..normalized_len]);
        try cb_set.put(normalized_pair, true);
    }
    defer {
        var it = cb_set.keyIterator();
        while (it.next()) |key| {
            allocator.free(key.*);
        }
    }

    var usd_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (usd_pairs.items) |pair| {
            allocator.free(pair);
        }
        usd_pairs.deinit(allocator);
    }

    var eur_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (eur_pairs.items) |pair| {
            allocator.free(pair);
        }
        eur_pairs.deinit(allocator);
    }

    // Separate pairs by quote currency
    for (lcx_pairs) |pair| {
        if (std.mem.endsWith(u8, pair, "USD") or std.mem.endsWith(u8, pair, "USDC")) {
            try usd_pairs.append(allocator, try allocator.dupe(u8, pair));
        } else if (std.mem.endsWith(u8, pair, "EUR")) {
            try eur_pairs.append(allocator, try allocator.dupe(u8, pair));
        }
    }

    std.mem.sort([]const u8, usd_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    std.mem.sort([]const u8, eur_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"exchange\":\"lcx\",\"comparison\":\"coinbase\",\"groups\":{\"USD_USDC\":{\"pair_count\":");
    const usd_count = try std.fmt.allocPrint(allocator, "{d}", .{usd_pairs.items.len});
    defer allocator.free(usd_count);
    try json.appendSlice(allocator, usd_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (usd_pairs.items, 0..) |pair, i| {
        const on_coinbase = cb_set.contains(pair);
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\",\"on_coinbase\":");
        try json.appendSlice(allocator, if (on_coinbase) "true" else "false");
        try json.appendSlice(allocator, "}");
    }

    try json.appendSlice(allocator, "]},\"EUR\":{\"pair_count\":");
    const eur_count = try std.fmt.allocPrint(allocator, "{d}", .{eur_pairs.items.len});
    defer allocator.free(eur_count);
    try json.appendSlice(allocator, eur_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (eur_pairs.items, 0..) |pair, i| {
        const on_coinbase = cb_set.contains(pair);
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\",\"on_coinbase\":");
        try json.appendSlice(allocator, if (on_coinbase) "true" else "false");
        try json.appendSlice(allocator, "}");
    }

    try json.appendSlice(allocator, "]}},\"total_pairs\":");
    const total_pairs = try std.fmt.allocPrint(allocator, "{d}", .{usd_pairs.items.len + eur_pairs.items.len});
    defer allocator.free(total_pairs);
    try json.appendSlice(allocator, total_pairs);

    try json.appendSlice(allocator, ",\"message\":\"✅ LCX pairs with Coinbase availability\"}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleLcxVsKraken(allocator: mem.Allocator) ![]u8 {
    const lcx_pairs = global_db.getPairsForExchange(allocator, "lcx") catch |err| {
        std.debug.print("[LCX-VS-KRK] ERROR: Failed to get LCX pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch LCX pairs");
    };
    defer {
        for (lcx_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(lcx_pairs);
    }

    const kraken_pairs = global_db.getPairsForExchange(allocator, "kraken") catch |err| {
        std.debug.print("[LCX-VS-KRK] ERROR: Failed to get Kraken pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch Kraken pairs");
    };
    defer {
        for (kraken_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(kraken_pairs);
    }

    // Create a set of normalized Kraken pairs for fast lookup
    // Kraken uses codes like XXBT, ZUSD - normalize them to BTC, USD
    var kraken_set = std.StringHashMap(bool).init(allocator);
    defer kraken_set.deinit();

    for (kraken_pairs) |pair| {
        // Kraken uses formats like XBTEUR, ETHUSD, EURC without slashes
        // Normalize by removing X/Z prefixes and adding slash where needed
        var normalized: [256]u8 = undefined;
        var normalized_len: usize = 0;

        var i: usize = 0;
        while (i < pair.len) {
            if ((pair[i] == 'X' or pair[i] == 'Z') and i + 1 < pair.len and pair[i + 1] >= 'A' and pair[i + 1] <= 'Z') {
                // Skip X or Z prefix for asset codes
                i += 1;
                continue;
            }
            normalized[normalized_len] = pair[i];
            normalized_len += 1;
            i += 1;
        }

        // Store both with and without slash for matching flexibility
        const normalized_pair = try allocator.dupe(u8, normalized[0..normalized_len]);
        try kraken_set.put(normalized_pair, true);

        // Also store with slashes inserted (e.g., ETHUSD -> ETH/USD)
        if (normalized_len > 3) {
            var with_slash: [256]u8 = undefined;
            var slash_len: usize = 0;

            // Try to detect quote currency and insert slash
            var last_quote_start = normalized_len;
            if (std.mem.endsWith(u8, normalized[0..normalized_len], "USD")) {
                last_quote_start = normalized_len - 3;
            } else if (std.mem.endsWith(u8, normalized[0..normalized_len], "EUR")) {
                last_quote_start = normalized_len - 3;
            } else if (std.mem.endsWith(u8, normalized[0..normalized_len], "USDC")) {
                last_quote_start = normalized_len - 4;
            }

            if (last_quote_start < normalized_len and last_quote_start > 0) {
                std.mem.copyForwards(u8, with_slash[0..last_quote_start], normalized[0..last_quote_start]);
                with_slash[last_quote_start] = '/';
                std.mem.copyForwards(u8, with_slash[last_quote_start + 1..], normalized[last_quote_start..normalized_len]);
                slash_len = normalized_len + 1;

                const with_slash_pair = try allocator.dupe(u8, with_slash[0..slash_len]);
                try kraken_set.put(with_slash_pair, true);

                // If pair ends with USD, also store USDC variant (for matching LCX/USDC pairs)
                if (std.mem.endsWith(u8, normalized[0..normalized_len], "USD")) {
                    var with_usdc: [256]u8 = undefined;
                    const usdc_len = slash_len + 1; // Add 'C' to USD
                    std.mem.copyForwards(u8, with_usdc[0..slash_len], with_slash[0..slash_len]);
                    with_usdc[slash_len] = 'C';
                    const with_usdc_pair = try allocator.dupe(u8, with_usdc[0..usdc_len]);
                    try kraken_set.put(with_usdc_pair, true);
                }
            }
        }
    }
    defer {
        var it = kraken_set.keyIterator();
        while (it.next()) |key| {
            allocator.free(key.*);
        }
    }

    var usd_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (usd_pairs.items) |pair| {
            allocator.free(pair);
        }
        usd_pairs.deinit(allocator);
    }

    var eur_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (eur_pairs.items) |pair| {
            allocator.free(pair);
        }
        eur_pairs.deinit(allocator);
    }

    // Separate pairs by quote currency
    for (lcx_pairs) |pair| {
        if (std.mem.endsWith(u8, pair, "USD") or std.mem.endsWith(u8, pair, "USDC")) {
            try usd_pairs.append(allocator, try allocator.dupe(u8, pair));
        } else if (std.mem.endsWith(u8, pair, "EUR")) {
            try eur_pairs.append(allocator, try allocator.dupe(u8, pair));
        }
    }

    std.mem.sort([]const u8, usd_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    std.mem.sort([]const u8, eur_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"exchange\":\"lcx\",\"comparison\":\"kraken\",\"groups\":{\"USD_USDC\":{\"pair_count\":");
    const usd_count = try std.fmt.allocPrint(allocator, "{d}", .{usd_pairs.items.len});
    defer allocator.free(usd_count);
    try json.appendSlice(allocator, usd_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (usd_pairs.items, 0..) |pair, i| {
        // Check if pair exists in Kraken set
        // Try both USDC and USD variants to handle equivalence
        var on_kraken = kraken_set.contains(pair);

        // If not found with USDC, try USD variant
        if (!on_kraken and std.mem.endsWith(u8, pair, "USDC")) {
            var usd_variant: [256]u8 = undefined;
            const variant_len = pair.len - 1; // Remove the 'C' from USDC
            @memcpy(usd_variant[0..variant_len], pair[0..variant_len]);
            on_kraken = kraken_set.contains(usd_variant[0..variant_len]);
        }

        // If not found with USD, try USDC variant
        if (!on_kraken and std.mem.endsWith(u8, pair, "USD")) {
            var usdc_variant: [256]u8 = undefined;
            @memcpy(usdc_variant[0..pair.len], pair);
            usdc_variant[pair.len] = 'C';
            on_kraken = kraken_set.contains(usdc_variant[0..pair.len + 1]);
        }

        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\",\"on_kraken\":");
        try json.appendSlice(allocator, if (on_kraken) "true" else "false");
        try json.appendSlice(allocator, "}");
    }

    try json.appendSlice(allocator, "]},\"EUR\":{\"pair_count\":");
    const eur_count = try std.fmt.allocPrint(allocator, "{d}", .{eur_pairs.items.len});
    defer allocator.free(eur_count);
    try json.appendSlice(allocator, eur_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (eur_pairs.items, 0..) |pair, i| {
        const on_kraken = kraken_set.contains(pair);
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\",\"on_kraken\":");
        try json.appendSlice(allocator, if (on_kraken) "true" else "false");
        try json.appendSlice(allocator, "}");
    }

    try json.appendSlice(allocator, "]}},\"total_pairs\":");
    const total_pairs = try std.fmt.allocPrint(allocator, "{d}", .{usd_pairs.items.len + eur_pairs.items.len});
    defer allocator.free(total_pairs);
    try json.appendSlice(allocator, total_pairs);

    try json.appendSlice(allocator, ",\"message\":\"✅ LCX pairs with Kraken availability\"}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleLcxEurVsExchanges(allocator: mem.Allocator) ![]u8 {
    const lcx_pairs = global_db.getPairsForExchange(allocator, "lcx") catch |err| {
        std.debug.print("[LCX-EUR] ERROR: Failed to get LCX pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch LCX pairs");
    };
    defer {
        for (lcx_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(lcx_pairs);
    }

    const kraken_pairs = global_db.getPairsForExchange(allocator, "kraken") catch |err| {
        std.debug.print("[LCX-EUR] ERROR: Failed to get Kraken pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch Kraken pairs");
    };
    defer {
        for (kraken_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(kraken_pairs);
    }

    const cb_pairs = global_db.getPairsForExchange(allocator, "coinbase") catch |err| {
        std.debug.print("[LCX-EUR] ERROR: Failed to get Coinbase pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch Coinbase pairs");
    };
    defer {
        for (cb_pairs) |pair| {
            allocator.free(pair);
        }
        allocator.free(cb_pairs);
    }

    // Create sets for Kraken (USD + EUR) and Coinbase (USDC + EUR) pairs
    var kraken_usd_set = std.StringHashMap(bool).init(allocator);
    defer kraken_usd_set.deinit();

    var kraken_eur_set = std.StringHashMap(bool).init(allocator);
    defer kraken_eur_set.deinit();

    var coinbase_usdc_set = std.StringHashMap(bool).init(allocator);
    defer coinbase_usdc_set.deinit();

    var coinbase_eur_set = std.StringHashMap(bool).init(allocator);
    defer coinbase_eur_set.deinit();

    // Normalize and add Kraken pairs (remove X/Z prefixes, separate USD and EUR)
    for (kraken_pairs) |pair| {
        var normalized: [256]u8 = undefined;
        var normalized_len: usize = 0;
        var i: usize = 0;
        while (i < pair.len) {
            if ((pair[i] == 'X' or pair[i] == 'Z') and i + 1 < pair.len and pair[i + 1] >= 'A' and pair[i + 1] <= 'Z') {
                i += 1;
                continue;
            }
            normalized[normalized_len] = pair[i];
            normalized_len += 1;
            i += 1;
        }
        const norm_pair = try allocator.dupe(u8, normalized[0..normalized_len]);

        // Separate by quote currency
        if (std.mem.endsWith(u8, norm_pair, "USD")) {
            try kraken_usd_set.put(try allocator.dupe(u8, norm_pair), true);
        } else if (std.mem.endsWith(u8, norm_pair, "EUR")) {
            try kraken_eur_set.put(try allocator.dupe(u8, norm_pair), true);
        }
        allocator.free(norm_pair);
    }
    defer {
        var it = kraken_usd_set.keyIterator();
        while (it.next()) |key| {
            allocator.free(key.*);
        }
    }
    defer {
        var it = kraken_eur_set.keyIterator();
        while (it.next()) |key| {
            allocator.free(key.*);
        }
    }

    // Normalize and add Coinbase pairs (convert - to /, separate USDC and EUR)
    for (cb_pairs) |pair| {
        var normalized: [256]u8 = undefined;
        var normalized_len: usize = 0;
        for (pair) |ch| {
            if (ch == '-') {
                normalized[normalized_len] = '/';
            } else {
                normalized[normalized_len] = ch;
            }
            normalized_len += 1;
        }
        const norm_pair = try allocator.dupe(u8, normalized[0..normalized_len]);

        // Separate by quote currency
        if (std.mem.endsWith(u8, norm_pair, "USDC")) {
            try coinbase_usdc_set.put(try allocator.dupe(u8, norm_pair), true);
        } else if (std.mem.endsWith(u8, norm_pair, "EUR")) {
            try coinbase_eur_set.put(try allocator.dupe(u8, norm_pair), true);
        }
        allocator.free(norm_pair);
    }
    defer {
        var it = coinbase_usdc_set.keyIterator();
        while (it.next()) |key| {
            allocator.free(key.*);
        }
    }
    defer {
        var it = coinbase_eur_set.keyIterator();
        while (it.next()) |key| {
            allocator.free(key.*);
        }
    }

    // Filter only EUR pairs from LCX
    var eur_pairs: std.ArrayList([]const u8) = .empty;
    defer {
        for (eur_pairs.items) |pair| {
            allocator.free(pair);
        }
        eur_pairs.deinit(allocator);
    }

    for (lcx_pairs) |pair| {
        if (std.mem.endsWith(u8, pair, "EUR")) {
            try eur_pairs.append(allocator, try allocator.dupe(u8, pair));
        }
    }

    std.mem.sort([]const u8, eur_pairs.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"exchange\":\"lcx\",\"comparison\":\"eur-to-usd-usdc\",\"pair_count\":");
    const count = try std.fmt.allocPrint(allocator, "{d}", .{eur_pairs.items.len});
    defer allocator.free(count);
    try json.appendSlice(allocator, count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (eur_pairs.items, 0..) |pair, i| {
        // Convert EUR pair to USD for Kraken USD lookup
        var usd_variant: [256]u8 = undefined;
        const usd_len = pair.len - 2; // Remove "EUR", will add "USD"
        @memcpy(usd_variant[0..usd_len], pair[0..usd_len]);
        @memcpy(usd_variant[usd_len..usd_len + 3], "USD");
        const usd_pair = usd_variant[0..usd_len + 3];

        // Check all four variants
        const on_kraken_usd = kraken_usd_set.contains(usd_pair);
        const on_kraken_eur = kraken_eur_set.contains(pair);
        const on_coinbase_usdc = coinbase_usdc_set.contains(pair);
        const on_coinbase_eur = coinbase_eur_set.contains(pair);

        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, pair);
        try json.appendSlice(allocator, "\",\"on_kraken_usd\":");
        try json.appendSlice(allocator, if (on_kraken_usd) "true" else "false");
        try json.appendSlice(allocator, ",\"on_kraken_eur\":");
        try json.appendSlice(allocator, if (on_kraken_eur) "true" else "false");
        try json.appendSlice(allocator, ",\"on_coinbase_usdc\":");
        try json.appendSlice(allocator, if (on_coinbase_usdc) "true" else "false");
        try json.appendSlice(allocator, ",\"on_coinbase_eur\":");
        try json.appendSlice(allocator, if (on_coinbase_eur) "true" else "false");
        try json.appendSlice(allocator, "}");
    }

    try json.appendSlice(allocator, "],\"message\":\"✅ LCX EUR pairs vs Kraken (USD/EUR) and Coinbase (USDC/EUR)\"}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleArbitrageScan(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Parse query: ?exchange=lcx&symbol=BTC/USD or multi-exchange
    var exchange_param: ?[]const u8 = null;
    var symbol_param: ?[]const u8 = null;

    if (std.mem.indexOf(u8, path_with_query, "exchange=")) |pos| {
        const start = pos + "exchange=".len;
        const remaining = path_with_query[start..];
        const end = std.mem.indexOf(u8, remaining, "&") orelse remaining.len;
        exchange_param = remaining[0..end];
    }

    if (std.mem.indexOf(u8, path_with_query, "symbol=")) |pos| {
        const start = pos + "symbol=".len;
        const remaining = path_with_query[start..];
        const end = std.mem.indexOf(u8, remaining, "&") orelse remaining.len;
        symbol_param = remaining[0..end];
    }

    if (symbol_param == null) {
        return errResp(allocator, 400, "Bad Request", "Missing symbol parameter");
    }

    const symbol = symbol_param.?;

    // Initialize scanner
    var scanner = arb_scanner.Scanner.init(allocator);
    defer {
        scanner.orderbooks.deinit();
        scanner.opportunities.deinit(allocator);
    }

    // Fetch orderbooks from selected exchanges
    const exchanges = [_][]const u8{ "lcx", "kraken", "coinbase" };
    var orderbooks: std.ArrayList(arb_scanner.Orderbook) = .empty;
    defer orderbooks.deinit(allocator);

    for (exchanges) |exch| {
        if (exchange_param) |eparam| {
            if (!std.mem.eql(u8, exch, eparam)) continue;
        }

        const now = std.time.milliTimestamp();
        const response = exchange_factory.fetchOrderBook(allocator, exch, "", "", symbol, null) catch {
            continue;
        };

        if (response.bids.len == 0 or response.asks.len == 0) continue;

        // Convert to scanner format
        var bids: std.ArrayList(arb_scanner.PriceLevel) = .empty;
        var asks: std.ArrayList(arb_scanner.PriceLevel) = .empty;

        for (response.bids) |bid| {
            try bids.append(allocator, .{ .price = bid.price, .amount = bid.amount });
        }
        for (response.asks) |ask| {
            try asks.append(allocator, .{ .price = ask.price, .amount = ask.amount });
        }

        try orderbooks.append(allocator, .{
            .exchange = try allocator.dupe(u8, exch),
            .pair = try allocator.dupe(u8, symbol),
            .bids = try bids.toOwnedSlice(allocator),
            .asks = try asks.toOwnedSlice(allocator),
            .timestamp = now,
            .api_rtt_ms = 50, // Placeholder
        });
    }

    if (orderbooks.items.len == 0) {
        return errResp(allocator, 404, "Not Found", "No orderbook data available for symbol");
    }

    // Run scan
    try scanner.scanAll(orderbooks.items);

    // Format response
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"symbol\":\"");
    try json.appendSlice(allocator, symbol);
    try json.appendSlice(allocator, "\",\"scan_time_ms\":");
    const time_str = try std.fmt.allocPrint(allocator, "{d}", .{std.time.milliTimestamp()});
    defer allocator.free(time_str);
    try json.appendSlice(allocator, time_str);
    try json.appendSlice(allocator, ",\"opportunities_found\":");
    const count_str = try std.fmt.allocPrint(allocator, "{d}", .{scanner.opportunities.items.len});
    defer allocator.free(count_str);
    try json.appendSlice(allocator, count_str);
    try json.appendSlice(allocator, ",\"results\":[");

    for (scanner.opportunities.items, 0..) |opp, i| {
        if (i > 0) try json.appendSlice(allocator, ",");

        try json.appendSlice(allocator, "{");
        try json.appendSlice(allocator, "\"type\":\"");
        try json.appendSlice(allocator, @tagName(opp.arb_type));
        try json.appendSlice(allocator, "\",\"pair\":\"");
        try json.appendSlice(allocator, opp.pair);
        try json.appendSlice(allocator, "\",\"exchange_a\":\"");
        try json.appendSlice(allocator, opp.exchange_a);
        try json.appendSlice(allocator, "\",\"exchange_b\":\"");
        try json.appendSlice(allocator, opp.exchange_b);
        try json.appendSlice(allocator, "\",\"gross_profit_pct\":");
        const gross_str = try std.fmt.allocPrint(allocator, "{d:.4}", .{opp.gross_profit_pct});
        defer allocator.free(gross_str);
        try json.appendSlice(allocator, gross_str);
        try json.appendSlice(allocator, ",\"net_profit_pct\":");
        const net_str = try std.fmt.allocPrint(allocator, "{d:.4}", .{opp.net_profit_pct});
        defer allocator.free(net_str);
        try json.appendSlice(allocator, net_str);
        try json.appendSlice(allocator, ",\"confidence\":");
        const conf_str = try std.fmt.allocPrint(allocator, "{d:.2}", .{opp.confidence});
        defer allocator.free(conf_str);
        try json.appendSlice(allocator, conf_str);
        try json.appendSlice(allocator, ",\"action\":\"");
        try json.appendSlice(allocator, opp.action);
        try json.appendSlice(allocator, "\",\"details\":\"");
        try json.appendSlice(allocator, opp.details);
        try json.appendSlice(allocator, "\"}");
    }

    try json.appendSlice(allocator, "]}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleAdminPopulateGroupedPairs(allocator: mem.Allocator) ![]u8 {
    // First, clear old grouped pairs
    global_db.clearGroupedPairs() catch |err| {
        std.debug.print("[ADMIN] WARNING: Failed to clear grouped_pairs: {}\n", .{err});
    };

    // Use the same logic as handleArbitrageScanAll to fetch and group pairs
    const exchanges = [_][]const u8{ "lcx", "kraken", "coinbase" };

    var all_pairs_per_exchange: [3][][]const u8 = undefined;
    defer {
        for (all_pairs_per_exchange) |ex_pairs| {
            for (ex_pairs) |pair| {
                allocator.free(pair);
            }
            allocator.free(ex_pairs);
        }
    }

    for (exchanges, 0..) |exchange, ex_idx| {
        const db_pairs = global_db.getPairsForExchange(allocator, exchange) catch |err| {
            std.debug.print("[ADMIN] WARNING: Failed to get pairs for {s}: {}\n", .{ exchange, err });
            all_pairs_per_exchange[ex_idx] = &[_][]const u8{};
            continue;
        };
        all_pairs_per_exchange[ex_idx] = db_pairs;
    }

    const PairGroup = struct {
        exchange_flags: u32,
        pairs: std.ArrayList([]const u8),
    };

    var base_asset_map: std.StringHashMap(PairGroup) = std.StringHashMap(PairGroup).init(allocator);
    defer {
        var it = base_asset_map.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            for (entry.value_ptr.*.pairs.items) |pair| {
                allocator.free(pair);
            }
            entry.value_ptr.*.pairs.deinit(allocator);
        }
        base_asset_map.deinit();
    }

    for (all_pairs_per_exchange, 0..) |ex_pairs, ex_idx| {
        const exchange_bit: u32 = @as(u32, 1) << @intCast(ex_idx);

        for (ex_pairs) |pair| {
            if (std.mem.indexOf(u8, pair, "/")) |slash_pos| {
                const base = pair[0..slash_pos];
                const quote = pair[slash_pos + 1 ..];

                var quote_group: []const u8 = undefined;
                if (std.mem.eql(u8, quote, "USD") or std.mem.eql(u8, quote, "USDC")) {
                    quote_group = "USD_LIKE";
                } else if (std.mem.eql(u8, quote, "EUR")) {
                    quote_group = "EUR";
                } else {
                    continue;
                }

                const key = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base, quote_group });
                defer allocator.free(key);

                if (base_asset_map.getPtr(key)) |group_ptr| {
                    group_ptr.exchange_flags |= exchange_bit;
                    try group_ptr.pairs.append(allocator, try allocator.dupe(u8, pair));
                } else {
                    var new_list: std.ArrayList([]const u8) = .empty;
                    try new_list.append(allocator, try allocator.dupe(u8, pair));

                    const new_group: PairGroup = .{
                        .exchange_flags = exchange_bit,
                        .pairs = new_list,
                    };
                    try base_asset_map.put(try allocator.dupe(u8, key), new_group);
                }
            }
        }
    }

    var usd_count: usize = 0;
    var eur_count: usize = 0;

    // Save ALL pairs grouped by quote (regardless of exchange count)
    var it = base_asset_map.iterator();
    while (it.next()) |entry| {
        const base_key = entry.key_ptr.*;
        const group = entry.value_ptr.*;

        for (group.pairs.items) |pair| {
            if (std.mem.endsWith(u8, base_key, "USD_LIKE")) {
                global_db.saveGroupedPair(pair, "USD_USDC") catch |err| {
                    std.debug.print("[ADMIN] ERROR: Failed to save USD pair {s}: {}\n", .{ pair, err });
                };
                usd_count += 1;
            } else if (std.mem.endsWith(u8, base_key, "EUR")) {
                global_db.saveGroupedPair(pair, "EUR") catch |err| {
                    std.debug.print("[ADMIN] ERROR: Failed to save EUR pair {s}: {}\n", .{ pair, err });
                };
                eur_count += 1;
            }
        }
    }

    std.debug.print("[ADMIN] ✓ Saved {d} USD/USDC pairs and {d} EUR pairs to grouped_pairs table\n", .{ usd_count, eur_count });

    // Build response
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"status\":\"✅ Database populated\",\"usd_pairs\":");
    const usd_str = try std.fmt.allocPrint(allocator, "{d}", .{usd_count});
    defer allocator.free(usd_str);
    try json.appendSlice(allocator, usd_str);

    try json.appendSlice(allocator, ",\"eur_pairs\":");
    const eur_str = try std.fmt.allocPrint(allocator, "{d}", .{eur_count});
    defer allocator.free(eur_str);
    try json.appendSlice(allocator, eur_str);

    try json.appendSlice(allocator, ",\"total_pairs\":");
    const total_str = try std.fmt.allocPrint(allocator, "{d}", .{usd_count + eur_count});
    defer allocator.free(total_str);
    try json.appendSlice(allocator, total_str);

    try json.appendSlice(allocator, ",\"message\":\"Grouped pairs saved to database\"}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

fn handleArbitrageScanAll(allocator: mem.Allocator) ![]u8 {
    // Fetch pre-grouped pairs from database
    const usd_grouped = global_db.getGroupedPairs(allocator, "USD_USDC") catch |err| {
        std.debug.print("[ARBITRAGE-SCAN-ALL] ERROR: Failed to fetch USD_USDC pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch USD/USDC pairs");
    };
    defer {
        for (usd_grouped) |gp| {
            gp.deinit(allocator);
        }
        allocator.free(usd_grouped);
    }

    const eur_grouped = global_db.getGroupedPairs(allocator, "EUR") catch |err| {
        std.debug.print("[ARBITRAGE-SCAN-ALL] ERROR: Failed to fetch EUR pairs: {}\n", .{err});
        return errResp(allocator, 500, "Database error", "Failed to fetch EUR pairs");
    };
    defer {
        for (eur_grouped) |gp| {
            gp.deinit(allocator);
        }
        allocator.free(eur_grouped);
    }

    std.debug.print("[ARBITRAGE-SCAN-ALL] Loaded {d} USD/USDC pairs and {d} EUR pairs from database\n", .{ usd_grouped.len, eur_grouped.len });

    // Build JSON response
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"scan_time_ms\":");
    const time_str = try std.fmt.allocPrint(allocator, "{d}", .{std.time.milliTimestamp()});
    defer allocator.free(time_str);
    try json.appendSlice(allocator, time_str);

    try json.appendSlice(allocator, ",\"groups\":{\"USD_USDC\":{\"pair_count\":");
    const usd_count = try std.fmt.allocPrint(allocator, "{d}", .{usd_grouped.len});
    defer allocator.free(usd_count);
    try json.appendSlice(allocator, usd_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (usd_grouped, 0..) |gp, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, gp.pair);
        try json.appendSlice(allocator, "\"}");
    }

    try json.appendSlice(allocator, "]},\"EUR\":{\"pair_count\":");
    const eur_count = try std.fmt.allocPrint(allocator, "{d}", .{eur_grouped.len});
    defer allocator.free(eur_count);
    try json.appendSlice(allocator, eur_count);

    try json.appendSlice(allocator, ",\"pairs\":[");
    for (eur_grouped, 0..) |gp, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "{\"pair\":\"");
        try json.appendSlice(allocator, gp.pair);
        try json.appendSlice(allocator, "\"}");
    }

    try json.appendSlice(allocator, "]}},\"total_common_pairs\":");
    const total_pairs = try std.fmt.allocPrint(allocator, "{d}", .{usd_grouped.len + eur_grouped.len});
    defer allocator.free(total_pairs);
    try json.appendSlice(allocator, total_pairs);

    try json.appendSlice(allocator, ",\"message\":\"✅ Arbitrage-ready pairs loaded from database\"}");

    const body = try allocator.dupe(u8, json.items);
    return okResp(allocator, 200, "OK", body);
}

/// Proxy requests to CoinGecko API with caching to avoid rate limiting
fn handleCoingeckoProxy(allocator: mem.Allocator, path_with_query: []const u8) ![]u8 {
    // Extract the CoinGecko endpoint from path
    // Input: "/public/coingecko/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    // We want: "api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    const prefix = "/public/coingecko/";
    const endpoint = if (std.mem.startsWith(u8, path_with_query, prefix))
        path_with_query[prefix.len..]
    else
        path_with_query;

    // Build the full CoinGecko URL
    const full_url = try std.fmt.allocPrint(
        allocator,
        "https://api.coingecko.com/{s}",
        .{endpoint},
    );
    defer allocator.free(full_url);

    // Check cache first
    {
        coingecko_cache_mutex.lock();
        defer coingecko_cache_mutex.unlock();

        const now = std.time.timestamp();
        for (coingecko_cache[0..coingecko_cache_count]) |entry| {
            if (std.mem.eql(u8, entry.url[0..entry.url_len], full_url)) {
                if (now - entry.timestamp < COINGECKO_CACHE_TTL) {
                    std.debug.print("[COINGECKO-CACHE] HIT: {s}\n", .{full_url});
                    const cached_body = try allocator.dupe(u8, entry.body[0..entry.body_len]);
                    return okResp(allocator, 200, "OK", cached_body);
                }
            }
        }
    }

    std.debug.print("[COINGECKO-PROXY] Proxying to: {s}\n", .{full_url});

    // Make the request to CoinGecko
    const headers = [_]std.http.Header{
        .{ .name = "Accept", .value = "application/json" },
    };

    var resp = http_client.get(allocator, full_url, &headers) catch |err| {
        std.debug.print("[COINGECKO-PROXY] Error: {}\n", .{err});
        return errResp(allocator, 503, "Service Unavailable", "CoinGecko API unreachable");
    };
    defer resp.deinit(allocator);

    // Cache and return the CoinGecko response
    if (resp.status == 200) {
        const body = try allocator.dupe(u8, resp.body);

        // Add to cache
        {
            coingecko_cache_mutex.lock();
            defer coingecko_cache_mutex.unlock();

            if (coingecko_cache_count < COINGECKO_CACHE_SIZE) {
                var entry = &coingecko_cache[coingecko_cache_count];

                // Copy URL (truncate if too long)
                const url_len = @min(full_url.len, entry.url.len - 1);
                @memcpy(entry.url[0..url_len], full_url[0..url_len]);
                entry.url_len = url_len;

                // Copy body (truncate if too long)
                const body_len = @min(resp.body.len, entry.body.len - 1);
                @memcpy(entry.body[0..body_len], resp.body[0..body_len]);
                entry.body_len = body_len;

                entry.timestamp = std.time.timestamp();
                coingecko_cache_count += 1;
            } else {
                // Cache full, shift entries and add new one
                const now = std.time.timestamp();
                var oldest_idx: usize = 0;
                var oldest_time = coingecko_cache[0].timestamp;

                // Find oldest entry
                for (1..coingecko_cache_count) |i| {
                    if (coingecko_cache[i].timestamp < oldest_time) {
                        oldest_idx = i;
                        oldest_time = coingecko_cache[i].timestamp;
                    }
                }

                // Replace oldest with new entry
                var entry = &coingecko_cache[oldest_idx];
                const url_len = @min(full_url.len, entry.url.len - 1);
                @memcpy(entry.url[0..url_len], full_url[0..url_len]);
                entry.url_len = url_len;

                const body_len = @min(resp.body.len, entry.body.len - 1);
                @memcpy(entry.body[0..body_len], resp.body[0..body_len]);
                entry.body_len = body_len;

                entry.timestamp = now;
            }
        }

        return okResp(allocator, 200, "OK", body);
    } else {
        const err_msg = try std.fmt.allocPrint(
            allocator,
            "CoinGecko returned HTTP {d}",
            .{resp.status},
        );
        defer allocator.free(err_msg);
        return errResp(allocator, resp.status, "Error", err_msg);
    }
}
