# Fixer `fx-lj-1`: Lovejoin's crediting, and the held boxes' questions (round 3b, Lane Y)

Findings R3-2, R3-3, R3-5, R3-6, R3-23 and R3-29, plus the depositors question from review/QUESTIONS.md. All six are fixed. The depositors question isn't real as the worker is wired: a guard test now pins that.

- The code is in `background/lovejoin.ts` and `ui/screens/Lovejoin.tsx` (PayerNotes, PaidQuestion, and a new `hatchAccountOf`), plus one comment in `lovejoin-launch.ts`.
- No Rust. **No test needs the pkg rebuilt.**
- No refusal added: every change is an order, a count, a wait or words.

## Findings

| id | status | change |
|---|---|---|
| R3-2 (low) | fixed | When the private balance pays a box's way back, `withdrawOne` ranks the paying UTxOs by the public account whose box it is: `depositAccountOf(s, box) ?? accountOf(originOf(box, s))`, which is status's `fromPublic` account. A box a stopped public mix left not mixed yet now ranks its own account's money first, as the question says. `ties` (the history) is unchanged: only a box still at its deposit ties, as in PRIV-3 and privacy.md:210. |
| R3-3 (low) | fixed | **Worker:** the escape hatch (`paid` set, no box named) takes boxes in the new `hatchOrder`. The account on screen's own boxes and those no public account put in come first, then other accounts', lowest index first, each group in backOrder's order. Where it takes another account's box, the R3-2 order ranks that account's money first. **Page:** the new `hatchAccountOf(pool)` names that account when every box the hatch can take is another account's. `PaidQuestion` passes it to `PayerNotes`. Its `account` prop is required, so a call site that drops it fails the typecheck. |
| R3-5 (low) | fixed | New `holdable(s, owned, p)`: no Bootstrap holds a box in `counted`. Both `bootstrapOf` and `holderOf` use it, as the skeptic set out. After a dropped Bring every box back now withdraw and Stop, that box comes back by itself, counted once. The Bootstrap holds the boxes it still has out, including one someone else's mix moved, then closes. |
| R3-6 (low) | fixed | `mayLand` also covers a chain whose collateral's mix alone waits (`tailWaits`), for `LANDING_MS` from `Tail.landed`. That adds no request and no words: the bring waits on its existing `landing` word, and a box's own run keeps the due times and sends nothing. The comment is corrected: `landedBy` never marks such a chain in, so the hold runs the whole `LANDING_MS`. |
| R3-23 (nit) | fixed | PayerNotes now shows a whole note for each payer with the accounts named in it, not a sentence appended. New `lovejoin.stuck.privacy.privateNamed`; `lovejoin.stuck.privacy.publicNamed` reworded as the whole public note; `privateAccounts` dropped. Both stuck-pool questions go from 8 sentences back to 6, and every tie stays. |
| R3-29 (nit) | fixed | Comments only: `recordLaunch`, `Schedule.launches`, and lovejoin-launch.ts' `LaunchDeps.lovejoin` now name both rules that read launches (`startedBefore` and submit's `reviewed`). They also say that pruning launches, or dropping `box` or `reviewed`, turns both rules off. |
| Q: depositors | not real; guard added | See below. No source change. |

### The depositors question

QUESTIONS.md asked: if discovery hands over no token pool for 3 h (a worker restarted while discovery is down), could `depositors` age out and lose a public Bootstrap's tie? **No, as the worker is wired:**
- sw.ts gives LovejoinService `serviceDeps(discovery)` (lovejoin-pools.ts).
- Its `pools` swallows the data layer's failure (any non-trap) and returns `discovery.known()`.
- `known()` reads the pools kept on the device (`seedelf.lovejoinPools.<network>` in chrome.storage.local) and the bundled head start. A restart loses neither.
- Discovery never drops a kept pool: `keep` only adds. Only Remove wallet deletes that record, and it deletes the sealed schedule, `depositors` included, with it.
- LovejoinService's own fallback to in-memory `handed` (empty after a restart) runs only if `known()` throws, i.e. chrome.storage.local itself failing.

The guard test makes three reads two hours apart, each with a new PoolDiscovery and a new LovejoinService (a restart) and the data layer refusing. The tie survives. Sanity check: the same test with a read that skips the token pool fails with `expected undefined to match object { account: +0 }`.

### Why the fixes differ from the suggested ones

- **R3-2 + R3-3: the R3-3 skeptic's unconditional rule, not the lead's narrowed formula.** I rank by the box's public account for every public box. The lead's two instructions together (narrowed R3-2, plus "another account's box" for the hatch) would depend on which account is on screen:
  - from account 0's screen, the hatch taking account 1's leaf ranks account 1's money first;
  - from account 1's own screen, the same leaf ranks nothing, and account 0's money can pay for it quietly.

  The on-chain tie is the same either way. The ranking is an order, never a refusal, and costs nothing: the paying UTxO's ADA comes back with the box. Owner's call 1 gives the one-line narrowing.
- **R3-3: the account rank goes before backOrder's `early` key; the skeptic suggested after it.**
  - The page has no block times, so with `early` first it couldn't say which account's box the hatch takes.
  - The worker would then take another account's box where the account on screen has its own box moved within the delay's least.
  - Account first makes the page's naming exact (bar the reservations below), and another account's box goes only where nothing else is. Owner's call 2.
- **R3-5:** the skeptic's filter (`counted` boxes out of `bootstrapOf` and `holderOf`), not the finding's "counted last". The moved-box test shows why: "counted last" still holds the counted box and frees the moved one.
- **R3-6:** the suggested `mayLand` as is. I didn't do the optional tighter end (a new Tail mark when a read lists the tail's box). The lead asked for the bound only.

## Tests

All new test names carry "1.6.0's release review, <id>". Each mutation was undone with Edit and put back with Edit, and a grep for the markers afterwards finds none.

**R3-5**, `tests/lovejoin-crediting-review-fixes.test.ts`, describe "a Bootstrap's box whose withdraw of Bring every box back now a node dropped, then Stop (1.6.0's release review, R3-5)":
- "holds the boxes it still has out, never the one counted back, which comes back by itself, counted once". It runs twice: all three boxes at the deposit, and ": one of them moved by someone else's mix".
  - The run ends with B1 closed and a later box of the wallet's held for nobody.
  - Fail before, both: `expected [ { …(3) }, { …(3) } ] to deeply equal …` (held `b1#0, b1#1` where `b1#1, b1#2` was expected; moved: `b1#0, b1#1` where `b1#1, f9#0` was).
- "counts a box someone else's mix moved, brought back by hand, against the Bootstrap it was moved from, a box of that one counted back still listed". Two Bootstraps.
  - Fail before: the page offered `b1#1` where `f9#0` was expected.
- Mutations:
  - `bootstrapOf` back on `inPool`: all 3 fail;
  - `holderOf` back on `inPool`: the two-Bootstrap test fails (`expected [ [ …(2) ], [ …(2) ] ] to deeply equal …`: B1 credited for B2's moved box).

**R3-6**, `tests/lovejoin-bring-review-fixes.test.ts`, describe "a session's collateral's mix waiting for giveme.my (… x-scenarios-lj#1)", on `waitingTail` with the chain's boxes not listed yet:
- "waits for its boxes while the listing lags, never saying nothing was left, and takes them once listed (R3-6)".
  - Fail before: `expected undefined to match object { waiting: 'landing' }`.
- "keeps its boxes' due times in a box's own run while they may be landing, and sends the box due after (R3-6)".
  - Fail before: `expected [ { kind: 'lovejoin-withdraw', …(4) } ] to deeply equal []`.
- Mutation: the tail branch off. Both fail with the same lines.

**R3-2 and R3-3, the worker**, `tests/lovejoin-crediting-review-fixes.test.ts`, describe "a stuck pool's box paid back from the private balance (… x-privacy#0)". New helpers `stuckPool` and `publicMix`.
- "pays for a box a public mix stopped short of mixing with one that names no other account where one pays, as its question says (R3-2)".
  - Fail before: it spent `d2…#0` (account 1's 3 ₳) where `d1…#0` (account 0's) was expected.
- "brings back, naming no box, the account on screen's own before another account's, with its money first (R3-3)".
  - Fail before: it spent `[a1…#0, d1…#0]` (account 1's box) where `[c1…#0, d2…#0]` was expected.
- "pays for another account's box, the only one it can take, with that account's money first (R3-3)".
  - Fail before: it spent `d2…#0` (account 0's money) where `d1…#0` was expected.
- Mutations:
  - `hatchOrder` dropped: the first R3-3 test fails;
  - the payer's fallback dropped (`depositAccountOf` alone): all three fail.

**R3-3 (the page) and R3-23**, `tests/lovejoin-accounts-review-fixes.test.ts`:
- New describe "the escape hatch, where the only box it can take is another public account's (… R3-3)":
  - "names that account, the lowest of several, as the worker takes them, and none while it may take another". Fail before: `TypeError: hatchAccountOf is not a function`.
  - "says paying from this account ties it to that one, and what the private balance avoids". Fail before: `expected 'Pay for a box to come back? Paid from…' to contain 'Paid from Account 2, one of its UTxOs…'`.
- "names the accounts in each payer's own note, never in a sentence after it (R3-23)". It asserts both payer notes exactly, and 6 sentences in all. Fail before: `expected [ …(2) ] to deeply equal [ …(2) ]`.
- The existing x-privacy#0 expectations (AVOIDS, "That box is…") now read the folded words. Before the page change, 7 of the file's 11 tests failed: those 4 updated tests and the 3 new ones.
- Mutations:
  - PaidQuestion ignoring `account`: 1 fails;
  - `hatchAccountOf` with `some` in place of `every`: `expected 2 to be undefined`;
  - the private note never named: 6 fail;
  - the public note never named: 4 fail;
  - the call site without `account=`: typecheck `TS2741: Property 'account' is missing`.

**Depositors (the question)**, in the 316#1 describe: "keeps whose deposit it was through worker restarts with the data layer down, as discovery hands over the pools it kept". A guard: it passes before and after, and fails with a read that skips the token pool (above).

**R3-29**: comments only, so no test.

**Existing test adapted (setup only):** `tests/lovejoin-session5-screens.test.ts` now passes `account: undefined` to `PaidQuestion`, which requires it. Its other hunk in the tree (R3-21's bootstrapNotePrivate) belongs to another fixer.

## Files touched

- `extension/src/background/lovejoin.ts`:
  - `mayLand` and its comment;
  - new `holdable`, used by `holderOf` and `bootstrapOf` (with a line in its comment);
  - new `hatchOrder`, used by `withdrawNowNow`'s no-box branch;
  - `withdrawOne`'s private-payer order and its comment;
  - the comments on `recordLaunch` and `Schedule.launches`.
- `extension/src/background/lovejoin-launch.ts`: `LaunchDeps.lovejoin`'s comment.
- `extension/src/ui/screens/Lovejoin.tsx`:
  - new exported `hatchAccountOf`;
  - `PayerNotes` (named whole notes);
  - `PaidQuestion`'s required `account`;
  - its call site.
- `extension/src/i18n/translations/{en,es,ja}.json` and `docs/i18n/{es,ja}-provenance.json`: anchored edits only.
- Tests:
  - `tests/lovejoin-crediting-review-fixes.test.ts`: the R3-5 describe; 3 tests in x-privacy#0; 1 in 316#1; imports.
  - `tests/lovejoin-bring-review-fixes.test.ts`: 2 tests in x-scenarios-lj#1.
  - `tests/lovejoin-accounts-review-fixes.test.ts`: helpers, updated expectations, 3 new tests.
  - `tests/lovejoin-session5-screens.test.ts`: one line.

## Keys

**Critical keys added:** `lovejoin.stuck.privacy.privateNamed`, in en, es and ja, with es/ja provenance `machine`.
- en: "Paid from your private balance, one of its UTxOs of ADA alone goes into the box's own transaction, and its ADA comes back with the box, less the fee, so anyone can tie that UTxO, and where it came from, to the box. Where it can, the wallet takes one that came back from Lovejoin, else one that ties no other account."

**Critical keys changed:** `lovejoin.stuck.privacy.publicNamed`, now the whole public note. es/ja are re-drafted and still `machine` (L5 drafts, never verified).
- en: "Paid from {{active}}, one of its UTxOs goes into the box's own transaction, so anyone can tie {{active}} to the box, to {{account}}, whose box it is, and to the private UTxO it comes back into."
- It names all three ties the two old sentences made: the payer account to the box, to the box's account, and to the private UTxO.

**Critical keys removed:** `lovejoin.stuck.privacy.privateAccounts`, from en, es, ja and both provenance files.

**Other keys:** none.

Round 4 back-translates `privateNamed` and the new `publicNamed` instead of the old values. The verified generic `lovejoin.stuck.privacy.private` and `.public` are unchanged.

## Docs to update

1. **privacy.md:208, flows.md:524, architecture.md:733** (Pay from my private balance's order). This supersedes wlj-1's item for :208. Now true:
   - One back from Lovejoin goes first.
   - Then, for a box a public account put in, one made private from no other public account. That covers its deposit's box (a Bootstrap's, a seed's, a mix cut at its deposit), a box a mix of its left not mixed yet, and its mix's leaf still where that mix left it.
   - Then the smallest.

   privacy.md:210 is unchanged: the history ties only a deposit's account.
2. **privacy.md:207, flows.md:523** (the escape hatch's Bring one back, which names no box). Now true:
   - It takes the account on screen's own boxes and those no public account put in first.
   - It takes another account's box only where nothing else is, the lowest account first.
   - Its question then names that account ("Paid from Account 2, … anyone can tie Account 2 to the box, to Account 1, whose box it is, and to the private UTxO it comes back into.").
3. **privacy.md:207–210 and flows.md:524** (sc-lj-2's docs items 4 and 5). The questions name the accounts inside each payer's note; the private payer's note ends "…else one that ties no other account".
4. **flows.md:527** (Bring every box back now). Now true:
   - It also waits, `LANDING_MS` at most, for the boxes of a session's return whose collateral's mix waits for giveme.my. The wait counts from when that chain's transactions before the mix were first known in a block, and it says it's waiting for a mix to reach its pool. A box's own run sends nothing meanwhile, and drops none of those boxes' due times.
   - After Stop, a Bootstrap's box whose withdraw a node dropped comes back by itself, counted once. The Bootstrap keeps holding the boxes it still has out, never that one.
5. **architecture.md** (the worker's withdraws): `mayLand` covers a chain at its tail (`tailWaits`) for `LANDING_MS` from `Tail.landed`. `landedBy` never marks such a chain in, so the hold runs the whole `LANDING_MS`.
6. **architecture.md** (the token pools' records): no Bootstrap holds a box in `counted` (`holdable`, in `bootstrapOf` and `holderOf`).
7. **architecture.md** (the escape hatch): `hatchOrder`, and the payer order in item 1.
8. **The privacy policy: no change, I think.** These changes add no request and no party. The policy doesn't describe the payer order or the hatch's pick, and nothing it says becomes false. It's the docs lane's call.

## Calls the owner might overturn

1. **The payer order covers every public account's box, including the account on screen's own mix leaves.** That's the R3-3 skeptic's rule, a superset of the lead's narrowed R3-2 formula, so the same box gets the same order from any account. To narrow it:
   - write `owner = depositAccountOf(s, box) ?? (unmixedOf(s.chains, [box]).length || accountOf(originOf(box, s)) !== active ? accountOf(originOf(box, s)) : undefined)`, with `active` read as withdrawNowNow reads it;
   - in the R3-3 own-box test, the expected payer then becomes `d1`.
2. **The hatch ranks the account before backOrder's `early` key.** An own box a mix moved within the delay's least can go before another account's box that has waited longer. With `early` first, the page couldn't name the account reliably.
3. **PaidQuestion names an account only where every box the hatch can take is another account's**, the lowest of them, as the worker takes them. Otherwise it names none, since the worker takes the account's own box or a private one first. The page can't see reservations, so in one rare case it names nobody while the worker takes another account's box: the account's own box held by a kept review.
4. **R3-6 holds the whole `LANDING_MS` (15 min) from `Tail.landed`,** as a done chain whose last box no read lists does. Meanwhile no box comes back by itself, and Bring every box back now says it's waiting. The tighter end (a new Tail mark when a read lists the tail's box) isn't done.
5. **R3-5: the box the dropped withdraw went for comes back by itself after Stop,** at its own due time, as w-left's note (b) intended. Its way back ties its deposit, which Bring every box back now's question said. Before this fix, another of the Bootstrap's boxes, one the user's run never sent, came back by itself instead.
6. **R3-23:** both questions are back to 6 sentences, still over "a few short sentences". The skeptic put further compression outside R3-23.

## Notes for the lead and other fixers

- **No test needs the pkg rebuilt.**
- **`node scripts/i18n-critical.mjs --write`.** It adds `privateNamed` and drops `privateAccounts`, beside another lane's `collateral.warn.bothLand`. I listed the derived set without writing it: 459 against 458 checked in. `tests/i18n.test.ts`'s three critical-set tests fail until `--write` and round 4 (L5), as expected.
- **e2e:** no expectation names the words I changed (a grep of `e2e/*.ts` for the old and new words, and for `lovejoin-paid`).
- **Visual check (lead):** a stuck token pool on a wallet with two or more public accounts:
  - Bring one back anyway of another account's box: the private note ends "…else one that ties no other account", and the public note names both accounts;
  - Bring one back of a held box another account's Bootstrap put in;
  - the escape hatch where the only boxes are another account's: it names that account;
  - the same on a one-account wallet: unchanged.
- **Lane X / fx-reserve:** my lovejoin.ts hunks are in `mayLand`, `holdable`/`holderOf`/`bootstrapOf`, `hatchOrder`/`withdrawNowNow`, `withdrawOne`'s private payer, and two comments. My Lovejoin.tsx hunks are in `hatchAccountOf`, `PayerNotes`, `PaidQuestion` and its call site. None touches `collateralPoolTakes`, `publicSideOf` or the Mix form.
- **fx-lj-2:** I didn't touch `BringAllBack.tsx`, `runs.ts` or `activity.ts`. The bring's `landing` word now also covers a chain at its tail (R3-6).

## Checks

- `npm run typecheck`: clean.
- My files, on the default and `VITE_ENABLE_MAINNET=false` builds: 5 files, 69 passed each. That's crediting 17, bring 18, accounts 11, session5, and the 1.5.0 gate, which passes unedited.
- `npx vitest run tests/lovejoin`: 35 files, 608 passed and 2 skipped, on both builds.
- The 89 other test files that reach Lovejoin (`grep -l 'LovejoinService\|lovejoin\|withdrawDue\|chainsSending\|runNetworks\|Lovejoin'`, minus `tests/lovejoin*`): 1121 passed on both builds.
- `i18n`, `i18n-critical-helpers`, `words`, `privacy-notes`, `i18n-worker-reasons`, `i18n-review-fixes`: 130 passed, 3 failed. The 3 are the expected critical-key gate above.
- Not run (the brief): e2e, any build, `--write`, cargo.
