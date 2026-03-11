import axios from 'axios';
import { env } from '../config/env.js';

export async function get2LeggedToken(): Promise<string> {
  const credentials = `${env.apsClientId}:${env.apsClientSecret}`;
  const encodedCredentials = Buffer.from(credentials).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'account:read'
  });

  const response = await axios.post(
    `${env.apsBaseUrl}/authentication/v2/token`,
    body.toString(),
    {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${encodedCredentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  return response.data.access_token;
}
