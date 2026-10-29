# v-x-merge-2-impact: x-merge#2, impact and fix

**Verdict: confirmed. Severity: low**, as filed, at the low end. Confidence: high.

I read and ran everything on HEAD `6bca8bec`. #338 changes only `post-release-roadmap.md` (`git diff --stat 11e249d2 6bca8bec`), so the tree is #337's for everything here.

This is the same defect as pr337#1 (finding 2 in pr337's report), x-ui F2 and x-scen 2. v-pr337-1-impact and v-pr337-1-trace reached the same verdict. Merge them as one finding.

## What happens (my scratch test, run alone, then deleted)

The test was `extension/tests/zz-review-v-x-merge-2-impact-1.test.ts`. It copied the planner test's helpers: the real WebAssembly, a 5 ₳ ADA pool with two strangers' boxes, `lovejoinDepth: 1` and 16 ₳ at the account. The chain is `[deposit, mix, deposit, mix, back]`. It is sent, then held at the collateral's mix with giveme.my answering 503. Then `tail.landed -= TAIL_OFFER_MS`, Koios lists the chain's first part, and `skipCollateralMix` is called. Both tests passed.

**By hand: a site's session (`site`, no `auto`).**

```
SITE before: stage open chain {"total":5,"sent":3,"confirmed":3,"cut":false} held {"offerAt":...}
SITE after: submitted 3 -> 3 stage open auto false held undefined
SITE after chain {...,"cut":false,"stopped":"You brought the rest back without waiting for the collateral's mix, so the chain stopped there."}
SITE page row: Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back
SITE Home held.stopped 1
SITE Lovejoin Chains: Private session 1, 1 box Stopped Stopped after 3 of 5 transactions Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't.
SITE after three runs: submitted 3
SITE Bring it back: lovelace 4659477 lovejoin null tail null
```

- The press sends nothing, and three alarm runs later still nothing has been sent.
- The site's own row is truthful.
- Home flags "a mix stopped partway: open Lovejoin to see what to do". The Lovejoin page then says the rest came back while it is still at the one-time account.
- The user's *Bring it back* afterwards builds a plain 4.66 ₳ return, and giveme.my isn't asked again.

**Running itself: a mix session (`mix` + `auto`).**

```
MIX after: submitted 3 -> 4 stage returning held undefined chain {...,"cut":true,"stopped":"You brought the rest back ..."}
MIX sent spends change: [ true ]
MIX row: Stopped after 3 of 5 transactions; what was left came back directly asked 1
```

The press sends the plain return in the same RPC (`advance` → `step` → `act` → `bringBack`), so the reason is true there.

**Why the two differ.** The cause is the code the finding quotes:
- `skipCollateralMix` ends with `return this.advance(network, index, true);` (`sessions.ts:5537`).
- `step` reads `if (!s || !running(s)) return;` (`:3446`).
- `running` is `!!s.auto && …` (`:1230`).

**There is no way around it by hand.** While the chain is pending, *Bring it back* refuses with `sess.chainSending` ("Its return through Lovejoin is still being sent. Wait for it to finish."), from `buildBack` at `sessions.ts:4317-4319`. So by hand the way out takes two presses plus a review. The finding is right that #337's own test does the second press itself (`lovejoin-planner.test.ts:1825`, `sessions.backBuild`).

## Impact

**Who can reach it.** Only a session that doesn't run itself:
- **A site's session (private CIP-30).** Its return goes through Lovejoin and mixes its collateral, both on by default.
- **A swap brought back by hand.** In a store build this is only a session found by a restore's scan and brought back through Lovejoin from this device.

Every swap and mix a store build starts runs itself (`auto`, `sessions.ts:2175` and `:3000`). Paused swaps don't count: any send clears `paused` (`:5319`), and nothing pauses a session while its return chain is pending.

**Where: the store build.**
- **Mainnet (default): dormant.** The tail needs a 5 ₳ ADA pool holding 30 of other people's boxes (`networks.ts` `poolFloor: 30`). The bundled mainnet list has no token pools (`src/lovejoin-pools.json`, `mainnet.pools` = `[]`).
- **Preprod (Settings): reachable today.** The 5 ₳ pool `18c4df77…` is bundled, and the floor is 0.

**The false reason needs the chain still pending an hour after the deposit landed.** Two things must hold:
- giveme.my is busy or out of reach, or Koios keeps erroring, for that hour. A plain refusal stops the chain with `lj.tail.refused` after 3 minutes (`:5161`).
- The wallet stays unlocked throughout. Activity counts only pointerdown and keydown on a wallet page (`App.tsx:95`), the default auto-lock is 15 minutes (`AUTO_LOCK_MS`), and a lock cuts the chain.

This is rare. The more common way to be past the hour is a lock that cut the chain. There, the press writes no reason: it only makes the next *Bring it back* plain, and the page's row says the next step before and after.

**The harm: none to money or privacy.**
- The rest stays at the user's own one-time account.
- The page where they pressed says so at once, and *Bring it back* is right there.
- A site still needs approval to sign anything.
- Disconnect waits while the account holds money (`sites.why.disconnectHolds`).

**Why low and not nit.** The button's label over-promises on by-hand pages. The Lovejoin page, which Home's flag points to, affirmatively states where the money is, and it is wrong. flows.md:522 leaves out the by-hand step. flows.md:494 does state the general rule for a site's session ("stays at the account until Bring it back sends it, directly").

**Why not medium.** No real harm, no stuck state, and a rare state that is dormant on the default network.

## The fix

**1. The reason's words. Recommended; minimal; no critical key.**
- `lj.tail.skipped` is a machine draft: `es-provenance.json:959` and `ja-provenance.json:865` say "machine", and it isn't in `critical-keys.json`.
- Reword it so it's true for every session: **"You chose not to wait for the collateral's mix, so the chain stopped there."**
  - It keeps the siblings' frame (`lj.tail.refused`, `lj.tail.tooLong`).
  - It reads right under "Why it stopped: … Mix my boxes again mixes the boxes it didn't."
- Avoid "The rest comes back without…". By hand, that is still false until the user acts, and a present tense reads oddly under "Why it stopped:" days later.
- Update the es and ja drafts, with provenance staying "machine". The only reader, `lovejoin-planner.test.ts:1818`, goes through `tr()`.
- The text is only ever written after the user's press: only the way out marks a tail over on a chain still being sent. So "you chose" is accurate whenever it's shown.
- Saved reasons keep the old text, as every saved reason does. Since 1.7.0 hasn't shipped, only dev and preprod records have it.

**2. flows.md:522. Recommended.**
- Add the by-hand step: "…and the rest comes back directly: by itself for a swap or a mix; for a site's session, or one brought back by hand, at *Bring it back* and its review."
- Update its quote of the reason.
- Whatever privacy.md:217 gains for x-merge#4 shouldn't say the press brings the rest back.

**3. Opening the return's review after the press, on by-hand pages. The owner's call: better UX, no new text.**
- **Where:** in `SiteSessions.tsx`'s `onSkip` (`:414-418`) and in `Swaps.tsx`'s branch without `auto` (`:2567`). The auto branches keep `setS`.
- **How to wire it:**
  - Build inside the same `act` task: `setRebuilding`, `session-back-build`, `setBack`, `setBackThrough(true)`, `setBackPools({})`.
  - Don't call `buildBack(true)` from inside `act`. That nests a second `act`, with the render's stale `busy`, and the outer `finally` clears `busy` while the build is still in flight.
- **When to open it:** only when the press's answer shows the rest still at the account: `view.chain?.stopped && !view.chain.cut && view.stage !== "closed"`. That condition skips the race where giveme.my's signature went out (the chain then isn't stopped). It also skips the state where a direct return was already sent (`cut`).
- **Within the owner's rules:**
  - nothing is sent without Send;
  - no guard, no refusal, no new text;
  - the review keeps every privacy note;
  - `lj.tail.privacy.wayOut` stays as it is.

**Don't** have the worker send a by-hand return itself inside the skip's RPC. A by-hand return always goes through its review and its switch.

## Tests

- **The finding's first test passes on HEAD, so it wouldn't catch the defect.** It asks that the view say the rest waits for *Bring it back*, and `chainText(view.chain, true)` already gives `lovejoin.chain.stoppedByHand`. A test that fails today checks the words instead: a site's session skipped past its hour must not have `chain.stopped`, or the rendered `Chains` row, claim the rest came back. With fix 3, add a screen test that the press opens the review only under the condition above.
- **The auto path has no test today.** `skipCollateralMix` is exercised only by the planner's site's-session test. My mix-session run above is that test, and it passes on HEAD:
  - exactly one plain return, spending the deposit's change, sent within the RPC;
  - giveme.my asked once;
  - `collateralHeld` cleared;
  - `chain.cut` true.

  Add it as a regression guard; it doesn't fail today.

## Scratch

`extension/tests/zz-review-v-x-merge-2-impact-1.test.ts`: 2 passed, then deleted. Nothing else was written apart from this report.
