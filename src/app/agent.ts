import type { ChatResponse, Message } from 'ollama';
import { env } from '../config/env.js';
import { getSessionContext, upsertSessionContext } from '../db/repositories/contextRepo.js';
import { addMessage } from '../db/repositories/messagesRepo.js';
import { getFreshProjectsFromCache } from '../db/repositories/projectCacheRepo.js';
import { getSessionById, touchSession, updateSessionAfterUserMessage } from '../db/repositories/sessionsRepo.js';
import { addToolCall } from '../db/repositories/toolCallsRepo.js';
import { systemPrompt, turnPlannerPrompt } from '../prompts/systemPrompt.js';
import { buildContextForSession } from '../services/contextBuilder.js';
import { chatWithOllama } from '../services/ollamaClient.js';
import { getProjectsByAccountTool } from '../tools/getProjectsTool.js';
import { toolDefinitions, toolHandlers } from '../tools/index.js';
import type {
  AgentResult,
  ApsProject,
  GetProjectUsersToolArgs,
  GetProjectUsersToolResult,
  GetProjectsToolArgs,
  GetProjectsToolResult
} from '../types/aps.js';
import type {
  AgentDomain,
  AgentIntent,
  AgentMode,
  PlannedToolCall,
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

type AgentOptions = {
  onToolCall?: (name: string) => void;
};

type BuildAgentMessagesOptions = {
  includeStructuredContext?: boolean;
  maxRecentMessages?: number;
  extraSystemMessages?: string[];
};

const MAX_FREEFORM_TOOL_LOOPS = 3;
const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;
const PROJECT_ID_PATTERN = /^(b\.)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_MODES = new Set<AgentMode>(['chat', 'operate']);
const VALID_DOMAINS = new Set<AgentDomain>(['acc_admin', 'unknown']);
const VALID_INTENTS = new Set<AgentIntent>(['list_projects', 'get_project_users', 'unknown']);
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
      enum: ['acc_admin', 'unknown']
    },
    intent: {
      type: 'string',
      enum: ['list_projects', 'get_project_users', 'unknown']
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
            enum: ['get_projects_by_account', 'get_project_users']
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
      recentProjects: projects.slice(0, 5).map((project) => ({
        id: project.id,
        name: project.name
      }))
    }
  });
}

function updateProjectSelectionMemory(
  sessionId: string,
  projectId: string,
  projectName?: string
): void {
  const current = getSessionContext(sessionId);
  const nextMemory = {
    ...current?.memory_json,
    lastResolvedProjectId: projectId
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

async function maybeResolveToolArguments(
  toolRequest: ToolRequest,
  cachedProjects: ApsProject[]
): Promise<{
  args: Record<string, unknown>;
  projects: ApsProject[];
  resolvedProjectName?: string;
}> {
  if (toolRequest.name !== 'get_project_users') {
    return {
      args: toolRequest.arguments,
      projects: cachedProjects
    };
  }

  const currentArgs = toolRequest.arguments as GetProjectUsersToolArgs;
  const projectIdOrName = currentArgs.projectId?.trim();
  if (!projectIdOrName) {
    throw new Error('get_project_users requiere projectId');
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
    (mode === 'operate' && (intent === 'list_projects' || intent === 'get_project_users'));
  let needsClarification = getBoolean(raw.needsClarification) ?? false;
  let clarificationQuestion = getTrimmedString(raw.clarificationQuestion);

  if (intent === 'list_projects') {
    mode = 'operate';
    domain = 'acc_admin';
    requiresTools = true;
  }

  if (intent === 'get_project_users') {
    mode = 'operate';
    domain = 'acc_admin';
    requiresTools = true;

    if (!entities.projectId && !entities.projectName && !entities.useCurrentProject) {
      needsClarification = true;
      clarificationQuestion ??= '¿De qué proyecto quieres que obtenga los usuarios?';
    }
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
  const messages = buildAgentMessages(sessionId, {
    includeStructuredContext: true,
    maxRecentMessages: 6,
    extraSystemMessages: [turnPlannerPrompt]
  });
  const response = await chatWithOllama(messages, {
    format: TURN_PLAN_FORMAT
  });
  const parsedPayload = parseJsonPayloads(response.message.content).find((payload) => isRecord(payload));
  const plan = normalizeTurnPlan(parsedPayload);

  if (!plan) {
    throw new Error('No pude validar la interpretación estructurada del turno.');
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

function formatProjectResolutionQuestion(projectReference: string, matches?: ApsProject[]): string {
  if (matches?.length) {
    return `Encontré varios proyectos que podrían coincidir con "${projectReference}": ${matches.map((project) => project.name).join(', ')}. ¿Cuál quieres usar?`;
  }

  return `No pude resolver un projectId confiable para "${projectReference}". Si quieres, indícame el nombre exacto del proyecto o el projectId.`;
}

async function runDirectConversation(
  sessionId: string,
  includeStructuredContext: boolean
): Promise<AgentResult> {
  const messages = buildAgentMessages(sessionId, {
    includeStructuredContext,
    maxRecentMessages: includeStructuredContext ? 6 : 4
  });
  const response = await chatWithOllama(messages);
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
    }

    if (toolRequest.name === 'get_project_users') {
      const toolArgs = resolved.args as GetProjectUsersToolArgs;
      updateProjectSelectionMemory(
        sessionId,
        toolArgs.projectId.replace(/^b\./, ''),
        resolved.resolvedProjectName
      );
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

async function resolveProjectForUsers(
  sessionId: string,
  plan: StructuredTurnPlan,
  cachedProjects: ApsProject[],
  usedTools: string[],
  options: AgentOptions
): Promise<ProjectResolution> {
  const sessionContext = getSessionContext(sessionId);
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
      ...cachedProjects,
      ...(reliableCurrentProject ? [{ id: reliableCurrentProject.id, name: reliableCurrentProject.name ?? projectId }] : []),
      ...(lastResolvedProject ? [{ id: lastResolvedProject.id, name: lastResolvedProject.name ?? lastResolvedProject.id }] : [])
    ]);
    const knownProject = findProjectById(knownProjects, projectId);

    updateProjectSelectionMemory(sessionId, projectId, knownProject?.name);

    return {
      status: 'resolved',
      projectId,
      projects: cachedProjects,
      source: 'provided_project_id',
      ...(knownProject?.name ? { projectName: knownProject.name } : {})
    };
  }

  if (plan.entities.useCurrentProject) {
    if (reliableCurrentProject) {
      updateProjectSelectionMemory(sessionId, reliableCurrentProject.id, reliableCurrentProject.name);
      return {
        status: 'resolved',
        projectId: reliableCurrentProject.id,
        projects: cachedProjects,
        source: 'current_context',
        ...(reliableCurrentProject.name ? { projectName: reliableCurrentProject.name } : {})
      };
    }

    if (lastResolvedProject) {
      updateProjectSelectionMemory(sessionId, lastResolvedProject.id, lastResolvedProject.name);
      return {
        status: 'resolved',
        projectId: lastResolvedProject.id,
        projects: cachedProjects,
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

  const requestedProjectName = plan.entities.projectName?.trim();
  if (!requestedProjectName) {
    return {
      status: 'clarification',
      question: '¿De qué proyecto quieres que obtenga los usuarios?',
      projects: cachedProjects
    };
  }

  const contextProjects: ApsProject[] = [
    ...(reliableCurrentProject
      ? [{ id: reliableCurrentProject.id, name: reliableCurrentProject.name ?? reliableCurrentProject.id }]
      : []),
    ...(lastResolvedProject
      ? [{ id: lastResolvedProject.id, name: lastResolvedProject.name ?? lastResolvedProject.id }]
      : [])
  ];
  const contextMatch = findProjectMatch(contextProjects, requestedProjectName);
  if (contextMatch.project) {
    updateProjectSelectionMemory(sessionId, contextMatch.project.id, contextMatch.project.name);
    return {
      status: 'resolved',
      projectId: contextMatch.project.id,
      projectName: contextMatch.project.name,
      projects: cachedProjects,
      source: reliableCurrentProject?.id === contextMatch.project.id ? 'current_context' : 'last_resolved_context'
    };
  }

  const cachedOrFreshProjects =
    cachedProjects.length > 0
      ? cachedProjects
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

async function executeOperationalPlan(
  sessionId: string,
  plan: StructuredTurnPlan,
  options: AgentOptions,
  planningResponse?: ChatResponse
): Promise<AgentResult> {
  const usedTools: string[] = [];
  let cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [];

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

  try {
    const { plan, raw } = await interpretTurn(sessionId);

    if (plan.needsClarification) {
      return finalizeAgentResult(
        sessionId,
        plan.clarificationQuestion ?? 'Necesito una aclaración para continuar.',
        [],
        raw
      );
    }

    if (plan.mode === 'chat' || !plan.requiresTools || plan.domain !== 'acc_admin') {
      return runDirectConversation(sessionId, plan.mode !== 'chat');
    }

    return executeOperationalPlan(sessionId, plan, options, raw);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Fallo la planificación estructurada del turno';
    console.warn(`[agent] Fallback a tool-calling libre: ${errorMessage}`);
    return runFreeformToolFallback(sessionId, options);
  }
}
