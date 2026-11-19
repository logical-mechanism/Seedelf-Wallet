// Chunk 51, round five's words (l4docs#1, l4still#1, l4docs#2): pins of when the wallet asks Koios what made a box,
// as the privacy policy's Lovejoin row, its Koios bullet and its 18 November entry now say it, with privacy.md's
// *Lovejoin* and architecture.md's *When it asks*. Every pool read that counts the boxes (sortOut) asks again about a
// transaction Koios hasn't answered for (`asking`), whatever its count says: the one Bring one back anyway's press
// makes too, though that press puts no box in the ask, and the one a due run makes before a retired pool's box comes
// back by itself. A box held for that answer has no due time, so a 1.9.1 deposit's answer asked about once more takes
// in the pool's other boxes no record or answer names, in the same request. The lead's calls of round five: these are
// words, so the code stays as it is, and these tests hold it to what the words say.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import type { LovejoinStatus } from "../src/shared/rpc";
import { anywayBox, anywayRequest } from "../src/ui/screens/Lovejoin";
import { CHAINS, HOUR, lovejoinOf, POOL, publicFunded, withSession, type Tested } from "./chain-fixtures";
import { preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm } from "./fakes";
import { ADA, ADA_ADDRESS, ADA_POOL, ADA_VIEW, adaBox, madeByAdaMix, ownDatum, retiredAlready } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
/** A box in the 5 ₳ pool that the wallet's Seedelf key owns, at `tx#txIndex`. */
const adaOwned = async (t: Tested, tx: string, txIndex = 0) => adaBox(hash(tx), await ownDatum(t.wallet), t.clock.now, 5, txIndex);
/** A box in Lovejoin's classic pool, retired, that the wallet's Seedelf key owns. */
async function classicOwned(t: Tested, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: hash(tx), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
const adaOf = (status: LovejoinStatus) => status.pools!.find((p) => p.id === ADA)!;
const input = (cred: string | undefined, bech32 = "addr_test1") => ({ payment_addr: cred === undefined ? { bech32 } : { bech32, cred } });
/** A mix in the 5 ₳ pool: a box spent at its mix_box, and whoever paid for it. */
const adaMix = (payer = "ee".repeat(28)) => [input(ADA_VIEW.mixBoxHash, ADA_ADDRESS), input(payer)];
/** Every tx_info request Koios was asked, the hashes each asked for. */
const txInfoAsked = (t: Tested) => t.koios.calls.filter((c) => c.path === "tx_info").map((c) => [...(c.body._tx_hashes as string[])].sort());
const asking = async (t: Tested) => (await t.store.get<{ asking?: Record<string, number> }>("lovejoin.preprod"))?.asking;
/** The boxes a withdraw giveme.my was asked about spends. */
const withdrawn = (t: Tested) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

/** Lovejoin with giveme.my's witness stood in for, as lovejoin-restore.test.ts's: its recorded answer is another transaction's. */
function witnessed(t: Tested) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
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
    pools: async () => [ADA_POOL],
  });
}

describe("chunk 51, l4docs#1 and l4still#1: the pool read before Bring one back anyway, and before a retired pool's box comes back by itself", CHAINS, () => {
  it("after a restore, Bring one back anyway takes the box Koios hasn't answered for first, and its press's pool read asks Koios about it again before it takes it", async () => {
    const { t } = await withSession("40000000");
    const [M, N] = [hash("b5"), hash("c5")];
    t.koios.addedToAccounts.push(await adaOwned(t, M), await adaOwned(t, N));
    // Koios knows a mix made M, and not yet what made N (a 429 on the public tier is enough).
    t.koios.txSpends.set(M, adaMix());
    const page = adaOf(await t.lovejoin.status("preprod"));
    expect(page.unsure).toEqual([inAda(N)]);
    expect((await asking(t))?.[N]).toBe(t.clock.now);
    // The policy: "which is the box Bring one back anyway takes first where there is one".
    expect(anywayBox(page)).toEqual(inAda(N));
    const request = anywayRequest(page)!;
    expect(request).toEqual({ box: inAda(N), anyway: true });
    await busyFor(t, 60_000);
    const before = txInfoAsked(t).length;
    await witnessed(t).withdrawNow("preprod", request.box, request.anyway);
    // Asked again at the press's own pool read, then taken as it is: the policy's "the pool read before each asks again".
    expect(txInfoAsked(t).slice(before)).toEqual([[N]]);
    expect(withdrawn(t)).toEqual([`${N}#0`]);
  });

  it("on a device that retired its pools already, a retired pool's box Koios hasn't answered for is asked about again by the run that brings it back, at its pool read, and by no lookup of its own", async () => {
    const { t } = await withSession("40000000");
    const N = hash("c6");
    t.koios.addedToAccounts.push(await classicOwned(t, N));
    await retiredAlready(t.store);
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t)) ?? {})).toEqual([N]);
    const lovejoin = witnessed(t);
    const back: string[] = [];
    for (let run = 0; run < 10 && !back.length; run++) {
      const at = txInfoAsked(t).length;
      await lovejoin.withdrawDue("preprod", run === 0);
      const asked = txInfoAsked(t).slice(at);
      back.push(...withdrawn(t));
      // A run reads the pools only at an unlock, a due time or a recheck, and each read asks again. The run that brings
      // it back asks once, at that read: no made() for a retired pool's box (isRetired), so "a box comes back by itself
      // from a retired pool without that question", but "the pool read before each asks again".
      expect([[], [[N]]]).toContainEqual(asked);
      if (back.length) expect(asked).toEqual([[N]]);
      await busyFor(t, 2 * HOUR);
    }
    expect(back).toEqual([`${N}#0`]);
  });
});

/** A UTxO's inputs, as tx_info lists them: one under `cred`. */
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
const oneTimeKey = (t: Tested, index: number) => t.wallet.withKeys((k) => k.oneTime.keyHash(index));

/**
 * A 1.9.1 wallet's record, after the update: A, a deposit the user's own session 0 made, kept as 1.9.1 kept a deposit's
 * answer (`origin`), held, with no due time; M1 and M2, boxes other people's mixes moved since, two due times, never
 * asked about, no record.
 */
async function upgraded(origin: Record<string, unknown>) {
  const t = await publicFunded();
  const lj = lovejoinOf(t, { sessionIndices: async () => [0] });
  const [A, M1, M2] = [hash("a7"), hash("d7"), hash("d8")];
  t.koios.addedToAccounts.push(await adaOwned(t, A), await adaOwned(t, M1), await adaOwned(t, M2));
  t.koios.txSpends.set(A, paidBy(await oneTimeKey(t, 0)));
  madeByAdaMix(t.koios, M1, M2);
  await t.store.set("lovejoin.preprod", {
    due: [],
    chains: [],
    notMixed: 0,
    origins: { [A]: { mixed: false, seen: t.clock.now, ...origin } },
    pools: { [ADA]: { due: [t.clock.now + 5 * HOUR, t.clock.now + 9 * HOUR], notMixed: 1 } },
  });
  return { t, lj, A, M1, M2 };
}

describe("chunk 51, l4docs#2: a 1.9.1 deposit's answer, asked about once more", CHAINS, () => {
  it("takes in the pool's other boxes no record or answer names, in the same request, as the policy's 18 November entry says", async () => {
    const { t, lj, A, M1, M2 } = await upgraded({});
    await lj.status("preprod");
    expect(txInfoAsked(t)).toEqual([[A, M1, M2].sort()]);
  });

  it("after a restore, while a box is held for Koios's answer, a later pool read asks about it together with a box someone else's mix moved since, as privacy.md says", async () => {
    const t = await publicFunded();
    const lj = lovejoinOf(t, { sessionIndices: async () => [0] });
    const [F, U, M3] = [hash("f4"), hash("e4"), hash("d4")];
    const f = await adaOwned(t, F);
    t.koios.addedToAccounts.push(f, await adaOwned(t, U));
    // Koios knows a mix made F, and not yet what made U: U is held, with no due time.
    madeByAdaMix(t.koios, F);
    await lj.status("preprod");
    expect(Object.keys((await asking(t)) ?? {})).toEqual([U]);
    const first = txInfoAsked(t).length;
    // Someone else's mix moves F: M3 has no record, and F's due time stays.
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(f), 1);
    t.koios.addedToAccounts.push(await adaOwned(t, M3));
    madeByAdaMix(t.koios, M3);
    await lj.status("preprod");
    expect(txInfoAsked(t).slice(first)).toEqual([[M3, U].sort()]);
  });

  it("control: with that answer kept as this version keeps it (its inputs, judged against the first 24), the pool read asks Koios nothing", async () => {
    const t0 = await publicFunded();
    const key = await oneTimeKey(t0, 0);
    const { t, lj } = await upgraded({ inputs: [{ cred: key }], judged: Array.from({ length: 24 }, (_, i) => i) });
    await lj.status("preprod");
    expect(txInfoAsked(t)).toEqual([]);
  });
});
