// Withdraw: pay normal addresses, or ADA Handles, from the Seedelf balance,
// up to 20 at once: each an amount with optional tokens (with tokens, the
// amount may stay empty: only the ADA they need goes); or everything (Max)
// to a single one. Each destination is read as it's typed, and flagged when
// it's this wallet's own Cardano account. The worker builds the withdrawal,
// with Ogmios measuring its spends, and nothing is sent until the user has
// reviewed it and pressed Send.

import { useState, type FormEvent } from "react";
import { useT } from "../../i18n";

import type { Balances, PendingTx, WithdrawSummary } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
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
  TooMuchTogether,
  useRecipients,
} from "../components/Recipients";
import { Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { TokenAmounts } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaWithTokens, formatAda, lockedAside, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenQuantity } from "../tokens";

/** The most UTxOs Max takes in one transaction (the WebAssembly's `MAX_WITHDRAW_UTXOS`). */
const MAX_UTXOS = 20;

export function Withdraw({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  const network = useNetwork();
  const list = useRecipients();
  const [reads, setReads] = useState<Record<number, KnownRead>>({});
  const [max, setMax] = useState(false);
  const [summary, setSummary] = useState<WithdrawSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Max pays a single address.
  const maxed = max && !list.several;
  const amounts = recipientAmounts(network, seedelf.tokens, list.drafts, maxed);
  // A field's read counts only for the text it read.
  const readOf = (d: Draft): DestinationRead =>
    reads[d.id]?.to === d.to.trim() ? reads[d.id]!.read : { state: "idle" };
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = !maxed && amounts.total > BigInt(seedelf.lovelace);
  const ready = list.drafts.every((d) => readOf(d).state === "read") && amounts.ok && !tooMuch;
  const available = t(seedelf.locked.utxos ? "withdraw.available" : "withdraw.inPrivate");

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const payments = amounts.each.map(({ draft, lovelace, tokens }) => ({
        to: draft.to.trim(),
        lovelace: lovelace ?? null,
        tokens: maxed ? [] : tokens.sent,
      }));
      setSummary(await call("withdraw-build", { payments }));
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
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    const several = summary.payments.length > 1;
    const recipientRows = (i: number) => {
      const p = summary.payments[i]!;
      return (
        <>
          <Row label={t("destination.to")} value={p.handle ? `$${p.handle}` : shortHex(p.address, 16, 8)} title={p.address} strong />
          {p.handle && <Row label={t("utxos.address")} value={shortHex(p.address, 16, 8)} title={p.address} />}
          <Row label={t(summary.max ? "withdraw.everything" : "common.amount")} value={`${formatAda(p.lovelace)} ₳`} strong />
          {p.tokens.map((t) => {
            const held = seedelf.tokens.find((h) => key(h) === key(t));
            return <TokenAmountRow key={key(t)} label="" token={held ?? t} amount={tokenQuantity(network, { ...held, ...t })} />;
          })}
        </>
      );
    };
    return (
      <Screen
        title={t("withdraw.review.title")}
        titleId="withdraw-review"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside={t("review.nothingSent")}
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? t("common.sending") : t("common.send")}
          </button>
        }
      >
        <ReviewRecipients testId="withdraw-review" payments={summary.payments} rows={recipientRows}>
          <Row label={t("review.fee")} value={`${formatAda(summary.fee.total)} ₳`} />
          {!summary.max && (
            <Row label={t("review.backToPrivate")} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          )}
          <Row label={t("withdraw.review.spent")} value={String(summary.inputs)} />
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
            {t("withdraw.left", { count: summary.left })}{" "}
            {summary.inputs < MAX_UTXOS
              ? t("withdraw.leftTokens", { count: summary.left })
              : t("withdraw.leftLimit", { max: MAX_UTXOS })}
          </p>
        )}
        <LeftOutNote leftOut={summary.leftOut} testId="withdraw-left-out" />
        {summary.payments.some((p) => p.own) && <OwnWarning account={summary.payments.find((p) => p.own)?.ownAccount} />}
        <p className="note">{t("withdraw.review.note")}</p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.makePublic")}
      titleId="withdraw-title"
      onBack={onCancel}
      aside={
        seedelf.locked.utxos
          ? `${t("withdraw.asideAvailable", { amount: formatAda(seedelf.lovelace) })}${lockedAside(seedelf)}`
          : t("withdraw.asidePrivate", { amount: formatAda(seedelf.lovelace) })
      }
      error={error}
      foot={
        <>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          <BuildStage busy={busy} />
        </>
      }
    >
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
              ownAccounts
            />
            {read.state === "read" && read.destination.own && <OwnWarning account={read.destination.ownAccount} />}

            <div className="field">
              <label htmlFor={fieldId("withdraw-amount", d, i)}>{t("common.amount")}</label>
              <AdaInput
                id={fieldId("withdraw-amount", d, i)}
                value={d.amount}
                onChange={(amount) => list.update(d.id, { amount })}
                disabled={maxed}
                shown={t("common.max")}
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
                  {t("withdraw.tooMuch", { amount: formatAda(seedelf.lovelace), available })}
                </p>
              )}
            </div>
            {maxed ? (
              <p className="note" data-testid="withdraw-max-note">
                {t(seedelf.locked.utxos ? "withdraw.maxNoteLocked" : "withdraw.maxNote")}
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
 * wallet with one account reads exactly as it did.
 */
function OwnWarning({ account }: { account?: number }) {
  const t = useT();
  const { several } = useAccounts();
  const whose = several && account !== undefined ? t("accountPicker.numbered", { number: account + 1 }) : t("withdraw.publicAccount");
  return (
    <Callout tone="warn" testId="withdraw-own">
      {t("withdraw.warn.ownAccount", { whose })}
    </Callout>
  );
}
