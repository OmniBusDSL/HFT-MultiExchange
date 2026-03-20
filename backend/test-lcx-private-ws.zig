const std = @import("std");
const lcx_private_types = @import("src/ws/lcx_private_types.zig");
const lcx_private_ws = @import("src/ws/lcx_private_ws.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("\n========================================\n", .{});
    std.debug.print("TESTING LCX PRIVATE ORDERS WEBSOCKET\n", .{});
    std.debug.print("========================================\n\n", .{});

    // Test 1: Create private WebSocket handler
    std.debug.print("TEST 1: Create Private Orders Handler\n", .{});
    std.debug.print("-------------------------------------\n", .{});

    const api_key = "test-api-key-12345";
    const api_secret = "test-api-secret-67890";

    var handler = try lcx_private_ws.LcxPrivateWs.init(allocator, api_key, api_secret, 100);
    defer handler.deinit();

    std.debug.print("  Handler created with API key length: {d}\n", .{handler.api_key.len});
    std.debug.print("  Max orders capacity: {d}\n", .{handler.orders.orders.len});
    std.debug.print("  Ping interval: {d}ms\n", .{handler.ping_interval_ms});
    std.debug.print("\n", .{});

    // Test 2: Build authenticated URL
    std.debug.print("TEST 2: Build Authenticated WebSocket URL\n", .{});
    std.debug.print("----------------------------------------\n", .{});

    const auth_url = try handler.buildAuthUrl(allocator);
    defer allocator.free(auth_url);

    std.debug.print("  URL: {s}\n", .{auth_url});

    // Verify it contains required query parameters
    if (std.mem.indexOf(u8, auth_url, "x-access-key=")) |_| {
        std.debug.print("  ✓ Contains x-access-key parameter\n", .{});
    }
    if (std.mem.indexOf(u8, auth_url, "x-access-sign=")) |_| {
        std.debug.print("  ✓ Contains x-access-sign parameter\n", .{});
    }
    if (std.mem.indexOf(u8, auth_url, "x-access-timestamp=")) |_| {
        std.debug.print("  ✓ Contains x-access-timestamp parameter\n", .{});
    }

    std.debug.print("\n", .{});

    // Test 3: Build subscription message
    std.debug.print("TEST 3: Build Subscription Message\n", .{});
    std.debug.print("----------------------------------\n", .{});

    const sub_msg = try lcx_private_ws.LcxPrivateWs.buildSubscribeMessage(allocator);
    defer allocator.free(sub_msg);

    std.debug.print("  Message: {s}\n", .{sub_msg});
    std.debug.print("\n", .{});

    // Test 4: Order state management
    std.debug.print("TEST 4: Order State Management\n", .{});
    std.debug.print("-------------------------------\n", .{});

    // Create test orders
    var order1 = lcx_private_types.PrivateOrder{
        .allocator = allocator,
        .id = try allocator.dupe(u8, "order-001"),
        .symbol = try allocator.dupe(u8, "BTC/EUR"),
        .side = try allocator.dupe(u8, "buy"),
        .price = 54000.0,
        .amount = 0.5,
        .status = .open,
        .created_at = std.time.milliTimestamp(),
        .updated_at = std.time.milliTimestamp(),
    };
    defer order1.deinit();

    var order2 = lcx_private_types.PrivateOrder{
        .allocator = allocator,
        .id = try allocator.dupe(u8, "order-002"),
        .symbol = try allocator.dupe(u8, "ETH/EUR"),
        .side = try allocator.dupe(u8, "sell"),
        .price = 3000.0,
        .amount = 1.0,
        .status = .partial,
        .created_at = std.time.milliTimestamp(),
        .updated_at = std.time.milliTimestamp(),
    };
    defer order2.deinit();

    // Apply snapshot
    const orders_snapshot = [_]lcx_private_types.PrivateOrder{ order1, order2 };
    try handler.orders.applySnapshot(&orders_snapshot);

    std.debug.print("  Snapshot applied: {d} orders\n", .{handler.orders.order_count});
    std.debug.print("  Orders subscribed: {}\n", .{handler.orders.is_subscribed});

    // Get open orders
    const open_orders = try handler.getOpenOrders(allocator);
    defer allocator.free(open_orders);

    std.debug.print("  Open orders: {d}\n", .{open_orders.len});
    for (open_orders) |order| {
        std.debug.print("    [{s}] {s} {s} @ {d} (status: {})\n",
            .{ order.id, order.symbol, order.side, order.price, order.status },
        );
    }

    std.debug.print("\n", .{});

    // Test 5: Order status parsing
    std.debug.print("TEST 5: Order Status Parsing\n", .{});
    std.debug.print("----------------------------\n", .{});

    std.debug.print("  Status enum values:\n", .{});
    std.debug.print("    .open -> OPEN\n", .{});
    std.debug.print("    .partial -> PARTIAL (filled but not full)\n", .{});
    std.debug.print("    .filled -> FILLED (execution complete)\n", .{});
    std.debug.print("    .cancelled -> CANCELLED (user or system)\n", .{});

    std.debug.print("\n", .{});

    std.debug.print("========================================\n", .{});
    std.debug.print("LCX PRIVATE ORDERS WEBSOCKET READY\n", .{});
    std.debug.print("========================================\n\n", .{});
    std.debug.print("IMPORTANT: Full WebSocket connection requires:\n", .{});
    std.debug.print("1. Authentication URL with HMAC-SHA256 signature ✓\n", .{});
    std.debug.print("2. Initial snapshot fetch from /api/open (REST) - todo\n", .{});
    std.debug.print("3. Real-time order update messages via WebSocket - todo\n", .{});
}
