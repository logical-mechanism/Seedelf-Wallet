# LIVE-1's whole fix, reviewed (lens `last-5b`)

Scope: fx-cut's and fx-cut-2's changes together (`git diff 22acd30e`, outside the docs), and the code they read:
- `lovejoin.ts`: `ChainRecord.restBack`, `ownTxs`, `tailBoxOut`, `restOnly`, `carriedOf`, `shown(c, carried)`, held()'s `stopped`, `rows(s)`, mixes()' chain view, `restBack(network, index, sentAt?)`, and sortOut's mark;
- `sessions.ts`: sendBack's call to `restBack`, and noteLanded's block;
- their tests: P1–P9 (`lovejoin-planner.test.ts`) and R1–R5 (`lovejoin-stopped-shown.test.ts`).

The live run's files in the diff (`e2e/live/`, `live-runs-copy.test.ts`, the roadmap, the chunk-34 plan) aren't the fix's, and are left out.

**Verdict:** no high, medium or low. One nit (sendBack's catch-all, below). The lead's five checks hold, each made concrete (*The five checks*).

**How it was tested:**
- Against the real WebAssembly: `zz-review-5b-1` on records in the tree's `tests/`; `zz-review-5b-2`, a copy of the planner file with four scenarios added to its LIVE-1 block, on P1's and P3's real flows.
- One mutation, in a scratch copy of `extension/`.
- The throwaways and the copy are deleted. Their output is in the scratchpad's `last5b/`.
- Nothing tracked was edited.

## Findings

### 1. nit: sendBack's call to `restBack` takes every failure as nothing marked, a trap too, where noteLanded's hands a trap on

- **Where:** `extension/src/background/sessions.ts:4816`, `.catch(() => undefined)` (fx-cut). noteLanded's call (`:4862`, fx-cut-2) rethrows a trap, as L3 has it.
- **Today nothing is lost:** `restBack` runs no WebAssembly.
  - What it does: `available()` checks the network; `cuts()` reads session storage under `withKeys`; `read()` and `update()` open the sealed store with xchacha20 under `withStoreKey`.
  - What becomes of a trap in them: one inside `withKeys` or `withStoreKey` is turned into a lock and a `WalletLocked` by the wallet's queue (`wallet.ts:577–589`). So no trap leaves `restBack` as a trap.
- **Scenario (latent):** a later `restBack` that calls WebAssembly traps. The Send resolves as a clean one, and the wallet isn't locked.
- **Evidence:** `zz-5b-3`. With `restBack` stubbed to reject with `WebAssembly.RuntimeError("unreachable")`, P3's direct return gives `{"sent":{"resolved":true},"calls":1,"wallet":"unlocked"}`. P8 shows the same trap handed on from noteLanded.
- **Concerns:** fx-cut (LIVE-1). fx-cut-2 raised it to the lead (its *Notes*).
- **Suggested fix:** noteLanded's own catch, one line: `.catch((e: unknown) => { if (isTrap(e)) throw e; })`. A trap then skips the history write and the summary's deletion that follow, and noteLanded writes them once the return lands. That's its design for a send cut off.

## The five checks

### 1. The two new hunks are right, and no chain is marked carried that isn't

**sortOut's mark** (`lovejoin.ts:5434–5440`).
- **What it writes:** `restBack`, on a kept chain that carriedOf carries. It's written in the same update that drops the carrier's record, before the filter. So a mark is what carriedOf would read had that record stayed.
- **Its reading only moves one way.** fx-cut-2's argument holds, and one gap in it is closed elsewhere:
  - `chainEnded` (`:5048`) and `cuts` (`:5289`) skip an ended chain, so `done` never flips.
  - `maybe` is set only while a chain is sent (`chainMarked`, `:5097`), and only by public mixes.
  - `chainSent` (`:4987`) doesn't check `ended`, so it could still raise a cut chain's `sent` or set `tail.scheduled`. But pumpChain saves the progress before every send (`:450–458`, `keepPending` → `pendingHere`). A chain whose progress went throws ChainGone there, before any submit. So nothing sends for a chain `cuts()` marked cut.
- **sortOut is the only place a carrier's record goes.** recordChain's failure path (`:4970`) removes only a chain that never started, which is never `done`.
- **The mark is kept.** `read()` takes the chains as stored (`:7204`), and nothing rebuilds a ChainRecord field by field.
- **Who reads `restBack`:** carriedOf (`:1983`) and restBack()'s own predicate (`:5081`), nothing else.

**noteLanded's block** (`sessions.ts:4856–4865`).
- **What it acts on:** a confirmed `back` with a summary. That's a return seen on chain whose history isn't written yet: one that comes back directly, or a chain's own last step (sendStep passes the summary there alone, `:5104–5112`).
- **Its `at`:** when it was first sent (sendRecorded, `:5262`).
- **The bound is right.** Every return goes through sendBack (`:3132`, `:3204`, `:4139`) or a chain, and buildBack refuses while a chain is pending (`:4317`). So a return sent after a chain was recorded was built after that chain stopped, from the account holding its rest.

**Made concrete:**
- **`zz-5b-1` test 2:** a chain that took over another deposit's 5 ₳ box carries nothing, before its record goes or 3 h after, under 6–24 h. Stopped 1, and no `restBack`.
- **`zz-5b-4`** covers a path neither fixer tested: the chain built in its place cut by a lock right after its return's submit, and that return then landing (P1's flow, the real WebAssembly).
  - While that return waits in the mempool, both chains say they stopped: Home 2, two rows. That's true then.
  - Once it lands, noteLanded marks both (`5/8 stopped rb`, `2/3 stopped rb`): Home 0, no rows, the card `{"total":8,"sent":5,"done":true}`, and the history written (its summary gone).

### 2. A cut chain whose mixes didn't all go never gets `restBack`

- **Both writers check that its mixes all went** (`sent >= ownTxs`):
  - carriedOf returns false at `c.sent < ownTxs(c)` before it reads anything else (`:1982`);
  - restBack()'s predicate takes only `restOnly` chains (`:5082`, `:1965`).
- **`zz-5b-1` test 4:** the chain is cut at 4 of 8, its rest built again and sent, under 6–24 h. There are five pool reads over 4 h, and the carrier's record goes at 3 h. It's never marked: Home 1, its row, and the card "Stopped" at every read.
- **Mutation m1** (in the copy): restBack's `restOnly(c)` became `!tailBoxOut(c)`, dropping `sent >= ownTxs`.
  - **The gate catches it:** 2 of its 4 fail. Its vault's chain, cut at 4 of 10, gains `"restBack": true` at "bring session 0 back".
  - **No LIVE-1 test fails.** On the direct path this check is held by the gate alone. That's enough, since the gate runs in CI.
- **Already known, not counted:** "sent" counts a send, not a landing. A mix a node dropped after its send counts, as fx-cut's call 1 and last-5's question 2 say.

### 3. The sealed schedule's shape stays compatible with 1.5.0's (the gate)

- **What changes in the record:** only `restBack`, an optional field on a chain record. A record 1.5.0 kept has none, and reads as before.
- **No transaction changes:** neither hunk touches a builder.
- **The gate** (`lovejoin-1-5-0.test.ts`, unedited) passes 4 of 4 on both builds.
  - It compares the sealed schedule whole after every step, and m1 shows it would catch a mark on its vault's chain.
  - That chain is never marked here: it was cut at 4 of 10.
- **A 1.5.0 record that does gain the mark:** one cut after every mix whose rest comes back directly under 1.6.0. Only carriedOf reads the field.

### 4. No trap is swallowed

- **sortOut's mark:** plain JavaScript inside the update.
- **`restBack`:** it surfaces no trap (finding 1's *Today*).
- **noteLanded:** it hands a trap on (P8). A `WalletLocked`, or Lovejoin's own failure, counts as nothing marked (fx-cut-2's call 3).
- **sendBack's catch-all:** finding 1.

### 5. The whole fix in the live run's state, and with the 6–24 h delay

- **`zz-5b-1` test 3** (records): wallet B's records as R1 builds them, a cut chain at 5 of 8 and its rebuilt tail and return all sent. They're read every 10 minutes for 25 h, with a pool read every hour, at each Settings delay.
  - **The result:** never stopped partway, never a row, and the card done while the record is kept.
  - **1–6 and 2–12:** the first pool read writes the mark (fx-cut-2's call 2). Both records go at 3 h.
  - **6–24:** the carrier's record goes at 3 h. The cut chain's, carrying `restBack`, goes at 5 h, its `at` + 6 h.
- **`zz-5b-2`** (end to end): P1's flow, with the real WebAssembly, the lock and the unlock. The rebuilt tail and return are sent and landed.
  - **Then:** the alarm's runs every 10 minutes for 26 h: `runAll`, then `withdrawDue` (each withdraw landing), with a pool read every hour. Run at 6–24 and at 1–6.
  - **The result:** never stopped partway, never a row, the card done while kept, and no errors.
  - **The withdraws:** two went by themselves, at 15 h and 15.7 h (6–24), and at 3.5 h and 4.2 h (1–6).
- **`zz-5b-1` test 1:** the tailChain shape (P2's) under 6–24. It's done before; 3 h on, a pool read leaves the cut chain's record alone, with `restBack`, and it's still done.
- **Wallet B was a private mix, the tests a site's session.** Their records don't differ here:
  - both put Settings' delay on the cut chain (`sessions.ts:4494`);
  - neither puts one on the chain built in its place, since `auto.lovejoin` is unset for both (`:4383`; a mix session's `auto`, `:2175`).

## Also checked

- **The pages' readers:** handlers' `held`, `chains` and `mixes`, and the UI's MixCard and `clearable`, read only the chain views. A carried chain stays clearable.
- **e2e's stopped chains are never carried:** a public mix at 1 of 5; a site's chain at 4 of 10, short of its mixes.
- **Untested, but only ever too few marks:** noteLanded's bound takes the latest confirmed return (`Math.max`). No test holds two, so a change to `Math.min` would pass. Its only effect would be fewer marks, in a rare case where two returns' answers were lost.

## Checks run

- **Baseline on the tree:** stopped-shown and the gate, 13 of 13; the planner `-t LIVE-1`, 9 of 9.
- **The full unit suite on the tree, throwaways in:**
  - 250 files passed and 1 skipped; 2,980 tests passed and 4 skipped; exit 0;
  - 2,894 of those tests are the tree's own: last-5's 2,889, and fx-cut-2's five;
  - the log is `last5b/full.log`.
- **Preprod build** (`VITE_ENABLE_MAINNET=false`):
  - stopped-shown, the gate, maybe-sent and `zz-5b-1`: 41 of 41;
  - the planner's LIVE-1 block: 9 of 9.
- **`tsc --noEmit -p .`:** clean, run in the copy (`src` identical to the tree's, no throwaways).
- **Mutation m1:** made in the copy, and put back (a `diff` of `lovejoin.ts` against the tree's came out identical).
- **Not run:** builds, Playwright, cargo, a formatter, mainnet.
