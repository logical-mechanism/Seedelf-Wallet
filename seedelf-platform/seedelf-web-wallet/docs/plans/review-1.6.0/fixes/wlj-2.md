# Fixer `wlj-2`: Bring every box back now's waits (Lane L, after `wlj-1`)

Findings 321-lj-worker#0, #1, #2 and #4, and x-scenarios-lj#1. The code changes are in `background/lovejoin.ts`, plus one additive type in `shared/rpc.ts`. I didn't touch `sessions.ts`, `BringAllBack.tsx` or any locale. I added no strings and ran no cargo. **No test of mine needs the pkg rebuilt.**

## Findings

| id | status | change |
|---|---|---|
| 321-lj-worker#0 (medium) | fixed | A chain all sent is taken to be on its way into its pools until it's known in (`mayLand`), for `LANDING_MS` (15 min) at most. While one is, Bring every box back now doesn't end: it waits (`waiting: "landing"`), keeps every due time, then takes the chain's boxes once a read lists them, or keeps their waits for a mix sent after the ask. A box's own run uses the same rule in its trim (the 1.5.0 gap), so it neither drops a landing chain's due times nor sends meanwhile. "Known in" (`ChainRecord.landed`) means one of three things. A read lists a box the chain's last box-making transaction made, or every box it left. Or a watch saw that transaction land (`landedDeposit`, for deposit-only chains: Bootstraps and seeds). |
| 321-lj-worker#1 (low) | partly: the worker half is fixed | Each wait now records a code in the sealed `bringing.waiting`, exposed as `LovejoinHeld.bringing.waiting: LovejoinBringWait`. The codes are `again`, `chain`, `landing`, `collateral`, `withdraw` and `payment`. A wait also clears an older run's `why`, `held` and confirming state, as `held` already did, and never counts toward `BRING_FAILED_RUNS`. A payment that may still go through no longer throws out of the run (`MaybeSentWait`): the run says `payment`. **The screens round renders it** (see notes). |
| 321-lj-worker#2 (low) | fixed | Test-only. A bring with a stuck token pool's box and a classic box in one run. The stuck box comes back beside the smallest private UTxO that pays, and the classic box with its own value alone. It's mutation-checked both ways. |
| 321-lj-worker#4 (low) | partly: the worker half is fixed | **Bound:** the confirming wait is late once its oldest unconfirmed spend has waited `BRING_LATE_MS` (10 min), measured from the wallet's own spent marks (`spent.ts` `spentAt`), so no new sealed timestamp. **Reason:** `bringing.late`, exposed as `LovejoinHeld.bringing.late: true` (only with `confirming`); it clears once the late spend lands. **Stop:** the worker already takes Stop at any time; the page should offer it once `late` is set. The run still waits, and takes no box again before `SPENT_KEEP_MS` (see owner's call 2). **The screens round renders it.** |
| x-scenarios-lj#1 (low) | fixed | The withdraws' gate is now `chainsMixing` / `mixing(c)`: any chain being sent, except one whose collateral's mix alone waits for giveme.my or Koios (`tailWaits`). That's every transaction before the mix on chain (witnessTail sets `Tail.landed` only then), the mix not sent, and the tail not over. Such a chain spends only its collateral's box, its two reserved draws and the session's change, so due boxes, Bring one back now and Bring every box back now all go meanwhile. The bring takes everything else. When only the collateral's box is left, which the mix still spends, it waits with `waiting: "collateral"` (not `held`), as long as the mix may wait (owner's call 323-worker#3 keeps the day). `chainsSending` is unchanged, so the lock countdown and Remove wallet still count that chain. |

### Why the fix differs from the suggested ones

- **#0, no `flying` on the record and no new request.** The suggested option was to record the in-flight hashes at `chainEnded` and look for them on chain. That needs a `sessions.ts` change (Lane D's file) and a Koios or feed request each run. Instead, "known in" comes from what the wallet already has: the bring's own pool read, every read through `sortOut`, and Home's or the session's watch (`landedDeposit`).
  - It's bounded by `LANDING_MS`, as the fix notes asked, for a chain whose last mixes a node dropped. It also covers a chain whose last boxes a stranger moved before any read listed them, when no watch saw them land.
  - The wait never counts as a failed run.
  - I didn't take the simpler alternative of counting in-flight spends as `confirming`. It misses a chain whose deposit is itself still in flight (a Bootstrap, or a short chain), since a deposit spends no box.
- **#0, the extra "known in" rules.** The first version broke three existing tests (lovejoin-flows' 34d review 6; two in lovejoin-pools), each in a way worth fixing in the code rather than the test:
  - a Bootstrap's box moved before any read listed it, though Home's watch had seen its deposit land: hence the `landedDeposit` hook;
  - records whose leaves are all listed: hence the every-leaf rule, which is sound and in practice implied by the last-box rule.
- **x-scenarios-lj#1, gate on the chain's state rather than special-casing each path.** The three gates (a box's own run, Bring one back now, Bring every box back now) and the two end guards all go through `mixing`. The tail's own record says when it's waiting, so no session state is read.

## Tests

New file `extension/tests/lovejoin-bring-review-fixes.test.ts` (13 tests: real WebAssembly, the classic pool's recorded boxes and PR #163's token pool), plus one realistic test in `lovejoin-planner.test.ts`.

| finding | test | fail-before (today's code) |
|---|---|---|
| #0 | "waits for a chain it waited on to land once all sent, keeping its due time and Home's count, then takes its box" | `AssertionError: expected undefined to be defined`: `bringing` gone after the ending run |
| #0 | "keeps the due time of a mix sent after it was asked until that mix's box is listed, then ends with it kept" | `AssertionError: expected undefined to be defined` |
| #0 | "waits no longer than 15 minutes for a chain all sent whose box never shows: a node may drop a chain's last mix" | `AssertionError: expected undefined to match object { waiting: 'landing' }` |
| #0 | "ends once a watch saw a Bootstrap's deposit land, though someone else's mix moved its box before any read listed it" | Written with the `landedDeposit` hook. Its fail-before is mutation M5: `expected { at: 1800000060000, back: 1, …(2) } to be undefined` |
| #0 (regular path) | "keeps a chain's due time in a box's own run while that chain lands, and sends the box due once it's in" | `AssertionError: expected [ { kind: 'lovejoin-withdraw', …(4) } ] to deeply equal []`: the box went and the landing chain's due time was trimmed |
| #1 | "says it waits for Mix my boxes again, then a chain being sent, in place of an older run's reason, and nothing once it goes" | `expected { back: +0, left: 1, …(1) } to deeply equal { back: +0, left: 1, waiting: 'again' }` (the stale `why` stayed) |
| #1 | "says it waits for a withdraw Koios didn't answer, looked for first" | `expected { back: +0, left: 2 } to deeply equal { back: +0, left: 2, …(1) }` |
| #1 | "says it waits for a payment that may still go through, rather than end the run with an error" | `Error: Your last payment may still go through: …` (the run threw) |
| #2 | "brings that pool's box back paid from the private balance, and the classic pool's paying its own way, in one run" | Passes before: it's a test-only finding (mutations below) |
| #4 | "says it's late once a withdraw it sent isn't in a block 10 minutes on, and Stop still stops it" | `expected { back: 1, left: +0, confirming: 1 } to deeply equal { back: 1, left: +0, …(2) }` |
| #4 | "is late no longer once the late withdraw is in, while a later one isn't yet" | The first version gave `expected undefined to be true`. The final version clears `late` through the confirming branch's own `else`, and its fail-before is mutation M9b |
| x-scenarios-lj#1 | "sends a box due meanwhile, its chain still being sent for the lock countdown and Remove wallet" | `AssertionError: expected [] to have a length of 1 but got +0` |
| x-scenarios-lj#1, #1 | "brings one back now meanwhile, and Bring every box back now takes the rest, saying the collateral's box waits for its mix" | `Error: A chain of yours is being sent through Lovejoin. Bring a box back once it's all sent.` |
| x-scenarios-lj#1 | `lovejoin-planner.test.ts`: "lets a box of any pool come back while its mix waits, a day at most (1.6.0's release review, x-scenarios-lj#1)". A real return waits at its collateral's mix while Koios's Ogmios is a block behind | `Error: A chain of yours is being sent through Lovejoin. …`. Its earlier assertions passed on today's code: the chain isn't ended, `tail.landed` is set, and `chainsSending` is true. That confirms the state the fix keys on |

### Existing tests adapted

`tests/lovejoin-bring-all-back.test.ts`: three exact-shape expectations of a wait now include its word, and nothing else changed:
- "waits while a chain … is being sent": `waiting: "chain"`;
- "says a mix built and not sent holds what's left …", last step: `waiting: "chain"`; that test's own comment now says the run says what it waits for;
- "sends nothing while Mix my boxes again runs": `waiting: "again"`.

### Mutation checks

Each hunk was undone with Edit, the tests run, then put back with Edit. `grep Math.random lovejoin.ts` afterwards finds only an old comment.

| id | hunk undone | what failed |
|---|---|---|
| M1 | The bring's landing wait (the early `elsewhere("landing")` and the guard's `mayLand`) | The three #0 bring tests |
| M2 | The regular trim guard's `mayLand` | The regular-path test |
| M3 | The bring's own landed marking | 5 tests: 2 new, plus 3 existing in lovejoin-bring-all-back ("takes only the boxes there…", "says nothing of none left…", "leaves its end to a later run…"). Each then waits out the bound |
| M4 | `sortOut`'s marking | The regular-path test |
| M5 | The `landedDeposit` hook | The Bootstrap test, and lovejoin-flows' "still brings a 1.5.0 seed's box back by itself…" |
| M6 | The every-leaf rule | lovejoin-pools' "brings a token box back by itself…" and "keeps a chain spanning pools as one mix…" |
| M7 | `elsewhere` writing no word | 5 tests |
| M8 | The `MaybeSentWait` catch | The payment test |
| M9 | `late` never set | Both #4 tests |
| M9b | The confirming branch's `else delete b.late` | "is late no longer…" |
| M10 | `mixing` ignoring `tailWaits` | All three x-scenarios tests. My first try was a no-op; it was caught and redone |
| M11 | `collateral` forced false | The x-scenarios bring test (`held: true` in place of `waiting`) |
| M12 | `stuck` forced true | `expected [ …(2) ] to deeply equal [ Array(1) ]`: the classic withdraw spent `a8…#0` too |
| M12 | `stuck` forced false | `expected [ … ] to have a length of 2 but got 1` |

## Files touched

- `extension/src/background/lovejoin.ts`:
  - new: the constants `LANDING_MS` and `BRING_LATE_MS`; the predicates `tailWaits`, `mixing`, `mayLand` and `landedBy`; the methods `chainsMixing` and `bringSays`; `BRING_WAITS`;
  - new fields: `ChainRecord.landed`, `Bringing.waiting` and `Bringing.late`;
  - changed: `bringingView`, `sortOut` (marks chains in), `landedDeposit` (marks a chain in), `withdrawDueNow` (gate and trim guard), `withdrawNowNow` (gate), `bringAllBackNow` (the waits, marking, the collateral word, `late`, the landing wait and end guard), `bringNoted` (clears `waiting`);
  - imports: `MaybeSentWait` and `spentAt`.
- `extension/src/shared/rpc.ts` (additive): `LovejoinBringWait`, and `LovejoinHeld.bringing.waiting` and `.late`.
- `extension/tests/lovejoin-bring-review-fixes.test.ts` (new).
- `extension/tests/lovejoin-bring-all-back.test.ts`: three expectations.
- `extension/tests/lovejoin-planner.test.ts`: one new test. The reserve fixer edits this file too; both edits are intact.

## Keys

None added or changed, critical or otherwise. The worker gives codes, never words; the screen owns the words.

## Docs to update

- **flows.md:527** (Bring every box back now). Now true:
  - Once a chain it waited for is all sent, the run waits for that chain's boxes to reach their pools, 15 minutes at most. That means a read listing one or every box of it, or Home's watch or the session's seeing it land. It never says "Nothing of yours was left in Lovejoin." meanwhile. It takes those boxes if the chain was there when it was asked, and otherwise keeps their due times.
  - It no longer waits for a session's return whose collateral's mix waits for giveme.my or a Koios behind it. It takes every other box, and only the collateral's box, which that mix spends, waits for it (a day at most), said so.
  - Each wait is kept as a word for Settings to say (`bringing.waiting`).
  - Once none is left to send, a withdraw that hasn't reached the chain 10 minutes after it was sent makes the run "late", and Settings offers Stop then (after the screens round). If a node dropped it, its box shows in its pool again 2 hours after the send, and the run takes it then.
- **flows.md:521, privacy.md:217, architecture.md:632** (the collateral's mix waiting up to a day): boxes due, Bring one back now and Bring every box back now go meanwhile, each under its usual rules. Only the collateral's box waits for its mix. The lock countdown and Remove wallet still count the chain as being sent.
- **flows.md / architecture.md** (a box's own run): no run drops a chain's boxes' due times while that chain, all sent, may still be landing, and no box goes back meanwhile (15 minutes at most; a block or two in practice). This was a gap since 1.5.0.
- **architecture.md:424** (`lovejoin.<network>`'s contents):
  - each chain's record says whether, all sent, it's known in (`landed`);
  - while Bring every box back now goes, its record also keeps what it waits for (`waiting`), and whether its withdraws' confirmation is late (`late`).
  
  No new request: on-device, sealed state only. I think the privacy policy's Lovejoin line needs no dated Changes entry, but that's the docs lane's call.
- **architecture.md (the worker's withdraws):**
  - `chainsMixing`/`mixing` (the withdraws' gate, which excludes `tailWaits`) versus `chainsSending` (the lock countdown and Remove wallet);
  - `mayLand`, `LANDING_MS`, `landedBy`, and `landedDeposit`'s new mark;
  - `BRING_LATE_MS`, computed from `spent.ts`' spent marks.
- **plans/chunk-34-token-pools.md:**
  - Session 11's call 2 ("withdraws keep their own rule") and the owner's calls item 1 (the day): withdraws no longer wait for a chain stalled at its collateral's mix (x-scenarios-lj#1);
  - item 7 ("with no Stop"): past `BRING_LATE_MS`, the worker says it's late, for the page to offer Stop (321-lj-worker#4);
  - item 5's bring: it waits for a just-sent chain to land (321-lj-worker#0).

## Calls the owner might overturn

1. **`LANDING_MS` = 15 minutes** (five resend windows) is how long the bring and a box's own run wait for a chain all sent. The slow cases are rare: a stranger's mix moving the chain's last box before any read lists it, with no watch having seen it land (a multi-mix chain from either side), or a node dropping the last mixes. The alternative is asking Koios or the feed whether the last transaction is in, one request a run while waiting. I chose no new request.
2. **The late confirming wait still waits.** `BRING_LATE_MS` (10 min) only says so (`late`), for the page to offer Stop. Retaking the box at the bound would heal a dropped withdraw within minutes instead of `SPENT_KEEP_MS` (2 h). But if the first withdraw lands after all, it would double-count `back` and the mix's credit (`countBack`), and a double credit can free a Bootstrap's held box. So I didn't do it.
3. **The bring waits on the collateral's box as long as its mix waits, a day at most** (the owner's 323-worker#3). It never cuts the mix: the handoff's recommended "unmixed, now" way out stays for after 1.6.0. While it waits, it reads every pool each minute that the wallet stays unlocked, as it does in its other waits. Auto-lock pauses it; Stop works. No 5 ₳ pool exists on mainnet at release, so this is preprod only today.
4. **A box's own run now sends nothing while a chain all sent may be landing.** That's usually a block or two, and its last send's quiet already pushes a withdraw by 5 minutes. Before, the run trimmed the landing chain's due times and sent.
5. **A wait clears an older run's `why`**, as the kept-review wait already did. `fails` is untouched, so stopping after three failed runs still counts across waits.

## Notes for other fixers and the lead

- **No test needs the pkg rebuilt.**
- **The screens round, two new fields** (`LovejoinHeld.bringing`):
  - `waiting?: LovejoinBringWait` (`"again" | "chain" | "landing" | "collateral" | "withdraw" | "payment"`). Show it in place of `why`, as `held` is shown. Suggested short words:
    - `again`: "Waiting for Mix my boxes again to finish."
    - `chain`: "Waiting for a mix of yours being sent."
    - `landing`: "Waiting for a mix you just sent to reach its pool."
    - `collateral`: "What's left is your session's 5 ₳ collateral: it waits for its mix, a day at most."
    - `withdraw`: "Looking for a box that may already be on its way back."
    - `payment`: "Waiting for your last payment to land or fail."
  - `late?: true`, only with `confirming`. Show Stop again and one short line, such as "One hasn't reached the chain yet: it may have been dropped. It's taken again within 2 hours, or Stop."
  - Today's page hides Stop whenever `left === 0 && back > 0`, including during a `landing` wait after sends (15 min at most). Consider showing Stop whenever `waiting` or `late` is set.
- **wlj-3 and wlj-4:**
  - `mixing` / `chainsMixing` is the withdraws' gate. Use `chainsSending` only where a chain waiting at its collateral's mix must count, as the lock countdown and Remove wallet need.
  - `mayLand(c, now)` and `ChainRecord.landed`, marked by `landedBy` (in `sortOut` and the bring) and by `landedDeposit`.
  - `bringSays(network, asked, change)` writes `bringing` only when it changes.
  - `Bringing.waiting` and `.late`; `LANDING_MS`, `BRING_LATE_MS`.
- **Pre-existing, not fixed:** a bring withdraw that's dropped and retaken after `SPENT_KEEP_MS` counts `back` twice and credits its mix twice (`countBack`). Also, after Stop, a dropped bring withdraw's box comes back with no due time, so it waits for the next read that gives it one (an unlock with something open, or a Lovejoin page read). Both are rare.
- **Seen, not mine:**
  - deep-datum's `tests/lovejoin-discovery-review-fixes.test.ts`, 2 tests, waiting for the rebuild;
  - Lane R's `reserve` work in progress: `npm run typecheck` fails only on `sessions.ts:4402` and `tests/lovejoin-planner.test.ts:1604` (`lovejoinDirectCollateralReserve`, not in the pkg until the rebuild). The planner's "is paid for by a site's funding where a 5 ₳ pool would take it…" fails at runtime for the same reason, and `tests/collateral-reserve-review-fixes.test.ts` failed one test per run while being edited, passing on a rerun.

## Checks

- `npx vitest run tests/lovejoin-bring-review-fixes.test.ts tests/lovejoin-bring-all-back.test.ts`: 28 passed, on the default and `VITE_ENABLE_MAINNET=false` builds.
- `npx vitest run tests/lovejoin-planner.test.ts -t "x-scenarios-lj#1"`: passed on both builds.
- `npx vitest run tests/lovejoin tests/sessions tests/words.test.ts tests/chain tests/public-mix tests/remove-wallet-mix.test.ts tests/settings.test.ts tests/i18n`:
  - default: 67 files, 909 passed, 2 skipped, 2 failed (deep-datum's);
  - preprod: the same, plus the reserve fixer's planner test above.
- The 48 other test files that touch Lovejoin, withdraws or the runner (`grep -l 'LovejoinService\|lovejoin\|withdrawDue\|chainsSending\|runNetworks'`, minus the sets above): 625 of 626 on default and 626 of 627 on preprod. The one failure each time was the reserve fixer's file mid-edit.
- `tests/lovejoin-1-5-0.test.ts` (the 1.5.0 gate): 2 of 2 on both builds. It and its fixtures are unedited.
- `npm run typecheck`: clean on my changes (before the reserve fixer's edit landed). Since then, its only errors are the reserve fixer's two above.
