# Chunk 54 · Seedelf Messaging

**Status: ✅ 54a merged** (#403). **✅ 54c merged** (#406) and deployed. **✅ Calls 12 and 13 merged** (54a′, #407). **✅ 54d merged** (#408, the WebAssembly bindings). **✅ 54e merged** (#409, the worker). **✅ 54f merged** (#410, the screens, with call 15's verified reveal). **✅ 54f′, the owner's reflection** (#411), but for item 7, the owner's open call. **✅ 54b, the model** (#405), and its follow-ups, which add the verified reveal, skipped keys and the outer envelope: every lemma was proved before call 16. **🚧 54g, the gate** (`web-wallet/release-1.10.0`): call 16's change to the protocol is built in the crate, the bindings, the worker and the relay, and the models changed with it, and check.sh proved them again but for those the model's README names and argues for. In this release Messages opens on preprod only, as a test, and protocol.md §20's freeze starts when it opens on mainnet (the owner, 2026-11-24: calls 17 to 19, and *Before Messages opens on mainnet*, below). Phase 1 is built: the [seedelf-messaging](../../../seedelf-messaging/) crate, merged in #401. This plan builds the rest: the session layer, the relay, the WebAssembly bindings, the worker and the screens. Each step gets its own branch, `web-wallet/messaging-<step>`, and its own PR from `main`, as chunk 38's and 53's do.

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
- Messages on preprod only for now; "the preprod only test should use a non mainnet wallet"; and the freeze starting when Messages opens on mainnet (2026-11-24). Those are calls 17, 18 and 19.

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

- **Envelopes of at most 32 KiB,** under Caddy's 64 KiB: protocol.md §9's sizes: every message padded to its first-contact size, 2 to 32 KiB, with 512 B read too. Text messages fit many times over; attachments aren't in this chunk.
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

**Where it stands** (merged in #403, 2026-11-20):
- **Built:** everything above but proof of work, which this step's brief left out. Call 6 has since been settled (priced by traffic), so solving and checking it, with vectors, can be built before 54c needs them. protocol.md §16 fixes every byte and rule the build decided, each choice marked [choice] for the owner to overturn.
- **The vectors** (tests/vectors/messaging_session_v1.json, three conversations) were reproduced by a script written from protocol.md §16 alone, without reading the Rust: noble-curves 2.0.1 and WebCrypto, every value. Its notes on where the spec was silent are folded into §16.
- **The rules hold the tests:** a mutation pass removed or weakened each of 39 rules in turn, and a test failed every time. Its first run found four survivors, which became a fix (a request's joining message now reads as eager processing would) and two continuation tests.
- **For 54e and 54f:** a first message is refused once its t is 48 hours old, so a conversation nobody read in its first 48 hours can never begin, however many first messages follow (protocol.md §16.4). The wallet needs "start again", or must start again by itself.

### 54b ✅ The model

- §3 to §6 in ProVerif or Tamarin [choice: ProVerif]. The queries:
  - secrecy of message keys;
  - §1.1's forward secrecy after the first reply;
  - recovery after a compromise;
  - agreement on cid, R_A and R_B, so no unknown-key share;
  - the static DH's hold on R_A.

  It checks the first-contact replay rules too.
- Runs alongside 54c to 54e. It gates mainnet, not the code.
- **The reveal (54f, protocol.md §19) is in the model since 54b's follow-up,** its proof as two constructors (`-D=REVEAL`): who could have made one. Its soundness and deniability aren't; the model README's assumption 14 says what covers them.

**Done means:** the model's queries hold, and a fresh-context reviewer has read the model against protocol.md.

**Where it stands** (2026-11-22, `web-wallet/messaging-model`):
- **Built in Tamarin, not ProVerif:** [seedelf-messaging/model/](../../../seedelf-messaging/model/), run by its `check.sh` in a pinned container. ProVerif's Diffie–Hellman equation needs a fixed base, and registers need any point as a base: its completion didn't finish on a one-line model.
- **Six configurations of one file,** since Tamarin's search grows with every rule that publishes something and every compromise: the sessions (two full round trips, long-term keys and the initiator's state stolen), the responder's state, the continuations (one link), the sessions without §5's cid rule, and, since the follow-up, the verified reveal and skipped keys. The model README lists every abstraction, what each configuration's attacker lacks, and why nothing is lost.
- **A fresh-context reviewer read it against protocol.md.** Its findings, all taken: the first version let the attacker decrypt only with the associated data, so a stolen state opened nothing; the argument for the bases a reader accepts was wrong (w₀ in the associated data is what ties a first message to its base); the agreement lemmas excused a key stolen mid-conversation; the responder's state wasn't modelled.
- **What it changed in the spec** (protocol.md §0, §1.1, §3, §7, §16.1): x_B stolen before the first reply takes the conversation over from the writer's side; the reader's own key lets anyone pose to it, "Continues" included; w₀ must stay in the associated data.
- **For the owner (call 14):** a request the bounds push out leaves no tombstone, so a re-posted first message can read again as a new request.
- **Calls 12 and 13 (54a′) after it:** the model's F leaves out `to`, its base proof and the stamp after F, and the README's assumption 4, which the model rested on, is now a rule the reader enforces: a first message's base is proved to be [b]g_S, and a continuation's is one of the reader's own (assumptions 4 and 12).
- **Proved** (2026-11-22): every lemma check.sh runs, 35 of them, and each configuration's wellformedness checks, in one run of check.sh on the final file: an hour, 5 at a time with 1 core and 8 GB each, the longest lemma 29 minutes. The four lemmas of assumption 14 stay out of it, as before; the follow-up proves them.
- **What proving it found** (2026-11-22), in the model README:
  - **The `[reuse]` lemmas helped nothing.** Their guard, `K(k)`, is the attacker sending k into the protocol, which a key never is, so no later proof could close on one, and each split the search on every message sent. That's why most lemmas ran out of an hour or 12.5 GB. Each keys lemma now guards on the key itself, `KU(rk)` and `KU(ck)`, a claim at least as strong; most lemmas then take minutes.
  - **`r1_forward_secret` and `r2_forward_secret` were first stated false.** Their excuse named a theft of Bob's key only before he accepted Alice's own F; with his key, the attacker has him accept another F with her cid, p₀, A and w₀ and reads his replies (§1.1's key-compromise impersonation). Their excuse now names a theft before Bob accepted any first message, as their claim always said.
  - **Agreement on m4 excused the initiator's state stolen at any time,** not only before m4 is read, as `responder_keys4_secret` stated it. Dated in the follow-up (below).
- **How, in the model:** three helper lemmas (`static_dh_secret`, `responder_accepted_the_initiators_f`, and `static_dh_holds_r_a` made `[reuse]`), each lemma hiding the helpers it doesn't rest on, `keys4_secret` with a key-guarded twin, the trace lemmas naming their trace step by step, and a goal ranking (`states_then_keys`) for the lemmas Tamarin's default ranking stalled on. None changes a claim but the three above.
- **check.sh** caps each run's cores and keeps it out of swap, runs the wellformedness checks in the same pool, kills a run inside its container (killing the docker client left it running), and fails a wellformedness run that didn't finish.

**54b's follow-up** (2026-11-22, `web-wallet/messaging-model-continuations`, after #405). The owner's aim: verify as much of the protocol as is realistic, as the messaging grows from a prototype to a product.
- **The four continuation lemmas are proved,** now in `-D=CONTINUATIONS`, and the `CONTINUATIONS_UNFINISHED` flag is gone. None was false. Three stood on a static DH helper whose excuse wasn't dated ("a key was stolen", not "before the attacker knew the secret"), so they couldn't close the branch where a key is stolen after the forgery; dated, as the sessions' helper always was, each took under 9 minutes and 1.1 GB. The fourth, the reader's key forging "Continues", is a trace, and names its forgery.
- **A run near its memory cap crawls instead of failing.** GHC compacts the heap in place once live data passes 30% of the cap, and compacting is slow: one collection at 5 GB didn't finish in 12 minutes. Last night's "out of an hour" runs were most likely out of memory. check.sh now says why a run stopped and its peak live heap, from GHC's log of every collection.
- **The verified reveal is modelled** (`-D=REVEAL`, protocol.md §19): "Verified ⟨Seedelf⟩" shows only if the Seedelf's owner revealed it in this conversation, which it started with this reader, unless its key or the reader's was stolen first; and the reader's own key forges one, as §19.5 says. The proof is two constructors, so its soundness and deniability stay the crate's tests' and the argument's (the README's assumption 14).
- **Proved** (2026-11-22): every lemma, 54 of them, and each of the six configurations' wellformedness checks. One run of check.sh on the file took 53 of them in an hour and 41 minutes, 4 at a time: the longest, `responder_keys2_secret`, 100 minutes at 6.1 GB of live heap, and every other under 2 GB. A second run on the final file took the review's two (the reveal's name binding and the in-order trace), which no other lemma rests on.
- **m4's agreement is dated:** the initiator's state excuses a forged m4 only if stolen before m4 was read. Its keys lemmas are dated too, and `responder_keys2_secret` took 94 minutes and 6.5 GB of live heap, so check.sh gives it 20 GB, from a `// check.sh:` line above it, and runs it first.
- **Skipped keys are modelled** (`-D=SKIPPED`): a chain of two messages read in either order, the kept key stolen once. Each message is read only as sent and once; the kept key opens its message and not the next. Found: with x_B too, stolen even after the reader accepted, the kept key writes the message it stands for while the reader waits; §1.1's rows each hold alone, and this is two together. Alone it writes nothing in the model, but a fresh-context review showed that rests on the outer layer, which the model leaves out: on the wire, whoever sees the inner layer gets w₀ from the envelope's [o]w₀, and AES-GCM's tag can be redone without the associated data. The model README's assumption 2 now lists it.
- **What the model could cover next,** most useful first (the model README's assumptions say what each leaves out):
  - **Both sides' state stolen at once** (assumption 11): healing after a round trip the attacker only watches, with both devices' states taken. Once past 14 GB; that may have been the crawl above.
  - **A base proved over another register of the reader's key** (assumption 4): the one step there that's argued, not checked.
  - **A continuation of a continuation** (assumption 6).
  - **Unlinkability of the outer envelope** (assumption 2): done for the bare v1 envelope (model/unlinkability.spthy, observational equivalence, with two controls that find the link). Session envelopes are argued to be the same to an observer, not checked.
  - **The outer envelope around the sessions** (assumption 2): done, model/envelope.spthy. The v1 envelope; call 13's check, which the gate found watched only the envelope's p (the model README, *What building and reviewing it found*); and assumption 2's two claims, Bob's replies sealed to R_A and a kept key writing nothing on the wire. Since call 16 its lemmas name every point the reader's key touches, each check with a control that drops it, proved again (2026-11-23) but for the base proof's designated-verifier trace, argued, not checked. Each claim has a configuration of its own: the whole session sealed didn't finish Tamarin's precomputation in 20 GB.
  - **ENCRYPT's salt against a rollback** (assumption 10): symbolic AES-GCM has no nonce reuse to lose, so it would need an equation written for it, which proves little.

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
  - **Since:** deployed after 54c, and due again before the wallet's upload, with the gate's changes to the relay: the deployed relay refuses the new envelopes' layout. `DATA_MESSAGING_GB_MONTH` is still the owner's to set; `/health` says whether it is (`"ceiling"`). The privacy policy's entry came with 54f (21 November 2026), and the gate's changes have one of their own (23 November 2026). The load test (6,400 posts a second) is worth one run after the gate's relay changes, which add a copy per kept envelope and deadlines.
  - **The talk's figures,** neither measured: at 20 messages a user a day, 1,000 daily users with every message a 512-byte envelope read once is about 310 GB a month, where the 600 GB above counted about 1 KB a message. And "a microsecond for the relay to check" holds for a short post: the stamp's digest hashes the envelope, about 80 µs for 32 KiB.

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

### 54f ✅ The screens

- **Messages,** where call 7 puts it:
  - a list of conversations, and a list of requests from strangers (call 8);
  - a thread;
  - "New message" to ⟨Seedelf⟩.
- **Turning it on** (call 9): one switch, with what it sends and to whom in a line. Off by default.
- **The labels of protocol.md §7's table,** in its words:
  - ⟨handle⟩;
  - unknown sender;
  - verified ⟨handle⟩, from a reveal (call 15, §19);
  - says they're ⟨handle⟩ (unverified): never built, a tool for phishing;
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
  - **Requests** (call 8): a list of their own over the conversations, read-only with **Accept**, and a reply accepts one as it's sent.
- **Added to the worker:** each conversation's last message, its first 120 characters, kept in the inbox for the list (`last`); the user's own name for it (`name`, `messaging-name`); `offline` in the overview while the relay doesn't answer a read; `messaging-changed` when reading a thread or a request leaves less unread; and `messaging-sync`, which the screen sends every 10 seconds while it's seen and the switch is on, so a reply shows up while a conversation is open. The architecture's request cost says so.
- **My calls,** flagged for overturn:
  - **10 seconds while a page of the wallet is on screen** [choice]: the alarm's minute is slow to talk in, and was slow to count a message on Home (the owner, 2026-11-21: "you can get a message and just not know it until you physically click that button"; it took 51 s on Home, measured). It costs the relay a page every 10 seconds per page on screen, and tells it when the wallet is open (the policy says so).
  - **A name of the user's own for a conversation** (the owner, 2026-11-21: "allow bob to edit the unknown sender label"): on the device only, never sent (`messaging-name`). It stands over §7's label, which the header still says under it, and goes on into a conversation started again, or a verified continuation.
  - **Revealing one's Seedelf inside a conversation** is built, call 15's verified reveal: below.
  - **"Says they're ⟨handle⟩" isn't built,** and won't be: a claim anyone can make for any Seedelf is a tool for phishing. §18's plaintext has no field that names a handle; only a reveal does, and only verified.
  - **The tag is shown as a Seedelf's name** where no contact names it, with its name's last sixteen beside it in the list, and its prefix and last sixteen in the header, since anyone can mint a tag. Since 2026-11-24 with its output index too, in the wallet's one short form (flows.md, *Messages*).
- **A fresh-context review** (one agent, the code and protocol.md) found twelve things, all fixed: the gap's warning named when the wallet noticed it, not when the lost messages were sent ("sent before", now); a conversation open in a background tab was marked read; Start again was offered where the worker refuses it (an unanswered continuation, now said with no button); a request's row mislabelled a continuation; polls could pile up behind a long sync (one at a time now); "offline" could stick after a sync that failed later, and an unreachable message wasn't told at once; "Sending…" showed with the switch off ("Waiting to send"); two privacy lines overclaimed what off means; the list kept a message the budget deleted; slow actions pulled the user back to a pane they'd left; and the list showed a Seedelf by its tag alone (its last sixteen beside it now).
- **Tests:** eight new unit tests (the preview and its cut, the budget emptying it, offline and its clearing after a failed sync and a read not made, an unreachable message told at once, read-then-told, a name), each failing without its fix; e2e's `messaging.spec.ts` with `e2e/relay.ts`, the unit tests' relay behind a route on each browser: one wallet (both ways in, off by default, a message written while off waits and off asks nothing, the offline warning) and two (a stranger's request on a tab wide enough for both panes, accepted by a reply and named, read back on a narrow side panel; a message counted on Home within seconds; a gap; `byWorker` for every relay request). Restarting and continuing need the worker's clock 48 hours on, which e2e can't move, so the unit tests carry them.
- **Translations:** en, es and ja; the seven new critical strings back-translated blind, five fixes from it, each checked again.

**The verified reveal** (call 15, built in this PR, 2026-11-22):
- **The protocol:** protocol.md §19, every byte and rule with its [choice]s, a new kind `0x02` in §18, §7's "Verified ⟨handle⟩" row, and §0, §11, §12, §14 and §15 brought up to it. security.md says what it proves and what it doesn't.
  - **Who and when:** only the side that wrote first, only once a reply has decrypted, in a session message, never in F or a first-contact message; only the side written to checks one.
  - **The proof:** a Fiat–Shamir OR-proof (Cramer, Damgård, Schoenmakers) that the Seedelf's register and A share a key, or that its maker knows w₀'s, with the cid, p₀, A, w₀, the name and the register in its challenge. The reader could have made it, so it convinces only the reader: deniable, as Signal is.
  - **The bytes:** the name, the register and the proof, 226 to 257 bytes, so a Seedelf's is a 2 KiB envelope. The register travels with the name [choice], so a forged reveal fails before anything reads the chain.
- **The crate:** `session::reveal` (`Conversation::reveal`, `Conversation::verify_reveal`, `Reveal`), two errors (`RevealNotAllowed`, `InvalidReveal`), 13 unit tests, and a new vectors file, `messaging_reveal_v1.json` (`RECORD_MESSAGING_REVEAL_VECTORS=1`; the other three untouched), read back through the public API.
  - **Checked independently:** an agent that read only protocol.md and construction.md reproduced all 78 values with noble-curves and Node's SHA-256. Its notes went into §19: which code each refusal is, the order parsing reads in, how a commitment at O is hashed, the draws' order. Checks for the last two were added.
  - **A mutation pass** (scratchpad tools/mutate_reveal.py) killed all 25 mutants once a check of the parsing order was added for the one that survived.
- **WebAssembly:** `messagingReveal` and `messagingCheckReveal`, in the README's table, with native and Node tests: every vector's check, and a reveal made, sent and checked between two wallets.
- **The worker:** `messaging-reveal`, for the register a contract read finds now. A received one is checked in the queue (a session message, at the side written to, the proof), then after the page against a fresh read of the contract, as Send's pay-by-name reads it, once a pass (`revealedRegisters`). Only then is the conversation `revealed`; a reveal that fails keeps no name. A read that fails leaves it `checking`, tried again a minute on. Nine unit tests.
- **The screens:** **Show my Seedelf** over the box where the wallet wrote first and has a reply, a picker of the wallet's Seedelfs with one privacy line; the reveal as a bubble each side; the conversation named by the verified Seedelf (a contact's name, else its tag and cut name), with "Verified Seedelf …" under it and the user's own name over it; **Save to contacts**. A reveal that fails says so and names nothing. The e2e two-wallet test gives B a Seedelf in the contract (`koios.addedToContract`), and B shows it to A once A has replied.
- **A correction:** privacy.md said writing first to a Seedelf tells the server which Seedelf; the lookup reads the whole contract, as Send's does, so it doesn't (privacy.md's own *Network* section says so: "Finding a recipient"). Corrected; the policy's entry never said it.
- **Translations:** the two new critical strings back-translated blind three rounds: the Spanish's subjects and whose name, and the Japanese's whose name, fixed, the English's received lines with them ("Showed you …").
- **A fresh-context review** (one agent, the code and protocol.md) found nothing in the proof, and three things in the worker, all fixed with tests: a view of the contract kept from before a Seedelf moved could still verify its former owner's reveal (now always a fresh read); a stop between two writes, or the history's budget, could leave a reveal waiting for good or the conversation unnamed (now set from the record); and the chain had no cap on reads (once a pass now, and a minute after one fails). Three doc slips with them. A mutation pass over the worker's reveal rules (scratchpad tools/mutate_reveal_worker.py, run against the reveal's tests alone) killed all 10 mutants, once tests were added for a kept view older than the register, a later reveal naming the conversation, and a proof that fails reading nothing of the chain.
- **My calls,** flagged for overturn: the button's words, **Show my Seedelf** (the owner said "Reveal or something"); the register in the reveal (a 2 KiB envelope); a reveal checked against the register now, never an older one, since a Seedelf can change hands; the latest that verified names the conversation; a failed read tried again a minute on.

### 54f′ ✅ The reflection

The owner used 54f on preprod after it merged and asked for a pass of questions and small fixes before the gate (2026-11-22). Each item is the owner's call.

1. **Spam, small and large alike** (the owner: "one of the hardest problems here"). A reader's cost per envelope is its bytes (downloaded) and its scan (about 1 ms, whatever its size). The price only paces an address: one mainnet address keeps about 15 short posts a minute under the 24-bit ceiling, about 33,000 in the 36 hours, and four fill the 64 MiB pool before the global floor moves. The pool had no limit per address.
   - **Built:** a window on what each address has kept in the pool over the 36 hours, by envelopes and by bytes, counted in memory only and never per envelope; a post past it is refused like the ceiling (429, with how long), and the page prices its size at 0. IPv6 is counted by /56 for messaging, so one server's allocation is one address. protocol.md §17, the API's README and the privacy policy's unshipped entry say so.
2. **A time on "Sending…"** (the owner: "a timer to when it would be sent or some other indicator"). Built: "sending, about 7 s" while a post's work, or a first message's stamp, is solved, from an attempt's time measured here (each attempt is a fresh chance, so an estimate, never a countdown), shown at 2 s or more; and "sending in 2:14" while the relay has asked the wallet to wait. Where a page prices a size at 0, the wallet posts with no work to ask: the relay counts before it checks work, so its 429 gives the exact time, where the wallet used to wait a blind minute. Since 2026-11-24 that wait is said in words, "sending in 3 min": "2:14" read as a clock's time. And while Messages are paused, or the server doesn't answer, a waiting message says that instead, with no countdown.
3. **Order kept** (the owner: a conversation should read in order). A short message still waits behind a refused long one; nothing changes.
4. **The connector's window closed and opened again** after an unlock for a signature whose account read outlasted the window's 800 ms. Fixed: the worker keeps the window while a request the unlock let go is on its way.
5. **The switch alone** (the owner: "no reason for the paragraph below it or text on it at all"): it reads "Turn on Messages", with nothing under it. The privacy policy and privacy.md still say what the server sees. Since 2026-11-24 one warning stands under it, the owner's call 18: the test is for a wallet that isn't a mainnet wallet.
6. **Save to contacts in the header, not the chat** (the owner: "I dont want links … in the chat"): a round button beside Rename and Delete wherever the other side's Seedelf is known, the one written to or one shown and verified, until a contact names it.
7. **Links, images, GIFs and videos** (the owner: "we need to think about how to handle" them). Open: the owner's call, and the one item of 54f′ not done. Until it's made, a message is text, and a link in it isn't a link. Recommended: a link shown as a link that asks before it opens, naming its whole address, and never a preview (a preview tells the site the reader's IP address and that the link arrived). Media waits for a chunk of its own: an envelope holds 32 KiB, so a file means many envelopes against the relay's limits, or a host that sees the reader's IP address.
8. **Copy the Seedelf** (the owner: "maybe the user is working out some deal, payment, or escrow"): a round Copy button beside Save, wherever the other side's Seedelf is known.

### 54g 🚧 The gate

- A release's gate review of 54a to 54f.
- A live run on preprod between two wallets, if call 4 gives preprod a pool.
- The relay deployed on mainnet (the owner).
- `npm run tokens`, `npm run dreps`, store images, the release.

**Where it stands** (2026-11-23, `web-wallet/release-1.10.0`; the review's own record is kept apart):
- **Two rounds of review,** 196 findings in the first, and call 16, the change to the protocol they led to (below, and protocol.md §0): no envelope holds a register of anyone's key; every point the reader's key meets is bound before the reader reacts; first messages deniable; a request's share; "too far ahead" only for a message that authenticates; tombstones a clock can't reopen. All four vector files were re-recorded once, deliberately, and none has been reproduced independently since (protocol.md §16.6). Since then (2026-11-23, and 2026-11-24 after §9's padding) another model's harness, written from protocol.md, construction.md and the files alone, has reproduced all four, but for what §16.6 lists.
- **The worker, around one rule:** what an envelope holds never decides what the wallet sends, or when. No envelope starts a chain read, and no refusal is kept, shown or acted on but an authenticated "too far ahead" (W1, W3); a sync reads, then takes, at most 16 pages a read (W4, W10); a reveal's chain check waits for the user's press (W2); a handle is a (name, register) pair this browser made or the user turned on (W8, W12); one storage budget, enforced before each write, beside a reserve the wallet's payments keep (W7, W11); ways out of a trap (W9, W13); the clock (W14); the relay's off switch and what 1.10.0 freezes (W15, W16, protocol.md §20), a freeze that starts when Messages opens on mainnet (call 19). These replace 54a′'s and 54e's handles ("every register it has held"), 54e's fresh read of the contract for a first message, 54f's check of a reveal after its page, and the "no longer has" count. architecture.md's *Seedelf Messaging* says how each works.
- **The relay:** the envelope's new layout, a day's reading per address, short pages near the traffic allowance, caps on requests in flight, deadlines, a restart's numbering, and an off switch (`DATA_MESSAGING_OFF`: a 410 on every `/messaging/` route, which wallets read as paused; the data layer's runbook, *Stopping Messages*). It's to be deployed again before the upload.
- **The models,** changed for call 16 (the model README), run again in full (2026-11-23, 2026-11-24): every run as it must, but for `heal_keys_secret`, which holds by a run without two actions it doesn't read, and four traces and `answers_alike` with its two controls, argued, not checked.
- **The docs:** architecture.md, flows.md, privacy.md and the privacy policy's dated entry, development.md's checklist and release steps, and the store listing's English; its Spanish and Japanese follow, back-translated blind.
- **Still to do:** the screens for the worker's new states, the models' runs, the live run between two preprod wallets, the relay's deploy, and the release's own steps.
- **The owner's three calls of 2026-11-24** (calls 17 to 19, at 1.10.0's second review): Messages opens on preprod only in this release; the test is for a wallet that isn't a mainnet wallet, said under the switch; and protocol.md §20's freeze starts when Messages opens on mainnet. Built: `MESSAGING_NETWORKS` in `networks.ts`, the settings, the worker's refusal and the page (architecture.md, *Seedelf Messaging*), with the docs and the privacy policy's entry of that day.
- **The written arguments** (2026-11-24): the written arguments for the three proofs were drafted and attacked by two models, with no way found to recover the Seedelf key or forge a spend through Messages. The one protocol finding: a first message, and a Seedelf shown, are deniable only while the writer's device had a sound random source when it made them (privacy.md, *Seedelf Messaging*; the fix is in the list below).
- **The key at a lock** (2026-11-24, found by the review's key lens): the Seedelf key stayed in the WebAssembly module's memory after a lock. wasm-bindgen's `free()` moved a key object out of its cell before its wipe ran, so the wipe ran on a copy. Fixed in the module (each key in an allocation of its own, overwritten in place; `scrubStack`, which overwrites the top 512 KiB of its stack) and in the worker (a scrub after a lock's frees, and after each derivation of keys, before a later call can copy stale stack bytes into the heap). Then the review's Rust lens found what neither reaches, bytes a later call had built into the heap: after a lock, 16 bytes of the stake key's signing scalar, 16 of payment key 0/0's extended key, and 6 then 4 more bytes of the Seedelf key. So a lock now ends by replacing the module's instance and zeroing the old one's whole memory (`renewWasm`): the old memory is all zero, and the new instance holds no run of any key. And no stored conversation's ratchet key is the identity key, whose secret is the Seedelf key: such a record doesn't read and isn't written (protocol.md §16.5). What can still hold a copy after a lock is outside the module: JavaScript's own strings and the browser's memory.
- **The keep-alive, built and removed** (2026-11-24). The review built one (`keep-warm.ts`: one extension API call every 20 s while unlocked with a Messages switch on), so that a read from a worker just started couldn't be told from one from a running worker, and it was kept through the day's rounds. The owner then had it removed (call 20): Chrome's migration guide allows a continuous keep-alive only on managed enterprise or education devices. What it hid is now a stated limit of the timing assumption (below), and an update of the extension no longer waits for a lock.
- **A request Accept left in its record** (2026-11-24, found by the review of the merged fixes) could be listed and accepted again once its conversation was deleted. Fixed: the inbox marks it in the write that lists the conversation (`requestLeft`, stored), the repair runs at the first window and before a take or a deletion, and Accept refuses a cid a tombstone holds (architecture.md, *Seedelf Messaging*).
- **Every Messages call belongs to the unlock it was asked under** (2026-11-24, found in the gate's last round): a press whose write waited at the gate could land after a lock, Remove wallet and a restore of another phrase, in the second wallet's storage, whose inbox then listed the first wallet's conversations and previews. Fixed: the wallet's count of its opens is looked at after each pass of the gate and inside the call's own turn of the wallet's queue, and a call asked under an unlock that ended is refused as a lock refuses (architecture.md, *Seedelf Messaging*).
- **A reveal against the spending verifiers** (2026-11-24): the crate's `the_spending_verifiers_refuse_a_reveals_transcripts_and_its_share_is_none_of_their_challenges` runs a reveal's two transcripts through them, as the keys proof's test does.
- **A second live run between two preprod wallets** (2026-11-24, on the final build) passed its nine steps: the update over kept data; a lock and the replaced instance, twice; the worker stopping about 30 s after its last activity and starting at each minute's alarm; a private Send after a lock (transaction `6dc9c3a41572483602cad7defa5c6d5bc357e92fd5186e7b8c08e64023e59755`); a fresh first contact, its accept and its delete; mainnet closed; and the hosts reached. What it and the blind read of the screens left is in the lists below.

### Before Messages opens on mainnet

Mainnet opens by adding it to `MESSAGING_NETWORKS`, in a later release (call 17). Before it does:

- **The vectors** (protocol.md §16.6): `0x02` sends at each size's edge added to the session file, which has none; and what the clean-room check found the spec still leaves unpinned, each settled in the text or pinned by a fixture:
  - the recipes and draws of the negative-case fixtures (§16.6, §19.6, §17.7);
  - the handle's register for the reveal file's two conversations (§19.6);
  - which refusal wins for an envelope with both a bad length and a bad version (§17.2, §17.7);
  - §16.4's `max_text_len`, whose "the share's" room is never defined;
  - which refusal wins for a first-contact message both too large and past its share;
  - §16.5's role byte values and its integers' byte order;
  - §16.1's "and never less than its own inner message", which never binds in v1.
- **More review passes,** in 1.10.x.
- **The model's lemmas still argued, not checked** (the model's README): `heal_keys_secret`, which holds by a run without two actions it doesn't read; four traces; and `answers_alike` with its two controls.
- **Derive, don't draw** (found 2026-11-24): each proof's simulated branch, its challenge share and response (c₂ and z₂), derived from the prover's key instead of drawn, for deniability under a failing random source; and each send's salt derived too, since a source that repeats, with storage rolled back or wiped, can still seal two texts under one key and nonce (security.md, *Before production*). It changes only what a writer does: readers and formats stay as they are. It re-records the session and reveal vectors, and it's a new use of the Seedelf key, so joint-security.md's inventory and argument come first.
- **The written security arguments' open items:** joint-security.md's Status says which.
- **A slow lane can't shut the gate** (found 2026-11-24; designed, not built): with a page of the wallet on screen, a relay or a link that takes about 7 to 10 s, or 17 to 20 s, to answer a page makes every lane end inside the 3 s margin before the next tick, and the gate doesn't open for as long as that lasts (architecture.md, *What the screens are told*). A rule for it, and never sleeping on the wallet's own rate limit inside a lane.
- **A guard for the runner's tidy-up:** a trap there could lock the wallet at every unlock. None is known; the take and the scan have one.
- **Two counters that can wrap,** at values no stranger can reach, in the wallet's own records: a conversation's `lost`, and the requests' sequence number.
- **A Seedelf's `gone` mark lifted** when a later contract view shows the same (name, register) again: a lagging Koios view after a mint can turn a new Seedelf's Messages switch off.
- **A mint's who-paid record written** even when Messages' pair write fails.
- **Two smaller notices with no way out:** the "couldn't be kept" count, and a stale clock warning.
- **Messages' write of the mint's shared record** (`mintedAt`): its read now comes after the gate, but its write waits at the gate too, so a lane or a tick's margin that begins between the two, with a mint or a Remove sent in that moment, can still be written over. To settle: a read, change and write in one admitted call.
- **A repeated start across networks:** the guard against a second conversation under an ID the wallet holds is each network's own (`refuseHeld`, built in 1.10.0's second review: a start, a start again, a continuation and Accept refuse a cid the inbox holds, a tombstone's included). The same register on both networks in the same ten minutes, under a random source that repeats, is to look at before mainnet opens.
- **`repairRequests` drops a request whose cid is tombstoned,** silently: to settle whether that's said.
- **Messages' decrypted lists cleared at a lock:** what the worker keeps in memory of the list it shows.
- **A call can take another call's unlock for its own** (found 2026-11-24 by the last review of the fixes; low): `admitted` reads the unlock from the queue's current task, whoever calls. So for a moment after a lock and an unlock, while an older press still waits behind a slow relay's run, a page can be told "The wallet is locked." By reading alone, the runner's unqueued `writeRead` and `setMark`, and `stamp()`'s first read, can meet the same.
- **No test for the unlock's look on the five removals that take no key** (the same review; `mine`).
- **Marks kept in memory alone, which a routine stop of the worker loses** (the same review; low, each after a refused write): `requestsBehind` (a stranger's request can stay unlisted where a press writes the record before the next first window), `oneByOne` (a page that trapped traps and locks again), `outboxNoted`, and `due.posted` with `postedHere` (a post answered but not yet marked goes again). And the wallet's wait for a relay page's body, 120 s, outlives a worker with no page open.
- **The relay-side A/B of the take margin:** not done.
- **A fuller check that the module's time doesn't depend on the key:** a native constant-time tool on blst's portable C path, the engine's compiled machine code, the Rust side's primitives (SHA-2, HMAC, HKDF, AES-GCM) as WebAssembly, and Chrome's worker. Not done: what was measured on 2026-11-24 is in security.md, *Assumptions*.
- **The freeze taking effect** (call 19): the release that opens mainnet freezes what protocol.md §20 says, so every change to a format, or to what the relay's v1 routes take and answer, lands before it, with preprod's conversations and its pool reset where a change needs it.

### Request timing: an assumption, with its stated limits

The owner, 2026-11-24, after six more request-timing cases were found and fixed in this review: "The timing stuff might have to just be part of the assumptions to make this work." The concern, in order: the one key leaking, then the screens. So the relay and the data layer see when a wallet asks and how often, and Messages doesn't claim to hide the timing of its requests from them. What's built stays, as what the wallet does, not as a guarantee (architecture.md, *Seedelf Messaging*). These are stated limits, not open items:

- **What's left of a page's own poll off the grid,** as when a second page opens (architecture.md, *What's left*).
- **A minute's read that goes out a second late** (measured in Chromium, 2026-11-24): Chrome polls alarms once a second, and the unlock creates the auto-lock's alarm a few milliseconds before Messages', so Messages' read goes out at once or a second later depending on that gap. On the fixed build a read went out a second late in 1 of 29 minutes with nothing else running on the cores, and in 2 of 4 under outside CPU load; the gap between the two alarms' creation at unlock was about 2 ms idle and up to about 44 ms under load. Nothing the wallet held moved it in what was measured, which is a weak comparison: the branch hardly turned.
- **A read from a worker just started against one from a running worker** (measured in Chromium, 2026-11-24): Chrome stops the worker about 30 s after its last activity, the next minute's read then goes out about 107 to 137 ms after the alarm's schedule against about 3 to 17 ms from a running worker, and a wallet that just read a backlog keeps its worker running across the next read. So the relay can tell a wallet that was recently busy from an idle one. The fix, a keep-alive, isn't used: Chrome's rules don't allow one (call 20).
- **Any web page can time the wallet's work while the connector is on** (1.10.0's second review): while *Let sites connect to Seedelf Wallet* is on, every https page's calls, connected or not, take their turns in the wallet's queue on the worker's one thread, which Messages' work shares, so a page can tell when the wallet takes in a message of its own, and test a register in few tries (privacy.md, *Seedelf Messaging*). A stated limit, not a trusted party.
- **A contract read before a post marks the post** (found 2026-11-24): writing first reads the contract and posts once the stamp is solved, Show my Seedelf reads it and posts at once, and an ordinary message reads nothing. So whoever sees both the read and the post can tell a first message and a reveal from other messages: today someone watching the connection, and once Messages opens on mainnet the one server.

One kind of timing isn't in the assumption and stays in scope: timing that depends on the key, the WebAssembly module's work with x.

### For 1.10.x

- **The tab's list cuts a tag to about six letters.**
- **A request's "Continues ⟨tag⟩" names a Seedelf by its tag alone.**
- **A request's row cuts the short form of the wallet's own Seedelf.**
- **A tagged Seedelf in Activity, and in its CSV, is the tag alone.**
- **On a closed network Send again isn't greyed:** the worker refuses it.

From the last review of the fixes (2026-11-24), both low, each needing a lock and a restore at the wrong moment, or a refused write:

- **One wallet's inbox held in memory as the next unlock's:** `inbox()` unseals, then reads the unlock's stamp (`stampNow`, exempt at the gate), so after a lock, Remove wallet and a restore the list and its previews can be the first wallet's, shown from memory until the worker restarts. Storage is clean.
- **A repair that fails lets a take pass over a continuation:** `settled` swallows a full store or a failed write, and the take goes on instead of waiting.

From the blind read of the screens and the two live runs (2026-11-24):

- **"not sent: the server refused it" gives no reason,** and no hint whether Send again helps.
- **A request's choices aren't explained:** Accept against a reply, and the bin; and there's no Block.
- **"sent, expires …" reads as if the user's own copy will go.**
- **Nothing says "delivered",** by design: to say so on the screen, or drop the worry.
- **"several seconds of work" doesn't say whose work,** or that no ADA is spent; "Check on chain" neither.
- **Nothing marks which Seedelfs this browser made,** which "Turn on only a Seedelf you made" asks the user to know.
- **"Waiting for a reply" can read as delivered and waiting,** in all three languages (a blind read-back, 2026-11-24): the message is held until the other side replies.
- **A long delay from the relay reads in minutes** ("sending in 2220 min").
- **A press made just before a lock is dropped without a word** (a rename).
- **About a quarter of the relay's requests end as `net::ERR_ABORTED`** in the browser's own report, after a 200 head, though every one is taken in. Seen in both live runs; the cause isn't found.
- **The short form spends its room on the prefix every Seedelf shares,** and "#n" isn't explained anywhere on the screen.

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
8. ✅ **Strangers' first messages on screen: a Requests list** (the owner, 2026-11-21), as recommended and built in 54f. protocol.md §3.1 bounds what's kept; this is how it's shown.
   - **Recommended: a Requests list,** apart from conversations, until the user replies or deletes. Nothing tells the sender either way.
9. ✅ **Messages off by default, a switch for each network** (the owner, 2026-11-21): the worker reads each network whose switch is on, whichever the wallet shows (54e).
   - **Recommended: off,** with one switch on the Messages screen. Syncing tells the relay when the wallet is online, which is the private-by-default rule's case for off.
   - Messages works whether or not Koios-only is on, since there's no Koios version of it.
   - Since call 17 (2026-11-24) only preprod's switch can be on, for now.
10. ✅ **History kept within about 5 MB** (the owner, 2026-11-21), the oldest going first, and the thread says so (54e).
    - **Recommended: until the user deletes it, within a budget of about 5 MB of the extension's storage.** The oldest messages go first past it, and the thread says so.
    - The alternative is a fixed age, such as 30 days.
11. ✅ **Notifications: the unread count, on Home's row and the top bar's button** (the owner, 2026-11-21), as built in 54f, the button's since the owner put one there. No badge or system notification.
    - **Recommended: the unread count on the Messages row only,** and no badge or system notification in this chunk. The notification centre was declined on 2026-10-11.
12. ✅ **A first-contact stamp** (the owner, 2026-11-21): built in 54a′.
    - An 8-byte nonce after F whose work over F the reader checks before any key is computed, 24 bits [choice], about 7 s in the browser. It prices a stranger's first message to one reader, which the relay's price can't target, since the relay can't tell first messages from replies. Replies pay nothing more.
    - Writers solve at 24 bits and readers ask the same: there's no way to tell writers a reader's own price.
13. ✅ **Proving the base comes from the named handle** (the owner, 2026-11-21): built in 54a′.
    - A first message to the sum of two Seedelfs' registers opens only for a wallet holding both, so a reply to it links them, unseen. A proof that p₀ re-randomizes the handle in `to`, bound to F, makes `to` verified; `to` is required.
    - It needed every envelope bound to its conversation too, or the writer aims the envelope at the sum instead (54a′, protocol-review.md §G).
14. ❓ **Tombstones for evicted requests** (found by 54b's review). §16.4 leaves no tombstone when the bounds push a request out [choice]. So after a flood of 50 requests, a first message re-posted after the relay's 36 hours, and within t + 48 hours, reads again as a new request. No conversation changes; the reader sees a request twice.
    - **Recommended: tombstone evicted requests too,** until t + 48 hours as the others. A flood then costs the reader a tombstone per evicted request (24 bytes each), as it costs the flooder a stamp for each (call 12).
    - The alternative is to leave it, documented.
    - **Still open after the gate:** call 16 keeps a new request pushing the oldest out with no tombstone, and a join now never pushes one out, so only a new request, with its own stamp, can.
15. ✅ **Revealing one's Seedelf inside a conversation: a verified reveal, in 54f** (the owner, 2026-11-21: "allow alice to reveal but only in the rachet part so its not in the first message"; "a button that shows up after the handshake on Alices side that says, Reveal or something and it sends it like a message to bob"; "I think its worth putting it in this pr"). Built as recommended, designated-verifier (protocol.md §19). The owner noted it proves "someone with a seedelf is messaging you", not a person: its value is tying a conversation to a Seedelf the reader already knows. Numbered past 54b's call 14 (#405).
    - **Recommended: a verified reveal only,** as its own step after 54f. A new inner kind (§18), sent in the ratchet and never in a first message, carries the Seedelf's name and a proof that the conversation's key A and that Seedelf's register share the writer's key, bound to the cid; the reader shows §7's "Verified ⟨handle⟩". The writer chooses it, per conversation, and the reader alone learns it.
    - **Which proof:** a designated-verifier one convinces only the reader, who could have made it, so the conversation stays deniable, as Signal's are; a plain one is evidence the reader can show anyone. Recommended: designated-verifier.
    - **The alternative,** an unverified claim ("Says they're ⟨handle⟩ (unverified)", §7's row), anyone can make for any Seedelf: a phishing tool, so not recommended.
    - It changes the protocol: protocol.md, the crate with vectors checked independently, 54b's model told, a WebAssembly export, the worker and a button.
16. 🚧 **The protocol's change before release: call 16** (the 1.10.0 gate, 2026-11-23), from the gate's review. Nothing of Messages had shipped, so v1 changed in place, with no migration, and a development build's records are refused by their version (protocol.md §0, §20). An envelope carries a tag of w in place of w; its ephemeral point is derived from the message key and checked; F carries a keys proof, and its base proof became designated-verifier; a request has its share; "too far ahead" needs a message that authenticates; tombstones ignore a clock set back. joint-security.md took the keys proof as x's tenth use, written before the code. Built in the crate, the bindings, the worker and the relay, with every vector file re-recorded; the models were proved again, but for those the model's README names and argues for.
    - **Kept outside it, and said in the docs:** a first message hands its reader (p₀, A), a register of the writer's key it can pay (one key and one scan, so it can't be closed); the timing a take leaves at the relay (W10); and a Seedelf someone else put under the key that the user turns on (W8).
17. ✅ **Messages on preprod only, for now** (the owner, 2026-11-24, at 1.10.0's second review). `MESSAGING_NETWORKS` in `networks.ts` is `["preprod"]`, and the store build still has both networks for everything else.
    - On mainnet the Messages page has one line in the switch's place, "For now, Messages are on Preprod only.", and its pen can't be pressed; the worker refuses to turn mainnet's switch on; and a mainnet switch a development build left on reads as off everywhere. So nothing of mainnet's reaches the relay: no read, no post.
    - The relay keeps both pools (call 4), and the wallet uses preprod's. With preprod's switch on, the worker reads its pool while the wallet shows mainnet too (call 9), and mainnet's page says so, with a way to turn it off.
    - Mainnet opens by adding it to that list, in a later release: *Before Messages opens on mainnet*, above.
18. ✅ **The test is for a wallet that isn't a mainnet wallet** (the owner, 2026-11-24: "the preprod only test should use a non mainnet wallet").
    - The Seedelf key comes from the recovery phrase and an account index alone, so one phrase has the same key on preprod and on mainnet, and Messages reads and writes with it. A flaw in Messages that nobody has found yet, if it exposed the key, would expose the key that holds that phrase's mainnet funds, though Messages runs on preprod only.
    - The Messages page says it under the switch, as a warning: "Messages are a test for now: use a wallet that isn't your mainnet wallet." That's one line more than 54f′'s item 5 left there.
    - It's advice: nothing checks which wallet it is.
19. ✅ **The freeze starts at mainnet** (the owner, 2026-11-24). What protocol.md §20 freezes is frozen by the release that opens Messages on mainnet, not by 1.10.0.
    - Until then a later release may still change a format, or what the relay's v1 routes take and answer, where a review finds a flaw, and preprod's conversations and its pool may then be reset.
    - §20's rules stay as written; a paragraph at its top says when they start.
20. ✅ **No keep-alive** (the owner, 2026-11-24: "I do not want any issues with the chrome extension because of this. If solving that issue is removing it then so be it."). Chrome's migration guide, "Keep a service worker alive continuously", allows one only on managed enterprise or education devices: "It is not allowed in other cases and the Chrome extension team reserves the right to take action against those extensions in the future." Removed the day it was built; a post's solve still keeps the worker up until it ends, which the guide allows.
    - What it leaves is a stated limit: the relay can tell a wallet that was recently busy from an idle one (*Request timing*, above).
21. **A fallback for the one key: a messaging-only key** (the owner, 2026-11-24). Not built: kept in reserve. "a back up plan for the one key is to have a message account on the private side. A key that gets derived just for messaging and that is it. Then a custom seedelf gets created for that secret and that resultant seedelf becomes the messaging address. It creates one more step if it becomes an issue."
    - It would be a new derivation beside the frozen v1, never a change to it.
    - What it would need settled (the review's notes, not the owner's): a payment sent to the messaging Seedelf would land under the messaging key, so it's swept, or that name isn't shown as payable; a verified reveal of the main Seedelf would still take one proof from the main key; and "message whoever you can pay, by the same name" is given up.
22. ❓ **The test warning's words** (a blind read of the screens, 2026-11-24). "use a wallet that isn't your mainnet wallet" didn't tell the reader that it means another recovery phrase: one phrase has the same key on every network (call 18). Open: the owner's words.
23. ❓ **Who can read a message isn't said** (the same read). Nothing on Messages' screens says it: the word "encrypted" isn't there, but for one refusal's "couldn't encrypt it". Open.
24. ❓ **A tag reads like a checked name** (the same read). A Seedelf's tag is its maker's choice, and "Found: bob" at New message, and the bold tag under "Verified Seedelf", read as a name someone checked. Open.

## Unknowns

- The scan at 15,000 envelopes: 14.6 s in Node and 16.3 s in a Chrome 157 worker, through the bindings (54d, protocol.md §8), and 0.98 and 1.03 ms an envelope in Node again at the gate. Call 16 changed the scan (one subgroup check fewer, one SHA-256 more), so it's to measure again with the rebuilt module. The extension's own service worker and a slow laptop are still to measure (54e) [measure].
- Proof of work's solving times. Measured in 54d (protocol.md §17.3), in slices of 2^16 attempts with a turn of the event loop between:
  - an attempt costs 422 ns in Node 24 and 438 ns in a Chrome 157 worker;
  - the relay's 18 bits take about 0.12 s: 64 solves averaged 0.13 s in Node and 0.12 s in Chrome;
  - first contact's 24 bits take about 7.1 to 7.4 s on average. 16 solves averaged 6.4 s in Node and 10.9 s in Chrome (medians 6.1 and 7.7 s), and the longest of the 32 took 33 s.

  Measured again at the gate, in the worker's own loop in Node: 435 to 469 ns an attempt, so 24 bits take about 7.7 s, and a slice's median 28.5 ms. Still to measure: the extension's own worker and a slow laptop [measure]. The numbers (protocol.md §16.4, §17.4) are to tune with real use.
- The relay's egress at real use against the droplet's monthly ceiling: each wallet downloads every envelope [measure]. Not settled until there's real use. What the code gives: each wallet with a switch on downloads every envelope its pool keeps, once, about 5.2 MB a day at 10,000 short envelopes a day, and 64 MiB for a fresh read of a full mainnet pool; the relay caps what one address reads at 512 MiB a day on mainnet and 256 MiB on preprod. `/health`'s messaging egress is where real use will show.
- The storage quota with history and skipped keys (54e) [measure]. Settled by design at the gate (W7, W11): one budget over what Messages stores, enforced before each write, and a 2 MiB reserve of the extension's storage that no Messages write takes, held by a test whose storage enforces its quota. The stored sizes are to measure again with the rebuilt module, whose skipped keys are stored as runs.
- Whether a 15-minute auto-lock leaves enough unlocked time to sync a 36-hour pool. Settled: a read is at most 16 pages, and the cursor is kept after each read's take, so 36 hours at 10,000 envelopes a day (about 30 pages) take two reads, and a full mainnet pool (256 pages) 16: about 3 minutes with a page of the wallet open (wrong, corrected 2026-11-24: about 8 minutes, the wallet's own pace being 16 pages in any 30 s), 16 on the alarm alone, past which the next unlock goes on from the cursor. A 1- or 5-minute auto-lock catches up over a few unlocks.
