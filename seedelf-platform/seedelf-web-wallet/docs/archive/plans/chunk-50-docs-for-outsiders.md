# Chunk 50 · Docs for someone who has never heard of Seedelf

**Status: ✅ done**, merged 2026-11-17 as `81e49075` (PR #387, `web-wallet/doc-audience`, from `main` at `cb83f18e`). Written 2026-11-14 on `web-wallet/doc-audience-plan` (PR #383), from `main` at `45a0b3bb`. The record is at the end.

The owner, after reading some of the READMEs: they "read more like you are talking to me who knows what is going on and not to the audience that does not know what is going on. Like referencing chunks or commits, successes or failures, or even just talking about finding bugs". And: "Our documentation should be written for this outside user trying to find out what its all about, not reading a story about your adventure". Many of the docs are working files for the sessions, and that's fine. This chunk is about the ones a stranger reads.

Chunk 22 ([its record](chunk-22-documentation-review.md)) checked every doc against the code. This chunk checks who each doc is written for. The facts are still checked against the code, never against another doc, as chunk 22 did. What changes is the voice, the order, and what's left out.

## Start here

- **Read first:**
  - chunk 22's record: how nine reviewers split the files so that none collided;
  - this plan's *How an outward doc reads*, which is the brief every rewrite works to.
- **Branch `web-wallet/doc-audience` from `main`**, once this plan has merged.
- **It's docs only.** CI's check skips Markdown, except `wasm/README.md`: `readme_test.rs` reads its export table, so touching that file runs the full suite.
- **The owner's standing rules:**
  - Stage files by path.
  - Push or open a PR only when the owner asks.
  - No formatter: there's no prettier config, and the house width is about 120.
  - The docs never date a release or say what the store is doing.
  - The name is Seedelf (Seedelfs), and the app is Seedelf Wallet.

## Who reads what

Every tracked Markdown file is in one of three tiers.

### Outward: someone who has never heard of Seedelf

They found the GitHub repo, the Chrome Web Store listing, a crate on crates.io, or the API. They know Cardano at most. They want to know:

- what this is, and what it does for them;
- how to get it or run it, and how to check it;
- what it costs, and where it stops;
- where to ask.

| File | What it's for | In the wrong voice now (examples, not the full list) |
|---|---|---|
| [README.md](../../../../../README.md) | The protocol: stealth addresses, the CLI, the known attacks | Mostly written for outsiders already: check it |
| [SECURITY.md](../../../../../SECURITY.md), [RELEASE.md](../../../../../RELEASE.md) | Reporting a vulnerability; checking a CLI release | Check them |
| [seedelf-contracts/README.md](../../../../../seedelf-contracts/README.md), [AUDIT.md](../../../../../seedelf-contracts/AUDIT.md), [happy-path-scripts/README.md](../../../../../seedelf-contracts/happy-path-scripts/README.md) | The deployed scripts, their hashes, their audit | Check them. Commit `5b82530` stays: it's provenance |
| [seedelf-platform/README.md](../../../../../seedelf-platform/README.md), and the four crate READMEs | The CLI, and the crates' pages on crates.io (`seedelf-cli` publishes this README: `readme = "../README.md"`) | Check them |
| [seedelf-web-wallet/README.md](../../../README.md) | The wallet's front page | *Status* sends readers to the root CLAUDE.md for versioning. *Scope* tags features "(chunk 13)", "(chunk 18)", "(chunks 15 and 15b)". The docs table cites "chunk 23's usability review". *Reference: Lace* and *Decisions* are contributor material on the front page (Q4) |
| [extension/README.md](../../../extension/README.md) | Its top half: what the extension does, screen by screen | The screens are mostly right. The build and test half is contributor tier |
| [brand/README.md](../../../brand/README.md), [media/README.md](../../../media/README.md) | The logo set, and the post images | One chunk reference in brand |
| [privacy.md](../../privacy.md) | The wallet's privacy model: what's hidden, what isn't, and the rules it enforces | Tier is Q1. It opens "This doc keeps the older names", then "The owner's rule (2026-09-27)", and it cites chunks about 50 times |
| [store/README.md](../../store/README.md) | The texts pasted into the listing | Those texts are outward. The notes around them are the owner's, and can stay |
| [store/privacy-policy.md](../../store/privacy-policy.md) | The privacy policy | Already written for users: check it. Merging it publishes it |
| [releases.md](../../releases.md) | For anyone checking a zip | Commits, hashes and tags stay. *What it carried* names chunks and "the gate", 1.1.0's row says "the owner has it", and the intro cites "(the owner, 2026-10-04)" (Q5) |
| [seedelf-data/README.md](../../../../../seedelf-data/README.md) | The API's reference | It opens "The plan, and every decision behind it, is web wallet chunk 26", then "(web wallet chunk 34's 34c)", "(the owner, 2026-10-08)", "Checked end to end (2026-10-09)", "Checked against Koios (2026-10-11)", and the query planner's measurements. Those checks and measurements are maintainers' notes (Q3) |
| [seedelf-verification/README.md](../../../../../seedelf-verification/README.md), [CLAIMS.md](../../../../../seedelf-verification/CLAIMS.md) | What the proofs claim, for anyone who reads "formally verified" | The README has "(…, chunk 48)", "until upstream merges the fixes (chunk 41)", "as WalletRegister's operand order was in chunk 41", "Stop, and tell the owner only", and a *Next* made of chunk records. CLAIMS.md is close already |
| [seedelf-verification/Audit/README.md](../../../../../seedelf-verification/Audit/README.md) | What the audit of the proofs was | Check it |

### Contributor: someone about to change the code

These are the design docs and how-tos:

- [architecture.md](../../architecture.md), [flows.md](../../flows.md), [keys-and-accounts.md](../../keys-and-accounts.md), [development.md](../../development.md), [lovejoin-mix-width.md](../../lovejoin-mix-width.md), [i18n/glossary.md](../../i18n/glossary.md);
- [wasm/README.md](../../../wasm/README.md), the lower half of extension/README.md, [secret-box/README.md](../../../extension/src/background/secret-box/README.md), [the Ogmios fixtures' README](../../../../seedelf-core/tests/fixtures/ogmios/README.md);
- [seedelf-data/deploy/README.md](../../../../../seedelf-data/deploy/README.md);
- the verification modules' READMEs: `Lovejoin/AnyTx`, `Lovejoin/Every`, `Seedelf/Every`.

The working sessions read these too, so they keep more:

- **Stays:** the rule and its reason, the invariant, the gotcha. The owner's settled calls stay findable (Q2).
- **Goes:**
  - a chunk number used as a feature's label: "Staking (chunk 13)" becomes "Staking";
  - "we found" and "it took three tries" narration;
  - fix history that git and the archive already hold.
- **Example:** wasm/README.md's export table tags exports with chunks ("Lovejoin (chunk 16)", "(chunk 17, `src/decode.rs`)"). It also keeps 2026-09-24's `wasm-opt` row beside a note that its module was "less than half today's".

### Working files: left as they are

- **The three CLAUDE.md files:** written for agents.
- **[plans/](../../plans/README.md) and [archive/](README.md):** the live prompts and the record. They're meant to name chunks, PRs and the owner.
- **[backlog.md](../../backlog.md):** the owner's list. An outward doc that links it says what it is: what the maintainers might build next.
- **`seedelf-verification/Audit/review/findings.md`:** the audit's record.
- **`seedelf-verification/Upstream/drafts/`:** written for upstream's maintainers.
- **`media/x/*/thread.md`:** posts already out. Never edit them; raise a wrong claim in one with the owner.
- **`extension/.claude/skills/`:** Google's skill. Never touch it.
- **Code comments:** out of scope.

## How an outward doc reads

- **It opens with what the thing is, and who it's for,** in a sentence or two. Then how to get it or use it, how it works, its limits, and where to get help.
- **Present tense, and today's state.** How it got here is in git and the archive.
- **Out:**
  - chunk numbers and letters;
  - backlog and review IDs (O5, M1, P1, 34c);
  - PR numbers or commits told as a story ("fixed in #359", "after chunk 15b's fix");
  - "the owner", Claude, sessions of work, fix rounds, gates;
  - "we found", "we tried", "measured on 2026-…";
  - bug hunts and their fixes;
  - branch names;
  - a plan as the place where a thing is explained.
- **In, and kept exact: what the reader uses to verify.**
  - the deployed contracts' commit `5b82530` and toolchain, the script hashes, the reference UTxOs;
  - a release's commit, zip SHA-256 and tag;
  - the pinned upstream commits a proof needs, and the toolchain versions.
  
  A measurement keeps what it ran on. Its date stays only where the reader needs to know how old it is.
- **The honesty stays.** Every limit, known link, privacy note and "unaudited" stays. It reads as a fact about the wallet, not as a finding. Docs aren't marketing, so no claim grows in the rewrite.
- **A fact a maintainer still needs moves** to that area's contributor doc, and is never dropped. History is just dropped.
- **A link to a contributor doc is a pointer at the end** ("For contributors: …"), never the place the reader goes to understand the thing.
- **House style:** short sentences, one idea each, and the name style above.

## The owner's calls ❓

- **Q1 · privacy.md's tier.** It's the wallet's privacy model, and the README sends readers there for the known links. **Recommended: outward.** Its record of rules moves to a contributor section at its end, or to backlog.md's *Declined*: the owner's dated calls, and the five proposals declined.
- **Q2 · The owner's dated calls in contributor docs,** such as "(the owner, 2026-10-17)". The sessions use them to know that a call is settled. **Recommended:** keep them in contributor docs, short, at the end of the rule. Drop them from outward docs.
- **Q3 · seedelf-data's README: split it, or trim it.** **Recommended: split.**
  - The README keeps what the API serves, its endpoints, how to run it, what it reads, and its limits.
  - A maintainers' file beside it (say `seedelf-data/NOTES.md`) takes the Koios cross-checks, the planner measurements, and why each decision was made.
- **Q4 · The web wallet README's *Reference: Lace* and *Decisions*.** **Recommended:**
  - *Decisions* stays, in plain words, as *How it's built*.
  - *Reference: Lace* moves to development.md.
- **Q5 · releases.md's *What it carried*.** **Recommended:**
  - Say what changed for the user, and keep the PR numbers as links, since a verifier follows them.
  - Chunk numbers and "the gate" go.
  - 1.1.0's row says "not recorded", not "the owner has it".

## Steps

### 1. ✅ The owner's calls

Asked 2026-11-17, with a sixth the inventory raised. The answers:

- **Q1 · privacy.md is outward.** The owner's dated calls and the five declined proposals move to [backlog.md](../../backlog.md)'s *Declined*. The rules and the known links stay, stated as facts.
- **Q2 · Dated calls are dropped everywhere,** contributor docs included. The rule and its reason stay; git and the archive hold who called it and when. The CLAUDE.md files and the working files keep theirs.
- **Q3 · seedelf-data's README is split.** It keeps what the API serves, its routes, how to run it, what it reads, and its limits. A new `seedelf-data/NOTES.md` takes the Koios cross-checks, the planner measurements, and why each decision was made.
- **Q4 · The web wallet README's *Reference: Lace* and *Decisions* both move to [development.md](../../development.md).** The front page keeps what a user needs.
- **Q5 · releases.md's *What it carried* says what changed for the user,** with the PR numbers kept as links. Chunk numbers and "the gate" go. 1.1.0's commit and hash read "not recorded".
- **Q6 · releases.md's *Recording a release* and its per-release *Records* move,** unedited, to a new [release-records.md](../../plans/release-records.md) beside the plans, a working file. releases.md keeps the table and how to verify a zip, and links the records as the maintainers'.

Four more, asked 2026-11-17 once the blind reads were in:

- **Q7 · The package's summary is fixed in this PR,** so the PR runs the full suite. `SUMMARY` in extension/src/manifest.ts said "pay anyone privately", but only a Seedelf can be paid privately. It now says "pay anyone's Seedelf privately", in the three languages, back-translated blind, and store/README.md's copies match. It ships with the next zip.
- **Q8 · Seedelf's own audit status stays unstated.** The docs add no line on it. AUDIT.md says what it reviewed and that it isn't version 1.
- **Q9 · The privacy policy's line 77 is reworded now,** with a dated *Changes* entry: "We don't collect … any data" sat badly beside our two services receiving what the page lists. Merging publishes it.
- **Q10 · The CLI README's links are absolute GitHub URLs,** so they work on its crates.io page, from the next CLI publish.
- **Q11 · No doc says who makes or maintains Seedelf** (the owner, reading the pushed branch): "made by Logical Mechanism" is redundant on Logical Mechanism's own GitHub and its own store listing. The lines the rewrite added are out, the store texts' "we're Logical Mechanism" in all three languages too. On a second reading, who runs giveme.my and the data layer went too ("Does the reader need to know this information"): the docs say "its own server" and "a collateral service". Where one party seeing both is the privacy fact, privacy.md says "the same operator". The privacy policy keeps its publisher and "our" services, and the store's host justification "run by the developer".
- **Q12 · The owner's second reading:** most of it reads right; these parts read as machine-written, and are fixed.
  - **A Seedelf is an NFT whose name works like an ADA Handle for the contract,** in every doc and the store texts, never "your name in the contract" or "the name a private balance is paid by". A register is "a fresh, random-looking form of its owner's key", never "a copy".
  - **No "beta":** everything is released and in use. The CLI README's beta note is gone.
  - **"Not right now", never "Not planned":** the web wallet README's list leaves things open. A hardware wallet's limit is technical, so it moved to *Limits*.
  - **Seedelf's docs talk about Seedelf.** The web wallet README's Lovejoin section is three lines, the store's Lovejoin paragraph lost the pool-start rules (all three languages, sentences cut, none newly translated but the Seedelf and register lines), and the verification README and CLAIMS.md lead with Seedelf, Lovejoin v2 after it.
  - **A plain-words pass:** four read-only reviewers flagged the awkward lines in the long docs, and each fix was checked against the file and, where it describes behaviour, the code or UI text.

### 2. ✅ The inventory

- **Read every outward file,** not only grep it. A grep finds the chunk, PR, date and owner markers. Narration ("this took", "turned out", "the fix") takes reading.
- **"Session" is a product word** (a private session), not a marker.
- **Record a short table per file here:** the line, what's wrong with it, and where a fact a maintainer still needs moves to.

Each rewrite agent read its files whole and made its per-line table before it edited, in its handoff. What they found, per file, and where the maintainers' facts went:

| File | What was wrong | Where facts moved |
|---|---|---|
| README.md | Little: an insider aside on the web wallet's internals, "the later, undeployed build", a backlog pointer; no opener for a stranger; a 33-byte example token name | Nowhere: restated at the root's level, with a pointer to privacy.md |
| SECURITY.md, RELEASE.md | No opener; RELEASE.md had no way to check a release, and lesson-sounding lines | RELEASE.md gained *Checking a release* (the files, the key's fingerprint, the commands) |
| seedelf-contracts/README.md, AUDIT.md, happy-path-scripts/README.md | Rename and toolchain history; no way to check version 1; AUDIT.md's scope didn't say it isn't version 1; the happy path's order burned the Seedelf later steps needed, and it left out a fourth wallet | The contracts README gained *Checking version 1*; contributor rules under *For contributors* |
| seedelf-platform/README.md, the four crate READMEs | `welcome` said to create the wallet (the first run does); `util migrate` "isn't built yet"; collateral and `--utxo`/`--asset` overstated; past-bug phrasing in the crates | None |
| seedelf-web-wallet/README.md | Chunk tags in *Scope*; the root CLAUDE.md for versioning; an Earn/RealFi note; release, backlog and plans process; Remove's default wrong (on main too) | *Reference: Lace* and *Decisions* to development.md (Q4) |
| extension/README.md, brand/, media/ | "move-in" in the user half; Lovejoin history; no install link; Remove's default wrong; maintainer notes in brand/ and media/ | brand/'s and media/'s notes under *For contributors* |
| docs/privacy.md | The older names; the owner's dated rule; about 50 chunk citations; version history; "no UTxO of yours" in a private spend (false); the principle stated without its qualifier | The declined proposals to backlog.md's *Declined* (Q1); code names to *For contributors* |
| docs/store/README.md (the texts) | "pay anyone privately"; "can't be linked" stated as absolute; contract history in the Lovejoin bullet | None. The notes around the texts stay the maintainer's |
| docs/store/privacy-policy.md | Unchanged: its blind read goes to the owner | None |
| docs/releases.md | Chunks and "the gate" in *What it carried*; "the owner has it"; the records below the table | *Recording a release* and the records to plans/release-records.md (Q6) |
| seedelf-data/README.md | Opened on chunk 26; dated checks, Koios cross-checks, planner timings, build history; no working request | NOTES.md (Q3); the VPS meter's gotcha to deploy/README.md |
| seedelf-verification/README.md, CLAIMS.md, Audit/README.md | Chunk records, bare PR numbers, review state, "tell the owner only"; the opening claimed every Lovejoin script Seedelf uses (the retired pools' aren't proved); PR #455 read as merged; a missing pin | *Found along the way* and *Writing a property* under *For contributors* (Lean comments cite them); plan links to the modules' *Plans and records*; the Falsified rule to Lovejoin/AnyTx/README.md |
| Contributor docs (Step 4) | Chunk labels, the owner's dated calls, fix history | Nothing dropped; review IDs that code cites stay |

### 3. ✅ Rewrite the outward docs

Done by agents 1–6 below, in one working tree, each owning its files. A shared brief held the rules and asked for a handoff per agent: its inventory, its changes, the facts it fixed against the code, the moves other owners had to make, and its questions. Facts the agents fixed against the code, among others: the first run of any command creates the CLI's wallet, not `welcome`; `/health` also answers 503 past the month's traffic ceiling; the data layer's connections are the private index's 2 and the tip's 1; the verification README lacked CardanoLedgerApiBlaster's pin.

- **One agent per group, each owning its files,** with no overlaps (chunk 22's way):
  1. the root README, SECURITY.md, RELEASE.md, and the contracts' READMEs and AUDIT.md;
  2. seedelf-platform's README and the crate READMEs;
  3. the web wallet's README, extension/README.md's top half, brand/ and media/;
  4. privacy.md (if Q1 says outward), store/README.md's texts, and releases.md;
  5. seedelf-data's README, and the split (Q3);
  6. seedelf-verification's README, CLAIMS.md and Audit/README.md.
- **Facts are checked against the code,** never against another doc.
- **Every link still resolves, anchors included,** and a file other docs link to keeps its path. Settings links store/privacy-policy.md by its GitHub URL, so that path never moves.

### 4. ✅ The contributor docs, a light pass

Run beside Step 3: agent 7 took architecture.md, agent 8 flows.md, keys-and-accounts.md, lovejoin-mix-width.md and the glossary, and agents 2, 3, 5 and 6 the contributor files in their areas. Every heading stayed. The review IDs code cites stay (about 260 in architecture.md, 250 in flows.md), so flows.md is still dense.

- Feature names in place of chunk numbers; the narration and the history out.
- Rules, reasons, invariants and gotchas stay.
- **wasm/README.md's export table keeps its shape:** `readme_test.rs` reads it.

### 5. ✅ The blind read

- **Round 1:** 20 fresh Explore readers, one a file (the four crate READMEs together). Each owner sorted its list by one rule: notes and history go, a term gets the smallest definition that lets a reader follow, a promise points at its proof or is softened, and nothing is added that the repository can't source.
- **Round 2:** 14 fresh readers on the files that changed most. Their lists held no internal notes bar a few history phrasings, which went; what's left is terms the docs define on purpose and promises the owner may want backed.
- **The cross-file reader** found 27 problems where areas meet, every one fixed. Among them: the verification README claimed every Lovejoin script Seedelf uses, but the retired pools' aren't proved; Remove's default was wrong in two READMEs (on main too); privacy.md said no UTxO of yours is in a private spend; and the store text grew "one of many" and dropped that new boxes go only into the earliest v2 pool.

- **For each outward doc, a fresh Explore agent** is given only that file and this: "You have never heard of this project. What is it, what would you do with it, and what in this file couldn't you follow?" It lists every term, reference and aside it couldn't place.
- **Fix, and read again** until the list holds only terms the doc defines on purpose.
- **Then one more fresh reader goes through the whole diff,** across files. Chunk 22 found that where areas meet is where they break.

### 6. ✅ Checks

All four ran on the final tree. The link script read every tracked Markdown file (1,574 relative links on main, none broken there or here). The marker grep's only hits left are the owner of a UTxO and the pinned upstream PRs a verifier follows. `readme_test` passes. The cross-file reader checked for claims that grew, and those it found are fixed.

- **Relative links and anchors:** a short script, kept in the scratchpad, over every changed file.
- **No markers left in an outward file:** `grep -nE 'chunk ?[0-9]|the owner|Claude|PR #|\bO[0-9]+\b'`. Justify each hit that's left.
- **`cargo test -p seedelf-wasm --test readme_test`,** if wasm/README.md changed.
- **No claim grew:** read the diff for wording that promises more than it did.

## When it landed

- **store/privacy-policy.md** changed (Q9) with a dated *Changes* entry, so merging #387 published it.
- **What waits for the next upload:** a line in [backlog.md](../../backlog.md)'s *Owed*.
  - store/README.md's texts changed in all three languages, and go live once they're pasted in.
  - Captions 2 and 3 changed in `e2e/store-images.spec.ts`, but no screen did. So [development.md](../../development.md)'s image step now runs when a caption changes, as well as when the UI does.
- **The crate READMEs and the CLI's README reach crates.io** with the next CLI publish, from [RELEASE.md](../../../../../RELEASE.md)'s steps. Nothing to track.
- **Nothing else was left open.** The blind readers' last lists held only terms the docs define on purpose.

## Record

PR #383 (`web-wallet/doc-audience-plan`, merged as `8cd2b425`): this plan.

PR #387 (`web-wallet/doc-audience`, into `main`, merged as `81e49075`):
- `481ddb1f`: the rewrite of the outward docs, the contributor docs' light pass, the splits (`seedelf-data/NOTES.md`, `plans/release-records.md`) and the owner's calls Q1–Q6;
- `b1e71d86`: the package's summary says only a Seedelf is paid privately (Q7), in three languages;
- `126c6558`: no line says who makes Seedelf (Q11);
- `05dd3093`: plain words, Seedelf first, no beta (Q12);
- `c303753e`, `1d41dfed` and `c847fdfa`: the readability pass, the human-readability and audience review, and a last pass over the privacy, trust and verification claims;
- `eb59d39b`: the store captions say what a payment shows, and the policy says who gets what.

This file moved here with chunk 51's plan, on `web-wallet/whole-review-plan`.
