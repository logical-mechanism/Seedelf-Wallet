// Service worker entry. Listeners are registered synchronously, before any
// await, so the event that woke the worker is never lost.

import { defaultNetwork, enabledNetworks, NETWORKS } from "../networks";
import { APIError, DAPP_ORIGINS, DAPP_PORT, isDappMethod, type DappAnswer, type DappCall } from "../shared/dapp";
import { applyOpenIn, readOpenIn, showWalletTab } from "../shared/open-in";
import { DAPP_CHANGED, isMessage, STATE_CHANGED, type Reply } from "../shared/rpc";
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
import { PreferencesService } from "./preferences";
import { PriceService } from "./prices";
import { PrivateStore } from "./private-store";
import { SendService } from "./send";
import { SessionService } from "./sessions";
import { StakingService } from "./staking";
import { TransferService } from "./transfer";
import { WithdrawService } from "./withdraw";
import { LovejoinService } from "./lovejoin";
import { chromeArea } from "./storage";
import { Wallet } from "./wallet";
import { loadWasm } from "./wasm";

const extensionOrigin = chrome.runtime.getURL("");

// Storage is the extension's own pages' and this worker's, never a content
// script's. The dApp connector's bridge runs in every site's renderer and
// never reads storage, so a renderer a site took over can't read the sealed
// vault (to guess its password offline) or change the settings through it.
// Session storage is this way already; local storage isn't by default. Set at
// every start, as the level doesn't outlive the browser; a Chrome that can't
// set it keeps the default.
for (const area of [chrome.storage.local, chrome.storage.session]) {
  try {
    area.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
  } catch {
    // Never in the way of the listeners below.
  }
}

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
// clock: an alarm that's there is left alone.
const sessionsAlarm = {
  start: async () => {
    if (!(await chrome.alarms.get(SESSIONS_ALARM))) await chrome.alarms.create(SESSIONS_ALARM, { periodInMinutes: 1 });
  },
  stop: async () => {
    await chrome.alarms.clear(SESSIONS_ALARM);
  },
};

/**
 * The next step of every swap that runs itself, and Lovejoin's boxes that are
 * due back, while the wallet is unlocked; locked, the alarm stops until
 * unlock. `scan`: read Lovejoin's pool even with nothing due (at unlock).
 */
async function runSessions(ctx: Pick<Context, "wallet" | "sessions" | "lovejoin" | "network">, scan = false): Promise<void> {
  if ((await ctx.wallet.state()) !== "unlocked") {
    await sessionsAlarm.stop();
    return;
  }
  await ctx.sessions.runAll(ctx.network);
  // A public mix still being sent keeps the alarm going too.
  if (await ctx.lovejoin.pumpPublic(ctx.network).catch(() => false)) await sessionsAlarm.start();
  await ctx.lovejoin.withdrawDue(ctx.network, scan).catch(() => undefined);
  // So do Lovejoin's boxes on their way back: each comes back within a minute
  // of its own due time while the wallet is unlocked, rather than all of them
  // at the next unlock. A minute with nothing due asks Koios nothing.
  if ((await ctx.lovejoin.held(ctx.network).catch(() => undefined))?.boxes) await sessionsAlarm.start();
}

let context: Promise<Context> | undefined;

function getContext(): Promise<Context> {
  if (context) return context;
  context = loadWasm().then((wasm) => {
    const session = chromeArea(chrome.storage.session);
    const local = chromeArea(chrome.storage.local);
    const preferences = new PreferencesService(local);
    const network = defaultNetwork(__MAINNET_ENABLED__);
    // No page open means nobody is listening; that's fine.
    const broadcast = (message: object) => void chrome.runtime.sendMessage(message).catch(() => undefined);
    let dapp: DappService | undefined;
    let sessions: SessionService | undefined;
    let lovejoin: LovejoinService | undefined;
    const wallet = new Wallet({
      wasm,
      local,
      session,
      now: Date.now,
      autoLock,
      lockAfterMs: () => preferences.lockAfterMs(),
      changed: () => {
        broadcast(STATE_CHANGED);
        // Sites waiting for an unlock go on, and so does a swap that runs itself.
        void dapp?.stateChanged();
        if (sessions && lovejoin) void runSessions({ wallet, sessions, lovejoin, network }, true).catch(() => undefined);
      },
    });
    // Every request waits its turn under Koios's public-tier limit, whatever the network.
    const koios = (network: keyof typeof NETWORKS) => new Koios(NETWORKS[network].koios, undefined, undefined, undefined, KOIOS_LIMIT);
    const store = new PrivateStore({ wallet, local });
    const prices = new PriceService({ local, preferences, now: Date.now });
    const activity = new ActivityService({ wallet, session, store, koios, local });
    const contacts = new ContactsService({ wasm, store });
    const coins = new CoinControlService({ wallet, session, store, now: Date.now });
    const balances = new BalanceService({ wasm, wallet, session, local, koios, now: Date.now, activity, coins });
    const moveIn = new MoveInService({ wasm, wallet, session, koios, now: Date.now, activity, coins, preferences });
    const collateral = (network: keyof typeof NETWORKS) => new Collateral(NETWORKS[network].collateral);
    const spends = { wasm, wallet, session, koios, collateral, now: Date.now, activity, coins, preferences };
    const mint = new MintService(spends);
    const transfer = new TransferService(spends);
    const withdraw = new WithdrawService(spends);
    const send = new SendService(spends);
    const staking = new StakingService({ ...spends, local });
    const pending = new PendingService({ wallet, session, koios, now: Date.now });
    const minswap = (network: keyof typeof NETWORKS) =>
      new Minswap(NETWORKS[network].swaps, undefined, excludedProtocols(network));
    // No box is withdrawn while a chain mixing them again may still spend it.
    lovejoin = new LovejoinService({
      ...spends,
      store,
      preferences,
      mixingAgain: (n) => sessions!.mixingAgain(n),
      alarm: sessionsAlarm,
    });
    sessions = new SessionService({ ...spends, store, minswap, alarm: sessionsAlarm, lovejoin });
    dapp = new DappService({
      ...spends,
      preferences,
      store,
      sessions,
      network,
      window: approvalWindow,
      changed: () => broadcast(DAPP_CHANGED),
    });
    return {
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
      connector: applyConnector,
      version: __VERSION__,
      network,
      networks: enabledNetworks(__MAINNET_ENABLED__),
    };
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
    .then((p) => applyConnector(p.dappConnector))
    .catch(() => undefined);
};
chrome.runtime.onInstalled.addListener(applyKept);
chrome.runtime.onStartup.addListener(applyKept);

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

chrome.runtime.onConnect.addListener((port) => {
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
  // A worker that can't start says why on the next request, not here.
  void getContext()
    .then(({ wallet }) => wallet.state())
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only this extension's own pages may talk to the worker.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) {
    return false;
  }
  if (!isMessage(message)) {
    // Requests carry a `type`; anything else (such as another page's state
    // broadcast) isn't for the worker.
    if ((message as { type?: unknown } | null)?.type === undefined) return false;
    sendResponse({ ok: false, error: "unknown request" } satisfies Reply<"status">);
    return false;
  }

  getContext()
    .then((ctx) => handle(message, ctx))
    .then(
      (value) => sendResponse({ ok: true, value }),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies Reply<typeof message.type>),
    );
  return true; // keep the channel open for the async reply
});
