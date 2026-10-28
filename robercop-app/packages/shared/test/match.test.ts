import { describe, expect, it } from 'vitest';
import { checkQuote, cleanQuote, isCheckAcceptable, isCheckStale, normalizeText, type DocumentText } from '../src/index.js';
import { canonicalJson, contentHash } from '../src/node.js';

const doc = (blocks: [number, string, boolean?][], extra: Partial<DocumentText> = {}): DocumentText => ({
  documentId: 'doc1',
  jobId: 'job1',
  blocks: blocks.map(([page, text, ocr], i) => ({ id: `b${i}`, documentId: 'doc1', page, text, ocr })),
  coverageComplete: true,
  emptyPages: [],
  ...extra
});

const paper = doc([
  [1, 'Methods'],
  [2, 'Patients were matched 1:1 using a propensity score that included age, sex, ASA grade and clinical stage.'],
  [3, 'Anastomotic leak was defined according to the ECCG defini-\ntion and conﬁrmed by contrast study or endoscopy.'],
  [4, 'Data were collected prospectively in an institutional database.'],
  [5, 'Data were collected prospectively in an institutional database.']
]);

describe('normalization', () => {
  it('handles ligatures, glyph variants, invisible characters and whitespace', () => {
    expect(normalizeText('conﬁrmed  “leak” – test­')).toBe('confirmed "leak" - test');
    expect(normalizeText('treat-\n  ment')).toBe('treat-ment');
    expect(normalizeText('treat-\nment', true)).toBe('treatment');
    expect(cleanQuote('  “quoted text” ')).toBe('quoted text');
  });
});

describe('checkQuote', () => {
  it('matches exact quotations with block and page', () => {
    const c = checkQuote('matched 1:1 using a propensity score', [paper]);
    expect(c.status).toBe('matched');
    expect(c.method).toBe('exact');
    expect(c.locations[0]).toMatchObject({ page: 2, blockIds: ['b1'] });
  });

  it('matches after conservative normalization (line-break hyphenation, ligatures, curly quotes)', () => {
    const c = checkQuote('"defined according to the ECCG definition and confirmed by contrast study"', [paper]);
    expect(c.status).toBe('matched');
    expect(c.method).toBe('normalized');
    expect(c.locations[0].page).toBe(3);
  });

  it('reports ambiguity when text occurs more than once', () => {
    const c = checkQuote('Data were collected prospectively', [paper]);
    expect(c.status).toBe('ambiguous');
    expect(c.locations.map((l) => l.page)).toEqual([4, 5]);
  });

  it('matches quotations spanning blocks', () => {
    const c = checkQuote('Methods Patients were matched', [paper]);
    expect(c.status).toBe('matched');
    expect(c.locations[0].blockIds).toEqual(['b0', 'b1']);
  });

  it('matches elided quotations segment by segment', () => {
    const c = checkQuote('Patients were matched 1:1 ... ASA grade and clinical stage', [paper]);
    expect(c.status).toBe('matched');
    expect(c.method).toBe('elided');
  });

  it('never auto-matches case-only or similar text; offers candidates instead', () => {
    const caseOnly = checkQuote('PATIENTS WERE MATCHED 1:1 USING A PROPENSITY SCORE', [paper]);
    expect(caseOnly.status).toBe('unmatched');
    expect(caseOnly.candidates[0].note).toMatch(/letter case/);

    const similar = checkQuote('Patients were matched 1:1 using a propensity score including age, sex, ASA grade and stage', [paper]);
    expect(similar.status).toBe('unmatched');
    expect(similar.candidates.length).toBeGreaterThan(0);
    expect(similar.candidates[0].page).toBe(2);
    expect(similar.candidates[0].score).toBeGreaterThanOrEqual(0.75);
  });

  it('distinguishes incomplete extraction from a genuine miss', () => {
    const partial = { ...paper, coverageComplete: false, emptyPages: [6, 7] };
    const c = checkQuote('Table 2 shows hazard ratios', [partial]);
    expect(c.status).toBe('incomplete_extraction');
    expect(c.notes[0]).toMatch(/pages 6, 7/);
    expect(checkQuote('Table 2 shows hazard ratios', [paper]).status).toBe('unmatched');
    expect(checkQuote('anything', []).status).toBe('incomplete_extraction');
    expect(checkQuote('   ', [paper]).status).toBe('unmatched');
  });

  it('flags OCR-derived matches and page corrections', () => {
    const scanned = doc([[7, 'Overall survival did not differ between groups.', true]]);
    const c = checkQuote('Overall survival did not differ', [scanned], { claimedPage: 6, claimedDocumentId: 'other' });
    expect(c.status).toBe('matched');
    expect(c.ocr).toBe(true);
    expect(c.notes.join(' ')).toMatch(/OCR/);
    expect(c.notes.join(' ')).toMatch(/Cited as page 6; found on page 7/);
    expect(c.notes.join(' ')).toMatch(/different source document/);
  });

  it('detects stale checks after re-parsing', () => {
    const c = checkQuote('matched 1:1', [paper]);
    expect(isCheckStale(c, ['job1'])).toBe(false);
    expect(isCheckStale(c, ['job2'])).toBe(true);
    expect(isCheckAcceptable(c)).toBe(true);
    expect(isCheckAcceptable({ ...c, status: 'ambiguous' })).toBe(false);
    expect(isCheckStale({ ...c, status: 'manually_verified' }, ['job2'])).toBe(false);
  });
});

describe('canonical hashing', () => {
  it('is independent of key order and ignores undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});
