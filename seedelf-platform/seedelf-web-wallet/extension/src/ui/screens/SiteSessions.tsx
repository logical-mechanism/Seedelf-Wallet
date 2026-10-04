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
import { joinSentences, t, useT } from "../../i18n";

import type { Balances, DappSite, PendingTx, SessionBackSummary, SessionOutSummary, SessionView } from "../../shared/rpc";
import { call } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { HandleWarning } from "../components/HandleWarning";
import { HistoriesNote } from "../components/HistoriesNote";
import { PaidRows } from "../components/PaidRows";
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
import { ExplorerLink, ExplorerNote } from "../components/ExplorerLink";
import { GlobeIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { LeftBehindNote, ReturnLeftOut } from "../components/SessionLeft";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { formatAda, shortHex, tokenKey, whenOf } from "../format";
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
  if (s.stage === "funding") return t("sites.wait.funding");
  if (moving(s)) return t("sites.wait.returning");
  if (s.stage === "failed") return undefined;
  if (!s.holding) return canRefresh ? t("sites.wait.refresh") : undefined;
  if (s.holding.utxos > 0) return t("sites.wait.bringBack");
  return undefined;
}

/** A site session's tag: connected, its funding or return on its way, a funding that never landed, or its site talking to something else. */
function tagOf(s: SessionView, attached?: boolean): { tone: SwapTone; label: string } {
  if (s.stage === "failed") return { tone: "bad", label: t("swaps.step.notFunded") };
  if (s.stage === "funding") return { tone: "live", label: t("sites.tag.funding") };
  if (s.stage === "returning") return { tone: "live", label: t("swaps.stage.returning") };
  if (attached === false) return { tone: "wait", label: t("sites.tag.notConnected") };
  return { tone: "done", label: t("sites.tag.connected") };
}

/** A site's private session in the dApps page's list: the site, the session, and its tag. */
export function SiteRow({ session: s, attached, onOpen }: { session: SessionView; attached?: boolean; onOpen: () => void }) {
  const tr = useT();
  return (
    <button type="button" className="token-row swap-row" onClick={onOpen}>
      <span className="swap-pair" aria-hidden="true">
        <span className="avatar activity__icon">
          <GlobeIcon size={16} />
        </span>
      </span>
      <span className="token-row__label">{hostOf(s)}</span>
      <SwapTag {...tagOf(s, attached)} />
      <span className="token-row__sub">{tr("lovejoin.privateSession", { number: s.index + 1 })}</span>
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
  const tr = useT();
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
        title={tr("swaps.back.title")}
        titleId="site-back-review"
        onBack={() => setBack(undefined)}
        backDisabled={busy}
        aside={tr("review.nothingSent")}
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
            {busy ? backSending : tr("common.send")}
          </button>
        }
      >
        <ReviewRows testId="site-back-review">
          <LovejoinRows back={back} />
          <Row
            label={tr(back.lovejoin ? "swaps.back.backNow" : "swaps.back.intoPrivate")}
            value={`${formatAda(back.lovelace)} ₳`}
            strong
          />
          {back.tokens.map((t) => (
            <TokenAmountRow key={tokenKey(t)} label="" token={t} amount={tokenQuantity(network, t)} />
          ))}
          <Row label={tr(back.lovejoin ? "lovejoin.review.fees" : "review.fee")} value={`${formatAda(back.fee)} ₳`} />
          <Row
            label={tr("swaps.back.from")}
            value={tr("sites.back.fromValue", { utxos: tr("amount.utxos", { count: back.inputs }), number: s.index + 1 })}
          />
          <IntoRow back={back} />
        </ReviewRows>
        <TxDetailButton txHash={back.txHash} testId="site-back-tx" />
        <ReturnLeftOut leftOut={back.leftOut} />
        <HandleWarning tokens={back.tokens} returning />
        <LovejoinNote
          back={back}
          busy={busy}
          onDirect={() => void act(async () => setBack(await call("session-back-build", { index: s.index, direct: true })))}
        />
        <p className="note">{tr("sites.back.staysConnected")}</p>
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
      aside={tr("lovejoin.privateSession", { number: s.index + 1 })}
      error={error}
      foot={
        <div className="stack">
          {!failed && (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setPage("top-up")} disabled={busy || s.stage === "funding"}>
                {tr("sites.topUp")}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !holding || empty}
                title={!holding ? tr("sites.wait.refresh") : empty ? tr("sites.holdsNothing") : undefined}
                onClick={bringBack}
              >
                {busy ? "…" : tr("swaps.foot.bringBack")}
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
            {tr("sites.disconnect")}
          </button>
        </div>
      }
    >
      <RefreshRow reading={reading} updatedAt={updatedAt} onRefresh={onRefresh} />
      <div className="field-row">
        <SwapTag {...tagOf(s, attached)} />
        {/* The account on Cardanoscan, where what the site did with it shows: the note goes under the row. */}
        <ExplorerLink network={network} address={s.address} private note={false}>
          {tr("sites.onCardanoscan")}
        </ExplorerLink>
      </div>
      <ExplorerNote what="account" />
      <ReviewRows testId="site-session-rows">
        {/* A balance: hidden while balances are (launch review #56). */}
        <Row
          label={tr("swaps.rows.itHolds")}
          value={holding ? `${amounts.ada(holding.lovelace)} ₳` : tr("sites.refreshToRead")}
          strong
        />
        {holding?.tokens.map((t) => (
          <Row key={tokenKey(t)} label="" value={amounts.text(tokenAmountText(network, t))} />
        ))}
        <Row label={tr("lovejoin.review.account")} value={shortHex(s.address, 16, 8)} title={s.address} />
        <Row label={tr("swaps.rows.started")} value={whenOf(s.createdAt, new Date())} />
        {s.chain && (s.chain.cut || s.chain.confirmed < s.chain.total) && (
          <Row label={tr("sites.throughLovejoin")} value={chainText(s.chain, !s.auto)} />
        )}
      </ReviewRows>
      <div className="field-row">
        <span className="note">{tr("sites.addressNote")}</span>
        <CopyButton value={s.address} label={tr("sites.copyAddress")} />
      </div>
      {detached && (
        <Callout tone="warn" testId="site-session-detached">
          <div className="stack-tight">
            <span>{tr("sites.warn.detached", { host: hostOf(s) })}</span>
            {!empty && holding && (
              <button type="button" className="link align-start" onClick={bringBack} disabled={busy}>
                {tr("swaps.foot.bringBack")}
              </button>
            )}
          </div>
        </Callout>
      )}
      {moving(s) && (
        <p className="note" data-testid="site-session-wait">
          {tr(s.stage === "funding" ? "sites.movingFunding" : "sites.movingReturn")}
        </p>
      )}
      <LovejoinSkipped reason={s.lovejoinSkipped} />
      <LeftBehindNote leftBehind={s.leftBehind} />
      {failed ? (
        <p className="note" data-testid="site-session-failed">
          {tr(s.unsent ? "sites.failed.neverSent" : "sites.failed.unseen")}
        </p>
      ) : (
        <Callout tone="info" testId="site-session-positions">{tr("sites.positions")}</Callout>
      )}
      <Callout tone="privacy">{tr("sites.privacy.onlyThisAccount")}</Callout>
      {disconnecting && (
        <DisconnectSession session={s} attached={attached} busy={busy} onKeep={() => setDisconnecting(false)} onDisconnect={disconnect} />
      )}
    </Screen>
  );
}

/** Disconnect asks first: what ends, and that the wallet stops reading the account. Exported for its test. */
export function DisconnectSession({
  session: s,
  attached,
  busy,
  onKeep,
  onDisconnect,
}: {
  session: SessionView;
  attached?: boolean;
  busy: boolean;
  onKeep: () => void;
  onDisconnect: () => void;
}) {
  const tr = useT();
  return (
    <Modal
      title={tr("sites.disconnectTitle", { host: hostOf(s) })}
      titleId="site-disconnect-title"
      onClose={onKeep}
      foot={
        <>
          <button type="button" className="secondary" onClick={onKeep} disabled={busy}>
            {/* Settings' own disconnect asks the same, and Spanish needs the site's gender, not a box's. */}
            {tr("sites.keepIt")}
          </button>
          <button type="button" className="danger" onClick={onDisconnect} disabled={busy} data-testid="site-disconnect-confirm">
            {tr("sites.disconnectConfirm")}
          </button>
        </>
      }
    >
      <p className="note">
        {joinSentences([
          tr(attached === false ? "sites.disconnect.detached" : "sites.disconnect.attached", { number: s.index + 1, host: hostOf(s) }),
          tr("sites.disconnect.stopsReading"),
        ])}
      </p>
    </Modal>
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
  const tr = useT();
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
    const [paid, collateral] = review.payments;
    return (
      <Screen
        title={tr("sites.topUp.reviewTitle")}
        titleId="top-up-review"
        onBack={() => setReview(undefined)}
        backDisabled={busy}
        aside={tr("review.nothingSent")}
        error={error}
        foot={
          <button type="button" className="primary" onClick={() => void send()} disabled={busy}>
            {busy ? tr("common.sending") : tr("common.send")}
          </button>
        }
      >
        <ReviewRows testId="top-up-review">
          <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: review.index + 1 })} strong />
          <PaidRows label={tr("sites.topUp.amount")} paid={paid} />
          {collateral && <Row label={tr("lovejoin.review.itsCollateral")} value={`${formatAda(collateral.lovelace)} ₳`} />}
          <Row label={tr("review.fee")} value={`${formatAda(review.fee.total)} ₳`} />
          <Row label={tr("review.backToPrivate")} value={`${formatAda(review.changeLovelace)} ₳`} />
        </ReviewRows>
        <TxDetailButton txHash={review.txHash} testId="top-up-tx" />
        {collateral && (
          <p className="note" data-testid="top-up-collateral">
            {tr("sites.topUp.collateral")}
          </p>
        )}
        <Callout tone="privacy">{tr("sites.topUp.privacy.links")}</Callout>
        <HistoriesNote histories={review.histories} session={review.index} testId="top-up-histories" />
        <p className="note">{tr("swaps.review.givemeNote")}</p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={build}
      title={tr("sites.topUp")}
      titleId="top-up-title"
      onBack={onCancel}
      aside={tr("sites.topUp.aside", { ada: formatAda(seedelf.lovelace) })}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {tr(busy ? "common.building" : "common.review")}
        </button>
      }
    >
      <div className="field">
        <label htmlFor="top-up-amount">{tr("sites.topUp.amount")}</label>
        <AdaInput
          id="top-up-amount"
          value={amount}
          onChange={setAmount}
          placeholder={withTokens ? tr("sites.topUp.minimum") : "0"}
        />
        {tooMuch && (
          <p className="field-note">{tr("sites.topUp.tooMuch", { held: formatAda(seedelf.lovelace) })}</p>
        )}
      </div>
      {withTokens && <MinimumHint />}
      <TokenAmounts held={seedelf.tokens} typed={typed} onChange={setTyped} />
      <p className="note">{tr("sites.topUp.into", { number: s.index + 1, host: hostOf(s) })}</p>
    </Screen>
  );
}
