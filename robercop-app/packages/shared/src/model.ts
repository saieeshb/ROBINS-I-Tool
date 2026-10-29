import type { Answer, DomainId, Judgement } from '@robercop/rules';

export type VerificationMode = 'independent' | 'checking';

export interface Project {
  id: string;
  name: string;
  description: string;
  verificationMode: VerificationMode;
  rulesetVersion: string;
  /** Project confounding-factor matrix: outcome domain → important confounding factors (P1). */
  cfMatrix: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type InterventionType = '' | 'Point' | 'Sustained';
export type ComparatorType = '' | 'Alternative intervention' | 'Standard care' | 'No intervention';

export interface TargetTrial {
  c1: string;
  c2: string;
  c2Type: InterventionType;
  c3: string;
  c3Type: ComparatorType;
  /** C4: did the analysis account for switches/protocol deviations? 'No' = ITT (supported); 'Yes' = per-protocol (unsupported). */
  c4: 'No' | 'Yes';
  c4Note: string;
  /** Evidence item ids supporting each field. */
  links: Record<'c1' | 'c2' | 'c3' | 'c4', string[]>;
}

export interface ConfounderRow {
  id: string;
  factor: string;
  /** (i) listed in advance (from the project CF matrix) or (ii) additional, relevant to this study. */
  list: 'prespecified' | 'additional';
  variables: string;
  controlled: '' | 'Y' | 'N';
  valid: '' | 'NA' | 'Y' | 'PY' | 'PN' | 'N' | 'NI';
  unnecessary: '' | 'NA' | 'Y' | 'PY' | 'PN' | 'N';
  /** Which of the official conditions (a)–(f) supports "control unnecessary". */
  unnecessaryCondition: '' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
  comments: string;
  evidenceIds: string[];
}

export interface StudyData {
  citation: string;
  notes: string;
  targetTrial: TargetTrial;
  sources: { checked: string[]; other: string };
  confounders: ConfounderRow[];
}

export type StudyStatus = 'draft' | 'approved' | 'changed';

export interface Study {
  id: string;
  projectId: string;
  label: string;
  data: StudyData;
  /** draft: never approved; approved: matches the latest approved revision; changed: edited since approval. */
  status: StudyStatus;
  approvedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type TriageQuestionId = 'B1' | 'B2' | 'B3';

export interface TriageRecord {
  answers: Partial<Record<TriageQuestionId, Answer | ''>>;
  notes: Partial<Record<TriageQuestionId, string>>;
  evidenceIds: Partial<Record<TriageQuestionId, string[]>>;
}

/**
 * A specific numerical result: the ROBINS-I V2 unit of assessment. Different analyses of the same outcome are separate
 * results with their own identity.
 */
export interface ResultSpec {
  id: string;
  studyId: string;
  ordinal: number;
  /** Key into the project CF matrix (e.g. "Anastomotic Leak"). */
  outcomeDomain: string;
  outcome: string;
  timePoint: string;
  /** Intervention vs comparator, in the order used by the numerical result. */
  comparison: string;
  /** e.g. "Propensity-matched cohort, conditional logistic regression". */
  analysis: string;
  /** Effect of interest. Only ITT is supported in this release. */
  effect: 'ITT' | 'per-protocol';
  /** A1: the numerical result. */
  numericalResult: string;
  /** A2: further details, e.g. location in the report and reason chosen. */
  location: string;
  /** A3: the outcome to which the result relates (definition, ascertainment). */
  outcomeDefinition: string;
  importantFactors: string[];
  triage: TriageRecord;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface StudySnapshot {
  label: string;
  data: StudyData;
  results: ResultSpec[];
}

export interface StudyRevision {
  id: string;
  studyId: string;
  revisionNo: number;
  snapshot: StudySnapshot;
  /** SHA-256 of the canonical snapshot; used to detect changed baselines across installations. */
  hash: string;
  /** Reviewer who approved the content, or LEGACY_APPROVER for content imported from a legacy file. */
  approvedBy: string;
  approvedAt: string;
  note: string;
}

/** Marks study revisions created by a legacy import: they record imported content, not a human approval. */
export const LEGACY_APPROVER = 'legacy import (not reviewed)';

export function isLegacyRevision(r: Pick<StudyRevision, 'approvedBy'>): boolean {
  return r.approvedBy === LEGACY_APPROVER;
}

export type DocumentRole = 'manuscript' | 'supplement' | 'protocol' | 'registry' | 'other' | 'reference';

export interface SourceDocument {
  id: string;
  projectId: string;
  /** Null for project-level reference documents (e.g. consensus outcome definitions). */
  studyId: string | null;
  role: DocumentRole;
  label: string;
  filename: string;
  sha256: string;
  size: number;
  mime: string;
  createdAt: string;
}

export type ParseStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface ParseCoverage {
  pages: number;
  pagesWithText: number;
  /** Pages that produced no text (images, scans without OCR, or conversion failures). */
  emptyPages: number[];
  ocrPages: number[];
  tables: number;
  blocks: number;
}

export interface ParseJob {
  id: string;
  documentId: string;
  parser: 'docling' | 'pdfjs';
  parserVersion: string;
  settings: Record<string, unknown>;
  status: ParseStatus;
  progress: number;
  error: string | null;
  warnings: string[];
  coverage: ParseCoverage | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SourceBlock {
  id: string;
  documentId: string;
  jobId: string;
  seq: number;
  page: number;
  kind: string;
  text: string;
  section: string;
  /** [left, top, right, bottom] in PDF points, top-left origin, when known. */
  bbox: [number, number, number, number] | null;
  ocr: boolean;
}

export type SourceCheckStatus =
  | 'not_checked'
  | 'matched'
  | 'ambiguous'
  | 'unmatched'
  | 'incomplete_extraction'
  | 'needs_recheck'
  | 'manually_verified';

export interface MatchLocation {
  documentId: string;
  page: number;
  blockIds: string[];
  /** Matched text as it appears in the parsed source. */
  text: string;
}

export interface MatchCandidate extends MatchLocation {
  score: number;
  note: string;
}

export interface SourceCheck {
  status: SourceCheckStatus;
  method?: 'exact' | 'normalized' | 'elided' | 'manual';
  ocr?: boolean;
  locations: MatchLocation[];
  candidates: MatchCandidate[];
  /** Parse job whose blocks were checked; a newer parse marks the check as needing a recheck. */
  parseJobIds: string[];
  checkedAt?: string;
  notes: string[];
  manual?: { by: string; at: string; note: string; page: number | null };
}

export interface EvidenceItem {
  id: string;
  studyId: string;
  /** Set when the item was created inside an assessment; such items are never exported to independent reviewers. */
  assessmentId: string | null;
  documentId: string | null;
  kind: 'quote' | 'note';
  quote: string;
  page: number | null;
  section: string;
  theme: string;
  /** Questions the item was tagged as relevant to. Tags never carry an answer. */
  questionIds: string[];
  interpretation: string;
  origin: 'reviewer' | 'ai' | 'legacy_import';
  proposalId: string | null;
  runId: string | null;
  check: SourceCheck;
  acceptedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface QuestionResponse {
  answer: Answer | '';
  rationale: string;
  evidenceIds: string[];
  /** Reviewer who chose the current answer (local attribution, not an authenticated signature). */
  decidedBy: string | null;
  decidedAt: string | null;
  origin: 'reviewer' | 'legacy_import';
  /** Free-text evidence carried over from a legacy session that could not be linked to a source location. */
  legacyEvidence?: string;
  /** Set when something this answer depended on changed (e.g. a study revision); the reviewer must reconfirm it. */
  needsReconfirm?: string | null;
}

export interface DomainDecision {
  final: Judgement | '';
  reason: string;
  suggestedAtDecision: Judgement | '';
  rulesetVersion: string;
  decidedBy: string | null;
  decidedAt: string | null;
  origin: 'reviewer' | 'legacy_import';
  /** Set when answers or upstream context changed after the judgement was confirmed. */
  needsReconfirm?: string | null;
}

export type AssessmentRole = 'first' | 'second' | 'consensus';
export type AssessmentStatus = 'draft' | 'submitted' | 'finalized';

export interface Assessment {
  id: string;
  projectId: string;
  studyId: string;
  resultId: string;
  /** Approved study revision this assessment is based on. */
  studyRevisionId: string;
  reviewer: string;
  role: AssessmentRole;
  status: AssessmentStatus;
  responses: Record<string, QuestionResponse>;
  domains: Partial<Record<DomainId, DomainDecision>>;
  overall: DomainDecision;
  /** Consensus records point at the assessments they reconcile. */
  parentIds: string[];
  /** Assessment this one was imported from (package exchange), if any. */
  importedFrom: { installationId: string; assessmentId: string; packageId: string } | null;
  rulesetVersion: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  finalizedAt: string | null;
  version: number;
}

export type VerificationVerdict = 'confirmed' | 'change_requested' | 'disagree';

/** Checking-mode decision by the verifier on one question or judgement of a first assessment. */
export interface VerificationDecision {
  id: string;
  assessmentId: string;
  /** Question id, "D1".."D6", or "overall". */
  target: string;
  verdict: VerificationVerdict;
  proposedAnswer: string;
  comment: string;
  reviewer: string;
  createdAt: string;
  resolution: '' | 'accepted' | 'declined' | 'superseded';
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string;
}

export type AiTask =
  | 'find_evidence'
  | 'prepare_domain'
  | 'explain_evidence'
  | 'check_missing'
  | 'draft_rationale'
  | 'suggest_answer'
  | 'extract_study'
  | 'evaluate_confounders'
  | 'chat';

export type AiRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'usage_limited'
  | 'auth_required'
  | 'interrupted';

export interface AiRun {
  id: string;
  projectId: string;
  studyId: string | null;
  assessmentId: string | null;
  task: AiTask;
  scope: Record<string, unknown>;
  /** Fixed context the run was started against (study revision id and/or assessment version). */
  contextRevision: string;
  status: AiRunStatus;
  model: string | null;
  promptSummary: string;
  outputText: string;
  structured: unknown;
  error: string | null;
  costUsd: number | null;
  cliVersion: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type ProposalKind = 'evidence' | 'answer_suggestion' | 'rationale' | 'missing_info' | 'study_field' | 'confounder';

export interface AiProposal {
  id: string;
  runId: string;
  kind: ProposalKind;
  target: { questionId?: string; field?: string; resultId?: string; factor?: string };
  content: Record<string, unknown>;
  check: SourceCheck | null;
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface SearchRecord {
  id: string;
  studyId: string;
  assessmentId: string | null;
  questionId: string | null;
  query: string;
  hits: number;
  actor: string;
  runId: string | null;
  createdAt: string;
}

export interface RevisionRecord {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  data: unknown;
  actor: string;
  reason: string;
  createdAt: string;
}

export interface ReconciliationItem {
  target: string;
  answers: Record<string, string>;
  final: string;
  note: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export function emptyTargetTrial(): TargetTrial {
  return { c1: '', c2: '', c2Type: '', c3: '', c3Type: '', c4: 'No', c4Note: '', links: { c1: [], c2: [], c3: [], c4: [] } };
}

export function emptyStudyData(): StudyData {
  return { citation: '', notes: '', targetTrial: emptyTargetTrial(), sources: { checked: ['Journal article(s)'], other: '' }, confounders: [] };
}

export function emptyResponse(): QuestionResponse {
  return { answer: '', rationale: '', evidenceIds: [], decidedBy: null, decidedAt: null, origin: 'reviewer' };
}

export function emptyDecision(rulesetVersion: string): DomainDecision {
  return { final: '', reason: '', suggestedAtDecision: '', rulesetVersion, decidedBy: null, decidedAt: null, origin: 'reviewer' };
}

export function emptyCheck(): SourceCheck {
  return { status: 'not_checked', locations: [], candidates: [], parseJobIds: [], notes: [] };
}
