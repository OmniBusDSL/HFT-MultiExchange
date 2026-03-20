/**
 * External Oracle — CoinGecko price reference + LCX last price
 *
 * - CoinGecko /simple/price: un singur batch request pentru toate perechile, la fiecare 60s
 * - LCX /api/ticker: lastPrice per pereche, la fiecare 30s
 *
 * SYMBOL_TO_CG_ID generat automat din CoinGecko /coins/list (221 simboluri LCX, 218 mapate)
 */

const LCX_BASE   = 'https://exchange-api.lcx.com';
const CG_BASE    = 'https://api.coingecko.com/api/v3';
const CG_API_KEY = process.env.CG_API_KEY ?? '';

const CG_POLL_MS            = 60_000;
const LCX_TICKER_MS         = 60_000;   // refresh la 60s (era 30s — prea agresiv)
const LCX_TICKER_BATCH      = 10;       // 10 req simultan per batch
const LCX_TICKER_BATCH_MS   = 500;      // 500ms între batch-uri → max 20 req/s (sub limita de 25)

// AUTO-GENERATED from CoinGecko /coins/list + manual overrides pentru simboluri ambigue
const SYMBOL_TO_CG_ID: Record<string, string> = {
  '1INCH':    '1inch',
  'AAVE':     'aave',
  'ABT':      'arcblock',
  'ACH':      'alchemy-pay',
  'ACS':      'acryptos',
  'ACX':      'across-protocol',
  'ADA':      'cardano',
  'AERO':     'aerodrome-finance',
  'AEVO':     'aevo-exchange',
  'AGRI':     'agridex-governance-token',
  'AIOZ':     'aioz-network',
  'AIXBT':    'aixbt',
  'ALCH':     'alchemist-ai',
  'ALGO':     'algorand',
  'AMP':      'amp-token',
  'APE':      'apecoin',
  'APEX':     'apex-ai',
  'API3':     'api3',
  'APT':      'aptos',
  'ARB':      'arbitrum',
  'ARC':      'arc-block',
  'ARKM':     'arkham',
  'ASM':      'asmatch',
  'ATH':      'aethir',
  'ATTO':     'atto',
  'AUKI':     'auki-labs',
  'AURA':     'aura-2',
  'AVA':      'ava-ai',
  'AVAX':     'avalanche-2',
  'AWE':      'stp-network',
  'AXL':      'axelar',
  'B3':       'b3',
  'BAND':     'band-protocol',
  'BCH':      'bitcoin-cash',
  'BEAM':     'beam-2',
  'BERA':     'berachain-bera',
  'BIO':      'bio-protocol',
  'BLOCK':    'block',
  'BLUR':     'blur',
  'BOBA':     'bobacat',
  'BONK':     'bonk',
  'BRETT':    'based-brett',
  'BSV':      'bitcoin-sv',
  'BTC':      'bitcoin',
  'CCD':      'concordium',
  'CEL':      'celsius-degree-token',
  'CELO':     'celo',
  'CHEX':     'chex-token',
  'COMP':     'compound-governance-token',
  'COOKIE':   'cookie',
  'COW':      'cow',
  'CPOOL':    'clearpool',
  'DEAI':     'zero1-labs',
  'DEVVE':    'devve',
  'DOGE':     'dogecoin',
  'DOT':      'polkadot',
  'DOVU':     'dovu-2',
  'DRGN':     'dragonchain',
  'DRIFT':    'drift-protocol',
  'DRV':      'derive',
  'EIGEN':    'eigenlayer',
  'ENA':      'ethena',
  'ENS':      'ethereum-name-service',
  'EPIC':     'epic-cash',
  'ETH':      'ethereum',
  'ETHFI':    'ether-fi',
  'EUL':      'euler',
  'EURC':     'euro-coin',
  'EURQ':     'quantoz-eurq',
  'EURR':     'stablr-euro',
  'FET':      'fetch-ai',
  'FLOKI':    'floki',
  'FLUID':    'fluid-protocol',
  'FORTH':    'ampleforth-governance-token',
  'G':        'g-2',
  'GALA':     'gala',
  'GAME':     'gamebuild',
  'GLM':      'golem',
  'GLORIA':   'gloria-ai',
  'GOAT':     'goatseus-maximus',
  'GRASS':    'grass',
  'GRIFFAIN': 'griffain',
  'GRT':      'the-graph',
  'HASHAI':   'hashai',
  'HBAR':     'hedera-hashgraph',
  'HIVE':     'hive',
  'HOME':     'home',
  'HONEY':    'honey-3',
  'HYPER':    'hyper-4',
  'IAG':      'iagon',
  'ICP':      'internet-computer',
  'ID':       'everid',
  'IMX':      'immutable-x',
  'INXT':     'internxt',
  'IO':       'io-net',
  'JASMY':    'jasmycoin',
  'JTO':      'jito-governance-token',
  'JUP':      'jupiter-exchange-solana',
  'JYAI':     'jerry-the-turtle-by-matt-furie',
  'KAITO':    'kaito',
  'KAS':      'kaspa',
  'KMNO':     'kamino',
  'KTA':      'keeta',
  'L3':       'layer3',
  'LAYER':    'solayer',
  'LBAI':     'lemmy-the-bat',
  'LCX':      'lcx',
  'LDO':      'lido-dao',
  'LINK':     'chainlink',
  'LQTY':     'liquity',
  'LTC':      'litecoin',
  'LUMIA':    'lumia',
  'MATIC':    'matic-network',
  'MDEX':     'masterdex',
  'ME':       'magic-eden',
  'MIN':      'minswap',
  'MKR':      'maker',
  'MNT':      'mantle',
  'MOCA':     'moca-network',
  'MOG':      'mog-coin',
  'MON':      'monad',
  'MORPHO':   'morpho',
  'MPLX':     'metaplex',
  'MYRIA':    'myria',
  'NEAR':     'near',
  'NEWM':     'newm',
  'NIGHT':    'midnight',
  'NMKR':     'nmkr',
  'NPC':      'npc',
  'NVL':      'nuvola-digital',
  'ONDO':     'ondo-finance',
  'OP':       'optimism',
  'ORAI':     'oraichain-token',
  'ORCA':     'orca',
  'PBX':      'paribus',
  'PENDLE':   'pendle',
  'PENGU':    'penguiana',
  'PEPE':     'pepe',
  'PHA':      'pha',
  'PING':     'ping',
  'PLUME':    'plume',
  'POL':      'matic-network',
  'POLK':     'polkamarkets',
  'POPCAT':   'popcat',
  'POWR':     'power-ledger',
  'PRIME':    'echelon-prime',
  'PUMP':     'pump',
  'PYR':      'vulcan-forged',
  'PYTH':     'pyth-network',
  'QNT':      'quant-network',
  'REACT':    'reactive-network',
  'REAL':     'real-2',
  'REI':      'rei-network',
  'RENDER':   'render-token',
  'REP':      'augur',
  'RISE':     'everrise',
  'RPL':      'rocket-pool',
  'RSR':      'reserve-rights-token',
  'SAFE':     'safe',
  'SAITO':    'saito',
  'SAND':     'the-sandbox',
  'SANTA':    'santa-2',
  'SAROS':    'saros-finance',
  'SAUCE':    'saucerswap',
  'SEI':      'sei-network',
  'SERV':     'openserv',
  'SHIB':     'shiba-inu',
  'SHX':      'stronghold-token',
  'SKY':      'sky-governance',
  'SNEK':     'snek',
  'SOL':      'solana',
  'SPK':      'spark-2',
  'SPX':      'spx6900',
  'SQD':      'subsquid',
  'SRX':      'stars',
  'SSV':      'ssv-network',
  'SUI':      'sui',
  'SUPER':    'superfarm',
  'SWELL':    'swell-network',
  'SYRUP':    'syrup',
  'TARA':     'taraxa',
  'TOKEN':    'token',
  'TON':      'the-open-network',
  'TOTO':     'toto-3',
  'TRAC':     'origintrail',
  'TRUMP':    'official-trump',
  'TRWA':     'tharwa',
  'TRX':      'tron',
  'TURBO':    'turbo',
  'UNI':      'uniswap',
  'USDC':     'usd-coin',
  'USDQ':     'quill-usdq',
  'USDR':     'real-usd',
  'USDT':     'tether',
  'USUAL':    'usual',
  'VANRY':    'vanar-chain',
  'VIRTUAL':  'virtual-protocol',
  'VRA':      'verasity',
  'VVV':      'venice-token',
  'W':        'wormhole',
  'WIF':      'dogwifcoin',
  'WLD':      'worldcoin-wld',
  'WLFI':     'world-liberty-financial',
  'WMTX':     'walmart-xstock',
  'XAUT':     'tether-gold',
  'XCN':      'chain-2',
  'XDC':      'xdce-crowd-sale',
  'XPR':      'proton',
  'XRP':      'ripple',
  'XYO':      'xyo-network',
  'ZEN':      'zencash',
  'ZENT':     'zent',
  'ZIG':      'zignaly',
  'ZKP':      'zkpass',
  'ZORA':     'zora',
  'ZRC':      'zircuit',
  'ZRO':      'layerzero',
  // NOT FOUND pe CoinGecko: AVAAI, LIORS, TANG
};

// quote → CoinGecko vs_currency
const QUOTE_TO_VS: Record<string, string> = {
  'EUR':  'eur',
  'USDC': 'usd',
  'USDT': 'usd',
  'BTC':  'btc',
  'ETH':  'eth',
};

// ─── State ────────────────────────────────────────────────────────────────────

export interface ExternalPrice {
  externalMid:  number | null;
  ccxtSource:   string | null;
  lastPrice:    number | null;
  extBid:       number | null;  // Binance best bid
  extAsk:       number | null;  // Binance best ask
  extExchange:  string | null;  // "binance BTCUSDT" etc.
  updatedAt:    number;
}

const prices = new Map<string, ExternalPrice>();

function getOrCreate(pair: string): ExternalPrice {
  if (!prices.has(pair)) {
    prices.set(pair, {
      externalMid: null, ccxtSource: null, lastPrice: null,
      extBid: null, extAsk: null, extExchange: null, updatedAt: 0,
    });
  }
  return prices.get(pair)!;
}

export function getExternalPrice(pair: string): ExternalPrice | null {
  return prices.get(pair) ?? null;
}

export function getAllExternalPrices(): Map<string, ExternalPrice> {
  return prices;
}

export function getExternalOracleStatus(): { kraken: boolean; coinbase: boolean; pairs: number; ccxtPairs: number } {
  const withExt = [...prices.values()].filter(p => p.externalMid !== null).length;
  return { kraken: false, coinbase: false, pairs: prices.size, ccxtPairs: withExt };
}

// ─── CoinGecko Batch Fetch ────────────────────────────────────────────────────

async function fetchAllCoinGeckoPrices(lcxPairs: string[]): Promise<void> {
  const coinVsMap = new Map<string, Set<string>>();
  const pairMap   = new Map<string, string[]>();

  for (const pair of lcxPairs) {
    const [base, quote] = pair.split('/');
    if (!base || !quote) continue;
    const coinId = SYMBOL_TO_CG_ID[base.toUpperCase()];
    const vs     = QUOTE_TO_VS[quote.toUpperCase()];
    if (!coinId || !vs) continue;

    if (!coinVsMap.has(coinId)) coinVsMap.set(coinId, new Set());
    coinVsMap.get(coinId)!.add(vs);

    const key = `${coinId}/${vs}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key)!.push(pair);
  }

  if (coinVsMap.size === 0) return;

  const allVs = new Set<string>();
  for (const vsSet of coinVsMap.values()) vsSet.forEach(v => allVs.add(v));

  const ids = [...coinVsMap.keys()].join(',');
  const vs  = [...allVs].join(',');

  try {
    const headers: Record<string, string> = CG_API_KEY
      ? { 'x-cg-demo-api-key': CG_API_KEY }
      : {};

    const url = `${CG_BASE}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${vs}&include_last_updated_at=true`;
    const res  = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      process.stderr.write(`[CoinGecko] HTTP ${res.status}\n`);
      return;
    }

    const data = await res.json() as Record<string, Record<string, number>>;

    for (const [key, pairs] of pairMap) {
      const [coinId, vsKey] = key.split('/');
      const price = data[coinId]?.[vsKey];
      if (!price || price <= 0) continue;
      for (const pair of pairs) {
        const entry = getOrCreate(pair);
        entry.externalMid = price;
        entry.ccxtSource  = 'coingecko';
        entry.updatedAt   = Date.now();
      }
    }

    const covered = [...pairMap.values()].flat().length;
    process.stderr.write(`[CoinGecko] Updated ${covered} pairs\n`);
  } catch (err: any) {
    process.stderr.write(`[CoinGecko] Error: ${err.message}\n`);
  }
}

// ─── Binance Bid/Ask (batch, un singur request) ───────────────────────────────

const BINANCE_BASE    = 'https://api.binance.com';
const BINANCE_POLL_MS = 10_000;

// LCX quote → Binance quote suffix, în ordinea preferată
const BINANCE_QUOTE_MAP: Record<string, string[]> = {
  'EUR':  ['EUR', 'USDT', 'USDC'],
  'USDC': ['USDC', 'USDT', 'EUR'],
  'USDT': ['USDT', 'USDC', 'EUR'],
  'BTC':  ['BTC'],
  'ETH':  ['ETH'],
};

// Cache: Binance symbol → { bid, ask }
let binanceBookCache = new Map<string, { bid: number; ask: number }>();

// Cursuri de conversie față de EUR — actualizate live din EURUSDT Binance
let eurPerUsdt: number | null = null;  // null până la primul refresh
let eurPerUsdc: number | null = null;

async function refreshBinanceBook(): Promise<void> {
  try {
    const res  = await fetch(`${BINANCE_BASE}/api/v3/ticker/bookTicker`,
                             { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const data = await res.json() as { symbol: string; bidPrice: string; askPrice: string }[];
    const m    = new Map<string, { bid: number; ask: number }>();
    for (const t of data) {
      const bid = parseFloat(t.bidPrice);
      const ask = parseFloat(t.askPrice);
      if (bid > 0 && ask > 0) m.set(t.symbol, { bid, ask });
    }
    binanceBookCache = m;

    // Actualizăm cursurile EUR
    const eurUsdt = m.get('EURUSDT');
    if (eurUsdt) {
      const mid = (eurUsdt.bid + eurUsdt.ask) / 2;
      eurPerUsdt = 1 / mid;   // 1 USDT = eurPerUsdt EUR
      eurPerUsdc = 1 / mid;   // USDC ≈ USDT
    }

    process.stderr.write(`[Binance] Book refreshed — ${m.size} symbols | 1 USDT = ${eurPerUsdt != null ? eurPerUsdt.toFixed(4) : 'pending'} EUR\n`);
  } catch (err: any) {
    process.stderr.write(`[Binance] Error: ${err.message}\n`);
  }
}

function applyBinanceToPairs(lcxPairs: string[]): void {
  if (binanceBookCache.size === 0) return;

  for (const pair of lcxPairs) {
    const [base, lcxQuote] = pair.split('/');
    if (!base || !lcxQuote) continue;
    const quoteSuffixes = BINANCE_QUOTE_MAP[lcxQuote.toUpperCase()] ?? [lcxQuote.toUpperCase()];

    for (const q of quoteSuffixes) {
      const sym  = `${base.toUpperCase()}${q}`;
      const book = binanceBookCache.get(sym);
      if (!book) continue;

      // Conversie la quote-ul LCX dacă e nevoie
      let factor = 1;
      if (lcxQuote === 'EUR' && q === 'USDT') {
        if (eurPerUsdt === null) continue;  // rata nu e încă disponibilă
        factor = eurPerUsdt;
      }
      if (lcxQuote === 'EUR' && q === 'USDC') {
        if (eurPerUsdc === null) continue;  // rata nu e încă disponibilă
        factor = eurPerUsdc;
      }
      if (lcxQuote === 'USDC' && q === 'USDT') factor = 1;  // ~1:1
      if (lcxQuote === 'USDT' && q === 'USDC') factor = 1;

      const entry       = getOrCreate(pair);
      entry.extBid      = book.bid * factor;
      entry.extAsk      = book.ask * factor;
      entry.extExchange = q !== lcxQuote
        ? `binance ${sym} (conv→${lcxQuote})`
        : `binance ${sym}`;
      break;
    }
  }
}

// ─── LCX Last Price ───────────────────────────────────────────────────────────

async function fetchLcxTicker(pair: string, attempt = 0): Promise<number | null> {
  try {
    const res = await fetch(`${LCX_BASE}/api/ticker?pair=${encodeURIComponent(pair)}`,
                            { signal: AbortSignal.timeout(5_000) });
    if (res.status === 429) {
      if (attempt >= 3) return null;  // renunță după 3 încercări
      const delay = Math.min(5_000 * 2 ** attempt, 30_000);
      await new Promise(r => setTimeout(r, delay));
      return fetchLcxTicker(pair, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json() as any;
    const lp   = data?.data?.lastPrice ?? null;
    return (lp && lp > 0) ? lp : null;
  } catch { return null; }
}

async function refreshLastPrices(lcxPairs: string[]): Promise<void> {
  for (let i = 0; i < lcxPairs.length; i += LCX_TICKER_BATCH) {
    if (stopping) break;
    const batch = lcxPairs.slice(i, i + LCX_TICKER_BATCH);
    await Promise.all(batch.map(async (pair) => {
      const lp = await fetchLcxTicker(pair);
      if (lp !== null) {
        const entry = getOrCreate(pair);
        entry.lastPrice = lp;
      }
    }));
    // Delay între batch-uri: 10 req/500ms = 20 req/s (sub limita de 25 req/s)
    if (i + LCX_TICKER_BATCH < lcxPairs.length) {
      await new Promise(r => setTimeout(r, LCX_TICKER_BATCH_MS));
    }
  }
}

// ─── Poll Loop ────────────────────────────────────────────────────────────────

let allPairs:     string[] = [];
let cgTimer:      ReturnType<typeof setInterval> | null = null;
let tickTimer:    ReturnType<typeof setInterval> | null = null;
let binanceTimer: ReturnType<typeof setInterval> | null = null;
let stopping = false;

export function startExternalOracle(lcxPairs: string[]): void {
  allPairs = lcxPairs;
  for (const p of lcxPairs) getOrCreate(p);

  process.stderr.write(`[External Oracle] CoinGecko + Binance + LCX ticker for ${lcxPairs.length} pairs\n`);

  // CoinGecko: prima rulare după 3s, refresh la 60s
  setTimeout(async () => {
    await fetchAllCoinGeckoPrices(allPairs);
    if (!stopping) cgTimer = setInterval(() => fetchAllCoinGeckoPrices(allPairs), CG_POLL_MS);
  }, 3_000);

  // Binance bid/ask: prima rulare după 4s, refresh la 10s
  setTimeout(async () => {
    await refreshBinanceBook();
    applyBinanceToPairs(allPairs);
    if (!stopping) {
      binanceTimer = setInterval(async () => {
        await refreshBinanceBook();
        applyBinanceToPairs(allPairs);
      }, BINANCE_POLL_MS);
    }
  }, 4_000);

  // LCX last price: prima rulare după 6s, refresh la 30s
  setTimeout(async () => {
    await refreshLastPrices(allPairs);
    if (!stopping) tickTimer = setInterval(() => refreshLastPrices(allPairs), LCX_TICKER_MS);
  }, 6_000);
}

export function stopExternalOracle(): void {
  stopping = true;
  if (cgTimer)      { clearInterval(cgTimer);      cgTimer      = null; }
  if (binanceTimer) { clearInterval(binanceTimer); binanceTimer = null; }
  if (tickTimer)    { clearInterval(tickTimer);    tickTimer    = null; }
}
