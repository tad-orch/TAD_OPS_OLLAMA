import type { Tool } from 'ollama';
import { env } from '../../../config/env.js';
import { persistProjectsHybridSnapshot } from '../../../shared/storage/hybridPersistence.js';
import type { GetDmProjectsToolArgs, GetDmProjectsToolResult } from '../../../types/aps.js';
import { summarizeDmProjectsForModel } from '../../../utils/summarize.js';
import { listHubProjects } from './service.js';

export const getDataManagementProjectsToolDefinition: Tool = {
  type: 'function',
  function: {
    name: 'get_data_management_projects',
    description:
      'Lista proyectos de un hub en APS Data Management usando auth global 3-legged como modo dominante.',
    parameters: {
      type: 'object',
      properties: {
        hubId: {
          type: 'string',
          description: 'Hub ID. Si no viene, se usa APS_HUB_ID cuando exista.'
        }
      }
    }
  }
};

export async function getDataManagementProjectsTool(
  args: GetDmProjectsToolArgs = {}
): Promise<GetDmProjectsToolResult> {
  const response = await listHubProjects(args.hubId);
  await persistProjectsHybridSnapshot({
    accountId: env.apsAccountId,
    hubId: response.hubId,
    endpoint: response.endpoint,
    requestContext: {
      hubId: args.hubId ?? env.apsHubId
    },
    rawPages: response.rawPages,
    projects: response.projects
  });
  const summarized = summarizeDmProjectsForModel(response.hubId, response.projects);

  return {
    ...summarized,
    ...((response.note ?? summarized.note) ? { note: response.note ?? summarized.note } : {})
  };
}
