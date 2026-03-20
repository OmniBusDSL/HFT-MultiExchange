import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/OrderbookWsPage.css';

interface PriceLevel {
  price: number;
  amount: number;
}

interface OrderbookState {
  pair: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  spread: number | null;
  midpoint: number | null;
  lastUpdate: number;
  isConnected: boolean;
  status: string;
}

interface TickerResponse {
  exchange: string;
  tickers: Array<{ symbol: string }>;
}

const DEFAULT_ORDERBOOK: OrderbookState = {
  pair: '',
  bids: [],
  asks: [],
  spread: null,
  midpoint: null,
  lastUpdate: 0,
  isConnected: false,
  status: 'Connecting to WebSocket...',
};

const EXCHANGES = [
  { id: 'lcx', name: 'LCX', url: 'wss://exchange-api.lcx.com/ws' },
  { id: 'kraken', name: 'Kraken', url: 'wss://ws.kraken.com/v2' },  // v2 API - cleaner JSON format
  { id: 'coinbase', name: 'Coinbase', url: 'wss://ws-feed.exchange.coinbase.com' },
];

export const OrderbookWsPage: React.FC = () => {
  const { token } = useAuth();
  const [selectedExchange, setSelectedExchange] = useState('lcx');
  const [selectedPair, setSelectedPair] = useState('');
  const [pairSearch, setPairSearch] = useState('');
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [showPairSuggestions, setShowPairSuggestions] = useState(false);
  const [orderbook, setOrderbook] = useState<OrderbookState>(DEFAULT_ORDERBOOK);
  const [pairsLoading, setPairsLoading] = useState(false);
  const [exchangePairs, setExchangePairs] = useState<Record<string, string[]>>({
    lcx: [],
    kraken: [],
    coinbase: [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const getWsUrl = (exchange: string) => {
    const ex = EXCHANGES.find(e => e.id === exchange);
    return ex?.url || EXCHANGES[0].url;
  };

  // Fetch available symbols for all exchanges from backend API
  useEffect(() => {
    const fetchAllSymbols = async () => {
      const pairs: Record<string, string[]> = { lcx: [], kraken: [], coinbase: [] };
      for (const exchange of ['lcx', 'kraken', 'coinbase']) {
        try {
          const response = await fetch(`http://127.0.0.1:8000/public/exchange-symbols?exchange=${exchange}`);
          if (response.ok) {
            const data = await response.json();
            pairs[exchange] = data.symbols || [];
            console.log(`[SYMBOLS] ${exchange}: ${data.symbols?.length || 0} pairs`);
          }
        } catch (err) {
          console.error(`[SYMBOLS] Failed to fetch for ${exchange}:`, err);
        }
      }
      if (isMountedRef.current) {
        setExchangePairs(pairs);
      }
    };

    fetchAllSymbols();
  }, []);


  // Convert symbol based on exchange format rules
  const convertSymbolForExchange = (symbol: string, exchange: string): string => {
    const [base, quote] = symbol.split('/');
    if (!quote) return symbol;

    // Kraken: Only USD, EUR, GBP (no USDC)
    if (exchange === 'kraken') {
      if (quote === 'USDC') return `${base}/USD`;
      if (quote === 'USDT') return `${base}/USD`;
      return symbol;
    }

    // Coinbase: Can handle USDC/USD
    if (exchange === 'coinbase') {
      // Coinbase uses dashes instead of slashes internally, but API accepts slashes
      return symbol;
    }

    // LCX: Uses standard format
    return symbol;
  };

  // Fetch comparison data with symbol conversion per exchange
  const fetchComparisonData = async (pair: string) => {
    if (!pair) return;
    setComparisonLoading(true);
    try {
      const results: ExchangeOrderbook[] = [];
      for (const exchange of EXCHANGES) {
        try {
          // Convert symbol to exchange format
          const exchangeSymbol = convertSymbolForExchange(pair, exchange.id);
          console.log(`[COMPARISON] ${exchange.id}: ${pair} → ${exchangeSymbol}`);

          const response = await fetch(
            `http://127.0.0.1:8000/public/orderbook-ws?exchange=${exchange.id}&symbol=${encodeURIComponent(exchangeSymbol)}`
          );
          if (response.ok) {
            const data = await response.json();
            results.push({
              exchange: exchange.id,
              symbol: exchangeSymbol,
              bestBid: data.bestBid || 0,
              bestAsk: data.bestAsk || 0,
              spread: data.spread || 0,
              midpoint: data.midpoint || 0,
              timestamp: data.timestamp || Date.now(),
            });
          } else {
            results.push({
              exchange: exchange.id,
              symbol: exchangeSymbol,
              bestBid: 0,
              bestAsk: 0,
              spread: 0,
              midpoint: 0,
              timestamp: Date.now(),
              error: `Not available`,
            });
          }
        } catch (err) {
          results.push({
            exchange: exchange.id,
            symbol: pair,
            bestBid: 0,
            bestAsk: 0,
            spread: 0,
            midpoint: 0,
            timestamp: Date.now(),
            error: `Failed`,
          });
        }
      }
      if (isMountedRef.current) {
        setComparisonData(results);
      }
    } finally {
      if (isMountedRef.current) {
        setComparisonLoading(false);
      }
    }
  };

  // Don't use hardcoded defaults - each exchange has different pairs!
  // Let fetchAvailablePairs() select the first real pair from the backend

  // Get filtered pairs based on search input
  const filteredPairs = availablePairs.filter(pair =>
    pair.toLowerCase().includes(pairSearch.toLowerCase())
  );

  // Handle pair search input change
  const handlePairSearchChange = (value: string) => {
    setPairSearch(value);
    setShowPairSuggestions(true);
  };

  // Handle pair selection from suggestions
  const handlePairSelect = (pair: string) => {
    setSelectedPair(pair);
    setPairSearch(pair);
    setShowPairSuggestions(false);
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
      }
    };
  }, []);

  // Fetch available pairs for the selected exchange
  useEffect(() => {
    fetchAvailablePairs();
  }, [selectedExchange]);

  // Connect to WebSocket for live data only
  useEffect(() => {
    isMountedRef.current = true;

    if (!selectedPair || !selectedExchange) return;

    connectWebSocket();

    return () => {
      isMountedRef.current = false;

      // Clear all pending timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }

      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [selectedPair, selectedExchange]);

  const getDefaultPair = (exchange: string, availablePairs: string[]): string => {
    // Only use pairs that definitely exist on each exchange
    // Note: all APIs return pairs in "/" format, conversion to "-" happens in getSubscribeMessage
    const defaults: Record<string, string[]> = {
      lcx: ['LCX/USDC'],
      kraken: ['BTC/USD', 'XBT/USD'],
      coinbase: ['BTC/USD', 'ETH/USD'],
    };

    const exchangeDefaults = defaults[exchange] || [];
    for (const defaultPair of exchangeDefaults) {
      if (availablePairs.includes(defaultPair)) {
        console.log(`[PAIRS] ${exchange}: Using default pair: ${defaultPair}`);
        return defaultPair;
      }
    }

    // If default not found, return empty (let user choose from dropdown)
    console.log(`[PAIRS] ${exchange}: Default not found, let user select from dropdown`);
    return '';
  };

  const fetchAvailablePairs = async () => {
    setPairsLoading(true);
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/public/exchange-symbols?exchange=${selectedExchange}`
      );

      if (response.ok) {
        const data = await response.json();
        const pairs = data.symbols || [];
        setAvailablePairs(pairs);

        // Get exchange-specific default pair
        const defaultPair = getDefaultPair(selectedExchange, pairs);
        console.log(`[PAIRS] ${selectedExchange}: Found ${pairs.length} pairs:`, pairs.slice(0, 5));
        setSelectedPair(defaultPair);
      } else {
        console.error(`[PAIRS] Failed to fetch ${selectedExchange} pairs: HTTP ${response.status}`);
        setAvailablePairs([]);
        setSelectedPair('');
      }
    } catch (err) {
      console.error('[PAIRS] Error fetching pairs:', err);
      setAvailablePairs([]);
      setSelectedPair('');
    } finally {
      setPairsLoading(false);
    }
  };

  const getSubscribeMessage = (exchange: string, pair: string): string => {
    switch (exchange) {
      case 'lcx':
        // LCX expects format like: LCX/USDC
        return JSON.stringify({
          Topic: 'subscribe',
          Type: 'orderbook',
          Pair: pair,
        });
      case 'kraken':
        // Kraken v2 API format - uses proper JSON objects
        // Pair can be like "BTC/USD" from backend
        const krakenSymbol = pair.includes('/') ? pair : pair;  // Already in correct format
        return JSON.stringify({
          method: 'subscribe',
          params: {
            channel: 'book',
            symbol: [krakenSymbol],
            depth: 25,
            snapshot: true,
          },
        });
      case 'coinbase':
        // Coinbase level2 requires API authentication (not suitable for public WebSocket)
        // Fall back to ticker channel which is public and doesn't require auth
        // Note: ticker shows price/volume updates but not full orderbook depth
        let coinbasePair: string;
        if (pair.includes('/')) {
          coinbasePair = pair.replace('/', '-');
        } else {
          coinbasePair = pair;
        }
        return JSON.stringify({
          type: 'subscribe',
          product_ids: [coinbasePair],
          channels: ['ticker'],  // Public channel - no auth required
        });
      default:
        return '';
    }
  };

  const connectWebSocket = () => {
    // Don't connect if component unmounted or if connection already exists
    if (!isMountedRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const wsUrl = getWsUrl(selectedExchange);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close();
          return;
        }

        console.log(`[WS] Connected to ${selectedExchange} - ${selectedPair}`);
        // Subscribe to orderbook updates with exchange-specific format
        const subscribeMsg = getSubscribeMessage(selectedExchange, selectedPair);
        console.log(`[WS] Sending subscribe (${selectedExchange}):`, subscribeMsg);
        ws.send(subscribeMsg);

        setOrderbook((prev) => ({
          ...prev,
          isConnected: true,
          status: `WebSocket Connected - ${prev.bids.length} bids, ${prev.asks.length} asks`,
        }));
      };

      ws.onmessage = (event) => {
        // Ignore messages if component unmounted or WebSocket changed
        if (!isMountedRef.current || wsRef.current !== ws) {
          return;
        }

        try {
          // Handle plain text messages (like "Subscribed")
          if (typeof event.data === 'string' && !event.data.startsWith('{')) {
            console.log('[WS] Plain text message:', event.data);
            return;
          }

          const data = JSON.parse(event.data);
          console.log(`[WS-${selectedExchange.toUpperCase()}] Raw message:`, JSON.stringify(data).substring(0, 200));

          // ============ LCX Messages ============
          if (data.type === 'orderbook' && data.topic === 'snapshot') {
            console.log('[WS] LCX snapshot received');
            // LCX snapshot
            const bids = (data.data?.buy || []).map((b: any) => ({
              price: typeof b === 'object' ? b[0] : b,
              amount: typeof b === 'object' ? b[1] : 0,
            }));
            const asks = (data.data?.sell || []).map((a: any) => ({
              price: typeof a === 'object' ? a[0] : a,
              amount: typeof a === 'object' ? a[1] : 0,
            }));

            const bestBid = bids[0]?.price || 0;
            const bestAsk = asks[0]?.price || 0;
            const spread = bestAsk - bestBid;
            const midpoint = (bestBid + bestAsk) / 2;

            setOrderbook({
              pair: selectedPair,
              bids,
              asks,
              spread,
              midpoint,
              lastUpdate: Date.now(),
              isConnected: true,
              status: `Live - ${bids.length} bids, ${asks.length} asks`,
            });
          }
          // LCX update (delta)
          else if (data.type === 'orderbook' && data.topic === 'update') {
            setOrderbook((prev) => {
              let updatedBids = [...prev.bids];
              let updatedAsks = [...prev.asks];

              if (Array.isArray(data.data)) {
                data.data.forEach((item: any) => {
                  if (Array.isArray(item) && item.length === 3) {
                    const price = item[0];
                    const amount = item[1];
                    const side = String(item[2]).toUpperCase();

                    if (side === 'BUY') {
                      const idx = updatedBids.findIndex(bid => bid.price === price);
                      if (idx >= 0) {
                        if (amount > 0) {
                          updatedBids[idx].amount = amount;
                        } else {
                          updatedBids.splice(idx, 1);
                        }
                      } else if (amount > 0) {
                        updatedBids.push({ price, amount });
                      }
                    } else if (side === 'SELL') {
                      const idx = updatedAsks.findIndex(ask => ask.price === price);
                      if (idx >= 0) {
                        if (amount > 0) {
                          updatedAsks[idx].amount = amount;
                        } else {
                          updatedAsks.splice(idx, 1);
                        }
                      } else if (amount > 0) {
                        updatedAsks.push({ price, amount });
                      }
                    }
                  }
                });
              } else if (data.data?.buy || data.data?.sell) {
                if (data.data?.buy) {
                  data.data.buy.forEach((b: any) => {
                    const price = typeof b === 'object' ? b[0] : b;
                    const amount = typeof b === 'object' ? b[1] : 0;
                    const idx = updatedBids.findIndex(bid => bid.price === price);
                    if (idx >= 0) {
                      if (amount > 0) {
                        updatedBids[idx].amount = amount;
                      } else {
                        updatedBids.splice(idx, 1);
                      }
                    } else if (amount > 0) {
                      updatedBids.push({ price, amount });
                    }
                  });
                }

                if (data.data?.sell) {
                  data.data.sell.forEach((a: any) => {
                    const price = typeof a === 'object' ? a[0] : a;
                    const amount = typeof a === 'object' ? a[1] : 0;
                    const idx = updatedAsks.findIndex(ask => ask.price === price);
                    if (idx >= 0) {
                      if (amount > 0) {
                        updatedAsks[idx].amount = amount;
                      } else {
                        updatedAsks.splice(idx, 1);
                      }
                    } else if (amount > 0) {
                      updatedAsks.push({ price, amount });
                    }
                  });
                }
              }

              updatedBids.sort((a, b) => b.price - a.price);
              updatedAsks.sort((a, b) => a.price - b.price);

              const bestBid = updatedBids[0]?.price || 0;
              const bestAsk = updatedAsks[0]?.price || 0;
              const spread = bestAsk - bestBid;
              const midpoint = (bestBid + bestAsk) / 2;

              return {
                ...prev,
                bids: updatedBids,
                asks: updatedAsks,
                spread,
                midpoint,
                lastUpdate: Date.now(),
                status: `Live - Updated`,
              };
            });
          }
          // LCX ping
          else if (data.Topic === 'ping') {
            ws.send(JSON.stringify({ Topic: 'pong' }));
          }

          // ============ Kraken Heartbeat (ignore) ============
          else if (data.channel === 'heartbeat') {
            // Keep-alive message - no action needed
            return;
          }

          // ============ Kraken Messages (v2 API - JSON objects) ============
          else if (data.channel === 'book' && (data.type === 'snapshot' || data.type === 'update')) {
            const bookData = Array.isArray(data.data) && data.data[0];
            console.log(`[WS] Kraken ${data.type}:`, {
              symbol: bookData?.symbol,
              bids: bookData?.bids?.length || 0,
              asks: bookData?.asks?.length || 0,
            });

            if (data.type === 'snapshot' && Array.isArray(data.data)) {
              // Process snapshot data
              const bookData = data.data[0];
              if (bookData && bookData.bids && bookData.asks) {
                const bids = bookData.bids.map((b: any) => ({
                  price: parseFloat(b.price),
                  amount: parseFloat(b.qty),
                }));
                const asks = bookData.asks.map((a: any) => ({
                  price: parseFloat(a.price),
                  amount: parseFloat(a.qty),
                }));

                const bestBid = bids[0]?.price || 0;
                const bestAsk = asks[0]?.price || 0;
                const spread = bestAsk - bestBid;
                const midpoint = (bestBid + bestAsk) / 2;

                setOrderbook({
                  pair: selectedPair,
                  bids,
                  asks,
                  spread,
                  midpoint,
                  lastUpdate: Date.now(),
                  isConnected: true,
                  status: `Live - ${bids.length} bids, ${asks.length} asks`,
                });
              }
            } else if (data.type === 'update' && Array.isArray(data.data)) {
              // Process delta updates
              const bookData = data.data[0];
              if (bookData) {
                setOrderbook((prev) => {
                  let updatedBids = [...prev.bids];
                  let updatedAsks = [...prev.asks];

                  // Update bids
                  if (bookData.bids && Array.isArray(bookData.bids)) {
                    bookData.bids.forEach((bid: any) => {
                      const price = parseFloat(bid.price);
                      const amount = parseFloat(bid.qty);
                      const idx = updatedBids.findIndex(b => b.price === price);
                      if (idx >= 0) {
                        if (amount > 0) {
                          updatedBids[idx].amount = amount;
                        } else {
                          updatedBids.splice(idx, 1);
                        }
                      } else if (amount > 0) {
                        updatedBids.push({ price, amount });
                      }
                    });
                  }

                  // Update asks
                  if (bookData.asks && Array.isArray(bookData.asks)) {
                    bookData.asks.forEach((ask: any) => {
                      const price = parseFloat(ask.price);
                      const amount = parseFloat(ask.qty);
                      const idx = updatedAsks.findIndex(a => a.price === price);
                      if (idx >= 0) {
                        if (amount > 0) {
                          updatedAsks[idx].amount = amount;
                        } else {
                          updatedAsks.splice(idx, 1);
                        }
                      } else if (amount > 0) {
                        updatedAsks.push({ price, amount });
                      }
                    });
                  }

                  updatedBids.sort((a, b) => b.price - a.price);
                  updatedAsks.sort((a, b) => a.price - b.price);

                  const bestBid = updatedBids[0]?.price || 0;
                  const bestAsk = updatedAsks[0]?.price || 0;
                  const spread = bestAsk - bestBid;
                  const midpoint = (bestBid + bestAsk) / 2;

                  return {
                    ...prev,
                    bids: updatedBids,
                    asks: updatedAsks,
                    spread,
                    midpoint,
                    lastUpdate: Date.now(),
                    status: `Live - Updated`,
                  };
                });
              }
            }
          }

          // ============ Coinbase Messages (ticker - public channel, no auth needed) ============
          // Note: ticker channel shows price updates only, not full orderbook depth
          // For full orderbook (level2), authentication would be required
          else if (data.type === 'ticker' && data.product_id && data.price) {
            // Ticker update - create synthetic bid/ask from current price
            console.log('[WS] Coinbase ticker update:', {
              product: data.product_id,
              price: data.price,
              volume_24h: data.volume_24h,
            });

            const price = parseFloat(data.price);
            const volume = data.volume_24h ? parseFloat(data.volume_24h) : 0;

            // Create synthetic bid/ask around the ticker price (15 levels each side)
            // Use percentage-based increments (0.1% per level) to handle both large and small prices
            const syntheticBids = [];
            const syntheticAsks = [];

            // Generate 15 bid levels below the current price (0.1% increments)
            for (let i = 1; i <= 15; i++) {
              const percentDecrement = (i * 0.001); // 0.1% per level
              const levelPrice = price * (1 - percentDecrement);
              const amount = (volume / 30) * (16 - i); // Decrease volume further from midpoint
              syntheticBids.push({ price: Math.max(0, levelPrice), amount }); // Prevent negative prices
            }

            // Generate 15 ask levels above the current price (0.1% increments)
            for (let i = 1; i <= 15; i++) {
              const percentIncrement = (i * 0.001); // 0.1% per level
              const levelPrice = price * (1 + percentIncrement);
              const amount = (volume / 30) * (16 - i); // Decrease volume further from midpoint
              syntheticAsks.push({ price: levelPrice, amount });
            }

            const spread = 1;
            const midpoint = price;

            setOrderbook({
              pair: selectedPair,
              bids: syntheticBids,
              asks: syntheticAsks,
              spread,
              midpoint,
              lastUpdate: Date.now(),
              isConnected: true,
              status: `Ticker Mode (Public) - Price: ${formatPrice(price)}`,
            });
          }
          // Subscription acknowledgment
          else if (data.type === 'subscriptions') {
            console.log('[WS] Coinbase subscription confirmed:', data.channels);
          }
          // Error messages
          else if (data.type === 'error') {
            console.log('[WS] Coinbase error:', data.message, '-', data.reason);
            setOrderbook((prev) => ({
              ...prev,
              isConnected: false,
              status: `Coinbase Error: ${data.message}`,
            }));
          } else {
            console.log('[WS] No handler matched!', {
              isArray: Array.isArray(data),
              length: Array.isArray(data) ? data.length : 'N/A',
              keys: !Array.isArray(data) ? Object.keys(data) : 'array',
              sample: typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : data,
            });
          }
        } catch (err) {
          console.error('[WS] Message parse error:', err, 'Raw data:', event.data);
        }
      };

      ws.onerror = (event) => {
        console.error('[WS] Error:', event);
        if (isMountedRef.current) {
          setOrderbook((prev) => ({
            ...prev,
            isConnected: false,
            status: 'WebSocket error - reconnecting...',
          }));
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        // Only update state and reconnect if component still mounted
        if (isMountedRef.current) {
          setOrderbook((prev) => ({
            ...prev,
            isConnected: false,
            status: 'Disconnected - reconnecting in 3s...',
          }));

          // Attempt to reconnect after 3 seconds (only if still mounted)
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              connectWebSocket();
            }
          }, 3000);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[WS] Connection error:', err);
      setOrderbook((prev) => ({
        ...prev,
        isConnected: false,
        status: 'Failed to connect - showing REST data',
      }));
    }
  };

  const getConnectionIndicator = () => {
    if (orderbook.isConnected) {
      return <span className="status-indicator connected">● Live</span>;
    }
    return <span className="status-indicator disconnected">● Connecting...</span>;
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 8,
    }).format(amount);
  };

  const calculateDepthPercentage = (levels: PriceLevel[], index: number) => {
    if (!levels.length) return 0;
    const maxAmount = Math.max(...levels.map((l) => l.amount));
    return (levels[index].amount / maxAmount) * 100;
  };

  const totalBidAmount = orderbook.bids.reduce((sum, level) => sum + level.amount, 0);
  const totalAskAmount = orderbook.asks.reduce((sum, level) => sum + level.amount, 0);

  return (
    <div className="orderbook-ws-page">
      {/* Header */}
      <div className="orderbook-header">
        <h1>Live Orderbook</h1>
        <div className="header-controls">
          <div className="pair-selector">
            <label>Exchange:</label>
            <select value={selectedExchange} onChange={(e) => setSelectedExchange(e.target.value)}>
              {EXCHANGES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          <div className="pair-selector" style={{ position: 'relative' }}>
            <label>Trading Pair:</label>
            <input
              type="text"
              placeholder={pairsLoading ? 'Loading pairs...' : 'Search pair (e.g., BTC/USD)'}
              value={pairSearch}
              onChange={(e) => handlePairSearchChange(e.target.value)}
              disabled={pairsLoading || availablePairs.length === 0}
              style={{
                padding: '8px 12px',
                border: '1px solid #555',
                borderRadius: '4px',
                background: '#2a2a2a',
                color: '#fff',
                fontSize: '14px',
                width: '200px',
              }}
              onFocus={() => setShowPairSuggestions(true)}
              onBlur={() => setTimeout(() => setShowPairSuggestions(false), 200)}
            />
            {showPairSuggestions && filteredPairs.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: '#2a2a2a',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  zIndex: 10,
                  width: '200px',
                  marginTop: '4px',
                }}
              >
                {filteredPairs.map((pair) => (
                  <div
                    key={pair}
                    onClick={() => handlePairSelect(pair)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #444',
                      color: selectedPair === pair ? '#4ade80' : '#aaa',
                      background: selectedPair === pair ? '#3a3a3a' : 'transparent',
                      ':hover': { background: '#3a3a3a' },
                    }}
                    onMouseDown={() => handlePairSelect(pair)}
                  >
                    {pair}
                  </div>
                ))}
              </div>
            )}
          </div>
          {getConnectionIndicator()}
        </div>
      </div>

      {/* Single Exchange View */}
          {/* Stats Cards */}
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-label">Best Bid</div>
          <div className="stat-value bid-price">
            {orderbook.bids.length > 0 ? formatPrice(orderbook.bids[0].price) : '—'}
          </div>
          <div className="stat-subtext">
            {orderbook.bids.length > 0 ? formatAmount(orderbook.bids[0].amount) : ''}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Spread</div>
          <div className="stat-value spread-value">
            {orderbook.spread !== null ? formatPrice(orderbook.spread) : '—'}
          </div>
          <div className="stat-subtext">
            {orderbook.spread !== null && orderbook.bids[0]
              ? ((orderbook.spread / orderbook.bids[0].price) * 100).toFixed(3) + '%'
              : ''}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Midpoint</div>
          <div className="stat-value midpoint-value">
            {orderbook.midpoint !== null ? formatPrice(orderbook.midpoint) : '—'}
          </div>
          <div className="stat-subtext">
            {orderbook.lastUpdate > 0 ? new Date(orderbook.lastUpdate).toLocaleTimeString() : ''}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Best Ask</div>
          <div className="stat-value ask-price">
            {orderbook.asks.length > 0 ? formatPrice(orderbook.asks[0].price) : '—'}
          </div>
          <div className="stat-subtext">
            {orderbook.asks.length > 0 ? formatAmount(orderbook.asks[0].amount) : ''}
          </div>
        </div>
      </div>

      {/* Main Orderbook Display */}
      <div className="orderbook-container">
        {/* Buy Side (Bids) */}
        <div className="orderbook-side bids-side">
          <div className="side-header">
            <h3>Buy Orders (Bids)</h3>
            <span className="total-amount">Total: {formatAmount(totalBidAmount)}</span>
          </div>
          <table className="orderbook-table">
            <thead>
              <tr>
                <th>Price</th>
                <th>Amount</th>
                <th>Total</th>
                <th>Depth</th>
              </tr>
            </thead>
            <tbody>
              {orderbook.bids.length > 0 ? (
                orderbook.bids.map((level, idx) => (
                  <tr key={idx} className="bid-row">
                    <td className="price-cell bid-price">{formatPrice(level.price)}</td>
                    <td className="amount-cell">{formatAmount(level.amount)}</td>
                    <td className="total-cell">{formatPrice(level.price * level.amount)}</td>
                    <td className="depth-cell">
                      <div className="depth-bar">
                        <div
                          className="depth-fill buy"
                          style={{
                            width: `${calculateDepthPercentage(orderbook.bids, idx)}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                    No bids data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sell Side (Asks) */}
        <div className="orderbook-side asks-side">
          <div className="side-header">
            <h3>Sell Orders (Asks)</h3>
            <span className="total-amount">Total: {formatAmount(totalAskAmount)}</span>
          </div>
          <table className="orderbook-table">
            <thead>
              <tr>
                <th>Price</th>
                <th>Amount</th>
                <th>Total</th>
                <th>Depth</th>
              </tr>
            </thead>
            <tbody>
              {orderbook.asks.length > 0 ? (
                orderbook.asks.map((level, idx) => (
                  <tr key={idx} className="ask-row">
                    <td className="price-cell ask-price">{formatPrice(level.price)}</td>
                    <td className="amount-cell">{formatAmount(level.amount)}</td>
                    <td className="total-cell">{formatPrice(level.price * level.amount)}</td>
                    <td className="depth-cell">
                      <div className="depth-bar">
                        <div
                          className="depth-fill sell"
                          style={{
                            width: `${calculateDepthPercentage(orderbook.asks, idx)}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                    No asks data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status Footer */}
      <div className="orderbook-footer">
        <span className="status-text">{orderbook.status}</span>
      </div>
    </div>
  );
};
