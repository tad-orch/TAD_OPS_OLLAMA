import { getProjectsByAccountTool } from '../domains/acc/account-admin/projects/tool.js';
import { getProjectUsersTool } from '../domains/acc/account-admin/project-users/tool.js';
import { getProjectIssuesTool } from '../domains/acc/issues/tool.js';
import { getProjectRfisTool } from '../domains/acc/rfis/tool.js';
import { getProjectSubmittalsTool } from '../domains/acc/submittals/tool.js';
import { getProjectTransmittalsTool } from '../domains/acc/transmittals/tool.js';
import { resolveProject } from './projectResolver.js';

export async function syncDomain(input: {
  domain: 'projects' | 'users' | 'issues' | 'rfis' | 'submittals' | 'transmittals';
  projectId?: string | undefined;
  projectQuery?: string | undefined;
  sessionId?: string | undefined;
}): Promise<{
  synced: boolean;
  count: number;
  projectId?: string | undefined;
}> {
  if (input.domain === 'projects') {
    const result = await getProjectsByAccountTool({});
    return {
      synced: true,
      count: result.count
    };
  }

  let projectId = input.projectId;
  if (!projectId && input.projectQuery) {
    const resolved = await resolveProject({
      query: input.projectQuery,
      sessionId: input.sessionId,
      limit: 1
    });
    projectId = resolved[0]?.projectId;
  }

  if (!projectId) {
    throw new Error(`sync_domain requiere projectId o projectQuery para ${input.domain}`);
  }

  if (input.domain === 'users') {
    const result = await getProjectUsersTool({ projectId });
    return { synced: true, count: result.count, projectId };
  }

  if (input.domain === 'issues') {
    const result = await getProjectIssuesTool({ projectId });
    return { synced: true, count: result.total, projectId };
  }

  if (input.domain === 'rfis') {
    const result = await getProjectRfisTool({ projectId });
    return { synced: true, count: result.total, projectId };
  }

  if (input.domain === 'submittals') {
    const result = await getProjectSubmittalsTool({ projectId });
    return { synced: true, count: result.total, projectId };
  }

  const result = await getProjectTransmittalsTool({ projectId });
  return { synced: true, count: result.total, projectId };
}
