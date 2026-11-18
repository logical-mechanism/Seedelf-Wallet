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
- The verifiers' own tests are untracked files in this tree, named `r51_*.rs` and `r51-*.test.ts`. Each one's full code is in its `verify/<id>.md`. They go before the final checks, or become a fix's test.

## The fixes on their own branches (for `main`, never pushed without the owner)

- `web-wallet/lovejoin-box-datum-spelling`, worktree `../Seedelf-Wallet-fix-boxdatum`: r3a#1 (high).
- `cli/stranger-rows`, worktree `../Seedelf-Wallet-fix-clirows`: r4#1 (high) and r4#2, made by a fixer agent.

## Next

1. The lanes' answers into `lanes/`, one file each, and a first merge into `FINDINGS.md`.
2. The cross lenses (X1 to X4, T1), the completeness critic and its gap round, on every lane's output.
3. Verification by stakes, code first; fixes for a confirmed high or medium start at once, in a second worktree, each on its own PR to `main`.
4. The fix round, the review of the merged fixes, the last look, the checks, the live preprod runs, the record.
