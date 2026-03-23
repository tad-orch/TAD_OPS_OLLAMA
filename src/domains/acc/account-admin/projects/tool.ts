import type { Tool } from 'ollama';
import { env } from '../../../../config/env.js';
import { persistProjectsHybridSnapshot } from '../../../../shared/storage/hybridPersistence.js';
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
  await persistProjectsHybridSnapshot({
    accountId: env.apsAccountId,
    endpoint: response.endpoint,
    requestContext: {
      actingUserId: args.actingUserId ?? env.apsUserId,
      authMode: response.authMode
    },
    rawPages: response.rawPages,
    projects: response.projects
  });
  const summarized = summarizeProjectsForModel(response.projects);

  return {
    ...summarized,
    ...((response.note ?? summarized.note) ? { note: response.note ?? summarized.note } : {})
  };
}
