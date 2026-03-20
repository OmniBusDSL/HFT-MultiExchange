const std = @import("std");
const lcx_ticker_types = @import("lcx_ticker_types.zig");
const json_util = @import("../utils/json.zig");

const Allocator = std.mem.Allocator;
const LocalTicker = lcx_ticker_types.LocalTicker;
const TickerData = lcx_ticker_types.TickerData;
const LcxTickerMessage = lcx_ticker_types.LcxTickerMessage;
const LcxTickerMessageType = lcx_ticker_types.LcxTickerMessageType;

/// LCX public ticker WebSocket handler
pub const LcxTickerWs = struct {
    allocator: Allocator,
    tickers: std.StringHashMap(LocalTicker),
    last_ping: i64 = 0,
    ping_interval_ms: i64 = 30000,
    on_update: ?*const fn (allocator: Allocator, pair: []const u8, ticker: *const LocalTicker) anyerror!void = null,

    pub fn init(allocator: Allocator) !LcxTickerWs {
        return LcxTickerWs{
            .allocator = allocator,
            .tickers = std.StringHashMap(LocalTicker).init(allocator),
        };
    }

    pub fn deinit(self: *LcxTickerWs) void {
        var it = self.tickers.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            entry.value_ptr.*.deinit();
        }
        self.tickers.deinit();
    }

    /// Build subscription message for all pairs (general ticker subscription)
    pub fn buildSubscribeMessage(allocator: Allocator) ![]const u8 {
        const buf = try std.fmt.allocPrint(allocator, "{{\"Topic\":\"subscribe\",\"Type\":\"ticker\"}}", .{});
        return buf;
    }

    /// Parse JSON response message from LCX
    pub fn parseMessage(allocator: Allocator, json_str: []const u8) !LcxTickerMessage {
        var msg = LcxTickerMessage{
            .allocator = allocator,
            .msg_type = .unknown,
        };

        // Simple JSON parsing - look for type field
        if (std.mem.indexOf(u8, json_str, "\"type\":\"ticker\"")) |_| {
            if (std.mem.indexOf(u8, json_str, "\"topic\":\"snapshot\"")) |_| {
                msg.msg_type = .snapshot;
            } else if (std.mem.indexOf(u8, json_str, "\"topic\":\"update\"")) |_| {
                msg.msg_type = .update;
            }

            // Extract pair
            if (std.mem.indexOf(u8, json_str, "\"pair\":\"")) |start| {
                const data_start = start + 8; // len("\"pair\":\"")
                if (std.mem.indexOf(u8, json_str[data_start..], "\"")) |end| {
                    const pair_str = json_str[data_start .. data_start + end];
                    msg.pair = try allocator.dupe(u8, pair_str);
                }
            }

            // Extract ticker data
            var ticker_data = TickerData{
                .pair = msg.pair orelse "UNKNOWN",
                .bid = 0,
                .ask = 0,
                .last = 0,
                .high = 0,
                .low = 0,
                .volume = 0,
            };

            // Parse bid
            if (json_util.getFloatValue(json_str, "bid")) |bid| {
                ticker_data.bid = bid;
            }

            // Parse ask
            if (json_util.getFloatValue(json_str, "ask")) |ask| {
                ticker_data.ask = ask;
            }

            // Parse last
            if (json_util.getFloatValue(json_str, "last")) |last| {
                ticker_data.last = last;
            }

            // Parse high
            if (json_util.getFloatValue(json_str, "high")) |high| {
                ticker_data.high = high;
            }

            // Parse low
            if (json_util.getFloatValue(json_str, "low")) |low| {
                ticker_data.low = low;
            }

            // Parse volume
            if (json_util.getFloatValue(json_str, "volume")) |vol| {
                ticker_data.volume = vol;
            }

            msg.data = ticker_data;
        } else if (std.mem.indexOf(u8, json_str, "\"type\":\"ping\"")) |_| {
            msg.msg_type = .ping;
        }

        return msg;
    }

    /// Process incoming ticker message
    pub fn processMessage(self: *LcxTickerWs, msg: *const LcxTickerMessage) !void {
        if (msg.data) |data| {
            var ticker = try self.getOrCreateTicker(data.pair);
            ticker.update(data);

            if (self.on_update) |callback| {
                try callback(self.allocator, data.pair, &ticker);
            }
        }
    }

    /// Get or create ticker for pair
    fn getOrCreateTicker(self: *LcxTickerWs, pair: []const u8) !LocalTicker {
        if (self.tickers.get(pair)) |*ticker| {
            return ticker.*;
        }

        var new_ticker = try LocalTicker.init(self.allocator, pair);
        try self.tickers.put(try self.allocator.dupe(u8, pair), new_ticker);
        return new_ticker;
    }

    /// Get all tickers as array
    pub fn getAllTickers(self: *LcxTickerWs, allocator: Allocator) ![]TickerData {
        var tickers = try std.ArrayList(TickerData).initCapacity(allocator, self.tickers.count());
        defer tickers.deinit();

        var it = self.tickers.iterator();
        while (it.next()) |entry| {
            try tickers.append(entry.value_ptr.*.toData());
        }

        return try tickers.toOwnedSlice();
    }
};
