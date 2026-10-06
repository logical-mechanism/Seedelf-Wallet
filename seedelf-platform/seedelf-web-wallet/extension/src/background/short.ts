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
//
// The private side said only "for this and its fee" until blind test T05: its
// Send and Make public now say the most that can go, and what has to stay
// (`privateShortOf`), as the public side does.

import { t } from "../i18n";
import { isTrap } from "./wasm";

/** Core's shortfalls: the public account's (`*_SHORT` but `SEEDELF_SHORT`), and the private balance's. */
const PUBLIC_SHORT = /Not enough ADA in the Cardano account/;
const PRIVATE_SHORT = /Not enough ADA in the Seedelf balance/;

/** Whether `e` is core saying the public account can't pay. */
export const isPublicShort = (e: unknown): boolean => e instanceof Error && PUBLIC_SHORT.test(e.message);

/** Whether `e` is core saying the private balance can't pay. */
const isPrivateShort = (e: unknown): boolean => e instanceof Error && PRIVATE_SHORT.test(e.message);

/** A private spend's shortfall in the user's words; any other error as it was. */
export function privateShort(e: unknown): unknown {
  return isPrivateShort(e) ? new Error(t("worker.short.private")) : e;
}

/** What a private payment built as Max says, for a shortfall's figures (WebAssembly's `TransferResult`/`WithdrawResult`). */
export interface PrivateMost {
  payments: Array<{ lovelace: string }>;
  /** What stays in the private balance: the tokens kept, with the least ADA they need. */
  changeLovelace: string;
  changeTokens: number;
  /** The least ADA what stays needs: the kept tokens', or, with none, an output of ADA alone. */
  changeMinimum: string;
}

/**
 * A private payment's shortfall in the user's words, with what must stay behind and the most that can go (blind
 * test T05). "Not enough ADA … for this and its fee" also refused amounts well within the fee on screen: what
 * stays must carry the least ADA the network accepts, 1.64642 ₳ while it held a token, and the tester needed about
 * 15 guesses to find the limit. WebAssembly now measures an amount before refusing it, so the limit is the
 * review's own fee's; `most` builds the payment again as Max would (the same UTxOs, read already: nothing asked of
 * anyone) and says what that pays. It says "about" that much: each build's fee depends a little on its new one-time
 * key (the script finds that key's hash among the signers a step sooner or later, a few hundred lovelace), so the
 * figure moves that much from one build to the next. Max itself always pays exactly what its review shows.
 *
 * - `asked` is each payment's lovelace as asked (null for Max). One payment: past Max's, "up to" Max's figure, and
 *   what the tokens kept need to keep with them; at or under it, it's what would stay that's too little, and the
 *   least that can.
 * - Several: no Max measures them, so as the public side says it (`severalShort`), against `available`, the
 *   private UTxOs' lovelace.
 * - Max itself short, or a rebuild that fails: the plain sentence. A trap is thrown as it is (wasm.ts).
 */
export async function privateShortOf(
  e: unknown,
  asked: Array<string | null>,
  most: () => Promise<PrivateMost>,
  available: bigint,
): Promise<unknown> {
  if (!isPrivateShort(e)) return e;
  const plain = new Error(t("worker.short.private"));
  if (asked.length > 1) {
    if (asked.some((a) => a === null || !/^\d+$/.test(a))) return new Error(t("worker.short.privateSeveral"));
    const total = asked.reduce((sum, a) => sum + BigInt(a!), 0n);
    return new Error(t(total < available ? "worker.short.privateSeveralLeft" : "worker.short.privateSeveral"));
  }
  const [one] = asked;
  if (one === null || one === undefined || !/^\d+$/.test(one)) return plain;
  let max: PrivateMost;
  try {
    max = await most();
  } catch (err) {
    if (isTrap(err)) throw err;
    return plain;
  }
  const top = BigInt(max.payments[0]!.lovelace);
  if (top >= BigInt(one)) return new Error(t("worker.short.privateLeft", { least: adaWords(max.changeMinimum) }));
  return new Error(
    max.changeTokens > 0
      ? t("worker.short.privateUpToKept", { max: adaWords(top.toString()), kept: adaWords(max.changeLovelace) })
      : t("worker.short.privateUpTo", { max: adaWords(top.toString()) }),
  );
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
