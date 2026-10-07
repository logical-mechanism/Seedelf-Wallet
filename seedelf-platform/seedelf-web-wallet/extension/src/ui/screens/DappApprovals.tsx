// The dApp connector's window (`?view=dapp`): what sites wait for, oldest
// first, one at a time. Connecting a site, signing its transaction (with
// what it does to the account, as WebAssembly read it), or signing its data
// (CIP-8). Nothing is signed until the user presses Sign, with the password
// typed too unless Settings says otherwise; closing the window declines
// everything. Once nothing's left, the worker closes it (it knows whether a
// request just came in).
//
// Connecting offers the public account or a private session (chunk 15c): a
// one-time account funded from the private balance, here, before the site
// gets it. Its funding is reviewed and sent from this window, which then
// waits for the network; closing it then doesn't undo the payment.
//
// Declining a connect turns the site away for a while (10 s, then a minute,
// then five; the worker's `REFUSE_MS`): its Decline says so before it's
// pressed, and the window says what it did before it closes, where it said
// only "Nothing's waiting." (blind test §9.2, T17, T17r).
//
// A signature's foot (the password, Decline and Sign) follows the request
// rather than staying in view: kept in view at 400×605, it covered who the
// transaction pays and the warning that signing ties two accounts together,
// so Sign could be pressed without either having been on screen (chunk 23's
// second review, CW-1). Now Sign is reached only past them. The line under the
// title says Sign is at the end: at 400×605, Sign sat 266 px below the fold
// with nothing saying it was there (blind test T18).

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { joinSentences, t, useT } from "../../i18n";

import { lovejoinOn } from "../../networks";
import type { Balances, DappApproval, DappToken, DappTxSummary, SessionOutSummary } from "../../shared/rpc";
import { call, onDappChanged, RpcError } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { GivemeNote } from "../components/GivemeNote";
import { HistoriesNote } from "../components/HistoriesNote";
import { PaidRows } from "../components/PaidRows";
import { RadioCards } from "../components/RadioCards";
import { ExplorerLink } from "../components/ExplorerLink";
import { GlobeIcon, ShieldIcon, SpinnerIcon, WalletIcon } from "../components/Icons";
import { PasswordField } from "../components/PasswordField";
import { boxCost } from "../components/LovejoinReturn";
import { ReviewRows, Row } from "../components/ReviewRows";
import { homeBalance, TotalRows } from "../components/ReviewTotals";
import { Screen } from "../components/Screen";
import { refusalOf, SessionRefusedFoot, type Refusal } from "../components/SessionRefused";
import { TxDetailButton } from "../components/TxDetail";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { TokenAmountRow, TokenAmountText } from "../components/TokenList";
import { certificateLine, paidTo, signingTies, stakingComesBack, tiesLine, withdrawalLine } from "../dapp";
import { adaText, formatAda, formatQuantity, shortHex, unlocked } from "../format";
import { useNetwork } from "../network";
import { useAmounts, usePreferences } from "../preferences";
import { aboutAda, SESSION_FEE_ESTIMATE, toCents } from "../swap";
import { useSiteAccount, waitText } from "../sites";
import { tokenDecimals, tokenText } from "../tokens";

/** How long an empty list waits before the window closes: a site's next request may be on its way. */
const CLOSE_AFTER_MS = 800;
/** How long it stays, once the user declined a site, saying so: long enough to read it (blind test T17). */
const DECLINED_CLOSE_MS = 4_000;
/**
 * How long the buttons wait when another request takes the shown one's
 * place, so a click meant for that one can't answer this one.
 */
const HOLD_MS = 1_000;

/** How the request shown came to be: the next after the user's answer, or in the place of one that's gone. */
type Change = "next" | "replaced";

/**
 * How an answer went: done, or not (the window's error says why), or a
 * private session's funding refused, which its review reads to build it
 * again or say where to look (chunk 23's second review, DX-1).
 */
type Answered = boolean | { refused: RpcError };

export function DappApprovals() {
  const tr = useT();
  const siteAccount = useSiteAccount();
  const [approvals, setApprovals] = useState<DappApproval[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  // What the user just declined: a site, and how long it's turned away, or everything at once with Decline all, and
  // whether a site was among it. Said once nothing's left (T17), where it said only "Nothing's waiting.".
  const [declined, setDeclined] = useState<{ host: string; waitMs: number } | { all: true; sites: boolean }>();

  const load = useCallback(() => {
    call("dapp-approvals", {}).then(setApprovals, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    return onDappChanged(load);
  }, [load]);

  // Empty: the worker closes the window, unless a request came in meanwhile,
  // which it would otherwise decline unseen; then it's shown.
  useEffect(() => {
    clearTimeout(closing.current);
    if (approvals?.length === 0 && !error) {
      closing.current = setTimeout(
        () => {
          call("dapp-close", {}).then((closed) => {
            if (!closed) load();
          }, load);
        },
        declined ? DECLINED_CLOSE_MS : CLOSE_AFTER_MS,
      );
    }
    return () => clearTimeout(closing.current);
  }, [approvals, error, load, declined]);

  const current = approvals?.[0];
  const needsPassword = !!current && current.kind !== "connect" && current.password;
  const [password, setPassword] = useState("");
  // Each request starts with an empty box.
  const currentId = current?.id;
  useEffect(() => setPassword(""), [currentId]);
  // Another request in front of the user: what was declined before it isn't the news any more.
  useEffect(() => {
    if (currentId) setDeclined(undefined);
  }, [currentId]);

  // Another request in the place of the one shown (the next, or one whose
  // page went away): it says so, and its buttons wait a moment.
  const shown = useRef<string>(undefined);
  const answered = useRef<string>(undefined);
  const [change, setChange] = useState<Change>();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!currentId) return;
    const before = shown.current;
    shown.current = currentId;
    if (before === undefined || before === currentId) return;
    setChange(before === answered.current ? "next" : "replaced");
    setHeld(true);
    const timer = setTimeout(() => setHeld(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [currentId]);

  /** Answers the request shown: `extra` carries a private session's funding and the password it needs. */
  async function answer(
    approve: boolean,
    extra: { password?: string; fund?: { txHash: string }; governance?: boolean } = {},
  ): Promise<Answered> {
    if (!current || busy || held || (approve && needsPassword && !password)) return false;
    answered.current = current.id;
    setBusy(true);
    setError(undefined);
    try {
      const result = await call("dapp-answer", {
        id: current.id,
        approve,
        ...(approve && needsPassword ? { password } : {}),
        ...extra,
      });
      if (result.error) {
        setPassword("");
        // A private session's funding: its review works out what the refusal leaves it (DX-1).
        if (extra.fund) return { refused: new RpcError(result.error, result.code, result.by) };
        setError(result.error);
        return false;
      }
      if (!approve && result.waitMs !== undefined) setDeclined({ host: new URL(current.origin).host, waitMs: result.waitMs });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
      load();
    }
  }

  /**
   * Declines everything listed, as closing the window does: a private
   * session's funding that's sent isn't undone. At most the window's 20
   * (chunk 23's second review, CW-7).
   */
  async function declineAll() {
    if (!approvals || busy) return;
    // What comes in meanwhile shows as the next request, not as one in the place of a request that went away.
    answered.current = current?.id;
    setBusy(true);
    setError(undefined);
    let sites = false;
    try {
      for (const a of approvals) {
        if (a.kind === "connect" && a.funding) continue;
        // One the site took back meanwhile is gone already: nothing to say.
        const answered = await call("dapp-answer", { id: a.id, approve: false }).catch(() => undefined);
        if (answered?.waitMs !== undefined) sites = true;
      }
      setDeclined({ all: true, sites });
    } finally {
      setBusy(false);
      load();
    }
  }

  if (!current) {
    // Declined, the window stays a few seconds to say so: with a way to close it now, where it was one sentence on an
    // empty window that only closed itself (the pass-two visual review). A request that came in meanwhile is shown.
    const closeNow = () => {
      clearTimeout(closing.current);
      call("dapp-close", {}).then((closed) => {
        if (!closed) load();
      }, load);
    };
    return (
      <Screen
        title="Seedelf Wallet"
        titleId="dapp-title"
        error={error}
        foot={
          declined && approvals ? (
            <button type="button" className="secondary" onClick={closeNow} data-testid="dapp-declined-close">
              {tr("common.close")}
            </button>
          ) : undefined
        }
      >
        {declined && approvals ? (
          <p className="note center" role="status" data-testid="dapp-declined">
            {"all" in declined
              ? tr(declined.sites ? "dappUi.declinedAllSites" : "dappUi.declinedAll")
              : tr("dappUi.declined", { host: declined.host, wait: waitText(declined.waitMs) })}
          </p>
        ) : (
          <p className="note center" data-testid="dapp-empty">
            {tr(approvals ? "dappUi.nothingWaiting" : "dappUi.loading")}
          </p>
        )}
      </Screen>
    );
  }

  const queue = <Queue total={approvals!.length} busy={busy} onDeclineAll={() => void declineAll()} />;
  if (current.kind === "connect") {
    return (
      <ConnectRequest
        key={current.id}
        approval={current}
        queue={queue}
        busy={busy}
        held={held}
        change={change}
        error={error}
        onError={setError}
        onAnswer={answer}
      />
    );
  }
  const title = tr(current.kind === "sign-tx" ? "dappUi.signTxTitle" : "dappUi.signDataTitle");
  const action = tr("dappUi.sign");

  return (
    <Screen
      // Each request a screen of its own, which opens at its top, as a connect's does: two signatures in a row share
      // a title (blind test §9.10).
      key={current.id}
      title={title}
      titleId="dapp-title"
      // Where Sign is, from the first view: it follows the request, below the fold of a 400×605 window for most, and
      // T18's tester stopped to work out whether the first view was the whole window (blind test §6).
      aside={tr("dappUi.nothingUntilEnd", { action })}
      error={error}
      // With the password, Enter in its box signs, as it unlocks elsewhere.
      onSubmit={
        needsPassword
          ? (e: FormEvent) => {
              e.preventDefault();
              void answer(true);
            }
          : undefined
      }
      // After the request, not kept over it: read to its end before Sign (chunk 23's second review, CW-1).
      footSticky={false}
      foot={
        <>
          {/* In the foot, over the buttons it unlocks: in the body, under a foot kept in view, it started below the
              fold and Sign looked broken (chunk 23's review, CW-1). Never focused first: the request is read before
              the password is typed. */}
          {needsPassword && (
            <PasswordField id="dapp-password" label={tr("dappUi.passwordLabel")} value={password} onChange={setPassword} />
          )}
          <div className="actions">
            <button type="button" className="secondary" onClick={() => answer(false)} disabled={busy || held}>
              {tr("dappUi.decline")}
            </button>
            <button
              type={needsPassword ? "submit" : "button"}
              className="primary"
              onClick={needsPassword ? undefined : () => answer(true)}
              disabled={busy || held || (needsPassword && !password)}
            >
              {busy ? "…" : action}
            </button>
          </div>
        </>
      }
    >
      <div className="stack" data-testid={`dapp-${current.kind}`}>
        {queue}
        <Changed change={change} />
        <Site
          origin={current.origin}
          title={current.title}
          session={current.session}
          account={current.session === undefined ? siteAccount : undefined}
        />
        {current.kind === "sign-tx" && (
          <SignTx
            summary={current.summary}
            partial={current.partial}
            session={current.session !== undefined}
            collateralSpent={!!current.collateralSpent}
            ties={current.ties}
            account={current.session === undefined ? siteAccount : undefined}
          />
        )}
        {current.kind === "sign-data" && (
          <SignData
            address={current.address}
            signer={current.key}
            payload={current.payload}
            text={current.text}
            account={current.session === undefined ? siteAccount : undefined}
          />
        )}
      </div>
    </Screen>
  );
}

/**
 * How many requests wait, when more than this one: at the top, where it's
 * seen, not at the end of the line under the title (chunk 23's second review,
 * CW-7), with Decline all.
 */
function Queue({ total, busy, onDeclineAll }: { total: number; busy: boolean; onDeclineAll: () => void }) {
  const tr = useT();
  if (total < 2) return null;
  return (
    <div className="field-row note" data-testid="dapp-queue">
      <span>{tr("dappUi.queue", { total })}</span>
      <button type="button" className="link" onClick={onDeclineAll} disabled={busy}>
        {tr("dappUi.declineAll")}
      </button>
    </div>
  );
}

/** Says the request shown isn't the one before: its buttons wait a moment meanwhile. */
function Changed({ change }: { change?: Change }) {
  const tr = useT();
  if (change === "replaced") {
    return (
      <Callout tone="warn" testId="dapp-changed">
        {tr("dappUi.warn.replaced")}
      </Callout>
    );
  }
  if (change === "next") {
    return (
      <p className="note" data-testid="dapp-changed">
        {tr("dappUi.nextRequest")}
      </p>
    );
  }
  return null;
}

/**
 * Who's asking: the origin, as Chrome reported it. The page's own title is
 * the site's to choose, so it's second. A site connected to a private
 * session says so, and one connected to the public account names it when
 * there's more than one (`account`). Exported for its tests.
 */
export function Site({ origin, title, session, account }: { origin: string; title?: string; session?: number; account?: string }) {
  const tr = useT();
  const host = new URL(origin).host;
  return (
    <div className="dapp-site" data-testid="dapp-origin">
      <span className="dapp-site__icon">
        <GlobeIcon size={18} />
      </span>
      <span className="stack-tight">
        <strong>{host}</strong>
        <span className="note">{title && title !== host ? tr("dappUi.titleAndOrigin", { title, origin }) : origin}</span>
        {session !== undefined && (
          <span className="dapp-site__session" data-testid="dapp-site-session">
            {tr("dappUi.connectedToSession", { number: session + 1 })}
          </span>
        )}
        {session === undefined && account && (
          <span className="dapp-site__session" data-testid="dapp-site-account">
            {tr("dappUi.connectedToAccount", { account })}
          </span>
        )}
      </span>
    </div>
  );
}

type Connection = "public" | "private";

// What each connection lets a site learn (privacy review §2.12): what the
// wallet gives it, and what it can find out anyway, on chain or from the
// browser. Exported for their tests.

/** Under "Your public account". */
export const PUBLIC_PRIVACY = () => t("dappUi.privacy.publicAccount");

/** Under "A private session". */
export const PRIVATE_SESSION_PRIVACY = () => t("dappUi.privacy.privateSession");

/** On a private session's funding, which leaves `changeLovelace` in the private balance. */
export function fundingPrivacy(changeLovelace: string): string {
  if (BigInt(changeLovelace) > 0n) return t("dappUi.privacy.fundingWithChange", { ada: formatAda(changeLovelace) });
  return t("dappUi.privacy.funding");
}

/**
 * A private session's way back, on its funding's review, which the funding's
 * fee alone left out: "A fee each way" gave no figure for it, and "through
 * Lovejoin, as Settings has it" meant nothing to the tester (blind test §9.8,
 * T16). The return's fee as the reviews estimate one (ui/swap.ts), the
 * network fees both ways with this one's exact, and, when Settings brings
 * sessions back through Lovejoin (`lovejoin`), what a 10 ₳ box of it costs
 * (`perBox`, in ₳) and what Lovejoin is, in plain words. `fee`: the
 * funding's. Exported for its test.
 *
 * Through Lovejoin the way back is a chain (sessions.ts backBuild): a deposit,
 * the mixes, then the return, so two network fees besides the mixes', as a
 * swap's and a mix's costs count them (swapCosts, mixCosts); `perBox` is the
 * mixes and the box's own way back.
 */
export function FundingWayBack({ fee, lovejoin, perBox }: { fee: string; lovejoin: boolean; perBox: string }) {
  const tr = useT();
  const back = (lovejoin ? 2n : 1n) * SESSION_FEE_ESTIMATE;
  return (
    <>
      <h2>{tr("dappUi.back.title")}</h2>
      <ReviewRows testId="dapp-funding-back">
        {lovejoin ? (
          <Row label={tr("dappUi.back.fees")} value={tr("dappUi.back.feesValue", { ada: aboutAda(back) })} />
        ) : (
          <Row label={tr("dappUi.back.fee")} value={adaText(toCents(back))} />
        )}
        {lovejoin && <Row label={tr("dappUi.back.lovejoin")} value={tr("dappUi.back.lovejoinValue", { ada: perBox })} />}
        <Row
          label={tr("dappUi.back.bothWays")}
          value={adaText(toCents(BigInt(fee) + back))}
          strong
          testId="dapp-funding-both-ways"
        />
      </ReviewRows>
      <p className="note" data-testid="dapp-funding-way-back">
        {tr(lovejoin ? "dappUi.back.privacy.noteLovejoin" : "dappUi.back.noteDirect")}
      </p>
    </>
  );
}

/**
 * A site asks to connect: to the public account, or to a private session
 * funded here first. Neither is chosen for the user (privacy review §3.3):
 * each says what it costs, and Connect waits for a choice, since what a
 * site sees of the public account can't be taken back. A private session
 * goes from its amount to its funding's review (Send, with the password when
 * it's on), then waits for the network. Exported for its tests.
 */
export function ConnectRequest({
  approval,
  queue,
  busy,
  held,
  change,
  error,
  onError,
  onAnswer,
}: {
  approval: Extract<DappApproval, { kind: "connect" }>;
  /** How many requests wait, when more than this one (`Queue`). */
  queue?: ReactNode;
  busy: boolean;
  /** Its buttons wait: it just took another request's place. */
  held: boolean;
  change?: Change;
  error?: string;
  onError: (error?: string) => void;
  onAnswer: (approve: boolean, extra?: { password?: string; fund?: { txHash: string }; governance?: boolean }) => Promise<Answered>;
}) {
  const tr = useT();
  const network = useNetwork();
  const siteAccount = useSiteAccount();
  const [connection, setConnection] = useState<Connection>();
  // Asked for, governance goes with the public account only when switched on: off, as the most private choice is.
  const [governance, setGovernance] = useState(false);
  const [seedelf, setSeedelf] = useState<Balances["seedelf"]>();
  // How a private session would come back, as Settings has it: through Lovejoin, and what a 10 ₳ box of it costs at
  // Settings' depth, said in plain words with a figure where it's chosen (blind test §9.8, T16).
  const { prefs } = usePreferences();
  const lovejoinBack = prefs.lovejoinReturns && lovejoinOn(network);
  const perBox = aboutAda(boxCost(prefs.lovejoinDepth));
  // The amount's lines about the private balance hide with the balances, as a top-up's do (HM-9).
  const amounts = useAmounts();
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [review, setReview] = useState<SessionOutSummary>();
  const [building, setBuilding] = useState(false);
  const [password, setPassword] = useState("");
  // The funding was refused: Send gives way to building it again, or to where to look if it may have gone (DX-1).
  const [refusal, setRefusal] = useState<Refusal>();

  // Choosing a private session brings its amount into view, and into focus: below the two cards it started under
  // the fold of the 400×605 window, beside a Review that was disabled with no reason (chunk 23's second review,
  // CW-2). Centred, with what follows it in view below.
  const amountField = useRef<HTMLDivElement>(null);
  const [choseSession, setChoseSession] = useState(0);
  useEffect(() => {
    if (!choseSession) return;
    const field = amountField.current;
    field?.querySelector("input")?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "center" });
  }, [choseSession]);

  // Choosing the public account brings Connect into view, the nearest way: its privacy note sits between the cards
  // and the buttons, so it comes too. In Spanish at 400×605 the note filled the window to its bottom edge, with
  // nothing to say Connect was below (the pass-two visual review's second look).
  const actions = useRef<HTMLDivElement>(null);
  const [chosePublic, setChosePublic] = useState(0);
  useEffect(() => {
    if (chosePublic) actions.current?.scrollIntoView({ block: "nearest" });
  }, [chosePublic]);

  // What the private balance holds, for the amount and its tokens: the last reading, no request.
  useEffect(() => {
    if (connection !== "private" || seedelf) return;
    call("balances", {}).then(
      (b) => setSeedelf(b.seedelf),
      (e: Error) => onError(e.message),
    );
  }, [connection, seedelf, onError]);

  const host = new URL(approval.origin).host;
  const site = <Site origin={approval.origin} title={approval.title} />;
  // Over every Decline that turns the site away, so it's read before either it or closing the window: Cancel didn't
  // say it refuses the site, or that the site then waits before it can ask again (blind test §9.2, T17, T17r).
  const declineNote = approval.declineWaitMs !== undefined && (
    <p className="note" data-testid="dapp-decline-note">
      {tr("dappUi.declineNote", { host, wait: waitText(approval.declineWaitMs) })}
    </p>
  );
  // Asking for governance alone, it's connected already: to the dApp account, named as a signature's window names it.
  const connectedSite = <Site origin={approval.origin} title={approval.title} account={siteAccount} />;

  // Sent: it waits for the network, and the site connects once Koios sees the money.
  if (approval.funding) {
    return (
      <Screen
        title={tr("dappUi.fundingTitle")}
        titleId="dapp-title"
        aside={tr("dappUi.forSite", { host })}
        error={error}
      >
        <div className="stack" data-testid="dapp-funding">
          {site}
          <p className="dapp-waiting">
            <span className="spin">
              <SpinnerIcon size={16} />
            </span>
            {tr("dappUi.waitingForFunding", { number: approval.funding.index + 1 })}
          </p>
          <ExplorerLink network={network} tx={approval.funding.txHash} private>
            {tr("dappUi.fundingOnCardanoscan")}
          </ExplorerLink>
          <p className="note">{tr("dappUi.canClose")}</p>
        </div>
      </Screen>
    );
  }

  // Connected already, it asks for governance alone (CIP-95): its account is the dApp account's, as before.
  if (approval.connected) {
    return (
      <Screen
        title={tr("dappUi.governanceTitle")}
        titleId="dapp-title"
        aside={tr("dappUi.nothingUntil", { action: tr("dappUi.allow") })}
        error={error}
        foot={
          <div className="actions">
            {/* Decline, as the signing screens say it: the site stays connected, without governance (blind test T17). */}
            <button type="button" className="secondary" onClick={() => void onAnswer(false)} disabled={busy || held}>
              {tr("dappUi.decline")}
            </button>
            <button type="button" className="primary" onClick={() => void onAnswer(true)} disabled={busy || held}>
              {busy ? "…" : tr("dappUi.allow")}
            </button>
          </div>
        }
      >
        <div className="stack" data-testid="dapp-governance">
          {queue}
          <Changed change={change} />
          {connectedSite}
          <p className="note">{tr("dappUi.governance.asks")}</p>
          <Callout tone="privacy" testId="dapp-governance-privacy">
            {tr("dappUi.privacy.governance")}
          </Callout>
        </div>
      </Screen>
    );
  }

  const tokens = seedelf ? tokenChoices(network, seedelf.tokens, typed) : undefined;
  const withTokens = (tokens?.sent.length ?? 0) > 0;
  const lovelace = lovelaceToSend(amount, withTokens);
  const tooMuch = !!seedelf && !!lovelace && BigInt(lovelace) > BigInt(seedelf.lovelace);
  const canReview = !!seedelf && !!lovelace && !tooMuch && !!tokens?.ok;

  /** Builds the funding to review: from Review, and again, on the next unused account, after a refusal (DX-1). */
  async function buildReview() {
    if (!canReview || building || held) return;
    setBuilding(true);
    onError(undefined);
    try {
      setReview(await call("dapp-private-build", { id: approval.id, lovelace: lovelace!, tokens: tokens!.sent }));
    } catch (err) {
      // Built again after a refusal, and it can't be: back to the amount, where the error says why.
      if (refusal) setReview(undefined);
      onError((err as Error).message);
    } finally {
      // The refusal stays until the new review is in, so its button says it's building meanwhile.
      setRefusal(undefined);
      setBuilding(false);
    }
  }

  function build(e: FormEvent) {
    e.preventDefault();
    void buildReview();
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!review || refusal || busy || (approval.password && !password)) return;
    const sent = await onAnswer(true, { fund: { txHash: review.txHash }, ...(approval.password ? { password } : {}) });
    if (sent === true) return;
    setPassword("");
    if (typeof sent !== "object") return;
    // Its session was recorded before it was sent, so Send can't go again: build it again, or, when it may have
    // gone out all the same, say where to look. A refusal before anything was recorded (a wrong password) is
    // only said, and Send can go again (chunk 23's second review, DX-1).
    const refused = await refusalOf(sent.refused, review.index, review.txHash);
    if (refused) setRefusal(refused);
    else onError(sent.refused.message);
  }

  // The funding, built: what goes where, and Send.
  if (review) {
    const [forSite, collateral] = review.payments;
    return (
      <Screen
        onSubmit={send}
        title={tr("dappUi.reviewFunding")}
        titleId="dapp-title"
        review
        hint={tr("dappUi.ordinaryWallet")}
        hintTestId="dapp-funding-note"
        onBack={() => {
          setReview(undefined);
          setPassword("");
          setRefusal(undefined);
          onError(undefined);
        }}
        backDisabled={busy || building}
        aside={tr("dappUi.fundingAside", { host })}
        error={error}
        foot={
          refusal ? (
            // Refused, its session is used up: Send again only said "That session was started already". The way
            // on is a swap's and a mix's (SessionRefused.tsx), and Decline still says no to the site (DX-1), and says
            // how long that turns it away, as the choice's does (the blind test's cross-area review).
            <>
              <SessionRefusedFoot refusal={refusal} busy={building} onAgain={() => void buildReview()} />
              {declineNote}
              <button type="button" className="secondary" onClick={() => void onAnswer(false)} disabled={busy || building}>
                {tr("dappUi.decline")}
              </button>
            </>
          ) : (
            <>
              {/* In the foot, over Send, as a signature's is (CW-1). */}
              {approval.password && (
                <PasswordField
                  id="dapp-funding-password"
                  label={tr("dappUi.passwordToSend")}
                  value={password}
                  onChange={setPassword}
                />
              )}
              {declineNote}
              <div className="actions">
                <button type="button" className="secondary" onClick={() => void onAnswer(false)} disabled={busy}>
                  {tr("dappUi.decline")}
                </button>
                <button type="submit" className="primary" disabled={busy || (approval.password && !password)}>
                  {busy ? tr("common.sending") : tr("common.send")}
                </button>
              </div>
            </>
          )
        }
      >
        <div className="stack" data-testid="dapp-funding-review">
          <ReviewRows testId="dapp-funding-rows">
            <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: review.index + 1 })} strong />
            <Row label={tr("lovejoin.review.account")} value={shortHex(review.address, 16, 8)} title={review.address} />
            <PaidRows label={tr("dappUi.forTheSite")} paid={forSite} />
            {/* What it's for, not "collateral", a word the wallet uses for three things (chunk 23's second review,
                CW-8). */}
            <Row label={tr("dappUi.keptAside")} value={tr("swaps.review.comesBack", { ada: formatAda(collateral?.lovelace ?? "0") })} />
            <Row label={tr("review.fee")} value={`${formatAda(review.fee.total)}\u00a0₳`} />
            {/* What leaves the private balance and what it holds after, as every other review says them: the change
                (3.766792 ₳ of a 25 ₳ UTxO) didn't match what the tester worked out from 28 ₳ (blind test T16). From
                Home's figure, what's on its way back included: homeBalance takes a side unlocked, as forms get it. */}
            <TotalRows
              side="private"
              leaving={review.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(review.fee.total))}
              before={seedelf && homeBalance(unlocked(seedelf))}
              tokens={forSite?.tokens.length ?? 0}
            />
          </ReviewRows>
          <FundingWayBack fee={review.fee.total} lovejoin={lovejoinBack} perBox={perBox} />
          <TxDetailButton txHash={review.txHash} testId="dapp-funding-tx" />
          <Callout tone="privacy" testId="dapp-funding-privacy">
            {fundingPrivacy(review.changeLovelace)}
          </Callout>
          <HistoriesNote histories={review.histories} session={review.index} testId="dapp-funding-histories" />
          <GivemeNote funding />
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={connection === "private" ? build : undefined}
      title={tr("dappUi.connectTitle")}
      titleId="dapp-title"
      // What each choice means, Decline's too, and where a connection ends: it said only the last (blind test T16).
      hint={tr("dappUi.privacy.connectHint")}
      hintTestId="dapp-disconnect-note"
      aside={
        connection
          ? tr("dappUi.nothingUntil", { action: tr(connection === "private" ? "common.review" : "dappUi.connect") })
          : tr("dappUi.chooseWhatItSees")
      }
      error={error}
      // After the choice and what it gives the site, not kept over them: kept in view at 400×605, Connect could be
      // pressed with the public account's privacy note wholly under it (the pass-two visual review), as Sign could
      // past a signature's (CW-1). Before a choice, the window's short enough for both buttons to show.
      footSticky={false}
      foot={
        <>
          {declineNote}
          <div className="actions" ref={actions}>
            <button
              type="button"
              className="secondary"
              onClick={() => void onAnswer(false)}
              disabled={busy || building || held}
            >
              {tr("dappUi.decline")}
            </button>
            {connection === "private" ? (
              // With no amount yet it says so, rather than a Review that's disabled for no reason given (CW-2).
              <button type="submit" className="primary" disabled={!canReview || building || held}>
                {tr(building ? "common.building" : lovelace ? "common.review" : "dappUi.enterAmount")}
              </button>
            ) : (
              // Only once the public account is chosen: never one press from the window opening.
              <button
                type="button"
                className="primary"
                onClick={() => void onAnswer(true, approval.governance ? { governance } : {})}
                disabled={busy || held || connection !== "public"}
              >
                {busy ? "…" : tr("dappUi.connect")}
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="stack" data-testid="dapp-connect">
        {queue}
        <Changed change={change} />
        {site}
        {/* Which account "your public account" is, before choosing it: said only once it was chosen, below the fold,
            a tester reconnecting with Account 2 on screen was surprised to give Account 1 (blind test T15). */}
        {siteAccount && (
          <p className="note" data-testid="dapp-connect-account">
            {tr("dappUi.public.which", { account: siteAccount })}
          </p>
        )}
        {/* Two cards, what each costs inside it: a pill switch with its explanations in a list apart read as a tab,
            and nothing said a choice was needed (chunk 23's review, CW-3). Still nothing chosen for the user. */}
        <RadioCards<Connection>
          label={tr("dappUi.connectItTo")}
          id="dapp-connection"
          testId="dapp-connect-costs"
          value={connection}
          onChange={(c) => {
            setConnection(c);
            onError(undefined);
            if (c === "private") setChoseSession((n) => n + 1);
            else setChosePublic((n) => n + 1);
          }}
          options={[
            {
              value: "public",
              label: siteAccount ? tr("dappUi.publicAccountNamed", { account: siteAccount }) : tr("dappUi.publicAccount"),
              text: tr("dappUi.cost.public"),
              icon: <WalletIcon size={16} />,
            },
            {
              value: "private",
              label: tr("dappUi.privateSession"),
              text: tr("dappUi.cost.private", { fee: aboutAda(SESSION_FEE_ESTIMATE) }),
              icon: <ShieldIcon size={16} />,
            },
          ]}
        />
        {connection === "public" ? (
          <>
            {/* What the site learns, first, right under the choice that decides it. */}
            <Callout tone="privacy" testId="dapp-connect-privacy">
              {PUBLIC_PRIVACY()}
            </Callout>
            <ul className="dapp-points">
              <li>{tr("dappUi.public.asks")}</li>
            </ul>
            {approval.governance && (
              <>
                <div className="setting-row" data-testid="dapp-governance-switch">
                  <span className="stack-tight">
                    <span id="dapp-governance-label">{tr("dappUi.governance.switch")}</span>
                    <span className="note" id="dapp-governance-note">
                      {tr(governance ? "dappUi.governance.on" : "dappUi.governance.off")}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={governance}
                    aria-labelledby="dapp-governance-label"
                    aria-describedby="dapp-governance-note"
                    onClick={() => setGovernance(!governance)}
                    disabled={busy || held}
                  />
                </div>
                <Callout tone="privacy" testId="dapp-governance-privacy">
                  {tr("dappUi.privacy.governance")}
                </Callout>
              </>
            )}
          </>
        ) : connection === "private" ? (
          <>
            {/* What the site gets is the card's own line: said again here, it was the screen's second "one-time
                account" (the copy-trim pass). */}
            <ul className="dapp-points" data-testid="dapp-private-points">
              <li data-testid="dapp-private-way-back">
                {tr(lovejoinBack ? "dappUi.private.privacy.staysLovejoin" : "dappUi.private.staysDirect", { box: perBox })}
              </li>
              {approval.governance && <li data-testid="dapp-private-no-governance">{tr("dappUi.private.noGovernance")}</li>}
            </ul>
            <div className="field" ref={amountField}>
              <label htmlFor="dapp-private-amount">{tr("dappUi.whatToPutIn")}</label>
              <AdaInput
                id="dapp-private-amount"
                value={amount}
                onChange={setAmount}
                placeholder={withTokens ? tr("sites.topUp.minimum") : "0"}
                autoFocus={false}
              />
              {seedelf && (
                <p className="note" data-testid="dapp-private-held">
                  {tr("dappUi.heldAndCollateral", { ada: amounts.ada(seedelf.lovelace) })}
                </p>
              )}
              {tooMuch && seedelf && (
                <p className="field-note">{tr("sites.topUp.tooMuch", { held: amounts.ada(seedelf.lovelace) })}</p>
              )}
            </div>
            {withTokens && <MinimumHint />}
            {seedelf && <TokenAmounts held={seedelf.tokens} typed={typed} onChange={setTyped} />}
            <Callout tone="privacy" testId="dapp-private-privacy">
              {PRIVATE_SESSION_PRIVACY()}
            </Callout>
          </>
        ) : null}
      </div>
    </Screen>
  );
}

/** What a site's transaction does, as WebAssembly read it: exported for its tests. */
export function SignTx({
  summary: s,
  partial,
  session,
  collateralSpent,
  ties,
  account,
}: {
  summary: DappTxSummary;
  partial: boolean;
  session: boolean;
  collateralSpent: boolean;
  /** The wallet's other accounts it moves money with (independent review M12); undefined when unchecked. */
  ties?: Array<"account" | number>;
  /** The public account it's for, by number and name, when the wallet has more than one (`useSiteAccount`). */
  account?: string;
}) {
  const tr = useT();
  const network = useNetwork();
  const net = BigInt(s.netLovelace);
  // A token's amount without its sign, in its units: the rows say which way it goes.
  const amount = (t: DappToken) => {
    const q = BigInt(t.quantity);
    return formatQuantity((q < 0n ? -q : q).toString(), tokenDecimals(network, t));
  };
  // Tokens named like ADA or a listed token that aren't: each is shown by its fingerprint, and said here too.
  const lookalikes = new Map<string, string>();
  for (const t of [...s.netTokens, ...s.paid.flatMap((p) => p.tokens), ...s.mint]) {
    const posesAs = tokenText(network, t).posesAs;
    if (posesAs) lookalikes.set(`${t.policyId}.${t.assetName}`, posesAs);
  }
  const lookalikeNames = [...new Set(lookalikes.values())].join(tr("histories.list.and"));
  const keys = s.signs.filter((k) => k !== "stake" && k !== "drep").length;
  const stake = s.signs.includes("stake");
  const drep = s.signs.includes("drep");
  const signers = [
    keys ? tr("dappUi.paymentKeys", { count: keys }) : "",
    stake ? tr("dappUi.yourStakeKey") : "",
    drep ? tr("dappUi.yourDrepKey") : "",
  ]
    .filter(Boolean)
    .join(tr("histories.list.and"));
  const whose = tr(session ? "dappUi.whose.warn.session" : "dappUi.whose.warn.account");
  const staking = BigInt(s.stakingLovelace);
  const back = stakingComesBack(s);
  const ownKey = s.paid.filter((p) => p.ownPaymentKey).length;

  const notes: ReactNode[] = [];
  if (s.scripts) notes.push(tr("dappUi.note.scripts"));
  if (s.referenceInputs) notes.push(tr("dappUi.note.reads", { count: s.referenceInputs }));
  if (s.votes && s.votes > (s.ownVotes ?? 0)) notes.push(tr("dappUi.note.votes", { count: s.votes - (s.ownVotes ?? 0) }));
  if (s.proposals) notes.push(tr("dappUi.note.proposals", { count: s.proposals }));
  if (s.donation) notes.push(tr("dappUi.note.donates", { ada: formatAda(s.donation) }));
  if (s.metadata && !s.note) notes.push(tr("dappUi.note.metadata"));

  // What leaves the account, or comes into it, all told: "sends, net" read as jargon (chunk 23's second review,
  // CW-7). It's the wallet's own reviews' "Total leaving", and names the account where there's more than one (CW-5).
  const total = session
    ? tr(net < 0n ? "dappUi.net.sessionSends" : "dappUi.net.sessionGets")
    : account
      ? tr(net < 0n ? "dappUi.net.namedSends" : "dappUi.net.namedGets", { account })
      : tr(net < 0n ? "dappUi.net.accountSends" : "dappUi.net.accountGets");

  return (
    <>
      <ReviewRows testId="dapp-tx-net">
        <Row label={total} value={`${formatAda((net < 0n ? -net : net).toString())}\u00a0₳`} strong />
        {s.netTokens.map((t) => (
          <TokenAmountRow
            key={`${t.policyId}.${t.assetName}`}
            label={tr(BigInt(t.quantity) < 0n ? "dappUi.sends" : "dappUi.gets")}
            token={t}
            amount={amount(t)}
          />
        ))}
        {/* Rewards and a deposit back are the account's money too: counted above, and said so. */}
        {staking > 0n && (
          <Row label={tr("dappUi.fromStaking")} value={tr("dappUi.included", { ada: formatAda(s.stakingLovelace) })} />
        )}
        <Row
          label={tr("review.fee")}
          value={s.ownInputs ? tr("dappUi.included", { ada: formatAda(s.fee) }) : `${formatAda(s.fee)}\u00a0₳`}
        />
        {s.collateral && s.collateral.own > 0 && (
          <Row label={tr("swaps.tx.collateralAtRisk")} value={`${formatAda(s.collateral.atRisk)}\u00a0₳`} />
        )}
        <Row label={tr("dappUi.signsWith")} value={signers} />
      </ReviewRows>

      {s.paid.length > 0 && (
        <section className="section" aria-labelledby="dapp-paid-title">
          <h2 id="dapp-paid-title">{tr("dappUi.pays")}</h2>
          <ul className="list" data-testid="dapp-paid">
            {s.paid.map((p, i) => (
              // The whole address on its own line: shortened, a lookalike's could read the same.
              <li key={i} className="list__row dapp-paid">
                <span className="dapp-address" data-value={p.address}>
                  {p.address}
                </span>
                <span className="note">{paidTo(p)}</span>
                <span className="dapp-amount">
                  {formatAda(p.lovelace)}{"\u00a0₳"}
                  {p.tokens.map((t) => (
                    <span key={`${t.policyId}.${t.assetName}`} className="note">
                      <TokenAmountText token={t} amount={amount(t)} />
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lookalikes.size > 0 && (
        <Callout tone="warn" testId="dapp-lookalike">
          {joinSentences([
            tr(lookalikes.size === 1 ? "dappUi.warn.lookalike" : "dappUi.warn.lookalikes", { names: lookalikeNames }),
            tr("dappUi.warn.anyName"),
          ])}
        </Callout>
      )}
      {/* Which outputs, the Pays list says each: one sentence, not a count. */}
      {ownKey > 0 && (
        <Callout tone="warn" testId="dapp-own-key">
          {tr("dappUi.warn.ownKey")}
        </Callout>
      )}
      {s.paid.some((p) => p.seedelf === "none") && (
        <Callout tone="warn" testId="dapp-seedelf-unsafe">
          {tr("dappUi.warn.noRegister")}
        </Callout>
      )}
      {s.paid.some((p) => p.seedelf === "register") && (
        <Callout tone="privacy" testId="dapp-seedelf-payment">
          {tr(session ? "dappUi.privacy.paysSeedelfSession" : "dappUi.privacy.paysSeedelfAccount")}
        </Callout>
      )}
      {ties && ties.length > 0 && (
        <Callout tone="warn" testId="dapp-ties">
          {tiesLine(ties, session)}
        </Callout>
      )}

      {s.mint.length > 0 && (
        <ReviewRows testId="dapp-mint">
          {s.mint.map((t) => (
            <TokenAmountRow
              key={`${t.policyId}.${t.assetName}`}
              label={tr(BigInt(t.quantity) < 0n ? "dappUi.burns" : "dappUi.mints")}
              token={t}
              amount={amount(t)}
            />
          ))}
        </ReviewRows>
      )}

      {(s.certificates.length > 0 || s.withdrawals.length > 0) && (
        <Callout
          tone={s.certificates.some((c) => c.own) || (staking > 0n && !back) ? "warn" : "info"}
          testId="dapp-staking"
        >
          <ul className="dapp-points">
            {s.certificates.map((c, i) => (
              <li key={i}>{certificateLine(c, back, whose)}</li>
            ))}
            {s.withdrawals.map((w, i) => (
              <li key={`w${i}`}>{withdrawalLine(w, back, whose)}</li>
            ))}
          </ul>
        </Callout>
      )}

      {(s.ownVotes ?? 0) > 0 && (
        <Callout tone="privacy" testId="dapp-own-votes">
          {tr("dappUi.privacy.ownVotes", { count: s.ownVotes })}
        </Callout>
      )}
      {/* Each of those votes, which action and which way, before Sign (the owner's call, 2026-10-06). */}
      {(s.ownBallots ?? []).length > 0 && (
        <ul className="list" data-testid="dapp-own-ballots">
          {s.ownBallots!.map((b) => (
            <li key={`${b.txHash}#${b.index}`}>
              {tr(b.vote === "yes" ? "dappUi.privacy.ballot.yes" : b.vote === "no" ? "dappUi.privacy.ballot.no" : "dappUi.privacy.ballot.abstain", {
                action: `${shortHex(b.txHash, 8, 4)}#${b.index}`,
              })}
            </li>
          ))}
        </ul>
      )}

      {collateralSpent && (
        <Callout tone="warn" testId="dapp-collateral-spent">
          {tr("dappUi.warn.collateralSpent")}
        </Callout>
      )}
      {s.collateral && s.collateral.own > 0 && (
        <p className="note" data-testid="dapp-collateral">
          {tr("dappUi.collateralNote", { ada: formatAda(s.collateral.atRisk) })}
        </p>
      )}

      {s.note && (
        <div className="stack-tight">
          <span className="note">{tr("dappUi.itsNote")}</span>
          <pre className="dapp-message" data-testid="dapp-note">
            {s.note.join("\n")}
          </pre>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="dapp-points note" data-testid="dapp-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {partial && !s.complete && (
        <Callout tone="info" testId="dapp-partial">
          {tr("dappUi.partial")}
        </Callout>
      )}
      {s.unknownInputs.length > 0 && (
        <Callout tone="warn" testId="dapp-unknown">
          {tr("dappUi.warn.unknownInputs", { count: s.unknownInputs.length })}
        </Callout>
      )}

      <Callout tone="privacy" testId="dapp-tx-privacy">
        {signingTies(
          ties,
          session,
          s.paid.some((p) => p.seedelf === "register"),
        )}
      </Callout>
      {/* The site built these bytes, not the wallet: this is where reading them matters most. It asks the worker
          for them while the request waits. Last in the request, before the password, as a review's comes before its
          button: after Sign, it saved Sign 40 px of scrolling but sat apart from every other review's (the pass-two
          visual review), and under Pays it would push the privacy note back across the fold (blind test T18). */}
      <TxDetailButton txHash={s.txHash} testId="dapp-tx" site />
    </>
  );
}

/** What a site asks the account's key to sign (CIP-8): exported for its tests. */
export function SignData({
  address,
  signer,
  payload,
  text,
  account,
}: {
  address: string;
  signer: "payment" | "stake" | "drep";
  payload: string;
  text?: string;
  /** The public account it signs for, by number and name, when the wallet has more than one (`useSiteAccount`). */
  account?: string;
}) {
  const tr = useT();
  // Which account signs, where there's more than one: "Your address" could be any of them, and the window can't
  // change which (chunk 23's second review, CW-5).
  const key = account
    ? tr(
        signer === "stake" ? "dappUi.signer.stake" : signer === "drep" ? "dappUi.signer.drep" : "dappUi.signer.payment",
        { account },
      )
    : tr(signer === "stake" ? "dappUi.stakeKey" : signer === "drep" ? "dappUi.drepKey" : "dappUi.paymentKey");
  return (
    <>
      <ReviewRows testId="dapp-data">
        <Row label={tr("dappUi.with")} value={key} />
      </ReviewRows>
      {/* The whole address on its own line, as the Pays rows show it: shortened, a lookalike's could read the same. */}
      <div className="stack-tight">
        <span className="note">{tr(signer === "drep" ? "dappUi.forTheDrep" : "dappUi.forTheAddress")}</span>
        <span className="dapp-address" data-testid="dapp-data-address" data-value={address}>
          {address}
        </span>
      </div>
      <div className="stack-tight">
        <span className="note">{tr(text === undefined ? "dappUi.dataHex" : "dappUi.theMessage")}</span>
        <pre className="dapp-message" data-testid="dapp-data-message">
          {text ?? payload}
        </pre>
      </div>
      <Callout tone="info" testId="dapp-data-note">
        {tr("dappUi.signDataNote")}
      </Callout>
    </>
  );
}
