# 1.6.0 review: the review of the fixes (read this first)

The release review of #308–#323 found 136 findings ([FINDINGS.md](FINDINGS.md), [HANDOFF.md](HANDOFF.md)). Two fix rounds have since fixed them: [FIXBRIEF.md](FIXBRIEF.md) is the fixers' brief, `fixes/<id>.md` each fixer's report. You review **the fixes**, and the code they touched, before 1.6.0 ships. This review is the gate.

Every earlier fix round on this wallet introduced new bugs, mostly where two features meet. Fixers each saw their own area and tested it. Look for what they couldn't see:
- regressions;
- a fix that's wrong or incomplete;
- two fixes that disagree;
- a state a fix makes reachable where nothing works;
- a test that passes without its fix.

- Repo `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`, branch `web-wallet/review-1.6.0`. `WW` = `seedelf-platform/seedelf-web-wallet`.
- **What changed:** `git diff 499768f6` (everything since the review's HEAD, including the working tree). `git log --oneline 499768f6..HEAD` shows the commits: phase A's interrupted work (`d5fa7ede`), its repair (`9978654a`), fix round 1 (`fc8561c7`), and then round 2 in the working tree or its own commit. Exclude `FINDINGS.md`/`HANDOFF.md` from what you review.
- **Who changed what:** each `fixes/<id>.md` lists the findings its fixer took, its files, its tests, its calls, and what it left. [review/file-owners.md](review/file-owners.md) maps every file to the fixers who touched it.

## Rules

- **Read-only.** Never edit a tracked file. To prove a finding, write a throwaway test named `zz-review-<your lens>-<n>.test.ts` in `WW/extension/tests/` (or a Rust test under a scratch name). Run it, then **delete it before you return**. Mutation checks happen in a copy (below), never by editing the tree.
- **A copy for mutation checks:**
  ```bash
  C=/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/d6dd908d-847e-45c3-8df8-3d6083f5af0a/scratchpad/copy-<lens>
  mkdir -p $C && rsync -a --exclude node_modules --exclude dist WW/extension/ $C/extension/ && ln -s "$PWD/WW/extension/node_modules" $C/extension/node_modules && mkdir -p $C/wasm && cp -r WW/wasm/pkg $C/wasm/pkg
  ```
  Then edit the copy and run `npx vitest run tests/<file>` from `$C/extension`. For Rust, `rsync` `seedelf-platform` without `target` and set `CARGO_TARGET_DIR=$C/target`. Delete the copy before you return.
- **Never run:**
  - git commands that write;
  - `npm run build*` or `wasm/build.sh` (e2e owns `dist/`; the lead rebuilds `pkg/`);
  - Playwright;
  - `cargo test -- --ignored`;
  - anything that sends a transaction or touches mainnet;
  - a formatter.
- **The owner's rules decide what counts as a bug:**
  - **No paternalistic guards.** The wallet refuses only what the ledger or the contracts refuse. A missing refusal for a user's own choice isn't a finding; a missing warning may be (low). A fix that ADDED a refusal the chain wouldn't make is a finding.
  - **Private by default**, with a visible way to turn it down where it costs fees, time or lookups.
  - **Keep UI text short.** A button with at most one short line beside it. A paragraph around a button is a finding (nit or low).
  - **Backward compatibility.** The classic pool's transactions stay byte-identical to 1.5.0's, and records left on a device by 1.5.0, or by any earlier 1.6.0 state, must still work.
  - **Scope.** Web wallet only. A CLI-only problem is noted, not rated.
- **Known and decided, so don't re-report these** (but do report if a fix around them broke something):
  - every "owner-call" finding in HANDOFF.md;
  - 316#1's case (a), a 1.5.0 seed whose record went before the update;
  - 321-parts-rust#0 (CLI-only);
  - the policy's Effective date.
- **Known leftovers, still to be fixed** (confirm or sharpen them if your lens meets them; don't count them as new):
  - **L1:** Stop's dialog prices boxes with the collateral reserve in (sessions.ts stopCost; 323-worker#1's rest; sc-o-1's report has the change).
  - **L2:** a Stop pressed on another page reads as Done on this one (the worker deletes `bringing` for both a stop and an end).
  - **L3:** catch-alls still swallowing WebAssembly traps: watchOf's and mixBoxes' quiet readSet catches, activity.ts:497, progress()'s pumpPublic catch, and withdrawOne's best-effort catches after a submit.
  - **L4:** lovejoin.ts listing() reads spent marks with Date.now() rather than deps.now().
  - **L5:** the three new critical keys of round 1 and the eleven of round 2 aren't back-translated yet (round 4 does it). Their English is in scope; the Spanish and Japanese aren't yet.
  - **L6:** the docs round hasn't run, so docs lag the code. Not a finding, except where a doc the wallet serves (the privacy policy) now says something false.

## Severity

- **high:** money lost or locked, a wrong signature, a privacy tie the user wasn't told of, a wallet that locks itself, or the release unable to ship (CI red).
- **medium:** a flow that fails for a realistic user; a fix that doesn't fix its finding; a misleading warning about money or privacy.
- **low:** an edge case; words that mislead mildly; a missing test for a guard.
- **nit:** comments, names, small inconsistencies.

## What to return

Your structured output lists findings. Each one has:
- a short title;
- severity, file and line;
- the concrete scenario: the inputs or state, and what goes wrong;
- the evidence: the code you read, and the test you ran with its failing output;
- which fix (fixer id and finding id) it concerns, or 'pre-existing';
- a suggested fix that keeps to the owner's rules.

Don't pad: a finding you couldn't make concrete is a question, so put it in `questions`. Write your output to `WW/docs/plans/review-1.6.0/review/<your lens>.md` too, before returning.
