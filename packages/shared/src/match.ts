import type { MatchCandidate, MatchLocation, SourceCheck } from './model.js';

/**
 * Deterministic quotation checking against parsed source text.
 *
 * Levels, from strictest:
 *   1. exact      – the quotation appears verbatim in the parsed text.
 *   2. normalized – conservative formatting normalization only: Unicode compatibility forms (ligatures), quote and dash
 *                   glyphs, invisible characters, whitespace and line-break hyphenation. Letter case is preserved.
 *   3. elided     – a quotation containing an ellipsis whose segments each match (level 2) in order, close together.
 * Anything weaker (case differences, similarity) is only offered as a candidate that needs manual inspection.
 */

export interface MatchableBlock {
  id: string;
  documentId: string;
  page: number;
  text: string;
  ocr?: boolean;
}

export interface DocumentText {
  documentId: string;
  jobId: string;
  blocks: MatchableBlock[];
  /** False when some pages produced no text, so absence of a match may be an extraction gap. */
  coverageComplete: boolean;
  emptyPages: number[];
}

const QUOTE_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '`': "'", '´': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '﹣': '-', '－': '-',
  '…': '...'
};
const INVISIBLE = /[­​‌‍⁠﻿]/;
const SPACE = /\s/;

export interface Normalized {
  text: string;
  /** map[i] = index in the raw string of normalized character i. */
  map: number[];
}

/**
 * Level-2 normalization with an index map back to the raw string.
 * `dropHyphens` additionally removes hyphens so that "treat-\nment", "treat-ment" and "treatment" compare equal.
 */
export function normalizeWithMap(raw: string, dropHyphens = false): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1;
  const push = (ch: string, at: number) => {
    if (pendingSpace >= 0 && out.length > 0) {
      out.push(' ');
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    out.push(ch);
    map.push(at);
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (INVISIBLE.test(c)) continue;
    if (SPACE.test(c)) {
      if (pendingSpace < 0) pendingSpace = i;
      continue;
    }
    const mapped = QUOTE_MAP[c] ?? c.normalize('NFKC');
    for (const ch of mapped) {
      if (ch === '-') {
        // Hyphen followed by whitespace containing a line break: a line-break hyphenation; join the halves.
        let j = i + 1;
        let sawBreak = false;
        while (j < raw.length && SPACE.test(raw[j])) {
          if (raw[j] === '\n' || raw[j] === '\r') sawBreak = true;
          j++;
        }
        if (sawBreak) {
          if (!dropHyphens) push('-', i);
          i = j - 1;
          pendingSpace = -1;
          continue;
        }
        if (dropHyphens) continue;
      }
      if (SPACE.test(ch)) {
        if (pendingSpace < 0) pendingSpace = i;
        continue;
      }
      push(ch, i);
    }
  }
  return { text: out.join(''), map };
}

export function normalizeText(raw: string, dropHyphens = false): string {
  return normalizeWithMap(raw, dropHyphens).text;
}

/** Strips wrapping quotation marks and surrounding whitespace that models often add around a quotation. */
export function cleanQuote(quote: string): string {
  let q = quote.trim();
  const wrappers: [string, string][] = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’']];
  for (const [open, close] of wrappers) {
    if (q.length > 2 && q.startsWith(open) && q.endsWith(close)) q = q.slice(1, -1).trim();
  }
  return q;
}

interface DocIndex {
  doc: DocumentText;
  raw: string;
  starts: number[];
  n1: Normalized;
  n2: Normalized;
}

function buildIndex(doc: DocumentText): DocIndex {
  const parts: string[] = [];
  const starts: number[] = [];
  let pos = 0;
  for (const b of doc.blocks) {
    starts.push(pos);
    parts.push(b.text);
    pos += b.text.length + 2;
  }
  const raw = parts.join('\n\n');
  return { doc, raw, starts, n1: normalizeWithMap(raw), n2: normalizeWithMap(raw, true) };
}

function blockAt(idx: DocIndex, rawPos: number): number {
  let lo = 0;
  let hi = idx.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (idx.starts[mid] <= rawPos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function locationFor(idx: DocIndex, rawStart: number, rawEnd: number): MatchLocation & { ocr: boolean } {
  const first = blockAt(idx, rawStart);
  const last = blockAt(idx, Math.max(rawStart, rawEnd - 1));
  const blocks = idx.doc.blocks.slice(first, last + 1);
  return {
    documentId: idx.doc.documentId,
    page: blocks[0].page,
    blockIds: blocks.map((b) => b.id),
    text: idx.raw.slice(rawStart, rawEnd),
    ocr: blocks.some((b) => !!b.ocr)
  };
}

function findAll(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return out;
    out.push(at);
    from = at + 1;
  }
}

function rawRange(n: Normalized, start: number, len: number): [number, number] {
  return [n.map[start], n.map[start + len - 1] + 1];
}

const ELLIPSIS = /\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…)\s*/;
const ELIDED_GAP = 1500;

interface Hit {
  method: 'exact' | 'normalized' | 'elided';
  location: MatchLocation & { ocr: boolean };
}

function exactHits(idx: DocIndex, quote: string): Hit[] {
  return findAll(idx.raw, quote).map((at) => ({ method: 'exact', location: locationFor(idx, at, at + quote.length) }));
}

function normalizedHits(idx: DocIndex, quote: string): Hit[] {
  const q1 = normalizeText(quote);
  let hits = findAll(idx.n1.text, q1).map((at) => {
    const [s, e] = rawRange(idx.n1, at, q1.length);
    return { method: 'normalized' as const, location: locationFor(idx, s, e) };
  });
  if (hits.length === 0) {
    const q2 = normalizeText(quote, true);
    hits = findAll(idx.n2.text, q2).map((at) => {
      const [s, e] = rawRange(idx.n2, at, q2.length);
      return { method: 'normalized' as const, location: locationFor(idx, s, e) };
    });
  }
  return hits;
}

function elidedHits(idx: DocIndex, quote: string): Hit[] {
  const segments = quote
    .split(ELLIPSIS)
    .map((s) => normalizeText(s, true))
    .filter((s) => s.length > 0);
  if (segments.length < 2 || segments.some((s) => s.length < 8)) return [];
  const hits: Hit[] = [];
  for (const start of findAll(idx.n2.text, segments[0])) {
    let cursor = start + segments[0].length;
    let ok = true;
    for (const seg of segments.slice(1)) {
      const at = idx.n2.text.indexOf(seg, cursor);
      if (at < 0 || at - cursor > ELIDED_GAP) {
        ok = false;
        break;
      }
      cursor = at + seg.length;
    }
    if (ok) {
      const [s] = rawRange(idx.n2, start, 1);
      const [, e] = rawRange(idx.n2, cursor - 1, 1);
      hits.push({ method: 'elided', location: locationFor(idx, s, e) });
    }
  }
  return hits;
}

/** Lower-cases character by character, keeping indices aligned (characters whose lower case changes length are kept). */
function lowerSameLength(s: string): string {
  let out = '';
  for (const c of s) {
    const l = c.toLowerCase();
    out += l.length === c.length ? l : c;
  }
  return out;
}

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

function lcsRatio(a: string[], b: string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length] / Math.max(a.length, b.length);
}

/** Similarity candidates (never automatic matches). */
function candidates(idx: DocIndex, quote: string, max = 3): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const hay = idx.n2.text;
  // Letter-case-only difference.
  const qLower = lowerSameLength(normalizeText(quote, true));
  for (const at of findAll(lowerSameLength(hay), qLower).slice(0, max)) {
    const [s, e] = rawRange(idx.n2, at, qLower.length);
    const loc = locationFor(idx, s, e);
    out.push({ documentId: loc.documentId, page: loc.page, blockIds: loc.blockIds, text: loc.text, score: 0.99, note: 'Differs only in letter case' });
  }
  if (out.length > 0) return out;

  const qTokens = tokenize(normalizeText(quote, true)).map((t) => t.word);
  const n = qTokens.length;
  if (n < 4) return out;
  const docTokens = tokenize(hay);
  if (docTokens.length < n) return out;
  const need = new Map<string, number>();
  for (const t of qTokens) need.set(t, (need.get(t) ?? 0) + 1);
  const have = new Map<string, number>();
  let overlap = 0;
  const windows: { i: number; score: number }[] = [];
  for (let i = 0; i < docTokens.length; i++) {
    const add = docTokens[i].word;
    const h = have.get(add) ?? 0;
    if (h < (need.get(add) ?? 0)) overlap++;
    have.set(add, h + 1);
    if (i >= n) {
      const rem = docTokens[i - n].word;
      const hr = have.get(rem)! - 1;
      have.set(rem, hr);
      if (hr < (need.get(rem) ?? 0)) overlap--;
    }
    if (i >= n - 1 && overlap / n >= 0.6) windows.push({ i: i - n + 1, score: overlap / n });
  }
  windows.sort((a, b) => b.score - a.score);
  const taken: number[] = [];
  for (const w of windows) {
    if (out.length >= max) break;
    if (taken.some((t) => Math.abs(t - w.i) < n)) continue;
    const words = docTokens.slice(w.i, w.i + n).map((t) => t.word);
    const score = lcsRatio(qTokens, words);
    if (score < 0.75) continue;
    taken.push(w.i);
    const startTok = docTokens[w.i];
    const endTok = docTokens[w.i + n - 1];
    const [s] = rawRange(idx.n2, startTok.start, 1);
    const [, e] = rawRange(idx.n2, endTok.end - 1, 1);
    const loc = locationFor(idx, s, e);
    out.push({
      documentId: loc.documentId,
      page: loc.page,
      blockIds: loc.blockIds,
      text: loc.text,
      score: Math.round(score * 100) / 100,
      note: 'Similar text; inspect manually'
    });
  }
  return out;
}

export interface CheckOptions {
  claimedPage?: number | null;
  claimedDocumentId?: string | null;
  now?: string;
}

function dedupe(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.location.documentId}:${h.location.blockIds.join(',')}:${h.location.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Checks a quotation against the parsed text of the given documents. */
export function checkQuote(quoteInput: string, docs: DocumentText[], opts: CheckOptions = {}): SourceCheck {
  const quote = cleanQuote(quoteInput);
  const checkedAt = opts.now ?? new Date().toISOString();
  const parseJobIds = docs.map((d) => d.jobId);
  const notes: string[] = [];
  if (!quote) return { status: 'unmatched', locations: [], candidates: [], parseJobIds, checkedAt, notes: ['Empty quotation'] };
  if (docs.length === 0) {
    return { status: 'incomplete_extraction', locations: [], candidates: [], parseJobIds, checkedAt, notes: ['No parsed source text is available for this study.'] };
  }
  const indexes = docs.map(buildIndex);
  let hits: Hit[] = [];
  for (const level of [exactHits, normalizedHits, elidedHits]) {
    hits = dedupe(indexes.flatMap((idx) => level(idx, quote)));
    if (hits.length > 0) break;
  }
  if (hits.length > 0) {
    const method = hits[0].method;
    if (method === 'elided') notes.push('Quotation contains an ellipsis; each segment matched in order.');
    if (hits.length > 1) notes.push(`Found at ${hits.length} locations; choose the intended one.`);
    const locations = hits.map(({ location: { ocr: _ocr, ...loc } }) => loc);
    const ocr = hits.some((h) => h.location.ocr);
    if (ocr) notes.push('Matched text was produced by OCR.');
    if (opts.claimedPage != null && hits.length === 1 && hits[0].location.page !== opts.claimedPage) {
      notes.push(`Cited as page ${opts.claimedPage}; found on page ${hits[0].location.page}.`);
    }
    if (opts.claimedDocumentId && hits.length === 1 && hits[0].location.documentId !== opts.claimedDocumentId) {
      notes.push('Found in a different source document than cited.');
    }
    return { status: hits.length === 1 ? 'matched' : 'ambiguous', method, ocr, locations, candidates: [], parseJobIds, checkedAt, notes };
  }
  const cands = indexes.flatMap((idx) => candidates(idx, quote)).sort((a, b) => b.score - a.score).slice(0, 3);
  const incomplete = docs.filter((d) => !d.coverageComplete);
  if (incomplete.length > 0) {
    const pages = incomplete.flatMap((d) => d.emptyPages);
    notes.push(
      `Not found, but extraction is incomplete${pages.length ? ` (no text on page${pages.length > 1 ? 's' : ''} ${pages.join(', ')})` : ''}; check the original PDF.`
    );
    return { status: 'incomplete_extraction', locations: [], candidates: cands, parseJobIds, checkedAt, notes };
  }
  notes.push(cands.length ? 'No exact or normalized match; similar passages need manual inspection.' : 'No matching text found in the parsed sources.');
  return { status: 'unmatched', locations: [], candidates: cands, parseJobIds, checkedAt, notes };
}

/** A check is stale when the sources it was run against have since been re-parsed. */
/** The part of a check that matters to an answer: its status and where the quotation was found. */
export function checkOutcome(check: SourceCheck): string {
  const where = check.locations.map((l) => `${l.documentId}:${l.page}`).sort().join(',');
  return `${check.status}|${where}|${check.manual ? `${check.manual.by}@${check.manual.at}` : ''}`;
}

export function isCheckStale(check: SourceCheck, currentJobIds: string[]): boolean {
  if (check.status === 'not_checked' || check.status === 'manually_verified') return false;
  const a = [...check.parseJobIds].sort().join(',');
  const b = [...currentJobIds].sort().join(',');
  return a !== b;
}

/** True when the check can stand as support for a finalized answer. */
export function isCheckAcceptable(check: SourceCheck): boolean {
  return check.status === 'matched' || check.status === 'manually_verified';
}
