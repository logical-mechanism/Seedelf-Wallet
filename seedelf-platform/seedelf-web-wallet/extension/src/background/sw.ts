// Service worker entry. Listeners are registered synchronously, before any
// await, so the event that woke the worker is never lost.

import { defaultNetwork, enabledNetworks, NETWORKS } from "../networks";
import { applyOpenIn, readOpenIn, showWalletTab } from "../shared/open-in";
import { isMessage, STATE_CHANGED, type Reply } from "../shared/rpc";
import { ActivityService } from "./activity";
import { BalanceService } from "./balances";
import { CoinControlService } from "./coin-control";
import { Collateral } from "./collateral";
import { ContactsService } from "./contacts";
import { handle, type Context } from "./handlers";
import { Koios } from "./koios";
import { MintService } from "./mint";
import { MoveInService } from "./move-in";
import { PendingService } from "./pending";
import { PreferencesService } from "./preferences";
import { PriceService } from "./prices";
import { PrivateStore } from "./private-store";
import { SendService } from "./send";
import { StakingService } from "./staking";
import { TransferService } from "./transfer";
import { WithdrawService } from "./withdraw";
import { chromeArea } from "./storage";
import { Wallet } from "./wallet";
import { loadWasm } from "./wasm";

const extensionOrigin = chrome.runtime.getURL("");
const AUTO_LOCK_ALARM = "seedelf.auto-lock";

// Worker timers don't survive restarts, so auto-lock runs off an alarm that
// checks the last activity once a minute.
const autoLock = {
  start: () => chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: 1 }),
  stop: async () => {
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
  },
};

let context: Promise<Context> | undefined;

function getContext(): Promise<Context> {
  if (context) return context;
  context = loadWasm().then((wasm) => {
    const session = chromeArea(chrome.storage.session);
    const local = chromeArea(chrome.storage.local);
    const preferences = new PreferencesService(local);
    const wallet = new Wallet({
      wasm,
      local,
      session,
      now: Date.now,
      autoLock,
      lockAfterMs: () => preferences.lockAfterMs(),
      // No page open means nobody is listening; that's fine.
      changed: () => void chrome.runtime.sendMessage(STATE_CHANGED).catch(() => undefined),
    });
    const koios = (network: keyof typeof NETWORKS) => new Koios(NETWORKS[network].koios);
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
      version: __VERSION__,
      network: defaultNetwork(__MAINNET_ENABLED__),
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

// Chrome keeps what the button does, but it's set again whenever the
// extension starts, in case it didn't (an update, a profile copied over).
const applyKeptOpenIn = () => void readOpenIn().then(applyOpenIn).catch(() => undefined);
chrome.runtime.onInstalled.addListener(applyKeptOpenIn);
chrome.runtime.onStartup.addListener(applyKeptOpenIn);

chrome.alarms.onAlarm.addListener((alarm) => {
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
