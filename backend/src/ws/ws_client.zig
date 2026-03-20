const std = @import("std");
const types = @import("types.zig");

const Allocator = std.mem.Allocator;
const WsEvent = types.WsEvent;
const WsEventHandler = types.WsEventHandler;
const WsConfig = types.WsConfig;
const WsState = types.WsState;
const WsFrameType = types.WsFrameType;

/// Base64 encoding for WebSocket key
fn base64Encode(allocator: Allocator, data: []const u8) ![]u8 {
    const Encoder = std.base64.standard.Encoder;
    const encoded = try allocator.alloc(u8, Encoder.calcSize(data.len));
    _ = Encoder.encode(encoded, data);
    return encoded;
}

/// Parse URL into host, port, and path
pub const ParsedUrl = struct {
    host: []const u8,
    port: u16,
    path: []const u8,
    secure: bool, // wss vs ws

    pub fn deinit(self: *ParsedUrl, allocator: Allocator) void {
        allocator.free(self.host);
        allocator.free(self.path);
    }
};

pub fn parseUrl(allocator: Allocator, url: []const u8) !ParsedUrl {
    var result = ParsedUrl{
        .host = "",
        .port = 80,
        .path = "/",
        .secure = false,
    };

    // Check for wss:// or ws://
    var offset: usize = 0;
    if (std.mem.startsWith(u8, url, "wss://")) {
        result.secure = true;
        result.port = 443;
        offset = 6;
    } else if (std.mem.startsWith(u8, url, "ws://")) {
        result.secure = false;
        result.port = 80;
        offset = 5;
    } else {
        return error.InvalidUrl;
    }

    const remainder = url[offset..];

    // Find path separator
    const path_idx = std.mem.indexOf(u8, remainder, "/") orelse remainder.len;
    const host_port = remainder[0..path_idx];
    result.path = try allocator.dupe(u8, if (path_idx < remainder.len) remainder[path_idx..] else "/");

    // Parse host and port
    const colon_idx = std.mem.indexOf(u8, host_port, ":");
    if (colon_idx) |idx| {
        result.host = try allocator.dupe(u8, host_port[0..idx]);
        const port_str = host_port[idx + 1 ..];
        result.port = try std.fmt.parseInt(u16, port_str, 10);
    } else {
        result.host = try allocator.dupe(u8, host_port);
    }

    return result;
}

/// WebSocket client
pub const WsClient = struct {
    allocator: Allocator,
    config: WsConfig,
    state: WsState = .disconnected,
    stream: ?std.net.Stream = null,
    event_handler: ?WsEventHandler = null,
    reconnect_count: u32 = 0,
    last_ping: i64 = 0,

    pub fn init(allocator: Allocator, config: WsConfig) WsClient {
        return WsClient{
            .allocator = allocator,
            .config = config,
        };
    }

    pub fn deinit(self: *WsClient) void {
        if (self.stream) |stream| {
            stream.close();
        }
    }

    /// Set event handler callback
    pub fn onEvent(self: *WsClient, handler: WsEventHandler) void {
        self.event_handler = handler;
    }

    /// Connect to WebSocket server (placeholder - full implementation in Phase 2+)
    pub fn connect(self: *WsClient) !void {
        self.state = .connecting;

        var parsed = try parseUrl(self.allocator, self.config.url);
        defer parsed.deinit(self.allocator);

        // TODO: Implement actual network connection using Zig std library
        // For Phase 1, we establish the infrastructure and types
        // Full implementation will be done in Phase 2 (LCX orderbook)

        std.debug.print("[WS] Placeholder connection to {s}\n", .{parsed.host});

        // For now, just simulate connection for testing
        self.state = .connected;
        self.reconnect_count = 0;

        if (self.event_handler) |handler| {
            try handler(self.allocator, WsEvent{ .opened = {} });
        }
    }

    /// WebSocket handshake (client side)
    fn handshake(self: *WsClient, host: []const u8, path: []const u8) !void {
        if (self.stream == null) return error.NotConnected;

        // Generate random key
        var key_bytes: [16]u8 = undefined;
        @memset(&key_bytes, 0);
        var i: u32 = 0;
        while (i < 16) : (i += 1) {
            key_bytes[i] = @as(u8, @truncate(i +% 0x42));
        }

        const key = try base64Encode(self.allocator, &key_bytes);
        defer self.allocator.free(key);

        // Build handshake request
        var request = std.ArrayList(u8).init(self.allocator);
        defer request.deinit();

        try request.writer().print("GET {s} HTTP/1.1\r\n", .{path});
        try request.writer().print("Host: {s}\r\n", .{host});
        try request.writer().writeAll("Upgrade: websocket\r\n");
        try request.writer().writeAll("Connection: Upgrade\r\n");
        try request.writer().print("Sec-WebSocket-Key: {s}\r\n", .{key});
        try request.writer().writeAll("Sec-WebSocket-Version: 13\r\n");
        try request.writer().writeAll("\r\n");

        // Send request
        _ = try self.stream.?.writeAll(request.items);

        // Read response (simplified - just check for 101)
        var response_buf: [4096]u8 = undefined;
        const bytes_read = try self.stream.?.read(&response_buf);

        if (bytes_read == 0) return error.ConnectionClosed;

        const response = response_buf[0..bytes_read];
        if (!std.mem.containsAtLeast(u8, response, 1, "101")) {
            return error.HandshakeFailed;
        }
    }

    /// Send a text message
    pub fn send(self: *WsClient, message: []const u8) !void {
        if (self.state != .connected or self.stream == null) {
            return error.NotConnected;
        }

        var frame = std.ArrayList(u8).init(self.allocator);
        defer frame.deinit();

        // FIN + opcode (text = 0x1)
        try frame.append(0x81); // 10000001

        const len = message.len;
        if (len < 126) {
            // Payload length in 7 bits
            try frame.append(@as(u8, @intCast(len)));
        } else if (len < 65536) {
            try frame.append(126);
            try frame.append(@as(u8, @intCast((len >> 8) & 0xFF)));
            try frame.append(@as(u8, @intCast(len & 0xFF)));
        } else {
            try frame.append(127);
            var j: u32 = 56;
            while (j > 0) : (j -= 8) {
                try frame.append(@as(u8, @intCast((len >> j) & 0xFF)));
            }
            try frame.append(@as(u8, @intCast(len & 0xFF)));
        }

        try frame.appendSlice(message);
        _ = try self.stream.?.writeAll(frame.items);
    }

    /// Send ping frame
    pub fn ping(self: *WsClient) !void {
        if (self.state != .connected or self.stream == null) {
            return error.NotConnected;
        }

        // Ping frame: 0x89 (FIN + ping opcode), no payload
        _ = try self.stream.?.writeAll(&[_]u8{ 0x89, 0x00 });
        self.last_ping = std.time.milliTimestamp();
    }

    /// Read and process incoming messages (blocking)
    pub fn readMessage(self: *WsClient) !void {
        if (self.state != .connected or self.stream == null) {
            return error.NotConnected;
        }

        var header_buf: [2]u8 = undefined;
        const bytes_read = try self.stream.?.read(&header_buf);

        if (bytes_read < 2) {
            self.state = .closed;
            return error.IncompleteFrame;
        }

        const fin = (header_buf[0] & 0x80) != 0;
        const opcode_byte = header_buf[0] & 0x0F;
        const masked = (header_buf[1] & 0x80) != 0;
        var payload_len: u64 = @intCast(header_buf[1] & 0x7F);

        // Convert opcode byte to enum
        const opcode: WsFrameType = switch (opcode_byte) {
            0x0 => .continuation,
            0x1 => .text,
            0x2 => .binary,
            0x8 => .close,
            0x9 => .ping,
            0xA => .pong,
            else => return error.InvalidOpcode,
        };

        // Read extended payload length
        if (payload_len == 126) {
            var len_buf: [2]u8 = undefined;
            const len_read = try self.stream.?.read(&len_buf);
            if (len_read < 2) return error.IncompleteFrame;
            payload_len = (@as(u64, len_buf[0]) << 8) | @as(u64, len_buf[1]);
        } else if (payload_len == 127) {
            var len_buf: [8]u8 = undefined;
            const len_read = try self.stream.?.read(&len_buf);
            if (len_read < 8) return error.IncompleteFrame;
            var idx: u32 = 0;
            while (idx < 8) : (idx += 1) {
                payload_len = (payload_len << 8) | @as(u64, len_buf[idx]);
            }
        }

        // Read masking key if present
        var mask_key: [4]u8 = undefined;
        if (masked) {
            const mask_read = try self.stream.?.read(&mask_key);
            if (mask_read < 4) return error.IncompleteFrame;
        }

        // Read payload
        const payload = try self.allocator.alloc(u8, payload_len);
        var total_read: u64 = 0;
        while (total_read < payload_len) {
            const read = try self.stream.?.read(payload[total_read..]);
            if (read == 0) {
                self.allocator.free(payload);
                return error.IncompleteFrame;
            }
            total_read += read;
        }

        // Unmask payload if needed
        if (masked) {
            var idx: u64 = 0;
            while (idx < payload_len) : (idx += 1) {
                payload[idx] ^= mask_key[idx % 4];
            }
        }

        // Handle frame based on opcode
        switch (opcode) {
            .text => {
                if (fin and self.event_handler) |handler| {
                    try handler(self.allocator, WsEvent{
                        .message = .{ .text = payload },
                    });
                } else {
                    self.allocator.free(payload);
                }
            },
            .ping => {
                // Respond with pong
                try self.pong();
                self.allocator.free(payload);
            },
            .pong => {
                self.allocator.free(payload);
            },
            .close => {
                self.state = .closed;
                if (self.event_handler) |handler| {
                    const code = if (payload_len >= 2)
                        (@as(u16, payload[0]) << 8) | @as(u16, payload[1])
                    else
                        1000;
                    try handler(self.allocator, WsEvent{ .closed = code });
                }
                self.allocator.free(payload);
            },
            else => {
                self.allocator.free(payload);
            },
        }
    }

    /// Send pong frame
    fn pong(self: *WsClient) !void {
        if (self.state != .connected or self.stream == null) {
            return error.NotConnected;
        }

        // Pong frame: 0x8A (FIN + pong opcode), no payload
        _ = try self.stream.?.writeAll(&[_]u8{ 0x8A, 0x00 });
    }

    /// Reconnect with exponential backoff
    pub fn reconnect(self: *WsClient) !void {
        if (self.stream) |stream| {
            stream.close();
        }

        self.reconnect_count += 1;
        if (self.reconnect_count > self.config.max_reconnect_attempts) {
            self.state = .disconnected;
            return error.MaxReconnectAttemptsExceeded;
        }

        var backoff: u64 = self.config.reconnect_backoff_ms;
        var i: u32 = 1;
        while (i < self.reconnect_count) : (i += 1) {
            backoff *= 2;
        }

        std.debug.print("[WS] Reconnecting in {d}ms (attempt {d}/{d})...\n", .{
            backoff,
            self.reconnect_count,
            self.config.max_reconnect_attempts,
        });

        std.time.sleep(backoff * std.time.ns_per_ms);
        try self.connect();
    }

    /// Close connection gracefully
    pub fn close(self: *WsClient) !void {
        if (self.state == .connected and self.stream != null) {
            // Send close frame: 0x88 (FIN + close opcode)
            _ = try self.stream.?.writeAll(&[_]u8{ 0x88, 0x00 });
            self.state = .closing;
        }

        if (self.stream) |stream| {
            stream.close();
        }

        self.state = .closed;
    }

    /// Get current state
    pub fn getState(self: *const WsClient) WsState {
        return self.state;
    }
};
