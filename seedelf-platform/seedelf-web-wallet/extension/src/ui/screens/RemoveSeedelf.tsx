// Remove a seedelf: burn its token and free the ADA locked with it. That ADA
// goes back to the Cardano account by default: a seedelf the account paid
// for links to it anyway, so returning it there links nothing new. The
// Seedelf balance is the choice for a seedelf minted from it (a stealth
// mint). Nothing is sent until the user has reviewed it and pressed Send.

import { useState, type FormEvent } from "react";

import type { PendingTx, RemoveSummary, RemoveTo, SeedelfInfo } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
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
      <Screen
        title="Review the removal"
        titleId="remove-review"
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
        <ReviewRows testId="remove-review">
          <Row label="Seedelf" value={summary.label ?? "Unnamed"} strong />
          <Row label="Token name" value={shortHex(summary.name, 16, 8)} title={summary.name} />
          <Row label={`Back to your ${DESTINATIONS[summary.to]}`} value={`${formatAda(summary.lovelace)} ₳`} strong />
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
        </ReviewRows>
        <p className="note">
          The token is burned. Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the
          network to confirm.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={`Remove ${name}`}
      titleId="remove-title"
      onBack={onCancel}
      aside={`${formatAda(seedelf.lovelace)} ₳ locked with it`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <p className="note">
        Removing burns the seedelf's token and frees the ADA locked with it, less the fee. Payments already sent to it
        stay yours; after this, nobody can pay it by name.
      </p>
      <code className="copy-field__value" title={seedelf.assetName}>
        {seedelf.assetName}
      </code>

      <Choice
        label="Send what's freed to"
        id="remove-to"
        value={to}
        onChange={setTo}
        options={(["account", "seedelf"] as const).map((d) => ({ value: d, label: DESTINATIONS[d] }))}
      />
      <Callout tone="privacy" testId="remove-to-note">
        {to === "account"
          ? "Back where an account-paid seedelf's ADA came from, so it links nothing new."
          : "For a seedelf you minted from your Seedelf balance. For one your Cardano account paid for, this ties the seedelf's name to the new UTxO, and to whatever it's later spent with."}
      </Callout>
    </Screen>
  );
}
