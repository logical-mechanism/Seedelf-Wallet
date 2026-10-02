# Post-release roadmap

[roadmap.md](roadmap.md) is closed. Every chunk in it is done, v1.0.0 reached the Chrome Web Store on 2026-09-28, and **1.1.0 — the transaction view — is with the store now**. This file is what comes after it.

**Why a second file.** The roadmap's job was to get a wallet built, in order, to a line where it could ship. That job is finished. From here the work is a short sequence with a set of candidates hanging off it — things already promised, the last of Cardano parity, then a pass over how all of it looks and feels. The roadmap stays the record of what *happened* and still takes the handoff notes; this one is the record of what *might*, and it's what a new chunk is chosen from.

## How this file works

- **A line becomes a chunk when the owner picks it.** It takes the next number after the roadmap's (18 onwards), a branch `web-wallet/<topic>` from `main`, a plan in [plans/](plans/), and a handoff note in [roadmap.md](roadmap.md#handoff-notes) when it lands. Tick it here and link its plan.
- **Status:** ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked · ❓ needs the owner's call
- **The rules from chunks 11–17 still hold** ([chunk 14's list](plans/chunk-14-style-flow-2.md#rules-that-still-hold)): Lace is inspiration for look and flow, never a brand to copy; **every privacy note stays** — a redesign may move or shorten one, never drop it; correctness UX is always in scope; nothing new phones home without its own decision; every feature states its Koios cost, and anything paged scales with the contract's size; a renamed control updates the e2e tests in the same commit; the name is Seedelf.
- **Releases aren't tagged, and that's not an oversight.** No `web-wallet/*` tag exists for 1.0.0 or 1.1.0: a release is recorded by its handoff note, which names the commit and the zip's SHA-256. The version is decided when enough has accumulated to be worth one — a `1.x.0` bump for features, `1.x.y` for a fix. If a tag is ever cut it **must** carry the slash, or [release.yml](../../../.github/workflows/release.yml) ships signed CLI binaries off it ([development.md](development.md#branching)).
- **Demand decides.** The web wallet's [README](../README.md) says features are added only if there's demand. A line here is a candidate, not a commitment.

## The order

**The owner's call (2026-10-02): feature parity first, the look and feel after it.** The wallet can be feature-complete bar the dApp additions, and it's a better thing to put a style pass in front of once it is.

0. ✅ **[A clean dependabot report](#step-0--a-clean-dependabot-report)** — done 2026-10-02, all 25 cleared in `Cargo.lock` and the happy-path `requirements.txt`, no source change.
1. **[Owed](#owed)** — promises the repo has already made.
2. **[Feature parity: what's left](#feature-parity-whats-left)** — several accounts, language, NFT images. At the end of this, the wallet is feature-complete for Cardano.
3. **[Public-side completeness](#public-side-completeness)** — the governance items, reopened for the public account. **Before the UX pass** (the owner, 2026-10-02), so the pass gets a finished wallet to look at.
4. **[The UX and UI pass](#the-ux-and-ui-pass)** — round three, once 2 and 3 have landed.
5. **[The documentation review](#the-documentation-review)** — closes the sequence, because everything above rewrites parts of it.

**Then [the data layer](#the-data-layer).** Parked on purpose (the owner, 2026-10-02): Koios works today, so the sequence above comes first and the data layer is thought through properly afterwards — "it will require some things that go beyond just making the wallet work as expected." The design is recorded now so the thinking isn't lost, not because it's next.

**[dApp additions](#dapp-additions)** run alongside all of it and are not counted in parity.

## Where Cardano parity stands

Measured against **Lace 2.4.2** (`_reference/lace` at `e431933`, pulled 2026-10-02), the reference since chunk 11a. For what a Cardano wallet does with one account, parity holds already; three things are left, and the rest is a deliberate no.

| Lace's surface | Seedelf Wallet | |
|---|---|---|
| Portfolio: tokens, NFTs, search, sort | Tokens, with search, sort, NFTs split out, logos from the bundled registry | matched — **bar NFT images** |
| Send, several recipients, a note | Send on both sides, up to 20 recipients, CIP-20 note on a public send | matched — and it pays **Seedelfs** as well as addresses |
| Receive, QR, your ADA Handles | All three, plus the handle-in-Seedelf warning | matched |
| Activity, detail per transaction | Activity on both sides, with CSV (after Eternl's) | matched |
| Staking: one pool, pool browser, rewards, stop | All four; Stop staking returns the 2 ₳ deposit | matched |
| Governance: DRep delegation, DRep browser | Both, from a DRep list that ships with the wallet | matched — voting on proposals and DRep registration are [reopened for the public side](#public-side-completeness) |
| dApp connector (CIP-30), authorized dApps, sign tx, sign data | All, **off until turned on**, nothing injected before that | matched — and it has **private CIP-30** too |
| dApp explorer | The dApps page; a small catalogue | matched in kind; see [dApp additions](#dapp-additions) |
| Swap center | Minswap's aggregator | matched — and swaps can run **privately**, through a one-time account |
| Collateral | Settings → Collateral, 5 ₳ reserved locally, as Lace does it | matched |
| Contacts / address book | Contacts, offering addresses and Seedelf names | matched |
| App lock, lock timeout, default open mode | All three; tab by default, side panel by choice, no popup | matched |
| Fiat value | Eight currencies or nothing, mainnet only | matched |
| Review a transaction before signing | **Transaction details** everywhere: the CBOR decoded by us, plus the raw bytes | ahead — Lace resolves and prices the transaction; what we add is **the bytes themselves**, decoded and raw |
| Several accounts, folders, account center | Account `0'` only | **doing it — [P1](#feature-parity-whats-left)** |
| Language (i18n) | English only | **doing it — [P2](#feature-parity-whats-left)**, Lace's way |
| NFT images | Logos only | **doing it — [P3](#feature-parity-whats-left)**, click to show |
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
| `rpassword` (low) | **1** | `Cargo.lock`, a direct dependency of `seedelf-cli` | **The CLI only** — its password prompt. | 7.4.0 → **7.5.0** |
| `rand` (low) | **1** | `Cargo.lock`, via `group` ← `blstrs` | **The extension's WebAssembly** — the only flagged crate that reaches what users install. | 0.8.5 → **0.8.6** |

**npm has no alerts at all:** the extension's own JavaScript dependencies are clean.

**`rustls-webpki` was not a stale lock entry**, as the triage first read it. It arrives as an *unactivated optional* dependency of `reqwest` (`reqwest` → `hyper-rustls` → `rustls` → `rustls-webpki`), and `Cargo.lock` records a package's optional dependencies whether or not a feature turns them on. `cargo tree` is feature-aware, which is why it finds no path — the code genuinely never builds, so the four alerts never reached anything. But `cargo update` **bumps** it rather than dropping it, and it cannot be dropped while `reqwest` is a dependency. It was bumped.

**What proves the bump safe ran, and passed.** `cargo test --workspace --locked`: **494 tests across 51 binaries, 0 failures** (8 ignored, the live-network ones), including the two that a dependency change must not move — `frozen_v1_vectors` (the derivation vectors in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`: a phrase still derives the same Seedelf key) and `spec_constants_are_frozen` (`constants_test.rs`'s pinned script hashes still match what's deployed). `cargo fmt --all -- --check` and `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings` are clean, the CLI release-builds and reports its version against the new `openssl`, and the WebAssembly builds and passes all 41 of its JS tests.

**The module did not grow meaningfully.** Measured A/B — the same source built from the pre-bump lock and the bumped one, `rand` being the only flagged crate that reaches `wasm32`: **2,638,180 → 2,638,557 bytes raw, +377 bytes (0.014%)**, with gzip (781 KB) and brotli (566 KB) unchanged and the timings inside the noise. The rebuild is byte-identical to the measured module, so `build.sh`'s reproducibility (launch review #61) still holds.

**Two things the re-measure turned up, neither caused by the bump:**

- **`wasm/bench.mjs` was broken** and had to be fixed to measure anything. It called `wasm.draftTransfer`, which chunk 14's several-recipients change renamed to `buildTransfer` and reshaped to take a `payments` list. It is not in CI's test glob (`wasm/tests/*.test.mjs`), which is why it rotted unnoticed. Fixed as part of this step; **the same rename is still stale in three other places** — [wasm/README.md](../wasm/README.md)'s API table, [architecture.md](architecture.md)'s builder list, and `extension/tests/fixtures/record-transfer.mjs`, which is broken in the same way. For [the documentation review](#the-documentation-review).
- **[wasm/README.md](../wasm/README.md)'s size table is stale by more than double** — it records `wasm-release` at 1,223 KB raw / 424 KB gzip, measured 2026-09-24; the module is **2,577 KB raw / 781 KB gzip** today. Chunks 15–17 (CIP-30, Lovejoin, the transaction view) grew it, not this change. Re-recording it means measuring all three of its rows, which is more than a pre-step — for [the documentation review](#the-documentation-review), and the store zip's size is worth a look at the same time.

**`compile.sh`'s `cbor2` is a separate install** from the pinned file (root [CLAUDE.md](../../../CLAUDE.md)) and was left alone — but the bump was checked against it anyway, because its one call bakes the seed into the validators and a change there would move the script hashes. `cbor2.dumps(bytes.fromhex("acabcafe")).hex()` is `44acabcafe` on 5.9.0 — the one valid CBOR encoding of those four bytes, so neither the seed nor the hashes built from it can move with a `cbor2` version. The machine's system `cbor2` is already 5.9.0.

**The pinned Python set was installed and exercised, not just edited.** A fresh venv resolves it with `pip check` clean, and on it the backend's own crypto still agrees with itself: a register verifies, a re-randomized `(g^d, u^d)` verifies under the same `x`, a Schnorr proof through `fiat_shamir_heuristic` verifies, and the datum round-trips through `cbor2`.

**The one fixed on merit rather than for a green badge:** `rpassword`'s advisory is *partial password reveal when input is interrupted*, and `rpassword` is what the CLI prompts for a wallet password with. Low severity, and precisely on-point for this project.

**Still a decision, and deliberately not taken here:** `openssl` arrives only through `reqwest`'s default `native-tls` feature. On `rustls` instead, those eight alerts stop recurring rather than being patched each release, and the CLI loses its OpenSSL build dependency. That's a feature-flag change across `seedelf-koios` and `seedelf-display` with the live Koios tests as the check — bigger than a pre-step, so it stays [an open question](#open-questions-for-the-owner). ❓

## Owed

Promises the repo has already made. These come before anything new.

| # | Item | Status |
|---|---|---|
| O1 | **1.1.0 goes live, and is recorded.** When the store publishes it, add the handoff note: the date, and anything the dashboard asked that the docs don't cover (1.0.0 turned up two such things). | 🚧 with the store |
| O2 | **The by-hand mainnet checks still open** in [plans/launch-review.md](plans/launch-review.md)'s *Still open*: `exclude_protocols` with VyFinance and MuesliSwap, one swap through each remaining route in `MAINNET_PROTOCOLS` (one is proven so far), and Stop or a refund on a swap. The owner's, since they spend real ADA. | ⬜ owner's |
| O3 | **A chain in flight is invisible to the transaction view.** Its transactions move to `seedelf.session.chain.<network>.<index>`, which `BUILT_KEYS` doesn't name, so the audit view wants that prefix scan. And **Home's banner watches the chain's last transaction**, so it shows a hash the user never saw — it may want to say "the chain" instead. Both from chunk 17's handoff note. | ⬜ |
| O4 | **A2, the contract round trip:** a Minswap V2 order paying straight to a Seedelf. Designed in [plans/chunk-15-dapp-connector.md](plans/chunk-15-dapp-connector.md); waiting on a batcher test. | ⛔ blocked |

## Feature parity: what's left

Three items. At the end of them the wallet is feature-complete for Cardano, bar [dApp additions](#dapp-additions).

### P1 · Several accounts

**This is chunk 18** — the owner's first pick after the release (2026-10-02).

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

Also to settle: discovery cost against the Koios budget, and what the dApp connector offers a site when there are several accounts (chunk 15's connect window chooses nothing by design — Lace's default-account setting was declined in the privacy review).

### P2 · Language

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
  - **Make reporting one the designed path.** Say in Settings that translations aren't checked by a native speaker and where to report an error. "Someone later says it's wrong" is then the feedback loop working, not a surprise.
  - **English stays reachable** — the picker can always go back, and the docs are English — so a user who distrusts a translated warning has somewhere to check it.

### P3 · NFT images

**The owner's design (2026-10-02): click to show, and the image downloads to that browser.** No image host or proxy of ours — serving image data for every asset needs serious hardware, and a proxy would be one more service that sees what a wallet holds.

- **Off until clicked**, per image, so nothing is fetched for a wallet merely opening Tokens.
- **The residual leak, stated where it's chosen:** the click tells whoever serves that image (an IPFS gateway, usually) that this IP wants that asset. That's the trade-off being accepted — user-initiated, one image at a time, instead of a page that quietly fetches everything a wallet holds.
- Deferred in chunk 14 pending "a better way to fetch them first"; this is it.

## Public-side completeness

**The owner, 2026-10-02: after the accounts, and before the UX pass.** Some of what sat under *Not planned* is worth doing **for the public side**, because it's what makes this a full wallet rather than a private balance with a wallet attached — and the pass should get a finished wallet to look at rather than one with governance still arriving.

**The order, with one correction.** The owner's sequence was accounts, then voting, then DRep, on the reasoning that "DRep is part of staking too since it's required". Both halves are right, about different things:

- **Vote delegation really is required for staking rewards** — Conway pays none until voting power is delegated, and the wallet already does this and says so (chunk 13). **So nothing about rewards waits on anything here.** That box is ticked.
- **But registering as a DRep is the gate on voting, not a sibling of it.** A plain delegator doesn't cast a vote on a governance action; votes come from DReps, SPOs and the constitutional committee. To vote with your own stake you register as a DRep — for yourself, if nobody else delegates to you. So voting-before-registering isn't an order, it's a dependency the wrong way round.

**Which makes them one chunk, not two:** *be your own DRep and vote.* Registration on its own is a half-feature (a credential nobody uses), and voting on its own can't be built. ⬜

| # | Item | |
|---|---|---|
| 1 | **[P1, several accounts](#p1--several-accounts)** | the owner's first pick |
| 2 | **Be your own DRep, and vote on governance actions.** Register the account's DRep credential, then vote Yes, No or Abstain on a live action. Needs a list of open governance actions, which is a new read and so a new Koios cost to state. | ⬜ |
| — | **Staking per account** needs no slot: it falls out of [P1](#p1--several-accounts) for free. Each account has its own stake key (`2/0` under its own index), so several accounts means stake spread across several pools. **That is exactly Lace's model after its multi→single migration** — the outcome people wanted from multi-delegation, without multi-delegation, and without touching one-pool-per-account. | ✅ via P1 |

**What doesn't change:** a vote or a registration is a public act by a public key. None of it reaches the private side, and none of it weakens the rule that money made private has no stake key behind it. A Seedelf address has no staking part, so the private balance has no voice to cast and never will.

## The data layer

> **Parked until the sequence above is done** (the owner, 2026-10-02). Koios works today. What's below is the shape as it stands, kept so the next look starts from it rather than from scratch — **it is not the next chunk.** The reason for the wait is the honest one: a service is not a feature. It goes beyond making the wallet work as expected, into something that has to stay up, stay paid for, and stay unexploited for as long as the wallet is in the store.

**Decided in shape (the owner, 2026-10-02): a db-sync wrapper in Rust, for the web wallet.** Not a general API — queries written for this wallet. **The CLI stays on Koios**, which already works for it, so this is one client, not two. **giveme.my needs no fork**: the owner runs it, so it can be adjusted directly if the collateral side ever wants the same treatment.

**Clearnet, and the owner is leaning yes** — because Koios is slow and its rate limit bites. **Tor is out of scope here, and that's a consequence, not a compromise:** the one client is a Chrome extension, Chrome doesn't resolve `.onion` (RFC 7686 special-use, deliberately unsupported), and the CLI — the thing Tor could have served — isn't a client. The root [README](../../../README.md#de-anonymizing-via-ip-tracking)'s Tor exploration stays a CLI and general-infrastructure aspiration. A user who routes their whole machine through Tor still reaches a clearnet endpoint over Tor, so what the wallet owes them is a **configurable endpoint** and nothing leaking around it.

### What it fixes

- **The contract scan pages, and grows.** Preprod's shared contract is already past one page of 1,000 rows, so a reading takes two requests — and that grows with the contract, for every user, forever.
- **The budget is tight and shared:** 5,000 requests a day, 40 every 10 seconds. Chunk 14's rules make every feature state its request cost because of this.
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

**Round three, after parity and the public-side work** (the owner's call). Chunks [12](plans/chunk-12-style-flow.md) and [14](plans/chunk-14-style-flow-2.md) were rounds one and two; 11a was only half-Lace. It runs the way both of those did: **the owner tests the built wallet and sends findings; each goes in a table with what was decided**, and batches land with tab and side-panel screenshots to check before the next rebuild.

The list is the owner's to write when parity lands. Carried candidates:

- **About 150 plain note paragraphs could become ⓘ hints.** Chunk 17 built `components/Hint.tsx` and moved the transaction view's six paragraphs behind icons; the owner's wider point was that "a lot of the paragraphs we have could be like that". Which ones is theirs to pick. **Privacy callouts and warnings stay where they are** — those are decisions, not explanations. ❓
- **The splash reaches its 8 s cap on mainnet.** That's Koios being slow, not the splash (chunk 17's note) — and possibly [the data layer](#the-data-layer)'s to fix rather than the splash's. Worth asking whether a first reading can show something sooner, a balance that fills in, rather than a cap that expires.
- **Everything parity adds** — the account picker, the language picker, images on Tokens — reaches the pass having never been through a findings round. So does the transaction view.

## dApp additions

**Not counted in parity, and ongoing.** The dApps page's catalogue is the one part of the wallet that grows after feature-complete: each entry is a claim that the dApp works *privately*, through a one-time account with the money coming back, so each needs its own test run before it ships. Minswap is the first, Lovejoin is in, and A2 ([O4](#owed)) is the next shape of it.

## The documentation review

**The owner, 2026-10-02: a major review once these additions land**, because everything above changes part of what the docs say. It's listed last on purpose — doing it earlier means doing it twice.

**The two audiences are different documents, and the review should treat them that way:**

- **Human-facing.** The root [README](../../../README.md), the web wallet's [README](../README.md), and the design docs ([architecture.md](architecture.md), [flows.md](flows.md), [privacy.md](privacy.md), [keys-and-accounts.md](keys-and-accounts.md), [development.md](development.md)) plus [store/](store/README.md). These are read by users, by people judging whether to trust the wallet, and by the Web Store reviewer. The forward-looking lines are the ones that rot: the web wallet README's *Later, maybe* and *Not planned* already lag every decision on this page.
- **The record.** [archive/roadmap-v1.md](archive/roadmap-v1.md) holds v1's full roadmap, compressed out of the live file on 2026-10-02. It's where the reasoning behind a one-line entry lives, and it isn't maintained — if something in it is still load-bearing, the review is when it moves into a design doc.
- **Agent-facing.** [plans/](plans/) is, in the owner's words, "just prompts for you basically" — specs a session is handed to build something, with the decisions that were made along the way. They're written to be read once, by whoever picks the chunk up. A finished plan is a record, not a page to maintain; what a *later* session needs out of it belongs in the design docs or a handoff note, and the review is the moment to move anything that's quietly become load-bearing.

**Worth settling as part of it:** whether [plans/](plans/) should say at the top of each file which it is — a live spec or a finished record — since a stale plan read as current is the one failure mode that costs real work. The two [CLAUDE.md](../../../CLAUDE.md) files are agent-facing too, and are the one place where being out of date actively misleads.

**Two concrete drifts are already waiting for it**, both found by [step 0](#step-0--a-clean-dependabot-report) and neither urgent:

- **`draftTransfer` no longer exists.** Chunk 14's several-recipients change renamed it `buildTransfer` and reshaped the request to a `payments` list, and three places still name the old one: [wasm/README.md](../wasm/README.md)'s API table, [architecture.md](architecture.md)'s builder list, and `extension/tests/fixtures/record-transfer.mjs` — which is *broken*, not merely stale, the same way `bench.mjs` was. Anything not in CI's globs can rot this way, and these did.
- **[wasm/README.md](../wasm/README.md)'s size table is out by more than double**, measured 2026-09-24 and never since.

**The privacy docs get the data layer's paragraph**, in the words [The data layer](#the-data-layer) uses: what the service learns, and that the no-log promise is a policy and an audit trail rather than a proof.

## Kept in mind

- **A notification centre** — word of an incoming payment without opening the wallet. Not this round: it needs [the data layer](#the-data-layer), and it must not change what a backend can tell about a locked wallet. ⬜
- **`web+cardano` payment links** (CIP-13), so a link can open Send with the recipient filled in. ⬜

## Not planned

Shorter than it was: the owner has reopened the governance items for the public side (see [above](#public-side-completeness)). What stays out:

- **Several pools per account.** One pool per account is the model, not a limitation — and [public-side completeness](#public-side-completeness) reaches the same outcome without it.
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

**Settled on 2026-10-02:** [P1](#p1--several-accounts)'s key (account 0, one private balance) and that it's chunk 18; [P2](#p2--language)'s languages (English, Spanish, Japanese); [P3](#p3--nft-images)'s design (click to show); [the data layer](#the-data-layer)'s shape, and that it's **parked** until the sequence is done; [public-side completeness](#public-side-completeness) going after the accounts and before the UX pass; a [documentation review](#the-documentation-review) closing the sequence; dark only; one phrase; and no analytics, AML/KYC or on-ramp. The web wallet [README](../README.md) is tidied.

What's left:

1. **Confirm the DRep correction.** The owner's order was voting then DRep; registering is the *gate* on voting, so [the two are written as one chunk](#public-side-completeness) — *be your own DRep and vote*. Worth a yes, since it changes what gets built rather than only when.
2. **Who reads the Spanish and Japanese privacy strings.** [P2](#p2--language) can be built before this is answered, but it can't ship without it — a machine-translated warning is a correctness bug, not a cosmetic one. If no fluent reader is available, shipping English-only for those strings is the honest fallback and the plan should say so.
3. **`rustls` instead of `native-tls`?** Raised in [step 0](#step-0--a-clean-dependabot-report): it would stop the eight `openssl` alerts recurring rather than patching them each release, and drop the CLI's OpenSSL build dependency. A feature-flag change, not a pre-step.
4. **Should each file in [plans/](plans/) say whether it's a live spec or a finished record?** Raised under [the documentation review](#the-documentation-review). Seventeen plans sit there now, and a stale one read as current is the failure mode that costs real work.
