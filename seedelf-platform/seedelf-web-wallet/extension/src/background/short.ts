// When what a payment spends can't pay for it: core's own sentence (seedelf-core
// build.rs `NotEnough`) in the user's words. Shown as it was, it was English
// whatever the language, it called the public account "the Cardano account"
// and the private balance "the Seedelf balance", two more names for places the
// screens call something else, it spoke of "the change", and it didn't say how
// much could go (chunk 23's second review, PY-10). Core's wording is read here
// only to tell which shortfall it is; nothing translated is ever read back.
//
// Core says it too when the amount fits but what would stay in the account is
// less than the least ADA the network accepts: 100 ₳ in one UTxO, 99.5 ₳ asked.
// Max then pays more than was asked, and "up to {max}" would be false, so that
// one says what stays is too little (chunk 23's second review, fix round).

import { t } from "../i18n";
import { isTrap } from "./wasm";

/** Core's shortfalls: the public account's (`*_SHORT` but `SEEDELF_SHORT`), and the private balance's. */
const PUBLIC_SHORT = /Not enough ADA in the Cardano account/;
const PRIVATE_SHORT = /Not enough ADA in the Seedelf balance/;

/** Whether `e` is core saying the public account can't pay. */
export const isPublicShort = (e: unknown): boolean => e instanceof Error && PUBLIC_SHORT.test(e.message);

/** A private spend's shortfall in the user's words; any other error as it was. */
export function privateShort(e: unknown): unknown {
  return e instanceof Error && PRIVATE_SHORT.test(e.message) ? new Error(t("worker.short.private")) : e;
}

/**
 * Lovelace as the screens write ADA, "10,408.014036" (ui/format.ts `formatAda`): grouped, and the decimals' zeros
 * trimmed. The worker keeps clear of the UI layer, so it has its own.
 */
export function adaWords(lovelace: string): string {
  const value = BigInt(lovelace);
  const whole = (value / 1_000_000n).toLocaleString("en-US");
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * The shortfall of a payment from the public account that one more build can measure: `most` builds it again as
 * Max would (nothing asked of anyone; the same UTxOs, read already) and gives what that pays, or throws when even
 * Max can't. `say` is the sentence for that most; without one, the plain shortfall. `asked`, the lovelace asked
 * for: when Max pays at least that, it's what would stay that's short, and `left` says so instead. A trap in the
 * rebuild is the instance broken, never a shortfall: it's thrown as it is, and the wallet locks (wasm.ts).
 */
export function publicShort(
  most: (() => string) | undefined,
  say: (max: string) => string,
  { asked, left }: { asked?: string; left?: () => string } = {},
): Error {
  if (!most) return new Error(t("worker.short.public"));
  let max: bigint;
  try {
    max = BigInt(most());
  } catch (e) {
    if (isTrap(e)) throw e;
    return new Error(t("worker.short.public"));
  }
  if (left && asked !== undefined && /^\d+$/.test(asked) && max >= BigInt(asked)) return new Error(left());
  return new Error(say(adaWords(max.toString())));
}

/**
 * Several payments' shortfall, which no Max measures: they come to more than the account holds (`available`, its
 * UTxOs and any rewards withdrawn with them), or they fit and what would stay is too little (`publicShort`'s
 * `left`). An amount left to the most possible (null) can't be added up: the plain sentence then.
 */
export function severalShort(asked: Array<string | null>, available: bigint): Error {
  if (asked.some((a) => a === null || !/^\d+$/.test(a))) return new Error(t("worker.short.sendSeveral"));
  const total = asked.reduce((sum, a) => sum + BigInt(a!), 0n);
  return new Error(t(total < available ? "worker.short.sendSeveralLeft" : "worker.short.sendSeveral"));
}
