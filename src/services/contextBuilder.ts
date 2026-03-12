import type { Message } from 'ollama';
import { env } from '../config/env.js';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { listRecentMessages } from '../db/repositories/messagesRepo.js';
import { listRecentToolCalls } from '../db/repositories/toolCallsRepo.js';
import type { BuiltContext } from '../types/agent.js';

function formatContextMessage(sessionId: string): string {
  const sessionContext = getSessionContext(sessionId);
  const recentToolCalls = listRecentToolCalls(sessionId, 4);

  const lines = [
    `Contexto estructurado actual:`,
    `- accountId: ${sessionContext?.current_account_id ?? env.apsAccountId}`,
    `- currentProjectId: ${sessionContext?.current_project_id ?? 'none'}`,
    `- currentProjectName: ${sessionContext?.current_project_name ?? 'none'}`
  ];

  const memory = sessionContext?.memory_json;
  if (memory?.recentProjects?.length) {
    lines.push(
      `- recentProjects: ${memory.recentProjects
        .slice(0, 5)
        .map((project) => `${project.name} (${project.id})`)
        .join(', ')}`
    );
  }

  if (memory?.lastResolvedProjectName || memory?.lastResolvedProjectId) {
    lines.push(
      `- lastResolvedProject: ${memory.lastResolvedProjectName ?? 'unknown'} (${memory.lastResolvedProjectId ?? 'unknown'})`
    );
  }

  if (recentToolCalls.length > 0) {
    lines.push('- recentToolSummaries:');
    for (const toolCall of recentToolCalls) {
      lines.push(`  - ${toolCall.result_summary}`);
    }
  }

  return lines.join('\n');
}

export function buildContextForSession(sessionId: string): BuiltContext {
  const recentMessages = listRecentMessages(sessionId, 8);
  const messageWindow: Message[] = recentMessages.map((message) => ({
    role: message.role,
    content: message.content
  }));

  const contextMessage = formatContextMessage(sessionId);
  const messages: Message[] = [
    {
      role: 'system',
      content: contextMessage
    },
    ...messageWindow
  ];

  const approxCharCount = messages.reduce((total, message) => total + message.content.length, 0);
  return {
    messages,
    approxCharCount
  };
}
