import axios from 'axios';

// Sentinel API configuration
const SENTINEL_API_BASE = 'http://localhost:3001'; // order-shield server
const LCX_API_BASE = 'http://127.0.0.1:8000'; // Local Zig backend with LCX integration

export interface MonitoredOrder {
  order_id: string;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  filled: number;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  is_protected: boolean;
  is_attacked: boolean;
  last_sync: number;
}

export interface FrontrunLog {
  id: number;
  order_id: string;
  pair: string;
  my_price: number;
  competitor_price: number;
  competitor_qty: number;
  oracle_price: number;
  is_fallback: boolean;
  timestamp: number;
}

export interface SentinelStats {
  total_orders: number;
  active_orders: number;
  protected_orders: number;
  attacked_orders: number;
  uptime_seconds: number;
}

// ─── Fetch Orders from Different Sources ───────────────────────────────────

export async function fetchOrdersFromSentinel(
  source: 'sentinel' | 'shield' | 'lcx',
  exchange: 'lcx' | 'kraken' | 'coinbase'
): Promise<MonitoredOrder[]> {
  try {
    let endpoint = '';
    let baseUrl = '';

    switch (source) {
      case 'sentinel':
        baseUrl = SENTINEL_API_BASE;
        endpoint = '/api/orders'; // LCX-SENTINEL orders endpoint
        break;

      case 'shield':
        baseUrl = SENTINEL_API_BASE;
        endpoint = '/api/queue'; // ORDER-SHIELD queue endpoint
        break;

      case 'lcx':
        // Call local Zig backend with LCX API integration
        baseUrl = LCX_API_BASE;
        endpoint = `/api/public/openorders?exchange=${exchange}`;
        break;

      default:
        throw new Error(`Unknown source: ${source}`);
    }

    const response = await axios.get(`${baseUrl}${endpoint}`, {
      timeout: 10000,
    });

    // Transform API response to MonitoredOrder format
    const orders = response.data?.data || response.data || [];

    return orders.map((order: any) => ({
      order_id: order.Id || order.id || order.order_id || 'unknown',
      pair: order.Pair || order.pair || 'N/A',
      side: (order.Side || order.side || 'buy').toLowerCase(),
      price: parseFloat(order.Price || order.price || 0),
      amount: parseFloat(order.Amount || order.amount || 0),
      filled: parseFloat(order.Filled || order.filled || 0),
      status: (order.Status || order.status || 'OPEN').toUpperCase(),
      is_protected: order.is_protected !== false,
      is_attacked: order.is_attacked === true,
      last_sync: order.last_sync || Date.now(),
    }));
  } catch (error: any) {
    console.error(`Failed to fetch orders from ${source}:`, error.message);
    throw new Error(`Failed to fetch orders from ${source}: ${error.message}`);
  }
}

// ─── Fetch Frontrun Logs ────────────────────────────────────────────────────

export async function fetchFrontrunLogs(limit: number = 50): Promise<FrontrunLog[]> {
  try {
    const response = await axios.get(`${SENTINEL_API_BASE}/api/frontrun-logs?limit=${limit}`, {
      timeout: 10000,
    });

    return response.data?.data || response.data || [];
  } catch (error: any) {
    console.error('Failed to fetch frontrun logs:', error.message);
    return [];
  }
}

// ─── Fetch Sentinel Stats ───────────────────────────────────────────────────

export async function fetchSentinelStats(): Promise<SentinelStats> {
  try {
    const response = await axios.get(`${SENTINEL_API_BASE}/api/stats`, {
      timeout: 10000,
    });

    const data = response.data?.data || response.data;
    return {
      total_orders: data?.total_orders || 0,
      active_orders: data?.active_orders || 0,
      protected_orders: data?.protected_orders || 0,
      attacked_orders: data?.attacked_orders || 0,
      uptime_seconds: data?.uptime_seconds || 0,
    };
  } catch (error: any) {
    console.error('Failed to fetch sentinel stats:', error.message);
    return {
      total_orders: 0,
      active_orders: 0,
      protected_orders: 0,
      attacked_orders: 0,
      uptime_seconds: 0,
    };
  }
}

// ─── Check Service Health ───────────────────────────────────────────────────

export async function checkServiceHealth(
  service: 'sentinel' | 'shield' | 'lcx'
): Promise<boolean> {
  try {
    const baseUrl =
      service === 'lcx' ? LCX_API_BASE : SENTINEL_API_BASE;

    const response = await axios.get(`${baseUrl}/health`, {
      timeout: 5000,
    });

    return response.status === 200;
  } catch {
    return false;
  }
}

// ─── Get Available Pairs ─────────────────────────────────────────────────────

export async function fetchAvailableExchanges(): Promise<
  Array<{ id: string; label: string; available: boolean }>
> {
  const exchanges: Array<{
    id: 'lcx' | 'kraken' | 'coinbase';
    label: string;
    available: boolean;
  }> = [
    { id: 'lcx', label: 'LCX', available: true },
    { id: 'kraken', label: 'Kraken', available: true },
    { id: 'coinbase', label: 'Coinbase', available: true },
  ];

  return exchanges;
}

export async function fetchAvailableSources(): Promise<
  Array<{ id: string; label: string; available: boolean }>
> {
  const sources = [
    {
      id: 'sentinel',
      label: 'LCX-Sentinel',
      available: await checkServiceHealth('sentinel'),
    },
    {
      id: 'shield',
      label: 'Order-Shield',
      available: await checkServiceHealth('shield'),
    },
    {
      id: 'lcx',
      label: 'LCX Direct',
      available: await checkServiceHealth('lcx'),
    },
  ];

  return sources;
}
