import { getDomain, getQuestion, type DomainId } from '@robercop/rules';
import type { AiTask, Assessment, ConfounderRow, EvidenceItem, ResultSpec, StudySnapshot } from '@robercop/shared';
import { ValidationError } from '../db/database.js';
import type { SourceBundle } from '../services/documents.js';
import { domainBrief, questionBrief, TASK_LABELS } from './prompts.js';

export interface TaskScope {
  questionIds?: string[];
  domain?: DomainId;
  evidenceIds?: string[];
  message?: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
  includeSuggestions?: boolean;
  factors?: string[];
  resultId?: string;
}

export interface TaskContext {
  task: AiTask;
  scope: TaskScope;
  studyLabel: string;
  snapshot: StudySnapshot;
  /** Fixed context identity the run is bound to. */
  contextRevision: string;
  result?: ResultSpec;
  assessment?: Assessment;
  evidence: EvidenceItem[];
  bundle: SourceBundle;
  markdown: { documentId: string; label: string; role: string; text: string }[];
}

function confoundersFor(snapshot: StudySnapshot, result?: ResultSpec): ConfounderRow[] {
  if (!result) return snapshot.data.confounders;
  const wanted = new Set(result.importantFactors.map((f) => f.toLowerCase()));
  return snapshot.data.confounders.filter((c) => wanted.has(c.factor.toLowerCase()) || c.list === 'additional');
}

function studyContext(ctx: TaskContext): string {
  const tt = ctx.snapshot.data.targetTrial;
  const lines = [
    `Study: ${ctx.studyLabel}${ctx.snapshot.data.citation ? ` — ${ctx.snapshot.data.citation}` : ''}`,
    `C1 participants: ${tt.c1 || '(not yet specified)'}`,
    `C2 intervention: ${tt.c2 || '(not yet specified)'}${tt.c2Type ? ` [${tt.c2Type}]` : ''}`,
    `C3 comparator: ${tt.c3 || '(not yet specified)'}${tt.c3Type ? ` [${tt.c3Type}]` : ''}`,
    `C4: ${tt.c4 === 'No' ? 'No (intention-to-treat effect; Domain 1 Variant A)' : 'Yes (per-protocol; not supported)'}`
  ];
  if (ctx.result) {
    const r = ctx.result;
    lines.push(
      '',
      'RESULT BEING ASSESSED',
      `Outcome: ${r.outcome}${r.timePoint ? ` at ${r.timePoint}` : ''}`,
      `Comparison: ${r.comparison || '(as in the target trial)'}`,
      `Analysis: ${r.analysis || '(not specified)'}`,
      `A1 numerical result: ${r.numericalResult}`,
      `A2 location/details: ${r.location}`,
      `A3 outcome definition: ${r.outcomeDefinition}`,
      `Important confounding factors for this outcome: ${r.importantFactors.join(', ') || '(none listed)'}`
    );
  } else if (ctx.snapshot.results.length) {
    lines.push('', 'RESULTS LISTED SO FAR');
    for (const r of ctx.snapshot.results) lines.push(`- ${r.outcome}${r.timePoint ? ` (${r.timePoint})` : ''}: ${r.numericalResult || '(A1 not yet given)'}`);
  }
  const cfs = confoundersFor(ctx.snapshot, ctx.result);
  if (cfs.length) {
    lines.push('', 'CONFOUNDING-FACTOR EVALUATION (from the Study session)');
    lines.push('| Factor | Measured variable(s) | Controlled | Valid/reliable | Control unnecessary | Comments |', '|---|---|---|---|---|---|');
    for (const c of cfs) {
      lines.push(`| ${c.factor} | ${c.variables || '-'} | ${c.controlled || '-'} | ${c.valid || '-'} | ${c.unnecessary || '-'}${c.unnecessaryCondition ? ` (${c.unnecessaryCondition})` : ''} | ${c.comments || ''} |`);
    }
  }
  return lines.join('\n');
}

function evidenceText(items: EvidenceItem[]): string {
  return items
    .map((e, i) => `[E${i + 1}] ${e.kind === 'quote' ? `"${e.quote}"` : `Note: ${e.interpretation}`} (${e.page ? `p.${e.page}` : 'no page'}; source check: ${e.check.status})${e.kind === 'quote' && e.interpretation ? `\n     Interpretation: ${e.interpretation}` : ''}`)
    .join('\n');
}

function sources(ctx: TaskContext): string {
  if (ctx.markdown.length === 0) return '<sources>\nNo parsed sources are available. Say so and do not invent content.\n</sources>';
  return [
    '<sources>',
    ...ctx.markdown.map((d) => `<document id="${d.documentId}" label="${d.label.replace(/"/g, "'")}" role="${d.role}">\n${d.text}\n</document>`),
    '</sources>',
    ctx.bundle.warnings.length ? `Extraction warnings: ${ctx.bundle.warnings.join(' ')}` : ''
  ].join('\n');
}

function requireQuestion(scope: TaskScope): string {
  const qid = scope.questionIds?.[0];
  if (!qid || !getQuestion(qid)) throw new ValidationError('Choose a signalling question first.');
  return qid;
}

/** Builds the task instructions. The reviewer's own answers are included only where the task needs them. */
export function buildPrompt(ctx: TaskContext): string {
  const s = ctx.scope;
  const parts: string[] = [`TASK: ${TASK_LABELS[ctx.task]}`];
  switch (ctx.task) {
    case 'find_evidence': {
      const qids = s.questionIds?.length ? s.questionIds : [];
      parts.push(
        qids.length
          ? `Find verbatim evidence relevant to these questions:\n\n${qids.map(questionBrief).join('\n\n')}`
          : 'Build an evidence bank for this study: extract verbatim quotations covering design, participants, intervention, comparator, outcome measurement, follow-up/attrition, confounding control, statistical analysis, missing data and reporting (protocol/registration). Tag each with the signalling question ids it could inform (e.g. Q1.1, Q2.4, Q4.2). Aim for 20–40 items.',
        'Return quotations exactly as written. For each question with no relevant text, add a notFound entry listing what you searched for.'
      );
      break;
    }
    case 'prepare_domain': {
      if (!s.domain) throw new ValidationError('Choose a domain.');
      const d = getDomain(s.domain);
      parts.push(
        domainBrief(s.domain),
        `For EACH signalling question below (including conditional ones, so evidence is ready whichever path the reviewer takes), extract verbatim evidence and write a 1–2 sentence neutral summary of what it shows. Present evidence, not decisions.`,
        s.includeSuggestions
          ? 'The reviewer asked for suggested answers: set suggestedAnswer to one of the listed response codes with brief reasoning. These are suggestions only.'
          : 'Do NOT suggest answers: set suggestedAnswer and suggestionReasoning to null.',
        d.questionIds.map(questionBrief).join('\n\n')
      );
      break;
    }
    case 'explain_evidence': {
      const qid = requireQuestion(s);
      const items = ctx.evidence.filter((e) => s.evidenceIds?.includes(e.id));
      if (items.length === 0) throw new ValidationError('Select the evidence to explain.');
      parts.push(
        questionBrief(qid),
        `Explain what this evidence means for the question, in plain language, citing the quotations. Point out ambiguity and what else would need to be known. Do not choose the answer.\n\n${evidenceText(items)}`
      );
      break;
    }
    case 'check_missing': {
      const qid = requireQuestion(s);
      parts.push(
        questionBrief(qid),
        'Check whether the sources contain the information needed to answer this question. Search thoroughly (use several search_source queries with different terms, and read relevant pages). Report what is missing and why it matters, every search you ran and whether it found anything, and any relevant quotations you did find. Absence of evidence is not a decision: do not state the answer.'
      );
      break;
    }
    case 'draft_rationale': {
      const qid = requireQuestion(s);
      const r = ctx.assessment?.responses[qid];
      if (!r?.answer) throw new ValidationError('Choose an answer first; the rationale explains the reviewer’s answer.');
      const items = ctx.evidence.filter((e) => r.evidenceIds.includes(e.id));
      parts.push(
        questionBrief(qid),
        `The reviewer answered ${qid} = ${r.answer}.${r.rationale ? ` Their current notes: ${r.rationale}` : ''}`,
        items.length ? `Linked evidence:\n${evidenceText(items)}` : 'No evidence is linked yet; cite quotations from the sources if you rely on them.',
        'Draft a concise rationale (2–4 sentences) explaining this answer, citing quotations with page numbers. The reviewer will edit it.'
      );
      break;
    }
    case 'suggest_answer': {
      const qid = requireQuestion(s);
      const r = ctx.assessment?.responses[qid];
      const items = ctx.evidence.filter((e) => r?.evidenceIds.includes(e.id));
      parts.push(
        questionBrief(qid),
        items.length ? `Evidence the reviewer has linked:\n${evidenceText(items)}` : '',
        'The reviewer explicitly asked for a suggested answer. Suggest one response code from the options, with reasoning grounded in quotations and your confidence. This is a suggestion; the reviewer decides.'
      );
      break;
    }
    case 'extract_study': {
      parts.push(
        'Extract draft study-level details for the reviewer to review and edit:',
        '- C1 participants and eligibility criteria; C2 intervention strategy (type Point or Sustained); C3 comparator strategy (type Alternative intervention, Standard care or No intervention); C4 whether the analysis accounted for switches or protocol deviations (No = intention-to-treat).',
        '- Candidate numerical results to assess: each distinct outcome, time point, comparison and analysis (unadjusted, adjusted, matched...) is a separate result. Give A1 exactly as reported (with intervention/comparator order), its location (table/figure/page) and the outcome definition.',
        'Every draft must be supported by verbatim quotations.'
      );
      break;
    }
    case 'evaluate_confounders': {
      const names = s.factors?.length ? s.factors : ctx.snapshot.data.confounders.map((c) => c.factor);
      if (names.length === 0) throw new ValidationError('There are no confounding factors to evaluate yet.');
      parts.push(
        `Evaluate each important confounding factor for this study: which variable(s) measured it, whether it was controlled for in the analysis (Y/N) and how, whether it was measured validly and reliably (NA if not controlled), and if not controlled whether there is evidence that control was unnecessary (conditions a–f; NA if controlled). Support each with verbatim quotations; use NI/N where nothing is reported.\n\nFactors:\n${names.map((n) => `- ${n}`).join('\n')}`
      );
      break;
    }
    case 'chat': {
      if (!s.message?.trim()) throw new ValidationError('Type a message.');
      if (s.questionIds?.length) parts.push(`The reviewer is looking at:\n${s.questionIds.map(questionBrief).join('\n\n')}`);
      if (s.history?.length) parts.push(`Conversation so far:\n${s.history.slice(-12).map((h) => `${h.role === 'user' ? 'Reviewer' : 'Assistant'}: ${h.text}`).join('\n\n')}`);
      parts.push(`Reviewer: ${s.message.trim()}`, 'Answer helpfully and concisely. Quote verbatim with page numbers when you rely on the sources.');
      break;
    }
  }
  return [parts.filter(Boolean).join('\n\n'), `<context revision="${ctx.contextRevision}">\n${studyContext(ctx)}\n</context>`, sources(ctx)].join('\n\n');
}
