// Chunk 51, round three's last look, l3rank#3: a private session's funding or top-up, and a Send, that one box pays
// ranked a box a mix moved level with a box of unknown making (core's Purpose::Fund and Purpose::Pay), and took the
// smaller. So a few hundred lovelace of withdraw fee decided whether they spent the way back of a box Mallory put in
// under Seedelf S1's register as found (d = 1), which ties the spend to S1 for anyone who reads its name, or a mixed
// box's, which ties it to nothing. They take the box the wallet knows is mixed first now, whatever the sizes.
//
// Driven end to end through the worker's services with the real WebAssembly: X, a box a mix moved, comes back by
// itself; W, Mallory's box, comes back through Bring every box back now; both land, 300 lovelace apart, each way round.
// The WebAssembly must be rebuilt with core's ranks for this file to pass.
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { SESSION_TOP_UP } from "../src/background/sessions";
import { SESSION_TRANSFER } from "../src/background/transfer";
import { historyTags, type HistoryClass } from "../src/shared/histories";
import { CHAINS, HOUR, withSession, type Tested } from "./chain-fixtures";
import { preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, transferPreprod } from "./fakes";
import { ADA, ADA_POOL, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const inputsOf = (cbor: string) => txInputs(Uint8Array.from(Buffer.from(cbor, "hex")));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
const unplaced = (w: string): HistoryClass => ({ id: `box:${w}+unknown:${w}`, origin: "lovejoin" });
const mixed = (w: string): HistoryClass => ({ id: `box:${w}`, origin: "mixed" });
type Entry = { txHash: string; kind: string; lovelace: string; origin?: HistoryClass };
const entryOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Entry[] }>("history.preprod"))!.entries.find((e) => e.txHash === txHash);

/** A UTxO of the wallet's at the Seedelf contract, `txHash#index`, under a fresh re-randomization of its register. */
async function privateRow(t: Tested, txHash: string, lovelace: string, index = 0): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const bytes = await t.wallet.withKeys((keys) =>
    Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"),
  );
  return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: index, value: lovelace, asset_list: [], inline_datum: { bytes, value: null }, block_height: 9_000_001 };
}

/** Lovejoin on `t`'s fakes, reading the 5 ₳ pool, giveme.my's witness stood in for. */
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
    sessionIndices: async () => [0],
  });
}

/** X and W, both landed in the private balance, the way back of unknown making `wSmaller` or the mixed one smaller. */
async function wAndX(wSmaller: boolean) {
  const { t, sessions } = await withSession("40000000");
  await t.balances.get("preprod");
  // X: a done chain's leaf, which other people's mixes moved to X#0, due now. Koios says a mix made it.
  const X = hash("f5");
  const [D, M, R] = [hash("a1"), hash("a2"), hash("a3")];
  const at = t.clock.now - 30 * HOUR;
  const done = {
    id: R,
    session: 1,
    progress: "seedelf.lovejoin.test",
    deposit: D,
    mixes: [M],
    leaves: [inAda(M, 0)],
    boxes: 1,
    pools: { [ADA]: 1 },
    total: 3,
    sent: 3,
    done: true,
    at,
    scheduled: true,
    ended: at,
    found: true,
    landed: true,
  };
  t.koios.addedToAccounts.push(adaBox(X, await ownDatum(t.wallet), t.clock.now, 7));
  madeByAdaMix(t.koios, X);
  await t.store.set("lovejoin.preprod", {
    due: [],
    chains: [done],
    pools: { [ADA]: { due: [t.clock.now - 60_000] } },
    unlock: await t.wallet.unlockedAt(),
  });
  const lj = witnessed(t);
  await lj.status("preprod");
  const xSent = await lj.withdrawDue("preprod");
  expect(xSent).toHaveLength(1);
  const xBack = xSent[0]!.txHash;
  expect((await entryOf(t, xBack))?.origin, "X's way back").toEqual(mixed(xBack));
  // W: Mallory's 5 ₳ box under S1's register as found (d = 1), brought back by Bring every box back now.
  const s1 = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
  const C = hash("c9");
  t.koios.addedToAccounts.push(adaBox(C, s1.inline_datum!.bytes, t.clock.now));
  t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
  const pool = (await lj.status("preprod")).pools!.find((p) => p.id === ADA)!;
  expect((pool.someoneElse ?? []).map(ref)).toEqual([ref(inAda(C))]);
  await lj.bringAllBack("preprod");
  const wSent = await lj.withdrawDue("preprod");
  expect(wSent.map((p) => p.txHash).filter((h) => h !== xBack)).toHaveLength(1);
  const wBack = wSent.find((p) => p.txHash !== xBack)!.txHash;
  expect((await entryOf(t, wBack))?.origin, "W's way back").toEqual(unplaced(wBack));
  const withdraw = t.koios.submitted.find((bytes) => txIdOf(bytes) === wBack)!;
  expect(txInputs(withdraw)).toContain(`${C}#0`);
  // Both land, about 4.7 ₳ each, 300 lovelace apart.
  const [small, large] = ["4700000", "4700300"];
  const w = await privateRow(t, wBack, wSmaller ? small : large);
  const x = await privateRow(t, xBack, wSmaller ? large : small);
  t.koios.added.push(w, x);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  const classes = await t.activity.classes("preprod", [w, x]);
  expect(historyTags(classes.get(`${wBack}#0`)!)).toEqual(["Back from Lovejoin", "Unknown"]);
  expect(classes.get(`${xBack}#0`)).toEqual(mixed(xBack));
  return { t, sessions, w: `${wBack}#0`, x: `${xBack}#0` };
}

const which = (spent: string[], w: string, x: string) =>
  spent.includes(w) && !spent.includes(x) ? "W" : spent.includes(x) && !spent.includes(w) ? "X" : JSON.stringify(spent);

describe("a top-up and a Send that one box pays take a box a mix moved before one of unknown making (chunk 51, l3rank#3)", () => {
  it("a site's top-up of 2 ₳", CHAINS, async () => {
    const picks: string[] = [];
    for (const wSmaller of [true, false]) {
      const { t, sessions, w, x } = await wAndX(wSmaller);
      await sessions.topUpBuild("preprod", 0, "2000000", []);
      const spent = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_TOP_UP))!.txCbor);
      picks.push(`${wSmaller ? "W smaller" : "X smaller"}: spent ${which(spent, w, x)}`);
    }
    expect(picks).toEqual(["W smaller: spent X", "X smaller: spent X"]);
  });

  it("a Send of 2 ₳, the private balance's other rows locked, as one holding only boxes", CHAINS, async () => {
    const picks: string[] = [];
    for (const wSmaller of [true, false]) {
      const { t, w, x } = await wAndX(wSmaller);
      const payable = ownedUtxos.filter((u) => !(u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId));
      for (const u of payable) await t.coins.setLocked("preprod", "seedelf", `${u.tx_hash}#${u.tx_index}`, true);
      await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: "2000000", tokens: [] }]);
      const spent = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_TRANSFER))!.txCbor);
      picks.push(`${wSmaller ? "W smaller" : "X smaller"}: spent ${which(spent, w, x)}`);
    }
    expect(picks).toEqual(["W smaller: spent X", "X smaller: spent X"]);
  });
});
