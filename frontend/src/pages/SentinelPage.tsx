import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/SentinelPage.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ApiKey {
  id: number;
  name: string;
  exchange: string;
}

interface OrderLevel {
  price: number;
  qty: number;
}

interface MonitoredOrder {
  order_id: string;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  is_protected: boolean;
  is_attacked: boolean;
  last_sync: number;
  priceLevelsAhead: number;
  volumeAhead: number;
  totalAtLevel: number;
}

interface Alert {
  id: number;
  type: 'QUEUE_WORSENED' | 'LARGE_CANCEL' | 'FILL_PARTIAL' | 'FILL_COMPLETE';
  pair: string;
  message: string;
  timestamp: Date;
}

interface Orderbook {
  buy: OrderLevel[];
  sell: OrderLevel[];
  hasSnapshot: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function analyzeQueue(order: MonitoredOrder, bids: OrderLevel[], asks: OrderLevel[]): Partial<MonitoredOrder> {
  const levels = order.side === 'buy' ? bids : asks;

  // Count price levels better than our order
  let priceLevelsAhead = 0;
  let volumeAhead = 0;
  let totalAtLevel = 0;

  for (const level of levels) {
    if (order.side === 'buy') {
      if (level.price > order.price) {
        priceLevelsAhead++;
        volumeAhead += level.qty;
      } else if (level.price === order.price) {
        totalAtLevel = level.qty;
        break;
      }
    } else {
      if (level.price < order.price) {
        priceLevelsAhead++;
        volumeAhead += level.qty;
      } else if (level.price === order.price) {
        totalAtLevel = level.qty;
        break;
      }
    }
  }

  return {
    priceLevelsAhead,
    volumeAhead,
    totalAtLevel
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const SentinelPage = () => {
  const { token } = useAuth();

  // State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [selectedExchange, setSelectedExchange] = useState<string>('');
  const [orders, setOrders] = useState<MonitoredOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedOrderForDepth, setSelectedOrderForDepth] = useState<MonitoredOrder | null>(null);
  const [orderbooks, setOrderbooks] = useState<Map<string, Orderbook>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);

  const wssRef = useRef<Map<string, WebSocket>>(new Map());
  const reconnectTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const isMountedRef = useRef(true);
  const previousOrdersRef = useRef<Map<string, MonitoredOrder>>(new Map());
  const levelHistoryRef = useRef<Map<string, Map<number, number>>>(new Map());

  // Load API keys on mount
  useEffect(() => {
    const fetchApiKeys = async () => {
      if (!token) return;

      try {
        const response = await fetch('/api/apikeys', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const data = await response.json();
          const keysList = data.keys || [];
          setApiKeys(keysList);

          if (keysList.length > 0) {
            setSelectedKeyId(keysList[0].id);
            setSelectedExchange(keysList[0].exchange);
          }
        }
      } catch (err) {
        setMessage('❌ Failed to load API keys');
      }
    };

    fetchApiKeys();
  }, [token]);

  // Update exchange when key changes
  useEffect(() => {
    if (selectedKeyId) {
      const selected = apiKeys.find((k) => k.id === selectedKeyId);
      if (selected) {
        setSelectedExchange(selected.exchange);
      }
    }
  }, [selectedKeyId, apiKeys]);

  // Fetch orders and reconcile
  const fetchAndReconcileOrders = useCallback(async () => {
    if (!selectedKeyId || !token) return;

    try {
      const response = await fetch(`/api/apikeys/${selectedKeyId}/orders/open`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Failed to fetch orders`);

      const result = await response.json();
      const ordersData = result.data || [];

      // Transform to MonitoredOrder format
      const transformed = ordersData.map((order: any) => ({
        order_id: order.id || order.Id || 'unknown',
        pair: order.symbol || order.Pair || 'N/A',
        side: (order.side || order.Side || 'buy').toLowerCase(),
        price: parseFloat(order.price || order.Price || 0),
        amount: parseFloat(order.amount || order.Amount || 0),
        filled: parseFloat(order.filled || order.Filled || 0),
        remaining: parseFloat(order.amount || order.Amount || 0) - parseFloat(order.filled || order.Filled || 0),
        status: (order.status || order.Status || 'OPEN').toUpperCase(),
        is_protected: true,
        is_attacked: false,
        last_sync: Date.now(),
        priceLevelsAhead: 0,
        volumeAhead: 0,
        totalAtLevel: 0,
      }));

      // Detect fills via reconciliation
      for (const [orderId, prevOrder] of previousOrdersRef.current) {
        const newOrder = transformed.find(o => o.order_id === orderId);
        if (!newOrder) {
          // Order disappeared
          setAlerts(prev => [...prev.slice(-49), {
            id: Date.now(),
            type: 'FILL_COMPLETE',
            pair: prevOrder.pair,
            message: `Order filled: ${prevOrder.pair} ${prevOrder.side.toUpperCase()} @ ${prevOrder.price}`,
            timestamp: new Date()
          }]);
        } else if (newOrder.filled > prevOrder.filled) {
          // Partial fill
          setAlerts(prev => [...prev.slice(-49), {
            id: Date.now(),
            type: 'FILL_PARTIAL',
            pair: newOrder.pair,
            message: `Partial fill: ${newOrder.pair} ${newOrder.side.toUpperCase()} +${(newOrder.filled - prevOrder.filled).toFixed(4)}`,
            timestamp: new Date()
          }]);
        }
      }

      previousOrdersRef.current.clear();
      for (const order of transformed) {
        previousOrdersRef.current.set(order.order_id, order);
      }

      setOrders(transformed);
      setMessage(`✓ Monitoring ${transformed.length} order(s) on ${selectedExchange.toUpperCase()}`);
    } catch (err) {
      setOrders([]);
      setMessage('❌ Error fetching orders');
    }
  }, [selectedKeyId, token, selectedExchange]);

  // Initial fetch
  useEffect(() => {
    fetchAndReconcileOrders();

    // Reconcile every 30s
    const interval = setInterval(fetchAndReconcileOrders, 30000);
    return () => clearInterval(interval);
  }, [fetchAndReconcileOrders]);

  // Connect to WebSocket for orderbook data
  const connectOrderbookWS = useCallback(() => {
    if (orders.length === 0 || !isMountedRef.current) return;

    const pairs = [...new Set(orders.map(o => o.pair))];

    const ws = new WebSocket('wss://exchange-api.lcx.com/ws');

    ws.onopen = () => {
      setWsConnected(true);
      for (const pair of pairs) {
        const msg = JSON.stringify({
          Topic: 'subscribe',
          Type: 'orderbook',
          Pair: pair
        });
        ws.send(msg);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.Type === 'orderbook' && msg.Pair) {
          const pair = msg.Pair;

          if (msg.Topic === 'snapshot') {
            const book: Orderbook = {
              buy: msg.Data.buy.map((item: any[]) => ({ price: item[0], qty: item[1] })).sort((a: OrderLevel, b: OrderLevel) => b.price - a.price),
              sell: msg.Data.sell.map((item: any[]) => ({ price: item[0], qty: item[1] })).sort((a: OrderLevel, b: OrderLevel) => a.price - b.price),
              hasSnapshot: true
            };

            setOrderbooks(prev => {
              const newMap = new Map(prev);
              newMap.set(pair, book);
              return newMap;
            });
          } else if (msg.Topic === 'update') {
            setOrderbooks(prev => {
              const newMap = new Map(prev);
              const book = newMap.get(pair) || { buy: [], sell: [], hasSnapshot: false };

              // Detect LARGE_CANCEL (spoof detection)
              const history = levelHistoryRef.current.get(pair) || new Map();

              for (const [price, qty, side] of msg.Data) {
                const levels = side === 'buy' ? book.buy : book.sell;
                const idx = levels.findIndex(l => l.price === price);
                const oldQty = idx >= 0 ? levels[idx].qty : 0;
                const avgQty = history.get(price) || 0;
                const rolling3Avg = avgQty > 0 ? avgQty : qty;

                // Detect spike
                if (qty > rolling3Avg * 3 && oldQty <= rolling3Avg * 3) {
                  // Volume spike detected, set timeout to check if it cancels
                  setTimeout(() => {
                    const currentBook = newMap.get(pair);
                    if (currentBook) {
                      const currentLevels = side === 'buy' ? currentBook.buy : currentBook.sell;
                      const currentIdx = currentLevels.findIndex(l => l.price === price);
                      const currentQty = currentIdx >= 0 ? currentLevels[currentIdx].qty : 0;
                      if (currentQty < rolling3Avg * 1.5) {
                        setAlerts(prev => [...prev.slice(-49), {
                          id: Date.now(),
                          type: 'LARGE_CANCEL',
                          pair,
                          message: `Large cancel detected: ${pair} ${side} @ ${price} (-${(qty - currentQty).toFixed(4)})`,
                          timestamp: new Date()
                        }]);
                      }
                    }
                  }, 500);
                }

                // Update history
                history.set(price, rolling3Avg * 0.7 + qty * 0.3);

                // Apply delta
                if (qty === 0) {
                  if (idx >= 0) levels.splice(idx, 1);
                } else {
                  if (idx >= 0) {
                    levels[idx].qty = qty;
                  } else {
                    levels.push({ price, qty });
                  }
                }
              }

              book.buy.sort((a, b) => b.price - a.price);
              book.sell.sort((a, b) => a.price - b.price);

              levelHistoryRef.current.set(pair, history);
              newMap.set(pair, book);
              return newMap;
            });
          }
        }
      } catch (err) {
        console.error('[Sentinel] WS parse error:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[Sentinel] WS error:', err);
      setWsConnected(false);
    };

    ws.onclose = () => {
      setWsConnected(false);

      if (!isMountedRef.current) return;

      const timer = setTimeout(() => {
        if (isMountedRef.current && orders.length > 0) {
          connectOrderbookWS();
        }
      }, 3000);

      reconnectTimersRef.current.set('obm-ws', timer);
    };

    wssRef.current.set('obm-ws', ws);
  }, [orders]);

  // Reconnect WS when orders change
  useEffect(() => {
    if (selectedExchange.toLowerCase() === 'lcx') {
      connectOrderbookWS();
    }

    return () => {
      isMountedRef.current = false;
      for (const ws of wssRef.current.values()) {
        ws.close();
      }
      for (const timer of reconnectTimersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, [orders, selectedExchange, connectOrderbookWS]);

  // Update queue analysis on orderbook updates
  useEffect(() => {
    setOrders(prevOrders =>
      prevOrders.map(order => {
        const book = orderbooks.get(order.pair);
        if (!book || !book.hasSnapshot) return order;

        const queueInfo = analyzeQueue(order, book.buy, book.sell);
        return { ...order, ...queueInfo };
      })
    );
  }, [orderbooks]);

  return (
    <div className="sentinel-page">
      <div className="sentinel-header">
        <div className="sentinel-title">🛡️ LCX Sentinel</div>
        <div className="sentinel-status">
          {selectedExchange.toLowerCase() === 'lcx' && (
            <span className={`ws-status ${wsConnected ? 'connected' : 'disconnected'}`}>
              <span className="dot"></span>
              {wsConnected ? 'WS Connected' : 'Waiting for WS'}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <div className="control-group">
          <label>API Key:</label>
          <select
            value={selectedKeyId || ''}
            onChange={(e) => setSelectedKeyId(Number(e.target.value))}
            disabled={loading}
          >
            <option value="">Select API Key</option>
            {apiKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name} ({key.exchange.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Exchange:</label>
          <div className="exchange-badge">
            {selectedExchange.toUpperCase() || '—'}
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`message ${message.includes('❌') ? 'error' : 'info'}`}>
          {message}
        </div>
      )}

      {/* Main Content */}
      <div className="sentinel-main">
        {/* Orders Table */}
        <div className="orders-section">
          <h3>Open Orders</h3>
          {orders.length > 0 ? (
            <div className="orders-table">
              <table>
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Amt</th>
                    <th>Filled</th>
                    <th>Queue Pos</th>
                    <th>Vol Ahead</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr
                      key={order.order_id !== 'unknown' ? order.order_id : `unknown-${index}`}
                      onClick={() => setSelectedOrderForDepth(order)}
                      className={selectedOrderForDepth?.order_id === order.order_id ? 'selected' : ''}
                    >
                      <td className="pair">{order.pair}</td>
                      <td className={`side ${order.side}`}>
                        {order.side.toUpperCase()}
                      </td>
                      <td className="price">{order.price.toFixed(2)}</td>
                      <td>{order.amount.toFixed(4)}</td>
                      <td className="filled">
                        {order.filled.toFixed(4)}
                        <span className="percent">
                          ({((order.filled / order.amount) * 100).toFixed(0)}%)
                        </span>
                      </td>
                      <td className={`queue-pos ${order.priceLevelsAhead === 0 ? 'best' : 'behind'}`}>
                        {order.priceLevelsAhead === 0 ? '🥇 BEST' : `L+${order.priceLevelsAhead}`}
                      </td>
                      <td className="vol-ahead">{order.volumeAhead.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">📭 No open orders</div>
          )}
        </div>

        {/* Right Panel */}
        <div className="sentinel-right">
          {/* Alerts Panel */}
          <div className="alerts-panel">
            <h3>🚨 Recent Alerts ({alerts.length})</h3>
            <div className="alerts-list">
              {alerts.length > 0 ? (
                alerts.slice().reverse().map(alert => (
                  <div key={alert.id} className={`alert alert-${alert.type.toLowerCase()}`}>
                    <div className="alert-time">
                      {alert.timestamp.toLocaleTimeString()}
                    </div>
                    <div className="alert-message">{alert.message}</div>
                  </div>
                ))
              ) : (
                <div className="empty-small">No alerts</div>
              )}
            </div>
          </div>

          {/* Depth Panel */}
          {selectedOrderForDepth && (
            <div className="depth-panel">
              <h3>{selectedOrderForDepth.pair} Depth</h3>
              <div className="depth-container">
                <div className="depth-asks">
                  {orderbooks.get(selectedOrderForDepth.pair)?.sell.slice(0, 10).reverse().map((level, idx) => (
                    <div
                      key={idx}
                      className={`level ${level.price === selectedOrderForDepth.price ? 'mine' : ''}`}
                    >
                      <span className="price ask">{level.price.toFixed(2)}</span>
                      <span className="qty">{level.qty.toFixed(4)}</span>
                      {level.price === selectedOrderForDepth.price && <span className="mine-label">mine ►</span>}
                    </div>
                  ))}
                </div>

                <div className="depth-mid">
                  <span className="spread">
                    {selectedOrderForDepth.price.toFixed(2)}
                  </span>
                </div>

                <div className="depth-bids">
                  {orderbooks.get(selectedOrderForDepth.pair)?.buy.slice(0, 10).map((level, idx) => (
                    <div
                      key={idx}
                      className={`level ${level.price === selectedOrderForDepth.price ? 'mine' : ''}`}
                    >
                      {level.price === selectedOrderForDepth.price && <span className="mine-label">◄ mine</span>}
                      <span className="qty">{level.qty.toFixed(4)}</span>
                      <span className="price bid">{level.price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
