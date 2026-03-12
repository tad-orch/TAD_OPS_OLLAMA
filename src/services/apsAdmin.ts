import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../config/env.js';
import type {
  ApsPagination,
  ApsProject,
  ApsProjectUser,
  ApsProjectUsersResponse,
  ApsProjectsResponse,
  GetProjectUsersOptions
} from '../types/aps.js';
import { fetchAllOffsetPages } from '../utils/pagination.js';

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
  userId: string
): Promise<ApsProject[]> {
  console.log(`[apsAdmin] Listando proyectos para account ${env.apsAccountId} con User-Id ${userId}`);

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
      getPagination: normalizeProjectsPagination
    });

    console.log(`[apsAdmin] Proyectos obtenidos: ${projects.length}`);
    return projects;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('[apsAdmin] Error listando proyectos', {
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
  options: GetProjectUsersOptions = {}
): Promise<ApsProjectUser[]> {
  const cleanedProjectId = cleanProjectId(projectId);
  const actingUserId = options.actingUserId ?? env.apsUserId;

  console.log(`[apsAdmin] Listando usuarios del proyecto ${cleanedProjectId}`);

  try {
    const users = await fetchAllOffsetPages<ApsProjectUsersResponse, ApsProjectUser>({
      initialLimit: options.limit ?? 100,
      fetchPage: async ({ limit, offset }) => {
        const response = await axios.get<ApsProjectUsersResponse>(
          `${env.apsBaseUrl}/construction/admin/v1/projects/${cleanedProjectId}/users`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              ...(actingUserId ? { 'User-Id': actingUserId } : {}),
              ...(options.region ? { Region: options.region } : {})
            },
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
      getPagination: normalizeProjectUsersPagination
    });

    console.log(`[apsAdmin] Usuarios obtenidos para ${cleanedProjectId}: ${users.length}`);
    return users;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('[apsAdmin] Error listando usuarios del proyecto', {
      projectId: cleanedProjectId,
      status: axiosError.response?.status,
      data: axiosError.response?.data
    });
    throw error;
  }
}
