import type {
  AiProposal,
  AiRun,
  Assessment,
  EvidenceItem,
  ParseJob,
  Project,
  ReconciliationItem,
  ResultSpec,
  SearchRecord,
  SourceBlock,
  SourceDocument,
  Study,
  StudyRevision,
  VerificationDecision
} from '@robercop/shared';
import { Collection, Database, newId, now } from './database.js';
import { toFtsQuery } from './fts.js';

export { toFtsQuery };

export interface PackageRecord {
  id: string;
  projectId: string;
  direction: 'export' | 'import';
  kind: 'independent_assignment' | 'checking_assignment' | 'completed_review';
  filename: string;
  sha256: string;
  manifest: Record<string, unknown>;
  status: 'created' | 'imported' | 'rejected';
  notes: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ConsensusItem extends ReconciliationItem {
  id: string;
  assessmentId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

type V = { version: number; createdAt?: string; updatedAt?: string };

export class Store {
  readonly projects: Collection<Project>;
  readonly studies: Collection<Study>;
  readonly results: Collection<ResultSpec>;
  readonly studyRevisions: Collection<StudyRevision & V>;
  readonly documents: Collection<SourceDocument & V>;
  readonly parseJobs: Collection<ParseJob & V>;
  readonly evidence: Collection<EvidenceItem>;
  readonly assessments: Collection<Assessment>;
  readonly verifications: Collection<VerificationDecision & V>;
  readonly aiRuns: Collection<AiRun & V>;
  readonly proposals: Collection<AiProposal & V>;
  readonly searches: Collection<SearchRecord & V>;
  readonly packages: Collection<PackageRecord>;
  readonly consensusItems: Collection<ConsensusItem>;

  constructor(readonly db: Database) {
    this.projects = new Collection(db, 'projects', 'project', {});
    this.studies = new Collection(db, 'studies', 'study', { project_id: (e) => e.projectId });
    this.results = new Collection(db, 'results', 'result', { study_id: (e) => e.studyId, ordinal: (e) => e.ordinal });
    this.studyRevisions = new Collection(db, 'study_revisions', 'study_revision', {
      study_id: (e) => e.studyId,
      revision_no: (e) => e.revisionNo,
      hash: (e) => e.hash
    });
    this.documents = new Collection(db, 'documents', 'document', {
      project_id: (e) => e.projectId,
      study_id: (e) => e.studyId,
      sha256: (e) => e.sha256
    });
    this.parseJobs = new Collection(db, 'parse_jobs', 'parse_job', { document_id: (e) => e.documentId, status: (e) => e.status });
    this.evidence = new Collection(db, 'evidence', 'evidence', {
      study_id: (e) => e.studyId,
      assessment_id: (e) => e.assessmentId,
      document_id: (e) => e.documentId
    });
    this.assessments = new Collection(db, 'assessments', 'assessment', {
      project_id: (e) => e.projectId,
      study_id: (e) => e.studyId,
      result_id: (e) => e.resultId,
      role: (e) => e.role,
      status: (e) => e.status,
      reviewer: (e) => e.reviewer
    });
    this.verifications = new Collection(db, 'verifications', 'verification', { assessment_id: (e) => e.assessmentId });
    this.aiRuns = new Collection(db, 'ai_runs', 'ai_run', {
      project_id: (e) => e.projectId,
      study_id: (e) => e.studyId,
      assessment_id: (e) => e.assessmentId,
      status: (e) => e.status
    });
    this.proposals = new Collection(db, 'ai_proposals', 'ai_proposal', { run_id: (e) => e.runId, status: (e) => e.status });
    this.searches = new Collection(db, 'searches', 'search', {
      study_id: (e) => e.studyId,
      assessment_id: (e) => e.assessmentId,
      run_id: (e) => e.runId
    });
    this.packages = new Collection(db, 'packages', 'package', { project_id: (e) => e.projectId });
    this.consensusItems = new Collection(db, 'consensus_items', 'consensus_item', { assessment_id: (e) => e.assessmentId });
  }

  // --- settings -------------------------------------------------------------
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return row ? (JSON.parse(row.value) as T) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value)
    );
  }

  installationId(): string {
    let id = this.getSetting<string | null>('installationId', null);
    if (!id) {
      id = newId();
      this.setSetting('installationId', id);
    }
    return id;
  }

  // --- parsed blocks ----------------------------------------------------------
  insertBlocks(blocks: SourceBlock[]): void {
    this.db.tx(() => {
      const stmt = this.db.db.prepare(
        'INSERT INTO blocks (id, document_id, job_id, seq, page, kind, text, section, bbox, ocr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const b of blocks) {
        stmt.run(b.id, b.documentId, b.jobId, b.seq, b.page, b.kind, b.text, b.section, b.bbox ? JSON.stringify(b.bbox) : null, b.ocr ? 1 : 0);
      }
    });
  }

  blocksForJob(jobId: string): SourceBlock[] {
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM blocks WHERE job_id = ? ORDER BY seq', jobId)
      .map(rowToBlock);
  }

  blocksByIds(ids: string[]): SourceBlock[] {
    if (ids.length === 0) return [];
    return this.db
      .all<Record<string, unknown>>(`SELECT * FROM blocks WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY seq`, ...ids)
      .map(rowToBlock);
  }

  /** Full-text search restricted to the given parse jobs. */
  searchBlocks(jobIds: string[], query: string, limit = 12): (SourceBlock & { snippet: string; rank: number })[] {
    if (jobIds.length === 0) return [];
    const match = toFtsQuery(query);
    if (!match) return [];
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT b.*, snippet(blocks_fts, 0, '[[', ']]', ' … ', 24) AS snippet, bm25(blocks_fts) AS rank
       FROM blocks_fts JOIN blocks b ON b.rowid = blocks_fts.rowid
       WHERE blocks_fts MATCH ? AND b.job_id IN (${jobIds.map(() => '?').join(',')})
       ORDER BY rank LIMIT ?`,
      match,
      ...jobIds,
      limit
    );
    return rows.map((r) => ({ ...rowToBlock(r), snippet: String(r.snippet), rank: Number(r.rank) }));
  }

  revisionsFor(entityType: string, entityId: string): { id: string; version: number; actor: string; reason: string; createdAt: string; data: unknown }[] {
    return this.db
      .all<Record<string, unknown>>(
        'SELECT id, version, actor, reason, created_at, data FROM revisions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, version',
        entityType,
        entityId
      )
      .map((r) => ({
        id: String(r.id),
        version: Number(r.version),
        actor: String(r.actor),
        reason: String(r.reason),
        createdAt: String(r.created_at),
        data: JSON.parse(String(r.data))
      }));
  }

  touch(): string {
    return now();
  }
}

function rowToBlock(r: Record<string, unknown>): SourceBlock {
  return {
    id: String(r.id),
    documentId: String(r.document_id),
    jobId: String(r.job_id),
    seq: Number(r.seq),
    page: Number(r.page),
    kind: String(r.kind),
    text: String(r.text),
    section: String(r.section),
    bbox: r.bbox ? (JSON.parse(String(r.bbox)) as [number, number, number, number]) : null,
    ocr: Number(r.ocr) === 1
  };
}

