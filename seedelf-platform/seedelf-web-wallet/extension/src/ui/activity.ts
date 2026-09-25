// How Activity names what happened: each entry's title, its staking and its
// tokens in words, and the whole list as CSV for the Export button. Names
// come from what ships with the wallet (the token list, the DRep list) and
// what the worker already knew (a pool's ticker): nothing here asks anyone.

import type { NetworkName } from "../networks";
import type { ActivityEntry, ActivityStaking, TokenQuantity } from "../shared/rpc";
import { drepList } from "./dreps";
import { formatAda, formatQuantity, shortHex, voteLabel } from "./format";
import { tokenInfo, tokenLabel } from "./tokens";

/** What an entry is called. */
export function activityTitle(e: ActivityEntry): string {
  switch (e.kind) {
    case "received":
      return "Received";
    case "sent":
      return "Sent";
    case "move-in":
      return "Made private";
    case "mint":
      return "Created a Seedelf";
    case "transfer":
      return "Sent to a Seedelf";
    case "withdraw":
      return "Made public";
    case "remove":
      return "Removed a Seedelf";
    case "send":
      return "Sent";
    case "collateral":
      return "Set collateral";
    case "stake":
      return "Staked";
    case "vote":
      return "Delegated voting power";
    case "withdraw-rewards":
      return "Withdrew rewards";
    case "unstake":
      return "Stopped staking";
  }
}

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

/** A staking entry's line under its title: "LOGIC", "Always abstain", "LOGIC · Always abstain". */
export function stakingLine(network: NetworkName, s: ActivityStaking | undefined): string | undefined {
  if (!s) return undefined;
  const line = [poolOf(s), voteOf(network, s)].filter(Boolean).join(" · ");
  return line || undefined;
}

/** A token amount with its sign, without its name: "+5", "−1". */
function signedQuantity(network: NetworkName, t: TokenQuantity, minus = "−"): string {
  const q = BigInt(t.quantity);
  const amount = formatQuantity((q < 0n ? -q : q).toString(), tokenInfo(network, t)?.decimals ?? 0);
  return `${q < 0n ? minus : "+"}${amount}`;
}

/** A token amount with its sign and name: "+5 tUSDM", "−1 abc…". */
export function tokenMoved(network: NetworkName, t: TokenQuantity): string {
  return `${signedQuantity(network, t)} ${tokenLabel(network, t)}`;
}

/** Why a CSV cell would run as a formula in a spreadsheet: someone else's note could start with one. */
const FORMULA = /^[=+\-@\t\r]/;

/** One CSV cell: quoted when it must be, and never a formula (free text gets a leading '). */
export function csvCell(value: string, text = false): string {
  const safe = text && FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const COLUMNS = [
  "Date (UTC)",
  "Type",
  "Direction",
  "ADA",
  "Network fee (ADA)",
  "Tokens",
  "To or from",
  "Note",
  "Pool",
  "Vote",
  "Deposit (ADA)",
  "Deposit back (ADA)",
  "Rewards withdrawn (ADA)",
  "Transaction",
];

/**
 * The entries as CSV, newest first, for a spreadsheet or a tax tool: amounts
 * in ADA with a sign ("-" out, none for a Seedelf's locked ADA), each token
 * with its own sign, and the transaction's ID. Starts with a byte-order mark
 * so a spreadsheet reads it as UTF-8.
 */
export function activityCsv(network: NetworkName, entries: ActivityEntry[]): string {
  const ada = (lovelace?: string) => (lovelace ? formatAda(lovelace).replaceAll(",", "") : "");
  const rows = entries.map((e) => {
    const sign = e.direction === "in" ? "" : e.direction === "out" ? "-" : "";
    // Name first: a token's name is its own, and never a formula (csvCell).
    const tokens = (e.assets ?? [])
      .map((t) => `${tokenLabel(network, t)}: ${signedQuantity(network, t, "-").replaceAll(",", "")}`)
      .join("; ");
    const s = e.staking ?? {};
    return [
      csvCell(e.at ? new Date(e.at).toISOString() : ""),
      csvCell(activityTitle(e)),
      csvCell(e.direction),
      csvCell(`${sign}${ada(e.lovelace)}`),
      csvCell(ada(e.fee)),
      csvCell(tokens || (e.tokens ? `${e.tokens} kinds` : ""), true),
      csvCell(e.detail ?? "", true),
      csvCell(e.note ?? "", true),
      csvCell(s.pool ? `${s.ticker ? `${s.ticker} ` : ""}${s.pool}` : "", true),
      csvCell(s.drep ? (voteOf(network, s) ?? s.drep) : "", true),
      csvCell(ada(s.deposit)),
      csvCell(ada(s.refund)),
      csvCell(ada(s.rewards)),
      csvCell(e.txHash),
    ].join(",");
  });
  return `\uFEFF${[COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}
