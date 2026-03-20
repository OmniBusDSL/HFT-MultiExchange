const std = @import("std");
const orderbook_cache = @import("orderbook_cache.zig");
const exchange_factory = @import("../exchange/factory.zig");

pub fn runUpdaterThread(allocator: std.mem.Allocator) !void {
    // Fetch pairs to update - use pairs that work across all exchanges
    const lcx_pairs = [_][]const u8{ "BTC/EUR", "ETH/EUR", "LCX/USDC" };
    const kraken_pairs = [_][]const u8{ "BTC/USD", "ETH/USD", "LCX/USD" };
    const coinbase_pairs = [_][]const u8{ "BTC/USD", "ETH/USD", "LCX-USDC" };

    std.debug.print("[CACHE] Updater thread started\n", .{});

    while (true) {
        // Update LCX with LCX-specific pairs
        updateExchangeCache(allocator, "lcx", &lcx_pairs) catch |err| {
            std.debug.print("[CACHE] LCX update error: {}\n", .{err});
        };

        // Update Kraken with Kraken-specific pairs
        updateExchangeCache(allocator, "kraken", &kraken_pairs) catch |err| {
            std.debug.print("[CACHE] Kraken update error: {}\n", .{err});
        };

        // Update Coinbase with Coinbase-specific pairs
        updateExchangeCache(allocator, "coinbase", &coinbase_pairs) catch |err| {
            std.debug.print("[CACHE] Coinbase update error: {}\n", .{err});
        };

        // Sleep 100ms (matching frontend poll interval)
        std.Thread.sleep(100 * std.time.ns_per_ms);
    }
}

fn updateExchangeCache(allocator: std.mem.Allocator, exchange: []const u8, pairs: []const []const u8) !void {
    for (pairs) |pair| {
        // Fetch orderbook for this pair
        var orderbook_result = exchange_factory.fetchOrderBook(allocator, exchange, "", "", pair, null) catch {
            // Silently skip errors - cache stays stale
            continue;
        };
        defer orderbook_result.deinit(allocator);

        // Calculate statistics
        var best_bid: f64 = 0;
        var best_ask: f64 = 0;
        if (orderbook_result.bids.len > 0) {
            best_bid = orderbook_result.bids[0].price;
        }
        if (orderbook_result.asks.len > 0) {
            best_ask = orderbook_result.asks[0].price;
        }
        const spread = if (best_bid > 0 and best_ask > 0) best_ask - best_bid else 0;
        const midpoint = if (best_bid > 0 and best_ask > 0) (best_bid + best_ask) / 2.0 else 0;

        // Build cache entry
        var entry: orderbook_cache.OrderbookEntry = .{
            .best_bid = best_bid,
            .best_ask = best_ask,
            .spread = spread,
            .midpoint = midpoint,
            .timestamp = @as(i64, @intCast(std.time.timestamp())),
            .valid = true,
            .bids_len = @min(orderbook_result.bids.len, 100),
            .asks_len = @min(orderbook_result.asks.len, 100),
        };

        // Copy bids
        for (orderbook_result.bids[0..entry.bids_len], 0..) |bid, i| {
            entry.bids[i] = .{
                .price = bid.price,
                .amount = bid.amount,
            };
        }

        // Copy asks
        for (orderbook_result.asks[0..entry.asks_len], 0..) |ask, i| {
            entry.asks[i] = .{
                .price = ask.price,
                .amount = ask.amount,
            };
        }

        // Update global cache
        orderbook_cache.update(exchange, entry);
    }
}
