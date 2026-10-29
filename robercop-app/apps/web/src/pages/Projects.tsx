import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Project } from '@robercop/shared';
import { errorMessage, post } from '../api';
import { useCrumbs } from '../App';
import { Empty, Field, Modal, fmtTime } from '../components/ui';
import { useResource } from '../hooks/data';
import { useSession } from '../session';

export function ProjectsPage() {
  useCrumbs([]);
  const { data, error } = useResource<Project[]>('/projects');
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Projects</h1>
          <div className="sub">Each project is one systematic review: its studies, results, confounder matrix and verification mode.</div>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          + New project
        </button>
      </div>
      {error && <div className="banner bad">{error}</div>}
      {data && data.length === 0 && (
        <div className="card">
          <Empty>
            <h3>Welcome to ROBer COP</h3>
            <p>Create a project to start. You will attach study PDFs, define results and run Study sessions, Domain sessions and verification — all on this computer.</p>
            <button className="primary mt" onClick={() => setCreating(true)}>
              Create your first project
            </button>
          </Empty>
        </div>
      )}
      <div className="grid cols-2">
        {data?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ color: 'inherit' }}>
            <div className="row">
              <h3 className="grow" style={{ margin: 0 }}>
                {p.name}
              </h3>
              <span className="chip accent">{p.verificationMode === 'independent' ? 'Independent double assessment' : 'Checking of first assessment'}</span>
            </div>
            {p.description && <p className="muted mt-sm">{p.description}</p>}
            <div className="small faint mt-sm">
              {Object.keys(p.cfMatrix).length} outcome domains in the confounder matrix · updated {fmtTime(p.updatedAt)}
            </div>
          </Link>
        ))}
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { toast } = useSession();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'independent' | 'checking'>('independent');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const p = await post<Project>('/projects', { name, description, verificationMode: mode });
      nav(`/projects/${p.id}`);
    } catch (e) {
      toast(errorMessage(e), true);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New project"
      onClose={onClose}
      foot={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim() || busy} onClick={create}>
            Create project
          </button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RAMIE vs MIE systematic review" />
      </Field>
      <Field label="Description (optional)">
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="label">Verification mode</div>
      <div className="hint">Chosen now because it shapes how second reviewers work. It cannot change once verification has started.</div>
      <label className="checkbox">
        <input type="radio" checked={mode === 'independent'} onChange={() => setMode('independent')} />
        <span>
          <strong>Independent assessment</strong> — a second reviewer assesses each result without seeing the first assessment; differences are reconciled into a consensus record.
        </span>
      </label>
      <label className="checkbox">
        <input type="radio" checked={mode === 'checking'} onChange={() => setMode('checking')} />
        <span>
          <strong>Checking</strong> — a second reviewer checks the first assessment question by question, confirming or requesting changes.
        </span>
      </label>
      <p className="small muted mt">The confounder matrix starts from the project default (important confounding factors per outcome). You can edit or replace it in project setup.</p>
    </Modal>
  );
}
