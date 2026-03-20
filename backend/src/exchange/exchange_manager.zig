/// Unified Exchange Manager interface (CCXT pattern)
/// All exchanges must implement these functions.
const std = @import("std");
const types = @import("types.zig");

// ============================================================================
// Exchange Interface (vtable pattern)
// ============================================================================

pub const ExchangeInterface = struct {
    // Market Data
    fetchMarkets: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) anyerror![]types.Market,
    fetchTicker: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8) anyerror!types.Ticker,
    fetchTickers: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbols: ?[]const []const u8) anyerror![]types.Ticker,
    fetchOHLCV: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, timeframe: []const u8, since: ?i64, limit: ?i64) anyerror!types.OHLCVArray,
    fetchOrderBook: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, limit: ?i64) anyerror!types.OrderBook,
    fetchTrades: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, since: ?i64, limit: ?i64) anyerror!types.TradeArray,

    // Account
    fetchBalance: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) anyerror!types.BalanceMap,

    // Trading
    createOrder: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, order_type: []const u8, side: []const u8, amount: f64, price: ?f64) anyerror!types.Order,
    cancelOrder: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, id: []const u8, symbol: []const u8) anyerror!types.Order,
    fetchOpenOrders: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8) anyerror!types.OrderArray,
    fetchClosedOrders: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) anyerror!types.OrderArray,
    fetchMyTrades: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) anyerror!types.TradeArray,

    // Testing
    testConnection: *const fn (allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) anyerror!types.TestResult,
};

// ============================================================================
// Exchange Manager (dispatcher)
// ============================================================================

pub const ExchangeManager = struct {
    exchange_name: []const u8,
    interface: ExchangeInterface,

    pub fn init(allocator: std.mem.Allocator, exchange_name: []const u8) !ExchangeManager {
        const iface = getExchangeInterface(exchange_name) orelse {
            return error.UnknownExchange;
        };
        return ExchangeManager{
            .exchange_name = exchange_name,
            .interface = iface,
        };
    }
};

// ============================================================================
// Factory functions
// ============================================================================

pub fn getExchangeInterface(exchange_name: []const u8) ?ExchangeInterface {
    if (std.mem.eql(u8, exchange_name, "lcx")) {
        return buildLcxInterface();
    }
    if (std.mem.eql(u8, exchange_name, "kraken")) {
        return buildKrakenInterface();
    }
    if (std.mem.eql(u8, exchange_name, "coinbase")) {
        return buildCoinbaseInterface();
    }
    return null;
}

// Placeholder implementations - will be filled in
fn buildLcxInterface() ExchangeInterface {
    return ExchangeInterface{
        .fetchMarkets = lcxFetchMarkets,
        .fetchTicker = lcxFetchTicker,
        .fetchTickers = lcxFetchTickers,
        .fetchOHLCV = lcxFetchOHLCV,
        .fetchOrderBook = lcxFetchOrderBook,
        .fetchTrades = lcxFetchTrades,
        .fetchBalance = lcxFetchBalance,
        .createOrder = lcxCreateOrder,
        .cancelOrder = lcxCancelOrder,
        .fetchOpenOrders = lcxFetchOpenOrders,
        .fetchClosedOrders = lcxFetchClosedOrders,
        .fetchMyTrades = lcxFetchMyTrades,
        .testConnection = lcxTestConnection,
    };
}

fn buildKrakenInterface() ExchangeInterface {
    return ExchangeInterface{
        .fetchMarkets = krakenFetchMarkets,
        .fetchTicker = krakenFetchTicker,
        .fetchTickers = krakenFetchTickers,
        .fetchOHLCV = krakenFetchOHLCV,
        .fetchOrderBook = krakenFetchOrderBook,
        .fetchTrades = krakenFetchTrades,
        .fetchBalance = krakenFetchBalance,
        .createOrder = krakenCreateOrder,
        .cancelOrder = krakenCancelOrder,
        .fetchOpenOrders = krakenFetchOpenOrders,
        .fetchClosedOrders = krakenFetchClosedOrders,
        .fetchMyTrades = krakenFetchMyTrades,
        .testConnection = krakenTestConnection,
    };
}

fn buildCoinbaseInterface() ExchangeInterface {
    return ExchangeInterface{
        .fetchMarkets = coinbaseFetchMarkets,
        .fetchTicker = coinbaseFetchTicker,
        .fetchTickers = coinbaseFetchTickers,
        .fetchOHLCV = coinbaseFetchOHLCV,
        .fetchOrderBook = coinbaseFetchOrderBook,
        .fetchTrades = coinbaseFetchTrades,
        .fetchBalance = coinbaseFetchBalance,
        .createOrder = coinbaseCreateOrder,
        .cancelOrder = coinbaseCancelOrder,
        .fetchOpenOrders = coinbaseFetchOpenOrders,
        .fetchClosedOrders = coinbaseFetchClosedOrders,
        .fetchMyTrades = coinbaseFetchMyTrades,
        .testConnection = coinbaseTestConnection,
    };
}

// ============================================================================
// LCX Functions (dispatch to lcx.zig)
// ============================================================================

fn lcxFetchMarkets(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) ![]types.Market {
    const lcx = @import("lcx.zig");
    return lcx.fetchMarkets(allocator, api_key, api_secret);
}

fn lcxFetchTicker(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8) !types.Ticker {
    const lcx = @import("lcx.zig");
    return lcx.fetchTicker(allocator, api_key, api_secret, symbol);
}

fn lcxFetchTickers(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbols: ?[]const []const u8) ![]types.Ticker {
    const lcx = @import("lcx.zig");
    return lcx.fetchTickers(allocator, api_key, api_secret, symbols);
}

fn lcxFetchOHLCV(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, timeframe: []const u8, since: ?i64, limit: ?i64) !types.OHLCVArray {
    const lcx = @import("lcx.zig");
    return lcx.fetchOHLCV(allocator, api_key, api_secret, symbol, timeframe, since, limit);
}

fn lcxFetchOrderBook(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, limit: ?i64) !types.OrderBook {
    const lcx = @import("lcx.zig");
    return lcx.fetchOrderBook(allocator, api_key, api_secret, symbol, limit);
}

fn lcxFetchTrades(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, since: ?i64, limit: ?i64) !types.TradeArray {
    const lcx = @import("lcx.zig");
    return lcx.fetchTrades(allocator, api_key, api_secret, symbol, since, limit);
}

fn lcxFetchBalance(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) !types.BalanceMap {
    const lcx = @import("lcx.zig");
    return lcx.fetchBalance(allocator, api_key, api_secret);
}

fn lcxCreateOrder(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, order_type: []const u8, side: []const u8, amount: f64, price: ?f64) !types.Order {
    const lcx = @import("lcx.zig");
    return lcx.createOrder(allocator, api_key, api_secret, symbol, order_type, side, amount, price);
}

fn lcxCancelOrder(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, id: []const u8, symbol: []const u8) !types.Order {
    const lcx = @import("lcx.zig");
    return lcx.cancelOrder(allocator, api_key, api_secret, id, symbol);
}

fn lcxFetchOpenOrders(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8) !types.OrderArray {
    const lcx = @import("lcx.zig");
    return lcx.fetchOpenOrders(allocator, api_key, api_secret, symbol);
}

fn lcxFetchClosedOrders(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) !types.OrderArray {
    const lcx = @import("lcx.zig");
    return lcx.fetchClosedOrders(allocator, api_key, api_secret, symbol, since, limit);
}

fn lcxFetchMyTrades(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) !types.TradeArray {
    const lcx = @import("lcx.zig");
    return lcx.fetchMyTrades(allocator, api_key, api_secret, symbol, since, limit);
}

fn lcxTestConnection(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) !types.TestResult {
    const lcx = @import("lcx.zig");
    return lcx.testConnection(allocator, api_key, api_secret);
}

// ============================================================================
// Kraken Functions (dispatch to kraken.zig)
// ============================================================================

fn krakenFetchMarkets(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) ![]types.Market {
    const kraken = @import("kraken.zig");
    return kraken.fetchMarkets(allocator, api_key, api_secret);
}

fn krakenFetchTicker(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8) !types.Ticker {
    const kraken = @import("kraken.zig");
    return kraken.fetchTicker(allocator, api_key, api_secret, symbol);
}

fn krakenFetchTickers(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbols: ?[]const []const u8) ![]types.Ticker {
    const kraken = @import("kraken.zig");
    return kraken.fetchTickers(allocator, api_key, api_secret, symbols);
}

fn krakenFetchOHLCV(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, timeframe: []const u8, since: ?i64, limit: ?i64) !types.OHLCVArray {
    const kraken = @import("kraken.zig");
    return kraken.fetchOHLCV(allocator, api_key, api_secret, symbol, timeframe, since, limit);
}

fn krakenFetchOrderBook(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, limit: ?i64) !types.OrderBook {
    const kraken = @import("kraken.zig");
    return kraken.fetchOrderBook(allocator, api_key, api_secret, symbol, limit);
}

fn krakenFetchTrades(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, since: ?i64, limit: ?i64) !types.TradeArray {
    const kraken = @import("kraken.zig");
    return kraken.fetchTrades(allocator, api_key, api_secret, symbol, since, limit);
}

fn krakenFetchBalance(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) !types.BalanceMap {
    const kraken = @import("kraken.zig");
    return kraken.fetchBalance(allocator, api_key, api_secret);
}

fn krakenCreateOrder(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, order_type: []const u8, side: []const u8, amount: f64, price: ?f64) !types.Order {
    const kraken = @import("kraken.zig");
    return kraken.createOrder(allocator, api_key, api_secret, symbol, order_type, side, amount, price);
}

fn krakenCancelOrder(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, id: []const u8, symbol: []const u8) !types.Order {
    const kraken = @import("kraken.zig");
    return kraken.cancelOrder(allocator, api_key, api_secret, id, symbol);
}

fn krakenFetchOpenOrders(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8) !types.OrderArray {
    const kraken = @import("kraken.zig");
    return kraken.fetchOpenOrders(allocator, api_key, api_secret, symbol);
}

fn krakenFetchClosedOrders(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) !types.OrderArray {
    const kraken = @import("kraken.zig");
    return kraken.fetchClosedOrders(allocator, api_key, api_secret, symbol, since, limit);
}

fn krakenFetchMyTrades(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) !types.TradeArray {
    const kraken = @import("kraken.zig");
    return kraken.fetchMyTrades(allocator, api_key, api_secret, symbol, since, limit);
}

fn krakenTestConnection(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) !types.TestResult {
    const kraken = @import("kraken.zig");
    return kraken.testConnection(allocator, api_key, api_secret);
}

// ============================================================================
// Coinbase Functions (dispatch to coinbase.zig)
// ============================================================================

fn coinbaseFetchMarkets(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) ![]types.Market {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchMarkets(allocator, api_key, api_secret);
}

fn coinbaseFetchTicker(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8) !types.Ticker {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchTicker(allocator, api_key, api_secret, symbol);
}

fn coinbaseFetchTickers(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbols: ?[]const []const u8) ![]types.Ticker {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchTickers(allocator, api_key, api_secret, symbols);
}

fn coinbaseFetchOHLCV(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, timeframe: []const u8, since: ?i64, limit: ?i64) !types.OHLCVArray {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchOHLCV(allocator, api_key, api_secret, symbol, timeframe, since, limit);
}

fn coinbaseFetchOrderBook(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, limit: ?i64) !types.OrderBook {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchOrderBook(allocator, api_key, api_secret, symbol, limit);
}

fn coinbaseFetchTrades(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, since: ?i64, limit: ?i64) !types.TradeArray {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchTrades(allocator, api_key, api_secret, symbol, since, limit);
}

fn coinbaseFetchBalance(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) !types.BalanceMap {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchBalance(allocator, api_key, api_secret);
}

fn coinbaseCreateOrder(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: []const u8, order_type: []const u8, side: []const u8, amount: f64, price: ?f64) !types.Order {
    const coinbase = @import("coinbase.zig");
    return coinbase.createOrder(allocator, api_key, api_secret, symbol, order_type, side, amount, price);
}

fn coinbaseCancelOrder(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, id: []const u8, symbol: []const u8) !types.Order {
    const coinbase = @import("coinbase.zig");
    return coinbase.cancelOrder(allocator, api_key, api_secret, id, symbol);
}

fn coinbaseFetchOpenOrders(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8) !types.OrderArray {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchOpenOrders(allocator, api_key, api_secret, symbol);
}

fn coinbaseFetchClosedOrders(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) !types.OrderArray {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchClosedOrders(allocator, api_key, api_secret, symbol, since, limit);
}

fn coinbaseFetchMyTrades(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8, symbol: ?[]const u8, since: ?i64, limit: ?i64) !types.TradeArray {
    const coinbase = @import("coinbase.zig");
    return coinbase.fetchMyTrades(allocator, api_key, api_secret, symbol, since, limit);
}

fn coinbaseTestConnection(allocator: std.mem.Allocator, api_key: []const u8, api_secret: []const u8) !types.TestResult {
    const coinbase = @import("coinbase.zig");
    return coinbase.testConnection(allocator, api_key, api_secret);
}
