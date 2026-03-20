import { useState, useEffect, useCallback } from 'react';

interface CoinData {
  id: string;
  symbol: string;
  name: string;
  current_price?: number;
  market_cap?: number;
  market_cap_rank?: number;
  total_volume?: number;
  high_24h?: number;
  low_24h?: number;
  price_change_24h?: number;
  price_change_percentage_24h?: number;
  image?: string;
}

interface SearchResult extends CoinData {
  market_cap_rank?: number;
}

interface ExchangeData {
  name: string;
  symbol: string;
  target: string;
  trust_score: string;
  converted_last?: Record<string, number>;
}

export const CoingeckoPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState('usd');
  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Record<string, ExchangeData[]>>({});
  const [exchangesLoading, setExchangesLoading] = useState<Record<string, boolean>>({});
  const [showDex, setShowDex] = useState(false);

  const searchCryptos = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch from CoinGecko via backend proxy (avoids CORS and rate limiting)
      const response = await fetch(
        `http://127.0.0.1:8000/public/coingecko/api/v3/search?query=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        throw new Error('Failed to search cryptocurrencies');
      }

      const data = await response.json();
      // Limit to top 10 results, filter derivatives for main coins
      let filtered = data.coins?.slice(0, 15) || [];

      // If searching for a main coin like "BTC", filter out derivatives
      const query_lower = query.toLowerCase();
      if (['btc', 'eth', 'ltc', 'doge', 'bch'].some(coin => query_lower.includes(coin))) {
        filtered = filtered.filter((coin: any) => {
          const name_lower = (coin.name || '').toLowerCase();
          // Keep main coin and major pairs, exclude wrapped/pegged versions
          return !name_lower.includes('wrapped') && !name_lower.includes('wbtc') &&
                 !name_lower.includes('paxg') && !name_lower.includes('synthetic');
        });
      }

      setResults(filtered.slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Get detailed prices for selected coins
  const getDetailedPrices = useCallback(async (coinIds: string[]) => {
    if (coinIds.length === 0) return;

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/public/coingecko/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=${selectedCurrency}&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch prices');
      }

      const priceData = await response.json();

      // Merge price data with search results
      const enhancedResults = results.map(coin => ({
        ...coin,
        current_price: priceData[coin.id]?.[selectedCurrency],
        price_change_percentage_24h:
          priceData[coin.id]?.[`${selectedCurrency}_24h_change`],
        total_volume: priceData[coin.id]?.[`${selectedCurrency}_24h_vol`],
        market_cap: priceData[coin.id]?.[`${selectedCurrency}_market_cap`],
      }));

      setResults(enhancedResults);
    } catch (err) {
      console.error('Failed to fetch detailed prices:', err);
    }
  }, [results, selectedCurrency]);

  // Fetch exchanges for a specific coin
  const fetchExchanges = useCallback(async (coinId: string) => {
    setExchangesLoading(prev => ({ ...prev, [coinId]: true }));

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/public/coingecko/api/v3/coins/${coinId}/tickers?order=trust_score_desc&per_page=50`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch exchanges');
      }

      const data = await response.json();
      setExchanges(prev => ({
        ...prev,
        [coinId]: data.tickers || [],
      }));
    } catch (err) {
      console.error('Failed to fetch exchanges:', err);
    } finally {
      setExchangesLoading(prev => ({ ...prev, [coinId]: false }));
    }
  }, []);

  const handleCoinClick = (coinId: string) => {
    if (expandedCoin === coinId) {
      setExpandedCoin(null);
    } else {
      setExpandedCoin(coinId);
      if (!exchanges[coinId]) {
        fetchExchanges(coinId);
      }
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchCryptos(searchQuery);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, searchCryptos]);

  useEffect(() => {
    const coinIds = results.map(coin => coin.id).slice(0, 10);
    if (coinIds.length > 0) {
      getDetailedPrices(coinIds);
    }
  }, [results, selectedCurrency, getDetailedPrices]);

  return (
    <div className="coingecko-page">
      <div className="page-header">
        <h1>🦎 CoinGecko Market Data</h1>
        <p>Search cryptocurrencies și prețuri în timp real</p>
      </div>

      <div className="coingecko-controls">
        <input
          type="text"
          placeholder="Caută crypto (Bitcoin, Ethereum, Dogecoin...)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />

        <select
          value={selectedCurrency}
          onChange={(e) => setSelectedCurrency(e.target.value)}
          className="currency-select"
        >
          <option value="usd">USD ($)</option>
          <option value="eur">EUR (€)</option>
          <option value="gbp">GBP (£)</option>
          <option value="jpy">JPY (¥)</option>
        </select>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading && <div className="loading-message">Se caută...</div>}

      {!loading && results.length === 0 && searchQuery && (
        <div className="no-results">
          <p>Nu am găsit rezultate pentru "{searchQuery}"</p>
        </div>
      )}

      <div className="results-grid">
        {results.map((coin) => (
          <div
            key={coin.id}
            className={`coin-card ${expandedCoin === coin.id ? 'expanded' : ''}`}
            onClick={() => handleCoinClick(coin.id)}
          >
            <div className="coin-header">
              {coin.image && (
                <img
                  src={coin.image}
                  alt={coin.name}
                  className="coin-image"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="coin-info">
                <h3>{coin.name}</h3>
                <p className="symbol">{coin.symbol?.toUpperCase()}</p>
              </div>
              <span className="expand-icon">
                {expandedCoin === coin.id ? '▼' : '▶'}
              </span>
            </div>

            <div className="coin-price">
              {coin.current_price ? (
                <>
                  <div className="price">
                    {selectedCurrency.toUpperCase()} {coin.current_price.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 8,
                    })}
                  </div>
                  {coin.price_change_percentage_24h !== undefined && coin.price_change_percentage_24h !== null && (
                    <div
                      className={`change ${
                        coin.price_change_percentage_24h >= 0 ? 'positive' : 'negative'
                      }`}
                    >
                      {coin.price_change_percentage_24h >= 0 ? '+' : ''}
                      {coin.price_change_percentage_24h.toFixed(2)}%
                    </div>
                  )}
                </>
              ) : (
                <p className="loading-price">Loading...</p>
              )}
            </div>

            {coin.market_cap_rank && (
              <div className="rank">#{coin.market_cap_rank}</div>
            )}

            <div className="coin-stats">
              {coin.market_cap && (
                <div className="stat">
                  <span className="label">Market Cap:</span>
                  <span className="value">
                    {(coin.market_cap / 1e9).toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}B
                  </span>
                </div>
              )}
              {coin.total_volume && (
                <div className="stat">
                  <span className="label">Volume 24h:</span>
                  <span className="value">
                    {(coin.total_volume / 1e6).toLocaleString('en-US', {
                      maximumFractionDigits: 1,
                    })}M
                  </span>
                </div>
              )}
              {coin.high_24h && coin.low_24h && (
                <div className="stat">
                  <span className="label">24h Range:</span>
                  <span className="value">
                    {coin.low_24h.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                    {' - '}
                    {coin.high_24h.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
            </div>

            {expandedCoin === coin.id && (
              <div className="exchanges-section">
                <div className="exchanges-header">
                  <h4>📊 Pe ce Exchange-uri e listat:</h4>
                  <button
                    className="toggle-dex"
                    onClick={() => setShowDex(!showDex)}
                    title={showDex ? 'Ascunde DEX' : 'Arată DEX'}
                  >
                    {showDex ? '⛔ Ascunde DEX' : '➕ Arată DEX'}
                  </button>
                </div>
                {exchangesLoading[coin.id] ? (
                  <p className="loading-exchanges">Se încarcă exchange-uri...</p>
                ) : exchanges[coin.id]?.length > 0 ? (
                  <>
                    {/* CEX Exchanges */}
                    <div className="exchange-category">
                      <h5>💱 Centralized Exchanges (CEX)</h5>
                      <div className="exchanges-list">
                        {exchanges[coin.id]
                          .filter(
                            (exchange) =>
                              exchange.name &&
                              !exchange.name.toLowerCase().includes('dex') &&
                              !exchange.name.includes('0x') &&
                              exchange.target &&
                              !exchange.target.includes('0x')
                          )
                          .slice(0, 10)
                          .map((exchange, idx) => (
                            <div key={idx} className="exchange-item cex">
                              <span className="exchange-name">{exchange.name}</span>
                              <span className="exchange-pair">
                                {exchange.symbol?.toUpperCase()} / {exchange.target?.toUpperCase()}
                              </span>
                              {exchange.trust_score && (
                                <span className="trust-score">✓ {exchange.trust_score}</span>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* DEX Protocols */}
                    {showDex && (
                      <div className="exchange-category dex-category">
                        <h5>🌊 Decentralized Exchanges (DEX)</h5>
                        <div className="exchanges-list">
                          {exchanges[coin.id]
                            .filter(
                              (exchange) =>
                                exchange.name &&
                                (exchange.name.toLowerCase().includes('dex') ||
                                  exchange.name.includes('0x') ||
                                  exchange.target.includes('0x'))
                            )
                            .slice(0, 8)
                            .map((exchange, idx) => (
                              <div key={idx} className="exchange-item dex">
                                <span className="exchange-name">{exchange.name}</span>
                                <span className="exchange-pair">
                                  {exchange.symbol?.toUpperCase()} / {exchange.target?.toUpperCase()}
                                </span>
                                {exchange.trust_score && (
                                  <span className="trust-score">◆ {exchange.trust_score}</span>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="no-exchanges">
                    <p>Nu am găsit exchange-uri listate</p>
                    {exchanges[coin.id]?.length === 0 && (
                      <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                        Token-ul poate fi listat pe blockchain (DEX) în loc de CEX
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .coingecko-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .page-header {
          margin-bottom: 30px;
          border-bottom: 2px solid #0088ff;
          padding-bottom: 15px;
        }

        .page-header h1 {
          margin: 0;
          color: #fff;
          font-size: 28px;
        }

        .page-header p {
          margin: 5px 0 0 0;
          color: #aaa;
          font-size: 14px;
        }

        .coingecko-controls {
          display: flex;
          gap: 15px;
          margin-bottom: 30px;
          flex-wrap: wrap;
        }

        .search-input {
          flex: 1;
          min-width: 250px;
          padding: 12px 15px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 136, 255, 0.3);
          border-radius: 8px;
          color: #fff;
          font-size: 14px;
        }

        .search-input::placeholder {
          color: #666;
        }

        .search-input:focus {
          outline: none;
          border-color: #0088ff;
          box-shadow: 0 0 10px rgba(0, 136, 255, 0.2);
        }

        .currency-select {
          padding: 12px 15px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 136, 255, 0.3);
          border-radius: 8px;
          color: #fff;
          font-size: 14px;
          cursor: pointer;
        }

        .currency-select:focus {
          outline: none;
          border-color: #0088ff;
        }

        .currency-select option {
          background: #1a1a1a;
          color: #fff;
        }

        .error-message {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          border-left: 4px solid #f87171;
        }

        .loading-message {
          text-align: center;
          color: #0088ff;
          padding: 40px 20px;
          font-size: 16px;
        }

        .no-results {
          text-align: center;
          color: #aaa;
          padding: 60px 20px;
        }

        .results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 15px;
        }

        .coin-card {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 136, 255, 0.15);
          border-radius: 12px;
          padding: 20px;
          transition: all 0.3s;
          position: relative;
          overflow: visible;
          cursor: pointer;
        }

        .coin-card:hover {
          background: rgba(0, 136, 255, 0.05);
          border-color: rgba(0, 136, 255, 0.4);
          transform: translateY(-3px);
          box-shadow: 0 5px 20px rgba(0, 136, 255, 0.1);
        }

        .coin-card.expanded {
          grid-column: 1 / -1;
          background: rgba(0, 136, 255, 0.08);
          border-color: rgba(0, 136, 255, 0.5);
        }

        .coin-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 15px;
          position: relative;
        }

        .coin-image {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
        }

        .coin-info h3 {
          margin: 0;
          color: #fff;
          font-size: 16px;
        }

        .symbol {
          margin: 4px 0 0 0;
          color: #0088ff;
          font-size: 12px;
          font-weight: 600;
        }

        .coin-price {
          margin-bottom: 12px;
        }

        .price {
          color: #fff;
          font-size: 20px;
          font-weight: 600;
        }

        .change {
          font-size: 12px;
          font-weight: 600;
          margin-top: 4px;
        }

        .change.positive {
          color: #4ade80;
        }

        .change.negative {
          color: #f87171;
        }

        .loading-price {
          color: #666;
          font-size: 12px;
          margin: 0;
        }

        .rank {
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(0, 136, 255, 0.2);
          color: #0088ff;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }

        .coin-stats {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid rgba(0, 136, 255, 0.1);
        }

        .stat {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          margin-bottom: 8px;
        }

        .stat:last-child {
          margin-bottom: 0;
        }

        .stat .label {
          color: #aaa;
        }

        .stat .value {
          color: #0088ff;
          font-weight: 600;
        }

        .expand-icon {
          margin-left: auto;
          color: #0088ff;
          font-size: 12px;
          transition: transform 0.3s;
        }

        .exchanges-section {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 2px solid rgba(0, 136, 255, 0.2);
          animation: slideDown 0.3s ease-out;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            max-height: 0;
            overflow: hidden;
          }
          to {
            opacity: 1;
            max-height: 1000px;
            overflow: visible;
          }
        }

        .exchanges-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          gap: 15px;
        }

        .exchanges-header h4 {
          margin: 0;
          color: #0088ff;
          font-size: 14px;
        }

        .toggle-dex {
          padding: 6px 12px;
          background: rgba(0, 136, 255, 0.15);
          border: 1px solid rgba(0, 136, 255, 0.3);
          border-radius: 6px;
          color: #0088ff;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          white-space: nowrap;
        }

        .toggle-dex:hover {
          background: rgba(0, 136, 255, 0.25);
          border-color: rgba(0, 136, 255, 0.5);
        }

        .loading-exchanges,
        .no-exchanges {
          color: #aaa;
          text-align: center;
          padding: 15px;
          font-size: 12px;
        }

        .exchange-category {
          margin-bottom: 20px;
        }

        .exchange-category h5 {
          margin: 0 0 10px 0;
          color: #0088ff;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          opacity: 0.8;
        }

        .dex-category {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px dashed rgba(0, 136, 255, 0.2);
        }

        .dex-category h5 {
          color: #FF6B35;
        }

        .exchanges-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 10px;
        }

        .exchange-item {
          background: rgba(0, 136, 255, 0.1);
          border: 1px solid rgba(0, 136, 255, 0.2);
          border-radius: 8px;
          padding: 12px;
          font-size: 11px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .exchange-item.dex {
          background: rgba(255, 107, 53, 0.1);
          border-color: rgba(255, 107, 53, 0.3);
        }

        .exchange-item.cex {
          background: rgba(0, 136, 255, 0.1);
          border-color: rgba(0, 136, 255, 0.2);
        }

        .exchange-name {
          color: #0088ff;
          font-weight: 600;
        }

        .exchange-item.dex .exchange-name {
          color: #FF6B35;
        }

        .exchange-pair {
          color: #fff;
          font-weight: 500;
        }

        .trust-score {
          color: #4ade80;
          font-size: 10px;
        }

        .exchange-item.dex .trust-score {
          color: #FFB84D;
        }

        @media (max-width: 768px) {
          .coingecko-controls {
            flex-direction: column;
          }

          .search-input {
            min-width: 100%;
          }

          .results-grid {
            grid-template-columns: 1fr;
          }

          .exchanges-list {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};
