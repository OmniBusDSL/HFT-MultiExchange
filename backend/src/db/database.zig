const std = @import("std");
const c = @cImport({
    @cInclude("sqlite3.h");
});
const vault = @import("../crypto/vault.zig");
const config_module = @import("../config/config.zig");

pub const ReferredUser = struct {
    id: u32,
    email: []const u8,
    created_at: i64,

    pub fn deinit(self: *const ReferredUser, allocator: std.mem.Allocator) void {
        allocator.free(self.email);
    }
};

pub const Database = struct {
    db: ?*c.sqlite3 = null,
    allocator: std.mem.Allocator,
    filepath: []const u8 = "exchange.db",

    pub fn init(allocator: std.mem.Allocator, filepath: []const u8) !Database {
        var self = Database{
            .allocator = allocator,
            .filepath = filepath,
        };

        // Open database
        var db: ?*c.sqlite3 = null;
        const rc = c.sqlite3_open(filepath.ptr, &db);

        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to open database: {}\n", .{rc});
            return error.DatabaseOpenFailed;
        }

        self.db = db;
        std.debug.print("[DB] ✓ Connected to SQLite database: {s}\n", .{filepath});

        // Enable WAL mode for concurrent read/write
        var err_msg: [*c]u8 = null;
        const rc_wal = c.sqlite3_exec(db, "PRAGMA journal_mode=WAL;", null, null, &err_msg);
        if (rc_wal != 0) {
            std.debug.print("[DB] WARNING: Failed to enable WAL: {s}\n", .{err_msg});
            if (err_msg != null) c.sqlite3_free(err_msg);
        } else {
            std.debug.print("[DB] ✓ WAL mode enabled\n", .{});
        }

        // Initialize schema
        try self.initSchema();

        return self;
    }

    pub fn deinit(self: *Database) void {
        if (self.db) |db| {
            _ = c.sqlite3_close(db);
            std.debug.print("[DB] ✓ Database connection closed\n", .{});
        }
    }

    fn initSchema(self: *Database) !void {
        const schema =
            "CREATE TABLE IF NOT EXISTS users (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  email TEXT UNIQUE NOT NULL," ++
            "  password_hash TEXT NOT NULL," ++
            "  referral_code TEXT UNIQUE NOT NULL," ++
            "  referred_by TEXT," ++
            "  created_at INTEGER NOT NULL" ++
            ");" ++
            "CREATE TABLE IF NOT EXISTS orders (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  user_id INTEGER NOT NULL," ++
            "  pair TEXT NOT NULL," ++
            "  side TEXT NOT NULL," ++
            "  price REAL NOT NULL," ++
            "  quantity REAL NOT NULL," ++
            "  status TEXT NOT NULL," ++
            "  created_at INTEGER NOT NULL," ++
            "  FOREIGN KEY (user_id) REFERENCES users(id)" ++
            ");" ++
            "CREATE TABLE IF NOT EXISTS api_keys (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  user_id INTEGER NOT NULL," ++
            "  name TEXT NOT NULL," ++
            "  exchange TEXT NOT NULL," ++
            "  api_key TEXT NOT NULL," ++
            "  api_secret TEXT," ++
            "  status TEXT NOT NULL DEFAULT 'active'," ++
            "  created_at INTEGER NOT NULL," ++
            "  FOREIGN KEY (user_id) REFERENCES users(id)" ++
            ");" ++
            "CREATE TABLE IF NOT EXISTS price_feed (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  pair TEXT NOT NULL," ++
            "  price_int INTEGER NOT NULL," ++
            "  timestamp INTEGER NOT NULL" ++
            ");" ++
            "CREATE TABLE IF NOT EXISTS market_tickers (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  exchange TEXT NOT NULL," ++
            "  symbol TEXT NOT NULL," ++
            "  last_updated INTEGER NOT NULL," ++
            "  UNIQUE(exchange, symbol)" ++
            ");" ++
            "CREATE TABLE IF NOT EXISTS exchange_pairs (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  exchange TEXT NOT NULL," ++
            "  pair TEXT NOT NULL," ++
            "  last_synced INTEGER NOT NULL," ++
            "  UNIQUE(exchange, pair)" ++
            ");" ++
            "CREATE TABLE IF NOT EXISTS grouped_pairs (" ++
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," ++
            "  pair TEXT UNIQUE NOT NULL," ++
            "  group_name TEXT NOT NULL," ++
            "  last_updated INTEGER NOT NULL" ++
            ");" ++
            "CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);" ++
            "CREATE INDEX IF NOT EXISTS idx_price_feed_pair ON price_feed(pair);" ++
            "CREATE INDEX IF NOT EXISTS idx_market_tickers_exchange ON market_tickers(exchange);" ++
            "CREATE INDEX IF NOT EXISTS idx_exchange_pairs_exchange ON exchange_pairs(exchange);" ++
            "CREATE INDEX IF NOT EXISTS idx_grouped_pairs_group ON grouped_pairs(group_name);";

        var err_msg: [*c]u8 = null;
        defer if (err_msg != null) c.sqlite3_free(err_msg);

        const rc = c.sqlite3_exec(self.db, schema, null, null, &err_msg);

        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to create schema: {s}\n", .{err_msg});
            return error.SchemaInitFailed;
        }

        std.debug.print("[DB] ✓ Database schema initialized\n", .{});
    }

    pub fn createUser(self: *Database, email: []const u8, password_hash: []const u8, referral_code: []const u8, referred_by: ?[]const u8) !u32 {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "INSERT INTO users (email, password_hash, referral_code, referred_by, created_at) VALUES (?, ?, ?, ?, ?)";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to prepare statement: {}\n", .{rc});
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        const now = std.time.timestamp();

        // Bind parameters
        _ = c.sqlite3_bind_text(stmt, 1, email.ptr, @intCast(email.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 2, password_hash.ptr, @intCast(password_hash.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 3, referral_code.ptr, @intCast(referral_code.len), c.SQLITE_STATIC);
        if (referred_by) |ref| {
            _ = c.sqlite3_bind_text(stmt, 4, ref.ptr, @intCast(ref.len), c.SQLITE_STATIC);
        } else {
            _ = c.sqlite3_bind_null(stmt, 4);
        }
        _ = c.sqlite3_bind_int64(stmt, 5, now);

        // Execute
        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            std.debug.print("[DB] ERROR: Failed to insert user: {}\n", .{rc});
            if (rc == 19) { // SQLITE_CONSTRAINT
                return error.UserAlreadyExists;
            }
            return error.InsertFailed;
        }

        const user_id = c.sqlite3_last_insert_rowid(self.db);
        std.debug.print("[DB] ✓ User created with ID: {}\n", .{user_id});

        return @intCast(user_id);
    }

    pub fn getUserByEmail(self: *Database, allocator: std.mem.Allocator, email: []const u8) !?UserRecord {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT id, email, password_hash, referral_code, referred_by, created_at FROM users WHERE email = ?";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to prepare statement: {}\n", .{rc});
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, email.ptr, @intCast(email.len), c.SQLITE_STATIC);

        rc = c.sqlite3_step(stmt);
        if (rc == c.SQLITE_ROW) {
            const id = c.sqlite3_column_int(stmt, 0);
            const email_col = c.sqlite3_column_text(stmt, 1);
            const password_hash_col = c.sqlite3_column_text(stmt, 2);
            const referral_code_col = c.sqlite3_column_text(stmt, 3);
            const referred_by_col = c.sqlite3_column_text(stmt, 4);
            const created_at = c.sqlite3_column_int64(stmt, 5);

            const email_len = std.mem.len(email_col);
            const hash_len = std.mem.len(password_hash_col);
            const code_len = std.mem.len(referral_code_col);

            var referred_by: ?[]const u8 = null;
            if (referred_by_col != null) {
                const ref_len = std.mem.len(referred_by_col);
                referred_by = try allocator.dupe(u8, referred_by_col[0..ref_len]);
            }

            const user = UserRecord{
                .id = @intCast(id),
                .email = try allocator.dupe(u8, email_col[0..email_len]),
                .password_hash = try allocator.dupe(u8, password_hash_col[0..hash_len]),
                .referral_code = try allocator.dupe(u8, referral_code_col[0..code_len]),
                .referred_by = referred_by,
                .created_at = created_at,
            };

            return user;
        }

        return null;
    }

    pub fn getUserCount(self: *Database) !u32 {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT COUNT(*) FROM users";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        rc = c.sqlite3_step(stmt);
        if (rc == c.SQLITE_ROW) {
            const count = c.sqlite3_column_int(stmt, 0);
            return @intCast(count);
        }

        return 0;
    }

    pub fn userExists(self: *Database, email: []const u8) !bool {
        if (try self.getUserByEmail(std.heap.page_allocator, email)) |user| {
            defer user.deinit(std.heap.page_allocator);
            return true;
        }
        return false;
    }

    pub fn referralCodeExists(self: *Database, referral_code: []const u8) !bool {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT 1 FROM users WHERE referral_code = ?";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return false;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, referral_code.ptr, @intCast(referral_code.len), c.SQLITE_STATIC);

        const step_rc = c.sqlite3_step(stmt);
        return step_rc == c.SQLITE_ROW;
    }

    /// Updates referral_code for user AND cascades: all users with referred_by = old_code
    /// get their referred_by updated to new_code. Runs in a single transaction.
    pub fn updateReferralCodeCascade(self: *Database, allocator: std.mem.Allocator, user_id: u32, new_code: []const u8) !bool {
        // Fetch current referral code
        const user = (try self.getUserById(allocator, user_id)) orelse return false;
        defer user.deinit(allocator);
        const old_code = user.referral_code;

        _ = c.sqlite3_exec(self.db, "BEGIN TRANSACTION;", null, null, null);
        errdefer _ = c.sqlite3_exec(self.db, "ROLLBACK;", null, null, null);

        // 1. Update referred_by for everyone who used old_code
        var stmt1: ?*c.sqlite3_stmt = null;
        if (c.sqlite3_prepare_v2(self.db,
            "UPDATE users SET referred_by = ? WHERE referred_by = ?",
            -1, &stmt1, null) != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(stmt1);
        _ = c.sqlite3_bind_text(stmt1, 1, new_code.ptr, @intCast(new_code.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt1, 2, old_code.ptr, @intCast(old_code.len), c.SQLITE_STATIC);
        if (c.sqlite3_step(stmt1) != c.SQLITE_DONE) return error.UpdateFailed;

        const updated_refs = c.sqlite3_changes(self.db);

        // 2. Update the user's own referral_code
        var stmt2: ?*c.sqlite3_stmt = null;
        if (c.sqlite3_prepare_v2(self.db,
            "UPDATE users SET referral_code = ? WHERE id = ?",
            -1, &stmt2, null) != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(stmt2);
        _ = c.sqlite3_bind_text(stmt2, 1, new_code.ptr, @intCast(new_code.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_int(stmt2, 2, @intCast(user_id));
        if (c.sqlite3_step(stmt2) != c.SQLITE_DONE) return error.UpdateFailed;

        _ = c.sqlite3_exec(self.db, "COMMIT;", null, null, null);
        std.debug.print("[DB] ✓ Referral cascade: old={s} new={s} refs_updated={d}\n",
            .{ old_code, new_code, updated_refs });
        return true;
    }

    pub fn updateReferralCode(self: *Database, user_id: u32, new_referral_code: []const u8) !bool {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "UPDATE users SET referral_code = ? WHERE id = ?";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return false;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, new_referral_code.ptr, @intCast(new_referral_code.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_int(stmt, 2, @intCast(user_id));

        const step_rc = c.sqlite3_step(stmt);
        return step_rc == c.SQLITE_DONE;
    }

    pub fn addApiKey(self: *Database, user_id: u32, name: []const u8, exchange: []const u8, api_key: []const u8, api_secret: []const u8) !u32 {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "INSERT INTO api_keys (user_id, name, exchange, api_key, api_secret, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to prepare statement: {}\n", .{rc});
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        const now = std.time.timestamp();

        // Encrypt API key and secret before storing in database
        const config = config_module.getConfig();
        if (config == null) {
            return error.ConfigNotInitialized;
        }
        const vault_key = vault.deriveVaultKey(config.?.vault_secret);
        const enc_key = try vault.encrypt(self.allocator, api_key, vault_key);
        defer self.allocator.free(enc_key);
        const enc_secret = try vault.encrypt(self.allocator, api_secret, vault_key);
        defer self.allocator.free(enc_secret);

        _ = c.sqlite3_bind_int(stmt, 1, @intCast(user_id));
        _ = c.sqlite3_bind_text(stmt, 2, name.ptr, @intCast(name.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 3, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 4, enc_key.ptr, @intCast(enc_key.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 5, enc_secret.ptr, @intCast(enc_secret.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 6, "active", 6, c.SQLITE_STATIC);
        _ = c.sqlite3_bind_int64(stmt, 7, now);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            std.debug.print("[DB] ERROR: Failed to insert API key: {}\n", .{rc});
            return error.InsertFailed;
        }

        const key_id = c.sqlite3_last_insert_rowid(self.db);
        return @intCast(key_id);
    }

    pub fn getApiKeysByUserId(self: *Database, allocator: std.mem.Allocator, user_id: u32) ![]ApiKeyRecord {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT id, user_id, name, exchange, api_key, api_secret, status, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_int(stmt, 1, @intCast(user_id));

        var keys: std.ArrayList(ApiKeyRecord) = .empty;

        const config = config_module.getConfig();
        if (config == null) {
            return error.ConfigNotInitialized;
        }
        const vault_key = vault.deriveVaultKey(config.?.vault_secret);

        while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
            const id = c.sqlite3_column_int(stmt, 0);
            const uid = c.sqlite3_column_int(stmt, 1);
            const name_col = c.sqlite3_column_text(stmt, 2);
            const exchange_col = c.sqlite3_column_text(stmt, 3);
            const api_key_col = c.sqlite3_column_text(stmt, 4);
            const api_secret_col = c.sqlite3_column_text(stmt, 5);
            const status_col = c.sqlite3_column_text(stmt, 6);
            const created_at = c.sqlite3_column_int64(stmt, 7);

            const name_len = std.mem.len(name_col);
            const exchange_len = std.mem.len(exchange_col);
            const api_key_len = std.mem.len(api_key_col);
            const api_secret_len = std.mem.len(api_secret_col);
            const status_len = std.mem.len(status_col);

            // Decrypt API key and secret
            const dec_api_key = try vault.decrypt(allocator, api_key_col[0..api_key_len], vault_key);
            const dec_api_secret = try vault.decrypt(allocator, api_secret_col[0..api_secret_len], vault_key);

            const key = ApiKeyRecord{
                .id = @intCast(id),
                .user_id = @intCast(uid),
                .name = try allocator.dupe(u8, name_col[0..name_len]),
                .exchange = try allocator.dupe(u8, exchange_col[0..exchange_len]),
                .api_key = dec_api_key,
                .api_secret = dec_api_secret,
                .status = try allocator.dupe(u8, status_col[0..status_len]),
                .created_at = created_at,
            };

            try keys.append(allocator, key);
        }

        return keys.toOwnedSlice(allocator);
    }

    /// Cache a market ticker (insert or update)
    pub fn cacheMarketTicker(self: *Database, exchange: []const u8, symbol: []const u8) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "INSERT INTO market_tickers (exchange, symbol, last_updated) VALUES (?, ?, ?) ON CONFLICT(exchange, symbol) DO UPDATE SET last_updated = ?";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to prepare cacheMarketTicker: {}\n", .{rc});
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        const now = std.time.timestamp();

        _ = c.sqlite3_bind_text(stmt, 1, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 2, symbol.ptr, @intCast(symbol.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_int64(stmt, 3, now);
        _ = c.sqlite3_bind_int64(stmt, 4, now);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            std.debug.print("[DB] ERROR: Failed to cache market ticker: {}\n", .{rc});
            return error.InsertFailed;
        }
    }

    /// Get all cached tickers for an exchange
    pub fn getCachedTickersByExchange(self: *Database, allocator: std.mem.Allocator, exchange: []const u8) ![][]const u8 {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT symbol FROM market_tickers WHERE exchange = ? ORDER BY symbol";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);

        var symbols: std.ArrayList([]const u8) = .empty;

        while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
            const symbol_col = c.sqlite3_column_text(stmt, 0);
            const symbol_len = std.mem.len(symbol_col);
            const symbol_copy = try allocator.dupe(u8, symbol_col[0..symbol_len]);
            try symbols.append(allocator, symbol_copy);
        }

        return symbols.toOwnedSlice(allocator);
    }

    /// Store pairs for an exchange in the database
    pub fn storePairsForExchange(self: *Database, exchange: []const u8, pairs: []const []const u8) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "INSERT INTO exchange_pairs (exchange, pair, last_synced) VALUES (?, ?, ?) ON CONFLICT(exchange, pair) DO UPDATE SET last_synced = ?";

        const now = std.time.timestamp();

        for (pairs) |pair| {
            var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
            if (rc != 0) {
                std.debug.print("[DB] ERROR: Failed to prepare storePairs: {}\n", .{rc});
                return error.PrepareFailed;
            }

            _ = c.sqlite3_bind_text(stmt, 1, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);
            _ = c.sqlite3_bind_text(stmt, 2, pair.ptr, @intCast(pair.len), c.SQLITE_STATIC);
            _ = c.sqlite3_bind_int64(stmt, 3, now);
            _ = c.sqlite3_bind_int64(stmt, 4, now);

            rc = c.sqlite3_step(stmt);
            _ = c.sqlite3_finalize(stmt);

            if (rc != c.SQLITE_DONE) {
                std.debug.print("[DB] ERROR: Failed to insert pair: {}\n", .{rc});
                return error.InsertFailed;
            }
        }

        std.debug.print("[DB] ✓ Stored {d} pairs for exchange={s}\n", .{ pairs.len, exchange });
    }

    /// Get all pairs for an exchange from database
    pub fn getPairsForExchange(self: *Database, allocator: std.mem.Allocator, exchange: []const u8) ![][]const u8 {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT pair FROM exchange_pairs WHERE exchange = ? ORDER BY pair";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);

        var pairs: std.ArrayList([]const u8) = .empty;

        while (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
            const pair_col = c.sqlite3_column_text(stmt, 0);
            const pair_len = std.mem.len(pair_col);
            const pair_copy = try allocator.dupe(u8, pair_col[0..pair_len]);
            try pairs.append(allocator, pair_copy);
        }

        return pairs.toOwnedSlice(allocator);
    }

    /// Clear all pairs for an exchange (for re-syncing)
    pub fn clearPairsForExchange(self: *Database, exchange: []const u8) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "DELETE FROM exchange_pairs WHERE exchange = ?";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            return error.DeleteFailed;
        }

        std.debug.print("[DB] ✓ Cleared all pairs for exchange={s}\n", .{exchange});
    }

    /// Clear all cached tickers for an exchange
    pub fn clearCachedTickersByExchange(self: *Database, exchange: []const u8) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "DELETE FROM market_tickers WHERE exchange = ?";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, exchange.ptr, @intCast(exchange.len), c.SQLITE_STATIC);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            return error.DeleteFailed;
        }
    }

    /// Fetch a single API key by id, verifying it belongs to user_id.
    pub fn getApiKeyById(self: *Database, allocator: std.mem.Allocator, key_id: u32, user_id: u32) !?ApiKeyRecord {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT id, user_id, name, exchange, api_key, api_secret, status, created_at FROM api_keys WHERE id = ? AND user_id = ?";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_int(stmt, 1, @intCast(key_id));
        _ = c.sqlite3_bind_int(stmt, 2, @intCast(user_id));

        const config = config_module.getConfig();
        if (config == null) {
            return error.ConfigNotInitialized;
        }
        const vault_key = vault.deriveVaultKey(config.?.vault_secret);

        if (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
            const id = c.sqlite3_column_int(stmt, 0);
            const uid = c.sqlite3_column_int(stmt, 1);
            const name_col = c.sqlite3_column_text(stmt, 2);
            const exchange_col = c.sqlite3_column_text(stmt, 3);
            const api_key_col = c.sqlite3_column_text(stmt, 4);
            const api_secret_col = c.sqlite3_column_text(stmt, 5);
            const status_col = c.sqlite3_column_text(stmt, 6);
            const created_at = c.sqlite3_column_int64(stmt, 7);

            // Decrypt API key and secret
            const dec_api_key = try vault.decrypt(allocator, api_key_col[0..std.mem.len(api_key_col)], vault_key);
            const dec_api_secret = try vault.decrypt(allocator, api_secret_col[0..std.mem.len(api_secret_col)], vault_key);

            return ApiKeyRecord{
                .id = @intCast(id),
                .user_id = @intCast(uid),
                .name = try allocator.dupe(u8, name_col[0..std.mem.len(name_col)]),
                .exchange = try allocator.dupe(u8, exchange_col[0..std.mem.len(exchange_col)]),
                .api_key = dec_api_key,
                .api_secret = dec_api_secret,
                .status = try allocator.dupe(u8, status_col[0..std.mem.len(status_col)]),
                .created_at = created_at,
            };
        }
        return null;
    }

    pub fn deleteApiKey(self: *Database, key_id: u32, user_id: u32) !bool {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "DELETE FROM api_keys WHERE id = ? AND user_id = ?";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_int(stmt, 1, @intCast(key_id));
        _ = c.sqlite3_bind_int(stmt, 2, @intCast(user_id));

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            return error.DeleteFailed;
        }

        return c.sqlite3_changes(self.db) > 0;
    }

    pub fn insertPriceTick(self: *Database, pair: []const u8, price_int: i64, timestamp: i64) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "INSERT INTO price_feed (pair, price_int, timestamp) VALUES (?, ?, ?)";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, pair.ptr, @intCast(pair.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_int64(stmt, 2, price_int);
        _ = c.sqlite3_bind_int64(stmt, 3, timestamp);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            return error.InsertFailed;
        }
    }

    pub fn getLatestPrice(self: *Database, _: std.mem.Allocator, pair: []const u8) !?i64 {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT price_int FROM price_feed WHERE pair = ? ORDER BY timestamp DESC LIMIT 1";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_text(stmt, 1, pair.ptr, @intCast(pair.len), c.SQLITE_STATIC);

        rc = c.sqlite3_step(stmt);
        if (rc == c.SQLITE_ROW) {
            const price = c.sqlite3_column_int64(stmt, 0);
            return price;
        }

        return null;
    }

    pub fn getUserById(self: *Database, allocator: std.mem.Allocator, user_id: u32) !?UserRecord {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "SELECT id, email, password_hash, referral_code, referred_by, created_at FROM users WHERE id = ?";

        const rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(stmt);

        _ = c.sqlite3_bind_int(stmt, 1, @intCast(user_id));

        if (c.sqlite3_step(stmt) == c.SQLITE_ROW) {
            const id = c.sqlite3_column_int(stmt, 0);
            const email_col = c.sqlite3_column_text(stmt, 1);
            const hash_col = c.sqlite3_column_text(stmt, 2);
            const code_col = c.sqlite3_column_text(stmt, 3);
            const ref_col = c.sqlite3_column_text(stmt, 4);
            const created_at = c.sqlite3_column_int64(stmt, 5);

            var referred_by: ?[]const u8 = null;
            if (ref_col != null) {
                referred_by = try allocator.dupe(u8, ref_col[0..std.mem.len(ref_col)]);
            }

            return UserRecord{
                .id = @intCast(id),
                .email = try allocator.dupe(u8, email_col[0..std.mem.len(email_col)]),
                .password_hash = try allocator.dupe(u8, hash_col[0..std.mem.len(hash_col)]),
                .referral_code = try allocator.dupe(u8, code_col[0..std.mem.len(code_col)]),
                .referred_by = referred_by,
                .created_at = created_at,
            };
        }
        return null;
    }

    pub fn getReferredUsers(self: *Database, allocator: std.mem.Allocator, referral_code: []const u8) ![]ReferredUser {
        // Pass 1: count
        var count_stmt: ?*c.sqlite3_stmt = null;
        var rc = c.sqlite3_prepare_v2(self.db, "SELECT COUNT(*) FROM users WHERE referred_by = ?", -1, &count_stmt, null);
        if (rc != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(count_stmt);
        _ = c.sqlite3_bind_text(count_stmt, 1, referral_code.ptr, @intCast(referral_code.len), c.SQLITE_STATIC);
        const count: usize = if (c.sqlite3_step(count_stmt) == c.SQLITE_ROW)
            @intCast(c.sqlite3_column_int(count_stmt, 0))
        else
            0;

        if (count == 0) return &[_]ReferredUser{};

        // Pass 2: fetch
        const result = try allocator.alloc(ReferredUser, count);
        errdefer allocator.free(result);

        var stmt: ?*c.sqlite3_stmt = null;
        rc = c.sqlite3_prepare_v2(self.db, "SELECT id, email, created_at FROM users WHERE referred_by = ? ORDER BY created_at ASC", -1, &stmt, null);
        if (rc != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(stmt);
        _ = c.sqlite3_bind_text(stmt, 1, referral_code.ptr, @intCast(referral_code.len), c.SQLITE_STATIC);

        var i: usize = 0;
        while (c.sqlite3_step(stmt) == c.SQLITE_ROW and i < count) : (i += 1) {
            const email_col = c.sqlite3_column_text(stmt, 1);
            result[i] = ReferredUser{
                .id = @intCast(c.sqlite3_column_int(stmt, 0)),
                .email = try allocator.dupe(u8, email_col[0..std.mem.len(email_col)]),
                .created_at = c.sqlite3_column_int64(stmt, 2),
            };
        }
        return result[0..i];
    }

    pub fn clearGroupedPairs(self: *Database) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "DELETE FROM grouped_pairs";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to prepare clear statement: {}\n", .{rc});
            return error.PrepareFailed;
        }
        defer _ = c.sqlite3_finalize(stmt);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            std.debug.print("[DB] ERROR: Failed to clear grouped_pairs: {}\n", .{rc});
            return error.DeleteFailed;
        }

        std.debug.print("[DB] ✓ Cleared grouped_pairs table\n", .{});
    }

    pub fn saveGroupedPair(self: *Database, pair: []const u8, group_name: []const u8) !void {
        var stmt: ?*c.sqlite3_stmt = null;
        const query = "INSERT OR REPLACE INTO grouped_pairs (pair, group_name, last_updated) VALUES (?, ?, ?)";

        var rc = c.sqlite3_prepare_v2(self.db, query, -1, &stmt, null);
        if (rc != 0) {
            std.debug.print("[DB] ERROR: Failed to prepare insert statement: {}\n", .{rc});
            return error.PrepareFailed;
        }

        defer _ = c.sqlite3_finalize(stmt);

        const now = std.time.timestamp();

        _ = c.sqlite3_bind_text(stmt, 1, pair.ptr, @intCast(pair.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_text(stmt, 2, group_name.ptr, @intCast(group_name.len), c.SQLITE_STATIC);
        _ = c.sqlite3_bind_int64(stmt, 3, now);

        rc = c.sqlite3_step(stmt);
        if (rc != c.SQLITE_DONE) {
            std.debug.print("[DB] ERROR: Failed to insert grouped pair: {}\n", .{rc});
            return error.InsertFailed;
        }
    }

    pub fn getGroupedPairs(self: *Database, allocator: std.mem.Allocator, group_name: []const u8) ![]GroupedPair {
        // Pass 1: count
        var count_stmt: ?*c.sqlite3_stmt = null;
        var rc = c.sqlite3_prepare_v2(self.db, "SELECT COUNT(*) FROM grouped_pairs WHERE group_name = ?", -1, &count_stmt, null);
        if (rc != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(count_stmt);
        _ = c.sqlite3_bind_text(count_stmt, 1, group_name.ptr, @intCast(group_name.len), c.SQLITE_STATIC);

        const count: usize = if (c.sqlite3_step(count_stmt) == c.SQLITE_ROW)
            @intCast(c.sqlite3_column_int(count_stmt, 0))
        else
            0;

        if (count == 0) return &[_]GroupedPair{};

        // Pass 2: fetch
        const result = try allocator.alloc(GroupedPair, count);
        errdefer allocator.free(result);

        var stmt: ?*c.sqlite3_stmt = null;
        rc = c.sqlite3_prepare_v2(self.db, "SELECT id, pair, group_name, last_updated FROM grouped_pairs WHERE group_name = ? ORDER BY id ASC", -1, &stmt, null);
        if (rc != 0) return error.PrepareFailed;
        defer _ = c.sqlite3_finalize(stmt);
        _ = c.sqlite3_bind_text(stmt, 1, group_name.ptr, @intCast(group_name.len), c.SQLITE_STATIC);

        var i: usize = 0;
        while (c.sqlite3_step(stmt) == c.SQLITE_ROW and i < count) : (i += 1) {
            const pair_col = c.sqlite3_column_text(stmt, 1);
            const group_col = c.sqlite3_column_text(stmt, 2);

            result[i] = GroupedPair{
                .id = @intCast(c.sqlite3_column_int(stmt, 0)),
                .pair = try allocator.dupe(u8, pair_col[0..std.mem.len(pair_col)]),
                .group_name = try allocator.dupe(u8, group_col[0..std.mem.len(group_col)]),
                .last_updated = c.sqlite3_column_int64(stmt, 3),
            };
        }
        return result[0..i];
    }
};

pub const UserRecord = struct {
    id: u32,
    email: []const u8,
    password_hash: []const u8,
    referral_code: []const u8,
    referred_by: ?[]const u8,
    created_at: i64,

    pub fn deinit(self: *const UserRecord, allocator: std.mem.Allocator) void {
        allocator.free(self.email);
        allocator.free(self.password_hash);
        allocator.free(self.referral_code);
        if (self.referred_by) |ref| {
            allocator.free(ref);
        }
    }
};

pub const ApiKeyRecord = struct {
    id: u32,
    user_id: u32,
    name: []const u8,
    exchange: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    status: []const u8,
    created_at: i64,

    pub fn deinit(self: *ApiKeyRecord, allocator: std.mem.Allocator) void {
        allocator.free(self.name);
        allocator.free(self.exchange);
        // Securely zero sensitive data before freeing
        const mutable_api_key = @constCast(self.api_key);
        vault.secureZero(mutable_api_key);
        allocator.free(mutable_api_key);
        const mutable_api_secret = @constCast(self.api_secret);
        vault.secureZero(mutable_api_secret);
        allocator.free(mutable_api_secret);
        allocator.free(self.status);
    }
};

pub const GroupedPair = struct {
    id: u32,
    pair: []const u8,
    group_name: []const u8,
    last_updated: i64,

    pub fn deinit(self: *const GroupedPair, allocator: std.mem.Allocator) void {
        allocator.free(self.pair);
        allocator.free(self.group_name);
    }
};
