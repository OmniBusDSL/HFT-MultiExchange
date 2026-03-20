import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';
import chalk from 'chalk';

const BASE_URL = 'https://exchange-api.lcx.com';
const API_KEY = process.env.LCX_API_KEY || '';
const API_SECRET = process.env.LCX_API_SECRET || '';

function signRequest(method: string, endpoint: string, body: string = '{}'): any {
  const timestamp = Date.now().toString();
  const message = method.toUpperCase() + endpoint + body;
  const signature = crypto.createHmac('sha256', API_SECRET).update(message).digest('base64');
  return { 'Content-Type': 'application/json', 'x-access-key': API_KEY, 'x-access-sign': signature, 'x-access-timestamp': timestamp };
}

async function tryEndpoint(path: string) {
  process.stdout.write(`Trying ${path}... `);
  const headers = signRequest('GET', path);
  try {
    const res = await axios.get(`${BASE_URL}${path}`, { headers });
    console.log(chalk.green(`[OK] Success! (HTTP ${res.status})`));
    console.log(chalk.gray(`Data: ${JSON.stringify(res.data).substring(0, 100)}...`));
    return true;
  } catch (err: any) {
    if (err.response?.status === 404) {
      console.log(chalk.red('[FAIL] 404 Not Found'));
    } else if (err.response?.status === 401 || err.response?.status === 403) {
      console.log(chalk.yellow(`[FAIL] ${err.response.status} Auth Error`));
    } else {
      console.log(chalk.red(`[FAIL] ${err.response?.status || 'ERR'} ${err.message}`));
    }
    return false;
  }
}

async function brute() {
  const paths = [
    '/api/order/open',
    '/api/v1/order/open',
    '/order/open',
    '/api/order/open-orders',
    '/api/account/balances',
    '/api/v1/account/balances',
    '/account/balances',
    '/api/main/account/balances'
  ];

  for (const path of paths) {
    if (await tryEndpoint(path)) break;
    await new Promise(r => setTimeout(r, 500));
  }
}

brute();
