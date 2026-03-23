import type { Tool } from 'ollama';
import { getValidAccessToken } from '../../../services/apsUserAuth.js';
import { persistSubmittalsHybridSnapshot } from '../../../shared/storage/hybridPersistence.js';
import { replaceProjectScopedReadCache } from '../../../shared/storage/projectScopedReadCacheRepo.js';
import type {
  GetProjectSubmittalsToolArgs,
  GetProjectSubmittalsToolResult
} from '../../../types/aps.js';
import { summarizeProjectScopedReadForModel } from '../../../utils/summarize.js';
import { listProjectSubmittals } from './service.js';

export const getProjectSubmittalsToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_project_submittals',
    description: 'Lista submittals de un proyecto ACC en modo solo lectura.',
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
          description: 'Texto opcional para filtrar por id, titulo, tipo, respuesta, spec o responsables.'
        }
      }
    }
  }
};

export async function getProjectSubmittalsTool(
  args: GetProjectSubmittalsToolArgs
): Promise<GetProjectSubmittalsToolResult> {
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error('get_project_submittals requiere projectId');
  }

  const token = await getValidAccessToken();
  const response = await listProjectSubmittals(token, projectId, {
    ...(args.status?.trim() ? { status: args.status.trim() } : {}),
    ...(args.search?.trim() ? { search: args.search.trim() } : {})
  });
  await persistSubmittalsHybridSnapshot({
    projectId: response.projectId,
    endpoint: response.endpoint,
    requestContext: {
      status: args.status,
      search: args.search
    },
    rawPages: response.rawPages,
    items: response.items
  });
  replaceProjectScopedReadCache('submittal_cache', response.projectId, response.items);

  return summarizeProjectScopedReadForModel(
    response.projectId,
    response.items,
    response.source
  );
}
