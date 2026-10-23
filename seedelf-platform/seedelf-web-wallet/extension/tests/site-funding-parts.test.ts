// A site's private session funded in parts (the owner's test of 1.6.0): its `enable()` answers only once every part has
// landed, and a funding short of one isn't given to the site at all: "if it requires y parts but y-k come in then its
// not complete and is basically equal to the one time account being not funded" (the owner, 2026-10-21). What came
// waits on the dApps page to be brought back. The 12-word phrase, the real WebAssembly, a private balance of 40 small
// UTxOs of ADA alone, and the fakes site-funding-seen.test.ts uses.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://app.example.com";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const SLOW = { timeout: 180_000 };

let pages = 0;
const site = (): DappSession => ({ id: `parts${++pages}`, origin: ORIGIN, title: "Example" });

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400 && !(await check()); i++) await new Promise((r) => setTimeout(r, 0));
  expect(await check()).toBe(true);
}

/** The connector on, and only 40 private UTxOs of 0.7 ₳: more than one transaction spends to fund 15 ₳ and its collateral. */
async function on() {
  const t = testBalances({ owned: false });
  await t.wallet.create(phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const base = ownedUtxos[0]!;
  t.koios.added.push(...Array.from({ length: 40 }, (_, i) => ({ ...base, value: "700000", tx_hash: (i + 1).toString(16).padStart(64, "0") })));
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

function privately(t: T) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const sessions = new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    alarm: { start: async () => undefined },
  });
  const dapp = new DappService({
    ...t.deps,
    store: t.store,
    sessions,
    fundingPollMs: 1,
    network: () => "preprod",
    window: t.dappWindow,
    changed: () => undefined,
  });
  return { dapp, sessions };
}

/** What transaction `id` paid session 0's account, as Koios lists it once it lands. */
function landed(t: T, id: string): KoiosUtxo[] {
  const tx = t.koios.submitted.find((b) => txIdOf(b) === id)!;
  return builtOutputs(tx).flatMap((o, i) =>
    o.address.slice(2, 58) === sessionSwap.keyHash
      ? [
          {
            ...(sessionSwap.utxo as unknown as KoiosUtxo),
            tx_hash: id,
            tx_index: i,
            value: o.lovelace.toString(),
            payment_cred: sessionSwap.keyHash,
            stake_address: null,
            block_height: 5_000_000,
            asset_list: [],
            is_spent: false,
          } as KoiosUtxo,
        ]
      : [],
  );
}

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
}

/** A site's enable(), its private session's funding built and sent in parts: the parts' hashes, and how enable() ended. */
async function enabledInParts(t: T, dapp: DappService) {
  const settled: { value?: unknown; error?: Error } = {};
  const enabling = dapp.call(site(), "enable", []).then(
    (value) => void (settled.value = value),
    (error: Error) => void (settled.error = error),
  );
  await until(() => dapp.approvals().length === 1);
  const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "15000000", []);
  expect(out.parts!.length).toBeGreaterThanOrEqual(2);
  const parts = out.parts!.map((p) => p.txHash);
  await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash });
  expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual(parts);
  return { parts, settled, enabling };
}

describe("a site's private session funded in parts (the owner's test of 1.6.0)", SLOW, () => {
  it("answers the site's enable() only once every part has landed", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { parts, settled, enabling } = await enabledInParts(t, dapp);
    // The first is at the account: still waiting.
    t.koios.addedToAccounts.push(...landed(t, parts[0]!));
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    expect(settled).toEqual({});
    // Every part in: the site has it.
    for (const p of parts.slice(1)) t.koios.addedToAccounts.push(...landed(t, p));
    await enabling;
    expect(settled.value).toBe(true);
    expect((await dapp.sites()).map((s) => s.session)).toEqual([0]);
  });

  it("short of a part that never lands, refuses the site and keeps it off the session, its money left to bring back", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const { parts, settled, enabling } = await enabledInParts(t, dapp);
    t.koios.addedToAccounts.push(...parts.slice(0, -1).flatMap((p) => landed(t, p)));
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    expect(settled).toEqual({});
    // The last never shows, twenty minutes on.
    await busy(t, 20 * 60_000 + 1);
    await enabling;
    expect(settled.error?.message).toBe("Only part of the private session's funding reached the chain.");
    expect((await dapp.sites()).filter((s) => s.session === 0)).toEqual([]);
    const [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "open", parts: { landed: parts.length - 1, total: parts.length, short: true } });
    expect(view!.holding!.utxos).toBeGreaterThan(0);
  });
});
