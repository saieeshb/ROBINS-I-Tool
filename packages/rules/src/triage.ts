import { computeReached } from './engine.js';
import { TRIAGE_QUESTION_IDS } from './questions.js';
import type { Answer, AnswerMap, ReachedQuestion } from './types.js';

export type TriageStatus = 'incomplete' | 'passed' | 'critical' | 'invalid';

export interface TriageEvaluation {
  status: TriageStatus;
  /** Why the result was judged Critical at triage. */
  reason?: string;
  questions: ReachedQuestion[];
  outstanding: string[];
  excluded: string[];
  problem?: string;
}

const YPY: Answer[] = ['Y', 'PY'];
const NPN: Answer[] = ['N', 'PN'];

/**
 * Section B. If B2 or B3 is Y/PY the result is at Critical risk of bias and no further assessment is required.
 * B2 is asked only when B1 is N/PN; B3 is moot once B2 has ended the assessment.
 */
export function evaluateTriage(answers: AnswerMap): TriageEvaluation {
  const questions = computeReached(TRIAGE_QUESTION_IDS, answers);
  const reached = (id: string) => questions.find((q) => q.id === id)!.reached;
  const val = (id: string) => (reached(id) && answers[id] ? (answers[id] as Answer) : undefined);
  const outstanding = questions.filter((q) => q.reached && !q.answered).map((q) => q.id);
  const excluded = questions.filter((q) => q.excluded).map((q) => q.id);
  const base = { questions, outstanding, excluded };

  for (const id of TRIAGE_QUESTION_IDS) {
    const v = val(id);
    if (v !== undefined && !YPY.includes(v) && !NPN.includes(v)) {
      return { ...base, status: 'invalid', problem: `Answer "${v}" to ${id} is not a triage option (Y, PY, PN, N).` };
    }
  }
  const b2 = val('B2');
  if (b2 && YPY.includes(b2)) {
    return { ...base, status: 'critical', reason: 'B2: sufficient potential for confounding that the result should not be considered further.' };
  }
  const b3 = val('B3');
  if (b3 && YPY.includes(b3)) {
    return { ...base, status: 'critical', reason: 'B3: the method of measuring the outcome was inappropriate.' };
  }
  if (outstanding.length > 0) return { ...base, status: 'incomplete' };
  return { ...base, status: 'passed' };
}
