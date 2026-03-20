const std = @import("std");
const db = @import("src/db/database.zig");
const lcx = @import("src/exchange/lcx.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Initialize database
    var database_instance = try db.Database.init(allocator, "exchange.db");
    defer database_instance.deinit();

    std.debug.print("\n========================================\n", .{});
    std.debug.print("COMPARING: Balance (✅ works) vs OpenOrders (❌ fails)\n", .{});
    std.debug.print("========================================\n\n", .{});

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

        std.debug.print("API Key: {s}\n", .{key.api_key[0..@min(16, key.api_key.len)]});
        std.debug.print("API Secret: {s}...\n\n", .{key.api_secret[0..@min(16, key.api_secret.len)]});

        std.debug.print("========== TEST 1: BALANCE (✅ WORKS) ==========\n", .{});
        const balance = lcx.fetchBalance(allocator, key.api_key, key.api_secret) catch |err| {
            std.debug.print("ERROR: {}\n", .{err});
            return;
        };
        defer {
            var it = balance.iterator();
            while (it.next()) |entry| {
                allocator.free(entry.key_ptr.*);
                allocator.free(entry.value_ptr.free);
                allocator.free(entry.value_ptr.used);
                allocator.free(entry.value_ptr.total);
            }
            balance.deinit();
        }
        std.debug.print("Balance: {d} currencies loaded\n\n", .{balance.count()});

        std.debug.print("========== TEST 2: OPEN ORDERS (❌ FAILS) ==========\n", .{});
        const orders = lcx.fetchOpenOrders(allocator, key.api_key, key.api_secret, null) catch |err| {
            std.debug.print("ERROR: {}\n", .{err});
            return;
        };
        defer allocator.free(orders.data);
        std.debug.print("Orders: {d} loaded\n\n", .{orders.data.len});

        std.debug.print("========== COMPARISON ==========\n", .{});
        std.debug.print("Both use same API key/secret: ✓\n", .{});
        std.debug.print("Both use GET method: ✓\n", .{});
        std.debug.print("Both use {{}} body: ✓\n", .{});
        std.debug.print("\nDifferences:\n", .{});
        std.debug.print("- Balance endpoint: /api/balances (no query params)\n", .{});
        std.debug.print("- Orders endpoint: /api/open?offset=1 (has query params)\n", .{});
        std.debug.print("\nPossible causes:\n", .{});
        std.debug.print("1. Query string should be in signature: GET/api/open?offset=1{{}}\n", .{});
        std.debug.print("2. Timestamp validation is stricter for orders\n", .{});
        std.debug.print("3. LCX API changed for orders endpoint\n", .{});
    }
}
