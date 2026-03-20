import chalk from 'chalk';
import { getAllOrderbooks, getBestBidAsk } from './orderbook.js';
import { getWsStatus } from './websocket.js';
import { getLastOracleResult } from './oracle.js';
import { getExternalOracleStatus } from './external-oracle.js';

const REFRESH_MS = 1_000;
const TOP_LEVELS = 5;
const startTime = Date.now();

// Max rows to show in the table (terminal height safety)
const MAX_TABLE_ROWS = 30;

// ─── Formatters ───────────────────────────────────────────────────────────────

function uptime(): string {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function fmt(n: number | null, decimals = 6): string {
  if (n === null) return '—';
  // Auto-select decimals for readability
  if (n >= 10_000) return n.toFixed(2);
  if (n >= 100)    return n.toFixed(4);
  return n.toFixed(decimals);
}

function fmtDev(dev: number | null, width = 9): string {
  if (dev === null) return chalk.gray('—'.padEnd(width));
  const s = (dev >= 0 ? '+' : '') + dev.toFixed(2) + '%';
  const padded = s.padEnd(width);
  if (Math.abs(dev) < 0.05)  return chalk.gray(padded);
  if (Math.abs(dev) < 0.5)   return chalk.white(padded);
  if (dev > 0) return chalk.yellow(padded);
  return chalk.cyan(padded);
}

function fmtImbalance(i: number): string {
  const bar = Math.round(i * 8);
  const filled = '█'.repeat(bar);
  const empty  = '░'.repeat(8 - bar);
  if (i > 0.65) return chalk.green(`[${filled}${empty}]`);
  if (i < 0.35) return chalk.red(`[${filled}${empty}]`);
  return chalk.gray(`[${filled}${empty}]`);
}

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5)  return chalk.green(`${s}s`);
  if (s < 15) return chalk.yellow(`${s}s`);
  return chalk.red(`${s}s`);
}

function fmtSignal(dev2: number | null): string {
  if (dev2 === null) return chalk.gray('·');
  if (dev2 >  1.0) return chalk.yellow('▲ BUY');   // LCX cheap vs external
  if (dev2 < -1.0) return chalk.cyan('▼ SELL');    // LCX expensive vs external
  return chalk.gray('—');
}

// ─── Stats ────────────────────────────────────────────────────────────────────

interface TableRow {
  pair:       string;
  bid:        number;
  ask:        number;
  oracle:     number;
  dev:        number;       // LCX mid vs blended oracle
  ext:        number | null;
  dev2:       number | null; // LCX mid vs pure external
  imbalance:  number;
  spread:     number;
  ageMs:      number;
}

function buildRows(): TableRow[] {
  const rows: TableRow[] = [];
  const now = Date.now();

  for (const [pair, book] of getAllOrderbooks()) {
    if (!book.hasSnapshot) continue;
    const { bid, ask, spread } = getBestBidAsk(pair);
    if (bid === null || ask === null || spread === null) continue;

    const oracle = getLastOracleResult(pair);
    if (!oracle) continue;

    // Filter: skip pairs where spread > 90% of mid (clearly broken/illiquid)
    const mid = (bid + ask) / 2;
    if (mid > 0 && spread / mid > 0.9) continue;

    rows.push({
      pair,
      bid,
      ask,
      oracle:    oracle.oraclePrice,
      dev:       oracle.deviation ?? 0,
      ext:       oracle.externalMid,
      dev2:      oracle.tier2Deviation,
      imbalance: oracle.imbalance,
      spread,
      ageMs:     now - book.updatedAt.getTime(),
    });
  }

  // Sort: pairs with external reference first (most interesting), then by |dev2| desc
  rows.sort((a, b) => {
    const aHasExt = a.ext !== null ? 1 : 0;
    const bHasExt = b.ext !== null ? 1 : 0;
    if (bHasExt !== aHasExt) return bHasExt - aHasExt;
    return Math.abs(b.dev2 ?? 0) - Math.abs(a.dev2 ?? 0);
  });

  return rows;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function renderHeader(): string {
  const { connected, total } = getWsStatus();
  const ext = getExternalOracleStatus();

  const lcxColor = connected === total && total > 0 ? chalk.green
                 : connected > 0 ? chalk.yellow : chalk.red;
  const lcxLabel = total === 0 ? 'STARTING' : `${connected}/${total}`;

  const krakenDot   = ext.kraken   ? chalk.green('● KRK') : chalk.red('○ KRK');
  const coinbaseDot = ext.coinbase ? chalk.green('● CB')  : chalk.red('○ CB');

  const allBooks = getAllOrderbooks();
  const active = [...allBooks.values()].filter((b) => b.hasSnapshot).length;
  const withExt = ext.pairs;

  return [
    chalk.bold.white('═'.repeat(100)),
    chalk.bold.white('  ⬡ LCX ORDERBOOK DOMINATOR') +
      '   LCX: ' + lcxColor(`● ${lcxLabel}`) +
      '  ' + krakenDot + '  ' + coinbaseDot +
      chalk.gray(`   ${active}/${allBooks.size} pairs  ext: ${withExt}  up: ${uptime()}`),
    chalk.bold.white('═'.repeat(100)),
  ].join('\n');
}

function renderTable(rows: TableRow[]): string {
  if (rows.length === 0) {
    return chalk.gray('\n  Waiting for data...\n');
  }

  // Column widths
  const C = {
    pair: 13, bid: 13, ask: 13, oracle: 13,
    dev: 9, ext: 13, dev2: 9, imb: 12, signal: 8, age: 5,
  };

  const header =
    chalk.bold.gray('  ') +
    chalk.bold.white('PAIR'.padEnd(C.pair)) +
    chalk.bold.green('BID'.padEnd(C.bid)) +
    chalk.bold.red('ASK'.padEnd(C.ask)) +
    chalk.bold.white('ORACLE'.padEnd(C.oracle)) +
    chalk.bold.gray('DEV%'.padEnd(C.dev)) +
    chalk.bold.magenta('EXTERNAL'.padEnd(C.ext)) +
    chalk.bold.gray('DEV2%'.padEnd(C.dev2)) +
    chalk.bold.gray('IMBALANCE'.padEnd(C.imb)) +
    chalk.bold.gray('SIGNAL'.padEnd(C.signal)) +
    chalk.bold.gray('AGE');

  const sep = chalk.gray('  ' + '─'.repeat(
    C.pair + C.bid + C.ask + C.oracle + C.dev + C.ext + C.dev2 + C.imb + C.signal + C.age
  ));

  const display = rows.slice(0, MAX_TABLE_ROWS);
  const rowLines = display.map((r) => {
    const pairColor = r.ext !== null ? chalk.cyan : chalk.white;
    return (
      chalk.gray('  ') +
      pairColor(r.pair.padEnd(C.pair)) +
      chalk.green(fmt(r.bid).padEnd(C.bid)) +
      chalk.red(fmt(r.ask).padEnd(C.ask)) +
      chalk.white(fmt(r.oracle).padEnd(C.oracle)) +
      fmtDev(r.dev, C.dev) +
      (r.ext !== null ? chalk.magenta(fmt(r.ext).padEnd(C.ext)) : chalk.gray('—'.padEnd(C.ext))) +
      fmtDev(r.dev2, C.dev2) +
      fmtImbalance(r.imbalance) + '  ' +
      fmtSignal(r.dev2).padEnd(C.signal) +
      fmtAge(r.ageMs)
    );
  });

  const hidden = rows.length > MAX_TABLE_ROWS
    ? chalk.gray(`\n  ... and ${rows.length - MAX_TABLE_ROWS} more pairs (filtered/waiting)`)
    : '';

  return ['', header, sep, ...rowLines, hidden].join('\n') + '\n';
}

// Depth preview rotates through pairs with external data
let depthIdx = 0;

function renderDepth(rows: TableRow[]): string {
  // Prefer pairs with external reference
  const withExt = rows.filter((r) => r.ext !== null);
  const pool = withExt.length > 0 ? withExt : rows;
  if (pool.length === 0) return '';

  depthIdx = depthIdx % pool.length;
  const r = pool[depthIdx];

  const books = getAllOrderbooks();
  const book = books.get(r.pair);
  if (!book) return '';

  const oracle = getLastOracleResult(r.pair);
  const lines: string[] = [];

  lines.push(
    chalk.gray('\n  ┌─ ') +
    chalk.bold.cyan(r.pair) +
    chalk.gray(' ─── depth preview ') +
    chalk.gray(`[${depthIdx + 1}/${pool.length}  auto-rotate] `) +
    chalk.gray('─'.repeat(40))
  );

  if (oracle) {
    lines.push(
      chalk.gray('  │  Oracle: ')    + chalk.white(fmt(oracle.oraclePrice)) +
      chalk.gray('  Micro: ')        + chalk.white(fmt(oracle.microprice)) +
      chalk.gray('  VAMP₅: ')        + chalk.white(fmt(oracle.vamp)) +
      chalk.gray('  Spread: ')       + chalk.yellow(fmt(oracle.spread, 4)) +
      (oracle.externalMid !== null
        ? chalk.gray('  Ext: ') + chalk.magenta(fmt(oracle.externalMid))
        : '')
    );
  }

  lines.push(
    chalk.gray('  │') +
    chalk.bold.green('  BIDS (price × qty)'.padEnd(32)) +
    chalk.bold.red('  ASKS (price × qty)')
  );

  for (let i = 0; i < TOP_LEVELS; i++) {
    const bid = book.buy[i];
    const ask = book.sell[i];
    const bidStr = bid
      ? chalk.green(`${fmt(bid.price).padStart(14)}  ×  ${bid.qty.toFixed(4).padEnd(12)}`)
      : ' '.repeat(32);
    const askStr = ask
      ? chalk.red(`${fmt(ask.price).padStart(14)}  ×  ${ask.qty.toFixed(4)}`)
      : '';
    lines.push(chalk.gray('  │  ') + bidStr + chalk.gray('  │  ') + askStr);
  }

  lines.push(chalk.gray('  └' + '─'.repeat(68)));
  return lines.join('\n') + '\n';
}

function renderFooter(rows: TableRow[]): string {
  // Quick stats
  const withExt = rows.filter((r) => r.ext !== null);
  const buySignals  = withExt.filter((r) => (r.dev2 ?? 0) >  1.0).length;
  const sellSignals = withExt.filter((r) => (r.dev2 ?? 0) < -1.0).length;

  const avgDev2 = withExt.length > 0
    ? withExt.reduce((s, r) => s + Math.abs(r.dev2 ?? 0), 0) / withExt.length
    : null;

  return [
    '',
    chalk.gray('  ' + '─'.repeat(98)),
    chalk.gray('  Legend: ') +
      chalk.cyan('cyan pair = has external ref') +
      chalk.gray('  |  ') +
      chalk.yellow('▲ BUY = LCX cheap vs ext >1%') +
      chalk.gray('  |  ') +
      chalk.cyan('▼ SELL = LCX exp vs ext >1%') +
      chalk.gray('  |  DEV%: blended oracle  DEV2%: pure external'),
    chalk.gray('  Stats: ') +
      chalk.yellow(`▲ ${buySignals} buy`) +
      chalk.gray(' / ') +
      chalk.cyan(`▼ ${sellSignals} sell`) +
      chalk.gray(` signals  |  avg |dev2|: `) +
      (avgDev2 !== null ? chalk.white(avgDev2.toFixed(3) + '%') : chalk.gray('—')) +
      chalk.gray('  |  Ctrl+C to exit'),
  ].join('\n');
}

// ─── Render loop ──────────────────────────────────────────────────────────────

let tick = 0;

function render(): void {
  tick++;
  // Rotate depth preview every 5s
  if (tick % 5 === 0) depthIdx++;

  const rows = buildRows();

  process.stdout.write('\x1Bc');
  process.stdout.write(
    renderHeader() +
    renderTable(rows) +
    renderDepth(rows) +
    renderFooter(rows) +
    '\n'
  );
}

let displayTimer: NodeJS.Timeout | null = null;

export function startDisplay(): void {
  render();
  displayTimer = setInterval(render, REFRESH_MS);
}

export function stopDisplay(): void {
  if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
}
