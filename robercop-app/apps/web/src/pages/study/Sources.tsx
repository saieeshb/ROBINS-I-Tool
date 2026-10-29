import { useRef, useState } from 'react';
import { del, errorMessage, post, upload } from '../../api';
import { Spinner, fmtTime } from '../../components/ui';
import { useSession } from '../../session';
import { useStudy, type StudyDoc } from './context';

const ROLES = [
  ['manuscript', 'Main article'],
  ['supplement', 'Supplement'],
  ['protocol', 'Protocol / SAP'],
  ['registry', 'Registry record'],
  ['other', 'Other']
] as const;

export function SourcesSection() {
  const { payload, reload } = useStudy();
  const { toast, ai } = useSession();
  const [role, setRole] = useState<string>(payload.documents.length ? 'supplement' : 'manuscript');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (files: FileList | File[]) => {
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        await upload(`/studies/${payload.study.id}/documents`, f, { role, label: f.name.replace(/\.pdf$/i, '') });
      } catch (e) {
        toast(`${f.name}: ${errorMessage(e)}`, true);
      }
    }
    setBusy(false);
    setRole('supplement');
    void reload();
  };

  return (
    <div>
      <h2>Sources</h2>
      <p className="muted">Attach the article and any supplements, protocol or registry records. Each file is parsed once, in the background, and stays on this computer.</p>
      <div
        className="card flat"
        style={{ borderStyle: 'dashed', borderWidth: 2, background: drag ? 'var(--accent-bg)' : undefined, textAlign: 'center' }}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
        }}
      >
        <div className="row" style={{ justifyContent: 'center' }}>
          <span>Drop PDFs here or</span>
          <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Spinner /> : null} Choose files…
          </button>
          <span className="muted">as</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => e.target.files && void send(e.target.files)} />
        <div className="small faint mt-sm">
          Parser: {ai?.docling.available ? `Docling ${ai.docling.version} (layout, tables, OCR)` : 'built-in text-layer parser (Docling not set up — see Settings)'}
        </div>
      </div>

      {payload.documents.length > 0 && (
        <div className="card mt">
          <table className="t">
            <thead>
              <tr>
                <th>Document</th>
                <th>Role</th>
                <th>Parsing</th>
                <th>Coverage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payload.documents.map((d) => (
                <DocRow key={d.id} d={d} onChange={reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocRow({ d, onChange }: { d: StudyDoc; onChange: () => Promise<void> }) {
  const { toast } = useSession();
  const latest = d.latestJob;
  const busy = latest && ['queued', 'running'].includes(latest.status);
  const reparse = async (parser: 'docling' | 'pdfjs') => {
    try {
      await post(`/documents/${d.id}/reparse`, { parser });
      toast('Re-parsing in the background. Quotation checks will be re-run afterwards.');
      void onChange();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  const job = d.job;
  return (
    <tr>
      <td>
        <strong>{d.label}</strong>
        <div className="tiny faint">
          {d.filename} · {(d.size / 1024).toFixed(0)} KB · sha256 {d.sha256.slice(0, 10)}… · {fmtTime(d.createdAt)}
        </div>
      </td>
      <td>{ROLES.find(([v]) => v === d.role)?.[1] ?? d.role}</td>
      <td style={{ minWidth: 160 }}>
        {busy ? (
          <>
            <div className="row small">
              <Spinner /> {latest!.status === 'queued' ? 'Queued' : `Parsing (${latest!.parser})`}
            </div>
            <div className="progress mt-sm">
              <div style={{ width: `${Math.round((latest!.progress || 0.05) * 100)}%` }} />
            </div>
          </>
        ) : job ? (
          <span className="chip ok" title={job.parserVersion}>
            ✓ {job.parser === 'docling' ? 'Docling' : 'Built-in'} · {fmtTime(job.finishedAt)}
          </span>
        ) : (
          <span className="chip bad" title={latest?.error ?? ''}>
            {latest?.status ?? 'Not parsed'}
          </span>
        )}
        {latest?.error && !busy && <div className="tiny" style={{ color: 'var(--bad)' }}>{latest.error.slice(0, 220)}</div>}
      </td>
      <td className="small">
        {job?.coverage ? (
          <>
            {job.coverage.pagesWithText}/{job.coverage.pages} pages with text · {job.coverage.blocks} blocks
            {job.coverage.tables ? ` · ${job.coverage.tables} tables` : ''}
            {job.coverage.ocrPages.length ? <div className="chip warn">OCR on p. {job.coverage.ocrPages.join(', ')}</div> : null}
            {job.coverage.emptyPages.length ? <div className="chip bad">No text on p. {job.coverage.emptyPages.join(', ')}</div> : null}
            {job.warnings.filter((w) => !w.startsWith('Parsed with the built-in')).map((w) => (
              <div key={w} className="tiny" style={{ color: 'var(--warn)' }}>
                {w}
              </div>
            ))}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="nowrap">
        <button className="xs" disabled={!!busy} onClick={() => void reparse('docling')} title="Parse with Docling (layout, tables, OCR)">
          Docling
        </button>{' '}
        <button className="xs" disabled={!!busy} onClick={() => void reparse('pdfjs')} title="Quick text-layer parse">
          Built-in
        </button>{' '}
        <button
          className="xs danger"
          onClick={async () => {
            if (!confirm(`Remove "${d.label}"?`)) return;
            try {
              await del(`/documents/${d.id}`);
              void onChange();
            } catch (e) {
              toast(errorMessage(e), true);
            }
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
