# Releases

Every Seedelf Wallet package uploaded to the Chrome Web Store: the commit it was built from and the zip's SHA-256. The package is reproducible, so anyone can build that commit with the pinned toolchain and compare ([development.md](development.md#releasing-to-the-web-store), step 8). From 1.6.0 on, each is tagged `web-wallet/<version>` on that commit, and [SECURITY.md](../../../SECURITY.md)'s bounty scope is the latest such tag.

**No dates, and nothing about what the store is doing** (the owner, 2026-10-04): review takes as long as it takes, and a doc that says what's live is wrong as soon as it changes.

| Version | What it carried | Zip built from | Zip SHA-256 | Tag |
|---|---|---|---|---|
| 1.7.2 | A patch, from three bounty reports: whose stake key a proposal's deposit goes back to (#357), the stake and DRep keys' own addresses (#358), an address by its payment key (#359), and their review (#360) | `6b70c1f8` | `087c30a8c5c1af4b72ac201a932727942697c05717c652637806fd92dfa1dc9b` | `web-wallet/1.7.2` |
| 1.7.1 | A patch: the Koios check of a listed pool removed (#350), the sign window's expiry (#351), and their review (#352) | `f31758b0` | `38006fda7ecde3939cae4fe7d92cda1b6fda9ac3ebdfc2163d064853c6c3989a` | `web-wallet/1.7.1` |
| 1.7.0 | 1.6.0's follow-ups in small PRs (#325–#339), and the gate (#340, `52c15492`); the zip is from `main` after #341–#344, which left the wallet's code as #340 had it | `f375af62` | `7a860ca5eae42dc1d4db6ba341a910f6c68397fdf8342b71b74bc1f38c5c5809` | `web-wallet/1.7.0` |
| 1.6.0 | Lovejoin token pools (chunk 34) and chunks 35–37 (#308–#323), and the gate (#324) | `babb8e76` | `6d1219aaa0c463d02da3320f7e3657db34135336cd9ee0c7fe0d0da7c595938f` | `web-wallet/1.6.0` |
| 1.5.0 | Chunks 27–33 and the data layer's status light (#298–#305), and the gate (#306) | `63f87b8` | `d72022bb24bf36ed4761447e7b658685dbe8e94e42798968ccfcc7eba668e409` | none |
| 1.4.1 | A patch (#296): the data layer's submit waits for the node's sync (O10), and fixes | `fd412c0` | `35b576538f34f381da633fed46ce1a10c36e872b38ea58d600c8c6c6339245f7` | none |
| 1.4.0 | The data layer, chunk 26 (#288–#293), and the gate (#294) | `b5ad15a` | `b1ba594f3d4f2705c075e51c3ca561613db12528bbd76405ff045bcf74571c0a` | none |
| 1.3.0 | dApp additions and small fixes, chunks 24–25 (#284–#285), and the gate (#286) | `588377e` | `621744379288085c7302483915eab8c49d3648418803723f9c7255d390111c81` | none |
| 1.2.0 | Chunks 18–23 (#272–#281, the CLI's 0.5.0 among them), and the gate (#282) | `72d111d` | `022a8a1ce0bdc5102d99fe9cf2643a1c9f505ff5c70248636de4d0e6977d07b8` | none |
| 1.1.0 | The transaction view, chunk 17 (#270), and the gate (#271) | the owner has it | the owner has it | none |
| 1.0.0 | v1, chunks 1–16, merged into `main` by #266 | `0d5ec42` | `85c0fb093fa8bb157f5ad3d9ea1fd001db75d7273c3068aa52ea65932dee714b` | none |

**The full record of each release up to 1.7.1** (its review, the lists, the translations, the checks, the toolchain lines, and what surprised it) is its handoff note in [archive/roadmap.md](archive/roadmap.md#handoff-notes), and 1.0.0's and 1.1.0's are in full in [archive/roadmap-v1.md](archive/roadmap-v1.md). From 1.7.2 on, it's here.

## Recording a release

The release's record PR, after the upload ([development.md](development.md#releasing-to-the-web-store)'s last step), adds a row to the table and a section below it, newest first, headed by the version. The section says:

- **The branch and what it carried:** the PRs, the plans they built, and the review's record in [archive/plans/](archive/plans/) if there was one.
- **The lists** each release refreshes: the tokens, the DReps, the Lovejoin pools' head start and their Cardanoscan names, and the data layer's token decimals; what changed, or that nothing did.
- **The translations** that changed, and how each was checked; and the privacy policy's entry, if it owed one.
- **The checks** run on the merged tree, and whether the data layer's API was deployed, and from which commit.
- **The package:** the commit it was built from, the zip's SHA-256, its size, and the `C compiler`, Node and zlib lines the build printed; and that a second build of the same commit gave the same bytes.
- **The tag**, and anything that surprised the release: what a later session would lose time over without it.
- **What it left open** goes into [backlog.md](backlog.md) as a line, not here.

## Records

### 1.7.2

- **The branch and what it carried:** a patch, from three bounty reports against 1.7.1. A site's sign window says whose stake key a proposal's deposit goes back to (#357, [chunk 39](archive/plans/chunk-39-proposal-deposit.md), planned in #355); a UTxO at one of the account's stake or DRep keys' own addresses is the account's (#358, Low); an address is the account's by its payment key, never its stake key alone (#359, Medium). The docs: 1.7.1's record (#353), chunk 38's plan (#354, Midnight), and the roadmaps archived, with [backlog.md](backlog.md) and this file in their place (#356). The gate, `web-wallet/release-1.7.2` (#360), reviewed #353–#359 as one tree and fixed what it found, and merged as `6b70c1f8`. [archive/plans/review-1.7.2.md](archive/plans/review-1.7.2.md) is the review's record.
- **The lists:** tokens unchanged (2 preprod, 32 mainnet), and so are the data layer's token decimals (1,172). Named DReps: mainnet 466 of 1,049 registered (one no longer registered), preprod 63 of 293. The head start gains one preprod pool (`aab7c72d…`, a 7 tADA box) and no mainnet pool, so no Cardanoscan names are new. The mainnet 5 ₳ pool's four entries, added to the owner's fork at 1.7.0, are still an uncommitted change in its local checkout, never sent: part 1's registry block refuses until it's committed or discarded.
- **The translations:** `dappUi.proposal.warn.session`, `send.warn.stakedOther` and `send.warn.stakedOtherNth` are new values, back-translated blind in es and ja, with no drift ([verified-critical-es.json](i18n/verified-critical-es.json) and [-ja](i18n/verified-critical-ja.json) say so). en's `dappUi.warn.unknownInputs_one` changed one pronoun. No privacy policy entry: nothing new is stored or sent, and every new check is a derivation on the device.
- **The checks,** on #360's final tree: Rust fmt, clippy `-D warnings`, the workspace's 705 tests and the ignored `payment_parts_shapes_test` in a release build; `node --test` 59; `tsc` clean; Vitest 2,990 on both builds; e2e 105 on the dev and store builds, and the data layer's 3. **No API deploy:** neither `seedelf-data/` nor `src/tokens/list.json` changed since `web-wallet/1.7.1`.
- **The package:** `seedelf-wallet-1.7.2-mainnet.zip`, built from `6b70c1f8` with Node 24.19.0 (zlib 1.3.2.1-motley-3246f1b) and `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`: **SHA-256 `087c30a8c5c1af4b72ac201a932727942697c05717c652637806fd92dfa1dc9b`** (2,101,045 bytes, 24 files). A second build of the same commit, in a worktree of its own with its own `node_modules` and cargo target, gave the same bytes. The whole e2e suite passed on it (105). Not in it: what checklist item 9 found, which only the owner has.
- **The tag:** `web-wallet/1.7.2`, on `6b70c1f8`. What surprised the release is the review record's [Lessons](archive/plans/review-1.7.2.md#lessons): a rule about whose a key is has a mirror wherever else a key hash can stand.
