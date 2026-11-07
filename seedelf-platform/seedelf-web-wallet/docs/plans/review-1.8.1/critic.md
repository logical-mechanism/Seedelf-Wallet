# 1.8.1's release review: critic (completeness)

Reviewer `critic`. Tree `web-wallet/release-1.8.1` at `2a8060d3`. I read all nine reports and `find-result.json`, then asked what none of them ran or read.

**In short:** there's no new defect in the wallet's code. The release prep's pool behaves on mainnet as the screens and the listing say. The gaps were somewhere else:

- **readers#4 is right, against two lenses' "checked".** worker and money took the match to catch the node's refusal. On both networks today (protocol 11.0) the ledger refuses a short withdrawal as `ConwayIncompleteWithdrawals`, and nothing in the wallet matches that.
- **That decides worker#1's and worker#3's reach,** and how their fixes have to land.
- **Two of the proposed fixes conflict:** worker#2's and readers#3's.
- **#368's docs say two things that aren't so** (critic#1, critic#2), and the release's own runbook still names 1.8.0 (critic#3).
- **giveme.my never reads a withdrawal,** which closes the question readers left open.

No repro sat in the tree. My scratch work is in `SCRATCH/review/critic/`:

- `koios/`: three reads;
- `ledger/`: cardano-ledger's Conway rules, from GitHub;
- `typecheck.log`.

## Verdicts on findings I re-judged

### readers#4 · confirmed · medium

I checked it independently:

- **Both networks are at protocol 11.0.** Koios `epoch_params` gives `[{"epoch_no":666,"protocol_major":11,"protocol_minor":0}]` on mainnet and `[{"epoch_no":324,"protocol_major":11,"protocol_minor":0}]` on preprod.
- **The ledger's LEDGER rule refuses a short withdrawal.** In cardano-ledger `master` (`Conway/Rules/Ledger.hs`, last changed `fcdc98cd77`, 2026-11-06), line 406 runs `Shelley.testIncompleteAndMissingWithdrawals …`. It refuses with `ConwayIncompleteWithdrawals` (`:131`) or `ConwayWithdrawalsMissingAccounts` (`:130`).
- **`Certs.hs` no longer names `WithdrawalsNotInRewards` anywhere.**
- **The wallet looks only for the old name.** `koios.ts`'s `stakingRefusal` matches only `text.includes("WithdrawalsNotInRewards")` for this case, and so does `:1233`'s `RewardsChangedError` test. A Lovejoin refusal for a moved balance is therefore a plain `KoiosError` in the raw JSON. `withdrawOne`'s rebuild-once never runs.
- **worker's "checked" (`RewardsChangedError`, the match) and money's (*Checked, and it held*: "`RewardsChangedError` is raised only on `WithdrawalsNotInRewards`…") take PV10's name for the live one.**
- **The fix is readers', in one lane with worker#1's and worker#3's** (below). The test that must fail without it: koios.test.ts given the PV11 body is a `RewardsChangedError`, and `lovejoin-reward-balance.test.ts`'s `NOT_IN_REWARDS` cases run with both names.

### worker#1 · narrower · low

- **Its failure can't happen on the live networks today.** No node at PV11 says `WithdrawalsNotInRewards`, so `pumpPublicNow` and sessions' `pump` get a plain `KoiosError`.
  - `sending.stopped` and Send's rejection both carry the raw refusal (readers#4's text), never staking's words.
  - `lovejoin.ts:5411`: `throw unsure !== undefined ? new Error(sending.stopped) : e;`.
  - `sessions.ts:5309`: `const why = e instanceof RewardsChangedError ? REWARDS_MOVED() : e instanceof Error ? e.message : String(e);`, then `:5319` `throw e;`.
- **readers#4's fix makes it reachable.** Once `IncompleteWithdrawals` raises `RewardsChangedError(staking words)`, these rethrows show staking's words in all four of worker#1's places: Send, `backSubmit`, `claimSubmit` and the runner.
- **Fix:** worker#1's own, in the same change as readers#4's matcher, never after it. The test that must fail without it: `publicSubmit` rejects with `REWARDS_MOVED()` given the PV11 body.

### worker#3 · confirmed · low (its fix depends on readers#4)

- **The two-hour hold happens on the live networks as described.** `settleWithdrawing` drops every refusal (`lovejoin.ts:7836`, `await koios.submitTx(bytes).catch(() => undefined);`), so the PV11 refusal is ignored like any other.
- **The proposed fix never fires as things stand.** It keys on `RewardsChangedError`, which nothing raises until readers#4's matcher lands.
- **Its safety premise still holds.** A copy in a block or a mempool is refused as spent first: `BadInputsUTxO` is still Conway's UTXO name (`Conway/Rules/Utxo.hs:82`), and koios.ts tests it before `stakingRefusal` (`:1227`).
- **Fix:** worker#3's, after readers#4's matcher, or keyed on the refusal's own text. The test that must fail without it: worker#3's repro shape, with the PV11 body.

### worker#2 · confirmed · low (its fix conflicts with readers#3's)

- **The mechanism is in the code.** `reservationOf(txs)` (`spent.ts`) sums every transaction's withdrawals, a tail's mix included, into `takes`. `readRewards` counts every reservation being sent (`lovejoin.ts:4642`, `r.until === undefined`).
- **The conflict.** worker#2's smallest fix leaves tail mixes out of `takes`. readers#3's smallest fix has `claimBuildNow` hand each built return's `reservationOf(chain.txs).takes` to the next builds. readers#3's own repro has session 0's take *in its tail mix* ("Session 0's tail mix and session 1's first mix both withdraw `500000000`").
  - If the exclusion goes into `reservationOf` itself, readers#3's hand-off passes nothing on. Session 1's first mix then takes the balance again, and Send refuses it again.
- **Fix:** one lane for both, with readers#2's, which changes `takingFrom` too.
  - Put the tail exclusion in `takingFrom`'s reading of a sent chain, where it matters while the tail waits for giveme.my. Or have `claimBuildNow` hand on each chain's own reads (`balances`), never the reservation's `takes`.
  - **The tests that must still pass:** readers#3's repro and worker#2's repro 2. **Re-run with them:** mutants#5's five `takingFrom` / `balanceAfter` tests (T3a, T3c, T3d, T4c, T7d). T4c's pins today's figure.

### readers#3 · confirmed · low (see worker#2)

- **The mechanism is in the code.** `readRewards` counts only reservations being sent (`lovejoin.ts:4642`), and `claimBuildNow` keeps each return for Send with an `until`. So every return in one review reads the same N.
- **The fix:** readers#3's, reconciled with worker#2's as above.

## New findings

### critic#1 · low · 368 · `seedelf-verification/README.md:7`: "`Audit/` is a review of every proof here" isn't true since #368

- **What's wrong.** README.md:7 ends: "`Audit/` is a review of every proof here ([its README](Audit/README.md))."
  - Audit/README.md:3 dates the audit: "A review of the proofs in `Seedelf/` and `Lovejoin/` (2026-11-03)".
  - #368 added the 25 `Lovejoin/Every/` modules after that. They're the modules behind CLAIMS.md's mix_logic and one_shot_mint rows.
  - `git grep 'Lovejoin.Every\|Lovejoin/Every' -- Audit` finds nothing. No audit family, check, `count.py` input or `audit-refresh` step names an Every module. Only `check.sh:146–152` does.
- **The failure.** A reader of the README takes chunk 45's theorems to have gone through the audit's controls (mutant scripts, dropped hypotheses, vacuity, `count.py`), and they haven't.
  - The risk is small. They're kernel-checked iffs, where the audit's chief worries (a vacuous or Undetermined Blaster ✅) don't arise, and this review's fidelity lens read them against the source.
  - By the letter of the scale ("a README that overstates what's done"), this reads as medium.
- **Fix** (wording, no test): README.md:7, "`Audit/` is a review of every proof here up to 2026-11-05 (its README); chunk 45's `Lovejoin/Every/`, kernel-checked, came after it." Or run the audit's controls over Every in the next full run, and say so.

### critic#2 · low · 368 · `seedelf-verification/CLAIMS.md:21–28`: *Where it stops* never says that Seedelf's results are Z3's word

- **What's wrong.** CLAIMS.md:3 calls every result "machine-checked proofs", and :5 says "Seedelf's core properties by Blaster (Z3)". *Where it stops* (:23–28) lists the machine, the crypto, the ledger's rules, 128 signatories, budgets and what's not covered.
- **It leaves out what the README's *What a ✅ is worth* puts first:**
  - **README.md:89, "Z3's word, or Lean's kernel."** Blaster closes each goal with `axiom blasterProven : ∀ {α}, α` once Z3 finds no counterexample, with no proof reconstruction. The AnyTx README:4 says it too: "A Blaster `Valid` is an SMT result, not a kernel proof term."
  - **README.md:91, strings over the solver's alphabet:** Lean-blaster #389 "shows it proving `False`". The README argues why bytestrings aren't touched, and CLAIMS.md never mentions it.
  - **README.md:97, bounded runs:** a Blaster property holds within its module's step limit, closed by each family's returns-unit-or-error theorem.
- **This widens trust#4.** trust#4 is the same omission for Lovejoin's bytes (the flat decoder, the ledger API's encodings, the fork). It sits beside claims#1 (the machine's caveat).
- **The failure.** The page meant to say where the claim stops is silent on the trust base of the Seedelf half: an unverified Lean-to-SMT translation, and a tool with a known false proof. A reader who doesn't know that Blaster means SMT takes the Seedelf wallet's core property to be kernel-checked. No theorem is affected.
- **Fix** (wording, no test), one bullet in *Where it stops*: "**Seedelf's results are Z3's word.** Blaster translates each goal to SMT and closes it with an axiom once Z3 finds no counterexample; the translation isn't proof-checked, and Lean-blaster #389 is why the README restricts the claim to bytestrings (README, *What a ✅ is worth*). Lovejoin's and the covers are kernel-checked." Make it in the same pass as claims#1's and trust#4's bullets.

### critic#3 · low · prep · `seedelf-platform/seedelf-web-wallet/docs/development.md:182`: part 1's block still sets `release_version=1.8.0`

- **What's wrong.** development.md:168 says "Change part 1's `release_version` to the new, higher version for each later release". The prep followed part 1 for 1.8.1 (the commit message says so) but left the block at 1.8.0.
  - Every release since 1.7.0 changed it in its review or record commit: `c36844ec` (1.7.0), `78642cb4` (1.7.1), `7cbbcc96` (1.7.2), `0b75beaa` (1.8.0).
- **The failure.** The registry blocks (:195–222) are the owner's to paste for the new pool's Cardanoscan entries, the release's one open step. They name their branch and PR from `$release_version` (`lovejoin-pools-$release_version`), "in the same terminal" as part 1.
  - Pasted after part 1 as written, they send 1.8.1's entries from a branch named `lovejoin-pools-1.8.0`. Where such a branch already exists, `git switch -c` refuses it and the `&&` chain stops before the PR. The fork beside the repository has no `lovejoin-pools-*` branch today.
  - A fresh terminal gives `lovejoin-pools-`.
  - Re-running part 1's block as written would also `npm version 1.8.0` on the 1.8.1 branch.
- **Fix:** `release_version=1.8.1` in this round's fix or record commit, as each release did.

### critic#4 · nit · 368 · `seedelf-verification/Lovejoin/AnyTx/README.md:3–4`

- **What's wrong.** "the new modules are also imported by `Lovejoin.lean`" sits at the top of the README that #368's Every section now shares, and the Every modules aren't imported (claims: "`Lovejoin.lean` imports none of the Every modules").
- **Fix:** "the AnyTx modules are also imported by `Lovejoin.lean` (the Every ones aren't: run `./check.sh lovejoin-every`)".

## For the fix round: where the fixes meet

- **readers#4 with worker#1, in one change.** On its own, readers#4's matcher makes worker#1's failure reachable for the first time: staking's words on Lovejoin's Send, `backSubmit`, `claimSubmit` and the runner.
- **worker#3's fix needs readers#4's matcher,** or its own match on the refusal's text, or it never fires.
- **worker#2, readers#3 and readers#2 in one lane** (above). mutants#5's five tests pin today's `takingFrom` and `balanceAfter`.
- **readers#4's fix makes `withdrawOne`'s rebuild-once live on the networks for the first time.** Its paid and private branches are untested: mutants#7's T12d, T26b and T26c. Add those tests in the same lane.
- **guard#1's fix** (copies in `mixLogicHashes`) runs `lovejoinMixLogic` → `verify_pool` for every kept copy at a site's signature. Kept pools are verified at discovery, and `mixLogicOf` caches by pool, so the cost is one derive per copy. Catch a throw per pool, so one bad row can't refuse every pool registration a site asks to sign.

## Consequences of the owner's calls, not written down

- **The edge case's live run declined:** no run, live or e2e, has ever sent a withdrawal of more than 0.
  - The e2e fake answers no row for a script's stake address (`e2e/support.ts:434`, `koios.stakes.get(s) ?? []`), which reads as 0, so every e2e pool holds nothing.
  - So the live ledger's refusal text was never seen by any run. readers#4 surfaced only from the ledger's source, and its fix can be tested only against a hand-written PV11 body.
- **The lucky winner, with the head start:** from 1.8.1's first unlock on mainnet, the first return chain built in `fcb3f5ec…` takes whatever sits in its account (0 today, per money's and readers' reads).

## Checked, and it held

- **giveme.my can't refuse a take.** Its source is `../Collateral-Provider` at `d025cd0`, read through git only. Its CLAUDE.md lists body fields 0, 1, 11, 13, 14 and 16 as the complete set it reads, for the Django service and the `rs/` port alike: "Every other body field — notably … 5 (withdrawals) … — is signed and **not** inspected". Its evaluation is Ogmios's phase 2. So a take can't make it refuse a way back or a session's collateral mix. That closes readers' *Not checked*.
- **The head start's pool, on mainnet.** It holds 64 boxes of 5 ₳ (Koios `credential_utxos` of `dd94113c…`): 30 from `ceb871ea…` (block 14,167,087) and 34 from `362d4efc…` (14,167,095), minutes after its launch at 14,167,059.
  - That's past the floor of 30 for every wallet but the one that made them. So in 1.8.1, mainnet's returns, their 5 ₳ collateral, and a swap's, mix there by default.
  - 1.8.0 did the same once `adaPool`'s ask found the pool. The head start makes the quiet paths know it at once: the as-you-type prices, the connect window's `lovejoinRoomKept`, and `tailHere`.
- **`adaPoolOf` picks the v2 pool.** It drops retired pools (`isRetired`: the classic pool, or not v2) and copies, so with two 5 ₳ pools in mainnet's head start it picks `fcb3f5ec`, never `dc6abe3b`.
- **The head start merges cleanly with a 1.8.0 profile.**
  - `kept()` keys pools by reference UTxO, so a 1.8.0 profile that found `fcb3f5ec` by an ask holds one entry.
  - `listed` is the token list's fingerprint, which is unchanged, and the heights are max'd under the same list.
- **Nothing now says something untrue:**
  - the listing's mainnet line (`store/README.md:59`: no mix until 30 boxes not yours, and a return that says why);
  - `README.md:59`, flows.md's Lovejoin section, backlog :76, :82 and :83, and releases.md :45, each conditional or history;
  - the reasons `sess.skip.warn.noAdaPool`, `sess.skip.warn.poolFloor_*`, `lj.skip.warn.floorShort_*` and `lj.floorShortSentence_*`, which are true whether the pool is unknown or known but short.
- **The Cardanoscan entries the prep generated** name the v2 pool's four scripts "… v2 (5 ADA)", version 3, on Lovejoin `29573c58ccee`, and the 8131b1d pool's as version 2.
- **The update from 1.8.0.**
  - Reservations, `heldSent`, `spentSet` and kept reviews live in the session area, which an update clears.
  - Every new field is optional (`balances?`, `rewards?`, `takes?`), so a record without one reads as no take.
- **i18n.**
  - `REWARDS_MOVED` and `REWARDS_MOVED_REVIEW` are functions.
  - "Why it stopped: {{why}}." strips a trailing `.` or `。` (`sentence.ts` `FULL_STOP = /[.。]$/`), so ja reads "…ありません。" once.
  - Settings' "The last box that didn't go: {{why}}" adds no stop of its own.
  - There are no plurals in the new keys.
  - `dapp.lovejoinRewards` is English for the site and the user's language only for the window, as `dapp.sessionStakeKey` is.
- **The screens on a refusal.**
  - Lovejoin's public review shows a stale Send's words with Send still there (no `isStale` on that screen), as `lj.mixTooOld` did before.
  - A site's refused transaction never reaches the user (`readTx` comes before `ask`), as with the other unprompted refusals.
- **The builders.** Every `WithdrawZero` is built in `mix_with` or `withdraw_with`. The only `Rewards::none()` callers are the two probes (`box_value.rs:289`, `pool.rs:630`), never sent.
- **`lovejoinMixLogic` names the right account.** It goes through `protocol_of` → `verify_pool` (`derive_for`, by the datum's L), so a retired V1 pool's account comes from its own set, as its builder's does.
- **Typecheck,** a modality no lens ran: `tsc --noEmit -p .` on the tree. Its only error is in another verifier's repro (`tests/zz-r181-v-readers-2.test.ts:47`), so src, tests and e2e are otherwise clean.
- **#368's headline theorems state real acceptance.** Their left side is `∃ n, cekExecuteProgram <template> [toTerm P, toTerm nftName, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)` (`Readable.lean:224–229`, `:257–264`).
- **#368's other doc sections.** The AnyTx README's other sections hold (critic#4 aside). Its "A Blaster `Valid` is an SMT result" is the caveat CLAIMS.md drops (critic#2).
- **The e2e.** The data-layer e2e project, the one on mainnet, doesn't touch Lovejoin.
- **No new verification claims.** The web wallet's docs, listing and strings claim nothing about verification beyond `README.md:59` (before 1.8.1). flows.md says nothing #367 made untrue.
- **`lovejoin-mix-width.md:29`'s "zero withdrawal"** describes the width test's measured shape (`Rewards::none()`), which is accurate.

## A note for the owner (out of scope: staking code from before 1.8.0)

- **Other names have moved too.** cardano-ledger `master`'s DELEG rule has `DelegAccountAlreadyRegistered`, `StakeKeyHasNonZeroAccountBalanceDELEG` and `DepositIncorrectDELEG`.
- **`stakingRefusal` misses some of them.** Its `/StakeKey(Not)?Registered|IncorrectDeposit|NonZeroRewardAccountBalance/` misses the first two; `IncorrectDepositDELEG` is still there.
- **Not confirmed live.** I didn't check which ledger version mainnet's nodes run, only `master`. Worth a look with readers#4's fix.

## How

- **Read:** the nine reports; `find-result.json`; the diffs (`08fbb6f6..9103df62`, `9103df62..d190f717`, `2a8060d3`); and the code each check names.
- **The network:** three Koios reads (mainnet `credential_utxos`, both networks' `epoch_params`) and cardano-ledger's `Ledger.hs`, `Certs.hs`, `Deleg.hs` and `Utxo.hs` from GitHub.
- **Not run:** no repro test, no build, nothing in seedelf-data or seedelf-verification, no e2e or live run, no submit.
