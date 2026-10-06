// How Activity names what happened: each entry's title, its staking and its
// tokens in words, and the whole list as CSV for the Export button. Names
// come from what ships with the wallet (the token list, the DRep list) and
// what the worker already knew (a pool's ticker): nothing here asks anyone.

import { type I18nKey, t } from "../i18n";
import type { NetworkName } from "../networks";
import { entrySession, type ActivityEntry, type ActivityStaking, type TokenQuantity } from "../shared/rpc";
import { drepList } from "./dreps";
import { formatAda, formatQuantity, shortHex, voteLabel } from "./format";
import { tokenDecimals, tokenMark, tokenText } from "./tokens";

/** What an entry is called. */
export function activityTitle(e: ActivityEntry): string {
  switch (e.kind) {
    case "received":
      // Found by the private history's first reading (a restore, another profile): who paid isn't known
      // (independent review L38).
      return t(e.origin?.origin === "unknown" ? "activity.title.alreadyPrivate" : "activity.title.received");
    case "sent":
      return t("activity.title.sent");
    case "move-in":
      return t("activity.title.madePrivate");
    case "mint":
      return t("activity.title.mint");
    case "transfer":
      return t("activity.title.transfer");
    case "withdraw":
      return t("activity.title.madePublic");
    case "remove":
      return t("activity.title.remove");
    case "send":
      return t("activity.title.sent");
    case "collateral":
      return t("activity.title.collateral");
    case "stake":
      return t("activity.title.staked");
    case "vote":
      return t("activity.title.vote");
    case "withdraw-rewards":
      return t("activity.title.withdrewRewards");
    case "unstake":
      return t("activity.title.unstake");
    case "drep-register":
      return t("activity.title.drepRegister");
    case "drep-update":
      return t("activity.title.drepUpdate");
    case "drep-retire":
      return t("activity.title.drepRetire");
    case "drep-vote":
      return t("activity.title.drepVote");
    case "session-out":
      return t("activity.title.sessionOut");
    case "session-swap":
      return t("activity.title.sessionSwap");
    case "session-cancel":
      return t("activity.title.sessionCancel");
    case "session-back":
      return t("activity.title.sessionBack");
    case "lovejoin-withdraw":
      return t("activity.title.lovejoinWithdraw");
    case "lovejoin-mix":
      return t("activity.title.lovejoinMix");
  }
}

/**
 * Who or where an entry names, in words: a private session by its number,
 * whoever was paid (the first, and how many more beside), a Seedelf's label,
 * an address. Said here, in the page's language, from what the worker kept:
 * a session's entry from before it kept the number holds the English name
 * instead, which is read for the number (entrySession) and said again.
 */
export function activityDetail(e: ActivityEntry): string | undefined {
  const session = entrySession(e);
  if (session !== undefined) return t("claim.session", { number: session + 1 });
  if (e.detail !== undefined && e.more) return t("activity.andMore", { first: e.detail, count: e.more });
  return e.detail;
}

/**
 * An entry's amount, with its sign: "+25 ₳", "−5 ₳ and 1 token", or "1.74986 ₳" for a Seedelf's locked ADA. What
 * moved, the fee apart (the details say it): a payment is what it paid (blind test §9.1). One that moved nothing but
 * its fee, a vote or rewards withdrawn into the balance that counted them, is what it cost. `ada` writes an amount:
 * a page passes `useAmounts().ada`, so hidden balances stay hidden.
 */
export function activityAmount(e: ActivityEntry, ada: (lovelace: string) => string = formatAda): string {
  if (feeOnly(e)) return `−${ada(e.fee!)}\u00a0₳`;
  const sign = e.direction === "in" ? "+" : e.direction === "out" ? "−" : "";
  const held = e.tokens ? t("format.adaAndTokens", { ada: ada(e.lovelace), count: e.tokens }) : `${ada(e.lovelace)}\u00a0₳`;
  return `${sign}${held}`;
}

/** Whether an entry moved nothing but the fee it paid: its details then say the fee alone, not an amount beside it. */
export const feeOnly = (e: ActivityEntry) => BigInt(e.lovelace) === 0n && !e.tokens && !!e.fee;

/** A DRep's name, from the list that ships with the wallet. */
export function drepName(network: NetworkName, id: string): string | undefined {
  return drepList(network).dreps.find((d) => d.id === id)?.name;
}

/** The pool staked with: its ticker, else its shortened ID. */
export function poolOf(s: ActivityStaking): string | undefined {
  return s.pool ? (s.ticker ?? shortHex(s.pool, 10, 6)) : undefined;
}

/** The vote delegated, in words. */
export function voteOf(network: NetworkName, s: ActivityStaking): string | undefined {
  return s.drep ? voteLabel(s.drep, drepName(network, s.drep)) : undefined;
}

/** A staking entry's line under its title: "LOGIC", "Always abstain", "LOGIC · Always abstain", "2 governance actions". */
export function stakingLine(network: NetworkName, s: ActivityStaking | undefined): string | undefined {
  if (!s) return undefined;
  const votes = s.votes ? t("activity.govActions", { count: s.votes }) : undefined;
  const line = [poolOf(s), voteOf(network, s), votes].filter(Boolean).join(" · ");
  return line || undefined;
}

/** A token amount with its sign, without its name, in its units (`tokenDecimals`): "+5", "−1". */
export function signedQuantity(network: NetworkName, t: TokenQuantity, minus = "−"): string {
  const q = BigInt(t.quantity);
  const amount = formatQuantity((q < 0n ? -q : q).toString(), tokenDecimals(network, t));
  return `${q < 0n ? minus : "+"}${amount}`;
}

/**
 * A token amount with its sign and name, named as every text view names a
 * token (`tokenText`): "+5 tUSDM", or "−1 FOO (not on the wallet's list,
 * asset1qz8h…x7k3pd)".
 */
export function tokenMoved(network: NetworkName, t: TokenQuantity): string {
  const text = tokenText(network, t);
  const mark = tokenMark(text);
  return `${signedQuantity(network, t)} ${text.label}${mark ? ` (${mark})` : ""}`;
}

/** A token's name in the CSV: its ticker, or for one that isn't listed, its name or whole fingerprint, marked. */
function csvName(network: NetworkName, t: TokenQuantity): string {
  const text = tokenText(network, t);
  if (text.listed) return text.label;
  return `${text.label === text.id ? text.fingerprint : text.label} (${tokenMark(text, true)})`;
}

/** Why a CSV cell would run as a formula in a spreadsheet: someone else's note could start with one. */
const FORMULA = /^[=+\-@\t\r]/;

/** One CSV cell: quoted when it must be, and never a formula (free text gets a leading '). */
export function csvCell(value: string, text = false): string {
  const safe = text && FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The CSV's header. Translated, because the file is read by a person, and so
 * are the wallet's own words in the rows (an entry's type, its direction);
 * the dates, IDs and amounts stay language-neutral.
 */
const COLUMNS = (): string[] => [
  t("activity.csv.date"),
  t("activity.csv.type"),
  t("activity.csv.direction"),
  t("activity.csv.ada"),
  t("activity.csv.fee"),
  t("activity.csv.tokens"),
  t("activity.csv.toFrom"),
  t("activity.csv.note"),
  t("activity.csv.pool"),
  t("activity.csv.vote"),
  t("activity.csv.deposit"),
  t("activity.csv.depositBack"),
  t("activity.csv.rewards"),
  t("activity.csv.transaction"),
];

/** The direction column's words: into the balance, out of it, or neither (a Seedelf's locked ADA). */
const DIRECTION: Record<ActivityEntry["direction"], I18nKey> = {
  in: "activity.csv.in",
  out: "activity.csv.out",
  none: "activity.csv.none",
};

/**
 * The entries as CSV, newest first, for a spreadsheet or a tax tool: amounts
 * in ADA with a sign ("-" out, none for a Seedelf's locked ADA), the fee apart
 * in its own column, as the rewards withdrawn are in theirs, so ADA less the
 * fee is what the balance did (blind test §9.1), each token with its own sign,
 * and the transaction's ID. Not what's pending: it isn't on chain yet, and may
 * never be (`exported`). Starts with a byte-order mark so a spreadsheet reads
 * it as UTF-8.
 */
export function activityCsv(network: NetworkName, entries: ActivityEntry[]): string {
  const ada = (lovelace?: string) => (lovelace ? formatAda(lovelace).replaceAll(",", "") : "");
  const rows = exported(entries).map((e) => {
    const sign = e.direction === "in" ? "" : e.direction === "out" ? "-" : "";
    // Name first: a token's name is its own, and never a formula (csvCell).
    const tokens = (e.assets ?? [])
      .map((t) => `${csvName(network, t)}: ${signedQuantity(network, t, "-").replaceAll(",", "")}`)
      .join("; ");
    const s = e.staking ?? {};
    return [
      csvCell(e.at ? new Date(e.at).toISOString() : ""),
      csvCell(activityTitle(e)),
      csvCell(t(DIRECTION[e.direction])),
      csvCell(`${sign}${ada(e.lovelace)}`),
      csvCell(ada(e.fee)),
      // An older Seedelf entry knows only how many kinds of token moved.
      csvCell(tokens || (e.tokens ? t("activity.csv.tokenKinds", { count: e.tokens }) : ""), true),
      csvCell(activityDetail(e) ?? "", true),
      csvCell(e.note ?? "", true),
      csvCell(s.pool ? `${s.ticker ? `${s.ticker} ` : ""}${s.pool}` : "", true),
      csvCell(s.drep ? (voteOf(network, s) ?? s.drep) : "", true),
      csvCell(ada(s.deposit)),
      csvCell(ada(s.refund)),
      csvCell(ada(s.rewards)),
      csvCell(e.txHash),
    ].join(",");
  });
  return `\uFEFF${[COLUMNS().join(","), ...rows].join("\r\n")}\r\n`;
}

/** What Save as CSV writes: the entries on chain, not those still pending. */
export const exported = (entries: ActivityEntry[]) => entries.filter((e) => !e.pending);
