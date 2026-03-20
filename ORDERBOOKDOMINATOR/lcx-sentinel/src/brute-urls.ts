import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';
import chalk from 'chalk';

const API_KEY = process.env.LCX_API_KEY || '';
const API_SECRET = process.env.LCX_API_SECRET || '';

function signRequest(method: string, endpoint: string, body: string = '{}'): any {
  const timestamp = Date.now().toString();
  const message = method.toUpperCase() + endpoint + body;
  const signature = crypto.createHmac('sha256', API_SECRET).update(message).digest('base64');
  return {
    'Content-Type': 'application/json',
    'x-access-key': API_KEY,
    'x-access-sign': signature,
    'x-access-timestamp': timestamp
  };
}

async function bruteForceBaseUrls() {
  console.log(chalk.bold.blue('--- BRUTE FORCING BASE URLS ---'));
  
  const baseUrls = [
    'https://exchange-api.lcx.com',
    'https://api.lcx.com',
    'https://exchange.lcx.com'
  ];

  const paths = [
    '/api/balances',
    '/api/order/open-orders',
    '/order/open-orders',
    '/api/v1/order/open-orders'
  ];

  for (const baseUrl of baseUrls) {
    for (const path of paths) {
      try {
        console.log(chalk.gray(`Trying: ${baseUrl}${path}`));
        const headers = signRequest('GET', path);
        const res = await axios.get(`${baseUrl}${path}`, { headers });
        console.log(chalk.green(`[SUCCESS] ${baseUrl}${path} works!`));
        return;
      } catch (err: any) {
        if (err.response?.status !== 404) {
          console.log(chalk.yellow(`[INFO] ${baseUrl}${path} -> ${err.response?.status}`));
        }
      }
    }
  }
}

bruteForceBaseUrls();
