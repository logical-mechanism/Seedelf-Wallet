# 1.8.0's release review, the last look: last-docs

*Written by the lead from the reviewer's and tracers' structured outputs (workflow `wf_c2848997-13c`).*

## last-docs#0: The docs still give a 96-box deposit, which no pool the wallet deposits in takes since 1.8.0

**Severity:** low · **Trace:** PARTLY

**Where:** seedelf-platform/seedelf-web-wallet/docs/architecture.md:701, seedelf-platform/seedelf-web-wallet/docs/flows.md:523, seedelf-platform/seedelf-web-wallet/docs/privacy.md:198

**Claim:** `new`: 1.8.0 made this false. architecture.md:701 says one deposit holds at most 96 boxes (`MAX_DEPOSIT_BOXES`) and that a return's spare ADA past that comes back with its change. Since 1.8.0 a return's deposit goes into v2's 5 ₳ pool, which takes at most 64 boxes a deposit (`MAX_TOKEN_DEPOSIT_BOXES`). The 96 cap is the classic pool's, and the classic pool now takes no deposit. flows.md:523 ("at most 96 boxes (64 in a token pool)") and privacy.md:198 ("(96, or 64 in a token pool)") still offer a Bootstrap that big, though only v2 pools take one now. This contradicts the release's own new text at privacy.md:199 ("one deep 64, one deposit's most on the new scripts").

**Scenario:** Settings' depth at 1. A private session comes back with about 500 ₳ spare, and v2's 5 ₳ pool has room. 64 boxes (320 ₳) go in and the rest comes back at once. architecture.md:701 says up to 96 go in. On a v2 pool's page, Bootstrap's stepper stops at 64, but flows.md:523 says up to 96.

**Evidence:** Code:
- lovejoin.ts:3740 (fanOut's `fit`): `const deposits = pool.id === CLASSIC ? chainBoxes(depth, w) : Math.min(chainBoxes(depth, w), MAX_TOKEN_DEPOSIT_BOXES)`.
- lovejoin.ts:1777: `MAX_TOKEN_DEPOSIT_BOXES = 64`.
- lovejoin.ts:3597: a return's pool is `adaPool`'s, a v2 pool, never CLASSIC.
- sessions.ts:1829: priced's `most` is capped at 64 too.
- lovejoin.ts:1780: `mostBootstrap` gives 96 only for CLASSIC, and both Bootstraps refuse a retired pool before anything is built (lovejoin.ts:4685, 4154-4163).

Test: in my sandbox, `npx vitest run tests/lovejoin.test.ts -t "one wave deep through Lovejoin" --maxWorkers=2` gives 1 passed. That test (tests/lovejoin.test.ts:871, "takes a large return one wave deep through Lovejoin… (final review lovejoin-5)") expects `boxes: MAX_TOKEN_DEPOSIT_BOXES` (64) into the 5 ₳ pool. It is the same ID architecture.md:701 cites for the 96.

**Fix:** - architecture.md:701: "...and one deposit at most 64 boxes in a pool on Lovejoin's newer scripts (`MAX_TOKEN_DEPOSIT_BOXES`), every pool a return or a Bootstrap goes into since 1.8.0 (the classic pool's was 96, `MAX_DEPOSIT_BOXES`): a return's spare ADA past that comes back with its change".
- flows.md:523: "at most 64 boxes".
- privacy.md:198: "(64, one deposit's most on the new scripts)".

**Trace, reach:** Wider than reported. Every claim the finding makes holds, but the same stale cap sits in a fourth sentence it doesn't name: architecture.md:673, "(`mostBootstrap`: MAX_DEPOSIT_BOXES, a token pool's MAX_TOKEN_DEPOSIT_BOXES)". Fixing only the three named places would leave :673 contradicting the corrected :701.

Low, `new`. All four sentences are unchanged since 1.7.2 (`git show 6b70c1f8:` gives the same text), and 1.8.0's move of returns and Bootstraps onto v2 pools is what made them false:
- **architecture.md:701** was true in 1.7.2, when a return's deposit went into the classic pool, capped at 96 (1.7.2's tests expected `MAX_DEPOSIT_BOXES` there). It's false since 1.8.0.
- **flows.md:523, privacy.md:198 and architecture.md:673** have an older half. Their "(64 in a token pool)" has been imprecise since 1.6.0's MONEY-6, because an ADA pool on the newer scripts also took 64 (tests/lovejoin-release-rules.test.ts:482 pins a 25 ₳ ADA pool at 64). 1.8.0 made the 96 true of no pool that offers a Bootstrap, and made that imprecise case the only case: v2's 5 ₳ ADA pool, the only pool for now.

Where it bites:
- A return one wave deep whose spare ADA pays for more than 64 boxes, in a pool with room (about 130 free others, counting the collateral's two draws).
- Every Bootstrap's upper bound.
- Two and three waves deep, MAX_CHAIN_MIXES binds first (32 and 10 boxes), so the deposit cap isn't reached.

It's docs only, with no money or privacy effect. The code caps at 64 everywhere, and the form's range and refusal are computed (`lj.boxRange.bootstrap` takes `{{most}}`). No shown string, store copy, README or other doc says 96.

Outside this part (code comments, a nit for last-code or the lead): lovejoin.ts:1761-1764 (MAX_DEPOSIT_BOXES's doc, "Past it, a return's spare ADA comes back with its change") and :3734-3737 (fit's "one deposit makes (MAX_DEPOSIT_BOXES; a token pool's, MAX_TOKEN_DEPOSIT_BOXES)") say the same stale thing.

**Trace, trace:** The return's deposit:
- chain() picks the pool at lovejoin.ts:3597: with `pool === undefined && !again`, `into = await this.adaPool(network, true)`.
- adaPool (:4180-4188) returns `adaPoolOf`'s pick (:676-677): `!p.token && p.ref && !p.copy && !isRetired(p) && p.lovelace === COLLATERAL_LOVELACE`. `isRetired` (:666) is `pool.id === CLASSIC || pool.version !== "v2"`, so a return's pool is never the classic pool.
- A named pool that is retired is refused before any build: :3627-3634 calls `takesNewBoxes`, which at :4156 answers "retired" with no read. That covers a 1.7 session's classic-pool Bootstrap or mix: it comes back directly.
- fanOut's `fit` (:3740) is `pool.id === CLASSIC ? chainBoxes(depth, w) : Math.min(chainBoxes(depth, w), MAX_TOKEN_DEPOSIT_BOXES)`, with MAX_TOKEN_DEPOSIT_BOXES = 64 (:1777). `chainBoxes` (:1769-1770) is `min(96, ⌊130 / mixesPerBox⌋)`: 96 at depth 1, then 64 for every reachable pool. Two waves deep gives 32 and three gives 10, so the deposit cap binds only one wave deep.
- A return with tokens: acrossOf (:3948-3950) caps the ADA and token legs together at `Math.min(MAX_TOKEN_DEPOSIT_BOXES, ⌊MAX_CHAIN_MIXES / perBox⌋)`, one deposit's 64 in total.
- A swap's priced (sessions.ts:1829) also caps at `Math.min(chainBoxes(one.depth, w), MAX_TOKEN_DEPOSIT_BOXES)`.

The Bootstrap:
- `mostBootstrap` (lovejoin.ts:1780) gives 96 only for no pool or CLASSIC, and 64 for any pool with another id.
- From the public account, publicBuild runs `checkBoxes(boxes, mostBootstrap(pool))` (:4681), then refuses a retired pool (:4685). So the classic pool's 96 passes the size check and is then refused as retired.
- From the private balance, mixOutBuild (sessions.ts:2153, :2157) goes through privateBootstrapMost, whose takesNewBoxes (lovejoin.ts:3070) refuses a retired pool.
- The form doesn't show Bootstrap in a copy or a retired pool (Lovejoin.tsx:2737-2738, `closed`). `bootstrapLimits` (:3721-3722) uses `pool.id ? 64 : 96`, and every v2 pool has an id, so the stepper stops at 64.

In the docs:
- flows.md:523's own paragraph ends "None is offered in a retired pool". Its "at most 96 boxes (64 in a token pool)" therefore points to a 96 that only a retired pool ever had.
- privacy.md:198's "(96, or 64 in a token pool)" sits beside :199's "one deep 64, one deposit's most on the new scripts". :199 is a + line in `git diff 1beba3fb`, the release's own text. On their face the two disagree about v2's 5 ₳ ADA pool.
- architecture.md:731 and :739 already say deposits and Bootstraps go only into pools on v2's scripts, and that the classic pool is retired.

**Trace, evidence:** Docs, in the merged worktree (uncommitted, read as they'll ship):
- architecture.md:701: "one deposit at most 96 boxes (`MAX_DEPOSIT_BOXES`) … a return's spare ADA past that comes back with its change (final review lovejoin-5)".
- architecture.md:673: "(`mostBootstrap`: MAX_DEPOSIT_BOXES, a token pool's MAX_TOKEN_DEPOSIT_BOXES)". The finding misses this one. The release's docs change touched this line but left the parenthetical.
- flows.md:523: "at most 96 boxes (64 in a token pool)".
- privacy.md:198: "(96, or 64 in a token pool)".
- privacy.md:199 (new): "one deep 64, one deposit's most on the new scripts".
- All of :701, :673, :523 and :198 match 6b70c1f8 (1.7.2) word for word, checked with `git show`.

Code: lovejoin.ts:666, 676-677, 1766, 1769-1770, 1777, 1780, 3597, 3627-3634, 3740, 3948-3950, 4154-4163, 4180-4188, 4681, 4685; sessions.ts:1829, 2153, 2157; Lovejoin.tsx:2737-2738, 3721-3722. Every line the finding cites checks out. At 1.7.2, fit's formula was the same (lovejoin.ts:3552 there), and tests/lovejoin.test.ts expected `MAX_DEPOSIT_BOXES` for the return (its :797, :822). Chunk 44 moved those expectations to `MAX_TOKEN_DEPOSIT_BOXES`.

Tests, run in the last-docs sandbox at 4ad4dc06, read-only (no mutation, since the sandbox is shared):
- `npx vitest run tests/lovejoin.test.ts -t "one wave deep through Lovejoin|puts no more boxes in one deposit than a transaction holds" --maxWorkers=2` gives 2 passed, 90 skipped.
  - :871 runs a real backBuild on preprod: a 1,600 ₳ session, depth 1, 300 other people's boxes in the pool. It expects `{ boxes: MAX_TOKEN_DEPOSIT_BOXES, depth: 1, pool: ADA }`.
  - :838 expects the chain to ask for `[MAX_TOKEN_DEPOSIT_BOXES, MAX_CHAIN_MIXES]`.
- `npx vitest run tests/lovejoin-release-rules.test.ts -t "caps every pool but the classic" --maxWorkers=2` gives 1 passed. Its :482 pins an ADA pool with an id (a 25 ₳ box) at 64, and :481 pins the classic pool (no id) at 96.

**Trace, fixJudgment:** The finding is right in substance at all three places. Two adjustments: reword :701, and add architecture.md:673. Exact words:

1. **architecture.md:701.** The finding's text works, but "Lovejoin's newer scripts" isn't a term the docs use (architecture.md:731 and :739 say "v2's scripts"). It also drops "which a transaction's 16 KiB holds with room to spare" (still true: 64 token boxes fit with 31 inputs, per lovejoin.ts:1774-1775) and the closing "(final review lovejoin-5)". Replace "and one deposit at most 96 boxes (`MAX_DEPOSIT_BOXES`), which a transaction's 16 KiB holds with room to spare: a return's spare ADA past that comes back with its change (final review lovejoin-5)." with:

"and one deposit at most 64 boxes, in any pool on v2's scripts (`MAX_TOKEN_DEPOSIT_BOXES`; the classic pool, retired, took 96, `MAX_DEPOSIT_BOXES`), which a transaction's 16 KiB holds with room to spare: a return's spare ADA past that comes back with its change (final review lovejoin-5)."

This is also true of a return carrying tokens, whose boxes share that deposit's 64 (acrossOf :3948-3950).

2. **flows.md:523.** As the finding gives it: "at most 96 boxes (64 in a token pool)" becomes "at most 64 boxes". The paragraph already says "None is offered in a retired pool", so the classic pool's 96 needs no mention.

3. **privacy.md:198.** As the finding gives it: "(96, or 64 in a token pool)" becomes "(64, one deposit's most on the new scripts)". This reuses :199's own words.

4. **architecture.md:673 (add).** Replace "(`mostBootstrap`: MAX_DEPOSIT_BOXES, a token pool's MAX_TOKEN_DEPOSIT_BOXES)" with:

"(`mostBootstrap`: MAX_TOKEN_DEPOSIT_BOXES, 64, in every pool on v2's scripts, an ADA pool's too; MAX_DEPOSIT_BOXES, 96, was the classic pool's, retired)"

No date, no store status, *Seedelf* not involved, and "retired" is the glossary's word for the pools. For whoever owns the code comments, not this docs part: lovejoin.ts:1761-1764 and :3734-3737 want the same correction.

## last-docs#1: architecture.md's Storage table has none of the Lovejoin fields 1.8.0 seals

**Severity:** low · **Trace:** PARTLY

**Where:** seedelf-platform/seedelf-web-wallet/docs/architecture.md:426, seedelf-platform/seedelf-web-wallet/docs/architecture.md:423

**Claim:** `new`. The Storage table lists what `lovejoin.<network>` keeps field by field (`counted`, `recheck`, `bringStopped`, `launches`' `box` and `reviewed`). It has none of 1.8.0's additions:
- `retired`: when the first run retired the old pools, once a network.
- The retired pools' run on `bringing`: it still says "every pool's or one pool's".
- The retired mark on `bringStopped`: it still says "its count and pool".
- `recheck` as retireOnce's owed read, at once and re-armed: it says only "when Stop's one read is due".
- A start's `version` in `launches`.
Row :423 also leaves out the `version` discovery now keeps on each found pool. privacy.md:227/:238 and the policy's row name `retired` and the marks; the design doc's own table, which reads as the full list of what's stored, doesn't.

**Scenario:** Someone checks what the wallet stores before changing Remove wallet, the restore or the policy. They read the Storage table and miss the sealed `retired` time and the retired marks, which are written for every wallet that had boxes in the old pools.

**Evidence:** Code:
- lovejoin.ts:999: `retired?: number`.
- lovejoin.ts:994: `bringStopped?: { back; pool?; retired?: true }`.
- lovejoin.ts:1017: `Bringing.retired`.
- lovejoin.ts:987: the `recheck` doc now names retireOnce's read.
- lovejoin.ts:1056: `LaunchRecord.version`.
- Written at lovejoin.ts:4244 (`s.retired = now`), :4269 (`s.recheck = Math.min(s.recheck ?? now, now)`), :4272, :4279; lovejoin-launch.ts:403 (`version: "v2"`); lovejoin-pools.ts:113 (`FoundPool.version`).

Docs: the table's text, quoted from architecture.md:426: "while Bring every box back now goes, every pool's or one pool's, … `bringing` …; … and when Stop's one read is due, `recheck` …; and its last run stopped by Stop, its count and pool, until it's asked again, `bringStopped`". No `retired` anywhere in the row. The round-two docs diff didn't touch :426 (`git diff -U0 1beba3fb` hunks for architecture.md: 53, 349, 351, 634, …).

**Fix:** - In :426's `lovejoin.<network>` list: "…while Bring every box back now goes, every pool's, one pool's or the retired pools' (`retired`, chunk 44)…; `recheck`, Stop's one read and the read retireOnce owes at once…; `bringStopped`, its count and its pool or its retired mark; `retired`, when the first run on 1.8.0 retired the classic pool and 8131b1d's, once a network". Add the set (`version`) to `launches`.
- In :423: "…with its set (`version: \"v2\"`, none for 8131b1d's)".

**Trace, reach:** **Narrower than claimed.**

**Row :426 stands: `new`, low.**
- 1.8.0 seals five things in `lovejoin.<network>` that the row doesn't say, and two of its phrases are now false.
- `bringing`'s "every pool's or one pool's" leaves out a third kind: the retired pools' run. That run has no `pool`, so it reads as every pool's. This is the same confusion R4 fixed in Try again.
- `recheck`'s "Stop's one read" is wrong twice:
  - retireOnce owes that read at once, with no Stop.
  - withdrawDueNow sets it again 2 hours on while a counted box is still held as spent.
- `bringStopped`'s "its count and pool" leaves out the retired mark.
- `retired` is the one top-level `Schedule` field the list lacks. Otherwise the list names every field 1.7.2's record had. The row is byte-identical to 1.7.2's, where it matched the record.
- `launches`' `version` is only a nit. That list never named `at`, `from` or `account` either.

**Row :423 is not a finding.**
- It never listed a found pool's fields: not its id, and not its values. "As WebAssembly verifies it" covers what WebAssembly answers, the set included.
- The record is unsealed and the same for everyone.
- architecture.md:733 already says the shown rule works per set, and that pools are kept in `seedelf.lovejoinPools.<network>`.

**Not wider.**
- 1.8.0 adds no storage key.
- Its only other new sealed field is `AutoRecord.lovejoin.box` in `sessions.<network>`. That row never listed an approval's fields.

**The scenario overreaches.**
- Remove wallet deletes the record whole, so a Remove-wallet change can't hinge on these fields.
- privacy.md:227 and :238 and the policy's :28 already name `retired` and both marks.
- architecture.md's own :742 names `Schedule.retired`, `Bringing.retired` and `bringStopped.retired`. It never says that `Schedule` is `lovejoin.<network>`, though.
- `bringStopped.retired` is written only after a Stop of the retired run, not for every wallet that had boxes there.
- So the harm falls on a developer who reads the table as the inventory.

**Why it was missed:** DOCSBRIEF.md:37 scoped the writer to architecture.md's Lovejoin section (`:669` on). The table is at :398.

**Trace, trace:** All references are to lovejoin.ts in the merged worktree unless another file is named.

**The code now:**
- `Schedule` is "The sealed schedule, `lovejoin.<network>`" (:890).
- `retired?: number` (:999) is written once, as `s.retired = now` (:4244). retireOnce returns once it's set (:4215, :4221) and writes nothing for a wallet with nothing there (:4212, :4236).
- `Bringing.retired` (:1017) is written:
  - fresh at :4272;
  - widened at :4279;
  - by bringAllBack's `again` (:6952, :6960).
- `bringStopped.retired` (:994) is written only by stopBringingAllBack (:6983).
- `recheck` (:987, whose doc now names retireOnce's read):
  - set at once by retireOnce where it dropped 1.7's counts or released a Bootstrap (:4269, `Math.min(s.recheck ?? now, now)`);
  - set by Stop (:6980) and the run's own stop (:7239), as `Math.min(…, now + SPENT_KEEP_MS)`;
  - set again by withdrawDueNow to `now + SPENT_KEEP_MS` while a `counted` box is listed but held as spent (:6630–6634);
  - SPENT_KEEP_MS is 2 h (spent.ts:33);
  - the owed read waits while a run goes, because withdrawDueNow returns bringAllBackNow first (:6579).
- `LaunchRecord.version` (:1056) is written as `version: "v2"` at lovejoin-launch.ts:403.
- The record's reader keeps all five (:7748–7797).

**At 1.7.2 (`git show 6b70c1f8`):**
- No `Schedule.retired`, no `Bringing.retired`, no `LaunchRecord.version`.
- `bringStopped` was `{ back; pool? }` (:916).
- `recheck` was set only by Stop (:6535) and the run's own stop (:6788), and deleted once read (:6226).

**The docs:**
- In architecture.md:426's `lovejoin.<network>` list, `retired` and `version` each occur 0 times.
- The `sha256sum` of rows :423 and :426 is the same at 6b70c1f8, a6c94743, 1beba3fb and in the merged worktree.
- `git diff -U0 1beba3fb` touches architecture.md only at 53, 349, 351, 634, 647, 658, 671, 673, 686, 694, 707, 723, 730 and 738.

**:423:**
- `FoundPool` (lovejoin-pools.ts:111–116) has `id`, `version`, `ref` and `launch`, plus `PoolValues`.
- verified() sets `version` (:524). keep() (:403) stores the pool through slim() (:671), which keeps it with `...p`.
- The row names only `ref` and `launch`.

**Trace, evidence:** **What the doc says:** architecture.md:426 reads "while Bring every box back now goes, every pool's or one pool's … `bringing` …; … and when Stop's one read is due, `recheck`, wlj-2's notes; and its last run stopped by Stop, its count and pool, until it's asked again, `bringStopped`, L2)". Counting `retired` and `version` in rows 426 and 423 gives 0 for each.

**What the code does:**
- Fields: lovejoin.ts:994, :999, :1017, :987 (its doc) and :1056.
- Writes: :4244, :4269, :4272, :4279, :6952, :6960, :6980, :6983, :7239 and :6633; lovejoin-launch.ts:403.

**What 1.7.2 did (6b70c1f8):**
- `bringStopped?: { back: number; pool?: string }` at :916.
- The only `recheck` writes are at :6535 and :6788, and :6226 deletes it once read.
- No `retired?` field, and no `version?` in lovejoin.ts, lovejoin-pools.ts or lovejoin-launch.ts.

**The rows are unchanged:** each row's `sha256sum` is the same at all four points (row 426: 6cf1d17f…, row 423: cd5ba633…).

**Other docs already name them:**
- privacy.md:227 says `bringing` "marks the retired pools' run `retired`", and after Stop "or that it was the retired pools'".
- privacy.md:238: "when it retired them (`retired`)".
- privacy-policy.md:28, and its 6 November entry at :93.
- architecture.md:742 names `Schedule.retired`, `Bringing.retired` and `bringStopped.retired`.

**:423 isn't a field list:** it reads "every standard pool, as WebAssembly verifies it (its reference UTxO, seed and scripts …), with where its launch is", with no id or values. architecture.md:733 covers the set: "on its set of templates … Kept in `seedelf.lovejoinPools.<network>`".

**Not wider:**
- No added line in `git diff 6b70c1f8 HEAD -- extension/src` names a new `seedelf.` key.
- The other fields 1.8.0 added to lovejoin.ts are in-memory: `LovejoinPool.version` (:641), `CollateralPool.free`, `ChainWay.classic` and `ChainCall.holdTail`.

This rests on reading alone. Nothing here is behaviour, so there's no test to run.

**Trace, fixJudgment:** **The fix is right in substance for :426, but needs three changes:**
1. **`recheck`:** it isn't "Stop's one read". It's set again 2 hours on while a counted box is held as spent (:6633). retireOnce's read is owed at once, but waits while the run goes (:6579).
2. **Two fields called `retired`:** the fix gives the mark on `bringing` and `Schedule`'s time the same bare name in one list. They need telling apart.
3. **Drop the :423 change.** It's accurate (lovejoin-pools.ts:107–108) and harmless, but not owed.

**Exact words for :426:**
- **`launches`:** replace "each with its values (`box`: its ADA, and its token with the quantity) and, where Send" with "each with its values (`box`: its ADA, and its token with the quantity), its set (`version`: `v2`, none on a start before 1.8.0, pr363#0) and, where Send".
- **`bringing`:** replace "while Bring every box back now goes, every pool's or one pool's, how many" with "while Bring every box back now goes, every pool's, one pool's or the retired pools' (marked `retired`, chunk 44), how many".
- **`recheck`, `bringStopped` and the new `retired`:** replace "and when Stop's one read is due, `recheck`, wlj-2's notes; and its last run stopped by Stop, its count and pool, until it's asked again, `bringStopped`, L2)" with "and when a read of the pools is owed for boxes with no due time, `recheck`: 2 hours after a run that sent withdraws stops, wlj-2's notes, or at once where the retired pools' first run dropped 1.7's counts or let a Bootstrap go, read once that run is over or stopped (a Stop never puts it later), and again 2 hours on while a box a withdraw went for is still held as spent, critic#3 and r2-critic#0; its last run stopped by Stop, its count and its pool or that it was the retired pools', until it's asked again, `bringStopped`, L2; and, for a wallet that had something in the retired pools, when it retired them, once a network, `retired`, chunk 44)".

**Severity stays low, and it's `new`:** the row matched 1.7.2's record, and 1.8.0's code made it stale.

## last-docs#2: The escape hatch's lines still say Mix, Bootstrap and Mix again stay on, refused only below the minimum or in a copy

**Severity:** nit · **Trace:** none (a nit)

**Where:** seedelf-platform/seedelf-web-wallet/docs/flows.md:524, seedelf-platform/seedelf-web-wallet/docs/architecture.md:735

**Claim:** `new`: older sentences 1.8.0 made untrue. flows.md:524 says that in a pool whose boxes can't pay their own way back, "Mix, Bootstrap and Mix my boxes again stay on there, from either side … (the owner's call 34, 2026-10-19: the wallet refuses only a box under the network's minimum, or a copy)". architecture.md:735 says "that's only a box below the network's minimum, or a copy". Since 1.8.0 a retired pool refuses all three before anything else. The release's own new lines say so (flows.md:510, :517; architecture.md:739), so the docs now contradict each other.

**Scenario:** A retired 8131b1d token pool whose boxes can't pay their own way back today (the backlog's W4, mainnet). Its page shows Review and Mix my boxes again off with the retired reason, and no Bootstrap. flows.md:524 says all three stay on there.

**Evidence:** - lovejoin.ts:4120-4121: `usableNow` returns `retired` before the copy and minimum checks.
- lovejoin.ts:4154-4163: `takesNewBoxes` refuses `retired` with no parameters read.
- lovejoin.ts:4685 (`publicBuild`) refuses a retired pool before reading the account.
- The docs' own flows.md:517: "is off, saying why, where the pool takes no new box (…), or is retired (chunk 44)".

**Fix:** - flows.md:524: "Mix, Bootstrap and Mix my boxes again stay on there, from either side, but in a retired pool (above): … (the owner's call 34: the wallet refuses only a box under the network's minimum, or a copy; since 1.8.0, a retired pool too)".
- architecture.md:735: "…that's only a box below the network's minimum, a copy, or, since 1.8.0, a retired pool (below)…".

## last-docs#3: The glossary's es row for the listing's words doesn't match what the es listing says

**Severity:** nit · **Trace:** none (a nit)

**Where:** seedelf-platform/seedelf-web-wallet/docs/i18n/glossary.md:162, seedelf-platform/seedelf-web-wallet/docs/store/README.md:147

**Claim:** `new`. The new glossary row for the store listing's words gives es "los contratos actuales de Lovejoin; sus contratos anteriores", and says these are the listing's words. The es listing actually says "…los pools con los contratos anteriores de Lovejoin no reciben ninguna." docs.md's item 9 and its *What the upload must paste* also quote the es line as "…para cada valor de caja con los contratos actuales de Lovejoin; los pools con sus contratos anteriores…", which is not the file's text.

**Scenario:** A later edit of the listing follows the glossary and writes "sus contratos anteriores", which could also be read as the pools' own contracts, so the listing and the glossary drift apart. Or the uploader compares docs.md's quote with the file and finds two different lines.

**Evidence:** `grep -n -o "contratos anteriores[^.;]*"` gives "contratos anteriores de Lovejoin no reciben ninguna" in store/README.md:147. glossary.md:162 has "…; sus contratos anteriores | Lovejoin の現行のコントラクト; 以前のコントラクト". The ja matches in both places; only es differs. Round two's writer didn't touch store/README.md (it isn't in `scratchpad/docs2-lane/before/docs`).

**Fix:** Make the glossary's es read "los contratos actuales de Lovejoin; los contratos anteriores de Lovejoin", the listing's clearer form, and correct docs.md's two es quotes to the file's text.

## last-docs#4: The archived plan says an ask with no 5 ₳ pool looks at Koios's holder, which mainnet with the data layer up never does

**Severity:** nit · **Trace:** none (a nit)

**Where:** seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-44-lovejoin-v2.md:68

**Claim:** `new`. The plan's 44c says "an ask for the 5 ₳ pool (a return's build, a swap's Review or Stop, a funding's review, Put in 5 ₳) that finds none kept or listed looks at Koios's holder, as the page does, at most every 5 minutes…". On mainnet with the data layer answering, an ask that finds none listed reads no holder: the look stops once the list has answered within REFRESH_MS. The holder is read only where the data layer doesn't answer (preprod, Koios-only, the data layer down). architecture.md:740 and development.md:331 say this correctly.

**Scenario:** Mainnet, the data layer up, no v2 5 ₳ pool listed. A return's build asks: one `lovejoin/pools` request at most, and no Koios `credential_utxos` of the holder. The plan says the holder is read.

**Evidence:** - lovejoin-pools.ts:432-439: `lookSoon` calls `refresh`, then `if (this.answeredWithin(network, at)) return;` before `scan`.
- lovejoin.ts:4180-4188: `adaPool` reads the list first.
- Pinned by tests/lovejoin-round2-retire.test.ts:497 ("mainnet, the data layer up: … asks nobody, its list neither"); that file passes in my sandbox, 9 of 9.

**Fix:** "…that finds none kept or listed looks as the page does: the data layer's list, and Koios's holder where that doesn't answer (preprod, Koios-only, the data layer down), at most every 5 minutes a network while the worker runs…".

## Covered

- The privacy policy, docs/store/privacy-policy.md. Its *Effective* line (6 November 2026, with the three new items), the *Your Lovejoin boxes* row, *Lovejoin's pools* (:46) and the 6 November entry (:93) all hold against the merged code.
- Every request the merged code makes that 1.7.2 (6b70c1f8) didn't, found by diffing lovejoin.ts, sessions.ts, lovejoin-pools.ts, lovejoin-launch.ts, dapp.ts, handlers.ts and sw.ts against 1.7.2's saved copies. Each is in the policy, with when it happens:
- - adaPool's ask (lovejoin.ts:4180-4188): the data layer's list, then `lookSoon`.
- - `lookSoon` (lovejoin-pools.ts:432-439): `refresh`, then Koios's holder, throttled by `scanned` (in memory) and `answeredWithin`.
- - bringAllBack with no pool named looks first (lovejoin.ts:6931), and only Settings' press names none (BringAllBack.tsx bringAsk).
- - Every caller of adaPool(…, true): chain() :3597, collateralPool :4301 (buildBack's pick, a mix's and Mix again's tailReserve), collateralRoom :4324 (a swap's Review, a site's funding, a top-up with a new collateral), priced :1796 (Review, Stop), lovejoinRoomNow :2069, and collateralWanted(ask) :4893 (a return with no collateral, Put in 5 ₳).
- - lovejoinRoomNow's pool read at a site's funding review with the collateral switch off (sessions.ts:2018, 2065-2077).
- - The mainnet floor's read in collateralWanted (sessions.ts:4896, room(…, !ask) with floor > 0; networks.ts floor 0 or 30).
- - The first unlock's run: retireOnce (:4214-4283), then bringAllBackNow's withdraws (giveme.my and the Cardano server; a stuck pool's box paid from the private balance), and recheck's owed read at the next run, re-armed (:6630-6634).
- - No new request in cuts, retiredIds, the quote, the session list, the connect card (lovejoinRoomKept's quiet room), funding() with a pool object, poolNamed, the launch, status' params or P2's rebuild loop.
- Nothing the policy says goes beyond the code:
- - The retired pools take nothing (isRetired :666, usableNow :4120, takesNewBoxes :4154).
- - The bring-back's one-after-another withdraws, its private-balance payer, and the after-a-restore case (status, then retireOnce's `named`).
- - The 5 ₳ pool and its floor.
- - The look's moments, the five minutes on both halves, and "names nothing of yours".
- - The kept fields: Schedule.retired, Bringing.retired, bringStopped.retired, the `recheck` doc.
- privacy.md lines 124, 195-199, 202, 217-218, 221, 227, 229-233 and 236-238. Checked P3's figures: chainBoxes, MAX_CHAIN_MIXES 130, MAX_TOKEN_DEPOSIT_BOXES 64, MIX_FEE_ESTIMATE 0.95 ₳; 160/320, 50/100 and 320/960 ₳ hold. Also the retired run's owed read and its re-arm, and the throttles' "while the worker runs" (PUBLIC_LOOK_MS's `looked` at :2781). The round-two hunks check out on the throttles, P1 and the retired run (:124 :202 :230).
- architecture.md: the trap list (:53), the public look (:349, :351), :634, :647, :658, the Lovejoin section's changed lines, and the new block (:738-:749), each against its code:
- - adaPool and lookSoon.
- - retireOnce's order: cuts, R3's undecided, R1, released, tail.over, counts, recheck, and widening.
- - bringAllBack's widen/join/refuse, and bringAsk's Try again.
- - `shownOnHub`, `takes = !unusable`, `fiveOnly` and `noneTakes` (Lovejoin.tsx:1948-1959).
- - BringAllBack's otherRetired, and the run's words on a retired page (goingText).
- - priced's `held`, roomLeavingTail and roomIn, stopCost's `takes === "yes"`, and tailDrawn.
- - collateralRoom with rooms() handing a trap on, and the costs line.
- flows.md :63, :73, :128, :428, :470, :478, :480, :484, :490, :501, :507, :510, :513 (mixCosts 4×0.95 + 3×0.25 + 0.3 = 4.85 ₳, 97%, private side), :517-:519, :522, :529-:531. Every en string flows.md quotes matches en.json word for word: noAdaPool, onPoolShort, atMost, boxesLabel, retired, noneYet, aside, asideAda, asideTokens, bringingRetired, bringRetiredTitle, bringNoneRetired, otherRetired, backCollateral.notNeeded, home.lovejoin.flagged. The connector's note choice matches DappApprovals.tsx:495-503.
- lovejoin-mix-width.md, recomputed:
- - 99.0%, 100,250,656 left, 58.2% and 15.1 billion.
- - v2 against 8131b1d: +6.08M steps at N=3, +10.77M at N=4.
- - 111M and 118M; 21% memory and 8.3 KB at N=6; 11.00 and 16.74 and 23.69 billion; 0.20 billion left in a block; 17.0 billion; 42% spare.
- - The cost table: 0.84/1.23, 3.35/6.15 and 10.88/25.84 ₳, with mixes (N^d−1)/(N−1) and others N^d−1.
- - "1.1% dearer" holds (1.01% already fails); V5 = tests-e2e#5 matches every_width_measured.
- README.md :47, :57 and the new paragraph. Checked xor32's two length checks in Lovejoin 29573c5's sigma_or.ak, read-only, and that every relative link resolves.
- development.md:
- - release_version 1.8.0 and the zip name.
- - The checklist's head-start pools, from src/lovejoin-pools.json: preprod has MIN's two, 5 ₳, 7 tADA and v2 47bece42; mainnet has dc6abe3b alone.
- - BRING_FAILED_RUNS 3 and the Try again words.
- - The head start paragraph (:331).
- - The Cardanoscan step against scripts/lovejoin-registry.mjs. In my sandbox, with the merged worktree's three uncommitted registry files copied in, `npx vitest run tests/lovejoin-registry.test.ts` gave 4 passed.
- backlog.md's new and changed lines, against the code and FIX2BRIEF's calls. D3 at width 4 is recomputed: 4 free at depth 1 or 16 at depth 2 gives one box at both widths, and four leaves the tail one draw. Also checked: the collateralWanted floor-only test, Put in 5 ₳'s refusal words, and the three closed items' removal.
- docs/store/README.md: the en, es and ja Lovejoin bullets are true of `adaPoolOf`, the per-set shown rule and isRetired, and es and ja read naturally. The permission justifications are still true of 1.8.0's Koios use.
- glossary.md's new section matches es.json and ja.json for every retired value: lj.unusable.warn.retired, bringingRetired_*, bringNoneRetired, bringRetiredTitle and otherRetired.
- The archived chunk-44 plan: its status, the owner's words, 44b, 44c, 44d and *What its PRs did*. Its links resolve, and no tracked file links the old path.
- Round two's translations (`git diff 4b4628e9 HEAD -- extension/src/i18n/translations/`): es floorShort (lowercase after the colon frames; Swaps.tsx capitalises the swap's opening with `opening()`), es noteLovejoinMixed, asideAda (es, ja) and otherRetired (es, ja). They read naturally, match the glossary ("los pools retirados", 廃止されたプール) and sit with their sibling keys. Every ₳ in them has its U+00A0.
- House words: no lowercase seedelf in the added prose (folder links only, as the README already does), no release dates (only the owner's calls, measurement dates and the glossary's review date, which follows the 1.6.0 precedent), no store status. Every code name the new text cites exists (470 names checked), every relative link and anchor resolves (a checker over the 11 files), and no shipped doc has a file:line reference.

## Not checked

- The README (:59) and the plan (:4) say seedelf-verification proves v2's mix_logic bytes. The review brief puts seedelf-verification out of scope, so I didn't open it; I relied on seedelf-platform/CLAUDE.md, which says the same.
- lovejoin-mix-width.md's measured figures themselves (the steps, memory, sizes and fees in its tables). I didn't run the Rust harness (lovejoin_width_test), since Rust runs are the pr363 reviewer's. I checked only the arithmetic and that the doc agrees with itself and with every_width_measured's source. The cost section's "0.823/1.214 ₳ with it in the middle" beside tables marked fee-input-first is older text, and the gap is probably below rounding. Not shown.
- The plan's data-layer claims (a data layer from before 44a refuses a v2 pool and keeps that verdict until it restarts; the deploy owed before the mainnet launch), and seedelf-data/README.md, which isn't on this part's list.
- On-screen wording during the retired run (Settings and pages), the hub's aside and Home's row: checked by reading the components and en.json, not rendered and not run in e2e (no Playwright).
- Whether a native speaker would phrase the es and ja exactly so. I judged naturalness and consistency only, as the brief says. The listing's changed es and ja lines and es noteLovejoinMixed still await the lead's blind back-translation.
- docs/plans/review-1.8.0/docs.md, the round-one and round-two writers' report, is not a shipped doc. I checked only its es quotes (last-docs#3). The 1.8.0 review record the docs cite IDs from (an archive file like review-1.7.x.md) doesn't exist yet; that's the lead's.
- privacy.md doesn't mention the new mainnet pool reads (a return with no 5 ₳, Put in 5 ₳'s press) or the site funding review's read with the collateral switch off; the policy has all three. Round two's writer left this on purpose; it's an omission, not a false sentence.
- The registry script's other behaviours: no mutants run, no run against the fork, and its odd refusal text ("<id> verifies as <set> pool <id>") unjudged, since it's a tool and outside this part's list.
- docs/releases.md and verified-critical-*.json, which are the lead's (DOCSBRIEF's *Don't*).
