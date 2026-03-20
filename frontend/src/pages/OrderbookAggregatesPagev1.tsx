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

  const calculateDepthPercentage = (levels: PriceLevel[], index: number) => {
    if (!levels.length) return 0;
    const maxAmount = Math.max(...levels.map((l) => l.amount));
    return (levels[index].amount / maxAmount) * 100;
  };

  const getTimeSinceUpdate = (timestamp: number) => {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
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

      {/* Exchange Cards - TALLER and MODERN */}
      <div style={{ padding: '16px' }}>
        {!selectedPair ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '60px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #444' }}>
            <div style={{ fontSize: '24px', marginBottom: '16px' }}>📊</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>Select a trading pair</div>
            <div style={{ fontSize: '14px', color: '#666' }}>Choose from {availablePairs.length} available pairs across all exchanges</div>
          </div>
        ) : (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', 
            gap: '20px' 
          }}>
            {Object.entries(selectedExchanges)
              .filter(([_, isSelected]) => isSelected)
              .map(([exchangeId]) => {
                const exchange = EXCHANGES.find(e => e.id === exchangeId);
                const ob = orderbooks[exchangeId];
                // Sort orders properly
                const askLevels = [...ob.asks].sort((a, b) => a.price - b.price);
                const bidLevels = [...ob.bids].sort((a, b) => b.price - a.price);
                
                // Calculate totals
                const totalBidVolume = bidLevels.reduce((sum, level) => sum + level.amount, 0);
                const totalAskVolume = askLevels.reduce((sum, level) => sum + level.amount, 0);

                return (
                  <div
                    key={exchangeId}
                    style={{
                      border: '1px solid #333',
                      borderRadius: '16px',
                      padding: '20px',
                      background: 'linear-gradient(145deg, #1e1e1e 0%, #1a1a1a 100%)',
                      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      height: '650px', // MUCH TALLER
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      ':hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 15px 40px rgba(0,0,0,0.6)',
                      }
                    }}
                  >
                    {/* Exchange Title with Status Indicator */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      marginBottom: '16px',
                      paddingBottom: '12px',
                      borderBottom: '1px solid #333'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: ob.isConnected ? '#4ade80' : '#f87171',
                          boxShadow: ob.isConnected ? '0 0 10px #4ade80' : 'none'
                        }} />
                        <h3 style={{ margin: 0, color: '#fff', fontSize: '20px', fontWeight: '600' }}>
                          {exchange?.name}
                        </h3>
                      </div>
                      <span style={{ fontSize: '12px', color: '#666' }}>
                        {getTimeSinceUpdate(ob.lastUpdate)}
                      </span>
                    </div>

                    {/* Modern Stats Grid */}
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(4, 1fr)', 
                      gap: '8px', 
                      marginBottom: '20px' 
                    }}>
                      <div style={{ 
                        background: 'rgba(74, 222, 128, 0.1)', 
                        padding: '10px', 
                        borderRadius: '12px',
                        textAlign: 'center'
                      }}>
                        <div style={{ color: '#4ade80', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Bid</div>
                        <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>
                          {ob.bids.length > 0 ? formatPrice(ob.bids[0].price) : '—'}
                        </div>
                      </div>
                      <div style={{ 
                        background: 'rgba(248, 113, 113, 0.1)', 
                        padding: '10px', 
                        borderRadius: '12px',
                        textAlign: 'center'
                      }}>
                        <div style={{ color: '#f87171', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ask</div>
                        <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>
                          {ob.asks.length > 0 ? formatPrice(ob.asks[0].price) : '—'}
                        </div>
                      </div>
                      <div style={{ 
                        background: 'rgba(96, 165, 250, 0.1)', 
                        padding: '10px', 
                        borderRadius: '12px',
                        textAlign: 'center'
                      }}>
                        <div style={{ color: '#60a5fa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Spread</div>
                        <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>
                          {ob.spread !== null ? formatPrice(ob.spread) : '—'}
                        </div>
                        {ob.spread !== null && ob.bids[0] && (
                          <div style={{ fontSize: '9px', color: '#666' }}>
                            {((ob.spread / ob.bids[0].price) * 100).toFixed(3)}%
                          </div>
                        )}
                      </div>
                      <div style={{ 
                        background: 'rgba(251, 191, 36, 0.1)', 
                        padding: '10px', 
                        borderRadius: '12px',
                        textAlign: 'center'
                      }}>
                        <div style={{ color: '#fbbf24', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mid</div>
                        <div style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>
                          {ob.midpoint !== null ? formatPrice(ob.midpoint) : '—'}
                        </div>
                      </div>
                    </div>

                    {/* Volume Summary */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      marginBottom: '16px',
                      fontSize: '12px',
                      color: '#888'
                    }}>
                      <span>📈 Bid Vol: {formatAmount(totalBidVolume)}</span>
                      <span>📉 Ask Vol: {formatAmount(totalAskVolume)}</span>
                    </div>

                    {/* Orderbook Tables - Scrollable */}
                    <div style={{ 
                      display: 'flex', 
                      gap: '12px', 
                      flex: 1,
                      minHeight: 0 // Important for flex child scrolling
                    }}>
                      {/* Asks Table */}
                      <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column',
                        background: '#151515',
                        borderRadius: '12px',
                        padding: '10px',
                        border: '1px solid #2a2a2a'
                      }}>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          color: '#f87171',
                          fontSize: '12px',
                          fontWeight: '600',
                          borderBottom: '1px solid #333',
                          marginBottom: '8px'
                        }}>
                          <span>Price (ASK) ↓</span>
                          <span>Amount</span>
                          <span>Total</span>
                        </div>
                        <div style={{ 
                          flex: 1,
                          overflowY: 'auto',
                          scrollbarWidth: 'thin',
                          scrollbarColor: '#4a4a4a #2a2a2a'
                        }}>
                          {askLevels.length > 0 ? (
                            askLevels.map((level, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  padding: '6px 0',
                                  fontSize: '12px',
                                  borderBottom: '1px solid #2a2a2a',
                                  position: 'relative',
                                  color: '#f87171'
                                }}
                              >
                                {/* Depth background */}
                                <div style={{
                                  position: 'absolute',
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: `${calculateDepthPercentage(askLevels, idx)}%`,
                                  background: 'rgba(248, 113, 113, 0.1)',
                                  zIndex: 0
                                }} />
                                <span style={{ position: 'relative', zIndex: 1, fontWeight: '500' }}>
                                  {formatPrice(level.price)}
                                </span>
                                <span style={{ position: 'relative', zIndex: 1 }}>
                                  {formatAmount(level.amount)}
                                </span>
                                <span style={{ position: 'relative', zIndex: 1, color: '#aaa' }}>
                                  {formatPrice(level.price * level.amount)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
                              No ask data
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bids Table */}
                      <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column',
                        background: '#151515',
                        borderRadius: '12px',
                        padding: '10px',
                        border: '1px solid #2a2a2a'
                      }}>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '8px 0',
                          color: '#4ade80',
                          fontSize: '12px',
                          fontWeight: '600',
                          borderBottom: '1px solid #333',
                          marginBottom: '8px'
                        }}>
                          <span>Price (BID) ↑</span>
                          <span>Amount</span>
                          <span>Total</span>
                        </div>
                        <div style={{ 
                          flex: 1,
                          overflowY: 'auto',
                          scrollbarWidth: 'thin',
                          scrollbarColor: '#4a4a4a #2a2a2a'
                        }}>
                          {bidLevels.length > 0 ? (
                            bidLevels.map((level, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  padding: '6px 0',
                                  fontSize: '12px',
                                  borderBottom: '1px solid #2a2a2a',
                                  position: 'relative',
                                  color: '#4ade80'
                                }}
                              >
                                {/* Depth background */}
                                <div style={{
                                  position: 'absolute',
                                  right: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: `${calculateDepthPercentage(bidLevels, idx)}%`,
                                  background: 'rgba(74, 222, 128, 0.1)',
                                  zIndex: 0
                                }} />
                                <span style={{ position: 'relative', zIndex: 1, fontWeight: '500' }}>
                                  {formatPrice(level.price)}
                                </span>
                                <span style={{ position: 'relative', zIndex: 1 }}>
                                  {formatAmount(level.amount)}
                                </span>
                                <span style={{ position: 'relative', zIndex: 1, color: '#aaa' }}>
                                  {formatPrice(level.price * level.amount)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
                              No bid data
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status Footer for Card */}
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#666', 
                      marginTop: '12px', 
                      paddingTop: '8px',
                      borderTop: '1px solid #333',
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}>
                      <span>{ob.status}</span>
                      <span>{ob.bids.length} bids / {ob.asks.length} asks</span>
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
          {selectedPair ? (
            <>
              <span style={{ color: '#4ade80' }}>●</span> Showing {Object.values(selectedExchanges).filter(v => v).length} exchanges for <strong>{selectedPair}</strong> • Auto-refresh every 3s
            </>
          ) : 'No pair selected'}
        </span>
      </div>
    </div>
  );
};