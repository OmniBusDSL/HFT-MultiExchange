const std = @import("std");

/// LCX orderbook price level (price, amount)
pub const PriceLevel = struct {
    price: f64,
    amount: f64,
};

/// LCX orderbook snapshot and updates
pub const OrderbookData = struct {
    pair: []const u8,
    buy: []PriceLevel,  // bids - sorted descending by price
    sell: []PriceLevel, // asks - sorted ascending by price
};

/// LCX orderbook message types
pub const LcxMessageType = enum {
    subscribe,
    snapshot,
    update,
    ping,
    unknown,
};

/// LCX orderbook message
pub const LcxOrderbookMessage = struct {
    allocator: std.mem.Allocator,
    msg_type: LcxMessageType,
    pair: ?[]const u8 = null,
    data: ?OrderbookData = null,

    pub fn deinit(self: *LcxOrderbookMessage) void {
        if (self.pair) |pair| {
            self.allocator.free(pair);
        }
        if (self.data) |data| {
            self.allocator.free(data.buy);
            self.allocator.free(data.sell);
            self.allocator.free(data.pair);
        }
    }
};

/// Local orderbook state manager (simplified without ArrayList)
pub const LocalOrderbook = struct {
    allocator: std.mem.Allocator,
    pair: []const u8,
    bids: []PriceLevel,     // bid prices in descending order
    bids_len: usize = 0,
    asks: []PriceLevel,     // ask prices in ascending order
    asks_len: usize = 0,
    last_update: i64,

    pub fn init(allocator: std.mem.Allocator, pair: []const u8) !LocalOrderbook {
        const max_levels = 100; // Max price levels to track
        return LocalOrderbook{
            .allocator = allocator,
            .pair = try allocator.dupe(u8, pair),
            .bids = try allocator.alloc(PriceLevel, max_levels),
            .asks = try allocator.alloc(PriceLevel, max_levels),
            .last_update = 0,
        };
    }

    pub fn deinit(self: *LocalOrderbook) void {
        self.allocator.free(self.pair);
        self.allocator.free(self.bids);
        self.allocator.free(self.asks);
    }

    /// Apply snapshot (replaces current orderbook)
    pub fn applySnapshot(self: *LocalOrderbook, data: OrderbookData) !void {
        // Clear existing data
        self.bids_len = 0;
        self.asks_len = 0;

        // Copy bids (already sorted descending)
        const bid_count = @min(data.buy.len, self.bids.len);
        for (data.buy[0..bid_count]) |level| {
            self.bids[self.bids_len] = level;
            self.bids_len += 1;
        }

        // Copy asks (already sorted ascending)
        const ask_count = @min(data.sell.len, self.asks.len);
        for (data.sell[0..ask_count]) |level| {
            self.asks[self.asks_len] = level;
            self.asks_len += 1;
        }

        self.last_update = std.time.milliTimestamp();
    }

    /// Apply delta update (updates specific levels or adds new ones)
    pub fn applyUpdate(self: *LocalOrderbook, updates: []const PriceLevel, side: []const u8) !void {
        const is_buy = std.mem.eql(u8, side, "buy");
        const list_ptr = if (is_buy) &self.bids_len else &self.asks_len;
        const array = if (is_buy) self.bids else self.asks;

        for (updates) |update| {
            // Find or create level
            var found = false;
            for (array[0..list_ptr.*], 0..) |*level, idx| {
                if (level.price == update.price) {
                    if (update.amount == 0) {
                        // Remove level - shift remaining items
                        for (idx..list_ptr.* - 1) |j| {
                            array[j] = array[j + 1];
                        }
                        list_ptr.* -= 1;
                    } else {
                        level.amount = update.amount;
                    }
                    found = true;
                    break;
                }
            }

            // Add new level if not found and amount > 0
            if (!found and update.amount > 0 and list_ptr.* < array.len) {
                array[list_ptr.*] = update;
                list_ptr.* += 1;
            }
        }

        self.last_update = std.time.milliTimestamp();
    }

    /// Get best bid (highest price on buy side)
    pub fn bestBid(self: *const LocalOrderbook) ?PriceLevel {
        if (self.bids_len > 0) return self.bids[0];
        return null;
    }

    /// Get best ask (lowest price on sell side)
    pub fn bestAsk(self: *const LocalOrderbook) ?PriceLevel {
        if (self.asks_len > 0) return self.asks[0];
        return null;
    }

    /// Get spread (best ask - best bid)
    pub fn getSpread(self: *const LocalOrderbook) ?f64 {
        const bid = self.bestBid() orelse return null;
        const ask = self.bestAsk() orelse return null;
        return ask.price - bid.price;
    }

    /// Get midpoint ((best bid + best ask) / 2)
    pub fn getMidpoint(self: *const LocalOrderbook) ?f64 {
        const bid = self.bestBid() orelse return null;
        const ask = self.bestAsk() orelse return null;
        return (bid.price + ask.price) / 2.0;
    }
};
