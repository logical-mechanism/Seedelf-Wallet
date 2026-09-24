// Withdraw: pay any normal address, or an ADA Handle, from the Seedelf
// balance: an amount with optional tokens, or everything (Max). The
// destination is read as it's typed, and flagged when it's this wallet's own
// Cardano account. The worker builds the withdrawal, with Ogmios measuring
// its spends, and nothing is sent until the user has reviewed it and pressed
// Send.

import { useEffect, useState, type FormEvent } from "react";

import type { Balances, PendingTx, WithdrawDestination, WithdrawSummary } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput } from "../components/AdaInput";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { formatAda, formatQuantity, parseAda, shortHex, tokenName } from "../format";

const key = (t: { policyId: string; assetName: string }) => `${t.policyId}.${t.assetName}`;

type Read =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "read"; destination: WithdrawDestination }
  | { state: "error"; message: string };

/** Wait this long after the last key press before reading the destination (a handle asks Koios). */
const SETTLE_MS = 400;

export function Withdraw({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const [to, setTo] = useState("");
  const [read, setRead] = useState<Read>({ state: "idle" });
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<WithdrawSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const destination = to.trim();
  useEffect(() => {
    if (!destination) {
      setRead({ state: "idle" });
      return;
    }
    let current = true;
    setRead({ state: "reading" });
    const timer = setTimeout(() => {
      call("withdraw-resolve", { to: destination }).then(
        (d) => current && setRead({ state: "read", destination: d }),
        (e: Error) => current && setRead({ state: "error", message: e.message }),
      );
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [destination]);

  const lovelace = max ? null : parseAda(amount);
  const round = typeof lovelace === "string" && BigInt(lovelace) % 1_000_000n === 0n;
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(seedelf.lovelace);
  const tokens = tokenChoices(seedelf.tokens, tokenAmounts);
  const ready =
    read.state === "read" &&
    (max || (typeof lovelace === "string" && lovelace !== "0" && !tooMuch && tokens.ok));

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
    const change = summary.changeTokens
      ? `${formatAda(summary.changeLovelace)} ₳ and ${plural(summary.changeTokens, "token")}`
      : `${formatAda(summary.changeLovelace)} ₳`;
    return (
      <section className="card stack" aria-labelledby="withdraw-review">
        <div className="step-header">
          <button type="button" className="link" onClick={() => setSummary(undefined)} disabled={busy}>
            ← Back
          </button>
          <span className="note">Nothing is sent until you press Send</span>
        </div>
        <h1 id="withdraw-review">Review the withdrawal</h1>
        <dl className="review" data-testid="withdraw-review">
          <Row label="To" value={summary.handle ? `$${summary.handle}` : shortHex(summary.address, 16, 8)} title={summary.address} strong />
          {summary.handle && <Row label="Address" value={shortHex(summary.address, 16, 8)} title={summary.address} />}
          <Row label={summary.max ? "Everything" : "Amount"} value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const held = seedelf.tokens.find((h) => key(h) === key(t));
            return (
              <Row key={key(t)} label="" value={`${formatQuantity(t.quantity, held?.decimals ?? 0)} ${tokenName(t.assetName)}`} />
            );
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
          {!summary.max && <Row label="Back to your Seedelf balance" value={change} />}
          <Row label="Seedelf UTxOs spent" value={String(summary.inputs)} />
        </dl>
        {summary.left > 0 && (
          <p className="note" data-testid="withdraw-left">
            {plural(summary.left, "Seedelf UTxO")} stay for another withdrawal: a transaction fits 20 at most.
          </p>
        )}
        {summary.own && <OwnWarning />}
        <p className="note">
          Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the network to confirm.
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
    <form className="card stack" onSubmit={review} aria-labelledby="withdraw-title">
      <div className="step-header">
        <button type="button" className="link" onClick={onCancel}>
          ← Back
        </button>
        <span className="note">{formatAda(seedelf.lovelace)} ₳ in your Seedelf balance</span>
      </div>
      <h1 id="withdraw-title">Withdraw</h1>

      <label htmlFor="withdraw-to">To</label>
      <input
        id="withdraw-to"
        className="seedelf-name"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="addr_test1… or $handle"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        aria-invalid={read.state === "error" ? true : undefined}
        aria-describedby="withdraw-to-note"
      />
      <div id="withdraw-to-note" data-testid="withdraw-to-note">
        {read.state === "reading" ? (
          <p className="note">Reading it…</p>
        ) : read.state === "error" ? (
          <p className="field-note" role="alert">
            {read.message}
          </p>
        ) : read.state === "read" ? (
          <p className="note">
            {read.destination.handle ? `$${read.destination.handle} is ` : "Sends to "}
            <code title={read.destination.address}>{shortHex(read.destination.address, 14, 8)}</code>
          </p>
        ) : (
          <p className="note">A Cardano address, or an ADA Handle like $name. Looking up a handle tells Koios which one.</p>
        )}
      </div>
      {read.state === "read" && read.destination.own && <OwnWarning />}

      <label htmlFor="withdraw-amount">Amount</label>
      <AdaInput id="withdraw-amount" value={amount} onChange={setAmount} disabled={max} shown="Max" autoFocus={false}>
        <button
          type="button"
          className={max ? "segmented__item segmented__item--on" : "segmented__item"}
          aria-pressed={max}
          onClick={() => setMax(!max)}
        >
          Max
        </button>
      </AdaInput>
      {tooMuch && (
        <p className="field-note" data-testid="withdraw-too-much">
          That's more than the {formatAda(seedelf.lovelace)} ₳ in your Seedelf balance.
        </p>
      )}
      {max ? (
        <p className="note" data-testid="withdraw-max-note">
          Everything in your Seedelf balance, up to 20 UTxOs at once, with every token, less the fee. Spending them
          together ties them to each other.
        </p>
      ) : (
        <>
          <p className={lovelace && !round ? "callout callout--warn" : "note"}>
            Round amounts, like 100 ₳, are harder to match to the move-in that paid for them.
          </p>
          <TokenAmounts held={seedelf.tokens} typed={tokenAmounts} onChange={setTokenAmounts} />
        </>
      )}

      <div className="callout">
        Withdrawing to where the money came from links it back. Send it somewhere else, or keep it in Seedelf.
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

function OwnWarning() {
  return (
    <div className="callout callout--warn" data-testid="withdraw-own">
      This is your own Cardano account. Withdrawing here links the money back to it, and to whoever paid it into
      Seedelf.
    </div>
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
