// An ADA amount field: at most 6 decimal places, digits only, with a note
// when something typed or pasted had to be dropped or refused.

import { useState, type ReactNode } from "react";

import { sanitizeAda } from "../format";

export function AdaInput({
  id,
  value,
  onChange,
  disabled,
  shown,
  autoFocus = true,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown instead of the value while disabled, e.g. "Max". */
  shown?: string;
  autoFocus?: boolean;
  /** Extra controls after the unit, e.g. a Max button. */
  children?: ReactNode;
}) {
  const [note, setNote] = useState<string>();
  return (
    <>
      <div className="amount-row">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={disabled && shown ? shown : value}
          disabled={disabled}
          aria-describedby={note ? `${id}-note` : undefined}
          onChange={(e) => {
            const cleaned = sanitizeAda(value, e.target.value);
            setNote(cleaned.note);
            onChange(cleaned.value);
          }}
          autoFocus={autoFocus}
        />
        <span className="amount-row__unit">₳</span>
        {children}
      </div>
      {note && !disabled && (
        <p className="field-note" id={`${id}-note`} data-testid={`${id}-note`}>
          {note}
        </p>
      )}
    </>
  );
}
