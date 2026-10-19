// Lovejoin's token pools through the built WebAssembly package (run ../build.sh first):
//   node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"
// Lovejoin's own preprod token pool, as Koios lists it, is verified from the bundled templates; a request
// names a pool beside its own fields (`poolRef`), and one without is the classic pool's, as ever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SeedelfKey,
  lovejoinBoxValue,
  lovejoinCandidate,
  lovejoinLaunchCheck,
  lovejoinOwned,
  lovejoinUsable,
  lovejoinVerifyPool,
} from "./wasm.mjs";

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

const MIX_BOX = "b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4";
const MIX_LOGIC = "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953";

/** A row at the holder carrying the script of `hash` as a reference script, its bytes named or not. */
const atHolder = (index, hash, bytes = null) => ({
  ...found.reference,
  tx_hash: "ee".repeat(32),
  tx_index: index,
  value: "3620000",
  inline_datum: null,
  datum_hash: null,
  asset_list: [],
  reference_script: { hash, size: null, type: "plutusV3", bytes },
});

test("a candidate's cheap checks say what it claims to be, before anything is asked", () => {
  const view = JSON.parse(lovejoinCandidate(JSON.stringify({ network: "preprod", reference: found.reference })));
  assert.deepEqual(view, {
    id: "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69",
    boxLovelace: "2000000",
    token: { policyId: "02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa", assetName: Buffer.from("LJTEST").toString("hex"), quantity: "10000000000000000" },
    mixBoxHash: MIX_BOX,
    mixLogicHash: MIX_LOGIC,
  });
  assert.throws(() => lovejoinCandidate(JSON.stringify({ network: "mainnet", reference: found.reference })), /holder/);
  const noNft = { ...found.reference, asset_list: [] };
  assert.throws(() => lovejoinCandidate(JSON.stringify({ network: "preprod", reference: noNft })), /NFT/);
});

test("a launch is checked from its transaction: its seed among the inputs, its scripts at the holder", () => {
  const other = { txHash: "00".repeat(32), txIndex: 0 };
  const check = (inputs, scripts) =>
    JSON.parse(lovejoinLaunchCheck(JSON.stringify({ network: "preprod", reference: found.reference, inputs, scripts })));
  // Lovejoin's own launch: genuine, but its scripts went to a key address, so a standard launch it isn't.
  const own = check([other, found.seed], found.scripts);
  assert.deepEqual([own.pool.id, own.pool.scriptsInline], ["c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69", 2]);
  assert.deepEqual(own.pool.seed, found.seed);
  assert.match(own.mixLogicStake, /^stake_test1/);
  // The same pool had its launch put both at the holder: read by reference.
  const atTheHolder = check([found.seed], [atHolder(1, MIX_BOX), atHolder(2, MIX_LOGIC)]);
  assert.equal(atTheHolder.pool.scriptsInline, 0);
  assert.equal(atTheHolder.mixLogicStake, own.mixLogicStake);
  assert.throws(() => check([other], found.scripts), /inputs/);
});

test("a script at the holder named by its hash alone is read with the bytes derived here", () => {
  const verify = (scripts) =>
    JSON.parse(lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: { ...poolRef, scripts } })));
  const bytes = Object.fromEntries(found.scripts.map((s) => [s.reference_script.hash, s.reference_script.bytes]));
  const named = verify([atHolder(1, MIX_BOX), atHolder(2, MIX_LOGIC)]);
  const whole = verify([atHolder(1, MIX_BOX, bytes[MIX_BOX]), atHolder(2, MIX_LOGIC, bytes[MIX_LOGIC])]);
  assert.equal(named.scriptsInline, 0);
  assert.deepEqual(named, whole);
  // A hash that isn't one of the pool's, or bytes that aren't the script's, read as no reference at all.
  assert.equal(verify([atHolder(1, "11".repeat(28)), atHolder(2, MIX_LOGIC)]).scriptsInline, 1);
  assert.equal(verify([atHolder(1, MIX_BOX, bytes[MIX_LOGIC]), atHolder(2, MIX_LOGIC)]).scriptsInline, 1);
});

test("a box of one token has a value, and none of it is refused in words, the module whole (1.6.0's release review, MONEY-2)", () => {
  // The launch form asks as the creator types: "1" trapped, which locked the wallet.
  const token = { policyId: "1a".repeat(28), assetName: Buffer.from("SNEK").toString("hex") };
  const of = (quantity) => JSON.parse(lovejoinBoxValue(JSON.stringify({ network: "mainnet", params, token: { ...token, quantity } })));
  assert.deepEqual(of("1"), { least: "3620000", suggested: "4000000", most: "9000000" });
  assert.throws(() => of("0"), /at least one of its token/);
  assert.equal(of("2").most, "9000000");
});
