// A mix from the public account whose Send fails to put it where it's sent
// from leaves nothing that sends it: its review kept for Send goes before
// its progress is written, the progress last, and a write that fails
// before that takes its record and reservation with it (independent review
// L28).
import { describe, expect, it } from "vitest";

import { SESSION_LOVEJOIN_PUBLIC, SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { CHAINS, publicFunded, type Tested } from "./chain-fixtures";

const sendingNow = (t: Tested) => t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_SENDING + "preprod"));
const reserved = (t: Tested) => t.wallet.withKeys(() => t.session.get<Record<string, unknown>>(SESSION_RESERVED_PREFIX + "preprod"));

/** Makes the session storage's writes of `key` (`set` or `remove`) fail until the returned function is called. */
function failing(t: Tested, how: "set" | "remove", key: string) {
  const area = t.session as unknown as Record<"set" | "remove", (...args: unknown[]) => Promise<void>>;
  const was = area[how];
  area[how] = async (...args: unknown[]) => {
    if (args[0] === key) throw new Error("Storage failed.");
    return was(...args);
  };
  return () => {
    area[how] = was;
  };
}

async function nothingSendsIt(t: Tested, submits: number) {
  expect(await sendingNow(t)).toBeUndefined();
  expect((await reserved(t))?.public).toBeUndefined();
  expect((await t.lovejoin.status("preprod")).chains).toEqual([]);
  expect(await t.lovejoin.pumpPublic("preprod")).toBe(false);
  expect(t.koios.submitted.length).toBe(submits);
}

describe("a mix from the public account whose Send can't put it where it's sent from (independent review L28)", CHAINS, () => {
  it("leaves nothing that sends it when its review kept for Send can't be removed", async () => {
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const submits = t.koios.submitted.length;
    const restore = failing(t, "remove", SESSION_LOVEJOIN_PUBLIC);
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("Storage failed.");
    restore();
    await nothingSendsIt(t, submits);
  });

  it("leaves nothing that sends it when its progress can't be written, and asks for a new review", async () => {
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const submits = t.koios.submitted.length;
    const restore = failing(t, "set", SESSION_LOVEJOIN_SENDING + "preprod");
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("Storage failed.");
    restore();
    await nothingSendsIt(t, submits);
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("isn't ready to send");
    // A new review goes as usual.
    const again = await t.lovejoin.publicBuild("preprod", 1);
    await t.lovejoin.publicSubmit("preprod", again.txHash);
    expect(t.koios.submitted.length - submits).toBe(4);
  });
});
