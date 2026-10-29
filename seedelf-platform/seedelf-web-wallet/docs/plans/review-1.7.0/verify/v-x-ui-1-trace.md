# v-x-ui-1-trace: x-ui#1, *Bring the rest back now* by hand

**Verdict: confirmed. Severity: low. Confidence: high.**

I tried to refute it and couldn't. On HEAD `6bca8bec`, a site's session (or a swap brought back by hand) whose return waits at its collateral's mix behaves like this when the user presses **Bring the rest back now**:
- Nothing is sent.
- The chain stops.
- The rest stays at the one-time account until **Bring it back**, then **Send**.
- Meanwhile the Lovejoin page's Chains row says "You brought the rest back…".

A scratch test that asserts the opposite fails on HEAD with `{ returned: false, claims: true }`.

## What I traced (HEAD `6bca8bec`)

1. **The press.** `SiteSessions.tsx:416` calls `session-skip-collateral-mix`, then `onRefresh()`. Swaps.tsx's by-hand branch does the same through `skipCollateralMix` (2403), rendered at 2567.
2. **The worker's `skipCollateralMix`** (sessions.ts:5528-5538) does three things:
   - it calls `tailOver`;
   - if a chain is still being sent, it calls `pump`;
   - it ends in `return this.advance(network, index, true);` (5537).
3. **The pump.** `witnessTail` throws `t("lj.tail.skipped")` at 5144. Pump's catch writes `s.chain.stopped = why` (5058), calls `chainEnded(…, why)`, drops the pending chain and releases it.
4. **`advance` → `step`.** `step` returns at once when `if (!s || !running(s)) return;` (3446). `running` is `!!s.auto && …` (1231), and a site's session has no `auto` (it's created with `site: { origin }` alone, sessions.ts:1983-1990). So nothing builds or sends a return.
5. **The alarm's runs.** For a session that doesn't run itself, `runAll` only pumps a pending chain and settles returns already sent (3367-3376). It never builds one.
6. **Design intent.** skipCollateralMix's own comment (5522-5524) says "one brought back by hand is offered on its page". The worker does what was designed; it's the words that don't match.
7. **The words:**
   - **The button:** `lj.tail.wayOut`, "Bring the rest back now".
   - **The critical line above it:** `lj.tail.privacy.wayOut`, "…Bring the rest back without it…".
   - **The stop reason:** `lj.tail.skipped` (en.json:920), "You brought the rest back without waiting for the collateral's mix, so the chain stopped there."
   - **Where the reason shows:** only on the Lovejoin page, as `lovejoin.chains.whyStopped` (Lovejoin.tsx:965), or in a mix card's detail once the chain isn't under Chains.
   - **flows.md:522:** "…a chain still being sent stops at that mix (…), and the rest comes back directly".
   - **#337's description:** "The rest comes back directly".
8. **How long the false row lasts.** The stopped chain left its collateral's box in the pool, so `tailBoxOut` is true (lovejoin.ts:1965) and `restOnly` is false (1972). Neither `restBack` nor `carriedOf` (1989-1990) ever hides it, so the row stays listed. It is false from the press until the user brings the rest back, and true after that.
9. **The PR's own test** (lovejoin-planner.test.ts:1791) uses `setUp`, which is a site's session (`siteSession(t)`, 1337). After the skip it builds the return by hand: `const back = await sessions.backBuild("preprod", 0);` (1825).

## Scratch tests

The file was `extension/tests/zz-review-v-x-ui-1-trace-1.test.ts`: a copy of lovejoin-planner.test.ts with three cases added after the PR's test. I ran it alone with `-t` and then deleted it.

**A: the finding's scenario.** `setUp("16000000")`, then `backBuild`, `backSubmit`, confirmations at 1, giveme.my answering 503, `runAll`. Then `landed -= TAIL_OFFER_MS`, then the skip. It passed and logged:
- **Before the press:** stage `open`, `auto` absent, `collateralHeld {"offerAt":1800000000000}`, and now ≥ offerAt.
- **After the press:**
  - no new submissions;
  - `txs ["out","deposit","mix","deposit"]`;
  - stage `open`;
  - `chain.stopped` = "You brought the rest back without waiting for the collateral's mix, so the chain stopped there."
- **The site's page, rendered with the real `SiteSession` and the returned view:** "Through Lovejoin Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back … Bring it back".
- **The Lovejoin page's `Chains`, rendered from `lj.status()`:** "Private session 1, 1 box Stopped Stopped after 3 of 5 transactions Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't."
- **Two alarm runs (`runAll`) later:** still no `back`, and no submissions.
- **Only `backBuild` + `backSubmit`** (Bring it back, then Send) sent the return: a direct one, with no `collateralTail`.

**B: the chain had already stopped at the mix**, so the tail was buildable again (`stoppedAtMix`, giveme.my refusing past its wait). The way out is offered here too, and the press again sends nothing. Two differences:
- The reason stays "giveme.my wouldn't back the collateral's mix, so the chain stopped there.", so `lj.tail.skipped` isn't shown.
- The next Bring it back builds a direct return instead of building the mix again.

So the false *reason* needs a chain still being sent at the press. The unmet *button* doesn't.

**C: the behaviour the finding expects.** After the press on a site's session, either a return was sent or the stop reason doesn't claim one. **It fails on HEAD:** `expected { returned: false, claims: true } to not deeply equal { returned: false, claims: true }`.

## Where it's narrower

- **The page where the user presses is honest straight after.** It shows `stoppedByHand` ("…the rest stays at the account until you bring it back", LovejoinReturn.tsx:117) and offers Bring it back. Nothing is lost or locked.
  - What's wrong: the button's promise, the stop reason on the Lovejoin page, and flows.md (plus the PR's description).
  - So low is right, not medium.
- **The Lovejoin page's own way out is unaffected.** It's offered only on mix sessions: `mixItems` attaches `sessions.find((s) => … && s.mix)` (Lovejoin.tsx:2417). Those run themselves, so `step` goes on and builds the return there.
- **Reachable by-hand cases:**
  - a site's session, the usual one;
  - a swap with no `auto`: one from before swaps ran themselves, or one a restore's scan found.

## Fix advice

The finding's fix is right. Three details:

1. **Do the build inside the skip's own `act` task.**
   - Don't call the page's `buildBack(true)` / `bringBack` from inside the skip's `act`. Both pages' `act` start with `if (busy) return;` (SiteSessions.tsx:199-200, Swaps.tsx:2184-2185), and a nested `act` from that render's closure either gets dropped or interleaves its busy state with the skip's.
   - Instead, after the RPC: `setBack(await call("session-back-build", { index: s.index }))`, then `setBackThrough(true)` and `setBackPools({})`.
   - The build reads Koios afresh. A chain that went in partly comes back directly, as test A's build did.
   - This keeps the button and the critical `lj.tail.privacy.wayOut` true without a new blind back-translation. Rewording the button instead would touch that critical line too.
2. **Reword `lj.tail.skipped` anyway,** e.g. "You stopped waiting for the collateral's mix, so the chain stopped there."
   - Even with the review opened, the user can back out without Send, and the reason would again claim a return.
   - It's a machine-draft key, so redraft es and ja and keep provenance "machine". The only test reference is `tr("lj.tail.skipped")` (lovejoin-planner.test.ts:1818), so no test text changes.
3. **flows.md:522:** say that a swap or a mix brings the rest back by itself, and that a site's session, or one brought back by hand, opens its return's review (or, without fix 1, offers Bring it back).

Add a page-level test for the by-hand press. Today's tests stop at the worker.
