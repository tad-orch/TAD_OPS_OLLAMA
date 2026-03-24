import { env } from '../config/env.js';
import { getMysqlPool, isMysqlConfigured } from '../shared/db/mysql.js';

const DOMAIN_CONFIG = {
  projects: {
    table: 'canonical_projects',
    defaultOrderBy: 'name',
    filterColumns: ['project_id', 'hub_id', 'name', 'status', 'project_type'],
    groupableColumns: ['status', 'project_type']
  },
  users: {
    table: 'canonical_users',
    defaultOrderBy: 'name',
    filterColumns: ['project_id', 'user_id', 'name', 'email', 'company_name', 'status'],
    groupableColumns: ['status', 'company_name']
  },
  issues: {
    table: 'canonical_issues',
    defaultOrderBy: 'fetched_at',
    filterColumns: ['project_id', 'issue_id', 'title', 'status', 'type', 'assigned_to', 'due_date'],
    groupableColumns: ['status', 'type']
  },
  rfis: {
    table: 'canonical_rfis',
    defaultOrderBy: 'fetched_at',
    filterColumns: ['project_id', 'rfi_id', 'title', 'status', 'assigned_to', 'due_date'],
    groupableColumns: ['status']
  },
  submittals: {
    table: 'canonical_submittals',
    defaultOrderBy: 'fetched_at',
    filterColumns: ['project_id', 'submittal_id', 'title', 'status', 'assigned_to', 'due_date'],
    groupableColumns: ['status']
  },
  transmittals: {
    table: 'canonical_transmittals',
    defaultOrderBy: 'fetched_at',
    filterColumns: ['project_id', 'transmittal_id', 'title', 'status', 'due_date'],
    groupableColumns: ['status']
  }
} as const;

export type QueryCanonicalInput = {
  domain: keyof typeof DOMAIN_CONFIG;
  projectId?: string | undefined;
  filters?: Record<string, string | number | boolean> | undefined;
  groupBy?: string | undefined;
  limit?: number | undefined;
  sort?: {
    field: string;
    direction?: 'asc' | 'desc' | undefined;
  } | undefined;
};

function assertConfigured(): void {
  if (!isMysqlConfigured()) {
    throw new Error('MySQL no esta configurado para query_canonical');
  }
}

export async function queryCanonical(input: QueryCanonicalInput): Promise<{
  rows: unknown[];
  count: number;
}> {
  assertConfigured();
  const config = DOMAIN_CONFIG[input.domain];
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (input.domain === 'projects') {
    whereParts.push('account_id = ?');
    params.push(env.apsAccountId);
  }

  if (input.projectId && config.filterColumns.includes('project_id')) {
    whereParts.push('project_id = ?');
    params.push(input.projectId);
  }

  for (const [key, rawValue] of Object.entries(input.filters ?? {})) {
    if (!(config.filterColumns as readonly string[]).includes(key)) {
      continue;
    }

    if (typeof rawValue === 'string' && rawValue.includes('%')) {
      whereParts.push(`${key} LIKE ?`);
      params.push(rawValue);
      continue;
    }

    whereParts.push(`${key} = ?`);
    params.push(rawValue);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const pool = await getMysqlPool();

  if (input.groupBy && (config.groupableColumns as readonly string[]).includes(input.groupBy)) {
    const [rows] = await pool.query(
      `
      SELECT ${input.groupBy} AS group_key, COUNT(*) AS total
      FROM ${config.table}
      ${whereSql}
      GROUP BY ${input.groupBy}
      ORDER BY total DESC, group_key ASC
      LIMIT ?
      `,
      [...params, limit]
    );

    return {
      rows: rows as unknown[],
      count: Array.isArray(rows) ? rows.length : 0
    };
  }

  const sortField =
    input.sort && (config.filterColumns as readonly string[]).includes(input.sort.field)
      ? input.sort.field
      : config.defaultOrderBy;
  const sortDirection = input.sort?.direction === 'asc' ? 'ASC' : 'DESC';

  const [rows] = await pool.query(
    `
    SELECT *
    FROM ${config.table}
    ${whereSql}
    ORDER BY ${sortField} ${sortDirection}
    LIMIT ?
    `,
    [...params, limit]
  );

  return {
    rows: rows as unknown[],
    count: Array.isArray(rows) ? rows.length : 0
  };
}
