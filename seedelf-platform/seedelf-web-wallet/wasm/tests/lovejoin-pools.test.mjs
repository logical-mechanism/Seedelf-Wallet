// Lovejoin's token pools through the built WebAssembly package (run ../build.sh first):
//   node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"
// Lovejoin's own preprod token pool, as Koios lists it, is verified from the bundled templates; a request
// names a pool beside its own fields (`poolRef`), and one without is the classic pool's, as ever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SeedelfKey, lovejoinOwned, lovejoinUsable, lovejoinVerifyPool } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const found = json("./fixtures/lovejoin-token-pool-preprod.json");
const classicPool = json("../../extension/tests/fixtures/lovejoin-pool-preprod.json").pool;
const poolRef = { reference: found.reference, seed: found.seed, scripts: found.scripts };

test("Lovejoin's preprod token pool, as Koios lists it, is verified", () => {
  const view = JSON.parse(lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: poolRef })));
  assert.equal(view.id, "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69");
  assert.equal(view.version, "tokenV1");
  assert.equal(view.boxLovelace, "2000000");
  assert.deepEqual(view.token, {
    policyId: "02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa",
    assetName: Buffer.from("LJTEST").toString("hex"),
    quantity: "10000000000000000",
  });
  assert.equal(view.mixLogicHash, "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953");
  // Its scripts sit at a key address, which its key could spend: carried, never read from there.
  assert.equal(view.scriptsInline, 2);
  assert.deepEqual(view.reference, { txHash: found.reference.tx_hash, txIndex: 0 });
});

test("a pool named with another seed isn't trusted, and the module stays whole", () => {
  const wrong = { ...poolRef, seed: { ...found.seed, txIndex: 0 } };
  assert.throws(() => lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: wrong })), /seed/);
  assert.throws(() => lovejoinVerifyPool(JSON.stringify({ network: "mainnet", pool: poolRef })), /holder/);
  assert.equal(JSON.parse(lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: poolRef }))).version, "tokenV1");
});

test("whether a pool can take a mix, and why not", () => {
  const usable = (poolRef, registered) =>
    JSON.parse(lovejoinUsable(JSON.stringify({ network: "preprod", params, poolRef, registered })));
  assert.equal(usable(undefined, true).usable, true);
  const token = usable(poolRef, true);
  assert.equal(token.usable, true);
  assert.equal(BigInt(token.back) + BigInt(token.withdrawFee), 2_000_000n);
  assert.deepEqual([usable(poolRef, false).usable, usable(poolRef, false).why], [false, "notRegistered"]);
});

test("the classic pool's rows read as ever, with or without a token pool named beside them", () => {
  const key = SeedelfKey.fromHex("01".repeat(32));
  const classic = JSON.parse(lovejoinOwned(key, JSON.stringify({ network: "preprod", pool: classicPool })));
  assert.equal(classic.token, undefined);
  assert.ok(classic.others > 0);
  // Named as the token pool's rows, the classic boxes aren't its boxes.
  const asToken = JSON.parse(lovejoinOwned(key, JSON.stringify({ network: "preprod", pool: classicPool, poolRef })));
  assert.deepEqual([asToken.boxes, asToken.others, asToken.token.quantity], [[], 0, "0"]);
  key.free();
});

test("a stranger's deep datum at the holder, named as a pool, is refused and leaves the module whole", () => {
  const LEVELS = 100_000;
  const deepDatum = `{"bytes":"${"81".repeat(LEVELS)}00","value":${'{"list":['.repeat(LEVELS)}{"int":0}${"]}".repeat(LEVELS)}}`;
  const text = JSON.stringify({ network: "preprod", pool: { ...poolRef, reference: { ...found.reference, inline_datum: "DATUM" } } });
  assert.throws(() => lovejoinVerifyPool(text.replace('"DATUM"', deepDatum)));
  assert.equal(JSON.parse(lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: poolRef }))).version, "tokenV1");
});
