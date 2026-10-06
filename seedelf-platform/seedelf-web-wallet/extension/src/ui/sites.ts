// The sites switch (Settings → Sites), on its own so the dApps page can offer
// it too without Settings' page and everything it imports (chunk 23's review,
// D-1).

import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";

import { DAPP_ORIGINS } from "../shared/dapp";
import type { DappDeclined, DappSite, Status } from "../shared/rpc";
import { accountNumberAndName, useAccounts } from "./accounts";
import { call, onDappChanged } from "./background";
import { usePreferences } from "./preferences";

/**
 * The sites switch: whether sites can find the wallet, and turning it on or
 * off. Settings → Sites holds it, and the dApps page offers to turn it on
 * where it says to connect on a site (chunk 23's review, D-1). Turning it on
 * asks Chrome from the click itself (Chrome asks only then).
 */
export function useConnectorSwitch(blocked?: Status["connectorBlocked"]) {
  const { prefs, loaded, set } = usePreferences();
  const [allowed, setAllowed] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    chrome.permissions.contains({ origins: DAPP_ORIGINS }).then(setAllowed, () => setAllowed(false));
  }, [prefs.dappConnector]);
  const on = !blocked && loaded && prefs.dappConnector && allowed === true;

  function toggle() {
    if (blocked || !loaded || allowed === undefined) return;
    setError(undefined);
    if (on) {
      set({ dappConnector: false }).then(
        () => setAllowed(false),
        (e: Error) => setError(e.message),
      );
      return;
    }
    // Before anything is awaited: Chrome asks only straight from a click.
    chrome.permissions.request({ origins: DAPP_ORIGINS }).then(
      async (granted) => {
        setAllowed(granted);
        if (!granted) {
          setError(t("settings.sites.warn.notGranted"));
          return;
        }
        await set({ dappConnector: true });
      },
      (e: Error) => setError(e.message),
    );
  }

  return { on, allowed, error, setError, toggle, ready: loaded && allowed !== undefined };
}

/** Why sites can't connect in this version of Chrome (launch review #60). */
export const connectorBlockedText = () => t("settings.sites.warn.blocked");

/**
 * Which public account a site connected to it gets, by its number and name,
 * when the wallet has more than one: sites always use the one Settings →
 * Sites chooses, whichever is on screen, so "your public account" alone
 * could mean an account the screen isn't showing (chunk 23; blind test T15).
 * Undefined with one account, where there's nothing to tell apart.
 */
export function useSiteAccount(): string | undefined {
  const { accounts, several } = useAccounts();
  const { prefs, loaded } = usePreferences();
  if (!several || !loaded) return undefined;
  return accountNumberAndName(accounts.find((a) => a.index === prefs.dappAccount) ?? { index: prefs.dappAccount });
}

/** How long a declined site waits, in words: seconds under a minute, minutes from one. */
export function waitText(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds < 60 ? t("format.inSeconds", { count: seconds }) : t("format.inMinutes", { count: Math.ceil(seconds / 60) });
}

/**
 * Whether sites can see the wallet, and how many are connected: Home's dApps
 * row says it, where users look first (blind test §9.2, T15, E03). From the
 * device alone: the switch, Chrome's grant and the sealed list of sites, no
 * Koios request. Undefined until read.
 */
export function useSitesSummary(): { on?: boolean; connected?: number } {
  const [status, setStatus] = useState<Status>();
  const [sites, setSites] = useState<DappSite[]>();
  const read = useCallback(() => {
    call("dapp-sites", {}).then(setSites, () => setSites(undefined));
  }, []);
  useEffect(() => {
    call("status", {}).then(setStatus, () => undefined);
    read();
    return onDappChanged(read);
  }, [read]);
  const sw = useConnectorSwitch(status?.connectorBlocked);
  if (!status || !sw.ready) return {};
  return { on: sw.on, ...(sw.on && sites ? { connected: sites.length } : {}) };
}

/** How many seconds' ticks between readings of the declined sites while any is listed. */
const REREAD_TICKS = 5;

/**
 * The sites the user declined that are still turned away, read from the
 * worker and again whenever what sites ask changes (one asking again, say),
 * with the time ticking each second while any is listed, and Let it ask now
 * (blind test §9.2, T17r). Read again every few seconds meanwhile too, so the
 * list is the worker's, not a countdown that outlives what it counts (the
 * cross-area review). Nothing is asked of Koios.
 */
export function useDeclined() {
  const [declined, setDeclined] = useState<DappDeclined[]>([]);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string>();
  const shown = useCallback((list: DappDeclined[]) => {
    setNow(Date.now());
    setDeclined(list);
  }, []);
  const read = useCallback(() => {
    call("dapp-declined", {}).then(shown, () => setDeclined([]));
  }, [shown]);
  useEffect(() => {
    read();
    return onDappChanged(read);
  }, [read]);
  const waiting = declined.filter((d) => d.until > now);
  const ticking = waiting.length > 0;
  useEffect(() => {
    if (!ticking) return;
    let ticks = 0;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (++ticks % REREAD_TICKS === 0) read();
    }, 1_000);
    return () => clearInterval(timer);
  }, [ticking, read]);
  const letAsk = (origin: string) => {
    setError(undefined);
    call("dapp-let-ask", { origin }).then(shown, (e: Error) => setError(e.message));
  };
  return { declined: waiting, now, letAsk, error };
}
