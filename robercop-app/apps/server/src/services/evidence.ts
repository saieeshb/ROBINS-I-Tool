import { checkOutcome, checkQuote, emptyCheck, isCheckStale, type EvidenceItem, type SearchRecord, type SourceCheck } from '@robercop/shared';
import { getQuestion } from '@robercop/rules';
import { ValidationError, newId, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { DocumentService, SourceBundle } from './documents.js';

export interface EvidenceInput {
  quote?: string;
  kind?: 'quote' | 'note';
  documentId?: string | null;
  page?: number | null;
  section?: string;
  theme?: string;
  questionIds?: string[];
  interpretation?: string;
  assessmentId?: string | null;
  origin?: EvidenceItem['origin'];
  proposalId?: string | null;
  runId?: string | null;
}

export class EvidenceService {
  constructor(
    private readonly store: Store,
    private readonly documents: DocumentService
  ) {}

  /**
   * Evidence visible from a context: study-level items plus, inside an assessment, that assessment's own items.
   * Items created in other assessments are never visible (independent review).
   */
  visible(studyId: string, assessmentId: string | null): EvidenceItem[] {
    return this.store.evidence.find({ study_id: studyId }).filter((e) => e.assessmentId === null || e.assessmentId === assessmentId);
  }

  check(bundle: SourceBundle, item: Pick<EvidenceItem, 'quote' | 'page' | 'documentId' | 'kind'>): SourceCheck {
    if (item.kind === 'note') return emptyCheck();
    return checkQuote(item.quote, bundle.matchable, { claimedPage: item.page, claimedDocumentId: item.documentId });
  }

  create(studyId: string, input: EvidenceInput, actor: string): EvidenceItem {
    this.store.studies.require(studyId);
    const kind = input.kind ?? 'quote';
    const quote = (input.quote ?? '').trim();
    if (kind === 'quote' && !quote) throw new ValidationError('A quotation is required.');
    if (kind === 'note' && !(input.interpretation ?? '').trim()) throw new ValidationError('A note needs some text.');
    const questionIds = (input.questionIds ?? []).filter((q) => getQuestion(q) || ['C1', 'C2', 'C3', 'C4', 'A1', 'A2', 'A3', 'CF'].includes(q));
    if (input.assessmentId) {
      const a = this.store.assessments.require(input.assessmentId);
      if (a.studyId !== studyId) throw new ValidationError('The assessment belongs to a different study.');
    }
    const bundle = this.documents.bundle(studyId, { includeReferences: true });
    const draft = { quote, page: input.page ?? null, documentId: input.documentId ?? null, kind };
    const check = this.check(bundle, draft);
    // Adopt the located document/page when the quote was found at exactly one place.
    const loc = check.status === 'matched' ? check.locations[0] : undefined;
    const item: EvidenceItem = {
      id: newId(),
      studyId,
      assessmentId: input.assessmentId ?? null,
      documentId: loc?.documentId ?? input.documentId ?? null,
      kind,
      quote,
      page: loc?.page ?? input.page ?? null,
      section: input.section ?? '',
      theme: input.theme ?? '',
      questionIds,
      interpretation: (input.interpretation ?? '').trim(),
      origin: input.origin ?? 'reviewer',
      proposalId: input.proposalId ?? null,
      runId: input.runId ?? null,
      check,
      acceptedBy: actor,
      acceptedAt: now(),
      changedAt: now(),
      createdAt: '',
      updatedAt: '',
      version: 0
    };
    return this.store.evidence.insert(item, { actor, reason: input.proposalId ? 'accepted from proposal' : 'created' });
  }

  update(id: string, patch: EvidenceInput & { version: number }, actor: string): EvidenceItem {
    const current = this.store.evidence.require(id);
    const next: EvidenceItem = {
      ...current,
      quote: patch.quote !== undefined ? patch.quote.trim() : current.quote,
      page: patch.page !== undefined ? patch.page : current.page,
      documentId: patch.documentId !== undefined ? patch.documentId : current.documentId,
      section: patch.section ?? current.section,
      theme: patch.theme ?? current.theme,
      questionIds: patch.questionIds ?? current.questionIds,
      interpretation: patch.interpretation !== undefined ? patch.interpretation.trim() : current.interpretation,
      version: patch.version
    };
    const quoteChanged = next.quote !== current.quote || next.documentId !== current.documentId || next.page !== current.page;
    if (quoteChanged) {
      // Any earlier result, including a manual check, no longer applies to the edited quotation.
      next.check = this.check(this.documents.bundle(current.studyId, { includeReferences: true }), next);
      next.changedAt = now();
    }
    return this.store.evidence.update(next, { actor, reason: quoteChanged ? 'quotation edited; rechecked' : 'edited' });
  }

  recheck(id: string, actor: string): EvidenceItem {
    const item = this.store.evidence.require(id);
    const bundle = this.documents.bundle(item.studyId, { includeReferences: true });
    return this.store.evidence.mutate(id, (e) => this.applyCheck(e, this.check(bundle, e)), { actor, reason: 'rechecked' });
  }

  /**
   * Re-runs checks for a study after its sources were re-parsed. Manual checks are kept: they were made against the
   * original PDF, which has not changed.
   */
  recheckStudy(studyId: string): number {
    const bundle = this.documents.bundle(studyId, { includeReferences: true });
    let n = 0;
    for (const e of this.store.evidence.find({ study_id: studyId })) {
      if (e.kind !== 'quote' || e.check.status === 'manually_verified') continue;
      if (!isCheckStale(e.check, bundle.jobIds) && e.check.status !== 'not_checked') continue;
      this.store.evidence.mutate(e.id, (x) => this.applyCheck(x, this.check(bundle, x)), { actor: 'system', reason: 'rechecked after re-parse' });
      n++;
    }
    return n;
  }

  /** Stores a new check; answers relying on the item are flagged only if the outcome (status or location) changed. */
  private applyCheck(e: EvidenceItem, check: SourceCheck): void {
    if (checkOutcome(check) !== checkOutcome(e.check)) e.changedAt = now();
    e.check = check;
  }

  /** Records a documented manual check of a quotation against the original PDF. */
  manualCheck(id: string, input: { page: number | null; note: string; locationIndex?: number; candidateIndex?: number }, actor: string): EvidenceItem {
    if (!input.note?.trim()) throw new ValidationError('Describe what you checked (e.g. "Verified in Table 2 of the PDF").');
    return this.store.evidence.mutate(
      id,
      (e) => {
        const chosen =
          input.locationIndex !== undefined ? e.check.locations[input.locationIndex] : input.candidateIndex !== undefined ? e.check.candidates[input.candidateIndex] : undefined;
        const page = input.page ?? chosen?.page ?? e.page;
        e.check = {
          ...e.check,
          status: 'manually_verified',
          method: 'manual',
          locations: chosen ? [{ documentId: chosen.documentId, page: chosen.page, blockIds: chosen.blockIds, text: chosen.text }] : e.check.locations,
          manual: { by: actor, at: now(), note: input.note.trim(), page: page ?? null }
        };
        if (chosen) e.documentId = chosen.documentId;
        e.page = page ?? null;
        e.changedAt = now();
      },
      { actor, reason: 'manual source check' }
    );
  }

  delete(id: string, actor: string): void {
    const item = this.store.evidence.require(id);
    const linked = this.store.assessments
      .find({ study_id: item.studyId })
      .filter((a) => Object.values(a.responses).some((r) => r.evidenceIds.includes(id)));
    if (linked.length > 0) throw new ValidationError('This evidence is linked to answers; unlink it first.');
    this.store.evidence.delete(id, { actor, reason: 'removed' });
  }

  recordSearch(input: Omit<SearchRecord, 'id' | 'createdAt'>, actor: string): SearchRecord {
    return this.store.searches.insert({ ...input, id: newId(), createdAt: '', version: 0 } as SearchRecord & { version: number }, { actor, reason: 'search' });
  }
}
