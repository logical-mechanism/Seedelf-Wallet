// How many people one payment pays, on either side: one to MAX_RECIPIENTS,
// each with its own amount and tokens. WebAssembly checks it again, and core
// refuses a transaction over the network's 16 KiB whatever the count.

/** The most recipients one payment pays (WebAssembly's `MAX_RECIPIENTS`). */
export const MAX_RECIPIENTS = 20;

/** Throws the reason a payment can't have `count` recipients. */
export function checkRecipients(count: number): void {
  if (count === 0) throw new Error("A payment needs someone to pay.");
  if (count > MAX_RECIPIENTS) throw new Error(`A payment pays at most ${MAX_RECIPIENTS} recipients at once.`);
}
