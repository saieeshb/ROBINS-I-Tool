import { useState } from 'react';
import { evaluateTriage, getQuestion, type AnswerMap } from '@robercop/rules';
import type { AiProposal, ResultSpec, SourceCheck } from '@robercop/shared';
import { del, errorMessage, post } from '../../api';
import { useAssistant } from '../../assistant/AssistantContext';
import { OptionButtons } from '../../components/Options';
import { Field, TextArea, TextInput } from '../../components/ui';
import { useSession } from '../../session';
import { useStudy } from './context';
import { LinkedEvidence, SupportingQuote } from './Linked';

export function ResultsSection() {
  const { payload, reload } = useStudy();
  const { toast } = useSession();
  const assistant = useAssistant();
  const [outcome, setOutcome] = useState('');
  const candidates = assistant.pending((p) => p.kind === 'study_field' && p.target.field === 'result');

  const add = async (body: Partial<ResultSpec>) => {
    try {
      await post(`/studies/${payload.study.id}/results`, body);
      await reload();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };
  return (
    <div>
      <div className="row mb">
        <h2 className="grow" style={{ margin: 0 }}>
          A. Results &amp; B. triage
        </h2>
      </div>
      <p className="muted small">
        A ROBINS-I assessment is specific to one numerical result. Different outcomes, time points, comparisons or analyses (e.g. unadjusted vs adjusted) of the same outcome are separate
        results, each with its own triage and Domain sessions.
      </p>
      {candidates.length > 0 && (
        <div className="card">
          <h3>Results suggested by the assistant</h3>
          {candidates.map((p) => (
            <Candidate key={p.id} p={p} onAdd={async (c) => (await add(c), void assistant.accept(p))} onDismiss={() => void assistant.reject(p)} />
          ))}
        </div>
      )}
      {payload.results.map((r) => (
        <ResultCard key={r.id} r={r} />
      ))}
      <div className="card flat mt" id="results">
        <div className="row">
          <input placeholder="Outcome name, e.g. Anastomotic leak" value={outcome} onChange={(e) => setOutcome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && outcome.trim() && (void add({ outcome }), setOutcome(''))} />
          <button className="primary" disabled={!outcome.trim()} onClick={() => (void add({ outcome }), setOutcome(''))}>
            + Add result
          </button>
        </div>
        <div className="hint mt-sm">The outcome is matched against the project confounder matrix to pre-fill its important confounding factors.</div>
      </div>
    </div>
  );
}

function Candidate({ p, onAdd, onDismiss }: { p: AiProposal; onAdd: (c: Partial<ResultSpec>) => void; onDismiss: () => void }) {
  const c = p.content as Record<string, string> & { items?: { quote: string; documentId: string | null; page: number | null; check?: SourceCheck }[] };
  return (
    <div className="ev proposal">
      <div className="row top">
        <div className="grow">
          <strong>{c.outcome}</strong> {c.timePoint && <span className="muted">· {c.timePoint}</span>} {c.analysis && <span className="muted">· {c.analysis}</span>}
          <div className="small">A1: {c.numericalResult}</div>
          <div className="small muted">
            {c.location} {c.comparison && `· ${c.comparison}`}
          </div>
          {c.outcomeDefinition && <div className="small muted">A3: {c.outcomeDefinition}</div>}
        </div>
        <button className="xs ghost" onClick={onDismiss}>
          Dismiss
        </button>
        <button
          className="xs primary"
          onClick={() =>
            onAdd({ outcome: c.outcome, timePoint: c.timePoint, comparison: c.comparison, analysis: c.analysis, numericalResult: c.numericalResult, location: c.location, outcomeDefinition: c.outcomeDefinition })
          }
        >
          Add as result
        </button>
      </div>
      {(c.items ?? []).slice(0, 2).map((it, i) => (
        <SupportingQuote key={i} item={it} runId={p.runId} questionIds={['A1']} />
      ))}
    </div>
  );
}

function ResultCard({ r }: { r: ResultSpec }) {
  const { payload, updateResult, reload } = useStudy();
  const { toast } = useSession();
  const matrix = payload.project.cfMatrix;
  const triage = evaluateTriage(r.triage.answers as AnswerMap);
  const [newFactor, setNewFactor] = useState('');
  const allFactors = [...new Set([...(matrix[r.outcomeDomain] ?? []), ...r.importantFactors])];
  const hasAssessments = payload.assessments.some((a) => a.resultId === r.id);
  const setTriage = (q: 'B1' | 'B2' | 'B3', v: string) => updateResult(r.id, { triage: { ...r.triage, answers: { ...r.triage.answers, [q]: v } } });
  const setNote = (q: 'B1' | 'B2' | 'B3', v: string) => updateResult(r.id, { triage: { ...r.triage, notes: { ...r.triage.notes, [q]: v } } });
  return (
    <div className={`card result-card ${triage.status === 'critical' ? 'critical' : triage.status === 'passed' ? 'passed' : ''}`} id={r.id}>
      <div className="card-head">
        <h3 className="grow">
          Result {r.ordinal}: {r.outcome || 'Unnamed outcome'}
          {r.timePoint && <span className="muted"> · {r.timePoint}</span>}
          {r.analysis && <span className="muted"> · {r.analysis}</span>}
        </h3>
        <span className={`chip ${triage.status === 'critical' ? 'bad' : triage.status === 'passed' ? 'ok' : 'warn'}`}>
          Triage: {triage.status === 'critical' ? 'Critical' : triage.status}
        </span>
        <button
          className="xs"
          title="Another analysis, time point or comparison of the same outcome"
          onClick={async () => {
            await post(`/results/${r.id}/duplicate`, {});
            void reload();
          }}
        >
          Duplicate as another analysis
        </button>
        <button
          className="xs danger"
          disabled={hasAssessments}
          title={hasAssessments ? 'Has assessments' : 'Remove result'}
          onClick={async () => {
            if (!confirm('Remove this result?')) return;
            try {
              await del(`/results/${r.id}`);
              void reload();
            } catch (e) {
              toast(errorMessage(e), true);
            }
          }}
        >
          Remove
        </button>
      </div>

      <div className="grid cols-3">
        <Field label="Outcome">
          <TextInput value={r.outcome} onChange={(v) => updateResult(r.id, { outcome: v })} />
        </Field>
        <Field label="Time point">
          <TextInput value={r.timePoint} placeholder="e.g. 30 days" onChange={(v) => updateResult(r.id, { timePoint: v })} />
        </Field>
        <Field label="Effect of interest">
          <select value={r.effect} onChange={(e) => updateResult(r.id, { effect: e.target.value as ResultSpec['effect'] })}>
            <option value="ITT">Intention-to-treat (supported)</option>
            <option value="per-protocol">Per-protocol (not supported)</option>
          </select>
        </Field>
        <Field label="Comparison" hint="Intervention vs comparator, in the order of the numbers.">
          <TextInput value={r.comparison} placeholder="e.g. RAMIE vs MIE" onChange={(v) => updateResult(r.id, { comparison: v })} />
        </Field>
        <Field label="Analysis" hint="e.g. unadjusted, multivariable, propensity-matched.">
          <TextInput value={r.analysis} onChange={(v) => updateResult(r.id, { analysis: v })} />
        </Field>
        <Field label="Outcome domain (confounder matrix)">
          <select
            value={r.outcomeDomain}
            onChange={(e) => updateResult(r.id, { outcomeDomain: e.target.value, importantFactors: [...(matrix[e.target.value] ?? [])] })}
            style={{ width: '100%' }}
          >
            <option value="">— not matched —</option>
            {Object.keys(matrix).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
      </div>
      {r.effect === 'per-protocol' && <div className="banner warn">Per-protocol results are recorded as unsupported in this release and cannot start a Domain session.</div>}

      <Field label="A1. Numerical result being assessed" hint='Exact estimate with intervention/comparator order, e.g. "RAMIE 12 (50%) vs MIE 6 (25%), p = 0.004".'>
        <TextArea value={r.numericalResult} rows={2} onChange={(v) => updateResult(r.id, { numericalResult: v })} />
      </Field>
      <div className="grid cols-2">
        <Field label="A2. Further details (location, reason chosen)">
          <TextArea value={r.location} rows={2} onChange={(v) => updateResult(r.id, { location: v })} />
        </Field>
        <Field label="A3. Outcome to which the result relates" hint="Definition and how it was measured.">
          <TextArea value={r.outcomeDefinition} rows={2} onChange={(v) => updateResult(r.id, { outcomeDefinition: v })} />
        </Field>
      </div>
      <LinkedEvidence target={{ kind: 'result', resultId: r.id, label: `Result ${r.ordinal}` }} />

      <h4 className="mt">Important confounding factors for this result</h4>
      <div className="row wrap gap-sm">
        {allFactors.map((f) => {
          const on = r.importantFactors.includes(f);
          return (
            <button key={f} className={`xs ${on ? 'primary' : ''}`} onClick={() => updateResult(r.id, { importantFactors: on ? r.importantFactors.filter((x) => x !== f) : [...r.importantFactors, f] })}>
              {on ? '✓ ' : ''}
              {f}
            </button>
          );
        })}
        <input
          style={{ width: 200 }}
          placeholder="+ add factor"
          value={newFactor}
          onChange={(e) => setNewFactor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFactor.trim()) {
              updateResult(r.id, { importantFactors: [...r.importantFactors, newFactor.trim()] });
              setNewFactor('');
            }
          }}
        />
      </div>

      <h4 className="mt">B. Triage</h4>
      {(['B1', 'B2', 'B3'] as const).map((qid) => {
        const q = getQuestion(qid)!;
        const st = triage.questions.find((x) => x.id === qid)!;
        if (!st.reached && !st.answered) return null;
        return (
          <div key={qid} className={`qcard ${st.reached ? '' : 'unreached'}`} style={{ padding: '8px 12px' }}>
            <div className="row top">
              <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                {qid}
              </span>
              <div className="grow">
                <div>{q.text}</div>
                {q.conditionText && <div className="cond">{q.conditionText}</div>}
                {!st.reached && <div className="cond">Not reached after an upstream change; kept but not used.</div>}
              </div>
            </div>
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
              </div>
            </details>
            <OptionButtons options={q.options} value={r.triage.answers[qid] ?? ''} onChange={(v) => setTriage(qid, v)} />
            <TextArea value={r.triage.notes[qid] ?? ''} rows={1} placeholder="Notes / rationale" onChange={(v) => setNote(qid, v)} />
            <LinkedEvidence target={{ kind: 'triage', resultId: r.id, q: qid, label: `${qid} (result ${r.ordinal})` }} />
          </div>
        );
      })}
      {triage.status === 'critical' && <div className="banner bad">{triage.reason} This result is at Critical risk of bias; no domain assessment is needed (the Domain session only confirms the Critical judgement).</div>}
    </div>
  );
}
