import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DOMAINS, judgementLabel, type DomainId, type Judgement } from '@robercop/rules';
import { evaluateAssessment, emptyResponse, type Assessment, type EvidenceItem } from '@robercop/shared';
import { errorMessage, get, patch, post } from '../../api';
import { useCrumbs } from '../../App';
import { AssistantProvider, useAssistant } from '../../assistant/AssistantContext';
import { AssistantDrawer } from '../../assistant/Drawer';
import { JudgementBadge } from '../../components/ui';
import { PdfViewer, type FocusRequest } from '../../pdf/PdfViewer';
import { SaveQueue, deepMerge, useResource } from '../../hooks/data';
import { useSession } from '../../session';
import { AssessCtx, useAssess, type AssessCtxValue, type AssessmentPayload, type View } from './context';
import { DomainPanel } from './DomainPanel';
import { FinishPanel, OverallPanel, TriagePanel } from './OverallPanel';

type Patch = {
  responses?: Record<string, { answer?: string; rationale?: string; evidenceIds?: string[]; confirm?: boolean }>;
  domains?: Partial<Record<DomainId, { final: Judgement | ''; reason?: string }>>;
  overall?: { final: Judgement | ''; reason?: string };
};

export function AssessmentWorkspace() {
  const { assessmentId } = useParams();
  const { data, setData, error, reload } = useResource<AssessmentPayload>(`/assessments/${assessmentId}`);
  if (error) return <div className="page"><div className="banner bad">{error}</div></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return (
    <AssistantProvider studyId={data.study.id} assessmentId={data.assessment.id}>
      <Inner payload={data} setPayload={setData} reload={reload} />
    </AssistantProvider>
  );
}

function Inner({ payload, setPayload, reload }: { payload: AssessmentPayload; setPayload: (p: AssessmentPayload) => void; reload: () => Promise<void> }) {
  const { toast, reviewer } = useSession();
  const assistant = useAssistant();
  const [params, setParams] = useSearchParams();
  const [a, setA] = useState<Assessment>(payload.assessment);
  const [evidence, setEvidence] = useState<EvidenceItem[]>(payload.evidence);
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const aRef = useRef(a);
  aRef.current = a;
  const snapshot = payload.revision.snapshot;
  const canEdit = payload.canEdit;
  const isChecker = payload.project.verificationMode === 'checking' && a.reviewer !== reviewer && a.role === 'first' && a.status === 'submitted';
  useCrumbs([
    { label: payload.project.name, to: `/projects/${payload.project.id}` },
    { label: payload.study.label, to: `/studies/${payload.study.id}` },
    { label: `${payload.resultName} · ${a.role === 'consensus' ? 'Consensus' : `Domain session (${a.reviewer})`}` }
  ]);

  useEffect(() => setA(payload.assessment), [payload.assessment]);
  useEffect(() => setEvidence(payload.evidence), [payload.evidence]);

  const evidenceById = useMemo(() => new Map(evidence.map((e) => [e.id, e])), [evidence]);
  const ev = useMemo(() => evaluateAssessment(a, snapshot, evidenceById), [a, snapshot, evidenceById]);

  const queue = useMemo(
    () =>
      new SaveQueue<Patch, Assessment>({
        key: `assessment:${a.id}`,
        version: a.version,
        merge: (x, y) => deepMerge(x, y),
        send: (p, version) => patch<Assessment>(`/assessments/${aRef.current.id}`, { ...p, version }),
        onSaved: (saved) => {
          // Keep server-side fields (attribution, invalidation flags) but never drop local edits made meanwhile.
          setA((cur) => (cur.version >= saved.version ? cur : mergeSaved(cur, saved)));
        },
        onConflict: () => toast('This assessment changed in another window. Reload to continue; your unsaved edits are kept locally.', true),
        onError: (m) => {
          toast(m, true);
          void reload();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.id]
  );
  queue.setVersion(a.version);
  useEffect(() => () => queue.dispose(), [queue]);
  useEffect(() => {
    if (queue.hasDraft() && canEdit && queue.resumeDraft(payload.assessment.version)) toast('Restored unsaved changes from your last session.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = () => new Date().toISOString();
  const local = useCallback(
    (fn: (x: Assessment) => void, p: Patch) => {
      if (!canEdit) return;
      setA((cur) => {
        const next = structuredClone(cur);
        fn(next);
        return next;
      });
      queue.queue(p);
    },
    [canEdit, queue]
  );

  const setAnswer = useCallback(
    (qid: string, answer: string) =>
      local(
        (x) => {
          const r = (x.responses[qid] ??= emptyResponse());
          if (r.answer === answer) return;
          r.answer = answer as never;
          r.decidedBy = answer ? reviewer : null;
          r.decidedAt = answer ? t() : null;
          r.origin = 'reviewer';
          r.needsReconfirm = null;
          const d = DOMAINS.find((dd) => dd.questionIds.includes(qid))!.id;
          if (x.domains[d]?.final) x.domains[d]!.needsReconfirm = 'Answers in this domain changed after the judgement was confirmed.';
          if (x.overall.final) x.overall.needsReconfirm = 'Domain answers changed after the overall judgement was confirmed.';
        },
        { responses: { [qid]: { answer } } }
      ),
    [local, reviewer]
  );
  const setRationale = useCallback((qid: string, text: string) => local((x) => void ((x.responses[qid] ??= emptyResponse()).rationale = text), { responses: { [qid]: { rationale: text } } }), [local]);
  const confirmAnswer = useCallback(
    (qid: string) =>
      local(
        (x) => {
          const r = (x.responses[qid] ??= emptyResponse());
          r.decidedBy = reviewer;
          r.decidedAt = t();
          r.origin = 'reviewer';
          r.needsReconfirm = null;
        },
        { responses: { [qid]: { confirm: true } } }
      ),
    [local, reviewer]
  );
  const setLinks = useCallback((qid: string, ids: string[]) => local((x) => void ((x.responses[qid] ??= emptyResponse()).evidenceIds = ids), { responses: { [qid]: { evidenceIds: ids } } }), [local]);
  const decideDomain = useCallback(
    (d: DomainId, final: Judgement | '', reason: string) =>
      local(
        (x) => {
          x.domains[d] = { final, reason, suggestedAtDecision: ev.domains[d].evaluation.suggested ?? '', rulesetVersion: x.rulesetVersion, decidedBy: final ? reviewer : null, decidedAt: final ? t() : null, origin: 'reviewer', needsReconfirm: null };
          if (x.overall.final) x.overall.needsReconfirm = 'A domain judgement changed after the overall judgement was confirmed.';
        },
        { domains: { [d]: { final, reason } } }
      ),
    [local, reviewer, ev]
  );
  const decideOverall = useCallback(
    (final: Judgement | '', reason: string) =>
      local(
        (x) => void (x.overall = { final, reason, suggestedAtDecision: ev.overall.suggested ?? '', rulesetVersion: x.rulesetVersion, decidedBy: final ? reviewer : null, decidedAt: final ? t() : null, origin: 'reviewer', needsReconfirm: null }),
        { overall: { final, reason } }
      ),
    [local, reviewer, ev]
  );

  const reloadEvidence = useCallback(async () => setEvidence(await get<EvidenceItem[]>(`/studies/${payload.study.id}/evidence?assessmentId=${a.id}`)), [payload.study.id, a.id]);
  const addEvidenceToQuestion = useCallback(
    (qid: string, e: EvidenceItem) => {
      setEvidence((list) => (list.some((x) => x.id === e.id) ? list : [...list, e]));
      const cur = aRef.current.responses[qid]?.evidenceIds ?? [];
      if (!cur.includes(e.id)) setLinks(qid, [...cur, e.id]);
    },
    [setLinks]
  );

  // --- navigation ----------------------------------------------------------------------------------------------
  const defaultView: View = ev.triageCritical ? 'overall' : 'D1';
  const view = (params.get('view') as View) || defaultView;
  const activeQ = params.get('q');
  const setView = useCallback(
    (v: View, q?: string | null) => {
      const next = new URLSearchParams();
      next.set('view', v);
      if (q) next.set('q', q);
      setParams(next, { replace: false });
      document.querySelector('.ws-main')?.scrollTo({ top: 0 });
    },
    [setParams]
  );
  const setActiveQ = useCallback(
    (q: string | null) => {
      const next = new URLSearchParams(params);
      if (q) next.set('q', q);
      else next.delete('q');
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const focus = useCallback((f: Omit<FocusRequest, 'nonce'>) => setFocusReq({ ...f, nonce: Date.now() }), []);
  const ctx: AssessCtxValue = {
    payload,
    a,
    ev,
    evidence,
    evidenceById,
    canEdit,
    isChecker,
    setAnswer,
    setRationale,
    confirmAnswer,
    setLinks,
    decideDomain,
    decideOverall,
    activeQ,
    setActiveQ,
    view,
    setView,
    focus,
    reload,
    reloadEvidence,
    addEvidenceToQuestion
  };

  // Evidence highlighted in the PDF: what is linked to the active question (or the whole domain).
  const highlightIds = activeQ ? a.responses[activeQ]?.evidenceIds ?? [] : DOMAINS.find((d) => d.id === view)?.questionIds.flatMap((q) => a.responses[q]?.evidenceIds ?? []) ?? [];
  const highlights = highlightIds
    .map((id) => evidenceById.get(id))
    .filter((e): e is EvidenceItem => !!e && e.kind === 'quote' && !!e.check.locations[0])
    .map((e) => ({ documentId: e.check.locations[0].documentId, page: e.check.locations[0].page, text: e.check.locations[0].text }));

  const addSelection = async (sel: { documentId: string; page: number; text: string }) => {
    try {
      const e = await post<EvidenceItem>(`/studies/${payload.study.id}/evidence`, { quote: sel.text, documentId: sel.documentId, page: sel.page, assessmentId: a.id, questionIds: activeQ ? [activeQ] : [] });
      if (activeQ && canEdit) {
        addEvidenceToQuestion(activeQ, e);
        toast(`Linked to ${activeQ} (${e.check.status.replace(/_/g, ' ')})`);
      } else {
        setEvidence((l) => [...l, e]);
        toast('Quotation saved to this assessment’s evidence');
      }
    } catch (err) {
      toast(errorMessage(err), true);
    }
  };

  const latestRevision = payload.study.approvedRevisionId;
  const docs = payload.documents.map((d) => ({ id: d.id, label: d.label, role: d.role, parsed: !!d.job }));

  return (
    <AssessCtx.Provider value={ctx}>
      <div className={`workspace ${assistant.drawerOpen ? 'drawer-open' : ''}`}>
        <aside className="ws-nav">
          <Nav />
          {!assistant.drawerOpen && (
            <button className="ai mt" style={{ margin: '16px 8px' }} onClick={() => assistant.setDrawerOpen(true)}>
              ✦ Show assistant
            </button>
          )}
        </aside>
        <main className="ws-main">
          {latestRevision && latestRevision !== a.studyRevisionId && (
            <div className="banner warn">
              <span className="grow">This assessment uses study revision #{payload.revision.revisionNo}; a newer approved revision exists.</span>
              {(canEdit || a.status === 'submitted') && a.reviewer === reviewer && (
                <button
                  className="sm"
                  onClick={async () => {
                    try {
                      await post(`/assessments/${a.id}/rebase`, {});
                      toast('Moved to the latest study revision. Check flagged judgements.');
                      void reload();
                    } catch (e) {
                      toast(errorMessage(e), true);
                    }
                  }}
                >
                  Move to latest revision
                </button>
              )}
            </div>
          )}
          {!canEdit && !isChecker && (
            <div className="banner info">
              {a.status === 'finalized' ? 'Finalized — read only.' : a.status === 'submitted' ? 'Submitted — read only. Reopen it from Finish to make changes.' : `Read only: this assessment belongs to ${a.reviewer}.`}
            </div>
          )}
          {isChecker && <div className="banner info">You are checking {a.reviewer}’s assessment. Confirm each answer or request a change; the first reviewer resolves requests.</div>}
          {view === 'triage' && <TriagePanel />}
          {DOMAINS.some((d) => d.id === view) && <DomainPanel domain={view as DomainId} />}
          {view === 'overall' && <OverallPanel />}
          {view === 'finish' && <FinishPanel />}
        </main>
        <section className="ws-source">
          <PdfViewer docs={docs} focus={focusReq} highlights={highlights} onSelectText={canEdit ? addSelection : undefined} selectLabel={activeQ ? `Add as evidence for ${activeQ}` : 'Save as evidence'} />
        </section>
        {assistant.drawerOpen && (
          <aside className="ws-drawer">
            <AssistantDrawer
              contextLabel={activeQ ? `${payload.resultName} · ${activeQ}` : payload.resultName}
              chatScope={() => ({ questionIds: activeQ ? [activeQ] : [] })}
              actions={
                canEdit && DOMAINS.some((d) => d.id === view) ? (
                  <>
                    <button className="ai sm" disabled={!!assistant.activeFor('prepare_domain')} onClick={() => void assistant.start('prepare_domain', { domain: view })}>
                      ✦ Prepare {view}
                    </button>
                    {activeQ && (
                      <button className="ai sm" disabled={!!assistant.activeFor('find_evidence', activeQ)} onClick={() => void assistant.start('find_evidence', { questionIds: [activeQ] })}>
                        ✦ Find evidence for {activeQ}
                      </button>
                    )}
                  </>
                ) : undefined
              }
            />
          </aside>
        )}
      </div>
    </AssessCtx.Provider>
  );
}

/** Merges a saved assessment into the local copy, keeping local values for anything edited since. */
function mergeSaved(local: Assessment, saved: Assessment): Assessment {
  const out: Assessment = { ...saved, responses: { ...saved.responses }, domains: { ...saved.domains } };
  for (const [q, r] of Object.entries(local.responses)) {
    const s = saved.responses[q];
    if (!s) out.responses[q] = r;
    else out.responses[q] = { ...s, answer: r.answer, rationale: r.rationale, evidenceIds: r.evidenceIds };
  }
  for (const [d, dec] of Object.entries(local.domains)) {
    const s = saved.domains[d as DomainId];
    if (!s || s.final !== dec!.final || s.reason !== dec!.reason) out.domains[d as DomainId] = { ...(s ?? dec!), final: dec!.final, reason: dec!.reason };
  }
  if (local.overall.final !== saved.overall.final || local.overall.reason !== saved.overall.reason) out.overall = { ...saved.overall, final: local.overall.final, reason: local.overall.reason };
  return out;
}

function Nav() {
  const { payload, a, ev, view, setView, activeQ } = useAssess();
  const statusOf = (qid: string) => {
    const r = a.responses[qid];
    if (ev.flags[qid]?.length && r?.answer) return 'warn';
    return r?.answer ? 'ok' : '';
  };
  return (
    <>
      <div style={{ padding: '4px 8px 8px' }}>
        <strong>{payload.study.label}</strong>
        <div className="small">{payload.resultName}</div>
        <div className="small muted">
          {a.role === 'consensus' ? 'Consensus record' : `${a.reviewer} · ${a.role} assessment`} · {a.status}
        </div>
        {!ev.triageCritical && (
          <div className="mt-sm">
            <div className="progress">
              <div style={{ width: `${ev.progress.reached ? Math.round((100 * ev.progress.answered) / ev.progress.reached) : 0}%` }} />
            </div>
            <div className="tiny faint mt-sm">
              {ev.progress.answered} of {ev.progress.reached} reached questions answered
            </div>
          </div>
        )}
      </div>
      <div className="nav-section">Preliminary</div>
      <button className={`nav-item ${view === 'triage' ? 'active' : ''}`} onClick={() => setView('triage')}>
        <span className={`dot ${ev.triageCritical ? 'bad' : ev.triage.status === 'passed' ? 'ok' : 'warn'}`} />
        <span className="grow">Result & triage</span>
        {ev.triageCritical && <JudgementBadge j="Critical" />}
      </button>
      {!ev.triageCritical && (
        <>
          <div className="nav-section">Domains</div>
          {DOMAINS.map((d) => {
            const st = ev.domains[d.id];
            const reached = st.evaluation.questions.filter((q) => q.reached);
            return (
              <div key={d.id}>
                <button className={`nav-item ${view === d.id ? 'active' : ''}`} onClick={() => setView(d.id)}>
                  <span className={`dot ${st.check.ok && !st.decision.needsReconfirm ? 'ok' : st.evaluation.status === 'complete' ? 'warn' : 'hollow'}`} />
                  <span className="grow">
                    {d.id}. {d.short}
                  </span>
                  {st.final ? <JudgementBadge j={st.final} /> : st.evaluation.suggested ? <span className="tiny faint">{st.evaluation.suggested}?</span> : null}
                </button>
                {view === d.id && (
                  <div className="nav-sub">
                    {reached.map((q) => (
                      <button key={q.id} className={`nav-item ${activeQ === q.id ? 'active' : ''}`} onClick={() => setView(d.id, q.id)}>
                        <span className={`dot ${statusOf(q.id) || 'hollow'}`} />
                        <span className="grow mono">{q.id}</span>
                        <span className="tiny mono">{a.responses[q.id]?.answer}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      <div className="nav-section">Result</div>
      <button className={`nav-item ${view === 'overall' ? 'active' : ''}`} onClick={() => setView('overall')}>
        <span className={`dot ${ev.overall.check.ok && !a.overall.needsReconfirm ? 'ok' : 'hollow'}`} />
        <span className="grow">Overall</span>
        {a.overall.final ? <JudgementBadge j={a.overall.final} label={a.overall.final === 'Low' ? 'Low*' : undefined} /> : null}
      </button>
      <button className={`nav-item ${view === 'finish' ? 'active' : ''}`} onClick={() => setView('finish')}>
        <span className={`dot ${ev.problems.length === 0 ? 'ok' : 'hollow'}`} />
        <span className="grow">Finish & submit</span>
        {ev.problems.length > 0 && <span className="tiny faint">{ev.problems.length} open</span>}
      </button>
      <div className="tiny faint" style={{ padding: '12px 8px' }}>
        Keys: <span className="kbd">↑</span>/<span className="kbd">↓</span> question · <span className="kbd">1</span>–<span className="kbd">6</span> answer · <span className="kbd">Enter</span> next unanswered
        <br />* {judgementLabel('Low', 'overall')}
      </div>
    </>
  );
}

