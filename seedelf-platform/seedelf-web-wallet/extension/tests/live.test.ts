// Opt-in: the balance service against the real preprod Koios.
//   LIVE_KOIOS=1 npx vitest run tests/live.test.ts
// Skipped by default, so CI never depends on the network.
import { describe, expect, it } from "vitest";

import { BalanceService } from "../src/background/balances";
import { Koios } from "../src/background/koios";
import { NETWORKS } from "../src/networks";
import { loadTestWasm, testWallet, vectors } from "./fakes";

describe.skipIf(!process.env.LIVE_KOIOS)("live preprod Koios", () => {
  it("reads a public test phrase's account and scans the whole contract", async () => {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testWallet();
    await t.wallet.create(v.phrase, "correct horse battery");
    const balances = new BalanceService({
      wasm: loadTestWasm(),
      wallet: t.wallet,
      session: t.session,
      koios: () => new Koios(NETWORKS.preprod.koios),
      now: Date.now,
    });
    const started = performance.now();
    const b = await balances.get("preprod", true);
    console.log(`live preprod in ${Math.round(performance.now() - started)} ms:`, JSON.stringify(b.cardano), JSON.stringify(b.seedelf));
    expect(b.cardano.addressesUsed).toBeGreaterThanOrEqual(4);
    expect(b.cardano.utxos).toBeGreaterThan(0);
    // No phrase wallet owns contract UTxOs on preprod yet.
    expect(b.seedelf.utxos).toBe(0);
  }, 60_000);
});
