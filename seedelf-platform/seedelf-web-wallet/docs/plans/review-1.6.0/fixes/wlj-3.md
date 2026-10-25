# Fixer `wlj-3`: the collateral's mix (the tail) (Lane L, after `wlj-2`)

Findings 323-worker#2, 323-worker#5, 323-worker#8 and gap-1#0. The code is in `background/lovejoin.ts`, plus small anchored hunks in `sessions.ts` and one in `handlers.ts`. I ran no cargo and changed no Rust. **No test of mine needs the pkg rebuilt.**

The wait itself (a day on giveme.my) and any "unmixed, now" way out are the owner's (323-worker#3), so neither changed.

## Findings

| id | status | change |
|---|---|---|
| 323-worker#2 | fixed | `tailChain` returns why it waits (`TailWait`), and `buildBack` throws `tailWaiting(why)`. Each wait has true words and its bound: a box not listed yet (deposit not in, or in and not listed yet) says "an hour at most", the pool not readable and too few free boxes say "a day at most". Koios not answering whether the deposit is in now throws Koios's own error, still holding the return. Before, all four said the box isn't in the pool, and to try again in a minute. |
| 323-worker#5 | fixed | A box whose deposit is known in but isn't listed is waited for up to `LANDING_MS` (15 min, wlj-2's listing bound), counted from when its deposit was first known in (`tailLanded`, which also starts its day). Then it's taken for moved. If one of the wallet's own sends spent it (Mix my boxes again, Bring one back now), it's taken for moved at once. Before, it was taken for moved at once and the return swept what pays for its mix. |
| 323-worker#8 | fixed (tests, plus a defect they found) | 11 planner tests cover the give-ups, the waits and the switch. **Defect found:** after a rebuilt tail chain stopped before sending anything (the second try), `chainSoFar` said "not started". So the next return skipped `tailOf` (the tail was never marked over) and took the fresh-return path. That path gives a false reason: `mix.skipped = mixCannotPay` for a mix session ("Not mixed", "Came back without going into Lovejoin"), or `lovejoinSkipped = noBox` otherwise. A rebuilt tail chain now records where the chain it continues began (`SessionRecord.chain.from`), and `chainSoFar` counts from there. |
| gap-1#0 | fixed | `account-use` now waits only on what is the account's: a payment that may still go through, a public mix that may have gone through, or a mix from the public account still being sent (new `LovejoinService.publicChainsSending`). A private session's chain never holds the switch: its one-time keys sign it, it pays the Seedelf key's register, and neither depends on the public account. So the refusal's words are true when it shows. The lock countdown (`chains-sending`) and Remove wallet (`atStake`) still count every chain. |

### Why the fixes differ from the suggested ones

- **323-worker#5:** I wait out a listing grace rather than ask `utxo_info` whether the box is spent. The grace adds no request: the spent check would be a new Koios request naming the box, which the policy's list of reads would need. A box another mix moved is now taken for moved up to 15 minutes later, and the return waits meanwhile.
- **323-worker#2, the Koios case:** I throw Koios's own error rather than add words of my own. The runner already classifies it (`retryReasonOf`: "The server didn't answer.").
- **323-worker#2, the suggested direct path:** not done. The finding's other suggestions (a direct path on the site page, Bring everything back's switch always shown, Settings' switches as a direct ask) are each an "unmixed, now" way out: the owner's (323-worker#3).
- **323-worker#8:** I fixed the defect rather than pin it. The tests were meant to guard exactly these paths, and the second give-up's return disagreed with the first's.

## Tests

All 11 are new, in `extension/tests/lovejoin-planner.test.ts`, in the describe "its waits and its give-ups (1.6.0's release review)" nested in "a return's 5 ₳ collateral mixed once into the 5 ₳ pool". They use the real WebAssembly, the launched 5 ₳ pool and a site's session.

| # | test | finding | fail-before | mutation (undone with Edit, the test failed, put back with Edit) |
|---|---|---|---|---|
| 1 | "says the 5 ₳ pool hasn't enough of other people's boxes for its mix, never that its box isn't in, until there are" | #2 | `expected [Function] to throw error including 'Lovejoin's pool of 5 ₳ boxes hasn't…' but got 'Its 5 ₳ collateral's box isn't list…'` (the one generic key) | M1, `"fewBoxes"` → `"unlisted"`: the same failure |
| 2 | "says the 5 ₳ pool can't be read while discovery doesn't hand it over, never that its box isn't in" | #2 | `…including 'Lovejoin's pool of 5 ₳ boxes can't …' but got 'Its 5 ₳ collateral's box isn't list…'` | M2, `"noPool"` → `"unlisted"`: the same failure |
| 3 | "says what Koios answered, never that its box isn't in, while it can't tell whether its deposit went in" (tx_status answering 503) | #2 | `expected Error: Its 5 ₳ collateral's box isn't lis… to be an instance of KoiosError` | M3, the old `.catch(() => null)` put back: the same failure |
| 4 | "waits for a listing behind its deposit to show its box, rather than take it for moved and sweep what pays for its mix" (then listed 5 min later: `["mix","back"]`) | #5 | `promise resolved "{ …(10) }" instead of rejecting` | M4, grace removed: tests 4 and 5 fail the same way |
| 5 | "takes its box, still not listed a quarter of an hour after its deposit was known in, for one a mix moved, and brings the rest back" | #5 | as 4, at its first step | M4 |
| 6 | "takes its box for moved at once where a send of the wallet's own spent it, as Mix my boxes again does" | #5 | a guard: it passes before, since today takes every unlisted box for moved at once | M5, the wallet's own spend ignored: `Error: Its 5 ₳ collateral's box isn't listed in Lovejoin's pool yet. The rest waits for its mix, an hour at most.` |
| 7 | "stops at its collateral's mix once giveme.my kept it waiting a day, and the rest comes back without it" (`lj.tail.tooLong`, giveme.my not asked again, a plain return with no false reason, the tail over) | #8 | test-only: passes before | M6b, `tailOf`'s day check doubled: `expected { box…, leaf… } to be undefined` (the mix built a third time). M6c, `witnessTail`'s day check doubled: `expected [ …(2) ] to have a length of 1 but got 2`. Doubling `TAIL_KEEP_MS` itself passes, since the test moves `landed` back by that constant (it pins the path, not the figure) |
| 8 | "gives its collateral's mix up once it was built twice, the second stopping too, and the rest comes back without it" | #8 | the defect: `expected undefined to be true` (the second tail never over), then, with the reason checked, `expected 'its spare ADA is too little for a box' to be undefined` | M7, `tries > TAIL_TRIES`: `expected { box… } to be undefined`. M8a, `chainSoFar` without `from`, and M8b, `sendChain` not recording `from`: both `expected 'its spare ADA is too little for a box' to be undefined` |
| 9 | "never builds again a collateral's mix that was sent, though a node dropped it: its box waits not mixed yet, its due time gone" | #8 | test-only: passes before | M9, `tailOf` without `c.tail.scheduled`: `expected { …(3) } to be undefined`. M9b, `sortOut` not unscheduling a chain with a tail: `expected [ 1800012600000 ] to deeply equal []` |
| 10 | "lets the user switch public accounts while a session's collateral's mix waits for giveme.my: no account is in its transactions" | gap-1#0 | `Error: A payment or mix from this account is still on its way. Wait for it to settle, then switch accounts.` | M10a, `a.chainSending` put back in the filter: the same error |
| 11 | "still refuses a switch while a mix from the public account is being sent, its watch following that account" | gap-1#0 | a guard: it passes before | M10b, public chains not counted: `promise resolved "{ …(2) }" instead of rejecting` |

Test 10 also checks two more things. The lock countdown and Remove wallet still report the chain. And after the switch, the session's chain goes on (its mix, then its return) once giveme.my answers.

On test 9's question (the drawn share with no leaf): the entry's +1 share follows the box, as any dropped mix's does. The box is held as not mixed yet, its record stays while the box is listed, and the share closes when that box comes back by hand or is mixed again. Its drawn due time goes at the next read. Nothing comes back by itself in its place.

## Files touched

- `extension/src/background/lovejoin.ts`:
  - new: `TailWait` and `tailWaiting` (exported, after `Tail`);
  - new: `publicChainsSending`;
  - changed: `tailChain` (the codes, Koios's error, the listing grace, the wallet's own spend) and its doc;
  - changed: `LANDING_MS`'s doc.
- `extension/src/background/sessions.ts`, small anchored hunks only:
  - the import of `tailWaiting`;
  - `buildBack`'s throw;
  - `SessionRecord.chain.from` (the type and its doc);
  - `chainSoFar`;
  - `sendChain`'s `s.chain` line.
- `extension/src/background/handlers.ts`: the `account-use` case only.
- `extension/src/i18n/translations/{en,es,ja}.json`.
- `docs/i18n/{es,ja}-provenance.json`.
- `extension/tests/lovejoin-planner.test.ts`: the imports, and the nested describe with its 11 tests.

## Keys

- **Critical keys added or changed: none.** None is named `.warn.` or `.privacy.`, and `node scripts/i18n-critical.mjs` (print only) derives none of them.
- **Added:** `lj.tail.fewBoxes` and `lj.tail.noPool`, in en, es and ja, with es/ja provenance `machine`.
- **Changed:** `lj.tail.waiting`, in en, es and ja (es/ja provenance was already `machine`). It's now said only for a box not listed yet:
  - en: "Its 5 ₳ collateral's box isn't listed in Lovejoin's pool yet. The rest waits for its mix, an hour at most."
  - `lj.tail.noPool` (en): "Lovejoin's pool of 5 ₳ boxes can't be read right now. The rest waits for its collateral's mix, a day at most."
  - `lj.tail.fewBoxes` (en): "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most."
- **Checks on the change:**
  - Tests grepped for the key and the old words ("isn't in Lovejoin's pool yet", "Try again in a minute"): only `lovejoin-planner`'s two `tr("lj.tail.waiting")` assertions use it. Both are still the deposit-not-in case, and both pass.
  - These are saved worker reasons (`auto.retry.error`), shown later as "It tries again at {{at}}. What went wrong: {{error}}." and in the Swaps retry line. So they're statements with a bound, never an order to try again.

## Docs to update

- **architecture.md:632** (the collateral's mix bullet), the sentence "While the box isn't listed, the return waits (`lj.tail.waiting`)…". Now true:
  - Each wait says why and how long (`TailWait`, `tailWaiting`):
    - a box not listed yet: `lj.tail.waiting`, an hour at most;
    - the 5 ₳ pool not in the read set: `lj.tail.noPool`, a day at most;
    - too few free boxes to draw: `lj.tail.fewBoxes`, a day at most.
  - Koios not answering whether the deposit is in throws Koios's own error.
  - A box whose deposit is in but isn't listed is taken for moved only `LANDING_MS` after the deposit was first known in, which also starts its day. It's taken for moved at once when one of the wallet's own sends spent it.
  - A rebuilt tail chain records `SessionRecord.chain.from`, so `chainSoFar` counts the chain it continues. After a second stop, the next return is plain, never a fresh chain, with no "left out" reason.
- **privacy.md:217** ("the rest held back meanwhile…"). Add that a box whose deposit is on chain, but which the pool's listing doesn't show yet, is waited for up to 15 minutes from when the deposit was first known in. Only then is it taken as moved by someone else's mix, and the rest comes back.
- **flows.md:154** (Switching). Now true: the switch is refused only for something of the account's: a payment that may still go through, or a mix from the public account still being sent. A private session's chain, its collateral's mix waiting for giveme.my included, never holds a switch. The lock countdown and Remove wallet still count that chain.
- **plans/chunk-34-token-pools.md:**
  - Session 11, :953: "Koios not answering still waits" stays true, now in Koios's own words.
  - :926, the tail's worker bullet: record 323-worker#2 (the words), #5 (the listing grace), #8 (the tests and `chain.from`) and gap-1#0.

## Calls the owner might overturn

1. **The listing grace reuses `LANDING_MS` (15 min),** counted from when the deposit was first known in. The alternative is a `utxo_info` spent check: definitive, but one more Koios request naming the box. A box someone else's mix really moved now holds the return up to 15 minutes.
2. **A box one of the wallet's own sends spent is taken for moved at once** (Claude's call), with no grace.
3. **The bounds in the words are upper bounds from now:** "an hour at most" and "a day at most". What's left may be shorter.
4. **Koios not answering now says Koios's error,** not tail words. The return is held exactly as before.
5. **Not done (the owner's, 323-worker#3):** any way to bring a held return back directly, or Settings' collateral switch turned off releasing a started tail. Both would be an "unmixed, now" way out. `buildBack(…, direct = true)` already skips the tail, so the owner's choice would be a screen and words.
6. **`chain.from` is a behaviour change in a Lane D file** (`sessions.ts`). After a rebuilt tail chain stops having sent nothing, the session counts as started:
   - its next return is plain, never a fresh chain through Lovejoin;
   - `lovejoinWantsCollateral` offers no 5 ₳ then;
   - a mix session is no longer marked "Not mixed".
7. **gap-1#0 unblocks the switch for every private session's chain,** not only one waiting at its tail, as the finding suggested: none involves the public account.
   - The optional countdown words aren't done (a session's mix waiting for giveme.my, and that a lock costs one of its two builds). They need new strings on a screen: the screens round's.
8. **Seen, not changed:** the switch's other check (`maybeSent`) covers the payment watch, which can hold a private `transfer` or `withdraw`. For those, "from this account" may be inexact too. I didn't check whether that watch depends on the active account.

## Notes for other fixers and the lead

- **No test needs the pkg rebuilt.**
- **wss-1 / wss-2 (sessions.ts, handlers.ts):**
  - my hunks are `chainSoFar`, `SessionRecord.chain.from`, `sendChain`'s `s.chain` line, `buildBack`'s throw and `account-use`, all small and anchored;
  - `atStake` and `chains-sending` are untouched;
  - `reserve`'s hunks are intact.
- **wlj-4 (lovejoin.ts):**
  - `tailChain` returns `TailWait | chain | undefined`;
  - `tailWaiting(why)` gives the words;
  - `publicChainsSending` is the switch's own check, beside `chainsSending` (countdown, Remove wallet) and `chainsMixing` (withdraws).
- **The screens round:** a held return's reason now arrives in true words. 323-worker#3's chain-view field, if the owner wants one, is still to do.
- **Seen, not mine:**
  - `tests/i18n.test.ts`'s three critical-set tests fail on Lane D's new keys `lock.warn.partsWaiting` and `settings.remove.warn.partsWaiting` (the lead's `--write`, and their back-translation);
  - `tests/chain-requests.test.ts`'s `parts-waiting` test failed once mid-edit (Lane D), then passed;
  - deep-datum's 2 tests and reserve's planner test wait for the rebuild;
  - `npm run typecheck`'s only errors are reserve's `lovejoinDirectCollateralReserve` (rebuild). Two errors from other lanes' mid-edits (`handlers.ts` `parts-waiting`, `script-spend.ts`) were gone on the rerun.

## Checks

- **The planner file**, `npx vitest run tests/lovejoin-planner.test.ts`: 61 of 62 on both the default and the `VITE_ENABLE_MAINNET=false` builds. The one failure is reserve's (rebuild).
- **The wider sets**, `npx vitest run tests/lovejoin tests/sessions tests/i18n tests/words.test.ts tests/chain tests/remove-wallet tests/handlers.test.ts tests/worker.test.ts tests/accounts tests/settings.test.ts tests/public-mix tests/collateral tests/site`:
  - default: 999 passed, 2 skipped, 7 failed;
  - preprod: 1000 passed, 2 skipped, 6 failed;
  - every failure is listed above as not mine.
- **The 32 other files that drive sessions, the handlers or Lovejoin** (dapp-*, session-*, return-*, restore-scan*, withdraw-*, parts-send-review-fixes, swap-lovejoin-way, unlock-waits, worker-words and more): 334 of 334 on both builds.
- **The 1.5.0 gate**, `tests/lovejoin-1-5-0.test.ts`: 2 of 2 on both builds. It and its fixtures are unedited.
- **`npm run typecheck`:** clean on my changes.
- **After every mutation was put back,** a grep for each mutation's text found none left.
