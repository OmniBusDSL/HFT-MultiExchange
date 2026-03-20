const std = @import("std");

pub const JsonValue = union(enum) {
    string: []const u8,
    number: f64,
    boolean: bool,
    null: void,
};

/// Robust JSON parser for extracting string values
/// Handles: "key": "value" with proper quote escaping
pub fn getStringValue(allocator: std.mem.Allocator, json: []const u8, key: []const u8) !?[]const u8 {
    _ = allocator;

    std.debug.print("[JSON] Looking for key: {s}\n", .{key});
    std.debug.print("[JSON] JSON content: {s}\n", .{json[0..@min(json.len, 300)]});

    // Look for "key":
    var key_search: [256]u8 = undefined;
    const key_pattern = try std.fmt.bufPrint(&key_search, "\"{s}\":", .{key});

    const key_pos = std.mem.indexOf(u8, json, key_pattern) orelse {
        std.debug.print("[JSON] ERROR: Key pattern not found: {s}\n", .{key_pattern});
        return null;
    };

    const after_key = key_pos + key_pattern.len;
    std.debug.print("[JSON] Found key at position {}, after_key: {}\n", .{ key_pos, after_key });

    // Skip whitespace
    var idx = after_key;
    while (idx < json.len and (json[idx] == ' ' or json[idx] == '\t')) {
        idx += 1;
    }

    // Expect opening quote
    if (idx >= json.len or json[idx] != '"') {
        std.debug.print("[JSON] ERROR: Expected quote at position {}\n", .{idx});
        return null;
    }

    idx += 1; // Skip opening quote
    const value_start = idx;

    // Find closing quote (handle escaped quotes)
    while (idx < json.len) {
        if (json[idx] == '"') {
            // Check if it's escaped
            var backslash_count: usize = 0;
            var check_idx = idx;
            while (check_idx > 0 and json[check_idx - 1] == '\\') {
                backslash_count += 1;
                check_idx -= 1;
            }

            // If even number of backslashes, the quote is not escaped
            if (backslash_count % 2 == 0) {
                const value_end = idx;
                const result = json[value_start..value_end];
                std.debug.print("[JSON] ✓ Found value: {s}\n", .{result});
                return result;
            }
        }
        idx += 1;
    }

    std.debug.print("[JSON] ERROR: Closing quote not found\n", .{});
    return null;
}

/// Extract numeric value from JSON
/// Handles: "key": 123 or "key": 123.45 (unquoted numbers)
pub fn getNumberValue(json: []const u8, key: []const u8) !?f64 {
    var key_search: [256]u8 = undefined;
    const key_pattern = try std.fmt.bufPrint(&key_search, "\"{s}\":", .{key});

    const key_pos = std.mem.indexOf(u8, json, key_pattern) orelse return null;

    var idx = key_pos + key_pattern.len;
    // Skip whitespace
    while (idx < json.len and (json[idx] == ' ' or json[idx] == '\t')) {
        idx += 1;
    }

    // Find the number end (space, comma, or closing brace/bracket)
    const num_start = idx;
    while (idx < json.len and json[idx] != ',' and json[idx] != '}' and json[idx] != ']' and json[idx] != ' ') {
        idx += 1;
    }

    if (num_start == idx) return null;
    const num_str = json[num_start..idx];
    return std.fmt.parseFloat(f64, num_str) catch null;
}

/// Extract string value from nested object path: "data": { "id": "value" }
pub fn getNestedStringValue(allocator: std.mem.Allocator, json: []const u8, path: []const u8) !?[]const u8 {
    var parts = std.mem.splitSequence(u8, path, ".");
    var current_json = json;

    while (parts.next()) |part| {
        var key_search: [256]u8 = undefined;
        const key_pattern = try std.fmt.bufPrint(&key_search, "\"{s}\":", .{part});

        const key_pos = std.mem.indexOf(u8, current_json, key_pattern) orelse return null;

        // Find the value in this segment
        var idx = key_pos + key_pattern.len;
        while (idx < current_json.len and (current_json[idx] == ' ' or current_json[idx] == '\t')) {
            idx += 1;
        }

        // Check if it's an object (for nested paths) or string
        if (idx < current_json.len and current_json[idx] == '{') {
            // This is a nested object, find its content
            var brace_count: i32 = 1;
            idx += 1;
            const obj_start = idx;
            while (idx < current_json.len and brace_count > 0) {
                if (current_json[idx] == '{') brace_count += 1;
                if (current_json[idx] == '}') brace_count -= 1;
                idx += 1;
            }
            current_json = current_json[obj_start..idx-1];
        } else if (idx < current_json.len and current_json[idx] == '"') {
            // This is a string value
            idx += 1;
            const value_start = idx;
            while (idx < current_json.len) {
                if (current_json[idx] == '"') {
                    var backslash_count: usize = 0;
                    var check_idx = idx;
                    while (check_idx > 0 and current_json[check_idx - 1] == '\\') {
                        backslash_count += 1;
                        check_idx -= 1;
                    }
                    if (backslash_count % 2 == 0) {
                        return try allocator.dupe(u8, current_json[value_start..idx]);
                    }
                }
                idx += 1;
            }
        }
    }

    return null;
}

/// Extract array bounds from JSON: "key": [ ... ]
/// Returns slice of content between [ and ]
pub fn getArrayContent(_: std.mem.Allocator, json: []const u8, key: []const u8) !?[]const u8 {
    var key_search: [256]u8 = undefined;
    const key_pattern = try std.fmt.bufPrint(&key_search, "\"{s}\":", .{key});

    const key_pos = std.mem.indexOf(u8, json, key_pattern) orelse return null;
    var idx = key_pos + key_pattern.len;

    // Skip whitespace and find [
    while (idx < json.len and (json[idx] == ' ' or json[idx] == '\t' or json[idx] == '\n' or json[idx] == '\r')) {
        idx += 1;
    }

    if (idx >= json.len or json[idx] != '[') {
        return null;
    }

    idx += 1; // Skip [
    const arr_start = idx;
    var bracket_count: i32 = 1;

    while (idx < json.len and bracket_count > 0) {
        if (json[idx] == '[') bracket_count += 1;
        if (json[idx] == ']') bracket_count -= 1;
        idx += 1;
    }

    if (bracket_count != 0) return null;
    return json[arr_start .. idx - 1];
}

/// Extract the next JSON object from array content
/// Advances idx to start after the closing }
pub fn getNextArrayObject(content: []const u8, start_idx: usize) ?struct { object: []const u8, next_idx: usize } {
    var idx = start_idx;

    // Skip whitespace and commas
    while (idx < content.len and (content[idx] == ' ' or content[idx] == '\t' or content[idx] == '\n' or content[idx] == '\r' or content[idx] == ',')) {
        idx += 1;
    }

    if (idx >= content.len or content[idx] != '{') {
        return null;
    }

    const obj_start = idx;
    var brace_count: i32 = 1;
    idx += 1;

    while (idx < content.len and brace_count > 0) {
        if (content[idx] == '{') brace_count += 1;
        if (content[idx] == '}') brace_count -= 1;
        idx += 1;
    }

    if (brace_count != 0) return null;

    return .{
        .object = content[obj_start..idx],
        .next_idx = idx,
    };
}

/// Extract JSON body from HTTP request
pub fn extractBody(request: []const u8) ![]const u8 {
    std.debug.print("[HTTP] Request length: {}\n", .{request.len});
    std.debug.print("[HTTP] Request start: {s}\n", .{request[0..@min(request.len, 200)]});

    // Find double CRLF or LF
    if (std.mem.indexOf(u8, request, "\r\n\r\n")) |pos| {
        const body = request[pos + 4..];
        std.debug.print("[HTTP] ✓ Found body (CRLF), length: {}\n", .{body.len});
        return body;
    } else if (std.mem.indexOf(u8, request, "\n\n")) |pos| {
        const body = request[pos + 2..];
        std.debug.print("[HTTP] ✓ Found body (LF), length: {}\n", .{body.len});
        return body;
    }

    std.debug.print("[HTTP] ERROR: Body separator not found\n", .{});
    return error.NoBodyFound;
}
