// Service worker entry. Listeners are registered synchronously, before any
// await, so the event that woke the worker is never lost.

import { enabledNetworks, NETWORKS } from "../networks";
import { APIError, DAPP_ORIGINS, DAPP_PORT, isDappMethod, type DappAnswer, type DappCall } from "../shared/dapp";
import { applyOpenIn, readOpenIn, showWalletTab } from "../shared/open-in";
import { DAPP_CHANGED, STATE_CHANGED, type Message } from "../shared/rpc";
import { ActivityService } from "./activity";
import { BalanceService } from "./balances";
import { CoinControlService } from "./coin-control";
import { Collateral } from "./collateral";
import { applyConnector } from "./connector";
import { ContactsService } from "./contacts";
import { DappError, DappService, type DappSession } from "./dapp";
import { approvalWindow } from "./dapp-window";
import { handle, type Context } from "./handlers";
import { Koios, KOIOS_LIMIT } from "./koios";
import { excludedProtocols, Minswap } from "./minswap";
import { MintService } from "./mint";
import { MoveInService } from "./move-in";
import { PendingService } from "./pending";
import { LOCAL_NETWORK, NetworkChoice, PreferencesService } from "./preferences";
import { PriceService } from "./prices";
import { runNetworks, type Runner } from "./runs";
import { PrivateStore } from "./private-store";
import { SendService } from "./send";
import { SessionService } from "./sessions";
import { StakingService } from "./staking";
import { TransferService } from "./transfer";
import { WithdrawService } from "./withdraw";
import { LovejoinService } from "./lovejoin";
import { chromeArea } from "./storage";
import { guardedConnector, keepStorageFromSites } from "./storage-access";
import { serveUi } from "./ui-port";
import { hasEntropy, Wallet, WASM_BROKEN } from "./wallet";
import { freshWasm, isTrap, loadWasm } from "./wasm";

const extensionOrigin = chrome.runtime.getURL("");

// Storage is kept from content scripts at every start (storage-access.ts).
// Where Chrome won't do it for local storage, the dApp connector stays off.
const storageProtected = keepStorageFromSites(chrome.storage);
const connector = guardedConnector(storageProtected, applyConnector);

const AUTO_LOCK_ALARM = "seedelf.auto-lock";
/** Wakes a swap that runs itself (sessions.ts), a chain being sent, and Lovejoin boxes waiting to come back, every minute while the wallet is unlocked. */
const SESSIONS_ALARM = "seedelf.sessions";

// Worker timers don't survive restarts, so auto-lock runs off an alarm that
// checks the last activity once a minute.
const autoLock = {
  start: () => chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: 1 }),
  stop: async () => {
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
  },
};

// Chrome 116's shortest period is a minute. Asking again doesn't restart the
// clock: an alarm that's there is left alone. Each start is counted, so a run
// never stops what was started while it went on (runs.ts).
let sessionsStarts = 0;
const sessionsAlarm = {
  start: async () => {
    sessionsStarts++;
    if (!(await chrome.alarms.get(SESSIONS_ALARM))) await chrome.alarms.create(SESSIONS_ALARM, { periodInMinutes: 1 });
  },
  stop: async () => {
    await chrome.alarms.clear(SESSIONS_ALARM);
  },
  starts: () => sessionsStarts,
};

/**
 * The worker's services. The network isn't one of them: each request is on
 * the network the user has chosen as it comes in (`answerUi`), and the
 * background runs go through every network the build has.
 */
type Worker = Omit<Context, "network">;

/** The run going on, if one is, and whether another is asked for after it (the unlock's, if any asked for one). */
let running: Promise<void> | undefined;
let asked: { unlock: boolean } | undefined;

/**
 * One run of runSessionsNow at a time: the alarm and an unlock can both ask
 * while one goes on (a chain pumps for up to a block), and two at once would
 * send two withdraws seconds apart. Asked during a run, it runs once more
 * after it.
 */
function runSessions(ctx: Runner, unlock = false): Promise<void> {
  if (running) {
    asked = { unlock: unlock || !!asked?.unlock };
    return running;
  }
  running = (async () => {
    try {
      await runSessionsNow(ctx, unlock);
      while (asked) {
        const next = asked;
        asked = undefined;
        await runSessionsNow(ctx, next.unlock);
      }
    } finally {
      running = undefined;
    }
  })();
  return running;
}

/** The next step of everything that runs itself, on every network (runs.ts); `unlock`: the run as the wallet unlocks, which sends nothing. */
function runSessionsNow(ctx: Runner, unlock = false): Promise<void> {
  return runNetworks(ctx, sessionsAlarm, unlock);
}

let context: Promise<Worker> | undefined;

// No page open means nobody is listening; that's fine.
const broadcast = (message: object) => void chrome.runtime.sendMessage(message).catch(() => undefined);

function getContext(): Promise<Worker> {
  if (context) return context;
  context = Promise.all([loadWasm(), storageProtected]).then(([wasm, protectedStorage]) => {
    const session = chromeArea(chrome.storage.session);
    const local = chromeArea(chrome.storage.local);
    const preferences = new PreferencesService(local);
    const networks = enabledNetworks(__MAINNET_ENABLED__);
    // The user's choice, read for each request and each site's call (Settings switches it).
    const networkChoice = new NetworkChoice(local, networks);
    let worker: Worker | undefined;
    let dapp: DappService | undefined;
    const wallet = new Wallet({
      wasm,
      local,
      session,
      now: Date.now,
      autoLock,
      lockAfterMs: () => preferences.lockAfterMs(),
      fresh: freshWasm,
      changed: () => {
        broadcast(STATE_CHANGED);
        // Sites waiting for an unlock go on. A swap that runs itself, and
        // Lovejoin's boxes due back, go on a few minutes in: nothing goes out
        // the moment the wallet unlocks (runs.ts, privacy review §3.1).
        void dapp?.stateChanged();
        if (worker) void runSessions(worker, true).catch(() => undefined);
      },
    });
    // Every request waits its turn under Koios's public-tier limit, whatever the network.
    const koios = (network: keyof typeof NETWORKS) => new Koios(NETWORKS[network].koios, undefined, undefined, undefined, KOIOS_LIMIT);
    const store = new PrivateStore({ wallet, local });
    const prices = new PriceService({ session, local, preferences, now: Date.now });
    const activity = new ActivityService({ wallet, session, store, koios, local });
    const contacts = new ContactsService({ wasm, store });
    const coins = new CoinControlService({ wallet, session, store, now: Date.now, activity });
    const balances = new BalanceService({ wasm, wallet, session, local, koios, now: Date.now, activity, coins, store });
    const moveIn = new MoveInService({ wasm, wallet, session, koios, now: Date.now, activity, coins, preferences, store });
    const collateral = (network: keyof typeof NETWORKS) => new Collateral(NETWORKS[network].collateral);
    const spends = { wasm, wallet, session, koios, collateral, now: Date.now, activity, coins, preferences, store };
    const mint = new MintService(spends);
    const transfer = new TransferService(spends);
    const withdraw = new WithdrawService(spends);
    const send = new SendService(spends);
    const staking = new StakingService({ ...spends, local });
    const pending = new PendingService({ wallet, session, koios, now: Date.now, activity, store, alarm: sessionsAlarm });
    const minswap = (network: keyof typeof NETWORKS) =>
      new Minswap(NETWORKS[network].swaps, undefined, excludedProtocols(network));
    // No box is withdrawn while a chain mixing them again may still spend it.
    const lovejoin: LovejoinService = new LovejoinService({
      ...spends,
      store,
      preferences,
      mixingAgain: (n) => sessions.mixingAgain(n),
      alarm: sessionsAlarm,
    });
    const sessions = new SessionService({ ...spends, store, minswap, alarm: sessionsAlarm, lovejoin });
    dapp = new DappService({
      ...spends,
      preferences,
      store,
      sessions,
      network: () => networkChoice.get(),
      window: approvalWindow,
      changed: () => broadcast(DAPP_CHANGED),
    });
    worker = {
      wasm,
      wallet,
      balances,
      moveIn,
      mint,
      transfer,
      withdraw,
      send,
      pending,
      contacts,
      activity,
      coins,
      staking,
      preferences,
      prices,
      dapp,
      sessions,
      lovejoin,
      connector,
      ...(protectedStorage ? {} : { connectorBlocked: "storage" as const }),
      version: __VERSION__,
      networks,
      networkChoice,
    };
    return worker;
  });
  // Don't keep a failed start (the WASM didn't load): the next request tries again.
  context.catch(() => (context = undefined));
  return context;
}

// The toolbar button, when the wallet opens in a tab (a side panel opens
// without the worker): bring back the wallet's tab if one is open, or open one.
chrome.action.onClicked.addListener(() => void showWalletTab());

// Chrome keeps what the button does, and the dApp connector's scripts, but
// both are set again whenever the extension starts, in case they weren't (an
// update, a profile copied over). Neither needs the wallet unlocked.
const preferences = () => new PreferencesService(chromeArea(chrome.storage.local)).get();
const applyKept = () => {
  void readOpenIn().then(applyOpenIn).catch(() => undefined);
  void preferences()
    .then((p) => connector(p.dappConnector))
    .catch(() => undefined);
};
chrome.runtime.onInstalled.addListener(applyKept);
chrome.runtime.onStartup.addListener(applyKept);

// The network changed (Settings' switch, or a test harness before the wallet
// starts): every open page follows, and what sites were asking on the network
// the wallet left is declined. Local storage's own event: session storage's,
// which carries the entropy, never reaches this listener.
chrome.storage.local.onChanged.addListener((changes) => {
  if (!(LOCAL_NETWORK in changes)) return;
  broadcast(STATE_CHANGED);
  void context?.then((ctx) => ctx.dapp.networkChanged()).catch(() => undefined);
});

// The user took the wallet's access to sites away in Chrome's own settings:
// the connector is off.
chrome.permissions.onRemoved.addListener((removed) => {
  if (!removed.origins?.some((o) => DAPP_ORIGINS.includes(o))) return;
  void new PreferencesService(chromeArea(chrome.storage.local))
    .set({ dappConnector: false })
    .then(() => applyConnector(false))
    .catch(() => undefined);
});

// A site's page (the connector's bridge, shared/dapp.ts). Its origin is
// Chrome's word for it, never the page's: a top frame on https, or on
// localhost for a dApp in development.
function dappSession(sender: chrome.runtime.MessageSender | undefined): DappSession | undefined {
  if (sender?.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !sender.origin) return undefined;
  const url = new URL(sender.origin);
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !local) return undefined;
  return { id: crypto.randomUUID(), origin: sender.origin, title: sender.tab.title };
}

/**
 * A request from one of the wallet's pages. WebAssembly that traps under it
 * outside the wallet's queue locks the wallet, as a trap inside does.
 */
async function answerUi(message: Message): Promise<unknown> {
  const worker = await getContext();
  // On the network the user has chosen as it comes in: a switch needs no restart.
  const ctx: Context = { ...worker, network: await worker.networkChoice.get() };
  try {
    return await handle(message, ctx);
  } catch (e) {
    if (!isTrap(e)) throw e;
    await ctx.wallet.trapped();
    throw new Error(WASM_BROKEN);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  // The wallet's own pages ask on ports of their own (ui-port.ts).
  if (serveUi(port, extensionOrigin, answerUi)) return;
  if (port.name !== DAPP_PORT) return;
  const session = dappSession(port.sender);
  if (!session) {
    port.disconnect();
    return;
  }
  let open = true;
  const answer = (a: DappAnswer) => {
    if (!open) return;
    try {
      port.postMessage(a);
    } catch {
      // The page went away as it was answered.
    }
  };
  port.onMessage.addListener((call: Partial<DappCall> & { ping?: boolean }) => {
    // Pings only keep the worker running while a prompt waits.
    if (call.ping || typeof call.id !== "string") return;
    const id = call.id;
    if (!isDappMethod(call.method) || !Array.isArray(call.args)) {
      answer({ id, error: { code: APIError.InvalidRequest, info: "Seedelf Wallet doesn't know that method." } });
      return;
    }
    const method = call.method;
    const args = call.args;
    getContext()
      .then((ctx) => ctx.dapp.call(session, method, args))
      .then(
        (value) => answer({ id, value }),
        (e: unknown) =>
          answer({
            id,
            error:
              e instanceof DappError
                ? e.failure
                : { code: APIError.InternalError, info: e instanceof Error ? e.message : String(e) },
          }),
      );
  });
  port.onDisconnect.addListener(() => {
    open = false;
    void context?.then((ctx) => ctx.dapp.gone(session)).catch(() => undefined);
  });
});

// The connector's window closed: whatever sites were waiting for is
// declined. Only a running worker has anything waiting.
chrome.windows.onRemoved.addListener(() => {
  void context?.then((ctx) => ctx.dapp.windowClosed()).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSIONS_ALARM) {
    void getContext()
      .then(runSessions)
      .catch(() => undefined);
    return;
  }
  if (alarm.name !== AUTO_LOCK_ALARM) return;
  // Reading the state applies auto-lock once the user has been idle too long.
  // Already locked (a browser restart keeps the alarm but not the entropy),
  // the alarm just stops, without starting WebAssembly. A worker that can't
  // start says why on the next request, not here.
  void (async () => {
    if (!(await hasEntropy(chromeArea(chrome.storage.session)))) return autoLock.stop();
    await (await getContext()).wallet.state();
  })().catch(() => undefined);
});
