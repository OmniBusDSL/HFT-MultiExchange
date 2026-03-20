const std = @import("std");
const db = @import("src/db/database.zig");
const factory = @import("src/exchange/factory.zig");
const types = @import("src/exchange/types.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Initialize database
    try db.initDb("crypto.db");
    defer db.closeDb();

    // Get user
    const user = db.getUserByEmail("cazanalexandruflorin@gmail.com") catch {
        std.debug.print("User not found\n", .{});
        return;
    };
    defer allocator.free(user.email);

    std.debug.print("User: {s}\n", .{user.email});

    // Get API keys
    const keys = db.getApiKeysByUserId(allocator, user.id) catch {
        std.debug.print("Failed to get API keys\n", .{});
        return;
    };
    defer {
        for (keys) |key| {
            allocator.free(key.name);
            allocator.free(key.exchange);
            allocator.free(key.api_key);
            allocator.free(key.api_secret);
        }
        allocator.free(keys);
    }

    std.debug.print("\n=== Testing Open Orders ===\n", .{});

    for (keys) |key| {
        std.debug.print("\nExchange: {s} (ID: {d})\n", .{ key.exchange, key.id });

        // Test with common symbol
        const symbol = "BTC/EUR";
        
        // LCX
        if (std.mem.eql(u8, key.exchange, "lcx")) {
            const result = factory.fetchOpenOrders(allocator, key.exchange, key.api_key, key.api_secret, symbol) catch |err| {
                std.debug.print("  LCX Error: {}\n", .{err});
                return;
            };
            defer allocator.free(result.data);
            std.debug.print("  LCX Open Orders: {d}\n", .{result.data.len});
            for (result.data) |order| {
                std.debug.print("    {s} {s} @ {d} x {d} [{s}]\n", .{ order.symbol, order.side, order.price, order.amount, order.status });
            }
        }
        
        // Kraken
        if (std.mem.eql(u8, key.exchange, "kraken")) {
            const result = factory.fetchOpenOrders(allocator, key.exchange, key.api_key, key.api_secret, symbol) catch |err| {
                std.debug.print("  Kraken Error: {}\n", .{err});
                return;
            };
            defer allocator.free(result.data);
            std.debug.print("  Kraken Open Orders: {d}\n", .{result.data.len});
            for (result.data) |order| {
                std.debug.print("    {s} {s} @ {d} x {d} [{s}]\n", .{ order.symbol, order.side, order.price, order.amount, order.status });
            }
        }
        
        // Coinbase
        if (std.mem.eql(u8, key.exchange, "coinbase")) {
            const result = factory.fetchOpenOrders(allocator, key.exchange, key.api_key, key.api_secret, symbol) catch |err| {
                std.debug.print("  Coinbase Error: {}\n", .{err});
                return;
            };
            defer allocator.free(result.data);
            std.debug.print("  Coinbase Open Orders: {d}\n", .{result.data.len});
            for (result.data) |order| {
                std.debug.print("    {s} {s} @ {d} x {d} [{s}]\n", .{ order.symbol, order.side, order.price, order.amount, order.status });
            }
        }
    }
}
