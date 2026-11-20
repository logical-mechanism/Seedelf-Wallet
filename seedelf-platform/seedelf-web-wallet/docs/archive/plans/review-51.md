# Chunk 51's whole-code review of the platform and the proofs (2026-11-18)

**Status: ✅ done, and the owner's calls answered and built.** The owner answered the review's 55 calls on 2026-11-18, and nine rounds of fixes built them, each of the first eight reviewed before the next ([The calls round](#the-calls-round)).
- **For `main` first, each on its own,** since SECURITY.md voids a report already fixed on `main`, and a public PR shows the bug before a release ships the fix. Both are merged:
  - #389, `web-wallet/lovejoin-box-datum-spelling`: r3a#1 (high) and x2#1, as `509197f0`;
  - #390, `cli/stranger-rows`: every CLI fix of the review's own rounds, as `2e47390b`.
- **`web-wallet/whole-review-fixes`,** which holds `web-wallet/whole-review` (this record, the plan's move to the archive and the backlog's lines): every fix and every call, and 1.9.2's version, lists and store images (`26794c40`, `88e1c84d`). Its PR into `main` is next. Merging `main` into it changes no file.
- **What ships, in order:** CLI 0.8.0, then the wallet's 1.9.2, which carries the privacy policy's 18 November entry. The rest is the owner's ([For the owner](#for-the-owner)).

The working folder, `docs/plans/review-51/`, was compressed into this file. Its full text is in git at `009c4ab4`:
- the agents' brief (`COMMON.md`), the lanes (`LANES.md`) and the fixers' brief (`FIX.md`);
- every lane's and lens's report (`lanes/`), each finding's verdicts and the verifiers' tests (`verify/`);
- `INDEX.md`, every finding on one line, and `FINDINGS.md`, every finding by what became of it;
- the counts at the start (`BASELINE.md`), the high fixes' branches (`fix-branches.md`) and the live runs (`LIVE.md`);
- the data and the tools that made them (`data/`, `tools/`).

The calls round's files went into git beside it, under `calls/`, in one commit, `64b63458`, just before this record's, which removes them again:
- the fixers' brief (`BRIEF.md`), and each call with the re-check's reading and the owner's answer (`DECISIONS.md`);
- the re-check (`recheck.json`), and each round's fixer groups' answers (`round*.json`);
- each review's findings with their verdicts (`review*.json`), and, from the third review on, the tests its verifiers kept apart (`review<N>/`);
- what each blind back-translation read (`bt*/`).

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
8. **The owner's calls round:** a re-check of the 55 calls on the code, the owner's answers, then nine rounds of fixes by file ownership, test first, the first eight each reviewed by lenses and verified by stakes, with no tiebreak, before the next ([The calls round](#the-calls-round)).

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
- **The owner's** (43): the owner decided all of them in the calls round, with 12 more calls beside them, notes, residues and follow-ups ([The owner's calls](#the-owners-calls)).

### The highs and the mediums

| ID | What | Outcome |
|---|---|---|
| **r3a#1** (high) | A stranger's mix can write the user's Lovejoin box datum as constructor 0's general form, which the contract accepts and the wallet no longer saw as a box | fixed, `0c965ff8` (`e2b31e6f` for `main`) |
| **r4#1** (high) | A stranger freezes any CLI external wallet: three junk rows overflow `external sweep`'s and `external balance`'s token sums forever | fixed, `64379c03` (`027fc81b` for `main`) |
| **r2cli#1** (high, made by round one) | Keyset paging read the contract in `tx_hash` order, which a payer chooses, so 20 of a stranger's piles took every slot a CLI spend draws on | fixed, `e6d6a18d` (`d8114f19` for `main`) |
| **x2#1** (medium) | A stranger's 5 ₳ at a key address carrying mix_box's hash counted as a pool box | fixed, `d2a7278d` (`fcdacc50` for `main`) |
| **r4#2** (medium) | Three junk UTxOs under the user's register broke the CLI's `balance` for good | fixed, `64379c03` (`027fc81b` for `main`) |
| **r4#4** (medium; r1#2 the same) | A submit the CLI couldn't confirm read as a plain failure, so running the command again could pay twice | fixed, `48a4c977` (`82078f10` for `main`) |
| **e1a#1** (medium) | A stranger's deposit under the wallet's register reads as the wallet's own unmixed box | the owner's call, built: `14340370` ([The owner's calls](#the-owners-calls)) |
| **e6#1** (medium) | A stranger can plant a Seedelf so Remove preselects the public account | the owner's call, built: `ca0db88c` |
| **r2a#3** (medium) | A stranger's many-token UTxO costs several times its ADA once re-made as change, and selection takes it first | the owner's call, built: `523690c8` |
| **gap-g1#1** (medium) | A payment under a register already on chain is classed Received and taken first by the stealth mint and the fundings | the owner's call, built: `d46533dd`, `523690c8`, then narrowed |

### The calls round's reviews

Each round of the calls round was reviewed, merged, before the next: lenses that each read the whole round, then a trace for each medium and low, and an impact verdict too for each medium. No tiebreak ran: a finding counts as refuted where its trace didn't hold, whatever its impact verdict said. Severity is the finder's, or the trace verifier's where it graded lower.

| Review of | Lenses | Medium | Low | Nit | Refuted | All |
|---|---|---|---|---|---|---|
| round one | money, own, sign, time, cli, docs, still | 11 | 16 | 13 | 5 | 45 |
| round two | rank, sign, time, docs, still | 4 | 12 | 11 | | 27 |
| round three | rank, time, misc, docs, still | 4 | 10 | 10 | | 24 |
| round four | code, docs, still | 3 | 9 | 8 | | 20 |
| round five | merge, words, still | 1 | 8 | 7 | 1 | 17 |
| round six | merge, reference, words, still | 5 | 9 | 6 | | 20 |
| round seven | merge, reference, words, still | 3 | 11 | 8 | | 22 |
| round eight | merge, reference, words, still | 4 | 8 | 7 | | 19 |
| **rounds one to eight** | | **35** | **83** | **70** | **6** | **194** |

Round nine had no review of its own: by then the reviews cost more than they found, and the owner's budget was near its end (2026-11-19). Chunk 52 starts by reading its diff.

- **None of the first six found a high.**
- **The sixth found more than the fifth:** 5 mediums, all in round six's own design for a token pool's way back and in its search. A sixth, l6words#3, counts as a low, the finder's grade, though its trace verifier raised it to a medium. Round seven took them all ([The calls round](#the-calls-round)).
- **Refuted** (6): money#2, money#5, docs#6, still#3 and still#4 in the first, l5still#1 in the fifth. money#2's trace verifier found the tie it names older than round one, not made by it, and its impact verifier held it: the owner's answer 2 ([The owner's calls](#the-owners-calls)) closed it in round two (`9f8df1b1`). own#1's impact verifier read its tie as older than round one too, but its trace held, so it counts as a medium.
- **Of the first five reviews, every confirmed finding was fixed in the round after its review,** but three: time#4, kept ([The lead's calls](#the-leads-calls)); l2docs#2, which this record answers; and l3rank#4, about three commits' order (*Left open*).

## The lead's calls

- **V1 and V2 ran here as chunk 49's step 4,** by the start call. V1 found nothing: Seedelf's readable definitions accept exactly what `wallet.ak`, `seedelf.ak`, `schnorr.ak` and `token_name.ak` do, clause by clause. V2 found two docstring nits in Lovejoin's, fixed (`40883a55`). Chunk 49's plan marks the step done.
- **The highs went to their own branches from `main` as they landed,** so each could be its own PR: #389 and #390, both merged.
- **r2sign#1 was fixed though flagged for the owner,** as the round's own regression: round one's reading made the sign window reassure ("It pays a Seedelf") where 1.9.1 warned, for two shapes no Seedelf Wallet reads. Its tiebreak graded it low.
- **gap-g6#2's fix keeps more on the device** (a Lovejoin origin keeps its transaction's input keys, encrypted), so the privacy policy has a dated Changes entry, 18 November 2026, in the same branch. r2docs#5's re-reads after an update needed none: the snapshot is a whole-contract read the policy lists, and tells the server less than a delta read.
- **r2still#2 was fixed forward after the last look, not reverted:** its one-run wait read as a swap still filling, with Stop offered. Round three made the wait timed and the page say what's happening.
- **l3sign#1 went to the owner:** older than 1.6.0, and its fix adds critical words. The owner said yes, and the calls round built it (`5d78d9c4`).
- **The last look's findings were verified by their fixers' failing tests,** as 1.9.1's last look was, not by separate verifiers. R2tests' and T1's are of that kind already: each is a guard no test caught.
- **Two of the critic's claims nobody had checked, the lead checked** (below).
- **In the calls round, money#2 was built** though its trace verifier refuted it: the tie it names is older than round one, so not the round's, but the owner's answer 2 closes it.
- **time#4 was kept:** a 1.9.1 deposit answer asked about again is held as unsure until Koios answers, not counted as someone else's, as e1a#1's amended text had it. Either keeps the box out of a mix from the private balance, and unsure is what's true of the user's own past deposit.
- **l3rank#1 went in words only:** a Make public that 1.9.1 sent to the user's own account reads as change, as answer 5 has it.
- **money#4's fix is the lead's reading of B3:** a 1.9.1 collateral choice the rule refuses isn't held for the wallet's own builds, which put up their own 5 ₳ and spend the choice like any UTxO. Sites still get it.

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

## The owner's calls

The review left the owner 55 calls: its 43 findings that change a default, a privacy promise or a rule the owner set, or that only the owner can change, and 12 notes, residues and follow-ups beside them. Each finding's verdict and its verifiers' test are in the folder's `verify/<id>.md` (at `009c4ab4`); each call's re-check and answer, in the calls folder's `DECISIONS.md`. The owner answered on 2026-11-18:
- **A, 40 calls,** 26 whose answer a rule of the owner's gives and 14 that ask no product question: yes, as the re-check amended each.
- **B, 16 questions,** B1 to B16: the 13 calls of judgment, and three side questions on A calls (B14 on r2a#3, B15 on gap-g1#1, B16 on r2a#1). Each recommendation, but the other option, (b), for B1, B8 and B15.
- **C, two the owner does by hand,** C1 and C2.
- **Five later answers,** to the calls round's reviews, under the table.

The letters and answers are the calls round's own, as the code cites them ("the owner's B16", "the owner's answer 4 to B15"): not lane B1 (`b1#`), T1i's guards, or 1.9.1's clusters C1 to C3. **Partial** marks a call its fix built only in part, its rest a backlog line. A backlog line beside *Built* is an option the owner's answer left for later.

| Call | What | The owner's answer | What became of it |
|---|---|---|---|
| **e1a#1** (medium) | A stranger's deposit under the wallet's register read as its own unmixed box | Yes: the phrase's own only where an input of its deposit was under one of the phrase's keys; Mix my boxes again leaves anyone else's out | Built, `14340370`. The hatch asks about such a box first (time#2, `9055807f`), one its depositor mixes themselves is said in words (own#3, answer 3), and its way back is a box of unknown making (l2rank#1, `d2042f44`). A 1.9.1 answer asked about again is held as unsure, not as someone else's (time#4, kept) |
| **e6#1** (medium) | A planted Seedelf made Remove preselect the public account | Yes: "the account paid" only from the account's own entry with a fee | Built, `ca0db88c`; one class with e1a#1 in architecture.md (still#10, `a7f3eed6`) |
| **r2a#3** (medium) | A stranger's token pile taken first, at several times its ADA | Yes: weigh each UTxO by its ADA less its tokens' least; one that adds less than nothing goes last, never left out. **B14** (a): packing change by value size waits | Built, `523690c8`; a token box weighed the same way (`7cefcb59`). The packing is a backlog line (*Change and deposits go 20 tokens to an output*) |
| **gap-g1#1** (medium) | A payment under a register already on chain taken first by the stealth mint and the fundings | Yes to the words and (a). **B15** (b): the stealth mint takes a box back from Lovejoin first | (a) built, `d46533dd`. (b) `523690c8`, narrowed by answers 2 and 4 to a box the wallet recorded a mix moving, never a copy, change or a box no mix moved (`9f8df1b1`, `5447f7e5`), then one rule for a box's way back (`d2042f44`) |
| **r2a#1** | A key address staked by a script refused as a script's | Yes: test the payment part. **B16** (a): Byron refused in true words; a script's payment part paid, after a warning | Built, `63cd92fb`; `sweep --ada-handle` too (cli#2, `30c46558`) |
| **e7b#1** | Delegating again to the pool or DRep already chosen refused | Yes: take it; a note says so | Built, `5ea278be`, `69d001e8` |
| **e7b#2** | A DRep profile's address held to its schemes | Yes: only the ledger's 128 bytes | Built, `5ea278be` |
| **gap-g8#1** | A tag held to printable ASCII | **B1** (b): keep the rule; reword its two lines | Reworded, `5ea278be`, the Japanese again at its back-translation (`75956e22`). Declined in the backlog |
| **gap-g8#2** | Send refused the user's own Seedelf | Yes: take it, recorded as made private | Built, `ca0db88c`; its history pinned to its phrase and written first (own#6, `c3d976cc`; l2time#4, `9d512644`) |
| **gap-g8#3** | A note cut to 64 characters | Yes: 500, in CIP-20's 64-byte lines | Built, `63cd92fb`; Activity keeps it whole (still#5, `11530d82`) |
| **gap-g8#4** | At most 20 recipients | Yes: 100, and core's too-large refusal in the user's words | Built, `63cd92fb` |
| **gap-g8#5** | A site's transaction in indefinite lengths refused | Yes: read both, as the ledger does | Built, `eedd4965`; a redeemer's inner lists too (sign#2, `0f1d9d27`) |
| **gap-g8#7** | Swap slippage held to 0.1% to 20% | Yes: any 0 < s < 100, with a stronger line past 20% | Built, `82420d77`, once Minswap's estimates took 0.05% and 25% |
| **gap-g8#8** | A swap into a token Minswap doesn't verify refused | Yes: Review behind a "Swap into it anyway" switch | Built, `82420d77` |
| **gap-g8#6** | A pool's start refused under S0d's least | **B2** (a): refuse only under the box's network minimum; S0d's least a warning | Built, `26f6938e`, `69d001e8` |
| **gap-g5#1** | A pool whose boxes can't pay part of themselves, unflagged | Yes: (b), used as any pool and flagged wherever it's named | Built, `26f6938e` |
| **e2b#1** | A stranger's payment to a finished mix's account set off another chain | Yes: a mix's Lovejoin ends once its chain went in | Built, `82420d77` |
| **e7a#2** | Stop's dialog said "directly" while its cost was unread | Yes: its hedged words then | Built, `82420d77` |
| **gap-g2#1** | Mix again from the public account needed one UTxO for every mix | Yes: (a), as many boxes as the largest pays for | Built, `26f6938e`; (b), several fee inputs, is a backlog line |
| **gap-g2#2** | The hatch's question named no other account, then took another's box | Yes: (b), reserved boxes left out, and (a), asked again | Built, `26f6938e`; a box no record names is asked about first (time#2, `9055807f`) |
| **gap-g3#1** | privacy.md promised the way back lines up with nothing else | Yes: (b), say what the code does | Built, `02b9c1fe`; (a), every sender waiting, is a backlog line |
| **gap-g4#2** | A swap can spend its session's 5 ₳ collateral | Yes: say so, and fix the return once a session swap is seen spending it | **Partial:** the words, `82420d77`. No record names a swap to look at, so the fix is a backlog line (*A swap that spends its session's 5 ₳ collateral*) |
| **gap-g9#2** | The way-back rules are one profile's | Yes: say so in privacy.md and architecture.md | Built, `02b9c1fe`; holding them across profiles is a backlog line |
| **e8b#1's residue** | A 1.9.1 Set on a stranger's 5 ₳ kept public builds failing | **B3** (a): for the wallet's own builds, a choice the rule refuses counts as none; sites keep it | Built, `82420d77`; the forms count what the builds keep (money#4, still#6, `11530d82`; l2still#3, `9d512644`) |
| **G4's note** | The collateral switch is read when a chain is built | **B4** (a): leave it | No change. Declined in the backlog |
| **gap-g9#1** | Another profile's private spends read here as payments received | Yes: on mainnet, one that spent the wallet's own rows is its own; Koios-only reads said in privacy.md | **Partial:** built, `d46533dd`, kept in the sealed history (own#5, docs#3, `c3d976cc`). A box another profile brings back still reads as received: a backlog line (*A box another profile brought back reads as received here*) |
| **gap-g1#2** | A site's payment from the user's own account into the Seedelf classed received | Yes: noted as made private, with the policy's entry | Built, `d46533dd` |
| **x1a#2** | The sign window said a site's Seedelf payment hides whose it is, unchecked | **B5** (a): drop the claim; warn where the kept view has the register on chain | Built, `5d78d9c4`; from the bytes it signs (sign#1, `0f1d9d27`) |
| **l3sign#1** | A payment under the user's register with a reference script read as plain | Yes: its own reading and a warning | Built, `5d78d9c4` |
| **e9a#4** | The public CSV's note said it holds nothing the chain doesn't | **B6** (a): keep the rows' names; reword the note | Built, `ca0db88c` |
| **e4a#1's residue** | Another phrase's receipts the old race sealed in | Yes: leave them | Left, and declined in the backlog; the reading's pin now reaches `arrived()` (`d46533dd`) |
| **Each failed Send burns a session index** (E2a's note) | Twenty turned-away Sends hide later sessions from a restore | Yes: the docs now, the index freed in a small chunk | **Partial:** the docs, `82420d77`; the code is a backlog line (*A turned-away Send frees its session index*) |
| **e3b#3** | A sent funding's screen hid the requests behind it | Yes: its queue line and Decline all | Built, `5d78d9c4` |
| **w2#4** | getUtxos dropped a UTxO's reference script | Yes: each UTxO as on chain | Built, `eedd4965`; its hash checked (still#11, `0f1d9d27`) |
| **w2#5** | One stranger's token broke getBalance | Yes: cap its total at u64::MAX | Built, `eedd4965` |
| **G5's notes** | A note the transaction doesn't commit to, unchecked | Yes to (2), a warning; (1) left | Built, `5d78d9c4`; from the bytes it signs (sign#1, `0f1d9d27`) |
| **G6's note** | A page that left unanswered escaped the back-off | **B7** (a): a decline, unless another page of the site waits on the question | Built, `5d78d9c4`; its edges in `0f1d9d27` (sign#3), `9d512644` (l2sign#1), `5709e0c1` (l3still#4) and `dc31711b` (l4code#3) |
| **e9a#1** | A token with no spendable units offered, Review greyed with no reason | Yes: the form says why | Built, `484fa70b` |
| **w1a#1** | Max in parts didn't check the tokens are held | Yes: refuse in core's words | Built, `523690c8` |
| **gap-g8#9** | A mint fails when its largest ADA-only UTxO is past output #255 | **B8** (b): leave it | No change. Declined in the backlog |
| **gap-g7#1** | A DRep named like a built-in choice reads as that choice | Yes: "DRep · name", and a warning | Built, `484fa70b` |
| **gap-g7#2** | The bundled DRep list ignored CIP-119's doNotList | Yes: honour it | Built, `484fa70b`; 1.9.2's refresh left out the 19 mainnet and 3 preprod DReps that ask not to be listed (`26794c40`) |
| **The recovery phrase and Chrome Translate** | With *Always translate* on, the 24 words go to Google | **B9** (a): `translate="no"` on the phrase's words alone | Built, `484fa70b`; wherever they show (docs#1, still#2, `a7f3eed6`) |
| **r4#8** | `util mint -g -p` wrote the given register unchanged | Yes: re-randomize it | Built, `63cd92fb`; core's own mints are a backlog line |
| **r4#5's last part** | The CLI's page didn't refuse an earlier run's transaction | Yes: leave it | No change. Declined in the backlog |
| **The CLI fixer's notes** | The sweeps carry a stranger's pile on the user's ADA | **B10** (a): Max spends every UTxO; a line in the README | The line, `63cd92fb`. Declined in the backlog |
| **d1#1** | The CIP-30 entry goes on localhost pages too | Yes: say so, with the policy's entry and the listing's line | Built, `02b9c1fe`; the store's texts (docs#8, `a7f3eed6`) |
| **d1#2** | The dApps page reads every open session's account | Yes: say so in privacy.md, architecture.md and the policy | Built, `02b9c1fe` |
| **d1#7** | The policy's ADA Handle row left out Send | Yes: add it | Built, `02b9c1fe` |
| **b1#2** | build.sh recorded no Rust | Yes: print `rustc -vV`; the second build under `env -i` | Built, `02b9c1fe` |
| **b1#3** | The CLI's build jobs held the release key | **C1**: the owner makes the `release` environment; the workflow is ready for it | `sign-and-publish` runs in it, alone with the key (`02b9c1fe`), with no third-party action after the import (docs#5, `a7f3eed6`). The environment is the owner's |
| **The diag scan's LOOK rows** | Every full audit run ends with diag failed | **B11** (a): an accepted list, keyed by the hand-checked function | Built, `ec3e388f`, with `check.sh`'s expected failures from the re-check's text; CI runs `test-tools.sh` (docs#7, `a7f3eed6`). Each entry is the owner's to approve in the PR |
| **v3#2** | CI skipped the proven-bytes test on a .hex-only PR | **B12** (a): one covered-filter term | Built, `02b9c1fe` |
| **G8's notes** | Old tags' locale, Dependabot, the covered filter, the sorts | **B13** (a): Dependabot for the actions, monthly, one PR; the rest as recommended | Built, `02b9c1fe`, `484fa70b`; the filter refined (l2docs#1, `9d512644`; l3misc#1, `5709e0c1`) |
| **`seedelf-data`'s two readers** | The data layer's copies of r3a#1's and x2#1's readers | **C2**: fix them and deploy | Built, `06ec9ad4`, `8f592a2b`, `afe86807`, `bbbc4ba1`, `813b602e`. The deploy is the owner's |

- **Answer 1** (cli#1, docs#2, still#7): the workspace goes to 0.8.0, not 0.7.1. Core's public API changed since 0.7.0, and on 0.x Cargo would build a 0.7.0 CLI against a 0.7.1 core, which fails (`1a49dcf4`, which also marks `is_not_a_script` deprecated).
- **Answer 2** (to B15; money#2, own#1): each spend's change is marked `change:<tx>`, so a stealth mint, a pool's start and a funding take fresh money first (`9f8df1b1`).
- **Answer 3** (own#3): only words change for a box a stranger deposits under the user's key and mixes themselves (`c3d976cc`, the words in `5447f7e5`).
- **Answer 4** (to B15; time#1, still#1): only a box recorded as mixed, from this release on, ranks first; a plain box from before ranks after money others paid, as before B15 (`9f8df1b1`).
- **Answer 5** (l2rank#6): with nothing fresher, an earlier private spend's change goes before money made private, and change naming `public:<n>` stays with that money (`d2042f44`).

## The calls round

The owner's answers are in [The owner's calls](#the-owners-calls). Each round below ran fixer groups by file ownership, each test failing before its fix and passing after. Then came the lead's commits by path, the WebAssembly rebuilt, every check (*The checks*), and a review of the merged round ([The calls round's reviews](#the-calls-rounds-reviews)).

- **The re-check,** before the answers, read all 55 calls again on the code and found each still real, three in part (e7a#2, gap-g8#5, gap-g8#6). It also took r3a#1's class to the wallet's other readers of data whose spelling someone else chooses, against `cardano-cli` 11.0.0.0's own verdicts, offline. The proofs hadn't missed r3a#1: every theorem is about the Data a script is handed, where two spellings are one value, and CLAIMS.md now says so (`5d4cd56a`). Fixed from the re-check (`2b1f4c92` to `813b602e`):
  - class#1 (`2b1f4c92`): an order whose datum nests the general form, which Stop never cancelled;
  - class#2 (`505d6a90`, and `534c0b1f` after its review): the account's key written in chunks in a contract's datum, which the sign window missed;
  - C2 (`06ec9ad4`, `8f592a2b`, `bbbc4ba1`): the data layer's copies of r3a#1's and x2#1's readers, and x2#1's twin at the holder;
  - 259 spellings of a box's datum with the node's verdicts, 216 of them a box, which core's reader and the data layer's both read exactly as the node does (`afe86807`, `813b602e`).
- **Round one** (`523690c8` to `69d001e8`): 13 fixer groups, `G1a` to `G10`, built the calls, a commit each up to `ec3e388f`, with the hunks of the files several share in `8bf4aaca`. The 30 new or changed critical keys and the store listing's sites bullet were back-translated blind (`75956e22`): Spanish held throughout, and of Japanese's 29, mint.tagRules was reworded and checked again. The checks then found two tests still pinning the old behaviour (`69d001e8`). `bd45ee21`'s 0.7.1 became 0.8.0 (answer 1).
- **Round two** (`0f1d9d27` to `5447f7e5`), the first review's: B15 reached further than a box a mix moved, so a stealth mint's first pick could be a stranger's copy of a box-paid Seedelf's register (money#1, own#2), a box no mix moved (own#4, time#1, still#1) or a box-paid spend's change (own#1). With answers 2 and 4, only a box the wallet recorded a mix moving ranks first, and each spend's change carries the link it made (`9f8df1b1`, `5447f7e5`). own#3 changed words only (answer 3, `c3d976cc`, the words in `5447f7e5`). A trailing byte that dropped the sign window's warnings is refused (sign#1, `0f1d9d27`), the phrase is kept out of Translate wherever it shows (docs#1, still#2, `a7f3eed6`), and the workspace is 0.8.0 (cli#1, `1a49dcf4`). Lows: B15's other pick (money#3); the spenders and a settled payment's history (own#5, own#6, docs#3); the sign window and the connect question (sign#2, sign#3); the hatch (time#2); the collateral the forms count, and a note read back whole (money#4, still#5, still#6); the CLI and its version (cli#2, docs#2, still#7); CI and the backlog (docs#4, docs#5, docs#7). 12 nits; time#4 kept (*The lead's calls*).
- **Round three** (`d2042f44` to `51e66221`), the second review's. A box someone else put in came back as received (l2rank#1). Bring every box back now, and the retired pools' run, brought a mixed box back as Unknown (l2time#1). Change a spend left before this release kept no `change:<tx>` (l2time#2). `d2042f44` gives a box's way back one rule, asking nothing new, and that older change its `change:<tx>`; `211c65c2` fixes the docs' first-pick words (l2rank#2). Lows: the way back's classes (l2rank#3, l2rank#4, l2time#3, l2still#1, l2still#2); change in the review's note, and answer 5 (l2rank#5, l2rank#6); the back-off and a settled payment's history (l2sign#1, l2time#4, `9d512644`); the forms (l2still#3); and CI (l2docs#1). l2docs#2 was left to this record. 11 nits.
- **Round four** (`5709e0c1` to `1e1b0647`), the third review's: the policy's new sentence said a box you bring back yourself, or a retired pool's, comes back without the question of what made it, but Bring one back asks (l3time#1, l3docs#1, l3still#1). It now lists each case, checked in the code (`8b36053d`). l3rank#1, a 1.9.1 Make public to the user's own account read as change, went in words (`8b36053d`). Lows: a funding, a Send and the hatch take a box whose making they know before one of unknown making (l3rank#3, l3time#3, l3still#2); the 1.9.1 deposits' backfill on every write (l3time#2); the back-off at an unlock (l3still#4); the data layer's PRs off the web wallet's check (l3misc#1, l3still#3), all in `5709e0c1`; and words (l3rank#2, l3docs#2, l3docs#3). 9 nits, l3misc#2 and l3still#5 among them, whose Staking warning `1e1b0647` back-translated; l3rank#4 is left (*Left open*).
- **Round five** (`dc31711b` to `550a368f`), the fourth review's: round four's ranks also ordered merges, so a funding could merge four small mixed boxes where two larger ones paid (l4code#1). A merge is again the fewest boxes that pay, largest first, the most a mix moved among as many, in one place in core (`dc31711b`). Bring one back anyway's pool read asks again about a box the server hasn't answered for, which the policy now says (l4docs#1, l4still#1, `f697c355`). Lows: merge orders b and c (l4docs#3, l4still#2); the hatch's payer and its notes (l4code#2, l4code#4, l4still#3); the back-off's exception (l4code#3, l4docs#4); words (l4docs#2, l4docs#5). 8 nits.
- **Round six** (`7cefcb59`, `0cfcbaf0`), the fifth review's: a box holding tokens, a token pool's way back and often a mixed box, was left out of the box order (l5merge#1). Every box back from Lovejoin now counts, weighed by what it adds, under one strict box rule, and `box_rule_reference_test.rs` holds selection to it over every set that pays (`7cefcb59`). Lows: the rule's other edges (l5merge#2, l5merge#3, l5still#2, l5still#3), and the re-ask and merge words, traced end to end (l5words#1 to #3, l5still#4, `0cfcbaf0`). 7 nits; l5still#1 refuted. Its review found 5 mediums of its own:
  - weighing a token box by its ADA less its token's whole least understated what it pays beside change, so a spend merged a box more than pays (l6reference#2, l6still#1);
  - with token boxes among the boxes, rule 1 no longer held, so near a token's least a spend 1e1b0647 sent whole went in parts or was refused (l6still#1, and l6words#3, counted low);
  - past the input limit, order c merged a box where another session's money paid (l6reference#1);
  - the search parsed every UTxO's lovelace again on each try, so a payment in parts over a thousand UTxOs took three times as long in the worker (l6merge#1);
  - the words claimed the box rule for the UTxOs holding a token being sent, which go by how much of it they hold (l6words#1).
  
  Its lows found rules no test pinned (l6reference#3 to #8) and a pool read the policy didn't list (l6words#4).
- **Round seven** (`6f564f13`, `56a6fe0a`, `2b609796`), the sixth review's:
  - a token box weighs what it pays beside the change a spend makes anyway (`Weighed::InOne`), and a payment's parts keep `adds`;
  - 1e1b0647's own orders run where the rule's build nothing, so rule 1 holds by construction;
  - past the input limit, a funding takes another session's money before a box where that pays;
  - each amount is read once a selection, so a payment in parts over 1,000 UTxOs takes 9.4 s natively, against 84 s on round six's code and 11 s at 1e1b0647;
  - the reference works out every expected key itself, and the words scope the rule to what pays beside a sent token's holders;
  - `RELEASE.md` says to pull `main` before the tag.

  Its review found 3 mediums: beside two ways back of one pool, rule 2 bent at the input limit (l7merge#1, l7still#1), and a token box beside a change whose last output was full was weighed too high (l7merge#2).
- **Round eight** (`66d93f8d`, `0d09bb6c`), the seventh review's:
  - before the search takes its first box of unknown making, 1e1b0647's orders run over everything else;
  - orders a and b weigh a token box beside the change they keep anyway (`Kept`);
  - a choice too many by its count is refused without being made;
  - the words name each margin, and `RELEASE.md` says a CLI version moves by a PR, since `main`'s ruleset refuses a direct push.

  Then `main` merged in (#391, #392; `9fd7b58e`), and cardano.org's screenshot was made again on this build (`ac3f98d5`). Its review found 4 mediums, all in the same weights near the input limit: rule 2's first box still bent where the orders tried missed a set (l8merge#1, l8words#1, l8still#2), and round eight's own weight merged three boxes where two paid (l8merge#2).
- **Round nine** (`ff9e888f`, `fd107595`), the eighth review's, by the lead's call:
  - The weights stay. One bounded fix: orders a and b try fewer boxes by the ADA-alone weight before taking more (`fewer_built`), as c does.
  - The claims say what the search guarantees: rules 2 to 4 hold among the orders it tries.
  - Every margin is named in one clause.
  - The pins the lows asked for are added.
  - An exact search is [chunk 52](../../plans/chunk-52-box-rule-exact.md)'s, for 1.9.3.
- **The privacy policy's 18 November entry** was extended in place, never under a new date, for each change the rounds made to what the wallet sends, keeps or reveals.

## The checks

On the review's last tree, `d89a9360`, and on the calls round's trees after rounds five and six, `550a368f` (`0cab066b`'s code, with that round's back-translation) and `0cfcbaf0`, each check under a memory cap, against the counts at the start (`35b339f6`: `main` at `cd764fba` with the folder's first commit):

| Check | At the start | The review's end | Calls round five | Calls round six |
|---|---|---|---|---|
| `cargo fmt --all -- --check`, clippy `-D warnings` (CI's crates, and core, koios, the CLI and display) | not recorded | clean | clean | clean |
| `cargo test --workspace --locked` | 790 passed, 12 ignored | 962 passed, 12 ignored | 1,044 passed, 12 ignored | 1,056 passed, 13 ignored (the 13th, the box rule's 400-balance sweep, run apart: passed) |
| The parts suite (`payment_parts_shapes_test --ignored`, release) | 0 with problems, 108 refused, 0 Max | the same | the same | the same |
| The data layer's fmt, clippy and `cargo test --locked` | — | — | clean; 134 passed, 32 ignored | the same |
| The WebAssembly's node tests | not recorded | 60 | 60 | 60 |
| `tsc --noEmit` | not recorded | clean | clean | clean |
| `npm test`, default build | 3,306 passed, 4 skipped | 3,637 passed, 4 skipped | 3,930 passed, 4 skipped | 3,940 passed, 4 skipped |
| `VITE_ENABLE_MAINNET=false npm test` | 3,306 passed, 4 skipped | 3,625 passed, 16 skipped (the swap page's mainnet-only tests) | 3,916 passed, 18 skipped | 3,926 passed, 18 skipped |
| `npm run e2e`, dev build | 109 passed, 1 skipped | 109 passed, 1 skipped (the found-later test, by design) | 109 passed, 1 skipped | 109 passed, 1 skipped |
| `npm run e2e`, store build (`build:store`, never `npm run package`) | 109 passed, 1 skipped | 109 passed, 1 skipped | 109 passed, 1 skipped | 109 passed, 1 skipped |
| `npm run e2e:data` | 3 | 3 | 3 | 3 |
| `LIVE_KOIOS=1 npx vitest run tests/live.test.ts` | — | 2 | 2 | 2 |

At the review's end:
- **The i18n gates:** 112 of 112; the round's 26 new or newly critical keys were each back-translated blind from Spanish and Japanese, and one Japanese value was reworded.
- **The changed e2e test** (the private swap's spent step) passed four times in a row under `taskset -c 0,1` with four workers.
- **`cli/stranger-rows`** (`e898095e`, every CLI fix through the review's round four): fmt clean; 862 passed, 12 ignored; clippy clean.
- **The proofs,** with `check.sh` as the review's round three left it (`b0202c08`), one family at a time: `test-tools.sh` passes (50 checks, with its round four's); `lovejoin` 25 ok and its 5 unlisted imports, `lovejoin-v2` 115 and 12, `lovejoin-any-tx` 143 and 48, `lovejoin-every` 76, `seedelf-every` 28; `./check.sh` 163 ok and 3 imports, with PolicyBurn and PolicyMint failing as the README says. The readers: Seedelf 182 modules, 377 Valid, 19 Expected Falsified, the same two not ok; Lovejoin 310 modules, 475 Valid, 11 Expected Falsified, two not ok (the modules no family builds, *Left open*).

In the calls round:
- **Rounds two to six passed every check in the table.** Round one's run held its new critical keys at the i18n gate until their back-translation (`75956e22`), and two tests still pinned what the calls changed (`69d001e8`).
- **The critical strings,** back-translated blind after rounds one, three, four and five: round one's 30 keys and the listing's bullet (`75956e22`, *The calls round*), then one key in round three, one in round four and two in round five, all held (`51e66221`, `1e1b0647`, `550a368f`). Rounds two and six changed no critical string.
- **No Lean was built.** The change to the proofs' tooling (B11) is held by `test-tools.sh`'s stand-ins, 80 checks with 30 new, and CI now runs it on a pull request that changes the tools (docs#7).
- **Round six's column ran at `0cfcbaf0`,** before 1.9.2's version, lists and store images (`26794c40`, `88e1c84d`).
- **The final checks ran at `fd107595`:** round nine, with `main` merged in. They all passed:
  - Rust, 1,095 tests; the parts suite unchanged (0 with problems, 108 refused, 0 of them Max); the box rule's sweep;
  - the data layer, 134 tests; wasm-node, 60;
  - Vitest, 3,949 in the default build and 3,935 in the preprod build;
  - e2e, 109 + 109; e2e data, 3; live Koios, 2.

  Rounds seven and eight passed the same suites, except for one test round seven's run caught. `delegations-screen.test.ts` named a DRep that 1.9.2's list refresh had left out, and it now mocks the list (`052dbf00`).

## The live runs

On preprod, with test wallet A restored in a fresh profile each time, on a copy of the fix branch's dev build. Every flow submitted a real transaction and waited for it to confirm (the review's hashes are in `LIVE.md`, in the folder):
- **On the review's round one build** (`417fff13`): `run.mjs all`, six flows (a mint paid by the account, a move-in of 25.5 ₳, a stealth mint, a private send of 3.3 ₳, a Make public of 5.5 ₳, a removal), and `run.mjs staking`, four (TPREP, no confidence, always abstain, LOGIC). All confirmed; preprod.koios.rest and www.giveme.my were the only hosts.
- **On the review's final build's flows** (`0dce8a6b`; its round four touched only the CLI, the swap page, a session's record and the proof tooling): the same ten again, all confirmed, the same hosts. Among them, a mint (`c32aa09a…`), the move-in (`fb4a8701…`), the private send (`9b681652…`), the Make public (`12455391…`), the removal (`92116387…`) and the move to LOGIC (`6046bd8e…`).
- **Not run live:** a session's return, a swap and Bring one back, which the fixes also touched. Minswap is mainnet's alone, and test wallet A's held boxes are the owner's to keep, so the fakes and the worker's tests cover those.
- **On 1.9.2's build** (`26794c40`: round six's code, with 1.9.2's version and lists), run by the owner in the fix branch's own tree: `run.mjs all`, the same six flows, and `run.mjs staking`, the same four. All ten confirmed. `all` contacted preprod.koios.rest and www.giveme.my alone, `staking` preprod.koios.rest alone. Among them: the mint (`329e1f21…`), the move-in (`7e686fda…`), the stealth mint (`f53ef51b…`), the private send (`7b9649f3…`), the Make public (`211b15c6…`), the removal (`299217be…`) and the move to LOGIC (`610e4255…`). Every hash is in the calls folder's `live.md`.
- **On round seven's, round eight's and the final build** (`2b609796`; `9fd7b58e`, with `main` merged in; `fd107595`), run by the lead: the same ten each time, all confirmed, the same hosts. Their hashes are in `live.md` too.

## For the owner

Before this branch's PR merges:
- **The proofs' four new entries,** each a claim about a proof: approve or drop the diag scan's two hand-checked functions (`seedelf-verification/Audit/diag/accepted.txt`) and `check.sh`'s two expected failures (`seedelf-verification/expected-failures.txt`), which came from the re-check's text, not B11's words. No Lean run has checked either yet (*Left open*).
- **The preprod checklist's hand items** (development.md, *Preprod checklist before a release*, items 2 to 8) on its final dev build, as part 1 has it, beside the lead's automated checks and live runs.
- **Optionally, `/code-review ultra <PR#>`** on the PR, an independent check only you can start.

Then, once it merges, in order:
1. **Make the `release` environment** (C1) before the CLI's tag, as RELEASE.md's *Making a release* has it: you as its required reviewer with *Prevent self-review* off, deployments from tags matching `*.*.*` alone, and `RELEASE_GPG_KEY` and `GPG_PASSPHRASE` as its secrets, moved there from the repository's secrets and deleted from them. release.yml's `sign-and-publish` runs in it. Until it exists, the first run makes an empty one, and the job signs with the repository's secrets, unguarded.
2. **CLI 0.8.0,** by RELEASE.md's *Making a release*, on `main`, up to date with the merge (`git switch main`, then `git pull --ff-only`, first). The workspace is at 0.8.0 already (`1a49dcf4`), so the block's version lines change nothing and its commit finds nothing to commit: its tag starts the release. Approve `sign-and-publish` once the three builds pass, publish the draft, then the crates.
3. **The data layer's deploy:** data-layer-deploy.yml on `main` (`deploy`, approved, then `status`, then development.md part 2's checks of the routes `/health` doesn't read), with `cd seedelf-data && cargo test --test live_lovejoin -- --ignored --test-threads=1 --nocapture` run before it and after it, since `address.has_script` is new to the service (`06ec9ad4`, `8f592a2b`).
4. **1.9.2's part 2** (development.md, *2. On `main`, after the merge*). This branch carries part 1's version and lists (`26794c40`) and its store images (`88e1c84d`). Part 2's deploy is step 3's; then the store package from the merge commit, its e2e, checklist item 9 and the second build. Then *3. Upload and submit*, with what changed in the Store Listing tab (d1#1's line and `88e1c84d`'s images) and in the Privacy tab (d1#1's and docs#8's lines).

## Left open

In [backlog.md](../../backlog.md), from this review and its calls round, each still open in the code:
- ⬜ **The box rule, exact** ([chunk 52](../../plans/chunk-52-box-rule-exact.md), for 1.9.3): an exact search where a balance holds few boxes, the reviews' shapes pinned, and a sent token's holders picked by the rule. Its two backlog lines are *An exact search for the box rule's rules 2 and 3* and *The UTxOs holding a token being sent go by quantity*.
- ⬜ **Core's token sums are quadratic in their kinds** (l3cli#3's root): `fitting` and `Assets::add` clone the whole list for every token. The CLI's windows now bound what they hand core, but the web wallet's private sends still run it over every owned UTxO, so a stranger's many-token piles under the user's register slow each one. Not measured in the WebAssembly.
- ⬜ **Two Lovejoin AnyTx modules no family builds** (l3tests#3's note): `Lovejoin.AnyTx.LogicOwnerParserReach` and `LogicOwnerPrefix` are in no `check.sh` list and no listed module imports them, so no run builds or judges them, and `tally.py` reads them not ok.
- ⬜ **A swap keeps one skip reason** (l4worker#1's limits): a late leg's direct return after a swap's own return that had its own reason replaces it, so the page reads it as a later part's and the swap's own words are lost; and a direct return rebuilt under a new hash with no reason leaves the old hash named. A reason kept per return would close both.
- ⬜ **Change and deposits go 20 tokens to an output** (r2a#3, B14): selection takes a stranger's pile last now, but its change still goes 20 tokens an output (`token_chunks`). Packing by value size would end it.
- ⬜ **A swap that spends its session's 5 ₳ collateral** (gap-g4#2): the return's chain puts up only an exact 5 ₳ of ADA alone (`collateralFits`), and the fix that refuses nothing waits for a real session swap seen spending it.
- ⬜ **A turned-away Send frees its session index** (E2a's note): a funding refused before it reached the network still uses its index up.
- ⬜ **A box another profile brought back reads as received here** (gap-g9#1's box case): no reading keeps a pool box's spender.
- ⬜ **Mix again from my public account with several fee inputs** (gap-g2#1's (b)): one ADA-only UTxO still pays for every mix.
- ⬜ **Every automatic sender waiting after a withdraw** (gap-g3#1's (a)): only a withdraw waits after the wallet's own send.
- ⬜ **The way-back rules across Chrome profiles** (gap-g9#2): each profile's rules read its own records alone.
- ⬜ **Core's mints re-randomize the register they're given** (r4#8's class): `mint_from` and `account_mint` still write it as given.
- **Declined, the owner's calls:** any characters in a tag (gap-g8#1), the mint around output #256 (gap-g8#9), a line beside the collateral switch (G4's note), clearing another phrase's old receipts (e4a#1's residue), the CLI's page refusing a stopped run's transaction (r4#5's last part) and the CLI's sweeps leaving a stranger's pile (the CLI fixer's notes). C22's Translate entry now names the phrase's exception (B9).

Recorded, not backlog lines:
- **w2#3** wasn't verified: the model's safety filter stopped its trace verifier. Its fix stands on its own test.
- **The swap page's "Stopped after N of M"** for a cut own chain is lost when a later chain exists (G7a's note): what it says instead is still true.
- **Two of the worker's writes after a pool read** aren't pinned to the phrase that read the pool: lookUp's pin is taken when its turn starts, after that read, and sortOut's write takes none. A Remove and restore during the read can leave the first phrase's deposit inputs in the restored one's record, shown nowhere and dropped in time, and its due times off until the next pool read (the last look's L3time note).
- **Not run in the final checks:** `seedelf-slice`, since Slice didn't change and its first build here would fetch and compile its dependencies; and the audit families, so `count.py` reads their 178 modules STALE until `Audit/run-all.sh` replays them. The calls round built no Lean either: the next diag run shows which functions its rows name, and one not on the accepted list (`bstoi_be_loop`, or a `costingLog2` bridge, say) stays a LOOK until the owner lists it. Nor has `./check.sh Seedelf.PolicyBurn Seedelf.PolicyMint` run with `expected-failures.txt`: it should print EXPECTED twice and exit 0 (the notes of the calls round's G10).
- **Three trees of the calls round's round three** (`d2042f44`, `211c65c2`, `9d512644`) write a `change` origin their own WebAssembly refuses, since its half came in `b5c28f1e`: a bisect should skip them (l3rank#4).
- **What Pallas can't read stays refused, never misread:** a whole transaction with a general-form pair in its witness set (a swap's check, a site's in the sign window); an order whose by-hash datum a DEX writes in other bytes, whose cancel then fails its own check, so its swap isn't signed (`2b1f4c92`); and a native script written as an indefinite list, which a site isn't handed (w2#4's note).
- **The review's note still calls a session's never-mixed box a box back from Lovejoin,** and says spending it undoes some of what Lovejoin did, though no mix moved it: l2time#5 took its second option and left the note.
- **The CLI calls a Byron address incorrect** ("Supplied Address Is Incorrect", with its bech32 error), where the wallet now says it can't pay one: B16's words were Make public's (docs#10's note).
- **B9 rests on Chrome:** that Translate leaves out what's marked `translate="no"` wasn't checked in a browser (the notes of the calls round's G7a and of docs#1).

## Lessons

- **Every fix round broke something where two fixes meet, again.** Round one's keyset paging (r1#1) made the CLI's worst bug of the review (r2cli#1, high). Its sign-window readings made the window reassure where 1.9.1 warned (r2sign#1). Round two's wait for a late leg (r2still#2) made every swap's page wrong for up to a minute after its fill. Round three's kinds budget let a stranger's piles crowd the user's ADA out again (l4cli#1). Each review of the fixes found fewer, and smaller: 28 above a nit, then 14 lows, then 5 lows and 2 nits. Plan to review the fixes until a round finds nothing above a low, not once.
- **No window takes its order from a key a payer chooses.** Koios's `tx_hash` order, the amount of a token held, "ADA alone first": each let a stranger, or the user's own change, decide which UTxOs a spend may draw on. Rank by what each brings to the spend, with what the spend refuses left out.
- **A payment is called a Seedelf's only where its wallet reads it.** Three of the sign window's readings (a register's general form, a datum kept by hash, and, still open, a reference script) said "a Seedelf payment" for an output no Seedelf Wallet lists or spends. One vector set now holds the readers together.
- **A fixer who can't run Playwright can rename a control unseen.** Two rounds broke the e2e: a lookalike token's picker name, and a swap's extra runner step. The lead runs the e2e after each round, and a fixer greps the e2e for any name or words it changes.
- **Run new tests in both builds.** Nine of round one's tests assumed a mainnet build.
- **A guard read at the wrong moment pins the wrong state.** The phrase pins moved from the readings to the writers, which check their own turn; the late leg's wait became a time, not a count of runs.
- **A claim from memory needs a run.** Both of the critic's unchecked claims held, but only a run showed it: the ledger's own decoder, and a probe of the stack.
- **Trace a claim about what the code sends; never grep one function for it.** The lead's own sentence in the policy (`b5c28f1e`) said a box you bring back yourself comes back without the question of what made it, but Bring one back asks: three lenses of the next review found it (l3time#1, l3docs#1, l3still#1). The re-ask's words took two rounds more (l4docs#1, l4still#1; l5words#1, l5words#2). Round six traced them end to end, and `r6-when-it-asks.test.ts` pins each case.
- **A fix round broke the merge order where the last one left it.** In the calls round, round four's ranks, meant for the one box that pays alone, also ordered merges (l4code#1), and round five's box order left out token boxes (l5merge#1). Round six pinned the rule itself, not a shape: `box_rule_reference_test.rs` builds every set that pays over seeded balances and holds selection to the best of them. The calls round's first five reviews found 11, 4, 4, 3 and 1 mediums. The sixth found 5, all in round six's own design. The reference's balances kept out the windows where the code's weights and orders were wrong, and two of its expected keys came from the code's own ranks (l6reference#2, l6reference#6). A reference shares the code's blind spots wherever it shares its helpers or its shapes. Round seven made it compute every expected key itself, and widened its balances to the windows review six found. The seventh and eighth reviews found 3 and 4, each in a neighbouring window of the same weights: a set's token deposits are shared, 20 kinds to an output, so no order of boxes by weight tries every set that pays. Round nine narrowed the claims to what the search guarantees and left an exact search to chunk 52. When the fixes of one rule keep finding new windows, the claim is what to fix first.
- **A branch for `main` cut from a fix needs that fix's test changes too.** #389 carried x2#1's code but not the fixture change the fix branch made for it later (`506e4ed2`), so six extension tests failed in its CI until `357a2480` ported it. Run the extension's suite on such a branch, not only cargo.
- **A new first pick reaches everything that carries its label.** B15 put "a box back from Lovejoin" first for a stealth mint, and 7 of the first review's 11 mediums were where that label reached: a stranger's copy of a box-paid register (money#1, own#2), a box no mix moved (own#4, time#1, still#1), one its depositor mixed themselves (own#3) and a box-paid spend's change (own#1). The rank that held names what earns it, a mix the wallet recorded moving the box (answer 4), not an origin a UTxO inherits.
- **Name a release by its API's diff, not by its plan.** The calls round's first round set 0.7.1 for "the CLI patch release" (`bd45ee21`), but core's public API had broken since 0.7.0 (cli#1, docs#2, still#7), and 0.7.1 would have built a 0.7.0 CLI against a 0.7.1 core, which fails.
- **A label the code cites needs its definition in the repository.** The code and the docs cite the owner's letters and answers on dozens of lines ("the owner's B16", "the owner's answer 4 to B15"), and until this record only the calls round's DECISIONS.md, kept outside the repository, said what they were (l2docs#2).

## The IDs

The code, the tests and the docs cite these by ID, as "chunk 51, <id>". Their full text is in git at `009c4ab4`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-51/`: each family's report is `lanes/<lane>.md`, its data `data/<lane>.json`, and each verdict `verify/<id>.md`. The calls round's are under its `calls/` at `64b63458`: each review's findings with their verdicts in `review<N>.json` (and, from the third review on, its verifiers' tests in `review<N>/`), the re-check in `recheck.json`, and each call with its answer in `DECISIONS.md`.

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
| `money#`, `own#`, `sign#`, `time#`, `cli#`, `docs#`, `still#` | the calls round's first review, of round one (`review1.json`) |
| `l2rank#`, `l2sign#`, `l2time#`, `l2docs#`, `l2still#` | its second, of round two (`review2.json`) |
| `l3rank#`, `l3time#`, `l3misc#`, `l3docs#`, `l3still#` | its third, of round three (`review3.json`) |
| `l4code#`, `l4docs#`, `l4still#` | its fourth, of round four (`review4.json`) |
| `l5merge#`, `l5words#`, `l5still#` | its fifth, of round five (`review5.json`) |
| `l6merge#`, `l6reference#`, `l6words#`, `l6still#` | its sixth, of round six (`review6.json`) |
| `l7merge#`, `l7reference#`, `l7words#`, `l7still#` | its seventh, of round seven (`review7.json`) |
| `l8merge#`, `l8reference#`, `l8words#`, `l8still#` | its eighth, of round eight (`review8.json`) |
| `class#1`, `class#2` | r3a#1's class in an order's datum and in a datum naming the key, from the re-check (`2b1f4c92`, `505d6a90`) |
| `B1` to `B16`, `C1`, `C2`, answers 1 to 5 | the owner's answers ([The owner's calls](#the-owners-calls)) |
| `G1a` to `G10` | the calls round's 13 fixer groups (`DECISIONS.md`) |

Mind the clashes:
- the two R2s: `r2a#` and `r2b#` are round one's core lanes (`build.rs` and the rest of core), `r2<lens>#` the review of the merged fixes;
- `money#` to `still#`, the calls round's, aren't `r2money#` to `r2still#`, the review's;
- `l3time#` and `l3still#` each name two lenses, the review's own last look and the calls round's third review, and share numbers (l3time#1 and #2, l3still#1 to #5): a citation from a commit up to `984ff48f` is the review's, one from after it the calls round's, whose tests call that review "round three's last look". This record calls the review's own lens L3time;
- the owner's letters aren't lane B1 (`b1#`), T1i's guards (its B15, B16, C1 and C2) or 1.9.1's clusters C1 to C3;
- four group names are in both fixer lists, G7a, G7b, G8 and G10: *G8's notes* and the swap page's *G7a's note* are the review's groups', and *Left open*'s notes on B9 and on the diag run are the calls round's.
