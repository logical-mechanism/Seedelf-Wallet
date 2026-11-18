# Chunk 51 · Findings

Made by `tools/findings.py` from `data/` and [owner-calls.md](owner-calls.md). Every finding of the review, by what became of it. Severity is the verifiers' where they ran (the lower of trace and impact, or the tiebreak's), else the finder's; nits and D1's findings had no verifiers, by the plan. Each finding's text is in `lanes/<lane>.md`, its verdict in `verify/<id>.md`, one line each in [INDEX.md](INDEX.md).

T1's findings are guards that no test pinned: a T1 agent reverted each in a copy and every test still passed. Fixing one means adding the test that fails without it.

## Counts

| Severity | fixed | owner | covered | moot | unreachable | open | refuted | unverified | merged | All |
|---|---|---|---|---|---|---|---|---|---|---|
| critical |  |  |  |  |  |  |  |  |  | 0 |
| high | 3 |  |  |  |  |  |  |  |  | 3 |
| medium | 3 | 4 |  |  |  |  |  |  | 1 | 8 |
| low | 267 | 38 | 9 | 2 | 2 |  |  | 1 | 13 | 332 |
| nit | 42 | 1 |  |  |  |  | 1 |  | 3 | 47 |
| **All** | **315** | **43** | **9** | **2** | **2** | **0** | **1** | **1** | **17** | **390** |

*fixed*: on the fix branch, or on its own branch for `main`, with a test that failed before. *owner*: below, not fixed. *covered*: another finding's test already pins it. *moot*, *unreachable*: no test can fail without the guard. *open*: for a fix round still to come. *merged*: the same as another finding, which carries it.

## ❓ The owner's calls

Each finding below changes a default, a privacy promise or a rule the owner set, or something only the owner can change (repository settings, the published policy). None is fixed on the fix branch. Each has a recommendation; the verifiers' tests for these are kept in this folder's `verify/<id>.md`, not in the fix tree. They're grouped so that most can be answered as a batch.

### 1. Decide first: the four mediums

- **e1a#1** (medium, stranger) `lovejoin.ts:3819`. A stranger's deposit under the wallet's register reads as the wallet's own unmixed box, and Mix my boxes again takes it first, tying the mix session and its private funding to that register. *Recommend:* tell the phrase's own deposits from others' by the deposit's inputs (a one-time account's key or a public account's payment key), record any other as made by a stranger, and leave those out of Mix my boxes again. The callout then says someone else put it in under your key; Bring it back anyway stays its way out. Keep each kept origin with the rule's version (G4's note), as the contract scan's verdicts now are.
- **e6#1** (medium, stranger) `minted-by.ts:124`. A stranger can plant a Seedelf so that Remove preselects the public account and says it links nothing new. *Recommend:* decide "the account paid" only from the account's own spend in its Activity, never from a UTxO or a received entry a stranger can make. Otherwise preselect nothing, as §3.2 decided.
- **r2a#3** (medium, stranger) `build.rs:353`. A stranger's many-token UTxO costs several times its ADA once it's re-made as change, 20 tokens an output, and history-aware selection takes it ahead of money that pays without it. *Recommend:* price what a UTxO adds as its ADA less the change its tokens need; take one that adds less than nothing only when it holds a token being sent, and then last. Pack change by value size rather than 20 tokens an output. Max still spends every UTxO (the owner's 1.6.0 call) unless the owner says otherwise. The CLI's transactions change too: a CLI patch release. The same class: WebAssembly's `measured_or_more` and `Worth::adds`, the short message's Max figure, and the CLI sweeps' dusting (§7).
- **gap-g1#1** (medium, stranger) `activity.ts:389`. A payment under a register already on chain (a Seedelf's own, d = 1, or a copied datum) is classed Received, and the stealth mint, every session funding and the private pool start take it first, which ties them to that Seedelf publicly. *Recommend:* part (a) now: key each spendable UTxO by its register and match it against the kept view (no request); a match is already tied on chain, so give it the matched row's class. Part (b), moving the stealth mint to take a box ahead of received money, is a design call; leave it unless the owner wants it.

### 2. Refusals the ledger doesn't make (the 2026-10-19 rule)

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

### 3. Lovejoin and the private sessions

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

### 4. What the wallet calls the user's own

- **gap-g9#1** (medium→low) `activity.ts:445`. With the phrase open in a second profile, every private transaction made there reads here as a payment received, and this profile's fundings take that money first. *Recommend:* yes on mainnet: an arrival made by a transaction that spent one of the wallet's own rows is the phrase's own spend elsewhere, classed as unknown, never received. On Koios-only reads, say it in privacy.md.
- **gap-g1#2** (low, site) `dapp.ts:2644`. A site's payment from the user's own account or session into the user's Seedelf is classed Received. *Recommend:* note those outputs in the Seedelf history as made private from that account or session. It keeps a new record, so the privacy policy gets a dated Changes entry in the same PR.
- **x1a#2** (low, site) `cip30.rs:1386`. The sign window says a site's payment into a Seedelf hides whose it is without checking the register. *Recommend:* check it against the kept view, with no request, and warn when the register is already on chain. Without a kept view, don't claim it. privacy.md:336 changes with it.
- **l3sign#1** (low, site) `tx-view.ts:332`, from the last look. A site's payment under the user's register whose output carries a reference script reads as a plain Seedelf payment in the sign window, with no warning, and Transaction details says "Yours, in your private balance". But the balance leaves such a row out, and no web-wallet spend takes it: the evaluator can't run with a reference script. It's older than 1.6.0. *Recommend:* r2sign#1's class: a payment is called a Seedelf's only where the wallet reads it. Give such an output its own reading and a short warning in the UTxOs page's words ("Seedelf Wallet can't spend it yet"), and the same in Transaction details, pinned in the register-spellings vectors. New critical strings, so a back-translation.
- **e9a#4** (low) `Activity.tsx:126`. Public activity's Save as CSV note says the file holds nothing the chain doesn't, but its rows name the user's own Make private and Make public. *Recommend:* write those rows in the public file as the chain reads them (sent to or received from the contract), so the note stays true.
- **e4a#1's residue.** The fix ties each reading to its phrase. Receipts of another phrase that the old Remove-and-restore race already sealed into this profile's history stay in Activity until a Remove and restore. *Recommend:* leave them; this was a narrow race, and Remove and restore clears it.
- **Each failed Send burns a session index** (E2a's note, via the critic). Twenty to thirty-nine turned-away Sends in a row, during a giveme.my outage say, hide every later session from a restore's scan, and their money from the wallet. *Recommend:* take the next index only once a funding is sent, or widen the restore's gap past the most indices one profile can burn. Worth a chunk of its own.

### 5. The connector

- **e3b#3** (low) `DappApprovals.tsx:626`. While a sent private-session funding waits, every request behind it is hidden: no count, no Decline all, and closing the window declines them unseen. *Recommend:* show the queue line and Decline all on the funding's screen. It adds nothing the user must do.
- **w2#4** (low, stranger) `cip30.rs:287`. getUtxos drops a UTxO's reference script, so a site spending it underpays the Conway fee and the node refuses it. *Recommend:* hand the site the output as it is on chain, its reference script included.
- **w2#5** (low, stranger) `cip30.rs:348`. getBalance fails for every site once a stranger's token total passes a u64. *Recommend:* cap that token at u64::MAX, CIP-30's own ceiling.
- **G5's notes.** (1) Once an earlier request's error is hidden, the next request's screen doesn't say it failed: a one-line note would need words. (2) The window reads a transaction's note without checking it against the body's metadata hash: a mismatch line would need words. Transaction details, in the same window, already warns; the docs now say so (r2docs#2). *Recommend:* (2) yes, a short warning when the note isn't the transaction's; (1) leave it.
- **G6's note.** `gone()` doesn't count a page that leaves before answering as a decline, so a site can escape the back-off (L35) by reloading. *Recommend:* count it as a decline.

### 6. Screens and lists

- **e9a#1** (low) `Home.tsx:572`. A token's details offer Send or Make private/public for a token with no spendable units, and the form drops it silently, with Review greyed and no reason. *Recommend:* the form names why (locked, or on its way back) and Review waits with that reason, in all four forms.
- **w1a#1** (low) `lib.rs:4062`. Max in parts never checks that the named tokens are held. *Recommend:* refuse in core's words ("The Seedelf balance holds only …"), as one-transaction Max did. The payment can't be built, so the 2026-10-19 rule doesn't apply.
- **gap-g8#9** (low) `build.rs:3898`. A Seedelf mint from the public account fails when its largest ADA-only UTxO sits past output #255. *Recommend:* yes, no product question: never put such a UTxO first alone.
- **gap-g7#1** (low, stranger) `format.ts:438`. A DRep that names itself Always abstain (or another built-in choice) reads as that choice on the vote review, in Activity and in Delegations. *Recommend:* never let a DRep's own name stand alone on the review's main row ("DRep · name"), and treat a name like a built-in label as shared, so the card warns.
- **gap-g7#2** (low) `dreps.mjs:96`. The bundled DRep list ignores CIP-119's doNotList, which the wallet's own profile form turns on by default. *Recommend:* honour it. Pasting an ID still works.
- **The recovery phrase and Chrome Translate** (E9b's new fact on C22). With *Always translate* on, in a language the wallet doesn't speak, Chrome sends the 24 words to Google, and a backup copied from translated words would be wrong. The owner's C22 call (2026-10-06) keeps Translate on and discloses it; that disclosure names balances, addresses and Seedelf names, not the phrase. *Recommend:* `translate="no"` on the phrase's grid alone, everything else as C22 has it. Raised only because this is new: the secret itself, not the page.

### 7. The CLI

- **r4#8** (low) `mint.rs:76`. `util mint -g -p` writes the given register unchanged, so Seedelfs minted for one person from their `util base` register are visibly theirs. *Recommend:* re-randomize it, as `create` does (the private default). The README row changes with it.
- **r4#5's last part** (low) `web_server.rs:97`. The fixed part: the server binds first, each run has a path of its own, and the page and terminal show the transaction id. The open part: the page refusing an earlier run's transaction. *Recommend:* leave it. An old page can't reach the new run's path, and what it still signs is the earlier run's own transaction, under its id.
- **The CLI fixer's notes.** (1) Dusting: when the rest's ADA can carry a stranger's token pile, both sweeps carry it, which puts about 46 ₳ of the user's own ADA into 30 junk outputs (`external sweep`) or about 30 ₳ (`sweep --all`); with fewer than 20 better UTxOs, `sweep --all` still carries piles on the user's ADA. (2) and (4), the window's order and what it takes first, are settled by r2cli#1's fix (e6d6a18d): every owned UTxO, the refused ones out, the sent token's holders first, the rest by worth. (3) `sweep --all` still spends UTxOs holding a reference script, which Ogmios evaluates. *Recommend:* (1) leave such a pile behind, as the web wallet's return does (r2a#3's class). (3): keep as it is.

### 8. Docs and the privacy policy

- **d1#1** (low, site) `privacy-policy.md:79`. The policy and privacy.md say the CIP-30 entry goes only on https pages; it also goes on every http://localhost and http://127.0.0.1 page. *Recommend:* correct the words ("https pages, and pages served from this computer"), with a dated Changes entry and the store README's line. Keep localhost: dApp developers test there.
- **d1#2** (low) `privacy.md:369`. The dApps page reads every open session's account together each time it opens, which privacy.md puts on the Swaps screen alone and the policy never says. *Recommend:* correct privacy.md and architecture.md:665, and add the policy line with a Changes entry.
- **d1#7** (nit) `privacy-policy.md`. The policy's ADA Handle row covers only a withdrawal; a public Send to a $handle asks the server too. *Recommend:* add Send to the row, with the Changes entry.

### 9. Build, CI and release

- **b1#2** (low) `build.sh:61`. build.sh never checks or records which Rust built the module, and the second build shares the first's shell. *Recommend:* yes to printing `rustc -vV` beside the C compiler, and to running the second build under `env -i`. No refusal is needed, since the record shows any difference.
- **b1#3** (low) `release.yml:24`. The CLI's build jobs hold the GPG release key, its passphrase and a write token beside every crate's build code. *Recommend:* yes: one sign-and-publish job behind a `release` environment the owner approves, as the data layer's deploy is. Only the owner can make the environment; the workflow change can follow.
- **The diag scan's LOOK rows** (r2verif#4's fix, `Audit/diag/scan-diag.py`). The scan now exits 1 on any LOOK row, and the scanner flags every query that recurses over Nat as LOOK on purpose, so `run-all.sh` lists diag as failed on every full run, the rows the audit checked by hand included, as `check.sh` lists PolicyBurn and PolicyMint. *Recommend:* an accepted list beside the scan (`Audit/diag/accepted.txt`: each hand-checked row, why, and when), so only a new LOOK fails. Each entry is a claim about a proof, so each is the owner's to approve.
- **v3#2** (low) `web-wallet.yml:67`. CI skips the proven-bytes test on a PR that changes only the .hex files it reads. *Recommend:* (b): a small job that runs only that test when `seedelf-verification/**/*.hex` changes, so verification PRs stay fast.
- **G8's notes.** releases.md could say old tags rebuild their zips under `LC_ALL=C.UTF-8`; a `.github/dependabot.yml` would watch the pinned actions; web-wallet.yml's `covered` filter matches only itself, so a PR editing another workflow skips workflows.test.ts until main's run; tokens.mjs and dreps.mjs sort with `localeCompare` and no locale. *Recommend:* the LC_ALL line and the `covered` filter yes; dependabot only if the owner wants the PR traffic; the sort is harmless (a refresh's diff only).

### 10. Outside the chunk: the data layer

- **seedelf-data's copies of two fixed readers.** Its `is_mix_datum` takes tag 121 alone, and its credential index may not tell key rows from script rows. These are r3a#1 and x2#1's twins on the server. The wallet now reads both right whatever the server says, but the server's crowd count can be off. *Recommend:* fix both in seedelf-data and deploy through the deploy workflow, as its own PR.

## Fixed

Each with a test that failed before its fix. The commits are on `web-wallet/whole-review-fixes`; the two highs and the CLI's fixes are also on their own branches for `main` (`web-wallet/lovejoin-box-datum-spelling`, `cli/stranger-rows`).

### Core

- `r3a#1` **high**: A stranger's mix can write the user's box datum as constructor 0's tag-102 form, which the contract accepts and the wallet no longer sees as a box `mod.rs:387` · 0c965ff8, 506e4ed2, e2b31e6f
- `x2#1` **medium**: A stranger's 5 ₳ at a KEY address whose hash is a pool's mix_box script hash counts as a pool box: it counts toward the floor, gets drawn, and every chain that draws it fails, so returns come back directly `mod.rs:416` · 506e4ed2, 6aea4fb8, d2a7278d, fcdacc50
- `l3cli#2` **low**: fund's new holders_of takes the holder with the most of the sent token first, so a stranger's UTxO holding more of it leads, and fund refuses or carries its junk `utxos.rs:220` · 5be0b1b4
- `r2a#2` **low**: apart ends the search at the first order grown whole that's short, so it refuses payments a subset pays and the CLI's order would make `build.rs:2843` · c1c5b13a
- `r2b#2` **low**: CLI `fund` says "Not Enough Lovelace/Tokens" when its ADA sits in token UTxOs larger than the one holding the token being sent `utxos.rs:258` · 48a4c977, 82078f10
- `r2cli#2` **low**: fund's new order takes a second holder of the sent token for its ADA before any ADA-only UTxO: a fund main made is refused, and others spend a token UTxO they don't need `utxos.rs:251` · af022a6f
- `r2money#2` **low**: ScriptSpend::stage holds the collateral's return to its least at the estimate's guessed fee too, so a merged return whose settled fee leaves that least is newly refused `build.rs:2210` · b3687869
- `r2tests#5` **low**: r2a#2's error half (failed && !short_whole) is caught by no suite, the ignored parts suite included `build.rs:2874` · b3687869
- `r3b#1` **low**: check_cancels decodes Minswap's swap with no nesting check of its own; it is safe today only because inspect runs check_nesting first `orders.rs:1232` · c1c5b13a
- `r2b#3` **nit**: A failing certifying script would be labelled "propose": uplc 1.1.23 names a Cert redeemer "Publish", which `ogmios_purpose` doesn't map `eval.rs:378` · c1c5b13a
- `r2b#4` **nit**: `asset_id_to_asset` is dead code that panics on a short or non-ASCII id `assets.rs:367` · c1c5b13a
- `r3a#2` **nit**: again_affordable divides by zero at depth 0, where its _in sibling guards it; mixes_per_box_at traps on an unchecked width or depth `mod.rs:2177` · 36fbb96f, c1c5b13a
- Guards now pinned by a test (T1): `t1a#7`, `t1a#8`, `t1a#9`, `t1a#10`, `t1a#11`, `t1a#14`, `t1a#15`, `t1a#16`, `t1a#17`, `t1a#18` · 0a7d493e, 1dc64e1d
- Guards now pinned by a test (T1): `t1b#1`, `t1b#2`, `t1b#3`, `t1b#4` · 1cf196c4
- Guards now pinned by a test (T1): `t1c#1`, `t1c#2`, `t1c#4`, `t1c#5`, `t1c#6`, `t1c#7`, `t1c#8`, `t1c#10`, `t1c#11`, `t1c#12`, `t1c#13`, `t1c#14`, `t1c#15` · 1dc64e1d
- Guards now pinned by a test (T1): `t1d#1`, `t1d#2`, `t1d#3`, `t1d#4`, `t1d#5`, `t1d#6`, `t1d#7`, `t1d#8`, `t1d#9` · 1d509df7

### The CLI

- `r2cli#1` **high**: Twenty of a stranger's token piles, sorted first under Koios's new tx_hash order, take every slot of the 20 UTxOs a CLI spend draws on: sweep --all, sweep, transfer and util mint then fail on every run `sweep.rs:166` · e6d6a18d
- `r4#1` **high**: A stranger freezes any CLI external wallet: `external sweep` (and `external balance`) total every UTxO there, and three junk rows overflow the token sum forever `sweep.rs:40` · 027fc81b, 204ef8fb, 64379c03, fcb22df7
- `r4#2` **medium**: A stranger's three junk UTxOs under the user's register break `balance` for good (and `sweep --all` while they're among its 20) `balance.rs:39` · 027fc81b, 64379c03
- `r4#4` **medium**: A submit the CLI can't confirm (30 s timeout, 5xx, unreadable 2xx) is reported as a plain failure, and re-running the command pays again `spend.rs:91` · 48a4c977, 82078f10
- `l3cli#1` **low**: The window ranks every ADA-only UTxO ahead of any token UTxO, so 20 small ones (anyone's) shut a large token UTxO out and transfer and sweep -l are refused `rows.rs:221` · 5be0b1b4
- `l3cli#3` **low**: The window runs core's fitting over every owned UTxO, quadratic in their token kinds, so a stranger's piles slow every transfer, sweep -l and util mint `rows.rs:257` · 5be0b1b4
- `l4cli#1` **low**: The window gives within_kinds' 4,000 kinds to every holder of a sent token first, whatever each brings, so four stranger piles holding one unit of a fungible token the user sends push the user's own ADA out, and transfer --asset and sweep --asset are refused `rows.rs:364` · d89a9360
- `l4cli#2` **low**: fund's for_select gives the 4,000 kinds to the sent token's holders by lovelace, so four stranger piles at the payer's address, each holding one unit of it, leave out the user's own holder or ADA, and fund --asset is refused where round two sent `rows.rs:319` · d89a9360
- `l4cli#3` **low**: The window caps its candidates at 20 rows in within_kinds before core's fitting drops what would overflow a u64, so 20 stranger UTxOs of 2^63-1 of one token fill the 20, fitting keeps two, and a spend the user's own UTxOs pay is refused `rows.rs:363` · d89a9360
- `r1#1` **low** (in part, as verified): The CLI reads the wallet contract with offset paging and no fixed order, so a page can skip or repeat a UTxO `koios.rs:252` · 48a4c977, 82078f10
- `r2tests#8` **low**: The CLI's two new 'Tx Hash' lines (r4#4's id before sending, and the signing page's id in the terminal) have no test `submit.rs:26` · e6d6a18d
- `r4#3` **low**: The signing page finds the witness set by searching the tx hex for the first `a105` (or `a0f5f6`) at any nibble, so create/fund/extract fail when their body happens to contain it `index.js:49` · 48a4c977, 82078f10
- `r4#5` **low**: The signing page has no tie to the run that served it: a still-open tab or an earlier run's server signs the earlier transaction, and nothing shows which Seedelf it pays `web_server.rs:97` · 48a4c977, 82078f10
- `r4#6` **low**: The signing server answers any Host header, so a DNS-rebinding page can read the unsigned transaction while it runs `web_server.rs:58` · 48a4c977, 82078f10
- `r4#7` **low**: `util extract` refuses a datum-less UTxO at the contract's staked address form, which the contract lets anyone spend `extract.rs:65` · 48a4c977, 82078f10
- `r4#9` **nit**: The escaping comment claims serde_json stops angle brackets from injecting HTML; it doesn't (unreachable: every caller passes hex) `web_server.rs:62` · 48a4c977, 82078f10
- Guards now pinned by a test (T1): `t1a#13` · 0a7d493e, 1dc64e1d
- Guards now pinned by a test (T1): `t1b#5`, `t1b#6`, `t1b#7`, `t1b#8`, `t1b#9`, `t1b#10`, `t1b#11`, `t1b#12` · 469479f1, cc7440c9

### Crypto

- `r1#3` **nit**: schnorr::prove (exported as verifyProof, never called) panics on a z over 32 bytes, so it doesn't decide as the deployed validator does `schnorr.rs:198` · 48a4c977, 82078f10
- `r1#4` **nit**: hashing::sha3_256's doc says bad hex hashes an empty array and never fails; it returns an error `hashing.rs:75` · 48a4c977, 82078f10
- Guards now pinned by a test (T1): `t1a#1`, `t1a#2`, `t1a#3`, `t1a#4`, `t1a#5`, `t1a#6` · 0a7d493e, 1dc64e1d

### The WebAssembly

- `r2money#1` **low**: A session's merged return whose only collateral is the 2 ₳ fallback is refused at a heavy fee, and the plain sweep of the same UTxOs, which builds, is never tried `lib.rs:1479` · b3687869
- `r2sign#1` **low**: The sign window now calls two register shapes a Seedelf payment, with no warning, though no Seedelf Wallet ever reads them: a datum kept by hash that the unsigned witness set carries, and the general form with an indefinite pair `cip30.rs:1288` · 53780f85, 81516188, 61a4d717
- `w1b#2` **low**: Removing a Seedelf moves the other tokens in its UTxO, but neither the review nor the Seedelf list shows them `lib.rs:5074` · 36fbb96f
- `w2#1` **low**: A certificate under a script's stake credential counts as another signer, so partialSign=false is refused and the window says others must sign `cip30.rs:1610` · 36fbb96f
- `w2#2` **low**: A key address whose key hash equals the Seedelf contract's script hash is labelled Seedelf Wallet's contract, so a burn shows as a Seedelf payment `cip30.rs:1386` · 36fbb96f
- `w2#6` **low**: Byron addresses: a found Byron input fails the whole read, and a Byron payee shows as raw hex `cip30.rs:1191` · 1cf196c4, 36fbb96f
- `x3#1` **low**: The sign window's register reader takes only tag 121, so a site's valid Seedelf payment spelled in constructor 0's general form (tag 102) reads 'without a register: anyone can take' and 'Your private balance isn't in it' `cip30.rs:1011` · 36fbb96f
- `r2tests#10` **nit**: decode_test's big-number test asserts a real-clock bound that adds nothing to the check before it `decode_test.rs:1979` · 81516188
- Guards now pinned by a test (T1): `t1e#1`, `t1e#2`, `t1e#3`, `t1e#4`, `t1e#5`, `t1e#6`, `t1e#7`, `t1e#9`, `t1e#10`, `t1e#11`, `t1e#13`, `t1e#14`, `t1e#15` · b27f0160
- Guards now pinned by a test (T1): `t1f#1`, `t1f#2`, `t1f#3`, `t1f#4`, `t1f#5`, `t1f#6`, `t1f#7`, `t1f#8`, `t1f#9`, `t1f#10`, `t1f#11`, `t1f#12` · 3b755369

### The worker

- `e1b#1` **low** (in part, as verified): Bring every box back meets a service-wide refusal box by box: a build, an account_info and a giveme.my request for every box, three runs over `lovejoin.ts:7412` · fdd3b8b2
- `e2b#2` **low**: A finished swap's "Received" shows only its last return, and a later return's skip reason replaces the main return's `sessions.ts:5522` · fdd3b8b2
- `e3a#1` **low**: A site on the dApp account can probe another public account's Lovejoin chain: the 'public' reservation isn't per account `dapp.ts:1912` · d9e015fb, fdd3b8b2
- `e3a#2` **low**: The connector takes the first 5 ₳ without tokens as a session's collateral: a stranger's 5 ₳ with a datum hides a spend of the real one `dapp.ts:2777` · d9e015fb
- `e3a#3` **low**: signData shows a site's message with direction overrides and invisible characters raw, so it can read differently from the bytes signed `dapp.ts:2896` · d9e015fb
- `e4a#1` **low**: A balance reading begun before Remove wallet finishes under the next phrase's wallet: it's shared with the new wallet's Home, kept as its reading, and its private UTxOs are sealed into the new wallet's history `balances.ts:392` · 2b3dfd80
- `e4b#2` **low**: `dapp-approvals` answers while locked, with a waiting signature's summary and its ties to the wallet's other accounts and sessions `handlers.ts:433` · 2b3dfd80
- `e5#2` **low**: A Make public to another of the user's own accounts reads the active account again as it lands, the timing link privacy review §2.9 removed `pending.ts:165` · 2b3dfd80
- `e7a#3` **low**: A swap funded in parts pauses as 'it spends something that isn't this session's' when Minswap's build spends a part Koios doesn't list yet `sessions.ts:4377` · fdd3b8b2
- `e8b#1` **low**: A stranger's 5 ₳ carrying a reference script or an unreadable datum becomes the public account's collateral, public Lovejoin mixes then fail, and the Collateral page can only pick it again `coin-control.ts:184` · 2b3dfd80
- `gap-g3#2` **low**: A site session's chain whose deposit Koios never answered keeps that deposit as sent for good: its money is hidden two hours, then the rest comes back directly with no word of Lovejoin `sessions.ts:1311` · 506e4ed2
- `gap-g4#1` **low**: A split route's leg paid between the runner's two reads of the account comes back alone, in a later return, directly, though its approval sent it through Lovejoin `sessions.ts:3904` · 506e4ed2
- `gap-g6#1` **low**: Kept verdicts carry no version of the rule that made them, so a fix to what counts as the wallet's never reaches rows and boxes an older release already judged `contract-scan.ts:264` · 4cbac01e, 506e4ed2
- `gap-g6#2` **low**: After a restore, what made a box is kept with only the accounts then known, so a custom account's (index 24 or more) deposit boxes read as the private balance's for good `lovejoin.ts:6324` · e66a6a16
- `l3screens#1` **low**: The run ad8c3ce4 adds after every order reads spent leaves the page saying "Waiting for the order to fill … Stop cancels it." and keeps Stop, whose dialog describes and prices a cancel that never happens `sessions.ts:3986` · abcf2ffe, 0dce8a6b
- `l3still#2` **low**: r2still#2's landedAfter cutoff takes a stranger's payment made while the swap's own return chain is being sent for the swap's own: its 'Lovejoin was left out' replaces how the swap came back (e2b#2 reopened) `sessions.ts:4728` · abcf2ffe
- `l3time#1` **low**: Bring one back takes its phrase pin only after giveme.my answers, and its watch isn't pinned at all: a Remove and a restore in that window put the first phrase's withdraw into the restored phrase's schedule, private history and Home watch `lovejoin.ts:7886` · abcf2ffe
- `l3time#2` **low**: r2still#2's wait counts runs, not time: a Refresh, Stop or Resume seconds after the run that read every order spent tells the outcome and builds the first return from listings no newer than that run's `sessions.ts:3986` · abcf2ffe
- `r2sign#2` **low**: A second "msg" under label 674 is signed and published, but the window shows only the first and says nothing of the rest: x1a#3's otherMetadata check passes it as part of the note `dapp.ts:2996` · 61a4d717
- `r2sign#3` **low**: Remove's new token rows show a token off the wallet's list in raw units: the decimals the Seedelf's UTxO carries never reach the review `withdraw.ts:188` · e4d97bea
- `r2still#2` **low**: gap-g4#1 is fixed only for a leg the second listing holds; a leg both listings miss still comes back alone and directly, and since e2b#2's strangers rule the swap's page no longer says so `sessions.ts:4704` · ad8c3ce4
- `r2tests#4` **low**: e4a#1's accounts.ts siblings: the merge's and check()'s phrase pins have no test, though the fixer's report says each sibling fails its own case `accounts.ts:288` · 459d4cf8
- `r2time#1` **low**: Bring one back paid by the public account: the watch's paysAccounts is read at the press, but the build pays and signs with whichever account is active after the reward-account read `lovejoin.ts:7155` · ad8c3ce4
- `r2time#2` **low**: e4a#1's class, left after the phrase-pin fix: the writes after a submit (the watch's take, Lovejoin's box-back history, a session return's landing) still go to whichever phrase is in when the network answers `lovejoin.ts:7814` · ad8c3ce4
- `w3#1` **low**: A tile Mix's chain (and Mix my boxes again's) runs at Settings' depth when the runner builds it, not the depth its review showed and its funding paid for `sessions.ts:4667` · fdd3b8b2
- `x1a#1` **low**: Send and Make public call the user's payment key under someone else's stake key "your own public account: it comes back", where the sign window says its staking rewards aren't yours `destination.ts:122` · 10a06db6, 6aea4fb8, 8fd738ff, d9e015fb
- `x2#2` **low**: A UTxO at a KEY address whose hash is the Seedelf contract's, under the user's register, counts in the private balance, and any spend that takes it fails: Max always fails for wallets of up to 20 private UTxOs `balances.ts:489` · 03cf290e, 343fb772, 4cbac01e, 514c6579, 6aea4fb8
- `x4#1` **low**: A due box's withdraw reads the five-minute quiet rule before its Koios reads and giveme.my, never again before its submit, so a send that starts in between is followed seconds later `lovejoin.ts:6901` · fdd3b8b2
- `x4#2` **low**: The sessions runner checks the unlock's wait once, before a step's Minswap and Koios calls: a lock and unlock during them sends the step seconds after the unlock `sessions.ts:3807` · fdd3b8b2
- `e3a#4` **nit**: manifest.ts names the extension with a ternary whose two branches are the same `manifest.ts:59` · d9e015fb
- `e7b#3` **nit**: KoiosProposal.expiration's doc says the opposite of how governance.ts reads it `koios.ts:289` · 2b3dfd80
- `gap-g7#4` **nit**: networks.ts's lovejoin.mixCost is read by nothing, and its doc still says it's for the settings' words `networks.ts:20` · 8fd738ff
- `r2tests#9` **nit**: e2b#2's 'nor clears' half (a strangers-only return leaves the skip reason alone) has no test `sessions.ts:5361` · ad8c3ce4
- `x1b#2` **nit**: withdraw.ts says a shortfall's `most` is one transaction, but WebAssembly builds it in parts, up to 25 `withdraw.ts:104` · 853d5779
- Guards now pinned by a test (T1): `t1g#1`, `t1g#2`, `t1g#3`, `t1g#4`, `t1g#5`, `t1g#6`, `t1g#7`, `t1g#8`, `t1g#9`, `t1g#10`, `t1g#11`, `t1g#12`, `t1g#13`, `t1g#14`, `t1h#1`, `t1h#2`, `t1h#3`, `t1h#4`, `t1h#5`, `t1h#6`, `t1h#7`, `t1h#8`, `t1h#9`, `t1h#10`, `t1h#12` · 506e4ed2
- Guards now pinned by a test (T1): `t1h#11` · c8003eda
- Guards now pinned by a test (T1): `t1i#1`, `t1i#4`, `t1i#5` · 5c5bc3c1, a9b5a3bb
- Guards now pinned by a test (T1): `t1i#6`, `t1i#7`, `t1l#14` · e66a6a16
- Guards now pinned by a test (T1): `t1i#8`, `t1i#17` · a9b5a3bb
- Guards now pinned by a test (T1): `t1j#1`, `t1j#2`, `t1j#3`, `t1j#4`, `t1j#5`, `t1j#6`, `t1j#7`, `t1j#8`, `t1j#9`, `t1j#10`, `t1j#11`, `t1j#12`, `t1j#13`, `t1j#14` · f1da256d
- Guards now pinned by a test (T1): `t1k#1`, `t1k#2`, `t1k#3`, `t1k#4`, `t1k#6`, `t1k#7`, `t1k#8`, `t1k#13`, `t1k#14` · f1da256d, 506e4ed2, c8003eda

### The screens

- `e3b#2` **low**: The connector's private-session form counts locked private UTxOs as available `DappApprovals.tsx:607` · d9e015fb
- `e3b#4` **low**: An approved request's failure stays on screen over the next request, right above its Sign `DappApprovals.tsx:169` · d9e015fb
- `e4b#1` **low**: A site can keep the wallet from auto-locking: each connector window it opens counts as user activity when it mounts `App.tsx:94` · 2b3dfd80
- `e7a#1` **low**: A token picked while the swap's review builds is named on the approval, beside the other token's quote, and Start swap runs the swap that was built `Swaps.tsx:926` · c8003eda
- `e8a#3` **low**: Pay from my private balance anyway warns of a tie to 'your public account' when the boxes it takes are another account's `Lovejoin.tsx:3649` · 10a06db6, c8003eda
- `e8b#2` **low**: The collateral payment's review doesn't show that it withdraws all the account's staking rewards `Collateral.tsx:194` · 8fd738ff
- `e8b#3` **low**: Bring everything back: a session left out while the switch rebuilds is chosen again when the rebuild lands `ClaimAll.tsx:111` · 8fd738ff
- `e9a#2` **low**: Transaction details show an unlisted token in raw units, while the review above them and Home scale it by Koios's decimals `TxDetail.tsx:351` · 8fd738ff
- `e9a#3` **low**: UTxO details call any address under payment key 0/0 'Your receive address, the one Receive shows', whatever its stake part `Utxos.tsx:411` · 10a06db6, 8fd738ff
- `e9b#1` **low**: Greek capitals Ν Μ Η Υ, and Cherokee or Lisu letters, slip past the check for tokens named like ADA or a listed token `format.ts:80` · 8fd738ff
- `gap-g10#1` **low**: A name padded with wide spaces before one last letter passes the lookalike and shared-name checks, and the one-line lists cut it to the name it copies `tokens.ts:116` · 8fd738ff
- `gap-g10#2` **low** (in part, as verified): Activity cuts a counterparty's address to its first 3 to 10 characters and its last 6, and the last 6 are a bech32 checksum anyone can solve for `Activity.tsx:415` · 8fd738ff
- `gap-g10#3` **low**: The Add tokens picker cuts a lookalike token's warning to "Calls itself SNEK, not on the…" in grey; Home's list shows it whole in amber (H-9), and the swap's picker cuts its mark too `TokenAmounts.tsx:269` · 8fd738ff
- `gap-g2#3` **low**: The Mix and Bootstrap forms count public UTxOs the build refuses (any reference script, a datum too deep to read), so 'What Lovejoin can spend' and the stepper offer boxes Review then refuses `Lovejoin.tsx:410` · 8fd738ff, c8003eda
- `l3screens#2` **low**: Where 7b6881f7 meets ad8c3ce4: a late leg's direct return now writes the session's skip reason, and the last step says "Directly: Lovejoin was left out" under its link to the swap's own return, which went through Lovejoin `Swaps.tsx:3106` · abcf2ffe
- `l3sign#2` **low**: The sign window shows a held token off the wallet's list in raw units, while the Transaction details it opens scale it: 10^6 apart for a 6-decimal token `DappApprovals.tsx:1069` · abcf2ffe
- `l3still#4` **low**: r2screens#1 is fixed only in part: the swap form and Send privately's too-much line still call the unlocked side 'your private balance', with nothing about the lock `Swaps.tsx:1152` · 7921367f, abcf2ffe
- `l3still#5` **low**: r2sign#3's class is fixed only in part: a session's return review shows a token off the wallet's list in raw units `SiteSessions.tsx:282` · abcf2ffe
- `l4worker#1` **low**: laterSkip treats any deposit or mix before the swap's first return as 'it went through Lovejoin'. So once anything comes back after a direct own return that had only its collateral's mix before it (the default), the page says the swap's own reason was a later part's and that the swap came back through Lovejoin `Swaps.tsx:3153` · 9cc81ed5
- `r2screens#1` **low**: The connect window's private session now calls the unlocked side what's "in your private balance", with nothing about the lock `DappApprovals.tsx:994` · 61a4d717
- `r2tests#1` **low**: d1#3's sign-window warning for a payment into Seedelf under a dead register has no test: drop it and the whole Vitest suite passes `DappApprovals.tsx:1212` · 61a4d717
- `r2tests#2` **low**: x1a#1/e9a#3's form notes on Send and Make public (stake works elsewhere) have no test; only the reviews' lines are pinned `CardanoSend.tsx:312` · 5ba328e5
- `r2tests#3` **low**: e8b#2's sibling: Create Seedelf's review line for withdrawn rewards has no test `CreateSeedelf.tsx:150` · 5ba328e5
- `x1a#3` **low**: The sign window leaves out "It carries metadata" whenever a note is shown, so a site's other metadata beside a CIP-20 note is never mentioned `DappApprovals.tsx:1083` · d9e015fb
- `x1b#1` **low**: A site session's Bring it back review through Lovejoin opens Transaction details on the chain's last transaction, unnamed, not the deposit `SiteSessions.tsx:299` · d9e015fb
- `e3b#5` **nit**: A sent funding's Cardanoscan link follows the wallet to the other network `DappApprovals.tsx:642` · d9e015fb
- `e7a#4` **nit**: A swap held by its wait after an unlock says it's asking Minswap now `Swaps.tsx:3288` · c8003eda
- `e7b#4` **nit**: Voting's "Inactive since epoch E" and the DRep card's "Active until the end of epoch E" read the same field an epoch apart `Voting.tsx:477` · c8003eda
- `e8a#2` **nit**: A public account's stopped chain on the hub says 'Mix my boxes again mixes the boxes it didn't', and doesn't name which account `Lovejoin.tsx:973` · c8003eda
- `e8b#4` **nit**: Bring everything back's total counts a token once per session, not once per kind `ClaimAll.tsx:259` · 8fd738ff
- `e8b#5` **nit**: Make private keeps a refusal on the form after the amount changes and after Back from its review, and Collateral keeps the review's error after Back `MoveIn.tsx:105` · 8fd738ff
- `e9a#5` **nit**: Private activity's CSV includes a private payment still marked Pending, against exported()'s own promise `Activity.tsx:305` · 8fd738ff
- `e9a#6` **nit**: Activity's details label a private session's funding or return, and a box back from Lovejoin, as 'Seedelf' `Activity.tsx:428` · 8fd738ff
- `e9b#3` **nit**: PlutusTree's Copy JSON isn't the detailed schema cardano-cli reads: ints are strings, and an unknown tag's constructor is null `PlutusTree.tsx:167` · 8fd738ff
- `gap-g10#4` **nit**: Amount boxes on the forms clip their own figures at the side panel's width: a token's box after Max, the swap's two amounts, Send's "Max, up to …" `styles.css:3449` · 8fd738ff
- `gap-g2#4` **nit**: Mix again from my public account's review says 'N boxes your public account put in' where the account has more there, with no 'N of your M' or 'Mix the rest once this is done' `Lovejoin.tsx:4113` · c8003eda
- `gap-g7#3` **nit**: Activity and Delegations show the bundled DRep names without plainName, which Voting applies to the same entries; the generator keeps bidi and zero-width characters `activity.ts:119` · c8003eda
- `l4worker#2` **nit**: In the spent step of a stopped swap, the timeline's third step still says 'Cancelled: The order's funds back at the account' though no cancel goes and the order was filled; abcf2ffe flagged spent for the line, sub-line, tag and Stop but not the timeline's `cancelled` `Swaps.tsx:3180` · 9cc81ed5
- `r2screens#2` **nit**: Review swap's re-ask still overwrites a quote for the token picked meanwhile; after Back the form is stuck on "Getting a quote…" `Swaps.tsx:836` · 7b6881f7
- `r2screens#3` **nit**: Bring everything back's button reads "Sending…" while its switch rebuilds the returns `ClaimAll.tsx:199` · 2d639df8
- Guards now pinned by a test (T1): `t1i#2`, `t1i#12`, `t1i#13`, `t1i#15` · 5c5bc3c1, a9b5a3bb
- Guards now pinned by a test (T1): `t1i#16` · 5c5bc3c1, c8003eda
- Guards now pinned by a test (T1): `t1k#9`, `t1k#10`, `t1k#11`, `t1k#12` · f1da256d, 506e4ed2, c8003eda
- Guards now pinned by a test (T1): `t1l#1`, `t1l#2`, `t1l#3`, `t1l#5`, `t1l#6`, `t1l#7`, `t1l#8`, `t1l#9`, `t1l#10`, `t1l#11`, `t1l#12`, `t1l#15`, `t1l#16`, `t1l#17`, `t1l#18`, `t1l#19`, `t1l#23` · f88560c4
- Guards now pinned by a test (T1): `t1l#4`, `t1l#13`, `t1l#20`, `t1l#21`, `t1l#22` · c8003eda

### The proofs

- `l3tests#2` **low**: count.py's new exit status fails a full audit run for modules Lake replays: they read STALE by mtime, and no check.sh run can clear that `count.py:153` · b0202c08
- `l3tests#3` **low**: check.sh's family runs no longer fail on an import's own sorry or Undetermined, and lovejoin-any-tx's 34 V2/Template imports were judged by none of the final runs `check.sh:275` · b0202c08
- `l3tests#4` **low**: test-tools.sh still passes with three of the rules it claims to hold dropped: check.sh's own sorry, its NO TRACE, and count.py's exit status `test-tools.sh:8` · b0202c08
- `l4tools#1` **low**: test-tools.sh doesn't hold two rules this commit states: the import walk reaching imports of imports, and traces dated only after a passed build. Either one reverted still passes all 41 checks `test-tools.sh:12` · 0198cb3f
- `r2tests#6` **low**: v3#1's fix (a failed rebuild never reads as ok) has no committed test: drop tally.py's traceless-import rule and nothing notices `tally.py:113` · ddc17685
- `r2verif#1` **low**: check.sh's new SORRY verdict depends on PlutusCoreBlaster's sorry sitting at CekMachine.lean:309; on IOG's main it is at 317, so every module reads SORRY and hides real Undetermined results `check.sh:233` · ddc17685
- `r2verif#2` **low**: check.sh reads #print axioms one line at a time, but Lean breaks a list over 120 columns into one axiom per line, so a native_decide (or a sorryAx listed after propext) reads ok `check.sh:240` · ddc17685
- `r2verif#3` **low**: A failed rebuild still reads ok when the module that fails is in a dependency package: check.sh removes nothing, and tally.py and count.py count the old builds `check.sh:250` · ddc17685
- `r2verif#4` **low**: run-all.sh's new failure list can never name `diag` for a LOOK or INCONCLUSIVE replay, because scan-diag.py exits 0 whatever it finds `run-all.sh:28` · ddc17685
- `r2verif#5` **low**: README's new Controls bullet says each every-transaction family has a control over its own builder, but most builders have none, and Template.AnyTxPurposes has none and isn't listed as an exception `README.md:95` · ddc17685
- `v3#1` **low**: tally.py and Audit/count.py report a module ok from its last good build's trace after its rebuild fails `tally.py:68` · 40883a55
- `v4a#1` **low** (in part, as verified): The wallet's every-transaction Blaster families have no Falsified control: 307 Valid theorems with nothing that would flag a vacuous Valid `WalletAnyTx.lean:43` · 40883a55
- `v4b#1` **low** (in part, as verified): AnyTx's output, reference and launch failure families have no passing control on their own builders `MixOutputControls.lean:124` · 40883a55
- `v5#1` **low**: CLAIMS.md's Blaster cross-check of the policy reads as covering every mint layout, but Blaster stops at five lines `CLAIMS.md:23` · 40883a55
- `v5#2` **low**: README says the LinesAll kernel theorems list Lean's axioms alone, but nothing guards them, so a sorry there passes check.sh `README.md:86` · 40883a55
- `l4tools#2` **nit**: tally.py's new advice for a stale trace, 'run ./check.sh on it', fails for every module of tally.py's documented `Slice/Slice` use: `./check.sh Slice.X` reads FAILED `tally.py:129` · 0198cb3f
- `r2docs#3` **nit**: The Lovejoin AnyTx README gives LogicLedgerUniqueness a weaker hypothesis than it has, and counts four of LogicBoxComposition's five theorems `README.md:203` · ddc17685
- `v3#3` **nit**: tally.py's docstring says check.sh's ok can't tell Valid from Undetermined, but since #372 check.sh can `tally.py:10` · 40883a55
- `v4a#2` **nit**: PolicyLinesAnyTx's header says mints of six lines or more 'aren't proved', though PolicyLinesAll proves every length in the kernel `PolicyLinesAnyTx.lean:22` · 40883a55
- `v4b#2` **nit**: AnyTx README understates the ledger hypotheses of LogicBoxComposition and of the _valid forms `README.md:195` · 40883a55
- `v5#3` **nit**: CLAIMS.md puts 'an input in every transaction' among Lovejoin's assumed ledger rules, but none of Lovejoin's theorems uses it `CLAIMS.md:31` · 40883a55

### Docs, build and CI

- `b1#1` **low**: The store zip's third-party notices sort in the builder's locale, so the same commit gives another zip in cs, sk, et, lt and lv `third-party.mjs:225` · c4b7a906
- `b1#4` **low**: The Windows release job prints the armored GPG secret key into the public Actions log `release.yml:108` · c4b7a906
- `b1#5` **low**: Every workflow pins its third-party actions by tag or branch, never by commit, in the jobs that sign the CLI and build the data layer's binary too `release.yml:18` · c4b7a906
- `d1#3` **low**: A site's payment into the Seedelf contract under a register-shaped datum that can't be spent is shown as 'without a register: anyone can take', when no one can ever take it `privacy.md:336` · 36fbb96f, d9e015fb
- `e9b#2` **low**: Anti-impersonation warnings in warning colour are left out of the accuracy-critical translation set `i18n-critical.mjs:84` · 10a06db6, fc6a0aa1
- `r2docs#1` **low**: flows.md says a stranger's later swap return never changes what the page says of the swap's own, but the timeline's last step still follows the latest return `flows.md:478` · 7b6881f7
- `r2docs#2` **low**: flows.md says a site's transaction note shows "as what's signed reads", but the sign window reads the metadata the site carries, never what the body's auxiliary_data_hash commits to `flows.md:431` · ca970760
- `r2still#3` **low**: This round's e7a#1, t1k#9 and t1j#6 tests fail on CI's preprod-only Vitest leg, so the fix PR's unit (preprod-only) job goes red and e7a#1's fix is pinned on one build only `swap-form-review.test.ts:309` · 04616cf6
- `r2tests#7` **low**: New test private-index.test.ts 'is neither the wallet's nor a Seedelf's place' runs 3 to 6.4 s in its own file against Vitest's default 5 s, and times out with nothing wrong `private-index.test.ts:344` · 459d4cf8
- `d1#4` **nit**: The root README's collateral rule has an exception it doesn't name: a session's 5 ₳ collateral mix spends the session's account under giveme.my's collateral `README.md:276` · c4b7a906
- `d1#5` **nit**: privacy.md says the recovery phrase can't be copied, but once revealed it's ordinary selectable text `privacy.md:276` · 10a06db6
- `d1#6` **nit**: The root README's troll attack says Bob pays more to spend the UTxO; Seedelf Wallet can't spend it at all `README.md:187` · c4b7a906
- `l3cli#4` **nit**: README says transfer, sweep and util mint can't spend a UTxO holding a reference script, but sweep --all sweeps them and --utxo spends them `README.md:195` · 5be0b1b4
- `r2docs#4` **nit**: architecture.md calls core's check_nesting "the one walk for every transaction from outside the wallet", but the worker's cbor.ts walk is the one guarding ogmiosUtxos on a site's transaction `architecture.md:195` · ca970760
- `r2docs#5` **nit**: privacy.md and architecture.md don't say that this release re-reads the private index from a snapshot and every pool copy once more, or that a reader version is now stored `privacy.md:230` · ca970760
- `r2docs#6` **nit**: flows.md's Collateral page still describes the automatic pick as any 5 ₳ of ADA, and two code comments cite a collateralFits in sessions.ts that no longer exists `flows.md:142` · ca970760
- `v2#1` **nit**: ownerContext's docstring reads as serialising each input reference separately; the source serialises the list once `definitions.lean:445` · 40883a55
- `v2#2` **nit**: ReadableLaunch's module doc reads as if the output search also requires an inline ReferenceDatum `definitions.lean:759` · 40883a55

## Pinned by another finding's test

- `t1a#12` low→low: An account mint's collateral return under its least: no test fails without it `build.rs:3747`: already pinned by an earlier round's test
- `t1c#9` low→low: A pool row away from mix_box's payment credential read as a box: no test fails without the credential check `mod.rs:416`: x2#1's test pins the new spends_as_mix_box call; its network half got its own test
- `t1e#12` low→low: A carry read back from an output that isn't it (two outputs could be the carry): no test fails without it `build.rs:2267`: the same guard as t1a#8, tested in core
- `t1i#3` low→low: A site's port from an iframe, a non-https page or another extension, refused: no test fails without it `sw.ts:364`: t1j#1's test (sw.ts)
- `t1i#9` low→low: A contract read that spans another wallet's keys, ended: no test fails without either same() check `contract-scan.ts:137`: t1k#3's tests (contract-scan.test.ts, private-index.test.ts)
- `t1i#10` low→low: An account switch while a payment that may still go through is open, refused: no test fails without it `handlers.ts:380`: t1j#12's test (handlers.test.ts)
- `t1i#11` low→low: Decline all, or any answer, refused for a private session's funding that's already sent: no test fails without either side's check `DappApprovals.tsx:197`: the worker's half is pinned; the window's half (declineAll's skip) is unreachable until e3b#3's fix
- `t1i#14` low→low: A private session's amount over the private balance, refused in the connect window: no test fails without the check `DappApprovals.tsx:687`: e3b#2's test (screens-wiring-review-fixes.test.ts)
- `t1k#5` low→low: A session swap or cancel carrying certificates, withdrawals, votes, proposals, mints, a missing witness or unknown inputs: no test fails without refuseOddities' refusals of them `sessions.ts:6867`: tested, except its parts (e) and (f): (e) is redundant behind the clauses before it, (f) dead behind :7056 with the real WebAssembly

## Moot: no test can fail without the guard

- `t1c#3` low→low: A launch's token quantity of 0 reaching the box-value probes (check_token): no test fails without it, since value.rs gives the same words `box_value.rs:193`: check_token's refusal has value.rs's own words for Q = 0, which runs whenever it's left out; the pair is pinned, and value.rs's layer got its own test (t1c#4)
- `t1e#8` low→low: A carry's amount being retried on the largest UTxOs: no test fails without it `lib.rs:3571`: a carry's spend is built over exactly the UTxOs it's given and never estimated at guessed budgets, so the guarded arm is never reached for one

## Unreachable today

- `t1c#16` low→low: A withdraw whose fee never settled: no test fails without the 'did not settle' refusal `mod.rs:1740`: the fee settles by the third round (only CBOR length jumps move it, by 176 lovelace, inside the 5,000 tolerance)
- `t1i#18` low→low: A private session's signature carrying no governance (DRep key): no test fails without the check, which no flow can reach `dapp.ts:2061`: governed() is false for any site on a session, and no flow puts governance on a session site's record

## Refuted

- `lead#1` medium→nit: A session's collateral tail takes the first 5 ₳ that fits the collateral rule, whoever's it is, so a stranger's plain 5 ₳ listed first is boxed and the session's own collateral comes back unmixed `lovejoin.rs:0`

## Not verified

- `w2#3` low→low: Transaction details converts a big number to decimal in quadratic time, so a site's 60 KB bignum freezes the worker for tens of seconds per open `decode.rs:480`: its trace verifier was stopped by the model's safeguards; not re-run

## Merged into another finding

`e3b#1` → `e3a#3`, `e5#1` → `r2a#1`, `e6#2` → `e4a#1`, `e8a#1` → `w3#1`, `e8b#6` → `e9a#1`, `l3money#1` → `l3cli#2`, `l3money#2` → `l3cli#1`, `l3money#3` → `l3cli#3`, `l3screens#3` → `l3still#2`, `l3still#1` → `l3screens#1`, `l3still#3` → `l3screens#2`, `l3tests#1` → `l3screens#1`, `r1#2` → `r4#4`, `r2b#1` → `r2a#1`, `r2still#1` → `r2sign#2`, `r2verif#6` → `r2docs#3`, `w1b#1` → `r2a#1`
