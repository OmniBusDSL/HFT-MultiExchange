import crypto from 'crypto';
import type { AuthHeaders } from './types.js';

export function signRequest(
  method: string,
  endpoint: string,
  payload: Record<string, unknown>,
  apiKey: string,
  secretKey: string,
): AuthHeaders {
  const timestamp = Date.now().toString();
  const body = Object.keys(payload).length ? JSON.stringify(payload) : '{}';
  const message = method.toUpperCase() + endpoint + body;

  const sign = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');

  return {
    'x-access-key': apiKey,
    'x-access-sign': sign,
    'x-access-timestamp': timestamp,
  };
}
