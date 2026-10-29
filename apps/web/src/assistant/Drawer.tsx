import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AiRun } from '@robercop/shared';
import { fmtTime, Spinner } from '../components/ui';
import { useSession } from '../session';
import { useAssistant, type Scope } from './AssistantContext';

const STATUS_TEXT: Record<AiRun['status'], string> = {
  queued: 'Queued',
  running: 'Working',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  usage_limited: 'Usage limit reached',
  auth_required: 'Sign-in needed',
  interrupted: 'Interrupted'
};

const TASK_TEXT: Record<string, string> = {
  find_evidence: 'Find evidence',
  prepare_domain: 'Prepare domain',
  explain_evidence: 'Explain evidence',
  check_missing: 'Check for missing information',
  draft_rationale: 'Draft rationale',
  suggest_answer: 'Suggest answer',
  extract_study: 'Extract study details',
  evaluate_confounders: 'Evaluate confounders',
  chat: 'Conversation'
};

/** The assistant drawer: run feed, streaming output and a scoped conversation. */
export function AssistantDrawer({ contextLabel, chatScope, actions }: { contextLabel: string; chatScope: () => Scope; actions?: ReactNode }) {
  const { runs, live, start, cancel, setDrawerOpen } = useAssistant();
  const { ai } = useSession();
  const [msg, setMsg] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const feed = [...runs].reverse();

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runs.length, live]);

  const send = async () => {
    const text = msg.trim();
    if (!text) return;
    const history = feed
      .filter((r) => r.run.task === 'chat' && r.run.status === 'succeeded')
      .slice(-6)
      .flatMap((r) => [
        { role: 'user' as const, text: String(r.run.scope.message ?? '') },
        { role: 'assistant' as const, text: r.run.outputText }
      ]);
    setMsg('');
    await start('chat', { ...chatScope(), message: text, history });
  };

  const a = ai?.assistant;
  const ready = !!a && a.installed && a.loggedIn !== false && !a.usesApiKey;
  return (
    <>
      <div className="drawer-head">
        <strong className="grow">Assistant</strong>
        <span className="conn small muted">
          <span className={`dot ${ready ? 'ok' : 'warn'}`} />
          {ai?.connector ?? 'Claude Code'}
        </span>
        <button className="ghost sm" onClick={() => setDrawerOpen(false)} title="Hide assistant">
          ✕
        </button>
      </div>
      <div className="drawer-body" ref={bodyRef}>
        <div className="small muted mb">
          Scoped to <strong>{contextLabel}</strong>. The assistant finds and explains evidence; you choose every answer.
        </div>
        {!ready && a && (
          <div className="banner warn">
            <div>
              {a.problems[0] ?? 'Claude Code is not ready.'}
              {!a.installed && (
                <div className="small mt-sm">
                  Install Claude Code, run <code>claude</code> once in a terminal to sign in, then click the status chip at the top to re-check.
                </div>
              )}
            </div>
          </div>
        )}
        {feed.length === 0 && <div className="small faint">No assistant activity yet in this context.</div>}
        {feed.map(({ run, proposals }) => {
          const l = live[run.id];
          const busy = run.status === 'queued' || run.status === 'running';
          if (run.task === 'chat') {
            return (
              <div key={run.id}>
                <div className="msg user">
                  <span className="bubble">{String(run.scope.message ?? '')}</span>
                </div>
                <div className="msg">
                  <span className="bubble">
                    {busy && !l?.text ? (
                      <span className="row gap-sm muted">
                        <Spinner /> {l?.activity.at(-1) ?? 'Thinking…'}
                      </span>
                    ) : (
                      l?.text || run.outputText || (run.error ? <span style={{ color: 'var(--bad)' }}>{run.error}</span> : '')
                    )}
                  </span>
                  {busy && (
                    <button className="xs ghost" onClick={() => void cancel(run.id)}>
                      Stop
                    </button>
                  )}
                </div>
              </div>
            );
          }
          const pending = proposals.filter((p) => p.status === 'pending').length;
          return (
            <div key={run.id} className={`run ${busy ? 'running' : ''}`}>
              <div className="row">
                <strong className="grow small">{TASK_TEXT[run.task] ?? run.task}</strong>
                <span className={`chip ${run.status === 'succeeded' ? 'ok' : busy ? 'info' : run.status === 'cancelled' ? '' : 'bad'}`}>
                  {busy && <Spinner />} {STATUS_TEXT[run.status]}
                </span>
              </div>
              <div className="tiny faint">
                {run.promptSummary} · {fmtTime(run.createdAt)}
              </div>
              {busy && l?.activity.length ? <div className="activity mt-sm">{l.activity.at(-1)}</div> : null}
              {(l?.text || run.outputText) && <div className="stream">{l?.text || run.outputText}</div>}
              {run.error && <div className="flag bad">{run.error}</div>}
              {run.status === 'succeeded' && proposals.length > 0 && (
                <div className="small mt-sm">
                  {proposals.length} suggestion{proposals.length === 1 ? '' : 's'}
                  {pending ? ` · ${pending} awaiting your review on the relevant questions` : ' · all reviewed'}
                </div>
              )}
              {busy && (
                <button className="xs mt-sm" onClick={() => void cancel(run.id)}>
                  Cancel
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="drawer-foot">
        {actions && <div className="row wrap gap-sm mb">{actions}</div>}
        <div className="row top">
          <textarea
            rows={2}
            placeholder="Ask about this study or question…"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            style={{ minHeight: 44 }}
          />
          <button className="primary" disabled={!msg.trim()} onClick={() => void send()}>
            Send
          </button>
        </div>
      </div>
    </>
  );
}
