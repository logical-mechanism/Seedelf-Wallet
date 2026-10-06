// An ADA amount field: at most 6 decimal places, grouped with commas as it's
// typed (AmountField), with a note when something typed or pasted had to be
// dropped or refused, or isn't a number (which stays, marked invalid, and
// isn't an amount the form can review). With tokens,
// it may stay empty: the builder raises any amount to the least ADA the
// network accepts with them, and the review says so (MinimumNote).

import { useState, type ReactNode } from "react";
import { t, useT } from "../../i18n";

import { adaText, formatAda, parseAda, sanitizeAda } from "../format";
import { AmountField } from "./AmountField";

/**
 * The lovelace to ask for: what's typed, or "0" (only the minimum) when
 * it's empty and tokens go too. Undefined when there's nothing to send.
 */
export function lovelaceToSend(amount: string, withTokens: boolean): string | undefined {
  if (withTokens && amount.trim() === "") return "0";
  const lovelace = parseAda(amount);
  return lovelace === "0" && !withTokens ? undefined : lovelace;
}

export function AdaInput({
  id,
  value,
  onChange,
  disabled,
  shown,
  placeholder = "0",
  autoFocus = true,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown instead of the value while disabled: Max and what it takes at most, "Max, up to 10,405.01" (MP-1). */
  shown?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra controls after the unit, e.g. a Max button. */
  children?: ReactNode;
}) {
  const [note, setNote] = useState<string>();
  const showing = disabled && shown;
  // Text that isn't an amount stays as typed, and the form's Review waits for it (format.ts sanitizeAmount, PY-9).
  const invalid = !disabled && value.trim() !== "" && parseAda(value) === undefined;
  return (
    <>
      <div className="amount-box">
        <AmountField
          id={id}
          className={showing ? "amount-box__shown" : undefined}
          placeholder={placeholder}
          value={showing ? shown : value}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          clean={sanitizeAda}
          onChange={(cleaned, why) => {
            setNote(why);
            onChange(cleaned);
          }}
          autoFocus={autoFocus}
        />
        <span className="amount-box__unit">₳</span>
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

/** Under the amount, once tokens go too: it can stay empty. */
export function MinimumHint() {
  const t = useT();
  return (
    <p className="note" data-testid="minimum-hint">{t("adaInput.minimumHint")}</p>
  );
}

/**
 * A review's amount row's value: "0.97837 ₳, raised from 0.5 ₳" when the builder raised what was asked to the
 * least the network takes. The note under the review says why; the grey line alone was all that said it, under
 * the summary and, on Make private in the panel, under the sticky button (chunk 23's second review, PY-4).
 */
export function amountText(lovelace: string, minimum: string | null, asked: string): string {
  const raised = minimum !== null && lovelace === minimum && BigInt(asked) > 0n && BigInt(asked) < BigInt(minimum);
  return raised ? t("adaInput.raisedRow", { amount: formatAda(lovelace), asked: formatAda(asked) }) : adaText(lovelace);
}

/**
 * On a review, when the amount is the least the network accepts: asked for
 * (empty), or raised to it from `asked`.
 */
export function MinimumNote({
  lovelace,
  minimum,
  asked,
  tokens,
  who,
}: {
  lovelace: string;
  minimum: string | null;
  /** The lovelace the form asked for. */
  asked: string;
  tokens: number;
  /** Which recipient, when there are several. */
  who?: string;
}) {
  const t = useT();
  if (minimum === null || lovelace !== minimum) return null;
  const least = t(tokens ? "adaInput.leastWithTokens" : "adaInput.leastInPayment", { amount: formatAda(minimum) });
  const raised = BigInt(asked) > 0n && BigInt(asked) < BigInt(minimum);
  const note = raised ? t("adaInput.raisedFrom", { amount: formatAda(asked), least }) : least;
  return (
    <p className="note" data-testid="minimum-note">
      {who ? t("adaInput.forWho", { who, note }) : note}
    </p>
  );
}
