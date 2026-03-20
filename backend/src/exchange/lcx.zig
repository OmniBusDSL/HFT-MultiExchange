/// LCX Exchange REST API – CCXT-compatible implementation
///
/// Auth spec (2026, from docs.lcx.com):
///   requestString = METHOD + ENDPOINT + BODY
///   x-access-sign = Base64( HMAC-SHA256(requestString, api_secret) )
///   Headers: x-access-key, x-access-sign, x-access-timestamp (ms)
const std = @import("std");
const types = @import("types.zig");
const hc = @import("http_client.zig");
const json = @import("../utils/json.zig");

const BASE_URL = "https://exchange-api.lcx.com";

// ============================================================================
// Helper: LCX authentication signing
// ============================================================================

fn signRequest(
    allocator: std.mem.Allocator,
    method: []const u8,
    endpoint: []const u8,
    body: []const u8,
    api_secret: []const u8,
) ![2][]u8 {
    const ts_ms = std.time.milliTimestamp();
    const ts_str = try std.fmt.allocPrint(allocator, "{d}", .{ts_ms});

    // requestString = METHOD + ENDPOINT + BODY (NO timestamp in signature)
    const request_str = try std.fmt.allocPrint(
        allocator,
        "{s}{s}{s}",
        .{ method, endpoint, body },
    );
    defer allocator.free(request_str);

    std.debug.print("[LCX] Method: {s}, Endpoint: {s}, Body: {s}\n", .{ method, endpoint, body });
    std.debug.print("[LCX] RequestString: {s}\n", .{request_str});

    // HMAC-SHA256
    var mac: [32]u8 = undefined;
    std.crypto.auth.hmac.sha2.HmacSha256.create(&mac, request_str, api_secret);

    // Base64 encode
    const Enc = std.base64.standard.Encoder;
    const sign_b64 = try allocator.alloc(u8, Enc.calcSize(32));
    _ = Enc.encode(sign_b64, &mac);

    std.debug.print("[LCX] Signature: {s}\n", .{sign_b64});

    return .{ ts_str, sign_b64 };
}

fn makePrivateRequest(
    allocator: std.mem.Allocator,
    method: []const u8,
    endpoint: []const u8,
    body: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
) !hc.Response {
    // Split endpoint into path and query string
    // Query params should NOT be included in signature, only in final URL
    const query_pos = std.mem.indexOf(u8, endpoint, "?");
    const endpoint_path = if (query_pos) |pos| endpoint[0..pos] else endpoint;
    const query_string = if (query_pos) |pos| endpoint[pos..] else "";

    std.debug.print("\n[LCX PRIVATE REQUEST]\n", .{});
    std.debug.print("  Endpoint (raw): {s}\n", .{endpoint});
    std.debug.print("  Path (for sig): {s}\n", .{endpoint_path});
    std.debug.print("  Query: {s}\n", .{query_string});
    std.debug.print("  Body: \"{s}\"\n", .{body});

    // Sign only with PATH, not query string (query params must NOT be in signature)
    // This matches LCX API spec and lcx-api.ts reference implementation
    const sig_data = try signRequest(allocator, method, endpoint_path, body, api_secret);
    defer allocator.free(sig_data[0]); // ts_str
    defer allocator.free(sig_data[1]); // sign_b64

    std.debug.print("  Timestamp: {s}\n", .{sig_data[0]});
    std.debug.print("  Signature: {s}\n", .{sig_data[1]});

    // URL includes query string, but signature only uses the path
    const url = try std.fmt.allocPrint(allocator, "{s}{s}{s}", .{ BASE_URL, endpoint_path, query_string });
    defer allocator.free(url);

    std.debug.print("  Final URL: {s}\n", .{url});

    const headers = [_]std.http.Header{
        .{ .name = "x-access-key", .value = api_key },
        .{ .name = "x-access-sign", .value = sig_data[1] },
        .{ .name = "x-access-timestamp", .value = sig_data[0] },
        .{ .name = "Content-Type", .value = "application/json" },
        .{ .name = "Accept", .value = "application/json" },
    };

    std.debug.print("  Headers: x-access-key={s}..., x-access-sign={s}..., x-access-timestamp={s}\n",
        .{ api_key[0..@min(8, api_key.len)], sig_data[1][0..@min(8, sig_data[1].len)], sig_data[0] });

    if (std.mem.eql(u8, method, "POST")) {
        return hc.post(allocator, url, &headers, body);
    } else if (std.mem.eql(u8, method, "GET")) {
        const resp = try hc.get(allocator, url, &headers);
        std.debug.print("  Response: {d} bytes, status={d}\n", .{ resp.body.len, resp.status });
        if (resp.body.len > 0 and resp.body.len < 200) {
            std.debug.print("  Response body: {s}\n", .{resp.body});
        }
        return resp;
    } else {
        return error.UnsupportedMethod;
    }
}

// ============================================================================
// Market Data
// ============================================================================

pub fn fetchMarkets(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
) ![]types.Market {
    // LCX /api/pairs endpoint (public) - https://docs.lcx.com/#tag/Market-API/paths/~1api~1pairs/get
    const url = BASE_URL ++ "/api/pairs";
    const headers: [0]std.http.Header = .{};

    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return try allocator.alloc(types.Market, 0);
    }

    // LCX response structure for /api/pairs endpoint
    const LcxMarketData = struct {
        Symbol: []const u8,
        Base: []const u8,
        Quote: []const u8,
    };

    const LcxMarketsResponse = struct {
        data: []LcxMarketData,
    };

    var parsed = std.json.parseFromSlice(
        LcxMarketsResponse,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[LCX] fetchMarkets JSON parse error: {}\n", .{err});
        return try allocator.alloc(types.Market, 0);
    };
    defer parsed.deinit();

    var markets = try allocator.alloc(types.Market, parsed.value.data.len);
    for (parsed.value.data, 0..) |data, i| {
        markets[i] = .{
            .id = try allocator.dupe(u8, data.Symbol),
            .symbol = try allocator.dupe(u8, data.Symbol),
            .base = try allocator.dupe(u8, data.Base),
            .quote = try allocator.dupe(u8, data.Quote),
            .baseId = try allocator.dupe(u8, data.Base),
            .quoteId = try allocator.dupe(u8, data.Quote),
            .active = true,
            .maker = 0.001, // LCX typical maker fee
            .taker = 0.001, // LCX typical taker fee
            .limits = .{
                .amount = .{ .min = 0.0001, .max = 1000000.0 },
                .price = .{ .min = 0, .max = 0 },
                .cost = .{ .min = 0, .max = 0 },
            },
            .info = resp.body,
        };
    }

    return markets;
}

pub fn fetchTicker(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
) !types.Ticker {
    // LCX /api/ticker/{symbol} endpoint (public)
    const url = try std.fmt.allocPrint(allocator, "{s}/api/ticker/{s}", .{ BASE_URL, symbol });
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return types.Ticker{
            .symbol = try allocator.dupe(u8, symbol),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .high = 0,
            .low = 0,
            .bid = 0,
            .bidVolume = 0,
            .ask = 0,
            .askVolume = 0,
            .vwap = 0,
            .open = 0,
            .close = 0,
            .last = 0,
            .previousClose = 0,
            .change = 0,
            .percentage = 0,
            .average = 0,
            .baseVolume = 0,
            .quoteVolume = 0,
            .info = resp.body,
        };
    }

    // LCX ticker response structure
    const LcxTickerData = struct {
        currentPrice: f64,
        dailyHigh: f64,
        dailyLow: f64,
        bestBid: f64,
        bestAsk: f64,
        dailyVolume: f64,
    };

    const LcxTickerResponse = struct {
        data: LcxTickerData,
    };

    var parsed = std.json.parseFromSlice(
        LcxTickerResponse,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[LCX] fetchTicker JSON parse error: {}\n", .{err});
        return types.Ticker{
            .symbol = try allocator.dupe(u8, symbol),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .high = 0,
            .low = 0,
            .bid = 0,
            .bidVolume = 0,
            .ask = 0,
            .askVolume = 0,
            .vwap = 0,
            .open = 0,
            .close = 0,
            .last = 0,
            .previousClose = 0,
            .change = 0,
            .percentage = 0,
            .average = 0,
            .baseVolume = 0,
            .quoteVolume = 0,
            .info = resp.body,
        };
    };
    defer parsed.deinit();

    const data = parsed.value.data;
    return types.Ticker{
        .symbol = try allocator.dupe(u8, symbol),
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .high = data.dailyHigh,
        .low = data.dailyLow,
        .bid = data.bestBid,
        .bidVolume = 0,
        .ask = data.bestAsk,
        .askVolume = 0,
        .vwap = 0,
        .open = 0,
        .close = 0,
        .last = data.currentPrice,
        .previousClose = 0,
        .change = 0,
        .percentage = 0,
        .average = 0,
        .baseVolume = data.dailyVolume,
        .quoteVolume = 0,
        .info = resp.body,
    };
}

pub fn fetchTickers(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    _: ?[]const []const u8,
) ![]types.Ticker {
    // LCX /api/tickers endpoint (public) - returns all tickers
    const url = BASE_URL ++ "/api/tickers";
    const headers: [0]std.http.Header = .{};

    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return try allocator.alloc(types.Ticker, 0);
    }

    // LCX tickers response is dynamic - data is an object with pair names as keys
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[LCX] fetchTickers JSON parse error: {}\n", .{err});
        std.debug.print("[LCX] Response body: {s}\n", .{resp.body[0..@min(resp.body.len, 500)]});
        return try allocator.alloc(types.Ticker, 0);
    };
    defer parsed.deinit();

    // Get the "data" object
    const data_value = parsed.value.object.get("data") orelse return try allocator.alloc(types.Ticker, 0);
    const data_obj = data_value.object;

    // Count pairs
    var count: usize = 0;
    var iter = data_obj.iterator();
    while (iter.next()) |_| {
        count += 1;
    }

    var tickers = try allocator.alloc(types.Ticker, count);
    var idx: usize = 0;

    // Iterate over the pairs
    iter = data_obj.iterator();
    while (iter.next()) |entry| {
        const symbol = entry.key_ptr.*;
        const ticker_value = entry.value_ptr.*;

        var bestAsk: f64 = 0;
        var bestBid: f64 = 0;

        // Extract bestAsk
        if (ticker_value.object.get("bestAsk")) |val| {
            if (val == .float) {
                bestAsk = val.float;
            } else if (val == .integer) {
                bestAsk = @floatFromInt(val.integer);
            }
        }
        // Extract bestBid
        if (ticker_value.object.get("bestBid")) |val| {
            if (val == .float) {
                bestBid = val.float;
            } else if (val == .integer) {
                bestBid = @floatFromInt(val.integer);
            }
        }

        // Calculate midpoint as "last" price
        const last = (bestBid + bestAsk) / 2.0;

        tickers[idx] = .{
            .symbol = try allocator.dupe(u8, symbol),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .high = 0,
            .low = 0,
            .bid = bestBid,
            .bidVolume = 0,
            .ask = bestAsk,
            .askVolume = 0,
            .vwap = 0,
            .open = 0,
            .close = last,
            .last = last,
            .previousClose = 0,
            .change = 0,
            .percentage = 0,
            .average = (bestBid + bestAsk) / 2.0,
            .baseVolume = 0,
            .quoteVolume = 0,
            .info = resp.body,
        };
        idx += 1;
    }

    return tickers;
}

pub fn fetchOHLCV(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
    timeframe: []const u8,
    _: ?i64,
    _: ?i64,
) !types.OHLCVArray {
    // LCX /api/candles endpoint
    // Response: {"data": [{"timestamp": 1234567890000, "open": 54000, "high": 55000, "low": 53000, "close": 54500, "volume": 1.5}, ...]}
    const url = try std.fmt.allocPrint(allocator, "{s}/api/candles?symbol={s}&interval={s}", .{ BASE_URL, symbol, timeframe });
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[LCX] fetchOHLCV HTTP error: status={}, body={s}\n", .{ resp.status, resp.body[0..@min(resp.body.len, 200)] });
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }

    // Parse response: {"data": [candle_objects]}
    const array_content_opt = json.getArrayContent(allocator, resp.body, "data") catch null;
    if (array_content_opt == null) {
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }
    const array_content = array_content_opt.?;

    var ohlcv_list: std.ArrayList(types.OHLCV) = .empty;

    var idx: usize = 0;
    while (json.getNextArrayObject(array_content, idx)) |obj_result| {
        const obj = obj_result.object;
        idx = obj_result.next_idx;

        var timestamp: i64 = 0;
        var open_price: f64 = 0;
        var high_price: f64 = 0;
        var low_price: f64 = 0;
        var close_price: f64 = 0;
        var volume: f64 = 0;

        // Parse fields
        if (json.getNumberValue(obj, "timestamp") catch null) |ts| {
            timestamp = @intFromFloat(ts);
        }

        if (json.getNumberValue(obj, "open") catch null) |o| {
            open_price = o;
        }

        if (json.getNumberValue(obj, "high") catch null) |h| {
            high_price = h;
        }

        if (json.getNumberValue(obj, "low") catch null) |l| {
            low_price = l;
        }

        if (json.getNumberValue(obj, "close") catch null) |c| {
            close_price = c;
        }

        if (json.getNumberValue(obj, "volume") catch null) |v| {
            volume = v;
        }

        try ohlcv_list.append(allocator, types.OHLCV{
            .timestamp = timestamp,
            .open = open_price,
            .high = high_price,
            .low = low_price,
            .close = close_price,
            .volume = volume,
        });
    }

    return types.OHLCVArray{ .data = try ohlcv_list.toOwnedSlice(allocator) };
}

pub fn fetchOrderBook(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
    _: ?i64,
) !types.OrderBook {
    // LCX /api/book?pair={symbol} endpoint
    const url = try std.fmt.allocPrint(allocator, "{s}/api/book?pair={s}", .{ BASE_URL, symbol });
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[LCX] fetchOrderBook HTTP error: status={}\n", .{resp.status});
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    // Parse response: {"data": {"buy": [[price, amount], ...], "sell": [[price, amount], ...]}}
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[LCX] fetchOrderBook JSON parse error: {}\n", .{err});
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    };
    defer parsed.deinit();

    // Extract data object
    const data_val = parsed.value.object.get("data") orelse return types.OrderBook{
        .symbol = try allocator.dupe(u8, symbol),
        .bids = try allocator.alloc(types.PriceLevel, 0),
        .asks = try allocator.alloc(types.PriceLevel, 0),
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .nonce = 0,
    };

    if (data_val != .object) {
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    // Parse bids (from "buy" array)
    var bids: []types.PriceLevel = undefined;
    if (data_val.object.get("buy")) |buy_val| {
        if (buy_val == .array) {
            bids = try allocator.alloc(types.PriceLevel, buy_val.array.items.len);
            for (buy_val.array.items, 0..) |item, i| {
                if (item == .array and item.array.items.len >= 2) {
                    const price = if (item.array.items[0] == .float)
                        item.array.items[0].float
                    else if (item.array.items[0] == .integer)
                        @as(f64, @floatFromInt(item.array.items[0].integer))
                    else
                        0;
                    const amount = if (item.array.items[1] == .float)
                        item.array.items[1].float
                    else if (item.array.items[1] == .integer)
                        @as(f64, @floatFromInt(item.array.items[1].integer))
                    else
                        0;
                    bids[i] = .{ .price = price, .amount = amount };
                }
            }
        } else {
            bids = try allocator.alloc(types.PriceLevel, 0);
        }
    } else {
        bids = try allocator.alloc(types.PriceLevel, 0);
    }

    // Parse asks (from "sell" array)
    var asks: []types.PriceLevel = undefined;
    if (data_val.object.get("sell")) |sell_val| {
        if (sell_val == .array) {
            asks = try allocator.alloc(types.PriceLevel, sell_val.array.items.len);
            for (sell_val.array.items, 0..) |item, i| {
                if (item == .array and item.array.items.len >= 2) {
                    const price = if (item.array.items[0] == .float)
                        item.array.items[0].float
                    else if (item.array.items[0] == .integer)
                        @as(f64, @floatFromInt(item.array.items[0].integer))
                    else
                        0;
                    const amount = if (item.array.items[1] == .float)
                        item.array.items[1].float
                    else if (item.array.items[1] == .integer)
                        @as(f64, @floatFromInt(item.array.items[1].integer))
                    else
                        0;
                    asks[i] = .{ .price = price, .amount = amount };
                }
            }
        } else {
            asks = try allocator.alloc(types.PriceLevel, 0);
        }
    } else {
        asks = try allocator.alloc(types.PriceLevel, 0);
    }

    return types.OrderBook{
        .symbol = try allocator.dupe(u8, symbol),
        .bids = bids,
        .asks = asks,
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .nonce = 0,
    };
}

pub fn fetchTrades(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
    _: ?i64,
    _: ?i64,
) !types.TradeArray {
    const url = try std.fmt.allocPrint(allocator, "{s}/api/trades/{s}", .{ BASE_URL, symbol });
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
}

// ============================================================================
// Account
// ============================================================================

const LcxBalance = struct {
    freeBalance: f64,
    occupiedBalance: f64,
    totalBalance: f64,
};

const LcxBalanceEntry = struct {
    coin: []const u8,
    balance: LcxBalance,
    equivalentUSDBalance: LcxBalance,
    fullName: []const u8,
    coinType: []const u8,
    isRegionRestriction: bool,
};

const LcxBalanceResponse = struct {
    data: []LcxBalanceEntry,
    message: []const u8,
    status: []const u8,
};

pub fn fetchBalance(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) !types.BalanceMap {
    var resp = try makePrivateRequest(
        allocator,
        "GET",
        "/api/balances",
        "{}",
        api_key,
        api_secret,
    );
    defer resp.deinit(allocator);

    std.debug.print("[LCX] HTTP Status: {d}\n", .{resp.status});
    std.debug.print("[LCX] Response body ({d} bytes): {s}\n", .{ resp.body.len, resp.body[0..@min(500, resp.body.len)] });

    if (resp.status != 200) {
        std.debug.print("[LCX] Error: non-200 status\n", .{});
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    }

    // Parse JSON response

    var parsed = std.json.parseFromSlice(
        LcxBalanceResponse,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[LCX] JSON parse error: {}\n", .{err});
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    defer parsed.deinit();

    // Build Balance array
    var balances = try allocator.alloc(types.Balance, parsed.value.data.len);
    var total_free: f64 = 0;
    var total_used: f64 = 0;

    for (parsed.value.data, 0..) |entry, i| {
        // Get the total balance from the crypto balance
        const total = entry.balance.totalBalance;
        const free = entry.balance.freeBalance;
        const used = entry.balance.occupiedBalance;

        // Skip entries with zero balance
        if (total == 0) {
            balances[i] = .{
                .currency = try allocator.dupe(u8, entry.coin),
                .free = 0,
                .used = 0,
                .total = 0,
                .info = try allocator.dupe(u8, ""),
            };
            continue;
        }

        total_free += free;
        total_used += used;

        balances[i] = .{
            .currency = try allocator.dupe(u8, entry.coin),
            .free = free,
            .used = used,
            .total = total,
            .info = try allocator.dupe(u8, resp.body),
        };
    }

    return types.BalanceMap{
        .balances = balances,
        .free = total_free,
        .used = total_used,
        .total = total_free + total_used,
    };
}

// ============================================================================
// Trading
// ============================================================================

pub fn createOrder(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    order_type: []const u8,
    side: []const u8,
    amount: f64,
    price: ?f64,
) !types.Order {
    const body = if (price) |p|
        try std.fmt.allocPrint(allocator,
            "{{\"symbol\":\"{s}\",\"type\":\"{s}\",\"side\":\"{s}\",\"amount\":{d},\"price\":{d}}}",
            .{ symbol, order_type, side, amount, p })
    else
        try std.fmt.allocPrint(allocator,
            "{{\"symbol\":\"{s}\",\"type\":\"{s}\",\"side\":\"{s}\",\"amount\":{d}}}",
            .{ symbol, order_type, side, amount });
    defer allocator.free(body);

    var resp = try makePrivateRequest(
        allocator,
        "POST",
        "/api/orders",
        body,
        api_key,
        api_secret,
    );
    defer resp.deinit(allocator);

    // Parse response: {"data": {"id": "order-uuid", "status": "open", "price": 54000, "amount": 0.5}}
    var order_id = try allocator.dupe(u8, "");
    var order_status = try allocator.dupe(u8, "open");

    // Try to extract order ID from data.id
    const id_opt = json.getNestedStringValue(allocator, resp.body, "data.id") catch null;
    if (id_opt) |id| {
        allocator.free(order_id);
        order_id = try allocator.dupe(u8, id);
    }

    // Try to extract status from data.status
    const status_opt = json.getStringValue(allocator, resp.body, "status") catch null;
    if (status_opt) |status| {
        allocator.free(order_status);
        order_status = try allocator.dupe(u8, status);
    }

    return types.Order{
        .id = order_id,
        .clientOrderId = null,
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .lastTradeTimestamp = null,
        .lastUpdateTimestamp = null,
        .symbol = try allocator.dupe(u8, symbol),
        .type = try allocator.dupe(u8, order_type),
        .side = try allocator.dupe(u8, side),
        .price = price orelse 0,
        .amount = amount,
        .cost = (price orelse 0) * amount,
        .average = 0,
        .filled = 0,
        .remaining = amount,
        .status = order_status,
        .fee = null,
        .trades = try allocator.alloc(types.Trade, 0),
        .info = try allocator.dupe(u8, resp.body),
    };
}

pub fn cancelOrder(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    order_id: []const u8,
    _: []const u8,
) !types.Order {
    const body = try std.fmt.allocPrint(allocator, "{{\"id\":\"{s}\"}}", .{order_id});
    defer allocator.free(body);

    var resp = try makePrivateRequest(
        allocator,
        "POST",
        "/api/orders/cancel",
        body,
        api_key,
        api_secret,
    );
    defer resp.deinit(allocator);

    // Parse response: {"data": {"id": "order-uuid", "status": "CANCELLED"}}
    // For LCX, if we get a successful response, the order is canceled
    var cancel_status = try allocator.dupe(u8, "canceled");

    const status_opt = json.getStringValue(allocator, resp.body, "status") catch null;
    if (status_opt) |status| {
        allocator.free(cancel_status);
        cancel_status = try allocator.dupe(u8, status);
    }

    return types.Order{
        .id = try allocator.dupe(u8, order_id),
        .clientOrderId = null,
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .lastTradeTimestamp = null,
        .lastUpdateTimestamp = null,
        .symbol = try allocator.dupe(u8, ""),
        .type = try allocator.dupe(u8, ""),
        .side = try allocator.dupe(u8, ""),
        .price = 0,
        .amount = 0,
        .cost = 0,
        .average = 0,
        .filled = 0,
        .remaining = 0,
        .status = cancel_status,
        .fee = null,
        .trades = try allocator.alloc(types.Trade, 0),
        .info = try allocator.dupe(u8, resp.body),
    };
}

pub fn fetchOpenOrders(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    _: ?[]const u8,
) !types.OrderArray {
    // LCX /api/open endpoint requires offset parameter
    // Signature: GET/api/open{} (query string NOT in signature, only in URL)
    std.debug.print("\n========== LCX fetchOpenOrders CALLED ==========\n", .{});

    // CCXT reference: offset starts at 1, not 0
    const endpoint = "/api/open?offset=1";
    var resp = try makePrivateRequest(
        allocator,
        "GET",
        endpoint,
        "{}",
        api_key,
        api_secret,
    );
    defer resp.deinit(allocator);

    std.debug.print("\n[LCX] fetchOpenOrders RESPONSE:\n", .{});
    std.debug.print("  Status: {d}\n", .{resp.status});
    std.debug.print("  Body length: {d}\n", .{resp.body.len});
    if (resp.body.len > 0) {
        std.debug.print("  Body: {s}\n", .{resp.body});
    }

    if (resp.status != 200) {
        std.debug.print("[LCX] ERROR: HTTP {d} response\n", .{resp.status});
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }

    // Parse response: {"data": [{"Id": "xxx", "Pair": "BTC/EUR", "Side": "BUY", "Price": 54000, "Amount": 0.5, "Status": "OPEN"}, ...]}
    const array_content_opt = json.getArrayContent(allocator, resp.body, "data") catch |err| {
        std.debug.print("[LCX] ERROR: Failed to extract 'data' array: {}\n", .{err});
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    if (array_content_opt == null) {
        std.debug.print("[LCX] ERROR: 'data' array is null\n", .{});
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }
    const array_content = array_content_opt.?;

    var orders: std.ArrayList(types.Order) = .empty;
    defer {
        for (orders.items) |order| {
            allocator.free(order.symbol);
            allocator.free(order.side);
            allocator.free(order.type);
            allocator.free(order.status);
            allocator.free(order.info);
            allocator.free(order.datetime);
            if (order.clientOrderId) |id| allocator.free(id);
            allocator.free(order.trades);
        }
    }

    var idx: usize = 0;
    while (json.getNextArrayObject(array_content, idx)) |obj_result| {
        const obj = obj_result.object;
        idx = obj_result.next_idx;

        var order_id = try allocator.dupe(u8, "");
        var symbol = try allocator.dupe(u8, "");
        var side = try allocator.dupe(u8, "");
        var price: f64 = 0;
        var amount: f64 = 0;
        var status = try allocator.dupe(u8, "");

        // Parse fields (LCX API uses capitalized names: Id, Pair, Side, Price, Amount, Status)
        if (json.getStringValue(allocator, obj, "Id") catch null) |id| {
            allocator.free(order_id);
            order_id = try allocator.dupe(u8, id);
        }

        if (json.getStringValue(allocator, obj, "Pair") catch null) |sym| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, sym);
        }

        if (json.getStringValue(allocator, obj, "Side") catch null) |s| {
            allocator.free(side);
            // Convert uppercase Side to lowercase (BUY → buy, SELL → sell)
            var side_lower: [32]u8 = undefined;
            var side_len: usize = 0;
            for (s) |c| {
                if (side_len < 31) {
                    side_lower[side_len] = std.ascii.toLower(c);
                    side_len += 1;
                }
            }
            side = try allocator.dupe(u8, side_lower[0..side_len]);
        }

        if (json.getNumberValue(obj, "Price") catch null) |p| {
            price = p;
        }

        if (json.getNumberValue(obj, "Amount") catch null) |a| {
            amount = a;
        }

        if (json.getStringValue(allocator, obj, "Status") catch null) |s| {
            allocator.free(status);
            // Convert uppercase Status to lowercase (OPEN → open, CLOSED → closed)
            var status_lower: [32]u8 = undefined;
            var status_len: usize = 0;
            for (s) |c| {
                if (status_len < 31) {
                    status_lower[status_len] = std.ascii.toLower(c);
                    status_len += 1;
                }
            }
            status = try allocator.dupe(u8, status_lower[0..status_len]);
        }

        try orders.append(allocator, types.Order{
            .id = order_id,
            .clientOrderId = null,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .lastTradeTimestamp = null,
            .lastUpdateTimestamp = null,
            .symbol = symbol,
            .type = try allocator.dupe(u8, "limit"),
            .side = side,
            .price = price,
            .amount = amount,
            .cost = price * amount,
            .average = 0,
            .filled = 0,
            .remaining = amount,
            .status = status,
            .fee = null,
            .trades = try allocator.alloc(types.Trade, 0),
            .info = try allocator.dupe(u8, ""),
        });
    }

    return types.OrderArray{ .data = try orders.toOwnedSlice(allocator) };
}

pub fn fetchClosedOrders(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    _: ?[]const u8,
) !types.OrderArray {
    // LCX /api/orderHistory endpoint - CCXT reference uses offset=1, not 0
    // Signature: GET/api/orderHistory{} (query string NOT in signature, only in URL)
    const endpoint = "/api/orderHistory?offset=1";
    var resp = try makePrivateRequest(
        allocator,
        "GET",
        endpoint,
        "{}",
        api_key,
        api_secret,
    );
    defer resp.deinit(allocator);

    // Parse response: {"data": [{"Id": "xxx", "Pair": "BTC/EUR", "Side": "BUY", "Price": 54000, "Amount": 0.5, "Status": "CLOSED"}, ...]}
    const array_content_opt = json.getArrayContent(allocator, resp.body, "data") catch null;
    if (array_content_opt == null) {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }
    const array_content = array_content_opt.?;

    var orders: std.ArrayList(types.Order) = .empty;
    defer {
        for (orders.items) |order| {
            allocator.free(order.symbol);
            allocator.free(order.side);
            allocator.free(order.type);
            allocator.free(order.status);
            allocator.free(order.info);
            allocator.free(order.datetime);
            if (order.clientOrderId) |id| allocator.free(id);
            allocator.free(order.trades);
        }
    }

    var idx: usize = 0;
    while (json.getNextArrayObject(array_content, idx)) |obj_result| {
        const obj = obj_result.object;
        idx = obj_result.next_idx;

        var order_id = try allocator.dupe(u8, "");
        var symbol = try allocator.dupe(u8, "");
        var side = try allocator.dupe(u8, "");
        var price: f64 = 0;
        var amount: f64 = 0;
        var status = try allocator.dupe(u8, "");

        if (json.getStringValue(allocator, obj, "Id") catch null) |id| {
            allocator.free(order_id);
            order_id = try allocator.dupe(u8, id);
        }

        if (json.getStringValue(allocator, obj, "Pair") catch null) |sym| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, sym);
        }

        if (json.getStringValue(allocator, obj, "Side") catch null) |s| {
            allocator.free(side);
            // Convert uppercase Side to lowercase (BUY → buy, SELL → sell)
            var side_lower: [32]u8 = undefined;
            var side_len: usize = 0;
            for (s) |c| {
                if (side_len < 31) {
                    side_lower[side_len] = std.ascii.toLower(c);
                    side_len += 1;
                }
            }
            side = try allocator.dupe(u8, side_lower[0..side_len]);
        }

        if (json.getNumberValue(obj, "Price") catch null) |p| {
            price = p;
        }

        if (json.getNumberValue(obj, "Amount") catch null) |a| {
            amount = a;
        }

        if (json.getStringValue(allocator, obj, "Status") catch null) |s| {
            allocator.free(status);
            // Convert uppercase Status to lowercase (OPEN → open, CLOSED → closed)
            var status_lower: [32]u8 = undefined;
            var status_len: usize = 0;
            for (s) |c| {
                if (status_len < 31) {
                    status_lower[status_len] = std.ascii.toLower(c);
                    status_len += 1;
                }
            }
            status = try allocator.dupe(u8, status_lower[0..status_len]);
        }

        try orders.append(allocator, types.Order{
            .id = order_id,
            .clientOrderId = null,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .lastTradeTimestamp = null,
            .lastUpdateTimestamp = null,
            .symbol = symbol,
            .type = try allocator.dupe(u8, "limit"),
            .side = side,
            .price = price,
            .amount = amount,
            .cost = price * amount,
            .average = 0,
            .filled = 0,
            .remaining = 0,
            .status = status,
            .fee = null,
            .trades = try allocator.alloc(types.Trade, 0),
            .info = try allocator.dupe(u8, ""),
        });
    }

    return types.OrderArray{ .data = try orders.toOwnedSlice(allocator) };
}

pub fn fetchMyTrades(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    _: ?[]const u8,
) !types.TradeArray {
    // Signature: GET/api/uHistory{}
    var resp = try makePrivateRequest(
        allocator,
        "GET",
        "/api/uHistory",
        "{}",
        api_key,
        api_secret,
    );
    defer resp.deinit(allocator);

    // Parse response: {"data": [{"Id": "xxx", "Pair": "BTC/EUR", "Side": "BUY", "Price": 54000, "Amount": 0.5, "Fee": 0.001, "UpdatedAt": 1234567890}, ...]}
    const array_content_opt = json.getArrayContent(allocator, resp.body, "data") catch null;
    if (array_content_opt == null) {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    }
    const array_content = array_content_opt.?;

    var trades: std.ArrayList(types.Trade) = .empty;
    defer {
        for (trades.items) |trade| {
            allocator.free(trade.id);
            allocator.free(trade.symbol);
            allocator.free(trade.side);
            if (trade.fee) |_| allocator.free(trade.info);
        }
    }

    var idx: usize = 0;
    while (json.getNextArrayObject(array_content, idx)) |obj_result| {
        const obj = obj_result.object;
        idx = obj_result.next_idx;

        var trade_id = try allocator.dupe(u8, "");
        var symbol = try allocator.dupe(u8, "");
        var side = try allocator.dupe(u8, "");
        var price: f64 = 0;
        var amount: f64 = 0;
        var fee: ?f64 = null;
        var timestamp: i64 = 0;

        if (json.getStringValue(allocator, obj, "Id") catch null) |id| {
            allocator.free(trade_id);
            trade_id = try allocator.dupe(u8, id);
        }

        if (json.getStringValue(allocator, obj, "Pair") catch null) |sym| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, sym);
        }

        if (json.getStringValue(allocator, obj, "Side") catch null) |s| {
            allocator.free(side);
            // Convert uppercase Side to lowercase (BUY → buy, SELL → sell)
            var side_lower: [32]u8 = undefined;
            var side_len: usize = 0;
            for (s) |c| {
                if (side_len < 31) {
                    side_lower[side_len] = std.ascii.toLower(c);
                    side_len += 1;
                }
            }
            side = try allocator.dupe(u8, side_lower[0..side_len]);
        }

        if (json.getNumberValue(obj, "Price") catch null) |p| {
            price = p;
        }

        if (json.getNumberValue(obj, "Amount") catch null) |a| {
            amount = a;
        }

        if (json.getNumberValue(obj, "Fee") catch null) |f| {
            fee = f;
        }

        if (json.getNumberValue(obj, "UpdatedAt") catch null) |ts| {
            timestamp = @intFromFloat(ts);
        }

        try trades.append(allocator, types.Trade{
            .id = trade_id,
            .timestamp = timestamp,
            .datetime = try allocator.dupe(u8, ""),
            .symbol = symbol,
            .type = try allocator.dupe(u8, ""),
            .side = side,
            .price = price,
            .amount = amount,
            .cost = price * amount,
            .fee = fee,
            .info = try allocator.dupe(u8, ""),
        });
    }

    return types.TradeArray{ .data = try trades.toOwnedSlice(allocator) };
}

// ============================================================================
// Testing
// ============================================================================

pub fn testConnection(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) !types.TestResult {
    var resp = makePrivateRequest(allocator, "GET", "/api/balances", "{}", api_key, api_secret) catch |err| {
        return types.TestResult.failFmt(allocator, "LCX connection failed: {}", .{err});
    };
    defer resp.deinit(allocator);

    std.debug.print("[LCX] Status: {d}\n", .{resp.status});
    std.debug.print("[LCX] Response body ({d} bytes):\n{s}\n", .{
        resp.body.len,
        resp.body[0..@min(500, resp.body.len)],
    });

    if (resp.status == 500 and std.mem.indexOf(u8, resp.body, "Incorrect API keys") != null) {
        return types.TestResult.fail(allocator, "LCX: Invalid API key or secret");
    }

    return switch (resp.status) {
        200 => types.TestResult.ok(allocator, "LCX: API key valid, connection successful"),
        401, 403 => types.TestResult.fail(allocator, "LCX: Invalid API key or signature"),
        404 => types.TestResult.fail(allocator, "LCX: Endpoint not found"),
        else => types.TestResult.failFmt(allocator, "LCX: HTTP {d} – {s}",
            .{ resp.status, resp.body[0..@min(80, resp.body.len)] }),
    };
}
