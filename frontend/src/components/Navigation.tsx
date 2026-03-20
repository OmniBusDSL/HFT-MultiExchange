import { useLocation, useNavigate } from 'react-router-dom';
import '../styles/Navigation.css';

interface NavigationProps {
  currentPage: 'trade' | 'balance' | 'apikeys';
  onNavigate: (page: 'trade' | 'balance' | 'apikeys') => void;
}

export const Navigation = ({ currentPage, onNavigate }: NavigationProps) => {
  return (
    <nav className="navigation">
      <div className="nav-container">
        <div className="nav-brand">
          <h2>⚡ BTC Exchange</h2>
        </div>

        <ul className="nav-menu">
          <li>
            <button
              className={`nav-link ${currentPage === 'trade' ? 'active' : ''}`}
              onClick={() => onNavigate('trade')}
            >
              📊 Trade
            </button>
          </li>
          <li>
            <button
              className={`nav-link ${currentPage === 'balance' ? 'active' : ''}`}
              onClick={() => onNavigate('balance')}
            >
              💰 Balance
            </button>
          </li>
          <li>
            <button
              className={`nav-link ${currentPage === 'apikeys' ? 'active' : ''}`}
              onClick={() => onNavigate('apikeys')}
            >
              🔑 API Keys
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
};
