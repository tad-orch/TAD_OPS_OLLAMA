import { env } from '../../../../config/env.js';
import { getFreshUsersFromCache, replaceUsersCache } from '../../../../db/repositories/userCacheRepo.js';
import { getProjectUsers } from '../../../../services/apsAdmin.js';
import { get2LeggedToken } from '../../../../services/apsAuth.js';
import type { ApsProjectUser, AuthMode, GetProjectUsersToolArgs } from '../../../../types/aps.js';
import { isLikelyActingUserId } from '../../../../utils/ids.js';
import { getAccountReadAccessToken } from '../../../../shared/auth/apsAuthFacade.js';
import { warnLog } from '../../../../shared/logging/logger.js';

const USERS_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeProducts(products?: string | string[]): string[] | undefined {
  if (!products) {
    return undefined;
  }

  if (Array.isArray(products)) {
    return products.map((product) => product.trim()).filter(Boolean);
  }

  return products
    .split(',')
    .map((product) => product.trim())
    .filter(Boolean);
}

export type AccountProjectUsersResponse = {
  authMode: AuthMode;
  projectId: string;
  users: ApsProjectUser[];
  rawPages: unknown[];
  endpoint: string;
  note?: string | undefined;
};

export async function listProjectUsersForAccountAdmin(
  args: GetProjectUsersToolArgs
): Promise<AccountProjectUsersResponse> {
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error('get_project_users requiere projectId');
  }

  const cleanedProjectId = projectId.replace(/^b\./, '');
  const endpoint = `${env.apsBaseUrl}/construction/admin/v1/projects/${cleanedProjectId}/users`;
  const cachedUsers = getFreshUsersFromCache(cleanedProjectId, USERS_CACHE_TTL_MS);
  if (cachedUsers) {
    return {
      authMode: '3legged',
      projectId: cleanedProjectId,
      users: cachedUsers,
      rawPages: [],
      endpoint,
      note: 'Se reutilizo user_cache local sin reenviar la carga completa al modelo.'
    };
  }

  const actingUserId = isLikelyActingUserId(args.actingUserId)
    ? args.actingUserId!.trim()
    : env.apsUserId;
  const products = normalizeProducts(args.products);
  const region = args.region?.trim() || undefined;
  const preferredAuth = await getAccountReadAccessToken();
  const rawPages: unknown[] = [];

  try {
    const users = await getProjectUsers(preferredAuth.token, projectId, {
      ...(actingUserId ? { actingUserId } : {}),
      ...(products ? { products } : {}),
      ...(region ? { region } : {}),
      onPage: (payload) => rawPages.push(payload)
    });
    replaceUsersCache(cleanedProjectId, users);
    return {
      authMode: preferredAuth.authMode,
      projectId: cleanedProjectId,
      users,
      rawPages,
      endpoint,
      ...(preferredAuth.note ? { note: preferredAuth.note } : {})
    };
  } catch (error) {
    if (preferredAuth.authMode !== '3legged') {
      throw error;
    }

    warnLog('projectUsers', 'Fallo con 3-legged; se intenta fallback 2-legged', {
      message: error instanceof Error ? error.message : String(error),
      projectId: cleanedProjectId
    });

    const fallbackRawPages: unknown[] = [];
    const fallbackToken = await get2LeggedToken(['account:read']);
    const users = await getProjectUsers(fallbackToken, projectId, {
      ...(actingUserId ? { actingUserId } : {}),
      ...(products ? { products } : {}),
      ...(region ? { region } : {}),
      onPage: (payload) => fallbackRawPages.push(payload)
    });
    replaceUsersCache(cleanedProjectId, users);
    return {
      authMode: '2legged',
      projectId: cleanedProjectId,
      users,
      rawPages: fallbackRawPages,
      endpoint,
      note: 'Se uso fallback 2-legged controlado para no romper project users.'
    };
  }
}
