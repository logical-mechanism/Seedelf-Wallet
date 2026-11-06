# 1.8.0's release review: the e2e lane's fixes

Lane **e2e**. Branch `review-1.8.0/fix-e2e` in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/e2e`, on `1beba3fb`. Head **`4aa06235`**.

Two commits, two files. No `src/` change, and no key or value changed:
- `691c518a` fix(web-wallet): the e2e's 5 ₳ pool is the head start's where one is bundled, and the 1.5.0 gate holds the v2 pools apart (D6, tests-e2e#1).
- `4aa06235` test(web-wallet): a retired pool's page and a token's list, and mainnet's 5 ₳ pool found later with no Lovejoin page (tests-e2e#2, tests-e2e#3, o-design §5).

How I worked:
- Commands ran from the worktree's `extension/`.
- Logs are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/e2e-lane/`.
- I didn't open `support.ts`, the vectors, the test wallet or any `.env`.
- Nothing reached the network. The new mainnet test answers the data layer and mainnet's giveme.my itself.

## At the base, first (D6)

**The e2e:** `npm run build:ext`, then `npx playwright test --project=extension -g "Lovejoin: |a mix being sent|a session the restore scan found: Home|site session|a site's private session|a site connects to a private session|Settings' Bring every box back" --workers=2`. **8 failed, 5 passed** (`base-e2e.log`).
- **Five time out at `fiveRow`'s 20 s wait for `lovejoin-pool-0eedc4eb…`.** That's FIVE, launched at the head start's height + 1. It's a later launch of the bundled `47bece42…`'s values, so a copy, and no hub lists it.
  - The five: mix in 5 ₳, a mix that stopped partway, without its collateral, Home's row, and a mix being sent.
- **The three site-session returns come back directly.** `site-back-review` reads "Into your private balance44.827855 ₳Network fee0.172145 ₳From2 UTxOs at private session 1IntoNew private UTxOs" where "Through Lovejoin2 boxes of 5 ₳" was expected. The bundled pool held no boxes in the fakes.
- **Passing:** the restore-found session, Settings' Bring every box back, the floor test (mainnet), the connect test, and Mix my boxes again, which ran on the copy.

**The unit gate:** `npx vitest run tests/lovejoin-1-5-0.test.ts --maxWorkers=2`. **2 failed, 2 passed**: the head-start case's two (`base-150.log`).
- `:922`: `shownPools(network).filter(v2)` gives `[{ id: "47bece42…", version: "v2", boxLovelace: "5000000", mixBoxHash: "17d05154…", mixLogicHash: "7a9d5bbf…", feeHash: "bb25ea95…", … }]`, not `[]`.
- `:929` (`finishesRetired`): "bring session 0 back" makes one more read, `credential_utxos … 67ffe4ed…`. That's the classic pool's mix box, once `classicCalls` strips the v2 pool's.

## D6 · fixed

**What changed in `e2e/extension.spec.ts`:**
- `bundledFive(network)` is the v2 5 ₳ ADA pool a network's head start bundles: preprod's `47bece42…`, and none on mainnet. It gives the pool's id and its mix_box.
- `mixBoxOf(pool)`: of the pool's two scripts at the holder, the one its datum names first.
- `fivePool`, where a pool is bundled: the 20 strangers go to its mix_box, and it returns that pool's id. No launch rows, no `tx_info` route. FIVE is launched only where none is bundled (mainnet).
- `fiveBox(network)` is the bundled pool's mix_box, or FIVE's. `inFive` and `madeByFiveMix` use it, and `FIVE_ADDRESS` goes.
- `lookedForFive` goes, with its two calls (in the restore-found test and in `siteSessionHolding40`).
  - On the real head start the look finds nothing new (`{grew: false}`), and the bundled pool needs no look.
  - No test is left that wants the page's look.
- Comments updated: `FIVE`, `HEAD_START`, `fivePool`, `fiveRow`, `madeByFiveMix`.

**What changed in `tests/lovejoin-1-5-0.test.ts`:** the head-start case only, not the `NO_ADA_POOL` pin at `:420`, which is the find lane's.
- `bundledPools(network)`: every pool the file bundles.
- `headStart` hands only the retired ones (`version !== "v2"`). 1.5.0's record can't say what a return into the v2 pool does.
  - That return, given boxes, is tested in `lovejoin-retired.test.ts`'s "takes its spare ADA into v2's 5 ₳ pool…".
- `v2Pools(network)` verifies each v2 pool with WebAssembly, and the case asserts them apart.
  - Each must be a 5 ₳ ADA pool on v2, and preprod must have one.
  - Mainnet's 5 ₳ pool passes once a refresh bundles it. A v2 pool of other values (a token's) fails it, on purpose.
- The case's first title says so. The header comment and two doc comments follow.

**The unit gate's test:**
- At the base: 2 failed (above).
- With the fix: **4 passed**, and **4 passed** with `VITE_ENABLE_MAINNET=false`.
- Revert check, the `headStart` filter alone dropped: **2 failed, 2 passed**. The same two fail, for the same reasons (`revert-150.log`).

**The e2e's test:**
- At the base: 8 failed (above).
- With the fix, the same command: **13 passed** in 2.1 min (`d6-e2e.log`).
- Revert check, `bundledFive` made to return nothing (so FIVE is launched on preprod again, as a copy): **9 failed, 4 passed** (`d6-revert2-e2e.log`). That's the base's 8, plus Mix my boxes again at its new copy pin (tests-e2e#1).

## tests-e2e#1 · fixed

- With `fivePool` on the bundled pool (D6), Mix my boxes again runs in the pool every return goes into, not a copy.
- It's pinned: the test asserts its row has no copy flag (`row.getByTestId("lovejoin-pool-unusable")`, count 0).
- With the base's spec, that row carries the copy's flag: "another pool of this box value was started before this one", as the finder found.
- Under the revert mutant above, it **fails**: `Expected: 0, Received: 1` (`d6-revert2-e2e.log`).

## tests-e2e#3 and tests-e2e#2's e2e half · tested

One new test covers both: `e2e/extension.spec.ts:3611`, "Lovejoin: a retired pool with the wallet's box is listed beside the 5 ₳ pool, withdraw-only: …".

**Its world:**
- The bundled 5 ₳ pool, with its 20 strangers.
- The classic pool's 20 recorded boxes, and a box of the wallet's there (`ownedLovejoinBox`).
- A box of the wallet's in the head start's retired MIN pool of 100 MIN a box (`inBundled`). That gives the hub a second token, so it shows its grid.

**tests-e2e#3, the grid's tiles:**
- MIN's tile has one pool, so it opens that pool's page ("100 MIN + 4.5 ₳"). Back returns to the grid.
- ADA's tile opens ADA's list ("ADA", "2 pools"). It holds the 5 ₳ pool's row and the classic pool's row, with "1 box", flagged retired.
- The classic row opens the classic pool's page ("10 ₳"). Back returns to ADA's list, then to the grid.

**tests-e2e#2, the classic pool's page with the wallet's box:**
- It reads "Your boxes in the pool1 box, 10 ₳".
- Review is disabled, with the retired reason under it (`lovejoin-mix-why`). Mix my boxes again is disabled. There's no Bootstrap link.
- Bring one back now is enabled. Pressed, the worker builds the withdraw and asks giveme.my (`collateralAsked` grows). giveme.my refuses ("refused this transaction"), and nothing is sent.

**The checks:**
- Both findings are tests of guards that already exist, so the test passes at the base: **1 passed** (`ab-base.log`).
- Mutation checks, each with dist rebuilt (`mut2.log`, `mut3.log`):
  - **tests-e2e#2's mutant**, `{!stuck && owned > held && !nowRefused && !isRetired(pool) && (` in `AgainActions`: **fails**, as `getByTestId('lovejoin-now')` isn't found.
  - **tests-e2e#3's mutant**, the token list's `onOpen={() => setView(undefined)}`: **fails**, with the heading "Lovejoin" where "10 ₳" was expected.
  - After each, `Lovejoin.tsx` was put back with `git checkout` and dist rebuilt.

## o-design §5's mainnet "found later" e2e · written; fails at the base by design

The new test is at `e2e/extension.spec.ts:5896`, in "the dApp connector" › "on mainnet, reading Koios alone" (`network: "mainnet"`): "a site session's return finds v2's 5 ₳ pool launched after the head start, with no Lovejoin page, and mixes there".

**Its world:**
- Mainnet's head start bundles no v2 pool.
- `fivePool(…, { network: "mainnet" })` puts FIVE at mainnet's holder, settled, with 30 boxes not the wallet's: `fivePool`'s 20 and 10 more. That's mainnet's floor.
- There's no `lookedForFive`, and Lovejoin's page never opens.
- The data layer is answered "too large", as the Koios-only switch's own test does, until Settings' Koios only is turned on. Nothing reaches it after that.
- Mainnet's giveme.my is answered with a refusal (400, `{"detail":"Transaction Fails Validation"}`), so nothing leaves the machine.
- The session comes from `siteSessionBack(context, koios, page, network)`, which is now `siteSessionHolding40`'s flow from Settings on. Its account's rows sit at the session's mainnet address (`onNetwork`).

**What it asserts:**
- `site-back-review` contains "Through Lovejoin3 boxes of 5 ₳". Three boxes need more than 20 others.
- It also contains "Its 5 ₳ collateralMixed once in Lovejoin's pool of 5 ₳ boxes".
- There's no `lovejoin-skipped`.
- One `credential_utxos` names the holder, and one `tx_info` names FIVE's launch.
- Nothing more is asked of the data layer.
- It skips in a preprod-only build. It also skips once mainnet's head start bundles a v2 5 ₳ pool: a later launch would be a copy, and "found later" is then the unit tests' alone.

**At the base it fails.** That's on the dev build (`ab-base.log`), and 3 of 3 under stress on each build.
- `Expected substring: "Through Lovejoin"`, `Received string: "Into your private balance44.827855 ₳Network fee0.172145 ₳From2 UTxOs at private session 1IntoNew private UTxOs"`.
- A throwaway print shows why (`b-base2.log`). That's O1:
  - `lovejoin-skipped` reads "Lovejoin is left out of this return: Lovejoin has no pool of 5 ₳ boxes to take it yet. Everything comes back directly, unmixed.";
  - the holder is never read;
  - FIVE's launch is never asked.

**With the look, it passes.**
- How I checked: I applied o-design's draft of `adaPool` (its `adaPool` hunk alone) to my worktree's `lovejoin.ts`, rebuilt, ran the test, then reverted with `git checkout` (md5 `ec3a833f…` again) and rebuilt. The draft was never committed.
- Results: **1 passed** (`b-draft.log`). Under stress, 3 of 3 passed on the dev build (`stress-b-draft.log`) and on the store build (`stress-b-store-draft.log`).
- The holder was read once, `credential_utxos?block_height=gt.14139293&…` (mainnet's head start's height less 20), and FIVE's `tx_info` was asked once.
  - The read came at the site's funding review, not at the return's build: its collateral pick runs `siteOutBuild` → `tailReserve` → `collateralPool` → `adaPool`'s ask. The return's build read nothing more.
  - The test counts one read in all. So it passes wherever the find lane's look reads, and fails if the flow reads the holder twice.
- The review then read: "Through Lovejoin 3 boxes of 5 ₳ · 2 waves deep, 12 mixes · … · Its 5 ₳ collateral Mixed once in Lovejoin's pool of 5 ₳ boxes, for 1.007241 ₳".
- With the draft reverted, it **fails** again, as at the base (`b-revert.log`).

## The 44c spec script, checked against the real head start

`tests-e2e-scripts/tests-e2e-44c-spec.py` was written against a simulated pool. Here is each hunk against the real head start: preprod's `47bece42…`, launched at block 5378705, which is also the head start's height.

| Hunk | On the real head start | Taken as |
|---|---|---|
| `HEAD_START`'s type gains `pools` | Holds. | Typed (`BundledPool`). |
| `bundledFive`'s rule: v2, `boxLovelace` 5000000, no token | Finds `47bece42…` on preprod, and nothing on mainnet. | The same. |
| Its mix_box: `hashes.at(-3)` of the datum's `581c` strings | The datum names M `17d05154…`, L `7a9d5bbf…` and the fee `bb25ea95…`, so this gives M. That matches WebAssembly's view (`mixBoxHash` in the gate's diff). It's right for a token pool too, whose datum names its policy first. | `mixBoxOf`: the first of the pool's two scripts that its datum names. Same hash on every bundled pool. |
| `fivePool`'s bundled branch | Holds. It never reads the height. | The same, with the strangers factored out. |
| `FIVE_MIX_BOX` redefined as the bundled box | Holds, but it renames FIVE's own constant. | `fiveBox(network)`. FIVE's two constants are kept. |
| `inFive` at `mixBoxOf(network)` | Holds. | `fiveBox(network)`. |
| `madeByFiveMix`, through the redefined `FIVE_ADDRESS` | Holds. | `fiveBox("preprod")`. |
| `lookedForFive` returns early when preprod bundles a pool | Needed. On the real head start the look finds nothing new (`{grew: false}`), so its assertion would fail. | Dropped, with both of its calls. |

The script doesn't cover:
- the stale comments (`fivePool`'s "No head start bundles one yet", and `fiveRow`'s);
- Mix again's copy pin;
- the 1.5.0 gate.

With all of it in: 13 passed (above).

## Stress

**How:** `taskset -c 0,1`, `--workers=2`, `--repeat-each=3`, on two builds:
- the dev build (`npm run build:ext`);
- the store build (`VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npm run build:ext`; never `npm run package`).

Every test I changed or added ran. CPUs 0 and 1 were shared with other lanes' processes (load average 9 to 12 on 12 CPUs), so this was harder than the owner's 2-CPU standard.

**The 12 changed and new preprod tests:**
- Dev build: **36 passed** in 5.3 min (`stress-dev.log`). Store build: **36 passed** in 5.7 min (`stress-store.log`).
- The slowest, against their 30 s limits: "mix in 5 ₳" at 26.7 s and "four at a time" at 26.5 s. Both are the finder's older margins.
- "A mix … without its collateral" took 31.3 s, under `test.slow()`'s 90 s.
- Test A took 4.4 to 6.3 s.
- "A site session's return … that a lock stopped" took 15 to 19 s on the dev build and 17 to 29.1 s on the store build. The 29.1 s didn't repeat: alone on the store build, 5 more runs took 15.1 to 20.7 s (`stress-lock.log`).

**The mainnet test:**
- At the base, 3 of 3 failed on each build, all with the same direct return (`stress-b-base.log`, `stress-b-store-base.log`).
- With the draft look, 3 of 3 passed on each build: 8.7 to 12.6 s on dev, 7.4 to 12.4 s on store.

dist was last rebuilt from the clean source, as the dev build.

## Awaiting blind back-translation

None: no key or value changed.

## For the lead

**Run the mainnet test again after the merge.** It fails at the base by design, and passes with the find lane's look:
- the command: `npm run build:ext && npx playwright test --project=extension -g "launched after the head start, with no Lovejoin page" --workers=2`;
- if it fails at `expect(holder).toHaveLength(1)` with 2, the merged flow reads the holder twice (say, the funding review's ask and the return's both looking). That's a real double read, not the test.

**The look changes no other e2e.**
- With o-design's draft built in, all 17 Lovejoin e2e tests passed (`draft-all.log`). That's these 12, the connect test, Settings' Bring every box back, Home's restore note, the restore-found session that leaves After a restore, and the mainnet test.
- No test depends on the page alone to find the pool:
  - preprod's tests go into the bundled pool, known from the first read;
  - the mainnet floor test opens the page, whose own look finds FIVE.

**`lookedForFive` is gone.**
- A test another lane wrote at the base that calls it won't compile at the merge. On preprod, drop the call.
- On preprod, `fivePool(context, koios)` now gives the bundled pool with 20 boxes not the wallet's. Preprod's floor is 0, so that pool takes boxes. For a world "where the pool takes boxes" (the connector lane's sibling of the connect test), `fivePool` alone is enough.
- `siteSessionHolding40` keeps its signature.

**The words my tests pin.** None is on another lane's list:
- `lj.unusable.warn.retired`: only "retired". The screens lane drops its last sentence, and "retired scripts" stays.
- giveme.my's refusal: "refused this transaction".
- `lovejoin.boxesOf` ("3 boxes of 5 ₳", not W1's swap keys) and `lovejoin.collateralBox.value`.
- The mainnet test never asserts the words of `noAdaPool` or `floorShort`, which O4 rewords.

**The 1.5.0 gate at a refresh.**
- Once a release bundles mainnet's v2 5 ₳ pool, the gate accepts it: each v2 pool must be a 5 ₳ ADA pool.
- `fivePool(…, { network: "mainnet" })` then gives that pool, and the mainnet test skips itself.
- A refresh that bundles a v2 token pool fails the gate on purpose: nothing says what a return does with it.

**The first unlock's bring-back still has no e2e.** It's the critic's remaining gap, and not on this lane's list in FIXBRIEF.md. A throwaway probe in test A's world (never committed) shows a recipe that works (`probe.log`):
- After the hub's read schedules the two retired boxes, a lock and an unlock run `retireOnce` at the unlock's run.
- `lovejoin-held` then gives `bringing: { back: 0, retired: true, left: 2, why: "giveme.my, which lends the collateral, refused this transaction: …" }`. giveme.my is asked twice, and nothing is sent.
- Settings' Lovejoin page reads "Bringing every box in the retired pools back: 0 boxes sent back so far. 2 boxes left. … The last box that didn't go: giveme.my, … refused this transaction … Stop".

**Seen, not mine:**
- In test A, the classic pool's page shows the whole Mix form, with its cost rows for 10 ₳ boxes, Review disabled under them with the retired reason, and a disabled Mix my boxes again. The page is still withdraw-only.
- Whether that much text belongs on a page every 1.7 user lands on is for the screens lane or the owner.

**Edits outside my lane I'd make:** none.

## Checks run

- `npx tsc --noEmit -p .`: clean, at each commit and at the head.
- Unit tests: `npx vitest run tests/lovejoin-1-5-0.test.ts tests/i18n*.test.ts tests/words.test.ts tests/worker-words.test.ts --maxWorkers=2`.
  - **11 files, 195 passed**, and the same with `VITE_ENABLE_MAINNET=false`.
  - A grep of `tests/` finds no other unit file that reads the e2e spec or the gate.
- Playwright (`--project=extension --workers=2`), on the dev and store builds:
  - the base's 8 failed and 5 passed; with the fix, 13 passed;
  - the two new tests: the retired-pool test 1 passed, and the mainnet test failing at the base by design;
  - the stress counts above.
