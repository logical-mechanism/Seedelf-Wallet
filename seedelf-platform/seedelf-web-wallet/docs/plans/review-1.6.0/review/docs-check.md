# docs-check: the docs the fix rounds changed, checked against the code

**Scope.** `git diff 3ea05dc1` over the docs the brief names, `review-1.6.0/` skipped. Fifteen files changed: architecture.md, flows.md, privacy.md, store/privacy-policy.md, keys-and-accounts.md, development.md, lovejoin-mix-width.md, the chunk-34 plan, roadmap.md, post-release-roadmap.md, the es and ja provenance files, extension/README.md, seedelf-data/README.md and seedelf-platform/CLAUDE.md. Four named files didn't change: the root README, the web wallet README, wasm/README.md and seedelf-data/deploy/README.md.

**What it was checked against:** the tree as it stands, 3ea05dc1 plus fx-last's uncommitted code (`sessions.ts`, `Swaps.tsx`, `swap.ts`, `PendingBanner.tsx`, `Lovejoin.tsx`, `rpc.ts`, the locales). The fixers' reports are `fixes/docs-a.md` and `fixes/docs-b.md`.

**How:** read-only. Nothing was built, tested or run through cargo. One GitHub read (`gh pr view 323`, `gh run list`) settled #323's timeline.

**Result:**
- **No high or medium.** 14 findings: 12 low and 2 nits.
- **No release date or store status.** The roadmap's heading, "2026-10-25: 1.6.0's release gate", is the handoff note's own date, as every earlier note has.
- **One lowercase name:** a crate name in prose, a nit.
- **Six findings are fx-last's code moving under docs that describe 3ea05dc1.** docs-a listed them under *Left for later*, and fx-last under *Docs to update*. They're still false in the tree, so they're reported.

## Findings

### 1. Low: architecture.md:53, "No catch swallows a trap" isn't true of three fire-and-forget calls
- **What's wrong.** Three handlers end in `.catch(() => undefined)` and aren't awaited, so `answerUi`'s trap handling never sees them (sw.ts:371-381):
  - `void ctx.sessions.scan(...)`, the restore scan (handlers.ts:153);
  - `void ctx.parts?.pump(...)`, Home's `pending-tx` poll (handlers.ts:226);
  - `void ctx.lovejoin.withdrawDue(...)`, Bring every box back now's first run (handlers.ts:570).
- **Which traps still lock.** Those inside `wallet.withKeys` do, through its own queue (wallet.ts:577-589).
- **Which are dropped.** One outside it is dropped at these three calls. Two examples:
  - `lovejoinVerifyPool` in Bring every box back now's first pool read. `readSet` and `verifiedPool` hand the trap on (lovejoin.ts:2647-2650, 2677-2682), and `withdrawDue` hands it on too, but handlers.ts:570 drops it.
  - `dexOrderAt` in the scan (sessions.ts:2730-2737).
- **Effect.** The wallet stays unlocked on the broken instance until another call traps under `answerUi` or `runs.ts`.
- **Fix.** Hand a trap on there: call `wallet.trapped()` on `isTrap`, as `answerUi` does. Or narrow the doc to the runs and services it lists.

### 2. Low: #323's timeline is told the wrong way round
- **Where:**
  - development.md:15, "#323 merged a minute after its run failed";
  - roadmap.md:51 and the chunk-34 plan's :925, "which merged a minute later";
  - the plan's :959, owner's call 6.
- **What happened.** Web Wallet run 40109672647 on `a6ab608d` started at 16:01:59Z. The PR merged at 16:02:25Z, and the run failed at 16:14:34Z. So it merged 26 s after its check started, and 12 minutes before the check failed.
- **Source of the error:** HANDOFF.md:7.
- **Also false:** development.md:15's "Nothing runs on `main` after the merge". `continuous-integration.yml` runs on push to `main`, though only the Aiken contracts' checks, which is why `main` looked green.
- **Fix.** "#323 merged while its check was still running: it failed 12 minutes later at *Extension unit tests*, and no e2e ran on its tree". And "nothing of the wallet's runs on `main`". The lesson stands, stronger.

### 3. Low: privacy-policy.md:28 and :93 read as promising a mix wherever a 5 ₳ pool is there
- **The text.** :28: "goes into a pool of 5 ₳ boxes, where there is one and the session holds enough to pay for the mix". :93: "now mixes the session's 5 ₳ collateral … where such a pool is shown, rather than bring it back with the rest, where anyone could tie it to the session". And :93 again: "A session funded while such a pool is shown pays a little more".
- **What the code needs as well:**
  - the pool holds the network's floor of other people's boxes, two of them free, and takes a new box (lovejoin.ts:3894-3925, sessions.ts:4586-4602);
  - the return isn't one whose ADA all sits beside a token: a swap against Danogo's pools that comes back directly gets no mix and pays no reserve, though the pool is shown and the balance pays (`tailUnpaid`, sessions.ts:1019-1021).
- **Why it matters.** On mainnet a 5 ₳ pool under its 30 boxes is "there", yet takes no collateral. flows.md and privacy.md were changed to "would take it" in this round; the policy wasn't.
- **Fix, short:** "where one holds enough other people's boxes, and the session's ADA of its own pays for the mix".

### 4. Low: privacy-policy.md:69 and :93, a public payer "ties the box to your account", but with several accounts it ties two
- **What the code does.** Paying from the account on screen for another account's box ties both accounts. The escape hatch orders boxes to avoid it (`hatchOrder`, lovejoin.ts:2017-2023), and the payer's note names both (`lovejoin.stuck.privacy.publicNamed`, en.json:1337).
- **Why it matters.** The policy doesn't say so. A reader with several accounts could take "ties the box to your account" to mean the payer alone is tied.
- **Fix.** Add, for instance: "paid from another of your public accounts than the box's, it ties the two accounts too".

### 5. Low: architecture.md:633's collateral bullet is stale after fx-last's LM-1
- **The summaries' `collateralPool`.** The doc says it holds "reserve paid or not". For a swap (`outBuild`) it's now set only where the reserve was paid, or where the fill as the review expects it pays for the mix (sessions.ts:1924-1934, `tailPaid` at :4613-4618). The site paths are unchanged.
- **Stop's cost.** "Stop's cost … returns `collateralMix`" leaves out that the flag now needs the return to pay for the mix (sessions.ts:3297-3302).
- **Undescribed:** `tailPaid` itself, and Stop's `epoch_params` read when there's no box.

### 6. Low: flows.md:464, :469 and :480, the swap's Max, its approval and Stop are stale after fx-last
- **Max (:464).** "Max pressed before any quote follows Max down" omits that it never follows down to nothing (`followMax`, swap.ts:149-151).
- **The approval (:469).** "or a pool of 5 ₳ boxes takes the collateral without it and the swap's fill is ADA" is no longer enough. Without the reserve, the approval says the 5 ₳ is mixed only where its expected fill pays for that mix: 1.5 ₳ left after its boxes, or 2.8 ₳ with none (sessions.ts:1928, Swaps.tsx:1305).
- **Stop (:480).** "where the collateral would go into the 5 ₳ pool, a line says giveme.my backs that mix too" is stale in three ways:
  - the line shows only where the return pays for that mix (`collateralMix`; Swaps.tsx:2906-2909);
  - it has no "too" (`swaps.stop.privacy.collateralMix`, en.json:2517);
  - with no box, the notes now say all but the 5 ₳ comes back, and the 5 ₳ later, mixed once (`swaps.stop.*Mixed`, Swaps.tsx:2834, 2886-2891).

### 7. Low: privacy.md:217, the swap approval's words without the reserve are stale after fx-last
- **The text.** "A swap's approval, where its fill is ADA, and a site's notes say the 5 ₳ is mixed also where the funding went without it but the pool takes it".
- **What the code does.** For a swap, that's now only where its fill, as the review expects it, pays for that mix (sessions.ts:1928, Swaps.tsx:1305). The site's notes are as said.

### 8. Low: flows.md:513, the public Mix form's held figure in a token pool
- **The text.** "the UTxOs its chain picks for that many boxes".
- **What the code does.** Since fx-last's LW-4 the pick is for the most boxes the stepper offers, one where none fits, whatever the count stands at (`publicSideOf(..., most || 1)`, Lovejoin.tsx:2762). The cantAfford line's figure uses it too.

### 9. Low: flows.md:523 and architecture.md:484, Home's banner says "it" for one box only while balances show
- **The text.** "each in the singular for one box", and "in the singular for one".
- **What the code does.** While balances are hidden it counts 2, so it says "them" (PendingBanner.tsx:240-243, fx-last's LW-2).

### 10. Low: flows.md:139 contradicts flows.md:143
- **The text.** :139 says "Waiting" lasts up to two hours "so none offers a second 5 ₳ meanwhile".
- **What the code does.** From 10 minutes on, the status carries `late` (coin-control.ts:372-375), and the Collateral page offers **Pay it again anyway** (Collateral.tsx:79-89), as :143 says.
- **Fix.** "so the row and Lovejoin's form offer none, and the page only **Pay it again anyway** after 10 minutes".

### 11. Low: privacy.md:121 says more than the Mix reviews do
- **The text.** "the reviews that start one say so first, where the collateral would be mixed: … a mix's and Mix my boxes again's reviews".
- **What the code does.** Those reviews show the giveme.my line only where the funding paid the reserve (`CollateralMixNote`, Lovejoin.tsx:3810-3818).
- **The gap.** A mix funded without the reserve (`orWithoutReserve`, sessions.ts:4629-4636) whose return still mixes the collateral is witnessed by giveme.my with nothing on its review saying so. The form's own line says only that it's mixed if enough is left. privacy.md:217 states the narrower rule correctly, and :121 should match it.
- **Owner's call:** whether that line belongs on the review in the no-reserve case.

### 12. Low (owner's call): the policy's 1.6.0 entry doesn't name the restore scan's new ask
- **What's new.** Beside the orders' outputs, the scan now asks `utxo_info` of the first Seedelf-contract UTxO that each other payment into a found one-time account spent: strangers' too, in the same request (sessions.ts:2758-2780). Which are this phrase's is worked out on the device.
- **Why the server learns nothing new.** It has just listed those inputs in `tx_info`, and docs-a's call 2 left it out on that ground.
- **Why the owner might want a line anyway.** The 12 October entry corrected the policy to say exactly what the look asks. One clause, "and the Seedelf UTxOs that paid them", in the 18 October entry would be exact.

### 13. Nit: the policy doesn't cover `bringStopped`
- **What's kept.** After Stop, how many boxes Bring every box back now sent and from which pool stays sealed until the next run (lovejoin.ts:909, 6384-6402). That can be for good.
- **What the policy lists.** Its Lovejoin row keeps "a box being brought back until it's settled", and the 18 October entry lists no such record.
- **Fix.** Name it in the entry's *On your device*, or clear it once a page has shown it.

### 14. Nit: seedelf-data/README.md:169, a crate name in prose
"seedelf-core's `cbor::MAX_DEPTH`": the README backticks the crate everywhere else (:180).

## Checked and holding (by cluster)

**The worker:**
- Traps: `isTrap`'s RangeError told by a WebAssembly frame (wasm.ts:46-60); runs.ts's trap handling (:50-71); `unlessTrap` on the listed sites in lovejoin.ts.
- Max in parts: `leftWhy`, Max over nothing, and `max_in_parts`' reasons (wasm lib.rs:3596-3605, 4321-4395).
- Parts: `laterParts` and the reservations check (script-spend.ts:403-438, 577-588); `pumpHolds` (parts.ts:596-633); `Sending.parts` and `pending-tx`'s `"locked"` (handlers.ts:224-238); `refuseParts` (sessions.ts:4795, 4857-4866, 4894).
- The countdown's `parts-waiting` (handlers.ts:184-189, LockCountdown.tsx:86-178); Remove wallet's `partsWaiting` (handlers.ts:616-626).
- Account switching: no private chain holds it (handlers.ts:358-368, lovejoin.ts:5240-5243).
- Home's `unwatched` (Home.tsx:1424-1440).
- The collateral: `WAIT_MS`, `heldSent`, `late` and *Pay it again anyway* (coin-control.ts:364-383, Collateral.tsx:36-89, 130-155).

**Lovejoin:**
- Activity's *Paid for a box back from Lovejoin* (activity.ts:843-862, incoming.ts:356-360).
- Banner strings (en.json:1481-1538).
- The reserves: `tailReserve`, `orWithoutReserve`, `tailUnpaid` and `collateralPoolTakes` (lovejoin.ts:3914-3925); `tailReserveOf` (Lovejoin.tsx:323-333); `maxAdaIn`, `FEE_ROOM` and `adaShort` (swap.ts:114-183); `COLLATERAL_MIX_COST` 1.5 ₳ (LovejoinReturn.tsx:497).
- core's `COLLATERAL_TAIL_RESERVE`, `direct_tail_reserve` (2.8 ₳ and 3.6 ₳) and `BOOTSTRAP_BACK_RESERVE` (lovejoin/mod.rs:1670-1733).
- Bootstrap: `mix.noCollateral` and the one-box-fewer rule (sessions.ts:4400-4433); the Bootstrap form's boxes + 3 ₳ + 2 ₳ (Lovejoin.tsx:3578, 3627); caps of 96 and 64.
- Holds: `holderOf`, `holdable`, `squareUp` and `bootstrapOf` (lovejoin.ts:2180-2330); `depositors` and its pruning (lovejoin.ts:843-851, 5344-5353, 2040).
- Waiting: `tailWaits`, `mixing`, `tailBuildable` (lovejoin.ts:1305-1330), `mayLand` and `landedBy` (:1352-1372); `LANDING_MS` 15 min, `BRING_LATE_MS` 10 min, `recheck` at `SPENT_KEEP_MS` 2 h.
- Bring every box back now: the wait reasons (rpc.ts:2522, en.json:1965-1980); `lj.tail.*` (en.json:915-920).
- Payers: the private payer's order (lovejoin.ts:6795-6812); `hatchOrder` and `hatchAccountOf`.
- The pool start's warning and its one parameters read (lovejoin-launch.ts).
- The hub's started line after 30 minutes (Lovejoin.tsx:2057-2078).

**Pools and the data layer:**
- Datum depth: `protocol_of`'s skip (wasm lovejoin.rs:120-131); `refresh`'s same-transaction guard (lovejoin-pools.ts:434-440); `cbor::MAX_DEPTH`; `evaluable` and `withinDepth`, held to `scriptRowDatums` (28 datums, `maxDepth` 128) in lovejoin-planner.test.ts.
- `with_staking`'s refusal (build.rs:1761); `MORE_THAN_THERE_IS`; `owner_context` in `lovejoin/mod.rs`.
- seedelf-data: `pools_with` (one 5 s deadline, the last list, 503 before the first; routes.rs:194-302); `ALWAYS_KEPT` with `lovejoin/tokens` (state.rs:55-60); the read on, by output and transaction id (discovery.rs:170-186); the vectors' counts.
- The restore scan's contract-input ask and its behind-server failure (sessions.ts:2747-2795).
- lovejoin-mix-width.md: `wayOver` gives no reason (lovejoin.ts:2419); the tests' names; `MEASURE_LIMIT` caps scripts together (eval.rs:27-38).

**Docs and CI:**
- development.md: the live harness (lib.mjs:29-32, run.mjs:28-32, tests/live-runs-copy.test.ts); the `vi.mock("react")` seam's `on` and `seed`; Vitest's node environment (vite.config.ts:145); `web-wallet.yml` on `pull_request` only.
- CLAUDE.md's third copy of the depth walk.
- The plan's commit list (d5fa7ede…3ea05dc1).
- The lists: 465 and 62 DReps; preprod's three head-start pools, the new one 4.5 ₳ and 500 MIN.
- Round 1's Rust changed nothing but comments since fc8561c7.

## The policy's 1.6.0 entry and each fix round's data handling

| Change | In the 18 October entry? | Verdict |
|---|---|---|
| The restore scan's `utxo_info` of each other payment's first contract input | No | Finding 12 (owner's call) |
| `bringStopped`, kept until the next run | No | Finding 13 |
| `counted`, `recheck`, `bringing.waiting`/`late` | "a box being brought back until it's settled" | Covered |
| `depositors`: a public deposit's account, while its boxes are listed, plus 3 h | "your mixes until their boxes are back" | Covered |
| `launches.box` and `reviewed` | "the pools you started" | Covered |
| Stop's 2 h recheck pool read | the same read every wallet makes | No line needed |
| One `epoch_params` per review; Stop's no-box `epoch_params` (fx-last) | parameters | No line needed |
| A token deposit's reference input | on chain, naming the pool its output names | No line needed |
| *Pay it again anyway* | the 12 October entry's collateral payments | Covered |
| The reserve's fallback | the entry says it, as docs-a wrote it | Covered, but see finding 3's wording |

## Not verified (figures from the fixers' measured runs)
- 1,804 lovelace a token deposit's reference read;
- 68 classic boxes and 51 of LJTEST at 6,465 lovelace a byte (the core test prints but doesn't pin them);
- about 0.29 ₳ over on a chain;
- the checks lines' counts (Rust 684, Vitest 2,849, e2e 104).

## Already tracked, not counted
- **The policy's date and header.** Its *Effective* date, and a header list that doesn't name the collateral's mix: Session 12's call 1.
- **"fx-last … running as this was written",** in Session 12 and the handoff note: docs-b's *Docs to update*.
- **A third critical-key failure.** fx-last added the critical key `swaps.stop.privacy.collateralMix`, so `i18n.test.ts` has a third failure until `node scripts/i18n-critical.mjs --write`. The roadmap and the plan say two.
