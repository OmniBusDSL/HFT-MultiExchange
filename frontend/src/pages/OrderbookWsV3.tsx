import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

type TabType = 'usdc' | 'eur' | 'eur-comparison';

interface Pair {
  pair: string;
  exchange: string;
  on_coinbase?: boolean;
  on_kraken?: boolean;
  on_kraken_usd?: boolean;
  on_kraken_eur?: boolean;
  on_coinbase_usdc?: boolean;
  on_coinbase_eur?: boolean;
}

interface LCXPairs {
  usdc: Pair[];
  eur: Pair[];
  eurComparison: Pair[];
}

export const OrderbookWsV3: React.FC = () => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('usdc');
  const [lcxPairs, setLcxPairs] = useState<LCXPairs>({ usdc: [], eur: [], eurComparison: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null);
  const [pairDetails, setPairDetails] = useState<Record<string, any>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Fetch LCX pairs with Coinbase and Kraken availability from backend
  useEffect(() => {
    const fetchLCXPairs = async () => {
      try {
        setLoading(true);
        const cbResponse = await fetch('http://localhost:8000/public/lcx-vs-coinbase');
        const krakenResponse = await fetch('http://localhost:8000/public/lcx-vs-kraken');
        const eurComparisonResponse = await fetch('http://localhost:8000/public/lcx-eur-vs-exchanges');

        if (cbResponse.ok && krakenResponse.ok && eurComparisonResponse.ok) {
          const cbData = await cbResponse.json();
          const krakenData = await krakenResponse.json();
          const eurComparisonData = await eurComparisonResponse.json();

          // Merge Coinbase and Kraken data
          const usdcPairsFromCB = cbData.groups?.USD_USDC?.pairs || [];
          const eurPairsFromCB = cbData.groups?.EUR?.pairs || [];

          const usdcPairsFromKraken = krakenData.groups?.USD_USDC?.pairs || [];
          const eurPairsFromKraken = krakenData.groups?.EUR?.pairs || [];

          // Create maps for easy lookup by pair name
          const krakenUsdMap = new Map(usdcPairsFromKraken.map((p: any) => [p.pair, p.on_kraken]));
          const krakenEurMap = new Map(eurPairsFromKraken.map((p: any) => [p.pair, p.on_kraken]));

          // Merge USDC pairs
          const usdcPairs = usdcPairsFromCB.map((p: any) => ({
            pair: p.pair,
            exchange: 'lcx',
            on_coinbase: p.on_coinbase,
            on_kraken: krakenUsdMap.get(p.pair) ?? false
          }));

          // Merge EUR pairs
          const eurPairs = eurPairsFromCB.map((p: any) => ({
            pair: p.pair,
            exchange: 'lcx',
            on_coinbase: p.on_coinbase,
            on_kraken: krakenEurMap.get(p.pair) ?? false
          }));

          // EUR Comparison pairs (EUR on LCX, matches to USD/EUR on Kraken and USDC/EUR on Coinbase)
          const eurComparisonPairs = eurComparisonData.pairs?.map((p: any) => ({
            pair: p.pair,
            exchange: 'lcx',
            on_kraken_usd: p.on_kraken_usd ?? false,
            on_kraken_eur: p.on_kraken_eur ?? false,
            on_coinbase_usdc: p.on_coinbase_usdc ?? false,
            on_coinbase_eur: p.on_coinbase_eur ?? false
          })) || [];

          setLcxPairs({ usdc: usdcPairs, eur: eurPairs, eurComparison: eurComparisonPairs });
          console.log(`✅ LCX Pairs loaded: ${usdcPairs.length} USDC + ${eurPairs.length} EUR + ${eurComparisonPairs.length} EUR Comparison`);
        }
      } catch (err) {
        console.error('❌ Error fetching LCX pairs:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLCXPairs();
  }, []);

  // Convert symbol based on exchange format rules
  const convertSymbolForExchange = (symbol: string, exchange: string, variant?: 'usd' | 'usdc' | 'eur'): string => {
    const [base, quote] = symbol.split('/');
    if (!base) return symbol;

    // EUR Comparison mode: convert EUR to various variants
    if (quote === 'EUR') {
      if (exchange === 'kraken') {
        if (variant === 'usd') return `${base}/USD`;
        if (variant === 'eur') return `${base}/EUR`;
        return `${base}/EUR`; // default to EUR
      }
      if (exchange === 'coinbase') {
        if (variant === 'usdc') return `${base}-USDC`;
        if (variant === 'eur') return `${base}-EUR`;
        return `${base}-EUR`; // default to EUR
      }
    }

    // Standard conversions (USDC/EUR tabs)
    // Kraken: Only USD, EUR, GBP (no USDC)
    if (exchange === 'kraken') {
      if (quote === 'USDC') return `${base}/USD`;
      if (quote === 'USDT') return `${base}/USD`;
      return symbol;
    }

    // Coinbase: Uses hyphens instead of slashes (ADA-USDC)
    if (exchange === 'coinbase') {
      return `${base}-${quote}`;
    }

    // LCX: Uses standard format with slashes
    return symbol;
  };

  // Fetch orderbook details for a specific pair from all exchanges
  const fetchPairDetails = async (pair: Pair) => {
    setSelectedPair(pair);
    setDetailsLoading(true);
    setPairDetails({});

    try {
      const details: Record<string, any> = {};
      const isEurComparison = activeTab === 'eur-comparison';

      // Fetch LCX orderbook
      try {
        const lcxSymbol = convertSymbolForExchange(pair.pair, 'lcx');
        const lcxRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=lcx&symbol=${encodeURIComponent(lcxSymbol)}`);
        if (lcxRes.ok) {
          const lcxData = await lcxRes.json();
          details.lcx = {
            bid: lcxData.bestBid,
            ask: lcxData.bestAsk,
            last: lcxData.bestBid || 0,
            volume: 0,
            symbol: lcxSymbol,
          };
        }
      } catch (err) {
        console.error('❌ Error fetching LCX:', err);
      }

      if (isEurComparison) {
        // EUR Comparison mode: fetch all variants
        // Coinbase EUR variant
        if (pair.on_coinbase_eur) {
          try {
            const cbSymbol = convertSymbolForExchange(pair.pair, 'coinbase', 'eur');
            const cbRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=coinbase&symbol=${encodeURIComponent(cbSymbol)}`);
            if (cbRes.ok) {
              const cbData = await cbRes.json();
              details['coinbase-eur'] = {
                bid: cbData.bestBid,
                ask: cbData.bestAsk,
                last: cbData.bestBid || 0,
                volume: 0,
                symbol: cbSymbol,
              };
            }
          } catch (err) {
            console.error('❌ Error fetching Coinbase EUR:', err);
          }
        }

        // Coinbase USDC variant
        if (pair.on_coinbase_usdc) {
          try {
            const cbSymbol = convertSymbolForExchange(pair.pair, 'coinbase', 'usdc');
            const cbRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=coinbase&symbol=${encodeURIComponent(cbSymbol)}`);
            if (cbRes.ok) {
              const cbData = await cbRes.json();
              details['coinbase-usdc'] = {
                bid: cbData.bestBid,
                ask: cbData.bestAsk,
                last: cbData.bestBid || 0,
                volume: 0,
                symbol: cbSymbol,
              };
            }
          } catch (err) {
            console.error('❌ Error fetching Coinbase USDC:', err);
          }
        }

        // Kraken EUR variant
        if (pair.on_kraken_eur) {
          try {
            const krkSymbol = convertSymbolForExchange(pair.pair, 'kraken', 'eur');
            const krkRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=kraken&symbol=${encodeURIComponent(krkSymbol)}`);
            if (krkRes.ok) {
              const krkData = await krkRes.json();
              details['kraken-eur'] = {
                bid: krkData.bestBid,
                ask: krkData.bestAsk,
                last: krkData.bestBid || 0,
                volume: 0,
                symbol: krkSymbol,
              };
            }
          } catch (err) {
            console.error('❌ Error fetching Kraken EUR:', err);
          }
        }

        // Kraken USD variant
        if (pair.on_kraken_usd) {
          try {
            const krkSymbol = convertSymbolForExchange(pair.pair, 'kraken', 'usd');
            const krkRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=kraken&symbol=${encodeURIComponent(krkSymbol)}`);
            if (krkRes.ok) {
              const krkData = await krkRes.json();
              details['kraken-usd'] = {
                bid: krkData.bestBid,
                ask: krkData.bestAsk,
                last: krkData.bestBid || 0,
                volume: 0,
                symbol: krkSymbol,
              };
            }
          } catch (err) {
            console.error('❌ Error fetching Kraken USD:', err);
          }
        }
      } else {
        // Standard mode (USDC/EUR tabs)
        // Fetch Coinbase orderbook (if available)
        const hasCoinbase = pair.on_coinbase;
        if (hasCoinbase) {
          try {
            const cbSymbol = convertSymbolForExchange(pair.pair, 'coinbase');
            const cbRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=coinbase&symbol=${encodeURIComponent(cbSymbol)}`);
            if (cbRes.ok) {
              const cbData = await cbRes.json();
              details.coinbase = {
                bid: cbData.bestBid,
                ask: cbData.bestAsk,
                last: cbData.bestBid || 0,
                volume: 0,
                symbol: cbSymbol,
              };
            }
          } catch (err) {
            console.error('❌ Error fetching Coinbase:', err);
          }
        }

        // Fetch Kraken orderbook (if available)
        const hasKraken = pair.on_kraken;
        if (hasKraken) {
          try {
            const krkSymbol = convertSymbolForExchange(pair.pair, 'kraken');
            const krkRes = await fetch(`http://localhost:8000/public/orderbook-ws?exchange=kraken&symbol=${encodeURIComponent(krkSymbol)}`);
            if (krkRes.ok) {
              const krkData = await krkRes.json();
              details.kraken = {
                bid: krkData.bestBid,
                ask: krkData.bestAsk,
                last: krkData.bestBid || 0,
                volume: 0,
                symbol: krkSymbol,
              };
            }
          } catch (err) {
            console.error('❌ Error fetching Kraken:', err);
          }
        }
      }

      setPairDetails(details);
    } catch (err) {
      console.error('❌ Error fetching pair details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const currentPairs = activeTab === 'usdc' ? lcxPairs.usdc : activeTab === 'eur' ? lcxPairs.eur : lcxPairs.eurComparison;
  const filteredPairs = currentPairs.filter(p =>
    !filter || p.pair.toUpperCase().includes(filter.toUpperCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0e27' }}>
      {/* Header */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(100, 100, 100, 0.3)' }}>
        <h1 style={{ color: '#fff', fontSize: '24px', marginBottom: '8px' }}>
          🔷 LCX Active Pairs Manager
        </h1>
        <p style={{ color: '#888', fontSize: '13px' }}>
          {activeTab === 'usdc'
            ? `LCX USDC Pairs: ${filteredPairs.length} / ${lcxPairs.usdc.length}`
            : activeTab === 'eur'
            ? `LCX EUR Pairs: ${filteredPairs.length} / ${lcxPairs.eur.length}`
            : `LCX EUR Pairs (Comparison): ${filteredPairs.length} / ${lcxPairs.eurComparison.length}`
          }
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '12px', padding: '16px', borderBottom: '1px solid rgba(100, 100, 100, 0.3)' }}>
        <button
          onClick={() => setActiveTab('usdc')}
          style={{
            padding: '10px 20px',
            background: activeTab === 'usdc' ? 'linear-gradient(145deg, #3b82f6, #2563eb)' : 'rgba(100, 100, 100, 0.2)',
            border: activeTab === 'usdc' ? '2px solid #3b82f6' : '1px solid rgba(100, 100, 100, 0.3)',
            borderRadius: '6px',
            color: activeTab === 'usdc' ? '#fff' : '#aaa',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'usdc') {
              e.currentTarget.style.background = 'rgba(100, 100, 100, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'usdc') {
              e.currentTarget.style.background = 'rgba(100, 100, 100, 0.2)';
            }
          }}
        >
          💵 USDC ({lcxPairs.usdc.length})
        </button>
        <button
          onClick={() => setActiveTab('eur')}
          style={{
            padding: '10px 20px',
            background: activeTab === 'eur' ? 'linear-gradient(145deg, #f97316, #ea580c)' : 'rgba(100, 100, 100, 0.2)',
            border: activeTab === 'eur' ? '2px solid #f97316' : '1px solid rgba(100, 100, 100, 0.3)',
            borderRadius: '6px',
            color: activeTab === 'eur' ? '#fff' : '#aaa',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'eur') {
              e.currentTarget.style.background = 'rgba(100, 100, 100, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'eur') {
              e.currentTarget.style.background = 'rgba(100, 100, 100, 0.2)';
            }
          }}
        >
          🇪🇺 EUR ({lcxPairs.eur.length})
        </button>
        <button
          onClick={() => setActiveTab('eur-comparison')}
          style={{
            padding: '10px 20px',
            background: activeTab === 'eur-comparison' ? 'linear-gradient(145deg, #a855f7, #9333ea)' : 'rgba(100, 100, 100, 0.2)',
            border: activeTab === 'eur-comparison' ? '2px solid #a855f7' : '1px solid rgba(100, 100, 100, 0.3)',
            borderRadius: '6px',
            color: activeTab === 'eur-comparison' ? '#fff' : '#aaa',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'eur-comparison') {
              e.currentTarget.style.background = 'rgba(100, 100, 100, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'eur-comparison') {
              e.currentTarget.style.background = 'rgba(100, 100, 100, 0.2)';
            }
          }}
        >
          🔄 EUR Comparison ({lcxPairs.eurComparison.length})
        </button>
      </div>

      {/* Search Filter */}
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(100, 100, 100, 0.3)' }}>
        <input
          type="text"
          placeholder="🔍 Search pairs (e.g., BTC, ETH, SOL)..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '6px',
            border: '1px solid rgba(100, 150, 255, 0.3)',
            background: 'rgba(30, 60, 120, 0.2)',
            color: '#fff',
            fontSize: '13px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#888', paddingTop: '40px' }}>
            ⏳ Loading LCX pairs...
          </div>
        ) : filteredPairs.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#888', paddingTop: '40px' }}>
            ❌ No pairs found
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            {filteredPairs.map((pair, idx) => {
              const bgColor = activeTab === 'usdc'
                ? 'linear-gradient(145deg, rgba(59, 130, 246, 0.2), rgba(30, 60, 120, 0.2))'
                : activeTab === 'eur'
                ? 'linear-gradient(145deg, rgba(249, 115, 22, 0.2), rgba(120, 60, 30, 0.2))'
                : 'linear-gradient(145deg, rgba(168, 85, 247, 0.2), rgba(90, 60, 120, 0.2))';
              const borderColor = activeTab === 'usdc'
                ? '1px solid rgba(59, 130, 246, 0.4)'
                : activeTab === 'eur'
                ? '1px solid rgba(249, 115, 22, 0.4)'
                : '1px solid rgba(168, 85, 247, 0.4)';
              const titleColor = activeTab === 'usdc'
                ? '#60a5fa'
                : activeTab === 'eur'
                ? '#fb923c'
                : '#d8b4fe';
              const shadowColor = activeTab === 'usdc'
                ? '0 8px 16px rgba(59, 130, 246, 0.3)'
                : activeTab === 'eur'
                ? '0 8px 16px rgba(249, 115, 22, 0.3)'
                : '0 8px 16px rgba(168, 85, 247, 0.3)';

              const isEurComparison = activeTab === 'eur-comparison';
              const hasCoinbase = isEurComparison
                ? (pair.on_coinbase_eur || pair.on_coinbase_usdc)
                : pair.on_coinbase;
              const hasKraken = isEurComparison
                ? (pair.on_kraken_eur || pair.on_kraken_usd)
                : pair.on_kraken;
              const cbLabel = isEurComparison
                ? `CB ${pair.on_coinbase_eur && pair.on_coinbase_usdc ? '(EUR/USDC)' : pair.on_coinbase_eur ? '(EUR)' : '(USDC)'}`
                : 'CB';
              const krkLabel = isEurComparison
                ? `KRK ${pair.on_kraken_eur && pair.on_kraken_usd ? '(EUR/USD)' : pair.on_kraken_eur ? '(EUR)' : '(USD)'}`
                : 'KRK';

              return (
                <div
                  key={idx}
                  onClick={() => fetchPairDetails(pair)}
                  style={{
                    background: bgColor,
                    border: borderColor,
                    borderRadius: '8px',
                    padding: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = shadowColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    color: titleColor,
                    fontSize: '14px',
                    fontWeight: '600',
                    marginBottom: '6px',
                  }}>
                    📈 {pair.pair}
                  </div>
                  <div style={{
                    color: '#888',
                    fontSize: '11px',
                    marginBottom: '6px',
                  }}>
                    {pair.exchange.toUpperCase()}
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '6px',
                    fontSize: '10px',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      <span>{hasCoinbase ? '✅' : '❌'}</span>
                      <span style={{
                        color: hasCoinbase ? '#4ade80' : '#ef4444',
                        fontStyle: 'italic',
                      }}>
                        {cbLabel}
                      </span>
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      <span>{hasKraken ? '✅' : '❌'}</span>
                      <span style={{
                        color: hasKraken ? '#6366f1' : '#ef4444',
                        fontStyle: 'italic',
                      }}>
                        {krkLabel}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid rgba(100, 100, 100, 0.3)',
        background: 'rgba(20, 20, 40, 0.5)',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
      }}>
        <div>
          <div style={{ color: '#888', fontSize: '11px' }}>Total LCX USDC</div>
          <div style={{ color: '#60a5fa', fontSize: '18px', fontWeight: '600' }}>
            {lcxPairs.usdc.length}
          </div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: '11px' }}>Total LCX EUR</div>
          <div style={{ color: '#fb923c', fontSize: '18px', fontWeight: '600' }}>
            {lcxPairs.eur.length}
          </div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: '11px' }}>EUR Comparison</div>
          <div style={{ color: '#d8b4fe', fontSize: '18px', fontWeight: '600' }}>
            {lcxPairs.eurComparison.length}
          </div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: '11px' }}>Total LCX Pairs</div>
          <div style={{ color: '#4ade80', fontSize: '18px', fontWeight: '600' }}>
            {lcxPairs.usdc.length + lcxPairs.eur.length}
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {selectedPair && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div style={{
            background: '#0a0e27',
            borderRadius: '12px',
            border: '1px solid rgba(100, 100, 150, 0.3)',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '24px',
            display: 'grid',
            gridTemplateColumns: (() => {
              const isEurComparison = activeTab === 'eur-comparison';
              if (isEurComparison) {
                // Count all variants in EUR Comparison mode
                let cols = 1; // LCX always
                if (selectedPair.on_coinbase_eur) cols++;
                if (selectedPair.on_coinbase_usdc) cols++;
                if (selectedPair.on_kraken_eur) cols++;
                if (selectedPair.on_kraken_usd) cols++;
                return `repeat(${cols}, 1fr)`;
              } else {
                // Standard mode
                const hasCB = selectedPair.on_coinbase;
                const hasKraken = selectedPair.on_kraken;
                if (hasCB && hasKraken) return 'repeat(3, 1fr)';
                if (hasCB || hasKraken) return 'repeat(2, 1fr)';
                return '1fr';
              }
            })(),
            gap: '20px',
          }}>
            {/* Close button */}
            <button
              onClick={() => setSelectedPair(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'rgba(255, 59, 48, 0.2)',
                border: '1px solid rgba(255, 59, 48, 0.5)',
                color: '#ff3b30',
                borderRadius: '6px',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
              }}>
              ✕ Close
            </button>

            {/* Title */}
            <div style={{
              gridColumn: '1 / -1',
              marginBottom: '16px',
              borderBottom: '1px solid rgba(100, 100, 150, 0.3)',
              paddingBottom: '12px',
            }}>
              <h2 style={{ color: '#fff', fontSize: '18px', margin: 0 }}>
                📊 {selectedPair.pair} - Exchange Comparison
              </h2>
            </div>

            {/* LCX Column */}
            <div style={{
              background: 'rgba(96, 165, 250, 0.1)',
              borderRadius: '8px',
              padding: '16px',
              border: pairDetails.lcx?.bid > 0 ? '1px solid rgba(96, 165, 250, 0.5)' : '1px solid rgba(96, 165, 250, 0.2)',
              opacity: pairDetails.lcx?.bid > 0 ? 1 : 0.6,
            }}>
              <h3 style={{ color: '#60a5fa', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                📍 LCX
                {pairDetails.lcx?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
              </h3>
              <div style={{ fontSize: '11px', color: '#60a5fa', marginBottom: '12px', fontWeight: '500' }}>
                {pairDetails.lcx?.symbol || selectedPair?.pair}
              </div>
              {detailsLoading ? (
                <div style={{ color: '#888' }}>⏳ Loading...</div>
              ) : pairDetails.lcx && pairDetails.lcx.bid > 0 ? (
                <div style={{ fontSize: '13px', color: '#ccc' }}>
                  <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails.lcx.bid?.toFixed(6)}</div>
                  <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails.lcx.ask?.toFixed(6)}</div>
                  <div><span style={{ color: '#888' }}>Last:</span> {pairDetails.lcx.last?.toFixed(6)}</div>
                  <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails.lcx.volume?.toFixed(2)}</div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
              )}
            </div>

            {/* Exchange Columns - Dynamic rendering for all variants */}
            {activeTab === 'eur-comparison' ? (
              <>
                {/* Coinbase EUR */}
                {selectedPair.on_coinbase_eur && (
                  <div style={{
                    background: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    border: pairDetails['coinbase-eur']?.bid > 0 ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(34, 197, 94, 0.2)',
                    opacity: pairDetails['coinbase-eur']?.bid > 0 ? 1 : 0.6,
                  }}>
                    <h3 style={{ color: '#22c55e', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      💰 Coinbase (EUR)
                      {pairDetails['coinbase-eur']?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#22c55e', marginBottom: '12px', fontWeight: '500' }}>
                      {pairDetails['coinbase-eur']?.symbol}
                    </div>
                    {detailsLoading ? (
                      <div style={{ color: '#888' }}>⏳ Loading...</div>
                    ) : pairDetails['coinbase-eur'] && pairDetails['coinbase-eur'].bid > 0 ? (
                      <div style={{ fontSize: '13px', color: '#ccc' }}>
                        <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails['coinbase-eur'].bid?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails['coinbase-eur'].ask?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Last:</span> {pairDetails['coinbase-eur'].last?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails['coinbase-eur'].volume?.toFixed(2)}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
                    )}
                  </div>
                )}

                {/* Coinbase USDC */}
                {selectedPair.on_coinbase_usdc && (
                  <div style={{
                    background: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    border: pairDetails['coinbase-usdc']?.bid > 0 ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(34, 197, 94, 0.2)',
                    opacity: pairDetails['coinbase-usdc']?.bid > 0 ? 1 : 0.6,
                  }}>
                    <h3 style={{ color: '#22c55e', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      💰 Coinbase (USDC)
                      {pairDetails['coinbase-usdc']?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#22c55e', marginBottom: '12px', fontWeight: '500' }}>
                      {pairDetails['coinbase-usdc']?.symbol}
                    </div>
                    {detailsLoading ? (
                      <div style={{ color: '#888' }}>⏳ Loading...</div>
                    ) : pairDetails['coinbase-usdc'] && pairDetails['coinbase-usdc'].bid > 0 ? (
                      <div style={{ fontSize: '13px', color: '#ccc' }}>
                        <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails['coinbase-usdc'].bid?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails['coinbase-usdc'].ask?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Last:</span> {pairDetails['coinbase-usdc'].last?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails['coinbase-usdc'].volume?.toFixed(2)}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
                    )}
                  </div>
                )}

                {/* Kraken EUR */}
                {selectedPair.on_kraken_eur && (
                  <div style={{
                    background: 'rgba(99, 102, 241, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    border: pairDetails['kraken-eur']?.bid > 0 ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(99, 102, 241, 0.2)',
                  }}>
                    <h3 style={{ color: '#6366f1', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ⚡ Kraken (EUR)
                      {pairDetails['kraken-eur']?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#6366f1', marginBottom: '12px', fontWeight: '500' }}>
                      {pairDetails['kraken-eur']?.symbol}
                    </div>
                    {detailsLoading ? (
                      <div style={{ color: '#888' }}>⏳ Loading...</div>
                    ) : pairDetails['kraken-eur'] && pairDetails['kraken-eur'].bid > 0 ? (
                      <div style={{ fontSize: '13px', color: '#ccc' }}>
                        <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails['kraken-eur'].bid?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails['kraken-eur'].ask?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Last:</span> {pairDetails['kraken-eur'].last?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails['kraken-eur'].volume?.toFixed(2)}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
                    )}
                  </div>
                )}

                {/* Kraken USD */}
                {selectedPair.on_kraken_usd && (
                  <div style={{
                    background: 'rgba(99, 102, 241, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    border: pairDetails['kraken-usd']?.bid > 0 ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(99, 102, 241, 0.2)',
                  }}>
                    <h3 style={{ color: '#6366f1', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ⚡ Kraken (USD)
                      {pairDetails['kraken-usd']?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#6366f1', marginBottom: '12px', fontWeight: '500' }}>
                      {pairDetails['kraken-usd']?.symbol}
                    </div>
                    {detailsLoading ? (
                      <div style={{ color: '#888' }}>⏳ Loading...</div>
                    ) : pairDetails['kraken-usd'] && pairDetails['kraken-usd'].bid > 0 ? (
                      <div style={{ fontSize: '13px', color: '#ccc' }}>
                        <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails['kraken-usd'].bid?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails['kraken-usd'].ask?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Last:</span> {pairDetails['kraken-usd'].last?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails['kraken-usd'].volume?.toFixed(2)}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Coinbase Column (Standard mode) */}
                {selectedPair.on_coinbase && (
                  <div style={{
                    background: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    border: pairDetails.coinbase?.bid > 0 ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(34, 197, 94, 0.2)',
                    opacity: pairDetails.coinbase?.bid > 0 ? 1 : 0.6,
                  }}>
                    <h3 style={{ color: '#22c55e', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      💰 Coinbase
                      {pairDetails.coinbase?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#22c55e', marginBottom: '12px', fontWeight: '500' }}>
                      {pairDetails.coinbase?.symbol || 'ADA-USDC'}
                    </div>
                    {detailsLoading ? (
                      <div style={{ color: '#888' }}>⏳ Loading...</div>
                    ) : pairDetails.coinbase && pairDetails.coinbase.bid > 0 ? (
                      <div style={{ fontSize: '13px', color: '#ccc' }}>
                        <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails.coinbase.bid?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails.coinbase.ask?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Last:</span> {pairDetails.coinbase.last?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails.coinbase.volume?.toFixed(2)}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
                    )}
                  </div>
                )}

                {/* Kraken Column (Standard mode) */}
                {selectedPair.on_kraken && (
                  <div style={{
                    background: 'rgba(99, 102, 241, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    border: pairDetails.kraken?.bid > 0 ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(99, 102, 241, 0.2)',
                  }}>
                    <h3 style={{ color: '#6366f1', fontSize: '16px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ⚡ Kraken
                      {pairDetails.kraken?.bid > 0 ? <span style={{ fontSize: '12px', color: '#4ade80' }}>✅ Live</span> : <span style={{ fontSize: '12px', color: '#f97316' }}>⊘ No Data</span>}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#6366f1', marginBottom: '12px', fontWeight: '500' }}>
                      {pairDetails.kraken?.symbol || 'ADA/USD'}
                    </div>
                    {detailsLoading ? (
                      <div style={{ color: '#888' }}>⏳ Loading...</div>
                    ) : pairDetails.kraken && pairDetails.kraken.bid > 0 ? (
                      <div style={{ fontSize: '13px', color: '#ccc' }}>
                        <div><span style={{ color: '#888' }}>Bid:</span> {pairDetails.kraken.bid?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Ask:</span> {pairDetails.kraken.ask?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Last:</span> {pairDetails.kraken.last?.toFixed(6)}</div>
                        <div><span style={{ color: '#888' }}>Vol:</span> {pairDetails.kraken.volume?.toFixed(2)}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#888' }}>Live ticker data not available</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
