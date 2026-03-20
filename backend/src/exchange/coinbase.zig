/// Coinbase Advanced Trade API – CCXT-compatible implementation
/// Auth spec (from docs.cdp.coinbase.com):
///   Algorithm : ES256  (ECDSA P-256 + SHA-256)
///   Key type  : EC private key stored as PEM (SEC1 or PKCS#8)
const std = @import("std");
const types = @import("types.zig");
const hc = @import("http_client.zig");
const json = @import("../utils/json.zig");

const EcdsaP256Sha256 = std.crypto.sign.ecdsa.EcdsaP256Sha256;
const UrlEnc = std.base64.url_safe_no_pad.Encoder;
const B64Dec = std.base64.standard.Decoder;

const TEST_HOST = "api.coinbase.com";
const TEST_PATH = "/api/v3/brokerage/accounts";
const TEST_URL = "https://" ++ TEST_HOST ++ TEST_PATH;
const TEST_METHOD = "GET";
const JWT_TTL_SECS: i64 = 120;

/// Extract the 32-byte raw private key from a PEM-encoded EC key.
/// Supports both SEC1 (-----BEGIN EC PRIVATE KEY-----) and
/// PKCS#8  (-----BEGIN PRIVATE KEY-----) formats.
/// Searches for the ASN.1 pattern: SEQUENCE(version=1) + OCTET STRING(32).
fn extractEcPrivateKey(allocator: std.mem.Allocator, pem: []const u8) !?[32]u8 {
    // Find the end of the first PEM header line ("-----\n" or "-----\r\n")
    const first_dash_end = std.mem.indexOf(u8, pem, "-----") orelse return null;
    const header_end = std.mem.indexOfPos(u8, pem, first_dash_end + 5, "-----") orelse return null;
    const content_start = blk: {
        var p = header_end + 5;
        if (p < pem.len and pem[p] == '\r') p += 1;
        if (p < pem.len and pem[p] == '\n') p += 1;
        break :blk p;
    };

    // Find the begin of the END marker
    const end_marker = "-----END ";
    const end_start = std.mem.indexOf(u8, pem[content_start..], end_marker) orelse return null;
    const b64_content = pem[content_start .. content_start + end_start];

    // Strip all whitespace from the base64 content
    var clean = try allocator.alloc(u8, b64_content.len);
    defer allocator.free(clean);
    var n: usize = 0;
    for (b64_content) |c| {
        if (!std.ascii.isWhitespace(c)) {
            clean[n] = c;
            n += 1;
        }
    }

    // Base64-decode the cleaned content (standard alphabet, with or without padding)
    const dec_len = B64Dec.calcSizeForSlice(clean[0..n]) catch return null;
    const der = try allocator.alloc(u8, dec_len);
    defer allocator.free(der);
    B64Dec.decode(der, clean[0..n]) catch return null;

    // Search for ASN.1 pattern: 02 01 01 04 20 <32 bytes>
    //   02 01 01  = INTEGER(1)  — EC key version
    //   04 20     = OCTET STRING, length 32  — private key scalar
    const pattern = [_]u8{ 0x02, 0x01, 0x01, 0x04, 0x20 };
    var i: usize = 0;
    while (i + pattern.len + 32 <= der.len) : (i += 1) {
        if (std.mem.eql(u8, der[i .. i + pattern.len], &pattern)) {
            var key: [32]u8 = undefined;
            @memcpy(&key, der[i + pattern.len .. i + pattern.len + 32]);
            return key;
        }
    }

    return null; // pattern not found
}

/// Encode `data` as base64url (no padding) and return allocated slice.
fn b64url(allocator: std.mem.Allocator, data: []const u8) ![]u8 {
    const len = UrlEnc.calcSize(data.len);
    const buf = try allocator.alloc(u8, len);
    _ = UrlEnc.encode(buf, data);
    return buf;
}

/// Build and sign a Coinbase CDP JWT for the given key_id / raw EC key.
fn buildJwt(
    allocator: std.mem.Allocator,
    key_id: []const u8,
    raw_key: [32]u8,
    uri_claim: []const u8, // e.g. "GET api.coinbase.com/api/v3/brokerage/accounts"
) ![]u8 {
    const ts = std.time.timestamp();

    // Random 16-byte nonce → 32-char lowercase hex
    var nonce_bytes: [16]u8 = undefined;
    std.crypto.random.bytes(&nonce_bytes);
    const nonce_hex = std.fmt.bytesToHex(nonce_bytes, .lower);

    // JWT Header JSON
    const hdr_json = try std.fmt.allocPrint(allocator,
        "{{\"alg\":\"ES256\",\"typ\":\"JWT\",\"kid\":\"{s}\",\"nonce\":\"{s}\"}}",
        .{ key_id, &nonce_hex });
    defer allocator.free(hdr_json);
    const hdr_b64 = try b64url(allocator, hdr_json);
    defer allocator.free(hdr_b64);

    // JWT Payload JSON
    const pay_json = try std.fmt.allocPrint(allocator,
        "{{\"sub\":\"{s}\",\"iss\":\"cdp\",\"nbf\":{d},\"exp\":{d},\"uri\":\"{s}\"}}",
        .{ key_id, ts, ts + JWT_TTL_SECS, uri_claim });
    defer allocator.free(pay_json);
    const pay_b64 = try b64url(allocator, pay_json);
    defer allocator.free(pay_b64);

    // Signing input = header_b64 + "." + payload_b64
    const signing_input = try std.fmt.allocPrint(allocator, "{s}.{s}", .{ hdr_b64, pay_b64 });
    defer allocator.free(signing_input);

    // Load ECDSA P-256 key and sign
    const sk = try EcdsaP256Sha256.SecretKey.fromBytes(raw_key);
    const kp = try EcdsaP256Sha256.KeyPair.fromSecretKey(sk);
    const sig = try kp.sign(signing_input, null); // null = RFC 6979 deterministic

    // Signature bytes: r (32) ++ s (32) = 64 bytes, base64url-encoded for JWT
    var raw_sig: [64]u8 = undefined;
    @memcpy(raw_sig[0..32], &sig.r);
    @memcpy(raw_sig[32..64], &sig.s);
    const sig_b64 = try b64url(allocator, &raw_sig);
    defer allocator.free(sig_b64);

    return std.fmt.allocPrint(allocator, "{s}.{s}.{s}", .{ hdr_b64, pay_b64, sig_b64 });
}

pub fn testConnection(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) !types.TestResult {
    // Parse EC private key from PEM
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.TestResult.fail(allocator, "Coinbase: Failed to parse EC private key PEM");
    }) orelse {
        return types.TestResult.fail(allocator,
            "Coinbase: Could not find EC private key in PEM (expected SEC1 or PKCS#8 P-256 key)");
    };

    const uri_claim = TEST_METHOD ++ " " ++ TEST_HOST ++ TEST_PATH;

    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch |err| {
        return types.TestResult.failFmt(allocator, "Coinbase: JWT build failed: {}", .{err});
    };
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
        .{ .name = "Accept", .value = "application/json" },
    };

    var resp = hc.get(allocator, TEST_URL, &headers) catch |err| {
        return types.TestResult.failFmt(allocator, "Coinbase connection failed: {}", .{err});
    };
    defer resp.deinit(allocator);

    std.debug.print("[COINBASE] Status: {d}\n", .{resp.status});
    std.debug.print("[COINBASE] Response body ({d} bytes):\n{s}\n", .{
        resp.body.len,
        resp.body[0..@min(500, resp.body.len)],
    });

    return switch (resp.status) {
        200 => types.TestResult.ok(allocator, "Coinbase: API key valid, connection successful"),
        401 => types.TestResult.fail(allocator, "Coinbase: Unauthorized – invalid key name or signature"),
        403 => types.TestResult.fail(allocator, "Coinbase: Forbidden – insufficient permissions"),
        else => types.TestResult.failFmt(allocator, "Coinbase: HTTP {d}", .{resp.status}),
    };
}

// ============================================================================
// Market Data (Public)
// ============================================================================

pub fn fetchMarkets(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
) ![]types.Market {
    // Use public market products endpoint
    const url = "https://api.coinbase.com/api/v3/brokerage/market/products";
    const headers: [0]std.http.Header = .{};

    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        return try allocator.alloc(types.Market, 0);
    }

    // Coinbase market response structure
    const CoinbaseMarketData = struct {
        product_id: []const u8,
        base_name: []const u8,
        quote_name: []const u8,
        status: []const u8,
        price: []const u8,
    };

    const CoinbaseMarketsResponse = struct {
        products: []CoinbaseMarketData,
    };

    var parsed = std.json.parseFromSlice(
        CoinbaseMarketsResponse,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[COINBASE] fetchMarkets JSON parse error: {}\n", .{err});
        return try allocator.alloc(types.Market, 0);
    };
    defer parsed.deinit();

    var markets = try allocator.alloc(types.Market, parsed.value.products.len);
    for (parsed.value.products, 0..) |data, i| {
        // Extract base and quote from product_id (e.g., "BTC-USDC" -> "BTC", "USDC")
        var base: []const u8 = "UNKNOWN";
        var quote: []const u8 = "UNKNOWN";
        if (std.mem.indexOf(u8, data.product_id, "-")) |dash_idx| {
            base = data.product_id[0..dash_idx];
            quote = data.product_id[dash_idx + 1 ..];
        }

        markets[i] = .{
            .id = try allocator.dupe(u8, data.product_id),
            .symbol = try allocator.dupe(u8, data.product_id),
            .base = try allocator.dupe(u8, base),
            .quote = try allocator.dupe(u8, quote),
            .baseId = try allocator.dupe(u8, base),
            .quoteId = try allocator.dupe(u8, quote),
            .active = std.mem.eql(u8, data.status, "online"),
            .maker = 0.002,
            .taker = 0.004,
            .limits = .{
                .amount = .{ .min = 0, .max = 0 },
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
    // Get bid/ask from ticker endpoint
    const ticker_url = try std.fmt.allocPrint(allocator, "https://api.coinbase.com/api/v3/brokerage/products/{s}/ticker", .{symbol});
    defer allocator.free(ticker_url);

    const headers: [0]std.http.Header = .{};
    var ticker_resp = try hc.get(allocator, ticker_url, &headers);
    defer ticker_resp.deinit(allocator);

    var bid: f64 = 0;
    var ask: f64 = 0;
    var bid_vol: f64 = 0;
    var ask_vol: f64 = 0;

    if (ticker_resp.status == 200) {
        const TickerData = struct {
            best_bid: []const u8,
            best_ask: []const u8,
            best_bid_quantity: []const u8,
            best_ask_quantity: []const u8,
        };

        if (std.json.parseFromSlice(TickerData, allocator, ticker_resp.body, .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        })) |parsed| {
            defer parsed.deinit();
            bid = std.fmt.parseFloat(f64, parsed.value.best_bid) catch 0;
            ask = std.fmt.parseFloat(f64, parsed.value.best_ask) catch 0;
            bid_vol = std.fmt.parseFloat(f64, parsed.value.best_bid_quantity) catch 0;
            ask_vol = std.fmt.parseFloat(f64, parsed.value.best_ask_quantity) catch 0;
        } else |_| {}
    }

    // Get product details (price, high, low, volume)
    const product_url = try std.fmt.allocPrint(allocator, "https://api.coinbase.com/api/v3/brokerage/products/{s}", .{symbol});
    defer allocator.free(product_url);

    var product_resp = try hc.get(allocator, product_url, &headers);
    defer product_resp.deinit(allocator);

    var last: f64 = 0;
    var high: f64 = 0;
    var low: f64 = 0;
    var volume: f64 = 0;

    if (product_resp.status == 200) {
        const ProductData = struct {
            price: []const u8,
            high_24h: []const u8,
            low_24h: []const u8,
            volume_24h: []const u8,
        };

        if (std.json.parseFromSlice(ProductData, allocator, product_resp.body, .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        })) |parsed| {
            defer parsed.deinit();
            last = std.fmt.parseFloat(f64, parsed.value.price) catch 0;
            high = std.fmt.parseFloat(f64, parsed.value.high_24h) catch 0;
            low = std.fmt.parseFloat(f64, parsed.value.low_24h) catch 0;
            volume = std.fmt.parseFloat(f64, parsed.value.volume_24h) catch 0;
        } else |_| {}
    }

    return types.Ticker{
        .symbol = try allocator.dupe(u8, symbol),
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .high = high,
        .low = low,
        .bid = bid,
        .bidVolume = bid_vol,
        .ask = ask,
        .askVolume = ask_vol,
        .vwap = 0,
        .open = 0,
        .close = 0,
        .last = last,
        .previousClose = 0,
        .change = 0,
        .percentage = 0,
        .average = 0,
        .baseVolume = volume,
        .quoteVolume = 0,
        .info = product_resp.body,
    };
}

pub fn fetchTickers(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    _: ?[]const []const u8,
) ![]types.Ticker {
    // Fetch public products and convert to tickers
    // Using market/products endpoint which should be public
    const url = "https://api.coinbase.com/api/v3/brokerage/market/products";
    const headers: [0]std.http.Header = .{};

    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[COINBASE] fetchTickers HTTP error: status={}, body={s}\n", .{ resp.status, resp.body[0..@min(resp.body.len, 200)] });
        return try allocator.alloc(types.Ticker, 0);
    }

    const CoinbaseProductData = struct {
        product_id: []const u8,
        price: []const u8,
        volume_24h: []const u8,
        price_percentage_change_24h: []const u8,
    };

    const CoinbaseProductsResponse = struct {
        products: []CoinbaseProductData,
    };

    var parsed = std.json.parseFromSlice(
        CoinbaseProductsResponse,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[COINBASE] fetchTickers JSON parse error: {}\n", .{err});
        std.debug.print("[COINBASE] Response body: {s}\n", .{resp.body[0..@min(resp.body.len, 500)]});
        return try allocator.alloc(types.Ticker, 0);
    };
    defer parsed.deinit();

    var tickers = try allocator.alloc(types.Ticker, parsed.value.products.len);
    for (parsed.value.products, 0..) |data, i| {
        const last = std.fmt.parseFloat(f64, data.price) catch 0;
        const volume = std.fmt.parseFloat(f64, data.volume_24h) catch 0;
        const change_pct = std.fmt.parseFloat(f64, data.price_percentage_change_24h) catch 0;

        tickers[i] = .{
            .symbol = try allocator.dupe(u8, data.product_id),
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
            .close = last,
            .last = last,
            .previousClose = 0,
            .change = 0,
            .percentage = change_pct,
            .average = 0,
            .baseVolume = volume,
            .quoteVolume = 0,
            .info = resp.body,
        };
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
    // Coinbase /api/v3/brokerage/market/products/{product_id}/candles
    // Response: [[timestamp, low, high, open, close, volume], ...]
    const granularity = parseCoinbaseGranularity(timeframe);

    const url = try std.fmt.allocPrint(
        allocator,
        "https://api.coinbase.com/api/v3/brokerage/market/products/{s}/candles?granularity={d}",
        .{ symbol, granularity },
    );
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[Coinbase] fetchOHLCV HTTP error: status={}, body={s}\n", .{ resp.status, resp.body[0..@min(resp.body.len, 200)] });
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }

    // Parse response: [[timestamp, low, high, open, close, volume], ...]
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[Coinbase] fetchOHLCV JSON parse error: {}\n", .{err});
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    };
    defer parsed.deinit();

    if (parsed.value != .array) {
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    }

    var ohlcv_list: std.ArrayList(types.OHLCV) = .empty;

    for (parsed.value.array.items) |candle_val| {
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

        // Extract values from array [timestamp, low, high, open, close, volume]
        if (candle_arr[0] == .integer) {
            timestamp = candle_arr[0].integer;
        } else if (candle_arr[0] == .float) {
            timestamp = @intFromFloat(candle_arr[0].float);
        }

        // Index: 1=low, 2=high, 3=open, 4=close, 5=volume
        if (candle_arr[1] == .float) low_price = candle_arr[1].float else if (candle_arr[1] == .string) {
            low_price = std.fmt.parseFloat(f64, candle_arr[1].string) catch 0;
        }

        if (candle_arr[2] == .float) high_price = candle_arr[2].float else if (candle_arr[2] == .string) {
            high_price = std.fmt.parseFloat(f64, candle_arr[2].string) catch 0;
        }

        if (candle_arr[3] == .float) open_price = candle_arr[3].float else if (candle_arr[3] == .string) {
            open_price = std.fmt.parseFloat(f64, candle_arr[3].string) catch 0;
        }

        if (candle_arr[4] == .float) close_price = candle_arr[4].float else if (candle_arr[4] == .string) {
            close_price = std.fmt.parseFloat(f64, candle_arr[4].string) catch 0;
        }

        if (candle_arr[5] == .float) volume = candle_arr[5].float else if (candle_arr[5] == .string) {
            volume = std.fmt.parseFloat(f64, candle_arr[5].string) catch 0;
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

fn parseCoinbaseGranularity(timeframe: []const u8) i64 {
    if (std.mem.eql(u8, timeframe, "1m")) return 60;
    if (std.mem.eql(u8, timeframe, "5m")) return 300;
    if (std.mem.eql(u8, timeframe, "15m")) return 900;
    if (std.mem.eql(u8, timeframe, "30m")) return 1800;
    if (std.mem.eql(u8, timeframe, "1h")) return 3600;
    if (std.mem.eql(u8, timeframe, "6h")) return 21600;
    if (std.mem.eql(u8, timeframe, "1d")) return 86400;
    return 3600; // default to 1h
}

pub fn fetchOrderBook(
    allocator: std.mem.Allocator,
    _: []const u8,
    _: []const u8,
    symbol: []const u8,
    limit: ?i64,
) !types.OrderBook {
    const limit_val = limit orelse 20;
    const url = try std.fmt.allocPrint(
        allocator,
        "https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id={s}&limit={d}",
        .{ symbol, limit_val },
    );
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[Coinbase] fetchOrderBook HTTP error: status={}\n", .{resp.status});
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    // Parse response: {"pricebook": {"bids": [{"price": "str", "size": "str"}, ...], "asks": [...]}}
    var parsed = std.json.parseFromSlice(
        std.json.Value,
        allocator,
        resp.body,
        .{ .allocate = .alloc_always },
    ) catch |err| {
        std.debug.print("[Coinbase] fetchOrderBook JSON parse error: {}\n", .{err});
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

    // Get pricebook object
    const pb_val = parsed.value.object.get("pricebook") orelse return types.OrderBook{
        .symbol = try allocator.dupe(u8, symbol),
        .bids = try allocator.alloc(types.PriceLevel, 0),
        .asks = try allocator.alloc(types.PriceLevel, 0),
        .timestamp = std.time.milliTimestamp(),
        .datetime = try allocator.dupe(u8, ""),
        .nonce = 0,
    };

    if (pb_val != .object) {
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    }

    // Parse bids
    var bids: []types.PriceLevel = undefined;
    if (pb_val.object.get("bids")) |bids_val| {
        if (bids_val == .array) {
            bids = try allocator.alloc(types.PriceLevel, bids_val.array.items.len);
            for (bids_val.array.items, 0..) |item, i| {
                if (item == .object) {
                    const price_str = if (item.object.get("price")) |p|
                        if (p == .string) p.string else "0"
                    else
                        "0";
                    const size_str = if (item.object.get("size")) |s|
                        if (s == .string) s.string else "0"
                    else
                        "0";

                    const price = std.fmt.parseFloat(f64, price_str) catch 0;
                    const amount = std.fmt.parseFloat(f64, size_str) catch 0;
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
    if (pb_val.object.get("asks")) |asks_val| {
        if (asks_val == .array) {
            asks = try allocator.alloc(types.PriceLevel, asks_val.array.items.len);
            for (asks_val.array.items, 0..) |item, i| {
                if (item == .object) {
                    const price_str = if (item.object.get("price")) |p|
                        if (p == .string) p.string else "0"
                    else
                        "0";
                    const size_str = if (item.object.get("size")) |s|
                        if (s == .string) s.string else "0"
                    else
                        "0";

                    const price = std.fmt.parseFloat(f64, price_str) catch 0;
                    const amount = std.fmt.parseFloat(f64, size_str) catch 0;
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
    const url = try std.fmt.allocPrint(allocator, "https://api.coinbase.com/api/v3/brokerage/products/{s}/trades", .{symbol});
    defer allocator.free(url);

    const headers: [0]std.http.Header = .{};
    var resp = try hc.get(allocator, url, &headers);
    defer resp.deinit(allocator);

    return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
}

// ============================================================================
// Account (Private)
// ============================================================================

const CoinbaseBalance = struct {
    value: []const u8,
};

const CoinbaseAccount = struct {
    currency: []const u8,
    available_balance: CoinbaseBalance,
    hold: CoinbaseBalance,
};

const CoinbaseBalanceResponse = struct {
    accounts: []CoinbaseAccount,
};

pub fn fetchBalance(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) !types.BalanceMap {
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    }) orelse {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };

    const uri_claim = "GET api.coinbase.com/api/v3/brokerage/accounts";
    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
    };

    var resp = hc.get(allocator, "https://api.coinbase.com/api/v3/brokerage/accounts", &headers) catch {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    defer resp.deinit(allocator);

    if (resp.status != 200) {
        std.debug.print("[Coinbase] fetchBalance HTTP ERROR {d}\n", .{resp.status});
        std.debug.print("[Coinbase] Response body: {s}\n", .{resp.body[0..@min(resp.body.len, 500)]});
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    }

    std.debug.print("[Coinbase] fetchBalance response OK, parsing...\n", .{});

    // Parse JSON response
    var parsed = std.json.parseFromSlice(
        CoinbaseBalanceResponse,
        allocator,
        resp.body,
        .{
            .ignore_unknown_fields = true,
            .allocate = .alloc_always,
        },
    ) catch |err| {
        std.debug.print("[Coinbase] JSON parse error: {}\n", .{err});
        std.debug.print("[Coinbase] Response body: {s}\n", .{resp.body[0..@min(resp.body.len, 800)]});
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    defer parsed.deinit();
    std.debug.print("[Coinbase] Parsed {d} accounts successfully\n", .{parsed.value.accounts.len});

    // Build Balance array
    var balances = try allocator.alloc(types.Balance, parsed.value.accounts.len);
    var total_free: f64 = 0;
    var total_used: f64 = 0;

    for (parsed.value.accounts, 0..) |account, i| {
        const free = std.fmt.parseFloat(f64, account.available_balance.value) catch 0;
        const used = std.fmt.parseFloat(f64, account.hold.value) catch 0;
        const total = free + used;

        total_free += free;
        total_used += used;

        balances[i] = .{
            .currency = try allocator.dupe(u8, account.currency),
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
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.Order{
            .id = try allocator.dupe(u8, ""),
            .clientOrderId = null,
            .timestamp = 0,
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
    }) orelse {
        return types.Order{
            .id = try allocator.dupe(u8, ""),
            .clientOrderId = null,
            .timestamp = 0,
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

    const uri_claim = "POST api.coinbase.com/api/v3/brokerage/orders";
    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch {
        return types.Order{
            .id = try allocator.dupe(u8, ""),
            .clientOrderId = null,
            .timestamp = 0,
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
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const body = if (price) |p|
        try std.fmt.allocPrint(allocator,
            "{{\"product_id\":\"{s}\",\"order_configuration\":{{\"limit_limit_gtc\":{{\"post_only\":false,\"limit_price\":\"{d}\"}}}},\"side\":\"{s}\",\"order_type\":\"limit\",\"size\":\"{d}\"}}",
            .{ symbol, p, side, amount })
    else
        try std.fmt.allocPrint(allocator,
            "{{\"product_id\":\"{s}\",\"side\":\"{s}\",\"order_type\":\"market\",\"market_market_ioc\":{{\"quote_size\":\"{d}\"}}}}",
            .{ symbol, side, amount });
    defer allocator.free(body);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
    };

    var resp = hc.post(allocator, "https://api.coinbase.com/api/v3/brokerage/orders", &headers, body) catch {
        return types.Order{
            .id = try allocator.dupe(u8, ""),
            .clientOrderId = null,
            .timestamp = 0,
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

    // Parse response: {"order_id": "550e8400-e29b-41d4-a716-xxx", "status": "OPEN"}
    var order_id = try allocator.dupe(u8, "");
    var order_status = try allocator.dupe(u8, "open");

    // Try to extract order_id
    const id_opt = json.getStringValue(allocator, resp.body, "order_id") catch null;
    if (id_opt) |id| {
        allocator.free(order_id);
        order_id = try allocator.dupe(u8, id);
    }

    // Try to extract status
    const status_opt = json.getStringValue(allocator, resp.body, "status") catch null;
    if (status_opt) |status| {
        allocator.free(order_status);
        var status_lower = try allocator.alloc(u8, status.len);
        for (status, 0..) |c, i| {
            status_lower[i] = std.ascii.toLower(c);
        }
        allocator.free(status);
        order_status = status_lower;
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
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.Order{
            .id = try allocator.dupe(u8, order_id),
            .clientOrderId = null,
            .timestamp = 0,
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
    }) orelse {
        return types.Order{
            .id = try allocator.dupe(u8, order_id),
            .clientOrderId = null,
            .timestamp = 0,
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

    const uri_claim = try std.fmt.allocPrint(allocator, "POST api.coinbase.com/api/v3/brokerage/orders/batch_cancel", .{});
    defer allocator.free(uri_claim);

    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch {
        return types.Order{
            .id = try allocator.dupe(u8, order_id),
            .clientOrderId = null,
            .timestamp = 0,
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
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const body = try std.fmt.allocPrint(allocator, "{{\"order_ids\":[\"{s}\"]}}", .{order_id});
    defer allocator.free(body);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
    };

    var resp = hc.post(allocator, "https://api.coinbase.com/api/v3/brokerage/orders/batch_cancel", &headers, body) catch {
        return types.Order{
            .id = try allocator.dupe(u8, order_id),
            .clientOrderId = null,
            .timestamp = 0,
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

    // Parse response: {"results": [{"order_id": "xxx", "success": true}]}
    var cancel_status = try allocator.dupe(u8, "canceled");

    // Look for "success": true in the response
    if (std.mem.indexOf(u8, resp.body, "\"success\": true") == null and
        std.mem.indexOf(u8, resp.body, "\"success\":true") == null) {
        allocator.free(cancel_status);
        cancel_status = try allocator.dupe(u8, "failed");
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
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }) orelse {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };

    const uri_claim = "GET api.coinbase.com/api/v3/brokerage/orders/historical/batch";
    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
    };

    var resp = hc.get(allocator, "https://api.coinbase.com/api/v3/brokerage/orders/historical/batch?order_status=OPEN", &headers) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    defer resp.deinit(allocator);

    std.debug.print("[Coinbase] fetchOpenOrders response status: {d}\n", .{resp.status});
    std.debug.print("[Coinbase] fetchOpenOrders response body: {s}\n", .{resp.body});

    if (resp.status != 200) {
        std.debug.print("[Coinbase] ERROR: HTTP {d} response\n", .{resp.status});
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }

    // Parse response: {"orders": [{"order_id": "xxx", "product_id": "BTC-USD", "side": "BUY", "status": "OPEN", ...}]}
    const array_content_opt = json.getArrayContent(allocator, resp.body, "orders") catch |err| {
        std.debug.print("[Coinbase] ERROR: Failed to extract 'orders' array: {}\n", .{err});
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    if (array_content_opt == null) {
        std.debug.print("[Coinbase] ERROR: 'orders' array is null\n", .{});
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

        // Parse fields
        if (json.getStringValue(allocator, obj, "order_id") catch null) |id| {
            allocator.free(order_id);
            order_id = try allocator.dupe(u8, id);
        }

        // product_id is the symbol
        if (json.getStringValue(allocator, obj, "product_id") catch null) |sym| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, sym);
        }

        // Side in Coinbase is BUY/SELL, convert to lowercase
        if (json.getStringValue(allocator, obj, "side") catch null) |s| {
            allocator.free(side);
            // Convert to lowercase
            var side_buf: [32]u8 = undefined;
            var side_len: usize = 0;
            for (s) |c| {
                if (side_len < 31) {
                    if (c >= 'A' and c <= 'Z') {
                        side_buf[side_len] = c + 32;
                    } else {
                        side_buf[side_len] = c;
                    }
                    side_len += 1;
                }
            }
            side = try allocator.dupe(u8, side_buf[0..side_len]);
        }

        // Parse status
        if (json.getStringValue(allocator, obj, "status") catch null) |s| {
            allocator.free(status);
            // Convert to lowercase
            var status_buf: [32]u8 = undefined;
            var status_len: usize = 0;
            for (s) |c| {
                if (status_len < 31) {
                    if (c >= 'A' and c <= 'Z') {
                        status_buf[status_len] = c + 32;
                    } else {
                        status_buf[status_len] = c;
                    }
                    status_len += 1;
                }
            }
            status = try allocator.dupe(u8, status_buf[0..status_len]);
        }

        // Parse price and amount from order specification if available
        if (json.getNumberValue(obj, "price") catch null) |p| {
            price = p;
        }

        if (json.getNumberValue(obj, "size") catch null) |sz| {
            amount = sz;
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
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    }) orelse {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };

    const uri_claim = "GET api.coinbase.com/api/v3/brokerage/orders/historical/batch";
    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
    };

    var resp = hc.get(allocator, "https://api.coinbase.com/api/v3/brokerage/orders/historical/batch?order_status=FILLED,CANCELLED", &headers) catch {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };
    defer resp.deinit(allocator);

    // Parse response: {"orders": [{"order_id": "xxx", "product_id": "BTC-USD", "side": "BUY", "status": "FILLED", ...}]}
    const array_content_opt = json.getArrayContent(allocator, resp.body, "orders") catch null;
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

        // Parse fields
        if (json.getStringValue(allocator, obj, "order_id") catch null) |id| {
            allocator.free(order_id);
            order_id = try allocator.dupe(u8, id);
        }

        // product_id is the symbol
        if (json.getStringValue(allocator, obj, "product_id") catch null) |sym| {
            allocator.free(symbol);
            symbol = try allocator.dupe(u8, sym);
        }

        // Side in Coinbase is BUY/SELL, convert to lowercase
        if (json.getStringValue(allocator, obj, "side") catch null) |s| {
            allocator.free(side);
            // Convert to lowercase
            var side_buf: [32]u8 = undefined;
            var side_len: usize = 0;
            for (s) |c| {
                if (side_len < 31) {
                    if (c >= 'A' and c <= 'Z') {
                        side_buf[side_len] = c + 32;
                    } else {
                        side_buf[side_len] = c;
                    }
                    side_len += 1;
                }
            }
            side = try allocator.dupe(u8, side_buf[0..side_len]);
        }

        // Parse status
        if (json.getStringValue(allocator, obj, "status") catch null) |s| {
            allocator.free(status);
            // Convert to lowercase
            var status_buf: [32]u8 = undefined;
            var status_len: usize = 0;
            for (s) |c| {
                if (status_len < 31) {
                    if (c >= 'A' and c <= 'Z') {
                        status_buf[status_len] = c + 32;
                    } else {
                        status_buf[status_len] = c;
                    }
                    status_len += 1;
                }
            }
            status = try allocator.dupe(u8, status_buf[0..status_len]);
        }

        // Parse price and amount from order specification if available
        if (json.getNumberValue(obj, "price") catch null) |p| {
            price = p;
        }

        if (json.getNumberValue(obj, "size") catch null) |sz| {
            amount = sz;
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
    const raw_key = (extractEcPrivateKey(allocator, api_secret) catch {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    }) orelse {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    };

    const uri_claim = "GET api.coinbase.com/api/v3/brokerage/orders/historical/fills";
    const jwt = buildJwt(allocator, api_key, raw_key, uri_claim) catch {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    };
    defer allocator.free(jwt);

    const auth_value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{jwt});
    defer allocator.free(auth_value);

    const headers = [_]std.http.Header{
        .{ .name = "Authorization", .value = auth_value },
        .{ .name = "Content-Type", .value = "application/json" },
    };

    var resp = hc.get(allocator, "https://api.coinbase.com/api/v3/brokerage/orders/historical/fills", &headers) catch {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    };
    defer resp.deinit(allocator);

    return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
}
