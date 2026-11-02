// An address with one of the user's public accounts' stake keys under someone
// else's payment key. Send and Make public called it the user's own, and Send
// said a payment there comes back, left out of what's leaving (the 2026-11-02
// bounty report): anyone can pair their own payment key with a stake key, and
// only that key's holder spends what's paid there. It's counted as leaving
// now, and this says whose it isn't. Make public's says what it links too, as
// its own-account warning does: anyone sees the stake key.

import { useT } from "../../i18n";
import { useAccounts } from "../accounts";
import { ownAccountNumber } from "./AccountRecipients";
import { Callout } from "./Callout";

/**
 * `account`: whose stake key it carries, named as Make public's own-account
 * warning names one (`OwnWarning`): by its number only where there are
 * several. `nth`: which recipient, on a review that pays several (PY-5).
 */
export function StakedWarning({ side, account, nth }: { side: "send" | "withdraw"; account: number; nth?: number }) {
  const t = useT();
  const { accounts, several } = useAccounts();
  const whose = several
    ? t("accountPicker.numbered", { number: ownAccountNumber(accounts, account) })
    : t("withdraw.warn.publicAccount");
  const text =
    side === "send"
      ? nth === undefined
        ? t("send.warn.staked", { whose })
        : t("send.warn.stakedNth", { whose, number: nth })
      : nth === undefined
        ? t("withdraw.warn.staked", { whose })
        : t("withdraw.warn.stakedNth", { whose, number: nth });
  return (
    <Callout tone="warn" testId={`${side}-staked`}>
      {text}
    </Callout>
  );
}
