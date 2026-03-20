/// Thin HTTP(S) wrapper for exchange API calls.
/// Uses std.http.Client.fetch with std.Io.Writer.Allocating for body capture.
const std = @import("std");

pub const Response = struct {
    status: u16,
    body: []u8, // caller must free

    pub fn deinit(self: *Response, allocator: std.mem.Allocator) void {
        allocator.free(self.body);
    }
};

pub fn get(
    allocator: std.mem.Allocator,
    url: []const u8,
    extra_headers: []const std.http.Header,
) !Response {
    var client = std.http.Client{
        .allocator = allocator,
    };
    defer client.deinit();

    var wa = std.Io.Writer.Allocating.init(allocator);
    defer wa.deinit();

    // Don't request any compression - use standard headers only
    var all_headers = try allocator.alloc(std.http.Header, extra_headers.len);
    defer allocator.free(all_headers);
    @memcpy(all_headers[0..extra_headers.len], extra_headers);

    const result = try client.fetch(.{
        .location = .{ .url = url },
        .extra_headers = all_headers,
        .response_writer = &wa.writer,
        .keep_alive = false,
    });

    return Response{
        .status = @intCast(@intFromEnum(result.status)),
        .body = try wa.toOwnedSlice(),
    };
}

pub fn post(
    allocator: std.mem.Allocator,
    url: []const u8,
    extra_headers: []const std.http.Header,
    payload: []const u8,
) !Response {
    var client = std.http.Client{ .allocator = allocator };
    defer client.deinit();

    var wa = std.Io.Writer.Allocating.init(allocator);
    defer wa.deinit();

    // Don't request any compression - use standard headers only
    var all_headers = try allocator.alloc(std.http.Header, extra_headers.len);
    defer allocator.free(all_headers);
    @memcpy(all_headers[0..extra_headers.len], extra_headers);

    // Setting payload makes fetch automatically use POST method
    const result = try client.fetch(.{
        .location = .{ .url = url },
        .payload = payload,
        .extra_headers = all_headers,
        .response_writer = &wa.writer,
        .keep_alive = false,
    });

    return Response{
        .status = @intCast(@intFromEnum(result.status)),
        .body = try wa.toOwnedSlice(),
    };
}

/// HMAC-SHA256 of `message` using `key`, written as lowercase hex into `out` (64 chars).
pub fn hmacSha256Hex(out: *[64]u8, message: []const u8, key: []const u8) void {
    var mac: [32]u8 = undefined;
    std.crypto.auth.hmac.sha2.HmacSha256.create(&mac, message, key);
    const hex = std.fmt.bytesToHex(mac, .lower);
    @memcpy(out, &hex);
}

/// HMAC-SHA512 of `message` using `key`, result written into `out` (64 bytes).
pub fn hmacSha512(out: *[64]u8, message: []const u8, key: []const u8) void {
    std.crypto.auth.hmac.sha2.HmacSha512.create(out, message, key);
}

/// SHA-256 of `message`, result written into `out` (32 bytes).
pub fn sha256(out: *[32]u8, message: []const u8) void {
    std.crypto.hash.sha2.Sha256.hash(message, out, .{});
}
