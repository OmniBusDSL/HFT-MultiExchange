/// CryptoCompare API connectivity test.
/// Sends API key as query parameter for authentication.
const std = @import("std");
const types = @import("types.zig");
const hc = @import("http_client.zig");

const TEST_URL = "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC&tsyms=USD";

pub fn testConnection(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    _api_secret: []const u8,
) !types.TestResult {
    _ = _api_secret; // CryptoCompare only uses api_key

    if (api_key.len == 0) {
        return types.TestResult.fail(allocator, "CryptoCompare: API key is required");
    }

    // Build URL with API key as query parameter
    const url = try std.fmt.allocPrint(
        allocator,
        "{s}&api_key={s}",
        .{ TEST_URL, api_key },
    );
    defer allocator.free(url);

    const headers = [_]std.http.Header{
        .{ .name = "Accept", .value = "application/json" },
    };

    var resp = hc.get(allocator, url, &headers) catch |err| {
        return types.TestResult.failFmt(allocator, "CryptoCompare connection failed: {}", .{err});
    };
    defer resp.deinit(allocator);
    std.debug.print("[CRYPTOCOMPARE] status={d}\n", .{resp.status});

    return switch (resp.status) {
        200 => types.TestResult.ok(allocator, "CryptoCompare: API key valid, connection successful"),
        401, 403 => types.TestResult.fail(allocator, "CryptoCompare: Invalid API key"),
        429 => types.TestResult.fail(allocator, "CryptoCompare: Rate limit exceeded, API key is valid but quota exceeded"),
        else => types.TestResult.failFmt(allocator, "CryptoCompare: HTTP {d}", .{resp.status}),
    };
}
