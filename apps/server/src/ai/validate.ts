import { z } from 'zod';
import type { AiTask } from '@robercop/shared';

const page = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
});

export const QuoteItem = z.object({
  quote: z.string().min(1),
  documentId: z.string().default(''),
  page,
  section: z.string().optional().default(''),
  interpretation: z.string().optional().default('')
});
export type QuoteItem = z.infer<typeof QuoteItem>;

const qid = z.string().transform((s) => {
  const m = s.trim().toUpperCase().match(/^Q?(\d)\.(\d{1,2})$/);
  return m ? `Q${m[1]}.${m[2]}` : s.trim().toUpperCase();
});

export const OUTPUT: Partial<Record<AiTask, z.ZodType>> = {
  find_evidence: z.object({
    items: z.array(QuoteItem.extend({ questionIds: z.array(qid).default([]), theme: z.string().optional().default('') })),
    notFound: z.array(z.object({ questionId: qid, searchedFor: z.array(z.string()).default([]), note: z.string().optional().default('') })).default([])
  }),
  prepare_domain: z.object({
    questions: z.array(
      z.object({
        questionId: qid,
        items: z.array(QuoteItem).default([]),
        summary: z.string().default(''),
        searchedFor: z.array(z.string()).default([]),
        suggestedAnswer: z.string().nullable().optional(),
        suggestionReasoning: z.string().nullable().optional()
      })
    )
  }),
  check_missing: z.object({
    missing: z.array(z.object({ item: z.string(), whyItMatters: z.string().default('') })).default([]),
    searches: z.array(z.object({ query: z.string(), found: z.boolean() })).default([]),
    items: z.array(QuoteItem).default([]),
    conclusion: z.string().default('')
  }),
  draft_rationale: z.object({ rationale: z.string().min(1) }),
  suggest_answer: z.object({
    suggestedAnswer: z.string().transform((s) => s.trim().toUpperCase()),
    reasoning: z.string(),
    confidence: z.enum(['low', 'medium', 'high']).catch('low'),
    items: z.array(QuoteItem).default([])
  }),
  extract_study: z.object({
    citation: z.string().optional().default(''),
    fields: z
      .array(
        z.object({
          field: z.enum(['c1', 'c2', 'c3', 'c4']),
          draft: z.string(),
          type: z.string().nullable().optional(),
          items: z.array(QuoteItem).default([])
        })
      )
      .default([]),
    results: z
      .array(
        z.object({
          outcome: z.string(),
          timePoint: z.string().optional().default(''),
          comparison: z.string().optional().default(''),
          analysis: z.string().optional().default(''),
          numericalResult: z.string(),
          location: z.string().optional().default(''),
          outcomeDefinition: z.string().optional().default(''),
          items: z.array(QuoteItem).default([])
        })
      )
      .default([])
  }),
  evaluate_confounders: z.object({
    factors: z.array(
      z.object({
        factor: z.string(),
        variables: z.string().default(''),
        controlled: z.enum(['Y', 'N']).catch('N'),
        method: z.string().optional().default(''),
        valid: z.enum(['NA', 'Y', 'PY', 'PN', 'N', 'NI']).catch('NI'),
        unnecessary: z.enum(['NA', 'Y', 'PY', 'PN', 'N']).catch('N'),
        unnecessaryCondition: z.enum(['', 'a', 'b', 'c', 'd', 'e', 'f']).catch(''),
        comments: z.string().optional().default(''),
        items: z.array(QuoteItem).default([])
      })
    )
  })
};

/** Extracts JSON from free text when the CLI lacks structured output support. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}
