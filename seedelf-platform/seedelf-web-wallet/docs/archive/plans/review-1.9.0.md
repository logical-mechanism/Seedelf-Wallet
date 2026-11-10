# 1.9.0's release review, its fixes and the gate (2026-11-09)

**Status: ✅ done, the gate for 1.9.0.** It's on branch `web-wallet/release-1.9.0`.

The working folder, `docs/plans/review-1.9.0/`, was compressed into this file when the PR was ready. Its full text is in git at `47ebfe62`:
- the briefs;
- every finder's, verifier's and fixer's report;
- round two's and the last look's reports;
- the back-translations.

[The IDs](#the-ids) says where each family is. What still holds is in the design docs, and what's left open is a line in [backlog.md](../../backlog.md).

## The review

**What it covered:** every PR since `web-wallet/1.8.1` (`f77aa5c1`), as one tree at `8d7c4b0c`.
- **#373:** the sign window says what a contract releases under the account's key (a bounty report against 1.8.1).
- **#375:** Minswap's API stopped taking `ChakraBondingCurve`; `routeOf` asks again without a DEX the wallet doesn't check.
- **#377:** SundaeSwap V4 on mainnet (chunk 47's Part A).
- **The rest, one light pass each:**
  - #370 (1.8.1's record);
  - #371 and #372 (the verification's docs and `check.sh`);
  - the prep `ed14af7b` and `8d7c4b0c`.
- **#374 and #376 are the CLI's.** The only check: #376's version bumps leave the extension's build as it was.

**How:**
- **Nine finders:** cip30-rust, attacker, dapp-ui, i18n, v4-orders, routes, cross, mutants and docs-prep, and a completeness critic.
  - A safety check stopped the attacker lane before it ran anything, and it wasn't sent again.
  - The critic's 11 probes and the verifiers' probes covered its question: whether a site gets past the warning.
- **Nine verifiers, each told to refute:**
  - a trace and an impact verdict on the medium (the impact one read seven real Indigo transactions from mainnet);
  - the cip30 lows, the UI lows, the routes and V4's fee cap;
  - a blind back-translation;
  - a free unsigned V4 build from Minswap for a public sender;
  - an e2e run of a queued request, and the window in es and ja at 400×605.

**40 findings in round one, none high.** The finders graded 4 medium, 24 low and 12 nits. After verification, one medium stood: M1.
- **M1 (medium; cip30-rust#1 with dapp-ui#2, i18n#1, i18n#2): honest DeFi actions got the release warning, with false figures and false words.**
  - Every Indigo CDP and staking action shows the row, the callout and the switch, read from real transactions re-keyed to the test account. The callout said "your own order or listing … doesn't come back to you".
  - The row put the whole position plus Indigo's shared UTxO under "Leaves a contract, not to you", up to 520,005 ₳.
  - Counting money kept at the same contract as gone is the owner's stated trade-off, and it can't be narrowed: an honest reprice and an attacker's relist render byte-identical windows. What wasn't stated was how far it reaches, and the words were false there.
  - The trace verifier graded it low (nothing refused, nothing to exploit). The impact verifier graded it medium, for how often it's hit. The lead took medium.
- **The three mutants mediums were missing tests, graded low:** the bounty's own shape under a script data hash, a token of the account's own kind, and a yes carried to a queued request. Each behaved right in every run.
- **What the verification added:**
  - the burn fix as first proposed (take a burn off what's released) hid a take, since a burn of the account's own units can stand for the contract's (two verifiers, by run); the guarded rule is in the backlog;
  - `routeOf`'s second ask fails in a way nobody had listed: Minswap's 404 "Quote not found." when leaving out the DEX leaves no route;
  - the free check: two unsigned builds of a V4 order pass every check the wallet makes, so a V4 swap won't pause after funding on today's API;
  - the window in es and ja lays out clean.

## The lead's calls

- **M1:** words and docs, since no exemption is safe. The lead decided the English: the row "From a contract, not to you", the switch "I expect this not to come back to me", and the stronger warning "Your signature releases funds from a contract that names you. They may be yours, but they don't come back to you." The switch asks an expectation that the victim of a redirected cancel denies.
- **Fixed:**
  - M1, L3, L5 (es and ja with M1's), L7, L8 and L11;
  - L2's and L4's docs, L6's DRep half, and L9's doc line;
  - L10's tests, bar two optional ones: a script data hash in the e2e's transaction, and a whole V4 build as a fixture;
  - the nits i18n#5, i18n#6, v4-orders#2, cross#4, docs-prep#3 and docs-prep#4.
- **Not fixed, as backlog lines:**
  - the burn credit (L1);
  - L2's two no-request checks (the owner's);
  - holding V4's cap to the approved DEX fee (L9, the owner's);
  - M1's optional "goes back to the same contract" row;
  - the datum scan's memo, a key across byte-string chunks, and u128 totals (cip30-rust#5, #8, #9);
  - Transaction details' cost on every private spend (cross#2);
  - the worker checking the switch (dapp-ui#1);
  - the half of dapp-ui#3 left open;
  - round two's Lovejoin and Danogo hints (r2-views#1, #2).
- **Left for a verification pass:** #372's `check.sh` counts an import's replayed Undetermined warning as the importer's own (docs-prep#1), and the verification README's line on it (docs-prep#2). A wallet pass is wallet-only.

## The fixes

Five fixers worked by file ownership, each in a worktree of `8d7c4b0c`, test first. A behaviour change failed before its fix; a test gap failed under the mutant it kills.

| Lane | What | Findings |
|---|---|---|
| words | The sign window's row, switch and stronger warning in en, es and ja. An unfound input's line without "Only your stake key signs here" when `keyReleases` is set (a new key, the old line's first sentence reused). The contract notes renamed critical, with U+00A0 before ₳. The #373 e2e's step rewritten so both requests sit in one window | M1, L3, L5, L11, i18n#5, mutants#3 |
| rust | Tests: a required signer and a datum under a script data hash; the account's own token of a kind; a counterparty's key input; an unfound input under the stake key; the DRep key; a carried datum hashed as written; a real Minswap V1 cancel; a session's own cancel of all 11 DEX fixtures. V4's second module and a three-item constraint. Comments only in `cip30.rs` and `orders.rs` | mutants#1, #2, #5, #6, z5, cip30-rust#7, cross#3, v4-orders#2, critic#1 |
| swaps | `name-refused` and `no-route`. `routeOf` keeps its first answer when its second ask fails with either, so the quote is refused and the runner pauses in the wallet's words, for an unchecked DEX and for `outOfPlace`'s re-ask alike. A pin for `routeOf`'s network. V4's Stop, restore-scan find and fill | L8, mutants#4, routes#3 |
| views | `markYours` marks each account's DRep key. A `lookedUp` prop gives a session's cancel review and its swap against pools the looked-up hint, without the site's signatures row | L6, L7, dapp-ui#4 |
| docs | architecture.md: M1's class and why it can't be narrowed; the limits, widened; the fee credit; L3; V4's cap in the trust line; `routeOf`'s cost line and its refusals. flows.md, privacy.md, wasm/README.md, releases.md's chunk 44 link, chunk 46's status, and the backlog | M1, L2, L3, L4, L7, L8, L9, cross#4, docs-prep#3, #4 |

**The merge had no conflict.** The lead's edits at the merge:
- contractYours reworded after round one's blind reading ("names you", and "but"), and its es and ja back-translated in two more rounds;
- the three new keys listed verified, and the round recorded.

**The suites, by the numbers:**
- **Rust:** 774 at `8d7c4b0c`, 783 after.
- **Vitest:** 3,276 at `8d7c4b0c`, 3,302 after the lanes and 3,304 after round two, on both builds.

## Round two

Five lenses read the merged fixes where the lanes meet: the window, the swaps, the views, the tests (each fix reverted to prove its tests fail, and timings under load) and the docs. They found 16: 7 low and 9 nits.
- **r2-window#1, #2:** the rewritten e2e step no longer declined with the switch off. Its Enter checks couldn't fail on their own, and the switch's hold had no test. The step now checks the hold, reaches the window's guard with the form's own submit, and declines with the switch off. It fails under each of the four mutants and passes 4/4 on both builds.
- **r2-tests#1, #2, #3:**
  - the no-break space was held in the `_one` notes only;
  - the new codes' retry reasons outside `routeOf` were unpinned;
  - the heaviest new swap test came near its timeout under load.
  Now: a check of every plural form, two first-ask runner tests, and the house's 20 s timeout.
- **r2-views#1, #2:** a Lovejoin mix's Transaction details say the wallet asks nobody, after it asked Koios what made a box the mix spends; and a Danogo swap's collateral hint calls Minswap's collateral the paying account's. Both predate 1.9.0. A real fix needs words of its own, back-translated, and plumbing through the Lovejoin worker. They're named in flows.md and are lines in the backlog.
- **The rest were docs and records:**
  - L6's DRep mark, and its open half;
  - the fee-cap clause;
  - a withdrawal's proof beside an unfound input;
  - flows.md's paraphrase and two type docs;
  - the backlog's routing line;
  - the reviewer note's count, rounds and date.
- **Left as they are:** r2-swaps#1's five older swap tests, which time out under oversubscription on `8d7c4b0c` too.

## The last look

The code part and the docs part found 9 nits, and the lead fixed each:
- three comments behind what round two documented;
- the scope of a new architecture.md sentence;
- whose keys past 20 go unmarked;
- what the Danogo hint says;
- the Lovejoin case's trigger;
- a doc comment's "likely the user's";
- the wasm README's list of refusals.

It confirmed each of round two's fix-ups: the e2e's new lines fail under their mutants, and the swap and plural checks kill theirs.

## Left open

In [backlog.md](../../backlog.md), from this review:
- the burn credit (L1);
- L2's two checks (❓);
- V4's cap (L9, ❓);
- the row for what goes back to the same contract;
- the datum scan's memo;
- a key across byte-string chunks;
- u128 totals;
- Transaction details' cost;
- the worker and the switch;
- a dApp account's keys past 20 when it isn't on screen;
- the Lovejoin and Danogo hints.

The DEX-name line now says a name `routeOf` adds fails only the swaps routed through it, in the wallet's words.

## The release prep

`ed14af7b` (PR #378):
- 1.9.0.
- Tokens unchanged (2 preprod, 32 mainnet), and so are the data layer's decimals (1,175), so there's no API deploy.
- Named DReps: preprod 67 (four new), mainnet 466 (eight kept as committed).
- The Lovejoin pools' head start is unchanged, so no Cardanoscan names are new.
- `8d7c4b0c`: chunk 47's Part B gate, answered on chain.

## The translations

The sign window's contract words were redrafted. Each was back-translated blind, a fresh agent a language with no English in view.
- **Round one read every new value.** It carried every clause of the row, the switch and the notes. The switch now reads as the user's own expectation: es "Tengo previsto…", ja 想定しています. Before, #373's es said "I know", and its ja could read as the wallet saying all is as expected.
- **It also read the stronger warning's "menciona tu clave" and 鍵が記載された as a password and the secret key itself,** so the English changed to "names you".
- **Rounds two and three read only that warning.** Round three read "en el que figuras" and あなたが記載されている…手元には戻りません right, with no reading of a secret exposed.

Both verified files record the round, and what stays as read.

## The checks

On the final tree:
- **Rust:**
  - `cargo fmt --all --check`;
  - clippy `-D warnings` on seedelf-crypto and seedelf-wasm;
  - the workspace's 783 tests, 12 ignored.
- **The WebAssembly** needed no rebuild: no Rust runtime code changed, only tests and comments.
- **tsc** clean.
- **Vitest:** 3,304 on both builds.
- **e2e:** 109 passed on the dev build and 109 on the store build (each with the found-later test skipping by design), and the data layer's 3, on the merged tree. After round two, the #373 test passed 4/4 under two-CPU stress on each build.
- **Relative links:** 1,502 in 130 files, none broken.

## The live runs

- PR #378's live runs on preprod stand: `run.mjs all`, six transactions, and `run.mjs staking`, four, at `8d7c4b0c`. Nothing this round changed reaches those paths.
- V4's first live swap and Stop are still the first real swaps (PR #377). The unsigned build above passed every check the wallet makes on one.

## For the owner

After the merge, in order:
1. **No API deploy:** nothing under `seedelf-data/` or in the token list changed.
2. **Package on `main`** (part 2's block reads 1.9.0 from `package.json`), the e2e on the store build, the second build, then upload. The listing's text is unchanged. No images are owed: the screens this round changed aren't in them.
3. **Tag** `web-wallet/1.9.0` on the commit the zip was built from, and record it in `docs/releases.md`.
4. **No privacy-policy entry:** nothing the wallet sends, keeps or reveals changed.

Your calls, whenever you choose:
- the new words, if you'd put them otherwise;
- L2's checks, V4's cap, the burn credit, and the row for what goes back to the same contract;
- the Lovejoin and Danogo hints, which need words;
- the preprod checklist's by-hand items, 2 to 9, which no one walked for 1.9.0;
- `check.sh`'s import count, for a verification pass.

## Lessons

- **A warning's words must hold for the honest flows it fires on.** Read real transactions of the dApps people use before shipping a heuristic: every Indigo action met #373's warning.
- **A fungible count can't credit what could be the account's own.** The burn fix as proposed let a burn of the account's own units hide a take, as the fee rule already knew.
- **A blind back-translation reads the source too.** "Names your key" read as a password and a secret key in two languages, and it was the English that changed.

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `47ebfe62`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.9.0/`.

| IDs | What | File at `47ebfe62` |
|---|---|---|
| `cip30-rust#`, `dapp-ui#`, `i18n#`, `v4-orders#`, `routes#`, `cross#`, `mutants#`, `docs-prep#`, `critic#` | round one's 40 | the lens's report (`cip30-rust.md` and the rest, `attacker.md`, `critic.md`), and `REVIEWBRIEF.md` |
| the verifiers' verdicts | the verification | `v-a-trace.md`, `v-a-impact.md`, `v-cip30-lows.md`, `v-ui-lows.md`, `v-routes.md`, `v-v4-fee.md`, `v-v4-build.md`, `v-e2e-queue.md`, `v-blind-round1.md` |
| `M1`, `L1` to `L11`, cited as "1.9.0's release review, …" | the lead's clusters | `FINDINGS.md` |
| the lanes (`words`, `rust`, `swaps`, `views`, `docs`) | the fixes | `fixes/<lane>.md`, and `FIXBRIEF.md` |
| `r2-<lens>#<n>`, cited as "1.9.0's review of its fixes, …" | round two's 16 | `r2-*.md`, and `R2BRIEF.md` |
| `last-<part>#<n>` | the last look | `last-code.md`, `last-docs.md` |
| the back-translations | rounds zero to three | `v-blind-round1.md`, `back-translation.md` |
