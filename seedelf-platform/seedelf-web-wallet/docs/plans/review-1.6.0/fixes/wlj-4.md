# Fixer `wlj-4`: pools, starts, widths and the 1.5.0 gate (Lane L, last)

Findings 318-worker#0, 318-worker#1, 318-worker#3, 319-worker#0, 319-worker#3 and x-compat#2.

- The code is in `background/lovejoin.ts` and `lovejoin-launch.ts`.
- Small anchored hunks went into `sessions.ts` (`mixOutBuild`, `againBuild`, `mixFunding`, one comment in `lovejoinCost`) and `account.ts` (`readAccount`'s options).
- `rpc.ts` gained two additive fields.
- The start's review got one new component in `ui/screens/LovejoinLaunch.tsx`.
- I ran no cargo and changed no Rust. **No test of mine needs the pkg rebuilt.**

## Findings

| id | status | change |
|---|---|---|
| 318-worker#0 (medium) | partly: the worker half is fixed | `PendingTx.bootstrap?: true`. `publicStart` returns whether the review it kept was a Bootstrap (that review is deleted there, so `publicSubmit` couldn't read it later). `publicSubmit` puts the field on the PendingTx it hands Home and on the watch. `take` keeps the record whole and `shown()` strips only the fields it lists, so Home's watch answers with it, sent and confirmed. The kind stays `lovejoin-mix`: the feed, `LOVEJOIN_KINDS` and MERGED-5's `depositLanded` hold all key on it. **The banner's words are the screens round's**: no existing key fits (see the notes). |
| 318-worker#1 (low) | fixed, a warning in place of a refusal (owner's call 1) | Each start's record keeps its values (`LaunchRecord.box`: lovelace and token with quantity), and `reviewed` when Send sent the build without the certificate in its place. `build()` finds the wallet's own start of the same values that no look has found yet and that's under `STARTED_SAID_MS` (a day) old. It puts it on the review (`LovejoinLaunchSummary.startedBefore: {txHash, at}`), and the review shows a `Callout tone="warn"` (`lovejoin.launch.warn.startedBefore`). Nothing is refused. **The finding's second route** (Send asked again with the reviewed hash after the bare build went) now says `worker.spend.sentAlready`, never "isn't ready to send. Review it again." |
| 318-worker#3 (nit) | fixed | One `epoch_params` read per review. **A pool's start:** `build()` hands its parameters to `readContract` (private) and to `readAccount`, which gained a `params` option (public). **A mix from the private balance**, any pool, a Bootstrap included, and **Mix my boxes again**: `mixOutBuild`/`againBuild` read once, as a swap's review does (34e's review, 9), and pass it to `privateBootstrapMost`, `fits` and `againBoxes` (each gained an optional `known`) and to `mixFunding`, which passes it to `tailReserve` and `buildFunding`. Before, a token-pool mix read three times (takesNewBoxes, tailReserve, readContract), not two: `tailReserve` reads whenever Settings' collateral switch is on, a 5 ₳ pool shown or not. |
| 319-worker#0 (low) | fixed | In `wayOver`, when three takes no box either (the sum of three's fits under 1), the answer is `{ width: 3 }` with no reason, whatever four pays. So a swap's approval and Stop's cost never carry "…so this mixes three at a time" beside the pool-short skip. Chains are unchanged: `attempt(3)` still throws three's need (34e's review 7's test passes unedited). `lovejoinCost` then keeps the width asked "for its return to decide", as its comment already said of "nothing paid for" (owner's call 2). |
| 319-worker#3 (low) | fixed (tests only, no bug found) | Two tests of a return across pools stopped partway. A lock cuts it after the token leg: `cuts()`, `unscheduled` 2, no `unscheduledIn`, the classic leg held as not mixed, a token leaf comes back by itself. It stops inside the token leg: `chainEnded` stopped, `unscheduled` 2 and `unscheduledIn {token: 1}`, each pool's unmixed box held in its pool. A status read counts nothing twice. |
| x-compat#2 (low) | fixed | The gate gains a case run with the bundled head start's pools handed over, as sw.ts's discovery hands every preprod wallet before its first look: MIN 4.5 ₳ and the 5 ₳ ADA pool. Its plans and its vault's nine hours are compared against **the same 1.5.0 record**, nothing re-recorded, with only what a shown pool adds by design left out (listed below). Record mode now refuses unless `package.json`'s version is 1.5.0. The gate's two original cases and its fixture are untouched. |

### What the gate case leaves out, and why (x-compat#2)

I first ran a probe of the gate with the head start's pools handed over (deleted). It differed from 1.5.0's record only in:

- **Plans:**
  - `funding`'s `collateralReserve`/`collateralPool` wherever a preprod mix makes mixes: the Mix form's 5 ₳ pool field, reserve's.
  - The swap quote's `ways`/`values`/`fund`: as the user types, MIN's boxes are funded beside the swap. Its `ifStopped` grows too, since a stop would bring their ADA back through the classic pool.
  - The swap review's `ways`: at Review, MIN's pool is empty, so MIN comes back directly.
  - Every other figure, every return's review and every chain's transactions matched exactly.
- **The vault after the update:** no send and no schedule differed. Only these did:
  - the requests: each pool read names all three mix boxes, the return reads the pools once more for its collateral's 5 ₳ pool, and a token pool's read asks the parameters;
  - status's `pools`, in the trace and in the restore.
- The case strips exactly these, from both sides, and compares the rest whole.
- It also asserts that the stripped parts are as expected: the 5 ₳ pool's id at every preprod depth ≥ 1, none on mainnet; MIN's way in the quote and none at Review; both pools listed by status. So the wiring can't silently do nothing.
- The optional second case (a populated 5 ₳ pool) isn't done. There the 1.5.0 session's return takes the collateral's tail, and one classic withdraw goes 60 s earlier, because the leaf's draw shifts the seeded generator. It can't meet the record without re-recording.

## Tests, fail-before, and mutation checks

Every mutation below was undone with Edit, the tests rerun, and the hunk put back with Edit. A grep afterwards found none left.

| finding | test (file › name) | fail-before (today's code) | mutation check |
|---|---|---|---|
| 318-worker#0 | `lovejoin-flows.test.ts` › Bootstrap… › "is named a Bootstrap in Home's watch, sent and once its deposit is in, where a mix isn't (1.6.0's release review, 318-worker#0)". It covers the real `publicBuild`/`publicSubmit`/`pumpPublic` and `PendingService.pending` as sw.ts wires it, and an ordinary public mix | `AssertionError: expected { kind: 'lovejoin-mix', …(5) } to match object { kind: 'lovejoin-mix', …(1) }` (`- "bootstrap": true`) | the spread in `publicSubmit` removed: the same failure |
| 318-worker#1 | `lovejoin-flows.test.ts` › a pool's start › "says on the review that the wallet started a pool of these values no look has found yet, and refuses nothing (…318-worker#1)". It covers a start of MIN 1000 at 4.5 ₳ sent, then the same values 5 min on (warned, `{txHash, at}`), other ADA, other quantity and an ADA pool (none), and a day on (none) | `AssertionError: expected undefined to deeply equal { …(2) }` | the summary's `startedBefore` spread removed: the same failure |
| 318-worker#1 | `lovejoin-flows.test.ts` › a pool's start › "says a start Send sent in its review's place went already, never to review it again (…318-worker#1)" | `expected [Function] to throw error including 'That was sent already, so it isn't s…' but got 'That pool's start isn't ready to se…'` | `submit()`'s `reviewed` check removed: the same failure |
| 318-worker#1 | `lovejoin-screens-review.test.ts` › "a pool's start's review says the wallet started one of these values no look has found yet (…318-worker#1)" › "warns that if both go through the later is a copy, and says nothing where none was" | `Error: Element type is invalid … got: undefined` (no warning on the review) | `LaunchStartedBefore` returning null when set: `expected '' to be 'You started a pool of these values ea…'` |
| 318-worker#3 | `lovejoin-flows.test.ts` › a pool's start › "reads the parameters once in its review, from either side (…318-worker#3)" | `AssertionError: private: expected 2 to be 1` | private `readContract` without `known`: `private: expected 2 to be 1`; public `readAccount` without `params`: `public: expected 2 to be 1` |
| 318-worker#3 | `lovejoin-flows.test.ts` › a mix from the private balance into a token pool › "reads the parameters once in its review, as a swap's does, whichever pool and whether a Bootstrap (…318-worker#3)". It covers the token pool, the classic pool, a Bootstrap of each | `{"pool":"c585…"}: expected 3 to be 1` | `mixFunding`'s `tailReserve` without `params`: `expected 2 to be 1`; `fits` not passing `known` to `takesNewBoxes`: `expected 2 to be 1` |
| 318-worker#3 | `lovejoin-planner.test.ts` › 34e's review findings › "reads the parameters once at Mix my boxes again's review from the private balance, as a swap's (…318-worker#3)" | written after the fix. Its fail-before is the mutation | `againBuild` not passing its read to `mixFunding`: `expected 3 to be 1` (today's code reads 2) |
| 319-worker#0 | `lovejoin-planner.test.ts` › 34e's review findings › "gives no reason for three where three takes no box either, so nothing says it mixes three at a time (…319-worker#0)". A unit test of `wayOver`: no room at either width (one leg and two), three with room (FOUR_SHORT kept), four costing more (FOUR_COST kept), nothing paid for | `expected { width: 3, …(1) } to deeply equal { width: 3 }` (`+ "fellBack": "…so this mixes three at a time."`) | `wayOver`'s original branches put back: the same failure |
| 319-worker#0 | `lovejoin-planner.test.ts` › same describe › "says on a swap's approval that its ADA comes back directly, never also that it mixes three at a time, where the pool has room at neither width (…319-worker#0)". It covers a MIN→ADA swap's real `outBuild` at Settings' four with 3 free classic boxes (skipped `sess.skip.warn.poolFree`, no `fellBack`, 0 boxes), then Stop's cost of a swap approved four wide | `expected 'Lovejoin's pool hasn't enough boxes…' to be undefined` | as above |
| 319-worker#3 | `lovejoin-pools.test.ts` › the list of mixes › "a return across pools stopped partway (…319-worker#3)" › "drops the classic leg's due times alone, once a lock cuts it after the token leg, and holds its boxes as not mixed" | passes before: a test-only finding | `unfinished()` counting every pool's leaves: `expected { …(15) } to match object { cut: true, unscheduled: 2 }` |
| 319-worker#3 | same › "drops each pool's unmixed boxes' due times in its own pool, once it stops in the token leg" | passes before | `unfinished()` as above fails it too. `unschedule()` writing every pool to `unscheduled`: `expected { …(15) } to match object { unscheduled: 2, …(1) }`. `unscheduleUnfinished()` for the classic pool alone: the same |
| x-compat#2 | `lovejoin-1-5-0.test.ts` › with the token pools every preprod wallet is handed shown (…x-compat#2) › "plans every return and mix as 1.5.0 did, but what a shown pool adds of its own" | a gap, no bug: passes before | `funding()` adding the 5 ₳ pool's reserve into `lovelace` when shown: `expected [ …(33) ] to deeply equal []`. The unwired original passes |
| x-compat#2 | same › "finishes a 1.5.0 vault left mid-flight by an update as 1.5.0 did, its sends and schedules alike, and a restore finds what 1.5.0's found" | passes before | the finding's own: `withdrawDue` drawing one extra delay per shown token pool fails this case (`expected { Object (trace, restored) } to deeply equal …`), while the original unwired gate passes |

**The record guard** (x-compat#2) has no test: running `RECORD_1_5_0=1` is what it guards, and if it were wrong, the run would overwrite the fixture ("record nothing from this tree"). Read only. At 63f87b8 `package.json`'s version is "1.5.0" (`git show`), so recording there is unchanged. Everything this case adds runs after the record branch's `return`, and the bundled head start is read lazily, so the file still records in a 63f87b8 worktree.

### Existing test adapted

`lovejoin-flows.test.ts`, "starts a pool from the public account, and names its pool to Koios only at Send (34d's review 7)". Its exact `toEqual` of the sealed `launches` gains the new `box` field (`{ lovelace: "4500000", token: { …MIN, quantity: "1000" } }`). Nothing else changed.

## Files touched

- `extension/src/background/lovejoin.ts`:
  - `STARTED_SAID_MS` exported;
  - `LaunchRecord.box` and `.reviewed`;
  - `publicSubmit`/`publicStart` (the Bootstrap mark);
  - `privateBootstrapMost`, `fits` and `againBoxes` take `known`;
  - `wayOver` and its doc.
- `extension/src/background/lovejoin-launch.ts`:
  - the header's list of checks;
  - `LaunchDeps.lovejoin` adds `launches`;
  - `build()` (the found pools read once, `startedBefore`, its parameters handed down);
  - the new private `startedBefore`;
  - `fromPrivate`/`fromPublic` take `known`;
  - `submit()` (the `reviewed` check, and the record's `box` and `reviewed`).
- `extension/src/background/sessions.ts`, small anchored hunks:
  - `mixOutBuild` and `againBuild` (one read, passed down);
  - `mixFunding(network, funding, params)` (to `tailReserve` and `buildFunding`);
  - `lovejoinCost`'s width comment.
- `extension/src/background/account.ts`: `readAccount`'s `params` option (additive; every other caller unchanged).
- `extension/src/shared/rpc.ts` (additive): `PendingTx.bootstrap`, `LovejoinLaunchSummary.startedBefore`.
- `extension/src/ui/screens/LovejoinLaunch.tsx`: the exported `LaunchStartedBefore`, rendered on the review after the at-most note.
- `extension/src/i18n/translations/{en,es,ja}.json`: one key.
- `docs/i18n/{es,ja}-provenance.json`: `machine` for it.
- Tests:
  - `extension/tests/lovejoin-flows.test.ts` (5 tests, the import of `PendingService`, the one adapted expectation);
  - `lovejoin-planner.test.ts` (3 tests, the `wayOver` import);
  - `lovejoin-pools.test.ts` (a nested describe, 2 tests);
  - `lovejoin-screens-review.test.ts` (1 test, the import);
  - `lovejoin-1-5-0.test.ts` (the optional `handed` parameter on `wire`/`plans`/`afterUpdate`, the record guard, the comparison helpers, the new describe with 2 tests).

## Keys

- **Critical keys added:** `lovejoin.launch.warn.startedBefore`, in a `Callout tone="warn"` and named `.warn.`. es/ja provenance is `machine`; they need back-translating blind. `node scripts/i18n-critical.mjs` (print only) lists it.
  - en: "You started a pool of these values earlier, and no look has found it yet. If both starts go through, the later one is a copy: never shown, and what it locks is gone for good."
  - es: "Ya iniciaste antes un pool con estos valores, y ninguna búsqueda lo ha encontrado todavía. Si ambos inicios se completan, el posterior es una copia: nunca se muestra, y lo que bloquea se pierde para siempre."
  - ja: "同じ値のプールを先に開始していますが、まだ検索で見つかっていません。両方の開始が完了すると、後のほうは複製になります。表示されることはなく、ロックされた額は永久に戻りません。"
  - The terms match each language's `lj.launch.copy`, `lovejoin.launch.sentNote` and `lovejoin.launch.warn.cost` (es "pool", "búsqueda", "copia"; ja "プール", "検索", "複製", "永久に").
  - A first version said when (`{{when}}`, through `whenOf`). `tests/i18n-critical-helpers.test.ts` then flagged `format.today`/`format.yesterday`/`format.dateAndTime` reached from a warning, so I dropped the time. The hub's own note says when, and the words are shorter. The summary still carries `at`.
- **Other keys added or changed:** none. The second route reuses `worker.spend.sentAlready` unchanged.

## Docs to update

1. **flows.md:528** (Start a pool):
   - The review warns when this device sent a start of the same values in the last day that no look has found yet: if both go through, the later one is a copy, never shown, what it locks gone for good. Nothing is refused.
   - Send pressed again for a review whose start went as the build without the certificate says it went already.
   - One parameters read per review.
2. **architecture.md:424** (`lovejoin.<network>`'s contents): a started pool's record (`launches`) keeps its values (`box`: lovelace, and the token with its quantity) and, where Send sent the build without the certificate, the hash its review showed (`reviewed`). On the device, sealed; no request.
3. **privacy.md:205 and the policy's Lovejoin line:** "whether the wallet started one" is now kept with that pool's values. It's no new request and nothing leaves the device. I think the existing words cover it; the docs lane decides whether a dated Changes entry is needed (owner's rule on data-handling changes).
4. **architecture.md:483** (`TxBanner`, Home's pending banner): a public Bootstrap's watch carries `bootstrap` (`PendingTx.bootstrap`), and Home's banner words it apart (after the screens round). **flows.md:522** (Bootstrap): the banner's words, once the screens round lands them.
5. **lovejoin-mix-width.md:16** (the fallback paragraph) and **:150**:
   - `wayOver` gives no reason where three takes no box either, as when the pool has room at neither width.
   - A swap's approval then records the width asked, for its return to decide (before: three).
   - A chain still goes three, so its refusal quotes three's need.
6. **plans/chunk-34-token-pools.md:545** (the gate):
   - the gate also runs with the bundled head start's pools handed over, compared against the same record, leaving out only what a shown pool adds;
   - record mode refuses unless `package.json` is 1.5.0;
   - 34g's record of this review: 318-worker#0, #1, #3, 319-worker#0, #3 and x-compat#2 as above.
7. **architecture.md:684** (token pools' records): "`tests/lovejoin-1-5-0.test.ts` holds the classic pool to 1.5.0's own record". Add: with no pool shown, and with the bundled head start's.
8. No `privacy.md` change for 318-worker#3: it makes fewer requests, the same kind.

## Calls the owner might overturn

1. **318-worker#1 is a warning, not a refusal** (the owner's rule; the lead's instruction). Details:
   - It knows only this device's starts.
   - It's said for a day (`STARTED_SAID_MS`, the hub's own bound for a start no look finds).
   - It names no time on screen.
   - It's a warn callout on the review, between the at-most note and the privacy callout.
   - The form's Review stays on. A refusal there is what the owner's rule forbids.
2. **319-worker#0 changes what a swap's approval records.** Where the classic pool has room for a box at neither width, four asked:
   - it now records width 4 (as asked), for the return to decide: four if the pool has room by then, else three with the chain's own reason;
   - before, `FOUR_SHORT` made it record three;
   - no figure shown changes, since the approval hides the costs while the pool is short.
   The alternative is to drop the reason in `lovejoinCost`/`priced` and keep recording three.
3. **318-worker#3 moves the parameters read earlier** in a private mix's and Mix my boxes again's review, as `outBuild` does: before the pool read. A classic mix refused at the pool read (the floor, too few free boxes) now has made one generic `epoch_params` request, the same for every wallet, where it made none. Every review that goes through makes fewer requests.
4. **x-compat#2 edits the gate file**, additively: a case, an optional `handed` parameter threaded through `wire`, `plans` and `afterUpdate`, and the record guard. The two original cases, their comparisons and the fixture are byte-for-byte unchanged, and both pass. The populated-5 ₳-pool case isn't done (it can't meet 1.5.0's record without re-recording).
5. **318-worker#0's words aren't done** (the screens round's, as the lead set). No existing key fits both the sent and the done banner. "Into Lovejoin" (Activity's) reads wrong as `what` ("Into Lovejoin sent."), and Home's row's "Bootstrapping · …" needs a count the PendingTx doesn't carry. Until the screens round, the done banner still says "In Lovejoin, on their way to your private balance" for a public Bootstrap.

## Notes for the lead and the screens round

- **No test needs the pkg rebuilt.**
- **The screens round, 318-worker#0:** in PendingBanner, choose `what` and the done title by `pending.kind === "lovejoin-mix" && pending.bootstrap`. Replace `what` itself, since it feeds `sentWaiting`, `notConfirmed`, `maybeSentTitle`, the dropped titles and `partsStoppedTitle`. Suggested:
  - `pending.sent.lovejoin_bootstrap`: "A Bootstrap" ("A Bootstrap sent. Waiting for the network…");
  - `pending.confirmed.lovejoin_bootstrap`: "In Lovejoin, held there until you bring them back".
  - The done one states where money is: name it `.warn.` or `.privacy.` if the round wants it critical (the fix notes' advice).
  - Keep an ordinary mix's words: e2e asserts them (extension.spec.ts:3047, :3061).
- **The screens round, 318-worker#1:** `LovejoinLaunchSummary.startedBefore` carries `txHash` and `at`, should the warning ever name when. Through `whenOf`, that needs `format.*` in the critical-helpers test's `SHARED_WORDS`, or the warning's own date words.
- **The lead:**
  - `node scripts/i18n-critical.mjs --write` picks up `lovejoin.launch.warn.startedBefore`, beside wss-1's two `partsWaiting` keys. `tests/i18n.test.ts`'s three critical-set tests fail until then and until the back-translation (447 against 444 checked in).
  - The gate case reads `src/lovejoin-pools.json`. When `npm run lovejoin-pools` refreshes it at release, the case runs with whatever pools it then bundles. A new token pool there that a recorded plan's swap gets (MIN today) adds that token's way: the strip covers `ways`/`values`/`fund`/`ifStopped` for any token. A bundled token pool of another token changes nothing in the plans.
- **For later fixers in `lovejoin.ts`:**
  - `wayOver` now answers `{ width: 3 }` with no reason wherever three's fits sum below 1;
  - `privateBootstrapMost(network, pool?, known?)`, `fits(…, asked?, known?)`, `againBoxes(…, width?, known?)`;
  - `publicStart` returns `{ chain, bootstrap }`;
  - `LaunchRecord` has `box` and `reviewed`.
- **Seen, not mine:**
  - deep-datum's `tests/lovejoin-discovery-review-fixes.test.ts` (2 tests) and reserve's planner test "is paid for by a site's funding where a 5 ₳ pool would take it…" wait for the rebuild;
  - `npm run typecheck`'s only errors are reserve's `lovejoinDirectCollateralReserve` (`sessions.ts`, `tests/lovejoin-planner.test.ts`);
  - new untracked files from other lanes appeared mid-round (`tests/activity-review-fixes.test.ts`, `wasm/tests/readme_test.rs`).
- **Cleanup:** my probe of the gate (`tests/wlj-4-probe.test.ts`) is deleted. Its outputs and logs sit in the scratchpad (`wlj-4-*`).

## Checks

- **The five files I added tests to** (`lovejoin-flows`, `lovejoin-planner`, `lovejoin-pools`, `lovejoin-screens-review`, `lovejoin-1-5-0`): 156 of 157 on the default build, and 156 of 157 with `VITE_ENABLE_MAINNET=false`. The one failure each time is reserve's planner test (rebuild).
- **The 1.5.0 gate**, `tests/lovejoin-1-5-0.test.ts`: 4 of 4 on both builds. Those are the two original cases, unedited, and the two new ones.
- **The wider set** (`tests/lovejoin* sessions* session-* swap* i18n* words pending* private-refresh collateral* dapp* site* send* move-in* mint* staking* account* public-mix* handlers*`): 116 files, 1,398 passed, 2 skipped, 6 failed, on both builds. The six:
  - i18n.test.ts's 3 critical-set tests (the lead's `--write`, and the back-translation);
  - deep-datum's 2;
  - reserve's planner test.
- **The other files** that read the banner, the `lovejoin-mix` kind, the launch screen or `readAccount` (format, maybe-sent, date-locale, mempool-watch, privacy-notes, parts-send-review-fixes, screens, home-says, activity): 9 files, 256 of 256.
- **`npm run typecheck`:** clean on my changes. The only errors are reserve's two pkg-dependent ones.
- **After every mutation was put back:** a grep for the mutation markers found none, and the fixtures are untouched (`git diff --stat tests/fixtures/` is empty).
