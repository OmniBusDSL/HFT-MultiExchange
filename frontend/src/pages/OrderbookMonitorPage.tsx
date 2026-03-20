import { useState, useEffect, useCallback } from 'react';
import '../styles/OrderbookMonitorPage.css';

interface Ticker {
  symbol: string;
  bid: number;
  ask: number;
}

interface OracleResult {
  oraclePrice: number;
  spread: number;
  deviation: number | null;
  tier2Deviation: number | null;
  externalMid: number | null;
}

interface PairRow {
  pair: string;
  bid: number;
  ask: number;
  spreadPct: number;
  oracle: number;
  deviation: number | null;
  externalMid: number | null;
  tier2Deviation: number | null;
  signal: 'BUY' | 'SELL' | null;
  updatedAt: number;
}

function computeOracle(bid: number, ask: number, externalMid: number | null): OracleResult {
  const lcxMid = (bid + ask) / 2;
  const spread = ask - bid;

  // Simple oracle: average LCX mid with external price if available
  let oraclePrice = lcxMid;
  if (externalMid !== null) {
    oraclePrice = (lcxMid + externalMid) / 2;
  }

  const deviation = oraclePrice > 0 ? ((lcxMid - oraclePrice) / oraclePrice) * 100 : null;
  const tier2Deviation = externalMid ? ((lcxMid - externalMid) / externalMid) * 100 : null;

  return {
    oraclePrice,
    spread,
    deviation,
    tier2Deviation,
    externalMid
  };
}

export default function OrderbookMonitorPage() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [externalPrices, setExternalPrices] = useState<Map<string, number>>(new Map());
  const [rows, setRows] = useState<PairRow[]>([]);
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [startTime] = useState(Date.now());

  // Fetch CoinGecko API key from database
  const fetchCoinGeckoApiKey = useCallback(async (): Promise<string | null> => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;

      const res = await fetch('/api/apikeys?exchange=coingecko', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) return null;

      const data = await res.json();
      const keys = data.keys || [];
      if (keys.length > 0) {
        return keys[0].apiKey;
      }
      return null;
    } catch (err) {
      console.warn('[OBM] Error fetching CoinGecko API key:', err);
      return null;
    }
  }, []);

  // Fetch external prices from CoinGecko
  const fetchExternalPrices = useCallback(async () => {
    try {
      const symbols = ['bitcoin', 'ethereum', 'ripple', 'cardano', 'solana', 'polkadot', 'dogecoin', 'litecoin', 'chainlink', 'uniswap'];

      const apiKey = await fetchCoinGeckoApiKey();
      if (!apiKey) {
        console.warn('[OBM] No CoinGecko API key');
        return;
      }

      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.join(',')}&vs_currencies=eur,usd&x_cg_demo_api_key=${apiKey}`;
      const res = await fetch(cgUrl);

      if (!res.ok) throw new Error('CoinGecko fetch failed');
      const data = await res.json();

      const mapping: Record<string, string> = {
        'bitcoin': 'BTC', 'ethereum': 'ETH', 'ripple': 'XRP', 'cardano': 'ADA',
        'solana': 'SOL', 'polkadot': 'DOT', 'dogecoin': 'DOGE', 'litecoin': 'LTC',
        'chainlink': 'LINK', 'uniswap': 'UNI'
      };

      const prices = new Map<string, number>();
      for (const [id, symbol] of Object.entries(mapping)) {
        if (data[id]?.eur) {
          prices.set(symbol + '/EUR', data[id].eur);
          prices.set(symbol + '/USD', data[id].usd);
        }
      }
      setExternalPrices(prices);
    } catch (err) {
      console.warn('[OBM] External prices unavailable.');
    }
  }, [fetchCoinGeckoApiKey]);

  // Fetch ticker data from REST API
  const fetchTickerData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/public/tickers?exchange=lcx');
      const data = await res.json();

      if (data.tickers && Array.isArray(data.tickers)) {
        setTickers(data.tickers);
        console.log('[OBM] Loaded', data.tickers.length, 'tickers from LCX');
      }
    } catch (err) {
      console.error('[OBM] Failed to fetch tickers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Compute table rows from tickers and oracle
  useEffect(() => {
    const newRows: PairRow[] = [];

    for (const ticker of tickers) {
      const oracle = computeOracle(ticker.bid, ticker.ask, externalPrices.get(ticker.symbol + '/EUR') || null);

      let signal: 'BUY' | 'SELL' | null = null;
      if (oracle.tier2Deviation !== null && oracle.tier2Deviation < -1) {
        signal = 'BUY';
      } else if (oracle.tier2Deviation !== null && oracle.tier2Deviation > 1) {
        signal = 'SELL';
      }

      newRows.push({
        pair: ticker.symbol,
        bid: ticker.bid,
        ask: ticker.ask,
        spreadPct: ticker.ask > 0 ? ((ticker.ask - ticker.bid) / ticker.ask) * 100 : 0,
        oracle: oracle.oraclePrice,
        deviation: oracle.deviation,
        externalMid: oracle.externalMid,
        tier2Deviation: oracle.tier2Deviation,
        signal,
        updatedAt: Date.now()
      });
    }

    // Sort by |tier2Deviation| descending
    newRows.sort((a, b) => {
      const aDevAbs = Math.abs(a.tier2Deviation || 0);
      const bDevAbs = Math.abs(b.tier2Deviation || 0);
      return bDevAbs - aDevAbs;
    });

    setRows(newRows);
  }, [tickers, externalPrices]);

  // Initial load
  useEffect(() => {
    fetchTickerData();
    fetchExternalPrices();

    const interval = setInterval(fetchExternalPrices, 60000);
    return () => clearInterval(interval);
  }, [fetchTickerData, fetchExternalPrices]);

  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const selectedRow = selectedPair ? rows.find(r => r.pair === selectedPair) : null;

  return (
    <div className="obm-page">
      <div className="obm-header">
        <div className="obm-title">Orderbook Monitor</div>
        <div className="obm-status">
          <span className="status-item">
            <span className={`status-dot ${tickers.length > 0 ? 'connected' : 'disconnected'}`}></span>
            {tickers.length} pairs
          </span>
          <span className="status-item">Uptime: {uptime}s</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
          Loading LCX market data...
        </div>
      ) : (
        <div className="obm-main">
          <div className="obm-table-container">
            {/* Search Bar */}
            <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
              <input
                type="text"
                placeholder="🔍 Search pairs (e.g., BTC, ETH)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  padding: '10px 15px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#e0e0e0',
                  fontSize: '13px',
                  fontFamily: 'inherit'
                }}
              />
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  padding: '10px 15px',
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '6px',
                  color: '#6366f1',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '600'
                }}
              >
                Clear
              </button>
            </div>

            <table className="obm-table">
              <thead>
                <tr>
                  <th>PAIR</th>
                  <th>BID</th>
                  <th>ASK</th>
                  <th>SPR%</th>
                  <th>ORACLE</th>
                  <th>DEV%</th>
                  <th>EXT</th>
                  <th>DEV2%</th>
                  <th>SIGNAL</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((row) =>
                    row.pair.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((row) => (
                  <tr
                    key={row.pair}
                    onClick={() => setSelectedPair(row.pair)}
                    style={{
                      backgroundColor:
                        selectedPair === row.pair ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                      cursor: 'pointer'
                    }}
                  >
                    <td style={{ color: '#0ea5e9', fontWeight: '600' }}>{row.pair}</td>
                    <td style={{ color: '#10b981' }}>{row.bid.toFixed(8)}</td>
                    <td style={{ color: '#ef4444' }}>{row.ask.toFixed(8)}</td>
                    <td>{row.spreadPct.toFixed(4)}%</td>
                    <td style={{ color: '#f59e0b' }}>{row.oracle.toFixed(8)}</td>
                    <td>{row.deviation ? row.deviation.toFixed(2) + '%' : '-'}</td>
                    <td>{row.externalMid ? row.externalMid.toFixed(8) : '-'}</td>
                    <td
                      style={{
                        color:
                          row.tier2Deviation && row.tier2Deviation < -1
                            ? '#10b981'
                            : row.tier2Deviation && row.tier2Deviation > 1
                              ? '#ef4444'
                              : '#9ca3af'
                      }}
                    >
                      {row.tier2Deviation ? row.tier2Deviation.toFixed(2) + '%' : '-'}
                    </td>
                    <td
                      style={{
                        color:
                          row.signal === 'BUY' ? '#10b981' : row.signal === 'SELL' ? '#ef4444' : '#9ca3af'
                      }}
                    >
                      {row.signal || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedRow && (
            <div className="obm-detail-panel" style={{ padding: '20px' }}>
              <h3 style={{ marginTop: 0 }}>{selectedRow.pair}</h3>
              <div style={{ fontSize: '13px', color: '#e0e0e0', lineHeight: '1.8' }}>
                <p><strong>BID:</strong> {selectedRow.bid.toFixed(8)}</p>
                <p><strong>ASK:</strong> {selectedRow.ask.toFixed(8)}</p>
                <p><strong>SPREAD:</strong> {selectedRow.spreadPct.toFixed(4)}%</p>
                <p><strong>ORACLE:</strong> {selectedRow.oracle.toFixed(8)}</p>
                {selectedRow.externalMid && (
                  <p><strong>EXTERNAL:</strong> {selectedRow.externalMid.toFixed(8)}</p>
                )}
                {selectedRow.tier2Deviation !== null && (
                  <p
                    style={{
                      color:
                        selectedRow.tier2Deviation < -1
                          ? '#10b981'
                          : selectedRow.tier2Deviation > 1
                            ? '#ef4444'
                            : '#9ca3af'
                    }}
                  >
                    <strong>DEV2%:</strong> {selectedRow.tier2Deviation.toFixed(2)}%
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
