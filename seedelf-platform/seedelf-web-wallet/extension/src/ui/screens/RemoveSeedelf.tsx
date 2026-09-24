// Remove a seedelf: burn its token and free the ADA locked with it. That ADA
// goes back to the Cardano account by default: a seedelf the account paid
// for links to it anyway, so returning it there links nothing new. The
// Seedelf balance is the choice for a seedelf minted from it (a stealth
// mint). Nothing is sent until the user has reviewed it and pressed Send.

import { useState, type FormEvent } from "react";

import type { PendingTx, RemoveSummary, RemoveTo, SeedelfInfo } from "../../shared/rpc";
import { call } from "../background";
import { formatAda, shortHex } from "../format";

const DESTINATIONS: Record<RemoveTo, string> = { account: "Cardano account", seedelf: "Seedelf balance" };

export function RemoveSeedelf({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: SeedelfInfo;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const [to, setTo] = useState<RemoveTo>("account");
  const [summary, setSummary] = useState<RemoveSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = seedelf.label ?? "Unnamed seedelf";

  async function review(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("remove-build", { name: seedelf.assetName, to }));
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
      onSent(await call("remove-submit", { txHash: summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <section className="card stack" aria-labelledby="remove-review">
        <div className="step-header">
          <button type="button" className="link" onClick={() => setSummary(undefined)} disabled={busy}>
            ← Back
          </button>
          <span className="note">Nothing is sent until you press Send</span>
        </div>
        <h1 id="remove-review">Review the removal</h1>
        <dl className="review" data-testid="remove-review">
          <Row label="Seedelf" value={summary.label ?? "Unnamed"} strong />
          <Row label="Token name" value={shortHex(summary.name, 16, 8)} title={summary.name} />
          <Row label={`Back to your ${DESTINATIONS[summary.to]}`} value={`${formatAda(summary.lovelace)} ₳`} strong />
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
        </dl>
        <p className="note">
          The token is burned. Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the
          network to confirm.
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
    <form className="card stack" onSubmit={review} aria-labelledby="remove-title">
      <div className="step-header">
        <button type="button" className="link" onClick={onCancel}>
          ← Back
        </button>
        <span className="note">{formatAda(seedelf.lovelace)} ₳ locked with it</span>
      </div>
      <h1 id="remove-title">Remove {name}</h1>
      <p className="note">
        Removing burns the seedelf's token and frees the ADA locked with it, less the fee. Payments already sent to it
        stay yours; after this, nobody can pay it by name.
      </p>
      <p className="note">
        <code title={seedelf.assetName}>{shortHex(seedelf.assetName, 16, 8)}</code>
      </p>

      <span className="label" id="remove-to">
        Send what's freed to
      </span>
      <div className="segmented" role="group" aria-labelledby="remove-to">
        {(["account", "seedelf"] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={to === d ? "segmented__item segmented__item--on" : "segmented__item"}
            aria-pressed={to === d}
            onClick={() => setTo(d)}
          >
            {DESTINATIONS[d]}
          </button>
        ))}
      </div>
      <div className="callout" data-testid="remove-to-note">
        {to === "account"
          ? "Back where an account-paid seedelf's ADA came from, so it links nothing new."
          : "For a seedelf you minted from your Seedelf balance. For one your Cardano account paid for, this ties the seedelf's name to the new UTxO, and to whatever it's later spent with."}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy}>
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
