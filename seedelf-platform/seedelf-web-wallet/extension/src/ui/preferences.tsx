// The user's settings, for every screen: read from the worker once the
// wallet is unlocked, and changed through it. Hide balances is one: the
// screens that show what the wallet holds (Home, Tokens, UTxOs, Activity,
// Receive, Staking) write their amounts through `useAmounts`, which masks
// them. The forms and reviews don't: what's being sent is always shown.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_PREFERENCES, LOCAL_PREFERENCES, type Preferences } from "../shared/preferences";
import { call } from "./background";
import { formatAda, formatQuantity } from "./format";

interface PreferencesValue {
  prefs: Preferences;
  /** Whether they've been read yet; until then `prefs` are the defaults. */
  loaded: boolean;
  set: (change: Partial<Preferences>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesValue>({
  prefs: DEFAULT_PREFERENCES,
  loaded: false,
  set: async () => undefined,
});

export function PreferencesProvider({ unlocked, children }: { unlocked: boolean; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!unlocked) return;
    let live = true;
    const read = () =>
      call("preferences", {}).then(
        (p) => {
          if (!live) return;
          setPrefs(p);
          setLoaded(true);
        },
        () => undefined,
      );
    void read();
    // Another page (the side panel beside a tab) may change them: follow it.
    // Local storage's own event, never chrome.storage.onChanged: that one
    // carries session storage's changes too, the vault's entropy among them
    // at every unlock and lock, into this page.
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (LOCAL_PREFERENCES in changes) void read();
    };
    chrome.storage.local.onChanged.addListener(changed);
    return () => {
      live = false;
      chrome.storage.local.onChanged.removeListener(changed);
    };
  }, [unlocked]);

  const set = useCallback(async (change: Partial<Preferences>) => {
    setPrefs(await call("preferences-set", change));
  }, []);

  const value = useMemo(() => ({ prefs, loaded, set }), [prefs, loaded, set]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

/** What a hidden amount shows. */
export const HIDDEN = "••••";

/** Amounts as the overview screens show them: masked while balances are hidden. */
export function useAmounts() {
  const { prefs, loaded } = usePreferences();
  // Masked until the settings are read: a screen can have its balances first, and must not show them if they're hidden.
  const hidden = !loaded || prefs.hideBalances;
  return useMemo(
    () => ({
      hidden,
      ada: (lovelace: string) => (hidden ? HIDDEN : formatAda(lovelace)),
      quantity: (quantity: string, decimals: number) => (hidden ? HIDDEN : formatQuantity(quantity, decimals)),
      /** Any amount already written out. */
      text: (text: string) => (hidden ? HIDDEN : text),
    }),
    [hidden],
  );
}
