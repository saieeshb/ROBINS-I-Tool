import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AiProposal, AiRun, AiTask } from '@robercop/shared';
import { errorMessage, get, post } from '../api';
import { useSession } from '../session';

export interface Scope {
  questionIds?: string[];
  domain?: string;
  evidenceIds?: string[];
  message?: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
  includeSuggestions?: boolean;
  factors?: string[];
  resultId?: string;
}

export interface LiveRun {
  text: string;
  activity: string[];
}

interface RunEntry {
  run: AiRun;
  proposals: AiProposal[];
}

interface Assistant {
  runs: RunEntry[];
  live: Record<string, LiveRun>;
  start: (task: AiTask, scope?: Scope) => Promise<AiRun | null>;
  cancel: (runId: string) => Promise<void>;
  /** Pending proposals, optionally for one question/field. */
  pending: (filter?: (p: AiProposal) => boolean) => AiProposal[];
  /** Most recent run of a task for a question (to show "running" on the card that asked). */
  activeFor: (task: AiTask | AiTask[], questionId?: string) => AiRun | undefined;
  accept: (p: AiProposal, edits?: Record<string, unknown>) => Promise<{ evidence?: { id: string } } | null>;
  reject: (p: AiProposal) => Promise<void>;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<Assistant | null>(null);

export function AssistantProvider({ studyId, assessmentId, children, onRunDone }: { studyId: string; assessmentId?: string | null; children: ReactNode; onRunDone?: (run: AiRun) => void }) {
  const { toast, refreshAi } = useSession();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  const [drawerOpen, setDrawerOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('robercop.drawer');
      // Without a saved choice, open it only where it fits beside the PDF instead of covering it.
      return saved === null ? window.innerWidth > 1500 : saved !== '0';
    } catch {
      return window.innerWidth > 1500;
    }
  });
  const sources = useRef(new Map<string, EventSource>());
  const doneRef = useRef(onRunDone);
  doneRef.current = onRunDone;

  const reload = useCallback(async () => {
    try {
      setRuns(await get<RunEntry[]>(`/ai/runs?studyId=${studyId}${assessmentId ? `&assessmentId=${assessmentId}` : ''}`));
    } catch {
      /* ignore */
    }
  }, [studyId, assessmentId]);

  useEffect(() => {
    void reload();
    const map = sources.current;
    return () => {
      for (const es of map.values()) es.close();
      map.clear();
    };
  }, [reload]);

  const follow = useCallback((runId: string) => {
    if (sources.current.has(runId)) return;
    const es = new EventSource(`/api/ai/runs/${runId}/events`);
    sources.current.set(runId, es);
    setLive((l) => ({ ...l, [runId]: l[runId] ?? { text: '', activity: [] } }));
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.type === 'text') setLive((l) => ({ ...l, [runId]: { ...(l[runId] ?? { activity: [] }), text: (l[runId]?.text ?? '') + e.delta } }));
      else if (e.type === 'activity') setLive((l) => ({ ...l, [runId]: { ...(l[runId] ?? { text: '' }), activity: [...(l[runId]?.activity ?? []), e.label].slice(-30) } }));
      else if (e.type === 'status') setRuns((rs) => rs.map((r) => (r.run.id === runId ? { ...r, run: { ...r.run, status: e.status, error: e.message ?? r.run.error } } : r)));
      else if (e.type === 'done') {
        es.close();
        sources.current.delete(runId);
        setRuns((rs) => {
          const others = rs.filter((r) => r.run.id !== runId);
          return [{ run: e.run, proposals: e.proposals }, ...others].sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
        });
        if (e.run.status === 'usage_limited' || e.run.status === 'auth_required') void refreshAi(true);
        if (e.run.status !== 'succeeded' && e.run.status !== 'cancelled') toast(e.run.error ?? 'The assistant run failed.', true);
        doneRef.current?.(e.run);
      }
    };
    es.onerror = () => {
      // The server closes the stream when the run ends; fetch the final state.
      es.close();
      sources.current.delete(runId);
      void get<RunEntry>(`/ai/runs/${runId}`).then((r) => setRuns((rs) => rs.map((x) => (x.run.id === runId ? r : x))));
    };
  }, [toast, refreshAi]);

  // Re-attach to runs still in progress (e.g. after navigating away and back).
  useEffect(() => {
    for (const r of runs) if (['queued', 'running'].includes(r.run.status)) follow(r.run.id);
  }, [runs, follow]);

  const start = useCallback(
    async (task: AiTask, scope: Scope = {}) => {
      try {
        const run = await post<AiRun>('/ai/runs', { task, studyId, assessmentId: assessmentId ?? null, scope });
        setRuns((rs) => [{ run, proposals: [] }, ...rs]);
        follow(run.id);
        return run;
      } catch (e) {
        toast(errorMessage(e), true);
        return null;
      }
    },
    [studyId, assessmentId, follow, toast]
  );

  const cancel = useCallback(async (runId: string) => {
    try {
      const run = await post<AiRun>(`/ai/runs/${runId}/cancel`, {});
      setRuns((rs) => rs.map((r) => (r.run.id === runId ? { ...r, run } : r)));
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }, [toast]);

  const accept = useCallback(
    async (p: AiProposal, edits: Record<string, unknown> = {}) => {
      try {
        const res = await post<{ proposal: AiProposal; evidence?: { id: string } }>(`/proposals/${p.id}/accept`, edits);
        setRuns((rs) => rs.map((r) => ({ ...r, proposals: r.proposals.map((x) => (x.id === p.id ? res.proposal : x)) })));
        return res;
      } catch (e) {
        toast(errorMessage(e), true);
        return null;
      }
    },
    [toast]
  );

  const reject = useCallback(async (p: AiProposal) => {
    const res = await post<AiProposal>(`/proposals/${p.id}/reject`, {});
    setRuns((rs) => rs.map((r) => ({ ...r, proposals: r.proposals.map((x) => (x.id === p.id ? res : x)) })));
  }, []);

  const value = useMemo<Assistant>(
    () => ({
      runs,
      live,
      start,
      cancel,
      accept,
      reject,
      reload,
      drawerOpen,
      setDrawerOpen: (v: boolean) => {
        setDrawerOpen(v);
        try {
          localStorage.setItem('robercop.drawer', v ? '1' : '0');
        } catch {
          /* ignore */
        }
      },
      pending: (filter) => runs.flatMap((r) => r.proposals).filter((p) => p.status === 'pending' && (!filter || filter(p))),
      activeFor: (task, questionId) => {
        const tasks = Array.isArray(task) ? task : [task];
        return runs.find(
          (r) => tasks.includes(r.run.task) && ['queued', 'running'].includes(r.run.status) && (!questionId || ((r.run.scope.questionIds as string[] | undefined) ?? []).includes(questionId))
        )?.run;
      }
    }),
    [runs, live, start, cancel, accept, reject, reload, drawerOpen]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): Assistant {
  const a = useContext(Ctx);
  if (!a) throw new Error('AssistantProvider missing');
  return a;
}
