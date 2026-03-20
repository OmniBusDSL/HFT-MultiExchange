import React from 'react';

export interface BalanceData {
  user_id: number;
  asset: string;
  available: number;
  locked: number;
  total: number;
}

interface BalanceProps {
  balance: BalanceData | null;
  loading: boolean;
  error: string | null;
}

export const Balance: React.FC<BalanceProps> = ({ balance, loading, error }) => {
  if (loading) {
    return <div className="balance">Loading balance...</div>;
  }

  if (error) {
    return <div className="balance error">Error: {error}</div>;
  }

  if (!balance) {
    return <div className="balance">No balance data</div>;
  }

  const availablePercent = (balance.available / balance.total) * 100;
  const lockedPercent = (balance.locked / balance.total) * 100;

  return (
    <div className="balance">
      <h2>Account Balance</h2>
      <div className="balance-card">
        <div className="asset">{balance.asset}</div>
        <div className="total">
          <span className="label">Total:</span>
          <span className="amount">{(balance.total / 100000000).toFixed(8)} BTC</span>
          <span className="sats">{balance.total.toLocaleString()} sats</span>
        </div>

        <div className="breakdown">
          <div className="breakdown-item available">
            <span className="label">Available:</span>
            <span className="amount">{(balance.available / 100000000).toFixed(8)} BTC</span>
            <span className="percent">{availablePercent.toFixed(1)}%</span>
          </div>

          <div className="breakdown-item locked">
            <span className="label">Locked (Orders):</span>
            <span className="amount">{(balance.locked / 100000000).toFixed(8)} BTC</span>
            <span className="percent">{lockedPercent.toFixed(1)}%</span>
          </div>
        </div>

        <div className="progress-bar">
          <div
            className="progress-available"
            style={{ width: `${availablePercent}%` }}
          />
          <div
            className="progress-locked"
            style={{ width: `${lockedPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
