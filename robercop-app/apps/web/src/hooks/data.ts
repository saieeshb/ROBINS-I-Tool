import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, errorMessage, get } from '../api';

/** Loads a resource and exposes reload/set. */
export function useResource<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(url);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);
  return { data, setData, error, loading, reload: load };
}

/** Polls while `active` is true. */
export function usePoll(fn: () => void, active: boolean, ms = 1500) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

// ---------------------------------------------------------------------------
// Save tracking (visible save status) and autosave queues
// ---------------------------------------------------------------------------
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

const states = new Map<string, { state: SaveState; message?: string; at: number }>();
const listeners = new Set<() => void>();
let snapshot: { state: SaveState; message?: string; at: number } = { state: 'idle', at: 0 };

function recompute() {
  const all = [...states.values()];
  const rank: SaveState[] = ['conflict', 'error', 'offline', 'saving', 'pending', 'saved', 'idle'];
  all.sort((a, b) => rank.indexOf(a.state) - rank.indexOf(b.state));
  snapshot = all[0] ?? { state: 'idle', at: 0 };
  for (const l of listeners) l();
}

export function setSaveState(key: string, state: SaveState, message?: string) {
  states.set(key, { state, message, at: Date.now() });
  recompute();
}

export function clearSaveState(key: string) {
  states.delete(key);
  recompute();
}

export function useSaveStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot
  );
}

export function hasUnsavedChanges(): boolean {
  return [...states.values()].some((s) => ['pending', 'saving', 'offline', 'conflict'].includes(s.state));
}

const DRAFT_PREFIX = 'robercop.draft.';

function loadDraft<P>(key: string): P | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? (JSON.parse(raw) as P) : null;
  } catch {
    return null;
  }
}

function storeDraft(key: string, patch: unknown | null) {
  try {
    if (patch === null) localStorage.removeItem(DRAFT_PREFIX + key);
    else localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(patch));
  } catch {
    /* storage unavailable */
  }
}

export interface AutosaveOptions<P, E extends { version: number }> {
  key: string;
  version: number | undefined;
  send: (patch: P, version: number) => Promise<E>;
  merge: (a: P, b: P) => P;
  onSaved: (entity: E) => void;
  onConflict?: (current: E) => void;
  onError?: (message: string) => void;
  delay?: number;
}

/**
 * Debounced, serialized save queue for one entity. Unsent changes are mirrored to local storage so a crash or a lost
 * connection does not lose them; they can be re-applied on top of the latest version.
 */
export class SaveQueue<P, E extends { version: number }> {
  private pending: P | null = null;
  private inflight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 1000;
  version: number | undefined;

  constructor(public opts: AutosaveOptions<P, E>) {
    this.version = opts.version;
  }

  setVersion(v: number | undefined) {
    if (!this.inflight && v !== undefined && (this.version === undefined || v > this.version)) this.version = v;
  }

  queue(patch: P) {
    this.pending = this.pending === null ? patch : this.opts.merge(this.pending, patch);
    storeDraft(this.opts.key, this.pending);
    setSaveState(this.opts.key, 'pending');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.delay ?? 600);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inflight || this.pending === null || this.version === undefined) return;
    const patch = this.pending;
    this.pending = null;
    this.inflight = true;
    const key = this.opts.key;
    setSaveState(key, 'saving');
    try {
      const saved = await this.opts.send(patch, this.version);
      this.version = saved.version;
      this.retryMs = 1000;
      this.inflight = false;
      if (this.pending === null) {
        storeDraft(key, null);
        setSaveState(key, 'saved');
      }
      this.opts.onSaved(saved);
      if (this.pending !== null) void this.flush();
    } catch (err) {
      this.inflight = false;
      const e = err as ApiError;
      if (e.status === 0) {
        this.pending = this.pending === null ? patch : this.opts.merge(patch, this.pending);
        storeDraft(key, this.pending);
        setSaveState(key, 'offline', 'Server unreachable; changes kept locally and will be retried.');
        this.timer = setTimeout(() => void this.flush(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 30000);
      } else if (e.status === 409) {
        this.pending = this.pending === null ? patch : this.opts.merge(patch, this.pending);
        storeDraft(key, this.pending);
        setSaveState(key, 'conflict', 'Changed elsewhere (another window?). Reload to continue.');
        if (e.current && this.opts.onConflict) this.opts.onConflict(e.current as E);
      } else {
        storeDraft(key, null);
        setSaveState(key, 'error', errorMessage(e));
        this.opts.onError?.(errorMessage(e));
      }
    }
  }

  /** Re-applies changes kept from a conflict or crash on top of the latest version. */
  resumeDraft(latestVersion: number): boolean {
    const draft = loadDraft<P>(this.opts.key);
    this.version = latestVersion;
    if (!draft) return false;
    this.pending = this.pending === null ? draft : this.opts.merge(draft, this.pending);
    void this.flush();
    return true;
  }

  discardDraft() {
    this.pending = null;
    storeDraft(this.opts.key, null);
    clearSaveState(this.opts.key);
  }

  hasDraft(): boolean {
    return loadDraft<P>(this.opts.key) !== null;
  }

  dispose() {
    if (this.pending !== null) storeDraft(this.opts.key, this.pending);
    void this.flush();
    clearSaveState(this.opts.key);
  }
}

export function useAutosave<P, E extends { version: number }>(opts: AutosaveOptions<P, E>) {
  const q = useRef<SaveQueue<P, E> | null>(null);
  if (!q.current || q.current.opts.key !== opts.key) q.current = new SaveQueue(opts);
  q.current.opts = opts;
  q.current.setVersion(opts.version);
  useEffect(() => {
    const queue = q.current!;
    const onUnload = () => queue.dispose();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      queue.dispose();
    };
  }, [opts.key]);
  return q.current;
}

/** Deep merge used for partial patches (objects merge, arrays and scalars replace). */
export function deepMerge<T>(a: T, b: T): T {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out as T;
}
