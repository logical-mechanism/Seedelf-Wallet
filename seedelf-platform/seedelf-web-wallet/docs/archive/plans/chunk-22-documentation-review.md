# Chunk 22: the documentation review

> **Finished record**, branch `web-wallet/doc-review` from `main` at `452c1fd` (after PR #277, chunk 21). It went straight into [archive/plans/](README.md), since it's done when its branch is. What it settled is in [post-release-roadmap.md](../../post-release-roadmap.md#the-documentation-review); what it left is in that file's *Owed*, *Kept in mind* and *Open questions*.

**The brief** was [post-release-roadmap.md](../../post-release-roadmap.md#the-documentation-review)'s: a major review once parity and the public side had landed, because every chunk since v1 rewrote part of what the docs say. **The owner brought it forward, ahead of the UX pass** (2026-10-04), and took the cost that implies: the pass keeps the docs current as it goes, rather than a second review after it ([development.md](../../development.md#rules-for-a-change-to-the-screens)).

## The owner's calls

- **Finished plans move to [archive/plans/](README.md)**, not a status line on each: `plans/` holds live specs only, and what still holds moves into the design docs first ([plans/README.md](../../plans/README.md)). Open question 4, settled.
- **The docs don't date releases or describe the store** — what's live, in review or taken down. "No users needs to know that information", and review takes as long as it takes. A commit and a zip hash are build provenance and stay.
- **Fix both code bugs the review found, on this branch**, and **drop the broken CLI installer from the README** rather than fix it.

## How it ran

Nine reviewers in parallel, each owning a set of files no other one touched, so nothing collided: root and CLAUDE.md; the web wallet's READMEs and development.md; the WebAssembly README and its scripts; architecture.md; flows.md and keys-and-accounts.md; privacy.md and store/; and three read-only audits of the plans, the reviews and both roadmaps. **The rule they worked to: a doc is Claude's own writing, so it's checked against the code, never against another doc.** The editing ones fixed verified drift in place and reported judgment calls; the audits found what the plans held that nothing live did. A second round lifted that into the design docs, each by the reviewer that owned the file. Then two fresh reviewers read the whole diff across files, and the suites ran.

## What changed

- **Every design doc against the code.** architecture.md alone took about 50 edits: the builder list (`draftTransfer` and three other draft/finish pairs were gone since the crypto review), eight missing storage keys, the module's size, chunk 21's DRep building, the components added since chunk 11. flows.md gained a Lovejoin flow and a several-accounts flow it never had. privacy.md gained the language, the dApp account, the raw-CBOR copy, GitHub's links, and the rule that "default never means only" with the five proposals the owner declined.
- **What only the plans knew, lifted:** the i18n rules (architecture.md *UI*), the restore scan's design and the one-time spend key (keys-and-accounts.md), A2's design (flows.md *Contract round trip*), the rules for a change to the screens (development.md), Lovejoin's domain separation and the never-copy-from-upstream rule (architecture.md *Lovejoin*), the queue that isn't re-entrant (architecture.md *Service worker*).
- **Open items that were tracked nowhere live, now in the roadmap:** the restore scan (O5), chunk 21's checks by hand (O6), the public Activity's blind spots (O7), dates and numbers (O8), what to tell Lovejoin (O9), and about twenty smaller ones under *Kept in mind*.
- **The agent-facing files.** The root CLAUDE.md had no web wallet at all — no crate, no commands — and both CLAUDE.md files had the crate dependencies backwards (`koios` depends on `crypto`; `display` on `koios`; `core` not on `display`).
- **post-release-roadmap.md contradicted the code on the connector** for two days: P1 still said a site stays bound to its account and is refused, which the owner had replaced the same day with one dApp account (Eternl's model).
- **The store files.** [store/privacy-policy.md](../../store/privacy-policy.md) never had chunks 18 and 19 (several accounts and discovery's Koios requests, the dApp account, the language); now it does, with a change-log entry. [store/README.md](../../store/README.md)'s pasted texts gained the IPFS gateway, governance and the second alarm, and lost its store-status lines. **Both go live only when the owner pastes or merges them.**
- **The WebAssembly README** re-measured (2,632 KB raw / 797 KB gzip for `wasm-release`, from 1,223 / 424 on 2026-09-24), its API table rebuilt against the exports (8 gone, 39 missing).

## Code

- **Account 24301' is never a public account.** Settings → Public accounts → **Add it** accepted it, so private sessions' money (session `i` is `0/i` of that account) would have read, and spent, as a public account's — privacy.md's rule 6 was a claim nothing enforced. `isAccountIndex` refuses it now, so `check`, `add`, `use`, a stored active account and a stored dApp account all do; `worker.accounts.reserved` says why, in three languages. A test pins `ONE_TIME_ACCOUNT` to the real derivation (session 0's address is that account's `0/0`).
- **The CLI's `fund` checks `build::is_payable`.** It re-randomized the target's register, which keeps torsion out but not the identity, so funding a hand-minted Seedelf whose public value is the identity would have paid anyone. The new test fails without the check.
- **Three fixture recorders** (`record-{transfer,mint,withdraw}.mjs`) called exports the crypto review removed, and were broken since 2026-09-25: they're outside CI's globs. Fixed and dry-run offline; their committed fixtures are untouched.
- **Comments** that described the replaced connector model (`wallet.ts`, `dapp.ts`), a test that doesn't exist (`i18n-parity.test.ts`), and a size that halved twice (`Cargo.toml`).

## Worth remembering

- **The docs were wrong in exactly the ways the brief predicted, and in one it didn't: the agent-facing files were the worst.** A session reading the root CLAUDE.md would not have known the web wallet existed.
- **A doc that enumerates is the one that rots** — a list of storage keys, exports, screens, Settings rows. Every one was short by what the last few chunks added. The rules for a change to the screens now say a renamed control updates flows.md in the same commit.
- **Review IDs are references** — code and tests cite them about 800 times — so the reviews moved without a line changed. The launch review's second round ("final review sessions-1" and so on) is listed in no file at all, only in its fix commits; [archive/plans/README.md](README.md) says how to find one.

## For the owner

- **Merge = publish** for the privacy policy, and the next upload uses store/README.md's texts.
- **Open questions** ([post-release-roadmap.md](../../post-release-roadmap.md#open-questions-for-the-owner)): `rustls`, Spanish "Configuración", and whether the web wallet is in the bug bounty's scope (SECURITY.md says "the latest tagged release", which it never is).
- **Not done:** the crate READMEs written here reach crates.io only with the next CLI publish; the two release sections in development.md overlap and were left as they are.
