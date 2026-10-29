import { COMPARATOR_TYPES, INFORMATION_SOURCE_OPTIONS, INTERVENTION_TYPES } from '@robercop/rules';
import type { ComparatorType, InterventionType } from '@robercop/shared';
import { useAssistant } from '../../assistant/AssistantContext';
import { Field, TextArea, TextInput } from '../../components/ui';
import { useStudy } from './context';
import { FieldProposals, LinkedEvidence } from './Linked';

export function DetailsSection() {
  const { payload, updateData, updateLabel } = useStudy();
  const assistant = useAssistant();
  const s = payload.study;
  return (
    <div>
      <div className="row mb">
        <h2 className="grow" style={{ margin: 0 }}>
          Study details
        </h2>
        <button className="ai sm" disabled={!!assistant.activeFor('extract_study')} onClick={() => void assistant.start('extract_study')}>
          ✦ {assistant.activeFor('extract_study') ? 'Extracting…' : 'Extract study details'}
        </button>
      </div>
      <p className="muted small">The assistant can draft the citation, target trial and candidate results with supporting quotations. Drafts appear next to each field for you to use, edit or dismiss.</p>
      <div className="card">
        <Field label="Study label" hint="Short identifier shown everywhere.">
          <TextInput value={s.label} onChange={updateLabel} />
        </Field>
        <Field label="Citation">
          <TextArea value={s.data.citation} rows={2} onChange={(v) => updateData((d) => void (d.citation = v))} />
        </Field>
        <FieldProposals field="citation" onUse={(draft) => updateData((d) => void (d.citation = draft))} />
        <Field label="Notes (optional)">
          <TextArea value={s.data.notes} rows={3} onChange={(v) => updateData((d) => void (d.notes = v))} />
        </Field>
      </div>
    </div>
  );
}

export function TargetTrialSection() {
  const { payload, updateData } = useStudy();
  const tt = payload.study.data.targetTrial;
  const set = (fn: (t: typeof tt) => void) => updateData((d) => fn(d.targetTrial));
  return (
    <div>
      <h2>C. Target trial</h2>
      <p className="muted small">
        The hypothetical pragmatic randomized trial the study emulates ("reverse engineering" the research question from the analysis). Ethics and feasibility need not be considered.
      </p>
      <div className="card" id="c1">
        <Field label="C1. Participants and eligibility criteria" hint="Determined by the eligibility criteria for the study and analysis being assessed.">
          <TextArea value={tt.c1} rows={3} onChange={(v) => set((t) => void (t.c1 = v))} />
        </Field>
        <FieldProposals field="c1" target={{ kind: 'tt', field: 'c1', label: 'C1' }} onUse={(draft) => set((t) => void (t.c1 = draft))} />
        <LinkedEvidence target={{ kind: 'tt', field: 'c1', label: 'C1' }} />
      </div>
      <div className="card" id="c2">
        <Field label="C2. Intervention strategy">
          <TextArea value={tt.c2} rows={2} onChange={(v) => set((t) => void (t.c2 = v))} />
        </Field>
        <div className="row small">
          Type:
          <select value={tt.c2Type} onChange={(e) => set((t) => void (t.c2Type = e.target.value as InterventionType))}>
            <option value="">—</option>
            {INTERVENTION_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <span className="muted">Point (e.g. surgery at one time) or sustained (over time).</span>
        </div>
        <FieldProposals
          field="c2"
          target={{ kind: 'tt', field: 'c2', label: 'C2' }}
          onUse={(draft, type) => set((t) => void ((t.c2 = draft), type && INTERVENTION_TYPES.includes(type as never) && (t.c2Type = type as InterventionType)))}
        />
        <LinkedEvidence target={{ kind: 'tt', field: 'c2', label: 'C2' }} />
      </div>
      <div className="card" id="c3">
        <Field label="C3. Comparator strategy">
          <TextArea value={tt.c3} rows={2} onChange={(v) => set((t) => void (t.c3 = v))} />
        </Field>
        <div className="row small">
          Type:
          <select value={tt.c3Type} onChange={(e) => set((t) => void (t.c3Type = e.target.value as ComparatorType))}>
            <option value="">—</option>
            {COMPARATOR_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <FieldProposals
          field="c3"
          target={{ kind: 'tt', field: 'c3', label: 'C3' }}
          onUse={(draft, type) => set((t) => void ((t.c3 = draft), type && COMPARATOR_TYPES.includes(type as never) && (t.c3Type = type as ComparatorType)))}
        />
        <LinkedEvidence target={{ kind: 'tt', field: 'c3', label: 'C3' }} />
      </div>
      <div className="card" id="c4">
        <div className="label">C4. Did the analysis account for switches during follow-up between the intervention strategies, or for other protocol deviations?</div>
        <label className="checkbox">
          <input type="radio" checked={tt.c4 === 'No'} onChange={() => set((t) => void (t.c4 = 'No'))} />
          <span>
            <strong>No</strong> — the analysis estimates the intention-to-treat effect (Domain 1 Variant A).
          </span>
        </label>
        <label className="checkbox">
          <input type="radio" checked={tt.c4 === 'Yes'} onChange={() => set((t) => void (t.c4 = 'Yes'))} />
          <span>
            <strong>Yes</strong> — per-protocol effect.
          </span>
        </label>
        {tt.c4 === 'Yes' && (
          <div className="banner warn mt-sm">
            Per-protocol assessments (Domain 1 Variant B) are not supported in this release. Results from this study will be marked unsupported rather than assessed as ITT.
          </div>
        )}
        <Field label="Note (optional)">
          <TextInput value={tt.c4Note} onChange={(v) => set((t) => void (t.c4Note = v))} />
        </Field>
        <FieldProposals field="c4" target={{ kind: 'tt', field: 'c4', label: 'C4' }} onUse={(draft, type) => set((t) => void ((t.c4Note = draft), (type === 'Yes' || type === 'No') && (t.c4 = type)))} />
        <LinkedEvidence target={{ kind: 'tt', field: 'c4', label: 'C4' }} />
      </div>
    </div>
  );
}

export function InfoSourcesSection() {
  const { payload, updateData } = useStudy();
  const src = payload.study.data.sources;
  return (
    <div>
      <h2>D. Information sources</h2>
      <p className="muted small">Which sources have you obtained to inform your risk-of-bias judgements? Evaluation should use the maximum available information.</p>
      <div className="card" id="sources">
        {INFORMATION_SOURCE_OPTIONS.map((o) => (
          <label key={o} className="checkbox">
            <input
              type="checkbox"
              checked={src.checked.includes(o)}
              onChange={(e) => updateData((d) => void (d.sources.checked = e.target.checked ? [...d.sources.checked, o] : d.sources.checked.filter((x) => x !== o)))}
            />
            <span>{o}</span>
          </label>
        ))}
        <Field label="Additional sources not listed above">
          <TextArea value={src.other} rows={2} onChange={(v) => updateData((d) => void (d.sources.other = v))} />
        </Field>
      </div>
    </div>
  );
}
