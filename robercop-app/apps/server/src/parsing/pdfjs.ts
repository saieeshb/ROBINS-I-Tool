import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import type { ParseCoverage } from '@robercop/shared';

export interface ParsedBlock {
  page: number;
  kind: string;
  text: string;
  section: string;
  bbox: [number, number, number, number] | null;
  ocr: boolean;
}

export interface ParseOutput {
  parser: 'pdfjs' | 'docling';
  parserVersion: string;
  blocks: ParsedBlock[];
  coverage: ParseCoverage;
  warnings: string[];
  markdown: string;
  /** Raw structured output (Docling JSON) when available. */
  structured?: unknown;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  eol: boolean;
}

interface Line {
  text: string;
  x0: number;
  x1: number;
  y: number;
  h: number;
}

const require = createRequire(import.meta.url);
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsPromise ??= import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')) as Promise<typeof import('pdfjs-dist')>;
  return pdfjsPromise;
}

export async function pdfjsVersion(): Promise<string> {
  const pdfjs = await loadPdfjs();
  return `pdfjs-dist ${pdfjs.version}`;
}

/** Groups positioned text items into lines (pdf.js marks most line ends with hasEOL). */
function buildLines(items: Item[]): Line[] {
  const lines: Line[] = [];
  let cur: { parts: Item[]; y: number; h: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const parts = cur.parts.filter((p) => p.str.length > 0);
    if (parts.length) {
      let text = '';
      let lastEnd = -Infinity;
      for (const p of parts) {
        const gap = p.x - lastEnd;
        if (text && !/\s$/.test(text) && !/^\s/.test(p.str) && gap > Math.max(1.5, p.h * 0.15)) text += ' ';
        text += p.str;
        lastEnd = p.x + p.w;
      }
      text = text.replace(/[\u0000-\u0008\u000B-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim();
      if (text) {
        const solid = parts.filter((p) => p.str.trim());
        lines.push({
          text,
          x0: Math.min(...solid.map((p) => p.x)),
          x1: Math.max(...solid.map((p) => p.x + p.w)),
          y: cur.y,
          h: cur.h
        });
      }
    }
    cur = null;
  };
  for (const it of items) {
    if (!cur) {
      cur = { parts: [it], y: it.y, h: it.h };
    } else {
      const superscript = it.h > 0 && it.h < cur.h * 0.8 && it.y >= cur.y - cur.h * 0.2 && it.y <= cur.y + cur.h * 0.7;
      const sameLine = Math.abs(it.y - cur.y) <= Math.max(1, cur.h * 0.35) || superscript || it.h === 0;
      if (!sameLine) {
        flush();
        cur = { parts: [it], y: it.y, h: it.h };
      } else {
        cur.parts.push(it);
        if (!superscript && it.h > cur.h) cur.h = it.h;
      }
    }
    if (it.eol) flush();
  }
  flush();
  return lines;
}

function isCapsHeading(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters.length >= 4 && text.length < 60 && letters === letters.toUpperCase() && !/[.;]$/.test(text);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Text-layer parser used when Docling is unavailable. No OCR and no table structure. */
export async function parseWithPdfjs(bytes: Uint8Array, onProgress?: (fraction: number) => void): Promise<ParseOutput> {
  const pdfjs = await loadPdfjs();
  const fontDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: fontDir, verbosity: 0 })
    .promise;
  const blocks: ParsedBlock[] = [];
  const emptyPages: number[] = [];
  const warnings: string[] = [];
  const pageLines: { page: number; width: number; height: number; lines: Line[] }[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of tc.items) {
        if (!('str' in raw)) continue;
        const t = raw.transform as number[];
        items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width, h: raw.height || Math.abs(t[3]), eol: raw.hasEOL });
      }
      const lines = buildLines(items);
      if (lines.reduce((n, l) => n + l.text.length, 0) < 20) emptyPages.push(p);
      pageLines.push({ page: p, width: vp.width, height: vp.height, lines });
    } catch (err) {
      emptyPages.push(p);
      warnings.push(`Page ${p} could not be read: ${(err as Error).message}`);
    }
    onProgress?.(p / doc.numPages);
  }

  const bodyHeight = median(pageLines.flatMap((pl) => pl.lines.map((l) => l.h)).filter((h) => h > 0)) || 10;
  const raw: (ParsedBlock & { lines: number })[] = [];
  for (const { page, width, height, lines } of pageLines) {
    let block: Line[] = [];
    let left = Infinity;
    const flush = () => {
      if (block.length === 0) return;
      const text = block.map((l) => l.text).join('\n');
      const top = Math.max(...block.map((l) => l.y + l.h));
      const bottom = Math.min(...block.map((l) => l.y));
      const x0 = Math.min(...block.map((l) => l.x0));
      const x1 = Math.max(...block.map((l) => l.x1));
      let kind = 'text';
      if (bottom > height * 0.93) kind = 'page_header';
      else if (top < height * 0.06) kind = 'page_footer';
      else if (/^(table|fig(ure)?\.?)\s*\d+/i.test(text)) kind = 'caption';
      raw.push({ page, kind, text, section: '', bbox: [x0, height - top, x1, height - bottom], ocr: false, lines: block.length });
      block = [];
      left = Infinity;
    };
    for (const l of lines) {
      const prev = block[block.length - 1];
      const capsHeading = isCapsHeading(l.text);
      if (prev) {
        const columnChange = Math.abs(l.x0 - prev.x0) > width * 0.25 || l.y > prev.y + 2;
        const gap = prev.y - l.y > 1.7 * Math.max(l.h, prev.h);
        const sizeChange = Math.abs(l.h - prev.h) > Math.max(1.5, bodyHeight * 0.15);
        const indent = l.x0 > left + 6 && l.x0 < left + 40 && prev.x0 <= left + 2;
        if (columnChange || gap || sizeChange || indent || capsHeading || isCapsHeading(prev.text)) flush();
      }
      block.push(l);
      left = Math.min(left, l.x0);
      if (capsHeading) flush();
    }
    flush();
  }

  // Re-join paragraphs split by a font-size change (drop caps, inline symbols): a block ending mid-sentence followed by
  // one starting in lower case on the same page.
  const merged: (ParsedBlock & { lines: number })[] = [];
  for (const b of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.page === b.page && prev.kind === 'text' && b.kind === 'text' && !/[.:;?!]$/.test(prev.text) && /^\p{Ll}/u.test(b.text)) {
      prev.text = `${prev.text}\n${b.text}`.replace(/^(\p{Lu}) (\p{Ll})/u, '$1$2');
      prev.lines += b.lines;
      prev.bbox = prev.bbox && b.bbox ? [Math.min(prev.bbox[0], b.bbox[0]), Math.min(prev.bbox[1], b.bbox[1]), Math.max(prev.bbox[2], b.bbox[2]), Math.max(prev.bbox[3], b.bbox[3])] : prev.bbox;
      continue;
    }
    merged.push({ ...b });
  }

  // Headings: all-caps titles, or short unpunctuated blocks followed by body text.
  let section = '';
  for (let i = 0; i < merged.length; i++) {
    const b = merged[i];
    const next = merged[i + 1];
    if (b.kind === 'text') {
      const short = b.lines <= 2 && b.text.length < 90 && !/[.,;:]$/.test(b.text) && /^[\p{Lu}\d]/u.test(b.text);
      if (isCapsHeading(b.text) || (short && next && next.kind === 'text' && next.text.length > b.text.length * 2)) b.kind = 'heading';
    }
    if (b.kind === 'heading') section = b.text.replace(/\n/g, ' ');
    else b.section = section;
  }
  for (const { lines: _lines, ...b } of merged) blocks.push(b);

  const pages = doc.numPages;
  if (emptyPages.length) warnings.push(`No text layer on page(s) ${emptyPages.join(', ')}; these may be scanned images. Docling with OCR can recover them.`);
  warnings.push('Parsed with the built-in text-layer parser: no OCR and no table structure.');
  const md: string[] = [];
  let lastPage = 0;
  for (const b of blocks) {
    if (b.kind === 'page_header' || b.kind === 'page_footer') continue;
    if (b.page !== lastPage) {
      md.push(`<!-- page ${b.page} -->`);
      lastPage = b.page;
    }
    md.push(b.kind === 'heading' ? `## ${b.text.replace(/\n/g, ' ')}` : b.text.replace(/-\n(?=\p{Ll})/gu, '').replace(/\n/g, ' '));
  }
  await doc.destroy();
  return {
    parser: 'pdfjs',
    parserVersion: `pdfjs-dist ${pdfjs.version}`,
    blocks,
    coverage: {
      pages,
      pagesWithText: pages - emptyPages.length,
      emptyPages,
      ocrPages: [],
      tables: 0,
      blocks: blocks.length
    },
    warnings,
    markdown: md.join('\n\n') + '\n'
  };
}
