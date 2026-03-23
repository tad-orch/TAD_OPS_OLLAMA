import { env } from '../../../config/env.js';
import type { ApsTransmittal, ProjectScopedReadFilters } from '../../../types/aps.js';
import {
  asRecord,
  fetchConstructionList,
  matchesSearchFilter,
  matchesStatusFilter,
  normalizeConstructionProjectId,
  resolveEntityLabel,
  toDateOnly,
  toNonEmptyString
} from '../../../shared/http/constructionClient.js';

const TRANSMITTALS_SOURCE = 'construction/transmittals/v1/projects/:projectId/transmittals';

function summarizeTransmittal(rawTransmittal: Record<string, unknown>): ApsTransmittal {
  const transmittalId = toNonEmptyString(rawTransmittal.id);
  const createdBy = asRecord(rawTransmittal.createdBy);
  const number =
    toNonEmptyString(rawTransmittal.formattedNumber) ??
    toNonEmptyString(rawTransmittal.number) ??
    toNonEmptyString(rawTransmittal.customIdentifier);

  return {
    id: number ?? transmittalId ?? 'transmittal-sin-id',
    ...(transmittalId ? { transmittalId } : {}),
    ...(number ? { number } : {}),
    ...(toNonEmptyString(rawTransmittal.title) ? { title: toNonEmptyString(rawTransmittal.title) } : {}),
    ...(toNonEmptyString(rawTransmittal.status) ? { status: toNonEmptyString(rawTransmittal.status) } : {}),
    ...(resolveEntityLabel(createdBy) ? { createdBy: resolveEntityLabel(createdBy) } : {}),
    ...(toDateOnly(rawTransmittal.dueDate) ? { dueDate: toDateOnly(rawTransmittal.dueDate) } : {}),
    ...(toDateOnly(rawTransmittal.createdAt) ? { createdAt: toDateOnly(rawTransmittal.createdAt) } : {})
  };
}

function applyTransmittalFilters(
  transmittals: ApsTransmittal[],
  filters: ProjectScopedReadFilters
): ApsTransmittal[] {
  return transmittals.filter((transmittal) => {
    if (!matchesStatusFilter(transmittal.status, filters.status)) {
      return false;
    }

    return matchesSearchFilter(
      [
        transmittal.id,
        transmittal.transmittalId,
        transmittal.number,
        transmittal.title,
        transmittal.createdBy
      ],
      filters.search
    );
  });
}

export async function listProjectTransmittals(
  token: string,
  projectId: string,
  filters: ProjectScopedReadFilters = {}
): Promise<{ projectId: string; items: ApsTransmittal[]; source: string }> {
  const normalizedProjectId = normalizeConstructionProjectId(projectId);
  const endpoint = `${env.apsBaseUrl}/construction/transmittals/v1/projects/${normalizedProjectId}/transmittals`;

  console.log(`[transmittals] Listando transmittals del proyecto ${normalizedProjectId}`);

  const rawTransmittals = await fetchConstructionList<Record<string, unknown>>({
    domain: 'transmittals',
    token,
    endpoint
  });
  const transmittals = applyTransmittalFilters(rawTransmittals.map(summarizeTransmittal), filters);

  console.log(
    `[transmittals] Transmittals obtenidos para ${normalizedProjectId}: ${transmittals.length}`
  );

  return {
    projectId: normalizedProjectId,
    items: transmittals,
    source: TRANSMITTALS_SOURCE
  };
}
