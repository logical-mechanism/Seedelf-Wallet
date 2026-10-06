// Several recipients in one payment, after Eternl's multi-send: each is a card
// with its own To, amount and tokens; Add recipient adds another, up to
// MAX_RECIPIENTS, and × takes one off. With a single recipient the form looks
// as it always did, with no card. A recipient's token boxes offer only what
// the others haven't taken. Max pays a single recipient: adding a second
// turns it off.

import { useRef, useState, type ReactNode } from "react";
import { useT, type I18nKey } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { Paid, TokenAmount } from "../../shared/rpc";
import { MAX_RECIPIENTS } from "../../shared/recipients";
import { adaWithTokens, formatAda, parseAda, tokenKey as key } from "../format";
import { useAmounts } from "../preferences";
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

/**
 * The recipients on a form, and ways to change them; `to` and `amount` fill
 * the first, as a payment handed on from another form, and `tokens` picks
 * tokens for it, as a token's details do.
 */
export function useRecipients(to = "", tokens: Record<string, string> = {}, amount = "") {
  const [drafts, setDrafts] = useState<Draft[]>([{ ...blank(0), to, amount, tokens }]);
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
export function heldFor(network: NetworkName, held: TokenAmount[], drafts: Draft[], draft: Draft): TokenAmount[] {
  const taken = new Map<string, bigint>();
  for (const other of drafts) {
    if (other.id === draft.id) continue;
    for (const t of tokenChoices(network, held, other.tokens).sent) taken.set(key(t), (taken.get(key(t)) ?? 0n) + BigInt(t.quantity));
  }
  return held
    .map((t) => {
      const left = BigInt(t.quantity) - (taken.get(key(t)) ?? 0n);
      return { ...t, quantity: (left > 0n ? left : 0n).toString() };
    })
    .filter((t) => BigInt(t.quantity) > 0n || key(t) in draft.tokens);
}

/** Each recipient's lovelace and tokens as the worker takes them; `ok` once every one can be sent. */
export function recipientAmounts(network: NetworkName, held: TokenAmount[], drafts: Draft[], max: boolean) {
  const each = drafts.map((d) => {
    const tokens = tokenChoices(network, heldFor(network, held, drafts, d), d.tokens);
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
  const t = useT();
  if (count === 1) return <>{children}</>;
  const title = t("recipients.numbered", { number: index + 1 });
  const headId = `recipient-${index + 1}-title`;
  return (
    <section className="recipient" role="group" aria-labelledby={headId}>
      <div className="recipient__head">
        <h3 id={headId}>{title}</h3>
        <button
          type="button"
          className="icon-button icon-button--small"
          aria-label={t("recipients.takeOffNumbered", { number: index + 1 })}
          title={t("recipients.takeOff")}
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
  const t = useT();
  if (count >= MAX_RECIPIENTS) {
    return <p className="note center">{t("recipients.atMost", { number: MAX_RECIPIENTS })}</p>;
  }
  return (
    <button type="button" className="add-more add-recipient" onClick={onAdd}>
      <PlusIcon size={14} />
      {t("recipients.add")}
    </button>
  );
}

/** Under the recipients: when together they ask for more than there is. What's there is hidden with the balances. */
export function TooMuchTogether({ total, available, testId, where }: { total: bigint; available: string; testId: string; where: string }) {
  const t = useT();
  const amounts = useAmounts();
  if (total <= BigInt(available)) return null;
  return (
    <p className="field-note" data-testid={testId}>
      {t("recipients.tooMuch", { total: formatAda(total.toString()), available: amounts.ada(available), where })}
    </p>
  );
}

/** Where a recipient's To field is: nothing typed, being read, read and payable, or refused (its note says why). */
export type ToState = "empty" | "reading" | "ok" | "bad";

/**
 * What one payment still needs before Review, the first thing in the form's own order: where it goes, its
 * amount, then its tokens. Undefined while nothing's missing, or while a To is being read, which its own note
 * says (chunk 23's second review, PY-9: Review greyed out at a blank or 0 amount with nothing to say why).
 * `emptyTo` is how the form asks for a recipient.
 */
export function waitingFor({
  to,
  amount,
  tokensPicked,
  tokensOk,
  max = false,
  emptyTo = "review.why.to",
}: {
  to?: ToState;
  amount: string;
  /** Any token box added, filled or not: with one, the ADA may stay empty, and the box is what's missing. */
  tokensPicked: boolean;
  tokensOk: boolean;
  max?: boolean;
  emptyTo?: I18nKey;
}): I18nKey | undefined {
  if (to === "empty") return emptyTo;
  if (to === "bad") return "review.why.toCheck";
  if (!max && amount.trim() !== "" && parseAda(amount) === undefined) return "review.why.amountNumber";
  if (!max && lovelaceToSend(amount, tokensPicked) === undefined) return "review.why.amount";
  if (!tokensOk) return "review.why.tokens";
  return undefined;
}

/**
 * Why Review can't be pressed, under it: the first recipient's reason that has one, named by its number when
 * there are several, else `tooMuch` (the payment as a whole asks for more than there is). Said where a touch
 * screen shows it, as Remove's "choose where" is (chunk 23's review, H-1).
 */
export function ReviewWait({ reasons, tooMuch, busy }: { reasons: Array<I18nKey | undefined>; tooMuch?: boolean; busy: boolean }) {
  const t = useT();
  if (busy) return null;
  const at = reasons.findIndex((r) => r !== undefined);
  const why = at >= 0 ? t(reasons[at]!) : tooMuch ? t("review.why.tooMuch") : undefined;
  if (!why) return null;
  return (
    <p className="note foot-note" data-testid="review-wait">
      {at >= 0 && reasons.length > 1 ? t("adaInput.forWho", { who: t("recipients.nth", { number: at + 1 }), note: why }) : why}
    </p>
  );
}

/**
 * A review's recipients: with one, its rows open the review; with several,
 * what they get in all, the fee, "Total leaving …" and "… after" come first,
 * then each recipient's own box under "Recipient N". Under the boxes, the
 * totals sat below the Send kept in view at 640 px and taller, so the review
 * could be sent with them unseen (blind test §9.10's last case); a site's
 * signing window puts its total first, and was read right every time (T18).
 * What they get in all isn't in bold, nor called Total: the bold total is what
 * leaves the balance, fee included (components/ReviewTotals.tsx).
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
  /** The fee and what leaves the balance in all: after one recipient's rows, before several recipients' boxes. */
  children: ReactNode;
}) {
  const t = useT();
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
      <ReviewRows testId={testId}>
        <Row label={t("recipients.total")} value={adaWithTokens(lovelace, kinds)} />
        {children}
      </ReviewRows>
      {payments.map((_, i) => (
        <section key={i} className="review-recipient" aria-labelledby={`${testId}-${i + 1}-title`}>
          <h3 id={`${testId}-${i + 1}-title`} className="review__caption">
            {t("recipients.nth", { number: i + 1 })}
          </h3>
          <ReviewRows testId={`${testId}-${i + 1}`}>{rows(i)}</ReviewRows>
        </section>
      ))}
    </>
  );
}
