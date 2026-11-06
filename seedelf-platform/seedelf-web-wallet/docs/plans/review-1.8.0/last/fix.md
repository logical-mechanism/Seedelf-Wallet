# 1.8.0's release review, the last look: the last fixer's fixes

This covers the five findings of the last look's code part ([last-code.md](last-code.md)), each a test gap, a comment or a test's name, and the two code comments the docs part's trace found ([last-docs.md](last-docs.md), last-docs#0). The merged code was right in each, so **no behaviour changed**.

- **Branch:** `review-1.8.0/last-tests`, head `954183019e61ea544410a333b81b49555fb04d11`, five commits on `4ad4dc06` (the merged head):
  - `a6a082a4` test(web-wallet): a review's collateral look under the floor, at its ask, and where no new box goes (last-code#0)
  - `d0ec9f65` test(web-wallet): the pools' read times after a Stop, minute by minute (last-code#1)
  - `3057c5a0` test(web-wallet): a review's failed look takes the wallet's last "no", and the older sub-case says what it holds (last-code#2)
  - `48d37f1d` docs(web-wallet): the hub's takes comment, and the deposit caps' comments on v2's 64 (last-code#3, last-docs#0)
  - `95418301` test(web-wallet): share's P1 test named for what the dialog says now, and holding its count (last-code#4)
- **Worktree:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/share`. Every command below runs from its `seedelf-platform/seedelf-web-wallet/extension`.
- **Files changed:**
  - Tests:
    - `tests/connector-lovejoin-review-fixes.test.ts` and `tests/lovejoin.test.ts` (#0);
    - `tests/lovejoin-round2-retire.test.ts` (#1);
    - `tests/lovejoin-round2-sessions.test.ts` and `tests/collateral-reserve-review-fixes.test.ts` (#2);
    - `tests/lovejoin-share-review-fixes.test.ts` (#4).
  - Comments only:
    - `src/ui/screens/Lovejoin.tsx`: the hub's `takes` comment (#3);
    - `src/background/lovejoin.ts`: `MAX_DEPOSIT_BOXES`'s doc and fanOut's `fit` comment (last-docs#0).
- **The sources' programs are HEAD's.**
  - Each source parses to the same program as at `4ad4dc06`, positions and comments aside. I parsed both versions with rolldown's `parseSync` and compared the serialised ASTs: identical for `lovejoin.ts` and `Lovejoin.tsx`, with 1,221 and 457 comments before and after.
  - I ran that check again after the mutant runs, so no mutant was left behind.
  - Every changed source line is a comment line (`git diff -U0`).
- **Nothing else changed:** no i18n key, screen, schema, storage shape, request or migration.

## How each check ran

My scripts are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last-fix-work/`, and their logs in `…/last-fix-work/logs/`.

- **`mutate.py <spec>`** is the reviewer's `last-code-mutate.py`, rewritten for this worktree and its own logs. For each mutant it:
  1. makes one exact replacement (each must occur once);
  2. runs the files with `npx vitest run <files> --maxWorkers=2`, with `VITE_ENABLE_MAINNET=false` where the spec says;
  3. restores the source and checks its sha256 against the file as it was.

  Every run below says `restored: true`. The specs are `lc0-touched.json`, `lc1-file.json`, `lc2-touched.json`, `lc4-share.json`, and `full.json` (every mutant over its whole file set, on both builds).
- **`at-base.py <label> <files> [-- args]`** swaps in `4b4628e9`'s `sessions.ts` and `lovejoin.ts`, runs the files, puts the worktree's back and checks the sha256.
- **`clean.sh <label> <VITE_ENABLE_MAINNET>`** runs the clean sets.
- **The reviewer's and tracers' files** were read and never edited: their runner and specs (`last-code-work/`), and their scratch tests (`last/last-code/…/tests/last-code-*.test.ts`, `trace-last-code-*`). What I took from them I moved into the committed files by hand, leaving out their `console.log`s, scaffolding and unused imports.
- **The gaps** (each old test passing under its mutant) come from the reviewer's runs, in `…/scratchpad/last-code-work/logs/`:
  - x2, x3, x4 and x14: **273 passed (273)** over the 10 review files;
  - x12 and x13: **173 passed (173)** over the 14 Bring/retire files;
  - x1: 1 failed, the sub-case, which stays.
- **There's no fix to revert:** each finding is test-only. Each pin's check is that it passes clean and fails under the finding's mutant, on both builds.

## last-code#0: pinned, in the trace's smaller form

**What changed:** I added assertions to the four existing tests whose titles already promise these states, each with a comment citing last-code#0. There's no new test and no shared predicate (*For the lead*, 1).
- `connector-lovejoin-review-fixes.test.ts`:
  - `:199` "a pool discovery hadn't kept, found as Review asks for it, as a return's build asks: marked": `collateralMix` is `"ifLeft"` and `collateralReserve` is `"2800000"`. This pins the ask.
  - `:211` "a pool under the network's floor (mainnet's 30, set on preprod): hedged": `collateralReserve` and `collateralMix` are undefined. This pins the floor at a site's funding review.
  - `:233` "a pool that takes no new box now (usableNow): hedged": the same two. This pins usableNow, the trace's aside (x4).
- `lovejoin.test.ts:2526` "reads the pool at Review alone, … while the pool is under its floor": `out.collateralReserve` and `out.collateralMix` are undefined. This pins the floor at a swap's Review.

**Tests.** The mutants hit collateralRoom, at `lovejoin.ts:4325–4335` on this head (`:4322–4332` at `4ad4dc06`). Their exact strings are in `full.json`.

| Mutant | Old tests (reviewer) | Clean | The 2 touched files | The 10 review files, default and `VITE_ENABLE_MAINNET=false` |
|---|---|---|---|---|
| x2: `this.floorShort(network, room.others) \|\|` dropped | 273 passed | pass | **2 failed**: connector `:211`, `expected '2800000' to be undefined`; lovejoin.test `:2526`, `expected '1500000' to be undefined` | **2 failed** \| 272 passed (274), those two, on both |
| x3: `adaPool(network)` for `adaPool(network, true)` | 273 passed | pass | **1 failed**: connector `:199`, `expected undefined to be 'ifLeft'` | **1 failed** \| 273 passed (274), that one, on both |
| x4: `this.usableNow(…)` dropped | 273 passed | pass | **1 failed**: connector `:233`, `expected '2800000' to be undefined` | **1 failed** \| 273 passed (274), that one, on both |

- **Clean:**
  - `npx vitest run tests/connector-lovejoin-review-fixes.test.ts --maxWorkers=2`: 22 passed (22).
  - `npx vitest run tests/lovejoin.test.ts -t "under its floor" --maxWorkers=2`: 1 passed.
- **Mutants:** `python3 -I mutate.py lc0-touched.json` for the touched files, then `python3 -I mutate.py full.json`.
- **Why not the finding's form** (two new cases in round2-sessions): these four assertions reach the same states and kill the same mutants, and x4 as well.

## last-code#1: pinned, with all four of the scratch's cases

**What changed** in `lovejoin-round2-retire.test.ts`, inside r2-critic#0's describe:
- **Helpers**, added after `minutesUntilShown`. No import was added.
  - `listings`: the wallet's pool listings, meaning credential_utxos calls that name the classic pool's mix box.
  - `KEEP`: `SPENT_KEEP_MS / 60_000`.
  - `minutesRead`: runs the wallet a minute apart and returns the minutes at which the pools were listed. It takes an optional call made as each minute starts.
  - `plainRun`: two classic boxes with their due times, `retired` set an hour back, and Settings' Bring every box back asked.
- **Four cases.** Each counts listings a minute apart until an hour past SPENT_KEEP_MS (`KEEP + 60` minutes), with the minute marks taken from `KEEP`:

| Case | Line | Expects | Kills |
|---|---|---|---|
| 1. Settings' Stop of the retired run after one withdraw that lands | `:307` | `[1]` | An always-re-arm of my own: `if (…counted…) recheck = now + SPENT_KEEP_MS; else delete s.recheck;` → `s.recheck = now + SPENT_KEEP_MS;`. Fails with `expected [ 1, 121 ] to deeply equal [ 1 ]` |
| 2. The same, with Koios still listing that withdraw's box for half an hour | `:319` | `[1, KEEP + 1]` | The lane's `norearm`, a second kill beside `:194`'s: `expected [ 1 ] to deeply equal [ 1, 121 ]` |
| 3. A plain Stop of Bring every box back after one withdraw | `:337` | `[KEEP]` | **x12** (`?? Infinity` → `?? 0` in stopBringingAllBack): `expected [ 1 ] to deeply equal [ 120 ]` |
| 4. The run's own stop of Bring every box back after one withdraw, giveme.my answering 503 for three runs | `:350` | `[KEEP]` | **x13** (`?? Infinity` → `?? 0` in bringNoted's own stop): `expected [ 1 ] to deeply equal [ 120 ]` |

- **Where they differ from the scratch:** case 3 asserts that its run sent one withdraw (`toHaveLength(1)`), where the scratch only logged it. Case 4 asserts that the run stopped itself (`bringing: { back: 1, stopped }`), as the scratch did.
- **Clean:** `npx vitest run tests/lovejoin-round2-retire.test.ts --maxWorkers=2`: 13 passed (13).
- **Mutants on that file** (`python3 -I mutate.py lc1-file.json`):

  | Mutant | Result |
  |---|---|
  | x12 | 1 failed (case 3) |
  | x13 | 1 failed (case 4) |
  | norearm | 2 failed (`:194`, case 2) |
  | always-re-arm | 1 failed (case 1) |
  | **x5** | **13 passed**: it survives, as the trace found (*For the lead*, 2) |

- **Over the 14 Bring/retire files** (`full.json`), each result the same on the default build and with `VITE_ENABLE_MAINNET=false`:

  | Mutant | Result | Failing tests |
  |---|---|---|
  | x12 | **1 failed** \| 176 passed (177) | case 3 |
  | x13 | **1 failed** \| 176 passed (177) | case 4 |
  | norearm | **2 failed** \| 175 passed (177) | `:194`'s test, case 2 |
  | always-re-arm | **1 failed** \| 176 passed (177) | case 1 |
  | x5 | 177 passed (177) | none |

## last-code#2: pinned; the sub-case kept and its comment corrected

**What changed:**
- **The new case**, at `lovejoin-round2-sessions.test.ts:395`, the end of r2-worker#1's describe: "mainnet, the pool's last count under its floor and every read of it failing: a site's funding review says nothing of its collateral's mix".
  - It is the scratch's mainnet crowd case, on the file's own `device()`.
  - Setup: the data layer's crowd for v2's 5 ₳ pool is set to 20, and `lookForPools` finds the pool. `collateralPoolTakes` returning "no" is asserted as the precondition. Then the token feed answers 503, and Koios answers 500 for the pool's boxes.
  - What happens: `siteOutBuild`'s look fails (rooms() fails, so collateralRoom returns "failed"). tailReserve then asks collateralPoolTakes, and the crowd says no.
  - It asserts that `collateralReserve` and `collateralMix` are undefined.
  - I broke its long fetch line the way the house breaks a ternary.
- **The sub-case**, `collateral-reserve-review-fixes.test.ts:1219–1232`: its code is unchanged, kept as collateralRoom's free-room pin. Its comment now says:
  - the read is kept, so the Review reads nothing again, and the look answers from it: one free box under the two draws, which is the free check it holds;
  - `fiveDown(one)` is never met now. It stays for a look that reads the pool afresh, as before r2-worker#1: that read would fail, and the kept read's "no" would say nothing;
  - the look that fails now is round2-sessions' mainnet case.

  The Danogo half (R3-10) has its own line ("nothing said, its read failing"), since the old shared "the read failing or not" now holds only for it.

**Tests:**

| Mutant | Old tests (reviewer) | Clean | The 2 touched files | The 10 review files, default and `VITE_ENABLE_MAINNET=false` |
|---|---|---|---|---|
| x14: in tailReserve's failed look, `(await lovejoin.collateralPoolTakes(network)) === "no" ? { reserve: 0n } :` dropped (`sessions.ts:4833`) | 273 passed | pass | **1 failed**: round2-sessions `:410`, `expected 'ifLeft' to be undefined` | **1 failed** \| 273 passed (274), the new case, on both |
| x1: collateralRoom's `\|\| room.free < TAIL_DRAWS` dropped | 1 failed (the sub-case) | pass | **1 failed**: collateral-reserve `:1230` (the sub-case), `expected 'ifLeft' to be undefined` | **1 failed** \| 273 passed (274), the sub-case, on both |

- **Clean:** `npx vitest run tests/lovejoin-round2-sessions.test.ts tests/collateral-reserve-review-fixes.test.ts --maxWorkers=2`: 42 passed (42).
- **Mutants:** `python3 -I mutate.py lc2-touched.json`, then `full.json`.
- **Why this case and not the trace's preprod mix-review arm:**
  - It's the finding's own scenario: mainnet, from the 5 ₳ pool's launch until it holds 30 boxes.
  - It's a review without draws, which is the look round two changed.
  - The file's `device()` already wires discovery's crowds and the covered token feed.
  - It runs on both builds.

## last-code#3: fixed (a comment)

At `Lovejoin.tsx:1941–1947`, "…; below the minimum counted as taking them (…r2-screens#3)" now reads "…; one below the minimum was counted as taking them (1.8.0's review of its fixes, r2-screens#3)", in the finding's words. I reflowed the rest of the comment to the house's width without changing its words. The rule itself is pinned already: per last-code's evidence, the lane's R3 mutant fails 2 tests in r2-screens#3's case.

## last-code#4: fixed (the name) and pinned

**What changed** in `lovejoin-share-review-fixes.test.ts:465`:
- The test is renamed "with 10, and with 16, where the chain makes one box, as the dialog says, to leave that mix its draws: mixed, as built", in the finding's words.
- I added `` expect(cost?.boxes, `${strangers}`).toBe(back.lovejoin?.boxes) ``, carrying the loop's message as its neighbours do, with a comment citing r2-worker#0 and last-code#4.

**Tests:**
- **Clean:** `npx vitest run tests/lovejoin-share-review-fixes.test.ts --maxWorkers=2`: 22 passed (22).
- **r2-worker#0 undone**, with `4b4628e9`'s `sessions.ts` and `lovejoin.ts` swapped in (`python3 -I at-base.py share-new tests/lovejoin-share-review-fixes.test.ts -- -t "with 10, and with 16"`):
  - the new test: **1 failed**, `16: expected 2 to be 1` (the dialog's two against the return's one), after the old `collateralMix` line had passed;
  - the same with `VITE_ENABLE_MAINNET=false` (`share-new-preprod`): the same failure;
  - HEAD's version of the test at the same base, run from a temporary copy (`tests/last-fix-share-head.test.ts`, removed afterwards): 1 passed.

  So the old test couldn't see the bug, and the new line does.
- **The lane's `w0-hold-dropped`** (stopCost's `price(counted)`, unheld; `python3 -I mutate.py lc4-share.json`): 1 failed, but at the old `collateralMix` line (`16: expected 'ifLeft' to be 'mixed'`), which comes first on the merged code. That's why the base swap is what shows the count line working.

## last-docs#0's code comments: fixed (comments only)

In `lovejoin.ts`:
- **`MAX_DEPOSIT_BOXES`'s doc** (`:1759–1768`) now reads:
  - "The most boxes one deposit into the classic pool makes", keeping its measured 150-byte reason;
  - that pool is retired (chunk 44), and the wallet makes every deposit into a pool on v2's scripts: 64 boxes at most in any of them, an ADA pool's too (MAX_TOKEN_DEPOSIT_BOXES);
  - past that, a return's spare ADA comes back with its change (final review lovejoin-5; 1.8.0's release review, last-docs#0).
- **fanOut's `fit` comment** (`:3737–3740`) now reads "one deposit makes (MAX_TOKEN_DEPOSIT_BOXES, 64, in any pool on v2's scripts, an ADA pool's too; MAX_DEPOSIT_BOXES, 96, was the classic pool's, retired)", as architecture.md:673 now says it.

## Awaiting blind back-translation

None: no i18n value changed.

## For the lead

1. **A backlog line**, as the brief's "No shared predicate" puts it: collateralRoom and collateralPool sharing one precondition (the ask, usableNow, the floor, and TAIL_DRAWS over `{others, free}`), keeping these pins, as last-code#0's trace describes it. It touches the build's collateralPool, so I didn't do it here.
2. **x5 still survives.** x5 re-arms for any box listed and held as spent, not only one that a withdraw of that run went for.
   - All four retire cases pass under it, and so do the 14 files, as last-code#1's trace found.
   - So fix2/retire.md's "only while one of that run's withdraws is still listed and held as spent" is held for a landed withdraw against a listed one. It isn't held for the run's withdraws against any held box.
   - By reading (last-code's *Not checked*), the two differ only where a recheck read meets a Mix my boxes again chain that's all sent and still landing.
3. **Two neighbouring comments say "a token pool's" where they mean any pool on v2's scripts:**
   - MAX_TOKEN_DEPOSIT_BOXES's doc: "The most boxes one deposit into a token pool makes" (`lovejoin.ts:1775–1779`);
   - mostBootstrap's: "one deposit's, a token pool's or the classic pool's" (`:1782`).

   Both are true of the token pools they name, but imprecise in the same way since 1.6.0's MONEY-6. They're outside the two comments this brief named, so I left them.
4. **The plain-Stop cases' window.** `plainRun`'s boxes are due 5 and 6 hours on, which is past the cases' `KEEP + 60` minutes at today's SPENT_KEEP_MS (2 h). A SPENT_KEEP_MS of 4 h or more would bring those due reads into the window, and the cases would then need their due times moved.
5. **Nothing for the merge.** Every change is in a file only this pass touched.

## Checks run

- **Typecheck:** `npx tsc --noEmit -p .`: exit 0, no output, run again at the committed head.
- **Clean runs** (`clean.sh`), `--maxWorkers=2`, on the default build and with `VITE_ENABLE_MAINNET=false`:

  | Set | Both builds |
  |---|---|
  | The 10 review files (below) | **274 passed (274)**: 273 before, plus the new crowd case |
  | The 14 Bring/retire files (below) | **177 passed (177)**: 173 before, plus the four cases |
  | lovejoin-screens-review-fixes-1-8-0, plus 8 other files the reviewer ran x2 and x3 over (below) | **367 passed (367)** |
  | `tests/i18n*.test.ts`, `tests/words.test.ts`, `tests/worker-words.test.ts` (10 files) | **194 passed (194)** |

  - The 10 review files: collateral-reserve-review-fixes, connector-lovejoin-review-fixes, lovejoin-share-review-fixes, lovejoin-round2-sessions, swap-lovejoin-way, lovejoin-found-later, run-traps-review-fixes, lovejoin-chain-review-fixes, lovejoin, approvals-review-fixes.
  - The 14 Bring/retire files: lovejoin-round2-retire, lovejoin-bring-review-fixes, lovejoin-crediting-review-fixes, lovejoin-bring-all-back, spent-clock-review-fixes, lovejoin-retire-review-fixes, lovejoin-retired, unlock-waits, lovejoin-due-times, lovejoin-withdraw-submit, withdraw-resend-unlock, lovejoin-own-wait, lovejoin-bring-screen-review-fixes, home-review-fixes.
  - The third set: lovejoin-screens-review-fixes-1-8-0 (which covers the hub's comment), then i18n-worker-reasons, lovejoin-planner, lovejoin-screens-review, screens, sessions, lovejoin-1-5-0, session-collateral, dapp.
- **Mutants** (`full.json`): 20 runs, each over its whole set, on both builds, all restored (sha256). Each one killed exactly the pins named above:
  - x1 and x3, x4, x14: 1 failed over the review files;
  - x2: 2 failed over the review files;
  - x12, x13 and always-re-arm: 1 failed over the Bring/retire files;
  - norearm: 2 failed over the Bring/retire files;
  - x5: 0 failed, as expected.
- **Base swaps:** the share pin on both builds; HEAD's share test at the base, on the default build.
- **What I didn't touch:**
  - no network, no Playwright, no build;
  - support.ts, the vectors, the test wallet and every `.env` never opened;
  - no formatter.
