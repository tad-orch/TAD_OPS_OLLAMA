import type { Tool } from 'ollama';
import type { GetProjectUsersToolArgs, GetProjectUsersToolResult } from '../../../../types/aps.js';
import { summarizeUsersForModel } from '../../../../utils/summarize.js';
import { listProjectUsersForAccountAdmin } from './service.js';

export const getProjectUsersToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_project_users',
    description:
      'Lista usuarios de un proyecto ACC usando auth global 3-legged como modo dominante y fallback controlado.',
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
          description: 'User-Id opcional para compatibilidad controlada con endpoints heredados.'
        }
      }
    }
  }
};

export async function getProjectUsersTool(
  args: GetProjectUsersToolArgs
): Promise<GetProjectUsersToolResult> {
  const response = await listProjectUsersForAccountAdmin(args);
  const summarized = summarizeUsersForModel(response.projectId, response.users);

  return {
    ...summarized,
    ...((response.note ?? summarized.note) ? { note: response.note ?? summarized.note } : {})
  };
}
