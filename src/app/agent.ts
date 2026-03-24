import type { ChatResponse, Message } from 'ollama';
import { env } from '../config/env.js';
import { getSessionContext, upsertSessionContext } from '../db/repositories/contextRepo.js';
import {
  registerProjectScopedReadSnapshot,
  registerProjectsSnapshot,
  registerUsersSnapshot
} from '../db/repositories/snapshotRegistryRepo.js';
import { saveWorkingSet } from '../db/repositories/workingSetRepo.js';
import { addMessage } from '../db/repositories/messagesRepo.js';
import { getFreshProjectsFromCache } from '../db/repositories/projectCacheRepo.js';
import { getFreshUsersFromCache } from '../db/repositories/userCacheRepo.js';
import { getSessionById, touchSession, updateSessionAfterUserMessage } from '../db/repositories/sessionsRepo.js';
import { addToolCall } from '../db/repositories/toolCallsRepo.js';
import { systemPrompt, turnPlannerPrompt } from '../prompts/systemPrompt.js';
import { analyzeTurn } from '../services/analyzeTurn.js';
import { routePureConversation } from '../services/conversationRoute.js';
import { buildContextForSession } from '../services/contextBuilder.js';
import { decideAction } from '../services/decideAction.js';
import { tryRunLocalSnapshotQuery } from '../services/localSnapshotQuery.js';
import { chatWithOllama } from '../services/ollamaClient.js';
import { getConstructionAuthStatus } from '../services/apsUserAuth.js';
import { generateFinalResponse } from '../services/responseGenerator.js';
import { resolveEvidence } from '../services/resolveEvidence.js';
import { buildPlannerWorkingSetSummary, buildResolvedContextSummary } from '../services/runtimeContextSummary.js';
import { getProjectsByAccountTool } from '../tools/getProjectsTool.js';
import { toolDefinitions, toolHandlers } from '../tools/index.js';
import type {
  AgentResult,
  GetProjectIssuesToolArgs,
  GetProjectIssuesToolResult,
  ApsProject,
  ApsProjectUser,
  GetProjectUsersToolArgs,
  GetProjectUsersToolResult,
  GetProjectRfisToolArgs,
  GetProjectRfisToolResult,
  GetProjectsToolArgs,
  GetProjectsToolResult,
  GetProjectSubmittalsToolArgs,
  GetProjectSubmittalsToolResult,
  GetProjectTransmittalsToolArgs,
  GetProjectTransmittalsToolResult,
  StartAccUserLoginToolResult,
  ProjectScopedReadItemBase,
  ProjectScopedReadToolResult
} from '../types/aps.js';
import type {
  ActionDecision,
  AgentDomain,
  AgentExecutionMode,
  AgentIntent,
  AgentMode,
  PlannedToolCall,
  ProjectMemoryItem,
  ProjectScopedReadMemory,
  StructuredTurnPlan
} from '../types/agent.js';
import { summarizeToolResultForStorage } from '../utils/summarize.js';

type ToolName = keyof typeof toolHandlers;

type ToolRequest = {
  name: ToolName;
  arguments: Record<string, unknown>;
};

type ToolExecutionResult =
  | {
      ok: true;
      name: ToolName;
      args: Record<string, unknown>;
      payload: unknown;
      projects: ApsProject[];
      resolvedProjectName?: string;
    }
  | {
      ok: false;
      name: ToolName;
      args: Record<string, unknown>;
      error: string;
      projects: ApsProject[];
    };

type ProjectResolution =
  | {
      status: 'resolved';
      projectId: string;
      projects: ApsProject[];
      projectName?: string;
      source: 'provided_project_id' | 'current_context' | 'last_resolved_context' | 'project_cache';
    }
  | {
      status: 'clarification';
      question: string;
      projects: ApsProject[];
    }
  | {
      status: 'error';
      error: string;
      projects: ApsProject[];
      projectName?: string;
      projectId?: string;
    };

type ProjectScopedReadMemoryKey =
  | 'recentIssues'
  | 'recentRfis'
  | 'recentSubmittals'
  | 'recentTransmittals';

type ProjectScopedReadConfig<TArgs extends { projectId: string }, TResult> = {
  intent: AgentIntent;
  toolName: ToolName;
  domain: AgentDomain;
  memoryKey: ProjectScopedReadMemoryKey;
  missingProjectQuestion: string;
  formatSuccess: (result: TResult, projectName?: string) => string;
  formatFailure: (error: string, projectId?: string, projectName?: string) => string;
  isResult: (payload: unknown) => payload is TResult;
};

type AgentOptions = {
  onToolCall?: (name: string) => void;
};

type BuildAgentMessagesOptions = {
  includeStructuredContext?: boolean;
  maxRecentMessages?: number;
  extraSystemMessages?: string[];
};

type RuntimeProjectQuery = {
  wantsProjectList: boolean;
  wantsStatusCounts: boolean;
  wantsPrefixFilter: boolean;
  prefix?: string;
  wantsProjectUsers: boolean;
  projectReference?: string;
  wantsUserCompanyCounts: boolean;
  isCompound: boolean;
};

const MAX_FREEFORM_TOOL_LOOPS = 3;
const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;
const USERS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RECENT_PROJECT_SCOPED_SNAPSHOTS = 4;
const PROJECT_ID_PATTERN = /^(b\.)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_MODES = new Set<AgentMode>(['chat', 'operate']);
const VALID_DOMAINS = new Set<AgentDomain>([
  'acc_admin',
  'issues',
  'rfis',
  'submittals',
  'transmittals',
  'auth',
  'unknown'
]);
const VALID_INTENTS = new Set<AgentIntent>([
  'list_projects',
  'get_project_users',
  'list_issues',
  'list_rfis',
  'list_submittals',
  'list_transmittals',
  'check_auth_status',
  'start_acc_user_login',
  'unknown'
]);
const PROJECT_SCOPED_TOOL_NAMES = new Set<ToolName>([
  'get_project_users',
  'get_project_issues',
  'get_project_rfis',
  'get_project_submittals',
  'get_project_transmittals'
]);
const PROJECT_SCOPED_READ_TOOL_NAMES = new Set<ToolName>([
  'get_project_issues',
  'get_project_rfis',
  'get_project_submittals',
  'get_project_transmittals'
]);
const TURN_PLAN_FORMAT = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mode',
    'domain',
    'intent',
    'confidence',
    'entities',
    'requiresTools',
    'proposedToolChain',
    'needsClarification',
    'clarificationQuestion'
  ],
  properties: {
    mode: {
      type: 'string',
      enum: ['chat', 'operate']
    },
    domain: {
      type: 'string',
      enum: ['acc_admin', 'issues', 'rfis', 'submittals', 'transmittals', 'auth', 'unknown']
    },
    intent: {
      type: 'string',
      enum: [
        'list_projects',
        'get_project_users',
        'list_issues',
        'list_rfis',
        'list_submittals',
        'list_transmittals',
        'check_auth_status',
        'start_acc_user_login',
        'unknown'
      ]
    },
    confidence: {
      type: 'number'
    },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        accountId: { type: 'string' },
        projectId: { type: 'string' },
        projectName: { type: 'string' },
        useCurrentProject: { type: 'boolean' },
        products: {
          type: 'array',
          items: { type: 'string' }
        },
        region: { type: 'string' },
        actingUserId: { type: 'string' }
      }
    },
    requiresTools: {
      type: 'boolean'
    },
    proposedToolChain: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'arguments'],
        properties: {
          name: {
            type: 'string',
            enum: [
              'get_projects_by_account',
              'get_project_users',
              'start_acc_user_login',
              'get_project_issues',
              'get_project_rfis',
              'get_project_submittals',
              'get_project_transmittals'
            ]
          },
          arguments: {
            type: 'object'
          }
        }
      }
    },
    needsClarification: {
      type: 'boolean'
    },
    clarificationQuestion: {
      type: 'string'
    }
  }
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => getTrimmedString(item))
    .filter((item): item is string => Boolean(item));

  return items.length > 0 ? items : undefined;
}

function normalizeMode(value: unknown): AgentMode | undefined {
  return typeof value === 'string' && VALID_MODES.has(value as AgentMode)
    ? (value as AgentMode)
    : undefined;
}

function normalizeDomain(value: unknown): AgentDomain | undefined {
  return typeof value === 'string' && VALID_DOMAINS.has(value as AgentDomain)
    ? (value as AgentDomain)
    : undefined;
}

function normalizeIntent(value: unknown): AgentIntent | undefined {
  return typeof value === 'string' && VALID_INTENTS.has(value as AgentIntent)
    ? (value as AgentIntent)
    : undefined;
}

function buildAgentMessages(
  sessionId: string,
  options: BuildAgentMessagesOptions = {}
): Message[] {
  const contextOptions = {
    ...(options.includeStructuredContext !== undefined
      ? { includeStructuredContext: options.includeStructuredContext }
      : {}),
    ...(options.maxRecentMessages !== undefined
      ? { maxRecentMessages: options.maxRecentMessages }
      : {})
  };
  const builtContext = buildContextForSession(sessionId, contextOptions);
  console.log(`[agent] Contexto construido para ${sessionId}: approxChars=${builtContext.approxCharCount}`);

  return [
    { role: 'system', content: systemPrompt },
    ...(options.extraSystemMessages ?? []).map((content) => ({
      role: 'system',
      content
    })),
    ...builtContext.messages
  ];
}

function stripCodeFence(content: string): string {
  return content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJsonCandidates(content: string): string[] {
  const candidates = new Set<string>();
  const trimmed = content.trim();
  if (trimmed) {
    candidates.add(stripCodeFence(trimmed));
  }

  const fencedBlocks = content.match(/```(?:json)?\s*[\s\S]*?```/gi) ?? [];
  for (const block of fencedBlocks) {
    const cleaned = stripCodeFence(block);
    if (cleaned) {
      candidates.add(cleaned);
    }
  }

  for (let start = 0; start < content.length && candidates.size < 10; start += 1) {
    const firstChar = content[start];
    if (firstChar !== '{' && firstChar !== '[') {
      continue;
    }

    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let isEscaping = false;

    for (let end = start; end < content.length; end += 1) {
      const char = content[end];

      if (inString) {
        if (isEscaping) {
          isEscaping = false;
        } else if (char === '\\') {
          isEscaping = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        braceDepth += 1;
      } else if (char === '}') {
        braceDepth -= 1;
      } else if (char === '[') {
        bracketDepth += 1;
      } else if (char === ']') {
        bracketDepth -= 1;
      }

      if (braceDepth === 0 && bracketDepth === 0) {
        const candidate = content.slice(start, end + 1).trim();
        if (candidate) {
          candidates.add(candidate);
        }
        break;
      }
    }
  }

  return [...candidates];
}

function parseJsonPayloads(content: string): unknown[] {
  const payloads: unknown[] = [];

  for (const candidate of extractJsonCandidates(content)) {
    try {
      payloads.push(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return payloads;
}

function normalizeToolRequest(raw: unknown): ToolRequest | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const name = getTrimmedString(raw.name);
  if (!name || !(name in toolHandlers)) {
    return undefined;
  }

  return {
    name: name as ToolName,
    arguments: isRecord(raw.arguments) ? raw.arguments : {}
  };
}

function extractToolRequestsFromPayload(payload: unknown): ToolRequest[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => normalizeToolRequest(item))
      .filter((item): item is ToolRequest => Boolean(item));
  }

  if (!isRecord(payload)) {
    return [];
  }

  const directRequest = normalizeToolRequest(payload);
  if (directRequest) {
    return [directRequest];
  }

  if (Array.isArray(payload.tool_calls)) {
    return payload.tool_calls
      .map((toolCall) => {
        if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
          return undefined;
        }

        return normalizeToolRequest({
          name: toolCall.function.name,
          arguments: isRecord(toolCall.function.arguments) ? toolCall.function.arguments : {}
        });
      })
      .filter((item): item is ToolRequest => Boolean(item));
  }

  if (Array.isArray(payload.proposedToolChain)) {
    return payload.proposedToolChain
      .map((step) => normalizeToolRequest(step))
      .filter((item): item is ToolRequest => Boolean(item));
  }

  return [];
}

function extractToolRequests(message: Message): ToolRequest[] {
  if (message.tool_calls?.length) {
    return message.tool_calls
      .map((toolCall) =>
        normalizeToolRequest({
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        })
      )
      .filter((item): item is ToolRequest => Boolean(item));
  }

  const deduped = new Map<string, ToolRequest>();
  for (const payload of parseJsonPayloads(message.content)) {
    for (const toolRequest of extractToolRequestsFromPayload(payload)) {
      const signature = `${toolRequest.name}:${JSON.stringify(toolRequest.arguments)}`;
      deduped.set(signature, toolRequest);
    }
  }

  return [...deduped.values()];
}

function normalizeProjectLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function dedupeProjects(projects: ApsProject[]): ApsProject[] {
  const deduped = new Map<string, ApsProject>();
  for (const project of projects) {
    deduped.set(project.id, project);
  }
  return [...deduped.values()];
}

function getProjectLifecycle(
  project: Pick<ApsProject, 'status'>
): ProjectMemoryItem['lifecycle'] {
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

function projectMemoryToProject(project: ProjectMemoryItem): ApsProject {
  return {
    id: project.id,
    name: project.name,
    ...(project.status ? { status: project.status } : {})
  };
}

function getProjectsFromMemory(sessionId: string): ApsProject[] {
  const recentProjects = getSessionContext(sessionId)?.memory_json.recentProjects ?? [];
  return dedupeProjects(recentProjects.map((project) => projectMemoryToProject(project)));
}

function getProjectsFromOperationalSources(
  sessionId: string,
  cachedProjects: ApsProject[]
): ApsProject[] {
  return dedupeProjects([
    ...cachedProjects,
    ...getProjectsFromMemory(sessionId),
    ...(getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [])
  ]);
}

function countProjectsByLifecycle(
  projects: ApsProject[]
): { active: number; archived: number; unknown: number } {
  return projects.reduce(
    (counts, project) => {
      const lifecycle = getProjectLifecycle(project);
      if (lifecycle === 'active') {
        counts.active += 1;
      } else if (lifecycle === 'archived') {
        counts.archived += 1;
      } else {
        counts.unknown += 1;
      }
      return counts;
    },
    { active: 0, archived: 0, unknown: 0 }
  );
}

function filterProjectsByPrefix(projects: ApsProject[], prefix: string): ApsProject[] {
  const normalizedPrefix = normalizeProjectLookupKey(prefix);
  if (!normalizedPrefix) {
    return [];
  }

  return dedupeProjects(projects).filter((project) =>
    normalizeProjectLookupKey(project.name).startsWith(normalizedPrefix)
  );
}

function countUsersByCompany(users: ApsProjectUser[]): Array<{ companyName: string; count: number }> {
  const grouped = new Map<string, number>();
  for (const user of users) {
    const companyName = user.companyName?.trim() || 'Sin empresa';
    grouped.set(companyName, (grouped.get(companyName) ?? 0) + 1);
  }

  return [...grouped.entries()]
    .map(([companyName, count]) => ({ companyName, count }))
    .sort((left, right) => right.count - left.count || left.companyName.localeCompare(right.companyName));
}

function buildProjectStatusLabel(project: Pick<ApsProject, 'status'>): string {
  const lifecycle = getProjectLifecycle(project);
  if (lifecycle === 'active') {
    return 'activo';
  }

  if (lifecycle === 'archived') {
    return 'archivado';
  }

  return project.status?.trim() || 'sin clasificar';
}

function extractPrefixFromText(userText: string): string | undefined {
  const explicitPatterns = [
    /siglas?\s+["“']?([A-Za-z0-9_-]{2,})["”']?/i,
    /prefijo\s+["“']?([A-Za-z0-9_-]{2,})["”']?/i,
    /(?:empiez[a-z]*|comienz[a-z]*)\s+con\s+(?:las\s+siglas\s+|la\s+sigla\s+|el\s+prefijo\s+)?["“']?([A-Za-z0-9_-]{2,})["”']?/i
  ];

  for (const pattern of explicitPatterns) {
    const explicitMatch = userText.match(pattern);
    if (explicitMatch?.[1]?.trim()) {
      return explicitMatch[1].trim();
    }
  }

  const quotedMatch = userText.match(/["“']([A-Za-z0-9_-]{2,})["”']/);
  return quotedMatch?.[1]?.trim() || undefined;
}

function extractProjectReferenceFromText(userText: string): string | undefined {
  const patterns = [
    /(?:usuarios?|users?)\s+(?:reales\s+)?(?:del|de)\s+proyecto\s+["“']?([^".,\n]+?)["”']?(?=$|[,.]|(?:\s+y\s+por\s+)|(?:\s+y\s+luego)|(?:\s+y\s+desp(?:u|ú)es)|(?:\s+y\s+finalmente))/i,
    /\bproyecto\s+["“']?([^".,\n]+?)["”']?(?=$|[,.]|(?:\s+y\s+por\s+)|(?:\s+y\s+luego)|(?:\s+y\s+desp(?:u|ú)es)|(?:\s+y\s+finalmente))/i
  ];

  for (const pattern of patterns) {
    const match = userText.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return undefined;
}

function analyzeRuntimeProjectQuery(
  userText: string,
  plan: StructuredTurnPlan
): RuntimeProjectQuery {
  const lowered = userText.toLowerCase();
  const prefix = extractPrefixFromText(userText);
  const projectReference =
    plan.entities.projectName?.trim() ||
    plan.entities.projectId?.trim() ||
    extractProjectReferenceFromText(userText);

  const wantsStatusCounts =
    /\bproyectos?\b/.test(lowered) &&
    (/\bactivos?\b/.test(lowered) ||
      /\barchivad[oa]s?\b/.test(lowered) ||
      /\binactiv[oa]s?\b/.test(lowered));
  const wantsPrefixFilter =
    Boolean(prefix) && /\b(empiez|comienz|prefijo|siglas)\b/i.test(userText);
  const wantsProjectUsers =
    plan.intent === 'get_project_users' ||
    ((/\busuarios?\b/.test(lowered) || /\busers?\b/.test(lowered)) &&
      (Boolean(projectReference) || /\bproyecto\b/.test(lowered) || plan.entities.useCurrentProject === true));
  const wantsProjectList =
    !wantsProjectUsers &&
    (plan.intent === 'list_projects' ||
      (/\bproyectos?\b/.test(lowered) &&
        /\b(hub|lista|listar|dime|mu[eé]strame|muestrame|cu[aá]les|cuales)\b/.test(lowered)));
  const wantsUserCompanyCounts =
    (/\busuarios?\b/.test(lowered) || /\busers?\b/.test(lowered)) &&
    /\b(empresas?|compa(?:ñ|n)[ií]as?|company|companies)\b/.test(lowered);
  const subtaskCount = [
    wantsProjectList,
    wantsStatusCounts,
    wantsPrefixFilter,
    wantsProjectUsers,
    wantsUserCompanyCounts
  ].filter(Boolean).length;
  const isCompound =
    subtaskCount > 1 ||
    /\b(primero|segundo|tercero|por último|por ultimo|adem[aá]s|por lo último)\b/i.test(userText);

  return {
    wantsProjectList,
    wantsStatusCounts,
    wantsPrefixFilter,
    ...(prefix ? { prefix } : {}),
    wantsProjectUsers,
    ...(projectReference ? { projectReference } : {}),
    wantsUserCompanyCounts,
    isCompound
  };
}

function formatProjectListSection(projects: ApsProject[]): string {
  const lines = [`Proyectos del hub (${projects.length}):`, ''];
  lines.push(
    ...projects.slice(0, 25).map((project) => {
      const statusLabel = buildProjectStatusLabel(project);
      return `- ${project.name} (${project.id}) [${statusLabel}]`;
    })
  );

  if (projects.length > 25) {
    lines.push('');
    lines.push(`Nota: mostré 25 proyectos; hay ${projects.length} en memoria/caché.`);
  }

  return lines.join('\n');
}

function formatProjectStatusCountsSection(projects: ApsProject[]): string {
  const counts = countProjectsByLifecycle(projects);
  const lines = ['Conteo de proyectos por estado:', ''];
  lines.push(`- Activos: ${counts.active}`);
  lines.push(`- Archivados o inactivos: ${counts.archived}`);

  if (counts.unknown > 0) {
    lines.push(`- Sin clasificar: ${counts.unknown}`);
  }

  return lines.join('\n');
}

function formatProjectPrefixSection(prefix: string, projects: ApsProject[]): string {
  const lines = [`Proyectos que empiezan con "${prefix}" (${projects.length}):`];

  if (projects.length === 0) {
    lines.push('');
    lines.push(`No encontré proyectos cuyo nombre empiece con "${prefix}".`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(...projects.map((project) => `- ${project.name} (${project.id})`));
  return lines.join('\n');
}

function formatUserCompanyCountsSection(
  projectLabel: string,
  users: ApsProjectUser[]
): string {
  const grouped = countUsersByCompany(users);
  const lines = [`Usuarios por empresa en ${projectLabel}:`, ''];
  lines.push(...grouped.map((item) => `- ${item.companyName}: ${item.count}`));
  return lines.join('\n');
}

function getFreshUsersForSessionProject(
  sessionId: string
): { projectId: string; projectName?: string; users: ApsProjectUser[] } | undefined {
  const sessionContext = getSessionContext(sessionId);
  const candidates: Array<{ projectId: string; projectName?: string }> = [];

  if (sessionContext?.current_project_id) {
    candidates.push({
      projectId: sessionContext.current_project_id,
      ...(sessionContext.current_project_name
        ? { projectName: sessionContext.current_project_name }
        : {})
    });
  }

  if (
    sessionContext?.memory_json.lastResolvedProjectId &&
    !candidates.some((candidate) => candidate.projectId === sessionContext.memory_json.lastResolvedProjectId)
  ) {
    candidates.push({
      projectId: sessionContext.memory_json.lastResolvedProjectId,
      ...(sessionContext.memory_json.lastResolvedProjectName
        ? { projectName: sessionContext.memory_json.lastResolvedProjectName }
        : {})
    });
  }

  for (const candidate of candidates) {
    const users = getFreshUsersFromCache(candidate.projectId, USERS_CACHE_TTL_MS);
    if (users) {
      return {
        projectId: candidate.projectId,
        ...(candidate.projectName ? { projectName: candidate.projectName } : {}),
        users
      };
    }
  }

  return undefined;
}

function findProjectById(projects: ApsProject[], projectId: string): ApsProject | undefined {
  const normalizedProjectId = projectId.replace(/^b\./, '');
  return dedupeProjects(projects).find((project) => project.id === normalizedProjectId);
}

function findProjectMatch(
  projects: ApsProject[],
  projectReference: string
): { project?: ApsProject; ambiguousMatches?: ApsProject[] } {
  const trimmedReference = projectReference.trim();
  if (!trimmedReference) {
    return {};
  }

  const normalizedReference = normalizeProjectLookupKey(trimmedReference);
  const uniqueProjects = dedupeProjects(projects);
  const stages = [
    uniqueProjects.filter((project) => project.id === trimmedReference.replace(/^b\./, '')),
    uniqueProjects.filter((project) => project.name === trimmedReference),
    uniqueProjects.filter((project) => project.name.toLowerCase() === trimmedReference.toLowerCase()),
    uniqueProjects.filter(
      (project) => normalizeProjectLookupKey(project.name) === normalizedReference
    ),
    uniqueProjects.filter((project) => {
      const normalizedProjectName = normalizeProjectLookupKey(project.name);
      return (
        normalizedProjectName.includes(normalizedReference) ||
        normalizedReference.includes(normalizedProjectName)
      );
    })
  ];

  for (const matches of stages) {
    const firstMatch = matches[0];
    if (matches.length === 1 && firstMatch) {
      return { project: firstMatch };
    }

    if (matches.length > 1) {
      return { ambiguousMatches: matches.slice(0, 5) };
    }
  }

  return {};
}

function createToolMessage(name: string, payload: unknown): Message {
  return {
    role: 'tool',
    tool_name: name,
    content: JSON.stringify(payload, null, 2)
  };
}

function updateProjectsMemory(sessionId: string, projects: ApsProject[]): void {
  const current = getSessionContext(sessionId);
  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId,
    memory_json: {
      ...current?.memory_json,
      recentProjects: dedupeProjects(projects).slice(0, 100).map((project) => ({
        id: project.id,
        name: project.name,
        ...(project.status ? { status: project.status } : {}),
        lifecycle: getProjectLifecycle(project)
      }))
    }
  });
}

function buildProjectAliasCandidates(projectId: string, projectName?: string): string[] {
  const aliases = new Set<string>([projectId]);
  if (projectName?.trim()) {
    aliases.add(projectName.trim());
    const tokens = projectName
      .split(/[\s:()_-]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3);
    for (const token of tokens.slice(0, 8)) {
      aliases.add(token);
    }
  }

  return [...aliases].slice(0, 10);
}

function updateProjectSelectionMemory(
  sessionId: string,
  projectId: string,
  projectName?: string
): void {
  const current = getSessionContext(sessionId);
  const nextMemory = {
    ...current?.memory_json,
    lastResolvedProjectId: projectId,
    currentProjectAliases: buildProjectAliasCandidates(projectId, projectName),
    currentProjectConfidence: projectName ? 1 : 0.85,
    currentProjectUpdatedAt: new Date().toISOString()
  };

  if (projectName) {
    nextMemory.lastResolvedProjectName = projectName;
  } else {
    delete nextMemory.lastResolvedProjectName;
  }

  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId,
    current_project_id: projectId,
    current_project_name: projectName ?? null,
    memory_json: nextMemory
  });
}

function updateUsersMemory(
  sessionId: string,
  result: GetProjectUsersToolResult,
  projectName?: string
): void {
  const current = getSessionContext(sessionId);
  const existing = (current?.memory_json.recentUsers ?? []).filter(
    (snapshot) => snapshot.projectId !== result.projectId
  );
  const nextSnapshots = [
    {
      ...result,
      ...(projectName ? { projectName } : {}),
      fetchedAt: new Date().toISOString()
    },
    ...existing
  ].slice(0, MAX_RECENT_PROJECT_SCOPED_SNAPSHOTS);

  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId,
    memory_json: {
      ...current?.memory_json,
      recentUsers: nextSnapshots
    }
  });
}

function getProjectScopedReadMemory<TItem extends ProjectScopedReadItemBase>(
  sessionId: string,
  key: ProjectScopedReadMemoryKey
): ProjectScopedReadMemory<TItem>[] {
  const sessionContext = getSessionContext(sessionId);
  const value = sessionContext?.memory_json[key];
  return Array.isArray(value) ? (value as ProjectScopedReadMemory<TItem>[]) : [];
}

function updateProjectScopedReadMemory<TItem extends ProjectScopedReadItemBase>(
  sessionId: string,
  key: ProjectScopedReadMemoryKey,
  result: ProjectScopedReadToolResult<TItem>,
  projectName?: string
): void {
  const current = getSessionContext(sessionId);
  const existing = getProjectScopedReadMemory<TItem>(sessionId, key).filter(
    (snapshot) => snapshot.projectId !== result.projectId
  );
  const nextSnapshots: ProjectScopedReadMemory<TItem>[] = [
    {
      ...result,
      ...(projectName ? { projectName } : {}),
      fetchedAt: new Date().toISOString()
    },
    ...existing
  ].slice(0, MAX_RECENT_PROJECT_SCOPED_SNAPSHOTS);

  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId,
    memory_json: {
      ...current?.memory_json,
      [key]: nextSnapshots
    }
  });
}

function getRecentProjectScopedReadByProjectId<TItem extends ProjectScopedReadItemBase>(
  sessionId: string,
  key: ProjectScopedReadMemoryKey,
  projectId: string
): ProjectScopedReadMemory<TItem> | undefined {
  return getProjectScopedReadMemory<TItem>(sessionId, key).find(
    (snapshot) => snapshot.projectId === projectId.replace(/^b\./, '')
  );
}

function getPreferredProjectScopedReadMemory<TItem extends ProjectScopedReadItemBase>(
  sessionId: string,
  key: ProjectScopedReadMemoryKey
): ProjectScopedReadMemory<TItem> | undefined {
  const sessionContext = getSessionContext(sessionId);
  const recentSnapshots = getProjectScopedReadMemory<TItem>(sessionId, key);
  const currentProjectId = sessionContext?.current_project_id;
  if (currentProjectId) {
    const currentSnapshot = recentSnapshots.find((snapshot) => snapshot.projectId === currentProjectId);
    if (currentSnapshot) {
      return currentSnapshot;
    }
  }

  const lastResolvedProjectId = sessionContext?.memory_json.lastResolvedProjectId;
  if (lastResolvedProjectId) {
    const lastResolvedSnapshot = recentSnapshots.find(
      (snapshot) => snapshot.projectId === lastResolvedProjectId
    );
    if (lastResolvedSnapshot) {
      return lastResolvedSnapshot;
    }
  }

  return recentSnapshots[0];
}

async function syncConstructionAuthSessionMetadata(sessionId: string): Promise<void> {
  const authStatus = await getConstructionAuthStatus();
  const current = getSessionContext(sessionId);
  const nextMemory = {
    ...current?.memory_json,
    authMode: authStatus.authMode,
    authReadyForConstructionEndpoints: authStatus.readyForConstructionEndpoints,
    authPendingLogin: authStatus.pendingLogin
  };

  if (authStatus.profileId) {
    nextMemory.authProfileId = authStatus.profileId;
  } else {
    delete nextMemory.authProfileId;
  }

  if (authStatus.displayName) {
    nextMemory.authDisplayName = authStatus.displayName;
  } else {
    delete nextMemory.authDisplayName;
  }

  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId,
    memory_json: nextMemory
  });
}

async function resolveProjectId(
  projectIdOrName: string,
  cachedProjects: ApsProject[]
): Promise<{ projectId: string; projectName?: string; projects: ApsProject[] }> {
  const normalizedReference = projectIdOrName.trim();
  if (!normalizedReference) {
    throw new Error('No se recibió una referencia de proyecto para resolver projectId');
  }

  const localProjects =
    cachedProjects.length > 0
      ? cachedProjects
      : (getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? []);

  if (PROJECT_ID_PATTERN.test(normalizedReference)) {
    const normalizedProjectId = normalizedReference.replace(/^b\./, '');
    const matchedProject = findProjectById(localProjects, normalizedProjectId);

    return {
      projectId: normalizedProjectId,
      projects: localProjects,
      ...(matchedProject?.name ? { projectName: matchedProject.name } : {})
    };
  }

  const initialMatch = findProjectMatch(localProjects, normalizedReference);
  if (initialMatch.project) {
    return {
      projectId: initialMatch.project.id,
      projectName: initialMatch.project.name,
      projects: localProjects
    };
  }

  if (initialMatch.ambiguousMatches?.length) {
    throw new Error(
      `Encontré varios proyectos para "${normalizedReference}": ${initialMatch.ambiguousMatches.map((project) => project.name).join(', ')}.`
    );
  }

  await getProjectsByAccountTool({});
  const refreshedProjects =
    getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? localProjects;
  const refreshedMatch = findProjectMatch(refreshedProjects, normalizedReference);

  if (refreshedMatch.project) {
    return {
      projectId: refreshedMatch.project.id,
      projectName: refreshedMatch.project.name,
      projects: refreshedProjects
    };
  }

  if (refreshedMatch.ambiguousMatches?.length) {
    throw new Error(
      `Encontré varios proyectos para "${normalizedReference}": ${refreshedMatch.ambiguousMatches.map((project) => project.name).join(', ')}.`
    );
  }

  throw new Error(
    `No pude resolver un projectId para "${normalizedReference}". Usa un nombre exacto del proyecto o un projectId explícito.`
  );
}

function resolveProjectFromLocalSources(
  sessionId: string,
  projectReference: string,
  cachedProjects: ApsProject[] = []
): { projectId: string; projectName: string; projects: ApsProject[] } | undefined {
  const localProjects = getProjectsFromOperationalSources(sessionId, cachedProjects);
  const match = findProjectMatch(localProjects, projectReference);
  if (!match.project) {
    return undefined;
  }

  return {
    projectId: match.project.id,
    projectName: match.project.name,
    projects: localProjects
  };
}

async function maybeResolveToolArguments(
  toolRequest: ToolRequest,
  cachedProjects: ApsProject[]
): Promise<{
  args: Record<string, unknown>;
  projects: ApsProject[];
  resolvedProjectName?: string;
}> {
  if (!PROJECT_SCOPED_TOOL_NAMES.has(toolRequest.name)) {
    return {
      args: toolRequest.arguments,
      projects: cachedProjects
    };
  }

  const currentArgs = toolRequest.arguments as { projectId?: string };
  const projectIdOrName = currentArgs.projectId?.trim();
  if (!projectIdOrName) {
    throw new Error(`${toolRequest.name} requiere projectId`);
  }

  const resolved = await resolveProjectId(projectIdOrName, cachedProjects);
  return {
    args: {
      ...currentArgs,
      projectId: resolved.projectId
    },
    projects: resolved.projects,
    ...(resolved.projectName ? { resolvedProjectName: resolved.projectName } : {})
  };
}

function inferIntentFromToolChain(toolChain: PlannedToolCall[]): AgentIntent {
  if (toolChain.some((step) => step.name === 'start_acc_user_login')) {
    return 'start_acc_user_login';
  }

  if (toolChain.some((step) => step.name === 'get_project_transmittals')) {
    return 'list_transmittals';
  }

  if (toolChain.some((step) => step.name === 'get_project_submittals')) {
    return 'list_submittals';
  }

  if (toolChain.some((step) => step.name === 'get_project_rfis')) {
    return 'list_rfis';
  }

  if (toolChain.some((step) => step.name === 'get_project_issues')) {
    return 'list_issues';
  }

  if (toolChain.some((step) => step.name === 'get_project_users')) {
    return 'get_project_users';
  }

  if (toolChain.some((step) => step.name === 'get_projects_by_account')) {
    return 'list_projects';
  }

  return 'unknown';
}

function normalizePlannedToolCall(raw: unknown): PlannedToolCall | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const name = getTrimmedString(raw.name);
  if (!name || !(name in toolHandlers)) {
    return undefined;
  }

  return {
    name,
    arguments: isRecord(raw.arguments) ? raw.arguments : {}
  };
}

function normalizeTurnPlan(raw: unknown): StructuredTurnPlan | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const rawEntities = isRecord(raw.entities) ? raw.entities : {};
  const proposedToolChain = Array.isArray(raw.proposedToolChain)
    ? raw.proposedToolChain
        .map((step) => normalizePlannedToolCall(step))
        .filter((step): step is PlannedToolCall => Boolean(step))
    : [];

  let intent = normalizeIntent(raw.intent) ?? inferIntentFromToolChain(proposedToolChain);
  let mode = normalizeMode(raw.mode) ?? (intent === 'unknown' ? 'chat' : 'operate');
  let domain = normalizeDomain(raw.domain) ?? (intent === 'unknown' ? 'unknown' : 'acc_admin');
  let projectId = getTrimmedString(rawEntities.projectId);
  let projectName = getTrimmedString(rawEntities.projectName);

  if (projectId && !PROJECT_ID_PATTERN.test(projectId) && !projectName) {
    projectName = projectId;
    projectId = undefined;
  }

  const entities = {
    ...(getTrimmedString(rawEntities.accountId)
      ? { accountId: getTrimmedString(rawEntities.accountId) }
      : {}),
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(getBoolean(rawEntities.useCurrentProject) !== undefined
      ? { useCurrentProject: getBoolean(rawEntities.useCurrentProject) }
      : {}),
    ...(getStringArray(rawEntities.products) ? { products: getStringArray(rawEntities.products) } : {}),
    ...(getTrimmedString(rawEntities.region)
      ? { region: getTrimmedString(rawEntities.region) }
      : {}),
    ...(getTrimmedString(rawEntities.actingUserId)
      ? { actingUserId: getTrimmedString(rawEntities.actingUserId) }
      : {})
  };

  let requiresTools =
    getBoolean(raw.requiresTools) ??
    (mode === 'operate' &&
      [
        'list_projects',
        'get_project_users',
        'list_issues',
        'list_rfis',
        'list_submittals',
        'list_transmittals',
        'check_auth_status',
        'start_acc_user_login'
      ].includes(intent));
  let needsClarification = getBoolean(raw.needsClarification) ?? false;
  let clarificationQuestion = getTrimmedString(raw.clarificationQuestion);

  if (intent === 'list_projects') {
    mode = 'operate';
    domain = 'acc_admin';
  }

  if (intent === 'get_project_users') {
    mode = 'operate';
    domain = 'acc_admin';

    if (!entities.projectId && !entities.projectName && !entities.useCurrentProject) {
      needsClarification = true;
      clarificationQuestion ??= '¿De qué proyecto quieres que obtenga los usuarios?';
    }
  }

  if (intent === 'list_issues') {
    mode = 'operate';
    domain = 'issues';

    if (!entities.projectId && !entities.projectName && !entities.useCurrentProject) {
      needsClarification = true;
      clarificationQuestion ??= '¿De qué proyecto quieres que consulte los issues?';
    }
  }

  if (intent === 'list_rfis') {
    mode = 'operate';
    domain = 'rfis';

    if (!entities.projectId && !entities.projectName && !entities.useCurrentProject) {
      needsClarification = true;
      clarificationQuestion ??= '¿De qué proyecto quieres que consulte los RFIs?';
    }
  }

  if (intent === 'list_submittals') {
    mode = 'operate';
    domain = 'submittals';

    if (!entities.projectId && !entities.projectName && !entities.useCurrentProject) {
      needsClarification = true;
      clarificationQuestion ??= '¿De qué proyecto quieres que consulte los submittals?';
    }
  }

  if (intent === 'list_transmittals') {
    mode = 'operate';
    domain = 'transmittals';

    if (!entities.projectId && !entities.projectName && !entities.useCurrentProject) {
      needsClarification = true;
      clarificationQuestion ??= '¿De qué proyecto quieres que consulte los transmittals?';
    }
  }

  if (intent === 'start_acc_user_login') {
    mode = 'operate';
    domain = 'auth';
    needsClarification = false;
    clarificationQuestion = undefined;
    requiresTools = true;
  }

  if (intent === 'check_auth_status') {
    mode = 'operate';
    domain = 'auth';
    needsClarification = false;
    clarificationQuestion = undefined;
    requiresTools = false;
  }

  if (mode === 'chat') {
    requiresTools = false;
    needsClarification = false;
    clarificationQuestion = undefined;
  }

  if (mode === 'operate' && intent === 'unknown' && !needsClarification && !requiresTools) {
    mode = 'chat';
  }

  if (mode === 'operate' && intent === 'unknown' && !needsClarification) {
    needsClarification = true;
    clarificationQuestion = '¿Qué operación de ACC quieres que ejecute exactamente?';
  }

  if (needsClarification && !clarificationQuestion) {
    clarificationQuestion =
      intent === 'get_project_users'
        ? '¿De qué proyecto quieres que obtenga los usuarios?'
        : intent === 'list_issues'
          ? '¿De qué proyecto quieres que consulte los issues?'
          : intent === 'list_rfis'
            ? '¿De qué proyecto quieres que consulte los RFIs?'
            : intent === 'list_submittals'
              ? '¿De qué proyecto quieres que consulte los submittals?'
              : intent === 'list_transmittals'
                ? '¿De qué proyecto quieres que consulte los transmittals?'
                : intent === 'start_acc_user_login'
                  ? '¿Quieres que inicie la autenticación ACC 3-legged?'
        : '¿Qué dato de ACC quieres consultar?';
  }

  const confidence =
    typeof raw.confidence === 'number'
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0;
  const normalizedToolChain =
    proposedToolChain.length > 0
      ? proposedToolChain
      : intent === 'list_projects'
        ? [{ name: 'get_projects_by_account', arguments: {} }]
        : intent === 'get_project_users'
          ? [{ name: 'get_project_users', arguments: {} }]
          : intent === 'list_issues'
            ? [{ name: 'get_project_issues', arguments: {} }]
            : intent === 'list_rfis'
              ? [{ name: 'get_project_rfis', arguments: {} }]
              : intent === 'list_submittals'
                ? [{ name: 'get_project_submittals', arguments: {} }]
                : intent === 'list_transmittals'
                  ? [{ name: 'get_project_transmittals', arguments: {} }]
                  : intent === 'start_acc_user_login'
                    ? [{ name: 'start_acc_user_login', arguments: {} }]
                    : intent === 'check_auth_status'
                      ? []
          : [];

  return {
    mode,
    domain,
    intent,
    confidence,
    entities,
    requiresTools,
    proposedToolChain: mode === 'operate' ? normalizedToolChain : [],
    needsClarification,
    ...(clarificationQuestion ? { clarificationQuestion } : {})
  };
}

async function interpretTurn(
  sessionId: string
): Promise<{ plan: StructuredTurnPlan; raw: ChatResponse }> {
  const workingSetSummary = buildPlannerWorkingSetSummary(sessionId);
  const messages = buildAgentMessages(sessionId, {
    includeStructuredContext: true,
    maxRecentMessages: 6,
    extraSystemMessages: [
      ...(workingSetSummary ? [workingSetSummary] : []),
      turnPlannerPrompt
    ]
  });
  const response = await chatWithOllama(messages, {
    format: TURN_PLAN_FORMAT,
    responseProfile: 'planner'
  });
  const parsedPayload = parseJsonPayloads(response.message.content).find((payload) => isRecord(payload));
  const plan = normalizeTurnPlan(parsedPayload);

  if (!plan) {
    throw new Error('No pude validar la interpretación estructurada del turno.');
  }

  if (!plan.entities.projectId && plan.entities.projectName?.trim()) {
    const localProjectMatch = resolveProjectFromLocalSources(sessionId, plan.entities.projectName);
    if (localProjectMatch) {
      console.log(
        `[agent] Planner devolvio projectName=${plan.entities.projectName}; cache local resolvio projectId=${localProjectMatch.projectId}`
      );
      plan.entities.projectId = localProjectMatch.projectId;
      plan.entities.projectName = localProjectMatch.projectName;
      plan.needsClarification = false;
      plan.clarificationQuestion = undefined;
    }
  }

  console.log(
    `[agent] Plan estructurado: mode=${plan.mode} intent=${plan.intent} requiresTools=${plan.requiresTools} needsClarification=${plan.needsClarification}`
  );

  return {
    plan,
    raw: response
  };
}

function finalizeAgentResult(
  sessionId: string,
  text: string,
  toolCalls: string[],
  raw?: ChatResponse
): AgentResult {
  addMessage(sessionId, 'assistant', text);
  touchSession(sessionId);

  return {
    text,
    toolCalls,
    ...(raw ? { raw } : {})
  };
}

function isGetProjectsToolResult(payload: unknown): payload is GetProjectsToolResult {
  return isRecord(payload) && typeof payload.count === 'number' && Array.isArray(payload.projects);
}

function isGetProjectUsersToolResult(payload: unknown): payload is GetProjectUsersToolResult {
  return (
    isRecord(payload) &&
    typeof payload.count === 'number' &&
    typeof payload.projectId === 'string' &&
    Array.isArray(payload.users)
  );
}

function isStartAccUserLoginToolResult(payload: unknown): payload is StartAccUserLoginToolResult {
  return (
    isRecord(payload) &&
    typeof payload.status === 'string' &&
    typeof payload.authReady === 'boolean' &&
    typeof payload.callbackUrl === 'string' &&
    typeof payload.authorizationUrl === 'string' &&
    typeof payload.message === 'string'
  );
}

function isProjectScopedReadToolResult<TItem>(
  payload: unknown
): payload is ProjectScopedReadToolResult<TItem> {
  return (
    isRecord(payload) &&
    typeof payload.projectId === 'string' &&
    typeof payload.total === 'number' &&
    typeof payload.source === 'string' &&
    Array.isArray(payload.items)
  );
}

function isGetProjectIssuesToolResult(payload: unknown): payload is GetProjectIssuesToolResult {
  return isProjectScopedReadToolResult(payload);
}

function isGetProjectRfisToolResult(payload: unknown): payload is GetProjectRfisToolResult {
  return isProjectScopedReadToolResult(payload);
}

function isGetProjectSubmittalsToolResult(
  payload: unknown
): payload is GetProjectSubmittalsToolResult {
  return isProjectScopedReadToolResult(payload);
}

function isGetProjectTransmittalsToolResult(
  payload: unknown
): payload is GetProjectTransmittalsToolResult {
  return isProjectScopedReadToolResult(payload);
}

function formatProjectsResponse(result: GetProjectsToolResult): string {
  const lines = [
    result.count === 0
      ? 'No encontré proyectos en el hub configurado.'
      : `Encontré ${result.count} proyectos en el hub configurado.`
  ];

  if (result.projects.length > 0) {
    lines.push('');
    lines.push(...result.projects.map((project) => `- ${project.name} (${project.id})`));
  }

  if (result.note) {
    lines.push('');
    lines.push(`Nota: ${result.note}`);
  }

  return lines.join('\n');
}

function formatUsersResponse(
  result: GetProjectUsersToolResult,
  projectName?: string
): string {
  const projectLabel = projectName
    ? `${projectName} (${result.projectId})`
    : result.projectId;
  const lines = [
    result.count === 0
      ? `No encontré usuarios para el proyecto ${projectLabel}.`
      : `Encontré ${result.count} usuarios en el proyecto ${projectLabel}.`
  ];

  if (result.users.length > 0) {
    lines.push('');
    lines.push(
      ...result.users.map((user) => {
        const parts = [user.name ?? user.email ?? user.id];
        if (user.email) {
          parts.push(user.email);
        }
        if (user.companyName) {
          parts.push(user.companyName);
        }
        if (user.status) {
          parts.push(user.status);
        }
        return `- ${parts.join(' | ')}`;
      })
    );
  }

  if (result.note) {
    lines.push('');
    lines.push(`Nota: ${result.note}`);
  }

  return lines.join('\n');
}

function formatStartAccUserLoginResponse(result: StartAccUserLoginToolResult): string {
  const lines = [result.message];

  if (result.displayName || result.profileId) {
    lines.push('');
    lines.push(`Perfil: ${result.displayName ?? result.profileId}`);
  }

  if (result.authorizationUrl) {
    lines.push('');
    lines.push(`URL de autorización: ${result.authorizationUrl}`);
  }

  lines.push('');
  lines.push(`Callback local: ${result.callbackUrl}`);
  return lines.join('\n');
}

async function formatAuthStatusResponse(): Promise<string> {
  const status = await getConstructionAuthStatus();
  const lines = [status.message];

  lines.push('');
  lines.push(`Modo actual: ${status.authMode}`);
  lines.push(`Auth lista para construction endpoints: ${status.readyForConstructionEndpoints ? 'sí' : 'no'}`);

  if (status.displayName || status.profileId) {
    lines.push(`Perfil: ${status.displayName ?? status.profileId}`);
  }

  if (status.expiresAt) {
    lines.push(`Expira: ${status.expiresAt}`);
  }

  return lines.join('\n');
}

function formatProjectScopedReadLine(
  item: ProjectScopedReadItemBase & Record<string, unknown>
): string {
  const parts = [item.id];
  if (typeof item.title === 'string' && item.title.trim()) {
    parts.push(item.title);
  }
  if (typeof item.status === 'string' && item.status.trim()) {
    parts.push(item.status);
  }

  const detailFields = ['type', 'assignedTo', 'location', 'response', 'spec', 'manager', 'createdBy', 'dueDate'];
  for (const field of detailFields) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) {
      parts.push(value);
    }
  }

  return `- ${parts.join(' | ')}`;
}

function formatProjectScopedReadResponse<TItem extends ProjectScopedReadItemBase & Record<string, unknown>>(
  label: string,
  result: ProjectScopedReadToolResult<TItem>,
  projectName?: string
): string {
  const projectLabel = projectName ? `${projectName} (${result.projectId})` : result.projectId;
  const lines = [
    result.total === 0
      ? `No encontré ${label} para el proyecto ${projectLabel}.`
      : `Encontré ${result.total} ${label} en el proyecto ${projectLabel}.`
  ];

  if (result.items.length > 0) {
    lines.push('');
    lines.push(...result.items.map((item) => formatProjectScopedReadLine(item)));
  }

  if (result.warning) {
    lines.push('');
    lines.push(`Aviso: ${result.warning}`);
  }

  return lines.join('\n');
}

function formatIssuesResponse(result: GetProjectIssuesToolResult, projectName?: string): string {
  return formatProjectScopedReadResponse('issues', result, projectName);
}

function formatRfisResponse(result: GetProjectRfisToolResult, projectName?: string): string {
  return formatProjectScopedReadResponse('RFIs', result, projectName);
}

function formatSubmittalsResponse(
  result: GetProjectSubmittalsToolResult,
  projectName?: string
): string {
  return formatProjectScopedReadResponse('submittals', result, projectName);
}

function formatTransmittalsResponse(
  result: GetProjectTransmittalsToolResult,
  projectName?: string
): string {
  return formatProjectScopedReadResponse('transmittals', result, projectName);
}

function formatProjectsFailure(error: string): string {
  return `No pude listar los proyectos del hub. Falló el paso get_projects_by_account: ${error}`;
}

function formatProjectUsersFailure(
  error: string,
  projectId?: string,
  projectName?: string
): string {
  const projectLabel =
    projectName && projectId ? `${projectName} (${projectId})` : projectName ?? projectId ?? 'solicitado';
  return `No pude obtener los usuarios del proyecto ${projectLabel}. Falló el paso get_project_users: ${error}`;
}

function formatProjectScopedReadFailure(
  label: string,
  toolName: ToolName,
  error: string,
  projectId?: string,
  projectName?: string
): string {
  const projectLabel =
    projectName && projectId ? `${projectName} (${projectId})` : projectName ?? projectId ?? 'solicitado';
  return `No pude obtener ${label} del proyecto ${projectLabel}. Falló el paso ${toolName}: ${error}`;
}

function formatProjectResolutionQuestion(projectReference: string, matches?: ApsProject[]): string {
  if (matches?.length) {
    return `Encontré varios proyectos que podrían coincidir con "${projectReference}": ${matches.map((project) => project.name).join(', ')}. ¿Cuál quieres usar?`;
  }

  return `No pude resolver un projectId confiable para "${projectReference}". Si quieres, indícame el nombre exacto del proyecto o el projectId.`;
}

const PROJECT_SCOPED_READ_CONFIGS: ProjectScopedReadConfig<
  | GetProjectIssuesToolArgs
  | GetProjectRfisToolArgs
  | GetProjectSubmittalsToolArgs
  | GetProjectTransmittalsToolArgs,
  | GetProjectIssuesToolResult
  | GetProjectRfisToolResult
  | GetProjectSubmittalsToolResult
  | GetProjectTransmittalsToolResult
>[] = [
  {
    intent: 'list_issues',
    toolName: 'get_project_issues',
    domain: 'issues',
    memoryKey: 'recentIssues',
    missingProjectQuestion: '¿De qué proyecto quieres que consulte los issues?',
    formatSuccess: (result, projectName) =>
      formatIssuesResponse(result as GetProjectIssuesToolResult, projectName),
    formatFailure: (error, projectId, projectName) =>
      formatProjectScopedReadFailure(
        'los issues',
        'get_project_issues',
        error,
        projectId,
        projectName
      ),
    isResult: isGetProjectIssuesToolResult
  },
  {
    intent: 'list_rfis',
    toolName: 'get_project_rfis',
    domain: 'rfis',
    memoryKey: 'recentRfis',
    missingProjectQuestion: '¿De qué proyecto quieres que consulte los RFIs?',
    formatSuccess: (result, projectName) =>
      formatRfisResponse(result as GetProjectRfisToolResult, projectName),
    formatFailure: (error, projectId, projectName) =>
      formatProjectScopedReadFailure('los RFIs', 'get_project_rfis', error, projectId, projectName),
    isResult: isGetProjectRfisToolResult
  },
  {
    intent: 'list_submittals',
    toolName: 'get_project_submittals',
    domain: 'submittals',
    memoryKey: 'recentSubmittals',
    missingProjectQuestion: '¿De qué proyecto quieres que consulte los submittals?',
    formatSuccess: (result, projectName) =>
      formatSubmittalsResponse(result as GetProjectSubmittalsToolResult, projectName),
    formatFailure: (error, projectId, projectName) =>
      formatProjectScopedReadFailure(
        'los submittals',
        'get_project_submittals',
        error,
        projectId,
        projectName
      ),
    isResult: isGetProjectSubmittalsToolResult
  },
  {
    intent: 'list_transmittals',
    toolName: 'get_project_transmittals',
    domain: 'transmittals',
    memoryKey: 'recentTransmittals',
    missingProjectQuestion: '¿De qué proyecto quieres que consulte los transmittals?',
    formatSuccess: (result, projectName) =>
      formatTransmittalsResponse(result as GetProjectTransmittalsToolResult, projectName),
    formatFailure: (error, projectId, projectName) =>
      formatProjectScopedReadFailure(
        'los transmittals',
        'get_project_transmittals',
        error,
        projectId,
        projectName
      ),
    isResult: isGetProjectTransmittalsToolResult
  }
];

async function getConstructionAuthMissingMessage(): Promise<string> {
  const authStatus = await getConstructionAuthStatus();
  return authStatus.pendingLogin
    ? 'Hay una autenticación ACC 3-legged pendiente en el navegador. Complétala y luego vuelve a pedir la consulta.'
    : 'Necesito autenticación ACC de usuario para consultar Issues, RFIs, Submittals o Transmittals. Ejecuta start_acc_user_login.';
}

async function runDirectConversation(
  sessionId: string,
  resolvedContextSummary: string,
  profile: 'chat' | 'operate'
): Promise<AgentResult> {
  const response = await generateFinalResponse({
    sessionId,
    profile,
    resolvedContextSummary,
    ...(profile === 'chat'
      ? { additionalGuidance: 'Si el turno es social, responde con naturalidad y sin sonar mecanico.' }
      : {})
  });
  const finalText =
    response.message.content.trim() || 'No pude generar una respuesta útil para este turno.';

  return finalizeAgentResult(sessionId, finalText, [], response);
}

async function executeToolRequest(
  sessionId: string,
  toolRequest: ToolRequest,
  cachedProjects: ApsProject[],
  options: AgentOptions
): Promise<ToolExecutionResult> {
  options.onToolCall?.(toolRequest.name);

  try {
    const resolved = await maybeResolveToolArguments(toolRequest, cachedProjects);
    const toolResult = await toolHandlers[toolRequest.name](resolved.args as never);

    addToolCall(
      sessionId,
      toolRequest.name,
      JSON.stringify(resolved.args),
      summarizeToolResultForStorage(toolRequest.name, toolResult)
    );

    let nextProjects = resolved.projects;
    if (toolRequest.name === 'get_projects_by_account') {
      nextProjects =
        getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ??
        (isGetProjectsToolResult(toolResult) ? toolResult.projects : resolved.projects);
      updateProjectsMemory(sessionId, nextProjects);
      registerProjectsSnapshot(sessionId, nextProjects);
      saveWorkingSet(sessionId, {
        sourceDomain: 'projects',
        itemIds: nextProjects.map((project) => project.id),
        itemCount: nextProjects.length,
        appliedFilters: [],
        derivedFromQuery: 'tool:get_projects_by_account',
        displaySummary: `projects:${nextProjects.length}`
      });
    }

    if (toolRequest.name === 'get_project_users') {
      const toolArgs = resolved.args as GetProjectUsersToolArgs;
      updateProjectSelectionMemory(
        sessionId,
        toolArgs.projectId.replace(/^b\./, ''),
        resolved.resolvedProjectName
      );

      if (isGetProjectUsersToolResult(toolResult)) {
        updateUsersMemory(sessionId, toolResult, resolved.resolvedProjectName);
        registerUsersSnapshot(sessionId, toolResult, resolved.resolvedProjectName);
        saveWorkingSet(sessionId, {
          sourceDomain: 'users',
          sourceProjectId: toolResult.projectId,
          ...(resolved.resolvedProjectName ? { sourceProjectName: resolved.resolvedProjectName } : {}),
          itemIds: toolResult.users.map((user) => user.id),
          itemCount: toolResult.users.length,
          appliedFilters: [],
          derivedFromQuery: 'tool:get_project_users',
          displaySummary: `users:${toolResult.users.length}`
        });
      }
    }

    if (
      PROJECT_SCOPED_READ_TOOL_NAMES.has(toolRequest.name) &&
      isProjectScopedReadToolResult<ProjectScopedReadItemBase>(toolResult)
    ) {
      updateProjectSelectionMemory(
        sessionId,
        toolResult.projectId.replace(/^b\./, ''),
        resolved.resolvedProjectName
      );

      const memoryKeyByToolName: Record<
        Extract<ToolName, 'get_project_issues' | 'get_project_rfis' | 'get_project_submittals' | 'get_project_transmittals'>,
        ProjectScopedReadMemoryKey
      > = {
        get_project_issues: 'recentIssues',
        get_project_rfis: 'recentRfis',
        get_project_submittals: 'recentSubmittals',
        get_project_transmittals: 'recentTransmittals'
      };

      updateProjectScopedReadMemory(
        sessionId,
        memoryKeyByToolName[
          toolRequest.name as Extract<
            ToolName,
            | 'get_project_issues'
            | 'get_project_rfis'
            | 'get_project_submittals'
            | 'get_project_transmittals'
          >
        ],
        toolResult,
        resolved.resolvedProjectName
      );

      const snapshotDomainByToolName: Record<
        Extract<ToolName, 'get_project_issues' | 'get_project_rfis' | 'get_project_submittals' | 'get_project_transmittals'>,
        'issues' | 'rfis' | 'submittals' | 'transmittals'
      > = {
        get_project_issues: 'issues',
        get_project_rfis: 'rfis',
        get_project_submittals: 'submittals',
        get_project_transmittals: 'transmittals'
      };
      const snapshotEntityTypeByToolName: Record<
        Extract<ToolName, 'get_project_issues' | 'get_project_rfis' | 'get_project_submittals' | 'get_project_transmittals'>,
        'issue' | 'rfi' | 'submittal' | 'transmittal'
      > = {
        get_project_issues: 'issue',
        get_project_rfis: 'rfi',
        get_project_submittals: 'submittal',
        get_project_transmittals: 'transmittal'
      };

      registerProjectScopedReadSnapshot(sessionId, {
        domain:
          snapshotDomainByToolName[
            toolRequest.name as Extract<
              ToolName,
              'get_project_issues' | 'get_project_rfis' | 'get_project_submittals' | 'get_project_transmittals'
            >
          ],
        entityType:
          snapshotEntityTypeByToolName[
            toolRequest.name as Extract<
              ToolName,
              'get_project_issues' | 'get_project_rfis' | 'get_project_submittals' | 'get_project_transmittals'
          >
        ],
        result: toolResult,
        ...(resolved.resolvedProjectName ? { projectName: resolved.resolvedProjectName } : {})
      });

      saveWorkingSet(sessionId, {
        sourceDomain:
          snapshotDomainByToolName[
            toolRequest.name as Extract<
              ToolName,
              'get_project_issues' | 'get_project_rfis' | 'get_project_submittals' | 'get_project_transmittals'
            >
          ],
        sourceProjectId: toolResult.projectId,
        ...(resolved.resolvedProjectName ? { sourceProjectName: resolved.resolvedProjectName } : {}),
        itemIds: toolResult.items.map((item) => item.id),
        itemCount: toolResult.items.length,
        appliedFilters: [],
        derivedFromQuery: `tool:${toolRequest.name}`,
        displaySummary: `${toolRequest.name}:${toolResult.items.length}`
      });
    }

    if (toolRequest.name === 'start_acc_user_login' || PROJECT_SCOPED_READ_TOOL_NAMES.has(toolRequest.name)) {
      await syncConstructionAuthSessionMetadata(sessionId);
    }

    return {
      ok: true,
      name: toolRequest.name,
      args: resolved.args,
      payload: toolResult,
      projects: nextProjects,
      ...(resolved.resolvedProjectName ? { resolvedProjectName: resolved.resolvedProjectName } : {})
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error ejecutando tool';

    addToolCall(
      sessionId,
      toolRequest.name,
      JSON.stringify(toolRequest.arguments),
      `${toolRequest.name}: error ${errorMessage}`
    );

    if (toolRequest.name === 'start_acc_user_login' || PROJECT_SCOPED_READ_TOOL_NAMES.has(toolRequest.name)) {
      await syncConstructionAuthSessionMetadata(sessionId);
    }

    return {
      ok: false,
      name: toolRequest.name,
      args: toolRequest.arguments,
      error: errorMessage,
      projects: cachedProjects
    };
  }
}

async function callToolAndTrack(
  sessionId: string,
  toolRequest: ToolRequest,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions
): Promise<ToolExecutionResult> {
  usedTools.push(toolRequest.name);
  return executeToolRequest(sessionId, toolRequest, cachedProjects, options);
}

async function resolveProjectForScopedTool(
  sessionId: string,
  plan: StructuredTurnPlan,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions,
  missingProjectQuestion: string
): Promise<ProjectResolution> {
  const sessionContext = getSessionContext(sessionId);
  const localProjects = getProjectsFromOperationalSources(sessionId, cachedProjects);
  const reliableCurrentProject =
    sessionContext?.current_project_id
      ? {
          id: sessionContext.current_project_id,
          name: sessionContext.current_project_name ?? undefined
        }
      : undefined;
  const lastResolvedProject =
    sessionContext?.memory_json.lastResolvedProjectId
      ? {
          id: sessionContext.memory_json.lastResolvedProjectId,
          name: sessionContext.memory_json.lastResolvedProjectName ?? undefined
        }
      : undefined;

  if (plan.entities.projectId && PROJECT_ID_PATTERN.test(plan.entities.projectId)) {
    const projectId = plan.entities.projectId.replace(/^b\./, '');
    const knownProjects = dedupeProjects([
      ...localProjects,
      ...(reliableCurrentProject ? [{ id: reliableCurrentProject.id, name: reliableCurrentProject.name ?? projectId }] : []),
      ...(lastResolvedProject ? [{ id: lastResolvedProject.id, name: lastResolvedProject.name ?? lastResolvedProject.id }] : [])
    ]);
    const knownProject = findProjectById(knownProjects, projectId);

    updateProjectSelectionMemory(sessionId, projectId, knownProject?.name);

    return {
      status: 'resolved',
      projectId,
      projects: localProjects,
      source: 'provided_project_id',
      ...(knownProject?.name ? { projectName: knownProject.name } : {})
    };
  }

  const requestedProjectName = plan.entities.projectName?.trim();

  const contextProjects: ApsProject[] = dedupeProjects([
    ...localProjects,
    ...(reliableCurrentProject
      ? [{ id: reliableCurrentProject.id, name: reliableCurrentProject.name ?? reliableCurrentProject.id }]
      : []),
    ...(lastResolvedProject
      ? [{ id: lastResolvedProject.id, name: lastResolvedProject.name ?? lastResolvedProject.id }]
      : [])
  ]);

  if (requestedProjectName) {
    const contextMatch = findProjectMatch(contextProjects, requestedProjectName);
    if (contextMatch.project) {
      console.log(
        `[agent] resolveProjectForScopedTool uso cache local para projectName=${requestedProjectName}; projectId=${contextMatch.project.id}`
      );
      updateProjectSelectionMemory(sessionId, contextMatch.project.id, contextMatch.project.name);
      return {
        status: 'resolved',
        projectId: contextMatch.project.id,
        projectName: contextMatch.project.name,
        projects: localProjects,
        source: reliableCurrentProject?.id === contextMatch.project.id ? 'current_context' : 'project_cache'
      };
    }

    if (contextMatch.ambiguousMatches?.length) {
      return {
        status: 'clarification',
        question: formatProjectResolutionQuestion(requestedProjectName, contextMatch.ambiguousMatches),
        projects: localProjects
      };
    }
  }

  if (plan.entities.useCurrentProject) {
    if (reliableCurrentProject) {
      updateProjectSelectionMemory(sessionId, reliableCurrentProject.id, reliableCurrentProject.name);
      return {
        status: 'resolved',
        projectId: reliableCurrentProject.id,
        projects: localProjects,
        source: 'current_context',
        ...(reliableCurrentProject.name ? { projectName: reliableCurrentProject.name } : {})
      };
    }

    if (lastResolvedProject) {
      updateProjectSelectionMemory(sessionId, lastResolvedProject.id, lastResolvedProject.name);
      return {
        status: 'resolved',
        projectId: lastResolvedProject.id,
        projects: localProjects,
        source: 'last_resolved_context',
        ...(lastResolvedProject.name ? { projectName: lastResolvedProject.name } : {})
      };
    }

    return {
      status: 'clarification',
      question: 'No tengo un proyecto actual confiable en esta sesión. ¿Qué proyecto quieres usar?',
      projects: cachedProjects
    };
  }

  if (!requestedProjectName) {
    return {
      status: 'clarification',
      question: missingProjectQuestion,
      projects: localProjects
    };
  }

  const cachedOrFreshProjects =
    localProjects.length > 0
      ? localProjects
      : (getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? []);
  const cacheMatch = findProjectMatch(cachedOrFreshProjects, requestedProjectName);
  if (cacheMatch.project) {
    updateProjectSelectionMemory(sessionId, cacheMatch.project.id, cacheMatch.project.name);
    return {
      status: 'resolved',
      projectId: cacheMatch.project.id,
      projectName: cacheMatch.project.name,
      projects: cachedOrFreshProjects,
      source: 'project_cache'
    };
  }

  if (cacheMatch.ambiguousMatches?.length) {
    return {
      status: 'clarification',
      question: formatProjectResolutionQuestion(requestedProjectName, cacheMatch.ambiguousMatches),
      projects: cachedOrFreshProjects
    };
  }

  const projectsLookup = await callToolAndTrack(
    sessionId,
    {
      name: 'get_projects_by_account',
      arguments: {
        ...(plan.entities.actingUserId ? { actingUserId: plan.entities.actingUserId } : {})
      }
    },
    cachedOrFreshProjects,
    usedTools,
    options
  );

  if (!projectsLookup.ok) {
    return {
      status: 'error',
      error: `No pude resolver el projectId para "${requestedProjectName}" porque falló get_projects_by_account: ${projectsLookup.error}`,
      projects: projectsLookup.projects,
      projectName: requestedProjectName
    };
  }

  const refreshedProjects = projectsLookup.projects;
  const refreshedMatch = findProjectMatch(refreshedProjects, requestedProjectName);
  if (refreshedMatch.project) {
    updateProjectSelectionMemory(sessionId, refreshedMatch.project.id, refreshedMatch.project.name);
    return {
      status: 'resolved',
      projectId: refreshedMatch.project.id,
      projectName: refreshedMatch.project.name,
      projects: refreshedProjects,
      source: 'project_cache'
    };
  }

  if (refreshedMatch.ambiguousMatches?.length) {
    return {
      status: 'clarification',
      question: formatProjectResolutionQuestion(requestedProjectName, refreshedMatch.ambiguousMatches),
      projects: refreshedProjects
    };
  }

  return {
    status: 'clarification',
    question: formatProjectResolutionQuestion(requestedProjectName),
    projects: refreshedProjects
  };
}

async function resolveProjectForUsers(
  sessionId: string,
  plan: StructuredTurnPlan,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions
): Promise<ProjectResolution> {
  return resolveProjectForScopedTool(
    sessionId,
    plan,
    cachedProjects,
    usedTools,
    options,
    '¿De qué proyecto quieres que obtenga los usuarios?'
  );
}

async function ensureProjectsAvailable(
  sessionId: string,
  plan: StructuredTurnPlan,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions
): Promise<
  | {
      ok: true;
      projects: ApsProject[];
    }
  | {
      ok: false;
      error: string;
      projects: ApsProject[];
    }
> {
  const localProjects = getProjectsFromOperationalSources(sessionId, cachedProjects);
  if (localProjects.length > 0) {
    return {
      ok: true,
      projects: localProjects
    };
  }

  const projectsLookup = await callToolAndTrack(
    sessionId,
    {
      name: 'get_projects_by_account',
      arguments: {
        ...(plan.entities.actingUserId ? { actingUserId: plan.entities.actingUserId } : {})
      }
    },
    localProjects,
    usedTools,
    options
  );

  if (!projectsLookup.ok) {
    return {
      ok: false,
      error: projectsLookup.error,
      projects: projectsLookup.projects
    };
  }

  return {
    ok: true,
    projects: projectsLookup.projects
  };
}

async function maybeHandleRuntimeProjectQuery(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions,
  planningResponse?: ChatResponse
): Promise<AgentResult | undefined> {
  const runtimeQuery = analyzeRuntimeProjectQuery(userText, plan);
  const shouldHandle =
    runtimeQuery.isCompound ||
    runtimeQuery.wantsStatusCounts ||
    runtimeQuery.wantsPrefixFilter ||
    runtimeQuery.wantsUserCompanyCounts ||
    runtimeQuery.wantsProjectUsers ||
    (plan.intent === 'list_projects' && !plan.requiresTools);

  if (!shouldHandle) {
    return undefined;
  }

  const sections: string[] = [];
  let localProjects = getProjectsFromOperationalSources(sessionId, cachedProjects);
  const needsProjectsData =
    runtimeQuery.wantsProjectList ||
    runtimeQuery.wantsStatusCounts ||
    runtimeQuery.wantsPrefixFilter ||
    Boolean(runtimeQuery.projectReference) ||
    (runtimeQuery.wantsProjectUsers && !plan.entities.useCurrentProject);

  if (needsProjectsData && localProjects.length === 0) {
    const ensuredProjects = await ensureProjectsAvailable(
      sessionId,
      plan,
      localProjects,
      usedTools,
      options
    );

    if (!ensuredProjects.ok) {
      return finalizeAgentResult(
        sessionId,
        formatProjectsFailure(ensuredProjects.error),
        usedTools,
        planningResponse
      );
    }

    localProjects = ensuredProjects.projects;
  }

  if (runtimeQuery.wantsProjectList && localProjects.length > 0) {
    sections.push(formatProjectListSection(localProjects));
  }

  if (runtimeQuery.wantsStatusCounts) {
    if (localProjects.length === 0) {
      return finalizeAgentResult(
        sessionId,
        'Necesito una lista confiable de proyectos para contar activos y archivados.',
        usedTools,
        planningResponse
      );
    }

    sections.push(formatProjectStatusCountsSection(localProjects));
  }

  if (runtimeQuery.wantsPrefixFilter) {
    if (localProjects.length === 0 || !runtimeQuery.prefix) {
      return finalizeAgentResult(
        sessionId,
        'Necesito una lista confiable de proyectos y un prefijo claro para filtrar.',
        usedTools,
        planningResponse
      );
    }

    sections.push(
      formatProjectPrefixSection(
        runtimeQuery.prefix,
        filterProjectsByPrefix(localProjects, runtimeQuery.prefix)
      )
    );
  }

  const shouldFetchUsers =
    runtimeQuery.wantsProjectUsers ||
    (runtimeQuery.wantsUserCompanyCounts &&
      (Boolean(runtimeQuery.projectReference) || plan.entities.useCurrentProject === true));

  if (shouldFetchUsers) {
    const effectivePlan: StructuredTurnPlan =
      runtimeQuery.projectReference && !plan.entities.projectId && !plan.entities.projectName
        ? {
            ...plan,
            mode: 'operate',
            domain: 'acc_admin',
            intent: 'get_project_users',
            requiresTools: true,
            needsClarification: false,
            entities: {
              ...plan.entities,
              projectName: runtimeQuery.projectReference
            }
          }
        : {
            ...plan,
            mode: 'operate',
            domain: 'acc_admin',
            intent: 'get_project_users',
            requiresTools: true,
            needsClarification: false
          };

    const projectResolution = await resolveProjectForUsers(
      sessionId,
      effectivePlan,
      localProjects,
      usedTools,
      options
    );
    localProjects = projectResolution.projects;

    if (projectResolution.status === 'clarification') {
      if (sections.length > 0) {
        sections.push(projectResolution.question);
        return finalizeAgentResult(sessionId, sections.join('\n\n'), usedTools, planningResponse);
      }

      return finalizeAgentResult(
        sessionId,
        projectResolution.question,
        usedTools,
        planningResponse
      );
    }

    if (projectResolution.status === 'error') {
      if (sections.length > 0) {
        sections.push(projectResolution.error);
        return finalizeAgentResult(sessionId, sections.join('\n\n'), usedTools, planningResponse);
      }

      return finalizeAgentResult(
        sessionId,
        projectResolution.error,
        usedTools,
        planningResponse
      );
    }

    const usersResult = await callToolAndTrack(
      sessionId,
      {
        name: 'get_project_users',
        arguments: {
          projectId: projectResolution.projectId,
          ...(plan.entities.products ? { products: plan.entities.products } : {}),
          ...(plan.entities.region ? { region: plan.entities.region } : {}),
          ...(plan.entities.actingUserId ? { actingUserId: plan.entities.actingUserId } : {})
        }
      },
      localProjects,
      usedTools,
      options
    );

    if (!usersResult.ok) {
      const failure = formatProjectUsersFailure(
        usersResult.error,
        projectResolution.projectId,
        projectResolution.projectName
      );

      if (sections.length > 0) {
        sections.push(failure);
        return finalizeAgentResult(sessionId, sections.join('\n\n'), usedTools, planningResponse);
      }

      return finalizeAgentResult(sessionId, failure, usedTools, planningResponse);
    }

    if (!isGetProjectUsersToolResult(usersResult.payload)) {
      const failure =
        'No pude formatear el resultado de get_project_users porque la tool devolvió un payload inesperado.';

      if (sections.length > 0) {
        sections.push(failure);
        return finalizeAgentResult(sessionId, sections.join('\n\n'), usedTools, planningResponse);
      }

      return finalizeAgentResult(sessionId, failure, usedTools, planningResponse);
    }

    if (runtimeQuery.wantsProjectUsers) {
      sections.push(
        formatUsersResponse(
          usersResult.payload,
          projectResolution.projectName ?? usersResult.resolvedProjectName
        )
      );
    }

    if (runtimeQuery.wantsUserCompanyCounts) {
      const freshUsers =
        getFreshUsersFromCache(projectResolution.projectId, USERS_CACHE_TTL_MS) ??
        usersResult.payload.users;
      const projectLabel =
        projectResolution.projectName ??
        usersResult.resolvedProjectName ??
        projectResolution.projectId;
      sections.push(formatUserCompanyCountsSection(projectLabel, freshUsers));
    }
  } else if (runtimeQuery.wantsUserCompanyCounts) {
    const cachedUsers = getFreshUsersForSessionProject(sessionId);
    if (!cachedUsers) {
      return finalizeAgentResult(
        sessionId,
        'Necesito una lista reciente de usuarios de un proyecto para contarlos por empresa.',
        usedTools,
        planningResponse
      );
    }

    const projectLabel =
      cachedUsers.projectName ?? cachedUsers.projectId;
    sections.push(formatUserCompanyCountsSection(projectLabel, cachedUsers.users));
  }

  if (sections.length === 0) {
    return undefined;
  }

  return finalizeAgentResult(sessionId, sections.join('\n\n'), usedTools, planningResponse);
}

async function executeProjectScopedReadIntent<
  TArgs extends { projectId: string },
  TResult extends ProjectScopedReadToolResult<ProjectScopedReadItemBase>
>(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions,
  planningResponse: ChatResponse | undefined,
  executionMode: AgentExecutionMode,
  config: ProjectScopedReadConfig<TArgs, TResult>
): Promise<AgentResult> {
  const projectResolution = await resolveProjectForScopedTool(
    sessionId,
    plan,
    cachedProjects,
    usedTools,
    options,
    config.missingProjectQuestion
  );

  if (projectResolution.status === 'clarification') {
    return finalizeAgentResult(sessionId, projectResolution.question, usedTools, planningResponse);
  }

  if (projectResolution.status === 'error') {
    return finalizeAgentResult(sessionId, projectResolution.error, usedTools, planningResponse);
  }

  const recentResult = getRecentProjectScopedReadByProjectId<ProjectScopedReadItemBase>(
    sessionId,
    config.memoryKey,
    projectResolution.projectId
  );
  if (!plan.requiresTools && recentResult) {
    return finalizeAgentResult(
      sessionId,
      config.formatSuccess(
        recentResult as unknown as TResult,
        projectResolution.projectName ?? recentResult.projectName
      ),
      usedTools,
      planningResponse
    );
  }

  const authStatus = await getConstructionAuthStatus();
  if (!authStatus.readyForConstructionEndpoints) {
    await syncConstructionAuthSessionMetadata(sessionId);
    return finalizeAgentResult(
      sessionId,
      await getConstructionAuthMissingMessage(),
      usedTools,
      planningResponse
    );
  }

  const toolResult = await callToolAndTrack(
    sessionId,
    {
      name: config.toolName,
      arguments: {
        projectId: projectResolution.projectId
      }
    },
    projectResolution.projects,
    usedTools,
    options
  );

  if (!toolResult.ok) {
    return finalizeAgentResult(
      sessionId,
      config.formatFailure(
        toolResult.error,
        projectResolution.projectId,
        projectResolution.projectName
      ),
      usedTools,
      planningResponse
    );
  }

  if (!config.isResult(toolResult.payload)) {
    return finalizeAgentResult(
      sessionId,
      `No pude formatear el resultado de ${config.toolName} porque la tool devolvió un payload inesperado.`,
      usedTools,
      planningResponse
    );
  }

  if (executionMode === 'fetch_then_analyze') {
    const localAnswer = await tryRunLocalSnapshotQuery(sessionId, userText, plan);
    if (localAnswer) {
      return finalizeAgentResult(sessionId, localAnswer, usedTools, planningResponse);
    }
  }

  return finalizeAgentResult(
    sessionId,
    config.formatSuccess(
      toolResult.payload,
      projectResolution.projectName ?? toolResult.resolvedProjectName
    ),
    usedTools,
    planningResponse
  );
}

async function executeOperationalPlan(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan,
  executionMode: AgentExecutionMode,
  options: AgentOptions,
  planningResponse?: ChatResponse
): Promise<AgentResult> {
  const usedTools: string[] = [];
  let cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [];

  const runtimeQueryResult = await maybeHandleRuntimeProjectQuery(
    sessionId,
    userText,
    plan,
    cachedProjects,
    usedTools,
    options,
    planningResponse
  );
  if (runtimeQueryResult) {
    return runtimeQueryResult;
  }

  if (plan.intent === 'list_projects') {
    const projectsResult = await callToolAndTrack(
      sessionId,
      {
        name: 'get_projects_by_account',
        arguments: {
          ...(plan.entities.actingUserId ? { actingUserId: plan.entities.actingUserId } : {})
        }
      },
      cachedProjects,
      usedTools,
      options
    );

    if (!projectsResult.ok) {
      return finalizeAgentResult(
        sessionId,
        formatProjectsFailure(projectsResult.error),
        usedTools,
        planningResponse
      );
    }

    cachedProjects = projectsResult.projects;
    if (!isGetProjectsToolResult(projectsResult.payload)) {
      return finalizeAgentResult(
        sessionId,
        'No pude formatear el resultado de get_projects_by_account porque la tool devolvió un payload inesperado.',
        usedTools,
        planningResponse
      );
    }

    return finalizeAgentResult(
      sessionId,
      formatProjectsResponse(projectsResult.payload),
      usedTools,
      planningResponse
    );
  }

  if (plan.intent === 'get_project_users') {
    const projectResolution = await resolveProjectForUsers(
      sessionId,
      plan,
      cachedProjects,
      usedTools,
      options
    );
    cachedProjects = projectResolution.projects;

    if (projectResolution.status === 'clarification') {
      return finalizeAgentResult(
        sessionId,
        projectResolution.question,
        usedTools,
        planningResponse
      );
    }

    if (projectResolution.status === 'error') {
      return finalizeAgentResult(
        sessionId,
        projectResolution.error,
        usedTools,
        planningResponse
      );
    }

    const usersResult = await callToolAndTrack(
      sessionId,
      {
        name: 'get_project_users',
        arguments: {
          projectId: projectResolution.projectId,
          ...(plan.entities.products ? { products: plan.entities.products } : {}),
          ...(plan.entities.region ? { region: plan.entities.region } : {}),
          ...(plan.entities.actingUserId ? { actingUserId: plan.entities.actingUserId } : {})
        }
      },
      cachedProjects,
      usedTools,
      options
    );

    if (!usersResult.ok) {
      return finalizeAgentResult(
        sessionId,
        formatProjectUsersFailure(
          usersResult.error,
          projectResolution.projectId,
          projectResolution.projectName
        ),
        usedTools,
        planningResponse
      );
    }

    if (!isGetProjectUsersToolResult(usersResult.payload)) {
      return finalizeAgentResult(
        sessionId,
        'No pude formatear el resultado de get_project_users porque la tool devolvió un payload inesperado.',
        usedTools,
        planningResponse
      );
    }

    return finalizeAgentResult(
      sessionId,
      formatUsersResponse(
        usersResult.payload,
        projectResolution.projectName ?? usersResult.resolvedProjectName
      ),
      usedTools,
      planningResponse
    );
  }

  if (plan.intent === 'start_acc_user_login') {
    const loginResult = await callToolAndTrack(
      sessionId,
      {
        name: 'start_acc_user_login',
        arguments: {}
      },
      cachedProjects,
      usedTools,
      options
    );

    if (!loginResult.ok) {
      return finalizeAgentResult(
        sessionId,
        `No pude iniciar la autenticación ACC 3-legged. ${loginResult.error}`,
        usedTools,
        planningResponse
      );
    }

    if (!isStartAccUserLoginToolResult(loginResult.payload)) {
      return finalizeAgentResult(
        sessionId,
        'No pude formatear el resultado de start_acc_user_login porque la tool devolvió un payload inesperado.',
        usedTools,
        planningResponse
      );
    }

    return finalizeAgentResult(
      sessionId,
      formatStartAccUserLoginResponse(loginResult.payload),
      usedTools,
      planningResponse
    );
  }

  if (plan.intent === 'check_auth_status') {
    return finalizeAgentResult(
      sessionId,
      await formatAuthStatusResponse(),
      usedTools,
      planningResponse
    );
  }

  const readConfig = PROJECT_SCOPED_READ_CONFIGS.find((config) => config.intent === plan.intent);
  if (readConfig) {
    return executeProjectScopedReadIntent(
      sessionId,
      userText,
      plan,
      cachedProjects,
      usedTools,
      options,
      planningResponse,
      executionMode,
      readConfig as ProjectScopedReadConfig<
        { projectId: string },
        ProjectScopedReadToolResult<ProjectScopedReadItemBase>
      >
    );
  }

  return finalizeAgentResult(
    sessionId,
    plan.clarificationQuestion ?? 'Necesito un poco más de contexto para ejecutar esa operación ACC.',
    usedTools,
    planningResponse
  );
}

async function runFreeformToolFallback(
  sessionId: string,
  options: AgentOptions
): Promise<AgentResult> {
  const messages = buildAgentMessages(sessionId, {
    includeStructuredContext: true,
    maxRecentMessages: 6
  });
  const usedTools: string[] = [];
  let cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [];
  let lastResponse: ChatResponse | undefined;

  for (let loop = 0; loop < MAX_FREEFORM_TOOL_LOOPS; loop += 1) {
    const response = await chatWithOllama(messages, {
      tools: toolDefinitions
    });
    lastResponse = response;
    messages.push(response.message);

    const toolRequests = extractToolRequests(response.message);
    if (toolRequests.length === 0) {
      const finalText =
        response.message.content.trim() ||
        'No pude generar una respuesta final después de intentar usar tools.';
      return finalizeAgentResult(sessionId, finalText, usedTools, response);
    }

    for (const toolRequest of toolRequests) {
      const toolResult = await callToolAndTrack(
        sessionId,
        toolRequest,
        cachedProjects,
        usedTools,
        options
      );
      cachedProjects = toolResult.projects;

      messages.push(
        createToolMessage(
          toolRequest.name,
          toolResult.ok ? toolResult.payload : { error: toolResult.error }
        )
      );
    }
  }

  return finalizeAgentResult(
    sessionId,
    'Se alcanzó el límite de iteraciones de tools sin una respuesta final.',
    usedTools,
    lastResponse
  );
}

export async function runAgent(
  sessionId: string,
  userText: string,
  options: AgentOptions = {}
): Promise<AgentResult> {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error(`La sesión ${sessionId} no existe`);
  }

  addMessage(sessionId, 'user', userText);
  updateSessionAfterUserMessage(sessionId, userText);
  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId
  });
  await syncConstructionAuthSessionMetadata(sessionId);

  const fastConversationRoute = routePureConversation(userText);
  if (
    fastConversationRoute?.kind === 'greeting' ||
    fastConversationRoute?.kind === 'thanks' ||
    fastConversationRoute?.kind === 'goodbye' ||
    fastConversationRoute?.kind === 'small_talk'
  ) {
    return finalizeAgentResult(sessionId, fastConversationRoute.message, [], undefined);
  }

  if (fastConversationRoute?.kind === 'auth_status') {
    return finalizeAgentResult(sessionId, await formatAuthStatusResponse(), [], undefined);
  }

  if (fastConversationRoute?.kind === 'auth_start') {
    const usedTools: string[] = [];
    const loginResult = await callToolAndTrack(
      sessionId,
      {
        name: 'start_acc_user_login',
        arguments: {}
      },
      getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [],
      usedTools,
      options
    );

    if (!loginResult.ok) {
      return finalizeAgentResult(
        sessionId,
        `No pude iniciar la autenticación ACC 3-legged. ${loginResult.error}`,
        usedTools,
        undefined
      );
    }

    if (!isStartAccUserLoginToolResult(loginResult.payload)) {
      return finalizeAgentResult(
        sessionId,
        'No pude formatear el resultado de start_acc_user_login porque la tool devolvió un payload inesperado.',
        usedTools,
        undefined
      );
    }

    return finalizeAgentResult(
      sessionId,
      formatStartAccUserLoginResponse(loginResult.payload),
      usedTools,
      undefined
    );
  }

  let plan: StructuredTurnPlan | undefined;
  let planningResponse: ChatResponse | undefined;

  try {
    const interpreted = await interpretTurn(sessionId);
    plan = interpreted.plan;
    planningResponse = interpreted.raw;
    const analysis = analyzeTurn(sessionId, userText, plan);
    const evidence = await resolveEvidence(sessionId, analysis);
    const actionDecision: ActionDecision = decideAction(analysis, evidence);
    const resolvedContextSummary = buildResolvedContextSummary({
      sessionId,
      plan,
      evidence,
      action: actionDecision
    });
    const runtimeQuery = analyzeRuntimeProjectQuery(userText, plan);
    const hasProjectContext = getProjectsFromOperationalSources(sessionId, []).length > 0;
    const hasUserContext = Boolean(getFreshUsersForSessionProject(sessionId));
    const hasProjectScopedReadContext = Boolean(
      getPreferredProjectScopedReadMemory(sessionId, 'recentIssues') ??
        getPreferredProjectScopedReadMemory(sessionId, 'recentRfis') ??
        getPreferredProjectScopedReadMemory(sessionId, 'recentSubmittals') ??
        getPreferredProjectScopedReadMemory(sessionId, 'recentTransmittals')
    );
    const shouldHandleAsAccOperation =
      (plan.mode !== 'chat' && plan.domain !== 'unknown' && plan.intent !== 'unknown') ||
      actionDecision.kind === 'answer_local' ||
      actionDecision.kind === 'answer_from_raw' ||
      actionDecision.kind === 'fetch_external' ||
      actionDecision.kind === 'fetch_then_analyze' ||
      actionDecision.kind === 'request_auth' ||
      ((runtimeQuery.isCompound ||
        runtimeQuery.wantsStatusCounts ||
        runtimeQuery.wantsPrefixFilter ||
        runtimeQuery.wantsProjectUsers ||
        runtimeQuery.wantsUserCompanyCounts) &&
        (hasProjectContext || hasUserContext || hasProjectScopedReadContext));

    console.log(
      `[agent] Estrategia runtime: action=${actionDecision.kind} executionMode=${actionDecision.executionMode} intent=${plan.intent} reason=${actionDecision.reason}`
    );

    if (actionDecision.kind === 'answer_chat') {
      if (!analysis.socialIntent) {
        return runDirectConversation(sessionId, resolvedContextSummary, 'chat');
      }
      return finalizeAgentResult(sessionId, actionDecision.message, [], planningResponse);
    }

    if (actionDecision.kind === 'ask_clarification' && !shouldHandleAsAccOperation) {
      return finalizeAgentResult(
        sessionId,
        actionDecision.message,
        [],
        planningResponse
      );
    }

    if (actionDecision.kind === 'request_auth') {
      return finalizeAgentResult(sessionId, actionDecision.message, [], planningResponse);
    }

    if (actionDecision.kind === 'answer_local') {
      const localAnswer = await tryRunLocalSnapshotQuery(sessionId, userText, plan);
      if (localAnswer) {
        return finalizeAgentResult(sessionId, localAnswer, [], planningResponse);
      }
    }

    if (actionDecision.kind === 'answer_from_raw') {
      const localAnswer = await tryRunLocalSnapshotQuery(sessionId, userText, plan);
      if (localAnswer) {
        return finalizeAgentResult(sessionId, localAnswer, [], planningResponse);
      }
    }

    if (plan.mode === 'chat' && !shouldHandleAsAccOperation) {
      return runDirectConversation(sessionId, resolvedContextSummary, 'chat');
    }

    if (!shouldHandleAsAccOperation) {
      return runDirectConversation(
        sessionId,
        resolvedContextSummary,
        actionDecision.executionMode === 'chat' ? 'chat' : 'operate'
      );
    }

    return executeOperationalPlan(
      sessionId,
      userText,
      plan,
      actionDecision.executionMode,
      options,
      planningResponse
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Fallo la planificación estructurada del turno';

    if (plan?.mode === 'chat' && plan.requiresTools === false) {
      console.warn(`[agent] Se omite fallback libre para chat sin tools: ${errorMessage}`);
      return finalizeAgentResult(
        sessionId,
        'No pude responder este turno por un error interno al generar la respuesta.',
        [],
        planningResponse
      );
    }

    console.warn(`[agent] Fallback a tool-calling libre: ${errorMessage}`);
    return runFreeformToolFallback(sessionId, options);
  }
}
