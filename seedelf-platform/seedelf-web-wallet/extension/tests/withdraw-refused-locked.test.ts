// A Lovejoin withdraw that never went while the wallet locked: Koios refused
// it, or turned it away (a 429), or the lock came before it was sent at all.
// Its sealed record couldn't be dropped then, so the worker remembers it
// never went, and the next look drops it: its box is free again, and its due
// time is back, drawn afresh into the unlock, never sent again as one that
// may have gone. A worker that stopped meanwhile forgot that: the record is
// looked for and sent again under a new withdraw's rules, as before, and
// leaves no second due time behind once it's seen (final review F5).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, UNLOCK_WAIT_MS } from "../src/background/lovejoin";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { spentSet } from "../src/background/spent";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, madeByMix, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const SLOW = { timeout: 30_000 };
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

interface Kept {
  due: number[];
  withdrawing?: { txHash: string; due?: number; waitUntil?: number };
}
const kept = async (t: T) => (await t.store.get<Kept>("lovejoin.preprod"))!;

async function ownedBox(t: T, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  // Someone else's mix moved it: Koios says so, as the wallet asks before it takes a box no record accounts for (M14).
  madeByMix(t.koios, tx.repeat(32));
  return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/**
 * An unlocked wallet, unlocked an hour ago with its unlock's draws made, one
 * box of its own in Lovejoin's pool, due an hour ago; and a Lovejoin
 * (`service()`, one per worker) with giveme.my's witness stood in for.
 */
async function due() {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.addedToAccounts.push(...POOL, await ownedBox(t, "e1"));
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  const time = t.clock.now - HOUR;
  await t.store.set("lovejoin.preprod", { due: [time], unlock: unlocked });
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const service = () =>
    new LovejoinService({
      ...t.deps,
      wasm: {
        ...wasm,
        finishLovejoinWithdraw: (request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
    });
  return { t, lovejoin: service(), service, box: `${"e1".repeat(32)}#0`, time };
}

/** Koios answers every submit with `answer`, the wallet locking while it's asked. */
function lockingSubmit(t: T, answer: () => Response) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    t.koios.submitted.push(new Uint8Array(init!.body as Uint8Array));
    await t.wallet.lock();
    return answer();
  };
  return () => {
    t.koios.fetch = real;
  };
}

const sentOf = (t: T, txHash: string) => t.koios.submitted.filter((b) => txIdOf(b) === txHash).length;

describe("a withdraw that never went while the wallet locked (final review F5)", SLOW, () => {
  for (const [what, answer] of [
    ["refused", () => new Response("ConwayUtxowFailure (UtxoFailure (ScriptFailures))", { status: 400 })],
    ["turned away (429)", () => new Response("", { status: 429 })],
  ] as const) {
    it(`${what}: its record goes at the next look, its box is free, and its due time is back, drawn into the unlock`, async () => {
      const { t, lovejoin, box } = await due();
      const undo = lockingSubmit(t, answer);
      expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
      undo();
      const refused = txIdOf(t.koios.submitted.at(-1)!);
      // Sealed as it was when the lock came: the wallet couldn't drop it then.
      expect(t.local.data.has(`${PRIVATE_PREFIX}lovejoin.preprod`)).toBe(true);
      t.clock.now += 10 * 60_000;
      await t.wallet.unlock(PASSWORD);
      expect((await kept(t)).withdrawing?.txHash).toBe(refused);
      expect((await kept(t)).due).toEqual([]);
      const unlocked = t.clock.now;
      const looks = () => t.koios.calls.filter((c) => c.path === "tx_status").length;
      const before = looks();
      // The unlock's run drops it before it looks: no tx_status for it, and it's never sent again.
      await lovejoin.withdrawDue("preprod", true, t.clock.now);
      expect((await kept(t)).withdrawing).toBeUndefined();
      expect(looks()).toBe(before);
      const [drawn] = (await kept(t)).due;
      expect((await kept(t)).due).toHaveLength(1);
      expect(drawn).toBeGreaterThanOrEqual(unlocked + UNLOCK_WAIT_MS[0]);
      expect(await t.wallet.withKeys(() => spentSet(t.session, t.clock.now))).not.toContain(box);
      // "Bring back now" isn't told Koios didn't answer, and at its draw the box goes back in a new withdraw.
      await busyFor(t, drawn! - t.clock.now);
      const [pending] = await lovejoin.withdrawDue("preprod", false, t.clock.now);
      expect(pending).toBeDefined();
      expect(t.collateral.asked).toHaveLength(2);
      expect(sentOf(t, refused)).toBe(1);
      expect((await kept(t)).due).toEqual([]);
    });
  }

  it("never sent, the lock coming just after it was kept: dropped at the next look the same way", async () => {
    const { t, lovejoin } = await due();
    // The lock comes right after the withdraw is sealed, before what it spends is held and it's sent.
    const set = t.local.set.bind(t.local);
    let sealing = true;
    t.local.set = async (key: string, value: unknown) => {
      await set(key, value);
      if (sealing && key === `${PRIVATE_PREFIX}lovejoin.preprod` && (await kept(t)).withdrawing) {
        sealing = false;
        await t.wallet.lock();
      }
    };
    const submits = t.koios.submitted.length;
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    t.local.set = set;
    expect(t.koios.submitted).toHaveLength(submits);
    await t.wallet.unlock(PASSWORD);
    expect((await kept(t)).withdrawing).toBeDefined();
    await lovejoin.withdrawNow("preprod").catch(() => undefined);
    expect((await kept(t)).withdrawing).toBeUndefined();
    // The user's ask sent a new withdraw at once, not the one that never went.
    expect(t.collateral.asked).toHaveLength(2);
  });

  it("forgotten by a worker that stopped meanwhile, is looked for and sent again under a new withdraw's rules, and leaves no second due time", async () => {
    const { t, lovejoin, service } = await due();
    const undo = lockingSubmit(t, () => new Response("", { status: 429 }));
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    undo();
    const turnedAway = txIdOf(t.koios.submitted.at(-1)!);
    // Chrome stopped the worker while the wallet was locked: a new one knows nothing of it.
    const again = service();
    t.clock.now += HOUR;
    await t.wallet.unlock(PASSWORD);
    await again.withdrawDue("preprod", true, t.clock.now);
    const { waitUntil } = (await kept(t)).withdrawing!;
    expect(waitUntil).toBeDefined();
    expect((await kept(t)).due).toEqual([]);
    // At its draw it goes, its first real send; seen, it's in the history, and no due time is left over.
    await busyFor(t, waitUntil! - t.clock.now);
    await again.withdrawDue("preprod", false, t.clock.now);
    expect(sentOf(t, turnedAway)).toBe(2);
    t.koios.confirmations = 1;
    await busyFor(t, 60_000);
    await again.withdrawDue("preprod", false, t.clock.now);
    expect((await kept(t)).withdrawing).toBeUndefined();
    expect((await kept(t)).due).toEqual([]);
    expect(t.collateral.asked).toHaveLength(1);
  });
});
