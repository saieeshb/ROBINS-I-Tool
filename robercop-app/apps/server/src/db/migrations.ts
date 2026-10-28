/** Ordered schema migrations. Never edit an applied migration; add a new one. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX revisions_entity ON revisions (entity_type, entity_id, created_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE studies (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX studies_project ON studies (project_id);

CREATE TABLE results (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL
);
CREATE INDEX results_study ON results (study_id);

CREATE TABLE study_revisions (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX study_revisions_study ON study_revisions (study_id, revision_no);

CREATE TABLE documents (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id TEXT REFERENCES studies(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL
);
CREATE INDEX documents_study ON documents (study_id);
CREATE INDEX documents_project ON documents (project_id);

CREATE TABLE parse_jobs (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL
);
CREATE INDEX parse_jobs_document ON parse_jobs (document_id, created_at);
CREATE INDEX parse_jobs_status ON parse_jobs (status);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES parse_jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  page INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  section TEXT NOT NULL,
  bbox TEXT,
  ocr INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX blocks_job ON blocks (job_id, seq);
CREATE VIRTUAL TABLE blocks_fts USING fts5(text, section, content='blocks', content_rowid='rowid', tokenize='porter unicode61');
CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts (rowid, text, section) VALUES (new.rowid, new.text, new.section);
END;
CREATE TRIGGER blocks_ad AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts (blocks_fts, rowid, text, section) VALUES ('delete', old.rowid, old.text, old.section);
END;

CREATE TABLE evidence (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  assessment_id TEXT,
  document_id TEXT
);
CREATE INDEX evidence_study ON evidence (study_id);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  reviewer TEXT NOT NULL
);
CREATE INDEX assessments_result ON assessments (result_id);
CREATE INDEX assessments_study ON assessments (study_id);
CREATE INDEX assessments_project ON assessments (project_id);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE
);
CREATE INDEX verifications_assessment ON verifications (assessment_id);

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  study_id TEXT,
  assessment_id TEXT,
  status TEXT NOT NULL
);
CREATE INDEX ai_runs_study ON ai_runs (study_id, created_at);
CREATE INDEX ai_runs_status ON ai_runs (status);

CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL
);
CREATE INDEX ai_proposals_run ON ai_proposals (run_id);

CREATE TABLE searches (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  study_id TEXT NOT NULL,
  assessment_id TEXT,
  run_id TEXT
);
CREATE INDEX searches_study ON searches (study_id, created_at);

CREATE TABLE packages (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX packages_project ON packages (project_id);

CREATE TABLE consensus_items (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE
);
CREATE INDEX consensus_items_assessment ON consensus_items (assessment_id);
`
  }
];
