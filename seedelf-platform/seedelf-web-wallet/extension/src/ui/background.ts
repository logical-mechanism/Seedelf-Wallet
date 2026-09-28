// The UI's side of the RPC: ask the service worker to do something, and hear
// when the wallet's state changes (for example on auto-lock).

import { isDappChanged, isStateChanged, UI_PORT, type Reply, type RequestName, type Requests } from "../shared/rpc";

const NO_ANSWER = "The wallet's background service didn't answer.";

/**
 * Asks the worker, on a port of its own that only the worker listens for
 * (background/ui-port.ts). runtime.sendMessage would hand the request, and a
 * password or the phrase in it, to every other open wallet page too.
 */
export function call<K extends RequestName>(type: K, payload: Requests[K]["payload"]): Promise<Requests[K]["result"]> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: UI_PORT });
    let answered = false;
    port.onMessage.addListener((reply: Reply<K> | undefined) => {
      answered = true;
      port.disconnect();
      if (reply?.ok) resolve(reply.value);
      else reject(new Error(reply?.error ?? NO_ANSWER));
    });
    port.onDisconnect.addListener(() => {
      // Read, so Chrome doesn't log it as unchecked: the worker couldn't be reached.
      void chrome.runtime.lastError;
      if (!answered) reject(new Error(NO_ANSWER));
    });
    port.postMessage({ type, ...payload });
  });
}

/** Calls `listener` when the worker says the wallet state changed. Returns an unsubscribe. */
export function onStateChanged(listener: () => void): () => void {
  // Only the worker's broadcasts arrive here: requests travel on ports.
  const handler = (message: unknown) => {
    if (isStateChanged(message)) listener();
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/** Calls `listener` when what sites wait for changes (the connector's window). Returns an unsubscribe. */
export function onDappChanged(listener: () => void): () => void {
  const handler = (message: unknown) => {
    if (isDappChanged(message)) listener();
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

let words: Promise<string[]> | undefined;

/** The BIP39 English word list, fetched from the worker once per page. */
export function wordlist(): Promise<string[]> {
  words ??= call("wordlist", {}).catch((e: unknown) => {
    words = undefined;
    throw e;
  });
  return words;
}

const ACTIVITY_EVERY_MS = 30_000;
let lastActivity = 0;

/** Tells the worker the user is active, at most every 30 s. Auto-lock counts from the last one. */
export function reportActivity(): void {
  const now = Date.now();
  if (now - lastActivity < ACTIVITY_EVERY_MS) return;
  lastActivity = now;
  call("activity", {}).catch(() => undefined);
}

/** Tells the worker now, however recently it was told: Stay unlocked, as auto-lock counts down. */
export async function stayUnlocked(): Promise<void> {
  lastActivity = Date.now();
  await call("activity", {});
}
