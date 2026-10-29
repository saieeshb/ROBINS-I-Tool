import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Project } from '@robercop/shared';
import { download, errorMessage, post, postDownload, upload } from '../api';
import { useCrumbs } from '../App';
import { Field, fmtTime } from '../components/ui';
import { useResource } from '../hooks/data';
import { useSession } from '../session';

type PackageKind = 'independent_assignment' | 'checking_assignment' | 'completed_review';

interface DashStudy {
  id: string;
  label: string;
  status: 'draft' | 'approved' | 'changed';
  approvedRevisionId: string | null;
  results: { id: string; name: string; assessments: { id: string; reviewer: string; role: string; status: string }[] }[];
}

interface PackageRecord {
  id: string;
  direction: 'export' | 'import';
  kind: PackageKind;
  filename: string;
  status: string;
  notes: string[];
  createdBy: string;
  createdAt: string;
  manifest: { createdBy?: string; study?: { label: string }; note?: string };
}

interface PackagePreview {
  token: string;
  manifest: { kind: PackageKind; createdBy: string; createdAt: string; note: string; project: { name: string; verificationMode: string }; study: { label: string; revision: { revisionNo: number } } };
  project: { exists: boolean; name: string; modeMatches: boolean };
  study: { exists: boolean; label: string };
  baseline: { status: 'same' | 'new_study' | 'older_local' | 'changed'; message: string };
  documents: { label: string; status: 'new' | 'present' }[];
  assessments: { id: string; reviewer: string; role: string; status: string; result: string; state: 'new' | 'identical' | 'update' | 'older' | 'conflict'; detail: string }[];
  evidence: { new: number; present: number; conflicts: number };
  warnings: string[];
}

interface LegacyPreview {
  token: string;
  source: 'json-study' | 'json-domain' | 'xlsx' | 'xlsx-evidence-bank';
  summary: { citation: string; reviewer: string; date: string; outcomes: string[]; confounders: number; answers: number; judgements: string[]; evidenceBank: number };
  study: { mode: 'new' | 'existing'; id: string | null; label: string };
  willCreate: string[];
  warnings: string[];
}

export const KIND_LABEL: Record<PackageKind, string> = {
  independent_assignment: 'Independent assignment',
  checking_assignment: 'Checking assignment',
  completed_review: 'Completed review'
};

const STATE_CHIP: Record<PackagePreview['assessments'][number]['state'], [string, string]> = {
  new: ['accent', 'New'],
  identical: ['', 'Unchanged'],
  update: ['ok', 'Update'],
  older: ['', 'Already newer here'],
  conflict: ['warn', 'Changed on both sides']
};

const SOURCE_LABEL: Record<LegacyPreview['source'], string> = {
  'json-study': 'Study session (JSON)',
  'json-domain': 'Domain session (JSON)',
  xlsx: 'Excel export',
  'xlsx-evidence-bank': 'Excel export (Evidence Bank edition)'
};

export function ImportExportPage() {
  const { projectId } = useParams();
  const { data: dash, reload } = useResource<{ project: Project; studies: DashStudy[] }>(`/projects/${projectId}/dashboard`);
  const { data: packages, reload: reloadPackages } = useResource<PackageRecord[]>(`/projects/${projectId}/packages`);
  useCrumbs([{ label: dash?.project.name ?? 'Project', to: `/projects/${projectId}` }, { label: 'Import / export' }]);
  if (!dash) return <div className="page muted">Loading…</div>;
  const refresh = () => {
    reload();
    reloadPackages();
  };
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Import / export</h1>
          <div className="sub">
            Within this computer, reviewers share one project and nothing needs to be transferred. Packages are only for reviewers working on different computers.
          </div>
        </div>
      </div>
      <div className="grid cols-2">
        <SendPackage project={dash.project} studies={dash.studies} onDone={reloadPackages} />
        <div className="card">
          <div className="card-head">
            <h3>Receive a package</h3>
          </div>
          <p className="small muted">Open a .robercop.zip file from another reviewer. You will see exactly what it contains and what will change before anything is imported. Existing work is never overwritten.</p>
          <PackageImport onImported={refresh} />
        </div>
      </div>
      <div className="grid cols-2 mt">
        <LegacyImport projectId={projectId!} studies={dash.studies} onImported={refresh} />
        <ProjectExports projectId={projectId!} />
      </div>
      <PackageLog packages={packages ?? []} />
    </div>
  );
}

function SendPackage({ project, studies, onDone }: { project: Project; studies: DashStudy[]; onDone: () => void }) {
  const { reviewer, toast } = useSession();
  const approved = studies.filter((s) => s.approvedRevisionId);
  const [studyId, setStudyId] = useState(approved[0]?.id ?? '');
  const assignmentKind: PackageKind = project.verificationMode === 'independent' ? 'independent_assignment' : 'checking_assignment';
  const [kind, setKind] = useState<PackageKind>(assignmentKind);
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const study = approved.find((s) => s.id === studyId);
  const send = async () => {
    setBusy(true);
    try {
      await postDownload(`/projects/${project.id}/packages/export`, { studyId, kind, resultIds: resultIds.length ? resultIds : undefined, note }, 'review-package.robercop.zip');
      toast('Package created. Send the downloaded file to the other reviewer.');
      onDone();
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };
  const describe: Record<PackageKind, string> = {
    independent_assignment:
      'For the second reviewer: the study PDFs, their parsed text and the approved study details. Your answers, judgements, rationale, notes, question tags and assistant output are not included.',
    checking_assignment: 'For the checker: the study PDFs, parsed text, approved study details and the submitted first assessment(s) with their evidence and history.',
    completed_review: `Send back your own work${reviewer ? ` (${reviewer})` : ''}: your assessments, or the assessments you checked with your verification decisions.`
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3>Send work to another reviewer</h3>
      </div>
      {approved.length === 0 ? (
        <p className="muted small">Approve a Study session first; packages carry the approved study revision.</p>
      ) : (
        <div className="col">
          <Field label="Study">
            <select value={studyId} onChange={(e) => (setStudyId(e.target.value), setResultIds([]))}>
              {approved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.status === 'changed' ? ' (changed since approval — the approved revision is sent)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Package">
            <div className="col" style={{ gap: 4 }}>
              {([assignmentKind, 'completed_review'] as PackageKind[]).map((k) => (
                <label key={k} className="checkbox">
                  <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                  <span>
                    <strong>{KIND_LABEL[k]}</strong>
                    <div className="small muted">{describe[k]}</div>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          {study && study.results.length > 1 && (
            <Field label="Results" hint="Leave all unticked to include every result.">
              {study.results.map((r) => (
                <label key={r.id} className="checkbox">
                  <input type="checkbox" checked={resultIds.includes(r.id)} onChange={(e) => setResultIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))} />
                  <span>{r.name}</span>
                </label>
              ))}
            </Field>
          )}
          <Field label="Note to the recipient (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please assess both results by Friday" />
          </Field>
          <div className="row">
            <span className="grow small faint">Sent by {reviewer || '—'}</span>
            <button className="primary" disabled={busy || !studyId || !reviewer} onClick={() => void send()}>
              {busy ? 'Creating…' : 'Create package'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Choose a package, preview what it would change, then confirm. Used here and on the Projects page. */
export function PackageImport({ onImported }: { onImported: (record: { projectId: string; notes: string[] }) => void }) {
  const { toast } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [conflicts, setConflicts] = useState<'skip' | 'copy'>('skip');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ projectId: string; notes: string[] } | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setDone(null);
    try {
      setPreview(await upload<PackagePreview>('/packages/preview', file));
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const rec = await post<{ projectId: string; notes: string[] }>('/packages/commit', { token: preview.token, conflicts });
      setDone(rec);
      setPreview(null);
      onImported(rec);
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };
  const hasConflict = preview?.assessments.some((a) => a.state === 'conflict');
  return (
    <div className="col">
      <div className="row">
        <input ref={input} type="file" accept=".zip,application/zip" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
        {busy && <span className="small muted">Reading…</span>}
      </div>
      {done && (
        <div className="banner ok">
          <div>
            <strong>Imported.</strong>
            <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {done.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {preview && (
        <div className="card flat">
          <div className="row wrap">
            <strong className="grow">
              {KIND_LABEL[preview.manifest.kind]} from {preview.manifest.createdBy}
            </strong>
            <span className="small faint">{fmtTime(preview.manifest.createdAt)}</span>
          </div>
          {preview.manifest.note && <div className="small mt-sm">“{preview.manifest.note}”</div>}
          <div className="small mt-sm">
            Project <strong>{preview.project.name}</strong> {preview.project.exists ? '' : <span className="chip accent">new here</span>} · study <strong>{preview.study.label}</strong>{' '}
            {preview.study.exists ? '' : <span className="chip accent">new here</span>}
          </div>
          <div className={`banner ${preview.baseline.status === 'same' || preview.baseline.status === 'new_study' ? 'info' : 'warn'} mt-sm`}>{preview.baseline.message}</div>
          {preview.warnings.map((w, i) => (
            <div key={i} className="banner warn">
              {w}
            </div>
          ))}
          {preview.documents.length > 0 && (
            <div className="small">
              <strong>Sources:</strong> {preview.documents.map((d) => `${d.label}${d.status === 'new' ? ' (new)' : ''}`).join(', ')}
            </div>
          )}
          <div className="small mt-sm">
            <strong>Evidence:</strong> {preview.evidence.new} new, {preview.evidence.present} already here
            {preview.evidence.conflicts ? `, ${preview.evidence.conflicts} differ (local copies are kept)` : ''}
          </div>
          {preview.assessments.length > 0 && (
            <table className="t mt-sm">
              <thead>
                <tr>
                  <th>Assessment</th>
                  <th>Result</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {preview.assessments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.role === 'consensus' ? 'Consensus' : a.reviewer} <span className="tiny faint">({a.status})</span>
                    </td>
                    <td>{a.result}</td>
                    <td>
                      <span className={`chip ${STATE_CHIP[a.state][0]}`}>{STATE_CHIP[a.state][1]}</span> <span className="small">{a.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {hasConflict && (
            <Field label="Assessments changed on both computers">
              <label className="checkbox">
                <input type="radio" checked={conflicts === 'skip'} onChange={() => setConflicts('skip')} />
                <span>Keep the version on this computer (verification decisions are still imported)</span>
              </label>
              <label className="checkbox">
                <input type="radio" checked={conflicts === 'copy'} onChange={() => setConflicts('copy')} />
                <span>Also import the package version as a separate copy to compare</span>
              </label>
            </Field>
          )}
          <div className="row mt">
            <span className="grow" />
            <button onClick={() => setPreview(null)}>Cancel</button>
            <button className="primary" disabled={busy} onClick={() => void commit()}>
              Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LegacyImport({ projectId, studies, onImported }: { projectId: string; studies: DashStudy[]; onImported: () => void }) {
  const { toast } = useSession();
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ studyId: string; assessmentId: string | null; notes: string[] } | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setDone(null);
    try {
      const p = await upload<LegacyPreview>(`/projects/${projectId}/legacy/preview`, file, target ? { targetStudyId: target } : {});
      setPreview(p);
      setReviewerName(p.summary.reviewer);
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await post<{ studyId: string; assessmentId: string | null; notes: string[] }>(`/projects/${projectId}/legacy/commit`, {
        token: preview.token,
        targetStudyId: preview.study.id,
        reviewer: reviewerName
      });
      setDone(res);
      setPreview(null);
      onImported();
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3>Import from the earlier ROBINS-I tool</h3>
      </div>
      <p className="small muted">
        Saved Study or Domain session files (.json) and both Excel exports (.xlsx) are accepted. Imported answers and judgements are shown as imported and must each be confirmed; the imported study details must be reviewed and approved before any
        assessment can be submitted.
      </p>
      <div className="col">
        <Field label="Into">
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!preview}>
            <option value="">A new study</option>
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                Merge into {s.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <input ref={input} type="file" accept=".json,.xlsx,application/json" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
        {done && (
          <div className="banner ok">
            <div className="grow">
              {done.notes.join(' ')}
              <div className="row mt-sm">
                <button className="sm" onClick={() => nav(`/studies/${done.studyId}`)}>
                  Review the study →
                </button>
                {done.assessmentId && (
                  <button className="sm" onClick={() => nav(`/assessments/${done.assessmentId}`)}>
                    Open the imported assessment →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {preview && (
          <div className="card flat">
            <div className="row">
              <strong className="grow">{SOURCE_LABEL[preview.source]}</strong>
              <span className="small faint">{preview.summary.date}</span>
            </div>
            <div className="small mt-sm">{preview.summary.citation || <em>No citation</em>}</div>
            <div className="small faint">
              {preview.summary.outcomes.length} outcome(s) · {preview.summary.confounders} confounders · {preview.summary.answers} answers · {preview.summary.evidenceBank} evidence-bank quotes
              {preview.summary.judgements.length ? ` · ${preview.summary.judgements.join(', ')}` : ''}
            </div>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {preview.willCreate.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {preview.warnings.map((w, i) => (
              <div key={i} className="banner warn">
                {w}
              </div>
            ))}
            {preview.summary.answers > 0 && (
              <Field label="Reviewer who made the imported decisions" hint="Taken from the file. Imported decisions are attributed to this name and must be confirmed by them.">
                <input value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} />
              </Field>
            )}
            <div className="row mt">
              <span className="grow" />
              <button onClick={() => setPreview(null)}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => void commit()}>
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectExports({ projectId }: { projectId: string }) {
  const { toast } = useSession();
  const run = (url: string, name: string) => void download(url, name).catch((e) => toast(errorMessage(e), true));
  return (
    <div className="card">
      <div className="card-head">
        <h3>Export results</h3>
      </div>
      <p className="small muted">
        Every assessment you can see, with judgements, answers, rationale, linked quotations and their source checks, verification decisions and the study details. Independent assessments you are not yet allowed to see are left out.
        Printable reports are available per assessment from its Finish step.
      </p>
      <div className="row wrap">
        <button onClick={() => run(`/projects/${projectId}/export.xlsx`, 'robins-i.xlsx')}>Excel workbook</button>
        <button onClick={() => run(`/projects/${projectId}/export.json`, 'robins-i.json')}>JSON (all data)</button>
      </div>
    </div>
  );
}

function PackageLog({ packages }: { packages: PackageRecord[] }) {
  if (packages.length === 0) return null;
  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Package history</h3>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>When</th>
            <th></th>
            <th>Package</th>
            <th>Study</th>
            <th>By</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{fmtTime(p.createdAt)}</td>
              <td>
                <span className={`chip ${p.direction === 'import' ? 'info' : 'accent'}`}>{p.direction === 'import' ? 'Received' : 'Sent'}</span>
              </td>
              <td>
                {KIND_LABEL[p.kind]}
                {p.manifest.note ? <div className="tiny faint">“{p.manifest.note}”</div> : null}
              </td>
              <td>{p.manifest.study?.label}</td>
              <td>{p.direction === 'import' ? `${p.manifest.createdBy} → ${p.createdBy}` : p.createdBy}</td>
              <td className="small">{p.notes.length ? p.notes.join(' ') : p.filename}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tiny faint mt-sm">
        Sent packages are also kept in the data folder under <code>packages/</code>. <Link to="/settings">Settings</Link> shows where that is.
      </div>
    </div>
  );
}
