// Send from the Cardano account: pay any normal address, or an ADA Handle,
// as any Cardano wallet does. An amount with optional tokens (with tokens,
// the amount may stay empty: only the ADA they need goes), or the most
// possible (Max). It's paid in the open; the privacy note says how to pay
// without that link. The worker builds and signs; nothing is sent until the
// user has reviewed it and pressed Send.

import { useState, type FormEvent } from "react";

import type { Balances, PendingTx, SendSummary } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { DestinationField, useDestination } from "../components/Destination";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { adaWithTokens, formatAda, formatQuantity, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenLabel } from "../tokens";

export function CardanoSend({
  cardano,
  onCancel,
  onSent,
}: {
  cardano: Balances["cardano"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const [to, setTo] = useState("");
  const read = useDestination(to);
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<SendSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const tokens = tokenChoices(cardano.tokens, tokenAmounts);
  const withTokens = tokens.sent.length > 0;
  const lovelace = max ? null : lovelaceToSend(amount, withTokens);
  // The builder decides exactly (fee, change, collateral UTxOs); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(cardano.lovelace);
  const ready = read.state === "read" && tokens.ok && (max || (typeof lovelace === "string" && !tooMuch));

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("send-build", { to: to.trim(), lovelace: lovelace ?? null, tokens: tokens.sent }));
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
        <ReviewRows testId="send-review">
          <Row label="To" value={summary.handle ? `$${summary.handle}` : shortHex(summary.address, 16, 8)} title={summary.address} strong />
          {summary.handle && <Row label="Address" value={shortHex(summary.address, 16, 8)} title={summary.address} />}
          <Row label="Amount" value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const held = cardano.tokens.find((h) => key(h) === key(t));
            return (
              <Row
                key={key(t)}
                label=""
                value={`${formatQuantity(t.quantity, held?.decimals ?? 0)} ${tokenLabel(network, t)}`}
              />
            );
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
          <Row label="Back to your Cardano account" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label="UTxOs spent" value={String(summary.inputs)} />
        </ReviewRows>
        <MinimumNote lovelace={summary.lovelace} minimum={summary.minimum} asked={lovelace ?? "0"} tokens={summary.tokens.length} />
        {summary.own && <OwnNote />}
        <p className="note">It takes about a minute for the network to confirm.</p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title="Send"
      titleId="send-title"
      onBack={onCancel}
      aside={`${formatAda(cardano.lovelace)} ₳ available`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <DestinationField id="send-to" value={to} onChange={setTo} read={read} />
      {read.state === "read" && read.destination.own && <OwnNote />}

      <div className="field">
        <label htmlFor="send-amount">Amount</label>
        <AdaInput
          id="send-amount"
          value={amount}
          onChange={setAmount}
          disabled={max}
          shown="Max"
          placeholder={withTokens ? "Minimum" : "0"}
          autoFocus={false}
        >
          <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
            Max
          </button>
        </AdaInput>
        {tooMuch && (
          <p className="field-note" data-testid="send-too-much">
            That's more than the {formatAda(cardano.lovelace)} ₳ in your Cardano account.
          </p>
        )}
      </div>
      {max ? (
        <p className="note" data-testid="send-max-note">
          Everything except the fee and what the tokens you keep need. UTxOs of exactly 5 ₳ stay put: another wallet may
          use them as collateral.
        </p>
      ) : (
        withTokens && <MinimumHint />
      )}

      <TokenAmounts held={cardano.tokens} typed={tokenAmounts} onChange={setTokenAmounts} />

      <Callout tone="privacy">
        This pays from your Cardano account in the open: anyone can see it came from you. To pay without that link, move
        the money into Seedelf and send it from there.
      </Callout>
    </Screen>
  );
}

function OwnNote() {
  return (
    <Callout tone="warn" testId="send-own">
      This is your own Cardano account: the payment comes back to it, less the fee.
    </Callout>
  );
}
