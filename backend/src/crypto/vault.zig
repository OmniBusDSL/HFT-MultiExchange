// Vault: AES-256-GCM encryption/decryption for sensitive data (API keys)
// Provides encrypt/decrypt for storage at rest and secureZero for memory cleanup

const std = @import("std");
const crypto = std.crypto;

const Aes256Gcm = crypto.aead.aes_gcm.Aes256Gcm;

/// Encrypts plaintext with AES-256-GCM using a random nonce
/// Returns hex-encoded string: hex(nonce(12) || ciphertext || tag(16))
/// Caller must free the returned []u8
pub fn encrypt(allocator: std.mem.Allocator, plaintext: []const u8, key: [32]u8) ![]u8 {
    // Generate secure random nonce (12 bytes for AES-GCM)
    var nonce: [Aes256Gcm.nonce_length]u8 = undefined;
    crypto.random.bytes(&nonce);

    // Allocate space for ciphertext (same size as plaintext)
    const ciphertext_len = plaintext.len;
    const ciphertext = try allocator.alloc(u8, ciphertext_len);
    defer allocator.free(ciphertext);

    // Allocate space for authentication tag (16 bytes)
    var tag: [Aes256Gcm.tag_length]u8 = undefined;

    // Encrypt: ciphertext = AES-GCM(key, nonce, plaintext, "")
    Aes256Gcm.encrypt(ciphertext, &tag, plaintext, "", nonce, key);

    // Build output: raw = nonce || ciphertext || tag
    const raw_len = Aes256Gcm.nonce_length + ciphertext_len + Aes256Gcm.tag_length;
    var raw = try allocator.alloc(u8, raw_len);
    defer allocator.free(raw);

    @memcpy(raw[0..Aes256Gcm.nonce_length], &nonce);
    @memcpy(raw[Aes256Gcm.nonce_length .. Aes256Gcm.nonce_length + ciphertext_len], ciphertext);
    @memcpy(raw[Aes256Gcm.nonce_length + ciphertext_len ..], &tag);

    // Convert to hex string
    const hex_len = raw_len * 2; // each byte becomes 2 hex chars
    const hex_str = try allocator.alloc(u8, hex_len);
    for (raw, 0..) |b, i| {
        const hex_chars = "0123456789abcdef";
        hex_str[i * 2] = hex_chars[(b >> 4) & 0xf];
        hex_str[i * 2 + 1] = hex_chars[b & 0xf];
    }

    return hex_str;
}

/// Decrypts hex-encoded AES-256-GCM ciphertext
/// Input format: hex(nonce(12) || ciphertext || tag(16))
/// Returns plaintext []u8; caller must free and call secureZero before freeing
pub fn decrypt(allocator: std.mem.Allocator, hex_blob: []const u8, key: [32]u8) ![]u8 {
    // Decode hex to binary
    var binary = try allocator.alloc(u8, hex_blob.len / 2);
    defer allocator.free(binary);

    for (0..hex_blob.len / 2) |i| {
        const hex_byte = hex_blob[i * 2 .. i * 2 + 2];
        binary[i] = try std.fmt.parseInt(u8, hex_byte, 16);
    }

    // Validate minimum length: nonce(12) + tag(16) = 28 bytes minimum
    if (binary.len < Aes256Gcm.nonce_length + Aes256Gcm.tag_length) {
        return error.InvalidCiphertextLength;
    }

    // Extract nonce, ciphertext, tag
    var nonce: [Aes256Gcm.nonce_length]u8 = undefined;
    @memcpy(&nonce, binary[0..Aes256Gcm.nonce_length]);
    const ciphertext_len = binary.len - Aes256Gcm.nonce_length - Aes256Gcm.tag_length;
    const ciphertext = binary[Aes256Gcm.nonce_length .. Aes256Gcm.nonce_length + ciphertext_len];
    var tag: [Aes256Gcm.tag_length]u8 = undefined;
    @memcpy(&tag, binary[binary.len - Aes256Gcm.tag_length .. binary.len]);

    // Allocate plaintext
    const plaintext = try allocator.alloc(u8, ciphertext_len);

    // Decrypt: plaintext = AES-GCM.decrypt(key, nonce, ciphertext, tag, "")
    Aes256Gcm.decrypt(plaintext, ciphertext, tag, "", nonce, key) catch |err| {
        allocator.free(plaintext);
        return err;
    };

    return plaintext;
}

/// Derives a 32-byte AES key from a master secret using SHA-256
/// Pattern: HKDF-style key derivation with a fixed context string
pub fn deriveVaultKey(master_secret: []const u8) [32]u8 {
    const context = "vault-key-v1"; // 12 bytes
    const context_len = 12;

    // Compute hash of context + master_secret
    var input_buffer: [12 + 256]u8 = undefined;
    @memcpy(input_buffer[0..context_len], context);
    @memcpy(input_buffer[context_len .. context_len + master_secret.len], master_secret);

    var key: [32]u8 = undefined;
    crypto.hash.sha2.Sha256.hash(input_buffer[0 .. context_len + master_secret.len], &key, .{});

    return key;
}

/// Securely zero-out sensitive memory before freeing
/// This prevents sensitive data from remaining in freed heap pages
pub fn secureZero(slice: []u8) void {
    @memset(slice, 0);
}

/// Constant-time byte array comparison
/// Returns true if slices are equal, false otherwise, without early termination
/// This prevents timing attacks on cryptographic comparisons
pub fn constantTimeEql(comptime T: type, a: T, b: T) bool {
    const bytes_a = std.mem.asBytes(&a);
    const bytes_b = std.mem.asBytes(&b);

    var result: u8 = 0;
    for (bytes_a, bytes_b) |ba, bb| {
        result |= ba ^ bb;
    }
    return result == 0;
}

// ============================================================================
// TESTS
// ============================================================================

test "encrypt/decrypt roundtrip" {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const plaintext = "my-secret-api-key-12345";
    const key = [_]u8{0xaa} ** 32;

    const ciphertext = try encrypt(allocator, plaintext, key);
    defer allocator.free(ciphertext);

    const decrypted = try decrypt(allocator, ciphertext, key);
    defer {
        secureZero(decrypted);
        allocator.free(decrypted);
    }

    try std.testing.expectEqualSlices(u8, plaintext, decrypted);
}

test "decrypt with wrong key fails" {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const plaintext = "secret";
    const key1 = [_]u8{0xaa} ** 32;
    const key2 = [_]u8{0xbb} ** 32;

    const ciphertext = try encrypt(allocator, plaintext, key1);
    defer allocator.free(ciphertext);

    const result = decrypt(allocator, ciphertext, key2);
    try std.testing.expectError(error.AuthenticationFailed, result);
}

test "deriveVaultKey is deterministic" {
    const secret = "my-master-secret";
    const key1 = deriveVaultKey(secret);
    const key2 = deriveVaultKey(secret);

    try std.testing.expectEqualSlices(u8, &key1, &key2);
}
