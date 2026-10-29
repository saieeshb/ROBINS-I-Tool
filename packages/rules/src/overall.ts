import { getDomain } from './questions.js';
import type { DomainId, Judgement } from './types.js';
import { DOMAIN_IDS, judgementRank, worstJudgement } from './types.js';

export interface OverallEvaluation {
  status: 'complete' | 'incomplete';
  /** Default overall judgement: the worst domain judgement (Guidance note 17). */
  suggested?: Judgement;
  worstDomains: DomainId[];
  missingDomains: DomainId[];
  counts: Record<Judgement, number>;
  /**
   * Prompt to consider an additive (compounded) judgement. Escalation is never automatic: the reviewer decides
   * and must justify it.
   */
  compounding?: { consider: Judgement; reason: string };
  /** Judgements the reviewer may choose: the default or any greater risk. */
  allowed: Judgement[];
}

/**
 * Overall risk of bias. ROBINS-I defaults the overall judgement to the worst domain; the reviewer may override it to
 * a greater risk when problems in several domains compound (e.g. several Serious domains → Critical).
 */
export function evaluateOverall(finals: Partial<Record<DomainId, Judgement | undefined>>): OverallEvaluation {
  const counts: Record<Judgement, number> = { Low: 0, Moderate: 0, Serious: 0, Critical: 0 };
  const present: Judgement[] = [];
  const missingDomains: DomainId[] = [];
  for (const d of DOMAIN_IDS) {
    const j = finals[d];
    if (j) {
      counts[j] += 1;
      present.push(j);
    } else missingDomains.push(d);
  }
  if (missingDomains.length > 0) {
    return { status: 'incomplete', worstDomains: [], missingDomains, counts, allowed: [] };
  }
  const suggested = worstJudgement(present)!;
  const worstDomains = DOMAIN_IDS.filter((d) => finals[d] === suggested);
  let compounding: OverallEvaluation['compounding'];
  if (suggested === 'Serious' && counts.Serious >= 2) {
    compounding = {
      consider: 'Critical',
      reason: `${counts.Serious} domains are at Serious risk. If these problems are likely to compound, an additive judgement of Critical may be reasonable.`
    };
  } else if (suggested === 'Moderate' && counts.Moderate >= 2) {
    compounding = {
      consider: 'Serious',
      reason: `${counts.Moderate} domains are at Moderate risk. Several Moderate domains may lead to an additive judgement of Serious.`
    };
  }
  const allowed = (['Low', 'Moderate', 'Serious', 'Critical'] as Judgement[]).filter(
    (j) => judgementRank(j) >= judgementRank(suggested)
  );
  return { status: 'complete', suggested, worstDomains, missingDomains, counts, compounding, allowed };
}

/** Display wording for a judgement in a given context. */
export function judgementLabel(j: Judgement, context: DomainId | 'overall'): string {
  if (j === 'Low') {
    if (context === 'overall') return 'Low risk of bias except for concerns about uncontrolled confounding';
    return getDomain(context).lowLabel;
  }
  return j;
}

export interface DecisionCheck {
  ok: boolean;
  problem?: string;
}

/** A domain judgement that differs from the algorithm's suggestion requires a written reason. */
export function checkDomainDecision(suggested: Judgement | undefined, final: Judgement | undefined, reason: string | undefined): DecisionCheck {
  if (!final) return { ok: false, problem: 'No judgement selected.' };
  if (!suggested) return { ok: false, problem: 'The algorithm has not reached a judgement; answer the outstanding questions first.' };
  if (final !== suggested && !(reason && reason.trim().length >= 10)) {
    return { ok: false, problem: 'Overriding the suggested judgement requires a justification (at least 10 characters).' };
  }
  return { ok: true };
}

/** The overall judgement may equal the default or be greater; greater requires a written reason. */
export function checkOverallDecision(evaluation: OverallEvaluation, final: Judgement | undefined, reason: string | undefined): DecisionCheck {
  if (evaluation.status !== 'complete' || !evaluation.suggested) return { ok: false, problem: 'All six domain judgements are needed first.' };
  if (!final) return { ok: false, problem: 'No overall judgement selected.' };
  if (judgementRank(final) < judgementRank(evaluation.suggested)) {
    return { ok: false, problem: `The overall judgement cannot be lower than the worst domain (${evaluation.suggested}).` };
  }
  if (final !== evaluation.suggested && !(reason && reason.trim().length >= 10)) {
    return { ok: false, problem: 'Escalating the overall judgement requires a justification (at least 10 characters).' };
  }
  return { ok: true };
}
