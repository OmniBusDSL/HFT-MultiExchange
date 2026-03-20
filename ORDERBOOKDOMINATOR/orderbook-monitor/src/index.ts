import 'dotenv/config';
import { fetchPairs } from './api.js';
import { startWebSocket, shutdown as shutdownWs } from './websocket.js';
import { startDisplay, stopDisplay } from './display.js';
import { startLogger, stopLogger } from './logger.js';
import { startExternalOracle, stopExternalOracle } from './external-oracle.js';
import { startServer, stopServer } from './server.js';

async function main(): Promise<void> {
  console.log('Fetching trading pairs from LCX...');
  let pairs: string[];

  try {
    pairs = await fetchPairs();
    console.log(`Found ${pairs.length} active pairs.`);
  } catch (err) {
    console.error('Failed to fetch pairs:', err);
    process.exit(1);
  }

  startExternalOracle(pairs);   // Tier 2: Kraken + Coinbase
  startWebSocket(pairs);        // Tier 1: LCX LOB
  startDisplay();
  startLogger();
  startServer(3000);
}

function shutdown(): void {
  stopDisplay();
  stopLogger();
  shutdownWs();
  stopExternalOracle();
  stopServer();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
