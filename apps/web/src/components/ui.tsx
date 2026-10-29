import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Judgement } from '@robercop/rules';
import type { SourceCheck } from '@robercop/shared';
import { useSaveStatus } from '../hooks/data';

export function JudgementBadge({ j, large, label }: { j: Judgement | '' | undefined | null; large?: boolean; label?: string }) {
  return <span className={`jbadge ${large ? 'lg' : ''} ${j ? `j-${j}` : 'j-none'}`}>{label ?? (j || '—')}</span>;
}

const CHECK_LABEL: Record<SourceCheck['status'], [string, string]> = {
  not_checked: ['Not checked', ''],
  matched: ['Matched', 'ok'],
  ambiguous: ['Ambiguous', 'warn'],
  unmatched: ['Unmatched', 'bad'],
  incomplete_extraction: ['Extraction incomplete', 'warn'],
  needs_recheck: ['Needs recheck', 'info'],
  manually_verified: ['Manually verified', 'ok']
};

export function CheckBadge({ check, kind }: { check: SourceCheck | null | undefined; kind?: 'quote' | 'note' }) {
  if (kind === 'note') return <span className="chip">Note</span>;
  if (!check) return null;
  const [label, cls] = CHECK_LABEL[check.status];
  const method = check.method === 'normalized' ? ' (formatting normalized)' : check.method === 'elided' ? ' (ellipsis)' : '';
  const title = [...check.notes, check.manual ? `Checked by ${check.manual.by}: ${check.manual.note}` : ''].filter(Boolean).join('\n');
  return (
    <span className={`chip ${cls}`} title={title}>
      {check.status === 'matched' || check.status === 'manually_verified' ? '✓ ' : ''}
      {label}
      {check.status === 'matched' ? method : ''}
      {check.ocr ? ' · OCR' : ''}
    </span>
  );
}

export function Modal({ title, children, onClose, wide, foot }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; foot?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="row mb">
          <h2 className="grow" style={{ margin: 0 }}>
            {title}
          </h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function SaveStatus() {
  const s = useSaveStatus();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const label: Record<string, ReactNode> = {
    idle: <span style={{ opacity: 0.7 }}>All changes saved</span>,
    pending: <span>Unsaved changes…</span>,
    saving: (
      <span className="row gap-sm">
        <span className="spinner" /> Saving…
      </span>
    ),
    saved: <span>✓ Saved {ago(s.at)}</span>,
    offline: <span title={s.message}>⚠ Offline — kept locally</span>,
    conflict: <span title={s.message}>⚠ Conflict — reload</span>,
    error: <span title={s.message}>⚠ Not saved</span>
  };
  return <span className="savestatus" title={s.message}>{label[s.state]}</span>;
}

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

export function Spinner() {
  return <span className="spinner" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Text area that edits locally and reports changes on every keystroke (callers autosave). */
export function TextArea({ value, onChange, rows = 3, placeholder, disabled, autoFocus }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean; autoFocus?: boolean }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  return (
    <textarea
      rows={rows}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onChange={(e) => {
        setV(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export function TextInput({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onChange={(e) => {
        setV(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/** Input that commits its value when it loses focus or Enter is pressed. */
export function BlurInput({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {hint && <div className="hint">{hint}</div>}
      {children}
    </label>
  );
}

export function ProblemList({ problems, onGo }: { problems: { target: string; message: string }[]; onGo?: (target: string) => void }) {
  if (problems.length === 0) return null;
  return (
    <ul className="problem-list">
      {problems.slice(0, 40).map((p, i) => (
        <li key={i}>{onGo ? <button onClick={() => onGo(p.target)}>{p.message}</button> : p.message}</li>
      ))}
      {problems.length > 40 && <li>…and {problems.length - 40} more</li>}
    </ul>
  );
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const STATUS_CHIP: Record<string, string> = {
  draft: '',
  submitted: 'accent',
  finalized: 'ok',
  approved: 'ok',
  changed: 'warn',
  Finalized: 'ok',
  'Ready to finalize': 'ok',
  'Ready to reconcile': 'accent',
  Reconciling: 'info',
  Checking: 'info',
  'Changes requested': 'warn',
  Assessing: 'accent',
  'Awaiting second reviewer': 'warn',
  'Not started': '',
  'Critical at triage — confirm': 'bad'
};
