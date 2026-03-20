/**
 * Hybrid Oracle — Tier 1 (LCX LOB only)
 *
 * Pipeline per pair:
 *   LOB snapshot → VAMP_5 + Microprice → combined base → Kalman filter → EMA(30s) → Oracle Price
 *
 * Algorithms:
 *  - VAMP_5:     Volume-Adjusted Mid Price across top 5 LOB levels
 *  - Microprice: Stoikov (2017) imbalance-corrected martingale price
 *  - Kalman:     Optimal linear filter separating signal from microstructure noise
 *  - EMA:        Exponential smoothing with 30s half-life for manipulation resistance
 */

import type { OrderLevel } from './types.js';
import { getExternalPrice } from './external-oracle.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const LOB_LEVELS = 5;
const MICROPRICE_G = 0.5;           // Stoikov G — calibrate from history; 0.5 is a safe prior
const EMA_HALF_LIFE_MS = 30_000;    // 30s half-life
const VOLATILITY_WINDOW = 30;       // samples for rolling volatility estimate (Kalman Q)

// ─── Types ───────────────────────────────────────────────────────────────────

interface KalmanState {
  price: number;   // estimated true price
  variance: number; // estimation variance P
}

interface OracleState {
  kalman: KalmanState;
  ema: number;
  lastUpdateMs: number;
  priceHistory: number[];  // recent microprice samples for volatility estimation
  ready: boolean;
}

export interface OracleResult {
  oraclePrice: number;
  microprice: number;
  vamp: number;
  imbalance: number;        // I ∈ [0,1] — >0.5 = buy pressure
  spread: number;
  deviation: number | null; // % deviation of LCX mid from oracle (null if no mid yet)
  externalMid: number | null; // Tier 2 consensus (Kraken + Coinbase)
  tier2Deviation: number | null; // % LCX mid vs external reference
}

// ─── State ────────────────────────────────────────────────────────────────────

const states = new Map<string, OracleState>();

function getState(pair: string): OracleState {
  if (!states.has(pair)) {
    states.set(pair, {
      kalman: { price: 0, variance: 1 },
      ema: 0,
      lastUpdateMs: 0,
      priceHistory: [],
      ready: false,
    });
  }
  return states.get(pair)!;
}

// ─── VAMP_N ──────────────────────────────────────────────────────────────────

/**
 * Volume-Adjusted Mid Price across N LOB levels.
 * VAMP = Σ(P_bid_i × V_ask_i) + Σ(P_ask_i × V_bid_i) / Σ(V_bid_i + V_ask_i)
 * Prices are weighted by opposing-side volume — captures true liquidity gravity.
 */
function computeVAMP(bids: OrderLevel[], asks: OrderLevel[], n: number): number {
  const bidSlice = bids.slice(0, n);
  const askSlice = asks.slice(0, n);
  if (bidSlice.length === 0 || askSlice.length === 0) return 0;

  let numerator = 0;
  let denominator = 0;

  const totalBidVol = bidSlice.reduce((s, l) => s + l.qty, 0);
  const totalAskVol = askSlice.reduce((s, l) => s + l.qty, 0);

  for (const bid of bidSlice) {
    numerator += bid.price * totalAskVol;
  }
  for (const ask of askSlice) {
    numerator += ask.price * totalBidVol;
  }

  denominator = (totalBidVol + totalAskVol) * Math.max(bidSlice.length, askSlice.length);
  return denominator > 0 ? numerator / denominator : 0;
}

// ─── Microprice ───────────────────────────────────────────────────────────────

/**
 * Stoikov (2017) Microprice — martingale-consistent LOB imbalance correction.
 * μ = mid + (spread/2) × (2I − 1) × G
 * I = V_bid / (V_bid + V_ask) at best levels
 * G = calibrated scalar (0.5 default)
 */
function computeMicroprice(
  bids: OrderLevel[],
  asks: OrderLevel[],
): { microprice: number; imbalance: number; spread: number } {
  const bestBid = bids[0];
  const bestAsk = asks[0];
  if (!bestBid || !bestAsk) return { microprice: 0, imbalance: 0.5, spread: 0 };

  const mid = (bestBid.price + bestAsk.price) / 2;
  const spread = bestAsk.price - bestBid.price;
  const totalVol = bestBid.qty + bestAsk.qty;
  const I = totalVol > 0 ? bestBid.qty / totalVol : 0.5;
  const microprice = mid + (spread / 2) * (2 * I - 1) * MICROPRICE_G;

  return { microprice, imbalance: I, spread };
}

// ─── Kalman Filter ────────────────────────────────────────────────────────────

/**
 * Scalar Kalman filter.
 * Process model: price_t = price_{t-1} + w_t   (random walk)
 * Observation:   y_t = price_t + v_t
 *
 * Q = process noise variance (estimated from recent volatility)
 * R = observation noise variance ≈ (spread/2)² / 3  (Roll model)
 */
function kalmanUpdate(state: KalmanState, observed: number, Q: number, R: number): KalmanState {
  // Prediction
  const pPred = state.variance + Q;

  // Update
  const K = pPred / (pPred + R);
  const price = state.price + K * (observed - state.price);
  const variance = (1 - K) * pPred;

  return { price, variance };
}

// ─── EMA ─────────────────────────────────────────────────────────────────────

/**
 * Continuous-time EMA: alpha = 1 - e^(-dt / half_life)
 * When dt is large (stale data), alpha → 1 (trust new observation fully).
 */
function emaUpdate(prev: number, next: number, dtMs: number): number {
  const alpha = 1 - Math.exp(-dtMs / EMA_HALF_LIFE_MS);
  return alpha * next + (1 - alpha) * prev;
}

// ─── Rolling volatility ───────────────────────────────────────────────────────

function updateVolatility(history: number[], newPrice: number): number {
  history.push(newPrice);
  if (history.length > VOLATILITY_WINDOW) history.shift();
  if (history.length < 2) return 1e-8;

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((s, p) => s + (p - mean) ** 2, 0) / (history.length - 1);
  return Math.max(variance, 1e-10);
}

// ─── Main update function ─────────────────────────────────────────────────────

export function updateOracle(
  pair: string,
  bids: OrderLevel[],
  asks: OrderLevel[],
): OracleResult | null {
  if (bids.length === 0 || asks.length === 0) return null;

  const state = getState(pair);
  const now = Date.now();
  const dtMs = state.lastUpdateMs > 0 ? now - state.lastUpdateMs : 1000;

  // Step 1: VAMP_5 + Microprice
  const vamp = computeVAMP(bids, asks, LOB_LEVELS);
  const { microprice, imbalance, spread } = computeMicroprice(bids, asks);
  if (microprice === 0 || vamp === 0) return null;

  // Step 2: Combine VAMP and Microprice (Tier 1 base)
  const tier1Base = (microprice + vamp) / 2;

  // Step 2b: Blend with Tier 2 external reference if available
  const ext = getExternalPrice(pair);
  const externalMid = ext?.externalMid ?? null;
  // If Tier 2 is available, weight: 50% Tier1 + 50% Tier2
  const basePriceObservation = externalMid !== null
    ? (tier1Base + externalMid) / 2
    : tier1Base;

  // Step 3: Kalman filter
  const Q = updateVolatility(state.priceHistory, microprice);
  const R = Math.max((spread / 2) ** 2 / 3, 1e-12);

  if (!state.ready) {
    // Bootstrap with first observation
    state.kalman = { price: basePriceObservation, variance: R * 10 };
    state.ema = basePriceObservation;
    state.ready = true;
  } else {
    state.kalman = kalmanUpdate(state.kalman, basePriceObservation, Q, R);
  }

  // Step 4: EMA smoothing
  state.ema = emaUpdate(state.ema, state.kalman.price, dtMs);
  state.lastUpdateMs = now;

  // Step 5: Deviation from LCX mid vs oracle (Tier 1+2 blended)
  const lcxMid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : null;
  const deviation = lcxMid !== null && state.ema > 0
    ? ((lcxMid - state.ema) / state.ema) * 100
    : null;

  // Step 6: Deviation from LCX mid vs pure Tier 2 external reference
  const tier2Deviation = lcxMid !== null && externalMid !== null && externalMid > 0
    ? ((lcxMid - externalMid) / externalMid) * 100
    : null;

  return {
    oraclePrice: state.ema,
    microprice,
    vamp,
    imbalance,
    spread,
    deviation,
    externalMid,
    tier2Deviation,
  };
}

export function getOracleResult(pair: string): OracleResult | null {
  const state = states.get(pair);
  if (!state?.ready) return null;

  // Return last computed result by re-running with no update
  // (state is read-only here — used only for display)
  return null; // display fetches from updateOracle on each LOB change
}

// Store last result per pair for display
const lastResults = new Map<string, OracleResult>();

export function updateAndStore(pair: string, bids: OrderLevel[], asks: OrderLevel[]): void {
  const result = updateOracle(pair, bids, asks);
  if (result) lastResults.set(pair, result);
}

export function getLastOracleResult(pair: string): OracleResult | null {
  return lastResults.get(pair) ?? null;
}

export function getAllOracleResults(): Map<string, OracleResult> {
  return lastResults;
}
