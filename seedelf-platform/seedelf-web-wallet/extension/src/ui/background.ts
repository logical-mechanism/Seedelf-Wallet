// The UI's side of the RPC: ask the service worker to do something, and hear
// when the wallet's state changes (for example on auto-lock).

import { isStateChanged, type Reply, type RequestName, type Requests } from "../shared/rpc";

export async function call<K extends RequestName>(
  type: K,
  payload: Requests[K]["payload"],
): Promise<Requests[K]["result"]> {
  const reply = (await chrome.runtime.sendMessage({ type, ...payload })) as Reply<K> | undefined;
  if (!reply) throw new Error("The wallet's background service didn't answer.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

/** Calls `listener` when the worker says the wallet state changed. Returns an unsubscribe. */
export function onStateChanged(listener: () => void): () => void {
  // Other pages' requests also arrive here; ignore them and never reply.
  const handler = (message: unknown) => {
    if (isStateChanged(message)) listener();
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
