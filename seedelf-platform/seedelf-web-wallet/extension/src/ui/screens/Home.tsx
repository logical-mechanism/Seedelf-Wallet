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
// confirms it. One Koios didn't answer (maybe sent) holds every payment
// back until the worker settles it: it landed, or it can't any more, when
// the balances are read again. One from the public account is watched until
// its slot passes, about two hours on. The eye beside each balance hides the amounts (a setting),
// and on mainnet each balance's value shows in the chosen currency, read
// with the balances (prices.ts). An ADA Handle in the private balance gets a
// warning: anyone paying it from another wallet pays the contract with no
// datum, which anyone can take.

import { useCallback, useEffect, useState } from "react";

import { handlesIn } from "../../shared/handles";
import type { Account, AdaPrice, Balances, LovejoinHeld, PendingTx, SeedelfInfo, SessionView, StakeInfo } from "../../shared/rpc";
import { call } from "../background";
import { ActionButton } from "../components/ActionButton";
import { Callout } from "../components/Callout";
import { RefreshRow } from "../components/RefreshRow";
import { Splash, useSplash } from "../components/Splash";
import { PendingBanner } from "../components/PendingBanner";
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
  ShieldIcon,
  SproutIcon,
  WithdrawIcon,
} from "../components/Icons";
import { Tabs } from "../components/Tabs";
import { TokenList } from "../components/TokenList";
import { formatFiat, plural, poolLabel, rewardsLocked, spentRewards, unlocked, whenOf, withRewards } from "../format";
import { useAccounts } from "../accounts";
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
import { isRunningSwap, SwapRow } from "./Swaps";
import { Withdraw } from "./Withdraw";

/** Read again on open when the last reading is older than this. */
const STALE_MS = 60_000;
/** How often to ask about a sent transaction. */
const WATCH_EVERY_MS = 15_000;
/** How long a sent transaction holds new payments back, unless it may have gone through (maybe sent). */
const HOLD_MS = 10 * 60_000;
/** How often to ask about one from the public account once it no longer holds anything back: it can land for about two hours. */
const SETTLE_EVERY_MS = 60_000;

type Tab = "seedelf" | "cardano";

const BUSY = "Wait for the last transaction to confirm";
const MAYBE_BUSY = "Your last payment may still go through: wait until it lands, or can't any more";
const ALL_LOCKED = "Every UTxO here is locked: unlock one under UTxOs";

/**
 * `goHome` counts the times the top bar's Seedelf mark was pressed: each one
 * puts the wallet back on Home, from however deep a flow, so nothing needs
 * Back pressed several times.
 */
export function Home({ goHome = 0 }: { goHome?: number }) {
  // The public tab says which account it is showing, once there is more than
  // one: the balance below it is that account's alone, never a total.
  const accounts = useAccounts();
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
  // Lovejoin boxes on their way back, from the device's own schedule.
  const [held, setHeld] = useState<LovejoinHeld>();
  // A mix from the public account being sent: what it spends, and its change, are out of the balance meanwhile.
  const [mixing, setMixing] = useState<MixProgress>(null);

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

  // Ask about the sent transaction; once it's confirmed, or let go (nothing
  // was sent, and its UTxOs count again), read the balances again: what the
  // worker marked as behind. After a private spend that's only the private
  // side, so Koios doesn't see the public account read in the same second
  // (privacy review §2.9).
  const watch = useCallback(async () => {
    try {
      const p = await call("pending-tx", {});
      if (!p) {
        // The worker no longer watches it: one that may have gone through holds nothing back any more.
        setPending((was) => (was && unsettled(was) && was.maybeSent ? null : was));
        return;
      }
      setPending(p);
      if (p.confirmations !== null || p.dropped) void load(false);
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
    const read = () => {
      void call("sessions", {}).then(
        (all) => live && setSwaps(all.filter(isRunningSwap)),
        () => undefined,
      );
      void call("lovejoin-held", {}).then(
        (h) => live && setHeld(h),
        () => undefined,
      );
      // The device's record: no Koios request, but for a look, at most every two minutes, for a public mix's
      // transaction that may have gone through (lovejoin.ts, PUBLIC_LOOK_MS).
      void call("lovejoin-mix-public-progress", {}).then(
        (m) => live && setMixing(m),
        () => undefined,
      );
    };
    void read();
    const timer = setInterval(() => void read(), 20_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [screen]);

  // Until the first reading (or its error), a splash covers the empty balances.
  const splash = useSplash(balances !== undefined || error !== undefined);

  // Waiting on the sent transaction holds new payments back: for 10 minutes,
  // or, when Koios didn't answer it, until the worker settles it.
  const watching = pending !== null && unsettled(pending) && (!!pending.maybeSent || now - pending.submittedAt < HOLD_MS);
  // One from the public account can land until its slot: the worker watches it that long, and so does Home, less often.
  const settling = pending !== null && unsettled(pending) && pending.invalidHereafter !== undefined;
  useEffect(() => {
    if (!watching && !settling) return;
    const timer = setInterval(() => void watch(), watching ? WATCH_EVERY_MS : SETTLE_EVERY_MS);
    return () => clearInterval(timer);
  }, [watching, settling, watch]);
  const busy = pending?.maybeSent ? MAYBE_BUSY : BUSY;

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
    ? busy
    : balances && balances.seedelf.utxos === 0
      ? "Make some ADA private first: these are paid from your private balance"
      : free && free.seedelf.utxos === 0
        ? ALL_LOCKED
        : undefined;
  const canCreate = !!free && (free.cardano.utxos > 0 || free.seedelf.utxos > 0) && !watching;
  const createTitle = watching
    ? busy
    : balances && !canCreate
      ? balances.cardano.utxos > 0 || balances.seedelf.utxos > 0
        ? ALL_LOCKED
        : "Fund your public account first: it pays for the Seedelf"
      : undefined;
  // Move in and Send both spend the account.
  const canMoveIn = !!free && free.cardano.utxos > 0 && !watching;
  const moveInTitle = watching ? busy : balances && free && balances.cardano.utxos > 0 && !canMoveIn ? ALL_LOCKED : undefined;

  const sent = (p: PendingTx) => {
    setPending(p);
    setScreen("home");
    setRemoving(undefined);
  };
  const home = () => setScreen("home");
  // The top bar's mark: leave every flow and overlay, keeping the tab chosen.
  useEffect(() => {
    if (!goHome) return;
    setScreen("home");
    setRemoving(undefined);
    setTokensOf(undefined);
    setActivityOf(undefined);
    setUtxosOf(undefined);
    setDappStart(undefined);
  }, [goHome]);

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
        removeTitle={watching ? busy : undefined}
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
        blocked={watching ? busy : undefined}
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
        blocked={watching ? busy : undefined}
        start={dappStart}
        banner={pending ? <PendingBanner pending={pending} watching={watching} onDismiss={() => setPending(null)} /> : undefined}
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
        {pending && <PendingBanner pending={pending} watching={watching} onDismiss={() => setPending(null)} />}

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

            {held && (held.boxes > 0 || held.notMixed > 0 || held.stopped > 0) && (
              <InLovejoin held={held} now={now} onOpen={() => dapps({ dapp: "lovejoin" })} />
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
                  {accounts.several ? accounts.name : "Public account"}
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

            {mixing && !mixing.stopped && mixing.sent < mixing.total && (
              <PublicMixHolding progress={mixing} onOpen={() => dapps({ dapp: "lovejoin" })} />
            )}

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
                <div className="stack">
                  <span>Create your Seedelf before making money private: then what you make private isn't tied to it.</span>
                  <button type="button" className="link align-start" onClick={() => setScreen("create")}>
                    Create a Seedelf
                  </button>
                </div>
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

/** Swaps running by themselves, as Minswap's page lists them: each opens its page, where it's watched. */
function RunningSwaps({ swaps, onOpen }: { swaps: SessionView[]; onOpen: (index: number) => void }) {
  return (
    <section className="section" aria-labelledby="swaps-running-title">
      <h2 id="swaps-running-title">Swaps in progress</h2>
      <ul className="list" data-testid="swaps-running">
        {swaps.map((s) => (
          <li key={s.index}>
            <SwapRow session={s} onOpen={() => onOpen(s.index)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A transaction the chain hasn't shown, and the worker hasn't let go. */
const unsettled = (p: PendingTx) => p.confirmations === null && !p.dropped;

type MixProgress = { total: number; sent: number; stopped?: string } | null;

/**
 * A mix from the public account being sent, on the public tab: the worker
 * leaves what it spends, and the change it leaves, out of the balance until
 * it's all sent, so the balance doesn't look as if some of it vanished.
 */
export function PublicMixHolding({ progress, onOpen }: { progress: NonNullable<MixProgress>; onOpen: () => void }) {
  return (
    <Callout tone="info" testId="home-mix-holding">
      <div className="stack-tight">
        <span>
          A mix through Lovejoin is being sent from this account: {progress.sent} of {progress.total} transactions so far.
          What it spends, and its change, are held by the mix, and left out of this balance until it's all sent.
        </span>
        <button type="button" className="link align-start" onClick={onOpen}>
          Open Lovejoin
        </button>
      </div>
    </Callout>
  );
}

/**
 * Lovejoin's boxes on their way back into the private balance, each after its
 * own wait: not counted in the balance until they're here. Boxes a chain cut
 * short didn't mix never come back by themselves, and a mix that stopped
 * partway needs looking at: both are said under it. Opens Lovejoin's page.
 * Every box is 10 ₳, so the counts are hidden with the balances.
 */
export function InLovejoin({ held, now, onOpen }: { held: LovejoinHeld; now: number; onOpen: () => void }) {
  const amounts = useAmounts();
  // Due, it goes a few minutes on: never the moment the wallet unlocks, nor right after it sends something else.
  const next = held.next === null ? "" : held.next <= now ? "Next back in a few minutes" : `Next back ${whenOf(held.next, new Date(now))}`;
  // Boxes not mixed yet have no due time: they're the row's own when none is on its way back.
  const boxes = held.boxes || held.notMixed;
  const lovelace = held.boxes ? held.lovelace : (BigInt(held.notMixed) * LOVEJOIN_BOX).toString();
  // How many aren't mixed yet is an amount too: said without the number while balances are hidden (privacy review §2.16).
  // Those Koios hasn't said the making of yet, after a restore, may be mixed: said apart (independent review M14).
  const unsure = Math.min(held.unsure ?? 0, held.notMixed);
  const flags = [
    held.notMixed > unsure ? `${amounts.hidden ? "some" : held.notMixed - unsure} not mixed yet` : "",
    unsure ? `${amounts.hidden ? "some" : unsure} not known to be mixed yet` : "",
    held.stopped ? (held.stopped === 1 ? "a mix stopped partway" : `${held.stopped} mixes stopped partway`) : "",
  ].filter(Boolean);
  const flagged = flags.join(", and ");
  return (
    <section className="section" aria-labelledby="in-lovejoin-title">
      <h2 id="in-lovejoin-title">In Lovejoin</h2>
      <button type="button" className="token-row" onClick={onOpen} data-testid="in-lovejoin">
        <span className="avatar avatar--contact" aria-hidden="true">
          <ShieldIcon size={16} />
        </span>
        <span className="token-row__label">{boxes ? `${amounts.count(boxes, "box", "boxes")} of 10 ₳` : "Your mixes"}</span>
        <span className="token-row__amount">{boxes ? `${amounts.ada(lovelace)} ₳` : ""}</span>
        <span className="token-row__sub">{held.boxes ? next : held.notMixed ? "Not on their way back" : ""}</span>
        {flagged && (
          <span className="token-row__detail" data-testid="in-lovejoin-flag">
            {flagged.charAt(0).toUpperCase() + flagged.slice(1)}: open Lovejoin to see what to do.
          </span>
        )}
      </button>
    </section>
  );
}

/** What every Lovejoin box holds. */
const LOVEJOIN_BOX = 10_000_000n;

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
