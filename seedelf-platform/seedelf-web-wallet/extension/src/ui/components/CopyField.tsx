import { CopyButton } from "./CopyButton";
import { useT } from "../../i18n";

/** A labelled value with a copy button. `display` can shorten what's shown. */
export function CopyField({
  label,
  value,
  display,
  testId,
}: {
  label: string;
  value: string;
  display?: string;
  testId: string;
}) {
  const t = useT();
  return (
    <div className="copy-field">
      <div className="field-row">
        <span className="label">{label}</span>
        <CopyButton value={value} label={t("common.copyThe", { what: label.toLowerCase() })} />
      </div>
      <code className="copy-field__value" data-testid={testId} data-value={value} title={value}>
        {display ?? value}
      </code>
    </div>
  );
}
