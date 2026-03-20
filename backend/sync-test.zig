const std = @import("std");
const database = @import("src/db/database.zig");
const exchange_factory = @import("src/exchange/factory.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var db = try database.Database.init(allocator, "exchange.db");
    defer db.deinit();

    std.debug.print("\n🔄 Starting pair sync for all exchanges...\n", .{});

    const exchanges = [_][]const u8{ "lcx", "kraken", "coinbase" };

    for (exchanges) |exchange| {
        std.debug.print("\n📍 Syncing {s}...\n", .{exchange});

        const markets = exchange_factory.fetchMarkets(allocator, exchange, "", "") catch |err| {
            std.debug.print("❌ Failed to fetch {s}: {}\n", .{ exchange, err });
            continue;
        };
        defer allocator.free(markets);

        if (markets.len == 0) {
            std.debug.print("⚠️  No pairs returned for {s}\n", .{exchange});
            continue;
        }

        var symbols: std.ArrayList([]const u8) = .empty;
        defer symbols.deinit(allocator);

        for (markets) |market| {
            try symbols.append(allocator, market.symbol);
        }

        db.storePairsForExchange(exchange, symbols.items) catch |err| {
            std.debug.print("❌ Failed to store {s}: {}\n", .{ exchange, err });
            continue;
        };

        std.debug.print("✅ Stored {d} pairs for {s}\n", .{ markets.len, exchange });

        // Verify by reading back
        const stored_pairs = db.getPairsForExchange(allocator, exchange) catch |err| {
            std.debug.print("❌ Failed to read {s}: {}\n", .{ exchange, err });
            continue;
        };
        defer {
            for (stored_pairs) |pair| {
                allocator.free(pair);
            }
            allocator.free(stored_pairs);
        }

        std.debug.print("📊 Verified: {d} pairs in database for {s}\n", .{ stored_pairs.len, exchange });

        // Show first 5 pairs
        for (stored_pairs[0..@min(5, stored_pairs.len)]) |pair| {
            std.debug.print("   - {s}\n", .{pair});
        }
    }

    std.debug.print("\n✨ Sync complete!\n\n", .{});
}
