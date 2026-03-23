import crypto from 'node:crypto';
import type { ApsIssue, ApsProject, ApsProjectUser, ApsRfi, ApsSubmittal, ApsTransmittal, DmProject } from '../../types/aps.js';
import { createEntityId, nowIso } from '../../utils/ids.js';
import { ensureMysqlSchema, getMysqlPool, isMysqlConfigured, toMysqlDateTime } from '../db/mysql.js';

type ScopeIds = Record<string, string | undefined>;

type ApiDocumentInput = {
  domain: string;
  entityType: string;
  endpoint: string;
  method: string;
  requestContext: Record<string, unknown>;
  scopeIds: ScopeIds;
  response: unknown;
};

type ChunkInput = {
  domain: string;
  entityType: string;
  chunkType: string;
  entityId?: string | undefined;
  projectId?: string | undefined;
  sequenceNo: number;
  contentText?: string | undefined;
  contentJson?: unknown;
};

function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

async function saveApiDocument(input: ApiDocumentInput): Promise<string | undefined> {
  if (!isMysqlConfigured()) {
    return undefined;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const id = createEntityId('doc');
  const fetchedAt = toMysqlDateTime(nowIso());
  await pool.execute(
    `
    INSERT INTO api_documents (
      id, domain, entity_type, endpoint, http_method, request_context_json,
      scope_ids_json, response_hash, response_json, fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      input.domain,
      input.entityType,
      input.endpoint,
      input.method,
      JSON.stringify(input.requestContext),
      JSON.stringify(input.scopeIds),
      hashPayload(input.response),
      JSON.stringify(input.response),
      fetchedAt
    ]
  );

  return id;
}

async function replaceDocumentChunks(documentId: string, chunks: ChunkInput[]): Promise<void> {
  if (!isMysqlConfigured()) {
    return;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const createdAt = toMysqlDateTime(nowIso());
  await pool.execute('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);

  for (const chunk of chunks) {
    const contentText = chunk.contentText ?? (chunk.contentJson ? JSON.stringify(chunk.contentJson) : '');
    await pool.execute(
      `
      INSERT INTO document_chunks (
        id, document_id, domain, entity_type, chunk_type, entity_id, project_id,
        sequence_no, token_estimate, content_text, content_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        createEntityId('chunk'),
        documentId,
        chunk.domain,
        chunk.entityType,
        chunk.chunkType,
        chunk.entityId ?? null,
        chunk.projectId ?? null,
        chunk.sequenceNo,
        estimateTokens(contentText),
        contentText || null,
        chunk.contentJson ? JSON.stringify(chunk.contentJson) : null,
        createdAt
      ]
    );
  }
}

function buildSummaryChunk(domain: string, entityType: string, projectId: string | undefined, total: number, items: unknown[]): ChunkInput {
  return {
    domain,
    entityType,
    chunkType: 'summary',
    projectId,
    sequenceNo: 0,
    contentJson: {
      total,
      preview: items.slice(0, 10)
    },
    contentText: `total=${total}`
  };
}

function buildEntityChunks(
  domain: string,
  entityType: string,
  projectId: string | undefined,
  items: Array<Record<string, unknown>>
): ChunkInput[] {
  return items.map((item, index) => ({
    domain,
    entityType,
    chunkType: 'entity',
    entityId: typeof item.id === 'string' ? item.id : undefined,
    projectId,
    sequenceNo: index + 1,
    contentJson: item,
    contentText: JSON.stringify(item)
  }));
}

export async function persistProjectsHybridSnapshot(params: {
  accountId: string;
  hubId?: string;
  endpoint: string;
  requestContext: Record<string, unknown>;
  rawPages: unknown[];
  projects: ApsProject[] | DmProject[];
}): Promise<void> {
  const rawDocumentId = await saveApiDocument({
    domain: 'projects',
    entityType: 'project',
    endpoint: params.endpoint,
    method: 'GET',
    requestContext: params.requestContext,
    scopeIds: {
      accountId: params.accountId,
      hubId: params.hubId
    },
    response: {
      pages: params.rawPages,
      results: params.projects
    }
  });

  if (!rawDocumentId || !isMysqlConfigured()) {
    return;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const fetchedAt = toMysqlDateTime(nowIso());
  for (const project of params.projects) {
    const status = 'status' in project ? project.status : ('projectStatus' in project ? project.projectStatus : undefined);
    const projectType = 'type' in project ? project.type : ('projectType' in project ? project.projectType : undefined);
    const normalizedStatus = status?.toLowerCase();
    await pool.execute(
      `
      INSERT INTO canonical_projects (
        project_id, account_id, hub_id, name, project_type, status, is_active, is_archived,
        root_folder_urn, container_json, web_url, details_json, raw_document_id, fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        account_id = VALUES(account_id),
        hub_id = VALUES(hub_id),
        name = VALUES(name),
        project_type = VALUES(project_type),
        status = VALUES(status),
        is_active = VALUES(is_active),
        is_archived = VALUES(is_archived),
        details_json = VALUES(details_json),
        raw_document_id = VALUES(raw_document_id),
        fetched_at = VALUES(fetched_at)
      `,
      [
        project.id,
        params.accountId,
        params.hubId ?? null,
        project.name,
        projectType ?? null,
        status ?? null,
        normalizedStatus?.includes('active') ? 1 : 0,
        normalizedStatus?.includes('archiv') ? 1 : 0,
        JSON.stringify(project),
        rawDocumentId,
        fetchedAt
      ]
    );
  }

  await replaceDocumentChunks(
    rawDocumentId,
    [
      buildSummaryChunk('projects', 'project', undefined, params.projects.length, params.projects),
      ...buildEntityChunks('projects', 'project', undefined, params.projects as Array<Record<string, unknown>>)
    ]
  );
}

export async function persistUsersHybridSnapshot(params: {
  accountId: string;
  projectId: string;
  endpoint: string;
  requestContext: Record<string, unknown>;
  rawPages: unknown[];
  users: ApsProjectUser[];
}): Promise<void> {
  const rawDocumentId = await saveApiDocument({
    domain: 'users',
    entityType: 'user',
    endpoint: params.endpoint,
    method: 'GET',
    requestContext: params.requestContext,
    scopeIds: {
      accountId: params.accountId,
      projectId: params.projectId
    },
    response: {
      pages: params.rawPages,
      results: params.users
    }
  });

  if (!rawDocumentId || !isMysqlConfigured()) {
    return;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const fetchedAt = toMysqlDateTime(nowIso());
  for (const user of params.users) {
    await pool.execute(
      `
      INSERT INTO canonical_users (
        project_id, user_id, account_id, autodesk_id, email, name, company_name, status,
        products_json, roles_json, details_json, raw_document_id, fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        account_id = VALUES(account_id),
        autodesk_id = VALUES(autodesk_id),
        email = VALUES(email),
        name = VALUES(name),
        company_name = VALUES(company_name),
        status = VALUES(status),
        products_json = VALUES(products_json),
        roles_json = VALUES(roles_json),
        details_json = VALUES(details_json),
        raw_document_id = VALUES(raw_document_id),
        fetched_at = VALUES(fetched_at)
      `,
      [
        params.projectId,
        user.id,
        params.accountId,
        user.autodeskId ?? null,
        user.email ?? null,
        user.name ?? null,
        user.companyName ?? null,
        user.status ?? null,
        JSON.stringify(user.products),
        JSON.stringify(user.roles),
        JSON.stringify(user),
        rawDocumentId,
        fetchedAt
      ]
    );
  }

  const companyCounts = params.users.reduce<Record<string, number>>((acc, user) => {
    const key = user.companyName?.trim() || 'Sin empresa';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  await replaceDocumentChunks(
    rawDocumentId,
    [
      buildSummaryChunk('users', 'user', params.projectId, params.users.length, params.users),
      {
        domain: 'users',
        entityType: 'user',
        chunkType: 'relationship',
        projectId: params.projectId,
        sequenceNo: 1_000,
        contentJson: companyCounts,
        contentText: JSON.stringify(companyCounts)
      },
      ...buildEntityChunks('users', 'user', params.projectId, params.users as Array<Record<string, unknown>>)
    ]
  );
}

async function persistProjectScopedDomainSnapshot(
  tableName: 'canonical_issues' | 'canonical_rfis' | 'canonical_submittals' | 'canonical_transmittals',
  params: {
    domain: string;
    entityType: string;
    projectId: string;
    endpoint: string;
    requestContext: Record<string, unknown>;
    rawPages: unknown[];
    items: Array<Record<string, unknown>>;
    mapRow: (item: Record<string, unknown>, rawDocumentId: string, fetchedAt: string) => unknown[];
  }
): Promise<void> {
  const rawDocumentId = await saveApiDocument({
    domain: params.domain,
    entityType: params.entityType,
    endpoint: params.endpoint,
    method: 'GET',
    requestContext: params.requestContext,
    scopeIds: {
      projectId: params.projectId
    },
    response: {
      pages: params.rawPages,
      results: params.items
    }
  });

  if (!rawDocumentId || !isMysqlConfigured()) {
    return;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const fetchedAt = toMysqlDateTime(nowIso());
  const sqlByTable: Record<typeof tableName, string> = {
    canonical_issues: `
      INSERT INTO canonical_issues (
        project_id, issue_id, display_id, title, status, issue_type, assigned_to, location_text,
        due_date, created_at_iso, details_json, raw_document_id, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_id = VALUES(display_id), title = VALUES(title), status = VALUES(status),
        issue_type = VALUES(issue_type), assigned_to = VALUES(assigned_to), location_text = VALUES(location_text),
        due_date = VALUES(due_date), created_at_iso = VALUES(created_at_iso), details_json = VALUES(details_json),
        raw_document_id = VALUES(raw_document_id), fetched_at = VALUES(fetched_at)
    `,
    canonical_rfis: `
      INSERT INTO canonical_rfis (
        project_id, rfi_id, display_id, title, status, rfi_type, assigned_to, location_text,
        due_date, created_at_iso, details_json, raw_document_id, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_id = VALUES(display_id), title = VALUES(title), status = VALUES(status),
        rfi_type = VALUES(rfi_type), assigned_to = VALUES(assigned_to), location_text = VALUES(location_text),
        due_date = VALUES(due_date), created_at_iso = VALUES(created_at_iso), details_json = VALUES(details_json),
        raw_document_id = VALUES(raw_document_id), fetched_at = VALUES(fetched_at)
    `,
    canonical_submittals: `
      INSERT INTO canonical_submittals (
        project_id, submittal_id, display_id, title, status, submittal_type, response_label, spec_label,
        assigned_to, manager_name, due_date, created_at_iso, details_json, raw_document_id, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_id = VALUES(display_id), title = VALUES(title), status = VALUES(status),
        submittal_type = VALUES(submittal_type), response_label = VALUES(response_label),
        spec_label = VALUES(spec_label), assigned_to = VALUES(assigned_to), manager_name = VALUES(manager_name),
        due_date = VALUES(due_date), created_at_iso = VALUES(created_at_iso), details_json = VALUES(details_json),
        raw_document_id = VALUES(raw_document_id), fetched_at = VALUES(fetched_at)
    `,
    canonical_transmittals: `
      INSERT INTO canonical_transmittals (
        project_id, transmittal_id, display_id, title, status, number_label, created_by,
        due_date, created_at_iso, details_json, raw_document_id, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_id = VALUES(display_id), title = VALUES(title), status = VALUES(status),
        number_label = VALUES(number_label), created_by = VALUES(created_by),
        due_date = VALUES(due_date), created_at_iso = VALUES(created_at_iso), details_json = VALUES(details_json),
        raw_document_id = VALUES(raw_document_id), fetched_at = VALUES(fetched_at)
    `
  };

  for (const item of params.items) {
    await pool.execute(sqlByTable[tableName], params.mapRow(item, rawDocumentId, fetchedAt) as unknown as any[]);
  }

  const groupedByStatus = params.items.reduce<Record<string, number>>((acc, item) => {
    const status = typeof item.status === 'string' && item.status.trim() ? item.status : 'sin estado';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  await replaceDocumentChunks(
    rawDocumentId,
    [
      buildSummaryChunk(params.domain, params.entityType, params.projectId, params.items.length, params.items),
      {
        domain: params.domain,
        entityType: params.entityType,
        chunkType: 'relationship',
        projectId: params.projectId,
        sequenceNo: 1_000,
        contentJson: groupedByStatus,
        contentText: JSON.stringify(groupedByStatus)
      },
      ...buildEntityChunks(params.domain, params.entityType, params.projectId, params.items)
    ]
  );
}

export async function persistIssuesHybridSnapshot(params: {
  projectId: string;
  endpoint: string;
  requestContext: Record<string, unknown>;
  rawPages: unknown[];
  items: ApsIssue[];
}): Promise<void> {
  return persistProjectScopedDomainSnapshot('canonical_issues', {
    domain: 'issues',
    entityType: 'issue',
    projectId: params.projectId,
    endpoint: params.endpoint,
    requestContext: params.requestContext,
    rawPages: params.rawPages,
    items: params.items as Array<Record<string, unknown>>,
    mapRow: (item, rawDocumentId, fetchedAt) => [
      params.projectId,
      item.issueId ?? item.id,
      item.id ?? null,
      item.title ?? null,
      item.status ?? null,
      item.type ?? null,
      item.assignedTo ?? null,
      item.location ?? null,
      item.dueDate ?? null,
      item.createdAt ?? null,
      JSON.stringify(item),
      rawDocumentId,
      fetchedAt
    ]
  });
}

export async function persistRfisHybridSnapshot(params: {
  projectId: string;
  endpoint: string;
  requestContext: Record<string, unknown>;
  rawPages: unknown[];
  items: ApsRfi[];
}): Promise<void> {
  return persistProjectScopedDomainSnapshot('canonical_rfis', {
    domain: 'rfis',
    entityType: 'rfi',
    projectId: params.projectId,
    endpoint: params.endpoint,
    requestContext: params.requestContext,
    rawPages: params.rawPages,
    items: params.items as Array<Record<string, unknown>>,
    mapRow: (item, rawDocumentId, fetchedAt) => [
      params.projectId,
      item.rfiId ?? item.id,
      item.id ?? null,
      item.title ?? null,
      item.status ?? null,
      item.type ?? null,
      item.assignedTo ?? null,
      item.location ?? null,
      item.dueDate ?? null,
      item.createdAt ?? null,
      JSON.stringify(item),
      rawDocumentId,
      fetchedAt
    ]
  });
}

export async function persistSubmittalsHybridSnapshot(params: {
  projectId: string;
  endpoint: string;
  requestContext: Record<string, unknown>;
  rawPages: unknown[];
  items: ApsSubmittal[];
}): Promise<void> {
  return persistProjectScopedDomainSnapshot('canonical_submittals', {
    domain: 'submittals',
    entityType: 'submittal',
    projectId: params.projectId,
    endpoint: params.endpoint,
    requestContext: params.requestContext,
    rawPages: params.rawPages,
    items: params.items as Array<Record<string, unknown>>,
    mapRow: (item, rawDocumentId, fetchedAt) => [
      params.projectId,
      item.submittalId ?? item.id,
      item.id ?? null,
      item.title ?? null,
      item.status ?? null,
      item.type ?? null,
      item.response ?? null,
      item.spec ?? null,
      item.assignedTo ?? null,
      item.manager ?? null,
      item.dueDate ?? null,
      item.createdAt ?? null,
      JSON.stringify(item),
      rawDocumentId,
      fetchedAt
    ]
  });
}

export async function persistTransmittalsHybridSnapshot(params: {
  projectId: string;
  endpoint: string;
  requestContext: Record<string, unknown>;
  rawPages: unknown[];
  items: ApsTransmittal[];
}): Promise<void> {
  return persistProjectScopedDomainSnapshot('canonical_transmittals', {
    domain: 'transmittals',
    entityType: 'transmittal',
    projectId: params.projectId,
    endpoint: params.endpoint,
    requestContext: params.requestContext,
    rawPages: params.rawPages,
    items: params.items as Array<Record<string, unknown>>,
    mapRow: (item, rawDocumentId, fetchedAt) => [
      params.projectId,
      item.transmittalId ?? item.id,
      item.id ?? null,
      item.title ?? null,
      item.status ?? null,
      item.number ?? null,
      item.createdBy ?? null,
      item.dueDate ?? null,
      item.createdAt ?? null,
      JSON.stringify(item),
      rawDocumentId,
      fetchedAt
    ]
  });
}
