// Create a seedelf. A mint links the seedelf to whatever pays for it, so the
// Cardano account pays by default: minted before any move-in, the seedelf is
// linked to the account openly, and money moved in afterwards isn't tied to
// it. The Seedelf balance can pay instead (a stealth mint), which only hides
// the payer when that balance came from other people's Seedelf payments. The
// worker builds it, with Ogmios measuring its script, and nothing is sent
// until the user has reviewed it and pressed Send.

import { useState, type FormEvent } from "react";

import { LABEL_MAX, labelProblem, tokenNamePrefix } from "../../shared/label";
import type { Balances, MintSource, MintSummary, PendingTx } from "../../shared/rpc";
import { call } from "../background";
import { formatAda, shortHex } from "../format";

const SOURCES: Record<MintSource, string> = { account: "Cardano account", seedelf: "Seedelf balance" };

export function CreateSeedelf({
  balances,
  onCancel,
  onSent,
}: {
  balances: Balances;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const [from, setFrom] = useState<MintSource>(balances.cardano.utxos > 0 ? "account" : "seedelf");
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState<MintSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const tag = label.trim();
  const problem = labelProblem(label);

  async function review(e: FormEvent) {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("mint-build", { label: tag, from }));
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
      onSent(await call("mint-submit", { txHash: summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    const change = summary.changeTokens
      ? `${formatAda(summary.changeLovelace)} ₳ and ${plural(summary.changeTokens, "token")}`
      : `${formatAda(summary.changeLovelace)} ₳`;
    return (
      <section className="card stack" aria-labelledby="mint-review">
        <div className="step-header">
          <button type="button" className="link" onClick={() => setSummary(undefined)} disabled={busy}>
            ← Back
          </button>
          <span className="note">Nothing is sent until you press Send</span>
        </div>
        <h1 id="mint-review">Review the new seedelf</h1>
        <dl className="review" data-testid="mint-review">
          <Row label="Seedelf" value={summary.label || "Unnamed"} strong />
          <Row label="Token name" value={shortHex(summary.tokenName, 16, 8)} title={summary.tokenName} />
          <Row label="Paid from" value={SOURCES[summary.from]} />
          <Row label="Locked with it" value={`${formatAda(summary.lovelace)} ₳`} />
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
          <Row label={`Back to your ${SOURCES[summary.from]}`} value={change} />
        </dl>
        <p className="note">
          {summary.from === "seedelf"
            ? "Send asks giveme.my to lend the collateral, then submits. "
            : "Send submits it. "}
          It takes about a minute for the network to confirm. Only removing the seedelf gives back the ADA locked with
          it.
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
    <form className="card stack" onSubmit={review} aria-labelledby="mint-title">
      <div className="step-header">
        <button type="button" className="link" onClick={onCancel}>
          ← Back
        </button>
        <span className="note">
          {formatAda(from === "account" ? balances.cardano.lovelace : balances.seedelf.lovelace)} ₳ in your{" "}
          {SOURCES[from]}
        </span>
      </div>
      <h1 id="mint-title">Create a seedelf</h1>
      <p className="note">
        A seedelf is a name you can give out. Anyone can pay it, and each payment reaches you under a fresh copy of your
        register, so payments can't be linked to each other or to you.
      </p>

      <label htmlFor="mint-label">Personal tag (optional)</label>
      <input
        id="mint-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={LABEL_MAX}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby="mint-label-note"
      />
      {problem ? (
        <p className="field-note" id="mint-label-note" role="alert">
          {problem}
        </p>
      ) : (
        <p className="note" id="mint-label-note" data-testid="mint-preview">
          Listed as <strong>{tag || "Unnamed"}</strong>, with a token name starting{" "}
          <code>{tokenNamePrefix(tag)}…</code>. Up to {LABEL_MAX} letters, digits, spaces or ASCII punctuation. Anyone
          can read it on chain.
        </p>
      )}

      <p className="note">
        About 1.75 ₳ stays locked with the seedelf, and the network fee is about 0.25 ₳. The review shows the exact
        amounts.
      </p>

      <span className="label" id="mint-from">
        Pay with
      </span>
      <div className="segmented" role="group" aria-labelledby="mint-from">
        {(["account", "seedelf"] as const).map((source) => (
          <button
            key={source}
            type="button"
            className={from === source ? "segmented__item segmented__item--on" : "segmented__item"}
            aria-pressed={from === source}
            disabled={(source === "account" ? balances.cardano.utxos : balances.seedelf.utxos) === 0}
            onClick={() => setFrom(source)}
          >
            {SOURCES[source]}
          </button>
        ))}
      </div>
      <div className="callout" data-testid="mint-from-note">
        {from === "account"
          ? "The seedelf is linked to your Cardano account openly. Money you move in afterwards isn't tied to it: a move-in looks the same as paying anyone's seedelf. So create your seedelf before moving money in."
          : "A stealth mint. It only keeps the seedelf apart from your Cardano account when your Seedelf balance came from other people's Seedelf payments. Money you moved in yourself can be traced back to the account."}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={!!problem || busy}>
        {busy ? "Building…" : "Review"}
      </button>
    </form>
  );
}

function Row({ label, value, strong, title }: { label: string; value: string; strong?: boolean; title?: string }) {
  return (
    <div className={strong ? "review__row review__row--strong" : "review__row"}>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}
