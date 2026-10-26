# complete-b: is each finding fixed? (second half)

Lens: for each of the 66 findings below, I read its FINDINGS.md section, then the fixer's report (review/file-owners.md), then the code on `e43eef7f`. Then I confirmed the fixes that change behaviour by running their tests, and by mutating a copy to check the tests fail without the fix.

**Result:**
- 57 are fixed.
- 1 is fixed as far as its own fix goes, with one doc line left to the docs round (gap-3#1, L6).
- 8 are properly left: the owner's calls, the policy's date among them.
- None of the fixers' "fixed" claims fails on the merged tree.
- 1 nit: x-i18n-ja#4's fix left a verified critical key's back-translation stale, and the gate can't see it.

## Finding

### nit: x-i18n-ja#4's fix changed a verified critical value, and the es/ja gate passes on the stale verification
- **File:** `seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-ja.json:168` (checked by `extension/tests/i18n.test.ts:194-208`).
- **Fixer:** i18n-existing, x-i18n-ja#4.
- **Scenario:** i18n-existing changed the critical `lovejoin.launch.warn.atMost` (ja), from クレデンシャル to 資格情報. Its 2026-10-02 blind back-translation is of the old value, and the key is still listed as verified.
  - The gate keys on names alone: `.filter((k) => !ok.has(baseOf(k)))`. So it stays green.
  - L5 sends only the *new* critical keys (3 + 11) to the next blind batch, so nothing makes this one go again.
  - Low risk: one word, and the wallet's own term since 1.5.0. But any later edit to a verified value would slip past the same way.
- **Evidence:** a node diff of every key in verified-critical-{es,ja}.json whose value changed since `499768f6`. es: none. ja: this one key alone (old …プールのクレデンシャルが…, new …プールの資格情報が…). i18n-existing's report says the same under "Notes for the lead", but L5 doesn't list it.
- **Suggested fix:** put `lovejoin.launch.warn.atMost` (ja) into the round's blind batch beside L5's 14. Or drop it from `verified-critical-ja.json` until then, so the gate asks for it. Later, consider recording a hash of the verified value, so a changed value reads as unchecked.

## Checks, one line per finding

| finding | verdict | what holds it |
|---|---|---|
| 322#0 | fixed | `swaps.retry.privacy.cbor` under Details, between Copy and the hex (Swaps.tsx:3161-3165). The approvals-review-fixes test passes. The es/ja are L5's. |
| 322#1 | fixed | `aria-live` is on `.timeline__said`, which holds only the words (Swaps.tsx:3140). Details sits outside it. Mutation (aria-live back on the outer div): `expected [ Array(1) ] to deeply equal []`. |
| 323-rust#1 | fixed (the amount is the owner's call) | Core `direct_tail_reserve` (lovejoin/mod.rs:1699-1718) and wasm `lovejoinDirectCollateralReserve`. The site's funding and a top-up use it (sessions.ts:1878, 2134), and `COLLATERAL_TAIL_RESERVE`'s doc is corrected. The node test passes on the shared pkg. Mutation (the site back on the chain's figure) fails 2 tests: `expected '1500000' to be '2800000'`. |
| 323-worker#0 | fixed | `orWithoutReserve` (sessions.ts:4498-4505) in all four builders. The swap form's `maxAdaIn` keeps the quote's `collateralReserve` aside, with `FEE_ROOM` 2 ₳ (swap.ts:114-136). The Mix form's `mixMost` does the same with `tailReserveOf` (Lovejoin.tsx:207, 293-326). Mutation (fallback off) fails 5 tests: `Not enough ADA in your private balance…`. |
| 323-worker#2 | fixed (the words); the way out properly left | `TailWait` and `tailWaiting` give each wait true words and a bound (lovejoin.ts:1277-1281, 3863-3925), and the Koios case throws Koios's own error. A direct way out is the owner's 323-worker#3. Mutation (one generic key) fails 2 tests. |
| 323-worker#3 | properly left (owner's call) | The fixes around it hold: the words (323-worker#2), and withdraws going meanwhile (x-scenarios-lj#1). |
| 323-worker#4 | fixed | `mix.noCollateral` is set from `backReserved` (sessions.ts:2102), and buildBack then takes no collateral (sessions.ts:4298-4300). Mutation (pick unconditional): the lovejoin-flows 323-worker#4 test fails. |
| 323-worker#5 | fixed | A box whose deposit is known in but isn't listed is waited for, `LANDING_MS` from when the deposit was first known in. One the wallet's own send spent is taken for moved at once (lovejoin.ts:3879-3886). Mutation (grace removed) fails 2 tests: `promise resolved … instead of rejecting`. |
| 323-worker#6 | fixed | The site's note becomes `noteLovejoinMixed` (DappApprovals.tsx:481), the top-up's `sites.topUp.collateralMixed` (SiteSessions.tsx:518-522), the swap Plan's `*Mixed` and `noBoxMixed` (Swaps.tsx:1362, 1380, 1457-1503), and the Mix review's hint `*NoteMixed` (Lovejoin.tsx:171-178). The form's figures are in `mixCosts`. The by-hand 5 ₳ notes are properly left with Session 10's call 2. |
| 323-worker#7 | properly left (owner's call) | See question 1: reserve's fallback now reaches this state for new sessions. |
| 323-worker#8 | fixed | 11 planner tests (lovejoin-planner.test.ts:1629-1860) cover `tooLong`, `TAIL_TRIES`, PoolShort, no pool, and a sent mix later dropped. The defect they found is fixed: `chain.from` (sessions.ts:523, 1228-1237), optional, so older records read as before. |
| docs-small#1 | fixed | chunk-34 plan §2 step 5 gains "As built (34c, decision 30)", and the registration bullet is struck (:287, :292). |
| docs-small#2 | fixed | keys-and-accounts.md:129 adds a pool started from the account and a box paid by it, and says giveme.my backs a box coming back and the collateral's mix. |
| gap-1#0 | fixed | `account-use` waits only on `publicChainsSending` (`session === undefined`; handlers.ts:358-367, lovejoin.ts:5124-5127). The countdown and Remove wallet still count every chain. Mutation (any chain): `A payment or mix from this account is still on its way…`. |
| gap-2#0 | fixed | `RestTo` and `account_send` docs now say tokens go `MAXIMUM_TOKENS_PER_UTXO` to an output (build.rs:1485-1491, 735-737). most_test guards it. |
| gap-3#0 | fixed | flows.md:477 has the setting's current name, the floor and two free boxes, the deposit then one mix under giveme.my's collateral, and the sweep. The preference's comment matches. |
| gap-3#1 | fixed as far as its fix goes | :449/:471/:477/:489/:493/:513/:521, architecture.md:632/:735 and the root README:255 are fixed. flows.md:512 still gives the old Mix form's figures: the docs round's (L6). |
| gap-3#2 | fixed | The same fixes as 323-worker#6, and the costs: `swapCosts`' `collateral` and FundingWayBack's `collateral` row (DappApprovals.tsx:461-476). The by-hand notes are left with Session 10's call 2. |
| gap-3#3 | fixed | flows.md:420 says every UTxO, 20 a transaction, 25 at most. architecture.md:162-163 names `buildTransferParts`/`max_in_parts`. |
| gap-3#5 | fixed | flows.md:102 lists Bring every box back now among Settings' requests (the data layer or Koios, then giveme.my for each), and among its Lovejoin items. |
| gap-3#6 | fixed | The `parts-waiting` request and LockCountdown's line, and `atStake.partsWaiting` with Settings' line (handlers.ts:184-190, 616-626). Mutation (answer forced false) fails 3 tests. |
| x-compat#1 | fixed | The runbook's rollback note is rewritten by kind of route, with `.prev` named by its sha256 and its run, and a step for the route checks after each deploy. development.md's step 7 is narrowed to public routes (:279). |
| x-compat#2 | fixed | The gate gains a case with the head start's pools handed over (lovejoin-1-5-0.test.ts:736-), and recording refuses unless the version is 1.5.0 (:715-716). It passes on both builds. |
| x-compat#3 | properly left (owner's call) | none |
| x-i18n-es#0 | fixed | "Poniéndose en marcha: …". |
| x-i18n-es#1 | fixed | Reordered in en, es and ja, with "if not" beside its condition. settings.test pins the en. |
| x-i18n-ja#0 | fixed | "the server" in partlyMaybe and fundingPartlyMaybe, in all three languages. The i18n-review-fixes guard covers it. |
| x-i18n-ja#1 | fixed | ja partlyMaybe now covers both outcomes (確定するか、確定できなくなったら). |
| x-i18n-ja#2 | fixed | 資金提供. |
| x-privacy#0 | fixed | **Worker:** the private payer ranks a UTxO that ties no other account first (lovejoin.ts:6668-6671). **Page:** the questions name the accounts (`*.Named` keys). Mutation (rank dropped) fails the crediting test. |
| x-privacy#1 | fixed | The swap approval gets `swap-collateral-mix` (Swaps.tsx:1390-1394). The private mix review and Mix my boxes again get `CollateralMixNote` (Lovejoin.tsx:3592, 3602-3611, 3677). |
| x-privacy#2 | fixed | The policy's giveme.my bullet (:48-49), privacy.md :50 and :121, and the store README's Koios, giveme.my and alarms rows. |
| x-privacy#3 | properly left (owner's call) | Not made worse: the quote's check is quiet, and `tailReserve` reads once a build, before the fallback. |
| x-privacy#4 | properly left (the policy's date, decided) | none |
| x-release#2 | fixed (the live harness is unrun, as docs-2 says) | development.md's route curls (:206-213), 1.6.0 flows in the checklist (:143-145), the shapes harness (:114, :177), and the harness's network pick and labels (lib.mjs:29-32, flows.mjs:30). live-runs-copy passes. |
| x-release#3 | fixed | The same as x-privacy#2. |
| x-release#4 | properly left (the policy's date) | none |
| x-release#5 | fixed | The web wallet README's *After v1* paragraph and Staking bullet. The extension README's rows, and `npm run lovejoin-pools`. |
| x-release#6 | fixed | The same as x-compat#1. |
| x-release#7 | properly left (owner's call) | none |
| x-scenarios-lj#1 | fixed | The withdraws wait on `chainsMixing`/`mixing` (lovejoin.ts:1297-1304, 5934, 6137, 6308), and Bring every box back now says the `collateral` wait. Mutation (`mixing` = not ended) fails 3 tests. |
| x-scenarios-sessions#1 | fixed | WebAssembly's `LeftWhy` and `MaxLeftNote` (Withdraw.tsx:401-416), used on both reviews. |
| x-scenarios-sessions#2 | fixed | (a) `pumpHolds` (parts.ts:596-633). (b) partlyMaybe now says "so the rest didn't go", true at parts.ts:652. |
| x-scenarios-sessions#3 | properly left (owner's call) | none |
| 314-core#2 | fixed | `with_staking` takes only a script's cert 0 (build.rs:1749-1764, staking.rs:347-362). staking_test covers it. |
| 316#4 | fixed | rpc.ts:2403: the comment is above `LovejoinChainTx`, and `cleared`'s comment has its own line. |
| 317-data#2 | fixed | `stable_cursor` is read once per tip hash (state.rs:307-328, routes.rs:242). Test: `the_stable_cursor_is_read_once_a_tip`. |
| 318-worker#3 | fixed | One `epoch_params` read per review, for a launch and for mixes. The lovejoin-flows and planner tests count it. |
| 319-rust#2 | fixed | The wasm lovejoin.rs module doc covers pools and width (:9-14). The mix-width doc's path is `lovejoin/mod.rs`. |
| 321-lj-rust-data#1 | fixed | `external_sweep_with` is removed (no reference left), and `external_sweep` is 1.5.0's again. |
| 321-lj-screens#6 | fixed | `donePool` gives `settings.lovejoin.bringNonePool` (BringAllBack.tsx:168, 300). |
| 321-parts-rust#1 | fixed | The same as gap-2#0. |
| 321-parts-rust#2 | fixed | `max_in_parts` over no UTxOs refuses (lib.rs:4323-4328). Probed on the shared pkg: `buildTransferParts` with no UTxOs throws "There's nothing in the Seedelf balance to send". |
| 323-rust#2 | fixed | `external_sweep_with`'s doc went with it. The module doc's step 3 and `ChainResult.returned`'s doc (lovejoin.rs:1397-1402) are corrected. |
| docs-small#3 | fixed | Plan :352 says the merged history (`changeHistory`). |
| gap-3#4 | fixed | seedelf-platform/CLAUDE.md now covers `max_inputs` per transaction, Max in parts, `carry`/`carried`, `MAX_VALUE_SIZE` with `TooLarge`/`TooMany`, and `mix_giveme`. |
| gap-3#7 | fixed | flows.md:521: greyed, keeping its setting, and a mix from the tile still mixes its collateral. That matches `collateralIntoPool` and `throughLovejoin`. |
| x-i18n-es#2 | fixed | The es headings and their count (i18n-existing), and sc-lj-1's `held`/`released` plurals rendered through `amounts.count` (Lovejoin.tsx:2317-2319). |
| x-i18n-es#3 | fixed | "Ingresa…". No "Escribe" is left for an "Enter". |
| x-i18n-es#4 | fixed | "no respondió a la última enviada". |
| x-i18n-es#5 | fixed | "a la vez". |
| x-i18n-ja#3 | fixed | 宛先を 1 件ずつ. |
| x-i18n-ja#4 | fixed, with the nit above | 資格情報 in both keys. No クレデンシャル is left in ja.json. The critical key's verification is stale (above). |
| x-i18n-ja#5 | fixed | ボックス {{floor}} 件中. |
| x-i18n-ja#6 | fixed | glossary.md: "Chosen for 1.6.0" (:121), and the owner's "the server" row. |
| x-release#8 | fixed | data-layer.yml lists `constants.rs`, `networks.ts` and `nft-images.json`. By grep, all six files outside seedelf-data that its build reads are now in the path filter. |

## Questions (not made concrete)

1. **Reserve's fallback vs. the reviews that key on `collateralReserve`.**
   - `orWithoutReserve` (323-worker#0) funds a short balance with no `collateralReserve`.
   - The swap approval's giveme.my line and its `*Mixed` words (x-privacy#1, 323-worker#6) show only where `summary.collateralReserve` is set (Swaps.tsx:1285). The site's funding note works the same way.
   - buildBack still mixes the collateral where what the chain leaves pays (`intoPool`; the owner's call 323-worker#7).
   - So a token→ADA swap from a balance just short of the reserve may run a return that sends giveme.my the collateral's mix. Its approval named no such mix.
   - Does 323-worker#7's "Leave" cover sessions the fallback funds, not just those from 1.5.0 or before a pool showed? I didn't build that end to end.
2. **323-worker#5's grace and a rebuilt tail.**
   - The grace runs from `Tail.landed`, which `tailChain` itself sets when it rebuilds a tail.
   - Say that rebuilt chain is cut before it sends anything. A later build more than 15 minutes on, meeting a lagging listing, takes the box for moved at once.
   - I couldn't make that sequence concrete.

## What I ran

- **Vitest, default build:**
  - lovejoin-planner: 68/68.
  - 15 review-fix and related files: 199/199. These were approvals, collateral-reserve, swap-form, lovejoin-form, max-left, parts-send, chain-requests, remove-wallet, lovejoin-accounts, lovejoin-crediting, lovejoin-bring-screen, lovejoin-bring, i18n-review-fixes, settings and live-runs-copy.
  - lovejoin-1-5-0, lovejoin-flows, sessions-review-fixes, home-review-fixes, lovejoin-release-rules: 87/87.
- **Vitest, preprod build:** 10 of those files, 120/120.
- **Typecheck:** `tsc --noEmit -p .` is clean, but for other reviewers' untracked `zz-review-*` files.
- **Node:** `wasm/tests/lovejoin-reserve.test.mjs` passes on the shared pkg. A scratch probe ran `buildTransferParts` over no UTxOs.
- **Mutation checks in a scratch copy**, each failing its tests as quoted above:
  - gap-1#0;
  - x-scenarios-lj#1;
  - 323-worker#5;
  - 323-worker#0;
  - 323-rust#1 (the site's figure);
  - 323-worker#4;
  - 323-worker#2;
  - gap-3#6;
  - 322#1;
  - x-privacy#0.
- The copy is deleted. I wrote no file in the tree but this one.
