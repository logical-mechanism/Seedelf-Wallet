// The glue's reset (build.sh's --experimental-reset-state-function), which
// the extension uses to replace an instance that trapped (background/wasm.ts):
// it ends by calling the module's start function, so the module has one, and
// the reset finishes without a TypeError.
import { test } from "node:test";
import assert from "node:assert/strict";

import { __wbg_reset_state, SeedelfKey } from "./wasm.mjs";

const SK = "000000000000000000000000000000000000000000000000fffffffffffffff6";

test("a reset finishes, and leaves a fresh instance where the old one's objects no longer work", () => {
  const old = SeedelfKey.fromHex(SK);
  const before = old.baseRegister().publicValue;
  assert.doesNotThrow(() => __wbg_reset_state());
  // The old instance's key is gone with it.
  assert.throws(() => old.baseRegister());
  // The new instance works, and gives the same answer.
  assert.equal(SeedelfKey.fromHex(SK).baseRegister().publicValue, before);
});
