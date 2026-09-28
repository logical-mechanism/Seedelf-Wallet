// A mix from the public account that stopped at a transaction that may have
// gone through holds only what that transaction spends, never its
// collateral: the mixes after it never go, so their pool boxes are free for
// another chain, and the collateral for a site's transaction (final review
// F2). A new mix is refused until it's settled, and the refusal says how
// long that can take: up to two hours after it was sent (independent review
// L5).
import { describe, expect, it } from "vitest";

import { SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { reservationOf, SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { CHAINS, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";

const COLLATERAL = `${"e5".repeat(32)}#0`;
const MINUTE = 60_000;

/**
 * Koios never answers a submit from the `from`th on: the first of those
 * reaches the node all the same (its answer is lost), and every other doesn't.
 */
function unansweredFrom(t: Tested, from: number) {
  const fetch = t.koios.fetch;
  const state = { down: true, submits: 0 };
  t.koios.fetch = async (url, init) => {
    if (state.down && url.endsWith("/submittx")) {
      const n = ++state.submits;
      if (n < from) return fetch(url, init);
      if (n === from) await fetch(url, init);
      throw new TypeError("Failed to fetch");
    }
    return fetch(url, init);
  };
  return state;
}

const reservedPublic = async (t: Tested) =>
  (await t.wallet.withKeys(() => t.session.get<Record<string, { inputs: string[]; collateral: string[]; until?: number }>>(SESSION_RESERVED_PREFIX + "preprod")))
    ?.public;

/** A mix of one box from the public account, reviewed, whose submits from the `from`th on Koios never answers. */
async function stoppedAt(from: number) {
  const t = await publicFunded("60000000", ["60000000"]);
  const mix = await t.lovejoin.publicBuild("preprod", 1);
  const { chain } = (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ kind: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC)))!;
  const net = unansweredFrom(t, from);
  await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("may have gone through");
  net.down = false;
  return { t, chain };
}

describe("a mix from the public account stopped at a transaction that may have gone through (independent review L5)", CHAINS, () => {
  it("stopped at its deposit, holds only what the deposit spends: the pool boxes and the collateral are free", async () => {
    const { t, chain } = await stoppedAt(1);
    const deposit = reservationOf([chain[0]!]);
    expect(await reservedPublic(t)).toEqual({ inputs: deposit.inputs, collateral: [] });
    expect(deposit.inputs).not.toContain(COLLATERAL);
    // None of the pool boxes its mixes would have taken is held back from another chain's draw.
    const room = (await t.lovejoin.room("preprod"))!;
    expect(room.free).toBe(room.others);
  });

  it("stopped at a mix, holds that mix's inputs, and neither its collateral nor the mixes' after it (final review F2)", async () => {
    const { t, chain } = await stoppedAt(2);
    expect(chain[1]!.kind).toBe("mix");
    const mix = reservationOf([chain[1]!]);
    expect(mix.collateral).toEqual([COLLATERAL]);
    expect(await reservedPublic(t)).toEqual({ inputs: mix.inputs, collateral: [] });
    const whole = reservationOf(chain);
    expect(whole.inputs.length).toBeGreaterThan(mix.inputs.length);
    // The mix's own pool boxes count as spent; the ones the mixes after it would have taken are free.
    const room = (await t.lovejoin.room("preprod"))!;
    expect(room.free).toBe(room.others);
  });

  it("says when it will be settled at the latest, if the network never shows it: two hours after it was sent", async () => {
    const { t } = await stoppedAt(1);
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow(
      "If it never went through, the wallet can only be sure two hours after it was sent, in about 2 hours.",
    );
    // The clock's jumps lock the wallet (its auto-lock): unlocked again each time, as the user would.
    const later = async (ms: number) => {
      t.clock.now += ms;
      await t.wallet.unlock(PASSWORD);
    };
    await later(28 * MINUTE);
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow("in about 1 hour 32 minutes.");
    await later(61 * MINUTE);
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("in about 31 minutes.");
    await later(30 * MINUTE);
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("in about 1 minute.");
    await later(MINUTE);
    await t.lovejoin.publicBuild("preprod", 1);
  });
});
