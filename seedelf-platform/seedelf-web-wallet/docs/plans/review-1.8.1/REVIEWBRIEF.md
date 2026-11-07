# 1.8.1's release review: the brief

The gate for Seedelf Wallet 1.8.1, a patch. Branch `web-wallet/release-1.8.1`, cut from `main` at `d190f717`, with the release prep committed on it as `2a8060d3`.

## What's in scope

Every PR merged since 1.8.0's release (`web-wallet/1.8.0`, on `497da3a3`), bar #366 (1.8.0's record, docs only):

- **#367**, chunk 43, merged as `9103df62`: Lovejoin's transactions take whatever sits in their pool's `mix_logic` reward account ("lucky winner"), and the dApp signer refuses a site's transaction that pays into one. Diff: `git diff 08fbb6f6 9103df62`. Its body: `gh pr view 367`. The plan, archived with its record: `WW/docs/archive/plans/chunk-43-lovejoin-reward-balance.md`.
- **#368**, chunk 45, merged as `d190f717`: kernel-checked Lean proofs of exactly when Lovejoin v2's `mix_logic` and `one_shot_mint` accept, in every transaction, restated in the Aiken source's terms, and `seedelf-verification/CLAIMS.md`. Diff: `git diff 9103df62 d190f717`. Its body: `gh pr view 368`. The record: `WW/docs/plans/chunk-45-lovejoin-every-tx.md`.
- **The release prep**, `2a8060d3` (`git show 2a8060d3`): 1.8.1, the DRep lists' dates, and mainnet's v2 5 ₳ pool (`fcb3f5ec…`) in the Lovejoin head start. Tokens and the data layer's decimals are unchanged.

## Paths

- ROOT = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`
- WW = `ROOT/seedelf-platform/seedelf-web-wallet`, EXT = `WW/extension`, WASM = `WW/wasm`
- CORE = `ROOT/seedelf-platform/seedelf-core`, VER = `ROOT/seedelf-verification`, DATA = `ROOT/seedelf-data`
- SCRATCH = `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad`
- The Lovejoin source is the checkout at `/home/logic/Documents/LogicalMechanism/lovejoin`. Read it through git only: `git -C /home/logic/Documents/LogicalMechanism/lovejoin show 29573c5:contracts/validators/mix_logic.ak` is v2 (core's `Set::V2`), `8131b1d:` is `Set::V1` (retired). Never check out, switch, stash or edit anything in `../lovejoin` or `../lovejoin-v2`.

## Rules, for every agent

1. **Read-only in the main tree.** Never edit, create or delete a tracked file there, and never run `git add`, `commit`, `switch`, `checkout`, `stash`, `reset`, `restore` or `clean`. Never run `npm ci`, `npm install`, `npm run build`, `npm run package` (it overwrites release zips) or `wasm/build.sh` there. The lead builds.
2. **The one file you write in the tree is your report**, `WW/docs/plans/review-1.8.1/<your id>.md`. Write it before you return, and say in it everything your structured answer says.
3. **Repros.** Scratch work goes in `SCRATCH/review/<your id>/`. A repro test that must sit in the tree gets a name nobody else uses (`EXT/tests/zz-r181-<id>-<n>.test.ts`, `CORE/tests/zz_r181_<id>_<n>.rs`, `WASM/tests/zz_r181_<id>_<n>.rs`). Run only it (`npx vitest run tests/zz-r181-…`, `cargo test -p seedelf-core --test zz_r181_…`), and delete it before you return. Your report says what it showed. **Always name the test target:** never `npm test`, a bare `npx vitest run`, a whole crate's or the workspace's `cargo test`, or `cargo clippy`, since other agents' repro files would be in them.
4. **seedelf-data:** never run a binary from `DATA/target`, never `cargo run` anywhere there, and never `cargo test -- --ignored` anywhere in the repository (those tests reach Koios or home's mainnet services, or rewrite fixtures). In `DATA`, only `cargo test` of a named test target, offline.
5. **seedelf-verification:** never run `lake`, `lean` or `check.sh` (one bare build took 52 GB). The lead is building `./check.sh lovejoin-every`, capped. Its log is `SCRATCH/lean/lovejoin-every.log`, finished once it ends with `== summary` and a line per module.
6. **The network:** no submits, nothing to giveme.my, nothing to `mainnet.seedelf.logicalmechanism.io`. At most a handful of Koios reads (`api.koios.rest`, `preprod.koios.rest`) where a claim turns on chain data, and public docs or source on GitHub.
7. No Playwright, no `npm run e2e`, nothing under `e2e/live`. The lead runs those.
8. **Out of scope:** CLI-only findings; CI changes (put them as a note for the owner); anything in `media/` (a posted record); Lovejoin's own off-chain app (the owner: "We use the lovejoin contracts not their off chain").

## The owner's calls already made

Don't re-argue these. A finding may say a call has a consequence nobody wrote down.

- **Lucky winner** (2026-11-06): the first transaction built in a pool takes the whole balance, into the user's own output, "such that everything just continues on as normal".
- **Not in 1.8.1, backlog lines:** a review line when a balance is taken; refusing an address whose stake part is a pool's `mix_logic` (it can't put anything into the account); rebuilding the rest of a chain a moved balance cut short.
- **The edge case's live run** (a real balance in the account) is declined. Never put it back on a list.
- **No paternalistic guards:** the wallet refuses only what the ledger or the contracts would refuse, plus what the owner asked for. This guard was asked for ("the wallet at least does not allow a user to set that stake key for anything").
- **The verification's scope:** fee_contract and the older pools' scripts are out. The `_valid` corollaries are narrower than the base iffs, which is known: cite the base iffs.
- Numbers stay en-US; Chrome Translate stays on; there's no prettier here, so never run a formatter.

## Severity

- **high:** funds or collateral lost or locked; a signature the user didn't approve; the wallet's own data leaked; a security or verification claim that's false.
- **medium:** a flow refused or stuck that should work; a critical line (`.warn.`, `.privacy.`) that misleads; a claim (CLAIMS.md, a README, the privacy policy) that overstates what's proved or done; a critical line mistranslated.
- **low:** a real but narrow wrong behaviour; a new rule no test holds; a doc that's wrong.
- **nit:** wording, comments, names.

## How to report

- **Each finding** gets an id `<your id>#<n>`, a severity, a file and line, and what's wrong. Then the evidence (the code quoted, a repro's output, a theorem's statement), the concrete failure (these inputs or this state give this wrong result), and the smallest fix you'd make, test first.
- **Only real defects and test gaps:** no style preferences, and nothing you haven't checked against the code as merged.
- **List what you checked that held** (`checked`), so the lead knows what was covered.
