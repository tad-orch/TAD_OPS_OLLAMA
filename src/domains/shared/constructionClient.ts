import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../../config/env.js';
import type { ApsPagination } from '../../types/aps.js';
import { fetchAllOffsetPages } from '../../utils/pagination.js';

export type RawConstructionListResponse<TItem> =
  | TItem[]
  | {
      results?: TItem[];
      pagination?: ApsPagination;
      [key: string]: unknown;
    };

type FetchConstructionListOptions<TItem> = {
  domain: string;
  token: string;
  endpoint: string;
  params?: Record<string, string | number | undefined>;
  initialLimit?: number;
};

function getDeveloperMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return undefined;
  }

  const developerMessage = (data as { developerMessage?: unknown }).developerMessage;
  return typeof developerMessage === 'string' ? developerMessage : undefined;
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  return {
    ...(headers.Authorization ? { Authorization: 'Bearer [redacted]' } : {})
  };
}

export function normalizeConstructionProjectId(projectId: string): string {
  return projectId.trim().replace(/^b\./, '');
}

export function getConstructionItems<TItem>(payload: RawConstructionListResponse<TItem>): TItem[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload.results) ? payload.results : [];
}

export function getConstructionPagination<TItem>(
  payload: RawConstructionListResponse<TItem>
): ApsPagination | undefined {
  if (Array.isArray(payload)) {
    return undefined;
  }

  return payload.pagination;
}

export function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function toDateOnly(value: unknown): string | undefined {
  const raw = toNonEmptyString(value);
  if (!raw) {
    return undefined;
  }

  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export function resolveEntityLabel(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return toNonEmptyString(value);
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return (
    toNonEmptyString(record.name) ??
    toNonEmptyString(record.title) ??
    toNonEmptyString(record.displayName) ??
    toNonEmptyString(record.identifier) ??
    toNonEmptyString(record.description) ??
    toNonEmptyString(record.email) ??
    toNonEmptyString(record.number) ??
    toNonEmptyString(record.id)
  );
}

export function matchesStatusFilter(itemStatus: string | undefined, statusFilter?: string): boolean {
  const normalizedFilter = statusFilter?.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  return itemStatus?.trim().toLowerCase().includes(normalizedFilter) ?? false;
}

export function matchesSearchFilter(
  values: Array<string | undefined>,
  searchFilter?: string
): boolean {
  const normalizedSearch = searchFilter
    ?.trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalizedSearch) {
    return true;
  }

  return values.some((value) => {
    const normalizedValue = value
      ?.trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return normalizedValue?.includes(normalizedSearch) ?? false;
  });
}

export async function fetchConstructionList<TItem>(
  options: FetchConstructionListOptions<TItem>
): Promise<TItem[]> {
  const endpoint = options.endpoint;
  const headers = {
    Authorization: `Bearer ${options.token}`
  };

  try {
    return await fetchAllOffsetPages<RawConstructionListResponse<TItem>, TItem>({
      initialLimit: options.initialLimit ?? 100,
      fetchPage: async ({ limit, offset }) => {
        const response = await axios.get<RawConstructionListResponse<TItem>>(endpoint, {
          headers,
          params: {
            ...options.params,
            limit,
            offset
          }
        });
        return response.data;
      },
      getItems: getConstructionItems,
      getPagination: getConstructionPagination
    });
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(`[${options.domain}] Error consultando endpoint de construcción`, {
      endpoint,
      baseUrl: env.apsBaseUrl,
      headers: sanitizeHeadersForLog(headers),
      params: options.params,
      status: axiosError.response?.status,
      developerMessage: getDeveloperMessage(axiosError.response?.data),
      data: axiosError.response?.data
    });
    throw error;
  }
}
