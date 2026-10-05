// The public account the wallet is working on, on a row of its own under the
// top bar (chunk 18). It began in the top bar, beside the network badge, and
// there a 360 px side panel had room for the word "Account" alone, with Lock
// and Open in tab pushed off the edge (chunk 23's review, HD-1).
//
// Hidden with one account, as the network picker is hidden in a build with one
// network: there is nothing to choose between, and a wallet that has never had
// a second account looks exactly as it did.
//
// A switch starts every screen afresh on the new account (App keys them by
// it), and the worker drops what the account it left read. It is refused while
// something of that account's is still on its way, and the refusal says so.

import { useState } from "react";
import { useT } from "../../i18n";

import { useAccounts } from "../accounts";
import { call } from "../background";

export function AccountPicker() {
  const t = useT();
  const { accounts, active, several, name, reload } = useAccounts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!several) return null;

  async function move(index: number) {
    setBusy(true);
    setError(undefined);
    try {
      await call("account-use", { index });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-picker" data-testid="account-picker">
      <label className="account-picker__label" htmlFor="account-select">
        {t("accountPicker.label")}
      </label>
      <select
        id="account-select"
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
            {a.name?.trim() || t("accountPicker.numbered", { number: a.index + 1 })}
          </option>
        ))}
      </select>
      {error && (
        <p className="error account-picker__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
