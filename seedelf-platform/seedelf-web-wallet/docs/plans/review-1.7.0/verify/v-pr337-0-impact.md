# v-pr337-0-impact: the way out shown after the rest came back directly

Finding `pr337#0` (low, ux). I judged impact and the fix, on HEAD `6bca8bec`.

## Verdict

- **Confirmed.** Severity **low**, as reported.
- **The fix:** the proposed view change (fix A) is right and minimal. I checked it in a copy.
- **The wording:** the first sentence's wording is the owner's call (nit).

## Is it reachable with the store build?

- **Mainnet (the default):** dormant today.
  - A collateral's tail exists only once a shown 5 ₳ ADA pool holds 30 boxes that aren't the wallet's (`collateralPool`, lovejoin.ts:3966; privacy.md:217).
  - The head start lists no mainnet pool (`src/lovejoin-pools.json`: mainnet `pools: []`). PR #337 itself says "On mainnet it stays dormant until a 5 ₳ ADA pool holds its floor of boxes."
  - Pools are discovered as they're read, so the scenario goes live on mainnet with no update once such a pool exists.
- **Preprod (Settings):** reachable today. The head start has a 5 ₳ ADA pool (`18c4df77…`, `boxLovelace` 5000000), and preprod's floor is 0.
- **The held state is common once a pool exists.** A lock while the collateral's mix waits for giveme.my is "the usual way" a chain stops (`carriedOf`'s doc). The lock countdown only warns while a chain is sent (LockCountdown.tsx).
- **The direct return after a hold is narrower than "any direct return":**
  - **The session's own review has no switch.** For the held session, the default build is the resumed collateral's mix with `lovejoin` absent (scratch ZZ1: `lovejoin null collateralTail true`). `LovejoinSwitch` therefore renders nothing (LovejoinReturn.tsx:375 `if (!back.lovejoin && through) return null;`).
  - **Bring everything back** is the only UI path. It is claimable (ZZ1: stage `open`, chain `stopped`, 1 UTxO), but its switch shows only when `boxes > 0 || direct` (ClaimAll.tsx:286). On its own, the held session gives `boxes: 0` (ZZ1).
  - **So it takes all of these:** a second claimable session whose return has Lovejoin boxes, and the user switching to *directly*.
- **How long it shows:**
  - **A site's session:** until the press, Disconnect, or `landed + TAIL_KEEP_MS`. A site's session doesn't close when its return lands (sessions.ts:5431 `if (!s.site && last.kind === "back" …)`).
  - **A by-hand swap:** only while its direct return is in flight, because it closes once that lands.

## Harm, by the brief's scale

- **What's shown:** a privacy callout whose first sentence ("still waiting for giveme.my") is false, and **Bring the rest back now**, while the account is empty.
- **The privacy clauses stay true:** the box is in the pool unmixed and tied to the session. The Lovejoin page lists it too (`pool.notMixed`).
- **Pressing it is harmless.** ZZ2 shows nothing submitted (6 → 6) and no request to giveme.my, and the press only sets `tail.over`. No stuck state, no money and no data are involved, and the callout clears itself at the day's end (ZZ3).
- **Rating:** a small UX defect in an edge, so **low**. It is not a "misleading money or privacy statement" (medium): the misstatement is operational.

## Scratch runs

The scratch test was `tests/zz-review-v-pr337-0-impact-1.test.ts`, now deleted. It was a copy of `lovejoin-planner.test.ts` plus four tests in the 5 ₳ describe. It aged `tail.landed` in the record, because moving the clock locks the wallet.

**HEAD:**
```
ZZ1 view before open {"total":7,"sent":5,"confirmed":5,"cut":false,"stopped":"giveme.my wouldn't back…"} {"utxos":1} {"offerAt":…}
ZZ1 single review: lovejoin null collateralTail true
ZZ1 claim default [{"i":0,"boxes":0,"tail":true}] []
ZZ2 after send returning {"offerAt":…} {…"cut":true…} now>=offerAt true
ZZ2 after landing open {"offerAt":…} {…"cut":true…} {"lovelace":"0","tokens":[],"utxos":0} now>=offerAt true
ZZ2 tail record {… "tries":1, "landed":…}            (not over)
ZZ2 after press open undefined submitted 6 -> 6
ZZ3 just before the day's end open {"offerAt":…};  past the day's end open undefined
ZZ4 cut, before any return open {"offerAt":…} {…"cut":false,"stopped":"The wallet locked, or the browser closed…"}
ZZ4 cut, after a direct return returning {"offerAt":…} {…"cut":true…}
```

**Fix A**, in a copy under `scratchpad/review/v-pr337-0-impact/fixA`. In `view()`:
```ts
...(stage !== "closed" && tail && !(s.chain && chainView(s.chain, txs).cut) ? { collateralHeld: tail } : {}),
```
- **ZZ2 and ZZ4:** `collateralHeld` is undefined after the direct return, at stage `returning` and once landed (`open`).
- **A real hold is kept:** ZZ4 "cut, before any return" still gives `{"offerAt":…}`.
- **Existing tests:** `lovejoin-planner`, `collateral-held`, `collateral-reserve-review-fixes`, `lovejoin-screens-review`, `lovejoin-stopped-shown`, `session-collateral`, `dapp-chain-collateral` and `collateral-again-review-fixes` pass: **158/158**.

**Fix B**, the alternative, in a copy under `fixB`: `restBack` also sets `tail.over` on the session's ended chains whose box is out (`tailBoxOut`).
- It clears the hold the same way, and the record says `over`.
- **It fails `lovejoin-stopped-shown.test.ts`** ("reads as done once its session's return came back directly…", lines 247-256). That test pins LIVE-1's contract: "Its collateral's box left waiting for its mix … so nothing is marked", and restBack's own doc says "Nothing is written for any other chain" (lovejoin.ts:5105).

## On the fix

- **Fix A is right and minimal.**
  - `cut` (sessions.ts:6166) is true exactly when a return of the rest was recorded after the session's latest chain started and that chain's own return wasn't sent. That return wasn't turned away (`unsent`) and wasn't replaced.
  - That is never the case during a real hold. While the chain is being sent, buildBack refuses with `sess.chainSending`. After a cut, no return went yet.
  - **It stays within the owner's rules:**
    - It adds no guard or refusal and no new strings.
    - The callout goes with its button, as it already does after a press or at the day's end.
    - The box's unmixed state stays on the Lovejoin page.
  - It covers every reader of the view: the site's page, both of a swap's pages, and the mix card.
  - Small polish: compute `chainView` once and reuse it for `chain`.
- **What fix A leaves:**
  - **The hold itself:** the lovejoin record keeps the tail not over until the day's end. `tailBoxes` (lovejoin.ts:6614) keeps holding the box from *Bring every box back now*, which can say "What's left is a session's 5 ₳ collateral: it waits for its mix, a day at most." for a mix nothing can pay for. I read this from the code; I didn't run it. It dates from 1.6.0, not this PR.
  - **A rarer stale hold:** a site's session paid again within the day, whose new chain has no tail of its own. `tailHeld` then picks the older tail and the new chain isn't `cut`.
  - Fix B covers both, but it rewrites a pinned 1.6.0 contract and its test, which is more than this low finding needs for 1.7.0. That trade is the lead's or the owner's call.
- **The test:**
  - **Use the reachable path:** `stoppedAtMix()`, then `claimBuild("preprod", [0], true)` and `claimSubmit`.
  - **Age the record, not the clock:** move `tail.landed` back by `TAIL_OFFER_MS`.
  - **What it should check:**
    - `collateralHeld` is defined before the return, so the test proves the hold was there.
    - It is undefined after the return, at `returning` and once landed (`open`).
  - **Add the lock-cut variant** (ZZ4's setup).
  - **Without the fix it fails:** on HEAD the value is defined.
- **The wording:** "still waiting for giveme.my" is also untrue while a cut chain waits on the pool (`fewBoxes`/`noPool`). Rewording `lj.tail.privacy.wayOut` changes a critical value, so it needs blind back-translations into es and ja: the owner's call, a nit.
- **An aside, owner's call:** Bring everything back's *directly* forgoes a held session's collateral's mix without the way out's note. Its own note covers the returns' ties only. The outcome is the same as the day's end, and this predates 1.7.0.

## Clean-up

- The scratch test is deleted from the tree, and the two copies are deleted from the scratchpad.
- No tracked file was touched, and nothing went to the network.
