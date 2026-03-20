/// Symbol normalization utilities for multi-exchange support.
/// Converts all symbols to standard format: BASE/QUOTE (e.g., BTC/EUR)
const std = @import("std");

/// Normalize Kraken asset codes to standard symbols using base/quote directly.
/// This is the preferred method - it uses actual base/quote data from Kraken's markets.
/// Examples:
///   normalizeKrakenAssets("BTC", "USD") → "BTC/USD"
///   normalizeKrakenAssets("1INCH", "EUR") → "1INCH/EUR"
pub fn normalizeKrakenAssets(allocator: std.mem.Allocator, base: []const u8, quote: []const u8) ![]u8 {
    return try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base, quote });
}

/// Legacy: Normalize Kraken asset codes to standard symbols.
/// Kraken uses prefixes: X for crypto (XXBT), Z for fiat (ZUSD)
/// Examples:
///   XBTUSD → BTC/USD
///   XXBTZUSD → BTC/USD
///   ETHUSD → ETH/USD
///   XETHZUSD → ETH/USD
pub fn normalizeKrakenSymbol(allocator: std.mem.Allocator, symbol: []const u8) ![]u8 {
    var cleaned = std.ArrayList(u8){};
    defer cleaned.deinit(allocator);

    var i: usize = 0;
    while (i < symbol.len) : (i += 1) {
        const c = symbol[i];

        // Kraken prefix rules:
        // - X at position 0 followed by alphabetic = crypto prefix (skip it)
        // - Z at any position followed by 3-letter code = fiat prefix (skip it)
        var should_skip = false;

        if (i == 0 and c == 'X' and i + 1 < symbol.len and std.ascii.isAlphabetic(symbol[i + 1])) {
            // Skip leading X in crypto assets like XBTUSD or XXBTZUSD
            should_skip = true;
        } else if (c == 'Z' and i + 1 < symbol.len) {
            // Check if next 3 chars after Z form a known currency code
            if (i + 4 <= symbol.len) {
                const potential_currency = symbol[i + 1 .. i + 4];
                // Common fiat codes that come after Z in Kraken
                if (std.mem.eql(u8, potential_currency, "USD") or
                    std.mem.eql(u8, potential_currency, "EUR") or
                    std.mem.eql(u8, potential_currency, "GBP") or
                    std.mem.eql(u8, potential_currency, "JPY") or
                    std.mem.eql(u8, potential_currency, "CAD") or
                    std.mem.eql(u8, potential_currency, "AUD") or
                    std.mem.eql(u8, potential_currency, "CHF")) {
                    should_skip = true;
                }
            }
        }

        if (!should_skip) {
            try cleaned.append(allocator, c);
        }
    }

    const base_part = cleaned.items;

    // Known Kraken asset codes (in order of expected frequency/length)
    // Longer codes first to match longest prefix (e.g., XBT before BT)
    const kraken_assets = [_]struct { code: []const u8, standard: []const u8 }{
        .{ .code = "1INCH", .standard = "1INCH" },
        .{ .code = "LINK", .standard = "LINK" },
        .{ .code = "DOGE", .standard = "DOGE" },
        .{ .code = "XBT", .standard = "BTC" },   // Kraken's code for Bitcoin
        .{ .code = "BTC", .standard = "BTC" },   // Also support direct BTC
        .{ .code = "ETH", .standard = "ETH" },
        .{ .code = "XRP", .standard = "XRP" },
        .{ .code = "LTC", .standard = "LTC" },
        .{ .code = "BCH", .standard = "BCH" },
        .{ .code = "ADA", .standard = "ADA" },
        .{ .code = "SOL", .standard = "SOL" },
        .{ .code = "DOT", .standard = "DOT" },
        .{ .code = "BT", .standard = "BTC" },   // Alternate code for Bitcoin (should check after XBT)
    };

    // Known fiat currencies
    const fiat_currencies = [_][]const u8{
        "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "KRW",
        "SGD", "HKD", "NOK", "SEK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN",
        "HRK", "TRY", "ZAR", "BRL", "MXN", "PHP", "IDR", "THB", "MYR", "VND",
    };

    // Strategy 1: Try to find known asset codes at the start
    var base_len: usize = 0;
    for (kraken_assets) |asset| {
        if (std.mem.startsWith(u8, base_part, asset.code)) {
            base_len = asset.code.len;
            break;
        }
    }

    // Strategy 2: If no asset code matched, try fiat suffix matching
    if (base_len == 0) {
        base_len = base_part.len; // Default: assume entire symbol is base
        for (fiat_currencies) |fiat| {
            if (base_part.len > fiat.len) {
                const suffix_start = base_part.len - fiat.len;
                if (std.mem.eql(u8, base_part[suffix_start..], fiat)) {
                    base_len = suffix_start;
                    break;
                }
            }
        }

        // Fallback: if no fiat currency matched, assume last 3 chars are quote
        if (base_len == base_part.len and base_part.len >= 4) {
            base_len = base_part.len - 3;
        }
    }

    // Safety check: ensure base_len is valid
    if (base_len == 0 or base_len >= base_part.len) {
        base_len = if (base_part.len >= 3) base_part.len - 3 else base_part.len;
    }

    // Get base asset (with standard name mapping if needed)
    const base = base_part[0..base_len];
    const base_standard = blk: {
        for (kraken_assets) |asset| {
            if (std.mem.eql(u8, base, asset.code)) {
                break :blk asset.standard;
            }
        }
        break :blk base;
    };

    const quote = if (base_len < base_part.len) base_part[base_len..] else "USD";

    return try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base_standard, quote });
}

/// Normalize Coinbase symbols from DASH format to SLASH format.
/// Examples:
///   BTC-USD → BTC/USD
///   ETH-EUR → ETH/EUR
pub fn normalizeCoinbaseSymbol(allocator: std.mem.Allocator, symbol: []const u8) ![]u8 {
    var parts = std.mem.splitScalar(u8, symbol, '-');
    const base = parts.next() orelse "BTC";
    const quote = parts.next() orelse "USD";

    return try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base, quote });
}

/// Normalize LCX symbols (already in correct format, but clean them up).
/// LCX symbols are typically: BTC/EUR, ETH/USD, etc.
pub fn normalizeLcxSymbol(allocator: std.mem.Allocator, symbol: []const u8) ![]u8 {
    // Already in correct format, but ensure uppercase
    var result = std.ArrayList(u8).empty;
    defer result.deinit(allocator);

    for (symbol) |c| {
        try result.append(allocator, std.ascii.toUpper(c));
    }

    return result.toOwnedSlice(allocator);
}

/// Generic symbol normalizer - detects exchange and normalizes accordingly.
/// Returns normalized symbol in format: BASE/QUOTE (e.g., BTC/EUR)
pub fn normalizeSymbol(allocator: std.mem.Allocator, exchange: []const u8, symbol: []const u8) ![]u8 {
    if (std.mem.eql(u8, exchange, "kraken")) {
        return normalizeKrakenSymbol(allocator, symbol);
    } else if (std.mem.eql(u8, exchange, "coinbase")) {
        return normalizeCoinbaseSymbol(allocator, symbol);
    } else if (std.mem.eql(u8, exchange, "lcx")) {
        return normalizeLcxSymbol(allocator, symbol);
    }

    // Fallback: assume SLASH format
    return try allocator.dupe(u8, symbol);
}

/// Extract base asset from normalized symbol.
/// Example: "BTC/EUR" → "BTC"
pub fn getBase(symbol: []const u8) []const u8 {
    if (std.mem.indexOf(u8, symbol, "/")) |pos| {
        return symbol[0..pos];
    }
    return symbol;
}

/// Extract quote asset from normalized symbol.
/// Example: "BTC/EUR" → "EUR"
pub fn getQuote(symbol: []const u8) []const u8 {
    if (std.mem.indexOf(u8, symbol, "/")) |pos| {
        return symbol[pos + 1 ..];
    }
    return "USD"; // Default fallback
}

/// Check if symbol is in standard format (contains /)
pub fn isNormalized(symbol: []const u8) bool {
    return std.mem.indexOf(u8, symbol, "/") != null;
}

/// Convert standard format back to exchange-specific format if needed.
/// Useful for making API calls with exchange-native symbols.
pub fn toExchangeFormat(allocator: std.mem.Allocator, exchange: []const u8, normalized_symbol: []const u8) ![]u8 {
    if (std.mem.eql(u8, exchange, "kraken")) {
        // Kraken REST API expects symbols without slashes: XBTZUSD, ETHZUSD, SOLZUSD
        // Remove the slash from normalized format
        return try std.mem.replaceOwned(u8, allocator, normalized_symbol, "/", "");
    } else if (std.mem.eql(u8, exchange, "coinbase")) {
        // BTC/USD → BTC-USD
        return try std.mem.replaceOwned(u8, allocator, normalized_symbol, "/", "-");
    }

    // LCX and others: already in correct format
    return try allocator.dupe(u8, normalized_symbol);
}
