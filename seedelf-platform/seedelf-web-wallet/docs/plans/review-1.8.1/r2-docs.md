# 1.8.1's review, round two: r2-docs

Lens: every doc as merged, against the code as merged and against each other. The tree read is the main tree with the merged fixes (`git diff HEAD`). One repro test (`EXT/tests/zz-r181-r2-docs-1.test.ts`), run alone and deleted. R2 was not touched.

**In short:** no high or medium. Four lows and nine nits. Two of the lows are where lanes meet: the policy entry the docs lane reworded owes the release PR's merge day, by the owner's dating rule, and the guard's new set (the guard lane) lets a connected site learn something no doc says. The AnyTx README still says that what CLAIMS.md claims is open, and the dApp guard is in no design doc. Everything else checked held (*Checked, and held*, below).

## Findings

### r2-docs#1 · low · `docs/store/privacy-policy.md:3`, `:93`: the 1.8.1 entry's date must be the release PR's merge day, so "the 6 November entry stands" fails

- **What's wrong.** The FIXBRIEF says "the 6 November entry stands", and the docs lane reworded that entry's last clause.
  - Rewording is the house's way: 1.7.0's review reworded the unreleased 28 October entry (`8f717678`, in #340), which was already on `main` through #336.
  - But the date then moved too. `71f19902` (#344): "The policy's date is the release PR's merge day (the owner's call, as 1.6.0's), and 28 October stood only if #340 merged that day. It merged on the 29th, so the Effective line and the Changes entry say 29 October."
  - 1.7.1's entry is #350's merge day, and #350 is its release PR (`archive/roadmap.md:57`). 1.8.0's is #365's, 6 November.
- **Evidence.**
  - The reward-account entry came with #367 (`7a8c9eeb`), merged 2026-11-06 15:43 −0800, dated that day.
  - 1.8.1's release PR isn't open yet, and it's now 2026-11-07 00:53 −0800 (08:53 UTC). It can't merge on 6 November in either time zone.
  - The working tree still has `Effective 6 November 2026`, and the entry `6 November 2026: before the wallet builds a Lovejoin mix…`.
- **Is the reworded clause true?** Yes. Every build reads `account_info` (`rewardsIn`, `lovejoin.ts:4661`), a review included, so an unsent review has read it too. A kept mix or return reads again at Send (`:5194`, `sessions.ts:5049`).
- **The failure.** Merged on 7 November or later as it stands, the page's Effective date and the entry predate text that only appears that day. That breaks the owner's rule, and the page's own promise to "update this page and its date".
- **Fix.** On the release PR's merge day, put that date on the reward-account entry and the Effective line, as #344 did. The 1.8.0 entry below it keeps 6 November. Or ask the owner, if 6 November should stand this time.

### r2-docs#2 · low · `seedelf-verification/Lovejoin/AnyTx/README.md:259–303`: two sections still say the whole launch and the whole Owner/Mix are open, against CLAIMS.md and the README's own results

- **What's wrong.** #368 put "The complete results above supersede this section's partial ones" on *Withdrawal-handler progress* (`:113`) alone. Two later sections, *Owner verifier progress* and *Remaining safety work*, are unqualified, and they deny what chunk 45 proved:
  - `:268` "it is not yet a theorem from full-validator success";
  - `:277` "These results still need to be connected … as part of a single whole-validator execution proof";
  - `:283` "not yet proved from full-validator execution";
  - `:286` "the whole launch theorem remains open", and `:288` "Mix proof and output checks remain bounded to the stated layouts";
  - `:295` "general proofs for the other scripts are still needed for arbitrary-length and interleaved input, reference-input, output, withdrawal and redeemer lists";
  - `:304`, *Additional transaction matrix to verify*: most of its Owner, Mix and withdrawal rows are what the every-transaction theorems now cover.
- **Evidence.**
  - `Lovejoin.Every.Readable.one_shot_mint_accepts_iff` (`Readable.lean:257`) is the whole launch, for every typed V3 context.
  - `mix_logic_accepts_iff` (`:224`) is the whole validator, Owner and Mix, for every context with no list bound.
  - Both are guarded at `[propext, Classical.choice, Quot.sound]`, and the guards were built in the lead's capped run (`SCRATCH/lean/lovejoin-every-r1.log`: "Built Lovejoin.Every.Readable", 76 ok).
- **The failure.** The README contradicts itself, and CLAIMS.md's "exactly when each one accepts, in every transaction … with no limit on inputs, outputs or proofs". The verification README's `:7` sends readers to this file for "what they cover and what they leave out", and CLAIMS.md cites it as the backing. Someone checking the claim reads that the launch theorem is open and the Mix bounded, so the claim looks overstated when it isn't.
- **Fix.** Docs only, no build. Widen the supersede note to cover `:259–303`, or open both sections with it: "superseded for mix_logic and one_shot_mint by `Lovejoin/Every/` (chunk 45); they stay as cross-checks." Then rescope *Remaining safety work* to what's left in scope (nothing; fee_contract is out), and call the matrix cross-check targets.

### r2-docs#3 · low · `docs/architecture.md:565` (and `flows.md:432`): the dApp signer's Lovejoin refusal is in no design doc, so its new set is described only in an archived record

- **What's wrong.**
  - **The code.** `DappService` refuses a site's transaction whose `paidScripts` holds a pool's `mix_logic` hash, before the window opens (`dapp.ts:2099–2104`). Since the guard lane, its set is the classic pool and every pool discovery keeps (`mixLogicHashes`, `lovejoin.ts:4631`).
  - **architecture.md's *Signing* list of refusals** (`:565–566`) names the other network, a collateral return, a transaction marked to fail, an old-style deregistration and a pool owner, but not this.
  - **flows.md's "refused before the window opens"** (`:432`) doesn't name it either, and neither does privacy.md.
  - **The only descriptions** are the archived chunk 43 record (`:47`), which the archive's README says not to build from, the backlog's Step 5 line and wasm/README's `paidScripts`.
  - **The plans README's rule:** what still holds moves into the design docs when a chunk lands.
- **Evidence.** `git grep -n "mixLogicHashes\|everyKept\|lovejoinRewards" -- '*.md'` finds only chunk 43's record. `paidScripts` appears in no design doc.
- **The failure.** Someone changing the connector reads the refusal list and doesn't learn that this one exists, or which pools it covers. That set is exactly what the guard lane just changed.
- **Fix.** One bullet in *Signing*, after the pool-owner refusal: "And a transaction that pays into a Lovejoin pool's `mix_logic` reward account (`paidScripts`: a pool registration's reward account, a proposal's deposit return, a treasury payee), for the classic pool and every pool discovery keeps (`mixLogicHashes`, asking nobody), refused before the window opens in `dapp.lovejoinRewards`'s words (chunk 43; 1.8.1's release review, guard#1)." flows.md:432 gets the same clause.

### r2-docs#4 · low · `docs/privacy.md:170`: a connected site can learn, silently on a yes, which Lovejoin pools this device keeps, and no doc says so

- **What's wrong.**
  - **What the set depends on now.** The guard lane made it discovery's record (`everyKept`): the head start's pools, plus those this device found since. That record depends on whether, and when, the device looked: a device that never reads Lovejoin's pools keeps the head start alone.
  - **What a site does.** It sends `signTx` with a proposal or pool registration whose reward account is a later pool's `mix_logic`. It hears an immediate code-1 refusal with no window where the device keeps that pool, and a signing window (then "The user declined.") where it doesn't. A private session's `signTx` runs the same check.
  - **What it learns.** That this device has read Lovejoin's pools since that pool launched, so it uses Lovejoin or private returns. Copies and retired pools carry the same signal.
  - **What the docs say.** privacy.md says "The site learns nothing about Seedelf from the connector", and the policy calls the pool list "the same for everyone". Neither says a site can probe it.
  - **Who raised it.** The docs lane's report put it under *For the lead* (a possible privacy.md line, not written). v-guard noted that `known` already showed it. Nobody decided.
- **Evidence.** Repro `zz-r181-r2-docs-1.test.ts`, built on `dapp-lovejoin-rewards.test.ts`'s harness: two wallets, one whose discovery found the v2 token pool since the head start and one whose discovery never looked. The same site's pool registration, paying that pool's `mix_logic` account:
  `{"found it since":{"asked":false,"failure":{"code":1,"info":"The wallet won't sign this: it pays into a Lovejoin pool's reward account, which anyone may take from."}},"never looked":{"asked":true,"failure":{"code":2,"info":"The user declined."}}}`
- **The failure.** It's one bit per probe, about the device's private-side use, given to any connected site, a private session's too, and disclosed nowhere. Each "no" shows the user a window, which keeps it narrow.
- **Fix, the owner's call.**
  - **The smallest:** one line in privacy.md's *Connecting a site*, saying a site can tell from an unasked refusal which Lovejoin pools this device knows, which shows whether it has looked at Lovejoin since a pool appeared. Then whether the policy's *sites you connect* row says so too.
  - **To remove the signal:** refuse only after the window, in the decline's code. That's a change to the owner's guard.

### r2-docs#5 · nit · `docs/backlog.md:23`: guard#10's line says the failed list's words are "none of them critical", which worker#1's rethrow made false

- **What's wrong.** The line was written on `2a8060d3`, where a chain stopped for its balance threw staking's words. The refusals lane's worker#1 rethrow (`sessions.ts:5321`) now hands `claimSubmit` `RewardsChangedError(REWARDS_MOVED())`, which is `lj.warn.rewardsMoved`, a critical key. It goes into the same warn callout (`ClaimAll.tsx:160`).
- **Evidence.** `tests/lovejoin-refusals.test.ts:96–103`, "is said in Lovejoin's words on Bring everything back's line": `failed` equals `[{ index: 0, error: REWARDS_MOVED() }]`.
- **The failure.** The owner's call reads a premise that's no longer true. The route now carries a critical line beside the unverified ones. That doesn't change the choice, but it does change the facts it states.
- **Fix.** "…`sess.spentSince` and Koios's too, all but `lj.warn.rewardsMoved` (worker#1) uncritical…"

### r2-docs#6 · nit · `docs/plans/chunk-41-blaster-fixes.md:85`: still lists PlutusCoreBlaster #71 as open

- **Evidence.** `:85` reads "Open since 2026-11-03: Lean-blaster #455 …, and PlutusCoreBlaster #71 and #73."
  - The lead's edit #7 made `:11` "✅ … merged 2026-11-05 (`6b4260a`)".
  - The upstream list the verif lane moved in (`:269`) says merged.
  - GitHub agrees: #71 MERGED 2026-11-05T11:22:34Z, merge commit `6b4260a`.
- **The failure.** One live plan says both, so whoever monitors the PRs reads #71 as still open.
- **Fix.** "Open since 2026-11-03: Lean-blaster #455 … and PlutusCoreBlaster #73. #72 merged 2026-11-03, #71 2026-11-05."

### r2-docs#7 · nit · `seedelf-verification/CLAIMS.md:24`: "three changes upstream doesn't have yet" counts the main pin only

- **What's wrong.**
  - **The fourth change.** CLAIMS.md's policy row cites `Slice/`'s `Rule`. `Slice/lakefile.lean` pins the fork's `opaque-slice` (`96261cc`), which is the main pin plus an opaque `SliceByteString`, never offered upstream (chunk 41 `:273`). So that row runs on four changes upstream lacks. `:26` does name the slice as opaque.
  - **The Blaster fork.** Seedelf's Z3 results also go through our Lean-blaster fork (`25c0ee0`, #454's fix; #455 still open, CONFLICTING per GitHub), which the *Z3's word* bullet (`:23`) doesn't name. README `:31–38` has both.
- **The failure.** The page that says where the claim stops undercounts the forks it rests on, though by little.
- **Fix.** Add to `:24`: "(and `Slice/`'s pin a fourth, an opaque slice); Blaster too is our fork, with #454's fix (#455)."

### r2-docs#8 · nit · `docs/development.md:145`: 1.8.1's checklist names 1.8.0 for the retired pools' run

- **What's wrong.** "a 1.8.0 build puts none there … at the profile's first unlock on 1.8.0". 1.8.1 runs the same `retireOnce` on its own first unlock, so a 1.7.2 profile updating straight to 1.8.1 takes this path.
- **The failure.** A tester on 1.8.1 can read the item as 1.8.0's and skip it, though the path ships again. The docs lane saw this and left it.
- **Fix.** "a 1.8.x build puts none there … at the profile's first unlock on 1.8.0 or later".

### r2-docs#9 · nit · `seedelf-verification/check.sh:22`: the usage says an Every module gets 16 GB; every module named in that run does

- **Evidence.** `:26`, `for a in "$@"; do case $a in lovejoin-every|Lovejoin.Every.*) CAP=${CAP:-16G}…`, sets the run's caps. The verif lane's own note says the same: "A run naming an Every module beside others gives all of them 16G/30m."
- **The failure.** `./check.sh Lovejoin.Every.Collect Seedelf.WalletRegister` builds WalletRegister at 16 GB and 30 minutes, which the usage line doesn't say.
- **Fix.** "(naming a Lovejoin.Every one gives the whole run 16G, 30m)".

### r2-docs#10 · nit · `docs/architecture.md:701`: "read once a build, none while the wallet's own transaction on its way takes it" reads as "no request"

- **What's wrong.** `readRewards` always asks `account_info` (`lovejoin.ts:4682`). It counts the balance as 0 (`balanceAfter`, `takingFrom`) while the wallet's own transaction on its way takes it.
- **The failure.** The *What each costs* line (`:749`) counts the read in every build. Read this way, `:701` contradicts it.
- **Fix.** "…read once a build, and taken as 0 while the wallet's own transaction on its way takes it…"

### r2-docs#11 · nit · `docs/archive/plans/chunk-43-lovejoin-reward-balance.md:192`: still "from the IP address that sends the transaction moments later"

- **What's wrong.** guard#7 fixed this phrase in privacy.md and in the policy's entry. The record was edited for review findings elsewhere (`:47`, `:169`, `:175–181`), and the docs lane listed `:8` and `:171` as left on purpose, but not this line.
- **Fix.** Leave it as the plan's wording with a pointer ("guard#7: at review too"), or fix it as `:47` was.

### r2-docs#12 · nit · `docs/archive/plans/chunk-45-lovejoin-every-tx.md:14`: "after 1.8.0 shipped"

- **What's wrong.** The house's rule: docs don't date releases or say what the store is doing. This line came in with #368's plan and was carried into the archive, where the verif lane rewrote the dates around it.
- **Fix.** "The owner, 2026-11-06, with the old pools empty and the 5 ₳ v2 pool live:"

### r2-docs#13 · nit · `seedelf-verification/Lovejoin/Template/Scripts.lean:10`, `Lovejoin/Template/Steps.lean:10`: still call `dc6abe3b…` "the mainnet 5 ₳ pool"

- **What's wrong.** claims#2's half made extract-lovejoin-v2.sh say "mainnet's first 5 ₳ pool (8131b1d's, retired since 1.8.0)". The Lean module docs still say "the mainnet 5 ₳ pool", where mainnet now has two.
- **Fix.** Editing them rebuilds everything that imports `Lovejoin.Template.Scripts`, so leave them for the next full run, with the input_dir fix.

## Checked, and held

- **The policy's new body sentence** (`:46`), against the code:
  - one `account_info` a pool (`rewardsIn` dedupes by id);
  - read at every build, a review's included;
  - read again at Send (`publicStart` `:5194`; `backSubmit`/`claimSubmit` through `balancesHeld`, `sessions.ts:5049`);
  - the withdraws (`:7582`), the collateral's mix (`:4515`; `sessions.ts:4729`);
  - none for a Bootstrap: fanOut's `depth > 0` and publicBuild's `bootstrap ? []`. Depth 0 is only a seed or Bootstrap (`LOVEJOIN_DEPTHS = [1,2,3]`), which never carries a collateral tail (`depositOnly`, `sessions.ts:4549`).
- **The reworded entry clause is true** (r2-docs#1).
- **privacy.md:236**, the same reads.
- **architecture.md:377** against koios.ts:
  - every name;
  - "from 11" for the PV-gated ones only;
  - the three-name `RewardsChangedError`;
  - `(Deposit|Refund)IncorrectDELEG` named whole (the lead's edit #3).
  - Nothing else in the extension treats `RewardsChangedError` specially but Lovejoin.
- **architecture.md:680, :706 and :749**, against fanOut, acrossOf, publicBuild, publicAgainBuild, tailChain, the direct return's tail, withdrawOne's one rebuild, and the data layer's 4-unit weight (`edge.rs:60`).
- **backlog.md:52**, against `publicAfter` and `AfterRow` ("Public account after") and rpc.ts's `taken`.
- **backlog.md:55–59**, against worker#2, worker#3, readers#2 and readers#3:
  - the lines name the flows, the consequence, and that the order is the owner's;
  - the merged code makes none of them worse: worker#1 and readers#4 change only the words and the type.
- **development.md:182 and :279** (package.json is 1.8.1).
- **Chunk 43's record:**
  - `:47` against `mixLogicHashes`/`everyKept`;
  - `:169` against HEAD's `wasm/tests/lovejoin_test.rs`, whose `lovejoin_across_test.rs` passes `Default::default()`;
  - `:176–181`.
- **seedelf-platform/CLAUDE.md:86:** the test exists and does what it says.
- **seedelf-platform/CLAUDE.md:97:** every core builder's signature in `lovejoin/*.rs`. Rewards is taken by the mixes, the withdraws, the chains, again/again_at and collateral_tail/mix. It isn't taken by the deposits or launch.
- **wasm/README.md's inspectDappTx row**, against `cip30.rs` `TxSummary` (`proposals`, `paid_scripts`).
- **CLAIMS.md:**
  - every theorem in its table exists under that name, with its axiom guard;
  - Readable's two new guards were built in the lead's run;
  - the hypotheses match the statements: `validTxOutValue` on reference inputs for mix_logic, `validMintValue` and the outputs' for one_shot_mint, and validTxOutValue's definition says "ADA first, sorted, positive";
  - FlatDecodeCheck covers 13 scripts;
  - PlutusCoreBlaster's README at the pin `68c5399` has "working toward conformance";
  - the lakefile's fork changes;
  - the test path;
  - on GitHub: #71 and #72 merged, #73 open, #27 a draft, #455 open and CONFLICTING.
- **The verification README:**
  - the standard command, and why `./check.sh` goes last;
  - 51 + 25 = 76 in check.sh's lists;
  - the caps (`:26–28`);
  - `:78`'s hypotheses;
  - the manual `rm` step: its paths exist in `.lake/build` and `Slice/.lake/build`, and they cover every module that `#import_uplc`s an extracted `.hex` (Seedelf, Lovejoin, Lovejoin/V2, Lovejoin/Template and Slice's Scripts).
- **Lovejoin/Every/README.md:**
  - every theorem name in its module table exists in the module it names (scripted);
  - the axiom guards are in Lookup, Carrier, Typed, MintTyped and Readable;
  - "the default 8 GB kills six of the 25" matches the 2026-11-06 log: Carrier 8459, Collect 12782, Walk 8563, Withdraw 8379, MintCheck 8386 and MintRoot 8307 MB.
- **Audit/README.md and findings.{md,json}:** no Audit module or list names an every-transaction module, and findings.json parses with no reader.
- **extract-lovejoin-v2.sh:** `dc6abe3b` is the head start's first mainnet pool (no version: V1), and `fcb3f5ec` its second (v2).
- **The archived chunk 42 and 45 records and chunk 41's table:** checked against git (#362's `a04ca256` has BoxPurposesAll) and GitHub.
- **Links:** every relative link and anchor in the 17 changed Markdown files and both plans READMEs resolves (0 broken; the checker caught a planted bad link and anchor). No tracked file links to the plans' old paths. The audit's JSONs name them only in evidence text.
- **The name style:** no lowercase "seedelf" or "Seedelf wallet" in added prose. words.test.ts reads `src/` alone, so this was a scan.
- **No new release date in added doc lines;** r2-docs#12 is carried over.

## What I ran

- `git diff HEAD`, `git log` and `git show` over the policy's history (1.6.0 to 1.8.1) and the PR merges.
- `gh pr view` for PlutusCoreBlaster #71, #72, #73 and #27, and Lean-blaster #455 (reads).
- A link and anchor checker, and a name-style scan, over the changed Markdown. A script over the Every README's table.
- `npx vitest run tests/zz-r181-r2-docs-1.test.ts`: 1 passed, with the output under r2-docs#4. The file is deleted.
- No build, no lake, lean or check.sh, nothing in seedelf-data, and nothing in R2.
