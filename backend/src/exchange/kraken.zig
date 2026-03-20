/// Kraken Exchange REST API – CCXT-compatible implementation
/// Auth (per official Kraken docs):
///   nonce = millisecond timestamp
///   post_data = "nonce=<nonce>"
///   sha256_msg = SHA256(nonce_str + post_data)
///   hmac_input = "/0/private/Balance" (bytes) ++ sha256_msg (bytes)
///   decoded_secret = Base64Decode(api_secret)
///   signature = Base64(HMAC-SHA512(hmac_input, decoded_secret))
const std = @import("std");
const types = @import("types.zig");
const hc = @import("http_client.zig");
const json = @import("../utils/json.zig");

const BASE_URL = "https://api.kraken.com";

// ============================================================================
// Helper: Kraken authentication signing
// ============================================================================

fn signRequest(
    allocator: std.mem.Allocator,
    path: []const u8,
    nonce_str: []const u8,
    post_data: []const u8,
    api_secret: []const u8,
) ![2][]u8 {
    std.debug.print("\n[KRAKEN-SIGN] ===== Signature Calculation Debug =====\n", .{});
    std.debug.print("[KRAKEN-SIGN] Path: {s}\n", .{path});
    std.debug.print("[KRAKEN-SIGN] Nonce: {s}\n", .{nonce_str});
    std.debug.print("[KRAKEN-SIGN] Post Data: {s}\n", .{post_data});

    // SHA256 of (nonce + post_data) as per Kraken spec
    const sha256_input = try std.mem.concat(allocator, u8, &[_][]const u8{ nonce_str, post_data });
    defer allocator.free(sha256_input);

    var sha256_hash: [32]u8 = undefined;
    hc.sha256(&sha256_hash, sha256_input);

    std.debug.print("[KRAKEN-SIGN] SHA256 hash: ", .{});
    for (sha256_hash) |b| std.debug.print("{x:0>2}", .{b});
    std.debug.print("\n", .{});

    // HMAC input = path_bytes ++ sha256_hash_bytes
    const hmac_input = try std.mem.concat(allocator, u8, &[_][]const u8{ path, sha256_hash[0..] });
    defer allocator.free(hmac_input);

    std.debug.print("[KRAKEN-SIGN] HMAC Input length: {d} bytes (path={d} + hash=32)\n", .{hmac_input.len, path.len});
    std.debug.print("[KRAKEN-SIGN] HMAC Input (hex): ", .{});
    for (hmac_input[0..@min(32, hmac_input.len)]) |b| std.debug.print("{x:0>2}", .{b});
    if (hmac_input.len > 32) std.debug.print("... ({d} bytes total)", .{hmac_input.len});
    std.debug.print("\n", .{});

    // Decode base64 api_secret
    const Decoder = std.base64.standard.Decoder;
    const decoded_len = Decoder.calcSizeForSlice(api_secret) catch return error.InvalidBase64;
    const decoded_secret = try allocator.alloc(u8, decoded_len);
    defer allocator.free(decoded_secret);
    Decoder.decode(decoded_secret, api_secret) catch return error.DecodingFailed;


    // HMAC-SHA512
    var hmac_out: [64]u8 = undefined;
    hc.hmacSha512(&hmac_out, hmac_input, decoded_secret);

    std.debug.print("[KRAKEN-SIGN] HMAC-SHA512 output (hex): ", .{});
    for (hmac_out[0..16]) |b| std.debug.print("{x:0>2}", .{b});
    std.debug.print("... ({d} bytes)\n", .{64});

    // Base64-encode signature
    const Encoder = std.base64.standard.Encoder;
    const sig_b64 = try allocator.alloc(u8, Encoder.calcSize(64));
    _ = Encoder.encode(sig_b64, &hmac_out);

    std.debug.print("[KRAKEN-SIGN] API-Sign (B64): {s}\n", .{sig_b64[0..@min(50, sig_b64.len)]});
    std.debug.print("[KRAKEN-SIGN] ===== End Debug =====\n\n", .{});

    // Duplicate post_data to owned allocation
    const post_data_owned = try allocator.dupe(u8, post_data);

    return .{ sig_b64, post_data_owned };
}

fn makePrivateRequest(
    allocator: std.mem.Allocator,
    path: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    extra_params: ?[]const u8,
) !hc.Response {
    std.debug.print("[KRAKEN-REQ] Starting Kraken private request\n", .{});

    const nonce = std.time.milliTimestamp();
    const nonce_str = try std.fmt.allocPrint(allocator, "{d}", .{nonce});
    defer allocator.free(nonce_str);

    std.debug.print("[KRAKEN-REQ] Nonce: {s}\n", .{nonce_str});

    const post_data = if (extra_params) |params|
        try std.fmt.allocPrint(allocator, "nonce={s}&{s}", .{ nonce_str, params })
    else
        try std.fmt.allocPrint(allocator, "nonce={s}", .{nonce_str});
    defer allocator.free(post_data);

    const sig_result = try signRequest(allocator, path, nonce_str, post_data, api_secret);
    const sig_b64 = sig_result[0];
    defer allocator.free(sig_b64);
    const post_data_owned = sig_result[1];
    defer allocator.free(post_data_owned);

    const url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ BASE_URL, path });
    defer allocator.free(url);

    std.debug.print("[KRAKEN-REQ] URL: {s}\n", .{url});
    std.debug.print("[KRAKEN-REQ] API-Key: {s}\n", .{api_key[0..@min(20, api_key.len)]});
    std.debug.print("[KRAKEN-REQ] Sending POST request...\n", .{});

    const headers = [_]std.http.Header{
        .{ .name = "API-Key", .value = api_key },
        .{ .name = "API-Sign", .value = sig_b64 },
        .{ .name = "Content-Type", .value = "application/x-www-form-urlencoded" },
    };

    return hc.post(allocator, url, &headers, post_data_owned);
}

// ============================================================================
// Market Data (Public)
// ============================================================================

pub fn fetchMarkets(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
) ![]types.Market {
    const url = BASE_URL ++ "/0/public/AssetPairs";
    const headers: [0]std.http.Header = .{};

    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return try allocator.alloc(types.Market, 0);
    }

    // Parse dynamic JSON response
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[KRAKEN] fetchMarkets JSON parse error: {}\n", .{err});
        return try allocator.alloc(types.Market, 0);
    };
    defer parsed.deinit();

    // Get result object
    const result = if (parsed.value.object.get("result")) |res| res.object else {
        std.debug.print("[KRAKEN] No result field in response\n", .{});
        return try allocator.alloc(types.Market, 0);
    };

    // Count valid markets first
    var count: usize = 0;
    var iter = result.iterator();
    while (iter.next()) |entry| {
        const pair_data = entry.value_ptr.*.object;
        if (pair_data.get("status")) |status| {
            if (status.string.len > 0 and !std.mem.eql(u8, status.string, "online")) {
                continue;
            }
        }
        count += 1;
    }

    // Allocate and populate markets array
    var markets = try allocator.alloc(types.Market, count);
    var idx: usize = 0;

    iter = result.iterator();
    while (iter.next()) |entry| {
        const pair_code = entry.key_ptr.*;
        const pair_data = entry.value_ptr.*.object;

        // Skip if status is not "online"
        if (pair_data.get("status")) |status| {
            if (status.string.len > 0 and !std.mem.eql(u8, status.string, "online")) {
                continue;
            }
        }

        const wsname = if (pair_data.get("wsname")) |v| v.string else pair_code;
        const base = if (pair_data.get("base")) |v| normalizeKrakenAsset(v.string) else "UNKNOWN";
        const quote = if (pair_data.get("quote")) |v| normalizeKrakenAsset(v.string) else "UNKNOWN";
        const ordermin_str = if (pair_data.get("ordermin")) |v| v.string else "0.00001";
        const ordermin = std.fmt.parseFloat(f64, ordermin_str) catch 0.00001;

        // Extract fees (maker_fee = fees_maker[0][1], taker_fee = fees[0][1])
        var maker_fee: f64 = 0.002;
        var taker_fee: f64 = 0.0026;

        if (pair_data.get("fees_maker")) |fm| {
            if (fm.array.items.len > 0 and fm.array.items[0].array.items.len > 1) {
                const fee_val = fm.array.items[0].array.items[1];
                if (fee_val == .float) {
                    maker_fee = fee_val.float;
                }
            }
        }

        if (pair_data.get("fees")) |f| {
            if (f.array.items.len > 0 and f.array.items[0].array.items.len > 1) {
                const fee_val = f.array.items[0].array.items[1];
                if (fee_val == .float) {
                    taker_fee = fee_val.float;
                }
            }
        }

        markets[idx] = .{
            .id = try allocator.dupe(u8, pair_code),
            .symbol = try allocator.dupe(u8, wsname),
            .base = try allocator.dupe(u8, base),
            .quote = try allocator.dupe(u8, quote),
            .baseId = try allocator.dupe(u8, if (pair_data.get("base")) |v| v.string else "UNKNOWN"),
            .quoteId = try allocator.dupe(u8, if (pair_data.get("quote")) |v| v.string else "UNKNOWN"),
            .active = true,
            .maker = maker_fee,
            .taker = taker_fee,
            .limits = .{
                .amount = .{ .min = ordermin, .max = 0 },
                .price = .{ .min = 0, .max = 0 },
                .cost = .{ .min = 0, .max = 0 },
            },
            .info = resp.body,
        };
        idx += 1;
    }

    return markets;
}

pub fn fetchTicker(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
) !types.Ticker {
    const url = try std.fmt.allocPrint(allocator, "{s}/0/public/Ticker?pair={s}", .{ BASE_URL, symbol });
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

    // Parse dynamic JSON response
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[KRAKEN] fetchTicker JSON parse error: {}\n", .{err});
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

    // Get result object and first pair entry
    const result = parsed.value.object.get("result") orelse return types.Ticker{
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

    // Get first (and usually only) pair in result
    var iter = result.object.iterator();
    const entry = iter.next() orelse return types.Ticker{
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

    const ticker_data = entry.value_ptr.*.object;

    // Extract values: a[0]=ask, b[0]=bid, c[0]=last, h[0]=high, l[0]=low, v[1]=volume, o=open
    var ask: f64 = 0;
    var bid: f64 = 0;
    var last: f64 = 0;
    var high: f64 = 0;
    var low: f64 = 0;
    var volume: f64 = 0;
    var open_price: f64 = 0;

    if (ticker_data.get("a")) |a| {
        if (a.array.items.len > 0) {
            if (a.array.items[0] == .string) {
                ask = std.fmt.parseFloat(f64, a.array.items[0].string) catch 0;
            }
        }
    }

    if (ticker_data.get("b")) |b| {
        if (b.array.items.len > 0) {
            if (b.array.items[0] == .string) {
                bid = std.fmt.parseFloat(f64, b.array.items[0].string) catch 0;
            }
        }
    }

    if (ticker_data.get("c")) |c| {
        if (c.array.items.len > 0) {
            if (c.array.items[0] == .string) {
                last = std.fmt.parseFloat(f64, c.array.items[0].string) catch 0;
            }
        }
    }

    if (ticker_data.get("h")) |h| {
        if (h.array.items.len > 0) {
            if (h.array.items[0] == .string) {
                high = std.fmt.parseFloat(f64, h.array.items[0].string) catch 0;
            }
        }
    }

    if (ticker_data.get("l")) |l| {
        if (l.array.items.len > 0) {
            if (l.array.items[0] == .string) {
                low = std.fmt.parseFloat(f64, l.array.items[0].string) catch 0;
            }
        }
    }

    if (ticker_data.get("v")) |v| {
        if (v.array.items.len > 1) {
            if (v.array.items[1] == .string) {
                volume = std.fmt.parseFloat(f64, v.array.items[1].string) catch 0;
            }
        }
    }

    if (ticker_data.get("o")) |o| {
        if (o == .string) {
            open_price = std.fmt.parseFloat(f64, o.string) catch 0;
        }
    }

    return types.Ticker{
        .symbol = try allocator.dupe(u8, symbol),
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .high = high,
        .low = low,
        .bid = bid,
        .bidVolume = 0,
        .ask = ask,
        .askVolume = 0,
        .vwap = 0,
        .open = open_price,
        .close = 0,
        .last = last,
        .previousClose = 0,
        .change = 0,
        .percentage = 0,
        .average = 0,
        .baseVolume = volume,
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
    // Try to fetch AssetPairs to get base/quote info, but continue if it fails
    var pair_map_value: ?std.json.Value = null;
    const pairs_url = BASE_URL ++ "/0/public/AssetPairs";
    const headers: [0]std.http.Header = .{};

    if (hc.get(allocator, pairs_url, &headers)) |pairs_resp| {
        if (pairs_resp.status == 200) {
            if (std.json.parseFromSlice(
                std.json.Value,
                allocator,
                pairs_resp.body,
                .{ .allocate = .alloc_always },
            )) |parsed| {
                pair_map_value = parsed.value;
            } else |err| {
                std.debug.print("[KRAKEN] fetchTickers AssetPairs parse error: {}\n", .{err});
            }
        }
    } else |_| {
        std.debug.print("[KRAKEN] fetchTickers AssetPairs fetch failed (network error)\n", .{});
    }

    // Now fetch ticker data
    const ticker_url = BASE_URL ++ "/0/public/Ticker";
    var resp = try hc.get(allocator, ticker_url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return try allocator.alloc(types.Ticker, 0);
    }

    // Parse dynamic JSON response
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[KRAKEN] fetchTickers JSON parse error: {}\n", .{err});
        return try allocator.alloc(types.Ticker, 0);
    };
    defer parsed.deinit();

    // Get result object containing all pairs
    const result = parsed.value.object.get("result") orelse return try allocator.alloc(types.Ticker, 0);

    // Count pairs
    var count: usize = 0;
    var iter = result.object.iterator();
    while (iter.next()) |_| {
        count += 1;
    }

    var tickers = try allocator.alloc(types.Ticker, count);
    var idx: usize = 0;

    // Iterate over all pairs
    iter = result.object.iterator();
    while (iter.next()) |entry| {
        const pair_name = entry.key_ptr.*;
        const pair_data = entry.value_ptr.*;

        // Extract ticker fields from arrays: a=ask, b=bid, c=last, h=high, l=low, v=volume
        var ask: f64 = 0;
        var bid: f64 = 0;
        var last: f64 = 0;
        var high: f64 = 0;
        var low: f64 = 0;
        var volume: f64 = 0;

        // Extract ask [a][0]
        if (pair_data.object.get("a")) |ask_arr| {
            if (ask_arr.array.items.len > 0) {
                if (ask_arr.array.items[0] == .string) {
                    ask = std.fmt.parseFloat(f64, ask_arr.array.items[0].string) catch 0;
                }
            }
        }

        // Extract bid [b][0]
        if (pair_data.object.get("b")) |bid_arr| {
            if (bid_arr.array.items.len > 0) {
                if (bid_arr.array.items[0] == .string) {
                    bid = std.fmt.parseFloat(f64, bid_arr.array.items[0].string) catch 0;
                }
            }
        }

        // Extract last [c][0]
        if (pair_data.object.get("c")) |last_arr| {
            if (last_arr.array.items.len > 0) {
                if (last_arr.array.items[0] == .string) {
                    last = std.fmt.parseFloat(f64, last_arr.array.items[0].string) catch 0;
                }
            }
        }

        // Extract high [h][0]
        if (pair_data.object.get("h")) |high_arr| {
            if (high_arr.array.items.len > 0) {
                if (high_arr.array.items[0] == .string) {
                    high = std.fmt.parseFloat(f64, high_arr.array.items[0].string) catch 0;
                }
            }
        }

        // Extract low [l][0]
        if (pair_data.object.get("l")) |low_arr| {
            if (low_arr.array.items.len > 0) {
                if (low_arr.array.items[0] == .string) {
                    low = std.fmt.parseFloat(f64, low_arr.array.items[0].string) catch 0;
                }
            }
        }

        // Extract volume [v][1] (24h volume)
        if (pair_data.object.get("v")) |vol_arr| {
            if (vol_arr.array.items.len > 1) {
                if (vol_arr.array.items[1] == .string) {
                    volume = std.fmt.parseFloat(f64, vol_arr.array.items[1].string) catch 0;
                }
            }
        }

        // Build normalized symbol from pair_map base/quote (if available)
        var symbol_str: []const u8 = pair_name;
        if (pair_map_value) |pm| {
            if (pm.object.get("result")) |pair_map_res| {
                if (pair_map_res.object.get(pair_name)) |pair_info| {
                    const base = if (pair_info.object.get("base")) |v| normalizeKrakenAsset(v.string) else "UNKNOWN";
                    const quote = if (pair_info.object.get("quote")) |v| normalizeKrakenAsset(v.string) else "UNKNOWN";
                    symbol_str = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base, quote });
                }
            }
        }

        tickers[idx] = .{
            .symbol = symbol_str,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .high = high,
            .low = low,
            .bid = bid,
            .bidVolume = 0,
            .ask = ask,
            .askVolume = 0,
            .vwap = 0,
            .open = 0,
            .close = last,
            .last = last,
            .previousClose = 0,
            .change = 0,
            .percentage = 0,
            .average = (bid + ask) / 2.0,
            .baseVolume = volume,
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
    // Kraken /0/public/OHLC endpoint
    // Response: {"result": {"XBTZUSD": [[timestamp, open, high, low, close, vwap, volume, count], ...]}}
    const interval = try std.fmt.allocPrint(allocator, "{d}", .{parseKrakenInterval(timeframe)});
    defer allocator.free(interval);

    const url = try std.fmt.allocPrint(allocator, "{s}/0/public/OHLC?pair={s}&interval={s}", .{ BASE_URL, symbol, interval });
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[Kraken] fetchOHLCV HTTP error: status={}, body={s}\n", .{ resp.status, resp.body[0..@min(resp.body.len, 200)] });
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }

    // Parse response: {"result": {"PAIR_CODE": [[timestamp, open, high, low, close, vwap, volume, count], ...]}}
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[Kraken] fetchOHLCV JSON parse error: {}\n", .{err});
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    };
    defer parsed.deinit();

    // Get result object
    const result = if (parsed.value.object.get("result")) |res| res.object else {
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    };

    // Find the pair data (usually the first non-"last" key)
    var pair_data: ?std.json.Value = null;
    var iter = result.iterator();
    while (iter.next()) |entry| {
        if (!std.mem.eql(u8, entry.key_ptr.*, "last")) {
            pair_data = entry.value_ptr.*;
            break;
        }
    }

    if (pair_data == null) {
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }

    // pair_data should be an array of arrays
    if (pair_data.? != .array) {
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }

    var ohlcv_list: std.ArrayList(types.OHLCV) = .empty;
    for (pair_data.?.array.items) |candle_val| {
        if (candle_val != .array or candle_val.array.items.len < 6) {
            continue;
        }

        const candle_arr = candle_val.array.items;
        var timestamp: i64 = 0;
        var open_price: f64 = 0;
        var high_price: f64 = 0;
        var low_price: f64 = 0;
        var close_price: f64 = 0;
        var volume: f64 = 0;

        // Extract values from array
        if (candle_arr[0] == .integer) {
            timestamp = candle_arr[0].integer;
        } else if (candle_arr[0] == .float) {
            timestamp = @intFromFloat(candle_arr[0].float);
        }

        if (candle_arr[1] == .float) open_price = candle_arr[1].float else if (candle_arr[1] == .string) {
            open_price = std.fmt.parseFloat(f64, candle_arr[1].string) catch 0;
        }

        if (candle_arr[2] == .float) high_price = candle_arr[2].float else if (candle_arr[2] == .string) {
            high_price = std.fmt.parseFloat(f64, candle_arr[2].string) catch 0;
        }

        if (candle_arr[3] == .float) low_price = candle_arr[3].float else if (candle_arr[3] == .string) {
            low_price = std.fmt.parseFloat(f64, candle_arr[3].string) catch 0;
        }

        if (candle_arr[4] == .float) close_price = candle_arr[4].float else if (candle_arr[4] == .string) {
            close_price = std.fmt.parseFloat(f64, candle_arr[4].string) catch 0;
        }

        if (candle_arr[6] == .float) volume = candle_arr[6].float else if (candle_arr[6] == .string) {
            volume = std.fmt.parseFloat(f64, candle_arr[6].string) catch 0;
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

fn parseKrakenInterval(timeframe: []const u8) i64 {
    if (std.mem.eql(u8, timeframe, "1m")) return 1;
    if (std.mem.eql(u8, timeframe, "5m")) return 5;
    if (std.mem.eql(u8, timeframe, "15m")) return 15;
    if (std.mem.eql(u8, timeframe, "30m")) return 30;
    if (std.mem.eql(u8, timeframe, "1h")) return 60;
    if (std.mem.eql(u8, timeframe, "4h")) return 240;
    if (std.mem.eql(u8, timeframe, "1d")) return 1440;
    if (std.mem.eql(u8, timeframe, "1w")) return 10080;
    if (std.mem.eql(u8, timeframe, "15d")) return 21600;
    return 60; // default to 1h
}

pub fn fetchOrderBook(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
    limit: ?i64,
) !types.OrderBook {
    const query = if (limit) |l|
        try std.fmt.allocPrint(allocator, "{s}/0/public/Depth?pair={s}&count={d}", .{ BASE_URL, symbol, l })
    else
        try std.fmt.allocPrint(allocator, "{s}/0/public/Depth?pair={s}", .{ BASE_URL, symbol });
    defer allocator.free(query);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, query, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[Kraken] fetchOrderBook HTTP error: status={d}, symbol={s}, body={s}\n", .{ resp.status, symbol, resp.body[0..@min(resp.body.len, 200)] });
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    // Parse response: {"result": {"XXBTZUSD": {"bids": [[price_str, amount_str, ts], ...], "asks": [...]}}}
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[Kraken] fetchOrderBook JSON parse error: {}\n", .{err});
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

    // Get result object
    const result_val = parsed.value.object.get("result") orelse return types.OrderBook{
        .symbol = try allocator.dupe(u8, symbol),
        .bids = try allocator.alloc(types.PriceLevel, 0),
        .asks = try allocator.alloc(types.PriceLevel, 0),
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .nonce = 0,
    };

    if (result_val != .object) {
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    // Get first entry in result (dynamic key = pair name)
    var pair_data: ?std.json.Value = null;
    var result_iter = result_val.object.iterator();
    if (result_iter.next()) |entry| {
        pair_data = entry.value_ptr.*;
    }

    if (pair_data == null or pair_data.? != .object) {
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    const pair_obj = pair_data.?;

    // Parse bids
    var bids: []types.PriceLevel = undefined;
    if (pair_obj.object.get("bids")) |bids_val| {
        if (bids_val == .array) {
            bids = try allocator.alloc(types.PriceLevel, bids_val.array.items.len);
            for (bids_val.array.items, 0..) |item, i| {
                if (item == .array and item.array.items.len >= 2) {
                    const price_str = if (item.array.items[0] == .string)
                        item.array.items[0].string
                    else
                        "0";
                    const amount_str = if (item.array.items[1] == .string)
                        item.array.items[1].string
                    else
                        "0";

                    const price = std.fmt.parseFloat(f64, price_str) catch 0;
                    const amount = std.fmt.parseFloat(f64, amount_str) catch 0;
                    bids[i] = .{ .price = price, .amount = amount };
                }
            }
        } else {
            bids = try allocator.alloc(types.PriceLevel, 0);
        }
    } else {
        bids = try allocator.alloc(types.PriceLevel, 0);
    }

    // Parse asks
    var asks: []types.PriceLevel = undefined;
    if (pair_obj.object.get("asks")) |asks_val| {
        if (asks_val == .array) {
            asks = try allocator.alloc(types.PriceLevel, asks_val.array.items.len);
            for (asks_val.array.items, 0..) |item, i| {
                if (item == .array and item.array.items.len >= 2) {
                    const price_str = if (item.array.items[0] == .string)
                        item.array.items[0].string
                    else
                        "0";
                    const amount_str = if (item.array.items[1] == .string)
                        item.array.items[1].string
                    else
                        "0";

                    const price = std.fmt.parseFloat(f64, price_str) catch 0;
                    const amount = std.fmt.parseFloat(f64, amount_str) catch 0;
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
    const url = try std.fmt.allocPrint(allocator, "{s}/0/public/Trades?pair={s}", .{ BASE_URL, symbol });
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
}

// Helper to normalize Kraken asset codes to standard symbols
fn normalizeKrakenAsset(asset: []const u8) []const u8 {
    if (std.mem.startsWith(u8, asset, "X")) {
        return asset[1..]; // XXBT -> XBT, XETH -> ETH, etc.
    }
    if (std.mem.startsWith(u8, asset, "Z")) {
        return asset[1..]; // ZUSD -> USD, ZEUR -> EUR, etc.
    }
    return asset;
}

// ============================================================================
// Account (Private)
// ============================================================================

pub fn fetchBalance(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) !types.BalanceMap {
    var resp = makePrivateRequest(allocator, "/0/private/Balance", api_key, api_secret, null) catch {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    }

    // Parse JSON: {"error": [], "result": {"XXBT": "0.5", ...}}
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[Kraken] JSON parse error: {}\n", .{err});
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    defer parsed.deinit();

    // Extract "result" object
    const result_obj = switch (parsed.value) {
        .object => |obj| obj.get("result") orelse {
            std.debug.print("[Kraken] No 'result' field in response\n", .{});
            return types.BalanceMap{
                .balances = try allocator.alloc(types.Balance, 0),
                .free = null,
                .used = null,
                .total = null,
            };
        },
        else => {
            std.debug.print("[Kraken] Response is not an object\n", .{});
            return types.BalanceMap{
                .balances = try allocator.alloc(types.Balance, 0),
                .free = null,
                .used = null,
                .total = null,
            };
        },
    };

    const result_map = switch (result_obj) {
        .object => |obj| obj,
        else => {
            std.debug.print("[Kraken] 'result' is not an object\n", .{});
            return types.BalanceMap{
                .balances = try allocator.alloc(types.Balance, 0),
                .free = null,
                .used = null,
                .total = null,
            };
        },
    };

    // Count non-zero entries
    var count: usize = 0;
    var iter = result_map.iterator();
    while (iter.next()) |entry| {
        _ = entry;
        count += 1;
    }

    // Build Balance array
    var balances = try allocator.alloc(types.Balance, count);
    var total_balance: f64 = 0;
    var idx: usize = 0;

    iter = result_map.iterator();
    while (iter.next()) |entry| {
        const kraken_asset = entry.key_ptr.*;
        const value_str = switch (entry.value_ptr.*) {
            .string => |s| s,
            else => continue, // Skip non-string values
        };

        const amount = std.fmt.parseFloat(f64, value_str) catch 0;
        total_balance += amount;

        const normalized_asset = normalizeKrakenAsset(kraken_asset);

        balances[idx] = .{
            .currency = try allocator.dupe(u8, normalized_asset),
            .free = amount,
            .used = 0,
            .total = amount,
            .info = try allocator.dupe(u8, resp.body),
        };
        idx += 1;
    }

    return types.BalanceMap{
        .balances = balances,
        .free = total_balance,
        .used = 0,
        .total = total_balance,
    };
}

// ============================================================================
// Trading (Private)
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
    const extra_params = if (price) |p|
        try std.fmt.allocPrint(allocator, "pair={s}&type={s}&ordertype={s}&volume={d}&price={d}",
            .{ symbol, side, order_type, amount, p })
    else
        try std.fmt.allocPrint(allocator, "pair={s}&type={s}&ordertype={s}&volume={d}",
            .{ symbol, side, order_type, amount });
    defer allocator.free(extra_params);

    var resp = makePrivateRequest(allocator, "/0/private/AddOrder", api_key, api_secret, extra_params) catch {
        return types.Order{
            .id = try allocator.dupe(u8, ""),
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
            .cost = 0,
            .average = 0,
            .filled = 0,
            .remaining = amount,
            .status = try allocator.dupe(u8, "failed"),
            .fee = null,
            .trades = try allocator.alloc(types.Trade, 0),
            .info = try allocator.dupe(u8, ""),
        };
    };
    defer resp.deinit(allocator);

    // Parse response: {"result": {"txid": ["OXXXXX-XXXXX-XXXXX"]}}
    // Extract txid from array
    var order_id = try allocator.dupe(u8, "");

    if (std.mem.indexOf(u8, resp.body, "\"txid\"")) |pos| {
        var idx = pos + 7; // len("\"txid\"")
        // Skip to first quote
        while (idx < resp.body.len and resp.body[idx] != '"') idx += 1;
        if (idx < resp.body.len) {
            idx += 1; // skip opening quote
            const id_start = idx;
            while (idx < resp.body.len and resp.body[idx] != '"') idx += 1;
            if (idx > id_start) {
                allocator.free(order_id);
                order_id = try allocator.dupe(u8, resp.body[id_start..idx]);
            }
        }
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
        .status = try allocator.dupe(u8, "open"),
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
    const extra_params = try std.fmt.allocPrint(allocator, "txid={s}", .{order_id});
    defer allocator.free(extra_params);

    var resp = makePrivateRequest(allocator, "/0/private/CancelOrder", api_key, api_secret, extra_params) catch {
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
            .status = try allocator.dupe(u8, "failed"),
            .fee = null,
            .trades = try allocator.alloc(types.Trade, 0),
            .info = try allocator.dupe(u8, ""),
        };
    };
    defer resp.deinit(allocator);

    // Parse response: {"result": {"count": 1}} — success if count=1
    var cancel_status = try allocator.dupe(u8, "canceled");

    const count_opt = json.getNumberValue(resp.body, "count") catch null;
    if (count_opt) |count| {
        if (count < 1) {
            allocator.free(cancel_status);
            cancel_status = try allocator.dupe(u8, "failed");
        }
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
    var resp = makePrivateRequest(allocator, "/0/private/OpenOrders", api_key, api_secret, null) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    defer resp.deinit(allocator);

    // Parse response: {"result": {"open": {"OXXXXX": {"descr": {"pair": "XBT/USD", "type": "buy", ...}, "vol": "0.5", "status": "open"}, ...}}}
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

    // Find "open": { ... }
    const open_pos = std.mem.indexOf(u8, resp.body, "\"open\"") orelse {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };

    var idx = open_pos + 6; // Skip "open"
    // Skip to :
    while (idx < resp.body.len and resp.body[idx] != ':') {
        idx += 1;
    }
    idx += 1; // Skip :

    // Skip whitespace
    while (idx < resp.body.len and (resp.body[idx] == ' ' or resp.body[idx] == '\t' or resp.body[idx] == '\n')) {
        idx += 1;
    }

    if (idx >= resp.body.len or resp.body[idx] != '{') {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }

    // Parse each order object
    idx += 1; // Skip {
    var brace_count: i32 = 1;
    const open_content_start = idx;

    while (idx < resp.body.len and brace_count > 0) {
        if (resp.body[idx] == '{') brace_count += 1;
        if (resp.body[idx] == '}') brace_count -= 1;
        idx += 1;
    }

    const open_content = resp.body[open_content_start .. idx - 1];

    // Extract orders from open_content
    idx = 0;
    while (idx < open_content.len) {
        // Skip to opening {
        while (idx < open_content.len and open_content[idx] != '{') {
            idx += 1;
        }

        if (idx >= open_content.len) break;

        const obj_start = idx;
        var obj_brace_count: i32 = 1;
        idx += 1;

        while (idx < open_content.len and obj_brace_count > 0) {
            if (open_content[idx] == '{') obj_brace_count += 1;
            if (open_content[idx] == '}') obj_brace_count -= 1;
            idx += 1;
        }

        if (obj_brace_count != 0) break;

        const obj = open_content[obj_start..idx];

        const order_id = try allocator.dupe(u8, "");
        var symbol = try allocator.dupe(u8, "");
        var side = try allocator.dupe(u8, "");
        var order_type = try allocator.dupe(u8, "");
        var price: f64 = 0;
        var amount: f64 = 0;
        var status = try allocator.dupe(u8, "");

        // Parse nested descr object for pair and order type
        if (json.getNestedStringValue(allocator, obj, "descr.pair") catch null) |pair| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, pair);
        }

        if (json.getNestedStringValue(allocator, obj, "descr.type") catch null) |t| {
            allocator.free(side);
            side = try allocator.dupe(u8, t);
        }

        if (json.getNestedStringValue(allocator, obj, "descr.ordertype") catch null) |ot| {
            allocator.free(order_type);
            order_type = try allocator.dupe(u8, ot);
        }

        // Parse price as string then convert
        if (json.getNestedStringValue(allocator, obj, "descr.price") catch null) |price_str| {
            price = std.fmt.parseFloat(f64, price_str) catch 0;
            allocator.free(price_str);
        }

        // Parse vol as string then convert
        if (json.getStringValue(allocator, obj, "vol") catch null) |vol_str| {
            amount = std.fmt.parseFloat(f64, vol_str) catch 0;
        }

        if (json.getStringValue(allocator, obj, "status") catch null) |s| {
            allocator.free(status);
            status = try allocator.dupe(u8, s);
        }

        try orders.append(allocator, types.Order{
            .id = order_id,
            .clientOrderId = null,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .lastTradeTimestamp = null,
            .lastUpdateTimestamp = null,
            .symbol = symbol,
            .type = order_type,
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
    var resp = makePrivateRequest(allocator, "/0/private/ClosedOrders", api_key, api_secret, null) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    defer resp.deinit(allocator);

    // Parse response: {"result": {"closed": {"OXXXXX": {"descr": {"pair": "XBT/USD", "type": "buy", ...}, "vol": "0.5", "status": "closed"}, ...}}}
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

    // Find "closed": { ... }
    const closed_pos = std.mem.indexOf(u8, resp.body, "\"closed\"") orelse {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };

    var idx = closed_pos + 8; // Skip "closed"
    // Skip to :
    while (idx < resp.body.len and resp.body[idx] != ':') {
        idx += 1;
    }
    idx += 1; // Skip :

    // Skip whitespace
    while (idx < resp.body.len and (resp.body[idx] == ' ' or resp.body[idx] == '\t' or resp.body[idx] == '\n')) {
        idx += 1;
    }

    if (idx >= resp.body.len or resp.body[idx] != '{') {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }

    // Parse each order object
    idx += 1; // Skip {
    var brace_count: i32 = 1;
    const closed_content_start = idx;

    while (idx < resp.body.len and brace_count > 0) {
        if (resp.body[idx] == '{') brace_count += 1;
        if (resp.body[idx] == '}') brace_count -= 1;
        idx += 1;
    }

    const closed_content = resp.body[closed_content_start .. idx - 1];

    // Extract orders from closed_content
    idx = 0;
    while (idx < closed_content.len) {
        // Skip to opening {
        while (idx < closed_content.len and closed_content[idx] != '{') {
            idx += 1;
        }

        if (idx >= closed_content.len) break;

        const obj_start = idx;
        var obj_brace_count: i32 = 1;
        idx += 1;

        while (idx < closed_content.len and obj_brace_count > 0) {
            if (closed_content[idx] == '{') obj_brace_count += 1;
            if (closed_content[idx] == '}') obj_brace_count -= 1;
            idx += 1;
        }

        if (obj_brace_count != 0) break;

        const obj = closed_content[obj_start..idx];

        const order_id = try allocator.dupe(u8, "");
        var symbol = try allocator.dupe(u8, "");
        var side = try allocator.dupe(u8, "");
        var order_type = try allocator.dupe(u8, "");
        var price: f64 = 0;
        var amount: f64 = 0;
        var status = try allocator.dupe(u8, "");

        // Parse nested descr object for pair and order type
        if (json.getNestedStringValue(allocator, obj, "descr.pair") catch null) |pair| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, pair);
        }

        if (json.getNestedStringValue(allocator, obj, "descr.type") catch null) |t| {
            allocator.free(side);
            side = try allocator.dupe(u8, t);
        }

        if (json.getNestedStringValue(allocator, obj, "descr.ordertype") catch null) |ot| {
            allocator.free(order_type);
            order_type = try allocator.dupe(u8, ot);
        }

        // Parse price as string then convert
        if (json.getNestedStringValue(allocator, obj, "descr.price") catch null) |price_str| {
            price = std.fmt.parseFloat(f64, price_str) catch 0;
            allocator.free(price_str);
        }

        // Parse vol as string then convert
        if (json.getStringValue(allocator, obj, "vol") catch null) |vol_str| {
            amount = std.fmt.parseFloat(f64, vol_str) catch 0;
        }

        if (json.getStringValue(allocator, obj, "status") catch null) |s| {
            allocator.free(status);
            status = try allocator.dupe(u8, s);
        }

        try orders.append(allocator, types.Order{
            .id = order_id,
            .clientOrderId = null,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .lastTradeTimestamp = null,
            .lastUpdateTimestamp = null,
            .symbol = symbol,
            .type = order_type,
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
    var resp = makePrivateRequest(allocator, "/0/private/TradesHistory", api_key, api_secret, null) catch {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    };
    defer resp.deinit(allocator);

    return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
}

// ============================================================================
// Testing
// ============================================================================

pub fn testConnection(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) !types.TestResult {
    var resp = makePrivateRequest(allocator, "/0/private/Balance", api_key, api_secret, null) catch |err| {
        return types.TestResult.failFmt(allocator, "Kraken connection failed: {}", .{err});
    };
    defer resp.deinit(allocator);

    std.debug.print("[KRAKEN] Status: {d}\n", .{resp.status});
    std.debug.print("[KRAKEN] Response body ({d} bytes):\n{s}\n", .{
        resp.body.len,
        resp.body[0..@min(500, resp.body.len)],
    });

    if (resp.status == 200) {
        if (std.mem.indexOf(u8, resp.body, "\"error\":[]") != null or
            (std.mem.indexOf(u8, resp.body, "EAPI:Invalid key") == null and resp.body.len > 10))
        {
            if (std.mem.indexOf(u8, resp.body, "Invalid key") != null or
                std.mem.indexOf(u8, resp.body, "Invalid signature") != null)
            {
                return types.TestResult.fail(allocator, "Kraken: Invalid API key or signature");
            }
            return types.TestResult.ok(allocator, "Kraken: API key valid, connection successful");
        }
        return types.TestResult.fail(allocator, "Kraken: Invalid API key or permissions");
    }

    return switch (resp.status) {
        401, 403 => types.TestResult.fail(allocator, "Kraken: Invalid API key or permissions"),
        else => types.TestResult.failFmt(allocator, "Kraken: HTTP {d}", .{resp.status}),
    };
}
