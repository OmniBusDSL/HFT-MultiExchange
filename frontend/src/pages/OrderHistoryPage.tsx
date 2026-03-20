import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/OrderHistoryPage.css';

interface Order {
  id: string;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  status: string;
}

interface Trade {
  id: string;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  timestamp: number;
  fee?: number;
}

interface ApiKey {
  id: number;
  name: string;
  exchange: string;
}

type TabType = 'open' | 'closed' | 'trades';

const OrderHistoryPage: React.FC = () => {
  const { user, token } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<string>('');
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('open');
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [closedOrders, setClosedOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Fetch API keys on mount
  useEffect(() => {
    const fetchApiKeys = async () => {
      if (!token) {
        console.log('[OrderHistory] No token, cannot fetch API keys');
        return;
      }

      try {
        const response = await fetch('/api/apikeys', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) throw new Error('Failed to fetch API keys');
        const data = await response.json();
        const keysList = data.keys || [];
        console.log('[OrderHistory] Got API keys:', keysList.length);
        setApiKeys(Array.isArray(keysList) ? keysList : []);
        if (keysList.length > 0) {
          const firstExchange = keysList[0].exchange;
          setSelectedExchange(firstExchange);
          setSelectedKeyId(keysList[0].id);
        }
      } catch (error) {
        console.error('Error fetching API keys:', error);
        setMessage('❌ Failed to load API keys');
      }
    };
    fetchApiKeys();
  }, [token]);

  // Filter API keys by selected exchange
  const filteredKeys = selectedExchange
    ? apiKeys.filter((key) => key.exchange === selectedExchange)
    : apiKeys;

  // Update selected key when exchange changes
  useEffect(() => {
    if (selectedExchange && filteredKeys.length > 0) {
      setSelectedKeyId(filteredKeys[0].id);
    }
  }, [selectedExchange, filteredKeys]);

  // Fetch orders/trades when tab or selected key changes
  useEffect(() => {
    if (!selectedKeyId) return;

    const fetchData = async () => {
      setLoading(true);
      setMessage('');
      try {
        let data = [];
        let endpoint = '';

        if (activeTab === 'open') {
          endpoint = `/api/apikeys/${selectedKeyId}/orders/open`;
        } else if (activeTab === 'closed') {
          endpoint = `/api/apikeys/${selectedKeyId}/orders/closed`;
        } else if (activeTab === 'trades') {
          endpoint = `/api/apikeys/${selectedKeyId}/trades`;
        }

        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error(`Failed to fetch ${activeTab}`);
        const result = await response.json();
        data = result.data || [];

        if (activeTab === 'open') {
          setOpenOrders(data);
          setMessage(`✓ Loaded ${data.length} open orders`);
        } else if (activeTab === 'closed') {
          setClosedOrders(data);
          setMessage(`✓ Loaded ${data.length} closed orders`);
        } else if (activeTab === 'trades') {
          setTrades(data);
          setMessage(`✓ Loaded ${data.length} trades`);
        }
      } catch (error) {
        setMessage(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedKeyId, activeTab]);

  const renderOpenOrdersTable = () => (
    <div className="orders-table">
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Pair</th>
            <th>Side</th>
            <th>Price</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {openOrders.length === 0 ? (
            <tr key="no-data">
              <td colSpan={6} className="no-data">No open orders</td>
            </tr>
          ) : (
            openOrders.map((order, idx) => (
              <tr key={`open-${order.id}-${idx}`}>
                <td className="order-id">{order.id.substring(0, 8)}...</td>
                <td>{order.symbol}</td>
                <td className={`side ${order.side}`}>{order.side.toUpperCase()}</td>
                <td>${order.price.toFixed(2)}</td>
                <td>{order.amount.toFixed(4)}</td>
                <td className="status-badge">{order.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderClosedOrdersTable = () => (
    <div className="orders-table">
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Pair</th>
            <th>Side</th>
            <th>Price</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {closedOrders.length === 0 ? (
            <tr key="no-data">
              <td colSpan={6} className="no-data">No closed orders</td>
            </tr>
          ) : (
            closedOrders.map((order, idx) => (
              <tr key={`closed-${order.id}-${idx}`}>
                <td className="order-id">{order.id.substring(0, 8)}...</td>
                <td>{order.symbol}</td>
                <td className={`side ${order.side}`}>{order.side.toUpperCase()}</td>
                <td>${order.price.toFixed(2)}</td>
                <td>{order.amount.toFixed(4)}</td>
                <td className="status-badge">{order.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderTradesTable = () => (
    <div className="orders-table">
      <table>
        <thead>
          <tr>
            <th>Trade ID</th>
            <th>Pair</th>
            <th>Side</th>
            <th>Price</th>
            <th>Amount</th>
            <th>Fee</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr key="no-data">
              <td colSpan={7} className="no-data">No trades</td>
            </tr>
          ) : (
            trades.map((trade, idx) => (
              <tr key={`trade-${trade.id}-${idx}`}>
                <td className="order-id">{trade.id.substring(0, 8)}...</td>
                <td>{trade.symbol}</td>
                <td className={`side ${trade.side}`}>{trade.side.toUpperCase()}</td>
                <td>${trade.price.toFixed(2)}</td>
                <td>{trade.amount.toFixed(4)}</td>
                <td>{trade.fee ? trade.fee.toFixed(4) : '-'}</td>
                <td>{new Date(trade.timestamp).toLocaleDateString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="order-history-page">
      <div className="order-history-card">
        <h2>📋 Order History</h2>

        {message && (
          <div className={`message ${message.includes('Error') || message.includes('❌') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}

        <div className="controls-row">
          <div className="control-group">
            <label>Exchange</label>
            <select
              value={selectedExchange}
              onChange={(e) => setSelectedExchange(e.target.value)}
              disabled={loading}
            >
              {apiKeys.length === 0 && <option>No API keys available</option>}
              {Array.from(new Set(apiKeys.map((k) => k.exchange))).map((exchange) => (
                <option key={exchange} value={exchange}>
                  {exchange.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>API Key</label>
            <select
              value={selectedKeyId || ''}
              onChange={(e) => setSelectedKeyId(Number(e.target.value))}
              disabled={loading || filteredKeys.length === 0}
            >
              {filteredKeys.length === 0 && <option>No API keys for this exchange</option>}
              {filteredKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="tab-buttons">
          <button
            className={`tab-btn ${activeTab === 'open' ? 'active' : ''}`}
            onClick={() => setActiveTab('open')}
            disabled={loading}
          >
            📤 Open Orders
          </button>
          <button
            className={`tab-btn ${activeTab === 'closed' ? 'active' : ''}`}
            onClick={() => setActiveTab('closed')}
            disabled={loading}
          >
            ✓ Closed Orders
          </button>
          <button
            className={`tab-btn ${activeTab === 'trades' ? 'active' : ''}`}
            onClick={() => setActiveTab('trades')}
            disabled={loading}
          >
            💱 My Trades
          </button>
        </div>

        <div className="tab-content">
          {loading && <div className="loading">Loading...</div>}
          {!loading && activeTab === 'open' && renderOpenOrdersTable()}
          {!loading && activeTab === 'closed' && renderClosedOrdersTable()}
          {!loading && activeTab === 'trades' && renderTradesTable()}
        </div>
      </div>
    </div>
  );
};

export default OrderHistoryPage;
