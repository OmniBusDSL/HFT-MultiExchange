const std = @import("std");

/// WebSocket event types
pub const WsEventType = enum {
    opened,
    message,
    closed,
    err,
};

/// Raw WebSocket message
pub const WsMessage = struct {
    text: []const u8, // raw JSON or text message
};

/// WebSocket event union
pub const WsEvent = union(WsEventType) {
    opened: void,
    message: WsMessage,
    closed: u16, // close code
    err: []const u8, // error message
};

/// Event handler callback
pub const WsEventHandler = *const fn (allocator: std.mem.Allocator, event: WsEvent) anyerror!void;

/// WebSocket client configuration
pub const WsConfig = struct {
    url: []const u8,
    connect_timeout_ms: u64 = 5000,
    read_timeout_ms: u64 = 30000,
    ping_interval_ms: u64 = 30000,
    max_reconnect_attempts: u32 = 5,
    reconnect_backoff_ms: u64 = 1000,
};

/// WebSocket connection state
pub const WsState = enum {
    disconnected,
    connecting,
    connected,
    closing,
    closed,
};

/// WebSocket frame type (RFC 6455)
pub const WsFrameType = enum(u4) {
    continuation = 0x0,
    text = 0x1,
    binary = 0x2,
    close = 0x8,
    ping = 0x9,
    pong = 0xA,
};

/// WebSocket frame header
pub const WsFrameHeader = struct {
    fin: bool,
    opcode: WsFrameType,
    masked: bool,
    payload_length: u64,
};

/// WebSocket frame
pub const WsFrame = struct {
    allocator: std.mem.Allocator,
    header: WsFrameHeader,
    payload: []u8,

    pub fn deinit(self: *WsFrame) void {
        self.allocator.free(self.payload);
    }
};
