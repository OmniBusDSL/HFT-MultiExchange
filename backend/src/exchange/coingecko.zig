/// CoinGecko API connectivity test.
/// Sends x-cg-pro-api-key header to the Pro API ping endpoint.
/// Falls back to free API demo key format if Pro returns 401.
const std = @import("std");
const types = @import("types.zig");
const hc = @import("http_client.zig");

const PRO_PING_URL = "https://pro-api.coingecko.com/api/v3/ping";
const FREE_PING_URL = "https://api.coingecko.com/api/v3/ping";

pub fn testConnection(
    allocator: std.mem.Allocator,
    api_key: []const u8,
    _api_secret: []const u8,
) !types.TestResult {
    _ = _api_secret; // CoinGecko only uses api_key

    // Try Pro API first (x-cg-pro-api-key header)
    {
        const headers = [_]std.http.Header{
            .{ .name = "x-cg-pro-api-key", .value = api_key },
            .{ .name = "Accept", .value = "application/json" },
        };

        var resp = hc.get(allocator, PRO_PING_URL, &headers) catch null;
        if (resp) |*r| {
            defer r.deinit(allocator);
            std.debug.print("[COINGECKO-PRO] status={d}\n", .{r.status});
            if (r.status == 200) {
                return types.TestResult.ok(allocator, "CoinGecko Pro: API key valid, connection successful");
            }
        }
    }

    // Try demo/free API (x-cg-demo-api-key header)
    {
        const headers = [_]std.http.Header{
            .{ .name = "x-cg-demo-api-key", .value = api_key },
            .{ .name = "Accept", .value = "application/json" },
        };

        var resp = hc.get(allocator, FREE_PING_URL, &headers) catch |err| {
            return types.TestResult.failFmt(allocator, "CoinGecko connection failed: {}", .{err});
        };
        defer resp.deinit(allocator);
        std.debug.print("[COINGECKO-FREE] status={d}\n", .{resp.status});

        return switch (resp.status) {
            200 => types.TestResult.ok(allocator, "CoinGecko: API key valid, connection successful"),
            401, 403 => types.TestResult.fail(allocator, "CoinGecko: Invalid API key"),
            else => types.TestResult.failFmt(allocator, "CoinGecko: HTTP {d}", .{resp.status}),
        };
    }
}
