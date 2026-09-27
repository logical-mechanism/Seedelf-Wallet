// Every transaction built from the public account stops being valid two hours
// after it's built (launch review #28): a move-in, a send, the collateral
// payment, a staking transaction and an account-paid mint. Past that slot, one
// that never landed can't land any more, so paying again can't pay twice.
// Seedelf spends, which giveme.my co-signs, don't carry one yet. Two hours by
// the chain's clock, from its tip, whatever this device's clock says (final
// review money-submit-5).
import { describe, expect, it } from "vitest";

import { VALID_FOR_MS } from "../src/background/account";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_BUILT } from "../src/background/move-in";
import { SESSION_COLLATERAL, SESSION_SEND } from "../src/background/send";
import { SESSION_STAKE } from "../src/background/staking";
import { ttlOf, txIdOf } from "./fixtures/cbor";
import { accountMintPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
const TWO_HOURS = 2 * 60 * 60_000;

/** Preprod's slot at `ms`: slot 86,400 began 2022-06-21 00:00 UTC, and each lasts a second. */
const preprodSlot = (ms: number) => 86_400 + Math.floor((ms - 1_655_769_600_000) / 1000);
/** Two hours of slots. */
const TWO_HOURS_OF_SLOTS = 2 * 60 * 60;

/** An unlocked wallet on a device whose clock is `off` ms ahead of the chain's (behind, below zero). */
async function unlocked(off = 0) {
  const t = testBalances();
  t.koios.tip = preprodSlot(t.clock.now);
  t.clock.now += off;
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type T = Awaited<ReturnType<typeof unlocked>>;

/** The slot the transaction kept under `key` stops being valid at, after checking it's the one summarized. */
async function keptUntil(t: T, key: string): Promise<number | undefined> {
  const built = (await t.session.get<{ txCbor: string; txHash: string }>(key))!;
  const bytes = Uint8Array.from(Buffer.from(built.txCbor, "hex"));
  expect(txIdOf(bytes)).toBe(built.txHash);
  return ttlOf(bytes);
}

describe("the public account's transactions", () => {
  it("stop being valid two hours after they're built", async () => {
    expect(VALID_FOR_MS).toBe(TWO_HOURS);
    const t = await unlocked();
    const slot = preprodSlot(t.clock.now + TWO_HOURS);
    expect(slot).toBe(t.koios.tip + TWO_HOURS_OF_SLOTS);

    await t.moveIn.build("preprod", "5000000", []);
    expect(await keptUntil(t, SESSION_BUILT)).toBe(slot);
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }], "lunch");
    expect(await keptUntil(t, SESSION_SEND)).toBe(slot);
    await t.send.buildCollateral("preprod");
    expect(await keptUntil(t, SESSION_COLLATERAL)).toBe(slot);
    await t.staking.build("preprod", { kind: "withdraw" });
    expect(await keptUntil(t, SESSION_STAKE)).toBe(slot);

    t.koios.evaluation = accountMintPreprod.evaluation;
    await t.mint.build("preprod", "", "account");
    expect(await keptUntil(t, SESSION_MINT)).toBe(slot);
    // Ogmios measured a draft that holds the same slot.
    const [draft] = t.koios.calls.filter((c) => c.path === "ogmios");
    expect(ttlOf(Uint8Array.from(Buffer.from(draft!.body.params.transaction.cbor, "hex")))).toBe(slot);
  });

  it("count the two hours from when each is built", async () => {
    const t = await unlocked();
    t.clock.now += 10 * 60_000;
    t.koios.tip += 10 * 60;
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    expect(await keptUntil(t, SESSION_SEND)).toBe(preprodSlot(t.clock.now + TWO_HOURS));
  });

  it("count them by the chain's clock, however far off this device's is", async () => {
    for (const off of [6 * 60 * 60_000, -3 * 60 * 60_000]) {
      const t = await unlocked(off);
      const tip = t.koios.tip;
      await t.moveIn.build("preprod", "5000000", []);
      expect(await keptUntil(t, SESSION_BUILT)).toBe(tip + TWO_HOURS_OF_SLOTS);
      await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
      expect(await keptUntil(t, SESSION_SEND)).toBe(tip + TWO_HOURS_OF_SLOTS);
      await t.staking.build("preprod", { kind: "withdraw" });
      expect(await keptUntil(t, SESSION_STAKE)).toBe(tip + TWO_HOURS_OF_SLOTS);
      t.koios.evaluation = accountMintPreprod.evaluation;
      await t.mint.build("preprod", "", "account");
      expect(await keptUntil(t, SESSION_MINT)).toBe(tip + TWO_HOURS_OF_SLOTS);
    }
  });

  it("leave a Seedelf spend, which giveme.my co-signs, as it was", async () => {
    const t = await unlocked();
    await t.mint.build("preprod", "", "seedelf");
    expect(await keptUntil(t, SESSION_MINT)).toBeUndefined();
  });
});
