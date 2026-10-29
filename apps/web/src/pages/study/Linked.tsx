import { useState } from 'react';
import type { AiProposal, EvidenceItem, SourceCheck } from '@robercop/shared';
import { errorMessage, post } from '../../api';
import { useAssistant } from '../../assistant/AssistantContext';
import { CheckBadge } from '../../components/ui';
import { EvidenceCard } from '../../evidence/Evidence';
import { useSession } from '../../session';
import { useStudy, type LinkTarget } from './context';

/** Evidence linked to a study-level field, with tools to link more. */
export function LinkedEvidence({ target }: { target: LinkTarget }) {
  const { evidence, linkedIds, linkEvidence, setLinkTarget, linkTarget, focus, reloadEvidence } = useStudy();
  const [picking, setPicking] = useState(false);
  const ids = linkedIds(target);
  const linked = ids.map((id) => evidence.find((e) => e.id === id)).filter(Boolean) as EvidenceItem[];
  const active = linkTarget && JSON.stringify(linkTarget) === JSON.stringify(target);
  return (
    <div className="mt-sm">
      {linked.map((e) => (
        <EvidenceCard key={e.id} ev={e} focus={focus} onUnlink={() => linkEvidence(target, e.id, false)} onChanged={() => void reloadEvidence()} compact />
      ))}
      <div className="row gap-sm mt-sm">
        <button className={`xs ${active ? 'primary' : ''}`} onClick={() => setLinkTarget(active ? null : target)} title="Then select text in the PDF">
          {active ? '✓ Selecting in PDF…' : '+ Select in PDF'}
        </button>
        <button className="xs" onClick={() => setPicking((p) => !p)}>
          + From evidence bank
        </button>
      </div>
      {picking && (
        <div className="card flat mt-sm" style={{ maxHeight: 260, overflowY: 'auto', padding: 8 }}>
          {evidence.filter((e) => !ids.includes(e.id)).length === 0 && <div className="small faint">No other evidence yet.</div>}
          {evidence
            .filter((e) => !ids.includes(e.id))
            .map((e) => (
              <EvidenceCard key={e.id} ev={e} focus={focus} compact onLink={() => linkEvidence(target, e.id)} />
            ))}
        </div>
      )}
    </div>
  );
}

interface FieldProposalContent {
  draft: string;
  type?: string | null;
  items?: { quote: string; documentId: string | null; page: number | null; interpretation?: string; check?: SourceCheck }[];
}

/** Assistant drafts for a study field (from "Extract study details"). */
export function FieldProposals({ field, onUse, target }: { field: string; onUse: (draft: string, type: string | null) => void; target?: LinkTarget }) {
  const { pending, accept, reject } = useAssistant();
  const list = pending((p) => p.kind === 'study_field' && p.target.field === field);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((p) => (
        <FieldProposal key={p.id} p={p} onUse={(d, t) => (onUse(d, t), void accept(p))} onDismiss={() => void reject(p)} target={target} />
      ))}
    </>
  );
}

function FieldProposal({ p, onUse, onDismiss, target }: { p: AiProposal; onUse: (draft: string, type: string | null) => void; onDismiss: () => void; target?: LinkTarget }) {
  const c = p.content as unknown as FieldProposalContent;
  return (
    <div className="ev proposal mt-sm">
      <div className="row top">
        <span className="chip info">Suggested draft</span>
        <div className="grow small pre">
          {c.draft}
          {c.type ? ` [${c.type}]` : ''}
        </div>
      </div>
      {(c.items ?? []).map((it, i) => (
        <SupportingQuote key={i} item={it} runId={p.runId} target={target} />
      ))}
      <div className="meta">
        <span className="spacer" />
        <button className="xs ghost" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="xs primary" onClick={() => onUse(c.draft, c.type ?? null)}>
          Use this draft
        </button>
      </div>
    </div>
  );
}

/** A quotation supporting an assistant draft; can be kept as study evidence (and linked). */
export function SupportingQuote({ item, runId, target, questionIds = [] }: { item: { quote: string; documentId: string | null; page: number | null; interpretation?: string; check?: SourceCheck }; runId: string; target?: LinkTarget; questionIds?: string[] }) {
  const { payload, focus, reloadEvidence, linkEvidence } = useStudy();
  const { toast } = useSession();
  const [kept, setKept] = useState(false);
  const loc = item.check?.locations[0];
  return (
    <div className="ev" style={{ background: '#fcfbff' }}>
      <blockquote>“{item.quote}”</blockquote>
      <div className="meta">
        <CheckBadge check={item.check} />
        {item.page && (
          <a style={{ cursor: 'pointer' }} onClick={() => (loc ?? item.documentId) && focus({ documentId: loc?.documentId ?? item.documentId!, page: loc?.page ?? item.page, text: loc?.text ?? item.quote })}>
            p. {item.page} ↗
          </a>
        )}
        <span className="spacer" />
        <button
          className="xs"
          disabled={kept}
          onClick={async () => {
            try {
              const ev = await post<EvidenceItem>(`/studies/${payload.study.id}/evidence`, {
                quote: item.quote,
                documentId: item.documentId,
                page: item.page,
                interpretation: item.interpretation ?? '',
                origin: 'ai',
                runId,
                questionIds
              });
              setKept(true);
              await reloadEvidence();
              if (target) linkEvidence(target, ev.id);
            } catch (e) {
              toast(errorMessage(e), true);
            }
          }}
        >
          {kept ? '✓ Kept' : target ? 'Keep & link' : 'Keep as evidence'}
        </button>
      </div>
    </div>
  );
}
