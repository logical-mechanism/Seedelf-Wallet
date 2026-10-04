// The connector window's words for a site's transaction (screens/DappApprovals.tsx):
// who each output pays, and where the account's staking money goes. Rewards
// withdrawn and a deposit refunded are the account's money as much as its
// UTxOs are, and the headline counts them in what it sends; these say
// whether they come back to it.

import { joinSentences, t } from "../i18n";
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
 *
 * Its keys, and those of the staking lines below, are named `.privacy.` and
 * `.warn.` because they show in a warning the critical-set deriver can't see
 * into: it reads only the JSX, and these are built here, so a key's own name
 * is what keeps it checked (tests/i18n-critical-helpers.test.ts holds them to it).
 */
export function tiesLine(ties: Array<"account" | number>, session: boolean): string {
  const names = ties.map((x) =>
    x === "account" ? t("dappUi.ties.privacy.account") : t("dappUi.ties.privacy.session", { number: x + 1 }),
  );
  const list =
    names.length > 1
      ? t("dappUi.ties.privacy.list", { first: names.slice(0, -1).join(t("histories.list.comma")), last: names.at(-1) })
      : names[0];
  return t("dappUi.ties.privacy.moves", {
    from: t(session ? "dappUi.ties.privacy.thisSession" : "dappUi.ties.privacy.yourAccount"),
    list,
  });
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
    return joinSentences([
      t("dappUi.privacy.tiesToSession"),
      checked && t(seedelf ? "dappUi.privacy.notAccount" : "dappUi.privacy.notAccountNorPrivate"),
    ]);
  }
  return joinSentences([t("dappUi.privacy.tiesToAccount"), checked && !seedelf && t("dappUi.privacy.notPrivate")]);
}

/**
 * A withdrawal in a sentence. `back`: the account's staking money comes back
 * to it (`stakingComesBack`); `whose`: "your public account" or "your
 * private session". All three are `.warn.`: they share the staking callout,
 * which is a warning whenever the account's own staking or money is in it.
 */
export function withdrawalLine(w: Withdrawal, back: boolean, whose: string): string {
  if (!w.own) return t("dappUi.withdrawal.warn.notYours", { amount: formatAda(w.lovelace) });
  return t(back ? "dappUi.withdrawal.warn.into" : "dappUi.withdrawal.warn.notAllBack", {
    amount: formatAda(w.lovelace),
    whose,
  });
}

/**
 * A certificate in a sentence: the account's own staking, or someone else's.
 * `back` and `whose` as for a withdrawal.
 *
 * The account's own is a whole sentence for each thing a certificate does, or
 * does together (WebAssembly's kinds: register, delegate, vote and their
 * combinations, unregister), so each language joins the clauses its own way.
 * Pieced together from fragments, with a capital and a full stop added here,
 * Japanese read "…登録します（…）、…にステーキングします、投票権を委任します:
 * 常に棄権.": finished sentences comma-spliced, then an ASCII full stop.
 */
export function certificateLine(c: Certificate, back: boolean, whose: string): string {
  // Someone else's are `.warn.` too: they sit in the same callout as the
  // account's own, and "a stake key that isn't yours" read as "your stake key"
  // is the error a check is there to catch.
  if (!c.own) {
    if (c.kind === "pool") {
      if (c.pool && c.poolAction === "retire") return t("dappUi.cert.warn.retirePool", { pool: c.pool });
      if (c.pool && c.poolAction === "register") return t("dappUi.cert.warn.registerPool", { pool: c.pool });
      return t("dappUi.cert.warn.pool");
    }
    if (c.kind === "drep") return t("dappUi.cert.warn.drep");
    if (c.kind === "committee") return t("dappUi.cert.warn.committee");
    return t("dappUi.cert.warn.otherStakeKey");
  }
  // The account's own DRep (CIP-95): its registration, update or retirement.
  if (c.kind === "drep") {
    if (c.drepAction === "register") return t("dappUi.cert.warn.drepRegister", { amount: formatAda(c.deposit ?? "0") });
    if (c.drepAction === "retire") {
      return t(back ? "dappUi.cert.warn.drepRetireBack" : "dappUi.cert.warn.drepRetireNotAllBack", {
        amount: formatAda(c.refund ?? "0"),
        whose,
      });
    }
    return t("dappUi.cert.warn.drepUpdate");
  }
  const what = c.drep ? voteLabel(c.drep) : undefined;
  if (c.kind.startsWith("register") && c.deposit) {
    const amount = formatAda(c.deposit);
    if (c.pool && what) return t("dappUi.cert.warn.registersStakesVotes", { amount, pool: c.pool, what });
    if (c.pool) return t("dappUi.cert.warn.registersStakes", { amount, pool: c.pool });
    if (what) return t("dappUi.cert.warn.registersVotes", { amount, what });
    return t("dappUi.cert.warn.registersDeposit", { amount });
  }
  // A registration with no deposit is WebAssembly's plain "register", and a
  // stop is "unregister": neither comes with a delegation. Were one to, each
  // part would still be said, as a sentence of its own.
  return joinSentences([
    c.kind.startsWith("register") && t("dappUi.cert.warn.registers"),
    c.kind === "unregister" && stopsLine(c, back, whose),
    delegationLine(c.pool, what),
  ]);
}

/** The account's staking stopped, and whether the deposit it gets back comes back to it. */
function stopsLine(c: Certificate, back: boolean, whose: string): string {
  if (!c.refund) return t("dappUi.cert.warn.stops");
  return t(back ? "dappUi.cert.warn.stopsBack" : "dappUi.cert.warn.stopsNotAllBack", { amount: formatAda(c.refund), whose });
}

/** Where the account's stake goes, or its vote, or both, as one sentence. */
function delegationLine(pool: string | null, what: string | undefined): string | undefined {
  if (pool && what) return t("dappUi.cert.warn.stakesVotes", { pool, what });
  if (pool) return t("dappUi.cert.warn.stakes", { pool });
  if (what) return t("dappUi.cert.warn.votes", { what });
  return undefined;
}
