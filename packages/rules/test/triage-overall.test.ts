import { describe, expect, it } from 'vitest';
import {
  checkDomainDecision,
  checkOverallDecision,
  evaluateOverall,
  evaluateTriage,
  getQuestion,
  isAllowedAnswer,
  judgementLabel,
  QUESTIONS,
  RULESET_VERSION,
  describePath,
  evaluateDomain,
  domainOfQuestion,
  DOMAINS
} from '../src/index.js';

describe('triage (Section B)', () => {
  it('asks B2 only after N/PN to B1', () => {
    expect(evaluateTriage({ B1: 'Y' }).questions.find((q) => q.id === 'B2')?.reached).toBe(false);
    expect(evaluateTriage({ B1: 'PN' }).questions.find((q) => q.id === 'B2')?.reached).toBe(true);
  });
  it('passes when no critical trigger and all reached questions answered', () => {
    expect(evaluateTriage({ B1: 'Y', B3: 'N' }).status).toBe('passed');
    expect(evaluateTriage({ B1: 'N', B2: 'PN', B3: 'PN' }).status).toBe('passed');
  });
  it('is incomplete while reached questions are unanswered', () => {
    expect(evaluateTriage({ B1: 'N' }).status).toBe('incomplete');
    expect(evaluateTriage({}).outstanding).toEqual(['B1', 'B3']);
  });
  it('ends at Critical for B2 or B3 = Y/PY', () => {
    expect(evaluateTriage({ B1: 'N', B2: 'Y' }).status).toBe('critical');
    expect(evaluateTriage({ B1: 'N', B2: 'Y' }).outstanding).toEqual([]);
    expect(evaluateTriage({ B1: 'Y', B3: 'PY' }).status).toBe('critical');
    expect(evaluateTriage({ B1: 'Y', B3: 'PY' }).reason).toMatch(/B3/);
  });
  it('excludes B2 once B1 changes to Y', () => {
    const t = evaluateTriage({ B1: 'Y', B2: 'Y', B3: 'N' });
    expect(t.status).toBe('passed');
    expect(t.excluded).toEqual(['B2']);
  });
  it('flags non-triage answers', () => {
    expect(evaluateTriage({ B1: 'NI' }).status).toBe('invalid');
  });
});

describe('overall judgement', () => {
  const all = (j: 'Low' | 'Moderate' | 'Serious' | 'Critical') => ({ D1: j, D2: j, D3: j, D4: j, D5: j, D6: j });
  it('defaults to the worst domain', () => {
    expect(evaluateOverall({ ...all('Low'), D4: 'Serious' }).suggested).toBe('Serious');
    expect(evaluateOverall(all('Low')).suggested).toBe('Low');
    expect(evaluateOverall({ ...all('Low'), D2: 'Critical', D3: 'Serious' }).worstDomains).toEqual(['D2']);
  });
  it('never escalates automatically, but prompts when problems may compound', () => {
    const two = evaluateOverall({ ...all('Low'), D1: 'Serious', D3: 'Serious' });
    expect(two.suggested).toBe('Serious');
    expect(two.compounding?.consider).toBe('Critical');
    const mods = evaluateOverall({ ...all('Low'), D1: 'Moderate', D5: 'Moderate' });
    expect(mods.suggested).toBe('Moderate');
    expect(mods.compounding?.consider).toBe('Serious');
    expect(evaluateOverall({ ...all('Low'), D1: 'Moderate' }).compounding).toBeUndefined();
  });
  it('is incomplete until all six domains have final judgements', () => {
    const ev = evaluateOverall({ D1: 'Low', D2: 'Low' });
    expect(ev.status).toBe('incomplete');
    expect(ev.missingDomains).toEqual(['D3', 'D4', 'D5', 'D6']);
  });
  it('allows only equal or greater overall judgements, with a reason for escalation', () => {
    const ev = evaluateOverall({ ...all('Low'), D1: 'Serious', D3: 'Serious' });
    expect(ev.allowed).toEqual(['Serious', 'Critical']);
    expect(checkOverallDecision(ev, 'Moderate', 'x').ok).toBe(false);
    expect(checkOverallDecision(ev, 'Critical', '').ok).toBe(false);
    expect(checkOverallDecision(ev, 'Critical', 'Selection and confounding problems compound').ok).toBe(true);
    expect(checkOverallDecision(ev, 'Serious', undefined).ok).toBe(true);
    expect(checkOverallDecision(evaluateOverall({}), 'Serious', undefined).ok).toBe(false);
    expect(checkOverallDecision(ev, undefined, undefined).ok).toBe(false);
  });
});

describe('domain decisions', () => {
  it('requires reasons for overrides', () => {
    expect(checkDomainDecision('Low', 'Low', '').ok).toBe(true);
    expect(checkDomainDecision('Low', 'Moderate', 'short').ok).toBe(false);
    expect(checkDomainDecision('Low', 'Moderate', 'Unmeasured frailty likely matters here').ok).toBe(true);
    expect(checkDomainDecision(undefined, 'Low', 'anything at all here').ok).toBe(false);
    expect(checkDomainDecision('Low', undefined, '').ok).toBe(false);
  });
});

describe('question bank', () => {
  it('has unique ids, non-empty text and options without NA (NA is implied for unreached questions)', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUESTIONS) {
      expect(q.text.length).toBeGreaterThan(20);
      expect(q.options.length).toBeGreaterThanOrEqual(4);
      expect(q.options.some((o) => o.code === 'NA')).toBe(false);
    }
    expect(ids.length).toBe(3 + 4 + 5 + 8 + 11 + 3 + 4);
  });
  it('validates answers against options', () => {
    expect(isAllowedAnswer('Q2.3', 'SY')).toBe(true);
    expect(isAllowedAnswer('Q2.3', 'Y')).toBe(false);
    expect(isAllowedAnswer('Q9.9', 'Y')).toBe(false);
    expect(getQuestion('Q1.4')!.options.map((o) => o.code)).toEqual(['Y', 'PY', 'PN', 'N']);
  });
  it('labels Low with the Domain 1 and overall caveats', () => {
    expect(judgementLabel('Low', 'D1')).toMatch(/uncontrolled confounding/);
    expect(judgementLabel('Low', 'overall')).toMatch(/uncontrolled confounding/);
    expect(judgementLabel('Low', 'D2')).toBe('Low');
    expect(judgementLabel('Serious', 'D2')).toBe('Serious');
  });
  it('exposes a versioned ruleset id and helpers', () => {
    expect(RULESET_VERSION).toMatch(/^robins-i-v2@2025-11-20\/itt-variant-a\//);
    expect(describePath(evaluateDomain('D6', { 'Q6.1': 'Y' }).path)).toBe('Q6.1 = Y (Y/PY)');
    expect(domainOfQuestion('Q4.11')).toBe('D4');
    expect(domainOfQuestion('B1')).toBeUndefined();
    expect(DOMAINS.map((d) => d.questionIds.length)).toEqual([4, 5, 8, 11, 3, 4]);
  });
});

describe('helpers', () => {
  it('filters answers to reached questions', async () => {
    const { reachedAnswers, getDomain, computeReached } = await import('../src/index.js');
    expect(reachedAnswers(getDomain('D5').questionIds, { 'Q5.1': 'N', 'Q5.2': 'N', 'Q5.3': 'SY' })).toEqual({ 'Q5.1': 'N', 'Q5.2': 'N' });
    expect(() => getDomain('D9' as never)).toThrow();
    expect(() => computeReached(['Q9.9'], {})).toThrow();
  });
});
