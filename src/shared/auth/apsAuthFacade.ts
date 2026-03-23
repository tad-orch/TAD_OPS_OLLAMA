import { get2LeggedToken } from '../../services/apsAuth.js';
import { getConstructionAuthStatus, getValidAccessToken } from '../../services/apsUserAuth.js';
import type { AuthMode } from '../../types/aps.js';
import { warnLog } from '../logging/logger.js';

export type ResolvedAccessToken = {
  token: string;
  authMode: AuthMode;
  note?: string | undefined;
};

async function tryGetThreeLeggedToken(note?: string): Promise<ResolvedAccessToken | undefined> {
  const authStatus = await getConstructionAuthStatus();
  if (!authStatus.readyForConstructionEndpoints) {
    return undefined;
  }

  try {
    return {
      token: await getValidAccessToken(),
      authMode: '3legged',
      note
    };
  } catch (error) {
    warnLog('apsAuthFacade', 'Fallo usando 3-legged; se intentará fallback controlado', {
      message: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function getAccountReadAccessToken(): Promise<ResolvedAccessToken> {
  const threeLegged = await tryGetThreeLeggedToken(
    'Se utilizó auth global 3-legged como modo dominante.'
  );
  if (threeLegged) {
    return threeLegged;
  }

  return {
    token: await get2LeggedToken(['account:read']),
    authMode: '2legged',
    note: 'Se usó fallback 2-legged controlado para mantener compatibilidad.'
  };
}

export async function getDataReadAccessToken(): Promise<ResolvedAccessToken> {
  const threeLegged = await tryGetThreeLeggedToken(
    'Se utilizó auth global 3-legged como modo dominante.'
  );
  if (threeLegged) {
    return threeLegged;
  }

  return {
    token: await get2LeggedToken(['data:read']),
    authMode: '2legged',
    note: 'Se usó fallback 2-legged controlado para el endpoint de Data Management.'
  };
}
