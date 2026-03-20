const std = @import("std");

/// LCX order status
pub const OrderStatus = enum {
    open,
    partial,
    filled,
    cancelled,
    rejected,
    unknown,
};

/// LCX private order
pub const PrivateOrder = struct {
    allocator: std.mem.Allocator,
    id: []const u8,
    symbol: []const u8, // e.g., "BTC/EUR"
    side: []const u8,   // "buy" or "sell"
    price: f64,
    amount: f64,
    filled_amount: f64 = 0,
    status: OrderStatus,
    created_at: i64,
    updated_at: i64,

    pub fn deinit(self: *PrivateOrder) void {
        self.allocator.free(self.id);
        self.allocator.free(self.symbol);
        self.allocator.free(self.side);
    }

    pub fn clone(self: *const PrivateOrder, allocator: std.mem.Allocator) !PrivateOrder {
        return PrivateOrder{
            .allocator = allocator,
            .id = try allocator.dupe(u8, self.id),
            .symbol = try allocator.dupe(u8, self.symbol),
            .side = try allocator.dupe(u8, self.side),
            .price = self.price,
            .amount = self.amount,
            .filled_amount = self.filled_amount,
            .status = self.status,
            .created_at = self.created_at,
            .updated_at = self.updated_at,
        };
    }
};

/// LCX private orders message type
pub const LcxPrivateMessageType = enum {
    subscribe_response,
    order_create,
    order_update,
    order_cancel,
    ping,
    unknown,
};

/// LCX private order message
pub const LcxPrivateOrderMessage = struct {
    allocator: std.mem.Allocator,
    msg_type: LcxPrivateMessageType,
    orders: ?[]PrivateOrder = null,
    order_count: usize = 0,

    pub fn deinit(self: *LcxPrivateOrderMessage) void {
        if (self.orders) |orders| {
            for (orders[0..self.order_count]) |*order| {
                order.deinit();
            }
            self.allocator.free(orders);
        }
    }
};

/// Local private orders state manager
pub const LocalPrivateOrders = struct {
    allocator: std.mem.Allocator,
    orders: []PrivateOrder,
    order_count: usize = 0,
    last_update: i64 = 0,
    is_subscribed: bool = false,

    pub fn init(allocator: std.mem.Allocator, max_orders: usize) !LocalPrivateOrders {
        return LocalPrivateOrders{
            .allocator = allocator,
            .orders = try allocator.alloc(PrivateOrder, max_orders),
        };
    }

    pub fn deinit(self: *LocalPrivateOrders) void {
        for (self.orders[0..self.order_count]) |*order| {
            order.deinit();
        }
        self.allocator.free(self.orders);
    }

    /// Apply snapshot (from REST /api/open after subscribe)
    pub fn applySnapshot(self: *LocalPrivateOrders, new_orders: []const PrivateOrder) !void {
        // Clear old orders
        for (self.orders[0..self.order_count]) |*order| {
            order.deinit();
        }

        self.order_count = @min(new_orders.len, self.orders.len);
        for (new_orders[0..self.order_count], 0..) |order, idx| {
            self.orders[idx] = try order.clone(self.allocator);
        }

        self.last_update = std.time.milliTimestamp();
    }

    /// Apply single order update from WebSocket
    pub fn applyOrderUpdate(self: *LocalPrivateOrders, order: PrivateOrder) !void {
        // Find existing order
        for (self.orders[0..self.order_count], 0..) |*existing, idx| {
            if (std.mem.eql(u8, existing.id, order.id)) {
                // Update existing order
                existing.deinit();
                self.orders[idx] = try order.clone(self.allocator);
                self.last_update = std.time.milliTimestamp();
                return;
            }
        }

        // Add new order if not found
        if (self.order_count < self.orders.len) {
            self.orders[self.order_count] = try order.clone(self.allocator);
            self.order_count += 1;
            self.last_update = std.time.milliTimestamp();
        }
    }

    /// Get open orders (status = open or partial)
    pub fn getOpenOrders(self: *const LocalPrivateOrders, allocator: std.mem.Allocator) ![]const PrivateOrder {
        var open_count: usize = 0;
        for (self.orders[0..self.order_count]) |order| {
            if (order.status == .open or order.status == .partial) {
                open_count += 1;
            }
        }

        const result = try allocator.alloc(PrivateOrder, open_count);
        var idx: usize = 0;
        for (self.orders[0..self.order_count]) |order| {
            if (order.status == .open or order.status == .partial) {
                result[idx] = order;
                idx += 1;
            }
        }

        return result;
    }

    /// Get closed orders (status = filled or cancelled)
    pub fn getClosedOrders(self: *const LocalPrivateOrders, allocator: std.mem.Allocator) ![]const PrivateOrder {
        var closed_count: usize = 0;
        for (self.orders[0..self.order_count]) |order| {
            if (order.status == .filled or order.status == .cancelled) {
                closed_count += 1;
            }
        }

        const result = try allocator.alloc(PrivateOrder, closed_count);
        var idx: usize = 0;
        for (self.orders[0..self.order_count]) |order| {
            if (order.status == .filled or order.status == .cancelled) {
                result[idx] = order;
                idx += 1;
            }
        }

        return result;
    }

    /// Get order by ID
    pub fn getOrderById(self: *const LocalPrivateOrders, order_id: []const u8) ?*const PrivateOrder {
        for (self.orders[0..self.order_count]) |*order| {
            if (std.mem.eql(u8, order.id, order_id)) {
                return order;
            }
        }
        return null;
    }
};
