import type Database from 'better-sqlite3';

export const schemaSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_user_message TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT,
  result_summary TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_cache (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL PRIMARY KEY,
  project_name TEXT NOT NULL,
  status TEXT,
  type TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_cache (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL PRIMARY KEY,
  autodesk_id TEXT,
  email TEXT,
  name TEXT,
  company_name TEXT,
  status TEXT,
  products_json TEXT,
  roles_json TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_context (
  session_id TEXT PRIMARY KEY,
  current_account_id TEXT,
  current_project_id TEXT,
  current_project_name TEXT,
  memory_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
  ON messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session_created_at
  ON tool_calls(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_project_cache_account_name
  ON project_cache(account_id, project_name);

CREATE INDEX IF NOT EXISTS idx_user_cache_project_email
  ON user_cache(project_id, email);
`;

export function initializeSchema(db: Database.Database): void {
  db.exec(schemaSql);
}
