import type { FastifyInstance } from 'fastify';
import { evaluateTriage, type AnswerMap } from '@robercop/rules';
import type { Assessment, ResultSpec, Study } from '@robercop/shared';
import { ValidationError } from '../db/database.js';
import { actorOf } from '../app.js';
import type { AppSettings, Services } from '../services/index.js';
import { matchOutcome, normalizeMatrix } from '../services/projects.js';
import { resultName } from '../services/studies.js';

type Params = { id: string };

export interface AssessmentSummary {
  id: string;
  role: Assessment['role'];
  reviewer: string;
  status: Assessment['status'];
  visible: boolean;
  overall: string;
  outstanding: number;
  problems: number;
  studyRevisionId: string;
  updatedAt: string;
}

export function summarizeAssessment(s: Services, a: Assessment, viewer: string): AssessmentSummary {
  const visible = s.assessments.canView(a, viewer);
  let outstanding = 0;
  let problems = 0;
  if (visible) {
    const ev = s.assessments.evaluate(a);
    outstanding = Math.max(0, ev.progress.reached - ev.progress.answered);
    problems = ev.problems.length;
  }
  return {
    id: a.id,
    role: a.role,
    reviewer: a.reviewer,
    status: a.status,
    visible,
    overall: visible ? a.overall.final : '',
    outstanding,
    problems,
    studyRevisionId: a.studyRevisionId,
    updatedAt: a.updatedAt ?? ''
  };
}

/** Review status of one result, as shown on the dashboard. */
export function resultReviewStatus(s: Services, result: ResultSpec, assessments: Assessment[]): string {
  const triage = evaluateTriage(result.triage.answers as AnswerMap);
  if (assessments.some((a) => a.status === 'finalized')) return 'Finalized';
  if (assessments.some((a) => a.role === 'consensus')) return 'Reconciling';
  const peers = assessments.filter((a) => a.role !== 'consensus');
  if (peers.length === 0) return triage.status === 'critical' ? 'Critical at triage — confirm' : 'Not started';
  const project = s.store.projects.require(peers[0].projectId);
  if (project.verificationMode === 'checking') {
    const first = peers[0];
    if (first.status === 'draft') return 'Assessing';
    const st = s.verification.checkingStatus(first);
    if (st.open.length) return 'Changes requested';
    if (st.unverified.length || st.awaitingRecheck.length || st.changedSinceCheck.length) return 'Checking';
    return 'Ready to finalize';
  }
  const submitted = peers.filter((a) => a.status !== 'draft').length;
  if (peers.length < 2) return submitted ? 'Awaiting second reviewer' : 'Assessing';
  return submitted === 2 ? 'Ready to reconcile' : 'Assessing';
}

export async function coreRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    app: 'ROBer COP',
    version: s.config.appVersion,
    dataDir: s.config.dataDir,
    installationId: s.store.installationId()
  }));

  // --- settings -------------------------------------------------------------
  app.get('/settings', async () => ({ ...s.settings(), dataDir: s.config.dataDir, installationId: s.store.installationId() }));
  app.put<{ Body: Partial<AppSettings> }>('/settings', async (req) => {
    const current = s.settings();
    const body = req.body ?? {};
    const next: AppSettings = {
      reviewers: Array.isArray(body.reviewers) ? [...new Set(body.reviewers.map((r) => String(r).trim()).filter(Boolean))] : current.reviewers,
      parser: body.parser && ['auto', 'docling', 'pdfjs'].includes(body.parser) ? body.parser : current.parser,
      ai: { ...current.ai, ...(body.ai ?? {}) }
    };
    s.store.setSetting('app', next);
    return next;
  });

  // --- projects -------------------------------------------------------------
  app.get('/projects', async () => s.projects.list());
  app.post<{ Body: { name: string; description?: string; verificationMode: 'independent' | 'checking'; cfMatrix?: Record<string, string[]> } }>('/projects', async (req) =>
    s.projects.create(req.body, actorOf(req))
  );
  app.get<{ Params: Params }>('/projects/:id', async (req) => s.store.projects.require(req.params.id));
  app.patch<{ Params: Params; Body: { version: number; name?: string; description?: string; verificationMode?: 'independent' | 'checking'; cfMatrix?: unknown } }>(
    '/projects/:id',
    async (req) => {
      const { cfMatrix, ...rest } = req.body;
      return s.projects.update(req.params.id, { ...rest, ...(cfMatrix ? { cfMatrix: normalizeMatrix(cfMatrix) } : {}) }, actorOf(req));
    }
  );
  app.get<{ Params: Params; Querystring: { outcome: string } }>('/projects/:id/match-outcome', async (req) => {
    const p = s.store.projects.require(req.params.id);
    return { matches: matchOutcome(p.cfMatrix, req.query.outcome ?? '').map((k) => ({ key: k, factors: p.cfMatrix[k] })) };
  });

  app.get<{ Params: Params }>('/projects/:id/dashboard', async (req) => {
    const viewer = String(req.headers['x-reviewer'] ? decodeURIComponent(String(req.headers['x-reviewer'])) : '');
    const project = s.store.projects.require(req.params.id);
    const studies = s.store.studies.find({ project_id: project.id }, 'created_at');
    const rows = studies.map((study) => {
      const results = s.studies.results(study.id);
      const docs = s.documents.forStudy(study.id);
      const all = s.store.assessments.find({ study_id: study.id });
      return {
        id: study.id,
        label: study.label,
        citation: study.data.citation,
        status: study.status,
        approvedRevisionId: study.approvedRevisionId,
        documents: docs.length,
        parsed: docs.filter((d) => s.documents.currentJob(d.id)).length,
        parsing: docs.filter((d) => ['queued', 'running'].includes(s.documents.jobs(d.id)[0]?.status ?? '')).length,
        results: results.map((r) => {
          const list = all.filter((a) => a.resultId === r.id);
          return {
            id: r.id,
            name: resultName(r),
            triage: evaluateTriage(r.triage.answers as AnswerMap).status,
            reviewStatus: resultReviewStatus(s, r, list),
            assessments: list.map((a) => summarizeAssessment(s, a, viewer))
          };
        })
      };
    });
    const allResults = rows.flatMap((r) => r.results);
    return {
      project,
      studies: rows,
      totals: {
        studies: rows.length,
        results: allResults.length,
        finalized: allResults.filter((r) => r.reviewStatus === 'Finalized').length,
        inProgress: allResults.filter((r) => !['Finalized', 'Not started'].includes(r.reviewStatus)).length,
        outstandingQuestions: allResults.reduce((n, r) => n + r.assessments.reduce((m, a) => m + a.outstanding, 0), 0)
      }
    };
  });

  // --- studies --------------------------------------------------------------
  app.post<{ Params: Params; Body: { label: string; citation?: string } }>('/projects/:id/studies', async (req) => s.studies.create(req.params.id, req.body, actorOf(req)));

  app.get<{ Params: Params }>('/studies/:id', async (req) => {
    const viewer = req.headers['x-reviewer'] ? decodeURIComponent(String(req.headers['x-reviewer'])) : '';
    const study = s.store.studies.require(req.params.id);
    const results = s.studies.results(study.id);
    return studyPayload(s, study, results, viewer);
  });
  app.patch<{ Params: Params; Body: { version: number; label?: string; data?: Study['data'] } }>('/studies/:id', async (req) => {
    const study = s.studies.update(req.params.id, req.body, actorOf(req));
    return { study, readiness: s.studies.readiness(study, s.studies.results(study.id)) };
  });
  app.delete<{ Params: Params }>('/studies/:id', async (req) => {
    if (s.store.assessments.find({ study_id: req.params.id }).length) throw new ValidationError('This study has assessments and cannot be deleted.');
    s.store.studies.delete(req.params.id, { actor: actorOf(req), reason: 'study removed' });
    return { ok: true };
  });
  app.post<{ Params: Params; Body: { note?: string } }>('/studies/:id/approve', async (req) => {
    const revision = s.studies.approve(req.params.id, actorOf(req), req.body?.note ?? '');
    return { revision: { ...revision, snapshot: undefined }, study: s.store.studies.require(req.params.id) };
  });
  app.get<{ Params: Params }>('/study-revisions/:id', async (req) => s.studies.revision(req.params.id));
  app.get<{ Params: Params & { entity: string } }>('/history/:entity/:id', async (req) => s.store.revisionsFor(req.params.entity, req.params.id));

  // --- results --------------------------------------------------------------
  app.post<{ Params: Params; Body: Partial<ResultSpec> }>('/studies/:id/results', async (req) => s.studies.addResult(req.params.id, req.body ?? {}, actorOf(req)));
  app.patch<{ Params: Params; Body: Partial<ResultSpec> & { version: number } }>('/results/:id', async (req) => s.studies.updateResult(req.params.id, req.body, actorOf(req)));
  app.post<{ Params: Params }>('/results/:id/duplicate', async (req) => s.studies.duplicateResult(req.params.id, actorOf(req)));
  app.delete<{ Params: Params }>('/results/:id', async (req) => {
    s.studies.deleteResult(req.params.id, actorOf(req));
    return { ok: true };
  });

  // --- documents ------------------------------------------------------------
  const upload = async (req: import('fastify').FastifyRequest, projectId: string, studyId: string | null) => {
    const actor = actorOf(req);
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const bytes = await file.toBuffer();
    const field = (name: string) => {
      const f = file.fields[name] as { value?: string } | undefined;
      return f && 'value' in f ? String(f.value) : undefined;
    };
    const doc = s.documents.add(
      { projectId, studyId, role: field('role') ?? (studyId ? 'manuscript' : 'reference'), label: field('label'), filename: file.filename, mime: file.mimetype, bytes },
      actor
    );
    const job = await s.parsing.enqueue(doc.id, s.settings().parser, actor);
    return { document: doc, job };
  };
  app.post<{ Params: Params }>('/studies/:id/documents', async (req) => {
    const study = s.store.studies.require(req.params.id);
    return upload(req, study.projectId, study.id);
  });
  app.post<{ Params: Params }>('/projects/:id/documents', async (req) => upload(req, req.params.id, null));
  app.get<{ Params: Params }>('/projects/:id/documents', async (req) =>
    s.documents.referenceDocuments(req.params.id).map((d) => ({ ...d, job: s.documents.currentJob(d.id), latestJob: s.documents.jobs(d.id)[0] ?? null }))
  );
  app.get<{ Params: Params }>('/documents/:id/file', async (req, reply) => {
    const doc = s.store.documents.require(req.params.id);
    reply.header('Content-Type', 'application/pdf').header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(s.documents.readFile(doc));
  });
  app.get<{ Params: Params }>('/documents/:id/jobs', async (req) => s.documents.jobs(req.params.id));
  app.post<{ Params: Params; Body: { parser?: 'auto' | 'docling' | 'pdfjs'; ocr?: 'auto' | 'on' | 'off' } }>('/documents/:id/reparse', async (req) => {
    s.store.documents.require(req.params.id);
    return s.parsing.enqueue(req.params.id, req.body?.parser ?? s.settings().parser, actorOf(req), req.body?.ocr ? { ocr: req.body.ocr } : {});
  });
  app.post<{ Params: Params }>('/parse-jobs/:id/cancel', async (req) => {
    s.parsing.cancel(req.params.id, actorOf(req));
    return { ok: true };
  });
  app.get<{ Params: Params; Querystring: { page?: string } }>('/documents/:id/blocks', async (req) => {
    const job = s.documents.currentJob(req.params.id);
    if (!job) return { job: null, blocks: [] };
    const blocks = s.store.blocksForJob(job.id);
    const page = req.query.page ? Number(req.query.page) : null;
    return { job, blocks: page ? blocks.filter((b) => b.page === page) : blocks };
  });
  app.get<{ Params: Params }>('/documents/:id/markdown', async (req, reply) => {
    const doc = s.store.documents.require(req.params.id);
    return reply.type('text/markdown; charset=utf-8').send(s.documents.markdown(doc));
  });
  app.patch<{ Params: Params; Body: { version: number; label?: string; role?: string } }>('/documents/:id', async (req) => {
    const doc = s.store.documents.require(req.params.id);
    return s.store.documents.update({ ...doc, label: req.body.label ?? doc.label, role: (req.body.role as typeof doc.role) ?? doc.role, version: req.body.version }, { actor: actorOf(req), reason: 'edited' });
  });
  app.delete<{ Params: Params }>('/documents/:id', async (req) => {
    const doc = s.store.documents.require(req.params.id);
    const used = doc.studyId ? s.store.evidence.find({ study_id: doc.studyId }).some((e) => e.documentId === doc.id) : false;
    if (used) throw new ValidationError('Evidence refers to this document; it cannot be removed.');
    s.store.documents.delete(doc.id, { actor: actorOf(req), reason: 'document removed' });
    return { ok: true };
  });

  // --- search ---------------------------------------------------------------
  app.get<{ Params: Params; Querystring: { q: string; assessmentId?: string; questionId?: string; record?: string } }>('/studies/:id/search', async (req) => {
    const bundle = s.documents.bundle(req.params.id, { includeReferences: true });
    const hits = s.store.searchBlocks(bundle.jobIds, req.query.q ?? '', 25);
    if (req.query.record === '1' && req.query.q?.trim()) {
      s.evidence.recordSearch(
        { studyId: req.params.id, assessmentId: req.query.assessmentId ?? null, questionId: req.query.questionId ?? null, query: req.query.q.trim(), hits: hits.length, actor: actorOf(req), runId: null },
        actorOf(req)
      );
    }
    return { hits, warnings: bundle.warnings };
  });
  app.get<{ Params: Params; Querystring: { assessmentId?: string; questionId?: string } }>('/studies/:id/searches', async (req) =>
    s.store.searches
      .find({ study_id: req.params.id }, 'created_at DESC')
      .filter((x) => (req.query.assessmentId ? x.assessmentId === req.query.assessmentId || x.assessmentId === null : x.assessmentId === null))
      .filter((x) => !req.query.questionId || x.questionId === req.query.questionId)
      .slice(0, 100)
  );

  // --- evidence ---------------------------------------------------------------
  app.get<{ Params: Params; Querystring: { assessmentId?: string } }>('/studies/:id/evidence', async (req) => s.evidence.visible(req.params.id, req.query.assessmentId ?? null));
  app.post<{ Params: Params; Body: Parameters<Services['evidence']['create']>[1] }>('/studies/:id/evidence', async (req) => s.evidence.create(req.params.id, req.body, actorOf(req)));
  app.patch<{ Params: Params; Body: Parameters<Services['evidence']['update']>[1] }>('/evidence/:id', async (req) => s.evidence.update(req.params.id, req.body, actorOf(req)));
  app.post<{ Params: Params }>('/evidence/:id/recheck', async (req) => s.evidence.recheck(req.params.id, actorOf(req)));
  app.post<{ Params: Params; Body: { page: number | null; note: string; locationIndex?: number; candidateIndex?: number } }>('/evidence/:id/manual-check', async (req) =>
    s.evidence.manualCheck(req.params.id, req.body, actorOf(req))
  );
  app.delete<{ Params: Params }>('/evidence/:id', async (req) => {
    s.evidence.delete(req.params.id, actorOf(req));
    return { ok: true };
  });
}

export function studyPayload(s: Services, study: Study, results: ResultSpec[], viewer: string) {
  const project = s.store.projects.require(study.projectId);
  const documents = s.documents.forStudy(study.id).map((d) => ({ ...d, job: s.documents.currentJob(d.id), latestJob: s.documents.jobs(d.id)[0] ?? null }));
  const revisions = s.store.studyRevisions.find({ study_id: study.id }, 'revision_no DESC').map((r) => ({ id: r.id, revisionNo: r.revisionNo, hash: r.hash, approvedBy: r.approvedBy, approvedAt: r.approvedAt, note: r.note }));
  const assessments = s.store.assessments.find({ study_id: study.id }).map((a) => ({ ...summarizeAssessment(s, a, viewer), resultId: a.resultId }));
  return { project, study, results, documents, revisions, assessments, readiness: s.studies.readiness(study, results) };
}
