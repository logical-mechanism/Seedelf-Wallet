# 1.8.0's release review, round two: verifier lows-b

Five findings, each traced once: W5 (words#6), W8 (screens#4), W9 (screens#5), W3 (words#5 with screens#14) and W4 (screens#1 with words#7).

**Sandbox:** `SB=/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/pr363`, at `a6c94743`. Every command runs from `$SB/seedelf-platform/seedelf-web-wallet/extension`.

**Scratch files**, all in its `tests/`:
- Copies of the finders' files, under new names: `lows-b-from-screens-words`, `lows-b-from-screens-worker`, `lows-b-from-words-{wayback,detail,stuck,saved}.test.ts`.
- My own: `lows-b-scratch-worker.test.ts` and `lows-b-scratch-page.test.ts`. They use the real WebAssembly, with records shaped as 1.7.2 wrote them.

Each mutation below was restored with `cp` from a saved original. `git status` shows only the untracked `lows-b` files.

**Verdicts:** all five are confirmed and all five are low. Three are much narrower than their reports say:
- **W8 and W9** last only from the first unlock until that unlock's run sends its withdraws, a single run in my test.
- **W4's lasting state** needs a retired token pool whose boxes can't pay their way back, and a private balance with no UTxO of ADA alone that pays. Otherwise the first unlock's run brings the box back, paid.
- **W3's saved reason** reaches one frame of the five the brief lists.

**None of the five needs a new critical key.** W8 and W9 are rendering conditions. W5, W3 and W4 change existing critical values, and W6's back-translation round is already owed for most of them (the summary at the end gives the cost).

---

## W5 (words#6): "the 5 ₳" (the collateral) reads as the 5 ₳ boxes

- **Verdict:** CONFIRMED · **Severity:** low · **Introduced:** new (`50cd76b4`'s sweep from 10 ₳ to 5 ₳)
- **Reachable:** on every site's private-session funding review while Settings' Lovejoin is on, which is the default.

**Why.** `FundingWayBack` (`DappApprovals.tsx:452-492`, rendered only at `:771`) puts one of two notes under the way-back rows:
- `dappUi.back.privacy.noteLovejoin`: "…back in 5 ₳ boxes hours later. The rest and the 5 ₳ come back at once."
- `noteLovejoinMixed`: "…mixes the spare ADA in 5 ₳ boxes, and the 5 ₳ once, in a box of its own…"

The 5 ₳ meant is the collateral, which the funding review's row "Kept aside for contracts: 5 ₳, comes back" names further up (`:756`). At `c15603d5` the boxes were "10 ₳ boxes", so "the 5 ₳" could only be that row's. Now its nearest antecedent is "5 ₳ boxes". That reading contradicts the sentence before it ("hours later" against "at once"), and in the mixed note it turns into "the boxes are mixed once".

The words are ambiguous, not false, so this is not medium. es ("El resto y los 5 ₳ vuelven…") and ja ("残りと 5 ₳ は…") have the same collision. A scan of every en value finds only these two keys pairing "a 5 ₳ box" with "the 5 ₳". `dappUi.private.privacy.staysLovejoin` doesn't.

**Evidence.**
- `npx vitest run tests/lows-b-from-words-wayback.test.ts --maxWorkers=2 --silent=false`: 1 passed. It prints `WAY BACK (en): … back in 5 ₳ boxes hours later. The rest and the 5 ₳ come back at once. …`, and the same collision in es, ja and the mixed variant.
- `git show c15603d5:…/en.json` shows "back in 10 ₳ boxes hours later. The rest and the 5 ₳ come back at once."

**Fix (judged).** Say "the 5 ₳ kept aside", as `dappUi.back.noteDirect` already does: es "los 5 ₳ apartados", ja "確保分の 5 ₳".
- **Translation cost:** no new key, but two critical values change in en, es and ja. W6 already owes a blind back-translation of exactly these two keys' es and ja values (10 → 5, never re-checked). Make this edit **before** that round and it costs nothing extra; after it, it costs a second round.
- **Length:** UI text stays one line, 11 characters longer.
- **Mutation:** the six edits (`lows-b-{en,es,ja}.json.orig` saved) were run against `tests/approvals-review-fixes.test.ts tests/screens-wiring-review-fixes.test.ts tests/dapp-prompt.test.ts tests/i18n.test.ts tests/i18n-critical-helpers.test.ts tests/i18n-screens.test.ts tests/i18n-values-in-place.test.ts tests/i18n-review-fixes.test.ts tests/i18n-assembly.test.ts tests/i18n-joins.test.ts tests/words.test.ts`: 3 failed, 234 passed. Every i18n guard passes with both critical values changed (W6's blind spot again).
- **The pins to update:** the three failures are literal pins in `approvals-review-fixes.test.ts`, at `:161`, `:325`/`:331` (`MIXED_ONCE`) and `:569`. Its negative guards `not.toContain("the 5 ₳ come back at once")` (`:160`, `:336`, `:570`) must move to the new phrase too, or they pass vacuously.

---

## W8 (screens#4): a 1.7 chain stopped partway in a retired pool says "Mix my boxes again mixes the boxes it didn't"

- **Verdict:** CONFIRMED · **Severity:** low (misleading words outside the critical set, briefly) · **Introduced:** reachable (old words, a 1.7 record, 1.8.0's refusal)
- **Reachable:** for seconds. The window opens at the first unlock on 1.8.0 and closes when that unlock's run sends the chain's boxes back. It lasts longer only while the retired pools' run can't send them:
  - the run stops by itself (Koios failing);
  - the user presses Stop;
  - many boxes spread the run over several runs;
  - R2's case, a 1.7 chain the update cut whose collateral's tail sits in a retired pool. The run then waits up to a day. That comes from R2's report; I didn't re-run it.

**Why.**
- **What lists it.** `status().chains` is `rows(schedule)` (`lovejoin.ts:6195`). Its rule, `shown` (`:2061`), lists a stopped chain until a read finds none of its unmixed boxes left (`c.left`, `:5588`). Home counts the same chains (`held().stopped`, `:6303`): "a mix stopped partway: open Lovejoin to see what to do."
- **Why its sentence is false there.** `Chains` (`Lovejoin.tsx:968`) always says `lovejoin.chains.whyStopped`, and `LovejoinChainView` names no pool. Both ways of mixing again are refused in a retired pool.
- **Why the window is short.** The first unlock's run (`withdrawDueNow` → `retireOnce` → `bringAllBackNow`) sends every box at once. The next read holds their inputs as spent, so `c.left` is 0 and the row goes before the withdraws land. The finder said "minutes, until the run brings the boxes back".

**Evidence.**
- **The finder's record** puts the box at the chain's mix leaf with "sent 1 of 2", which is impossible because that mix was never sent. It lists the chain anyway, because `found` stays unset.
- **My record** is consistent. In `lows-b-scratch-worker.test.ts` ("W8/W9"), a public mix from account 1 into the classic pool was cut after its deposit, both boxes at the deposit's outputs, and recorded as 1.7.2 did: no `pool` on the leaves, no `pools`.
- `npx vitest run tests/lows-b-scratch-worker.test.ts -t "W8" --maxWorkers=2 --silent=false`: 1 passed. It prints:
  - `CHAINS: [{"boxes":2,"total":3,"sent":1,…,"stopped":"The wallet locked, or the browser closed, while its chain was being sent."}]`, `HOME HELD: {"stopped":1}`
  - `CHAIN ROW: … Why it stopped: The wallet locked, or the browser closed, while its chain was being sent. Mix my boxes again mixes the boxes it didn't.`
  - account 2's Mix again from my public account refused with the retired reason, and `againBoxes` rejected the same way;
  - `FIRST RUN SENT: 2`, then `HOME HELD RIGHT AFTER THE RUN (no read yet): {"stopped":1}` (stale), then `STATUS AFTER THE RUN, NOT LANDED: {"chains":0,…}`, then `HOME HELD AFTER THAT READ: {"stopped":0}`.

**Fix (judged).** No new key. `LovejoinChainView` gets `retired: true` where every pool the chain put boxes in (`poolsOf(c)`) is retired, by `retiredIds` or by R3's corrected rule once that lands. `Chains` then renders the existing, non-critical `lovejoin.detail.whyStopped` ("Why it stopped: {{why}}."), which is in es and ja already.

The mutation (saved originals: `lows-b-lovejoin.ts.orig`, `lows-b-rpc.ts.orig`, `lows-b-Lovejoin.tsx.orig`):
- **Typecheck:** `npx tsc --noEmit -p .` is clean outside the scratch files.
- **The real path:** the row now reads `Why it stopped: The wallet locked, or the browser closed, while its chain was being sent.` and nothing more. My W8 test's assertion of the old sentence fails, as it should.
- **Tests:** `npx vitest run tests/lovejoin-1-5-0.test.ts tests/lovejoin-stopped-shown.test.ts tests/lovejoin-retired.test.ts tests/screens.test.ts tests/chain-record.test.ts tests/lovejoin-restore.test.ts tests/lovejoin-hub.test.ts tests/settings.test.ts tests/lovejoin-release-rules.test.ts tests/lovejoin-crediting-review-fixes.test.ts tests/lovejoin-pools.test.ts --maxWorkers=2`. Only `lovejoin-1-5-0.test.ts:914` and `:929` fail, because their exact `toEqual`s gain `"retired": true`: a test update.

**Leave Home's count alone.** Leaving retired chains out of `held().stopped` too fails 8 more tests that pin 1.7's behaviour on classic chains (`lovejoin-stopped-shown` 7, `chain-record` 1). The flag also clears itself at the first read after the run.

---

## W9 (screens#5): a retired pool's page sends the user to another account "to mix them again"

- **Verdict:** CONFIRMED · **Severity:** low (misleading words outside the critical set, briefly; at the nit border) · **Introduced:** reachable
- **Reachable:** the same window as W8: from the first unlock until its run's sends. It also comes back when a second device still on 1.7.2 mixes into a retired pool from another account.

**Why.**
- **The worker** computes `otherAccounts` for every pool's view, retired ones too (`lovejoin.ts:5971-5993`).
- **The page.** `AgainActions` renders `<OtherAccounts accounts={otherAccounts} />` (`Lovejoin.tsx:1590`) whatever `againRefused(pool)` says: "Some of your boxes came from a mix from Public account 2. Switch to it on the Public tab to mix them again."
- **Account 2.** On that account, `publicAgainBuild` is refused with the retired reason.
- **The rest of the block** is right: Pay from my private balance anyway is off (`disabled={… || !!unusable}`), and the retired reason is under it.

**Evidence.** In the same W8/W9 test, the real status prints `CLASSIC VIEW: {"unusable":{"why":"retired"},"boxes":2,"notMixed":0,"otherAccounts":["d1d1d1@1","d1d1d1@1"]}`. Rendered, it gives:
- `AGAIN ACTIONS: Some of your boxes came from a mix from Public account 2. Switch to it on the Public tab to mix them again. This pool runs Lovejoin's retired scripts: … Bring one back now Pay from my private balance anyway`
- `ACCOUNT 2, MIX AGAIN FROM MY PUBLIC ACCOUNT: This pool runs Lovejoin's retired scripts: …`

**Fix (judged).** The proposed fix is right and needs no key: `{!why && <OtherAccounts accounts={otherAccounts} />}`. It also covers a pool below the network's minimum, where the advice is just as wrong.
- **Mutation:** `npx vitest run tests/lovejoin-accounts-page.test.ts tests/lovejoin-session5-screens.test.ts tests/screens-wiring-review-fixes.test.ts tests/lovejoin-merged-screens.test.ts tests/lovejoin-screens-review.test.ts tests/lovejoin-held-balance.test.ts tests/lovejoin-accounts-review-fixes.test.ts --maxWorkers=2`: 7 files, 139 passed.
- **The finding's case:** with `-t "account"` over those files plus `lows-b-from-screens-words.test.ts`, 39 passed. That includes the screens finder's case, which fails at `a6c94743`.

---

## W3 (words#5 with screens#14): the retired reason saved as a 1.7 mix session's reason

- **Verdict:** CONFIRMED, in one frame of the five listed · **Severity:** low · **Introduced:** new
- **Reachable:** rarely. It needs a 1.7 mix session (a mix, a Mix again or a Bootstrap) funded but not yet chained when the extension updated. For example, the wallet locked before the funding landed, and the chain waited for an unlock that came on 1.8.0.

**Why.** For a mix session, `buildBack` passes `record.mix.pool ?? CLASSIC` into `chain()` (`sessions.ts:4497`). There `takesNewBoxes` throws `unusableReason("retired")`, and `chain()` turns it into `LovejoinSkipped(e.message)` (`lovejoin.ts:3523-3529`). `leftOut` keeps `e.reason`, which `buildBack` saves on `mix.skipped` (`sessions.ts:4513-4516`). The brief's frames, each checked:
- **`lj.leftOut` via `detailOf`** (`Lovejoin.tsx:909`) on Your mixes' card: **reachable, and the only frame.**
- **`lovejoin.warn.skippedIts`** (the session's page, `s.lovejoinSkipped`): **unreachable.** A mix never saves `lovejoinSkipped` (`sessions.ts:4839`, `:4957`: `if (skipped && !s.mix)`).
- **`lovejoin.warn.skippedThis`** (a return's review): **unreachable.** The runner sends a mix's return by itself (`step` → `bringBack`). No screen opens a mix session's return review:
  - Swaps lists `swapsOnly`, which drops mix sessions;
  - SiteSessions lists sites' sessions only;
  - the dApps page's found list is `recovered` sessions only.
- **`claim.warn.skippedItem`** (Bring everything back): **unreachable.** `claimBuildNow` (`sessions.ts:3178`) refuses any session with `auto` ("A mix comes back by itself."), and a 1.7.2 mix record has `auto` (`mixOutSubmit` at `6b70c1f8`).

**What the card says.** The card's label names the pool by its box ("2 boxes of 10 ₳"), so "This pool" isn't without a referent there. The misleading half is the second sentence: "Your boxes in it come back by themselves" sits beside "Came back without going into Lovejoin", about boxes that never went in. es and ja make it worse: "Tus cajas aquí vuelven solas" and "ここにあるあなたのボックス" both say "here", which on the card reads as the card's own boxes.

For a 1.7 Mix again the same reason is saved, and there it's apt: its boxes do sit in that pool and come back by themselves. Nothing in it is false, since retirement is for good. So low; nit is arguable.

**Evidence.**
- **The test.** `npx vitest run tests/lows-b-scratch-worker.test.ts -t "W3" --maxWorkers=2 --silent=false`: 2 passed. The record is shaped as 1.7.2's `mixOutSubmit` wrote it (`mix: {boxes: 2}`, plus `auto`). It prints:
  - `CLAIM: {"returns":[],"skipped":[{"index":0,"reason":"A mix comes back by itself."}]}`
  - `SUBMITTED BY THE RUNNER: 1`, from `sessions.advance`
  - `RECORD: {"mix":{"boxes":2,"skipped":"This pool runs Lovejoin's retired scripts: …"}}` with no `lovejoinSkipped`, and none on the view
  - `YOUR MIXES CARD (en): Your mixes 2 boxes of 10 ₳ Running Came back without going into Lovejoin Lovejoin was left out: This pool runs … Your boxes in it come back by themselves.`, and es and ja as quoted above
  - `AGAIN RECORD:` the same reason
- **Where the finders' scratch tests overreach:**
  - words' `words-scratch-saved` (second test) hands `LovejoinNote` and `LovejoinSkipped` the reason directly, two frames a mix session can't reach;
  - `lovejoin-retired.test.ts:233`'s record has no `auto`, unlike a real 1.7.2 record. That's fine for the saved reason it asserts, but under it Bring everything back would build the session;
  - screens' card test asserts `not.toContain("left out: This pool")`, which the card's label already gives a referent.

**Fix (judged).** The proposed `sess.skip.warn.poolRetired` ("its pool runs Lovejoin's retired scripts") reads true in the one frame and in both tenses. But it is a **new critical key**, so a blind back-translation in es and ja. No existing `sess.skip.warn.*` or `lj.skip.warn.*` key names retirement. The screen can't tell the saved text apart either: comparing translated text is out.

**Cheaper, shared with W4:** drop the retired reason's last sentence (see W4). That removes the misleading half, leaves "This pool" with the card's label as its referent, and adds no key. ja's first sentence keeps a "ここにあるボックス", which is milder.

Take the shared change for 1.8.0. Add the new key only if the round is being held anyway.

---

## W4 (screens#1 with words#7): a stuck retired token pool says its boxes come back by themselves

- **Verdict:** CONFIRMED · **Severity:** low (a false critical statement, in a far-edge state) · **Introduced:** new
- **Reachable:** briefly, at the first unlock, because that unlock's run brings the stuck box back paid from the private balance. The state lasts only when all three hold:
  - **a stuck retired token pool:** one whose boxes can't pay their way back, after a rise in the price of a byte. At today's 4310, preprod's 2 ₳ LJTEST pool pays its way, and mainnet's head start, in the sandbox and in the release prep's list, holds no token pool at all. A pool launched outside the wallet with too little ADA a box would also do;
  - **the wallet's box in it;**
  - **no UTxO of ADA alone in the private balance that pays.** The run then stops by itself, or the user stops it.

**Why.** `cantComeBack` exempts only the classic pool (`lovejoin.ts:2977`). A retired token pool's status therefore carries both `unusable: retired` and `cantComeBack`, and three places then contradict each other:
- the page's stuck callout (`lovejoin.stuck.warn.lead`): "…come back by themselves only if the fees drop enough";
- the retired reason, shown twice on the page (under Mix again and under Review): "Your boxes in it come back by themselves.";
- the hub row, which shows `lovejoin.pools.warn.stuck` next to the same reason.

The scheduled withdraw puts a stuck box off by `STUCK_WAIT_MS` (`:6426`), so it doesn't come back by itself. The finder's 12-hour test, though, starts from `retiredAlready`, so the first unlock's run, which pays a stuck box from the private balance (`:6908`, `:6929`: `paid: "private"`), never runs.

**Evidence.**
- **The finders' renders reproduce:** `npx vitest run tests/lows-b-from-screens-worker.test.ts -t "retired token pool whose boxes|chain stopped partway" --maxWorkers=2 --silent=false`, and the page renders (`STUCK RETIRED PAGE`).
- **The first unlock, mine.** `npx vitest run tests/lows-b-scratch-worker.test.ts -t "W4" --maxWorkers=2 --silent=false`: 2 passed. It runs the same pool at 4800, with no `retiredAlready`:
  - with two UTxOs of ADA alone in the private balance: `FIRST UNLOCK (private balance pays): {"sent":1,…,"bringing":{"back":1,"retired":true,"left":0}}`, inputs `a8a8a8#0` and `d1d1d1#0`. Back at once;
  - with none: the run stops by itself, `{"left":1,"stopped":"Your private balance has no UTxO of ADA alone that can pay for this box's way back. Make some ADA private, or bring it back from its pool's page, paid from your public account."}`, and the pool stays `{"unusable":{"why":"retired"},"stuck":true,"boxes":1}`;
  - `HUB ROW: … This pool's boxes can't pay their own way back now This pool runs Lovejoin's retired scripts: … Your boxes in it come back by themselves.`
- **The way out stays:** the callout's paid Bring one back, and Settings' stopped line with its reason and Try again.

**Fix (judged).** The proposed second key ("the retired reason without its last sentence") is a **new critical key**, a blind back-translation in es and ja. No rendering condition does it with existing keys: no key holds the retired sentence alone, and leaving the reason out would leave Mix's off buttons with no reason.

**Cheaper:** drop the last sentence from `lj.unusable.warn.retired` itself, in en, es and ja. It fixes the page and the row, removes W3's misleading half, and makes the line shorter. The sentence isn't the page's only word on coming back:
- `npx vitest run tests/lows-b-scratch-page.test.ts --maxWorkers=2 --silent=false`: 1 passed. A retired classic pool that isn't stuck gets its box scheduled (`due: 1`), and its page shows `Next one back 15 Jan 2027, 03:30`.

The mutation:
- `npx vitest run tests/i18n.test.ts tests/i18n-critical-helpers.test.ts tests/i18n-screens.test.ts tests/i18n-values-in-place.test.ts tests/i18n-review-fixes.test.ts tests/i18n-assembly.test.ts tests/i18n-joins.test.ts tests/i18n-worker-reasons.test.ts tests/words.test.ts tests/worker-words.test.ts tests/lovejoin-merged-screens.test.ts tests/screens-wiring-review-fixes.test.ts tests/lovejoin-session5-screens.test.ts tests/lovejoin-screens-review.test.ts tests/lovejoin-accounts-page.test.ts --maxWorkers=2`, plus the scratch renders: every existing test passes (16 files, 314 passed).
- The W4 scratch case now passes.

So the change needs no test update, but it does change one critical value. ja's is owed a fresh blind round anyway (W6: corrected after its first). es needs a fresh one too. Make the edit before W6's round.

---

## The fixes together, and what they cost in translation

| Finding | Fix | New key? | Critical values changed |
|---|---|---|---|
| W5 | "the 5 ₳ kept aside" in both notes | no | `dappUi.back.privacy.noteLovejoin`, `noteLovejoinMixed` (es and ja already owed by W6) |
| W8 | `retired` on `LovejoinChainView`; the row says `lovejoin.detail.whyStopped` | no | none (that key isn't critical) |
| W9 | `OtherAccounts` only where Mix again isn't refused | no | none |
| W3, W4 | drop "Your boxes in it come back by themselves." from `lj.unusable.warn.retired` | no | `lj.unusable.warn.retired` (ja already owed by W6; es new) |

Done before W6's blind round, the only back-translation these fixes add is es `lj.unusable.warn.retired`. The other values are in that round already. Each changed critical value then needs a 1.8.0 note in both verified files, since CI passes any value of a key it lists.
