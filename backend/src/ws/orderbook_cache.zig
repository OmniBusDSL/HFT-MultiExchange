const std = @import("std");

pub const PriceLevel = struct {
    price: f64,
    amount: f64,
};

pub const OrderbookEntry = struct {
    bids: [100]PriceLevel = [_]PriceLevel{.{ .price = 0, .amount = 0 }} ** 100,
    bids_len: usize = 0,
    asks: [100]PriceLevel = [_]PriceLevel{.{ .price = 0, .amount = 0 }} ** 100,
    asks_len: usize = 0,
    best_bid: f64 = 0,
    best_ask: f64 = 0,
    spread: f64 = 0,
    midpoint: f64 = 0,
    timestamp: i64 = 0,
    valid: bool = false,
};

// Global caches for each exchange
pub var lcx_cache: OrderbookEntry = .{};
pub var kraken_cache: OrderbookEntry = .{};
pub var coinbase_cache: OrderbookEntry = .{};

// Mutex to protect cache writes
pub var cache_mutex: std.Thread.Mutex = .{};

/// Get cached orderbook (read-only, makes a copy)
pub fn get(exchange: []const u8) OrderbookEntry {
    cache_mutex.lock();
    defer cache_mutex.unlock();

    if (std.mem.eql(u8, exchange, "lcx")) {
        return lcx_cache;
    } else if (std.mem.eql(u8, exchange, "kraken")) {
        return kraken_cache;
    } else if (std.mem.eql(u8, exchange, "coinbase")) {
        return coinbase_cache;
    }

    return OrderbookEntry{};
}

/// Update cache (write with mutex protection)
pub fn update(exchange: []const u8, entry: OrderbookEntry) void {
    cache_mutex.lock();
    defer cache_mutex.unlock();

    if (std.mem.eql(u8, exchange, "lcx")) {
        lcx_cache = entry;
    } else if (std.mem.eql(u8, exchange, "kraken")) {
        kraken_cache = entry;
    } else if (std.mem.eql(u8, exchange, "coinbase")) {
        coinbase_cache = entry;
    }
}

/// Serialize cache entry to JSON string (for HTTP response)
pub fn toJson(allocator: std.mem.Allocator, entry: OrderbookEntry, exchange: []const u8, symbol: []const u8) ![]u8 {
    // Build bids JSON array
    var bids_json: std.ArrayList(u8) = .empty;
    defer bids_json.deinit(allocator);
    try bids_json.appendSlice(allocator, "[");
    for (entry.bids[0..entry.bids_len], 0..) |bid, i| {
        if (i > 0) try bids_json.appendSlice(allocator, ",");
        const bid_str = try std.fmt.allocPrint(allocator, "{{\"price\":{d},\"amount\":{d}}}", .{ bid.price, bid.amount });
        defer allocator.free(bid_str);
        try bids_json.appendSlice(allocator, bid_str);
    }
    try bids_json.appendSlice(allocator, "]");

    // Build asks JSON array
    var asks_json: std.ArrayList(u8) = .empty;
    defer asks_json.deinit(allocator);
    try asks_json.appendSlice(allocator, "[");
    for (entry.asks[0..entry.asks_len], 0..) |ask, i| {
        if (i > 0) try asks_json.appendSlice(allocator, ",");
        const ask_str = try std.fmt.allocPrint(allocator, "{{\"price\":{d},\"amount\":{d}}}", .{ ask.price, ask.amount });
        defer allocator.free(ask_str);
        try asks_json.appendSlice(allocator, ask_str);
    }
    try asks_json.appendSlice(allocator, "]");

    // Build final JSON response
    const total_bid_amount = blk: {
        var sum: f64 = 0;
        for (entry.bids[0..entry.bids_len]) |bid| {
            sum += bid.amount;
        }
        break :blk sum;
    };

    const total_ask_amount = blk: {
        var sum: f64 = 0;
        for (entry.asks[0..entry.asks_len]) |ask| {
            sum += ask.amount;
        }
        break :blk sum;
    };

    const response = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"symbol\":\"{s}\",\"bestBid\":{d},\"bestAsk\":{d},\"spread\":{d},\"midpoint\":{d},\"totalBidAmount\":{d},\"totalAskAmount\":{d},\"timestamp\":{d},\"bids\":{s},\"asks\":{s}}}",
        .{ exchange, symbol, entry.best_bid, entry.best_ask, entry.spread, entry.midpoint, total_bid_amount, total_ask_amount, entry.timestamp, bids_json.items, asks_json.items });

    return response;
}
