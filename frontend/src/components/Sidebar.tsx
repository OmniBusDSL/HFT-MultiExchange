import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Sidebar.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Overview', icon: '◈' },
  { path: '/trade', label: 'Trade', icon: '⇄' },
  { path: '/balance', label: 'Portfolio', icon: '◎' },
  { path: '/markets', label: 'Markets', icon: '📊' },
  { path: '/orderbook-tests', label: 'Orderbook Tests', icon: '🧪' },
  { path: '/orderbook', label: 'Order Book', icon: '📈' },
  { path: '/orderbook-ws', label: 'Live Orderbook', icon: '⚡' },
  { path: '/orderbook-ws-v2', label: 'Orderbook WS v2', icon: '⚡🔄' },
  { path: '/orderbook-ws-v3', label: 'LCX Pairs Manager', icon: '🔷' },
  { path: '/orderbook-ws-aggregate', label: 'Aggregate OB', icon: '⚔️' },
  { path: '/orderbook-monitor', label: 'OB Monitor', icon: '📡' },
  { path: '/sentinel', label: 'Sentinel', icon: '🛡️' },
  { path: '/shield-dashboard', label: 'Shield Dashboard', icon: '🛡️📊' },
  { path: '/chart', label: 'Charts', icon: '📉' },
  { path: '/orderhistory', label: 'Order History', icon: '📋' },
  { path: '/coingecko', label: 'CoinGecko Data', icon: '🦎' },
  { path: '/apikeys', label: 'API Keys', icon: '⌗' },
  { path: '/profile', label: 'Profile', icon: '◉' },
];

export const Sidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userInitial = user?.email?.charAt(0).toUpperCase() || 'U';
  const userName = user?.email?.split('@')[0] || 'User';

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar__brand">
        <span className="sidebar__brand-icon">⚡</span>
        <span className="sidebar__brand-name">HFT Exchange</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        <ul className="sidebar__nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.path} className="sidebar__nav-item">
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `sidebar__nav-link ${isActive ? 'active' : ''}`
                }
              >
                <span className="sidebar__nav-icon">{item.icon}</span>
                <span className="sidebar__nav-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* User section */}
      <div className="sidebar__user">
        <div className="sidebar__user-avatar">{userInitial}</div>
        <div className="sidebar__user-info">
          <span className="sidebar__user-name">{userName}</span>
          <span className="sidebar__user-email">{user?.email}</span>
        </div>
        <button
          className="sidebar__logout-btn"
          onClick={handleLogout}
          title="Logout"
        >
          ⏻
        </button>
      </div>
    </aside>
  );
};
