# v-x-rel-5-trace: x-rel#5 (the preprod checklist names none of 1.7.0's behaviours)

**Verdict: partly, low.** Only the #335 part holds up on its own. The checklist never asks anyone to step through a payment in parts' **Transaction details**, and e2e steps through only Make public's.
- The #337 part is F5's finding (x-rel#4).
- The #336 part of item 9's text is F2's (x-rel#1). Its scenario can't happen in the release's run.
- The #333 part is refuted. At today's parameters nothing changes that a manual pass could see. The form never shows the figure the fix asks someone to read. The comparison the fix proposes is already pinned by unit tests.

## What holds

- **The range changed development.md only at line 13** (#331): `git diff babb8e76..6bca8bec -- docs/development.md` is a one-line change.
- **#335's stepper is in five reviews** on HEAD:
  - `Withdraw.tsx:223`, `Transfer.tsx:236`, `Swaps.tsx:935`, `DappApprovals.tsx:772` and `Lovejoin.tsx:3075` all pass `parts={…parts}`.
  - The worker side is generic. `tx-view.ts:150-161` uses `partOf` plus `partKey` over `BUILT_KEYS`, which holds `SESSION_TRANSFER`, `SESSION_WITHDRAW`, `SESSION_OUT`, `SESSION_SITE_OUT` and `SESSION_MIX_OUT`. Fundings keep their parts through the same `keepParts` (`sessions.ts:2960`).
- **e2e steps through Make public's two parts only** (`e2e/extension.spec.ts:2662`, `withdraw-tx-part`).
  - No other spec, and no live run, names a part stepper.
  - e2e never opens Send privately's Transaction details, nor a swap's, a site's or a Lovejoin funding's. The only `*-tx-open` clicks are on move-in, send, withdraw and dapp-tx.
  - Unit coverage: `parts-send-review-fixes.test.ts:1337` covers Send privately's parts through `txView`, and `tx-view-screen.test.ts:613` covers the modal's render.
- **The checklist's Max line** (`development.md:147`) asks only that "the review's *Transactions* says how many it goes as, and Home follows each to the last". `flows.md` documents the stepper ("steps through every one ('Transaction 1 of 2', 1.7.0)"), but the checklist never names it.
- **Precedent:** 1.6.0's review raised the same class of gap ("no 1.6.0 flow in the preprod checklist", low, confirmed by its skeptic). Fix round 1 closed it by adding the checklist lines (`fc8561c7`). So this is a real release-prep gap, not a new rule.

## What doesn't hold

### #333: nothing a manual pass can see

- **At today's parameters the priced way back is 1.5 ₳.**
  - Core: "1.1 ₳ at today's 4,310 lovelace a byte, so 1.5 ₳ as before" (`seedelf-core/src/lovejoin/mod.rs:1740`, with `.max(BOOTSTRAP_BACK_RESERVE)` at `:1750`).
  - That is 1.6.0's fixed reserve, and also the form's stand-in while the worker's figure is unread (`Lovejoin.tsx`: `DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back))`).
  - So the funding and the form's least are byte-for-byte 1.6.0's: 3 ₳ beside the boxes, plus 2 ₳ of fee room.
- **The form shows no reserve figure.**
  - Its notes take `count`, `value`, `most`, `held` and `token` only: `lovejoin.bootstrap.costPrivateOf_*`, `atMostPrivate`, `atMost`, `cantAfford` and `needs_*`.
  - The reserves only feed the hidden `short` test and the "not enough … with the fees and returning the rest on top" note.
  - The fix's "its form asks 3 ₳ beside the boxes" names nothing on screen.
  - The review's *For returning the rest* row (`Lovejoin.tsx:3797`) shows 1.5 ₳, as in 1.6.0.
- **The existing line already runs the new code.** "A Bootstrap … from each side" (`:144`) makes the form call `lovejoin-bootstrap-most`, now `privateBootstrapBounds` (it reads the parameters, then `lovejoinBootstrapReserve(params)`). The private funding prices `back` from its review's parameters (`sessions.ts:2096`). A throw there fails Review visibly.
- **The comparison is pinned already:** `lovejoin-release-rules.test.ts:483-507` covers the form against the funding at today's byte (3 ₳, and "1500000" giving the same `short`) and at 6,465 lovelace a byte (1.8 ₳, short).

### #336: item 9 can't see it in the release's run

- `confirmed()` asks Koios only about a listed pool that isn't in `kept()`. `kept()` merges the bundled head start with what's stored (`lovejoin-pools.ts:348-351`, `:567-570`).
- The release refreshes the head start in part 1 (`npm run lovejoin-pools`) before the checklist. A fresh profile on the store build therefore sends no #336 request for any pool that existed at the refresh.
- Mainnet's head start holds 0 pools (`src/lovejoin-pools.json`, height 14110720).
- Preprod has no data layer (`dataOrigin("preprod")` is undefined), so the check never runs there and item 8 is untouched.
- So "item 9 flags a correct Koios request as a fault" needs a mainnet pool launched between the refresh and the run.
- The clause that makes item 9's text accurate is F2's (x-rel#1 already lists `development.md:162`). No checklist text can make the check run (F7).

### #337: F5's own

The finding's fix adds "F5's line after the collateral-mix line". That is x-rel#4's fix, not this finding's.

## Repro

I ran a scratch test, `extension/tests/zz-review-v-x-rel-5-trace-1.test.ts`, on its own (`npx vitest run …`): **3 failed, 8 passed (11)**. I deleted it afterwards.

**Block A fails on HEAD, so the gap is real:**
- A1: the checklist section matches none of `Transaction details`, `Transaction 1 of`, `Next transaction` or `stepper`.
- A2: the e2e `*-tx-part` test ids are exactly `["withdraw"]`.
- A3: no "Bring the rest back now" (F5's).

**Block B passes, so the #333 part is refuted:**
- B1: the fixture's parameters are 44/155381/4310/16384.
- B2: `lovejoinBootstrapReserve(today)` is `"1500000"`.
- B3: `bootstrapLimits` gives the same result with the priced back as with it unread, at needs−1, needs and needs+1.
- B4: the form's strings carry no reserve placeholder or figure.
- B5: at 6,465 lovelace a byte it's `"1800000"`.

**Block C passes, so the #336 scenario is refuted:**
- C1: the listed pool, not bundled, asks Koios `tx_info` once.
- C2: the same pool in the head start asks Koios nothing in a fresh profile, and is kept.
- C3: `dataOrigin("preprod")` is undefined.

## Fix advice

- **Keep (this finding's own):** item 6's Max line gains "and **Transaction details** steps through each ("Transaction 1 of N"), there and on a swap's, a site's or a Lovejoin funding that goes in parts". Run it on the same wallet of more than 20 UTxOs. An e2e step on Send privately's stepper would be the cheaper guard, but that's a test, not a checklist line.
- **Drop the Bootstrap addition.** Nothing in it can fail at today's parameters, and the form shows no 3 ₳. If anything, keep 1.6.0's existing check, the review's *For returning the rest* reading 1.5 ₳.
- **Item 9's clause** goes with x-rel#1's fix, and #337's line with x-rel#4's. Don't count them twice.
