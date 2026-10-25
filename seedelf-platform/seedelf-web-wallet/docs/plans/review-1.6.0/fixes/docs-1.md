# docs-1: the fix round's report

Doc-only findings, part 1. Every claim written was checked against the code at `9978654a` first (file and line in each entry). No new tests: doc-only changes, plus two code comments. No string keys touched.

## Findings

### 312#2: fixed
- `lovejoin-mix-width.md` line 3: three boxes "by default". Four is an option. A session's collateral's mix always takes three (`collateral_mix`: `fresh_for(1, 1, 3, …)`, core `lovejoin/mod.rs`).
- The fallback paragraph (line 15) now names the Mix form's and Mix my boxes again's own switch (`FourSwitch`, Lovejoin.tsx), and says swaps' and sites' returns keep Settings' width. It splits the three rules: a chain goes three and says why (`widthFor`, `wayOver`; `FOUR_REFUSED` on a refused build or network check). The Mix form's stepper stops at what fits four. Mix my boxes again takes what fits four and leaves the rest for the next press, going three only where four takes none (`againWay`, lovejoin.ts:2169-2173).
- "The wallet's mix always has the same shape" now says "a four-box mix". The collateral's mix has another shape (giveme.my's collateral), but it's never four wide.
- The web wallet README's docs row: "three boxes by default … why four is an option and not the default".
- `plans/chunk-34-token-pools.md:210`: "so token pools stay three wide" now points to D3. Also :328 ("N stays at 3"), the same stale claim, gets a pointer to D3.
- Test: none (docs).

### 312#3: fixed (part 2 refuted, as the skeptic found)
- Part 1, the touch list: the path is now `seedelf-core/src/lovejoin/mod.rs`. It lists `WIDTHS`/`check_width`, `mixes_per_box_at`, `MIX_FEE_ESTIMATE_FOUR`/`mix_fee_estimate`, the `*_in` funding sums, `LOVEJOIN_WIDTHS` (preferences.ts:91), `CHAIN_WINDOW_FOUR`/`chainWindow`, the width rules (`widthFor`, `wayOver`, `againWay`), and `depthCost`/`lovejoinHides` on the screens. It adds `eval::MEASURE_LIMIT` (eval.rs:31, 14 billion): `mix_logic` alone needs 14.9 billion at five boxes (the page's own table), so five fails measurement whatever `MAX_TX_BUDGET` says. That holds whether uplc spends the limit per script or across the transaction. It says `networks.ts`'s `mixCost` is still a three-box figure that nothing reads (grep: no reader).
- Part 2: refuted. A shown pool keeps both scripts at the holder (`lovejoin-pools.ts` drops `scriptsInline !== 0` at :451 and :515; core `pool_of`, pool.rs:381-409). So the wallet's token-pool mix reads three reference inputs, the shape the table measured. I decoded the fixture's addresses by hex: the NFT reference at 0x70 `288fea77…` (`REFERENCE_HOLDER_HASH`), both script references at a base key address 0x00 `bf53dc99…`. One sentence under *How it was measured* now says so, to head off that misreading.
- Test: none (docs).

### docs-small#1: fixed
- Plan §2, step 5: added "As built (34c, decision 30)". L is checked once, when the pool is found. Koios's look reads the launch's certificates, or L's earlier registration (`account_update_history`; koios.ts `firstRegistrations`). From the data layer's list it's the server's word.
- §2, *Usable*: the registration bullet is struck, as the plan strikes elsewhere. It's not checked at a read: decision 30, `mix_logic` refuses deregistration (11), and the worker passes `registered: true` (lovejoin.ts:2474, :3431). The call-34 note now names "the min-UTxO check", not "the first check".
- architecture.md, *Which pools are shown*: from the data layer's list, the wallet checks a pool is genuine and of a listed value (`verified`: `lovejoinVerifyPool`, `listedValue`). Whether it's finished, and where its launch sits (which `shown()` works the earliest out from), are the server's word. Koios's look works those out itself (`launches` = `tx_info`; `firstRegistrations`). Nothing checks L again.
- Not done: the optional one-time L check on the data-layer path. It's code, and the owner's call (below).
- Test: none (docs).

### docs-small#2: fixed
- keys-and-accounts.md:129 adds the two 1.6.0 uses of the public account's collateral:
  - a pool started from the public account (`launch_from_account`, launch.rs:562, which puts up the account's own collateral, `account_collateral`, and refuses one too small, :447);
  - a box brought back with the public account paying (`paid === true`, lovejoin.ts:6107-6111: `lj.needCollateral` without one; core `withdraw_paid`).
- It also says a box coming back by itself and a session's collateral's mix use giveme.my's.
- The root README's collateral paragraph names the same two (with gap-3#1).
- Test: none (docs).

### docs-small#3: fixed
- Plan §5's last bullet: the change goes under the merged history of what it spent (`changeHistory`, script-spend.ts:171-173; lovejoin-launch.ts:309), as every Seedelf spend's change does.
- Test: none (docs).

### gap-3#0: fixed
- flows.md, the private swap's *Back* (was :477):
  - the setting's current name (en.json `settings.lovejoin.collateral`);
  - the floor and two free boxes (`collateralPool`, lovejoin.ts:3474-3483, `TAIL_DRAWS`);
  - the deposit, then one mix with two other people's boxes under giveme.my's collateral (wasm `CollateralTail`, core `collateral_mix`/`mix_giveme`);
  - the return after it sweeps the rest into new private UTxOs, never merged (wasm lovejoin.rs:1777-1795: `merge` is `&[]` with a tail), with a pointer to §521.
- The preference's doc comment (`extension/src/shared/preferences.ts`, `lovejoinCollateral`) is rewritten the same way. It also says the setting applies wherever the return goes through Lovejoin, whatever `lovejoinReturns` says, since `collateralIntoPool` reads `lovejoinCollateral` alone (sessions.ts:4313-4315).
- Test: none (a doc and a comment).

### gap-3#1: fixed (but :512, left as the screen reads)
In each flow, where a 5 ₳ pool would mix the collateral:
- the funding's first payment carries the reserve (sessions.ts:1752/1761 swap, :1837/1843 site, :1961/1968 mix, :2047-2048 top-up);
- the review shows *For its collateral's mix* next to the collateral row (Swaps.tsx:1332, DappApprovals.tsx:734, SiteSessions.tsx:599, Lovejoin.tsx:3277);
- the return sends the collateral's deposit and mix first, then sweeps the rest.

Lines changed:
- flows.md:449 keeps "with no giveme.my" for the return itself and adds the exception;
- :468 and :471, the swap's review rows and funding;
- :477, as above;
- :489, the site's funding review;
- :493, Top up: not listed in the finding, but the same omission;
- :513, a mix's funding and its return.
- :521 and architecture.md:632 add the by-hand exception. *Put in 5 ₳ to cancel* and *for Lovejoin* (`collateralTopUp`, sessions.ts:2174) pay exactly 5 ₳ and no reserve (Session 11's call 4). The mix is then paid from what's left, where that's enough: wasm `CollateralTail::build(...).ok()` on the chain's change, or `direct_tail`'s other ADA. Otherwise the collateral comes back with the rest.
- architecture.md:735 counts what the tail adds: a pool read as the return is built (`collateralPool` → `split`), two submits, and an evaluate plus giveme.my's witness before the mix. Both are asked again after each wait (1 minute doubling to 30, `TAIL_WITNESS_WAIT_MS`), for a day at most after the deposit lands (`TAIL_KEEP_MS`; `witnessTail`, sessions.ts:4780-4808).
- Root README.md:255: giveme.my also backs a box coming back and the collateral's mix. The public account's list adds starting a pool and paying for a box's way back.
- Left: flows.md:512 describes the Mix form's figures, which really show no reserve and count the 5 ₳ as coming back. The skeptic called that the screen's problem (gap-3#2, 323-worker#1), not the doc's. Docs to update below.
- Test: none (docs).

### gap-3#3: fixed
- flows.md:420: the web wallet's Max takes every UTxO, those adding the most first, 20 a transaction and 25 transactions at most (`max_in_parts`, wasm lib.rs:4288-4305; `MAX_PARTS` 3582; `MAX_WITHDRAW_UTXOS` 3249). The CLI half was checked: `collect_wallet_utxos` stops at `MAXIMUM_WALLET_UTXOS` = 20.
- architecture.md:163: Max on private Send goes in parts (`buildTransferParts`, `max_in_parts`), and Make public's too (`buildWithdrawParts`). Each part is built as one transaction's Max is (`transfer_most` on `max_inputs`). Only the last part's `left` counts (lib.rs:4352-4361). The worker never calls `buildTransfer` (grep: transfer.ts:116, withdraw.ts:105 and sessions.ts:2704 call the parts builders; sessions.ts:2707 calls `buildWithdraw` for a one-transaction funding).
- :162 and :109 say the per-part builders and per-transaction `max_inputs`.
- Test: none (docs).

### gap-3#4: fixed
- seedelf-platform/CLAUDE.md, *Script spends*: `max_inputs` picks one transaction's Max inputs, at most the `at_most` it's given (the web wallet's 20). A new sub-bullet covers the web wallet's Max in parts: up to 25 transactions, `max_in_parts`, each part picked by `max_inputs_by`. It also covers `carry()` and `build::carried`: a chained part is built before the carry is on chain and sent once it is.
- *Things that bite*: `settle` also refuses an output over `MAX_VALUE_SIZE` (5,000, `value_size`; build.rs:135-138, :258-262). Both size refusals are `TooLarge` (`is_too_large`). Too much computation is `TooMany` (`is_too_many`; :503-524, raised at :2004). Both size limits are the ledger's own, so neither refuses what the node would take.
- A new bullet covers `lovejoin::mix_giveme`: the collateral's mix under giveme.my's collateral (core lovejoin/mod.rs:803, `collateral_tail`). giveme.my signs only once every input is on chain.
- architecture.md:125 gets the same limit and typed errors. The output limit came with 1.6.0's payments in parts (`1cd50dba`, in #321).
- Test: none (docs).

### gap-3#5: fixed
- flows.md:102: Settings' Lovejoin list adds the collateral switch, *Four boxes a mix* and **Bring every box back now**. The "asks Koios nothing, except" list adds **Bring every box back now**. Pressing it reads every pool at once (the data layer or Koios) and sends each box's withdraw, giveme.my witnessing each. Evidence: handlers.ts:552-555 runs `withdrawDue` at once, and `withdrawDueNow` hands off to `bringAllBackNow` (lovejoin.ts:5504), which reads every pool through `ours`.
- Test: none (docs).

### gap-3#7: fixed
- flows.md:521: the collateral switch isn't "off with the returns' switch". It's greyed and keeps its setting (Settings.tsx:848, :852). A return that goes through Lovejoin anyway, as a mix from the Lovejoin tile's always does (`throughLovejoin`, sessions.ts:4337-4338), still mixes its collateral. That matches Settings' own note (`settings.lovejoin.privacy.returnsOff`: "A mix from the Lovejoin tile still mixes.").
- Test: none (docs). Behaviour is documented as the code has it. See the owner's calls.

## Files touched
- `README.md` (root)
- `seedelf-platform/CLAUDE.md`
- `seedelf-platform/seedelf-web-wallet/README.md`
- `seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md`
- `seedelf-platform/seedelf-web-wallet/docs/flows.md`
- `seedelf-platform/seedelf-web-wallet/docs/architecture.md`
- `seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md`
- `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md`
- `seedelf-platform/seedelf-web-wallet/extension/src/shared/preferences.ts` (two doc comments only: `lovejoinCollateral`, as gap-3#0 asks, and `lovejoinDepth`'s "three wide", now "`lovejoinWidth` boxes a mix")

## Keys
None added or changed, critical or otherwise.

## Docs to update (for the later docs pass)
- flows.md:512 (the Mix form): once the screens round puts the reserve into *Total leaving* and drops the 5 ₳ from *Comes back once it's mixed* where the tail applies (gap-3#2, 323-worker#1), say so there.
- architecture.md:632 ("`COLLATERAL_TAIL_RESERVE` (1.5 ₳)") and flows.md:521: Lane R's `reserve` changes the reserve's sizing and the fundings' fallback. Rewrite them from its report. My edits there describe `9978654a` only.
- keys-and-accounts.md:91 still says *Put in 5 ₳ to cancel*'s 5 ₳ "comes back with the return". With a 5 ₳ pool shown, the return may mix it first, so it comes back later as a box. That's Session 10's call 2 class ("comes back"). It's left until the owner rules on it, with gap-3#2's by-hand notes.

## Calls the owner might overturn
- **gap-3#7:** documented as the code behaves: with returns off, the collateral switch is greyed but still applies to a return that goes through Lovejoin anyway. If the owner meant "off", the worker would treat `lovejoinCollateral` as off while `lovejoinReturns` is off (a sessions.ts change, Lane D's `wss`).
- **docs-small#1:** the optional one-time check of L when the data layer first hands a pool over (one batched `account_info` for every listed pool's L, the same request for every wallet). Not built: code, and the skeptic left it to the owner.
- **312#3 part 2:** no table change, since it was refuted. One sentence added under *How it was measured* so nobody misreads the fixture's key-address references again.
- Extras beyond the findings' own lines, each the same stale claim: plan :328, flows.md:493 (Top up), architecture.md:109, and `lovejoinDepth`'s comment.

## Notes for other fixers and the lead
- No test needs the WebAssembly package rebuilt.
- `preferences.ts`: only the two doc comments changed (lines 139-148). Nothing else there.
- The behaviour this round changes (the private Bootstrap's reserve, the collateral reserve's sizing) isn't anticipated anywhere I wrote.

## Checks
- `npx vitest run tests/preferences.test.ts tests/words.test.ts tests/settings.test.ts`: 3 files, 43 tests passed.
- `npm run typecheck`: clean.
- The anchors I added (`#mix-through-lovejoin-the-dapps-page`, `#send-privately-private-balance--any-seedelf`, `#d3--four-boxes-a-mix-as-an-option`, `#34c--discovery-and-the-data-layer-2026-10-17`, `#session-11-item-11s-collateral-mixed-not-just-put-in-2026-10-23`) each match a heading's GitHub slug (a Python check over the docs' headings).
- No formatter was run.
