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
  spreadPercentage: number | null;
  midpoint: number | null;
  lastUpdate: number;
  isConnected: boolean;
  status: string;
  bidVolume: number;
  askVolume: number;
}

interface TickerResponse {
  exchange: string;
  tickers: Array<{ symbol: string }>;
}

interface ArbitrageOpportunity {
  pair: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  profitPercentage: number;
  timestamp: number;
  type: string;
  details: string;
}

interface ExchangeStats {
  exchange: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercentage: number;
  bidVolume: number;
  askVolume: number;
  bidLevels: number;
  askLevels: number;
  timestamp: number;
}

const DEFAULT_ORDERBOOK: OrderbookState = {
  pair: '',
  bids: [],
  asks: [],
  spread: null,
  spreadPercentage: null,
  midpoint: null,
  lastUpdate: 0,
  isConnected: false,
  status: 'Loading...',
  bidVolume: 0,
  askVolume: 0,
};

const EXCHANGES = [
  { id: 'lcx', name: 'LCX', url: 'wss://exchange-api.lcx.com/ws' },
  { id: 'kraken', name: 'Kraken', url: 'wss://ws.kraken.com/v2' },
  { id: 'coinbase', name: 'Coinbase', url: 'wss://ws-feed.exchange.coinbase.com' },
];

const QUICK_PAIRS = [
  { label: 'LCX/USDC', pair: 'LCX/USDC' },
  { label: 'ETH/USDC', pair: 'ETH/USDC' },
  { label: 'BTC/USDC', pair: 'BTC/USDC' },
];

type TabType = 'orderbooks' | 'arbitrage' | 'allpairs' | 'analysis';

export const OrderbookAggregatesPage: React.FC = () => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('orderbooks');
  const [allPairsData, setAllPairsData] = useState<any>(null);
  const [allPairsLoading, setAllPairsLoading] = useState(false);
  const [selectedPair, setSelectedPair] = useState('LCX/USDC'); // Default to LCX/USDC
  const [pairSearch, setPairSearch] = useState('LCX/USDC');
  const [allPairsFilter, setAllPairsFilter] = useState(''); // Search filter for AllPairs tab
  const [selectedPairsForScan, setSelectedPairsForScan] = useState<Set<string>>(new Set()); // Pairs selected for scanning
  const [isScanningBatch, setIsScanningBatch] = useState(false); // Batch scan in progress
  const [batchScanResults, setBatchScanResults] = useState<any[]>([]); // Results from batch scan
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [showPairSuggestions, setShowPairSuggestions] = useState(false);
  const [pairsLoading, setPairsLoading] = useState(false);

  // Exchange selection (all on by default for arbitrage)
  const [selectedExchanges, setSelectedExchanges] = useState<Record<string, boolean>>({
    lcx: true,
    kraken: true,
    coinbase: true,
  });

  // Orderbooks for each exchange
  const [orderbooks, setOrderbooks] = useState<Record<string, OrderbookState>>({
    lcx: DEFAULT_ORDERBOOK,
    kraken: DEFAULT_ORDERBOOK,
    coinbase: DEFAULT_ORDERBOOK,
  });

  // Arbitrage opportunities
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<ArbitrageOpportunity[]>([]);
  
  // Exchange statistics
  const [exchangeStats, setExchangeStats] = useState<ExchangeStats[]>([]);

  const [exchangePairs, setExchangePairs] = useState<Record<string, string[]>>({
    lcx: [],
    kraken: [],
    coinbase: [],
  });

  const isMountedRef = useRef(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Debug: Log on mount
  useEffect(() => {
    console.log('[DEBUG] Component mounted!');
    console.log('[DEBUG] selectedPair:', selectedPair);
    console.log('[DEBUG] selectedExchanges:', selectedExchanges);
    return () => console.log('[DEBUG] Component unmounting');
  }, []);

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
            pairs[exchange] = data.symbols || [];
            console.log(`[${exchange.toUpperCase()}] ✅ Loaded ${pairs[exchange].length} pairs`);
          } catch (err) {
            console.error(`[${exchange.toUpperCase()}] ❌ Network error:`, err);
          }
        }

        console.log('\n[SUMMARY] Pairs by exchange:', pairs);
        setExchangePairs(pairs);

        // Get all unique pairs
        const allPairs = new Set<string>();
        Object.values(pairs).forEach(p => p.forEach(pair => allPairs.add(pair)));
        const uniquePairs = Array.from(allPairs).sort();
        console.log(`[SUMMARY] Total unique pairs: ${uniquePairs.length}`);
        setAvailablePairs(uniquePairs);
        console.log('====== PAIR FETCH COMPLETE ======\n');
      } catch (err) {
        console.error('[SYMBOLS] Unexpected error:', err);
      } finally {
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

  // Calculate statistics from orderbook
  const calculateStats = (exchange: string, bids: PriceLevel[], asks: PriceLevel[]): ExchangeStats => {
    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const spread = bestAsk - bestBid;
    const spreadPercentage = bestBid > 0 ? (spread / bestBid) * 100 : 0;
    const bidVolume = bids.reduce((sum, level) => sum + level.amount, 0);
    const askVolume = asks.reduce((sum, level) => sum + level.amount, 0);

    return {
      exchange,
      bestBid,
      bestAsk,
      spread,
      spreadPercentage,
      bidVolume,
      askVolume,
      bidLevels: bids.length,
      askLevels: asks.length,
      timestamp: Date.now(),
    };
  };

  // Find arbitrage opportunities
  const findArbitrageOpportunities = (stats: ExchangeStats[]): ArbitrageOpportunity[] => {
    const opportunities: ArbitrageOpportunity[] = [];

    // Compare each pair of exchanges
    for (let i = 0; i < stats.length; i++) {
      for (let j = i + 1; j < stats.length; j++) {
        const ex1 = stats[i];
        const ex2 = stats[j];

        // Skip if either exchange has no data
        if (ex1.bestBid === 0 || ex1.bestAsk === 0 || ex2.bestBid === 0 || ex2.bestAsk === 0) continue;

        // Check if we can buy on ex1 and sell on ex2
        if (ex1.bestAsk < ex2.bestBid) {
          const profit = ex2.bestBid - ex1.bestAsk;
          const profitPercentage = (profit / ex1.bestAsk) * 100;
          opportunities.push({
            pair: selectedPair,
            buyExchange: ex1.exchange,
            sellExchange: ex2.exchange,
            buyPrice: ex1.bestAsk,
            sellPrice: ex2.bestBid,
            profit,
            profitPercentage,
            timestamp: Date.now(),
            type: 'cross_exchange',
            details: `Buy on ${ex1.exchange} @ ${ex1.bestAsk.toFixed(8)}, Sell on ${ex2.exchange} @ ${ex2.bestBid.toFixed(8)}`,
          });
        }

        // Check if we can buy on ex2 and sell on ex1
        if (ex2.bestAsk < ex1.bestBid) {
          const profit = ex1.bestBid - ex2.bestAsk;
          const profitPercentage = (profit / ex2.bestAsk) * 100;
          opportunities.push({
            pair: selectedPair,
            buyExchange: ex2.exchange,
            sellExchange: ex1.exchange,
            buyPrice: ex2.bestAsk,
            sellPrice: ex1.bestBid,
            profit,
            profitPercentage,
            timestamp: Date.now(),
            type: 'cross_exchange',
            details: `Buy on ${ex2.exchange} @ ${ex2.bestAsk.toFixed(8)}, Sell on ${ex1.exchange} @ ${ex1.bestBid.toFixed(8)}`,
          });
        }
      }
    }

    // Sort by profit percentage descending
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  };

  // Fetch arbitrage opportunities from backend
  const fetchArbitrageOpportunitiesFromBackend = async (pair: string): Promise<ArbitrageOpportunity[]> => {
    try {
      const response = await fetch(`http://127.0.0.1:8000/public/arbitrage-scan?symbol=${encodeURIComponent(pair)}`);
      if (!response.ok) {
        console.warn('Backend arbitrage scan failed, using local calculation');
        return [];
      }
      const data = await response.json();

      // Convert backend response to frontend format
      return data.results.map((result: any) => {
        // Extract prices from details string (e.g., "Buy @71276.39, Sell @71277.10")
        let buyPrice = 0;
        let sellPrice = 0;

        const buyMatch = result.details.match(/@([\d.]+)/);
        const sellMatch = result.details.match(/Sell @([\d.]+)|Sell @([\d.]+)/);

        if (buyMatch) buyPrice = parseFloat(buyMatch[1]);
        if (sellMatch) sellPrice = parseFloat(sellMatch[1] || sellMatch[2]);

        return {
          pair: result.pair,
          buyExchange: result.exchange_a,
          sellExchange: result.exchange_b,
          buyPrice: buyPrice,
          sellPrice: sellPrice,
          profit: sellPrice > 0 && buyPrice > 0 ? sellPrice - buyPrice : 0,
          profitPercentage: result.gross_profit_pct,
          timestamp: Date.now(),
          type: result.type,
          details: result.details,
        };
      }) || [];
    } catch (err) {
      console.warn('Failed to fetch arbitrage opportunities from backend:', err);
      return [];
    }
  };

  // Fetch all pairs data
  const fetchAllPairsData = async () => {
    console.log('🔄 Fetching all pairs data from backend...');
    setAllPairsLoading(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/public/arbitrage-scan-all');
      console.log('📡 Response status:', response.status);
      if (!response.ok) {
        throw new Error(`Failed to fetch all pairs data: ${response.status}`);
      }
      const data = await response.json();
      console.log('✅ All pairs data loaded:', {
        usdCount: data.groups?.USD_USDC?.pair_count,
        eurCount: data.groups?.EUR?.pair_count,
        totalPairs: data.total_common_pairs,
      });
      setAllPairsData(data);
    } catch (err) {
      console.error('❌ Error fetching all pairs:', err);
      setAllPairsData(null);
    } finally {
      setAllPairsLoading(false);
    }
  };

  // Batch scan multiple pairs for arbitrage opportunities
  const batchScanPairs = async (pairs: string[]) => {
    console.log('🔄 Starting batch scan of', pairs.length, 'pairs...');
    setIsScanningBatch(true);
    const results: any[] = [];

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      console.log(`📊 Scanning ${i + 1}/${pairs.length}: ${pair}`);

      try {
        // Fetch orderbooks for this pair
        await fetchAllOrderbooks(pair);

        // Get arbitrage opportunities from backend
        const opportunities = await fetchArbitrageOpportunitiesFromBackend(pair);

        results.push({
          pair,
          opportunities,
          timestamp: Date.now(),
          profitableCount: opportunities.filter((o: any) => o.profitPercentage > 0.1).length,
        });

        // Add delay to avoid rate limiting (200ms between requests)
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`❌ Error scanning ${pair}:`, err);
        results.push({
          pair,
          opportunities: [],
          error: String(err),
          timestamp: Date.now(),
        });
      }
    }

    console.log('✅ Batch scan complete. Found', results.reduce((sum, r) => sum + r.opportunities.length, 0), 'opportunities');
    setBatchScanResults(results);
    setIsScanningBatch(false);
    // Keep in AllPairs tab to show results inline
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
        const bids = data.bids || [];
        const asks = data.asks || [];
        const bestBid = data.bestBid || 0;
        const bestAsk = data.bestAsk || 0;
        const spread = data.spread || 0;
        const spreadPercentage = bestBid > 0 ? (spread / bestBid) * 100 : 0;
        const midpoint = data.midpoint || 0;
        const bidVolume = bids.reduce((sum: number, level: PriceLevel) => sum + level.amount, 0);
        const askVolume = asks.reduce((sum: number, level: PriceLevel) => sum + level.amount, 0);

        setOrderbooks(prev => ({
          ...prev,
          [exchange]: {
            pair,
            bids,
            asks,
            spread,
            spreadPercentage,
            midpoint,
            lastUpdate: Date.now(),
            isConnected: true,
            status: `Live - ${bids.length} bids, ${asks.length} asks`,
            bidVolume,
            askVolume,
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

  // State for arbitrage filter
  const [arbitrageFilter, setArbitrageFilter] = useState<string | null>(null);

  // Enrich opportunities with real bid/ask prices from orderbooks
  const enrichedOpportunities = arbitrageOpportunities.map(opp => {
    // For same-exchange trades (spread, OFI), get bid/ask from orderbook
    if (opp.buyExchange === opp.sellExchange) {
      const ob = orderbooks[opp.buyExchange];
      if (ob && ob.bids.length > 0 && ob.asks.length > 0) {
        return {
          ...opp,
          buyPrice: ob.bids[0].price,  // Best bid
          sellPrice: ob.asks[0].price,  // Best ask
        };
      }
    }
    return opp;
  });

  // Group opportunities by type
  const groupedOpportunities = enrichedOpportunities.reduce((acc, opp) => {
    const key = opp.type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(opp);
    return acc;
  }, {} as Record<string, ArbitrageOpportunity[]>);

  // Get model info by type
  const getModelInfo = (type: string) => {
    const models: Record<string, {icon: string, name: string, desc: string}> = {
      'cross_exchange': {
        icon: '🔄',
        name: 'Cross-Exchange',
        desc: 'Buy on exchange A, sell on exchange B'
      },
      'spread_analysis': {
        icon: '📊',
        name: 'Spread Scalping',
        desc: 'Wide bid-ask spread on same exchange'
      },
      'volume_pressure': {
        icon: '🌊',
        name: 'Volume Imbalance (OFI)',
        desc: 'Order Flow Imbalance - bullish/bearish signal'
      },
      'orderbook_hole': {
        icon: '🕳️',
        name: 'Orderbook Hole',
        desc: 'Price gap in orderbook levels'
      },
      'latency_lead': {
        icon: '⚡',
        name: 'Latency Arbitrage',
        desc: 'Exploit API response time differences'
      },
      'api_stale_data': {
        icon: '🫀',
        name: 'Data Freshness',
        desc: 'Stale vs fresh orderbook data validation'
      },
    };
    return models[type] || { icon: '?', name: type, desc: 'Unknown type' };
  };

  // Fetch data for all selected exchanges and update stats/arbitrage
  const fetchAllOrderbooks = async (pair: string) => {
    if (!pair) return;

    // Fetch all exchanges in parallel
    const promises = Object.entries(selectedExchanges)
      .filter(([_, isSelected]) => isSelected)
      .map(([exchange]) => fetchOrderbookForExchange(exchange, pair));

    await Promise.allSettled(promises);

    // Update statistics and arbitrage opportunities
    const stats: ExchangeStats[] = [];
    for (const [exchange, isSelected] of Object.entries(selectedExchanges)) {
      if (isSelected && orderbooks[exchange].bids.length > 0) {
        stats.push(calculateStats(exchange, orderbooks[exchange].bids, orderbooks[exchange].asks));
      }
    }

    setExchangeStats(stats);

    // Try to fetch arbitrage opportunities from backend first
    const backendOpportunities = await fetchArbitrageOpportunitiesFromBackend(pair);
    if (backendOpportunities.length > 0) {
      setArbitrageOpportunities(backendOpportunities);
    } else {
      // Fall back to local calculation
      setArbitrageOpportunities(findArbitrageOpportunities(stats));
    }
  };

  // Auto-refresh when pair changes
  useEffect(() => {
    if (!selectedPair) return;

    let pollCount = 0;
    const pollOrderbooks = async () => {
      if (isMountedRef.current) {
        pollCount++;
        if (pollCount % 10 === 0) {
          console.log(`[POLL] #${pollCount} - Fetching ${selectedPair} from`, Object.keys(selectedExchanges).filter(k => selectedExchanges[k]));
        }
        await fetchAllOrderbooks(selectedPair);
      }
    };

    // Initial fetch
    console.log(`[POLL] Starting poll for ${selectedPair}`);
    pollOrderbooks();

    // Refresh every 100ms for real-time feel
    const interval = setInterval(pollOrderbooks, 100);
    refreshIntervalRef.current = interval;

    return () => {
      console.log(`[POLL] Stopping poll for ${selectedPair}`);
      clearInterval(interval);
    };
  }, [selectedPair, selectedExchanges]);

  // Load all pairs data when AllPairs tab becomes active
  useEffect(() => {
    if (activeTab === 'allpairs' && !allPairsData && !allPairsLoading) {
      fetchAllPairsData();
    }
  }, [activeTab]);

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

  const handleQuickPairSelect = (pair: string) => {
    setSelectedPair(pair);
    setPairSearch(pair);
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

  const formatProfit = (profit: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(profit);
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

  const getExchangeName = (exchangeId: string): string => {
    return EXCHANGES.find(e => e.id === exchangeId)?.name || exchangeId;
  };

  return (
    <div className="orderbook-ws-page">
      {/* Header */}
      <div className="orderbook-header">
        <h1>Multi-Exchange Dashboard</h1>
        
        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => setActiveTab('orderbooks')}
            style={{
              padding: '10px 20px',
              background: activeTab === 'orderbooks' ? '#3b82f6' : '#2a2a2a',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: activeTab === 'orderbooks' ? '600' : '400',
            }}
          >
            📊 Orderbooks
          </button>
          <button
            onClick={() => setActiveTab('arbitrage')}
            style={{
              padding: '10px 20px',
              background: activeTab === 'arbitrage' ? '#3b82f6' : '#2a2a2a',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: activeTab === 'arbitrage' ? '600' : '400',
            }}
          >
            ⚡ Arbitrage Scanner
          </button>
          <button
            onClick={() => {
              setActiveTab('allpairs');
              if (!allPairsData) fetchAllPairsData();
            }}
            style={{
              padding: '10px 20px',
              background: activeTab === 'allpairs' ? '#3b82f6' : '#2a2a2a',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: activeTab === 'allpairs' ? '600' : '400',
            }}
          >
            📋 All Pairs
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            style={{
              padding: '10px 20px',
              background: activeTab === 'analysis' ? '#3b82f6' : '#2a2a2a',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: activeTab === 'analysis' ? '600' : '400',
            }}
          >
            📈 Market Analysis
          </button>
        </div>

        <div className="header-controls" style={{ flexWrap: 'wrap', gap: '16px' }}>
          {/* Quick Pairs */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ color: '#ccc', fontWeight: 'bold' }}>Quick Pairs:</label>
            {QUICK_PAIRS.map(({ label, pair }) => (
              <button
                key={pair}
                onClick={() => handleQuickPairSelect(pair)}
                style={{
                  padding: '6px 12px',
                  background: selectedPair === pair ? '#3b82f6' : '#2a2a2a',
                  color: '#fff',
                  border: '1px solid #444',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: selectedPair === pair ? '600' : '400',
                }}
              >
                {label}
              </button>
            ))}
          </div>

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
              Custom Pair:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <input
                type="text"
                placeholder={pairsLoading ? 'Loading pairs...' : 'Search pair...'}
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

      {/* Orderbooks Tab */}
      {activeTab === 'orderbooks' && (
        <div style={{ padding: '16px' }}>
          {!selectedPair ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '60px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #444' }}>
              <div style={{ fontSize: '24px', marginBottom: '16px' }}>📊</div>
              <div style={{ fontSize: '18px', marginBottom: '8px' }}>Select a trading pair</div>
              <div style={{ fontSize: '14px', color: '#666' }}>Choose from {availablePairs.length} available pairs</div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '12px'
            }}>
              {Object.entries(selectedExchanges)
                .filter(([_, isSelected]) => isSelected)
                .map(([exchangeId]) => {
                  const exchange = EXCHANGES.find(e => e.id === exchangeId);
                  const ob = orderbooks[exchangeId];
                  const askLevels = [...ob.asks].sort((a, b) => a.price - b.price).slice(0, 10);
                  const bidLevels = [...ob.bids].sort((a, b) => b.price - a.price).slice(0, 10);

                  return (
                    <div
                      key={exchangeId}
                      style={{
                        border: '1px solid rgba(68, 68, 68, 0.5)',
                        borderRadius: '12px',
                        padding: '12px',
                        background: 'linear-gradient(145deg, #1a1a1a 0%, #151515 100%)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        maxHeight: '400px',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Exchange Header */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px',
                        paddingBottom: '6px',
                        borderBottom: '1px solid rgba(68, 68, 68, 0.3)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: ob.isConnected ? '#4ade80' : '#f87171',
                          }} />
                          <h4 style={{ margin: 0, color: '#fff', fontSize: '13px', fontWeight: '600' }}>
                            {exchange?.name}
                          </h4>
                        </div>
                        <span style={{ fontSize: '9px', color: '#666' }}>
                          {getTimeSinceUpdate(ob.lastUpdate)}
                        </span>
                      </div>

                      {/* Quick Stats - 2x2 grid */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '4px',
                        marginBottom: '8px'
                      }}>
                        <div style={{ background: 'rgba(20, 20, 20, 0.8)', padding: '4px 6px', borderRadius: '4px', textAlign: 'center' }}>
                          <div style={{ color: '#4ade80', fontSize: '9px' }}>Bid</div>
                          <div style={{ color: '#fff', fontSize: '11px', fontWeight: '600' }}>
                            {ob.bids.length > 0 ? formatPrice(ob.bids[0].price) : '—'}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(20, 20, 20, 0.8)', padding: '4px 6px', borderRadius: '4px', textAlign: 'center' }}>
                          <div style={{ color: '#f87171', fontSize: '9px' }}>Ask</div>
                          <div style={{ color: '#fff', fontSize: '11px', fontWeight: '600' }}>
                            {ob.asks.length > 0 ? formatPrice(ob.asks[0].price) : '—'}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(20, 20, 20, 0.8)', padding: '4px 6px', borderRadius: '4px', textAlign: 'center' }}>
                          <div style={{ color: '#60a5fa', fontSize: '9px' }}>Sprd</div>
                          <div style={{ color: '#fff', fontSize: '11px', fontWeight: '600' }}>
                            {ob.spreadPercentage !== null ? ob.spreadPercentage.toFixed(2) + '%' : '—'}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(20, 20, 20, 0.8)', padding: '4px 6px', borderRadius: '4px', textAlign: 'center' }}>
                          <div style={{ color: '#fbbf24', fontSize: '9px' }}>Mid</div>
                          <div style={{ color: '#fff', fontSize: '11px', fontWeight: '600' }}>
                            {ob.midpoint !== null ? formatPrice(ob.midpoint) : '—'}
                          </div>
                        </div>
                      </div>

                      {/* Orderbook Tables */}
                      <div style={{
                        display: 'flex',
                        gap: '6px',
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden'
                      }}>
                        {/* Asks */}
                        <div style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          background: 'rgba(30, 30, 30, 0.6)',
                          borderRadius: '6px',
                          padding: '6px',
                          minWidth: 0
                        }}>
                          <div style={{
                            color: '#f87171',
                            fontSize: '9px',
                            fontWeight: '600',
                            marginBottom: '4px',
                          }}>
                            ASKS
                          </div>
                          <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            fontSize: '10px',
                          }}>
                            {askLevels.length > 0 ? (
                              askLevels.map((level, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '2px 0',
                                    borderBottom: '1px solid rgba(68, 68, 68, 0.2)',
                                    color: '#f87171'
                                  }}
                                >
                                  <span>{formatPrice(level.price)}</span>
                                  <span style={{fontSize: '9px'}}>{formatAmount(level.amount)}</span>
                                </div>
                              ))
                            ) : (
                              <div style={{color: '#666', fontSize: '9px'}}>No data</div>
                            )}
                          </div>
                        </div>

                        {/* Bids */}
                        <div style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          background: 'rgba(30, 30, 30, 0.6)',
                          borderRadius: '6px',
                          padding: '6px',
                          minWidth: 0
                        }}>
                          <div style={{
                            color: '#4ade80',
                            fontSize: '9px',
                            fontWeight: '600',
                            marginBottom: '4px',
                          }}>
                            BIDS
                          </div>
                          <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            fontSize: '10px',
                          }}>
                            {bidLevels.length > 0 ? (
                              bidLevels.map((level, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '2px 0',
                                    borderBottom: '1px solid rgba(68, 68, 68, 0.2)',
                                    color: '#4ade80'
                                  }}
                                >
                                  <span>{formatPrice(level.price)}</span>
                                  <span style={{fontSize: '9px'}}>{formatAmount(level.amount)}</span>
                                </div>
                              ))
                            ) : (
                              <div style={{color: '#666', fontSize: '9px'}}>No data</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Volume Summary */}
                      <div style={{
                        fontSize: '9px',
                        color: '#777',
                        marginTop: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        borderTop: '1px solid rgba(68, 68, 68, 0.2)',
                        paddingTop: '4px'
                      }}>
                        <span>B: {ob.bidVolume > 0 ? formatAmount(ob.bidVolume) : '—'}</span>
                        <span>A: {ob.askVolume > 0 ? formatAmount(ob.askVolume) : '—'}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Arbitrage Tab */}
      {activeTab === 'arbitrage' && (
        <div style={{ padding: '16px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ color: '#fff', fontSize: '18px', marginBottom: '4px' }}>⚡ Arbitrage Scanner & Types</h2>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '12px' }}>
              Select pairs to scan for real-time arbitrage opportunities
            </p>
          </div>

          {/* Pair Selector */}
          <div style={{
            background: 'rgba(30, 30, 30, 0.8)',
            border: '1px solid rgba(68, 68, 68, 0.5)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px'
          }}>
            <div style={{ color: '#aaa', fontSize: '11px', fontWeight: '600', marginBottom: '8px' }}>
              📋 Quick Pairs:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {QUICK_PAIRS.map(p => (
                <button
                  key={p.pair}
                  onClick={() => {
                    setSelectedPair(p.pair);
                    setPairSearch(p.pair);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: selectedPair === p.pair ? '2px solid #4ade80' : '1px solid #555',
                    background: selectedPair === p.pair ? 'rgba(74, 222, 128, 0.2)' : 'rgba(50, 50, 50, 0.6)',
                    color: selectedPair === p.pair ? '#4ade80' : '#aaa',
                    cursor: 'pointer',
                    fontSize: '11px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ color: '#aaa', fontSize: '11px', fontWeight: '600', marginBottom: '6px' }}>
              🔍 Custom Pair:
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="e.g., BTC/USDC, ETH/EUR..."
                value={pairSearch}
                onChange={(e) => setPairSearch(e.target.value.toUpperCase())}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && pairSearch) {
                    setSelectedPair(pairSearch);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #555',
                  background: 'rgba(40, 40, 40, 0.8)',
                  color: '#fff',
                  fontSize: '11px',
                  outline: 'none',
                  transition: 'border 0.2s ease'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#4ade80';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#555';
                }}
              />
              <button
                onClick={() => {
                  if (pairSearch) setSelectedPair(pairSearch);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid #4ade80',
                  background: 'rgba(74, 222, 128, 0.2)',
                  color: '#4ade80',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(74, 222, 128, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(74, 222, 128, 0.2)';
                }}
              >
                Scan
              </button>
            </div>
          </div>

          {/* Status Message */}
          {selectedPair && (
            <div style={{
              background: 'rgba(96, 165, 250, 0.1)',
              border: '1px solid rgba(96, 165, 250, 0.3)',
              borderRadius: '6px',
              padding: '10px',
              marginBottom: '12px',
              fontSize: '12px',
              color: '#60a5fa'
            }}>
              📡 Scanning <strong>{selectedPair}</strong> on LCX, Kraken, Coinbase...
              {arbitrageOpportunities.length > 0 && (
                <span style={{ color: '#4ade80', fontWeight: '600', marginLeft: '8px' }}>
                  ✅ Found {arbitrageOpportunities.length} opportunities!
                </span>
              )}
              {arbitrageOpportunities.length === 0 && (
                <span style={{ color: '#ff9500', fontWeight: '600', marginLeft: '8px' }}>
                  ⏳ Scanning...
                </span>
              )}
            </div>
          )}

          {/* Live Opportunities by Model Type */}
          {arbitrageOpportunities.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ color: '#4ade80', fontSize: '14px', marginBottom: '12px' }}>🚀 Active Opportunities ({arbitrageOpportunities.length})</h3>

              {/* Filter Buttons */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '12px',
                fontSize: '11px'
              }}>
                <button
                  onClick={() => setArbitrageFilter(null)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: arbitrageFilter === null ? '2px solid #4ade80' : '1px solid #555',
                    background: arbitrageFilter === null ? 'rgba(74, 222, 128, 0.2)' : 'rgba(50, 50, 50, 0.6)',
                    color: arbitrageFilter === null ? '#4ade80' : '#aaa',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  All ({arbitrageOpportunities.length})
                </button>
                {Object.entries(groupedOpportunities).map(([type, opps]) => {
                  const model = getModelInfo(type);
                  return (
                    <button
                      key={type}
                      onClick={() => setArbitrageFilter(type)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        border: arbitrageFilter === type ? '2px solid #60a5fa' : '1px solid #555',
                        background: arbitrageFilter === type ? 'rgba(96, 165, 250, 0.2)' : 'rgba(50, 50, 50, 0.6)',
                        color: arbitrageFilter === type ? '#60a5fa' : '#aaa',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {model.icon} {model.name} ({opps.length})
                    </button>
                  );
                })}
              </div>

              {/* Grouped Opportunities */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {Object.entries(groupedOpportunities)
                  .filter(([type]) => arbitrageFilter === null || arbitrageFilter === type)
                  .map(([type, opps]) => {
                    const model = getModelInfo(type);
                    return (
                      <div key={type}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '8px',
                          paddingBottom: '8px',
                          borderBottom: '1px solid rgba(96, 165, 250, 0.3)'
                        }}>
                          <span style={{ fontSize: '16px' }}>{model.icon}</span>
                          <div>
                            <div style={{ color: '#60a5fa', fontSize: '12px', fontWeight: '600' }}>
                              {model.name}
                            </div>
                            <div style={{ color: '#888', fontSize: '10px' }}>
                              {model.desc}
                            </div>
                          </div>
                          <span style={{
                            marginLeft: 'auto',
                            background: 'rgba(96, 165, 250, 0.2)',
                            color: '#60a5fa',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '10px'
                          }}>
                            {opps.length} found
                          </span>
                        </div>

                        {/* Opportunities for this model */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '8px' }}>
                          {opps.map((opp, idx) => (
                            <div
                              key={idx}
                              style={{
                                background: 'linear-gradient(145deg, rgba(30, 100, 30, 0.3), rgba(20, 80, 20, 0.3))',
                                border: '1px solid rgba(74, 222, 128, 0.4)',
                                borderRadius: '6px',
                                padding: '12px',
                                boxShadow: '0 0 10px rgba(74, 222, 128, 0.15)',
                              }}
                            >
                              {/* Profit Badge */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{
                                  background: '#4ade80',
                                  color: '#000',
                                  padding: '4px 10px',
                                  borderRadius: '12px',
                                  fontSize: '12px',
                                  fontWeight: '700'
                                }}>
                                  💰 {opp.profitPercentage.toFixed(2)}% Profit
                                </span>
                                <span style={{ color: '#4ade80', fontSize: '11px', fontWeight: '600' }}>
                                  Confidence: {opp.type === 'volume_pressure' || opp.type === 'latency_lead' ? '70%' : '95%'}
                                </span>
                              </div>

                              {/* Buy Section */}
                              <div style={{
                                background: 'rgba(255, 100, 100, 0.1)',
                                border: '1px solid rgba(255, 100, 100, 0.3)',
                                borderRadius: '4px',
                                padding: '8px',
                                marginBottom: '8px'
                              }}>
                                <div style={{ color: '#ff6464', fontSize: '10px', fontWeight: '600', marginBottom: '2px' }}>
                                  🔴 BUY {opp.type === 'spread_analysis' || opp.type === 'volume_pressure' ? 'AT BID' : 'ON'}: {getExchangeName(opp.buyExchange).toUpperCase()}
                                </div>
                                <div style={{ color: '#fff', fontSize: '14px', fontWeight: '700' }}>
                                  {opp.buyPrice > 0 ? formatPrice(opp.buyPrice) : 'N/A'}
                                </div>
                                {(opp.type === 'spread_analysis' || opp.type === 'volume_pressure') && (
                                  <div style={{ color: '#ffb3b3', fontSize: '9px', marginTop: '2px' }}>
                                    Best bid (LIMIT ORDER)
                                  </div>
                                )}
                              </div>

                              {/* Sell Section */}
                              <div style={{
                                background: 'rgba(100, 255, 100, 0.1)',
                                border: '1px solid rgba(100, 255, 100, 0.3)',
                                borderRadius: '4px',
                                padding: '8px',
                                marginBottom: '8px'
                              }}>
                                <div style={{ color: '#64ff64', fontSize: '10px', fontWeight: '600', marginBottom: '2px' }}>
                                  🟢 SELL {opp.type === 'spread_analysis' || opp.type === 'volume_pressure' ? 'AT ASK' : 'ON'}: {getExchangeName(opp.sellExchange).toUpperCase()}
                                </div>
                                <div style={{ color: '#fff', fontSize: '14px', fontWeight: '700' }}>
                                  {opp.sellPrice > 0 ? formatPrice(opp.sellPrice) : 'N/A'}
                                </div>
                                {(opp.type === 'spread_analysis' || opp.type === 'volume_pressure') && (
                                  <div style={{ color: '#b3ffb3', fontSize: '9px', marginTop: '2px' }}>
                                    Best ask (LIMIT ORDER)
                                  </div>
                                )}
                              </div>

                              {/* Profit Calculation */}
                              {opp.buyPrice > 0 && opp.sellPrice > 0 && (
                                <div style={{
                                  background: 'rgba(200, 200, 200, 0.05)',
                                  borderRadius: '4px',
                                  padding: '6px',
                                  fontSize: '10px',
                                  color: '#ccc',
                                  marginBottom: '8px',
                                  textAlign: 'center'
                                }}>
                                  <div>
                                    Spread: {(opp.sellPrice - opp.buyPrice).toFixed(8)} ({((opp.sellPrice - opp.buyPrice) / opp.buyPrice * 100).toFixed(3)}%)
                                  </div>
                                </div>
                              )}

                              {/* Orderbook Depth View */}
                              {type === 'cross_exchange' && (
                                <div style={{ marginBottom: '8px' }}>
                                  <div style={{ fontSize: '10px', color: '#888', fontWeight: '600', marginBottom: '6px' }}>
                                    📊 Orderbook Depth
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                    {/* Buy Exchange Depth */}
                                    <div style={{
                                      background: 'rgba(255, 100, 100, 0.05)',
                                      border: '1px solid rgba(255, 100, 100, 0.2)',
                                      borderRadius: '4px',
                                      padding: '6px',
                                      fontSize: '9px'
                                    }}>
                                      <div style={{ color: '#ff6464', fontWeight: '600', marginBottom: '4px' }}>
                                        {getExchangeName(opp.buyExchange).toUpperCase()}
                                      </div>
                                      {orderbooks[opp.buyExchange] && orderbooks[opp.buyExchange].bids.length > 0 ? (
                                        <div>
                                          {orderbooks[opp.buyExchange].bids.slice(0, 3).map((level, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#ccc', marginBottom: '2px' }}>
                                              <span>{formatPrice(level.price)}</span>
                                              <span style={{ color: '#999', fontSize: '8px' }}>({formatAmount(level.amount)})</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div style={{ color: '#666' }}>No data</div>
                                      )}
                                    </div>

                                    {/* Sell Exchange Depth */}
                                    <div style={{
                                      background: 'rgba(100, 255, 100, 0.05)',
                                      border: '1px solid rgba(100, 255, 100, 0.2)',
                                      borderRadius: '4px',
                                      padding: '6px',
                                      fontSize: '9px'
                                    }}>
                                      <div style={{ color: '#64ff64', fontWeight: '600', marginBottom: '4px' }}>
                                        {getExchangeName(opp.sellExchange).toUpperCase()}
                                      </div>
                                      {orderbooks[opp.sellExchange] && orderbooks[opp.sellExchange].asks.length > 0 ? (
                                        <div>
                                          {orderbooks[opp.sellExchange].asks.slice(0, 3).map((level, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#ccc', marginBottom: '2px' }}>
                                              <span>{formatPrice(level.price)}</span>
                                              <span style={{ color: '#999', fontSize: '8px' }}>({formatAmount(level.amount)})</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div style={{ color: '#666' }}>No data</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Multiple Scenarios */}
                              {type === 'cross_exchange' && opp.buyPrice > 0 && opp.sellPrice > 0 && (
                                <div style={{
                                  background: 'rgba(100, 150, 255, 0.05)',
                                  border: '1px solid rgba(100, 150, 255, 0.2)',
                                  borderRadius: '4px',
                                  padding: '6px',
                                  marginBottom: '8px',
                                  fontSize: '9px'
                                }}>
                                  <div style={{ color: '#60a5fa', fontWeight: '600', marginBottom: '4px' }}>
                                    💡 Profit Scenarios
                                  </div>
                                  {[1, 5, 10, 25].map(qty => {
                                    const profitPerUnit = opp.sellPrice - opp.buyPrice;
                                    const totalProfit = profitPerUnit * qty;
                                    const totalCost = opp.buyPrice * qty;
                                    const profitPct = (totalProfit / totalCost) * 100;
                                    return (
                                      <div key={qty} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', color: '#ccc' }}>
                                        <span>{qty} units:</span>
                                        <span style={{ color: '#4ade80' }}>
                                          +${totalProfit.toFixed(2)} ({profitPct.toFixed(2)}%)
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Details */}
                              <div style={{ fontSize: '9px', color: '#888', fontStyle: 'italic', borderTop: '1px solid rgba(68, 68, 68, 0.3)', paddingTop: '6px' }}>
                                {opp.details}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Arbitrage Types Guide */}
          <div style={{
            background: 'linear-gradient(145deg, #1e1e1e 0%, #1a1a1a 100%)',
            border: '1px solid rgba(68, 68, 68, 0.4)',
            borderRadius: '8px',
            padding: '12px'
          }}>
            <h3 style={{ color: '#fff', fontSize: '13px', margin: '0 0 10px 0', fontWeight: '600' }}>📚 30+ Arbitrage Strategies</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '8px', fontSize: '11px' }}>
              {[
                { icon: '🔄', type: 'Cross-Exchange', desc: 'Buy on exchange A, sell on B (LCX ↔ Kraken ↔ Coinbase)' },
                { icon: '🔺', type: 'Triangular', desc: 'Loop between 3 pairs on same exchange (USDC→BTC→ETH→USDC)' },
                { icon: '📊', type: 'Spot-Futures', desc: 'Buy spot, sell futures to collect basis/premiums' },
                { icon: '💰', type: 'Funding Rate', desc: 'Earn periodic payments from perpetual traders' },
                { icon: '🌉', type: 'CEX-DEX', desc: 'Price gap between Binance/Kraken and Uniswap/PancakeSwap' },
                { icon: '📢', type: 'Listing', desc: 'Buy before new exchange listing (Coinbase Effect)' },
                { icon: '⚡', type: 'Flash Loan', desc: 'DeFi profit loops with instant loans (no capital needed)' },
                { icon: '🏛️', type: 'Liquid Staking', desc: 'ETH vs stETH (Lido) price differences' },
                { icon: '🎯', type: 'Stablecoin De-peg', desc: 'Buy stables below $1.00, wait for peg recovery' },
                { icon: '📈', type: 'Pairs Trading', desc: 'Mean reversion between correlated assets (BTC ↔ ETH)' },
                { icon: '🌐', type: 'Cross-Chain', desc: 'Price gaps across chains (Polygon vs Arbitrum USDC)' },
                { icon: '📑', type: 'Crypto ETF', desc: 'Price vs NAV (Net Asset Value) difference' },
                { icon: '🔀', type: 'Hard Fork', desc: 'Free coins from network splits (positioning beforehand)' },
                { icon: '⏱️', type: 'Network Latency', desc: 'Exploit slow confirmation times on some exchanges' },
                { icon: '💧', type: 'Illiquid Pairs', desc: 'Large orders moving prices on small exchanges' },
                { icon: '🎁', type: 'Bonus Washing', desc: 'Spread between positions to wash registration bonuses' },
                { icon: '🟦', type: 'L2 Solutions', desc: 'Gaps between Arbitrum/Optimism solutions' },
                { icon: '📦', type: 'Wrapped Tokens', desc: 'BTC vs WBTC, ETH vs WETH differences' },
                { icon: '💧', type: 'LP Token', desc: 'Pool reserves vs market price arbitrage' },
                { icon: '🚀', type: 'MEV/Sandwich', desc: 'Monitor mempool for profitable front-running' },
                { icon: '📉', type: 'Options Vol', desc: 'Volatility differences across Deribit/OKX' },
                { icon: '💱', type: 'Inter-Fiat', desc: 'FX rates (USD vs EUR) to buy cheaper crypto' },
                { icon: '💸', type: 'Withdrawal Fee', desc: 'Token cheaper where network fees are high' },
                { icon: '🛡️', type: 'Regulatory', desc: 'Geographic restrictions (Kimchi Premium in Korea)' },
                { icon: '🌾', type: 'Yield Farming', desc: 'Move capital between DeFi protocols for best APY' },
                { icon: '🔌', type: 'API Lag', desc: 'Outdated price feeds on some exchange APIs' },
                { icon: '🤝', type: 'OTC Trading', desc: 'Buy bulk at fixed price, sell on public market' },
                { icon: '⚖️', type: 'Index Rebalance', desc: 'Anticipate fund buying/selling at rebalance' },
                { icon: '📉', type: 'Distressed', desc: 'Bankrupt project tokens on recovery news' },
                { icon: '🧩', type: 'DEX Aggregation', desc: 'Find cheapest route across 10+ liquidity pools' },
              ].map((strat, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(40, 40, 40, 0.6)',
                    border: '1px solid rgba(68, 68, 68, 0.3)',
                    borderRadius: '6px',
                    padding: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(60, 60, 60, 0.8)';
                    e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(40, 40, 40, 0.6)';
                    e.currentTarget.style.borderColor = 'rgba(68, 68, 68, 0.3)';
                  }}
                >
                  <div style={{ color: '#fff', fontWeight: '600', marginBottom: '2px' }}>
                    {strat.icon} {strat.type}
                  </div>
                  <div style={{ color: '#999', fontSize: '10px', lineHeight: '1.3' }}>
                    {strat.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {arbitrageOpportunities.length === 0 && (
            <div style={{
              textAlign: 'center',
              color: '#777',
              padding: '20px',
              fontSize: '12px',
              marginTop: '16px'
            }}>
              💡 Currently no cross-exchange opportunities detected. Consider integrating CoinGecko API or DEX data sources for more strategies!
            </div>
          )}
        </div>
      )}

      {/* AllPairs Tab */}
      {activeTab === 'allpairs' && (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ color: '#fff', fontSize: '18px', marginBottom: '4px' }}>📋 All Pairs Scanner (1,361 Pairs)</h2>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '12px' }}>
              ✅ All available pairs grouped by quote: 690 USD/USDC + 671 EUR
              {selectedPairsForScan.size > 0 && <span style={{ color: '#4ade80' }}> • {selectedPairsForScan.size} pairs selected</span>}
            </p>
          </div>

          {/* Search Filter */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="🔍 Search pairs (e.g., BTC, ETH, LCX)..."
              value={allPairsFilter}
              onChange={(e) => setAllPairsFilter(e.target.value.toUpperCase())}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(100, 150, 255, 0.3)',
                background: 'rgba(30, 60, 120, 0.2)',
                color: '#fff',
                fontSize: '13px',
                boxSizing: 'border-box',
                marginBottom: '12px',
              }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between' }}>
              <button
                onClick={() => {
                  if (allPairsData) {
                    const usdPairs = allPairsData.groups?.USD_USDC?.pairs?.filter((p: any) => !allPairsFilter || p.pair.includes(allPairsFilter))?.map((p: any) => p.pair) || [];
                    const eurPairs = allPairsData.groups?.EUR?.pairs?.filter((p: any) => !allPairsFilter || p.pair.includes(allPairsFilter))?.map((p: any) => p.pair) || [];
                    const newSet = new Set([...usdPairs, ...eurPairs]);
                    setSelectedPairsForScan(newSet);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'rgba(59, 130, 246, 0.3)',
                  border: '1px solid rgba(59, 130, 246, 0.5)',
                  borderRadius: '5px',
                  color: '#60a5fa',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.5)';
                  e.currentTarget.style.color = '#90caf9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.3)';
                  e.currentTarget.style.color = '#60a5fa';
                }}
              >
                ✅ Select All {allPairsFilter ? 'Filtered' : ''}
              </button>
              <button
                onClick={() => setSelectedPairsForScan(new Set())}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '5px',
                  color: '#f87171',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.4)';
                  e.currentTarget.style.color = '#fca5a5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.currentTarget.style.color = '#f87171';
                }}
              >
                ❌ Clear All
              </button>
            </div>
          </div>

          {allPairsLoading && (
            <div style={{ textAlign: 'center', color: '#888', padding: '40px 20px' }}>
              ⏳ Loading pairs data...
            </div>
          )}

          {allPairsData && !allPairsLoading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, overflow: 'hidden' }}>
              {/* USD/USDC Group */}
              <div
                style={{
                  background: 'linear-gradient(145deg, rgba(30, 60, 120, 0.3), rgba(20, 40, 80, 0.3))',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  borderRadius: '8px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '4px', fontWeight: '600' }}>
                  💵 USD/USDC
                </h3>
                <p style={{ color: '#4a9eff', fontSize: '11px', marginBottom: '12px' }}>
                  {allPairsData.groups?.USD_USDC?.pair_count || 0} pairs
                  {allPairsFilter && ` (${allPairsData.groups?.USD_USDC?.pairs?.filter((p: any) => p.pair.includes(allPairsFilter)).length || 0} matches)`}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'auto', flex: 1 }}>
                  {allPairsData.groups?.USD_USDC?.pairs
                    ?.filter((p: any) => !allPairsFilter || p.pair.includes(allPairsFilter))
                    ?.sort((a: any, b: any) => a.pair.localeCompare(b.pair))
                    ?.map((p: any, idx: number) => {
                      const isSelected = selectedPairsForScan.has(p.pair);
                      return (
                        <label
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 10px',
                            borderRadius: '5px',
                            border: '1px solid rgba(59, 130, 246, 0.4)',
                            background: isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(30, 60, 120, 0.2)',
                            color: isSelected ? '#90caf9' : '#60a5fa',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: '500',
                            transition: 'all 0.2s ease',
                            gap: '8px',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(30, 60, 120, 0.2)';
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const newSet = new Set(selectedPairsForScan);
                              if (isSelected) {
                                newSet.delete(p.pair);
                              } else {
                                newSet.add(p.pair);
                              }
                              setSelectedPairsForScan(newSet);
                            }}
                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                          />
                          📈 {p.pair}
                        </label>
                      );
                    })}
                </div>
              </div>

              {/* EUR Group */}
              <div
                style={{
                  background: 'linear-gradient(145deg, rgba(120, 60, 30, 0.3), rgba(80, 40, 20, 0.3))',
                  border: '1px solid rgba(249, 115, 22, 0.4)',
                  borderRadius: '8px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <h3 style={{ color: '#fb923c', fontSize: '14px', marginBottom: '4px', fontWeight: '600' }}>
                  🇪🇺 EUR
                </h3>
                <p style={{ color: '#fbbf24', fontSize: '11px', marginBottom: '12px' }}>
                  {allPairsData.groups?.EUR?.pair_count || 0} pairs
                  {allPairsFilter && ` (${allPairsData.groups?.EUR?.pairs?.filter((p: any) => p.pair.includes(allPairsFilter)).length || 0} matches)`}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'auto', flex: 1 }}>
                  {allPairsData.groups?.EUR?.pairs
                    ?.filter((p: any) => !allPairsFilter || p.pair.includes(allPairsFilter))
                    ?.sort((a: any, b: any) => a.pair.localeCompare(b.pair))
                    ?.map((p: any, idx: number) => {
                      const isSelected = selectedPairsForScan.has(p.pair);
                      return (
                        <label
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 10px',
                            borderRadius: '5px',
                            border: '1px solid rgba(249, 115, 22, 0.4)',
                            background: isSelected ? 'rgba(249, 115, 22, 0.3)' : 'rgba(120, 60, 30, 0.2)',
                            color: isSelected ? '#fcd34d' : '#fb923c',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: '500',
                            transition: 'all 0.2s ease',
                            gap: '8px',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(249, 115, 22, 0.25)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(120, 60, 30, 0.2)';
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const newSet = new Set(selectedPairsForScan);
                              if (isSelected) {
                                newSet.delete(p.pair);
                              } else {
                                newSet.add(p.pair);
                              }
                              setSelectedPairsForScan(newSet);
                            }}
                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                          />
                          📈 {p.pair}
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          {/* Scan Button */}
          {selectedPairsForScan.size > 0 && (
            <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={() => {
                  if (selectedPairsForScan.size > 0) {
                    batchScanPairs(Array.from(selectedPairsForScan));
                  }
                }}
                disabled={isScanningBatch}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: isScanningBatch ? '#555' : 'linear-gradient(145deg, #10b981, #059669)',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: isScanningBatch ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isScanningBatch) {
                    e.currentTarget.style.background = 'linear-gradient(145deg, #34d399, #10b981)';
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isScanningBatch) {
                    e.currentTarget.style.background = 'linear-gradient(145deg, #10b981, #059669)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }
                }}
              >
                {isScanningBatch ? '⏳ Scanning...' : `🔍 Scan ${selectedPairsForScan.size} Pair${selectedPairsForScan.size !== 1 ? 's' : ''}`}
              </button>
              <button
                onClick={() => setSelectedPairsForScan(new Set())}
                style={{
                  padding: '12px 16px',
                  background: 'rgba(100, 100, 100, 0.2)',
                  border: '1px solid rgba(100, 100, 100, 0.3)',
                  borderRadius: '6px',
                  color: '#aaa',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(100, 100, 100, 0.4)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(100, 100, 100, 0.2)';
                  e.currentTarget.style.color = '#aaa';
                }}
              >
                Clear
              </button>
            </div>
          )}

          {selectedPairsForScan.size === 0 && !batchScanResults.length && (
            <div
              style={{
                background: 'rgba(100, 100, 100, 0.1)',
                border: '1px solid rgba(100, 100, 100, 0.3)',
                borderRadius: '6px',
                padding: '12px',
                marginTop: '16px',
                fontSize: '11px',
                color: '#aaa',
              }}
            >
              ℹ️ Check pairs above, then click "Scan" to run batch arbitrage scanning
            </div>
          )}

          {/* Batch Scan Results - Show in AllPairs Tab */}
          {batchScanResults.length > 0 && (
            <div style={{ marginTop: '24px', borderTop: '1px solid rgba(100, 100, 100, 0.3)', paddingTop: '16px' }}>
              <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '12px' }}>
                ✅ Scan Results ({batchScanResults.length} pairs scanned)
              </h3>

              {/* Summary Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                <div style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '6px',
                  padding: '12px',
                }}>
                  <div style={{ color: '#4ade80', fontSize: '14px', fontWeight: '600' }}>
                    {batchScanResults.reduce((sum, r) => sum + r.profitableCount, 0)}
                  </div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Profitable Opportunities</div>
                </div>
                <div style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '6px',
                  padding: '12px',
                }}>
                  <div style={{ color: '#60a5fa', fontSize: '14px', fontWeight: '600' }}>
                    {batchScanResults.reduce((sum, r) => sum + r.opportunities.length, 0)}
                  </div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Total Opportunities</div>
                </div>
                <div style={{
                  background: 'rgba(249, 115, 22, 0.1)',
                  border: '1px solid rgba(249, 115, 22, 0.3)',
                  borderRadius: '6px',
                  padding: '12px',
                }}>
                  <div style={{ color: '#fb923c', fontSize: '14px', fontWeight: '600' }}>
                    {((batchScanResults.reduce((sum, r) => sum + r.profitableCount, 0) / batchScanResults.length) * 100).toFixed(0)}%
                  </div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Pairs with Profit</div>
                </div>
              </div>

              {/* Results by Pair */}
              <div style={{ maxHeight: '400px', overflow: 'auto', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '6px' }}>
                {batchScanResults.map((result, idx) => (
                  <div key={idx} style={{
                    padding: '12px',
                    borderBottom: idx < batchScanResults.length - 1 ? '1px solid rgba(100, 100, 100, 0.2)' : 'none',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ fontWeight: '600', color: '#fff' }}>
                        📊 {result.pair}
                        {result.profitableCount > 0 && <span style={{ color: '#4ade80', marginLeft: '8px' }}>✓ {result.profitableCount} opportunities</span>}
                        {result.profitableCount === 0 && <span style={{ color: '#888', marginLeft: '8px', fontSize: '12px' }}>No profit</span>}
                      </div>
                      <div style={{ color: '#888', fontSize: '11px' }}>
                        {result.opportunities.length} total
                      </div>
                    </div>
                    {result.opportunities.slice(0, 3).map((opp: any, oi: number) => (
                      <div key={oi} style={{
                        fontSize: '11px',
                        color: opp.profitPercentage > 0.1 ? '#4ade80' : '#888',
                        marginLeft: '12px',
                        marginBottom: '4px',
                      }}>
                        {opp.buyExchange} → {opp.sellExchange}: {opp.profitPercentage.toFixed(3)}% ({opp.profitAmount > 0 ? '+' : ''}{opp.profitAmount.toFixed(2)})
                      </div>
                    ))}
                    {result.opportunities.length > 3 && (
                      <div style={{ fontSize: '10px', color: '#666', marginLeft: '12px' }}>
                        +{result.opportunities.length - 3} more...
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Clear Results Button */}
              <button
                onClick={() => setBatchScanResults([])}
                style={{
                  marginTop: '12px',
                  padding: '8px 16px',
                  background: 'rgba(100, 100, 100, 0.2)',
                  border: '1px solid rgba(100, 100, 100, 0.3)',
                  borderRadius: '5px',
                  color: '#aaa',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Clear Results
              </button>
            </div>
          )}
        </div>
      )}

      {/* Analysis Tab */}
      {activeTab === 'analysis' && (
        <div style={{ padding: '16px' }}>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ color: '#fff', fontSize: '20px', marginBottom: '8px' }}>📈 Market Analysis - {selectedPair}</h2>
            <p style={{ color: '#888', fontSize: '14px' }}>Comparative statistics across exchanges</p>
          </div>

          {exchangeStats.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              {/* Summary Card */}
              <div style={{ 
                background: 'linear-gradient(145deg, #1e3a3a 0%, #1a2a2a 100%)',
                borderRadius: '16px',
                padding: '20px',
                gridColumn: 'span 2'
              }}>
                <h3 style={{ color: '#fff', marginBottom: '16px' }}>Market Summary</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div>
                    <div style={{ color: '#888', fontSize: '12px' }}>Best Bid Overall</div>
                    <div style={{ color: '#4ade80', fontSize: '20px', fontWeight: '600' }}>
                      {formatPrice(Math.max(...exchangeStats.map(s => s.bestBid)))}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '12px' }}>Best Ask Overall</div>
                    <div style={{ color: '#f87171', fontSize: '20px', fontWeight: '600' }}>
                      {formatPrice(Math.min(...exchangeStats.map(s => s.bestAsk)))}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '12px' }}>Avg Spread</div>
                    <div style={{ color: '#60a5fa', fontSize: '20px', fontWeight: '600' }}>
                      {(exchangeStats.reduce((sum, s) => sum + s.spreadPercentage, 0) / exchangeStats.length).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '12px' }}>Total Liquidity</div>
                    <div style={{ color: '#fbbf24', fontSize: '20px', fontWeight: '600' }}>
                      {formatAmount(exchangeStats.reduce((sum, s) => sum + s.bidVolume + s.askVolume, 0))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Exchange Stats Cards */}
              {exchangeStats.map((stat) => (
                <div
                  key={stat.exchange}
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '12px',
                    padding: '16px',
                  }}
                >
                  <h3 style={{ color: '#fff', marginBottom: '12px', fontSize: '16px' }}>
                    {getExchangeName(stat.exchange)}
                  </h3>
                  
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>Best Bid:</span>
                      <span style={{ color: '#4ade80', fontWeight: '600' }}>{formatPrice(stat.bestBid)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>Best Ask:</span>
                      <span style={{ color: '#f87171', fontWeight: '600' }}>{formatPrice(stat.bestAsk)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>Spread:</span>
                      <span style={{ color: '#60a5fa', fontWeight: '600' }}>{stat.spreadPercentage.toFixed(2)}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>Bid Volume:</span>
                      <span style={{ color: '#fff' }}>{formatAmount(stat.bidVolume)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>Ask Volume:</span>
                      <span style={{ color: '#fff' }}>{formatAmount(stat.askVolume)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>Depth:</span>
                      <span style={{ color: '#fff' }}>{stat.bidLevels} bids / {stat.askLevels} asks</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#999', padding: '60px', background: '#1a1a1a', borderRadius: '12px' }}>
              Loading analysis data...
            </div>
          )}
        </div>
      )}

      {/* Status Footer */}
      <div className="orderbook-footer">
        <span className="status-text">
          {selectedPair ? (
            <>
              <span style={{ color: '#4ade80' }}>●</span> Live data for <strong>{selectedPair}</strong> • Auto-refresh every 100ms
            </>
          ) : 'No pair selected'}
        </span>
      </div>
    </div>
  );
};