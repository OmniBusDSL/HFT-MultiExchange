import type { Orderbook, OrderLevel } from './types.js';

const BASE_URL = 'https://exchange-api.lcx.com';

async function get<T>(path: string, attempt = 0): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (res.status === 429) {
    // Rate limit: backoff exponențial 5s → 10s → 20s → 40s → max 60s
    const delay = Math.min(5_000 * 2 ** attempt, 60_000);
    process.stderr.write(`[LCX API] 429 on ${path} — retry in ${delay / 1000}s\n`);
    await new Promise(r => setTimeout(r, delay));
    return get<T>(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`LCX API ${path} → ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

interface RawPair {
  Symbol: string;
  Mode: string;
}

export async function fetchPairs(): Promise<string[]> {
  const data = await get<{ data: RawPair[] }>('/api/pairs');
  return data.data
    .filter((p) => p.Mode === 'trade')
    .map((p) => p.Symbol);
}

export async function fetchOrderbookSnapshot(pair: string): Promise<Orderbook> {
  const encoded = encodeURIComponent(pair);
  const data = await get<{
    data: { buy: [number, number][]; sell: [number, number][] };
  }>(`/api/book?pair=${encoded}`);

  const toLevels = (arr: [number, number][]): OrderLevel[] =>
    arr.map(([price, qty]) => ({ price, qty }));

  return {
    buy: toLevels(data.data.buy ?? []).sort((a, b) => b.price - a.price),
    sell: toLevels(data.data.sell ?? []).sort((a, b) => a.price - b.price),
    updatedAt: new Date(),
    hasSnapshot: true,
  };
}
