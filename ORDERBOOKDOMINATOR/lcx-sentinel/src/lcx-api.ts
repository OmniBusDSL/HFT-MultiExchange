import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

const BASE_URL = 'https://exchange-api.lcx.com';
const API_KEY = process.env.LCX_API_KEY || '';
const API_SECRET = process.env.LCX_API_SECRET || '';

export interface OpenOrder {
  Id: string;
  Pair: string;
  Side: 'BUY' | 'SELL';
  Price: number;
  Amount: number;
  Filled: number;
  Status: string;
}

function signRequest(method: string, endpoint: string, body: string = '{}'): any {
  const timestamp = Date.now().toString();
  const message = method.toUpperCase() + endpoint + body;
  
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(message)
    .digest('base64');

  return {
    'Content-Type': 'application/json',
    'x-access-key': API_KEY,
    'x-access-sign': signature,
    'x-access-timestamp': timestamp,
  };
}

export async function getOpenOrders(pair?: string): Promise<OpenOrder[]> {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Missing LCX_API_KEY or LCX_API_SECRET in .env');
  }

  // Official endpoint from openapi.json
  const endpoint = '/api/open';
  let url = `${BASE_URL}${endpoint}?offset=1`;
  if (pair) {
    url += `&pair=${encodeURIComponent(pair)}`;
  }

  const headers = signRequest('GET', endpoint);

  try {
    const res = await axios.get(url, { headers });
    // Based on openapi.json example: { data: [...], status: "success", totalCount: X }
    return res.data?.data || [];
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message;
    throw new Error(`LCX API Error: ${msg} (at ${endpoint})`);
  }
}

export async function fetchAllPairs(): Promise<string[]> {
  try {
    const res = await axios.get('https://exchange-api.lcx.com/api/pairs');
    return res.data?.data
      ?.filter((p: any) => p.Mode === 'trade')
      ?.map((p: any) => p.Symbol) || [];
  } catch (err: any) {
    console.error(`[LCX API] Failed to fetch pairs list: ${err.message}`);
    return [];
  }
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  const endpoint = `/api/cancel?orderId=${orderId}`;
  const headers = signRequest('DELETE', endpoint);
  try {
    const res = await axios.delete(`${BASE_URL}${endpoint}`, { headers });
    return res.data?.status === 'success';
  } catch (err: any) {
    console.error(`[LCX API] Cancel Failed: ${err.response?.data?.message || err.message}`);
    return false;
  }
}

export async function createOrder(pair: string, side: 'BUY' | 'SELL', price: number, amount: number): Promise<string | null> {
  const endpoint = '/api/create';
  const body = {
    Pair: pair,
    Amount: amount,
    Price: price,
    OrderType: 'LIMIT',
    Side: side
  };
  const bodyStr = JSON.stringify(body);
  const headers = signRequest('POST', endpoint, bodyStr);
  
  try {
    const res = await axios.post(`${BASE_URL}${endpoint}`, body, { headers });
    return res.data?.data?.Id || null;
  } catch (err: any) {
    console.error(`[LCX API] Create Failed: ${err.response?.data?.message || err.message}`);
    return null;
  }
}
