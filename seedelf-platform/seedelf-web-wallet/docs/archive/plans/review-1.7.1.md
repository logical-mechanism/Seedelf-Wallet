# 1.7.1's release review and its fixes (2026-10-30)

**Status: ✅ done.** It's on branch `web-wallet/review-1.7.1`, from `main` at `4c06171a` (after #351). It reviewed everything since `web-wallet/1.7.0` (`f375af62`, the commit 1.7.0's zip was built from), and its fixes go into 1.7.1 before it's packaged. What still holds is in the design docs, and the open items are in [post-release-roadmap.md](../post-release-roadmap.md) and the release's handoff note in [roadmap.md](../roadmap.md).

## The review

**What it covered:** #345–#351, as one tree at `4c06171a`.
- **Code:** #350 (a pool the data layer lists is kept as it comes) and #351 (a site's sign window says when its transaction expires).
- **Docs:** #345 (1.7.0's record), #347 and #349 (SECURITY.md, the README's *Data Layer Reliance*), and #348 (`media/`, the X thread's images).
- **#346, CLI 0.6.1,** only as the extension build sees it: the workspace's version, 0.6.0 → 0.6.1. No shared crate's code changed, and nothing reaches the WebAssembly or the UI but the version.

**How:** six reviewers.
- One each for #350's code and #351's code, each with a mutation sandbox (a worktree at `4c06171a`);
- the translations;
- the docs;
- the media and its CI rule;
- across the PRs, the release itself included.

Every low from the #350, #351, translations and cross reviewers got a trace (13, eight of them on docs); a high or medium would have had its impact judged too. Their nits, and the docs and media reviewers' findings, came straight to the lead, as the owner asked for docs PRs (1.7.0's review). Then two reviewers read the fixes themselves, and found ten more, all fixed; among them, in the code, the two last looks read one after the other, a test that didn't pin the last look and a rounding check blind one run in 60, and in the docs, what the bypass did and a private Bootstrap's fees. A last reviewer read those fixes and found eight small ones, fixed too, signData's look left unpinned by the new test among them. Separately, the lead ran the extension's suites on `4c06171a` before any fix (Rust and the WebAssembly's tests were CI's): #351 merged before its CI finished.

**33 findings** (1 medium, the media's; 19 low; 12 nits; one owner's call, docs#5), which came down to 25 issues once the reviewers' overlaps were merged: 1 medium, 11 low, 12 nits and that owner's call, settled by the fresh pass below. Every finding the verifiers traced held, four only in part. What was "partly" in each was the reach or the fix, never whether the fault is real.

## What was fixed

**The code (`dapp.ts`, `format.ts`, `DappApprovals.tsx`):**
- **A signature still being read as Settings moves the network is refused, never shown** (pr351#1). Before, it reached the window on the other network, where #351's dates read about 742 days off, along with the tokens. Sign already signed nothing there. Now `sameNetwork` refuses it, read in one turn with `sameAccount`'s as the last look before `ask`, with what `networkChanged` tells a request that waited (UserDeclined, "moved to another network"). signData too. Two tests show it, on signTx and signData: one holds Koios mid-read, and one lands Settings' write just as the last look reads the old account or network. Both fail before the fix, the second also with the looks read one after the other (the fixes' review, code#0).
- **Expires rounds its minute up** (pr351#4). A transaction lands until its end's slot starts, so an end shown to the minute, with the seconds dropped, could read up to 59 s early. Valid from keeps rounding down, which shows the start early, and early is the safe side for a start.
- **Tests that pin what #351 and #350 rely on:**
  - SignTx rendered on mainnet, so its network is held to the window's (pr351#0);
  - the last slot a Date holds (pr351#3);
  - a pool found before stays kept when the data layer's list leaves it out, so what the wallet reads only grows (pr350#0).
  Each was checked against mutants of the code. The mainnet test catches preprod hard-coded in each of the three network-dependent calls, and, with an end 10 s and a start 30 s into their minutes, any other rounding of either, on every run (the fixes' review, code#2). The pool test catches a `keep` that drops what was kept.
- ja `dappUi.validFrom` is `有効開始日時`, as `日時` and `作成日時` end; Expires keeps 有効期限, the usual word (i18n#2).
- One comment cited a 1.7.0 finding about the removed check (pr350#2).

**The translations:** `settings.koiosOnly.privacy.off`, critical, had lost a whole sentence in #350 with no fresh pass (i18n#0). It was back-translated blind again, a fresh agent per language with no English, and nothing drifted. Both reviewer notes say so.

**The docs:**
- **1.7.1's handoff note** described #350 alone (four reviewers' finding). It now has #351, this review, the two dashboard fields the upload pastes again (the description's services bullet and the merged host-permission box), and what's left after the merge.
- **privacy.md** still described the removed check's Koios read of a pool the wallet launched.
- **development.md:**
  - the release block's version is 1.7.1 (`release_version`, the zip's name);
  - `media/` skips the check;
  - no review is asked while there's one maintainer (below).
- **post-release-roadmap.md** says the 29 October policy entry stays, and that the refusal's words below were accepted with the check's removal.
- **architecture.md** dates the data-source ruling 29 October, as everywhere else, and says what `sameNetwork` does.
- **flows.md** says Expires rounds up.

## The owner's calls

- **The ruleset's bypass (cross#2, docs#3): dropped, 2026-10-30.** Since 2026-10-29 the write role had been on the bypass list of *require web wallet* (ruleset 26097902), which holds only the check: it let anyone with write access merge before the check reported, as #342, #348 and #351 did, while the docs said there was no bypass. The owner's reason for it was the classic rule's approving review, which a lone maintainer can't give. The owner dropped both the bypass and the review: the check holds every merge again, the owner's too, and no review is asked while there's one maintainer. A review can come back as the team grows.
- **pr350#1: left.** With the check gone, a Bootstrap into a listed pool that isn't on chain is refused as a spent UTxO (`koios.spentInput`) each time it's sent.
  - Nothing is lost on the public side. A private Bootstrap's session stops and comes back directly, so its funding's and its return's fees are spent, as any stopped session's are.
  - Only a wrong list is new: a launch rolled back after a device kept its pool stayed kept under 1.7.0's check too, which ran once, at first sight.
  - No background check either (the owner): Koios is the fallback, not the deciding factor. A rollback deep enough to un-list a pool would roll Koios back the same way, and Koios is sometimes slow or down. A check would let a third party hold back pools again.
- **`media/` (8 findings): left as posted.** The folder holds a post that's out already. If its text or images are used again, two claims want fixing first:
  - post 6: "Lovejoin breaks the on-chain link between the dApp's account and your balance". The funding stays a public link (privacy.md), and Lovejoin breaks the trail back;
  - post 5's "it all comes back through Lovejoin" and "Lovejoin can handle it all", and image 01's alt text's "everything goes from the one-time account into Lovejoin". Less than a box, an NFT, a token no pool takes, and on mainnet today the 5 ₳ collateral come back directly.
  The nits:
  - image 02's "only your key can tell which": a payer knows theirs;
  - image 05's "Mixed, several times": the default depth is 2;
  - image 03's heading says "dApps", where its own text says "some";
  - render.mjs exits silently on a mistyped name;
  - media/README.md doesn't say to install Playwright's Chromium, and its 22 px rule isn't what the images do.

## Checks

- **Before the fixes, on `4c06171a`:**
  - `tsc` clean;
  - Vitest 2,948 on both builds;
  - e2e 104 on the dev build and on the store build, and the data layer's 3.
  They ran after #351 merged, beside its own CI and `main`'s run on the same tree, both of which went green first (15:38 and 15:40 UTC): no full run had finished when it merged.
- **After them:** see the handoff note.
