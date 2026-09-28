// The connector window's words for a site's transaction (screens/DappApprovals.tsx):
// who each output pays, and where the account's staking money goes. Rewards
// withdrawn and a deposit refunded are the account's money as much as its
// UTxOs are, and the headline counts them in what it sends; these say
// whether they come back to it.

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
      ? "Your public account"
      : p.yours !== undefined
        ? `Your private session ${p.yours + 1}`
        : p.ownPaymentKey
          ? "Your payment key, with a stake part that isn't yours"
          : p.seedelf
            ? "Seedelf Wallet's contract"
            : p.script
              ? "A contract"
              : "An address";
  return p.datum ? `${what}, with data` : what;
}

/**
 * What of the wallet's other accounts a site's transaction moves money with,
 * which signing ties together on chain for anyone to see (independent review
 * M12): `ties` as the worker found them; `session`, the site is on a private
 * session, not the public account.
 */
export function tiesLine(ties: Array<"account" | number>, session: boolean): string {
  const names = ties.map((t) => (t === "account" ? "your public account" : `your private session ${t + 1}`));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `It moves money between ${session ? "this private session" : "your public account"} and ${list}. Signing ties them together on chain, where anyone can see it.`;
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
    const out = !checked ? "" : seedelf ? " Your public account isn't in it." : " Your public account and your private balance aren't in it.";
    return `Signing ties this transaction to the session's one-time account.${out}`;
  }
  return `Signing ties this transaction to your public account, as any payment from it.${checked && !seedelf ? " Your private balance isn't in it." : ""}`;
}

/**
 * A withdrawal in a sentence. `back`: the account's staking money comes back
 * to it (`stakingComesBack`); `whose`: "your public account" or "your
 * private session".
 */
export function withdrawalLine(w: Withdrawal, back: boolean, whose: string): string {
  if (!w.own) return `Withdraws ${formatAda(w.lovelace)} ₳ from a reward account that isn't yours.`;
  const rewards = `Withdraws your staking rewards, ${formatAda(w.lovelace)} ₳`;
  return back
    ? `${rewards}, into ${whose}.`
    : `${rewards}, and they don't all come back to ${whose}: they're counted in what it sends above.`;
}

/** A certificate in a sentence: the account's own staking, or someone else's. `back` and `whose` as for a withdrawal. */
export function certificateLine(c: Certificate, back: boolean, whose: string): string {
  if (!c.own) {
    if (c.kind === "pool") {
      if (c.pool && c.poolAction === "retire") return `Retires stake pool ${c.pool}.`;
      if (c.pool && c.poolAction === "register") return `Registers stake pool ${c.pool}, or updates its terms.`;
      return "A stake pool's certificate.";
    }
    if (c.kind === "drep") return "A DRep's certificate.";
    if (c.kind === "committee") return "A constitutional committee certificate.";
    return "A certificate for a stake key that isn't yours.";
  }
  const parts: string[] = [];
  if (c.kind.startsWith("register")) parts.push(`Registers your stake key${c.deposit ? ` (a ${formatAda(c.deposit)} ₳ deposit)` : ""}`);
  if (c.kind === "unregister") {
    const deposit = c.refund ? `, and its ${formatAda(c.refund)} ₳ deposit` : "";
    if (!c.refund) parts.push("Stops your staking");
    else if (back) parts.push(`Stops your staking${deposit} comes back to ${whose}`);
    else parts.push(`Stops your staking${deposit} doesn't all come back to ${whose}: it's counted in what it sends above`);
  }
  if (c.pool) parts.push(`stakes with ${c.pool}`);
  if (c.drep) parts.push(`delegates your vote: ${voteLabel(c.drep)}`);
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
