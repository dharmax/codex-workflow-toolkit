/**
 * Responsibility: Define the canonical SQL schema for the workflow database.
 * Scope: Handles table definitions, indexes, and migrations for operational project state.
 */

export const SQLITE_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  sha1 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0,
  line INTEGER,
  column INTEGER,
  metadata_json TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT,
  object_text TEXT,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  provenance TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  file_path TEXT,
  line INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  lane TEXT,
  state TEXT NOT NULL,
  confidence REAL NOT NULL,
  provenance TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  review_state TEXT NOT NULL,
  parent_id TEXT,
  relevant_until TEXT,
  consultation_question TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  note_type TEXT NOT NULL,
  status TEXT NOT NULL,
  file_path TEXT,
  symbol_name TEXT,
  line INTEGER,
  column INTEGER,
  body TEXT NOT NULL,
  normalized_body TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  provenance TEXT NOT NULL,
  risk_score REAL NOT NULL,
  leverage_score REAL NOT NULL,
  ticket_value_score REAL NOT NULL,
  candidate_score REAL NOT NULL,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  score REAL NOT NULL,
  decision_key TEXT NOT NULL UNIQUE,
  last_review_at TEXT,
  next_review_at TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_index (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  responsibility TEXT,
  api_paradigm TEXT NOT NULL DEFAULT 'method-calls',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS architectural_graph (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  task_class TEXT NOT NULL,
  capability TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  success INTEGER NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL, -- 'running', 'completed', 'failed', 'paused'
  current_state TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL, -- 'pending', 'completed', 'failed'
  result_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (run_id, step_id),
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_state (
  run_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, key),
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  run_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  label TEXT,
  trigger_type TEXT NOT NULL, -- 'success', 'error', 'condition', 'user'
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_issues (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  issue_type TEXT NOT NULL, -- 'exception', 'failed_test', 'user_criticism', 'integrity_violation'
  severity TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  summary TEXT NOT NULL,
  details_json TEXT,
  status TEXT NOT NULL, -- 'open', 'investigating', 'fixed', 'ignored'
  resolution_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL,
  command TEXT,
  summary TEXT,
  artifact_ref TEXT,
  recorded_at TEXT NOT NULL,
  details_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_metrics_task ON metrics(task_class);
CREATE INDEX IF NOT EXISTS idx_metrics_provider ON metrics(provider_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_test ON test_runs(test_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_target ON test_runs(target_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_recorded ON test_runs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_id);
CREATE INDEX IF NOT EXISTS idx_claims_file_path ON claims(file_path);
CREATE INDEX IF NOT EXISTS idx_entities_type_lane ON entities(entity_type, lane);
CREATE INDEX IF NOT EXISTS idx_notes_file_path ON notes(file_path);
CREATE INDEX IF NOT EXISTS idx_candidates_status_review ON candidates(status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_search_scope_ref ON search_index(scope, ref_id);
CREATE INDEX IF NOT EXISTS idx_arch_graph_subject ON architectural_graph(subject_id);
CREATE INDEX IF NOT EXISTS idx_arch_graph_object ON architectural_graph(object_id);
CREATE INDEX IF NOT EXISTS idx_arch_graph_predicate ON architectural_graph(predicate);
`;
