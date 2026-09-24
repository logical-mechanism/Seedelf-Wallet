// Move in: ADA (an amount, or Max) and any picked tokens from the Cardano
// account into the Seedelf balance. The worker builds and signs; nothing is
// sent until the user has reviewed the result and pressed Send.

import { useState, type FormEvent } from "react";

import type { Balances, MoveInSummary, PendingTx, TokenAmount, TokenRef } from "../../shared/rpc";
import { call } from "../background";
import { formatAda, formatQuantity, parseAda, tokenName } from "../format";

const key = (t: TokenRef) => `${t.policyId}.${t.assetName}`;

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
  const ready = max || (typeof lovelace === "string" && lovelace !== "0");
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
      <section className="card stack" aria-labelledby="move-in-review">
        <div className="step-header">
          <button type="button" className="link" onClick={() => setSummary(undefined)} disabled={busy}>
            ← Back
          </button>
          <span className="note">Nothing is sent until you press Send</span>
        </div>
        <h1 id="move-in-review">Review the move</h1>
        <dl className="review" data-testid="move-in-review">
          <Row label="Into Seedelf" value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const known = cardano.tokens.find((c) => key(c) === key(t));
            return <Row key={key(t)} label="" value={`${formatQuantity(t.quantity, known?.decimals ?? 0)} ${tokenName(t.assetName)}`} />;
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
          <Row
            label="Back to your Cardano account"
            value={`${formatAda(summary.changeLovelace)} ₳${summary.changeTokens ? ` and ${plural(summary.changeTokens, "token")}` : ""}`}
          />
          <Row label="New Seedelf UTxOs" value={String(summary.depositOutputs)} />
        </dl>
        <p className="note">
          The new UTxOs are locked to fresh copies of your Seedelf key's register. It takes about a minute for the network
          to confirm them.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="primary" onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={review} aria-labelledby="move-in-title">
      <div className="step-header">
        <button type="button" className="link" onClick={onCancel}>
          ← Back
        </button>
        <span className="note">{formatAda(cardano.lovelace)} ₳ available</span>
      </div>
      <h1 id="move-in-title">Move in</h1>
      <p className="note">Move ADA, and any tokens you pick, from your Cardano account into your Seedelf balance.</p>

      <label htmlFor="move-in-amount">Amount</label>
      <div className="amount-row">
        <input
          id="move-in-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={max ? "Max" : amount}
          disabled={max}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={!max && amount !== "" && lovelace === undefined ? true : undefined}
          autoFocus
        />
        <span className="amount-row__unit">₳</span>
        <button type="button" className={max ? "segmented__item segmented__item--on" : "segmented__item"} aria-pressed={max} onClick={() => setMax(!max)}>
          Max
        </button>
      </div>
      {max ? (
        <p className="note">Everything except the fee and what the tokens you keep need. UTxOs of exactly 5 ₳ stay put: another wallet may use them as collateral.</p>
      ) : (
        <p className={amount && !round ? "callout callout--warn" : "note"}>
          Round amounts, like 100 ₳, are harder to match to a later withdrawal.
        </p>
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
              <span className="tokens__name">{tokenName(t.assetName)}</span>
              <span className="tokens__amount">{formatQuantity(t.quantity, t.decimals)}</span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="callout">
        Moving in links your Cardano account to the new Seedelf UTxOs, but not to any seedelf name.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={!ready || busy}>
        {busy ? "Building…" : "Review"}
      </button>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "review__row review__row--strong" : "review__row"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}
