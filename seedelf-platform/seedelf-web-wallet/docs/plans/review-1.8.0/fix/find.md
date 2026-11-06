# 1.8.0's release review: the find lane's fixes

Fixer: **find**. Worktree `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/find`, branch `review-1.8.0/fix-find`, from `1beba3fb`. **Head: `a7e46c3b`.**

| Commit | What |
|---|---|
| `7333d8cf` | O1: `adaPool`'s ask looks (discovery's `lookSoon`, handed over by `serviceDeps`); a refresh under way is shared; `room()` takes `quiet`; critic#7 |
| `6bc6d4db` | O2 and critic#1: `priced` asks at Review and in Stop's dialog, and says `of` at a 5 ₳ box's price with no pool shown; `collateralWanted` asks, and says why Lovejoin is left out |
| `727a3ea5` | O4 and critic#0: the two reasons reworded in en, es and ja; the swap's two frames give them a capital; the `NO_ADA_POOL` pin |
| `6492d0cf` | `tests/lovejoin-found-later.test.ts` |
| `ade56570` | its join test (a revert check survived without it) |
| `a7e46c3b` | critic#0's test keeps the pool first, so it fails at the base for the floor's words alone |

| Finding | Status |
|---|---|
| O1, with hardening a and b | fixed |
| O2 | fixed |
| critic#1 (O2) | fixed |
| O4 | fixed; awaits a blind back-translation |
| critic#0 (O4) | fixed; awaits a blind back-translation |
| critic#7 | fixed |
| W10's `room()` default (adapool#6) | **not fixed**: six test calls in four other files read the 5 ₳ pool's room through it, and one pins it as behaviour |

## How it was tested

- **Every new test is in `extension/tests/lovejoin-found-later.test.ts` (32).** Discovery is wired there as `sw.ts` wires it: `serviceDeps(discovery)`, `lookForPools: discovery.look`, `facts`. Its data layer sits behind `privateIndexClient`'s own gate, with mainnet's origin alone, as `dataOrigin` has it.
- **Its head start holds no v2 pool:** the release's bundled one, less its v2 pools (o-design §5, E9).
- **The pool** is `wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json`'s, launched in the block after each network's head start. On mainnet its rows are re-addressed, as the e2e's `fiveAt` does.
- **Koios's holder is a counting fake, each network its own.** The pool's own boxes come from the chain's fake: 20 strangers', or 32 on mainnet, where the floor is 30.
- Every command below ran from the worktree's `seedelf-platform/seedelf-web-wallet/extension`.

**The base.** `scratchpad/find-lane/swap.sh base` puts the lane's eight changed sources back to `1beba3fb`'s and leaves the tests as they are. `swap.sh fixed` restores the fixes and checks their sha256.

```
swap.sh base; npx vitest run tests/lovejoin-found-later.test.ts --maxWorkers=2; swap.sh fixed
→ Tests 28 failed | 4 passed (32)
```

- **The 4 that pass at the base** are guards. Two hold either way: mainnet with the data layer up (O1 isn't broken there) and the page's look racing a build. o2-trace's corner must still pass. The last checks the fixtures.
- **Each of the 28 fails for its own finding's reason** (listed per finding below).
- The critic#1 and critic#0 cases, and the `of` case's kept world, find the pool through the page's look first. So at the base they fail on their own words or figures, not on O1's missing look.

**Fixed:** 32 passed on the default build, and 32 with `VITE_ENABLE_MAINNET=false`. Three more runs under `taskset -c 0,1`: 32, 32 and 32 passed.

**The revert checks.** `python3 -I scratchpad/find-lane/mutate.py <spec> [ids]` reverts one fix by exact replacement and runs the tests named. It then restores the file and checks its sha256 (every run ended `fixed: sums match`). The specs are `scratchpad/find-lane/spec.json` and `spec-extra.json`, and each run's log is in `scratchpad/find-lane/mutants/`. Counts of 31 are from before the join test was added; the file has 32 now.

---

## O1 · fixed

**What changed**

- **`lovejoin-pools.ts`:**
  - **`PoolDiscovery.lookSoon(network)`** (hardening a), the look an ask makes:
    - it refreshes the data layer's list first, as any pool read does;
    - it doesn't read Koios's holder where the data layer answered within `REFRESH_MS`, as `look` doesn't;
    - nor within `REFRESH_MS` of the last look's start (`scanned`, set as `scan` starts, the page's look included, whatever it found or however it failed);
    - unless a look is under way, which it joins.
  - **`refresh` shares a run under way** (`refreshing`; the body is `refreshNow`): hardening b. A look beside a refresh now waits for its list rather than read Koios while the data layer answers.
  - `look` reads `answeredWithin`, unchanged in effect.
  - **`serviceDeps` hands `lookSoon` to the service.** `sw.ts` spreads `serviceDeps`, so its wiring is unchanged; one comment there now says when the holder is read.
- **`lovejoin.ts`:**
  - `LovejoinDeps.lookSoon?`.
  - **`adaPool(network, ask)`:** the kept set; with `ask`, then the listed set (the refresh); with none listed, `lookSoon`, then the kept set again.
  - A look that fails finds none, as discovery failing is no pool gone elsewhere: `.catch(unlessTrap(undefined))`. A trap is handed on.
  - With no `lookSoon` wired (most tests), an ask is as it was.
- **Where it looks:** `chain()`'s and `collateralPool`'s asks (a return's build; a funding's collateral pick through `tailReserve`), and O2's two new asks below. The quiet reads stay quiet: the quote as the user types, `collateralPoolTakes`, `funding`'s tail, `held()`, the session list.

**The tests** (o-design §5's items 1–8 and 11, and the hardening). Every count below is asserted, but the failed look's three tries: they're the Koios client's own (`RETRY_DELAYS_MS`), and the test asserts some, then none more within `REFRESH_MS`. Columns: Koios's `credential_utxos` / `tx_info` (discovery's), and the data layer's `lovejoin/pools`.

| Network, mode | What asks | Koios | List |
|---|---|---|---|
| preprod | a return's build (the collateral's pick and the chain) | 1 / 1, then 0 at the next build | none (no data layer) |
| mainnet, Koios-only | `adaPool(ask)`, then `collateralPool` | 1 / 1, then 0 | 0 |
| mainnet, data layer marked down, its last answer a minute old | an ask | 0 / 0 | 1 (before it went down) |
| the same, `REFRESH_MS` on | an ask, then `collateralPool` | 1 / 1 | still 1 |
| mainnet, data layer down from the start | `collateralPool` | 1 / 1 | 0 |
| mainnet, data layer up, listed | an ask, then `collateralPool` | 0 / 0 | 1 |
| mainnet, data layer up, not listed | two asks | 0 / 0 | 1 |
| either network, a quiet read | `adaPool` without `ask` | 0 / 0 | 0 |
| no pool anywhere | a build (two asks), a second build, mainnet's first ask, a build `REFRESH_MS` on | preprod 1 / 0, 1, 2 / 0; mainnet its own 1 / 0 | — |
| a look that fails (500) | a build; a build within `REFRESH_MS`; one after | 3 (the client's tries), then 0, then found | — |
| `SETTLE_MS`: a launch 3 minutes old | builds at 0, +5 and +10 minutes | 3 / 1, found at the third | — |
| found, under a floor of 30 | a build | 1 / 1 | — |
| the page's look and a build at once | — | 1 / 1 | — |
| the page's look (nothing there), an ask a minute on, one `REFRESH_MS` on | — | 1 / 0, still 1, then 2 / 1 | — |
| two asks at once, the holder answering | — | 1 / 1, both find it | — |
| two page looks at once, data layer up, not listed | — | 0 / 0 | 1 |

On mainnet the tests stop at `adaPool` and `collateralPool`: a whole return there would need mainnet-addressed sessions. The whole return is tested on preprod, mixing into the pool with its collateral's tail. Other O1 cases:
- a trap in the look (discovery's WebAssembly raising `RuntimeError`) rejects the build, and an ask after;
- a pool found under its floor gives the floor's words, with no collateral tail;
- one found empty (floor 0) gives `lj.skip.warn.needsMore`.

**At the base**, each fails because nothing looks:
- the preprod build comes back with `noAdaPool`;
- `adaPool("mainnet", true)` is `undefined` in Koios-only, down and marked-down modes;
- the counts are 0;
- the trap is never reached ("promise resolved instead of rejecting");
- the `SETTLE_MS`, floor and empty cases say `noAdaPool`;
- `serviceDeps(…).lookSoon` is `undefined`.

Hardening b's case fails at the base for its own race: two looks at once read Koios (`credential_utxos: 1`) while the data layer answers.

**Revert checks**

| Reverted | Tests run | Result |
|---|---|---|
| `adaPool`'s ask doesn't look (`return listed`) | the whole file | 19 failed, 12 passed (31): every O1 case, O2's review, Stop and no-collateral cases, O4's two found-later cases |
| a failed look thrown (no `.catch`) | `-t "a look that fails"` | 1 failed |
| a trap swallowed (`.catch(() => undefined)`) | `-t "a trap in the look"` | 1 failed |
| `lookSoon` unthrottled | `-t REFRESH_MS` | 5 failed, 1 passed: no pool's count, the failed look, `SETTLE_MS`, the ask after the page's look, the asks at once |
| `lookSoon` skips a look under way instead of joining it | `-t "at once"` | 3 passed, **survived**. Then a test of two asks at once against a holder that answers (`ade56570`): 1 failed, `[ADA, undefined]` |
| the throttle counted from a look that succeeded | `-t fail` | 2 failed |
| `lookSoon` reads the holder though the list answered lately | `-t mainnet` | 2 failed, 2 passed |
| `refresh` not shared | `-t "two looks at once"` | 1 failed |
| a shared refresh never cleared | `tests/lovejoin-discovery.test.ts` | 2 failed, 19 passed (the existing throttle tests); the lane's mainnet cases: 4 passed |

## O2 · fixed

**What changed** (`sessions.ts`; `lovejoin.ts`'s `room()`).
- **`priced` asks at Review and in Stop's dialog:** `adaPool(network, pool)`, and so it looks where none is kept. It stays quiet as the user types (`pool` false). Stop's dialog reaches it through `stopCost`'s `priced(network, true, …)` (share's function, unchanged).
- **With no 5 ₳ pool shown, `priced` reports `of` at a 5 ₳ box's own price** (o2-trace's narrowing):
  - the price is the classic box's, less its 10 ₳, plus a 5 ₳ box's 5 ₳ (`perFive = perBox − LOVEJOIN_DENOM + SESSION_COLLATERAL`);
  - WebAssembly prices a box's mixes the same in either pool (`per_box_in`). A scratch run at every depth and width found the gap exactly 5 ₳, and the deposit's reserve equal. The test below holds it;
  - boxes stay 0, and D3's width rule still weighs no ADA leg;
  - `of` drives only `any` in `Swaps.tsx`: it's displayed nowhere while `skipped` is set (the cost rows, the stop line and Stop's dialog all require no `skipped`). `any` needed no change;
  - nothing records it with a session.
- **`collateralWanted(network, s, rows, ask)`** returns `true`, `false`, or a reason:
  - `buildBack`'s no-collateral branch and `backCollateralBuild` (through `lovejoinWantsCollateral(…, true)`) ask, and so look;
  - the session list (`backWantsCollateral`) reads the device alone;
  - with no 5 ₳ pool after the ask, and no token's pool wanting the collateral, the reason is `noAdaPool`, never `noBox`;
  - `NO_ADA_POOL` is a constant beside `NO_COLLATERAL`, which `priced` uses too.

**Tests**
- **A swap's Review:**
  - as the user types, `skipped` is `noAdaPool`, with 0 holder reads;
  - at Review there's no `skipped`, the `ifStopped` boxes are > 0, the 1.5 ₳ reserve is kept, and the holder is read 1 / 1.
- **Stop's dialog:** after the session list (0 reads), there's no `skipped`, boxes > 0, and the holder is read 1 / 1.
- **A by-hand return with no 5 ₳ at its account:**
  - no pool anywhere: `noAdaPool`, and the list offers no 5 ₳;
  - the pool at the holder, not kept: the list reads nothing and offers nothing; the build reads 1 / 1 and says `noCollateral`; the list then says `missing`, reading nothing more;
  - Put in 5 ₳ (`backCollateralBuild`) finds the pool and builds the 5 ₳ top-up.
- **The approval with no pool to take the ADA, selling 50 ₳ and buying 10 ₳:** the choice shows: "Bring it back through Lovejoin", `swaps.lovejoin.privacy.onPoolShort`, and the warn line with the reason. There's no "Too little spare ADA".
- **`of` with no pool equals the kept pool's own** (`{boxes: 2, of: 5}` kept with room; `{boxes: 0, of: 5}` with none).
- **o2-trace's corner** still says "Too little spare ADA for a Lovejoin box": 1 ₳ of proceeds with no pool, and the pool under a floor of 25.

**At the base:**
- the review and Stop say `noAdaPool`;
- the no-collateral returns say "its spare ADA is too little for a box";
- Put in 5 ₳ is refused ("Its return needs no 5 ₳…");
- the approval says "Too little spare ADA";
- `of` is absent.

**Revert checks**

| Reverted | Tests run | Result |
|---|---|---|
| `priced` quiet at Review (`adaPool(network)`) | `-t O2` | 2 failed, 7 passed: the review and Stop |
| `priced` asks as the user types (`adaPool(network, true)`) | `-t "as the user types"` | 1 failed |
| `collateralWanted` quiet | `-t "brought back by hand"` | 2 failed: the build's reason, Put in 5 ₳ |
| the list asks (`lovejoinWantsCollateral` with `true`) | same | 1 failed |
| `noBox` for no pool (`return short ?? false`) | same | 1 failed |
| the narrowing reverted (`affordable` alone) | `-t approval` | 3 failed, 1 passed |
| `of` at the classic box's price (`perBox`) | `-t approval` | 1 failed |
| fix 3 un-narrowed (`any` on `!!l.skipped`) | `-t corner` | 1 failed |

## critic#1 · fixed

**What changed.** `collateralWanted`, where the spare pays for a box and the network has a floor:
- it reads the 5 ₳ pool's room: `room(network, ada.id, !ask)`. That's read at a build or a top-up (kept `POOL_ROOM_MS`), and only the last read in the list (`quiet`). On preprod (floor 0) it reads nothing;
- under the floor, the ADA's box doesn't want the collateral. With no token's pool wanting it, the reason is the floor's, `lj.skip.warn.floorShort` with the count read;
- so the list offers no 5 ₳ where its last read is under the floor, and `backCollateralBuild` refuses with `sess.backCollateral.notNeeded`;
- where the spare pays for no box, the reason stays `noBox`, as a return with its collateral says.

**Test.** The pool is kept first by the page's look, with a floor of 30 and 20 others:
- the build gives the floor's reason, the list offers nothing, and Put in 5 ₳ is refused;
- 3 ₳ at the account gives `noBox`.

**At the base:** it gives `noCollateral` (critic#1's own scenario).

**Revert check:** `if (pays && !short)` → `if (pays)`, `-t "brought back by hand"`: 1 failed.

## O4 · fixed, awaiting a blind back-translation

**What changed**
- `sess.skip.warn.noAdaPool` says what the wallet knew when it read: "the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it" (en, es, ja; the values are below).
- `swaps.lovejoin.warn.pool` and `swaps.stop.poolShort` open their sentence with the reason. `Swaps.tsx` gives it a capital there, where its language has one (`opening`, as `asSentence` does); the frames' keys are unchanged.
- `tests/lovejoin-1-5-0.test.ts:420`'s `NO_ADA_POOL` pin follows the value.

**Tests.**
- **No pool:**
  - the return's review, word for word;
  - the session's page once the pool is found ("Lovejoin was left out of its return: the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it. So it comes back directly, tied to the session on chain.");
  - Bring everything back's item.
- **The approval's warn line and Stop's dialog,** each opening "The wallet knew of no…". Spanish opens "La billetera no conocía…, así que, tal como están las cosas".
- **The es and ja values,** as drafted.

**At the base:** the old words ("Lovejoin has no pool of 5 ₳ boxes to take it yet"), or no warn line at all in the approval.

**Revert checks**

| Reverted | Tests run | Result |
|---|---|---|
| en's old value | `-t O4` | 2 failed, 2 passed |
| es's old value | `-t Spanish` | 1 failed |
| the approval's frame lower-case (`l.skipped`) | `-t capital` | 1 failed |
| Stop's frame lower-case (`cost.skipped`) | `-t capital` | 1 failed |

## critic#0 · fixed, awaiting a blind back-translation

**What changed.** `lj.skip.warn.floorShort`: "Lovejoin's pool held {{count}} boxes not yours when the wallet read it, and the wallet mixes only from {{floor}}" (en `_one`/`_other`; es `_one`/`_many`/`_other`; ja `_other`).

**Test.** The pool is kept first, with a floor of 30 and 20 others:
- the build saves the floor's reason;
- 20 more strangers arrive, and the pool's room reads 40;
- the session's page says "Lovejoin was left out of its return: Lovejoin's pool held 20 boxes not yours when the wallet read it, and the wallet mixes only from 30. So it comes back directly, tied to the session on chain.";
- the `_one` form is checked.

**At the base:** "Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30".

**Revert checks:**
- en's old values, `-t critic#0`: 1 failed, 3 passed (32);
- ja's old value, `-t Spanish`: 1 failed.

## critic#7 · fixed

`adaPoolOf`'s doc comment moved from above `retiredOf` to `adaPoolOf` (`7333d8cf`). It's a comment: no test.

## W10: `room()`'s default (adapool#6) · not fixed

**Why.** The default isn't dead in the tests. Six calls in four files read the 5 ₳ pool's room through it:
- `chain-reservations.test.ts:106` and `:121`;
- `lovejoin-flows.test.ts:212`;
- `lovejoin-planner.test.ts:819`, which pins it as behaviour: "A room named no pool is the 5 ₳ pool's";
- `public-mix-maybe-hold.test.ts:59` and `:72`.

Dropping it fails `tsc` on those files and the calls at run time. None of the four is in my lane's row.

**What I did instead.** `room()` keeps its optional `pool`, and gains `quiet` as a third parameter for critic#1.

**To drop it at the merge:**
- each of those calls names `ADA` (from `./v2-pools`);
- lovejoin-planner's pin goes;
- `room(network, pool: string, quiet = false)` loses its `pool ??` line.

My first commit's message says "eight test calls": it's six.

---

## Awaiting blind back-translation

Both keys are critical, and both were already in `verified-critical-{es,ja}.json`'s `keys`, so they're listed provisionally, as the gate needs. `reviewer` is untouched. Every changed es and ja form is `machine` in `docs/i18n/{es,ja}-provenance.json` already. `node scripts/i18n-critical.mjs --write` gave 475 keys, with no change to `critical-keys.json`. The negation, token and provenance checks pass in `tests/i18n.test.ts`.

**`sess.skip.warn.noAdaPool`**

| | Was | Now |
|---|---|---|
| en | Lovejoin has no pool of 5 ₳ boxes to take it yet | the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it |
| es | Lovejoin aún no tiene un pool de cajas de 5 ₳ que lo reciba | la billetera no conocía ningún pool de Lovejoin de cajas de 5 ₳ que lo recibiera |
| ja | Lovejoin にはまだ受け入れ先の 5 ₳ ボックスのプールがありません | ウォレットは受け入れ先となる 5 ₳ ボックスの Lovejoin プールを把握していませんでした |

Frames:
1. **The return's review:** `lovejoin.warn.skippedThis` (`LovejoinReturn.tsx` `LovejoinNote`), "Lovejoin is left out of this return: {{why}}. Everything comes back directly, unmixed."
2. **The session's page later:** `lovejoin.warn.skippedIts` (`LovejoinReturn.tsx` `LovejoinSkipped`, from `SiteSessions.tsx:452`, `Swaps.tsx:2519` and `:2582`), "Lovejoin was left out of its return: {{why}}. So it comes back directly, tied to the session on chain."
3. **Bring everything back's list:** `claim.warn.skippedItem` (`ClaimAll.tsx:363`), "{{name}}: {{why}}."
4. **A swap's approval at Review:** `swaps.lovejoin.warn.pool` (`LovejoinChoice`), opening the sentence, capitalised: "{{why}}, so as things are, this swap's ADA comes back directly, tied to this session on chain."
5. **Stop's dialog:** `swaps.stop.poolShort` (`StopDialog`), opening the sentence, capitalised: "{{why}}, so its ADA would come back directly, tied to this session on chain."

It never reaches a mix session's `lj.leftOut`: a mix names its pool, so its chain throws `lj.poolUnknown` instead.

**`lj.skip.warn.floorShort`** (`_one` says "box … not yours" in en and "caja que no es tuya" in es; es `_many` is as `_other`)

| | Was (`_other`) | Now (`_other`) |
|---|---|---|
| en | Lovejoin's pool holds {{count}} boxes not yours, and the wallet mixes only from {{floor}} | Lovejoin's pool held {{count}} boxes not yours when the wallet read it, and the wallet mixes only from {{floor}} |
| es | El pool de Lovejoin tiene {{count}} cajas que no son tuyas, y la billetera solo mezcla a partir de {{floor}} | El pool de Lovejoin tenía {{count}} cajas que no son tuyas cuando la billetera lo leyó, y la billetera solo mezcla a partir de {{floor}} |
| ja | Lovejoin のプールにはあなたのものではないボックスが {{count}} 件あり、ウォレットがミックスするのは {{floor}} 件からです | ウォレットが読んだ時点で、Lovejoin のプールにはあなたのものではないボックスが {{count}} 件あり、ウォレットがミックスするのは {{floor}} 件からです |

Frames:
1. **The return's review** (`lovejoin.warn.skippedThis`).
2. **The session's page later** (`lovejoin.warn.skippedIts`).
3. **Bring everything back's list** (`claim.warn.skippedItem`).
4. **A tile Mix's row on Lovejoin's page:** `lj.leftOut` (`Lovejoin.tsx:909` `detailOf`), "Lovejoin was left out: {{reason}}.", where its chain met the floor when built.

Where it's given:
- **chain()'s `fanOut` and `acrossOf`;**
- **now also `collateralWanted`** (critic#1, a return with no collateral), into frames 1–3.

It isn't the Mix form's refusal: that's `lj.floorShortSentence` (`lovejoin.ts` `floor()`, `Lovejoin.tsx:3182` and `:3228`), shown live. Nor is it a swap's frames: a swap's price says the floor as `sess.skip.warn.poolFloor`.

## For the lead

1. **Three pins in other lanes' files follow my values.** Each patch was applied, run and taken out again; the diffs are in the scratchpad.
   - **`tests/lovejoin-1-5-0.test.ts`'s `asRetired`** (e2e's part of the file):
     - O2's narrowing makes a swap with no pool say `of` at a 5 ₳ box's price. The quote and the review get `ifStopped: {boxes: 0, mixes: 0, mixFees: "0", withdrawFees: "0", of: 1}`, and Stop gets `of: 4`;
     - the patch, its doc comment included, is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/find-lane/asRetired-proposed.diff`;
     - with it, the plans case passes (1 passed, 3 skipped by `-t`), and `tsc` is clean.
   - **`tests/lovejoin.test.ts:788` and `tests/i18n-worker-reasons.test.ts:873–879`** (screens' file for W7): the new floor words in en and ja.
     - the patch is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/find-lane/pins-proposed.diff`;
     - with it, both files pass: 124 passed.
   - **`tests/lovejoin-hub.test.ts:497`** hands the approval a literal floor reason in the old words. It passes as it is, since it reads back what it's given; updating it is optional.
2. **W10's `room()` default,** if you want it gone: the edits are in its section above.
3. **The docs O1 makes stale** (o-design §3, step 9). None is in my lane.
   - **`docs/store/privacy-policy.md:46` and `docs/privacy.md:201`.** The holder look now also runs, while no 5 ₳ pool is kept, at most every five minutes a network. It runs where these ask for the pool:
     - a return;
     - a swap's review, or Stop;
     - a funding's review;
     - a session's Put in 5 ₳.

     That changes when the wallet sends a request, so it owes a dated *Changes* entry, beside D2's. o-design's words: "while it knows of no pool of 5 ₳ boxes, a private session's return, a review and a funding also look, at most every five minutes, the same read of Lovejoin's reference holder."
   - **critic#1 adds a pool read.** On mainnet (floor 30), a return built with no collateral now reads the pools' room once (kept five minutes), where it read no pool before. It's the read every return with its collateral makes.
   - **`architecture.md:733`, `development.md:330` and the plan's 44c.** development.md's "never a gate: a pool launched after it is found live" is true again.
   - **`lovejoin-pools.ts`'s header comment** (v44a's): "Koios (preprod, or while the data layer can't answer), when the Lovejoin page opens" now also holds where an ask finds no 5 ₳ pool (`lookSoon`).
4. **critic#2, at the merge.** The retire lane's Bring every box back, asked with no pool named, can look first:
   - `await this.deps.lookSoon?.(network).catch(unlessTrap(undefined))` before its first pool read;
   - `lookSoon` finds every pool launched since, not only the 5 ₳ one;
   - it's throttled, and a trap is handed on.
5. **The connector lane.**
   - Its funding review (`siteOutBuild` → `tailReserve` → `collateralPool`) asks already, so with this branch it looks too. o-design §3 counts "a funding's collateral pick" among the looks.
   - Its card must stay quiet: `collateralPoolTakes` and `adaPool` without `ask` never look.
   - Its mark, "read as `priced` reads the 5 ₳ pool", gets the ask at the merge.
6. **The e2e lane.**
   - **On mainnet, an ask before `lookedForFive` now finds `fivePool`'s pool itself.** The asks are: a return's build, a swap's Review, Stop's dialog, a funding's review, Put in 5 ₳.
     - The page's look then answers `grew: false`.
     - Koios sees one `credential_utxos` for `288fea77…` and the launch's `tx_info` at that ask.
   - **Today's two `lookedForFive` callers are unaffected.** They're preprod tests (`extension.spec.ts:753`, `:5179`), where the bundled `47bece42` keeps every ask quiet.
   - **The mainnet "found later" e2e** should pass with this branch: its build makes one holder read and one `tx_info`.
7. **The share lane.**
   - **`stopCost` asks now,** through `priced(network, true, …)`: Stop's dialog may read the holder once, throttled.
   - **`priced` with no pool shown carries `of`,** and `ifStopped` where a stop pays for more. `stopCost`'s `price(counted)` returns them, and nothing shows `of` while `skipped` is set.
8. **The chain lane.** `chain()`'s `adaPool(network, true)` now looks before its no-pool throw; O5's change sits after it, on the result.
9. **`lovejoin-1-5-0`'s two head-start cases (D6)** fail here exactly as at the base, its extra `credential_utxos` for `67ffe4ed…` included. I compared the two runs.

## Checks run

- **Types.** `npx tsc --noEmit -p .`: exit 0.
- **The lane's file.** `tests/lovejoin-found-later.test.ts`:
  - 32 passed, default build;
  - 32 passed, `VITE_ENABLE_MAINNET=false`;
  - three runs under `taskset -c 0,1`, 32 passed each.
- **The sweep: 118 files,** 14 a batch, `--maxWorkers=2`: every test file importing `lovejoin-pools`, `lovejoin`, `sessions`, `Swaps`, `chain-fixtures`, `v2-pools` or `swap-session`, and `tests/i18n*.test.ts`, `words.test.ts` and `worker-words.test.ts`.
  - **Default build:** 115 files passed, 3 failed. Of 1,753 tests, 1,746 passed, 2 were skipped and 5 failed.
  - **`VITE_ENABLE_MAINNET=false`:** the same, batch for batch.
  - **The five:**
    - `lovejoin-1-5-0`'s plans case (item 1's `asRetired`);
    - its two head-start cases (D6, failing at the base);
    - `lovejoin.test.ts:788` (item 1);
    - `i18n-worker-reasons`' Japanese pin (item 1).

    With item 1's two patches, all but the two head-start cases pass.
- **The i18n and words files** (10): 190 passed, 1 failed, the Japanese pin above. The critical-set, negation, token and provenance gates pass, and so does the worker-reasons guard's "is accuracy-critical". It follows `collateralWanted`'s returns to `sess.skip.warn.noAdaPool` and `lj.skip.warn.floorShort`, both critical.
- **The critical list.** `node scripts/i18n-critical.mjs --write`: 475 keys, unchanged.
- **The revert checks.** 25 reverts in 28 runs, all above: the join and the two critic#0 reverts were run again after their tests changed. Each fix's tests fail under its revert. The one survivor (dropping the join) is killed by `ade56570`'s test.
- **Nothing else.** No network, no build, no Playwright.
