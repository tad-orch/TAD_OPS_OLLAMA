import type { Tool } from 'ollama';
import { getValidAccessToken } from '../../../services/apsUserAuth.js';
import { persistTransmittalsHybridSnapshot } from '../../../shared/storage/hybridPersistence.js';
import { replaceProjectScopedReadCache } from '../../../shared/storage/projectScopedReadCacheRepo.js';
import type {
  GetProjectTransmittalsToolArgs,
  GetProjectTransmittalsToolResult
} from '../../../types/aps.js';
import { summarizeProjectScopedReadForModel } from '../../../utils/summarize.js';
import { listProjectTransmittals } from './service.js';

export const getProjectTransmittalsToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_project_transmittals',
    description: 'Lista transmittals de un proyecto ACC en modo solo lectura.',
    parameters: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID del proyecto. Si viene con prefijo b., el sistema lo limpia.'
        },
        status: {
          type: 'string',
          description: 'Filtro opcional por estado.'
        },
        search: {
          type: 'string',
          description: 'Texto opcional para filtrar por id, numero, titulo o creador.'
        }
      }
    }
  }
};

export async function getProjectTransmittalsTool(
  args: GetProjectTransmittalsToolArgs
): Promise<GetProjectTransmittalsToolResult> {
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error('get_project_transmittals requiere projectId');
  }

  const token = await getValidAccessToken();
  const response = await listProjectTransmittals(token, projectId, {
    ...(args.status?.trim() ? { status: args.status.trim() } : {}),
    ...(args.search?.trim() ? { search: args.search.trim() } : {})
  });
  await persistTransmittalsHybridSnapshot({
    projectId: response.projectId,
    endpoint: response.endpoint,
    requestContext: {
      status: args.status,
      search: args.search
    },
    rawPages: response.rawPages,
    items: response.items
  });
  replaceProjectScopedReadCache('transmittal_cache', response.projectId, response.items);

  return summarizeProjectScopedReadForModel(
    response.projectId,
    response.items,
    response.source
  );
}
