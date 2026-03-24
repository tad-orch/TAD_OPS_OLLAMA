import { getMysqlPool, isMysqlConfigured } from '../shared/db/mysql.js';
import type { SnapshotDomain } from '../types/agent.js';

type RawEvidenceResult = {
  sufficient: boolean;
  sourceDocumentId?: string | undefined;
  rows: Array<Record<string, unknown>>;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function flattenResults(responseJson: unknown): Array<Record<string, unknown>> {
  if (typeof responseJson !== 'object' || responseJson === null) {
    return [];
  }

  const container = responseJson as {
    results?: unknown;
    pages?: unknown[];
  };

  if (Array.isArray(container.results)) {
    return container.results.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    );
  }

  if (Array.isArray(container.pages)) {
    return container.pages.flatMap((page) => {
      if (typeof page !== 'object' || page === null) {
        return [];
      }
      const typedPage = page as { results?: unknown[] };
      return Array.isArray(typedPage.results)
        ? typedPage.results.filter(
            (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
          )
        : [];
    });
  }

  return [];
}

function getComparableValue(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  return typeof value === 'string' ? normalizeText(value) : '';
}

export async function resolveRawEvidence(params: {
  domain: SnapshotDomain;
  projectId?: string;
  userText: string;
}): Promise<RawEvidenceResult> {
  if (!isMysqlConfigured()) {
    return {
      sufficient: false,
      rows: []
    };
  }

  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `
    SELECT id, response_json
    FROM api_documents
    WHERE domain = ?
      ${params.projectId ? "AND JSON_UNQUOTE(JSON_EXTRACT(scope_ids_json, '$.projectId')) = ?" : ''}
    ORDER BY fetched_at DESC
    LIMIT 1
    `,
    params.projectId ? [params.domain, params.projectId] : [params.domain]
  );

  const firstRow = Array.isArray(rows) ? (rows[0] as { id?: string; response_json?: unknown } | undefined) : undefined;
  if (!firstRow?.response_json) {
    return {
      sufficient: false,
      rows: []
    };
  }

  const normalizedText = normalizeText(params.userText);
  const candidates = flattenResults(firstRow.response_json);
  if (candidates.length === 0) {
    return {
      sufficient: false,
      rows: [],
      ...(firstRow.id ? { sourceDocumentId: String(firstRow.id) } : {})
    };
  }

  if (/\btipo\b/.test(normalizedText)) {
    const typedRows = candidates.filter((row) => {
      const comparable = getComparableValue(row, 'type') || getComparableValue(row, 'issue_type');
      return Boolean(comparable);
    });
    return {
      sufficient: typedRows.length > 0,
      rows: typedRows,
      ...(firstRow.id ? { sourceDocumentId: String(firstRow.id) } : {})
    };
  }

  if (/\b(role|rol|product|producto)\b/.test(normalizedText)) {
    const enriched = candidates.filter((row) => row.products || row.roles);
    return {
      sufficient: enriched.length > 0,
      rows: enriched,
      ...(firstRow.id ? { sourceDocumentId: String(firstRow.id) } : {})
    };
  }

  return {
    sufficient: false,
    rows: candidates,
    ...(firstRow.id ? { sourceDocumentId: String(firstRow.id) } : {})
  };
}
