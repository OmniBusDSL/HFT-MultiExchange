const std = @import("std");
const crypto = std.crypto;
const base64 = std.base64;
const config_module = @import("../config/config.zig");

pub const AuthError = error{
    InvalidPassword,
    TokenGenerationFailed,
    HashingFailed,
};

pub fn hashPassword(allocator: std.mem.Allocator, password: []const u8) ![]u8 {
    // Using PBKDF2 for password hashing
    var hash: [32]u8 = undefined;
    const salt = if (config_module.getConfig()) |cfg| cfg.password_salt else "zig-exchange-salt";

    crypto.pbkdf2(
        hash[0..],
        password,
        salt,
        100_000,
        crypto.hash.sha256,
    );

    // Encode hash to base64
    const encoded = try allocator.alloc(u8, base64.standard.Encoder.calcSize(hash.len));
    const encoder = base64.standard.Encoder;
    return encoder.encode(encoded, &hash);
}

pub fn verifyPassword(allocator: std.mem.Allocator, password: []const u8, hash: []const u8) !bool {
    const computed_hash = try hashPassword(allocator, password);
    defer allocator.free(computed_hash);

    return std.mem.eql(u8, computed_hash, hash);
}

pub fn generateJWT(allocator: std.mem.Allocator, user_id: u32, email: []const u8) ![]u8 {
    // Simple JWT implementation (in production, use proper library)
    const header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
    const payload = try std.fmt.allocPrint(
        allocator,
        "{{\"id\":{},\"email\":\"{}\"}}",
        .{ user_id, email },
    );
    defer allocator.free(payload);

    // Base64 encode header and payload
    const header_encoded = try allocator.alloc(u8, base64.standard.Encoder.calcSize(header.len));
    const payload_encoded = try allocator.alloc(u8, base64.standard.Encoder.calcSize(payload.len));

    const encoder = base64.standard.Encoder;
    _ = encoder.encode(header_encoded, header);
    _ = encoder.encode(payload_encoded, payload);

    // Combine header.payload
    const token = try std.fmt.allocPrint(
        allocator,
        "{s}.{s}.signature",
        .{ header_encoded, payload_encoded },
    );

    allocator.free(header_encoded);
    allocator.free(payload_encoded);

    return token;
}

pub fn generateBTCAddress() []const u8 {
    // Placeholder BTC address
    return "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
}
