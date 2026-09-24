// Staking, from the Cardano tab's staking row, after Lace's staking page: the
// pool the Cardano account stakes with (and why it may earn less), the
// rewards with Withdraw, where the voting power goes, Change pool and Stop
// staking. Choosing a pool opens the browser (Pools.tsx); the vote, Voting.tsx.
// Every change is built and signed by the worker and reviewed here: nothing
// is sent until the user presses Send. Opening the page reads the pool's
// details, fresh: one request.

import { useEffect, useState } from "react";

import type { PendingTx, PoolDetails, PoolRef, StakeInfo, StakingAction, StakingSummary } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ChevronRightIcon, TrashIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { adaWithTokens, formatAda, formatPercent, poolLabel, rewardsLocked, voteLabel } from "../format";
import { Pools } from "./Pools";
import { Voting } from "./Voting";

/** What a review shows besides the summary: the pool's or DRep's name. */
interface Chosen {
  pool?: PoolRef;
  drepName?: string;
}

type Page = "overview" | "pools" | "vote";

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
  const [page, setPage] = useState<Page>(start);
  const [pool, setPool] = useState<PoolDetails>();
  const [poolError, setPoolError] = useState<string>();
  const [review, setReview] = useState<{ summary: StakingSummary } & Chosen>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // The pool's details, fresh each time the page opens.
  const poolId = staking.pool?.id;
  useEffect(() => {
    if (!poolId) return;
    call("pool", { id: poolId }).then(setPool, (e: Error) => setPoolError(e.message));
  }, [poolId]);

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
        onStake={(p) => void build({ kind: "delegate", pool: p.id }, { pool: p })}
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
        onVote={(drep, drepName) => void build({ kind: "vote", drep }, { drepName })}
      />
    );
  }

  const locked = rewardsLocked(staking);
  const rewards = BigInt(staking.rewards);
  const withdrawTitle = blocked ?? (locked ? "Delegate your voting power first" : rewards === 0n ? "No rewards yet" : undefined);
  return (
    <Screen title="Staking" titleId="staking-title" onBack={onBack} backDisabled={busy} error={error}>
      {staking.pool ? (
        <section className="section" aria-labelledby="pool-title">
          <h2 id="pool-title">Your pool</h2>
          <PoolFacts pool={pool ?? staking.pool} error={pool ? undefined : poolError} testId="your-pool" />
          <button type="button" className="secondary" onClick={() => setPage("pools")} disabled={!!blocked || busy} title={blocked}>
            Change pool
          </button>
        </section>
      ) : (
        <section className="section" aria-labelledby="pool-title">
          <h2 id="pool-title">Not staking</h2>
          <p className="note">
            Stake your Cardano account with a pool to earn rewards every epoch (5 days). Your ADA stays in your account,
            free to spend.
          </p>
          {!staking.registered && (
            <p className="note">The first time takes a 2 ₳ deposit, which comes back when you stop.</p>
          )}
          <button type="button" className="primary" onClick={() => setPage("pools")} disabled={!!blocked || busy} title={blocked}>
            Choose a pool
          </button>
        </section>
      )}

      {staking.registered && (
        <section className="section" aria-labelledby="rewards-title">
          <h2 id="rewards-title">Rewards</h2>
          <p className="amount amount--small" data-testid="staking-rewards">
            {formatAda(staking.rewards)}
            <span className="amount__unit"> ₳</span>
          </p>
          <p className="note">
            {spendRewards
              ? "Spent along with anything your Cardano account pays, or withdrawn here. Settings can keep them here instead."
              : "They wait here until you withdraw them: Settings keeps them out of your payments."}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => void build({ kind: "withdraw" })}
            disabled={!!withdrawTitle || busy}
            title={withdrawTitle}
          >
            {busy ? "Building…" : "Withdraw rewards"}
          </button>
        </section>
      )}

      <section className="section" aria-labelledby="vote-title">
        <h2 id="vote-title">Voting power</h2>
        <ReviewRows testId="vote-now">
          <Row label="Delegated to" value={voteLabel(staking.drep)} title={staking.drep ?? undefined} strong />
        </ReviewRows>
        {locked && (
          <Callout tone="warn" testId="rewards-locked">
            Your {formatAda(staking.rewards)} ₳ of rewards can't be withdrawn until you delegate your voting power: to a
            DRep, or always abstain.
          </Callout>
        )}
        <p className="note">Your stake has a say in Cardano's governance, through a DRep who votes for you.</p>
        <button type="button" className="secondary" onClick={() => setPage("vote")} disabled={!!blocked || busy} title={blocked}>
          {staking.drep ? "Change" : "Delegate"}
        </button>
      </section>

      {staking.registered && (
        <ul className="list">
          <li>
            <button
              type="button"
              className="menu-row menu-row--danger"
              onClick={() => void build({ kind: "stop" })}
              disabled={locked || !!blocked || busy}
              title={blocked ?? (locked ? "Delegate your voting power first: stopping withdraws the rewards" : undefined)}
            >
              <span className="menu-row__icon">
                <TrashIcon size={16} />
              </span>
              <span>Stop staking</span>
              <ChevronRightIcon size={16} />
            </button>
          </li>
        </ul>
      )}

      <Callout tone="privacy">
        Staking and voting are public: anyone can see which pool and DRep your Cardano account chose. Seedelf money
        can't be staked: it has no staking part, so it earns nothing while it's in Seedelf.
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
  const details = "margin" in pool ? pool : undefined;
  const warnings = details ? poolWarnings(details) : [];
  return (
    <div className="stack-tight" data-testid={testId}>
      {named && (
        <p className="pool-name">
          <strong>{poolLabel(pool)}</strong>
          {pool.ticker && pool.name && <span className="note"> · {pool.name}</span>}
        </p>
      )}
      {details ? (
        <ReviewRows testId={`${testId}-facts`}>
          <Row label="Saturation" value={formatPercent(details.saturation)} />
          <Row label="Margin" value={formatPercent(details.margin * 100)} />
          <Row label="Cost per epoch" value={`${formatAda(details.cost)} ₳`} />
          <Row label="Pledge" value={`${formatAda(details.pledge)} ₳`} />
          <Row label="Delegators" value={details.delegators.toLocaleString("en-US")} />
          <Row label="Blocks made" value={details.blocks.toLocaleString("en-US")} />
        </ReviewRows>
      ) : (
        <p className="note">{error ? `Couldn't read the pool's details: ${error}` : "Reading the pool's details…"}</p>
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
  if (p.status === "retired") warnings.push("This pool has retired: it earns nothing now. Choose another.");
  if (p.status === "retiring") {
    warnings.push(`This pool retires in epoch ${p.retiringEpoch ?? "soon"}: choose another before then.`);
  }
  if (p.saturation > 100) warnings.push("This pool is oversaturated: every delegator's rewards shrink.");
  if (BigInt(p.livePledge) < BigInt(p.pledge)) {
    warnings.push("Its owners stake less than they pledged, so the pool earns no rewards until they make it up.");
  }
  return warnings;
}

const TITLES: Record<StakingAction["kind"], string> = {
  delegate: "Review staking",
  vote: "Review the vote",
  withdraw: "Review the withdrawal",
  stop: "Review stopping",
};

function StakingReview({
  summary,
  pool,
  drepName,
  busy,
  error,
  onBack,
  onSend,
}: { summary: StakingSummary; busy: boolean; error?: string; onBack: () => void; onSend: () => void } & Chosen) {
  const { action } = summary;
  const nonzero = (l: string) => BigInt(l) > 0n;
  return (
    <Screen
      title={TITLES[action.kind]}
      titleId="staking-review-title"
      onBack={onBack}
      backDisabled={busy}
      aside="Nothing is sent until you press Send"
      error={error}
      foot={
        <button type="button" className="primary" onClick={onSend} disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      }
    >
      <ReviewRows testId="staking-review">
        {action.kind === "delegate" && (
          <Row label="Stake with" value={poolLabel(pool ?? { id: action.pool })} title={summary.pool ?? undefined} strong />
        )}
        {action.kind === "vote" && (
          <Row label="Voting power to" value={voteLabel(summary.drep, drepName)} title={summary.drep ?? undefined} strong />
        )}
        {action.kind === "stop" && <Row label="Staking" value="Stops" strong />}
        {nonzero(summary.withdrawal) && (
          <Row label="Rewards withdrawn" value={`${formatAda(summary.withdrawal)} ₳`} strong={action.kind === "withdraw"} />
        )}
        {nonzero(summary.deposit) && <Row label="Deposit" value={`${formatAda(summary.deposit)} ₳`} />}
        {nonzero(summary.refund) && <Row label="Deposit back" value={`${formatAda(summary.refund)} ₳`} />}
        <Row label="Network fee" value={`${formatAda(summary.fee)} ₳`} />
        <Row label="Back to your Cardano account" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
      </ReviewRows>
      {nonzero(summary.deposit) && (
        <p className="note">Registering your account to stake takes the deposit. Stopping staking gives it back.</p>
      )}
      {action.kind === "delegate" && (
        <p className="note">
          Rewards start after about 15 to 20 days (the network takes a snapshot, then pays out an epoch later), then come
          every 5 days.
        </p>
      )}
      {action.kind === "stop" && (
        <p className="note">Your pool and your voting power's delegation end, and no more rewards come.</p>
      )}
      <Callout tone="privacy">This is public: it names your Cardano account.</Callout>
      <p className="note">It takes about a minute for the network to confirm.</p>
    </Screen>
  );
}
