import {
  checkDomainDecision,
  checkOverallDecision,
  DOMAINS,
  evaluateDomain,
  evaluateOverall,
  evaluateTriage,
  type AnswerMap,
  type DecisionCheck,
  type DomainEvaluation,
  type DomainId,
  type Judgement,
  type OverallEvaluation,
  type TriageEvaluation
} from '@robercop/rules';
import { isCheckAcceptable } from './match.js';
import type { Assessment, DomainDecision, EvidenceItem, ResultSpec, StudySnapshot } from './model.js';
import { emptyDecision } from './model.js';

export interface Problem {
  /** Question id, domain id, "overall", "triage" or "scope". */
  target: string;
  message: string;
}

export interface DomainState {
  evaluation: DomainEvaluation;
  decision: DomainDecision;
  check: DecisionCheck;
  final: Judgement | undefined;
}

export interface AssessmentEvaluation {
  result: ResultSpec | undefined;
  triage: TriageEvaluation;
  triageCritical: boolean;
  /** Set when the result estimates a per-protocol effect, which this release does not support. */
  unsupported: string | null;
  domains: Record<DomainId, DomainState>;
  overall: { evaluation: OverallEvaluation; decision: DomainDecision; check: DecisionCheck; suggested: Judgement | undefined };
  /** Per-question warnings shown next to the answer. */
  flags: Record<string, string[]>;
  /** Blocking problems for submission or finalization. */
  problems: Problem[];
  progress: { answered: number; reached: number };
}

function answersOf(a: Assessment): AnswerMap {
  const out: AnswerMap = {};
  for (const [id, r] of Object.entries(a.responses)) if (r.answer) out[id] = r.answer;
  return out;
}

export function perProtocolReason(snapshot: StudySnapshot, result: ResultSpec | undefined): string | null {
  if (snapshot.data.targetTrial.c4 === 'Yes') return 'C4 = Yes: the analysis estimates a per-protocol effect, which is not supported in this release (ITT / Domain 1 Variant A only).';
  if (result?.effect === 'per-protocol') return 'This result estimates a per-protocol effect, which is not supported in this release (ITT / Domain 1 Variant A only).';
  return null;
}

/**
 * Evaluates an assessment against the study revision it is based on. Pure: used by the browser for instant feedback and
 * by the server to enforce completeness when submitting or finalizing.
 */
export function evaluateAssessment(
  assessment: Assessment,
  snapshot: StudySnapshot,
  evidence: Map<string, EvidenceItem>,
  opts: { legacyRevision?: boolean } = {}
): AssessmentEvaluation {
  const result = snapshot.results.find((r) => r.id === assessment.resultId);
  const problems: Problem[] = [];
  if (opts.legacyRevision) {
    problems.push({
      target: 'scope',
      message: 'The study details were imported from a legacy file and have not been reviewed. Check and approve the Study session, then move this assessment to the approved revision.'
    });
  }
  const flags: Record<string, string[]> = {};
  const flag = (id: string, msg: string) => (flags[id] ??= []).push(msg);

  const triage = evaluateTriage((result?.triage.answers ?? {}) as AnswerMap);
  const triageCritical = triage.status === 'critical';
  const unsupported = perProtocolReason(snapshot, result);
  if (!result) problems.push({ target: 'scope', message: 'The result is not part of the approved study revision.' });
  if (unsupported) problems.push({ target: 'scope', message: unsupported });
  if (triage.status === 'incomplete' || triage.status === 'invalid') {
    problems.push({ target: 'triage', message: 'Triage (Section B) is incomplete in the approved study revision.' });
  }

  const answers = answersOf(assessment);
  let answered = 0;
  let reachedCount = 0;
  const domains = {} as Record<DomainId, DomainState>;
  for (const d of DOMAINS) {
    const evaluation = evaluateDomain(d.id, answers);
    const decision = assessment.domains[d.id] ?? emptyDecision(assessment.rulesetVersion);
    const check = checkDomainDecision(evaluation.suggested, decision.final || undefined, decision.reason);
    domains[d.id] = { evaluation, decision, check, final: decision.final || undefined };
    if (triageCritical) continue;

    for (const q of evaluation.questions) {
      if (!q.reached) {
        if (q.excluded) flag(q.id, 'Not reached after an upstream change; the answer is kept but excluded from scoring.');
        continue;
      }
      reachedCount++;
      const r = assessment.responses[q.id];
      if (!r?.answer) continue;
      answered++;
      if (r.origin === 'legacy_import') {
        flag(q.id, 'Imported from a legacy session; confirm the answer to make it your decision.');
        problems.push({ target: q.id, message: `${q.id}: imported answer has not been confirmed.` });
      }
      if (r.needsReconfirm) {
        flag(q.id, r.needsReconfirm);
        problems.push({ target: q.id, message: `${q.id}: ${r.needsReconfirm}` });
      }
      for (const evId of r.evidenceIds) {
        const ev = evidence.get(evId);
        if (!ev) {
          flag(q.id, 'Linked evidence is missing.');
          problems.push({ target: q.id, message: `${q.id}: linked evidence is missing.` });
          continue;
        }
        if (ev.kind === 'quote' && !isCheckAcceptable(ev.check)) {
          flag(q.id, `Quotation not verified against the source (${ev.check.status.replace(/_/g, ' ')}).`);
          problems.push({ target: q.id, message: `${q.id}: a linked quotation is ${ev.check.status.replace(/_/g, ' ')}; resolve it or record a manual check.` });
        }
        if (r.decidedAt && (ev.changedAt ?? ev.updatedAt) > r.decidedAt) {
          flag(q.id, 'Linked evidence changed after this answer was chosen; reconfirm the answer.');
          problems.push({ target: q.id, message: `${q.id}: linked evidence changed after the answer was chosen.` });
        }
      }
    }
    for (const id of evaluation.outstanding) problems.push({ target: id, message: `${id} is unanswered.` });
    if (evaluation.status === 'invalid') problems.push({ target: d.id, message: `${d.id}: ${evaluation.problem}` });
    if (evaluation.status === 'complete') {
      if (!check.ok) problems.push({ target: d.id, message: `${d.id}: ${check.problem}` });
      if (decision.needsReconfirm) problems.push({ target: d.id, message: `${d.id}: ${decision.needsReconfirm}` });
      if (decision.origin === 'legacy_import') problems.push({ target: d.id, message: `${d.id}: imported judgement has not been confirmed.` });
    }
  }

  const finals: Partial<Record<DomainId, Judgement>> = {};
  for (const d of DOMAINS) if (domains[d.id].check.ok && domains[d.id].final) finals[d.id] = domains[d.id].final;
  const overallEvaluation = triageCritical
    ? ({ status: 'complete', suggested: 'Critical', worstDomains: [], missingDomains: [], counts: { Low: 0, Moderate: 0, Serious: 0, Critical: 0 }, allowed: ['Critical'] } as OverallEvaluation)
    : evaluateOverall(finals);
  const overallDecision = assessment.overall ?? emptyDecision(assessment.rulesetVersion);
  const overallCheck = checkOverallDecision(overallEvaluation, overallDecision.final || undefined, overallDecision.reason);
  if (overallEvaluation.status === 'complete') {
    if (!overallCheck.ok) problems.push({ target: 'overall', message: `Overall: ${overallCheck.problem}` });
    if (overallDecision.needsReconfirm) problems.push({ target: 'overall', message: `Overall: ${overallDecision.needsReconfirm}` });
    if (overallDecision.origin === 'legacy_import') problems.push({ target: 'overall', message: 'Overall: imported judgement has not been confirmed.' });
  } else if (!triageCritical) {
    problems.push({ target: 'overall', message: 'Overall: confirm all six domain judgements first.' });
  }

  return {
    result,
    triage,
    triageCritical,
    unsupported,
    domains,
    overall: { evaluation: overallEvaluation, decision: overallDecision, check: overallCheck, suggested: overallEvaluation.suggested },
    flags,
    problems,
    progress: { answered, reached: reachedCount }
  };
}

/** The domain a question belongs to, for invalidating that domain's judgement when its answers change. */
export function domainForQuestion(questionId: string): DomainId | undefined {
  return DOMAINS.find((d) => d.questionIds.includes(questionId))?.id;
}
