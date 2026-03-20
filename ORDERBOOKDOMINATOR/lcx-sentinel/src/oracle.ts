import ccxt from 'ccxt';
import type { ExternalSource } from './discovery.js';
import axios from 'axios';
import chalk from 'chalk';

export class Oracle {
  private exchangeInstance: any;
  private currentPrice: { bid: number, ask: number, mid: number, isFallback?: boolean } | null = null;
  private isRunning: boolean = false;

  constructor(private source: ExternalSource) {
    if (source.exchange !== 'coingecko') {
      const ExchangeClass = (ccxt as any)[source.exchange];
      if (!ExchangeClass) throw new Error(`[Oracle] CCXT does not support: ${source.exchange}`);
      this.exchangeInstance = new ExchangeClass();
    } else {
      console.log(chalk.gray(`[Oracle] Initialized CoinGecko Fallback for ${source.coinId}`));
      if (source.directPrice) {
        this.currentPrice = { bid: source.directPrice, ask: source.directPrice, mid: source.directPrice, isFallback: true };
      }
    }
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.poll();
  }

  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.source.exchange === 'coingecko') {
          // CoinGecko Fallback Polling (Slow: 60s to avoid rate limit)
          const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.source.coinId}&vs_currencies=eur,usd`;
          const headers = process.env.CG_API_KEY ? { 'x-cg-demo-api-key': process.env.CG_API_KEY } : {};
          const res = await axios.get(url, { headers });
          const price = res.data[this.source.coinId!]?.eur || res.data[this.source.coinId!]?.usd;
          if (price) {
            this.currentPrice = { bid: price, ask: price, mid: price, isFallback: true };
          }
          await new Promise(r => setTimeout(r, 60000)); 
        } else {
          // Normal CCXT Polling (Fast: 1s)
          const ticker = await this.exchangeInstance.fetchTicker(this.source.pair);
          this.currentPrice = {
            bid: ticker.bid,
            ask: ticker.ask,
            mid: (ticker.bid + ticker.ask) / 2,
            isFallback: false
          };
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (err: any) {
        // Silent catch
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  public getPrice() {
    return this.currentPrice;
  }

  public stop(): void {
    this.isRunning = false;
  }
}
