import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { DOMAIN_IDS, isAllowedAnswer, RULESET_VERSION, type Answer, type DomainId, type Judgement } from '@robercop/rules';
import { LEGACY_APPROVER, emptyDecision, emptyResponse, emptyStudyData, type Assessment, type QuestionResponse, type ResultSpec, type StudyData } from '@robercop/shared';
import { contentHash } from '@robercop/shared/node';
import { ValidationError, newId, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { AppConfig } from '../config.js';
import { blankAssessment } from './assessments.js';
import { matchOutcome } from './projects.js';
import { newConfounder, type StudyService } from './studies.js';

/** Normalized content of a legacy session file (JSON or Excel export from the earlier HTML tool). */
export interface LegacyBundle {
  source: 'json-study' | 'json-domain' | 'xlsx' | 'xlsx-evidence-bank';
  projectCode: string;
  citation: string;
  reviewer: string;
  date: string;
  outcomes: {
    name: string;
    a1: string;
    a2: string;
    a3: string;
    triage: Partial<Record<'B1' | 'B2' | 'B3', string>>;
    triageNotes: Partial<Record<'B1' | 'B2' | 'B3', string>>;
    importantFactors: string[];
  }[];
  prelim: { c1: string; c2: string; c2type: string; c3: string; c3type: string; c4: string; sources: string };
  confounders: { factor: string; variable: string; controlled: string; valid: string; unnecessary: string; page: string; notes: string }[];
  domain: {
    outcomeName: string;
    answers: Record<string, string>;
    evidence: Record<string, string>;
    judgements: Partial<Record<DomainId, { final: string; override: string; reason: string }>>;
    overall: { final: string; override: string; reason: string };
  } | null;
  evidenceBank: { theme: string; quote: string; page: string; questions: string[]; summary: string }[];
}

export interface LegacyPreview {
  token: string;
  source: LegacyBundle['source'];
  summary: {
    citation: string;
    reviewer: string;
    date: string;
    outcomes: string[];
    confounders: number;
    answers: number;
    judgements: string[];
    evidenceBank: number;
  };
  study: { mode: 'new' | 'existing'; id: string | null; label: string };
  willCreate: string[];
  warnings: string[];
}

const S = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const Q_RE = /^Q?(\d)[._](\d{1,2})$/i;

function qid(key: string): string | null {
  const m = key.trim().match(Q_RE);
  return m ? `Q${m[1]}.${m[2]}` : null;
}

function judgement(v: string): Judgement | '' {
  const j = v.trim().toLowerCase();
  if (j.startsWith('low')) return 'Low';
  if (j.startsWith('mod')) return 'Moderate';
  if (j.startsWith('ser')) return 'Serious';
  if (j.startsWith('crit')) return 'Critical';
  return '';
}

/** Parses the JSON saved by the earlier HTML tool (Study session or Domain session). */
export function parseLegacyJson(raw: unknown): LegacyBundle {
  const st = raw as Record<string, any>;
  if (!st || typeof st !== 'object' || !st.setup) throw new ValidationError('This JSON is not a saved session from the earlier ROBINS-I tool (no "setup" section).');
  const outcomes = (Array.isArray(st.outcomesData) && st.outcomesData.length ? st.outcomesData : (st.setup.outcomes ?? []).filter(Boolean).map((name: string) => ({ name }))).map((o: any) => ({
    name: S(o.name),
    a1: S(o.a1),
    a2: S(o.a2),
    a3: S(o.a3),
    triage: { B1: S(o.b1), B2: S(o.b2), B3: S(o.b3) },
    triageNotes: { B1: S(o.b1_ev), B2: S(o.b2_ev), B3: S(o.b3_ev) },
    importantFactors: Array.isArray(o.importantCFs) ? o.importantCFs.map(S) : []
  }));
  const isDomain = st.mode === 'domain' || (st.domains && Object.values(st.domains as Record<string, Record<string, unknown>>).some((d) => Object.entries(d).some(([k, v]) => k.startsWith('q') && v)));
  let domain: LegacyBundle['domain'] = null;
  if (isDomain && st.domains) {
    const answers: Record<string, string> = {};
    const evidence: Record<string, string> = {};
    const judgements: NonNullable<LegacyBundle['domain']>['judgements'] = {};
    for (const [dk, d] of Object.entries(st.domains as Record<string, Record<string, any>>)) {
      const dom = `D${dk.replace(/\D/g, '')}` as DomainId;
      for (const [k, v] of Object.entries(d)) {
        const q = qid(k);
        if (q && v) answers[q] = S(v);
      }
      for (const [k, v] of Object.entries((d.evidence ?? {}) as Record<string, unknown>)) {
        const q = qid(k.replace(/_ev$/, ''));
        if (q && S(v)) evidence[q] = S(v);
      }
      if (DOMAIN_IDS.includes(dom)) judgements[dom] = { final: S(d.override) || S(d.judgement), override: S(d.override), reason: S(d.overrideJust) };
    }
    domain = {
      outcomeName: S(st.domainSetup?.outcomeName) || outcomes[0]?.name || '',
      answers,
      evidence,
      judgements,
      overall: { final: S(st.overall?.override) || S(st.overall?.judgement), override: S(st.overall?.override), reason: S(st.overall?.overrideJust) }
    };
  }
  return {
    source: domain ? 'json-domain' : 'json-study',
    projectCode: S(st.setup.projectId),
    citation: S(st.setup.studyCitation),
    reviewer: S(st.setup.reviewer),
    date: S(st.setup.date),
    outcomes,
    prelim: { c1: S(st.prelim?.c1), c2: S(st.prelim?.c2), c2type: S(st.prelim?.c2type), c3: S(st.prelim?.c3), c3type: S(st.prelim?.c3type), c4: S(st.prelim?.c4), sources: S(st.prelim?.d_sources) },
    confounders: (st.cfEval ?? []).map((r: any) => ({ factor: S(r.factor), variable: S(r.variable), controlled: S(r.controlled), valid: S(r.valid), unnecessary: S(r.unnecessary), page: S(r.page), notes: S(r.notes) })).filter((r: { factor: string }) => r.factor),
    domain,
    evidenceBank: (st.evidenceBank ?? []).map((e: any) => ({ theme: S(e.theme), quote: S(e.quote), page: S(e.page), questions: (e.relevantSQs ?? []).map(S), summary: S(e.summary) })).filter((e: { quote: string }) => e.quote)
  };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return S(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

function rows(ws: ExcelJS.Worksheet | undefined): string[][] {
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => (vals[col - 1] = cellText(cell.value).trim()));
    out.push(vals.map((x) => x ?? ''));
  });
  return out;
}

/** Parses the Excel exports of the earlier tool (standard and Evidence Bank editions). */
export async function parseLegacyXlsx(bytes: Uint8Array): Promise<LegacyBundle> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError('Could not read this Excel file.');
  }
  const summary = rows(wb.getWorksheet('Summary'));
  if (summary.length === 0) throw new ValidationError('This workbook has no "Summary" sheet; it does not look like an export from the earlier ROBINS-I tool.');
  const kv = (label: string) => summary.find((r) => r[0] === label)?.[1] ?? '';
  const bundle: LegacyBundle = {
    source: wb.getWorksheet('Evidence Bank') ? 'xlsx-evidence-bank' : 'xlsx',
    projectCode: kv('Project ID'),
    citation: kv('Study'),
    reviewer: kv('Reviewer'),
    date: kv('Date'),
    outcomes: [],
    prelim: { c1: kv('C1: Participants'), c2: kv('C2: Intervention'), c2type: '', c3: kv('C3: Comparator'), c3type: '', c4: '', sources: '' },
    confounders: [],
    domain: null,
    evidenceBank: []
  };
  let cur: LegacyBundle['outcomes'][number] | null = null;
  for (const r of summary) {
    const m = r[0]?.match(/^Outcome \d+:\s*(.*)$/);
    if (m) {
      cur = { name: m[1].trim(), a1: '', a2: '', a3: '', triage: {}, triageNotes: {}, importantFactors: [] };
      bundle.outcomes.push(cur);
      continue;
    }
    if (!cur) continue;
    if (r[0] === 'A1: Result') cur.a1 = r[1] ?? '';
    else if (r[0] === 'A2: Location') cur.a2 = r[1] ?? '';
    else if (r[0] === 'A3: Outcome Definition') cur.a3 = r[1] ?? '';
    else if (['B1', 'B2', 'B3'].includes(r[0])) cur.triage[r[0] as 'B1'] = r[1] ?? '';
    else if (r[0] === 'TARGET TRIAL') cur = null;
  }
  for (const r of rows(wb.getWorksheet('CF Evaluation')).slice(1)) {
    if (!r[0]) continue;
    bundle.confounders.push({ factor: r[0], variable: r[1] ?? '', controlled: r[2] ?? '', valid: r[3] ?? '', unnecessary: r[4] ?? '', page: r[5] ?? '', notes: r[6] ?? '' });
  }
  const answers: Record<string, string> = {};
  const evidence: Record<string, string> = {};
  for (const r of rows(wb.getWorksheet('Evidence')).slice(1)) {
    const q = qid(r[0] ?? '');
    if (!q) continue;
    if (r[1]) answers[q] = r[1];
    if (r[2]) evidence[q] = r[2];
  }
  const judgements: NonNullable<LegacyBundle['domain']>['judgements'] = {};
  for (const d of DOMAIN_IDS) {
    const v = kv(d);
    if (v) judgements[d] = { final: v, override: '', reason: '' };
  }
  const overall = kv('OVERALL');
  if (Object.keys(answers).length || Object.keys(judgements).length) {
    const outcomeName = kv('Outcome').split(';')[0].trim();
    bundle.domain = { outcomeName: outcomeName || bundle.outcomes[0]?.name || '', answers, evidence, judgements, overall: { final: overall, override: '', reason: '' } };
  }
  for (const r of rows(wb.getWorksheet('Evidence Bank')).slice(1)) {
    if (!r[1]) continue;
    bundle.evidenceBank.push({ theme: r[0] ?? '', quote: r[1], page: r[2] ?? '', questions: (r[3] ?? '').split(/[,;\s]+/).filter(Boolean), summary: r[4] ?? '' });
  }
  return bundle;
}

export class LegacyService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly studies: StudyService
  ) {}

  async preview(projectId: string, filename: string, bytes: Uint8Array, targetStudyId: string | null): Promise<LegacyPreview> {
    const project = this.store.projects.require(projectId);
    let bundle: LegacyBundle;
    if (/\.xlsx$/i.test(filename)) bundle = await parseLegacyXlsx(bytes);
    else {
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch {
        throw new ValidationError('Could not read this file as JSON.');
      }
      bundle = parseLegacyJson(raw);
    }
    const token = newId();
    writeFileSync(join(this.config.tmpDir, `legacy-${token}.json`), JSON.stringify(bundle));
    const warnings: string[] = [];
    const target = targetStudyId ? this.store.studies.require(targetStudyId) : null;
    if (target && target.projectId !== project.id) throw new ValidationError('That study belongs to another project.');
    if (!bundle.citation) warnings.push('No study citation in the file; the study label will need editing.');
    if (!bundle.reviewer) warnings.push('No reviewer name in the file; imported decisions will be attributed to "unknown reviewer (legacy)".');
    if (!bundle.date) warnings.push('No assessment date in the file.');
    if (bundle.source.startsWith('xlsx')) warnings.push('Excel exports do not contain intervention/comparator types or rationale text beyond the evidence column; those fields stay empty.');
    if (bundle.domain) {
      const bad = Object.entries(bundle.domain.answers).filter(([q, a]) => !isAllowedAnswer(q, a) && a !== 'NA');
      if (bad.length) warnings.push(`Some answers are not valid options and will be kept only as notes: ${bad.map(([q, a]) => `${q}=${a}`).join(', ')}.`);
      if (!bundle.outcomes.some((o) => o.name === bundle.domain!.outcomeName) && !target) warnings.push(`The assessed outcome "${bundle.domain.outcomeName}" is not among the listed outcomes; it will be added as a result.`);
    }
    const evidenceCount = Object.keys(bundle.domain?.evidence ?? {}).length;
    if (evidenceCount) warnings.push(`${evidenceCount} free-text evidence notes have no source location; they are kept with each answer as unverified legacy evidence.`);
    if (bundle.evidenceBank.length) warnings.push(`${bundle.evidenceBank.length} evidence-bank quotations will be imported and checked once the study PDF is attached and parsed.`);
    const willCreate: string[] = [];
    if (!target) willCreate.push(`A new study "${shortLabel(bundle.citation)}" with its target trial, sources and confounder evaluation`);
    else willCreate.push(`Merge into the existing study "${target.label}" (empty fields are filled; existing content is kept)`);
    if (bundle.outcomes.length) willCreate.push(`${bundle.outcomes.length} result(s) with A1–A3 and triage: ${bundle.outcomes.map((o) => o.name).join(', ')}`);
    if (bundle.domain) {
      willCreate.push(
        `An imported assessment of "${bundle.domain.outcomeName}" with ${Object.keys(bundle.domain.answers).length} answers and ${Object.values(bundle.domain.judgements).filter((j) => j?.final).length} domain judgements. Every imported answer and judgement must be confirmed by a reviewer before submission; nothing is marked as verified.`
      );
    }
    void project;
    return {
      token,
      source: bundle.source,
      summary: {
        citation: bundle.citation,
        reviewer: bundle.reviewer,
        date: bundle.date,
        outcomes: bundle.outcomes.map((o) => o.name),
        confounders: bundle.confounders.length,
        answers: Object.keys(bundle.domain?.answers ?? {}).length,
        judgements: Object.entries(bundle.domain?.judgements ?? {}).map(([d, j]) => `${d}: ${j?.final || '—'}`),
        evidenceBank: bundle.evidenceBank.length
      },
      study: target ? { mode: 'existing', id: target.id, label: target.label } : { mode: 'new', id: null, label: shortLabel(bundle.citation) },
      willCreate,
      warnings
    };
  }

  /** Creates (or merges into) a study and, for Domain sessions, an imported assessment awaiting reconfirmation. */
  commit(projectId: string, token: string, opts: { targetStudyId?: string | null; reviewer?: string }, actor: string): { studyId: string; assessmentId: string | null; notes: string[] } {
    const path = join(this.config.tmpDir, `legacy-${token}.json`);
    if (!existsSync(path)) throw new ValidationError('The preview expired; choose the file again.');
    const b = JSON.parse(readFileSync(path, 'utf8')) as LegacyBundle;
    const project = this.store.projects.require(projectId);
    const notes: string[] = [];
    const reviewer = opts.reviewer?.trim() || b.reviewer || 'unknown reviewer (legacy)';
    const meta = { actor, reason: `legacy import (${b.source})` };

    return this.store.db.tx(() => {
      let study = opts.targetStudyId ? this.store.studies.require(opts.targetStudyId) : null;
      const data: StudyData = study ? structuredClone(study.data) : emptyStudyData();
      const fill = (cur: string, v: string) => cur || v;
      data.citation = fill(data.citation, b.citation);
      data.targetTrial.c1 = fill(data.targetTrial.c1, b.prelim.c1);
      data.targetTrial.c2 = fill(data.targetTrial.c2, b.prelim.c2);
      data.targetTrial.c3 = fill(data.targetTrial.c3, b.prelim.c3);
      if (!data.targetTrial.c2Type && ['Point', 'Sustained'].includes(b.prelim.c2type)) data.targetTrial.c2Type = b.prelim.c2type as 'Point';
      if (!data.targetTrial.c3Type && ['Alternative intervention', 'Standard care', 'No intervention'].includes(b.prelim.c3type)) data.targetTrial.c3Type = b.prelim.c3type as 'Standard care';
      if (b.prelim.c4 === 'Yes' && data.targetTrial.c4 !== 'Yes') {
        data.targetTrial.c4 = 'Yes';
        notes.push('The legacy file recorded C4 = Yes (per-protocol); its results are marked unsupported in this release.');
      }
      if (b.prelim.sources && !data.sources.other.includes(b.prelim.sources)) data.sources.other = [data.sources.other, b.prelim.sources].filter(Boolean).join('\n');
      for (const c of b.confounders) {
        if (data.confounders.some((x) => x.factor.toLowerCase() === c.factor.toLowerCase())) continue;
        const row = newConfounder(c.factor, project.cfMatrix && Object.values(project.cfMatrix).some((l) => l.includes(c.factor)) ? 'prespecified' : 'additional');
        row.variables = c.variable;
        row.controlled = c.controlled === 'Y' || c.controlled === 'N' ? c.controlled : '';
        row.valid = (['NA', 'Y', 'PY', 'PN', 'N', 'NI'].includes(c.valid) ? c.valid : '') as typeof row.valid;
        row.unnecessary = (['NA', 'Y', 'PY', 'PN', 'N'].includes(c.unnecessary) ? c.unnecessary : '') as typeof row.unnecessary;
        row.comments = [c.notes, c.page ? `p. ${c.page}` : ''].filter(Boolean).join(' · ');
        data.confounders.push(row);
      }
      if (!study) {
        study = this.store.studies.insert(
          { id: newId(), projectId, label: shortLabel(b.citation), data, status: 'draft', approvedRevisionId: null, createdAt: '', updatedAt: '', version: 0 },
          meta
        );
        notes.push(`Created study "${study.label}".`);
      } else {
        study = this.store.studies.update({ ...study, data }, meta);
        notes.push(`Merged into study "${study.label}".`);
      }

      const existing = this.store.results.find({ study_id: study.id }, 'ordinal');
      const byName = new Map(existing.map((r) => [r.outcome.toLowerCase(), r]));
      let ordinal = existing.length ? Math.max(...existing.map((r) => r.ordinal)) : 0;
      const outcomes = [...b.outcomes];
      if (b.domain && !outcomes.some((o) => o.name.toLowerCase() === b.domain!.outcomeName.toLowerCase())) {
        outcomes.push({ name: b.domain.outcomeName, a1: '', a2: '', a3: '', triage: {}, triageNotes: {}, importantFactors: [] });
      }
      for (const o of outcomes) {
        if (byName.has(o.name.toLowerCase())) continue;
        const domainKey = matchOutcome(project.cfMatrix, o.name)[0] ?? '';
        const triageAnswers = Object.fromEntries(Object.entries(o.triage).filter(([, v]) => ['Y', 'PY', 'PN', 'N'].includes(v ?? ''))) as ResultSpec['triage']['answers'];
        const r: ResultSpec = {
          id: newId(),
          studyId: study.id,
          ordinal: ++ordinal,
          outcomeDomain: domainKey,
          outcome: o.name,
          timePoint: '',
          comparison: '',
          analysis: '',
          effect: 'ITT',
          numericalResult: o.a1,
          location: o.a2,
          outcomeDefinition: o.a3,
          importantFactors: o.importantFactors.length ? o.importantFactors : domainKey ? [...(project.cfMatrix[domainKey] ?? [])] : [],
          triage: { answers: triageAnswers, notes: o.triageNotes, evidenceIds: {} },
          evidenceIds: [],
          createdAt: '',
          updatedAt: '',
          version: 0
        };
        byName.set(o.name.toLowerCase(), this.store.results.insert(r, meta));
      }

      for (const e of b.evidenceBank) {
        const page = parseInt(e.page.replace(/[^\d]/g, ''), 10);
        this.store.evidence.insert(
          {
            id: newId(),
            studyId: study.id,
            assessmentId: null,
            documentId: null,
            kind: 'quote',
            quote: e.quote,
            page: Number.isFinite(page) ? page : null,
            section: '',
            theme: e.theme,
            questionIds: e.questions.map((q) => qid(q) ?? q).filter(Boolean),
            interpretation: e.summary,
            origin: 'legacy_import',
            proposalId: null,
            runId: null,
            check: { status: 'not_checked', locations: [], candidates: [], parseJobIds: [], notes: ['Imported from a legacy evidence bank; checked once sources are parsed.'] },
            acceptedBy: null,
            acceptedAt: null,
            createdAt: '',
            updatedAt: '',
            version: 0
          },
          meta
        );
      }

      let assessmentId: string | null = null;
      if (b.domain) {
        // Domain sessions need a study revision. A legacy revision records the imported content without a human
        // approval; new Domain sessions still require a real approval.
        const snapshot = this.studies.snapshot(study);
        const prev = this.studies.latestRevision(study.id);
        const rev = this.store.studyRevisions.insert(
          { id: newId(), studyId: study.id, revisionNo: (prev?.revisionNo ?? 0) + 1, snapshot, hash: contentHash(snapshot), approvedBy: LEGACY_APPROVER, approvedAt: now(), note: `Imported from a legacy ${b.source} file; not reviewed.`, version: 0 },
          meta
        );
        const result = byName.get(b.domain.outcomeName.toLowerCase())!;
        const a: Assessment = blankAssessment({ projectId, studyId: study.id, resultId: result.id, studyRevisionId: rev.id, reviewer, role: 'first' });
        const decidedAt = b.date ? new Date(b.date).toISOString() : now();
        for (const [q, ans] of Object.entries(b.domain.answers)) {
          const r: QuestionResponse = { ...emptyResponse(), origin: 'legacy_import', decidedBy: reviewer, decidedAt };
          if (isAllowedAnswer(q, ans)) r.answer = ans as Answer;
          else if (ans !== 'NA') r.rationale = `Legacy answer "${ans}" is not a valid option for this question.`;
          if (b.domain.evidence[q]) r.legacyEvidence = b.domain.evidence[q];
          a.responses[q] = r;
        }
        for (const q of Object.keys(b.domain.evidence)) {
          if (!a.responses[q]) a.responses[q] = { ...emptyResponse(), origin: 'legacy_import', legacyEvidence: b.domain.evidence[q] };
        }
        for (const [d, j] of Object.entries(b.domain.judgements) as [DomainId, { final: string; override: string; reason: string }][]) {
          const f = judgement(j.final);
          if (f) a.domains[d] = { ...emptyDecision(RULESET_VERSION), final: f, reason: j.reason, origin: 'legacy_import', decidedBy: reviewer, decidedAt };
        }
        const of = judgement(b.domain.overall.final);
        if (of) a.overall = { ...emptyDecision(RULESET_VERSION), final: of, reason: b.domain.overall.reason, origin: 'legacy_import', decidedBy: reviewer, decidedAt };
        assessmentId = this.store.assessments.insert(a, meta).id;
        notes.push(`Imported ${reviewer}'s assessment of "${result.outcome}" for reconfirmation.`);
      }
      return { studyId: study.id, assessmentId, notes };
    });
  }
}

function shortLabel(citation: string): string {
  if (!citation) return 'Imported study';
  const m = citation.match(/^([A-Z][\p{L}'-]+).*?((?:19|20)\d{2})/u);
  return m ? `${m[1]} ${m[2]}` : citation.slice(0, 40);
}
