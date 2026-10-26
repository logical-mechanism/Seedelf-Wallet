# fx-may's fixes, reviewed (lens `last-3e`)

Scope: fx-may's code in `git diff -- WW/extension/src` and its tests (last-3d 1 and 2), the locale JSON left out:
- `sessions.ts`: stopCost's `landing`; tailReserve's `{ reserve, may }`; outBuild, siteOutBuild, mixFunding, topUpBuild;
- `lovejoin.ts`: collateralPool's `tell`;
- `collateral-reserve-review-fixes.test.ts` and `run-traps-review-fixes.test.ts`.

**Verdict:** no high or medium. Two lows and a nit.
- tailReserve's `may` follows fx-promise's rule in all four fundings, and a failed read still hands a trap on.
- stopCost's `landing` fixes last-3d 1's window, from Start swap until the funding is confirmed. It misses the window after that: the funding is confirmed but Koios doesn't list it yet. The cause is the same (the last reading holds nothing), and so is the effect.
- The guard that keeps a funding found short out of `landing` is right, but no test pins it.
- No neighbouring flow broke: the full unit suite passes but for L5's two known gates.

Each finding was made concrete with a throwaway test against the real WebAssembly, run in a scratch copy (`zz-review-3e-{1..5}`). The copy and the tests are deleted; their output is in the scratchpad, `last3e-throwaways.log`. Nothing tracked was edited.

## Findings

### 1. low: Stop pressed after the funding is confirmed but before Koios lists it says nothing of the collateral's mix, and with no box "…less the return's network fee", while the return mixes the 5 ₳

- **Where:** `extension/src/background/sessions.ts:3296`. `landing` is `fundingState(s, rows).state === "funding"`, and fundingState says `landed` on `confirmed` alone (`:1089`). With `rows` empty, `mayMix` is false. The words are at `Swaps.tsx:2909` (`notPlacedDirect`).
- **Concerns:** fx-may, last-3d 1. The fix covers the funding on its way, not the next state, where the account's last reading still holds nothing. The finding's own suggestion (`!out.confirmed`) had the same gap.
- **Scenario:** an ADA→MIN swap funded with the reserve, preprod's 5 ₳ pool taking the collateral.
  - tx_status confirms the funding (the runner's `act`, or a refresh's `landed`), and the listing read with it is behind the chain. The runner waits for it (`:3604–3605`, "Koios doesn't list what's there yet"). It reads every 15 s, and the page asks every 20 s.
  - The page shows stage `open`, step `ordering`, and offers Stop (`stopReading` over: false).
  - The dialog says "If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee." It has no giveme.my line: the over-promise LW-1 removed.
  - Once Koios lists the funding, the same dialog says `mixed`, and backBuild builds the collateral's tail.
  - A worker that started again shows the same until its first read, since `seen` is in memory.
- **Evidence:** `zz-review-3e-1`, with fx-may's on-its-way case beside it for comparison:
  ```
  on its way: {"boxes":0,…,"collateralMix":"mixed"}
  page: {"stage":"open","step":"ordering","stopReading":{"over":false,"placed":false}}
  confirmed, unlisted: {"boxes":0,"mixes":0,"mixFees":"0","withdrawFees":"0","depth":1,"delay":"1-6","on":true}
  dialog: Stop this swap? If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee. …
  restarted, no read yet: {"boxes":0,…,"on":true}
  listed: {"boxes":0,…,"collateralMix":"mixed"} backTail: true backBoxes: 0
  AssertionError: restarted: expected undefined to be 'mixed'
  ```
- **Why low:** the same class and effect as last-3d 1, in a window just as short. Mainnet has no 5 ₳ pool yet, so it's dormant there. The policy's giveme.my line covers that mix.
- **Suggested fix:** no new words, no refusal. Before any swap is sent, count the account as the funding will leave it until the reading lists every part of it, as `landing` does now:
  ```ts
  const state = fundingState(s, rows).state;
  const listedTx = new Set((rows ?? []).map((u) => u.tx_hash));
  const landing = state === "funding" || (state === "landed" && !sent && fundingOf(s).some((t) => !listedTx.has(t.txHash)));
  ```
  - A funding found `short` or `never` stays out, as now (finding 2).
  - The box count is unchanged: with nothing seen it counts `funded`.
  - Tried in the copy: `zz-review-3e-1` passes. So do all 40 test files that touch stopCost, StopDialog, fundingState or a stage, 869 of 869.

### 2. low: no test pins that Stop on a funding found short (its collateral's part missed) says nothing of that mix

- **Where:** `sessions.ts:3296`, and fx-may's Stop test in `collateral-reserve-review-fixes.test.ts`.
- **Concerns:** fx-may, last-3d 1. Its report says "A part found missed makes the funding `short` or `never`. Stop's reading of the account then decides, as before." No test checks this.
- **Scenario:** a funding in two parts.
  - Part 1, which pays the 5 ₳ collateral, was missed. Part 2 landed and is listed (10 ₳).
  - The session is paused `short`, at step `funding`, and the page offers Stop to bring back what came.
  - The tree says nothing of the mix, which is right: there's no collateral to mix.
- **Evidence:**
  - **Mutation:** `landing` widened to `state !== "landed"` in the copy. All 67 test files that touch stopCost, StopDialog, fundingState, a stage or parts still pass, 1285 of 1285.
  - **What the mutant says:** `zz-review-3e-5` on the mutant gives `{"stage":"open","step":"funding","paused":"short",…,"collateralMix":"mixed"}`. The dialog adds "giveme.my backs its collateral's mix, so it sees that mix." (`AssertionError: expected 'mixed' to be undefined`).
  - **On the tree:** the test passes.
- **Why low:** a missing test for a guard. It matters now because finding 1's fix edits this line.
- **Suggested fix:** add `zz-review-3e-5`'s case to fx-may's Stop test, and expect `collateralMix` undefined:
  - `parts: 2`;
  - part 1 `missed`, part 2 `confirmed` and listed;
  - `paused: { why: "short", landed: 1, total: 2 }`;
  - `collateralReserve: true`.

### 3. nit: two code docs don't name the failed read

- `rpc.ts:1948` (`SessionOutSummary.collateralMix`) says "where a 5 ₳ pool takes the collateral as Review read it". Since fx-may, it is also set where that read failed and the wallet's last read doesn't say the pool takes none (tailReserve's `may`).
- `lovejoin.ts:3909–3910` (`collateralPoolTakes`) lists its callers as the quote and Stop's dialog. tailReserve now asks it too, after a failed read.
- **Suggested fix:** one clause each. These are code comments; the served docs are L6's.

## Checked, and holding

**tailReserve's `may`, against fx-promise's rule:**
- **outBuild:** `ifLeft` on a failed read, never `mixed` (no reserve is paid). Nothing where tailUnpaid holds, recomputed after the token boxes' retry.
- **siteOutBuild and topUpBuild:** `ifLeft`. A top-up asks only when it puts in a new collateral (`fresh`).
- **mixFunding:** `ifLeft`. A Bootstrap never asks.
- **Nothing said:** Settings' switch off, the approval's switch off, or Lovejoin not on the network.
- **`collateralPoolTakes` "no" gives nothing:** no 5 ₳ pool shown; the pool unusable this epoch; the data layer's count under the floor; or a rooms read within POOL_ROOM_MS with too few others or free boxes. That matches the quote and Stop.
- **The screens:** each follows with its existing words, as fx-may's tests render them. No cost row without the reserve.

**Traps:**
- **Where they go:** with `tell`, split's rejection reaches tailReserve's catch, which rethrows a trap.
- **After a failed read:** collateralPoolTakes rethrows traps (readSet's `kept`, `verifiedPool`). Its only catch is around `facts`, which is local.
- **Pinned:** L3's `funded(trap)` test still pins the trap path, and fx-may's test pins that `tell = false` stays none for buildBack.
- **Non-trap failures:** a locked wallet, a Koios error or a 429 is now a maybe, and the funding still builds without the reserve. A locked wallet then fails the funding's own build, as before.

**Privacy:**
- **No new request:** `known` asks nobody and `facts` is "from the device, no request" (`lovejoin.ts:1464–1487`, `sw.ts:248–250`).
- **The policy:** its giveme.my line already names "the one mix of a private session's 5 ₳ collateral". Nothing in it turns false.

**stopCost's `landing`, case by case:**
- **ADA swap:** `mixed` with the reserve, `ifLeft` without.
- **A token's funding:** nothing.
- **Settings off, or the pool refusing:** nothing.
- **Approved direct:** null.
- **Stop's switch off with boxes:** no line. A direct Stop never mixes the collateral (`intoPool` needs `!direct`, `sessions.ts:4366–4374`).
- **A 1.5.0 record** (no parts, no reserve flag): `ifLeft` while it lands, as once landed.
- **The box count:** unchanged in every case.

**A token sale funded in parts:**
- **The mismatch, with sub-minimum UTxOs:** the planner can pay a part of ADA alone ("Then parts of ADA alone", `wasm/src/lib.rs:4090`). With Seedelf UTxOs of 0.5–0.56 ₳, the dialog then disagrees with the one once landed:
  - at 0.5 ₳, the landed dialog says `mixed` and a tail is built;
  - at 0.56 ₳, it says `mixed` and none is built (`zz-review-3e-2`, `-3`).
- **Why it can't happen on chain:** a Seedelf output holds over 1 ₳ (`seedelf-core/tests/build_test.rs:595`). With realistic shapes every part carries the token. `zz-review-3e-4`: 50 MIN UTxOs of 1.3 ₳ and 30 of 1.5 ₳ give 3 parts, each with MIN. So fx-may's "a token's funding is the token beside all the ADA" holds. Not a finding.

**e2e:**
- **Network:** e2e runs on preprod, which bundles a 5 ₳ pool, so its swap, site and mix reviews do call tailReserve.
- **No review reaches the failed read:** its Koios fake fails reads only in Home's tests (`failWith`, `extension.spec.ts:463–497`, `931–941`).
- **Its one Stop** (`:3567–3571`) comes after the funding landed. It reads a substring every variant keeps.

**fx-may's tests:**
- **Fail-before:** shown.
- **Mutation logs:** M1, M2, M2b and M2c show real failures.

## Questions (not made concrete)

None.

## Checks run

- **Baseline:** fx-may's two files, 44 of 44.
- **The full unit suite,** 249 files:
  - 2876 passed, 4 skipped, 2 failed;
  - the 2 failures are `i18n.test.ts`'s es/ja machine-draft gates (L5).
  - Its log is `last3e-full.log` in the scratchpad.
- **`tsc --noEmit -p .`:** clean.
- **Throwaways** `zz-review-3e-1` to `-5`: run in a scratch copy, then deleted with it. Their output is in `last3e-throwaways.log`.
- **The two mutations** (finding 1's fix, finding 2's widening): made in the copy only.
- **Not run:** builds, Playwright, cargo, a formatter, mainnet.
