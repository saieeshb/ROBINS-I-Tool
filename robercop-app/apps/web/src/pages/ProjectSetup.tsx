import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Project, SourceDocument, ParseJob } from '@robercop/shared';
import { errorMessage, patch, upload } from '../api';
import { useCrumbs } from '../App';
import { BlurInput, Field } from '../components/ui';
import { usePoll, useResource } from '../hooks/data';
import { useSession } from '../session';

type RefDoc = SourceDocument & { job: ParseJob | null; latestJob: ParseJob | null };

export function ProjectSetupPage() {
  const { projectId } = useParams();
  const { data: project, setData, reload } = useResource<Project>(`/projects/${projectId}`);
  const refs = useResource<RefDoc[]>(`/projects/${projectId}/documents`);
  const { toast } = useSession();
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refFile = useRef<HTMLInputElement>(null);
  useCrumbs(project ? [{ label: project.name, to: `/projects/${projectId}` }, { label: 'Project setup' }] : []);
  usePoll(refs.reload, !!refs.data?.some((d) => ['queued', 'running'].includes(d.latestJob?.status ?? '')), 2000);
  if (!project) return <div className="page muted">Loading…</div>;

  const save = async (p: Partial<Project>) => {
    try {
      setData(await patch<Project>(`/projects/${projectId}`, { version: project.version, ...p }));
      toast('Saved');
    } catch (e) {
      toast(errorMessage(e), true);
      void reload();
    }
  };
  const matrix = project.cfMatrix;
  const keys = Object.keys(matrix).filter((k) => k.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <h1>Project setup</h1>
      <div className="card">
        <Field label="Project name">
          <BlurInput value={project.name} onCommit={(v) => v.trim() && v !== project.name && void save({ name: v.trim() })} />
        </Field>
        <div className="label">Verification mode</div>
        <div className="row">
          <select value={project.verificationMode} onChange={(e) => void save({ verificationMode: e.target.value as 'independent' })}>
            <option value="independent">Independent double assessment</option>
            <option value="checking">Checking of the first assessment</option>
          </select>
          <span className="small muted">Locked once verification work has started.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="grow">Confounder matrix (P1: important confounding factors per outcome)</h3>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const m = JSON.parse(await f.text());
              await save({ cfMatrix: m });
            } catch (err) {
              toast(`Could not read the file: ${errorMessage(err)}`, true);
            }
            e.target.value = '';
          }} />
          <button className="sm" onClick={() => fileRef.current?.click()}>
            Import JSON…
          </button>
          <button
            className="sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(matrix, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'important_confounding_factors.json';
              a.click();
            }}
          >
            Export JSON
          </button>
        </div>
        <p className="small muted">Results are matched to an outcome domain here (case-insensitive, partial matches allowed), which pre-fills their important confounding factors. Reviewers can still adjust factors per result.</p>
        <input type="search" placeholder="Filter outcomes…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb" />
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Outcome domain</th>
              <th>Important confounding factors (comma-separated)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td>
                  <BlurInput
                    value={matrix[k].join(', ')}
                    onCommit={(v) => {
                      const factors = v.split(',').map((x) => x.trim()).filter(Boolean);
                      if (factors.join('|') !== matrix[k].join('|')) void save({ cfMatrix: { ...matrix, [k]: factors } });
                    }}
                  />
                </td>
                <td>
                  <button className="xs danger" onClick={() => {
                    if (!confirm(`Remove "${k}" from the matrix?`)) return;
                    const m = { ...matrix };
                    delete m[k];
                    void save({ cfMatrix: m });
                  }}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddOutcome onAdd={(k, factors) => void save({ cfMatrix: { ...matrix, [k]: factors } })} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="grow">Reference documents</h3>
          <input ref={refFile} type="file" accept="application/pdf" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await upload(`/projects/${projectId}/documents`, f, { role: 'reference', label: f.name.replace(/\.pdf$/i, '') });
              void refs.reload();
            } catch (err) {
              toast(errorMessage(err), true);
            }
            e.target.value = '';
          }} />
          <button className="sm" onClick={() => refFile.current?.click()}>
            + Add reference PDF
          </button>
        </div>
        <p className="small muted">
          Project-wide documents such as outcome definitions (e.g. the ECCG consensus on esophagectomy complications). They are searchable in every study and available to the assistant, but
          are not study sources.
        </p>
        {refs.data?.length ? (
          <table className="t">
            <tbody>
              {refs.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.label}</td>
                  <td className="small muted">{d.filename}</td>
                  <td>{d.job ? <span className="chip ok">parsed ({d.job.parser})</span> : <span className="chip warn">{d.latestJob?.status ?? 'not parsed'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small faint">None yet.</p>
        )}
      </div>
    </div>
  );
}

function AddOutcome({ onAdd }: { onAdd: (k: string, factors: string[]) => void }) {
  const [k, setK] = useState('');
  const [f, setF] = useState('');
  return (
    <div className="row mt">
      <input placeholder="New outcome domain" value={k} onChange={(e) => setK(e.target.value)} style={{ width: '32%' }} />
      <input placeholder="Factors, comma-separated" value={f} onChange={(e) => setF(e.target.value)} />
      <button
        disabled={!k.trim()}
        onClick={() => {
          onAdd(k.trim(), f.split(',').map((s) => s.trim()).filter(Boolean));
          setK('');
          setF('');
        }}
      >
        Add
      </button>
    </div>
  );
}
