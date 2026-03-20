const std = @import("std");
const db = @import("src/db/database.zig");
const lcx = @import("src/exchange/lcx.zig");
const types = @import("src/exchange/types.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Initialize database
    var database_instance = try db.Database.init(allocator, "exchange.db");
    defer database_instance.deinit();

    std.debug.print("\n=== Testing LCX fetchOpenOrders (NEW SIGNATURE) ===\n\n", .{});

    // Get user
    const user = database_instance.getUserByEmail(allocator, "cazanalexandruflorin@gmail.com") catch {
        std.debug.print("User not found\n", .{});
        return;
    };
    defer allocator.free(user.email);

    // Get LCX API keys
    const keys = database_instance.getApiKeysByUserId(allocator, user.id) catch {
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

    for (keys) |key| {
        if (!std.mem.eql(u8, key.exchange, "lcx")) continue;

        std.debug.print("Testing LCX API Key: {s}\n", .{key.name});
        std.debug.print("API Key length: {d}\n", .{key.api_key.len});
        std.debug.print("API Secret length: {d}\n\n", .{key.api_secret.len});

        // Call fetchOpenOrders (which now uses "{}" for signature)
        std.debug.print("Calling fetchOpenOrders...\n", .{});
        const result = lcx.fetchOpenOrders(allocator, key.api_key, key.api_secret, null) catch |err| {
            std.debug.print("ERROR: {}\n", .{err});
            return;
        };
        defer allocator.free(result.data);

        std.debug.print("\nResult: {d} open orders\n", .{result.data.len});
        for (result.data) |order| {
            std.debug.print("  [{s}] {s} {s} @ {d} x {d} [{s}]\n",
                .{ order.id, order.symbol, order.side, order.price, order.amount, order.status }
            );
        }
    }
}
