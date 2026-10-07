# Post-release roadmap

[roadmap.md](roadmap.md) is closed: every chunk in it is done, through 1.1.0, the transaction view. This file is what comes after it.

**Why a second file.** The roadmap's job was to get a wallet built, in order, to a line where it could ship. That job is finished. From here the work is a short sequence with a set of candidates hanging off it — things already promised, the last of Cardano parity, then a pass over how all of it looks and feels. The roadmap stays the record of what *happened* and still takes the handoff notes; this one is the record of what *might*, and it's what a new chunk is chosen from.

## How this file works

- **A line becomes a chunk when the owner picks it.** It takes the next number after the roadmap's (18 onwards), a branch `web-wallet/<topic>` from `main`, a plan in [plans/](plans/), and a handoff note in [roadmap.md](roadmap.md#handoff-notes) when it lands. Tick it here and link its plan. **When it lands, what still holds moves into the design docs and the plan moves to [archive/plans/](archive/plans/)** (the owner, 2026-10-04), so [plans/](plans/) only ever holds live specs; [plans/README.md](plans/README.md) says how.
- **Status:** ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked · ❓ needs the owner's call
- **The rules from chunks 11–17 still hold** ([development.md's list](development.md#rules-for-a-change-to-the-screens)): Lace is inspiration for look and flow, never a brand to copy; **every privacy note stays** — a redesign may move or shorten one, never drop it; correctness UX is always in scope; nothing new phones home without its own decision; every feature states its Koios cost, and anything paged scales with the contract's size; a renamed control updates the e2e tests in the same commit; the name is Seedelf.
- **Releases aren't tagged, and that's not an oversight.** No `web-wallet/*` tag exists for 1.0.0 or 1.1.0: a release is recorded by its handoff note, which names the commit and the zip's SHA-256 (1.1.0's names neither yet: the owner has them). The version is decided when enough has accumulated to be worth one — a `1.x.0` bump for features, `1.x.y` for a fix. If a tag is ever cut it **must** carry the slash, or [release.yml](../../../.github/workflows/release.yml) ships signed CLI binaries off it ([development.md](development.md#branching)).
- **The docs don't date releases or say what the store is doing** (the owner, 2026-10-04): what's live, what's in review, what was taken down. Review takes as long as it takes, no user needs to know, and a doc that asserts a store state is wrong as soon as it changes. Ask the owner when it matters.
- **Demand decides.** The web wallet's [README](../README.md) says features are added only if there's demand. A line here is a candidate, not a commitment.

## The order

**The owner's call (2026-10-02): feature parity first, the look and feel after it.** The wallet can be feature-complete bar the dApp additions, and it's a better thing to put a style pass in front of once it is.

0. ✅ **[A clean dependabot report](#step-0--a-clean-dependabot-report)** — done 2026-10-02, all 25 cleared in `Cargo.lock` and the happy-path `requirements.txt`, no source change.
1. **[Owed](#owed)** — promises the repo has already made.
2. ✅ **[Feature parity: what's left](#feature-parity-whats-left)** — ~~several accounts~~ (chunk 18), ~~language~~ (chunk 19), ~~NFT images~~ (chunk 20, 2026-10-04). The wallet is feature-complete for Cardano.
3. ✅ **[Public-side completeness](#public-side-completeness)** — the governance items, reopened for the public account. **Before the UX pass** (the owner, 2026-10-02), so the pass gets a finished wallet to look at. Built 2026-10-04, chunk 21: *be your own DRep and vote*, in the wallet's own screens and through CIP-95 for sites such as GovTool. The owner registered and voted on preprod; what's left by hand is [O6](#owed).
4. 🚧 **[The UX and UI pass](#the-ux-and-ui-pass)** — round three, chunk 23 (`web-wallet/style-flow-3`): 2 and 3 have landed, and two adversarial usability reviews and their fixes with them ([usability-review.md](usability-review.md): its opening says what round one fixed, and §9 what round two did and what's left for the owner), then a blind task-completion test and its fixes ([blind-task-usability-test.md](blind-task-usability-test.md): §9 its ten changes, §11 what the fix round did). The owner writes the rest of its list.
5. ✅ **[The documentation review](#the-documentation-review)** — **brought forward, ahead of the pass** (the owner, 2026-10-04): chunk 22. So the pass doesn't need a second review after it, it keeps the docs current as it goes — a renamed control or a moved screen updates [flows.md](flows.md) in the same commit, the way it updates the e2e tests.

**Then [the data layer](#the-data-layer).** Parked on purpose (the owner, 2026-10-02): Koios works today, so the sequence above comes first and the data layer is thought through properly afterwards — "it will require some things that go beyond just making the wallet work as expected." The design is recorded now so the thinking isn't lost, not because it's next.

**[dApp additions](#dapp-additions)** run alongside all of it and are not counted in parity.

## Where Cardano parity stands

Measured against **Lace 2.4.2** (`_reference/lace` at `e431933`, pulled 2026-10-02), the reference since chunk 11a. Parity holds: the three gaps found on 2026-10-02 closed in chunks 18–20, and the rest is a deliberate no.

| Lace's surface | Seedelf Wallet | |
|---|---|---|
| Portfolio: tokens, NFTs, search, sort | Tokens, with search, sort, NFTs split out, logos from the bundled registry, and an NFT's image when asked for | matched |
| Send, several recipients, a note | Send on both sides, up to 20 recipients, CIP-20 note on a public send | matched — and it pays **Seedelfs** as well as addresses |
| Receive, QR, your ADA Handles | All three, plus the handle-in-Seedelf warning | matched |
| Activity, detail per transaction | Activity on both sides, with CSV (after Eternl's) | matched |
| Staking: one pool, pool browser, rewards, stop | All four; Stop staking returns the 2 ₳ deposit | matched |
| Governance: DRep delegation, DRep browser | Both, from a DRep list that ships with the wallet; and **be your own DRep**: register, vote on live actions, a profile, retire (chunk 21) | matched, and ahead — Lace leaves registering and voting to GovTool over CIP-95, which the connector here offers too |
| dApp connector (CIP-30), authorized dApps, sign tx, sign data | All, **off until turned on**, nothing injected before that | matched — and it has **private CIP-30** too |
| dApp explorer | The dApps page; a small catalogue | matched in kind; see [dApp additions](#dapp-additions) |
| Swap center | Minswap's aggregator | matched — and swaps can run **privately**, through a one-time account |
| Collateral | Settings → Collateral, 5 ₳ reserved locally, as Lace does it | matched |
| Contacts / address book | Contacts, offering addresses and Seedelf names | matched |
| App lock, lock timeout, default open mode | All three; tab by default, side panel by choice, no popup | matched |
| Fiat value | Eight currencies or nothing, mainnet only | matched |
| Review a transaction before signing | **Transaction details** everywhere: the CBOR decoded by us, plus the raw bytes | ahead — Lace resolves and prices the transaction; what we add is **the bytes themselves**, decoded and raw |
| Several accounts, folders, account center | **Several accounts, one at a time**, with a picker, names, and each account's own staking and collateral | matched in substance — **done, [P1](#p1--several-accounts)**; folders and an account centre are [not planned](#not-planned) |
| Language (i18n) | English, Spanish, Japanese | **[P2](#p2--language) done**, chunk 19, Lace's way |
| NFT images | **Show image** in an NFT's details, one at a time, from IPFS through Blockfrost's gateway; then its avatar too, until the lock | matched — **done, [P3](#p3--nft-images)**, chunk 20. Lace loads every NFT's image unasked; ours is asked for, and says first who sees it |
| Notification center | None | **kept in mind, not this round** — it needs [the data layer](#the-data-layer) first |
| Several pools per account | One pool | **one pool per account** is the model — and Lace is coming the same way: `migrate-multi-delegation` at tip is a *multi→single* migration |
| Hardware wallets | None | **can't be done** — see [the proof](#why-hardware-wallets-cant-cover-seedelf) |
| Earn / RealFi USDr staking, CIP-99 claims | None | **no** — likely AML/KYC, which doesn't align with Seedelf |
| Bitcoin, Midnight, mobile | None | **Cardano only for now**; others maybe much later |

**Dark only**, by the owner's call — there is no light theme and no theme picker, and that isn't a gap. **One recovery phrase**, likewise: not a gap, not wanted.

## Step 0 · a clean dependabot report

**The owner, 2026-10-02: a pre-step, before chunk 18** — "I do like to maintain good dependabot reports."

**Done, 2026-10-02: all 25 alerts cleared, in two files and no source change.** `Cargo.lock` and the happy-path scripts' `requirements.txt`. What was triaged, and what each one turned out to be:

| What | Alerts | Where | What actually ships it | Now |
|---|---|---|---|---|
| `urllib3` ×6, `cbor2` ×3, `idna`, `requests` | **11** | `seedelf-contracts/happy-path-scripts/seedelf/backend/requirements.txt` | **Nothing.** By-hand contract test scripts, pinned at 2024 versions. | `urllib3` 2.8.0, `cbor2` 5.9.0, `idna` 3.20, `requests` 2.34.2 |
| `openssl` | **8** | `Cargo.lock`, via `reqwest` → `hyper-tls` → `native-tls`, from `seedelf-koios` and `seedelf-display` | **The CLI binaries only.** Absent from the WebAssembly — `cargo tree -p seedelf-wasm --target wasm32-unknown-unknown -i openssl` finds nothing. | 0.10.73 → **0.10.80** (and `openssl-sys` 0.9.109 → 0.9.117) |
| `rustls-webpki` | **4** | `Cargo.lock` | **Nothing at all** — but not for the reason first recorded; see below. | 0.103.3 → **0.103.15** |
| `rpassword` (low) | **1** | `Cargo.lock`, a direct dependency of `seedelf-cli` | **The CLI only** — its password prompt. | 7.4.0 → **7.5.0** (7.5.4 since #280: 7.5.0 doesn't build on macOS) |
| `rand` (low) | **1** | `Cargo.lock`, via `group` ← `blstrs` | **The extension's WebAssembly** — the only flagged crate that reaches what users install. | 0.8.5 → **0.8.6** |

**npm had no alerts at all:** the extension's own JavaScript dependencies were clean.

**Since step 0, two new advisories matched lock entries that never ship, and 1.2.0's release branch bumped both**, in the lockfiles only: GHSA-68fv-2mgg-jv7q (high) on `source-map-js` 1.2.1, a dev dependency (`vite` → `postcss`) the bundle never holds, now 1.2.2; and GHSA-2mjx-qc3c-rqvc (RUSTSEC-2026-0285) on `rustls` 0.23.28, locked through the same never-built `reqwest` → `hyper-rustls` chain as `rustls-webpki` below, now 0.23.45. Neither reached what users install, and `npm audit` is clean again. What's still open is the CLI's `h2` and `spin` ([Kept in mind](#kept-in-mind)), which Dependabot doesn't raise.

**`rustls-webpki` was not a stale lock entry**, as the triage first read it. It arrives as an *unactivated optional* dependency of `reqwest` (`reqwest` → `hyper-rustls` → `rustls` → `rustls-webpki`), and `Cargo.lock` records a package's optional dependencies whether or not a feature turns them on. `cargo tree` is feature-aware, which is why it finds no path — the code genuinely never builds, so the four alerts never reached anything. But `cargo update` **bumps** it rather than dropping it, and it cannot be dropped while `reqwest` is a dependency. It was bumped.

**What proves the bump safe ran, and passed.** `cargo test --workspace --locked`: **494 tests across 51 binaries, 0 failures** (8 ignored, the live-network ones), including the two that a dependency change must not move — `frozen_v1_vectors` (the derivation vectors in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`: a phrase still derives the same Seedelf key) and `spec_constants_are_frozen` (`constants_test.rs`'s pinned script hashes still match what's deployed). `cargo fmt --all -- --check` and `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings` are clean, the CLI release-builds and reports its version against the new `openssl`, and the WebAssembly builds and passes all 41 of its JS tests.

**The module did not grow meaningfully.** Measured A/B — the same source built from the pre-bump lock and the bumped one, `rand` being the only flagged crate that reaches `wasm32`: **2,638,180 → 2,638,557 bytes raw, +377 bytes (0.014%)**, with gzip (781 KB) and brotli (566 KB) unchanged and the timings inside the noise. The rebuild is byte-identical to the measured module, so `build.sh`'s reproducibility (launch review #61) still holds.

**Two things the re-measure turned up, neither caused by the bump:**

- **`wasm/bench.mjs` was broken** and had to be fixed to measure anything. It called `wasm.draftTransfer`, which chunk 14 reshaped to take a `payments` list and the crypto review (`5882024`) then replaced, with every draft/finish pair, by one `build*` call that measures in the wallet. It is not in CI's test glob (`wasm/tests/*.test.mjs`), which is why it rotted unnoticed. Fixed as part of this step; **the same rename is still stale in three other places** — [wasm/README.md](../wasm/README.md)'s API table, [architecture.md](architecture.md)'s builder list, and `extension/tests/fixtures/record-transfer.mjs`, which is broken in the same way. For [the documentation review](#the-documentation-review). **Fixed there (chunk 22)**, along with `record-mint.mjs` and `record-withdraw.mjs`, which step 0 missed and were broken the same way.
- **[wasm/README.md](../wasm/README.md)'s size table is stale by more than double** — it records `wasm-release` at 1,223 KB raw / 424 KB gzip, measured 2026-09-24; the module is **2,577 KB raw / 781 KB gzip** today. Chunks 15–17 (CIP-30, Lovejoin, the transaction view) grew it, not this change. Re-recording it means measuring all three of its rows, which is more than a pre-step — for [the documentation review](#the-documentation-review), and the store zip's size is worth a look at the same time. **Re-recorded there (chunk 22, 2026-10-04):** 2,632 KB raw / 797 KB gzip for `wasm-release`, against 7,100 KB / 1,474 KB for the plain `release` profile; chunks 18–20 added nothing to the module, and chunk 21 a little.

**`compile.sh`'s `cbor2` is a separate install** from the pinned file (root [CLAUDE.md](../../../CLAUDE.md)) and was left alone — but the bump was checked against it anyway, because its one call bakes the seed into the validators and a change there would move the script hashes. `cbor2.dumps(bytes.fromhex("acabcafe")).hex()` is `44acabcafe` on 5.9.0 — the one valid CBOR encoding of those four bytes, so neither the seed nor the hashes built from it can move with a `cbor2` version. The machine's system `cbor2` is already 5.9.0.

**The pinned Python set was installed and exercised, not just edited.** A fresh venv resolves it with `pip check` clean, and on it the backend's own crypto still agrees with itself: a register verifies, a re-randomized `(g^d, u^d)` verifies under the same `x`, a Schnorr proof through `fiat_shamir_heuristic` verifies, and the datum round-trips through `cbor2`.

**The one fixed on merit rather than for a green badge:** `rpassword`'s advisory is *partial password reveal when input is interrupted*, and `rpassword` is what the CLI prompts for a wallet password with. Low severity, and precisely on-point for this project.

**Still a decision, and deliberately not taken here:** `openssl` arrives only through `reqwest`'s default `native-tls` feature. On `rustls` instead, those eight alerts stop recurring rather than being patched each release, and the CLI loses its OpenSSL build dependency. That's a feature-flag change across `seedelf-koios` and `seedelf-display` with the live Koios tests as the check — bigger than a pre-step, so it stays [an open question](#open-questions-for-the-owner). ❓

## Owed

Promises the repo has already made. These come before anything new.

| # | Item | Status |
|---|---|---|
| O1 | ~~1.1.0 goes live, and is recorded.~~ **Dropped** (the owner, 2026-10-04): the docs don't track the store. Anything a dashboard asks that the docs don't cover still goes in [store/README.md](store/README.md). | — |
| O2 | **The by-hand mainnet checks** (from the launch review's *Still open*): `exclude_protocols` with VyFinance and MuesliSwap, one swap through each remaining route in `MAINNET_PROTOCOLS` (one is proven so far), and Stop or a refund on a swap. The owner's, since they spend real ADA. | ⬜ owner's |
| O3 | **A chain in flight is invisible to the transaction view.** Its transactions move to `seedelf.session.chain.<network>.<index>`, which `BUILT_KEYS` doesn't name, so the audit view wants that prefix scan. And **Home's banner watches the chain's last transaction**, so it shows a hash the user never saw — it may want to say "the chain" instead. Both from chunk 17's handoff note. | ⬜ |
| O4 | **A2, the contract round trip:** a Minswap V2 order paying straight to a Seedelf. Designed in [flows.md](flows.md#contract-round-trip); waiting on a batcher test. | ⛔ blocked |
| O5 | **The restore scan.** After a restore, or with the same phrase in another browser, what a private session's one-time account (`24301'`) still holds doesn't show, and Remove wallet and Forgot password say so (independent review M5) — that warning is the promise. The design is in [keys-and-accounts.md](keys-and-accounts.md#accounts): one scan of the indices, at a restore or from a button, never on an open. Swaps, site sessions and Lovejoin's mix sessions share the sequence, so one scan covers all three. | ⬜ |
| O6 | **Chunk 21 by hand:** retire live, which also confirms the ledger drops delegations to a retired DRep (what [flows.md](flows.md#be-your-own-drep-and-vote-public-account)'s "the rewards stay withdrawable" rests on); a profile update live; and GovTool over CIP-95. Registering with the account's own vote, and a vote, ran on preprod on 2026-10-04. The owner's. | ⬜ owner's |
| O7 | **The public Activity's two blind spots.** It lists by stake address (`activity.ts`, `account_txs`) while the balance reads by payment key, so a transaction touching only an enterprise address of the account, or its key under someone else's stake key, is counted and spent but never listed, nor in the CSV. And a Lovejoin mix from the public account lists its deposit and every mix as plain **Sent**, since an account transaction's kind comes only from the Seedelf history (chunk 16's *Not done*). | ⬜ |
| O8 | **Dates and numbers aren't localised.** About twenty `toLocale*`/`Intl` calls pin `en-GB` or `en-US`, chunk 21's `Voting.tsx` among them. The fix is chunk 19's: one locale map (en → en-GB, es → es-ES, ja → ja-JP) threaded through those calls. | ⬜ |
| O9 | **Tell Lovejoin what we found** (outward-facing, so the owner's): its `config/network.{mainnet,preprod}.json` and `offchain/src/seedelf/addresses.ts` swap Seedelf's preprod and mainnet reference UTxOs; its mainnet config has `mix_script_hash: null` (ours, `c145c10f…1fad`, is confirmed against mainnet transactions); and **its withdraw writes no datum while its app offers any script address as a Seedelf one** — the deployed `wallet.ak` lets anyone spend a UTxO with no datum, so a box withdrawn to the Seedelf contract from Lovejoin's own app can be taken by anyone. That fix is theirs: a fresh register when the destination is the Seedelf contract. | ⬜ owner's |

## Feature parity: what's left

Three items, all done (2026-10-04). The wallet is feature-complete for Cardano, bar [dApp additions](#dapp-additions).

### P1 · Several accounts

**✅ Done, 2026-10-02: chunk 18**, the owner's first pick after the release. Branch `web-wallet/several-accounts`, plan [archive/plans/chunk-18-several-accounts.md](archive/plans/chunk-18-several-accounts.md), handoff note in [roadmap.md](roadmap.md#handoff-notes).

**What landed.** A picker in the top bar, hidden with one account (chunk 23 made it Home's Public heading); Settings → Public accounts to switch, name and look for another; discovery on a restore and on demand, **one Koios `account_addresses` request per account probed**, stopping at the first never used; each account with its own staking, collateral and locked UTxOs; and the private side kept apart per account (`public:<n>` history classes). The two things that needed deciding and were decided in the building:

- **Connected sites use one chosen account, the dApp account** (Eternl's model; the owner's call after testing a many-account wallet on preprod, 2026-10-02). Settings → *Sites* → **The account sites use** picks it; it doesn't follow the picker, and no site is refused because the wallet is on another account, so switching shows a site nothing new. Changing the dApp account is a deliberate act, and Settings says every connected site then sees the new one (`Preferences.dappAccount`, `withDappKeys` in `dapp.ts`). It replaced a first build, the same day, that bound each site to the account it connected with and refused it elsewhere.
- **Discovery asks about one account at a time on purpose.** `Koios.usedStakeAddresses` would answer for twenty in one request, and that request would tell Koios those twenty stake addresses are one wallet's. Separate requests are less linkage, not none — Koios still sees them from one IP seconds apart, and [privacy.md](privacy.md#known-links) says so in those words.

**The owner's correction, 2026-10-02, and the rule it set:** *"a user may want to use the wallet to send between accounts too. We are making a lot of assumptions about accounts not being linked when they in fact can and in some cases that was encouraged."* So **the wallet never forbids a link the user chooses** — paying one of your own accounts from another goes through, with the form naming the account and saying what it reveals, as every other entry in [privacy.md](privacy.md#known-links)'s *Known links* is handled. What it avoids is making a link *for* them: coin selection keeping accounts' money apart where a choice that doesn't merge them pays, and a site never being handed a second account behind their back. A first attempt refused the send outright; that was over-reach and was removed. Privacy by default means the private option is the **default**, not the only one.

**And accounts are reached by number, not only found** (the owner, 2026-10-02): sequential discovery stops at the first unused account, so a custom index like 1337 could never be found, and `use` refused what discovery hadn't seen, so one could never be *started* either. Settings → Public accounts takes an account number — **Check it** (one Koios request) and **Add it** (no request, used or not).

**What is deliberately not in it:** folders and an account centre (a picker and a name are what the parity gap was), a Seedelf key per account (decided against), reading several accounts at once or showing a total across them (the wallet doesn't put them together on its own), and an account per site: one dApp account for every site is the model.

**The original brief, kept for the reasoning:**

**The owner's reason (2026-10-02):** a user restoring a phrase may hold funds on accounts other than `0'` and want to move them into Seedelf, and **some people run several accounts as a form of privacy in the first place** — so a wallet that can only see one is both losing their money and working against the habit they came with.

The groundwork is in: every function already takes the account index, and a picker would discover accounts in order the way BIP44 does, stopping at the first never used ([keys-and-accounts.md](keys-and-accounts.md#the-cardano-account)).

**Decided (the owner, 2026-10-02): the Seedelf key stays on account 0 — one private balance for the whole phrase.** The derivation would allow one key per account (`info = "seedelf-key" || u32_be(account)` in [derivation.rs](../../seedelf-crypto/src/derivation.rs)), and it isn't needed: **the stealth addressing already unlinks the move-ins.** Two public accounts paying the same Seedelf create re-randomized registers `(g^d1, u^d1)` and `(g^d2, u^d2)`, which can't be tied to each other or back to `(g, u)` without `d`, so nothing on chain links the accounts. Account 0 is, in effect, the nonce.

**What stealth addressing does *not* cover, and this is P1's real work: co-spending.** A contract UTxO's creating transaction is public. The registers hid *who* the money went to, not where an input came from — so one later private spend that takes a UTxO originating from account 0 together with one from account 1 ties those two accounts to one owner, in the open.

The machinery for this already exists (privacy review §2.3): each private UTxO gets a `HistoryClass`, `seedelf-core`'s `build::Histories` keeps different classes apart where a choice that doesn't merge them pays, and the UTxOs screen tags each UTxO's origin.

**But today every move-in shares one class.** `MADE_PRIVATE` is a single constant — `{ id: "public", origin: "own" }` in [shared/histories.ts](../extension/src/shared/histories.ts) — so money made private from account 0 and from account 1 would be the *same* history, and selection would co-spend them freely. P1 has to make it per-account (`public:<n>`), which means:

- `originOf` reading the prefixed form; it compares `part === "public"` exactly today.
- **Sealed history on existing devices still parsing the bare `public`** — those records are already written, so the old form has to keep working.
- The review's wording and the UTxOs tag naming *which* account money came from (histories.ts' "money you made private").

Treat that as a correctness-of-privacy item, not a nicety: without it, several accounts would quietly undo the separation the feature exists to respect.

~~Also to settle: discovery cost against the Koios budget, and what the dApp connector offers a site when there are several accounts~~ — both settled in the building, above.

### P2 · Language

**Built, chunk 19** ([plan](archive/plans/chunk-19-language.md)): all 2,471 strings are out of source; at its merge `en.json` held 2,128 keys, `es.json` 2,128 and `ja.json` 1,940, and 195 derived accuracy-critical keys are back-translated and recorded. It cost +567 kB raw / +134 kB gzip of bundle — the three locale files plus i18next, which has no dependencies of its own. English is byte-identical everywhere, which is how the 1,186 existing tests passed unchanged (1,190 with the four this chunk added). Dates and numbers are **not** translated: 19 `toLocale*`/`Intl` calls still pin `en-GB`/`en-US`, which the plan names as a known gap with its fix. Each of the costs this entry predicted is settled below; **what it did not settle is who reads the Spanish and Japanese** (settled on 2026-10-03: [accepted as recorded](#open-questions-for-the-owner)), and the plan's *Still open* says plainly that nobody has. **A whole-locale review followed (2026-10-03/04):** one reviewer per language read every entry, the corrections and a second reader's check are in, and it found the worker had never switched language (about 300 messages English for everyone) — fixed, with the code that read its own English made language-proof first. 298 keys were critical after it, 195 at the build, and the set grows with every chunk: [i18n/critical-keys.json](i18n/critical-keys.json) is today's. [The plan's section](archive/plans/chunk-19-language.md#the-whole-locale-review-2026-10-03) has the rest.

**The original brief, kept for the reasoning:**

**Copy what Lace does, including its languages** (the owner, 2026-10-02): **English, Spanish and Japanese** — "probably a very large chunk of the Cardano user base". It's a good fit for our rules because **every locale is bundled — nothing is fetched, so no new host and nothing phones home**:

- **i18next**, with one flat JSON per locale in `contract/i18n/src/translations/` — Lace ships `en`, `es`, `ja`.
- **The picker derives its own list from the bundled files.** Each locale file carries `translation.language.name` and `translation.language.code`, so the languages are a single source of truth and adding one is: write the JSON mirroring `en.json`'s keys, register it, and i18next and the picker pick it up (their `translations/index.ts` says exactly this at the top).
- **Default `en`**, with the system locale used when it's one we ship (`getSystemLanguage()`).

**What it costs us, specifically:**

- **No strings are externalised today.** This is the bulk of the work, and it touches every screen.
- **`tests/words.test.ts` has to move with them.** It parses source files for a lowercase "seedelf" in anything a person reads; once the text is in JSON it must check the locale files' values instead — and **Seedelf stays Seedelf in every language**, so it can check them all, not just English.
- **A missing translation must fall back to English, never vanish** — i18next's `fallbackLng` does this, and it matters most for the privacy notes, which the rules say may never be dropped.
- **There is no Spanish or Japanese reader on the project** (the owner, 2026-10-02), so the translation is Claude's, double- and triple-checked, and an error found later by a user is accepted as the risk. That makes the handling of it the design, since "be careful" isn't a plan:
  - **Mark the safety-critical strings as a set.** The privacy notes and warnings get an identifiable key prefix, so there's a short list — not 150 scattered strings — to hand a fluent reader, or a user who reports one. This is the highest-leverage part: it's what makes a later correction cheap instead of a hunt.
  - **Back-translate that set only.** Translate it back to English without the original in view and compare meaning. It catches the failure that matters — a dropped clause or an inverted negation, as in "anyone can see money went into Seedelf, **though not whose Seedelf it is**" — which is exactly what a confident wrong translation looks like.
  - **Pin the structure in a test**, as `words.test.ts` already pins the name: same sentence count, a negation where English has one, placeholders intact, Seedelf still capitalised, and never silently equal to the English or empty.
  - **Make reporting one the designed path.** Say in Settings that translations aren't checked by a native speaker and where to report an error. "Someone later says it's wrong" is then the feedback loop working, not a surprise. (Settings said so until the owner removed the note in chunk 23's pass three, keeping *Report a translation error*: [blind test §11](blind-task-usability-test.md#pass-three-the-owners-review-of-the-fix-round).)
  - **English stays reachable** — the picker can always go back, and the docs are English — so a user who distrusts a translated warning has somewhere to check it.

### P3 · NFT images

**✅ Done, 2026-10-04: chunk 20.** Branch `web-wallet/nft-images`, plan [archive/plans/chunk-20-nft-images.md](archive/plans/chunk-20-nft-images.md), handoff note in [roadmap.md](roadmap.md#handoff-notes).

**What landed.** **Show image** in an NFT's details, and nowhere else. One Koios `asset_info` request for its metadata (CIP-68's datum, or CIP-25's label 721), then one fetch from IPFS through **Blockfrost's gateway, `ipfs.blockfrost.dev`**, the only one of about twenty public gateways that still served files (ipfs.io has gone service-worker-only). Before the click, the details say who sees what, and on the private side that either party could tie this IP address to the UTxO holding the NFT. The first click asks Chrome for that one host, a part of the dApp connector's optional `https://*/*`, so installing asks for nothing new; when that access, given for connecting sites, covers it already, nothing is asked. The image comes as data, with no cookies and no cache, and stays in the page's memory until the wallet locks, as the NFT's avatar too. **Only IPFS is fetched:** an image on any other server is an address to copy, because anyone can send you an NFT whose image is on their server. A Seedelf's token is never asked about.

**The original brief, kept for the reasoning:**

**The owner's design (2026-10-02): click to show, and the image downloads to that browser.** No image host or proxy of ours — serving image data for every asset needs serious hardware, and a proxy would be one more service that sees what a wallet holds.

- **Off until clicked**, per image, so nothing is fetched for a wallet merely opening Tokens.
- **The residual leak, stated where it's chosen:** the click tells whoever serves that image (an IPFS gateway, usually) that this IP wants that asset. That's the trade-off being accepted — user-initiated, one image at a time, instead of a page that quietly fetches everything a wallet holds.
- Deferred in chunk 14 pending "a better way to fetch them first"; this is it.

## Public-side completeness

**The owner, 2026-10-02: after the accounts, and before the UX pass.** Some of what sat under *Not planned* is worth doing **for the public side**, because it's what makes this a full wallet rather than a private balance with a wallet attached — and the pass should get a finished wallet to look at rather than one with governance still arriving.

**The order, with one correction.** The owner's sequence was accounts, then voting, then DRep, on the reasoning that "DRep is part of staking too since it's required". Both halves are right, about different things:

- **Vote delegation really is required for staking rewards** — Conway pays none until voting power is delegated, and the wallet already does this and says so (chunk 13). **So nothing about rewards waits on anything here.** That box is ticked.
- **But registering as a DRep is the gate on voting, not a sibling of it.** A plain delegator doesn't cast a vote on a governance action; votes come from DReps, SPOs and the constitutional committee. To vote with your own stake you register as a DRep — for yourself, if nobody else delegates to you. So voting-before-registering isn't an order, it's a dependency the wrong way round.

**Which makes them one chunk, not two:** *be your own DRep and vote.* Registration on its own is a half-feature (a credential nobody uses), and voting on its own can't be built. ✅ **Chunk 21** (2026-10-04), branch `web-wallet/governance`, plan [archive/plans/chunk-21-governance.md](archive/plans/chunk-21-governance.md).

| # | Item | |
|---|---|---|
| 1 | **[P1, several accounts](#p1--several-accounts)** | ✅ done, chunk 18 |
| 2 | **Be your own DRep, and vote on governance actions.** Register the account's DRep credential, then vote Yes, No or Abstain on a live action. Needs a list of open governance actions, which is a new read and so a new Koios cost to state. **The owner's calls (2026-10-04):** the wallet's own screens first, then CIP-95 in the connector so GovTool works too; no profile unless one is asked for; the account delegates its vote to itself on registering, by default. | ✅ [chunk 21](archive/plans/chunk-21-governance.md) |
| — | **Staking per account** needed no slot: it fell out of [P1](#p1--several-accounts) for free, as expected — each account has its own stake key (`2/0` under its own index), so several accounts means stake spread across several pools, with no change to `staking.ts`. **That is exactly Lace's model after its multi→single migration** — the outcome people wanted from multi-delegation, without multi-delegation, and without touching one-pool-per-account. | ✅ done via P1 |

**What doesn't change:** a vote or a registration is a public act by a public key. None of it reaches the private side, and none of it weakens the rule that money made private has no stake key behind it. A Seedelf address has no staking part, so the private balance has no voice to cast and never will.

## The data layer

> **Parked until the sequence above is done** (the owner, 2026-10-02). Koios works today. What's below is the shape as it stands, kept so the next look starts from it rather than from scratch — **it is not the next chunk.** The reason for the wait is the honest one: a service is not a feature. It goes beyond making the wallet work as expected, into something that has to stay up, stay paid for, and stay unexploited for as long as the wallet is in the store.

**Decided in shape (the owner, 2026-10-02): a db-sync wrapper in Rust, for the web wallet.** Not a general API — queries written for this wallet. **The CLI stays on Koios**, which already works for it, so this is one client, not two. **giveme.my needs no fork**: the owner runs it, so it can be adjusted directly if the collateral side ever wants the same treatment.

**Clearnet, and the owner is leaning yes** — because Koios is slow and its rate limit bites. **Tor is out of scope here, and that's a consequence, not a compromise:** the one client is a Chrome extension, Chrome doesn't resolve `.onion` (RFC 7686 special-use, deliberately unsupported), and the CLI — the thing Tor could have served — isn't a client. The root [README](../../../README.md#de-anonymizing-via-ip-tracking)'s Tor exploration stays a CLI and general-infrastructure aspiration. A user who routes their whole machine through Tor still reaches a clearnet endpoint over Tor, so what the wallet owes them is a **configurable endpoint** and nothing leaking around it.

### What it fixes

- **The contract scan pages, and grows.** Preprod's shared contract is already past one page of 1,000 rows, so a reading takes two requests — and that grows with the contract, for every user, forever.
- **The budget is tight and shared:** 5,000 requests a day and 100 every 10 seconds per IP, which the wallet holds itself to 40 of so two workers either side of a restart still fit. Chunk 14's rules make every feature state its request cost because of this.
- **It's slow where it hurts.** `TIMEOUT_MS` is 45 s because one `credential_utxos` over an account with real history "can take tens of seconds on the public tier" (found on mainnet, 2026-09-28).
- **It's what the notification centre waits on.** Background reading of the chain is impossible under the budget above.

### The constraint that has to hold

**The ownership check stays in the wallet.** Matching a contract UTxO to a Seedelf needs the secret scalar, so the server must never be asked "which of these are mine" — it serves contract UTxOs and the wallet matches locally, as it does now. A service that answered that question would be a service that knows every user's private balance.

### DoS protection on clearnet — the owner's question

The wallet makes **two** `credential_utxos` queries, and they are opposite in every way that matters here. That split is the whole design.

| | The contract scan | Account UTxOs |
|---|---|---|
| Whose data | The contract's whole UTxO set — **byte-identical for every user** | The user's own payment credentials (batched 75 a request) |
| Cacheable | **Completely** | Not at all |
| Cost per request | Near zero once cached | A real query, and the slow one today |
| What it reveals to us | "This IP uses Seedelf", and when | **Which credentials a user is asking about** |

**In order of leverage:**

1. **Not being general is the main defence.** Koios is PostgREST: any filter, any order, any depth — which is exactly why it can neither cache your query nor bound its cost. A small fixed set of endpoints with fixed query shapes means no caller can *compose* an expensive request. The worst available is a cheap question asked often, which is a rate-limiting problem rather than a database one.
2. **The expensive query is shared, so cache it.** One db-sync read per block (~20 s) serves every user the contract set from memory, with its block height and an ETag. Someone hammering that endpoint gets cached bytes: the cost is bandwidth, not db-sync. **The query that hurts most under Koios is the one that caches perfectly** — that's the single biggest win available, and it's also the cheapest thing to defend.
3. **Deltas, which the wallet already asks for.** After a first read it sends only `block_height=gt.<last>`, so steady state is small responses, cached the same way.
4. **The per-user endpoint takes the bounds instead:** an index on the payment credential, a cap on credentials per request (the wallet already batches 75), a concurrency cap per connection, and a per-IP token bucket — **a counter in memory, not a log**: never written to disk, never joined to what was asked. Rate limiting needs the IP for a few seconds; it doesn't need a record.
5. **A hard budget with a circuit breaker, and Koios as the fallback.** A monthly egress and compute ceiling that degrades to "ask Koios" rather than failing. Neither a surprise bill nor an outage should brick a wallet, and keeping Koios in the picture means the service is never a single point of failure.

**What not to do: a third-party edge.** Cloudflare or a managed WAF in front is the obvious answer and it undoes the point — it terminates TLS, so a third party sees every request and every IP. That's the Koios linkage with extra steps and a worse story, because we'd have chosen it. Volumetric protection, if it's ever needed, wants to be something we run, or an upstream that sees only encrypted bytes.

**What the service still learns, said plainly.** The contract endpoint learns that an IP uses Seedelf. The account endpoint learns which payment credentials that IP asks about — the same thing Koios learns today, moved to us. The local ownership check is what keeps the *private balance* out of it entirely. So the no-log promise and the open source carry the account endpoint, and those are a policy and an audit trail, not a proof — which is worth saying in the privacy docs in exactly those words.

### Still open, for when it's picked up

What it costs to run, and who pays; whether it's the default with Koios as the fallback or a choice; whether a user can point the wallet at their own instance; the host-permission problem in Chrome (a new origin at install, or an optional grant when it's set); and the operational half a feature doesn't have — monitoring, what an outage looks like from inside the wallet, and what is promised to users about uptime and logging, in writing.

## The UX and UI pass

**Round three, after parity and the public-side work** (the owner's call). Chunks [12](archive/plans/chunk-12-style-flow.md) and [14](archive/plans/chunk-14-style-flow-2.md) were rounds one and two; 11a was only half-Lace. It runs the way both of those did: **the owner tests the built wallet and sends findings; each goes in a table with what was decided**, and batches land with tab and side-panel screenshots to check before the next rebuild.

Parity and the public side have landed, so the list is the owner's to write now. **Chunk 23 began it with two adversarial usability reviews of the built wallet**, each followed by a fix round: [usability-review.md](usability-review.md) is the second review: its opening says what the first round fixed, and §9 what the second did and which calls it left the owner (renaming Make public, opening on Public, Swap on Home, UTxOs behind Advanced, two decimals, a password on the wallet's own sends, the splash below). **A blind task-completion test followed** ([blind-task-usability-test.md](blind-task-usability-test.md)): fresh testers given goals, not paths, through 29 runs of the built wallet. Its §9 ranks ten changes, and §11 says what the fix round did with each, and which calls it made or left for the owner. The owner has since kept Home opening on Private, and Swap and Mix behind dApps (§11's pass two). **Still the owner's:** renaming Make public, polling for money coming in and a password on the wallet's own sends ([§11's *Left for the owner*](blind-task-usability-test.md#left-for-the-owner)), and from the usability review's §9, UTxOs behind Advanced, two decimals and the splash below. Carried candidates:

- **About 150 plain note paragraphs could become ⓘ hints.** Chunk 17 built `components/Hint.tsx` and moved the transaction view's six paragraphs behind icons; the owner's wider point was that "a lot of the paragraphs we have could be like that". Which ones is theirs to pick. **Privacy callouts and warnings stay where they are** — those are decisions, not explanations. ✅ Chunk 23: the owner said do it, and 23 went by a rule now in [development.md](development.md#rules-for-a-change-to-the-screens); which others should go is theirs to say.
- **The splash reaches its 8 s cap on mainnet.** That's Koios being slow, not the splash (chunk 17's note) — and possibly [the data layer](#the-data-layer)'s to fix rather than the splash's. Worth asking whether a first reading can show something sooner, a balance that fills in, rather than a cap that expires.
- **What parity and the public side added** — the language picker, NFT images, and being your own DRep (the Staking and governance page, Voting, the connect window's CIP-95 switch) — reached the pass having never been through a findings round, and so did the transaction view. Chunk 23's second review and its blind test went through the Staking and governance page, Voting, the language picker, the transaction view, Settings → Public accounts and the account picker (Home's Public heading since pass three). **NFT images' Show image and the connect window's CIP-95 switch still haven't been through one.**
- **The connector's windows don't say which public account a site gets.** They say "Your public account", while with several accounts sites always use the one Settings → *Sites* → **The account sites use** names, whichever is on screen — so a signature can come from an account the screen isn't showing. They should name it (its number and name). Correctness UX, so in scope whatever else the list holds. The same chunk asked whether the top bar's native `select` holds up past about a dozen accounts. ✅ Chunk 23: every window names it with several accounts; the `select` stays.
- **Three messages say less than the truth.** `worker.accounts.tooMany` says "Remove one from the list", and there's no way to remove an account from it; `worker.accounts.badIndex` counts accounts from 0 while the screens count from 1. And retiring a DRep reads four ways in Spanish ("Retirarte como DRep", "Da de baja tu DRep", "retiras tu DRep", a bare "Retira un DRep") and two in Japanese (退任 for your own, 引退 for another's) — the glossary should record one each once the strings agree (chunk 22's review). ✅ Chunk 23.
- **"The Staking page"** is still the shorthand in two messages (`koios.staking.notDelegated`, `settings.staking.rewardsWait`) since chunk 21 renamed the page **Staking and governance**. ✅ Chunk 23.

## dApp additions

**Not counted in parity, and ongoing.** The dApps page's catalogue is the one part of the wallet that grows after feature-complete: each entry is a claim that the dApp works *privately*, through a one-time account with the money coming back, so each needs its own test run before it ships. Minswap is the first, Lovejoin is in, and A2 ([O4](#owed)) is the next shape of it.

🚧 **Chunk 24** (`web-wallet/dapp-additions`, plan [plans/chunk-24-dapp-additions.md](plans/chunk-24-dapp-additions.md)): more of the high-volume DEXes through Minswap's router — SundaeSwap V3 first, then Danogo's direct swaps; the foundation in the session's checks first, then each DEX turned on with its live swap (the owner, 2026-10-06).

**Minswap's own site never offers Seedelf Wallet.** Its wallet list is fixed (its `WalletProvider` enum), and inside a frame it connects only to Eternl, through Eternl's bridge; answering as Eternl would be impersonation. Asking Minswap to list Seedelf Wallet would open its site to the public connector and private CIP-30 (chunk 15). ⬜ owner's

## The documentation review

**✅ Chunk 22, 2026-10-04**, on `web-wallet/doc-review`; the record is [archive/plans/chunk-22-documentation-review.md](archive/plans/chunk-22-documentation-review.md). **Brought forward ahead of the UX pass** (the owner, 2026-10-04) rather than run after it, so the pass keeps the docs current as it goes instead of needing a second review ([development.md](development.md#rules-for-a-change-to-the-screens)).

**What it settled, and what holds from here:**

- **The three audiences stay different documents.** The human-facing ones — the root [README](../../../README.md), the web wallet's [README](../README.md), the design docs ([architecture.md](architecture.md), [flows.md](flows.md), [privacy.md](privacy.md), [keys-and-accounts.md](keys-and-accounts.md), [development.md](development.md)) and [store/](store/README.md) — describe the wallet as it is, and are read by users, by people judging whether to trust it, and by the Web Store reviewer. The record ([archive/](archive/)) isn't maintained. The agent-facing ones — [plans/](plans/) and the three CLAUDE.md files — are where being out of date actively misleads.
- **Finished plans move to [archive/plans/](archive/plans/)**, once what still holds is in the design docs, so [plans/](plans/) only ever holds live specs ([plans/README.md](plans/README.md)). Every plan up to chunk 21, and the four reviews, moved in this chunk; their open items moved to [Owed](#owed) and [Kept in mind](#kept-in-mind).
- **The docs don't date releases or describe the store** ([How this file works](#how-this-file-works)).
- **Anything outside CI's globs rots:** three fixture recorders were broken by a rename nobody ran them against. A change to a WebAssembly export greps `tests/fixtures/` and `wasm/*.mjs` too.

**Left for later:** the privacy docs get the data layer's paragraph when there is a data layer, in the words [The data layer](#the-data-layer) uses: what the service learns, and that the no-log promise is a policy and an audit trail rather than a proof.

## Kept in mind

- **A notification centre** — word of an incoming payment without opening the wallet. Not this round: it needs [the data layer](#the-data-layer), and it must not change what a backend can tell about a locked wallet. ⬜
- **`web+cardano` payment links** (CIP-13), so a link can open Send with the recipient filled in. ⬜
- **A DRep paid from a one-time account**, to keep the DRep apart from the account (chunk 21). Today the DRep is the account, and the notes say so. ⬜
- **A translated store listing** (chunk 19): the listing is English only, though the wallet speaks three languages. ⬜

**Left by the chunks and the reviews, moved here when [plans/](plans/) was archived (2026-10-04)** so they're tracked somewhere live. None is a promise; each is a candidate, smallest first where it's obvious.

- **Private spends carry no validity interval** (launch review, *Still open* #2): `ScriptSpend` stages no `invalid_hereafter`, only the account builders do. It waits on a live check that giveme.my signs one.
- **A stake- or DRep-key-only signature over the other network's transaction** (launch review, *Still open* #5): CIP-30 signing refuses a body whose `network_id` or inputs are the other network's, but certificates and, since CIP-95, votes carry no network.
- **Drafts that still reach Ogmios at review** (privacy review §3.10): the account-paid mint's draft and a Lovejoin chain's `crossCheck`. A review the user abandons still shows Koios the Seedelf name, or the planned deposit.
- **The privacy review's optional controls**, none built: which sites see the wallet (§4.4), longer Lovejoin waits (§4.5), clearing private history (§4.6), spreading out Bring everything back (§4.8, together by default, the owner's choice), and §4.9's smaller switches. §4.7, your own Koios, is [the data layer](#the-data-layer)'s.
- **The lock countdown doesn't say a chain is being sent**, nor roughly how long it takes (privacy review §6).
- **The password is hashed as typed**, not Unicode-normalised (crypto review, *Not fixed* #3), so the same password composed differently on another keyboard won't open the vault. Normalising needs care: an unlock would have to try both forms and reseal.
- **The launch review's other smaller items** (its *Still open* #5), as it left them on 2026-09-27 and not re-checked since: #14 and #15's refusals reach only the site, not the user; a chain's last window isn't watched until it lands; chain records live only on one device; the Lovejoin page's buttons aren't disabled while a payment may still go through (the worker refuses them, and the page says why); one maybe-sent watch per network; a resend's "not on chain" count isn't kept across pump calls; and a swap's review says "less than a box's worth … comes back at once" without the amount. Of that list, #21 was settled by the independent review's owner call 4. **The `h2` and `spin` items are still open**: CLI only, and RustSec's rather than Dependabot's, so [step 0](#step-0--a-clean-dependabot-report) never saw them and bumped neither. `h2` 0.4.11 (`reqwest`) and 0.3.26 (`warp`'s `hyper` 0.14) are inside RUSTSEC-2026-0258, patched in 0.4.16, and 0.3.26 stays until `warp` leaves `hyper` 0.14; `spin` 0.9.8 (`warp` → `multer`) is yanked, with 0.9.9 current. Neither reaches the WebAssembly. They wait for the CLI's next change: `cargo update -p h2@0.4.11 -p spin`, then step 0's checks.
- **A timed partial return after a swap's cancel** (independent review L16), once a live check shows Minswap can cancel from a small reserve.
- **`MIX_FEE_ESTIMATE` is 0.95 ₳** (`seedelf-core/src/lovejoin.rs`) against the 0.8225 ₳ a mainnet mix measured. And **a swap's return says nothing** when its spare ADA pays for no Lovejoin box.
- **The connector never offers to set a collateral** when there's none, as Lace does — `getCollateral` answers null (chunk 12). And the collateral payment shows in the public Activity as plain **Sent**.
- **No live minimum before Review**: a form says "the review shows how much", since a minimum needs the protocol parameters (chunk 12).
- **The mainnet token list's logos are base64 in the bundle** (`registry.mainnet.json`, about 120 KB); files would be smaller (chunk 12). Mainnet tokens left off it for the owner to vet: MILK, C3, NMKR, MELD, WRT, WMTX, BOOK (its asset name reads HODOR) and USDCx.
- **On the Lovejoin page:** a mix whose funding never landed can't be forgotten, only pushed off by five newer ones; and offered but never decided — each box's due time on the page, Home's banner for withdraws that run themselves, a *Through Lovejoin* switch on Make private (the owner: "maybe not"). A public mix has never been run live.
- **Koios GETs may land in Chrome's disk cache.** Only the NFT image fetch sets `cache: "no-store"`; the worker's other service fetches (`SERVICE_FETCH` in `koios.ts`) don't, and three of them name something private in the address — an ADA Handle (`asset_nft_address`), the DRep ID (`vote_list`), a session's address (Minswap's `pending-orders`). Whether anything is cached depends on the services' response headers, which nobody has checked (chunk 22's review).
- **A site's waiting request outlives a change of dApp account.** `stillConnected` checks the session, not the public account, so changing **The account sites use** while a request waits has it signed with the new account's keys over a transaction inspected for the old one. Harmless as it stands (the new keys own nothing in it, and `signDappData` refuses the address), but the request should be declined; recording the account with the request is the fix (chunk 22's review).
- **A public-account site's signing prompt doesn't name a payment to another of your public accounts.** It reads "An address", with no tie warning; Transaction details names it. A session's prompt names every one. Naming it needs a `Tie` that carries the account's index, and words for it (the release review, C05's public half; the UX pass's).
- **A site's `submitTx` refusal no longer carries the node's own reason** (`ValueNotConservedUTxO`, say). Koios's sentence around it is in the user's language, and a site hears only English, so it hears the kind of refusal or that it wasn't sent (the release review). `KoiosError` would have to carry the node's text apart.
- **Small ones:** a search by tag (chunk 9), rewards history (chunk 13), a QR scanner (chunk 12), and swaps straight against a pool rather than through the aggregator (15b).

## Not planned

Shorter than it was: the owner has reopened the governance items for the public side (see [above](#public-side-completeness)). What stays out:

- **Several pools per account.** One pool per account is the model, not a limitation — and several accounts (chunk 18) reaches the same outcome without it.
- **Folders, and an account centre** (Lace has both). A picker, a name, and each account's own staking and collateral are what the parity gap actually was; chunk 18 closed it.
- **A Seedelf key per account.** One private balance for the whole phrase (the owner, 2026-10-02): stealth addressing already unlinks the move-ins, so a key per account would buy nothing and split the balance.
- **Reading several accounts at once, or a total across them.** Either would link them at Koios and on screen, which is the opposite of what several accounts are for.
- **The rest of governance** (chunk 21): proposing actions (100,000 ₳ on mainnet, and nothing a wallet's user needs); script DReps, the constitutional committee and pool votes; and, unless the owner asks, a rationale on a vote (a CIP-136 anchor, which could work the way the profile does) and tallies per action (`proposal_voting_summary`, one more request an action).
- **Hardware wallets** — see [the proof](#why-hardware-wallets-cant-cover-seedelf).
- **Earn / RealFi USDr staking, and CIP-99 claims:** likely AML/KYC, which doesn't align with Seedelf.
- **Cardano only for now.** Other chains, and mobile, maybe much later; nothing is designed for them.
- **Nothing that reports on the user or ties them to an identity** — analytics, AML/KYC, an on-ramp. Confirmed by the owner, 2026-10-02. Lace ships all three; they're the opposite of what this wallet is for.

### Why hardware wallets can't cover Seedelf

Not declined for effort — it doesn't work, and the reason is one line of the derivation.

**The Seedelf secret scalar comes from the BIP39 seed** ([derivation.rs](../../seedelf-crypto/src/derivation.rs), v1, frozen):

```text
seed = BIP39 seed of the phrase          PBKDF2-HMAC-SHA512, 2048 rounds
okm  = HKDF-SHA-256(ikm = seed, salt = "seedelf-wallet-v1",
                    info = "seedelf-key" || u32_be(account), L = 64)
x    = int_be(okm) mod r
```

1. **A hardware wallet's one guarantee is that the seed never leaves it.** So outside the device there is no seed, and without the seed there is no `x`.
2. **Inside the device there is no path either.** A Cardano app would have to implement Seedelf's HKDF *and* then the BLS12-381 Schnorr proof over it (`z = r + c·x`, with `c` binding the one-time key hash). The Cardano apps sign Ed25519 over a transaction hash; none exposes arbitrary BLS12-381 scalar work, and none ever will on our ask.
3. **So hardware could only ever hold the public account's CIP-1852 keys** — half the wallet — while the private side still needs the phrase in the browser. A wallet that is half secured by a device is a worse thing to explain than one that isn't.
4. **And it's structural.** The v1 derivation is frozen, because every existing phrase depends on it; there's no redesign that reaches a device without being a v2 scheme no device implements either.

The same argument rules out air-gapped QR signing for the private side, for the same reason.

## Open questions for the owner

**Settled on 2026-10-02:** [P1](#p1--several-accounts)'s key (account 0, one private balance), that it's chunk 18, and — in the building — that connected sites use one chosen dApp account and that discovery asks Koios about one account at a time; [P2](#p2--language)'s languages (English, Spanish, Japanese); [P3](#p3--nft-images)'s design (click to show); [the data layer](#the-data-layer)'s shape, and that it's **parked** until the sequence is done; [public-side completeness](#public-side-completeness) going after the accounts and before the UX pass; a [documentation review](#the-documentation-review); dark only; one phrase; and no analytics, AML/KYC or on-ramp. The web wallet [README](../README.md) is tidied.

**Settled on 2026-10-03: who reads the Spanish and Japanese privacy strings — accepted as recorded** (the owner). The critical keys are back-translated, and `docs/i18n/verified-critical-{es,ja}.json` says in its own reviewer line that no native speaker has read them. A review pass went over every translation on 2026-10-03 (Claude again, no native speaker), and a fluent reader can be found later. The fallback (English-only for those strings) stays available, since the keys are an identified set.

**Settled on 2026-10-04:** the DRep correction — registering and voting are one chunk, [chunk 21](archive/plans/chunk-21-governance.md); and whether a plan says it's live or finished — **finished plans move to [archive/plans/](archive/plans/)**, so [plans/](plans/) holds live specs only, and what still holds moves into the design docs first. Also that the documentation review runs before the UX pass, and that the docs don't date releases or describe the store.

What's left:

1. **`rustls` instead of `native-tls`?** Raised in [step 0](#step-0--a-clean-dependabot-report): it would stop the eight `openssl` alerts recurring rather than patching them each release, and drop the CLI's OpenSSL build dependency. A feature-flag change, not a pre-step.
2. **Spanish "Configuración" for Settings**, in place of "Ajustes". The whole-locale review chose it and it's applied everywhere; the glossary marks it as the review's choice, the owner's to overrule.
3. **Is the web wallet in the bug bounty's scope?** [SECURITY.md](../../../SECURITY.md) scopes it to "the code of the latest tagged release" of the repository. Every tag is the CLI's, and the web wallet's releases are never tagged, but a tag holds the whole repository: since the wallet merged into `main`, the latest CLI tag also holds the wallet's code as it stood that day, which needn't be any version in the store. Read literally, the wallet code in scope moves with every CLI tag, whatever version people have installed. In (at the commit a release's handoff note names, or what's in the store) or out? Either way, SECURITY.md gets one line that says so.
