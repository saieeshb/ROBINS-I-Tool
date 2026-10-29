import { useState } from 'react';
import type { AiProposal, EvidenceItem, SourceCheck } from '@robercop/shared';
import { errorMessage, post } from '../api';
import { CheckBadge, Modal } from '../components/ui';
import { useSession } from '../session';
import type { FocusRequest } from '../pdf/PdfViewer';

export type Focus = (f: Omit<FocusRequest, 'nonce'>) => void;

function locate(ev: { documentId: string | null; page: number | null; quote: string; check?: SourceCheck | null }, focus: Focus) {
  const loc = ev.check?.locations[0];
  const documentId = loc?.documentId ?? ev.documentId;
  if (!documentId) return null;
  return () => focus({ documentId, page: loc?.page ?? ev.page, text: loc?.text ?? ev.quote });
}

/** A kept evidence item (quotation or note) with its source check. */
export function EvidenceCard({
  ev,
  focus,
  onUnlink,
  onLink,
  linked,
  onChanged,
  compact
}: {
  ev: EvidenceItem;
  focus: Focus;
  onUnlink?: () => void;
  onLink?: () => void;
  linked?: boolean;
  onChanged?: (ev: EvidenceItem) => void;
  compact?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const go = locate(ev, focus);
  const needsCheck = ev.kind === 'quote' && !['matched', 'manually_verified'].includes(ev.check.status);
  return (
    <div className="ev">
      {ev.kind === 'quote' ? <blockquote>“{ev.quote}”</blockquote> : <div className="small">{ev.interpretation}</div>}
      {ev.kind === 'quote' && ev.interpretation && !compact && <div className="interp">{ev.interpretation}</div>}
      <div className="meta">
        <CheckBadge check={ev.check} kind={ev.kind} />
        {ev.page && (go ? <a onClick={go} style={{ cursor: 'pointer' }}>p. {ev.page} ↗</a> : <span>p. {ev.page}</span>)}
        {ev.section && <span className="truncate" style={{ maxWidth: 200 }}>{ev.section}</span>}
        {ev.origin === 'ai' && <span className="chip info" title="Proposed by the assistant, kept by a reviewer">AI-found</span>}
        {ev.origin === 'legacy_import' && <span className="chip warn">Imported</span>}
        <span className="spacer" />
        {needsCheck && (
          <button className="xs" onClick={() => setChecking(true)}>
            Resolve…
          </button>
        )}
        {onLink && !linked && (
          <button className="xs primary" onClick={onLink}>
            Link
          </button>
        )}
        {onUnlink && (
          <button className="xs ghost" onClick={onUnlink} title="Unlink from this answer">
            Unlink
          </button>
        )}
      </div>
      {checking && <ManualCheck ev={ev} onClose={() => setChecking(false)} onDone={(e) => (setChecking(false), onChanged?.(e))} focus={focus} />}
    </div>
  );
}

/** Resolving an unverified quotation: pick a location/candidate, re-check, or record a documented manual check. */
export function ManualCheck({ ev, onClose, onDone, focus }: { ev: EvidenceItem; onClose: () => void; onDone: (e: EvidenceItem) => void; focus: Focus }) {
  const { toast } = useSession();
  const [note, setNote] = useState('');
  const [page, setPage] = useState<string>(ev.page ? String(ev.page) : '');
  const [choice, setChoice] = useState<{ kind: 'location' | 'candidate'; index: number } | null>(null);
  const c = ev.check;
  const submit = async () => {
    try {
      const body: Record<string, unknown> = { note, page: page ? Number(page) : null };
      if (choice?.kind === 'location') body.locationIndex = choice.index;
      if (choice?.kind === 'candidate') body.candidateIndex = choice.index;
      onDone(await post<EvidenceItem>(`/evidence/${ev.id}/manual-check`, body));
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const recheck = async () => {
    try {
      const e = await post<EvidenceItem>(`/evidence/${ev.id}/recheck`, {});
      toast(`Re-checked: ${e.check.status.replace(/_/g, ' ')}`);
      onDone(e);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  return (
    <Modal
      title="Resolve the source check"
      onClose={onClose}
      wide
      foot={
        <>
          <button onClick={recheck}>Re-check against parsed text</button>
          <button className="primary" disabled={note.trim().length < 5} onClick={submit}>
            Record manual check
          </button>
        </>
      }
    >
      <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--border-strong)' }}>“{ev.quote}”</blockquote>
      <div className="row mt-sm">
        <CheckBadge check={c} />
        <span className="small muted">{c.notes.join(' ')}</span>
      </div>
      {c.locations.length > 1 && (
        <>
          <h4 className="mt">Found at several places — choose the intended one</h4>
          {c.locations.map((l, i) => (
            <label key={i} className="checkbox">
              <input type="radio" checked={choice?.kind === 'location' && choice.index === i} onChange={() => setChoice({ kind: 'location', index: i })} />
              <span className="small">
                p. {l.page}: “{l.text.slice(0, 200)}” <a onClick={() => focus({ documentId: l.documentId, page: l.page, text: l.text })}>show</a>
              </span>
            </label>
          ))}
        </>
      )}
      {c.candidates.length > 0 && (
        <>
          <h4 className="mt">Similar passages (need manual inspection)</h4>
          {c.candidates.map((cand, i) => (
            <label key={i} className="checkbox">
              <input type="radio" checked={choice?.kind === 'candidate' && choice.index === i} onChange={() => setChoice({ kind: 'candidate', index: i })} />
              <span className="small">
                p. {cand.page} · similarity {Math.round(cand.score * 100)}% · {cand.note}: “{cand.text.slice(0, 260)}”{' '}
                <a onClick={() => focus({ documentId: cand.documentId, page: cand.page, text: cand.text })}>show</a>
              </span>
            </label>
          ))}
        </>
      )}
      <div className="grid cols-4 mt">
        <label className="field">
          <span className="label">Page in the PDF</span>
          <input type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} />
        </label>
        <label className="field" style={{ gridColumn: 'span 3' }}>
          <span className="label">What did you check?</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Verified wording in Table 2 of the original PDF (scanned table)" />
        </label>
      </div>
      <p className="small muted">A manual check records your name, the time and this note. It is shown wherever the quotation is used.</p>
    </Modal>
  );
}

/** An assistant proposal for a quotation: review it, then keep (and optionally link) or dismiss. */
export function ProposalCard({
  p,
  focus,
  onKeep,
  onDismiss,
  keepLabel = 'Keep',
  busy
}: {
  p: AiProposal;
  focus: Focus;
  onKeep: (edits: { quote?: string; interpretation?: string }) => void;
  onDismiss: () => void;
  keepLabel?: string;
  busy?: boolean;
}) {
  const c = p.content as { quote: string; documentId: string | null; page: number | null; section?: string; interpretation?: string };
  const [editing, setEditing] = useState(false);
  const [quote, setQuote] = useState(c.quote);
  const go = locate({ ...c, check: p.check }, focus);
  return (
    <div className="ev proposal">
      {editing ? (
        <textarea rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} />
      ) : (
        <blockquote>“{c.quote}”</blockquote>
      )}
      {c.interpretation && <div className="interp">{c.interpretation}</div>}
      <div className="meta">
        <span className="chip info">Suggested</span>
        <CheckBadge check={p.check} />
        {c.page && (go ? <a onClick={go} style={{ cursor: 'pointer' }}>p. {c.page} ↗</a> : <span>p. {c.page}</span>)}
        <span className="spacer" />
        <button className="xs ghost" onClick={() => setEditing((e) => !e)} title="Trim the quotation before keeping it">
          {editing ? 'Done' : 'Trim'}
        </button>
        <button className="xs ghost" onClick={onDismiss} disabled={busy}>
          Dismiss
        </button>
        <button className="xs primary" disabled={busy} onClick={() => onKeep(quote !== c.quote ? { quote } : {})}>
          {keepLabel}
        </button>
      </div>
    </div>
  );
}
