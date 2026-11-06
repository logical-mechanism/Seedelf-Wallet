# 1.8.0's release review: cluster O3, verified (o3-trace)

Verifier: o3-trace. Tree `a6c94743`, sandbox `…/scratchpad/wt/tests-e2e`. Every command ran from its `seedelf-platform/seedelf-web-wallet/extension`. The one file I mutated (`e2e/extension.spec.ts`) was put back from a copy, and `git diff --quiet` on it is clean. `git status` shows only my scratch files.

**Scratch files**, in the sandbox's `tests/`. I read each one before trusting it.
- `o3-trace-scratch.test.ts`, my own. It takes each state of v2's 5 ₳ pool in turn:
  1. The real worker builds a site's funding (`siteOutBuild`).
  2. The screen's own `FundingWayBack` renders that summary, as `ConnectRequest` passes it (`lovejoin` = Settings && `lovejoinOn`). The card's key is picked by the same expression as `:921`.
  3. The same worker then builds that session's return (`backBuild`).

  It uses the real WebAssembly and `ADA_POOL` and `adaStrangers` (`v2-pools.ts`). The floor is set on preprod as `lovejoin.test.ts:782-792` does. One more case runs `priced`'s rule in every state.
- `o3-trace-words-scratch.test.ts`, my own. It prints `onPoolShort` joined to each connector line, in en, es and ja.
- `o3-trace-cap-scratch.test.ts`: the adapool reviewer's `adapool-scratch-cap.test.ts`, copied with its names changed. Its world is a site session holding 300 ₳ and its 5 ₳, 270 strangers in v2's pool, and Settings' defaults.
- The tests-e2e reviewer's `tests-e2e-nopool-scratch.py` and `.ts.txt`. Its world is the connect test's own: the classic pool's 20 recorded boxes (retired) and no v2 pool.
  - In that world it asserts the window's two promises.
  - Then it puts 40 ₳ and 5 ₳ at the session's account, standing in for a funding that landed (giveme.my refused the real one).
  - Then it asserts that the session's Bring it back comes back directly. That's a sound set-up for the question.

**Commands and results:**
- `npx vitest run tests/o3-trace-scratch.test.ts tests/o3-trace-words-scratch.test.ts tests/o3-trace-cap-scratch.test.ts --maxWorkers=2`: 3 files, **10 passed**.
- The e2e: `npm run build:ext`, then `python3 -I <scratchpad>/tests-e2e-scripts/tests-e2e-nopool-scratch.py e2e/extension.spec.ts`, then `npx playwright test --project=extension --workers=2 -g "tests-e2e scratch|a site connects to a private session instead"`: **2 passed** (3.5 s and 3.1 s).
- `git diff 6b70c1f8 a6c94743 -- …/ui/screens/DappApprovals.tsx` is empty. The screen is 1.7.2's. Only the words changed (10 → 5 ₳), and the pool behind them.

## O3's claim, verified on my own

**CONFIRMED · medium · reachable.**

**What the approval reads.** `ConnectRequest` reads Settings (`prefs`), the network, the site account, `balances` and the approval itself. The approval's connect variant carries nothing of Lovejoin (`rpc.ts:1481-1496`). At Review it also reads the `dapp-private-build` summary. It reads nothing else.
- **The card.** `DappApprovals.tsx:533` sets `lovejoinBack = prefs.lovejoinReturns && lovejoinOn(network)`, and `:921` picks `dappUi.private.privacy.staysLovejoin` on it. The worker has no say at all.
- **The funding review.** `:771` passes `lovejoin={lovejoinBack}`. The "Through Lovejoin first" row (`:478`) shows on `lovejoin` alone. The note (`:488`) is `collateralMix ? noteLovejoinMixed : lovejoin ? noteLovejoin : noteDirect`. Both Lovejoin notes say the spare ADA is mixed; the summary only chooses which of the two.

**What the summary carries.**
- `siteOutBuild` (`sessions.ts:1943-1979`) asks `tailReserve(…, { direct: true })`, which reads `collateralPool` at Review. That read asks `adaPool(network, true)`, then checks `usableNow`, reads the pool once, checks the floor and needs two free draws.
- Where that pool takes the collateral, the summary gets `collateralReserve` (the direct reserve) and `collateralMix: "ifLeft"`. A read that fails asks `collateralPoolTakes`, whose "maybe" also gives `ifLeft`.
- With Settings' collateral switch off, `tailReserve` returns before any read (`sessions.ts:4641`), so the summary is `{}` in every state.
- So `collateralMix` follows the collateral's rule (two free draws), never the spare ADA's: one box at Settings' depth needs 2, 8 or 26 others at three a mix. And it's absent whenever the collateral switch is off.
- One correction to the prompt: for a site's funding, `collateralMix` comes from `collateralPool`'s read, and from `collateralPoolTakes` only when that read fails. `collateralPoolTakes` is what the quote, Stop and Max use.

**The test.** `o3-trace-scratch.test.ts`, every row passing at `a6c94743`:

| State | Summary | Card | Review's note | The return |
|---|---|---|---|---|
| A: 20 strangers, floor 0 | `collateralMix: ifLeft`, reserve 2.8 ₳ | "Spare ADA is mixed through Lovejoin…" | `noteLovejoinMixed` | 2 boxes, the 5 ₳ mixed. True |
| (a) no v2 5 ₳ pool | `{}` | the same | `noteLovejoin` | direct: "Lovejoin has no pool of 5 ₳ boxes to take it yet" |
| (b) 22 strangers, floor 30 | `{}` | the same | `noteLovejoin` | direct: "Lovejoin's pool holds 22 boxes not yours, and the wallet mixes only from 30" |
| (c) 5 strangers, floor 0, two waves | `collateralMix: ifLeft` | the same | `noteLovejoinMixed` | the spare ADA direct: "…has 5 boxes to mix with, and this needs 8"; the 5 ₳ mixed |
| later: no pool at Review, the pool and 20 strangers by the return | `{}` | the same | `noteLovejoin`: "The rest and the 5 ₳ come back at once" | 2 boxes, **and the 5 ₳ mixed** |
| collateral switch off: A and (a) | `{}` in both | the same | the same text | A: 2 boxes; (a): direct |

The e2e shows (a) in the real window. The connect test pins both promises in a world with no v2 pool: the card at `extension.spec.ts:5104`, the review's row at `:5121`. The scratch e2e, in that world, sees the same session come back directly.

**Reachability:**
- **(a):** on mainnet, until the owner launches its v2 5 ₳ pool (the call of 2026-11-06: the head start is no gate). On preprod, every wallet that hasn't opened Lovejoin's page (O1). Anywhere with Koios-only on (O1).
- **(b):** on mainnet, from the launch until the pool holds 30 boxes that aren't the user's. Every private session approved in that time meets it. For the owner's own wallet that means 30 strangers' boxes, since his Bootstrap boxes never count as others.
- **(c):**
  - On preprod (floor 0): any pool with fewer than 8 free boxes at Settings' default.
  - On mainnet, over a floor of 30: a box always has its 2, 8 or 26 others at three a mix. So only reservations by the wallet's other chains, or a pool `usableNow` refuses, get there. That's rare.

**Why medium.** Three critical `.privacy.` keys promise a mix that the return doesn't make. It happens in normal use: a private session is the private choice, and Lovejoin returns are on by default. Every mainnet private session in the window above meets it. It isn't high: before anything is sent, the return's own review says Lovejoin is left out and why, with its direct switch. No money is at risk.

**From the "later" row, an addition to the cluster.**
- With no pool at Review, `noteLovejoin` says "The rest and the 5 ₳ come back at once".
- A pool found by the time the session comes back mixes the 5 ₳ too, paid from the spare ADA, since no reserve was funded.
- `collateral-reserve-review-fixes.test.ts:1055-1059` pins that no-pool note.
- In 1.7.2 this needed the 8131b1d 5 ₳ pool to cross its floor between a funding and its return. In 1.8.0, an empty pool filling up is the expected course.
- It errs toward more privacy, but with a collateral's mix fee the approval didn't count. The return's review shows both before Send. Same root cause, same fix.

## What the approval should say

**The rule:**
- Where the worker's read says v2's 5 ₳ pool takes a box of the spare ADA now, keep today's words.
- In every other state, hedge. The hedge is true now: the pool takes nothing, so as things are it comes back directly. It's true later too: the return reads the pool again, and a pool found by then mixes it.
- Never use the direct words (`staysDirect`, `noteDirect`) for (a) to (c). The "later" row shows they turn false once a pool exists.
- This is the swap's approval's own rule: `swaps.lovejoin.privacy.on` where the pool takes, `onPoolShort` where it doesn't (`Swaps.tsx:1590-1597`).

| State | Card | Funding review |
|---|---|---|
| Takes a box now | `staysLovejoin`, as today | as today: `noteLovejoinMixed` with `collateralMix`, else `noteLovejoin` |
| (a), (b), (c), or the worker can't tell | `staysLovejoin` + `swaps.lovejoin.privacy.onPoolShort` | the rows as today, and a hedged note: one new critical key |

The rows stay because they're what it costs if it goes through Lovejoin, each "about". The hedged note makes them conditional.

**Is `onPoolShort` right here?** On the card, yes. On the review, no.

**The card.** `onPoolShort` follows directly after the claim it qualifies:
- en: "…about 4.1 ₳ a 5 ₳ box plus a fee, back hours later. Only if Lovejoin's pool has room when it comes back."
- es: "…y vuelve horas más tarde. Solo si el pool de Lovejoin tiene sitio cuando vuelva."
- ja: "…数時間後に戻ります。戻る時点で Lovejoin のプールに空きがある場合だけです。"

Why it fits:
- Its "when it comes back" presupposes the return, so it can't be read as "the money may not come back". Read as conditioning "hours later", it's true too: with no mix, it comes back at once.
- The swap's approval already shows it in these same states, `noAdaPool` and the floor included.
- It's critical and listed in both verified files. Its es and ja values are the copy-trim round's (1211a5d2, 2026-10-06), recorded in both reviewer notes: back-translated by their writer, then read by a separate reviewer. They haven't changed since. Reusing it costs no new round.

**The review.** The note ends "Settings → Lovejoin turns that off.", so a hedge after it qualifies the switch, in every language:
- en: "Settings → Lovejoin turns that off. Only if…"
- es: "Se desactiva en Configuración → Lovejoin. Solo si…"
- ja: "「設定」の Lovejoin でオフにできます。戻る時点で…場合だけです。", which reads as "you can turn it off only when…".

A review `Row` has no note of its own, and the rows sit in a `<dl>`, so nothing can go between them. The hedge has to be inside the note: one new critical key. In English:

> From the dApps page. Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later, if its pool has room by then. The rest comes back at once. Settings → Lovejoin turns that off.

- "The rest comes back at once" stays true whether or not the 5 ₳ is mixed later.
- It drops the "the 5 ₳" that W5 finds ambiguous.
- It needs a blind back-translation in es and ja. W5 and W6 already owe a round for `noteLovejoin` and `noteLovejoinMixed`, so it adds one key to that round.

**What the worker must hand the screen.**

*On the funding's summary* (`siteOutBuild`):
- **What:** whether v2's 5 ₳ pool takes a box of the spare ADA, as Review reads it.
- **Rule:** the one a swap's Review already applies, `priced(network, true)`'s `skipped`:
  - no pool shown: `noAdaPool`;
  - under the floor: `poolShort`'s floor;
  - too few free others for one box at Settings' depth and width: `poolShort`'s room.
- **Reads:** discovery is asked as O2 makes `priced` ask. `usableNow` is added. None of it depends on the collateral switch.
- **A failed read:** counts as short, never as takes. (`room` answers nothing then, and `priced` would say takes.)
- **Shape:** `lovejoinSkipped?: string` beside `collateralMix` (as the swap's `skipped` is), or a flag. The screen only reads whether it's there.
- My scratch's `priced` case shows the rule already tells every state apart, with the collateral switch off too: nothing in A; `noAdaPool`; `poolFloor` (22 of 30); `poolFree` (5, needs 8).

*For the card, before Review:*
- The same answer from a quiet look, as `collateralPoolTakes` is for the swap form.
- **Short** where no pool is shown, where it took no new box when last measured, where the data layer's last count is under the floor, or where a room read within `POOL_ROOM_MS` has no room for a box.
- **Takes** only where that read has room. Hedge in every other case.
- **Carried** on the connect approval (`DappAsk`'s connect), or answered when the private card is chosen.
- **Or** read the pool once when the card is chosen (`room`, kept for `POOL_ROOM_MS`). The review then reuses that read, so the card and the review always agree.

*The tests:*
- The connect e2e should assert the hedge in its world (no pool), and the plain words in a world where v2's pool takes boxes (`fivePool` and its strangers).
- These unit tests pin today's no-pool words: `screens-wiring-review-fixes.test.ts:822`, `dapp-prompt.test.ts:296`, `collateral-reserve-review-fixes.test.ts:1055`.
- Add a worker test of the mark in each state, as my scratch's rows do.

*The owner's calls:* no refusal is added. Lovejoin stays the default. The card gains one short sentence. The review's note is no longer than today's.

## release#2

**CONFIRMED claim, REFUTED fix · medium · reachable.**

- **Why:** the claim holds. My row (b) uses the floor of 30 and 22 strangers. It gives the summary `{}`, `noteLovejoin` on the review, `staysLovejoin` on the card, and the return's floor skip in the finder's own words. The window is wider than the floor, though: (a) on mainnet before the launch, and (c).
- **The fix (Bootstrap to 30 before the upload) is refuted.** The owner's call of 2026-11-06 overrides it ("the floor isn't one either"). It wouldn't close the window anyway:
  - a pool can drop under 30 again later;
  - the owner's own wallet never counts its own boxes as others;
  - preprod and Koios-only sit in state (a).
- **Fix:** its backlog alternative is the right one (let the card and the review read the worker's view, or hedge). In detail, as above.

## tests-e2e#0

**CONFIRMED · medium · reachable, not new.** `DappApprovals.tsx` is byte-identical to 1.7.2's.

- **Evidence:** the e2e above, 2 passed. The connect test pins both promises with no v2 pool, and the scratch sees the same session come back with `noAdaPool`. I read the scratch's set-up before trusting it. Its stand-in funding (two UTxOs at the session's account, after giveme.my's recorded refusal) is sound for the question it asks of the return.
- **Fix, "carry the same for the spare ADA":** right, but `collateralMix`'s rule isn't the spare ADA's (row (c)), and it's absent with the collateral switch off (the last row). Carry `priced`'s rule instead.
- **Fix, "use the direct words":** refuted. They're false later (the "later" row).
- **Fix, "one short line that it comes back directly until…":** true, but a new key, where `onPoolShort` already serves the card.
- **The e2e:** without a pool, assert the hedged words, not the direct ones.
- The "10 ₳" in the comment at `:530` is W10's.

## words#1

**CONFIRMED · medium, not low · reachable.**

- **Why medium:** three critical `.privacy.` keys are false in normal use (the brief's scale). The finder's trace holds.
- **Its first fix** (Bootstrap to the floor as a condition of shipping) is overridden by the owner's call.
- **Its second fix** is the right one: qualify the lines as the swap's approval does, from what the worker read, and back-translate. Concretely, `onPoolShort` on the card (no new round) and a new key for the review's note.

## cross#8

**CONFIRMED · medium, not low · reachable.**

- **The evidence it lacked:** it said "trace only. Preprod's floor is 0, so a unit test can't reach it." My row (b) reaches it with the real worker, by setting preprod's floor to 30 as `lovejoin.test.ts:782-792` does.
- **Its fix is right for the card**, with two corrections:
  - Use the spare ADA's rule (`priced`/`poolShort`), not `collateralPoolTakes`'s two draws. Row (c) says "ifLeft" while no box of the spare ADA fits.
  - On the review, `onPoolShort` can't follow the note.

## adapool#3, its connector half

**REFUTED as a false statement in the connector's words · nit at most · reachable** (1.7.2's cap was 320 ₳).

- **The mechanics are confirmed.** `o3-trace-cap-scratch.test.ts`, 2 passed:
  - At Settings' defaults, one chain takes 32 boxes of 5 ₳, which is 160 ₳.
  - A 300 ₳ return mixes 160 ₳, pays about 107.5 ₳ of fees, and brings 32.5 ₳ back at once.
  - At three a mix: 320 ₳ one wave deep and 50 ₳ three deep. At four: 130 ₳ two deep and 30 ₳ three deep.
- **Why it's refuted:**
  - The review the user sends from already says it. `noteLovejoin` says "…back in 5 ₳ boxes hours later. The rest and the 5 ₳ come back at once." `noteLovejoinMixed` says "The rest comes back at once."
  - The card's "Spare ADA is mixed…: about 4.1 ₳ a 5 ₳ box" is a per-box summary. It never says all of it, the remainder under a box has always needed the same reading, and 1.7.2 shipped it with a 320 ₳ cap.
  - The return's own review shows the boxes and what comes back at once, before anything is sent.
  - What 1.8.0 changes is how much one chain carries. That's P3's, for the owner and the docs.
- **Fix:** none for O3. The new review key above keeps "The rest comes back at once".

## Covered

- **ClaimAll's switch note** (`claim.lovejoin.privacy.on`) shows only where a built return has boxes, or the switch is off (`ClaimAll.tsx:286`). It reads the real outcome, so it isn't the same gap.
- **No other screen picks a mixing promise on Settings alone.** I grepped `en.json` for "mixed through Lovejoin", "Lovejoin mixes" and "is mixed with other". The hits are the swap's, Stop's, ClaimAll's and the connector's. The swap's quiet read at Review is O2's.
- **`FundingWayBack` is used only by the connect window.** The top-up's review shows the collateral's words alone (`sites.topUp.collateral*`).
- **The return reads the pool again at its build.**
  - `chain()` asks `adaPool(network, true)` and throws `noAdaPool` (`lovejoin.ts:3517`).
  - `fanOut` checks the floor (`:3604-3605`), and `attempt` checks the room (`needsMore`).
  - `buildBack` turns each into a direct return carrying `lovejoinSkipped` (`sessions.ts:4506`).

## Not checked

- Mainnet itself (no network). The floor ran on preprod, set to 30.
- No prototype of the fix was built: the worker's mark, the card's quiet look and the new key are described here, not run. A fix round should run my scratch's rows against it.
- O2's swap Review, and its ADA-out shape.
