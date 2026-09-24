// Service worker entry. Listeners are registered synchronously, before any
// await, so the event that woke the worker is never lost.

import { defaultNetwork, enabledNetworks, NETWORKS } from "../networks";
import { isMessage, STATE_CHANGED, type Reply } from "../shared/rpc";
import { BalanceService } from "./balances";
import { handle, type Context } from "./handlers";
import { Koios } from "./koios";
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
  context ??= loadWasm().then((wasm) => {
    const session = chromeArea(chrome.storage.session);
    const wallet = new Wallet({
      wasm,
      local: chromeArea(chrome.storage.local),
      session,
      now: Date.now,
      autoLock,
      // No page open means nobody is listening; that's fine.
      changed: () => void chrome.runtime.sendMessage(STATE_CHANGED).catch(() => undefined),
    });
    const balances = new BalanceService({
      wasm,
      wallet,
      session,
      koios: (network) => new Koios(NETWORKS[network].koios),
      now: Date.now,
    });
    return {
      wasm,
      wallet,
      balances,
      version: __VERSION__,
      network: defaultNetwork(__MAINNET_ENABLED__),
      networks: enabledNetworks(__MAINNET_ENABLED__),
    };
  });
  return context;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) return;
  // Reading the state applies auto-lock once the user has been idle too long.
  void getContext().then(({ wallet }) => wallet.state());
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
