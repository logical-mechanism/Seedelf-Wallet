// Several recipients in one payment, after Eternl's multi-send: each is a card
// with its own To, amount and tokens; Add recipient adds another, up to
// MAX_RECIPIENTS, and × takes one off. With a single recipient the form looks
// as it always did, with no card. A recipient's token boxes offer only what
// the others haven't taken. Max pays a single recipient: adding a second
// turns it off.

import { useRef, useState, type ReactNode } from "react";

import type { Paid, TokenAmount } from "../../shared/rpc";
import { MAX_RECIPIENTS } from "../../shared/recipients";
import { adaWithTokens, formatAda, tokenKey as key } from "../format";
import { lovelaceToSend } from "./AdaInput";
import { CloseIcon, PlusIcon } from "./Icons";
import { ReviewRows, Row } from "./ReviewRows";
import { tokenChoices } from "./TokenAmounts";

/** One recipient as typed. `id` stays with it as others come and go. */
export interface Draft {
  id: number;
  to: string;
  amount: string;
  tokens: Record<string, string>;
}

const blank = (id: number): Draft => ({ id, to: "", amount: "", tokens: {} });

/** The recipients on a form, and ways to change them. */
export function useRecipients() {
  const [drafts, setDrafts] = useState<Draft[]>([blank(0)]);
  const next = useRef(1);
  return {
    drafts,
    several: drafts.length > 1,
    update: (id: number, change: Partial<Omit<Draft, "id">>) =>
      setDrafts((all) => all.map((d) => (d.id === id ? { ...d, ...change } : d))),
    add: () => setDrafts((all) => (all.length < MAX_RECIPIENTS ? [...all, blank(next.current++)] : all)),
    remove: (id: number) => setDrafts((all) => (all.length > 1 ? all.filter((d) => d.id !== id) : all)),
  };
}

/** A form field's id: the first recipient keeps the plain one. */
export const fieldId = (base: string, draft: Draft, index: number) => (index === 0 ? base : `${base}-${draft.id}`);

/** What `draft`'s token boxes can offer: what's held, less what the other recipients take. */
export function heldFor(held: TokenAmount[], drafts: Draft[], draft: Draft): TokenAmount[] {
  const taken = new Map<string, bigint>();
  for (const other of drafts) {
    if (other.id === draft.id) continue;
    for (const t of tokenChoices(held, other.tokens).sent) taken.set(key(t), (taken.get(key(t)) ?? 0n) + BigInt(t.quantity));
  }
  return held
    .map((t) => {
      const left = BigInt(t.quantity) - (taken.get(key(t)) ?? 0n);
      return { ...t, quantity: (left > 0n ? left : 0n).toString() };
    })
    .filter((t) => BigInt(t.quantity) > 0n || key(t) in draft.tokens);
}

/** Each recipient's lovelace and tokens as the worker takes them; `ok` once every one can be sent. */
export function recipientAmounts(held: TokenAmount[], drafts: Draft[], max: boolean) {
  const each = drafts.map((d) => {
    const tokens = tokenChoices(heldFor(held, drafts, d), d.tokens);
    const lovelace = max ? null : lovelaceToSend(d.amount, tokens.sent.length > 0);
    return { draft: d, tokens, lovelace, ok: tokens.ok && (max || typeof lovelace === "string") };
  });
  const total = each.reduce((sum, e) => sum + (typeof e.lovelace === "string" ? BigInt(e.lovelace) : 0n), 0n);
  return { each, total, ok: each.every((e) => e.ok) };
}

/** One recipient's card, once there are several; a single recipient needs none. */
export function RecipientCard({
  index,
  count,
  onRemove,
  children,
}: {
  index: number;
  count: number;
  onRemove: () => void;
  children: ReactNode;
}) {
  if (count === 1) return <>{children}</>;
  const title = `Recipient ${index + 1}`;
  const headId = `recipient-${index + 1}-title`;
  return (
    <section className="recipient" role="group" aria-labelledby={headId}>
      <div className="recipient__head">
        <h3 id={headId}>{title}</h3>
        <button
          type="button"
          className="icon-button icon-button--small"
          aria-label={`Take ${title.toLowerCase()} off`}
          title="Take it off"
          onClick={onRemove}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      {children}
    </section>
  );
}

/** Add recipient, or the limit once it's reached. */
export function AddRecipient({ count, onAdd }: { count: number; onAdd: () => void }) {
  if (count >= MAX_RECIPIENTS) {
    return <p className="note center">A payment pays at most {MAX_RECIPIENTS} recipients.</p>;
  }
  return (
    <button type="button" className="secondary add-recipient" onClick={onAdd}>
      <PlusIcon size={16} />
      Add recipient
    </button>
  );
}

/** Under the recipients: when together they ask for more than there is. */
export function TooMuchTogether({ total, available, testId, where }: { total: bigint; available: string; testId: string; where: string }) {
  if (total <= BigInt(available)) return null;
  return (
    <p className="field-note" data-testid={testId}>
      Together that's {formatAda(total.toString())} ₳, more than the {formatAda(available)} ₳ {where}.
    </p>
  );
}

/**
 * A review's recipients: with one, its rows open the review; with several,
 * each gets its own box under "Recipient N", and a Total leads the rest.
 */
export function ReviewRecipients({
  testId,
  payments,
  rows,
  children,
}: {
  testId: string;
  payments: Paid[];
  /** One recipient's rows. */
  rows: (index: number) => ReactNode;
  /** The rows after them: fee, change, UTxOs spent. */
  children: ReactNode;
}) {
  if (payments.length === 1) {
    return (
      <ReviewRows testId={testId}>
        {rows(0)}
        {children}
      </ReviewRows>
    );
  }
  const lovelace = payments.reduce((sum, p) => sum + BigInt(p.lovelace), 0n).toString();
  const kinds = new Set(payments.flatMap((p) => p.tokens.map(key))).size;
  return (
    <>
      {payments.map((_, i) => (
        <section key={i} className="review-recipient" aria-labelledby={`${testId}-${i + 1}-title`}>
          <h3 id={`${testId}-${i + 1}-title`} className="review__caption">
            Recipient {i + 1}
          </h3>
          <ReviewRows testId={`${testId}-${i + 1}`}>{rows(i)}</ReviewRows>
        </section>
      ))}
      <ReviewRows testId={testId}>
        <Row label="Total" value={adaWithTokens(lovelace, kinds)} strong />
        {children}
      </ReviewRows>
    </>
  );
}
