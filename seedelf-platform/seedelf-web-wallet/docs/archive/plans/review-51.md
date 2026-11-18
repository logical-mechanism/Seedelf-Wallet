# Chunk 51's whole-code review of the platform and the proofs (2026-11-18)

**Status: ✅ done. The fixes are on branches, none pushed:** when each goes to `main`, and what ships (a wallet release and a CLI patch release), is the owner's call.
- `web-wallet/whole-review`: this record, the plan's move to the archive and the backlog's lines, with `web-wallet/whole-review-fixes` merged in: every fix.
- **For `main` first, each on its own,** since SECURITY.md voids a report already fixed on `main`, and a public PR shows the bug before a release ships the fix:
  - `web-wallet/lovejoin-box-datum-spelling`: r3a#1 (high) and x2#1;
  - `cli/stranger-rows`: every CLI fix, for a CLI patch release.

The working folder, `docs/plans/review-51/`, was compressed into this file. Its full text is in git at `TODO-FOLDER`:
- the agents' brief (`COMMON.md`), the lanes (`LANES.md`) and the fixers' brief (`FIX.md`);
- every lane's and lens's report (`lanes/`), each finding's verdicts and the verifiers' tests (`verify/`);
- `INDEX.md`, every finding on one line, and `FINDINGS.md`, every finding by what became of it;
- the counts at the start (`BASELINE.md`), the high fixes' branches (`fix-branches.md`) and the live runs (`LIVE.md`);
- the data and the tools that made them (`data/`, `tools/`).

[The IDs](#the-ids) says where each family is. What still holds is in the design docs, and what's left open is a line in [backlog.md](../../backlog.md).

## What it covered

The owner's ask, 2026-11-17: "We can get an agent on each path and just find everything to fix it if it exists. So basically platform and verification."
- **`seedelf-platform/`:** the Rust crates (crypto, koios, core, display, the CLI), the WebAssembly crate, the extension's worker, connector, screens, scripts and tests, CI and the build.
- **`seedelf-verification/`:** the readable statements against the deployed sources, the tooling, the Blaster specs and the claims.
- **Out:** the contracts themselves (variant 1 is frozen at `5b82530`), `seedelf-data`, Lovejoin's unused fee contract, `media/` and style.

## How it ran

1. **34 lanes,** one finder each, the plan's 23 with the six largest split in two: R1 to R4 (the Rust crates), W1 to W3 (the WebAssembly), E1 to E9 (the extension), B1 (the build and CI), D1 (the outward docs) and V1 to V5 (the proofs). V1 and V2 ran in a fresh context, given only the deployed sources and the readable definitions, never the proofs: that is chunk 49's step 4.
2. **Cross lenses:** X1 (what's shown is what's signed, in two halves), X2 (a stranger's input, end to end), X3 (one rule in several copies), X4 (across time), and T1a to T1l, which reverted every guard their lanes named, in a copy, and listed those no test caught. Then a completeness critic, and ten gap finders on what it named.
3. **Verification by stakes:** a critical, high or medium got two refuters, one on the trace and one on the impact, and a tiebreak where they disagreed; a low got one trace; nits and D1 none. Each verdict that held came with a test failing on the code.
4. **Round one:** ten fixers by file ownership (G1 core, G2 the CLI and Koios, G3 the WebAssembly, G4 the worker's Lovejoin and sessions, G5 the connector, G6 keys, money flows and chain reads, G7a and G7b the screens, G8 docs and CI, G10 the proofs), test first: each test failed before its fix and passes after.
5. **The review of the merged fixes:** nine lenses (R2money, R2sign, R2time, R2cli, R2tests, R2screens, R2verif, R2docs, R2still), verified by stakes as above, then round two by the same fixers.
6. **The last look** at round two: seven lenses (L3money, L3time, L3sign, L3screens, L3cli, L3tests, L3still), then round three.
7. **A final look** at round three: three lenses (L4cli, L4worker, L4tools), then round four. Its seven findings were all lows and nits in round three's own changes, and it found none above.

## What it found

390 findings. Severity is the verifiers' where they ran, else the finder's.

| Severity | Fixed | The owner's | Covered, moot or unreachable | Merged | Refuted | Not verified | All |
|---|---|---|---|---|---|---|---|
| high | 3 | | | | | | 3 |
| medium | 3 | 4 | | 1 | | | 8 |
| low | 267 | 38 | 13 | 13 | | 1 | 332 |
| nit | 42 | 1 | | 3 | 1 | | 47 |
| **All** | **315** | **43** | **13** | **17** | **1** | **1** | **390** |

- **The T1 lenses' 177** are guards no test pinned: each now has a test that fails without it, or is recorded as moot, unreachable or covered by another's test.
- **Covered, moot or unreachable** (13): a guard another finding's test already pins (9), one no test can fail without (2), and two no path reaches today.
- **Not verified:** w2#3. Its trace verifier was stopped by the model's safety filter and wasn't run again; its fix (`36fbb96f`) stands on its own test.
- **Refuted:** lead#1, the lead's own question about a session's collateral tail.

### The highs and the mediums

| ID | What | Outcome |
|---|---|---|
| **r3a#1** (high) | A stranger's mix can write the user's Lovejoin box datum as constructor 0's general form, which the contract accepts and the wallet no longer saw as a box | fixed, `0c965ff8` (`e2b31e6f` for `main`) |
| **r4#1** (high) | A stranger freezes any CLI external wallet: three junk rows overflow `external sweep`'s and `external balance`'s token sums forever | fixed, `64379c03` (`027fc81b` for `main`) |
| **r2cli#1** (high, made by round one) | Keyset paging read the contract in `tx_hash` order, which a payer chooses, so 20 of a stranger's piles took every slot a CLI spend draws on | fixed, `e6d6a18d` (`d8114f19` for `main`) |
| **x2#1** (medium) | A stranger's 5 ₳ at a key address carrying mix_box's hash counted as a pool box | fixed, `d2a7278d` (`fcdacc50` for `main`) |
| **r4#2** (medium) | Three junk UTxOs under the user's register broke the CLI's `balance` for good | fixed, `64379c03` (`027fc81b` for `main`) |
| **r4#4** (medium; r1#2 the same) | A submit the CLI couldn't confirm read as a plain failure, so running the command again could pay twice | fixed, `48a4c977` (`82078f10` for `main`) |
| **e1a#1** (medium) | A stranger's deposit under the wallet's register reads as the wallet's own unmixed box | the owner's |
| **e6#1** (medium) | A stranger can plant a Seedelf so Remove preselects the public account | the owner's |
| **r2a#3** (medium) | A stranger's many-token UTxO costs several times its ADA once re-made as change, and selection takes it first | the owner's |
| **gap-g1#1** (medium) | A payment under a register already on chain is classed Received and taken first by the stealth mint and the fundings | the owner's |

## The lead's calls

- **V1 and V2 ran here as chunk 49's step 4,** by the start call. V1 found nothing: Seedelf's readable definitions accept exactly what `wallet.ak`, `seedelf.ak`, `schnorr.ak` and `token_name.ak` do, clause by clause. V2 found two docstring nits in Lovejoin's, fixed (`40883a55`). Chunk 49's plan marks the step done.
- **The highs went to their own branches from `main` as they landed,** so each can be its own PR. Pushing them is the owner's call.
- **r2sign#1 was fixed though flagged for the owner,** as the round's own regression: round one's reading made the sign window reassure ("It pays a Seedelf") where 1.9.1 warned, for two shapes no Seedelf Wallet reads. Its tiebreak graded it low.
- **gap-g6#2's fix keeps more on the device** (a Lovejoin origin keeps its transaction's input keys, encrypted), so the privacy policy has a dated Changes entry, 18 November 2026, in the same branch. r2docs#5's re-reads after an update needed none: the snapshot is a whole-contract read the policy lists, and tells the server less than a delta read.
- **r2still#2 was fixed forward after the last look, not reverted:** its one-run wait read as a swap still filling, with Stop offered. Round three made the wait timed and the page say what's happening.
- **l3sign#1 went to the owner:** older than 1.6.0, and its fix adds critical words.
- **The last look's findings were verified by their fixers' failing tests,** as 1.9.1's last look was, not by separate verifiers. R2tests' and T1's are of that kind already: each is a guard no test caught.
- **Two of the critic's claims nobody had checked, the lead checked** (below).

## Two claims checked

The completeness critic named nine claims that rested on memory or judgment. Seven were taken up by the gap round or a verifier. The other two would each have been critical if wrong, so the lead checked them, offline, on the fix branch:
- **Conway refuses duplicate keys.** W2 had said so from memory: if not, a site's `{A: 100, A: 1}` would show as 101 in the sign window and land as something else. The ledger's own decoder (`cardano-cli 11.0.0.0`, `debug transaction view`) refuses a repeated asset name, a repeated policy and a repeated body key ("Duplicate key: 2 while decoding type TxBodyRaw"). And a signature over such a body covers its exact bytes, so re-encoding it breaks the signature.
- **Data just under the 128-level guard reads without a trap** inside the module's 1 MiB stack, the limit 1.6.0's trap showed bites. A probe sent site transactions nested to the deepest level the guard accepts through `decodeTx` and `inspectDappTx`: definite and indefinite lists and maps (125 levels in the witness set, 120 inline), constructor 0 in tag 121 (62 and 60), the general form (41 and 40) and a native script (62). Every one read, and the module decoded a real transaction after each.

## The fixes

On `web-wallet/whole-review-fixes`, from `f87c3e77` (this branch with the two high fixes in), each committed by path, each group's tests failing before its fix. Each commit's message names the findings it fixes; FINDINGS.md (in the folder) maps every finding to its commit.

**Round one** (`0c965ff8` to `10a06db6`, 35 commits):

| Area | Commits | What |
|---|---|---|
| The highs | `0c965ff8`, `64379c03`, `fcb22df7` | r3a#1's box datum spelling; r4#1 and r4#2, a stranger's rows in the CLI's sweeps and balances, and the independent review's medium on that fix |
| The CLI | `48a4c977`, `4c3194f9`, `03cf290e`, `cc7440c9` | a submit Koios doesn't confirm (r4#4, r1#2), keyset paging, the signing page bound to its run, only the contract's script address, the CLI's untested money guards |
| Core | `c1c5b13a`, `1cf196c4`, `46975c50`, `1dc64e1d`, `1d509df7`, `21caa3b8` | apart's search, the cancel check's own nesting walk, labels and planner helpers, a paid withdraw's change and a collateral return's least, T1's core guards |
| The WebAssembly | `36fbb96f`, `514c6579`, `a6b37119`, `3b755369`, `b27f0160` | what a site's transaction shows (dead, none, register; Byron; script stake certificates; big numbers), the contract's own rows, a direct return's collateral tail |
| Keys and chain reads | `d2a7278d`, `2b3dfd80`, `6aea4fb8`, `4cbac01e`, `a9b5a3bb`, `0a7d493e` | a key address carrying a script's hash, readings tied to their phrase, the private index's sealed verdicts versioned |
| Lovejoin and sessions | `fdd3b8b2`, `506e4ed2`, `f1da256d` | timing, depth, returns and holds; a split route's late leg; a deposit never answered; the copies read |
| The connector | `d9e015fb`, `5c5bc3c1` | reservations, a site's text, collateral and windows |
| The screens | `fc6a0aa1`, `8fd738ff`, `c8003eda` | the round's strings and the critical set's class rule (e9b#2), the figures, words and lookalikes |
| Docs, CI and the proofs | `c4b7a906`, `40883a55`, `10a06db6` | the notices' order, the release logs, the actions' pins; a failed rebuild never reads as ok; the docs |

**Round two** (`02f73991` to `ad8c3ce4`, 22 commits): the round's back-translation (`02f73991`, `76c1df4b`); the lead's test fixes for the preprod-only build and the renamed picker rows (`04616cf6`, `417fff13`); the first part's tests and fixes (`853d5779`, `f88560c4`, `e66a6a16`, `2d639df8`, `e4d97bea`, `5ba328e5`, `459d4cf8`); the review of the merged fixes' (`ca970760` docs, `7b6881f7` the swap page, `ddc17685` the proof tooling, `53780f85` and `81516188` the register readers, `b3687869` the collateral at the fee sent, `e6d6a18d` and `af022a6f` the CLI's window and fund, `61a4d717` the sign window, `ad8c3ce4` the phrase pins at the writers and the swap's late leg).

**Round three,** the last look's 14 (`7921367f` to `0dce8a6b`):
- `7921367f`, `abcf2ffe`: the swap page's spent step (it says it all comes back next, and Stop goes), the late leg's wait as 15 s of time for every run, the stranger cut at the swap's first return, a later part's skip reason, Bring one back's pin at the press, tokens in their units in the sign window and a session's return, and what's available where part of the private balance is locked.
- `5be0b1b4` (`cca673cd` on `cli/stranger-rows`): the CLI's window and fund rank by what each UTxO brings, and hand core at most 4,000 kinds.
- `b0202c08`: a family run judges each in-package import under its own name, and a replayed trace is dated as Lake judges it.
- `0dce8a6b`: the private swap's e2e waits out the spent step, and the new warning's back-translation.

**Round four,** the final look's 7 (`0198cb3f` to `d89a9360`):
- `9cc81ed5`: the worker records which return wrote a swap's skip reason, and a stopped swap's spent step reads "Filled", not "Cancelled".
- `d89a9360` (`e898095e` on `cli/stranger-rows`): only the holders core will pick come before the kinds budget, and no row cap comes before core's u64 fit.
- `0198cb3f`: test-tools.sh holds every rule it names (50 checks), and tally.py's advice names the step for the package it reads.

## The checks

On the fix branch's final tree, `d89a9360` (the record's commits add only docs), each check under a memory cap, against the counts at the start (`35b339f6`: `main` at `cd764fba` with the folder's first commit):

| Check | At the start | At the end |
|---|---|---|
| `cargo fmt --all -- --check`, clippy `-D warnings` (CI's crates, and core, koios, the CLI and display) | not recorded | clean |
| `cargo test --workspace --locked` | 790 passed, 12 ignored | 962 passed, 12 ignored |
| The parts suite (`payment_parts_shapes_test --ignored`, release) | 0 with problems, 108 refused, 0 Max | the same |
| The WebAssembly's node tests | not recorded | 60 |
| `tsc --noEmit` | not recorded | clean |
| `npm test`, default build | 3,306 passed, 4 skipped | 3,637 passed, 4 skipped |
| `VITE_ENABLE_MAINNET=false npm test` | 3,306 passed, 4 skipped | 3,625 passed, 16 skipped (the swap page's mainnet-only tests) |
| `npm run e2e`, dev build | 109 passed, 1 skipped | 109 passed, 1 skipped (the found-later test, by design) |
| `npm run e2e`, store build (`build:store`, never `npm run package`) | 109 passed, 1 skipped | 109 passed, 1 skipped |
| `npm run e2e:data` | 3 | 3 |
| `LIVE_KOIOS=1 npx vitest run tests/live.test.ts` | — | 2 |

- **The i18n gates:** 112 of 112; the round's 26 new or newly critical keys were each back-translated blind from Spanish and Japanese, and one Japanese value was reworded.
- **The changed e2e test** (the private swap's spent step) passed four times in a row under `taskset -c 0,1` with four workers.
- **`cli/stranger-rows`** (`e898095e`, every CLI fix through round four): fmt clean; 862 passed, 12 ignored; clippy clean.
- **The proofs,** with round three's `check.sh` (`b0202c08`), one family at a time: `test-tools.sh` passes (50 checks, with round four's); `lovejoin` 25 ok and its 5 unlisted imports, `lovejoin-v2` 115 and 12, `lovejoin-any-tx` 143 and 48, `lovejoin-every` 76, `seedelf-every` 28; `./check.sh` 163 ok and 3 imports, with PolicyBurn and PolicyMint failing as the README says. The readers: Seedelf 182 modules, 377 Valid, 19 Expected Falsified, the same two not ok; Lovejoin 310 modules, 475 Valid, 11 Expected Falsified, two not ok (the modules no family builds, *Left open*).

## The live runs

On preprod, with test wallet A restored in a fresh profile each time, on a copy of the fix branch's dev build. Every flow submitted a real transaction and waited for it to confirm (the hashes are in `LIVE.md`, in the folder):
- **On round one's build** (`417fff13`): `run.mjs all`, six flows (a mint paid by the account, a move-in of 25.5 ₳, a stealth mint, a private send of 3.3 ₳, a Make public of 5.5 ₳, a removal), and `run.mjs staking`, four (TPREP, no confidence, always abstain, LOGIC). All confirmed; preprod.koios.rest and www.giveme.my were the only hosts.
- **On the final build's flows** (`0dce8a6b`; round four touched only the CLI, the swap page, a session's record and the proof tooling): the same ten again, all confirmed, the same hosts. Among them, a mint (`c32aa09a…`), the move-in (`fb4a8701…`), the private send (`9b681652…`), the Make public (`12455391…`), the removal (`92116387…`) and the move to LOGIC (`6046bd8e…`).
- **Not run live:** a session's return, a swap and Bring one back, which the fixes also touched. Minswap is mainnet's alone, and test wallet A's held boxes are the owner's to keep, so the fakes and the worker's tests cover those.

## For the owner

When you choose, in order:
1. **The two branches for `main`:** push and open a PR for each, `web-wallet/lovejoin-box-datum-spelling` and `cli/stranger-rows`. SECURITY.md voids a report of what `main` already fixes, and a public PR shows the bug before a release ships the fix, so the timing is yours.
2. **The rest:** push `web-wallet/whole-review` (this record, with every fix merged in) and open its PR into `main`. You can run `/code-review ultra <PR#>` on it as an independent check: only you can start that.
3. **What ships:** a wallet release (1.9.2) and a CLI patch release, each by its own release steps. The privacy policy's 18 November entry goes out with the wallet release.

### ❓ Your calls

Each finding below changes a default, a privacy promise or a rule the owner set, or something only the owner can change (repository settings, the published policy). None is fixed on the fix branch. Each has a recommendation. The verifiers' tests for these are in the folder's `verify/<id>.md` (in git at `TODO-FOLDER`), not on the fix branch. They're grouped so that most can be answered as a batch.

#### 1. Decide first: the four mediums

- **e1a#1** (medium, stranger) `lovejoin.ts:3819`. A stranger's deposit under the wallet's register reads as the wallet's own unmixed box, and Mix my boxes again takes it first, tying the mix session and its private funding to that register. *Recommend:* tell the phrase's own deposits from others' by the deposit's inputs (a one-time account's key or a public account's payment key), record any other as made by a stranger, and leave those out of Mix my boxes again. The callout then says someone else put it in under your key; Bring it back anyway stays its way out. Keep each kept origin with the rule's version (G4's note), as the contract scan's verdicts now are.
- **e6#1** (medium, stranger) `minted-by.ts:124`. A stranger can plant a Seedelf so that Remove preselects the public account and says it links nothing new. *Recommend:* decide "the account paid" only from the account's own spend in its Activity, never from a UTxO or a received entry a stranger can make. Otherwise preselect nothing, as §3.2 decided.
- **r2a#3** (medium, stranger) `build.rs:353`. A stranger's many-token UTxO costs several times its ADA once it's re-made as change, 20 tokens an output, and history-aware selection takes it ahead of money that pays without it. *Recommend:* price what a UTxO adds as its ADA less the change its tokens need; take one that adds less than nothing only when it holds a token being sent, and then last. Pack change by value size rather than 20 tokens an output. Max still spends every UTxO (the owner's 1.6.0 call) unless the owner says otherwise. The CLI's transactions change too: a CLI patch release. The same class: WebAssembly's `measured_or_more` and `Worth::adds`, the short message's Max figure, and the CLI sweeps' dusting (§7).
- **gap-g1#1** (medium, stranger) `activity.ts:389`. A payment under a register already on chain (a Seedelf's own, d = 1, or a copied datum) is classed Received, and the stealth mint, every session funding and the private pool start take it first, which ties them to that Seedelf publicly. *Recommend:* part (a) now: key each spendable UTxO by its register and match it against the kept view (no request); a match is already tied on chain, so give it the matched row's class. Part (b), moving the stealth mint to take a box ahead of received money, is a design call; leave it unless the owner wants it.

#### 2. Refusals the ledger doesn't make (the 2026-10-19 rule)

Each of these refuses something the ledger and the contracts take. Most were chunk choices made before the owner's rule, so the rule says to put them to the owner. *Recommend for all of them:* drop the refusal. Where the choice is risky but valid, a short line on the review says so, at most.

- **r2a#1** (low) `build.rs:3280`: a key address whose stake part is a script is refused as a script's address. Test the payment part only. Byron stays refused unless the owner says otherwise (key-spendable, rare).
- **e7b#1** (low) `staking.ts:539`: delegating again to the pool or DRep Koios already names. Drop it; the review can say "Already your pool: this only costs a fee".
- **e7b#2** (low) `Governance.tsx:165`: a DRep profile's address must start http(s):// or ipfs://. Keep only the ledger's 128 bytes; the scheme becomes a line under the field.
- **gap-g8#1** (low) `label.ts:10`: a Seedelf's tag must be printable ASCII. Count UTF-8 bytes up to 15 and refuse only control characters. The name's display already cleans bidi and invisible characters.
- **gap-g8#2** (low) `send.ts:179`: Send refuses the user's own Seedelf. Take it as Transfer does: the review says it comes back into the private balance, and its history is recorded as made private (so gap-g1#2's misreading can't follow).
- **gap-g8#3** (low) `note.rs:49`: a note is cut to 64 characters. Raise it to a few hundred, written as CIP-20's 64-byte lines. Keep "anyone can read it".
- **gap-g8#4** (low) `recipients.ts:7`: at most 20 recipients. Raise it to 100 and let core's too-large refusal say what doesn't fit.
- **gap-g8#5** (low) `cbor.ts:123`: a site's transaction whose outer array or body map is written indefinite-length. Accept both in cbor.ts. WebAssembly's witness-set readers are the same class, lower priority.
- **gap-g8#7** (low) `sessions.ts:836`: swap slippage outside 0.1% to 20%. Take any 0 < s < 100 (or Minswap's own range), keep the 5% warning and add a stronger line past 20%.
- **gap-g8#8** (low) `sessions.ts:1919`: a swap into a token neither listed nor verified by Minswap. Put Review behind a "Swap into it anyway" switch, as the sign window's release warning does; the worker checks the switch.
- **gap-g8#6** (low) `lovejoin-launch.ts:258`: a pool's start refuses a box value between the box's own minimum and S0d's least. Decide with gap-g5#1 (§3): with (b), this becomes the same line on the launch review.

#### 3. Lovejoin and the private sessions

- **gap-g5#1** (medium→low, pool launcher) `lovejoin-pools.ts:530`. A pool someone else launched with a box under S0d's least is shown, picked by default and offered with no word, and what comes back from it can't pay part of itself without other money. *Recommend:* (b), as call 34 and the 2026-10-19 rule have it: treat it like any pool, and flag it on the hub, the pool's page and every review that names it. Also never pick it by default while a pool that pays its way back exists.
- **e2b#1** (low, stranger) `sessions.ts:1309`. A stranger's payment to a finished mix's one-time account, before the session closes, starts a second Mix again chain over the user's boxes unasked, or marks the finished mix "Not mixed". *Recommend:* end a mix's Lovejoin once any chain of it went in, as L17 did for stopped mixes: a later arrival comes back directly. Write `mix.skipped` only from the mix's own return.
- **e7a#2** (low) `Swaps.tsx:2451`. Stop's dialog says the swap comes back directly while its cost is unread or the read failed, and Stop then brings it back through Lovejoin, as approved. *Recommend:* in those states say it comes back as approved (through Lovejoin), never the direct words. Keep Stop enabled.
- **gap-g2#1** (low) `lovejoin.rs:2495`. Mix again from my public account refuses unless one ADA-only UTxO pays for every mix of every box. *Recommend:* (a): mix as many boxes as the largest ADA-only UTxO pays for, and the review says the rest wait.
- **gap-g2#2** (low) `Lovejoin.tsx:1128`. The escape hatch's question names no other account while the account on screen's boxes are reserved, and the worker then takes another account's box. *Recommend:* (a): the request carries whose box its question named, and the worker asks again when its pick is someone else's. It does what the question said, nothing more.
- **gap-g3#1** (low) `privacy.md:440`. Only a withdraw waits after the wallet's own send, but privacy.md says the way back never lines up with anything else the wallet does. *Recommend:* (b) now, so the promise is true: say what the code does. (a), every automatic sender waiting after a withdraw, can be its own chunk if the owner wants the stronger promise.
- **gap-g4#2** (medium→low) `sessions.ts:4170`. Nothing stops a swap Minswap builds from spending the session's 5 ₳ collateral; the return then leaves out Lovejoin and the collateral's mix. *Recommend:* look first whether any session swap on chain ever spent its 5 ₳ (one lookup). If so, let the return's chain put up any ADA-only UTxO of 5 ₳ or more, paying an exact 5 ₳ tail first. Name the swap in privacy.md:458's list either way.
- **gap-g9#2** (low) `lovejoin.ts:6852`. Lovejoin's way-back rules are per browser profile: with the phrase unlocked in two, each brings back the other's boxes on its own schedule. *Recommend:* say so in privacy.md and architecture.md now (with the separate-profile advice at privacy.md:349). Holding the rules across profiles can wait.
- **e8b#1's residue** `coin-control.ts`. The fix stops the automatic pick and the Set candidate from taking a stranger's 5 ₳ that carries a reference script or a datum. A 1.9.1 user who already pressed Set on such a UTxO keeps it, and public Lovejoin builds keep failing for them. *Recommend:* give the saved choice the rule's version, and treat a version-less choice that fails the collateral rule as no choice, for the wallet's own builds only; sites still get what the user chose.
- **G4's note** `sessions.ts`. Settings' collateral switch (`collateralIntoPool`) is read when the chain is built, for mixes and swaps alike, so a change in Settings doesn't reach a chain already built. *Recommend:* leave it, and say so beside the switch if the owner wants.

#### 4. What the wallet calls the user's own

- **gap-g9#1** (medium→low) `activity.ts:445`. With the phrase open in a second profile, every private transaction made there reads here as a payment received, and this profile's fundings take that money first. *Recommend:* yes on mainnet: an arrival made by a transaction that spent one of the wallet's own rows is the phrase's own spend elsewhere, classed as unknown, never received. On Koios-only reads, say it in privacy.md.
- **gap-g1#2** (low, site) `dapp.ts:2644`. A site's payment from the user's own account or session into the user's Seedelf is classed Received. *Recommend:* note those outputs in the Seedelf history as made private from that account or session. It keeps a new record, so the privacy policy gets a dated Changes entry in the same PR.
- **x1a#2** (low, site) `cip30.rs:1386`. The sign window says a site's payment into a Seedelf hides whose it is without checking the register. *Recommend:* check it against the kept view, with no request, and warn when the register is already on chain. Without a kept view, don't claim it. privacy.md:336 changes with it.
- **l3sign#1** (low, site) `tx-view.ts:332`, from the last look. A site's payment under the user's register whose output carries a reference script reads as a plain Seedelf payment in the sign window, with no warning, and Transaction details says "Yours, in your private balance". But the balance leaves such a row out, and no web-wallet spend takes it: the evaluator can't run with a reference script. It's older than 1.6.0. *Recommend:* r2sign#1's class: a payment is called a Seedelf's only where the wallet reads it. Give such an output its own reading and a short warning in the UTxOs page's words ("Seedelf Wallet can't spend it yet"), and the same in Transaction details, pinned in the register-spellings vectors. New critical strings, so a back-translation.
- **e9a#4** (low) `Activity.tsx:126`. Public activity's Save as CSV note says the file holds nothing the chain doesn't, but its rows name the user's own Make private and Make public. *Recommend:* write those rows in the public file as the chain reads them (sent to or received from the contract), so the note stays true.
- **e4a#1's residue.** The fix ties each reading to its phrase. Receipts of another phrase that the old Remove-and-restore race already sealed into this profile's history stay in Activity until a Remove and restore. *Recommend:* leave them; this was a narrow race, and Remove and restore clears it.
- **Each failed Send burns a session index** (E2a's note, via the critic). Twenty to thirty-nine turned-away Sends in a row, during a giveme.my outage say, hide every later session from a restore's scan, and their money from the wallet. *Recommend:* take the next index only once a funding is sent, or widen the restore's gap past the most indices one profile can burn. Worth a chunk of its own.

#### 5. The connector

- **e3b#3** (low) `DappApprovals.tsx:626`. While a sent private-session funding waits, every request behind it is hidden: no count, no Decline all, and closing the window declines them unseen. *Recommend:* show the queue line and Decline all on the funding's screen. It adds nothing the user must do.
- **w2#4** (low, stranger) `cip30.rs:287`. getUtxos drops a UTxO's reference script, so a site spending it underpays the Conway fee and the node refuses it. *Recommend:* hand the site the output as it is on chain, its reference script included.
- **w2#5** (low, stranger) `cip30.rs:348`. getBalance fails for every site once a stranger's token total passes a u64. *Recommend:* cap that token at u64::MAX, CIP-30's own ceiling.
- **G5's notes.** (1) Once an earlier request's error is hidden, the next request's screen doesn't say it failed: a one-line note would need words. (2) The window reads a transaction's note without checking it against the body's metadata hash: a mismatch line would need words. Transaction details, in the same window, already warns; the docs now say so (r2docs#2). *Recommend:* (2) yes, a short warning when the note isn't the transaction's; (1) leave it.
- **G6's note.** `gone()` doesn't count a page that leaves before answering as a decline, so a site can escape the back-off (L35) by reloading. *Recommend:* count it as a decline.

#### 6. Screens and lists

- **e9a#1** (low) `Home.tsx:572`. A token's details offer Send or Make private/public for a token with no spendable units, and the form drops it silently, with Review greyed and no reason. *Recommend:* the form names why (locked, or on its way back) and Review waits with that reason, in all four forms.
- **w1a#1** (low) `lib.rs:4062`. Max in parts never checks that the named tokens are held. *Recommend:* refuse in core's words ("The Seedelf balance holds only …"), as one-transaction Max did. The payment can't be built, so the 2026-10-19 rule doesn't apply.
- **gap-g8#9** (low) `build.rs:3898`. A Seedelf mint from the public account fails when its largest ADA-only UTxO sits past output #255. *Recommend:* yes, no product question: never put such a UTxO first alone.
- **gap-g7#1** (low, stranger) `format.ts:438`. A DRep that names itself Always abstain (or another built-in choice) reads as that choice on the vote review, in Activity and in Delegations. *Recommend:* never let a DRep's own name stand alone on the review's main row ("DRep · name"), and treat a name like a built-in label as shared, so the card warns.
- **gap-g7#2** (low) `dreps.mjs:96`. The bundled DRep list ignores CIP-119's doNotList, which the wallet's own profile form turns on by default. *Recommend:* honour it. Pasting an ID still works.
- **The recovery phrase and Chrome Translate** (E9b's new fact on C22). With *Always translate* on, in a language the wallet doesn't speak, Chrome sends the 24 words to Google, and a backup copied from translated words would be wrong. The owner's C22 call (2026-10-06) keeps Translate on and discloses it; that disclosure names balances, addresses and Seedelf names, not the phrase. *Recommend:* `translate="no"` on the phrase's grid alone, everything else as C22 has it. Raised only because this is new: the secret itself, not the page.

#### 7. The CLI

- **r4#8** (low) `mint.rs:76`. `util mint -g -p` writes the given register unchanged, so Seedelfs minted for one person from their `util base` register are visibly theirs. *Recommend:* re-randomize it, as `create` does (the private default). The README row changes with it.
- **r4#5's last part** (low) `web_server.rs:97`. The fixed part: the server binds first, each run has a path of its own, and the page and terminal show the transaction id. The open part: the page refusing an earlier run's transaction. *Recommend:* leave it. An old page can't reach the new run's path, and what it still signs is the earlier run's own transaction, under its id.
- **The CLI fixer's notes.** (1) Dusting: when the rest's ADA can carry a stranger's token pile, both sweeps carry it, which puts about 46 ₳ of the user's own ADA into 30 junk outputs (`external sweep`) or about 30 ₳ (`sweep --all`); with fewer than 20 better UTxOs, `sweep --all` still carries piles on the user's ADA. (2) and (4), the window's order and what it takes first, are settled by r2cli#1's fix (e6d6a18d): every owned UTxO, the refused ones out, the sent token's holders first, the rest by worth. (3) `sweep --all` still spends UTxOs holding a reference script, which Ogmios evaluates. *Recommend:* (1) leave such a pile behind, as the web wallet's return does (r2a#3's class). (3): keep as it is.

#### 8. Docs and the privacy policy

- **d1#1** (low, site) `privacy-policy.md:79`. The policy and privacy.md say the CIP-30 entry goes only on https pages; it also goes on every http://localhost and http://127.0.0.1 page. *Recommend:* correct the words ("https pages, and pages served from this computer"), with a dated Changes entry and the store README's line. Keep localhost: dApp developers test there.
- **d1#2** (low) `privacy.md:369`. The dApps page reads every open session's account together each time it opens, which privacy.md puts on the Swaps screen alone and the policy never says. *Recommend:* correct privacy.md and architecture.md:665, and add the policy line with a Changes entry.
- **d1#7** (nit) `privacy-policy.md`. The policy's ADA Handle row covers only a withdrawal; a public Send to a $handle asks the server too. *Recommend:* add Send to the row, with the Changes entry.

#### 9. Build, CI and release

- **b1#2** (low) `build.sh:61`. build.sh never checks or records which Rust built the module, and the second build shares the first's shell. *Recommend:* yes to printing `rustc -vV` beside the C compiler, and to running the second build under `env -i`. No refusal is needed, since the record shows any difference.
- **b1#3** (low) `release.yml:24`. The CLI's build jobs hold the GPG release key, its passphrase and a write token beside every crate's build code. *Recommend:* yes: one sign-and-publish job behind a `release` environment the owner approves, as the data layer's deploy is. Only the owner can make the environment; the workflow change can follow.
- **The diag scan's LOOK rows** (r2verif#4's fix, `Audit/diag/scan-diag.py`). The scan now exits 1 on any LOOK row, and the scanner flags every query that recurses over Nat as LOOK on purpose, so `run-all.sh` lists diag as failed on every full run, the rows the audit checked by hand included, as `check.sh` lists PolicyBurn and PolicyMint. *Recommend:* an accepted list beside the scan (`Audit/diag/accepted.txt`: each hand-checked row, why, and when), so only a new LOOK fails. Each entry is a claim about a proof, so each is the owner's to approve.
- **v3#2** (low) `web-wallet.yml:67`. CI skips the proven-bytes test on a PR that changes only the .hex files it reads. *Recommend:* (b): a small job that runs only that test when `seedelf-verification/**/*.hex` changes, so verification PRs stay fast.
- **G8's notes.** releases.md could say old tags rebuild their zips under `LC_ALL=C.UTF-8`; a `.github/dependabot.yml` would watch the pinned actions; web-wallet.yml's `covered` filter matches only itself, so a PR editing another workflow skips workflows.test.ts until main's run; tokens.mjs and dreps.mjs sort with `localeCompare` and no locale. *Recommend:* the LC_ALL line and the `covered` filter yes; dependabot only if the owner wants the PR traffic; the sort is harmless (a refresh's diff only).

#### 10. Outside the chunk: the data layer

- **seedelf-data's copies of two fixed readers.** Its `is_mix_datum` takes tag 121 alone, and its credential index may not tell key rows from script rows. These are r3a#1 and x2#1's twins on the server. The wallet now reads both right whatever the server says, but the server's crowd count can be off. *Recommend:* fix both in seedelf-data and deploy through the deploy workflow, as its own PR.

## Left open

In [backlog.md](../../backlog.md), from this review:
- **The owner's calls above,** one ❓ line a group, with their IDs.
- ⬜ **Core's token sums are quadratic in their kinds** (l3cli#3's root): `fitting` and `Assets::add` clone the whole list for every token. The CLI's windows now bound what they hand core, but the web wallet's private sends still run it over every owned UTxO, so a stranger's many-token piles under the user's register slow each one. Not measured in the WebAssembly.
- ⬜ **Two Lovejoin AnyTx modules no family builds** (l3tests#3's note): `Lovejoin.AnyTx.LogicOwnerParserReach` and `LogicOwnerPrefix` are in no `check.sh` list and no listed module imports them, so no run builds or judges them, and `tally.py` reads them not ok.
- ⬜ **A swap keeps one skip reason** (l4worker#1's limits): a late leg's direct return after a swap's own return that had its own reason replaces it, so the page reads it as a later part's and the swap's own words are lost; and a direct return rebuilt under a new hash with no reason leaves the old hash named. A reason kept per return would close both.

Recorded, not backlog lines:
- **w2#3** wasn't verified: the model's safety filter stopped its trace verifier. Its fix stands on its own test.
- **The swap page's "Stopped after N of M"** for a cut own chain is lost when a later chain exists (G7a's note): what it says instead is still true.
- **Two of the worker's writes after a pool read** (lookUp's and sortOut's) aren't pinned to their phrase: G4 found no wait a Remove and restore could fall into there.
- **Not run in the final checks:** `seedelf-slice`, since Slice didn't change and its first build here would fetch and compile its dependencies; and the audit families, so `count.py` reads their 178 modules STALE until `Audit/run-all.sh` replays them.

## Lessons

- **Every fix round broke something where two fixes meet, again.** Round one's keyset paging (r1#1) made the CLI's worst bug of the review (r2cli#1, high). Its sign-window readings made the window reassure where 1.9.1 warned (r2sign#1). Round two's wait for a late leg (r2still#2) made every swap's page wrong for up to a minute after its fill. Round three's kinds budget let a stranger's piles crowd the user's ADA out again (l4cli#1). Each review of the fixes found fewer, and smaller: 28 above a nit, then 14 lows, then 5 lows and 2 nits. Plan to review the fixes until a round finds nothing above a low, not once.
- **No window takes its order from a key a payer chooses.** Koios's `tx_hash` order, the amount of a token held, "ADA alone first": each let a stranger, or the user's own change, decide which UTxOs a spend may draw on. Rank by what each brings to the spend, with what the spend refuses left out.
- **A payment is called a Seedelf's only where its wallet reads it.** Three of the sign window's readings (a register's general form, a datum kept by hash, and, still open, a reference script) said "a Seedelf payment" for an output no Seedelf Wallet lists or spends. One vector set now holds the readers together.
- **A fixer who can't run Playwright can rename a control unseen.** Two rounds broke the e2e: a lookalike token's picker name, and a swap's extra runner step. The lead runs the e2e after each round, and a fixer greps the e2e for any name or words it changes.
- **Run new tests in both builds.** Nine of round one's tests assumed a mainnet build.
- **A guard read at the wrong moment pins the wrong state.** The phrase pins moved from the readings to the writers, which check their own turn; the late leg's wait became a time, not a count of runs.
- **A claim from memory needs a run.** Both of the critic's unchecked claims held, but only a run showed it: the ledger's own decoder, and a probe of the stack.

## The IDs

The code, the tests and the docs cite these by ID, as "chunk 51, <id>". Their full text is in git at `TODO-FOLDER`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-51/`: each family's report is `lanes/<lane>.md`, its data `data/<lane>.json`, and each verdict `verify/<id>.md`.

| IDs | What |
|---|---|
| `r1#` to `r4#`, `r2a#`, `r2b#`, `r3a#`, `r3b#` | the Rust crates' lanes |
| `w1a#`, `w1b#`, `w2#`, `w3#` | the WebAssembly's |
| `e1a#` to `e9b#` | the extension's |
| `b1#`, `d1#` | the build and CI; the outward docs |
| `v1#` to `v5#`, `v4a#`, `v4b#` | the proofs' |
| `x1a#`, `x1b#`, `x2#`, `x3#`, `x4#` | the cross lenses |
| `t1a#` to `t1l#` | the guards no test pinned |
| `critic`, `gap-g1#` to `gap-g10#`, `lead#` | the completeness critic, its gap round, the lead's own |
| `r2money#`, `r2sign#`, `r2time#`, `r2cli#`, `r2tests#`, `r2screens#`, `r2verif#`, `r2docs#`, `r2still#` | the review of the merged fixes |
| `l3money#`, `l3time#`, `l3sign#`, `l3screens#`, `l3cli#`, `l3tests#`, `l3still#` | the last look |
| `l4cli#`, `l4worker#`, `l4tools#` | the final look |
| `G1` to `G10` | the fixers' groups (FIX.md) |

Mind the two R2s: `r2a#` and `r2b#` are round one's core lanes (`build.rs` and the rest of core), `r2<lens>#` the review of the merged fixes.
