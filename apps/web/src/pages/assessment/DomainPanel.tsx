import { useEffect, useRef, useState } from 'react';
import { getDomain, getQuestion, judgementLabel, type DomainId, type Judgement } from '@robercop/rules';
import type { AiProposal, ConfounderRow, EvidenceItem } from '@robercop/shared';
import { errorMessage, get } from '../../api';
import { useAssistant } from '../../assistant/AssistantContext';
import { OptionButtons } from '../../components/Options';
import { JudgementBadge, TextArea, fmtTime } from '../../components/ui';
import { EvidenceCard, ProposalCard } from '../../evidence/Evidence';
import { useSession } from '../../session';
import { useAssess } from './context';
import { CheckerControls, ConsensusPanel, VerificationNotes } from './Review';

function needsControl(c: ConfounderRow) {
  return c.controlled === 'N' && !['Y', 'PY'].includes(c.unnecessary);
}

function CfPanel() {
  const { payload, ev } = useAssess();
  const result = ev.result;
  if (!result) return null;
  const wanted = new Set(result.importantFactors.map((f) => f.toLowerCase()));
  const rows = payload.revision.snapshot.data.confounders.filter((c) => wanted.has(c.factor.toLowerCase()) || c.list === 'additional');
  const missing = rows.filter(needsControl);
  const concerns = rows.filter((c) => c.controlled === 'Y' && ['PN', 'N', 'NI'].includes(c.valid));
  return (
    <div className="card flat mb" style={{ borderLeft: '3px solid var(--accent-2)' }}>
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          From the Study session: confounding factors for this result
        </h3>
        <span className="tiny faint">study revision #{payload.revision.revisionNo}</span>
      </div>
      <table className="t mt-sm cf-table">
        <thead>
          <tr>
            <th>Factor</th>
            <th>Variable(s)</th>
            <th className="c">Controlled</th>
            <th className="c">Valid</th>
            <th className="c">Unnecessary</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={needsControl(c) ? 'needs' : ''}>
              <td>{c.factor}</td>
              <td>{c.variables || '—'}</td>
              <td className="c">{c.controlled || '—'}</td>
              <td className="c">{c.valid || '—'}</td>
              <td className="c">
                {c.unnecessary || '—'}
                {c.unnecessaryCondition ? ` (${c.unnecessaryCondition})` : ''}
              </td>
              <td className="small muted">{c.comments}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small mt-sm">
        <strong>Not controlled but necessary:</strong> <span style={{ color: missing.length ? 'var(--bad)' : undefined }}>{missing.map((c) => c.factor).join(', ') || 'none'}</span>
        {' · '}
        <strong>Measurement concerns:</strong> {concerns.map((c) => c.factor).join(', ') || 'none'}
      </div>
    </div>
  );
}

export function DomainPanel({ domain }: { domain: DomainId }) {
  const { ev, a, activeQ, setActiveQ, setAnswer, canEdit } = useAssess();
  const assistant = useAssistant();
  const def = getDomain(domain);
  const st = ev.domains[domain];
  const reached = st.evaluation.questions.filter((q) => q.reached);
  const notAsked = st.evaluation.questions.filter((q) => !q.reached);
  const [showHidden, setShowHidden] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const preparing = assistant.activeFor('prepare_domain');

  // Default to the first unanswered reached question.
  useEffect(() => {
    if (!activeQ || !def.questionIds.includes(activeQ)) {
      const first = reached.find((q) => !q.answered) ?? reached[0];
      if (first) setActiveQ(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // Keyboard: arrows move, digits answer, Enter jumps to the next unanswered question. State is read through refs so
  // keys pressed in quick succession act on the question the previous key moved to.
  const activeRef = useRef(activeQ);
  activeRef.current = activeQ;
  const reachedRef = useRef(reached);
  reachedRef.current = reached;
  const answersRef = useRef(a.responses);
  answersRef.current = a.responses;
  useEffect(() => {
    const move = (q: string) => {
      activeRef.current = q;
      setActiveQ(q);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) && e.key === 'Enter') return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      const list = reachedRef.current;
      const ids = list.map((q) => q.id);
      const cur = activeRef.current;
      const i = cur ? ids.indexOf(cur) : -1;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (i < ids.length - 1) move(ids[i + 1]);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (i > 0) move(ids[i - 1]);
      } else if (e.key === 'Enter') {
        const answered = (id: string) => !!answersRef.current[id]?.answer;
        const next = list.find((q, idx) => idx > i && !answered(q.id)) ?? list.find((q) => !answered(q.id));
        if (next) {
          e.preventDefault();
          move(next.id);
        }
      } else if (/^[1-9]$/.test(e.key) && cur && canEdit) {
        const opt = getQuestion(cur)?.options[Number(e.key) - 1];
        if (opt) {
          e.preventDefault();
          setAnswer(cur, opt.code);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setActiveQ, setAnswer, canEdit]);

  useEffect(() => {
    if (activeQ) document.getElementById(`q-${activeQ}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeQ]);

  return (
    <div>
      <div className="domain-head">
        <div className="grow">
          <h2>{def.title}</h2>
          <div className="small muted">{def.description}</div>
        </div>
        {canEdit && (
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <button className="ai" disabled={!!preparing} onClick={() => void assistant.start('prepare_domain', { domain, includeSuggestions: suggest })}>
              ✦ {preparing ? 'Preparing evidence…' : 'Prepare evidence for this domain'}
            </button>
            <label className="tiny muted row gap-sm">
              <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> also suggest answers
            </label>
          </div>
        )}
      </div>
      {domain === 'D1' && <CfPanel />}
      <ConsensusPanel domain={domain} />
      {reached.map((q) => (
        <QuestionCard key={q.id} qid={q.id} />
      ))}
      {notAsked.length > 0 && (
        <div className="small muted mb">
          <a onClick={() => setShowHidden((s) => !s)} style={{ cursor: 'pointer' }}>
            {showHidden ? 'Hide' : 'Show'} {notAsked.length} question{notAsked.length === 1 ? '' : 's'} not asked on this path
          </a>
          {notAsked.some((q) => q.excluded) && <span> — includes answers kept but excluded from scoring</span>}
        </div>
      )}
      {showHidden && notAsked.map((q) => <QuestionCard key={q.id} qid={q.id} unreached />)}
      <DomainResult domain={domain} />
    </div>
  );
}

function useQuestionProposals(qid: string) {
  const assistant = useAssistant();
  const all = assistant.runs.flatMap((r) => r.proposals.map((p) => ({ p, run: r.run })));
  const forQ = all.filter(({ p }) => p.target.questionId === qid || ((p.content.questionIds as string[] | undefined) ?? []).includes(qid));
  const summary = forQ.filter(({ p }) => p.kind === 'missing_info').sort((x, y) => y.p.createdAt.localeCompare(x.p.createdAt))[0]?.p ?? null;
  return {
    evidence: forQ.filter(({ p }) => p.kind === 'evidence' && p.status === 'pending').map(({ p }) => p),
    suggestion: forQ.filter(({ p }) => p.kind === 'answer_suggestion' && p.status === 'pending').map(({ p }) => p)[0] ?? null,
    rationale: forQ.filter(({ p }) => p.kind === 'rationale' && p.status === 'pending').map(({ p }) => p)[0] ?? null,
    summary
  };
}

function QuestionCard({ qid, unreached }: { qid: string; unreached?: boolean }) {
  const ctx = useAssess();
  const { a, ev, activeQ, setActiveQ, canEdit, evidence, evidenceById, setAnswer, setRationale, confirmAnswer, setLinks, focus, addEvidenceToQuestion, payload } = ctx;
  const assistant = useAssistant();
  const { toast } = useSession();
  const q = getQuestion(qid)!;
  const r = a.responses[qid];
  const active = activeQ === qid;
  const flags = ev.flags[qid] ?? [];
  const props = useQuestionProposals(qid);
  const linked = (r?.evidenceIds ?? []).map((id) => evidenceById.get(id)).filter(Boolean) as EvidenceItem[];
  const tagged = evidence.filter((e) => e.questionIds.includes(qid) && !(r?.evidenceIds ?? []).includes(e.id));
  const busy = assistant.activeFor(['find_evidence', 'check_missing', 'draft_rationale', 'suggest_answer', 'explain_evidence'], qid);
  const [searchQ, setSearchQ] = useState('');
  const [hits, setHits] = useState<{ id: string; documentId: string; page: number; snippet: string }[] | null>(null);

  const keep = async (p: AiProposal, edits: Record<string, unknown>) => {
    const res = await assistant.accept(p, edits);
    if (res?.evidence) addEvidenceToQuestion(qid, res.evidence as EvidenceItem);
  };
  const run = (task: 'find_evidence' | 'check_missing' | 'draft_rationale' | 'suggest_answer' | 'explain_evidence', extra: Record<string, unknown> = {}) => void assistant.start(task, { questionIds: [qid], ...extra });
  const search = async () => {
    if (!searchQ.trim()) return;
    try {
      const res = await get<{ hits: { id: string; documentId: string; page: number; snippet: string }[] }>(
        `/studies/${payload.study.id}/search?q=${encodeURIComponent(searchQ)}&record=1&assessmentId=${a.id}&questionId=${qid}`
      );
      setHits(res.hits);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };

  const summary = props.summary?.content as { summary?: string; conclusion?: string; searchedFor?: string[]; missing?: { item: string; whyItMatters: string }[]; searches?: { query: string; found: boolean }[]; found?: number } | undefined;
  return (
    <div id={`q-${qid}`} className={`qcard ${active ? 'active' : ''} ${unreached ? 'unreached' : ''}`}>
      <div className="qcard-head" onClick={() => setActiveQ(active ? null : qid)}>
        <span className="qid">{qid}</span>
        <div className="qtext">
          {q.text}
          {q.conditionText && <div className="cond">{q.conditionText}</div>}
          {unreached && <div className="cond">Not asked on the current path{r?.answer ? ' — the answer is kept but excluded from scoring' : ''}.</div>}
        </div>
        {r?.answer ? <span className="answer-chip">{r.answer}</span> : !unreached && <span className="chip">unanswered</span>}
        {flags.length > 0 && <span title={flags.join('\n')}>⚠</span>}
      </div>
      {active && (
        <div className="qcard-body">
          <details>
            <summary>Guidance</summary>
            <div className="guidance">
              {q.elaboration.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
              {q.hints.map((t, i) => (
                <p key={`h${i}`} className="muted">
                  {t}
                </p>
              ))}
              <p className="faint tiny">Official response options: {q.officialResponse}</p>
            </div>
          </details>

          {summary && (summary.summary || summary.conclusion) && (
            <div className="summary-box">
              <strong>Assistant summary:</strong> {summary.summary || summary.conclusion}
              {summary.missing && summary.missing.length > 0 && (
                <ul className="problem-list">
                  {summary.missing.map((m, i) => (
                    <li key={i}>
                      <strong>{m.item}</strong> — {m.whyItMatters}
                    </li>
                  ))}
                </ul>
              )}
              {(summary.searchedFor?.length || summary.searches?.length) && (
                <div className="tiny muted mt-sm">
                  Searched for: {(summary.searchedFor ?? summary.searches?.map((s) => `${s.query}${s.found ? '' : ' (nothing)'}`) ?? []).join('; ')}
                </div>
              )}
            </div>
          )}

          <h4 className="mt">Evidence</h4>
          {linked.map((e) => (
            <EvidenceCard key={e.id} ev={e} focus={focus} onUnlink={canEdit ? () => setLinks(qid, (r?.evidenceIds ?? []).filter((x) => x !== e.id)) : undefined} onChanged={() => void ctx.reloadEvidence()} />
          ))}
          {props.evidence.map((p) => (
            <ProposalCard key={p.id} p={p} focus={focus} keepLabel={canEdit ? 'Keep & link' : 'Keep'} onKeep={(edits) => void keep(p, edits)} onDismiss={() => void assistant.reject(p)} />
          ))}
          {tagged.length > 0 && (
            <details>
              <summary>Evidence bank: {tagged.length} item{tagged.length === 1 ? '' : 's'} tagged {qid}</summary>
              {tagged.map((e) => (
                <EvidenceCard key={e.id} ev={e} focus={focus} compact onLink={canEdit ? () => setLinks(qid, [...(r?.evidenceIds ?? []), e.id]) : undefined} />
              ))}
            </details>
          )}
          {linked.length === 0 && props.evidence.length === 0 && <div className="small faint">No evidence linked. Select text in the PDF, or ask the assistant.</div>}

          {canEdit && (
            <div className="row wrap gap-sm mt-sm">
              <button className="ai xs" disabled={!!busy} onClick={() => run('find_evidence')}>
                ✦ Find evidence
              </button>
              <button className="ai xs" disabled={!!busy} onClick={() => run('check_missing')}>
                ✦ Check for missing information
              </button>
              <button className="ai xs" disabled={!!busy || linked.length === 0} onClick={() => run('explain_evidence', { evidenceIds: linked.map((e) => e.id) })}>
                ✦ Explain linked evidence
              </button>
              <button className="ai xs" disabled={!!busy} onClick={() => run('suggest_answer')} title="Only when you ask: the assistant suggests an answer for you to accept or ignore">
                ✦ Suggest an answer
              </button>
              {busy && (
                <span className="small" style={{ color: 'var(--info)' }}>
                  <span className="spinner" /> working…
                </span>
              )}
              <span className="spacer" />
              <input type="search" style={{ width: 200 }} placeholder="Search sources…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
            </div>
          )}
          {hits && (
            <div className="card flat mt-sm" style={{ padding: 8 }}>
              <div className="tiny muted">
                {hits.length} passage{hits.length === 1 ? '' : 's'} for “{searchQ}” (search recorded for {qid}). Click to open, then select text to link it.
              </div>
              {hits.slice(0, 8).map((h) => (
                <div key={h.id} className="small" style={{ padding: '3px 0', cursor: 'pointer' }} onClick={() => focus({ documentId: h.documentId, page: h.page, text: h.snippet.replace(/\[\[|\]\]/g, '').split(' … ')[0].slice(0, 80) })}>
                  <span className="faint">p.{h.page}</span> <span dangerouslySetInnerHTML={{ __html: h.snippet.replace(/</g, '&lt;').replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>') }} />
                </div>
              ))}
              {hits.length === 0 && <div className="small">No matches. Zero hits is recorded but never selects an answer by itself.</div>}
            </div>
          )}

          {props.suggestion && <Suggestion p={props.suggestion} onUse={(code) => (setAnswer(qid, code), void assistant.accept(props.suggestion!))} onDismiss={() => void assistant.reject(props.suggestion!)} />}

          <h4 className="mt">Your answer</h4>
          <OptionButtons
            options={q.options}
            value={r?.answer ?? ''}
            onChange={(code) => setAnswer(qid, code)}
            disabled={!canEdit}
            keys
            suggested={(props.suggestion?.content.suggestedAnswer as string | undefined) ?? null}
          />
          <TextArea value={r?.rationale ?? ''} rows={2} disabled={!canEdit} placeholder="Rationale (what the evidence shows and why you chose this answer)" onChange={(v) => setRationale(qid, v)} />
          {props.rationale && (
            <div className="ev proposal">
              <div className="small pre">{String(props.rationale.content.rationale)}</div>
              <div className="meta">
                <span className="chip info">Draft rationale</span>
                <span className="spacer" />
                <button className="xs ghost" onClick={() => void assistant.reject(props.rationale!)}>
                  Dismiss
                </button>
                <button
                  className="xs primary"
                  onClick={() => {
                    setRationale(qid, [r?.rationale, String(props.rationale!.content.rationale)].filter(Boolean).join('\n'));
                    void assistant.accept(props.rationale!);
                  }}
                >
                  Insert
                </button>
              </div>
            </div>
          )}
          <div className="row mt-sm">
            {canEdit && (
              <button className="ai xs" disabled={!r?.answer || !!busy} onClick={() => run('draft_rationale')} title="Drafts a rationale for the answer you chose">
                ✦ Draft rationale
              </button>
            )}
            <span className="spacer" />
            {r?.decidedBy && (
              <span className="decided">
                {r.origin === 'legacy_import' ? 'Imported' : 'Chosen'} by {r.decidedBy} · {fmtTime(r.decidedAt)}
              </span>
            )}
          </div>
          {r?.legacyEvidence && (
            <div className="flag info">
              <span>
                <strong>Evidence text from the legacy session:</strong> {r.legacyEvidence}
              </span>
            </div>
          )}
          {flags.map((f, i) => (
            <div key={i} className="flag">
              <span className="grow">⚠ {f}</span>
              {canEdit && r?.answer && /reconfirm|confirm the answer|changed after/i.test(f) && (
                <button className="xs" onClick={() => confirmAnswer(qid)}>
                  Reconfirm {r.answer}
                </button>
              )}
            </div>
          ))}
          <VerificationNotes target={qid} />
          <CheckerControls target={qid} options={q.options.map((o) => o.code)} />
        </div>
      )}
    </div>
  );
}

function Suggestion({ p, onUse, onDismiss }: { p: AiProposal; onUse: (code: string) => void; onDismiss: () => void }) {
  const c = p.content as { suggestedAnswer: string; reasoning: string; confidence: string; valid?: boolean };
  return (
    <div className="ev proposal mt">
      <div className="row">
        <span className="chip info">Suggested answer (you asked)</span>
        <span className="answer-chip">{c.suggestedAnswer}</span>
        <span className="small muted">confidence: {c.confidence}</span>
        <span className="spacer" />
        <button className="xs ghost" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="xs primary" disabled={c.valid === false} onClick={() => onUse(c.suggestedAnswer)}>
          Use {c.suggestedAnswer}
        </button>
      </div>
      <div className="interp">{c.reasoning}</div>
      {c.valid === false && <div className="flag bad">This is not a valid option for the question.</div>}
    </div>
  );
}

function DomainResult({ domain }: { domain: DomainId }) {
  const { ev, a, canEdit, decideDomain, setView, setActiveQ } = useAssess();
  const st = ev.domains[domain];
  const e = st.evaluation;
  const dec = a.domains[domain];
  const [override, setOverride] = useState<Judgement | ''>(dec?.final && dec.final !== e.suggested ? dec.final : '');
  const [reason, setReason] = useState(dec?.reason ?? '');
  useEffect(() => {
    setOverride(dec?.final && dec.final !== e.suggested ? dec.final : '');
    setReason(dec?.reason ?? '');
  }, [dec?.final, dec?.reason, e.suggested]);
  const order = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'overall'] as const;
  const next = order[order.indexOf(domain) + 1];
  return (
    <div className="algo">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          {domain} judgement
        </h3>
        {dec?.final && <span className="small muted">Confirmed by {dec.decidedBy} · {fmtTime(dec.decidedAt)}</span>}
      </div>
      {e.path.length > 0 && (
        <div className="path">
          {e.path.map((s, i) => (
            <span key={i} className="row gap-sm">
              {i > 0 && <span className="arrow">→</span>}
              <span className="step">
                {s.questionId} = {s.answer}
              </span>
            </span>
          ))}
          {e.suggested && (
            <>
              <span className="arrow">→</span>
              <JudgementBadge j={e.suggested} />
            </>
          )}
        </div>
      )}
      {e.status === 'incomplete' && (
        <div className="small">
          The algorithm needs{' '}
          <a style={{ cursor: 'pointer' }} onClick={() => setActiveQ(e.needs!)}>
            {e.needs}
          </a>{' '}
          next.
          {e.outstanding.length > 0 && ` Outstanding: ${e.outstanding.join(', ')}.`}
        </div>
      )}
      {e.status === 'invalid' && <div className="flag bad">{e.problem}</div>}
      {e.status === 'complete' && (
        <>
          <div className="row mt-sm">
            <span>Suggested by the algorithm:</span>
            <JudgementBadge j={e.suggested} large label={judgementLabel(e.suggested!, domain)} />
          </div>
          {e.outstanding.length > 0 && <div className="small muted mt-sm">Also answer {e.outstanding.join(', ')} before submitting (asked by the form even though the path does not need it).</div>}
          {dec?.needsReconfirm && <div className="flag">⚠ {dec.needsReconfirm}</div>}
          {canEdit && (
            <div className="row wrap mt">
              <button className={!override && dec?.final === e.suggested && !dec?.needsReconfirm ? 'primary' : ''} onClick={() => (setOverride(''), decideDomain(domain, e.suggested!, ''))}>
                {dec?.final === e.suggested && !dec?.needsReconfirm ? `✓ Confirmed ${e.suggested}` : `Confirm ${e.suggested}`}
              </button>
              <span className="muted small">or override to</span>
              <select value={override} onChange={(ev2) => setOverride(ev2.target.value as Judgement | '')}>
                <option value="">—</option>
                {(['Low', 'Moderate', 'Serious', 'Critical'] as Judgement[])
                  .filter((j) => j !== e.suggested)
                  .map((j) => (
                    <option key={j}>{j}</option>
                  ))}
              </select>
            </div>
          )}
          {canEdit && override && (
            <div className="mt-sm">
              <TextArea value={reason} rows={2} placeholder="Justification for overriding the algorithm (required)" onChange={setReason} />
              <button className="mt-sm" disabled={reason.trim().length < 10} onClick={() => decideDomain(domain, override, reason)}>
                Record override: {override}
              </button>
            </div>
          )}
          {!canEdit && dec?.final && (
            <div className="row mt-sm">
              Final: <JudgementBadge j={dec.final} />
              {dec.final !== e.suggested && <span className="small muted">Override — {dec.reason}</span>}
            </div>
          )}
          {dec?.final && next && (
            <div className="row mt">
              <span className="spacer" />
              <button className="primary" onClick={() => setView(next)}>
                Continue to {next === 'overall' ? 'Overall' : next} →
              </button>
            </div>
          )}
        </>
      )}
      <VerificationNotes target={domain} />
      <CheckerControls target={domain} options={['Low', 'Moderate', 'Serious', 'Critical']} />
    </div>
  );
}
