import ExcelJS from 'exceljs';
import { DOMAINS, RULESET_VERSION, describePath, getQuestion, judgementLabel, type DomainId } from '@robercop/rules';
import { isLegacyRevision, type Assessment, type EvidenceItem, type ResultSpec, type SourceDocument, type Study, type StudyRevision, type VerificationDecision } from '@robercop/shared';
import type { Store } from '../db/store.js';
import type { AppConfig } from '../config.js';
import type { AssessmentService } from './assessments.js';
import type { DocumentService } from './documents.js';
import { resultName, type StudyService } from './studies.js';
import type { VerificationService } from './verification.js';

export const EXPORT_FORMAT = 'robercop-export';
export const EXPORT_FORMAT_VERSION = 1;

const CHECK_LABELS: Record<string, string> = {
  not_checked: 'Not checked',
  matched: 'Matched',
  ambiguous: 'Ambiguous (several locations)',
  unmatched: 'Not found in source',
  incomplete_extraction: 'Source text incomplete',
  needs_recheck: 'Needs recheck',
  manually_verified: 'Manually checked'
};

/** Human-readable source-check line for a quotation, e.g. "Matched (normalized) · Manuscript p. 4 · OCR". */
export function checkSummary(e: EvidenceItem, docs: Map<string, SourceDocument>): string {
  const c = e.check;
  const parts = [CHECK_LABELS[c.status] ?? c.status];
  if (c.method && c.method !== 'manual') parts[0] += ` (${c.method})`;
  const locs = c.locations.length ? c.locations : e.page ? [{ documentId: e.documentId ?? '', page: e.page }] : [];
  for (const l of locs.slice(0, 3)) parts.push(`${docs.get(l.documentId)?.label ?? 'source'} p. ${l.page}`);
  if (c.ocr) parts.push('OCR text');
  if (c.manual) parts.push(`checked by ${c.manual.by}${c.manual.page ? ` at p. ${c.manual.page}` : ''}: ${c.manual.note}`);
  return parts.join(' · ');
}

interface DecisionLogEntry {
  at: string;
  actor: string;
  reason: string;
  changes: string[];
}

/** Turns stored revisions of an assessment into a readable log of answer and judgement decisions. */
export function decisionLog(rows: { actor: string; reason: string; createdAt: string; data: unknown }[]): DecisionLogEntry[] {
  const out: DecisionLogEntry[] = [];
  let prev: Assessment | null = null;
  for (const row of rows) {
    const cur = row.data as Assessment;
    if (!cur || (cur as unknown as { deleted?: boolean }).deleted) continue;
    const changes: string[] = [];
    const ids = new Set([...Object.keys(prev?.responses ?? {}), ...Object.keys(cur.responses ?? {})]);
    for (const q of [...ids].sort(compareIds)) {
      const a = prev?.responses[q]?.answer ?? '';
      const b = cur.responses?.[q]?.answer ?? '';
      if (a !== b) changes.push(`${q}: ${a || '—'} → ${b || '—'}`);
      else if (b && cur.responses[q]?.decidedAt !== prev?.responses[q]?.decidedAt && cur.responses[q]?.origin === 'reviewer' && prev?.responses[q]?.origin === 'legacy_import') {
        changes.push(`${q}: imported answer ${b} confirmed`);
      }
    }
    for (const d of DOMAINS.map((x) => x.id)) {
      const a = prev?.domains[d]?.final ?? '';
      const b = cur.domains?.[d]?.final ?? '';
      if (a !== b) changes.push(`${d} judgement: ${a || '—'} → ${b || '—'}${cur.domains[d]?.reason && b !== cur.domains[d]?.suggestedAtDecision ? ` (override: ${cur.domains[d]!.reason})` : ''}`);
    }
    if ((prev?.overall.final ?? '') !== (cur.overall?.final ?? '')) changes.push(`Overall: ${prev?.overall.final || '—'} → ${cur.overall?.final || '—'}`);
    if (prev && prev.status !== cur.status) changes.push(`Status: ${prev.status} → ${cur.status}`);
    if (prev && prev.studyRevisionId !== cur.studyRevisionId) changes.push('Moved to a newer study revision');
    if (changes.length || !prev || row.reason !== 'autosave') out.push({ at: row.createdAt, actor: row.actor, reason: row.reason, changes });
    prev = cur;
  }
  return out;
}

function compareIds(a: string, b: string): number {
  const pa = a.match(/\d+/g)?.map(Number) ?? [];
  const pb = b.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return a.localeCompare(b);
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');

interface AssessmentBundle {
  assessment: Assessment;
  study: Study;
  revision: StudyRevision;
  result: ResultSpec | undefined;
  evidence: Map<string, EvidenceItem>;
  docs: Map<string, SourceDocument>;
  verifications: VerificationDecision[];
}

export class ExportService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly studies: StudyService,
    private readonly documents: DocumentService,
    private readonly assessments: AssessmentService,
    private readonly verification: VerificationService
  ) {}

  private docsFor(study: Study): Map<string, SourceDocument> {
    return new Map([...this.documents.forStudy(study.id), ...this.documents.referenceDocuments(study.projectId)].map((d) => [d.id, d]));
  }

  private bundle(a: Assessment): AssessmentBundle {
    const study = this.store.studies.require(a.studyId);
    const revision = this.studies.revision(a.studyRevisionId);
    return {
      assessment: a,
      study,
      revision,
      result: revision.snapshot.results.find((r) => r.id === a.resultId),
      evidence: this.assessments.evidenceMap(a),
      docs: this.docsFor(study),
      verifications: this.verification.decisions(a.id)
    };
  }

  /** Assessments of a study the viewer may see (independent reviews stay hidden until the viewer has submitted). */
  private visibleAssessments(studyId: string, viewer: string): Assessment[] {
    return this.store.assessments.find({ study_id: studyId }).filter((a) => this.assessments.canView(a, viewer));
  }

  requireVisible(id: string, viewer: string): Assessment {
    const a = this.store.assessments.require(id);
    if (!this.assessments.canView(a, viewer)) {
      throw Object.assign(new Error('This assessment is hidden until you have submitted your own independent assessment of the same result.'), { statusCode: 403 });
    }
    return a;
  }

  // --- JSON -------------------------------------------------------------------------------------------------------

  private assessmentJson(b: AssessmentBundle) {
    const ev = this.assessments.evaluate(b.assessment);
    return {
      assessment: b.assessment,
      result: b.result ?? null,
      studyRevision: { id: b.revision.id, revisionNo: b.revision.revisionNo, hash: b.revision.hash, approvedBy: b.revision.approvedBy, approvedAt: b.revision.approvedAt, legacy: isLegacyRevision(b.revision) },
      evaluation: {
        triage: ev.triage.status,
        domains: Object.fromEntries(
          DOMAINS.map((d) => {
            const st = ev.domains[d.id];
            return [d.id, { suggested: st.evaluation.suggested ?? null, final: st.final ?? null, path: describePath(st.evaluation.path), excludedAnswers: st.evaluation.excluded, outstanding: st.evaluation.outstanding }];
          })
        ),
        overall: { suggested: ev.overall.suggested ?? null, final: b.assessment.overall.final || null },
        problems: ev.problems
      },
      verifications: b.verifications,
      consensusItems: b.assessment.role === 'consensus' ? this.store.consensusItems.find({ assessment_id: b.assessment.id }) : [],
      decisionLog: decisionLog(this.store.revisionsFor('assessment', b.assessment.id))
    };
  }

  assessmentExportJson(id: string, viewer: string) {
    const a = this.requireVisible(id, viewer);
    const b = this.bundle(a);
    const used = new Set(Object.values(a.responses).flatMap((r) => r.evidenceIds));
    return {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: viewer,
      appVersion: this.config.appVersion,
      rulesetVersion: RULESET_VERSION,
      study: { id: b.study.id, label: b.study.label, citation: b.revision.snapshot.data.citation },
      ...this.assessmentJson(b),
      evidence: [...b.evidence.values()].filter((e) => used.has(e.id)),
      documents: [...b.docs.values()]
    };
  }

  projectExportJson(projectId: string, viewer: string) {
    const project = this.store.projects.require(projectId);
    const studies = this.store.studies.find({ project_id: projectId });
    return {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: viewer,
      appVersion: this.config.appVersion,
      rulesetVersion: RULESET_VERSION,
      project,
      studies: studies.map((study) => {
        const visible = this.visibleAssessments(study.id, viewer);
        const visibleIds = new Set(visible.map((a) => a.id));
        return {
          study,
          approvedRevision: study.approvedRevisionId ? this.studies.revision(study.approvedRevisionId) : null,
          results: this.studies.results(study.id),
          documents: this.documents.forStudy(study.id),
          evidence: this.store.evidence.find({ study_id: study.id }).filter((e) => !e.assessmentId || visibleIds.has(e.assessmentId)),
          assessments: visible.map((a) => this.assessmentJson(this.bundle(a)))
        };
      })
    };
  }

  // --- Excel ------------------------------------------------------------------------------------------------------

  private async workbook(bundles: AssessmentBundle[], studies: { study: Study; results: ResultSpec[]; revision: StudyRevision | null; evidence: EvidenceItem[] }[], title: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ROBer COP';
    wb.created = new Date();
    const sheet = (name: string, columns: [string, number][]) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = columns.map(([header, width]) => ({ header, width }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF2' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      return ws;
    };
    const wrap = (ws: ExcelJS.Worksheet) => ws.eachRow((row, n) => n > 1 && (row.alignment = { vertical: 'top', wrapText: true }));

    const about = wb.addWorksheet('About');
    about.columns = [{ width: 26 }, { width: 90 }];
    for (const r of [
      ['Export', title],
      ['Exported', new Date().toISOString()],
      ['Rules', RULESET_VERSION],
      ['Application', `ROBer COP ${this.config.appVersion}`],
      ['Note', 'Reviewer names are local attribution only. Hidden independent assessments are not included.']
    ]) about.addRow(r);
    about.getColumn(1).font = { bold: true };

    const js = sheet('Judgements', [
      ['Study', 18], ['Result', 34], ['Reviewer', 16], ['Role', 11], ['Status', 11], ['Study revision', 10],
      ['D1', 11], ['D2', 11], ['D3', 11], ['D4', 11], ['D5', 11], ['D6', 11], ['Overall', 11], ['Overall default', 11], ['Overall reason', 40], ['Submitted', 18], ['Finalized', 18]
    ]);
    for (const b of bundles) {
      const a = b.assessment;
      const ev = this.assessments.evaluate(a);
      js.addRow([
        b.study.label,
        b.result ? resultName(b.result) : a.resultId,
        a.reviewer,
        a.role,
        a.status,
        `#${b.revision.revisionNo}${isLegacyRevision(b.revision) ? ' (legacy, unreviewed)' : ''}`,
        ...DOMAINS.map((d) => a.domains[d.id]?.final ?? ''),
        a.overall.final,
        ev.overall.suggested ?? '',
        a.overall.reason,
        a.submittedAt ?? '',
        a.finalizedAt ?? ''
      ]);
    }

    const ds = sheet('Domains', [['Study', 18], ['Result', 30], ['Reviewer', 16], ['Domain', 8], ['Suggested', 11], ['Final', 11], ['Override reason', 40], ['Algorithm path', 60], ['Decided by', 16], ['Decided at', 18]]);
    for (const b of bundles) {
      const ev = this.assessments.evaluate(b.assessment);
      for (const d of DOMAINS) {
        const st = ev.domains[d.id];
        const dec = b.assessment.domains[d.id];
        ds.addRow([b.study.label, b.result ? resultName(b.result) : '', b.assessment.reviewer, d.id, st.evaluation.suggested ?? '', dec?.final ?? '', dec?.final && dec.final !== st.evaluation.suggested ? dec.reason : '', describePath(st.evaluation.path), dec?.decidedBy ?? '', dec?.decidedAt ?? '']);
      }
    }
    wrap(ds);

    const as = sheet('Answers', [
      ['Study', 18], ['Result', 30], ['Reviewer', 16], ['Question', 9], ['Question text', 50], ['Answer', 8], ['Used in scoring', 10], ['Rationale', 60], ['Evidence', 80], ['Decided by', 16], ['Decided at', 18], ['Origin', 12]
    ]);
    for (const b of bundles) {
      const ev = this.assessments.evaluate(b.assessment);
      for (const d of DOMAINS) {
        const st = ev.domains[d.id];
        for (const q of st.evaluation.questions) {
          const r = b.assessment.responses[q.id];
          if (!q.reached && !r?.answer) continue;
          const evidence = (r?.evidenceIds ?? []).map((id) => b.evidence.get(id)).filter(Boolean) as EvidenceItem[];
          as.addRow([
            b.study.label,
            b.result ? resultName(b.result) : '',
            b.assessment.reviewer,
            q.id,
            getQuestion(q.id)?.text ?? '',
            r?.answer ?? '',
            q.excluded ? 'No (not reached)' : q.reached ? 'Yes' : 'No',
            r?.rationale ?? '',
            [...evidence.map((e) => `"${e.quote}" [${checkSummary(e, b.docs)}]`), r?.legacyEvidence ? `Legacy note: ${r.legacyEvidence}` : ''].filter(Boolean).join('\n'),
            r?.decidedBy ?? '',
            r?.decidedAt ?? '',
            r?.origin ?? ''
          ]);
        }
      }
    }
    wrap(as);

    const vs = sheet('Verification', [['Study', 18], ['Result', 30], ['Assessment by', 16], ['Target', 9], ['Verdict', 16], ['Proposed', 10], ['Comment', 50], ['Checked by', 16], ['At', 18], ['Resolution', 12], ['Resolved by', 16], ['Resolution note', 40]]);
    for (const b of bundles) {
      for (const v of b.verifications) {
        vs.addRow([b.study.label, b.result ? resultName(b.result) : '', b.assessment.reviewer, v.target, v.verdict.replace('_', ' '), v.proposedAnswer, v.comment, v.reviewer, v.createdAt, v.resolution, v.resolvedBy ?? '', v.resolutionNote]);
      }
    }
    wrap(vs);

    const rs = sheet('Results', [['Study', 18], ['Citation', 40], ['#', 5], ['Outcome', 24], ['Time point', 14], ['Comparison', 24], ['Analysis', 24], ['Effect', 8], ['A1 Numerical result', 30], ['A2 Location', 24], ['A3 Outcome definition', 40], ['B1', 5], ['B2', 5], ['B3', 5], ['Important confounding factors', 40]]);
    const cs = sheet('Confounders', [['Study', 18], ['Factor', 26], ['List', 12], ['Variables', 30], ['Controlled', 10], ['Valid', 8], ['Unnecessary', 10], ['Condition', 9], ['Comments', 50]]);
    const es = sheet('Evidence', [['Study', 18], ['Theme', 18], ['Quotation / note', 70], ['Source check', 50], ['Questions', 16], ['Interpretation', 40], ['Origin', 12], ['Scope', 16], ['Added', 18]]);
    for (const s of studies) {
      const snap = s.revision?.snapshot;
      const results = snap?.results ?? s.results;
      for (const r of results) {
        rs.addRow([s.study.label, (snap?.data ?? s.study.data).citation, r.ordinal, r.outcome, r.timePoint, r.comparison, r.analysis, r.effect, r.numericalResult, r.location, r.outcomeDefinition, r.triage.answers.B1 ?? '', r.triage.answers.B2 ?? '', r.triage.answers.B3 ?? '', r.importantFactors.join('; ')]);
      }
      for (const c of (snap?.data ?? s.study.data).confounders) {
        cs.addRow([s.study.label, c.factor, c.list, c.variables, c.controlled, c.valid, c.unnecessary, c.unnecessaryCondition, c.comments]);
      }
      const docs = this.docsFor(s.study);
      for (const e of s.evidence) {
        const owner = e.assessmentId ? this.store.assessments.get(e.assessmentId)?.reviewer ?? 'assessment' : 'study';
        es.addRow([s.study.label, e.theme, e.kind === 'quote' ? e.quote : `[note] ${e.quote || e.interpretation}`, e.kind === 'quote' ? checkSummary(e, docs) : '', e.questionIds.join(', '), e.interpretation, e.origin, owner, e.createdAt]);
      }
    }
    wrap(rs);
    wrap(cs);
    wrap(es);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async assessmentXlsx(id: string, viewer: string): Promise<{ filename: string; bytes: Buffer }> {
    const a = this.requireVisible(id, viewer);
    const b = this.bundle(a);
    const used = new Set(Object.values(a.responses).flatMap((r) => r.evidenceIds));
    const bytes = await this.workbook([b], [{ study: b.study, results: b.result ? [b.result] : [], revision: { ...b.revision, snapshot: { ...b.revision.snapshot, results: b.result ? [b.result] : [] } }, evidence: [...b.evidence.values()].filter((e) => used.has(e.id)) }], `${b.study.label} · ${b.result ? resultName(b.result) : ''} · ${a.reviewer}`);
    return { filename: safeName(`ROBINS-I_${b.study.label}_${b.result?.outcome ?? 'result'}_${a.reviewer}.xlsx`), bytes };
  }

  async projectXlsx(projectId: string, viewer: string): Promise<{ filename: string; bytes: Buffer }> {
    const project = this.store.projects.require(projectId);
    const studies = this.store.studies.find({ project_id: projectId });
    const bundles: AssessmentBundle[] = [];
    const studyRows = [];
    for (const study of studies) {
      const visible = this.visibleAssessments(study.id, viewer);
      const visibleIds = new Set(visible.map((a) => a.id));
      bundles.push(...visible.map((a) => this.bundle(a)));
      studyRows.push({
        study,
        results: this.studies.results(study.id),
        revision: study.approvedRevisionId ? this.studies.revision(study.approvedRevisionId) : null,
        evidence: this.store.evidence.find({ study_id: study.id }).filter((e) => !e.assessmentId || visibleIds.has(e.assessmentId))
      });
    }
    const bytes = await this.workbook(bundles, studyRows, project.name);
    return { filename: safeName(`ROBINS-I_${project.name}_${new Date().toISOString().slice(0, 10)}.xlsx`), bytes };
  }

  // --- Printable report -------------------------------------------------------------------------------------------

  /** A self-contained, printable HTML report of one assessment with source references and decision history. */
  assessmentReport(id: string, viewer: string): string {
    const a = this.requireVisible(id, viewer);
    const b = this.bundle(a);
    const project = this.store.projects.require(a.projectId);
    const ev = this.assessments.evaluate(a);
    const snap = b.revision.snapshot;
    const r = b.result;
    const vByTarget = new Map<string, VerificationDecision[]>();
    // Inline notes show the standing decisions; superseded ones remain in the Excel/JSON exports and the decision log.
    for (const v of b.verifications.filter((x) => x.resolution !== 'superseded')) (vByTarget.get(v.target) ?? vByTarget.set(v.target, []).get(v.target)!).push(v);

    const evidenceHtml = (ids: string[]) =>
      ids
        .map((id) => b.evidence.get(id))
        .filter((e): e is EvidenceItem => !!e)
        .map(
          (e) =>
            `<li>${e.kind === 'quote' ? `<q>${esc(e.quote)}</q>` : `<em>Note:</em> ${esc(e.quote || e.interpretation)}`}<div class="src ${e.check.status}">${esc(e.kind === 'quote' ? checkSummary(e, b.docs) : 'Reviewer note (no quotation)')}</div>${e.interpretation && e.kind === 'quote' ? `<div class="interp">${esc(e.interpretation)}</div>` : ''}</li>`
        )
        .join('');
    const verificationHtml = (target: string) =>
      (vByTarget.get(target) ?? [])
        .map(
          (v) =>
            `<div class="verify ${v.verdict}"><strong>${esc(v.reviewer)}</strong> ${esc(v.verdict.replace('_', ' '))}${v.proposedAnswer ? ` → ${esc(v.proposedAnswer)}` : ''} · ${esc(fmt(v.createdAt))}${v.comment ? `: ${esc(v.comment)}` : ''}${v.resolution ? ` <span class="res">${esc(v.resolution)} by ${esc(v.resolvedBy)}${v.resolutionNote ? `: ${esc(v.resolutionNote)}` : ''}</span>` : ''}</div>`
        )
        .join('');

    const domainsHtml = DOMAINS.map((d) => {
      const st = ev.domains[d.id];
      const dec = a.domains[d.id];
      const rows = st.evaluation.questions
        .filter((q) => q.reached || a.responses[q.id]?.answer)
        .map((q) => {
          const resp = a.responses[q.id];
          const def = getQuestion(q.id);
          return `<tr class="${q.excluded ? 'excluded' : ''}">
            <td class="qid">${esc(q.id)}</td>
            <td><div class="qtext">${esc(def?.text ?? '')}</div>
              ${resp?.rationale ? `<div class="rationale">${esc(resp.rationale)}</div>` : ''}
              ${resp?.evidenceIds.length ? `<ul class="evidence">${evidenceHtml(resp.evidenceIds)}</ul>` : ''}
              ${resp?.legacyEvidence ? `<div class="legacy">Legacy evidence note (no source location): ${esc(resp.legacyEvidence)}</div>` : ''}
              ${q.excluded ? '<div class="note">Answered earlier but not reached on the current path; not used in scoring.</div>' : ''}
              ${verificationHtml(q.id)}
            </td>
            <td class="ans">${esc(resp?.answer || '—')}</td>
            <td class="who">${resp?.decidedBy ? `${esc(resp.decidedBy)}<br>${esc(fmt(resp.decidedAt))}${resp.origin === 'legacy_import' ? '<br><em>imported, unconfirmed</em>' : ''}` : ''}</td>
          </tr>`;
        })
        .join('');
      const override = dec?.final && dec.final !== st.evaluation.suggested;
      return `<section class="domain">
        <h3>${esc(d.title)}</h3>
        <div class="judgement">
          <span>Algorithm: <b>${esc(st.evaluation.suggested ?? 'incomplete')}</b></span>
          <span>Final: <b class="j ${esc(dec?.final ?? '')}">${esc(dec?.final ? judgementLabel(dec.final, d.id) : 'not confirmed')}</b></span>
          ${dec?.decidedBy ? `<span class="who">${esc(dec.decidedBy)} · ${esc(fmt(dec.decidedAt))}</span>` : ''}
        </div>
        ${override ? `<div class="override">Override justification: ${esc(dec!.reason)}</div>` : ''}
        ${st.evaluation.path.length ? `<div class="path">Path: ${esc(describePath(st.evaluation.path))}</div>` : ''}
        ${verificationHtml(d.id)}
        <table class="qs"><thead><tr><th>Q</th><th>Question, rationale and evidence</th><th>Answer</th><th>Decided</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="note">No questions answered.</td></tr>'}</tbody></table>
      </section>`;
    }).join('');

    const triageRows = (['B1', 'B2', 'B3'] as const)
      .map((q) => (r?.triage.answers[q] ? `<tr><td class="qid">${q}</td><td>${esc(getQuestion(q)?.text ?? '')}${r.triage.notes[q] ? `<div class="rationale">${esc(r.triage.notes[q])}</div>` : ''}</td><td class="ans">${esc(r.triage.answers[q])}</td></tr>` : ''))
      .join('');
    const cfRows = snap.data.confounders
      .map((c) => `<tr><td>${esc(c.factor)}${c.list === 'additional' ? ' <em>(additional)</em>' : ''}</td><td>${esc(c.variables)}</td><td>${esc(c.controlled)}</td><td>${esc(c.valid)}</td><td>${esc(c.unnecessary)}${c.unnecessaryCondition ? ` (${c.unnecessaryCondition})` : ''}</td><td>${esc(c.comments)}</td></tr>`)
      .join('');
    const log = decisionLog(this.store.revisionsFor('assessment', a.id))
      .map((e) => `<tr><td>${esc(fmt(e.at))}</td><td>${esc(e.actor)}</td><td>${esc(e.reason)}</td><td>${e.changes.map(esc).join('<br>')}</td></tr>`)
      .join('');
    const consensus = a.role === 'consensus' ? this.store.consensusItems.find({ assessment_id: a.id }) : [];
    const consensusHtml = consensus.length
      ? `<section><h2>Reconciliation</h2><table class="qs"><thead><tr><th>Item</th><th>Original answers</th><th>Consensus</th><th>Note</th></tr></thead><tbody>${consensus
          .map((c) => `<tr><td class="qid">${esc(c.target)}</td><td>${Object.entries(c.answers).map(([who, ans]) => `${esc(who)}: <b>${esc(ans || '—')}</b>`).join('<br>')}</td><td class="ans">${esc(c.final || 'open')}</td><td>${esc(c.note)}${c.resolvedBy ? `<div class="who">${esc(c.resolvedBy)} · ${esc(fmt(c.resolvedAt))}</div>` : ''}</td></tr>`)
          .join('')}</tbody></table></section>`
      : '';
    const problems = ev.problems.length && a.status === 'draft' ? `<div class="warn">Draft — ${ev.problems.length} item(s) still open before submission.</div>` : '';
    const legacy = isLegacyRevision(b.revision) ? '<div class="warn">Study details imported from a legacy file and not yet reviewed.</div>' : '';

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ROBINS-I V2 · ${esc(b.study.label)} · ${esc(r ? resultName(r) : '')}</title>
<style>
  :root { --ink:#1b2430; --muted:#5d6b7c; --line:#d9dee5; --soft:#f4f6f9; --low:#1e7d4f; --mod:#a16207; --ser:#c2410c; --crit:#b91c1c; }
  * { box-sizing: border-box; }
  body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: #fff; margin: 0; padding: 24px 32px; max-width: 1100px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  .sub { color: var(--muted); margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid var(--line); padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: var(--soft); font-weight: 600; }
  table.meta th { width: 190px; }
  .summary td, .summary th { text-align: center; } .summary td:first-child, .summary th:first-child { text-align: left; }
  .j.Low { color: var(--low); } .j.Moderate { color: var(--mod); } .j.Serious { color: var(--ser); } .j.Critical { color: var(--crit); }
  section.domain { margin: 18px 0; page-break-inside: auto; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
  .judgement { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 4px; }
  .override, .path { color: var(--muted); margin-bottom: 6px; } .override { color: var(--ser); }
  td.qid { white-space: nowrap; font-weight: 600; width: 52px; } td.ans { font-weight: 700; width: 64px; text-align: center; } td.who { width: 140px; color: var(--muted); font-size: 12px; }
  .qtext { font-weight: 500; } .rationale { margin-top: 4px; white-space: pre-wrap; }
  ul.evidence { margin: 6px 0 0; padding-left: 18px; } ul.evidence li { margin-bottom: 4px; }
  q { font-style: italic; } q::before { content: '“'; } q::after { content: '”'; }
  .src { font-size: 11.5px; color: var(--muted); } .src.unmatched, .src.ambiguous, .src.incomplete_extraction, .src.needs_recheck { color: var(--crit); }
  .interp { font-size: 12px; } .legacy, .note { font-size: 12px; color: var(--muted); font-style: italic; margin-top: 4px; }
  tr.excluded td { color: #8a95a3; }
  .verify { font-size: 12px; margin-top: 4px; padding: 3px 6px; border-left: 3px solid var(--line); background: var(--soft); } .verify.change_requested, .verify.disagree { border-color: var(--ser); } .verify.confirmed { border-color: var(--low); }
  .warn { background: #fff4e5; border: 1px solid #f5c27a; padding: 6px 10px; border-radius: 4px; margin: 8px 0; }
  .toolbar { position: sticky; top: 0; background: #fff; padding: 8px 0; margin-bottom: 8px; border-bottom: 1px solid var(--line); display: flex; gap: 8px; }
  button { font: inherit; padding: 5px 12px; border: 1px solid var(--line); border-radius: 4px; background: var(--soft); cursor: pointer; }
  footer { margin-top: 28px; color: var(--muted); font-size: 11.5px; border-top: 1px solid var(--line); padding-top: 8px; }
  @media print { body { padding: 0; max-width: none; } .toolbar { display: none; } section.domain { border: none; padding: 0; } h2 { page-break-after: avoid; } tr { page-break-inside: avoid; } }
  @page { size: A4; margin: 14mm; }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print / save as PDF</button></div>
<h1>ROBINS-I V2 risk of bias assessment</h1>
<div class="sub">${esc(project.name)} · ${esc(b.study.label)} · ${esc(r ? resultName(r) : a.resultId)}</div>
${legacy}${problems}
<table class="meta">
  <tr><th>Study</th><td>${esc(snap.data.citation || b.study.label)}</td></tr>
  <tr><th>Result</th><td>${esc(r ? resultName(r) : '')}${r?.comparison ? ` — ${esc(r.comparison)}` : ''} (${esc(r?.effect ?? '')} effect)</td></tr>
  <tr><th>A1 Numerical result</th><td>${esc(r?.numericalResult)}</td></tr>
  <tr><th>A2 Location</th><td>${esc(r?.location)}</td></tr>
  <tr><th>A3 Outcome definition</th><td>${esc(r?.outcomeDefinition)}</td></tr>
  <tr><th>Target trial</th><td><b>Participants:</b> ${esc(snap.data.targetTrial.c1)}<br><b>Intervention:</b> ${esc(snap.data.targetTrial.c2)} ${snap.data.targetTrial.c2Type ? `(${esc(snap.data.targetTrial.c2Type)})` : ''}<br><b>Comparator:</b> ${esc(snap.data.targetTrial.c3)} ${snap.data.targetTrial.c3Type ? `(${esc(snap.data.targetTrial.c3Type)})` : ''}</td></tr>
  <tr><th>Reviewer</th><td>${esc(a.reviewer)} (${esc(a.role === 'consensus' ? 'consensus record' : `${a.role} reviewer`)}) · status <b>${esc(a.status)}</b>${a.submittedAt ? ` · submitted ${esc(fmt(a.submittedAt))}` : ''}${a.finalizedAt ? ` · finalized ${esc(fmt(a.finalizedAt))}` : ''}</td></tr>
  <tr><th>Study revision</th><td>#${b.revision.revisionNo} approved by ${esc(b.revision.approvedBy)} · ${esc(fmt(b.revision.approvedAt))} · <span style="font-family:monospace">${esc(b.revision.hash.slice(0, 12))}</span></td></tr>
  <tr><th>Rules</th><td>${esc(a.rulesetVersion)}${a.rulesetVersion !== RULESET_VERSION ? ` (re-evaluated with ${esc(RULESET_VERSION)})` : ''} · verification mode: ${esc(project.verificationMode)}</td></tr>
</table>

<h2>Summary</h2>
<table class="summary"><thead><tr><th></th>${DOMAINS.map((d) => `<th>${d.id}<br><span style="font-weight:400">${esc(d.short)}</span></th>`).join('')}<th>Overall</th></tr></thead>
<tbody><tr><td>Algorithm</td>${DOMAINS.map((d) => `<td>${esc(ev.domains[d.id].evaluation.suggested ?? '—')}</td>`).join('')}<td>${esc(ev.overall.suggested ?? '—')}</td></tr>
<tr><td>Final</td>${DOMAINS.map((d) => `<td class="j ${esc(a.domains[d.id]?.final ?? '')}"><b>${esc(a.domains[d.id]?.final || '—')}</b></td>`).join('')}<td class="j ${esc(a.overall.final)}"><b>${esc(a.overall.final || '—')}</b></td></tr></tbody></table>
${a.overall.final && a.overall.final !== ev.overall.suggested ? `<div class="override">Overall escalation justification: ${esc(a.overall.reason)}</div>` : ''}
${verificationHtml('overall')}

<h2>Section B: triage</h2>
<table class="qs"><tbody>${triageRows || '<tr><td class="note">Not recorded.</td></tr>'}</tbody></table>
${ev.triageCritical ? `<div class="warn">Critical at triage: ${esc(ev.triage.reason ?? '')}</div>` : ''}

<h2>Confounding factors (Study session)</h2>
<table><thead><tr><th>Factor</th><th>Variables</th><th>Controlled</th><th>Valid</th><th>Control unnecessary</th><th>Comments</th></tr></thead><tbody>${cfRows || '<tr><td colspan="6" class="note">None recorded.</td></tr>'}</tbody></table>

<h2>Domains</h2>
${domainsHtml}
${consensusHtml}

<h2>Decision history</h2>
<table><thead><tr><th>When</th><th>Who</th><th>Event</th><th>Changes</th></tr></thead><tbody>${log}</tbody></table>

<footer>Generated ${esc(fmt(new Date().toISOString()))} by ROBer COP ${esc(this.config.appVersion)} for ${esc(viewer || 'unnamed viewer')}. Reviewer names are local attribution, not authenticated signatures. Quotation checks compare quotes with the parsed source text; "manually checked" records a reviewer's own confirmation.</footer>
</body></html>`;
  }
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120);
}
