# 1.9.0 gate review: round two, the merged fixes

You are one lens in round two of Seedelf Wallet 1.9.0's gate review.

**What happened before you:**
- **Round one** (the review and its verification) found one medium and eleven lows; `R/FINDINGS.md` has them.
- **Five fix lanes** each fixed their part in a worktree of their own: words, rust, swaps, views and docs.
- **The lead merged them** on the local branch `review-1.9.0/integrate` (base `8d7c4b0c`) and made two edits of its own:
  - contractYours reworded in en, es and ja, after a blind back-translation, to "…from a contract that names you. They may be yours, but they don't come back to you.";
  - the verified-critical lists and their reviewer note.

**Your job:** find what breaks where the lanes meet, what a fix got wrong, and what it missed. Every fix round so far has introduced bugs where two areas meet, so read across lanes, not only within one.

`R` = `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0`.

## Read first

- **`R/COMMON.md`:** the background, the owner's rules, the limits and the severity table. Its rules hold, except that the tree under review is now the integration branch.
- **`R/FIXBRIEF.md`:** what each lane was asked to do, and the lead's decided English.
- **`R/fix-full.txt`:** what each lane says it did, with its tests and evidence. Treat every claim as a claim to check.
- **The merged diff:** `git -C R/integrate/tree diff 8d7c4b0c review-1.9.0/integrate`, the commit "review-1.9.0 integrate".

## Your own copy

**Review only.** Never edit `R/integrate/tree`, the main tree (`/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`) or anyone's worktree.

**When you need to run something or mutate code, make your own worktree:**
- `git -C /home/logic/Documents/LogicalMechanism/Seedelf-Wallet worktree add --detach R/r2/<lens>/tree review-1.9.0/integrate`;
- symlink `seedelf-platform/seedelf-web-wallet/extension/node_modules` to the main tree's;
- copy the main tree's `seedelf-platform/seedelf-web-wallet/wasm/pkg` in. No lane changed Rust runtime code, so it still matches.

**Builds and runs there:**
- Cargo: `CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-r2-<lens>` (seed it with `cp -r` from `target-integrate`), with `-j 4`, under `systemd-run --user --scope -p MemoryMax=8G --`.
- Vite and Playwright: only in your worktree (`npx vite build`; Playwright under `xvfb-run -a`, capped).

**Cleaning up:** unlink the symlink, then `git -C /home/logic/Documents/LogicalMechanism/Seedelf-Wallet worktree remove --force <path>`. Never use `git stash`: its ref is shared by every worktree.

**Off-limits:** never open `extension/e2e/support.ts` or `seedelf-crypto/tests/vectors/*.json`, and make no network calls unless your lens says so.

## Report

Return through the StructuredOutput schema.

- **Each finding:**
  - concrete evidence: code at `path:line` in the integration tree, and the commands you ran with their output;
  - a failure scenario;
  - a grade from COMMON.md's table;
  - a fix.
- **IDs:** `r2-<lens>#<n>`.
- **`checked_ok`:** what you checked and found holding, one line each. Say plainly when something is fine.
- **Grading:** by what a real user or a real attacker reaches. A test that can't fail is a finding. So is a doc sentence the code doesn't bear out.
