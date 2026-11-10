# 1.9.0's release review: the docs-prep lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c, against web-wallet/1.8.1 (f77aa5c1):
- every docs/ change since 1.8.1: architecture.md, flows.md, privacy.md, backlog.md, development.md, releases.md, the i18n JSONs (lightly), chunk 47's plan, chunks 40 and 41 (moved) and chunk 46's plan;
- wasm/README.md, the prep commit ed14af7b, and #372 (check.sh, Audit/count.py, Audit/README.md), plus seedelf-verification/README.md;
- the code behind each claim: cip30.rs inspect (and released_from_contracts, datum_names_key, key_releases), DappApprovals.tsx, dapp.ts, tx-view.ts markYours, sessions.ts checkOrder and routeOf, minswap.ts, orders.rs and orders.json, wasm lib.rs read_dex_order, dreps.mjs, run-all.sh, Blaster's Env.lean and Tactic.lean;
- docs/store/privacy-policy.md, which is unchanged since 1.8.1 and whose last entry is 6 November 2026.

What I ran:
- a relative-link and anchor checker over the 15 changed or related Markdown files;
- sha256sum, stat and zip listing on extension/release/seedelf-wallet-1.8.1-mainnet.zip (read only);
- a node check of both DRep lists against dreps.mjs's exact format and sort;
- a Python scan of the 669 Lake traces for Undetermined, Valid and Expected Falsified;
- a bash replica of check.sh:203-212 run on a console output shaped like Audit/logs/audit-classic.log;
- 2 Koios reads: preprod drep_info for the four new DReps, and mainnet utxo_info for V4's reference;
- 3 Minswap estimate calls: mainnet with ChakraBondingCurve, mainnet with the wallet's current exclude list, and preprod with its exclude list.

No Lean build, no Vitest or cargo run, no worktree; nothing in the main tree touched. Scratch files are under /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/docs-prep/.

Not done:
- es and ja back-translation of #373's keys (left to the i18n/#373 lane);
- chunk 47's chain-sample numbers (174 fills, 33 with a 3 ₳ budget, 27 Danogo transactions, six V4 orders), which need many Koios pages;
- Minswap's documentation for WingRidersStableV1;
- preprod's refusal of ChakraBondingCurve;
- the 1.8.1 record's test counts and toolchain lines.

## Findings

### docs-prep#1 (low, #372, confirmed-by-run): check.sh marks a module UNDETERM for an Undetermined warning in any module it imports, and counts that warning as its own

**Files:** seedelf-verification/check.sh:199, seedelf-verification/check.sh:203, seedelf-verification/check.sh:211

**Claim.** check.sh counts every `^warning: .*Undetermined` line in the whole console output of `lake build "$m"`. Lake also replays the logs of M's up-to-date imports, and grep -v at line 199 strips only their 'Replayed' header lines. So one imported module's Undetermined makes every module that imports it read UNDETERM, with the import's warnings in its count. It never says ok when it shouldn't. But the summary names the wrong modules, and an importer's own checks may all be Valid: a tactic-mode `blaster` that comes back Undetermined leaves its goal open and fails the build (Blaster/Command/Tactic.lean:61-64), so a warning only ever comes from a `#blaster` command, which gives an importer no theorem to rest on.

**Evidence.** check.sh:199-205:
  | grep -v -E 'Replayed|CekMachine.lean:309|...' \
  | tee "$outf"
  rc=${PIPESTATUS[0]}
  undet=$(grep -cE '^warning: .*Undetermined' "$outf")
  [ "$rc" -eq 0 ] && [ "$undet" -gt 0 ] && rc=undetermined

Audit/logs/audit-classic.log:1-4 (check.sh's own console output) shows an import's replayed log under the module being built:
  == Audit.Classic.RefHolder (cap 16G, limit 60m)
  info: Lovejoin/ReferenceHolder.lean:26:69: ✅ Valid
  warning: Lovejoin/ReferenceHolder.lean:26:69: declaration uses 'blasterProven' ...
  ⚠ [568/568] Built Audit.Classic.RefHolder
Audit/Classic/RefHolder.lean:1 is `import Lovejoin.ReferenceHolder`.

I replayed lines 203-212 on such an output: module M fine, its import D with one `warning: Lovejoin/D.lean:30:2: ⚠️ Undetermined`. Script: scratchpad/review-1.9.0/docs-prep/sim/undet-sim.sh. Output:
  UNDETERM  Audit.M (1 Undetermined)
  check_failed=1

None of the 669 traces in the main tree holds an Undetermined warning today, so nothing is mislabelled yet.

**Scenario.** After a fork bump, one `#blaster` check in Lovejoin.AnyTx.X (one of lovejoin-every's 51 imports) times out to Undetermined. `./check.sh lovejoin-every` lists X as UNDETERM, and also each of the 25 Lovejoin.Every modules that import X, each '(1 Undetermined, …)', though their own checks are all Valid. The owner reading the summary, or a session updating CLAIMS.md from it, puts the gap in 26 modules instead of one.

**Fix.** Count only the module's own lines. Either match its own source path (`grep -cE "^warning: ${m//.//}\.lean:[0-9]+:[0-9]+: .*Undetermined"`, adjusted for the Slice/ and Upstream/blaster-main packages), or read its own `.lake/build/lib/lean/<path>.trace` log, as count.py does.

### docs-prep#2 (nit, #372, traced): The verification README still says to review the output for Undetermined warnings, which check.sh now catches itself

**Files:** seedelf-verification/README.md:53

**Claim.** #372 makes check.sh report a module that logs Undetermined as UNDETERM and exit 1. It updated Audit/README.md and count.py's docstring to say so, but not the main README's 'Running it' paragraph, which still presents the exit status as covering builds only.

**Evidence.** seedelf-verification/README.md:53-56: "The runner uses `systemd-run --user` for its memory caps and returns a nonzero status if any module fails. It checks Lake builds; some Blaster checks can still be reported as undetermined warnings, so review the output." Now check.sh:204-205 sets rc=undetermined and check_failed=1, and line 211 prints UNDETERM. `git diff ce08e89b^1 ce08e89b --stat` touches only Audit/README.md, Audit/count.py and check.sh.

**Scenario.** Someone running the README's `./check.sh lovejoin && … && ./check.sh` chain reads that a green exit can still hide Undetermined checks. They hand-search the output for something check.sh already fails on, or they don't trust a clean exit.

**Fix.** One line: "…returns a nonzero status if any module fails, times out, or logs a Blaster check as Undetermined (UNDETERM)."

### docs-prep#3 (nit, #371, traced): Chunk 46's plan is live in docs/plans/ and contradicts its own steps

**Files:** seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md:5, seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md:17, seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md:47

**Claim.** Three statements in the live plan are older than the steps below them. Line 5's status says 'step 1 done 2026-11-08; step 2 next', but step 2 is 🚧 with its full run done and step 3 is ✅. Line 17's table, under 'Where it stands (2026-11-07)', says #455 is 'Open. CONFLICTING', but step 1 says it 'shows MERGEABLE' after the 2026-11-08 force-push. And step 1 still ends 'Then the owner force-pushes, PATCHes the body and posts the comment', right after saying the owner did exactly that. plans/README.md: 'A stale plan read as current is the one failure mode that costs real work'.

**Evidence.** plans/chunk-46…md:5 "**Status: 🚧 step 1 done 2026-11-08; step 2 next.**"; :48 "2. 🚧 **Our suite on #77…**" (its 'The full run (2026-11-08)' follows); :91 "3. ✅ **#73** merged 2026-11-08"; :17 "| … Lean-blaster #455 | Open. CONFLICTING since #155 moved it to `main`… Rebased locally (step 1) |"; :47 "**Posted (2026-11-08):** the owner force-pushed (head `e540263`), PATCHed the body and commented. #455 shows MERGEABLE, waiting on its reviewers. Then the owner force-pushes, PATCHes the body and posts the comment (the classifier refused Claude's force-push in chunk 41)." The rest of the plan's local facts hold (see checked_ok).

**Scenario.** A session picks chunk 46 up from its status line or table. It treats #455 as conflicting and asks the owner to force-push and post again, or it starts step 2 from scratch.

**Fix.** Status: 'steps 1 and 3 done; step 2 in progress'. Row: 'Open, MERGEABLE since the 2026-11-08 force-push'. Drop step 1's last 'Then the owner force-pushes…' sentence.

### docs-prep#4 (nit, docs, confirmed-by-run): releases.md's 1.8.0 record links chunk 44's plan at its old path

**Files:** seedelf-platform/seedelf-web-wallet/docs/releases.md:50

**Claim.** This was already broken before 1.9.0. In the 1.8.0 section, `[chunk-44-lovejoin-v2.md](plans/chunk-44-lovejoin-v2.md)` points at docs/plans/, but the plan moved to docs/archive/plans/ in 0b75beaa, before 38dc74cb wrote the record. It is the only broken relative link or anchor in the docs this release changed.

**Evidence.** Link checker over the changed docs: `seedelf-platform/seedelf-web-wallet/docs/releases.md:50: plans/chunk-44-lovejoin-v2.md (no such path)` and '1 broken'. `git ls-tree` at f77aa5c1 and at 8d7c4b0c has only docs/archive/plans/chunk-44-lovejoin-v2.md. `git blame -L 50,50` gives 38dc74cb (docs(web-wallet): 1.8.0's release record). Git history of the archived file starts at 0b75beaa (1.8.0's release review).

**Scenario.** A reader following releases.md's 1.8.0 record to its plan gets GitHub's 404.

**Fix.** Change the link to archive/plans/chunk-44-lovejoin-v2.md in the 1.9.0 record PR.

## What holds

- architecture.md:563 (contract UTxOs) matches cip30.rs: contract_* counts only found script inputs that aren't the account's (1250-1272); released_from_contracts works per asset, credits nothing when the account spends more than it gets, and counts money paid back to the contract as gone (1103-1135); datum_names_key reads the UTxO's inline datum or a datum the transaction carries, with no lookup (1083-1097, 1228-1246); key_releases is names_key, a required signer of the account's, or a contract input with no script_data_hash (1832-1838).
- The window parts that paragraph and flows.md describe match DappApprovals.tsx: releasesContractFunds gates the row (1102-1122), the warning before who it pays (1141, stronger text when namesKey) and the switch (124-126, ackFor keyed to the request id); the contract-inputs note shows only when not releasing (1072).
- flows.md's V3-or-V4 stake-key cancel, privacy.md:108 and wasm/README.md's readDexOrder row match orders.rs (signs_with_stake, the Constr 0 [] cancel) and lib.rs read_dex_order, DexOrderRequest, DexOrderResult and Session::owns.
- privacy.md's 'a V4 order under the session's own' staking part fits checkOrder (sessions.ts:6673-6676): an order is taken under the session's own staking part or none, Minswap's fixed part only at SUNDAE_V3's order script, and stakeSigns needs ownStake.
- architecture.md's V4 paragraph matches orders.rs:405-425 and 500-515: owner Signature, Fixed destination with None, and only basic_order then fee_constraint, by hash. Its routing claims match minswap.ts: SundaeSwapV4 in MAINNET_PROTOCOLS, PREPROD_NOT_PINNED, 7 mainnet exclusions, 19 MINSWAP_PROTOCOLS.
- Chunk 47's facts (Koios run): the V4 reference c1ecddd6…#0 is unspent, plutusV3, 3,128 bytes, script hash 07eb2fb0…, as orders.json pins it.
- Chunk 47's facts (local): orders_test's #[test] count went from 24 to 26; order_cancels.json holds V4's real cancel 8dc9ee14…, with a 1,280,000 budget and both modules; the REAL list in order-cancel-check.test.ts gained V4; no tracked seedelf-data file names an order script.
- Minswap live (3 calls): the mainnet 400 names only `body/exclude_protocols/7` (ChakraBondingCurve) and counts 23 constants without naming them; the 7 names before it, WingRidersStableV1 among them, are taken. The wallet's mainnet list gets a 200 (route: Minswap), and preprod's list, with SundaeSwapV4, gets a 200. This bears out backlog.md:111 and the 23-name claims.
- Privacy policy (docs/store/privacy-policy.md): no dated entry owed. #373 adds no request or stored field: the foreign-UTxO lookup was already disclosed in the sites row ('asks the Cardano server about those UTxOs'), and markYours/yourSigners is local and returned, never stored. #375's second estimate is routed(ask, exclude+avoid) (minswap.ts:358, sessions.ts:885): the same fields to the same service. #377 adds no fetch or storage, and V4's script comes through the existing order-script path.
- The house rules hold in the added doc lines: no release dates, no store status, no release notes. docs/store/ is unchanged, and the only 1.9.0 mentions are development.md, package.json and chunk 47's 'for 1.9.0'.
- releases.md's 1.8.1 row and section hold: f77aa5c1, and the SHA-256 cf745c24…8628 matches the given value on both lines. The zip on disk hashes to exactly that: 2,116,417 bytes, 24 files. The tag web-wallet/1.8.1 points to f77aa5c1.
- The 1.8.1 record's other claims hold: DReps 466 mainnet and 63 preprod; head start of 2 mainnet pools, including fcb3f5ec… at height 14,167,059, and 5 preprod pools; no seedelf-data or token-list change since 1.8.0 (none since 1.8.1 either, so 1.9.0 owes no API deploy); lovejoin-every = 51 + 25 = 76.
- development.md's blocks name 1.9.0 (release_version=1.9.0 and the seedelf-wallet-1.9.0-mainnet.zip file name). package.json and both version fields in package-lock.json are 1.9.0, and the manifest takes pkg.version (vite.config.ts:106).
- DRep list format: both files are byte-identical to dreps.mjs's output format and sort (localeCompare en/base, then id); ids unique and drep1; names at most 64 characters with no control characters.
- DRep list changes: preprod went from 63 to 67 with none dropped; mainnet stays 466 with only `recorded` moved. `recorded` 2026-11-10 is the script's UTC date (the commit is 17:02 PST on the 9th).
- The four new preprod DReps are plain ASCII, look like no listed DRep (the nearest are mainnet's 'Tobias Ilskov' and 'Mirai(未来) Blockchain Group'), and are active on preprod with metadata on preprod.dreptalk.com (Koios drep_info run).
- #372's check.sh mechanics hold: no set -e, so grep -c's exit 1 can't abort the loop; rc=${PIPESTATUS[0]} is still systemd-run's after `| tee`; quoting is fine and $outf is removed; UNDETERM sets check_failed, so the README's && chain stops.
- #372's matching holds: 'Expected Undetermined' logs as info and never matches ^warning:. Lake prints `warning: <path>:<l>:<c>: ⚠️ Undetermined` without ANSI into the pipe (the format of Audit/logs). No main-tree trace holds an Undetermined warning today (669 scanned), so no current module turns UNDETERM.
- count.py: the docstring edit is accurate, and it flags '⚠️ Undetermined', not Expected. It always exits 0 (already so before #372), and nothing reads its status: run-all.sh tees it, and no CI runs check.sh or count.py (continuous-integration.yml runs Aiken only, and web-wallet.yml's path filter skips seedelf-verification).
- #371 links: chunks 40 and 41 moved with every relative link deepened by one level, and their 'Where it ended' sections read right. Every relative link and anchor in the changed docs resolves except releases.md:50 (docs-prep#4).
- Chunk 46's local facts hold: alias counts 78/15/12/6 in the .lean files; pins 25c0ee0, 68c5399 and 9938562; Lean v4.24.0 in both packages; traces 1,208+258 = 1,466 Valid, 233+6 = 239 Expected Falsified, 0 Undetermined.
