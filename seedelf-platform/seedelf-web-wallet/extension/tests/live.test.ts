// Opt-in: the balance service and the ADA Handle lookup against the real preprod Koios.
//   LIVE_KOIOS=1 npx vitest run tests/live.test.ts
// Skipped by default, so CI never depends on the network.
import { describe, expect, it } from "vitest";

import { BalanceService } from "../src/background/balances";
import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { ADA_HANDLE_POLICY, WithdrawService } from "../src/background/withdraw";
import { NETWORKS } from "../src/networks";
import { loadTestWasm, testWallet, vectors } from "./fakes";

describe.skipIf(!process.env.LIVE_KOIOS)("live preprod Koios", () => {
  it("reads a public test phrase's account and scans the whole contract", async () => {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testWallet();
    await t.wallet.create(v.phrase, "correct horse battery");
    const urls: string[] = [];
    const balances = new BalanceService({
      wasm: loadTestWasm(),
      wallet: t.wallet,
      session: t.session,
      koios: () => new Koios(NETWORKS.preprod.koios, (url, init) => (urls.push(url), fetch(url, init))),
      now: Date.now,
    });
    const started = performance.now();
    const b = await balances.get("preprod", true);
    console.log(`live preprod in ${Math.round(performance.now() - started)} ms:`, JSON.stringify(b.cardano), JSON.stringify(b.seedelf));
    expect(b.cardano.addressesUsed).toBeGreaterThanOrEqual(4);
    expect(b.cardano.utxos).toBeGreaterThan(0);
    // Since 2026-09-24 this public phrase owns real contract UTxOs: the first
    // live move-in and seedelf mint. Anyone can spend them, so check their
    // shape, not how many there are.
    expect(b.seedelf.seedelfs.every((s) => s.assetName.startsWith("5eed0e1f"))).toBe(true);
    expect(BigInt(b.seedelf.lovelace)).toBeGreaterThanOrEqual(0n);

    // The next reading asks only for UTxOs newer than the last block seen, and agrees.
    const again = await balances.get("preprod", true);
    const scans = urls.filter((u) => u.includes("/credential_utxos"));
    expect(scans).toHaveLength(2);
    expect(scans[1]).toMatch(/block_height=gt\.\d+/);
    expect(again.seedelf).toEqual(b.seedelf);
  }, 60_000);

  it("finds real ADA Handles, a plain one and a CIP-68 one", async () => {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testWallet();
    await t.wallet.create(v.phrase, "correct horse battery");
    const koios = new Koios(NETWORKS.preprod.koios);
    const withdraw = new WithdrawService({
      wasm: loadTestWasm(),
      wallet: t.wallet,
      session: t.session,
      koios: () => koios,
      collateral: () => new Collateral(NETWORKS.preprod.collateral),
      now: Date.now,
    });
    // Both held by key addresses on 2026-09-24. Whoever holds them now is who they pay.
    for (const [handle, assetName] of [
      ["buzzkill", Buffer.from("buzzkill").toString("hex")],
      ["-2", `000de140${Buffer.from("-2").toString("hex")}`],
    ] as const) {
      const holder = await koios.assetNftAddress(ADA_HANDLE_POLICY, assetName);
      expect(holder, `$${handle}`).toMatch(/^addr_test1/);
      expect(await withdraw.resolve("preprod", `$${handle.toUpperCase()}`)).toEqual({ address: holder, handle, own: false });
    }
  }, 60_000);
});
