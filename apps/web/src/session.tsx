import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currentReviewer, get, put, setCurrentReviewer } from './api';

export interface AiStatus {
  assistant: {
    installed: boolean;
    version: string | null;
    loggedIn: boolean | null;
    authMethod: string | null;
    usesApiKey: boolean;
    apiProvider: string | null;
    problems: string[];
  };
  usage: { status?: string; rateLimitType?: string; resetsAt?: number; unifiedWindows?: Record<string, { utilization: number; resetsAt: number; status: string }> } | null;
  settings: { model: string; isolateSettings: boolean; allowApiBilling: boolean };
  docling: { available: boolean; version: string | null; error: string | null };
  connector: string;
}

export interface AppSettings {
  reviewers: string[];
  parser: 'auto' | 'docling' | 'pdfjs';
  ai: { model: string; isolateSettings: boolean; allowApiBilling: boolean };
  dataDir: string;
  installationId: string;
}

interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

interface Session {
  reviewer: string;
  setReviewer: (name: string) => void;
  settings: AppSettings | null;
  saveSettings: (s: Partial<AppSettings>) => Promise<void>;
  ai: AiStatus | null;
  refreshAi: (force?: boolean) => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
  toasts: Toast[];
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [reviewer, setReviewerState] = useState(currentReviewer());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 7000 : 3500);
  }, []);

  const refreshAi = useCallback(async (force = false) => {
    try {
      setAi(await get<AiStatus>(`/ai/status${force ? '?refresh=1' : ''}`));
    } catch {
      setAi(null);
    }
  }, []);

  useEffect(() => {
    void get<AppSettings>('/settings').then(setSettings).catch(() => undefined);
    void refreshAi();
    const t = setInterval(() => void refreshAi(), 60000);
    return () => clearInterval(t);
  }, [refreshAi]);

  const setReviewer = useCallback(
    (name: string) => {
      setCurrentReviewer(name);
      setReviewerState(name);
      if (name && settings && !settings.reviewers.includes(name)) {
        void put<AppSettings>('/settings', { reviewers: [...settings.reviewers, name] }).then((s) => setSettings((cur) => (cur ? { ...cur, ...s } : cur)));
      }
    },
    [settings]
  );

  const saveSettings = useCallback(async (s: Partial<AppSettings>) => {
    const next = await put<AppSettings>('/settings', s);
    setSettings((cur) => (cur ? { ...cur, ...next } : cur));
  }, []);

  const value = useMemo(
    () => ({ reviewer, setReviewer, settings, saveSettings, ai, refreshAi, toast, toasts }),
    [reviewer, setReviewer, settings, saveSettings, ai, refreshAi, toast, toasts]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider missing');
  return s;
}
