import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../config/env.js';
import { errorLog, infoLog, warnLog } from '../shared/logging/logger.js';
import type {
  ApsPagination,
  ApsProject,
  ApsProjectUser,
  ApsProjectUsersResponse,
  ApsProjectsResponse,
  GetProjectUsersOptions
} from '../types/aps.js';
import { fetchAllOffsetPages } from '../utils/pagination.js';

const APS_REGION_ALIASES: Record<string, string> = {
  US: 'US',
  EMEA: 'EMEA',
  EU: 'EMEA',
  AUS: 'AUS',
  AU: 'AUS',
  APAC: 'APAC',
  GBR: 'GBR',
  GB: 'GBR',
  UK: 'GBR',
  DEU: 'DEU',
  DE: 'DEU',
  JPN: 'JPN',
  JP: 'JPN',
  CAN: 'CAN',
  CA: 'CAN',
  IND: 'IND',
  IN: 'IND'
};

function normalizeProjectsResponse(data: ApsProjectsResponse | ApsProject[]): ApsProject[] {
  if (Array.isArray(data)) {
    return data;
  }

  return data.results ?? [];
}

function normalizeProjectsPagination(
  data: ApsProjectsResponse | ApsProject[]
): ApsPagination | undefined {
  if (Array.isArray(data)) {
    return undefined;
  }

  return data.pagination;
}

function cleanProjectId(projectId: string): string {
  return projectId.replace(/^b\./, '');
}

function getNormalizedRegion(region?: string): string | undefined {
  const trimmed = region?.trim();
  if (!trimmed) {
    return undefined;
  }

  return APS_REGION_ALIASES[trimmed.toUpperCase()];
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  return {
    ...(headers.Authorization ? { Authorization: 'Bearer [redacted]' } : {}),
    ...(headers['User-Id'] ? { 'User-Id': headers['User-Id'] } : {}),
    ...(headers.Region ? { Region: headers.Region } : {})
  };
}

function getDeveloperMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return undefined;
  }

  const developerMessage = (data as { developerMessage?: unknown }).developerMessage;
  return typeof developerMessage === 'string' ? developerMessage : undefined;
}

function normalizeProjectUsersResponse(data: ApsProjectUsersResponse): ApsProjectUser[] {
  return (data.results ?? []).map((user) => ({
    id: user.id,
    autodeskId: user.autodeskId,
    email: user.email,
    name: user.name,
    companyName: user.companyName,
    status: user.status,
    products: user.products ?? [],
    roles: (user.roles ?? []).map((role) => role.name)
  }));
}

export async function getProjects(
  token: string,
  userId: string,
  options: {
    onPage?: (
      payload: ApsProjectsResponse | ApsProject[],
      page: { limit: number; offset: number },
      pageIndex: number
    ) => void;
  } = {}
): Promise<ApsProject[]> {
  infoLog('apsAdmin', `Listando proyectos para account ${env.apsAccountId} con User-Id ${userId}`);

  try {
    const projects = await fetchAllOffsetPages<ApsProjectsResponse | ApsProject[], ApsProject>({
      initialLimit: 100,
      fetchPage: async ({ limit, offset }) => {
        const response = await axios.get<ApsProjectsResponse | ApsProject[]>(
          `${env.apsBaseUrl}/hq/v1/accounts/${env.apsAccountId}/projects`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Id': userId
            },
            params: {
              limit,
              offset
            }
          }
        );

        return response.data;
      },
      getItems: normalizeProjectsResponse,
      getPagination: normalizeProjectsPagination,
      ...(options.onPage ? { onPage: options.onPage } : {})
    });

    infoLog('apsAdmin', `Proyectos obtenidos: ${projects.length}`);
    return projects;
  } catch (error) {
    const axiosError = error as AxiosError;
    errorLog('apsAdmin', 'Error listando proyectos', {
      status: axiosError.response?.status,
      data: axiosError.response?.data
    });
    throw error;
  }
}

function normalizeProjectUsersPagination(
  data: ApsProjectUsersResponse
): ApsPagination | undefined {
  return data.pagination;
}

export async function getProjectUsers(
  token: string,
  projectId: string,
  options: GetProjectUsersOptions & {
    onPage?: (
      payload: ApsProjectUsersResponse,
      page: { limit: number; offset: number },
      pageIndex: number
    ) => void;
  } = {}
): Promise<ApsProjectUser[]> {
  const cleanedProjectId = cleanProjectId(projectId);
  const actingUserId = options.actingUserId ?? env.apsUserId;
  const normalizedRegion = getNormalizedRegion(options.region);
  const endpoint = `${env.apsBaseUrl}/construction/admin/v1/projects/${cleanedProjectId}/users`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(actingUserId ? { 'User-Id': actingUserId } : {}),
    ...(normalizedRegion ? { Region: normalizedRegion } : {})
  };

  if (options.region && !normalizedRegion) {
    warnLog('apsAdmin', 'Omitiendo Region invalido para listar usuarios del proyecto', {
      projectId: cleanedProjectId,
      requestedRegion: options.region
    });
  }

  infoLog('apsAdmin', `Listando usuarios del proyecto ${cleanedProjectId}`);

  try {
    const users = await fetchAllOffsetPages<ApsProjectUsersResponse, ApsProjectUser>({
      initialLimit: options.limit ?? 100,
      fetchPage: async ({ limit, offset }) => {
        const response = await axios.get<ApsProjectUsersResponse>(
          endpoint,
          {
            headers,
            params: {
              ...(options.products?.length ? { 'filter[products]': options.products.join(',') } : {}),
              limit,
              offset
            }
          }
        );

        return response.data;
      },
      getItems: normalizeProjectUsersResponse,
      getPagination: normalizeProjectUsersPagination,
      ...(options.onPage ? { onPage: options.onPage } : {})
    });

    infoLog('apsAdmin', `Usuarios obtenidos para ${cleanedProjectId}: ${users.length}`);
    return users;
  } catch (error) {
    const axiosError = error as AxiosError;
    errorLog('apsAdmin', 'Error listando usuarios del proyecto', {
      endpoint,
      projectId: cleanedProjectId,
      headers: sanitizeHeadersForLog(headers),
      requestedRegion: options.region,
      effectiveRegion: normalizedRegion,
      status: axiosError.response?.status,
      developerMessage: getDeveloperMessage(axiosError.response?.data),
      data: axiosError.response?.data
    });
    throw error;
  }
}
