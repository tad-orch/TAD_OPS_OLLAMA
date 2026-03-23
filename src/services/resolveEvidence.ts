import { getSessionContext } from '../db/repositories/contextRepo.js';
import {
  getLatestUsableSnapshot,
  listRecentSnapshots
} from '../db/repositories/snapshotRegistryRepo.js';
import { getFreshProjectsFromCache } from '../db/repositories/projectCacheRepo.js';
import { getFreshUsersFromCache } from '../db/repositories/userCacheRepo.js';
import { isMysqlConfigured, getMysqlPool } from '../shared/db/mysql.js';
import type { EvidenceSummary, TurnAnalysis } from '../types/agent.js';
import { env } from '../config/env.js';

const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;
const USERS_CACHE_TTL_MS = 10 * 60 * 1000;

async function hasCanonicalRows(tableName: string, whereSql: string, params: unknown[]): Promise<boolean> {
  if (!isMysqlConfigured()) {
    return false;
  }

  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT 1 AS present FROM ${tableName} ${whereSql} LIMIT 1`,
    params
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function resolveEvidence(
  sessionId: string,
  analysis: TurnAnalysis
): Promise<EvidenceSummary> {
  const sessionContext = getSessionContext(sessionId);
  const currentProjectId =
    analysis.plan.entities.projectId ??
    sessionContext?.current_project_id ??
    sessionContext?.memory_json.lastResolvedProjectId;
  const currentProjectName =
    analysis.plan.entities.projectName ??
    sessionContext?.current_project_name ??
    sessionContext?.memory_json.lastResolvedProjectName;
  const currentProjectAliases = sessionContext?.memory_json.currentProjectAliases ?? [];
  const recentSnapshots = listRecentSnapshots(sessionId, 8);
  const usableSnapshot = analysis.domain
    ? getLatestUsableSnapshot(sessionId, analysis.domain, currentProjectId, {
        allowEmptySnapshot: true
      })
    : undefined;
  const hasProjectEvidence =
    getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS)?.length !== undefined ||
    (sessionContext?.memory_json.recentProjects?.length ?? 0) > 0;
  const hasUserEvidence = currentProjectId
    ? Boolean(getFreshUsersFromCache(currentProjectId, USERS_CACHE_TTL_MS))
    : false;

  const canonicalTableByDomain = {
    projects: 'canonical_projects',
    users: 'canonical_users',
    issues: 'canonical_issues',
    rfis: 'canonical_rfis',
    submittals: 'canonical_submittals',
    transmittals: 'canonical_transmittals'
  } as const;

  let hasCanonicalEvidence = false;
  if (analysis.domain) {
    const tableName = canonicalTableByDomain[analysis.domain];
    if (analysis.domain === 'projects') {
      hasCanonicalEvidence = await hasCanonicalRows(
        tableName,
        'WHERE account_id = ?',
        [env.apsAccountId]
      );
    } else if (analysis.domain === 'users' && currentProjectId) {
      hasCanonicalEvidence = await hasCanonicalRows(
        tableName,
        'WHERE project_id = ?',
        [currentProjectId]
      );
    } else if (currentProjectId) {
      hasCanonicalEvidence = await hasCanonicalRows(
        tableName,
        'WHERE project_id = ?',
        [currentProjectId]
      );
    }
  }

  const hasChunkEvidence = Boolean(
    usableSnapshot?.metadata?.statusCounts ||
      usableSnapshot?.metadata?.companyCounts ||
      usableSnapshot?.metadata?.prefixes
  );

  const authMode = sessionContext?.memory_json.authMode;
  const authReadyForConstructionEndpoints = sessionContext?.memory_json.authReadyForConstructionEndpoints;
  const needsConstructionAuth = analysis.needsConstructionAuth;

  const evidenceSufficientForLocalAnswer = Boolean(
    usableSnapshot || (analysis.domain === 'projects' && hasCanonicalEvidence) || (analysis.domain === 'users' && hasCanonicalEvidence)
  );

  const reason = usableSnapshot
    ? `snapshot utilizable encontrado para ${analysis.domain}`
    : hasCanonicalEvidence
      ? `evidencia canónica disponible para ${analysis.domain}`
      : analysis.domain
        ? `sin evidencia suficiente aún para ${analysis.domain}`
        : 'sin dominio estructurado claro';

  return {
    ...(analysis.domain ? { domain: analysis.domain } : {}),
    ...(currentProjectId ? { currentProjectId } : {}),
    ...(currentProjectName ? { currentProjectName } : {}),
    currentProjectAliases,
    hasUsableSnapshot: Boolean(usableSnapshot),
    ...(usableSnapshot ? { usableSnapshot } : {}),
    recentSnapshots,
    hasCanonicalEvidence,
    hasChunkEvidence,
    hasProjectEvidence,
    hasUserEvidence,
    ...(authMode ? { authMode } : {}),
    ...(authReadyForConstructionEndpoints !== undefined
      ? { authReadyForConstructionEndpoints }
      : {}),
    needsConstructionAuth,
    evidenceSufficientForLocalAnswer,
    reason
  };
}
