import type { FastifyInstance } from 'fastify';
import type { AssessmentRole, VerificationVerdict } from '@robercop/shared';
import { ValidationError } from '../db/database.js';
import { actorOf } from '../app.js';
import type { Services } from '../services/index.js';
import type { AssessmentPatch } from '../services/assessments.js';
import { resultName } from '../services/studies.js';
import { summarizeAssessment } from './core.js';

type Params = { id: string };

function viewerOf(headers: Record<string, unknown>): string {
  return headers['x-reviewer'] ? decodeURIComponent(String(headers['x-reviewer'])) : '';
}

export async function assessmentRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.post<{ Params: Params; Body: { role?: AssessmentRole } }>('/results/:id/assessments', async (req) => s.assessments.create(req.params.id, req.body ?? {}, actorOf(req)));

  app.get<{ Params: Params }>('/assessments/:id', async (req) => {
    const viewer = viewerOf(req.headers);
    const a = s.store.assessments.require(req.params.id);
    if (!s.assessments.canView(a, viewer)) {
      throw new ValidationError('This assessment is hidden until your own independent assessment of the result is submitted.');
    }
    const study = s.store.studies.require(a.studyId);
    const project = s.store.projects.require(a.projectId);
    const revision = s.studies.revision(a.studyRevisionId);
    const result = revision.snapshot.results.find((r) => r.id === a.resultId);
    const evidence = s.evidence.visible(a.studyId, a.id);
    const documents = s.documents.forStudy(a.studyId).concat(s.documents.referenceDocuments(a.projectId)).map((d) => ({ ...d, job: s.documents.currentJob(d.id) }));
    const runs = s.store.aiRuns.find({ assessment_id: a.id }, 'created_at DESC').slice(0, 50);
    const proposals = runs.flatMap((r) => s.proposals.forRun(r.id));
    const parents = a.parentIds.map((id) => s.store.assessments.get(id)).filter(Boolean);
    return {
      assessment: a,
      project,
      study: { id: study.id, label: study.label, citation: study.data.citation, approvedRevisionId: study.approvedRevisionId },
      revision: { id: revision.id, revisionNo: revision.revisionNo, approvedAt: revision.approvedAt, approvedBy: revision.approvedBy, snapshot: revision.snapshot },
      resultName: result ? resultName(result) : 'Result',
      evidence,
      documents,
      runs,
      proposals,
      canEdit: a.status === 'draft' && (a.role === 'consensus' || a.reviewer === viewer),
      verification:
        project.verificationMode === 'checking'
          ? { decisions: s.verification.decisions(a.id), status: a.role === 'first' && a.status !== 'draft' ? s.verification.checkingStatus(a) : null, targets: s.verification.targets(a) }
          : null,
      consensusItems: a.role === 'consensus' ? s.verification.consensusItems(a.id) : [],
      parents: a.role === 'consensus' ? parents : [],
      finalizeProblems: a.status === 'finalized' ? [] : s.verification.finalizeProblems(a, project.verificationMode, viewer)
    };
  });

  app.patch<{ Params: Params; Body: AssessmentPatch }>('/assessments/:id', async (req) => {
    const actor = actorOf(req);
    const a = s.assessments.patch(req.params.id, req.body, actor);
    if (a.role === 'consensus' && (req.body.domains || req.body.overall)) s.verification.syncJudgementItems(a.id, actor);
    return s.store.assessments.require(a.id);
  });
  app.post<{ Params: Params }>('/assessments/:id/submit', async (req) => s.assessments.submit(req.params.id, actorOf(req)));
  app.post<{ Params: Params; Body: { reason: string } }>('/assessments/:id/reopen', async (req) => s.assessments.reopen(req.params.id, req.body?.reason ?? '', actorOf(req)));
  app.post<{ Params: Params }>('/assessments/:id/rebase', async (req) => s.assessments.rebase(req.params.id, actorOf(req)));
  app.get<{ Params: Params }>('/assessments/:id/history', async (req) => {
    const a = s.store.assessments.require(req.params.id);
    if (!s.assessments.canView(a, viewerOf(req.headers))) throw new ValidationError('Hidden during independent review.');
    return {
      revisions: s.store.revisionsFor('assessment', a.id).map((r) => ({ ...r, data: undefined })),
      verifications: s.verification.decisions(a.id)
    };
  });
  app.get<{ Params: Params & { rev: string } }>('/assessments/:id/history/:rev', async (req) => {
    const a = s.store.assessments.require(req.params.id);
    if (!s.assessments.canView(a, viewerOf(req.headers))) throw new ValidationError('Hidden during independent review.');
    const r = s.store.revisionsFor('assessment', a.id).find((x) => x.id === req.params.rev);
    if (!r) throw new ValidationError('No such revision.');
    return r;
  });

  // --- verify ----------------------------------------------------------------
  app.get<{ Params: Params }>('/results/:id/verify', async (req) => {
    const viewer = viewerOf(req.headers);
    const result = s.store.results.require(req.params.id);
    const study = s.store.studies.require(result.studyId);
    const project = s.store.projects.require(study.projectId);
    const list = s.store.assessments.find({ result_id: result.id });
    const peers = list.filter((a) => a.role !== 'consensus');
    const consensus = list.find((a) => a.role === 'consensus') ?? null;
    const canCompare = peers.length === 2 && peers.every((a) => a.status !== 'draft') && peers.every((a) => s.assessments.canView(a, viewer));
    return {
      project,
      study: { id: study.id, label: study.label },
      result: { id: result.id, name: resultName(result) },
      assessments: list.map((a) => summarizeAssessment(s, a, viewer)),
      comparison: project.verificationMode === 'independent' && canCompare ? s.verification.compare(peers.map((a) => a.id)) : null,
      consensus: consensus ? { id: consensus.id, status: consensus.status, items: s.verification.consensusItems(consensus.id) } : null,
      checking:
        project.verificationMode === 'checking' && peers[0] && peers[0].status !== 'draft'
          ? { assessmentId: peers[0].id, reviewer: peers[0].reviewer, status: s.verification.checkingStatus(peers[0]), decisions: s.verification.decisions(peers[0].id) }
          : null
    };
  });
  app.post<{ Params: Params; Body: { target: string; verdict: VerificationVerdict; proposedAnswer?: string; comment?: string } }>('/assessments/:id/verifications', async (req) =>
    s.verification.verify(req.params.id, req.body, actorOf(req))
  );
  app.post<{ Params: Params; Body: { targets: string[] } }>('/assessments/:id/verifications/confirm', async (req) => {
    const actor = actorOf(req);
    const out = [];
    for (const target of req.body?.targets ?? []) out.push(s.verification.verify(req.params.id, { target, verdict: 'confirmed' }, actor));
    return out;
  });
  app.post<{ Params: Params; Body: { resolution: 'accepted' | 'declined'; note?: string } }>('/verifications/:id/resolve', async (req) => s.verification.resolve(req.params.id, req.body, actorOf(req)));
  app.post<{ Params: Params }>('/results/:id/consensus', async (req) => s.verification.createConsensus(req.params.id, actorOf(req)));
  app.post<{ Params: Params; Body: { final: string; note: string } }>('/consensus-items/:id/resolve', async (req) => s.verification.resolveDisagreement(req.params.id, req.body, actorOf(req)));
  app.post<{ Params: Params }>('/assessments/:id/finalize', async (req) => s.verification.finalize(req.params.id, actorOf(req)));
}
