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
  user_id TEXT NOT NULL,
  autodesk_id TEXT,
  email TEXT,
  name TEXT,
  company_name TEXT,
  status TEXT,
  products_json TEXT,
  roles_json TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
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

CREATE TABLE IF NOT EXISTS auth_profiles (
  profile_id TEXT PRIMARY KEY,
  display_name TEXT,
  email TEXT,
  auth_mode TEXT NOT NULL,
  scopes_json TEXT,
  expires_at TEXT,
  token_store_path TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_storage_metadata (
  storage_key TEXT PRIMARY KEY,
  store_path TEXT NOT NULL,
  store_kind TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  has_refresh_token INTEGER NOT NULL DEFAULT 0,
  scopes_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_context (
  session_id TEXT PRIMARY KEY,
  context_kind TEXT NOT NULL,
  context_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issue_cache (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  due_date TEXT,
  created_at_iso TEXT,
  raw_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE IF NOT EXISTS rfi_cache (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  due_date TEXT,
  created_at_iso TEXT,
  raw_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE IF NOT EXISTS submittal_cache (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  due_date TEXT,
  created_at_iso TEXT,
  raw_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE IF NOT EXISTS transmittal_cache (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  due_date TEXT,
  created_at_iso TEXT,
  raw_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
  ON messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session_created_at
  ON tool_calls(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_project_cache_account_name
  ON project_cache(account_id, project_name);

CREATE INDEX IF NOT EXISTS idx_user_cache_project_email
  ON user_cache(project_id, email);

CREATE INDEX IF NOT EXISTS idx_user_cache_project_id
  ON user_cache(project_id);

CREATE INDEX IF NOT EXISTS idx_user_cache_fetched_at
  ON user_cache(fetched_at);

CREATE INDEX IF NOT EXISTS idx_auth_profiles_active
  ON auth_profiles(is_active, updated_at);

CREATE INDEX IF NOT EXISTS idx_runtime_context_kind
  ON runtime_context(context_kind, updated_at);

CREATE INDEX IF NOT EXISTS idx_issue_cache_project_fetched_at
  ON issue_cache(project_id, fetched_at);

CREATE INDEX IF NOT EXISTS idx_rfi_cache_project_fetched_at
  ON rfi_cache(project_id, fetched_at);

CREATE INDEX IF NOT EXISTS idx_submittal_cache_project_fetched_at
  ON submittal_cache(project_id, fetched_at);

CREATE INDEX IF NOT EXISTS idx_transmittal_cache_project_fetched_at
  ON transmittal_cache(project_id, fetched_at);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
  ON jobs(status, created_at);
`;

const userCacheTableSql = `
CREATE TABLE user_cache (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  autodesk_id TEXT,
  email TEXT,
  name TEXT,
  company_name TEXT,
  status TEXT,
  products_json TEXT,
  roles_json TEXT,
  raw_json TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
)
`;

function needsUserCacheMigration(db: Database.Database): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(user_cache)`)
    .all() as Array<{ name: string; pk: number }>;

  if (columns.length === 0) {
    return false;
  }

  const projectIdColumn = columns.find((column) => column.name === 'project_id');
  const userIdColumn = columns.find((column) => column.name === 'user_id');

  return projectIdColumn?.pk !== 1 || userIdColumn?.pk !== 2;
}

function migrateUserCacheTable(db: Database.Database): void {
  if (!needsUserCacheMigration(db)) {
    return;
  }

  db.exec(`
    DROP INDEX IF EXISTS idx_user_cache_project_email;
    DROP INDEX IF EXISTS idx_user_cache_project_id;
    DROP INDEX IF EXISTS idx_user_cache_fetched_at;
    ALTER TABLE user_cache RENAME TO user_cache_old;
    ${userCacheTableSql};
    INSERT OR REPLACE INTO user_cache (
      project_id, user_id, autodesk_id, email, name, company_name, status,
      products_json, roles_json, raw_json, fetched_at
    )
    SELECT
      project_id, user_id, autodesk_id, email, name, company_name, status,
      products_json, roles_json, raw_json, fetched_at
    FROM user_cache_old;
    DROP TABLE user_cache_old;
    CREATE INDEX IF NOT EXISTS idx_user_cache_project_email
      ON user_cache(project_id, email);
    CREATE INDEX IF NOT EXISTS idx_user_cache_project_id
      ON user_cache(project_id);
    CREATE INDEX IF NOT EXISTS idx_user_cache_fetched_at
      ON user_cache(fetched_at);
  `);
}

export function initializeSchema(db: Database.Database): void {
  db.exec(schemaSql);
  migrateUserCacheTable(db);
}
