import type { Tool } from 'ollama';
import { env } from '../config/env.js';
import { getFreshUsersFromCache, replaceUsersCache } from '../db/repositories/userCacheRepo.js';
import { getProjectUsers } from '../services/apsAdmin.js';
import { get2LeggedToken } from '../services/apsAuth.js';
import type { GetProjectUsersToolArgs, GetProjectUsersToolResult } from '../types/aps.js';
import { isLikelyActingUserId } from '../utils/ids.js';
import { summarizeUsersForModel } from '../utils/summarize.js';

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

export const getProjectUsersToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_project_users',
    description: 'Lista los usuarios de un proyecto ACC usando APS Account Admin.',
    parameters: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID del proyecto. Si viene con prefijo b., el sistema lo limpia.'
        },
        products: {
          type: ['string', 'array'],
          description: 'Filtro opcional por productos. Puede ser string CSV o array de strings.',
          items: {
            type: 'string'
          }
        },
        region: {
          type: 'string',
          description: 'Region opcional para el header Region.'
        },
        actingUserId: {
          type: 'string',
          description: 'User-Id opcional para impersonation. Si no viene, se usa APS_USER_ID.'
        }
      }
    }
  }
};

export async function getProjectUsersTool(
  args: GetProjectUsersToolArgs
): Promise<GetProjectUsersToolResult> {
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error('get_project_users requiere projectId');
  }

  const cleanedProjectId = projectId.replace(/^b\./, '');
  const cachedUsers = getFreshUsersFromCache(cleanedProjectId, USERS_CACHE_TTL_MS);
  if (cachedUsers) {
    return summarizeUsersForModel(cleanedProjectId, cachedUsers);
  }

  const token = await get2LeggedToken();
  const actingUserId = isLikelyActingUserId(args.actingUserId)
    ? args.actingUserId!.trim()
    : env.apsUserId;
  const products = normalizeProducts(args.products);
  const region = args.region?.trim() || undefined;

  const users = await getProjectUsers(token, projectId, {
    ...(actingUserId ? { actingUserId } : {}),
    ...(products ? { products } : {}),
    ...(region ? { region } : {})
  });

  const summarizedUsers = summarizeUsersForModel(cleanedProjectId, users);

  try {
    replaceUsersCache(cleanedProjectId, users);
    return summarizedUsers;
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'No se pudo guardar user_cache';
    console.warn(`[getProjectUsersTool] Warning al guardar cache para ${cleanedProjectId}: ${warning}`);

    return {
      ...summarizedUsers,
      note: summarizedUsers.note
        ? `${summarizedUsers.note} Warning: no se pudo actualizar user_cache.`
        : 'Warning: APS devolvió usuarios correctamente, pero no se pudo actualizar user_cache.'
    };
  }
}
