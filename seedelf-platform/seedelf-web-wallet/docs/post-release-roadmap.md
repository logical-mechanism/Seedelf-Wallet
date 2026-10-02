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

1. **[Owed](#owed)** — promises the repo has already made.
2. **[Feature parity: what's left](#feature-parity-whats-left)** — several accounts, language, NFT images. At the end of this, the wallet is feature-complete for Cardano.
3. **[Public-side completeness](#public-side-completeness)** — the governance items, reopened for the public account. **Before the UX pass** (the owner, 2026-10-02), so the pass gets a finished wallet to look at.
4. **[The data layer](#the-data-layer)** — its own track, decided in shape, and the thing the notification centre waits on.
5. **[The UX and UI pass](#the-ux-and-ui-pass)** — round three, once 2 and 3 have landed.
6. **[The documentation review](#the-documentation-review)** — last, because everything above rewrites parts of it.

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
- **The privacy notes need a human who reads the language.** A machine translation is fine for a button and not for a warning that decides whether someone understands what they're about to publish. Translate the bulk however is practical; have the privacy and warning strings read by someone fluent before they ship, and treat a missing one as untranslated (English) rather than guessed.

### P3 · NFT images

**The owner's design (2026-10-02): click to show, and the image downloads to that browser.** No image host or proxy of ours — serving image data for every asset needs serious hardware, and a proxy would be one more service that sees what a wallet holds.

- **Off until clicked**, per image, so nothing is fetched for a wallet merely opening Tokens.
- **The residual leak, stated where it's chosen:** the click tells whoever serves that image (an IPFS gateway, usually) that this IP wants that asset. That's the trade-off being accepted — user-initiated, one image at a time, instead of a page that quietly fetches everything a wallet holds.
- Deferred in chunk 14 pending "a better way to fetch them first"; this is it.

## Public-side completeness

**The owner, 2026-10-02: do this before the UX pass.** Some of what sat under *Not planned* is worth doing **for the public side**, because it's what makes this a full wallet rather than a private balance with a wallet attached. So the pass gets a finished wallet to look at, not one with governance still arriving:

- **Voting on proposals.** The wallet delegates voting power today — Always abstain, No confidence, or a DRep — but can't vote on a governance action itself. For the public account that's an ordinary Cardano wallet feature, and it has no private-side meaning: a Seedelf address has no staking part, so the private balance has no voice to cast.
- **Registering as a DRep.** The same shape: a public-account action, and the one that turns a user from someone who delegates into someone others delegate to.
- **Staking per account.** This falls out of [P1](#p1-several-accounts) for free, and is worth naming so it isn't mistaken for multi-delegation: each account has its own stake key (`2/0` under its own account index), so several accounts means stake spread across several pools. **That is exactly Lace's model after its multi→single migration** — the outcome people wanted from multi-delegation, without multi-delegation, and without touching the one-pool-per-account rule.

**What doesn't change:** a vote or a registration is a public act by a public key. None of it reaches the private side, and none of it weakens the rule that money made private has no stake key behind it.

## The data layer

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

### Still open

What it costs to run; whether it's the default with Koios as fallback or a choice; whether a user can point the wallet at their own instance; and the host-permission problem in Chrome (a new origin at install, or an optional grant when it's set).

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
- **Agent-facing.** [plans/](plans/) is, in the owner's words, "just prompts for you basically" — specs a session is handed to build something, with the decisions that were made along the way. They're written to be read once, by whoever picks the chunk up. A finished plan is a record, not a page to maintain; what a *later* session needs out of it belongs in the design docs or a handoff note, and the review is the moment to move anything that's quietly become load-bearing.

**Worth settling as part of it:** whether [plans/](plans/) should say at the top of each file which it is — a live spec or a finished record — since a stale plan read as current is the one failure mode that costs real work. The two [CLAUDE.md](../../../CLAUDE.md) files are agent-facing too, and are the one place where being out of date actively misleads.

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

**Settled on 2026-10-02:** [P1](#p1-several-accounts)'s key (account 0, one private balance), [P2](#p2-language)'s languages (English, Spanish, Japanese), [P3](#p3-nft-images)'s design (click to show), [the data layer](#the-data-layer)'s shape (a db-sync wrapper for the web wallet, clearnet, CLI stays on Koios), [public-side completeness](#public-side-completeness) going before the UX pass, a [documentation review](#the-documentation-review) after it all, dark only, one phrase, and no analytics, AML/KYC or on-ramp.

What's left:

1. **The data layer's go-ahead, and what it costs to run.** The shape is settled and the DoS answer is written; what isn't decided is whether it's the default with Koios as the fallback or an opt-in, and whether a user can point at their own instance.
2. **Which public-side item first** — proposal voting or DRep registration. Staking per account comes free with [P1](#p1-several-accounts) and needs no slot of its own.
3. **Whether the web wallet [README](../README.md)'s two forward-looking lines get a one-line correction now** or wait for the [documentation review](#the-documentation-review). They currently say several accounts and NFT images are *later, maybe* and that governance is *not planned*, which is no longer true.
