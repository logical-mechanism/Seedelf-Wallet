# v-pr336-5-trace: pr336#5, architecture.md and lovejoin-pools.ts's comments still describe mainnet discovery as before #336

**Verdict: confirmed. Severity: low** (as the finding says). Confidence: high.

I tried to refute it on HEAD (`6bca8bec`) and couldn't. The text the finding cites is byte-identical to 1.6.0's, and #336 changed the code under it. A scratch test settles it both ways. The doc's three claims, written as behaviour, fail on HEAD and pass on the code from before #336. One correction for the fix: only half of "finished" is Koios's now.

## What holds on HEAD

- **architecture.md:732 is 1.6.0's line, unchanged.** It is byte-identical to `babb8e76`'s line 732. In `git diff babb8e76 HEAD -- docs/architecture.md` it shows only as context, next to #329's link change (`plans/` → `archive/plans/`). It still says:
  - "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below)"
  - "Whether a pool is on chain at all is the ledger's to judge, not the server's"
  - "Koios's look works those out itself, from the launch's own transaction (`tx_info`) and … (`account_update_history`)"
- **This paragraph is docs-small#1's own fix.** 1.6.0's FINDINGS said: "In architecture.md's *Which pools are shown*, say that on mainnet 'finished' and 'earliest' are the server's word". #336 built the optional check that docs-small#1 and pool-exists asked for, but it left the paragraph as it was.
- **architecture.md:737** (Lovejoin's *What each costs*) is byte-identical to 1.6.0's. It names no discovery cost at all: not the holder look's, and not the new confirmation's.
- **The comments are verbatim from `babb8e76`:**
  - `lovejoin-pools.ts:31-36`: "Verified offline, a pool may still not be on chain …, so the ledger is the judge of that"
  - `:399-403`: "every pool it shows, verified here again, kept"
  - `:435-438`: "That the pool is on chain at all, the ledger checks"
- **#336 touched none of them.** Its diffstat covers `privacy.md`, `privacy-policy.md`, `lovejoin-pools.ts` (`:454` and the move into `launched()` and `confirmed()`) and two tests. Its description names only the privacy policy and privacy.md as docs. #337 didn't touch the paragraph. #338's merge (`6bca8bec^1..6bca8bec`) changes only `post-release-roadmap.md`, which matches the user's note.
- **The code it should describe:**
  - `:454` is `await this.keep(network, await this.confirmed(network, found));`.
  - `confirmed()` (`:565`) calls `launched()` (`:522`). That calls `koios.launches`: `tx_info`, `TXS_PER_REQUEST = 20` (`koios.ts:448`), with `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates` (`:942`, "nothing of its outputs").
  - Only for an L its launch didn't register, it also calls `koios.firstRegistrations`: `account_update_history`, `CREDENTIALS_PER_REQUEST = 75` (`:442`).
  - A pool Koios can't confirm isn't kept (`:582-583`).
- **The docs now disagree with each other.** #336 updated `privacy.md:200` and the policy (`privacy-policy.md:46`, and the 28 October entry at `:93`), and both describe the confirmation correctly. architecture.md doesn't.

## Repro

I wrote a scratch test, `extension/tests/zz-review-v-pr336-5-trace-1.test.ts`, and ran it alone. It was wired as `lovejoin-discovery.test.ts` wires discovery: the real WebAssembly, the preprod pool fixture, and a fake index and fake Koios. For the many-pool cost tests it used a WebAssembly stand-in. It had 9 tests.

**Part 1, the doc's claims as behaviour.** Each should fail on HEAD if the finding is real.

1. *"that it's finished … are the server's word"*: Koios knows the launch, which registered nothing, and no block registered L. The test expects the listed pool to be kept. **FAILED:** `expected [] to deeply equal [ 'c5852bb7…' ]`.
2. *"Whether a pool is on chain at all is the ledger's to judge, not the server's"*: Koios doesn't know the launch. The test expects the listed pool to be kept. **FAILED**, with the same message.
3. *"Koios's look works those out itself"*: the test expects the data layer's path to ask Koios nothing. **FAILED:** `expected [ 'tx_info' ] to deeply equal []`.

**Part 2, what is still the server's word.** All three passed on HEAD.

4. **Position:** Koios says block `BLOCK + 5`, place 7. The pool is kept at `{ block: BLOCK, index: 3 }`, which is the list's position.
5. **Rows:** the list names the scripts at the launch's outputs 7 and 8. The pool is kept after a single `tx_info` that asked for no outputs.
6. **A pool the bundled head start holds** is never asked about.

**Part 3, the cost the fix would state.** All three passed on HEAD.

7. **21 new pools:** `tx_info` is asked with 20 hashes, then 1. The next list asks nothing.
8. **76 new pools whose launches didn't register L:** `tx_info` with 20, 20, 20 and 16 hashes, then `account_update_history` with 75 and 1 addresses. All 76 are kept.
9. **A pool Koios can't confirm:** one `tx_info` at each list (two after two lists). It is kept at the third list, and the fourth asks nothing.

**HEAD: 3 failed (all of Part 1), 6 passed.**

**Mutation check:** I copied the web wallet to `scratchpad/review/v-pr336-5-trace/`, symlinked the tree's `node_modules`, and copied in the two `seedelf-core` fixtures that `fakes.ts` reads. I replaced `lovejoin-pools.ts` with `473b7f1a^1`'s, from before #336.
- Part 1 passed, 3 of 3.
- Tests 4 and 6 passed.
- Tests 5, 7, 8 and 9 failed, as expected, because the old code asks Koios nothing.

So the paragraph describes the code from before #336 exactly. I deleted the scratch test and the copy, and `git status` shows nothing of mine.

## Why it's real, and why it's low

The paragraph exists to tell a reader how far mainnet trusts the data layer. On HEAD it gets two things wrong:
- **L's registration.** It says L's registration, half of "finished", is the server's word. Koios confirms it for every pool new to the device.
- **Koios's role.** It implies that mainnet discovery asks Koios nothing while the data layer answers, and that the ledger is the only check on a pool's existence. In fact, one `tx_info` per batch of new pools, plus `account_update_history` where needed, decides whether the device keeps the pool.

Rule 8 also applies: this is a new Koios cost on mainnet, and it appears in no *What each costs*.

It stays low because privacy.md and the policy are right, nothing ships from architecture.md, and no flow or amount is affected. That makes it a misleading doc.

## What the fix must keep (narrowing)

- **"Where its launch sits" is still the server's word.** Test 4 shows it. `launched()` builds the pool with Koios's block and index, but `confirmed()` returns the list's own entries (`:582-583`), and `shown()` orders the pools by that position.
- **Only half of "finished" moved to Koios.** L is now Koios's, but the scripts at the holder are not. `tx_info` is asked without outputs, so the script rows' places stay the server's word (test 5), and so does the reference row's datum (pr336 F1). Read the fix's "Koios confirms a new pool's launch and L" as: the launch transaction is on chain and spends the seed, and L is registered. "Its row" should be "its rows": the reference row and both script rows, plus its position.
- **This is pr336#0's ground (F1).** F1's fix may read the reference outpoints from Koios (`utxo_info`) and keep Koios's row and position. If it does, this paragraph must say so instead. Write both in one PR, once F1 is decided.
- **The ledger stays as the backstop.** A pool kept before 1.7.0 on the server's word is never checked again, because `confirmed()` skips anything `known`. A rollback after the confirmation is caught only by the ledger too. Say that Koios confirms a new pool first.
- **"New" means not held by the device.** The bundled head start's pools (test 6) and pools a 1.6.0 device already kept are never asked about.

## Corrections to the fix

- **The :737 numbers check out:**
  - one `tx_info` per 20 new pools' launches;
  - one `account_update_history` per 75 L's their launch didn't register;
  - once per pool per device;
  - again at each list while the pool is unconfirmed.

  "Each list" means at most every 5 minutes while the worker runs, plus a restarted worker's first pool read. F3 covers a device with no record yet. Add that none of this runs with Koios-only on or the data layer down: `refresh()` returns before it reads the list, and discovery then goes through the holder look.
- **One more stale copy:** `tests/lovejoin-discovery.test.ts:302-304` says "That the pool is on chain at all, the ledger checks (each deposit reads its reference UTxO), so this catches only a server that contradicts itself". #336 changed the last block of that same test to give Koios the launch, but left the comment.
- **`confirmed()`'s own doc comment** (`:557-558`, "as the holder's look would") overstates against a lying server, which is F1's point. Align it with F1's outcome.
- **Suggested comment wording:**
  - `:31-36`: Koios confirms a new pool's launch and L before it's kept (`confirmed`), and the ledger checks again at each deposit.
  - `:400-401`: "verified here again, and kept once Koios confirms a new one".
  - `:435-438`: point to `confirmed` below, and keep the ledger as the second check.
