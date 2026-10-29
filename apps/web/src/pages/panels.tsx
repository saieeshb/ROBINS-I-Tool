import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

/**
 * Collapsible side columns for the Study and Domain session workspaces: the navigation on the left and the source
 * PDF on the right each fold to a slim rail so the centre gets the room. The choice is remembered on this computer.
 * Keys: [ toggles the navigation, ] toggles the source (ignored while typing).
 */
const KEY = 'robercop.panels';

interface PanelState {
  nav: boolean;
  source: boolean;
}

function read(): PanelState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PanelState>;
    return { nav: !!v.nav, source: !!v.source };
  } catch {
    return { nav: false, source: false };
  }
}

export interface Panels {
  navCollapsed: boolean;
  sourceCollapsed: boolean;
  toggleNav: () => void;
  toggleSource: () => void;
  /** Re-opens the source, e.g. when the reviewer jumps to a page or starts selecting text. */
  showSource: () => void;
  className: string;
}

export function usePanels(): Panels {
  const [state, setState] = useState<PanelState>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode */
    }
  }, [state]);

  const toggleNav = useCallback(() => setState((s) => ({ ...s, nav: !s.nav })), []);
  const toggleSource = useCallback(() => setState((s) => ({ ...s, source: !s.source })), []);
  const showSource = useCallback(() => setState((s) => (s.source ? { ...s, source: false } : s)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === '[') {
        e.preventDefault();
        toggleNav();
      } else if (e.key === ']') {
        e.preventDefault();
        toggleSource();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleNav, toggleSource]);

  return {
    navCollapsed: state.nav,
    sourceCollapsed: state.source,
    toggleNav,
    toggleSource,
    showSource,
    className: `${state.nav ? 'nav-collapsed' : ''} ${state.source ? 'source-collapsed' : ''}`
  };
}

/** Small button in the corner of the navigation column. */
export function CollapseNavButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="panel-toggle nav-toggle ghost" onClick={onClick} title="Collapse navigation ( [ )" aria-label="Collapse navigation">
      <Icon name="panelLeftClose" size={16} />
    </button>
  );
}

/** The collapsed navigation: an expand button, then optional compact items. */
export function NavRail({ onExpand, onAssistant, children }: { onExpand: () => void; onAssistant?: () => void; children?: ReactNode }) {
  return (
    <div className="rail">
      <button className="panel-toggle ghost" onClick={onExpand} title="Show navigation ( [ )" aria-label="Show navigation">
        <Icon name="panelLeftOpen" size={16} />
      </button>
      {children}
      {!children && <span className="rail-label">Navigation</span>}
      {onAssistant && (
        <button className="rail-item rail-ai" onClick={onAssistant} title="Show assistant" aria-label="Show assistant">
          ✦
        </button>
      )}
    </div>
  );
}

/** The collapsed source column. */
export function SourceRail({ onExpand, count }: { onExpand: () => void; count: number }) {
  return (
    <div className="rail source-rail">
      <button className="panel-toggle ghost" onClick={onExpand} title="Show source PDF ( ] )" aria-label="Show source PDF">
        <Icon name="panelRightOpen" size={16} />
      </button>
      <button className="rail-label rail-label-btn" onClick={onExpand}>
        Source PDF{count > 1 ? ` · ${count}` : ''}
      </button>
    </div>
  );
}
