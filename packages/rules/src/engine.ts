import { DOMAINS, getDomain, getQuestion } from './questions.js';
import type {
  Answer,
  AnswerMap,
  DomainEvaluation,
  DomainId,
  Judgement,
  PathStep,
  ReachedQuestion
} from './types.js';
import { RULESET_VERSION } from './version.js';

const YPY: Answer[] = ['Y', 'PY'];
const NPN: Answer[] = ['N', 'PN'];
const NPNNI: Answer[] = ['N', 'PN', 'NI'];
const YPYNI: Answer[] = ['Y', 'PY', 'NI'];

function value(answers: AnswerMap, id: string): Answer | undefined {
  const v = answers[id];
  return v ? (v as Answer) : undefined;
}

function isIn(answers: AnswerMap, id: string, set: Answer[]): boolean {
  const v = value(answers, id);
  return v !== undefined && set.includes(v);
}

/**
 * Official "If ... to ..." conditions, evaluated against answers to questions that are themselves reached.
 * Returns the set of reached question ids for a section, in form order.
 */
type ReachRule = (reached: (id: string) => boolean, a: AnswerMap) => boolean;

const REACH: Record<string, ReachRule> = {
  // Triage
  B1: () => true,
  B2: (_r, a) => isIn(a, 'B1', NPN),
  // B3 is moot once B2 has already ended the assessment at Critical.
  B3: (r, a) => !(r('B2') && isIn(a, 'B2', YPY)),

  // Domain 1 (Variant A)
  'Q1.1': () => true,
  'Q1.2': (_r, a) => isIn(a, 'Q1.1', ['Y', 'PY', 'WN']),
  'Q1.3': (_r, a) => isIn(a, 'Q1.1', ['Y', 'PY', 'WN']),
  'Q1.4': () => true,

  // Domain 2
  'Q2.1': () => true,
  'Q2.2': (_r, a) => isIn(a, 'Q2.1', NPNNI),
  'Q2.3': (r, a) => r('Q2.2') && isIn(a, 'Q2.2', NPNNI),
  'Q2.4': () => true,
  'Q2.5': () => true,

  // Domain 3
  'Q3.1': () => true,
  'Q3.2': (_r, a) => isIn(a, 'Q3.1', YPY),
  'Q3.3': () => true,
  'Q3.4': (_r, a) => isIn(a, 'Q3.3', YPY),
  'Q3.5': (r, a) => r('Q3.4') && isIn(a, 'Q3.4', YPY),
  'Q3.6': (r, a) => isIn(a, 'Q3.1', ['SN']) || (r('Q3.5') && isIn(a, 'Q3.5', YPY)),
  'Q3.7': (r, a) => r('Q3.6') && isIn(a, 'Q3.6', NPNNI),
  'Q3.8': (r, a) => r('Q3.7') && isIn(a, 'Q3.7', NPNNI),

  // Domain 4
  'Q4.1': () => true,
  'Q4.2': () => true,
  'Q4.3': () => true,
  'Q4.4': (_r, a) => ['Q4.1', 'Q4.2', 'Q4.3'].some((id) => isIn(a, id, NPNNI)),
  'Q4.5': (r, a) => r('Q4.4') && isIn(a, 'Q4.4', YPYNI),
  'Q4.6': (r, a) => r('Q4.5') && isIn(a, 'Q4.5', YPYNI),
  'Q4.7': (r, a) => r('Q4.4') && isIn(a, 'Q4.4', NPN),
  'Q4.8': (r, a) => r('Q4.7') && isIn(a, 'Q4.7', YPY),
  'Q4.9': (r, a) => r('Q4.8') && isIn(a, 'Q4.8', YPY),
  'Q4.10': (r, a) => r('Q4.7') && isIn(a, 'Q4.7', NPNNI),
  'Q4.11': (r, a) =>
    (r('Q4.5') && isIn(a, 'Q4.5', YPYNI)) ||
    (r('Q4.9') && isIn(a, 'Q4.9', ['WN', 'SN', 'NI'])) ||
    (r('Q4.10') && isIn(a, 'Q4.10', ['WN', 'SN', 'NI'])),

  // Domain 5
  'Q5.1': () => true,
  'Q5.2': () => true,
  'Q5.3': (_r, a) => isIn(a, 'Q5.2', YPYNI),

  // Domain 6
  'Q6.1': () => true,
  'Q6.2': (_r, a) => isIn(a, 'Q6.1', NPNNI),
  'Q6.3': (_r, a) => isIn(a, 'Q6.1', NPNNI),
  'Q6.4': (_r, a) => isIn(a, 'Q6.1', NPNNI)
};

/** Computes which of the given questions (in form order) are reached under the current answers. */
export function computeReached(questionIds: readonly string[], answers: AnswerMap): ReachedQuestion[] {
  const reachedSet = new Set<string>();
  const r = (id: string) => reachedSet.has(id);
  const out: ReachedQuestion[] = [];
  for (const id of questionIds) {
    const rule = REACH[id];
    if (!rule) throw new Error(`No reach rule for ${id}`);
    const reached = rule(r, answers);
    if (reached) reachedSet.add(id);
    const answered = value(answers, id) !== undefined;
    out.push({ id, reached, answered, excluded: answered && !reached });
  }
  return out;
}

/** Answers restricted to reached questions; unreachable answers are retained by callers but never scored. */
export function reachedAnswers(questionIds: readonly string[], answers: AnswerMap): AnswerMap {
  const out: AnswerMap = {};
  for (const q of computeReached(questionIds, answers)) if (q.reached && q.answered) out[q.id] = answers[q.id];
  return out;
}

class Need extends Error {
  constructor(public questionId: string) {
    super(`needs ${questionId}`);
  }
}

class Invalid extends Error {}

/** Walks an algorithm diagram, recording each branch taken. */
export class Walker {
  readonly path: PathStep[] = [];
  constructor(private readonly answers: AnswerMap) {}

  /** Returns the key of the branch group containing the answer to `questionId`. */
  ask<K extends string>(questionId: string, groups: Record<K, Answer[]>): K {
    const answer = value(this.answers, questionId);
    if (answer === undefined) throw new Need(questionId);
    for (const key of Object.keys(groups) as K[]) {
      if (groups[key].includes(answer)) {
        this.path.push({ questionId, answer, branch: groups[key].join('/') });
        return key;
      }
    }
    const allowed = (Object.values(groups) as Answer[][]).flat().join(', ');
    throw new Invalid(
      `Answer "${answer}" to ${questionId} is not used by the algorithm on this path (expected one of ${allowed}).`
    );
  }

  /** For questions combined as a group (Domain 6), records all answers or throws Need for the first missing one. */
  askAll(questionIds: string[]): Answer[] {
    const out: Answer[] = [];
    for (const id of questionIds) {
      const answer = value(this.answers, id);
      if (answer === undefined) throw new Need(id);
      out.push(answer);
    }
    return out;
  }

  note(questionId: string, answer: string, branch: string): void {
    this.path.push({ questionId, answer, branch });
  }
}

// ---------------------------------------------------------------------------
// Algorithms, transcribed from the November 2025 diagrams (see docs/RULES_AUDIT.md)
// ---------------------------------------------------------------------------

function algoD1(w: Walker): Judgement {
  const q11 = w.ask('Q1.1', { YPY, WN: ['WN'], SNNI: ['SN', 'NI'] });
  if (q11 === 'SNNI') {
    return w.ask('Q1.4', { NPN, YPY }) === 'NPN' ? 'Serious' : 'Critical';
  }
  const q13 = w.ask('Q1.3', { YPY, NPNNI });
  if (q13 === 'YPY') {
    // Both 1.3 boxes route Y/PY to the same 1.4 → 1.2 branch at the bottom of the diagram.
    if (w.ask('Q1.4', { YPY, NPN }) === 'YPY') return 'Critical';
    return w.ask('Q1.2', { YPY, OTHER: ['WN', 'SN', 'NI'] }) === 'YPY' ? 'Serious' : 'Critical';
  }
  if (q11 === 'YPY') {
    const q12 = w.ask('Q1.2', { YPY, WN: ['WN'], SNNI: ['SN', 'NI'] });
    if (q12 === 'SNNI') return 'Serious';
    const q14 = w.ask('Q1.4', { NPN, YPY });
    if (q14 === 'YPY') return 'Serious';
    return q12 === 'YPY' ? 'Low' : 'Moderate';
  }
  // Q1.1 = WN, Q1.3 = N/PN/NI
  const q12 = w.ask('Q1.2', { YPYWN: ['Y', 'PY', 'WN'], SNNI: ['SN', 'NI'] });
  if (q12 === 'SNNI') return 'Serious';
  return w.ask('Q1.4', { NPN, YPY }) === 'NPN' ? 'Moderate' : 'Serious';
}

function algoD2(w: Walker): Judgement {
  // Level of the 2.4 box reached: 0 = top, 1 = middle, 2 = bottom.
  let level: 0 | 1 | 2;
  if (w.ask('Q2.1', { YPY, NPNNI }) === 'YPY') {
    level = 0;
  } else if (w.ask('Q2.2', { YPY, NPNNI }) === 'YPY') {
    level = 0;
  } else {
    const q23 = w.ask('Q2.3', { SY: ['SY'], WYNI: ['WY', 'NI'], NPN });
    level = q23 === 'SY' ? 0 : q23 === 'WYNI' ? 1 : 2;
  }
  // Each 2.4 box routes to a 2.5 box (row 0 = top/Low-Moderate, 1 = Moderate-Serious, 2 = Serious-Critical) or straight to Critical.
  const q24 = w.ask('Q2.4', { NPN, WYNI: ['WY', 'NI'], SY: ['SY'] });
  let row: 0 | 1 | 2 | 'critical';
  if (level === 0) row = q24 === 'NPN' ? 0 : q24 === 'WYNI' ? 1 : 2;
  else if (level === 1) row = q24 === 'NPN' ? 1 : q24 === 'WYNI' ? 2 : 'critical';
  else row = q24 === 'NPN' ? 2 : 'critical';
  if (row === 'critical') return 'Critical';
  const fine = w.ask('Q2.5', { NPN, YPYNI }) === 'NPN';
  const outcomes: Record<0 | 1 | 2, [Judgement, Judgement]> = {
    0: ['Low', 'Moderate'],
    1: ['Moderate', 'Serious'],
    2: ['Serious', 'Critical']
  };
  return outcomes[row][fine ? 0 : 1];
}

function algoD3(w: Walker): Judgement {
  // Part A: prevalent user bias and immortal time.
  let partA: Judgement;
  const q31 = w.ask('Q3.1', { YPY, WNNI: ['WN', 'NI'], SN: ['SN'] });
  if (q31 === 'YPY') partA = w.ask('Q3.2', { NPNNI, YPY }) === 'NPNNI' ? 'Low' : 'Moderate';
  else if (q31 === 'WNNI') partA = 'Moderate';
  else partA = 'Serious';

  // Part B: other selection bias.
  let partB: Judgement;
  const q33 = w.ask('Q3.3', { NPN, YPY, NI: ['NI'] });
  if (q33 === 'NPN') partB = 'Low';
  else if (q33 === 'NI') partB = 'Moderate';
  else {
    const q34 = w.ask('Q3.4', { NPN, YPY, NI: ['NI'] });
    if (q34 === 'NPN') partB = 'Low';
    else if (q34 === 'NI') partB = 'Moderate';
    else partB = w.ask('Q3.5', { NPNNI, YPY }) === 'YPY' ? 'Serious' : 'Moderate';
  }

  // Across A and B.
  if (partA === 'Low' && partB === 'Low') return 'Low';
  if (partA !== 'Serious' && partB !== 'Serious') return 'Moderate';
  // Part C: at least one Serious.
  if (w.ask('Q3.6', { YPY, NPNNI }) === 'YPY') return 'Moderate';
  if (w.ask('Q3.7', { YPY, NPNNI }) === 'YPY') return 'Moderate';
  return w.ask('Q3.8', { YPY, NPNNI }) === 'YPY' ? 'Critical' : 'Serious';
}

/** The three 4.11 boxes: top (after 4.6 = Y/PY), middle (WN/NI routes) and bottom (SN routes). */
function q411(w: Walker, box: 'top' | 'middle' | 'bottom'): Judgement {
  const ok = w.ask('Q4.11', { YPY, NPN }) === 'YPY';
  if (box === 'top') return ok ? 'Low' : 'Moderate';
  if (box === 'middle') return ok ? 'Moderate' : 'Serious';
  return ok ? 'Serious' : 'Critical';
}

function algoD4(w: Walker): Judgement {
  const complete = w.askAll(['Q4.1', 'Q4.2', 'Q4.3']);
  if (complete.every((a) => YPY.includes(a))) {
    w.note('Q4.1–4.3', complete.join('/'), 'All Y/PY');
    return 'Low';
  }
  for (const [i, a] of complete.entries()) {
    if (!YPY.includes(a) && !NPNNI.includes(a)) {
      throw new Invalid(`Answer "${a}" to Q4.${i + 1} is not used by the algorithm (expected Y, PY, PN, N or NI).`);
    }
  }
  w.note('Q4.1–4.3', complete.join('/'), 'Any N/PN/NI');
  if (w.ask('Q4.4', { YPYNI, NPN }) === 'YPYNI') {
    if (w.ask('Q4.5', { NPN, YPYNI }) === 'NPN') return 'Low';
    const q46 = w.ask('Q4.6', { YPY, WNNI: ['WN', 'NI'], SN: ['SN'] });
    return q411(w, q46 === 'YPY' ? 'top' : q46 === 'WNNI' ? 'middle' : 'bottom');
  }
  if (w.ask('Q4.7', { YPY, NPNNI }) === 'YPY') {
    if (w.ask('Q4.8', { YPY, NPNNI }) === 'NPNNI') return 'Serious';
    const q49 = w.ask('Q4.9', { YPY, WNNI: ['WN', 'NI'], SN: ['SN'] });
    if (q49 === 'YPY') return 'Low';
    return q411(w, q49 === 'WNNI' ? 'middle' : 'bottom');
  }
  const q410 = w.ask('Q4.10', { YPY, WNNI: ['WN', 'NI'], SN: ['SN'] });
  if (q410 === 'YPY') return 'Low';
  return q411(w, q410 === 'WNNI' ? 'middle' : 'bottom');
}

function algoD5(w: Walker): Judgement {
  const q51 = w.ask('Q5.1', { YPY, NPN, NI: ['NI'] });
  if (q51 === 'YPY') return 'Serious';
  const aware = w.ask('Q5.2', { NPN, YPYNI }) === 'YPYNI';
  if (q51 === 'NPN') {
    if (!aware) return 'Low';
    const q53 = w.ask('Q5.3', { NPN, WYNI: ['WY', 'NI'], SY: ['SY'] });
    return q53 === 'NPN' ? 'Low' : q53 === 'WYNI' ? 'Moderate' : 'Serious';
  }
  // Q5.1 = NI
  if (!aware) return 'Moderate';
  return w.ask('Q5.3', { OTHER: ['WY', 'N', 'PN', 'NI'], SY: ['SY'] }) === 'SY' ? 'Serious' : 'Moderate';
}

function algoD6(w: Walker): Judgement {
  if (w.ask('Q6.1', { YPY, NPNNI }) === 'YPY') return 'Low';
  const ids = ['Q6.2', 'Q6.3', 'Q6.4'];
  const answers = w.askAll(ids);
  for (const [i, a] of answers.entries()) {
    if (![...YPY, ...NPNNI].includes(a)) {
      throw new Invalid(`Answer "${a}" to ${ids[i]} is not used by the algorithm (expected Y, PY, PN, N or NI).`);
    }
  }
  const ypy = answers.filter((a) => YPY.includes(a)).length;
  const ni = answers.filter((a) => a === 'NI').length;
  let branch: string;
  let judgement: Judgement;
  if (ypy >= 2) {
    branch = 'Two or more Y/PY';
    judgement = 'Critical';
  } else if (ypy === 1 || ni === 3) {
    branch = ypy === 1 ? 'One Y/PY' : 'All NI';
    judgement = 'Serious';
  } else if (ni >= 1) {
    branch = 'At least one NI, but none Y/PY';
    judgement = 'Moderate';
  } else {
    branch = 'All N/PN';
    judgement = 'Low';
  }
  w.note('Q6.2–6.4', answers.join('/'), branch);
  return judgement;
}

const ALGORITHMS: Record<DomainId, (w: Walker) => Judgement> = {
  D1: algoD1,
  D2: algoD2,
  D3: algoD3,
  D4: algoD4,
  D5: algoD5,
  D6: algoD6
};

/**
 * Evaluates a domain. Only answers to reached questions are used; answers to questions that an upstream change
 * made unreachable are reported in `excluded` and never scored.
 */
export function evaluateDomain(domain: DomainId, answers: AnswerMap): DomainEvaluation {
  const def = getDomain(domain);
  const questions = computeReached(def.questionIds, answers);
  const usable: AnswerMap = {};
  for (const q of questions) if (q.reached && q.answered) usable[q.id] = answers[q.id];
  const outstanding = questions.filter((q) => q.reached && !q.answered).map((q) => q.id);
  const excluded = questions.filter((q) => q.excluded).map((q) => q.id);
  const base = { domain, rulesetVersion: RULESET_VERSION, questions, outstanding, excluded };
  const w = new Walker(usable);
  try {
    const suggested = ALGORITHMS[domain](w);
    return { ...base, status: 'complete', suggested, path: w.path };
  } catch (err) {
    if (err instanceof Need) return { ...base, status: 'incomplete', needs: err.questionId, path: w.path };
    if (err instanceof Invalid) return { ...base, status: 'invalid', problem: err.message, path: w.path };
    throw err;
  }
}

/** True when the answer is one of the selectable options for the question. */
export function isAllowedAnswer(questionId: string, answer: string): boolean {
  const q = getQuestion(questionId);
  return !!q && q.options.some((o) => o.code === answer);
}

export function domainOfQuestion(questionId: string): DomainId | undefined {
  return DOMAINS.find((d) => d.questionIds.includes(questionId))?.id;
}

export function describePath(path: PathStep[]): string {
  return path.map((s) => `${s.questionId} = ${s.answer} (${s.branch})`).join(' → ');
}
