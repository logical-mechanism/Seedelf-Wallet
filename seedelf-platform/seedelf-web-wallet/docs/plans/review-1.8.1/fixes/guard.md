# 1.8.1's fix round: guard

Lane `guard`, in `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-guard` (detached at `2a8060d3`). Everything is uncommitted. No user-visible string changed, so no i18n key was added or changed. Paths below are under `EXT` (`seedelf-platform/seedelf-web-wallet/extension`), line numbers as the worktree has them now.

**The short of it:**

- **guard#1 and v-guard#1, fixed.** The connector now refuses a payment into the `mix_logic` account of the classic pool and of every pool discovery keeps, each copy among them, read or not.
  - Its answer no longer turns on which copy is sealed as holding the wallet's boxes, so a site's probe learns nothing.
  - No request, no new storage key, no write. One more read of discovery's record per call.
- **guard#3, done.** Its tests are in:
  - a private session's refusal;
  - a proposal's return and a treasury payee, in a definite map and an indefinite one, through the signer;
  - the pools the guard knows on each network, in sw.ts's wiring, a pool found since included.
- **mutants#9, fixed.** `DappDeps.lovejoin` is required at all 17 construction sites, and deleting sw.ts's line now fails the typecheck.

## guard#1 and v-guard#1 · fixed

**What changed:**

- `src/background/lovejoin-pools.ts:358–365`: `PoolDiscovery.everyKept(network)` returns every pool kept, the head start's and the device's record (`kept()`), as their `PoolRef`s. It makes no request and no write.
- `lovejoin-pools.ts:642`, `:646` and `:665`: `serviceDeps` hands it over as `everyKept`, and its doc comment says so.
- `src/background/lovejoin.ts:1630–1634`: `LovejoinDeps.everyKept?`, optional like the other discovery deps. Without discovery, the set is the pools the wallet reads alone, as before.
- `lovejoin.ts:4599–4614`: `mixLogicHashes` adds each kept pool to readSet's set, through `verifiedPool`, whose cache it shares.
  - If the record can't be read, readSet's set stands, as before.
  - A trap is thrown on (`unlessTrap`).

**Why the answer no longer depends on the boxes:**

- Only `ours` writes the sealed copies (`Schedule.copies`), and only from `copiesUnread` (`lovejoin.ts:3336–3341`), so they're always kept pools.
- Discovery's record only grows: every write keeps every pool it read, the head start's included. Remove wallet deletes it together with the sealed schedule.
- So whenever the record is read, the set is the classic pool plus every kept pool. That's the same for every device with the same history.
- I kept readSet as the base rather than replacing it, so a record that can't be read (a failed `chrome.storage` read) falls back to what the wallet reads, as readSet itself does for `known`. In that fallback alone, the sealed copies are in the set, as they always were before.

**Tests:** in `tests/dapp-lovejoin-rewards.test.ts` (new), in sw.ts's wiring (`PoolDiscovery`, `serviceDeps`, the connector given that service), with the real WebAssembly. The copy is v-guard's setup: REAL, the v2 token pool fixture, kept beside EARLIER, an earlier launch of its values.

- **`:173`** "are every copy discovery keeps too, read or not, whichever holds the wallet's boxes (v-guard#1)": the set with the copy unread, then read once and found empty, then sealed as holding the wallet's boxes.
  - On HEAD it failed at the first: `unread: expected [ Array(1) ] to deeply equal [ …(2) ]`, the classic pool's hash alone.
  - With the fix, all three are the same two hashes, and Koios isn't asked.
- **`:208`** "refuse a site's payment into a copy's account unasked, so its answer never says whether the wallet's boxes are there": a site's pool registration into the copy's account, with the copy read and empty, then sealed.
  - On HEAD: `read, empty: expected { asked: true, … } to deeply equal { asked: false, … }`. The site got a prompt, then `{ code: 2, info: "The user declined." }`, where the sealed case got code 1 unasked. That's v-guard#1's probe.
  - With the fix, both are refused unasked.
- **`:190`** "are the pools the wallet reads still, where discovery's record can't be read; a trap is handed on". This is the fallback the fix adds, checked against two mutants:
  - without the catch, it fails (`Error: unreadable`);
  - with a catch that swallows a trap, it fails (`promise resolved "Set{ …(2) }" instead of rejecting`).
- **The fix's own mutant,** `serviceDeps` without `everyKept`: `:173` and `:208` fail as on HEAD.

**The cost.** I measured it with a throwaway test in sw.ts's wiring, on the bundled head start, three runs each on the fix and on HEAD, then deleted the test. The numbers were steady across runs.

- **Storage:** `seedelf.lovejoinPools.<network>` is read once more per call: 3 reads cold and 2 warm, where HEAD makes 2 and 1. The sealed schedule's read is unchanged.
- **WebAssembly, today: nothing more.** On both networks, every kept pool is one readSet already verifies.
  - The cold call is unchanged: preprod 65.8 ms against HEAD's 66.6 ms (5 `lovejoinVerifyPool`, 6 `lovejoinMixLogic`), mainnet 20.6 ms against 20.7 ms (2 and 3).
  - A warm call stays under 0.5 ms.
- **A copy kept but never handed over** costs one `lovejoinVerifyPool` and one `lovejoinMixLogic`, once in the worker's life. Views are cached by reference and hashes by pool id.
  - With v-guard's stand-in, the cold call goes from 54.8 to 65.6 ms, and the warm one from 3.1 to 6.0 ms.
  - The warm cost comes from EARLIER, which never verifies and so is tried again at every call, now from two places. A pool discovery keeps always verifies, since discovery verified it with the same WebAssembly before keeping it.
- **Koios and the data layer:** never asked (tests `:159` and `:173`).
- **When it runs:** a signature calls `mixLogicHashes` only when the site's transaction names a script's reward account (`paidScripts`): a pool registration, a proposal's return, or a treasury payee.

## guard#3 · done (a test gap)

**What changed:**

- In `tests/dapp.test.ts`:
  - `siteTx` (`:80–:109`) carries `proposals`.
  - `registersPool`, `proposes` and `withdrawsTreasury` (`:111–:121`) are at module level now. The first moved out of the chunk 43 test.
  - **`:608`** "won't sign a site's transaction that pays into a Lovejoin pool's reward account (chunk 43)" keeps its pool registration and adds three cases, each refused unasked:
    - a proposal's deposit going back to `mix_logic`'s account;
    - a treasury withdrawal paying it, in a definite map that also pays a stranger's key;
    - the same withdrawal in an indefinite map.
  - **`:1515`** "won't sign a site's transaction that pays into a Lovejoin pool's reward account either (chunk 43; 1.8.1's release review, guard#3)": on a private session whose `DappService` is given `lovejoin` (`privately`, `:1183`).
    - A pool registration and a proposal's return are refused unasked.
    - Another script's is asked.
- **`tests/dapp-lovejoin-rewards.test.ts:159`** "are the classic pool, the head start's, the retired ones among them, and one found since, on each network, asking nobody": `mixLogicHashes` on preprod and mainnet.
  - It uses the bundled head start: 5 pools on preprod, and mainnet's 2, retired `dc6abe3b…` and v2 `fcb3f5ec…`.
  - It adds a token pool found since. On mainnet, that pool's rows are moved to the holder's mainnet address.
  - It counts asks to discovery's data layer.

**Mutants.** These tests hold behaviour that was already right, so each was checked against a mutant:

- **The guard skipped for a session** (`!holder &&` in `dapp.ts`'s condition): `:1515` fails (timed out at the prompt), and `:608` passes.
- **The guard only where a certificate is** (`summary.certificates.length &&`): `:608` fails at the proposal's return, and `:1515` too. HEAD's version of the test passes this mutant: I ran it as a temporary copy, and it got 1 passed.
- **T13d** (the classic pool's hash alone): `:159` fails, on HEAD and with the fix: `preprod: expected [ Array(1) ] to deeply equal [ …(7) ]`.
- **T13c** (`readSet(network, false)`): `:159` fails, on HEAD and with the fix: `preprod: expected 2 to be +0`. The data layer was asked twice while a site waited.

**Not done here, and why:**

- **The WebAssembly mutants.** Which kind of map a treasury withdrawal uses, and the pushes for a proposal's return and a treasury payee, are WebAssembly's lines (`wasm/src/cip30.rs:1574`, `:1589`). Their mutants (W19, W20) would need a WebAssembly rebuild to reach the extension's tests, which this round's rules forbid.
  - W19 is the rust lane's (mutants#4).
  - W20 is already killed by `wasm/tests/cip30_test.rs` (mutants.md).
  - The extension's cases run both lines end to end, through the real WebAssembly.
- **v-guard's probe on a private session,** as a test of its own. The session's answer comes from the same `mixLogicHashes(network)`, which takes no holder. `:173` shows the set doesn't change with the sealed copies, and `:1515` shows the guard runs for a session.

## mutants#9 · fixed

**What changed:**

- `src/background/dapp.ts:293–297`: `DappDeps.lovejoin` is required, and its comment says why ("a connector wired without it would sign one").
- `dapp.ts:2099`: the guard's `&& this.deps.lovejoin` is gone, since the service is always there.
- `lovejoin: t.lovejoin` is given at the 17 construction sites. That's testBalances' service, which knows the classic pool alone and asks nobody. It sits on its own line after `sessions`, as sw.ts and fakes.ts order it. The sites:
  - `dapp.test.ts:560`, `:819`, `:1097`, `:1183`;
  - `dapp-caps.test.ts:73`, `:131`, `:167`;
  - one each in `connector-lovejoin-review-fixes.test.ts:310`, `dapp-enable.test.ts:272`, `dapp-gone.test.ts:105`, `dapp-ties-accounts.test.ts:134`, `dapp-ties.test.ts:148`, `parts-send-review-fixes.test.ts:613`, `session-site-outs.test.ts:66`, `sessions-review-fixes.test.ts:80`, `site-funding-parts.test.ts:61` and `site-funding-seen.test.ts:70`.
- sw.ts (`:273`) and fakes.ts (`:797`) already passed it, so neither changed.

**The test:** `npm run typecheck`, with sw.ts's `lovejoin,` (`:273`, the connector's) deleted.

- Before the fix: exit 0.
- After it: exit 1, with one error, `src/background/sw.ts(268,28): error TS2741: Property 'lovejoin' is missing in type …`.
- I restored the line, and the typecheck is clean.

**What that turns on:** the guard is now on in every one of those files, the private sessions' connectors included. No test's result changed.

## What I ran last

- `npx vitest run` on the 13 test files I touched, together: 223 of 223 passed.
  - The files: `dapp-lovejoin-rewards`, `dapp`, `connector-lovejoin-review-fixes`, `dapp-caps`, `dapp-enable`, `dapp-gone`, `dapp-ties-accounts`, `dapp-ties`, `parts-send-review-fixes`, `session-site-outs`, `sessions-review-fixes`, `site-funding-parts` and `site-funding-seen`.
  - The first such run had one timeout under load, in `dapp-ties-accounts.test.ts`. See *For the lead*.
- **A regression run** over files I didn't touch: 237 passed and 2 skipped, out of 239.
  - Those that wire discovery through `serviceDeps`: `lovejoin-found-later`, `run-traps-review-fixes`, `lovejoin-screens-review-fixes-1-8-0`, `wasm-review-fixes`, `lovejoin-round2-sessions`, `lovejoin-crediting-review-fixes`, `lovejoin-merged-review` and `lovejoin-round2-retire`.
  - The discovery and pool files: `lovejoin-discovery`, `lovejoin-discovery-review-fixes`, `lovejoin-pools` and `lovejoin-pools-head-start`.
  - `lovejoin-reward-balance`, and `worker-language`, the one test that imports sw.ts.
  - `lovejoin-screens-review`, run on its own after: 26 of 26.
- `npm run typecheck`: clean.

## For the lead

- **The merge.** `DappDeps.lovejoin` is now required, so any `new DappService(...)` another lane adds (a refusals or balance test, say) needs `lovejoin: t.lovejoin`, or the typecheck fails once the lanes are merged. None of today's sites is left.
- **The docs lane's guard#1 line.** Chunk 43's archived record (`docs/archive/plans/chunk-43-lovejoin-reward-balance.md:47`) says "every pool `readSet` keeps, the classic and retired pools and copies included".
  - With this fix, the true version reads: "`LovejoinService.mixLogicHashes`: the classic pool's and every pool discovery keeps (`everyKept`: the head start's and `seedelf.lovejoinPools.<network>`), the retired ones and every copy among them, read or not, asking nobody".
  - The plan's Step 5 (`:121`, "every found pool's … kept under `seedelf.lovejoinPools.<network>`") is true again.
  - Its "Not covered: a pool no device has found yet" still holds.
- **No other doc goes wrong.** None but that record describes the set (architecture.md, privacy.md, the privacy policy, both CLAUDE.md files and `wasm/README.md`). The fix reads nothing off the device that discovery's record didn't already hold, so the policy needs no new entry.
- **v-guard's nit** (`sessions-review-fixes.test.ts:60`, "As sw.ts wires them"): that file's connector has `lovejoin` now. Its sessions still don't, since fakes.ts keeps Lovejoin out of the default sessions on purpose. I left the comment.
- **A load flake, seen once.** `dapp-ties-accounts.test.ts` "names a public account it pays whichever is on screen, the dApp account among them" timed out at 5 s (it took 5.7 s) with 13 heavy files run together.
  - Alone, it takes 1.3 s, twice, and the rerun of all 13 passed.
  - Its transactions pay key addresses only, so the guard never runs in it.

## Files

- **Modified:**
  - `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/connector-lovejoin-review-fixes.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-caps.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-enable.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-gone.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-ties-accounts.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-ties.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/parts-send-review-fixes.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/session-site-outs.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/sessions-review-fixes.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/site-funding-parts.test.ts`
  - `seedelf-platform/seedelf-web-wallet/extension/tests/site-funding-seen.test.ts`
- **Added:**
  - `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-lovejoin-rewards.test.ts`
  - this report, in the main tree: `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.8.1/fixes/guard.md`
- **Created and deleted, never left:** the throwaway `tests/zz-r181-guard-cost.test.ts` and `tests/zz-r181-guard-head-dapp.test.ts`. Their logs are in `SCRATCH/guard-fix/`.
