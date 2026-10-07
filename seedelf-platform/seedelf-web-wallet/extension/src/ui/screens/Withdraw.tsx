// Withdraw: pay normal addresses, or ADA Handles, from the Seedelf balance,
// up to 20 at once: each an amount with optional tokens (with tokens, the
// amount may stay empty: only the ADA they need goes); or everything (Max)
// to a single one. Each destination is read as it's typed, and flagged when
// it's this wallet's own Cardano account. The worker builds the withdrawal,
// with Ogmios measuring its spends, and nothing is sent until the user has
// reviewed it and pressed Send.

import { useEffect, useState, type FormEvent } from "react";
import { joinSentences, useT } from "../../i18n";

import type { Balances, PendingTx, WithdrawSummary } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call, isStale } from "../background";
import { ownAccountNumber } from "../components/AccountRecipients";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, amountText, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { GivemeNote } from "../components/GivemeNote";
import { HistoriesNote } from "../components/HistoriesNote";
import { LeftOutNote } from "../components/LeftOut";
import { DestinationInput, type DestinationRead, type KnownRead } from "../components/Destination";
import {
  AddRecipient,
  fieldId,
  heldFor,
  RecipientCard,
  type Draft,
  recipientAmounts,
  ReviewRecipients,
  ReviewWait,
  TooMuchTogether,
  type ToState,
  useRecipients,
  waitingFor,
} from "../components/Recipients";
import { Row } from "../components/ReviewRows";
import { againOrForm, RenewedNote, StaleFoot, useStale } from "../components/StaleReview";
import { TotalRows } from "../components/ReviewTotals";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { TokenAmounts } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaText, lockedAside, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { tokenQuantity } from "../tokens";

/** The most UTxOs Max takes in one transaction (the WebAssembly's `MAX_WITHDRAW_UTXOS`). */
const MAX_UTXOS = 20;

export function Withdraw({
  seedelf,
  total,
  to,
  amount,
  picked,
  onCancel,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  /** An address handed on from Send, which pays only Seedelfs (chunk 23's review, P-1), with the amount typed (blind test §9.7). */
  to?: string;
  amount?: string;
  /** Tokens picked already, from a token's details: each asks for its amount. */
  picked?: Record<string, string>;
  /** The whole private balance, as Home shows it (locked UTxOs in): the review's balance after. */
  total?: string;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  const network = useNetwork();
  const list = useRecipients(to, picked, amount);
  const [reads, setReads] = useState<Record<number, KnownRead>>({});
  const [max, setMax] = useState(false);
  const [summary, setSummary] = useState<WithdrawSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The worker's words for a review that can't go as it is: Send gives way to building it again.
  const stale = useStale();
  // A refusal is about what was asked: once the form changes, it's gone, not left to read as the new answer (T05).
  useEffect(() => setError(undefined), [list.drafts, max]);

  // Max pays a single address.
  const maxed = max && !list.several;
  // Max takes every token, and hides the token boxes: a box left empty there mustn't hold Review back unseen.
  const amounts = recipientAmounts(network, seedelf.tokens, maxed ? list.drafts.map((d) => ({ ...d, tokens: {} })) : list.drafts, maxed);
  // A field's read counts only for the text it read.
  const readOf = (d: Draft): DestinationRead =>
    reads[d.id]?.to === d.to.trim() ? reads[d.id]!.read : { state: "idle" };
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = !maxed && amounts.total > BigInt(seedelf.lovelace);
  const ready = list.drafts.every((d) => readOf(d).state === "read") && amounts.ok && !tooMuch;
  const available = t(seedelf.locked.utxos ? "withdraw.available" : "withdraw.inPrivate");
  // The form's balance lines, hidden with the balances; the review shows what's sent in full (HM-9).
  const shown = useAmounts();
  const toState = (d: Draft): ToState => {
    const state = readOf(d).state;
    if (d.to.trim() === "") return "empty";
    return state === "error" ? "bad" : state === "read" ? "ok" : "reading";
  };
  const waiting = amounts.each.map((e) =>
    waitingFor({
      to: toState(e.draft),
      amount: e.draft.amount,
      tokensPicked: Object.keys(e.draft.tokens).length > 0,
      tokensOk: e.tokens.ok,
      max: maxed,
    }),
  );

  function review(e: FormEvent) {
    e.preventDefault();
    void build();
  }

  async function build() {
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    // The refusal stays, and its foot says it's building, until the new review is in (PY-1).
    try {
      const payments = amounts.each.map(({ draft, lovelace, tokens }) => ({
        to: draft.to.trim(),
        lovelace: lovelace ?? null,
        tokens: maxed ? [] : tokens.sent,
      }));
      setSummary(await call("withdraw-build", { payments }));
      stale.built();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!summary || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSent(await call("withdraw-submit", { txHash: summary.txHash }));
    } catch (err) {
      if (isStale(err)) stale.refused(err);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  /** Back from the review: its error is the review's, so the form it goes back to starts clean, as a swap's does. */
  function toForm() {
    setSummary(undefined);
    setError(undefined);
    stale.clear();
  }

  if (summary) {
    const several = summary.payments.length > 1;
    const leaving = summary.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(summary.fee.total));
    const tokenKinds = new Set(summary.payments.flatMap((p) => p.tokens.map(key))).size;
    const recipientRows = (i: number) => {
      const p = summary.payments[i]!;
      return (
        <>
          {/* The whole address: a shortened one is what a lookalike matches (chunk 23's review, S-4). */}
          {p.handle ? (
            <>
              <Row label={t("destination.to")} value={`$${p.handle}`} strong />
              <Row label={t("utxos.address")} value={p.address} whole />
            </>
          ) : (
            <Row label={t("destination.to")} value={p.address} whole />
          )}
          {/* "Amount (all of it)" for Max: "Everything" alone wasn't a label (chunk 23's second review, PY-14). */}
          <Row
            label={t(summary.max ? "withdraw.everything" : "common.amount")}
            value={summary.max ? adaText(p.lovelace) : amountText(p.lovelace, p.minimum, amounts.each[i]?.lovelace ?? "0")}
            strong
          />
          {p.tokens.map((tk, n) => {
            const held = seedelf.tokens.find((h) => key(h) === key(tk));
            return (
              <TokenAmountRow
                key={key(tk)}
                label={n === 0 ? t("review.tokens") : ""}
                token={held ?? tk}
                amount={tokenQuantity(network, { ...held, ...tk })}
              />
            );
          })}
        </>
      );
    };
    return (
      <Screen
        title={t("withdraw.review.title")}
        titleId="withdraw-review"
        review
        onBack={toForm}
        backDisabled={busy}
        aside={t("review.nothingSent")}
        error={error}
        foot={
          stale.detail !== undefined ? (
            <StaleFoot detail={stale.detail} by={stale.by} busy={busy} onAgain={againOrForm(ready, build, toForm)} />
          ) : (
            <>
              <RenewedNote renewed={stale.renewed} />
              <button type="button" className="primary" onClick={send} disabled={busy}>
                {busy ? t("common.sending") : t("common.send")}
              </button>
            </>
          )
        }
      >
        <ReviewRecipients testId="withdraw-review" payments={summary.payments} rows={recipientRows}>
          <Row label={t("review.fee")} value={adaText(summary.fee.total)} />
          <TotalRows side="private" leaving={leaving} before={total} tokens={tokenKinds} />
        </ReviewRecipients>
        <TxDetailButton txHash={summary.txHash} testId="withdraw-tx" />
        <HistoriesNote histories={summary.histories} max={summary.max} testId="withdraw-histories" />
        {summary.payments.map((p, i) => (
          <MinimumNote
            key={i}
            lovelace={p.lovelace}
            minimum={p.minimum}
            asked={amounts.each[i]?.lovelace ?? "0"}
            tokens={p.tokens.length}
            who={several ? t("recipients.nth", { number: i + 1 }) : undefined}
          />
        ))}
        {summary.left > 0 && (
          <p className="note" data-testid="withdraw-left">
            {/* Set as the language sets its sentences: a literal space ran into Japanese (cross-area review). */}
            {joinSentences([
              t("withdraw.left", { count: summary.left }),
              summary.inputs < MAX_UTXOS
                ? t("withdraw.leftTokens", { count: summary.left })
                : t("withdraw.leftLimit", { max: MAX_UTXOS }),
            ])}
          </p>
        )}
        <LeftOutNote leftOut={summary.leftOut} testId="withdraw-left-out" />
        {/* With several, each of the user's own by its number: the warning didn't say which it meant (PY-5). */}
        {summary.payments.map((p, i) => p.own && <OwnWarning key={i} account={p.ownAccount} nth={several ? i + 1 : undefined} />)}
        <p className="note">{t("send.review.confirmTime")}</p>
        <GivemeNote />
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.makePublic")}
      titleId="withdraw-title"
      // What the name means, by the name: "Make public" read as a privacy setting, or a move to one's own account
      // (blind test §5, T04b, T06). The name is the owner's call (PY-2).
      hint={t("withdraw.hint")}
      hintTestId="withdraw-hint"
      onBack={onCancel}
      aside={
        seedelf.locked.utxos
          ? `${t("withdraw.asideAvailable", { amount: shown.ada(seedelf.lovelace) })}${lockedAside(seedelf, shown.ada)}`
          : t("withdraw.asidePrivate", { amount: shown.ada(seedelf.lovelace) })
      }
      error={error}
      foot={
        <>
          <BuildStage busy={busy} />
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          {!ready && <ReviewWait reasons={waiting} tooMuch={tooMuch} busy={busy} />}
        </>
      }
    >
      {/* What this is for, on the page: "Make public" read as moving money to your own account, not as paying
          anyone (chunk 23's review, P-2); and what the payment shows at their end, which the screen that sent T04b
          and T06 here said and this one didn't (blind test §9.7). */}
      <p className="note" data-testid="withdraw-lead">
        {joinSentences([t("withdraw.lead"), t("withdraw.privacy.shows")])}
      </p>
      {list.drafts.map((d, i) => {
        const read = readOf(d);
        const e = amounts.each[i];
        const withTokens = (e?.tokens.sent.length ?? 0) > 0;
        return (
          <RecipientCard
            key={d.id}
            index={i}
            count={list.drafts.length}
            onRemove={() => {
              list.remove(d.id);
              setReads(({ [d.id]: _, ...rest }) => rest);
            }}
          >
            <DestinationInput
              id={fieldId("withdraw-to", d, i)}
              value={d.to}
              onChange={(to) => list.update(d.id, { to })}
              known={reads[d.id]}
              onRead={(r) => setReads((all) => ({ ...all, [d.id]: r }))}
              ownAccounts="private"
            />
            {read.state === "read" && read.destination.own && <OwnWarning account={read.destination.ownAccount} />}

            <div className="field">
              <label htmlFor={fieldId("withdraw-amount", d, i)}>{t("common.amount")}</label>
              <AdaInput
                id={fieldId("withdraw-amount", d, i)}
                value={d.amount}
                onChange={(amount) => list.update(d.id, { amount })}
                disabled={maxed}
                shown={t("common.maxUpTo", { amount: shown.ada(seedelf.lovelace) })}
                placeholder={withTokens ? t("common.minimum") : "0"}
                autoFocus={false}
              >
                {!list.several && (
                  <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
                    {t("common.max")}
                  </button>
                )}
              </AdaInput>
              {!list.several && tooMuch && (
                <p className="field-note" data-testid="withdraw-too-much">
                  {t("withdraw.tooMuch", { amount: shown.ada(seedelf.lovelace), available })}
                </p>
              )}
            </div>
            {maxed ? (
              <p className="note" data-testid="withdraw-max-note">
                {/* What Max does, in a sentence of its own, then what spending UTxOs together shows: "Everything …,
                    less the fee. Spending them together ties them to each other." said neither plainly, and a blind
                    back-translation found it ambiguous (the blind test's fix round). A privacy note, so `.privacy.`. */}
                {t(seedelf.locked.utxos ? "withdraw.privacy.maxLocked" : "withdraw.privacy.max", { max: MAX_UTXOS })}
              </p>
            ) : (
              <>
                {withTokens && <MinimumHint />}
                <TokenAmounts
                  held={heldFor(network, seedelf.tokens, list.drafts, d)}
                  typed={d.tokens}
                  onChange={(tokens) => list.update(d.id, { tokens })}
                />
              </>
            )}
          </RecipientCard>
        );
      })}
      <AddRecipient
        count={list.drafts.length}
        onAdd={() => {
          setMax(false);
          list.add();
        }}
      />
      {list.several && (
        <TooMuchTogether total={amounts.total} available={seedelf.lovelace} testId="withdraw-too-much" where={available} />
      )}

      <Callout tone="privacy">
        {t(list.several ? "withdraw.privacy.linksBackSeveral" : "withdraw.privacy.linksBack")}
      </Callout>
    </Screen>
  );
}

/**
 * `account`: which of the user's public accounts it is, when the wallet knows
 * (chunk 18). It is named only where there is more than one to tell apart; a
 * wallet with one account reads exactly as it did. `whose` is put together
 * above the callout, out of the critical-set deriver's sight, so its key is
 * named `.warn.`; an account goes by its number and, renamed, its name too,
 * since the picker shows a renamed one by its name alone.
 * `nth`: which recipient, on a review that pays several (PY-5).
 */
export function OwnWarning({ account, nth }: { account?: number; nth?: number }) {
  const t = useT();
  const { accounts, several } = useAccounts();
  const whose =
    several && account !== undefined
      ? t("accountPicker.numbered", { number: ownAccountNumber(accounts, account) })
      : t("withdraw.warn.publicAccount");
  return (
    <Callout tone="warn" testId="withdraw-own">
      {nth === undefined
        ? t("withdraw.warn.ownAccount", { whose })
        : t("withdraw.warn.ownAccountNth", { whose, number: nth })}
    </Callout>
  );
}
