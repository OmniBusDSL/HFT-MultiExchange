const std = @import("std");

/// Global configuration loaded from environment variables
pub const Config = struct {
    jwt_secret: []const u8,
    password_salt: []const u8,
    vault_secret: []const u8,
    db_path: []const u8,
    port: u16,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) !Config {
        var config: Config = undefined;
        config.allocator = allocator;

        // JWT_SECRET: Read from environment, fallback to default (change in production!)
        if (std.process.getEnvVarOwned(allocator, "JWT_SECRET")) |secret| {
            config.jwt_secret = secret;
            std.debug.print("[CONFIG] ✓ JWT_SECRET loaded from environment\n", .{});
        } else |_| {
            config.jwt_secret = "zig-exchange-secret-v1-change-in-production";
            std.debug.print("[CONFIG] ⚠ JWT_SECRET not found in environment, using hardcoded default\n", .{});
            std.debug.print("[CONFIG] ⚠ SET JWT_SECRET environment variable before production!\n", .{});
        }

        // PASSWORD_SALT: Read from environment, fallback to default (change in production!)
        if (std.process.getEnvVarOwned(allocator, "PASSWORD_SALT")) |salt| {
            config.password_salt = salt;
            std.debug.print("[CONFIG] ✓ PASSWORD_SALT loaded from environment\n", .{});
        } else |_| {
            config.password_salt = "zig-exchange-salt-v1-change-in-production";
            std.debug.print("[CONFIG] ⚠ PASSWORD_SALT not found in environment, using hardcoded default\n", .{});
            std.debug.print("[CONFIG] ⚠ SET PASSWORD_SALT environment variable before production!\n", .{});
        }

        // VAULT_SECRET: Read from environment, fallback to JWT_SECRET
        if (std.process.getEnvVarOwned(allocator, "VAULT_SECRET")) |secret| {
            config.vault_secret = secret;
            std.debug.print("[CONFIG] ✓ VAULT_SECRET loaded from environment\n", .{});
        } else |_| {
            // Fallback to JWT_SECRET if VAULT_SECRET not set (acceptable for development)
            config.vault_secret = config.jwt_secret;
            std.debug.print("[CONFIG] ⚠ VAULT_SECRET not found in environment, using JWT_SECRET as fallback\n", .{});
            std.debug.print("[CONFIG] ⚠ SET VAULT_SECRET environment variable before production!\n", .{});
        }

        // DATABASE_PATH: Read from environment, default to "exchange.db"
        if (std.process.getEnvVarOwned(allocator, "DATABASE_PATH")) |path| {
            config.db_path = path;
            std.debug.print("[CONFIG] ✓ DATABASE_PATH: {s}\n", .{path});
        } else |_| {
            config.db_path = "exchange.db";
            std.debug.print("[CONFIG] DATABASE_PATH not set, using default: exchange.db\n", .{});
        }

        // PORT: Read from environment, default to 8000
        if (std.process.getEnvVarOwned(allocator, "PORT")) |port_str| {
            if (std.fmt.parseInt(u16, port_str, 10)) |port| {
                config.port = port;
                std.debug.print("[CONFIG] ✓ PORT: {}\n", .{port});
            } else |_| {
                config.port = 8000;
                std.debug.print("[CONFIG] Invalid PORT value, using default: 8000\n", .{});
            }
            allocator.free(port_str);
        } else |_| {
            config.port = 8000;
            std.debug.print("[CONFIG] PORT not set, using default: 8000\n", .{});
        }

        return config;
    }

    /// Print configuration summary (without exposing secrets)
    pub fn printSummary(self: *const Config) void {
        std.debug.print("\n[CONFIG] ════════════════════════════════════════\n", .{});
        std.debug.print("[CONFIG] Configuration Summary:\n", .{});
        std.debug.print("[CONFIG] JWT_SECRET:     {s} (length: {})\n", .{ if (self.jwt_secret.len > 20) "***" else self.jwt_secret, self.jwt_secret.len });
        std.debug.print("[CONFIG] PASSWORD_SALT: {s} (length: {})\n", .{ if (self.password_salt.len > 20) "***" else self.password_salt, self.password_salt.len });
        std.debug.print("[CONFIG] VAULT_SECRET:  {s} (length: {})\n", .{ if (self.vault_secret.len > 20) "***" else self.vault_secret, self.vault_secret.len });
        std.debug.print("[CONFIG] DATABASE_PATH: {s}\n", .{self.db_path});
        std.debug.print("[CONFIG] PORT:          {}\n", .{self.port});
        std.debug.print("[CONFIG] ════════════════════════════════════════\n\n", .{});
    }

    /// Free allocated memory
    pub fn deinit(self: *Config) void {
        // Only free if these were allocated from environment
        // The fallback strings are static, so don't free them
        if (!std.mem.eql(u8, self.jwt_secret, "zig-exchange-secret-v1-change-in-production")) {
            self.allocator.free(self.jwt_secret);
        }
        if (!std.mem.eql(u8, self.password_salt, "zig-exchange-salt-v1-change-in-production")) {
            self.allocator.free(self.password_salt);
        }
        // vault_secret: only free if it was explicitly allocated from VAULT_SECRET env var
        // (not the fallback to jwt_secret)
        if (self.vault_secret.ptr != self.jwt_secret.ptr) {
            // Zero memory before freeing for security
            const vault_secret_mut = @constCast(self.vault_secret);
            @memset(vault_secret_mut, 0);
            self.allocator.free(self.vault_secret);
        }
        if (!std.mem.eql(u8, self.db_path, "exchange.db")) {
            self.allocator.free(self.db_path);
        }
    }
};

/// Global config instance
var global_config: ?Config = null;

/// Initialize global configuration
pub fn initGlobalConfig(allocator: std.mem.Allocator) !void {
    global_config = try Config.init(allocator);
    global_config.?.printSummary();
}

/// Get global configuration
pub fn getConfig() ?*Config {
    if (global_config) |*config| {
        return config;
    }
    return null;
}

/// Cleanup global configuration
pub fn deinitGlobalConfig() void {
    if (global_config) |*config| {
        config.deinit();
        global_config = null;
    }
}
