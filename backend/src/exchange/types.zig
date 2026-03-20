const std = @import("std");

pub const TestResult = struct {
    success: bool,
    message: []u8,

    pub fn deinit(self: *TestResult, allocator: std.mem.Allocator) void {
        allocator.free(self.message);
    }

    pub fn ok(allocator: std.mem.Allocator, msg: []const u8) !TestResult {
        return TestResult{
            .success = true,
            .message = try allocator.dupe(u8, msg),
        };
    }

    pub fn fail(allocator: std.mem.Allocator, msg: []const u8) !TestResult {
        return TestResult{
            .success = false,
            .message = try allocator.dupe(u8, msg),
        };
    }

    pub fn failFmt(allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !TestResult {
        return TestResult{
            .success = false,
            .message = try std.fmt.allocPrint(allocator, fmt, args),
        };
    }
};

// ============================================================================
// Market Data Types
// ============================================================================

pub const Market = struct {
    id: []const u8,           // Exchange-specific symbol (e.g., "BTCUSD")
    symbol: []const u8,       // Unified symbol (e.g., "BTC/USD")
    base: []const u8,         // Base asset (e.g., "BTC")
    quote: []const u8,        // Quote asset (e.g., "USD")
    baseId: []const u8,       // Exchange-specific base ID
    quoteId: []const u8,      // Exchange-specific quote ID
    active: bool,
    maker: f64,               // Maker fee
    taker: f64,               // Taker fee
    limits: Limits,
    info: []const u8,         // Raw JSON from exchange

    pub fn deinit(self: *Market, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        allocator.free(self.symbol);
        allocator.free(self.base);
        allocator.free(self.quote);
        allocator.free(self.baseId);
        allocator.free(self.quoteId);
        allocator.free(self.info);
    }
};

pub const Limits = struct {
    amount: MinMax,
    price: MinMax,
    cost: MinMax,
};

pub const MinMax = struct {
    min: f64,
    max: f64,
};

pub const Ticker = struct {
    symbol: []const u8,
    timestamp: i64,
    datetime: []const u8,     // ISO 8601
    high: f64,
    low: f64,
    bid: f64,
    bidVolume: f64,
    ask: f64,
    askVolume: f64,
    vwap: f64,               // Volume-weighted avg price
    open: f64,
    close: f64,
    last: f64,
    previousClose: f64,
    change: f64,             // price change
    percentage: f64,         // percentage change
    average: f64,
    baseVolume: f64,
    quoteVolume: f64,
    info: []const u8,

    pub fn deinit(self: *Ticker, allocator: std.mem.Allocator) void {
        allocator.free(self.symbol);
        allocator.free(self.datetime);
        allocator.free(self.info);
    }
};

pub const OHLCV = struct {
    timestamp: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
};

pub const OHLCVArray = struct {
    data: []OHLCV,

    pub fn deinit(self: *OHLCVArray, allocator: std.mem.Allocator) void {
        allocator.free(self.data);
    }
};

pub const PriceLevel = struct {
    price: f64,
    amount: f64,
};

pub const OrderBook = struct {
    symbol: []const u8,
    bids: []PriceLevel,       // [price, amount]
    asks: []PriceLevel,
    timestamp: i64,
    datetime: []const u8,
    nonce: i64,

    pub fn deinit(self: *OrderBook, allocator: std.mem.Allocator) void {
        allocator.free(self.symbol);
        allocator.free(self.bids);
        allocator.free(self.asks);
        allocator.free(self.datetime);
    }
};

pub const Trade = struct {
    id: []const u8,
    timestamp: i64,
    datetime: []const u8,
    symbol: []const u8,
    type: []const u8,         // "limit" or "market"
    side: []const u8,         // "buy" or "sell"
    price: f64,
    amount: f64,
    cost: f64,               // price * amount
    fee: ?f64,
    info: []const u8,

    pub fn deinit(self: *Trade, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        allocator.free(self.datetime);
        allocator.free(self.symbol);
        allocator.free(self.type);
        allocator.free(self.side);
        allocator.free(self.info);
    }
};

pub const TradeArray = struct {
    data: []Trade,

    pub fn deinit(self: *TradeArray, allocator: std.mem.Allocator) void {
        for (self.data) |*trade| {
            trade.deinit(allocator);
        }
        allocator.free(self.data);
    }
};

// ============================================================================
// Account Types
// ============================================================================

pub const Balance = struct {
    currency: []const u8,
    free: f64,               // Available balance
    used: f64,               // Locked in orders
    total: f64,              // free + used
    info: []const u8,        // Raw exchange response

    pub fn deinit(self: *Balance, allocator: std.mem.Allocator) void {
        allocator.free(self.currency);
        allocator.free(self.info);
    }
};

pub const BalanceMap = struct {
    balances: []Balance,
    free: ?f64,              // Total free balance in quote currency
    used: ?f64,              // Total used balance in quote currency
    total: ?f64,             // Total balance in quote currency

    pub fn deinit(self: *BalanceMap, allocator: std.mem.Allocator) void {
        for (self.balances) |*bal| {
            bal.deinit(allocator);
        }
        allocator.free(self.balances);
    }
};

pub const Order = struct {
    id: []const u8,
    clientOrderId: ?[]const u8,
    timestamp: i64,
    datetime: []const u8,
    lastTradeTimestamp: ?i64,
    lastUpdateTimestamp: ?i64,
    symbol: []const u8,
    type: []const u8,       // "limit", "market", etc.
    side: []const u8,       // "buy" or "sell"
    price: f64,
    amount: f64,
    cost: f64,
    average: f64,           // Average execution price
    filled: f64,            // Amount filled so far
    remaining: f64,         // Amount not yet filled
    status: []const u8,     // "open", "closed", "canceled"
    fee: ?f64,
    trades: []Trade,
    info: []const u8,

    pub fn deinit(self: *Order, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        if (self.clientOrderId) |id| allocator.free(id);
        allocator.free(self.datetime);
        allocator.free(self.symbol);
        allocator.free(self.type);
        allocator.free(self.side);
        allocator.free(self.status);
        for (self.trades) |*trade| {
            trade.deinit(allocator);
        }
        allocator.free(self.trades);
        allocator.free(self.info);
    }
};

pub const OrderArray = struct {
    data: []Order,

    pub fn deinit(self: *OrderArray, allocator: std.mem.Allocator) void {
        for (self.data) |*order| {
            order.deinit(allocator);
        }
        allocator.free(self.data);
    }
};
