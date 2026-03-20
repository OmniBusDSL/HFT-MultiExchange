import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/BalancePage.css';

interface BalanceItem {
  currency: string;
  free: number;
  used: number;
  total: number;
}

interface ExchangeBalance {
  exchange: string;
  balances: BalanceItem[];
  total: number;
  loading: boolean;
  error: string | null;
}

interface APIKey {
  id: number;
  name: string;
  exchange: string;
}

export const BalancePage = () => {
  const { user } = useAuth();
  const [exchangeBalances, setExchangeBalances] = useState<ExchangeBalance[]>([]);
  const [apiKeysByExchange, setApiKeysByExchange] = useState<Map<string, APIKey[]>>(new Map());
  const [selectedApiKey, setSelectedApiKey] = useState<Map<string, number>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAllBalances();
  }, []);

  const fetchAllBalances = async () => {
    setRefreshing(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');

      // Fetch API keys
      const keysResponse = await fetch('http://127.0.0.1:8000/apikeys', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!keysResponse.ok) throw new Error('Failed to fetch API keys');
      const keysData = await keysResponse.json();

      // Group by exchange
      const exchangeGroups = new Map<string, APIKey[]>();
      const newSelectedApiKey = new Map<string, number>();

      keysData.keys?.forEach((key: any) => {
        const exchange = key.exchange.toUpperCase();
        if (!exchangeGroups.has(exchange)) {
          exchangeGroups.set(exchange, []);
          // Initialize with the first key
          newSelectedApiKey.set(exchange, key.id);
        }
        exchangeGroups.get(exchange)!.push({
          id: key.id,
          name: key.name,
          exchange: exchange
        });
      });

      setApiKeysByExchange(exchangeGroups);
      setSelectedApiKey(newSelectedApiKey);

      // Fetch balances for selected keys
      await fetchBalancesForSelectedKeys(token, exchangeGroups, newSelectedApiKey);
    } catch (err) {
      console.error('Error:', err);
      setExchangeBalances([
        {
          exchange: 'ERROR',
          balances: [],
          total: 0,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load balances'
        }
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const fetchBalancesForSelectedKeys = async (
    token: string,
    exchangeGroups: Map<string, APIKey[]>,
    selectedKeys: Map<string, number>
  ) => {
    const balances: ExchangeBalance[] = [];

    for (const [exchange, keys] of exchangeGroups.entries()) {
      const selectedKeyId = selectedKeys.get(exchange);
      const selectedKey = keys.find(k => k.id === selectedKeyId);

      const exchangeData: ExchangeBalance = {
        exchange: exchange,
        balances: [],
        total: 0,
        loading: false,
        error: null
      };

      if (selectedKey) {
        try {
          const balanceResponse = await fetch(`http://127.0.0.1:8000/apikeys/${selectedKey.id}/balance`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (balanceResponse.ok) {
            const balanceData = await balanceResponse.json();
            exchangeData.balances = balanceData.balances || [];
            exchangeData.total = balanceData.total || 0;
            console.log(`✓ [${exchange}] Balance fetched:`, balanceData);
          } else {
            const errorText = await balanceResponse.text();
            exchangeData.error = `HTTP ${balanceResponse.status}: ${errorText.substring(0, 100)}`;
            console.error(`✗ [${exchange}] Balance error:`, balanceResponse.status, errorText);
          }
        } catch (err) {
          exchangeData.error = err instanceof Error ? err.message : 'Error fetching balance';
          console.error(`✗ [${exchange}] Exception:`, err);
        }
      }

      balances.push(exchangeData);
    }

    setExchangeBalances(balances);
  };

  const handleApiKeyChange = async (exchange: string, keyId: number) => {
    const newSelected = new Map(selectedApiKey);
    newSelected.set(exchange, keyId);
    setSelectedApiKey(newSelected);

    const token = localStorage.getItem('token');
    if (token) {
      await fetchBalancesForSelectedKeys(token, apiKeysByExchange, newSelected);
    }
  };

  const EXCHANGE_ICONS: { [key: string]: string } = {
    LCX: '🏪',
    KRAKEN: '🐙',
    COINBASE: '₿'
  };

  const EXCHANGE_COLORS: { [key: string]: string } = {
    LCX: '#1E90FF',
    KRAKEN: '#522A86',
    COINBASE: '#0052FF'
  };

  return (
    <div className="balance-page">
      <div className="page-header">
        <h1>💰 Exchange Balances</h1>
        <p>Connected as: {user?.email}</p>
      </div>

      {apiKeysByExchange.size > 0 && Array.from(apiKeysByExchange.values()).some(keys => keys.length > 1) && (
        <div className="feature-notification">
          <span className="notification-icon">✨</span>
          <div className="notification-content">
            <strong>New Feature:</strong> You now have multiple API keys for some exchanges!
            Click the dropdown next to the exchange name to select which API key to use for viewing balances.
          </div>
          <span className="notification-close" onClick={(e) => {
            e.currentTarget.parentElement?.remove();
          }}>×</span>
        </div>
      )}

      <div className="balance-controls">
        <button
          className="btn-refresh"
          onClick={fetchAllBalances}
          disabled={refreshing}
        >
          {refreshing ? '⏳ Refreshing...' : '🔄 Refresh Balances'}
        </button>
      </div>

      <div className="exchanges-grid">
        {exchangeBalances.length === 0 ? (
          <div className="no-exchanges">
            <p>📭 No API keys connected yet</p>
            <p>Go to <strong>/apikeys</strong> to add your exchange credentials</p>
          </div>
        ) : (
          exchangeBalances.map((exchange) => {
            const keys = apiKeysByExchange.get(exchange.exchange) || [];
            const selectedKeyId = selectedApiKey.get(exchange.exchange);
            const selectedKey = keys.find(k => k.id === selectedKeyId);

            return (
            <div
              key={exchange.exchange}
              className="exchange-card"
              style={{ borderTopColor: EXCHANGE_COLORS[exchange.exchange] || '#0088ff' }}
            >
              <div className="exchange-header">
                <div className="exchange-info">
                  <span className="exchange-icon">
                    {EXCHANGE_ICONS[exchange.exchange] || '💱'}
                  </span>
                  <div className="exchange-title">
                    <h2>{exchange.exchange}</h2>
                    {keys.length > 1 && (
                      <select
                        className="api-key-selector"
                        value={selectedKeyId || ''}
                        onChange={(e) => handleApiKeyChange(exchange.exchange, parseInt(e.target.value))}
                      >
                        {keys.map(key => (
                          <option key={key.id} value={key.id}>
                            {key.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {keys.length === 1 && selectedKey && (
                      <p className="api-key-label">API Key: {selectedKey.name}</p>
                    )}
                  </div>
                </div>
                <div className="exchange-total">
                  <p className="total-label">Total Value</p>
                  <p className="total-amount">
                    {exchange.total > 0
                      ? `$${exchange.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                      : '—'
                    }
                  </p>
                </div>
              </div>

              {exchange.error ? (
                <div className="exchange-error">
                  <p>⚠️ {exchange.error}</p>
                </div>
              ) : exchange.balances.length === 0 ? (
                <div className="exchange-empty">
                  <p>No balance data available</p>
                </div>
              ) : (
                <div className="exchange-balances">
                  <div className="balances-list">
                    {exchange.balances
                      .filter(b => b.total > 0)
                      .sort((a, b) => b.total - a.total)
                      .map((balance) => (
                        <div key={balance.currency} className="balance-item">
                          <div className="balance-left">
                            <span className="currency-name">{balance.currency}</span>
                            <span className="currency-amount">
                              {balance.total.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                            </span>
                          </div>
                          <div className="balance-right">
                            {balance.used > 0 && (
                              <span className="amount-used">
                                {balance.used.toLocaleString('en-US', { maximumFractionDigits: 8 })} locked
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
            );
          })
        )}
      </div>

      <style>{`
        .balance-page {
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
          margin: 0 0 5px 0;
          color: #fff;
          font-size: 28px;
        }

        .page-header p {
          margin: 0;
          color: #aaa;
          font-size: 14px;
        }

        .feature-notification {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(34, 197, 94, 0.05));
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-left: 4px solid #10b981;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          animation: slideDown 0.3s ease-out;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .notification-icon {
          font-size: 20px;
          flex-shrink: 0;
        }

        .notification-content {
          flex: 1;
          color: #d1fae5;
          font-size: 14px;
          line-height: 1.5;
        }

        .notification-content strong {
          color: #10b981;
          display: block;
          margin-bottom: 4px;
        }

        .notification-close {
          color: rgba(16, 185, 129, 0.6);
          font-size: 24px;
          cursor: pointer;
          font-weight: 300;
          transition: color 0.2s;
          flex-shrink: 0;
          line-height: 1;
        }

        .notification-close:hover {
          color: #10b981;
        }

        .balance-controls {
          margin-bottom: 30px;
          display: flex;
          gap: 10px;
        }

        .btn-refresh {
          padding: 12px 24px;
          background: linear-gradient(135deg, #0088ff, #0070d0);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }

        .btn-refresh:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(0, 136, 255, 0.4);
        }

        .btn-refresh:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .exchanges-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }

        .no-exchanges {
          grid-column: 1 / -1;
          text-align: center;
          padding: 60px 20px;
          background: rgba(0, 136, 255, 0.05);
          border-radius: 12px;
          border: 2px dashed rgba(0, 136, 255, 0.2);
        }

        .no-exchanges p {
          margin: 10px 0;
          color: #aaa;
          font-size: 16px;
        }

        .no-exchanges p strong {
          color: #0088ff;
        }

        .exchange-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(0, 136, 255, 0.2);
          border-radius: 12px;
          border-top: 4px solid #0088ff;
          overflow: hidden;
          transition: all 0.3s;
        }

        .exchange-card:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(0, 136, 255, 0.4);
          box-shadow: 0 5px 20px rgba(0, 136, 255, 0.1);
        }

        .exchange-header {
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid rgba(0, 136, 255, 0.1);
        }

        .exchange-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .exchange-icon {
          font-size: 32px;
        }

        .exchange-title {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .exchange-info h2 {
          margin: 0;
          color: #fff;
          font-size: 20px;
        }

        .api-key-selector {
          background: rgba(0, 136, 255, 0.1);
          border: 1px solid rgba(0, 136, 255, 0.3);
          color: #fff;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .api-key-selector:hover {
          background: rgba(0, 136, 255, 0.2);
          border-color: rgba(0, 136, 255, 0.5);
        }

        .api-key-selector:focus {
          outline: none;
          background: rgba(0, 136, 255, 0.3);
          border-color: #0088ff;
          box-shadow: 0 0 8px rgba(0, 136, 255, 0.3);
        }

        .api-key-selector option {
          background: #1a1a2e;
          color: #fff;
        }

        .api-key-label {
          margin: 0;
          color: #888;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .exchange-total {
          text-align: right;
        }

        .total-label {
          margin: 0;
          color: #888;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .total-amount {
          margin: 5px 0 0 0;
          color: #4ade80;
          font-size: 18px;
          font-weight: 600;
        }

        .exchange-error {
          padding: 20px;
          background: rgba(248, 113, 113, 0.1);
          color: #f87171;
          border-radius: 8px;
          margin: 15px;
        }

        .exchange-error p {
          margin: 0;
        }

        .exchange-empty {
          padding: 40px 20px;
          text-align: center;
          color: #888;
        }

        .exchange-balances {
          padding: 15px;
        }

        .balances-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .balance-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          transition: all 0.2s;
        }

        .balance-item:hover {
          background: rgba(0, 136, 255, 0.1);
        }

        .balance-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .currency-name {
          color: #fff;
          font-weight: 600;
          font-size: 14px;
        }

        .currency-amount {
          color: #4ade80;
          font-size: 13px;
          font-family: 'Courier New', monospace;
        }

        .balance-right {
          text-align: right;
        }

        .amount-used {
          color: #fbbf24;
          font-size: 11px;
          font-family: 'Courier New', monospace;
        }

        @media (max-width: 768px) {
          .exchanges-grid {
            grid-template-columns: 1fr;
          }

          .exchange-header {
            flex-direction: column;
            gap: 15px;
          }

          .exchange-total {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};
