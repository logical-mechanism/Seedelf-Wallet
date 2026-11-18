# Chunk 51 · A whole-code review of the platform and the proofs

**Status: ✅ done (2026-11-18).** Its record, with what it found, the fixes, the checks and the owner's calls, is [review-51.md](review-51.md). Written 2026-11-17 on `web-wallet/whole-review-plan`, from `main` at `81e49075`. The owner: "what I want is a chunk dedicated to this. We can get an agent on each path and just find everything to fix it if it exists. So basically platform and verification."

## Why now

- **Nothing has read the whole code since before mainnet.** The crypto, launch, privacy and independent reviews of 2026-09-25 to 28 (the plans in [this folder](./)) read the whole web wallet. Since then, each release review has read only what changed since the release before it. Much of today's code arrived after those reviews: token pools, Lovejoin v2, the DEX routes, staking and governance, the data layer's reads, and payments in parts.
- **Old code still holds bugs that diffs miss.** 1.9.1's M1, an overpay when a token goes in three or more parts, had been there since 1.6.0 ([review-1.9.1.md](review-1.9.1.md)).
- **Strangers find what we don't.** Three bounty reports were confirmed, each in how the wallet sorts addresses or builds a payment:
  - a collateral UTxO read as a stranger's (#358);
  - a stranger's address with our stake key called our own (#359);
  - a chain of parts paying an output nobody asked for (#384).
- **A fix on `main` comes first.** [SECURITY.md](../../../../../SECURITY.md) voids a report whose issue is already fixed on `main` when it arrives. So a confirmed high or medium goes to `main` on its own PR, without waiting for this chunk to end.

## Scope

**In:**
- **`seedelf-platform/`:**
  - the Rust crates;
  - the WebAssembly crate;
  - the extension's `src/`, `scripts/` and tests;
  - the CI and build files that make the zip and the CLI binaries.
- **`seedelf-verification/`:** the statements, the bytes, the build and the claims.

**Out:**
- **`seedelf-contracts/`:** variant 1 is frozen on chain, and its three scripts are kernel-checked. Lane V1 reads its source at `5b82530`, and lane V3 checks that the proved bytes are the deployed ones; neither reviews the contracts themselves.
- **`seedelf-data/`:** never run anything there, and never run a binary from its `target/` (it reads `.env` and reaches home's mainnet services). A review of the server is a chunk of its own, if the owner wants one.
- **Lovejoin's fee_contract:** no Seedelf transaction uses it, and every claim leaves it out (the owner, 2026-11-03).
- **`media/`:** posts already published, so it's a record.
- **Readability and style:** chunk 50 just rewrote the docs, and the style pass waits for the owner's list. Correctness UX is always in scope.

**About 210k lines of code, and 140k of tests:**

| Part | Lines |
|---|---|
| `seedelf-core/src` | 14k |
| The WebAssembly crate's `src` | 14k |
| The other crates | 6k |
| The extension's `src` | 74k |
| Lean, much of it written by the `gen-*.py` generators | ~100k |
| Tests: the extension's 94k (e2e included), the WebAssembly crate's 20k, core's 21k, the rest 4k | ~140k |

The code on `main` is the bounty's scope, tag `web-wallet/1.9.1`, with one difference: `manifest.ts` changed in #387.

## Start here

- **Read first:**
  - this plan;
  - [backlog.md](../../backlog.md): its open calls and its *Declined*;
  - SECURITY.md's scope;
  - [review-1.9.1.md](review-1.9.1.md) and [independent-review.md](independent-review.md), for how a review here runs and what it found.
- **Write a workflow** (load the `workflow-authoring` skill first). It replaces `/code-review max` per path: one script gives every lane the same brief, the settled list and the verification tiers.
  - **Its size:** about 23 area lanes, 5 cross lenses, a critic with a gap round, then verifiers. That's far past the default size guideline of 10 agents. The owner asked for "an agent on each path", but say the count before starting.
  - **Waves:** run the platform lanes first, then verification, so the run never holds every slot at once.
- **A worktree** on `logic`, with the caches copied so nothing builds from scratch:
  ```bash
  cd ~/Documents/LogicalMechanism/Seedelf-Wallet && git worktree add ../Seedelf-Wallet-chunk51 -b web-wallet/whole-review main && cp -a seedelf-platform/seedelf-web-wallet/extension/node_modules ../Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/ && cp -a seedelf-platform/seedelf-web-wallet/wasm/pkg ../Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/wasm/ && cp -a seedelf-verification/.lake ../Seedelf-Wallet-chunk51/seedelf-verification/
  ```
  Give the worktree its own Cargo target: never share one with another worktree, and never put it on `/tmp`.
- **The working folder is `docs/plans/review-51/`** in the worktree, committed as it grows.
  - What goes in it:
    - `COMMON.md`, the brief every agent gets;
    - `LANES.md`;
    - each lane's findings;
    - `FINDINGS.md`, the merged list.
  - **Subagents can't write report files.** Each one returns structured output, and the lead writes the folder from it.
  - `/tmp` is a tmpfs, so a reboot clears the scratchpad. A workflow resume failed across a reboot in 1.6.0's review: keep a continuation script that starts from the saved results.

## Calls at the start

- ❓ **Lanes V1 and V2 are chunk 49's step 4:** the outside read of the readable statements. The owner put chunk 49 on hold for IOG, although step 4 doesn't wait on IOG. **Default:** do it here, and mark step 4 done in chunk 49's plan. If the owner keeps chunk 49 whole, drop V1 and V2.

## The brief every agent gets (COMMON.md)

**What counts as a finding.** Each needs a concrete scenario: these inputs or this state, and then this wrong outcome. Without one, it's a note, not a finding.
- Funds lost, locked or stranded, or paid to the wrong place.
- The wallet signs something other than what it shows, or shows a figure that's wrong by real money.
- A link between a user's addresses or transactions that [privacy.md](../../privacy.md) says isn't made, made by default.
- A secret that leaks: the phrase, the Seedelf key, the vault, or a one-time account's key.
- A stuck state with no way out, a crash, or a hang that a stranger or a site can cause.
- A refusal of something the ledger and the contracts would accept.
- A proof or claim that says more than its theorem.

**Who can cause it.** A finding names one:
- a stranger, who can send any UTxO to the wallet's addresses: any tokens, any datum, any address shape, our stake key included;
- a site, through CIP-30 with any argument;
- whoever launches a Lovejoin pool;
- the user;
- nobody today.

The data sources (the data layer, Koios, giveme.my) are trusted to report the chain truthfully. An attack that needs one to lie is out of scope (SECURITY.md).

**Severity:**

| Severity | When |
|---|---|
| Critical | A stranger or a site can take funds or a key |
| High | A stranger can lock, strand or misdirect funds, or the wallet signs something other than what it shows |
| Medium | A user's ordinary action loses or overpays money with no warning; a figure off by real money; a stuck state with no way out; a privacy link made by default; a claim wider than its theorem |
| Low | A small cost in an edge case, or a missing check with no reachable harm today |
| Nit | Wording, dead code |

**Settled, never reported:**
- **SECURITY.md's out-of-scope list.**
- **Backlog lines.** The *Declined* list and every open call (❓) are settled. A new fact about one goes to the owner as a note.
- **The *Not fixed* lists** of the archived reviews.
- **The owner's rules:**
  - The wallet refuses only what the ledger or the contracts refuse (2026-10-19). A risky but valid choice gets a warning at most.
  - The most private option is the default, with a control to turn it down.
  - Chrome Translate stays on.
  - Numbers stay en-US.
  - The host grant `https://*/*` stays.
  - giveme.my as a single point of failure is accepted.
- **Frozen, never changed:**
  - variant 1's constants and reference outputs;
  - the v1 key derivation and its vectors;
  - both sets of Lovejoin templates;
  - the contracts at `5b82530`;
  - the verification pins (chunk 46's work).
- **Known, not re-reported:**
  - chunk 46's and chunk 49's items;
  - the audit's open `script-hex-not-lake-inputs`;
  - the verification README's *Not proved*.

**Each finding gives:**
- an ID, the lane plus a number (`w1#3`);
- the severity;
- `file:line`;
- the scenario;
- who can cause it;
- since when, as a tag or commit from `git blame`, where it's cheap to find;
- the evidence: a test, a trace or a run;
- a fix sketch;
- whether it needs the owner, and why. Any fix that adds a refusal, changes a privacy default or changes what a screen offers needs the owner.

**How agents work:**
- **Finders only read.** Verifiers may add a test with a unique name and run only that test (`cargo test -p <crate> --test <name>`, `npx vitest run <file>`).
- **Every reproduction** gets finite input, a timeout and a memory cap:
  ```bash
  systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m <command>
  ```
- **Lean:** one build at a time, only through `check.sh`, and never `lake build` bare. Finders read statements; they don't build.
- **Builds:**
  - Never run `npm run package`: it overwrites the release zips.
  - Never rebuild the main tree's `dist/`: the owner has it loaded.
  - No transaction on mainnet, ever.
- **The Lovejoin source:** read it with `git -C ../lovejoin show 29573c5:<path>`. Never check out or edit anything in `../lovejoin`.
- **The deployed Seedelf source:** read it with `git show 5b82530:seedelf-contracts/<path>`.

## The lanes

Each lane reads its own paths in full, and the code they call where it needs to. The line counts leave out tests.

**The Rust crates** (paths under `seedelf-platform/`):

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| R1 | `seedelf-crypto/`, `seedelf-koios/` | 2.5k | The prover against `schnorr.ak`; the nonce and randomness; wiping secrets; the Lovejoin proofs; how Koios's answers are parsed |
| R2 | `seedelf-core/src/`: `build.rs`, `transaction`, `eval`, `cbor`, `note`, `staking`, `withdraw_zero`, `utxos`, `assets`, `address`, `constants`, `references` | 7.2k | Fees and `settle`; the ledger's limits; budgets matched by purpose and index; the patches, applied before signing; change and minimums; `is_payable`; sorting own addresses from strangers'; overflow under CLAUDE.md's rule |
| R3 | `seedelf-core/src/lovejoin/`, `orders.rs` | 6.6k | Deriving and verifying a pool; box values; the reward balance; DEX cancels and `check_cancels`; the integrity hash |
| R4 | `seedelf-cli/`, `seedelf-display/` | 3.2k | The commands that still build inline (`create`, `fund`, `util extract`); the secret key file; the signing site at `127.0.0.1:44203` |

**The WebAssembly crate** (`seedelf-web-wallet/wasm/src/`):

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| W1 | `lib.rs` | 6.9k | Payments in parts (`in_parts`, `chained`, `reserving`, `max_in_parts`); sums of row values; what each binding trusts from TypeScript |
| W2 | `cip30.rs`, `decode.rs` | 4.1k | A site's transaction, decoded: own and foreign inputs, outputs, certificates, proposals, the validity window and required signers. Whatever signTx shows must come from here |
| W3 | `lovejoin.rs` | 3.0k | Chains, collateral tails and withdraws; the funding sums |

**The extension's worker and screens** (paths under `extension/src/`):

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| E1 | `background/lovejoin*.ts` | 9.3k | Waits and returns; held boxes; retired pools; races over a pool's reward balance |
| E2 | `background/{sessions,parts,connector,collateral,runs}.ts` | 7.8k | Funding, returns and disconnects; a part stopped mid-landing; Stop; the one-time account's index |
| E3 | `background/{dapp,dapp-window,tx-view}.ts`, `content/`, `shared/dapp.ts`, `manifest.ts`, `ui/{dapp,sites}.ts`, `ui/screens/{DappApprovals,SiteSessions,ConnectedSites,Dapps}.tsx` | 7.0k | The boundary with untrusted sites: each approval, its last look before sending, and the account or network changing underneath it; the bridge; permissions; the CSP |
| E4 | `background/{vault,private-store,storage,storage-access,sw,handlers,ui-port,wallet,accounts,account,preferences,wasm}.ts`, `background/secret-box/`, `shared/{rpc,password,preferences,fingerprint}.ts`, `ui/screens/{Create,Restore,Unlock,Settings}.tsx`, `ui/delete-phrase.ts` | 9.2k | Keys at rest and in memory; lock and unlock; the message boundary (`rpc.ts`); what a content script or page can reach |
| E5 | `background/{send,transfer,move-in,mint,withdraw,script-spend,destination,coin-control,pending,spent,sent-txs,short,cbor}.ts`, `shared/{recipients,handles,seedelf-name,histories,label}.ts` | 4.3k | Each money flow, from the user's ask to the signed transaction; a payment that may already have gone out; histories kept apart |
| E6 | `background/{koios,data-layer,chain,balances,activity,feed,incoming,private-index,contract-scan,minted-by,nft-image,prices,contacts}.ts` | 5.8k | Chain reads from honest sources, with any stranger's rows in them: datums, tokens, address shapes; the data layer's fallback to Koios; caching across a network or account switch |
| E7 | `background/{minswap,staking,governance}.ts`, `ui/screens/{Swaps,Staking,Governance,Voting,Delegations,Rewards,Pools}.tsx`, `ui/{swap,dreps}.ts` | 8.6k | Order building and cancels; certificates and deposits; votes; quotes against what's built |
| E8 | `ui/screens/{Lovejoin,LovejoinLaunch,ClaimAll,Transfer,Withdraw,MoveIn,CreateSeedelf,RemoveSeedelf,Collateral}.tsx`, `ui/components/{LovejoinReturn,BringAllBack}.tsx` | 8.2k | Every figure on a private-side review against what's built; which button still works in each state |
| E9 | The other screens and components, `ui/{format,App,tokens,…}.ts(x)`, `i18n/` | 12k | The same for the public side, plus `format.ts`'s rounding; the critical keys (`.warn.` and `.privacy.`); a translated string compared, parsed or stored |

**Build, CI and docs:**

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| B1 | `.github/workflows/{web-wallet,release,continuous-integration}.yml`, `wasm/build.sh`, `extension/scripts/`, the Vite configs, `package.json` and its lock, `Cargo.toml` and its lock, `rust-toolchain.toml` | ~3k | Whether the zip is the commit; the tag glob; what a store build turns on; loose pins; a script that fetches at build time. `npm audit` and `cargo audit`, if installed, are the lead's to run |
| D1 | The outward docs: the wallet's README, `privacy.md`, `keys-and-accounts.md`, `architecture.md`, `store/privacy-policy.md`, SECURITY.md, the root README's limits | — | Each claim about what the code does, checked against the code. A light pass: one reviewer, no refuters |

**The proofs** (paths under `seedelf-verification/`):

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| V1 | `Seedelf/Every/{Typed,PolicyTyped}.lean`, and the Aiken source at `5b82530` (`wallet.ak`, `seedelf.ak`, `schnorr.ak`, `token_name.ak`) | ~1k | **A fresh context:** given only the source and the definitions, never the proofs, and never what we expect it to find. For each clause: does `walletAccepts`, `schnorrProve` or `policyAccepts` accept exactly what the source accepts? |
| V2 | `Lovejoin/Every/Readable*.lean`, and Lovejoin's v2 source at `29573c5` | ~2k | The same, for mix_logic, mix_box and one_shot_mint |
| V3 | `extract*.sh`, `Seedelf/Scripts/`, the Lovejoin `Scripts/`, `lakefile.lean` and its manifest, `check.sh`, `tally.py`, `Audit/count.py`, `gen-*.py` | ~4k | Whether the proved bytes are the deployed ones (against `references.rs`, `templates.rs` and seedelf-wasm's `lovejoin_proven_bytes_test`); how `check.sh` reads a verdict (Undetermined, `sorry`, axioms, a replayed result); whether each generator writes what it says |
| V4 | The Blaster specs: `Seedelf/*.lean` (the specs and controls, not the generated instances), `Slice/`, `Lovejoin/` classic, `V2/` and `AnyTx/` | ~20k read | Step limits; vacuous hypotheses; a control for each Valid; what `isUnsuccessful` means at our pin |
| V5 | `CLAIMS.md`, `README.md`, the `Every/` READMEs, `Audit/README.md` | — | Each claim against its theorem. Each cited theorem must exist, sit in a family `check.sh` runs by default, and keep its axiom guard. Is the trusted base said plainly? |

**Cross lenses,** after the lanes, with every lane's output:

| ID | Lens |
|---|---|
| X1 | **What's shown is what's signed.** For every flow (public and private Send, Make private, Make public, mint, Remove, swap, stake and vote, a Lovejoin mix or return, a site's signTx), trace the review's figures from the screen through the worker and WebAssembly into core's transaction |
| X2 | **A stranger's input,** end to end: a crafted UTxO, token, datum or address shape at our addresses; a crafted CIP-30 argument; a crafted Lovejoin pool. What does each layer assume the layer before it checked? |
| X3 | **One rule, several copies.** Rust, TypeScript and the shared vectors (Lovejoin's depth walk, own-address sorting, minimums, sums); and error text crossing the boundary |
| X4 | **Across time.** Lock and unlock; the worker restarting mid-flow; two tabs; a network or account switch; a transaction that lands late or rolls back |
| T1 | **Tests that pin the guards.** For each money guard the lanes name, revert it in a copy (`cp -r`) and check that a test fails. List the guards nothing tests |

**Then a completeness critic** reads `LANES.md` and every output, names what nobody covered, and sends a gap round of up to five finders.

## Verifying the findings

- **By stakes:**
  - critical, high and medium: two refuters, one on the trace and one on the impact, then a tiebreak where they disagree;
  - low: one trace;
  - nit: none;
  - D1: none.
- **A finding a test can show gets one,** failing before the fix and passing after.
- **Verify code findings first,** ahead of docs and proofs.
- **Start fixing a confirmed high or medium as it lands.** Fix it in a second worktree, so verifiers keep reading an unchanged tree, and give it its own PR to `main` (see *Why now*).
- **`FINDINGS.md`:** the lead merges duplicates and writes the confirmed list. The ones that need the owner go in a ❓ list with a recommendation each.

## The fix round

Fix everything confirmed, except what needs the owner.

- **Fixers by file ownership** in the shared tree, test first. Rebuild the WebAssembly between stages whenever Rust changed.
- **A CLI-only fix** gets its own commit, so a CLI patch release can be cut from it.
- **A verification fix** goes through `check.sh` for the families it touches, with the headline theorems' axiom guards intact.
- **Fix the class, not the shape.** 1.9.1's lesson: a sweep with an upper bound found the older, larger bug.
- **Translations:** a changed critical value is back-translated blind, in es and ja.
- **The privacy policy:** a change to how data is handled gets a dated entry under its *Changes*, in the same PR.
- **Then review the merged fixes across areas.** That's where every earlier round's new bugs were.
  - Revert each fix in a copy to prove its test fails.
  - For each state a fix makes reachable, ask which button still works.
- **Then a last look** at the fix-ups.

## Checks

- **Record the counts at the start,** on the untouched worktree, so breakage shows.
- **At the end, release step 1's checks** from [development.md](../../development.md#1-on-the-release-branch-set-the-version-and-run-the-checks), without the version and the lists:
  - `cargo test --workspace --locked`;
  - the parts suite (`payment_parts_shapes_test --ignored`);
  - `npm test` on both builds;
  - `npm run e2e`, on the dev build and the store build. Stress new e2e tests under `taskset -c 0,1` before CI;
  - `npm run e2e:data`;
  - `LIVE_KOIOS=1`;
  - clippy and `cargo fmt --all -- --check`.
- **Live on preprod** with test wallet A (`node e2e/live/run.mjs all`, and `staking`), plus a live run of any private-spend path a fix touched that the fakes can't finish.
- **Verification:** `./check.sh`, `seedelf-every` and `lovejoin-every` if any Lean changed.

## When it lands

- **The working folder becomes one record:** `docs/archive/plans/review-51.md`. Its full text stays in git at the commit before that.
- **What's left open** becomes backlog lines with their IDs. What still holds moves into the design docs, and this plan goes to the archive.
- **Push and open a PR only at the owner's word.** The owner can also run `/code-review ultra <PR#>` on it as an independent check. Only the owner can start that.
- **What ships, and when, is the owner's call:** a wallet release (1.9.2) and a CLI patch release.

## Who does what

- **Claude:** runs the workflow, verifies, fixes, runs the checks and the live preprod runs, and writes the record.
- **The owner:** makes the ❓ calls and decides when to merge and release. Each command block for the owner names its host, with no placeholders and no `set -e`.

## The owner's decisions

- **2026-11-17:** chunks 46 and 49 wait: "lets wait on 46 and 49 for IOG". Then the review: "Think its worth doing some comprehensive review of the repo using max and ultra?", and after the recommendation (max per path for the money paths, ultra on a release PR), this chunk: "actually what I want is a chunk dedicated to this. We can get an agent on each path and just find everything to fix it if it exists. So basically platform and verification. Lets write that chunk then ina new context window I can get it started".
