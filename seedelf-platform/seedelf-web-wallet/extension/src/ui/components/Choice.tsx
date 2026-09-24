// A choice between a few options, as a segmented switch of pressed buttons:
// who pays for a seedelf, where a removed seedelf's ADA goes.

export function Choice<T extends string>({
  label,
  id,
  options,
  value,
  onChange,
}: {
  label: string;
  id: string;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? "segmented__item segmented__item--on" : "segmented__item"}
            aria-pressed={o.value === value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
