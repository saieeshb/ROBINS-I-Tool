import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DOMAINS, getQuestion, judgementLabel, type Judgement } from '@robercop/rules';
import { download, errorMessage, post } from '../../api';
import { JudgementBadge, ProblemList, TextArea, fmtTime } from '../../components/ui';
import { useSession } from '../../session';
import { useTheme } from '../../theme';
import { useAssess, type View } from './context';
import { CheckerControls, VerificationNotes } from './Review';

export function TriagePanel() {
  const { ev, payload } = useAssess();
  const r = ev.result;
  if (!r) return <div className="banner bad">This result is not in the approved study revision.</div>;
  return (
    <div>
      <h2>Result &amp; triage</h2>
      <p className="small muted">
        From the approved Study session (revision #{payload.revision.revisionNo}, {payload.revision.approvedBy}, {fmtTime(payload.revision.approvedAt)}). Change these in the Study session and approve
        again.
      </p>
      <div className="card">
        <table className="t">
          <tbody>
            <tr>
              <td style={{ width: 200 }}>Outcome</td>
              <td>
                {r.outcome} {r.timePoint && `· ${r.timePoint}`}
              </td>
            </tr>
            <tr>
              <td>Comparison / analysis</td>
              <td>
                {r.comparison} {r.analysis && `· ${r.analysis}`}
              </td>
            </tr>
            <tr>
              <td>A1. Numerical result</td>
              <td>{r.numericalResult}</td>
            </tr>
            <tr>
              <td>A2. Details</td>
              <td>{r.location}</td>
            </tr>
            <tr>
              <td>A3. Outcome</td>
              <td>{r.outcomeDefinition}</td>
            </tr>
            <tr>
              <td>C1–C3</td>
              <td className="small">
                <div>C1: {payload.revision.snapshot.data.targetTrial.c1}</div>
                <div>C2: {payload.revision.snapshot.data.targetTrial.c2}</div>
                <div>C3: {payload.revision.snapshot.data.targetTrial.c3}</div>
                <div>C4: No (intention-to-treat, Domain 1 Variant A)</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>B. Triage</h3>
        {(['B1', 'B2', 'B3'] as const).map((q) => {
          const st = ev.triage.questions.find((x) => x.id === q)!;
          if (!st.reached) return null;
          return (
            <div key={q} className="row top mb">
              <span className="mono" style={{ fontWeight: 700, width: 36 }}>
                {q}
              </span>
              <div className="grow">
                <div>{getQuestion(q)!.text}</div>
                {r.triage.notes[q] && <div className="small muted">{r.triage.notes[q]}</div>}
              </div>
              <span className="answer-chip">{r.triage.answers[q] || '—'}</span>
            </div>
          );
        })}
        {ev.triageCritical ? (
          <div className="banner bad">{ev.triage.reason} The result is at Critical risk of bias and no domain assessment is required. Confirm the overall judgement.</div>
        ) : (
          <div className="banner ok">Triage passed: assess Domains 1–6.</div>
        )}
      </div>
    </div>
  );
}

export function OverallPanel() {
  const { ev, a, canEdit, decideOverall, setView } = useAssess();
  const o = ev.overall.evaluation;
  const [choice, setChoice] = useState<Judgement | ''>(a.overall.final);
  const [reason, setReason] = useState(a.overall.reason);
  useEffect(() => {
    setChoice(a.overall.final);
    setReason(a.overall.reason);
  }, [a.overall.final, a.overall.reason]);
  const escalating = choice && o.suggested && choice !== o.suggested;
  return (
    <div>
      <h2>Overall risk of bias</h2>
      <p className="small muted">
        ROBINS-I defaults the overall judgement to the worst domain. You may judge a greater risk when problems in several domains compound; a reason is required. It can never be lower than the worst domain.
      </p>
      {!ev.triageCritical && (
        <div className="card">
          <table className="t">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Algorithm</th>
                <th>Final</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {DOMAINS.map((d) => {
                const st = ev.domains[d.id];
                return (
                  <tr key={d.id}>
                    <td>
                      <a onClick={() => setView(d.id)} style={{ cursor: 'pointer' }}>
                        {d.id}. {d.short}
                      </a>
                    </td>
                    <td>
                      <JudgementBadge j={st.evaluation.suggested} />
                    </td>
                    <td>
                      <JudgementBadge j={st.final} />
                      {st.final && st.final !== st.evaluation.suggested && <span className="small muted"> override</span>}
                    </td>
                    <td className="small">{st.decision.needsReconfirm ? <span style={{ color: 'var(--warn)' }}>⚠ reconfirm</span> : !st.check.ok ? <span className="muted">not confirmed</span> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="algo">
        {o.status !== 'complete' ? (
          <div className="small">Confirm all six domain judgements first ({o.missingDomains.join(', ')} missing).</div>
        ) : (
          <>
            <div className="row">
              <span>Default (worst domain{o.worstDomains.length ? `: ${o.worstDomains.join(', ')}` : ''}):</span>
              <JudgementBadge j={o.suggested} large label={o.suggested ? judgementLabel(o.suggested, 'overall') : undefined} />
            </div>
            {o.compounding && (
              <div className="flag info mt-sm">
                <span>
                  {o.compounding.reason} Escalation is your decision and needs a reason.
                </span>
              </div>
            )}
            {canEdit && (
              <>
                <div className="row wrap mt">
                  {o.allowed.map((j) => (
                    <button key={j} className={choice === j ? 'primary' : ''} onClick={() => (setChoice(j), j === o.suggested && decideOverall(j, ''))}>
                      {j === o.suggested ? `Confirm ${j}` : `Escalate to ${j}`}
                    </button>
                  ))}
                </div>
                {escalating && (
                  <div className="mt-sm">
                    <TextArea value={reason} rows={2} placeholder="Why do problems compound? (required)" onChange={setReason} />
                    <button className="mt-sm" disabled={reason.trim().length < 10} onClick={() => decideOverall(choice as Judgement, reason)}>
                      Record overall: {choice}
                    </button>
                  </div>
                )}
              </>
            )}
            {a.overall.final && (
              <div className="row mt">
                Final overall: <JudgementBadge j={a.overall.final} large />
                <span className="small muted">
                  by {a.overall.decidedBy} · {fmtTime(a.overall.decidedAt)}
                  {a.overall.reason ? ` — ${a.overall.reason}` : ''}
                </span>
              </div>
            )}
            {a.overall.needsReconfirm && <div className="flag">⚠ {a.overall.needsReconfirm}</div>}
            {a.overall.final && (
              <div className="row mt">
                <span className="spacer" />
                <button className="primary" onClick={() => setView('finish')}>
                  Finish →
                </button>
              </div>
            )}
          </>
        )}
        <VerificationNotes target="overall" />
        <CheckerControls target="overall" options={['Low', 'Moderate', 'Serious', 'Critical']} />
      </div>
    </div>
  );
}

function targetToView(t: string): { view: string; q?: string } {
  const m = t.match(/^Q(\d)\./);
  if (m) return { view: `D${m[1]}`, q: t };
  if (/^D\d$/.test(t)) return { view: t };
  if (t === 'overall') return { view: 'overall' };
  if (t === 'triage' || t === 'scope') return { view: 'triage' };
  return { view: 'finish' };
}

export function FinishPanel() {
  const { ev, a, payload, setView, reload, settle, canEdit, isChecker } = useAssess();
  const { toast, reviewer } = useSession();
  const { theme } = useTheme();
  const [reason, setReason] = useState('');
  const submit = async () => {
    try {
      await settle();
      await post(`/assessments/${a.id}/submit`, {});
      toast('Submitted. Your answers are now locked; the next step is verification.');
      void reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const reopen = async () => {
    try {
      await settle();
      await post(`/assessments/${a.id}/reopen`, { reason });
      setReason('');
      void reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const finalize = async () => {
    try {
      await settle();
      await post(`/assessments/${a.id}/finalize`, {});
      toast('Finalized.');
      void reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const status = payload.verification?.status;
  return (
    <div>
      <h2>Finish</h2>
      <div className="card">
        <div className="row">
          <div className="grow">
            Status: <strong>{a.status}</strong>
            {a.submittedAt && <span className="small muted"> · submitted {fmtTime(a.submittedAt)}</span>}
            {a.finalizedAt && <span className="small muted"> · finalized {fmtTime(a.finalizedAt)}</span>}
          </div>
          <JudgementBadge j={a.overall.final} large />
        </div>
        {a.status === 'draft' && (
          <>
            {ev.problems.length > 0 ? (
              <div className="banner warn mt">
                <div>
                  <strong>To submit, resolve:</strong>
                  <ProblemList problems={ev.problems} onGo={(t) => {
                    const v = targetToView(t);
                    setView(v.view as never, v.q);
                  }} />
                </div>
              </div>
            ) : (
              <div className="banner ok mt">Complete: every reached question answered by a reviewer, judgements confirmed, quotations verified.</div>
            )}
            {canEdit && a.role !== 'consensus' && (
              <button className="primary" disabled={ev.problems.length > 0} onClick={() => void submit()}>
                Submit assessment
              </button>
            )}
          </>
        )}
        {(a.status === 'submitted' || a.status === 'finalized') && a.reviewer === reviewer && (
          <div className="row mt">
            <input placeholder="Reason for reopening (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button disabled={!reason.trim()} onClick={() => void reopen()}>
              Reopen
            </button>
          </div>
        )}
      </div>

      {(a.role === 'consensus' || payload.project.verificationMode === 'checking') && a.status !== 'finalized' && (
        <div className="card">
          <h3>Finalize</h3>
          {status && (
            <div className="small mb">
              Not yet checked: {status.unverified.length} · open requests: {status.open.length} · awaiting re-check: {status.awaitingRecheck.length} · changed after checking: {status.changedSinceCheck.length}
            </div>
          )}
          {payload.finalizeProblems.length > 0 ? (
            <ProblemList problems={payload.finalizeProblems.map((m) => ({ target: 'finalize', message: m }))} />
          ) : (
            <div className="banner ok">Ready to finalize.</div>
          )}
          {(a.role === 'consensus' || isChecker) && (
            <button className="primary mt" disabled={payload.finalizeProblems.length > 0} onClick={() => void finalize()}>
              Finalize documented assessment
            </button>
          )}
          {isChecker && status && status.awaitingRecheck.length + status.changedSinceCheck.length > 0 && (
            <div className="small mt">
              To check again:{' '}
              {[...status.awaitingRecheck, ...status.changedSinceCheck].map((t) => (
                <button key={t} className="xs" style={{ marginRight: 4 }} onClick={() => setView(t === 'overall' ? 'overall' : ((t.startsWith('Q') ? `D${t[1]}` : t) as View), t.startsWith('Q') ? t : null)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {isChecker && status && status.unverified.length > 0 && (
            <button
              className="mt"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                if (!confirm(`Confirm all ${status.unverified.length} unchecked answers and judgements as they stand?`)) return;
                try {
                  await post(`/assessments/${a.id}/verifications/confirm`, { targets: status.unverified });
                  void reload();
                } catch (e) {
                  toast(errorMessage(e), true);
                }
              }}
            >
              Confirm all remaining ({status.unverified.length})
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h3>Outputs</h3>
        <div className="row wrap">
          <a className="btn" href={`/api/assessments/${a.id}/report?reviewer=${encodeURIComponent(reviewer)}&theme=${theme}`} target="_blank" rel="noreferrer">
            Printable report ↗
          </a>
          <button onClick={() => void download(`/assessments/${a.id}/export.xlsx`, 'assessment.xlsx').catch((e) => toast(errorMessage(e), true))}>Excel</button>
          <button onClick={() => void download(`/assessments/${a.id}/export.json`, 'assessment.json').catch((e) => toast(errorMessage(e), true))}>JSON</button>
          <Link className="btn" to={`/results/${a.resultId}/verify`}>
            Verify →
          </Link>
        </div>
      </div>
    </div>
  );
}
