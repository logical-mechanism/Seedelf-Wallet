# Chunk 54 · Seedelf Messaging

**Status: ✅ 54a merged** (#403). **✅ 54c merged** (#406) and deployed. **✅ Calls 12 and 13 merged** (54a′, #407). **✅ 54d merged** (#408, the WebAssembly bindings). **✅ 54e merged** (#409, the worker). **🚧 54f built** (the screens), on `web-wallet/messaging-screens`. 54b's proofs run separately (#405). Phase 1 is built: the [seedelf-messaging](../../../seedelf-messaging/) crate, merged in #401. This plan builds the rest: the session layer, the relay, the WebAssembly bindings, the worker and the screens. Each step gets its own branch, `web-wallet/messaging-<step>`, and its own PR from `main`, as chunk 38's and 53's do.

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
- One relay, the wallet's only one, pricing each address's posts by its recent traffic, said plainly: "we dont know what is being sent nor to who but we do rate limit via ip because of dos attacks basically. I mean its real." That settles call 6.
- The relay on the data layer's droplet, with buckets and a traffic ceiling of its own (2026-11-21): "Lets build on that same droplet and as the wallet expands we expand that server as well, or add more or something. Initially there should not be that many users anyway using this feature." That settles calls 1 and 2.
- Groups and post-quantum later.
- Messages on and off with a switch for each network, off by default, the worker reading each network whose switch is on whichever the wallet shows; history kept within about 5 MB, the oldest going first; and calls 3, 4 and 5 as 54c built them (2026-11-21). That settles calls 3, 4, 5, 9 and 10.
- The screens "aligned with telegram or the signal desktop app": the conversations on the left, the one clicked on the right, its messages with their times and the box to write in at the foot. Two ways in, to the same page: "a round icon button to the left of the settings button at the top of the wallet", and "a row button at the bottom near dapps, activity, and utxos" (2026-11-21). That settles call 7.

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

### 54a ✅ The session layer, in seedelf-messaging

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
- **Built:** everything above but proof of work, which this step's brief left out. Call 6 has since been settled (priced by traffic), so solving and checking it, with vectors, can be built before 54c needs them. protocol.md §16 fixes every byte and rule the build decided, each choice marked [choice] for the owner to overturn.
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

### 54c ✅ The relay

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
  - posts priced per address (protocol.md §10, call 6): a light base rising with the address's recent posts, IPv6 counted by prefix (a /64 at least), a global floor that rises under load, and a ceiling past which a post is refused; a refusal names the price;
  - the monthly egress ceiling counts this traffic too.
- **Privacy:** no access log (Caddy has none), no recipient, no account. The per-address counts live in memory for their window only and are never logged. Health and the existing routes are unaffected.
- **What the wallet and the privacy policy say:** the relay can't read messages or tell whom they're for. It sees the IP address that posts each envelope and when, and counts each address's recent posts, in memory, to stop floods.
- **Deploying:** through `data-layer-deploy.yml`, approved by the owner, and never by hand.

**Done means:** offline tests for every refusal, the expiry, paging and duplicates, the price (a burst from one address, from one IPv6 /64, and from many addresses at once), a load test on the droplet's size [measure], and the vectors.

**Where it stands** (2026-11-21, `web-wallet/messaging-relay`):
- **Built:** seedelf-messaging's `relay` module (what a post must be, the stamp, and vectors), and the relay in seedelf-data's `api/src/messaging/`: the two routes, a pool per network, the price, the 36-hour expiry, pages behind a cursor, duplicates, saving across a restart, and the edge's share. protocol.md §17 fixes every byte, each choice marked [choice]; the data layer's README is the operators' reference.
- **The talk before it** (the owner, 2026-11-21): one droplet holds both. Every reader downloads every envelope, so the relay's traffic grows with the square of its users: at 20 messages a user a day, about 600 GB a month at 1,000 daily users and the droplet's 4 TB at about 2,500, where a fresh sync's scan also reaches a minute or more. A second server wouldn't move that wall; only a change to the protocol would. So the server grows with the wallet.
- **Two additions from that talk,** in the edge: messaging has buckets of its own, so catching up on messages never makes the wallet's other reads wait, and a traffic ceiling of its own inside the API's (`DATA_MESSAGING_GB_MONTH`), so a flood of messages spends messaging's allowance and never the rest's. The data layer falls back to Koios; messaging has nothing to fall back to, and needs nothing.
- **Measured:** a SHA-256 attempt costs about 425 ns in WebAssembly (Node 24), so mainnet's base of 18 bits is about 0.1 s in a browser and its ceiling of 24 about 7 s. On two cores, with the load test's clients on the same two, the relay keeps 6,400 posts a second (p50 7.7 ms) and serves fresh syncs at 2.1 GB/s: traffic, not the relay, is the droplet's limit.
- **What changed from the plan,** all in protocol.md §17:
  - **Pages are binary,** not JSON: base64 would add a third to the traffic that's the droplet's limit. Each page also carries the reader's current price for each size, so a wallet usually solves at the right price first, and a gap flag for a cursor whose envelopes expired or were lost.
  - **Exactly the four sizes,** not "at most 32 KiB": every session envelope is one of them (§16.1), and anything else is refused.
  - **The stamp binds the pool's name,** so work for preprod's lower price can't be posted to mainnet.
  - **The size counts in the price:** a 32 KiB envelope counts as 64 short ones.
  - **Already held comes before the price,** so a re-post after a restart is accepted at any price; **the points come after it,** so a sender pays before the relay's costly check.
  - **Cursors number from the time a pool was loaded,** in microseconds, so a pool that lost what it held still numbers above every cursor it gave out. A clean shutdown leaves a mark beside the pool's file; without it, every earlier cursor is told of a gap.
  - **The data layer takes blstrs and sha2** for its copy of the checks, at the wallet's own versions (blst 0.3.15), and `/health` says the relay's state without changing its status.
- **Not done here:** the deploy (54g, the owner); setting `DATA_MESSAGING_GB_MONTH` on the droplet before the next data-layer deploy, since every deploy from `main` now carries the relay; the privacy policy's entry, which goes with the step that first contacts the relay (54e, 54f).

### 54a′ ✅ Calls 12 and 13, before 54d

The owner accepted both on 2026-11-21, to be built before 54d. Built in seedelf-messaging's `session` module, protocol.md changed to match (§0, §2, §3, §5 to §9, §13, §16), and the reasoning in protocol-review.md §G.

- **Call 13, the base proof.** F carries a Schnorr proof that p₀ = [b]g for the handle named in `to`, with F's other fields in its challenge: 64 bytes. `to` is required, except in a continuation, which must then be verified.
- **What building it found:** the proof alone didn't close the link. Each envelope went to a random re-randomization of its conversation identity, so a writer could aim an honest message's envelope at the sum of two Seedelfs' registers, or at a second Seedelf's, and a reply would still link them.
  - **So every envelope is now bound:** its re-randomization is the outer scalar, derived from the message key and the ratchet's salt, and the reader checks the envelope's base is [o]p₀ once the message decrypts. No bytes, one multiplication a message.
- **Call 12, the stamp.** An 8-byte nonce after F, whose work over F's digest must show 24 bits [choice], about 7 s of WebAssembly. The reader checks it first, before the proof and before any key.
  - It sits after F, not in it, so a start's state exists before its work is done. The worker can solve it in slices with nothing secret held outside a record.
- **The reader passes its handles:** each of its Seedelfs by name, with every register the wallet knows it has held. A Seedelf's datum can change while a message is on its way.
- **Sizes:** a first message to a Seedelf (a 32-byte name) is never 512 bytes now. It's at least 2 KiB, which the relay sees as it sees a reply of 246 to 1,781 bytes (protocol.md §9).
- **Tests:** src/session/tests/linking.rs attacks both ways and checks the stamp's order. A mutation pass weakened each of the 21 new rules in turn, and a test failed every time, once a test for a stored request replayed after a restart was added. §E's cases 1, 2, 11 and 13 expect the new refusals and sizes. The vectors were re-recorded: three stamps at 24 bits, the first nonce from 0.
- **For 54b:** the model's F leaves out `to` already. The proof, the stamp and the envelope's binding are about unlinkability and spam, which none of its lemmas claims, so tonight's proofs stand as they are.
- **For 54d:** starting a conversation and setting its stamp are separate exports, the stamp solved in slices as the relay's is, and receiving takes the reader's handles.

### 54d ✅ WebAssembly

- `seedelf-wasm` takes `seedelf-messaging` as a dependency.
- **Exports, JSON in and out as the others:**
  - `messagingScan(key, envelopes)` tests a batch and answers the indexes that match, like `lovejoinOwned`;
  - opening an envelope;
  - starting a conversation, then its first-contact stamp, solved in slices and set (54a′);
  - sending and receiving in one, with state in and state out; receiving takes the reader's handles, every register each of its Seedelfs has held (54a′);
  - solving proof of work at the price the relay names.
- Each export is in the README's table (`readme_test.rs` checks it), with native tests and `node --test` tests.
- `scale.mjs` measures a 15,000-envelope scan in the module [measure].

**Done means:** the module's size change is recorded, and the scan's figure is in protocol.md §8.

**Where it stands** (2026-11-21, merged in #408):
- **The owner's calls** (2026-11-21), each as recommended:
  - records in, records out: no state outlives a call;
  - receiving is two calls, `messagingOpen` to name the records, then `messagingReceive` with only those;
  - hex inside JSON throughout, a message's text included;
  - every export 54e needs, not only the plan's list.
- **Built:** `seedelf-wasm` takes `seedelf-messaging`, and 17 exports wrap it ([wasm/src/messaging.rs](../../wasm/src/messaging.rs), [the README's table](../../wasm/README.md#api)).
  - Beyond the plan's list: accepting a request, reading one's texts, deleting, expiring, a no-secrets summary of a conversation and of the requests, and the constants the worker works by.
  - A refusal is an answer, `{ "refused": "<code>" }`, the crate's error in snake case; only a request that doesn't read throws. The worker branches on codes, never words.
  - Answers and requests that carry a conversation's record or a text go through buffers WebAssembly wipes.
- **One addition to the crate:** `Request::arrivals`, so a request's texts show when they came after a reload.
- **Overflow checks stay off in seedelf-messaging** [choice]. Its input is a stranger's envelope, read again at every sync, so a trap there would lock the wallet at every unlock for 36 hours. An audit found no integer from an envelope reaching arithmetic that can wrap. The reasons are in the workspace Cargo.toml.
- **Tests:**
  - `messaging_test.rs` (6 tests) and `messaging.test.mjs` (4): the session vectors' first messages opened and received at the full 24 bits, read back and accepted; both vector files' stamps found in slices, and a post's bytes;
  - two wallets writing to each other through the records alone, with a continuation, a deletion and its tombstone's expiry, and each refusal as its code.
  - a mutation pass weakened each of 31 lines of the binding in turn, and a test failed every time.
- **Measured** (the i5-12400F, 2026-11-21):
  - the module grew 155 KB raw, 52 KB gzipped and 36 KB brotli, to 3,831, 1,114 and 797 KB;
  - the scan took 0.97 ms an envelope in Node and 1.09 ms in a Chrome 157 worker: 14.6 and 16.3 s for 15,000 (protocol.md §8);
  - the stamps are under Unknowns.
- **For 54e:**
  - a request's `continues` survives only in `messagingAccept`'s answer, since the conversation's record doesn't keep it: the worker stores the label with the conversation;
  - `messagingReceive` takes the named conversation's record and the one its `replaces` names; a cid held both as a request and as a conversation throws;
  - `firstContactBits` is for tests and tuning, never the wallet;
  - `messagingSetStamp` reports the nonce's work and doesn't refuse less: solve at `messagingConstants().firstContactStampBits`;
  - expiring is one call per conversation's record.

### 54e ✅ The worker

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
  - proof of work solved at the relay's price, without blocking the worker [measure]; a post refused for too little work is solved again for the same bytes;
  - the post retried with the same bytes.
- **The relay's origin.** It goes in the CSP's `connect-src`. Preprod gets one only if call 4 gives it a pool. `manifest.test.ts` is updated.
- **The request cost,** stated in architecture.md: one GET per page while unlocked, one POST per message, and a fresh sync's pages.
- **Deleting the wallet** deletes everything messaging stored; it's in `PRIVATE_RECORDS`.

**Done means:** unit tests with a fake relay, a worker stopped mid-scan and mid-send, the quota checked [measure], and `byWorker` holding for every relay call.

**Where it stands** (2026-11-21, `web-wallet/messaging-worker`):
- **Built:** `background/messaging.ts`, the service with its one queue, and `background/relay.ts`, the relay's client (protocol.md §17's pages and posts), wired in `sw.ts` with an alarm of their own, `seedelf.messaging`. The architecture's [Seedelf Messaging](../architecture.md#seedelf-messaging) says how it works; protocol.md §18 fixes what a message's plaintext holds.
- **The owner's calls** (2026-11-21), each as recommended: call 9, a switch per network, off by default, read for each network whose switch is on whichever the wallet shows; call 10, a 5 MB budget, oldest first; calls 3, 4 and 5 as 54c built them, so preprod's pool is on the same relay, and a preprod-only build's `connect-src` lists it.
- **My calls,** flagged for overturn:
  - **The plaintext's kind byte** [choice, protocol.md §18]: `0x01` then UTF-8 text, so a later kind (a payment request) needs no format break.
  - **Records:** the inbox, `messaging.<network>`, and one record a conversation, `conversation.<network>.<cid>`, a family Remove wallet finds by its prefix: `Area` takes `keys(prefix)`, Chrome's `getKeys` where there is one.
  - **The order of writes** replaces a transaction: a conversation's record before the inbox that lists it, and after the inbox that stops listing it. A network's first sync of each unlock deletes a record nothing lists, and brings the inbox's view of each conversation back to its record.
  - **Handles:** every register the wallet's Seedelfs are seen holding, from the contract view the wallet keeps, at each sync with no request; the contract read fresh, once a sync, only when a stranger's first message is refused for its handle, and a read that fails holds the cursor.
  - **A conversation's states the screens get:** `unanswered` (written first, no reply past the 48 hours, so `messaging-restart` starts it again to the same Seedelf), `unreachable` (messages too far ahead, so `messaging-continue` continues it with its identities), conversations this browser no longer has (`lost`), and the relay's gap (`gapAt`).
  - **The switch changes through `messaging-switch` alone,** which starts and stops the alarm; `preferences-set` ignores it.
  - **The privacy policy's entry goes with 54f,** whose switch is the first thing that can turn Messages on: nothing in 54e reaches the relay without it.
- **Tests:** `tests/messaging.test.ts`, two wallets through an in-memory relay (`tests/fake-relay.ts`, written from §17 with noble's SHA-256), the records alone between their calls, and `tests/relay.test.ts`, the client's pages and answers.
  - **Writing the tests** found a conversation that had had replies marked unanswered after 48 hours, and a pending message a lock between two writes left uncounted (now repaired at each unlock's first sync), both fixed.
  - **A fresh-context review** (one agent, the code and protocol.md, not this plan) found no message key used twice and no deadlock, and nine things, all fixed with a test each: the budget stopped for good once an older conversation was empty, and counted UTF-16, not UTF-8; a stranger's first message to a Seedelf the kept view was too old to have was refused for good, as was one met after a failed read; the relay was still asked after the switch went off, mid-catch-up or mid-post, and once after a lock; a trap under a sync nothing waited for didn't lock the wallet; one record that wouldn't open blocked a network's messages, and couldn't be deleted; two switches at once could undo each other; the cursor's write wasn't pinned to the phrase. And from its smaller notes: a page whose body didn't arrive escaped as the wrong error, a relay that said more followed without moving would loop, and a conversation deleted mid-post was still posted.
  - **A mutation pass** (a scratchpad script, not in the PR) weakened each of 51 rules in turn, and a test failed for 49. The two left are second guards behind the check right before every request (the switch on, the wallet unlocked), which holds alone: removing either still sends the relay nothing, and only costs local work, so they stay. Its runs turned eight survivors into tests: the contract read when no view is kept, the alarm stopped at a lock, a post's switch turned off mid-solve, a trap outside the wallet's queue, a conversation deleted mid-post, the cursor's phrase, and two from the fixes above.
- **Not done here:** `byWorker` for every relay call, which needs the screens (54f's e2e); the quota and the scan in the extension's own worker [measure].

### 54f 🚧 The screens

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
- **Strings** in en, es and ja; flows.md; privacy.md's *Known links*; and the dated *Changes* entry in [privacy-policy.md](../store/privacy-policy.md), with 54c's line on what the relay sees and counts.
- **e2e:** a `fakeRelay` beside `fakeDataLayer`, two wallets messaging through it, a stranger's request, expiry, a reset with `replaces`, and the switch off sending nothing. Run under load and on the store build, as the e2e stress rule asks.

**Done means:** unit and e2e tests pass, under load and on the store build, and the screens are checked by eye.

**Where it stands** (2026-11-21, `web-wallet/messaging-screens`):
- **Built:** `ui/screens/Messages.tsx` and `ui/messaging.ts`, reached from the top bar's round button (left of Settings) and Home's row (under dApps, on both tabs), each with what's unread (call 11). [flows.md](../flows.md#messages-seedelf-messaging) has the flow, [privacy.md](../privacy.md#seedelf-messaging) what each service learns, and the privacy policy its dated entry (21 November 2026).
  - **The layout:** the list and a conversation side by side in a window at least 760 px wide, the wallet's column widened to 1,100 px for it; narrower, as the side panel is, the list first and a conversation in its place, with Back. The page stops scrolling, and the list and the messages scroll in it, so the box to write in stays at the foot.
  - **The labels and states** are §7's, §6's and §10's: the Seedelf written to, or "Unknown sender" and "Wrote to your ⟨Seedelf⟩"; "Continues", or "Says it continues … (unverified)"; "sent, expires …", never "delivered"; "N messages missing", never "expired"; a gap's and an unreachable server's warnings; conversations this browser no longer has, as a count; **Start again** for one unanswered past 48 hours (`messaging-restart`) or one that can't continue (`messaging-continue`).
  - **Requests** (call 8, as recommended): a list of their own over the conversations, read-only with **Accept**, and a reply accepts one as it's sent.
- **Added to the worker:** each conversation's last message, its first 120 characters, kept in the inbox for the list (`last`); the user's own name for it (`name`, `messaging-name`); `offline` in the overview while the relay doesn't answer a read; `messaging-changed` when reading a thread or a request leaves less unread; and `messaging-sync`, which the screen sends every 10 seconds while it's seen and the switch is on, so a reply shows up while a conversation is open. The architecture's request cost says so.
- **My calls,** flagged for overturn:
  - **10 seconds while a page of the wallet is on screen** [choice]: the alarm's minute is slow to talk in, and was slow to count a message on Home (the owner, 2026-11-21: "you can get a message and just not know it until you physically click that button"; it took 51 s on Home, measured). It costs the relay a page every 10 seconds per page on screen, and tells it when the wallet is open (the policy says so).
  - **A name of the user's own for a conversation** (the owner, 2026-11-21: "allow bob to edit the unknown sender label"): on the device only, never sent (`messaging-name`). It stands over §7's label, which the header still says under it, and goes on into a conversation started again, or a verified continuation.
  - **Revealing one's Seedelf inside a conversation** (the owner's other way, 2026-11-21: "allow alice to reveal but only in the rachet part so its not in the first message") changes the protocol: it's the owner's to choose, below.
  - **"Says they're ⟨handle⟩" isn't built:** §18's plaintext has no field that names a handle, so there's nothing for it to say yet.
  - **The tag is shown as a Seedelf's name** where no contact names it, with its name's last sixteen beside it in the list, and its prefix and last sixteen in the header, since anyone can mint a tag.
- **A fresh-context review** (one agent, the code and protocol.md) found twelve things, all fixed: the gap's warning named when the wallet noticed it, not when the lost messages were sent ("sent before", now); a conversation open in a background tab was marked read; Start again was offered where the worker refuses it (an unanswered continuation, now said with no button); a request's row mislabelled a continuation; polls could pile up behind a long sync (one at a time now); "offline" could stick after a sync that failed later, and an unreachable message wasn't told at once; "Sending…" showed with the switch off ("Waiting to send"); two privacy lines overclaimed what off means; the list kept a message the budget deleted; slow actions pulled the user back to a pane they'd left; and the list showed a Seedelf by its tag alone (its last sixteen beside it now).
- **Tests:** eight new unit tests (the preview and its cut, the budget emptying it, offline and its clearing after a failed sync and a read not made, an unreachable message told at once, read-then-told, a name), each failing without its fix; e2e's `messaging.spec.ts` with `e2e/relay.ts`, the unit tests' relay behind a route on each browser: one wallet (both ways in, off by default, a message written while off waits and off asks nothing, the offline warning) and two (a stranger's request on a tab wide enough for both panes, accepted by a reply and named, read back on a narrow side panel; a message counted on Home within seconds; a gap; `byWorker` for every relay request). Restarting and continuing need the worker's clock 48 hours on, which e2e can't move, so the unit tests carry them.
- **Translations:** en, es and ja; the seven new critical strings back-translated blind, five fixes from it, each checked again.

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

1. ✅ **Where the relay runs: new routes in seedelf-data-api** (the owner, 2026-11-21), a module of its own on the same droplet, behind the same Caddy, deployed by the same workflow, with no new origin for the wallet to trust. With buckets and a traffic ceiling of its own, inside the API's (54c). The server grows as the wallet does.
2. ✅ **The relay's storage: in memory, saved to `StateDirectory` every minute and on shutdown** (the owner, 2026-11-21), so a deploy or restart keeps the pool. 36 hours at 10,000 envelopes a day is about 7.5 MB.
3. ✅ **Whether the relay checks points: yes** (the owner, 2026-11-21), as 54c built it.
   - **Recommended: yes,** with a copy of `decode_point` held to the crate's vectors, so garbage never reaches readers.
   - The alternative is the version, the length and the proof of work alone: cheaper, and readers refuse garbage anyway.
4. ✅ **Preprod: a pool on the same relay** (the owner, 2026-11-21), as 54c built it.
   - **Recommended: a preprod pool on the same relay,** told apart by the path, with lower caps, so 54g can run live between two preprod wallets.
   - It's the data layer's first preprod route, but it reads no chain, so it touches nothing of preprod's.
   - The alternative is mainnet only, with preprod tested against the e2e fake and a local relay.
5. ✅ **The largest message: 32 KiB envelopes** (the owner, 2026-11-21), as 54c built it.
   - **Recommended: 32 KiB envelopes,** under Caddy's 64 KiB.
   - The alternative is raising Caddy's limit for this route alone.
6. ✅ **Proof of work, priced by traffic** (the owner, 2026-11-20: "or even scale with traffic via ip").
   - Hashcash over SHA-256 of the envelope, a microsecond for the relay to check, at a light base that rises with the address's recent posts, with a global floor and a ceiling (protocol.md §10). The numbers are 54c's [measure].
   - A price, not a refusal, so an honest user behind the same address as a flooder (a carrier's NAT, an office) still gets through, only slower.
   - Raising one flat difficulty for everyone was weighed and set aside: the relay can't tell first messages from replies, so every reply would pay, and a GPU solves SHA-256 orders of magnitude faster than a browser.
   - In reserve against GPUs: a memory-hard puzzle that stays cheap to check, such as Equihash. Not one whose check costs as much as an attempt, such as Argon2, which would make the 2-vCPU relay the target.
7. ✅ **Where Messages lives** (the owner, 2026-11-21): both a round button left of Settings in the top bar and a row on Home near dApps, Activity and UTxOs, opening the same page.
   - **Recommended: a row on Home,** like the dApps row, with its unread count, opening the Messages screen. It's the wallet's own, not a dApp.
   - The alternative is a dApp tile.
8. ❓ **Strangers' first messages on screen.** protocol.md §3.1 bounds what's kept; this is how it's shown. Built as recommended in 54f; still the owner's to confirm.
   - **Recommended: a Requests list,** apart from conversations, until the user replies or deletes. Nothing tells the sender either way.
9. ✅ **Messages off by default, a switch for each network** (the owner, 2026-11-21): the worker reads each network whose switch is on, whichever the wallet shows (54e).
   - **Recommended: off,** with one switch on the Messages screen. Syncing tells the relay when the wallet is online, which is the private-by-default rule's case for off.
   - Messages works whether or not Koios-only is on, since there's no Koios version of it.
10. ✅ **History kept within about 5 MB** (the owner, 2026-11-21), the oldest going first, and the thread says so (54e).
    - **Recommended: until the user deletes it, within a budget of about 5 MB of the extension's storage.** The oldest messages go first past it, and the thread says so.
    - The alternative is a fixed age, such as 30 days.
11. ❓ **Notifications.** Built as recommended in 54f, the count on the top bar's button too, since the owner put one there; still the owner's to confirm.
    - **Recommended: the unread count on the Messages row only,** and no badge or system notification in this chunk. The notification centre was declined on 2026-10-11.
12. ✅ **A first-contact stamp** (the owner, 2026-11-21): built in 54a′.
    - An 8-byte nonce after F whose work over F the reader checks before any key is computed, 24 bits [choice], about 7 s in the browser. It prices a stranger's first message to one reader, which the relay's price can't target, since the relay can't tell first messages from replies. Replies pay nothing more.
    - Writers solve at 24 bits and readers ask the same: there's no way to tell writers a reader's own price.
13. ✅ **Proving the base comes from the named handle** (the owner, 2026-11-21): built in 54a′.
    - A first message to the sum of two Seedelfs' registers opens only for a wallet holding both, so a reply to it links them, unseen. A proof that p₀ re-randomizes the handle in `to`, bound to F, makes `to` verified; `to` is required.
    - It needed every envelope bound to its conversation too, or the writer aims the envelope at the sum instead (54a′, protocol-review.md §G).
15. ❓ **Revealing one's Seedelf inside a conversation** (raised by the owner, 2026-11-21: "allow alice to reveal but only in the rachet part so its not in the first message"). Numbered past 54b's call 14 (#405).
    - **Recommended: a verified reveal only,** as its own step after 54f. A new inner kind (§18), sent in the ratchet and never in a first message, carries the Seedelf's name and a proof that the conversation's key A and that Seedelf's register share the writer's key, bound to the cid; the reader shows §7's "Verified ⟨handle⟩". The writer chooses it, per conversation, and the reader alone learns it.
    - **Which proof:** a designated-verifier one convinces only the reader, who could have made it, so the conversation stays deniable, as Signal's are; a plain one is evidence the reader can show anyone. Recommended: designated-verifier.
    - **The alternative,** an unverified claim ("Says they're ⟨handle⟩ (unverified)", §7's row), anyone can make for any Seedelf: a phishing tool, so not recommended.
    - It changes the protocol: protocol.md, the crate with vectors checked independently, 54b's model told, a WebAssembly export, the worker and a button.

## Unknowns

- The scan at 15,000 envelopes: 14.6 s in Node and 16.3 s in a Chrome 157 worker, through the bindings (54d, protocol.md §8). The extension's own service worker and a slow laptop are still to measure (54e) [measure].
- Proof of work's solving times. Measured in 54d (protocol.md §17.3), in slices of 2^16 attempts with a turn of the event loop between:
  - an attempt costs 422 ns in Node 24 and 438 ns in a Chrome 157 worker;
  - the relay's 18 bits take about 0.12 s: 64 solves averaged 0.13 s in Node and 0.12 s in Chrome;
  - first contact's 24 bits take about 7.1 to 7.4 s on average. 16 solves averaged 6.4 s in Node and 10.9 s in Chrome (medians 6.1 and 7.7 s), and the longest of the 32 took 33 s.

  Still to measure: the extension's own worker and a slow laptop [measure]. The numbers (protocol.md §16.4, §17.4) are to tune with real use.
- The relay's egress at real use against the droplet's monthly ceiling: each wallet downloads every envelope [measure].
- The storage quota with history and skipped keys (54e) [measure].
- Whether a 15-minute auto-lock leaves enough unlocked time to sync a 36-hour pool [assumed: yes, about 15 s of scanning].
