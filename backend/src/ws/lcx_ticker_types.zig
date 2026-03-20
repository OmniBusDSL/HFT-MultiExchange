const std = @import("std");

/// LCX ticker data (bid, ask, last, etc)
pub const TickerData = struct {
    pair: []const u8,
    bid: f64,
    ask: f64,
    last: f64,
    high: f64,
    low: f64,
    volume: f64,
};

/// LCX ticker message types
pub const LcxTickerMessageType = enum {
    subscribe,
    snapshot,
    update,
    ping,
    unknown,
};

/// LCX ticker message
pub const LcxTickerMessage = struct {
    allocator: std.mem.Allocator,
    msg_type: LcxTickerMessageType,
    pair: ?[]const u8 = null,
    data: ?TickerData = null,

    pub fn deinit(self: *LcxTickerMessage) void {
        if (self.pair) |pair| {
            self.allocator.free(pair);
        }
    }
};

/// Local ticker state tracker
pub const LocalTicker = struct {
    allocator: std.mem.Allocator,
    pair: []const u8,
    bid: f64 = 0,
    ask: f64 = 0,
    last: f64 = 0,
    high: f64 = 0,
    low: f64 = 0,
    volume: f64 = 0,
    last_update: i64,

    pub fn init(allocator: std.mem.Allocator, pair: []const u8) !LocalTicker {
        return LocalTicker{
            .allocator = allocator,
            .pair = try allocator.dupe(u8, pair),
            .last_update = std.time.milliTimestamp(),
        };
    }

    pub fn deinit(self: *LocalTicker) void {
        self.allocator.free(self.pair);
    }

    /// Update ticker with new data
    pub fn update(self: *LocalTicker, data: TickerData) void {
        self.bid = data.bid;
        self.ask = data.ask;
        self.last = data.last;
        self.high = data.high;
        self.low = data.low;
        self.volume = data.volume;
        self.last_update = std.time.milliTimestamp();
    }

    /// Get ticker as TickerData
    pub fn toData(self: *const LocalTicker) TickerData {
        return TickerData{
            .pair = self.pair,
            .bid = self.bid,
            .ask = self.ask,
            .last = self.last,
            .high = self.high,
            .low = self.low,
            .volume = self.volume,
        };
    }
};
