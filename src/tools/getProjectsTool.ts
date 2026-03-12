import { env } from '../config/env.js';
import { getFreshProjectsFromCache, replaceProjectsCache } from '../db/repositories/projectCacheRepo.js';
import { getProjects } from '../services/apsAdmin.js';
import { get2LeggedToken } from '../services/apsAuth.js';
import type { GetProjectsToolArgs, GetProjectsToolResult } from '../types/aps.js';
import type { Tool } from 'ollama';
import { isLikelyActingUserId } from '../utils/ids.js';
import { summarizeProjectsForModel } from '../utils/summarize.js';

const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;

export const getProjectsToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_projects_by_account',
    description: 'Lista los proyectos del account ACC configurado usando APS 2-legged e impersonation.',
    parameters: {
      type: 'object',
      properties: {
        actingUserId: {
          type: 'string',
          description: 'User-Id opcional para impersonation. Si no viene, se usa APS_USER_ID.'
        }
      }
    }
  }
};

export async function getProjectsByAccountTool(
  args: GetProjectsToolArgs = {}
): Promise<GetProjectsToolResult> {
  const actingUserId = isLikelyActingUserId(args.actingUserId)
    ? args.actingUserId!.trim()
    : env.apsUserId;

  if (!actingUserId) {
    throw new Error('No hay actingUserId disponible para ejecutar get_projects_by_account');
  }

  const cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS);
  if (cachedProjects) {
    return summarizeProjectsForModel(cachedProjects);
  }

  const token = await get2LeggedToken();
  const projects = await getProjects(token, actingUserId);
  replaceProjectsCache(env.apsAccountId, projects);
  return summarizeProjectsForModel(projects);
}
