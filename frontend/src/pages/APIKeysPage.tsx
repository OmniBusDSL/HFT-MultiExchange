import { useState, useEffect, useCallback } from 'react';
import '../styles/APIKeysPage.css';

interface APIKey {
  id: string;
  name: string;
  exchange: 'lcx' | 'coinbase' | 'kraken' | 'coingecko' | 'coinmarketcap' | 'cryptocompare' | 'lunarcrush' | 'infura' | 'alchemy' | 'etherscan' | 'walletconnect' | 'openai' | 'claude' | 'gemini' | 'mistral' | 'perplexity' | 'x' | 'facebook' | 'instagram' | 'farcaster';
  apiKey: string;
  apiSecret: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

interface ProviderCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  category: 'exchange' | 'market' | 'web3' | 'ai' | 'social';
  description: string;
  requiresSecret: boolean;
}

const PROVIDERS: ProviderCategory[] = [
  // 💱 Exchanges (Lichiditate)
  {
    id: 'lcx',
    name: 'LCX',
    icon: '🏪',
    color: '#1E90FF',
    category: 'exchange',
    description: 'Reglementat, Liechtenstein',
    requiresSecret: true
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    icon: '₿',
    color: '#0052FF',
    category: 'exchange',
    description: 'Standardul US',
    requiresSecret: true
  },
  {
    id: 'kraken',
    name: 'Kraken',
    icon: '🐙',
    color: '#522A86',
    category: 'exchange',
    description: 'Securitate & Proof of Reserves',
    requiresSecret: true
  },
  // 📈 Market Data (Analiză)
  {
    id: 'coingecko',
    name: 'CoinGecko',
    icon: '🦎',
    color: '#65CD63',
    category: 'market',
    description: 'Prețuri & Ranking global',
    requiresSecret: false
  },
  {
    id: 'coinmarketcap',
    name: 'CoinMarketCap',
    icon: '📊',
    color: '#00AFFF',
    category: 'market',
    description: 'Data instituționale & ranking',
    requiresSecret: false
  },
  {
    id: 'cryptocompare',
    name: 'CryptoCompare',
    icon: '📈',
    color: '#F7931A',
    category: 'market',
    description: 'Date istorice & OHLCV',
    requiresSecret: false
  },
  {
    id: 'lunarcrush',
    name: 'LunarCrush',
    icon: '🌙',
    color: '#FF00FF',
    category: 'market',
    description: 'Sentiment social & influență',
    requiresSecret: true
  },
  // ⛓️ Web3 & Dev Tools (Infrastructură)
  {
    id: 'infura',
    name: 'Infura',
    icon: '🌐',
    color: '#FF6B35',
    category: 'web3',
    description: 'Noduri și acces la date',
    requiresSecret: true
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    icon: '⛓️',
    color: '#1F2937',
    category: 'web3',
    description: 'Noduri și acces la date',
    requiresSecret: true
  },
  {
    id: 'etherscan',
    name: 'Etherscan',
    icon: '🔗',
    color: '#1A8FE3',
    category: 'web3',
    description: 'Explorator & transparență on-chain',
    requiresSecret: false
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: '🔐',
    color: '#3B99FC',
    category: 'web3',
    description: 'Protocolul de legătură între app',
    requiresSecret: true
  },
  // 🤖 AI & LLM (Inteligență)
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🤖',
    color: '#10A37F',
    category: 'ai',
    description: 'ChatGPT & GPT-4',
    requiresSecret: true
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: '🧠',
    color: '#9370DB',
    category: 'ai',
    description: 'Anthropic AI',
    requiresSecret: true
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: '✨',
    color: '#4285F4',
    category: 'ai',
    description: 'Google AI',
    requiresSecret: true
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: '🌪️',
    color: '#FF6B35',
    category: 'ai',
    description: 'Open-source european',
    requiresSecret: true
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    icon: '🔍',
    color: '#00D4FF',
    category: 'ai',
    description: 'Căutare bazată pe AI',
    requiresSecret: true
  },
  // 📱 Social Media (Propagare)
  {
    id: 'x',
    name: 'X (Twitter)',
    icon: '𝕏',
    color: '#000000',
    category: 'social',
    description: 'Piața centrală pentru crypto',
    requiresSecret: true
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: '👤',
    color: '#1877F2',
    category: 'social',
    description: 'Adopție masă & NFT-uri',
    requiresSecret: true
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: '📸',
    color: '#E1306C',
    category: 'social',
    description: 'Conținut vizual & marketing',
    requiresSecret: true
  },
  {
    id: 'farcaster',
    name: 'Farcaster',
    icon: '🌟',
    color: '#855DCD',
    category: 'social',
    description: 'Alternativa Web3 descentralizată',
    requiresSecret: true
  }
];

type CategoryType = 'exchange' | 'market' | 'web3' | 'ai' | 'social';

export const APIKeysPage = () => {
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryType>('exchange');
  const [formData, setFormData] = useState({
    name: '',
    exchange: 'lcx' as const,
    apiKey: '',
    apiSecret: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; loading: boolean }>>({});

  const loadAPIKeys = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/apikeys', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch API keys');

      const data = await response.json();

      // Format keys for display - hide secrets
      const formattedKeys: APIKey[] = data.keys.map((key: any) => ({
        id: key.id,
        name: key.name,
        exchange: key.exchange,
        apiKey: key.apiKey.length > 10 ? key.apiKey.substring(0, 10) + '***' : '***',
        apiSecret: '***',
        status: key.status,
        createdAt: key.createdAt
      }));

      setApiKeys(formattedKeys);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load API keys' });
      console.error('Error loading API keys:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAPIKeys();
  }, [loadAPIKeys]);

  const handleAddKey = async () => {
    const provider = PROVIDERS.find(p => p.id === formData.exchange);
    const requiresSecret = provider?.requiresSecret ?? true;

    if (!formData.apiKey) {
      setMessage({ type: 'error', text: 'API Key este obligatorie' });
      return;
    }

    if (requiresSecret && !formData.apiSecret) {
      setMessage({ type: 'error', text: 'API Secret este obligatorie pentru acest provider' });
      return;
    }

    try {
      setLoading(true);

      // Save to database via API
      const token = localStorage.getItem('token');
      const response = await fetch('/api/apikeys/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: formData.name,
          exchange: formData.exchange,
          apiKey: formData.apiKey,
          apiSecret: requiresSecret ? formData.apiSecret : ''
        })
      });

      if (response.ok) {
        setFormData({ name: '', exchange: 'lcx', apiKey: '', apiSecret: '' });
        setMessage({ type: 'success', text: 'API Key adăugată cu succes!' });
        // Reload API keys from server
        await loadAPIKeys();
        setTimeout(() => setMessage(null), 3000);
      } else {
        throw new Error('Failed to save API key');
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Eroare la salvare'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('Ești sigur că vrei să ștergi această API Key?')) return;

    try {
      setLoading(true);

      // Delete from database
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/apikeys/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'API Key ștearsă cu succes!' });
        // Reload API keys from server
        await loadAPIKeys();
        setTimeout(() => setMessage(null), 3000);
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Eroare la ștergere' });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (keyId: string) => {
    setTestResults(prev => ({
      ...prev,
      [keyId]: { success: false, message: '', loading: true }
    }));

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/apikeys/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id: keyId })
      });

      const data = await response.json();
      setTestResults(prev => ({
        ...prev,
        [keyId]: { success: data.success, message: data.message, loading: false }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [keyId]: { success: false, message: 'Network error', loading: false }
      }));
    }
  };

  const getProviderInfo = (providerId: string) => {
    return PROVIDERS.find(p => p.id === providerId);
  };

  const providersByCategory = {
    exchange: PROVIDERS.filter(p => p.category === 'exchange'),
    market: PROVIDERS.filter(p => p.category === 'market'),
    web3: PROVIDERS.filter(p => p.category === 'web3'),
    ai: PROVIDERS.filter(p => p.category === 'ai'),
    social: PROVIDERS.filter(p => p.category === 'social')
  };

  return (
    <div className="apikeys-page">
      <div className="page-header">
        <h1>🔑 API Keys Management</h1>
        <p>Conectează-te cu exchange-urile tale preferate</p>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          <p>{message.text}</p>
        </div>
      )}

      <div className="apikeys-content">
        <div className="add-key-section">
          <h2>Adaugă nouă API Key</h2>

          <div className="form-group">
            <label>Nume (e.g., "Trading Bot", "LCX Main")</label>
            <input
              type="text"
              placeholder="Introdu un nume pentru această API Key"
              value={formData.name}
              onChange={(e) => setFormData({
                ...formData,
                name: e.target.value
              })}
              className="form-input"
            />
          </div>

          <div className="provider-selector">
            <label>Provider Category</label>
            <div className="category-tabs">
              {(['exchange', 'market', 'web3', 'ai', 'social'] as const).map(category => (
                <button
                  key={category}
                  className={`category-tab ${activeCategory === category ? 'active' : ''}`}
                  onClick={() => {
                    setActiveCategory(category);
                    const firstProvider = providersByCategory[category][0];
                    if (firstProvider) {
                      setFormData(prev => ({ ...prev, exchange: firstProvider.id as any }));
                    }
                  }}
                >
                  {category === 'exchange' && '💱 Exchanges'}
                  {category === 'market' && '📈 Market Data'}
                  {category === 'web3' && '⛓️ Web3 Tools'}
                  {category === 'ai' && '🤖 AI & LLM'}
                  {category === 'social' && '📱 Social Media'}
                </button>
              ))}
            </div>

            <label style={{ marginTop: '20px' }}>Select Provider</label>
            <div className="provider-cards-grid">
              {providersByCategory[activeCategory].map(provider => (
                <div
                  key={provider.id}
                  className={`provider-card ${formData.exchange === provider.id ? 'selected' : ''}`}
                  onClick={() => {
                    setFormData(prev => ({ ...prev, exchange: provider.id as any }));
                  }}
                >
                  <div className="provider-card-header">
                    <span className="provider-icon" style={{ fontSize: '28px' }}>
                      {provider.icon}
                    </span>
                    <div className="provider-card-info">
                      <h4 style={{ margin: '0 0 4px 0' }}>{provider.name}</h4>
                      <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>
                        {provider.description}
                      </p>
                    </div>
                  </div>
                  {provider.requiresSecret && (
                    <span className="secret-badge">🔐 Secret</span>
                  )}
                </div>
              ))}
            </div>

            {getProviderInfo(formData.exchange as string) && (
              <div className="selected-provider-info">
                <div style={{ fontSize: '24px', marginRight: '10px' }}>
                  {getProviderInfo(formData.exchange as string)?.icon}
                </div>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: '#fff' }}>
                    {getProviderInfo(formData.exchange as string)?.name}
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>
                    {getProviderInfo(formData.exchange as string)?.description}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              placeholder="Introdu API Key"
              value={formData.apiKey}
              onChange={(e) => setFormData({
                ...formData,
                apiKey: e.target.value
              })}
              className="form-input"
            />
          </div>

          {PROVIDERS.find(p => p.id === formData.exchange)?.requiresSecret && (
            <div className="form-group">
              <label>API Secret</label>
              <input
                type="password"
                placeholder="Introdu API Secret"
                value={formData.apiSecret}
                onChange={(e) => setFormData({
                  ...formData,
                  apiSecret: e.target.value
                })}
                className="form-input"
              />
            </div>
          )}

          <button
            onClick={handleAddKey}
            disabled={loading}
            className="btn-add"
          >
            {loading ? '⏳ Se salvează...' : '➕ Adaugă API Key'}
          </button>
        </div>

        <div className="keys-list-section">
          <h2>API Keys Active</h2>

          {apiKeys.length === 0 ? (
            <p className="no-keys">
              Nu ai nicio API Key conectată. Adaugă una pentru a începe!
            </p>
          ) : (
            <div className="keys-grid">
              {apiKeys.map(key => {
                const provider = getProviderInfo(key.exchange);
                return (
                  <div key={key.id} className="key-card" style={{ borderLeft: `4px solid ${provider?.color}` }}>
                    <div className="key-header">
                      <div className="key-info">
                        <span className="exchange-icon">{provider?.icon}</span>
                        <div className="key-title">
                          <h3>{key.name}</h3>
                          <p className="exchange-label">{provider?.name}</p>
                        </div>
                      </div>
                      <span className={`status-badge ${key.status}`}>
                        {key.status === 'active' ? '🟢 Active' : '🔴 Inactive'}
                      </span>
                    </div>

                    <div className="key-details">
                      <p><strong>API Key:</strong> {key.apiKey}</p>
                      {key.apiSecret !== '***' && key.apiSecret && (
                        <p><strong>Secret:</strong> {key.apiSecret}</p>
                      )}
                      <p><strong>Added:</strong> {key.createdAt}</p>
                    </div>

                    <div className="key-actions">
                      <button
                        className="btn-test"
                        onClick={() => handleTestConnection(key.id)}
                        disabled={testResults[key.id]?.loading}
                      >
                        {testResults[key.id]?.loading ? '⏳ Testing...' : '✓ Test Connection'}
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => handleDeleteKey(key.id)}
                        disabled={loading}
                      >
                        🗑️ Delete
                      </button>
                    </div>

                    {testResults[key.id] && !testResults[key.id].loading && (
                      <div className={`test-result ${testResults[key.id].success ? 'success' : 'error'}`}>
                        {testResults[key.id].success ? '✅' : '❌'} {testResults[key.id].message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .apikeys-page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          margin-bottom: 30px;
          border-bottom: 2px solid #0088ff;
          padding-bottom: 15px;
        }

        .page-header h1 {
          margin: 0;
          color: #fff;
        }

        .page-header p {
          margin: 5px 0 0 0;
          color: #aaa;
          font-size: 14px;
        }

        .provider-selector {
          margin-bottom: 20px;
        }

        .provider-selector > label {
          display: block;
          margin-bottom: 12px;
          color: #aaa;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .category-tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }

        .category-tab {
          flex: 1;
          padding: 12px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 136, 255, 0.2);
          border-radius: 8px;
          color: #aaa;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          font-size: 13px;
        }

        .category-tab:hover {
          border-color: rgba(0, 136, 255, 0.4);
          background: rgba(0, 136, 255, 0.05);
        }

        .category-tab.active {
          background: linear-gradient(135deg, rgba(0, 136, 255, 0.2), rgba(0, 136, 255, 0.1));
          border-color: #0088ff;
          color: #0088ff;
          box-shadow: 0 0 15px rgba(0, 136, 255, 0.2);
        }

        .provider-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        .provider-card {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 136, 255, 0.15);
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.3s;
          position: relative;
        }

        .provider-card:hover {
          border-color: rgba(0, 136, 255, 0.3);
          background: rgba(0, 136, 255, 0.05);
          transform: translateY(-2px);
        }

        .provider-card.selected {
          background: rgba(0, 136, 255, 0.15);
          border-color: #0088ff;
          box-shadow: 0 0 20px rgba(0, 136, 255, 0.3), inset 0 0 20px rgba(0, 136, 255, 0.1);
        }

        .provider-card-header {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 8px;
        }

        .provider-icon {
          flex-shrink: 0;
        }

        .provider-card-info {
          min-width: 0;
          flex: 1;
        }

        .provider-card-info h4 {
          color: #fff;
          font-size: 12px;
          font-weight: 600;
        }

        .provider-card-info p {
          color: #888;
          font-size: 10px;
          white-space: normal;
          word-break: break-word;
        }

        .secret-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          font-size: 11px;
          background: rgba(255, 193, 7, 0.2);
          color: #ffc107;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .selected-provider-info {
          display: flex;
          align-items: center;
          background: rgba(0, 136, 255, 0.1);
          border: 1px solid rgba(0, 136, 255, 0.3);
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 15px;
        }

        .message {
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          font-weight: 600;
        }

        .message.success {
          background: #4ade80;
          color: #000;
        }

        .message.error {
          background: #f87171;
          color: #fff;
        }

        .apikeys-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
        }

        @media (max-width: 1024px) {
          .apikeys-content {
            grid-template-columns: 1fr;
          }
        }

        .add-key-section,
        .keys-list-section {
          background: rgba(255, 255, 255, 0.05);
          padding: 25px;
          border-radius: 12px;
          border: 1px solid rgba(0, 136, 255, 0.2);
        }

        h2 {
          margin-top: 0;
          margin-bottom: 20px;
          color: #fff;
          font-size: 18px;
        }

        .form-group {
          margin-bottom: 15px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          color: #aaa;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .form-input {
          width: 100%;
          padding: 12px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 136, 255, 0.3);
          border-radius: 8px;
          color: #fff;
          font-size: 14px;
        }

        .form-input:focus {
          outline: none;
          border-color: #0088ff;
          box-shadow: 0 0 10px rgba(0, 136, 255, 0.2);
        }

        .btn-add {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #0088ff, #0070d0);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          margin-top: 10px;
        }

        .btn-add:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(0, 136, 255, 0.4);
        }

        .btn-add:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .no-keys {
          text-align: center;
          color: #aaa;
          padding: 40px 20px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
        }

        .keys-grid {
          display: grid;
          gap: 15px;
        }

        .key-card {
          background: rgba(0, 0, 0, 0.2);
          padding: 20px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.3s;
        }

        .key-card:hover {
          background: rgba(0, 0, 0, 0.3);
          border-color: rgba(0, 136, 255, 0.3);
        }

        .key-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .key-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .exchange-icon {
          font-size: 24px;
        }

        .key-info h3 {
          margin: 0;
          color: #fff;
        }

        .status-badge {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
        }

        .status-badge.active {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
        }

        .status-badge.inactive {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
        }

        .key-details {
          margin-bottom: 15px;
          font-size: 13px;
        }

        .key-details p {
          margin: 8px 0;
          color: #ddd;
        }

        .key-details strong {
          color: #fff;
        }

        .key-actions {
          display: flex;
          gap: 10px;
        }

        .btn-test,
        .btn-delete {
          flex: 1;
          padding: 8px 12px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.3s;
        }

        .btn-test {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
          border: 1px solid #4ade80;
        }

        .btn-test:hover {
          background: #4ade80;
          color: #000;
        }

        .btn-delete {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid #f87171;
        }

        .btn-delete:hover:not(:disabled) {
          background: #f87171;
          color: #fff;
        }

        .btn-delete:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .test-result {
          margin-top: 10px;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }

        .test-result.success {
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
          border: 1px solid rgba(74, 222, 128, 0.3);
        }

        .test-result.error {
          background: rgba(248, 113, 113, 0.15);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.3);
        }
      `}</style>
    </div>
  );
};
