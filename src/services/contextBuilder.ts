import type { Message } from 'ollama';
import { env } from '../config/env.js';
import { getSessionContext } from '../db/repositories/contextRepo.js';
import { listRecentMessages } from '../db/repositories/messagesRepo.js';
import type {
  BuiltContext,
  MessageRecord,
  ProjectMemoryItem,
  ProjectScopedReadMemory
} from '../types/agent.js';
import type { ProjectScopedReadItemBase } from '../types/aps.js';

type ContextBuilderOptions = {
  includeStructuredContext?: boolean;
  maxRecentMessages?: number;
};

function detectPreferredLanguage(messages: MessageRecord[]): 'español' | 'inglés' {
  const userText = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.toLowerCase())
    .join(' ');

  const spanishHits =
    (userText.match(
      /\b(hola|gracias|proyecto|proyectos|usuario|usuarios|dime|quiero|cu[aá]ntos|cu[aá]les|archivad[oa]s?|inactiv[oa]s?|activos?|primero|segundo|tercero|por último|hub)\b/g
    ) ?? []).length + (/[ñáéíóú¿¡]/.test(userText) ? 2 : 0);
  const englishHits =
    (userText.match(
      /\b(hello|thanks|project|projects|user|users|how many|which|active|archived|first|second|finally|hub)\b/g
    ) ?? []).length;

  return englishHits > spanishHits ? 'inglés' : 'español';
}

function formatProjectStatusLabel(project: ProjectMemoryItem): string {
  if (project.lifecycle === 'active') {
    return 'activo';
  }

  if (project.lifecycle === 'archived') {
    return 'archivado';
  }

  return project.status?.trim() || 'sin clasificar';
}

function buildStatusBreakdown(items: ProjectScopedReadItemBase[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = item.status?.trim() || 'sin estado';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return undefined;
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ');
}

function buildReadSnapshotLines<TItem extends ProjectScopedReadItemBase>(
  label: string,
  snapshots: ProjectScopedReadMemory<TItem>[] | undefined
): string[] {
  const latestSnapshot = snapshots?.[0];
  if (!latestSnapshot) {
    return [];
  }

  const projectLabel = latestSnapshot.projectName
    ? `${latestSnapshot.projectName} (${latestSnapshot.projectId})`
    : latestSnapshot.projectId;
  const statusBreakdown = buildStatusBreakdown(latestSnapshot.items);
  const preview = latestSnapshot.items
    .slice(0, 3)
    .map((item) => `${item.id}${item.title ? `: ${item.title}` : ''}${item.status ? ` [${item.status}]` : ''}`)
    .join('; ');

  const lines = [
    `- recent${label}Cache: disponible para ${projectLabel} (${latestSnapshot.total} registros${statusBreakdown ? `; estados: ${statusBreakdown}` : ''})`
  ];

  if (preview) {
    lines.push(`- recent${label}Examples: ${preview}`);
  }

  return lines;
}

function formatContextMessage(sessionId: string, recentMessages: MessageRecord[]): string {
  const sessionContext = getSessionContext(sessionId);
  const lines = [`Contexto operativo confiable:`];

  lines.push(`- accountId: ${sessionContext?.current_account_id ?? env.apsAccountId}`);
  lines.push(`- userLanguage: ${detectPreferredLanguage(recentMessages)}`);

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
    const activeProjects = memory.recentProjects.filter((project) => project.lifecycle === 'active').length;
    const archivedProjects = memory.recentProjects.filter(
      (project) => project.lifecycle === 'archived'
    ).length;
    const unknownProjects = memory.recentProjects.length - activeProjects - archivedProjects;
    const preview = memory.recentProjects
      .slice(0, 6)
      .map((project) => `${project.name} [${formatProjectStatusLabel(project)}]`)
      .join('; ');

    lines.push(
      `- recentProjectCache: disponible (${memory.recentProjects.length} proyectos, ${activeProjects} activos, ${archivedProjects} archivados${unknownProjects > 0 ? `, ${unknownProjects} sin clasificar` : ''})`
    );
    if (preview) {
      lines.push(`- recentProjectExamples: ${preview}`);
    }
  }

  lines.push(...buildReadSnapshotLines('Issues', memory?.recentIssues));
  lines.push(...buildReadSnapshotLines('Rfis', memory?.recentRfis));
  lines.push(...buildReadSnapshotLines('Submittals', memory?.recentSubmittals));
  lines.push(...buildReadSnapshotLines('Transmittals', memory?.recentTransmittals));

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
          content: formatContextMessage(sessionId, recentMessages)
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
