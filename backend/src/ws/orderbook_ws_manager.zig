/// WebSocket Orderbook Manager — maintains live connections to exchanges
/// and caches orderbook data for public REST API endpoints.
///
/// Architecture:
/// - Global singleton g_manager started at backend init
/// - 3 background threads: one per exchange (LCX, Kraken, Coinbase)
/// - Thread-safe cache (StringHashMap) protected by Mutex
/// - Each thread connects via WebSocket, subscribes to orderbook feeds
/// - Parses exchange-specific message formats, updates cache
///
/// Public API endpoint: /public/orderbook-ws?exchange=lcx&symbol=BTC/USD

const std = @import("std");
const ws_client = @import("ws_client.zig");
const lcx_types = @import("lcx_types.zig");
const lcx_ob_ws = @import("lcx_orderbook_ws.zig");
const factory = @import("../exchange/factory.zig");
const types = @import("../exchange/types.zig");

const Allocator = std.mem.Allocator;
const WsState = ws_client.WsState;
const WsConfig = ws_client.WsConfig;

/// Cached price level (bid or ask)
pub const PriceLevelCached = struct {
    price: f64,
    amount: f64,
};

/// Cached orderbook for a single (exchange, symbol) pair
pub const CachedOrderbook = struct {
    allocator: Allocator,
    exchange: []const u8,
    symbol: []const u8,
    bids: std.ArrayList(PriceLevelCached),
    asks: std.ArrayList(PriceLevelCached),
    best_bid: f64 = 0,
    best_ask: f64 = 0,
    spread: f64 = 0,
    midpoint: f64 = 0,
    timestamp: i64 = 0,

    pub fn init(allocator: Allocator, exchange: []const u8, symbol: []const u8) !CachedOrderbook {
        const bids: std.ArrayList(PriceLevelCached) = .empty;
        const asks: std.ArrayList(PriceLevelCached) = .empty;
        return CachedOrderbook{
            .allocator = allocator,
            .exchange = try allocator.dupe(u8, exchange),
            .symbol = try allocator.dupe(u8, symbol),
            .bids = bids,
            .asks = asks,
        };
    }

    pub fn deinit(self: *CachedOrderbook) void {
        self.allocator.free(self.exchange);
        self.allocator.free(self.symbol);
        self.bids.deinit(self.allocator);
        self.asks.deinit(self.allocator);
    }

    pub fn updateFromLcxSnapshot(
        self: *CachedOrderbook,
        data: lcx_types.OrderbookData,
    ) !void {
        self.bids.clearRetainingCapacity();
        self.asks.clearRetainingCapacity();

        // Add bids (buy orders)
        for (data.buy) |level| {
            try self.bids.append(.{
                .price = level.price,
                .amount = level.amount,
            });
        }

        // Add asks (sell orders)
        for (data.sell) |level| {
            try self.asks.append(.{
                .price = level.price,
                .amount = level.amount,
            });
        }

        // Sort: bids descending, asks ascending
        std.mem.sort(PriceLevelCached, self.bids.items, {}, compDescByPrice);
        std.mem.sort(PriceLevelCached, self.asks.items, {}, compAscByPrice);

        self.updateStats();
    }

    fn updateStats(self: *CachedOrderbook) void {
        self.best_bid = if (self.bids.items.len > 0) self.bids.items[0].price else 0;
        self.best_ask = if (self.asks.items.len > 0) self.asks.items[0].price else 0;
        self.spread = if (self.best_bid > 0 and self.best_ask > 0)
            self.best_ask - self.best_bid
        else
            0;
        self.midpoint = if (self.best_bid > 0 and self.best_ask > 0)
            (self.best_bid + self.best_ask) / 2.0
        else
            0;
        self.timestamp = std.time.timestamp();
    }

    pub fn toJson(self: *const CachedOrderbook, allocator: Allocator) ![]const u8 {
        var json: std.ArrayList(u8) = .empty;
        defer json.deinit(allocator);

        try json.writer(allocator).print("{{\"exchange\":\"{s}\",\"symbol\":\"{s}\",", .{ self.exchange, self.symbol });
        try json.writer(allocator).print("\"bestBid\":{d},\"bestAsk\":{d},\"spread\":{d},\"midpoint\":{d},\"timestamp\":{d},", .{
            self.best_bid, self.best_ask, self.spread, self.midpoint, self.timestamp,
        });

        // Bids array
        try json.appendSlice(allocator, "\"bids\":[");
        for (self.bids.items, 0..) |bid, i| {
            if (i > 0) try json.appendSlice(allocator, ",");
            try json.writer(allocator).print("{{\"price\":{d},\"amount\":{d}}}", .{ bid.price, bid.amount });
        }
        try json.appendSlice(allocator, "],");

        // Asks array
        try json.appendSlice(allocator, "\"asks\":[");
        for (self.asks.items, 0..) |ask, i| {
            if (i > 0) try json.appendSlice(allocator, ",");
            try json.writer(allocator).print("{{\"price\":{d},\"amount\":{d}}}", .{ ask.price, ask.amount });
        }
        try json.appendSlice(allocator, "]}");

        return json.toOwnedSlice(allocator);
    }
};

fn compDescByPrice(ctx: void, a: PriceLevelCached, b: PriceLevelCached) bool {
    _ = ctx;
    return a.price > b.price;
}

fn compAscByPrice(ctx: void, a: PriceLevelCached, b: PriceLevelCached) bool {
    _ = ctx;
    return a.price < b.price;
}

/// Global singleton manager — initialized at backend startup
pub var g_manager: ?*OrderbookWsManager = null;

pub const OrderbookWsManager = struct {
    allocator: Allocator,
    mutex: std.Thread.Mutex = .{},
    cache: std.StringHashMap(CachedOrderbook),
    running: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

    pub fn init(allocator: Allocator) !*OrderbookWsManager {
        const mgr = try allocator.create(OrderbookWsManager);
        mgr.allocator = allocator;
        mgr.cache = std.StringHashMap(CachedOrderbook).init(allocator);
        mgr.running = std.atomic.Value(bool).init(true);
        return mgr;
    }

    pub fn deinit(self: *OrderbookWsManager) void {
        self.running.store(false, .release);

        self.mutex.lock();
        defer self.mutex.unlock();

        var it = self.cache.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit();
        }
        self.cache.deinit();

        self.allocator.destroy(self);
    }

    pub fn startAll(self: *OrderbookWsManager) !void {
        _ = try std.Thread.spawn(.{}, lcxThread, .{self});
        _ = try std.Thread.spawn(.{}, krakenThread, .{self});
        _ = try std.Thread.spawn(.{}, coinbaseThread, .{self});
    }

    pub fn getOrderbook(self: *OrderbookWsManager, key: []const u8) ?CachedOrderbook {
        self.mutex.lock();
        defer self.mutex.unlock();

        if (self.cache.get(key)) |ob| {
            return ob;
        }
        return null;
    }

    pub fn updateOrderbook(self: *OrderbookWsManager, key: []const u8, ob: CachedOrderbook) !void {
        self.mutex.lock();
        defer self.mutex.unlock();

        // Remove old entry if exists
        if (self.cache.getPtr(key)) |old| {
            old.deinit();
            _ = self.cache.remove(key);
        }

        try self.cache.put(try self.allocator.dupe(u8, key), ob);
    }
};

/// LCX Polling thread — fetches orderbook via REST API periodically
/// TODO: Upgrade to WebSocket when TLS support is added
fn lcxThread(mgr: *OrderbookWsManager) void {
    const pairs = [_][]const u8{
        "LCX/USDC",
        "BTC/EUR",
        "ETH/EUR",
        "BTC/USDC",
        "XRP/EUR",
        "BTC/USD",
    };

    std.debug.print("[LCX-POLL] Thread started\n", .{});

    var iteration: u32 = 0;
    while (mgr.running.load(.acquire)) {
        iteration += 1;
        std.debug.print("[LCX-POLL] Starting fetch cycle {d}...\n", .{iteration});
        fetchAndCacheLcx(mgr, &pairs) catch |err| {
            std.debug.print("[LCX-POLL] Fetch error: {} — retrying in 10s\n", .{err});
        };

        // Poll every 10 seconds
        std.debug.print("[LCX-POLL] Sleeping 10 seconds...\n", .{});
        std.Thread.sleep(10 * std.time.ns_per_s);
    }

    std.debug.print("[LCX-POLL] Thread stopped\n", .{});
}

fn fetchAndCacheLcx(mgr: *OrderbookWsManager, pairs: []const []const u8) !void {
    const allocator = mgr.allocator;

    for (pairs) |pair| {
        // Fetch real orderbook data from LCX API
        std.debug.print("[LCX-POLL] Fetching {s}...\n", .{pair});
        const ob_data = factory.fetchOrderBook(allocator, "lcx", "", "", pair, null) catch |err| {
            std.debug.print("[LCX-POLL] Failed to fetch {s}: {} (may not be available)\n", .{ pair, err });
            continue;
        };
        defer {
            allocator.free(ob_data.symbol);
            allocator.free(ob_data.bids);
            allocator.free(ob_data.asks);
            allocator.free(ob_data.datetime);
        }

        var ob = try CachedOrderbook.init(allocator, "lcx", pair);

        // Convert from types.OrderBook to CachedOrderbook
        for (ob_data.bids) |level| {
            try ob.bids.append(allocator, .{
                .price = level.price,
                .amount = level.amount,
            });
        }

        for (ob_data.asks) |level| {
            try ob.asks.append(allocator, .{
                .price = level.price,
                .amount = level.amount,
            });
        }

        ob.updateStats();

        const key = try std.fmt.allocPrint(allocator, "lcx:{s}", .{pair});
        try mgr.updateOrderbook(key, ob);
        allocator.free(key);

        std.debug.print("[LCX-POLL] ✓ Cached {s} (bids={d} asks={d})\n", .{ pair, ob.bids.items.len, ob.asks.items.len });
    }
}

/// Kraken Polling thread
fn krakenThread(mgr: *OrderbookWsManager) void {
    const pairs = [_][]const u8{
        "BTC/USD",
        "ETH/USD",
        "BTC/EUR",
        "SOL/USD",
    };

    std.debug.print("[KRAKEN-POLL] Thread started\n", .{});

    while (mgr.running.load(.acquire)) {
        std.debug.print("[KRAKEN-POLL] Starting fetch cycle...\n", .{});
        fetchAndCacheKraken(mgr, &pairs) catch |err| {
            std.debug.print("[KRAKEN-POLL] Fetch error: {} — retrying in 10s\n", .{err});
        };

        std.Thread.sleep(10 * std.time.ns_per_s);
    }

    std.debug.print("[KRAKEN-POLL] Thread stopped\n", .{});
}

fn fetchAndCacheKraken(mgr: *OrderbookWsManager, pairs: []const []const u8) !void {
    const allocator = mgr.allocator;

    for (pairs) |pair| {
        // Fetch real orderbook data from Kraken API
        std.debug.print("[KRAKEN-POLL] Fetching {s}...\n", .{pair});
        const ob_data = factory.fetchOrderBook(allocator, "kraken", "", "", pair, null) catch |err| {
            std.debug.print("[KRAKEN-POLL] Failed to fetch {s}: {} (may not be available)\n", .{ pair, err });
            continue;
        };
        defer {
            allocator.free(ob_data.symbol);
            allocator.free(ob_data.bids);
            allocator.free(ob_data.asks);
            allocator.free(ob_data.datetime);
        }

        var ob = try CachedOrderbook.init(allocator, "kraken", pair);

        // Convert from types.OrderBook to CachedOrderbook
        for (ob_data.bids) |level| {
            try ob.bids.append(allocator, .{
                .price = level.price,
                .amount = level.amount,
            });
        }

        for (ob_data.asks) |level| {
            try ob.asks.append(allocator, .{
                .price = level.price,
                .amount = level.amount,
            });
        }

        ob.updateStats();

        const key = try std.fmt.allocPrint(allocator, "kraken:{s}", .{pair});
        try mgr.updateOrderbook(key, ob);
        allocator.free(key);

        std.debug.print("[KRAKEN-POLL] ✓ Cached {s} (bids={d} asks={d})\n", .{ pair, ob.bids.items.len, ob.asks.items.len });
    }
}

/// Coinbase Polling thread
fn coinbaseThread(mgr: *OrderbookWsManager) void {
    const pairs = [_][]const u8{
        "BTC/USD",
        "ETH/USD",
        "SOL/USD",
    };

    std.debug.print("[COINBASE-POLL] Thread started\n", .{});

    while (mgr.running.load(.acquire)) {
        std.debug.print("[COINBASE-POLL] Starting fetch cycle...\n", .{});
        fetchAndCacheCoinbase(mgr, &pairs) catch |err| {
            std.debug.print("[COINBASE-POLL] Fetch error: {} — retrying in 10s\n", .{err});
        };

        std.Thread.sleep(10 * std.time.ns_per_s);
    }

    std.debug.print("[COINBASE-POLL] Thread stopped\n", .{});
}

fn fetchAndCacheCoinbase(mgr: *OrderbookWsManager, pairs: []const []const u8) !void {
    const allocator = mgr.allocator;

    for (pairs) |pair| {
        // Fetch real orderbook data from Coinbase API
        std.debug.print("[COINBASE-POLL] Fetching {s}...\n", .{pair});
        const ob_data = factory.fetchOrderBook(allocator, "coinbase", "", "", pair, null) catch |err| {
            std.debug.print("[COINBASE-POLL] Failed to fetch {s}: {} (may not be available)\n", .{ pair, err });
            continue;
        };
        defer {
            allocator.free(ob_data.symbol);
            allocator.free(ob_data.bids);
            allocator.free(ob_data.asks);
            allocator.free(ob_data.datetime);
        }

        var ob = try CachedOrderbook.init(allocator, "coinbase", pair);

        // Convert from types.OrderBook to CachedOrderbook
        for (ob_data.bids) |level| {
            try ob.bids.append(allocator, .{
                .price = level.price,
                .amount = level.amount,
            });
        }

        for (ob_data.asks) |level| {
            try ob.asks.append(allocator, .{
                .price = level.price,
                .amount = level.amount,
            });
        }

        ob.updateStats();

        const key = try std.fmt.allocPrint(allocator, "coinbase:{s}", .{pair});
        try mgr.updateOrderbook(key, ob);
        allocator.free(key);

        std.debug.print("[COINBASE-POLL] ✓ Cached {s} (bids={d} asks={d})\n", .{ pair, ob.bids.items.len, ob.asks.items.len });
    }
}
