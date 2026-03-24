import { env } from '../config/env.js';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { getFreshProjectsFromCache } from '../db/repositories/projectCacheRepo.js';
import { getCurrentWorkingSet } from '../db/repositories/workingSetRepo.js';
import { getMysqlPool, isMysqlConfigured } from '../shared/db/mysql.js';

type ResolveProjectInput = {
  query?: string | undefined;
  sessionId?: string | undefined;
  limit?: number | undefined;
};

export type ResolvedProjectCandidate = {
  projectId: string;
  name: string;
  confidence: number;
  source: 'current_project' | 'working_set' | 'project_cache' | 'canonical_mysql';
};

type ProjectRow = {
  id: string;
  name: string;
  source: ResolvedProjectCandidate['source'];
};

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function scoreProjectMatch(projectName: string, query: string): number {
  const normalizedName = normalize(projectName);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedName === normalizedQuery) {
    return 1;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return 0.97;
  }
  if (normalizedName.includes(normalizedQuery)) {
    return 0.9;
  }
  const queryTokens = normalize(query).match(/[a-z0-9]+/g) ?? [];
  const tokenHits = queryTokens.filter((token) => normalizedName.includes(token)).length;
  return queryTokens.length > 0 ? Math.min(0.85, tokenHits / queryTokens.length) : 0;
}

async function loadCanonicalProjects(): Promise<ProjectRow[]> {
  if (!isMysqlConfigured()) {
    return [];
  }

  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `
    SELECT project_id AS id, name
    FROM canonical_projects
    WHERE account_id = ?
    ORDER BY fetched_at DESC, name ASC
    `,
    [env.apsAccountId]
  );

  return (rows as Array<{ id: string; name: string }>).map((row) => ({
    id: row.id,
    name: row.name,
    source: 'canonical_mysql'
  }));
}

function dedupeProjects(projects: ProjectRow[]): ProjectRow[] {
  const deduped = new Map<string, ProjectRow>();
  for (const project of projects) {
    if (!deduped.has(project.id)) {
      deduped.set(project.id, project);
    }
  }
  return [...deduped.values()];
}

async function collectCandidateProjects(input: ResolveProjectInput): Promise<ProjectRow[]> {
  const candidates: ProjectRow[] = [];
  const sessionContext = input.sessionId ? getSessionContext(input.sessionId) : undefined;
  const workingSet = input.sessionId ? getCurrentWorkingSet(input.sessionId) : undefined;

  if (sessionContext?.current_project_id) {
    candidates.push({
      id: sessionContext.current_project_id,
      name: sessionContext.current_project_name ?? sessionContext.current_project_id,
      source: 'current_project'
    });
  }

  if (workingSet?.sourceDomain === 'projects' && workingSet.sourceProjectId) {
    candidates.push({
      id: workingSet.sourceProjectId,
      name: workingSet.sourceProjectName ?? workingSet.sourceProjectId,
      source: 'working_set'
    });
  }

  const cacheProjects = getFreshProjectsFromCache(env.apsAccountId, 15 * 60 * 1000) ?? [];
  for (const project of cacheProjects) {
    candidates.push({
      id: project.id,
      name: project.name,
      source: 'project_cache'
    });
  }

  candidates.push(...(await loadCanonicalProjects()));
  return dedupeProjects(candidates);
}

export async function resolveProject(input: ResolveProjectInput): Promise<ResolvedProjectCandidate[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
  const candidates = await collectCandidateProjects(input);

  if (!input.query?.trim()) {
    return candidates.slice(0, limit).map((project) => ({
      projectId: project.id,
      name: project.name,
      confidence: project.source === 'current_project' ? 1 : 0.8,
      source: project.source
    }));
  }

  return candidates
    .map((project) => ({
      projectId: project.id,
      name: project.name,
      confidence: scoreProjectMatch(project.name, input.query ?? ''),
      source: project.source
    }))
    .filter((project) => project.confidence >= 0.45)
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name))
    .slice(0, limit);
}
