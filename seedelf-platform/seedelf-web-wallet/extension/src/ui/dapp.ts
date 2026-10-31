// The connector window's words for a site's transaction (screens/DappApprovals.tsx):
// who each output pays, and where the account's staking money goes. Rewards
// withdrawn and a deposit refunded are the account's money as much as its
// UTxOs are, and the headline counts them in what it sends; these say
// whether they come back to it.

import { joinSentences, t } from "../i18n";
import type { DappTie, DappTxSummary } from "../shared/rpc";
import { formatAda, proposalWords, voteLabel } from "./format";

type Paid = DappTxSummary["paid"][number];
type Certificate = DappTxSummary["certificates"][number];
type Withdrawal = DappTxSummary["withdrawals"][number];
type Proposal = DappTxSummary["proposals"][number];

/** A public account's number and name, where the wallet has more than one; undefined with one, "your public account" says it. */
export type AccountNamer = (index: number) => string | undefined;

/**
 * Whether the account's staking money comes back to it: its own outputs get
 * at least as much, the network fee aside (shown on its own row). When they
 * get less, the rest can only have gone to the others paid.
 */
export function stakingComesBack(s: Pick<DappTxSummary, "returnedLovelace" | "stakingLovelace" | "fee">): boolean {
  return BigInt(s.returnedLovelace) + BigInt(s.fee) >= BigInt(s.stakingLovelace);
}

/**
 * What an output pays, under its address: another of the wallet's own accounts by its name (independent review M12),
 * when its payment key is theirs (`yours`; never its stake key alone, C01).
 */
export function paidTo(p: Paid, named?: AccountNamer): string {
  const account = typeof p.yours === "object" ? named?.(p.yours.account) : undefined;
  const what =
    typeof p.yours === "object"
      ? account
        ? t("dappUi.paid.accountNamed", { account })
        : t("dappUi.paid.account")
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
 * session, not the public account; `named`, public accounts by number and
 * name, and `site`, the site's own so, where the wallet has several.
 *
 * Its keys, and those of the staking lines below, are named `.privacy.` and
 * `.warn.` because they show in a warning the critical-set deriver can't see
 * into: it reads only the JSX, and these are built here, so a key's own name
 * is what keeps it checked (tests/i18n-critical-helpers.test.ts holds them to it).
 */
export function tiesLine(ties: DappTie[], session: boolean, named?: AccountNamer, site?: string): string {
  return t("dappUi.ties.privacy.moves", { from: tiedFrom(session, site), list: tiedList(ties, named) });
}

/**
 * The wallet's other accounts whose stake key alone is in it (`staked`), as
 * `tiesLine`'s: someone else's address that carries it, or a contract's,
 * which none of the wallet's keys spends. Signing ties them all the same,
 * but never as money moving to them: that is how someone else's key under
 * another account's stake key passed for a payment to it (1.5.0's release
 * review, C01).
 */
export function stakedLine(staked: DappTie[], session: boolean, named?: AccountNamer, site?: string): string {
  return t("dappUi.ties.privacy.staked", { from: tiedFrom(session, site), list: tiedList(staked, named) });
}

/**
 * The wallet's other accounts whose stake key a certificate or a withdrawal
 * in it names (`certified`), as `tiesLine`'s. An old-style registration of
 * one needs no signature of that key's, so a site's transaction ties the two
 * with the one signature; WebAssembly knows the signing account's keys alone,
 * and the prompt said "a stake key that isn't yours" and that the other side
 * wasn't in it (1.5.0's release review, X05).
 */
export function certifiedLine(certified: DappTie[], session: boolean, named?: AccountNamer, site?: string): string {
  return t("dappUi.ties.privacy.certified", { from: tiedFrom(session, site), list: tiedList(certified, named) });
}

/** The account a site sees, for a ties line. */
const tiedFrom = (session: boolean, site?: string) =>
  session ? t("dappUi.ties.privacy.thisSession") : (site ?? t("dappUi.ties.privacy.yourAccount"));

/** One of the wallet's other accounts, as a ties line names it. */
const tiedName = (x: DappTie, named?: AccountNamer) =>
  typeof x === "number"
    ? t("dappUi.ties.privacy.session", { number: x + 1 })
    : (named?.(x.account) ?? t("dappUi.ties.privacy.account"));

/** The other accounts of a ties line, as a list. */
function tiedList(ties: DappTie[], named?: AccountNamer) {
  const names = ties.map((x) => tiedName(x, named));
  return names.length > 1
    ? t("dappUi.ties.privacy.list", { first: names.slice(0, -1).join(t("histories.list.comma")), last: names.at(-1) })
    : names[0];
}

/**
 * The prompt's words on what signing ties the transaction to (privacy
 * review §2.12). That the wallet's other side isn't in it is said only when
 * the worker checked (`ties`, empty): otherwise it may not be true
 * (independent review M12). Nor is the private balance said to be out of
 * it when it pays a Seedelf (`seedelf`): nothing says whose, so it may be
 * the user's own.
 */
export function signingTies(ties: DappTie[] | undefined, session: boolean, seedelf = false): string {
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
 * private session". All four are `.warn.`: they share the staking callout,
 * which is a warning whenever the account's own staking or money is in it.
 * One from another of the wallet's reward addresses is named by it
 * (`yours`, `named` as for a ties line), never as one that isn't yours (X05).
 */
export function withdrawalLine(w: Withdrawal, back: boolean, whose: string, named?: AccountNamer): string {
  if (!w.own && w.yours !== undefined) {
    return t("dappUi.withdrawal.warn.walletRewards", { amount: formatAda(w.lovelace), name: tiedName(w.yours, named) });
  }
  if (!w.own) return t("dappUi.withdrawal.warn.notYours", { amount: formatAda(w.lovelace) });
  return t(back ? "dappUi.withdrawal.warn.into" : "dappUi.withdrawal.warn.notAllBack", {
    amount: formatAda(w.lovelace),
    whose,
  });
}

/**
 * A certificate in a sentence: the account's own staking, or someone else's.
 * `back`, `whose` and `named` as for a withdrawal.
 *
 * The account's own is a whole sentence for each thing a certificate does, or
 * does together (WebAssembly's kinds: register, delegate, vote and their
 * combinations, unregister), so each language joins the clauses its own way.
 * Pieced together from fragments, with a capital and a full stop added here,
 * Japanese read "…登録します（…）、…にステーキングします、投票権を委任します:
 * 常に棄権.": finished sentences comma-spliced, then an ASCII full stop.
 */
/** A DRep certificate's line, then where its profile is, as text and never a link (C14). */
const withProfile = (c: Certificate, line: string) =>
  c.anchor ? joinSentences([line, t("dappUi.cert.warn.drepProfile", { url: c.anchor })]) : line;

export function certificateLine(c: Certificate, back: boolean, whose: string, named?: AccountNamer): string {
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
    // Another of the wallet's stake keys, by name (`yours`, X05): "isn't yours" was untrue of it.
    if (c.yours !== undefined) return t("dappUi.cert.warn.walletStakeKey", { name: tiedName(c.yours, named) });
    return t("dappUi.cert.warn.otherStakeKey");
  }
  // The account's own DRep (CIP-95): its registration, update or retirement.
  if (c.kind === "drep") {
    if (c.drepAction === "register") return withProfile(c, t("dappUi.cert.warn.drepRegister", { amount: formatAda(c.deposit ?? "0") }));
    if (c.drepAction === "retire") {
      return t(back ? "dappUi.cert.warn.drepRetireBack" : "dappUi.cert.warn.drepRetireNotAllBack", {
        amount: formatAda(c.refund ?? "0"),
        whose,
      });
    }
    return withProfile(c, t("dappUi.cert.warn.drepUpdate"));
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

/**
 * A governance proposal in a sentence: what it proposes, and whose stake key its deposit goes back to when the action
 * ends, which a site can make anyone's (chunk 39, a bounty report against 1.7.1). `whose` and `named` as for a
 * withdrawal: another of the wallet's stake keys by its name, never as one that isn't yours (X05); anyone else's with
 * its whole address. The deposit itself is in what the account sends, above.
 */
export function proposalLine(p: Proposal, whose: string, named?: AccountNamer): string {
  const what = proposalWords(p.action);
  const amount = formatAda(p.deposit);
  if (p.own) return t("dappUi.proposal.warn.own", { what, amount, whose });
  if (p.yours !== undefined) return t("dappUi.proposal.warn.wallet", { what, amount, name: tiedName(p.yours, named) });
  return t("dappUi.proposal.warn.notYours", { what, amount, address: p.address });
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
