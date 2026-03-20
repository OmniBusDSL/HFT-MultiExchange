import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { TradePage } from './pages/TradePage';
import { BalancePage } from './pages/BalancePage';
import { MarketsPage } from './pages/MarketsPage';
import { OrderBookPage } from './pages/OrderBookPage';
import { OrderbookWsPage } from './pages/OrderbookWsPage';
import { OrderbookAggregatesPage } from './pages/OrderbookAggregatesPage';
import { OrderbookTestsPage } from './pages/OrderbookTestsPage';
import { OrderbookAggregatesPage as OrderbookWsV2Page } from './pages/oderbookwsv2';
import { OrderbookWsV3 } from './pages/OrderbookWsV3';
import { SentinelPage } from './pages/SentinelPage';
import OrderbookMonitorPage from './pages/OrderbookMonitorPage';
import ShieldDashboardPage from './pages/ShieldDashboardPage';
import ChartPage from './pages/ChartPage';
import OrderHistoryPage from './pages/OrderHistoryPage';
import { APIKeysPage } from './pages/APIKeysPage';
import { CoingeckoPage } from './pages/CoingeckoPage';
import { ProfilePage } from './pages/ProfilePage';
import { AppLayout } from './layouts/AppLayout';
import './App.css';

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      {/* Auth routes - no sidebar */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
      />

      {/* Protected routes - wrapped in AppLayout for sidebar */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/trade" element={<TradePage />} />
        <Route path="/balance" element={<BalancePage />} />
        <Route path="/markets" element={<MarketsPage />} />
        <Route path="/orderbook-tests" element={<OrderbookTestsPage />} />
        <Route path="/orderbook" element={<OrderBookPage />} />
        <Route path="/orderbook-ws" element={<OrderbookWsPage />} />
        <Route path="/orderbook-ws-v2" element={<OrderbookWsV2Page />} />
        <Route path="/orderbook-ws-v3" element={<OrderbookWsV3 />} />
        <Route path="/orderbook-ws-aggregate" element={<OrderbookAggregatesPage />} />
        <Route path="/orderbook-monitor" element={<OrderbookMonitorPage />} />
        <Route path="/sentinel" element={<SentinelPage />} />
        <Route path="/shield-dashboard" element={<ShieldDashboardPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/orderhistory" element={<OrderHistoryPage />} />
        <Route path="/apikeys" element={<APIKeysPage />} />
        <Route path="/coingecko" element={<CoingeckoPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
