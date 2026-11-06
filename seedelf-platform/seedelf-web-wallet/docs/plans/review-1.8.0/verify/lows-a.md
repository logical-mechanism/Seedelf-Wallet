# 1.8.0's release review, round two: verifier lows-a

Four single-lens code lows, one trace verifier: cross#5 (P2), cross#6 (O5), pr363#0 (V1), screens#6 (S1). Each was read in full in its finder's report first, then traced and run in the sandbox `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/screens` at `a6c94743`. Every command runs from its `seedelf-platform/seedelf-web-wallet/extension`.

My scratch files there, each named `lows-a`:
- `tests/lows-a-claim-orig.test.ts`: the cross reviewer's `cross-scratch-claim.test.ts`, copied as is.
- `tests/lows-a-claim.test.ts`: my own version of that test, with the build order, a pool at mainnet's floor and Settings' default depth, and a second press.
- `tests/lows-a-token-orig.test.ts`: the cross reviewer's `cross-scratch-token.test.ts`, copied as is.
- `tests/lovejoin-flows-lows-a.test.ts`: the pr363 reviewer's `pr363-mut/lovejoin-flows.pr363-started-before.test.ts`, which is `lovejoin-flows.test.ts` plus one test. `diff` shows that one test is all it adds.
- `tests/lows-a-hub.test.ts` and `src/ui/screens/Lovejoin.lows-a-scratch.tsx`: the screens reviewer's hub harness, used to check a fix.

Three fixes were tried as mutations: `sessions.ts`, and `lovejoin-launch.ts` with `lovejoin.ts`. I put each file back from a copy afterwards. At the end, `git status --short` lists only untracked scratch files, and `git diff --stat` is empty.

All four are **CONFIRMED** and **low**. Two of them can't happen with today's pools:
- cross#6 needs a v2 token pool on mainnet before any v2 5 ₳ pool is shown.
- screens#6 needs more than four token groups on the hub, and today there are at most two.

---

## cross#5 (P2): Bring everything back draws a direct return's collateral boxes twice, and one Send is refused

- **Verdict:** CONFIRMED
- **Severity:** low
- **Introduced:** reachable. The defect is older, and 1.8.0 makes it nearly certain near the floor.

**Reachable.** Bring everything back (`ClaimAll.tsx`) over two or more claimable private sessions: a site's sessions or ones a restore found, open, not running by themselves, holding something. It needs all of these:
- One session's spare ADA pays for no box, but its 5 ₳ collateral is mixed into the 5 ₳ pool. Settings' `lovejoinCollateral` and `lovejoinReturns` are both on by default.
- That session is built before a session whose return is a chain. The claim builds in the dApps page's order (`claimBuildNow`, `sessions.ts:3175`).
- The 5 ₳ pool is over the floor (30 others on mainnet).

That's ordinary use, not a crafted state. In a pool near the floor the collision is nearly certain. Built the other way round (the chain first), nothing collides.

**Why.**
- A direct return's collateral mix draws its 2 boxes at build, from `collateralPool`'s rows (`sessions.ts:4396-4404`, `:4585`). Nothing is reserved until Send's `sendChain` (`sessions.ts:4962`).
- A chain reserves at build (`lovejoin.ts:3681`, `:3904`). Every later `split` leaves out what's reserved (`spent.ts:217-233`, `lovejoin.ts:7014`).
- So a chain built after the direct return, in the same claim, can draw the direct return's 2 boxes. Its tail goes in the same pool, read from the same split (`tailRows`, `lovejoin.ts:3958`).
- At Send, `reserve` refuses the direct return: `StalePool` (`lovejoin.ts:4349-4351`), "Lovejoin's pool changed while the wallet read it." `sendChain` restores the record (`sessions.ts:5009-5016`), so the session stays claimable and nothing is lost.
- 1.7.2 has the same direct path, unreserved (`6b70c1f8` `sessions.ts:4389`, `:4554`, `:4570`). There, only another collateral mix shared the 5 ₳ pool: 2 random draws (`lovejoin::collateral_mix` → `fresh_for` → `shuffle`), so about 4/N chance of overlap. Since 44b, the chain's own mixes draw from the same pool.

**Evidence.**
- `npx vitest run tests/lows-a-claim-orig.test.ts --maxWorkers=2 --silent=false`. This is the finder's test as is. It sets up 2 found sessions (3 ₳ + 5 ₳, and 40 ₳ + 5 ₳), 14 strangers in v2's 5 ₳ pool, depth 1. It fails, as the finder said:
  - `DRAWN [{"index":0,"n":2},{"index":1,"n":14}]`, `DRAWN BY BOTH 2`
  - `SUBMIT {"sent":[{"index":1,…}],"failed":[{"index":0,"error":"Lovejoin's pool changed while the wallet read it."}]}`
  - `expected 14 to be 16`
  - The setup is real: what a restore scan finds, on Settings' defaults except the depth.
- `npx vitest run tests/lows-a-claim.test.ts --maxWorkers=2 --silent=false`: 3 passed.
  - **A**, direct first, 14 strangers: `BOTH 2`, session 0 refused. The second press builds session 0 with `"tail":false`: in a drained pool its collateral comes back with the rest, while the review says only "its spare ADA is too little for a box".
  - **B**, chain first: `DRAWN [{"index":0,"n":14},{"index":1,"n":0}]`, `BOTH 0`, both sent. So it depends on the order.
  - **C**, direct first, 30 strangers (mainnet's floor), depth 2 (Settings' default): the chain draws 26 of 30 every time, and 4 of 4 runs drew a box twice, each refusing session 0. The odds of no overlap are C(4,2)/C(30,2) = 1.4%. After it, 4 boxes are left free, so a second press still mixes the collateral. "Its collateral comes back unmixed" holds only in a drained pool.
- **Fix, checked as a mutation.** In `buildBack`'s tail branch (`sessions.ts:4604`), I reserved the direct return's chain at build: `await lovejoin.reserve(network, chainOwner(index), [...txs, back], now() + BUILT_TTL_MS)`. Then:
  - Case A gives `DRAWN [{"index":0,"n":2},{"index":1,"n":12}]` (the chain 5 boxes, not 6), `BOTH 0`, and both sent.
  - Case B is unchanged.
  - The file was restored afterwards.

**Fix.**
- Reserve a direct return's collateral tail when it's built, as `fanOut` reserves a chain. That also covers a session page's review kept for Send while the runner builds another session's chain, and two direct returns with tails in one claim (1.7.2's case).
- Handle a `StalePool` at that reserve: drop the tail, or build again without the taken boxes (`unstale`). A rare race with a public mix's build could otherwise skip the session.
- No words change, and no owner's call is touched. The claim-only alternative ("pass each built return's draws to the next build") leaves the page and runner case open, so I'd go with the reservation.

---

## cross#6 (O5): with no v2 5 ₳ pool shown, a return's tokens skip their own v2 token pools

- **Verdict:** CONFIRMED
- **Severity:** low
- **Introduced:** new (44b)

**Reachable on mainnet alone, in a narrow window. Not on preprod.**

*Mainnet:*
- At `a6c94743` the head start bundles no v2 pool there (only 8131b1d's 5 ₳ pool, `dc6abe3b…`). The owner's call of 2026-11-06 lets 1.8.0 ship before the v2 5 ₳ pool exists.
- Anyone can launch a v2 token pool from Start a pool (v2 alone), and the data layer's `lovejoin/pools` lists it.
- For a token's leg to go, its pool must hold 30 others' boxes (`acrossOf`'s `floorShort`, `lovejoin.ts:3784`). One person's Bootstrap of 30 boxes makes that true for everyone else.
- A private session must also hold a box's worth of the token from its own transactions or its swap's fill.
- So the window is from the release until a v2 5 ₳ pool is launched and listed (about 10 minutes after its block settles). It also covers a wallet that last looked between the two launches while the data layer is down or Koios-only is on (see O1).
- No v2 token pool exists today, so this needs a launched and Bootstrapped token pool before the owner's own 5 ₳ pool: an edge case.

*Preprod:*
- The release prep's head start (the main tree's uncommitted `src/lovejoin-pools.json`) bundles v2's 5 ₳ pool `47bece42…`, so `adaPool` is always defined there.
- Even at `a6c94743` as committed, preprod discovery is a Koios look in launch order. Any look that finds a later v2 token pool has found `47bece42` first.
- The one variant left is the 5 ₳ pool shown but refused by `takesNewBoxes` (its boxes can't pay their way back). That's negligible for 5 ₳ of ADA, and older: 1.7.2's classic pool had the same structure.

**Why.**
- `chain()` throws `noAdaPool` at `lovejoin.ts:3516-3517`, before `acrossOf` (`:3558-3559`) looks at the tokens.
- Under the floor, `acrossOf` gives the ADA leg nothing and sends the tokens (`adaShort`, `:3811-3817`): the two states disagree.
- In 1.7.2, `chain()` took `poolNamed(undefined)`, the classic pool, which always exists (`6b70c1f8` `lovejoin.ts:3453`). So this is new.
- It fails the owner's 2026-11-06 call ("when it exists it uses it"): the token's pool exists.
- It bears on a critical string. A swap's approval in this state reads the token's pool independently of the ADA pool (`sessions.ts` `lovejoinCost` → `tokenPool`/`tokenAt`), funds the token's boxes, and shows `swaps.lovejoin.privacy.onToken` ("What you get goes into that token's own pool…", `Swaps.tsx:1590-1598`) beside `swaps.lovejoin.warn.pool` with `noAdaPool`.
- The swap's return then runs by itself and brings the token back directly. So in this state that critical line is false from the start. It stays low only because the state is an edge case.
- `collateralWanted` (`sessions.ts:4694-4725`) already counts token pools when no ADA pool is shown, so the two readings disagree there too.

**Evidence.**
- `npx vitest run tests/lows-a-token-orig.test.ts --maxWorkers=2 --silent=false`. This is the finder's test as is: a site session with 2 boxes' worth of LJTEST, 40 ₳ and 5 ₳, and v2's LJTEST pool (`wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json`, 40 strangers). 2 passed:
  - `WITH ADA POOL {"ways":[{…,"pool":"c5852bb7…","boxes":2,…}],"boxes":7}`
  - `NO ADA POOL {"skipped":"Lovejoin has no pool of 5 ₳ boxes to take it yet"}`
- The under-the-floor comparison rests on the trace above: preprod's floor is 0, so a unit test can't reach it.
- The head start's contents were read with a Python one-liner over the `a6c94743` file and the main tree's file:
  - `a6c94743`: preprod 4 pools, all without a version (8131b1d's); mainnet 1.
  - The prep: preprod adds `{"id":"47bece42…","version":"v2","boxLovelace":"5000000"}`; mainnet is unchanged.

**Fix.**
- In `chain()`, for a return (`pool === undefined && !again && way.returns`) with no ADA pool, run `acrossOf` without an ADA leg. Make `c.pool` optional there, and leave the ADA pool out of `values`, `guess`, `legs` and `adaShort`. Throw `noAdaPool` only when no token leg goes.
- WebAssembly needs no change: `chain_across_pools` and `plan_across` take any legs, the token pools first, and leave out a leg that takes none.
- The collateral finds no 5 ₳ pool and comes back with the rest, as today.
- No new or changed words, so no back-translation. A unit test: the finder's second case, expecting the token's way to hold boxes.

---

## pr363#0 (V1): a v2 start is told it makes a copy of an 8131b1d start that 1.7.2 recorded

- **Verdict:** CONFIRMED
- **Severity:** low
- **Introduced:** reachable. The code is 1.7.2's; 44a's split of the shown rule by set made its warning false across the update.

**How long a LaunchRecord lives, and whether the update keeps it.** It lives as long as the wallet does, but it matters for 24 hours.
- Records are never pruned, on purpose: "Pruning these, or dropping `box` or `reviewed`, turns both off" (`lovejoin.ts:6120-6127`).
- A Lovejoin record holding launches is never empty (`lovejoin.ts:2216`).
- The record's reader keeps each launch whole when its `id`, `txHash` and `at` read right (`lovejoin.ts:7487-7492`), `box` included. It sits in the sealed record in `chrome.storage.local`, which an extension update keeps.
- 1.7.2 wrote exactly this shape: `{ id, txHash, from, account?, box, reviewed? }`, no set (`6b70c1f8` `lovejoin-launch.ts:389-396`). So 1.8.0 reads 1.7.2's records as they were left.
- But `startedBefore` reads only records under `STARTED_SAID_MS` (24 h) old whose pool no look has found (`lovejoin-launch.ts:298-305`). `build()` looks right before it, and 1.8.0 still verifies 8131b1d pools.
- So the window is about 10 minutes after the 1.7.2 start's block for a start that landed, or the full 24 h for one that never landed or lost a race.

**How often.** The user started a pool on 1.7.2 (a rare action), Chrome applied 1.8.0 inside that window, and the user started the same values again on v2 within it. Nothing is refused. The review shows the critical `lovejoin.launch.warn.startedBefore` ("…the later one is a copy: never shown, and what it locks is gone for good"), which is false: the v2 pool is the first of its values on its set, so it's shown. It could put a user off a launch that's fine. It closes by itself within a day of each wallet's update.

**Evidence.**
- `npx vitest run tests/lovejoin-flows-lows-a.test.ts --maxWorkers=2 -t "pr363|318-worker#1"` fails on `× pr363: a v2 start isn't told it makes a copy of an 8131b1d start that 1.7.2 recorded` with `AssertionError: expected { …(2) } to be undefined`, after its check that the built pool's version is `"v2"` passed. The 318-worker#1 tests pass.
- The scratch's record is 1.7.2's shape, written through the real `recordLaunch`, and the clock moved 5 minutes, inside the real window.
- **Fix, checked as a mutation.** I made three changes:
  - `version?: "v2"` on `LaunchRecord` (`lovejoin.ts`);
  - `version: "v2"` in `submit`'s `recordLaunch` call (`lovejoin-launch.ts:389-397`; `poolOf` drops the built pool's `version`, so it's written as the start's set: every 1.8.0 start runs v2);
  - `l.version === "v2" &&` in `startedBefore`'s filter.
- With them, the same command gives `Tests 3 passed`. The pr363 test passes, and 318-worker#1 still warns a v2 start of a v2 start. Both files were restored afterwards.

**Fix.** As the finder says:
- Record the start's set on each record 1.8.0 writes; none means 8131b1d's, as `FoundPool` reads it.
- Have `startedBefore` match only records of the start's set. That also keeps the next set's starts apart when one comes.
- No words change.

---

## screens#6 (S1): the hub's search keeps filtering after its box hides

- **Verdict:** CONFIRMED (the end state is rendered; the transition rests on the trace)
- **Severity:** low
- **Introduced:** reachable. The search is from 1.6.0, and 1.8.0 makes it usual for groups to leave the hub.

**How often.** Never with today's pools.
- The box shows only past four groups (`groups.length > SEARCH_FROM`, `Lovejoin.tsx:1983`, `:2067`), and groups are by token (`lovejoin-pools.ts:113-136`).
- Preprod at `a6c94743`, and with the prep, has two groups at most:
  - ADA: the classic pool, `18c4df77`, `aab7c72d`, and the prep's `47bece42`;
  - MIN: `dfa1f845`, `8b3ae2e2`.
- Mainnet has one, ADA. Discovery keeps only pools of tokens on the wallet's list.
- So the box can't show today. It needs four or more distinct tokens with pools on the hub: later v2 token pools, which are always listed, plus a retired or copy group with the wallet's boxes that empties while a query is typed and the hub stays open.
- Retired groups empty within minutes at the first unlock (call 3), or later when a 1.7 device's mix comes back.
- Back to the dApps page unmounts the hub and clears the query. Nothing is lost.

**Why.**
- `query` is the hub component's state. Its only setter is the input's `onChange` (`Lovejoin.tsx:1991`).
- `listed = searchGroups(network, groups, query)` always filters (`:1921`), and the empty line reads `query` too (`:2007`).
- `status` changes on `load`: Refresh (`:1933`), a pool page's refresh or its run's end (`:1910`), a start's `onSent` (`:1864`), and `lookForPools` (`:1747`).
- The component stays mounted while a pool page shows, so the query survives one.
- The ADA group matches only "ada", "₳" or "cardano" (`lovejoin-pools.ts:151`), so a token query hides v2's 5 ₳ pool too.

**Evidence.**
- `diff` of the screens reviewer's harness `src/ui/screens/Lovejoin.screens-scratch.tsx` against `git show HEAD:…/Lovejoin.tsx` shows only the initial `status` and `query` (lines 1678 and 1700) taken from globals. So its static render is the real hub's render for that state.
- `npx vitest run tests/screens-scratch-hub.test.ts --maxWorkers=2 --silent=false -t "query typed"` fails at `a6c94743`. It prints `STALE QUERY: … Pools No pool's token matches “MIN”. Start a pool …`, with no `lovejoin-pools-search` input, for one group (v2's 5 ₳ pool) and the query "MIN".
- The unit tests have no DOM (no jsdom or happy-dom in `node_modules`), and Playwright is the e2e lens's. So typing and then emptying the groups isn't driven by a test; it rests on the trace above.
- **Fix, checked in my own copy** (`Lovejoin.lows-a-scratch.tsx`): `const searching = groups.length > SEARCH_FROM ? query : ""`, used at both `:1921` and `:2007`. Then `npx vitest run tests/lows-a-hub.test.ts --maxWorkers=2 --silent=false -t "query typed"` passes, and the hub lists "ADA ₳ 5 ₳ 12 boxes not yours Being started: 12 of 30 boxes".

**Fix.**
- Filter by `groups.length > SEARCH_FROM ? query : ""`, and use that same value in the empty line. On the filter alone, an empty list would still say "No pool's token matches “MIN”" instead of `noneYet`.
- What was typed comes back if the box does.
- Clearing `query` when the box hides would also do, but it loses the text. No words change.

---

## Commands run (all in the sandbox, targeted, `--maxWorkers=2`)

- `npx vitest run tests/lows-a-claim-orig.test.ts --maxWorkers=2 --silent=false`: 1 failed (the finding).
- `npx vitest run tests/lows-a-claim.test.ts --maxWorkers=2 --silent=false`: 3 passed (A, B, C).
- The same file with `-t "14 strangers"`, under the cross#5 fix: A's overlap assertion fails, since the fix holds, and B passes. Restored afterwards.
- `npx vitest run tests/lows-a-token-orig.test.ts --maxWorkers=2 --silent=false`: 2 passed.
- `npx vitest run tests/lovejoin-flows-lows-a.test.ts --maxWorkers=2 -t "pr363|318-worker#1"`: 1 failed and 2 passed; under the pr363#0 fix, 3 passed. Restored afterwards.
- `npx vitest run tests/screens-scratch-hub.test.ts --maxWorkers=2 --silent=false -t "query typed"`: 1 failed (the finding).
- `npx vitest run tests/lows-a-hub.test.ts --maxWorkers=2 --silent=false -t "query typed"`: 1 passed (the fix).

No network, no build, no formatter, no Playwright, no Rust, and no state-changing git command.
