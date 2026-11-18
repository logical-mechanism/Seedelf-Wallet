# Chunk 51 · Where the run is, and how to pick it up

For the lead, if a session ends or the machine reboots mid-run. `/tmp` is a tmpfs: the scratchpad (the baseline logs, the V1 and V2 extracts, every agent's scratch) goes with a reboot, and a workflow resume failed across one in 1.6.0's review. So everything a later step needs is written here, in git, as it comes back.

## The tree

- Worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51`, branch `web-wallet/whole-review`, from `main` at `cd764fba`. Caches copied in from the main tree: `extension/node_modules`, `wasm/pkg`, `seedelf-verification/.lake`. Its Cargo target is its own (`seedelf-platform/target`).
- The session's scratchpad: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad` (SCRATCH in COMMON.md).

## Step 1, the lanes (started 2026-11-18)

- Workflow `wf_55b0eea1-32c`, 35 finders ([LANES.md](LANES.md)).
- Its journal (on disk, kept across a reboot): `~/.claude/projects/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/subagents/workflows/wf_55b0eea1-32c/journal.jsonl`. Each finished agent's structured answer is there.
- Its script: `~/.claude/projects/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/workflows/scripts/chunk51-lanes-wf_55b0eea1-32c.js`. It holds every lane's prompt.
- **If it was cut short:** write each finished lane's answer from the journal into `lanes/<id>.md`, then run a continuation with only the lanes missing (the same prompts and schema), never a resume.
- **V1 and V2's extracts,** if the scratchpad is gone: rebuild `r51/v1/` and `r51/v2/` with `tools/strip_proofs.py` (definitions in full, theorems as statements only) over `Seedelf/Every/{Typed,PolicyTyped}.lean` and their helpers, and `Lovejoin/Every/Readable*.lean`; the sources from `git show 5b82530:seedelf-contracts/…` and `git -C ../lovejoin show 29573c5:contracts/…`.

## Step 2, verification, started as the lanes came in

- Batch 1 (R1 to W3's 25 findings): workflow `wf_dddd5fba-e8f`, done; its answers are `data/verify-batch1.json` and `verify/<id>.md`. w2#3's trace verifier was stopped by the model's safeguards and stays unverified.
- Batch 2 (E1a to E8a's 22 findings): workflow `wf_c0d9bf4e-987`, the same script with new args.
- Batch 3 (E8b, E9a, E9b and B1's 13 lows): workflow `wf_6919f284-4c9`. D1 gets no refuters (the plan); b1#4 the lead checked against the release logs (`verify/b1-4.md`).

## Step 3, the cross lenses and T1 (started once the platform lanes were in)

- Workflow `wf_a209476a-a2d`: X1a, X1b, X2, X3, X4, and T1a to T1l, each T1 agent reverting its lanes' guards in its own copy under `~/.cache/seedelf-review-51/` (remove those copies if a run was cut short).
- Then the completeness critic and its gap round, once V3 to V5 are in.
- The verifiers' own tests are untracked files in this tree, named `r51_*.rs` and `r51-*.test.ts`. Each one's full code is in its `verify/<id>.md`. They go before the final checks, or become a fix's test.

## The fixes on their own branches (for `main`, never pushed without the owner)

- `web-wallet/lovejoin-box-datum-spelling`, worktree `../Seedelf-Wallet-fix-boxdatum`: r3a#1 (high).
- `cli/stranger-rows`, worktree `../Seedelf-Wallet-fix-clirows`: r4#1 (high) and r4#2, made by a fixer agent.

## Step 4, the fix round (started 2026-11-18, while the lenses ran)

- Worktree `../Seedelf-Wallet-chunk51-fixes`, branch `web-wallet/whole-review-fixes`, from this branch with both high fixes cherry-picked in, and the verifiers' 60 `r51` tests copied across (untracked). It has its own Cargo target.
- [FIX.md](FIX.md) is the fixers' brief. Fixers by file ownership: G1 core, G2 the CLI with Koios (its own commits, for a CLI patch release), G3 the WebAssembly crate, G4 the worker's Lovejoin and sessions, G5 the connector, G6 keys, money flows and chain reads; then G7 the screens, G8 docs, G9 CI and G10 the proofs.
- The fixers don't commit: the lead commits each group's files by path, rebuilds the WebAssembly after the Rust groups, and runs every check.
- If a session ends mid-round: `git -C ../Seedelf-Wallet-chunk51-fixes status` shows what each fixer left; compare it with the groups' file lists in this round's prompts (FIX.md's rules), finish or revert per group, and run the checks before committing.

## Where it stood, 2026-11-18 (later)

- **Found:** 157 findings in 51 lanes (34 lanes, 5 lenses, T1b, the critic, two gap rounds of five); `INDEX.md` lists them. More from the other T1 agents (`wf_a209476a-a2d`) as they finish.
- **Verified:** batches 1 to 6 (`data/verify-batch*.json`, `verify/`), severity tiebreaks (`data/severity-tiebreaks.json`; a second set running for the first gap round's four mediums), batch 7 running for the second gap round (`wf_34fd9251-aa5`).
- **On the high-fix branches:** `web-wallet/lovejoin-box-datum-spelling` has r3a#1 and x2#1 (`e2b31e6f`, `fcdacc50`); `cli/stranger-rows` has every CLI fix (`027fc81b` to `343fb772`).
- **On the fix branch** (`web-wallet/whole-review-fixes`, `../Seedelf-Wallet-chunk51-fixes`), committed by group: G1 core, G2 the CLI, G3 the WebAssembly, G6 keys and chain reads (`git log f87c3e77..HEAD`). Uncommitted there: G4's and G5's work (they share lovejoin.ts) and every fixer's edits to the shared files (the translations, `docs/i18n/*.json`, `rpc.ts`, `DappApprovals.tsx`, architecture.md, flows.md, privacy.md).
- **Still to run:** G7 the screens, G8 docs, G9 CI, G10 the proofs; the WebAssembly rebuild and every check; the blind back-translation of the new critical strings (`dappUi.warn.deadRegister`, `dappUi.warn.hiddenChars`, and whatever G5 and G7 add); the review of the merged fixes; the last look; the live preprod runs; `FINDINGS.md` and the record.

## Where it stood, 2026-11-18 (evening)

- **Every fixer's work is committed** on the fix branch (`git -C ../Seedelf-Wallet-chunk51-fixes log --oneline f87c3e77..HEAD`), the last at `10a06db6`. The owner's findings' 18 verifier tests are out of the fix tree (copies in the review tree and in their `verify/` records).
- **The WebAssembly** was rebuilt from that branch in a scratch worktree, `../Seedelf-Wallet-wasmbuild` (detached, its own target), and its package swapped into the fix tree; remove that worktree when done.
- **Rust checks on the fix branch** (`c8003eda`): fmt and both clippy runs clean; 933 tests (12 ignored); the parts suite 0 with problems, 108 refused, 0 Max.
- **Running:** the blind back-translation of the 23 new or newly critical keys (`wf_54efc85f-173`), then the extension's checks; the review of the merged fixes, nine lenses (`wf_b7ca6d1a-a0f`).
- **Still to do:** that review's verification and its fix round; the last look; e2e on both builds, `e2e:data`, `LIVE_KOIOS`; the live preprod runs; `./check.sh`, `seedelf-every` and `lovejoin-every` (Lean changed); FINDINGS.md and the record; merge the fix branch into this one.

## Where it stood, 2026-11-18 (night)

- **Back-translation** of the round's 23 critical keys done and committed on the fix branch (`02f73991`): every es value held, one ja value was reworded.
- **The extension's checks** on the fix branch: the preprod-only build's Vitest failed nine of the round's new tests (they assumed a mainnet build). Fixed and committed (`04616cf6`). The rest of the run (e2e on both builds, `e2e:data`, `LIVE_KOIOS`) was still going.
- **FINDINGS.md** is generated: `python3 -I tools/findings.py .` from `data/` (with `data/status.json`, the lead's overrides, and `data/fixed-in.json`, the commits naming each finding) and [owner-calls.md](owner-calls.md), the owner's list, written by hand. It prints any finding it can't place; there should be none.
- **The critic's two unchecked claims** are now checked ([verify/lead/weak-claims.md](verify/lead/weak-claims.md)): Conway's decoder refuses duplicate keys, and nothing traps under the 128-level guard.
- **Open for round two** (FINDINGS.md lists them): the T1l guards G7b never got, G4's sessions guards t1i#6, t1i#7 and t1l#14, gap-g6#2 and x1b#2; then whatever the review of the merged fixes (`wf_b7ca6d1a-a0f`) confirms.

## Where it stood, 2026-11-18 (late night)

- **The review of the merged fixes** (`wf_b7ca6d1a-a0f`, nine lenses, lanes/R2*.md): 28 findings above a nit, all confirmed (batch 9, a tiebreak for r2sign#1, which settled at low), one high (r2cli#1), plus R2tests' ten untested fixes and six nits. All fixed in round two, by the same fixers, each committed by path: the fix branch's log from `02f73991` to `ad8c3ce4`. FINDINGS.md places all 360 findings; none is open.
- **The CLI branch** `cli/stranger-rows` carries round two's CLI commits too (`02dbefc8`, `d8114f19`, `afc52463`); its checks pass (fix-branches.md).
- **The live preprod runs** on round one's build passed (LIVE.md). Run them again on the final build: round two touched a session's return (`b3687869`), the swap runner (`ad8c3ce4`) and Bring one back (`ad8c3ce4`).
- **Running:** every final check on `ad8c3ce4` (scratchpad `final/all.sh`: the Rust half, then the extension's), and the last look at round two's fix-ups (`wf_4274cfc7-8e1`, seven lenses).
- **Still to do:** the last look's findings, if any; the live runs on the final build; `./check.sh`, `seedelf-every`, `lovejoin-every` (Lean changed: four control modules' docstrings, ddc17685), one at a time; the record; merge the fix branch into this one.

## Next

1. The lanes' answers into `lanes/`, one file each, and a first merge into `FINDINGS.md`.
2. The cross lenses (X1 to X4, T1), the completeness critic and its gap round, on every lane's output.
3. Verification by stakes, code first; fixes for a confirmed high or medium start at once, in a second worktree, each on its own PR to `main`.
4. The fix round, the review of the merged fixes, the last look, the checks, the live preprod runs, the record.
