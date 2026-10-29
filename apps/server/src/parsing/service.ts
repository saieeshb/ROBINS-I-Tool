import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParseJob, SourceBlock } from '@robercop/shared';
import { newId, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { AppConfig } from '../config.js';
import type { DocumentService } from '../services/documents.js';
import { parseWithPdfjs, type ParseOutput, type ParsedBlock } from './pdfjs.js';

export type ParserChoice = 'auto' | 'docling' | 'pdfjs';

export interface DoclingStatus {
  available: boolean;
  version: string | null;
  python: string | null;
  error: string | null;
}

const MAX_ATTEMPTS = 3;
const SYSTEM = { actor: 'system', reason: 'parse' };

/**
 * Persistent background parse queue. Jobs survive restarts: anything left running is marked interrupted and requeued
 * (up to MAX_ATTEMPTS). One job runs at a time.
 */
export class ParseService {
  private running = false;
  private closed = false;
  private current: { jobId: string; cancel: () => void } | null = null;
  private doclingCache: DoclingStatus | null = null;
  /** Called after a document gets a new current parse, so dependent quotation checks can be re-run. */
  onParsed: (documentId: string, jobId: string) => void = () => {};

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly documents: DocumentService
  ) {}

  async doclingStatus(refresh = false): Promise<DoclingStatus> {
    if (this.doclingCache && !refresh) return this.doclingCache;
    const python = this.config.pythonPath;
    if (!python) {
      this.doclingCache = { available: false, version: null, python: null, error: 'Docling environment not set up (run the launcher with --setup-docling).' };
      return this.doclingCache;
    }
    const out = await runProcess(python, [this.workerPath(), '--check'], 60_000);
    const line = out.stdout.trim().split('\n').pop() ?? '';
    try {
      const parsed = JSON.parse(line) as { event: string; docling?: string; error?: string };
      this.doclingCache =
        parsed.event === 'ok'
          ? { available: true, version: parsed.docling ?? null, python, error: null }
          : { available: false, version: null, python, error: parsed.error ?? 'Docling is not installed.' };
    } catch {
      this.doclingCache = { available: false, version: null, python, error: out.stderr.trim().slice(-400) || 'Docling check failed.' };
    }
    return this.doclingCache;
  }

  private workerPath(): string {
    return join(this.config.appRoot, 'python', 'docling_worker.py');
  }

  /** Marks jobs that were running when the app stopped as interrupted and queues them again. */
  recover(): number {
    let n = 0;
    for (const job of this.store.parseJobs.find({ status: 'running' })) {
      this.store.parseJobs.mutate(
        job.id,
        (j) => {
          j.status = j.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
          j.error = j.attempts >= MAX_ATTEMPTS ? 'Interrupted too many times.' : null;
          j.warnings = [...j.warnings, `Interrupted at ${now()}; ${j.attempts >= MAX_ATTEMPTS ? 'giving up' : 'requeued'}.`];
        },
        { actor: 'system', reason: 'recovered after restart' }
      );
      n++;
    }
    this.kick();
    return n;
  }

  async enqueue(documentId: string, choice: ParserChoice, actor: string, settings: Record<string, unknown> = {}): Promise<ParseJob> {
    let parser: 'docling' | 'pdfjs' = choice === 'pdfjs' ? 'pdfjs' : 'docling';
    if (choice !== 'pdfjs') {
      const status = await this.doclingStatus();
      if (!status.available) {
        if (choice === 'docling') throw new Error(status.error ?? 'Docling is not available.');
        parser = 'pdfjs';
      }
    }
    // With "auto", a failed Docling run falls back to the built-in parser so the reviewer is never left without text.
    if (choice === 'auto' && parser === 'docling') settings = { ...settings, fallbackToPdfjs: true };
    const job = this.store.parseJobs.insert(
      {
        id: newId(),
        documentId,
        parser,
        parserVersion: '',
        settings: { ocr: 'auto', ...settings },
        status: 'queued',
        progress: 0,
        error: null,
        warnings: [],
        coverage: null,
        attempts: 0,
        createdAt: '',
        startedAt: null,
        finishedAt: null,
        version: 0
      },
      { actor, reason: 'queued' }
    );
    this.kick();
    return job;
  }

  cancel(jobId: string, actor: string): void {
    const job = this.store.parseJobs.require(jobId);
    if (this.current?.jobId === jobId) this.current.cancel();
    if (job.status === 'queued' || job.status === 'running') {
      this.store.parseJobs.mutate(jobId, (j) => void ((j.status = 'cancelled'), (j.finishedAt = now())), { actor, reason: 'cancelled' });
    }
  }

  /** Stops taking jobs and abandons the current one; it stays "running" and is requeued by recover() next start. */
  shutdown(): void {
    this.closed = true;
    this.current?.cancel();
  }

  kick(): void {
    if (this.running || this.closed) return;
    this.running = true;
    setImmediate(() => void this.loop());
  }

  /** Resolves when the queue is idle (used by tests and the import flow). */
  async idle(timeoutMs = 120_000): Promise<void> {
    const start = Date.now();
    while (this.running || this.store.parseJobs.find({ status: 'queued' }).length > 0) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for parsing.');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async loop(): Promise<void> {
    try {
      for (;;) {
        if (this.closed) break;
        const job = this.store.parseJobs.find({ status: 'queued' }, 'created_at')[0];
        if (!job) break;
        await this.runJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(queued: ParseJob): Promise<void> {
    const job = this.store.parseJobs.mutate(
      queued.id,
      (j) => void ((j.status = 'running'), (j.startedAt = now()), (j.attempts += 1), (j.progress = 0)),
      SYSTEM
    );
    const doc = this.store.documents.get(job.documentId);
    if (!doc) {
      this.store.parseJobs.mutate(job.id, (j) => void ((j.status = 'failed'), (j.error = 'Document no longer exists.')), SYSTEM);
      return;
    }
    const outDir = join(this.config.parsedDir, job.id);
    mkdirSync(outDir, { recursive: true });
    let cancelled = false;
    try {
      const progress = (f: number) => {
        // Progress writes are best-effort; avoid flooding revisions.
        if (this.closed) return;
        this.store.db.run("UPDATE parse_jobs SET data = json_set(data, '$.progress', ?) WHERE id = ?", Math.round(f * 100) / 100, job.id);
      };
      let output: ParseOutput;
      if (job.parser === 'docling') {
        const { promise, cancel } = this.runDocling(this.documents.filePath(doc), outDir, String(job.settings.ocr ?? 'auto'), progress);
        this.current = { jobId: job.id, cancel: () => ((cancelled = true), cancel()) };
        output = await promise;
      } else {
        this.current = { jobId: job.id, cancel: () => (cancelled = true) };
        output = await parseWithPdfjs(new Uint8Array(this.documents.readFile(doc)), progress);
        writeFileSync(join(outDir, 'document.md'), output.markdown);
        writeFileSync(join(outDir, 'blocks.json'), JSON.stringify(output.blocks));
      }
      if (this.closed || cancelled || this.store.parseJobs.require(job.id).status === 'cancelled') return;
      const blocks: SourceBlock[] = output.blocks.map((b: ParsedBlock, seq) => ({ id: newId(), documentId: doc.id, jobId: job.id, seq, ...b }));
      this.store.db.tx(() => {
        this.store.insertBlocks(blocks);
        this.store.parseJobs.mutate(
          job.id,
          (j) => {
            j.status = 'succeeded';
            j.progress = 1;
            j.parser = output.parser;
            j.parserVersion = output.parserVersion;
            j.coverage = output.coverage;
            j.warnings = [...j.warnings, ...output.warnings];
            j.finishedAt = now();
          },
          SYSTEM
        );
      });
      this.onParsed(doc.id, job.id);
    } catch (err) {
      if (this.closed) return;
      const message = (err as Error).message;
      this.store.parseJobs.mutate(
        job.id,
        (j) => void ((j.status = cancelled ? 'cancelled' : 'failed'), (j.error = cancelled ? null : message), (j.finishedAt = now())),
        SYSTEM
      );
      if (!cancelled && job.parser === 'docling' && job.settings.fallbackToPdfjs) {
        const fallback = await this.enqueue(doc.id, 'pdfjs', 'system', { fallbackFrom: job.id });
        this.store.parseJobs.mutate(fallback.id, (j) => void j.warnings.push(`Docling failed (${message}); used the built-in parser instead.`), SYSTEM);
      }
    } finally {
      this.current = null;
    }
  }

  private runDocling(
    pdfPath: string,
    outDir: string,
    ocr: string,
    progress: (f: number) => void
  ): { promise: Promise<ParseOutput>; cancel: () => void } {
    const python = this.config.pythonPath!;
    const child = spawn(python, [this.workerPath(), '--input', pdfPath, '--output', outDir, '--ocr', ocr], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lastError = '';
    const promise = new Promise<ParseOutput>((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          try {
            const ev = JSON.parse(line) as { event: string; fraction?: number; message?: string };
            if (ev.event === 'progress' && typeof ev.fraction === 'number') progress(ev.fraction);
            if (ev.event === 'error') lastError = ev.message ?? 'Docling failed';
          } catch {
            /* non-JSON output from libraries */
          }
        }
      });
      child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(lastError || stderr.trim().split('\n').slice(-3).join(' ') || `Docling exited with code ${code}`));
        try {
          resolve(readDoclingOutput(outDir));
        } catch (err) {
          reject(err);
        }
      });
    });
    return { promise, cancel: () => child.kill() };
  }
}

export function readDoclingOutput(outDir: string): ParseOutput {
  const summary = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8')) as {
    parser_version: string;
    coverage: ParseOutput['coverage'];
    warnings: string[];
  };
  const blocks = JSON.parse(readFileSync(join(outDir, 'blocks.json'), 'utf8')) as ParsedBlock[];
  const markdown = existsSync(join(outDir, 'document.md')) ? readFileSync(join(outDir, 'document.md'), 'utf8') : '';
  return {
    parser: 'docling',
    parserVersion: summary.parser_version,
    blocks: blocks.map((b) => ({ ...b, section: b.section ?? '', bbox: b.bbox ?? null, ocr: !!b.ocr })),
    coverage: summary.coverage,
    warnings: summary.warnings ?? [],
    markdown
  };
}

export function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.on('error', (err) => {
      stderr += err.message;
      finish(null);
    });
    child.on('close', finish);
  });
}
