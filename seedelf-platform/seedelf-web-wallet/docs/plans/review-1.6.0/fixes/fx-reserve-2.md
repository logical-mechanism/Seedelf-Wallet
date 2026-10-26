# Fixer `fx-reserve-2`: the Mix form, the fundings' fallback, and a return's parts check (round 3b, lane X)

Findings R3-7, R3-8, R3-14 and R3-4.

- **Worker:** `sessions.ts`: `orWithoutReserve`, `roomless` and `TOO_LARGE` (new), `refuseParts` (new), `sendBack`, `sendChain`.
- **Screen:** `Lovejoin.tsx`'s Mix form: `mixOffer`, `CollateralIfLeft`, `publicPick`, `accountLeast`, `publicBoxesAffordable` (new); `mixMost`, `publicMixAda`, `publicSideOf` changed; PoolPage's wiring and the Bootstrap form's held figure.
- **No Rust, no WebAssembly change:** nothing waits for a rebuild.

## Findings

| id | status | change |
|---|---|---|
| R3-7 | fixed | **`mixOffer`** (new, PoolPage calls it) sets the stepper's cap and every refusal (`adaMost`, `stuckForm`, `capBalance`, `notNow`) on COLLATERAL + FEE_ROOM alone, never on the reserve. **The figures** (firstBox, mixCosts, MixMoves) count the reserve (`tail`) only where the chosen count leaves room for it too, as the worker then builds it. **Where it doesn't** (`tailShort`) and nothing else stops the mix, one line under the stepper: "At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back." A warning, never a refusal. |
| R3-8 | fixed | **`orWithoutReserve`** also builds without the reserve where the build with it hits one transaction's computation (core's TooMany, sessions.ts's `TOO_MANY`) or size (core's TooLarge, both sentences, new `TOO_LARGE`), through one `roomless(e)`. mixFunding's Bootstrap catch is untouched: a Bootstrap asks no reserve, so its `sess.bootstrapTooMany` goes as it did (a guard test pins it). The doc says "too little ADA, or more of its UTxOs than one transaction spends or holds". |
| R3-14 | fixed (TypeScript half) | **The form counts the chain's own pick** (`publicPick`, mirroring `chain_from_account_at`): the fewest UTxOs holding the pool's token that hold the boxes' worth, the most first, their ADA counted, less the least ADA of the output that gives back their tokens beyond that (`accountLeast`, core's `minimum_address_payment` at 4,310 lovelace a byte); then every UTxO of ADA alone. **The stepper's cap goes count by count** (`publicBoxesAffordable`), since the pick changes with the count, and stops below the first count it can't pay. **The held figure** (`publicSideOf`) is the pick's at the stepper's count; the Bootstrap form's at its own count. **The builder taking more token UTxOs before refusing is Rust:** owner's call, not made. |
| R3-4 | fixed | **`refuseParts`** (new): the parts-reservation check, moved out of `sendChain` into one helper. `sendChain` calls it where its inline block was. `sendBack`'s direct branch now calls it too, before `sendRecorded`, so nothing is recorded or sent. Same words (`worker.spend.partsConflict.return`), no new key. It covers Bring it back and Bring everything back (`claimSubmit` lists it under `failed`). The runner's own `bringBack` builds fresh, so `fundingChange` already leaves the reservation out there. |

### Why "mixed only if enough is left", not "isn't mixed" (R3-7)

The lead's line said "at this many, its collateral isn't mixed". The R3-7 skeptic warned that says too much, and the code agrees:
- `buildBack`'s `intoPool` doesn't depend on the reserve (sessions.ts, the `intoPool` block).
- WebAssembly's `with_return` still tries `CollateralTail::build(...)` on the chain's change, and falls back to the plain return only where that fails (wasm/src/lovejoin.rs, `with_return`).

A deeper mix's unused fee estimates can leave enough. So the line hedges, in the skeptic's words, kept to one short sentence.

## Tests, fail-before, and mutation checks

**How they ran:**
- **Fail-before** is today's behaviour, logged in the scratchpad (`fx-reserve-2-*-failbefore.log`).
  - R3-7 and R3-14 went through `mixOffer`, first added with today's rule exactly (cap with the tail, tail always the asked one, `account` and the count ignored), and PoolPage wired to it. So each failure was on behaviour, not on a missing export.
- **Every mutation** was made with Edit, run, and put back with Edit. The logs are `fx-reserve-2-*-mutation.log`.
- **Afterwards** a grep of every touched file found no mutation left.

**R3-4**, `tests/parts-send-review-fixes.test.ts` › "a return that comes back directly, checked against a payment's parts at Send (1.6.0's review of the fixes, R3-4)":

| test | fail-before | mutation → failure |
|---|---|---|
| "refuses Bring it back's, sending and recording none of it, where it merges into what a waiting part spends; reviewed again it goes, then the payment's rest" | `promise resolved "{ kind: 'session-back', …(4) }" instead of rejecting` | sendBack's `refuseParts` call removed → same |
| "lists Bring everything back's as not sent, in the same words, sending and recording none of it" | `expected { sent: [ { index: +0, …(1) } ], …(1) } to deeply equal { sent: [], failed: [ { …(2) } ] }` | same → same |

- **The shared helper on the chain's side:** with sendChain's call removed, w-left's chain test fails with `expected [Function] to throw error including 'That return spends a UTxO that a paym…' but got 'Lovejoin\'s pool changed while the wa…'`.
- **What the direct test also checks:** the return was reviewed before the payment's Send, merged into F (one transaction, no chain), and F was reserved by the Send. After the refusal, the session's record holds no return. Reviewed again, it leaves F out and goes, and part 2 goes once part 1 lands.

**R3-8**, `tests/collateral-reserve-review-fixes.test.ts` › "1.6.0's review of the fixes, R3-8: a funding of one transaction the reserve alone takes past what one spends":

| test | fail-before | mutation → failure |
|---|---|---|
| "tops a site's session up without its direct reserve, as with too little ADA for it, where the reserve takes more UTxOs than one transaction spends" (40 private UTxOs of 1.5 ₳, a 24 ₳ top-up, real WebAssembly) | `Error: Spending 23 UTxOs at once needs more computation than a transaction may use` | `\|\| roomless(e)` removed → same |
| "goes without it too where the funding with it is past one transaction's size, core's words read as core writes them" (`buildWithdraw` stubbed to throw both TooLarge sentences, copied from build.rs, only for the funding that carries the reserve) | `Error: This transaction would be 16590 bytes, over the network's limit of 16384. …` | `TOO_LARGE` out of `roomless` → same |
| "still says a Bootstrap past one transaction's UTxOs in its own words: it pays no reserve to go without" | a guard: passes before and after | — |

- `runner()` in that file gained an optional third parameter, WebAssembly overrides, for the stub.

**R3-7**, `tests/lovejoin-form-review-fixes.test.ts`:

| test | fail-before | mutation → failure |
|---|---|---|
| "the Mix form never caps or refuses on its collateral's reserve, …(R3-7)" › "offers the box the balance pays without the reserve, counting none in its figures and saying so; the reserve where it fits" | `expected { tokenMost: 10, adaMost: +0, …(4) } to match object { adaMost: 1, most: 1, tail: 0n, …(1) }` | cap counting the reserve → same<br>figures always counting it → `…adaMost: 1… to match… tail: 0n` |
| same › "stops the stepper where the balance stops without the reserve, and counts it at each count that leaves room for it" | `expected { tokenMost: 10, adaMost: 1, …(4) } to match object { adaMost: 2, most: 2, tail: 0n, …(1) }` | both mutations → fail |
| same › "is the form as before where nothing is asked…" | a guard | — |
| same › "says so in one line under the stepper, which nothing else says where it's paid or not asked" (`CollateralIfLeft`) | new words | — |
| "the Mix form's count is one its funding builds…" › "funds the least balance the stepper offers a box at without the reserve, and the least its figures count it at with it, the form's total the review's at both (R3-7)" (real WebAssembly) | `expected { tokenMost: 10, adaMost: 1, …(4) } to match object { tail: 0n, tailShort: true }` | both mutations → same |

- **The real-WebAssembly test is sc-lj-1's, reworked as the skeptic asked:** it pins the figures, not the cap. It binary-searches two balances:
  - the least at which the stepper offers the box: `mixOutBuild` funds it without the reserve;
  - the least at which the figures count the reserve: it funds with it (CHAIN).
  - At both, the form's `leaving` is within 0.05 ₳ of the review's payments and fee.
- **sc-lj-1's 323-worker#0 unit test** keeps its assertions on `mixMost`'s arithmetic. Its title and comment now say the reserve decides the figures, never the cap.

**R3-14:**

| test | fail-before | mutation → failure |
|---|---|---|
| `lovejoin-form-review-fixes` › "the public Mix form's cap counts only the ADA its chain spends (321-lj-screens#1)" › "its ADA alone, …" (updated: the MIN pool, 1 box 25840610, 5 boxes 27000000) | `expected '27000000' to be '25840610'` | the give-back least left out → same |
| `lovejoin-form-review-fixes` › "the public Mix form's cap in a token pool counts what its chain picks, count by count (…R3-14)" › "takes the fewest UTxOs holding the token that hold the boxes' worth, the most first, less the least ADA of the output its rest goes back in" | `expected '34400000' to be '13240610'` | least left out → `expected '14400000' to be '13240610'`<br>every token UTxO taken → `expected '33240610' to be '13240610'` |
| same › "gives back the other tokens the UTxOs it picks hold too, in the same output" | `expected '14400000' to be '13257850'` | least left out → same |
| same › "stops the stepper below the first count the pick can't pay, at whatever count it stands" | `expected { tokenMost: 3, adaMost: 4, …(4) } to match object { adaMost: 1, most: 1 }` | count-by-count cap off → `…adaMost: 4… to match… adaMost: 1, most: 1`<br>every token UTxO taken → `…adaMost: 3…` |
| `tests/lovejoin-public-cap-review-fixes.test.ts` (new) › "the public Mix form in a token pool offers what the chain's pick pays for (…R3-14)" › "offers two boxes where A's ADA pays the chain's pick of two exactly, the most building and one more refused; one lovelace less, one" (real WebAssembly, PR #163's LJTEST pool) | `expected 3 to be 2` (the form offered three, which the build refuses) | least left out → `expected 2 to be 1`<br>every token UTxO taken → `expected 3 to be 2` |

**What the real R3-14 test checks:**
- A holds three boxes' worth of LJTEST; B holds half a box's worth beside 20 ₳, which a pick of three or fewer never takes.
- A's ADA is set where the pick pays two boxes exactly. The least ADA of Q given back is worked out in the test from core's output size: 276 bytes at 4,310 lovelace.
- **At that ADA:** the form offers 2; `publicBuild` of 2 builds; of 3 is refused.
- **One lovelace less:** the form offers 1; of 2 is refused; of 1 builds.
- So the TypeScript least matches core's to the lovelace, and the pick matches the build at its boundary.

## Files touched

- **Worker:** `extension/src/background/sessions.ts`:
  - `TOO_LARGE` and `roomless` (new, beside `TOO_MANY`);
  - `orWithoutReserve` and its doc;
  - `refuseParts` (new, before `sendChain`);
  - `sendBack`'s direct branch;
  - `sendChain`'s inline check replaced by the helper.
- **Screen:** `extension/src/ui/screens/Lovejoin.tsx`:
  - `mixMost`: its `account` parameter and doc;
  - `mixOffer` (new);
  - `LEAST_PER_BYTE`, `headSize`, `accountLeast`, `publicPick` and `publicBoxesAffordable` (new);
  - `publicMixAda` and `publicSideOf`: the count;
  - `CollateralIfLeft` (new);
  - PoolPage: `mixOffer` in place of `tailReserveOf` + `mixMost`, the line under the cap note, and the Bootstrap form's `bootstrapSide`;
  - the unused `TokenRef` import dropped.
- **Strings:**
  - `extension/src/i18n/translations/{en,es,ja}.json`: one key added;
  - `docs/i18n/{es,ja}-provenance.json`: it, `machine`.
- **Tests:**
  - `tests/parts-send-review-fixes.test.ts`: one describe, 2 tests;
  - `tests/collateral-reserve-review-fixes.test.ts`: `runner()`'s optional overrides, and one describe with 3 tests;
  - `tests/lovejoin-form-review-fixes.test.ts`:
    - imports;
    - sc-lj-1's two tests reworded or reworked;
    - the MIN expectation updated;
    - two describes with 4 and 3 tests;
  - `tests/lovejoin-public-cap-review-fixes.test.ts`: new, 1 test.

## Keys

- **Critical key added:** `lovejoin.mix.privacy.collateralIfLeft`.
  - en: "At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back."
  - es: "Con tantas cajas, su colateral de 5 ₳ solo se mezcla si queda lo suficiente cuando vuelve."
  - ja: "この数では、5 ₳ のコラテラルは、戻るときに十分残っている場合にだけミックスされます。"
  - `node scripts/i18n-critical.mjs` (print only) lists it. It needs the lead's `--write` and round 4's blind back-translation.
- **No other key added or changed.** R3-4 reuses `worker.spend.partsConflict.return` unchanged.
- **No test or e2e read old words** that changed: nothing shown changed its words.

## Docs to update

1. **flows.md, the Mix form, private side** (with L6's flows.md:512):
   - The stepper and Review never count the collateral's 1.5 ₳ reserve. A count the balance pays without it goes, funded without it.
   - The figures (Into a one-time account, the reserve's row, Total leaving, the collateral's mix cost) count it only where that many boxes leave room for it too.
   - Where they don't, one line under the stepper: "At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back."
2. **flows.md, the Mix form, public side in a token pool:**
   - The held figure and the stepper count the UTxOs the chain picks for that many boxes: the fewest holding the pool's token that hold the boxes' worth, the most first, less the least ADA of the output that gives back their tokens beyond that, then every UTxO of ADA alone.
   - The stepper stops below the first count that pick can't pay.
   - The Bootstrap form's held figure is at its own count.
3. **architecture.md, the collateral's mix reserve** (`orWithoutReserve`): a funding goes without the reserve on too little ADA, or more of the private balance's UTxOs than one transaction spends or holds (core's TooMany and TooLarge). That reaches a top-up and Mix my boxes again, which are one transaction.
4. **architecture.md / flows.md, payments in parts:** a session's return reviewed before a payment's Send is refused at its Send where it spends what a waiting part spends, coming back directly as much as a chain, Bring it back and Bring everything back alike. A new review leaves that UTxO out.
5. **The owner's list of calls:**
   - sc-lj-1's call 2 ("It's not a refusal: Review and the worker's fallback are unchanged") is now true: the form never refuses on the reserve, and says so in a line instead.
   - Its call 3's "where the funding refused it at Review" no longer applies.
6. **The privacy policy: no change.** Nothing new leaves the device; the form reads only what the page holds.

## Calls the owner might overturn

1. **R3-7's words hedge:** "mixed only if enough is left when it comes back", not the lead's "isn't mixed", which the code shows is sometimes false (above). The line is a `.privacy.` key, so critical.
2. **R3-7's band:** where the balance pays the reserve but the form's FEE_ROOM (2 ₳) says it doesn't, the figures leave the reserve out and the line shows, though the review then counts it. That band is about 0.3 ₳ wide. The review is right; the form is conservative, by FEE_ROOM's own design.
3. **The Mix reviews say nothing new** for a mix funded without the reserve where a 5 ₳ pool takes its collateral. Session 10's call 2 kept their notes ("…comes back with the 5 ₳ kept aside"), and their giveme.my note stays on the reserve.
   - fx-reserve-1 offered `collateralPool` on mixFunding's summary and the same line on the review. Not done, since it reopens that call.
   - Mixes that go without the reserve are more often offered now that the form doesn't refuse them.
4. **R3-14's Rust half, not made:** `chain_from_account_at` taking more UTxOs holding the token before refusing, where ADA alone doesn't cover `needed`. It would:
   - make the pick monotone, so the stepper could offer a count above a gap (today, where one and three pay and two doesn't, it stops at one);
   - take a refusal the chain wouldn't make out of the build.
   - It's token pools only, so the classic pool stays byte-identical. A rebuild follows.
5. **R3-14 prices the give-back output at 4,310 lovelace a byte** (`LEAST_PER_BYTE`), as FEE_ROOM's comment prices today's least. A dearer byte would let the stepper offer at most one count the build refuses honestly, until the constant moves. The alternatives are a parameters read (a request) or WebAssembly (Rust).
6. **R3-14's ties:** between UTxOs holding as much of the token, the form picks the one with less ADA first, where the build takes Koios's order. The form may offer a box fewer than the build takes, never more on that account.
7. **R3-14's held figure follows the count** in a token pool, on both forms. The cantAfford line's figure is then one box's.
8. **R3-8's TooLarge half:** the reserve adds ADA, not tokens, so only more inputs can take a funding past 16 KiB with it. It's matched as the lead asked, on core's two TooLarge sentences, not on "over the network's limit", which two other refusals share.
9. **Left as they were:**
   - Settings' collateral switch is greyed with returns off, while a mix still pays the reserve. That's R3-7's context, it predates this round, and it's Settings'.
   - A top-up still too many UTxOs without the reserve says core's raw words. Mapping them through short.ts's `tooMany()` is older and separate.

## Notes for other fixers and the lead

- **No test needs the pkg rebuilt.**
- **For fx-tests (R3-20's class): the wiring unit tests don't reach**, since PoolPage isn't rendered:
  - PoolPage calls `mixOffer(source, side, token, funding, box, roomMost, boxes, tailReserveOf(funding, source, pools), mixable ? accountUtxos : undefined)`;
  - `<CollateralIfLeft shown={tailShort && !notNow} />` sits under the cap note;
  - `publicSideOf(cardano, accountUtxos, token, boxes)` gives the Mix form's side, and the Bootstrap form's `HeldOnSide` takes `bootstrapSide`, at `putting`.
- **A visual check for the lead,** on preprod, the 5 ₳ pool holding two strangers' boxes:
  - with the private balance between a box's funding + 7 ₳ and + 8.5 ₳, the stepper offers the box, the line shows under it, and the rows have no reserve row;
  - from + 8.5 ₳, the reserve row shows and the line doesn't.
- **e2e:** no expectation changed. Its Mix steps use the classic pool with no 5 ₳ pool boxes in its fakes, so nothing it reads moved.
- **The 1.5.0 gate,** `tests/lovejoin-1-5-0.test.ts`, passes unedited on both builds (in the wide sets below).
- **Shared files:**
  - `sessions.ts` changed under me once (the Edit tool said so); my edits are anchored.
  - The locale and provenance edits are single inserted lines.
- **Untracked:** my new test file. `tests/spent-clock-review-fixes.test.ts` is another fixer's.

## Checks

- **`npm run typecheck`:** clean, run last. An earlier run showed only another lane's mid-edit `run-traps-review-fixes.test.ts`.
- **My files, default build:** `parts-send-review-fixes` (R3-4 and 321-parts-worker#3, 5 of 5), `collateral-reserve-review-fixes` (17 of 17), `lovejoin-form-review-fixes`, `lovejoin-public-cap-review-fixes`, `screens-nits-review-fixes`, `lovejoin-held-balance` and `words` (39 of 39).
- **The wider set, default build:** every test file importing `screens/Lovejoin` or `background/sessions`, plus the chain-, collateral-, dapp-, i18n-, parts-, return-, session- and site- files, `lovejoin-1-5-0`, `privacy-notes` and `words`. 107 files: 1484 passed and 3 failed.
  - The 3 are `i18n.test.ts`'s critical-set checks.
  - The derived list differs from the checked-in one by my `lovejoin.mix.privacy.collateralIfLeft`, and by other lanes' `collateral.warn.bothLand` and the `lovejoin.stuck.privacy.privateAccounts` → `privateNamed` rename.
  - The es and ja checks are L5's drafts, mine among them.
- **The same set on preprod** (`VITE_ENABLE_MAINNET=false`), without the i18n files: 99 files, 1324 of 1324.
- **`node scripts/i18n-critical.mjs`** (print only, never `--write`): lists my key.
- **Mutations:** as in the tables, each put back with Edit. A grep of every touched file finds no mutation left.
- **Scratch files** are `fx-reserve-2-*` in the scratchpad:
  - the fail-before and mutation logs;
  - the wide runs' logs and the file list;
  - the critical-set print;
  - the token pool's view.
