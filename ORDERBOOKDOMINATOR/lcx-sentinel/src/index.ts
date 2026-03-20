import { getOpenOrders, fetchAllPairs } from './lcx-api.js';
import { findBestExternalSource, syncCoinList, discoverAllLcxPairs } from './discovery.js';
import { Oracle } from './oracle.js';
import { Sentinel } from './sentinel.js';
import { upsertOrder, cleanOldOrders, getActiveOrdersFromDb } from './monitor-db.js';
import chalk from 'chalk';
import 'dotenv/config';

const SYNC_INTERVAL_MS = 30000; // 30s
const activeSentinels = new Map<string, { sentinel: Sentinel, oracle: Oracle }>();

async function syncAccount() {
  try {
    console.log(chalk.gray('[Shield] Syncing orders from LCX...'));
    const orders = await getOpenOrders();
    
    for (const order of orders) {
      upsertOrder(order);
    }
    
    cleanOldOrders();
    console.log(chalk.green(`[Shield] Synced ${orders.length} orders to monitor.db`));
    
    // Manage Sentinels for each active pair
    const activeOrders = getActiveOrdersFromDb();
    const pairsToMonitor = new Set(activeOrders.map(o => o.pair));

    for (const pair of pairsToMonitor) {
      if (!activeSentinels.has(pair)) {
        console.log(chalk.blue(`[Shield] Starting protection for: ${pair}`));
        
        const symbol = pair.includes('/') ? pair.split('/')[0] : pair.split('_')[0];
        const source = await findBestExternalSource(symbol);
        
        let oracle: Oracle | undefined;
        if (source) {
          oracle = new Oracle(source);
          oracle.start();
        } else {
          console.log(chalk.yellow(`         (No external oracle for ${pair}, queue analysis only)`));
        }

        const sentinel = new Sentinel(oracle);
        sentinel.start();
        activeSentinels.set(pair, { sentinel, oracle: oracle! });
      }
    }

    // Cleanup Sentinels for pairs no longer in open orders
    for (const pair of activeSentinels.keys()) {
      if (!pairsToMonitor.has(pair)) {
        console.log(chalk.yellow(`[Shield] Stopping protection for ${pair} (No open orders)`));
        const { oracle } = activeSentinels.get(pair)!;
        oracle.stop();
        activeSentinels.delete(pair);
      }
    }

  } catch (err: any) {
    console.error(chalk.red('[Shield] Sync Error:'), err.message);
  }
}

async function main() {
  console.log(chalk.bold.blue('\n═══ LCX SENTINEL SHIELD ENGINE ═══'));
  
  // Initialize Global Discovery Data
  await syncCoinList();
  const allLcxPairs = await fetchAllPairs();
  await discoverAllLcxPairs(allLcxPairs);

  // Initial Sync
  await syncAccount();

  // Keep Syncing periodically
  setInterval(syncAccount, SYNC_INTERVAL_MS);
  
  console.log(chalk.bold.green('\n═══ SHIELD IS ACTIVE: MONITORING DATABASE ═══\n'));
}

main().catch(err => console.error(chalk.red('[Main] Fatal:'), err));
