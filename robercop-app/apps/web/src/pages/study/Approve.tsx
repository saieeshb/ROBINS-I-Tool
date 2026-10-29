import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { evaluateTriage, type AnswerMap } from '@robercop/rules';
import { errorMessage, post } from '../../api';
import { JudgementBadge, ProblemList, fmtTime } from '../../components/ui';
import { useSession } from '../../session';
import { useStudy } from './context';

function sectionFor(target: string, ids: { results: string[]; confounders: string[] }): string {
  if (['c1', 'c2', 'c3', 'c4'].includes(target)) return 'target';
  if (target === 'citation') return 'details';
  if (target === 'sources') return 'info';
  if (target === 'results' || ids.results.includes(target)) return 'results';
  if (ids.confounders.includes(target)) return 'confounders';
  return 'details';
}

export function ApproveSection() {
  const { payload, reload, go } = useStudy();
  const { toast, reviewer } = useSession();
  const nav = useNavigate();
  const [note, setNote] = useState('');
  const study = payload.study;
  const ids = { results: payload.results.map((r) => r.id), confounders: study.data.confounders.map((c) => c.id) };

  const approve = async () => {
    try {
      await post(`/studies/${study.id}/approve`, { note });
      setNote('');
      toast('Study approved. Domain sessions now use this revision.');
      void reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const start = async (resultId: string) => {
    try {
      const a = await post<{ id: string }>(`/results/${resultId}/assessments`, {});
      nav(`/assessments/${a.id}`);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const approvedRev = payload.revisions.find((r) => r.id === study.approvedRevisionId);

  return (
    <div>
      <h2>Review &amp; approve</h2>
      <p className="muted small">
        Approval freezes the study-level information as a revision. Every Domain session references an approved revision instead of importing a copy. If you change the study later,
        approve again; existing assessments can then be moved onto the new revision, and judgements that depend on changed content are flagged for reconfirmation.
      </p>
      <div className="card">
        {payload.readiness.length === 0 ? (
          <div className="banner ok">Everything required is complete.</div>
        ) : (
          <div className="banner warn">
            <div>
              <strong>Before approval:</strong>
              <ProblemList problems={payload.readiness} onGo={(t) => go(sectionFor(t, ids), t)} />
            </div>
          </div>
        )}
        <div className="row">
          <input placeholder="Approval note (optional), e.g. agreed with second reviewer" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" disabled={payload.readiness.length > 0 || study.status === 'approved'} onClick={approve}>
            {study.status === 'approved' ? '✓ Approved' : study.approvedRevisionId ? 'Approve changes as a new revision' : 'Approve study'}
          </button>
        </div>
        {approvedRev && (
          <div className="small muted mt-sm">
            Current approved revision: #{approvedRev.revisionNo} by {approvedRev.approvedBy}, {fmtTime(approvedRev.approvedAt)}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Domain sessions</h3>
        <table className="t">
          <thead>
            <tr>
              <th>Result</th>
              <th>Triage</th>
              <th>Assessments</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payload.results.map((r) => {
              const t = evaluateTriage(r.triage.answers as AnswerMap);
              const list = payload.assessments.filter((a) => a.resultId === r.id);
              const mine = list.find((a) => a.reviewer === reviewer && a.role !== 'consensus');
              const inRevision = !!study.approvedRevisionId;
              return (
                <tr key={r.id}>
                  <td>
                    Result {r.ordinal}: {r.outcome} {r.timePoint && `· ${r.timePoint}`} {r.analysis && `· ${r.analysis}`}
                  </td>
                  <td>
                    <span className={`chip ${t.status === 'critical' ? 'bad' : t.status === 'passed' ? 'ok' : 'warn'}`}>{t.status}</span>
                  </td>
                  <td>
                    {list.map((a) => (
                      <span key={a.id} className="chip">
                        {a.role === 'consensus' ? 'consensus' : a.reviewer} · {a.status} {a.visible && a.overall ? <JudgementBadge j={a.overall as never} /> : null}
                      </span>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {mine ? (
                      <button className="sm primary" onClick={() => nav(`/assessments/${mine.id}`)}>
                        {mine.status === 'draft' ? 'Continue' : 'Open'}
                      </button>
                    ) : (
                      <button className="sm primary" disabled={!inRevision || r.effect === 'per-protocol' || study.data.targetTrial.c4 === 'Yes'} onClick={() => void start(r.id)}>
                        Start Domain session
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {payload.revisions.length > 0 && (
        <div className="card">
          <h3>Revision history</h3>
          <table className="t">
            <tbody>
              {payload.revisions.map((r) => (
                <tr key={r.id}>
                  <td>#{r.revisionNo}</td>
                  <td>{r.approvedBy}</td>
                  <td>{fmtTime(r.approvedAt)}</td>
                  <td className="muted">{r.note}</td>
                  <td className="mono faint">{r.hash.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
