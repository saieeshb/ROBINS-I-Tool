import { useMemo, useState } from 'react';
import { QUESTIONS } from '@robercop/rules';
import type { EvidenceItem } from '@robercop/shared';
import { errorMessage, get, post } from '../../api';
import { useAssistant } from '../../assistant/AssistantContext';
import { EvidenceCard, ProposalCard } from '../../evidence/Evidence';
import { useSession } from '../../session';
import { useStudy } from './context';

interface Hit {
  id: string;
  documentId: string;
  page: number;
  section: string;
  snippet: string;
  text: string;
}

export function EvidenceBankSection() {
  const { payload, evidence, focus, reloadEvidence } = useStudy();
  const { toast } = useSession();
  const assistant = useAssistant();
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [note, setNote] = useState('');
  const proposals = assistant.pending((p) => p.kind === 'evidence' && !p.target.questionId?.startsWith('C'));
  const busy = !!assistant.activeFor('find_evidence');
  const filtered = useMemo(
    () => evidence.filter((e) => !filter || e.questionIds.includes(filter) || (filter === 'unverified' && e.kind === 'quote' && !['matched', 'manually_verified'].includes(e.check.status))),
    [evidence, filter]
  );

  const search = async () => {
    if (!q.trim()) return;
    try {
      const res = await get<{ hits: Hit[] }>(`/studies/${payload.study.id}/search?q=${encodeURIComponent(q)}&record=1`);
      setHits(res.hits);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };

  return (
    <div>
      <div className="row mb">
        <h2 className="grow" style={{ margin: 0 }}>
          Evidence bank
        </h2>
        <button className="ai sm" disabled={busy} onClick={() => void assistant.start('find_evidence')}>
          ✦ {busy ? 'Building…' : 'Build evidence bank'}
        </button>
      </div>
      <p className="muted small">
        Study-level quotations, tagged with the questions they may inform. Tags never carry answers. Every quotation is checked against the parsed source; select text in the PDF to add your own.
      </p>

      <div className="card">
        <div className="row">
          <input type="search" placeholder="Search the sources (full text)…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
          <button onClick={() => void search()}>Search</button>
        </div>
        {hits && (
          <div className="mt-sm">
            <div className="small muted">
              {hits.length} passage{hits.length === 1 ? '' : 's'} (search recorded)
            </div>
            {hits.slice(0, 12).map((h) => (
              <div key={h.id} className="ev">
                <div className="small" dangerouslySetInnerHTML={{ __html: escapeSnippet(h.snippet) }} />
                <div className="meta">
                  <a onClick={() => focus({ documentId: h.documentId, page: h.page, text: h.snippet.replace(/\[\[|\]\]/g, '').replace(/ … /g, ' ').slice(0, 80) })}>p. {h.page} ↗</a>
                  {h.section && <span>{h.section}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {proposals.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3 className="grow">Suggested by the assistant ({proposals.length})</h3>
            <button className="xs" onClick={async () => {
              for (const p of proposals.filter((x) => x.check?.status === 'matched')) await assistant.accept(p);
              void reloadEvidence();
            }}>
              Keep all matched
            </button>
          </div>
          {proposals.map((p) => (
            <div key={p.id}>
              <div className="tiny faint mt-sm">{((p.content.questionIds as string[]) ?? []).join(', ') || 'untagged'}</div>
              <ProposalCard
                p={p}
                focus={focus}
                onKeep={async (edits) => {
                  await assistant.accept(p, edits);
                  void reloadEvidence();
                }}
                onDismiss={() => void assistant.reject(p)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="grow">Kept evidence ({evidence.length})</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="unverified">Needs source check</option>
            {['C1', 'C2', 'C3', 'C4', 'A1', 'CF', ...QUESTIONS.map((x) => x.id)].map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        {filtered.length === 0 && <div className="small faint">Nothing here yet.</div>}
        {filtered.map((e) => (
          <div key={e.id}>
            {e.questionIds.length > 0 && <div className="tiny faint mt-sm">{e.questionIds.join(', ')}</div>}
            <EvidenceCard ev={e} focus={focus} onChanged={() => void reloadEvidence()} />
          </div>
        ))}
        <div className="row mt">
          <input placeholder="Add a note (e.g. 'Protocol not found on ClinicalTrials.gov, searched 2026-05-01')" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            disabled={!note.trim()}
            onClick={async () => {
              try {
                await post<EvidenceItem>(`/studies/${payload.study.id}/evidence`, { kind: 'note', interpretation: note });
                setNote('');
                void reloadEvidence();
              } catch (e) {
                toast(errorMessage(e), true);
              }
            }}
          >
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeSnippet(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
}
