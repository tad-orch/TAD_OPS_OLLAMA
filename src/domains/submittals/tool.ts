import type { Tool } from 'ollama';
import { getAccUserReadToken } from '../../services/apsAuth.js';
import type {
  GetProjectSubmittalsToolArgs,
  GetProjectSubmittalsToolResult
} from '../../types/aps.js';
import { summarizeProjectScopedReadForModel } from '../../utils/summarize.js';
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
          description: 'Texto opcional para filtrar por id, título, tipo, respuesta, spec o responsables.'
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

  const token = await getAccUserReadToken();
  const response = await listProjectSubmittals(token, projectId, {
    ...(args.status?.trim() ? { status: args.status.trim() } : {}),
    ...(args.search?.trim() ? { search: args.search.trim() } : {})
  });

  return summarizeProjectScopedReadForModel(
    response.projectId,
    response.items,
    response.source
  );
}
