import { useEffect, useState } from 'react';
import { useCrumbs } from '../App';
import { Field } from '../components/ui';
import { useSession } from '../session';

export function SettingsPage() {
  useCrumbs([{ label: 'Settings' }]);
  const { settings, saveSettings, ai, refreshAi, toast } = useSession();
  const [model, setModel] = useState('');
  useEffect(() => setModel(settings?.ai.model ?? ''), [settings?.ai.model]);
  if (!settings) return <div className="page muted">Loading…</div>;
  const a = ai?.assistant;
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Settings</h1>

      <div className="card">
        <div className="card-head">
          <h3 className="grow">Assistant: Claude Code</h3>
          <button className="sm" onClick={() => void refreshAi(true)}>
            Check again
          </button>
        </div>
        {!a ? (
          <p className="muted">Checking…</p>
        ) : (
          <>
            <table className="t">
              <tbody>
                <tr>
                  <td>Installed</td>
                  <td>{a.installed ? `Yes — ${a.version}` : 'No'}</td>
                </tr>
                <tr>
                  <td>Signed in</td>
                  <td>{a.loggedIn === null ? 'Unknown' : a.loggedIn ? `Yes (${a.authMethod})` : 'No'}</td>
                </tr>
                <tr>
                  <td>Provider</td>
                  <td>{a.apiProvider ?? '—'}</td>
                </tr>
                {ai?.usage?.unifiedWindows &&
                  Object.entries(ai.usage.unifiedWindows).map(([k, w]) => (
                    <tr key={k}>
                      <td>Usage ({k.replace('_', ' ')})</td>
                      <td>
                        {Math.round(w.utilization * 100)}% · resets {new Date(w.resetsAt * 1000).toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {a.problems.map((p) => (
              <div key={p} className="banner warn mt-sm">
                {p}
              </div>
            ))}
          </>
        )}
        <p className="small muted mt">
          ROBer COP runs your installed, unmodified Claude Code client with its own sign-in. Each assistant action sends only the task context (the relevant study details and the parsed
          sources) and runs with read-only source tools; it cannot change answers, approve or finalize anything. If you are not signed in, open a terminal and run <code>claude</code>.
        </p>
        <Field label="Model (optional)" hint='Leave empty for Claude Code’s default. You can use an alias such as "opus" or "sonnet".'>
          <div className="row">
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" />
            <button onClick={() => void saveSettings({ ai: { ...settings.ai, model: model.trim() } }).then(() => toast('Saved'))}>Save</button>
          </div>
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={settings.ai.isolateSettings} onChange={(e) => void saveSettings({ ai: { ...settings.ai, isolateSettings: e.target.checked } })} />
          <span>
            <strong>Isolate assistant runs from my Claude Code user settings</strong> (recommended). Hooks and permissions from your personal settings are not loaded for assessment runs.
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.ai.allowApiBilling}
            onChange={(e) => {
              if (e.target.checked && !confirm('Allow ROBer COP to use Claude Code when it is configured with an API key or a cloud provider? That usage is billed per request.')) return;
              void saveSettings({ ai: { ...settings.ai, allowApiBilling: e.target.checked } });
            }}
          />
          <span>
            <strong>Allow billed API access.</strong> Off by default: ROBer COP removes API keys from the assistant's environment and never switches from your subscription to billed API
            access on its own.
          </span>
        </label>
      </div>

      <div className="card">
        <h3>PDF parsing</h3>
        <p className="small muted">
          Docling (local, recommended) recovers layout, tables and scanned pages with OCR. Without it, ROBer COP uses a built-in text-layer parser (no OCR, no table structure).
        </p>
        <p>
          Docling:{' '}
          {ai?.docling.available ? (
            <span className="chip ok">Available — {ai.docling.version}</span>
          ) : (
            <span className="chip warn" title={ai?.docling.error ?? ''}>
              Not set up
            </span>
          )}
        </p>
        {!ai?.docling.available && (
          <p className="small">
            To set it up, quit ROBer COP and run <code>npm start -- --setup-docling</code> once while online (downloads Docling and its models into the app folder).
          </p>
        )}
        <Field label="Parser for new documents">
          <select value={settings.parser} onChange={(e) => void saveSettings({ parser: e.target.value as 'auto' })}>
            <option value="auto">Automatic (Docling when available, otherwise built-in)</option>
            <option value="docling">Docling only</option>
            <option value="pdfjs">Built-in text-layer parser</option>
          </select>
        </Field>
      </div>

      <div className="card">
        <h3>Reviewers on this computer</h3>
        <p className="small muted">Names are local attribution for decisions, not authenticated signatures. Switch reviewer from the top bar.</p>
        <div className="row wrap">
          {settings.reviewers.map((r) => (
            <span key={r} className="chip">
              👤 {r}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Data</h3>
        <p className="small">
          Data directory: <code>{settings.dataDir}</code>
        </p>
        <p className="small muted">Original PDFs, parsed artifacts, assistant run records and the database stay in this folder. Back it up like any other documents folder.</p>
        <p className="small muted">
          To use a different folder (for example a synced or backed-up drive), start ROBer COP with <code>--data-dir "path/to/folder"</code>; the launcher remembers it. Only one copy of ROBer COP should use a folder at a time.
        </p>
        <p className="small faint">Installation ID: {settings.installationId}</p>
      </div>
    </div>
  );
}
