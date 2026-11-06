# 1.8.0's release review: the connector lane's fixes

- **Branch:** `review-1.8.0/fix-connector`, in `…/scratchpad/fix/connector`, from `1beba3fb`.
- **Head:** `1214cab72c6a4ed25e90741e1ba2b694b48580d9`.
- **Commits:**
  - `7886034a` fix(web-wallet): the connector says spare ADA is mixed only where v2's 5 ₳ pool takes a box (O3, W5)
  - `1214cab7` test(web-wallet): the connect window's hedge, and its plain words where v2's 5 ₳ pool takes a box (O3)
- **Logs, scripts and patches** are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/connector-logs/` and `…/scratchpad/connector-scripts/`.
- Every command below ran from the worktree's `seedelf-platform/seedelf-web-wallet/extension`.

## O3: the connector promised the mix on Settings' switch alone (release#2, tests-e2e#0, words#1, cross#8)

**Fixed**, as o3-trace's "What the approval should say" has it.

### What changed

**The funding review's mark.** `sessions.ts` `siteOutBuild` now hands its summary `lovejoinRoom: true` (`rpc.ts` `SessionOutSummary.lovejoinRoom`) where the new private `lovejoinRoomNow(network, params)` says the 5 ₳ pool takes a box of the spare ADA now. That's priced's rule at Review:
- `adaPool(network, true)`: asked, as a return asks. At the merge this is where the find lane's look comes in. Nothing else of the ask's build is relied on.
- `usable(network, [ada], params)`: usableNow, as o3-trace asked.
- `room(network, ada.id)`: one pool read, kept for `POOL_ROOM_MS`.
- `poolShort(network, room, depth)`: Settings' depth, three a mix. That's the floor and the room, as priced's `skipped` reads them.

It holds on any collateral switch. It reads only where Settings brings sessions back through Lovejoin (`through`). A failed read counts as short, never as taking a box. A trap is handed on. `siteOutBuild` now reads the parameters once, for the funding, its reserve and the mark, so it makes fewer requests than before.

**The card's mark.** `dapp.ts` `enable()` builds the connect approval with `lovejoinRoom: true` (`rpc.ts` `DappAsk`'s connect) from the new public `sessions.ts` `lovejoinRoomKept(network)`. That's a quiet read: no request, and discovery isn't asked, so no look is tied to a site's connect.
- It needs `collateralPoolTakes(network) === "yes"`. That checks only what's kept: the pool shown, taking new boxes as last measured, the data layer's last count at the floor, and a pool read within `POOL_ROOM_MS` with room for the collateral's mix.
- Then it needs that kept read's room for a box at Settings' depth (`poolShort`). `room()` answers from the kept read at once.
- Nothing read lately gives no mark.
- It's computed before the `asking` check, so "nothing is awaited from here until it's asked" still holds.

**The screen** (`DappApprovals.tsx`).
- **The card:** `dappUi.private.privacy.staysLovejoin`, joined (`joinSentences`) with the verified `swaps.lovejoin.privacy.onPoolShort` wherever the approval carries no mark.
- **The review:** `FundingWayBack` keeps its rows. Its note is the new critical `dappUi.back.privacy.noteLovejoinPoolShort` wherever the summary has no mark. With a mark, it's `noteLovejoinMixed` with the collateral's mix, else `noteLovejoin`. Settings off gives `noteDirect`.
- The direct words are never used for the hedged states.

**The new note** (en): "From the dApps page. Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later, if its pool has room by then. What isn't mixed comes back at once. Settings → Lovejoin turns that off."
- **One change from o3-trace's draft:** "What isn't mixed comes back at once" in place of "The rest comes back at once".
- **Why:** with the collateral switch on, the return may still mix the 5 ₳ kept aside in every hedged state (o3-trace's "later" row). "The rest" reads as including it, so it could turn false. "What isn't mixed" holds either way, and keeps 1.6.0's rule: never say the 5 ₳ comes back at once where a pool may take it.
- It names no collateral (W5), and it carries a negation, which es "no" and ja "ない" keep.
- es and ja are drafted in the house's words (es "si el pool de Lovejoin tiene sitio para entonces", ja "戻る時点で Lovejoin のプールに空きがあれば", onPoolShort's phrase), `machine` in both provenance files.

### The tests

The new file is `tests/connector-lovejoin-review-fixes.test.ts`, with 21 tests. It uses the real worker and WebAssembly, and v2's 5 ₳ pool from `v2-pools.ts`, after o3-trace's scratch.

**The review's mark: o3-trace's rows, and more.**
- A pool that takes a box: marked, the plain words, and its return mixes.
- No pool: hedged, and the return comes back directly with `noAdaPool`.
- A pool discovery hadn't kept, found by Review's ask: marked.
- Under the floor (preprod's set to 30, with 22 strangers): hedged.
- Room for the collateral's mix but not for a box (5 strangers): hedged.
- A pool `usableNow` refuses: hedged.
- A failed read (504 on the pool's credential): hedged.
- Collateral switch off: a taking pool and none now get different words. o3-trace's last row had them the same.
- Settings direct: no pool read at Review.
- A trap: handed on.
- "Later" (no pool at Review, one with room by the return): the hedge said held.

**The card's mark, through `DappService.enable()`, with no Koios call during the connect:**
- with nothing read lately, not marked;
- after a review's read that found room, marked;
- that read past `POOL_ROOM_MS`, not marked;
- a kept read with room for the collateral but not for a box, not marked;
- a kept read under the floor, not marked;
- no pool, not marked;
- a pool discovery hasn't kept, not marked, and discovery isn't asked.

**The screens.** The card is rendered through `ConnectRequest`, its choice seeded "private":
- plain with the mark;
- hedged without it;
- es and ja joined as each language joins sentences;
- direct with Settings off.

The review's note is checked in each mark and collateral state, plus W5 (below).

**Commands and results:**
- **At the base**, with the test file alone: `npx vitest run tests/connector-lovejoin-review-fixes.test.ts --maxWorkers=2` gave 14 failed and 5 passed (19 tests then; `base-new-test.log`).
  - They fail for the finding's reason. The review received "…back in 5 ₳ boxes hours later. The rest and the 5 ₳ come back at once." with no pool, under the floor, in (c), with a pool that takes no new box, and on a failed read. The card received the line with no hedge. No mark existed.
  - The 5 that pass are the "not marked, no read" guards: the base marks nothing and reads nothing there.
- **With the fix:** 21 passed.
- **Revert check:** `git apply -R fix.patch` (the fix's `src/` and `docs/i18n/` alone, tests kept) gave 15 failed and 6 passed (`revert-new-test.log`). Restored, `git diff` matched the patch byte for byte.
  - The 6 that pass are:
    - "Review reads no pool" with Settings direct;
    - the five card "not marked" cases.
  - Four of those six are killed by mutants: M1, M2, M3 and M9 below.
  - The card's no-pool and under-the-floor cases are behaviour pins, whose guard is also `collateralPoolTakes`'s own.
- **Mutants:** `python3 -I connector-scripts/mutate.py "$PWD"`. Each one was applied alone, the file run, then put back. **14 of 14 killed** (`mutants.log`):
  - M1, a "maybe" counted as room: 2 tests fail.
  - M2, the card without the room rule for a box: 1 fails.
  - M3, the connect asking discovery: 1 fails.
  - M4, Review not asking: 1 fails.
  - M5, no `usableNow`: 1 fails.
  - M6, Review without the room rule: 2 fail.
  - M7, a trap swallowed: 1 fails.
  - M8, a failed read counted as room: 1 fails.
  - M9, a read with Settings direct: 1 fails.
  - M10, the mark not carried on the approval: 1 fails.
  - M11 and M12, the card never or always hedged: 2 fail each.
  - M13, the review never hedged: 8 fail.
  - M14, the review hedged on Settings' switch alone: 3 fail.

**The pins I updated** (o3-trace's and lows-b's). With the fix and before these updates, 7 failed in these 4 files; after, 128 passed. Each test there now gives its summary `lovejoinRoom: true` where it's about a pool that takes the ADA, and the literals say "kept aside":
- `approvals-review-fixes.test.ts`: the three way-back tests. The vacuous guards `not.toContain("the 5 ₳ come back at once")` now read `"the 5 ₳ kept aside come back at once"` (lows-b's warning).
- `dapp-prompt.test.ts`: the way back's helper.
- `screens-wiring-review-fixes.test.ts`: the site funding's summaries, plus two hedged cases wired through `ConnectRequest`.
- `collateral-reserve-review-fixes.test.ts`:
  - `:1052`, the guard moved to the new phrase;
  - `:1056`, the no-pool note now pins the hedge;
  - `:1267`, the failed-read site case: it was the old "only if enough is left" note. It's now the hedged note, never the 5 ₳ said back at once, with `collateralMix` still `ifLeft`.

**The e2e** (`e2e/extension.spec.ts`).
- **The connect test.** Its world is preprod at `1beba3fb`: the bundled v2 5 ₳ pool `47bece42` is known and empty there. It now asserts the card's whole line with the hedge, and the review's `dapp-funding-way-back` hedged note.
- **The sibling**, "a site's private session where v2's 5 ₳ pool takes a box…", puts the classic pool's 20 recorded boxes at the bundled pool's mix_box (taken from the head start), as strangers'. It asserts:
  1. the card hedged, with nothing read yet;
  2. the review's plain mixed note;
  3. Decline, wait for the window to close, then dApps' "Let it ask now";
  4. the next connect's card plain, from the read kept within five minutes.
- **Commands and results:**
  - `npm run build:ext`, then `npx playwright test --project=extension -g "a site connects to a private session instead|where v2's 5 ₳ pool takes a box" --workers=2`: **2 passed**.
  - **At the base** (`git apply -R fix-src.patch`, rebuild): **2 failed**, both on the card. It expected "…back hours later. Only if Lovejoin's pool has room when it comes back." and received the line without it. That's the promise in a world where the pool takes nothing (`e2e-base.log`). Restored and rebuilt.
  - **Stress, dev build:** `taskset -c 0,1 npx playwright test … --workers=2 --repeat-each=3` gave **6 passed**.
  - **Stress, store build:** `VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npm run build:ext`, then the same: **6 passed**.
  - **The whole "the dApp connector" describe:** 12 passed and 3 failed, on both builds.
    - The 3 are `:5311`, `:5353` and `:5374` at my head (`siteSessionHolding40`, `fivePool` on preprod). They fail on "Through Lovejoin2 boxes of 5 ₳" against a direct return.
    - They fail identically at the base (`e2e-base-d6.log`). That's D6, the e2e lane's, not this change.

### adapool#3's connector half

Refuted by o3-trace. No change.

## W5: "the 5 ₳" (the collateral) next to "5 ₳ boxes" (words#6)

**Fixed.**
- `dappUi.back.privacy.noteLovejoin` and `noteLovejoinMixed` now say "the 5 ₳ kept aside" in en, es ("los 5 ₳ apartados") and ja ("確保分の 5 ₳"), as `noteDirect` does. The values keep their U+00A0 in "5 ₳".
- A character diff against the base shows only the inserted words.
- The new hedged note names no collateral.
- **The test:** "W5: no note leaves the collateral's "5 ₳" next to "5 ₳ boxes"" in the new file.
  - It fails at the base: "expected … to contain 'the 5 ₳ kept aside'".
  - It passes with the fix.
  - It fails again under the revert check.
- The pinned literals were updated, as above.

## W10: DappApprovals.tsx's stale comments

**Fixed.** `FundingWayBack`'s doc comment and `ConnectRequest`'s comment no longer say "a 10 ₳ box": it's a box of v2's 5 ₳ pool now, and each says when the words hedge. Comments only, so no test.

## Awaiting blind back-translation

Each key is shown in one frame: the connect window's private-session funding review, the note under "Later, to bring it back" (`FundingWayBack`, `dapp-funding-way-back`). It's present tense, before anything is sent, and never saved by the worker.

1. **`dappUi.back.privacy.noteLovejoinPoolShort`**, new, es and ja. Shown where Settings brings sessions back through Lovejoin and Review read no room for a box of the spare ADA:
   - no 5 ₳ pool;
   - under the floor;
   - too few boxes free;
   - a pool that takes no new box;
   - a read that failed.

   It's listed provisionally in both `verified-critical-{es,ja}.json` `keys`, appended at the end, with `reviewer` untouched. `machine` in both provenance files.
2. **`dappUi.back.privacy.noteLovejoin`**, value changed in es and ja (W5). Shown where Review read room for a box and no collateral's mix is planned: Settings' collateral switch off, or the pool won't take the collateral.
3. **`dappUi.back.privacy.noteLovejoinMixed`**, value changed in es and ja (W5). Shown where Review read room for a box and the collateral's mix may go (`collateralMix`).

Keys 2 and 3 are the ones W6 already owes a fresh round for (10 → 5 ₳). My edit comes before that round, as lows-b advised.

Not new and not changed: `swaps.lovejoin.privacy.onPoolShort` gains a frame, joined after `dappUi.private.privacy.staysLovejoin` on the connect window's private card. o3-trace read it there in all three languages and judged it needs no new round. My test asserts the join (a space in es, none in ja).

## For the lead

- **The find lane's ask.** `lovejoinRoomNow` calls `adaPool(network, true)`. Once find's look is merged, a site's funding review may look at Koios's holder (throttled) while no 5 ₳ pool is kept, collateral switch on or off. o-design §3 step 6 accepts it, and its §3 step 9 policy words ("a review and a funding also look") cover it. Both my calls pass `room()` an id, so find dropping `room()`'s default is compatible.
- **The card's quiet mark** leans on `collateralPoolTakes`'s "yes" meaning a pool read kept within `POOL_ROOM_MS`, which `room()` then answers from with no request.
  - Only a read crossing its five minutes between those two calls, microtasks apart, would read again. That's a pool read, never a look.
  - A quiet accessor in `lovejoin.ts` (say `room(network, pool, { quiet })`, find's function) would make it explicit. It's optional.
- **Privacy policy.** With the collateral switch off, a site's funding review now reads Lovejoin's pools once (one listing of every pool, as a swap's Review always has). Before, it read none there.
  - It's the same request, the same for everyone. The policy's "Lovejoin's pools when you use Lovejoin" covers it, so I added no entry.
  - The look at the merge is D2's, per o-design §3 step 9.
- **The e2e lane.**
  - My sibling builds its strangers at the bundled pool's mix_box inline (a cast of `HEAD_START`; `fiveAt` and `lovejoinPool` are used, not changed). Once the e2e lane's `fivePool` does that on preprod (their D6 fix), those lines can become `fivePool(context, koios)`.
  - Neither of my two tests depends on the find lane's look: the bundled pool is kept, so no look runs.
  - The three connector tests that fail at the base (`:5311`, `:5353`, `:5374`, D6) are theirs.
- **Lanes meeting in `sessions.ts`.** `tailReserve` is the share lane's. I changed only its call in `siteOutBuild` (passing `params`). `priced` is untouched: my rule restates it, so a narrowing find makes to `priced`'s `skipped` doesn't reach the connector. Re-read `lovejoinRoomNow` against the merged `priced` if its rule changes.
- **W10's rest**, outside my lane: `rpc.ts:1671` (`SwapLovejoin`'s doc, "the 10 ₳ boxes"), `rpc.ts:2057` (`SessionBackSummary.lovejoin`, "(10 ₳ each)") and `Swaps.tsx:1650`.
- **i18n merge.** My three keys sit next to their related keys in en, es and ja. Re-run `node scripts/i18n-critical.mjs --write` after the JSON merge: it adds `dappUi.back.privacy.noteLovejoinPoolShort` to `critical-keys.json`, as it does here.
- **Not done, deliberately.** The card keeps the approval's mark. Back from a review that read room still shows the hedge until the next connect. A card that followed the review's later read would agree with it, but the brief carries the mark on the approval, so I left it.
- **critic#6** (Settings' row on the switch alone) is the owner's. Untouched.
- **One slip.** Once, I ran read-only `git log` and `git diff --stat` in the e2e lane's worktree, to see whether `fivePool` had changed yet. Nothing was changed, and I ran no other git command outside my worktree.

## Checks run

- **`npx tsc --noEmit -p .`:** clean, at the head (it includes `e2e/`).
- **Every test file the change reaches, plus the i18n and words files**, 49 files, at the head:
  - `npx vitest run <49 files> --maxWorkers=2`: **49 passed, 847 tests**.
  - The same with `VITE_ENABLE_MAINNET=false`: **49 passed, 847 tests**.
  - The files are `connector-lovejoin-review-fixes`, `approvals-review-fixes`, `collateral-reserve-review-fixes`, `screens-wiring-review-fixes`, `dapp-prompt`, `sessions`, `lovejoin-planner`, `tx-view` and `run-traps-review-fixes`, plus the dapp-, session- and site- files that reach `siteOutBuild`, `enable` or the connect window, and `i18n*`, `words` and `worker-words` (`final-mainnet.log`, `final-preprod.log`).
- **The i18n and words files alone:** 10 files, 191 tests, on both builds.
- **Playwright, the two connect tests:**
  - dev build, `taskset -c 0,1 … --workers=2 --repeat-each=3`: 6 passed;
  - store build, the same: 6 passed.
- **Playwright, the connector describe:** 12 passed and 3 failed (D6, identical at the base) on each build.
