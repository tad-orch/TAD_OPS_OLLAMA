import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../config/env.js';

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

const DEFAULT_2LEGGED_SCOPES = ['account:read'];
const tokenCache = new Map<string, CachedToken>();

function normalizeScopes(scopes: string[]): string[] {
  const normalized = scopes
    .map((scope) => scope.trim())
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)].sort() : DEFAULT_2LEGGED_SCOPES;
}

function scopesToKey(scopes: string[]): string {
  return normalizeScopes(scopes).join(' ');
}

export async function get2LeggedToken(scopes: string[] = DEFAULT_2LEGGED_SCOPES): Promise<string> {
  const scopeKey = scopesToKey(scopes);
  const cachedToken = tokenCache.get(scopeKey);
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const credentials = `${env.apsClientId}:${env.apsClientSecret}`;
  const encodedCredentials = Buffer.from(credentials).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scopeKey
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

    tokenCache.set(scopeKey, {
      accessToken: response.data.access_token,
      expiresAt: Date.now() + Math.max((response.data.expires_in ?? 1800) - 60, 60) * 1000
    });

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
