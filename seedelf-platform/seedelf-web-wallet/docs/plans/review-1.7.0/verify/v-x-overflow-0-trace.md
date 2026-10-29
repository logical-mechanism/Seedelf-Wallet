# v-x-overflow-0-trace: x-overflow#0

**Verdict: confirmed, medium.** The finding holds on HEAD (`6bca8bec`) as described. Two side claims are off (below), and the owner may weigh the severity lower, since it needs the data layer to lie.

## The path, traced on HEAD

1. **The data layer's answer is checked for shape only.** `PrivateIndex.pools()` (private-index.ts:254-259) accepts any answer that passes `isPool` and `isRow` (164-181, 137-155). An asset entry only has to be three strings (148-152).
2. **Discovery verifies before anything else checks.** `PoolDiscovery.refresh` (lovejoin-pools.ts:404-455) builds each `PoolRef` with `utxoOf` (443), which copies the assets verbatim (private-index.ts:401-407). It verifies each pool (450 → 459) *before* #336's Koios check (`confirmed`, 454).
3. **The unchecked sum runs first.** `lovejoinVerifyPool` → `verify_pool` → `protocol_of` (wasm lovejoin.rs:628-633, 110-114). Its first step is `seedelf_core::eval::resolve_row(&pool.reference)?` (114); the script rows go through `resolve_reference` (166).
4. **#332 turned the wrap into a trap.** `resolve` (eval.rs:148-152) adds with `*tokens.entry(..).or_default().entry(..).or_default() += quantity;`, unchecked. Since #332 (Cargo.toml:51-52), seedelf-core has `overflow-checks = true` in `wasm-release`, so a sum past `u64` panics and the module hits `unreachable`. The built `wasm/pkg` (15:57 today, on HEAD) carries the overflow panic strings.
5. **The trap reaches a lock.** `tried` (lovejoin-pools.ts:246-253), `serviceDeps.pools` (597-601) and `readSet`'s `kept` (lovejoin.ts:2705-2708) all pass it on. `answerUi` (sw.ts:375-381) and `runNetworks` (runs.ts:56-61) then call `wallet.trapped()`, which locks the wallet.
6. **It repeats.**
   - `refresh` sets `answered` (432) before the loop that traps.
   - The early return at 411-415 holds only when the device's record has `listed`. Only `keep` (454) writes that, and the trap stops refresh before it.
   - Mainnet's head start has 0 pools, so `known()` writes nothing either.
   - So a new or restored mainnet device asks again at every pool read, and traps again each time. A device that kept a list before traps once per `REFRESH_MS` (5 min), or once per worker restart.
   - What reads pools with a refresh: the Lovejoin page's `status` (via `ours`), `lookForPools` (the page opening), `poolsOf(.., quiet=false)` (a review's token pool), and the unlock or alarm run's `withdrawDueNow` (6195) when something is open in Lovejoin.

## Scratch tests (both deleted)

**Core, `seedelf-core/tests/zz_review_v_x_overflow_0_trace_1.rs`** (debug build, overflow checks on, as in the module):

| Call | Result |
|---|---|
| `resolve_row`, the NFT once | `Ok` (control) |
| `resolve_row`, the NFT as 1 + 1 | `Ok` (control) |
| `resolve_row`, the NFT as (2^64−1) + 2 | `panicked at seedelf-core/src/eval.rs:148:9: attempt to add with overflow` |
| `resolve_reference`, same row | the same panic |
| `utxos::assets_of`, same row | `Err(Can't Add Assets: Can't Add Asset To Assets: Asset addition overflow)` |

Two of three tests failed, both on the panic.

**Extension, `extension/tests/zz-review-v-x-overflow-0-trace-1.test.ts`** (the real module through `loadTestWasm`, `freshWasm()` after each trap). Seven of ten tests failed on HEAD, every failure the trap. The three controls passed.

Calling `lovejoinVerifyPool` directly with the preprod pool fixture:

| Reference row | Result |
|---|---|
| NFT once | `ok: c5852bb7…` |
| NFT as 1 + 1 | `refused: Error: It doesn't hold one Lovejoin NFT and ADA alone` |
| NFT as (2^64−1) + 2, preprod | `TRAP: RuntimeError: unreachable` |
| NFT as (2^64−1) + 2, mainnet | `TRAP: RuntimeError: unreachable` |

Through `PoolDiscovery` over `fakeIndex`, the real `privateIndexClient` and a stub `koiosAlone`:

- **Honest list:** the pool is kept (control).
- **Lying list, mainnet, new device:** `refresh`, `serviceDeps(..).pools` and `look` each give `TRAP: RuntimeError: unreachable` (`isTrap` true).
- **Three pool reads in a row** (`freshWasm()` between them): each traps. The data layer is asked each time (`asked=1, 2, 3`) and `listed` stays `undefined`.
- **Device that kept a list (preprod):**
  - after `REFRESH_MS`: trap, asked=2;
  - within `REFRESH_MS`: ok, not asked;
  - after another `REFRESH_MS`: trap, asked=3;
  - the pool kept before stays known throughout.

## Where the finding is narrower or off

1. **The trigger is a data layer that lies, nothing else.** That means a compromised server or a MITM. An honest data layer can't produce this row, even with a bug:
   - Its assets come from db-sync's `ma_tx_out`, one list per output (seedelf-data `api/src/lovejoin/db.rs:281-284`).
   - Its own rule requires the reference's NFT at quantity "1" (`standard.rs:201`).
   - So a duplicated reference row would read 1 + 1, which the wallet refuses in words.

   This is still inside the wallet's stated threat model. lovejoin-pools.ts:31-33 says the data layer "can leave a pool out, never pass off other scripts as a pool's", and #336 added a Koios check so that "the check is one no single operator answers". Here the data layer can do more than leave a pool out.
2. **"A swap review's room read" doesn't lock; it swallows the trap.**
   - The review prices first: `priced` (sessions.ts:1618) → `room()` → `rooms()` → `splitAll` → `readSet` → refresh. `tokenPool` (1621) comes after.
   - `rooms()` ends in a bare `catch { return undefined; }` (lovejoin.ts:3259-3261, from 2026-09-27, before this range).
   - On a device that kept a list, the next refreshes within `REFRESH_MS` don't ask the data layer again. So the review carries on, unlocked, on the instance that trapped. That is the state #330 closed for `unawaited`.
   - This is separate and older, but this input reaches it. It is worth its own finding: the catch should be `catch (e) { if (isTrap(e)) throw e; return undefined; }`.
3. **"The only unchecked token sum left in core on rows from outside" isn't exact.**
   - `build.rs` `quantity_in` (2933-2939) adds up one row's entries for a token with `.sum()`. That is the same class: with core's overflow checks on, it traps the same way.
   - `holding` adds up across the picked rows with `.sum()` (2950). Its loop below saturates (2961).
   - I didn't trace whether a checked pass (`assets_of`) refuses those rows first.
4. **"Before #332 … the pool verified":** the arithmetic is right (`u64::MAX` wrapping-add 2 is 1, so the map holds the NFT once). I didn't rebuild the module to check it.

## Severity

**Medium, as given.**

- **The harm:**
  - On a new or restored mainnet device, the wallet locks each time Lovejoin opens.
  - On a device that kept a list, it locks at Lovejoin's status, a token review, or the unlock run's pool read, once every five minutes or worker restart.
  - This lasts until the user finds Settings' Koios-only.
- No money moves.
- The precondition, the owner's own server lying, is why this isn't high. The owner may call it low.

## Fix advice

- **Agree with the finding's fix.** Use `checked_add` in `resolve()` and return an `Err` in words. `protocol_of` then fails, and `tried` leaves the pool out.
  - This covers every `resolve_row` and `resolve_reference` caller: candidate, launch check, verify, `measure_locally`.
  - It isn't a guard on the user: no output on the ledger can hold more than `u64` of a token.
- **Also** make `quantity_in`'s and `holding`'s `.sum()` (build.rs:2939, 2950) checked or saturating folds.
- **Tests for the fix:**
  - core: `resolve_row` on a row naming one token twice (2^64−1 and 2) returns `Err`.
  - extension: the scratch test's `discovery()` harness (`fakeIndex`, the real `privateIndexClient`, a stub `koiosAlone`). Over the lying list, refresh should resolve, keep no pool, and never trap.
- **Separately:** `rooms()`'s bare catch (lovejoin.ts:3259).
