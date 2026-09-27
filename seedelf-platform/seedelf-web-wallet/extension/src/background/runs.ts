// The worker's own runs, at unlock and on the sessions alarm while unlocked:
// the next step of every swap that runs itself, more of every chain being
// sent, Lovejoin's boxes due back, and a payment that may still go through.
//
// On every network the build has, not only the one the wallet shows: a switch
// in Settings never leaves a swap, a chain, a box due back or a maybe-sent
// payment waiting on the other. A network with nothing of the wallet's asks
// Koios nothing (each service looks at its own records first).

import type { Context } from "./handlers";

export type Runner = Pick<Context, "wallet" | "sessions" | "lovejoin" | "pending" | "networks">;

export interface Alarm {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * One run over every network. Locked, the alarm stops until unlock. `scan`:
 * read Lovejoin's pool even with nothing due (at unlock), on a network where
 * the wallet has used it.
 */
export async function runNetworks(ctx: Runner, alarm: Alarm, scan = false): Promise<void> {
  if ((await ctx.wallet.state()) !== "unlocked") {
    await alarm.stop();
    return;
  }
  let busy = false;
  for (const network of ctx.networks) {
    // One network's failure (Koios down, a record that won't open) never stops the other's.
    if (await ctx.sessions.runAll(network).catch(() => false)) busy = true;
    // A public mix still being sent keeps the alarm going too.
    if (await ctx.lovejoin.pumpPublic(network).catch(() => false)) busy = true;
    await ctx.lovejoin.withdrawDue(network, scan).catch(() => undefined);
    // So do Lovejoin's boxes on their way back: each comes back within a minute
    // of its own due time while the wallet is unlocked, rather than all of them
    // at the next unlock. A minute with nothing due asks Koios nothing.
    if ((await ctx.lovejoin.held(network).catch(() => undefined))?.boxes) busy = true;
    // And a payment that may still go through, sent again now and then until it's settled.
    if (await ctx.pending.watch(network).catch(() => false)) busy = true;
  }
  // runAll stops the alarm when its own network has nothing running: another's work starts it again.
  if (busy) await alarm.start();
}
