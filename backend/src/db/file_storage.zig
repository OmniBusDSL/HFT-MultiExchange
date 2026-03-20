const std = @import("std");
const users_module = @import("users.zig");

const DB_FILE = "users.json";

pub const FileStorage = struct {
    allocator: std.mem.Allocator,
    filepath: []const u8,

    pub fn init(allocator: std.mem.Allocator, filepath: []const u8) !FileStorage {
        return FileStorage{
            .allocator = allocator,
            .filepath = filepath,
        };
    }

    /// Save users to JSON file
    pub fn saveUsers(self: *FileStorage, users: std.StringHashMap(users_module.User)) !void {
        var file = try std.fs.cwd().createFile(self.filepath, .{});
        defer file.close();

        var iter = users.iterator();
        try file.writeAll("{\n  \"users\": [\n");

        var first = true;
        while (iter.next()) |entry| {
            if (!first) try file.writeAll(",\n");
            first = false;

            const user = entry.value_ptr.*;
            const json = try std.fmt.allocPrint(
                self.allocator,
                "    {{\"id\":{},\"email\":\"{s}\",\"password_hash\":\"{s}\",\"btc_address\":\"{s}\",\"created_at\":{}}}",
                .{ user.id, user.email, user.password_hash, user.btc_address, user.created_at },
            );
            defer self.allocator.free(json);

            try file.writeAll(json);
        }

        try file.writeAll("\n  ]\n}\n");
        std.debug.print("[STORAGE] ✓ Saved {} users to {s}\n", .{ users.count(), self.filepath });
    }

    /// Load users from JSON file
    pub fn loadUsers(self: *FileStorage) !std.StringHashMap(users_module.User) {
        var result = std.StringHashMap(users_module.User).init(self.allocator);

        // Try to read file
        var file = std.fs.cwd().openFile(self.filepath, .{}) catch |err| {
            std.debug.print("[STORAGE] No existing users file, starting fresh\n", .{});
            return result;
        };
        defer file.close();

        // Read file content
        const stat = try file.stat();
        const content = try file.readToEndAlloc(self.allocator, stat.size);
        defer self.allocator.free(content);

        std.debug.print("[STORAGE] Loaded {} bytes from {s}\n", .{ content.len, self.filepath });

        // TODO: Parse JSON and restore users
        // For now, just return empty (will be populated by register calls)

        return result;
    }
};
