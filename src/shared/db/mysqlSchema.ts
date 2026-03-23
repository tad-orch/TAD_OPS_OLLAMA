export const mysqlSchemaSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  last_user_message TEXT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  content LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_messages_session_created_at (session_id, created_at)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  arguments_json JSON NULL,
  result_summary TEXT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_tool_calls_session_created_at (session_id, created_at)
);

CREATE TABLE IF NOT EXISTS auth_profiles (
  profile_id VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  auth_mode VARCHAR(32) NOT NULL,
  scopes_json JSON NULL,
  expires_at DATETIME NULL,
  token_store_path TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  INDEX idx_auth_profiles_active (is_active, updated_at)
);

CREATE TABLE IF NOT EXISTS token_storage_metadata (
  storage_key VARCHAR(255) PRIMARY KEY,
  store_path TEXT NOT NULL,
  store_kind VARCHAR(64) NOT NULL,
  auth_mode VARCHAR(32) NOT NULL,
  has_refresh_token TINYINT(1) NOT NULL DEFAULT 0,
  scopes_json JSON NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS project_cache (
  account_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(255) NOT NULL,
  project_name VARCHAR(255) NOT NULL,
  status VARCHAR(128) NULL,
  type VARCHAR(128) NULL,
  raw_json JSON NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id),
  INDEX idx_project_cache_account_name (account_id, project_name)
);

CREATE TABLE IF NOT EXISTS user_cache (
  project_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  autodesk_id VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  name VARCHAR(255) NULL,
  company_name VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  products_json JSON NULL,
  roles_json JSON NULL,
  raw_json JSON NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, user_id),
  INDEX idx_user_cache_project_email (project_id, email),
  INDEX idx_user_cache_fetched_at (fetched_at)
);

CREATE TABLE IF NOT EXISTS issue_cache (
  project_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  raw_json JSON NOT NULL,
  summary_json JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, item_id),
  INDEX idx_issue_cache_project_fetched_at (project_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS rfi_cache (
  project_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  raw_json JSON NOT NULL,
  summary_json JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, item_id),
  INDEX idx_rfi_cache_project_fetched_at (project_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS submittal_cache (
  project_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  raw_json JSON NOT NULL,
  summary_json JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, item_id),
  INDEX idx_submittal_cache_project_fetched_at (project_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS transmittal_cache (
  project_id VARCHAR(255) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  raw_json JSON NOT NULL,
  summary_json JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, item_id),
  INDEX idx_transmittal_cache_project_fetched_at (project_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS runtime_context (
  session_id VARCHAR(64) PRIMARY KEY,
  context_kind VARCHAR(64) NOT NULL,
  context_json JSON NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_runtime_context_kind (context_kind, updated_at)
);

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NULL,
  job_type VARCHAR(128) NOT NULL,
  status VARCHAR(64) NOT NULL,
  payload_json JSON NULL,
  result_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_jobs_status_created_at (status, created_at)
);
`;
