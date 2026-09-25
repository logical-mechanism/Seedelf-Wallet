// Lovejoin in the worker (lovejoin.ts, and sessions.ts's return through it),
// with the real WebAssembly module, a recorded preprod pool, and fake Koios
// and giveme.my. Every chain is measured against the deployed scripts inside
// WebAssembly, as it is in the wallet.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LOVEJOIN_MIX_BOX } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: [],
  } as KoiosUtxo;
}

/** An unlocked wallet with a site's private session 0 holding `lovelace` and its 5 ₳ collateral, and Lovejoin's pool. */
async function withSession(lovelace: string) {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, lovelace), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
  const sessions = new SessionService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: t.lovejoin,
    sleep: async () => undefined,
  });
  return { t, sessions };
}

describe("a session's return through Lovejoin", () => {
  it("sends the spare ADA through the mixer first, the whole chain in order, then sets the boxes' withdraws", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // 40 ₳ spare pays for two boxes at depth 2: four mixes each.
    expect(review.lovejoin).toMatchObject({ boxes: 2, depth: 2, mixes: 8, txs: 10, delay: "1-6" });
    // One pool read for the chain.
    expect(t.koios.calls.filter((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === LOVEJOIN_MIX_BOX.preprod)).toHaveLength(1);

    const submittedBefore = t.koios.submitted.length;
    const sent = await sessions.backSubmit("preprod", review.txHash);
    expect(sent).toMatchObject({ kind: "session-back", txHash: review.txHash });
    const chain = t.koios.submitted.slice(submittedBefore);
    expect(chain).toHaveLength(10);
    expect(txIdOf(chain.at(-1)!)).toBe(review.txHash);

    // The session's record knows every one, in order: the deposit, the mixes, the return.
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string; txHash: string }> }> }>("sessions.preprod"))!;
    const kinds = book.sessions[0]!.txs.slice(1).map((x) => x.kind);
    expect(kinds).toEqual(["deposit", ...Array(8).fill("mix"), "back"]);
    expect(book.sessions[0]!.txs.slice(1).map((x) => x.txHash)).toEqual(chain.map((bytes) => txIdOf(bytes)));

    // Each box comes back on its own, 1 to 6 hours from now.
    const schedule = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!;
    expect(schedule.due).toHaveLength(2);
    for (const due of schedule.due) {
      expect(due).toBeGreaterThanOrEqual(t.clock.now + HOUR);
      expect(due).toBeLessThanOrEqual(t.clock.now + 6 * HOUR);
    }
  });

  it("comes back directly when asked, or when the spare ADA doesn't pay for a box", async () => {
    const { t, sessions } = await withSession("40000000");
    const direct = await sessions.backBuild("preprod", 0, true);
    expect(direct.lovejoin).toBeUndefined();
    expect(direct.inputs).toBe(2);

    const small = await withSession("8000000");
    const plain = await small.sessions.backBuild("preprod", 0);
    expect(plain.lovejoin).toBeUndefined();
    // No pool read: the plan said no box before anything was fetched.
    expect(small.t.koios.calls.some((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === LOVEJOIN_MIX_BOX.preprod)).toBe(false);
    void t;
  });
});

describe("the boxes' withdraws", () => {
  /** A box of ours in the pool: a fresh re-randomization of the Seedelf key's register. */
  async function ownedBox(t: Awaited<ReturnType<typeof withSession>>["t"], tx: string): Promise<KoiosUtxo> {
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
    return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
  }

  it("finds ours in the pool, wherever mixes moved them", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d1"));
    const status = await t.lovejoin.status("preprod");
    expect(status).toMatchObject({ available: true, lovelace: "10000000", boxes: [{ txHash: "d1".repeat(32), txIndex: 0 }] });
  });

  it("withdraws a due box through giveme.my, and keeps it due when that fails", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d2"));
    // Nothing due yet: no pool read.
    await t.lovejoin.schedule("preprod", 1);
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);

    // Due: the withdraw is built, measured and handed to giveme.my, whose
    // recorded answer is another transaction's, so it isn't sent.
    // Hours later the wallet locked itself; the withdraw runs at the next unlock.
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toHaveLength(1);
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(1);
  });

  it("reads the pool at unlock only on a wallet that has used Lovejoin here", async () => {
    const { t } = await withSession("40000000");
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);
  });

  it("gives a box found with no due time one (a restore), when the tile opens", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d3"), await ownedBox(t, "d4"));
    expect((await t.lovejoin.status("preprod")).boxes).toHaveLength(2);
    const due = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due;
    expect(due).toHaveLength(2);
    expect(Math.min(...due)).toBeGreaterThanOrEqual(t.clock.now + HOUR);
  });
});
