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
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { adaWithTokens, formatAda, shortHex } from "../format";

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
    return (
      <Screen
        title="Review the new seedelf"
        titleId="mint-review"
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
        <ReviewRows testId="mint-review">
          {summary.label && <Row label="Seedelf" value={summary.label} strong />}
          <Row label="Token name" value={shortHex(summary.tokenName, 16, 8)} title={summary.tokenName} strong={!summary.label} />
          <Row label="Paid from" value={SOURCES[summary.from]} />
          <Row label="Locked with it" value={`${formatAda(summary.lovelace)} ₳`} />
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
          <Row label={`Back to your ${SOURCES[summary.from]}`} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
        </ReviewRows>
        <p className="note">
          {summary.from === "seedelf"
            ? "Send asks giveme.my to lend the collateral, then submits. "
            : "Send submits it. "}
          It takes about a minute for the network to confirm. Only removing the seedelf gives back the ADA locked with
          it.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title="Create a seedelf"
      titleId="mint-title"
      onBack={onCancel}
      aside={`${formatAda(from === "account" ? balances.cardano.lovelace : balances.seedelf.lovelace)} ₳ in your ${SOURCES[from]}`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!!problem || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <p className="note">
        A seedelf is a name you can give out. Anyone can pay it, and each payment reaches you under a fresh copy of your
        register, so payments can't be linked to each other or to you.
      </p>

      <div className="field">
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
            {tag ? (
              <>
                Listed as <strong>{tag}</strong>, with a token name starting{" "}
              </>
            ) : (
              <>With no tag, it's listed by its token name alone, starting </>
            )}
            <code>{tokenNamePrefix(tag)}…</code>. Up to {LABEL_MAX} letters, digits, spaces or ASCII punctuation. Anyone
            can read it on chain.
          </p>
        )}
      </div>

      <Choice
        label="Pay with"
        id="mint-from"
        value={from}
        onChange={setFrom}
        options={(["account", "seedelf"] as const).map((source) => ({
          value: source,
          label: SOURCES[source],
          disabled: (source === "account" ? balances.cardano.utxos : balances.seedelf.utxos) === 0,
        }))}
      />
      <Callout tone="privacy" testId="mint-from-note">
        {from === "account"
          ? "The seedelf is linked to your Cardano account openly. Money you move in afterwards isn't tied to it: a move-in looks the same as paying anyone's seedelf. So create your seedelf before moving money in."
          : "A stealth mint. It only keeps the seedelf apart from your Cardano account when your Seedelf balance came from other people's Seedelf payments. Money you moved in yourself can be traced back to the account."}
      </Callout>
      <p className="note">
        About 1.75 ₳ stays locked with the seedelf, and the network fee is about 0.25 ₳. The review shows the exact
        amounts.
      </p>
    </Screen>
  );
}
