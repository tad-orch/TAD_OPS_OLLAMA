import { env } from '../../config/env.js';
import type { ApsIssue, ProjectScopedReadFilters } from '../../types/aps.js';
import {
  asRecord,
  fetchConstructionList,
  matchesSearchFilter,
  matchesStatusFilter,
  normalizeConstructionProjectId,
  resolveEntityLabel,
  toDateOnly,
  toNonEmptyString
} from '../shared/constructionClient.js';

const ISSUES_SOURCE = 'construction/issues/v1/projects/:projectId/issues';

function summarizeIssue(rawIssue: Record<string, unknown>): ApsIssue {
  const issueId = toNonEmptyString(rawIssue.id);
  const displayId = toNonEmptyString(rawIssue.displayId) ?? toNonEmptyString(rawIssue.numericId);
  const issueType = asRecord(rawIssue.issueType);

  return {
    id: displayId ?? issueId ?? 'issue-sin-id',
    ...(issueId ? { issueId } : {}),
    ...(toNonEmptyString(rawIssue.title) ? { title: toNonEmptyString(rawIssue.title) } : {}),
    ...(toNonEmptyString(rawIssue.status) ? { status: toNonEmptyString(rawIssue.status) } : {}),
    ...(toNonEmptyString(issueType?.title) ?? toNonEmptyString(rawIssue.issueTypeTitle)
      ? { type: toNonEmptyString(issueType?.title) ?? toNonEmptyString(rawIssue.issueTypeTitle) }
      : {}),
    ...(resolveEntityLabel(rawIssue.assignedTo) ? { assignedTo: resolveEntityLabel(rawIssue.assignedTo) } : {}),
    ...(toNonEmptyString(rawIssue.locationDetails) ? { location: toNonEmptyString(rawIssue.locationDetails) } : {}),
    ...(toDateOnly(rawIssue.dueDate) ? { dueDate: toDateOnly(rawIssue.dueDate) } : {}),
    ...(toDateOnly(rawIssue.createdAt) ? { createdAt: toDateOnly(rawIssue.createdAt) } : {})
  };
}

function applyIssueFilters(issues: ApsIssue[], filters: ProjectScopedReadFilters): ApsIssue[] {
  return issues.filter((issue) => {
    if (!matchesStatusFilter(issue.status, filters.status)) {
      return false;
    }

    return matchesSearchFilter(
      [issue.id, issue.issueId, issue.title, issue.type, issue.assignedTo, issue.location],
      filters.search
    );
  });
}

export async function listProjectIssues(
  token: string,
  projectId: string,
  filters: ProjectScopedReadFilters = {}
): Promise<{ projectId: string; items: ApsIssue[]; source: string }> {
  const normalizedProjectId = normalizeConstructionProjectId(projectId);
  const endpoint = `${env.apsBaseUrl}/construction/issues/v1/projects/${normalizedProjectId}/issues`;

  console.log(`[issues] Listando issues del proyecto ${normalizedProjectId}`);

  const rawIssues = await fetchConstructionList<Record<string, unknown>>({
    domain: 'issues',
    token,
    endpoint
  });
  const issues = applyIssueFilters(rawIssues.map(summarizeIssue), filters);

  console.log(`[issues] Issues obtenidos para ${normalizedProjectId}: ${issues.length}`);

  return {
    projectId: normalizedProjectId,
    items: issues,
    source: ISSUES_SOURCE
  };
}
