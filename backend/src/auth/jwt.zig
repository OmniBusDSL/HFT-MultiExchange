const std = @import("std");
const base64 = std.base64;
const crypto = std.crypto;
const config_module = @import("../config/config.zig");
const vault = @import("../crypto/vault.zig");

pub const TokenPayload = struct {
    id: u32,
    email: []const u8,
};

/// Encode base64url (no padding)
fn base64urlEncode(allocator: std.mem.Allocator, data: []const u8) ![]u8 {
    var alphabet: [64]u8 = undefined;
    @memcpy(&alphabet, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");

    const encoder = base64.standard.Encoder;
    const encoded = try allocator.alloc(u8, encoder.calcSize(data.len));

    var i: usize = 0;
    var j: usize = 0;
    while (i < data.len) : (i += 3) {
        const b1 = data[i];
        const b2: u8 = if (i + 1 < data.len) data[i + 1] else 0;
        const b3: u8 = if (i + 2 < data.len) data[i + 2] else 0;

        const n = (@as(u32, b1) << 16) | (@as(u32, b2) << 8) | @as(u32, b3);

        encoded[j] = alphabet[(n >> 18) & 0x3F];
        encoded[j + 1] = alphabet[(n >> 12) & 0x3F];
        if (i + 1 < data.len) encoded[j + 2] = alphabet[(n >> 6) & 0x3F] else encoded[j + 2] = '=';
        if (i + 2 < data.len) encoded[j + 3] = alphabet[n & 0x3F] else encoded[j + 3] = '=';

        j += 4;
    }

    // Remove padding
    while (j > 0 and encoded[j - 1] == '=') {
        j -= 1;
    }

    return encoded[0..j];
}

/// Simple base64 encode (compatible with standard)
fn simpleBase64Encode(allocator: std.mem.Allocator, data: []const u8) ![]u8 {
    const size = base64.standard.Encoder.calcSize(data.len);
    const result = try allocator.alloc(u8, size);
    _ = base64.standard.Encoder.encode(result, data);
    return result;
}

pub fn generateToken(allocator: std.mem.Allocator, user_id: u32, email: []const u8) ![]u8 {
    const now = @as(i64, @intCast(std.time.timestamp()));

    // Header
    const header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";

    // Payload
    const payload_str = try std.fmt.allocPrint(
        allocator,
        "{{\"id\":{},\"email\":\"{s}\",\"iat\":{}}}",
        .{ user_id, email, now },
    );
    defer allocator.free(payload_str);

    // Base64 encode header and payload
    const header_b64 = try simpleBase64Encode(allocator, header);
    const payload_b64 = try simpleBase64Encode(allocator, payload_str);

    // Create signing input
    const signing_input = try std.fmt.allocPrint(
        allocator,
        "{s}.{s}",
        .{ header_b64, payload_b64 },
    );
    defer allocator.free(signing_input);

    // Calculate HMAC-SHA256
    var hmac: [32]u8 = undefined;
    const jwt_secret = if (config_module.getConfig()) |cfg| cfg.jwt_secret else "zig-exchange-secret-v1-change-in-production";
    crypto.auth.hmac.sha2.HmacSha256.create(&hmac, signing_input, jwt_secret);

    // Base64 encode signature
    const sig_b64 = try simpleBase64Encode(allocator, &hmac);

    // Construct final token
    const token = try std.fmt.allocPrint(
        allocator,
        "{s}.{s}",
        .{ signing_input, sig_b64 },
    );

    allocator.free(header_b64);
    allocator.free(payload_b64);
    allocator.free(sig_b64);

    return token;
}

pub fn verifyToken(allocator: std.mem.Allocator, token: []const u8) !?TokenPayload {
    // Split token into parts
    var parts = std.mem.splitSequence(u8, token, ".");
    const header_part = parts.next() orelse return null;
    const payload_part = parts.next() orelse return null;
    const signature_part = parts.next() orelse return null;

    // Reconstruct signing input
    const signing_input = try std.fmt.allocPrint(
        allocator,
        "{s}.{s}",
        .{ header_part, payload_part },
    );
    defer allocator.free(signing_input);

    // Calculate expected HMAC
    var expected_hmac: [32]u8 = undefined;
    const jwt_secret = if (config_module.getConfig()) |cfg| cfg.jwt_secret else "zig-exchange-secret-v1-change-in-production";
    crypto.auth.hmac.sha2.HmacSha256.create(&expected_hmac, signing_input, jwt_secret);

    // Decode provided signature from base64
    var provided_hmac: [32]u8 = undefined;
    var decoder = base64.standard.Decoder;
    const decoded_len = decoder.calcSizeForSlice(signature_part) catch return null;
    if (decoded_len != 32) return null;

    decoder.decode(&provided_hmac, signature_part) catch return null;

    // Constant-time comparison (prevents timing attacks on signature verification)
    if (!vault.constantTimeEql([32]u8, expected_hmac, provided_hmac)) {
        return null;
    }

    // Decode payload
    var payload_buf: [1024]u8 = undefined;
    const payload_len = decoder.calcSizeForSlice(payload_part) catch return null;
    if (payload_len > payload_buf.len) return null;

    decoder.decode(&payload_buf, payload_part) catch return null;
    const payload_json = payload_buf[0..payload_len];

    // Parse JSON payload (simple parsing)
    // Looking for: {"id":123,"email":"user@example.com","iat":1234567890}
    var user_id: ?u32 = null;
    var email_start: ?usize = null;
    var email_end: ?usize = null;

    var i: usize = 0;
    while (i < payload_json.len) : (i += 1) {
        if (std.mem.startsWith(u8, payload_json[i..], "\"id\":")) {
            i += 5;
            var num_str: [10]u8 = undefined;
            var num_len: usize = 0;
            while (i < payload_json.len and std.ascii.isDigit(payload_json[i])) : (i += 1) {
                num_str[num_len] = payload_json[i];
                num_len += 1;
            }
            user_id = std.fmt.parseUnsigned(u32, num_str[0..num_len], 10) catch null;
        }

        if (std.mem.startsWith(u8, payload_json[i..], "\"email\":\"")) {
            email_start = i + 9;
            var j = email_start.?;
            while (j < payload_json.len and payload_json[j] != '"') : (j += 1) {}
            email_end = j;
            i = j;
        }
    }

    if (user_id == null or email_start == null or email_end == null) {
        return null;
    }

    const email = try allocator.dupe(u8, payload_json[email_start.?..email_end.?]);

    return TokenPayload{
        .id = user_id.?,
        .email = email,
    };
}

pub fn extractUserIdFromRequest(request_buf: []const u8) !?u32 {
    // Find Authorization header (case-insensitive for header name)
    var pos: usize = 0;

    while (pos < request_buf.len) {
        const rest = request_buf[pos..];
        // Match "Authorization: Bearer " or "authorization: Bearer "
        const is_auth =
            (std.mem.startsWith(u8, rest, "Authorization: Bearer ") or
             std.mem.startsWith(u8, rest, "authorization: Bearer ") or
             std.mem.startsWith(u8, rest, "AUTHORIZATION: Bearer "));
        if (is_auth) {
            // Skip past "Xuthorization: Bearer "
            pos += "Authorization: Bearer ".len;

            // Find end of token (CRLF or LF)
            var token_end = pos;
            while (token_end < request_buf.len and
                   request_buf[token_end] != '\r' and
                   request_buf[token_end] != '\n') : (token_end += 1) {}

            const token = request_buf[pos..token_end];

            // Verify token
            var gpa = std.heap.GeneralPurposeAllocator(.{}){};
            defer _ = gpa.deinit();
            const allocator = gpa.allocator();

            if (try verifyToken(allocator, token)) |payload| {
                const user_id = payload.id;
                allocator.free(payload.email);
                return user_id;
            }

            return null;
        }

        pos += 1;
    }

    return null;
}
