# v-pr329-4-trace: pr329#4, traced on HEAD (`6bca8bec`)

**Verdict: confirmed. Severity: low (docs).** The proposed fix overstates what #336 checks: see *Fix advice*. **This duplicates pr336's F6** (`reports/pr336.md:111`), which is the wider finding: it also covers `architecture.md:737` and the module's comments. Merge the two into F6.

## What I traced

- **`refresh()`:** `lovejoin-pools.ts:454` reads `await this.keep(network, await this.confirmed(network, found));`.
- **`confirmed()`** (`:565-588`): it passes a pool the device holds already (`known`). A new one goes to `launched()` (`:522-555`), the method the holder look uses (`:510`). It keeps only the pools `launched()` calls standard, matched by `id:ref`, and returns the **server's** `FoundPool`s (`:587`).
- **`launched()`** asks Koios's `tx_info` (`koios.ts:926-950`, `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`: "nothing of its outputs"). Then `lovejoinLaunchCheck` (`wasm/src/lovejoin.rs:705`, `find_seed` among Koios's inputs) runs, and `account_update_history` (`firstRegistrations`) is asked for an L its launch didn't register.
- **The doc:** `architecture.md:732` still says, verbatim:
  - "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below)";
  - "Whether a pool is on chain at all is the ledger's to judge, not the server's: … one a list names may never have been launched";
  - "Koios's look works those out itself, from the launch's own transaction (`tx_info`) and … (`account_update_history`)".
- **History:** `git blame` puts line 732 at `677715db` (1.6.0's round 3c), an ancestor of `babb8e76`. No commit in `babb8e76..6bca8bec` touched it. #336's diff stat has no `architecture.md`.

## Repro

`extension/tests/zz-review-v-pr329-4-trace-1.test.ts` (deleted), built from `lovejoin-discovery.test.ts`'s fixtures. Each "doc:" test asserts what line 732 says; each "still:" test is a control.

**On HEAD: 3 failed, 4 passed.**

- ✗ doc: a listed pool that Koios has no launch for is kept. Got `[]`.
- ✗ doc: a listed pool whose L nobody registered is kept. Got `[]`.
- ✗ doc: the data layer's path asks Koios nothing for a new pool. Got `["tx_info", "account_update_history"]`.
- ✓ still: where the launch sits is the server's word. With Koios answering block+7, place 9, the pool is kept at the server's `{block: BLOCK, index: 3}`.
- ✓ still: `tx_info`'s `select` has no `outputs`.
- ✓ still: the launch's outputs are the server's word. With the server naming outputs `#7`, `#8` and `#9` of the real launch, the pool is kept after one `tx_info`.
- ✓ still: nothing checks a kept pool again. Once Koios forgets the launch (a rollback), the pool stays, and Koios has been asked one `tx_info` in all.

**Against #336 reverted** (a copy in the scratchpad with `keep(network, found)`): the three "doc:" tests **pass**. The two Koios-call controls fail there, because no Koios request is made at all. So line 732 described the code exactly until #336, and went stale with it.

## What's right in the finding, and what's off

**Right:**
- **The claim:** since #336, a new pool on the list is kept only once `confirmed()` → `launched()` finds its launch in Koios's `tx_info`, with L registered by that launch or an earlier block.
- **The scenario:** a never-launched or L-less pool is no longer kept, and Koios is asked about it. `privacy.md:200` and the policy's 28 October entry say so.

**Off: its fix overstates what #336 checks.** "Being finished and being on chain are then checked" isn't quite so.
- **Being finished:** only L's half is checked. The doc defines "finished" as the launch putting `mix_box` and `mix_logic` at the holder **and** registering L. On this path, the scripts' rows and the reference row (datum, NFT, address) are still the server's, because `tx_info` is read without outputs. That is pr336's F1, whose harm case depends on exactly this.
- **Being on chain:** what's checked is the launch transaction, once, when the device first sees the pool. A rollback after that isn't caught. The `deposit_across`/`BadInputsUTxO` sentence is still the backstop for both gaps, so it should stay, as the backstop rather than the only judge.
- **"Where its launch sits":** the claim's first bullet counts this among what's "no longer so", but it is still the server's word. The fix itself gets this right.

**Beyond line 732, the same staleness** (all in pr336's F6):
- `lovejoin-pools.ts:31-35`: "so the ledger is the judge of that".
- `:435-438`: "That the pool is on chain at all, the ledger checks".
- `architecture.md:737`: *What each costs* has no line for the confirmation's Koios cost (rule 8).

**Item 5's tick:** item 5 is still ⬜ (`post-release-roadmap.md:39`). Its *Kept in mind* entries (`:379-380`) still describe the plan (`utxo_info`, a batched `account_info`), not what #336 built. That is pr336's F8.

## Fix advice

In the release-prep docs commit, rewrite line 732's sentence along these lines:

> From the data layer's list, a pool new to the device is kept only once Koios's chain data confirms it, as the holder's look does (`confirmed` → `launched`, 1.7.0): the launch transaction known and spending the seed (`tx_info`, inputs and certificates, no outputs), and L registered by it or an earlier block (`account_update_history`). Its rows at the holder (the reference datum, the scripts) and where its launch sits, which the earliest is worked out from, stay the server's word. The ledger still refuses a deposit into a pool whose reference UTxO isn't on chain (`deposit_across`, `BadInputsUTxO`), as it does for one whose launch rolled back after the check. Nothing checks a kept pool, or its L, again (`usableNow`'s `registered: true`).

In the same commit:
- Fix the two comments at `lovejoin-pools.ts:31-35` and `:435-438`.
- Add the Koios cost to `architecture.md:737` (F6's figures).
- Tick item 5, and rewrite `:379-380` to say what was built (F8).

If F1's fix lands (Koios's own rows via `utxo_info`), drop "its rows … stay the server's word".
