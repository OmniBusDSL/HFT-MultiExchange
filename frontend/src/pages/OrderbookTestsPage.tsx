import { useState } from 'react';
import { OrderBookPage } from './OrderBookPage';
import { OrderbookWsPage } from './OrderbookWsPage';
import { OrderbookAggregatesPage } from './OrderbookAggregatesPage';
import { OrderbookAggregatesPage as OrderbookAggregatesPagev1 } from './OrderbookAggregatesPagev1';
import OrderbookMonitorPage from './OrderbookMonitorPage';
import { OrderbookAggregatesPage as OrderbookWsV2Page } from './oderbookwsv2';

import '../styles/OrderbookTestsPage.css';

interface TabItem {
  id: string;
  label: string;
  icon: string;
  component: React.ReactNode;
  description: string;
}

export const OrderbookTestsPage = () => {
  const [activeTab, setActiveTab] = useState<string>('standard');

  const tabs: TabItem[] = [
    {
      id: 'standard',
      label: 'Order Book',
      icon: '📈',
      description: 'Standard REST API snapshot',
      component: <OrderBookPage />,
    },
    {
      id: 'websocket',
      label: 'Live Orderbook',
      icon: '⚡',
      description: 'Real-time WebSocket streaming',
      component: <OrderbookWsPage />,
    },
    {
      id: 'aggregate',
      label: 'Aggregate OB',
      icon: '⚔️',
      description: 'Multi-exchange comparison',
      component: <OrderbookAggregatesPage />,
    },
    {
      id: 'aggregate-v1',
      label: 'Aggregate v1',
      icon: '🔄',
      description: 'Previous version',
      component: <OrderbookAggregatesPagev1 />,
    },
    {
      id: 'monitor',
      label: 'OB Monitor',
      icon: '📡',
      description: 'Deep analysis & monitoring',
      component: <OrderbookMonitorPage />,
    },
    {
      id: 'ws-v2',
      label: 'WS v2',
      icon: '⚡🔄',
      description: 'WebSocket v2 variant',
      component: <OrderbookWsV2Page />,
    },
  ];

  return (
    <div className="orderbook-tests">
      {/* Tab Navigation */}
      <div className="tabs-header">
        <h1>🧪 Orderbook Test Suite</h1>
        <div className="tabs-nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={tab.description}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {tabs.find((t) => t.id === activeTab)?.component}
      </div>
    </div>
  );
};
