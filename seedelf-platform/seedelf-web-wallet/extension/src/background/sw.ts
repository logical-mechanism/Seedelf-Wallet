// Service worker entry. Listeners are registered synchronously, before any
// await, so the event that woke the worker is never lost.

import { defaultNetwork, enabledNetworks } from "../networks";
import { isMessage, type Reply } from "../shared/rpc";
import { handle } from "./handlers";
import { loadWasm } from "./wasm";

const extensionOrigin = chrome.runtime.getURL("");

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only this extension's own pages may talk to the worker.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) {
    return false;
  }
  if (!isMessage(message)) {
    sendResponse({ ok: false, error: "unknown request" } satisfies Reply<"status">);
    return false;
  }

  loadWasm()
    .then((wasm) =>
      handle(message, {
        wasm,
        version: __VERSION__,
        network: defaultNetwork(__MAINNET_ENABLED__),
        networks: enabledNetworks(__MAINNET_ENABLED__),
      }),
    )
    .then(
      (value) => sendResponse({ ok: true, value }),
      (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  return true; // keep the channel open for the async reply
});
