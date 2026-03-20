const std = @import("std");
const types = @import("../models/models.zig");

pub const ArbitrageType = enum {
    cross_exchange,
    spread_analysis,
    volume_pressure,
    triangular,
    atomic_dex,
    dust_accumulation,
    orderbook_hole,
    fee_tier_optimized,
    latency_lead,
    vwap_gap,
    ofoi_imbalance,
    micro_spread,
    synthetic_pair,
    api_stale_data,
    mvp_filter,
};

pub const PriceLevel = struct {
    price: f64,
    amount: f64,
};

pub const Orderbook = struct {
    exchange: []const u8,
    pair: []const u8,
    bids: []PriceLevel,
    asks: []PriceLevel,
    timestamp: i64,
    api_rtt_ms: u32, // Round Trip Time in milliseconds
};

pub const ArbitrageOpportunity = struct {
    id: []const u8,
    arb_type: ArbitrageType,
    pair: []const u8,
    exchange_a: []const u8,
    exchange_b: []const u8,
    price_a: f64,
    price_b: f64,
    gross_profit_pct: f64,
    net_profit_pct: f64, // After fees, slippage, transfer
    confidence: f64, // 0.0 - 1.0
    risk_score: f64,
    action: []const u8, // "BUY_A_SELL_B" or similar
    details: []const u8,
    timestamp: i64,
};

pub const Scanner = struct {
    allocator: std.mem.Allocator,
    orderbooks: std.StringHashMap(Orderbook),
    opportunities: std.ArrayList(ArbitrageOpportunity),
    min_profit_threshold: f64 = 0.1, // 0.1% minimum profitable
    fee_taker: f64 = 0.001, // 0.1% default
    fee_maker: f64 = 0.0005,
    network_fees: f64 = 0.0005, // 0.05% for token transfer
    api_timeout_ms: u32 = 100, // Heartbeat timeout

    pub fn init(allocator: std.mem.Allocator) Scanner {
        var scanner: Scanner = undefined;
        scanner.allocator = allocator;
        scanner.orderbooks = std.StringHashMap(Orderbook).init(allocator);
        const opps: std.ArrayList(ArbitrageOpportunity) = .empty;
        scanner.opportunities = opps;
        return scanner;
    }

    pub fn deinit(self: *Scanner) void {
        self.orderbooks.deinit();
        self.opportunities.deinit(self.allocator);
    }

    // Get exchange-specific taker fees
    fn getExchangeFee(_: *Scanner, exchange: []const u8) f64 {
        if (std.mem.eql(u8, exchange, "lcx")) return 0.001;      // 0.1%
        if (std.mem.eql(u8, exchange, "kraken")) return 0.0016;  // 0.16%
        if (std.mem.eql(u8, exchange, "coinbase")) return 0.006; // 0.6%
        return 0.001; // default
    }

    // ===== MODEL 1: Cross-Exchange Arbitrage with BOTH scenarios =====
    pub fn detectCrossExchange(
        self: *Scanner,
        book_a: Orderbook,
        book_b: Orderbook,
    ) !void {
        if (book_a.bids.len == 0 or book_a.asks.len == 0 or
            book_b.bids.len == 0 or book_b.asks.len == 0)
            return;

        const best_bid_a = book_a.bids[0].price;
        const best_ask_a = book_a.asks[0].price;
        const best_bid_b = book_b.bids[0].price;
        const best_ask_b = book_b.asks[0].price;

        // Validate data integrity: bid must be < ask on both exchanges
        if (best_bid_a >= best_ask_a or best_bid_b >= best_ask_b) return;
        if (best_bid_a <= 0 or best_ask_a <= 0 or best_bid_b <= 0 or best_ask_b <= 0) return;

        // Get exchange-specific fees
        const fee_a = self.getExchangeFee(book_a.exchange);
        const fee_b = self.getExchangeFee(book_b.exchange);

        // ===== SCENARIO 1 (V1): Buy cheap (ASK) on A, Sell expensive (BID) on B =====
        if (best_ask_a < best_bid_b) {
            const buy_cost = best_ask_a * (1.0 + fee_a);           // Buy with fee
            const sell_revenue = best_bid_b * (1.0 - fee_b);       // Sell with fee
            const gross_spread = best_bid_b - best_ask_a;
            const net_profit_absolute = sell_revenue - buy_cost;
            const net_profit_pct = (net_profit_absolute / buy_cost) * 100.0;

            if (net_profit_pct > self.min_profit_threshold) {
                const opp = ArbitrageOpportunity{
                    .id = try std.fmt.allocPrint(self.allocator, "ARB_V1_{s}_{s}", .{ book_a.exchange, book_b.exchange }),
                    .arb_type = .cross_exchange,
                    .pair = book_a.pair,
                    .exchange_a = book_a.exchange,
                    .exchange_b = book_b.exchange,
                    .price_a = best_ask_a,
                    .price_b = best_bid_b,
                    .gross_profit_pct = (gross_spread / best_ask_a) * 100.0,
                    .net_profit_pct = net_profit_pct,
                    .confidence = 0.95,
                    .risk_score = @as(f64, @floatFromInt(book_a.api_rtt_ms + book_b.api_rtt_ms)) / 100.0,
                    .action = try std.fmt.allocPrint(self.allocator, "BUY_{s}_SELL_{s}", .{ book_a.exchange, book_b.exchange }),
                    .details = try std.fmt.allocPrint(self.allocator, "V1: Buy @{d:.8} + {d:.2}% fee = {d:.8}, Sell @{d:.8} - {d:.2}% fee = {d:.8}", .{ best_ask_a, fee_a * 100.0, buy_cost, best_bid_b, fee_b * 100.0, sell_revenue }),
                    .timestamp = std.time.milliTimestamp(),
                };
                try self.opportunities.append(self.allocator, opp);
            }
        }

        // ===== SCENARIO 2 (V2): Buy cheap (ASK) on B, Sell expensive (BID) on A =====
        if (best_ask_b < best_bid_a) {
            const buy_cost = best_ask_b * (1.0 + fee_b);           // Buy with fee
            const sell_revenue = best_bid_a * (1.0 - fee_a);       // Sell with fee
            const gross_spread = best_bid_a - best_ask_b;
            const net_profit_absolute = sell_revenue - buy_cost;
            const net_profit_pct = (net_profit_absolute / buy_cost) * 100.0;

            if (net_profit_pct > self.min_profit_threshold) {
                const opp = ArbitrageOpportunity{
                    .id = try std.fmt.allocPrint(self.allocator, "ARB_V2_{s}_{s}", .{ book_b.exchange, book_a.exchange }),
                    .arb_type = .cross_exchange,
                    .pair = book_a.pair,
                    .exchange_a = book_b.exchange,
                    .exchange_b = book_a.exchange,
                    .price_a = best_ask_b,
                    .price_b = best_bid_a,
                    .gross_profit_pct = (gross_spread / best_ask_b) * 100.0,
                    .net_profit_pct = net_profit_pct,
                    .confidence = 0.95,
                    .risk_score = @as(f64, @floatFromInt(book_a.api_rtt_ms + book_b.api_rtt_ms)) / 100.0,
                    .action = try std.fmt.allocPrint(self.allocator, "BUY_{s}_SELL_{s}", .{ book_b.exchange, book_a.exchange }),
                    .details = try std.fmt.allocPrint(self.allocator, "V2: Buy @{d:.8} + {d:.2}% fee = {d:.8}, Sell @{d:.8} - {d:.2}% fee = {d:.8}", .{ best_ask_b, fee_b * 100.0, buy_cost, best_bid_a, fee_a * 100.0, sell_revenue }),
                    .timestamp = std.time.milliTimestamp(),
                };
                try self.opportunities.append(self.allocator, opp);
            }
        }
    }

    // ===== MODEL 2: Spread & Depth Analysis =====
    pub fn analyzeSpreadDepth(
        self: *Scanner,
        book: Orderbook,
    ) !void {
        if (book.bids.len == 0 or book.asks.len == 0) return;

        const best_bid = book.bids[0].price;
        const best_ask = book.asks[0].price;

        // Validate data integrity: bid must be < ask
        if (best_bid >= best_ask) return;
        if (best_bid <= 0 or best_ask <= 0) return;

        const spread = best_ask - best_bid;
        const spread_pct = (spread / best_bid) * 100.0;

        // Detect if spread is unusually wide (potential for micro-spread scalping)
        // Filter out corrupted data: reject spreads > 50% (likely data errors from LCX)
        if (spread_pct > 0.5 and spread_pct < 50.0) {
            const opp = ArbitrageOpportunity{
                .id = try std.fmt.allocPrint(self.allocator, "SPREAD_{s}_{s}", .{ book.exchange, book.pair }),
                .arb_type = .spread_analysis,
                .pair = book.pair,
                .exchange_a = book.exchange,
                .exchange_b = book.exchange,
                .price_a = best_bid,
                .price_b = best_ask,
                .gross_profit_pct = spread_pct,
                .net_profit_pct = spread_pct - (self.fee_maker * 2 * 100.0),
                .confidence = 0.85,
                .risk_score = 0.1, // Low risk - same exchange
                .action = "LIMIT_BUY_SELL",
                .details = try std.fmt.allocPrint(self.allocator, "Wide spread {d:.2}% - Scalp opportunity", .{spread_pct}),
                .timestamp = std.time.milliTimestamp(),
            };
            try self.opportunities.append(self.allocator, opp);
        }
    }

    // ===== MODEL 3: Volume & Order Flow Imbalance =====
    pub fn detectVolumeImbalance(
        self: *Scanner,
        book: Orderbook,
    ) !void {
        if (book.bids.len < 5 or book.asks.len < 5) return;

        var bid_volume: f64 = 0;
        var ask_volume: f64 = 0;

        // Sum top 5 levels
        for (book.bids[0..@min(5, book.bids.len)]) |level| {
            bid_volume += level.amount;
        }
        for (book.asks[0..@min(5, book.asks.len)]) |level| {
            ask_volume += level.amount;
        }

        const ratio = bid_volume / ask_volume;
        const imbalance_pct = @abs((ratio - 1.0) / 1.0) * 100.0;

        if (imbalance_pct > 150.0) { // 150% imbalance
            const direction = if (ratio > 1.0) "BULLISH" else "BEARISH";
            const opp = ArbitrageOpportunity{
                .id = try std.fmt.allocPrint(self.allocator, "OFI_{s}_{s}", .{ book.exchange, book.pair }),
                .arb_type = .volume_pressure,
                .pair = book.pair,
                .exchange_a = book.exchange,
                .exchange_b = book.exchange,
                .price_a = book.bids[0].price,
                .price_b = book.asks[0].price,
                .gross_profit_pct = imbalance_pct,
                .net_profit_pct = imbalance_pct * 0.5, // Conservative
                .confidence = 0.70,
                .risk_score = 0.4,
                .action = try std.fmt.allocPrint(self.allocator, "PREDICT_{s}", .{direction}),
                .details = try std.fmt.allocPrint(self.allocator, "{s} OFI: Bid/Ask ratio {d:.2}x", .{ direction, ratio }),
                .timestamp = std.time.milliTimestamp(),
            };
            try self.opportunities.append(self.allocator, opp);
        }
    }

    // ===== MODEL 4: Orderbook Hole Detection =====
    pub fn detectOrderbookHoles(
        self: *Scanner,
        book: Orderbook,
    ) !void {
        if (book.asks.len < 3) return;

        // Detect gaps in price levels (holes)
        var max_gap: f64 = 0.0;
        var gap_price: f64 = 0.0;

        for (book.asks[0 .. book.asks.len - 1]) |level| {
            if (book.asks.len > 0) {
                const gap = book.asks[1].price - level.price;
                if (gap > max_gap) {
                    max_gap = gap;
                    gap_price = level.price;
                }
            }
        }

        if (max_gap > (book.asks[0].price * 0.01)) { // Gap > 1% of price
            const opp = ArbitrageOpportunity{
                .id = try std.fmt.allocPrint(self.allocator, "HOLE_{s}_{s}", .{ book.exchange, book.pair }),
                .arb_type = .orderbook_hole,
                .pair = book.pair,
                .exchange_a = book.exchange,
                .exchange_b = book.exchange,
                .price_a = gap_price,
                .price_b = gap_price + max_gap,
                .gross_profit_pct = (max_gap / gap_price) * 100.0,
                .net_profit_pct = (max_gap / gap_price) * 100.0 * 0.6,
                .confidence = 0.65,
                .risk_score = 0.5,
                .action = "BRIDGE_HOLE",
                .details = try std.fmt.allocPrint(self.allocator, "Price gap of {d:.8} detected", .{max_gap}),
                .timestamp = std.time.milliTimestamp(),
            };
            try self.opportunities.append(self.allocator, opp);
        }
    }

    // ===== MODEL 5: Latency Arbitrage (API Heartbeat Lead) =====
    pub fn detectLatencyLead(
        self: *Scanner,
        fast_book: Orderbook,
        slow_book: Orderbook,
    ) !void {
        const latency_diff = @as(i32, @intCast(slow_book.api_rtt_ms)) - @as(i32, @intCast(fast_book.api_rtt_ms));

        if (latency_diff > 30) { // >30ms difference
            // Predict that slow exchange will move towards fast exchange
            const predicted_move = (fast_book.asks[0].price - slow_book.asks[0].price) / slow_book.asks[0].price * 100.0;

            if (predicted_move > 0.05) {
                const opp = ArbitrageOpportunity{
                    .id = try std.fmt.allocPrint(self.allocator, "LATENCY_{s}_{s}", .{ fast_book.exchange, slow_book.exchange }),
                    .arb_type = .latency_lead,
                    .pair = fast_book.pair,
                    .exchange_a = fast_book.exchange,
                    .exchange_b = slow_book.exchange,
                    .price_a = fast_book.asks[0].price,
                    .price_b = slow_book.bids[0].price,
                    .gross_profit_pct = predicted_move,
                    .net_profit_pct = predicted_move * 0.7,
                    .confidence = 0.60,
                    .risk_score = @as(f64, @floatFromInt(latency_diff)) / 100.0,
                    .action = "BUY_FAST_SELL_SLOW",
                    .details = try std.fmt.allocPrint(self.allocator, "Latency lead {d}ms - predicted {d:.2}% move", .{ latency_diff, predicted_move }),
                    .timestamp = std.time.milliTimestamp(),
                };
                try self.opportunities.append(self.allocator, opp);
            }
        }
    }

    // ===== MODEL 6: API Stale Data Detection =====
    pub fn checkApiHeartbeat(
        self: *Scanner,
        book: Orderbook,
        current_time: i64,
    ) !bool {
        const age_ms = current_time - book.timestamp;
        return age_ms < self.api_timeout_ms;
    }

    pub fn scanAll(
        self: *Scanner,
        books: []Orderbook,
    ) !void {
        // Clear previous results
        self.opportunities.clearRetainingCapacity();

        const current_time = std.time.milliTimestamp();

        for (books) |book| {
            // Check API heartbeat
            const is_fresh = try self.checkApiHeartbeat(book, current_time);
            if (!is_fresh) continue;

            // NOTE: Same-exchange spread/volume analysis is NOT arbitrage
            // Real arbitrage requires DIFFERENT exchanges or DIFFERENT pairs
            // try self.analyzeSpreadDepth(book);        // DISABLED: same-exchange not arbitrage
            // try self.detectVolumeImbalance(book);     // DISABLED: momentum signal, not arbitrage
            // try self.detectOrderbookHoles(book);      // DISABLED: same-exchange not arbitrage
        }

        // Cross-exchange detection
        if (books.len >= 2) {
            for (books, 0..) |book_a, i| {
                for (books[i + 1 ..]) |book_b| {
                    try self.detectCrossExchange(book_a, book_b);
                    try self.detectLatencyLead(book_a, book_b);
                }
            }
        }
    }
};
