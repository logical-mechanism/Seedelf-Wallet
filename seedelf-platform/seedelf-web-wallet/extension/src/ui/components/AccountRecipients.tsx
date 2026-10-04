// Your own public accounts, as recipients of a public Send (chunk 18).
//
// **Why it is offered at all.** Moving money between your own accounts is a
// thing people do, and the wallet's job is to say what that reveals, not to
// make it awkward (the owner, 2026-10-02). Without this the only way to pay
// your own Account 2 is to switch to it, copy its address, switch back and
// paste — which is worse in every way than picking it and reading the note.
//
// **It makes the link one click away, so the note matters more, not less.**
// Picking one fills the To field like any other address, the destination is
// read as any other is, and the form says *"This is your own Account 2 … it's
// an ordinary Cardano payment, so anyone can see your two accounts paying
// each other"*. Nothing is special-cased past the filling-in.
//
// The addresses are derived on the device (`account-addresses`); opening this
// asks nobody anything.

import { useEffect, useState } from "react";
import { useT } from "../../i18n";

import type { KnownAccount } from "../../shared/rpc";
import { accountName, useAccounts } from "../accounts";
import { call } from "../background";
import { shortHex } from "../format";
import { WalletIcon } from "./Icons";
import { Modal } from "./Modal";

type WithAddress = KnownAccount & { address: string };

/**
 * The accounts that can be picked: every one the wallet knows but the one it
 * is working on. Paying the account you are on sends the money straight back
 * less the fee, which is the collateral payment's job, not a recipient.
 */
export function AccountRecipients({ onPick, onClose }: { onPick: (address: string) => void; onClose: () => void }) {
  const { active } = useAccounts();
  const t = useT();
  const [accounts, setAccounts] = useState<WithAddress[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    call("account-addresses", {}).then(
      (all) => live && setAccounts(all.filter((a) => a.index !== active)),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [active]);

  return (
    <Modal title={t("accountRecipients.title")} titleId="account-recipients-title" onClose={onClose}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {accounts && (
        <ul className="list" data-testid="account-recipients">
          {accounts.map((a) => (
            <li key={a.index}>
              <button type="button" className="token-row" onClick={() => onPick(a.address)} aria-label={accountName(a)}>
                <span className="avatar avatar--contact" aria-hidden="true">
                  <WalletIcon size={14} />
                </span>
                <span className="token-row__label">{accountName(a)}</span>
                <span className="token-row__amount note">{t("accountRecipients.yours")}</span>
                <code className="token-row__sub">{shortHex(a.address, 12, 6)}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
      {accounts?.length === 0 && <p className="note center empty">{t("accountRecipients.only")}</p>}
      <p className="note">{t("accountRecipients.privacy.ownAccounts")}</p>
    </Modal>
  );
}
