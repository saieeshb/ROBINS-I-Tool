import { createContext, useContext } from 'react';
import type { DomainId, Judgement } from '@robercop/rules';
import type { AiRun, Assessment, AssessmentEvaluation, EvidenceItem, Project, SourceDocument, StudyRevision, VerificationDecision, ParseJob } from '@robercop/shared';
import type { Focus } from '../../evidence/Evidence';

export interface ConsensusItem {
  id: string;
  target: string;
  answers: Record<string, string>;
  final: string;
  note: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface AssessmentPayload {
  assessment: Assessment;
  project: Project;
  study: { id: string; label: string; citation: string; approvedRevisionId: string | null };
  revision: Pick<StudyRevision, 'id' | 'revisionNo' | 'approvedAt' | 'approvedBy' | 'snapshot'>;
  resultName: string;
  evidence: EvidenceItem[];
  documents: (SourceDocument & { job: ParseJob | null })[];
  runs: AiRun[];
  canEdit: boolean;
  verification: { decisions: VerificationDecision[]; status: { unverified: string[]; open: VerificationDecision[]; awaitingRecheck: string[]; changedSinceCheck: string[] } | null; targets: { target: string; kind: string; value: string }[] } | null;
  consensusItems: ConsensusItem[];
  parents: Assessment[];
  finalizeProblems: string[];
}

export type View = DomainId | 'triage' | 'overall' | 'finish';

export interface AssessCtxValue {
  payload: AssessmentPayload;
  a: Assessment;
  ev: AssessmentEvaluation;
  evidence: EvidenceItem[];
  evidenceById: Map<string, EvidenceItem>;
  canEdit: boolean;
  isChecker: boolean;
  setAnswer: (qid: string, answer: string) => void;
  setRationale: (qid: string, text: string) => void;
  confirmAnswer: (qid: string) => void;
  setLinks: (qid: string, ids: string[]) => void;
  decideDomain: (d: DomainId, final: Judgement | '', reason: string) => void;
  decideOverall: (final: Judgement | '', reason: string) => void;
  activeQ: string | null;
  setActiveQ: (q: string | null) => void;
  view: View;
  setView: (v: View, q?: string | null) => void;
  focus: Focus;
  reload: () => Promise<void>;
  reloadEvidence: () => Promise<void>;
  addEvidenceToQuestion: (qid: string, ev: EvidenceItem) => void;
}

export const AssessCtx = createContext<AssessCtxValue | null>(null);

export function useAssess(): AssessCtxValue {
  const v = useContext(AssessCtx);
  if (!v) throw new Error('AssessCtx missing');
  return v;
}
