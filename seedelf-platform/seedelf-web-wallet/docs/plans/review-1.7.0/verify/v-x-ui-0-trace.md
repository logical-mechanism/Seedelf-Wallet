# v-x-ui-0-trace: verifying x-ui#0

**Finding:** #337's way-out line says the collateral's mix "is still waiting for giveme.my" when it is waiting for the 5 ₳ pool's boxes, and the page's own reason beside it says so.

**Verdict: confirmed. Severity: low.** The scenario reproduces on HEAD (`6bca8bec`) as described, on all three pages that show the line. The claim's description of the second state is broader than the defect, though. In `tailBuildable` the line is wrong only while the mix can't be built again (`fewBoxes`, `noPool`, or a Koios error on the rebuild's reads). With the pool fine, a session that runs itself builds the mix again at the runner's next step. Once that new chain is sent, it waits for giveme.my (`tailWaits`), and there the line is true.

## The trace on HEAD

- **Two states offer the way out.** `lovejoin.ts:4131` has `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`, then `offerAt: c.tail.landed + TAIL_OFFER_MS`.
  - `tailWaits` (`lovejoin.ts:1319`): the chain is still being sent, and its mix waits for giveme.my's signature or Koios's measure. The line is accurate here.
  - `tailBuildable` (`lovejoin.ts:1334-1341`): the chain has ended (a lock, giveme.my's refusal, or a drawn box gone), with `tries < TAIL_TRIES` and the day not over. The tail's `tries` starts at 1 (`lovejoin.ts:4964`), so this state covers the first chain only.
- **The rebuild's waits.** `tailChain` (`lovejoin.ts:4031-4085`) returns `"noPool"` when the read set has no 5 ₳ pool (`:4041`). It returns `"fewBoxes"` when WebAssembly's `collateral_mix` fails with core's `PoolShort` ("pool has N boxes", `:4082`).
  - `"unlisted"` can't occur alongside the offer: it needs `now - landed < LANDING_MS` (15 min, `:352`), and the offer comes after 60 min.
- **The page's reason.** `buildBack` throws `new Error(tailWaiting(resumed))` (`sessions.ts:4390`). Each page shows that error in its own way:
  - **A runs-itself session:** `step()` records it as `auto.retry.error` with reason `"other"` (`sessions.ts:3478`). A swap's timeline shows it through `retryReason` (`Swaps.tsx:3205`). A mix card shows it through `detailOf` as "It tries again at … What went wrong: …" (`Lovejoin.tsx:908-911`).
  - **A site's session:** Bring it back's failure lands in the same Screen's `error` (`SiteSessions.tsx:199-207, 337`).
- **The line beside it.** `CollateralHeldWayOut` renders `lj.tail.privacy.wayOut` whenever `held && now >= held.offerAt` (`LovejoinReturn.tsx:548-551`), with no regard to which state holds it.
  - It sits under the timeline (`Swaps.tsx:2513`, `:2567`), under the mix card's detail (`Lovejoin.tsx:2586-2588`) and on the site's page (`SiteSessions.tsx:410-420`).
  - Its value is `en.json:922`, "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, …". es (`:969`, "sigue esperando a giveme.my") and ja (`:875`, 「まだ giveme.my を待っています」) say the same.
- **The docs.** `flows.md:522` says the offer stands "while the mix still waits (for giveme.my, or to be built again)", so both states are by design. The line's words cover only the first.

## Scratch test

The test was `extension/tests/zz-review-v-x-ui-0-trace-1.test.ts`, run alone and then deleted. It copies `lovejoin-planner.test.ts`'s collateral-mix setup: a site's session, then `stoppedAtMix`, where giveme.my refuses past `GIVEME_BEHIND_MS` and the chain ends with `lj.tail.refused`. The deposit's `landed` is then moved back by `TAIL_OFFER_MS`, as #337's own test does. Each case renders `CollateralHeldWayOut` at the test's clock.

| Case | State | The page's reason | `collateralHeld` | The line | Result |
|---|---|---|---|---|---|
| A | site; the pool's 2 other boxes spent (`fewBoxes`) | Bring it back's error: "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most." giveme.my asked 0 times | `{offerAt: 1800000000000}`, now 1800000180001 | "The collateral's mix is still waiting for giveme.my. …" | **fails on HEAD** (`not.toMatch(/waiting for giveme\.my/)`) |
| B | site; runner over `pooled(t, [])` (`noPool`) | "Lovejoin's pool of 5 ₳ boxes can't be read right now. The rest waits for its collateral's mix, a day at most." | set | same | **fails on HEAD** |
| E | a mix session that runs itself; the runner's step after the drain | `auto.retry.error` = `lj.tail.fewBoxes`. `retryReason` (the swap's timeline) gives the same. `detailOf` (the mix card) gives "Why it stopped: giveme.my wouldn't back the collateral's mix, so the chain stopped there. It tries again at 00:13:30. What went wrong: Lovejoin's pool of 5 ₳ boxes hasn't enough…" | set | same | **fails on HEAD** |
| C (control) | site; pool fine, before Bring back | chain row: "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back". Bring back then builds `["mix","back"]`, giveme.my not asked yet | set | same | passes. The line is loose here: the mix waits for the user's Bring back, then giveme.my |
| D (control) | `tailWaits`: giveme.my busy (503), an hour on | chain row: "Sending 3 of 5 transactions"; `ended` undefined | set | same | passes. **The line is true here** |

## How far it reaches

- **The collateral's tail runs only where a 5 ₳ ADA pool is shown holding the network's floor.** That is 0 on preprod and 30 on mainnet (`networks.ts:56`, `:71`). #337's own description says it "stays dormant on mainnet until a 5 ₳ ADA pool holds its floor of boxes".
- **On mainnet, `fewBoxes` is rare.** It needs that pool to fall below 2 free boxes not the wallet's within the day.
- **`noPool` is rare too.** It needs discovery's kept set to lack the pool (`readSet(…, true)`, `lovejoin.ts:2697-2711`).
- **On preprod, `fewBoxes` is easy to reach.**
- **What the line gets wrong is limited.** Its privacy clauses (unmixed, tied to this session, until you mix it again) are true in every state. Only the reason for the wait is wrong. So this is not a misleading privacy statement in the medium sense. It is a wrong reason, in a critical line, next to a contradicting one. That is low.

## On the fix

The finding's rewording works. "The collateral's mix hasn't gone yet. Without it, its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again." It is true in both states and keeps every privacy clause (rule 3), and it is shorter (rule 4).

A smaller change would also do: drop only "for giveme.my", giving "The collateral's mix is still waiting. Bring the rest back without it, and its 5 ₳ box stays…". That keeps the sentence that links the button to its consequence. It also leaves the back-translated clauses as they are, so the es/ja re-check is a one-clause change.

Whichever way, the key stays `.privacy.`, and es and ja need a new blind back-translation, recorded in `docs/i18n/verified-critical-{es,ja}.json`. No tracked test asserts the "giveme.my" words: `collateral-held.test.ts` checks `t("lj.tail.privacy.wayOut")` and "unmixed, tied to this session". A regression test is cases A/B above: `stoppedAtMix`, then drain or `pooled(t, [])`, move `landed` back, assert `backBuild` rejects with the pool's reason, and assert the rendered line doesn't name giveme.my. The wording is the owner's call.

## Seen on the way (outside this finding and range)

In case E, `chainText(v.chain)` for a runs-itself session gave "Stopped after 3 of 5 transactions; the rest comes back directly". That is what a swap's back step reads through `backStepText`, while the runner in fact waits up to a day to build the mix again. The key `lovejoin.chain.stopped` predates 1.6.0 (`94cfc680`, an ancestor of `babb8e76`), so it is not a 1.7.0 regression. It does add a third, differing statement on the same page.
