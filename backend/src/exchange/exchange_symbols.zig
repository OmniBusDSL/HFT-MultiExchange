/// Exchange symbols manager
/// Returns known available trading symbols per exchange

const std = @import("std");

pub const ExchangeSymbols = struct {
    const Allocator = std.mem.Allocator;

    // Known pairs for each exchange (same as backend polling)
    const lcx_pairs = [_][]const u8{
        "LCX/USDC", "BTC/EUR", "ETH/EUR", "BTC/USDC", "XRP/EUR", "BTC/USD",
    };

    const kraken_pairs = [_][]const u8{
        "BTC/USD", "ETH/USD", "BTC/EUR", "SOL/USD",
    };

    const coinbase_pairs = [_][]const u8{
        "BTC/USD", "ETH/USD", "SOL/USD",
    };

    /// Cache all known symbols for all exchanges on startup
    pub fn fetchAndCacheAllSymbols(
        _: Allocator,
        db: anytype,
    ) !void {
        // Cache LCX pairs
        for (lcx_pairs) |pair| {
            db.cacheMarketTicker("lcx", pair) catch |err| {
                std.debug.print("[SYMBOLS] Warning: Failed to cache {s} for lcx: {}\n", .{ pair, err });
            };
        }
        std.debug.print("[SYMBOLS] ✓ Cached {d} symbols for lcx\n", .{lcx_pairs.len});

        // Cache Kraken pairs
        for (kraken_pairs) |pair| {
            db.cacheMarketTicker("kraken", pair) catch |err| {
                std.debug.print("[SYMBOLS] Warning: Failed to cache {s} for kraken: {}\n", .{ pair, err });
            };
        }
        std.debug.print("[SYMBOLS] ✓ Cached {d} symbols for kraken\n", .{kraken_pairs.len});

        // Cache Coinbase pairs
        for (coinbase_pairs) |pair| {
            db.cacheMarketTicker("coinbase", pair) catch |err| {
                std.debug.print("[SYMBOLS] Warning: Failed to cache {s} for coinbase: {}\n", .{ pair, err });
            };
        }
        std.debug.print("[SYMBOLS] ✓ Cached {d} symbols for coinbase\n", .{coinbase_pairs.len});
    }

    /// Get LCX trading pairs
    pub fn getLcxPairs() []const []const u8 {
        return &lcx_pairs;
    }

    /// Get Kraken trading pairs
    pub fn getKrakenPairs() []const []const u8 {
        return &kraken_pairs;
    }

    /// Get Coinbase trading pairs
    pub fn getCoinbasePairs() []const []const u8 {
        return &coinbase_pairs;
    }
};
