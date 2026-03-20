const std = @import("std");
const net = std.net;
const mem = std.mem;
const exchange_factory = @import("../exchange/factory.zig");

pub fn handleWsOrderbook(stream: net.Stream, allocator: mem.Allocator, request: []const u8) !void {
    defer stream.close();

    // Extract query params: ?exchange=lcx&pair=LCX%2FUSDC
    var exchange: ?[]const u8 = null;
    var pair: ?[]const u8 = null;

    if (std.mem.indexOf(u8, request, "exchange=")) |idx| {
        const start = idx + 9;
        var end = start;
        while (end < request.len and request[end] != '&' and request[end] != ' ' and request[end] != '\r' and request[end] != '\n') : (end += 1) {}
        exchange = request[start..end];
    }

    if (std.mem.indexOf(u8, request, "pair=")) |idx| {
        const start = idx + 5;
        var end = start;
        while (end < request.len and request[end] != '&' and request[end] != ' ' and request[end] != '\r' and request[end] != '\n') : (end += 1) {}
        pair = request[start..end];
    }

    const exch = exchange orelse {
        _ = try stream.writeAll("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
    };
    const sym = pair orelse {
        _ = try stream.writeAll("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
    };

    // URL-decode pair (replace %2F with /)
    var decoded_pair_buf: [256]u8 = undefined;
    const decoded_pair = urlDecode(sym, &decoded_pair_buf);

    // Extract Sec-WebSocket-Key
    const ws_key = extractHeader(request, "Sec-WebSocket-Key") orelse {
        _ = try stream.writeAll("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
    };

    // Compute accept key
    const accept_key = try computeWsAcceptKey(allocator, ws_key);
    defer allocator.free(accept_key);

    // Send 101 Switching Protocols response
    const response = try std.fmt.allocPrint(allocator,
        "HTTP/1.1 101 Switching Protocols\r\n" ++
        "Upgrade: websocket\r\n" ++
        "Connection: Upgrade\r\n" ++
        "Sec-WebSocket-Accept: {s}\r\n" ++
        "\r\n",
        .{accept_key});
    defer allocator.free(response);
    try stream.writeAll(response);

    std.debug.print("[WS] Client connected: exchange={s}, pair={s}\n", .{ exch, decoded_pair });

    // Push loop - send orderbook every 100ms
    var ticker: usize = 0;
    while (true) {
        ticker += 1;

        // Fetch orderbook data
        const json_payload = fetchOrderbookJson(allocator, exch, decoded_pair) catch |err| {
            std.debug.print("[WS] Fetch error: {}\n", .{err});
            break;
        };
        defer allocator.free(json_payload);

        // Send as WebSocket text frame
        sendWsTextFrame(stream, json_payload) catch |err| {
            std.debug.print("[WS] Send error: {}, client disconnected\n", .{err});
            break;
        };

        if (ticker % 10 == 0) {
            std.debug.print("[WS] Sent {d} frames to {s}/{s}\n", .{ ticker, exch, decoded_pair });
        }

        // Sleep 100ms
        std.Thread.sleep(100 * std.time.ns_per_ms);
    }

    std.debug.print("[WS] Client disconnected: exchange={s}, pair={s}\n", .{ exch, decoded_pair });
}

fn extractHeader(request: []const u8, header_name: []const u8) ?[]const u8 {
    var search_start: usize = 0;
    while (std.mem.indexOf(u8, request[search_start..], header_name)) |idx| {
        const actual_idx = search_start + idx;
        // Check if this is the start of a line (preceded by \r\n or start of request)
        if (actual_idx == 0 or (actual_idx >= 2 and request[actual_idx - 2] == '\r' and request[actual_idx - 1] == '\n')) {
            // Found the header, now extract the value
            const value_start = actual_idx + header_name.len;
            if (value_start < request.len and request[value_start] == ':') {
                var value_idx = value_start + 1;
                // Skip spaces
                while (value_idx < request.len and request[value_idx] == ' ') : (value_idx += 1) {}
                // Find end (before \r\n)
                var end = value_idx;
                while (end < request.len and request[end] != '\r' and request[end] != '\n') : (end += 1) {}
                return request[value_idx..end];
            }
        }
        search_start = actual_idx + 1;
    }
    return null;
}

fn computeWsAcceptKey(allocator: mem.Allocator, key: []const u8) ![]u8 {
    const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    // Compute SHA1(key + magic)
    var hasher = std.crypto.hash.Sha1.init(.{});
    hasher.update(key);
    hasher.update(magic);
    var digest: [20]u8 = undefined;
    hasher.final(&digest);

    // Base64 encode
    const Encoder = std.base64.standard.Encoder;
    const encoded = try allocator.alloc(u8, Encoder.calcSize(digest.len));
    _ = Encoder.encode(encoded, &digest);
    return encoded;
}

fn sendWsTextFrame(stream: net.Stream, payload: []const u8) !void {
    var header: [10]u8 = undefined;
    header[0] = 0x81; // FIN=1, opcode=1 (text)

    var header_len: usize = 2;
    if (payload.len < 126) {
        header[1] = @as(u8, @intCast(payload.len));
    } else if (payload.len < 65536) {
        header[1] = 126;
        header[2] = @as(u8, @intCast((payload.len >> 8) & 0xFF));
        header[3] = @as(u8, @intCast(payload.len & 0xFF));
        header_len = 4;
    } else {
        header[1] = 127;
        // 8-byte extended length (big-endian)
        header[2] = 0;
        header[3] = 0;
        header[4] = 0;
        header[5] = 0;
        header[6] = @as(u8, @intCast((payload.len >> 24) & 0xFF));
        header[7] = @as(u8, @intCast((payload.len >> 16) & 0xFF));
        header[8] = @as(u8, @intCast((payload.len >> 8) & 0xFF));
        header[9] = @as(u8, @intCast(payload.len & 0xFF));
        header_len = 10;
    }

    try stream.writeAll(header[0..header_len]);
    try stream.writeAll(payload);
}

fn fetchOrderbookJson(allocator: mem.Allocator, exchange: []const u8, symbol: []const u8) ![]u8 {
    var orderbook_result = try exchange_factory.fetchOrderBook(allocator, exchange, "", "", symbol, null);
    defer orderbook_result.deinit(allocator);

    // Calculate stats
    var best_bid: f64 = 0;
    var best_ask: f64 = 0;
    var total_bid_amount: f64 = 0;
    var total_ask_amount: f64 = 0;

    if (orderbook_result.bids.len > 0) {
        best_bid = orderbook_result.bids[0].price;
        for (orderbook_result.bids) |bid| {
            total_bid_amount += bid.amount;
        }
    }

    if (orderbook_result.asks.len > 0) {
        best_ask = orderbook_result.asks[0].price;
        for (orderbook_result.asks) |ask| {
            total_ask_amount += ask.amount;
        }
    }

    const spread: f64 = if (best_bid > 0 and best_ask > 0) best_ask - best_bid else 0;
    const midpoint: f64 = if (best_bid > 0 and best_ask > 0) (best_bid + best_ask) / 2.0 else 0;
    const timestamp = @as(i64, @intCast(std.time.timestamp()));

    // Format bids
    var bids_json: std.ArrayList(u8) = .empty;
    defer bids_json.deinit(allocator);
    try bids_json.appendSlice(allocator, "[");
    for (orderbook_result.bids, 0..) |bid, i| {
        if (i > 0) try bids_json.appendSlice(allocator, ",");
        const bid_str = try std.fmt.allocPrint(allocator, "{{\"price\":{d},\"amount\":{d}}}", .{ bid.price, bid.amount });
        defer allocator.free(bid_str);
        try bids_json.appendSlice(allocator, bid_str);
    }
    try bids_json.appendSlice(allocator, "]");

    // Format asks
    var asks_json: std.ArrayList(u8) = .empty;
    defer asks_json.deinit(allocator);
    try asks_json.appendSlice(allocator, "[");
    for (orderbook_result.asks, 0..) |ask, i| {
        if (i > 0) try asks_json.appendSlice(allocator, ",");
        const ask_str = try std.fmt.allocPrint(allocator, "{{\"price\":{d},\"amount\":{d}}}", .{ ask.price, ask.amount });
        defer allocator.free(ask_str);
        try asks_json.appendSlice(allocator, ask_str);
    }
    try asks_json.appendSlice(allocator, "]");

    // Build JSON response
    const resp_body = try std.fmt.allocPrint(allocator,
        "{{\"exchange\":\"{s}\",\"symbol\":\"{s}\",\"bestBid\":{d},\"bestAsk\":{d},\"spread\":{d},\"midpoint\":{d},\"totalBidAmount\":{d},\"totalAskAmount\":{d},\"timestamp\":{d},\"bids\":{s},\"asks\":{s}}}",
        .{ exchange, symbol, best_bid, best_ask, spread, midpoint, total_bid_amount, total_ask_amount, timestamp, bids_json.items, asks_json.items });

    return resp_body;
}

fn urlDecode(encoded: []const u8, buf: []u8) []u8 {
    var j: usize = 0;
    var i: usize = 0;
    while (i < encoded.len and j < buf.len) {
        if (encoded[i] == '%' and i + 2 < encoded.len) {
            if (std.fmt.parseInt(u8, encoded[i + 1 .. i + 3], 16)) |byte| {
                buf[j] = byte;
                j += 1;
                i += 3;
            } else |_| {
                buf[j] = encoded[i];
                j += 1;
                i += 1;
            }
        } else if (encoded[i] == '+') {
            buf[j] = ' ';
            j += 1;
            i += 1;
        } else {
            buf[j] = encoded[i];
            j += 1;
            i += 1;
        }
    }
    return buf[0..j];
}
