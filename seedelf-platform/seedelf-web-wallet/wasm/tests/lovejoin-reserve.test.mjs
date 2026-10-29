// The collateral's mix reserves through the built WebAssembly package (run ../build.sh first):
//   node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"
// A session's funding adds one for its 5 ₳ collateral to be mixed on its way into a 5 ₳ pool: the chain's, fixed, where
// something else pays for the sweep after it; and, where its return may come back directly with nothing else left, what
// that takes, priced from the parameters (1.6.0's release review, 323-rust#1). A private Bootstrap's adds its way back's,
// priced too (1.7.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { lovejoinBootstrapReserve, lovejoinCollateralReserve, lovejoinDirectCollateralReserve } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];

test("a direct return's collateral reserve is priced from the parameters (1.6.0's release review, 323-rust#1)", () => {
  assert.equal(lovejoinCollateralReserve(), "1500000");
  // 4,310 lovelace a byte: the deposit, the mix, the sweep's first draft and its Seedelf output's least, rounded up.
  assert.equal(lovejoinDirectCollateralReserve(JSON.stringify(params)), "2800000");
  // A dearer byte raises the leasts with it.
  assert.equal(lovejoinDirectCollateralReserve(JSON.stringify({ ...params, coins_per_utxo_size: "6465" })), "3600000");
  // Parameters it can't read are refused, never guessed.
  assert.throws(() => lovejoinDirectCollateralReserve("{}"));
});

test("a private Bootstrap's way back is priced from the parameters (1.7.0's release review, x-mut-rs#3)", () => {
  // 4,310 lovelace a byte: its least, 1.5 ₳ (core's BOOTSTRAP_BACK_RESERVE).
  assert.equal(lovejoinBootstrapReserve(JSON.stringify(params)), "1500000");
  // A dearer byte raises the sweep's Seedelf output's least with it.
  assert.equal(lovejoinBootstrapReserve(JSON.stringify({ ...params, coins_per_utxo_size: "6465" })), "1800000");
  // Parameters it can't read are refused, never funded on the least.
  assert.throws(() => lovejoinBootstrapReserve("{}"));
});
