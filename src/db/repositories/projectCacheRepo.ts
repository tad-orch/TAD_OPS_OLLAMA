import { db } from '../sqlite.js';
import type { ApsProject } from '../../types/aps.js';
import { nowIso } from '../../utils/ids.js';

type ProjectCacheRow = {
  account_id: string;
  project_id: string;
  project_name: string;
  status: string | null;
  type: string | null;
  raw_json: string;
  fetched_at: string;
};

function rowToProject(row: ProjectCacheRow): ApsProject {
  return {
    id: row.project_id,
    name: row.project_name,
    status: row.status ?? undefined,
    type: row.type ?? undefined
  };
}

export function getFreshProjectsFromCache(accountId: string, ttlMs: number): ApsProject[] | null {
  const freshness = db
    .prepare(
      `
      SELECT fetched_at
      FROM project_cache
      WHERE account_id = ?
      ORDER BY fetched_at DESC
      LIMIT 1
      `
    )
    .get(accountId) as { fetched_at: string } | undefined;

  if (!freshness) {
    return null;
  }

  const isFresh = Date.now() - new Date(freshness.fetched_at).getTime() < ttlMs;
  if (!isFresh) {
    return null;
  }

  const rows = db
    .prepare(
      `
      SELECT *
      FROM project_cache
      WHERE account_id = ?
      ORDER BY project_name ASC
      `
    )
    .all(accountId) as ProjectCacheRow[];

  return rows.map(rowToProject);
}

export function replaceProjectsCache(accountId: string, projects: ApsProject[]): void {
  const fetchedAt = nowIso();
  const deleteStatement = db.prepare('DELETE FROM project_cache WHERE account_id = ?');
  const insertStatement = db.prepare(
    `
    INSERT INTO project_cache (
      account_id, project_id, project_name, status, type, raw_json, fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  );

  const transaction = db.transaction((items: ApsProject[]) => {
    deleteStatement.run(accountId);
    for (const project of items) {
      insertStatement.run(
        accountId,
        project.id,
        project.name,
        project.status ?? null,
        project.type ?? null,
        JSON.stringify(project),
        fetchedAt
      );
    }
  });

  transaction(projects);
}

export function findProjectByName(accountId: string, projectName: string): ApsProject | undefined {
  const exactRow = db
    .prepare(
      `
      SELECT *
      FROM project_cache
      WHERE account_id = ? AND project_name = ?
      LIMIT 1
      `
    )
    .get(accountId, projectName) as ProjectCacheRow | undefined;

  if (exactRow) {
    return rowToProject(exactRow);
  }

  const lowerRow = db
    .prepare(
      `
      SELECT *
      FROM project_cache
      WHERE account_id = ? AND lower(project_name) = lower(?)
      LIMIT 1
      `
    )
    .get(accountId, projectName) as ProjectCacheRow | undefined;

  return lowerRow ? rowToProject(lowerRow) : undefined;
}
