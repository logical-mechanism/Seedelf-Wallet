// Move in: ADA (an amount, or Max) and any amounts of tokens from the Cardano
// account into the Seedelf balance. With tokens, the amount may stay empty:
// only the ADA they need moves. The worker builds and signs; nothing is sent
// until the user has reviewed the result and pressed Send.

import { useState, type FormEvent } from "react";

import type { Balances, MoveInSummary, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint, MinimumNote, RoundNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { adaWithTokens, formatAda, formatQuantity, lockedAside, rewardsAside, tokenKey as key } from "../format";
import { WithdrawalRow } from "./CardanoSend";
import { useNetwork } from "../network";
import { tokenLabel } from "../tokens";

export function MoveIn({
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
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<MoveInSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const tokens = tokenChoices(cardano.tokens, tokenAmounts);
  const withTokens = tokens.sent.length > 0;
  const lovelace = max ? null : lovelaceToSend(amount, withTokens);
  const round = typeof lovelace === "string" && BigInt(lovelace) % 1_000_000n === 0n;
  // The builder decides exactly (fee, change, collateral UTxOs); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(cardano.lovelace);
  const ready = tokens.ok && (max || (typeof lovelace === "string" && !tooMuch));
  const network = useNetwork();

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("move-in-build", { lovelace: lovelace ?? null, tokens: tokens.sent }));
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
      onSent(await call("move-in-submit", { txHash: summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title="Review the move"
        titleId="move-in-review"
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
        <ReviewRows testId="move-in-review">
          <Row label="Into Seedelf" value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const known = cardano.tokens.find((c) => key(c) === key(t));
            return (
              <Row
                key={key(t)}
                label=""
                value={`${formatQuantity(t.quantity, known?.decimals ?? 0)} ${tokenLabel(network, t)}`}
              />
            );
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
          <WithdrawalRow withdrawal={summary.withdrawal} />
          <Row label="Back to your Cardano account" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label="New Seedelf UTxOs" value={String(summary.depositOutputs)} />
        </ReviewRows>
        <MinimumNote lovelace={summary.lovelace} minimum={summary.minimum} asked={lovelace ?? "0"} tokens={summary.tokens.length} />
        <p className="note">
          The new UTxOs are locked to fresh copies of your Seedelf key's register. It takes about a minute for the network
          to confirm them.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title="Move in"
      titleId="move-in-title"
      onBack={onCancel}
      aside={`${formatAda(cardano.lovelace)} ₳ available${rewardsAside(rewards)}${lockedAside(cardano)}`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <p className="note">Move ADA, and any amount of your tokens, from your Cardano account into your Seedelf balance.</p>

      <div className="field">
        <label htmlFor="move-in-amount">Amount</label>
        <AdaInput
          id="move-in-amount"
          value={amount}
          onChange={setAmount}
          disabled={max}
          shown="Max"
          placeholder={withTokens ? "Minimum" : "0"}
        >
          <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
            Max
          </button>
        </AdaInput>
        {tooMuch && (
          <p className="field-note" data-testid="move-in-too-much">
            That's more than the {formatAda(cardano.lovelace)} ₳ available in your Cardano account.
          </p>
        )}
      </div>
      {max ? (
        <p className="note">
          Everything except the fee and what the tokens you keep need{rewards ? ", staking rewards included" : ""}. Your
          collateral and any UTxOs you locked stay put.
        </p>
      ) : (
        <>
          {withTokens && <MinimumHint />}
          <RoundNote warn={!!lovelace && lovelace !== "0" && !round}>
            Round amounts, like 100 ₳, are harder to match to a later withdrawal.
          </RoundNote>
        </>
      )}

      <TokenAmounts
        held={cardano.tokens}
        typed={tokenAmounts}
        onChange={setTokenAmounts}
        legend="Bring tokens along (optional)"
      />

      <Callout tone="privacy">Moving in links your Cardano account to the new Seedelf UTxOs, but not to any Seedelf name.</Callout>
    </Screen>
  );
}
