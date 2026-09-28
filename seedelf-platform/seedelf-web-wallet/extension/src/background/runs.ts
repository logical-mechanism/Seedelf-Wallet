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
  /** How many times it's been started, by anything: a run stops it only if nothing did while the run went on. */
  starts(): number;
}

/**
 * One run over every network. Locked, the alarm stops until unlock.
 * `unlock`: the run as the wallet unlocks. Nothing goes out in it (privacy
 * review §3.1): a swap's step found then, and each Lovejoin box due, waits a
 * fresh draw inside the stretch the unlock keeps the wallet open. And
 * Lovejoin's pool is read even with nothing due, on a network where the
 * wallet has something open there.
 *
 * Lovejoin's boxes go last, after every network's other work: none goes back
 * in a run that sent anything else (lovejoin.ts).
 *
 * The alarm is decided once, after every network: it goes on if any of them
 * has something running, and stops only if none has and nothing started it
 * meanwhile. A swap or a chain the user sends while a run reads Koios starts
 * it, and the run never stops it from under them: it's left on for one more
 * run, which stops it if nothing runs by then.
 */
export async function runNetworks(ctx: Runner, alarm: Alarm, unlock = false): Promise<void> {
  if ((await ctx.wallet.state()) !== "unlocked") {
    await alarm.stop();
    return;
  }
  const started = alarm.starts();
  const since = Date.now();
  let busy = false;
  for (const network of ctx.networks) {
    // One network's failure (Koios down, a record that won't open) never stops the other's.
    if (await ctx.sessions.runAll(network, unlock).catch(() => false)) busy = true;
    // A public mix still being sent keeps the alarm going too.
    if (await ctx.lovejoin.pumpPublic(network).catch(() => false)) busy = true;
    // And a payment that may still go through, sent again now and then until it's settled.
    if (await ctx.pending.watch(network, unlock).catch(() => false)) busy = true;
  }
  for (const network of ctx.networks) {
    await ctx.lovejoin.withdrawDue(network, unlock, since).catch(() => undefined);
    // Lovejoin's boxes on their way back keep the alarm going too: each comes
    // back soon after its own due time while the wallet is unlocked, rather
    // than all of them at the next unlock. A minute with nothing due asks
    // Koios nothing.
    if ((await ctx.lovejoin.held(network).catch(() => undefined))?.boxes) busy = true;
  }
  if (busy) await alarm.start();
  else if (alarm.starts() === started) await alarm.stop();
}
