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

async function testAuth() {
  console.log(chalk.bold.blue('--- TESTING LCX AUTHENTICATION ---'));
  
  const paths = [
    '/api/balances',
    '/api/order/open-orders',
    '/balances',
    '/main/balances'
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
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.log(chalk.red(`[FAIL] ${path} → Invalid API Key or Secret (HTTP ${err.response.status})`));
        console.log(chalk.gray(`Message: ${err.response?.data?.message || 'Unauthorized'}`));
        return;
      }
      console.log(chalk.gray(`[INFO] ${path} → ${err.response?.status || 'Unknown error'}`));
    }
  }
  
  console.log(chalk.red('\n[CRITICAL] All auth attempts failed. Could not validate API Keys or find correct endpoint.'));
}

testAuth();
