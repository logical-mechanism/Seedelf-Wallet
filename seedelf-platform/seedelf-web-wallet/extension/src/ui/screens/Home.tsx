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
//
// Chunk 23's second review: a balance counts what the wallet's own sent
// transaction pays back to it before the chain shows it (a payment's change,
// a Make private's deposit: background/incoming.ts), and says so, so a pending
// payment no longer reads as a loss (HM-1, HM-2). After an action Home opens
// on the side it spent from, and a reload keeps the tab (HM-6).
//
// Right after a send Home reads again, from the worker's kept reading alone
// with no request: less what the send spent, with what it pays back on its
// way and the rewards it withdrew in that, not counted twice (blind test §9.1,
// §9.3). So both balances read the review's "after" at once, and nothing reads
// the public account in the same second as a private spend (privacy review
// §2.9). It said nothing until a Refresh, and a Refresh showed T08 its
// rewards twice.
//
// The blind test: each tab has a row for the other side, its balance and what
// it's for, which opens its tab (§9.4); Home opens at its top (§9.10). And,
// the owner's calls on it: the actions name their side ("Send privately"),
// the line under them names what each reason holds back, and a restore is
// confirmed at the top, with what the phrase holds (T03, T20a, T20b).

import { useCallback, useEffect, useState } from "react";
import { type I18nKey, joinList, joinSentences, t, useT } from "../../i18n";

import { NETWORKS } from "../../networks";
import { handlesIn } from "../../shared/handles";
import type {
  Account,
  AdaPrice,
  Balances,
  LovejoinHeld,
  PendingTx,
  SeedelfInfo,
  SessionView,
  StakeInfo,
  TokenAmount,
} from "../../shared/rpc";
import { call } from "../background";
import { AccountPicker } from "../components/AccountPicker";
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
  HistoryIcon,
  MoveInIcon,
  PieIcon,
  ReceiveIcon,
  SendIcon,
  ShieldIcon,
  SproutIcon,
  WalletIcon,
  WithdrawIcon,
} from "../components/Icons";
import { OpensAtTop } from "../components/Screen";
import { Tabs } from "../components/Tabs";
import { TokenList, type TokenAction } from "../components/TokenList";
import {
  formatFiat,
  poolLabel,
  rewardsLocked,
  spentRewards,
  tokenKey,
  unlocked,
  voteLabel,
  whenOf,
  withRewards,
} from "../format";
import { publicAccountName, useAccounts } from "../accounts";
import { useAmounts, usePreferences } from "../preferences";
import { assetFingerprint } from "../tokens";
import { Activity } from "./Activity";
import { CardanoSend } from "./CardanoSend";
import { CreateSeedelf } from "./CreateSeedelf";
import { Dapps, DappsRow, type DappStart } from "./Dapps";
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

/**
 * The side each kind of transaction spends from: Home goes back to that tab
 * once it's sent (chunk 23's second review, HM-6). A Seedelf's creation says
 * which side paid for it.
 */
const SPENT_FROM: Record<PendingTx["kind"], Tab> = {
  "move-in": "cardano",
  mint: "cardano",
  send: "cardano",
  collateral: "cardano",
  stake: "cardano",
  vote: "cardano",
  "withdraw-rewards": "cardano",
  unstake: "cardano",
  "drep-register": "cardano",
  "drep-update": "cardano",
  "drep-retire": "cardano",
  "drep-vote": "cardano",
  transfer: "seedelf",
  withdraw: "seedelf",
  remove: "seedelf",
  "session-out": "seedelf",
  "session-swap": "seedelf",
  "session-cancel": "seedelf",
  "session-back": "seedelf",
  "lovejoin-withdraw": "seedelf",
  "lovejoin-mix": "seedelf",
};

/**
 * The tab last chosen, kept for this page alone so a reload opens on it (HM-6):
 * sessionStorage, which may be refused, and never chrome.storage. Private when
 * nothing's kept.
 */
const TAB_KEY = "seedelf.homeTab";
function keptTab(): Tab {
  try {
    return sessionStorage.getItem(TAB_KEY) === "cardano" ? "cardano" : "seedelf";
  } catch {
    return "seedelf";
  }
}
function keepTab(tab: Tab): void {
  try {
    sessionStorage.setItem(TAB_KEY, tab);
  } catch {
    // Not kept: the next reload opens on Private.
  }
}
/** Forgets it: a lock, or a wallet removed, starts the next Home over on Private (App.tsx). */
export function forgetHomeTab(): void {
  try {
    sessionStorage.removeItem(TAB_KEY);
  } catch {
    // Nothing was kept.
  }
}

const BUSY = "home.busy.wait" as const;
const MAYBE_BUSY = "home.busy.maybe" as const;
const ALL_LOCKED = "home.busy.allLocked" as const;

/** Why an action can't be pressed: a key, or "busy", the last transaction's own words (it may have gone through). */
export type Why = I18nKey | "busy" | undefined;

/**
 * Why each of the Private tab's actions can't be pressed, as keys: Send and Make public's (`spend`), Create's
 * (`create`), and the lines said under them (`lines`), so two that say the same are said once. A side emptied by a
 * transaction whose change is on its way waits for it, rather than asking for money. Exported for its tests.
 *
 * Each line names what it's about, as a press can't be connected to a reason otherwise (blind test T03: the tooltips
 * were never seen, on a touch screen or a keyboard there are none). Create gives its own reason where it differs from
 * Send's: Send's was shown for both, telling a new wallet to make ADA private first while Get started said to create
 * the Seedelf first. With nothing anywhere and no Seedelf, funding the account is the one step, for all three, and
 * its line says so for each (chunk 23's second review, GS-1; blind test T03).
 */
export function privateWhy(
  balances: Balances | undefined,
  watching: boolean,
): { canSpend: boolean; canCreate: boolean; unfunded: boolean; spend: Why; create: Why; lines: Exclude<Why, undefined>[] } {
  if (!balances) return { canSpend: false, canCreate: false, unfunded: false, spend: undefined, create: undefined, lines: [] };
  const seedelfs = balances.seedelf.seedelfs;
  // Each side less what's locked: the rewards a payment may spend change no count of UTxOs.
  const free = { seedelf: unlocked(balances.seedelf).utxos, cardano: unlocked(balances.cardano).utxos };
  const canSpend = free.seedelf > 0 && !watching;
  const spend: Why = watching
    ? "busy"
    : balances.seedelf.utxos === 0
      ? balances.seedelf.incoming
        ? BUSY
        : // Get started's order: with no Seedelf yet, creating one comes before making ADA private (GS-1).
          seedelfs.length === 0
          ? "home.busy.createFirst"
          : "home.busy.makePrivateFirst"
      : free.seedelf === 0
        ? ALL_LOCKED
        : undefined;
  const canCreate = (free.cardano > 0 || free.seedelf > 0) && !watching;
  // Nothing on either side, and nothing on its way: the account has to be funded first.
  const unfunded =
    balances.cardano.utxos === 0 && balances.seedelf.utxos === 0 && !balances.cardano.incoming && !balances.seedelf.incoming;
  const create: Why = watching
    ? "busy"
    : !canCreate
      ? unfunded
        ? "home.busy.fundFirst"
        : balances.cardano.utxos > 0 || balances.seedelf.utxos > 0
          ? ALL_LOCKED
          : BUSY
      : undefined;
  const both: Why[] = [canSpend ? undefined : spend, canCreate ? undefined : create];
  const lines: Exclude<Why, undefined>[] =
    seedelfs.length === 0 && unfunded && !watching
      ? ["home.busy.fundFirstAll"]
      : [...new Set(both)].filter((why): why is Exclude<Why, undefined> => !!why);
  return { canSpend, canCreate, unfunded, spend, create, lines };
}

/**
 * `goHome` counts the times the top bar's Seedelf mark was pressed: each one
 * puts the wallet back on Home, from however deep a flow, so nothing needs
 * Back pressed several times.
 */
export function Home({ goHome = 0 }: { goHome?: number }) {
  const t = useT();
  // The public tab says which account it is showing, once there is more than
  // one: the balance below it is that account's alone, never a total.
  const accounts = useAccounts();
  const activeAccount = accounts.accounts.find((a) => a.index === accounts.active) ?? { index: accounts.active };
  // A switch the worker refused, said under the heading that is the picker.
  const [accountError, setAccountError] = useState<string>();
  const [account, setAccount] = useState<Account>();
  const [balances, setBalances] = useState<Balances>();
  const [reading, setReading] = useState(false);
  // What failed, and when: a reading made after it clears it, however it came (chunk 23's second review, HM-5);
  // the kept one a page is served meanwhile doesn't.
  const [error, setError] = useState<{ message: string; at: number }>();
  const [now, setNow] = useState(Date.now);
  const [tab, setTab] = useState<Tab>(keptTab);
  useEffect(() => keepTab(tab), [tab]);
  // Where public Receive's Back goes: Home, or the screen that offered the public address (GS-5).
  // Where Back goes from the public Receive, or Make public, opened from another screen than Home: back there (GS-5).
  const [backTo, setBackTo] = useState<"home" | "receive-seedelf" | "create" | "staking">("home");
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
  // An address private Send handed on, with the amount typed: to Make public or the public account's Send, as the
  // user chose (chunk 23's review, P-1; blind test §9.7).
  const [payTo, setPayTo] = useState<{ to: string; amount: string }>();
  // A token a token's details started a payment with, picked in the form (chunk 23's review, T-1).
  const [picked, setPicked] = useState<Record<string, string>>();
  const [tokensOf, setTokensOf] = useState<Tab>();
  const [activityOf, setActivityOf] = useState<Tab>();
  // The list Activity's row for the other side was pressed from: Back goes back to it (blind test E01).
  const [activityFrom, setActivityFrom] = useState<Tab>();
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
      // The worker's last failed reading since this one, when there is one: the alert follows it, so coming back
      // from Settings, which replaced Home and its state, or a reload, keeps it until a reading succeeds (blind
      // test E05; HM-5 meant it to clear only then). Without it, a failure this page met still stands against an
      // older reading.
      const failed = b.failed;
      setError((was) =>
        failed
          ? { message: failed.message ?? (was && was.at >= failed.at ? was.message : ""), at: failed.at }
          : was && b.updatedAt < was.at
            ? was
            : undefined,
      );
      return b;
    } catch (e) {
      setError({ message: (e as Error).message, at: Date.now() });
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
    call("account", {}).then(setAccount, (e: Error) => setError({ message: e.message, at: Date.now() }));
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

  // A restore's note (blind test T20a, T20b): the worker keeps the mark, so it's whichever page opens Home next, the
  // restore's tab or a side panel. Said once: the mark goes when this Home has shown what the reading found, or on
  // Dismiss; this Home keeps the note until dismissed.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    call("restored", {}).then(setRestored, () => undefined);
  }, []);
  useEffect(() => {
    if (restored && balances) void call("restored", { seen: true }).catch(() => undefined);
  }, [restored, balances !== undefined]);

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
  const busy = t(pending?.maybeSent ? MAYBE_BUSY : BUSY);

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
  // Why each of the Private tab's actions can't be pressed (privateWhy).
  const { canSpend, canCreate, unfunded, spend: spendWhy, create: createWhy, lines } = privateWhy(balances, watching);
  const say = (why: Why) => (why === "busy" ? busy : why && t(why));
  const spendTitle = say(spendWhy);
  const createTitle = say(createWhy);
  // Move in and Send both spend the account.
  const canMoveIn = !!free && free.cardano.utxos > 0 && !watching;
  const moveInTitle = watching
    ? busy
    : balances && free && !canMoveIn
      ? balances.cardano.utxos > 0
        ? t(ALL_LOCKED)
        : balances.cardano.incoming
          ? t(BUSY)
          : undefined
      : undefined;
  // Why a tab's actions can't be pressed, said under them: a tooltip alone reached no touch screen, and the
  // public tab had none for an empty account (chunk 23's review, H-1, H-10).
  const privateReasons = lines.map((why) => say(why)).filter((r): r is string => !!r);
  const publicReason = !balances || canMoveIn ? undefined : (moveInTitle ?? t("home.busy.publicEmpty"));
  // Until there's a Seedelf, making money private isn't the next step: creating one is, and the callout under the
  // balance says so, so the action row doesn't contradict it (H-4). An empty account's next step is Receive.
  const seedelfFirst = !!balances && seedelfs.length === 0;
  const publicEmpty = !!balances && balances.cardano.utxos === 0 && !balances.cardano.incoming;

  // Home opens on the side the transaction spent from (HM-6): a Seedelf's creation says which paid. Its balances are
  // read again from the worker's kept reading alone, which asks Koios nothing (blind test §9.3, privacy review §2.9):
  // what the send spent is out of them, and what it pays back is on its way. With none kept (one too large to keep,
  // or dropped by a public mix), Home keeps what it shows until the watch reads again.
  const sent = (p: PendingTx, from: Tab = SPENT_FROM[p.kind]) => {
    sentHere(p);
    setScreen("home");
    setTab(from);
    setRemoving(undefined);
    setPicked(undefined);
    setBackTo("home");
  };
  // A transaction sent from a screen that stays open (a DRep's vote, a Lovejoin withdraw or mix): watched, and the
  // balances read again the same way.
  const sentHere = (p: PendingTx) => {
    setPending(p);
    call("balances", { kept: true }).then(setBalances, () => undefined);
  };
  const home = () => {
    setScreen("home");
    setPicked(undefined);
    setBackTo("home");
  };
  // A token's details start a payment with it, from the side it's in, when one can be made now.
  const tokenAction = (side: Tab) =>
    (side === "cardano" ? canMoveIn : canSpend)
      ? (action: TokenAction, token: TokenAmount) => {
          setPicked({ [tokenKey(token)]: "" });
          setTokensOf(undefined);
          setScreen(side === "cardano" ? (action === "send" ? "send" : "move-in") : action === "send" ? "transfer" : "withdraw");
        }
      : undefined;
  // The public address, from Home's Private tab (Get started's first step, and the way on under a new wallet's reason):
  // Back comes back to this tab. It switched Home to Public unsaid, and T03's tester came back to a tab they hadn't
  // left (blind test T03, §5; GS-5's rule for the address).
  const showAddress = () => {
    setBackTo("home");
    setScreen("receive");
  };
  // The top bar's mark: leave every flow and overlay, keeping the tab chosen.
  useEffect(() => {
    if (!goHome) return;
    setScreen("home");
    setBackTo("home");
    setRemoving(undefined);
    setPayTo(undefined);
    setPicked(undefined);
    setTokensOf(undefined);
    setActivityOf(undefined);
    setActivityFrom(undefined);
    setUtxosOf(undefined);
    setDappStart(undefined);
  }, [goHome]);

  const dapps = (start?: DappStart) => {
    setDappStart(start);
    setScreen("dapps");
  };
  // The other side's row: its tab, which opens at its top, and its tab button takes the focus, as the arrow keys
  // leave it, since the row pressed goes with the panel (blind test §9.4).
  const toSide = (side: Tab) => {
    document.getElementById(`tab-${side}`)?.focus({ preventScroll: true });
    setTab(side);
  };
  // Remove is reached from Receive, and Back returns there.
  if (removing) {
    return <RemoveSeedelf seedelf={removing} onCancel={() => setRemoving(undefined)} onSent={sent} />;
  }
  // The public address, from a screen that offered it: Back returns to that screen, not to Home (GS-5).
  const publicAddressFrom = (from: "receive-seedelf" | "create" | "staking") => () => {
    setBackTo(from);
    setScreen("receive");
  };
  if (screen === "receive" && account) {
    return (
      <Receive
        account={account}
        handles={handlesIn(balances?.cardano.tokens ?? [])}
        onBack={backTo === "home" ? home : () => setScreen(backTo)}
        onPrivate={() => setScreen("receive-seedelf")}
      />
    );
  }
  if (screen === "receive-seedelf") {
    return (
      <ReceiveSeedelf
        seedelfs={seedelfs}
        onBack={home}
        onCreate={() => setScreen("create")}
        createTitle={canCreate ? undefined : createTitle}
        onFund={unfunded ? publicAddressFrom("receive-seedelf") : undefined}
        onPublic={publicAddressFrom("receive-seedelf")}
        onRemove={setRemoving}
        removeTitle={watching ? busy : undefined}
      />
    );
  }
  // Both balances as Home shows them, for a review's "balance after" (chunk 23's review, S-1).
  const totals = balances && reviewTotals(balances);
  if (screen === "move-in" && free) {
    return <MoveIn cardano={free.cardano} rewards={rewardsProp} totals={totals} picked={picked} onCancel={home} onSent={sent} />;
  }
  if (screen === "send" && free) {
    return (
      <CardanoSend
        cardano={free.cardano}
        rewards={rewardsProp}
        total={totals?.public}
        picked={picked}
        to={payTo?.to}
        amount={payTo?.amount}
        onCancel={() => {
          setPayTo(undefined);
          home();
        }}
        onSent={(p) => {
          setPayTo(undefined);
          sent(p);
        }}
      />
    );
  }
  if ((screen === "staking" || screen === "staking-vote") && balances) {
    return (
      <Staking
        staking={balances.cardano.staking}
        spendRewards={spendRewards}
        blocked={watching ? busy : undefined}
        start={screen === "staking-vote" ? "vote" : "overview"}
        total={totals?.public}
        // What Staking checks before a build, and the way on when the account can't pay a fee (chunk 23's second
        // review, ST-9); a vote stays on its action while Home watches it (GV-6).
        account={balances.cardano}
        onReceive={publicAddressFrom("staking")}
        onMakePublic={
          canSpend
            ? () => {
                setBackTo("staking");
                setScreen("withdraw");
              }
            : undefined
        }
        onBack={home}
        onSent={sent}
        onPending={sentHere}
      />
    );
  }
  if (screen === "create" && free) {
    return (
      <CreateSeedelf
        balances={free}
        totals={totals}
        blocked={canCreate ? undefined : createTitle}
        onFund={unfunded ? publicAddressFrom("create") : undefined}
        onCancel={home}
        onSent={(p, from) => sent(p, from === "account" ? "cardano" : "seedelf")}
      />
    );
  }
  if (screen === "transfer" && free) {
    return (
      <Transfer
        seedelf={free.seedelf}
        total={totals?.private}
        picked={picked}
        onPayAddress={(route, to, amount) => {
          setPayTo({ to, amount });
          // A token picked in the private balance isn't the public account's to send.
          if (route === "public") setPicked(undefined);
          setScreen(route === "public" ? "send" : "withdraw");
        }}
        // The public account's Send, offered beside Make public, says why it can't pay now instead of opening.
        publicBlocked={publicReason}
        onCancel={home}
        onSent={sent}
      />
    );
  }
  if (screen === "withdraw" && free) {
    return (
      <Withdraw
        seedelf={free.seedelf}
        total={totals?.private}
        to={payTo?.to}
        amount={payTo?.amount}
        picked={picked}
        onCancel={() => {
          setPayTo(undefined);
          if (backTo === "home") home();
          else setScreen(backTo);
        }}
        onSent={(p) => {
          setPayTo(undefined);
          sent(p);
        }}
      />
    );
  }
  if (screen === "dapps" && free) {
    return (
      <Dapps
        seedelf={free.seedelf}
        blocked={watching ? busy : undefined}
        start={dappStart}
        banner={
          pending ? <PendingBanner pending={pending} watching={watching} onDismiss={() => setPending(null)} onCheck={watch} /> : undefined
        }
        onBack={home}
        onPending={sentHere}
      />
    );
  }
  if (activityOf) {
    const pendingHash = watching ? pending?.txHash : undefined;
    const other: Tab = activityOf === "seedelf" ? "cardano" : "seedelf";
    return (
      <Activity
        // A list of its own, read afresh: the other side's entries never show under this one's title meanwhile.
        key={activityOf}
        of={activityOf}
        pendingHash={pendingHash}
        banner={
          pending ? <PendingBanner pending={pending} watching={watching} onDismiss={() => setPending(null)} onCheck={watch} /> : undefined
        }
        // Back returns to the list the other one was opened from, then Home, on the tab it was left on.
        onBack={() => {
          setActivityOf(activityFrom);
          setActivityFrom(undefined);
        }}
        onRead={() => void load(false)}
        // The other side's list, read only now, at the press: the public account's from Koios, as its own tab's
        // Activity reads it. Pressed in a list opened that way, it's the way back, so the lists don't pile up.
        onOther={() => {
          setActivityFrom(activityFrom === other ? undefined : activityOf);
          setActivityOf(other);
        }}
      />
    );
  }
  // Each side's tokens with those on their way back counted in, and which those are (HM-1).
  const privateTokens = balances && withComing(balances.seedelf);
  const publicTokens = balances && withComing(balances.cardano);
  // Why a token's details offer no payment, when it's the one transaction at a time (HM-3).
  const tokenBlocked = watching ? busy : undefined;
  if (tokensOf && privateTokens && publicTokens) {
    const back = () => setTokensOf(undefined);
    const { tokens, coming } = tokensOf === "seedelf" ? privateTokens : publicTokens;
    return (
      <Tokens tokens={tokens} coming={coming} of={tokensOf} onBack={back} onAction={tokenAction(tokensOf)} blocked={tokenBlocked} />
    );
  }
  if (utxosOf) {
    // Locking or refreshing there changes the kept reading: Home picks it up, with no request. What's on its way back
    // to the side goes with it, from this reading, so the list says why it adds up to less (blind test T08).
    return (
      <Utxos
        of={utxosOf}
        incoming={balances?.[utxosOf].incoming}
        onBack={() => setUtxosOf(undefined)}
        onChanged={() => void load(false)}
      />
    );
  }

  return (
    <>
      {/* At its top coming back from anything, so a sent transaction's banner is the first thing seen (blind test
          T03), on another tab, and on the top bar's mark. */}
      <OpensAtTop page={`${tab}:${goHome}`} />
      <Splash phase={splash} />
      <div className={splash === "wait" || splash === "show" ? "home home--hidden" : "home"}>
        {/* What it means for the screen, and the way on; the service's own words, its name and status code, wait
            under Details (chunk 23's review, L-2). The balances last read stay on screen. */}
        {/* One time, the "Updated" line's: the alert's own froze while that one ticked on. Details sit inside it, and
            a reading made since clears it (chunk 23's second review, HM-5). */}
        {error && (
          <div data-testid="home-read-failed">
            <Callout tone="warn" role="alert">
              <div className="stack-tight">
                <strong>{balances ? t("home.warn.stale") : t("home.warn.readFailed")}</strong>
                {/* What's true and useful when it keeps failing: only reading failed, and nothing needs doing
                    (blind test §4 entry 25). */}
                <span>{t("home.warn.readSafe")}</span>
                <button type="button" className="link align-start" onClick={() => void load(true)} disabled={reading}>
                  {reading ? t("home.trying") : t("common.tryAgain")}
                </button>
                {error.message && (
                  <details className="disclosure">
                    <summary>{t("common.details")}</summary>
                    <p className="note">{error.message}</p>
                  </details>
                )}
              </div>
            </Callout>
          </div>
        )}
        {pending && (
          <PendingBanner pending={pending} watching={watching} onDismiss={() => setPending(null)} onCheck={watch} />
        )}
        {restored && (
          <RestoredNote
            balances={balances}
            failed={!!error}
            onDismiss={() => {
              void call("restored", { seen: true }).catch(() => undefined);
              setRestored(false);
            }}
          />
        )}

        <Tabs
          label={t("home.tabsLabel")}
          tabs={[
            { value: "seedelf", label: t("home.tab.private") },
            { value: "cardano", label: t("home.tab.public") },
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
                  {t("home.private.title")}
                </h1>
                <HideToggle />
              </div>
              <Amount lovelace={balances && privateTotal(balances.seedelf)} price={price} testId="seedelf-lovelace" />
              {/* What's locked, and nothing else: a UTxO count is the UTxOs page's (chunk 23's review, H-5). */}
              {balances && lockedMeta(balances.seedelf, amounts.ada, "seedelf-meta")}
              {balances && incomingMeta(balances.seedelf, "seedelf-incoming")}
              {/* Each label names its side, as the accessible names did alone: a sighted user couldn't tell this
                  Receive or Send from the Public tab's (blind test T03, T20b, §5; the owner's call, 2026-10-05). And
                  Create names what it makes, which the reason under the row calls "your Seedelf". */}
              <div className="hero__actions">
                <ActionButton
                  icon={<ReceiveIcon />}
                  label={t("home.action.receivePrivately")}
                  onClick={() => setScreen("receive-seedelf")}
                  disabled={!balances}
                />
                <ActionButton
                  primary
                  icon={<SendIcon />}
                  label={t("home.action.sendPrivately")}
                  onClick={() => setScreen("transfer")}
                  disabled={!canSpend}
                  title={spendTitle}
                />
                <ActionButton
                  icon={<WithdrawIcon />}
                  label={t("home.action.makePublic")}
                  onClick={() => setScreen("withdraw")}
                  disabled={!canSpend}
                  title={spendTitle}
                />
                <ActionButton
                  icon={<SproutIcon />}
                  label={t("home.action.createSeedelf")}
                  onClick={() => setScreen("create")}
                  disabled={!canCreate}
                  title={createTitle}
                />
              </div>
              {privateReasons.length > 0 && (
                <p className="hero__reason" data-testid="seedelf-reason">
                  {privateReasons.map((reason) => (
                    <span key={reason} className="hero__reason-line">
                      {reason}
                    </span>
                  ))}
                </p>
              )}
              {/* The way on, under the reason that asks for it: on a new wallet, Get started's own button sat below
                  the fold at 360×640, and the one lit action above it, Receive privately, says there's no Seedelf yet
                  (the pass-two visual check). Filled, as the tab's next step; Get started keeps its own. */}
              {lines.includes("home.busy.fundFirstAll") && (
                <button type="button" className="primary primary--compact hero__way" onClick={showAddress} data-testid="seedelf-fund">
                  {t("receive.seedelfs.showPublic")}
                </button>
              )}
            </div>

            {balances && (seedelfs.length === 0 || balances.seedelf.utxos === 0) && (
              <GettingStarted
                balances={balances}
                watching={watching}
                // One button for the first step: the hero's, above the fold (the pass-two visual check).
                fundAbove={lines.includes("home.busy.fundFirstAll")}
                onReceive={showAddress}
                onCreate={() => setScreen("create")}
                onMoveIn={() => setScreen("move-in")}
              />
            )}

            {balances && handlesIn(balances.seedelf.tokens).length > 0 && (
              <Callout tone="warn" testId="private-handle">
                {joinSentences([handleWarning(handlesIn(balances.seedelf.tokens)), t("home.handles.makePublic")])}
              </Callout>
            )}

            {/* The public side from the tab Home opens on: 11 of 29 blind runs looked here first for what lives there,
                and once Get started was gone nothing here said it existed (blind test §9.4). After Get started and the
                handle warning, which are this tab's next step and what to act on, and so under the hero when neither
                shows. */}
            <OtherSide side="cardano" lovelace={balances && shownAccountTotal(balances.cardano)} onOpen={() => toSide("cardano")} />

            {privateTokens && privateTokens.tokens.length > 0 && (
              <section className="section" aria-labelledby="seedelf-tokens-title">
                <h2 id="seedelf-tokens-title">{t("home.tokens")}</h2>
                <TokenList
                  tokens={privateTokens.tokens}
                  coming={privateTokens.coming}
                  of="seedelf"
                  testId="seedelf-tokens"
                  onViewAll={() => setTokensOf("seedelf")}
                  onAction={tokenAction("seedelf")}
                  blocked={tokenBlocked}
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
              {/* With several accounts, the heading is the switch between them: "Public account 2 ▾" (the owner,
                  2026-10-06). It was a row of its own under the top bar, on every screen. */}
              <div className="hero__head">
                <h1 id="cardano-account" className={accounts.several ? "sr-only" : "hero__label"}>
                  {accounts.several ? publicAccountName(activeAccount) : t("home.public.title")}
                </h1>
                <AccountPicker onError={setAccountError} />
                <HideToggle />
              </div>
              {accountError && (
                <p className="error hero__error" role="alert">
                  {accountError}
                </p>
              )}
              <Amount lovelace={balances && shownAccountTotal(balances.cardano)} price={price} testId="cardano-lovelace" />
              {balances && lockedMeta(balances.cardano, amounts.ada, "cardano-meta")}
              {balances && incomingMeta(balances.cardano, "cardano-incoming")}
              {/* The rewards are in the balance, as other wallets count them: said here, so the staking row's figure
                  doesn't read as more on top, and, when payments leave them alone, so a form that finds less to spend
                  doesn't contradict it (chunk 23's second review, ST-6). */}
              {balances && BigInt(balances.cardano.staking.rewards) > 0n && (
                <span className="hero__meta" data-testid="cardano-rewards">
                  {t(rewards > 0n ? "home.rewardsIn" : "home.rewardsInUnspent", { amount: amounts.ada(balances.cardano.staking.rewards) })}
                </span>
              )}
              {/* Named by their side, as on the Private tab. */}
              <div className="hero__actions">
                <ActionButton
                  primary={publicEmpty}
                  icon={<ReceiveIcon />}
                  label={t("home.action.receivePublicly")}
                  onClick={() => {
                    setBackTo("home");
                    setScreen("receive");
                  }}
                  disabled={!account}
                />
                <ActionButton
                  icon={<SendIcon />}
                  label={t("home.action.sendPublicly")}
                  onClick={() => setScreen("send")}
                  disabled={!canMoveIn}
                  title={moveInTitle}
                />
                <ActionButton
                  primary={!seedelfFirst && !publicEmpty}
                  icon={<MoveInIcon />}
                  label={t("home.action.makePrivate")}
                  onClick={() => setScreen("move-in")}
                  disabled={!canMoveIn}
                  title={moveInTitle}
                />
              </div>
              {publicReason && (
                <p className="hero__reason" data-testid="cardano-reason">
                  {publicReason}
                </p>
              )}
            </div>

            {mixing && !mixing.stopped && mixing.sent < mixing.total && (
              <PublicMixHolding progress={mixing} onOpen={() => dapps({ dapp: "lovejoin" })} />
            )}

            {balances && <StakingRow staking={balances.cardano.staking} onOpen={() => setScreen("staking")} />}
            {balances && rewardsLocked(balances.cardano.staking) && (
              <Callout tone="warn" testId="home-rewards-locked">
                <div className="stack-tight">
                  <span>{t("home.warn.rewardsLocked", { amount: amounts.ada(balances.cardano.staking.rewards) })}</span>
                  <button type="button" className="link align-start" onClick={() => setScreen("staking-vote")}>
                    {t("home.delegateVote")}
                  </button>
                </div>
              </Callout>
            )}

            {balances && seedelfs.length === 0 && (
              <Callout tone="privacy" testId="mint-first">
                <div className="stack">
                  <span>{t("home.privacy.mintFirst")}</span>
                  {/* Once the account can pay for it, this is the tab's next step, so it's the filled button (H-4). */}
                  {/* Held, like the hero's actions, while the last transaction confirms; the reason is the hero's
                      (chunk 23's second review, HM-3). */}
                  <button
                    type="button"
                    className={canCreate ? "primary primary--compact align-center" : "link align-start"}
                    onClick={() => setScreen("create")}
                    disabled={watching}
                    title={watching ? busy : undefined}
                  >
                    {t("home.action.createSeedelf")}
                  </button>
                </div>
              </Callout>
            )}

            {/* And the private side from here, whichever tab Home opens on (the owner's call, GS-3). Under staking,
                which stays where this tab's users found it, and under the note whose Create a Seedelf is a new
                wallet's next step (H-4); a swap was looked for here (blind test T10). */}
            <OtherSide side="seedelf" lovelace={balances && privateTotal(balances.seedelf)} onOpen={() => toSide("seedelf")} />

            {publicTokens && publicTokens.tokens.length > 0 && (
              <section className="section" aria-labelledby="cardano-tokens-title">
                <h2 id="cardano-tokens-title">{t("home.tokens")}</h2>
                <TokenList
                  tokens={publicTokens.tokens}
                  coming={publicTokens.coming}
                  of="cardano"
                  testId="cardano-tokens"
                  onViewAll={() => setTokensOf("cardano")}
                  onAction={tokenAction("cardano")}
                  blocked={tokenBlocked}
                />
              </section>
            )}

            {/* dApps here too: sites connect to the public account, and T15 looked for them on this tab (blind test
                §9.2). */}
            <Links onActivity={() => setActivityOf("cardano")} onUtxos={() => setUtxosOf("cardano")} onDapps={() => dapps()} />
          </section>
        )}
      </div>
    </>
  );
}

/** "5 ₳ locked" under a balance, when some of it is. */
function lockedMeta(side: Balances["seedelf" | "cardano"], ada: (lovelace: string) => string, testId: string) {
  if (!side.locked.utxos) return null;
  return (
    <span className="hero__meta" data-testid={testId}>
      {t("home.locked", { amount: ada(side.locked.lovelace) })}
    </span>
  );
}

/**
 * "Includes 1.2 ₳ on its way to this balance" under a balance, while the wallet's own sent transaction pays some
 * back to it that the chain doesn't show yet: a payment's change, a Make private's deposit (chunk 23's second review,
 * HM-1, HM-2). Which way it goes is said: T08 couldn't tell whether "35.300614 ₳ of this is on its way" was leaving or
 * coming back. And the staking rewards it withdrew, which are in it: their line goes at once (blind test §9.1).
 */
function incomingMeta(side: Balances["seedelf"] | Balances["cardano"], testId: string) {
  const rewards = "withdrawing" in side ? side.withdrawing : undefined;
  return side.incoming ? <IncomingMeta incoming={side.incoming} rewards={rewards} testId={testId} /> : null;
}

function IncomingMeta({
  incoming,
  rewards,
  testId,
}: {
  incoming: NonNullable<Balances["cardano"]["incoming"]>;
  rewards?: string;
  testId: string;
}) {
  const t = useT();
  const amounts = useAmounts();
  const what = incoming.tokens.length
    ? t("format.adaAndTokens", { ada: amounts.ada(incoming.lovelace), count: incoming.tokens.length })
    : `${amounts.ada(incoming.lovelace)}\u00a0₳`;
  return (
    <span className="hero__meta" data-testid={testId}>
      {rewards ? t("home.incomingRewards", { what, rewards: amounts.ada(rewards) }) : t("home.incoming", { what })}
    </span>
  );
}

/** The private balance as Home shows it: what's on its way back counted in. */
function privateTotal(seedelf: Balances["seedelf"]): string {
  return (BigInt(seedelf.lovelace) + BigInt(seedelf.incoming?.lovelace ?? "0")).toString();
}

/** The public account as Home shows it: its UTxOs, its rewards and what's on its way back. */
function shownAccountTotal(cardano: Balances["cardano"]): string {
  return (BigInt(accountTotal(cardano)) + BigInt(cardano.incoming?.lovelace ?? "0")).toString();
}

/**
 * Both balances as Home shows them, for a review's "… after": each side's figure on Home, what's on its way back
 * included. Without it, a review read short of Home by all of it, a session's return or a payment's change say.
 */
export function reviewTotals(balances: Balances): { public: string; private: string } {
  return { public: shownAccountTotal(balances.cardano), private: privateTotal(balances.seedelf) };
}

/**
 * A side's tokens with those on their way back added in, and which those are: a payment's change took every token
 * of the coin it spent out of the list until it confirmed (HM-1).
 */
function withComing(side: { tokens: TokenAmount[]; incoming?: Balances["cardano"]["incoming"] }): {
  tokens: TokenAmount[];
  coming?: ReadonlySet<string>;
} {
  const coming = side.incoming?.tokens ?? [];
  if (!coming.length) return { tokens: side.tokens };
  const all = new Map(side.tokens.map((token) => [tokenKey(token), { ...token }]));
  for (const c of coming) {
    const had = all.get(tokenKey(c));
    if (had) had.quantity = (BigInt(had.quantity) + BigInt(c.quantity)).toString();
    // Read from the transaction, it carries no fingerprint or decimals of its own.
    else all.set(tokenKey(c), { ...c, fingerprint: c.fingerprint || assetFingerprint(c) });
  }
  return { tokens: [...all.values()], coming: new Set(coming.map(tokenKey)) };
}

/** Why an ADA Handle doesn't belong in Seedelf: what's paid to it can be taken by anyone. */
export function handleWarning(handles: string[]): string {
  return t("home.handles.warn.inPrivate", { names: joinList(handles.map((h) => `$${h}`)), count: handles.length });
}

/** The eye beside a balance: hides every amount on the screens that show what the wallet holds, or shows them again. */
function HideToggle() {
  const t = useT();
  const { prefs, set } = usePreferences();
  const hidden = prefs.hideBalances;
  return (
    <button
      type="button"
      className="icon-button icon-button--small"
      onClick={() => void set({ hideBalances: !hidden }).catch(() => undefined)}
      aria-label={t(hidden ? "home.showBalances" : "home.hideBalances")}
      aria-pressed={hidden}
      title={t(hidden ? "home.showBalances" : "home.hideBalances")}
    >
      {hidden ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </button>
  );
}

/** Everything the account holds: its UTxOs and its staking rewards, as other wallets show it. */
function accountTotal(cardano: Balances["cardano"]): string {
  return (BigInt(cardano.lovelace) + BigInt(cardano.staking.rewards)).toString();
}

/**
 * "Staking with LOGIC", or "Not staking": opens Staking. The rewards' figure is said under the balance, which counts
 * it: beside the pool it read as more on top (chunk 23's second review, ST-6).
 */
function StakingRow({ staking, onOpen }: { staking: StakeInfo; onOpen: () => void }) {
  const t = useT();
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
              <span>{t("staking.pageTitle")}</span>
              {/* Whole, on two lines if they must: cut, Japanese's "not staking" line lost what it says (the pass-two
                  visual check). */}
              <span className="menu-row__sub menu-row__sub--wrap" data-testid="staking-row-pool">
                {staking.pool
                  ? t("home.staking.pool", { pool: poolLabel(staking.pool) })
                  : rewards
                    ? t("home.staking.rewards")
                    : t("home.staking.notEarn")}
              </span>
              <span className="menu-row__sub menu-row__sub--wrap" data-testid="staking-row-vote">
                {t("home.votingPower", { what: voteLabel(staking.drep, staking.ownDrep ? t("drep.yourOwn") : undefined) })}
              </span>
            </span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
      </ul>
    </section>
  );
}

/**
 * The wallet's other side, on the tab that's showing: its balance as its own tab shows it (hidden with the eye, "—"
 * until a reading), what it's for, and its tab. Home opens on Private, and 11 of 29 blind runs looked there first for
 * an ordinary payment, an address to be paid at, staking or a vote; once Get started was gone, nothing there said a
 * public side existed (blind test §9.4). The actions name their side too, since the owner's call on that test ("Send
 * privately"): this row says where the other side's are. Exported for its tests.
 */
export function OtherSide({ side, lovelace, onOpen }: { side: "seedelf" | "cardano"; lovelace?: string; onOpen: () => void }) {
  const t = useT();
  const amounts = useAmounts();
  // Named as the Public tab's heading names it: "Public account 2" once there's more than one, as this side is
  // "Private balance" there (the owner, 2026-10-06).
  const accounts = useAccounts();
  const id = side === "cardano" ? "home-public-row" : "home-private-row";
  const name =
    side === "seedelf"
      ? t("home.private.title")
      : accounts.several
        ? publicAccountName(accounts.accounts.find((a) => a.index === accounts.active) ?? { index: accounts.active })
        : t("home.public.title");
  return (
    <section className="section">
      <ul className="list">
        <li>
          <button type="button" className="menu-row" onClick={onOpen} data-testid={id}>
            <span className="menu-row__icon">{side === "cardano" ? <WalletIcon size={16} /> : <ShieldIcon size={16} />}</span>
            <span className="menu-row__text">
              <span className="menu-row__head">
                <span>{name}</span>
                <span className="menu-row__figure" data-testid={`${id}-lovelace`}>
                  {lovelace === undefined ? "—" : amounts.ada(lovelace)}
                  {"\u00a0₳"}
                </span>
              </span>
              <span className="menu-row__sub menu-row__sub--wrap">
                {t(side === "cardano" ? "home.otherSide.public" : "home.otherSide.private")}
              </span>
            </span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
      </ul>
    </section>
  );
}

/**
 * "Wallet restored", on the Home a restore opens, once (blind test T20a, T20b): restore and create led to the same
 * Home, so an empty restored wallet looked new, and both testers wondered whether the phrase had found their wallet.
 * While the first reading runs, it says so (once it has failed, only that a used phrase's balances show once read: the
 * alert above says it failed); then what the phrase holds on each side, as Home shows them (hidden with
 * the eye), or that it holds nothing yet on this network, which is what a phrase never used holds. Once the look for
 * more accounts finds some it says what the account shown holds, by its name, and how many more the phrase used, which
 * the picker switches to: never "nothing… never used" from account 0 alone when the money is in another (the
 * pass-two review). Only accounts the look found used are counted. In the banners' style, at the top, with Dismiss.
 * Exported for its tests.
 */
export function RestoredNote({
  balances,
  failed = false,
  onDismiss,
}: {
  balances?: Balances;
  /** The reading failed: Home's alert says so, and this doesn't say it's reading. */
  failed?: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  const amounts = useAmounts();
  const accounts = useAccounts();
  const publicTotal = balances && shownAccountTotal(balances.cardano);
  const privateBalance = balances && privateTotal(balances.seedelf);
  const found = !!balances && (BigInt(publicTotal!) > 0n || BigInt(privateBalance!) > 0n || balances.seedelf.seedelfs.length > 0);
  // The other public accounts the look after the restore found used (`foundAt`): account 0 has none, used or not.
  const others = accounts.accounts.filter((a) => a.foundAt !== undefined && a.index !== accounts.active).length;
  const figures = balances && { public: `${amounts.ada(publicTotal!)}\u00a0₳`, private: `${amounts.ada(privateBalance!)}\u00a0₳` };
  const what = !balances
    ? joinSentences([!failed && t("home.restored.reading"), t("home.restored.once")])
    : others > 0
      ? t("home.restored.foundIn", { account: accounts.name, ...figures })
      : found
        ? t("home.restored.found", figures)
        : t("home.restored.empty", { network: NETWORKS[balances.network].label });
  return (
    <section className="callout tx-banner callout--done" role="status" data-testid="home-restored">
      <strong className="tx-banner__title">
        <span className="callout__icon">
          <DoneIcon size={16} />
        </span>
        {t("home.restored.title")}
      </strong>
      <div className="tx-banner__detail" data-testid="home-restored-detail">
        {joinSentences([
          what,
          others > 0 && t("home.restored.others", { count: others }),
        ])}
      </div>
      <button type="button" className="tx-banner__dismiss" onClick={onDismiss}>
        {t("common.dismiss")}
      </button>
    </section>
  );
}

/** Swaps running by themselves, as Minswap's page lists them: each opens its page, where it's watched. */
function RunningSwaps({ swaps, onOpen }: { swaps: SessionView[]; onOpen: (index: number) => void }) {
  const t = useT();
  return (
    <section className="section" aria-labelledby="swaps-running-title">
      <h2 id="swaps-running-title">{t("home.swapsRunning")}</h2>
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
  const t = useT();
  return (
    <Callout tone="info" testId="home-mix-holding">
      <div className="stack-tight">
        <span>{t("home.mixHolding", { sent: progress.sent, total: progress.total })}</span>
        <button type="button" className="link align-start" onClick={onOpen}>
          {t("home.openLovejoin")}
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
  const t = useT();
  const amounts = useAmounts();
  // Due, it goes a few minutes on: never the moment the wallet unlocks, nor right after it sends something else.
  const next =
    held.next === null
      ? ""
      : held.next <= now
        ? t("home.lovejoin.nextSoon")
        : t("home.lovejoin.next", { when: whenOf(held.next, new Date(now)) });
  // Boxes not mixed yet have no due time: they're the row's own when none is on its way back.
  const boxes = held.boxes || held.notMixed;
  const lovelace = held.boxes ? held.lovelace : (BigInt(held.notMixed) * LOVEJOIN_BOX).toString();
  // How many aren't mixed yet is an amount too: said without the number while balances are hidden (privacy review §2.16).
  // Those Koios hasn't said the making of yet, after a restore, may be mixed: said apart (independent review M14).
  const unsure = Math.min(held.unsure ?? 0, held.notMixed);
  const some = t("home.lovejoin.some");
  const flags = [
    held.notMixed > unsure ? t("home.lovejoin.flag.notMixed", { n: amounts.hidden ? some : held.notMixed - unsure }) : "",
    unsure ? t("home.lovejoin.flag.unsure", { n: amounts.hidden ? some : unsure }) : "",
    held.stopped ? t("home.lovejoin.flag.stopped", { count: held.stopped, n: held.stopped }) : "",
  ].filter(Boolean);
  const flagged = flags.join(t("home.lovejoin.flagJoin"));
  return (
    <section className="section" aria-labelledby="in-lovejoin-title">
      <h2 id="in-lovejoin-title">{t("home.lovejoin.title")}</h2>
      <button type="button" className="token-row" onClick={onOpen} data-testid="in-lovejoin">
        <span className="avatar avatar--contact" aria-hidden="true">
          <ShieldIcon size={16} />
        </span>
        <span className="token-row__label">
          {boxes ? t("home.lovejoin.boxesOf", { boxes: amounts.count(boxes, "amount.boxes") }) : t("home.lovejoin.yourMixes")}
        </span>
        <span className="token-row__amount">{boxes ? `${amounts.ada(lovelace)}\u00a0₳` : ""}</span>
        <span className="token-row__sub">{held.boxes ? next : held.notMixed ? t("home.lovejoin.notBack") : ""}</span>
        {flagged && (
          <span className="token-row__detail" data-testid="in-lovejoin-flag">
            {t("home.lovejoin.flagged", { flags: flagged.charAt(0).toUpperCase() + flagged.slice(1) })}
          </span>
        )}
      </button>
    </section>
  );
}

/** What every Lovejoin box holds. */
const LOVEJOIN_BOX = 10_000_000n;

/** Opens this tab's Activity, or its UTxOs, and the dApp browser. */
function Links({ onActivity, onUtxos, onDapps }: { onActivity: () => void; onUtxos: () => void; onDapps?: () => void }) {
  const t = useT();
  return (
    <section className="section">
      <ul className="list">
        {/* With whether sites can see the wallet, and how many are connected, under it (blind test §9.2). */}
        {onDapps && (
          <li>
            <DappsRow onOpen={onDapps} />
          </li>
        )}
        <li>
          <button type="button" className="menu-row" onClick={onActivity}>
            <span className="menu-row__icon">
              <HistoryIcon size={16} />
            </span>
            <span>{t("home.activity")}</span>
            <ChevronRightIcon size={16} />
          </button>
        </li>
        <li>
          <button type="button" className="menu-row" onClick={onUtxos}>
            <span className="menu-row__icon">
              <CoinsIcon size={16} />
            </span>
            <span>{t("home.utxos")}</span>
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
  fundAbove = false,
  onReceive,
  onCreate,
  onMoveIn,
}: {
  balances: Balances;
  watching: boolean;
  /** Show my public address is under the reason above, so the first step has no button of its own: two read as two steps. */
  fundAbove?: boolean;
  onReceive: () => void;
  onCreate: () => void;
  onMoveIn: () => void;
}) {
  const t = useT();
  const created = balances.seedelf.seedelfs.length > 0;
  const movedIn = balances.seedelf.utxos > 0;
  const funded = balances.cardano.utxos > 0 || created || movedIn;
  const steps = [
    {
      done: funded,
      title: t("home.start.fund.title"),
      text: t("home.start.fund.text"),
      // Not "Receive": the action row's Receive, just above, goes to the private side (chunk 23's review, H-2).
      action: t("home.start.fund.action"),
      onClick: onReceive,
      disabled: false,
    },
    {
      done: created,
      title: t("home.start.create.title"),
      text: t("home.start.create.text"),
      action: t("home.action.create"),
      onClick: onCreate,
      disabled: watching || !funded,
    },
    {
      done: movedIn,
      title: t("home.start.private.title"),
      text: t("home.start.private.text"),
      action: t("home.action.makePrivate"),
      onClick: onMoveIn,
      disabled: watching || balances.cardano.utxos === 0,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="section" aria-labelledby="getting-started">
      <h2 id="getting-started">{t("home.start.title")}</h2>
      {/* The two sides, said once before the steps that use them (§4 of chunk 23's review). */}
      <p className="note" data-testid="getting-started-intro">
        {t("home.start.intro")}
      </p>
      <ol className="steps" data-testid="getting-started">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? "step step--done" : "step"}>
            <span className="step__icon">
              {s.done ? <DoneIcon size={20} /> : <span className="step__n">{i + 1}</span>}
            </span>
            <span className="step__title">
              {s.title}
              {s.done && <span className="sr-only">{t("home.start.done")}</span>}
            </span>
            {i === current && !(i === 0 && fundAbove) ? (
              <button
                type="button"
                className="chip"
                onClick={s.onClick}
                disabled={s.disabled}
                title={watching && s.disabled ? t(BUSY) : undefined}
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
  const t = useT();
  const amounts = useAmounts();
  const shown = lovelace === undefined ? undefined : amounts.ada(lovelace);
  // A long amount gets a smaller size rather than a second line: at seven figures the ₳ wrapped onto its own in the
  // side panel (chunk 23's review, H-8).
  const size =
    !shown || shown.length <= 13
      ? "amount"
      : shown.length <= 15
        ? "amount amount--long"
        : shown.length <= 18
          ? "amount amount--longer"
          : "amount amount--longest";
  return (
    <>
      <p className={size} data-testid={testId}>
        {shown === undefined ? <span className="amount__placeholder">—</span> : shown}
        <span className="amount__unit">{"\u00a0₳"}</span>
      </p>
      {lovelace !== undefined && price && (
        <p className="hero__fiat" data-testid={`${testId}-fiat`} title={t("home.fiatTitle", { price: formatFiat("1000000", price) })}>
          ≈ {amounts.text(formatFiat(lovelace, price))}
        </p>
      )}
    </>
  );
}
