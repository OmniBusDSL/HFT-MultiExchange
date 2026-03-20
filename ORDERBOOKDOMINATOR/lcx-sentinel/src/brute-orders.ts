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
  return {
    'Content-Type': 'application/json',
    'x-access-key': API_KEY,
    'x-access-sign': signature,
    'x-access-timestamp': timestamp
  };
}

async function bruteForceOrders() {
  console.log(chalk.bold.blue('--- BRUTE FORCING LCX ORDER ENDPOINTS ---'));
  
  const paths = [
    '/api/order',
    '/api/orders',
    '/api/order/list',
    '/api/orders/list',
    '/api/order/active',
    '/api/orders/active',
    '/api/order/open',
    '/api/orders/open',
    '/api/order/all',
    '/api/orders/all',
    '/api/order/history',
    '/api/orders/history',
    '/api/v1/order',
    '/api/v1/orders'
  ];

  for (const path of paths) {
    try {
      console.log(chalk.gray(`Trying: ${path}`));
      const headers = signRequest('GET', path);
      const res = await axios.get(`${BASE_URL}${path}`, { headers });
      console.log(chalk.green(`[SUCCESS] ${path} works!`));
      console.log(JSON.stringify(res.data, null, 2).substring(0, 500) + '...');
      return;
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.log(chalk.yellow(`[INFO] ${path} -> HTTP ${err.response?.status || 'ERR'}: ${err.response?.data?.message || err.message}`));
      }
    }
  }
}

bruteForceOrders();
