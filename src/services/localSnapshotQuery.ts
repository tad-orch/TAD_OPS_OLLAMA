import { env } from '../config/env.js';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { getLatestUsableSnapshot, getSnapshotRegistry } from '../db/repositories/snapshotRegistryRepo.js';
import { getFreshUsersFromCache } from '../db/repositories/userCacheRepo.js';
import { getFreshProjectsFromCache } from '../db/repositories/projectCacheRepo.js';
import { getMysqlPool, isMysqlConfigured } from '../shared/db/mysql.js';
import type {
  AgentDomain,
  AgentExecutionMode,
  SessionSnapshotResource,
  SnapshotDomain,
  StructuredTurnPlan
} from '../types/agent.js';

type LocalQueryOperation =
  | 'count'
  | 'exists'
  | 'group_by_status'
  | 'filter_by_status'
  | 'count_by_company'
  | 'filter_by_company'
  | 'filter_by_prefix'
  | 'unknown';

type LocalQuerySpec = {
  domain: SnapshotDomain;
  operation: LocalQueryOperation;
  projectId?: string;
  projectName?: string;
  value?: string;
  field?: 'status' | 'company' | 'name';
};

type QueryRow = Record<string, unknown>;

const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;
const USERS_CACHE_TTL_MS = 10 * 60 * 1000;
const PROJECT_DOMAIN_BY_AGENT_DOMAIN: Partial<Record<AgentDomain, SnapshotDomain>> = {
  acc_admin: 'projects',
  issues: 'issues',
  rfis: 'rfis',
  submittals: 'submittals',
  transmittals: 'transmittals'
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function quoteIfNeeded(value: string): string {
  return /[\s-]/.test(value) ? `"${value}"` : value;
}

export function inferDomainFromPlan(
  sessionId: string,
  plan: StructuredTurnPlan,
  loweredText: string
): SnapshotDomain | undefined {
  if (plan.intent === 'get_project_users') {
    return 'users';
  }

  if (plan.intent === 'list_projects') {
    return 'projects';
  }

  const direct = PROJECT_DOMAIN_BY_AGENT_DOMAIN[plan.domain];
  if (direct && direct !== 'projects') {
    return direct;
  }

  if (/\bissues?\b/.test(loweredText)) {
    return 'issues';
  }

  if (/\brfis?\b/.test(loweredText)) {
    return 'rfis';
  }

  if (/\bsubmittals?\b/.test(loweredText)) {
    return 'submittals';
  }

  if (/\btransmittals?\b/.test(loweredText)) {
    return 'transmittals';
  }

  if ((/\busuarios?\b/.test(loweredText) || /\busers?\b/.test(loweredText)) && !/\bproyectos?\b/.test(loweredText)) {
    return 'users';
  }

  if (/\bproyectos?\b/.test(loweredText)) {
    return 'projects';
  }

  const registry = getSnapshotRegistry(sessionId);
  return registry.snapshots[0]?.domain;
}

function extractStatusValue(userText: string): string | undefined {
  const normalized = normalizeText(userText);
  const quoted = userText.match(/["“']([^"”']+)["”']/);
  const explicit =
    normalized.match(/\bestado\s+([a-z0-9_-]+)/)?.[1] ??
    normalized.match(/\bstatus\s+([a-z0-9_-]+)/)?.[1];

  if (explicit) {
    return explicit;
  }

  if (quoted?.[1] && /\b(estado|status|abiert|cerrad|open|closed|pending|draft|approved|rejected)\b/i.test(userText)) {
    return normalizeText(quoted[1]);
  }

  const commonStatuses = [
    'open',
    'closed',
    'pending',
    'draft',
    'approved',
    'rejected',
    'active',
    'archived',
    'inactive',
    'resolved'
  ];

  const statusAliases: Array<{ pattern: RegExp; canonical: string }> = [
    { pattern: /\babiert(?:o|a|os|as)\b/, canonical: 'open' },
    { pattern: /\bcerrad(?:o|a|os|as)\b/, canonical: 'closed' },
    { pattern: /\bpendient(?:e|es)\b/, canonical: 'pending' },
    { pattern: /\baprobad(?:o|a|os|as)\b/, canonical: 'approved' },
    { pattern: /\brechazad(?:o|a|os|as)\b/, canonical: 'rejected' },
    { pattern: /\bactiv(?:o|a|os|as)\b/, canonical: 'active' },
    { pattern: /\barchivad(?:o|a|os|as)\b/, canonical: 'archived' },
    { pattern: /\binactiv(?:o|a|os|as)\b/, canonical: 'inactive' },
    { pattern: /\bresuelt(?:o|a|os|as)\b/, canonical: 'resolved' }
  ];
  const aliasMatch = statusAliases.find(({ pattern }) => pattern.test(normalized));
  if (aliasMatch) {
    return aliasMatch.canonical;
  }

  return commonStatuses.find((value) => normalized.includes(value));
}

function extractCompanyValue(userText: string): string | undefined {
  const explicit =
    userText.match(/\bempresa\s+["“']?([^"”',.\n]+)["”']?/i)?.[1]?.trim() ??
    userText.match(/\bcompany\s+["“']?([^"”',.\n]+)["”']?/i)?.[1]?.trim();

  return explicit || undefined;
}

function extractPrefixValue(userText: string): string | undefined {
  return (
    userText.match(/\bempiez[a-z]*\s+con\s+["“']?([A-Za-z0-9_-]{2,})["”']?/i)?.[1]?.trim() ??
    userText.match(/\bprefijo\s+["“']?([A-Za-z0-9_-]{2,})["”']?/i)?.[1]?.trim() ??
    undefined
  );
}

export function isAnalyticalQuestion(loweredText: string): boolean {
  return [
    /\bcu[aá]nt[oa]s?\b/,
    /\bagr[úu]palos?\b/,
    /\bagrup(a|alos|alas|ar)\b/,
    /\bhay\b/,
    /\balg[uú]n(?:a|os|as)?\b/,
    /\bsolo\b/,
    /\bfiltra\b/,
    /\bempiez[a-z]*\s+con\b/,
    /\bpor\s+status\b/,
    /\bpor\s+estado\b/,
    /\bempresa\b/,
    /\bcompa(?:ñ|n)[ií]a\b/
  ].some((pattern) => pattern.test(loweredText));
}

export function determineExecutionMode(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan
): AgentExecutionMode {
  const loweredText = normalizeText(userText);
  const domain = inferDomainFromPlan(sessionId, plan, loweredText);
  const hasSnapshot =
    domain === undefined
      ? false
      : Boolean(
          getLatestUsableSnapshot(
            sessionId,
            domain,
            plan.entities.projectId ?? getSessionContext(sessionId)?.current_project_id
          )
        );
  const analytical = isAnalyticalQuestion(loweredText);

  if (plan.mode === 'chat' && !analytical) {
    return 'chat';
  }

  if (analytical && hasSnapshot) {
    return 'local_snapshot_query';
  }

  if (analytical && plan.requiresTools) {
    return 'fetch_then_analyze';
  }

  if (plan.requiresTools) {
    return 'external_fetch';
  }

  return hasSnapshot ? 'local_snapshot_query' : 'chat';
}

function buildQuerySpec(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan
): LocalQuerySpec | undefined {
  const loweredText = normalizeText(userText);
  const domain = inferDomainFromPlan(sessionId, plan, loweredText);
  if (!domain) {
    return undefined;
  }

  const context = getSessionContext(sessionId);
  const projectId = plan.entities.projectId ?? context?.current_project_id;
  const projectName = plan.entities.projectName ?? context?.current_project_name;
  const status = extractStatusValue(userText);
  const company = extractCompanyValue(userText);
  const prefix = extractPrefixValue(userText);
  const scope = {
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {})
  };

  if ((/\bagrup(a|alos|alas|ar)\b/.test(loweredText) || /\bpor\s+(status|estado)\b/.test(loweredText)) && domain !== 'projects') {
    return createLocalQuerySpec({ domain, operation: 'group_by_status', ...scope, field: 'status' });
  }

  if ((/\bcu[aá]nt[oa]s?\b/.test(loweredText) || /\bconteo\b/.test(loweredText)) && company) {
    return createLocalQuerySpec({
      domain: 'users',
      operation: 'count_by_company',
      ...scope,
      field: 'company',
      value: company
    });
  }

  if ((/\bsolo\b/.test(loweredText) || /\bmu[eé]strame\b/.test(loweredText) || /\bdame\b/.test(loweredText)) && company) {
    return createLocalQuerySpec({
      domain: 'users',
      operation: 'filter_by_company',
      ...scope,
      field: 'company',
      value: company
    });
  }

  if ((/\bcu[aá]nt[oa]s?\b/.test(loweredText) || /\bhay\b/.test(loweredText) || /\balg[uú]n(?:a|os|as)?\b/.test(loweredText)) && status) {
    return createLocalQuerySpec({
      domain,
      operation: /\balg[uú]n(?:a|os|as)?\b/.test(loweredText) || /\bhay\b/.test(loweredText) ? 'exists' : 'count',
      ...scope,
      field: 'status',
      value: status
    });
  }

  if ((/\bsolo\b/.test(loweredText) || /\bdame\b/.test(loweredText) || /\bmu[eé]strame\b/.test(loweredText)) && status) {
    return createLocalQuerySpec({
      domain,
      operation: 'filter_by_status',
      ...scope,
      field: 'status',
      value: status
    });
  }

  if (domain === 'projects' && prefix) {
    return createLocalQuerySpec({ domain, operation: 'filter_by_prefix', field: 'name', value: prefix });
  }

  if (domain === 'projects' && /\bcu[aá]nt[oa]s?\b/.test(loweredText) && status) {
    return createLocalQuerySpec({ domain, operation: 'count', field: 'status', value: status });
  }

  if (domain === 'projects' && (/\balg[uú]n(?:a|os|as)?\b/.test(loweredText) || /\bhay\b/.test(loweredText)) && status) {
    return createLocalQuerySpec({ domain, operation: 'exists', field: 'status', value: status });
  }

  return undefined;
}

function normalizeComparable(value: unknown): string {
  return typeof value === 'string' ? normalizeText(value) : '';
}

function createLocalQuerySpec(params: {
  domain: SnapshotDomain;
  operation: LocalQueryOperation;
  projectId?: string;
  projectName?: string;
  value?: string;
  field?: 'status' | 'company' | 'name';
}): LocalQuerySpec {
  return {
    domain: params.domain,
    operation: params.operation,
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.projectName ? { projectName: params.projectName } : {}),
    ...(params.value ? { value: params.value } : {}),
    ...(params.field ? { field: params.field } : {})
  };
}

function getProjectLabel(spec: LocalQuerySpec, snapshot?: SessionSnapshotResource): string | undefined {
  return spec.projectName ?? snapshot?.projectName ?? spec.projectId ?? snapshot?.projectId;
}

async function queryMysqlRows(sql: string, params: unknown[]): Promise<QueryRow[]> {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(sql, params);
  return rows as QueryRow[];
}

async function loadProjectsRows(): Promise<QueryRow[]> {
  if (isMysqlConfigured()) {
    return queryMysqlRows(
      `
      SELECT project_id AS id, name, status, project_type
      FROM canonical_projects
      WHERE account_id = ?
      ORDER BY name ASC
      `,
      [env.apsAccountId]
    );
  }

  const cached = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [];
  return cached.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status ?? null,
    project_type: project.type ?? null
  }));
}

async function loadUsersRows(projectId: string): Promise<QueryRow[]> {
  if (isMysqlConfigured()) {
    return queryMysqlRows(
      `
      SELECT user_id AS id, email, name, company_name, status
      FROM canonical_users
      WHERE project_id = ?
      ORDER BY name ASC, email ASC
      `,
      [projectId]
    );
  }

  const cached = getFreshUsersFromCache(projectId, USERS_CACHE_TTL_MS) ?? [];
  return cached.map((user) => ({
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    company_name: user.companyName ?? null,
    status: user.status ?? null
  }));
}

async function loadProjectScopedRows(domain: Exclude<SnapshotDomain, 'projects' | 'users'>, projectId: string): Promise<QueryRow[]> {
  const tableByDomain: Record<Exclude<SnapshotDomain, 'projects' | 'users'>, string> = {
    issues: 'canonical_issues',
    rfis: 'canonical_rfis',
    submittals: 'canonical_submittals',
    transmittals: 'canonical_transmittals'
  };

  if (!isMysqlConfigured()) {
    return [];
  }

  return queryMysqlRows(
    `
    SELECT *
    FROM ${tableByDomain[domain]}
    WHERE project_id = ?
    ORDER BY COALESCE(created_at_iso, due_date, fetched_at) DESC
    `,
    [projectId]
  );
}

function getDomainLabel(domain: SnapshotDomain): string {
  switch (domain) {
    case 'projects':
      return 'proyectos';
    case 'users':
      return 'usuarios';
    case 'issues':
      return 'issues';
    case 'rfis':
      return 'RFIs';
    case 'submittals':
      return 'submittals';
    case 'transmittals':
      return 'transmittals';
  }
}

function getSingularDomainLabel(domain: SnapshotDomain): string {
  switch (domain) {
    case 'projects':
      return 'proyecto';
    case 'users':
      return 'usuario';
    case 'issues':
      return 'issue';
    case 'rfis':
      return 'RFI';
    case 'submittals':
      return 'submittal';
    case 'transmittals':
      return 'transmittal';
  }
}

function getStatusFieldValue(row: QueryRow): string {
  return normalizeComparable(row.status);
}

function formatPreviewLines(domain: SnapshotDomain, rows: QueryRow[]): string[] {
  return rows.slice(0, 5).map((row) => {
    const primary =
      (typeof row.title === 'string' && row.title) ||
      (typeof row.name === 'string' && row.name) ||
      (typeof row.email === 'string' && row.email) ||
      (typeof row.id === 'string' && row.id) ||
      'sin etiqueta';
    const parts = [primary];
    if (typeof row.status === 'string' && row.status.trim()) {
      parts.push(`[${row.status.trim()}]`);
    }
    if (domain === 'users' && typeof row.company_name === 'string' && row.company_name.trim()) {
      parts.push(row.company_name.trim());
    }
    return `- ${parts.join(' | ')}`;
  });
}

export async function tryRunLocalSnapshotQuery(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan
): Promise<string | undefined> {
  const spec = buildQuerySpec(sessionId, userText, plan);
  if (!spec) {
    return undefined;
  }

  const snapshot = getLatestUsableSnapshot(sessionId, spec.domain, spec.projectId);
  if (!snapshot) {
    return undefined;
  }

  let rows: QueryRow[] = [];
  if (spec.domain === 'projects') {
    rows = await loadProjectsRows();
  } else if (spec.domain === 'users') {
    const projectId = spec.projectId ?? snapshot.projectId;
    if (!projectId) {
      return undefined;
    }
    rows = await loadUsersRows(projectId);
  } else {
    const projectId = spec.projectId ?? snapshot.projectId;
    if (!projectId) {
      return undefined;
    }
    rows = await loadProjectScopedRows(spec.domain, projectId);
  }

  if (rows.length === 0) {
    return undefined;
  }

  const projectLabel = getProjectLabel(spec, snapshot);
  const domainLabel = getDomainLabel(spec.domain);
  const singularLabel = getSingularDomainLabel(spec.domain);
  const normalizedValue = spec.value ? normalizeText(spec.value) : undefined;

  if (spec.operation === 'group_by_status') {
    const grouped = rows.reduce<Record<string, number>>((acc, row) => {
      const key = typeof row.status === 'string' && row.status.trim() ? row.status.trim() : 'sin estado';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const lines = [
      `Agrupación local de ${domainLabel}${projectLabel ? ` para ${projectLabel}` : ''}:`,
      '',
      ...Object.entries(grouped)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([status, count]) => `- ${status}: ${count}`)
    ];
    return lines.join('\n');
  }

  if (spec.operation === 'filter_by_prefix' && normalizedValue) {
    const filtered = rows.filter((row) =>
      normalizeComparable(row.name).startsWith(normalizedValue)
    );
    const lines = [
      `Encontré ${filtered.length} proyectos que empiezan con ${quoteIfNeeded(spec.value ?? '')}.`
    ];
    if (filtered.length > 0) {
      lines.push('');
      lines.push(...formatPreviewLines(spec.domain, filtered));
    }
    return lines.join('\n');
  }

  if ((spec.operation === 'count_by_company' || spec.operation === 'filter_by_company') && normalizedValue) {
    const filtered = rows.filter((row) => normalizeComparable(row.company_name).includes(normalizedValue));
    if (spec.operation === 'count_by_company') {
      return `Hay ${filtered.length} usuarios de la empresa ${quoteIfNeeded(spec.value ?? '')}${projectLabel ? ` en ${projectLabel}` : ''}.`;
    }

    const lines = [
      `Encontré ${filtered.length} usuarios de la empresa ${quoteIfNeeded(spec.value ?? '')}${projectLabel ? ` en ${projectLabel}` : ''}.`
    ];
    if (filtered.length > 0) {
      lines.push('');
      lines.push(...formatPreviewLines(spec.domain, filtered));
    }
    return lines.join('\n');
  }

  if ((spec.operation === 'count' || spec.operation === 'exists' || spec.operation === 'filter_by_status') && normalizedValue) {
    const filtered = rows.filter((row) => getStatusFieldValue(row).includes(normalizedValue));
    if (spec.operation === 'exists') {
      return filtered.length > 0
        ? `Sí, ${filtered.length} ${domainLabel} están en estado ${quoteIfNeeded(spec.value ?? '')}${projectLabel ? ` en ${projectLabel}` : ''}.`
        : `No, no encontré ${domainLabel} en estado ${quoteIfNeeded(spec.value ?? '')}${projectLabel ? ` en ${projectLabel}` : ''}.`;
    }

    if (spec.operation === 'count') {
      return `Hay ${filtered.length} ${domainLabel} en estado ${quoteIfNeeded(spec.value ?? '')}${projectLabel ? ` en ${projectLabel}` : ''}.`;
    }

    const lines = [
      `Encontré ${filtered.length} ${domainLabel} en estado ${quoteIfNeeded(spec.value ?? '')}${projectLabel ? ` en ${projectLabel}` : ''}.`
    ];
    if (filtered.length > 0) {
      lines.push('');
      lines.push(...formatPreviewLines(spec.domain, filtered));
    }
    return lines.join('\n');
  }

  if (spec.operation === 'exists') {
    return rows.length > 0
      ? `Sí, hay ${rows.length} ${domainLabel}${projectLabel ? ` en ${projectLabel}` : ''}.`
      : `No encontré ${domainLabel}${projectLabel ? ` en ${projectLabel}` : ''}.`;
  }

  if (spec.operation === 'count') {
    return `Hay ${rows.length} ${domainLabel}${projectLabel ? ` en ${projectLabel}` : ''}.`;
  }

  return `Tengo un snapshot local reciente de ${domainLabel}${projectLabel ? ` para ${projectLabel}` : ''}, pero esta pregunta todavía no tiene una operación local implementada con suficiente confianza.`;
}
