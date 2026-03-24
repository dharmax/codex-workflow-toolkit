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

CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_id);
CREATE INDEX IF NOT EXISTS idx_claims_file_path ON claims(file_path);
CREATE INDEX IF NOT EXISTS idx_entities_type_lane ON entities(entity_type, lane);
CREATE INDEX IF NOT EXISTS idx_notes_file_path ON notes(file_path);
CREATE INDEX IF NOT EXISTS idx_candidates_status_review ON candidates(status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_search_scope_ref ON search_index(scope, ref_id);
`;
