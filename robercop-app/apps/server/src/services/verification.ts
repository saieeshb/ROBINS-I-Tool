import { DOMAIN_IDS, DOMAINS, isAllowedAnswer, type Answer, type DomainId } from '@robercop/rules';
import { type Assessment, type VerificationDecision, type VerificationVerdict } from '@robercop/shared';
import { ValidationError, newId, now } from '../db/database.js';
import type { ConsensusItem, Store } from '../db/store.js';
import { blankAssessment, type AssessmentService } from './assessments.js';

export interface ComparisonRow {
  target: string;
  label: string;
  kind: 'question' | 'domain' | 'overall';
  values: Record<string, string>;
  agree: boolean;
}

export interface VerifyTarget {
  target: string;
  kind: 'question' | 'domain' | 'overall';
  value: string;
}

const VERDICTS: VerificationVerdict[] = ['confirmed', 'change_requested', 'disagree'];

export class VerificationService {
  constructor(
    private readonly store: Store,
    private readonly assessments: AssessmentService
  ) {}

  /** Targets a verifier must look at in checking mode: reached questions, each domain judgement, and overall. */
  targets(a: Assessment): VerifyTarget[] {
    const ev = this.assessments.evaluate(a);
    const out: VerifyTarget[] = [];
    if (!ev.triageCritical) {
      for (const d of DOMAINS) {
        for (const q of ev.domains[d.id].evaluation.questions) {
          if (q.reached) out.push({ target: q.id, kind: 'question', value: a.responses[q.id]?.answer ?? '' });
        }
        out.push({ target: d.id, kind: 'domain', value: a.domains[d.id]?.final ?? '' });
      }
    }
    out.push({ target: 'overall', kind: 'overall', value: a.overall.final });
    return out;
  }

  decisions(assessmentId: string): VerificationDecision[] {
    return this.store.verifications.find({ assessment_id: assessmentId });
  }

  /** Latest verification decision per target. */
  latest(assessmentId: string): Map<string, VerificationDecision> {
    const m = new Map<string, VerificationDecision>();
    for (const d of this.decisions(assessmentId)) if (d.resolution !== 'superseded') m.set(d.target, d);
    return m;
  }

  /** Checking mode: the verifier confirms, requests a change, or disagrees, one target at a time. */
  verify(assessmentId: string, input: { target: string; verdict: VerificationVerdict; proposedAnswer?: string; comment?: string }, actor: string): VerificationDecision {
    const a = this.store.assessments.require(assessmentId);
    const project = this.store.projects.require(a.projectId);
    if (project.verificationMode !== 'checking') throw new ValidationError('Question-level checking is used only in checking mode.');
    if (a.reviewer === actor) throw new ValidationError('The assessment must be checked by a different reviewer.');
    if (a.status !== 'submitted') throw new ValidationError('Only a submitted assessment can be checked.');
    if (!VERDICTS.includes(input.verdict)) throw new ValidationError('Unknown verdict.');
    const targets = this.targets(a);
    if (!targets.some((t) => t.target === input.target)) throw new ValidationError(`${input.target} is not part of this assessment.`);
    if (input.verdict !== 'confirmed' && !(input.comment ?? '').trim()) throw new ValidationError('Explain the requested change or disagreement.');
    if (input.proposedAnswer && input.target.startsWith('Q') && !isAllowedAnswer(input.target, input.proposedAnswer)) {
      throw new ValidationError(`"${input.proposedAnswer}" is not a response option for ${input.target}.`);
    }
    return this.store.db.tx(() => {
      const prev = this.latest(assessmentId).get(input.target);
      if (prev) this.store.verifications.mutate(prev.id, (d) => void (d.resolution = 'superseded'), { actor, reason: 'superseded' });
      return this.store.verifications.insert(
        {
          id: newId(),
          assessmentId,
          target: input.target,
          verdict: input.verdict,
          proposedAnswer: input.proposedAnswer ?? '',
          comment: input.comment?.trim() ?? '',
          reviewer: actor,
          createdAt: '',
          resolution: '',
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: '',
          version: 0
        },
        { actor, reason: `verification: ${input.verdict}` }
      );
    });
  }

  /** The first reviewer responds to a change request or disagreement (after reopening and editing if accepted). */
  resolve(id: string, input: { resolution: 'accepted' | 'declined'; note?: string }, actor: string): VerificationDecision {
    const d = this.store.verifications.require(id);
    if (d.verdict === 'confirmed') throw new ValidationError('Confirmations need no resolution.');
    if (!['accepted', 'declined'].includes(input.resolution)) throw new ValidationError('Choose accepted or declined.');
    if (input.resolution === 'declined' && !(input.note ?? '').trim()) throw new ValidationError('Explain why the change was declined.');
    return this.store.verifications.mutate(
      id,
      (x) => void ((x.resolution = input.resolution), (x.resolvedBy = actor), (x.resolvedAt = now()), (x.resolutionNote = input.note?.trim() ?? '')),
      { actor, reason: `resolved: ${input.resolution}` }
    );
  }

  /** Checking-mode status: what still needs the verifier or the first reviewer. */
  checkingStatus(a: Assessment): { unverified: string[]; open: VerificationDecision[]; awaitingRecheck: string[]; changedSinceCheck: string[] } {
    const latest = this.latest(a.id);
    const unverified: string[] = [];
    const awaitingRecheck: string[] = [];
    const changedSinceCheck: string[] = [];
    const open: VerificationDecision[] = [];
    for (const t of this.targets(a)) {
      const d = latest.get(t.target);
      if (!d) unverified.push(t.target);
      else if (d.verdict !== 'confirmed') (d.resolution ? awaitingRecheck.push(t.target) : open.push(d));
      else {
        // A confirmation applies to the value that was confirmed; later edits need checking again.
        const decidedAt = t.kind === 'question' ? a.responses[t.target]?.decidedAt : t.kind === 'domain' ? a.domains[t.target as DomainId]?.decidedAt : a.overall.decidedAt;
        if (decidedAt && decidedAt > d.createdAt) changedSinceCheck.push(t.target);
      }
    }
    return { unverified, open, awaitingRecheck, changedSinceCheck };
  }

  /** Side-by-side comparison of assessments of the same result (independent mode). */
  compare(ids: string[]): ComparisonRow[] {
    const list = ids.map((id) => this.store.assessments.require(id));
    const evals = list.map((a) => this.assessments.evaluate(a));
    const rows: ComparisonRow[] = [];
    for (const d of DOMAINS) {
      const reached = new Set<string>();
      for (const ev of evals) for (const q of ev.domains[d.id].evaluation.questions) if (q.reached) reached.add(q.id);
      for (const qid of d.questionIds.filter((q) => reached.has(q))) {
        const values = Object.fromEntries(list.map((a, i) => [a.id, evals[i].domains[d.id].evaluation.questions.find((q) => q.id === qid)?.reached ? a.responses[qid]?.answer ?? '' : 'NA']));
        rows.push({ target: qid, label: qid, kind: 'question', values, agree: new Set(Object.values(values)).size === 1 });
      }
      const values = Object.fromEntries(list.map((a) => [a.id, a.domains[d.id]?.final ?? '']));
      rows.push({ target: d.id, label: d.short, kind: 'domain', values, agree: new Set(Object.values(values)).size === 1 });
    }
    const values = Object.fromEntries(list.map((a) => [a.id, a.overall.final]));
    rows.push({ target: 'overall', label: 'Overall', kind: 'overall', values, agree: new Set(Object.values(values)).size === 1 });
    return rows;
  }

  /**
   * Creates the consensus record for two submitted independent assessments. Both originals are preserved unchanged;
   * agreed answers are carried over attributed to both reviewers, and each disagreement becomes an item to reconcile.
   */
  createConsensus(resultId: string, actor: string): Assessment {
    const peers = this.store.assessments.find({ result_id: resultId }).filter((a) => a.role !== 'consensus');
    const existing = this.store.assessments.find({ result_id: resultId }).find((a) => a.role === 'consensus');
    if (existing) return existing;
    if (peers.length !== 2) throw new ValidationError('Consensus needs exactly two independent assessments of this result.');
    if (peers.some((a) => a.status === 'draft')) throw new ValidationError('Both independent assessments must be submitted first.');
    if (peers[0].studyRevisionId !== peers[1].studyRevisionId) {
      throw new ValidationError('The two assessments are based on different study revisions; rebase one of them first.');
    }
    const [a, b] = peers;
    const rows = this.compare([a.id, b.id]);
    const t = now();
    const agreedBy = `${a.reviewer} + ${b.reviewer} (agreed)`;
    const c = blankAssessment({ projectId: a.projectId, studyId: a.studyId, resultId, studyRevisionId: a.studyRevisionId, reviewer: actor, role: 'consensus', parentIds: [a.id, b.id] });
    for (const row of rows) {
      if (row.kind !== 'question' || !row.agree) continue;
      const ra = a.responses[row.target];
      const rb = b.responses[row.target];
      if (!ra?.answer) continue;
      c.responses[row.target] = {
        answer: ra.answer,
        rationale: [ra.rationale && `${a.reviewer}: ${ra.rationale}`, rb?.rationale && `${b.reviewer}: ${rb.rationale}`].filter(Boolean).join('\n'),
        evidenceIds: [...new Set([...(ra.evidenceIds ?? []), ...(rb?.evidenceIds ?? [])])].filter((id) => {
          const e = this.store.evidence.get(id);
          return e && e.assessmentId === null;
        }),
        decidedBy: agreedBy,
        decidedAt: t,
        origin: 'reviewer'
      };
    }
    return this.store.db.tx(() => {
      const saved = this.store.assessments.insert(c, { actor, reason: 'consensus created' });
      for (const row of rows.filter((r) => !r.agree)) {
        this.store.consensusItems.insert(
          { id: newId(), assessmentId: saved.id, target: row.target, answers: { [a.reviewer]: row.values[a.id], [b.reviewer]: row.values[b.id] }, final: '', note: '', resolvedBy: null, resolvedAt: null, createdAt: '', updatedAt: '', version: 0 },
          { actor, reason: 'disagreement recorded' }
        );
      }
      return saved;
    });
  }

  consensusItems(assessmentId: string): ConsensusItem[] {
    return this.store.consensusItems.find({ assessment_id: assessmentId });
  }

  /** Resolves one disagreement and writes the reconciled answer into the consensus record. */
  resolveDisagreement(itemId: string, input: { final: string; note: string }, actor: string): ConsensusItem {
    const item = this.store.consensusItems.require(itemId);
    const c = this.store.assessments.require(item.assessmentId);
    if (c.status !== 'draft') throw new ValidationError('Reopen the consensus record to change it.');
    if (!(input.note ?? '').trim()) throw new ValidationError('Record how the disagreement was resolved.');
    const t = now();
    return this.store.db.tx(() => {
      if (item.target.startsWith('Q')) {
        if (!isAllowedAnswer(item.target, input.final)) throw new ValidationError(`"${input.final}" is not a response option for ${item.target}.`);
        this.assessments.patch(c.id, { version: c.version, responses: { [item.target]: { answer: input.final as Answer, rationale: `Consensus: ${input.note.trim()}` } } }, actor);
      }
      // Domain and overall disagreements are settled by confirming the judgement in the consensus record itself.
      return this.store.consensusItems.mutate(itemId, (x) => void ((x.final = input.final), (x.note = input.note.trim()), (x.resolvedBy = actor), (x.resolvedAt = t)), {
        actor,
        reason: 'disagreement resolved'
      });
    });
  }

  /**
   * Finalizes the documented assessment for a result: the consensus record (independent mode) or the checked first
   * assessment (checking mode). Requires completeness, verified quotations and finished verification.
   */
  finalize(assessmentId: string, actor: string): Assessment {
    const a = this.store.assessments.require(assessmentId);
    const project = this.store.projects.require(a.projectId);
    const problems = this.finalizeProblems(a, project.verificationMode, actor);
    if (problems.length) throw new ValidationError('Cannot finalize yet.', problems.map((message) => ({ target: 'finalize', message })));
    return this.store.assessments.mutate(
      assessmentId,
      (x) => void ((x.status = 'finalized'), (x.finalizedAt = now()), x.submittedAt ?? (x.submittedAt = now())),
      { actor, reason: 'finalized' }
    );
  }

  finalizeProblems(a: Assessment, mode: 'independent' | 'checking', actor: string): string[] {
    const problems: string[] = [];
    if (a.status === 'finalized') return ['Already finalized.'];
    const ev = this.assessments.evaluate(a);
    problems.push(...ev.problems.map((p) => p.message));
    if (mode === 'independent') {
      if (a.role !== 'consensus') problems.push('In independent mode the consensus record is finalized, not an individual assessment.');
      for (const item of this.consensusItems(a.id)) if (!item.resolvedAt) problems.push(`Disagreement on ${item.target} is unresolved.`);
    } else {
      if (a.role !== 'first') problems.push('In checking mode the first assessment is finalized.');
      if (a.status !== 'submitted') problems.push('Resubmit the assessment after making requested changes.');
      const s = this.checkingStatus(a);
      if (s.unverified.length) problems.push(`Not yet checked: ${s.unverified.join(', ')}.`);
      if (s.changedSinceCheck.length) problems.push(`Changed after checking: ${s.changedSinceCheck.join(', ')}.`);
      if (s.awaitingRecheck.length) problems.push(`Responded to, awaiting the checker's confirmation: ${s.awaitingRecheck.join(', ')}.`);
      for (const d of s.open) problems.push(`${d.target}: ${d.verdict.replace('_', ' ')} by ${d.reviewer} is unresolved.`);
      if (a.reviewer === actor) problems.push('The checker, not the first reviewer, finalizes a checked assessment.');
    }
    return problems;
  }

  /** Domain judgements' disagreements resolved implicitly when the consensus judgement is confirmed. */
  syncJudgementItems(consensusId: string, actor: string): void {
    const c = this.store.assessments.require(consensusId);
    for (const item of this.consensusItems(consensusId)) {
      if (item.resolvedAt) continue;
      const final = item.target === 'overall' ? c.overall.final : DOMAIN_IDS.includes(item.target as DomainId) ? c.domains[item.target as DomainId]?.final : undefined;
      if (final) {
        this.store.consensusItems.mutate(item.id, (x) => void ((x.final = final), (x.note = x.note || 'Settled by the confirmed consensus judgement.'), (x.resolvedBy = actor), (x.resolvedAt = now())), {
          actor,
          reason: 'resolved by consensus judgement'
        });
      }
    }
  }
}

