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
  status: 'Loading...',
};

const EXCHANGES = [
  { id: 'lcx', name: 'LCX', url: 'wss://exchange-api.lcx.com/ws' },
  { id: 'kraken', name: 'Kraken', url: 'wss://ws.kraken.com/v2' },
  { id: 'coinbase', name: 'Coinbase', url: 'wss://ws-feed.exchange.coinbase.com' },
];

export const OrderbookAggregatesPage: React.FC = () => {
  const { token } = useAuth();
  const [selectedPair, setSelectedPair] = useState('');
  const [pairSearch, setPairSearch] = useState('');
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [showPairSuggestions, setShowPairSuggestions] = useState(false);
  const [pairsLoading, setPairsLoading] = useState(false);

  // Exchange selection (LCX on by default)
  const [selectedExchanges, setSelectedExchanges] = useState<Record<string, boolean>>({
    lcx: true,
    kraken: false,
    coinbase: false,
  });

  // Orderbooks for each exchange
  const [orderbooks, setOrderbooks] = useState<Record<string, OrderbookState>>({
    lcx: DEFAULT_ORDERBOOK,
    kraken: DEFAULT_ORDERBOOK,
    coinbase: DEFAULT_ORDERBOOK,
  });

  const [exchangePairs, setExchangePairs] = useState<Record<string, string[]>>({
    lcx: [],
    kraken: [],
    coinbase: [],
  });

  const isMountedRef = useRef(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch available symbols for all exchanges
  useEffect(() => {
    const fetchAllSymbols = async () => {
      try {
        console.log('====== STARTING PAIR FETCH ======');
        setPairsLoading(true);
        const pairs: Record<string, string[]> = { lcx: [], kraken: [], coinbase: [] };

        for (const exchange of ['lcx', 'kraken', 'coinbase']) {
          try {
            console.log(`\n[${exchange.toUpperCase()}] Starting fetch...`);

            // Use direct URL to backend
            const url = `http://127.0.0.1:8000/public/exchange-symbols?exchange=${exchange}`;
            console.log(`[${exchange.toUpperCase()}] Attempting: ${url}`);
            const response = await fetch(url);
            console.log(`[${exchange.toUpperCase()}] Response status: ${response.status} (${response.statusText})`);

            if (!response.ok) {
              console.error(`[${exchange.toUpperCase()}] ❌ Failed with HTTP ${response.status}`);
              continue;
            }

            const data = await response.json();
            console.log(`[${exchange.toUpperCase()}] Full response:`, JSON.stringify(data));
            console.log(`[${exchange.toUpperCase()}] data.symbols:`, data.symbols);
            console.log(`[${exchange.toUpperCase()}] data.symbols type:`, typeof data.symbols);
            console.log(`[${exchange.toUpperCase()}] data.symbols is array:`, Array.isArray(data.symbols));

            pairs[exchange] = data.symbols || [];
            console.log(`[${exchange.toUpperCase()}] ✅ Loaded ${pairs[exchange].length} pairs (final check)`);
          } catch (err) {
            console.error(`[${exchange.toUpperCase()}] ❌ Network error:`, err);
          }
        }

        console.log('\n[SUMMARY] Pairs by exchange:', pairs);

        // Update state directly - no need for mounted check in this specific effect
        setExchangePairs(pairs);

        // Get all unique pairs
        const allPairs = new Set<string>();
        Object.values(pairs).forEach(p => p.forEach(pair => allPairs.add(pair)));
        const uniquePairs = Array.from(allPairs).sort();
        console.log(`[SUMMARY] Total unique pairs: ${uniquePairs.length}`);
        console.log(`[SUMMARY] First 10 pairs: ${uniquePairs.slice(0, 10).join(', ')}`);
        setAvailablePairs(uniquePairs);
        console.log('====== PAIR FETCH COMPLETE ======\n');
      } catch (err) {
        console.error('[SYMBOLS] Unexpected error:', err);
      } finally {
        // Always set loading to false, even if fetch fails
        setPairsLoading(false);
      }
    };

    fetchAllSymbols();
  }, []);

  // Convert symbol for exchange
  const convertSymbolForExchange = (symbol: string, exchange: string): string => {
    // Normalize: convert dashes to slashes first
    const normalized = symbol.replace('-', '/');
    const [base, quote] = normalized.split('/');
    if (!quote) return symbol;

    if (exchange === 'kraken') {
      if (quote === 'USDC') return `${base}/USD`;
      if (quote === 'USDT') return `${base}/USD`;
      return normalized;
    }

    if (exchange === 'coinbase') {
      // Coinbase uses dashes: BTC-USD
      return `${base}-${quote}`;
    }

    if (exchange === 'lcx') {
      // LCX uses slashes: BTC/EUR
      return normalized;
    }

    return normalized;
  };

  // Fetch orderbook for a specific exchange
  const fetchOrderbookForExchange = async (exchange: string, pair: string) => {
    try {
      const exchangeSymbol = convertSymbolForExchange(pair, exchange);
      const response = await fetch(
        `http://127.0.0.1:8000/public/orderbook?exchange=${exchange}&symbol=${encodeURIComponent(exchangeSymbol)}`
      );

      if (response.ok) {
        const data = await response.json();
        const bestBid = data.bestBid || 0;
        const bestAsk = data.bestAsk || 0;
        const spread = data.spread || 0;
        const midpoint = data.midpoint || 0;

        setOrderbooks(prev => ({
          ...prev,
          [exchange]: {
            pair,
            bids: data.bids || [],
            asks: data.asks || [],
            spread,
            midpoint,
            lastUpdate: Date.now(),
            isConnected: true,
            status: `Live - ${(data.bids || []).length} bids, ${(data.asks || []).length} asks`,
          },
        }));
      } else {
        setOrderbooks(prev => ({
          ...prev,
          [exchange]: {
            ...DEFAULT_ORDERBOOK,
            pair,
            status: `Failed to fetch ${exchange} data`,
          },
        }));
      }
    } catch (err) {
      console.error(`[${exchange}] Error:`, err);
      setOrderbooks(prev => ({
        ...prev,
        [exchange]: {
          ...DEFAULT_ORDERBOOK,
          pair,
          status: `Error: ${String(err)}`,
        },
      }));
    }
  };

  // Fetch data for all selected exchanges
  const fetchAllOrderbooks = async (pair: string) => {
    if (!pair) return;

    for (const [exchange, isSelected] of Object.entries(selectedExchanges)) {
      if (isSelected) {
        await fetchOrderbookForExchange(exchange, pair);
      }
    }
  };

  // Auto-refresh when pair changes
  useEffect(() => {
    if (!selectedPair) return;

    fetchAllOrderbooks(selectedPair);

    // Refresh every 3 seconds
    refreshIntervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        fetchAllOrderbooks(selectedPair);
      }
    }, 3000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [selectedPair, selectedExchanges]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  const filteredPairs = availablePairs.filter(pair =>
    pair.toLowerCase().includes(pairSearch.toLowerCase())
  );

  const handlePairSelect = (pair: string) => {
    setSelectedPair(pair);
    setPairSearch(pair);
    setShowPairSuggestions(false);
  };

  const handleExchangeToggle = (exchange: string) => {
    setSelectedExchanges(prev => ({
      ...prev,
      [exchange]: !prev[exchange],
    }));
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


  return (
    <div className="orderbook-ws-page">
      {/* Header */}
      <div className="orderbook-header">
        <h1>Aggregated Orderbook - Multi-Exchange</h1>
        {/* Debug Info */}
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px', padding: '4px' }}>
          Pairs loaded: {availablePairs.length} | Loading: {pairsLoading ? 'Yes' : 'No'}
        </div>
        <div className="header-controls" style={{ flexWrap: 'wrap', gap: '16px' }}>
          {/* Exchange Checkboxes */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <label style={{ color: '#ccc', fontWeight: 'bold' }}>Exchanges:</label>
            {EXCHANGES.map((ex) => (
              <label
                key={ex.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#aaa',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedExchanges[ex.id] || false}
                  onChange={() => handleExchangeToggle(ex.id)}
                  style={{ cursor: 'pointer' }}
                />
                {ex.name}
              </label>
            ))}
          </div>

          {/* Pair Selector */}
          <div style={{ position: 'relative' }}>
            <label style={{ display: 'block', marginBottom: '4px', color: '#ccc' }}>
              Trading Pair:
              {availablePairs.length === 0 && !pairsLoading && (
                <span style={{ color: '#f87171', marginLeft: '8px', fontSize: '12px' }}>❌ No pairs loaded</span>
              )}
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <input
                type="text"
                placeholder={pairsLoading ? 'Loading pairs...' : availablePairs.length === 0 ? 'Pairs failed to load' : 'Search pair (e.g., BTC/USD)'}
                value={pairSearch}
                onChange={(e) => {
                  setPairSearch(e.target.value);
                  setShowPairSuggestions(true);
                }}
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
            </div>
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
                    }}
                    onMouseDown={() => handlePairSelect(pair)}
                  >
                    {pair}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Exchange Cards */}
      <div style={{ padding: '16px' }}>
        {!selectedPair ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px' }}>
            Select a pair to view orderbooks
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {Object.entries(selectedExchanges)
              .filter(([_, isSelected]) => isSelected)
              .map(([exchangeId]) => {
                const exchange = EXCHANGES.find(e => e.id === exchangeId);
                const ob = orderbooks[exchangeId];
                // Limit to 15 orders each
                // Asks: ascending (lowest first)
                const askLevels = [...ob.asks].sort((a, b) => a.price - b.price).slice(0, 25);
                // Bids: descending (highest first)
                const bidLevels = [...ob.bids].sort((a, b) => b.price - a.price).slice(0, 25);

                return (
                  <div
                    key={exchangeId}
                    style={{
                      border: '1px solid #444',
                      borderRadius: '8px',
                      padding: '12px',
                      background: '#1a1a1a',
                      display: 'flex',
                      flexDirection: 'column',
                      maxHeight: '300px',
                      overflowY: 'auto',
                    }}
                  >
                    {/* Exchange Title */}
                    <h3 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '16px', fontWeight: 'bold' }}>
                      {exchange?.name}
                    </h3>

                    {/* Stats in 2x2 grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginBottom: '10px' }}>
                      <div style={{ background: '#2a2a2a', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                        <div style={{ color: '#999', fontSize: '11px' }}>Bid</div>
                        <div style={{ color: '#4ade80', fontSize: '12px', fontWeight: 'bold' }}>
                          {ob.bids.length > 0 ? formatPrice(ob.bids[0].price) : '—'}
                        </div>
                      </div>
                      <div style={{ background: '#2a2a2a', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                        <div style={{ color: '#999', fontSize: '11px' }}>Ask</div>
                        <div style={{ color: '#f87171', fontSize: '12px', fontWeight: 'bold' }}>
                          {ob.asks.length > 0 ? formatPrice(ob.asks[0].price) : '—'}
                        </div>
                      </div>
                      <div style={{ background: '#2a2a2a', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                        <div style={{ color: '#999', fontSize: '11px' }}>Spread</div>
                        <div style={{ color: '#60a5fa', fontSize: '12px', fontWeight: 'bold' }}>
                          {ob.spread !== null ? formatPrice(ob.spread) : '—'}
                        </div>
                      </div>
                      <div style={{ background: '#2a2a2a', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                        <div style={{ color: '#999', fontSize: '11px' }}>Mid</div>
                        <div style={{ color: '#fbbf24', fontSize: '12px', fontWeight: 'bold' }}>
                          {ob.midpoint !== null ? formatPrice(ob.midpoint) : '—'}
                        </div>
                      </div>
                    </div>

                    {/* Asks & Bids - Side by Side */}
                    <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
                      {/* Asks Table - Left */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h5 style={{ margin: '0 0 2px 0', color: '#f87171', fontSize: '10px' }}>
                          ASKS
                        </h5>
                        <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                          <tbody>
                            {askLevels.length > 0 ? (
                              askLevels.slice(0, 5).map((level, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid #2a2a2a', color: '#f87171' }}>
                                  <td style={{ padding: '1px 2px', textAlign: 'left' }}>{formatPrice(level.price)}</td>
                                  <td style={{ padding: '1px 2px', textAlign: 'right', fontSize: '9px' }}>{formatAmount(level.amount)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={2} style={{ padding: '2px', textAlign: 'center', color: '#666', fontSize: '9px' }}>
                                  —
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Bids Table - Right */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h5 style={{ margin: '0 0 2px 0', color: '#4ade80', fontSize: '10px' }}>
                          BIDS
                        </h5>
                        <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                          <tbody>
                            {bidLevels.length > 0 ? (
                              bidLevels.slice(0, 5).map((level, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid #2a2a2a', color: '#4ade80' }}>
                                  <td style={{ padding: '1px 2px', textAlign: 'left' }}>{formatPrice(level.price)}</td>
                                  <td style={{ padding: '1px 2px', textAlign: 'right', fontSize: '9px' }}>{formatAmount(level.amount)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={2} style={{ padding: '2px', textAlign: 'center', color: '#666', fontSize: '9px' }}>
                                  —
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Status */}
                    <div style={{ fontSize: '10px', color: '#666', marginTop: '6px', borderTop: '1px solid #333', paddingTop: '4px' }}>
                      {ob.status}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="orderbook-footer">
        <span className="status-text">
          {selectedPair ? `Showing ${Object.values(selectedExchanges).filter(v => v).length} exchanges for ${selectedPair}` : 'No pair selected'}
        </span>
      </div>
    </div>
  );
};
