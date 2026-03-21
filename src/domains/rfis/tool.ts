import type { Tool } from 'ollama';
import { getValidAccessToken } from '../../services/apsUserAuth.js';
import type { GetProjectRfisToolArgs, GetProjectRfisToolResult } from '../../types/aps.js';
import { summarizeProjectScopedReadForModel } from '../../utils/summarize.js';
import { listProjectRfis } from './service.js';

export const getProjectRfisToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_project_rfis',
    description: 'Lista RFIs de un proyecto ACC en modo solo lectura.',
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
          description: 'Texto opcional para filtrar por id, título, tipo, asignado o ubicación.'
        }
      }
    }
  }
};

export async function getProjectRfisTool(
  args: GetProjectRfisToolArgs
): Promise<GetProjectRfisToolResult> {
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error('get_project_rfis requiere projectId');
  }

  const token = await getValidAccessToken();
  const response = await listProjectRfis(token, projectId, {
    ...(args.status?.trim() ? { status: args.status.trim() } : {}),
    ...(args.search?.trim() ? { search: args.search.trim() } : {})
  });

  return summarizeProjectScopedReadForModel(
    response.projectId,
    response.items,
    response.source
  );
}
