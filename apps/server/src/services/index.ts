import type { AppConfig } from '../config.js';
import { Database } from '../db/database.js';
import { Store } from '../db/store.js';
import { ProposalService } from '../ai/proposals.js';
import { ClaudeCodeRunner, type AiSettings } from '../ai/runner.js';
import { ParseService } from '../parsing/service.js';
import { AssessmentService } from './assessments.js';
import { DocumentService } from './documents.js';
import { EvidenceService } from './evidence.js';
import { ExportService } from './exports.js';
import { LegacyService } from './legacy.js';
import { PackageService } from './packages.js';
import { ProjectService } from './projects.js';
import { StudyService } from './studies.js';
import { VerificationService } from './verification.js';

export interface AppSettings {
  reviewers: string[];
  parser: 'auto' | 'docling' | 'pdfjs';
  ai: AiSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  reviewers: [],
  parser: 'auto',
  ai: { model: '', isolateSettings: true, allowApiBilling: false }
};

export interface Services {
  config: AppConfig;
  db: Database;
  store: Store;
  projects: ProjectService;
  studies: StudyService;
  documents: DocumentService;
  parsing: ParseService;
  evidence: EvidenceService;
  assessments: AssessmentService;
  verification: VerificationService;
  ai: ClaudeCodeRunner;
  proposals: ProposalService;
  packages: PackageService;
  legacy: LegacyService;
  exports: ExportService;
  settings(): AppSettings;
  close(): void;
}

export function createServices(config: AppConfig): Services {
  const db = new Database(config.dbPath);
  const store = new Store(db);
  store.installationId();
  const settings = (): AppSettings => {
    const s = store.getSetting<Partial<AppSettings>>('app', {});
    return { ...DEFAULT_SETTINGS, ...s, ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai ?? {}) } };
  };
  const projects = new ProjectService(store);
  const studies = new StudyService(store);
  const documents = new DocumentService(store, config);
  const parsing = new ParseService(store, config, documents);
  const evidence = new EvidenceService(store, documents);
  const assessments = new AssessmentService(store, studies, evidence);
  const verification = new VerificationService(store, assessments);
  const ai = new ClaudeCodeRunner(store, config, documents, studies, assessments, evidence, () => settings().ai);
  const proposals = new ProposalService(store, evidence);
  const packages = new PackageService(store, config, documents);
  const legacy = new LegacyService(store, config, studies);
  const exports = new ExportService(store, config, studies, documents, assessments, verification);

  // A new parse of a document makes earlier quotation checks against it stale; re-run them.
  parsing.onParsed = (documentId) => {
    const doc = store.documents.get(documentId);
    if (!doc) return;
    const studyIds = doc.studyId ? [doc.studyId] : store.studies.find({ project_id: doc.projectId }).map((s) => s.id);
    for (const id of studyIds) evidence.recheckStudy(id);
  };

  return {
    config,
    db,
    store,
    projects,
    studies,
    documents,
    parsing,
    evidence,
    assessments,
    verification,
    ai,
    proposals,
    packages,
    legacy,
    exports,
    settings,
    close: () => {
      parsing.shutdown();
      ai.shutdown();
      db.close();
    }
  };
}
