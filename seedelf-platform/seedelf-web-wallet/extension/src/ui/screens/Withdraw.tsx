// Withdraw: pay any normal address, or an ADA Handle, from the Seedelf
// balance: an amount with optional tokens (with tokens, the amount may stay
// empty: only the ADA they need goes), or everything (Max). The destination
// is read as it's typed, and flagged when it's this wallet's own Cardano
// account. The worker builds the withdrawal, with Ogmios measuring its
// spends, and nothing is sent until the user has reviewed it and pressed
// Send.

import { useState, type FormEvent } from "react";

import type { Balances, PendingTx, WithdrawSummary } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint, MinimumNote, RoundNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { DestinationField, useDestination } from "../components/Destination";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
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
  const [to, setTo] = useState("");
  const read = useDestination(to);
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<WithdrawSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const destination = to.trim();
  const tokens = tokenChoices(seedelf.tokens, tokenAmounts);
  const withTokens = tokens.sent.length > 0;
  const lovelace = max ? null : lovelaceToSend(amount, withTokens);
  const round = typeof lovelace === "string" && BigInt(lovelace) % 1_000_000n === 0n;
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(seedelf.lovelace);
  const ready = read.state === "read" && (max || (typeof lovelace === "string" && !tooMuch && tokens.ok));

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(
        await call("withdraw-build", { to: destination, lovelace: lovelace ?? null, tokens: max ? [] : tokens.sent }),
      );
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
        <ReviewRows testId="withdraw-review">
          <Row label="To" value={summary.handle ? `$${summary.handle}` : shortHex(summary.address, 16, 8)} title={summary.address} strong />
          {summary.handle && <Row label="Address" value={shortHex(summary.address, 16, 8)} title={summary.address} />}
          <Row label={summary.max ? "Everything" : "Amount"} value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const held = seedelf.tokens.find((h) => key(h) === key(t));
            return (
              <Row
                key={key(t)}
                label=""
                value={`${formatQuantity(t.quantity, held?.decimals ?? 0)} ${tokenLabel(network, t)}`}
              />
            );
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
          {!summary.max && (
            <Row label="Back to your Seedelf balance" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          )}
          <Row label="Seedelf UTxOs spent" value={String(summary.inputs)} />
        </ReviewRows>
        <MinimumNote lovelace={summary.lovelace} minimum={summary.minimum} asked={lovelace ?? "0"} tokens={summary.tokens.length} />
        {summary.left > 0 && (
          <p className="note" data-testid="withdraw-left">
            {plural(summary.left, "Seedelf UTxO")} stay for another withdrawal: a transaction fits 20 at most.
          </p>
        )}
        {summary.own && <OwnWarning />}
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
      <DestinationField id="withdraw-to" value={to} onChange={setTo} read={read} />
      {read.state === "read" && read.destination.own && <OwnWarning />}

      <div className="field">
        <label htmlFor="withdraw-amount">Amount</label>
        <AdaInput
          id="withdraw-amount"
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
          <p className="field-note" data-testid="withdraw-too-much">
            That's more than the {formatAda(seedelf.lovelace)} ₳ {seedelf.locked.utxos ? "available" : "in your Seedelf balance"}.
          </p>
        )}
      </div>
      {max ? (
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
          <TokenAmounts held={seedelf.tokens} typed={tokenAmounts} onChange={setTokenAmounts} />
        </>
      )}

      <Callout tone="privacy">
        Withdrawing to where the money came from links it back. Send it somewhere else, or keep it in Seedelf.
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
