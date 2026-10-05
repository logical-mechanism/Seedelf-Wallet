// Which public account the wallet is working on, for every screen (chunk 18).
//
// Read from the worker once the wallet is unlocked, and followed when another
// page switches: a side panel open beside a tab must not keep showing the
// account the user just left. The choice lives in local storage
// (`LOCAL_ACCOUNT`), so local storage's own event is what says it moved — never
// chrome.storage.onChanged, which carries session storage's changes too, the
// vault's entropy among them, into this page.
//
// One account is the common case, and the picker is hidden then: there is
// nothing to choose between, and a wallet that has never had a second account
// should look exactly as it did.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { LOCAL_ACCOUNT } from "../shared/preferences";
import type { KnownAccount } from "../shared/rpc";
import { currentLanguage, t, useT } from "../i18n";
import { call } from "./background";

/** The name an account is shown by: its own, or its number as a person counts (from 1). */
export const accountName = (a: KnownAccount): string => a.name?.trim() || t("accounts.numbered", { number: a.index + 1 });

/**
 * Its number and, when it has one, its name: where a screen has to say exactly
 * which account it means (the connector's windows, chunk 23), a name alone
 * could be anyone's, and two accounts can share one.
 */
export const accountNumberAndName = (a: KnownAccount): string => {
  const number = t("accounts.numbered", { number: a.index + 1 });
  const name = a.name?.trim();
  return name ? `${number} · ${name}` : number;
};

/** The name of account `index` among `accounts`, for a message about one that may not be listed. */
export const nameOf = (accounts: KnownAccount[], index: number): string =>
  accountName(accounts.find((a) => a.index === index) ?? { index });

interface AccountsValue {
  accounts: KnownAccount[];
  active: number;
  /** Whether they've been read yet. */
  loaded: boolean;
  /** The active account, as it is shown. */
  name: string;
  /** Whether there is more than one to tell apart: what decides if the account is named anywhere. */
  several: boolean;
  reload: () => Promise<void>;
}

const ALONE: KnownAccount[] = [{ index: 0 }];

export const AccountsContext = createContext<AccountsValue>({
  accounts: ALONE,
  active: 0,
  loaded: false,
  // A getter, as MOVE_TO's are in Settings: called once here, it named the account in the language that was on at import.
  get name() {
    return t("accounts.numbered", { number: 1 });
  },
  several: false,
  reload: async () => undefined,
});

export function AccountsProvider({ unlocked, children }: { unlocked: boolean; children: ReactNode }) {
  const [accounts, setAccounts] = useState<KnownAccount[]>(ALONE);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const read = useCallback(async () => {
    try {
      const list = await call("accounts", {});
      setAccounts(list.accounts.length ? list.accounts : ALONE);
      setActive(list.active);
      setLoaded(true);
    } catch {
      // Locked, or the worker restarting: the screens carry on with account 0.
    }
  }, []);

  useEffect(() => {
    if (!unlocked) {
      setAccounts(ALONE);
      setActive(0);
      setLoaded(false);
      return;
    }
    let live = true;
    const again = () => {
      if (live) void read();
    };
    again();
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (LOCAL_ACCOUNT in changes) again();
    };
    chrome.storage.local.onChanged.addListener(changed);
    return () => {
      live = false;
      chrome.storage.local.onChanged.removeListener(changed);
    };
  }, [unlocked, read]);

  // The active account's name is words ("Cuenta 2"): the language is one of
  // what it's worked out from, so a switch renames it rather than keeping the
  // name from before it.
  useT();
  const language = currentLanguage();
  const value = useMemo<AccountsValue>(
    () => ({
      accounts,
      active,
      loaded,
      name: nameOf(accounts, active),
      several: accounts.length > 1,
      reload: read,
    }),
    [accounts, active, loaded, read, language],
  );
  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts(): AccountsValue {
  return useContext(AccountsContext);
}
