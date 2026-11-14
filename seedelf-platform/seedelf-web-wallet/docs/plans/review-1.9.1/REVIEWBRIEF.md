# 1.9.1 gate review: the common brief

You are one reviewer in the gate review of Seedelf Wallet 1.9.1, a patch release of the Chrome web wallet. The owner asked for a review of everything since 1.9.0, then a fix of what's worthy. **Review only: never fix, commit, push, or edit a tracked file.**

SCRATCH = the review session's scratchpad folder (under `/tmp/claude-1000/`).

## The tree

- **Read this tree:** `SCRATCH/release-1.9.1`, branch `web-wallet/release-1.9.1`, at `3063b33f` (`main` after #384). The lead is preparing the release there (version, lists), so `package.json`, `src/tokens/`, `src/dreps/`, `src/lovejoin-pools.json` and `seedelf-data/api/data/token-decimals.json` may show uncommitted changes: they're not yours to review unless your lane says so. Never write anything in it.
- **Never touch** the main checkout `the main checkout` (the owner's Chrome loads its `dist/`, and another session may use it), any other worktree (`git worktree list`), or `~/.cache/seedelf-release-1.9.1` (the lead's build).
- Your scratch folder is `SCRATCH/review-1.9.1/<your lane>/`; create it. Every scratch file goes there, with a unique name. Write your report there too, as `report.md`, besides returning it.

## What 1.9.1 carries since `web-wallet/1.9.0` (`c0b451a8`)

| PR | Merge | What | Scope |
|---|---|---|---|
| #379 | `67106366` | 1.9.0's record in `docs/releases.md` | docs, light |
| #380 | `14b24e59` | The owner's guards against prompt injection (`.claude/`, root `CLAUDE.md`) | **out of scope**: the owner's, never reviewed or edited here |
| #381 | `4e5ee500` | Formal verification: the three Seedelf scripts in every transaction, kernel-checked (chunk 48: `seedelf-verification/Seedelf/Every/*.lean`, `CLAIMS.md`, `README.md`, `check.sh`); the wallet's docs: chunk 48 archived, chunk 49's plan, chunk 46's plan | verification: light, report only; wallet docs: light |
| #382 | `45a0b3bb` | Chunk 46's plan: the suite on PCB #77 | docs, light |
| #383 | `8cd2b425` | Chunk 50's plan: docs for someone who has never heard of Seedelf | docs, light |
| #384 | `3063b33f` | **The fix:** a chain of parts ends once its payment is paid (`wasm/src/lib.rs` `chained`), from a bounty report against 1.9.0; tests in `wasm/tests/api_test.rs` and `wasm/tests/payment_parts_shapes_test.rs`; `extension/tests/wallet.test.ts`'s vault check (a CI flake); `docs/architecture.md` | **code, deep** |

- One PR's diff: `git -C SCRATCH/release-1.9.1 diff <merge>^1 <merge>`. The release's: `git -C SCRATCH/release-1.9.1 diff c0b451a8 3063b33f -- <paths>`.
- A PR's description: `gh pr view <n> --json body --jq .body` (read-only `gh` only).
- Paths are relative to `seedelf-platform/seedelf-web-wallet/` unless they start with `seedelf-platform/` or another top-level folder.

## Background: #384

**The report** (emailed 2026-11-14, against 1.9.0, reproduced from the code, never from the reporter's proof of concept): a payment one transaction can't take goes in parts (`in_parts`), and where a part has no ADA of its own for its fee, the parts go as a chain (`chained`): each part carries its leftover ADA forward to the wallet's own register (`carry`, an output of ADA alone), and the next spends it. Before #384 every part of a chain was a carry, and nothing ended the chain once the payment was paid. When the part that sent the last of the tokens was one, the chain went on to `amount(carry + rest, owed.max(least([])), [], false)`: one more transaction paying the recipient an output of ADA alone (0.978 ₳ to an address, 1.457 ₳ to a Seedelf) plus about 0.23 ₳ fee, neither asked for. An amount just past the tokens' least overpaid the same way. The review showed "Parts: 2", and its minimum note called the inflated total the least the tokens need. It took a rare shape: 10 or more token kinds sent at once, each held most by a move-in-like bundle of 20 at its least, and a little of each by the UTxO holding the ADA. Rated valid, low.

**The fix:** in `chained`, the part that sends the last of the tokens (`fit_part`'s `more` false) tries `amount(picks, owed.max(least(share)), share, starts)` first and ends the chain; it carries only where that's short. After a carry, a chain with no tokens and nothing owed ends. `in_parts`' own last part already worked the first way.

**The owner's standing rules:**
- The most private option is the default. Refuse only what the ledger or the contracts refuse: no paternalistic guards.
- UI text stays short. Always "Seedelf" and "Seedelf Wallet" in what the wallet shows.
- A lying data source (Koios, the data layer) is out of scope: an infrastructure compromise.
- Docs never date releases or state store status. No release notes. A data-handling change gets a dated privacy-policy Changes entry.
- A wallet pass is wallet-only: CLI-only and CI decisions stay out. Verification findings are recorded for a verification pass.
- A fix's test must fail before the fix and pass after it.

**The design docs:** `docs/architecture.md` (*A payment in parts*, *Chains where needed*), `docs/flows.md`, `docs/privacy.md`, `wasm/README.md`. **CI on #384 was green** (rust, wasm, unit on both builds, e2e, store): look for logic, design and coverage problems, not build breaks.

## Commands and limits

- **Vitest:** from `SCRATCH/release-1.9.1/seedelf-platform/seedelf-web-wallet/extension`: `npx vitest run tests/<file>.test.ts`, once `../wasm/pkg` exists there (the lead is building it; if it's missing, reason from the code). Never run `npm run build`, `npm run package`, `npm ci`, `wasm/build.sh` or Playwright in that tree.
- **Cargo, for a test you write or a mutant:** never in the release tree. Make your own worktree:
  - `git -C SCRATCH/release-1.9.1 worktree add --detach SCRATCH/review-1.9.1/<lane>/tree 3063b33f` (or `c0b451a8` for 1.9.0's code, to compare).
  - Build there from `seedelf-platform/` with `CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.1/<lane>` and `-j 4`, prefixed `nice -n 10`. Never a target under `/tmp` (a 31 GB tmpfs), never another lane's target. The first build takes several minutes.
  - One test file at a time: `cargo test -j 4 -p seedelf-wasm --test api_test <name>`. The parts suite: `cargo test -j 4 --release -p seedelf-wasm --test payment_parts_shapes_test -- --ignored`. Never a bare `cargo test -- --ignored` at the workspace root (it rewrites an extension fixture).
  - When done: `git -C SCRATCH/release-1.9.1 worktree remove --force <path>`, and put the test's code in your report.
- **Anything you run:** finite input only (never `yes |`); cap a heavy run: `systemd-run --user --scope -p MemoryMax=8G -- <cmd>`.
- **Never build `seedelf-verification/`** (Lean; one uncapped build took 52 GB). Never `cargo run` anything in `seedelf-data/`. Never send a transaction or touch home's services or the VPS.
- **Network:** none needed. Koios's public tier is rate-limiting this machine right now and the lead's release scripts need it: no Koios calls.

## Severity

| Grade | Means |
|---|---|
| high | Money lost, locked or taken; a key or privacy leak; a review that misstates money in a way someone can exploit |
| medium | Wrong behaviour a real user hits, at a cost: an overpayment in a shape users reach, an honest payment refused that used to go, a review figure that's false |
| low | An edge case wrong (a rare shape's small overpayment, as the report was), misleading text, a money path with no test |
| nit | Wording, style, comments |

Grade by what a user or an attacker can actually reach. Say plainly when something is fine.

## Report

- Return your findings through the StructuredOutput schema, and write the same as `SCRATCH/review-1.9.1/<lane>/report.md`.
- Each finding needs concrete evidence: code quoted with `path:line`, the commands you ran and their output, and a concrete failure scenario (inputs → wrong output). A finding about money gives the figures.
- Put what you checked that holds in `checked_ok`, one line each, and what you didn't get to in `coverage`.
- Mark each finding's confidence: `confirmed-by-run` (you ran something that shows it), `traced` (you followed the code end to end) or `plausible` (reasoned, not traced).
- Don't pad. A short, honest report beats a long, speculative one.
