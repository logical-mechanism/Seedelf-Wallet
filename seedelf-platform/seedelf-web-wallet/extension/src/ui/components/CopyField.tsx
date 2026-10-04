import { CopyButton } from "./CopyButton";

/**
 * A labelled value with a copy button. `display` can shorten what's shown.
 * `copyLabel` names the button, a sentence of its own ("Copy the policy id"):
 * built from `label`, lowercased, it read "Copy the seedelf name", and in
 * Spanish "Copiar nombre del seedelf".
 */
export function CopyField({
  label,
  copyLabel,
  value,
  display,
  testId,
}: {
  label: string;
  copyLabel: string;
  value: string;
  display?: string;
  testId: string;
}) {
  return (
    <div className="copy-field">
      <div className="field-row">
        <span className="label">{label}</span>
        <CopyButton value={value} label={copyLabel} />
      </div>
      <code className="copy-field__value" data-testid={testId} data-value={value} title={value}>
        {display ?? value}
      </code>
    </div>
  );
}
