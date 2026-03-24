import { getProjectsByAccountTool } from '../domains/acc/account-admin/projects/tool.js';
import { getProjectUsersTool } from '../domains/acc/account-admin/project-users/tool.js';
import { getProjectIssuesTool } from '../domains/acc/issues/tool.js';
import { getProjectRfisTool } from '../domains/acc/rfis/tool.js';
import { getProjectSubmittalsTool } from '../domains/acc/submittals/tool.js';
import { getProjectTransmittalsTool } from '../domains/acc/transmittals/tool.js';
import { startAccUserLogin } from '../services/apsUserAuth.js';
import { getConstructionAuthStatus } from '../services/apsUserAuth.js';
import { readServiceResource } from './resources.js';
import { resolveProject } from './projectResolver.js';
import { queryCanonical } from './queryCanonical.js';
import { syncDomain } from './syncService.js';
import type { ServiceResponse } from './types.js';

function success<TData>(
  operation: string,
  data: TData,
  meta: ServiceResponse<TData>['meta']
): ServiceResponse<TData> {
  return {
    ok: true,
    operation,
    data,
    meta
  };
}

function failure(
  operation: string,
  message: string,
  code = 'SERVICE_ERROR',
  meta: ServiceResponse['meta'] = { source: 'service_resource' }
): ServiceResponse {
  return {
    ok: false,
    operation,
    meta,
    error: {
      code,
      message
    }
  };
}

async function requireProjectId(input: {
  projectId?: unknown;
  projectQuery?: unknown;
  sessionId?: unknown;
}): Promise<{ projectId: string; confidence: number }> {
  if (typeof input.projectId === 'string' && input.projectId.trim()) {
    return {
      projectId: input.projectId.trim(),
      confidence: 1
    };
  }

  if (typeof input.projectQuery === 'string' && input.projectQuery.trim()) {
    const resolved = await resolveProject({
      query: input.projectQuery.trim(),
      sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
      limit: 1
    });
    const match = resolved[0];
    if (match) {
      return {
        projectId: match.projectId,
        confidence: match.confidence
      };
    }
  }

  throw new Error('No pude resolver un projectId valido.');
}

export async function executeServiceOperation(
  operation: string,
  input: Record<string, unknown> = {}
): Promise<ServiceResponse> {
  try {
    if (operation === 'get_projects') {
      const result = await getProjectsByAccountTool({});
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: 'projects',
        freshness: 'fresh'
      });
    }

    if (operation === 'get_project_users') {
      const resolved = await requireProjectId(input);
      const result = await getProjectUsersTool({ projectId: resolved.projectId });
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: 'users',
        projectId: resolved.projectId,
        confidence: resolved.confidence,
        freshness: 'fresh'
      });
    }

    if (operation === 'get_issues') {
      const resolved = await requireProjectId(input);
      const result = await getProjectIssuesTool({ projectId: resolved.projectId });
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: 'issues',
        projectId: resolved.projectId,
        confidence: resolved.confidence,
        freshness: 'fresh'
      });
    }

    if (operation === 'get_rfis') {
      const resolved = await requireProjectId(input);
      const result = await getProjectRfisTool({ projectId: resolved.projectId });
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: 'rfis',
        projectId: resolved.projectId,
        confidence: resolved.confidence,
        freshness: 'fresh'
      });
    }

    if (operation === 'get_submittals') {
      const resolved = await requireProjectId(input);
      const result = await getProjectSubmittalsTool({ projectId: resolved.projectId });
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: 'submittals',
        projectId: resolved.projectId,
        confidence: resolved.confidence,
        freshness: 'fresh'
      });
    }

    if (operation === 'get_transmittals') {
      const resolved = await requireProjectId(input);
      const result = await getProjectTransmittalsTool({ projectId: resolved.projectId });
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: 'transmittals',
        projectId: resolved.projectId,
        confidence: resolved.confidence,
        freshness: 'fresh'
      });
    }

    if (operation === 'resolve_project') {
      const result = await resolveProject({
        query: typeof input.query === 'string' ? input.query : undefined,
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
        limit: typeof input.limit === 'number' ? input.limit : undefined
      });
      return success(operation, result, {
        source: result[0]?.source === 'canonical_mysql' ? 'canonical_mysql' : 'service_resource',
        domain: 'projects',
        confidence: result[0]?.confidence
      });
    }

    if (operation === 'query_canonical') {
      if (typeof input.domain !== 'string') {
        return failure(operation, 'query_canonical requiere domain.', 'INVALID_INPUT');
      }

      const result = await queryCanonical({
        domain: input.domain as never,
        ...(typeof input.projectId === 'string' ? { projectId: input.projectId } : {}),
        ...(input.filters && typeof input.filters === 'object' ? { filters: input.filters as Record<string, string | number | boolean> } : {}),
        ...(typeof input.groupBy === 'string' ? { groupBy: input.groupBy } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(input.sort && typeof input.sort === 'object' ? { sort: input.sort as { field: string; direction?: 'asc' | 'desc' } } : {})
      });
      return success(operation, result, {
        source: 'canonical_mysql',
        domain: String(input.domain),
        ...(typeof input.projectId === 'string' ? { projectId: input.projectId } : {}),
        freshness: 'cached'
      });
    }

    if (operation === 'get_auth_status') {
      const result = await getConstructionAuthStatus();
      return success(operation, result, {
        source: 'auth_local',
        domain: 'auth'
      });
    }

    if (operation === 'start_auth') {
      const result = await startAccUserLogin();
      return success(operation, result, {
        source: 'auth_local',
        domain: 'auth'
      });
    }

    if (operation === 'sync_domain') {
      if (typeof input.domain !== 'string') {
        return failure(operation, 'sync_domain requiere domain.', 'INVALID_INPUT');
      }

      const result = await syncDomain({
        domain: input.domain as never,
        ...(typeof input.projectId === 'string' ? { projectId: input.projectId } : {}),
        ...(typeof input.projectQuery === 'string' ? { projectQuery: input.projectQuery } : {}),
        ...(typeof input.sessionId === 'string' ? { sessionId: input.sessionId } : {})
      });
      return success(operation, result, {
        source: 'acc_api_fresh',
        domain: String(input.domain),
        ...(result.projectId ? { projectId: result.projectId } : {}),
        freshness: 'fresh'
      });
    }

    if (operation === 'get_resource') {
      if (typeof input.resource !== 'string') {
        return failure(operation, 'get_resource requiere resource.', 'INVALID_INPUT');
      }

      const result = await readServiceResource({
        resource: input.resource as never,
        ...(typeof input.sessionId === 'string' ? { sessionId: input.sessionId } : {})
      });
      return success(operation, result, {
        source: 'service_resource',
        domain: typeof input.resource === 'string' ? input.resource : undefined
      });
    }

    return failure(operation, `Operacion no soportada: ${operation}`, 'UNKNOWN_OPERATION');
  } catch (error) {
    return failure(
      operation,
      error instanceof Error ? error.message : 'Fallo ejecutando operacion',
      'OPERATION_FAILED'
    );
  }
}
