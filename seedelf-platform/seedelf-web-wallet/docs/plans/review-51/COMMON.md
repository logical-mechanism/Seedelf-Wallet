# Chunk 51 · The brief every agent gets

You are one agent in chunk 51: a whole-code review of the Seedelf platform and its proofs ([the plan](../chunk-51-whole-review.md)). Nothing has read the whole code since before mainnet; each release review since read only its diff, and old code still holds bugs that diffs miss. The owner: "We can get an agent on each path and just find everything to fix it if it exists."

**Finders only read.** Never edit, create or delete a tracked file, never commit, never build anything that writes into the tree. Your lane prompt says what you read and where to look hardest.

## Paths

- **TREE** = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51`, branch `web-wallet/whole-review` at `cd764fba` (`main`). Read this tree only. Paths below are relative to it.
- **SCRATCH** = `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad`. Your scratch folder is `SCRATCH/r51/work/<your lane id>/`: create it, give every file in it a unique name. It's a tmpfs: nothing there is kept.
- **Never touch** the main checkout `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet` (the owner's Chrome loads its `dist/`), any other worktree (`git worktree list`), `../lovejoin`'s checkout, or `seedelf-data/`.
- **The deployed Seedelf contracts:** `git -C TREE show 5b82530:seedelf-contracts/<path>` (`validators/wallet.ak`, `validators/seedelf.ak`, `lib/schnorr.ak`, `lib/token_name.ak`). Not the current `seedelf-contracts/` folder, which was never deployed.
- **Lovejoin's v2 source:** `git -C /home/logic/Documents/LogicalMechanism/lovejoin show 29573c5:contracts/<path>`. Never check out or edit anything there.
- **The code under review is the bounty's scope:** tag `web-wallet/1.9.1` (`f265d178`), plus #387's change to `manifest.ts`. `git -C TREE diff web-wallet/1.9.1 HEAD --stat` shows what else differs (docs).

## Orient yourself

- `seedelf-platform/CLAUDE.md`, above all *Things that bite*: the overflow rule, `is_payable`, `linear_fee`, patches before signing, budgets by purpose and index, the ledger's size limits, Lovejoin's frozen templates and the three copies of the depth walk.
- The wallet's design docs, under `seedelf-platform/seedelf-web-wallet/`: `docs/architecture.md`, `docs/flows.md`, `docs/privacy.md` (*Known links* is what the wallet admits to), `docs/keys-and-accounts.md`, `wasm/README.md`, `extension/README.md`.
- The proofs: `seedelf-verification/README.md` and `CLAIMS.md`.

## What counts as a finding

Each needs a **concrete scenario**: these inputs or this state, and then this wrong outcome. Without one, it's a note, not a finding.

- Funds lost, locked or stranded, or paid to the wrong place.
- The wallet signs something other than what it shows, or shows a figure that's wrong by real money.
- A link between a user's addresses or transactions that `docs/privacy.md` says isn't made, made by default.
- A secret that leaks: the phrase, the Seedelf key, the vault, or a one-time account's key.
- A stuck state with no way out, a crash, or a hang that a stranger or a site can cause.
- A refusal of something the ledger and the contracts would accept.
- A proof or claim that says more than its theorem.

**Who can cause it.** Each finding names one:
- `stranger`: anyone can send any UTxO to the wallet's addresses: any tokens, any datum, any address shape, our stake key included;
- `site`: a web page, through CIP-30, with any argument;
- `pool-launcher`: whoever launches a Lovejoin pool;
- `user`: the wallet's own user, by an ordinary action;
- `nobody`: no one can reach it today.

**The data sources are trusted** to report the chain truthfully: the data layer, Koios, giveme.my. An attack that needs one to lie is out of scope (SECURITY.md). A stranger's rows *inside* an honest answer are in scope: a stranger chooses what sits at our addresses.

## Severity

| Severity | When |
|---|---|
| critical | A stranger or a site can take funds or a key |
| high | A stranger can lock, strand or misdirect funds, or the wallet signs something other than what it shows |
| medium | A user's ordinary action loses or overpays money with no warning; a figure off by real money; a stuck state with no way out; a privacy link made by default; a claim wider than its theorem |
| low | A small cost in an edge case, or a missing check with no reachable harm today |
| nit | Wording, dead code |

Grade by what someone can actually reach. Say plainly when something holds.

## Settled: never reported

Check before you report. **Search for your symptom** (the function's name, the error's words, the shape) in `seedelf-platform/seedelf-web-wallet/docs/backlog.md` and across `seedelf-platform/seedelf-web-wallet/docs/archive/plans/` (every review's *Not fixed*, *Left open*, *Disputed* and *For the owner*, and each chunk plan's leftovers). Say in `known_check` what you searched. A settled item with a new fact goes in `notes`, for the owner, never as a finding.

- **SECURITY.md's out-of-scope list** (repository root): malware, memory imaging, social engineering, coercion, hardware, third-party dependencies, Aiken itself, a compromised or dishonest data source.
- **Every backlog line** (`docs/backlog.md`): the *Declined* list, every open call (❓), and every ⬜ candidate, which is known already.
- **The *Not fixed* lists of the archived reviews** and the chunk plans' recorded leftovers.
- **The owner's rules:**
  - The wallet refuses only what the ledger or the contracts refuse (2026-10-19). A risky but valid choice gets a warning at most. A finding that says "the wallet should refuse X" where the ledger takes X isn't one.
  - The most private option is the default, with a control to turn it down. "Default" never means "only".
  - Chrome Translate stays on. Numbers stay en-US. The host grant `https://*/*` stays. giveme.my as a single point of failure is accepted.
  - UI text stays short; always *Seedelf* and *Seedelf Wallet* in what the wallet shows.
- **Frozen, never changed:** variant 1's constants and reference outputs (`seedelf-core/src/constants.rs`, `references.rs`); the v1 key derivation and its vectors (`seedelf-crypto/src/derivation.rs`, `tests/vectors/seedelf_key_v1.json`); both sets of Lovejoin templates (`seedelf-core/src/lovejoin/templates.rs`); the contracts at `5b82530`; the verification pins (chunk 46's work). A finding in frozen code is reported only as its consequence in code we can change.
- **Known, not re-reported:** chunk 46's and chunk 49's items (`docs/plans/chunk-46-verification-on-upstream.md`, `chunk-49-no-locked-funds.md`); the audit's open `script-hex-not-lake-inputs` (`seedelf-verification/Audit/review/findings.md`); the verification README's *Not proved*.
- **Out of the chunk:** `seedelf-contracts/` itself, `seedelf-data/`, Lovejoin's `fee_contract`, `media/`, readability and style. Correctness UX is always in scope.

## Each finding gives

The schema's fields:
- `id`: your lane id in lower case, `#`, a number: `w1a#3`.
- `severity`, `title` (one line), `file` and `line` (relative to TREE).
- `scenario`: the inputs or state, then the wrong outcome, with figures where it's money.
- `who`: one of the five above.
- `since`: the tag or commit that brought it (`git -C TREE log -L` or `git blame`), where that's cheap; otherwise `unknown`.
- `evidence`: the code quoted with `path:line`, the trace step by step, and any command you ran with its output.
- `confidence`: `confirmed-by-run` (you ran something that shows it), `traced` (you followed the code end to end) or `plausible` (reasoned, not traced).
- `fix`: a sketch. Fix the class, not the shape: if the bug is one member of a family, say where the others are.
- `needs_owner` and `owner_why`: any fix that adds a refusal, changes a privacy default or changes what a screen offers needs the owner.
- `known_check`: what you searched to rule out that it's known.

Also return:
- `guards`: each money guard you met (a check that keeps money from being lost, overpaid, stranded or misdirected): `file:line`, what it stops, and the test that pins it if you know one (or `none found`). Chunk 51's T1 lens reverts each in a copy to see whether a test fails.
- `checked_ok`: what you checked that holds, one line each. This matters as much as the findings.
- `notes`: settled items with a new fact, doubts too vague for a finding, and anything for the owner.
- `coverage`: what you read in full, what you skimmed, and what you didn't reach. Be honest: the completeness critic reads it.

## How you work

- **Read in full** the paths your lane names, and the code they call where it matters: a sum, a guard, the other side of a boundary. Follow a value from where it enters to where it's spent or shown.
- **Don't pad.** A short, honest report beats a long, speculative one. Never report a style preference.
- **Commands you may run:** reading (`cat`, `sed -n`, `grep`, `rg`, `find`, `wc`), `git log`, `git show`, `git blame`, `git diff`. Nothing that writes into TREE.
- **Finders run no tests and build nothing.** A finding a test could show says which test, and the verifiers write it.
- **No network calls:** not Koios, not the data layer, not giveme.my, not Minswap, no fetch of any page. If a finding turns on chain data, say what to look up.
- **Never** build `seedelf-verification/` (Lean; one uncapped build took 52 GB), run anything in `seedelf-data/`, run `npm run package`, `npm ci` or `npm run build`, rebuild any `dist/`, or send a transaction anywhere.
- **Anything you do run** gets finite input, a timeout and a memory cap: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m <command>`. Never pipe `yes` or an endless loop into anything.

## For verifiers only

- You may add **one test of your own** with a unique name, and run only that test:
  - Rust: `TREE/seedelf-platform/<crate>/tests/r51_<finding id with # as _>.rs` (for seedelf-wasm, `seedelf-web-wallet/wasm/tests/`), run from `TREE/seedelf-platform` with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m cargo test -j 4 --locked -p <package> --test r51_<...>`. The target is the tree's own and shared: cargo may wait on its lock. Integration tests see only the public API.
  - Vitest: `TREE/seedelf-platform/seedelf-web-wallet/extension/tests/r51-<finding id with # as ->.test.ts`, run from `extension/` with `timeout 10m npx vitest run tests/r51-<...>.test.ts`.
  - Never edit any other file, never run the whole suite, Playwright or `wasm/build.sh`, and put your test's full code in your answer.
- **A mutant** (a guard reverted to see a test fail) goes in a copy, never in TREE: `rsync -a --exclude target --exclude node_modules --exclude dist TREE/seedelf-platform/ $HOME/.cache/seedelf-review-51/<your id>/seedelf-platform/`, with `CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-51/<your id>-target` (never under `/tmp`, never TREE's) and, for Vitest, a symlink to TREE's `extension/node_modules`. Remove the copy when done.
