# Chunk 50 · Docs for someone who has never heard of Seedelf

**Status: ⬜ not started.** Written 2026-11-14 on `web-wallet/doc-audience-plan`, from `main` at `45a0b3bb`.

The owner, after reading some of the READMEs: they "read more like you are talking to me who knows what is going on and not to the audience that does not know what is going on. Like referencing chunks or commits, successes or failures, or even just talking about finding bugs". And: "Our documentation should be written for this outside user trying to find out what its all about, not reading a story about your adventure". Many of the docs are working files for the sessions, and that's fine. This chunk is about the ones a stranger reads.

Chunk 22 ([its record](../archive/plans/chunk-22-documentation-review.md)) checked every doc against the code. This chunk checks who each doc is written for. The facts are still checked against the code, never against another doc, as chunk 22 did. What changes is the voice, the order, and what's left out.

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
| [README.md](../../../../README.md) | The protocol: stealth addresses, the CLI, the known attacks | Mostly written for outsiders already: check it |
| [SECURITY.md](../../../../SECURITY.md), [RELEASE.md](../../../../RELEASE.md) | Reporting a vulnerability; checking a CLI release | Check them |
| [seedelf-contracts/README.md](../../../../seedelf-contracts/README.md), [AUDIT.md](../../../../seedelf-contracts/AUDIT.md), [happy-path-scripts/README.md](../../../../seedelf-contracts/happy-path-scripts/README.md) | The deployed scripts, their hashes, their audit | Check them. Commit `5b82530` stays: it's provenance |
| [seedelf-platform/README.md](../../../../seedelf-platform/README.md), and the four crate READMEs | The CLI, and the crates' pages on crates.io (`seedelf-cli` publishes this README: `readme = "../README.md"`) | Check them |
| [seedelf-web-wallet/README.md](../../README.md) | The wallet's front page | *Status* sends readers to the root CLAUDE.md for versioning. *Scope* tags features "(chunk 13)", "(chunk 18)", "(chunks 15 and 15b)". The docs table cites "chunk 23's usability review". *Reference: Lace* and *Decisions* are contributor material on the front page (Q4) |
| [extension/README.md](../../extension/README.md) | Its top half: what the extension does, screen by screen | The screens are mostly right. The build and test half is contributor tier |
| [brand/README.md](../../brand/README.md), [media/README.md](../../media/README.md) | The logo set, and the post images | One chunk reference in brand |
| [privacy.md](../privacy.md) | The wallet's privacy model: what's hidden, what isn't, and the rules it enforces | Tier is Q1. It opens "This doc keeps the older names", then "The owner's rule (2026-09-27)", and it cites chunks about 50 times |
| [store/README.md](../store/README.md) | The texts pasted into the listing | Those texts are outward. The notes around them are the owner's, and can stay |
| [store/privacy-policy.md](../store/privacy-policy.md) | The privacy policy | Already written for users: check it. Merging it publishes it |
| [releases.md](../releases.md) | For anyone checking a zip | Commits, hashes and tags stay. *What it carried* names chunks and "the gate", 1.1.0's row says "the owner has it", and the intro cites "(the owner, 2026-10-04)" (Q5) |
| [seedelf-data/README.md](../../../../seedelf-data/README.md) | The API's reference | It opens "The plan, and every decision behind it, is web wallet chunk 26", then "(web wallet chunk 34's 34c)", "(the owner, 2026-10-08)", "Checked end to end (2026-10-09)", "Checked against Koios (2026-10-11)", and the query planner's measurements. Those checks and measurements are maintainers' notes (Q3) |
| [seedelf-verification/README.md](../../../../seedelf-verification/README.md), [CLAIMS.md](../../../../seedelf-verification/CLAIMS.md) | What the proofs claim, for anyone who reads "formally verified" | The README has "(…, chunk 48)", "until upstream merges the fixes (chunk 41)", "as WalletRegister's operand order was in chunk 41", "Stop, and tell the owner only", and a *Status* made of chunk records. CLAIMS.md is close already |
| [seedelf-verification/Audit/README.md](../../../../seedelf-verification/Audit/README.md) | What the audit of the proofs was | Check it |

### Contributor: someone about to change the code

These are the design docs and how-tos:

- [architecture.md](../architecture.md), [flows.md](../flows.md), [keys-and-accounts.md](../keys-and-accounts.md), [development.md](../development.md), [lovejoin-mix-width.md](../lovejoin-mix-width.md), [i18n/glossary.md](../i18n/glossary.md);
- [wasm/README.md](../../wasm/README.md), the lower half of extension/README.md, [secret-box/README.md](../../extension/src/background/secret-box/README.md), [the Ogmios fixtures' README](../../../seedelf-core/tests/fixtures/ogmios/README.md);
- [seedelf-data/deploy/README.md](../../../../seedelf-data/deploy/README.md);
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
- **[plans/](README.md) and [archive/](../archive/plans/README.md):** the live prompts and the record. They're meant to name chunks, PRs and the owner.
- **[backlog.md](../backlog.md):** the owner's list. An outward doc that links it says what it is: what the maintainers might build next.
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

### 1. ⬜ The owner's calls

Ask Q1–Q5 at the start, in one set of questions. Record each answer here, with the date.

### 2. ⬜ The inventory

- **Read every outward file,** not only grep it. A grep finds the chunk, PR, date and owner markers. Narration ("this took", "turned out", "the fix") takes reading.
- **"Session" is a product word** (a private session), not a marker.
- **Record a short table per file here:** the line, what's wrong with it, and where a fact a maintainer still needs moves to.

### 3. ⬜ Rewrite the outward docs

- **One agent per group, each owning its files,** with no overlaps (chunk 22's way):
  1. the root README, SECURITY.md, RELEASE.md, and the contracts' READMEs and AUDIT.md;
  2. seedelf-platform's README and the crate READMEs;
  3. the web wallet's README, extension/README.md's top half, brand/ and media/;
  4. privacy.md (if Q1 says outward), store/README.md's texts, and releases.md;
  5. seedelf-data's README, and the split (Q3);
  6. seedelf-verification's README, CLAIMS.md and Audit/README.md.
- **Facts are checked against the code,** never against another doc.
- **Every link still resolves, anchors included,** and a file other docs link to keeps its path. Settings links store/privacy-policy.md by its GitHub URL, so that path never moves.

### 4. ⬜ The contributor docs, a light pass

- Feature names in place of chunk numbers; the narration and the history out.
- Rules, reasons, invariants and gotchas stay.
- **wasm/README.md's export table keeps its shape:** `readme_test.rs` reads it.

### 5. ⬜ The blind read

- **For each outward doc, a fresh Explore agent** is given only that file and this: "You have never heard of this project. What is it, what would you do with it, and what in this file couldn't you follow?" It lists every term, reference and aside it couldn't place.
- **Fix, and read again** until the list holds only terms the doc defines on purpose.
- **Then one more fresh reader goes through the whole diff,** across files. Chunk 22 found that where areas meet is where they break.

### 6. ⬜ Checks

- **Relative links and anchors:** a short script, kept in the scratchpad, over every changed file.
- **No markers left in an outward file:** `grep -nE 'chunk ?[0-9]|the owner|Claude|PR #|\bO[0-9]+\b'`. Justify each hit that's left.
- **`cargo test -p seedelf-wasm --test readme_test`,** if wasm/README.md changed.
- **No claim grew:** read the diff for wording that promises more than it did.

## When it lands

- **store/privacy-policy.md:** merging it publishes it. If it changes at all, ask the owner whether it takes a dated *Changes* entry.
- **store/README.md's texts go live** when the owner pastes them, at the next upload.
- **The crate READMEs and the CLI's README reach crates.io** only with the next CLI publish.
- **What the pass leaves open goes into [backlog.md](../backlog.md),** and this plan moves to [archive/plans/](../archive/plans/README.md) with its record.
