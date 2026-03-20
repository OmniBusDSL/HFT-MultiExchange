const std = @import("std");
const symbol_utils = @import("src/utils/symbols.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Test cases
    const test_cases = [_]struct { input: []const u8, expected: []const u8 }{
        .{ .input = "XBTUSD", .expected = "BTC/USD" },
        .{ .input = "1INCHEUR", .expected = "1INCH/EUR" },
        .{ .input = "XXBTZUSD", .expected = "BTC/USD" },
        .{ .input = "ETHUSD", .expected = "ETH/USD" },
        .{ .input = "XETHZUSD", .expected = "ETH/USD" },
        .{ .input = "DOGEEUR", .expected = "DOGE/EUR" },
    };

    std.debug.print("Testing symbol normalization:\n", .{});
    for (test_cases) |tc| {
        const result = try symbol_utils.normalizeKrakenSymbol(allocator, tc.input);
        defer allocator.free(result);
        
        const ok = std.mem.eql(u8, result, tc.expected);
        const status = if (ok) "✓" else "✗";
        std.debug.print("{s} {s} → {s} (expected: {s})\n", .{ status, tc.input, result, tc.expected });
    }
}
