import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/ChartPage.css';

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ExchangeData {
  exchange: string;
  symbol: string;
  timeframe: string;
  ohlcv: OHLCV[];
}

interface Market {
  symbol: string;
  base: string;
  quote: string;
}

interface Ticker {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  baseVolume: number;
  quoteVolume: number;
}

const ChartPage: React.FC = () => {
  const { user } = useAuth();
  const [exchanges] = useState(['lcx', 'kraken', 'coinbase']);
  const [selectedExchange, setSelectedExchange] = useState('lcx');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/EUR');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [chartData, setChartData] = useState<ExchangeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  // Fetch markets when exchange changes
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const response = await fetch(
          `/api/public/markets?exchange=${selectedExchange}`
        );
        if (!response.ok) throw new Error('Failed to fetch markets');
        const data = await response.json();

        // Handle both array and object responses
        const marketsArray = Array.isArray(data) ? data : (data.data || []);
        setMarkets(marketsArray);

        // Set first symbol as default
        if (marketsArray.length > 0) {
          setSelectedSymbol(marketsArray[0].symbol);
        }
      } catch (error) {
        console.error('Error fetching markets:', error);
        setMarkets([]);
      }
    };

    fetchMarkets();
  }, [selectedExchange]);

  // Fetch chart data
  const fetchChart = async () => {
    if (!selectedSymbol) {
      setMessage('⚠️ Select a pair first');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(
        `/api/public/ohlcv?exchange=${selectedExchange}&symbol=${selectedSymbol}&timeframe=${selectedTimeframe}`
      );
      if (!response.ok) throw new Error('Failed to fetch chart data');
      const data = await response.json();
      setChartData(data);
      setMessage(`✓ Loaded ${data.ohlcv.length} candles`);
    } catch (error) {
      setMessage(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chart-page">
      <div className="chart-controls-card">
        <h2>📊 Price Chart</h2>

        {message && (
          <div className={`message ${message.includes('Error') || message.includes('⚠️') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}

        <div className="control-group">
          <label>Exchange</label>
          <select
            value={selectedExchange}
            onChange={(e) => setSelectedExchange(e.target.value)}
            disabled={loading}
          >
            {exchanges.map((ex) => (
              <option key={ex} value={ex}>
                {ex.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Trading Pair</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            disabled={loading || markets.length === 0}
          >
            {markets.length === 0 && <option>Loading pairs...</option>}
            {markets.map((market) => (
              <option key={market.symbol} value={market.symbol}>
                {market.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Timeframe</label>
          <div className="timeframe-buttons">
            {timeframes.map((tf) => (
              <button
                key={tf}
                className={`timeframe-btn ${selectedTimeframe === tf ? 'active' : ''}`}
                onClick={() => setSelectedTimeframe(tf)}
                disabled={loading}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <button
          className="fetch-btn"
          onClick={fetchChart}
          disabled={loading || !selectedSymbol}
        >
          {loading ? '⏳ Loading...' : '📈 Load Chart'}
        </button>
      </div>

      {chartData && chartData.ohlcv.length > 0 && (
        <div className="chart-container">
          <div className="chart-info">
            <span className="exchange-badge">{chartData.exchange.toUpperCase()}</span>
            <span className="symbol-badge">{chartData.symbol}</span>
            <span className="timeframe-badge">{chartData.timeframe}</span>
            <span className="count-badge">{chartData.ohlcv.length} candles</span>
          </div>
          <CandlestickChart data={chartData.ohlcv} />
          <ChartStats data={chartData.ohlcv} />
        </div>
      )}

      {chartData && chartData.ohlcv.length === 0 && (
        <div className="no-data">No candlestick data available for this pair</div>
      )}
    </div>
  );
};

interface CandlestickChartProps {
  data: OHLCV[];
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ data }) => {
  const padding = 40;
  const chartWidth = 1000;
  const chartHeight = 400;
  const width = chartWidth + padding * 2;
  const height = chartHeight + padding * 2;

  // Find min/max prices
  const prices = data.flatMap((c) => [c.high, c.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // Calculate scale
  const candleWidth = chartWidth / data.length;
  const priceScale = chartHeight / priceRange;

  // Convert price to y coordinate
  const priceToY = (price: number) => padding + chartHeight - (price - minPrice) * priceScale;

  // Find volume for color intensity
  const volumes = data.map((c) => c.volume);
  const maxVolume = Math.max(...volumes);

  return (
    <svg width={width} height={height} className="candlestick-chart">
      {/* Grid lines */}
      {Array.from({ length: 5 }).map((_, i) => {
        const price = minPrice + (priceRange / 4) * i;
        const y = priceToY(price);
        return (
          <g key={`grid-${i}`}>
            <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#333" strokeDasharray="2,2" />
            <text x={10} y={y + 4} fontSize="12" fill="#999">
              {price.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Candlesticks */}
      {data.map((candle, i) => {
        const x = padding + i * candleWidth + candleWidth / 2;
        const openY = priceToY(candle.open);
        const closeY = priceToY(candle.close);
        const highY = priceToY(candle.high);
        const lowY = priceToY(candle.low);

        const isGreen = candle.close >= candle.open;
        const bodyTop = Math.min(openY, closeY);
        const bodyBottom = Math.max(openY, closeY);
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);

        // Volume intensity
        const volumeIntensity = (candle.volume / maxVolume) * 0.7 + 0.3;
        const color = isGreen ? `rgba(16, 185, 129, ${volumeIntensity})` : `rgba(239, 68, 68, ${volumeIntensity})`;
        const wickColor = isGreen ? '#10b981' : '#ef4444';

        return (
          <g key={`candle-${i}`}>
            {/* Wick */}
            <line x1={x} y1={highY} x2={x} y2={lowY} stroke={wickColor} strokeWidth="1" opacity={0.7} />
            {/* Body */}
            <rect x={x - candleWidth * 0.35} y={bodyTop} width={candleWidth * 0.7} height={bodyHeight} fill={color} />
          </g>
        );
      })}

      {/* Axes */}
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#666" strokeWidth="2" />
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#666" strokeWidth="2" />

      {/* Price axis label */}
      <text x={20} y={20} fontSize="12" fill="#999" fontWeight="bold">
        Price
      </text>

      {/* Min price label */}
      <text x={width - padding + 5} y={priceToY(minPrice) + 4} fontSize="11" fill="#999">
        {minPrice.toFixed(0)}
      </text>

      {/* Max price label */}
      <text x={width - padding + 5} y={priceToY(maxPrice) + 4} fontSize="11" fill="#999">
        {maxPrice.toFixed(0)}
      </text>
    </svg>
  );
};

interface ChartStatsProps {
  data: OHLCV[];
}

const ChartStats: React.FC<ChartStatsProps> = ({ data }) => {
  const firstCandle = data[0];
  const lastCandle = data[data.length - 1];
  const allPrices = data.flatMap((c) => [c.high, c.low]);
  const highestPrice = Math.max(...allPrices);
  const lowestPrice = Math.min(...allPrices);
  const totalVolume = data.reduce((sum, c) => sum + c.volume, 0);
  const change = lastCandle.close - firstCandle.open;
  const changePercent = (change / firstCandle.open) * 100;

  return (
    <div className="chart-stats">
      <div className="stat">
        <div className="stat-label">Opening</div>
        <div className="stat-value">${firstCandle.open.toFixed(2)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Closing</div>
        <div className="stat-value">${lastCandle.close.toFixed(2)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Highest</div>
        <div className="stat-value">${highestPrice.toFixed(2)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Lowest</div>
        <div className="stat-value">${lowestPrice.toFixed(2)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Change</div>
        <div className={`stat-value ${change >= 0 ? 'positive' : 'negative'}`}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePercent.toFixed(2)}%)
        </div>
      </div>
      <div className="stat">
        <div className="stat-label">Total Volume</div>
        <div className="stat-value">{totalVolume.toFixed(4)}</div>
      </div>
    </div>
  );
};

export default ChartPage;
