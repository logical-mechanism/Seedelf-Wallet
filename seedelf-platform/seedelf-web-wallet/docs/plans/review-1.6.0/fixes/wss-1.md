# Fixer wss-1 (Lane D): payments in parts, and what stops them

Findings: gap-1#1, gap-3#6, 321-parts-worker#0, 321-parts-worker#1, 321-parts-worker#3, x-scenarios-sessions#2. The owner's call 321-parts-worker#2 is answered by gap-1#1's and gap-3#6's warnings: no new refusal, and a lock still cuts the rest.

No test needs the pkg rebuilt. Nothing here touches Rust.

## gap-1#1 (medium, state): **fixed**

**Change.**
- `PartsService.waiting(network)` (parts.ts) lists each payment whose parts still wait: not stopped, `sent < total`.
  - A Send still sending counts, since it's cut too.
  - Each entry carries `{sent, total}`, and `session` for a funding.
- `atStake` (handlers.ts) adds an optional `partsWaiting: [{sent, total}]`, spread in only when there is one.
  - A session's funding is left out, because its session is listed already.
  - So `reset-check` lists the payment, Remove wallet shows a line, and its existing second yes (*Remove it anyway*) is needed. `reset-wallet` without `force` throws `RESET_AT_STAKE()`.
  - Parts that stopped aren't listed, so nothing asks for "anyway" for the hour their record is kept for Home.
- The new line is in `atStakeLines` (Settings.tsx), under `settings.remove.warn.partsWaiting`, beside the Lovejoin chain's line.
- `account-use` is unaffected. wlj-3's filter there reads `maybeSent || mixMaybeSent` only.

**Tests.**
- `tests/parts-send-review-fixes.test.ts`, describe "what a lock or Remove wallet stops of a payment in parts (1.6.0's release review, gap-1#1, gap-3#6)":
  - "lists a payment whose parts still wait, removing the wallet only at a second yes, and tells the lock countdown": a real 3-part chain, 1 sent.
  - "lists nothing, and asks no second yes, once the parts stopped".
  - "leaves a session's funding in parts to its session in Remove wallet's list, and still tells the lock countdown": the session is listed once, with no parts line.
- `tests/remove-wallet.test.ts`, "says a payment still being sent in parts, which removing the wallet stops partway (1.6.0's release review, gap-1#1)": one payment and two.

**Fail before:**
- `expected [] to deeply equal [ { network: 'preprod', …(3) } ]` (reset-check);
- `expected [] to deeply equal [ Array(1) ]` (the screen's line);
- `expected undefined to be true/false` (no parts-waiting answer).

**Mutation checks.**

| Hunk undone | Failure |
|---|---|
| `filter(() => false)` (field never set) | the first test, `expected [] to deeply equal …` |
| `filter(() => true)` (a funding listed again) | the session test, `expected [ { network: 'preprod', …(3) } ] to deeply equal [ { network: 'preprod', …(2) } ]` with `+ "partsWaiting"` |
| the line's `if` disabled | `expected [] to deeply equal [ Array(1) ]` |

## gap-3#6 (low, state): **fixed**

**Change.**
- A new request, `parts-waiting`: `rpc.ts` Requests and `REQUEST_LIST`, additive.
  - It's answered from every network's `PartsService.waiting`, a session's funding included.
  - It answers false while locked, when there are none.
  - It isn't activity. It doesn't change `chains-sending`, which Lovejoin's line and the e2e test read.
- `LockCountdown.tsx` asks it beside `chains-sending` while the countdown shows.
  - It keeps `data-parts-waiting` as it keeps `data-chain-sending`.
  - It says `lock.warn.partsWaiting` under `data-testid="lock-countdown-parts"`.
  - Both lines now render from a small exported `LockStops`, so the line can be tested without a DOM. The chain's markup is unchanged.
- Remove wallet is as in gap-1#1.

**Tests.**
- `tests/chain-requests.test.ts`, describe "whether a payment's parts wait to go, for the lock countdown (parts-waiting; 1.6.0's release review, gap-3#6)":
  - "says so for parts waiting on any network, a session's funding's too, and not once they stopped, nor while locked";
  - "says under the countdown that locking now stops them partway, beside a chain's line".
- The parts-waiting assertions in gap-1#1's tests.

**Fail before:**
- `expected undefined to be false`;
- `expected '' to be 'A payment is being sent in parts: loc…'`.

**Mutation checks.**

| Hunk undone | Failure |
|---|---|
| The answer forced false | both worker tests, `expected false to be true` |
| The parts line removed | `expected '' to be …` |

## 321-parts-worker#0 (low, state): **fixed**

PendingBanner.tsx needed no change. It already says "… only partly sent" for parts that stopped. The fault was in what fed it.

**Change.**
- **The watch keeps how far the payment went** (pending.ts). A part sent with more of its payment to go carries `parts: {sent, total}` (`Sending.parts`). It's written ahead and sealed on the watch record, and it's in the answer.
  - `nameParts` takes it too. It writes it, and seals a maybe-sent watch again, so a lock no longer strips a part named at Send.
- **Who passes it** (parts.ts):
  - `sendParts`, for the last part that goes at Send when parts wait after it;
  - `step`, for each pump-sent part with more to go;
  - `letGo`, through `nameParts`.
  - `holdWaiting` names the watched last part too. That covers a session's funding: `sendFunding` (sessions.ts, not mine) sends it without the field.
- **Home's poll** (handlers.ts `pending-tx`). A chain-named watch with no parts' record, whose own `parts` say more were to go, comes back as `parts.stopped: "locked"`.
  - The banner then says "Private payment only partly sent" and "N of M didn't go", never "confirmed" nor a session "funded".
  - For a part never seen, the count is now right: "2 of 3", where it was "1 of 3".
- **The type** (rpc.ts): `PendingTx.parts.stopped` gains `"locked"`.

**Tests.** `tests/parts-send-review-fixes.test.ts`, describe "a payment in parts after a lock (1.6.0's release review, 321-parts-worker#0)". Each goes through the real `handle({type: "pending-tx"})`.
- "says a part the pump sent, which Koios didn't answer, went with the rest cut once it lands after a lock, and counts it among those that didn't if it never shows": lands, and never seen.
- "says a first part written ahead before a lock, its later part waiting, went with the rest cut once it lands": Koios hangs on the submit while the wallet locks.
- "keeps, through a lock, the name a part Koios didn't answer at Send was given as the rest were let go": the `nameParts` path.
- "names a funding's part Koios didn't answer, as its later parts are held, so a lock never makes it funded": `sendFunding`'s own sequence, `splitParts` → `send` with `chain` → `holdWaiting`.

**Fail before:**
- `'Private payment confirmed …'`, three times;
- `'Private session funded …'`;
- never seen: `Received: "Private payment only partly sent 1 of 3 didn't go. …"`, where `"2 of 3 didn't go."` was expected.

**Mutation checks.**

| Hunk undone | Failure |
|---|---|
| The handler's rule | all 4 fail, reading "Private payment not confirmed yet 1 m[ore to go]" |
| `step`'s `parts` | the pump test |
| `sendParts`' `parts` | the hanging test |
| `nameParts`' seal | the `nameParts` test, and the funding test (the backstop seals through it) |
| `letGo`'s `parts` | the `nameParts` test |
| `holdWaiting`'s backstop | the funding test |

The handler's mutation shows its rule is load-bearing. The watch's progress alone would say "1 more to go" forever.

## 321-parts-worker#1 (low, ux-words): **fixed**

**Change.** `sendParts` handles Send pressed again on a first part that's kept as sent, once the pump holds the rest.
- `pumpHolds` decides it: the parts' record is there and isn't `sending`, and Send's own copies of the later parts are gone.
- Then only the first goes again, as it was. It goes with its `chain` and progress, so a Koios answer this time no longer drops the watch's `chain`.
- The answer carries the record's progress, `parts: {sent, total}`, and no error. Before, it said the rest didn't go and to review what's left, while the pump still sent them.
- "Send pressed again after one turned away" is unchanged: Send's copies are still there then, and it retries them.

**Test.** `tests/parts-send-review-fixes.test.ts`, "Send pressed again on a payment in parts (1.6.0's release review, 321-parts-worker#1, x-scenarios-sessions#2)" > "sends only the first again once the rest wait, and says how many went, never that the rest didn't".
- It runs twice: Koios answers the second press, or still doesn't.
- The second part is sent exactly once, by the pump.

**Fail before:** `Error: 1 of 2 transactions went, but the server didn't answer for the last one, so the rest didn't go. Once it's settled, review what's left again.`

**Mutation check:** with the branch disabled, the same error.

## x-scenarios-sessions#2 (low, ux-words): **fixed**

- (a), the false `worker.parts.partly` on Send again, is fixed by 321-parts-worker#1's change and covered by its test.
- (b), `partlyMaybe` saying "the rest wait", was already fixed by i18n-existing. It now says "so the rest didn't go" in en, es and ja, pinned in parts-send-review-fixes.test.ts. I left it as it is.

## 321-parts-worker#3 (low, state): **partly**

**Change.** In `send()` (script-spend.ts), a payment's first part (kept with `partHashes`) reads the parts kept after it, through `laterParts`.
- One missing, or another review's, is refused before anything goes as a stale review, `NOT_READY`.
- Every part is checked with the first:
  - spent since (`refuseSpentSince`, now taking several transactions), before giveme.my is asked;
  - chains being sent (`refuseReserved`), but the payment's own `parts.<first>`, last, as the first's is.
- One that can't go refuses the whole payment with nothing sent, in the existing words (`worker.spend.spentSince`, `chainConflict.*`, `partsConflict.*`).
- It covers Send, Make public and a session's funding. All send their first part through `send()`, so sessions.ts needed no edit.
- Each part is still checked again as it goes.

**Not done:** the finding's second half. `sendChain` in sessions.ts should refuse inputs a waiting part reserved. That file isn't mine; see the notes.

**Tests.** `tests/parts-send-review-fixes.test.ts`, describe "a payment in parts checked whole at Send (1.6.0's release review, 321-parts-worker#3)":
- "refuses, sending nothing, a review whose later part spends what another of the wallet's transactions spent since": parts that each pay their own way, and chained;
- "refuses, sending nothing, a review whose later part spends what a chain being sent holds".

**Fail before:**
- `expected [Function] to throw error matching /^Another of your transactions spent p…/ but got '1 of 2 transactions went. The rest di…'`;
- `promise resolved "{ kind: 'transfer', …(6) }" instead of rejecting`.

**Mutation checks.**

| Hunk undone | Failure |
|---|---|
| The later parts dropped from the spent check | the first fail-before line again |
| The later parts' reservation check | the second fail-before line again |

## Files touched

- `seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts`
- `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts`
- `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts`: `send()`, `laterParts`, `refuseSpentSince` and `refuseReserved` only.
- `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts`: `parts-waiting`, `pending-tx`, `atStake`. Line 350 is wlj-3's, untouched.
- `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts`, additive: `PendingTx.parts.stopped` `"locked"`, `AtStake.partsWaiting`, the `parts-waiting` request and its `REQUEST_LIST` entry.
- `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LockCountdown.tsx`
- `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Settings.tsx`: `atStakeLines` only.
- `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/{en,es,ja}.json`: new keys only.
- `seedelf-platform/seedelf-web-wallet/docs/i18n/{es,ja}-provenance.json`: `machine` for each new es/ja value.
- `seedelf-platform/seedelf-web-wallet/extension/tests/parts-send-review-fixes.test.ts`: imports, the `homeHears` comment, 4 describes, 10 tests.
- `seedelf-platform/seedelf-web-wallet/extension/tests/remove-wallet.test.ts`: 1 test.
- `seedelf-platform/seedelf-web-wallet/extension/tests/chain-requests.test.ts`: imports, header comment, 1 describe, 2 tests.
- `send.ts` and `PendingBanner.tsx`: not changed. Neither needed it.

## Keys

**Critical keys added** (`.warn.`): `lock.warn.partsWaiting` and `settings.remove.warn.partsWaiting`.
- The plural forms: en `_one`, `_other`; es `_one`, `_many`, `_other`; ja `_other`.
- es and ja provenance is `machine`, to be back-translated blind.
- Every other key added or changed: none.

| Key | en | es | ja |
|---|---|---|---|
| `lock.warn.partsWaiting` | A payment is being sent in parts: locking now stops it partway. | Se está enviando un pago por partes: si la billetera se bloquea ahora, el pago se detiene a medias. | 支払いを分けて送信中です。今ロックされると、支払いは途中で止まります。 |
| `settings.remove.warn.partsWaiting_one` | {{network}}: a payment is still being sent in parts. Removing the wallet stops it partway: what's still to go stays in your private balance. | {{network}}: un pago todavía se está enviando por partes. Eliminar la billetera lo detiene a medias: lo que falta por enviar sigue en tu saldo privado. | (ja has `_other` only) |
| `settings.remove.warn.partsWaiting_other` (es `_many` the same) | {{network}}: {{count}} payments are still being sent in parts. Removing the wallet stops them partway: what's still to go stays in your private balance. | {{network}}: {{count}} pagos todavía se están enviando por partes. Eliminar la billetera los detiene a medias: lo que falta por enviar sigue en tu saldo privado. | {{network}}: 分けて送信中の支払いが {{count}} 件あります。ウォレットを削除すると途中で止まり、まだ送られていない分はプライベート残高に残ります。 |

Each mirrors the Lovejoin chain's line beside it, and uses the glossary's "in parts" (por partes, 分けて送信).

## Docs to update

- **`docs/flows.md:104`, Remove wallet's list.** Add: a payment still being sent in parts, which removing the wallet stops partway, what's still to go staying in the private balance. A session's funding in parts is its session's line.
- **`docs/flows.md:369`, *Parts that wait*.** After "A lock wipes what waits…", add:
  - while parts wait, the lock countdown says "A payment is being sent in parts: locking now stops it partway." (`parts-waiting`);
  - Remove wallet lists them and needs *Remove it anyway*.
  - Send pressed again on a first part that may have gone, once the rest wait, sends only that first again and answers how far the payment went.
- **`docs/flows.md:370`, *Home's banner*.** "Never 'confirmed'" now holds after a lock too.
  - The part the watch holds keeps how far the payment went, sealed. Once it lands it reads "… only partly sent", "N of M didn't go", and a funding is never "funded".
  - A later part never seen counts with the rest that didn't go: "2 of 3".
- **`docs/flows.md:381`, Send's checks.** For a payment in parts, every later part is checked as the first goes. One spent since refuses the review as stale, and one a chain being sent holds refuses it whole: nothing sent. That sentence was false for a later part.
- **`docs/architecture.md:170`, *The worker*.** The first part's `send` checks every later part: `laterParts`, spent since, and reservations but the payment's own `parts.<first>`. A missing part is a stale review. Send again, with the pump holding the rest, resends only the first (`pumpHolds`).
- **`docs/architecture.md:171`, *The pump*.** After "A lock wipes session storage, and with it what waits: the rest never go", add:
  - each part sent with more to go carries `parts: {sent, total}` on its watch record, written ahead and sealed (`Sending.parts`; `nameParts` seals again, and `holdWaiting` names a funding's);
  - `pending-tx` turns a chain-named watch with no parts' record into `parts.stopped: "locked"`.
- **`docs/architecture.md:430`, the `seedelf.waiting.<network>` row.** "Only while unlocked: a lock stops the rest" gains: the lock countdown and Remove wallet say so first.
- **`docs/architecture.md:441`, Remove wallet's list.** Add a payment whose parts still wait to go. It's read from session storage (`seedelf.waiting.<network>`, `partsWaiting`), not the sealed records, and a session's funding is its session's.
- **`docs/architecture.md:450`, the countdown.** It also asks `parts-waiting` and says the parts line (`data-parts-waiting`).
- **`docs/plans/chunk-34-token-pools.md`, 10b's call 1, and `HANDOFF.md`'s owner's calls.** The lock still cuts the rest. It's now said first, in the countdown and in Remove wallet, and Home no longer calls such a payment confirmed after an unlock. A sealed record that Home reads after an unlock is still not built.

## Calls the owner might overturn

1. **Remove wallet needs its existing second yes while a payment's parts wait.** It's the same rule as a Lovejoin chain being sent. That's the existing question gaining a line, not a new refusal: *Remove it anyway* still removes, and leaves the rest unsent.
2. **The countdown only warns.** Waiting parts don't put the lock off; Stay unlocked is there.
3. **A session's funding in parts gets no line of its own in Remove wallet.** Its session's line covers it. The countdown counts it, since a lock leaves the funding short.
4. **A new reason, `"locked"`, in `PendingTx.parts.stopped`.**
   - No screen tells reasons apart. The banner says "only partly sent" for any.
   - The record can also be gone because it was let go an hour after the parts stopped for another reason. The words are true either way.
5. **Remove wallet's line counts payments rather than saying "1 of 3 sent".** That keeps the text short. `AtStake.partsWaiting` carries `{sent, total}` for each payment, should the screens round want it.
6. **321-parts-worker#3.**
   - A later part missing from Send's keeping is now refused as a stale review before anything goes. Before, the first went and then the rest were refused.
   - giveme.my is still asked before the reservation check, as for one transaction.
7. **321-parts-worker#3's second half isn't done** (see the notes).

## Notes for other fixers and the lead

- **wss-2 (sessions.ts):**
  - `sendFunding` could pass `parts: { sent: goNow, total }` to `send()` on its last go-now part when `goNow < total`, as `sendParts` now does. `holdWaiting` names that part once its send returns. A lock while Koios is asked for it still leaves the sealed copy without the field, and Home would say "funded" after the unlock.
  - 321-parts-worker#3's second half: `sendChain` (about sessions.ts:4559) should also refuse inputs held in other chains' reservations being sent (`reservedSet` with `sending`, except its own). A return reviewed before a payment's Send would then never take what a waiting part reserved. Today the payment stops partly sent.
- **The lead:**
  - Run `node scripts/i18n-critical.mjs --write`. It picks up the two new keys, `lock.warn.partsWaiting` and `settings.remove.warn.partsWaiting`.
  - `tests/i18n.test.ts` fails three critical-key tests until then, and until i18n-new back-translates the six es/ja values: "is derived from the source, and the checked-in list matches" (444 vs 446), and "es.json / ja.json has no unchecked machine draft among them".
- **Tests needing the pkg rebuilt:** none.
- **e2e:** the countdown gains `data-parts-waiting`. `data-chain-sending` and `lock-countdown-chain` are unchanged.
- **Failures outside my work:** three tests that wait for the rebuild, the same as reserve's and deep-datum's reports.
  - `tests/lovejoin-discovery-review-fixes.test.ts`, 2 tests (deep-datum);
  - `tests/lovejoin-planner.test.ts`, "is paid for by a site's funding where a 5 ₳ pool would take it…" (reserve).

## Checks run

| Check | Result |
|---|---|
| Baseline before any edit: parts-send-review-fixes, payment-parts-chain, remove-wallet, remove-wallet-mix, chain-requests | 5 files, 48 passed |
| The 13 new tests on today's code | 13 failed, each for the reason above |
| The 13 new tests after the fixes | 13 passed |
| Mutation runs, 4 groups chosen so none masks another, plus a re-check of the strengthened session test | each undone hunk failed its test; every hunk put back with Edit |
| `npm run typecheck` | clean but reserve's 2 pkg-dependent errors (`lovejoinDirectCollateralReserve`, sessions.ts:4415 and lovejoin-planner.test.ts:1836) |
| My area, 30 files: parts, payment-parts*, remove-wallet*, chain-requests, transfer, withdraw, send, pending-*, maybe-sent, settle-across-lock, unlock-*, restore-scan, history-classes, max-left, home-says, lock-screens and others | 30 files, 304 passed |
| The same final set after the last edits (15 files) | 186 passed |
| `VITE_ENABLE_MAINNET=false`: parts-send-review-fixes, remove-wallet, remove-wallet-mix, chain-requests, payment-parts-chain | 5 files, 61 passed |
| i18n, i18n-critical-helpers, i18n-assembly, i18n-worker-reasons, i18n-joins, i18n-screens, i18n-values-in-place, words, worker-words, ui-safety, opens-at-top | 207 passed; 3 failed, the critical-key gate above, expected |
| `tests/lovejoin* sessions* session-* site-* swap* dapp* collateral*` (the 1.5.0 gate among them) | 79 files, 1012 passed, 2 skipped; 3 failed, the pkg-dependent tests above |
