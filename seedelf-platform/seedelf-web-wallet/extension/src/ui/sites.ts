// The sites switch (Settings → Sites), on its own so the dApps page can offer
// it too without Settings' page and everything it imports (chunk 23's review,
// D-1).

import { useEffect, useState } from "react";
import { t } from "../i18n";

import { DAPP_ORIGINS } from "../shared/dapp";
import type { Status } from "../shared/rpc";
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
