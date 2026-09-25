// Withdraw: pay normal addresses, or ADA Handles, from the Seedelf balance,
// up to 20 at once: each an amount with optional tokens (with tokens, the
// amount may stay empty: only the ADA they need goes); or everything (Max)
// to a single one. Each destination is read as it's typed, and flagged when
// it's this wallet's own Cardano account. The worker builds the withdrawal,
// with Ogmios measuring its spends, and nothing is sent until the user has
// reviewed it and pressed Send.

import { useState, type FormEvent } from "react";

import type { Balances, PendingTx, WithdrawSummary } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, MinimumHint, MinimumNote, RoundNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
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
import { Screen } from "../components/Screen";
import { TokenAmounts } from "../components/TokenAmounts";
import { adaWithTokens, formatAda, formatQuantity, lockedAside, plural, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenLabel } from "../tokens";

export function Withdraw({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const list = useRecipients();
  const [reads, setReads] = useState<Record<number, KnownRead>>({});
  const [max, setMax] = useState(false);
  const [summary, setSummary] = useState<WithdrawSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Max pays a single address.
  const maxed = max && !list.several;
  const amounts = recipientAmounts(seedelf.tokens, list.drafts, maxed);
  // A field's read counts only for the text it read.
  const readOf = (d: Draft): DestinationRead =>
    reads[d.id]?.to === d.to.trim() ? reads[d.id]!.read : { state: "idle" };
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = !maxed && amounts.total > BigInt(seedelf.lovelace);
  const ready = list.drafts.every((d) => readOf(d).state === "read") && amounts.ok && !tooMuch;
  const available = seedelf.locked.utxos ? "available" : "in your Seedelf balance";

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
          <Row label="To" value={p.handle ? `$${p.handle}` : shortHex(p.address, 16, 8)} title={p.address} strong />
          {p.handle && <Row label="Address" value={shortHex(p.address, 16, 8)} title={p.address} />}
          <Row label={summary.max ? "Everything" : "Amount"} value={`${formatAda(p.lovelace)} ₳`} strong />
          {p.tokens.map((t) => {
            const held = seedelf.tokens.find((h) => key(h) === key(t));
            return (
              <Row key={key(t)} label="" value={`${formatQuantity(t.quantity, held?.decimals ?? 0)} ${tokenLabel(network, t)}`} />
            );
          })}
        </>
      );
    };
    return (
      <Screen
        title="Review the withdrawal"
        titleId="withdraw-review"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRecipients testId="withdraw-review" payments={summary.payments} rows={recipientRows}>
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
          {!summary.max && (
            <Row label="Back to your Seedelf balance" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          )}
          <Row label="Seedelf UTxOs spent" value={String(summary.inputs)} />
        </ReviewRecipients>
        {summary.payments.map((p, i) => (
          <MinimumNote
            key={i}
            lovelace={p.lovelace}
            minimum={p.minimum}
            asked={amounts.each[i]?.lovelace ?? "0"}
            tokens={p.tokens.length}
            who={several ? `Recipient ${i + 1}` : undefined}
          />
        ))}
        {summary.left > 0 && (
          <p className="note" data-testid="withdraw-left">
            {plural(summary.left, "Seedelf UTxO")} stay for another withdrawal: a transaction fits 20 at most.
          </p>
        )}
        {summary.payments.some((p) => p.own) && <OwnWarning />}
        <p className="note">
          Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the network to confirm.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title="Withdraw"
      titleId="withdraw-title"
      onBack={onCancel}
      aside={
        seedelf.locked.utxos
          ? `${formatAda(seedelf.lovelace)} ₳ available${lockedAside(seedelf)}`
          : `${formatAda(seedelf.lovelace)} ₳ in your Seedelf balance`
      }
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      {list.drafts.map((d, i) => {
        const read = readOf(d);
        const e = amounts.each[i];
        const withTokens = (e?.tokens.sent.length ?? 0) > 0;
        const lovelace = e?.lovelace;
        const round = typeof lovelace === "string" && BigInt(lovelace) % 1_000_000n === 0n;
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
            />
            {read.state === "read" && read.destination.own && <OwnWarning />}

            <div className="field">
              <label htmlFor={fieldId("withdraw-amount", d, i)}>Amount</label>
              <AdaInput
                id={fieldId("withdraw-amount", d, i)}
                value={d.amount}
                onChange={(amount) => list.update(d.id, { amount })}
                disabled={maxed}
                shown="Max"
                placeholder={withTokens ? "Minimum" : "0"}
                autoFocus={false}
              >
                {!list.several && (
                  <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
                    Max
                  </button>
                )}
              </AdaInput>
              {!list.several && tooMuch && (
                <p className="field-note" data-testid="withdraw-too-much">
                  That's more than the {formatAda(seedelf.lovelace)} ₳ {available}.
                </p>
              )}
            </div>
            {maxed ? (
              <p className="note" data-testid="withdraw-max-note">
                Everything in your Seedelf balance, up to 20 UTxOs at once, with every token, less the fee. Spending them
                together ties them to each other.{seedelf.locked.utxos ? " UTxOs you locked stay put." : ""}
              </p>
            ) : (
              <>
                {withTokens && <MinimumHint />}
                <RoundNote warn={!!lovelace && lovelace !== "0" && !round}>
                  Round amounts, like 100 ₳, are harder to match to the move-in that paid for them.
                </RoundNote>
                <TokenAmounts
                  held={heldFor(seedelf.tokens, list.drafts, d)}
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
        Withdrawing to where the money came from links it back. Send it somewhere else, or keep it in Seedelf.
        {list.several && " Addresses paid in one withdrawal can be seen to be paid together."}
      </Callout>
    </Screen>
  );
}

function OwnWarning() {
  return (
    <Callout tone="warn" testId="withdraw-own">
      This is your own Cardano account. Withdrawing here links the money back to it, and to whoever paid it into
      Seedelf.
    </Callout>
  );
}
