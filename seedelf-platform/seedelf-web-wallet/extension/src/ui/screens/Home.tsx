// Home, in two tabs: one wallet on Cardano, with a private side and a public
// side. Private: the private balance (Seedelf's) with Receive (your
// seedelfs: their names, and Remove), Send, Make public (withdraw) and
// Create, and its tokens. Public: the public account's balance (its staking
// rewards included) and tokens, Receive, Send and Make private (move in),
// and a staking row that opens Staking, with a warning while rewards are
// locked for want of a vote delegation. Each tab opens its Activity and its UTxOs, where UTxOs are
// locked; the forms get only what's unlocked. Until the wallet has a seedelf
// and a Seedelf balance, a checklist shows the order that keeps them apart:
// fund the account, create the seedelf, then move in (privacy.md, mint first).
// Balances come from the worker's last reading; it reads the chain again
// when that is over a minute old, or on Refresh. A sent move-in, seedelf
// mint, transfer, withdrawal or removal shows as a banner until the network
// confirms it. The eye beside each balance hides the amounts (a setting),
// and on mainnet each balance's value shows in the chosen currency, read
// with the balances (prices.ts). An ADA Handle in the private balance gets a
// warning: anyone paying it from another wallet pays the contract with no
// datum, which anyone can take.

import { useCallback, useEffect, useState } from "react";

import { handlesIn } from "../../shared/handles";
import type { Account, AdaPrice, Balances, PendingTx, SeedelfInfo, SessionView, StakeInfo } from "../../shared/rpc";
import { call } from "../background";
import { ActionButton } from "../components/ActionButton";
import { Callout } from "../components/Callout";
import { RefreshRow } from "../components/RefreshRow";
import { Splash, useSplash } from "../components/Splash";
import { TxBanner } from "../components/TxBanner";
import {
  ChevronRightIcon,
  CoinsIcon,
  DoneIcon,
  EyeIcon,
  EyeOffIcon,
  GridIcon,
  HistoryIcon,
  MoveInIcon,
  PieIcon,
  ReceiveIcon,
  SendIcon,
  SproutIcon,
  SwapIcon,
  WithdrawIcon,
} from "../components/Icons";
import { Tabs } from "../components/Tabs";
import { TokenList } from "../components/TokenList";
import { formatFiat, plural, poolLabel, rewardsLocked, spentRewards, unlocked, withRewards } from "../format";
import { useAmounts, usePreferences } from "../preferences";
import { Activity } from "./Activity";
import { CardanoSend } from "./CardanoSend";
import { CreateSeedelf } from "./CreateSeedelf";
import { Dapps, type DappStart } from "./Dapps";
import { MoveIn } from "./MoveIn";
import { Receive, ReceiveSeedelf } from "./Receive";
import { RemoveSeedelf } from "./RemoveSeedelf";
import { Staking } from "./Staking";
import { Tokens } from "./Tokens";
import { Transfer } from "./Transfer";
import { Utxos } from "./Utxos";
import { isRunningSwap, swapLine } from "./Swaps";
import { Withdraw } from "./Withdraw";

/** How the banner names a sent transaction, and says it's confirmed. */
const SENT: Record<PendingTx["kind"], string> = {
  "move-in": "Payment into your private balance",
  mint: "Seedelf mint",
  transfer: "Private payment",
  withdraw: "Payment from your private balance",
  remove: "Seedelf removal",
  send: "Payment",
  collateral: "Collateral payment",
  stake: "Delegation",
  vote: "Vote delegation",
  "withdraw-rewards": "Reward withdrawal",
  unstake: "Stop staking",
  "session-out": "Payment into a private session",
  "session-swap": "Swap order",
  "session-cancel": "Order cancel",
  "session-back": "Return from a private session",
};
const CONFIRMED: Record<PendingTx["kind"], string> = {
  "move-in": "Made private",
  mint: "Seedelf created",
  transfer: "Private payment confirmed",
  withdraw: "Made public",
  remove: "Seedelf removed",
  send: "Payment confirmed",
  collateral: "Collateral set",
  stake: "Now staking",
  vote: "Voting power delegated",
  "withdraw-rewards": "Rewards withdrawn",
  unstake: "Staking stopped",
  "session-out": "Private session funded",
  "session-swap": "Swap order placed",
  "session-cancel": "Order cancelled",
  "session-back": "Back in your private balance",
};

/** Read again on open when the last reading is older than this. */
const STALE_MS = 60_000;
/** How often to ask about a sent transaction. */
const WATCH_EVERY_MS = 15_000;

type Tab = "seedelf" | "cardano";

const BUSY = "Wait for the last transaction to confirm";
const ALL_LOCKED = "Every UTxO here is locked: unlock one under UTxOs";

export function Home() {
  const [account, setAccount] = useState<Account>();
  const [balances, setBalances] = useState<Balances>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const [tab, setTab] = useState<Tab>("seedelf");
  const [screen, setScreen] = useState<
    | "home"
    | "receive"
    | "receive-seedelf"
    | "move-in"
    | "send"
    | "create"
    | "transfer"
    | "withdraw"
    | "staking"
    | "staking-vote"
    | "dapps"
  >("home");
  const { prefs } = usePreferences();
  const amounts = useAmounts();
  const [price, setPrice] = useState<AdaPrice | null>(null);
  const [removing, setRemoving] = useState<SeedelfInfo>();
  const [tokensOf, setTokensOf] = useState<Tab>();
  const [activityOf, setActivityOf] = useState<Tab>();
  const [utxosOf, setUtxosOf] = useState<Tab>();
  const [pending, setPending] = useState<PendingTx | null>(null);
  const [dappStart, setDappStart] = useState<DappStart>();
  // Swaps that run themselves and aren't over, from the device's own record.
  const [swaps, setSwaps] = useState<SessionView[]>([]);

  const load = useCallback(async (refresh: boolean) => {
    setReading(true);
    // ADA's value, alongside: kept five minutes, and nothing at all off mainnet or with no currency.
    call("price", {}).then(setPrice, () => setPrice(null));
    try {
      const b = await call("balances", { refresh });
      setBalances(b);
      setError(undefined);
      return b;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setReading(false);
      setNow(Date.now());
    }
  }, []);

  // Ask about the sent transaction; once it's confirmed, read the balances again.
  const watch = useCallback(async () => {
    try {
      const p = await call("pending-tx", {});
      if (!p) return;
      setPending(p);
      if (p.confirmations !== null) void load(true);
    } catch {
      // Koios hiccup: try again on the next tick.
    }
  }, [load]);

  useEffect(() => {
    call("account", {}).then(setAccount, (e: Error) => setError(e.message));
    void load(false).then((b) => {
      if (b && Date.now() - b.updatedAt > STALE_MS) void load(true);
    });
    void watch();
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tick);
  }, [load, watch]);

  // While Home shows, what's running: read from the device every 20 s, as the worker's alarm moves it on.
  useEffect(() => {
    if (screen !== "home") return;
    let live = true;
    const read = () =>
      call("sessions", {}).then(
        (all) => live && setSwaps(all.filter(isRunningSwap)),
        () => undefined,
      );
    void read();
    const timer = setInterval(() => void read(), 20_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [screen]);

  // Until the first reading (or its error), a splash covers the empty balances.
  const splash = useSplash(balances !== undefined || error !== undefined);

  const watching = pending !== null && pending.confirmations === null && now - pending.submittedAt < 10 * 60_000;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void watch(), WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [watching, watch]);

  const seedelfs = balances?.seedelf.seedelfs ?? [];
  // What the forms may spend: each side less what's locked, and the account's
  // staking rewards when a payment spends them too.
  const spendRewards = prefs.spendRewards;
  const rewards = balances ? spentRewards(balances.cardano.staking, spendRewards) : 0n;
  const rewardsProp = rewards > 0n ? rewards.toString() : undefined;
  const free = balances && {
    ...balances,
    seedelf: unlocked(balances.seedelf),
    cardano: withRewards(unlocked(balances.cardano), rewards),
  };
  const canSpend = !!free && free.seedelf.utxos > 0 && !watching;
  const spendTitle = watching
    ? BUSY
    : balances && balances.seedelf.utxos === 0
      ? "Make some ADA private first: these are paid from your private balance"
      : free && free.seedelf.utxos === 0
        ? ALL_LOCKED
        : undefined;
  const canCreate = !!free && (free.cardano.utxos > 0 || free.seedelf.utxos > 0) && !watching;
  const createTitle = watching
    ? BUSY
    : balances && !canCreate
      ? balances.cardano.utxos > 0 || balances.seedelf.utxos > 0
        ? ALL_LOCKED
        : "Fund your public account first: it pays for the Seedelf"
      : undefined;
  // Move in and Send both spend the account.
  const canMoveIn = !!free && free.cardano.utxos > 0 && !watching;
  const moveInTitle = watching ? BUSY : balances && free && balances.cardano.utxos > 0 && !canMoveIn ? ALL_LOCKED : undefined;

  const sent = (p: PendingTx) => {
    setPending(p);
    setScreen("home");
    setRemoving(undefined);
  };
  const home = () => setScreen("home");
  const dapps = (start?: DappStart) => {
    setDappStart(start);
    setScreen("dapps");
  };
  // Remove is reached from Receive, and Back returns there.
  if (removing) {
    return <RemoveSeedelf seedelf={removing} onCancel={() => setRemoving(undefined)} onSent={sent} />;
  }
  if (screen === "receive" && account) {
    return <Receive account={account} handles={handlesIn(balances?.cardano.tokens ?? [])} onBack={home} />;
  }
  if (screen === "receive-seedelf") {
    return (
      <ReceiveSeedelf
        seedelfs={seedelfs}
        onBack={home}
        onCreate={() => setScreen("create")}
        createTitle={canCreate ? undefined : createTitle}
        onRemove={setRemoving}
        removeTitle={watching ? BUSY : undefined}
      />
    );
  }
  if (screen === "move-in" && free) {
    return <MoveIn cardano={free.cardano} rewards={rewardsProp} onCancel={home} onSent={sent} />;
  }
  if (screen === "send" && free) {
    return <CardanoSend cardano={free.cardano} rewards={rewardsProp} onCancel={home} onSent={sent} />;
  }
  if ((screen === "staking" || screen === "staking-vote") && balances) {
    return (
      <Staking
        staking={balances.cardano.staking}
        spendRewards={spendRewards}
        blocked={watching ? BUSY : undefined}
        start={screen === "staking-vote" ? "vote" : "overview"}
        onBack={home}
        onSent={sent}
      />
    );
  }
  if (screen === "create" && free) return <CreateSeedelf balances={free} onCancel={home} onSent={sent} />;
  if (screen === "transfer" && free) return <Transfer seedelf={free.seedelf} onCancel={home} onSent={sent} />;
  if (screen === "withdraw" && free) return <Withdraw seedelf={free.seedelf} onCancel={home} onSent={sent} />;
  if (screen === "dapps" && free) {
    return (
      <Dapps
        seedelf={free.seedelf}
        blocked={watching ? BUSY : undefined}
        start={dappStart}
        onBack={home}
        onPending={setPending}
      />
    );
  }
  if (activityOf) {
    const pendingHash = watching ? pending?.txHash : undefined;
    return (
      <Activity
        of={activityOf}
        pendingHash={pendingHash}
        onBack={() => setActivityOf(undefined)}
        onRead={() => void load(false)}
      />
    );
  }
  if (tokensOf && balances) {
    const back = () => setTokensOf(undefined);
    return <Tokens tokens={balances[tokensOf].tokens} of={tokensOf} onBack={back} />;
  }
  if (utxosOf) {
    // Locking or refreshing there changes the kept reading: Home picks it up, with no request.
    return <Utxos of={utxosOf} onBack={() => setUtxosOf(undefined)} onChanged={() => void load(false)} />;
  }

  return (
    <>
      <Splash phase={splash} />
      <div className={splash === "wait" || splash === "show" ? "home home--hidden" : "home"}>
        {error && (
          <Callout tone="warn" role="alert">
            <div className="stack-tight">
              <strong>Couldn't read your balances</strong>
              <span>{error}</span>
              <button type="button" className="link align-start" onClick={() => void load(true)} disabled={reading}>
                {reading ? "Trying…" : "Try again"}
              </button>
            </div>
          </Callout>
        )}
        {pending && <Pending pending={pending} watching={watching} onDismiss={() => setPending(null)} />}

        <Tabs
          label="Balances"
          tabs={[
            { value: "seedelf", label: "Private" },
            { value: "cardano", label: "Public" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {/* Up by the balances, both of which it reads again: no scrolling down to it. */}
        <RefreshRow reading={reading} updatedAt={balances?.updatedAt} onRefresh={() => void load(true)} />

        {/* Each panel has its own key, so its buttons are new, not restyled Seedelf ones. */}
        {tab === "seedelf" ? (
          <section key="seedelf" className="stack" role="tabpanel" id="panel-seedelf" aria-labelledby="tab-seedelf">
            <div className="hero">
              <div className="hero__head">
                <h1 id="seedelf-balance" className="hero__label">
                  Private balance
                </h1>
                <HideToggle />
              </div>
              <Amount lovelace={balances?.seedelf.lovelace} price={price} testId="seedelf-lovelace" />
              <span className="hero__meta" data-testid="seedelf-meta">
                {balances ? `${plural(balances.seedelf.utxos, "UTxO")}${lockedMeta(balances.seedelf, amounts.ada)}` : "\u00a0"}
              </span>
              <div className="hero__actions">
                <ActionButton
                  icon={<ReceiveIcon />}
                  label="Receive"
                  name="Receive privately"
                  onClick={() => setScreen("receive-seedelf")}
                  disabled={!balances}
                />
                <ActionButton
                  primary
                  icon={<SendIcon />}
                  label="Send"
                  name="Send privately"
                  onClick={() => setScreen("transfer")}
                  disabled={!canSpend}
                  title={spendTitle}
                />
                <ActionButton
                  icon={<WithdrawIcon />}
                  label="Make public"
                  onClick={() => setScreen("withdraw")}
                  disabled={!canSpend}
                  title={spendTitle}
                />
                <ActionButton
                  icon={<SproutIcon />}
                  label="Create"
                  name="Create a Seedelf"
                  onClick={() => setScreen("create")}
                  disabled={!canCreate}
                  title={createTitle}
                />
              </div>
            </div>

            {balances && (seedelfs.length === 0 || balances.seedelf.utxos === 0) && (
              <GettingStarted
                balances={balances}
                watching={watching}
                onReceive={() => {
                  setTab("cardano");
                  setScreen("receive");
                }}
                onCreate={() => setScreen("create")}
                onMoveIn={() => setScreen("move-in")}
              />
            )}

            {balances && handlesIn(balances.seedelf.tokens).length > 0 && (
              <Callout tone="warn" testId="private-handle">
                {handleWarning(handlesIn(balances.seedelf.tokens))} Make it public to your public account.
              </Callout>
            )}

            {balances && balances.seedelf.tokens.length > 0 && (
              <section className="section" aria-labelledby="seedelf-tokens-title">
                <h2 id="seedelf-tokens-title">Tokens</h2>
                <TokenList
                  tokens={balances.seedelf.tokens}
                  testId="seedelf-tokens"
                  onViewAll={() => setTokensOf("seedelf")}
                />
              </section>
            )}

            {swaps.length > 0 && (
              <RunningSwaps swaps={swaps} onOpen={(index) => dapps({ dapp: "minswap", session: index })} />
            )}

            <Links
              onActivity={() => setActivityOf("seedelf")}
              onUtxos={() => setUtxosOf("seedelf")}
              onDapps={() => dapps()}
            />
          </section>
        ) : (
          <section key="cardano" className="stack" role="tabpanel" id="panel-cardano" aria-labelledby="tab-cardano">
            <div className="hero">
              <div className="hero__head">
                <h1 id="cardano-account" className="hero__label">
                  Public account
                </h1>
                <HideToggle />
              </div>
              <Amount lovelace={balances && accountTotal(balances.cardano)} price={price} testId="cardano-lovelace" />
              <span className="hero__meta" data-testid="cardano-meta">
                {balances
                  ? `${plural(balances.cardano.addressesUsed, "address", "addresses")} used${lockedMeta(balances.cardano, amounts.ada)}`
                  : "\u00a0"}
              </span>
              <div className="hero__actions">
                <ActionButton
                  icon={<ReceiveIcon />}
                  label="Receive"
                  name="Receive publicly"
                  onClick={() => setScreen("receive")}
                  disabled={!account}
                />
                <ActionButton
                  icon={<SendIcon />}
                  label="Send"
                  name="Send publicly"
                  onClick={() => setScreen("send")}
                  disabled={!canMoveIn}
                  title={moveInTitle}
                />
                <ActionButton
                  primary
                  icon={<MoveInIcon />}
                  label="Make private"
                  onClick={() => setScreen("move-in")}
                  disabled={!canMoveIn}
                  title={moveInTitle}
                />
              </div>
            </div>

            {balances && <StakingRow staking={balances.cardano.staking} onOpen={() => setScreen("staking")} />}
            {balances && rewardsLocked(balances.cardano.staking) && (
              <Callout tone="warn" testId="home-rewards-locked">
                <div className="stack-tight">
                  <span>
                    Your {amounts.ada(balances.cardano.staking.rewards)} ₳ of staking rewards are locked until you delegate
                    your voting power.
                  </span>
                  <button type="button" className="link align-start" onClick={() => setScreen("staking-vote")}>
                    Delegate your vote
                  </button>
                </div>
              </Callout>
            )}

            {balances && seedelfs.length === 0 && (
              <Callout tone="privacy" testId="mint-first">
                Create your Seedelf before making money private: then what you make private isn't tied to it.
              </Callout>
            )}

            {balances && balances.cardano.tokens.length > 0 && (
              <section className="section" aria-labelledby="cardano-tokens-title">
                <h2 id="cardano-tokens-title">Tokens</h2>
                <TokenList
                  tokens={balances.cardano.tokens}
                  testId="cardano-tokens"
                  onViewAll={() => setTokensOf("cardano")}
                />
              </section>
            )}

            <Links onActivity={() => setActivityOf("cardano")} onUtxos={() => setUtxosOf("cardano")} />
          </section>
        )}
      </div>
    </>
  );
}

/** " · 5 ₳ locked" under a balance, when some of it is. */
function lockedMeta(side: Balances["seedelf" | "cardano"], ada: (lovelace: string) => string): string {
  return side.locked.utxos ? ` · ${ada(side.locked.lovelace)} ₳ locked` : "";
}

/** Why an ADA Handle doesn't belong in Seedelf: what's paid to it can be taken by anyone. */
export function handleWarning(handles: string[]): string {
  const names = handles.map((h) => `$${h}`).join(", ");
  const one = handles.length === 1;
  return `${one ? "The handle" : "The handles"} ${names} ${one ? "is" : "are"} in your private balance. Anyone who pays ${one ? "it" : "them"} from another wallet pays the Seedelf contract with nothing to say whose the payment is, so anyone can take it.`;
}

/** The eye beside a balance: hides every amount on the screens that show what the wallet holds, or shows them again. */
function HideToggle() {
  const { prefs, set } = usePreferences();
  const hidden = prefs.hideBalances;
  return (
    <button
      type="button"
      className="icon-button icon-button--small"
      onClick={() => void set({ hideBalances: !hidden }).catch(() => undefined)}
      aria-label={hidden ? "Show balances" : "Hide balances"}
      aria-pressed={hidden}
      title={hidden ? "Show balances" : "Hide balances"}
    >
      {hidden ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </button>
  );
}

/** Everything the account holds: its UTxOs and its staking rewards, as other wallets show it. */
function accountTotal(cardano: Balances["cardano"]): string {
  return (BigInt(cardano.lovelace) + BigInt(cardano.staking.rewards)).toString();
}

/** "Staking with LOGIC · 57.47 ₳ rewards", or "Not staking": opens Staking. */
function StakingRow({ staking, onOpen }: { staking: StakeInfo; onOpen: () => void }) {
  const amounts = useAmounts();
  const rewards = BigInt(staking.rewards) > 0n;
  return (
    <section className="section">
      <ul className="list">
        <li>
          <button type="button" className="menu-row" onClick={onOpen} data-testid="staking-row">
            <span className="menu-row__icon">
              <PieIcon size={16} />
            </span>
            <span className="menu-row__text">
              <span>{staking.pool ? `Staking with ${poolLabel(staking.pool)}` : "Not staking"}</span>
              <span className="menu-row__sub">
                {staking.pool || rewards ? `${amounts.ada(staking.rewards)} ₳ rewards` : "Stake to earn rewards"}
              </span>
            </span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
      </ul>
    </section>
  );
}

/** Swaps running by themselves: each opens its page, where it's watched. */
function RunningSwaps({ swaps, onOpen }: { swaps: SessionView[]; onOpen: (index: number) => void }) {
  return (
    <section className="section" aria-label="Swaps in progress">
      <ul className="list" data-testid="swaps-running">
        {swaps.map((s) => (
          <li key={s.index}>
            <button type="button" className="menu-row" onClick={() => onOpen(s.index)}>
              <span className="menu-row__icon">
                <SwapIcon size={16} />
              </span>
              <span className="menu-row__text">
                <span>{s.auto?.stopping ? "Swap stopping" : "Swap in progress"}</span>
                <span className={s.auto?.paused ? "menu-row__sub swap-needs-you" : "menu-row__sub"}>{swapLine(s)}</span>
              </span>
              <ChevronRightIcon size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opens this tab's Activity, or its UTxOs, and on the private tab the dApp browser. */
function Links({ onActivity, onUtxos, onDapps }: { onActivity: () => void; onUtxos: () => void; onDapps?: () => void }) {
  return (
    <section className="section">
      <ul className="list">
        {onDapps && (
          <li>
            <button type="button" className="menu-row" onClick={onDapps}>
              <span className="menu-row__icon">
                <GridIcon size={16} />
              </span>
              <span>dApps</span>
              <ChevronRightIcon size={16} />
            </button>
          </li>
        )}
        <li>
          <button type="button" className="menu-row" onClick={onActivity}>
            <span className="menu-row__icon">
              <HistoryIcon size={16} />
            </span>
            <span>Activity</span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
        <li>
          <button type="button" className="menu-row" onClick={onUtxos}>
            <span className="menu-row__icon">
              <CoinsIcon size={16} />
            </span>
            <span>UTxOs</span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
      </ul>
    </section>
  );
}

/** The order that keeps a new wallet's seedelf apart from what it moves in. */
function GettingStarted({
  balances,
  watching,
  onReceive,
  onCreate,
  onMoveIn,
}: {
  balances: Balances;
  watching: boolean;
  onReceive: () => void;
  onCreate: () => void;
  onMoveIn: () => void;
}) {
  const created = balances.seedelf.seedelfs.length > 0;
  const movedIn = balances.seedelf.utxos > 0;
  const funded = balances.cardano.utxos > 0 || created || movedIn;
  const steps = [
    {
      done: funded,
      title: "Fund your public account",
      text: "Pay it from an exchange or another wallet.",
      action: "Receive",
      onClick: onReceive,
      disabled: false,
    },
    {
      done: created,
      title: "Create your Seedelf",
      text: "Your public account pays for it, before any money is made private.",
      action: "Create",
      onClick: onCreate,
      disabled: watching || !funded,
    },
    {
      done: movedIn,
      title: "Make ADA private",
      text: "What you make private afterwards isn't tied to your Seedelf.",
      action: "Make private",
      onClick: onMoveIn,
      disabled: watching || balances.cardano.utxos === 0,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="section" aria-labelledby="getting-started">
      <h2 id="getting-started">Get started</h2>
      <ol className="steps" data-testid="getting-started">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? "step step--done" : "step"}>
            <span className="step__icon">
              {s.done ? <DoneIcon size={20} /> : <span className="step__n">{i + 1}</span>}
            </span>
            <span className="step__title">
              {s.title}
              {s.done && <span className="sr-only"> (done)</span>}
            </span>
            {i === current ? (
              <button
                type="button"
                className="chip"
                onClick={s.onClick}
                disabled={s.disabled}
                title={watching && s.disabled ? BUSY : undefined}
              >
                {s.action}
              </button>
            ) : (
              <span />
            )}
            <p className="step__text">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Pending({ pending, watching, onDismiss }: { pending: PendingTx; watching: boolean; onDismiss: () => void }) {
  const confirmed = pending.confirmations !== null;
  const what = SENT[pending.kind];
  return (
    <TxBanner
      state={confirmed ? "done" : watching ? "waiting" : "stale"}
      title={
        confirmed
          ? CONFIRMED[pending.kind]
          : watching
            ? `${what} sent. Waiting for the network…`
            : `${what} not confirmed yet`
      }
      network={pending.network}
      txHash={pending.txHash}
      onDismiss={watching ? undefined : onDismiss}
      testId="pending-tx"
    />
  );
}

/** A balance in ADA, and under it its value in the chosen currency when there's a price. */
function Amount({ lovelace, price, testId }: { lovelace?: string; price: AdaPrice | null; testId: string }) {
  const amounts = useAmounts();
  return (
    <>
      <p className="amount" data-testid={testId}>
        {lovelace === undefined ? <span className="amount__placeholder">—</span> : amounts.ada(lovelace)}
        <span className="amount__unit"> ₳</span>
      </p>
      {lovelace !== undefined && price && (
        <p className="hero__fiat" data-testid={`${testId}-fiat`} title={`At ${formatFiat("1000000", price)} for one ADA, from CoinGecko`}>
          ≈ {amounts.text(formatFiat(lovelace, price))}
        </p>
      )}
    </>
  );
}
