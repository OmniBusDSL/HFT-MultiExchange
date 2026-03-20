const std = @import("std");
const net = std.net;

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    _ = gpa.allocator();

    std.debug.print("[SERVER] Starting simple HTTP server\n", .{});

    const address = try net.Address.parseIp("127.0.0.1", 8000);
    var server = try address.listen(.{
        .reuse_address = true,
    });
    defer server.deinit();

    std.debug.print("[SERVER] Listening on port 8000\n", .{});

    var connection_count: u32 = 0;
    while (true) {
        std.debug.print("[MAIN] About to accept...\n", .{});

        const connection = server.accept() catch |err| {
            std.debug.print("[ERROR] Accept failed: {}\n", .{err});
            continue;
        };

        connection_count += 1;
        std.debug.print("[ACCEPT] Connection #{}\n", .{connection_count});

        // Send a simple response without reading (to test write first)
        const response = "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nHello";
        std.debug.print("[WRITE] About to write response...\n", .{});
        _ = connection.stream.writeAll(response) catch |err| {
            std.debug.print("[WRITE] Write failed: {}\n", .{err});
            connection.stream.close();
            continue;
        };
        std.debug.print("[WRITE] Response sent, about to close\n", .{});
        connection.stream.close();
        std.debug.print("[CLOSE] Connection closed\n", .{});
    }
}
