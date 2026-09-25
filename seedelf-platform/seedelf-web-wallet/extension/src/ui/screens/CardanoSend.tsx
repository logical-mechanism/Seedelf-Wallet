// Send from the Cardano account: pay any normal address, or an ADA Handle,
// as any Cardano wallet does; or someone's seedelf by its whole name, paid
// into Seedelf under a fresh copy of its register, like a move-in. Up to 20
// recipients at once, each with an amount and optional tokens (with tokens,
// the amount may stay empty: only the ADA they need goes); or the most
// possible (Max) to a single recipient. It's paid in the open; the privacy
// note says what that shows, and how to pay without that link. The worker
// builds and signs; nothing is sent until the user has reviewed it and
// pressed Send.

import { useState, type FormEvent } from "react";

import type { Balances, PendingTx, SendPaid, SendSummary } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, MinimumHint, MinimumNote } from "../components/AdaInput";
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
import { adaWithTokens, formatAda, formatQuantity, lockedAside, rewardsAside, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenLabel } from "../tokens";

export function CardanoSend({
  cardano,
  rewards,
  onCancel,
  onSent,
}: {
  /** What can pay: `lovelace` includes `rewards`. */
  cardano: Balances["cardano"];
  /** Staking rewards that ride along (lovelace), when any do. */
  rewards?: string;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const list = useRecipients();
  const [reads, setReads] = useState<Record<number, KnownRead>>({});
  const [max, setMax] = useState(false);
  const [summary, setSummary] = useState<SendSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Max pays a single recipient.
  const maxed = max && !list.several;
  const amounts = recipientAmounts(cardano.tokens, list.drafts, maxed);
  // A field's read counts only for the text it read.
  const readOf = (d: Draft): DestinationRead =>
    reads[d.id]?.to === d.to.trim() ? reads[d.id]!.read : { state: "idle" };
  const found = list.drafts.every((d) => ["read", "seedelf"].includes(readOf(d).state));
  // The builder decides exactly (fee, change, collateral UTxOs); this catches the obvious case early.
  const tooMuch = !maxed && amounts.total > BigInt(cardano.lovelace);
  const ready = found && amounts.ok && !tooMuch;
  const toSeedelf = list.drafts.some((d) => readOf(d).state === "seedelf");

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const payments = amounts.each.map(({ draft, lovelace, tokens }) => {
        const read = readOf(draft);
        return { to: read.state === "seedelf" ? read.seedelf.name : draft.to.trim(), lovelace: lovelace ?? null, tokens: tokens.sent };
      });
      setSummary(await call("send-build", { payments }));
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
      onSent(await call("send-submit", { txHash: summary.txHash }));
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
          <ToRows paid={p} />
          <Row label="Amount" value={`${formatAda(p.lovelace)} ₳`} strong />
          {p.tokens.map((t) => {
            const held = cardano.tokens.find((h) => key(h) === key(t));
            return (
              <Row key={key(t)} label="" value={`${formatQuantity(t.quantity, held?.decimals ?? 0)} ${tokenLabel(network, t)}`} />
            );
          })}
        </>
      );
    };
    return (
      <Screen
        title="Review the payment"
        titleId="send-review"
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
        <ReviewRecipients testId="send-review" payments={summary.payments} rows={recipientRows}>
          <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
          <WithdrawalRow withdrawal={summary.withdrawal} />
          <Row label="Back to your public account" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label="UTxOs spent" value={String(summary.inputs)} />
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
        {summary.payments.some((p) => p.own) && <OwnNote />}
        <p className="note">
          {summary.payments.some((p) => p.seedelf) &&
            `Only the owner of ${several ? "each" : "this"} Seedelf can spend the payment, and it can't be linked to their Seedelf by looking at the chain. `}
          It takes about a minute for the network to confirm.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title="Send"
      titleId="send-title"
      onBack={onCancel}
      aside={`${formatAda(cardano.lovelace)} ₳ available${rewardsAside(rewards)}${lockedAside(cardano)}`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      {list.drafts.map((d, i) => {
        const read = readOf(d);
        const withTokens = (amounts.each[i]?.tokens.sent.length ?? 0) > 0;
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
              id={fieldId("send-to", d, i)}
              value={d.to}
              onChange={(to) => list.update(d.id, { to })}
              known={reads[d.id]}
              onRead={(r) => setReads((all) => ({ ...all, [d.id]: r }))}
              seedelfs
            />
            {read.state === "read" && read.destination.own && <OwnNote />}

            <div className="field">
              <label htmlFor={fieldId("send-amount", d, i)}>Amount</label>
              <AdaInput
                id={fieldId("send-amount", d, i)}
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
                <p className="field-note" data-testid="send-too-much">
                  That's more than the {formatAda(cardano.lovelace)} ₳ available in your public account.
                </p>
              )}
            </div>
            {maxed ? (
              <p className="note" data-testid="send-max-note">
                Everything except the fee and what the tokens you keep need{rewards ? ", staking rewards included" : ""}.
                Your collateral and any UTxOs you locked stay put.
              </p>
            ) : (
              withTokens && <MinimumHint />
            )}

            <TokenAmounts
              held={heldFor(cardano.tokens, list.drafts, d)}
              typed={d.tokens}
              onChange={(tokens) => list.update(d.id, { tokens })}
            />
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
        <TooMuchTogether
          total={amounts.total}
          available={cardano.lovelace}
          testId="send-too-much"
          where="available in your public account"
        />
      )}

      <Callout tone="privacy">
        {toSeedelf
          ? "This pays from your public account in the open: anyone can see it came from you and went to a private balance, though not whose."
          : "This pays from your public account in the open: anyone can see it came from you."}
        {list.several && " Paying several at once also shows they were paid together."} To pay without that link, make the money private and send it from there.
      </Callout>
    </Screen>
  );
}

/** Where one payment went: a Seedelf by tag and name, a $handle and its address, or an address. */
function ToRows({ paid }: { paid: SendPaid }) {
  if (paid.seedelf) {
    const { name, label } = paid.seedelf;
    return label ? (
      <>
        <Row label="To" value={label} strong />
        <Row label="Seedelf name" value={shortHex(name, 16, 8)} title={name} />
      </>
    ) : (
      <Row label="To" value={shortHex(name, 16, 8)} title={name} strong />
    );
  }
  return (
    <>
      <Row label="To" value={paid.handle ? `$${paid.handle}` : shortHex(paid.address, 16, 8)} title={paid.address} strong />
      {paid.handle && <Row label="Address" value={shortHex(paid.address, 16, 8)} title={paid.address} />}
    </>
  );
}

/** The staking rewards a payment from the account spent, when it did. */
export function WithdrawalRow({ withdrawal }: { withdrawal?: string }) {
  if (!withdrawal || BigInt(withdrawal) === 0n) return null;
  return <Row label="Staking rewards spent" value={`${formatAda(withdrawal)} ₳`} />;
}

function OwnNote() {
  return (
    <Callout tone="warn" testId="send-own">
      This is your own public account: the payment comes back to it, less the fee.
    </Callout>
  );
}
