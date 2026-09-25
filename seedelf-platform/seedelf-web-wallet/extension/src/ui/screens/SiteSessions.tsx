// A site's private session (chunk 15c, private CIP-30), from the wallet's
// side. The dApps page lists each under Sites; its page shows what its
// one-time account holds, with Top up (another payment from the private
// balance), Bring it back (everything at the account into the private
// balance; the site stays connected, to an empty account) and Disconnect
// (once it's empty: the session ends, and the site's next connect asks
// again). The site's own requests go through the connector's window.

import { useState, type FormEvent } from "react";

import type { Balances, PendingTx, SessionBackSummary, SessionOutSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { ExternalIcon, GlobeIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { formatAda, formatQuantity, plural, shortHex, tokenKey, whenOf } from "../format";
import { useNetwork } from "../network";
import { tokenInfo, tokenLabel } from "../tokens";
import { SwapTag, type SwapTone } from "./Swaps";

/** A site's private session that isn't over. */
export const isSiteSession = (s: SessionView) => !!s.site && s.stage !== "closed";

const hostOf = (s: SessionView) => new URL(s.site!.origin).host;

/** A site session's tag: connected, its funding or return on its way, or a funding that never landed. */
function tagOf(s: SessionView): { tone: SwapTone; label: string } {
  if (s.stage === "failed") return { tone: "bad", label: "Not funded" };
  if (s.stage === "funding") return { tone: "live", label: "Funding" };
  if (s.stage === "returning") return { tone: "live", label: "Coming back" };
  return { tone: "done", label: "Connected" };
}

/** The account on Cardanoscan, where what the site did with it shows. */
const addressUrl = (network: "preprod" | "mainnet", address: string) =>
  `https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/address/${address}`;

/** A site's private session in the dApps page's list: the site, the session, and its tag. */
export function SiteRow({ session: s, onOpen }: { session: SessionView; onOpen: () => void }) {
  return (
    <button type="button" className="token-row swap-row" onClick={onOpen}>
      <span className="swap-pair" aria-hidden="true">
        <span className="avatar activity__icon">
          <GlobeIcon size={16} />
        </span>
      </span>
      <span className="token-row__label">{hostOf(s)}</span>
      <SwapTag {...tagOf(s)} />
      <span className="token-row__sub">Private session {s.index + 1}</span>
    </button>
  );
}

type Page = "main" | "top-up";

/** One site's private session: what it holds, and Top up, Bring it back and Disconnect. */
export function SiteSession({
  session: s,
  seedelf,
  reading,
  updatedAt,
  onRefresh,
  onBack,
  onPending,
  onDisconnected,
}: {
  session: SessionView;
  seedelf: Balances["seedelf"];
  reading: boolean;
  updatedAt?: number;
  onRefresh: () => void;
  onBack: () => void;
  /** A top-up was sent: Home's banner watches it. */
  onPending: (pending: PendingTx) => void;
  onDisconnected: () => void;
}) {
  const network = useNetwork();
  const [page, setPage] = useState<Page>("main");
  const [back, setBack] = useState<SessionBackSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const act = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (page === "top-up") {
    return (
      <TopUp
        session={s}
        seedelf={seedelf}
        onCancel={() => setPage("main")}
        onSent={(pending) => {
          onPending(pending);
          setPage("main");
          onRefresh();
        }}
      />
    );
  }

  if (back) {
    return (
      <Screen
        title="Review the return"
        titleId="site-back-review"
        onBack={() => setBack(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await call("session-back-submit", { txHash: back.txHash });
                setBack(undefined);
                onRefresh();
              })
            }
          >
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRows testId="site-back-review">
          <Row label="Into your private balance" value={`${formatAda(back.lovelace)} ₳`} strong />
          {back.tokens.map((t) => (
            <Row key={tokenKey(t)} label="" value={`${formatQuantity(t.quantity, tokenInfo(network, t)?.decimals ?? 0)} ${tokenLabel(network, t)}`} />
          ))}
          <Row label="Network fee" value={`${formatAda(back.fee)} ₳`} />
          <Row label="From" value={`${plural(back.inputs, "UTxO")} at private session ${s.index + 1}`} />
        </ReviewRows>
        <p className="note">The site stays connected, to an empty account: Top up fills it again.</p>
        <Callout tone="privacy">
          This links the one-time account to the new private UTxOs, as Make private does.
        </Callout>
      </Screen>
    );
  }

  const holding = s.holding;
  const empty = !!holding && holding.utxos === 0;
  const failed = s.stage === "failed";
  const disconnect = () =>
    void act(async () => {
      await call("dapp-disconnect-session", { index: s.index });
      onDisconnected();
    });

  return (
    <Screen
      title={hostOf(s)}
      titleId="site-session-title"
      onBack={onBack}
      aside={`Private session ${s.index + 1}`}
      error={error}
      foot={
        <div className="stack">
          {!failed && (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setPage("top-up")} disabled={busy || s.stage === "funding"}>
                Top up
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !holding || empty}
                title={!holding ? "Refresh to read what it holds" : empty ? "It holds nothing" : undefined}
                onClick={() => void act(async () => setBack(await call("session-back-build", { index: s.index })))}
              >
                {busy ? "…" : "Bring it back"}
              </button>
            </div>
          )}
          <button
            type="button"
            className="secondary"
            onClick={disconnect}
            disabled={busy || !empty}
            title={empty ? undefined : "Bring everything back first"}
          >
            Disconnect
          </button>
        </div>
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={onRefresh} />
      <div className="field-row">
        <SwapTag {...tagOf(s)} />
        <a className="menu-link" href={addressUrl(network, s.address)} target="_blank" rel="noreferrer">
          On Cardanoscan <ExternalIcon size={12} />
        </a>
      </div>
      <ReviewRows testId="site-session-rows">
        <Row label="It holds" value={holding ? `${formatAda(holding.lovelace)} ₳` : "Refresh to read it"} strong />
        {holding?.tokens.map((t) => (
          <Row key={tokenKey(t)} label="" value={`${formatQuantity(t.quantity, tokenInfo(network, t)?.decimals ?? 0)} ${tokenLabel(network, t)}`} />
        ))}
        <Row label="Account" value={shortHex(s.address, 16, 8)} title={s.address} />
        <Row label="Started" value={whenOf(s.createdAt, new Date())} />
      </ReviewRows>
      <div className="field-row">
        <span className="note">The account's address, as the site sees it</span>
        <CopyButton value={s.address} label="Copy the account's address" />
      </div>
      {failed ? (
        <p className="note" data-testid="site-session-failed">
          Its funding never reached the chain, so the account is empty. Disconnect it: the site's next connect starts a new
          session.
        </p>
      ) : (
        <Callout tone="info" testId="site-session-positions">
          Anything open on the site, like a listing, an order or a loan, is tied to this account. Close it on the site before
          you disconnect: what it pays the account later isn't looked for once the session ends.
        </Callout>
      )}
      <Callout tone="privacy">
        The site sees only this account. Topping it up links more of your private balance to it, and bringing it back links
        it to new private UTxOs.
      </Callout>
    </Screen>
  );
}

/** Another payment into a site's private session: an amount and tokens, reviewed, then sent. */
function TopUp({
  session: s,
  seedelf,
  onCancel,
  onSent,
}: {
  session: SessionView;
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [review, setReview] = useState<SessionOutSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const tokens = tokenChoices(seedelf.tokens, typed);
  const withTokens = tokens.sent.length > 0;
  const lovelace = lovelaceToSend(amount, withTokens);
  const tooMuch = !!lovelace && BigInt(lovelace) > BigInt(seedelf.lovelace);
  const ready = !!lovelace && !tooMuch && tokens.ok;

  async function build(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setReview(await call("session-top-up-build", { index: s.index, lovelace: lovelace!, tokens: tokens.sent }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!review || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSent(await call("session-top-up-submit", { txHash: review.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (review) {
    const [paid] = review.payments;
    return (
      <Screen
        title="Review the top-up"
        titleId="top-up-review"
        onBack={() => setReview(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button type="button" className="primary" onClick={() => void send()} disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRows testId="top-up-review">
          <Row label="To" value={`Private session ${review.index + 1}`} strong />
          <Row
            label="Amount"
            value={`${formatAda(paid?.lovelace ?? "0")} ₳${paid?.tokens.length ? ` and ${plural(paid.tokens.length, "token")}` : ""}`}
            strong
          />
          <Row label="Network fee" value={`${formatAda(review.fee.total)} ₳`} />
          <Row label="Back to your private balance" value={`${formatAda(review.changeLovelace)} ₳`} />
        </ReviewRows>
        <Callout tone="privacy">
          This payment links the private UTxOs it spends to the session's account, as its funding did.
        </Callout>
        <p className="note">Send asks giveme.my to lend the collateral, then submits.</p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={build}
      title="Top up"
      titleId="top-up-title"
      onBack={onCancel}
      aside={`${formatAda(seedelf.lovelace)} ₳ in your private balance`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <div className="field">
        <label htmlFor="top-up-amount">Amount</label>
        <AdaInput id="top-up-amount" value={amount} onChange={setAmount} placeholder={withTokens ? "Minimum" : "0"} />
        {tooMuch && <p className="field-note">That's more than the {formatAda(seedelf.lovelace)} ₳ in your private balance.</p>}
      </div>
      {withTokens && <MinimumHint />}
      <TokenAmounts held={seedelf.tokens} typed={typed} onChange={setTyped} />
      <p className="note">Into private session {s.index + 1}, for {hostOf(s)}.</p>
    </Screen>
  );
}
