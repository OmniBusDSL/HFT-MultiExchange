const std = @import("std");
const symbol_utils = @import("src/utils/symbols.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("Testing Kraken symbol denormalization:\n", .{});
    
    // Test: Convert normalized back to Kraken format (simplified: just remove /)
    const test_cases = [_]struct { normalized: []const u8, expected: []const u8 }{
        .{ .normalized = "BTC/USD", .expected = "BTUSD" },
        .{ .normalized = "1INCH/EUR", .expected = "1INCHEUR" },
        .{ .normalized = "ETH/USD", .expected = "ETHUSD" },
    };

    for (test_cases) |tc| {
        const result = try symbol_utils.toExchangeFormat(allocator, "kraken", tc.normalized);
        defer allocator.free(result);
        
        const ok = std.mem.eql(u8, result, tc.expected);
        const status = if (ok) "✓" else "✗";
        std.debug.print("{s} {s} → {s} (expected: {s})\n", .{ status, tc.normalized, result, tc.expected });
    }
}
