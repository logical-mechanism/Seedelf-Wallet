# Lane "docs-roadmap": report

**Worktree:** `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`.

**Files changed** (all under `W/seedelf-platform/seedelf-web-wallet/docs/`):
- `post-release-roadmap.md`
- `roadmap.md`
- `archive/plans/chunk-34-token-pools.md`
- `archive/plans/README.md`

**Left alone:** the Tor entry (docs-design's), and the rust lane's `[profile.wasm-release]` lines. Item 4's overflow half and its ✅ entry are byte for byte as the rust lane left them.

**Not written:** no 1.7.0 handoff note and no release record. They're the lead's.

Every finding here is docs only, so none has a test. Each claim was checked against the code in `W`, as the code lanes left it, and against the run's records on `web-wallet/leios-musashi`, read with `git show` (never checked out).
- No test reads these files: only comments in `activity.test.ts` mention the roadmap.
- Every in-file anchor in the roadmap and the archived plan resolves (scripted check).

## What the roadmap now says

### The 1.7.0 list
- **Header:** names item 8 ("and a headless run on Leios's testnet"). It now says "new requests", since the pool check makes three, and "Past the housekeeping", since item 1 has no entry.
- **Item 2** stays 🚧. Its last clause now says what requiring the check takes: a rule the owner's own merges can't pass by.
- **Items 4 to 7** are ✅, each with its PR and what it built:
  - **4:** a "✅ The Bootstrap half (#333)" sentence went in before the rust lane's untouched overflow half.
  - **6:** the owner's calls: an hour, `TAIL_OFFER_MS`, and *Bring the rest back now*.
  - **7:** the stepper, and `tx-view.ts` following `partHashes`.

### *Kept in mind*
- **The five (1.7.0) entries** (the old :373, :374, :378, :379 and :380) are now "✅ **1.7.0:**" entries over their struck old text, as :387–388 are. Each says what the code does after this fix round:
  - **Item 5:** Koios's `utxo_info`, which the pools lane added (pr336#0), and `tx_info`, one each for every 20 new pools. Plus one `account_update_history` for every 75 L's a launch didn't register, of Koios alone. No pool read waits for the check; the look and a pool's start do.
  - **Item 6:** the press's two paths (the tail lane's pr337#1).
  - **Item 7:** the stepper lane's fixes.
  - **Item 4:** 1.5 ₳ today and 1.8 ₳ at 6,465, where one deposit's most still goes: 96 classic boxes, 64 in a token pool. The struck text's "51 of LJTEST" now reads "51 in a token pool", per the bootstrap lane.
  - **Each entry's "Left:"** names the owner's calls the code lanes reported for that item: pr333#0, pr333#3, pr337's two-window case, pr337#0's rest, x-upgrade#2 and pr335#4.
- **A new (1.7.0) entry for item 2** (pr329#6, pr329#1). It says:
  - `main`'s classic rule lets every merge past it, and would let past a required check too: 12 of the 13 PRs from #325 to #338 that had a run merged before it ended.
  - The two rules that would hold: a ruleset with an empty bypass list (recommended), or no approvals with *Do not allow bypassing* on.
  - Require only *Web Wallet required*, never a bare `check`.
- **Item 3's ✅ entry** now records:
  - the traps lane's x-merge#1: the alarm's run locks the wallet, and a chain a trap stopped reads as cut;
  - the gap still open in `W`: `claimSubmit` (Bring everything back's send) lists a trap as one return that failed and sends the next on the broken module (see *For the lead*).
- **"Waiting parts across a lock"** (old :375) was inexact after x-upgrade#1, which the stepper lane reproduced. The watch's progress is sealed only until Koios takes the part. After that, a lock, a closed browser or an update leaves Home saying nothing of the rest. A sealed progress record is the owner's call.
- **pr329#2:** #324's call 7 (fx-may's call 1) is under *Left by 1.6.0's release review*, with #324's recommendation.
  - Checked in `W`: `sessions.ts` `tailReserve` returns `{ reserve: 0n, may: true }` on a failed read.
  - `collateralPoolTakes` says "no" under the floor, so on mainnet the case arises once the 5 ₳ pool holds 30 boxes.
- **pr329#3:** carried under *Left by chunk 34's sessions*, each still so in `W`:
  - a waiting part refused BadInputsUTxO by a lagging Koios: no grace (`parts.ts`: only `CollateralError` or a non-maybe `KoiosBusyError` waits);
  - the history-first planner's 2.5× refusal time;
  - Mix again below the floor reads "Try again later." (`lovejoin.ts` `floor`), and a copy may never fill;
  - R2-1's aside: `refresh` returns early while the first `index.pools()` is in flight, so `look` scans Koios's holder;
  - `CollateralTail` copies core's `Tail` field for field;
  - Session 5's open questions: `reviewHint` returns nothing in a stuck pool, and ClaimAll still uses `claim.boxesOfBackAfter`.

  The plan's pointer now says Session 5's questions are carried.
- **pr328#0 and pr328#1:** in Step 0, rustls is now 0.23.46 since #328 (RUSTSEC-2026-0346 to -0349). *Kept in mind*'s RustSec record adds:
  - `crypto-bigint` 0.5.5 in the WebAssembly (RUSTSEC-2026-0387): through `uplc` → `k256`, verify-only, so no secret goes through it. It waits for a `uplc` on `k256` 0.14.
  - The data layer's `ctutils` 0.4.3 (RUSTSEC-2026-0385) and `tokio` 1.53.2 (RUSTSEC-2026-0386), with the `cargo update` lines for its next change.
  - I checked the IDs and patched ranges with read-only GETs of RustSec's repository; the locks and `cargo tree` are from `W`.

### The Leios entry, checked against the run's README and its 20 records
- **"Mended, all of it ran"** now says what ran: every Seedelf spend and mix, and a launch whose `mix_logic` was registered apart first. It ran on Seedelf's variant 1 and the pools' templates.
  - No withdraw was sent. None is in the records, and the README says so. It's the one the fix must try first.
  - Nor did giveme.my, a token's pool or the classic pool's own scripts run there. The spends put up the harness key's own collateral, and the pool held ADA alone, 5 ₳ a box.
- **The fix** keeps the owner's plan: a Pallas update, then a CLI release and a web wallet release, much later. It adds that core's two patches change with it whatever Pallas writes. `withdraw_zero.rs` writes the list itself and bails on a map, and no Pallas stages a launch's certificate (pr338#2).
- **The 4-wide chain:** a deposit and 5 mixes, five of them in the EB.
- **Throughput:** 5.6× to 6.3× ideal, 2.8× to 3.1× observed. Waits run from about a minute to 9 minutes: the shortest is 65.9 s, the longest 526.2 s, over 889 landed transactions.
- ***What Leios would change*** is now four sub-bullets:
  - **The window:** four, or two for four-box mixes. The 120 s and 245 s are the second wave's waits, and the wallet's own two at a time wasn't run. One run each showed no end-to-end gain; the model says about two minutes.
  - **A chained Seedelf spend** still waits for its parent, as before.
  - **Fees and limits:** Dijkstra's new fees on reference inputs, named. Core also holds as Conway's constants what Dijkstra makes parameters: `refScriptCostStride`, `refScriptCostMultiplier` and `maxRefScriptSizePerTx`.
  - **Others' transactions:** Dijkstra's three-element shape is refused for a site's transaction and a Minswap swap, first by `cbor.ts`'s `0x84` check, then by Pallas's Conway decoders. A body field Dijkstra adds goes unnamed in the signing prompt.

### roadmap.md, 1.6.0's record
- **The C compiler line** is now as both builds printed it: `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`. Source: `owner-package-1.6.0.log:283` and `clone-package.log:197`.
- **"Not in it:"** no `status` run followed. `gh run list` shows only deploys, 40440233291 on `babb8e76`, then 40713719454 on `641f751c`. The record also lacks checklist item 9's outcome and the live db-sync tests', which only the owner has.

### The archive
- **chunk-34-token-pools.md:**
  - 34g's heading drops "in progress", and its two links (:9, :1497) now point at the new anchor.
  - "Start here (the next session)" is now "The last handoff". Nothing links to it.
  - Session 6's heading drops "in progress; items 1–5 pushed".
  - The S0 and 34b rows say the rehearsal's MIN pool launch settled S0c.
- **README.md:** a row for chunk 34's ID families, and how to tell its `R3-1`–`R3-3` from 1.6.0's. Bare ones of both exist in the code.

## Outcomes

| id | outcome | check | note |
|---|---|---|---|
| x-docs#0 | fixed | koios.ts `utxoInfo`, `launches`, `firstRegistrations`; lovejoin-pools.ts `confirmed`, `launched`; lovejoin.ts `TAIL_OFFER_MS`; tx-view.ts `partHashes`; core `bootstrap_back_reserve` | ticks 4–7, five entries rewritten, requests named |
| x-docs#6 | fixed | branch README, records; lovejoin.ts `chainWindow` | |
| x-docs#9 | fixed | anchors resolve | 34g heading, two links |
| x-merge#4 | fixed | as x-docs#0; sessions.ts `claimSubmit` | "finding 2's trap gap" (x-merge#1) is fixed by the traps lane; the claimSubmit gap left is recorded in item 3's entry |
| x-rel#7 | partly | | ticks done; the handoff note and the review folder are the lead's |
| pr336#7 | fixed | as x-docs#0 | |
| pr335#1 | partly | tx-view.ts, TxDetail.tsx | roadmap done; architecture.md:211 and flows.md are docs-design's |
| pr337#4 | partly | | item 6 done; privacy.md is docs-design's |
| pr329#0 | fixed | as x-docs#0 | |
| pr329#1 | partly | ci lane's live protection read | item 2 and its new entry name what it takes; the settings change is the owner's |
| pr329#2 | fixed | sessions.ts `tailReserve`, lovejoin.ts `collateralPoolTakes` | carried, with #324's recommendation |
| pr329#3 | fixed | parts.ts, lovejoin.ts, lovejoin-pools.ts, wasm lovejoin.rs, Lovejoin.tsx, ClaimAll.tsx | see below |
| pr329#6 | fixed | | heading, S0c rows, item 2's entry |
| pr329#7 | fixed | code citation counts | README row |
| pr329#8 | owner-call | | the fork's deadline |
| pr334#0 | fixed | as x-docs#6 | |
| pr334#1 | fixed | records hold no withdraw | |
| pr334#2 | fixed | as x-docs#0 | |
| pr334#3 | owner-call | | the fork's deadline |
| pr334#4 | fixed | chain-w4-all.json | |
| pr334#5 | fixed | Musashi parameters | |
| pr334#6 | fixed | | header names item 8 |
| pr338#0 | fixed | records and README | |
| pr338#1 | fixed | | |
| pr338#2 | fixed | withdraw_zero.rs:104-117, launch.rs:252, CLAUDE.md | the owner's plan kept |
| pr338#3 | fixed | cbor.ts:123/209, dapp.ts signTx/submitTx, cip30.rs:1029, decode.rs:633 | |
| pr338#4 | fixed | as x-docs#0 | |
| pr338#5 | owner-call | | the fork's deadline |
| pr338#6 | fixed | build.rs:59-88 | plus `maxRefScriptSizePerTx` |
| pr338#7 | partly | records | (a), (b), (c) fixed; (d) not a bug, the parenthetical lists what the harness drives |
| pr325#0 | fixed | gh run list | the docs half; the `status` step is the owner's call |
| pr325#1 | fixed | both 1.6.0 package logs | |
| pr328#0 | deferred | seedelf-data/Cargo.lock | `seedelf-data/` is off limits this pass; recorded in *Kept in mind* for the data layer's next change |
| pr328#1 | fixed | lock, `cargo tree`, RustSec | |
| x-rel#3 | deferred | lovejoin-pools.json, extension.spec.ts:3204, ui/lovejoin-pools.ts `groupPools` | the lead's release prep, see below |

**pr329#3, item by item:**
- Carried: 1 (BadInputsUTxO), 3 (planner), 4 (CollateralTail), 5a (floor), 5b (the race) and 8 (Session 5).
- **2 (two windows) is not carried: it doesn't reproduce.** Each `transfer-build` replaces the one review the worker keeps, so an older window's Send meets `first?.txHash !== txHash`. `sendParts` then takes `[txHash]`, `splitParts` returns at once for one part, and `unsplit` returns at once too. Nothing is held or freed before `send` refuses it as stale.
- **6 (step 4's words)** was settled in the plan ("a correction, kept").
- **7 (the live db-sync tests):** 1.6.0's note now says they aren't recorded.

## Owner's calls (recommendations)

- **pr329#8, pr334#3, pr338#5, the Leios fix's deadline.** Beside "much later", name the trigger without a date: "due before mainnet moves to protocol version 12, from which the node refuses every script transaction core builds".
- **pr329#1, requiring the check.** A ruleset that requires *Web Wallet required* with an empty bypass list. The ci lane's report has the steps.
- **pr325#0, the `status` step.** Drop "then a `status` run" from development.md's part 2 and step 7, and from the runbook's "after its `status` run". The deploy prints `DEPLOYED <sha256> (<the one before> kept as .prev)` itself. No release deploy since the 2026-10-09 drill ran one.
- **1.6.0's record:** add checklist item 9's outcome and the live db-sync tests' outcome to 1.6.0's "Done that way", or "not run". Only the owner knows.
- **The privacy policy's dates** (x-docs#10, x-rel#8, x-priv#6, pr336#8). Date the *Effective* line and the entry by the day the release PR merges, as 1.6.0's were (`ef6af2bc`, "1.6.0's privacy policy dated the merge day"). 28 October stands if it merges today.
  - The entry's text changed in this fix round (`utxo_info`).
  - Settings links `main`'s policy, so 1.6.0 users read it already. That's over-disclosure, and harmless.

## For the lead

- **If `claimSubmit` gets the `isTrap` rethrow** (the traps lane's one-liner) before the commit, drop the sentence "Left: Bring everything back's send (`claimSubmit`) …" from item 3's ✅ entry. That's the entry starting "✅ **1.7.0:** a trap under one of the three runs".
- **For 1.7.0's handoff note:** the data layer was deployed again on 2026-10-28 from `641f751c`, #328's merge (run 40713719454). So the API running is that one, not `babb8e76`'s.
- **x-rel#3:**
  - The refreshes ran in `W`: dreps and `lovejoin-pools.json` changed; `src/tokens/` and `token-decimals.json` didn't.
  - Mainnet's head start now bundles the 5 ₳ ADA pool `dc6abe3b…`. It joins ADA's group, so the hub stays rows (`groupPools`, `groups.length > 1` false), and the classic row should still be on the mainnet hub.
  - But extension.spec.ts:3204's "Mainnet bundles none" is stale.
  - `lovejoin-1-5-0.test.ts` fails on that pool (tail and traps lanes).
  - Record each refresh's outcome in the handoff note.
- **x-rel#7:** the review's working folder (`docs/plans/review-1.7.0/`, untracked in the main checkout) must be archived or removed before part 2's clean-tree check. Once it's archived, the archive README needs its row.
- **CLI note** (kept out of the docs by the owner's wallet-pass rule): `seedelf-platform/Cargo.lock`'s `tokio` 1.52.3 is inside RUSTSEC-2026-0386 too.
  - 1.52 has no fixed release.
  - It's not in the WebAssembly, and nothing calls `AsyncFd`.
  - Step 0's summary now ends "and the CLI's own", so it doesn't claim the CLI's list is complete.

## Lists

- **Strings added or changed:** none.
- **Critical keys changed:** none.
- **e2e specs edited:** none.
- **WebAssembly node tests added:** none.
- **Privacy policy:** no entry needed from this lane, since nothing here changes data handling.
- **Docs for other lanes:**
  - privacy.md's collateral paragraph (pr337#4's other half) is docs-design's.
  - architecture.md:211 and flows.md's *Read the transaction* (pr335#1's optional half) are docs-design's.

**Scratch** (outside the tree): `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/docs-roadmap/` holds the run records copied with `git show`, the summarizer, and an empty deploy log (`gh` returned no log text).
