import { getSessionContext } from '../db/repositories/contextRepo.js';
import { getSnapshotRegistry } from '../db/repositories/snapshotRegistryRepo.js';
import { getCurrentWorkingSet } from '../db/repositories/workingSetRepo.js';
import type { ActionDecision, EvidenceSummary, StructuredTurnPlan, WorkingSet } from '../types/agent.js';

function formatRelativeAge(isoDate: string | undefined): string | undefined {
  if (!isoDate) {
    return undefined;
  }

  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  const elapsedMs = Date.now() - parsed;
  if (elapsedMs < 60_000) {
    return `${Math.max(1, Math.round(elapsedMs / 1000))}s`;
  }

  if (elapsedMs < 3_600_000) {
    return `${Math.max(1, Math.round(elapsedMs / 60_000))}m`;
  }

  return `${Math.max(1, Math.round(elapsedMs / 3_600_000))}h`;
}

function formatWorkingSetFilters(workingSet: WorkingSet): string {
  if (workingSet.appliedFilters.length === 0) {
    return 'sin filtros derivados';
  }

  return workingSet.appliedFilters
    .map((filter) => `${filter.field}:${filter.op}${filter.value ? `=${filter.value}` : ''}`)
    .join(', ');
}

export function buildPlannerWorkingSetSummary(sessionId: string): string | undefined {
  const workingSet = getCurrentWorkingSet(sessionId);
  if (!workingSet) {
    return undefined;
  }

  const parts = [
    'Working set actual prioritario:',
    `- sourceDomain: ${workingSet.sourceDomain}`,
    `- itemCount: ${workingSet.itemCount}`,
    `- derivedFromQuery: ${workingSet.derivedFromQuery}`,
    `- appliedFilters: ${formatWorkingSetFilters(workingSet)}`,
    `- freshness: ${formatRelativeAge(workingSet.createdAt) ?? workingSet.createdAt}`
  ];

  if (workingSet.sourceProjectId || workingSet.sourceProjectName) {
    parts.push(
      `- sourceProject: ${workingSet.sourceProjectName ?? 'sin nombre'} (${workingSet.sourceProjectId ?? 'sin id'})`
    );
  }

  if (workingSet.displaySummary) {
    parts.push(`- displaySummary: ${workingSet.displaySummary}`);
  }

  if (workingSet.itemIds.length > 0) {
    parts.push(`- itemExamples: ${workingSet.itemIds.slice(0, 5).join(', ')}`);
  }

  parts.push(
    '- instruction: Si el usuario pide contar, filtrar, agrupar o dice "de esos", responde sobre este working set y evita tools salvo que falten datos.'
  );

  return parts.join('\n');
}

export function buildResolvedContextSummary(params: {
  sessionId: string;
  plan?: StructuredTurnPlan;
  evidence?: EvidenceSummary;
  action?: ActionDecision;
}): string {
  const sessionContext = getSessionContext(params.sessionId);
  const workingSet = getCurrentWorkingSet(params.sessionId);
  const snapshotRegistry = getSnapshotRegistry(params.sessionId);
  const lines = ['Resolved context:'];

  if (params.plan) {
    lines.push(`- planIntent: ${params.plan.intent}`);
    lines.push(`- planMode: ${params.plan.mode}`);
    lines.push(`- planRequiresTools: ${params.plan.requiresTools ? 'yes' : 'no'}`);
  }

  if (params.action) {
    lines.push(`- decidedAction: ${params.action.kind}`);
    lines.push(`- executionMode: ${params.action.executionMode}`);
  }

  const currentProjectId = params.evidence?.currentProjectId ?? sessionContext?.current_project_id;
  const currentProjectName = params.evidence?.currentProjectName ?? sessionContext?.current_project_name;
  if (currentProjectId || currentProjectName) {
    lines.push(`- currentProject: ${currentProjectName ?? 'sin nombre'} (${currentProjectId ?? 'sin id'})`);
  }

  const aliases = sessionContext?.memory_json.currentProjectAliases ?? [];
  if (aliases.length > 0) {
    lines.push(`- currentProjectAliases: ${aliases.slice(0, 6).join(', ')}`);
  }

  if (sessionContext?.memory_json.currentProjectConfidence !== undefined) {
    lines.push(`- currentProjectConfidence: ${sessionContext.memory_json.currentProjectConfidence.toFixed(2)}`);
  }

  if (workingSet) {
    lines.push(`- activeWorkingSetDomain: ${workingSet.sourceDomain}`);
    lines.push(`- activeWorkingSetCount: ${workingSet.itemCount}`);
    if (workingSet.sourceProjectId || workingSet.sourceProjectName) {
      lines.push(
        `- activeWorkingSetProject: ${workingSet.sourceProjectName ?? 'sin nombre'} (${workingSet.sourceProjectId ?? 'sin id'})`
      );
    }
    lines.push(`- activeWorkingSetFilters: ${formatWorkingSetFilters(workingSet)}`);
    if (workingSet.displaySummary) {
      lines.push(`- activeWorkingSetSummary: ${workingSet.displaySummary}`);
    }
  }

  if (params.evidence) {
    lines.push(`- evidenceSource: ${params.evidence.evidenceSource}`);
    lines.push(`- evidenceReason: ${params.evidence.reason}`);
  }

  if (snapshotRegistry.snapshots.length > 0) {
    const latest = snapshotRegistry.snapshots[0];
    if (latest) {
      lines.push(
        `- latestSnapshot: ${latest.domain} (${latest.itemCount} items${latest.projectName ? ` para ${latest.projectName}` : ''})`
      );
    }
  }

  if (sessionContext?.memory_json.authMode) {
    lines.push(
      `- authState: ${sessionContext.memory_json.authMode}:${sessionContext.memory_json.authReadyForConstructionEndpoints ? 'ready' : 'not-ready'}`
    );
  }

  lines.push('- instruction: Usa este contexto resuelto tal cual. No digas que falta proyecto confiable si ya aparece resuelto arriba.');
  return lines.join('\n');
}
