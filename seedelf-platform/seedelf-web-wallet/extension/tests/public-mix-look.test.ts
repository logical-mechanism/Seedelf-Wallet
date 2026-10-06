// A mix from the public account stopped at a transaction that may have gone
// through is looked for (tx_status, and utxo_info when that says nothing).
// Home asks for the mix's progress every 20 s, and the UTxOs page at every
// read: they look at most every two minutes on a network, as the alarm does
// a payment that may still go through, and a look then still settles it and
// lets its reservation go. A Review looks each time (independent review L5).
// Past the two hours, with Koios not answering, the Review says so.
import { describe, expect, it } from "vitest";

import { PUBLIC_LOOK_MS } from "../src/background/lovejoin";
import { SESSION_RESERVED_PREFIX, SPENT_KEEP_MS } from "../src/background/spent";
import { CHAINS, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";

const DEPOSIT_INPUT = `${"e6".repeat(32)}#0`;

const looks = (t: Tested) => t.koios.calls.filter((c) => c.path === "tx_status" || c.path === "utxo_info").length;
const reservedPublic = async (t: Tested) =>
  (await t.wallet.withKeys(() => t.session.get<Record<string, { until?: number }>>(SESSION_RESERVED_PREFIX + "preprod")))?.public;

/** A mix of one box sent from the public account, whose deposit's first submit reached the node and no submit was answered. */
async function stoppedMaybe() {
  const t = await publicFunded("60000000", ["60000000"]);
  const mix = await t.lovejoin.publicBuild("preprod", 1);
  const fetch = t.koios.fetch;
  let submits = 0;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return fetch(url, init);
    if (submits++ === 0) await fetch(url, init);
    throw new TypeError("Failed to fetch");
  };
  await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("may have gone through");
  t.koios.fetch = fetch;
  return t;
}

describe("looking for a public mix's transaction that may have gone through (independent review L5)", CHAINS, () => {
  it("asks Koios at most every two minutes however often its progress is asked for, and settles it then", async () => {
    const t = await stoppedMaybe();
    const before = looks(t);
    for (let k = 0; k < 5; k++) {
      expect(await t.lovejoin.progress("preprod")).toMatchObject({ sent: 0, maybeSent: true });
      t.clock.now += 20_000;
    }
    // One look: tx_status, then utxo_info, which says what it spends isn't spent yet.
    expect(looks(t) - before).toBe(2);
    expect(await reservedPublic(t)).toEqual(expect.objectContaining({ inputs: expect.arrayContaining([DEPOSIT_INPUT]) }));

    // A Review looks each time.
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
    expect(looks(t) - before).toBe(4);

    // It lands; the next look, two minutes after the last, says so, and what it held goes.
    t.koios.confirmations = 1;
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ sent: 0, maybeSent: true });
    expect(looks(t) - before).toBe(4);
    t.clock.now += PUBLIC_LOOK_MS;
    const progress = await t.lovejoin.progress("preprod");
    expect(progress).toMatchObject({ sent: 1 });
    expect(progress?.maybeSent).toBeUndefined();
    expect(await reservedPublic(t)).toBeUndefined();
  });

  it("looks from its record the same way once a lock wiped its progress", async () => {
    const t = await stoppedMaybe();
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    const before = looks(t);
    for (let k = 0; k < 3; k++) expect(await t.lovejoin.progress("preprod")).toMatchObject({ sent: 0, maybeSent: true });
    expect(looks(t) - before).toBe(2);
    t.clock.now += PUBLIC_LOOK_MS;
    await t.lovejoin.progress("preprod");
    expect(looks(t) - before).toBe(4);
  });

  it("says it couldn't reach Koios when that's all that keeps it unsure, past the two hours", async () => {
    const t = await stoppedMaybe();
    t.clock.now += SPENT_KEEP_MS;
    await t.wallet.unlock(PASSWORD);
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/tx_status") ? new Response("", { status: 503 }) : fetch(url, init));
    const error = await t.lovejoin.publicBuild("preprod", 1).then(
      () => undefined,
      (e: unknown) => String(e),
    );
    expect(error).toMatch("may have gone through, and Koios didn't answer to check");
    expect(error).not.toMatch("if not.");
    // Koios answers again: unseen, and what it spends unspent, two hours on, it never went.
    t.koios.fetch = fetch;
    await t.lovejoin.publicBuild("preprod", 1);
  });
});
