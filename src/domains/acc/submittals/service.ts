import { env } from '../../../config/env.js';
import type { ApsSubmittal, ProjectScopedReadFilters } from '../../../types/aps.js';
import {
  fetchConstructionList,
  matchesSearchFilter,
  matchesStatusFilter,
  normalizeConstructionProjectId,
  resolveEntityLabel,
  toDateOnly,
  toNonEmptyString
} from '../../../shared/http/constructionClient.js';

const SUBMITTALS_SOURCE = 'construction/submittals/v2/projects/:projectId/items';

function summarizeSubmittal(rawSubmittal: Record<string, unknown>): ApsSubmittal {
  const submittalId = toNonEmptyString(rawSubmittal.id);
  const customIdentifier = toNonEmptyString(rawSubmittal.customIdentifier);

  return {
    id: customIdentifier ?? submittalId ?? 'submittal-sin-id',
    ...(submittalId ? { submittalId } : {}),
    ...(toNonEmptyString(rawSubmittal.title) ? { title: toNonEmptyString(rawSubmittal.title) } : {}),
    ...(toNonEmptyString(rawSubmittal.status) ? { status: toNonEmptyString(rawSubmittal.status) } : {}),
    ...(resolveEntityLabel(rawSubmittal.itemType) ?? toNonEmptyString(rawSubmittal.itemTypeId)
      ? { type: resolveEntityLabel(rawSubmittal.itemType) ?? toNonEmptyString(rawSubmittal.itemTypeId) }
      : {}),
    ...(resolveEntityLabel(rawSubmittal.response) ?? toNonEmptyString(rawSubmittal.responseId)
      ? { response: resolveEntityLabel(rawSubmittal.response) ?? toNonEmptyString(rawSubmittal.responseId) }
      : {}),
    ...(resolveEntityLabel(rawSubmittal.spec) ?? toNonEmptyString(rawSubmittal.specId)
      ? { spec: resolveEntityLabel(rawSubmittal.spec) ?? toNonEmptyString(rawSubmittal.specId) }
      : {}),
    ...(resolveEntityLabel(rawSubmittal.assignedTo) ? { assignedTo: resolveEntityLabel(rawSubmittal.assignedTo) } : {}),
    ...(resolveEntityLabel(rawSubmittal.manager) ? { manager: resolveEntityLabel(rawSubmittal.manager) } : {}),
    ...(toDateOnly(rawSubmittal.dueDate) ? { dueDate: toDateOnly(rawSubmittal.dueDate) } : {}),
    ...(toDateOnly(rawSubmittal.createdAt) ? { createdAt: toDateOnly(rawSubmittal.createdAt) } : {})
  };
}

function applySubmittalFilters(
  submittals: ApsSubmittal[],
  filters: ProjectScopedReadFilters
): ApsSubmittal[] {
  return submittals.filter((submittal) => {
    if (!matchesStatusFilter(submittal.status, filters.status)) {
      return false;
    }

    return matchesSearchFilter(
      [
        submittal.id,
        submittal.submittalId,
        submittal.title,
        submittal.type,
        submittal.response,
        submittal.spec,
        submittal.assignedTo,
        submittal.manager
      ],
      filters.search
    );
  });
}

export async function listProjectSubmittals(
  token: string,
  projectId: string,
  filters: ProjectScopedReadFilters = {}
): Promise<{ projectId: string; items: ApsSubmittal[]; source: string; endpoint: string; rawPages: unknown[] }> {
  const normalizedProjectId = normalizeConstructionProjectId(projectId);
  const endpoint = `${env.apsBaseUrl}/construction/submittals/v2/projects/${normalizedProjectId}/items`;
  const rawPages: unknown[] = [];

  console.log(`[submittals] Listando submittals del proyecto ${normalizedProjectId}`);

  const rawSubmittals = await fetchConstructionList<Record<string, unknown>>({
    domain: 'submittals',
    token,
    endpoint,
    onPage: (payload) => rawPages.push(payload)
  });
  const submittals = applySubmittalFilters(rawSubmittals.map(summarizeSubmittal), filters);

  console.log(
    `[submittals] Submittals obtenidos para ${normalizedProjectId}: ${submittals.length}`
  );

  return {
    projectId: normalizedProjectId,
    items: submittals,
    source: SUBMITTALS_SOURCE,
    endpoint,
    rawPages
  };
}
