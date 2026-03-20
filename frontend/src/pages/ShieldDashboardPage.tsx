import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/ShieldDashboard.css';

interface MetricCard {
  label: string;
  value: string | number;
  icon: string;
  color: string;
}

interface Ticker {
  symbol: string;
  bid: number;
  ask: number;
}

interface Opportunity {
  pair: string;
  type: 'BUY' | 'SELL';
  signal: number; // DEV2%
  bid: number;
  ask: number;
}

interface OpenOrder {
  pair: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  filled: number;
  order_id?: string;
}

interface Alert {
  id: number;
  type: string;
  pair: string;
  message: string;
  timestamp: string;
}

export default function ShieldDashboardPage() {
  const { user, token } = useAuth();
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch CoinGecko API key
  const fetchCoinGeckoApiKey = useCallback(async (): Promise<string | null> => {
    try {
      if (!token) return null;
      const res = await fetch('/api/apikeys?exchange=coingecko', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      const keys = data.keys || [];
      return keys.length > 0 ? keys[0].apiKey : null;
    } catch (err) {
      console.warn('[DASHBOARD] Error fetching CoinGecko API key:', err);
      return null;
    }
  }, [token]);

  // Fetch external prices
  const fetchExternalPrices = useCallback(async (): Promise<Map<string, number>> => {
    try {
      const symbols = ['bitcoin', 'ethereum', 'ripple', 'cardano', 'solana', 'polkadot', 'dogecoin', 'litecoin', 'chainlink', 'uniswap'];
      const apiKey = await fetchCoinGeckoApiKey();
      if (!apiKey) return new Map();

      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.join(',')}&vs_currencies=eur,usd&x_cg_demo_api_key=${apiKey}`;
      const res = await fetch(cgUrl);
      if (!res.ok) return new Map();

      const data = await res.json();
      const priceMap = new Map<string, number>();

      const symbolMap: { [key: string]: string[] } = {
        bitcoin: ['BTC'],
        ethereum: ['ETH'],
        ripple: ['XRP'],
        cardano: ['ADA'],
        solana: ['SOL'],
        polkadot: ['DOT'],
        dogecoin: ['DOGE'],
        litecoin: ['LTC'],
        chainlink: ['LINK'],
        uniswap: ['UNI']
      };

      for (const [cgId, price] of Object.entries(data)) {
        const priceData = price as any;
        const eurPrice = priceData.eur || priceData.usd;
        if (eurPrice && symbolMap[cgId]) {
          for (const symbol of symbolMap[cgId]) {
            priceMap.set(symbol, eurPrice);
          }
        }
      }

      return priceMap;
    } catch (err) {
      console.warn('[DASHBOARD] Error fetching external prices:', err);
      return new Map();
    }
  }, [fetchCoinGeckoApiKey]);

  // Fetch ticker data for opportunities
  const fetchOpportunities = useCallback(async () => {
    try {
      const [tickerRes, externalPrices] = await Promise.all([
        fetch('/api/public/tickers?exchange=lcx'),
        fetchExternalPrices()
      ]);

      if (!tickerRes.ok) return;
      const data = await tickerRes.json();

      if (data.tickers && Array.isArray(data.tickers)) {
        const opps: Opportunity[] = data.tickers
          .slice(0, 200)
          .map((t: Ticker) => {
            const lcxMid = (t.bid + t.ask) / 2;
            const baseSymbol = t.symbol.split('/')[0]; // BTC from BTC/EUR
            const externalMid = externalPrices.get(baseSymbol);

            // DEV2% = (LCX mid - External price) / External price * 100
            let tier2Deviation: number | null = null;
            let signal_type: 'BUY' | 'SELL' | null = null;

            if (externalMid && externalMid > 0) {
              tier2Deviation = ((lcxMid - externalMid) / externalMid) * 100;

              // BUY if LCX is 1%+ cheaper than external (DEV2% < -1%)
              if (tier2Deviation < -1) {
                signal_type = 'BUY';
              }
              // SELL if LCX is 1%+ more expensive than external (DEV2% > 1%)
              else if (tier2Deviation > 1) {
                signal_type = 'SELL';
              }
            }

            return {
              pair: t.symbol,
              type: signal_type || (Math.random() > 0.5 ? 'BUY' : 'SELL'),
              signal: tier2Deviation ?? 0,
              bid: t.bid,
              ask: t.ask
            };
          })
          .filter((o: Opportunity) => Math.abs(o.signal) > 0.5)
          .sort((a: Opportunity, b: Opportunity) => Math.abs(b.signal) - Math.abs(a.signal))
          .slice(0, 5);

        setOpportunities(opps);
      }
    } catch (err) {
      console.error('[DASHBOARD] Error fetching opportunities:', err);
    }
  }, [fetchExternalPrices]);

  // Fetch open orders
  const fetchOpenOrders = useCallback(async () => {
    try {
      if (!token) return;

      // Get user's API keys
      const keysRes = await fetch('/api/apikeys', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!keysRes.ok) return;

      const keysData = await keysRes.json();
      const apiKeys = keysData.keys || [];

      let allOrders: OpenOrder[] = [];

      // Fetch orders from first LCX API key found
      const lcxKey = apiKeys.find((k: any) => k.exchange === 'lcx');
      if (lcxKey) {
        const ordersRes = await fetch(`/api/apikeys/${lcxKey.id}/orders/open`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          if (ordersData.orders && Array.isArray(ordersData.orders)) {
            allOrders = ordersData.orders.map((o: any) => ({
              pair: o.pair || o.symbol || 'N/A',
              side: o.side?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
              price: parseFloat(o.price) || 0,
              amount: parseFloat(o.amount) || 0,
              filled: parseFloat(o.filled) || 0,
              order_id: o.order_id || o.id
            }));
          }
        }
      }

      setOpenOrders(allOrders);
    } catch (err) {
      console.error('[DASHBOARD] Error fetching orders:', err);
    }
  }, [token]);

  // Calculate metrics
  useEffect(() => {
    const buySells = opportunities.reduce(
      (acc, opp) => ({
        buy: acc.buy + (opp.type === 'BUY' ? 1 : 0),
        sell: acc.sell + (opp.type === 'SELL' ? 1 : 0)
      }),
      { buy: 0, sell: 0 }
    );

    const totalOrders = openOrders.length;
    const filledQty = openOrders.reduce((sum, o) => sum + o.filled, 0);
    const totalQty = openOrders.reduce((sum, o) => sum + o.amount, 0);
    const fillPct = totalQty > 0 ? ((filledQty / totalQty) * 100).toFixed(1) : '0';

    setMetrics([
      {
        label: 'BUY Opportunities',
        value: buySells.buy,
        icon: '📈',
        color: '#10b981'
      },
      {
        label: 'SELL Opportunities',
        value: buySells.sell,
        icon: '📉',
        color: '#ef4444'
      },
      {
        label: 'Open Orders',
        value: totalOrders,
        icon: '📋',
        color: '#0ea5e9'
      },
      {
        label: 'Fill %',
        value: fillPct + '%',
        icon: '⚡',
        color: '#f59e0b'
      }
    ]);
  }, [opportunities, openOrders]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        await Promise.all([fetchOpportunities(), fetchOpenOrders()]);

        // Mock alerts
        setAlerts([
          {
            id: 1,
            type: 'FILL_PARTIAL',
            pair: 'BTC/EUR',
            message: 'Order partially filled',
            timestamp: new Date().toLocaleTimeString()
          },
          {
            id: 2,
            type: 'LARGE_CANCEL',
            pair: 'ETH/EUR',
            message: 'Spoof detected - large cancel',
            timestamp: new Date(Date.now() - 60000).toLocaleTimeString()
          }
        ]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchOpportunities, fetchOpenOrders]);

  return (
    <div className="shield-dashboard">
      {/* Header */}
      <div className="sd-header">
        <div className="sd-title">🛡️ Shield Dashboard</div>
        <div className="sd-subtitle">Real-time Market & Order Monitoring</div>
      </div>

      {/* Metrics Cards */}
      <div className="sd-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="metric-card">
            <div className="metric-icon">{metric.icon}</div>
            <div className="metric-content">
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value" style={{ color: metric.color }}>
                {metric.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="sd-main">
        {/* Opportunities Section */}
        <div className="sd-section">
          <h3 className="sd-section-title">💰 Best Opportunities</h3>
          {opportunities.length > 0 ? (
            <div className="sd-opportunities">
              {opportunities.map((opp) => (
                <div
                  key={opp.pair}
                  className={`opp-card ${opp.type.toLowerCase()}`}
                >
                  <div className="opp-pair">{opp.pair}</div>
                  <div className="opp-type" style={{
                    color: opp.type === 'BUY' ? '#10b981' : '#ef4444'
                  }}>
                    {opp.type}
                  </div>
                  <div className="opp-signal">
                    {opp.signal > 0 ? '+' : ''}{opp.signal.toFixed(2)}%
                  </div>
                  <div className="opp-prices">
                    <span style={{ color: '#10b981' }}>{opp.bid.toFixed(2)}</span>
                    <span style={{ color: '#ef4444' }}>{opp.ask.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sd-empty">No opportunities found</div>
          )}
        </div>

        {/* Orders Section */}
        <div className="sd-section">
          <h3 className="sd-section-title">📋 Open Orders</h3>
          {openOrders.length > 0 ? (
            <div className="sd-orders-table">
              <table>
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th>Filled</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((order) => (
                    <tr key={order.pair}>
                      <td style={{ fontWeight: '600', color: '#0ea5e9' }}>
                        {order.pair}
                      </td>
                      <td style={{
                        color: order.side === 'BUY' ? '#10b981' : '#ef4444',
                        fontWeight: '600'
                      }}>
                        {order.side}
                      </td>
                      <td>{order.price.toFixed(2)}</td>
                      <td>{order.amount.toFixed(4)}</td>
                      <td>{order.filled.toFixed(4)}</td>
                      <td style={{ color: '#f59e0b' }}>
                        {((order.filled / order.amount) * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sd-empty">No open orders</div>
          )}
        </div>
      </div>

      {/* Alerts Section */}
      <div className="sd-section sd-alerts-section">
        <h3 className="sd-section-title">🔔 Recent Alerts</h3>
        {alerts.length > 0 ? (
          <div className="sd-alerts">
            {alerts.map((alert) => (
              <div key={alert.id} className={`alert-item alert-${alert.type.toLowerCase()}`}>
                <div className="alert-header">
                  <span className="alert-type">{alert.type}</span>
                  <span className="alert-time">{alert.timestamp}</span>
                </div>
                <div className="alert-pair">{alert.pair}</div>
                <div className="alert-message">{alert.message}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="sd-empty">No alerts</div>
        )}
      </div>
    </div>
  );
}
