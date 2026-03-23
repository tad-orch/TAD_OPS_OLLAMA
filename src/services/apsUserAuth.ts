import crypto from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../config/env.js';
import { debugLog, errorLog, infoLog, redactPathForLog, warnLog } from '../shared/logging/logger.js';
import {
  clearAuthMetadata,
  getTokenStoreMetadataKey,
  syncAuthMetadata
} from '../shared/storage/authMetadataRepo.js';

type AuthProfile = {
  userId?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
};

export type StoredUserAuth = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope?: string | undefined;
  scopes: string[];
  expires_at: number;
  obtained_at: number;
  callback_url: string;
  profile?: AuthProfile | undefined;
  updated_at: string;
};

type AuthStoreFile = {
  version: 1;
  auth?: StoredUserAuth;
};

type PendingLoginState = {
  server: http.Server;
  redirectUri: string;
  callbackPath: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  scopes: string[];
  startedAt: string;
  timeout: NodeJS.Timeout;
};

type TokenExchangeResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type ConstructionAuthStatus = {
  authMode: '2legged' | '3legged';
  readyForConstructionEndpoints: boolean;
  pendingLogin: boolean;
  callbackUrl: string;
  hasStoredAuth: boolean;
  profileId?: string | undefined;
  displayName?: string | undefined;
  expiresAt?: string | undefined;
  message: string;
};

export type StartLoginResult = {
  status: 'already_authenticated' | 'login_started' | 'login_pending';
  authReady: boolean;
  callbackUrl: string;
  authorizationUrl: string;
  message: string;
  profileId?: string | undefined;
  displayName?: string | undefined;
};

const AUTHORIZE_URL = `${env.apsBaseUrl}/authentication/v2/authorize`;
const TOKEN_URL = `${env.apsBaseUrl}/authentication/v2/token`;
const PROFILE_URL = `${env.apsBaseUrl}/userprofile/v1/users/@me`;
const TOKEN_SKEW_MS = 60_000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STORE_PATH = path.join(os.homedir(), '.tad-ops-ollama', 'aps-user-auth.json');
const LEGACY_STORE_PATH = path.join(os.homedir(), '.tad-mcp-acc', 'tokens.json');

let pendingLogin: PendingLoginState | undefined;

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function randomState(): string {
  return base64Url(crypto.randomBytes(24));
}

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.apsClientId}:${env.apsClientSecret}`).toString('base64')}`;
}

function getStorePath(): string {
  return process.env.APS_USER_AUTH_STORAGE_PATH?.trim() || DEFAULT_STORE_PATH;
}

export function getAuthStorePath(): string {
  return getStorePath();
}

function normalizeScopes(scopes: string[] = env.apsThreeLeggedScopes): string[] {
  const normalized = scopes.map((scope) => scope.trim()).filter(Boolean);
  return normalized.length > 0 ? [...new Set(normalized)] : [...env.apsThreeLeggedScopes];
}

function getExpiresAt(expiresInSeconds: number): number {
  return Date.now() + Math.max(expiresInSeconds, 60) * 1000;
}

function isAccessTokenFresh(auth: StoredUserAuth): boolean {
  return Date.now() < auth.expires_at - TOKEN_SKEW_MS;
}

function getMaskedState(state: string): string {
  return state.slice(0, 6);
}

function buildAuthorizationUrl(params: {
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.apsClientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function fetchUserProfile(accessToken: string): Promise<AuthProfile> {
  try {
    const response = await axios.get<{
      userId?: string;
      uid?: string;
      sub?: string;
      emailId?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      name?: string;
    }>(PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return {
      ...(response.data.userId || response.data.uid || response.data.sub
        ? { userId: response.data.userId ?? response.data.uid ?? response.data.sub }
        : {}),
      ...(response.data.emailId || response.data.email
        ? { email: response.data.emailId ?? response.data.email }
        : {}),
      ...(response.data.firstName || response.data.lastName || response.data.name
        ? {
            name:
              response.data.firstName && response.data.lastName
                ? `${response.data.firstName} ${response.data.lastName}`
                : response.data.name
          }
        : {})
    };
  } catch {
    return {};
  }
}

function mapTokenResponseToStoredAuth(
  response: TokenExchangeResponse,
  scopes: string[],
  callbackUrl: string,
  refreshTokenFallback?: string,
  profile?: AuthProfile
): StoredUserAuth {
  if (!response.access_token) {
    throw new Error('APS no devolvio access_token en la respuesta 3-legged');
  }

  const refreshToken = response.refresh_token ?? refreshTokenFallback;
  if (!refreshToken) {
    throw new Error('APS no devolvio refresh_token para la sesion 3-legged');
  }

  return {
    access_token: response.access_token,
    refresh_token: refreshToken,
    token_type: response.token_type ?? 'Bearer',
    scope: response.scope,
    scopes: normalizeScopes(scopes),
    expires_at: getExpiresAt(response.expires_in ?? 3600),
    obtained_at: Date.now(),
    callback_url: callbackUrl,
    ...(profile ? { profile } : {}),
    updated_at: new Date().toISOString()
  };
}

async function closePendingLogin(): Promise<void> {
  const currentPending = pendingLogin;
  pendingLogin = undefined;
  if (!currentPending) {
    return;
  }

  clearTimeout(currentPending.timeout);

  await new Promise<void>((resolve) => {
    currentPending.server.close(() => resolve());
  });
}

async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  scopes: string[];
}): Promise<StoredUserAuth> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    scope: normalizeScopes(params.scopes).join(' ')
  });

  const response = await axios.post<TokenExchangeResponse>(TOKEN_URL, body.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const profile = await fetchUserProfile(response.data.access_token ?? '');
  return mapTokenResponseToStoredAuth(
    response.data,
    params.scopes,
    params.redirectUri,
    undefined,
    profile
  );
}

export async function refreshAccessToken(
  refreshToken: string,
  scopes: string[] = env.apsThreeLeggedScopes
): Promise<StoredUserAuth> {
  const normalizedScopes = normalizeScopes(scopes);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: normalizedScopes.join(' ')
  });

  const response = await axios.post<TokenExchangeResponse>(TOKEN_URL, body.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const profile = await fetchUserProfile(response.data.access_token ?? '');
  return mapTokenResponseToStoredAuth(
    response.data,
    normalizedScopes,
    env.apsThreeLeggedCallbackUrl,
    refreshToken,
    profile
  );
}

export async function loadStoredAuth(): Promise<StoredUserAuth | undefined> {
  try {
    const raw = await readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as AuthStoreFile;
    return parsed.auth;
  } catch {}

  try {
    const legacyRaw = await readFile(LEGACY_STORE_PATH, 'utf8');
    const parsed = JSON.parse(legacyRaw) as { tokens?: Partial<StoredUserAuth> };
    if (!parsed.tokens?.access_token || !parsed.tokens?.refresh_token) {
      return undefined;
    }

    return {
      access_token: parsed.tokens.access_token,
      refresh_token: parsed.tokens.refresh_token,
      token_type: parsed.tokens.token_type ?? 'Bearer',
      scope: parsed.tokens.scope,
      scopes: parsed.tokens.scopes ?? env.apsThreeLeggedScopes,
      expires_at:
        parsed.tokens.expires_at ??
        ((parsed.tokens.obtained_at ?? Date.now()) +
          ((parsed.tokens as { expires_in?: number }).expires_in ?? 3600) * 1000),
      obtained_at: parsed.tokens.obtained_at ?? Date.now(),
      callback_url: parsed.tokens.callback_url ?? env.apsThreeLeggedCallbackUrl,
      ...(parsed.tokens.profile ? { profile: parsed.tokens.profile } : {}),
      updated_at: parsed.tokens.updated_at ?? new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

export async function saveStoredAuth(auth: StoredUserAuth): Promise<void> {
  const storePath = getStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp`;
  await writeFile(tempPath, JSON.stringify({ version: 1, auth }, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  await rename(tempPath, storePath);
  await syncAuthMetadata(auth, storePath);
  infoLog('apsUserAuth', 'Tokens 3-legged guardados', {
    storePath: redactPathForLog(storePath),
    profileId: auth.profile?.userId,
    expiresAt: new Date(auth.expires_at).toISOString()
  });
}

export async function clearStoredAuth(): Promise<void> {
  try {
    const storePath = getStorePath();
    await unlink(storePath);
    await clearAuthMetadata(storePath, getTokenStoreMetadataKey(storePath));
    infoLog('apsUserAuth', 'Tokens 3-legged eliminados');
  } catch {
    // ignore
  }
}

export async function getConstructionAuthStatus(): Promise<ConstructionAuthStatus> {
  const storedAuth = await loadStoredAuth();
  if (storedAuth) {
    await syncAuthMetadata(storedAuth, getStorePath());
  }

  const displayName = storedAuth?.profile?.name ?? storedAuth?.profile?.email;
  const profileId = storedAuth?.profile?.userId ?? storedAuth?.profile?.email;
  const hasStoredAuth = Boolean(storedAuth?.refresh_token || storedAuth?.access_token);
  const readyForConstructionEndpoints = hasStoredAuth;
  const pending = Boolean(pendingLogin);

  return {
    authMode: readyForConstructionEndpoints || pending ? '3legged' : '2legged',
    readyForConstructionEndpoints,
    pendingLogin: pending,
    callbackUrl: env.apsThreeLeggedCallbackUrl,
    hasStoredAuth,
    ...(profileId ? { profileId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(storedAuth ? { expiresAt: new Date(storedAuth.expires_at).toISOString() } : {}),
    message: readyForConstructionEndpoints
      ? 'Hay autenticacion ACC 3-legged disponible para endpoints de construccion.'
      : pending
        ? 'Hay un login ACC 3-legged pendiente en el navegador.'
        : 'No hay autenticacion ACC 3-legged lista para endpoints de construccion.'
  };
}

export async function getValidAccessToken(): Promise<string> {
  const storedAuth = await loadStoredAuth();
  if (!storedAuth) {
    warnLog('apsUserAuth', 'Falta autenticacion 3-legged para endpoints de construccion');
    throw new Error(
      'Necesito autenticacion ACC de usuario para consultar endpoints de construccion. Ejecuta start_acc_user_login.'
    );
  }

  if (isAccessTokenFresh(storedAuth)) {
    return storedAuth.access_token;
  }

  infoLog('apsUserAuth', 'Access token expirado; refrescando sesion 3-legged', {
    profileId: storedAuth.profile?.userId
  });

  try {
    const refreshedAuth = await refreshAccessToken(
      storedAuth.refresh_token,
      storedAuth.scopes.length > 0 ? storedAuth.scopes : env.apsThreeLeggedScopes
    );
    await saveStoredAuth({
      ...storedAuth,
      ...refreshedAuth,
      callback_url: storedAuth.callback_url || env.apsThreeLeggedCallbackUrl,
      ...(refreshedAuth.profile || storedAuth.profile
        ? { profile: refreshedAuth.profile ?? storedAuth.profile }
        : {})
    });
    infoLog('apsUserAuth', 'Sesion 3-legged refrescada correctamente', {
      profileId: refreshedAuth.profile?.userId ?? storedAuth.profile?.userId
    });
    return refreshedAuth.access_token;
  } catch (error) {
    const axiosError = error as AxiosError;
    errorLog('apsUserAuth', 'Error refrescando sesion 3-legged', {
      status: axiosError.response?.status,
      data: axiosError.response?.data
    });
    throw new Error(
      `No se pudo refrescar la autenticacion ACC de usuario${axiosError.response?.status ? ` (HTTP ${axiosError.response.status})` : ''}. Ejecuta start_acc_user_login nuevamente.`
    );
  }
}

export async function startLogin(): Promise<StartLoginResult> {
  const authStatus = await getConstructionAuthStatus();
  if (authStatus.readyForConstructionEndpoints) {
    return {
      status: 'already_authenticated',
      authReady: true,
      callbackUrl: env.apsThreeLeggedCallbackUrl,
      authorizationUrl: '',
      message:
        'Ya hay autenticacion ACC 3-legged disponible para endpoints de construccion.',
      ...(authStatus.profileId ? { profileId: authStatus.profileId } : {}),
      ...(authStatus.displayName ? { displayName: authStatus.displayName } : {})
    };
  }

  if (pendingLogin) {
    return {
      status: 'login_pending',
      authReady: false,
      callbackUrl: pendingLogin.redirectUri,
      authorizationUrl: buildAuthorizationUrl({
        redirectUri: pendingLogin.redirectUri,
        scopes: pendingLogin.scopes,
        state: pendingLogin.state,
        codeChallenge: pendingLogin.codeChallenge
      }),
      message:
        'Ya hay un login ACC 3-legged pendiente. Abre la URL en el navegador y completa sign-in + MFA.'
    };
  }

  const redirectUri = env.apsThreeLeggedCallbackUrl;
  const parsedCallbackUrl = new URL(redirectUri);
  const state = randomState();
  const pkce = createPkcePair();
  const scopes = normalizeScopes(env.apsThreeLeggedScopes);

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (requestUrl.pathname !== parsedCallbackUrl.pathname) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const returnedState = requestUrl.searchParams.get('state');
      const error = requestUrl.searchParams.get('error');

      debugLog('apsUserAuth', 'Callback 3-legged recibido', {
        path: requestUrl.pathname,
        state: returnedState ? getMaskedState(returnedState) : undefined,
        hasCode: Boolean(code),
        error
      });

      if (!pendingLogin) {
        response.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('No hay login ACC pendiente en este proceso.');
        return;
      }

      if (error) {
        throw new Error(`APS devolvio error en el callback: ${error}`);
      }

      if (!code || !returnedState || returnedState !== pendingLogin.state) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('State invalido o code faltante.');
        return;
      }

      const storedAuth = await exchangeCodeForTokens({
        code,
        redirectUri: pendingLogin.redirectUri,
        codeVerifier: pendingLogin.codeVerifier,
        scopes: pendingLogin.scopes
      });
      await saveStoredAuth(storedAuth);

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<html><body style="font-family:sans-serif;padding:32px;">
        <h1>Autenticacion completada</h1>
        <p>Puedes volver al chat. La sesion ACC 3-legged quedo guardada localmente.</p>
      </body></html>`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      errorLog('apsUserAuth', 'Error manejando callback 3-legged', {
        message
      });
      response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<html><body style="font-family:sans-serif;padding:32px;">
        <h1>No se pudo completar la autenticacion</h1>
        <p>${message}</p>
      </body></html>`);
    } finally {
      await closePendingLogin();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) => reject(error));
    server.listen(Number(parsedCallbackUrl.port || '3000'), parsedCallbackUrl.hostname, () =>
      resolve()
    );
  });
  server.unref();

  const timeout = setTimeout(() => {
    warnLog('apsUserAuth', 'Login 3-legged expiro por timeout', {
      state: getMaskedState(state)
    });
    void closePendingLogin();
  }, LOGIN_TIMEOUT_MS);
  timeout.unref();

  pendingLogin = {
    server,
    redirectUri,
    callbackPath: parsedCallbackUrl.pathname,
    state,
    codeVerifier: pkce.verifier,
    codeChallenge: pkce.challenge,
    scopes,
    startedAt: new Date().toISOString(),
    timeout
  };

  infoLog('apsUserAuth', 'Login 3-legged iniciado', {
    callbackUrl: redirectUri,
    state: getMaskedState(state),
    scopes
  });

  return {
    status: 'login_started',
    authReady: false,
    callbackUrl: redirectUri,
    authorizationUrl: buildAuthorizationUrl({
      redirectUri,
      scopes,
      state,
      codeChallenge: pkce.challenge
    }),
    message:
      'Abre la URL en tu navegador, completa sign-in + MFA y espera el callback local para terminar la autenticacion.'
  };
}
