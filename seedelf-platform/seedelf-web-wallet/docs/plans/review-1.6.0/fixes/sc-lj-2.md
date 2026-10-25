# Fixer `sc-lj-2`: pools, Start a pool, Bring every box back now, and the held boxes' questions (round 2, lane S1)

Findings 320-screens#0, 320-screens#1, 321-lj-screens#0, #5, #6, the page halves of 321-lj-worker#1 and #4, and the page half of x-privacy#0.

- Most of the work is in `BringAllBack.tsx`, `Lovejoin.tsx` and `LovejoinLaunch.tsx`.
- 321-lj-screens#5 needed one anchored hunk in `background/lovejoin.ts` (Lane W's file). It reads the `bring` option Lane W added to `withdrawOne`.
- No Rust. **No test needs the pkg rebuilt.**
- **No e2e expectation changed:** nothing in `e2e/*.ts` asserts the words or states I changed.

## Findings

| id | status | change |
|---|---|---|
| 321-lj-screens#0 | fixed | The poll and press bookkeeping moved into an exported `bringFollower`, so it can be tested without a DOM. A press now drops every read sent before its request answered, by bumping the count again in a `finally`. Before, a read sent while Stop went could answer after it with the run still going, and the next read said "Done: 3 back". The mirror case is fixed too: a read sent while the ask went said "Nothing of yours was left" before the first run. |
| 321-lj-screens#6 | fixed | The follower hands on the ended run's `pool` with its count. `BringAllBackView` gets `donePool`, so Settings says "Nothing of yours was left in that pool." for a pool's run (new key). Every pool's run and a pool's page read as before. |
| 321-lj-worker#1 (page half) | fixed | `bringing.waiting` shows in place of `why`, the way `held` is shown: one short line for each of the six codes. During a wait, the main line never says "Waiting for the chain to confirm" and never says "0 boxes left". Stop shows throughout. |
| 321-lj-worker#4 (page half) | fixed | When `late` is set (it only comes with confirming), the page shows Stop and one line: "One of them still isn't on chain after 10 minutes. If a node dropped it, it's sent again within 2 hours." The chain's normal confirming minute still has no Stop (owner's item 7). Stop now also shows during every wait after sends (see #1). |
| 321-lj-screens#5 | fixed | Bring every box back now's own withdraws (Lane W's `bring: true`) get their own reason when no private UTxO pays: `lj.bring.warn.privatePayNone`, "…Make some ADA private, or bring it back from its pool's page, paid from your public account." Bring one back keeps `lj.privatePayNone`, since its question offered the public payer. |
| 320-screens#0 | fixed (page) | The hub's started line is now `StartedPools`. From 30 minutes after the start was sent, it says "A pool you started (…) hasn't shown." and gives the likely reasons: the start didn't go through, or an earlier start of the same values did, which makes it a copy (never shown, and what it locked is gone for good). The worker still drops the line after a day. The finding's Send-time refusal isn't done (owner's calls, item 3). |
| 320-screens#1 | fixed | The quantity field is now `AmountField` + `sanitizeAmount` with `launchQuantityRules`: the token's decimals, at most 2⁶⁴−1 raw a box, `token.amount.*` notes, and `swaps.rules.tooMuch`. A note shows under the field, and the field is marked `aria-invalid` when it isn't an amount. The box ADA field is now the wallet's `AdaInput` (ADA rules, ₳ unit). The keys "1,125" now read as 1.125 here, as in every other field. A Spanish paste of "1,125" is refused with both readings shown. |
| x-privacy#0 (page half) | fixed | The questions name the accounts, with `nameOf` ("Account N", or the account's own name), and only where the wallet has several accounts. Details below. |

**x-privacy#0's changes:**
- `HeldQuestion` takes `others` (other accounts' indexes) beside `fromAccount`, which now means the active account's Bootstrap. Each other account gets "{{account}} paid for that Bootstrap…", plural for several.
- `AnywayQuestion` reads `otherAccounts`. `anywayWarning` takes the name and uses its named variants: "The server says Account 1 deposited it…", "On Account 1, Mix again from my public account hides it first."
- `PayerNotes` takes the box's account:
  - under the public payer: "That box is {{account}}'s, so paying from {{active}} ties the two accounts.";
  - under the private payer, for any public account's box: "It avoids one made private from another public account where it can: that would tie the two accounts." This is wlj-1's worker order.
- The new exported `heldAccountsOf` builds HeldQuestion's props from the pool's `otherAccounts`.
- No refusal.

### Why the fixes differ from the suggested ones

- **#0:** the suggested fix, a count bumped after the request, put in an extracted follower. The page tests render without a DOM, so the hook logic couldn't be driven. The extraction was done first with no change in behaviour, so the race test failed for the right reason before the fix.
- **#5: a flag on the throw, not a new option.** Lane W had just added `bring?: true` to `withdrawOne` for the bring's own withdraws, so the one hunk keys the words off that. I added no option of my own.
- **320-screens#0: no launch-transaction link.** `TxDetail` shows only bytes the worker still holds, and "Nothing here links out" (TxDetail.tsx's own rule). Home's banner already reports a dropped start.
- **x-privacy#0: "Account N", not "Public account N".** `tests/i18n-critical-helpers.test.ts` allows `accounts.numbered` and the list punctuation keys in a privacy note's placeholders. It doesn't allow `accountPicker.*` (`publicAccountName`). The Remove Seedelf and dApp warnings name accounts the same way.

## Tests

New files:
- `extension/tests/lovejoin-bring-screen-review-fixes.test.ts`: 10 tests; the #5 tests use the real WebAssembly and PR #163's token pool.
- `extension/tests/lovejoin-launch-review-fixes.test.ts`: 6 tests.
- `extension/tests/lovejoin-accounts-review-fixes.test.ts`: 8 tests.

Every name carries "1.6.0's release review, <id>".

**321-lj-screens#0**, describe "Bring every box back now's Stop, a read answering after it":
- "never says Done for the run the user stopped, though a read sent while Stop went answers with it still going".
  - Fail-before, on the extraction alone: `AssertionError: expected [ 3 ] to deeply equal []`.
- "drops a read sent before the press, however late it answers, and keeps every read sent once it's answered".
  - Fail-before: `expected undefined to deeply equal { back: +0 }`. A read sent during the ask cleared the run.
- "drops the reads sent while a press's request failed too, and shows nothing new for it".
- Mutation: the `finally` bump removed. All 3 fail.

**321-lj-screens#6**, describe "Settings watching one pool's run end with nothing sent":
- "says nothing was left in that pool, never in Lovejoin, where other pools still hold the wallet's boxes".
  - Fail-before: `AssertionError: expected undefined to be 'classic'`.
- "hands every pool's run's end on with no pool, as it was asked".
- Mutations:
  - the follower not passing `last.pool`: fails (the same error);
  - the view ignoring `donePool`: `expected 'Nothing of yours was left in Lovejoin…' to contain 'Nothing of yours was left in that poo…'`.

**321-lj-worker#1**, describe "what Bring every box back now waits for, said on the page":
- "says each wait in one short line of its own, never an older run's reason, with Stop still there". It covers all 6 codes, in Settings and on a pool's page.
- "after its sends, waiting on something else, says so, never that the chain confirms, and keeps Stop".
- Fail-before:
  - `again: expected 'Bringing every box back: 0 boxes sent…' to contain 'Waiting for Mix my boxes again to fin…'`;
  - `landing: expected '3 boxes sent. Waiting for the chain t…' to contain 'Bringing every box back: 3 boxes sent…'`.
- Mutations:
  - the wait line dropped: 2 fail;
  - `confirming` ignoring `waiting`: 1 fails.

**321-lj-worker#4**, describe "Bring every box back now's wait for the chain, late":
- "offers Stop once a withdraw it sent is late, with one short line, and not before".
- Fail-before: `expected '8 boxes sent. Waiting for the chain t…' to contain 'One of them still isn't on chain aft…'`.
- Mutation: Stop hidden while late. `expected '8 boxes sent. Waiting for the chain t…' to contain 'Stop'`.

**321-lj-screens#5**, describe "Bring every box back now where nothing private pays a stuck pool's box":
- "says to make some ADA private or bring it back from its pool's page, never to pay from a public account it doesn't offer". It runs twice: an empty private balance, and one holding only a UTxO with a token.
  - Fail-before: `nothing: expected 'Your private balance has no UTxO of A…' to be 'lj.bring.warn.privatePayNone'`.
- "leaves Bring one back's words as they were: its question offered the public account". This guard passes before and after.
- Mutations:
  - the bring's words never used: the first test fails;
  - the bring's words used everywhere: the guard fails.

**320-screens#0**, describe "a pool the wallet started that no look has found":
- "says it shows once found while its block may still be settling" (1, 10 and 29 minutes).
- "past that, says it hasn't shown, and what that may mean, never that it's on its way" (30 min, 2 h, 23 h, and one line each).
- "says nothing where it started none".
- Fail-before, on the extraction alone: `30 min: expected 'A pool you started (Today, 04:30) sho…' not to contain 'about 10 minutes after its block'`.
- Mutation: the threshold ignored. Fails the same way.

**320-screens#1**, describe "Start a pool's amounts, through the wallet's amount guard":
- How the tests reach the form: `AmountField` is mocked to capture each field's `clean` by id, and the picker's first `useState` is seeded with MIN (the swap-hidden-balances pattern). A page rendered once can't be typed into, so each test types into the captured `clean` itself.
- "reads '1,125' typed as 1.125 of the token, as Send, Swap and Make private do, in any language" (en, es, ja).
- "in Spanish, says both readings of a pasted '1,125' and changes nothing, for the token and the box's ADA".
- "says when it drops decimals past the token's, and keeps no more than one output holds".
- Fail-before: `the quantity's field: expected undefined to be defined`.
- Mutations:
  - the plain quantity `<input>` put back: 3 fail;
  - the plain box ADA `<input>` put back: 2 fail.

**x-privacy#0**, two describes: "Bring one back of a Bootstrap's box another public account paid for" (5 tests) and "Bring one back anyway of a box another public account's deposit put in" (3 tests).
- The 5: names the payer and the tie of the two accounts; the active account's own box; Bring them all back naming two accounts; a one-account wallet unchanged; `heldAccountsOf`.
- The 3: the named deposit, stopped and hides variants; the stuck pool's payer notes; the active account's own box unchanged.
- Fail-before: `expected 'Bring back a Bootstrap's box? A box …' to contain 'Account 1 paid for that Bootstrap, so…'`. The 7 tests that change behaviour fail; the one-account test passes before, as it should.
- Mutations:
  - the public named line dropped: 2 fail;
  - the private-payer line dropped: 4 fail;
  - `anywayWarning` ignoring `account`: 1 fails;
  - the Bootstrap's named sentence dropped: 2 fail;
  - `heldAccountsOf` counting every box as the active account's: 1 fails.

Every mutation was undone with Edit, rerun, and put back with Edit. A grep for the markers afterwards finds none.

### Existing test adapted (setup only)

`tests/lovejoin-session5-screens.test.ts` gains a `vi.mock("../src/ui/accounts")` whose `useAccounts` returns one wallet's accounts without `useContext`.
- That test calls the questions as plain functions to reach their buttons, and already mocks `useT` for the same reason.
- The `useAccounts()` that `HeldQuestion`, `AnywayQuestion` and `PayerNotes` now call made 3 of its tests throw `Cannot read properties of null (reading 'useContext')`.
- No expectation changed.

## Files touched

- `extension/src/ui/components/BringAllBack.tsx`:
  - new: `coversRun`, the exported `bringFollower` and `BRING_WAIT`;
  - changed: the component's state and effect, which go through the follower, and the `done` state, which now carries the run's pool;
  - `BringAllBackView`: the `donePool` prop, the wait and late lines, and when Stop shows.
- `extension/src/ui/screens/Lovejoin.tsx`:
  - `anywayWarning`'s optional `account`;
  - `PayerNotes({ box })`;
  - `AnywayQuestion` (reads `otherAccounts`);
  - `HeldQuestion`'s `others`;
  - the new exported `heldAccountsOf`, used at the HeldQuestion call site;
  - the new exported `StartedPools` and `STARTED_FOUND_MS`, rendered by the hub;
  - the `nameOf` import.
- `extension/src/ui/screens/LovejoinLaunch.tsx`:
  - the new exported `launchQuantityRules` and `MAX_QUANTITY`;
  - the quantity field is an `AmountField`, with its note state;
  - the box ADA field is an `AdaInput`.
- `extension/src/background/lovejoin.ts`: one anchored hunk at `withdrawOne`'s private-payer refusal, which picks the words by `bring`.
- `extension/src/i18n/translations/{en,es,ja}.json` and `docs/i18n/{es,ja}-provenance.json`: anchored inserts only. Every new es/ja value is `machine`.
- Tests: the three new files above, and `tests/lovejoin-session5-screens.test.ts` (setup).

## Keys

**Critical keys added** (8). `node scripts/i18n-critical.mjs` lists each. All need blind back-translation in round 3.
- `lj.bring.warn.privatePayNone`. It fills `settings.lovejoin.warn.bringStopped`'s `{{why}}`, hence the `.warn.` name.
- `lovejoin.pools.warn.startedCopy`
- `lovejoin.anyway.privacy.publicDepositNamed`
- `lovejoin.anyway.privacy.publicStoppedNamed`
- `lovejoin.anyway.privacy.hidesNamed`
- `lovejoin.bootstrap.privacy.accountNamed`: en `_one`/`_other`, es `_one`/`_many`/`_other`, ja `_other`.
- `lovejoin.stuck.privacy.publicNamed`
- `lovejoin.stuck.privacy.privateAccounts`

**Other keys added** (9):
- `settings.lovejoin.bringNonePool`
- `settings.lovejoin.bringWait.again`, `.chain`, `.landing`, `.collateral`, `.withdraw` and `.payment`
- `settings.lovejoin.bringLate`
- `lovejoin.pools.startedMissing`

**Changed:** none.

**Reused unchanged:** `token.amount.notANumber`, `.notAWholeNumber`, `.tooPrecise` and `.wholeUnits`; `swaps.rules.tooMuch`; and, through `sanitizeAmount`/`AdaInput`, `format.*`.

## Docs to update

1. **flows.md:527** (Bring every box back now). Now true:
   - Settings and the pool's page say what a run waits for, one short line in place of an older run's reason:
     - Mix my boxes again finishing;
     - a mix of yours being sent;
     - a mix just sent reaching its pool;
     - a session's 5 ₳ collateral waiting for its mix, a day at most;
     - a box that may already be on its way back;
     - your last payment going through or failing.
   - Stop is there through every wait, after sends too.
   - "N sent. Waiting for the chain to confirm." shows only while it confirms. That keeps no Stop for the chain's usual minute, until a withdraw it sent isn't on chain 10 minutes on. Then it says so ("…If a node dropped it, it's sent again within 2 hours.") and offers Stop.
   - A page never says Done for a run its user stopped there.
   - Settings watching one pool's run that sent nothing says "Nothing of yours was left in that pool."
   - Where no UTxO of ADA alone in the private balance pays for a stuck pool's box, the run's reason says to make some ADA private, or to bring it back from its pool's page, paid from the public account.
2. **flows.md:528** (Start a pool):
   - The token's amount and the box's ADA are the wallet's own amount fields, so commas read as everywhere else and a Spanish paste of d,ddd is said both ways.
   - The token amount takes the token's decimals, at most 2⁶⁴−1 raw a box. The box's ADA field shows ₳.
3. **flows.md:506/507** (the hub's started line), and **lovejoin.launch.sentNote's context**:
   - 30 minutes after a start was sent, if no look has found it, the hub says it hasn't shown.
   - It gives the two likely reasons: its start didn't go through, or an earlier start of the same values did, which makes it a copy no wallet shows, what it locked gone for good.
   - It still goes after a day.
4. **privacy.md:207–210** (the escape hatch's Bring one back; a public deposit's box), checked against **:92/:97** (every screen that could link accounts says so). With several public accounts:
   - Bring one back of a held Bootstrap box, Bring them all back, and Bring one back anyway name the account whose deposit put the box in, where it isn't the one on screen.
   - Paying from the account on screen for another account's box says it ties the two accounts.
   - The private payer's note says it avoids money made private from another public account where it can.
5. **flows.md:524** (Pay from my private balance; the stuck pool's questions): the same naming as item 4.

## Calls the owner might overturn

1. **Stop during waits after sends** (landing, a chain being sent, Mix my boxes again, a payment, a withdraw looked for), and once late. Item 7's "no Stop" now holds only for the plain confirming minute. The late line's 10 minutes and 2 hours are written into the words, matching `BRING_LATE_MS` and `SPENT_KEEP_MS`, as `bringHeld`'s 10 minutes is.
2. **320-screens#0: 30 minutes** before "hasn't shown". The line still goes after a day (the worker's `STARTED_SAID_MS`, 34f's review 11). No link to the launch transaction: the wallet doesn't link out.
3. **320-screens#0's Send-time re-check isn't done.** Refusing a start whose values turned up since its review is a refusal the chain wouldn't make (no paternalistic guards). It also couldn't catch the race: discovery takes a launch only once its block has settled, about 10 minutes, so another start minutes earlier can't be seen at Send. wlj-4's review warning covers this device's own earlier starts.
4. **320-screens#1:** Start a pool's box ADA field now carries the ₳ unit (`AdaInput`), a visual change. Its quantity's too-much words reuse `swaps.rules.tooMuch` ("That's more MIN than there can be.").
5. **x-privacy#0:**
   - Accounts are named "Account N" (`nameOf`), not "Public account N" as the pool page's `OtherAccounts` line names them, for the guard reason above.
   - Names show only where the wallet has several accounts. The public-payer line shows only for another account's box. The private-payer line shows for any public account's box.
   - No refusal (the owner's "honesty, not enforcement").
6. **321-lj-screens#5:**
   - The worker edit relies on Lane W's `bring` flag.
   - The new reason is named `.warn.` because it fills the stopped warning's `{{why}}`. `lj.privatePayNone` never reaches that frame now.

## Notes for the lead and other fixers

- **No test needs the pkg rebuilt.**
- **The lead:** `node scripts/i18n-critical.mjs --write` picks up my 8 critical keys, beside sc-o's `dappUi.back.privacy.noteLovejoinMixed`, `swaps.retry.privacy.cbor` and `swaps.review.privacy.collateralMix`. The derived set is 458 against 447 checked in. `tests/i18n.test.ts`'s three critical-set tests fail until `--write` and round 3.
- **Residual, not in a finding:** Stop pressed on another page still reads as Done on this one. For example, Stop in Settings (a tab) while a pool's page in the side panel shows the run: that page's follower sees the run vanish and says "Done: N back".
  - The page can't tell a stop from an end: the worker deletes `bringing` for both.
  - A fix needs a worker mark on Stop, such as `bringing.stopped` with a user reason kept for one read.
- **Lane W:** my one hunk in `lovejoin.ts` is at `withdrawOne`'s private-payer refusal (`const none = t(bring ? …)`). Renaming `bring` breaks the typecheck there. `tests/lovejoin-bring-review-fixes.test.ts` passes with it.
- **Tests that call these questions as plain functions** need a `useAccounts` mock, as session-5's now has.
- **Visual check (lead):** the screens below. The e2e fakes can't reach most of these states, so the screen harness may be needed.

## Screens to look at

- **Settings → Lovejoin → Bring every box back now:**
  - running with each wait (again, chain, landing, collateral, withdraw, payment): its line and Stop;
  - all sent and waiting to land: no "Waiting for the chain to confirm", Stop there;
  - confirming: no Stop. Confirming late: the late line and Stop;
  - Stop pressed: no Done after;
  - a pool's run that sent nothing, ended while Settings watched: "Nothing of yours was left in that pool.";
  - stopped in a stuck token pool with no ADA-only private UTxO: the new reason inside "Stopped: …".
- **A pool's page:** Bring every box in this pool back now in the same states.
- **Lovejoin hub → Pools:** a start under 30 minutes old (unchanged), and one 30+ minutes old (the new line and its warning).
- **Start a pool:**
  - the token amount field: its note for too many decimals, for too much, and for a Spanish paste of 1,125;
  - the box ADA field with ₳, off until the terms arrive.
- **A stuck token pool, on a wallet with 2+ public accounts, from an account that isn't the box's:**
  - Bring one back of a held box: the named sentence, then the private payer's and public payer's lines;
  - Bring them all back: the named accounts;
  - Bring one back anyway: the named variants.
- **The same pool on the box's own account:** the generic words plus the private-payer line.
- **A one-account wallet:** unchanged.

## Checks

- `npm run typecheck`: clean.
- My three new files and `lovejoin-session5-screens`: 4 files, 43 passed, on the default and the `VITE_ENABLE_MAINNET=false` builds.
- `tests/lovejoin*` with `settings`, `screens`, `hide-balances-forms`, `shown-text`, `format`, `account-picker`, `i18n-critical-helpers`, `i18n-worker-reasons` and `words`: 44 files, 828 passed and 2 skipped, on both builds.
  - This includes `tests/lovejoin-1-5-0.test.ts` (the gate). It and its fixtures are unedited.
- `dapp`, `i18n-assembly`, `payment-forms`, `remove-wallet`, `remove-wallet-mix`, `run-traps-review-fixes`, `withdraw-refused-locked`, `withdraw-resend-unlock`, `collateral-reserve-review-fixes` and `chain-requests`: 10 files, 111 passed.
- `tests/i18n.test.ts`: only the three expected critical-set failures.
- All five locale and provenance files parse, and each holds every key above.
- Not run (the brief): e2e, any build, `--write`, cargo.
