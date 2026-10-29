# Pools lane: report

Tree: `W = /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`. Paths below are under
`W/seedelf-platform/seedelf-web-wallet/extension/` unless they start with `docs/`.

## What changed in the code

#336's Koios check is kept, and its privacy design with it. It still runs only for pools new to the device, names only
pools every wallet reads, and goes to Koios, never to our server. Four things change:

1. **The check no longer holds pool reads** (pr336#1, x-priv#2). `refresh()` starts it and returns, with at most one
   check per network at a time. `confirm()` keeps what the check confirms when it ends.
   - Pool reads (`serviceDeps.pools`) go on with the pools kept before, so an unconfirmed pool is never shown.
   - `look()` waits for the check: the Lovejoin page's look (R10's `grew`) and a pool's start (`build` calls `look`).
2. **The list is kept with `listed` at once** (pr336#2). `refresh()` calls `await this.keep(network, [])` before
   starting the check, so the throttle's exception for a record with no `listed` holds again.
3. **The check reads the pool's rows from Koios** (pr336#0).
   - `confirmed()` reads the new pools' reference UTxO and both script outpoints from Koios (`koios.utxoInfo`, rows at
     the holder only).
   - It runs `launched()` on Koios's rows and keeps `launched()`'s pools. So the datum, the scripts' places and the
     launch's block and index all come from Koios, never from the list.
   - This adds one `utxo_info` request per 20 new pools (3 outpoints a pool, 60 a request).
4. **A trap under the check locks the wallet** (pr336#4, x-mut-ts#0). No request waits for the check, so it locks the
   wallet itself, through a new required dep `wallet: { trapped }`. `sw.ts` wires the worker's `wallet`.
   `confirmed()` still rethrows a trap.

**The launch's copy check** (x-merge#0, `src/background/lovejoin-launch.ts` `build`) now reads
`discovery.lastListed(network)` beside `known()`.
- `lastListed` is the data layer's last list, verified offline, held in worker memory. Each answer replaces it, and it
  is never cleared: clearing it while the data layer is down would reopen the gap for five minutes, since `look()`
  skips the holder then.
- It's never handed to a pool read, and `terms()` is unchanged: `terms().pools` is read by no screen (the form uses
  `status.pools`), and the brief says never to show an unconfirmed pool.
- The `discovery` type in `LaunchDeps` takes `lastListed` as optional, so the stubs in `fakes.ts`,
  `lovejoin-flows.test.ts` and `lovejoin-planner.test.ts` (other lanes' files) compile unchanged.

## Findings

### x-merge#0: **fixed**
- **Test** (failed before, passes now): `tests/lovejoin-merged-review.test.ts` › "a start of the values of a pool the
  data layer lists, before Koios confirms it (1.7.0's release review, x-merge#0)" › "is refused as a copy, though the
  pool isn't read or offered to join till Koios confirms it".
  - It uses a real `PoolDiscovery`, with the data layer listing the pool and Koios not confirming it.
  - Before, the build got past the copy check and failed at the next check, "Each box needs at least 3.88 ₳…", not
    `lj.launch.copy`.
- **Discovery-level test**: `tests/lovejoin-discovery.test.ts` › "holds the data layer's last list for a launch's copy
  check…". Before, it failed with `lastListed is not a function`.
- **Files**: `src/background/lovejoin-pools.ts`, `src/background/lovejoin-launch.ts`.
- **Accepted by the finding**: a lying server can now cause a false copy refusal, never a confirmed pool. This is
  1.6.0's refusal input restored: no new words, key, request or storage.

### pr336#0: **fixed**
- **Test** (failed before, passes now): `tests/lovejoin-discovery.test.ts` › "keeps a new pool as Koios's chain data has
  it, never as the list says: its datum, its scripts and its launch's place (1.7.0's release review, pr336#0)".
  - Before, the pool was kept with the list's forged 3 ₳ and its launch at block 1, place 0.
  - The same test also lists a script at an output the chain doesn't have; that pool was kept before and isn't now.
- **Files**: `src/background/lovejoin-pools.ts`.
- **New Koios request**: `utxo_info`, only for pools new to the device. The docs lane must name it (see below).

### pr336#1: **fixed**
- **Test** (failed before, passes now): `tests/lovejoin-discovery.test.ts` › "holds no pool read while Koios checks a
  pool new to the device: the pools kept before are read till it's kept (1.7.0's release review, pr336#1, x-priv#2)".
  - Before, the read was still pending after 1 s with Koios's `tx_info` held ("held up").
  - Now it answers at once with the pool held before, and the new pool is read once Koios answers.
- **Files**: `src/background/lovejoin-pools.ts`, `src/background/sw.ts`.

### x-priv#2: **fixed**
- Same change and test as pr336#1.

### pr336#2: **fixed**
- **Test** (failed before, passes now): `tests/lovejoin-discovery.test.ts` › "asks for the list and Koios once on a
  device with no record yet, however many pool reads come while Koios checks (1.7.0's release review, pr336#2)".
  - Before: 3 `lovejoin/pools` calls and 2 `tx_info`.
  - It also covers the next list arriving 5 minutes later while Koios still hangs: no second check.
- **Mutation runs**: dropping the one-check-at-a-time guard fails it with `[2,2]` against `[1,1]`; dropping the keep
  before the check fails it with 3 list calls.
- **Files**: `src/background/lovejoin-pools.ts`.

### pr336#4: **fixed** (the test was missing)
- **Test**: `tests/lovejoin-discovery.test.ts` › "locks the wallet when WebAssembly traps under the check, never taking
  the trap for Koios down (1.7.0's release review, pr336#4, x-mut-ts#0)".
  - On the old code it failed because the read itself rejected with the trap, which was the old design.
  - Mutation M5 (`confirmed()` swallows the trap) now fails it, and so does M6 (`confirm()` never calls
    `wallet.trapped`). Before, M5 survived every test.
- **Files**: `src/background/lovejoin-pools.ts`, `src/background/sw.ts`.

### x-mut-ts#0: **fixed**
- Same test as pr336#4.
- The finding's suggested test (`refresh()` rejects) assumed the old blocking design. Since the check now runs in the
  background, the test asserts the wallet locks (`trapped` called once) and nothing is kept.

### x-scen#4: **partly** (code comments only)
- Fixed in `lovejoin-pools.ts`: the header's data-layer bullet, `refresh()`'s doc comment and its inline comment, and
  `confirmed()`'s doc comment. They no longer say "the ledger is the judge".
- `docs/architecture.md:732` belongs to the docs-design lane, which has the same finding. The facts it needs are in
  the docs section below.

### pr336#5: **partly** (code comments only)
- Same comment fixes as x-scen#4.
- `architecture.md:732` and `:737` are the docs-design lane's (see below).

### x-rel#6: **deferred**
The gap is confirmed:
- Preprod has no `data` in `networks.ts`, so `dataOrigin` is undefined there.
- `e2e/data-layer.ts` lists no token pool.
- HEAD's mainnet head start holds 0 pools. The release prep's holds 1 (the 5 ₳ ADA pool), and bundled pools are
  never checked.

I can't write the e2e:
- It needs the Koios fake in `e2e/support.ts` to answer `utxo_info` and `tx_info` for the pool. The classifier doesn't
  let me read that file.
- It needs a mainnet-shown pool fixture, and I can't run e2e.

Recommendation for the lead: add an `e2e:data` case. The data layer fake lists a pool, and a `context.route` on the
mainnet Koios host, registered after the fixture's own (later routes win), answers `utxo_info` and `tx_info` for its
launch and falls back to the fixture for everything else. Otherwise, record the gap in the handoff note. The new unit
tests cover the glue over fakes only.

### x-upgrade#2: **owner's call**
Recommendation: **accept as is for 1.7.0.**
- The only mainnet pool a 1.6.0 device can hold today is the 5 ₳ ADA pool, which 1.7.0's head start carries as
  Koios's holder read it.
- The data layer was ours and applied the same rule from db-sync.
- A pool that fails a later check couldn't be told to "take no new box" without a new guard.

If the owner wants more, the cheap option is the one that refuses nothing:
- Once per network, run `confirmed()`'s path (now `utxo_info` and `tx_info`) over held pools that aren't in the head
  start, and replace a held row with Koios's where they differ.
- Or simply let the head start's row win over a stored row for the same outpoint in `kept()`.

### x-upgrade#0 (the rust lane's)
No TypeScript workaround was added. With pr336#0, Koios's rows also pass through `lovejoinLaunchCheck` and
`lovejoinVerifyPool`. A chain row can't name an asset twice, so that path adds no new route to the overflow.

## Strings, keys, e2e, WebAssembly
- **Strings added or changed:** none.
- **Critical keys changed:** none.
- **e2e specs edited:** none.
- **WebAssembly node tests added:** none (no Rust change).

## What the docs must now say (for the docs lanes)
1. **Privacy policy (`docs/store/privacy-policy.md`).** The 28 October entry (`:93`) and the Lovejoin's-pools bullet
   (`:46`) are unreleased, so amend them.
   - For a pool our server lists that the device hasn't seen, the wallet now also asks Koios for that pool's outputs:
     its reference output and its two scripts' outputs (`utxo_info`).
   - That's beside the transaction that started it and, where that didn't register the pool's script, its
     registration.
   - The same for every wallet, only for pools new to the device, naming nothing of the user's. This is a
     data-handling change (owner's rule 3).
2. **`docs/privacy.md:200`.** Add `utxo_info` (its rows, 60 outpoints a request) to "taken only once Koios confirms it
   as its own look would". Also say no pool read waits for the check, and the Lovejoin page's look does.
3. **`docs/architecture.md:732`** (x-scen#4, pr336#5, x-docs#3, x-priv#4, pr329#4). For a pool new to the device:
   - Being on chain, finished (L registered), its datum, its scripts' places and its launch's place are all Koios's
     word, from `utxo_info`, `tx_info` and `account_update_history`. Only being listed and the crowds are the
     server's word.
   - Pools a device already held before 1.7.0 stay as kept (x-upgrade#2).
   - The ledger's reference-input check only checks that the reference exists. Don't present it as judging the pool.
4. **`docs/architecture.md:737`, "What each costs"** (rule 8).
   - Per 20 new pools: one `utxo_info` (60 outpoints, 3 a pool) and one `tx_info` (20 launches).
   - Plus one `account_update_history` per 75 L's whose launch didn't register them.
   - Once per pool per device, and again at each list (5 minutes) while unconfirmed. None for pools already held.
5. **Behaviour, for `flows.md` or `architecture.md` if they describe it.**
   - The first pool reads after a new pool is listed read without it, until Koios confirms it. The Lovejoin page's
     look, and a pool's start, wait for the check.
   - A pool's start refuses, as a copy, a launch of the values of any pool on the data layer's last list, confirmed or
     not.
6. **Store listing host-permission text** (x-docs#2, x-rel#1). Count `utxo_info` among the mainnet Koios requests.

## Unchanged, worth knowing
- A pool's start still waits for the check through `look()`, as on HEAD. With a hung Koios that's up to about 91 s
  before the review. Since the copy check now reads the last list, `build` wouldn't need to wait. That would be a small
  follow-up, not done here.

## Tests run
All pass, one file at a time:

| File | Result |
|---|---|
| `lovejoin-discovery` | 27/27 (and 5 runs on one CPU, 3 runs of 3 processes on one CPU) |
| `lovejoin-discovery-review-fixes` | 2/2 |
| `wasm-review-fixes` | 3/3 |
| `lovejoin-screens-review` | 26/26 |
| `lovejoin-pools-head-start` | 2 passed, 2 skipped |
| `lovejoin-launch-review-fixes` | 6/6 |
| `lovejoin-pools` | 30/30 |
| `lovejoin-merged-review` | 41/41 |
| `lovejoin-crediting-review-fixes` | 17/17 |
| `lovejoin-merged-screens` | 21/21 |
| `lovejoin-planner` | 87/87 |
| `lovejoin-flows` | 33/33 |
| `handlers` | 21/21 |
| `storage-privacy` | 4/4 |
| `run-traps-review-fixes` | 14/14 |

`npm run typecheck` is clean. An earlier run showed an error in `tests/collateral-held.test.ts`, which isn't mine:
another lane's test imported a `LovejoinReturn` export they hadn't written yet. It's clean since.

## Files changed (all under `extension/`)
- `src/background/lovejoin-pools.ts`
- `src/background/lovejoin-launch.ts`
- `src/background/sw.ts` (one line: `wallet` passed to `PoolDiscovery`)
- `tests/lovejoin-discovery.test.ts`
- `tests/lovejoin-merged-review.test.ts`
- `tests/lovejoin-discovery-review-fixes.test.ts`
- `tests/wasm-review-fixes.test.ts`, `tests/lovejoin-screens-review.test.ts`, `tests/lovejoin-pools-head-start.test.ts`,
  `tests/lovejoin-crediting-review-fixes.test.ts`: one line each, the new required `wallet` dep.
