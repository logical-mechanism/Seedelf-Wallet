// Move in: ADA (an amount, or Max) and any picked tokens from the Cardano
// account into the Seedelf balance. The worker builds and signs; nothing is
// sent until the user has reviewed the result and pressed Send.

import { useState, type FormEvent } from "react";

import type { Balances, MoveInSummary, PendingTx, TokenAmount, TokenRef } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, RoundNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { adaWithTokens, formatAda, formatQuantity, parseAda, tokenKey as key, tokenName } from "../format";

export function MoveIn({
  cardano,
  onCancel,
  onSent,
}: {
  cardano: Balances["cardano"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<MoveInSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const lovelace = max ? null : parseAda(amount);
  const round = typeof lovelace === "string" && BigInt(lovelace) % 1_000_000n === 0n;
  // The builder decides exactly (fee, change, collateral UTxOs); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(cardano.lovelace);
  const ready = max || (typeof lovelace === "string" && lovelace !== "0" && !tooMuch);
  const tokens: TokenRef[] = cardano.tokens.filter((t) => picked.has(key(t)));

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("move-in-build", { lovelace: lovelace ?? null, tokens }));
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
            return <Row key={key(t)} label="" value={`${formatQuantity(t.quantity, known?.decimals ?? 0)} ${tokenName(t.assetName)}`} />;
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
          <Row label="Back to your Cardano account" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label="New Seedelf UTxOs" value={String(summary.depositOutputs)} />
        </ReviewRows>
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
      aside={`${formatAda(cardano.lovelace)} ₳ available`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <p className="note">Move ADA, and any tokens you pick, from your Cardano account into your Seedelf balance.</p>

      <div className="field">
        <label htmlFor="move-in-amount">Amount</label>
        <AdaInput id="move-in-amount" value={amount} onChange={setAmount} disabled={max} shown="Max">
          <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
            Max
          </button>
        </AdaInput>
        {tooMuch && (
          <p className="field-note" data-testid="move-in-too-much">
            That's more than the {formatAda(cardano.lovelace)} ₳ in your Cardano account.
          </p>
        )}
      </div>
      {max ? (
        <p className="note">Everything except the fee and what the tokens you keep need. UTxOs of exactly 5 ₳ stay put: another wallet may use them as collateral.</p>
      ) : (
        <RoundNote warn={!!lovelace && !round}>Round amounts, like 100 ₳, are harder to match to a later withdrawal.</RoundNote>
      )}

      {cardano.tokens.length > 0 && (
        <fieldset className="token-picker">
          <legend>Bring tokens along (each moves in full)</legend>
          {cardano.tokens.map((t: TokenAmount) => (
            <label key={key(t)} className="token-picker__row">
              <input
                type="checkbox"
                checked={picked.has(key(t))}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(key(t));
                  else next.delete(key(t));
                  setPicked(next);
                }}
              />
              <span className="list__name">{tokenName(t.assetName)}</span>
              <span className="list__value">{formatQuantity(t.quantity, t.decimals)}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Callout tone="privacy">Moving in links your Cardano account to the new Seedelf UTxOs, but not to any seedelf name.</Callout>
    </Screen>
  );
}
