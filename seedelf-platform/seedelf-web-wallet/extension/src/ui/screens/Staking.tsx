// Staking, from the Cardano tab's staking row, after Lace's staking page: the
// pool the Cardano account stakes with (and why it may earn less), the
// rewards with Withdraw, where the voting power goes, Change pool and Stop
// staking, and the account as its own DRep (Governance.tsx). Choosing a pool
// opens the browser (Pools.tsx); the vote, Voting.tsx. Every change is built
// and signed by the worker and reviewed here: nothing is sent until the user
// presses Send. Opening the page reads the pool's details and the account's
// DRep, fresh: two requests, or three (the DRep deposit, or its profile's
// check).

import { useEffect, useState } from "react";
import { type I18nKey, t, useT } from "../../i18n";

import type {
  GovAction,
  GovernanceView,
  GovVote,
  OwnDrep,
  PendingTx,
  PoolDetails,
  PoolRef,
  StakeInfo,
  StakingAction,
  StakingSummary,
} from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ChevronRightIcon, TrashIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Hinted } from "../components/Hint";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { adaWithTokens, formatAda, formatPercent, poolLabel, rewardsLocked, shortId, voteLabel } from "../format";
import { useAmounts } from "../preferences";
import { BecomeDrep, DrepCard, DrepProfileEdit, GovActions, useActionType, useVoteLabel } from "./Governance";
import { Pools, SharedTicker } from "./Pools";
import { sharedDrepName, Voting } from "./Voting";

/** What a review shows besides the summary: the pool's or DRep's name, and how many others share it. */
interface Chosen {
  pool?: PoolRef;
  drepName?: string;
  /** Live pools using the pool's ticker, or DReps using the DRep's name (Voting.tsx `drepSharing`). */
  shared?: number;
  /** The list has the DRep under that name; when it doesn't, `shared` counts it too. */
  drepListed?: boolean;
  /** A vote's governance action, and the DRep's vote on it before, if any. */
  govAction?: GovAction;
  before?: GovVote;
  /** Retiring moves the account's own vote, which was the DRep's, to always abstain. */
  ownVoteMoves?: boolean;
}

type Page = "overview" | "pools" | "vote" | "drep-register" | "drep-profile" | "governance";

export function Staking({
  staking,
  spendRewards,
  blocked,
  start = "overview",
  onBack,
  onSent,
}: {
  staking: StakeInfo;
  /** Whether a payment from the account spends the rewards too (Settings). */
  spendRewards: boolean;
  /** Why nothing can be sent now: a transaction is on its way. */
  blocked?: string;
  /** Home's locked-rewards warning opens the vote directly. */
  start?: Page;
  onBack: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  const amounts = useAmounts();
  const [page, setPage] = useState<Page>(start);
  const [pool, setPool] = useState<PoolDetails>();
  const [poolError, setPoolError] = useState<string>();
  const [review, setReview] = useState<{ summary: StakingSummary } & Chosen>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [drep, setDrep] = useState<OwnDrep>();
  const [drepError, setDrepError] = useState<string>();
  // Governance actions as last read, and the one open: kept here, so a vote's review doesn't lose them.
  const [govView, setGovView] = useState<GovernanceView>();
  const [govOpen, setGovOpen] = useState<GovAction>();

  // The pool's details, fresh each time the page opens.
  const poolId = staking.pool?.id;
  useEffect(() => {
    if (!poolId) return;
    call("pool", { id: poolId }).then(setPool, (e: Error) => setPoolError(e.message));
  }, [poolId]);

  // The account's own DRep, fresh too.
  useEffect(() => {
    call("drep-own", {}).then(setDrep, (e: Error) => setDrepError(e.message));
  }, []);
  const ownDrepName = drep && staking.drep === drep.id ? t("drep.yourOwn") : undefined;

  async function build(action: StakingAction, chosen: Chosen = {}) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setReview({ summary: await call("stake-build", { action }), ...chosen });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!review || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSent(await call("stake-submit", { txHash: review.summary.txHash }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const back = (to: Page) => () => {
    setError(undefined);
    setPage(to);
  };

  if (review) {
    return (
      <StakingReview
        {...review}
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
        blocked={blocked}
        busy={busy}
        error={error}
        onBack={back("overview")}
        onStake={(p, shared) => void build({ kind: "delegate", pool: p.id }, { pool: p, shared })}
      />
    );
  }
  if (page === "drep-register" && drep) {
    return (
      <BecomeDrep
        drep={drep}
        staking={staking}
        blocked={blocked}
        busy={busy}
        error={error}
        onBack={back("overview")}
        onReview={(delegate, anchor) => void build({ kind: "drep-register", delegate, ...(anchor ? { anchor } : {}) })}
      />
    );
  }
  if (page === "drep-profile" && drep) {
    return (
      <DrepProfileEdit
        drep={drep}
        blocked={blocked}
        busy={busy}
        error={error}
        onBack={back("overview")}
        onReview={(anchor) => void build({ kind: "drep-update", ...(anchor ? { anchor } : {}) })}
      />
    );
  }
  if (page === "governance") {
    return (
      <GovActions
        busy={busy}
        blocked={blocked}
        error={error}
        onBack={back("overview")}
        onBecome={back("drep-register")}
        view={govView}
        onView={setGovView}
        open={govOpen}
        onOpen={setGovOpen}
        onVote={(action, vote, before) =>
          void build(
            { kind: "drep-vote", votes: [{ txHash: action.txHash, index: action.index, vote }] },
            { govAction: action, ...(before ? { before } : {}) },
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
        blocked={blocked}
        busy={busy}
        error={error}
        onBack={back("overview")}
        onVote={(drep, drepName, shared) =>
          void build({ kind: "vote", drep }, { drepName, shared: shared?.shared, drepListed: shared?.listed })
        }
        own={drep}
        ownError={drepError}
        onBecome={back("drep-register")}
      />
    );
  }

  const locked = rewardsLocked(staking);
  const rewards = BigInt(staking.rewards);
  const withdrawTitle = blocked ?? (locked ? t("staking.delegateFirst") : rewards === 0n ? t("staking.noRewards") : undefined);
  return (
    <Screen title={t("staking.pageTitle")} titleId="staking-title" onBack={onBack} backDisabled={busy} error={error}>
      {staking.pool ? (
        <section className="section" aria-labelledby="pool-title">
          <h2 id="pool-title">{t("staking.yourPool")}</h2>
          <PoolFacts pool={pool ?? staking.pool} error={pool ? undefined : poolError} testId="your-pool" />
          <button type="button" className="secondary" onClick={() => setPage("pools")} disabled={!!blocked || busy} title={blocked}>
            {t("staking.changePool")}
          </button>
        </section>
      ) : (
        <section className="section" aria-labelledby="pool-title">
          <Hinted text={t("staking.note")} testId="staking-note">
            <h2 id="pool-title">{t("home.staking.not")}</h2>
          </Hinted>
          {!staking.registered && (
            <p className="note">{t("staking.depositNote")}</p>
          )}
          <button type="button" className="primary" onClick={() => setPage("pools")} disabled={!!blocked || busy} title={blocked}>
            {t("staking.choosePool")}
          </button>
        </section>
      )}

      {staking.registered && (
        <section className="section" aria-labelledby="rewards-title">
          <h2 id="rewards-title">{t("staking.rewards")}</h2>
          <p className="amount amount--small" data-testid="staking-rewards">
            {amounts.ada(staking.rewards)}
            <span className="amount__unit"> ₳</span>
          </p>
          <p className="note">
            {t(spendRewards ? "staking.rewardsSpent" : "staking.rewardsWait")}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => void build({ kind: "withdraw" })}
            disabled={!!withdrawTitle || busy}
            title={withdrawTitle}
          >
            {busy ? t("common.building") : t("staking.withdraw")}
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
        <button type="button" className="secondary" onClick={() => setPage("vote")} disabled={!!blocked || busy} title={blocked}>
          {t(staking.drep ? "staking.change" : "staking.delegate")}
        </button>
      </section>

      <DrepCard
        drep={drep}
        error={drepError}
        staking={staking}
        blocked={blocked}
        busy={busy}
        onBecome={back("drep-register")}
        onActions={back("governance")}
        onProfile={back("drep-profile")}
        onRetire={() => void build({ kind: "drep-retire" }, { ownVoteMoves: !!drep && staking.drep === drep.id })}
        onDelegateOwn={() => drep && void build({ kind: "vote", drep: drep.id }, { drepName: t("drep.yourOwn") })}
      />

      {staking.registered && (
        <ul className="list">
          <li>
            <button
              type="button"
              className="menu-row menu-row--danger"
              onClick={() => void build({ kind: "stop" })}
              disabled={locked || !!blocked || busy}
              title={blocked ?? (locked ? t("staking.delegateFirstStop") : undefined)}
            >
              <span className="menu-row__icon">
                <TrashIcon size={16} />
              </span>
              <span>{t("staking.stop")}</span>
              <ChevronRightIcon size={16} />
            </button>
          </li>
        </ul>
      )}

      <Callout tone="privacy">
        {t("staking.privacy.public")}
      </Callout>
    </Screen>
  );
}

/** A pool's figures, and why it may earn its delegators less. */
export function PoolFacts({
  pool,
  error,
  testId,
  named = true,
}: {
  pool: PoolRef | PoolDetails;
  error?: string;
  testId: string;
  /** Whether to say which pool: not when the screen's title does. */
  named?: boolean;
}) {
  const t = useT();
  const details = "margin" in pool ? pool : undefined;
  const warnings = details ? poolWarnings(details) : [];
  return (
    <div className="stack-tight" data-testid={testId}>
      {named && (
        <p className="pool-name">
          <strong>{poolLabel(pool)}</strong>
          {pool.ticker && pool.name && <span className="note"> · {pool.name}</span>}
          {/* A ticker is the pool's own to choose: its ID is what it is. */}
          {(pool.ticker || pool.name) && (
            <span className="note mono-id" title={pool.id}>
              {" "}
              · {shortId(pool.id)}
            </span>
          )}
        </p>
      )}
      {details ? (
        <ReviewRows testId={`${testId}-facts`}>
          <Row label={t("pool.saturation")} value={formatPercent(details.saturation)} />
          <Row label={t("pool.margin")} value={formatPercent(details.margin * 100)} />
          <Row label={t("pool.cost")} value={`${formatAda(details.cost)} ₳`} />
          <Row label={t("pool.pledge")} value={`${formatAda(details.pledge)} ₳`} />
          <Row label={t("pool.delegators")} value={details.delegators.toLocaleString("en-US")} />
          <Row label={t("pool.blocks")} value={details.blocks.toLocaleString("en-US")} />
        </ReviewRows>
      ) : (
        <p className="note">{error ? t("pool.readFailed", { error }) : t("pool.reading")}</p>
      )}
      {warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
        </Callout>
      ))}
    </div>
  );
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
  if (p.saturation > 100) warnings.push(t("pool.warn.oversaturated"));
  if (BigInt(p.livePledge) < BigInt(p.pledge)) {
    warnings.push(t("pool.warn.underPledged"));
  }
  return warnings;
}

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
  drepName,
  shared = 0,
  drepListed = true,
  govAction,
  before,
  ownVoteMoves = false,
  busy,
  error,
  onBack,
  onSend,
}: { summary: StakingSummary; busy: boolean; error?: string; onBack: () => void; onSend: () => void } & Chosen) {
  const t = useT();
  const typeOf = useActionType();
  const voteOf = useVoteLabel();
  const { action } = summary;
  const nonzero = (l: string) => BigInt(l) > 0n;
  const drepAction = action.kind.startsWith("drep-");
  // A DRep's deposit comes back when it retires, the stake key's when staking stops: shown apart.
  const drepDeposit = BigInt(summary.drepDeposit ?? "0");
  const stakeDeposit = BigInt(summary.deposit) - drepDeposit;
  return (
    <Screen
      title={t(TITLES[action.kind])}
      titleId="staking-review-title"
      // When rewards start: how a delegation runs once sent, for anyone who wants it.
      hint={action.kind === "delegate" ? t("staking.review.rewardsStart") : undefined}
      hintTestId="staking-rewards-start"
      onBack={onBack}
      backDisabled={busy}
      aside={t("review.nothingSent")}
      error={error}
      foot={
        <button type="button" className="primary" onClick={onSend} disabled={busy}>
          {busy ? t("common.sending") : t("common.send")}
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
        {action.kind === "drep-vote" && govAction && (
          <Row label={t("staking.review.govAction")} value={govAction.title ?? typeOf(govAction.type)} title={govAction.id} />
        )}
        {action.kind === "drep-vote" &&
          action.votes.map((b) => <Row key={`${b.txHash}#${b.index}`} label={t("staking.review.voteIs")} value={voteOf(b.vote)} strong />)}
        {action.kind === "drep-vote" && before && <Row label={t("staking.review.voteBefore")} value={voteOf(before)} />}
        {nonzero(summary.withdrawal) && (
          <Row label={t("activity.row.rewardsWithdrawn")} value={`${formatAda(summary.withdrawal)} ₳`} strong={action.kind === "withdraw"} />
        )}
        {drepDeposit > 0n && <Row label={t("staking.review.drepDeposit")} value={`${formatAda(drepDeposit.toString())} ₳`} />}
        {stakeDeposit > 0n && (
          <Row
            label={t(drepDeposit > 0n ? "staking.review.stakeDeposit" : "activity.row.deposit")}
            value={`${formatAda(stakeDeposit.toString())} ₳`}
          />
        )}
        {nonzero(summary.refund) && <Row label={t("activity.row.depositBack")} value={`${formatAda(summary.refund)} ₳`} />}
        <Row label={t("review.fee")} value={`${formatAda(summary.fee)} ₳`} />
        <Row label={t("review.backToPublic")} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
      </ReviewRows>
      <TxDetailButton txHash={summary.txHash} testId="staking-tx" />
      {/* The whole ID: a name or ticker is anyone's to choose (launch review #59). */}
      {action.kind === "delegate" && <ReviewId label={t("pool.id")} id={summary.pool ?? action.pool} />}
      {action.kind === "delegate" && <SharedTicker shared={shared} />}
      {action.kind === "vote" && summary.drep?.startsWith("drep1") && <ReviewId label={t("staking.drepId")} id={summary.drep} />}
      {action.kind === "vote" && shared > 1 && (
        <Callout tone="warn" testId="drep-shared-name">
          {t("staking.warn.sharedDrepName", { shared: sharedDrepName({ shared, listed: drepListed }) })}
        </Callout>
      )}
      {stakeDeposit > 0n && (
        <p className="note">{t("staking.review.depositNote")}</p>
      )}
      {action.kind === "stop" && (
        <p className="note">{t("staking.review.stopNote")}</p>
      )}
      {drepDeposit > 0n && <p className="note">{t("staking.review.drepDepositNote")}</p>}
      {action.kind === "drep-retire" && ownVoteMoves && (
        <Callout tone="warn" testId="drep-retire-vote">
          {t("staking.warn.retireOwnVote")}
        </Callout>
      )}
      {action.kind === "drep-vote" && <Callout tone="privacy">{t("gov.privacy.vote")}</Callout>}
      <Callout tone="privacy">{t(drepAction ? "drep.privacy.public" : "staking.privacy.namesAccount")}</Callout>
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
