/// Exchange factory — dispatch test by exchange name.
const std = @import("std");
const types = @import("types.zig");
const symbol_utils = @import("../utils/symbols.zig");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💱 EXCHANGES — Centralized Trading Venues
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const lcx = @import("lcx.zig");
const kraken = @import("kraken.zig");
const coinbase = @import("coinbase.zig");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📈 MARKET DATA — Price & Analytics Providers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const coingecko = @import("coingecko.zig");
const coinmarketcap = @import("coinmarketcap.zig");
const cryptocompare = @import("cryptocompare.zig");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⛓️ WEB3 — Blockchain & Smart Contracts (Future)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// const infura = @import("infura.zig");
// const alchemy = @import("alchemy.zig");
// const etherscan = @import("etherscan.zig");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🤖 AI & LLM — Language Models (Future)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// const openai = @import("openai.zig");
// const claude = @import("claude.zig");
// const gemini = @import("gemini.zig");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📱 SOCIAL MEDIA — Community & Broadcasting (Future)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// const x_twitter = @import("x_twitter.zig");
// const facebook = @import("facebook.zig");
// const instagram = @import("instagram.zig");

/// List of supported exchanges for dynamic routing
pub const SUPPORTED_EXCHANGES = [_][]const u8{ "lcx", "kraken", "coinbase" };

/// Check if exchange name is valid
pub fn isValidExchange(name: []const u8) bool {
    for (SUPPORTED_EXCHANGES) |exchange| {
        if (std.mem.eql(u8, exchange, name)) return true;
    }
    return false;
}

pub const TestFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) anyerror!types.TestResult;

pub const BalanceFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) anyerror!types.BalanceMap;

pub const MarketsFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
) anyerror![]types.Market;

pub const TickerFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
) anyerror!types.Ticker;

pub const TickersFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbols: ?[]const []const u8,
) anyerror![]types.Ticker;

pub const OrderBookFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    limit: ?i64,
) anyerror!types.OrderBook;

pub const OHLCVFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    timeframe: []const u8,
    since: ?i64,
    limit: ?i64,
) anyerror!types.OHLCVArray;

pub fn getTestFn(exchange_name: []const u8) ?TestFn {
    // 💱 EXCHANGES
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.testConnection;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.testConnection;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.testConnection;

    // 📈 MARKET DATA
    if (std.mem.eql(u8, exchange_name, "coingecko")) return coingecko.testConnection;
    if (std.mem.eql(u8, exchange_name, "coinmarketcap")) return coinmarketcap.testConnection;
    if (std.mem.eql(u8, exchange_name, "cryptocompare")) return cryptocompare.testConnection;

    // ⛓️ WEB3, 🤖 AI, 📱 SOCIAL — Future implementations

    return null;
}

pub fn getBalanceFn(exchange_name: []const u8) ?BalanceFn {
    // 💱 EXCHANGES only (Market Data providers don't have balances)
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchBalance;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchBalance;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchBalance;
    return null;
}

pub fn getMarketsFn(exchange_name: []const u8) ?MarketsFn {
    // 💱 EXCHANGES only (Market Data providers don't have trading pairs)
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchMarkets;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchMarkets;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchMarkets;
    return null;
}

pub fn getTickerFn(exchange_name: []const u8) ?TickerFn {
    // 💱 EXCHANGES only
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchTicker;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchTicker;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchTicker;
    return null;
}

pub fn getTickersFn(exchange_name: []const u8) ?TickersFn {
    // 💱 EXCHANGES only
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchTickers;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchTickers;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchTickers;
    return null;
}

pub fn getOrderBookFn(exchange_name: []const u8) ?OrderBookFn {
    // 💱 EXCHANGES only
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchOrderBook;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchOrderBook;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchOrderBook;
    return null;
}

pub fn getOHLCVFn(exchange_name: []const u8) ?OHLCVFn {
    // 💱 EXCHANGES only
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchOHLCV;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchOHLCV;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchOHLCV;
    return null;
}

/// Run the connection test for the given exchange.
/// Returns an owned TestResult; caller must call deinit.
pub fn testExchange(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
) !types.TestResult {
    const test_fn = getTestFn(exchange_name) orelse {
        return types.TestResult.failFmt(
            allocator,
            "Unknown exchange: {s}",
            .{exchange_name},
        );
    };
    return test_fn(allocator, api_key, api_secret);
}

/// Fetch balance for the given exchange.
/// Returns an owned BalanceMap; caller must call deinit.
pub fn fetchBalance(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
) !types.BalanceMap {
    const balance_fn = getBalanceFn(exchange_name) orelse {
        return types.BalanceMap{
            .balances = try allocator.alloc(types.Balance, 0),
            .free = null,
            .used = null,
            .total = null,
        };
    };
    return balance_fn(allocator, api_key, api_secret);
}

/// Fetch markets for the given exchange.
/// Returns an owned []types.Market; caller must deinit each Market and free the slice.
pub fn fetchMarkets(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
) ![]types.Market {
    const markets_fn = getMarketsFn(exchange_name) orelse {
        return try allocator.alloc(types.Market, 0);
    };
    return markets_fn(allocator, api_key, api_secret);
}

/// Fetch ticker for a specific symbol.
/// Accepts symbols in normalized format (BASE/QUOTE) and converts to exchange format.
/// Returns an owned Ticker; caller must call deinit.
pub fn fetchTicker(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
) !types.Ticker {
    const ticker_fn = getTickerFn(exchange_name) orelse {
        return types.Ticker{
            .symbol = try allocator.dupe(u8, symbol),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .high = 0,
            .low = 0,
            .bid = 0,
            .bidVolume = 0,
            .ask = 0,
            .askVolume = 0,
            .vwap = 0,
            .open = 0,
            .close = 0,
            .last = 0,
            .previousClose = 0,
            .change = 0,
            .percentage = 0,
            .average = 0,
            .baseVolume = 0,
            .quoteVolume = 0,
            .info = try allocator.dupe(u8, ""),
        };
    };

    // Convert to exchange-specific format
    const exchange_symbol = try toExchangeFormat(allocator, exchange_name, symbol);
    defer if (!std.mem.eql(u8, exchange_symbol, symbol)) allocator.free(exchange_symbol);

    var result = try ticker_fn(allocator, api_key, api_secret, exchange_symbol);
    // Return with normalized symbol
    result.symbol = try allocator.dupe(u8, symbol);
    return result;
}

/// Fetch tickers for all or specific symbols.
/// Returns an owned []types.Ticker; caller must deinit each Ticker and free the slice.
pub fn fetchTickers(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbols: ?[]const []const u8,
) ![]types.Ticker {
    const tickers_fn = getTickersFn(exchange_name) orelse {
        return try allocator.alloc(types.Ticker, 0);
    };
    return tickers_fn(allocator, api_key, api_secret, symbols);
}

/// Fetch order book for a specific symbol.
/// Accepts symbols in normalized format (BASE/QUOTE) and converts to exchange format.
/// Returns an owned OrderBook; caller must call deinit.
pub fn fetchOrderBook(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    limit: ?i64,
) !types.OrderBook {
    const orderbook_fn = getOrderBookFn(exchange_name) orelse {
        return types.OrderBook{
            .symbol = try allocator.dupe(u8, symbol),
            .bids = try allocator.alloc(types.PriceLevel, 0),
            .asks = try allocator.alloc(types.PriceLevel, 0),
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .nonce = 0,
        };
    };

    // Convert to exchange-specific format (e.g., BTC/USD → XBTUSD for Kraken)
    const exchange_symbol = try toExchangeFormat(allocator, exchange_name, symbol);
    defer if (!std.mem.eql(u8, exchange_symbol, symbol)) allocator.free(exchange_symbol);

    var result = try orderbook_fn(allocator, api_key, api_secret, exchange_symbol, limit);
    // Return with normalized symbol in response
    result.symbol = try allocator.dupe(u8, symbol);
    return result;
}

/// Fetch OHLCV (candlestick) data for a specific symbol.
/// Accepts symbols in normalized format (BASE/QUOTE) and converts to exchange format.
/// Returns an owned OHLCVArray; caller must call deinit.
pub fn fetchOHLCV(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    timeframe: []const u8,
    since: ?i64,
    limit: ?i64,
) !types.OHLCVArray {
    const ohlcv_fn = getOHLCVFn(exchange_name) orelse {
        return types.OHLCVArray{ .data = try allocator.alloc(types.OHLCV, 0) };
    };

    // Convert to exchange-specific format
    const exchange_symbol = try toExchangeFormat(allocator, exchange_name, symbol);
    defer if (!std.mem.eql(u8, exchange_symbol, symbol)) allocator.free(exchange_symbol);

    return ohlcv_fn(allocator, api_key, api_secret, exchange_symbol, timeframe, since, limit);
}

pub const CreateOrderFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    order_type: []const u8,
    side: []const u8,
    amount: f64,
    price: ?f64,
) anyerror!types.Order;

pub const CancelOrderFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    order_id: []const u8,
    symbol: []const u8,
) anyerror!types.Order;

pub const FetchOpenOrdersFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: ?[]const u8,
) anyerror!types.OrderArray;

pub const FetchClosedOrdersFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: ?[]const u8,
) anyerror!types.OrderArray;

pub const FetchMyTradesFn = *const fn (
    allocator: std.mem.Allocator,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: ?[]const u8,
) anyerror!types.TradeArray;

pub fn getCreateOrderFn(exchange_name: []const u8) ?CreateOrderFn {
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.createOrder;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.createOrder;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.createOrder;
    return null;
}

pub fn getCancelOrderFn(exchange_name: []const u8) ?CancelOrderFn {
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.cancelOrder;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.cancelOrder;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.cancelOrder;
    return null;
}

pub fn getFetchOpenOrdersFn(exchange_name: []const u8) ?FetchOpenOrdersFn {
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchOpenOrders;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchOpenOrders;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchOpenOrders;
    return null;
}

pub fn getFetchClosedOrdersFn(exchange_name: []const u8) ?FetchClosedOrdersFn {
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchClosedOrders;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchClosedOrders;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchClosedOrders;
    return null;
}

pub fn getFetchMyTradesFn(exchange_name: []const u8) ?FetchMyTradesFn {
    if (std.mem.eql(u8, exchange_name, "lcx")) return lcx.fetchMyTrades;
    if (std.mem.eql(u8, exchange_name, "kraken")) return kraken.fetchMyTrades;
    if (std.mem.eql(u8, exchange_name, "coinbase")) return coinbase.fetchMyTrades;
    return null;
}

/// Create an order on the given exchange.
/// Returns an owned Order; caller must call deinit.
pub fn createOrder(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: []const u8,
    order_type: []const u8,
    side: []const u8,
    amount: f64,
    price: ?f64,
) !types.Order {
    const create_fn = getCreateOrderFn(exchange_name) orelse {
        return types.Order{
            .id = try allocator.dupe(u8, ""),
            .clientOrderId = null,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .lastTradeTimestamp = null,
            .lastUpdateTimestamp = null,
            .symbol = try allocator.dupe(u8, symbol),
            .type = try allocator.dupe(u8, order_type),
            .side = try allocator.dupe(u8, side),
            .price = price orelse 0,
            .amount = amount,
            .cost = (price orelse 0) * amount,
            .average = 0,
            .filled = 0,
            .remaining = amount,
            .status = try allocator.dupe(u8, "failed"),
            .fee = null,
            .trades = try allocator.alloc(types.Trade, 0),
            .info = try allocator.dupe(u8, ""),
        };
    };

    // Convert to exchange-specific format
    const exchange_symbol = try toExchangeFormat(allocator, exchange_name, symbol);
    defer if (!std.mem.eql(u8, exchange_symbol, symbol)) allocator.free(exchange_symbol);

    var result = try create_fn(allocator, api_key, api_secret, exchange_symbol, order_type, side, amount, price);
    // Return with normalized symbol
    result.symbol = try allocator.dupe(u8, symbol);
    return result;
}

/// Cancel an order on the given exchange.
/// Returns an owned Order; caller must call deinit.
pub fn cancelOrder(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    order_id: []const u8,
    symbol: []const u8,
) !types.Order {
    const cancel_fn = getCancelOrderFn(exchange_name) orelse {
        return types.Order{
            .id = try allocator.dupe(u8, order_id),
            .clientOrderId = null,
            .timestamp = std.time.milliTimestamp(),
            .datetime = try allocator.dupe(u8, ""),
            .lastTradeTimestamp = null,
            .lastUpdateTimestamp = null,
            .symbol = try allocator.dupe(u8, symbol),
            .type = try allocator.dupe(u8, ""),
            .side = try allocator.dupe(u8, ""),
            .price = 0,
            .amount = 0,
            .cost = 0,
            .average = 0,
            .filled = 0,
            .remaining = 0,
            .status = try allocator.dupe(u8, "failed"),
            .fee = null,
            .trades = try allocator.alloc(types.Trade, 0),
            .info = try allocator.dupe(u8, ""),
        };
    };

    // Convert to exchange-specific format
    const exchange_symbol = try toExchangeFormat(allocator, exchange_name, symbol);
    defer if (!std.mem.eql(u8, exchange_symbol, symbol)) allocator.free(exchange_symbol);

    var result = try cancel_fn(allocator, api_key, api_secret, order_id, exchange_symbol);
    // Return with normalized symbol
    result.symbol = try allocator.dupe(u8, symbol);
    return result;
}

/// Fetch open orders from the given exchange.
/// Accepts symbols in normalized format (BASE/QUOTE) and converts to exchange format.
/// Returns an owned OrderArray; caller must call deinit.
pub fn fetchOpenOrders(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: ?[]const u8,
) !types.OrderArray {
    const fetch_fn = getFetchOpenOrdersFn(exchange_name) orelse {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };

    // Convert symbol to exchange-specific format if provided
    if (symbol) |sym| {
        const exchange_symbol = try toExchangeFormat(allocator, exchange_name, sym);
        defer if (!std.mem.eql(u8, exchange_symbol, sym)) allocator.free(exchange_symbol);

        const result = try fetch_fn(allocator, api_key, api_secret, exchange_symbol);
        // Normalize symbols in results
        for (result.data) |*order| {
            allocator.free(order.symbol);
            order.symbol = try allocator.dupe(u8, sym);
        }
        return result;
    }

    return fetch_fn(allocator, api_key, api_secret, null);
}

/// Fetch closed (filled, cancelled) orders from the given exchange.
pub fn fetchClosedOrders(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: ?[]const u8,
) !types.OrderArray {
    const fetch_fn = getFetchClosedOrdersFn(exchange_name) orelse {
        return types.OrderArray{ .data = try allocator.alloc(types.Order, 0) };
    };

    // Convert symbol to exchange-specific format if provided
    if (symbol) |sym| {
        const exchange_symbol = try toExchangeFormat(allocator, exchange_name, sym);
        defer if (!std.mem.eql(u8, exchange_symbol, sym)) allocator.free(exchange_symbol);

        const result = try fetch_fn(allocator, api_key, api_secret, exchange_symbol);
        // Normalize symbols in results
        for (result.data) |*order| {
            allocator.free(order.symbol);
            order.symbol = try allocator.dupe(u8, sym);
        }
        return result;
    }

    return fetch_fn(allocator, api_key, api_secret, null);
}

/// Fetch my trades from the given exchange.
pub fn fetchMyTrades(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    api_key: []const u8,
    api_secret: []const u8,
    symbol: ?[]const u8,
) !types.TradeArray {
    const fetch_fn = getFetchMyTradesFn(exchange_name) orelse {
        return types.TradeArray{ .data = try allocator.alloc(types.Trade, 0) };
    };

    // Convert symbol to exchange-specific format if provided
    if (symbol) |sym| {
        const exchange_symbol = try toExchangeFormat(allocator, exchange_name, sym);
        defer if (!std.mem.eql(u8, exchange_symbol, sym)) allocator.free(exchange_symbol);

        const result = try fetch_fn(allocator, api_key, api_secret, exchange_symbol);
        // Normalize symbols in results
        for (result.data) |*trade| {
            allocator.free(trade.symbol);
            trade.symbol = try allocator.dupe(u8, sym);
        }
        return result;
    }

    return fetch_fn(allocator, api_key, api_secret, null);
}

/// Normalize a symbol to standard format (BASE/QUOTE).
/// Handles different formats from different exchanges.
/// Returns allocated normalized symbol; caller must free.
pub fn normalizeSymbol(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    symbol: []const u8,
) ![]u8 {
    return symbol_utils.normalizeSymbol(allocator, exchange_name, symbol);
}

/// Convert normalized symbol to exchange-specific format.
/// Useful for making API calls with exchange-native format.
/// Returns allocated symbol in exchange format; caller must free.
pub fn toExchangeFormat(
    allocator: std.mem.Allocator,
    exchange_name: []const u8,
    normalized_symbol: []const u8,
) ![]u8 {
    return symbol_utils.toExchangeFormat(allocator, exchange_name, normalized_symbol);
}

/// Extract base asset from normalized symbol (e.g., "BTC/EUR" → "BTC").
pub fn getBase(normalized_symbol: []const u8) []const u8 {
    return symbol_utils.getBase(normalized_symbol);
}

/// Extract quote asset from normalized symbol (e.g., "BTC/EUR" → "EUR").
pub fn getQuote(normalized_symbol: []const u8) []const u8 {
    return symbol_utils.getQuote(normalized_symbol);
}

/// Check if symbol is in standard normalized format.
pub fn isNormalized(symbol: []const u8) bool {
    return symbol_utils.isNormalized(symbol);
}
