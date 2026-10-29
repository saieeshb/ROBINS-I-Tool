import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { evaluateTriage, type AnswerMap } from '@robercop/rules';
import type { EvidenceItem, ResultSpec, Study, StudyData } from '@robercop/shared';
import { errorMessage, get, patch, post } from '../../api';
import { useCrumbs } from '../../App';
import { AssistantProvider, useAssistant } from '../../assistant/AssistantContext';
import { AssistantDrawer } from '../../assistant/Drawer';
import { PdfViewer, type FocusRequest } from '../../pdf/PdfViewer';
import { SaveQueue, usePoll, useResource, deepMerge } from '../../hooks/data';
import { useSession } from '../../session';
import { StudyCtx, type LinkTarget, type StudyCtxValue, type StudyPayload } from './context';
import { CollapseNavButton, NavRail, SourceRail, usePanels } from '../panels';
import { SourcesSection } from './Sources';
import { DetailsSection, InfoSourcesSection, TargetTrialSection } from './Details';
import { ResultsSection } from './Results';
import { ConfoundersSection } from './Confounders';
import { EvidenceBankSection } from './EvidenceBank';
import { ApproveSection } from './Approve';

const SECTIONS = [
  { id: 'sources', label: 'Sources', short: 'PDF', group: 'Documents' },
  { id: 'details', label: 'Study details', short: 'Std', group: 'Study' },
  { id: 'target', label: 'C. Target trial', short: 'C', group: 'Study' },
  { id: 'info', label: 'D. Information sources', short: 'D', group: 'Study' },
  { id: 'results', label: 'A. Results & B. triage', short: 'A·B', group: 'Results' },
  { id: 'confounders', label: 'Confounding factors', short: 'CF', group: 'Results' },
  { id: 'evidence', label: 'Evidence bank', short: 'EB', group: 'Evidence' },
  { id: 'approve', label: 'Review & approve', short: '✓', group: 'Finish' }
];

export function StudyWorkspace() {
  const { studyId } = useParams();
  const { data, setData, error, reload } = useResource<StudyPayload>(`/studies/${studyId}`);
  if (error) return <div className="page banner bad">{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return (
    <AssistantProvider studyId={studyId!} onRunDone={() => void reload()}>
      <StudyInner payload={data} setPayload={setData} reload={reload} />
    </AssistantProvider>
  );
}

function sectionStatus(id: string, p: StudyPayload): 'ok' | 'warn' | 'bad' | '' {
  const has = (prefix: string[]) => p.readiness.some((r) => prefix.includes(r.target) || prefix.some((x) => r.target.startsWith(x)));
  switch (id) {
    case 'sources':
      return p.documents.length === 0 ? 'bad' : p.documents.every((d) => d.job) ? 'ok' : 'warn';
    case 'details':
      return has(['citation']) ? 'warn' : 'ok';
    case 'target':
      return has(['c1', 'c2', 'c3']) ? 'warn' : 'ok';
    case 'info':
      return has(['sources']) ? 'warn' : 'ok';
    case 'results':
      return p.results.length === 0 ? 'bad' : has(['results', ...p.results.map((r) => r.id)]) ? 'warn' : 'ok';
    case 'confounders':
      return has(p.study.data.confounders.map((c) => c.id)) ? 'warn' : p.study.data.confounders.length ? 'ok' : '';
    case 'approve':
      return p.study.status === 'approved' ? 'ok' : p.readiness.length ? '' : 'warn';
    default:
      return '';
  }
}

function StudyInner({ payload, setPayload, reload }: { payload: StudyPayload; setPayload: (p: StudyPayload) => void; reload: () => Promise<void> }) {
  const { section = 'sources' } = useParams();
  const nav = useNavigate();
  const { toast } = useSession();
  const assistant = useAssistant();
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const study = payload.study;
  useCrumbs([{ label: payload.project.name, to: `/projects/${payload.project.id}` }, { label: `${study.label} · Study session` }]);

  const reloadEvidence = useCallback(async () => {
    setEvidence(await get<EvidenceItem[]>(`/studies/${study.id}/evidence`));
  }, [study.id]);
  useEffect(() => {
    void reloadEvidence();
  }, [reloadEvidence]);

  const parsing = payload.documents.some((d) => ['queued', 'running'].includes(d.latestJob?.status ?? ''));
  usePoll(() => {
    void reload();
    void reloadEvidence();
  }, parsing, 2000);

  // --- autosave: study (whole data object) and one queue per result --------------------------------------------
  const studyQueue = useMemo(
    () =>
      new SaveQueue<{ label?: string; data?: StudyData }, Study>({
        key: `study:${study.id}`,
        version: study.version,
        merge: (a, b) => ({ ...a, ...b }),
        send: async (p, version) => {
          const res = await patch<{ study: Study; readiness: StudyPayload['readiness'] }>(`/studies/${study.id}`, { ...p, version });
          setPayload({ ...payloadRef.current, study: res.study, readiness: res.readiness });
          return res.study;
        },
        onSaved: () => {},
        onConflict: () => toast('This study was changed in another window. Reloading the latest version.', true),
        onError: (m) => toast(m, true)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [study.id]
  );
  studyQueue.setVersion(study.version);
  const resultQueues = useRef(new Map<string, SaveQueue<Partial<ResultSpec>, ResultSpec>>());
  useEffect(() => {
    const queues = resultQueues.current;
    return () => {
      studyQueue.dispose();
      for (const q of queues.values()) q.dispose();
    };
  }, [studyQueue]);

  const updateData = useCallback(
    (fn: (d: StudyData) => void) => {
      const next = structuredClone(payloadRef.current.study.data);
      fn(next);
      setPayload({ ...payloadRef.current, study: { ...payloadRef.current.study, data: next } });
      studyQueue.queue({ data: next });
    },
    [setPayload, studyQueue]
  );

  const updateLabel = useCallback(
    (label: string) => {
      setPayload({ ...payloadRef.current, study: { ...payloadRef.current.study, label } });
      studyQueue.queue({ label });
    },
    [setPayload, studyQueue]
  );

  const updateResult = useCallback(
    (id: string, change: Partial<ResultSpec>) => {
      const cur = payloadRef.current.results.find((r) => r.id === id);
      if (!cur) return;
      let q = resultQueues.current.get(id);
      if (!q) {
        q = new SaveQueue<Partial<ResultSpec>, ResultSpec>({
          key: `result:${id}`,
          version: cur.version,
          merge: (a, b) => deepMerge(a, b),
          send: async (p, version) => patch<ResultSpec>(`/results/${id}`, { ...p, version }),
          onSaved: (saved) => {
            const p = payloadRef.current;
            setPayload({ ...p, results: p.results.map((r) => (r.id === id ? { ...saved, ...pendingView(r, saved) } : r)) });
            void get<StudyPayload>(`/studies/${p.study.id}`).then((fresh) => setPayload({ ...payloadRef.current, study: fresh.study, readiness: fresh.readiness }));
          },
          onConflict: () => toast('This result was changed elsewhere; reloading.', true),
          onError: (m) => toast(m, true)
        });
        resultQueues.current.set(id, q);
      }
      const next = deepMerge(cur, change) as ResultSpec;
      if (change.importantFactors) next.importantFactors = change.importantFactors;
      setPayload({ ...payloadRef.current, results: payloadRef.current.results.map((r) => (r.id === id ? next : r)) });
      q.queue(change.importantFactors ? { ...change, importantFactors: change.importantFactors } : change);
    },
    [setPayload, toast]
  );

  const linkedIds = useCallback((t: LinkTarget): string[] => {
    const p = payloadRef.current;
    if (t.kind === 'tt') return p.study.data.targetTrial.links[t.field] ?? [];
    if (t.kind === 'cf') return p.study.data.confounders.find((c) => c.id === t.rowId)?.evidenceIds ?? [];
    const r = p.results.find((x) => x.id === t.resultId);
    if (!r) return [];
    return t.kind === 'triage' ? r.triage.evidenceIds[t.q] ?? [] : r.evidenceIds;
  }, []);

  const linkEvidence = useCallback(
    (t: LinkTarget, evidenceId: string, add = true) => {
      const toggle = (list: string[]) => (add ? [...new Set([...list, evidenceId])] : list.filter((x) => x !== evidenceId));
      if (t.kind === 'tt') updateData((d) => void (d.targetTrial.links[t.field] = toggle(d.targetTrial.links[t.field] ?? [])));
      else if (t.kind === 'cf') updateData((d) => {
        const row = d.confounders.find((c) => c.id === t.rowId);
        if (row) row.evidenceIds = toggle(row.evidenceIds);
      });
      else {
        const r = payloadRef.current.results.find((x) => x.id === t.resultId);
        if (!r) return;
        if (t.kind === 'triage') updateResult(r.id, { triage: { ...r.triage, evidenceIds: { ...r.triage.evidenceIds, [t.q]: toggle(r.triage.evidenceIds[t.q] ?? []) } } });
        else updateResult(r.id, { evidenceIds: toggle(r.evidenceIds) });
      }
    },
    [updateData, updateResult]
  );

  const panels = usePanels();
  const { showSource } = panels;
  // Jumping to a page re-opens the source if it was folded away.
  const focus = useCallback(
    (f: Omit<FocusRequest, 'nonce'>) => {
      showSource();
      setFocusReq({ ...f, nonce: Date.now() });
    },
    [showSource]
  );
  // Choosing "Select in PDF" for a field needs the PDF visible.
  useEffect(() => {
    if (linkTarget) showSource();
  }, [linkTarget, showSource]);
  const go = useCallback(
    (s: string, anchor?: string) => {
      setLinkTarget(null);
      nav(`/studies/${study.id}/${s}`);
      if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    },
    [nav, study.id]
  );

  const addSelection = async (sel: { documentId: string; page: number; text: string }) => {
    try {
      const ev = await post<EvidenceItem>(`/studies/${study.id}/evidence`, {
        quote: sel.text,
        documentId: sel.documentId,
        page: sel.page,
        questionIds: linkTarget?.kind === 'tt' ? [linkTarget.field.toUpperCase()] : linkTarget?.kind === 'triage' ? [linkTarget.q] : []
      });
      setEvidence((e) => [...e, ev]);
      if (linkTarget) {
        linkEvidence(linkTarget, ev.id);
        toast(`Quotation added and linked to ${linkTarget.label} (${ev.check.status.replace(/_/g, ' ')})`);
      } else toast(`Quotation added to the evidence bank (${ev.check.status.replace(/_/g, ' ')})`);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };

  const settle = useCallback(async () => {
    await Promise.all([studyQueue.settle(), ...[...resultQueues.current.values()].map((q) => q.settle())]);
  }, [studyQueue]);
  const ctx: StudyCtxValue = { payload, evidence, reloadEvidence, reload, settle, updateData, updateLabel, updateResult, focus, linkTarget, setLinkTarget, linkEvidence, linkedIds, go };
  const docs = payload.documents.map((d) => ({ id: d.id, label: d.label, role: d.role, parsed: !!d.job }));
  const highlights = evidence.filter((e) => e.kind === 'quote' && e.check.locations[0]).map((e) => ({ documentId: e.check.locations[0].documentId, page: e.check.locations[0].page, text: e.check.locations[0].text }));
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  const passed = payload.results.filter((r) => evaluateTriage(r.triage.answers as AnswerMap).status === 'passed').length;

  const navRail = (
    <NavRail onExpand={panels.toggleNav} onAssistant={assistant.drawerOpen ? undefined : () => assistant.setDrawerOpen(true)}>
      <span className="rail-sep" />
      {SECTIONS.map((s) => {
        const st = sectionStatus(s.id, payload);
        return (
          <button key={s.id} className={`rail-item ${section === s.id ? 'active' : ''}`} onClick={() => go(s.id)} title={s.label} aria-label={s.label}>
            {s.short}
            <span className={`bar ${st === 'ok' ? 'Low' : st === 'warn' ? 'pending' : st === 'bad' ? 'Serious' : ''}`} />
          </button>
        );
      })}
    </NavRail>
  );
  const navFull = (
    <>
      <CollapseNavButton onClick={panels.toggleNav} />
      <div className="ws-nav-head">
        <strong>{study.label}</strong>
        <div className="small muted">
          Study session ·{' '}
          <span style={{ color: study.status === 'approved' ? 'var(--ok)' : study.status === 'changed' ? 'var(--warn)' : undefined }}>
            {study.status === 'approved' ? 'approved' : study.status === 'changed' ? 'changed since approval' : 'draft'}
          </span>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="nav-section">{g}</div>
          {SECTIONS.filter((s) => s.group === g).map((s) => (
            <button key={s.id} className={`nav-item ${section === s.id ? 'active' : ''}`} onClick={() => go(s.id)}>
              <span className={`dot ${sectionStatus(s.id, payload) || 'hollow'}`} />
              <span className="grow">{s.label}</span>
              {s.id === 'results' && <span className="tiny faint">{payload.results.length}</span>}
              {s.id === 'evidence' && <span className="tiny faint">{evidence.length}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="nav-section">Domain sessions</div>
      <div className="small muted" style={{ padding: '0 8px' }}>
        {passed} of {payload.results.length} results passed triage.{' '}
        {study.approvedRevisionId ? <a onClick={() => go('approve')}>Start or continue →</a> : 'Approve the study to start.'}
      </div>
      {!assistant.drawerOpen && (
        <button className="ai mt" style={{ margin: '16px 8px' }} onClick={() => assistant.setDrawerOpen(true)}>
          ✦ Show assistant
        </button>
      )}
      <div className="tiny faint" style={{ padding: '4px 8px' }}>
        <span className="kbd">[</span> <span className="kbd">]</span> fold side panels
      </div>
    </>
  );

  return (
    <StudyCtx.Provider value={ctx}>
      <div className={`workspace ${assistant.drawerOpen ? 'drawer-open' : ''} ${panels.className}`}>
        <aside className="ws-nav">{panels.navCollapsed ? navRail : navFull}</aside>
        <main className="ws-main">
          {linkTarget && (
            <div className="banner info" style={{ position: 'sticky', top: -16, zIndex: 5 }}>
              <span className="grow">
                Select text in the PDF to add it as evidence for <strong>{linkTarget.label}</strong>.
              </span>
              <button className="xs" onClick={() => setLinkTarget(null)}>
                Done
              </button>
            </div>
          )}
          {section === 'sources' && <SourcesSection />}
          {section === 'details' && <DetailsSection />}
          {section === 'target' && <TargetTrialSection />}
          {section === 'info' && <InfoSourcesSection />}
          {section === 'results' && <ResultsSection />}
          {section === 'confounders' && <ConfoundersSection />}
          {section === 'evidence' && <EvidenceBankSection />}
          {section === 'approve' && <ApproveSection />}
        </main>
        <section className="ws-source">
          {panels.sourceCollapsed && <SourceRail onExpand={panels.toggleSource} count={docs.length} />}
          <div className="viewer">
            <PdfViewer
              docs={docs}
              focus={focusReq}
              highlights={highlights}
              onSelectText={addSelection}
              selectLabel={linkTarget ? `Add as evidence for ${linkTarget.label}` : 'Add to evidence bank'}
              onCollapse={panels.toggleSource}
            />
          </div>
        </section>
        {assistant.drawerOpen && (
          <aside className="ws-drawer">
            <AssistantDrawer
              contextLabel={`${study.label} (Study session)`}
              chatScope={() => ({})}
              actions={
                <>
                  <button className="ai sm" onClick={() => void assistant.start('extract_study')} disabled={!!assistant.activeFor('extract_study')}>
                    ✦ Extract study details
                  </button>
                  <button className="ai sm" onClick={() => void assistant.start('find_evidence')} disabled={!!assistant.activeFor('find_evidence')}>
                    ✦ Build evidence bank
                  </button>
                  <button className="ai sm" onClick={() => void assistant.start('evaluate_confounders')} disabled={!!assistant.activeFor('evaluate_confounders') || study.data.confounders.length === 0}>
                    ✦ Evaluate confounders
                  </button>
                </>
              }
            />
          </aside>
        )}
      </div>
    </StudyCtx.Provider>
  );
}

/** Keeps the locally edited view of a result when an older save returns (so typing is never overwritten). */
function pendingView(local: ResultSpec, saved: ResultSpec): Partial<ResultSpec> {
  const { version: _v, updatedAt: _u, createdAt: _c, ...rest } = local;
  void saved;
  return rest;
}
