# Chunk 54 · Seedelf Messaging

**Status: 🚧 54a built,** on `web-wallet/messaging-session`. Phase 1 is built: the [seedelf-messaging](../../../seedelf-messaging/) crate, merged in #401. This plan builds the rest: the session layer, the relay, the WebAssembly bindings, the worker and the screens. Each step gets its own branch, `web-wallet/messaging-<step>`, and its own PR from `main`, as chunk 38's and 53's do.

**The specification is [protocol.md](../../../seedelf-messaging/docs/protocol.md),** with the envelope in [construction.md](../../../seedelf-messaging/docs/construction.md) and the guarantees in [security.md](../../../seedelf-messaging/docs/security.md). It has had two reviews; the second's reasoning, and its adversarial tests, are in [protocol-review.md](../../../seedelf-messaging/docs/protocol-review.md). This plan doesn't repeat them: it says what to build, where, in what order, and what's still the owner's to decide. A step that changes the protocol changes protocol.md in the same PR.

**What the owner asked (2026-11-20):**
- "Like this could be a really awesome addition to the wallet. Probably the first cardano wallet to support messaging that has some nice cryptography behind it if we do it right."
- "We do want a proper product here and not just an example messaging."
- On forward secrecy: "we should be able retain Seedelf's re-randomized Register discovery mechanism and build Signal-style forward secrecy and post-compromise security on top of it or at least as close as we can get."
- On groups: "focus on 1 to 1 which the intent that groups will show up later."

**The owner's decisions so far,** all 2026-11-20 and recorded in protocol.md §0 and §13:
- ECIES on registers, not the pairing design.
- The Seedelf's own key.
- The first sender makes both conversation identities.
- "do the longterm key only for now": no prekeys.
- A 36-hour expiry ("waaay shorter, I was think like 36 hours"), kept although a reader must unlock within it ("We are going to keep the 36 hours for now").
- Proof of work against spam. IP addresses seen, as the data layer already sees them.
- "if you delete the wallet and the data associated to it on the browser then yeah you lost those conversations".
- A Seedelf is a handle, "message me at SEEDELF". A proof of one is a maybe until users ask.
- Groups and post-quantum later.

**The marks:**
- **[code]:** read in this repository.
- **[choice]:** a call this plan makes, which the owner can overturn.
- **[measure]:** a figure only a prototype gives.
- **[assumed]:** nothing here proves it.

## What's already there

- **The crate** [code]: the v1 envelope, `matches_envelope`, 50 tests, vectors an independent implementation reproduced, and CI's clippy. Scanning in WebAssembly measured 1.02 ms an envelope ([README](../../../seedelf-messaging/README.md#measured-performance)).
- **The key** [code]. x comes from `seedelf_key_v1_from_entropy`, account 0, so **the same x on every network** ([derivation.rs](../../../seedelf-crypto/src/derivation.rs)).
  - It lives only inside WebAssembly as `SeedelfKey.sk`, a blstrs `Scalar`, which is what `SecretKey::from_scalar` takes ([wasm/src/lib.rs](../../wasm/src/lib.rs)).
  - It exists only while the wallet is unlocked. Auto-lock defaults to 15 minutes, and a lock frees it ([wallet.ts](../../extension/src/background/wallet.ts)).
- **Encrypted records** [code]. `PrivateStore` seals each record under a store key that exists only while unlocked, padded to 1 KiB or the next power of two, under `seedelf.private.<name>` ([private-store.ts](../../extension/src/background/private-store.ts)).
  - Every name must be listed in `PRIVATE_RECORDS`.
  - `Wallet.reset()` deletes them.
  - The manifest has no `unlimitedStorage`.
- **Writing.** One writer per service, through a promise queue (contacts, activity, accounts, pending). `Wallet.serial` isn't re-entrant [code].
- **Scanning.** `ownedUtxos` tests 200 rows a turn, with `wait(0)` between turns, at about 0.73 ms a row ([contract-scan.ts](../../extension/src/background/contract-scan.ts), [wasm/README.md](../../wasm/README.md)) [code]. The Lovejoin pool already uses one batched WebAssembly call, `lovejoinOwned`, a pattern to copy.
- **Screens and the worker** [code]:
  - Requests go through `Requests` and `REQUEST_LIST` in [rpc.ts](../../extension/src/shared/rpc.ts), routed in [handlers.ts](../../extension/src/background/handlers.ts).
  - Screens switch on state, with no router (App.tsx, Home.tsx).
  - Every string goes in en, es and ja.
- **The data layer** [code]: axum, mainnet only, with no storage of its own besides `StateDirectory`, on a 2-vCPU, 4 GB droplet.
  - **The rate limiter** ([edge.rs](../../../../seedelf-data/api/src/edge.rs)) gives each IP a bucket of 300 units, refilled at 10 a second. An answer costs a unit more for every 16 KB.
  - **Caddy** refuses request bodies over 64 KiB, with no CORS on its 413 ([Caddyfile](../../../../seedelf-data/deploy/edge/Caddyfile)).
  - **Deploys** go through `data-layer-deploy.yml` only, with the owner's approval.
  - It can't depend on this workspace, so it keeps its own copies held to shared vectors, as Lovejoin's templates are.
- **The extension reaches the data layer** through CORS and CSP `connect-src`, never a host permission. `manifest.test.ts` asserts that [code].
- **The e2e fakes** [code]:
  - `fakeDataLayer` routes `https://data.seedelf.test/**` ([e2e/data-layer.ts](../../extension/e2e/data-layer.ts)).
  - `support.ts` holds the Koios, giveme.my, Minswap and gateway fakes.
  - `byWorker` fails a test if a page, not the worker, called a service.

## Constraints the plan follows

- **Envelopes of at most 32 KiB,** under Caddy's 64 KiB: protocol.md §9's sizes, 512 B to 32 KiB. Text messages fit many times over; attachments aren't in this chunk.
- **A fresh sync is paged** [choice]. 36 hours at 10,000 envelopes a day is about 7.5 MB, which one answer would spend 470 units on, more than a bucket holds. Pages of at most 256 KB, so 16 units each, behind a cursor.
- **A pool per network** [choice]. x is the same on every network, so a shared pool would show a preprod message to the mainnet wallet. Pools are told apart by the path.
- **Every messaging state change goes through one queue in the worker** (protocol.md §4.2's state machine), never inside `Wallet.serial`.
- **Scanning happens only while unlocked.** When locked there's no x and no scan. That's the 36-hour decision, said in the wallet.
- **Nothing new reaches a server until the user turns Messages on** (call 9). Turning it on is the decision the plans README asks for, and it goes with a dated entry under the privacy policy's *Changes* in the step that first contacts the relay.

## Steps

### 54a 🚧 The session layer, in seedelf-messaging

Everything in protocol.md §3 to §6, as plain Rust with no network and no storage:

- **First contact:**
  - the first-contact block F, with R_A on R_B's base;
  - SK with the static DH;
  - `RatchetInitAlice` and `RatchetInitBob`;
  - Bob's checks: t's window and every point (protocol.md §3).
- **Requests:** initiation material kept bounded, and the state built from F on reply (§3.1).
- **The Double Ratchet:** §4.1's KDF_RK, KDF_CK, ENCRYPT with its salt, and MAX_SKIP with skipped keys' 48-hour lifetime.
- **The inner messages** `0x01` and `0x02`, the padding (§9's buckets), and the outer envelope through `encrypt_message`.
- **A session state type with versioned serialization,** for the wallet's records. The secrets in it are wiped on drop, as `SecretKey`'s are.
- **Decrypting on a copy,** committed only on authentication, with no more than MAX_SKIP keys derived for one message (§4.1, §4.2).
- **The rules of §5 and §6** as functions over that state:
  - a known cid's F;
  - tombstones until t + 48 hours;
  - "missing";
  - continuations only for matching identities.
- **Proof of work:** solving and verifying, over the envelope's bytes (call 6), with vectors the relay is held to.

**Tests:**
- Vectors for each new layer, reproduced by an independent implementation (noble-curves and WebCrypto, as Phase 1's were).
- The adversarial cases in protocol-review.md §E, each one a test.
- Property tests: out-of-order delivery, loss, duplicates, replays, both sides writing first, a reset with `replaces`, a skipped key past 48 hours.
- A two-wallet simulation over an in-memory relay with the 36-hour expiry.

**Done means:** every rule in protocol.md §3 to §6 has a test that fails without it, and the vectors are reproduced.

**Where it stands** (2026-11-20, `web-wallet/messaging-session`, not yet a PR):
- **Built:** everything above but proof of work, which this step's brief left out: it waits on call 6. protocol.md §16 fixes every byte and rule the build decided, each choice marked [choice] for the owner to overturn.
- **The vectors** (tests/vectors/messaging_session_v1.json, three conversations) were reproduced by a script written from protocol.md §16 alone, without reading the Rust: noble-curves 2.0.1 and WebCrypto, every value. Its notes on where the spec was silent are folded into §16.
- **The rules hold the tests:** a mutation pass removed or weakened each of 39 rules in turn, and a test failed every time. Its first run found four survivors, which became a fix (a request's joining message now reads as eager processing would) and two continuation tests.
- **For 54e and 54f:** a first message is refused once its t is 48 hours old, so a conversation nobody read in its first 48 hours can never begin, however many first messages follow (protocol.md §16.4). The wallet needs "start again", or must start again by itself.

### 54b ⬜ The model

- §3 to §6 in ProVerif or Tamarin [choice: ProVerif]. The queries:
  - secrecy of message keys;
  - §1.1's forward secrecy after the first reply;
  - recovery after a compromise;
  - agreement on cid, R_A and R_B, so no unknown-key share;
  - the static DH's hold on R_A.

  It checks the first-contact replay rules too.
- Runs alongside 54c to 54e. It gates mainnet, not the code.

**Done means:** the model's queries hold, and a fresh-context reviewer has read the model against protocol.md.

### 54c ⬜ The relay

Where it runs is call 1, and its storage call 2. The routes, as the recommendation puts them:

- **`POST /messaging/v1/{network}/envelopes`:** an envelope and its proof of work.
  - The relay checks the version, the length (at most 32 KiB plus overhead) and the proof of work.
  - It checks the points through a copy of `decode_point`, held to the crate's vectors as the data layer holds its Lovejoin copy (call 3).
  - It drops an envelope whose bytes it already holds.
- **`GET /messaging/v1/{network}/envelopes?after=<cursor>`:** at most 256 KB of envelopes after the cursor, and the next cursor.
- **Expiry:** a sweep deletes envelopes older than 36 hours.
- **Limits:**
  - each route gets its own weight in `edge.rs`;
  - a cap on stored bytes per network;
  - a cap on posts per IP;
  - the monthly egress ceiling counts this traffic too.
- **Privacy:** no access log (Caddy has none), no recipient, no account. Health and the existing routes are unaffected.
- **Deploying:** through `data-layer-deploy.yml`, approved by the owner, and never by hand.

**Done means:** offline tests for every refusal, the expiry, paging and duplicates, a load test on the droplet's size [measure], and the vectors.

### 54d ⬜ WebAssembly

- `seedelf-wasm` takes `seedelf-messaging` as a dependency.
- **Exports, JSON in and out as the others:**
  - `messagingScan(key, envelopes)` tests a batch and answers the indexes that match, like `lovejoinOwned`;
  - opening an envelope;
  - starting a conversation;
  - sending and receiving in one, with state in and state out;
  - solving proof of work.
- Each export is in the README's table (`readme_test.rs` checks it), with native tests and `node --test` tests.
- `scale.mjs` measures a 15,000-envelope scan in the module [measure].

**Done means:** the module's size change is recorded, and the scan's figure is in protocol.md §8.

### 54e ⬜ The worker

- **A messaging service with one queue for every state change** (protocol.md §4.2). The sequence: write the state and outbox, then post the stored bytes, then mark them posted; after a restart, re-post them. Receiving decrypts on a copy, then writes, then advances the cursor.
- **Records in `PrivateStore`,** per network:
  - an index of conversations;
  - a record per conversation, holding its ratchet state and outbox together, so one write is atomic;
  - the requests, bounded as §3.1 says;
  - the tombstones;
  - the cursor. `PRIVATE_RECORDS` takes a listed family for the per-conversation names [choice]. Each record is padded as the store pads.
- **Syncing while unlocked:**
  - paged GETs;
  - 200 envelopes a turn with `wait(0)`, the cursor saved after each page, so a stopped worker loses nothing;
  - on unlock, then every minute while unlocked, through the existing alarm pattern;
  - nothing while locked.
- **Sending:**
  - the handle looked up as Send's pay-by-name does;
  - proof of work solved without blocking the worker [measure];
  - the post retried with the same bytes.
- **The relay's origin.** It goes in the CSP's `connect-src`. Preprod gets one only if call 4 gives it a pool. `manifest.test.ts` is updated.
- **The request cost,** stated in architecture.md: one GET per page while unlocked, one POST per message, and a fresh sync's pages.
- **Deleting the wallet** deletes everything messaging stored; it's in `PRIVATE_RECORDS`.

**Done means:** unit tests with a fake relay, a worker stopped mid-scan and mid-send, the quota checked [measure], and `byWorker` holding for every relay call.

### 54f ⬜ The screens

- **Messages,** where call 7 puts it:
  - a list of conversations, and a list of requests from strangers (call 8);
  - a thread;
  - "New message" to ⟨Seedelf⟩.
- **Turning it on** (call 9): one switch, with what it sends and to whom in a line. Off by default.
- **The labels of protocol.md §7's table,** in its words:
  - ⟨handle⟩;
  - unknown sender;
  - says they're ⟨handle⟩ (unverified);
  - continues, or says it continues (unverified);
  - `to`.
- **The states of protocol.md §6 and §10:**
  - "sent, expires at …", never "delivered";
  - "N messages missing", never "expired";
  - a conversation this browser no longer has;
  - a conversation that can't continue, with "start again".
- **The unlock line:** messages arrive while the wallet is unlocked, and the relay keeps them 36 hours.
- **Payments:** nothing in a message starts a payment. A payment request, if one is ever added, opens Send filled in.
- **Strings** in en, es and ja; flows.md; privacy.md's *Known links*; and the dated *Changes* entry in [privacy-policy.md](../store/privacy-policy.md).
- **e2e:** a `fakeRelay` beside `fakeDataLayer`, two wallets messaging through it, a stranger's request, expiry, a reset with `replaces`, and the switch off sending nothing. Run under load and on the store build, as the e2e stress rule asks.

**Done means:** unit and e2e tests pass, under load and on the store build, and the screens are checked by eye.

### 54g ⬜ The gate

- A release's gate review of 54a to 54f.
- A live run on preprod between two wallets, if call 4 gives preprod a pool.
- The relay deployed on mainnet (the owner).
- `npm run tokens`, `npm run dreps`, store images, the release.

## Not in this chunk

- Groups (Sender Keys), prekeys, post-quantum, proving a handle, delivery receipts, multi-device, attachments.
- Messages in the CLI.
- Any change to a contract, the derivation, Lovejoin or the existing data-layer routes.

## What doesn't change

- Every Seedelf flow and every on-chain contract.
- The data layer's existing routes and health.
- What the wallet sends anywhere while Messages is off.

## The owner's calls

Each has a recommendation, which the owner can overturn.

1. ❓ **Where the relay runs.**
   - **Recommended: new routes in seedelf-data-api,** a module of its own on the same droplet, behind the same Caddy and limiter, deployed by the same workflow, with no new origin for the wallet to trust.
   - The alternative is its own binary and origin: isolated from the data layer's health and deploys, with a pipeline of its own to run.
2. ❓ **The relay's storage.**
   - **Recommended: in memory, snapshotted to `StateDirectory` every minute and on shutdown,** so a deploy or restart keeps the pool. 36 hours at 10,000 envelopes a day is about 7.5 MB.
   - The alternatives are memory alone (a deploy drops what's waiting) or SQLite.
3. ❓ **Whether the relay checks points.**
   - **Recommended: yes,** with a copy of `decode_point` held to the crate's vectors, so garbage never reaches readers.
   - The alternative is the version, the length and the proof of work alone: cheaper, and readers refuse garbage anyway.
4. ❓ **Preprod.**
   - **Recommended: a preprod pool on the same relay,** told apart by the path, with lower caps, so 54g can run live between two preprod wallets.
   - It's the data layer's first preprod route, but it reads no chain, so it touches nothing of preprod's.
   - The alternative is mainnet only, with preprod tested against the e2e fake and a local relay.
5. ❓ **The largest message.**
   - **Recommended: 32 KiB envelopes,** under Caddy's 64 KiB.
   - The alternative is raising Caddy's limit for this route alone.
6. ❓ **Proof of work.**
   - **Recommended: hashcash over SHA-256 of the envelope.** It costs the relay a microsecond to check. The difficulty is set so solving takes about a second in WebAssembly [measure], and the relay can raise it.
   - A memory-hard function resists GPUs better, but checking it would cost the 2-vCPU relay milliseconds a post. That's a lever for later.
7. ❓ **Where Messages lives.**
   - **Recommended: a row on Home,** like the dApps row, with its unread count, opening the Messages screen. It's the wallet's own, not a dApp.
   - The alternative is a dApp tile.
8. ❓ **Strangers' first messages on screen.** protocol.md §3.1 bounds what's kept; this is how it's shown.
   - **Recommended: a Requests list,** apart from conversations, until the user replies or deletes. Nothing tells the sender either way.
9. ❓ **Messages on or off by default.**
   - **Recommended: off,** with one switch on the Messages screen. Syncing tells the relay when the wallet is online, which is the private-by-default rule's case for off.
   - Messages works whether or not Koios-only is on, since there's no Koios version of it.
10. ❓ **How long history is kept.**
    - **Recommended: until the user deletes it, within a budget of about 5 MB of the extension's storage.** The oldest messages go first past it, and the thread says so.
    - The alternative is a fixed age, such as 30 days.
11. ❓ **Notifications.**
    - **Recommended: the unread count on the Messages row only,** and no badge or system notification in this chunk. The notification centre was declined on 2026-10-11.

## Unknowns

- The scan in the extension's own worker, as against Node's, at 15,000 envelopes (54d) [measure].
- Proof of work's difficulty for about a second in WebAssembly (54a) [measure].
- The relay's egress at real use against the droplet's monthly ceiling: each wallet downloads every envelope [measure].
- The storage quota with history and skipped keys (54e) [measure].
- Whether a 15-minute auto-lock leaves enough unlocked time to sync a 36-hour pool [assumed: yes, about 15 s of scanning].
