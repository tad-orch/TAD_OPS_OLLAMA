import type { Message } from 'ollama';

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

export type ProjectMemoryItem = {
  id: string;
  name: string;
};

export type SessionMemory = {
  recentProjects?: ProjectMemoryItem[] | undefined;
  lastResolvedProjectId?: string | undefined;
  lastResolvedProjectName?: string | undefined;
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
