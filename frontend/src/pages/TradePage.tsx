import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import '../styles/TradePage.css';

interface PriceLevel {
  price: number;
  amount: number;
}

interface OrderBook {
  exchange: string;
  symbol: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

interface ApiKey {
  id: number;
  name: string;
  exchange: string;
}

interface Order {
  id: string;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  status: string;
}

const EXCHANGES = ['lcx', 'kraken', 'coinbase'];

export const TradePage = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  // State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<string>('');
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [orderBook, setOrderBook] = useState<OrderBook>({
    exchange: '',
    symbol: '',
    bids: [],
    asks: [],
  });
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [openOrders, setOpenOrders] = useState<Order[]>([]);

  // Loading states
  const [keysLoading, setKeysLoading] = useState(true);
  const [pairsLoading, setPairsLoading] = useState(false);
  const [obLoading, setObLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);

  // Load API keys on mount
  useEffect(() => {
    // Test mode - load without token requirement
    if (token) {
      fetchApiKeys();
    } else {
      // Test mode: try to load keys anyway
      setKeysLoading(false);
    }
  }, [token]);

  const fetchApiKeys = async () => {
    // Must have token to fetch keys
    if (!token) {
      console.log('[TradePage] No token, cannot fetch API keys');
      setKeysLoading(false);
      return;
    }

    try {
      console.log('[TradePage] Fetching API keys from /api/apikeys');
      const response = await fetch('/api/apikeys', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const keysList = data.keys || [];
        console.log('[TradePage] Got API keys:', keysList.length);
        setApiKeys(keysList);
        if (keysList.length > 0) {
          const firstExchange = keysList[0].exchange;
          setSelectedExchange(firstExchange);
          setSelectedKeyId(keysList[0].id);
        }
      } else {
        console.error('[TradePage] API keys endpoint returned:', response.status);
        setApiKeys([]);
      }
    } catch (err) {
      console.error('[TradePage] Error fetching API keys:', err);
      setApiKeys([]);
    } finally {
      setKeysLoading(false);
    }
  };

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

  const fetchAvailablePairs = async () => {
    setPairsLoading(true);
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/public/tickers?exchange=${selectedExchange}`
      );
      if (response.ok) {
        const data = await response.json();
        const pairs = data.tickers?.map((t: any) => t.symbol) || [];
        setAvailablePairs(pairs);
        if (pairs.length > 0 && !selectedSymbol) {
          setSelectedSymbol(pairs[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching pairs:', err);
    } finally {
      setPairsLoading(false);
    }
  };

  const fetchOrderBook = async () => {
    if (!selectedSymbol || !selectedExchange) return;
    setObLoading(true);
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/public/orderbook?exchange=${selectedExchange}&symbol=${selectedSymbol}&limit=20`
      );
      if (response.ok) {
        const data = await response.json();
        setOrderBook({
          exchange: data.exchange || selectedExchange,
          symbol: data.symbol || selectedSymbol,
          bids: data.bids || [],
          asks: data.asks || [],
        });
      }
    } catch (err) {
      console.error('Error fetching order book:', err);
    } finally {
      setObLoading(false);
    }
  };

  const fetchOpenOrders = async () => {
    if (!selectedKeyId) return;
    setOrdersLoading(true);
    try {
      const response = await fetch(`/api/apikeys/${selectedKeyId}/orders/open`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setOpenOrders(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching open orders:', err);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!selectedKeyId || !selectedSymbol || !price || !quantity) {
      alert('Please fill all fields and select an API key');
      return;
    }

    const selectedKey = apiKeys.find(k => k.id === selectedKeyId);

    setOrderLoading(true);
    try {
      const response = await fetch(`/api/apikeys/${selectedKeyId}/orders/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbol: selectedSymbol,
          side: orderSide,
          amount: parseFloat(quantity),
          price: parseFloat(price),
          type: 'limit',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✓ Order placed! ID: ${data.id || 'pending'}`);
        setPrice('');
        setQuantity('');
        fetchOpenOrders();
      } else {
        const error = await response.json();
        alert(`✗ Failed: ${error.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`✗ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setOrderLoading(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('Cancel this order?')) return;

    try {
      const response = await fetch(`/api/apikeys/${selectedKeyId}/orders/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ order_id: orderId }),
      });

      if (response.ok) {
        alert('Order canceled');
        fetchOpenOrders();
      } else {
        const error = await response.json();
        alert(`Failed: ${error.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Effects for data fetching
  useEffect(() => {
    fetchAvailablePairs();
  }, [selectedExchange]);

  useEffect(() => {
    if (selectedSymbol && selectedExchange) {
      fetchOrderBook();
    }
  }, [selectedExchange, selectedSymbol]);

  useEffect(() => {
    if (selectedKeyId) {
      const selected = apiKeys.find(k => k.id === selectedKeyId);
      if (selected) {
        setSelectedExchange(selected.exchange);
      }
      fetchOpenOrders();
    }
  }, [selectedKeyId]);

  // Loading state
  if (keysLoading) {
    return <div style={{ padding: '20px' }}>Loading...</div>;
  }

  // Order book stats
  const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0].price : 0;
  const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0].price : 0;
  const midpoint = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;

  return (
    <div style={{ padding: '20px' }}>
      <h1>📊 Trade</h1>

      {/* Message */}
      {apiKeys.length === 0 && (
        <div style={{
          padding: '15px',
          marginBottom: '20px',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: '0.625rem',
          color: '#fbbf24',
          backdropFilter: 'blur(10px)',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)'
        }}>
          ⚠️ No API keys loaded. {!token ? 'Login first or ' : ''}Add API key in API Keys page.
        </div>
      )}

      {/* Controls */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '15px',
        marginBottom: '20px',
        padding: '20px',
        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.7) 0%, rgba(31, 41, 55, 0.4) 100%)',
        border: '1px solid rgba(51, 65, 85, 0.4)',
        borderRadius: '1rem',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        {/* Exchange */}
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Exchange
          </label>
          <select
            value={selectedExchange}
            onChange={(e) => setSelectedExchange(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '0.625rem',
              border: '1px solid rgba(51, 65, 85, 0.3)',
              fontSize: '14px',
              background: 'rgba(17, 24, 39, 0.6)',
              color: '#f1f5f9',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
          >
            {apiKeys.length === 0 && <option>No API keys available</option>}
            {Array.from(new Set(apiKeys.map((k) => k.exchange))).map((exchange) => (
              <option key={exchange} value={exchange}>{exchange.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            API Key
          </label>
          <select
            value={selectedKeyId || ''}
            onChange={(e) => setSelectedKeyId(parseInt(e.target.value))}
            disabled={filteredKeys.length === 0}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '0.625rem',
              border: '1px solid rgba(51, 65, 85, 0.3)',
              fontSize: '14px',
              background: 'rgba(17, 24, 39, 0.6)',
              color: '#f1f5f9',
              backdropFilter: 'blur(10px)',
              cursor: filteredKeys.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              opacity: filteredKeys.length === 0 ? 0.5 : 1
            }}
          >
            {filteredKeys.length === 0 && <option>No API keys for this exchange</option>}
            {filteredKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name}
              </option>
            ))}
          </select>
        </div>

        {/* Pair */}
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Pair
          </label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            disabled={pairsLoading || availablePairs.length === 0}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '0.625rem',
              border: '1px solid rgba(51, 65, 85, 0.3)',
              fontSize: '14px',
              background: 'rgba(17, 24, 39, 0.6)',
              color: '#f1f5f9',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              opacity: pairsLoading || availablePairs.length === 0 ? 0.5 : 1
            }}
          >
            <option value="">-- Select --</option>
            {availablePairs.map((pair) => (
              <option key={pair} value={pair}>{pair}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Order Book */}
      <div style={{
        marginBottom: '20px',
        padding: '20px',
        border: '1px solid rgba(51, 65, 85, 0.4)',
        borderRadius: '1rem',
        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.7) 0%, rgba(31, 41, 55, 0.4) 100%)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <h3>Order Book</h3>
        {obLoading ? (
          <p>Loading...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <h4>Bids (Buy)</h4>
                {orderBook.bids.slice(0, 5).map((bid, i) => (
                  <div key={i} style={{
                    padding: '10px',
                    borderBottom: '1px solid rgba(51, 65, 85, 0.2)',
                    color: '#10b981'
                  }}>
                    ${bid.price.toFixed(2)} × {bid.amount.toFixed(4)}
                  </div>
                ))}
              </div>
              <div>
                <h4>Asks (Sell)</h4>
                {orderBook.asks.slice(0, 5).map((ask, i) => (
                  <div key={i} style={{
                    padding: '10px',
                    borderBottom: '1px solid rgba(51, 65, 85, 0.2)',
                    color: '#ef4444'
                  }}>
                    ${ask.price.toFixed(2)} × {ask.amount.toFixed(4)}
                  </div>
                ))}
              </div>
            </div>
            {midpoint && (
              <div style={{
                marginTop: '15px',
                padding: '15px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(6, 182, 212, 0.1) 100%)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '0.625rem',
                color: '#c7d2fe'
              }}>
                <strong>Spread:</strong> ${(bestAsk - bestBid).toFixed(2)} | <strong>Midpoint:</strong> ${midpoint.toFixed(2)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Order Form */}
      <div style={{
        marginBottom: '20px',
        padding: '20px',
        border: '1px solid rgba(51, 65, 85, 0.4)',
        borderRadius: '1rem',
        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.7) 0%, rgba(31, 41, 55, 0.4) 100%)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <h3>Place Order</h3>
        <div style={{ display: 'grid', gap: '10px' }}>
          <label>
            <input
              type="radio"
              name="side"
              value="buy"
              checked={orderSide === 'buy'}
              onChange={() => setOrderSide('buy')}
            />
            {' '}Buy
          </label>
          <label>
            <input
              type="radio"
              name="side"
              value="sell"
              checked={orderSide === 'sell'}
              onChange={() => setOrderSide('sell')}
            />
            {' '}Sell
          </label>

          <input
            type="number"
            placeholder="Price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            step="0.01"
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '0.625rem',
              border: '1px solid rgba(51, 65, 85, 0.3)',
              fontSize: '14px',
              background: 'rgba(17, 24, 39, 0.6)',
              color: '#f1f5f9',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.3s ease'
            }}
          />

          <input
            type="number"
            placeholder="Amount"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            step="0.0001"
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '0.625rem',
              border: '1px solid rgba(51, 65, 85, 0.3)',
              fontSize: '14px',
              background: 'rgba(17, 24, 39, 0.6)',
              color: '#f1f5f9',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.3s ease'
            }}
          />

          <button
            onClick={handlePlaceOrder}
            disabled={orderLoading || !selectedKeyId || !selectedSymbol}
            style={{
              padding: '12px 24px',
              background: orderSide === 'buy'
                ? 'linear-gradient(135deg, #10b981, rgba(16, 185, 129, 0.8))'
                : 'linear-gradient(135deg, #ef4444, rgba(239, 68, 68, 0.8))',
              color: 'white',
              border: 'none',
              borderRadius: '0.625rem',
              cursor: orderLoading || !selectedKeyId || !selectedSymbol ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              transition: 'all 0.3s ease',
              opacity: orderLoading || !selectedKeyId || !selectedSymbol ? 0.5 : 1,
              boxShadow: '0 8px 20px rgba(16, 185, 129, 0.3)',
              transform: (orderLoading || !selectedKeyId || !selectedSymbol) ? 'none' : 'translateY(0)'
            }}
          >
            {orderLoading ? 'Placing...' : `${orderSide.toUpperCase()} ${quantity || 0}`}
          </button>
        </div>
      </div>

      {/* Open Orders */}
      <div style={{
        padding: '20px',
        border: '1px solid rgba(51, 65, 85, 0.4)',
        borderRadius: '1rem',
        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.7) 0%, rgba(31, 41, 55, 0.4) 100%)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <h3>Open Orders</h3>
        {ordersLoading ? (
          <p>Loading...</p>
        ) : openOrders.length === 0 ? (
          <p style={{ color: '#999' }}>No open orders</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{
                borderBottom: '2px solid rgba(51, 65, 85, 0.4)',
                background: 'rgba(51, 65, 85, 0.2)'
              }}>
                <th style={{
                  textAlign: 'left',
                  padding: '12px',
                  color: '#cbd5e1',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>Symbol</th>
                <th style={{
                  textAlign: 'left',
                  padding: '12px',
                  color: '#cbd5e1',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>Side</th>
                <th style={{
                  textAlign: 'right',
                  padding: '12px',
                  color: '#cbd5e1',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>Price</th>
                <th style={{
                  textAlign: 'right',
                  padding: '12px',
                  color: '#cbd5e1',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>Amount</th>
                <th style={{
                  textAlign: 'left',
                  padding: '12px',
                  color: '#cbd5e1',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>Status</th>
                <th style={{
                  textAlign: 'center',
                  padding: '12px',
                  color: '#cbd5e1',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {openOrders.map((order) => (
                <tr key={order.id} style={{
                  borderBottom: '1px solid rgba(51, 65, 85, 0.2)',
                  background: 'rgba(51, 65, 85, 0.05)',
                  transition: 'all 0.2s ease'
                }}>
                  <td style={{ padding: '12px' }}>{order.symbol}</td>
                  <td style={{
                    padding: '12px',
                    color: order.side === 'buy' ? '#10b981' : '#ef4444',
                    fontWeight: '600'
                  }}>
                    {order.side.toUpperCase()}
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px' }}>${order.price.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '12px' }}>{order.amount.toFixed(4)}</td>
                  <td style={{ padding: '12px', color: '#cbd5e1', fontSize: '0.875rem' }}>{order.status}</td>
                  <td style={{ textAlign: 'center', padding: '12px' }}>
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      style={{
                        padding: '6px 12px',
                        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(245, 158, 11, 0.1) 100%)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '0.375rem',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                        transition: 'all 0.3s ease'
                      }}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
