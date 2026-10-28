import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMAINS, getQuestion, type DomainId } from '@robercop/rules';
import type { AiTask } from '@robercop/shared';

let guideCache: string | null = null;

/** The compacted ROBINS-I V2 reference guide (interpretive knowledge base from the earlier session prompts). */
export function referenceGuide(): string {
  if (guideCache !== null) return guideCache;
  for (const rel of ['./reference/REFERENCE_GUIDE_COMPACTED.md', '../src/ai/reference/REFERENCE_GUIDE_COMPACTED.md']) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path)) return (guideCache = readFileSync(path, 'utf8'));
  }
  return (guideCache = '');
}

export function systemPrompt(): string {
  return `You are a methodological epidemiologist helping a human reviewer carry out a ROBINS-I V2 (20 November 2025) risk-of-bias assessment inside ROBer COP, a local assessment workspace.

YOUR ROLE
- You supply evidence and suggestions. The reviewer chooses every answer, approves every judgement and resolves every disagreement. Never present a suggestion as a decision.
- Scope: intention-to-treat effects only (C4 = No), Domain 1 Variant A (baseline confounding only). No direction-of-bias predictions.

ANTI-HALLUCINATION PROTOCOL (follow exactly)
1. Search the source documents for relevant content (use the robercop tools: search_source, get_page, get_blocks).
2. Copy EXACT verbatim quotations. Never paraphrase and present it as a quotation. Do not "fix" typos, hyphenation or symbols in quotations.
3. Give the document id and page number shown in the tools or page markers (<!-- page N -->). Never invent page numbers.
4. Only then give your interpretation, clearly separated from the quotation.
5. If nothing relevant is found, say so explicitly and list what you searched for. Do not infer facts that are not stated.
6. Before returning a quotation, you may verify it with check_quote. Prefer short, precise quotations (one or two sentences) over long passages.
7. Absence of evidence is not evidence of absence: report "not found" and the searches you ran; never decide that the answer is "NI" for the reviewer.

You have read-only tools. You cannot change answers, approve anything or finalize assessments.

REFERENCE GUIDE
${referenceGuide()}`;
}

// ---------------------------------------------------------------------------
// JSON schemas for structured tasks (validated again with zod on receipt)
// ---------------------------------------------------------------------------
const quoteItem = {
  type: 'object',
  properties: {
    quote: { type: 'string', description: 'Exact verbatim text from the source' },
    documentId: { type: 'string' },
    page: { type: ['integer', 'null'] },
    section: { type: 'string' },
    interpretation: { type: 'string', description: 'What this shows for the question (not a decision)' }
  },
  required: ['quote', 'documentId', 'page', 'interpretation']
};

export const SCHEMAS: Partial<Record<AiTask, object>> = {
  find_evidence: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { ...quoteItem, properties: { ...quoteItem.properties, questionIds: { type: 'array', items: { type: 'string' } }, theme: { type: 'string' } }, required: [...quoteItem.required, 'questionIds'] }
      },
      notFound: {
        type: 'array',
        items: { type: 'object', properties: { questionId: { type: 'string' }, searchedFor: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['questionId', 'searchedFor'] }
      }
    },
    required: ['items', 'notFound']
  },
  prepare_domain: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            questionId: { type: 'string' },
            items: { type: 'array', items: quoteItem },
            summary: { type: 'string', description: '1–2 sentence neutral summary of what the evidence shows' },
            searchedFor: { type: 'array', items: { type: 'string' } },
            suggestedAnswer: { type: ['string', 'null'], description: 'Only when suggestions were requested; otherwise null' },
            suggestionReasoning: { type: ['string', 'null'] }
          },
          required: ['questionId', 'items', 'summary', 'searchedFor']
        }
      }
    },
    required: ['questions']
  },
  check_missing: {
    type: 'object',
    properties: {
      missing: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, whyItMatters: { type: 'string' } }, required: ['item', 'whyItMatters'] } },
      searches: { type: 'array', items: { type: 'object', properties: { query: { type: 'string' }, found: { type: 'boolean' } }, required: ['query', 'found'] } },
      items: { type: 'array', items: quoteItem },
      conclusion: { type: 'string' }
    },
    required: ['missing', 'searches', 'items', 'conclusion']
  },
  draft_rationale: {
    type: 'object',
    properties: { rationale: { type: 'string', description: 'Draft rationale for the reviewer to edit; cite quotations with page numbers' } },
    required: ['rationale']
  },
  suggest_answer: {
    type: 'object',
    properties: {
      suggestedAnswer: { type: 'string' },
      reasoning: { type: 'string' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      items: { type: 'array', items: quoteItem }
    },
    required: ['suggestedAnswer', 'reasoning', 'confidence', 'items']
  },
  extract_study: {
    type: 'object',
    properties: {
      citation: { type: 'string' },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['c1', 'c2', 'c3', 'c4'] },
            draft: { type: 'string' },
            type: { type: ['string', 'null'], description: 'C2: Point/Sustained. C3: Alternative intervention/Standard care/No intervention. C4: No/Yes.' },
            items: { type: 'array', items: quoteItem }
          },
          required: ['field', 'draft', 'items']
        }
      },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            outcome: { type: 'string' },
            timePoint: { type: 'string' },
            comparison: { type: 'string' },
            analysis: { type: 'string' },
            numericalResult: { type: 'string' },
            location: { type: 'string' },
            outcomeDefinition: { type: 'string' },
            items: { type: 'array', items: quoteItem }
          },
          required: ['outcome', 'numericalResult', 'location', 'items']
        }
      }
    },
    required: ['fields', 'results']
  },
  evaluate_confounders: {
    type: 'object',
    properties: {
      factors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            factor: { type: 'string' },
            variables: { type: 'string' },
            controlled: { type: 'string', enum: ['Y', 'N'] },
            method: { type: 'string' },
            valid: { type: 'string', enum: ['NA', 'Y', 'PY', 'PN', 'N', 'NI'] },
            unnecessary: { type: 'string', enum: ['NA', 'Y', 'PY', 'PN', 'N'] },
            unnecessaryCondition: { type: 'string', enum: ['', 'a', 'b', 'c', 'd', 'e', 'f'] },
            comments: { type: 'string' },
            items: { type: 'array', items: quoteItem }
          },
          required: ['factor', 'variables', 'controlled', 'valid', 'unnecessary', 'items']
        }
      }
    },
    required: ['factors']
  }
};

export function questionBrief(qid: string): string {
  const q = getQuestion(qid);
  if (!q) return qid;
  return [
    `${q.id}. ${q.text}`,
    q.conditionText ? `(Asked because: ${q.conditionText})` : '',
    `Response options: ${q.options.map((o) => `${o.code} = ${o.label}`).join('; ')}`,
    q.elaboration.length ? `Official elaboration: ${q.elaboration.join(' ')}` : '',
    q.hints.length ? `Guidance: ${q.hints.join(' ')}` : '',
    q.searchTerms.length ? `Useful search terms: ${q.searchTerms.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function domainBrief(d: DomainId): string {
  const def = DOMAINS.find((x) => x.id === d)!;
  return `${def.title}\n${def.description}`;
}

export const TASK_LABELS: Record<AiTask, string> = {
  find_evidence: 'Find evidence',
  prepare_domain: 'Prepare domain evidence',
  explain_evidence: 'Explain this evidence',
  check_missing: 'Check for missing information',
  draft_rationale: 'Draft rationale',
  suggest_answer: 'Suggest an answer',
  extract_study: 'Extract study details',
  evaluate_confounders: 'Evaluate confounders',
  chat: 'Conversation'
};
