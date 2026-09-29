// The UI's side of the RPC: ask the service worker to do something, and hear
// when the wallet's state changes (for example on auto-lock).

import {
  isBuildProgress,
  isDappChanged,
  isStateChanged,
  UI_PORT,
  type BuildStage,
  type Reply,
  type RequestName,
  type Requests,
} from "../shared/rpc";

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
    // Only a request that reported a stage clears it when it ends: a balance
    // read finishing alongside a build mustn't wipe the build's line.
    let reported = false;
    const done = () => {
      if (reported) setStage(undefined);
    };
    port.onMessage.addListener((reply: Reply<K> | undefined) => {
      // A build says what it's doing on this same port before it answers.
      if (isBuildProgress(reply)) {
        reported = true;
        setStage(reply.stage);
        return;
      }
      answered = true;
      port.disconnect();
      done();
      if (reply?.ok) resolve(reply.value);
      else reject(new Error(reply?.error ?? NO_ANSWER));
    });
    port.onDisconnect.addListener(() => {
      // Read, so Chrome doesn't log it as unchecked: the worker couldn't be reached.
      void chrome.runtime.lastError;
      if (!answered) {
        done();
        reject(new Error(NO_ANSWER));
      }
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

// What the build running in this page is doing. One build runs at a time per
// page (its screen's button is disabled while it does), so one value is
// enough, and every screen reads it through useBuildStage.
let stage: BuildStage | undefined;
const stageListeners = new Set<(s: BuildStage | undefined) => void>();

function setStage(next: BuildStage | undefined): void {
  if (stage === next) return;
  stage = next;
  for (const listener of stageListeners) listener(next);
}

/** The stage now, for a screen mounting mid-build. */
export function buildStage(): BuildStage | undefined {
  return stage;
}

/** Calls `listener` whenever the running build's stage changes. Returns an unsubscribe. */
export function onBuildStage(listener: (stage: BuildStage | undefined) => void): () => void {
  stageListeners.add(listener);
  return () => stageListeners.delete(listener);
}
