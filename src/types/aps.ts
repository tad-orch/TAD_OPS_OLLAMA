import type { ChatResponse } from 'ollama';

export type ApsProject = {
  id: string;
  name: string;
  status?: string | undefined;
  type?: string | undefined;
};

export type ApsProjectsResponse = {
  results?: ApsProject[];
  pagination?: ApsPagination;
};

export type GetProjectsToolArgs = {
  actingUserId?: string;
};

export type GetProjectsToolResult = {
  count: number;
  projects: ApsProject[];
  note?: string | undefined;
};

export type ApsPagination = {
  limit?: number;
  offset?: number;
  totalResults?: number;
};

export type ApsProjectUserProduct = {
  key: string;
  access?: string | undefined;
};

export type ApsProjectUserRole = {
  id?: string | undefined;
  name: string;
};

export type ApsProjectUser = {
  id: string;
  autodeskId?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  companyName?: string | undefined;
  status?: string | undefined;
  products: ApsProjectUserProduct[];
  roles: string[];
};

export type ApsProjectUsersResponse = {
  pagination?: ApsPagination;
  results?: Array<{
    id: string;
    autodeskId?: string;
    email?: string;
    name?: string;
    companyName?: string;
    status?: string;
    products?: ApsProjectUserProduct[];
    roles?: ApsProjectUserRole[];
  }>;
};

export type GetProjectUsersOptions = {
  actingUserId?: string;
  products?: string[];
  region?: string;
  limit?: number;
  offset?: number;
};

export type GetProjectUsersToolArgs = {
  projectId: string;
  products?: string | string[];
  region?: string;
  actingUserId?: string;
};

export type GetProjectUsersToolResult = {
  count: number;
  projectId: string;
  users: ApsProjectUser[];
  note?: string | undefined;
};

export type AgentResult = {
  text: string;
  toolCalls: string[];
  raw?: ChatResponse | undefined;
};
