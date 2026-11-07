# 1.8.1's review of its merged fixes: r2-screens

**Lens:** what the user sees now. The public reviews' *Public account after*, the words that show at protocol version 11 where they never did, and whether flows.md, the e2e and the store listing describe the old behaviour. Read on the main tree with the merged fixes (`git diff HEAD`), on `2a8060d3`.

**In short:** the public reviews' figures hold, in all three languages, with a take and without one. The words hold in every Lovejoin frame. Three findings, all low:

| id | severity | what |
|---|---|---|
| r2-screens#1 | low | readers#4's match puts staking's words on a direct swap's retry line (and its Send), when a Danogo script's reward account isn't withdrawn whole |
| r2-screens#2 | low | guard#4 is in no lane: `lj.warn.rewardsMoved` is listed as verified with no round recorded, and worker#1's rethrow put it in more frames |
| r2-screens#3 | low | flows.md:432's list of a site's transactions refused before the window opens leaves out the Lovejoin reward-account refusal, which guard#1 widened; no design doc names it |

Two repros, `EXT/tests/zz-r181-r2-screens-{1,2}.test.ts`, each run alone with `npx vitest run tests/zz-r181-r2-screens-<n>.test.ts`. Both are deleted from the tree, and kept at `SCRATCH/review/r2-screens/repros/`, with their output in `SCRATCH/review/r2-screens/` (`frames.txt`, `direct-swap.txt`, `direct-swap-head-koios.txt`). One revert in R2: HEAD's `koios.ts`, for repro 2, restored at once. `git -C R2 diff` printed nothing before or after.

## Findings

### r2-screens#1 · low · staking's words reach a direct swap's retry line at protocol version 11

- **Files:** `EXT/src/background/koios.ts:717`, `:721` and `:1248` (readers#4's match), reached through `EXT/src/background/sessions.ts:6734` (a direct swap's zero withdrawals) and `:3652` (the runner's retry), and shown at `EXT/src/ui/screens/Swaps.tsx:3225`.
- **Where the two features meet.** Chunk 24's direct swap through Danogo withdraws zero from Danogo's pool script and from each spent pool's staking script (`directSpends`, `minswap.ts` `DANOGO_POOL`). Those are script reward accounts, as Lovejoin's `mix_logic` is.
  - The refusals lane now words every `ConwayIncompleteWithdrawals` as `koios.staking.rewardsChanged`, and every `ConwayWithdrawalsMissingAccounts` as `koios.staking.changed`, whoever's account it names.
  - Lovejoin rewords the error by its type (pumpPublicNow, sessions.ts pump, withdrawOne). Nothing rewords it for a swap.
  - The lane's note 7 checked a site's transaction, which no user sees (below). It didn't check the wallet's own direct swaps.
- **Repro** (`zz-r181-r2-screens-2`). It's direct-swaps.test.ts's harness: Minswap's direct swap of 10 ADA for MIN, placed by the runner (`sessions.advance`).
  - The submit gets cardano-submit-api's 400, as koios.test.ts builds it. Its error is `ConwayIncompleteWithdrawals` for `ScriptHashObj (ScriptHash "04041c3c…")`, Danogo's preprod pool script: `supplied: Coin 0, expected: Coin 500000000`.
  - **Merged tree:** `auto.retry` is `{"error":"Your staking rewards changed since you reviewed this. Review it again.","reason":"other"}`. The swap's page reads "… Your staking rewards changed since you reviewed this. Review it again. Trying again in … minutes. Try now".
  - **R2 with HEAD's `koios.ts`:** the network's own words, "The network rejected the transaction: {…ConwayIncompleteWithdrawals…}".
- **The failure.** A Danogo script's reward account holds money at the swap's submit. That's anyone parking it there, as a retired stake pool's deposit does, or an epoch's start paying it between Minswap's build and the send. Then:
  - a swap that runs itself says the user's staking rewards changed, and to review it again, though it has no review and retries by itself;
  - a swap reviewed by hand says the same at its Send. Reviewed again, Minswap builds the same zero withdrawal, refused again;
  - an unregistered staking script reads "Your account's staking changed since you reviewed this. Refresh, and review it again."
  - Both refusals are phase 1, so nothing is lost. Direct swaps came in chunk 24 (2026-10-06), after both networks went to protocol version 11, so no direct swap ever showed these words before this merge.
- **Smallest fix, test first:**
  - **The test:** the repro, in `tests/direct-swaps.test.ts`. A direct swap refused for Danogo's script's account never says "staking rewards" or "review it again".
  - **The fix, in `koios.ts`:** word a withdrawal refusal in staking's words only where the account it names is a key's (`KeyHashObj`; PV10's `WithdrawalsNotInRewardsCERTS` names the credential the same way). A script's account keeps the network's own words, and still throws `RewardsChangedError`, which Lovejoin rewords by type.
  - koios.test.ts's case "for a script's account (Lovejoin's)" then expects the network's words, with the type. Every Lovejoin test holds `REWARDS_MOVED()` after the rethrow, so none changes.

### r2-screens#2 · low · `lj.warn.rewardsMoved` is still listed as verified with no round recorded, and it now shows in more frames

- **Files:** `WW/docs/i18n/verified-critical-es.json:480` and `verified-critical-ja.json:480`.
- **What's wrong.** guard#4 (round one) is in no lane's list in FIXBRIEF.md, and not in R2BRIEF.md's *Not fixed, on purpose*. The docs lane flagged it to the lead (`fixes/docs.md:147`). The merged diff touches nothing under `docs/i18n/`. Both reviewer notes still end at 1.8.0's round, and neither names the key.
  - **Why it's in the lead's blind round by name only:** FIXBRIEF's rule 6 runs that round over keys that are new or changed. Every lane reported none.
- **The frames are now wider than guard#4 listed.** Round one listed the stop reason (`lovejoin.detail.whyStopped`), a chain's `stopped` and a withdraw's refusal. worker#1's rethrow, merged, adds:
  - **Send's alert** (Screen's `role="alert"`): a public mix, Mix again, and a return reviewed and sent (Swaps.tsx, SiteSessions.tsx);
  - **Bring everything back's failed callout**, `{name}: {error}` in ClaimAll.tsx's JSX;
  - **the runner's retry lines:** `lovejoin.detail.triesAgain` on the hub's card, and the swap timeline's `withStop(retryReason(…))`.
  - The rest it already reached: `lovejoin.chains.whyStopped`, and Bring every box back's `settings.lovejoin.bringWhy` and `.warn.bringStopped`.
- **Repro** (`zz-r181-r2-screens-1`, `frames.txt`): every frame, in en, es and ja, its placeholders filled as the screens fill them.
  - No stop is doubled ("..", "。。", "。.").
  - My own reading, not blind, finds the meaning held in each. In Spanish, "Por qué se detuvo: La red lo rechazó: el pool…" opens with a capital inside the colon frame, as every whole-sentence reason does there (e2e:3449's "Why it stopped: The network rejected the transaction"). The frame does this to all of them; it isn't the key's.
- **The failure.** The record of the accepted risk, that no native speaker reads these, claims a blind check for a critical warning that nobody made. It's live on both networks from 1.8.1, since readers#4's match.
- **The fix.** A fresh agent back-translates es and ja blind, in the frames above, filled as in `frames.txt`. Then both reviewer notes gain a 1.8.1 entry. Or take the key out of both verified lists until that's done; the critical-words gate then holds the release.

### r2-screens#3 · low · flows.md's refusals before the window leave out the Lovejoin reward account

- **File:** `WW/docs/flows.md:432`.
- **What's wrong.** It reads: "A transaction that needs someone else's signature, when the site didn't ask for a partial one, or one that would hand the collateral to someone else, is refused before the window opens."
  - Since #367, `readTx` also refuses before the window, unasked, a site's transaction that pays into a Lovejoin pool's `mix_logic` reward account. That's a pool registration's reward account, a proposal's deposit return, or a treasury withdrawal's payee (`dapp.ts:2096-2104`, `dapp.lovejoinRewards`).
  - Since guard#1, merged, that covers the classic pool and every pool discovery keeps, read or not.
  - No design doc names this rule: not architecture.md's connector section, not privacy.md, not flows.md. Only the archived chunk 43 record does. `plans/README.md:21` says what still holds moves into the design docs.
- **The failure.** The flows doc says a site's transaction is refused before the window in two cases, the 1.8.0 rule set. The third is the one rule of the signer's that this release adds and the guard lane widened.
- **The fix.** One clause at flows.md:432: "… or one that pays into the reward account of a Lovejoin pool the wallet keeps (a stake pool's, a proposal's deposit or a treasury withdrawal naming it; chunk 43, 1.8.1's release review guard#1) …". Optionally a line in architecture.md's connector section.

## What held

**The public reviews' *Public account after*** (PublicReview, PublicAgainReview):

- **The figure** is Home's, `before`, less publicLeaving, plus `taken`. Rendered in en, es and ja (repro 1), with 100 ₳ on Home, two 10 ₳ boxes and 6.852214 ₳ of fees:
  - no take: 73.147786 ₳;
  - 500 ₳ taken: 573.147786 ₳, beside "Total leaving … 26.852214 ₳";
  - mixing again, 500 ₳ taken: 593.147786 ₳.
  - The labels are unchanged, and the numbers are en-US. The row keeps its place and test id: TotalRows, then AfterRow, as MoveIn and Staking render theirs. It clamps at 0, and the amount hides with the balances, as before.
- **`taken`** is `takenOf(readsFor(reads, chain.txs))`: for each account read, the most any built transaction withdraws, from its CBOR. The change the chain brings into the account counts it, so the after is what lands.
  - **Across two pools:** a public mix and Mix again read one pool (`rewardsIn(network, [into])`), so it can't arise on the public reviews.
  - **The classic pool's reviews** have no after line (`before` undefined), as before.
  - **A Bootstrap** reads none, and keeps TotalRows' own after.
- **Unread:** an unread read is "0". The request then carries no `rewards`, so the chain withdraws 0, and there's no `taken`. The after is before less what leaves, which is what that chain sends.
  - At Send, a balance found then is a stale review (`lj.rewardsMovedReview`).
  - A read that fails again sends, and the ledger refuses at phase 1.
- **The rest of the review:** the fees and the transaction count come from the built chain, the take's dearer first mix included.
  - Total leaving leaves the take out, and no line names it: the owner's call 1, whose backlog line is true now.
  - The privacy notes still hold with a take, since the account already pays those mixes.

**Staking's words (`koios.staking.*`):**

- **Their frames** are whole messages, never interpolated, so nothing doubles or runs into a frame:
  - Withdraw and Stop staking: Staking's Screen error;
  - a Send, a move-in, an account-paid mint or the collateral payment that spends the rewards: each review's Screen error.
- **A site's `submitTx`:** the site hears `dapp.notSent`, in English (`notSent`). The staking words are only DappError's message, and sw.ts posts `e.failure` alone. So no user sees them; the refusals lane's note 7 has no frame.
- **pending.ts's resend** of a maybe-sent payment swallows every refusal but a spent input.
- **None is critical** (critical-keys.json); all are machine drafts (provenance).

**Lovejoin's words:**

- **Every Lovejoin submit rewords a `RewardsChangedError`:**
  - pumpPublicNow;
  - sessions.ts pump, through sendStep and submit, a collateral's tail included;
  - withdrawOne: built again once, then `KoiosError(REWARDS_MOVED())`.
  - The maybe-sent way back's resend (`lovejoin.ts:7881`) swallows the error.
- **No Lovejoin transaction carries a certificate,** so DELEG's names never reach a Lovejoin frame. A pool's start registers `mix_logic`, but its refusal names (`StakeKey(Not)?Registered`) are matched as before at ledger 1.23.
- **The words fit each frame** in all three languages (repro 1, above). The hub card says the sentence twice, under *Why it stopped* and *What went wrong*. That's known (the refusals lane, v-worker), and it's so for every stop.
- **`lj.rewardsMovedReview`** isn't critical. It shows in ClaimAll's warn callout: guard#10, a backlog line.

**flows.md, the e2e, the store:**

- **flows.md:301** ("Refusals, in plain words") is true again at protocol version 11 with readers#4.
- **flows.md says nothing of the take,** Send's read or Lovejoin's refusal words, so nothing in it describes the old behaviour, bar finding 3.
- **The e2e** (read only):
  - No spec names the new refusal names, a take, or `mix_logic`'s `account_info`.
  - `extension.spec.ts:3118`'s "Public account after10,434.\d+ ₳" holds: the fake answers no `account_info` row for the pool's account, so it reads 0 and takes nothing.
  - `:3411`'s refusal body matches none of the new patterns, and `:3449`'s "Why it stopped: The network rejected the transaction" still reads so.
  - `e2e/live/` has none of these strings.
- **store/README.md:**
  - The listing and the permission texts say nothing the merge changed.
  - On mainnet the data layer answers `account_info` for a script's stake address (`seedelf-data` `ids.rs` `stake_bytes` takes `0xf1`), so the new reads don't fall to Koios. The listing's line that Koios is asked only what made the user's boxes still holds.
  - The five screenshots (`e2e/store-images.spec.ts`) show no Lovejoin review.

## For the lead

- **flows.md and chunk 43.** It never got the take in *Public account after*, Send's read and stale review, or the refusal's words. `plans/README.md:21` would put the flow-level parts there. Optional, beside finding 3's clause.
- **The race's words.** The backlog's race lines (worker#2, readers#2) don't say what the user sees. With readers#4's match it's `lj.warn.rewardsMoved`, "Lovejoin's pool changed as it was sent. Nothing was lost.", where the wallet's own transaction holds the balance. That's not false from the refused transaction's side, so no finding. The line could say it.
- **Repros and scratch:** `SCRATCH/review/r2-screens/` (`repros/`, `frames.txt`, `direct-swap.txt`, `direct-swap-head-koios.txt`). Nothing is left in the main tree but this report, and R2 is as found.
