import type { Message } from 'ollama';
import { env } from '../config/env.js';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { listRecentMessages } from '../db/repositories/messagesRepo.js';
import type { BuiltContext } from '../types/agent.js';

type ContextBuilderOptions = {
  includeStructuredContext?: boolean;
  maxRecentMessages?: number;
};

function formatContextMessage(sessionId: string): string {
  const sessionContext = getSessionContext(sessionId);
  const lines = [`Contexto operativo confiable:`];

  lines.push(`- accountId: ${sessionContext?.current_account_id ?? env.apsAccountId}`);

  const memory = sessionContext?.memory_json;
  if (sessionContext?.current_project_id) {
    const currentProjectLabel = sessionContext.current_project_name
      ? `${sessionContext.current_project_name} (${sessionContext.current_project_id})`
      : sessionContext.current_project_id;
    lines.push(`- currentProject: ${currentProjectLabel}`);
  }

  if (
    (memory?.lastResolvedProjectName || memory?.lastResolvedProjectId) &&
    memory.lastResolvedProjectId !== sessionContext?.current_project_id
  ) {
    lines.push(
      `- lastResolvedProject: ${memory.lastResolvedProjectName ?? 'unknown'} (${memory.lastResolvedProjectId ?? 'unknown'})`
    );
  }

  if (memory?.recentProjects?.length) {
    lines.push(`- recentProjectCache: disponible (${memory.recentProjects.length} proyectos recientes)`);
  }

  return lines.join('\n');
}

export function buildContextForSession(
  sessionId: string,
  options: ContextBuilderOptions = {}
): BuiltContext {
  const includeStructuredContext = options.includeStructuredContext ?? true;
  const maxRecentMessages =
    options.maxRecentMessages ?? (includeStructuredContext ? 6 : 4);
  const recentMessages = listRecentMessages(sessionId, maxRecentMessages);
  const messageWindow: Message[] = recentMessages.map((message) => ({
    role: message.role,
    content: message.content
  }));

  const messages: Message[] = includeStructuredContext
    ? [
        {
          role: 'system',
          content: formatContextMessage(sessionId)
        },
        ...messageWindow
      ]
    : messageWindow;

  const approxCharCount = messages.reduce((total, message) => total + message.content.length, 0);
  return {
    messages,
    approxCharCount
  };
}
