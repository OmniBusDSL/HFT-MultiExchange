/// Multi-Exchange Data Aggregator
/// Supports dynamic exchange selection and tiered response (individual + aggregated)

const std = @import("std");
const types = @import("types.zig");
const factory = @import("factory.zig");
const symbols = @import("../utils/symbols.zig");

pub const ExchangeTickerResult = struct {
    exchange: []const u8,
    ticker: ?types.Ticker = null,
    err_msg: []const u8 = "",
};

pub const AggregatedStats = struct {
    avg_price: f64 = 0,
    best_bid: f64 = 0,
    best_ask: f64 = 0,
    spread: f64 = 0,
    spread_pct: f64 = 0,
    total_volume: f64 = 0,
    sources: usize = 0,
};

/// Parse comma-separated exchange list from query parameter
/// If param is empty or null, defaults to all supported exchanges
pub fn parseExchangeList(param: ?[]const u8) []const []const u8 {
    if (param == null or param.?.len == 0) {
        return &factory.SUPPORTED_EXCHANGES;
    }
    return &factory.SUPPORTED_EXCHANGES;
}

/// Fetch ticker from multiple exchanges
pub fn fetchMultiTicker(
    allocator: std.mem.Allocator,
    exchanges: []const []const u8,
    symbol: []const u8,
) ![]ExchangeTickerResult {
    // URL-decode symbol first (e.g., BTC%2FUSD → BTC/USD)
    var clean_buffer: std.ArrayList(u8) = .empty;
    defer clean_buffer.deinit(allocator);

    var idx: usize = 0;
    while (idx < symbol.len) {
        if (symbol[idx] == '%' and idx + 2 < symbol.len) {
            if (std.fmt.parseInt(u8, symbol[idx + 1 .. idx + 3], 16)) |byte| {
                try clean_buffer.append(allocator, byte);
                idx += 3;
            } else |_| {
                try clean_buffer.append(allocator, symbol[idx]);
                idx += 1;
            }
        } else {
            try clean_buffer.append(allocator, symbol[idx]);
            idx += 1;
        }
    }
    const clean_symbol = clean_buffer.items;

    const results = try allocator.alloc(ExchangeTickerResult, exchanges.len);

    for (exchanges, 0..) |exchange, i| {
        // Convert symbol to exchange-specific format
        const exchange_symbol = symbols.toExchangeFormat(allocator, exchange, clean_symbol) catch |err| {
            std.debug.print("[AGG] Failed to normalize symbol for {s}: {}\n", .{ exchange, err });
            results[i] = .{
                .exchange = exchange,
                .ticker = null,
                .err_msg = @errorName(err),
            };
            continue;
        };
        defer allocator.free(exchange_symbol);

        std.debug.print("[AGG] {s}: {s} → {s}\n", .{ exchange, clean_symbol, exchange_symbol });

        const ticker = factory.fetchTicker(allocator, exchange, "", "", exchange_symbol) catch |err| {
            std.debug.print("[AGG] ❌ Failed to fetch {s} ticker: {}\n", .{ exchange, err });
            results[i] = .{
                .exchange = exchange,
                .ticker = null,
                .err_msg = @errorName(err),
            };
            continue;
        };

        std.debug.print("[AGG] ✓ {s:10} → last=${d:8.2} bid=${d:8.2} ask=${d:8.2} vol={d:12.2}\n", .{
            exchange,
            ticker.last,
            ticker.bid,
            ticker.ask,
            ticker.baseVolume,
        });

        results[i] = .{
            .exchange = exchange,
            .ticker = ticker,
            .err_msg = "",
        };
    }

    return results;
}

/// Compute aggregated statistics from results
pub fn computeAggregatedStats(results: []const ExchangeTickerResult) AggregatedStats {
    var stats: AggregatedStats = .{};

    var price_sum: f64 = 0;
    var count: usize = 0;

    for (results) |result| {
        if (result.ticker) |ticker| {
            // Best bid = maximum bid
            if (ticker.bid > stats.best_bid) {
                stats.best_bid = ticker.bid;
            }

            // Best ask = minimum ask (closest to 0, excluding 0)
            if (ticker.ask > 0 and (stats.best_ask == 0 or ticker.ask < stats.best_ask)) {
                stats.best_ask = ticker.ask;
            }

            price_sum += ticker.last;
            stats.total_volume += ticker.baseVolume;
            count += 1;
        }
    }

    stats.sources = count;

    if (count > 0) {
        stats.avg_price = price_sum / @as(f64, @floatFromInt(count));
    }

    if (stats.best_ask > 0 and stats.best_bid > 0) {
        stats.spread = stats.best_ask - stats.best_bid;
        if (stats.best_bid > 0) {
            stats.spread_pct = (stats.spread / stats.best_bid) * 100.0;
        }
    }

    std.debug.print("[AGG-STATS] Aggregated: avg={d}, best_bid={d}, best_ask={d}, vol={d}, sources={d}\n", .{
        stats.avg_price,
        stats.best_bid,
        stats.best_ask,
        stats.total_volume,
        stats.sources,
    });

    return stats;
}

/// Build Tier1 JSON (individual exchange data)
pub fn buildTier1Json(
    allocator: std.mem.Allocator,
    results: []const ExchangeTickerResult,
) ![]const u8 {
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);
    try json.appendSlice(allocator, "{");

    var first = true;
    for (results) |result| {
        if (result.ticker) |ticker| {
            if (!first) try json.appendSlice(allocator, ",");
            first = false;

            const entry = try std.fmt.allocPrint(allocator, "\"{s}\":{{\"last\":{d},\"bid\":{d},\"ask\":{d},\"high\":{d},\"low\":{d},\"volume\":{d}}}", .{
                result.exchange,
                ticker.last,
                ticker.bid,
                ticker.ask,
                ticker.high,
                ticker.low,
                ticker.baseVolume,
            });
            defer allocator.free(entry);
            try json.appendSlice(allocator, entry);
        }
    }

    try json.appendSlice(allocator, "}");
    return allocator.dupe(u8, json.items);
}

/// Build Tier2 JSON (aggregated statistics)
pub fn buildTier2Json(
    allocator: std.mem.Allocator,
    stats: AggregatedStats,
) ![]const u8 {
    return std.fmt.allocPrint(allocator,
        "{{\"avg_price\":{d},\"best_bid\":{d},\"best_ask\":{d},\"spread\":{d},\"spread_pct\":{d},\"total_volume\":{d},\"sources\":{d}}}",
        .{ stats.avg_price, stats.best_bid, stats.best_ask, stats.spread, stats.spread_pct, stats.total_volume, stats.sources },
    );
}

/// Build meta JSON with exchange status
pub fn buildMetaJson(
    allocator: std.mem.Allocator,
    exchanges_requested: []const []const u8,
    results: []const ExchangeTickerResult,
    symbol: []const u8,
) ![]const u8 {
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(allocator);

    try json.appendSlice(allocator, "{\"exchanges_requested\":[");
    for (exchanges_requested, 0..) |exch, i| {
        if (i > 0) try json.appendSlice(allocator, ",");
        try json.appendSlice(allocator, "\"");
        try json.appendSlice(allocator, exch);
        try json.appendSlice(allocator, "\"");
    }
    try json.appendSlice(allocator, "],\"exchanges_ok\":[");

    var ok_first = true;
    for (results) |result| {
        if (result.err_msg.len == 0) {
            if (!ok_first) try json.appendSlice(allocator, ",");
            ok_first = false;
            try json.appendSlice(allocator, "\"");
            try json.appendSlice(allocator, result.exchange);
            try json.appendSlice(allocator, "\"");
        }
    }
    try json.appendSlice(allocator, "],\"exchanges_failed\":[");

    var fail_first = true;
    for (results) |result| {
        if (result.err_msg.len > 0) {
            if (!fail_first) try json.appendSlice(allocator, ",");
            fail_first = false;
            try json.appendSlice(allocator, "\"");
            try json.appendSlice(allocator, result.exchange);
            try json.appendSlice(allocator, "\"");
        }
    }

    const timestamp = @as(i64, @intCast(std.time.timestamp()));
    try json.appendSlice(allocator, "],\"symbol\":\"");
    try json.appendSlice(allocator, symbol);

    const timestamp_str = try std.fmt.allocPrint(allocator, "\",\"timestamp\":{d}}}", .{timestamp});
    defer allocator.free(timestamp_str);
    try json.appendSlice(allocator, timestamp_str);

    return allocator.dupe(u8, json.items);
}

/// Build complete aggregator response JSON
pub fn buildFullResponse(
    allocator: std.mem.Allocator,
    results: []const ExchangeTickerResult,
    symbol: []const u8,
    exchanges_requested: []const []const u8,
) ![]const u8 {
    const meta = try buildMetaJson(allocator, exchanges_requested, results, symbol);
    defer allocator.free(meta);

    const tier1 = try buildTier1Json(allocator, results);
    defer allocator.free(tier1);

    const stats = computeAggregatedStats(results);
    const tier2 = try buildTier2Json(allocator, stats);
    defer allocator.free(tier2);

    return std.fmt.allocPrint(allocator,
        "{{\"meta\":{s},\"tier1\":{s},\"tier2\":{s}}}",
        .{ meta, tier1, tier2 },
    );
}

/// Clean up results (deinit all tickers)
pub fn deinitResults(results: []ExchangeTickerResult, allocator: std.mem.Allocator) void {
    for (results) |*result| {
        if (result.ticker) |*ticker| {
            ticker.deinit(allocator);
        }
    }
    allocator.free(results);
}
