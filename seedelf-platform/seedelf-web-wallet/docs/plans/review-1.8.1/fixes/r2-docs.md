# 1.8.1's round-two fix-ups: docs

Lane `docs`, worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r2fix-docs`, detached at the snapshot `a619169f` (round one merged). Everything is uncommitted and unstaged. Twelve files are modified; none is new, moved or deleted. No string a user sees changed, so no i18n key was added or changed.

**Tests.** No test reads any file I changed: the extension's tests read `docs/i18n/` alone, the Rust tests read `wasm/README.md` alone (untouched), and no CI job runs on `seedelf-verification/`; web-wallet.yml's `covered` filter skips Markdown. So no test could fail before a fix. As round one did, I checked each claim against the code, the proofs or GitHub (cited below). And I ran the same checks before and after the edits (`SCRATCH/r2fix-docs/check-docs.sh`):

- **Links and anchors** in all 11 Markdown files: 0 broken before, 0 after. A planted bad anchor and a missing file were caught, and so was a broken copy of the new `privacy.md#known-links` link.
- **check.sh:** `bash -n` ok. The verif lane's parse-only copy (`cases.sh`, each module and its caps printed instead of built) gives identical output before and after: the edit is comment-only.
- **Added lines:** no lowercase "seedelf" in prose, no "Seedelf wallet", and nothing that dates a release or says what the store does.

## The findings

### r2-screens#3 · fixed · `docs/flows.md:432`

- **The change:** the list of a site's transactions refused before the window opens now names a third one. That's a transaction paying into a Lovejoin pool's reward account (a stake pool's, a proposal's deposit return or a treasury withdrawal's payee), for the classic pool and every pool the wallet keeps (chunk 43; 1.8.1's release review, guard#1).
- **Checked against:** `dapp.ts:2096–2104`. `readTx` refuses before `ask`, for a session (`holder`) and the public account alike.

### r2-docs#2 · fixed · `seedelf-verification/Lovejoin/AnyTx/README.md:261–263`, `:296–304`, `:308–313`

- ***Owner verifier progress*** opens with the supersede note, as *Withdrawal-handler progress* has. The complete results above supersede it: `mix_logic_accepts_iff` is the whole validator, Owner and Mix, and `one_shot_mint_accepts_iff` the whole launch, with no list bound. What follows stays as cross-checks. So `:286`'s "remains open" and `:288`'s "bounded" now read as the partial work they are.
- ***Remaining safety work*** is rescoped:
  - For mix_box, mix_logic, one_shot_mint and reference_holder, no transaction layout is left to cover; the scenario families stay as cross-checks.
  - fee_contract has no such result, and it's out of the claim. It has only its rejected purposes (`FeePurpose`, `PurposesKernel`) and fixed layouts (`FeeMix`, `FeeSpend` and `FeeRecovery` here, more in `Template/` and `Audit/`).
  - The audit suites' caveat stays.
  - The proofs say what each script checks, not that the cryptography can't be broken, within CLAIMS.md's limits.
- ***Additional transaction matrix to verify*:** these were targets. Whether mix_box, mix_logic and one_shot_mint accept, in any transaction the ledger can form, is now the complete results, so the rows are cross-check targets. The *Fee shard* rows are fee_contract's.
- **Checked against:**
  - `Readable.lean:224` and `:257`, the two theorems and their hypotheses. These are values only: reference inputs' for mix_logic, the mint's and outputs' for one_shot_mint.
  - `every_context_iff` at `:12`, and `reference_holder_every_context_errors` at `:35`.
  - Every fee_contract module, by `git grep`. Each is a fixed scenario, such as `Template/FeeContract.lean`'s one shard and one fee output. That's why the line says "no such result", not "only these".
  - No link points at these sections' anchors, so the headings are unchanged.

### r2-docs#3 · fixed · `docs/architecture.md:568` (new bullet in *Signing*)

- **What the bullet says:**
  - The worker refuses a transaction that pays into a Lovejoin pool's `mix_logic` reward account (chunk 43), a session's too, before the window opens, in `dapp.lovejoinRewards`'s words.
  - WebAssembly's `paidScripts` names the accounts paid: a stake pool registration's reward account, a proposal's deposit return, a treasury withdrawal's payee.
  - `LovejoinService.mixLogicHashes` gives the `mix_logic` hashes of the classic pool and of every pool discovery keeps, retired ones and copies included, read or not (`everyKept`), asking nobody.
  - So the set no longer depends on where the wallet's boxes are (guard#1, v-guard#1). It does depend on which pools this device has found, which a site can probe (a link to privacy.md).
- **"No longer", not "never":** if discovery's record can't be read, `mixLogicHashes` falls back to `readSet`'s set, and that includes the sealed copies (`lovejoin.ts:2915`, `:4634`).
- **Checked against:**
  - `lovejoin.ts:4624–4639`;
  - `lovejoin-pools.ts:357–365` and `:646–665`;
  - `dapp.ts:2096–2104`.

### r2-docs#4 · fixed (privacy.md); the policy's row is the owner's · `docs/privacy.md:172`

- **The line,** in *Connecting a site*, after *Nor about the wallet's other accounts*: "But a site can tell which Lovejoin pools this device knows". A transaction it asks to sign that pays into a pool's reward account is refused unasked where the device knows that pool, and opens the window where it doesn't. So the site learns whether this device has read Lovejoin's pools since that pool started, a hint that it uses Lovejoin.
- **Checked against:** the guard's set (above). `everyKept` is the head start's pools plus those this device found since (`kept()`). Also r2-docs#4's repro output: code 1 unasked, against code 2 after a window.
- **Not touched:** the policy's *sites you connect* row (`store/privacy-policy.md:29`). It's the owner's call (*For the lead*).

### r2-docs#5 · fixed · `docs/backlog.md:23`

- **The change:** guard#10's line now reads "none of them critical but `lj.warn.rewardsMoved`, which worker#1's rethrow puts there for a return's chain refused for its pool's balance".
- **Checked against:**
  - `sessions.ts:5319–5321`, the rethrow as `RewardsChangedError(REWARDS_MOVED(), …)`;
  - `lovejoin.ts:184`, `REWARDS_MOVED` is `lj.warn.rewardsMoved`;
  - `critical-keys.json:157`;
  - `ClaimAll.tsx:160–163`, the warn callout.
- **Neither key is in `RUNTIME`,** which the line's "doesn't name it" still says of the review key. r2-screens#1's fix doesn't change this: a script's account stays a `RewardsChangedError`, which the rethrow rewords by type.

### r2-docs#6 and r2-last#2 · fixed · `docs/plans/chunk-41-blaster-fixes.md:19`, `:21`, `:85`

- **`:19`:** "#71 (merged 2026-11-05, `6b4260a`)", where it said "changes requested".
- **`:21`:** only what's open: re-modelling `ByteString` as `ByteArray`, which we agreed to, with an issue asked for. None was open on 2026-11-07. The stopgap question and "close #71" are gone, settled by the merge.
- **`:85`:** "Open since 2026-11-03: Lean-blaster #455 …, and PlutusCoreBlaster #73. #72 merged 2026-11-03, #71 2026-11-05."
- **Checked on GitHub** (public reads):
  - #71 is MERGED, 2026-11-05T11:22:34Z, `6b4260a980af…`;
  - #73 is OPEN;
  - no PlutusCoreBlaster issue matches "ByteArray".

### r2-docs#7 · fixed · `seedelf-verification/CLAIMS.md:23`, `:24`

- **`:24`:** after the main pin's three changes, "and `Slice/`'s pin a fourth (an opaque byte slice, for the policy's rule)".
- **`:23`:** "Blaster, on our fork with the fix for Lean-blaster #454 (README, *Running it*), translates a goal …", in the bullet about Blaster's results.
- **Checked against:**
  - `Slice/lakefile.lean`: `96261cc`, the main pin plus `SliceByteString`;
  - `lakefile.lean`: Blaster `25c0ee0`;
  - the README's *Running it*: "#71 and #72 have merged since; the operand order (#73), `serialise_data` and xor haven't", so three in the main pin.

### r2-docs#8 · fixed · `docs/development.md:145`

- **The change:** "a 1.8.x build puts none there" and "at the profile's first unlock on 1.8.0 or later".
- **Checked against:** `lovejoin.ts:4302–4311`. `retireOnce` is gated only by the schedule's `retired` being unset, with no version check. So a 1.7.2 profile updated straight to 1.8.1 runs it at 1.8.1's first unlock.

### r2-docs#9 · fixed · `seedelf-verification/check.sh:22–23`

- **The change:** the usage line is now "some modules (naming a Lovejoin.Every one gives the whole run 16G, 30m)", wrapped as `:19–20` are.
- **Checked against:** `:26`, which sets `CAP` and `LIMIT` for the whole run. The parse-only output is identical before and after.

### r2-docs#10 · fixed · `docs/architecture.md:702`

- **The change:** "read once a build, its balance counted as 0 while the wallet's own transaction on its way takes it", where it said "none while …".
- **Checked against:**
  - `readRewards` (`lovejoin.ts:4673–4693`) always asks `account_info`;
  - `balanceAfter` (`lovejoin-rewards.ts:86`) gives 0 when what's on its way takes at least what's read.

### r2-docs#11 · fixed · `docs/archive/plans/chunk-43-lovejoin-reward-balance.md:192`

- **The change:** "from the IP address that sends the transaction, and at its review, even one never sent (1.8.1's release review, guard#7)". It's fixed as `:47` was, with its pointer, in privacy.md:236's terms.

### r2-docs#12 · fixed · `docs/archive/plans/chunk-45-lovejoin-every-tx.md:14`

- **The change:** "The owner, 2026-11-06, with the old pools empty and the 5 ₳ v2 pool live:", which no longer says 1.8.0 shipped.

### r2-rust#2 · fixed · `seedelf-platform/CLAUDE.md:86`

- **The change:** the test "holds the mix_logic, mix_box and one_shot_mint files there to these, and mainnet's v2 5 ₳ pool to them applied; the set's fourth template, fee_contract, is out of the claim".
- **Checked against:** `wasm/tests/lovejoin_proven_bytes_test.rs`. Its destructure skips the fourth hash (`[one_shot_mint, mix_logic, mix_box, _]`), and it holds reference_holder to `REFERENCE_HOLDER_HASH`, which isn't a `Set::V2` template.

### The reverted v-pv11-impact#2 · backlog line · `docs/backlog.md:60`

- **The line:** ⬜ "The 'Koios behind' rules never see a name", in the Lovejoin area after the race lines. It cites 1.8.1's release review (v-pv11-impact#2) and its review of its fixes (r2-worker#1, r2-worker#2, r2-tests#1).
- **What it says:**
  - tailWitness's and unstale's rules were built and tested against an invented 3117. Ogmios names an unknown input only in a 3004's reason.
  - So a collateral's mix evaluated a block behind its deposit stops its chain, and a build again avoids nothing.
  - Naming it from that reason, tried and reverted in 1.8.1's fix rounds, reached tailWitness, unstale and Mix again together. A collateral's mix whose own box another wallet drew waited a day, and Mix again took the wallet's own boxes for gone.
  - Rework them together. Only preprod, or mainnet with Koios as a fallback, reaches them.
- **Checked against:**
  - `2a8060d3`'s `unknownInputs`, which names only from `unknownOutputReferences`;
  - v-pv11-impact.md's Ogmios table and repros 3 and 4;
  - r2-worker#1, r2-worker#2 and r2-tests#1.
- **Status ⬜:** the lead's "Rework them together, later" is a candidate, not an owner's call.

## Two edits beyond the list, each easy to drop

- **`docs/architecture.md:377`, r2-screens#1's consequence.** Round one's refusal list said every withdrawal refusal is in staking's words. The sentence now adds that it's in staking's words only where the refusal names a key's account (`KeyHashObj`). A script's account (a Danogo pool's zero withdrawal, a Lovejoin pool's `mix_logic`) keeps the network's own, still a `RewardsChangedError` (1.8.1's review of its fixes, r2-screens#1).
  - It's written to the brief's spec of the worker lane's fix. When I looked, that lane's `koios.ts` was unchanged, so check this sentence against what lands.
- **`docs/architecture.md:635`, a pointer.** tailWitness's "behind, ask again" rule (`ours`) is described as live. After the revert no real answer reaches it, so it now says that, with a link to the new backlog line.

## What a doc now says wrongly, or will

- **Nothing I changed is wrong on the merged tree plus the round-two lanes as briefed.** Two lines depend on the worker lane:
  - `architecture.md:377` (above);
  - `architecture.md:635` and `backlog.md:60`, which assume v-pv11-impact#2 reverted to `2a8060d3`'s `unknownInputs`.
- **Left, the same nit as r2-docs#8 in design docs:** "1.8.0's first unlock" for the retired pools' run (`architecture.md:708`, `:743`; `privacy.md:231`). They read as when it began. A 1.7.2 profile updating straight to 1.8.1 runs it at 1.8.1's first unlock.
- **Left:** `architecture.md:750` (the cost line), "asked again … while giveme.my is busy or Koios is behind", names the same dead case as `:635`.
- **Left:** `seedelf-verification/README.md:16`, "`lovejoin-every` and its modules 16 GB and 30 minutes", is true. Like check.sh's old usage line, it doesn't say a run naming one gives every module in it 16 GB.

## For the lead

- **r2-docs#1 is the owner's** (the release PR asks): the policy's 6 November entry and Effective line. Not touched.
- **r2-docs#4's policy half is the owner's:** whether the *sites you connect* row (`store/privacy-policy.md:29`) says a site can tell which Lovejoin pools the device knows. If yes, that's body text, and a dated *Changes* entry only if the owner reads it as new data handling.
- **r2-docs#13 is left,** as you called it: `Lovejoin/Template/Scripts.lean:10` and `Steps.lean:10`.
- **The two edits beyond the list** (above): keep or drop, independently.
- **Not in my brief, from r2-screens' notes:**
  - flows.md never got chunk 43's take, Send's read or its refusal words (plans/README.md:21);
  - the race lines (`backlog.md:55–59`) don't say what the user sees (`lj.warn.rewardsMoved`).

## Files

- M `seedelf-platform/CLAUDE.md`
- M `seedelf-platform/seedelf-web-wallet/docs/architecture.md`
- M `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-43-lovejoin-reward-balance.md`
- M `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-45-lovejoin-every-tx.md`
- M `seedelf-platform/seedelf-web-wallet/docs/backlog.md`
- M `seedelf-platform/seedelf-web-wallet/docs/development.md`
- M `seedelf-platform/seedelf-web-wallet/docs/flows.md`
- M `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-41-blaster-fixes.md`
- M `seedelf-platform/seedelf-web-wallet/docs/privacy.md`
- M `seedelf-verification/CLAIMS.md`
- M `seedelf-verification/Lovejoin/AnyTx/README.md`
- M `seedelf-verification/check.sh`

## What I ran

- **`bash SCRATCH/r2fix-docs/check-docs.sh`,** before the edits (`before`) and after (`after`, `final`):
  - the link and anchor checker (r2-docs' `links.py`), 0 broken each time;
  - `bash -n check.sh`, ok;
  - the verif lane's `cases.sh` and `parse-only.sh`, with `TMPDIR` in my scratch: 13 cases, identical before and after;
  - the name-style and release-date scans of added lines, 0 hits.
- **Planted errors,** caught: a bad anchor, a missing file, and a broken copy of my new link.
- **`gh pr view 71`, `gh pr view 73` and `gh issue list --search ByteArray`,** on input-output-hk/PlutusCoreBlaster: public reads.
- **Not run:** no build, no `npm`, no `cargo`, no `lake`, `lean` or `check.sh` itself, nothing in seedelf-data.
