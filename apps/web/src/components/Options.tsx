import type { AnswerOption } from '@robercop/rules';

/** Answer buttons for a signalling question. Number keys 1–n select when `keys` is set. */
export function OptionButtons({
  options,
  value,
  onChange,
  disabled,
  keys,
  suggested
}: {
  options: AnswerOption[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  keys?: boolean;
  suggested?: string | null;
}) {
  return (
    <div className="options" role="radiogroup">
      {options.map((o, i) => (
        <button
          key={o.code}
          type="button"
          role="radio"
          aria-checked={value === o.code}
          className={`opt ${value === o.code ? 'selected' : ''} ${suggested === o.code ? 'suggested' : ''}`}
          disabled={disabled}
          onClick={() => onChange(value === o.code ? '' : o.code)}
          title={o.label}
        >
          <span className="code">
            {o.code}
            {keys && <span className="key"> {i + 1}</span>}
          </span>
          <span className="lbl">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
