import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/DashboardPage.css';

interface MetricCard {
  label: string;
  value: string;
  subtext: string;
  icon: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

interface MarketRow {
  pair: string;
  price: string;
  change24h: number;
  volume: string;
}

interface ActivityItem {
  id: number;
  type: 'buy' | 'sell' | 'deposit' | 'withdrawal';
  asset: string;
  amount: string;
  time: string;
  status: 'completed' | 'pending' | 'failed';
}

const MOCK_METRICS: MetricCard[] = [
  {
    label: 'Portfolio Value',
    value: '$185,420.50',
    subtext: 'Total across all assets',
    icon: '◎',
    trend: 'up',
    trendValue: '+$2,450.75 today'
  },
  {
    label: 'Active Trades',
    value: '12',
    subtext: '3 limit orders pending',
    icon: '⇄',
    trend: 'neutral'
  },
  {
    label: 'Total Orders',
    value: '247',
    subtext: 'All time',
    icon: '◈',
    trend: 'up',
    trendValue: '+8 this week'
  },
  {
    label: 'P&L This Month',
    value: '+$2,450.75',
    subtext: '+19.6% return',
    icon: '△',
    trend: 'up',
    trendValue: '68.5% win rate'
  },
];

const MOCK_MARKET: MarketRow[] = [
  { pair: 'BTC/USDT', price: '$42,380.00', change24h: 2.4, volume: '$1.2B' },
  { pair: 'ETH/USDT', price: '$2,285.50', change24h: -0.8, volume: '$680M' },
  { pair: 'ADA/USDT', price: '$0.7423', change24h: 5.1, volume: '$92M' },
  { pair: 'SOL/USDT', price: '$98.70', change24h: 1.9, volume: '$310M' },
];

const MOCK_ACTIVITY: ActivityItem[] = [
  { id: 1, type: 'buy', asset: 'BTC', amount: '0.05 BTC  @ $42,100', time: '2m ago', status: 'completed' },
  { id: 2, type: 'sell', asset: 'ETH', amount: '1.5 ETH  @ $2,290', time: '18m ago', status: 'completed' },
  { id: 3, type: 'buy', asset: 'ADA', amount: '500 ADA @ $0.74', time: '1h ago', status: 'completed' },
  { id: 4, type: 'deposit', asset: 'USDT', amount: '$5,000', time: '3h ago', status: 'completed' },
  { id: 5, type: 'withdrawal', asset: 'BTC', amount: '0.1 BTC', time: '1d ago', status: 'pending' },
];

export const DashboardPage = () => {
  const { user } = useAuth();
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [pair, setPair] = useState('BTCUSDT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');

  const userName = user?.email?.split('@')[0] || 'User';

  const getDateString = () => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="dashboard__header">
        <div>
          <h1 className="dashboard__title">Overview</h1>
          <p className="dashboard__subtitle">Welcome back, {userName}</p>
        </div>
        <span className="dashboard__date">{getDateString()}</span>
      </div>

      {/* Metric cards */}
      <div className="dashboard__metrics">
        {MOCK_METRICS.map((m) => (
          <div key={m.label} className="metric-card">
            <div className="metric-card__icon">{m.icon}</div>
            <div className="metric-card__body">
              <div className="metric-card__label">{m.label}</div>
              <div
                className={`metric-card__value ${
                  m.trend === 'up'
                    ? 'metric-card__value--up'
                    : m.trend === 'down'
                    ? 'metric-card__value--down'
                    : ''
                }`}
              >
                {m.value}
              </div>
              <div className="metric-card__subtext">{m.subtext}</div>
              {m.trendValue && (
                <div className={`metric-card__trend metric-card__trend--${m.trend}`}>
                  {m.trend === 'up' ? '▲' : m.trend === 'down' ? '▼' : '−'} {m.trendValue}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Market + Activity row */}
      <div className="dashboard__row">
        {/* Market overview */}
        <div className="glass-card dashboard__market">
          <h2 className="glass-card__title">Market Overview</h2>
          <table className="market-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Price</th>
                <th>24h</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_MARKET.map((row) => (
                <tr key={row.pair} className="market-table__row">
                  <td className="market-table__pair">{row.pair}</td>
                  <td className="market-table__price">{row.price}</td>
                  <td
                    className={`market-table__change ${
                      row.change24h >= 0 ? 'market-table__change--up' : 'market-table__change--down'
                    }`}
                  >
                    {row.change24h >= 0 ? '+' : ''}{row.change24h}%
                  </td>
                  <td className="market-table__volume">{row.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent activity */}
        <div className="glass-card dashboard__activity">
          <h2 className="glass-card__title">Recent Activity</h2>
          <ul className="activity-list">
            {MOCK_ACTIVITY.map((item) => (
              <li key={item.id} className="activity-item">
                <span
                  className={`activity-item__type-badge activity-item__type-badge--${item.type}`}
                >
                  {item.type === 'buy' ? '▲' : item.type === 'sell' ? '▼' : item.type === 'deposit' ? '+' : '−'}
                </span>
                <div className="activity-item__info">
                  <div className="activity-item__desc">
                    {item.asset} - {item.amount}
                  </div>
                  <div className="activity-item__meta">{item.time}</div>
                </div>
                <span className={`activity-item__status activity-item__status--${item.status}`}>
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Quick trade form */}
      <div className="glass-card dashboard__quick-trade">
        <h2 className="glass-card__title">Quick Trade</h2>
        <div className="quick-trade__form">
          <div className="form-group">
            <label className="form-label">Pair</label>
            <select
              className="form-input"
              value={pair}
              onChange={(e) => setPair(e.target.value)}
            >
              <option value="BTCUSDT">BTC / USDT</option>
              <option value="ETHUSDT">ETH / USDT</option>
              <option value="ADAUSDT">ADA / USDT</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Side</label>
            <div className="side-toggle">
              <button
                className={`side-toggle__btn ${
                  orderSide === 'buy' ? 'side-toggle__btn--active' : ''
                }`}
                onClick={() => setOrderSide('buy')}
              >
                Buy
              </button>
              <button
                className={`side-toggle__btn ${
                  orderSide === 'sell' ? 'side-toggle__btn--active' : ''
                }`}
                onClick={() => setOrderSide('sell')}
              >
                Sell
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Price (USDT)</label>
            <input
              type="number"
              className="form-input"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Quantity</label>
            <input
              type="number"
              className="form-input"
              placeholder="0.00"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <button className={`quick-trade__submit quick-trade__submit--${orderSide}`}>
            {orderSide === 'buy' ? '▲ Buy' : '▼ Sell'}
          </button>
        </div>
      </div>
    </div>
  );
};
