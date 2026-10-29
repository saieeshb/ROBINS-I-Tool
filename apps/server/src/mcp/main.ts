/**
 * Private, read-only stdio MCP server started by Claude Code for one ROBer COP assistant run.
 * It can only read the parsed sources of the documents in the run's scope. It cannot change anything.
 *
 * Environment (set by the runner in the per-run MCP config):
 *   ROBERCOP_DB         path to the SQLite database (opened read-only)
 *   ROBERCOP_DOCUMENTS  JSON array of {documentId, jobId, label, role}
 *   ROBERCOP_SEARCH_LOG file to append search records to (JSON lines)
 */
import { appendFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { checkQuote, type DocumentText } from '@robercop/shared';
import { toFtsQuery } from '../db/fts.js';

interface ScopedDoc {
  documentId: string;
  jobId: string;
  label: string;
  role: string;
}

const db = new DatabaseSync(process.env.ROBERCOP_DB ?? '', { readOnly: true });
const docs = JSON.parse(process.env.ROBERCOP_DOCUMENTS ?? '[]') as ScopedDoc[];
const logPath = process.env.ROBERCOP_SEARCH_LOG ?? '';
const jobIds = docs.map((d) => d.jobId);
const placeholders = jobIds.map(() => '?').join(',');

interface BlockRow {
  id: string;
  document_id: string;
  job_id: string;
  page: number;
  kind: string;
  text: string;
  section: string;
  ocr: number;
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function log(entry: Record<string, unknown>) {
  if (!logPath) return;
  try {
    appendFileSync(logPath, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
  } catch {
    /* logging must never break a tool call */
  }
}

function docLabel(id: string): string {
  return docs.find((d) => d.documentId === id)?.label ?? id;
}

const server = new McpServer({ name: 'robercop', version: '0.1.0' });

/** Every tool only reads the study's parsed sources; none can change anything. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

server.registerTool(
  'list_sources',
  { title: 'List sources', description: 'List the source documents available for this study, with page counts and extraction warnings.', inputSchema: {}, annotations: READ_ONLY },
  async () => {
    if (jobIds.length === 0) return text('No parsed sources are available.');
    const rows = db
      .prepare(`SELECT job_id, MAX(page) AS pages, COUNT(*) AS blocks, SUM(ocr) AS ocr FROM blocks WHERE job_id IN (${placeholders}) GROUP BY job_id`)
      .all(...jobIds) as { job_id: string; pages: number; blocks: number; ocr: number }[];
    return text(
      docs.map((d) => {
        const r = rows.find((x) => x.job_id === d.jobId);
        return { documentId: d.documentId, label: d.label, role: d.role, pages: r?.pages ?? 0, blocks: r?.blocks ?? 0, ocrBlocks: r?.ocr ?? 0 };
      })
    );
  }
);

server.registerTool(
  'search_source',
  {
    title: 'Search sources',
    description: 'Full-text search of the parsed study documents. Use "quoted phrases" for exact phrases. Returns matching passages with document id, page and section.',
    inputSchema: { query: z.string().min(1), documentId: z.string().optional(), limit: z.number().int().min(1).max(30).optional() },
    annotations: READ_ONLY
  },
  async ({ query, documentId, limit }) => {
    const match = toFtsQuery(query);
    const scope = documentId ? docs.filter((d) => d.documentId === documentId).map((d) => d.jobId) : jobIds;
    if (!match || scope.length === 0) {
      log({ query, hits: 0 });
      return text({ query, hits: [] });
    }
    const rows = db
      .prepare(
        `SELECT b.id, b.document_id, b.page, b.section, snippet(blocks_fts, 0, '[[', ']]', ' … ', 32) AS snippet
         FROM blocks_fts JOIN blocks b ON b.rowid = blocks_fts.rowid
         WHERE blocks_fts MATCH ? AND b.job_id IN (${scope.map(() => '?').join(',')})
         ORDER BY bm25(blocks_fts) LIMIT ?`
      )
      .all(match, ...scope, limit ?? 10) as { id: string; document_id: string; page: number; section: string; snippet: string }[];
    log({ query, hits: rows.length });
    return text({
      query,
      hits: rows.map((r) => ({ blockId: r.id, documentId: r.document_id, document: docLabel(r.document_id), page: r.page, section: r.section, snippet: r.snippet }))
    });
  }
);

server.registerTool(
  'get_page',
  {
    title: 'Read a page',
    description: 'Return the full parsed text of one page of a source document, block by block.',
    inputSchema: { documentId: z.string(), page: z.number().int().min(1) },
    annotations: READ_ONLY
  },
  async ({ documentId, page }) => {
    const d = docs.find((x) => x.documentId === documentId);
    if (!d) return text('Unknown document id.');
    const rows = db.prepare('SELECT id, kind, text, section FROM blocks WHERE job_id = ? AND page = ? ORDER BY seq').all(d.jobId, page) as Pick<BlockRow, 'id' | 'kind' | 'text' | 'section'>[];
    if (rows.length === 0) return text(`No text was extracted on page ${page} of ${d.label}.`);
    return text(rows.map((r) => `[${r.kind}${r.section ? ` · ${r.section}` : ''}] (block ${r.id})\n${r.text}`).join('\n\n'));
  }
);

server.registerTool(
  'get_blocks',
  { title: 'Read blocks', description: 'Return the text of specific blocks (from search results), with neighbouring context.', inputSchema: { blockIds: z.array(z.string()).min(1).max(20), context: z.number().int().min(0).max(3).optional() }, annotations: READ_ONLY },
  async ({ blockIds, context }) => {
    const out: string[] = [];
    for (const id of blockIds) {
      const b = db.prepare(`SELECT * FROM blocks WHERE id = ? AND job_id IN (${placeholders})`).get(id, ...jobIds) as (BlockRow & { seq: number }) | undefined;
      if (!b) continue;
      const n = context ?? 1;
      const around = db.prepare('SELECT * FROM blocks WHERE job_id = ? AND seq BETWEEN ? AND ? ORDER BY seq').all(b.job_id, b.seq - n, b.seq + n) as unknown as (BlockRow & { seq: number })[];
      out.push(around.map((x) => `[${docLabel(x.document_id)} p.${x.page}${x.section ? ` · ${x.section}` : ''}]${x.id === id ? ' <<' : ''}\n${x.text}`).join('\n\n'));
    }
    return text(out.join('\n\n---\n\n') || 'No such blocks.');
  }
);

let matchable: DocumentText[] | null = null;
server.registerTool(
  'check_quote',
  {
    title: 'Check a quotation',
    description: 'Check whether a quotation appears verbatim in the parsed sources (exact or after whitespace/hyphenation normalization). Use before returning quotations.',
    inputSchema: { quote: z.string().min(1), page: z.number().int().optional() },
    annotations: READ_ONLY
  },
  async ({ quote, page }) => {
    matchable ??= docs.map((d) => ({
      documentId: d.documentId,
      jobId: d.jobId,
      blocks: (db.prepare('SELECT id, document_id, page, text, ocr FROM blocks WHERE job_id = ? ORDER BY seq').all(d.jobId) as unknown as BlockRow[]).map((b) => ({
        id: b.id,
        documentId: b.document_id,
        page: b.page,
        text: b.text,
        ocr: b.ocr === 1
      })),
      coverageComplete: true,
      emptyPages: []
    }));
    const c = checkQuote(quote, matchable, { claimedPage: page ?? null });
    return text({
      status: c.status,
      method: c.method ?? null,
      locations: c.locations.map((l) => ({ documentId: l.documentId, page: l.page })),
      closest: c.candidates.map((x) => ({ page: x.page, score: x.score, text: x.text })),
      notes: c.notes
    });
  }
);

await server.connect(new StdioServerTransport());
