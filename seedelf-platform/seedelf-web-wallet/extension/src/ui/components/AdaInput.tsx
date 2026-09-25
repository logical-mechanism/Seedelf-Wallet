// An ADA amount field: at most 6 decimal places, digits only, grouped with
// commas as it's typed (AmountField), with a note when something typed or
// pasted had to be dropped or refused. With tokens,
// it may stay empty: the builder raises any amount to the least ADA the
// network accepts with them, and the review says so (MinimumNote).

import { useState, type ReactNode } from "react";

import { formatAda, parseAda, sanitizeAda } from "../format";
import { AmountField } from "./AmountField";
import { Callout } from "./Callout";

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
  /** Shown instead of the value while disabled, e.g. "Max". */
  shown?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra controls after the unit, e.g. a Max button. */
  children?: ReactNode;
}) {
  const [note, setNote] = useState<string>();
  return (
    <>
      <div className="amount-box">
        <AmountField
          id={id}
          placeholder={placeholder}
          value={disabled && shown ? shown : value}
          disabled={disabled}
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
  return (
    <p className="note" data-testid="minimum-hint">
      Leave it empty and the tokens go with only the ADA they need. The review shows how much.
    </p>
  );
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
  if (minimum === null || lovelace !== minimum) return null;
  const least = `${formatAda(minimum)} ₳ is the least ADA the network accepts ${tokens ? "with these tokens" : "in a payment"}.`;
  const raised = BigInt(asked) > 0n && BigInt(asked) < BigInt(minimum);
  const note = raised ? `Raised from ${formatAda(asked)} ₳: ${least}` : least;
  return (
    <p className="note" data-testid="minimum-note">
      {who ? `${who}: ${note}` : note}
    </p>
  );
}

/** The nudge towards round amounts: a quiet note, or a warning once the amount isn't round. */
export function RoundNote({ warn, children }: { warn: boolean; children: ReactNode }) {
  return warn ? (
    <Callout tone="warn" testId="round-warning">
      {children}
    </Callout>
  ) : (
    <p className="note">{children}</p>
  );
}
