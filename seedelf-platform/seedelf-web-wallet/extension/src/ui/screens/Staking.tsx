// Staking, from the Cardano tab's staking row, after Lace's staking page: the
// pool the Cardano account stakes with (and why it may earn less), the
// rewards with Withdraw, where the voting power goes, Change pool and Stop
// staking, and the account as its own DRep (Governance.tsx). Choosing a pool
// opens the browser (Pools.tsx); the vote, Voting.tsx. Every change is built
// and signed by the worker and reviewed here: nothing is sent until the user
// presses the review's button, which names the act. Opening the page reads
// the pool's details and the account's DRep, fresh: two requests, or three
// (the DRep deposit, or its profile's check).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { type I18nKey, t, useT } from "../../i18n";

import {
  ALWAYS_NO_CONFIDENCE,
  type Balances,
  type GovAction,
  type GovernanceView,
  type GovVote,
  type OwnDrep,
  type PendingTx,
  type PoolDetails,
  type PoolRef,
  type StakeInfo,
  type StakingAction,
  type StakingSummary,
} from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ChevronRightIcon, PieIcon } from "../components/Icons";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import { ReviewRows, Row } from "../components/ReviewRows";
import { AfterRow } from "../components/ReviewTotals";
import { Hint, Hinted } from "../components/Hint";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { formatAda, formatPercent, poolLabel, rewardsLocked, shortId, unlocked, voteLabel } from "../format";
import { useNetwork } from "../network";
import { useAmounts, usePreferences } from "../preferences";
import {
  BecomeDrep,
  DrepCard,
  type DrepFormView,
  DrepProfileEdit,
  forgetUnlisted,
  GovActions,
  rememberVote,
  shortAction,
  useActionType,
  useVoteLabel,
  votesOut,
} from "./Governance";
import { NEW_POOLS_VIEW, Pools, SharedTicker, type PoolsView } from "./Pools";
import { sharedDrepName, Voting, type VoteView } from "./Voting";

/** What a review shows besides the summary: the pool's or DRep's name, and how many others share it. */
interface Chosen {
  /** The pool, with its details when it was picked from the browser: its warnings go on the review too. */
  pool?: PoolRef | PoolDetails;
  /** Staking with another pool, not a first one: rewards don't stop meanwhile (chunk 23's second review, ST-7). */
  switching?: boolean;
  drepName?: string;
  /** Live pools using the pool's ticker, or DReps using the DRep's name (Voting.tsx `drepSharing`). */
  shared?: number;
  /** The list has the DRep under that name; when it doesn't, `shared` counts it too. */
  drepListed?: boolean;
  /** The DRep picked hasn't voted lately: its warning stays on the review (GV-5). */
  drepInactive?: boolean;
  /** A vote's governance action, and the DRep's vote on it before, if any. */
  govAction?: GovAction;
  before?: GovVote;
}

/**
 * The control a build was started from. Only it says it's preparing, and
 * nothing else changes its label: "Building…" used to show on Withdraw
 * rewards, off-screen, whichever row was pressed (chunk 23's second review,
 * ST-1). `review` is a screen's own foot button.
 */
export type Building = "withdraw" | "stop" | "retire" | "delegate-own" | "review" | "remove-profile" | GovVote;

type Page = "overview" | "pools" | "vote" | "drep-register" | "drep-profile" | "governance";

/** What the stake key's first registration locks up: `key_deposit`, 2 ₳ on both networks. */
export const KEY_DEPOSIT = 2_000_000n;

/**
 * What a transaction from the account needs beyond what it locks up, at the
 * least: its fee (about 0.2 ₳ for staking's) and change of at least the
 * ledger's smallest output (about 1 ₳). A floor for a check made before the
 * build, never the build's own sum.
 */
export const ROOM = 1_000_000n;

/** What becoming a DRep needs the account to hold, at the least: its deposit, the stake key's when it goes too, and room. */
export function drepNeeds(depositNow: string, delegate: boolean, registered: boolean): bigint {
  return BigInt(depositNow) + (delegate && !registered ? KEY_DEPOSIT : 0n) + ROOM;
}

/**
 * Why nothing on the page can be built, when the account holds no ADA it can
 * spend: rewards can't pay a fee on their own, since a transaction must spend
 * at least one of the account's UTxOs (ST-9). Checked on what Home read, so a
 * withdrawal no longer fails after a 10 s build. Named `.warn.`: a warning
 * shows it.
 */
export function noFundsReason(account?: Pick<Balances["cardano"], "utxos" | "locked">): string | undefined {
  if (!account || account.utxos - account.locked.utxos > 0) return undefined;
  return account.utxos > 0 ? t("staking.warn.allLocked") : t("staking.warn.noFee");
}

export function Staking({
  staking,
  spendRewards,
  blocked,
  start = "overview",
  total,
  account,
  onReceive,
  onMakePublic,
  onBack,
  onSent,
  onPending,
}: {
  staking: StakeInfo;
  /** All the account holds, as Home shows it (locked UTxOs and rewards in): a review's balance after. */
  total?: string;
  /** Whether a payment from the account spends the rewards too: Settings' preference, which the rewards' switch sets too. */
  spendRewards: boolean;
  /** Why nothing can be sent now: a transaction is on its way. */
  blocked?: string;
  /** Home's locked-rewards warning opens the vote directly. */
  start?: Page;
  /** The account as Home read it, for what can be checked before a build: what it can spend, and lock up. */
  account?: Balances["cardano"];
  /** The way on when the account has nothing to pay a fee with: Receive, and Make public when there's private money. */
  onReceive?: () => void;
  onMakePublic?: () => void;
  onBack: () => void;
  onSent: (pending: PendingTx) => void;
  /**
   * A vote sent from a governance action: Home watches it, and this page stays
   * on the action (GV-6). Without it, a vote goes to Home as everything else.
   */
  onPending?: (pending: PendingTx) => void;
}) {
  const t = useT();
  const network = useNetwork();
  const { active } = useAccounts();
  const amounts = useAmounts();
  const { loaded: prefsRead, set: setPrefs } = usePreferences();
  // Said under the rewards' switch, as Settings says it under its own, and apart from a build's error.
  const [rewardsError, setRewardsError] = useState<string>();
  const [page, setPage] = useState<Page>(start);
  const [pool, setPool] = useState<PoolDetails>();
  const [poolError, setPoolError] = useState<string>();
  const [review, setReview] = useState<{ summary: StakingSummary } & Chosen>();
  const [building, setBuilding] = useState<Building>();
  const [sending, setSending] = useState(false);
  const busy = building !== undefined || sending;
  const [error, setError] = useState<string>();
  const [drep, setDrep] = useState<OwnDrep>();
  const [drepError, setDrepError] = useState<string>();
  // Governance actions as last read, and the one open: kept here, so a vote's review doesn't lose them.
  const [govView, setGovView] = useState<GovernanceView>();
  const [govOpen, setGovOpen] = useState<GovAction>();
  // The vote just sent from the open action, said on it while it's on its way (GV-6).
  const [voteSent, setVoteSent] = useState<{ id: string; vote: GovVote }>();
  // The pool browser's, Voting power's and the DRep forms' choices, kept here so Back from a review returns to them
  // (ST-11, release review C15).
  const [poolsView, setPoolsView] = useState<PoolsView>(NEW_POOLS_VIEW);
  const [voteView, setVoteView] = useState<VoteView>();
  const [drepView, setDrepView] = useState<DrepFormView>();
  // The page Become a DRep was opened from, which its Back returns to: it went to the overview, losing Voting power's
  // pick or the action open (release review C42).
  const [becomeFrom, setBecomeFrom] = useState<Page>("overview");

  // The pool's details, fresh each time the page opens, and again on Try again.
  const poolId = staking.pool?.id;
  const readPool = () => {
    if (!poolId) return;
    setPoolError(undefined);
    call("pool", { id: poolId }).then(setPool, (e: Error) => setPoolError(e.message));
  };
  useEffect(readPool, [poolId]);

  // The account's own DRep, fresh too.
  const readDrep = () => {
    setDrepError(undefined);
    call("drep-own", {}).then(setDrep, (e: Error) => setDrepError(e.message));
  };
  useEffect(readDrep, []);
  const ownDrepName = drep && staking.drep === drep.id ? t("drep.yourOwn") : undefined;

  // Why nothing can be built: a transaction on its way, or nothing in the account to pay a fee with.
  const free = account && unlocked(account);
  const noFunds = noFundsReason(account);
  const why = blocked ?? noFunds;

  // A vote sent from an action is on its way while Home watches it. Once the watch ends (confirmed, dropped, or after
  // 10 minutes), the actions are read again, and the vote stays on its way until they are: the list read before it
  // then said "Not voted", with the same vote's button live again (GV-6, release review C16).
  const watched = useRef(blocked !== undefined);
  const readAgain = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [voteLanding, setVoteLanding] = useState(false);
  const showGov = (view: GovernanceView) => {
    setGovView(view);
    setVoteLanding(false);
  };
  // Nothing is asked again once the page is gone.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(readAgain.current);
    };
  }, []);
  useEffect(() => {
    const ended = watched.current && blocked === undefined;
    watched.current = blocked !== undefined;
    if (!ended || !govView || !votesOut(network, active, govView.votes)) return;
    setVoteLanding(true);
    // Not listed yet, or not read, it's asked once more 20 s later: Koios answers from several servers, and the one
    // asked can be a block behind the one that saw it confirmed. Then the list says where it stands, and a vote it
    // still doesn't show isn't said to be on its way any more. Failed twice, it is, until the list's Refresh.
    const later = () => {
      if (alive.current) readAgain.current = setTimeout(() => read(true), 20_000);
    };
    const read = (last: boolean): void => {
      call("governance", {}).then(
        (view) => {
          if (!last && votesOut(network, active, view.votes)) return later();
          if (last) forgetUnlisted(network, active, view.votes);
          showGov(view);
        },
        () => (last ? undefined : later()),
      );
    };
    read(false);
  }, [blocked]);

  async function build(action: StakingAction, chosen: Chosen = {}, from: Building = "review") {
    if (busy) return;
    setBuilding(from);
    setError(undefined);
    try {
      setReview({ summary: await call("stake-build", { action }), ...chosen });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(undefined);
    }
  }

  async function send() {
    if (!review || busy) return;
    setSending(true);
    setError(undefined);
    try {
      const pending = await call("stake-submit", { txHash: review.summary.txHash });
      const { action } = review.summary;
      // A vote stays on its action, which says it's on its way: a DRep votes in batches, and went back to it
      // through five screens for each (GV-6). Home watches it all the same.
      if (action.kind === "drep-vote" && review.govAction && onPending) {
        for (const ballot of action.votes) rememberVote(network, active, review.govAction.id, ballot.vote);
        setVoteSent({ id: review.govAction.id, vote: action.votes[0]!.vote });
        setReview(undefined);
        setSending(false);
        onPending(pending);
        return;
      }
      onSent(pending);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  // Settings' "Use staking rewards when spending", from the rewards it decides about.
  async function toggleSpendRewards() {
    try {
      await setPrefs({ spendRewards: !spendRewards });
      setRewardsError(undefined);
    } catch (e) {
      setRewardsError((e as Error).message);
    }
  }

  // Leaving a page for the overview starts its choices afresh; Back from a review keeps them.
  const back = (to: Page) => () => {
    setError(undefined);
    if (to === "overview") {
      setPoolsView(NEW_POOLS_VIEW);
      setVoteView(undefined);
      setVoteSent(undefined);
      setDrepView(undefined);
    }
    setPage(to);
  };
  // Become a DRep, from `from`, where its Back returns.
  const become = (from: Page) => () => {
    setBecomeFrom(from);
    back("drep-register")();
  };
  // Leaving a DRep form starts it afresh, wherever Back goes.
  const leaveDrepForm = (to: Page) => () => {
    setDrepView(undefined);
    back(to)();
  };
  // Become a DRep from Governance actions after the page's own read of the DRep failed: the one the actions read
  // will do. It opened the overview instead, unexplained (release review C42). Its deposit shows as unknown; the
  // review gives it.
  const becomeAs = drep ?? govView?.drep;

  if (review) {
    return (
      <StakingReview
        {...review}
        total={total}
        busy={busy}
        error={error}
        onBack={() => {
          setReview(undefined);
          setError(undefined);
        }}
        onSend={send}
      />
    );
  }
  if (page === "pools") {
    return (
      <Pools
        current={poolId}
        registered={staking.registered}
        blocked={why}
        busy={busy}
        error={error}
        view={poolsView}
        onView={setPoolsView}
        onBack={back("overview")}
        onStake={(p, shared) => {
          setPoolsView((v) => ({ ...v, details: p }));
          void build({ kind: "delegate", pool: p.id }, { pool: p, shared, switching: !!staking.pool });
        }}
      />
    );
  }
  if (page === "drep-register" && becomeAs) {
    return (
      <BecomeDrep
        drep={becomeAs}
        staking={staking}
        spendable={free?.lovelace}
        blocked={why}
        busy={busy}
        error={error}
        view={drepView}
        onView={setDrepView}
        onBack={leaveDrepForm(becomeFrom)}
        onReview={(delegate, anchor) => void build({ kind: "drep-register", delegate, ...(anchor ? { anchor } : {}) })}
      />
    );
  }
  if (page === "drep-profile" && drep) {
    return (
      <DrepProfileEdit
        drep={drep}
        blocked={why}
        building={building}
        error={error}
        view={drepView}
        onView={setDrepView}
        onBack={leaveDrepForm("overview")}
        onReview={(anchor) =>
          void build({ kind: "drep-update", ...(anchor ? { anchor } : {}) }, {}, anchor ? "review" : "remove-profile")
        }
      />
    );
  }
  if (page === "governance") {
    return (
      <GovActions
        building={building}
        blocked={why}
        waiting={blocked !== undefined || voteLanding}
        sent={voteSent}
        error={error}
        onBack={back("overview")}
        onBecome={become("governance")}
        view={govView}
        onView={showGov}
        open={govOpen}
        onOpen={(action) => {
          setGovOpen(action);
          setVoteSent(undefined);
        }}
        onVote={(action, vote, before) =>
          void build(
            { kind: "drep-vote", votes: [{ txHash: action.txHash, index: action.index, vote }] },
            { govAction: action, ...(before ? { before } : {}) },
            vote,
          )
        }
      />
    );
  }
  if (page === "vote") {
    return (
      <Voting
        current={staking.drep}
        registered={staking.registered}
        blocked={why}
        busy={busy}
        error={error}
        view={voteView}
        onView={setVoteView}
        onBack={back("overview")}
        onVote={(drep, drepName, shared, inactive) =>
          void build(
            { kind: "vote", drep },
            { drepName, shared: shared?.shared, drepListed: shared?.listed, drepInactive: inactive },
          )
        }
        own={drep}
        ownError={drepError}
        onBecome={become("vote")}
      />
    );
  }

  const locked = rewardsLocked(staking);
  const rewards = BigInt(staking.rewards);
  const withdrawTitle = why ?? (locked ? t("staking.delegateFirst") : rewards === 0n ? t("staking.noRewards") : undefined);
  return (
    <Screen title={t("staking.pageTitle")} titleId="staking-title" onBack={onBack} backDisabled={busy} error={error}>
      {/* Why the buttons below can't be pressed, said once at the top: they only had a tooltip (HM-3, ST-9). */}
      {blocked ? (
        <p className="note" role="status" data-testid="staking-blocked">
          {blocked}
        </p>
      ) : (
        noFunds && (
          <Callout tone="warn" testId="staking-no-fee">
            <div className="stack-tight">
              <span>{noFunds}</span>
              {free && account && free.utxos === 0 && account.utxos === 0 && (onReceive || onMakePublic) && (
                <div className="actions">
                  {onReceive && (
                    <button type="button" className="secondary primary--compact" onClick={onReceive}>
                      {t("home.action.receive")}
                    </button>
                  )}
                  {onMakePublic && (
                    <button type="button" className="secondary primary--compact" onClick={onMakePublic}>
                      {t("home.action.makePublic")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </Callout>
        )
      )}

      {staking.pool ? (
        <section className="section" aria-labelledby="pool-title">
          <h2 id="pool-title">{t("staking.yourPool")}</h2>
          {/* The status first, what the operator's figures mean after it, folded (ST-7). */}
          <PoolFacts
            pool={pool ?? staking.pool}
            error={pool ? undefined : poolError}
            onRetry={readPool}
            testId="your-pool"
            folded
          >
            <p className="note" data-testid="staking-status">
              {t("staking.status.spendable")}
            </p>
          </PoolFacts>
          <button type="button" className="secondary" onClick={() => setPage("pools")} disabled={!!why || busy} title={why}>
            {t("staking.changePool")}
          </button>
        </section>
      ) : (
        <section className="section" aria-labelledby="pool-title">
          <Hinted text={t("staking.note")} testId="staking-note">
            <h2 id="pool-title">{t("home.staking.not")}</h2>
          </Hinted>
          {!staking.registered && <p className="note">{t("staking.depositNote")}</p>}
          <button type="button" className="primary" onClick={() => setPage("pools")} disabled={!!why || busy} title={why}>
            {t("staking.choosePool")}
          </button>
        </section>
      )}

      {staking.registered && (
        <section className="section" aria-labelledby="rewards-title">
          <h2 id="rewards-title">{t("staking.rewards")}</h2>
          <p className="amount amount--small" data-testid="staking-rewards">
            {amounts.ada(staking.rewards)}
            <span className="amount__unit">{"\u00a0₳"}</span>
          </p>
          {/* Settings' own switch, here too, in Settings' words: the note named it "in Settings" with no way there,
              and going there closes this page (blind test §9.9, E04). Then when withdrawing by hand matters: with it
              on, payments take the rewards along, so only a site, which counts the balance without them, needs it.
              Locked, the warning under the vote says what's true instead. */}
          {!locked && (
            <>
              <div className="setting-row">
                <span className="stack-tight">
                  <span id="staking-spend-rewards-label">{t("settings.staking.useRewards")}</span>
                  <span className="note" id="staking-spend-rewards-note">
                    {t(spendRewards ? "settings.staking.rewardsSpend" : "settings.staking.rewardsWait")}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={spendRewards}
                  aria-labelledby="staking-spend-rewards-label"
                  aria-describedby="staking-spend-rewards-note"
                  onClick={() => void toggleSpendRewards()}
                  disabled={!prefsRead}
                />
              </div>
              {rewardsError && (
                <p className="error" role="alert">
                  {rewardsError}
                </p>
              )}
              <p className="note" data-testid="staking-rewards-note">
                {t(spendRewards ? "staking.rewardsSpent" : "staking.rewardsWait")}
              </p>
            </>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => void build({ kind: "withdraw" }, {}, "withdraw")}
            disabled={!!withdrawTitle || busy}
            title={withdrawTitle}
          >
            {building === "withdraw" ? t("staking.building.withdraw") : t("staking.withdraw")}
          </button>
        </section>
      )}

      <section className="section" aria-labelledby="vote-title">
        <Hinted text={t("staking.voteNote")} testId="staking-vote-note">
          <h2 id="vote-title">{t("activity.row.votingPower")}</h2>
        </Hinted>
        <ReviewRows testId="vote-now">
          <Row label={t("staking.delegatedTo")} value={voteLabel(staking.drep, ownDrepName)} title={staking.drep ?? undefined} strong />
        </ReviewRows>
        {locked && (
          <Callout tone="warn" testId="rewards-locked">
            {t("staking.warn.rewardsLocked", { amount: amounts.ada(staking.rewards) })}
          </Callout>
        )}
        <button type="button" className="secondary" onClick={() => setPage("vote")} disabled={!!why || busy} title={why}>
          {t(staking.drep ? "staking.change" : "staking.delegate")}
        </button>
      </section>

      <DrepCard
        drep={drep}
        error={drepError}
        onRetry={readDrep}
        staking={staking}
        blocked={why}
        building={building}
        onBecome={become("overview")}
        onActions={back("governance")}
        onProfile={back("drep-profile")}
        onRetire={() => void build({ kind: "drep-retire" }, {}, "retire")}
        onDelegateOwn={() =>
          drep && void build({ kind: "vote", drep: drep.id }, { drepName: t("drep.yourOwn") }, "delegate-own")
        }
      />

      {staking.registered && (
        <ul className="list">
          <li>
            {/* Red, as Remove wallet's row is, and its review ends on a red "Stop staking" over what ends and
                what's lost: it looked like any other row (chunk 23's second review, ST-3, V-3). The bin stays
                Remove's: stopping deletes nothing, and gives the deposit back. */}
            <button
              type="button"
              className="menu-row menu-row--danger"
              onClick={() => void build({ kind: "stop" }, {}, "stop")}
              disabled={locked || !!why || busy}
              title={why ?? (locked ? t("staking.delegateFirstStop") : undefined)}
            >
              <span className="menu-row__icon">
                <PieIcon size={16} />
              </span>
              <span>{building === "stop" ? t("staking.building.stop") : t("staking.stop")}</span>
              <ChevronRightIcon size={16} />
            </button>
          </li>
        </ul>
      )}

      {/* One note for the page: it holds the DRep card's, that private money carries no voting power, which said
          the same beside it (ST-7). */}
      <Callout tone="privacy">{t("staking.privacy.public")}</Callout>
    </Screen>
  );
}

/** A pool's saturation as both the list and a pool's page show it: to one place (ST-12). */
export const formatSaturation = (saturation: number) => formatPercent(Math.round(saturation * 10) / 10);

/**
 * A read that failed, in plain words, with the service's own under Details
 * and Try again: the error was grey text naming an endpoint, with no way on
 * (chunk 23's second review, ST-10).
 */
export function ReadFailed({
  what,
  detail,
  onRetry,
  testId,
}: {
  what?: string;
  detail: string;
  onRetry?: () => void;
  testId?: string;
}) {
  const t = useT();
  return (
    <div className="stack-tight" data-testid={testId}>
      {/* Without `what`, the caller says it, in a warning of its own. */}
      {what && <p className="note">{what}</p>}
      <details className="disclosure">
        <summary>{t("common.details")}</summary>
        <p className="note">{detail}</p>
      </details>
      {onRetry && (
        <button type="button" className="secondary primary--compact align-center" onClick={onRetry}>
          {t("common.tryAgain")}
        </button>
      )}
    </div>
  );
}

/** A pool's figures, and why it may earn its delegators less. */
export function PoolFacts({
  pool,
  error,
  onRetry,
  testId,
  named = true,
  folded = false,
  children,
}: {
  pool: PoolRef | PoolDetails;
  error?: string;
  onRetry?: () => void;
  testId: string;
  /** Whether to say which pool: not when the screen's title does. */
  named?: boolean;
  /** The figures under "Pool details", for the Staking page, which leads with where the account stands (ST-7). */
  folded?: boolean;
  /** Said after the name, before the warnings. */
  children?: ReactNode;
}) {
  const t = useT();
  const details = "margin" in pool ? pool : undefined;
  const warnings = details ? poolWarnings(details) : [];
  const facts = details && (
    <>
      <ReviewRows testId={`${testId}-facts`}>
        <Row label={t("pool.saturation")} value={formatSaturation(details.saturation)} />
        <Row label={t("pool.margin")} value={formatPercent(details.margin * 100)} />
        <Row label={t("pool.cost")} value={`${formatAda(details.cost)}\u00a0₳`} />
        <Row label={t("pool.pledge")} value={`${formatAda(details.pledge)}\u00a0₳`} />
        <Row label={t("pool.delegators")} value={details.delegators.toLocaleString("en-US")} />
        <Row label={t("pool.blocks")} value={details.blocks.toLocaleString("en-US")} />
      </ReviewRows>
      {/* What each figure means, behind the icon (chunk 23's review, ST-3). */}
      <Hint text={t("pool.factsHint")} testId={`${testId}-facts-note`} />
    </>
  );
  return (
    <div className="stack-tight" data-testid={testId}>
      {named && (
        <>
          <p className="pool-name">
            <strong>{poolLabel(pool)}</strong>
            {pool.ticker && pool.name && <span className="note"> · {pool.name}</span>}
          </p>
          {/* A ticker is the pool's own to choose: its ID is what it is. A line of its own, cut in the middle as
              the card narrows: inline, it ran past the card at 360 px (ST-4). */}
          {(pool.ticker || pool.name) && <MiddleEllipsis text={pool.id} testId={`${testId}-id`} />}
        </>
      )}
      {children}
      {warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
        </Callout>
      ))}
      {!details ? (
        error ? (
          <ReadFailed what={t("pool.readFailed")} detail={error} onRetry={onRetry} testId={`${testId}-failed`} />
        ) : (
          <p className="note">{t("pool.reading")}</p>
        )
      ) : folded ? (
        <details className="disclosure" data-testid={`${testId}-details`}>
          <summary>{t("staking.poolDetails")}</summary>
          <div className="stack-tight">{facts}</div>
        </details>
      ) : (
        facts
      )}
    </div>
  );
}

/**
 * How far past saturation a pool is, in numbers (ST-8): `times` its
 * saturation point, and the `share` of a full reward each delegator then
 * gets. A pool's rewards stop growing at saturation, so everyone staked with
 * it shares what a saturated pool earns: each ADA earns about 100/saturation
 * of what it would.
 */
export function oversaturation(saturation: number): { times: string; share: string } {
  return {
    times: (Math.round(saturation / 10) / 10).toFixed(1),
    share: formatPercent(Math.round(10_000 / saturation)),
  };
}

/** Why a pool pays its delegators less, or will stop: Lace's warnings. */
export function poolWarnings(p: PoolDetails): string[] {
  const warnings: string[] = [];
  if (p.status === "retired") warnings.push(t("pool.warn.retired"));
  if (p.status === "retiring") {
    // An epoch unknown is its own sentence: "soon" put where the epoch goes read "retires in epoch soon".
    const epoch = p.retiringEpoch;
    warnings.push(epoch === null || epoch === undefined ? t("pool.warn.retiringSoon") : t("pool.warn.retiring", { epoch }));
  }
  if (p.saturation > 100) warnings.push(t("pool.warn.oversaturated", oversaturation(p.saturation)));
  if (BigInt(p.livePledge) < BigInt(p.pledge)) {
    warnings.push(t("pool.warn.underPledged"));
  }
  return warnings;
}

/** Each review's title names its act, not a gerund or a near-twin of another's (ST-2). */
const TITLES = {
  delegate: "staking.review.delegate",
  vote: "staking.review.vote",
  withdraw: "staking.review.withdraw",
  stop: "staking.review.stop",
  "drep-register": "staking.review.drepRegister",
  "drep-update": "staking.review.drepUpdate",
  "drep-retire": "staking.review.drepRetire",
  "drep-vote": "staking.review.drepVote",
} as const satisfies Record<StakingAction["kind"], I18nKey>;

export function StakingReview({
  summary,
  pool,
  switching = false,
  drepName,
  shared = 0,
  drepListed = true,
  drepInactive = false,
  govAction,
  before,
  total,
  busy,
  error,
  onBack,
  onSend,
}: {
  summary: StakingSummary;
  /** The account's whole balance as Home shows it: the review's balance after. */
  total?: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onSend: () => void;
} & Chosen) {
  const t = useT();
  const typeOf = useActionType();
  const voteOf = useVoteLabel();
  const { action } = summary;
  const nonzero = (l: string) => BigInt(l) > 0n;
  const drepAction = action.kind.startsWith("drep-");
  // A DRep's deposit comes back when it retires, the stake key's when staking stops: shown apart.
  const drepDeposit = BigInt(summary.drepDeposit ?? "0");
  const stakeDeposit = BigInt(summary.deposit) - drepDeposit;
  const poolWarned = pool && "margin" in pool ? poolWarnings(pool) : [];
  // The button says the act, and the line under the title names that button: every review ended on "Send" under
  // "Nothing is sent until you press Send", for nine different commitments (ST-2).
  const act =
    action.kind === "delegate"
      ? t("pools.stakeWith", { label: poolLabel(pool ?? { id: action.pool }) })
      : action.kind === "vote"
        ? t("staking.send.vote")
        : action.kind === "withdraw"
          ? t("staking.send.withdraw", { amount: formatAda(summary.withdrawal) })
          : action.kind === "stop"
            ? t("staking.stop")
            : action.kind === "drep-register"
              ? t("staking.send.drepRegister")
              : action.kind === "drep-update"
                ? t(action.anchor ? "staking.send.drepUpdate" : "drep.update.remove")
                : action.kind === "drep-retire"
                  ? t("drep.retire")
                  : t("staking.send.drepVote", { vote: voteOf(action.votes[0]!.vote) });
  // Ending staking and retiring a DRep end something, and lose what's on its way: the danger button (ST-3, V-3).
  const danger = action.kind === "stop" || action.kind === "drep-retire";
  return (
    <Screen
      title={t(action.kind === "delegate" && switching ? "staking.review.changePool" : TITLES[action.kind])}
      titleId="staking-review-title"
      review
      // When rewards start: how a delegation runs once sent, for anyone who wants it. Changing pools has no gap,
      // which the first stake's words didn't say to an account already earning (ST-7).
      hint={action.kind === "delegate" ? t(switching ? "staking.review.rewardsSwitch" : "staking.review.rewardsStart") : undefined}
      hintTestId="staking-rewards-start"
      onBack={onBack}
      backDisabled={busy}
      aside={t("staking.review.nothingSent", { action: act })}
      error={error}
      foot={
        <button type="button" className={danger ? "danger" : "primary"} onClick={onSend} disabled={busy}>
          {busy ? t("common.sending") : act}
        </button>
      }
    >
      <ReviewRows testId="staking-review">
        {action.kind === "delegate" && (
          <Row label={t("staking.review.stakeWith")} value={poolLabel(pool ?? { id: action.pool })} title={summary.pool ?? undefined} strong />
        )}
        {action.kind === "vote" && (
          <Row label={t("staking.review.voteTo")} value={voteLabel(summary.drep, drepName)} title={summary.drep ?? undefined} strong />
        )}
        {action.kind === "stop" && <Row label={t("staking.title")} value={t("staking.stops")} strong />}
        {drepAction && summary.drep && <Row label={t("staking.review.drep")} value={shortId(summary.drep)} title={summary.drep} />}
        {action.kind === "drep-register" && (
          <Row
            label={t("staking.review.ownVote")}
            value={action.delegate ? t("staking.review.ownVoteToDrep") : t("staking.review.ownVoteStays")}
            strong
          />
        )}
        {(action.kind === "drep-register" || action.kind === "drep-update") && (
          <Row label={t("drep.profile")} value={action.anchor ? shortId(action.anchor.url) : t("drep.profile.none")} title={action.anchor?.url} />
        )}
        {/* Which action, by the short ID its list row gives it, and its title when it has one: "Info action" alone
            didn't say which of five, and the ID was only in a tooltip nothing pointed to (blind test T14). */}
        {action.kind === "drep-vote" && govAction && (
          <Row
            label={t("staking.review.govAction")}
            value={`${govAction.title ?? typeOf(govAction.type)} · ${shortAction(govAction)}`}
            title={govAction.id}
            testId="staking-review-action"
          />
        )}
        {action.kind === "drep-vote" &&
          action.votes.map((b) => <Row key={`${b.txHash}#${b.index}`} label={t("staking.review.voteIs")} value={voteOf(b.vote)} strong />)}
        {action.kind === "drep-vote" && before && <Row label={t("staking.review.voteBefore")} value={voteOf(before)} />}
        {nonzero(summary.withdrawal) && (
          <Row
            label={t("activity.row.rewardsWithdrawn")}
            value={`${formatAda(summary.withdrawal)}\u00a0₳`}
            strong={action.kind === "withdraw"}
          />
        )}
        {drepDeposit > 0n && <Row label={t("staking.review.drepDeposit")} value={`${formatAda(drepDeposit.toString())}\u00a0₳`} />}
        {stakeDeposit > 0n && (
          <Row
            label={t(drepDeposit > 0n ? "staking.review.stakeDeposit" : "activity.row.deposit")}
            value={`${formatAda(stakeDeposit.toString())}\u00a0₳`}
          />
        )}
        {nonzero(summary.refund) && <Row label={t("activity.row.depositBack")} value={`${formatAda(summary.refund)}\u00a0₳`} />}
        <Row label={t("review.fee")} value={`${formatAda(summary.fee)}\u00a0₳`} />
        {/* What the account holds afterwards, not its change (chunk 23's review, S-1): withdrawn rewards were in the
            balance already, a deposit leaves it, and a deposit back returns to it. */}
        {total !== undefined && (
          <AfterRow
            side="public"
            lovelace={BigInt(total) - BigInt(summary.fee) - BigInt(summary.deposit) + BigInt(summary.refund)}
          />
        )}
      </ReviewRows>
      {/* Rewards withdrawn read as a gain, then a smaller balance after (ST-6). */}
      {action.kind === "withdraw" && (
        <p className="note" data-testid="staking-withdraw-note">
          {t("staking.review.withdrawNote")}
        </p>
      )}
      {action.kind === "stop" && (
        <Callout tone="warn" testId="staking-stop-ends">
          <ul className="consequences">
            <li>{t("staking.review.warn.stopEnds")}</li>
            {nonzero(summary.withdrawal) && (
              <li>{t("staking.review.warn.stopRewards", { amount: formatAda(summary.withdrawal) })}</li>
            )}
            <li>{t("staking.review.warn.stopUnpaid")}</li>
            {nonzero(summary.refund) && <li>{t("staking.review.warn.depositBack", { amount: formatAda(summary.refund) })}</li>}
            <li>{t("staking.review.warn.stopAgain")}</li>
          </ul>
        </Callout>
      )}
      {action.kind === "drep-retire" && (
        <Callout tone="warn" testId="drep-retire-ends">
          <ul className="consequences">
            {nonzero(summary.refund) && <li>{t("staking.review.warn.depositBack", { amount: formatAda(summary.refund) })}</li>}
            <li>{t("staking.review.warn.retirePower")}</li>
            <li>{t("staking.review.warn.retireAgain")}</li>
          </ul>
        </Callout>
      )}
      <TxDetailButton txHash={summary.txHash} testId="staking-tx" />
      {/* An oversaturated or retiring pool's warning stays on its review (ST-8). */}
      {action.kind === "delegate" &&
        poolWarned.map((w) => (
          <Callout key={w} tone="warn">
            {w}
          </Callout>
        ))}
      {/* The whole ID: a name or ticker is anyone's to choose (launch review #59). */}
      {action.kind === "delegate" && <ReviewId label={t("pool.id")} id={summary.pool ?? action.pool} />}
      {action.kind === "delegate" && <SharedTicker shared={shared} />}
      {action.kind === "vote" && drepInactive && (
        <Callout tone="warn" testId="drep-inactive-review">
          {t("vote.warn.inactive")}
        </Callout>
      )}
      {action.kind === "vote" && summary.drep?.startsWith("drep1") && <ReviewId label={t("staking.drepId")} id={summary.drep} />}
      {action.kind === "vote" && shared > 1 && (
        <Callout tone="warn" testId="drep-shared-name">
          {t("staking.warn.sharedDrepName", { shared: sharedDrepName({ shared, listed: drepListed }) })}
        </Callout>
      )}
      {/* A standing vote against the committee, for every action to come (GV-8). */}
      {action.kind === "vote" && summary.drep === ALWAYS_NO_CONFIDENCE && (
        <p className="note" data-testid="vote-no-confidence-note">
          {t("staking.review.noConfidenceNote")}
        </p>
      )}
      {stakeDeposit > 0n && <p className="note">{t("staking.review.depositNote")}</p>}
      {drepDeposit > 0n && <p className="note">{t("staking.review.drepDepositNote")}</p>}
      {/* From the worker's fresh read the build used, not the page's: they could differ, and the review then left out
          the move it signs, or claimed one it doesn't make (release review C35). */}
      {action.kind === "drep-retire" && summary.ownVoteMoves && (
        <Callout tone="warn" testId="drep-retire-vote">
          {t("staking.warn.retireOwnVote")}
        </Callout>
      )}
      {/* A vote's own note ties it to the public account: the DRep's beside it said so again. */}
      {action.kind === "drep-vote" ? (
        <Callout tone="privacy">{t("gov.privacy.vote")}</Callout>
      ) : (
        <Callout tone="privacy">{t(drepAction ? "drep.privacy.public" : "staking.privacy.namesAccount")}</Callout>
      )}
      <p className="note">{t("send.review.confirmTime")}</p>
    </Screen>
  );
}

/** A pool's or DRep's whole ID, in a review. */
function ReviewId({ label, id }: { label: string; id: string }) {
  return (
    <div className="stack-tight" data-testid="staking-review-id">
      <span className="note">{label}</span>
      <p className="note mono-id">{id}</p>
    </div>
  );
}
