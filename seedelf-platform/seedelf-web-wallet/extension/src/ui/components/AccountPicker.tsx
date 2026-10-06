// The public account the wallet is working on, as the Public tab's heading on
// Home (chunk 18). It began in the top bar, where a 360 px side panel had room
// for the word "Account" alone (chunk 23's review, HD-1), then took a row of
// its own under the top bar on every screen: a lot of room for something
// rarely used (the owner, 2026-10-06). Here it is the heading it replaces,
// "Public account 2 ▾", and Settings → Public accounts still switches too.
//
// Hidden with one account, as the network picker is hidden in a build with one
// network: there is nothing to choose between, and a wallet that has never had
// a second account looks exactly as it did.
//
// A switch starts every screen afresh on the new account (App keys them by
// it), and the worker drops what the account it left read. It is refused while
// something of that account's is still on its way, and the refusal says so:
// `onError` gets its words, for the screen to show under the heading.

import { useState } from "react";
import { useT } from "../../i18n";

import { publicAccountName, useAccounts } from "../accounts";
import { call } from "../background";

export function AccountPicker({ onError }: { onError: (message?: string) => void }) {
  const t = useT();
  const { accounts, active, several, name, reload } = useAccounts();
  const [busy, setBusy] = useState(false);
  if (!several) return null;

  async function move(index: number) {
    setBusy(true);
    onError(undefined);
    try {
      await call("account-use", { index });
      await reload();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      id="account-select"
      className="account-picker"
      data-testid="account-picker"
      aria-label={t("accountPicker.label")}
      title={t("accountPicker.workingOn", { name })}
      value={active}
      disabled={busy}
      onChange={(e) => {
        const index = Number(e.target.value);
        if (index !== active) void move(index);
      }}
    >
      {accounts.map((a) => (
        <option key={a.index} value={a.index}>
          {publicAccountName(a)}
        </option>
      ))}
    </select>
  );
}
