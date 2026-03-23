import { db } from '../../db/sqlite.js';
import type { ProjectScopedCacheTable, ProjectScopedReadItemBase } from '../../types/aps.js';
import { nowIso } from '../../utils/ids.js';

type CacheRow = {
  summary_json: string;
  fetched_at: string;
};

function getTableName(table: ProjectScopedCacheTable): string {
  return table;
}

export function replaceProjectScopedReadCache<TItem extends ProjectScopedReadItemBase>(
  table: ProjectScopedCacheTable,
  projectId: string,
  items: TItem[]
): void {
  const fetchedAt = nowIso();
  const tableName = getTableName(table);
  const deleteStatement = db.prepare(`DELETE FROM ${tableName} WHERE project_id = ?`);
  const insertStatement = db.prepare(
    `
    INSERT INTO ${tableName} (
      project_id, item_id, title, status, due_date, created_at_iso, raw_json, summary_json, fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  const transaction = db.transaction((rows: TItem[]) => {
    deleteStatement.run(projectId);
    for (const item of rows) {
      insertStatement.run(
        projectId,
        item.id,
        item.title ?? null,
        item.status ?? null,
        item.dueDate ?? null,
        item.createdAt ?? null,
        JSON.stringify(item),
        JSON.stringify(item),
        fetchedAt
      );
    }
  });

  transaction(items);
}

export function getFreshProjectScopedReadCache<TItem extends ProjectScopedReadItemBase>(
  table: ProjectScopedCacheTable,
  projectId: string,
  ttlMs: number
): TItem[] | null {
  const tableName = getTableName(table);
  const freshness = db
    .prepare(
      `
      SELECT fetched_at
      FROM ${tableName}
      WHERE project_id = ?
      ORDER BY fetched_at DESC
      LIMIT 1
      `
    )
    .get(projectId) as { fetched_at: string } | undefined;

  if (!freshness) {
    return null;
  }

  if (Date.now() - new Date(freshness.fetched_at).getTime() >= ttlMs) {
    return null;
  }

  const rows = db
    .prepare(
      `
      SELECT summary_json, fetched_at
      FROM ${tableName}
      WHERE project_id = ?
      ORDER BY status ASC, title ASC, item_id ASC
      `
    )
    .all(projectId) as CacheRow[];

  return rows.map((row) => JSON.parse(row.summary_json) as TItem);
}
