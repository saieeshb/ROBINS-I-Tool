import { createContext, useContext } from 'react';
import type { EvidenceItem, ParseJob, Project, ResultSpec, SourceDocument, Study, StudyData } from '@robercop/shared';
import type { Focus } from '../../evidence/Evidence';

export type StudyDoc = SourceDocument & { job: ParseJob | null; latestJob: ParseJob | null };

export interface StudyPayload {
  project: Project;
  study: Study;
  results: ResultSpec[];
  documents: StudyDoc[];
  revisions: { id: string; revisionNo: number; hash: string; approvedBy: string; approvedAt: string; note: string }[];
  assessments: { id: string; resultId: string; role: string; reviewer: string; status: string; visible: boolean; overall: string; outstanding: number }[];
  readiness: { target: string; message: string }[];
}

/** Where evidence selected in the PDF should be linked. */
export type LinkTarget =
  | { kind: 'tt'; field: 'c1' | 'c2' | 'c3' | 'c4'; label: string }
  | { kind: 'triage'; resultId: string; q: 'B1' | 'B2' | 'B3'; label: string }
  | { kind: 'result'; resultId: string; label: string }
  | { kind: 'cf'; rowId: string; label: string };

export interface StudyCtxValue {
  payload: StudyPayload;
  evidence: EvidenceItem[];
  reloadEvidence: () => Promise<void>;
  reload: () => Promise<void>;
  /** Saves pending edits; await it before approving. */
  settle: () => Promise<void>;
  updateData: (fn: (d: StudyData) => void) => void;
  updateLabel: (label: string) => void;
  updateResult: (id: string, patch: Partial<ResultSpec>) => void;
  focus: Focus;
  linkTarget: LinkTarget | null;
  setLinkTarget: (t: LinkTarget | null) => void;
  linkEvidence: (target: LinkTarget, evidenceId: string, add?: boolean) => void;
  linkedIds: (target: LinkTarget) => string[];
  go: (section: string, anchor?: string) => void;
}

export const StudyCtx = createContext<StudyCtxValue | null>(null);

export function useStudy(): StudyCtxValue {
  const v = useContext(StudyCtx);
  if (!v) throw new Error('StudyCtx missing');
  return v;
}
