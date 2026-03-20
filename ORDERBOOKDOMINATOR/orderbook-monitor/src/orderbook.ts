import type { Orderbook, OrderLevel } from './types.js';
import { updateAndStore } from './oracle.js';

const state = new Map<string, Orderbook>();

function emptyBook(): Orderbook {
  return { buy: [], sell: [], updatedAt: new Date(), hasSnapshot: false };
}

export function getOrderbook(pair: string): Orderbook {
  if (!state.has(pair)) state.set(pair, emptyBook());
  return state.get(pair)!;
}

export function getAllOrderbooks(): Map<string, Orderbook> {
  return state;
}

export function applySnapshot(pair: string, data: { buy: [number, number][]; sell: [number, number][] }): void {
  const toLevels = (arr: [number, number][]): OrderLevel[] =>
    arr.map(([price, qty]) => ({ price, qty }));

  const book: Orderbook = {
    buy: toLevels(data.buy ?? []).sort((a, b) => b.price - a.price),
    sell: toLevels(data.sell ?? []).sort((a, b) => a.price - b.price),
    updatedAt: new Date(),
    hasSnapshot: true,
  };
  state.set(pair, book);
  updateAndStore(pair, book.buy, book.sell);
}

export function applyDelta(pair: string, data: [number, number, string][]): void {
  const book = getOrderbook(pair);

  for (const [price, qty, side] of data) {
    const levels = side === 'buy' ? book.buy : book.sell;
    const idx = levels.findIndex((l) => l.price === price);

    if (qty === 0) {
      if (idx !== -1) levels.splice(idx, 1);
    } else if (idx !== -1) {
      levels[idx].qty = qty;
    } else {
      levels.push({ price, qty });
    }
  }

  book.buy.sort((a, b) => b.price - a.price);
  book.sell.sort((a, b) => a.price - b.price);
  book.updatedAt = new Date();
  updateAndStore(pair, book.buy, book.sell);
}

export function getBestBidAsk(pair: string): { bid: number | null; ask: number | null; spread: number | null } {
  const book = getOrderbook(pair);
  const bid = book.buy[0]?.price ?? null;
  const ask = book.sell[0]?.price ?? null;
  const spread = bid !== null && ask !== null ? ask - bid : null;
  return { bid, ask, spread };
}
