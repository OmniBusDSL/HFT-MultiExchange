import { findBestExternalSource } from './discovery.js';
import chalk from 'chalk';

async function testSymbols() {
  const symbols = ['ARC', 'LCX', 'DOGE', 'QUANT', 'DAG', 'NXRA', 'GALA', 'LINK', 'ETH', 'ADA'];
  
  console.log(chalk.bold.blue('--- TESTING COINGECKO DISCOVERY ---'));
  
  for (const symbol of symbols) {
    try {
      const source = await findBestExternalSource(symbol);
      if (source) {
        console.log(chalk.green(`[OK] ${symbol.padEnd(6)} -> Found: ${source.exchange} (${source.pair}) | Vol: $${source.volume.toLocaleString()}`));
      } else {
        console.log(chalk.red(`[FAIL] ${symbol.padEnd(6)} -> No external source found.`));
      }
    } catch (err: any) {
      console.log(chalk.bgRed(`[ERROR] ${symbol.padEnd(6)} -> ${err.message}`));
    }
    // Rate limiting safety
    await new Promise(r => setTimeout(r, 1500));
  }
}

testSymbols();
