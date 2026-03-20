const std = @import("std");
const lcx_types = @import("src/ws/lcx_types.zig");
const lcx_orderbook_ws = @import("src/ws/lcx_orderbook_ws.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("\n========================================\n", .{});
    std.debug.print("TESTING LCX ORDERBOOK WEBSOCKET\n", .{});
    std.debug.print("========================================\n\n", .{});

    // Test 1: Create orderbook handler
    std.debug.print("TEST 1: Create OrderBook Handler\n", .{});
    std.debug.print("--------------------------------\n", .{});

    var handler = try lcx_orderbook_ws.LcxOrderbookWs.init(allocator, "BTC/EUR");
    defer handler.deinit();

    std.debug.print("  Handler created for pair: {s}\n", .{handler.pair});
    std.debug.print("\n", .{});

    // Test 2: Build subscription message
    std.debug.print("TEST 2: Build Subscription Message\n", .{});
    std.debug.print("----------------------------------\n", .{});

    const sub_msg = try lcx_orderbook_ws.LcxOrderbookWs.buildSubscribeMessage(allocator, "BTC/EUR");
    defer allocator.free(sub_msg);

    std.debug.print("  Message: {s}\n", .{sub_msg});
    std.debug.print("\n", .{});

    // Test 3: Create and manage local orderbook
    std.debug.print("TEST 3: Manage Local Orderbook State\n", .{});
    std.debug.print("------------------------------------\n", .{});

    var ob = try lcx_types.LocalOrderbook.init(allocator, "BTC/EUR");
    defer ob.deinit();

    std.debug.print("  Orderbook created for {s}\n", .{ob.pair});

    // Apply snapshot data
    const bids = try allocator.alloc(lcx_types.PriceLevel, 3);
    bids[0] = .{ .price = 54100.0, .amount = 0.5 };
    bids[1] = .{ .price = 54050.0, .amount = 1.0 };
    bids[2] = .{ .price = 54000.0, .amount = 1.5 };

    const asks = try allocator.alloc(lcx_types.PriceLevel, 3);
    asks[0] = .{ .price = 54200.0, .amount = 0.8 };
    asks[1] = .{ .price = 54250.0, .amount = 1.2 };
    asks[2] = .{ .price = 54300.0, .amount = 2.0 };

    const snapshot = lcx_types.OrderbookData{
        .pair = "BTC/EUR",
        .buy = bids,
        .sell = asks,
    };

    try ob.applySnapshot(snapshot);
    std.debug.print("  Snapshot applied: {d} bids, {d} asks\n", .{ ob.bids_len, ob.asks_len });

    // Display best bid/ask
    if (ob.bestBid()) |bid| {
        std.debug.print("  Best Bid: {d:.2} @ {d:.8} BTC\n", .{ bid.price, bid.amount });
    }
    if (ob.bestAsk()) |ask| {
        std.debug.print("  Best Ask: {d:.2} @ {d:.8} BTC\n", .{ ask.price, ask.amount });
    }

    if (ob.getSpread()) |spread| {
        std.debug.print("  Spread: {d:.2}\n", .{spread});
    }

    if (ob.getMidpoint()) |mid| {
        std.debug.print("  Midpoint: {d:.2}\n", .{mid});
    }

    std.debug.print("\n", .{});

    // Test 4: Apply delta updates
    std.debug.print("TEST 4: Apply Delta Updates\n", .{});
    std.debug.print("---------------------------\n", .{});

    const updates = try allocator.alloc(lcx_types.PriceLevel, 2);
    updates[0] = .{ .price = 54100.0, .amount = 0.3 }; // Update existing level
    updates[1] = .{ .price = 54075.0, .amount = 0.7 }; // Add new level

    try ob.applyUpdate(updates, "buy");
    std.debug.print("  Updates applied: {d} bid levels\n", .{ob.bids_len});

    if (ob.bestBid()) |bid| {
        std.debug.print("  Updated Best Bid: {d:.2} @ {d:.8} BTC\n", .{ bid.price, bid.amount });
    }

    std.debug.print("\n", .{});

    // Test 5: Message parsing
    std.debug.print("TEST 5: Parse Messages\n", .{});
    std.debug.print("----------------------\n", .{});

    const test_json = "{\"type\":\"orderbook\",\"topic\":\"snapshot\",\"pair\":\"BTC/EUR\",\"data\":{}}";
    var msg = try lcx_orderbook_ws.LcxOrderbookWs.parseMessage(allocator, test_json);
    defer msg.deinit();

    std.debug.print("  Parsed message type: {}\n", .{msg.msg_type});
    if (msg.pair) |pair| {
        std.debug.print("  Pair: {s}\n", .{pair});
    }

    std.debug.print("\n", .{});

    std.debug.print("========================================\n", .{});
    std.debug.print("LCX ORDERBOOK WEBSOCKET READY\n", .{});
    std.debug.print("========================================\n", .{});

    // Clean up allocated data
    allocator.free(bids);
    allocator.free(asks);
    allocator.free(updates);
}
