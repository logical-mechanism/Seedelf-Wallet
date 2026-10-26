# Fixer `fx-tests`: the tests the review of the fixes asked for (round 3b, lane Z)

Findings R3-17, R3-18, R3-19 and R3-20, and the rest of R3-1.

- **Tests only.** No source line changed, no key, no Rust.
- **Nothing waits for a rebuild.**
- **Every mutation ran in a copy** of the extension in the scratchpad, never in the shared tree. Each run re-synced the copy from the tree, before it and after.

## Findings

| id | status | change |
|---|---|---|
| R3-17 | fixed | **The head-start case's `classicAfter` normalizes the Koios requests rather than deleting them** (new `classicCalls`):<br>• the shown pools' mix boxes come out of each `credential_utxos` that names them;<br>• in the return's step, its read of the pools for the collateral's 5 ₳ pool goes;<br>• in the hub's status read and the restore's, the one `epoch_params` a token pool's read adds goes.<br>**What's left is compared with 1.5.0's exactly, step by step**: every `tx_status`, `tx_info`, `utxo_info`, `submittx` and read of the wallet's own credentials. A read of the shown pools alone fails it too, since it leaves one naming nothing. **The shown pools come from the bundled head start** (`shownMixBoxes`, through `wasm.lovejoinVerifyPool`), so `npm run lovejoin-pools` carries over. Today that's three pools, not the finding's two: 8cd8ce08's refresh added one. **All four case bodies are untouched**, the x-compat#2 case's too: the change is in its helper. |
| R3-18 | fixed | **`nearly()` gives MEASURED_SLACK only under `.returns[`**: a return's review and chain, which are measured. Everything else is compared exactly: the funding grid, the plans, the swap and Stop. So both plans cases, the original and x-compat#2's, hold the planned funding grid to the lovelace, with neither case's body changed. MEASURED's comment now names the `lovelace` that really is measured. |
| R3-19 | fixed | **314-wasm#0's test loops over all six steps**: runAll, pumpPublic, watch, parts.pump, withdrawDue and returning. `runner()` gained `parts.pump`, and records each step asked, in order. **Each case checks** that the run asked every step up to the one that trapped and nothing after, beside `trapped()` once and the alarm off. |
| R3-20 | partly | **New `tests/screens-wiring-review-fixes.test.ts`**: 24 tests over the house's `vi.mock("react")` seam, with no new dependency. They run the real screens, with their effects and handlers. **They pin every wiring CONFIRMED.md names, but Home's.** They also pin round 3b's wirings that their fixers called unreached, and 320-screens#3's other three Send buttons. **Home's two-window watch (Home.tsx:367–368) isn't pinned**: its decision runs after `await call("pending-tx")`, which a static render can't reach. It needs the e2e case the skeptic named (docs to update, 4). |
| R3-1 | fixed (the rest) | **fx-reserve-1 made the props required.** A wrong expression still typechecked (`summary={{}}`), and #323's reserve row and the `forSite`/`paid` subtractions had no test. **The same file now renders the real site funding review (ConnectRequest) and the real top-up (SiteSession → TopUp)** from summaries with the reserve, with the 5 ₳ pool alone, and with neither. It asserts:<br>• the site's figure less the reserve;<br>• the reserve row;<br>• the way back's mix row and its both-ways total;<br>• the note keyed on reserve-or-pool.<br>No export refactor of a money screen. |

## The screen harness (R3-20)

The skeptic's design, in one file:

- **Effects run during `renderToStaticMarkup`.** `useEffect` and `useLayoutEffect` run during the render, for the component under test only. A child's or a custom hook's never runs: the caller is read from the stack.
  - Each runs again only when its dependencies change, after the last run's cleanup, as React does.
  - Their `setState` calls land as React's own render-phase updates, in the same render.
- **`call` hands back synchronous thenables**, so an effect's `.then` lands in the same render.
  - A request the test doesn't answer never settles.
  - A late answer (`seam.late()`) settles when the test says, inside the render.
- **`on(match, act)`** does something once, inside the render that makes the first matching element: a press (a prop handler), a timer's tick (`vi.advanceTimersByTime`, with fake timers), or a late answer.
  - It goes through the JSX runtime, so it catches a component in its own module too (AgainSwitch, BringAllBackView, WaitingFoot).
  - `seam.stubbed` renders a review's body as nothing, where only its wiring is under test.
- **`seed(after, value)`** starts a state only an awaited answer reaches (a built review): the useState right after a run of states with the given starting values. If that slot doesn't start empty, a state was added or moved there, and the test throws rather than passing quietly. `seedInitial` replaces a choice made on the page, such as the Mix form's side.
- **What a press does after an `await` doesn't run here.** That stays with the rules' own tests (widthTurned, bringFollower, lookAgain). These tests pin what the screen does up to that point.

## Tests and mutation checks

### Fail-before

Each finding is a missing test, and today's code is right, so each test passes on today's tree. The fail-before is the mutation: revert the guarded line, see the old tests pass, then see the new test fail.

- **Before:**
  - for R3-17, R3-18 and R3-19, the old test file was taken from HEAD into the copy (`git show`);
  - for R3-20 and R3-1, this round's file was left out of the copy, and every existing test file importing one of those screens was run: 49 files, 863 tests.
- **After:** the new tests, in the copy, with the same mutation.
- **Logs** are in the scratchpad: `fx-tests-gate-mutations.out`, `fx-tests-gate-2.out`, `fx-tests-r3-20-mutations.out`, `fx-tests-r3-20-before.out`, and `fx-tests-mutations-*.log`. The runner is `fx-tests-mut.py`, and the specs are `fx-tests-*.json`.

### R3-17 and R3-18: `tests/lovejoin-1-5-0.test.ts`

- **R3-17's test** is the case "finishes a 1.5.0 vault left mid-flight by an update as 1.5.0 did, its sends and schedules alike, and a restore finds what 1.5.0's found", with the head start shown, through `classicAfter` and `classicCalls`.
- **R3-18's tests** are both cases "plans every return and mix …", through `nearly()`.

| mutation (in the copy) | before (HEAD's gate) | after |
|---|---|---|
| m17, R3-17's own: `ours()` sends a `utxo_info` naming every box of the wallet's whenever a non-classic pool is read | 4 of 4 pass | **the head-start trace case fails:** `expected { Object (trace, restored) } to deeply equal …`. A probe counted 12 `utxo_info` requests naming the wallet's boxes, 11 in the trace and 1 in the restore, as the skeptic found |
| m17b: the pools read one at a time, each read naming one pool | 4 of 4 pass | the head-start trace case fails, the same line |
| xc1: +1 lovelace on every funding where the 5 ₳ pool is shown | 4 of 4 pass | **the head-start plans case fails:** `expected [ …(36) ] to deeply equal []`, one for each preprod funding that makes mixes |
| gp1: every funding plan ×1.004 | 4 of 4 pass | **both plans cases fail:** `expected [ …(84) ] to deeply equal []` |
| +1 lovelace on every funding | not run | both plans cases fail, 84 each |

On today's tree, all four cases pass on both builds.

### R3-19: `tests/run-traps-review-fixes.test.ts`

The test is "a trap under the worker's runs (1.6.0's release review, 314-wasm#0)" › "locks the wallet, as a page's request does, and runs nothing more on the broken instance, whichever step traps (R3-19)". It runs for both of w-left's traps.

| mutation: the catch back to a plain catch-all | before (HEAD's test file and runs.test.ts) | after |
|---|---|---|
| wr1: `runAll(…).catch(() => false)` | 12 of 12 pass | `AssertionError: runAll: expected "vi.fn()" to be called 1 times, but got 0 times` |
| wr2: `pumpPublic(…).catch(() => false)` | 12 of 12 pass | `pumpPublic: expected "vi.fn()" to be called 1 times, but got 0 times` |
| wr3: `parts?.pump(…).catch(() => true)` | 12 of 12 pass | `pump: expected "vi.fn()" to be called 1 times, but got 0 times` |
| wr4: `returning(…).catch(() => false)` | 12 of 12 pass | `returning: expected "vi.fn()" to be called 1 times, but got 0 times` |
| wr5 and wr6: the watch's and withdrawDue's catches, already tested | — | each still fails, under its own step's name |

### R3-20 and R3-1: `tests/screens-wiring-review-fixes.test.ts`

32 mutations, each run against the new file and against the 49 existing screen test files without it.

| finding | test (describe › case) | mutation | before | after (failure) |
|---|---|---|---|---|
| 309#0 | the Collateral page's watch › "opened in place … asks only for the status" (and "from Settings … asks about its payment itself") | c1 `const inPlace = false && !!onSent` | 863 of 863 pass | `expected [ 'collateral', 'balances', …(1) ] to deeply equal …`: it asked pending-tx |
| 309#1's leftover | › "pays again from its late payment's button as Set collateral pays …" | c2 `onAgain={onBack}` | 863 of 863 pass | `expected [ 'collateral', 'balances', …(1) ] to include 'collateral-build'` |
| gap-3#6 | the lock countdown › "asks whether a payment's parts wait while it shows …" | l1 the `parts-waiting` ask removed | 863 of 863 pass | `expected [ 'lock-deadline', …(2) ] to deeply equal [ 'lock-deadline', …(3) ]` |
| 320-screens#2, 321-lj-screens#3, 323-worker#0, R3-7 | a pool's Mix form › "counts its collateral's reserve in the form's figures where this many boxes leave room for it …" (16.8 ₳ in, the reserve row, 22.05 ₳ total, the mix's cost row) and "offers the box the balance pays without it … one line saying so …" (15.3 ₳, 20.55 ₳, the line) | p1 `tailReserveOf(…)` → `0n` | 863 of 863 pass | both fail: `expected '15.3 ₳' to be '16.8 ₳'`, and `… to contain 'At this many, its 5 ₳ collateral is m…'` |
| | | p2 `mixCosts(funding, source, box)`, without the tail | 863 of 863 pass | `expected '15.3 ₳' to be '16.8 ₳'` |
| R3-7 | | p3 `<CollateralIfLeft shown={false} />` | 863 of 863 pass | the line's case fails |
| 321-lj-screens#1, R3-27 | › from the public account › "shows what a mix can spend once the account's UTxOs answer …" (60 ₳ of ADA alone, not Home's 110 ₳) | p5 `publicSideOf(cardano, undefined, …)` | 863 of 863 pass | all three public cases fail: `expected 'In your public account 110 ₳' to be 'What Lovejoin can spend from your pub…'` |
| R3-27 | | p6 the Mix form's HeldOnSide without `mixable` | 863 of 863 pass | `expected 'In your public account 60 ₳' to be …` |
| R3-26 | › "says what a mix can spend where it can't pay for a box …" | p7 `cantAffordPublic(…, false)` | 863 of 863 pass | the words differ: "holds" for "a mix can spend" |
| R3-14, R3-27 | › "on the Bootstrap form too, which leads below the floor" | p8 `bootstrapSide` on Home's figure | 863 of 863 pass | fails |
| | | p9 the Bootstrap form's HeldOnSide without `mixable` | 863 of 863 pass | fails |
| R3-3 | › "names, in the escape hatch's question, the account whose box it takes where every box it can take is another's" | h1 `<PaidQuestion account={undefined} …>`, which typechecks | 863 of 863 pass | `… to contain 'Paid from Account 2, one of its UTxOs…'` |
| 320-screens#4 | › Mix my boxes again's switch › "builds the review again at four, the page's width taken only once that review is in, and says it's building" | a1 `setFour(fourNow)` first, then the rebuild, as before the fix | 863 of 863 pass | `expected [ { boxes: 1, width: 3 }, …(1) ] to deeply equal [ { boxes: 1, width: 3 } ]`: the page asked its funding at four |
| | › "from the public account's review the same" | a2 the same, on the public branch | 863 of 863 pass | the same |
| 320-screens#3 (PoolPage's Send) | both of the above | a3 `rebuilding={false}` on the review's Send | 863 of 863 pass | `… to contain 'Building…'` |
| 321-lj-screens#6 | Bring every box back now's page › "in Settings, says one pool's run that ended with nothing sent left nothing in that pool …" | b1 `donePool={false}` | 863 of 863 pass | `expected 'Nothing of yours was left in Lovejoin…' to contain 'Nothing of yours was left in that poo…'` |
| L2 | › "says a run Stop stopped on another page is stopped, with the worker's count, never Done" (Settings and a pool's page) | b2 `doneStopped={false}` | 863 of 863 pass | `Settings: expected 'Done: 3 boxes back in your private ba…' to contain 'Stopped: 3 boxes sent back.'` |
| | | b3 `setDone` dropping `stopped` | 862 of 863 pass; the other is restore-scan's C41/C47 timing out at 5 s, which isn't this (notes) | the same |
| 321-lj-worker#4 | › "shows a run its page covers that's late on the chain …" | b5 a page following every pool's runs alone | 863 of 863 pass | `Settings: expected 'Every box in every pool, without the …' to contain 'One isn't on chain after 10 minutes.…'` |
| 321-lj-screens#0 | › "drops a read sent before Stop that answers after it …" | b4 the ask bypassing `follow.current.press` | 863 of 863 pass | `expected 'Bringing every box back: 2 boxes sent…' to contain 'Bringing every box back: 1 box sent b…'` |
| 320-screens#3 | the swap form › "says Building, not Sending, while the approval's switch builds the funding again" | s1 `rebuilding={false && rebuilding}` | 863 of 863 pass | `expected 'Review the swap Nothing is sent until…' to contain 'Building…'` |
| 320-screens#3 (the returns' Send) | › "says Building, not Sending, on a session's return while its switch builds it again, a swap's or a site's" | s5 the site's return: `rebuilding={false}` | 863 of 863 pass | `a site's: expected 'Review the return Nothing is sent unt…' to contain 'Building…'` |
| | | s6 a swap's return: `rebuilding={false}` | 863 of 863 pass | `a swap's: … to contain 'Building…'` |
| R3-12 | › Max pressed before any quote › "follows the amount down to Max once the quote keeps the reserve aside" (37 → 35) | s2 the follow effect off | 863 of 863 pass | `expected '37' to be '35'` |
| | | s3 Max's button never sets `maxed` | 863 of 863 pass | `expected '37' to be '35'` |
| | › "leaves an amount typed after Max as typed" | s4 typing leaves `maxed` set | 863 of 863 pass | `expected '35' to be '36'` |
| R3-1 (323-worker#1, #6, R3-9) | a site's funding › "pays the reserve: the site's figure less it, its own row, the mix in the way back's fees, the 5 ₳ said mixed" and "without it, counts no mix …" | r1 `summary={{}}`, which typechecks | 863 of 863 pass | both fail: `expected undefined to be '1.5 ₳'`, and the mixed note missing |
| | | r2 `<CollateralReserveRow reserve={undefined} />` | 863 of 863 pass | `expected undefined to be '1.5 ₳, and what it doesn't use comes…'` |
| | | r3 `forSite` without the subtraction | 863 of 863 pass | `expected '25.5 ₳' to be '24 ₳'` |
| R3-1 (323-worker#6, R3-9) | a site's top-up › "pays the reserve: the top-up less it, its own row, the new 5 ₳ said mixed …" and "without it …" | r4 `<TopUpCollateralNote summary={{}} />` | 863 of 863 pass | both fail, on the note's words |
| | | r5 the top-up's reserve row off | 863 of 863 pass | `expected undefined to be '1.5 ₳, …'` |
| | | r6 `paid` without the subtraction | 863 of 863 pass | `expected '25.5 ₳' to be '24 ₳'` |

## Files touched

- `extension/tests/lovejoin-1-5-0.test.ts`:
  - the header's last paragraph;
  - MEASURED's comment, `MEASURED_IN` and `nearly()`'s condition (R3-18);
  - `shownMixBoxes`, `classicCalls` and `classicAfter` (R3-17);
  - the four cases are untouched.
- `extension/tests/run-traps-review-fixes.test.ts`: the first describe's `runner()`, its `ORDER`, and its first test's loop and name (R3-19). fx-lj-2's L3 describe in the same file is theirs.
- `extension/tests/screens-wiring-review-fixes.test.ts`: new, 24 tests (R3-20, the rest of R3-1, and R3-3's page wiring).
- This report.

## Keys

None added or changed.

## Docs to update

1. **architecture.md:684** (token pools' records): `tests/lovejoin-1-5-0.test.ts` holds the classic pool's plans to 1.5.0's, to the lovelace; only what a return's chain measures keeps its slack. With the head start's pools shown, it holds the classic pool's Koios requests to 1.5.0's too, but what a shown pool asks of its own.
2. **development.md, Testing layers, the TypeScript row:** the screens are rendered to markup (`renderToStaticMarkup`). A screen's wiring is tested with its effects and handlers run, over `tests/screens-wiring-review-fixes.test.ts`'s seam: effects in the render, synchronous answers, `on` and `seed`. What a press does after an await is its rule's test's.
3. **The fixers' reports, in the docs round** (the skeptics asked for both):
   - wlj-4's "every other figure … matched exactly" (x-compat#2): the funding grid was compared within 0.5% until R3-18;
   - w-left's "each hunk was mutation-checked" (314-wasm#0): four of its runs.ts catches had no test until R3-19.
4. **For the lead's e2e list:** Home's two-window watch (309#0's hardening, Home.tsx:367–368) has a test at no level. One e2e case would cover it: Collateral open in a second window and its payment landing, then Home reading the balances again rather than holding its payments.

## Calls the owner might overturn

1. **The gate's case bodies stay as they were.** R3-18 is in `nearly()` and R3-17 in `classicAfter`, so the original plans case is now exact on its funding grid too, through its helper.
   - The lead's line kept the existing cases untouched. The skeptic offered this route as an equivalent ("no slack under paths starting `.funding`").
   - I took the positive form, slack only under `.returns[`. It's the same on today's fixture.
2. **R3-17 sets aside only what a shown pool asks of its own, by name:** the shown pools' boxes in a read, the return's one read of the pools, and the status read's one `epoch_params`. A second such read, a read of a pool alone, or anything else new fails the case. A refresh that changes how pools are read will fail it loudly, and the lead adjusts `classicCalls`.
3. **Seeds are positional.** Some states a screen reaches only after an await: PoolPage's review, NewSwap's approval, the funding and top-up reviews, a session's return review. Each starts from the useState after a run of known starting values. A state added there fails the test with "a seed … met a state starting …", rather than passing.
4. **Not covered:**
   - Home's two-window watch (above);
   - what any press does after its `await`: Stop's `halted`, widthTurned's `take`, Collateral's `onSent`. Their rules' tests hold those: bringFollower, widthTurned and lookAgain.

## Notes for the lead and other fixers

- **No test needs the pkg rebuilt.**
- **The harness is reusable.** A new screen test adds the component's name to `seam.effects`, answers requests with `answer` or `answers`, and acts with `on`. Nothing else in that file may mock `react`.
- **The copies** (`fx-tests-copy/` and `fx-tests-copy2/` in the scratchpad) held symlinks to `node_modules`, `wasm`, `docs` and the crates, and were re-synced from the tree around every mutation. They are deleted. The logs stay.
- **e2e:** no expectation changed, since nothing the wallet shows changed.
- **One before-run met an unrelated timeout:** b3's run against the 49 files had `restore-scan.test.ts`'s C41/C47 case time out at 5 s, under two mutation batches at once. That's the case tests-mutation saw time out under load; it passes alone. The other 862 passed, so b3's mutation was missed there too.

## Checks

| check | result |
|---|---|
| `npm run typecheck`, run after the last edit | clean |
| My three files (`screens-wiring-review-fixes`, `run-traps-review-fixes`, `lovejoin-1-5-0`), default build and `VITE_ENABLE_MAINNET=false` | 41 of 41 on each |
| The new file and run-traps, three times in a row with `--testTimeout=2500` | 37 of 37 each time: every new test is fast, and leans on no default timeout |
| The wide set: the 49 test files that import the wired screens, my three, and `runs.test.ts` | 53 files, 910 of 910, on the default build and on the preprod one (`fx-tests-wide-*.log`) |
| The gate alone, on the shared tree before my change | 4 of 4 in 25 s (`fx-tests-gate-baseline.log`) |
| Mutations | R3-19: 6 against my test, each failing its own step's case; 4 against HEAD's, each passing. R3-17 and R3-18: 5 against my gate (m17, m17b, xc1, gp1, +1), each failing; 4 against HEAD's (m17, m17b, xc1, gp1), each passing. R3-20, R3-1 and R3-3: 32 against the new file, each failing for its reason; the same 32 against the 49 existing screen files, each passing (b3's run aside, as noted) |
| Leftovers | No mutation left in the tree: `git diff` of `src/` holds none of mine, and `runs.ts` has no diff at all. The copies are deleted |
| Not run (the brief) | e2e, any build, `--write`, cargo |
