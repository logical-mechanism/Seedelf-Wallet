# v-pr337-1-trace: pr337#1, verified by tracing HEAD

**Verdict: confirmed. Severity: low (ux).** Confidence: high. Every observation in the finding reproduces on HEAD `6bca8bec`, in a scratch test that drives the worker. The finding's scope ("by hand") is right: only a session that doesn't run itself is affected, meaning a site's session or a swap brought back by hand. No money is at risk. The rest stays at the session's account, and the session's own page then says so truthfully and offers *Bring it back*. The defects are three:

- On a by-hand page, the button's words don't match what the press does.
- The stop reason says, in the past tense, that the rest was brought back while it is still at the account.
- flows.md's sentence leaves out the by-hand step.

PR #338, merged after #337, changes only `post-release-roadmap.md`, and nothing traced here changed after #337 (`git diff --stat 11e249d2 6bca8bec -- extension/src docs/flows.md` is empty).

## The path on HEAD

1. The page calls `session-skip-collateral-mix` (`handlers.ts:512-513`), which runs `skipCollateralMix` (`sessions.ts:5526-5538`):
   - It sets `tailOver(network, held.id)`.
   - While a chain is still pending, it runs `this.serial(() => this.pump(network, index))`, which swallows any error but a trap.
   - Then it runs `return this.advance(network, index, true);` (line 5537).
2. `pump` → `pumpChain` → `witness(i)` → `witnessTail` (`sessions.ts:5140-5144`): `if (await lovejoin.tailIsOver(...)) throw new Error(t("lj.tail.skipped"));`. Then `pump`'s catch (`sessions.ts:5053-5064`):
   - writes `s.chain.stopped = why`;
   - calls `chainEnded(network, id, why, …)`, which puts the same text on the ChainRecord;
   - drops the pending chain and releases the boxes.
3. `advance(…, true)` (`sessions.ts:3219-3224`) → `step(network, index, "asked")`, which at line 3446 runs `if (!s || !running(s)) return;`. `running` (`sessions.ts:1230-1232`) is `!!s.auto && …`. A site's session (`site`, no `auto`) or a by-hand swap (`byHand`: `!s.auto && !s.site && !s.mix`, line 1213) returns here, so nothing builds or sends the rest.
4. `runAll` (`sessions.ts:3361-3386`) steps only `running` sessions. For any other session it only pumps a pending chain, which is gone now, and settles returns. No later alarm brings the rest back either.
5. The worker's own docstring says this is the intended by-hand outcome: "Then its next step, as session-advance's: a swap's return goes by itself; one brought back by hand is offered on its page" (`sessions.ts:5522-5523`). The PR's description says, for every session, "The rest comes back directly". The PR's own worker test (`tests/lovejoin-planner.test.ts:1786-1828`, a site's session) calls `sessions.backBuild` itself after the skip, which is the user's second press.

## What the screens show

**The site's page** (`SiteSessions.tsx:411-419`): `onSkip` calls the RPC and then `onRefresh()`. Nothing opens the return's review.
- The way out goes away, because `collateralHeld` is now undefined.
- The row reads `chainText(s.chain, !s.auto)` → `lovejoin.chain.stoppedByHand`: "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back" (en.json:986).
- *Bring it back* is enabled.

So the page itself is honest, but the button the user just pressed said "Bring the rest back now" (`lj.tail.wayOut`, en.json:921).

**The by-hand swap page** (`Swaps.tsx:2403, 2567`): `setS(view)` only. It shows the same stopped row (`chainText(s.chain, true)`, Swaps.tsx:2377) and `swaps.next.bringBack`.

**The Lovejoin page's Chains row** (`Lovejoin.tsx:963-966`): "Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't." (en.json:920 and 1003). The row stays listed:
- `restBack` is never set for this chain. `restOnly` requires `!tailBoxOut(c)` (`lovejoin.ts:1964-1972`, `5109-5124`), and a skipped tail left its box out.
- So `carriedOf` doesn't hide it (`lovejoin.ts:1987-1997`), and `shown` keeps it until the collateral's box is mixed again.

The past-tense claim is therefore on screen from the press, which is exactly while the rest is still at the account. It becomes true only if and when the user presses *Bring it back*, reviews and sends.

**flows.md:522:** "It ends the wait as the day's end would: a chain still being sent stops at that mix ("You brought the rest back without waiting for the collateral's mix…"), and the rest comes back directly." In part this is mitigated: flows.md:494 already says, for a site's session, that after a stopped chain "what's left stays at the account until Bring it back sends it, directly". Read that way, "directly" means "not through Lovejoin". Even so, line 522 never says that on a by-hand page the press is followed by the user's own Bring it back.

## Repro (scratch test, run alone, then deleted)

The test was `extension/tests/zz-review-v-pr337-1-trace-1.test.ts`. It used the setUp of the PR's own test: a site's session holding 16 ₳ and its 5 ₳ collateral, a 5 ₳ pool with two strangers' boxes, and `lovejoinDepth: 1`. It ran these steps:

1. `backBuild` and `backSubmit`, then confirmations on.
2. giveme.my answering 503, then `runAll`, so giveme.my was asked once.
3. `tail.landed -= TAIL_OFFER_MS`, then `skipCollateralMix`.

Output:

```
chain kinds [ 'deposit', 'mix', 'deposit', 'mix', 'back' ]
before: stage open chain {"total":5,"sent":3,"confirmed":3,"cut":false}
R: submitted before/after 3 3
R: after stage open chain {...,"stopped":"You brought the rest back without waiting for the collateral's mix, so the chain stopped there."} collateralHeld undefined
R: site page row: Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back
R: chains rows [{"session":0,"boxes":1,"total":5,"sent":3,...,"stopped":"You brought the rest back without waiting for the collateral's mix, so the chain stopped there."}]
R: Chains row text: Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't.
R: submitted after three alarm runs 3
R: later stage open chain {...,"stopped":"You brought the rest back ..."}
R: by-hand Bring it back: collateralTail undefined lovejoin null chain len 0
```

The test asserted all of this and passed, which confirms the finding:
- The press sent nothing, and neither the collateral's mix nor the return went out.
- Three alarm runs later, still nothing had been sent.
- The reason is `lj.tail.skipped`, both in the view and on the Chains row.
- The user's *Bring it back* afterwards builds a plain direct return, with no collateral's mix and no chain.

The first run hit "The wallet is locked" only because I advanced the fake clock 15 minutes (the auto-lock). I reran with 40 s steps.

## Severity

Low: a reachable UX mismatch with no money effect.
- The rest stays at the session's one-time account, and the page offers *Bring it back*.
- Disconnect still waits while the account holds anything (`disconnectWait`), so the user meets the rest again before they could end the session.
- The worst case is a user who trusts the button and the Lovejoin page's reason, and leaves the rest at the site-connected account. That costs no money: a site still needs the user's approval to sign.

## The fix

The finding's fix is workable. I checked:
- `buildBack(true)` after the skip builds a plain return. `sessions.ts:4331` makes a chain that went in partly come back directly, and `tailChain` → `tailOf` skips a tail that is over. The scratch test shows `collateralTail` undefined and no `lovejoin`.
- `lj.tail.skipped` is a machine draft (`es-provenance.json:959`, `ja-provenance.json:865`) and isn't in `critical-keys.json`. Only `lj.tail.privacy.wayOut` is critical, so rewording it needs no back-translation.

Refinements:
- **The reason's new wording:** "The rest comes back without the collateral's mix…" is still untrue on a by-hand page until the user acts. A tense-free reason true for both kinds is better, e.g. "You chose not to wait for the collateral's mix, so the chain stopped there."
- **Opening the review:** making the by-hand press land on the return's review matches the button's words. On the site's page, call `buildBack(true)` after the RPC instead of only `onRefresh()`. On the by-hand swap page, call `buildBack(true)` after `setS`. Without this, the by-hand pages could get their own label. That choice is the owner's: both keep the privacy line.
- **flows.md:522:** add that on a site's or a by-hand swap's page, the press opens the return's review (or, unfixed, that the rest then waits for Bring it back).
- **A test:** a site's session held at the mix past the hour. After `skipCollateralMix`, assert that the chain's reason doesn't claim the rest came back, and, with the review fix, that the page lands on the return's review (a screen test).
