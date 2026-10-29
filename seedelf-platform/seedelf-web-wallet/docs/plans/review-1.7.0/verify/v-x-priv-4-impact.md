# v-x-priv-4-impact: impact and fix of x-priv#4

**Verdict: confirmed, low** (the finding's own severity). It's a docs and comments finding, so the "user" who meets it is a maintainer. The stale text states which facts are the server's word, and that statement no longer matches the code. The proposed fix is right in substance and needs three corrections, below. The fix touches docs and comments only, so it breaks no test and changes no behaviour.

## What's stale on HEAD (6bca8bec)

#336 (`git diff 473b7f1a^1 473b7f1a --stat`) changed `privacy.md`, `store/privacy-policy.md`, `lovejoin-pools.ts` and two tests. It didn't touch `architecture.md`. #337 changed one line of architecture.md, but not the cited text. All four quotes in the finding match HEAD:

- **`docs/architecture.md:732`:** "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's: … Koios's look works those out itself".
  - That text is the 1.6.0 review's docs-small#1 fix. That finding asked architecture.md to say "on mainnet 'finished' and 'earliest' are the server's word".
  - #336 closed the "finished" half for any pool new to the device. The doc still describes the gap as open.
  - "Koios's look works those out itself" implies the data layer's path asks Koios nothing. Since #336 it does.
- **`docs/architecture.md:287`:** "`lovejoin/pools` is the shown pools' list (`lovejoin-pools.ts`)." The Chain data section doesn't say that this path now asks Koios with the data layer up.
  - The Lovejoin *What each costs* paragraph (:737) doesn't cover discovery at all. So no part of architecture.md gives the confirm's Koios cost (rule 8).
- **`lovejoin-pools.ts:33-35`** (file header): "so the ledger is the judge of that".
- **`lovejoin-pools.ts:436-438`:** "That the pool is on chain at all, the ledger checks". This sits 16 lines above `await this.keep(network, await this.confirmed(network, found))` (:454). The comment contradicts the call under it.
- **Not in the finding, same wording:** `extension/tests/lovejoin-discovery.test.ts:302-304`: "That the pool is on chain at all, the ledger checks (each deposit reads its reference UTxO), so this catches only a server that contradicts itself."
- **Adjacent, probably another reviewer's** (also matches the owner's relayed note that #338 only touched item 8):
  - `docs/post-release-roadmap.md:39` still marks item 5 ⬜.
  - Its Kept-in-mind entries still describe the gap as open, with a design #336 didn't build:
    - :379, pool-exists: "one `utxo_info` per newly listed pool".
    - :380, docs-small#1: "the wallet takes its word that L is registered. One batched `account_info`…".

## Reachability and severity

- The confirm never runs on the store build's defaults with no mainnet token pool.
  - `src/lovejoin-pools.json` has 0 mainnet pools at height 14110720. The data layer's list is then empty, so `confirmed` returns early (`if (!fresh.length) return found;`, :569) and asks Koios nothing.
  - It runs on mainnet only, with the data layer answering, once someone launches a token pool there.
  - Preprod and Koios-only never reach `refresh`'s list, so they never reach the confirm.
- The privacy policy and privacy.md are right, so no user is misled. Only a maintainer is.
- Brief scale: "low: … a misleading doc".
  - Not nit: the doc misstates the trust model (what the server is trusted for) and leaves a mainnet Koios request out of the docs.
  - Not medium: nothing a user does or sees changes.

## Checks run (scratch test, deleted)

`tests/zz-review-v-x-priv-4-impact-1.test.ts`, run alone, with the real WebAssembly and the suite's fakes. 3/3 pass.

- **A.** Koios answers but doesn't confirm (L registered 60 s after its launch). Three refreshes, `REFRESH_MS` apart, called `["tx_info","account_update_history","tx_info","account_update_history","tx_info","account_update_history"]`. **A pool is asked about again at every list until Koios confirms it, not "until Koios answers".**
- **B.** The list gave launch `{block: BLOCK+500, index: 9}` and Koios gave `{BLOCK, 3}`. The pool was kept with `{"block":5279706,"index":9}`, the list's own. **The finding is right:** where its launch sits stays the server's word, because `confirmed` returns the list's own `FoundPool`s (:583) and uses `launched()`'s result only as an `id:ref` key set.
- **C.** The list put the reference row at `LAUNCH#7`; the real one is `#0`. It was still kept, with `tx_index` 7.
  - The one `tx_info` was `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates` (`koios.ts:926-945`), with `_assets:false`.
  - **On the data layer's path, Koios confirms the launch transaction, not the reference row:** the transaction is on chain, the seed is among its inputs (`find_seed`, `wasm/src/lovejoin.rs:705`), and L is registered by it or by an earlier block.
  - That the row is at the holder holding the NFT stays the server's word there. The holder look differs: it reads the row itself from Koios (`credential_utxos([HOLDER])`, :488).
- **Batch sizes in the proposed cost, verified:**
  - `launches` takes `TXS_PER_REQUEST = 20` (koios.ts:448) distinct launch transactions a request (`new Set(...)`, :527).
  - `firstRegistrations` takes `CREDENTIALS_PER_REQUEST = 75` (koios.ts:442), only for the Ls a launch didn't register (:550-551).
  - Both go through `koiosAlone()` (:570).

## The fix, corrected

Keep the finding's fix with three changes:

1. **"until Koios answers" → "until Koios confirms it".**
   - An unconfirmed pool is asked about at each list: at most every 5 minutes at a pool read (`REFRESH_MS`), and again at a restarted worker's first pool read, since the throttle lives in memory.
   - That holds while the list names it and Koios doesn't confirm it: a launch Koios doesn't know yet, L registered late, Koios down, or a list that disagrees with Koios.
   - It costs nothing for a pool already on the device, whether from the bundled head start (`kept()` merges it, :349-352) or kept before.
2. **Don't replace the ledger sentence; add the Koios confirm beside it.**
   - Check C shows the confirm doesn't read the reference row. Rewording :732, :33-35 or :436-438 to "Koios confirms the pool is on chain" would overstate it.
   - Say exactly what's asked and what it establishes: "its launch's `tx_info` (on chain, its seed among the inputs, L registered by it) and, where it didn't register L, `account_update_history` (an earlier block)".
   - Keep "every deposit into a token pool reads its reference UTxO" as what checks the row itself.
3. **Cover the third stale comment.** Update lovejoin-discovery.test.ts:302-304 with the two the finding names.

Where each part goes (smallest edit):

- **:732:**
  - Drop "that it's finished" from the server's-word clause and keep "where its launch sits … are the server's word".
  - Change "Koios's look works those out itself" to say both paths ask Koios: the holder look for every candidate, the data layer's path for a pool new to the device (`confirmed` → `launched`).
- **:287:** add a one-clause pointer, for example: "…a pool on it new to the device confirmed with Koios first (below), with the data layer up".
- **The cost:** put it in the Lovejoin *What each costs* (:737) or in :732: "a `tx_info` per 20 new launches and an `account_update_history` per 75 Ls their launches didn't register, at each list until Koios confirms them; nothing for a pool already kept".
- **The two source comments** (:33-35 and :436-438) are comments only. Writing to `src/` is the fixer's job, not this review's.
- **Rule 7:** don't add "mainnet has no token pools today" to the doc; that's chain state that will change.
- **Owner's rules:** no new guard or refusal, no UI text, no i18n key, and no privacy note dropped. The policy entry #336 added stays as it is.
- **What the fix could break:** no test reads architecture.md or the comments (`grep architecture.md extension/tests extension/scripts`: none; `words.test.ts` doesn't scan docs). It changes no behaviour.

## Beyond this finding, for the lead (my observation, not x-priv#4's claim)

Check C bears on whether #336 closes pool-exists against "a server that lied", the threat its own docstring names (:557-563). Two pieces of wording overstate the check:

- `confirmed`'s docstring says "as the holder's look would".
- privacy.md:200 says "(`tx_info`, so it's on chain and makes that pool)".

The check proves the launch transaction spent the seed. It doesn't prove that transaction minted the NFT or put the listed row at the holder.

Core's own comment (`seedelf-core/src/lovejoin/mod.rs:298-307`) says every mix and withdraw reads the pool's reference UTxO, and the deposit reads it only so that "the ledger refuse[s] such a deposit". A deposit runs no Lovejoin script, so the ledger refuses one only when the named out-ref doesn't exist.

A server operator can still fake a pool:

- Spend a seed in a transaction that registers L, with the legacy registration certificate (no witness, about 2 ₳).
- List a fabricated row at one of that transaction's own unspent outputs.

That passes `confirmed`, and a deposit into it would land. Whether those boxes are then locked for good depends on Lovejoin's token `mix_box` needing the NFT's reference. Core's comment says it does; I didn't read the 8131b1d contracts, since the local checkout is cb5a5a3.

This needs a lying or compromised data layer and a deliberate on-chain transaction, and it was worse before #336, which raised the cost from nothing. Confidence is medium. The likely class is low or owner-call. The 1.6.0 review's planned `utxo_info` on the listed reference row would close it, which is within item 5's own scope ("confirmed on chain"). It's the owner's call whether that's worth a request.

## Confidence

High on the verdict and severity (direct reads, plus checks A to C). High on corrections 1 and 2 (checks A and C). Medium on the side note's consequences (the contract's reliance on the NFT reference is taken from core's comment).
