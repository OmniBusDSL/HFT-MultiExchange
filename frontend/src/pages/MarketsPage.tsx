import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface Ticker {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  baseVolume: number;
}

interface ExchangeMarkets {
  exchange: string;
  tickers: Ticker[];
  loading: boolean;
  error: string | null;
}

export const MarketsPage = () => {
  const { user } = useAuth();
  const [exchangeMarkets, setExchangeMarkets] = useState<ExchangeMarkets[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExchange, setSelectedExchange] = useState<string | null>(null);

  useEffect(() => {
    fetchAllMarkets();
    const interval = setInterval(fetchAllMarkets, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchAllMarkets = async () => {
    setRefreshing(true);
    try {
      // Fetch tickers for each exchange (public endpoints, includes bid/ask)
      const exchanges = ['lcx', 'kraken', 'coinbase'];
      const markets: ExchangeMarkets[] = [];

      for (const exchange of exchanges) {
        const exchangeData: ExchangeMarkets = {
          exchange: exchange.toUpperCase(),
          tickers: [],
          loading: false,
          error: null
        };

        try {
          const tickersResponse = await fetch(
            `/api/public/tickers?exchange=${exchange}`
          );

          if (tickersResponse.ok) {
            const tickersData = await tickersResponse.json();
            exchangeData.tickers = tickersData.tickers || [];
          } else {
            exchangeData.error = `Failed to fetch tickers (HTTP ${tickersResponse.status})`;
          }
        } catch (err) {
          exchangeData.error = err instanceof Error ? err.message : 'Error fetching tickers';
        }

        markets.push(exchangeData);
      }

      setExchangeMarkets(markets);
    } catch (err) {
      console.error('Error:', err);
      setExchangeMarkets([
        {
          exchange: 'ERROR',
          tickers: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load markets'
        }
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const EXCHANGE_ICONS: { [key: string]: string } = {
    LCX: '🏪',
    KRAKEN: '🐙',
    COINBASE: '₿'
  };

  const EXCHANGE_COLORS: { [key: string]: string } = {
    LCX: '#1E90FF',
    KRAKEN: '#522A86',
    COINBASE: '#0052FF'
  };

  const filterTickers = (tickers: Ticker[]) => {
    if (!searchQuery) return tickers;
    return tickers.filter(t =>
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const currentExchange = selectedExchange
    ? exchangeMarkets.find(e => e.exchange === selectedExchange)
    : null;

  return (
    <div className="markets-page">
      <div className="page-header">
        <h1>📊 Live Markets</h1>
        <p>Real-time market data from all connected exchanges</p>
      </div>

      <div className="markets-controls">
        <input
          type="text"
          placeholder="🔍 Search markets (e.g., BTC, ETH, XRP)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <button
          className="btn-refresh"
          onClick={fetchAllMarkets}
          disabled={refreshing}
        >
          {refreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      <div className="markets-container">
        {/* Exchange Selector */}
        <div className="exchange-tabs">
          <button
            className={`tab ${selectedExchange === null ? 'active' : ''}`}
            onClick={() => setSelectedExchange(null)}
          >
            All Exchanges
          </button>
          {exchangeMarkets.map(exc => (
            <button
              key={exc.exchange}
              className={`tab ${selectedExchange === exc.exchange ? 'active' : ''}`}
              onClick={() => setSelectedExchange(exc.exchange)}
              style={{
                borderBottomColor: selectedExchange === exc.exchange ? EXCHANGE_COLORS[exc.exchange] : 'transparent'
              }}
            >
              {EXCHANGE_ICONS[exc.exchange]} {exc.exchange}
            </button>
          ))}
        </div>

        {/* Markets Display */}
        {exchangeMarkets.length === 0 ? (
          <div className="no-markets">
            <p>📭 No API keys connected yet</p>
            <p>Go to <strong>/apikeys</strong> to add your exchange credentials</p>
          </div>
        ) : selectedExchange && currentExchange ? (
          // Single Exchange View
          <div className="exchange-markets">
            <h2 style={{ color: EXCHANGE_COLORS[currentExchange.exchange] }}>
              {EXCHANGE_ICONS[currentExchange.exchange]} {currentExchange.exchange}
            </h2>
            {currentExchange.error ? (
              <div className="exchange-error">
                <p>⚠️ {currentExchange.error}</p>
              </div>
            ) : currentExchange.tickers.length === 0 ? (
              <div className="exchange-empty">
                <p>No market data available</p>
              </div>
            ) : (
              <div className="markets-table-container">
                <table className="markets-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Last Price</th>
                      <th>Best Bid</th>
                      <th>Best Ask</th>
                      <th>24h High</th>
                      <th>24h Low</th>
                      <th>24h Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterTickers(currentExchange.tickers).map((ticker) => (
                      <tr key={ticker.symbol}>
                        <td className="symbol-cell">{ticker.symbol}</td>
                        <td className="price-cell">${ticker.last.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
                        <td className="bid-cell">${ticker.bid > 0 ? ticker.bid.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '-'}</td>
                        <td className="ask-cell">${ticker.ask > 0 ? ticker.ask.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '-'}</td>
                        <td>${ticker.high.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
                        <td>${ticker.low.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
                        <td className="volume-cell">{ticker.baseVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          // All Exchanges View
          <div className="all-exchanges">
            {exchangeMarkets.map((exc) => (
              <div
                key={exc.exchange}
                className="exchange-section"
                style={{ borderTopColor: EXCHANGE_COLORS[exc.exchange] }}
              >
                <h2 style={{ color: EXCHANGE_COLORS[exc.exchange] }}>
                  {EXCHANGE_ICONS[exc.exchange]} {exc.exchange}
                </h2>
                {exc.error ? (
                  <div className="exchange-error">
                    <p>⚠️ {exc.error}</p>
                  </div>
                ) : exc.tickers.length === 0 ? (
                  <div className="exchange-empty">
                    <p>No market data available</p>
                  </div>
                ) : (
                  <div className="markets-table-container">
                    <table className="markets-table compact">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Last</th>
                          <th>Bid</th>
                          <th>Ask</th>
                          <th>Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterTickers(exc.tickers).slice(0, 10).map((ticker) => (
                          <tr key={ticker.symbol}>
                            <td className="symbol-cell">{ticker.symbol}</td>
                            <td>${ticker.last.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
                            <td className="bid-cell">${ticker.bid > 0 ? ticker.bid.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '-'}</td>
                            <td className="ask-cell">${ticker.ask > 0 ? ticker.ask.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '-'}</td>
                            <td>{ticker.baseVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filterTickers(exc.tickers).length > 10 && (
                      <p className="more-markets">
                        +{filterTickers(exc.tickers).length - 10} more markets
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .markets-page {
          padding: 20px;
          max-width: 1600px;
          margin: 0 auto;
        }

        .page-header {
          margin-bottom: 30px;
          border-bottom: 2px solid #0088ff;
          padding-bottom: 15px;
        }

        .page-header h1 {
          margin: 0 0 5px 0;
          color: #fff;
          font-size: 28px;
        }

        .page-header p {
          margin: 0;
          color: #aaa;
          font-size: 14px;
        }

        .markets-controls {
          margin-bottom: 30px;
          display: flex;
          gap: 15px;
          align-items: center;
        }

        .search-input {
          flex: 1;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(0, 136, 255, 0.3);
          border-radius: 8px;
          color: white;
          font-size: 14px;
          transition: all 0.3s;
        }

        .search-input:focus {
          outline: none;
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(0, 136, 255, 0.6);
          box-shadow: 0 0 10px rgba(0, 136, 255, 0.2);
        }

        .search-input::placeholder {
          color: #666;
        }

        .btn-refresh {
          padding: 12px 24px;
          background: linear-gradient(135deg, #0088ff, #0070d0);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          white-space: nowrap;
        }

        .btn-refresh:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(0, 136, 255, 0.4);
        }

        .btn-refresh:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .markets-container {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(0, 136, 255, 0.2);
          border-radius: 12px;
          overflow: hidden;
        }

        .exchange-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid rgba(0, 136, 255, 0.2);
          padding: 0;
          overflow-x: auto;
        }

        .tab {
          padding: 15px 20px;
          background: transparent;
          border: none;
          border-bottom: 3px solid transparent;
          color: #aaa;
          cursor: pointer;
          white-space: nowrap;
          font-weight: 500;
          transition: all 0.3s;
        }

        .tab:hover {
          color: #fff;
          background: rgba(0, 136, 255, 0.05);
        }

        .tab.active {
          color: #0088ff;
          border-bottom-color: #0088ff;
        }

        .exchange-markets,
        .all-exchanges {
          padding: 20px;
        }

        .exchange-section {
          border-top: 3px solid #0088ff;
          padding: 20px 0;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
        }

        .exchange-section h2 {
          margin-top: 0;
          margin-bottom: 15px;
          font-size: 18px;
        }

        .exchange-error {
          padding: 15px;
          background: rgba(248, 113, 113, 0.1);
          color: #f87171;
          border-radius: 8px;
          margin: 15px 0;
        }

        .exchange-error p {
          margin: 0;
        }

        .exchange-empty {
          padding: 30px 20px;
          text-align: center;
          color: #888;
        }

        .no-markets {
          padding: 60px 20px;
          text-align: center;
          background: rgba(0, 136, 255, 0.05);
          border-radius: 12px;
        }

        .no-markets p {
          margin: 10px 0;
          color: #aaa;
          font-size: 16px;
        }

        .no-markets p strong {
          color: #0088ff;
        }

        .markets-table-container {
          overflow-x: auto;
        }

        .markets-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        .markets-table thead {
          background: rgba(0, 136, 255, 0.1);
          border-bottom: 2px solid rgba(0, 136, 255, 0.3);
        }

        .markets-table th {
          padding: 12px 16px;
          text-align: left;
          color: #0088ff;
          font-weight: 600;
          text-transform: uppercase;
          font-size: 12px;
          letter-spacing: 0.5px;
        }

        .markets-table td {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(0, 136, 255, 0.1);
          color: #ddd;
        }

        .markets-table tbody tr {
          transition: all 0.2s;
        }

        .markets-table tbody tr:hover {
          background: rgba(0, 136, 255, 0.05);
        }

        .symbol-cell {
          font-weight: 600;
          color: #fff;
          font-family: 'Courier New', monospace;
        }

        .price-cell {
          color: #4ade80;
          font-weight: 600;
          font-family: 'Courier New', monospace;
        }

        .volume-cell {
          color: #60a5fa;
          font-family: 'Courier New', monospace;
        }

        .more-markets {
          text-align: center;
          color: #666;
          font-size: 12px;
          margin: 10px 0 0 0;
          padding: 10px 0;
        }

        @media (max-width: 768px) {
          .markets-page {
            padding: 15px;
          }

          .markets-controls {
            flex-direction: column;
          }

          .search-input {
            width: 100%;
          }

          .btn-refresh {
            width: 100%;
          }

          .markets-table.compact {
            font-size: 12px;
          }

          .markets-table th,
          .markets-table td {
            padding: 8px 12px;
          }

          .page-header h1 {
            font-size: 22px;
          }

          .exchange-tabs {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }

          .tab {
            padding: 12px 16px;
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
};
