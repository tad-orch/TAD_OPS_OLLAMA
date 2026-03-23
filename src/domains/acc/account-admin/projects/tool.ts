import type { Tool } from 'ollama';
import type { GetProjectsToolArgs, GetProjectsToolResult } from '../../../../types/aps.js';
import { summarizeProjectsForModel } from '../../../../utils/summarize.js';
import { listAccountProjects } from './service.js';

export const getProjectsToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_projects_by_account',
    description:
      'Lista los proyectos del account ACC configurado usando auth global 3-legged como modo dominante y fallback controlado.',
    parameters: {
      type: 'object',
      properties: {
        actingUserId: {
          type: 'string',
          description: 'User-Id opcional para compatibilidad controlada con endpoints heredados.'
        }
      }
    }
  }
};

export async function getProjectsByAccountTool(
  args: GetProjectsToolArgs = {}
): Promise<GetProjectsToolResult> {
  const response = await listAccountProjects(args);
  const summarized = summarizeProjectsForModel(response.projects);

  return {
    ...summarized,
    ...((response.note ?? summarized.note) ? { note: response.note ?? summarized.note } : {})
  };
}
