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

export type StartAccUserLoginToolArgs = {
  force?: boolean;
};

export type StartAccUserLoginToolResult = {
  status: 'already_authenticated' | 'login_started' | 'login_pending';
  authReady: boolean;
  callbackUrl: string;
  authorizationUrl: string;
  message: string;
  profileId?: string | undefined;
  displayName?: string | undefined;
};

export type ProjectScopedReadItemBase = {
  id: string;
  title?: string | undefined;
  status?: string | undefined;
  dueDate?: string | undefined;
  createdAt?: string | undefined;
};

export type ApsIssue = ProjectScopedReadItemBase & {
  issueId?: string | undefined;
  type?: string | undefined;
  assignedTo?: string | undefined;
  location?: string | undefined;
};

export type ApsRfi = ProjectScopedReadItemBase & {
  rfiId?: string | undefined;
  type?: string | undefined;
  assignedTo?: string | undefined;
  location?: string | undefined;
};

export type ApsSubmittal = ProjectScopedReadItemBase & {
  submittalId?: string | undefined;
  type?: string | undefined;
  response?: string | undefined;
  spec?: string | undefined;
  assignedTo?: string | undefined;
  manager?: string | undefined;
};

export type ApsTransmittal = ProjectScopedReadItemBase & {
  transmittalId?: string | undefined;
  number?: string | undefined;
  createdBy?: string | undefined;
};

export type ProjectScopedReadFilters = {
  status?: string | undefined;
  search?: string | undefined;
};

export type ProjectScopedReadToolArgs = {
  projectId: string;
  status?: string;
  search?: string;
};

export type ProjectScopedReadToolResult<TItem> = {
  projectId: string;
  total: number;
  items: TItem[];
  source: string;
  warning?: string | undefined;
};

export type GetProjectIssuesToolArgs = ProjectScopedReadToolArgs;
export type GetProjectRfisToolArgs = ProjectScopedReadToolArgs;
export type GetProjectSubmittalsToolArgs = ProjectScopedReadToolArgs;
export type GetProjectTransmittalsToolArgs = ProjectScopedReadToolArgs;

export type GetProjectIssuesToolResult = ProjectScopedReadToolResult<ApsIssue>;
export type GetProjectRfisToolResult = ProjectScopedReadToolResult<ApsRfi>;
export type GetProjectSubmittalsToolResult = ProjectScopedReadToolResult<ApsSubmittal>;
export type GetProjectTransmittalsToolResult = ProjectScopedReadToolResult<ApsTransmittal>;

export type AgentResult = {
  text: string;
  toolCalls: string[];
  raw?: ChatResponse | undefined;
};
