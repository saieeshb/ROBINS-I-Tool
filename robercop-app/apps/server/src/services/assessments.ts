import { DOMAIN_IDS, isAllowedAnswer, RULESET_VERSION, type DomainId, type Judgement } from '@robercop/rules';
import {
  emptyDecision,
  emptyResponse,
  evaluateAssessment,
  domainForQuestion,
  isLegacyRevision,
  perProtocolReason,
  type Assessment,
  type AssessmentEvaluation,
  type AssessmentRole,
  type DomainDecision,
  type EvidenceItem,
  type QuestionResponse,
  type StudyRevision
} from '@robercop/shared';
import { canonicalJson } from '@robercop/shared/node';
import { ValidationError, newId, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { EvidenceService } from './evidence.js';
import type { StudyService } from './studies.js';

export interface AssessmentPatch {
  version: number;
  responses?: Record<string, Partial<Pick<QuestionResponse, 'answer' | 'rationale' | 'evidenceIds'>> & { confirm?: boolean }>;
  domains?: Partial<Record<DomainId, { final: Judgement | ''; reason?: string }>>;
  overall?: { final: Judgement | ''; reason?: string };
}

const JUDGEMENTS: (Judgement | '')[] = ['', 'Low', 'Moderate', 'Serious', 'Critical'];

export class AssessmentService {
  constructor(
    private readonly store: Store,
    private readonly studies: StudyService,
    private readonly evidence: EvidenceService
  ) {}

  revisionFor(a: Assessment): StudyRevision {
    return this.studies.revision(a.studyRevisionId);
  }

  evidenceMap(a: Assessment): Map<string, EvidenceItem> {
    return new Map(this.evidence.visible(a.studyId, a.id).map((e) => [e.id, e]));
  }

  evaluate(a: Assessment): AssessmentEvaluation {
    const revision = this.revisionFor(a);
    return evaluateAssessment(a, revision.snapshot, this.evidenceMap(a), { legacyRevision: isLegacyRevision(revision) });
  }

  /** Starts a Domain session for a result, based on the study's approved revision (no file import needed). */
  create(resultId: string, input: { role?: AssessmentRole }, actor: string): Assessment {
    const result = this.store.results.require(resultId);
    const study = this.store.studies.require(result.studyId);
    const project = this.store.projects.require(study.projectId);
    if (!study.approvedRevisionId) throw new ValidationError('Approve the Study session before starting a Domain session.');
    const revision = this.studies.revision(study.approvedRevisionId);
    if (isLegacyRevision(revision)) throw new ValidationError('Review and approve the imported study before starting a Domain session.');
    const inRevision = revision.snapshot.results.find((r) => r.id === resultId);
    if (!inRevision) throw new ValidationError('This result was added after the last approval. Approve the study again first.');
    const unsupported = perProtocolReason(revision.snapshot, inRevision);
    if (unsupported) throw new ValidationError(unsupported);

    const existing = this.store.assessments.find({ result_id: resultId }).filter((a) => a.role !== 'consensus');
    const mine = existing.find((a) => a.reviewer === actor);
    if (mine) throw new ValidationError(`You already have an assessment of this result (${mine.status}).`);
    // On a computer that received this study as an independent assignment, the reviewer here is the second reviewer.
    const assignedHere = this.store.packages
      .find({ project_id: project.id })
      .some((p) => p.direction === 'import' && p.kind === 'independent_assignment' && (p.manifest.study as { id?: string } | undefined)?.id === study.id);
    let role: AssessmentRole = input.role ?? (existing.length === 0 && !assignedHere ? 'first' : 'second');
    if (role === 'consensus') throw new ValidationError('Consensus records are created from the Verify stage.');
    if (project.verificationMode === 'checking' && existing.length > 0) {
      throw new ValidationError('In checking mode the second reviewer checks the first assessment instead of starting a new one.');
    }
    if (role === 'second' && existing.length >= 2) throw new ValidationError('This result already has two independent assessments.');
    if (role === 'first' && existing.some((a) => a.role === 'first')) role = 'second';

    return this.store.assessments.insert(blankAssessment({ projectId: project.id, studyId: study.id, resultId, studyRevisionId: revision.id, reviewer: actor, role }), {
      actor,
      reason: 'created'
    });
  }

  /** Applies an autosave patch. Every changed answer is recorded as an explicit decision by the acting reviewer. */
  patch(id: string, patch: AssessmentPatch, actor: string): Assessment {
    const current = this.store.assessments.require(id);
    if (current.status !== 'draft') throw new ValidationError(`This assessment is ${current.status}; reopen it to make changes.`);
    this.assertOwner(current, actor);
    const next: Assessment = structuredClone(current);
    next.version = patch.version;
    const t = now();
    const visible = this.evidenceMap(current);
    const touchedDomains = new Set<DomainId>();

    for (const [qid, change] of Object.entries(patch.responses ?? {})) {
      const domain = domainForQuestion(qid);
      if (!domain) throw new ValidationError(`Unknown question ${qid}.`);
      const prev = next.responses[qid] ?? emptyResponse();
      const r: QuestionResponse = { ...prev };
      if (change.answer !== undefined && change.answer !== '' && !isAllowedAnswer(qid, change.answer)) {
        throw new ValidationError(`"${change.answer}" is not a response option for ${qid}.`);
      }
      if (change.evidenceIds) {
        for (const e of change.evidenceIds) if (!visible.has(e)) throw new ValidationError('Linked evidence is not available in this assessment.');
        r.evidenceIds = [...new Set(change.evidenceIds)];
      }
      if (change.rationale !== undefined) r.rationale = change.rationale;
      const answerChanged = change.answer !== undefined && change.answer !== prev.answer;
      if (answerChanged) r.answer = change.answer!;
      if (answerChanged || change.confirm) {
        r.decidedBy = r.answer ? actor : null;
        r.decidedAt = r.answer ? t : null;
        r.origin = 'reviewer';
        r.needsReconfirm = null;
      }
      if (answerChanged) touchedDomains.add(domain);
      next.responses[qid] = r;
    }

    // A judgement confirmed earlier no longer stands once its answers change.
    for (const d of touchedDomains) {
      const dec = next.domains[d];
      if (dec?.final) dec.needsReconfirm = 'Answers in this domain changed after the judgement was confirmed.';
    }
    if (touchedDomains.size > 0 && next.overall.final) next.overall.needsReconfirm = 'Domain answers changed after the overall judgement was confirmed.';

    if (patch.domains || patch.overall) {
      const evaluation = evaluateAssessment(next, this.revisionFor(next).snapshot, visible);
      for (const [d, change] of Object.entries(patch.domains ?? {}) as [DomainId, { final: Judgement | ''; reason?: string }][]) {
        if (!DOMAIN_IDS.includes(d)) throw new ValidationError(`Unknown domain ${d}.`);
        if (!JUDGEMENTS.includes(change.final)) throw new ValidationError('Unknown judgement.');
        const suggested = evaluation.domains[d].evaluation.suggested;
        if (change.final && !suggested) throw new ValidationError(`${d}: answer the outstanding questions before confirming a judgement.`);
        if (change.final && change.final !== suggested && !(change.reason ?? '').trim()) {
          throw new ValidationError(`${d}: overriding the suggested judgement (${suggested}) requires a justification.`);
        }
        next.domains[d] = decision(change.final, change.reason ?? '', suggested ?? '', actor, t);
        if (next.overall.final) next.overall.needsReconfirm = 'A domain judgement changed after the overall judgement was confirmed.';
      }
      if (patch.overall) {
        const reEval = evaluateAssessment(next, this.revisionFor(next).snapshot, visible);
        const ov = reEval.overall.evaluation;
        const f = patch.overall.final;
        if (!JUDGEMENTS.includes(f)) throw new ValidationError('Unknown judgement.');
        if (f) {
          if (ov.status !== 'complete' || !ov.suggested) throw new ValidationError('Confirm all six domain judgements first.');
          if (!ov.allowed.includes(f)) throw new ValidationError(`The overall judgement cannot be lower than the worst domain (${ov.suggested}).`);
          if (f !== ov.suggested && !(patch.overall.reason ?? '').trim()) throw new ValidationError('Escalating the overall judgement requires a justification.');
        }
        next.overall = decision(f, patch.overall.reason ?? '', ov.suggested ?? '', actor, t);
      }
    }
    return this.store.assessments.update(next, { actor, reason: 'autosave' });
  }

  /** Submission enforces completeness; drafting does not. */
  submit(id: string, actor: string): Assessment {
    const a = this.store.assessments.require(id);
    this.assertOwner(a, actor);
    if (a.status !== 'draft') throw new ValidationError(`This assessment is already ${a.status}.`);
    const problems = this.evaluate(a).problems;
    if (problems.length > 0) throw new ValidationError('The assessment is not complete.', problems);
    return this.store.assessments.mutate(id, (x) => void ((x.status = 'submitted'), (x.submittedAt = now())), { actor, reason: 'submitted' });
  }

  reopen(id: string, reason: string, actor: string): Assessment {
    if (!reason?.trim()) throw new ValidationError('Give a reason for reopening.');
    const a = this.store.assessments.require(id);
    if (a.status === 'draft') return a;
    return this.store.assessments.mutate(
      id,
      (x) => {
        x.status = 'draft';
        x.submittedAt = null;
        x.finalizedAt = null;
      },
      { actor, reason: `reopened: ${reason.trim()}` }
    );
  }

  /**
   * Moves an assessment onto the study's latest approved revision. Answers are kept, but judgements that depend on
   * changed study content are marked for reconfirmation.
   */
  rebase(id: string, actor: string): Assessment {
    const a = this.store.assessments.require(id);
    this.assertOwner(a, actor);
    const study = this.store.studies.require(a.studyId);
    if (!study.approvedRevisionId || study.approvedRevisionId === a.studyRevisionId) return a;
    const from = this.studies.revision(a.studyRevisionId).snapshot;
    const to = this.studies.revision(study.approvedRevisionId);
    const rFrom = from.results.find((r) => r.id === a.resultId);
    const rTo = to.snapshot.results.find((r) => r.id === a.resultId);
    if (!rTo) throw new ValidationError('The result was removed from the latest study revision.');
    const resultChanged = canonicalJson(rFrom) !== canonicalJson(rTo) || canonicalJson(from.data.targetTrial) !== canonicalJson(to.snapshot.data.targetTrial);
    const confoundersChanged = canonicalJson(from.data.confounders) !== canonicalJson(to.snapshot.data.confounders);
    const note = `Study revision ${to.revisionNo} changed ${resultChanged ? 'the result or target trial' : 'the confounder evaluation'}; reconfirm.`;
    return this.store.assessments.mutate(
      id,
      (x) => {
        x.studyRevisionId = to.id;
        if (x.status !== 'draft') x.status = 'draft';
        const affected: DomainId[] = resultChanged ? [...DOMAIN_IDS] : confoundersChanged ? ['D1'] : [];
        for (const d of affected) {
          const dec = x.domains[d];
          if (dec?.final) dec.needsReconfirm = note;
        }
        if (affected.length && x.overall.final) x.overall.needsReconfirm = note;
      },
      { actor, reason: `rebased onto study revision ${to.revisionNo}` }
    );
  }

  /** Only the assessment's own reviewer edits it (consensus records: anyone reconciling). */
  assertOwner(a: Assessment, actor: string): void {
    if (a.role !== 'consensus' && a.reviewer !== actor) {
      throw new ValidationError(`This assessment belongs to ${a.reviewer}. Switch reviewer to edit it.`);
    }
  }

  /**
   * Visibility for independent review within one installation: another reviewer's first/second assessment of the
   * same result stays hidden until the viewer has submitted their own.
   */
  canView(a: Assessment, viewer: string): boolean {
    if (a.reviewer === viewer || a.role === 'consensus') return true;
    const project = this.store.projects.require(a.projectId);
    if (project.verificationMode === 'checking') return true;
    const peers = this.store.assessments.find({ result_id: a.resultId }).filter((x) => x.role !== 'consensus');
    const own = peers.find((x) => x.reviewer === viewer);
    if (own) return own.status !== 'draft';
    // Not a participant: visible once the independent phase is over (two submitted assessments).
    return peers.filter((x) => x.status !== 'draft').length >= 2;
  }
}

export function decision(final: Judgement | '', reason: string, suggested: Judgement | '', actor: string, t: string): DomainDecision {
  return {
    final,
    reason: reason.trim(),
    suggestedAtDecision: suggested,
    rulesetVersion: RULESET_VERSION,
    decidedBy: final ? actor : null,
    decidedAt: final ? t : null,
    origin: 'reviewer',
    needsReconfirm: null
  };
}

export function blankAssessment(input: {
  projectId: string;
  studyId: string;
  resultId: string;
  studyRevisionId: string;
  reviewer: string;
  role: AssessmentRole;
  parentIds?: string[];
}): Assessment {
  return {
    id: newId(),
    ...input,
    status: 'draft',
    responses: {},
    domains: {},
    overall: emptyDecision(RULESET_VERSION),
    parentIds: input.parentIds ?? [],
    importedFrom: null,
    rulesetVersion: RULESET_VERSION,
    createdAt: '',
    updatedAt: '',
    submittedAt: null,
    finalizedAt: null,
    version: 0
  };
}
