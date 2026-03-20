const std = @import("std");
const crypto = std.crypto;
const base64 = std.base64;

pub const User = struct {
    id: u32,
    email: []const u8,
    password_hash: []const u8,
    referral_code: []const u8,
    created_at: i64,
};

pub const UserStore = struct {
    users: std.StringHashMap(User),
    allocator: std.mem.Allocator,
    next_id: u32 = 1,

    pub fn init(allocator: std.mem.Allocator) UserStore {
        return UserStore{
            .users = std.StringHashMap(User).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *UserStore) void {
        self.users.deinit();
    }

    /// Save users to file (JSON format)
    pub fn saveToFile(self: *UserStore) !void {
        const file = try std.fs.cwd().createFile("users.json", .{});
        defer file.close();

        var iter = self.users.iterator();
        try file.writeAll("{\n  \"users\": [\n");

        var count: u32 = 0;
        while (iter.next()) |entry| : (count += 1) {
            if (count > 0) try file.writeAll(",\n");

            const user = entry.value_ptr.*;
            var buf: [512]u8 = undefined;
            const json = try std.fmt.bufPrint(
                &buf,
                "    {{\"email\":\"{s}\",\"id\":{},\"created_at\":{}}}",
                .{ user.email, user.id, user.created_at },
            );
            try file.writeAll(json);
        }

        try file.writeAll("\n  ]\n}\n");
        std.debug.print("[DB] ✓ Saved {} users to users.json\n", .{self.users.count()});
    }

    /// Create new user
    pub fn createUser(self: *UserStore, email: []const u8, password: []const u8) !User {
        // Check if user exists
        if (self.users.contains(email)) {
            return error.UserAlreadyExists;
        }

        const password_hash = hashPassword(self.allocator, password) catch return error.PasswordHashFailed;
        const referral_code = generateReferralCode(self.allocator) catch return error.ReferralCodeGenerationFailed;
        const now = std.time.timestamp();
        const user_id = self.next_id;
        self.next_id += 1;

        const user = User{
            .id = user_id,
            .email = try self.allocator.dupe(u8, email),
            .password_hash = password_hash,
            .referral_code = referral_code,
            .created_at = now,
        };

        try self.users.put(email, user);
        return user;
    }

    /// Get user by email
    pub fn getUser(self: *UserStore, email: []const u8) ?User {
        return self.users.get(email);
    }

    /// Verify user credentials
    pub fn verifyCredentials(self: *UserStore, allocator: std.mem.Allocator, email: []const u8, password: []const u8) !bool {
        if (self.getUser(email)) |user| {
            return try verifyPassword(allocator, password, user.password_hash);
        }
        return false;
    }

    /// Get user count
    pub fn getUserCount(self: *UserStore) u32 {
        return @as(u32, @intCast(self.users.count()));
    }
};

/// Hash password using SHA256
/// Returns hex-encoded SHA256(SALT ++ password)
pub fn hashPassword(allocator: std.mem.Allocator, password: []const u8) ![]u8 {
    const salt = "zig-salt-v1";
    var input = try allocator.alloc(u8, salt.len + password.len);
    defer allocator.free(input);

    @memcpy(input[0..salt.len], salt);
    @memcpy(input[salt.len..], password);

    // Compute SHA256
    var hash: [32]u8 = undefined;
    crypto.hash.sha2.Sha256.hash(input, &hash, .{});

    // Hex encode the hash
    const hex_result = try allocator.alloc(u8, 64);
    var hex_idx: usize = 0;
    const hex_chars = "0123456789abcdef";
    for (hash) |byte| {
        hex_result[hex_idx] = hex_chars[byte >> 4];
        hex_result[hex_idx + 1] = hex_chars[byte & 0x0f];
        hex_idx += 2;
    }

    return hex_result[0..64];
}

/// Verify password against SHA256 hash
pub fn verifyPassword(allocator: std.mem.Allocator, password: []const u8, hash: []const u8) !bool {
    const computed_hash = try hashPassword(allocator, password);
    defer allocator.free(computed_hash);

    return std.mem.eql(u8, computed_hash, hash);
}

/// Generate unique referral code (8 random alphanumeric characters)
pub fn generateReferralCode(allocator: std.mem.Allocator) ![]u8 {
    const referral_code = try allocator.alloc(u8, 9);
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    var prng = std.Random.DefaultPrng.init(@as(u64, @bitCast(std.time.timestamp())));
    const random = prng.random();

    for (0..9) |i| {
        const idx = random.intRangeAtMost(usize, 0, charset.len - 1);
        referral_code[i] = charset[idx];
    }

    return referral_code;
}
