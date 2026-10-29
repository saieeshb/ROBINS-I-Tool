import { useState } from 'react';
import { getDomain, getQuestion, type DomainId } from '@robercop/rules';
import type { VerificationDecision } from '@robercop/shared';
import { errorMessage, post } from '../../api';
import { TextArea, fmtTime } from '../../components/ui';
import { useSession } from '../../session';
import { useAssess } from './context';

/** Checking mode: change requests and confirmations recorded against a target, with the first reviewer's response. */
export function VerificationNotes({ target }: { target: string }) {
  const { payload, a, reload } = useAssess();
  const { reviewer, toast } = useSession();
  const [note, setNote] = useState('');
  const list = (payload.verification?.decisions ?? []).filter((d) => d.target === target && d.resolution !== 'superseded');
  if (list.length === 0) return null;
  const resolve = async (d: VerificationDecision, resolution: 'accepted' | 'declined') => {
    try {
      await post(`/verifications/${d.id}/resolve`, { resolution, note });
      setNote('');
      void reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  return (
    <>
      {list.map((d) => (
        <div key={d.id} className={`flag ${d.verdict === 'confirmed' ? 'info' : d.resolution ? '' : 'bad'}`}>
          <div className="grow">
            <strong>{d.verdict === 'confirmed' ? '✓ Confirmed' : d.verdict === 'change_requested' ? 'Change requested' : 'Disagreement'}</strong> by {d.reviewer} · {fmtTime(d.createdAt)}
            {d.proposedAnswer && ` — proposes ${d.proposedAnswer}`}
            {d.comment && <div>{d.comment}</div>}
            {d.resolution && (
              <div className="tiny">
                {d.resolution} by {d.resolvedBy}
                {d.resolutionNote ? `: ${d.resolutionNote}` : ''}
              </div>
            )}
            {d.verdict !== 'confirmed' && !d.resolution && a.reviewer === reviewer && (
              <div className="row mt-sm">
                <input placeholder="Response (required to decline)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="xs" onClick={() => void resolve(d, 'accepted')} title="Reopen the assessment from Finish, make the change, then resubmit">
                  Accept
                </button>
                <button className="xs" disabled={!note.trim()} onClick={() => void resolve(d, 'declined')}>
                  Decline
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/** Checking mode: the checker confirms or requests a change on one target. */
export function CheckerControls({ target, options }: { target: string; options: string[] }) {
  const { isChecker, a, reload, payload } = useAssess();
  const { toast } = useSession();
  const [mode, setMode] = useState<'' | 'change_requested' | 'disagree'>('');
  const [proposed, setProposed] = useState('');
  const [comment, setComment] = useState('');
  if (!isChecker) return null;
  const latest = (payload.verification?.decisions ?? []).filter((d) => d.target === target && d.resolution !== 'superseded').at(-1);
  const send = async (verdict: 'confirmed' | 'change_requested' | 'disagree') => {
    try {
      await post(`/assessments/${a.id}/verifications`, { target, verdict, proposedAnswer: proposed, comment });
      setMode('');
      setComment('');
      setProposed('');
      void reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  return (
    <div className="card flat mt-sm" style={{ padding: 8, background: 'var(--surface-2)' }}>
      <div className="row wrap">
        <span className="small">
          <strong>Check {target}:</strong>
        </span>
        <button className="xs primary" disabled={latest?.verdict === 'confirmed'} onClick={() => void send('confirmed')}>
          {latest?.verdict === 'confirmed' ? '✓ Confirmed' : 'Confirm'}
        </button>
        <button className="xs" onClick={() => setMode('change_requested')}>
          Request change
        </button>
        <button className="xs" onClick={() => setMode('disagree')}>
          Disagree
        </button>
      </div>
      {mode && (
        <div className="mt-sm">
          <div className="row">
            <span className="small">Proposed:</span>
            <select value={proposed} onChange={(e) => setProposed(e.target.value)}>
              <option value="">—</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <TextArea value={comment} rows={2} placeholder="Explain (required)" onChange={setComment} />
          <button className="xs mt-sm" disabled={!comment.trim()} onClick={() => void send(mode)}>
            Send {mode === 'disagree' ? 'disagreement' : 'change request'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Consensus record: the two original answers for each disagreement in a domain, and resolving them. */
export function ConsensusPanel({ domain }: { domain: DomainId }) {
  const { payload, a, canEdit, reload } = useAssess();
  const { toast } = useSession();
  const [final, setFinal] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  if (a.role !== 'consensus') return null;
  const ids = getDomain(domain).questionIds;
  const items = payload.consensusItems.filter((i) => ids.includes(i.target) || i.target === domain);
  if (items.length === 0) return <div className="banner ok">No disagreements in this domain; agreed answers were carried over from both assessments.</div>;
  return (
    <div className="card mb" style={{ borderLeft: '3px solid var(--warn)' }}>
      <h3>Disagreements to reconcile</h3>
      {items.map((it) => {
        const q = getQuestion(it.target);
        return (
          <div key={it.id} className="ev">
            <div className="row">
              <strong className="mono">{it.target}</strong>
              {Object.entries(it.answers).map(([who, ans]) => (
                <span key={who} className="chip">
                  {who}: <strong>{ans || '—'}</strong>
                </span>
              ))}
              <span className="spacer" />
              {it.resolvedAt ? <span className="chip ok">Resolved: {it.final}</span> : <span className="chip warn">Open</span>}
            </div>
            {payload.parents.map((p) => {
              const r = q ? p.responses[it.target] : null;
              return r?.rationale ? (
                <div key={p.id} className="interp">
                  <strong>{p.reviewer}:</strong> {r.rationale}
                </div>
              ) : null;
            })}
            {it.resolvedAt && <div className="tiny muted">{it.note} — {it.resolvedBy}, {fmtTime(it.resolvedAt)}</div>}
            {!it.resolvedAt && canEdit && q && (
              <div className="row mt-sm">
                <select value={final[it.id] ?? ''} onChange={(e) => setFinal({ ...final, [it.id]: e.target.value })}>
                  <option value="">Consensus answer…</option>
                  {q.options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.code} — {o.label}
                    </option>
                  ))}
                </select>
                <input placeholder="How it was resolved (required)" value={note[it.id] ?? ''} onChange={(e) => setNote({ ...note, [it.id]: e.target.value })} />
                <button
                  className="xs primary"
                  disabled={!final[it.id] || !(note[it.id] ?? '').trim()}
                  onClick={async () => {
                    try {
                      await post(`/consensus-items/${it.id}/resolve`, { final: final[it.id], note: note[it.id] });
                      void reload();
                    } catch (e) {
                      toast(errorMessage(e), true);
                    }
                  }}
                >
                  Resolve
                </button>
              </div>
            )}
            {!it.resolvedAt && !q && <div className="small muted mt-sm">Settled when you confirm the {it.target === 'overall' ? 'overall' : 'domain'} judgement in this consensus record.</div>}
          </div>
        );
      })}
    </div>
  );
}
