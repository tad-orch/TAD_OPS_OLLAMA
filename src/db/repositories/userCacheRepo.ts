import { db } from '../sqlite.js';
import type { ApsProjectUser } from '../../types/aps.js';
import { nowIso } from '../../utils/ids.js';

type UserCacheRow = {
  project_id: string;
  user_id: string;
  autodesk_id: string | null;
  email: string | null;
  name: string | null;
  company_name: string | null;
  status: string | null;
  products_json: string | null;
  roles_json: string | null;
  raw_json: string;
  fetched_at: string;
};

function rowToUser(row: UserCacheRow): ApsProjectUser {
  return {
    id: row.user_id,
    autodeskId: row.autodesk_id ?? undefined,
    email: row.email ?? undefined,
    name: row.name ?? undefined,
    companyName: row.company_name ?? undefined,
    status: row.status ?? undefined,
    products: row.products_json ? (JSON.parse(row.products_json) as ApsProjectUser['products']) : [],
    roles: row.roles_json ? (JSON.parse(row.roles_json) as string[]) : []
  };
}

export function getFreshUsersFromCache(projectId: string, ttlMs: number): ApsProjectUser[] | null {
  const freshness = db
    .prepare(
      `
      SELECT fetched_at
      FROM user_cache
      WHERE project_id = ?
      ORDER BY fetched_at DESC
      LIMIT 1
      `
    )
    .get(projectId) as { fetched_at: string } | undefined;

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
      FROM user_cache
      WHERE project_id = ?
      ORDER BY name ASC, email ASC
      `
    )
    .all(projectId) as UserCacheRow[];

  return rows.map(rowToUser);
}

export function replaceUsersCache(projectId: string, users: ApsProjectUser[]): void {
  const fetchedAt = nowIso();
  const deleteStatement = db.prepare('DELETE FROM user_cache WHERE project_id = ?');
  const insertStatement = db.prepare(
    `
    INSERT INTO user_cache (
      project_id, user_id, autodesk_id, email, name, company_name, status,
      products_json, roles_json, raw_json, fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  const transaction = db.transaction((items: ApsProjectUser[]) => {
    deleteStatement.run(projectId);
    for (const user of items) {
      insertStatement.run(
        projectId,
        user.id,
        user.autodeskId ?? null,
        user.email ?? null,
        user.name ?? null,
        user.companyName ?? null,
        user.status ?? null,
        JSON.stringify(user.products),
        JSON.stringify(user.roles),
        JSON.stringify(user),
        fetchedAt
      );
    }
  });

  transaction(users);
}
