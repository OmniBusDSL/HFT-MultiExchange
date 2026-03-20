const std = @import("std");
const lcx_types = @import("lcx_types.zig");
const ws_types = @import("types.zig");
const json_util = @import("../utils/json.zig");

const Allocator = std.mem.Allocator;
const LocalOrderbook = lcx_types.LocalOrderbook;
const OrderbookData = lcx_types.OrderbookData;
const PriceLevel = lcx_types.PriceLevel;
const LcxOrderbookMessage = lcx_types.LcxOrderbookMessage;

/// LCX public orderbook WebSocket handler
pub const LcxOrderbookWs = struct {
    allocator: Allocator,
    pair: []const u8,
    orderbooks: std.StringHashMap(LocalOrderbook),
    last_ping: i64 = 0,
    ping_interval_ms: i64 = 30000,
    on_snapshot: ?*const fn (allocator: Allocator, pair: []const u8, orderbook: *const LocalOrderbook) anyerror!void = null,
    on_update: ?*const fn (allocator: Allocator, pair: []const u8, orderbook: *const LocalOrderbook) anyerror!void = null,

    pub fn init(allocator: Allocator, pair: []const u8) !LcxOrderbookWs {
        return LcxOrderbookWs{
            .allocator = allocator,
            .pair = try allocator.dupe(u8, pair),
            .orderbooks = std.StringHashMap(LocalOrderbook).init(allocator),
        };
    }

    pub fn deinit(self: *LcxOrderbookWs) void {
        self.allocator.free(self.pair);
        var it = self.orderbooks.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            entry.value_ptr.*.deinit();
        }
        self.orderbooks.deinit();
    }

    /// Build subscription message for pair
    pub fn buildSubscribeMessage(allocator: Allocator, pair: []const u8) ![]const u8 {
        const buf = try std.fmt.allocPrint(allocator, "{{\"Topic\":\"subscribe\",\"Type\":\"orderbook\",\"Pair\":\"{s}\"}}", .{pair});
        return buf;
    }

    /// Parse JSON response message from LCX
    pub fn parseMessage(allocator: Allocator, json_str: []const u8) !LcxOrderbookMessage {
        var msg = LcxOrderbookMessage{
            .allocator = allocator,
            .msg_type = .unknown,
        };

        // Simple JSON parsing - look for type field
        if (std.mem.indexOf(u8, json_str, "\"type\":\"orderbook\"")) |_| {
            if (std.mem.indexOf(u8, json_str, "\"topic\":\"snapshot\"")) |_| {
                msg.msg_type = .snapshot;
            } else if (std.mem.indexOf(u8, json_str, "\"topic\":\"update\"")) |_| {
                msg.msg_type = .update;
            }

            // Extract pair
            if (extractJsonString(allocator, json_str, "pair")) |pair| {
                msg.pair = pair;
            }

            // Extract data
            if (extractOrderbookData(allocator, json_str)) |data| {
                msg.data = data;
            }
        } else if (std.mem.indexOf(u8, json_str, "\"Topic\":\"ping\"")) |_| {
            msg.msg_type = .ping;
        }

        return msg;
    }

    /// Handle incoming message
    pub fn handleMessage(self: *LcxOrderbookWs, msg: LcxOrderbookMessage) !void {
        switch (msg.msg_type) {
            .snapshot => {
                if (msg.pair) |pair| {
                    var ob = self.orderbooks.get(pair) orelse try LocalOrderbook.init(self.allocator, pair);
                    if (msg.data) |data| {
                        try ob.applySnapshot(data);
                    }
                    try self.orderbooks.put(try self.allocator.dupe(u8, pair), ob);

                    if (self.on_snapshot) |callback| {
                        try callback(self.allocator, pair, &ob);
                    }
                }
            },
            .update => {
                if (msg.pair) |pair| {
                    if (self.orderbooks.getPtr(pair)) |ob| {
                        if (msg.data) |data| {
                            // Updates come as [[price, amount, side], ...]
                            // For now, we just update with buy side
                            try ob.applyUpdate(data.buy, "buy");

                            if (self.on_update) |callback| {
                                try callback(self.allocator, pair, ob);
                            }
                        }
                    }
                }
            },
            .ping => {
                self.last_ping = std.time.milliTimestamp();
            },
            .unknown => {
                // Ignore unknown messages
            },
            .subscribe => {},
        }
    }

    /// Check if ping is needed
    pub fn needsPing(self: *const LcxOrderbookWs) bool {
        const now = std.time.milliTimestamp();
        return (now - self.last_ping) > self.ping_interval_ms;
    }

    /// Get current orderbook for pair
    pub fn getOrderbook(self: *const LcxOrderbookWs, pair: []const u8) ?*const LocalOrderbook {
        return self.orderbooks.getPtr(pair);
    }
};

/// Helper: Extract string value from JSON
fn extractJsonString(allocator: Allocator, json: []const u8, key: []const u8) ?[]const u8 {
    // Build search string: "key":"
    var buf: [256]u8 = undefined;
    const written = std.fmt.bufPrint(&buf, "\"{s}\":\"", .{key}) catch return null;
    const search = written;

    if (std.mem.indexOf(u8, json, search)) |start_idx| {
        const start = start_idx + search.len;
        if (std.mem.indexOf(u8, json[start..], "\"")) |end_idx| {
            const value = allocator.dupe(u8, json[start .. start + end_idx]) catch return null;
            return value;
        }
    }

    return null;
}

/// Helper: Extract orderbook data from JSON
fn extractOrderbookData(allocator: Allocator, json: []const u8) ?OrderbookData {
    var data = OrderbookData{
        .pair = "",
        .buy = &[_]PriceLevel{},
        .sell = &[_]PriceLevel{},
    };

    // Look for "data" field containing [[[price, amount], ...]]
    // This is simplified - real implementation would use proper JSON parser
    if (std.mem.indexOf(u8, json, "\"data\"")) |_| {
        // For now, allocate empty arrays
        // Full implementation will parse the nested arrays
        data.buy = allocator.alloc(PriceLevel, 0) catch return null;
        data.sell = allocator.alloc(PriceLevel, 0) catch return null;
        return data;
    }

    return null;
}
