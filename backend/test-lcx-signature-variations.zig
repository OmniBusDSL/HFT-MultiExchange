const std = @import("std");

// Test different LCX signature approaches
pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.debug.print("\n========================================\n", .{});
    std.debug.print("TESTING LCX SIGNATURE VARIATIONS\n", .{});
    std.debug.print("========================================\n\n", .{});

    // Example credentials (for reference)
    const api_secret = "test-secret-12345";

    // Test Case 1: Without query string (current implementation)
    std.debug.print("VARIATION 1: Without query string (CURRENT)\n", .{});
    std.debug.print("  RequestString: GET/api/open{{}}\n", .{});
    testSignature(allocator, "GET/api/open{}", api_secret);
    std.debug.print("\n", .{});

    // Test Case 2: With query string included
    std.debug.print("VARIATION 2: With query string in signature\n", .{});
    std.debug.print("  RequestString: GET/api/open?offset=1{{}}\n", .{});
    testSignature(allocator, "GET/api/open?offset=1{}", api_secret);
    std.debug.print("\n", .{});

    // Test Case 3: Without body {}
    std.debug.print("VARIATION 3: Without body (empty)\n", .{});
    std.debug.print("  RequestString: GET/api/open\n", .{});
    testSignature(allocator, "GET/api/open", api_secret);
    std.debug.print("\n", .{});

    // Test Case 4: Query + no body
    std.debug.print("VARIATION 4: Query string + no body\n", .{});
    std.debug.print("  RequestString: GET/api/open?offset=1\n", .{});
    testSignature(allocator, "GET/api/open?offset=1", api_secret);
    std.debug.print("\n", .{});

    // Test Case 5: Compare to balance (which works)
    std.debug.print("REFERENCE: Balance endpoint (✅ WORKS)\n", .{});
    std.debug.print("  RequestString: GET/api/balances{{}}\n", .{});
    testSignature(allocator, "GET/api/balances{}", api_secret);
    std.debug.print("\n", .{});

    std.debug.print("========================================\n", .{});
    std.debug.print("If LCX accepts one of these signatures,\n", .{});
    std.debug.print("we'll know which format to use!\n", .{});
    std.debug.print("========================================\n", .{});
}

fn testSignature(allocator: std.mem.Allocator, message: []const u8, secret: []const u8) void {
    // HMAC-SHA256
    var mac: [32]u8 = undefined;
    std.crypto.auth.hmac.sha2.HmacSha256.create(&mac, message, secret);

    // Base64 encode
    const Enc = std.base64.standard.Encoder;
    const sign_b64 = allocator.alloc(u8, Enc.calcSize(32)) catch return;
    defer allocator.free(sign_b64);
    _ = Enc.encode(sign_b64, &mac);

    std.debug.print("  Signature: {s}\n", .{sign_b64});
}
