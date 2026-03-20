/// shield-dashboard — HTTP server (port 4000)
///
/// Routes:
///   GET /        → serves index.html (embedded at compile time)
///   GET /api/*   → reverse proxy to order-shield REST API (port 3001)
///
/// Build:  zig build
/// Run:    zig build run
///         or: zig-out\bin\shield-dashboard.exe

const std = @import("std");
const net = std.net;
const http = std.http;

const LISTEN_PORT: u16 = 4000;
const SHIELD_HOST = "127.0.0.1";
const SHIELD_PORT: u16 = 3001;

/// HTML embedded at compile time — zero runtime file I/O.
const INDEX_HTML = @embedFile("index.html");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const addr = try net.Address.parseIp4("0.0.0.0", LISTEN_PORT);
    var server = try addr.listen(.{ .reuse_address = true });
    defer server.deinit();

    std.debug.print("[Dashboard] http://localhost:{d}/\n", .{LISTEN_PORT});
    std.debug.print("[Dashboard] /api/* → http://{s}:{d}\n", .{ SHIELD_HOST, SHIELD_PORT });

    while (true) {
        const conn = server.accept() catch |err| {
            std.debug.print("[Dashboard] accept error: {}\n", .{err});
            continue;
        };
        const t = std.Thread.spawn(.{}, handleConn, .{ allocator, conn }) catch |err| {
            std.debug.print("[Dashboard] thread error: {}\n", .{err});
            conn.stream.close();
            continue;
        };
        t.detach();
    }
}

fn handleConn(allocator: std.mem.Allocator, conn: net.Server.Connection) void {
    defer conn.stream.close();

    var buf: [8192]u8 = undefined;
    const bytes_read = conn.stream.read(&buf) catch return;

    if (bytes_read == 0) return;

    // For now, just serve index.html for all requests
    // TODO: Parse request and implement routing with proxy to order-shield API (port 3001)
    const response = std.fmt.allocPrint(allocator, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-cache\r\nContent-Length: {d}\r\n\r\n{s}", .{ INDEX_HTML.len, INDEX_HTML }) catch return;
    defer allocator.free(response);
    _ = conn.stream.writeAll(response) catch {};
}
