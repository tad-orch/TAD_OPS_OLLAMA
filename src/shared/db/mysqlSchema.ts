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

CREATE TABLE IF NOT EXISTS api_documents (
  id VARCHAR(64) PRIMARY KEY,
  domain VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  endpoint TEXT NOT NULL,
  http_method VARCHAR(16) NOT NULL,
  request_context_json JSON NULL,
  scope_ids_json JSON NULL,
  response_hash VARCHAR(64) NOT NULL,
  response_json JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  INDEX idx_api_documents_domain_fetched_at (domain, fetched_at)
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

CREATE TABLE IF NOT EXISTS canonical_projects (
  project_id VARCHAR(255) PRIMARY KEY,
  account_id VARCHAR(255) NULL,
  hub_id VARCHAR(255) NULL,
  name VARCHAR(255) NOT NULL,
  project_type VARCHAR(128) NULL,
  status VARCHAR(128) NULL,
  is_active TINYINT(1) NULL,
  is_archived TINYINT(1) NULL,
  root_folder_urn TEXT NULL,
  container_json JSON NULL,
  web_url TEXT NULL,
  details_json JSON NULL,
  raw_document_id VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL,
  INDEX idx_canonical_projects_account_name (account_id, name),
  INDEX idx_canonical_projects_hub_name (hub_id, name)
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

CREATE TABLE IF NOT EXISTS canonical_users (
  project_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  account_id VARCHAR(255) NULL,
  autodesk_id VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  name VARCHAR(255) NULL,
  company_name VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  products_json JSON NULL,
  roles_json JSON NULL,
  details_json JSON NULL,
  raw_document_id VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, user_id),
  INDEX idx_canonical_users_project_email (project_id, email),
  INDEX idx_canonical_users_project_company (project_id, company_name)
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

CREATE TABLE IF NOT EXISTS canonical_issues (
  project_id VARCHAR(255) NOT NULL,
  issue_id VARCHAR(255) NOT NULL,
  display_id VARCHAR(255) NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  issue_type VARCHAR(128) NULL,
  assigned_to VARCHAR(255) NULL,
  location_text TEXT NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  details_json JSON NULL,
  raw_document_id VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, issue_id),
  INDEX idx_canonical_issues_project_status (project_id, status)
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

CREATE TABLE IF NOT EXISTS canonical_rfis (
  project_id VARCHAR(255) NOT NULL,
  rfi_id VARCHAR(255) NOT NULL,
  display_id VARCHAR(255) NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  rfi_type VARCHAR(128) NULL,
  assigned_to VARCHAR(255) NULL,
  location_text TEXT NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  details_json JSON NULL,
  raw_document_id VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, rfi_id),
  INDEX idx_canonical_rfis_project_status (project_id, status)
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

CREATE TABLE IF NOT EXISTS canonical_submittals (
  project_id VARCHAR(255) NOT NULL,
  submittal_id VARCHAR(255) NOT NULL,
  display_id VARCHAR(255) NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  submittal_type VARCHAR(128) NULL,
  response_label VARCHAR(128) NULL,
  spec_label VARCHAR(255) NULL,
  assigned_to VARCHAR(255) NULL,
  manager_name VARCHAR(255) NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  details_json JSON NULL,
  raw_document_id VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, submittal_id),
  INDEX idx_canonical_submittals_project_status (project_id, status)
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

CREATE TABLE IF NOT EXISTS canonical_transmittals (
  project_id VARCHAR(255) NOT NULL,
  transmittal_id VARCHAR(255) NOT NULL,
  display_id VARCHAR(255) NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(128) NULL,
  number_label VARCHAR(255) NULL,
  created_by VARCHAR(255) NULL,
  due_date VARCHAR(32) NULL,
  created_at_iso VARCHAR(32) NULL,
  details_json JSON NULL,
  raw_document_id VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (project_id, transmittal_id),
  INDEX idx_canonical_transmittals_project_status (project_id, status)
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id VARCHAR(64) PRIMARY KEY,
  document_id VARCHAR(64) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  chunk_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(255) NULL,
  project_id VARCHAR(255) NULL,
  sequence_no INT NOT NULL,
  token_estimate INT NOT NULL,
  content_text LONGTEXT NULL,
  content_json JSON NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_document_chunks_document_seq (document_id, sequence_no),
  INDEX idx_document_chunks_project_type (project_id, chunk_type)
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
