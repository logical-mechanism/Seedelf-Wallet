# Tail lane: #337's way out, *Bring the rest back now*

Worktree `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`, branch `web-wallet/release-1.7.0-fixes`. Nothing committed. Every fix is test-first: each new test failed on HEAD for the finding's reason, or, for a test-only finding, fails under the finding's mutation. Mutations ran in a copy outside the tree, now deleted. The runner script is kept at `scratchpad/fix/mut-tail-run.py`.

## What changed

1. **The view's hold (pr337#0).** `sessions.ts` `view()` carries `collateralHeld` only while no return of the rest went after the session's chain (`chainView(...).cut`). After Bring everything back's direct switch, the line and the button no longer show, whether that return is on its way or has landed.
2. **The press in turn with the runner (pr337#3, x-scen#0).** `skipCollateralMix` now runs whole inside `this.serial`: `tailHeld`, `tailOver`, the pump, then `step("asked")` and `one()` called directly (the queue isn't re-entrant). A runner step that was building the mix again when the press came finishes first, and the press then ends the chain it recorded. The press is never lost.
   - giveme.my can be asked at most once more, by the step already under way. If it signs then, the mix goes, which is the private outcome.
   - I didn't take the verifier's alternative (recordChain records the new tail as over). On its own it leaves a window between the press's `tailHeld` read and its `tailOver` write. With the press serialized it changes only the two-window case below, which is an owner's call.
3. **The critical line (x-priv#3, x-ui#0, x-docs#5, x-scen#2, x-ui#3).** `lj.tail.privacy.wayOut`'s first sentence is now "The collateral's mix hasn't gone yet." That holds in every state that offers the way out:
   - the mix waiting for giveme.my;
   - the mix waiting to be built again: for the 5 ₳ pool's boxes, for the pool to be read, or for the user's press.

   The privacy clause is word for word as before, and U+00A0 now comes before ₳ in en, es and ja. The line is shorter than before.
4. **The way out on a page brought back by hand (pr337#1, x-merge#2, x-ui#1, x-scen#1).**
   - **The button now does what it says.** On a site's page and a by-hand swap's page (`SiteSessions.tsx`, `Swaps.tsx`), the press opens the return's review, as Bring it back does, once the press's answer shows nothing held and the rest at the account. The rule is the new `reviewAfterSkip` in `LovejoinReturn.tsx`. It falls back to the page's own reading when a worker that started afresh has none.
   - **No nested act.** Each page's `buildBack` body became `reviewBack`, an async function without `act`, which the press awaits inside its own `act`. That avoids the nesting the verifier warned about.
   - **A swap or a mix that runs itself is unchanged:** its return goes in the press's own request.
   - **The stop reason is reworded.** `lj.tail.skipped` is now "You chose not to wait for the collateral's mix, so the chain stopped there." It's past tense for "Why it stopped:", and true for both kinds of session while the rest is still at the account.
5. **The mix card (x-ui#2, pr337#5a).** `MixCard` checks the hour itself, through the new `wayOutOffered`, which `CollateralHeldWayOut` uses too. Before the hour there's no empty row. From the hour, the way out sits in a new `.token-row__wide` cell (`styles.css`: `grid-column: 2 / -1; margin: 4px 0 0`), so its button is at the page's 14 px, not the detail line's 12 px.

## Findings

| id | outcome | test that failed before, passes now | files |
|---|---|---|---|
| pr337#0 | fixed | planner: "holds nothing once the rest came back directly another way, its chain stopped at the mix, returning or landed (pr337#0)". HEAD: `collateralHeld {offerAt}` while returning and after landing | sessions.ts |
| x-priv#3 | fixed | planner: "says the collateral's mix hasn't gone, never that giveme.my is what it waits for, where it waits for the 5 ₳ pool's boxes (…)". collateral-held: "names no cause of the wait in any language, and keeps 5 ₳ whole" (HEAD's en, es and ja all name giveme.my) | en/es/ja.json |
| x-ui#0 | fixed | same two tests (duplicate of x-priv#3) | en/es/ja.json |
| x-docs#5 | fixed | same; UNVERIFIED before, reproduced by the planner test (fewBoxes state, held, line names giveme.my) | en/es/ja.json |
| x-scen#2 | fixed | same; UNVERIFIED before, reproduced likewise | en/es/ja.json |
| x-ui#3 | fixed | collateral-held "…keeps 5 ₳ whole": HEAD has U+0020 before ₳ in all three | en/es/ja.json |
| pr337#1 | fixed | planner: "says the user chose not to wait, never that the rest came back, once a site's session's press stopped its chain (…)". Wiring: "on a site's session: the press, the page read again, then its return's review" and "on a swap brought back by hand: the press, then its return's review" (HEAD: no `session-back-build`) | en/es/ja.json, SiteSessions.tsx, Swaps.tsx, LovejoinReturn.tsx |
| x-merge#2 | fixed | same tests (duplicate) | same |
| x-ui#1 | fixed | same tests; UNVERIFIED before, reproduced | same |
| x-scen#1 | fixed | same planner test; UNVERIFIED before, reproduced (the Chains row's reason) | en/es/ja.json |
| pr337#3 | fixed | planner: "never loses a press that came while the runner built that mix again: the chain it built stops at its mix (…)". HEAD: the press's answer still had `collateralHeld`, the rebuilt chain's tail not over | sessions.ts |
| x-scen#0 | fixed | same test (duplicate); UNVERIFIED before, reproduced | sessions.ts |
| pr337#2 | fixed (tests) | planner: "offers the way out once a lock cut the chain…" fails with `tailBuildable` dropped from `tailHeld` (M2). "brings a mix's rest back directly in the press's own request…" fails when the press doesn't step (M3) | lovejoin-planner.test.ts |
| x-scen#6 | fixed (tests) | the two above, plus the wiring tests (each fails with its page's render deleted) and collateral-held's mix-card tests | tests |
| x-mut-ts#1 | fixed (tests) | planner "offers the way out once a lock cut…" asserts the press's and an advance's answers before the hour; fails with one() dropping the hold | lovejoin-planner.test.ts |
| x-mut-ts#2 | fixed (tests) | planner "holds nothing once its mix was sent, on a session that's over, or before its deposit was known in". Fails under each of: the waits-or-buildable check deleted, both closed guards dropped, the landed check dropped (NaN offer) | lovejoin-planner.test.ts |
| x-mut-ts#7 | fixed (tests) | planner "hands on a trap under the press's pump, never swallowing it" fails when the press swallows a trap | lovejoin-planner.test.ts |
| x-mut-ts#3 | fixed (tests) | wiring describe "the way out of a return held at its collateral's mix, wired (1.7.0's release review)". Swap by hand, swap that runs itself, site's session, mix card: each fails with its render deleted | screens-wiring-review-fixes.test.ts |
| x-ui#2 | fixed | collateral-held: "adds nothing before the hour, not even an empty row", "offers it from the hour, outside the detail line's 12 px" | Lovejoin.tsx, styles.css, LovejoinReturn.tsx |
| pr337#5 | fixed: (a) real, fixed with x-ui#2; (b) not a bug | (a) as x-ui#2. (b): Home's unconditional 10 s tick re-renders Dapps, SiteSession and Session; nothing is memoized and no React Compiler is installed. `CollateralHeldWayOut` reads `Date.now()` each render, so the button appears within 10 s of its hour without a Refresh | as x-ui#2 |
| x-ui#4 | not-a-bug | as pr337#5(b): every session page renders under Home, whose tick re-renders it | none |
| x-scen#7 | not-a-bug | same | none |
| x-rel#4 | deferred | The lead runs it live on preprod. No e2e: the fakes serve only the classic pool (a 5 ₳ ADA pool would need its reference and scripts faked), and the hour runs on the service worker's own clock, which Playwright's page clock doesn't reach | none |
| pr337#6 | not-a-bug | Refuted, and I checked the code. `tailChain`'s quiet `readSet(network, true)` reads discovery's stored record (`deps.known`), which keeps a pool once handed over. It fails only when storage can't be read, and the return then fails earlier with its own error. Even then `tailBuildable` counts from `landed ?? ended`, so the return goes within the day. The proposed fix would offer the way out before the deposit is known in | none |

## Files changed (mine)

- `extension/src/background/sessions.ts`: `view()`'s `collateralHeld` line; `skipCollateralMix` (whole). I stayed out of `pump`, `runAll` and `settleReturns`, which the traps lane edits.
- `extension/src/ui/components/LovejoinReturn.tsx`: `wayOutOffered`, `reviewAfterSkip`; `CollateralHeldWayOut` uses `wayOutOffered`.
- `extension/src/ui/screens/SiteSessions.tsx`: `reviewBack` and `buildBack`; the press opens the review.
- `extension/src/ui/screens/Swaps.tsx`: `reviewBack` and `buildBack`; `skipCollateralMix` opens the review by hand.
- `extension/src/ui/screens/Lovejoin.tsx`: MixCard's way-out condition and its cell.
- `extension/src/ui/styles.css`: `.token-row__wide`.
- `extension/src/i18n/translations/{en,es,ja}.json`: `lj.tail.privacy.wayOut`, `lj.tail.skipped`.
- Tests:
  - `extension/tests/lovejoin-planner.test.ts`: a new describe after #337's own test, 8 tests.
  - `extension/tests/collateral-held.test.ts`: 5 new tests.
  - `extension/tests/screens-wiring-review-fixes.test.ts`: a new describe at the end, 5 tests.

## Strings

- **Changed (en, es, ja):**
  - `lj.tail.privacy.wayOut` (**critical**)
    - en: "The collateral's mix hasn't gone yet. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
    - es: "La mezcla del colateral aún no se ha hecho. …" (the rest unchanged)
    - ja: "コラテラルのミックスはまだできていません。…" (the rest unchanged)
    - In all three, only the first sentence and the no-break space before ₳ changed.
  - `lj.tail.skipped` (machine draft; provenance stays `machine`)
    - en: "You chose not to wait for the collateral's mix, so the chain stopped there."
    - es: "Elegiste no esperar a la mezcla del colateral, así que la cadena se detuvo ahí."
    - ja: "コラテラルのミックスを待たないことを選んだため、チェーンはそこで止まりました。"
- **No string added.**
- **Critical key changed: `lj.tail.privacy.wayOut`.**
  - es and ja need a fresh blind back-translation, and the round noted in `verified-critical-{es,ja}.json`. I didn't touch those files.
  - No test fails meanwhile: `i18n.test.ts` checks verified keys by name, and this key was already listed.
- **Old wordings:** grepped tests, e2e, scripts and the store docs. Only my own negative check matches.

## Test runs

- **All pass:**
  - `npm run typecheck`
  - `lovejoin-planner` (87), `collateral-held` (7), `screens-wiring-review-fixes` (43)
  - the i18n suites, `words`, `privacy-notes`, and the screens' and sessions' suites around my changes, about 60 files, one at a time
- **`lovejoin-1-5-0.test.ts` fails, not from this lane.**
  - The failing test is "plans every return and mix as 1.5.0 did, but what a shown pool adds of its own": `mainnet 1: expected 'dc6abe3b…' to be undefined`.
  - The release prep's refreshed `src/lovejoin-pools.json` now bundles a mainnet 5 ₳ ADA pool (`dc6abe3b0b18…`; HEAD's mainnet list was empty). The test asserts no collateral pool on mainnet.
  - Whoever owns the release prep should update that expectation.
  - It also means the collateral's mix, and this way out, are no longer dormant on mainnet in 1.7.0 once that pool shows. Every verifier in this lane rated severity assuming they were.

## e2e and WebAssembly

- No e2e spec edited; why not is in x-rel#4 above.
- No WebAssembly node test added, and no Rust changed.

## Docs (for the docs lanes)

- **`docs/flows.md:522`:**
  - The line says "the collateral's mix hasn't gone yet" and names no cause.
  - The chain's stop reason is now "You chose not to wait for the collateral's mix…"; it still quotes "You brought the rest back without waiting…".
  - "and the rest comes back directly" needs splitting:
    - a swap or a mix that runs itself sends it in the press's own request;
    - a site's session or a swap brought back by hand opens the return's review, as Bring it back does, and the rest comes back once it's sent.
  - The offer goes away once the rest came back another way (Bring everything back with its switch on directly).
- **`docs/architecture.md:634`** ("Sooner on the user's word…"):
  - `skipCollateralMix` runs in the sessions' queue, its `tailHeld` look included.
  - `view()` drops `collateralHeld` once the chain is `cut`.
  - The pages use `reviewAfterSkip`.
- **`docs/development.md:145`,** checklist item 6 (x-rel#4): a line for the live run of the way out.
  - Block giveme.my after the collateral's deposit lands, and wait the hour.
  - Check the line and the button on a swap's page, a site's page and a mix's card.
  - Press: a swap or a mix brings the rest back directly; a site's page opens the review.
  - The chain says "You chose not to wait…", and the 5 ₳ box stays unmixed. Unblocked, Mix my boxes again moves it.
- **Privacy policy:** no data-handling change. The review the press opens reads what Bring it back reads, on the user's press. No dated entry needed.

## Owner's calls

1. **Two windows (pr337#3's R4):** a return review built before the press and sent after it, in another window, still sends the collateral's mix: the later Send wins. Recommendation: keep it. That review showed the mix and giveme.my's role, so sending it does what it showed. Making it fail instead would be a new refusal.
2. **pr337#0's leftovers.** The view fix doesn't end the collateral's tail itself, so:
   - Bring every box back now still leaves that box ("it waits for its mix, a day at most") until its day ends. This is 1.6.0 behaviour.
   - A site's session paid again the same day, whose new chain has no tail of its own, can show the offer again.

   Recommendation: end the tail when a direct return of a started session is sent, in a follow-up, with its LIVE-1 test adjusted. It isn't needed for 1.7.0.
3. **For the owner to know, not a guard:** on pages brought back by hand, *Bring the rest back now* now goes on to the return's review rather than only ending the wait. I made the button do what it says rather than relabel it. Say if you'd rather keep it as a stop alone with a by-hand label.
