import type { Message } from 'ollama';
import type {
  ApsIssue,
  ApsRfi,
  ApsSubmittal,
  ApsProjectUser,
  ApsTransmittal,
  GetProjectUsersToolResult,
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

export type AgentExecutionMode =
  | 'chat'
  | 'local_snapshot_query'
  | 'external_fetch'
  | 'fetch_then_analyze'
  | 'ask_clarification'
  | 'request_auth';

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
  | 'check_auth_status'
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

export type SnapshotDomain =
  | 'projects'
  | 'users'
  | 'issues'
  | 'rfis'
  | 'submittals'
  | 'transmittals';

export type SnapshotEntityType =
  | 'project'
  | 'user'
  | 'issue'
  | 'rfi'
  | 'submittal'
  | 'transmittal';

export type SnapshotMetadata = {
  statusCounts?: Record<string, number> | undefined;
  companyCounts?: Record<string, number> | undefined;
  lifecycleCounts?: Record<string, number> | undefined;
  typeCounts?: Record<string, number> | undefined;
  prefixes?: string[] | undefined;
  source?: string | undefined;
};

export type WorkingSetFilter = {
  field: string;
  op: 'eq' | 'contains' | 'starts_with' | 'group_by' | 'count' | 'exists';
  value?: string | undefined;
};

export type WorkingSet = {
  id: string;
  sessionId: string;
  sourceDomain: SnapshotDomain;
  sourceSnapshotId?: string | undefined;
  sourceDocumentId?: string | undefined;
  sourceProjectId?: string | undefined;
  sourceProjectName?: string | undefined;
  itemIds: string[];
  itemCount: number;
  appliedFilters: WorkingSetFilter[];
  derivedFromQuery: string;
  displaySummary?: string | undefined;
  createdAt: string;
};

export type WorkingSetRegistry = {
  current?: WorkingSet | undefined;
  recent: WorkingSet[];
  updatedAt: string;
};

export type SessionSnapshotResource = {
  id: string;
  sessionId: string;
  domain: SnapshotDomain;
  entityType: SnapshotEntityType;
  fetchedAt: string;
  itemCount: number;
  projectId?: string | undefined;
  projectName?: string | undefined;
  rawDocumentIds?: string[] | undefined;
  canonicalIds?: string[] | undefined;
  metadata?: SnapshotMetadata | undefined;
  confidence?: number | undefined;
  freshnessMs?: number | undefined;
};

export type SnapshotRegistry = {
  snapshots: SessionSnapshotResource[];
  updatedAt: string;
};

export type TurnAnalysis = {
  userText: string;
  plan: StructuredTurnPlan;
  executionModeHint: AgentExecutionMode;
  isAnalyticalFollowUp: boolean;
  domain?: SnapshotDomain | undefined;
  authIntent?: 'check_auth_status' | 'start_auth' | undefined;
  socialIntent?: 'greeting' | 'thanks' | 'goodbye' | 'small_talk' | undefined;
  needsProjectScope: boolean;
  needsConstructionAuth: boolean;
  asksForClarificationCandidate: boolean;
};

export type EvidenceSummary = {
  domain?: SnapshotDomain | undefined;
  currentProjectId?: string | undefined;
  currentProjectName?: string | undefined;
  currentProjectAliases: string[];
  currentWorkingSet?: WorkingSet | undefined;
  hasWorkingSet: boolean;
  hasUsableSnapshot: boolean;
  usableSnapshot?: SessionSnapshotResource | undefined;
  recentSnapshots: SessionSnapshotResource[];
  hasCanonicalEvidence: boolean;
  hasChunkEvidence: boolean;
  hasRawEvidence: boolean;
  rawEvidenceDocumentId?: string | undefined;
  evidenceSource: 'working_set' | 'snapshot' | 'canonical' | 'raw' | 'none';
  hasProjectEvidence: boolean;
  hasUserEvidence: boolean;
  authMode?: '2legged' | '3legged' | undefined;
  authReadyForConstructionEndpoints?: boolean | undefined;
  needsConstructionAuth: boolean;
  evidenceSufficientForLocalAnswer: boolean;
  reason: string;
};

export type ActionDecision =
  | {
      kind: 'answer_chat';
      executionMode: AgentExecutionMode;
      reason: string;
      message: string;
    }
  | {
      kind: 'answer_local';
      executionMode: AgentExecutionMode;
      reason: string;
    }
  | {
      kind: 'answer_from_raw';
      executionMode: AgentExecutionMode;
      reason: string;
    }
  | {
      kind: 'fetch_external';
      executionMode: AgentExecutionMode;
      reason: string;
    }
  | {
      kind: 'fetch_then_analyze';
      executionMode: AgentExecutionMode;
      reason: string;
    }
  | {
      kind: 'ask_clarification';
      executionMode: AgentExecutionMode;
      reason: string;
      message: string;
    }
  | {
      kind: 'request_auth';
      executionMode: AgentExecutionMode;
      reason: string;
      message: string;
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
  recentUsers?: Array<GetProjectUsersToolResult & { projectName?: string | undefined; fetchedAt: string }> | undefined;
  lastResolvedProjectId?: string | undefined;
  lastResolvedProjectName?: string | undefined;
  currentProjectAliases?: string[] | undefined;
  currentProjectConfidence?: number | undefined;
  currentProjectUpdatedAt?: string | undefined;
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
