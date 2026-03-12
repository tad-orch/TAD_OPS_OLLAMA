import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../config/env.js';

let tokenCache:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | undefined;

export async function get2LeggedToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const credentials = `${env.apsClientId}:${env.apsClientSecret}`;
  const encodedCredentials = Buffer.from(credentials).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'account:read'
  });

  try {
    const response = await axios.post<{ access_token?: string; expires_in?: number }>(
      `${env.apsBaseUrl}/authentication/v2/token`,
      body.toString(),
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${encodedCredentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (!response.data.access_token) {
      throw new Error('APS no devolvio access_token en la respuesta');
    }

    tokenCache = {
      accessToken: response.data.access_token,
      expiresAt: Date.now() + Math.max((response.data.expires_in ?? 1800) - 60, 60) * 1000
    };

    return response.data.access_token;
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    console.error('[apsAuth] Error obteniendo token 2-legged', {
      status,
      data
    });

    throw new Error(
      `No se pudo obtener el token 2-legged de APS${status ? ` (HTTP ${status})` : ''}`
    );
  }
}
