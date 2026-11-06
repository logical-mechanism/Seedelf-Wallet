# 1.8.0 release review: screens

The lens: #364's screens and #363's launch screen at `a6c94743`. That's `Lovejoin.tsx` (the hub, a pool's page, Your mixes, Chains), `BringAllBack.tsx`, `LovejoinReturn.tsx`, `lovejoin-pools.ts` (`shownOnHub`, `isRetired`, `isCopy`), `LovejoinLaunch.tsx`, Settings' Lovejoin section, Home's pool rows, the dApps tile, and the `rpc.ts` shapes they read.

The sandbox is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/screens`. Every command below runs from its `seedelf-platform/seedelf-web-wallet/extension`. The scratch files there are:
- `tests/screens-scratch-words.test.ts`: static renders of the screens.
- `tests/screens-scratch-worker.test.ts`: the worker with the real WebAssembly, set up as `lovejoin-retired.test.ts` sets it up.
- `tests/screens-scratch-hub.test.ts`: the hub rendered from a status, through `src/ui/screens/Lovejoin.screens-scratch.tsx`. That file is a copy of `Lovejoin.tsx` whose status and search query start from globals, because the hub's effects don't run in a static render. It differs in those two lines alone; I checked this with `diff` against `git show HEAD:…`.

Each scratch test asserts what the screen should say, so a failure at `a6c94743` is the finding. Before I wrote this, all three files ran on the clean tree: `npx vitest run tests/screens-scratch-words.test.ts tests/screens-scratch-hub.test.ts tests/screens-scratch-worker.test.ts --maxWorkers=2`. The result was 13 failed, all findings below, and 4 passed, the sound checks.

The mutations ran through `scratchpad/screens-mutate.py` (M1–M10) and `screens-mutate2.py` (M11–M22).
- Each one replaces one string in one file. Then it runs the fast set, `scratchpad/fast.txt`: 29 files, every unit test of these screens.
- For a survivor of M1–M10 it then ran the slow set, `scratchpad/slow.txt`: the 12 other test files that import a mutated module.
- For M11–M22 the slow run covered only the slow files that render the mutated component (each survivor's line lists them). Every slow file ran against M4–M10 and caught none.
- Each run used `npx vitest run <files> --maxWorkers=2 --bail=1`. The file was restored after every mutation, and `git diff` was empty at the end.

**No finding is High or Medium.** Every state 1.8.0 makes reachable that I traced still has a button that works, and I found no screen path that puts a box into a retired pool. What I did find:
- words that say something false or misleading in a retired pool's states;
- one button that asks a wider run than the one it says it retries;
- a worker lead in the first unlock's bring-back;
- 17 of 22 mutations of 1.8.0's screen guards that no unit test catches.

## Findings

### screens#0: Settings' Try again, after the retired pools' run stopped by itself, asks every pool's run and brings the v2 boxes back too
- **Severity:** low · **kind:** code · **introduced:** new · **proven:** test
- **Where:**
  - `src/ui/components/BringAllBack.tsx:197`, `:283`, `:353`, `:377`
  - `src/background/lovejoin.ts:6696-6704`
  - `src/i18n/translations/en.json:1987` (`settings.lovejoin.warn.bringStopped`, a critical key)
- **Claim:** The retired pools' run (`bringing.retired`) stops by itself after `BRING_FAILED_RUNS` runs that send nothing.
  - Settings then shows "Stopped: several tries in a row sent nothing. {{why}} Press Try again to bring back the rest." and a **Try again** button.
  - The button sends `lovejoin-bring-all-back` with `{}`, which is every pool's request. A stopped run isn't `going` in `bringAllBack`, so the worker writes a new `{ at, back: 0 }` with no `retired`.
  - So the run Try again starts isn't the one that stopped: it's every pool's, and the v2 pools' boxes come back one after another too, without their waits.
  - The plan keeps the retired pools' run off the v2 pools for that reason ("a second device updating later would otherwise bring back the v2 boxes the first one mixed").
  - It's low, not medium, because the note under the button ("Every box in every pool, without the waits.") and the question ("Bring every box back now?") do say every pool. It's "Try again" and "bring back the rest" that say a retry.
  - On a retired pool's page, the same line's Try again asks that one pool's run alone (`{ pool }`), not "the rest".
- **Scenario:**
  1. First unlock on 1.8.0, with a box in the classic pool and one in v2's 5 ₳ pool. The 5 ₳ box could be another device's mix, or this device's.
  2. Koios fails the pool reads for a few minutes, and the retired pools' run stops by itself.
  3. The user opens Settings, reads "Press Try again to bring back the rest.", presses Try again and confirms.
  4. Wrong outcome: the v2 box is withdrawn back to back with the classic box.
- **Evidence:** `npx vitest run tests/screens-scratch-worker.test.ts -t "Try again" --maxWorkers=2 --silent=false` fails at `a6c94743`:
  - Before Try again: `HELD BRINGING (retired run, stopped by itself): {"back":0,"retired":true,"stopped":"The server is having trouble (500 for credential_utxos). Try again in a minute."}`
  - After Settings' request: `HELD BRINGING (after Settings' Try again): {"back":0}`
  - `WITHDRAWN: [ 'c1…#0', 'f1…#0' ]`, where f1 is the v2 5 ₳ pool's box. `expected [ …(2) ] to not include 'f1f1…'`.
  - The words, rendered: `npx vitest run tests/screens-scratch-words.test.ts -t "Settings after"` passes. It renders "Press Try again to bring back the rest." and "Try again" for `{ back: 2, retired: true, stopped }`.
- **Fix:** Give the request a retired form (`{ retired: true }`): the worker restarts the run that stopped as `retired`, and Settings' Try again sends it when `bringing.retired`. Or word a stopped retired run in Settings without Try again: its plain every-pool button.

### screens#1: A retired token pool whose boxes can't pay their own way back says they "come back by themselves"
- **Severity:** low · **kind:** words · **introduced:** new · **proven:** test
- **Where:**
  - `src/ui/screens/Lovejoin.tsx:3641` (`UNUSABLE.retired`)
  - the hub row at `:2280`, a pool page's Mix again line at `:1617`, the Mix form's reason at `:3179-3180`
  - `src/background/lovejoin.ts:2977`, `:6003`, `:6426`
  - `src/i18n/translations/en.json:3170` (`lj.unusable.warn.retired`, a critical key)
- **Claim:** The worker computes `cantComeBack` for a retired token pool as for any other; `cantComeBack` exempts only the classic pool.
  - The scheduled withdraw puts a stuck pool's box off by `STUCK_WAIT_MS` again and again.
  - The status hands the screens both `unusable: { why: "retired" }` and `cantComeBack`.
  - The hub row and the page (under Mix again and under Review) then say "This pool runs Lovejoin's retired scripts: … Your boxes in it come back by themselves." The stuck callout on the same page says the opposite: "This pool's boxes wait in it, and come back by themselves only if the fees drop enough".
  - So the promise in this critical string is false in that state. It's rated low because the state needs a parameter rise. Mainnet's head start holds no 8131b1d token pool today, only the 5 ₳ ADA pool; discovery can find later ones.
  - The way out works: the callout's paid Bring one back, and Bring every box back, which pays a stuck box from the private balance.
- **Scenario:**
  1. A box of the wallet's sits in PR #163's 8131b1d LJTEST pool on preprod, 2 ₳ a box, and `coins_per_utxo_size` rises to 4800.
  2. The status reports the pool as retired and stuck.
  3. Over 12 hours of runs nothing comes back, while the page says it comes back by itself.
- **Evidence:**
  - `npx vitest run tests/screens-scratch-worker.test.ts -t "retired token pool whose boxes" --maxWorkers=2 --silent=false` fails at `a6c94743`. It prints `RETIRED STUCK POOL: {"unusable":{"why":"retired"},"cantComeBack":{"has":"1589324","needs":"1723200"},"boxes":1,…}`, then `SENT OVER 12 H: 0 []`, then `expected 0 to be greater than 0`.
  - `npx vitest run tests/screens-scratch-words.test.ts -t "retired token pool"` fails. The page renders both "come back by themselves only if the fees drop enough" and, twice, "Your boxes in it come back by themselves."
- **Fix:** Where `cantComeBack` is set, leave the last sentence out of the retired reason (a `lj.unusable.warn.retiredStuck` key, or `unusableText` taking the pool). Or word the last sentence so it holds there too.

### screens#2: The first unlock's bring-back isn't asked for the retired pools while a one-pool run goes (worker lens, a lead)
- **Severity:** low · **kind:** code · **introduced:** new · **proven:** test
- **Where:** `src/background/lovejoin.ts:4095-4099` (`retireOnce`)
- **Claim:** `retireOnce` marks the record `retired` but keeps a run that still goes ("One the user asked that still goes stays as it is").
  - A run 1.7 asked from a pool's page goes on as that one pool's: the classic pool's, or an 8131b1d pool's. The other retired pools' boxes are never asked back right away, and `retired` stops `retireOnce` from asking again.
  - They come back by their own schedules, so nothing is stranded, but owner's call 3 isn't met for them.
  - I found this tracing the retired run's screens; it's the worker lens's to confirm.
- **Scenario:**
  1. On 1.7.2 the user pressed Bring every box in this pool back now on the classic pool's page, and the extension updated while that run went.
  2. At the first unlock on 1.8.0, the classic boxes come back, and the 8131b1d pool's boxes wait their 1–6 h or more.
- **Evidence:** `npx vitest run tests/screens-scratch-worker.test.ts -t "one-pool run" --maxWorkers=1 --silent=false` fails at `a6c94743`:
  - `FIRST UNLOCK: {"sent":1,"retired":1800000000000,"bringing":{…,"pool":"classic",…}} [ 'c1…#0' ]`
  - after the run: `AFTER: {"retired":1800000000000} [ 'c1…#0' ]`
  - `expected [ Array(1) ] to include 'd1d1…'`
- **Fix:** A going run that names one pool gets the retired pools added: make it `{ ...b, pool: undefined, retired: true }`, since before 1.8.0 every pool is retired. Or set `retired` only once the retired pools' run has been asked.

### screens#3: A retired pool's page, while the retired pools' run goes, calls it "every box in this pool" and counts every retired pool's boxes
- **Severity:** low · **kind:** words · **introduced:** new · **proven:** test
- **Where:** `src/ui/components/BringAllBack.tsx:286-288`, with `src/background/lovejoin.ts:6792` and `:6937-6938`
- **Claim:** `goingText` takes the retired pools' run out of the every-pool branch (`b.pool === undefined && !b.retired`).
  - On a pool's page it then falls to `lovejoin.bring.going`: "Bringing every box in this pool back: {{boxes}} sent back so far." Its count `back`, and `left` beside it, are the run's own, across every retired pool (`covered`, `b.back += 1`).
  - The plan says the pool's page follows the run in the retired pools' words ("Bringing every box in the retired pools back").
- **Scenario:**
  1. 1 box in the classic pool and 7 in 8131b1d's 5 ₳ pool.
  2. The classic pool's page shows "Your boxes in the pool: 1 box" above "Bringing every box in this pool back: 5 boxes sent back so far. 3 boxes left."
- **Evidence:**
  - `npx vitest run tests/screens-scratch-words.test.ts -t "retired pool's page while"` fails at `a6c94743`. It prints `POOL PAGE, RETIRED RUN: Bringing every box in this pool back: 5 boxes sent back so far. 3 boxes left. Keep Seedelf Wallet unlocked: … Stop`.
  - The same block's first test passes: `bringFollower("classic", …, true)` hands the page the retired run.
- **Fix:** `tr(b.retired ? "settings.lovejoin.bringingRetired" : pool ? "lovejoin.bring.going" : "settings.lovejoin.bringingPool", …)`.

### screens#4: A 1.7 chain stopped partway in a retired pool still says "Mix my boxes again mixes the boxes it didn't"
- **Severity:** low · **kind:** words · **introduced:** reachable · **proven:** test
- **Where:**
  - `src/ui/screens/Lovejoin.tsx:968` (`Chains`)
  - `src/i18n/translations/en.json:1008` (`lovejoin.chains.whyStopped`)
  - `src/shared/rpc.ts:2446` (`LovejoinChainView` names no pool)
  - `src/background/lovejoin.ts:6038`
  - Home's flag at `src/ui/screens/Home.tsx:1489`, `:1540`
- **Claim:** On 1.8.0 the hub's Chains still lists a stopped chain in the classic pool while its boxes are left.
  - Its row says "Why it stopped: …. Mix my boxes again mixes the boxes it didn't."
  - Mix my boxes again is refused in a retired pool (`againBoxes` throws), and those boxes now come back by themselves.
  - Home's flag sends the user there: "a mix stopped partway: open Lovejoin to see what to do."
  - The row can't tell a retired pool's chain from a v2 pool's, because `LovejoinChainView` carries no pool.
  - It lasts until the retired pools' run brings the boxes back (minutes), or longer if that run is stopped or fails.
- **Scenario:**
  1. A 1.7.2 chain cut by a lock left 2 boxes in the classic pool, and the wallet updates to 1.8.0.
  2. Home flags it; the hub's row says to Mix my boxes again.
  3. The classic pool's page has that button off: "…mixes none again. Your boxes in it come back by themselves."
- **Evidence:**
  - `npx vitest run tests/screens-scratch-worker.test.ts -t "chain stopped partway" --silent=false` passes. It prints `CHAINS: [{"session":0,"boxes":1,"total":2,"sent":1,…,"stopped":"the wallet locked"}] classic notMixed: [] unusable: {"why":"retired"}`, and `againBoxes` rejects.
  - `npx vitest run tests/screens-scratch-words.test.ts -t "chain stopped partway"` fails. `CHAIN ROW: … Why it stopped: the wallet locked. Mix my boxes again mixes the boxes it didn't.`
- **Fix:** Add the chain's pool, or a `retired` flag, to `LovejoinChainView`. In a retired pool, say the boxes come back by themselves, e.g. a `lovejoin.chains.whyStoppedRetired` key.

### screens#5: A retired pool's page sends the user to another account "to mix them again"
- **Severity:** low · **kind:** words · **introduced:** reachable · **proven:** test
- **Where:**
  - `src/ui/screens/Lovejoin.tsx:1566`, `:1590` (`AgainActions` → `OtherAccounts`)
  - `src/i18n/translations/en.json:1099` (`lovejoin.otherAccount`)
- **Claim:** `AgainActions` lists the other accounts whose mixes put boxes in, whatever `againRefused` says.
  - In a retired pool, where every Mix again is off, it still says "Some of your boxes came from a mix from Public account 2. Switch to it on the Public tab to mix them again."
  - On that account, Mix again from my public account is off too, with the retired reason.
- **Scenario:** Account 2 mixed into the classic pool on 1.7. On 1.8.0, account 1 opens the classic pool's page and is sent to account 2 to mix the boxes again, which the pool refuses.
- **Evidence:** `npx vitest run tests/screens-scratch-words.test.ts -t "another account"` fails at `a6c94743`. It prints `RETIRED AGAIN ACTIONS: Some of your boxes came from a mix from Public account 2. Switch to it on the Public tab to mix them again. Mix again from my public account This pool runs Lovejoin's retired scripts: …`, with the button disabled.
- **Fix:** Render `OtherAccounts` only when `!why`, as `NotMixed` already leaves out its `takes` line (`againOff`).

### screens#6: The hub's search keeps filtering after its box is gone
- **Severity:** low · **kind:** code · **introduced:** reachable · **proven:** test
- **Where:** `src/ui/screens/Lovejoin.tsx:1700`, `:1921`, `:1983`, `:2007`
- **Claim:** The search box shows only while there are more than four groups (`SEARCH_FROM`), but `query` stays in state.
  - The retired pools' groups leave the hub once emptied, which 1.8.0's bring-back does within minutes. A query typed while they showed then keeps filtering with no box to clear it.
  - The hub then says "No pool's token matches “X”." and hides every pool, v2's 5 ₳ pool too, until the user leaves Lovejoin.
  - It's an edge case today: it needs boxes in four retired token pools, or v2 token pools.
- **Scenario:**
  1. ADA plus four retired token groups holding the wallet's boxes. The user types "MIN".
  2. The bring-back empties those groups. One group is left, no search box shows, and "No pool's token matches “MIN”." stands in for the 5 ₳ pool.
- **Evidence:** `npx vitest run tests/screens-scratch-hub.test.ts -t "query typed" --silent=false` fails at `a6c94743`. It prints `STALE QUERY: Lovejoin A mixer for ADA and tokens … Pools No pool's token matches “MIN”. Start a pool …`, with no `lovejoin-pools-search` input.
- **Fix:** Search with `groups.length > SEARCH_FROM ? query : ""`, or clear `query` when the box hides.

### screens#7: Untested guards: the retired pools' run in BringAllBack
- **Severity:** low · **kind:** test · **introduced:** new · **proven:** mutation
- **Where:** `src/ui/components/BringAllBack.tsx:48`, `:59`, `:97`, `:101`, `:124`, `:177`, `:286`, `:288`, `:343`, `:367`
- **Claim:** Of 1.8.0's retired-run rules in BringAllBack, only `doneOf`'s pool filter (M18) is pinned. No unit test pins:
  - who follows the run;
  - its words in Settings;
  - Settings' widen button;
  - "Nothing of yours was left in the retired pools";
  - the classic pool counting as retired in `doneOf`.
- **Evidence:** each mutation survives the fast set, then `tests/chain-stopped-copy.test.ts` (the only slow file that renders BringAllBack, through LovejoinSettings):
  - M10 `:59` `(b.pool === undefined && (!b.retired || retired))` → `(b.pool === undefined)`: a v2 pool's page takes the retired pools' run for its own.
  - M11 `:101` and M12 `:97`: drop `ran.retired` from `show.done`, so the end says every pool's words.
  - M13 `:124`: keep `retired` when Settings widens.
  - M14 `:286`: `b.pool === undefined && !b.retired` → `b.pool === undefined`, the retired run said as every pool's.
  - M15 `:288`: Settings says "one pool" for it.
  - M16 `:343`: `(going.pool !== undefined || !!going.retired)` → `(going.pool !== undefined)`, Settings' button gone while it goes.
  - M17 `:367`: drop `doneRetired`.
  - M19 `:48`: the classic pool not `retired` in `doneOf`, so "Nothing of yours was left" is said with classic boxes left.
  - M20 `:177`: drop `retired` from `done`.
  - The caught one: M18 `:49` (lovejoin-retired, "says nothing was left only where the retired pools' run ran").
- **Fix:** In `lovejoin-bring-screen-review-fixes.test.ts`, drive `bringFollower` with a retired run: on a retired page, on a v2 page and in Settings, then stopped, stopped by itself, ended, and widened. Render `BringAllBackView` for each, and run `doneOf` with classic boxes left.

### screens#8: Untested guards: a retired pool's page and hub row
- **Severity:** low · **kind:** test · **introduced:** new · **proven:** mutation
- **Where:** `src/ui/screens/Lovejoin.tsx:2245`, `:2686`, `:3475`, `:3567`, `:3641`
- **Claim:** The retired pool's guards on its page and row are pinned for copies alone: the page closed to Bootstrap, the row's meter, the launch link kept private, the page's BringAllBack told it's retired, and the retired reason's own key. Each survives the fast set and the whole slow set:
  - M4 `:2245`: the meter for a retired pool.
  - M5 `:2686`: `const closed = isCopy(pool)`. A retired pool short of its floor then leads with Bootstrap, and "Help start the pool" shows. The worker still refuses it, in words.
  - M6 `:3475`: the launch link not private.
  - M7 `:3567`: `retired={false}`, so a retired pool's page never follows the retired pools' run.
  - M9 `:3641`: retired worded with `lj.unusable.warn.superseded`, a copy's reason, on every retired row and page.
- **Fix:** Render `PoolPage` and `PoolGroupList` for a retired pool: below its floor, with a launch, and with a retired run going. Assert no Bootstrap anywhere, no meter, the private link, the retired run's words, and `lj.unusable.warn.retired`'s text.

### screens#9: Untested guard: LovejoinSwitch's ADA pool
- **Severity:** low · **kind:** test · **introduced:** new · **proven:** mutation
- **Where:** `src/ui/components/LovejoinReturn.tsx:381`
- **Claim:** The rule that a return's ADA through the 5 ₳ pool (named by id, its box holding no token) reads "Its spare ADA is mixed…", rather than the token line, isn't pinned.
  - That line is a critical `.privacy.` key: `swaps.lovejoin.privacy.on` against `onTokens`.
- **Evidence:** M22 `const adaPool = (pool?: string) => pool === undefined;` survives the fast set and the whole slow set. With it, every 1.8.0 return says "Its tokens go into their own pools…" of plain ADA.
- **Fix:** Render `LovejoinSwitch` for a summary with `pool` the 5 ₳ pool's id and its `values`, and for one across pools.

### screens#10: Untested guard: the hub's "No pool to mix in yet"
- **Severity:** low · **kind:** test · **introduced:** new · **proven:** mutation
- **Where:** `src/ui/screens/Lovejoin.tsx:2007`
- **Claim:** The hub's empty list with nothing typed says "No pool to mix in yet." rather than 'No pool's token matches “”', and nothing pins it.
- **Evidence:** M8, replacing the line's ternary with `tr("lovejoin.pools.noneMatch", { query: query.trim() })`, survives the fast set and the whole slow set. The hub's state is set by effects, which no unit test runs. `tests/screens-scratch-hub.test.ts` shows one way to render it.
- **Fix:** Export the list's empty line as a small component, or render the hub from a seeded status as the scratch test does.

### screens#11: A retired token pool's page loses its run's Done
- **Severity:** nit · **kind:** code · **introduced:** reachable · **proven:** test
- **Where:** `src/ui/screens/Lovejoin.tsx:3569` (`onOver` → `onRefresh`), `:1892`; `src/background/lovejoin.ts:6021` (`listedHere`)
- **Claim:** The worker lists a retired token pool only while the wallet has something there.
  - When the run that empties it ends (its page's own, or the retired pools'), the page refreshes. The pool has left the status, so `poolNamed` finds nothing and the hub replaces the page.
  - "Done: N back in your private balance." shows for the length of one read, then goes.
  - The classic pool's page keeps it; the classic pool is always in the status.
  - A copy's page did the same before 1.8.0; retired pools make it the usual case.
- **Evidence:** `npx vitest run tests/screens-scratch-worker.test.ts -t "own run ends" --silent=false` fails at `a6c94743`. It prints `HELD AFTER RUN: {}` and `POOLS AFTER RUN: [{"id":"0eedc4eb","boxes":0}]` (v2's 5 ₳ pool alone). The page side is a trace of `:1892`.
- **Fix:** Keep the page on its pool's last read while its BringAllBack holds a `done`, or say the end on the hub.

### screens#12: The hub's "in 5 ₳ boxes" aside shows only when no 5 ₳ pool is known
- **Severity:** nit · **kind:** words · **introduced:** new · **proven:** test
- **Where:** `src/ui/screens/Lovejoin.tsx:1922`, `:1929`; `en.json:982`, `:1265`
- **Claim:** `tokenPools` counts every pool with an id, and v2's 5 ₳ ADA pool has one.
  - So "A mixer for ADA, in 5 ₳ boxes", the aside 44b moved to 5 ₳, shows only while no pool but the classic one is known. The hub then also says "No pool to mix in yet."
  - With v2's 5 ₳ pool read, it says "A mixer for ADA and tokens" though no token pool takes boxes.
- **Evidence:** `npx vitest run tests/screens-scratch-hub.test.ts -t "aside"` fails: `V2 5 ADA POOL ONLY: Lovejoin A mixer for ADA and tokens …`. The block's first test passes: with no v2 pool, "A mixer for ADA, in 5 ₳ boxes" and "No pool to mix in yet."
- **Fix:** Count token pools by `box.token` among the pools shown on the hub.

### screens#13: "No pool to mix in yet" isn't said when every listed pool is retired
- **Severity:** nit · **kind:** words · **introduced:** new · **proven:** test
- **Where:** `src/ui/screens/Lovejoin.tsx:2005-2009`
- **Claim:** `noneYet` shows only when nothing is listed. With no v2 pool and the wallet's boxes in the classic pool, the hub lists that pool alone, withdraw-only, and nothing says no pool takes boxes.
- **Evidence:** `npx vitest run tests/screens-scratch-hub.test.ts -t "only the retired"` fails: `ONLY RETIRED LISTED: … ADA ₳ 10 ₳ 2 boxes 200 boxes not yours This pool runs Lovejoin's retired scripts: … Start a pool …`.
- **Fix:** Show `noneYet` when no listed pool takes boxes (every one `isRetired` or `isCopy`) and nothing is typed.

### screens#14: A 1.7 mix session's saved reason reads "Lovejoin was left out: This pool runs…" on a card that names no pool
- **Severity:** nit · **kind:** words · **introduced:** new · **proven:** test
- **Where:**
  - `src/ui/screens/Lovejoin.tsx:909` (`detailOf`)
  - `src/background/lovejoin.ts:3528` (`LovejoinSkipped` of `lj.unusable.warn.retired`)
  - `src/background/sessions.ts:4515`
- **Claim:** A 1.7 mix session into the classic pool, its chain not built at the update, is refused there. It saves `lj.unusable.warn.retired`, two sentences written for a pool's page, as `mix.skipped`.
  - Your mixes' card then reads "Lovejoin was left out: This pool runs Lovejoin's retired scripts: the wallet puts no new box in it, and mixes none again. Your boxes in it come back by themselves."
  - "This pool" names nothing there, and "Your boxes in it" sits under "2 boxes of 10 ₳" that never went in. Each sentence is true of the classic pool; the frame makes it misleading. The return's `skippedThis`/`skippedIts` frames read the same way.
- **Evidence:** `npx vitest run tests/screens-scratch-words.test.ts -t "1.7 mix session" --silent=false` fails: `MIX CARD: Came back without going into Lovejoin | Lovejoin was left out: This pool runs …`.
- **Fix:** A clause-shaped session reason, e.g. `sess.skip.warn.poolRetired`: "its pool is retired and takes no new box". The page keeps `lj.unusable.warn.retired`.

## Mutations

| | Mutation | Fast set | Slow |
|---|---|---|---|
| M1 | `shownOnHub` drops `isRetired` | caught (lovejoin-retired) | |
| M2 | `shownOnHub` drops the Bootstrap clause | caught (lovejoin-merged-screens) | |
| M3 | `poolsOf` drops the classic pool's `unusable` | caught (lovejoin-retired) | |
| M4 | hub row meter for a retired pool | survived | survived (all 12) |
| M5 | `closed = isCopy(pool)` | survived | survived (all 12) |
| M6 | launch link not private when retired | survived | survived (all 12) |
| M7 | `retired={false}` on a pool's BringAllBack | survived | survived (all 12) |
| M8 | no `noneYet` | survived | survived (all 12) |
| M9 | retired worded as a copy's | survived | survived (all 12) |
| M10 | `coversRun` ignores `retired` | survived | survived (all 12) |
| M11, M12 | `show.done` drops `retired` | survived | survived (chain-stopped-copy) |
| M13 | widening keeps `retired` | survived | survived (chain-stopped-copy) |
| M14, M15 | `goingText` loses the retired words | survived | survived (chain-stopped-copy) |
| M16 | Settings' widen button gone | survived | survived (chain-stopped-copy) |
| M17 | `doneRetired` dropped | survived | survived (chain-stopped-copy) |
| M18 | `doneOf` looks at every pool | caught (lovejoin-retired) | |
| M19 | `doneOf`'s classic pool not retired | survived | survived (chain-stopped-copy) |
| M20 | `done` drops `retired` | survived | survived (chain-stopped-copy) |
| M21 | the launch joins and copies retired pools | caught (lovejoin-merged-screens) | |
| M22 | `LovejoinSwitch`: only the classic pool is ADA's | survived | survived (all 12) |

## Covered

**Which button still works, state by state, as traced:**

| State | What works | What's refused, and why |
|---|---|---|
| A retired pool with the wallet's boxes | Bring one back now; Bring every box in this pool back now; Settings' every pool's; its scheduled returns | Mix's Review, both Mix agains and Pay anyway are off, with `lj.unusable.warn.retired` under them; no Bootstrap is offered |
| Its Bootstrap released, or a collateral's tail ended there | Its boxes come back by themselves (the worker holds nothing there, so no Bootstrap callout and no "not mixed yet") | — |
| Its boxes can't pay their own way back | The callout's paid Bring one back; Bring every box back pays from the private balance | Bring one back now isn't offered there (words: screens#1) |
| The retired pools' run going | Settings: its words, Stop, and the widen button; a retired pool's page: Stop (words: screens#3) | A v2 pool's page: its link off, with "Another pool's boxes are coming back now…", as the worker refuses it (`lj.bringOtherPool`) |
| Stopped by Stop | Settings and a retired pool's page say "Stopped: N sent back." and offer their own runs | — |
| Stopped by itself | Both pages say why and offer Try again (screens#0) | — |
| Ended | "Done: N back…" or "Nothing of yours was left in the retired pools" (Settings) and "…in this pool" (the page) | — (the token pool's page: screens#11) |
| Nothing left | Retired pools leave the hub; the classic pool's page stays reachable only if already open | — |
| No 5 ₳ pool yet | "No pool to mix in yet." when nothing is listed; Start a pool | (screens#13) |
| The floor not reached | v2 pool's page: Bootstrap leads, Mix says why; the row's "Being started" meter | — |

**Checked and sound:**
- **`shownOnHub`, `isRetired`, `isCopy`, and the classic pool's `unusable` in `poolsOf`.** Rendered, and the tests catch M1–M3.
- **The hub.** A retired pool is hidden with nothing of the wallet's there and listed with its boxes. Its row has the reason and no start-up meter. Groups follow `groupPools`' order, and the search goes by token. Rendered through the harness, and read.
- **A retired pool's page, rendered for a token pool and the classic one:**
  - Review is off, with the reason under it. Both Mix agains and Pay from my private balance anyway are off, with the reason.
  - No Bootstrap link, form or lead, and no `lovejoin-bootstrap-most` request.
  - Bring one back now is on: the worker's `sortOut` gives a retired pool no `notMixed`, `unsure`, `deposits` or `bootstrap`, so `nowRefused` can't trigger. The `NotMixed` and `BootstrapHeld` callouts, and their "never come back by themselves", don't show there.
  - Bring every box in this pool back now goes with `retired`, and the launch link is private.
- **The worker's side of those screens:**
  - `status` lists a retired token pool by `listedHere`, and `held()` marks retired pools.
  - `bringAllBack` refuses a v2 pool's run while the retired pools' run goes, joins a retired pool's, and widens to Settings' every pool.
  - `withdrawNow` refuses in words while a withdraw may still be on its way.
- **The launch.** `same` and `copy` read v2 pools alone, as the worker's `terms` and `build` do, and the tests catch M21. The 10 ₳ rule's words in en, es and ja drop "or mix in the classic pool". A 10 ₳ ADA start is refused before Review.
- **`LovejoinSwitch` and `partsText` with the 5 ₳ pool named and valued.** Read; the existing worker test "takes its spare ADA into v2's 5 ₳ pool, named and valued for its review" covers the summary's side.
- **Words:**
  - Every new key exists in en, es and ja with its plural forms (es `_many` too).
  - The 10 ₳ → 5 ₳ values changed in all three: the dApps tile, Lovejoin's aside, Settings' note, the connector's lines.
  - Settings' note, floor and collateral lines were read against the 5 ₳ pool's rules: below its floor, returns come back directly, as the floor line says.
  - The new `.warn.` keys are in `critical-keys.json` and both `verified-critical-*.json`, checked for presence only.
- **Home's rows.** `Home.tsx` is unchanged. A retired pool's row shows while the pool holds the wallet's boxes, as any pool's does.

## Not checked

- **Playwright.** The mutations ran against unit tests only. The e2e may catch some survivors (tests-e2e lens).
- **The back-translations of the critical values that changed 10 ₳ → 5 ₳**: `dappUi.back.privacy.noteLovejoin`, `noteLovejoinMixed`, `dappUi.private.privacy.staysLovejoin`. That's the words lens.
- **The connector's reviews**, beyond the changed words.
- **Layout at panel width.** No browser.
- **Home's classic `notMixed` count, as 1.7 kept it, while the retired pools' run goes.** I read this and didn't test it. The run doesn't call `sortOut`, so Home may say "not mixed yet · Not on their way back" for boxes being brought back, until the run ends or a pool read. Worker lens.
- **The `retired` dependency in BringAllBack's `useEffect`.** No DOM in the unit tests.
- **The data layer's and core's copies** (pr363 lens).
