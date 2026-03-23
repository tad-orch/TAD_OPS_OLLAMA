import { env } from '../../../../config/env.js';
import { getFreshProjectsFromCache, replaceProjectsCache } from '../../../../db/repositories/projectCacheRepo.js';
import { getProjects } from '../../../../services/apsAdmin.js';
import { get2LeggedToken } from '../../../../services/apsAuth.js';
import type { ApsProject, AuthMode, GetProjectsToolArgs } from '../../../../types/aps.js';
import { isLikelyActingUserId } from '../../../../utils/ids.js';
import { getAccountReadAccessToken } from '../../../../shared/auth/apsAuthFacade.js';
import { warnLog } from '../../../../shared/logging/logger.js';

const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;

export type AccountProjectsResponse = {
  authMode: AuthMode;
  projects: ApsProject[];
  rawPages: unknown[];
  endpoint: string;
  note?: string | undefined;
};

export async function listAccountProjects(
  args: GetProjectsToolArgs = {}
): Promise<AccountProjectsResponse> {
  const actingUserId = isLikelyActingUserId(args.actingUserId)
    ? args.actingUserId!.trim()
    : env.apsUserId;

  if (!actingUserId) {
    throw new Error('No hay actingUserId disponible para ejecutar get_projects_by_account');
  }

  const endpoint = `${env.apsBaseUrl}/hq/v1/accounts/${env.apsAccountId}/projects`;
  const cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS);
  if (cachedProjects) {
    return {
      authMode: '3legged',
      projects: cachedProjects,
      rawPages: [],
      endpoint,
      note: 'Se reutilizo project_cache local sin reenviar la carga completa al modelo.'
    };
  }

  const preferredAuth = await getAccountReadAccessToken();
  const rawPages: unknown[] = [];

  try {
    const projects = await getProjects(preferredAuth.token, actingUserId, {
      onPage: (payload) => rawPages.push(payload)
    });
    replaceProjectsCache(env.apsAccountId, projects);
    return {
      authMode: preferredAuth.authMode,
      projects,
      rawPages,
      endpoint,
      ...(preferredAuth.note ? { note: preferredAuth.note } : {})
    };
  } catch (error) {
    if (preferredAuth.authMode !== '3legged') {
      throw error;
    }

    warnLog('accountProjects', 'Fallo con 3-legged; se intenta fallback 2-legged', {
      message: error instanceof Error ? error.message : String(error)
    });

    const fallbackRawPages: unknown[] = [];
    const fallbackToken = await get2LeggedToken(['account:read']);
    const fallbackProjects = await getProjects(fallbackToken, actingUserId, {
      onPage: (payload) => fallbackRawPages.push(payload)
    });
    replaceProjectsCache(env.apsAccountId, fallbackProjects);
    return {
      authMode: '2legged',
      projects: fallbackProjects,
      rawPages: fallbackRawPages,
      endpoint,
      note: 'Se uso fallback 2-legged controlado para no romper projects.'
    };
  }
}
