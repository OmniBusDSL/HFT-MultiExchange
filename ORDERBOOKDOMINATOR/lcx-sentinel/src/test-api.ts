import 'dotenv/config';
import { getOpenOrders } from './lcx-api.js';
import { findBestExternalSource } from './discovery.js';
import ccxt from 'ccxt';
import chalk from 'chalk';

async function testAll() {
  console.log(chalk.bold.blue('\n--- DIAGNOSTIC LCX SENTINEL ---'));

  // 1. Test LCX API
  console.log(chalk.yellow('\n1. Testing LCX API Connection...'));
  try {
    const orders = await getOpenOrders();
    console.log(chalk.green('   [OK] LCX API connected.'));
    console.log(chalk.gray(`   [INFO] Found ${orders.length} open orders on your account.`));
    if (orders.length > 0) {
      console.log(chalk.gray(`   [INFO] First order raw:`), JSON.stringify(orders[0]));
      // @ts-ignore
      console.log(chalk.gray(`   [INFO] First order: ${orders[0].Side || orders[0].side} ${orders[0].Pair || orders[0].pair} @ ${orders[0].Price || orders[0].price}`));
    }
  } catch (err: any) {
    console.log(chalk.red(`   [FAIL] LCX API error: ${err.message}`));
  }

  // 2. Test CoinGecko Discovery
  console.log(chalk.yellow('\n2. Testing CoinGecko Discovery...'));
  try {
    const source = await findBestExternalSource('LCX');
    if (source) {
      console.log(chalk.green(`   [OK] Found external source for LCX: ${source.exchange} (${source.pair})`));
    } else {
      console.log(chalk.red('   [FAIL] No external source found for LCX.'));
    }
  } catch (err: any) {
    console.log(chalk.red(`   [FAIL] CoinGecko error: ${err.message}`));
  }

  // 3. Test CCXT (Kraken)
  console.log(chalk.yellow('\n3. Testing CCXT (Kraken) Ticker...'));
  try {
    const kraken = new ccxt.kraken();
    const ticker = await kraken.fetchTicker('LCX/EUR');
    console.log(chalk.green(`   [OK] Kraken LCX/EUR: Bid ${ticker.bid} / Ask ${ticker.ask}`));
  } catch (err: any) {
    console.log(chalk.red(`   [FAIL] CCXT error: ${err.message}`));
  }

  console.log(chalk.bold.blue('\n--- DIAGNOSTIC COMPLETE ---\n'));
}

testAll().catch(err => console.error(err));
