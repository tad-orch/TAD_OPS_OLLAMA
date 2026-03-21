import type { Message } from 'ollama';
import type {
  ApsIssue,
  ApsRfi,
  ApsSubmittal,
  ApsTransmittal,
  ProjectScopedReadToolResult
} from './aps.js';

export type SessionRecord = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_user_message: string;
};

export type MessageRecord = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

export type ToolCallRecord = {
  id: string;
  session_id: string;
  tool_name: string;
  arguments_json: string;
  result_summary: string;
  created_at: string;
};

export type AgentMode = 'chat' | 'operate';

export type AgentDomain =
  | 'acc_admin'
  | 'issues'
  | 'rfis'
  | 'submittals'
  | 'transmittals'
  | 'auth'
  | 'unknown';

export type AgentIntent =
  | 'list_projects'
  | 'get_project_users'
  | 'list_issues'
  | 'list_rfis'
  | 'list_submittals'
  | 'list_transmittals'
  | 'start_acc_user_login'
  | 'unknown';

export type PlannedToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type TurnEntities = {
  accountId?: string | undefined;
  projectId?: string | undefined;
  projectName?: string | undefined;
  useCurrentProject?: boolean | undefined;
  products?: string[] | undefined;
  region?: string | undefined;
  actingUserId?: string | undefined;
};

export type StructuredTurnPlan = {
  mode: AgentMode;
  domain: AgentDomain;
  intent: AgentIntent;
  confidence: number;
  entities: TurnEntities;
  requiresTools: boolean;
  proposedToolChain: PlannedToolCall[];
  needsClarification: boolean;
  clarificationQuestion?: string | undefined;
};

export type ProjectLifecycle = 'active' | 'archived' | 'unknown';

export type ProjectMemoryItem = {
  id: string;
  name: string;
  status?: string | undefined;
  lifecycle?: ProjectLifecycle | undefined;
};

export type ProjectScopedReadMemory<TItem> = ProjectScopedReadToolResult<TItem> & {
  projectName?: string | undefined;
  fetchedAt: string;
};

export type SessionMemory = {
  recentProjects?: ProjectMemoryItem[] | undefined;
  lastResolvedProjectId?: string | undefined;
  lastResolvedProjectName?: string | undefined;
  authMode?: '2legged' | '3legged' | undefined;
  authReadyForConstructionEndpoints?: boolean | undefined;
  authPendingLogin?: boolean | undefined;
  authProfileId?: string | undefined;
  authDisplayName?: string | undefined;
  recentIssues?: ProjectScopedReadMemory<ApsIssue>[] | undefined;
  recentRfis?: ProjectScopedReadMemory<ApsRfi>[] | undefined;
  recentSubmittals?: ProjectScopedReadMemory<ApsSubmittal>[] | undefined;
  recentTransmittals?: ProjectScopedReadMemory<ApsTransmittal>[] | undefined;
};

export type SessionContextRecord = {
  session_id: string;
  current_account_id?: string | undefined;
  current_project_id?: string | undefined;
  current_project_name?: string | undefined;
  memory_json: SessionMemory;
  updated_at: string;
};

export type BuiltContext = {
  messages: Message[];
  approxCharCount: number;
};
