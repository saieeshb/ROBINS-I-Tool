import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Project, VerificationDecision } from '@robercop/shared';
import { errorMessage, post } from '../../api';
import { useCrumbs } from '../../App';
import { Icon } from '../../components/Icon';
import { JudgementBadge, fmtTime } from '../../components/ui';
import { useResource } from '../../hooks/data';
import { useSession } from '../../session';

interface Summary {
  id: string;
  role: string;
  reviewer: string;
  status: string;
  visible: boolean;
  overall: string;
  outstanding: number;
  problems: number;
}

interface VerifyPayload {
  project: Project;
  study: { id: string; label: string };
  result: { id: string; name: string };
  assessments: Summary[];
  comparison: { target: string; label: string; kind: string; values: Record<string, string>; agree: boolean }[] | null;
  consensus: { id: string; status: string; items: { id: string; target: string; resolvedAt: string | null }[] } | null;
  checking: {
    assessmentId: string;
    reviewer: string;
    status: { unverified: string[]; open: VerificationDecision[]; awaitingRecheck: string[]; changedSinceCheck: string[] };
    decisions: VerificationDecision[];
  } | null;
}

export function VerifyPage() {
  const { resultId } = useParams();
  const { data, error, reload } = useResource<VerifyPayload>(`/results/${resultId}/verify`);
  const nav = useNavigate();
  const { toast, reviewer } = useSession();
  useCrumbs(data ? [{ label: data.project.name, to: `/projects/${data.project.id}` }, { label: data.study.label, to: `/studies/${data.study.id}` }, { label: `${data.result.name} · Verify` }] : []);
  if (error) return <div className="page banner bad">{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const peers = data.assessments.filter((a) => a.role !== 'consensus');
  const mode = data.project.verificationMode;

  const startConsensus = async () => {
    try {
      const c = await post<{ id: string }>(`/results/${resultId}/consensus`, {});
      nav(`/assessments/${c.id}?view=D1`);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const startSecond = async () => {
    try {
      const a = await post<{ id: string }>(`/results/${resultId}/assessments`, {});
      nav(`/assessments/${a.id}`);
    } catch (e) {
      toast(errorMessage(e), true);
      void reload();
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Verify: {data.result.name}</h1>
          <div className="sub">
            {data.study.label} · <span className="chip accent">{mode === 'independent' ? 'Independent double assessment' : 'Checking of first assessment'}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Assessments</h3>
        <table className="t">
          <thead>
            <tr>
              <th>Reviewer</th>
              <th>Role</th>
              <th>Status</th>
              <th>Overall</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.assessments.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.role === 'consensus' ? (
                    <span className="row gap-sm">
                      <Icon name="scale" /> Consensus
                    </span>
                  ) : (
                    a.reviewer
                  )}
                </td>
                <td>{a.role}</td>
                <td>{a.status}</td>
                <td>{a.visible ? <JudgementBadge j={a.overall as never} /> : <span className="small faint">hidden during independent review</span>}</td>
                <td style={{ textAlign: 'right' }}>{a.visible && <Link to={`/assessments/${a.id}`}>Open →</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mode === 'independent' && peers.length < 2 && !peers.some((p) => p.reviewer === reviewer) && (
          <div className="row mt">
            <span className="small muted grow">A second reviewer assesses independently; the first assessment stays hidden from them until they submit.</span>
            <button className="primary" onClick={() => void startSecond()}>
              Start independent assessment as {reviewer}
            </button>
          </div>
        )}
      </div>

      {mode === 'independent' && (
        <div className="card">
          <h3>Comparison</h3>
          {!data.comparison ? (
            <p className="small muted">Available when both independent assessments are submitted (and you are one of the reviewers, or both are submitted).</p>
          ) : (
            <>
              <p className="small">
                {data.comparison.filter((r) => !r.agree).length} differences of {data.comparison.length} items.
              </p>
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Item</th>
                      {peers.map((p) => (
                        <th key={p.id} className="c">
                          {p.reviewer}
                        </th>
                      ))}
                      <th className="c">Agree</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.map((r) => (
                      <tr key={r.target} className={r.agree ? '' : 'diff'}>
                        <td style={{ fontWeight: r.kind !== 'question' ? 700 : undefined }}>{r.kind === 'question' ? r.label : `${r.target === 'overall' ? '' : `${r.target}. `}${r.label}`}</td>
                        {peers.map((p) => (
                          <td key={p.id} className="c diffcell">
                            {r.kind === 'question' ? r.values[p.id] || '—' : <JudgementBadge j={r.values[p.id] as never} />}
                          </td>
                        ))}
                        <td className="c">{r.agree ? '✓' : '✗'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.consensus ? (
                <div className="row mt">
                  <span className="grow">
                    Consensus record: {data.consensus.status} · {data.consensus.items.filter((i) => i.resolvedAt).length}/{data.consensus.items.length} disagreements resolved
                  </span>
                  <Link className="btn primary" to={`/assessments/${data.consensus.id}?view=D1`}>
                    Open consensus →
                  </Link>
                </div>
              ) : (
                <div className="row mt">
                  <span className="grow small muted">Reconciliation creates a separate consensus record. Both original assessments are preserved unchanged.</span>
                  <button className="primary" onClick={() => void startConsensus()}>
                    Start reconciliation
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'checking' && (
        <div className="card">
          <h3>Checking</h3>
          {!data.checking ? (
            <p className="small muted">Available once the first assessment is submitted.</p>
          ) : (
            <>
              <div className="grid cols-4 mb">
                <div className="card flat stat">
                  <div className="n">{data.checking.status.unverified.length}</div>
                  <div className="l">Not yet checked</div>
                </div>
                <div className="card flat stat">
                  <div className="n">{data.checking.status.open.length}</div>
                  <div className="l">Change requests open</div>
                </div>
                <div className="card flat stat">
                  <div className="n">{data.checking.status.awaitingRecheck.length}</div>
                  <div className="l">Awaiting re-check</div>
                </div>
                <div className="card flat stat">
                  <div className="n">{data.checking.status.changedSinceCheck.length}</div>
                  <div className="l">Changed after checking</div>
                </div>
              </div>
              <div className="row">
                <span className="grow small muted">
                  {data.checking.reviewer === reviewer
                    ? 'You are the first reviewer: respond to change requests on each question (reopen from Finish to make changes, then resubmit).'
                    : `Check ${data.checking.reviewer}’s answers question by question in the workspace, with the PDF alongside.`}
                </span>
                <Link className="btn primary" to={`/assessments/${data.checking.assessmentId}?view=D1`}>
                  {data.checking.reviewer === reviewer ? 'Open my assessment' : 'Open to check'} →
                </Link>
              </div>
              {data.checking.decisions.length > 0 && (
                <table className="t mt">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Verdict</th>
                      <th>Proposed</th>
                      <th>Comment</th>
                      <th>Response</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.checking.decisions
                      .filter((d) => d.resolution !== 'superseded')
                      .map((d) => (
                        <tr key={d.id}>
                          <td className="mono">{d.target}</td>
                          <td>{d.verdict.replace('_', ' ')}</td>
                          <td className="mono">{d.proposedAnswer}</td>
                          <td className="small">{d.comment}</td>
                          <td className="small">{d.resolution ? `${d.resolution}${d.resolutionNote ? `: ${d.resolutionNote}` : ''}` : d.verdict === 'confirmed' ? '' : 'open'}</td>
                          <td className="small faint">{fmtTime(d.createdAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
