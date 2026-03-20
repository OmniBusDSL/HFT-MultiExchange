import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/ProfilePage.css';

interface UserProfile {
  id: number;
  email: string;
  referral_code: string;
  referred_by?: string;
  created_at: number;
  avatar?: string;
  username?: string;
}

interface ExchangeConnection {
  exchange: string;
  icon: string;
  status: 'connected' | 'disconnected';
  color: string;
  tradingVolume?: number;
  lastSync?: string;
}

interface ReferredUser {
  id: number;
  email: string;
  created_at: number;
}

interface ProfileStats {
  totalBalance: number;
  totalTrades: number;
  successRate: number;
  profitLoss: number;
}

export const ProfilePage = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats>({
    totalBalance: 12500.50,
    totalTrades: 247,
    successRate: 68.5,
    profitLoss: 2450.75
  });
  const [connections, setConnections] = useState<ExchangeConnection[]>([
    {
      exchange: 'LCX',
      icon: '🏪',
      status: 'disconnected',
      color: '#1E90FF',
      tradingVolume: 0,
      lastSync: undefined
    },
    {
      exchange: 'Coinbase',
      icon: '₿',
      status: 'disconnected',
      color: '#0052FF',
      tradingVolume: 0,
      lastSync: undefined
    },
    {
      exchange: 'Kraken',
      icon: '🐙',
      status: 'disconnected',
      color: '#522A86',
      tradingVolume: 0,
      lastSync: undefined
    },
    {
      exchange: 'CoinGecko',
      icon: '🦎',
      status: 'disconnected',
      color: '#65CD63',
      tradingVolume: 0,
      lastSync: undefined
    }
  ]);

  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  const [referralsLoading, setReferralsLoading] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load profile on mount
  useEffect(() => {
    if (user) {
      console.log('[ProfilePage] User data received:', user);
      console.log('[ProfilePage] Referral code from user:', user.referral_code);

      setProfile({
        id: user.id,
        email: user.email,
        referral_code: user.referral_code || '',
        referred_by: user.referred_by || '',
        created_at: user.created_at || Math.floor(Date.now() / 1000),
        username: user.email?.split('@')[0] || 'Trader'
      });

      // Check API key connections
      checkAPIConnections();
      fetchReferrals();
    }
  }, [user]);

  const checkAPIConnections = async () => {
    try {
      const response = await fetch('/api/apikeys');
      if (response.ok) {
        const data = await response.json();
        const apiKeys = data.keys || [];

        // Update connection status based on saved API keys
        setConnections(prev =>
          prev.map(conn => ({
            ...conn,
            status: apiKeys.some((k: any) => k.exchange === conn.exchange.toLowerCase()) ? 'connected' : 'disconnected',
            lastSync: new Date().toLocaleTimeString()
          }))
        );
      }
    } catch (error) {
      console.error('Error checking API connections:', error);
    }
  };

  const fetchReferrals = async () => {
    setReferralsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/profile/referrals', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferrals(data.referrals || []);
      }
    } catch (error) {
      console.error('[ProfilePage] Error fetching referrals:', error);
    } finally {
      setReferralsLoading(false);
    }
  };

  const handleProfileUpdate = async () => {
    if (!profile) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      console.log('[ProfilePage] Updating referral code:', profile.referral_code);
      console.log('[ProfilePage] Token exists:', !!token);

      // Update referral code via API
      const response = await fetch('/api/profile/referral-code', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          referral_code: profile.referral_code.toUpperCase()
        })
      });

      console.log('[ProfilePage] Update response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update profile');
      }

      const responseData = await response.json();
      console.log('[ProfilePage] Update successful:', responseData);

      // Sync new code into localStorage so it persists on refresh
      const savedUser = localStorage.getItem('user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        parsed.referral_code = responseData.referral_code;
        localStorage.setItem('user', JSON.stringify(parsed));
      }

      setMessage({ type: 'success', text: 'Referral code updated successfully!' });
      setEditMode(false);
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('[ProfilePage] Update error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      setMessage({ type: 'error', text: message });
    } finally {
      setLoading(false);
    }
  };

  if (!profile) {
    return (
      <div className="profile-loading">
        <div className="spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="profile-page">
      {message && (
        <div className={`message-banner ${message.type}`}>
          <p>{message.text}</p>
        </div>
      )}

      {/* Profile Header */}
      <div className="profile-header">
        <div className="profile-content">
          <div className="profile-avatar-section">
            <div className="profile-avatar">
              {profile.username?.charAt(0).toUpperCase()}
            </div>
            <div className="profile-meta">
              <h1>{profile.username}</h1>
              <p className="profile-email">{profile.email}</p>
              <p className="profile-member">
                Member since {new Date(profile.created_at * 1000).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            className={`btn-edit ${editMode ? 'cancel' : ''}`}
            onClick={() => {
              if (editMode) {
                setEditMode(false);
              } else {
                setEditMode(true);
              }
            }}
          >
            {editMode ? '✕ Cancel' : '✎ Edit Profile'}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Balance</div>
          <div className="stat-value">${stats.totalBalance.toFixed(2)}</div>
          <div className="stat-subtext">Across all exchanges</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Trades</div>
          <div className="stat-value">{stats.totalTrades}</div>
          <div className="stat-subtext">All time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Success Rate</div>
          <div className="stat-value">{stats.successRate}%</div>
          <div className="stat-subtext">Win ratio</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${stats.profitLoss >= 0 ? 'positive' : 'negative'}`}>
            ${stats.profitLoss >= 0 ? '+' : ''}{stats.profitLoss.toFixed(2)}
          </div>
          <div className="stat-label">Profit/Loss</div>
          <div className="stat-subtext">This month</div>
        </div>
      </div>

      {/* Exchange Connections */}
      <section className="exchange-connections">
        <div className="section-header">
          <h2>🔗 Exchange Connections</h2>
          <button className="btn-refresh" onClick={checkAPIConnections}>
            🔄 Refresh Status
          </button>
        </div>

        <div className="exchanges-grid">
          {connections.map(conn => (
            <div key={conn.exchange} className="exchange-card">
              <div className="exchange-header">
                <span className="exchange-icon">{conn.icon}</span>
                <h3>{conn.exchange}</h3>
              </div>

              <div className="exchange-status">
                <div className={`status-indicator ${conn.status}`}>
                  {conn.status === 'connected' ? '🟢' : '🔴'}
                  <span>{conn.status === 'connected' ? 'Connected' : 'Not Connected'}</span>
                </div>
              </div>

              {conn.lastSync && (
                <p className="exchange-sync">Last sync: {conn.lastSync}</p>
              )}

              <div className="exchange-actions">
                {conn.status === 'connected' ? (
                  <button className="btn-exchange btn-disconnect">
                    Disconnect
                  </button>
                ) : (
                  <button className="btn-exchange btn-connect">
                    Add API Key
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Referral Code Section */}
      <section className="referral-section">
        <div className="section-header">
          <h2>🎯 Your Referral Code</h2>
          <button
            className={`btn-edit ${editMode ? 'cancel' : ''}`}
            onClick={() => setEditMode(!editMode)}
          >
            {editMode ? '✕ Cancel' : '✎ Edit'}
          </button>
        </div>

        <div className="referral-card referred-by-card">
          <p className="referral-label">Referred by:</p>
          {profile.referred_by ? (
            <code className="referral-code">{profile.referred_by}</code>
          ) : (
            <span className="no-referral">— no referral —</span>
          )}
        </div>

        <div className="referral-card">
          {editMode ? (
            <div className="referral-edit">
              <div className="referral-edit-group">
                <label>Your Referral Code</label>
                <input
                  type="text"
                  value={profile.referral_code}
                  onChange={e => setProfile({ ...profile, referral_code: e.target.value.toUpperCase() })}
                  placeholder="Enter referral code"
                  className="referral-input"
                  maxLength={9}
                />
                <small>9 characters, uppercase letters and numbers</small>
              </div>
              <button
                className="btn-save"
                onClick={handleProfileUpdate}
                disabled={loading}
              >
                {loading ? '💾 Saving...' : '✓ Save'}
              </button>
            </div>
          ) : (
            <div className="referral-display">
              <div className="referral-info">
                <p className="referral-label">Share this code to earn rewards:</p>
                <code className="referral-code">{profile.referral_code || 'Loading...'}</code>
              </div>
              <button className="btn-copy" onClick={() => {
                navigator.clipboard.writeText(profile.referral_code);
                setMessage({ type: 'success', text: 'Referral code copied!' });
                setTimeout(() => setMessage(null), 2000);
              }}>
                📋 Copy Code
              </button>
            </div>
          )}
        </div>
      </section>

      {/* My Referrals Section */}
      <section className="referrals-section">
        <div className="section-header">
          <h2>👥 My Referrals</h2>
          <span className="referrals-count">{referrals.length} user{referrals.length !== 1 ? 's' : ''}</span>
        </div>

        {referralsLoading ? (
          <div className="referrals-loading">
            <div className="spinner"></div>
            <p>Loading referrals...</p>
          </div>
        ) : referrals.length === 0 ? (
          <div className="referrals-empty">
            <p>No referrals yet. Share your code <code>{profile.referral_code}</code> to invite others!</p>
          </div>
        ) : (
          <div className="referrals-list">
            {referrals.map(ref => (
              <div key={ref.id} className="referral-user-card">
                <div className="referral-user-avatar">
                  {ref.email.charAt(0).toUpperCase()}
                </div>
                <div className="referral-user-info">
                  <span className="referral-user-email">{ref.email}</span>
                  <span className="referral-user-date">
                    Joined {new Date(ref.created_at * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <style>{`
        .profile-page {
          padding: 30px;
          max-width: 1200px;
          margin: 0 auto;
          color: #fff;
        }

        .message-banner {
          padding: 15px 20px;
          border-radius: 8px;
          margin-bottom: 30px;
          font-weight: 600;
          animation: slideDown 0.3s ease;
        }

        .message-banner.success {
          background: #4ade80;
          color: #000;
        }

        .message-banner.error {
          background: #f87171;
          color: #fff;
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

        .profile-header {
          background: linear-gradient(135deg, rgba(0, 136, 255, 0.1), rgba(118, 75, 162, 0.1));
          border: 1px solid rgba(0, 136, 255, 0.2);
          border-radius: 12px;
          padding: 40px;
          margin-bottom: 40px;
          backdrop-filter: blur(10px);
        }

        .profile-content {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 30px;
        }

        .profile-avatar-section {
          display: flex;
          gap: 25px;
          align-items: flex-start;
        }

        .profile-avatar {
          width: 100px;
          height: 100px;
          background: linear-gradient(135deg, #0088ff, #764ba2);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          font-weight: 700;
          box-shadow: 0 4px 15px rgba(0, 136, 255, 0.3);
        }

        .profile-meta h1 {
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          color: #fff;
        }

        .profile-email {
          margin: 5px 0;
          color: #aaa;
          font-size: 16px;
        }

        .profile-member {
          margin: 5px 0;
          color: #0088ff;
          font-size: 14px;
        }

        .btn-edit {
          padding: 12px 24px;
          background: linear-gradient(135deg, #0088ff, #0070d0);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          white-space: nowrap;
        }

        .btn-edit:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(0, 136, 255, 0.4);
        }

        .btn-edit.cancel {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid #f87171;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }

        .stat-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(0, 136, 255, 0.2);
          border-radius: 12px;
          padding: 25px;
          text-align: center;
          transition: all 0.3s;
        }

        .stat-card:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(0, 136, 255, 0.4);
          transform: translateY(-2px);
        }

        .stat-label {
          font-size: 14px;
          color: #aaa;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
        }

        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 5px;
        }

        .stat-value.positive {
          color: #4ade80;
        }

        .stat-value.negative {
          color: #f87171;
        }

        .stat-subtext {
          font-size: 12px;
          color: #888;
        }

        .exchange-connections {
          margin-bottom: 40px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 25px;
          padding-bottom: 15px;
          border-bottom: 2px solid rgba(0, 136, 255, 0.2);
        }

        .section-header h2 {
          margin: 0;
          font-size: 24px;
          color: #fff;
        }

        .btn-refresh {
          padding: 10px 20px;
          background: rgba(0, 136, 255, 0.2);
          border: 1px solid #0088ff;
          color: #0088ff;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s;
        }

        .btn-refresh:hover {
          background: rgba(0, 136, 255, 0.3);
        }

        .exchanges-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
        }

        .exchange-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(0, 136, 255, 0.15);
          border-radius: 12px;
          padding: 25px;
          transition: all 0.3s;
        }

        .exchange-card:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(0, 136, 255, 0.3);
          transform: translateY(-4px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        .exchange-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 15px;
        }

        .exchange-icon {
          font-size: 32px;
        }

        .exchange-header h3 {
          margin: 0;
          color: #fff;
          font-size: 18px;
        }

        .exchange-status {
          margin-bottom: 15px;
        }

        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
        }

        .status-indicator.connected {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
        }

        .status-indicator.disconnected {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
        }

        .exchange-sync {
          font-size: 12px;
          color: #888;
          margin: 10px 0;
        }

        .exchange-actions {
          display: flex;
          gap: 10px;
        }

        .btn-exchange {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          font-size: 13px;
        }

        .btn-connect {
          background: linear-gradient(135deg, #4ade80, #22c55e);
          color: #000;
        }

        .btn-connect:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(74, 222, 128, 0.4);
        }

        .btn-disconnect {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid #f87171;
        }

        .btn-disconnect:hover {
          background: rgba(248, 113, 113, 0.3);
        }

        .referral-section {
          margin-bottom: 30px;
        }

        .referral-card {
          background: linear-gradient(135deg, rgba(74, 222, 128, 0.1), rgba(0, 136, 255, 0.1));
          border: 1px solid rgba(74, 222, 128, 0.3);
          border-radius: 12px;
          padding: 30px;
          margin-bottom: 16px;
        }

        .referred-by-card {
          background: linear-gradient(135deg, rgba(0, 136, 255, 0.08), rgba(118, 75, 162, 0.08));
          border: 1px solid rgba(0, 136, 255, 0.25);
        }

        .no-referral {
          display: block;
          color: #555;
          font-style: italic;
          font-size: 15px;
          padding: 10px 0;
        }

        .referral-display,
        .referral-edit {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .referral-edit {
          flex-direction: column;
          align-items: stretch;
        }

        .referral-edit-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .referral-edit-group label {
          color: #aaa;
          font-size: 14px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .referral-edit-group small {
          color: #888;
          font-size: 12px;
        }

        .referral-input {
          padding: 15px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(74, 222, 128, 0.3);
          border-radius: 8px;
          color: #4ade80;
          font-family: 'Courier New', monospace;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 2px;
          text-align: center;
          text-transform: uppercase;
        }

        .referral-input:focus {
          outline: none;
          border-color: #4ade80;
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.3);
        }

        .referral-info {
          flex: 1;
        }

        .referral-label {
          margin: 0 0 12px 0;
          color: #aaa;
          font-size: 14px;
        }

        .referral-code {
          display: block;
          background: rgba(0, 0, 0, 0.3);
          padding: 15px;
          border-radius: 8px;
          color: #4ade80;
          font-family: 'Courier New', monospace;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 2px;
          word-break: break-all;
          border: 1px solid rgba(74, 222, 128, 0.3);
          text-align: center;
        }

        .btn-copy,
        .btn-save {
          padding: 12px 20px;
          background: rgba(0, 136, 255, 0.2);
          border: 1px solid #0088ff;
          color: #0088ff;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s;
          white-space: nowrap;
        }

        .btn-copy:hover,
        .btn-save:hover {
          background: rgba(0, 136, 255, 0.3);
          transform: translateY(-2px);
        }

        .btn-save {
          background: linear-gradient(135deg, #4ade80, #22c55e);
          border: none;
          color: #000;
        }

        .btn-save:hover {
          box-shadow: 0 4px 12px rgba(74, 222, 128, 0.4);
        }

        .btn-save:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .profile-loading {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          min-height: 400px;
          color: #aaa;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(0, 136, 255, 0.2);
          border-top-color: #0088ff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 15px;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 768px) {
          .profile-page {
            padding: 20px;
          }

          .profile-header {
            padding: 25px;
          }

          .profile-content {
            flex-direction: column;
            gap: 20px;
          }

          .profile-avatar-section {
            flex-direction: column;
          }

          .stats-grid {
            grid-template-columns: 1fr 1fr;
          }

          .exchanges-grid {
            grid-template-columns: 1fr;
          }

          .referral-display {
            flex-direction: column;
          }

          .referral-code {
            font-size: 16px;
          }

          .referral-edit {
            gap: 15px;
          }

          .referral-edit-group {
            width: 100%;
          }

          .referral-input {
            font-size: 14px;
          }

          .btn-edit {
            padding: 10px 16px;
            font-size: 14px;
          }
        }

        .referrals-section {
          margin-bottom: 40px;
        }

        .referrals-count {
          background: rgba(0, 136, 255, 0.2);
          border: 1px solid rgba(0, 136, 255, 0.4);
          color: #0088ff;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
        }

        .referrals-loading {
          display: flex;
          align-items: center;
          gap: 15px;
          color: #aaa;
          padding: 20px;
        }

        .referrals-loading .spinner {
          width: 24px;
          height: 24px;
          border-width: 3px;
          margin-bottom: 0;
        }

        .referrals-empty {
          background: rgba(255, 255, 255, 0.03);
          border: 1px dashed rgba(0, 136, 255, 0.2);
          border-radius: 12px;
          padding: 30px;
          text-align: center;
          color: #666;
        }

        .referrals-empty code {
          color: #4ade80;
          font-family: 'Courier New', monospace;
          font-weight: 700;
          letter-spacing: 1px;
        }

        .referrals-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .referral-user-card {
          display: flex;
          align-items: center;
          gap: 16px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(0, 136, 255, 0.15);
          border-radius: 10px;
          padding: 16px 20px;
          transition: all 0.2s;
        }

        .referral-user-card:hover {
          background: rgba(255, 255, 255, 0.07);
          border-color: rgba(0, 136, 255, 0.3);
        }

        .referral-user-avatar {
          width: 42px;
          height: 42px;
          background: linear-gradient(135deg, #0088ff, #764ba2);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }

        .referral-user-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .referral-user-email {
          color: #fff;
          font-size: 15px;
          font-weight: 500;
        }

        .referral-user-date {
          color: #888;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};
