import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Project } from '@robercop/shared';
import { errorMessage, post } from '../api';
import { useCrumbs } from '../App';
import { Empty, Field, JudgementBadge, Modal, STATUS_CHIP } from '../components/ui';
import { usePoll, useResource } from '../hooks/data';
import { useSession } from '../session';

interface DashAssessment {
  id: string;
  role: 'first' | 'second' | 'consensus';
  reviewer: string;
  status: string;
  visible: boolean;
  overall: string;
  outstanding: number;
  problems: number;
}

interface DashResult {
  id: string;
  name: string;
  triage: string;
  reviewStatus: string;
  assessments: DashAssessment[];
}

interface DashStudy {
  id: string;
  label: string;
  citation: string;
  status: 'draft' | 'approved' | 'changed';
  approvedRevisionId: string | null;
  documents: number;
  parsed: number;
  parsing: number;
  results: DashResult[];
}

interface Dashboard {
  project: Project;
  studies: DashStudy[];
  totals: { studies: number; results: number; finalized: number; inProgress: number; outstandingQuestions: number };
}

const STUDY_STATUS: Record<DashStudy['status'], string> = { draft: 'Study session in progress', approved: 'Approved', changed: 'Changed since approval' };

export function DashboardPage() {
  const { projectId } = useParams();
  const { data, error, reload } = useResource<Dashboard>(`/projects/${projectId}/dashboard`);
  const [adding, setAdding] = useState(false);
  useCrumbs(data ? [{ label: data.project.name }] : []);
  usePoll(reload, !!data?.studies.some((s) => s.parsing > 0), 2000);
  if (error) return <div className="page banner bad">{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const t = data.totals;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{data.project.name}</h1>
          <div className="sub">
            <span className="chip accent">{data.project.verificationMode === 'independent' ? 'Independent double assessment' : 'Checking of first assessment'}</span>
            <span className="small faint"> · rules {data.project.rulesetVersion}</span>
          </div>
        </div>
        <Link className="btn" to={`/projects/${projectId}/transfer`}>
          Import / export
        </Link>
        <Link className="btn" to={`/projects/${projectId}/setup`}>
          Project setup
        </Link>
        <button className="primary" onClick={() => setAdding(true)}>
          + Add study
        </button>
      </div>

      <div className="grid cols-5 mb">
        <div className="card stat">
          <div className="n">{t.studies}</div>
          <div className="l">Studies</div>
        </div>
        <div className="card stat">
          <div className="n">{t.results}</div>
          <div className="l">Results to assess</div>
        </div>
        <div className="card stat">
          <div className="n">{t.inProgress}</div>
          <div className="l">In progress</div>
        </div>
        <div className="card stat">
          <div className="n">{t.finalized}</div>
          <div className="l">Finalized</div>
        </div>
        <div className="card stat">
          <div className="n">{t.outstandingQuestions}</div>
          <div className="l">Outstanding questions (visible to you)</div>
        </div>
      </div>

      {data.studies.length === 0 ? (
        <div className="card">
          <Empty>
            <p>No studies yet. Add a study, attach its PDF, and work through the Study session.</p>
            <button className="primary" onClick={() => setAdding(true)}>
              + Add study
            </button>
          </Empty>
        </div>
      ) : (
        data.studies.map((s) => <StudyRow key={s.id} s={s} mode={data.project.verificationMode} onChange={reload} />)
      )}
      {adding && <AddStudy projectId={projectId!} onClose={() => setAdding(false)} />}
    </div>
  );
}

function StudyRow({ s, mode, onChange }: { s: DashStudy; mode: 'independent' | 'checking'; onChange: () => void }) {
  const nav = useNavigate();
  const { reviewer, toast } = useSession();
  const start = async (resultId: string) => {
    try {
      const a = await post<{ id: string }>(`/results/${resultId}/assessments`, {});
      nav(`/assessments/${a.id}`);
    } catch (e) {
      toast(errorMessage(e), true);
      onChange();
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <div className="grow">
          <h3>
            <Link to={`/studies/${s.id}`}>{s.label}</Link>
          </h3>
          <div className="small muted truncate">{s.citation || 'No citation yet'}</div>
        </div>
        <span className={`chip ${STATUS_CHIP[s.status]}`}>{STUDY_STATUS[s.status]}</span>
        <span className="chip" title="Documents parsed">
          {s.parsing > 0 ? '⏳ parsing' : `📄 ${s.parsed}/${s.documents} parsed`}
        </span>
        <Link className="btn" to={`/studies/${s.id}`}>
          Study session
        </Link>
      </div>
      {s.results.length === 0 ? (
        <div className="small muted">No results defined yet. Define numerical results in the Study session.</div>
      ) : (
        <table className="t">
          <thead>
            <tr>
              <th>Result</th>
              <th>Triage</th>
              <th>Assessments</th>
              <th>Review status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.results.map((r) => {
              const mine = r.assessments.find((a) => a.reviewer === reviewer && a.role !== 'consensus');
              const consensus = r.assessments.find((a) => a.role === 'consensus');
              const final = r.assessments.find((a) => a.status === 'finalized');
              const peers = r.assessments.filter((a) => a.role !== 'consensus');
              const canStart = !mine && s.approvedRevisionId && (mode === 'checking' ? peers.length === 0 : peers.length < 2);
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <span className={`chip ${r.triage === 'critical' ? 'bad' : r.triage === 'passed' ? 'ok' : 'warn'}`}>{r.triage}</span>
                  </td>
                  <td>
                    <div className="row wrap gap-sm">
                      {r.assessments.map((a) => (
                        <span key={a.id} className="chip" title={a.visible ? `${a.outstanding} outstanding, ${a.problems} open items` : 'Hidden until your own independent assessment is submitted'}>
                          {a.role === 'consensus' ? '⚖ consensus' : a.reviewer} · {a.status}
                          {a.visible && a.overall ? (
                            <>
                              {' '}
                              <JudgementBadge j={a.overall as never} />
                            </>
                          ) : null}
                          {a.visible && a.status === 'draft' && a.outstanding ? ` · ${a.outstanding} open` : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`chip ${STATUS_CHIP[r.reviewStatus] ?? ''}`}>{r.reviewStatus}</span>
                    {final && <JudgementBadge j={final.overall as never} />}
                  </td>
                  <td className="nowrap" style={{ textAlign: 'right' }}>
                    {mine && (
                      <Link className="btn sm primary" to={`/assessments/${mine.id}`}>
                        {mine.status === 'draft' ? 'Continue' : 'Open'}
                      </Link>
                    )}{' '}
                    {canStart && (
                      <button className="sm primary" onClick={() => start(r.id)}>
                        Start Domain session
                      </button>
                    )}{' '}
                    {consensus && (
                      <Link className="btn sm" to={`/assessments/${consensus.id}`}>
                        Consensus
                      </Link>
                    )}{' '}
                    {r.assessments.length > 0 && (
                      <Link className="btn sm" to={`/results/${r.id}/verify`}>
                        Verify
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!s.approvedRevisionId && s.results.length > 0 && <div className="small muted mt-sm">Approve the Study session to start Domain sessions.</div>}
      {s.status === 'changed' && <div className="small mt-sm" style={{ color: 'var(--warn)' }}>The study changed after approval. Domain sessions use the approved revision until you approve again.</div>}
    </div>
  );
}

function AddStudy({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const nav = useNavigate();
  const { toast } = useSession();
  const [label, setLabel] = useState('');
  const [citation, setCitation] = useState('');
  const go = async () => {
    try {
      const st = await post<{ id: string }>(`/projects/${projectId}/studies`, { label, citation });
      nav(`/studies/${st.id}/sources`);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  return (
    <Modal
      title="Add study"
      onClose={onClose}
      foot={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!label.trim()} onClick={go}>
            Add and attach sources
          </button>
        </>
      }
    >
      <Field label="Study label" hint='Short identifier used throughout, e.g. "Smith 2021".'>
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Citation (optional now)">
        <textarea rows={2} value={citation} onChange={(e) => setCitation(e.target.value)} />
      </Field>
    </Modal>
  );
}
