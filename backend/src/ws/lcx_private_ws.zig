const std = @import("std");
const lcx_private_types = @import("lcx_private_types.zig");

const Allocator = std.mem.Allocator;
const PrivateOrder = lcx_private_types.PrivateOrder;
const OrderStatus = lcx_private_types.OrderStatus;
const LocalPrivateOrders = lcx_private_types.LocalPrivateOrders;
const LcxPrivateOrderMessage = lcx_private_types.LcxPrivateOrderMessage;

/// LCX private orders WebSocket handler
pub const LcxPrivateWs = struct {
    allocator: Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    orders: LocalPrivateOrders,
    last_ping: i64 = 0,
    ping_interval_ms: i64 = 55000, // LCX uses 55 second ping interval for private WS
    on_subscribed: ?*const fn (allocator: Allocator) anyerror!void = null,
    on_order_update: ?*const fn (allocator: Allocator, order: *const PrivateOrder) anyerror!void = null,

    pub fn init(allocator: Allocator, api_key: []const u8, api_secret: []const u8, max_orders: usize) !LcxPrivateWs {
        return LcxPrivateWs{
            .allocator = allocator,
            .api_key = try allocator.dupe(u8, api_key),
            .api_secret = try allocator.dupe(u8, api_secret),
            .orders = try LocalPrivateOrders.init(allocator, max_orders),
        };
    }

    pub fn deinit(self: *LcxPrivateWs) void {
        self.allocator.free(self.api_key);
        self.allocator.free(self.api_secret);
        self.orders.deinit();
    }

    /// Build WebSocket URL with authentication
    /// Format: wss://exchange-api.lcx.com/api/auth/ws?x-access-key=KEY&x-access-sign=SIG&x-access-timestamp=TS
    pub fn buildAuthUrl(self: *const LcxPrivateWs, allocator: Allocator) ![]const u8 {
        // Get current timestamp
        const timestamp = std.time.milliTimestamp();
        const timestamp_str = try std.fmt.allocPrint(allocator, "{d}", .{timestamp});
        defer allocator.free(timestamp_str);

        // Build message for signing: GET/api/auth/ws{}
        const message = "GET/api/auth/ws{}";

        // Compute HMAC-SHA256 signature
        var mac: [32]u8 = undefined;
        std.crypto.auth.hmac.sha2.HmacSha256.create(&mac, message, self.api_secret);

        // Base64 encode signature
        const Encoder = std.base64.standard.Encoder;
        const signature_b64 = try allocator.alloc(u8, Encoder.calcSize(32));
        _ = Encoder.encode(signature_b64, &mac);

        // Build URL
        const url = try std.fmt.allocPrint(
            allocator,
            "wss://exchange-api.lcx.com/api/auth/ws?x-access-key={s}&x-access-sign={s}&x-access-timestamp={s}",
            .{ self.api_key, signature_b64, timestamp_str },
        );

        allocator.free(signature_b64);
        return url;
    }

    /// Build subscription message for user orders
    pub fn buildSubscribeMessage(allocator: Allocator) ![]const u8 {
        const buf = try std.fmt.allocPrint(
            allocator,
            "{{\"Topic\":\"subscribe\",\"Type\":\"user_orders\"}}",
            .{},
        );
        return buf;
    }

    /// Parse order from JSON (simplified)
    pub fn parseOrderMessage(allocator: Allocator, json_str: []const u8) ?PrivateOrder {
        // Extract fields from JSON
        // This is a simplified parser - production would use proper JSON library

        const order = PrivateOrder{
            .allocator = allocator,
            .id = allocator.dupe(u8, "unknown") catch return null,
            .symbol = allocator.dupe(u8, "UNKNOWN/UNKNOWN") catch return null,
            .side = allocator.dupe(u8, "buy") catch return null,
            .price = 0.0,
            .amount = 0.0,
            .status = .unknown,
            .created_at = std.time.milliTimestamp(),
            .updated_at = std.time.milliTimestamp(),
        };

        // Try to extract order ID
        if (std.mem.indexOf(u8, json_str, "\"Id\"")) |_| {
            // Found Id field - would extract value here
        }

        // Try to extract symbol
        if (std.mem.indexOf(u8, json_str, "\"Pair\"")) |_| {
            // Found Pair field
        }

        return order;
    }

    /// Handle incoming message
    pub fn handleMessage(self: *LcxPrivateWs, json_str: []const u8) !void {
        // Check message type
        if (std.mem.indexOf(u8, json_str, "\"Subscribed Successfully\"")) |_| {
            // Subscription confirmed - need to fetch existing orders via REST
            self.orders.is_subscribed = true;
            if (self.on_subscribed) |callback| {
                try callback(self.allocator);
            }
        } else if (std.mem.indexOf(u8, json_str, "\"type\":\"user_orders\"")) |_| {
            // Order update message
            if (parseOrderMessage(self.allocator, json_str)) |order| {
                try self.orders.applyOrderUpdate(order);
                if (self.on_order_update) |callback| {
                    try callback(self.allocator, &order);
                }
            }
        } else if (std.mem.indexOf(u8, json_str, "\"Topic\":\"ping\"")) |_| {
            // Ping message
            self.last_ping = std.time.milliTimestamp();
        }
    }

    /// Check if ping is needed
    pub fn needsPing(self: *const LcxPrivateWs) bool {
        const now = std.time.milliTimestamp();
        return (now - self.last_ping) > self.ping_interval_ms;
    }

    /// Get open orders
    pub fn getOpenOrders(self: *const LcxPrivateWs, allocator: Allocator) ![]const PrivateOrder {
        return try self.orders.getOpenOrders(allocator);
    }

    /// Get closed orders
    pub fn getClosedOrders(self: *const LcxPrivateWs, allocator: Allocator) ![]const PrivateOrder {
        return try self.orders.getClosedOrders(allocator);
    }
};
