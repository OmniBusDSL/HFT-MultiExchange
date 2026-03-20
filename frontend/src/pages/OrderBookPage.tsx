import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/OrderBookPage.css';

interface PriceLevel {
  price: number;
  amount: number;
}

interface OrderBook {
  exchange: string;
  symbol: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  loading?: boolean;
  error?: string | null;
}

interface TickerResponse {
  exchange: string;
  tickers: Array<{ symbol: string }>;
}

const EXCHANGES = ['lcx', 'kraken', 'coinbase'];

const DEFAULT_ORDERBOOK: OrderBook = {
  exchange: '',
  symbol: '',
  bids: [],
  asks: [],
  loading: false,
  error: null
};

export const OrderBookPage = () => {
  const { user } = useAuth();
  const [selectedExchange, setSelectedExchange] = useState<string>('lcx');
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [pairsLoading, setPairsLoading] = useState(false);
  const [orderBook, setOrderBook] = useState<OrderBook>(DEFAULT_ORDERBOOK);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch available pairs when exchange changes
  useEffect(() => {
    fetchAvailablePairs();
  }, [selectedExchange]);

  // Fetch order book when symbol or exchange changes
  useEffect(() => {
    if (selectedSymbol && selectedExchange) {
      fetchOrderBook();
    }
  }, [selectedExchange, selectedSymbol]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!selectedSymbol || !selectedExchange) return;
    const interval = setInterval(fetchOrderBook, 10000);
    return () => clearInterval(interval);
  }, [selectedExchange, selectedSymbol]);

  const fetchAvailablePairs = async () => {
    setPairsLoading(true);
    try {
      const response = await fetch(
        `/api/public/tickers?exchange=${selectedExchange}`
      );

      if (response.ok) {
        const data: TickerResponse = await response.json();
        const pairs = data.tickers.map((t) => t.symbol);
        setAvailablePairs(pairs);
        // Set first pair as default
        if (pairs.length > 0 && !selectedSymbol) {
          setSelectedSymbol(pairs[0]);
        }
      } else {
        setAvailablePairs([]);
        setSelectedSymbol('');
      }
    } catch (err) {
      console.error('Error fetching pairs:', err);
      setAvailablePairs([]);
      setSelectedSymbol('');
    } finally {
      setPairsLoading(false);
    }
  };

  const fetchOrderBook = async () => {
    if (!selectedSymbol || !selectedExchange) return;

    setRefreshing(true);
    try {
      const response = await fetch(
        `/api/public/orderbook?exchange=${selectedExchange}&symbol=${selectedSymbol}&limit=20`
      );

      if (response.ok) {
        const data = await response.json();
        setOrderBook({
          exchange: data.exchange || selectedExchange,
          symbol: data.symbol || selectedSymbol,
          bids: Array.isArray(data.bids) ? data.bids : [],
          asks: Array.isArray(data.asks) ? data.asks : [],
          loading: false,
          error: null
        });
      } else {
        setOrderBook({
          exchange: selectedExchange,
          symbol: selectedSymbol,
          bids: [],
          asks: [],
          loading: false,
          error: `Failed to fetch order book (HTTP ${response.status})`
        });
      }
    } catch (err) {
      setOrderBook({
        exchange: selectedExchange,
        symbol: selectedSymbol,
        bids: [],
        asks: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Error fetching order book'
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Safe calculations
  const hasBidsAndAsks = orderBook.bids.length > 0 && orderBook.asks.length > 0;
  const bestBid = hasBidsAndAsks ? orderBook.bids[0].price : 0;
  const bestAsk = hasBidsAndAsks ? orderBook.asks[0].price : 0;
  const midpoint = hasBidsAndAsks ? (bestBid + bestAsk) / 2 : null;
  const spread = hasBidsAndAsks ? bestAsk - bestBid : 0;
  const spreadPercent = midpoint && spread > 0 ? ((spread / midpoint) * 100).toFixed(3) : '0.000';

  return (
    <div className="orderbook-page">
      <h1>📊 Order Book</h1>

      {/* Exchange & Symbol Selection */}
      <div className="orderbook-controls">
        <div className="control-group">
          <label>Exchange:</label>
          <select
            value={selectedExchange}
            onChange={(e) => setSelectedExchange(e.target.value)}
          >
            {EXCHANGES.map((exch) => (
              <option key={exch} value={exch}>
                {exch.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group" style={{ flex: 1, minWidth: '200px' }}>
          <label>Trading Pair:</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            disabled={pairsLoading || availablePairs.length === 0}
          >
            {pairsLoading ? (
              <option>Loading pairs...</option>
            ) : availablePairs.length > 0 ? (
              availablePairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pair}
                </option>
              ))
            ) : (
              <option>No pairs available</option>
            )}
          </select>
          {pairsLoading && <small style={{ color: 'rgba(255, 255, 255, 0.5)' }}>⏳ Fetching pairs from API...</small>}
        </div>

        <div className="control-group">
          <label>Actions:</label>
          <button
            onClick={fetchOrderBook}
            disabled={refreshing || !selectedSymbol}
          >
            {refreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Pair Stats */}
      {availablePairs.length > 0 && (
        <div className="info-banner">
          📈 {availablePairs.length} active pairs available on {selectedExchange.toUpperCase()}
        </div>
      )}

      {/* Error Display */}
      {orderBook.error && (
        <div className="error-banner">
          <strong>Error:</strong> {orderBook.error}
        </div>
      )}

      {/* Market Info */}
      {hasBidsAndAsks && (
        <div className="stats-container">
          <div className="stat-card">
            <div className="stat-label">Best Bid</div>
            <div className="stat-value bid">
              {(bestBid ?? 0).toFixed(8)}
            </div>
            <div className="stat-subtext">
              Amount: {(orderBook.bids[0]?.amount ?? 0).toFixed(8)}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Best Ask</div>
            <div className="stat-value ask">
              {(bestAsk ?? 0).toFixed(8)}
            </div>
            <div className="stat-subtext">
              Amount: {(orderBook.asks[0]?.amount ?? 0).toFixed(8)}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Spread</div>
            <div className="stat-value spread">
              {((spread ?? 0) as number).toFixed(8)}
            </div>
            <div className="stat-subtext">
              {(spreadPercent ?? '0.000')}%
            </div>
          </div>

          {midpoint && (
            <div className="stat-card">
              <div className="stat-label">Midpoint</div>
              <div className="stat-value midpoint">
                {((midpoint ?? 0) as number).toFixed(8)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order Book Table */}
      <div className="orderbook-container">
        {/* Bids */}
        <div className="orderbook-side">
          <div className="side-header">
            <h3 className="bids-header">💚 Bids (Buy Orders)</h3>
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
              {orderBook.bids.length > 0 ? (
                orderBook.bids.map((bid, idx) => {
                  const maxAmount = Math.max(...orderBook.bids.map((b) => b.amount || 0));
                  const depthPercent = maxAmount > 0 ? ((bid.amount || 0) / maxAmount) * 100 : 0;
                  return (
                    <tr key={idx}>
                      <td className="bid-price">
                        {bid && typeof bid.price === 'number' ? bid.price.toFixed(8) : '0.00000000'}
                      </td>
                      <td>
                        {bid && typeof bid.amount === 'number' ? bid.amount.toFixed(8) : '0.00000000'}
                      </td>
                      <td>
                        {bid && typeof bid.price === 'number' && typeof bid.amount === 'number'
                          ? (bid.price * bid.amount).toFixed(8)
                          : '0.00000000'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{
                          width: '100%',
                          height: '20px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                          position: 'relative'
                        }}>
                          <div
                            style={{
                              height: '100%',
                              background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.3) 0%, rgba(16, 185, 129, 0.8) 100%)',
                              width: `${depthPercent}%`,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
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

        {/* Asks */}
        <div className="orderbook-side">
          <div className="side-header">
            <h3 className="asks-header">❤️ Asks (Sell Orders)</h3>
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
              {orderBook.asks.length > 0 ? (
                orderBook.asks.map((ask, idx) => {
                  const maxAmount = Math.max(...orderBook.asks.map((a) => a.amount || 0));
                  const depthPercent = maxAmount > 0 ? ((ask.amount || 0) / maxAmount) * 100 : 0;
                  return (
                    <tr key={idx}>
                      <td className="ask-price">
                        {ask && typeof ask.price === 'number' ? ask.price.toFixed(8) : '0.00000000'}
                      </td>
                      <td>
                        {ask && typeof ask.amount === 'number' ? ask.amount.toFixed(8) : '0.00000000'}
                      </td>
                      <td>
                        {ask && typeof ask.price === 'number' && typeof ask.amount === 'number'
                          ? (ask.price * ask.amount).toFixed(8)
                          : '0.00000000'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{
                          width: '100%',
                          height: '20px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                          position: 'relative'
                        }}>
                          <div
                            style={{
                              height: '100%',
                              background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.3) 0%, rgba(239, 68, 68, 0.8) 100%)',
                              width: `${depthPercent}%`,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
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
    </div>
  );
};
