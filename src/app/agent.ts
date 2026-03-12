import type { ChatResponse, Message } from 'ollama';
import { env } from '../config/env.js';
import { getSessionContext, upsertSessionContext } from '../db/repositories/contextRepo.js';
import { addMessage } from '../db/repositories/messagesRepo.js';
import { findProjectByName, getFreshProjectsFromCache } from '../db/repositories/projectCacheRepo.js';
import { getSessionById, touchSession, updateSessionAfterUserMessage } from '../db/repositories/sessionsRepo.js';
import { addToolCall } from '../db/repositories/toolCallsRepo.js';
import { systemPrompt } from '../prompts/systemPrompt.js';
import { buildContextForSession } from '../services/contextBuilder.js';
import { chatWithOllama } from '../services/ollamaClient.js';
import { getProjectsByAccountTool } from '../tools/getProjectsTool.js';
import { toolDefinitions, toolHandlers } from '../tools/index.js';
import type {
  AgentResult,
  ApsProject,
  GetProjectUsersToolArgs,
  GetProjectsToolResult
} from '../types/aps.js';
import { summarizeToolResultForStorage } from '../utils/summarize.js';

type ToolName = keyof typeof toolHandlers;

type ToolRequest = {
  name: ToolName;
  arguments: Record<string, unknown>;
};

type AgentOptions = {
  onToolCall?: (name: string) => void;
};

const MAX_TOOL_LOOPS = 6;
const PROJECTS_CACHE_TTL_MS = 15 * 60 * 1000;
const PROJECT_ID_PATTERN = /^(b\.)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildAgentMessages(sessionId: string): Message[] {
  const builtContext = buildContextForSession(sessionId);
  console.log(`[agent] Contexto construido para ${sessionId}: approxChars=${builtContext.approxCharCount}`);

  return [
    { role: 'system', content: systemPrompt },
    ...builtContext.messages
  ];
}

function extractToolRequests(message: Message): ToolRequest[] {
  if (message.tool_calls?.length) {
    return message.tool_calls
      .map((toolCall) => ({
        name: toolCall.function.name as ToolName,
        arguments: toolCall.function.arguments
      }))
      .filter((toolCall) => toolCall.name in toolHandlers);
  }

  const normalizedContent = message.content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(normalizedContent) as {
      name?: ToolName;
      arguments?: Record<string, unknown>;
    };

    if (parsed.name && parsed.name in toolHandlers) {
      return [
        {
          name: parsed.name,
          arguments: parsed.arguments ?? {}
        }
      ];
    }
  } catch {
    return [];
  }

  return [];
}

function findProjectInMemory(projects: ApsProject[], projectName: string): ApsProject | undefined {
  const exact = projects.find((project) => project.name === projectName);
  if (exact) {
    return exact;
  }

  return projects.find(
    (project) => project.name.toLowerCase() === projectName.toLowerCase()
  );
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
      recentProjects: projects.slice(0, 10).map((project) => ({
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
  upsertSessionContext(sessionId, {
    current_account_id: env.apsAccountId,
    current_project_id: projectId,
    ...(projectName ? { current_project_name: projectName } : {}),
    memory_json: {
      ...current?.memory_json,
      lastResolvedProjectId: projectId,
      ...(projectName ? { lastResolvedProjectName: projectName } : {})
    }
  });
}

async function resolveProjectId(
  projectIdOrName: string,
  cachedProjects: ApsProject[]
): Promise<{ projectId: string; projectName?: string; projects: ApsProject[] }> {
  if (PROJECT_ID_PATTERN.test(projectIdOrName)) {
    const normalizedProjectId = projectIdOrName.replace(/^b\./, '');
    const matchedProject = cachedProjects.find((project) => project.id === normalizedProjectId);

    return {
      projectId: normalizedProjectId,
      ...(matchedProject?.name ? { projectName: matchedProject.name } : {}),
      projects: cachedProjects
    };
  }

  const projectFromMemory = findProjectInMemory(cachedProjects, projectIdOrName);
  if (projectFromMemory) {
    return {
      projectId: projectFromMemory.id,
      projectName: projectFromMemory.name,
      projects: cachedProjects
    };
  }

  const cachedProjectsFromRepo =
    getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [];
  const projectFromRepo = findProjectByName(env.apsAccountId, projectIdOrName);
  if (projectFromRepo) {
    return {
      projectId: projectFromRepo.id,
      projectName: projectFromRepo.name,
      projects: cachedProjectsFromRepo
    };
  }

  const refreshedProjects = (await getProjectsByAccountTool({})).projects;
  const projectAfterRefresh = findProjectByName(env.apsAccountId, projectIdOrName);
  if (!projectAfterRefresh) {
    throw new Error(
      `No pude resolver un projectId para "${projectIdOrName}". Usa un projectId explícito o un nombre exacto del proyecto.`
    );
  }

  return {
    projectId: projectAfterRefresh.id,
    projectName: projectAfterRefresh.name,
    projects: refreshedProjects
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

  const messages = buildAgentMessages(sessionId);
  const usedTools: string[] = [];
  let cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? [];
  let lastResponse: ChatResponse | undefined;

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
    const response = await chatWithOllama(messages, toolDefinitions);
    lastResponse = response;
    messages.push(response.message);

    const toolRequests = extractToolRequests(response.message);
    if (toolRequests.length === 0) {
      const finalText = response.message.content.trim();
      addMessage(sessionId, 'assistant', finalText);
      touchSession(sessionId);

      return {
        text: finalText,
        toolCalls: usedTools,
        raw: response
      };
    }

    for (const toolRequest of toolRequests) {
      usedTools.push(toolRequest.name);
      options.onToolCall?.(toolRequest.name);

      try {
        const resolved = await maybeResolveToolArguments(toolRequest, cachedProjects);
        cachedProjects = resolved.projects;

        const toolResult = await toolHandlers[toolRequest.name](resolved.args as never);

        addToolCall(
          sessionId,
          toolRequest.name,
          JSON.stringify(resolved.args),
          summarizeToolResultForStorage(toolRequest.name, toolResult)
        );

        if (toolRequest.name === 'get_projects_by_account') {
          cachedProjects = getFreshProjectsFromCache(env.apsAccountId, PROJECTS_CACHE_TTL_MS) ?? cachedProjects;
          updateProjectsMemory(sessionId, cachedProjects);
        }

        if (toolRequest.name === 'get_project_users') {
          const toolArgs = resolved.args as GetProjectUsersToolArgs;
          updateProjectSelectionMemory(
            sessionId,
            toolArgs.projectId.replace(/^b\./, ''),
            resolved.resolvedProjectName
          );
        }

        messages.push(createToolMessage(toolRequest.name, toolResult));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error ejecutando tool';
        addToolCall(
          sessionId,
          toolRequest.name,
          JSON.stringify(toolRequest.arguments),
          `${toolRequest.name}: error ${errorMessage}`
        );
        messages.push(createToolMessage(toolRequest.name, { error: errorMessage }));
      }
    }
  }

  const fallbackText = 'Se alcanzó el límite de iteraciones de tools sin una respuesta final.';
  addMessage(sessionId, 'assistant', fallbackText);
  touchSession(sessionId);

  return {
    text: fallbackText,
    toolCalls: usedTools,
    raw: lastResponse
  };
}
