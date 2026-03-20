const std = @import("std");
const ws = @import("src/ws/ws_client.zig");
const types = @import("src/ws/types.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("\n========================================\n", .{});
    std.debug.print("TESTING WEBSOCKET CLIENT - BASIC CONNECTIVITY\n", .{});
    std.debug.print("========================================\n\n", .{});

    // Test 1: Parse URLs
    std.debug.print("TEST 1: Parse WebSocket URLs\n", .{});
    std.debug.print("------------------------------\n", .{});

    const test_urls = [_][]const u8{
        "wss://exchange-api.lcx.com/ws",
        "ws://echo.websocket.org/",
        "wss://ws.kraken.com",
    };

    for (test_urls) |url| {
        var parsed = ws.parseUrl(allocator, url) catch |err| {
            std.debug.print("  ERROR parsing '{s}': {}\n", .{ url, err });
            continue;
        };
        defer parsed.deinit(allocator);

        std.debug.print("  URL: {s}\n", .{url});
        std.debug.print("    Host: {s}, Port: {d}, Secure: {}, Path: {s}\n",
            .{ parsed.host, parsed.port, parsed.secure, parsed.path });
    }

    std.debug.print("\n", .{});

    // Test 2: WebSocket client initialization
    std.debug.print("TEST 2: WebSocket Client Initialization\n", .{});
    std.debug.print("----------------------------------------\n", .{});

    const config = types.WsConfig{
        .url = "wss://echo.websocket.org/",
        .connect_timeout_ms = 5000,
        .ping_interval_ms = 30000,
    };

    var client = ws.WsClient.init(allocator, config);
    defer client.deinit();

    std.debug.print("  Client initialized\n", .{});
    std.debug.print("  URL: {s}\n", .{config.url});
    std.debug.print("  Connect timeout: {d}ms\n", .{config.connect_timeout_ms});
    std.debug.print("  Ping interval: {d}ms\n", .{config.ping_interval_ms});
    std.debug.print("  Initial state: {}\n", .{client.getState()});

    std.debug.print("\n", .{});

    // Test 3: Event handler registration
    std.debug.print("TEST 3: Event Handler Registration\n", .{});
    std.debug.print("-----------------------------------\n", .{});

    client.onEvent(testEventHandler);
    std.debug.print("  Event handler registered\n", .{});

    std.debug.print("\n", .{});

    // Test 4: Connection attempt (skipped - would require network)
    std.debug.print("TEST 4: Connection Attempt (Skipped)\n", .{});
    std.debug.print("-------------------------------------\n", .{});
    std.debug.print("  Actual connections require real WebSocket server\n", .{});
    std.debug.print("  Full test with Phase 2 (LCX orderbook) will verify\n", .{});

    std.debug.print("\n", .{});

    std.debug.print("========================================\n", .{});
    std.debug.print("WEBSOCKET CLIENT INFRASTRUCTURE READY\n", .{});
    std.debug.print("========================================\n", .{});
}

fn testEventHandler(allocator: std.mem.Allocator, event: types.WsEvent) anyerror!void {
    switch (event) {
        .opened => {
            std.debug.print("  [EVENT] WebSocket opened\n", .{});
        },
        .message => |msg| {
            std.debug.print("  [EVENT] Message: {s}\n", .{msg.text});
            allocator.free(msg.text);
        },
        .closed => |code| {
            std.debug.print("  [EVENT] WebSocket closed with code: {d}\n", .{code});
        },
        .err => |err| {
            std.debug.print("  [EVENT] Error: {s}\n", .{err});
            allocator.free(err);
        },
    }
}
