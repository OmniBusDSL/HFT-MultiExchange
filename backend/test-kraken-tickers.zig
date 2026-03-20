const std = @import("std");
const symbol_utils = @import("src/utils/symbols.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("Testing new normalizeKrakenAssets function:\n", .{});
    
    const test_cases = [_]struct { base: []const u8, quote: []const u8, expected: []const u8 }{
        .{ .base = "BTC", .quote = "USD", .expected = "BTC/USD" },
        .{ .base = "1INCH", .quote = "EUR", .expected = "1INCH/EUR" },
        .{ .base = "ETH", .quote = "USD", .expected = "ETH/USD" },
    };

    for (test_cases) |tc| {
        const result = try symbol_utils.normalizeKrakenAssets(allocator, tc.base, tc.quote);
        defer allocator.free(result);
        
        const ok = std.mem.eql(u8, result, tc.expected);
        const status = if (ok) "✓" else "✗";
        std.debug.print("{s} {s} + {s} → {s} (expected: {s})\n", .{ status, tc.base, tc.quote, result, tc.expected });
    }
}
