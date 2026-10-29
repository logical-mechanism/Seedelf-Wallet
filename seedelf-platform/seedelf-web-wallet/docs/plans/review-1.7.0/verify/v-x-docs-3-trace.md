# v-x-docs-3-trace: x-docs#3 checked against the code

**Verdict: confirmed, low.** One correction: the finding says too little stays the server's word (see *Correction*).

## The finding

architecture.md:732 still gives the 1.6.0 trust model for the data layer's pool list. It says two things:

- being finished is the server's word;
- being on chain is the ledger's alone to judge.

But #336 now checks a pool the list names that is new to the device through Koios before keeping it.

## What I traced on HEAD (6bca8bec)

1. **The doc line hasn't changed since 1.6.0.** `git blame` gives 677715db for line 732 (1.6.0's round 3c). That commit was the doc fix for docs-small#1, which asked the doc to say "finished" and "earliest" were the server's word.
   - #336 (f40ed2fc) changed only these files: `privacy.md`, `store/privacy-policy.md`, `lovejoin-pools.ts` and two tests.
   - In `git diff babb8e76 HEAD -- docs/architecture.md`, line 732 appears only as unchanged context. #330, #333, #335 and #337 changed other lines of the file, and #338 changed only `post-release-roadmap.md`.
2. **The code path.**
   - `refresh` now keeps only what `confirmed` returns: `lovejoin-pools.ts:454 await this.keep(network, await this.confirmed(network, found));`
   - `confirmed` (`:565-584`) splits the list's pools:
     - `known` is the pools on the device already: the bundled head start plus those kept before. The head start is written by the same Koios look (`tests/lovejoin-pools-head-start.test.ts`).
     - Each `fresh` pool goes through `launched()` on `koiosAlone()`. On mainnet that is plain Koios (`data-layer.ts:223`).
     - If Koios throws, nothing new is kept (`standard = []`).
   - `launched()` (`:522-554`) does three things:
     - a launch Koios doesn't know goes to `unknown` and is not kept (`:532-535`);
     - `lovejoinLaunchCheck` looks for the seed among the inputs Koios returns (`wasm/src/lovejoin.rs:705` `find_seed`);
     - L must be registered, either by one of the launch's certificates or by an earlier `account_update_history` registration (`:544-552`).
3. **What is still the list's word.**
   - **Where the launch sits.** `confirmed` returns the list's own `FoundPool` (`:583 return found.filter((p) => known.has(...) || ok.has(...))`), whose `launch` the list set (`:450 { block: p.launch.block, index: p.launch.index, tx: p.launch.tx }`). Koios's block and index go only into a throwaway object used for `ok`. `earlier()` (`:153`) orders pools by that `launch`, so which pool counts as earliest is the server's word.
   - **The launch's outputs at the holder.** `koios.launches` asks for "nothing of its outputs, tokens or metadata" (`koios.ts:923`), with `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates` (`koios.ts:942`). `launched()` gets `scripts: p.ref.scripts`, the list's rows named by hash (`:576`, built at `:445-448`). So the reference row's place and datum, and whether the launch put `mix_box` and `mix_logic` at the holder, are never checked against Koios on this path. That is the half of "finished" that architecture.md:732 defines as "puts `mix_box` and `mix_logic` at the holder".
   - **A rollback after the check.** A known pool is never asked about again (`:568-569`).

## Scratch test (deleted)

The file was `extension/tests/zz-review-v-x-docs-3-trace-1.test.ts`. It used the same fakes as `lovejoin-discovery.test.ts`, the real WebAssembly, and preprod's PR #163 pool fixture.

Part 1 asserts the doc as written. On HEAD, **both cases failed**:

- "on chain is the ledger's to judge": Koios has no launch for the listed pool, and the test expects it kept. Received `[]`.
- "finished is the server's word": the launch registers nothing and L has no registration, and the test expects it kept. Received `[]`.

Part 2 checks what stays the list's word. On HEAD, **all three cases passed**:

- The list says block 7, index 0, while Koios says BLOCK, index 3. The kept pool's `launch` is `{block: 7, index: 0}`.
- The list gives a reference row at `#9` and script rows at `#7` and `#8`, indexes I made up within the launch's transaction. The pool is kept with exactly those rows. The one `tx_info` call selects no outputs, and nothing calls `utxo_info`.
- The pool is kept, its launch is then "rolled back" (Koios stops returning it), and it is still kept, with one `tx_info` call in all.

**Mutation check.** I ran the same test on a copy outside the tree with `confirmed()` returning `found`, which is the pre-#336 behaviour:

- **Part 1 passed.** So line 732 describes the code before #336 exactly.
- The "launch sits" case passed.
- The other two Part 2 cases failed only on their Koios call counts, because without #336 Koios isn't asked at all.

## Correction to the finding

The finding says "Only where the launch sits, and so which pool is earliest, is still the server's word". That leaves something out. The launch's outputs at the holder are still the list's word too: the reference row's place and datum, and the two script rows. So the doc's "that it's finished … the server's word" is only half stale:

- whether the launch registered L is now checked through Koios;
- whether the launch put both scripts at the holder is still the server's word.

## Fix advice

Rewrite the sentence that starts "From the data layer's list, the wallet checks each pool is genuine…" and the "Whether a pool is on chain at all…" part that follows it. The new text should say:

- **What Koios confirms.** A pool on the list that is new to the device is confirmed through Koios (`confirmed` → `launched`) before it is kept. Koios finds its launch on chain, spending the pool's seed (`tx_info`, inputs and certificates). It also finds L registered, by that launch or an earlier block (`account_update_history`).
  - A pool Koios can't confirm yet, or a Koios that can't answer, waits for the next list.
- **What stays the server's word.** Two things:
  - the launch's outputs at the holder, which are the reference row and both script rows (`tx_info` reads none of its outputs);
  - where the launch sits, which decides the earliest pool.
- **What the ledger still judges.** A pool once kept is never checked again, so a launch rolled back after the check stays kept. The ledger still refuses a deposit into a pool that isn't on chain (`BadInputsUTxO`).
- **The Koios look.** "Koios's look works those out itself" should say both paths share these checks (`launched`). Only the Koios look also reads the scripts' rows from the holder.

Fix two code comments the same way in the same change:

- the file header, `lovejoin-pools.ts:31-35` ("so the ledger is the judge of that");
- `refresh`, `:435-438` ("That the pool is on chain at all, the ledger checks").

privacy.md:200, which #336 updated, already describes the check correctly. Copy its wording.

Note: the roadmap item (`post-release-roadmap.md:379`) planned "one `utxo_info` per newly listed pool", which would have read the outputs too. #336 used `tx_info` without outputs instead, so the doc has to keep the outputs caveat. If wanted, whether to confirm the outputs as well is for the owner to decide.
