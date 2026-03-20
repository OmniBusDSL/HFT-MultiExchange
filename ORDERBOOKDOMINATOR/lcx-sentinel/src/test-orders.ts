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

async function testOpenOrders() {
  console.log(chalk.bold.blue('--- TESTING LCX OPEN ORDERS ---'));
  
  const paths = [
    '/api/order/open-orders',
    '/api/v1/order/open',
    '/api/order/open',
    '/order/open-orders'
  ];

  for (const path of paths) {
    try {
      console.log(chalk.gray(`Trying endpoint: ${path}...`));
      const headers = signRequest('GET', path);
      const res = await axios.get(`${BASE_URL}${path}`, { headers });
      console.log(chalk.green(`[SUCCESS] Endpoint ${path} works!`));
      console.log(chalk.white('Response Data:'), JSON.stringify(res.data, null, 2));
      return;
    } catch (err: any) {
      console.log(chalk.red(`[FAIL] ${path} → ${err.response?.status || 'Error'}: ${err.response?.data?.message || err.message}`));
    }
  }
}

testOpenOrders();
