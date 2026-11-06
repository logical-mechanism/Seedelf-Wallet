# 1.8.0's release review: the docs

Writer: **docs**. Worktree `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/merged`, branch `review-1.8.0/merged` at `4b4628e9`. Nothing is committed: the lead commits. Every sentence about the wallet's behaviour was checked against the merged code there; paths below are under `seedelf-platform/seedelf-web-wallet/` unless they say otherwise, and line numbers are at `4b4628e9`.

## Files

- `docs/store/privacy-policy.md`
- `docs/privacy.md`
- `docs/architecture.md`
- `docs/flows.md`
- `docs/lovejoin-mix-width.md`
- `README.md`
- `docs/development.md`
- `docs/backlog.md`
- `docs/store/README.md`
- `docs/i18n/glossary.md`
- `extension/scripts/lovejoin-registry.mjs` (changed), `extension/scripts/lovejoin-registry.d.mts` (new), `extension/tests/lovejoin-registry.test.ts` (new)
- `docs/archive/plans/chunk-44-lovejoin-v2.md` (new), `docs/plans/chunk-44-lovejoin-v2.md` (deleted with `rm`, not `git rm`: commit both paths)

## Checks run

- `npx vitest run tests/lovejoin-registry.test.ts --maxWorkers=2`, from the merged worktree's `extension/`: **4 passed**.
- Five mutants of the script, each applied alone, that file run, the script put back with its sha256 checked (`scratchpad/docs-lane/mutate.py`): v2's label dropped, v2 linked to `COMMIT`, v2 at version 2, `entriesOf`'s set guard off, and the run's guard back to `tokenV1` alone. **Each 1 failed, 3 passed; restored, sums match.**
- `npx tsc --noEmit -p .` (once, `nice`): **exit 0**, the new `.d.mts` and test included.
- No other test, no network, no build, no formatter, no git command that changes state.

## Each item

### 1 · The privacy policy (D2)

**Changed:**
- *Effective* is 6 November 2026, its list ending "…that check removed, and Lovejoin's older pools retired, your boxes brought back from them, and its pool of 5 ₳ boxes looked for".
- *Your Lovejoin boxes* (`:28`): the spare ADA's pool of 5 ₳ boxes on Lovejoin's current contracts, direct while there's none or under 30 others on mainnet; the older pools retired, and brought back the first time the wallet finds your boxes there, one right after another, mixed or not, with what that ties; what's kept gains "or whether it was the retired pools' run" and "when the wallet retired those pools on this device"; the collateral goes into "that pool".
- *Lovejoin's pools* (`:46`): Koios's holder is also read, at most every five minutes, when Settings' Bring every box back is pressed, and, while no 5 ₳ pool is known, as a return is built, at a swap's review or its Stop, at a funding's review, and at Put in 5 ₳.
- A dated entry, **6 November 2026**, covering: the retired pools; the first unlock's bring-back (after a restore, once found), each withdraw to giveme.my and the Cardano server, a stuck pool's box paid from the private balance, and what back-to-back withdraws and an unmixed box tie; the 5 ₳ pool and its floor; the new look (its times, its throttle, what it asks of whom on each network, and that its moment follows what you do); two reads that are new (a site's funding review with the collateral switch off, and on mainnet a return built with no 5 ₳); what's kept.

**Checked against:**
- retired: `extension/src/background/lovejoin.ts:666` (`isRetired`), `:4106-4107` (`usableNow`), `:4140-4150` (`takesNewBoxes`);
- the first unlock: `lovejoin.ts:6523-6530` (`retireOnce` before Bring every box back and before `unlockDraws`), `:4198-4258` (`retireOnce`: once, `retired`, `released`, `tail.over`, the counts, `bringing.retired`), `:6944`, `:6989-6992` (the retired run covers retired pools only), `:7106`, `:7127` (a stuck pool's box `paid: "private"`); a restore: `:6118-6124` (`status` schedules found boxes), then `retireOnce`'s `named` (`:4212-4220`);
- the 5 ₳ pool and the floor: `lovejoin.ts:676-677` (`adaPoolOf`), `:3583-3607` (`chain()`: none shown, direct but for tokens), `:4274-4284` (`collateralPool`: floor, two free), `extension/src/networks.ts:56`, `:71` (the floor: 0 on preprod, 30 on mainnet, read at `lovejoin.ts:4299`);
- the look: `lovejoin.ts:4164-4172` (`adaPool`), `extension/src/background/lovejoin-pools.ts:423-430` (`lookSoon`: refresh first, no Koios within `REFRESH_MS` of the list's answer or of a look's start), `:445-451` (shared refresh), `:534-542`, `:544-614` (`credential_utxos` of the holder, `tx_info` of launches, `account_update_history`), `:81` (`REFRESH_MS`); the asks: `lovejoin.ts:3583`, `:4276`, `extension/src/background/sessions.ts:1633` and `:1784` (Review), `:3413` (Stop), `:4807` (`tailReserve` → `collateralPool`), `:2050` (`lovejoinRoomNow`), `:4598`, `:2443` (`collateralWanted`'s asks), `lovejoin.ts:6873` (`bringAllBack`, no pool);
- the new reads: `sessions.ts:1999` with `:2046-2058` (a site's funding review reads the pools whenever Settings brings sessions back through Lovejoin; before O3 `tailReserve`, `:4804`, read nothing with the collateral switch off), `:4876` (`collateralWanted`'s room, `floor > 0` only);
- what's kept: `lovejoin.ts:989` (`bringStopped.retired`), `:994` (`Schedule.retired`), `:1012` (`Bringing.retired`), `:6922` (Stop's record); nothing written for a wallet with nothing there, `:4220`.

### 2 · `docs/privacy.md`, its Lovejoin parts (release#8)

**Changed:**
- `:195`: since 1.8.0 the wallet mixes only on v2's scripts, its returns and collateral into v2's 5 ₳ pool, the rest retired.
- `:198`: a return comes back directly while no v2 5 ₳ pool is known, saying the wallet knew of none, its tokens still going (O4, O5, with the owner's 2026-11-06 words); a Bootstrap's boxes in a retired pool aren't held.
- A new sub-bullet: **a return in 5 ₳ boxes**: about 4.1 ₳ a box at the default, twice the classic pool's fees for each ₳ mixed; one chain carries 160 ₳ two waves deep (50 ₳ three deep, 320 ₳ one deep, against 320, 100 and 960 ₳), the rest back at once (P3, the owner's to weigh).
- `:201`: the look at an ask (`lookSoon`): its times, its throttle counted from the last look's start, the page's too, and that its request is the page's, made at that return's or review's moment.
- `:216`: the ADA goes through v2's 5 ₳ pool; with none known the tokens still go (O5).
- `:217`: the collateral's pool is v2's 5 ₳ one, shared with the spare ADA: a return's and Mix again's boxes leave its mix two draws, a direct return holds its two as it's built, the tile's Mix says "only if enough is left" (P1, P2).
- `:220`, `:226`: the timing rule's one exception, and Bring every box back asked once by the wallet.
- A new sub-bullet: **the retired pools**: withdraw-only, listed only while holding boxes, nothing held there, what Koios is and isn't asked there; and **the first unlock's bring-back**: when it runs (the unlock's run, or after a restore the first run after a pool read found the boxes), once a network, every box back to back with none of the waits, the cost Bring every box back's question states paid unasked, Stop, and why it's the retired pools' alone.
- Mixing again: never in a retired pool. After a restore: in a retired pool nothing waits; a restored wallet finds its boxes when Lovejoin's page opens, or when Settings' Bring every box back looks first. What Koios learns: a box coming back by itself isn't asked about in a retired pool. On this device: `bringing`'s and `bringStopped`'s retired mark, and `retired`.

**Checked against:**
- `lovejoin.ts:5725-5731` (`sortOut`'s `old`: nothing held but a chain's box being sent), `:1972-1976` (`moreThanDue`), `:5874-5899` (`found`: Koios may still be asked at a pool read or for `force`), `:6657-6658` (the scheduled withdraw skips `made` in a retired pool), `:6774-6775` (Bring one back now's held set);
- `extension/src/ui/lovejoin-pools.ts:89` (`shownOnHub`);
- P3: `lovejoin.ts:1741-1769` (`MAX_CHAIN_MIXES` 130, `chainBoxes`, `MAX_DEPOSIT_BOXES` 96, `MAX_TOKEN_DEPOSIT_BOXES` 64), `sessions.ts:1811` (`priced`'s `most`), `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1663` (`MIX_FEE_ESTIMATE` 0.95 ₳), `sessions.ts:230` (0.3 ₳ back). `chainBoxes(2, 3)` is 32, so 160 ₳ in 5 ₳ boxes against 320 ₳; three deep 10 boxes, 50 ₳ against 100 ₳; one deep 64 against 96, 320 ₳ against 960 ₳. **adapool#3's figures hold.**
- P1, P2: `lovejoin.ts:838-852` (`roomLeavingTail`, `roomIn`), `:3437-3443` (`againBoxes`' hold), `:3643` (`holdTail`), `sessions.ts:4742-4759` (a direct return's reservation);
- O1: as item 1; O4, O5: `lovejoin.ts:3584-3607`, `extension/src/i18n/translations/en.json` (`sess.skip.warn.noAdaPool`);
- the restore: `lovejoin.ts:6118-6124`, `:6873`; what's kept: `:989`, `:994`, `:1012`.

### 3 · `docs/architecture.md`, its Lovejoin section (release#6)

**Changed:**
- `:671`: the boxes' values, and that the return's pool is v2's 5 ₳ one since chunk 44, the rest retired.
- `:673`: a retired pool's Bootstraps let go. `:686`: the 1.5.0 gate holds the classic pool retired (`asRetired`), the head start's v2 pools held apart (D6). The `origins` list: an answer holds nothing in a retired pool. "When it asks": not before a retired box's own withdraw. "Never at the moment of unlock": but for the retired pools' run. Mix my boxes again: never in a retired pool. Home's count: in a retired pool every box can come back. The tile's pools: on v2's scripts; a retired pool's page withdraw-only. The shown rule: per set (44a). Discovery's sources: an ask's look too.
- A new block, **Lovejoin v2, and the retired pools**, linking the archived plan:
  - retirement: `isRetired`, `usableNow`, `takesNewBoxes`, every way of mixing asking, R8's early refusals, a 1.7 session's return, a 1.7 tail;
  - `adaPoolOf` and `adaPool`: its quiet read, its ask, its look (`lookSoon`), what asks and what stays quiet, Settings' Bring every box back looking first (critic#2);
  - no pool or under the floor: O2, O4, O5, critic#0, critic#1, and the connector's marks (O3);
  - `retireOnce` as the fixes left it: R1, R2, R3, critic#3, the run's scope, Settings' widening, a v2 page refused, Try again (R4), `bringStopped.retired`, `madeSince` (critic#5);
  - nothing held in a retired pool;
  - the screens: the hub's retired rows, `noneTakes` and the aside (O6), the search (S1), a retired page (W2, W9, S2), a stopped chain's words (W8), and the copy rule per set;
  - the 5 ₳ pool shared: `roomIn`, `roomLeavingTail`, `holdTail`, `againBoxes`' hold, the tile's `ifLeft` and Stop's `tailDrawn` (P1), P2's reservation;
  - a 1.7.2 swap's cap (critic#4);
  - the restore's design.
- *What each costs*: the look's requests, and the first run's withdraws.

**Checked against:**
- `lovejoin.ts:666`, `:4106-4150`, `:3059-3062` (`privateBootstrapMost`), `:3333-3336` (`fits`), `:3412` (`againBoxes`), `:4634-4636`, `:4786-4787` (R8), `:3613-3620` (`chain()` refuses a retired pool's mix session), `:4350-4354` (`tailChain`), `:1424-1447` (`tailBuildable`, `tailBoxes`);
- `:676-677`, `:4164-4172`, `:4181-4188` (`retiredIds`' undecided), `:4198-4258`, `:6871-6907` (`bringAllBack`: look, widen, refuse, retired again), `:6914-6926`, `:2156-2164` (`madeSince`, pool-aware), `:6386` (`LovejoinChainView.retired`), `:6469-6471` (`held`'s retired mark);
- `lovejoin-pools.ts:407-451`, `:534-542`, `:624-645`;
- `sessions.ts:1777-1847` (`priced`: ask, `of` at `perFive`, `classic`), `:1946-1957` (the approval's `box`), `:2046-2081` (`lovejoinRoomNow`, `lovejoinRoomKept`), `:3399-3482` (`stopCost`, `tailDrawn`), `:4798-4818` (`tailReserve`'s `draws`, `short`), `:4866-4902` (`collateralWanted`), `:6355-6357` (`pricedClassic`), `lovejoin.ts:3662-3672` (`countAt`'s lesser), `extension/src/background/dapp.ts:1068`;
- screens: `extension/src/ui/lovejoin-pools.ts:81`, `:89`; `extension/src/ui/screens/Lovejoin.tsx:1272-1274` (`againRefused`), `:1599` (W9), `:1944-1954` (`takes`, `tokenTakes`, `noneTakes`, the aside), `:2031-2034` (none yet), `:2288` (no meter), `:2732` (`closed`), `:3167` (`short` excludes a closed pool), `:3226-3229` (`notNow` = the retired reason), `:3616`; `extension/src/ui/components/BringAllBack.tsx:60-61` (`bringAsk`), `:76-77`, `:313-315`, `:369-372`, `:396-397`, `:417`, `:444` (the retired question);
- `extension/tests/lovejoin-1-5-0.test.ts:30-43`, `:433`, `:946-962`.

### 4 · `docs/flows.md`, its Lovejoin flows (release#7)

**Changed:**
- Outside the section, every figure at 5 ₳: the eye's box count (`:63`); Home's row, each pool's own (`:73`); the connector's card, a 5 ₳ box and its hedge "Only if Lovejoin's pool has room when it comes back." (`:428`, O3); a swap's Review asking first, its no-pool line (O2, O4), *Boxes of 5 ₳* and "at most 2 boxes of 5 ₳" (W1, `:469`); the swap's way back into v2's 5 ₳ pool, O5's tokens, and critic#4's cap (`:478`); Put in 5 ₳ not offered where it buys no mix (critic#1, `:484`); a site's funding review, its 5 ₳ box, its hedged note naming no collateral, the 5 ₳ kept aside (W5), and a failed read giving the hedged note (`:490`).
- The section: the opening (v2, retired, the first unlock); the hub's retired rows, "No pool to mix in yet." and the aside (O6), the search (S1); a retired pool's page, withdraw-only (W9, S2); the counts' reason; "Mixing 5 ₳ costs about 4.85 ₳ (97%)"; Mix my boxes again off in a retired pool, and P1's hold; not mixed yet and a cut chain in a retired pool; a retired chain's words (W8); the collateral's pool; Bootstrap in a retired pool; the retired pools' run in Settings and on the pages, Settings' widening, Try again under its own question (R4), its done words, and Settings' look (critic#2); Start a pool's copy warning on v2's scripts (V1); a return's boxes "2 boxes of 5 ₳", and O5.

**Checked against:**
- `extension/src/ui/screens/Home.tsx:1492` and the rows after it; `en.json` (`lovejoin.mixes.boxesOf`, `dapps.lovejoin.what`);
- `extension/src/ui/screens/DappApprovals.tsx:495-503` (the review's note), `:938-942` (the card), `sessions.ts:2067-2081`, `lovejoin.ts:2516` (`POOL_ROOM_MS`, 5 minutes);
- `en.json` for each quoted string: `swaps.cost.boxesLabel`, `swaps.boxes.atMost_*`, `swaps.lovejoin.warn.pool`, `sess.skip.warn.noAdaPool`, `swaps.lovejoin.privacy.onPoolShort`, `dappUi.back.privacy.noteLovejoinPoolShort`, `lj.unusable.warn.retired`, `lovejoin.pools.noneYet`, `lovejoin.aside`, `lovejoin.asideTokens`, `settings.lovejoin.bringingRetired_other`, `settings.lovejoin.bringRetiredTitle`, `settings.lovejoin.bringNoneRetired`, `swaps.lovejoin.privacy.onTokens`;
- the cost line: `Lovejoin.tsx:660-673` (`mixCosts`: 4 × 0.95 ₳ + 3 × 0.25 ₳ + 0.3 ₳ = 4.85 ₳ on a 5 ₳ box), `extension/src/ui/format.ts:395-397` (97%), `extension/src/ui/components/LovejoinReturn.tsx:517` (the collateral's 1.5 ₳, counted on top where paid);
- `sessions.ts:4866-4902`, `:5708` (the offer reads the device alone); `extension/src/background/lovejoin-launch.ts:300-306` (`startedBefore` matches `l.version === "v2"` alone); and item 3's references for the hub, the page and the run.

### 5 · `docs/lovejoin-mix-width.md` (release#9, tests-e2e#4)

**Changed:**
- *The answer* leads with v2: 99.0%, 100 million left, three at 58.2%, five at 15.1 billion; v2 the thinnest, by 6 and 10.8 million steps; what the wallet mixed on before 1.8.0 left 111 to 118 million; a mix 1.1% dearer on v2 would fail; four comfortable at about 11 billion, five 15.07, six 21.32.
- *How it was measured* lists v2's stand-in, offline alone; the network's check covers the three on chain.
- *The numbers*: v2's table first, its N = 3 row bold, with `every_width_measured`'s hold (V5), and a plain line that v2's 5 ₳ ADA pool isn't measured here; then the classic mainnet and 8131b1d tables under *What the wallet mixed on before 1.8.0*.
- *What would let four in*, recomputed on v2's rows: 5.82/6.46, 9.90/**11.00**, 15.07/16.74, 21.32/23.69 billion, 0.20 billion left in a block, about 17.0 billion to match three's room.
- *What four would cost a user*, on v2's token pool, the fee input first: 0.84/1.23, 3.35/6.15, 10.88/25.84 ₳, and one line on what that is per ₳ in 5 ₳ boxes.

**Checked against:**
- the doc's own v2 table, and `seedelf-platform/seedelf-core/tests/lovejoin_width_test.rs:246-261` (`token_v2_preprod`), `:917-944` (`every_width_measured` and its estimate assertions), `:1075` (the live check leaves v2 out);
- `fix/v44a.md`'s measured worst fees (0.836682 ₳, 1.230498 ₳);
- the arithmetic, run with `python3 -I`: each figure above (need ÷ 0.9; 20 − 2 × 9.8997; 9.8997 ÷ 0.58154 = 17.02; 1e10 ÷ 9.8997e9 − 1 = 1.01%).

### 6 · The web wallet's `README.md` (release#10)

**Changed:** `:47` says 5 ₳ boxes since 1.8.0; `:57` says the shown rule per version of Lovejoin's scripts, and the older pools listed only while you hold boxes there; a new paragraph, **After v1: Lovejoin v2**, in the README's own manner.

**Checked against:** `lovejoin.ts:666`, `:676-677`, `extension/src/ui/lovejoin-pools.ts:89`, `lovejoin-pools.ts:6-8` (the shown rule per set), `seedelf-platform/seedelf-core/src/lovejoin/templates.rs:38-58` (the two sets), and item 1's references for the bring-back and the floor.

### 7 · `docs/development.md`

**Changed:**
- `release_version=1.8.0`, and the zip `seedelf-wallet-1.8.0-mainnet.zip` (release#14).
- The head start: never a gate, found live without the page; on mainnet by the list, on preprod, with Koios only or with the data layer down by Koios's holder, as the page opens and wherever a return, a review or a funding asks while none is kept (O1).
- The preprod checklist, item 6:
  - Lovejoin in v2's 5 ₳ pool `47bece42…`, once a second wallet's boxes are in it (a pool of the tester's own boxes alone has nobody to mix with);
  - the retired pools named;
  - the collateral's mix on v2's 5 ₳ pool;
  - the token-pool items wait for a v2 token pool on preprod;
  - a new item: boxes in the retired pools (put in with a 1.7.2 build), on the update's first unlock and on a restore, the run, and Try again with giveme.my blocked (R4).
- The Cardanoscan step: names per set ("Mix Box v2 (5 ADA)", version 3), each set's link, a set it doesn't name stops it (D3).

**Checked against:**
- `extension/package.json` (1.8.0); `extension/src/lovejoin-pools.json` (preprod: four 8131b1d pools and `47bece42…` v2; mainnet: `dc6abe3b…` alone, no `version`);
- `lovejoin-pools.ts:423-430`;
- `lovejoin.ts:3430-3431` and `:4280-4282` (others and free exclude the wallet's own boxes);
- the plan's 44c (the dev test wallet's 92 retired boxes already came back, so the item says how to put some in);
- `extension/scripts/lovejoin-registry.mjs` as item 11 left it.

### 8 · `docs/backlog.md` (release#13)

**Changed:**
- Deleted chunk 34's leftover "what a classic-only user sees since 1.6.0 (*four-switch-classic-bend*), and the dApps tile's "Mix ADA in 10 ₳ boxes"": the classic pool takes no mix now, and the tile says 5 ₳ (`en.json` `dapps.lovejoin.what`).
- C53's line now says Put in 5 ₳ reads the pool for its floor alone, on mainnet (critic#1).
- Added, in *Lovejoin*:
  - P3 (the owner's);
  - critic#6 (the owner's);
  - a preprod v2 token pool (the owner's);
  - a retired pool's page showing the whole Mix form (the e2e lane's note; the owner's);
  - P2's `tailChain` sibling (the share lane);
  - O5's review saying nothing of the ADA (the chain lane);
  - the connect card keeping the approval's mark (the connector lane);
  - R8's `sessions.ts` half;
  - R1's kept `at` (the retire lane);
  - what's untested (the first unlock's e2e, BringAllBack's `retired` wiring, `priced`'s cap on D3's `leg` at width 4, S2's Done);
  - the critic's unclosed gaps.

**Checked against:**
- `sessions.ts:4876-4878` (`collateralWanted`'s floor, `floor > 0`);
- `fix/share.md` *For the lead* 7, `fix/chain.md` 6, `fix/connector.md` (*Not done, deliberately*), `fix/retire.md` 2 and 6, `fix/e2e.md` (*Seen, not mine*; the first unlock's e2e), `fix/screens.md` 6;
- `R2BRIEF.md` (*Known* and *Untested wiring*), `FINDINGS.md` (critic#6, P3, the critic's four gaps).

### 9 · The store listing (release#12)

**Changed:** in en, es and ja, new boxes go only into the first pool started for each box value on Lovejoin's current contracts, and pools on its older ones take none. The rest of each bullet is as it was. es: "…y, para cada valor de caja, pone cajas nuevas solo en el primer pool que se inició con los contratos actuales de Lovejoin; los pools con los contratos anteriores de Lovejoin no reciben ninguna." ja: "新しいボックスは、Lovejoin の現行のコントラクトで動くプールのうち、中身（…）が同じものの中で最初に開始されたプールにだけ入れます。以前のコントラクトで動くプールには、新しいボックスを入れません。"

**Checked against:** `lovejoin.ts:676-677` (`adaPoolOf`), `:666` (`isRetired`), `:4140-4150`; the head start's mainnet `dc6abe3b…` (8131b1d's first 5 ₳ pool, which takes none); the listing's own register (es tú, "Configuración"; ja です/ます, コントラクト as in its "Lovejoin 自身のコントラクト"), and the glossary row of item 10.

### 10 · The glossary (W11)

**Changed:** a section, *Chosen for 1.8.0*, with two rows:
- **retired**: es "los scripts retirados de Lovejoin; los pools retirados", ja 廃止済みのスクリプト; 廃止されたプール, bound to the scripts and the pools, never to Lovejoin; es "retiro" stays a withdrawal; a stake pool's and a DRep's retirement keep their own words;
- the listing's **current contracts / older ones** (es, ja).

**Checked against:** `es.json` and `ja.json`, every value whose English says "retired": `lj.unusable.warn.retired`, `settings.lovejoin.bringingRetired_*`, `bringNoneRetired`, `bringRetiredTitle`, and the stake pool's and DRep's (`pools.retired` 引退, `vote.status.retired` 退任, `pool.warn.retired` "se ha retirado"); the glossary's `withdrawal | retiro` row.

### 11 · `extension/scripts/lovejoin-registry.mjs` (D3)

**Changed:**
- It takes a v2 pool. `SETS` names each set by the version WebAssembly verifies a pool as:
  - `tokenV1`: `COMMIT`, no label, version 2;
  - `v2`: `COMMIT_V2`, label " v2", version 3.
- Its entries are named for their value and set ("Mix Box v2 (5 ADA)", 18 characters), so v2's 5 ₳ pool never takes the 8131b1d 5 ₳ pool's four names. 8131b1d's keep theirs.
- Each set links its own commit's tree (`…/tree/29573c58ccee/contracts` for v2).
- A pool on a set it doesn't name stops it with nothing written. The "kept, no longer listed" warning covers both sets' versions.
- Restructured as `scripts/third-party.mjs` is: the naming exported and pure (`SETS`, `commitsOf`, `amount`, `valueOf`, `entriesOf`), the CLI behind `if (process.argv[1] === fileURLToPath(import.meta.url))`, and types in `scripts/lovejoin-registry.d.mts`.
- `tests/lovejoin-registry.test.ts` (4 tests) reads the script as the release reviewer's scratch test did. It never runs its CLI, never needs `wasm/pkg` or the fork, and feeds `entriesOf` WebAssembly's views of v2's 5 ₳ pool (`tests/v2-pools.ts`) and mainnet's bundled 8131b1d 5 ₳ pool. It pins:
  - the names, their limit, and the hashes being the pool's own;
  - each set's link and version;
  - an unknown set refused;
  - from the source: that the run's guard takes `SETS`, and that everything reading WebAssembly, the bundled list or the fork sits after the gate.

**Checked against:** `seedelf-platform/seedelf-core/src/lovejoin/templates.rs:38`, `:41`; Lovejoin's repository read-only (`git -C …/lovejoin ls-tree 29573c58ccee contracts`: the folder exists at both commits); `wt/release/…/tests/release-registry-scratch.test.ts`; `scripts/third-party.mjs:238` (the house's gate), `tests/third-party.test.ts`.

### 12 · The plan

**Changed:** moved to `docs/archive/plans/chunk-44-lovejoin-v2.md`.
- A status line: built for 1.8.0, where what holds now lives, and what stays the owner's.
- The owner's 2026-11-06 calls in their words, typo and all, with the one that replaces 44c's head-start gate.
- 44b ✅, its preprod note marked superseded by O1.
- 44c ✅, the owner's three steps left: the data layer's deploy (owed after the merge, before the mainnet launch), the mainnet v2 5 ₳ pool's launch (whenever the owner chooses), and its Cardanoscan names. The fork's uncommitted `dc6abe3b…` entries are still the owner's too.
- 44d ✅, the release's steps left.
- *What its PRs did*: #363, #364, and the release's PR, `web-wallet/release-1.8.0`.

No tracked file linked the plan's old path (`git grep` found none), so no link needed fixing; my new links point at the archive's path.

**Checked against:**
- `git log` (read-only): #363 merged as `c441881e`, #364 as `a6c94743`, and the prep `1beba3fb`'s message;
- `R2BRIEF.md` for the owner's words;
- `FINDINGS.md` for the cluster IDs;
- `fix/*.md` for what each lane did.

## False, in a fixer's report or in the plan

1. **The plan, 44c:** "1.8.0 can't ship without each network's v2 5 ₳ pool in the head start". The owner's call of 2026-11-06 replaced it, and O1's look makes a later pool found without the page (`lovejoin.ts:4164-4172`, `lovejoin-pools.ts:423-430`). The archived plan says so.
2. **The plan, 44b:** "On preprod only the page's look reads the holder, so the head start must carry the pool". `adaPool`'s ask looks now. Marked superseded in the archived plan.
3. **The plan, 44b:** "None shown: the return comes back directly". Since O5 its tokens still go (`lovejoin.ts:3584-3607`). Kept as 44b's record; 44c's list says O5.
4. **Stale since the merge, not false at the lanes' heads.** The lead's merge commits superseded each of these, and the code wins:
   - `fix/find.md`'s "W10's `room()` default · not fixed": `room(network, pool: string, quiet = false)` has no default (`lovejoin.ts:3364`).
   - `fix/retire.md`'s *For the lead* 3, that Settings' Try again "still reads 'Bring every box back now?'": it reads "Bring the retired pools' boxes back now?" (`BringAllBack.tsx:444`).
   - `fix/chain.md`'s *For the lead* 4, that Stop's dialog says the 5 ₳ count for a 1.7.2 swap: `priced`'s `classic` caps it (`sessions.ts:1814-1821`, `:3413`).
5. **A judgment I didn't follow:** `fix/connector.md` says a site's funding review now reads Lovejoin's pools with the collateral switch off, and judged that the policy's "Lovejoin's pools when you use Lovejoin" covers it, so it added no entry. The brief has the entry cover each change to what the wallet sends, so the 6 November entry names it, with critic#1's read on mainnet. Not false; the lead may cut either clause.
6. `fix/connector.md` calls the connect card's mark "a quiet read: no request". `lovejoinRoomKept` calls `room()` non-quiet (`sessions.ts:2075`), but only after `collateralPoolTakes` said "yes" from a read within `POOL_ROOM_MS`, which `room()` then returns at once. The report states that edge itself. Not false.

Nothing else I checked in the reports or the plan disagreed with the code.

## Left, and why

- **`docs/releases.md` and `docs/i18n/verified-critical-*.json`:** the brief's *Don't*.
- **Code comments, the brief's *Don't touch the code*:**
  - `lovejoin-pools.ts:40-42` still says Koios's holder is read "when the Lovejoin page opens"; it's also read at an ask now (find's *For the lead* 3).
  - `src/lovejoin-pools.json`'s `//` note says "never a gate", which is true again.
- **flows.md `:494`'s "a 10 ₳ box came back as about 9.7 ₳"** is history (the blind test's fix round), so it stays. So does the launch's 10 ₳ rule everywhere.
- **backlog.md's `MIX_FEE_ESTIMATE` line** still quotes the classic pool's 0.8225 ₳. Not in the brief; v2's 0.837 ₳ is in lovejoin-mix-width.md.
- **The glossary's 1.6.0 row "10 ₳ のボックス N 件"** is an example of the counting form, still right.
- **The store listing's es and ja lines need a blind back-translation**, as the listing's own rule asks ("back-translate what changed"). That's the lead's translation round, with O4's, critic#0's, O3's and W6's keys.
- **The store images** aren't regenerated: forbidden here, and none shows Lovejoin (release lens).
- **seedelf-data/README.md, keys-and-accounts.md, CLAUDE.md:** nothing in them is made false (release lens; I re-read seedelf-data/README.md's shown rule, `:165`).
- **The backlog's lines for P2's `tailChain` sibling and the first unlock's e2e** are open as of `4b4628e9`. If round two fixes or adds them, delete those lines.

## What the upload must paste

The Store Listing tab's **Description**, in each language, whole, from `docs/store/README.md` after the merge:
- **English:** *Store listing* → *Description*.
- **Español:** *In Spanish and Japanese* → *Spanish* → *Description*.
- **日本語:** *Japanese* → *Description*.

Only each one's Lovejoin bullet changed:
- en: "…and puts new boxes only in the first started for each box value on Lovejoin's current contracts; pools on its older ones take none."
- es: "…y, para cada valor de caja, pone cajas nuevas solo en el primer pool que se inició con los contratos actuales de Lovejoin; los pools con los contratos anteriores de Lovejoin no reciben ninguna."
- ja: "…最初に開始されたプールにだけ入れます。以前のコントラクトで動くプールには、新しいボックスを入れません。"

Everything else stays as it is:
- the titles, and the summaries, which come from the package's `_locales`;
- the screenshots and the promo tile;
- the Privacy practices answers (nothing collected falls in a new category);
- the privacy policy's URL, whose page on `main` carries the 6 November 2026 entry once merged;
- the Test instructions.

## For the lead

- **The plan's move:** `git add` both paths, the deletion and the new file.
- **v2's registry entries are version 3** (`SETS.v2.version`), where the classic pool's are 1 and 8131b1d's 2: the owner can change that one number. The fork's uncommitted `dc6abe3b…` entries keep "(5 ADA)", and v2's never collide with them, so release#4's rename of the fork's entries isn't needed.
- **If round two changes behaviour** in the look, the retired run, the connector's marks or the 5 ₳ pool's sharing, the policy's 6 November entry, privacy.md's *The retired pools*, and architecture.md's new block are where to touch up.

## Round two

Writer: **docs**, round two ([DOCS2BRIEF.md](DOCS2BRIEF.md)). The same worktree, its head now `4ad4dc06`: round two's four lanes merged on `4b4628e9`, then the lead's commit. My edits sit on round one's drafts, all still uncommitted. Line numbers below are at that head with my edits in; paths as above. Round one's drafts as I found them are in `scratchpad/docs2-lane/before/`. Every edit was an exact, once-only replacement (`scratchpad/docs2-lane/tools/apply.py`, its specs in `scratchpad/docs2-lane/specs/`), checked against the code before it was written.

### Files

No new file. Edited, on top of round one's drafts:
- `docs/store/privacy-policy.md` (`:46`, `:93`)
- `docs/privacy.md` (`:124`, `:202`, `:230`)
- `docs/architecture.md` (`:53`, `:349`, `:351`, `:634`, `:647`, `:658`, `:733`, `:740`–`:742`, `:744`, `:745`, `:747` new, `:748`, `:749`)
- `docs/development.md` (`:331`)
- `docs/archive/plans/chunk-44-lovejoin-v2.md` (`:67`, `:68`)
- `docs/flows.md` (`:128`, `:480`, `:484`, `:507`, `:529`)
- `docs/backlog.md` (`:61`, `:64`, `:65`, `:67`, `:74`, `:78`, `:82`, `:83`)

### Checks run

- `git diff --check` on `docs/`: clean. The untracked archived plan has no trailing whitespace.
- No test, build, formatter or network. No git command that changes state. No code touched.

### 1 · The privacy policy

**Changed:**
- *Lovejoin's pools* (`:46`). The look's moments hung off Koios's half alone, so on mainnet they named no request. Now: "It also looks, by our server's list or by Koios as above, at most every five minutes while the browser keeps the wallet running, when you press **Bring every box back now** in Settings, and, while it knows of no pool of 5 ₳ boxes on Lovejoin's current contracts, as a private session's return is built, by you or by the wallet as a swap that runs itself comes back, at a swap's review or its Stop, at a session's funding or top-up review, at the review of a mix from your private balance and as the wallet builds that mix, and when you put 5 ₳ in for Lovejoin, at the moment of each."
- The 6 November entry (`:93`):
  - the same moments;
  - "at most every five minutes while the browser keeps the wallet running", over both halves (our list and Koios's holder);
  - "It names nothing of yours, though it comes at the moment of one of these.";
  - "…and, on mainnet, by a return built with no 5 ₳ at its account and by **Put in 5 ₳ for Lovejoin**."
- Round two's request changes need no words. r2-worker#1 makes a review list the pools once; r2-critic#0 moves a read sooner. Neither is a new kind of request, and the policy states no count of listings and no two-hour read, so nothing in it claims the old counts.

**Checked against:**
- the look: `lovejoin.ts:4180-4188` (`adaPool`'s ask); `lovejoin-pools.ts:432-439` (`lookSoon`); `lovejoin.ts:6931` (Settings' press);
- each moment:
  - a return's build: `lovejoin.ts:3597` (`chain()`); `sessions.ts:4539-4547` (`buildBack`'s collateral pick, `collateralPool`, `lovejoin.ts:4301`); `sessions.ts:4610` (`collateralWanted`'s ask);
  - the runner's: `sessions.ts:3657` (`act`) → `:4298` (`bringBack`);
  - a mix's chain: `buildBack` again, a mix session going through Lovejoin (`sessions.ts:4866`);
  - a swap's review: `:1633`, `:1796`, `:1906`;
  - Stop: `:3439`;
  - a site's funding review: `:2015`, `:2018`, `:2069`;
  - a top-up's, with a new collateral: `:2343`;
  - a mix's review: `:2226` (`tailReserve` with `draws`) → `:4825`;
  - Put in 5 ₳: `:2463` → `:4893`;
- no look at a public mix's review: it names its pool, and `chain()` asks only with none named (`lovejoin.ts:3597`);
- the throttle, in memory: `lovejoin-pools.ts:275`, `:277`, `:283` (`asked`, `answered`, `scanned`, the instance's maps); `sw.ts:137`, `:142`, `:239` (one `PoolDiscovery` a worker life);
- Put in 5 ₳'s read on mainnet: `sessions.ts:4896` (`room(…, !ask)` where the floor is set), `networks.ts:56`, `:71`; pinned at `tests/lovejoin-found-later.test.ts:674`;
- the counts: fix2/sessions.md's *Requests changed*, fix2/retire.md's *Requests a flow makes*, and a grep of the policy for counts and hours.

### 2 · `docs/privacy.md`

**Changed:**
- `:124`, the public mix's look: "at most every two minutes on each network while the worker runs (the throttle is in its memory, so a worker the browser started again, as it may for each of the alarm's runs with no page open, looks at once …)" (N3).
- `:124`, Bring every box back's reads. The first unlock's run over the retired pools, where it dropped 1.7's counts or let a 1.7 Bootstrap go, reads the pools at the next run once it's over or stopped, and again 2 hours on while one of its withdraws may not be on chain yet (r2-critic#0).
- `:202`, in r2-critic#2's trace's words: "at most every 5 minutes a network while the worker runs (…; the throttle is in its memory, as the list's, so a worker the browser started again looks at its first ask)". Its askers in full: a return's build by hand or by the runner, a mix's chain too; a site's funding or top-up review; the review of a mix from the private balance (r2-critic#3's trace).
- `:230`, the retired run's Stop: the boxes with no wait get theirs from a read at the next run, not 2 hours on.
- The token-pool line: unchanged. `:202` scopes an ask's look to "while no v2 pool of 5 ₳ boxes is kept", and no line says a later token pool is found without the page.

**Checked against:**
- the public look: `lovejoin.ts:197` (`PUBLIC_LOOK_MS`), `:2781` (`looked`, the instance's map), `:2936-2942` (`lookDue`), `:5069-5076` (the runs' `publicLook`); `sw.ts:137-147`, `:241` (one `LovejoinService` a worker life);
- the retired run's read:
  - `lovejoin.ts:4246-4249` (`released`), `:4269` (`Math.min(s.recheck ?? now, now)`);
  - `:6598-6600` (the owed read), `:6630-6634` (re-armed while a `counted` box is listed and held as spent);
  - `:6980`, `:7239` (Stop's and the run's own stop's `Math.min`), `spent.ts:33`;
  - pinned by `tests/lovejoin-round2-retire.test.ts:160`;
- `:202`: item 1's references.

### 3 · `docs/architecture.md`

**Changed:**
- `:349`, `:351`: the public look, "while the worker runs", with `looked` in memory (N3).
- `:53`: the trap list gains a review's one read of every pool, `rooms()` (r2-worker#1).
- `:634`: `tell` is a mix's review's look now. Every other review asks `collateralRoom`: `"failed"` where `rooms()` fails, and a pool the kept read lacks read afresh (fix2/sessions.md's *For the lead*, 4).
- `:647`, `:658`, C53's test:
  - the session list's view reads the device alone;
  - the press asks as a return's build does, and on mainnet reads the pools for the floor, refusing under it;
  - the list may offer what the press refuses (r2-critic#3's trace; the owner's call on r2-critic#5).
- `:733`: Koios's holder is read at a pool's start too, and at `lookSoon`'s two askers, throttled while the worker runs.
- `:740`:
  - the throttles hold while the worker runs, `asked`, `answered` and `scanned` in memory (r2-critic#2);
  - "So a 5 ₳ pool launched after a device's head start …", and, once a 5 ₳ pool is kept, a token pool waits for the page, a pool's start or Settings' press (r2-critic#1);
  - what asks: the runner's returns and a mix session's chain, a top-up's review, `collateralRoom`.
- `:741`: the connect card's room read is quiet too (r2-worker#2).
- The new block, round two's code:
  - `:742`: the first run's owed read, for 1.7's counts and the Bootstraps it let go. A Stop never puts it later, and it's re-armed while a withdraw is held as spent (r2-critic#0).
  - `:744`: the hub's `takes` (`!unusable`), its aside's three cases (`fiveOnly`, `lovejoin.asideAda`), and a v2 pool's page while the retired run goes (`lovejoin.bring.otherRetired`). The worker's refusal, now reached only by a race, still says `lj.bringOtherPool` (r2-screens#3, #4, #5).
  - `:745`: Stop's dialog's hold (r2-worker#0), the crowd-count edge where it still counts the whole room (an upper bound), and a swap's Review a forecast.
  - `:747`, new: **A review reads the pools once** (r2-worker#1): `collateralRoom` on the shared `rooms()`, the missing pool read afresh, a mix's review's fresh split kept (P1), `rooms()` handing a trap on.
  - `:748`: a restore's looks, a pool's start's, and an ask's only while no 5 ₳ pool is kept (r2-critic#1).
- `:749`, what each costs:
  - a review's one read, and a mix's review's two;
  - the retired run's read at the next run, and its re-arm;
  - Settings' look and the public look, both hedged.

**Checked against:**
- the reviews' read: `lovejoin.ts:3387-3399` (`rooms()`: a trap handed on at `:3396`), `:4322-4332` (`collateralRoom`); `sessions.ts:4824-4826` (`tailReserve`: `draws ? collateralPool(…, true) : collateralRoom`), `:2065-2077` (`lovejoinRoomNow`), `:2086-2100` (`lovejoinRoomKept`'s quiet `room`);
- Put in 5 ₳: `sessions.ts:4886-4900` (`collateralWanted`: `adaPool(network, ask)`, `room(…, !ask)` where `floor > 0`), `:2452-2465` (`backCollateralBuild` asks, refusing with `sess.backCollateral.notNeeded`, `en.json:1907`), `:5728` (the list's view, `ask` false); `lovejoin.ts:3373-3377` (`room`'s quiet read);
- the look's places: `lovejoin-launch.ts:244` (a pool's start), `handlers.ts:531` (the page), `lovejoin-pools.ts:413-439`, `:545-553`;
- Stop's count: `sessions.ts:1810-1865` (`priced`: `fitsOf(held)`, `price(spare, upTo, held)`, `leg(spare, held)`, its `room`), `:3455`, `:3479`, `:3484` (`takes`, `price(counted, undefined, takes === "yes")`, `tailDrawn` on priced's room), `:6344-6349` (`tailDrawn` at the counted width), `:1633-1660` (a swap's Review, no hold); `lovejoin.ts:839` (`roomLeavingTail`); the edge in fix2/sessions.md's *For the lead*, 5;
- the screens: `Lovejoin.tsx:1948-1951`, `:1959`, `:2036`; `BringAllBack.tsx:231`, `:240`, `:383-384`, `:412`; `lovejoin.ts:6937-6944` (`bringAllBack`'s `other`); `en.json:984`, `:2006`;
- the retired run: item 2's references.

### 4 · `docs/development.md`

**Changed:** `:331`, the head start, said as the code has it:
- "It's a head start, never a gate: a pool launched after it is found live", 1.6.0's words, without "without Lovejoin's page";
- on mainnet, the data layer's list, asked at most every 5 minutes while the worker runs;
- on preprod, with Koios only or with the data layer down, Koios's holder: as the page opens and at a pool's start; and, through `lookSoon`, at Settings' Bring every box back and wherever a return, a review or a funding asks while no 5 ₳ pool is kept;
- so a 5 ₳ pool launched later is found without the page on both networks, and a token pool on mainnet by the list. On those Koios paths, once a 5 ₳ pool is kept, a token pool waits for the page, a pool's start or Settings' press (r2-critic#1).

**Checked against:** `lovejoin-pools.ts:413-439`, `:464-470`; `lovejoin.ts:4180-4188`, `:6931`; `lovejoin-launch.ts:244`; `handlers.ts:531`; `tests/lovejoin-round2-retire.test.ts:472` (with the 5 ₳ pool kept, an ask asks nobody, and Settings' press finds the token pool).

### 5 · The archived plan

**Changed:**
- `:67`: "use the 5 ₳ pool once it exists", and once a 5 ₳ pool is kept, a token pool launched later waits for the page, a pool's start or Settings' press where the data layer doesn't answer;
- `:68`: the look "while the worker runs".

The owner's words (`:21`) are as they were.

**Checked against:** item 4's.

### 6 · `docs/flows.md`

**Changed:**
- `:128`: the public look, "while the worker runs" (N3).
- `:480`: Stop's dialog counts its boxes as the return's chain does, leaving the collateral's mix its two boxes where it goes into the same 5 ₳ pool, at the width the return goes (r2-worker#0).
- `:484`: with no pool read within five minutes, the session list offers Put in 5 ₳, and the press refuses it under the floor, in its own words (r2-critic#5).
- `:507`: the none-line counts only pools that take *new* boxes, and the aside's three cases are named (r2-screens#3, #4).
- `:529`:
  - a v2 pool's page while the retired run goes, quoting `lovejoin.bring.otherRetired` (r2-screens#5);
  - that run stopped: its boxes with no wait get theirs at the next run (r2-critic#0).
- `noteLovejoinMixed`: flows.md never quotes it, and `:490`'s paraphrase still holds, so nothing changed there.

**Checked against:** items 2 and 3's references; `tests/lovejoin-found-later.test.ts:674`; `tests/lovejoin-screens-review-fixes-1-8-0.test.ts` (O6's below-minimum and aside cases, and r2-screens#5's describe).

### 7 · `docs/backlog.md`

**Changed:**
- *Untested in 1.8.0* (`:83`) keeps S2's Done alone. Round two closed the other three:
  - the first unlock's e2e: `e2e/extension.spec.ts:3680`;
  - BringAllBack's `retired` wiring: `tests/lovejoin-screens-review-fixes-1-8-0.test.ts:706`;
  - `priced`'s cap on D3's `leg` at width 4: `tests/lovejoin-chain-review-fixes.test.ts:440`.
- x-privacy#3 (`:64`): its funding reviews' five-minute cache came with r2-worker#1, so the line is now *One listing through a whole build*: a return's build's two listings.
- Added, one line each:
  - D3 at width 4 (`:61`);
  - a mix's review and Mix again's two listings (`:65`), per the code: their own split and `tailReserve`'s, kept fresh for P1;
  - Put in 5 ₳ under the floor (`:67`), quoting the press's refusal;
  - a v2 token pool launched later, on Koios paths (`:74`);
  - the swap's Plan (`:78`);
  - Home's "A mix stopped partway: …" in a retired pool (`:82`).
- Kept: P2's `tailChain` sibling (`:76`).

**Checked against:**
- fix2/e2e.md, fix2/screens.md and fix2/sessions.md, and the tests named above;
- FIX2BRIEF.md's *The calls on round two*, for the owner's four calls;
- round2/r2-worker.md's r2-worker#4;
- verify.md's r2-critic#0 aside, and r2-worker#0's and #1's traces;
- `en.json:797` (`home.lovejoin.flagged`).

### False, in the brief, a fix2 report or a trace

1. **r2-critic#3's trace's moments leave one out.** The code has one more: a mix session's chain, which the wallet builds once its funding lands, asks for the 5 ₳ pool through `buildBack`'s collateral pick (`sessions.ts:4539-4547`, `:4866`; `lovejoin.ts:4301`). The trace's notes name it; its proposed text doesn't.
   - Its "at a mix's review" holds only for a mix from the private balance. A public mix names its pool, and `chain()` asks only where none is named (`lovejoin.ts:3597`).
   - So the policy says "at the review of a mix from your private balance and as the wallet builds that mix".
2. **DOCS2BRIEF's item 1:** "r2-critic#0 moves Stop's pool read from two hours on to the next run". That holds only for the first unlock's retired run, where it dropped 1.7's counts or let a 1.7 Bootstrap go. Every other Stop keeps its read 2 hours on (`lovejoin.ts:6980`; fix2/retire.md's *Every other Stop*). The docs say it of that run alone.
3. **DOCS2BRIEF's item 7, the mix's review:** "their fresh split for P1's draws, and tailReserve's" names one listing twice. The two are the review's own split (`fits`' or `againBoxes`') and `tailReserve`'s, which stays fresh for P1's draws (`sessions.ts:4824-4825`; fix2/sessions.md's table). The line says so.
4. **DOCS2BRIEF's item 7, Put in 5 ₳:** "refused at the press, which says why". The refusal names no floor: "Its return needs no 5 ₳: as things are, it doesn't go through Lovejoin. Bring it back as it is." (`en.json:1907`). The return's own review gives the floor's reason. The line quotes the refusal.
5. **Not false, incomplete:**
   - r2-critic#1's trace counts architecture.md:733 as accurate, and DOCS2BRIEF's item 4 lists the places Koios's holder is read, but both leave out a pool's start and Settings' press, which find a later pool too. Both are named now.
   - N3's "each alarm run is a fresh worker" was found by reading, not tested, so the docs say a worker "may" start again for each run.

Nothing else I checked in fix2/*.md or round2/verify.md disagreed with the code.

### Left, and why

- **Not on the brief's list of backlog lines; the lead's or the owner's to add:**
  - fix2/e2e.md's *For the lead*, 7: while the retired run goes, Home shows each box's own due time, which understates the run.
  - fix2/retire.md's *For the lead*, 5 (r2-critic#2's trace): the in-memory throttles (the look's, the list's, `PUBLIC_LOOK_MS`'s) could move to session storage, with Remove wallet clearing them, if the owner wants a firm bound. The docs are hedged instead.
- **Code and i18n, not docs:**
  - fix2/screens.md's *For the lead*, 2 (`lj.bringOtherPool`'s words in a race): architecture.md:744 says what the worker says.
  - Its *For the lead*, 3 (`untoldAll`'s capital).
- **Left as they are:**
  - fix2/sessions.md's *For the lead*, 5, its second over-count (a lapse microseconds wide): architecture.md:745 names the crowd-count one only.
  - POOL_ROOM_MS's "kept five minutes" (privacy.md:198, flows.md:470), the same in-memory gap that r2-critic#2's trace calls minor: a restart only reads again, and "kept" claims no "at most".
  - privacy.md names Put in 5 ₳'s press among the look's askers (`:202`), but not the mainnet pool reads of a return built with no 5 ₳, nor of the press. Round one put those in the policy's entry alone, and nothing in privacy.md says otherwise.
- **The preprod checklist** (development.md:145) could add two live checks: the retired run stopped partway (Home shows the boxes left from the next run), and a v2 pool's page while that run goes. Not in the brief; the lead's live run.
- **Round one's *Left*, updated:**
  - `lovejoin-pools.ts:40-42`'s comment was fixed by the retire lane (`82501e9c`), so that item is closed.
  - The first unlock's e2e line is deleted, as round one asked. P2's `tailChain` sibling is kept, as the brief says.
- **Untouched:** `docs/releases.md` and `docs/i18n/verified-critical-*.json` (the *Don't*).

**For the lead:** nothing to stage beyond round one's list. The same files, no new path.

## Last look

Writer: **docs**, the last look ([last/last-docs.md](last/last-docs.md): last-docs#0 to #4). Same worktree, head still `4ad4dc06`. My edits sit on rounds one's and two's drafts, and everything is still uncommitted. Each edit is an exact, once-only replacement (`scratchpad/last-docs-lane/tools/apply.py`), and the drafts as I found them are in `scratchpad/last-docs-lane/before/`. No line was added or removed, so line numbers are the same before and after. Code lines are at that head, in `extension/src/background/` unless another folder is named.

### Changes

- **last-docs#0, one deposit's 64 boxes**, in the trace's words, in all four places:
  - `docs/architecture.md:701`: one deposit takes at most 64 boxes in any pool on v2's scripts (`MAX_TOKEN_DEPOSIT_BOXES`); the classic pool's 96 is now past tense.
  - `docs/architecture.md:673`: `mostBootstrap` is 64 in every pool on v2's scripts, an ADA pool's too; the classic pool's 96 is marked retired.
  - `docs/flows.md:523`: "at most 64 boxes".
  - `docs/privacy.md:198`: "(64, one deposit's most on the new scripts)", the words of :199.
  - Checked against:
    - `lovejoin.ts:1766`, `:1769-1770` (`chainBoxes`), `:1777` and `:1780` (`mostBootstrap`: 96 only for `classic` or no pool);
    - `:3740` (`fit`) and `:3948-3950` (`acrossOf`: one deposit's 64 across all legs);
    - `:3597` with `:666` and `:676-677` (a return's pool is `adaPoolOf`'s, never the classic);
    - `:4156` and `:4685` (a retired pool is refused before anything);
    - `sessions.ts:1829`; `ui/screens/Lovejoin.tsx:2737` (`closed`) and `:3729` (`bootstrapLimits`: 64 for any pool with an id).
  - No other shipped doc says 96 boxes or names either constant.
- **last-docs#1, the Storage table's `lovejoin.<network>`** (`docs/architecture.md:426`), in the trace's words with its three corrections. `:423` is left as it is. Each field:
  - `launches`: each start's set (`version`: `v2`, none on a start before 1.8.0). Checked against `LaunchRecord.version` (`lovejoin.ts:1056`) and its one writer, `lovejoin-launch.ts:403`.
  - `bringing`: the retired pools' run is listed too, marked `retired` (`:1017`; written at `:4272`, `:4279`, `:6952` and `:6960`).
  - `recheck`: its two writers and its re-arm.
    - A run that sent withdraws and stopped, by Stop or by itself: 2 hours on, never later than a read owed sooner (`:6980`, `:7239`, `Math.min`; `SPENT_KEEP_MS`, `spent.ts:33`).
    - retireOnce: at once, where it dropped 1.7's counts or let a Bootstrap go (`:4269`). The read happens only once no run goes (`:6579`).
    - Again 2 hours on while a box the run's withdraws went for is listed and held as spent (`:6630-6634`).
  - `bringStopped`: its pool, or that it was the retired pools' (`:994`; written only by Stop, `:6983`).
  - The record's own `retired`: a time, set once, and never for a wallet with nothing there (`:999`, `:4236`, `:4244`). The row says `bringing`'s and `bringStopped`'s `retired` are marks.
  - The row names pr363#0, critic#3 and r2-critic#0 as 1.8.0's, because its other bare IDs are 1.6.0's. Each ID is in the code's comments.
  - The record's reader keeps all five (`:7773-7798`).
- **last-docs#2, a retired pool in the escape hatch's lines**:
  - `docs/flows.md:524`: Mix, Bootstrap and Mix my boxes again stay on "but in a retired pool (above)". Call 34's parenthetical now ends "since 1.8.0, a retired pool too".
  - `docs/architecture.md:735`: "only a box below the network's minimum, a copy, or, since 1.8.0, a retired pool (below)".
  - Checked against `usableNow` (`:4121`: `retired` comes before the copy and the minimum), `takesNewBoxes` (`:4156`) and `publicBuild` (`:4685`).
- **last-docs#3, the listing's es words**:
  - `docs/i18n/glossary.md:162`: es is now "los contratos actuales de Lovejoin; los contratos anteriores de Lovejoin". A sentence in the note says why es names Lovejoin in both halves.
  - This file's item 9 (`:169`) and *What the upload must paste* (`:254`) now quote the listing's reworded es sentence: "…y, para cada valor de caja, pone cajas nuevas solo en el primer pool que se inició con los contratos actuales de Lovejoin; los pools con los contratos anteriores de Lovejoin no reciben ninguna."
  - Checked against `docs/store/README.md:147`, read from the file. Every quote in item 9 and in the upload's list appears there word for word, and so does each half of the glossary row's es and ja.
- **last-docs#4, the ask's look in the archived plan** (`docs/archive/plans/chunk-44-lovejoin-v2.md:68`): the ask looks as the page does, through the data layer's list, and through Koios's holder where that doesn't answer (preprod, Koios-only, the data layer down).
  - `:60`'s *Superseded* note made the same claim ("looks at Koios's holder itself"). It now says the ask "looks itself, as the page does".
  - Checked against `lovejoin-pools.ts:413` (`look`), `:432-439` (`lookSoon`: `refresh`, then `answeredWithin`, then `scan`), `:480` (`refreshNow` asks no one where there's no data layer) and `networks.ts:77` (only mainnet has one).

### Checks run

- `git diff --check` on `docs/`: clean. No file's line count changed.
- No tests: none reads these files (`words.test.ts` scans `src/`, and `i18n.test.ts` reads only `docs/i18n/*.json`). No build, formatter or network. No git command that changes state.

### For the lead

- Two edits go beyond the findings' own words: the plan's `:60` and the glossary note's sentence. Drop either one if you don't want it.
- The code comments the trace names, `lovejoin.ts:1761-1764` and `:3734-3737`, still give 96. They're yours.
