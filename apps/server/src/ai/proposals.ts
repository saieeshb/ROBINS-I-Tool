import type { AiProposal, EvidenceItem } from '@robercop/shared';
import { ValidationError, now } from '../db/database.js';
import type { Store } from '../db/store.js';
import type { EvidenceService } from '../services/evidence.js';

/**
 * Proposals are AI output awaiting a reviewer. Accepting an evidence proposal creates an evidence item (a quotation the
 * reviewer chose to keep); it never sets an answer. Other proposal kinds return their content for the reviewer to
 * apply through the normal editing flow, where it becomes their own decision.
 */
export class ProposalService {
  constructor(
    private readonly store: Store,
    private readonly evidence: EvidenceService
  ) {}

  forRun(runId: string): AiProposal[] {
    return this.store.proposals.find({ run_id: runId });
  }

  accept(id: string, input: { quote?: string; interpretation?: string; questionIds?: string[]; theme?: string }, actor: string): { proposal: AiProposal; evidence?: EvidenceItem } {
    const p = this.store.proposals.require(id);
    if (p.status !== 'pending') throw new ValidationError(`This suggestion was already ${p.status}.`);
    const run = this.store.aiRuns.require(p.runId);
    if (run.assessmentId) {
      const a = this.store.assessments.require(run.assessmentId);
      if (a.reviewer !== actor && a.role !== 'consensus') throw new ValidationError('Only the assessment’s reviewer can accept its suggestions.');
    }
    return this.store.db.tx(() => {
      let evidence: EvidenceItem | undefined;
      if (p.kind === 'evidence') {
        const c = p.content as { quote: string; documentId: string | null; page: number | null; section?: string; interpretation?: string; questionIds?: string[]; theme?: string };
        evidence = this.evidence.create(
          run.studyId!,
          {
            quote: input.quote ?? c.quote,
            documentId: c.documentId,
            page: c.page,
            section: c.section ?? '',
            interpretation: input.interpretation ?? c.interpretation ?? '',
            questionIds: input.questionIds ?? c.questionIds ?? [],
            theme: input.theme ?? c.theme ?? '',
            assessmentId: run.assessmentId,
            origin: 'ai',
            proposalId: p.id,
            runId: run.id
          },
          actor
        );
      }
      const proposal = this.store.proposals.mutate(id, (x) => void ((x.status = 'accepted'), (x.decidedBy = actor), (x.decidedAt = now())), { actor, reason: 'accepted' });
      return { proposal, evidence };
    });
  }

  reject(id: string, actor: string): AiProposal {
    const p = this.store.proposals.require(id);
    if (p.status !== 'pending') return p;
    return this.store.proposals.mutate(id, (x) => void ((x.status = 'rejected'), (x.decidedBy = actor), (x.decidedAt = now())), { actor, reason: 'rejected' });
  }
}
