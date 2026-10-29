import { useSyncExternalStore } from 'react';

/** Appearance: follow the system setting, or force light or dark. index.html applies the same rule before first paint. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'robercop.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: ThemePref = readPref();
let snapshot = { pref, theme: resolve(pref) };

function resolve(p: ThemePref): 'light' | 'dark' {
  return p === 'system' ? (media.matches ? 'dark' : 'light') : p;
}

function update(): void {
  snapshot = { pref, theme: resolve(pref) };
  document.documentElement.dataset.theme = snapshot.theme;
  for (const l of listeners) l();
}

media.addEventListener('change', () => pref === 'system' && update());
// Keep several open tabs in step.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  pref = readPref();
  update();
});

export function setThemePref(p: ThemePref): void {
  try {
    if (p === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* private mode: applies to this tab only */
  }
  pref = p;
  update();
}

export function useTheme(): { pref: ThemePref; theme: 'light' | 'dark' } {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot
  );
}
