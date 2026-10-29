import { evaluateTriage, type AnswerMap } from '@robercop/rules';
import {
  emptyStudyData,
  isLegacyRevision,
  type ConfounderRow,
  type ResultSpec,
  type Study,
  type StudyData,
  type StudyRevision,
  type StudySnapshot
} from '@robercop/shared';
import { contentHash } from '@robercop/shared/node';
import { NotFoundError, ValidationError, newId, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import { matchOutcome } from './projects.js';

export interface ReadinessProblem {
  target: string;
  message: string;
}

export class StudyService {
  constructor(private readonly store: Store) {}

  create(projectId: string, input: { label: string; citation?: string }, actor: string): Study {
    this.store.projects.require(projectId);
    if (!input.label?.trim()) throw new ValidationError('A short study label (e.g. "Smith 2021") is required.');
    const data = emptyStudyData();
    data.citation = input.citation?.trim() ?? '';
    return this.store.studies.insert(
      { id: newId(), projectId, label: input.label.trim(), data, status: 'draft', approvedRevisionId: null, createdAt: '', updatedAt: '', version: 0 },
      { actor, reason: 'created' }
    );
  }

  results(studyId: string): ResultSpec[] {
    return this.store.results.find({ study_id: studyId }, 'ordinal');
  }

  snapshot(study: Study, results = this.results(study.id)): StudySnapshot {
    return { label: study.label, data: study.data, results: results.map(stripVolatile) };
  }

  latestRevision(studyId: string): (StudyRevision & { version: number }) | undefined {
    return this.store.studyRevisions.find({ study_id: studyId }, 'revision_no DESC')[0];
  }

  /** Recomputes draft/approved/changed by comparing the current content with the approved revision. */
  refreshStatus(studyId: string, actor: string): Study {
    const study = this.store.studies.require(studyId);
    const rev = study.approvedRevisionId ? this.store.studyRevisions.get(study.approvedRevisionId) : undefined;
    const status: Study['status'] = !rev ? 'draft' : contentHash(this.snapshot(study)) === rev.hash ? 'approved' : 'changed';
    if (status === study.status) return study;
    return this.store.studies.mutate(studyId, (s) => void (s.status = status), { actor, reason: 'status' });
  }

  update(id: string, patch: { version: number; label?: string; data?: StudyData }, actor: string): Study {
    const current = this.store.studies.require(id);
    const data = patch.data ? sanitizeStudyData(patch.data) : current.data;
    const next: Study = { ...current, label: patch.label?.trim() || current.label, data, version: patch.version };
    this.store.studies.update(next, { actor, reason: 'autosave' });
    return this.refreshStatus(id, actor);
  }

  addResult(studyId: string, input: Partial<ResultSpec>, actor: string): ResultSpec {
    const study = this.store.studies.require(studyId);
    const project = this.store.projects.require(study.projectId);
    const existing = this.results(studyId);
    const outcomeDomain = input.outcomeDomain ?? (matchOutcome(project.cfMatrix, input.outcome ?? '')[0] || '');
    const result: ResultSpec = {
      id: newId(),
      studyId,
      ordinal: existing.length ? Math.max(...existing.map((r) => r.ordinal)) + 1 : 1,
      outcomeDomain,
      outcome: input.outcome?.trim() ?? '',
      timePoint: input.timePoint ?? '',
      comparison: input.comparison ?? '',
      analysis: input.analysis ?? '',
      effect: input.effect ?? 'ITT',
      numericalResult: input.numericalResult ?? '',
      location: input.location ?? '',
      outcomeDefinition: input.outcomeDefinition ?? '',
      importantFactors: input.importantFactors ?? (outcomeDomain ? [...(project.cfMatrix[outcomeDomain] ?? [])] : []),
      triage: input.triage ?? { answers: {}, notes: {}, evidenceIds: {} },
      evidenceIds: input.evidenceIds ?? [],
      createdAt: '',
      updatedAt: '',
      version: 0
    };
    const saved = this.store.db.tx(() => {
      const r = this.store.results.insert(result, { actor, reason: 'created' });
      this.syncConfounders(studyId, actor);
      return r;
    });
    this.refreshStatus(studyId, actor);
    return saved;
  }

  /** Creates a separate result for another analysis of the same outcome, copying its identity fields. */
  duplicateResult(resultId: string, actor: string): ResultSpec {
    const r = this.store.results.require(resultId);
    return this.addResult(
      r.studyId,
      { ...r, analysis: r.analysis ? `${r.analysis} (copy)` : 'Another analysis', numericalResult: '', location: '', triage: { answers: {}, notes: {}, evidenceIds: {} }, evidenceIds: [] },
      actor
    );
  }

  updateResult(id: string, patch: Partial<ResultSpec> & { version: number }, actor: string): ResultSpec {
    const current = this.store.results.require(id);
    const study = this.store.studies.require(current.studyId);
    const project = this.store.projects.require(study.projectId);
    const next: ResultSpec = { ...current, ...patch, id: current.id, studyId: current.studyId, ordinal: patch.ordinal ?? current.ordinal };
    // Picking a new outcome domain resets the important factors to the matrix defaults unless the client sent its own list.
    if (patch.outcomeDomain !== undefined && patch.outcomeDomain !== current.outcomeDomain && !patch.importantFactors) {
      next.importantFactors = [...(project.cfMatrix[patch.outcomeDomain] ?? [])];
    }
    for (const id of ['B1', 'B2', 'B3'] as const) {
      const a = next.triage.answers[id];
      if (a && !['Y', 'PY', 'PN', 'N'].includes(a)) throw new ValidationError(`${id} must be Y, PY, PN or N.`);
    }
    const saved = this.store.db.tx(() => {
      const r = this.store.results.update(next, { actor, reason: 'autosave' });
      this.syncConfounders(r.studyId, actor);
      return r;
    });
    this.refreshStatus(saved.studyId, actor);
    return saved;
  }

  deleteResult(id: string, actor: string): void {
    const r = this.store.results.require(id);
    if (this.store.assessments.find({ result_id: id }).length > 0) {
      throw new ValidationError('This result already has assessments; it cannot be deleted. Edit it instead.');
    }
    this.store.results.delete(id, { actor, reason: 'result removed' });
    this.refreshStatus(r.studyId, actor);
  }

  /** Ensures every important factor mapped to a result has a row in the confounding-factor evaluation. */
  syncConfounders(studyId: string, actor: string): void {
    const study = this.store.studies.require(studyId);
    const factors = new Set(this.results(studyId).flatMap((r) => r.importantFactors));
    const have = new Set(study.data.confounders.map((c) => c.factor.toLowerCase()));
    const missing = [...factors].filter((f) => !have.has(f.toLowerCase()));
    if (missing.length === 0) return;
    this.store.studies.mutate(
      studyId,
      (s) => {
        for (const factor of missing) s.data.confounders.push(newConfounder(factor, 'prespecified'));
      },
      { actor, reason: 'confounders synced' }
    );
  }

  readiness(study: Study, results: ResultSpec[]): ReadinessProblem[] {
    const p: ReadinessProblem[] = [];
    const tt = study.data.targetTrial;
    if (!study.data.citation.trim()) p.push({ target: 'citation', message: 'Add the study citation.' });
    if (!tt.c1.trim()) p.push({ target: 'c1', message: 'C1: specify the participants and eligibility criteria.' });
    if (!tt.c2.trim()) p.push({ target: 'c2', message: 'C2: specify the intervention strategy.' });
    if (!tt.c3.trim()) p.push({ target: 'c3', message: 'C3: specify the comparator strategy.' });
    if (study.data.sources.checked.length === 0 && !study.data.sources.other.trim()) p.push({ target: 'sources', message: 'D: record at least one information source.' });
    if (results.length === 0) p.push({ target: 'results', message: 'Add at least one numerical result to assess.' });
    for (const r of results) {
      const name = resultName(r);
      if (!r.outcome.trim()) p.push({ target: r.id, message: `${name}: name the outcome.` });
      if (!r.numericalResult.trim()) p.push({ target: r.id, message: `${name}: A1, the numerical result, is required.` });
      if (!r.outcomeDefinition.trim()) p.push({ target: r.id, message: `${name}: A3, the outcome definition, is required.` });
      const t = evaluateTriage(r.triage.answers as AnswerMap);
      if (t.status === 'incomplete' || t.status === 'invalid') p.push({ target: r.id, message: `${name}: complete triage (B1–B3).` });
    }
    const needed = new Set(results.flatMap((r) => r.importantFactors.map((f) => f.toLowerCase())));
    for (const c of study.data.confounders) {
      if (!needed.has(c.factor.toLowerCase()) && c.list === 'prespecified') continue;
      if (!c.controlled) p.push({ target: c.id, message: `Confounder "${c.factor}": was it controlled for (Y/N)?` });
      else if (c.controlled === 'Y' && !c.valid) p.push({ target: c.id, message: `Confounder "${c.factor}": was it measured validly and reliably?` });
      else if (c.controlled === 'N' && !c.unnecessary) p.push({ target: c.id, message: `Confounder "${c.factor}": is there evidence that controlling for it was unnecessary?` });
    }
    return p;
  }

  /** Approves the current study content as an immutable revision that Domain sessions reference. */
  approve(studyId: string, actor: string, note = ''): StudyRevision {
    const study = this.store.studies.require(studyId);
    const results = this.results(studyId);
    const problems = this.readiness(study, results);
    if (problems.length > 0) throw new ValidationError('The study is not ready for approval.', problems);
    const snapshot = this.snapshot(study, results);
    const hash = contentHash(snapshot);
    const latest = this.latestRevision(studyId);
    // Reuse an identical revision only if a reviewer approved it; a legacy-import revision is never an approval.
    if (latest && latest.hash === hash && !isLegacyRevision(latest)) {
      if (study.approvedRevisionId !== latest.id) {
        this.store.studies.mutate(studyId, (s) => void ((s.approvedRevisionId = latest.id), (s.status = 'approved')), { actor, reason: 'approved' });
      }
      return latest;
    }
    return this.store.db.tx(() => {
      const rev = this.store.studyRevisions.insert(
        {
          id: newId(),
          studyId,
          revisionNo: (latest?.revisionNo ?? 0) + 1,
          snapshot,
          hash,
          approvedBy: actor,
          approvedAt: now(),
          note,
          version: 0
        },
        { actor, reason: 'approved' }
      );
      this.store.studies.mutate(studyId, (s) => void ((s.approvedRevisionId = rev.id), (s.status = 'approved')), { actor, reason: 'approved' });
      return rev;
    });
  }

  revision(id: string): StudyRevision {
    const r = this.store.studyRevisions.get(id);
    if (!r) throw new NotFoundError('study revision', id);
    return r;
  }
}

/** Fields that change on every write and are not part of the approved content. */
function stripVolatile(r: ResultSpec): ResultSpec {
  return { ...r, createdAt: '', updatedAt: '', version: 0 };
}

export function resultName(r: Pick<ResultSpec, 'ordinal' | 'outcome' | 'timePoint' | 'analysis'>): string {
  const parts = [r.outcome || `Result ${r.ordinal}`, r.timePoint, r.analysis].filter(Boolean);
  return parts.join(' · ');
}

export function newConfounder(factor: string, list: ConfounderRow['list']): ConfounderRow {
  return { id: newId(), factor, list, variables: '', controlled: '', valid: '', unnecessary: '', unnecessaryCondition: '', comments: '', evidenceIds: [] };
}

function sanitizeStudyData(d: StudyData): StudyData {
  const base = emptyStudyData();
  return {
    citation: String(d.citation ?? ''),
    notes: String(d.notes ?? ''),
    targetTrial: { ...base.targetTrial, ...d.targetTrial, links: { ...base.targetTrial.links, ...(d.targetTrial?.links ?? {}) } },
    sources: { checked: Array.isArray(d.sources?.checked) ? d.sources.checked.map(String) : [], other: String(d.sources?.other ?? '') },
    confounders: Array.isArray(d.confounders)
      ? d.confounders.map((c) => ({ ...newConfounder(String(c.factor ?? ''), c.list === 'additional' ? 'additional' : 'prespecified'), ...c, evidenceIds: c.evidenceIds ?? [] }))
      : []
  };
}
