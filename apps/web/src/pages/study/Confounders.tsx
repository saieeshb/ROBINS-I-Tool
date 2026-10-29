import { Fragment, useState } from 'react';
import { CF_UNNECESSARY_CONDITIONS } from '@robercop/rules';
import type { AiProposal, ConfounderRow, SourceCheck } from '@robercop/shared';
import { useAssistant } from '../../assistant/AssistantContext';
import { TextInput } from '../../components/ui';
import { useStudy } from './context';
import { LinkedEvidence, SupportingQuote } from './Linked';

function newRow(factor: string): ConfounderRow {
  return { id: crypto.randomUUID(), factor, list: 'additional', variables: '', controlled: '', valid: '', unnecessary: '', unnecessaryCondition: '', comments: '', evidenceIds: [] };
}

export function needsControl(c: ConfounderRow): boolean {
  return c.controlled === 'N' && !['Y', 'PY'].includes(c.unnecessary);
}

export function ConfoundersSection() {
  const { payload, updateData } = useStudy();
  const assistant = useAssistant();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const rows = payload.study.data.confounders;
  const results = payload.results;
  const proposals = assistant.pending((p) => p.kind === 'confounder');
  const set = (id: string, fn: (c: ConfounderRow) => void) =>
    updateData((d) => {
      const row = d.confounders.find((c) => c.id === id);
      if (row) fn(row);
    });
  const usedBy = (c: ConfounderRow) => results.filter((r) => r.importantFactors.some((f) => f.toLowerCase() === c.factor.toLowerCase()));
  const busy = !!assistant.activeFor('evaluate_confounders');

  return (
    <div>
      <div className="row mb">
        <h2 className="grow" style={{ margin: 0 }}>
          Evaluation of confounding factors
        </h2>
        <button className="ai sm" disabled={busy || rows.length === 0} onClick={() => void assistant.start('evaluate_confounders')}>
          ✦ {busy ? 'Evaluating…' : 'Evaluate with assistant'}
        </button>
      </div>
      <p className="muted small">
        Each important factor is evaluated once for the study. Domain 1 of each result uses only the factors marked important for that result. (i) factors come from the project matrix; add (ii)
        factors relevant to this study or identified by its authors.
      </p>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="t cf-table">
            <thead>
              <tr>
                <th>Factor</th>
                <th>Measured variable(s)</th>
                <th className="c">Controlled?</th>
                <th className="c" title="If controlled: measured validly and reliably?">Valid / reliable?</th>
                <th className="c" title="If not controlled: evidence that control was unnecessary?">Control unnecessary?</th>
                <th>Comments</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const prop = proposals.find((p) => p.target.factor?.toLowerCase() === c.factor.toLowerCase());
                const users = usedBy(c);
                return (
                  <Fragment key={c.id}>
                    <tr id={c.id} className={needsControl(c) ? 'needs' : ''}>
                      <td style={{ minWidth: 170 }}>
                        {c.factor}
                        <div className="tiny faint">
                          {c.list === 'prespecified' ? '(i) listed in advance' : '(ii) additional'} · {users.length ? users.map((u) => `R${u.ordinal}`).join(', ') : 'no result'}
                        </div>
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <TextInput value={c.variables} onChange={(v) => set(c.id, (r) => void (r.variables = v))} />
                      </td>
                      <td className="c">
                        <select value={c.controlled} onChange={(e) => set(c.id, (r) => void ((r.controlled = e.target.value as ConfounderRow['controlled']), e.target.value === 'Y' ? (r.unnecessary = 'NA') : (r.valid = 'NA')))}>
                          <option value="">—</option>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </td>
                      <td className="c">
                        <select value={c.valid} disabled={c.controlled !== 'Y'} onChange={(e) => set(c.id, (r) => void (r.valid = e.target.value as ConfounderRow['valid']))}>
                          {['', 'NA', 'Y', 'PY', 'PN', 'N', 'NI'].map((o) => (
                            <option key={o} value={o}>
                              {o || '—'}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="c">
                        <div className="row gap-sm" style={{ justifyContent: 'center' }}>
                          <select value={c.unnecessary} disabled={c.controlled !== 'N'} onChange={(e) => set(c.id, (r) => void (r.unnecessary = e.target.value as ConfounderRow['unnecessary']))}>
                            {['', 'NA', 'Y', 'PY', 'PN', 'N'].map((o) => (
                              <option key={o} value={o}>
                                {o || '—'}
                              </option>
                            ))}
                          </select>
                          {['Y', 'PY'].includes(c.unnecessary) && (
                            <select value={c.unnecessaryCondition} title="Condition (a)–(f)" onChange={(e) => set(c.id, (r) => void (r.unnecessaryCondition = e.target.value as ConfounderRow['unnecessaryCondition']))}>
                              <option value="">why?</option>
                              {CF_UNNECESSARY_CONDITIONS.map((x) => (
                                <option key={x.code} value={x.code} title={x.text}>
                                  ({x.code})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <TextInput value={c.comments} onChange={(v) => set(c.id, (r) => void (r.comments = v))} />
                      </td>
                      <td className="nowrap">
                        <button className="xs" onClick={() => setOpen(open === c.id ? null : c.id)}>
                          Evidence ({c.evidenceIds.length})
                        </button>
                        {prop && <span className="chip info" style={{ marginLeft: 4 }}>✦</span>}
                        {c.list === 'additional' && (
                          <button className="xs ghost" title="Remove" onClick={() => updateData((d) => void (d.confounders = d.confounders.filter((x) => x.id !== c.id)))}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                    {(open === c.id || prop) && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface-2)' }}>
                          {prop && <ConfounderProposal p={prop} row={c} onApply={(fn) => set(c.id, fn)} />}
                          {open === c.id && <LinkedEvidence target={{ kind: 'cf', rowId: c.id, label: c.factor }} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ padding: 10 }}>
          <input placeholder="Add an additional factor (ii)…" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adding.trim() && (updateData((d) => void d.confounders.push(newRow(adding.trim()))), setAdding(''))} />
          <button disabled={!adding.trim()} onClick={() => (updateData((d) => void d.confounders.push(newRow(adding.trim()))), setAdding(''))}>
            Add
          </button>
        </div>
      </div>
      <details className="mt">
        <summary>When control may be unnecessary — conditions (a)–(f)</summary>
        <div className="guidance">
          {CF_UNNECESSARY_CONDITIONS.map((c) => (
            <p key={c.code}>
              <strong>({c.code})</strong> {c.text}
            </p>
          ))}
        </div>
      </details>
      <h3 className="mt">Summary by result</h3>
      {results.map((r) => {
        const mine = rows.filter((c) => r.importantFactors.some((f) => f.toLowerCase() === c.factor.toLowerCase()) || c.list === 'additional');
        const missing = mine.filter(needsControl);
        const concerns = mine.filter((c) => c.controlled === 'Y' && ['PN', 'N', 'NI'].includes(c.valid));
        return (
          <div key={r.id} className="card flat small">
            <strong>
              Result {r.ordinal}: {r.outcome}
            </strong>{' '}
            — {mine.length} factors · controlled {mine.filter((c) => c.controlled === 'Y').length} · not controlled but necessary:{' '}
            <span style={{ color: missing.length ? 'var(--bad)' : undefined }}>{missing.length ? missing.map((c) => c.factor).join(', ') : 'none'}</span>
            {concerns.length > 0 && <> · measurement concerns: {concerns.map((c) => c.factor).join(', ')}</>}
          </div>
        );
      })}
    </div>
  );
}

function ConfounderProposal({ p, row, onApply }: { p: AiProposal; row: ConfounderRow; onApply: (fn: (c: ConfounderRow) => void) => void }) {
  const assistant = useAssistant();
  const c = p.content as {
    variables: string;
    controlled: 'Y' | 'N';
    method?: string;
    valid: ConfounderRow['valid'];
    unnecessary: ConfounderRow['unnecessary'];
    unnecessaryCondition: ConfounderRow['unnecessaryCondition'];
    comments?: string;
    items?: { quote: string; documentId: string | null; page: number | null; interpretation?: string; check?: SourceCheck }[];
  };
  return (
    <div className="ev proposal" style={{ marginTop: 0 }}>
      <div className="row wrap small">
        <span className="chip info">Suggested</span>
        <span>
          Variables: <strong>{c.variables || '—'}</strong>
        </span>
        <span>
          Controlled: <strong>{c.controlled}</strong>
          {c.method ? ` (${c.method})` : ''}
        </span>
        <span>
          Valid: <strong>{c.valid}</strong>
        </span>
        <span>
          Unnecessary: <strong>{c.unnecessary}</strong>
          {c.unnecessaryCondition ? ` (${c.unnecessaryCondition})` : ''}
        </span>
      </div>
      {c.comments && <div className="interp">{c.comments}</div>}
      {(c.items ?? []).map((it, i) => (
        <SupportingQuote key={i} item={it} runId={p.runId} target={{ kind: 'cf', rowId: row.id, label: row.factor }} questionIds={['CF']} />
      ))}
      <div className="meta">
        <span className="spacer" />
        <button className="xs ghost" onClick={() => void assistant.reject(p)}>
          Dismiss
        </button>
        <button
          className="xs primary"
          onClick={() => {
            onApply((r) => {
              r.variables = c.variables;
              r.controlled = c.controlled;
              r.valid = c.controlled === 'Y' ? c.valid : 'NA';
              r.unnecessary = c.controlled === 'N' ? c.unnecessary : 'NA';
              r.unnecessaryCondition = c.unnecessaryCondition ?? '';
              if (c.comments) r.comments = c.comments;
            });
            void assistant.accept(p);
          }}
        >
          Use these values
        </button>
      </div>
    </div>
  );
}
