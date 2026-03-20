/// CoinMarketCap API connectivity test.
/// Sends X-CMC_PRO_API_KEY header to test endpoint.
const std = @import("std");
const types = @import("types.zig");
const hc = @import("http_client.zig");

const TEST_URL = "https://pro-api.coinmarketcap.com/v1/global?convert=USD";

pub fn testConnection(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    _api_secret: []const u8,
) !types.TestResult {
    _ = _api_secret; // CoinMarketCap only uses api_key

    if (api_key.len == 0) {
        return types.TestResult.fail(allocator, "CoinMarketCap: API key is required");
    }

    const headers = [_]std.http.Header{
        .{ .name = "X-CMC_PRO_API_KEY", .value = api_key },
        .{ .name = "Accept", .value = "application/json" },
    };

    var resp = hc.get(allocator, TEST_URL, &headers) catch |err| {
        return types.TestResult.failFmt(allocator, "CoinMarketCap connection failed: {}", .{err});
    };
    defer resp.deinit(allocator);
    std.debug.print("[COINMARKETCAP] status={d}\n", .{resp.status});

    return switch (resp.status) {
        200 => types.TestResult.ok(allocator, "CoinMarketCap: API key valid, connection successful"),
        401, 403 => types.TestResult.fail(allocator, "CoinMarketCap: Invalid API key"),
        429 => types.TestResult.fail(allocator, "CoinMarketCap: Rate limit exceeded, API key is valid but quota exceeded"),
        else => types.TestResult.failFmt(allocator, "CoinMarketCap: HTTP {d}", .{resp.status}),
    };
}
