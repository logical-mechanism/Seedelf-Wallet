// An address with one of the user's public accounts' stake keys under someone
// else's payment key. Send and Make public called it the user's own, and Send
// said a payment there comes back, left out of what's leaving (the 2026-11-02
// bounty report): anyone can pair their own payment key with a stake key, and
// only that key's holder spends what's paid there. It's counted as leaving
// now, and this says whose it isn't. Make public's says what it links too, as
// its own-account warning does: anyone sees the stake key. So does Send's
// where the stake key is another account's than the one paying: a payment
// from one account to an address with another's stake key ties the two on
// chain, which 1.7.1's "This is your own Account 2" note said and #359's
// warning dropped (1.7.2's release review, pr359#0). The account on screen's
// own stake key ties nothing new, and with one account it's always that one.
// The reverse shape, the user's payment key under a stake part that isn't
// theirs, is the user's own, and has a line of its own (`StakeElsewhereNote`).
// So does a script's address, paid with no datum (`ScriptNote`).

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
  const { accounts, active, several } = useAccounts();
  const whose = several
    ? t("accountPicker.numbered", { number: ownAccountNumber(accounts, account) })
    : t("withdraw.warn.publicAccount");
  const text =
    side === "send"
      ? account !== active
        ? nth === undefined
          ? t("send.warn.stakedOther", { whose })
          : t("send.warn.stakedOtherNth", { whose, number: nth })
        : nth === undefined
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

/**
 * The other way round: one of the user's payment keys under a stake part that's none of their accounts' stake keys
 * (someone else's, a pointer, or none), which anyone can pair with the account's receive key. The money is the
 * account's and comes back, as the own-account note says, but while it's there its stake earns and votes for whoever
 * holds that part, or nobody: Send and Make public read it word for word as the Receive address, where the sign window
 * says it of the same shape (`dappUi.warn.ownKey`; chunk 51, x1a#1). One line for both forms, under their own
 * account's note. `nth`: which recipient, on a review that pays several (PY-5).
 */
export function StakeElsewhereNote({ side, nth }: { side: "send" | "withdraw"; nth?: number }) {
  const t = useT();
  return (
    <Callout tone="warn" testId={`${side}-stake-elsewhere`}>
      {nth === undefined ? t("send.warn.stakeElsewhere") : t("send.warn.stakeElsewhereNth", { number: nth })}
    </Callout>
  );
}

/**
 * A script's address: its payment part is a script, a multisig's or a contract's. The ledger takes a payment there, so
 * Send and Make public make it (the wallet refuses only what the ledger or the contracts refuse), but with no datum,
 * which some scripts can never spend and some let anyone take, the Seedelf contract's own address among them. It was
 * refused; this one line is where the refusal was, on the form and the review, with Review live (chunk 51, r2a#1; the
 * owner's call of 2026-11-18). One line for both forms. `nth`: which recipient, on a review that pays several (PY-5).
 */
export function ScriptNote({ side, nth }: { side: "send" | "withdraw"; nth?: number }) {
  const t = useT();
  return (
    <Callout tone="warn" testId={`${side}-script`}>
      {nth === undefined ? t("send.warn.script") : t("send.warn.scriptNth", { number: nth })}
    </Callout>
  );
}
