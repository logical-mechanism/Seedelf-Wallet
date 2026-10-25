# Fixer wss-2 (Lane D): sessions, collateral and activity

Findings: x-scenarios-sessions#0, 309#1, 309#2, 318-worker#2. All four are fixed. Each has a test that failed on the tree first, for the finding's reason, and each was mutation-checked. I also took one of wss-1's handoffs to me (321-parts-worker#0's leftover in `sendFunding`); its other handoff isn't done (see the notes).

**No test needs the pkg rebuilt.** I changed no Rust and added or changed no strings.

## x-scenarios-sessions#0 (medium, money): **fixed**

**Change.** `recoveredRecords` (sessions.ts):
- **What counts as the session's own.** Every transaction the session key didn't sign, other than the one the record takes as the funding, counts when the first UTxO it spent at the wallet contract is under this phrase's register. That covers a funding's other parts and any top-up. These go into `recovered.own`, beside what the key signed, so `buildBack`, `lovejoin.chain` and `tailChain` take their outputs as the session's own: the session's ADA pays their tokens' deposit.
- **One input per transaction is enough.** Every UTxO a Seedelf spend of this phrase takes is its own, and nothing but this phrase's key can prove one at the contract spent. So the first contract input says whose the transaction is. It saves Koios requests on a funding of many parts.
- **How it's read.** That input is asked through `utxo_info` (spent or not), in the same request as the order outputs. It must sit at the wallet contract's credential, and `ownedUtxos` checks its register against the phrase.
- **A server behind.** An input Koios listed but has no `utxo_info` row for fails the scan as not caught up (C14's rule). A record written without the part would leave it out for good.
- **A stranger's payment stays a stranger's,** even one made from their own Seedelf UTxOs: final review F4's rule holds.
- **The funding pick is unchanged.** When parts share a block, the scan may take any part for the funding, and the others still count.
- **Doc comments updated:** the `recovered` field, `recoveredRecords`, `collateralTopUp`, and `buildBack`'s `own`.

**Tests.** `tests/restore-scan.test.ts`, describe "a session funded in parts, found by the restore scan (1.6.0's release review, x-scenarios-sessions#0)":
- **"brings back every part's tokens as the session's own, whichever part the scan takes for its funding".** Two parts, each a Seedelf spend of the phrase's own UTxO. One holds 20 NFTs on 4.09 ₳ and the 5 ₳ collateral; the other 5 NFTs on 1.76 ₳. 25 policies in all. The test runs twice: the parts a block apart, and in one block with the second part sorting last.
  - It checks that Bring it back takes all 3 inputs, leaves nothing out and brings back all 25 NFTs.
  - It checks that `recovered.own` holds the other part, and that `utxo_info` was asked about the other part's input only.
- **"keeps a payment from someone else's Seedelf UTxOs a stranger's: its tokens come back only when they pay their own way".** A guard: it passes before the fix and after.
- **"fails, writing nothing, while the server lists what a part spent but has no row of it".**
- **"brings back every NFT a site's session was funded with in two real parts, after a restore on another device".** End to end:
  - one device builds and sends a real 2-part site funding (`siteOutBuild` with 25 NFTs, real WebAssembly);
  - a fresh device with the same phrase gets the parts' real inputs and outputs, scans, and runs Bring it back: leftOut is [] and all 25 NFTs come back.

**Fail before:**
- Test 1, the parts a block apart: `AssertionError: expected [ { …(3) } ] to deeply equal []`, with `{ reason: "cost", txHash: "a8a8…" (the second part), txIndex: 0 }`.
- Test 1, the same-block case, run first: `{ reason: "cost", txHash: "a7a7…" }`. That's the first part's 20 NFTs, the reproduction's "up to 20 NFTs stuck".
- Test 3: `promise resolved "{ used: 1, found: [ +0 ] }" instead of rejecting`.
- Test 4 was written after the fix. Under mutation 1 below it fails with leftOut `[{ reason: "cost", txHash: "ace0d4…" }]`, which is the finding's failure from real parts.

**Mutation checks** (each hunk undone with Edit, then put back with Edit):

| Hunk undone | Failure |
|---|---|
| The parts left out of `recovered.own` | tests 1, 3 and 4: "cost" entries |
| The register check dropped (every contract-spending payment counts) | test 2: `expected [ Array(1) ] to deeply equal []`, the stranger counted as own |
| The not-caught-up throw disabled | test 3: the scan resolved |

## 309#1 (low, money): **fixed**

**Change.** coin-control.ts `collateral()` says "waiting" for `WAIT_MS` after sending, as before. After that, it keeps saying "waiting" while the wallet still keeps the payment as sent: `sent-txs.ts` `heldSent`, through the new `onItsWay`.
- That's what the balance already counts as on its way: two hours at most (its slot), and gone once it's turned away or found past its slot.
- So Home's row, Lovejoin's form and a freshly opened Collateral page agree with Home's banner ("It can land until about …") and offer no second 5 ₳ payment meanwhile.
- `collateral-build` itself isn't refused.
- It's a session read with no request. A cached reading never expires by time, so Lovejoin's 15 s poll adds no Koios reads.
- A lock wipes what was sent, so after one only the sealed 10 minutes hold, as before.

**Why not the finding's suggestion (the pending watch).** The watch holds only the network's latest Send. Once Home's 10-minute hold is over, a later public payment takes the watch, and the collateral would read "Not set" again while it can still land. `heldSent` covers that case, and it's the balance's own rule.

**Tests.** `tests/coin-control.test.ts`, describe "a collateral payment on its way (1.6.0's release review, 309#1, 309#2)":
- "stays on its way past 10 minutes while it can still land, as Home's banner says, and is not set once it can't". At 11 minutes, with the watch still holding it, the state is waiting. Past its slot, the watch lets it go as expired and the state is "none".
- "stays on its way while another payment from the account takes Home's watch, until it can't land". Two hours after it was sent, the state is "none".
- **An existing test changed.** "stops being waited for after 10 minutes" asserted "none" at 11 minutes while the payment could still land: the bug itself. It's now "stops being waited for 10 minutes after it was sent, once nothing on the device holds it as on its way: after a lock". It shows waiting at 9 minutes after a lock and unlock, and "none" at 11. It passes before and after.

**Fail before:** `AssertionError: expected { state: 'none', reclaimed: false } to deeply equal { state: 'waiting', …(1) }`, in both new tests.

**Mutation check:** `|| onItsWay(…)` removed: both tests fail with the same line.

## 309#2 (low, state; pre-existing): **fixed**

**Change.**
- `submitCollateral` (send.ts) reads the kept build's `account` before `send()`, as mint.ts does, and passes it to `coins.sent(network, utxo, account)`.
- `sent()` (coin-control.ts) reads and writes that one account: `choices(network, index)` and `save(…, index)`. So a switch between the read and the write can't copy one account's choices onto another.
- With no account kept, it uses the active one, as before.

**Test.** `tests/coin-control.test.ts`, "is recorded on the account it was built on, and pays, whichever is active when Send returns". It builds on account 0, sets `LOCAL_ACCOUNT` to 1, then submits. Account 0 gets the collateral, `collateralSentAt` and `collateralPaid`; account 1 stays empty.

**Fail before:** `AssertionError: expected { seedelf: [], cardano: [] } to match object { …(3) }`.

**Mutation checks:**

| Hunk undone | Failure |
|---|---|
| send.ts passes no account | the same line |
| `save()` ignores its account | the same line |

## 318-worker#2 (low, correctness): **fixed**

**Change.**
- **The confirmed row** (activity.ts `describe()`). On the device that paid, a box the account paid to bring back is now **lovejoin-back-paid** ("Paid for a box back from Lovejoin"): the private entry's "lovejoin-withdraw" no longer overrides it (`named`). Its amount is what the account made up, the fee apart, and it has no "Lovejoin" detail, as any other device reads it.
- **The pending row** (incoming.ts `pendingEntries`). A transaction whose private entry is a box's way back ("lovejoin-withdraw") and that pays this account anything is the escape hatch. It's left out until Koios lists it, when `describe()` names it.
  - What it cost the account isn't in its outputs. The box isn't the account's, and the next reading drops the spent paying UTxO, so the device can't price it while it's on its way.
  - Before, it read as money in at the account's whole change ("Back from Lovejoin +16.94 ₳").
  - The check runs before `paid`, so it still holds if the paid withdraw later gains a validity interval.

**Tests.** `tests/activity-review-fixes.test.ts` (new), describe "a box the public account paid to bring back (1.6.0's release review, 318-worker#2)":
- "is named for what the account did, though this device's private history has the box's way back". `describe()` with and without the private entry: both give back-paid, out, 2.64 ₳, fee 0.42 ₳, no detail, and the title "Paid for a box back from Lovejoin".
- "is named so in Public activity once Koios lists it, on the device that paid". This goes through `activity.cardano()`: the private entry is written with `activity.sent`, and Koios has the row by the account's key.
- "isn't listed while it's on its way as money in at the account's change: once Koios lists it, it's named so". This calls `pendingEntries` directly. 1.5.0's recorded Make public stands in for the bytes, since it also carries no slot and pays an account. A control with its own "withdraw" entry is still listed.

**Fail before:**
- Tests 1 and 2: `kind: "lovejoin-withdraw"` where "lovejoin-back-paid" was expected (test 1 failed on its with-private-entry case).
- Test 3: `expected [ { …(9) } ] to deeply equal []`, the entry being kind lovejoin-withdraw, direction in, pending.

**Mutation checks:**

| Hunk undone | Failure |
|---|---|
| `named = mine` | tests 1 and 2 |
| The pending early return disabled | test 3 |

## Extra, wss-1's handoff: 321-parts-worker#0's leftover in `sendFunding`: **done**

**Change.** sessions.ts `sendFunding` now passes `parts: { sent: goNow, total }` to `send()` on the last part that goes at Send while later parts wait, as wss-1's `sendParts` does. How far the funding went is then written ahead and sealed with the watch. A lock while Koios is asked used to leave the sealed copy without it, and Home said "Private session funded" after the unlock.

**Test.** `tests/parts-send-review-fixes.test.ts`, "names a session's funding's first part as it's written ahead, its later parts waiting, so a lock while Koios is asked never makes it funded".
- A real chained site funding: 30 bundles at their least plus one UTxO of ADA, so the parts after the first wait.
- Koios hangs on the first part's submit, and the wallet locks and unlocks.
- Home's `pending-tx` then says "Payment into a private session only partly sent" and "N−1 of N didn't go."

**Fail before:** `AssertionError: expected 'Private session funded 1a6272833f…' not to match /funded/i`.

**Mutation check:** without `...more`, the same failure.

## Files touched

- `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts`:
  - the import of `CONTRACT_V1` and `ownedUtxos`;
  - `recoveredRecords` (the contract-input read, the register check, `recovered.own`);
  - the doc comments of `SessionRecord.recovered`, `recoveredRecords`, `collateralTopUp`, and `buildBack`'s `own`;
  - `sendFunding`'s `more`.
  - Lane L's, reserve's, bootstrap's and wlj-3's hunks are untouched.
- `.../extension/src/background/coin-control.ts`: `WAIT_MS`'s doc, `collateral()`, the new `onItsWay`, `sent()`, `save()`.
- `.../extension/src/background/send.ts`: `submitCollateral`, and the `Kept` import.
- `.../extension/src/background/activity.ts`: `describe()` (`named`) and its doc.
- `.../extension/src/background/incoming.ts`: `pendingEntries`, one early return. **No lane lists this file**; nobody else had touched it.
- Tests:
  - `tests/restore-scan.test.ts`: a describe with 4 tests, and the `testBalances` and `koiosPreprod` imports;
  - `tests/coin-control.test.ts`: a describe with 3 tests, one existing test rewritten, imports;
  - `tests/activity-review-fixes.test.ts`: new, 3 tests;
  - `tests/parts-send-review-fixes.test.ts`: 1 test.
- This report.

## Keys

None added or changed, critical or other.

## Docs to update

- **keys-and-accounts.md, *Accounts* → *The restore scan*.**
  - "Reads the used ones the book doesn't know": every other transaction its key didn't sign (beside the funding) that spent a UTxO at the wallet contract has the first one it spent there read. That's `utxo_info`, spent or not, in the same request as the orders' outputs. The transaction counts as the session's own when this phrase owns that UTxO's register: a funding's other parts, a top-up.
  - "A server that's behind fails it": also when `utxo_info` has no row for such a UTxO.
  - "Adds each account …": `recovered.own` is what its key signed and what the phrase's private balance paid it beside the funding. Their tokens come back as the session's own, its ADA paying their deposit, whichever part the scan took for the funding. A stranger's payment stays a stranger's, even one from their own Seedelf UTxOs (F4).
  - The *Cost* line: those first inputs are in the same `utxo_info`, 60 a request.
- **architecture.md:606** (the restore scan): "and what its key signed" becomes "and its own transactions beside the funding: what its key signed, and what this phrase's private balance paid it (a funding's other parts, a top-up)".
- **architecture.md:626** (*What one return takes*): for a session the restore scan found, its own UTxOs include `recovered.own`'s, every part and top-up included.
- **architecture.md:366** (the collateral): replace "it's 'waiting' until a reading has it, for up to 10 minutes" with:
  - "waiting" for 10 minutes from when it was sent, then while the wallet keeps it as sent (`heldSent`, what the balance counts as on its way: two hours at most, its slot), as Home's banner says it can land until then;
  - after a lock, the 10 minutes alone;
  - the payment is recorded on the public account its review was built on, whichever is active when Send returns (309#2).
- **flows.md:139 and :143** (Collateral):
  - "Waiting for the network to confirm it" lasts while the payment can still land (two hours at most, as Home's banner says), not 10 minutes, on the row, Lovejoin's form and the page alike. No second payment is offered meanwhile.
  - A payment sent from one account's review is that account's collateral even if another window switched accounts before Send returned.
- **flows.md:113** (Public activity): add that a box the account paid to bring back (the escape hatch) is **Paid for a box back from Lovejoin**, at what the account made up, the fee apart, on the device that paid as on any other.
- **flows.md:116** (*Pending*): a box the account paid to bring back isn't listed pending. What it cost the account isn't in its outputs, so it's listed once Koios has it.
- **architecture.md:171** (*The pump*, wss-1's item): add that a session's funding writes how far it went ahead with its last part that goes at Send too (`sendFunding`, as `sendParts`).

## Calls the owner might overturn

1. **309#1: the collateral reads "waiting" for up to two hours** while its payment can still land, so Set collateral isn't offered meanwhile, even for a payment a mempool dropped. This matches Home's banner and the balance. It reports a state; `collateral-build` isn't refused.
   - The alternatives: the old 10 minutes (with its second-payment risk), or a "set it again anyway" control on the page (the screens round, with words).
2. **309#1: `heldSent` is the source, rather than the pending watch** (the finding's lead), as argued above.
   - One edge case: a public payment found unable to land (its inputs spent by another, `inMempool: false`) reads "waiting" until its two hours are up. The balance counts it as on its way too.
3. **318-worker#2: the pending row is left out,** not listed as back-paid at an amount.
   - Doing that needs Lane L and R: `withdrawOne` (paid) passes its payer to `rememberSpent` and keeps WebAssembly's `paid` on the private entry. A validity interval on `buildLovejoinWithdrawPaid` would change its bytes. I did neither.
4. **x-scenarios-sessions#0: a server with no `utxo_info` row for such an input fails the whole scan** as not caught up (C14), so Find leftovers asks again. The alternative is a record that leaves that part's tokens out for good.
5. **x-scenarios-sessions#0: one input decides whose a transaction is:** the first UTxO it spent at the contract, under this phrase's register. Nothing else is asked, not even whether it paid the account, which can't matter, since only outputs at the account are taken.

## Notes for other fixers and the lead

- **Tests needing the pkg rebuilt: none.** `npm run typecheck` shows only reserve's 2 `lovejoinDirectCollateralReserve` errors.
- **wss-1's second handoff is not done:** 321-parts-worker#3's second half. `sendChain` should refuse inputs held in another reservation being sent (`reservedSet(session, network, { sending: true, except: chainOwner(index) })`), so a return reviewed before a payment's Send never merges a funding change a waiting part reserved.
  - It needs a new refusal string for a return, in three languages ("That return spends a UTxO that a payment still being sent in parts spends too. Review it again.", beside `worker.spend.partsConflict.*`), and a chain-with-merge test.
  - It's beyond my four findings: for the lead to route.
- **Lane L (lovejoin.ts), if wanted for 318-worker#2's pending row:** `withdrawOne`'s paid path calls `rememberSpent(session, network, bytes, at)` without the payer, and its private entry doesn't carry WebAssembly's `paid`.
- **`incoming.ts` is edited** (one early return in `pendingEntries`). No lane owns it.
- **The 1.5.0 gate is being edited by another lane** (`tests/lovejoin-1-5-0.test.ts`, x-compat#2's describe).
  - My preprod-build run met it mid-edit: `ReferenceError: Cannot access 'shown' before initialization` and a pools assertion.
  - Rerun alone, it passed 4 of 4 on both builds. Not mine. Note that the brief wants it to pass unedited.
- **`tests/i18n.test.ts`'s three critical-set tests fail** on wss-1's new keys, until the lead's `--write` and their back-translation. Not mine.
- **Cleanup:** my scratch logs are in the scratchpad (`wss-2-*.log`), and nothing is left in the tree.

## Checks

| Check | Result |
|---|---|
| The new tests on the tree before each fix | each failed for the reason above (the two guards passed, as guards do) |
| Mutation runs: 3 for the scan (after its last refinement too), 3 for coin-control/send, 2 for activity, 1 for `sendFunding` | each undone hunk failed its test; every hunk put back with Edit; a grep for the mutations' text finds none left |
| `npm run typecheck` | only reserve's 2 pkg-dependent errors |
| The wide set, default build: 87 files (`restore-scan*`, `sessions*`, `session-*`, `site-*`, `coin-control`, `collateral*`, `accounts*`, `maybe-sent`, `activity*`, `pending-*`, `incoming`, `lovejoin-flows`, `lovejoin-1-5-0`, `lovejoin-restore`, `handlers`, `home-says`, `worker*`, `dapp*`, `paid-rows`, `review-totals*`, `send`, `swap-runner`, `return-*`, `chain-*`, `parts-*`, `payment-parts*`, `remove-wallet*`, `unlock-*`, `settle-across-lock`, `write-ahead`) | 922 of 922 |
| The same 87 files, `VITE_ENABLE_MAINNET=false` | 922 of 922 |
| `tests/lovejoin-1-5-0.test.ts` alone, both builds (after the other lane's edit settled) | 4 of 4 each |
| `words`, `i18n`, `i18n-worker-reasons`, `worker-words`, `import-boundaries` | 80 of 83; the 3 failures are the critical-set gate above |
