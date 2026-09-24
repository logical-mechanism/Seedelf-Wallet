import { useState } from "react";

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
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <div className="field-row">
        <span className="copy-field__label">{label}</span>
        <button
          type="button"
          className="link"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="copy-field__value" data-testid={testId} data-value={value} title={value}>
        {display ?? value}
      </code>
    </div>
  );
}
