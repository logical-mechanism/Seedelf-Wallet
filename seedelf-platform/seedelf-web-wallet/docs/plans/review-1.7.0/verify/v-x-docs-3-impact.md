# v-x-docs-3-impact: x-docs#3, `architecture.md:732` after #336

**Verdict: confirmed, low.** The doc is stale. The finding's fix is right in direction, but its wording overclaims, and it leaves in a sentence about the ledger that doesn't hold against a lying server.

## Is it real

- Line 732 is untouched in this range (blame: `677715db`, 1.6.0's round 3c). That round wrote it for 1.6.0's `docs-small#1`, whose suggested fix was "say that on mainnet 'finished' and 'earliest' are the server's word".
- #336 (`473b7f1a`) closed half of that gap in code:
  - `refresh` → `confirmed()` → `launched()`, at `lovejoin-pools.ts:454` and `:565-584`.
  - It edited `privacy.md` and the policy, but not `architecture.md`. #337 touched only `architecture.md:633`.
- On HEAD the line still says "that it's finished, and where its launch sits … are the server's word" and "Whether a pool is on chain at all is the ledger's to judge, not the server's". It then sets Koios's look apart ("Koios's look works those out itself…"), as if the data layer's path didn't.
- The policy's 28 October entry says the opposite: "Before, the wallet took our server's word that such a pool was on the blockchain and finished."

## Severity: low

- It's a design doc, with no runtime effect. The user-facing texts (policy, `privacy.md:200`) match the code.
- The error mostly understates a check. A reader would re-propose #336 or misjudge the threat model.
- It's the same defect as **pr329 #5** and **pr336 F6**. F6 is the superset: it also covers `:737` and the module's comments. Merge them into one.

## What the fix must say differently

### 1. "Only where the launch sits … is still the server's word" overclaims

The rows stay the server's too:
- `koios.ts:923` says `launches()` reads "nothing of its outputs". At `:939-942` it sends `_scripts: false`, and its select has no outputs.
- `confirmed()` runs `launched()` on the server's rows (`:576`) and keeps the server's `found` entries (`:582-583`). It throws away the pool `launched()` built with Koios's block and index (`:542`).
- A script row named by hash alone counts as being at the holder (`wasm/src/lovejoin.rs:145-163`).

A scratch test, `tests/zz-review-v-x-docs-3-impact-1.test.ts`, with the real WebAssembly and run alone (3/3 passed, since deleted), showed three things:
- **The finding's core holds:** a listed pool whose launch Koios doesn't know isn't kept, and the only request is one `tx_info`.
- **The position is the list's:** the server said block 1, index 0, and Koios said `BLOCK`, index 3. The pool was kept at `{ block: 1, index: 0 }`.
- **The script rows are the list's:** rows at `#7`/`#8`, which the launch never made, were kept with `scriptsInline` 0. Koios got only `tx_info`, with `_scripts: false`.

### 2. The ledger sentence has to change, not stay

The doc says "the ledger refuses one into a pool that isn't on chain (`BadInputsUTxO`…) rather than lock its boxes for good".

- That holds only when the named reference outpoint doesn't exist. A launch rolled back is that case.
- A deposit runs no script (`deposit_across` only reads the reference UTxO), so the ledger never checks what that UTxO holds.
- In Lovejoin 8131b1d:
  - `mix_logic` calls `read_reference_datum` before both its Owner and Mix branches (`validators/mix_logic.ak:46-60`).
  - `read_reference_datum` needs exactly one reference input holding the NFT (`lib/lovejoin/reference.ak:29-41`).
  - `one_shot_mint` "can never fire again" once its seed is spent (`validators/one_shot_mint.ak:15`).
- So the server can name an existing output of a transaction that spent the seed and minted nothing. A deposit into that "pool" lands, and its boxes can't ever move.
- After #336 this needs that transaction on chain, and L registered before it (cert 0, which anyone can send). That's narrower than before, but "rather than lock its boxes for good" is false against a lying server.

### Suggested wording

This replaces line 732 from "that it's finished, …" through "…(`account_update_history`).":

> A pool on the list that's new to the device is kept only once Koios confirms it (`confirmed` → `launched`, Koios even while the data layer answers): its launch transaction on chain, spending the seed (`tx_info`), and L registered by it or an earlier block (`account_update_history`). One Koios can't confirm yet, or a Koios that can't answer, waits for the next list, and a pool kept isn't asked about again (1.6.0's release review, pool-exists, docs-small#1; 1.7.0). The rows it names at the holder (the reference row's datum and NFT, the two script rows) and where its launch sits, which the earliest is worked out from, stay the server's word: `tx_info` is read without outputs. The ledger refuses a deposit whose reference UTxO isn't on chain (`BadInputsUTxO`, which stops the chain), such as a launch rolled back after the check, which stays kept; it doesn't check what that UTxO holds, since a deposit runs no script. Koios's look reads the rows from the holder itself.

### The same edit elsewhere

- **The module's comments:** `lovejoin-pools.ts:31-36` ("the ledger is the judge of that") and `:435-438` ("That the pool is on chain at all, the ledger checks").
- **`confirmed()`'s doc comment** says "as the holder's look would". It doesn't: the holder's look reads the rows from Koios.
- **`privacy.md:200`** says "(`tx_info`, so it's on chain and makes that pool)". `tx_info` shows the transaction spent the seed, not that it made the pool.
- **Optional, `:737`** (*What each costs*), per pr336 F6: one `tx_info` per 20 new pools, and one `account_update_history` per 75 L's (`TXS_PER_REQUEST`, `CREDENTIALS_PER_REQUEST`).
- **Item 5's tick in the roadmap** should say it closes a launch that isn't on chain and an L that isn't registered, as first seen. It doesn't close the rows.

### Against the owner's rules

- It's a docs and comments change only: nothing at runtime changes or breaks.
- It adds no guard.
- No privacy note goes: this paragraph has none, and the pool check's privacy text is in `privacy.md` and the policy already.
- No dates, and no UI text.

## For the lead, beyond this finding: weigh with pr336 F1

pr336 F1 (the row and position stay the server's) rated the harm medium: lying about box ADA means boxes "come back only by hand".

A never-minted variant makes it a lock for good:
1. A compromised data layer registers L (cert 0, about 2 ₳).
2. It then spends seed S in a transaction T that mints nothing.
3. It lists a "pool" whose reference row is any output of T, placed earliest of its values. A real pool of those values becomes a copy (superseded).
4. #336's check passes: T is on chain, S is among T's inputs, and L was registered before T.

Then two deposits land, and neither can ever come back:
- **A Bootstrap's deposit:** no script, no measure.
- **A session's collateral deposit, if this pool is the 5 ₳ one:** that deposit is sent before its mix is evaluated (`architecture.md:737`).

Nothing reads a kept pool's reference row from chain before a deposit: the only `utxoInfo` calls in `lovejoin.ts`/`sessions.ts` are DEX orders and a maybe-sent check.

F1's fix, `utxo_info` of the fresh reference outpoints with `launched()` run on Koios's rows, closes this too: `candidate()` finds no NFT, so the pool isn't kept.

**Confidence:** medium. This is from reading the wallet and the pinned contracts, not run on a chain. Whether a compromised data layer is in the threat model to fix against is the owner's call. Item 5's own words ("a lying server") suggest it is.

## Confidence on x-docs#3

High that the doc is stale, and high on what stays the server's word (tested). Severity low.
