import { env } from '../../config/env.js';
import type { ApsRfi, ProjectScopedReadFilters } from '../../types/aps.js';
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

const RFIS_SOURCE = 'construction/rfis/v3/projects/:projectId/rfis';

function summarizeRfi(rawRfi: Record<string, unknown>): ApsRfi {
  const location = asRecord(rawRfi.location);
  const rfiId = toNonEmptyString(rawRfi.id);
  const customIdentifier = toNonEmptyString(rawRfi.customIdentifier);

  return {
    id: customIdentifier ?? rfiId ?? 'rfi-sin-id',
    ...(rfiId ? { rfiId } : {}),
    ...(toNonEmptyString(rawRfi.title) ? { title: toNonEmptyString(rawRfi.title) } : {}),
    ...(toNonEmptyString(rawRfi.status) ? { status: toNonEmptyString(rawRfi.status) } : {}),
    ...(resolveEntityLabel(rawRfi.rfiType) ?? resolveEntityLabel(rawRfi.type) ?? toNonEmptyString(rawRfi.rfiTypeId)
      ? {
          type:
            resolveEntityLabel(rawRfi.rfiType) ??
            resolveEntityLabel(rawRfi.type) ??
            toNonEmptyString(rawRfi.rfiTypeId)
        }
      : {}),
    ...(resolveEntityLabel(rawRfi.assignedTo) ? { assignedTo: resolveEntityLabel(rawRfi.assignedTo) } : {}),
    ...(toNonEmptyString(location?.description) ? { location: toNonEmptyString(location?.description) } : {}),
    ...(toDateOnly(rawRfi.dueDate) ? { dueDate: toDateOnly(rawRfi.dueDate) } : {}),
    ...(toDateOnly(rawRfi.createdAt) ? { createdAt: toDateOnly(rawRfi.createdAt) } : {})
  };
}

function applyRfiFilters(rfis: ApsRfi[], filters: ProjectScopedReadFilters): ApsRfi[] {
  return rfis.filter((rfi) => {
    if (!matchesStatusFilter(rfi.status, filters.status)) {
      return false;
    }

    return matchesSearchFilter(
      [rfi.id, rfi.rfiId, rfi.title, rfi.type, rfi.assignedTo, rfi.location],
      filters.search
    );
  });
}

export async function listProjectRfis(
  token: string,
  projectId: string,
  filters: ProjectScopedReadFilters = {}
): Promise<{ projectId: string; items: ApsRfi[]; source: string }> {
  const normalizedProjectId = normalizeConstructionProjectId(projectId);
  const endpoint = `${env.apsBaseUrl}/construction/rfis/v3/projects/${normalizedProjectId}/rfis`;

  console.log(`[rfis] Listando RFIs del proyecto ${normalizedProjectId}`);

  const rawRfis = await fetchConstructionList<Record<string, unknown>>({
    domain: 'rfis',
    token,
    endpoint
  });
  const rfis = applyRfiFilters(rawRfis.map(summarizeRfi), filters);

  console.log(`[rfis] RFIs obtenidos para ${normalizedProjectId}: ${rfis.length}`);

  return {
    projectId: normalizedProjectId,
    items: rfis,
    source: RFIS_SOURCE
  };
}
