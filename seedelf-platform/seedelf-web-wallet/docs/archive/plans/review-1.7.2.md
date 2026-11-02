# 1.7.2's release review, its fixes and the gate (2026-11-02)

**Status: ✅ done, the gate for 1.7.2.** It's on branch `web-wallet/release-1.7.2`. The working folder (`docs/plans/review-1.7.2/`: the briefs, `FINDINGS.md` with every first-round finding, its verdicts and outcome, the fixers' reports, round two's findings and back-translations, and the last look's) was compressed into this file when the PR was ready. The full text is in git at `44e7b5f9`; [The IDs](#the-ids) says where each family is. What still holds is in the design docs, and what's left open is a line in [backlog.md](../../backlog.md).

## The review

**What it covered:** every PR since `web-wallet/1.7.1` (`f31758b0`, the commit 1.7.1's zip was built from), #353–#359, as one tree at `133d598b`.
- **Code:** #357 (a site's sign window says whose stake key a proposal's deposit goes back to: chunk 39, from a bounty report), #358 (a UTxO at the stake or DRep key's own address is the account's: a bounty report, Low) and #359 (an address is the account's by its payment key, never its stake key alone: a bounty report, Medium).
- **Docs:** #353 (1.7.1's record), #354 (chunk 38's plan, Midnight), #355 (chunk 39's plan) and #356 (the roadmaps archived, `backlog.md` and `releases.md` in their place).

**How:** ten reviewers, then a completeness critic.
- One for each PR, the three code PRs each with a mutation sandbox (a worktree at `133d598b`).
- Three lenses across them: every place the wallet decides whose an address, a key or a reward account is; the translations; the release itself.
- Verification by stakes (1.7.0's lesson): a trace and an impact verdict for each medium, a trace for each low, none for nits. The docs PRs' findings came straight to the lead.

**53 findings:** 3 medium, 23 low and 27 nits, none high, which came down to 44 issues once overlaps were merged.
- **The mediums were two defects, each judged low on impact:**
  1. **A site's ties missed an address paid to one of the wallet's stake or DRep keys** (pr358#0, own#0). #358 made such an address the signing account's, by the ledger's rule that a key's witness spends what's paid to its hash, but the worker's check across accounts still matched payment keys only: a private session's prompt paying the public account's stake key's own address said the public account wasn't in it.
  2. **Send no longer said that an address under another account's stake key ties the two** (pr359#0). #359 rightly dropped "This is your own Account 2", and the true half of that note went with it.
- **Among the lows:** a treasury withdrawal's recipients were never matched (pr357#0); a proposal's deposit back to a private session's stake key was said to come back, though nothing in the wallet reads a session's rewards (critic#0); #359's screens and #358's wording fix were pinned by no test (pr359#1, own#3, i18n#0); privacy.md and keys-and-accounts.md still stated the rules #358 and #359 replaced; development.md still said 1.7.1, and releases.md asked for a second build its steps never made.
- Every finding a verifier traced held (18). What was "partly" in 8 was the reach or the suggested fix, never whether the fault is real. Two suggested fixes would have named an output the wallet never reads as "Your public account": the verifiers caught both.

## The fixes

Three fixers by file ownership, each in a worktree of the release branch, each fix test-first and each new test checked against a revert of its fix:

| Lane | What | Findings |
|---|---|---|
| ties | `ties` matches a payment credential against the wallet's stake keys and the public accounts' DRep keys, for the tie only: the row stays "An address", which the wallet never reads. WebAssembly's `Proposal.recipients`, tied in `certified`. The stake and DRep key input tests over every shape of address paid to the hash; the other network's script reward address; the comments | pr358#0, own#0, pr357#0, pr357#2, pr358#1, pr358#2, critic#1 |
| window | `dappUi.proposal.warn.session`: a deposit back to a session's stake key "goes to the stake key of … when the action ends, and the wallet never brings it back", and the staking callout warns for any proposal in a session. en `unknownInputs_one`; the dapp-unknown callout pinned word for word in en, es and ja | critic#0, i18n#0, i18n#1, pr358#4 |
| send | `send.warn.stakedOther` and `.stakedOtherNth`: "Paying it still ties your two accounts together on chain, where anyone can see it." Send's and Make public's forms and reviews pinned with a staked destination; destination.ts's header | pr359#0, pr359#1, own#3, pr359#3, own#5 |

The lead merged the three patches (one hunk by hand), counted the signing session's own stake key in `ours` (the ties fixer's note: under the public account's stake key, such an address read "that money isn't yours"), held `FARTHER_KEYS` and `OWN_KEYS_STAKED` together in own-address.test.ts (pr359#4), and wrote the docs: privacy.md, architecture.md, flows.md, keys-and-accounts.md, backlog.md, releases.md, development.md (1.7.2; the zip's size; a second build made apart), plans/README.md, the archived roadmap's header, and twelve corrections to chunk 38's plan.

**Round two** read the merged fixes in four lenses (the worker and WebAssembly, the screens and words, the tests by mutants, the docs and the release steps), then a completeness critic, each finding traced: 15 findings, all low or nits.
- 13 were fixed: tests that now pin every known account's DRep key, every treasury recipient, Make public's total and a script's staking part, and the docs' wording.
- Two crafted-only gaps are written into the *Not covered* lists and the backlog, since saying them takes critical strings of their own: a wallet key's hash where a stake key goes (r2-worker#0, r2-screens#0), and a committee update's members or a committee hot key (r2-critic#0).

**The last look** read round two's fix-ups: two parts (the code and tests; the docs and the translations), each finding traced. The code part found nothing: each mutant the new tests were written for fails them, and nothing is vacuous. The docs part found four, two low and two nits, all wording, and each is fixed: the *Not covered* sentence said more than the lines say (last-docs#0), privacy.md left out a committee hot key (last-docs#1), flows.md's list of what the DRep key signs (last-docs#2), and the verified-critical entry's date and one verb's source (last-docs#3).

## Left open

In [backlog.md](../../backlog.md):
- *Send and Make public:* a payment to the account's own key past what the balance reads (own#1, as in 1.7.1); an address paid to one of the accounts' stake key hashes (own#2).
- *Signing and the connector:* "It signs for your staking" (pr358#3); an output paid to a stake or DRep key's hash read as money moving between the sides (r2-docs#0); a wallet key's hash where a stake key goes (r2-worker#0); a committee update's members (r2-critic#0); Transaction details' treasury recipients (pr357#0).
- *The owner's open calls:* #357's own (a stranger's certificate alone leaves the staking callout informational), and two of 1.7.0's that only the archived handoff notes held (the critical-words gate, Node's CA store for the refreshes).

Left as they are: a script's reward account called "a stake key that isn't yours" in a proposal's line, as the certificate's line says it (pr357#1, i18n#2); the archive's two nits (pr355#1, pr355#2).

## The release prep

`dd22e2b2`:
- 1.7.2.
- `npm run tokens`: unchanged (2 preprod, 32 mainnet). The data layer's token decimals: unchanged (1,172). So no API deploy.
- `npm run dreps`: mainnet 466 named of 1,049 registered (one no longer registered), preprod 63 of 293.
- `npm run lovejoin-pools`: one new preprod pool (`aab7c72d…`, a 7 tADA box), no new mainnet pool.
- **Cardanoscan:** the mainnet 5 ₳ pool's four entries, added to the owner's fork at 1.7.0, are still an uncommitted change in the local checkout of the fork, never sent: Strica's `projects/lovejoin.json` has the five v1 entries alone. Sending them is the owner's. Part 1's registry block refuses until that change is committed or discarded.

## The translations

`dappUi.proposal.warn.session`, `send.warn.stakedOther` and `.stakedOtherNth` were back-translated blind in Spanish and Japanese, a fresh agent each with no English in view, every placeholder filled as the screens fill it. Every clause held, and nothing drifted; both verified-critical files say so. en `dappUi.warn.unknownInputs_one` changed one pronoun, and es and ja were already singular or neutral.

No privacy policy entry is owed: nothing new is stored or sent, and every new check is a derivation on the device.

## The checks

On the final tree:
- Rust: fmt, clippy `-D warnings`, the workspace's 705 tests, and the release's ignored `payment_parts_shapes_test` in a release build.
- The WebAssembly rebuilt (`C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`), the same bytes in every tree it was built in (`493bb0d9…`), and `node --test` 59.
- `tsc` clean.
- Vitest: 2,990 on both builds.
- e2e: 105/105 on the dev build and on the store build, and the data layer's 3. The store build was built as CI builds it, without writing a zip in the main tree.

Before the review, `main`'s own run on `133d598b` was green on every job.

## Lessons

- **A rule about whose a key is has a mirror.** #358's rule, that a key's witness spends what's paid to its hash, was first applied where a payment key goes. Round two found it missing where a stake key goes, and for a committee's members. Asking where else a key hash can stand would have found all three in round one.
- **A tie and a label are two questions.** The tie says what signing links on chain; the label says whose balance will show the money. Two suggested fixes merged them and would have named an address the wallet never reads as the user's.
- **"Comes back" is a promise about the balance.** critic#0 and own#1 are the same lesson: a line that says money comes back must be true of what the wallet reads, not only of whose key holds it.

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `44e7b5f9`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.2/`. For example: `git show 44e7b5f9:seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.2/FINDINGS.md | grep -n -A40 '^### pr3580$'`.

| IDs | What | File at `44e7b5f9` |
|---|---|---|
| `<PR>#<n>` (e.g. `pr358#0`), `own#<n>`, `i18n#<n>`, `release#<n>`, `critic#<n>` | the review's 53 findings, cited as "1.7.2's release review, …" | `FINDINGS.md`: each with its verdicts and outcome; the brief is `REVIEWBRIEF.md` |
| the fixers' labels (`ties`, `window`, `send`) | each fixer's report | `fixes/<label>.md`, and `FIXBRIEF.md` |
| `r2-<lens>#<n>` (e.g. `r2-worker#0`), cited as "1.7.2's review of its fixes, …" | round two's 15 findings, and the back-translations | `ROUND2.md`, and `REVIEW2BRIEF.md` |
| `last-<part>#<n>` | the last look's findings | `LAST.md` |
