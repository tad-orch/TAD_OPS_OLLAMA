import { db } from '../sqlite.js';
import type {
  ProjectLifecycle,
  SessionSnapshotResource,
  SnapshotDomain,
  SnapshotEntityType,
  SnapshotMetadata,
  SnapshotRegistry
} from '../../types/agent.js';
import type {
  ApsProject,
  ApsProjectUser,
  GetProjectUsersToolResult,
  ProjectScopedReadItemBase,
  ProjectScopedReadToolResult
} from '../../types/aps.js';
import { createEntityId, nowIso } from '../../utils/ids.js';

type RuntimeContextRow = {
  session_id: string;
  context_kind: string;
  context_json: string;
  updated_at: string;
};

const SNAPSHOT_REGISTRY_KIND = 'snapshot_registry';
const MAX_SESSION_SNAPSHOTS = 24;
const DEFAULT_USABLE_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

function getRuntimeContextRow(sessionId: string, contextKind: string): RuntimeContextRow | undefined {
  return db
    .prepare(
      `
      SELECT session_id, context_kind, context_json, updated_at
      FROM runtime_context
      WHERE session_id = ? AND context_kind = ?
      `
    )
    .get(sessionId, contextKind) as RuntimeContextRow | undefined;
}

function upsertRuntimeContext(sessionId: string, contextKind: string, contextJson: unknown): void {
  db.prepare(
    `
    INSERT INTO runtime_context (session_id, context_kind, context_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      context_kind = excluded.context_kind,
      context_json = excluded.context_json,
      updated_at = excluded.updated_at
    `
  ).run(sessionId, contextKind, JSON.stringify(contextJson), nowIso());
}

function readRegistry(sessionId: string): SnapshotRegistry {
  const row = getRuntimeContextRow(sessionId, SNAPSHOT_REGISTRY_KIND);
  if (!row?.context_json) {
    return {
      snapshots: [],
      updatedAt: nowIso()
    };
  }

  try {
    const parsed = JSON.parse(row.context_json) as SnapshotRegistry;
    return {
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : row.updated_at
    };
  } catch {
    return {
      snapshots: [],
      updatedAt: row.updated_at
    };
  }
}

function writeRegistry(sessionId: string, registry: SnapshotRegistry): SnapshotRegistry {
  const nextRegistry: SnapshotRegistry = {
    snapshots: registry.snapshots.slice(0, MAX_SESSION_SNAPSHOTS),
    updatedAt: nowIso()
  };
  upsertRuntimeContext(sessionId, SNAPSHOT_REGISTRY_KIND, nextRegistry);
  return nextRegistry;
}

function upsertSnapshot(sessionId: string, snapshot: SessionSnapshotResource): SnapshotRegistry {
  const current = readRegistry(sessionId);
  const deduped = current.snapshots.filter((item) => {
    if (item.domain !== snapshot.domain) {
      return true;
    }

    if ((item.projectId ?? '') !== (snapshot.projectId ?? '')) {
      return true;
    }

    return (item.projectName ?? '') !== (snapshot.projectName ?? '');
  });

  return writeRegistry(sessionId, {
    snapshots: [snapshot, ...deduped],
    updatedAt: nowIso()
  });
}

function getProjectLifecycle(project: Pick<ApsProject, 'status'>): ProjectLifecycle {
  const normalizedStatus = project.status?.trim().toLowerCase();
  if (!normalizedStatus) {
    return 'unknown';
  }

  if (normalizedStatus.includes('archiv') || normalizedStatus.includes('inactive')) {
    return 'archived';
  }

  if (normalizedStatus === 'active' || normalizedStatus.includes('activ')) {
    return 'active';
  }

  return 'unknown';
}

function countByStatus(items: Array<{ status?: string | undefined }>): Record<string, number> | undefined {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const key = item.status?.trim() || 'sin estado';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return Object.keys(counts).length > 0 ? counts : undefined;
}

function countByCompany(items: ApsProjectUser[]): Record<string, number> | undefined {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const key = item.companyName?.trim() || 'Sin empresa';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return Object.keys(counts).length > 0 ? counts : undefined;
}

function getProjectPrefixes(projects: ApsProject[]): string[] {
  const prefixes = new Set<string>();
  for (const project of projects) {
    const match = project.name.trim().match(/^([A-Za-z0-9]{2,})/);
    if (match?.[1]) {
      prefixes.add(match[1].toUpperCase());
    }
  }

  return [...prefixes].slice(0, 12);
}

function buildCanonicalIds(
  items: Array<Record<string, unknown>>,
  preferredKeys: string[]
): string[] | undefined {
  const ids = items
    .map((item) => {
      for (const key of preferredKeys) {
        const value = item[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }

      return undefined;
    })
    .filter((value): value is string => Boolean(value));

  return ids.length > 0 ? ids.slice(0, 50) : undefined;
}

function createSnapshot(params: {
  sessionId: string;
  domain: SnapshotDomain;
  entityType: SnapshotEntityType;
  itemCount: number;
  projectId?: string;
  projectName?: string;
  rawDocumentIds?: string[];
  canonicalIds?: string[];
  metadata?: SnapshotMetadata;
  confidence?: number;
  freshnessMs?: number;
}): SessionSnapshotResource {
  return {
    id: createEntityId('snap'),
    sessionId: params.sessionId,
    domain: params.domain,
    entityType: params.entityType,
    fetchedAt: nowIso(),
    itemCount: params.itemCount,
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.projectName ? { projectName: params.projectName } : {}),
    ...(params.rawDocumentIds?.length ? { rawDocumentIds: params.rawDocumentIds } : {}),
    ...(params.canonicalIds?.length ? { canonicalIds: params.canonicalIds } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.confidence !== undefined ? { confidence: params.confidence } : {}),
    ...(params.freshnessMs !== undefined ? { freshnessMs: params.freshnessMs } : {})
  };
}

export function getSnapshotRegistry(sessionId: string): SnapshotRegistry {
  return readRegistry(sessionId);
}

export function saveSnapshot(
  sessionId: string,
  snapshot: SessionSnapshotResource
): SnapshotRegistry {
  return upsertSnapshot(sessionId, snapshot);
}

export function listRecentSnapshots(sessionId: string, limit = MAX_SESSION_SNAPSHOTS): SessionSnapshotResource[] {
  return readRegistry(sessionId).snapshots.slice(0, Math.max(1, limit));
}

export function getLatestSnapshot(
  sessionId: string,
  domain: SnapshotDomain
): SessionSnapshotResource | undefined {
  return readRegistry(sessionId).snapshots.find((snapshot) => snapshot.domain === domain);
}

export function getSnapshotForDomainAndProject(
  sessionId: string,
  domain: SnapshotDomain,
  projectId: string
): SessionSnapshotResource | undefined {
  const normalizedProjectId = projectId.replace(/^b\./, '');
  return readRegistry(sessionId).snapshots.find(
    (snapshot) => snapshot.domain === domain && snapshot.projectId === normalizedProjectId
  );
}

export function getLatestUsableSnapshot(
  sessionId: string,
  domain: SnapshotDomain,
  projectId?: string,
  options: {
    maxAgeMs?: number;
    allowEmptySnapshot?: boolean;
    minConfidence?: number;
  } = {}
): SessionSnapshotResource | undefined {
  const registry = readRegistry(sessionId);
  const normalizedProjectId = projectId?.replace(/^b\./, '');
  const now = Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_USABLE_SNAPSHOT_MAX_AGE_MS;
  const minConfidence = options.minConfidence ?? 0.4;

  return registry.snapshots.find((snapshot) => {
    if (snapshot.domain !== domain) {
      return false;
    }

    if (!normalizedProjectId) {
      const ageMs = now - new Date(snapshot.fetchedAt).getTime();
      const confidence = snapshot.confidence ?? 0.8;
      if (ageMs > maxAgeMs || confidence < minConfidence) {
        return false;
      }

      return options.allowEmptySnapshot === true ? snapshot.itemCount >= 0 : snapshot.itemCount > 0;
    }

    if (snapshot.projectId !== normalizedProjectId) {
      return false;
    }

    const ageMs = now - new Date(snapshot.fetchedAt).getTime();
    const confidence = snapshot.confidence ?? 0.8;
    if (ageMs > maxAgeMs || confidence < minConfidence) {
      return false;
    }

    return options.allowEmptySnapshot === true ? snapshot.itemCount >= 0 : snapshot.itemCount > 0;
  });
}

export function registerProjectsSnapshot(
  sessionId: string,
  projects: ApsProject[]
): SnapshotRegistry {
  const lifecycleCounts = projects.reduce<Record<string, number>>((acc, project) => {
    const lifecycle = getProjectLifecycle(project);
    acc[lifecycle] = (acc[lifecycle] ?? 0) + 1;
    return acc;
  }, {});

  return upsertSnapshot(
    sessionId,
    createSnapshot({
      sessionId,
      domain: 'projects',
      entityType: 'project',
      itemCount: projects.length,
      ...(() => {
        const canonicalIds = buildCanonicalIds(projects as Array<Record<string, unknown>>, ['id']);
        return canonicalIds ? { canonicalIds } : {};
      })(),
      metadata: {
        lifecycleCounts,
        statusCounts: countByStatus(projects),
        prefixes: getProjectPrefixes(projects),
        source: 'tool:get_projects_by_account'
      },
      confidence: 0.95,
      freshnessMs: 0
    })
  );
}

export function registerUsersSnapshot(
  sessionId: string,
  result: GetProjectUsersToolResult,
  projectName?: string
): SnapshotRegistry {
  return upsertSnapshot(
    sessionId,
    createSnapshot({
      sessionId,
      domain: 'users',
      entityType: 'user',
      itemCount: result.count,
      projectId: result.projectId.replace(/^b\./, ''),
      ...(projectName ? { projectName } : {}),
      ...(() => {
        const canonicalIds = buildCanonicalIds(result.users as Array<Record<string, unknown>>, ['id', 'email']);
        return canonicalIds ? { canonicalIds } : {};
      })(),
      metadata: {
        companyCounts: countByCompany(result.users),
        statusCounts: countByStatus(result.users),
        source: 'tool:get_project_users'
      },
      confidence: 0.95,
      freshnessMs: 0
    })
  );
}

export function registerProjectScopedReadSnapshot<TItem extends ProjectScopedReadItemBase>(
  sessionId: string,
  params: {
    domain: Exclude<SnapshotDomain, 'projects' | 'users'>;
    entityType: Exclude<SnapshotEntityType, 'project' | 'user'>;
    result: ProjectScopedReadToolResult<TItem>;
    projectName?: string;
  }
): SnapshotRegistry {
  return upsertSnapshot(
    sessionId,
    createSnapshot({
      sessionId,
      domain: params.domain,
      entityType: params.entityType,
      itemCount: params.result.total,
      projectId: params.result.projectId.replace(/^b\./, ''),
      ...(params.projectName ? { projectName: params.projectName } : {}),
      ...(() => {
        const canonicalIds = buildCanonicalIds(params.result.items as Array<Record<string, unknown>>, [
          'issueId',
          'rfiId',
          'submittalId',
          'transmittalId',
          'id'
        ]);
        return canonicalIds ? { canonicalIds } : {};
      })(),
      metadata: {
        statusCounts: countByStatus(params.result.items),
        source: params.result.source
      },
      confidence: 0.9,
      freshnessMs: 0
    })
  );
}
