import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { Modal, SaveStatus } from './components/ui';
import { hasUnsavedChanges } from './hooks/data';
import { ProjectsPage } from './pages/Projects';
import { DashboardPage } from './pages/Dashboard';
import { SettingsPage } from './pages/Settings';
import { ProjectSetupPage } from './pages/ProjectSetup';
import { StudyWorkspace } from './pages/study/StudyWorkspace';
import { AssessmentWorkspace } from './pages/assessment/AssessmentWorkspace';
import { VerifyPage } from './pages/verify/VerifyPage';
import { ImportExportPage } from './pages/ImportExport';

export interface Crumb {
  label: string;
  to?: string;
}

const CrumbCtx = createContext<(c: Crumb[]) => void>(() => {});

export function useCrumbs(crumbs: Crumb[]) {
  const set = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function AssistantChip() {
  const { ai, refreshAi } = useSession();
  if (!ai) return <span className="conn">◌ Assistant…</span>;
  const a = ai.assistant;
  const ok = a.installed && a.loggedIn !== false && !a.usesApiKey;
  const window5 = ai.usage?.unifiedWindows?.five_hour;
  const limited = ai.usage?.status === 'rejected';
  const title = [
    a.installed ? `Claude Code ${a.version}` : 'Claude Code not found',
    a.loggedIn ? `Signed in (${a.authMethod ?? 'unknown method'})` : a.loggedIn === false ? 'Not signed in' : '',
    window5 ? `5-hour usage: ${Math.round(window5.utilization * 100)}%` : '',
    ...a.problems
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button className="chip" title={title} onClick={() => void refreshAi(true)} style={{ cursor: 'pointer' }}>
      <span className={`dot ${limited ? 'bad' : ok ? 'ok' : 'warn'}`} />
      {limited ? 'Usage limit reached' : ok ? 'Claude Code connected' : !a.installed ? 'Claude Code not installed' : a.loggedIn === false ? 'Sign in to Claude Code' : 'Assistant needs attention'}
      {window5 && !limited ? <span style={{ opacity: 0.8 }}>· {Math.round(window5.utilization * 100)}%</span> : null}
    </button>
  );
}

function ReviewerSelect() {
  const { reviewer, setReviewer, settings } = useSession();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const names = [...new Set([...(settings?.reviewers ?? []), ...(reviewer ? [reviewer] : [])])];
  return (
    <>
      <select
        value={reviewer}
        onChange={(e) => {
          if (e.target.value === '__add') setAdding(true);
          else {
            if (hasUnsavedChanges() && !confirm('Some changes are still saving. Switch reviewer anyway?')) return;
            setReviewer(e.target.value);
            location.reload();
          }
        }}
        title="Reviewer (local attribution, not a signature)"
      >
        {!reviewer && <option value="">Choose reviewer…</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            👤 {n}
          </option>
        ))}
        <option value="__add">+ Add reviewer…</option>
      </select>
      {(adding || !reviewer) && (
        <Modal
          title="Who is reviewing?"
          onClose={() => setAdding(false)}
          foot={
            <button
              className="primary"
              disabled={!name.trim()}
              onClick={() => {
                setReviewer(name.trim());
                setAdding(false);
                location.reload();
              }}
            >
              Continue as {name.trim() || '…'}
            </button>
          }
        >
          <p className="muted">Your name is recorded with every decision you make on this computer. It is local attribution, not an authenticated signature.</p>
          <input autoFocus value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && (setReviewer(name.trim()), setAdding(false), location.reload())} />
          {names.length > 0 && <p className="small muted mt-sm">Existing reviewers: {names.join(', ')}</p>}
        </Modal>
      )}
    </>
  );
}

function Toasts() {
  const { toasts } = useSession();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast pre ${t.bad ? 'bad' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return (
    <CrumbCtx.Provider value={setCrumbs}>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" />
          ROBer COP
        </Link>
        <nav className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="row gap-sm truncate">
              <span className="sep">/</span>
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="truncate">{c.label}</span>}
            </span>
          ))}
        </nav>
        <span className="spacer" />
        <SaveStatus />
        <AssistantChip />
        <ReviewerSelect />
        <Link to="/settings" title="Settings" style={{ fontSize: 18 }}>
          ⚙
        </Link>
      </header>
      {children}
      <Toasts />
    </CrumbCtx.Provider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/projects/:projectId" element={<DashboardPage />} />
            <Route path="/projects/:projectId/setup" element={<ProjectSetupPage />} />
            <Route path="/projects/:projectId/transfer" element={<ImportExportPage />} />
            <Route path="/studies/:studyId" element={<StudyWorkspace />} />
            <Route path="/studies/:studyId/:section" element={<StudyWorkspace />} />
            <Route path="/assessments/:assessmentId" element={<AssessmentWorkspace />} />
            <Route path="/results/:resultId/verify" element={<VerifyPage />} />
            <Route path="*" element={<div className="page">Not found. <Link to="/">Home</Link></div>} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
