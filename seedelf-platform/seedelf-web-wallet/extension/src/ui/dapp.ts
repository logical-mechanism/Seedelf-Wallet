// The connector window's words for a site's transaction (screens/DappApprovals.tsx):
// who each output pays, and where the account's staking money goes. Rewards
// withdrawn and a deposit refunded are the account's money as much as its
// UTxOs are, and the headline counts them in what it sends; these say
// whether they come back to it.

import { t } from "../i18n";
import type { DappTxSummary } from "../shared/rpc";
import { formatAda, voteLabel } from "./format";

type Paid = DappTxSummary["paid"][number];
type Certificate = DappTxSummary["certificates"][number];
type Withdrawal = DappTxSummary["withdrawals"][number];

/**
 * Whether the account's staking money comes back to it: its own outputs get
 * at least as much, the network fee aside (shown on its own row). When they
 * get less, the rest can only have gone to the others paid.
 */
export function stakingComesBack(s: Pick<DappTxSummary, "returnedLovelace" | "stakingLovelace" | "fee">): boolean {
  return BigInt(s.returnedLovelace) + BigInt(s.fee) >= BigInt(s.stakingLovelace);
}

/** What an output pays, under its address: another of the wallet's own accounts by its name (independent review M12). */
export function paidTo(p: Paid): string {
  const what =
    p.yours === "account"
      ? t("dappUi.paid.account")
      : p.yours !== undefined
        ? t("dappUi.paid.session", { number: p.yours + 1 })
        : p.ownPaymentKey
          ? t("dappUi.paid.ownPaymentKey")
          : p.seedelf
            ? t("dappUi.paid.seedelfContract")
            : p.script
              ? t("dappUi.paid.contract")
              : t("dappUi.paid.address");
  return p.datum ? t("dappUi.paid.withData", { what }) : what;
}

/**
 * What of the wallet's other accounts a site's transaction moves money with,
 * which signing ties together on chain for anyone to see (independent review
 * M12): `ties` as the worker found them; `session`, the site is on a private
 * session, not the public account.
 */
export function tiesLine(ties: Array<"account" | number>, session: boolean): string {
  const names = ties.map((x) => (x === "account" ? t("dappUi.ties.account") : t("dappUi.ties.session", { number: x + 1 })));
  const list =
    names.length > 1
      ? t("dappUi.ties.list", { first: names.slice(0, -1).join(t("histories.list.comma")), last: names.at(-1) })
      : names[0];
  return t("dappUi.ties.moves", { from: t(session ? "dappUi.ties.thisSession" : "dappUi.ties.yourAccount"), list });
}

/**
 * The prompt's words on what signing ties the transaction to (privacy
 * review §2.12). That the wallet's other side isn't in it is said only when
 * the worker checked (`ties`, empty): otherwise it may not be true
 * (independent review M12). Nor is the private balance said to be out of
 * it when it pays a Seedelf (`seedelf`): nothing says whose, so it may be
 * the user's own.
 */
export function signingTies(ties: Array<"account" | number> | undefined, session: boolean, seedelf = false): string {
  const checked = ties !== undefined && ties.length === 0;
  if (session) {
    const out = !checked ? "" : ` ${t(seedelf ? "dappUi.privacy.notAccount" : "dappUi.privacy.notAccountNorPrivate")}`;
    return `${t("dappUi.privacy.tiesToSession")}${out}`;
  }
  return `${t("dappUi.privacy.tiesToAccount")}${checked && !seedelf ? ` ${t("dappUi.privacy.notPrivate")}` : ""}`;
}

/**
 * A withdrawal in a sentence. `back`: the account's staking money comes back
 * to it (`stakingComesBack`); `whose`: "your public account" or "your
 * private session".
 */
export function withdrawalLine(w: Withdrawal, back: boolean, whose: string): string {
  if (!w.own) return t("dappUi.withdrawal.notYours", { amount: formatAda(w.lovelace) });
  return t(back ? "dappUi.withdrawal.into" : "dappUi.withdrawal.notAllBack", { amount: formatAda(w.lovelace), whose });
}

/** A certificate in a sentence: the account's own staking, or someone else's. `back` and `whose` as for a withdrawal. */
export function certificateLine(c: Certificate, back: boolean, whose: string): string {
  if (!c.own) {
    if (c.kind === "pool") {
      if (c.pool && c.poolAction === "retire") return t("dappUi.cert.retirePool", { pool: c.pool });
      if (c.pool && c.poolAction === "register") return t("dappUi.cert.registerPool", { pool: c.pool });
      return t("dappUi.cert.pool");
    }
    if (c.kind === "drep") return t("dappUi.cert.drep");
    if (c.kind === "committee") return t("dappUi.cert.committee");
    return t("dappUi.cert.otherStakeKey");
  }
  const parts: string[] = [];
  if (c.kind.startsWith("register")) {
    parts.push(c.deposit ? t("dappUi.cert.registersWithDeposit", { amount: formatAda(c.deposit) }) : t("dappUi.cert.registers"));
  }
  if (c.kind === "unregister") {
    const deposit = c.refund ? t("dappUi.cert.andItsDeposit", { amount: formatAda(c.refund) }) : "";
    if (!c.refund) parts.push(t("dappUi.cert.stops"));
    else if (back) parts.push(t("dappUi.cert.stopsBack", { deposit, whose }));
    else parts.push(t("dappUi.cert.stopsNotAllBack", { deposit, whose }));
  }
  if (c.pool) parts.push(t("dappUi.cert.stakesWith", { pool: c.pool }));
  if (c.drep) parts.push(t("dappUi.cert.delegatesVote", { what: voteLabel(c.drep) }));
  const sentence = parts.join(t("histories.list.comma"));
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
