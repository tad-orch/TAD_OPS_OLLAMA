import axios from 'axios';
import { env } from '../config/env.js';

type ProjectsResponse = {
  results?: Array<{
    id: string;
    name: string;
    status?: string;
    type?: string;
  }>;
};

export async function getProjects(
  token: string,
  userId: string
): Promise<Array<{
  id: string;
  name: string;
  status?: string;
  type?: string;
}>> {
  const response = await axios.get<ProjectsResponse>(
    `${env.apsBaseUrl}/construction/admin/v1/accounts/${env.apsAccountId}/projects`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Id': userId
      }
    }
  );

  return response.data.results || [];
}
