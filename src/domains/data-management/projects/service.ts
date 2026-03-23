import axios from 'axios';
import { AxiosError } from 'axios';
import { env } from '../../../config/env.js';
import type { DmProject } from '../../../types/aps.js';
import { getDataReadAccessToken } from '../../../shared/auth/apsAuthFacade.js';
import { errorLog, infoLog } from '../../../shared/logging/logger.js';

type RawHubProjectsResponse = {
  data?: Array<{
    id: string;
    attributes?: {
      name?: string;
      extension?: {
        data?: {
          projectType?: string;
          projectStatus?: string;
        };
      };
    };
  }>;
};

export async function listHubProjects(
  hubId?: string
): Promise<{ hubId: string; projects: DmProject[]; endpoint: string; rawPages: unknown[]; note?: string }> {
  const effectiveHubId = hubId?.trim() || env.apsHubId;
  if (!effectiveHubId) {
    throw new Error('get_data_management_projects requiere hubId o APS_HUB_ID');
  }

  const auth = await getDataReadAccessToken();
  const endpoint = `${env.apsBaseUrl}/project/v1/hubs/${effectiveHubId}/projects`;

  infoLog('dm.projects', `Listando proyectos del hub ${effectiveHubId}`);

  try {
    const response = await axios.get<RawHubProjectsResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${auth.token}`
      }
    });

    const projects: DmProject[] = (response.data.data ?? []).map((project) => ({
      id: project.id,
      name: project.attributes?.name ?? project.id,
      projectType: project.attributes?.extension?.data?.projectType,
      projectStatus: project.attributes?.extension?.data?.projectStatus
    }));

    return {
      hubId: effectiveHubId,
      projects,
      endpoint,
      rawPages: [response.data],
      ...(auth.note ? { note: auth.note } : {})
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    errorLog('dm.projects', 'Error listando proyectos del hub', {
      hubId: effectiveHubId,
      status: axiosError.response?.status,
      data: axiosError.response?.data
    });
    throw error;
  }
}
