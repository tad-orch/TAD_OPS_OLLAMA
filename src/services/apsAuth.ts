import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../config/env.js';

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

type StoredAccTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string | undefined;
  obtained_at: number;
  profile?: {
    userId?: string | undefined;
    email?: string | undefined;
    name?: string | undefined;
  };
};

const DEFAULT_2LEGGED_SCOPES = ['account:read'];
const DEFAULT_ACC_READ_SCOPES = ['data:read', 'account:read'];
const TOKEN_SKEW_MS = 60_000;
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

function getAccTokenStorePath(): string {
  return path.join(
    os.homedir(),
    process.env.APS_ACC_TOKEN_DIR?.trim() || '.tad-mcp-acc',
    'tokens.json'
  );
}

async function readStoredAccTokens(): Promise<StoredAccTokens | undefined> {
  try {
    const raw = await readFile(getAccTokenStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as { tokens?: StoredAccTokens };
    return parsed.tokens;
  } catch {
    return undefined;
  }
}

async function writeStoredAccTokens(tokens: StoredAccTokens): Promise<void> {
  const storePath = getAccTokenStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp`;
  await writeFile(tempPath, JSON.stringify({ version: 1, tokens }, null, 2), 'utf8');
  await rename(tempPath, storePath);
}

function isStoredAccTokenFresh(tokens: StoredAccTokens): boolean {
  const expiresAt = tokens.obtained_at + tokens.expires_in * 1000;
  return Date.now() < expiresAt - TOKEN_SKEW_MS;
}

async function refreshAccUserToken(
  refreshTokenValue: string,
  scopes: string[]
): Promise<StoredAccTokens> {
  const credentials = `${env.apsClientId}:${env.apsClientSecret}`;
  const encodedCredentials = Buffer.from(credentials).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    scope: scopesToKey(scopes)
  });

  const response = await axios.post<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  }>(`${env.apsBaseUrl}/authentication/v2/token`, body.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${encodedCredentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.data.access_token) {
    throw new Error('APS no devolvió access_token al refrescar la sesión ACC');
  }

  return {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token ?? refreshTokenValue,
    expires_in: response.data.expires_in ?? 3600,
    token_type: response.data.token_type ?? 'Bearer',
    scope: response.data.scope,
    obtained_at: Date.now()
  };
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

export async function getAccUserReadToken(
  scopes: string[] = DEFAULT_ACC_READ_SCOPES
): Promise<string> {
  const storedTokens = await readStoredAccTokens();
  if (!storedTokens) {
    throw new Error(
      `No hay sesión ACC de usuario disponible para consultas de construcción. Estos endpoints requieren autenticación ACC 3-legged. Usa el flujo de login del repo base TAD_MCP_ACC para generar ${getAccTokenStorePath()}.`
    );
  }

  if (isStoredAccTokenFresh(storedTokens)) {
    return storedTokens.access_token;
  }

  try {
    const refreshedTokens = await refreshAccUserToken(storedTokens.refresh_token, scopes);
    await writeStoredAccTokens({
      ...storedTokens,
      ...refreshedTokens,
      ...(storedTokens.profile ? { profile: storedTokens.profile } : {})
    });
    return refreshedTokens.access_token;
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    console.error('[apsAuth] Error refrescando sesión ACC 3-legged', {
      status,
      data
    });

    throw new Error(
      `No se pudo refrescar la sesión ACC de usuario${status ? ` (HTTP ${status})` : ''}.`
    );
  }
}
