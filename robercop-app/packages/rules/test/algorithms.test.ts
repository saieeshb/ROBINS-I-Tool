import { describe, expect, it } from 'vitest';
import {
  computeReached,
  DOMAINS,
  evaluateDomain,
  getDomain,
  getQuestion,
  type Answer,
  type AnswerMap,
  type DomainId,
  type Judgement
} from '../src/index.js';

/** Expands a case like { 'Q1.1': 'Y/PY', 'Q1.4': 'N/PN' } into every concrete combination. */
function expand(spec: Record<string, string>): AnswerMap[] {
  let out: AnswerMap[] = [{}];
  for (const [id, alts] of Object.entries(spec)) {
    const next: AnswerMap[] = [];
    for (const partial of out) for (const a of alts.split('/')) next.push({ ...partial, [id]: a as Answer });
    out = next;
  }
  return out;
}

type Case = [Record<string, string>, Judgement];

function check(domain: DomainId, cases: Case[]) {
  for (const [spec, expected] of cases) {
    for (const answers of expand(spec)) {
      const ev = evaluateDomain(domain, answers);
      expect(ev.status, `${domain} ${JSON.stringify(answers)} → ${ev.problem ?? ev.needs ?? ''}`).toBe('complete');
      expect(ev.suggested, `${domain} ${JSON.stringify(answers)}`).toBe(expected);
    }
  }
}

describe('Domain 1 (Variant A) follows the official diagram', () => {
  it('reaches every terminal edge', () => {
    check('D1', [
      [{ 'Q1.1': 'SN/NI', 'Q1.4': 'N/PN' }, 'Serious'],
      [{ 'Q1.1': 'SN/NI', 'Q1.4': 'Y/PY' }, 'Critical'],
      [{ 'Q1.1': 'Y/PY/WN', 'Q1.3': 'Y/PY', 'Q1.4': 'Y/PY', 'Q1.2': 'Y/PY/WN/SN/NI' }, 'Critical'],
      [{ 'Q1.1': 'Y/PY/WN', 'Q1.3': 'Y/PY', 'Q1.4': 'N/PN', 'Q1.2': 'Y/PY' }, 'Serious'],
      [{ 'Q1.1': 'Y/PY/WN', 'Q1.3': 'Y/PY', 'Q1.4': 'N/PN', 'Q1.2': 'WN/SN/NI' }, 'Critical'],
      [{ 'Q1.1': 'Y/PY', 'Q1.3': 'N/PN/NI', 'Q1.2': 'Y/PY', 'Q1.4': 'N/PN' }, 'Low'],
      [{ 'Q1.1': 'Y/PY', 'Q1.3': 'N/PN/NI', 'Q1.2': 'Y/PY', 'Q1.4': 'Y/PY' }, 'Serious'],
      [{ 'Q1.1': 'Y/PY', 'Q1.3': 'N/PN/NI', 'Q1.2': 'WN', 'Q1.4': 'N/PN' }, 'Moderate'],
      [{ 'Q1.1': 'Y/PY', 'Q1.3': 'N/PN/NI', 'Q1.2': 'WN', 'Q1.4': 'Y/PY' }, 'Serious'],
      [{ 'Q1.1': 'Y/PY', 'Q1.3': 'N/PN/NI', 'Q1.2': 'SN/NI', 'Q1.4': 'Y/PY/PN/N' }, 'Serious'],
      [{ 'Q1.1': 'WN', 'Q1.3': 'N/PN/NI', 'Q1.2': 'Y/PY/WN', 'Q1.4': 'N/PN' }, 'Moderate'],
      [{ 'Q1.1': 'WN', 'Q1.3': 'N/PN/NI', 'Q1.2': 'Y/PY/WN', 'Q1.4': 'Y/PY' }, 'Serious'],
      [{ 'Q1.1': 'WN', 'Q1.3': 'N/PN/NI', 'Q1.2': 'SN/NI', 'Q1.4': 'Y/PY/PN/N' }, 'Serious']
    ]);
  });

  it('fixes the legacy gap: Q1.1 Y/PY with over-adjustment and no negative-control signal goes on to Q1.2', () => {
    const ev = evaluateDomain('D1', { 'Q1.1': 'Y', 'Q1.3': 'Y', 'Q1.4': 'N' });
    expect(ev.status).toBe('incomplete');
    expect(ev.needs).toBe('Q1.2');
  });
});

describe('Domain 2 follows the official diagram', () => {
  // The three entry routes into the top 2.4 box.
  const top = [{ 'Q2.1': 'Y/PY' }, { 'Q2.1': 'N/PN/NI', 'Q2.2': 'Y/PY' }, { 'Q2.1': 'N/PN/NI', 'Q2.2': 'N/PN/NI', 'Q2.3': 'SY' }];
  const middle = { 'Q2.1': 'N/PN/NI', 'Q2.2': 'N/PN/NI', 'Q2.3': 'WY/NI' };
  const bottom = { 'Q2.1': 'N/PN/NI', 'Q2.2': 'N/PN/NI', 'Q2.3': 'PN/N' };
  it('top 2.4 box', () => {
    for (const entry of top) {
      check('D2', [
        [{ ...entry, 'Q2.4': 'N/PN', 'Q2.5': 'N/PN' }, 'Low'],
        [{ ...entry, 'Q2.4': 'N/PN', 'Q2.5': 'Y/PY/NI' }, 'Moderate'],
        [{ ...entry, 'Q2.4': 'WY/NI', 'Q2.5': 'N/PN' }, 'Moderate'],
        [{ ...entry, 'Q2.4': 'WY/NI', 'Q2.5': 'Y/PY/NI' }, 'Serious'],
        [{ ...entry, 'Q2.4': 'SY', 'Q2.5': 'N/PN' }, 'Serious'],
        [{ ...entry, 'Q2.4': 'SY', 'Q2.5': 'Y/PY/NI' }, 'Critical']
      ]);
    }
  });
  it('middle 2.4 box (2.3 = WY/NI)', () => {
    check('D2', [
      [{ ...middle, 'Q2.4': 'N/PN', 'Q2.5': 'N/PN' }, 'Moderate'],
      [{ ...middle, 'Q2.4': 'N/PN', 'Q2.5': 'Y/PY/NI' }, 'Serious'],
      [{ ...middle, 'Q2.4': 'WY/NI', 'Q2.5': 'N/PN' }, 'Serious'],
      [{ ...middle, 'Q2.4': 'WY/NI', 'Q2.5': 'Y/PY/NI' }, 'Critical'],
      [{ ...middle, 'Q2.4': 'SY', 'Q2.5': 'Y/PY/PN/N/NI' }, 'Critical']
    ]);
  });
  it('bottom 2.4 box (2.3 = N/PN)', () => {
    check('D2', [
      [{ ...bottom, 'Q2.4': 'N/PN', 'Q2.5': 'N/PN' }, 'Serious'],
      [{ ...bottom, 'Q2.4': 'N/PN', 'Q2.5': 'Y/PY/NI' }, 'Critical'],
      [{ ...bottom, 'Q2.4': 'SY/WY/NI', 'Q2.5': 'Y/PY/PN/N/NI' }, 'Critical']
    ]);
  });
});

describe('Domain 3 follows the official diagram', () => {
  const lowB = { 'Q3.3': 'N/PN' };
  it('part A', () => {
    check('D3', [
      [{ 'Q3.1': 'Y/PY', 'Q3.2': 'N/PN/NI', ...lowB }, 'Low'],
      [{ 'Q3.1': 'Y/PY', 'Q3.2': 'Y/PY', ...lowB }, 'Moderate'],
      [{ 'Q3.1': 'WN/NI', ...lowB }, 'Moderate']
    ]);
  });
  it('part B', () => {
    const lowA = { 'Q3.1': 'Y/PY', 'Q3.2': 'N/PN/NI' };
    check('D3', [
      [{ ...lowA, 'Q3.3': 'N/PN' }, 'Low'],
      [{ ...lowA, 'Q3.3': 'NI' }, 'Moderate'],
      [{ ...lowA, 'Q3.3': 'Y/PY', 'Q3.4': 'N/PN' }, 'Low'],
      [{ ...lowA, 'Q3.3': 'Y/PY', 'Q3.4': 'NI' }, 'Moderate'],
      // Diagram: 3.5 N/PN/NI → MODERATE (the legacy session prompt gave Low for N/PN).
      [{ ...lowA, 'Q3.3': 'Y/PY', 'Q3.4': 'Y/PY', 'Q3.5': 'N/PN/NI' }, 'Moderate']
    ]);
  });
  it('part C after at least one Serious part', () => {
    const seriousRoutes = [
      { 'Q3.1': 'SN', 'Q3.3': 'N/PN' },
      { 'Q3.1': 'Y/PY', 'Q3.2': 'N/PN/NI', 'Q3.3': 'Y/PY', 'Q3.4': 'Y/PY', 'Q3.5': 'Y/PY' },
      { 'Q3.1': 'SN', 'Q3.3': 'Y/PY', 'Q3.4': 'Y/PY', 'Q3.5': 'Y/PY' }
    ];
    for (const route of seriousRoutes) {
      check('D3', [
        [{ ...route, 'Q3.6': 'Y/PY' }, 'Moderate'],
        [{ ...route, 'Q3.6': 'N/PN/NI', 'Q3.7': 'Y/PY' }, 'Moderate'],
        [{ ...route, 'Q3.6': 'N/PN/NI', 'Q3.7': 'N/PN/NI', 'Q3.8': 'Y/PY' }, 'Critical'],
        [{ ...route, 'Q3.6': 'N/PN/NI', 'Q3.7': 'N/PN/NI', 'Q3.8': 'N/PN/NI' }, 'Serious']
      ]);
    }
  });
  it('combines parts: Moderate in one part and Low in the other is Moderate', () => {
    check('D3', [[{ 'Q3.1': 'WN', 'Q3.3': 'NI' }, 'Moderate']]);
  });
});

describe('Domain 4 follows the official diagram', () => {
  const incomplete = [
    { 'Q4.1': 'N/PN/NI', 'Q4.2': 'Y', 'Q4.3': 'Y' },
    { 'Q4.1': 'Y', 'Q4.2': 'N/PN/NI', 'Q4.3': 'PY' },
    { 'Q4.1': 'PY', 'Q4.2': 'Y', 'Q4.3': 'N/PN/NI' }
  ];
  it('complete data', () => {
    check('D4', [[{ 'Q4.1': 'Y/PY', 'Q4.2': 'Y/PY', 'Q4.3': 'Y/PY' }, 'Low']]);
  });
  it('complete case path', () => {
    for (const start of incomplete) {
      const cc = { ...start, 'Q4.4': 'Y/PY/NI' };
      check('D4', [
        [{ ...cc, 'Q4.5': 'N/PN' }, 'Low'],
        [{ ...cc, 'Q4.5': 'Y/PY/NI', 'Q4.6': 'Y/PY', 'Q4.11': 'Y/PY' }, 'Low'],
        [{ ...cc, 'Q4.5': 'Y/PY/NI', 'Q4.6': 'Y/PY', 'Q4.11': 'N/PN' }, 'Moderate'],
        [{ ...cc, 'Q4.5': 'Y/PY/NI', 'Q4.6': 'WN/NI', 'Q4.11': 'Y/PY' }, 'Moderate'],
        [{ ...cc, 'Q4.5': 'Y/PY/NI', 'Q4.6': 'WN/NI', 'Q4.11': 'N/PN' }, 'Serious'],
        [{ ...cc, 'Q4.5': 'Y/PY/NI', 'Q4.6': 'SN', 'Q4.11': 'Y/PY' }, 'Serious'],
        [{ ...cc, 'Q4.5': 'Y/PY/NI', 'Q4.6': 'SN', 'Q4.11': 'N/PN' }, 'Critical']
      ]);
    }
  });
  it('imputation path', () => {
    const imp = { 'Q4.1': 'N', 'Q4.2': 'Y', 'Q4.3': 'Y', 'Q4.4': 'N/PN', 'Q4.7': 'Y/PY' };
    check('D4', [
      [{ ...imp, 'Q4.8': 'N/PN/NI' }, 'Serious'],
      [{ ...imp, 'Q4.8': 'Y/PY', 'Q4.9': 'Y/PY' }, 'Low'],
      [{ ...imp, 'Q4.8': 'Y/PY', 'Q4.9': 'WN/NI', 'Q4.11': 'Y/PY' }, 'Moderate'],
      [{ ...imp, 'Q4.8': 'Y/PY', 'Q4.9': 'WN/NI', 'Q4.11': 'N/PN' }, 'Serious'],
      [{ ...imp, 'Q4.8': 'Y/PY', 'Q4.9': 'SN', 'Q4.11': 'Y/PY' }, 'Serious'],
      [{ ...imp, 'Q4.8': 'Y/PY', 'Q4.9': 'SN', 'Q4.11': 'N/PN' }, 'Critical']
    ]);
  });
  it('alternative method path', () => {
    const alt = { 'Q4.1': 'Y', 'Q4.2': 'PN', 'Q4.3': 'Y', 'Q4.4': 'N/PN', 'Q4.7': 'N/PN/NI' };
    check('D4', [
      [{ ...alt, 'Q4.10': 'Y/PY' }, 'Low'],
      [{ ...alt, 'Q4.10': 'WN/NI', 'Q4.11': 'Y/PY' }, 'Moderate'],
      [{ ...alt, 'Q4.10': 'WN/NI', 'Q4.11': 'N/PN' }, 'Serious'],
      [{ ...alt, 'Q4.10': 'SN', 'Q4.11': 'Y/PY' }, 'Serious'],
      [{ ...alt, 'Q4.10': 'SN', 'Q4.11': 'N/PN' }, 'Critical']
    ]);
  });
  it('fixes the legacy dead end: Q4.11 is reached (and required) after Q4.6 = Y/PY', () => {
    const answers: AnswerMap = { 'Q4.1': 'N', 'Q4.2': 'Y', 'Q4.3': 'Y', 'Q4.4': 'Y', 'Q4.5': 'Y', 'Q4.6': 'Y' };
    const ev = evaluateDomain('D4', answers);
    expect(ev.status).toBe('incomplete');
    expect(ev.needs).toBe('Q4.11');
    expect(ev.questions.find((q) => q.id === 'Q4.11')?.reached).toBe(true);
  });
});

describe('Domain 5 follows the official diagram', () => {
  it('reaches every terminal edge', () => {
    check('D5', [
      [{ 'Q5.1': 'Y/PY', 'Q5.2': 'Y/PY/PN/N/NI' }, 'Serious'],
      [{ 'Q5.1': 'N/PN', 'Q5.2': 'N/PN' }, 'Low'],
      [{ 'Q5.1': 'N/PN', 'Q5.2': 'Y/PY/NI', 'Q5.3': 'N/PN' }, 'Low'],
      [{ 'Q5.1': 'N/PN', 'Q5.2': 'Y/PY/NI', 'Q5.3': 'WY/NI' }, 'Moderate'],
      // Diagram: SY on the upper path → SERIOUS (the legacy tool returned Moderate).
      [{ 'Q5.1': 'N/PN', 'Q5.2': 'Y/PY/NI', 'Q5.3': 'SY' }, 'Serious'],
      // Diagram: 5.1 = NI with unaware assessors → MODERATE (the legacy tool returned Low).
      [{ 'Q5.1': 'NI', 'Q5.2': 'N/PN' }, 'Moderate'],
      [{ 'Q5.1': 'NI', 'Q5.2': 'Y/PY/NI', 'Q5.3': 'WY/N/PN/NI' }, 'Moderate'],
      [{ 'Q5.1': 'NI', 'Q5.2': 'Y/PY/NI', 'Q5.3': 'SY' }, 'Serious']
    ]);
  });
});

describe('Domain 6 follows the official diagram', () => {
  const rest = (a: string, b: string, c: string) => ({ 'Q6.1': 'N/PN/NI', 'Q6.2': a, 'Q6.3': b, 'Q6.4': c });
  it('reaches every terminal edge', () => {
    check('D6', [
      [{ 'Q6.1': 'Y/PY' }, 'Low'],
      [rest('N/PN', 'N/PN', 'N/PN'), 'Low'],
      [rest('NI', 'N/PN', 'N/PN'), 'Moderate'],
      [rest('NI', 'NI', 'N/PN'), 'Moderate'],
      [rest('NI', 'NI', 'NI'), 'Serious'],
      [rest('Y/PY', 'N/PN/NI', 'N/PN/NI'), 'Serious'],
      [rest('N/PN', 'Y/PY', 'NI'), 'Serious'],
      [rest('Y/PY', 'Y/PY', 'N/PN/NI'), 'Critical'],
      [rest('Y/PY', 'Y/PY', 'Y/PY'), 'Critical']
    ]);
  });
});

/**
 * Walks every reachable answer combination: at each step, take the first reached-but-unanswered question and branch on
 * each of its selectable options. Every leaf must produce a complete evaluation with a judgement.
 */
function enumerate(domain: DomainId): AnswerMap[] {
  const ids = getDomain(domain).questionIds;
  const leaves: AnswerMap[] = [];
  const walk = (answers: AnswerMap) => {
    const next = computeReached(ids, answers).find((q) => q.reached && !q.answered);
    if (!next) {
      leaves.push(answers);
      return;
    }
    for (const o of getQuestion(next.id)!.options) walk({ ...answers, [next.id]: o.code });
  };
  walk({});
  return leaves;
}

describe('exhaustive reachable-path enumeration', () => {
  for (const d of DOMAINS) {
    it(`${d.id}: every fully answered reachable combination yields a judgement`, () => {
      const leaves = enumerate(d.id);
      expect(leaves.length).toBeGreaterThan(10);
      const seen = new Set<Judgement>();
      for (const answers of leaves) {
        const ev = evaluateDomain(d.id, answers);
        expect(ev.status, JSON.stringify(answers) + (ev.problem ?? '')).toBe('complete');
        expect(ev.outstanding).toEqual([]);
        expect(ev.excluded).toEqual([]);
        seen.add(ev.suggested!);
      }
      // Every domain can produce each judgement except Domain 5, whose diagram has no Critical outcome.
      const expected: Judgement[] = d.id === 'D5' ? ['Low', 'Moderate', 'Serious'] : ['Low', 'Moderate', 'Serious', 'Critical'];
      expect([...seen].sort()).toEqual([...expected].sort());
    });

    it(`${d.id}: answers to unreached questions never change the result`, () => {
      const ids = d.questionIds;
      const leaves = enumerate(d.id);
      // Domain 4 has tens of thousands of leaves; a deterministic stride keeps the run fast while covering every path family.
      const stride = Math.max(1, Math.floor(leaves.length / 1500));
      for (const answers of leaves.filter((_, i) => i % stride === 0)) {
        const base = evaluateDomain(d.id, answers);
        const unreached = computeReached(ids, answers).filter((q) => !q.reached);
        for (const q of unreached) {
          for (const o of getQuestion(q.id)!.options) {
            const ev = evaluateDomain(d.id, { ...answers, [q.id]: o.code });
            expect(ev.suggested).toBe(base.suggested);
            expect(ev.excluded).toContain(q.id);
          }
        }
      }
    });
  }
});

describe('evaluation states', () => {
  it('reports the next needed question when incomplete', () => {
    expect(evaluateDomain('D2', {}).needs).toBe('Q2.1');
    expect(evaluateDomain('D2', { 'Q2.1': 'N' }).needs).toBe('Q2.2');
  });

  it('reports invalid answers that the algorithm cannot use instead of guessing', () => {
    const ev = evaluateDomain('D1', { 'Q1.1': 'Y', 'Q1.3': 'N', 'Q1.2': 'NA', 'Q1.4': 'N' });
    expect(ev.status).toBe('invalid');
    expect(ev.problem).toMatch(/Q1\.2/);
    expect(evaluateDomain('D4', { 'Q4.1': 'NA', 'Q4.2': 'Y', 'Q4.3': 'Y' }).status).toBe('invalid');
    expect(evaluateDomain('D6', { 'Q6.1': 'N', 'Q6.2': 'NA', 'Q6.3': 'N', 'Q6.4': 'N' }).status).toBe('invalid');
  });

  it('recalculates the reached path when an upstream answer changes', () => {
    const answers: AnswerMap = { 'Q2.1': 'N', 'Q2.2': 'N', 'Q2.3': 'WY', 'Q2.4': 'N', 'Q2.5': 'N' };
    expect(evaluateDomain('D2', answers).suggested).toBe('Moderate');
    const changed = { ...answers, 'Q2.1': 'Y' as Answer };
    const ev = evaluateDomain('D2', changed);
    expect(ev.suggested).toBe('Low');
    expect(ev.excluded).toEqual(['Q2.2', 'Q2.3']);
  });

  it('records the algorithm path with diagram branch labels', () => {
    const ev = evaluateDomain('D5', { 'Q5.1': 'PN', 'Q5.2': 'Y', 'Q5.3': 'WY' });
    expect(ev.path.map((s) => `${s.questionId}:${s.branch}`)).toEqual(['Q5.1:N/PN', 'Q5.2:Y/PY/NI', 'Q5.3:WY/NI']);
  });
});
