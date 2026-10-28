import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { DocumentRole, ParseJob, SourceBlock, SourceDocument } from '@robercop/shared';
import type { DocumentText } from '@robercop/shared';
import { ValidationError, newId } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { AppConfig } from '../config.js';

const ROLES: DocumentRole[] = ['manuscript', 'supplement', 'protocol', 'registry', 'other', 'reference'];

export interface BundleDocument {
  document: SourceDocument;
  job: ParseJob | null;
  blocks: SourceBlock[];
}

/** The parsed sources for a study: what the matcher, search and the assistant work from. */
export interface SourceBundle {
  studyId: string;
  documents: BundleDocument[];
  /** Parse jobs whose blocks are current; any check made against other jobs is stale. */
  jobIds: string[];
  matchable: DocumentText[];
  warnings: string[];
}

export class DocumentService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig
  ) {}

  /** Stores an uploaded file content-addressed by SHA-256 and registers it with the study (or project). */
  add(
    input: { projectId: string; studyId: string | null; role: string; label?: string; filename: string; mime: string; bytes: Buffer },
    actor: string
  ): SourceDocument {
    if (!ROLES.includes(input.role as DocumentRole)) throw new ValidationError(`Unknown document role "${input.role}".`);
    if (input.bytes.length === 0) throw new ValidationError('The file is empty.');
    const isPdf = input.bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf) throw new ValidationError('Only PDF files can be attached as sources.');
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const dup = this.store.documents
      .find({ project_id: input.projectId, sha256 })
      .find((d) => d.studyId === input.studyId);
    if (dup) throw new ValidationError(`This file is already attached as "${dup.label}".`);
    const path = this.pathFor(sha256, input.filename);
    if (!existsSync(path)) writeFileSync(path, input.bytes);
    return this.store.documents.insert(
      {
        id: newId(),
        projectId: input.projectId,
        studyId: input.studyId,
        role: input.role as DocumentRole,
        label: input.label?.trim() || input.filename,
        filename: input.filename,
        sha256,
        size: input.bytes.length,
        mime: 'application/pdf',
        createdAt: '',
        version: 0
      },
      { actor, reason: 'attached' }
    );
  }

  pathFor(sha256: string, filename: string): string {
    const ext = extname(filename).toLowerCase() || '.pdf';
    return join(this.config.documentsDir, `${sha256}${ext === '.pdf' ? '.pdf' : ext}`);
  }

  filePath(doc: SourceDocument): string {
    return this.pathFor(doc.sha256, doc.filename);
  }

  readFile(doc: SourceDocument): Buffer {
    return readFileSync(this.filePath(doc));
  }

  forStudy(studyId: string): SourceDocument[] {
    return this.store.documents.find({ study_id: studyId });
  }

  referenceDocuments(projectId: string): SourceDocument[] {
    return this.store.documents.find({ project_id: projectId, study_id: null });
  }

  jobs(documentId: string): ParseJob[] {
    return this.store.parseJobs.find({ document_id: documentId }, 'created_at DESC');
  }

  /** Latest successful parse of a document, if any. */
  currentJob(documentId: string): ParseJob | null {
    return this.jobs(documentId).find((j) => j.status === 'succeeded') ?? null;
  }

  bundle(studyId: string, opts: { includeReferences?: boolean } = {}): SourceBundle {
    const study = this.store.studies.require(studyId);
    const docs = [...this.forStudy(studyId), ...(opts.includeReferences ? this.referenceDocuments(study.projectId) : [])];
    const warnings: string[] = [];
    const documents: BundleDocument[] = docs.map((document) => {
      const job = this.currentJob(document.id);
      const latest = this.jobs(document.id)[0];
      if (!job) warnings.push(`"${document.label}" has not been parsed${latest ? ` (${latest.status})` : ''}.`);
      else if (job.coverage && job.coverage.emptyPages.length > 0) {
        warnings.push(`"${document.label}": no text extracted on page(s) ${job.coverage.emptyPages.join(', ')}.`);
      }
      return { document, job, blocks: job ? this.store.blocksForJob(job.id) : [] };
    });
    const parsed = documents.filter((d) => d.job);
    return {
      studyId,
      documents,
      jobIds: parsed.map((d) => d.job!.id),
      matchable: parsed.map((d) => ({
        documentId: d.document.id,
        jobId: d.job!.id,
        blocks: d.blocks.map((b) => ({ id: b.id, documentId: b.documentId, page: b.page, text: b.text, ocr: b.ocr })),
        coverageComplete: (d.job!.coverage?.emptyPages.length ?? 0) === 0,
        emptyPages: d.job!.coverage?.emptyPages ?? []
      })),
      warnings
    };
  }

  /** Markdown with page markers, used as readable model context. */
  markdown(doc: SourceDocument): string {
    const job = this.currentJob(doc.id);
    if (!job) return '';
    const md = join(this.config.parsedDir, job.id, 'document.md');
    if (existsSync(md)) return readFileSync(md, 'utf8');
    return blocksToMarkdown(this.store.blocksForJob(job.id));
  }
}

export function blocksToMarkdown(blocks: SourceBlock[]): string {
  const out: string[] = [];
  let page = -1;
  for (const b of blocks) {
    if (b.page !== page) {
      page = b.page;
      out.push(`\n<!-- page ${page} -->\n`);
    }
    if (b.kind === 'heading') out.push(`## ${b.text}`);
    else out.push(b.text);
  }
  return out.join('\n\n').trim() + '\n';
}
