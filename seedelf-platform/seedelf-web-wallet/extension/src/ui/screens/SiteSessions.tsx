// A site's private session (chunk 15c, private CIP-30), from the wallet's
// side. The dApps page lists each under Sites; its page shows what its
// one-time account holds, with Top up (another payment from the private
// balance), Bring it back (everything at the account into the private
// balance; the site stays connected, to an empty account) and Disconnect
// (once it's empty: the session ends, and the site's next connect asks
// again). The site's own requests go through the connector's window.
//
// Disconnect waits while anything is on its way, to the account or from it
// (a funding, a top-up, a return or its chain through Lovejoin), and asks
// first: nothing reads a closed session again (launch review H7). A funded
// session whose site another request connected meanwhile says so, and its
// money comes back from here (#43).

import { useState, type FormEvent } from "react";

import type { Balances, DappSite, PendingTx, SessionBackSummary, SessionOutSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { HandleWarning } from "../components/HandleWarning";
import { HistoriesNote } from "../components/HistoriesNote";
import {
  chainText,
  IntoRow,
  LovejoinNote,
  LovejoinRows,
  LovejoinSkipped,
  ReturnLinks,
  useSendingLabel,
} from "../components/LovejoinReturn";
import { CopyButton } from "../components/CopyButton";
import { ExternalIcon, GlobeIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { LeftBehindNote, ReturnLeftOut } from "../components/SessionLeft";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { formatAda, plural, shortHex, tokenKey, whenOf } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { tokenAmountText, tokenQuantity } from "../tokens";
import { SwapTag, type SwapTone } from "./Swaps";

/** A site's private session that isn't over. */
export const isSiteSession = (s: SessionView) => !!s.site && s.stage !== "closed";

const hostOf = (s: SessionView) => new URL(s.site!.origin).host;

/** The sites connected on this network (`dapp-sites`), or undefined until they're read. */
export type ConnectedSites = DappSite[] | undefined;

/**
 * Whether the session's site talks to it: the site is connected, to this
 * session. Another of its requests may have connected it meanwhile, to the
 * public account or another session (#43). Undefined until the sites are read.
 */
export function attachedTo(s: SessionView, sites: ConnectedSites): boolean | undefined {
  return sites && sites.some((x) => x.origin === s.site?.origin && x.session === s.index);
}

/**
 * Something on its way to the session's account or from it: its funding,
 * its return, or the return's chain through Lovejoin, sent but not all on
 * chain, and not cut short.
 */
const moving = (s: SessionView) =>
  s.stage === "funding" || s.stage === "returning" || (!!s.chain && !s.chain.cut && s.chain.confirmed < s.chain.total);

/**
 * Why Disconnect waits, if it does: anything on its way to the account or
 * from it (the worker refuses too, and says the same), or what the account
 * still holds (launch review H7). Settings' Connected sites has no Refresh
 * (`canRefresh: false`): an account it hasn't read is left to the worker's
 * own check, which reads it.
 */
export function disconnectWait(s: SessionView, { canRefresh = true }: { canRefresh?: boolean } = {}): string | undefined {
  if (s.stage === "funding") return "Its funding is on its way: wait for it to land";
  if (moving(s)) return "Its return is on its way: wait for it to land";
  if (s.stage === "failed") return undefined;
  if (!s.holding) return canRefresh ? "Refresh to read what it holds" : undefined;
  if (s.holding.utxos > 0) return "Bring everything back first";
  return undefined;
}

/** A site session's tag: connected, its funding or return on its way, a funding that never landed, or its site talking to something else. */
function tagOf(s: SessionView, attached?: boolean): { tone: SwapTone; label: string } {
  if (s.stage === "failed") return { tone: "bad", label: "Not funded" };
  if (s.stage === "funding") return { tone: "live", label: "Funding" };
  if (s.stage === "returning") return { tone: "live", label: "Coming back" };
  if (attached === false) return { tone: "wait", label: "Not connected" };
  return { tone: "done", label: "Connected" };
}

/** The account on Cardanoscan, where what the site did with it shows. */
const addressUrl = (network: "preprod" | "mainnet", address: string) =>
  `https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/address/${address}`;

/** A site's private session in the dApps page's list: the site, the session, and its tag. */
export function SiteRow({ session: s, attached, onOpen }: { session: SessionView; attached?: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="token-row swap-row" onClick={onOpen}>
      <span className="swap-pair" aria-hidden="true">
        <span className="avatar activity__icon">
          <GlobeIcon size={16} />
        </span>
      </span>
      <span className="token-row__label">{hostOf(s)}</span>
      <SwapTag {...tagOf(s, attached)} />
      <span className="token-row__sub">Private session {s.index + 1}</span>
    </button>
  );
}

type Page = "main" | "top-up";

/** One site's private session: what it holds, and Top up, Bring it back and Disconnect. */
export function SiteSession({
  session: s,
  attached,
  seedelf,
  reading,
  updatedAt,
  onRefresh,
  onBack,
  onPending,
  onDisconnected,
}: {
  session: SessionView;
  /** Whether its site talks to it (attachedTo); undefined until the sites are read. */
  attached?: boolean;
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
  const amounts = useAmounts();
  const [page, setPage] = useState<Page>("main");
  const [back, setBack] = useState<SessionBackSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [disconnecting, setDisconnecting] = useState(false);
  // A return through Lovejoin: its Send button counts the chain's transactions.
  const backSending = useSendingLabel(s.index, busy && !!back?.lovejoin);

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
            {busy ? backSending : "Send"}
          </button>
        }
      >
        <ReviewRows testId="site-back-review">
          <LovejoinRows back={back} />
          <Row label={back.lovejoin ? "Back now" : "Into your private balance"} value={`${formatAda(back.lovelace)} ₳`} strong />
          {back.tokens.map((t) => (
            <TokenAmountRow key={tokenKey(t)} label="" token={t} amount={tokenQuantity(network, t)} />
          ))}
          <Row label={back.lovejoin ? "Network fees" : "Network fee"} value={`${formatAda(back.fee)} ₳`} />
          <Row label="From" value={`${plural(back.inputs, "UTxO")} at private session ${s.index + 1}`} />
          <IntoRow back={back} />
        </ReviewRows>
        <ReturnLeftOut leftOut={back.leftOut} />
        <HandleWarning tokens={back.tokens} returning />
        <LovejoinNote
          back={back}
          busy={busy}
          onDirect={() => void act(async () => setBack(await call("session-back-build", { index: s.index, direct: true })))}
        />
        <p className="note">The site stays connected, to an empty account: Top up fills it again.</p>
        <ReturnLinks back={back} />
      </Screen>
    );
  }

  const holding = s.holding;
  const empty = !!holding && holding.utxos === 0;
  const failed = s.stage === "failed";
  const wait = disconnectWait(s);
  const bringBack = () => void act(async () => setBack(await call("session-back-build", { index: s.index })));
  // Asked first; the worker checks again, and its refusal shows here.
  const disconnect = () => {
    setDisconnecting(false);
    void act(async () => {
      await call("dapp-disconnect-session", { index: s.index });
      onDisconnected();
    });
  };
  // Funded, and its site talks to something else: its money waits here for Bring it back (#43).
  const detached = attached === false && (s.stage === "open" || s.stage === "returning");

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
                onClick={bringBack}
              >
                {busy ? "…" : "Bring it back"}
              </button>
            </div>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => setDisconnecting(true)}
            disabled={busy || !!wait}
            title={wait}
            data-testid="site-disconnect"
          >
            Disconnect
          </button>
        </div>
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={onRefresh} />
      <div className="field-row">
        <SwapTag {...tagOf(s, attached)} />
        <a className="menu-link" href={addressUrl(network, s.address)} target="_blank" rel="noreferrer">
          On Cardanoscan <ExternalIcon size={12} />
        </a>
      </div>
      <ReviewRows testId="site-session-rows">
        {/* A balance: hidden while balances are (launch review #56). */}
        <Row label="It holds" value={holding ? `${amounts.ada(holding.lovelace)} ₳` : "Refresh to read it"} strong />
        {holding?.tokens.map((t) => (
          <Row key={tokenKey(t)} label="" value={amounts.text(tokenAmountText(network, t))} />
        ))}
        <Row label="Account" value={shortHex(s.address, 16, 8)} title={s.address} />
        <Row label="Started" value={whenOf(s.createdAt, new Date())} />
        {s.chain && (s.chain.cut || s.chain.confirmed < s.chain.total) && <Row label="Through Lovejoin" value={chainText(s.chain)} />}
      </ReviewRows>
      <div className="field-row">
        <span className="note">The account's address, as the site sees it</span>
        <CopyButton value={s.address} label="Copy the account's address" />
      </div>
      {detached && (
        <Callout tone="warn" testId="site-session-detached">
          <div className="stack-tight">
            <span>
              Not connected to its site: another of {hostOf(s)}'s requests connected it meanwhile, so the site won't use this
              session. Bring its money back into your private balance, then disconnect it.
            </span>
            {!empty && holding && (
              <button type="button" className="link align-start" onClick={bringBack} disabled={busy}>
                Bring it back
              </button>
            )}
          </div>
        </Callout>
      )}
      {moving(s) && (
        <p className="note" data-testid="site-session-wait">
          {s.stage === "funding" ? "Its funding" : "Its return"} is on its way, so Disconnect waits until it lands: nothing
          reads a session once it's disconnected.
        </p>
      )}
      <LovejoinSkipped reason={s.lovejoinSkipped} />
      <LeftBehindNote leftBehind={s.leftBehind} />
      {failed ? (
        <p className="note" data-testid="site-session-failed">
          {s.unsent
            ? "Its funding never reached the chain, so the account is empty. Disconnect it: the site's next connect starts a new session."
            : "The chain hasn't shown its funding in 20 minutes, so the account looks empty. Refresh to look again: it may still land. Disconnect it once you're sure it didn't go out, since nothing reads a disconnected session."}
        </p>
      ) : (
        <Callout tone="info" testId="site-session-positions">
          Anything open on the site, like a listing, an order or a loan, is tied to this account. Close it on the site before
          you disconnect: what it pays the account later isn't looked for once the session ends.
        </Callout>
      )}
      <Callout tone="privacy">
        The wallet gives the site only this account. Topping it up links more of your private balance to it, and bringing it
        back links it to new private UTxOs. The site still sees this browser: if it has seen your public account here, it
        can tell the session is yours.
      </Callout>
      {disconnecting && (
        <Modal
          title={`Disconnect ${hostOf(s)}?`}
          titleId="site-disconnect-title"
          onClose={() => setDisconnecting(false)}
          foot={
            <>
              <button type="button" className="secondary" onClick={() => setDisconnecting(false)} disabled={busy}>
                Keep it
              </button>
              <button type="button" className="danger" onClick={disconnect} disabled={busy} data-testid="site-disconnect-confirm">
                Disconnect the site
              </button>
            </>
          }
        >
          <p className="note">
            {attached === false
              ? `Private session ${s.index + 1} ends; ${hostOf(s)} stays connected as it is now, since it doesn't use this session.`
              : `Private session ${s.index + 1} ends, and the site's next connect asks again.`}{" "}
            The wallet stops reading this account: anything the site pays it later, or leaves open on it, isn't looked for
            again.
          </p>
        </Modal>
      )}
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

  const tokens = tokenChoices(useNetwork(), seedelf.tokens, typed);
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
        <HistoriesNote histories={review.histories} session={review.index} testId="top-up-histories" />
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
