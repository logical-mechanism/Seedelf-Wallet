// The bridge between `window.cardano.seedelf` (page.ts) and the worker, in
// an isolated world. It takes the page's calls from `window.postMessage`
// (only from this window, only from its own origin) and sends them on a
// port; the worker learns the site's origin from Chrome, never from the
// page. While a call waits (the user reading a prompt), a ping every 20 s
// keeps the worker from being stopped. If the worker restarts anyway, a call
// that only reads is asked again once; a signing call fails, since it's
// unknown whether it was answered.

import { APIError, DAPP_PORT, isDappMethod, PAGE_CHANNEL, READ_METHODS, type DappAnswer, type DappCall } from "../shared/dapp";

const PING_MS = 20_000;

let port: chrome.runtime.Port | undefined;
/** Calls sent and not answered, with whether they've been asked again. */
const waiting = new Map<string, { call: DappCall; retried: boolean }>();
let ping: ReturnType<typeof setInterval> | undefined;

function reply(answer: DappAnswer) {
  window.postMessage({ [PAGE_CHANNEL]: "reply", ...answer }, location.origin);
}

function fail(id: string, info: string) {
  reply({ id, error: { code: APIError.InternalError, info } });
}

function connect(): chrome.runtime.Port {
  const opened = chrome.runtime.connect({ name: DAPP_PORT });
  opened.onMessage.addListener((answer: DappAnswer) => {
    if (!waiting.delete(answer.id)) return;
    reply(answer);
    if (!waiting.size) stopPing();
  });
  opened.onDisconnect.addListener(() => {
    port = undefined;
    stopPing();
    const lost = [...waiting.values()];
    waiting.clear();
    for (const w of lost) {
      if (READ_METHODS.has(w.call.method) && !w.retried) send(w.call, true);
      else fail(w.call.id, "Seedelf Wallet stopped before answering, so nothing was signed. Try again.");
    }
  });
  return opened;
}

function send(call: DappCall, retried = false) {
  waiting.set(call.id, { call, retried });
  try {
    port ??= connect();
    port.postMessage(call);
    ping ??= setInterval(() => port?.postMessage({ ping: true }), PING_MS);
  } catch {
    // The extension was updated or reloaded: this page's copy can't reach it any more.
    waiting.delete(call.id);
    fail(call.id, "Seedelf Wallet was updated or reloaded. Reload this page to connect again.");
  }
}

function stopPing() {
  clearInterval(ping);
  ping = undefined;
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { [PAGE_CHANNEL]?: unknown; id?: unknown; method?: unknown; args?: unknown } | null;
  if (data?.[PAGE_CHANNEL] !== "request" || typeof data.id !== "string") return;
  if (!isDappMethod(data.method)) {
    reply({ id: data.id, error: { code: APIError.InvalidRequest, info: "Seedelf Wallet doesn't know that method." } });
    return;
  }
  send({ id: data.id, method: data.method, args: Array.isArray(data.args) ? data.args : [] });
});
