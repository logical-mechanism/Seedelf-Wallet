# Seedelf Messaging: the one-to-one protocol (draft)

The draft for review: conversations, forward secrecy and post-compromise security, built on the v1 envelope of [construction.md](construction.md). Only that envelope is built. Everything else here is a design we refine as we build.

Notation is construction.md's: additive G1 of BLS12-381, [k]P for scalar multiplication, registers (g, v) with v = [x]g.

## 0. Decided (the owner, 2026-11-20)

| Area | Decision |
|---|---|
| Key encapsulation | ECIES on re-randomized registers: the v1 envelope. |
| Long-term key | The Seedelf's own key x. A Seedelf is the handle: "message me at ⟨Seedelf⟩". |
| Identities | The sender of a first message makes both conversation identities. |
| First message | Protected by the recipient's long-term key alone until they reply. No prekeys, so the relay holds no key material. A review asked for prekeys; declined for now, to revisit with users. |
| Relay | Keeps envelopes 36 hours, then deletes them, even though a reader must unlock within that time to receive (§13). Proof of work against spam. Senders' IP addresses are seen, as the data layer already sees them. |
| Local state | Conversations live in the browser. Deleting the wallet's data loses them. |
| Proving who you are | Undecided until users ask for it (§7). |
| Groups | Later, on top of one-to-one sessions. |
| Post-quantum | Later. |

**The first review (2026-11-20)** added:
- the session secret drawn from a first-contact block that every message carries until the first reply (§3);
- the state rules (§4.2);
- duplicates and replays (§5);
- lost messages (§6);
- sender labels (§7);
- the WebAssembly costs (§8);
- what the relay learns (§11).

36 hours stands, despite the unlock trade it raised (§13).

**The second review (2026-11-20),** recorded in [protocol-review.md](protocol-review.md), changed:
- **Who controls R_A.** R_A is now made on R_B's base, and a static DH between them goes into the session secret, so only R_A's key holder can start a session (§2, §3). This also settles which conversations count as continuations (§6), and what the labels may claim (§7).
- **A smaller first-contact block,** so a first message fits the smallest envelope (§3, §9).
- **Requests:** bounded, and holding no state until the reader replies (§3.1).
- **The send and receive state machine** (§4.2).
- **Tombstones** kept until t + 48 hours (§5).
- **"Missing", never "expired"** (§6).
- **What each compromise reveals** (§1.1), and the metadata wording (§11).

## 1. Layers

Every message is three layers deep:

1. **Discovery.** The envelope's register (p, w) is a fresh re-randomization of one of the recipient's registers. The recipient tests [x]p = w (`matches_envelope`), one test per envelope however many conversations they have.
2. **The outer envelope:** v1 as built. ECIES to (p, w), opened with [x]c. Every envelope has this one format, so the relay can't tell a first message from a reply by its layout. It also hides everything inside from everyone without x. Its key is static, so it gives no forward secrecy.
3. **The inner message:** the Double Ratchet (§4), whose keys give forward secrecy and recover after a compromise, as §1.1 says.

### 1.1 What each compromise reveals

Alice wrote first; Bob was written to.

| Compromised | Reveals | Doesn't reveal |
|---|---|---|
| Bob's x_B | Which envelopes are Bob's, and their outer layers: cids, ratchet headers, first-contact blocks. The content of every message Alice sent before she received Bob's first reply. | Anything Bob sent. Anything Alice sent after receiving Bob's first reply. |
| Alice's x_A | Which envelopes are Alice's, and their outer layers. | Any content: the session secret also needs e_A or x_B (§3). |
| Either x | The power to pose as that side in new conversations and in continuations (§6). The Seedelf's funds, since x spends. | The content of existing conversations' later messages. |
| One message key | That message. | Any other. |
| A conversation's current state (the device) | Its stored history and skipped keys, and its messages until a ratchet round trip the attacker only watches. | Messages after that round trip. Nothing protects against an attacker who uses the stolen state to step into the conversation. |
| An old copy of the state | Messages sent after the copy was taken, until the next ratchet step. | Messages before the copy. |
| The browser's data at rest | Nothing without the wallet's password. Records are sealed under a key that exists only while unlocked. While unlocked, everything stored, history included. | |
| The relay | §11's metadata. It can also withhold, delay, reorder and replay envelopes (§5, §6). | Content, recipients, or a message it could forge. |

**Forward secrecy** covers everything Bob sends from his first message on, and everything Alice sends once she has received his first reply. **Recovery after a compromise** needs a full ratchet round trip after it, and an attacker who only watches.

## 2. Identities

- **The handle.** A Seedelf's datum register (g_S, [x]g_S) is public on chain. Alice reads it through the data layer, so the binding from handle to register is only as honest as that read. That's the trusted-source limit already accepted for paying by name.
- **Conversation identities.** Alice makes both:
  - **R_B, "random Bob":** (p₀, w₀) = ([b]g_S, [b]v_S), a re-randomization of Bob's handle register. It's Bob's, though he didn't make it.
  - **R_A, "random Alice":** (p₀, A) with A = [x_A]p₀. It's Alice's own key on R_B's base. It isn't a re-randomization: Alice makes it with her key, which is how she proves she holds it (§3). Her usual scan finds it, as it finds any register of her key.
- **Linking.** No one without x can link a conversation identity to a Seedelf or to another conversation (DDH in G1).
  - Alice knows R_B is Bob's, since she chose him.
  - Bob knows R_A only as a stranger's.
  - Sharing a base links R_A and R_B only to each other, and only inside the encryption.
- **Addressing.** Every message to Bob, the first included, goes to a fresh re-randomization of R_B, and every message to Alice to one of R_A. Each side finds its messages with its usual scan.
- **Which handle.** Bob's Seedelfs all share x, and a re-randomization hides which of them it came from. So Bob can't tell which handle Alice wrote to unless she says. The first-contact block carries an optional `to` field.

## 3. The first message (Alice → Bob)

Alice holds Bob's handle register (g_S, v_S).

1. **Identities and keys.** Alice makes:
   - R_B and R_A (§2);
   - a random 16-byte conversation ID, cid;
   - a session ephemeral e_A, with E_A = [e_A]p₀;
   - a ratchet key s_A, with S_A = [s_A]p₀.
2. **The first-contact block:**

       F = cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | p₀ (48) | A (48) | E_A (48)

   - **t:** when Alice started the conversation, in Unix seconds, big-endian.
   - **to:** a length byte, then the handle's asset name (empty allowed).
   - **replaces:** a length byte, then the cid of a conversation this one continues (§6), or nothing.
   - **w₀ isn't sent:** Bob computes it as [x_B]p₀.
3. **The session secret** comes from F, not from any one envelope:

       SK = HKDF-SHA256(salt = "Seedelf-Messaging|v1|session|salt",
                        ikm  = [e_A]w₀ ‖ [x_A]w₀,
                        info = "Seedelf-Messaging|v1|session|SK" ‖ F)

   Bob computes the same input as [x_B]E_A ‖ [x_B]A.
   - **The second half is a static DH between R_A and R_B,** as X3DH's DH1 is. Only the holder of A's key can compute it.
   - So a first message Bob can read was written by whoever controls R_A. A writer naming a register they don't control can't start a session, so Bob's replies can't be sent to a third party's mailbox.
   - It's implicit: there's no proof to carry, and nothing Bob could show anyone else.
4. **Starting the ratchet,** as the Double Ratchet specification's `RatchetInitAlice`. R_B stands in for a signed prekey: Bob's initial ratchet key pair is (x_B, w₀) on the base p₀, which is the "long-term key only" decision. Alice computes (RK, CKs) = KDF_RK(SK, [s_A]w₀).
5. **Every message until Alice receives Bob's first reply** is a first-contact message:

       0x01 | F | ratchet header (56) | ratchet ciphertext

   - **The ratchet header** is S_A ‖ PN ‖ N: a 48-byte point and two big-endian u32 counters.
   - **The associated data** is cid ‖ R_A ‖ R_B ‖ ratchet header, with R_A = p₀ ‖ A and R_B = p₀ ‖ w₀. It binds both identities to every message, as X3DH's associated data does.
   - **Sending:** the message is padded (§9) and sealed in an outer envelope to a fresh re-randomization of R_B.
   - F, E_A and S_A stay the same in each. Alice switches to `0x02` once a reply from Bob decrypts.

**Bob's side,** for a `0x01` whose cid he doesn't know:
1. Refuse it if t is more than 48 hours old or more than an hour ahead (§5).
2. Check that p₀, A, E_A and S_A are canonical, in G1 and not O.
3. Compute w₀ = [x_B]p₀, then SK from [x_B]E_A ‖ [x_B]A. Run `RatchetInitBob(SK, (x_B, w₀))` and decrypt, on a copy of the state (§4.2).
4. If it authenticates, it's a request (§3.1). If anything fails, nothing is kept.

- **Whichever message arrives first starts the session.** Its counter N shows how many came before it.
- **Until Alice receives Bob's first reply,** what she sends is keyed from secrets x_B alone can rebuild. There's no forward secrecy for those messages against a later theft of x_B (§1.1).

### 3.1 Requests

A conversation someone else started is a request until the reader replies.

- **What it keeps:** F and the `0x01` messages as they arrived, as bytes, and no ratchet state. The wallet decrypts them in memory to show them, and builds the state from F when the reader replies. `RatchetInitBob` is deterministic in F and x_B, so nothing is lost by waiting.
- **The bounds:** at most 50 requests and 256 KiB of them per network (§13). Past either, the oldest go first. A later `0x01` with a request's cid and F joins it within the bounds.
- **Replying** accepts the request: it becomes a conversation (§4).
- **Deleting** leaves a tombstone (§5).
- **Ignoring** leaves the request until the bounds push it out.
- A request never notifies its sender of anything.

## 4. Session messages

### 4.1 The ratchet's choices

The Double Ratchet runs as specified, with these choices:

| Piece | Choice |
|---|---|
| DH | G1, on the conversation's base p₀: a key pair is (s, [s]p₀), and DH(s, P) = [s]P, compressed. A received point must be canonical, in G1 and not O. |
| KDF_RK(rk, dh) | HKDF-SHA256(salt = rk, ikm = dh, info = "Seedelf-Messaging\|v1\|ratchet\|root"), 64 bytes: the new root key, then a chain key. |
| KDF_CK(ck) | HMAC-SHA256(ck, 0x01) is the message key; HMAC-SHA256(ck, 0x02) is the next chain key. |
| ENCRYPT(mk, m, ad) | A fresh random 16-byte salt; key ‖ nonce = HKDF-SHA256(salt = salt, ikm = mk, info = "Seedelf-Messaging\|v1\|ratchet\|message"), 44 bytes; the output is salt ‖ AES-256-GCM(key, nonce, ad, m). |
| Header encryption | None: the outer layer already hides the header from everyone without x. |
| MAX_SKIP | 1,000 skipped keys per chain, each deleted 48 hours after it was stored. No message derives more than MAX_SKIP keys. |

Inside the outer layer, a session message is:

    0x02 | cid (16) | ratchet header (56) | ratchet ciphertext

The associated data is cid ‖ R_A ‖ R_B ‖ ratchet header, as in §3. It goes to a fresh re-randomization of the recipient's conversation identity.

**The recipient:**
1. Scans.
2. Opens the outer layer with [x]c.
3. Looks up the cid.
4. Runs the ratchet.

### 4.2 The state machine

**Reusing a message key is the one mistake the ratchet can't survive.** In an extension it's easy to make: two screens sending at once, or a worker stopped mid-send.

- **One queue.** The worker's messaging service runs every operation on conversation state in one queue: sends, receives, replies to requests and deletions. No two operations read the same state.
- **Scanners never write.** Anything scanning in parallel (offscreen documents, if §13 needs them) returns indexes and nothing else.
- **One record per conversation, written whole.** The ratchet state and the outbox live in the same record, so one write moves both: it happens or it doesn't. No IndexedDB transaction is needed.

**Sending:**
1. In the queue: advance the sending chain, build the envelope, and write the record with the new state and the envelope in the outbox, marked `pending`.
2. Out of the queue: solve the proof of work and post the stored bytes.
3. In the queue: mark it `posted` once the relay takes it or says it already has it.

After a restart, every `pending` envelope is posted again, the same bytes. A message key is never used for anything else.

**Receiving:**
1. In the queue: decrypt against a copy of the state. Skipped keys, ratchet steps and counters change only the copy. The copy is kept only if the message authenticates, as the Double Ratchet specification requires.
2. Write the record with the new state and the message.
3. Advance the scan's cursor once the page is done. A restart between 2 and 3 decrypts the envelope again: its key is gone, so it's dropped as a duplicate (§5).

**What the salt does and doesn't do.** Even a message key used twice gives two unrelated AES-GCM keys and nonces, unless the random source failed too. That protects confidentiality, not correctness: the reader still takes one message per key, and the second is lost. It's a net under the state machine, not a substitute for it.

**Restoring old storage** (a copied browser profile) rolls a conversation back. Its next messages reuse counters the other side has already used, and they're dropped. The salt keeps that from becoming a leak, and the conversation may need starting again (§6).

## 5. Duplicates and replays

1. **A `0x01` for a cid the reader has,** as a conversation or a request, counts only if its F is the stored F. Then it's a ratchet message of that conversation. Otherwise it's dropped. It never starts the conversation again.
2. **A `0x01` for an unknown cid** is refused if its t is more than 48 hours old or more than an hour ahead of the reader's clock.
3. **Deleting a conversation or request keeps its cid as a tombstone until t + 48 hours,** with t from its F.
   - That's exactly as long as rule 2 could accept one of its `0x01`s, and no longer is needed: after t + 48 hours, rule 2 refuses them.
   - A tombstone timed from the deletion could expire up to an hour early, when t ran ahead of the reader's clock.
4. **A ratchet message whose key was used or deleted is dropped.** A replayed session message does nothing.
5. **The relay drops an envelope whose exact bytes it holds.** A re-post after its 36 hours, with new proof of work, meets rules 1–4. Only a holder of the reader's x could re-wrap an inner message in new bytes.
6. **Both sides writing first at once makes two conversations.** Each is valid.
7. **No separate envelope ID is needed.** The cid with F, and the ratchet's counters, identify every message.

The reader's clock judges rules 2 and 3. A clock set far wrong moves the window with it.

## 6. Lost messages and lost conversations

- **A gap in the counters is a missing message.** It may have expired, been withheld by the relay, or not arrived yet, and the wallet can't tell which. So the wallet says "1 message missing", never "expired".
- **A message the ratchet can't reach is dropped:**
  - one more than MAX_SKIP keys ahead;
  - one whose skipped key passed its 48 hours.

  When a conversation's messages keep failing this way, the wallet says the conversation can't continue, and offers to start again.
- **A message that doesn't authenticate is dropped** without a word, since anyone can address an envelope to a handle.
- **A lost conversation** (the wallet's data deleted, or a new browser) can't be read. An `0x02` for an unknown cid shows as a message from a conversation this browser no longer has.
- **Continuing.** A new conversation is shown as continuing an old one only if:
  - its `replaces` names the old cid;
  - its p₀ is the old p₀;
  - its two public values, A and the reader's own [x]p₀, are the old A and w₀ in either order.

  The static DH in the session secret (§3) then proves the writer holds the old key for their side.
  - Either side that still has the conversation can restart it this way, with the old identities.
  - Anything else with `replaces` shows as a new request that says it continues the old one, unverified. That includes a side that lost its state and writes fresh to a handle.

## 7. Who a sender is

What the wallet says about the other side:

| Label | When | What it means |
|---|---|---|
| ⟨handle⟩ | The reader wrote first, to that handle | The other side holds that handle's key, as the chain read gave it. Only that key opens the first message. |
| Unknown sender | The reader was written to | The other side controls this conversation's R_A (§3), and nothing more. |
| Says they're ⟨handle⟩ (unverified) | A message names a handle | Nothing: a claim. No message's content changes a label. |
| Continues ⟨conversation⟩ | §6's match | The same keys as the old conversation. |
| Says it continues ⟨conversation⟩ (unverified) | A `replaces` without §6's match | Nothing. |
| Verified ⟨handle⟩ | Only with a future handle proof | The writer holds that handle's key. |

`to` shows which of the reader's handles a first message named.

- **A future handle proof must be bound to F.** For instance, a Chaum–Pedersen proof that A and the handle's register share a key, with F in its challenge. With A on p₀ and the static DH, a proof lifted from another conversation can't start a session anyway; binding it to F makes that explicit. Two designs stay open until users ask for one:
  - **A plain proof** Bob can show to anyone: evidence of who wrote to him.
  - **A designated-verifier proof** that convinces only Bob, because Bob could have made it himself. It keeps conversations deniable, as Signal's are.
- **Nothing in a message authorizes a transaction.** A payment request or an escrow invitation, if one is ever a message type, opens the ordinary Send or escrow screen filled in, under the sender's label, and is confirmed there like any other. These are labels, not blocks: the user decides.

## 8. What each message costs

Measured on the same machine as the README: an Intel Core i5-12400F, one thread. The WebAssembly figures come from a scratch harness built the way the wallet builds its module (wasm-bindgen 0.2.128, clang 21, the `wasm-release` profile) and run in Node 24, whose V8 is Chrome's engine. The wallet's size-optimized profile measured the same as `-O3`.

| Step | Native | WebAssembly |
|---|---|---|
| Scan an envelope (`matches_envelope`) | 0.18 ms | 1.02 ms |
| Full parse | 0.16 ms | 0.88 ms |
| Open a match (full parse, then decrypt) | 0.31 ms | 1.77 ms |
| Encrypt an envelope | 0.31 ms | 2.2 ms |

**Scale:**
- A 36-hour pool at 10,000 envelopes a day (about 15,000) takes about 2.7 s to scan natively and about 15 s in WebAssembly on a fresh sync.
- Keeping up scans only what's new, about 10 s of WebAssembly work a day at that rate.
- **The WebAssembly scan is the scaling limit.**
- The wallet's own `isOwned` row test, measured at 0.73 ms a row in the module (wasm/README.md), agrees with these figures: it checks one point where the scan checks two.
- These figures are Node's, on one fast desktop. §13 lists what to measure in the extension itself before the figures are relied on.

**Per matched envelope,** a conversation's ratchet adds:
- one multiplication for the outer layer;
- three when a message starts a ratchet step (a new key pair and two DH);
- symmetric work.

**A conversation's first message:**
- **Sending** costs twelve multiplications: the outer envelope's four, p₀ and w₀, A, E_A and [e_A]w₀, [x_A]w₀, and S_A and [s_A]w₀. Each later `0x01` costs only the outer four.
- **Receiving** costs eight: discovery, the outer layer, w₀, [x_B]E_A, [x_B]A, and the ratchet step's three. That's plus the subgroup checks on p₀, A, E_A and S_A.

## 9. Size and padding

- **Overhead:**
  - The outer layer adds 161 bytes.
  - Inside it, an `0x02` adds 105 bytes: the type, the cid, the ratchet header, and the ratchet ciphertext's 16-byte salt and 16-byte tag.
  - An `0x01` adds 259–307: the same, with F's 170–218 in place of the cid.
- **Padding:** the inner message is padded to fill one of four envelope sizes: 512 bytes, 2, 8 and 32 KiB. 32 KiB is the largest, under the relay's 64 KiB request limit.
  - The method: 0x80, then zeros, stripped on reading.
  - The smallest envelope holds 350 inner bytes: an `0x02` with up to 245 bytes of text, or an `0x01` with up to 91 (43 with a full `to` and `replaces`).
- **What size still says:** a first message with 92–245 bytes of text lands one size up from a reply with the same text. The relay sees only the size, which an ordinary longer reply shares. Doubling the smallest size would hide that, at the cost of doubling the pool for every short message; it's documented instead.

## 10. The relay

Phase 2 settles the details; the protocol needs only this:

- **The relay stores bytes.** It keeps no recipient, sender, account or key.
- **Size:** at most 32 KiB an envelope.
- **Envelopes are deleted after 36 hours.** Deleting doesn't unsend: anyone who downloaded the pool keeps copies. What protects old envelopes is forward secrecy, not deletion.
- **Proof of work.** Every envelope carries proof of work over its own bytes, so the work can't be reused. The difficulty is the relay's to raise.
- **Duplicates.** The relay drops an envelope whose bytes it already holds.
- **Clients download everything after their cursor,** in pages. At 10,000 envelopes a day, 36 hours is about 15,000 envelopes, roughly 7.5 MB at 0.5 KiB each.

**What 36 hours means:**
- **A reader who doesn't unlock the wallet within 36 hours misses whatever was sent meanwhile,** first messages included, and the sender can't tell. Discovery needs x, which is available only while the wallet is unlocked (§13).
- **The ratchet survives the gap:** the counters let the next message decrypt, and the wallet shows what's missing (§6).
- **A message shows as sent, with when it expires, never as delivered.** Delivery receipts would be messages of their own: possible later.

## 11. What the relay and others learn

**From the cryptography:** an envelope's bytes say nothing of whom it's for (DDH in G1), and nothing of what's inside without the reader's x.

**From the network,** which no cryptography here hides, the relay and anyone watching learn:
- the IP address and time each envelope is posted, its size, and its proof of work;
- each client's IP address and when it syncs, so when each wallet is online;
- timing. A reply posted soon after a message hints at a conversation, more so when few wallets are online. Over time such hints can link the two sides of a conversation.

**What the relay can also do:** withhold, delay, reorder or replay envelopes (§5, §6). It can't read, address or forge them.

**What's claimed and what isn't:** no envelope names its recipient or sender. There's no claim of anonymity against an observer who watches the whole network.

**The other side of a conversation learns:**
- the writer of a first message learns the handle they wrote to;
- the one written to learns a stranger's conversation identity, and whatever the stranger chooses to say.

**A holder of the reader's x learns** §1.1's first two rows.

## 12. Local state

**Per conversation:**
- cid, F, R_A, R_B and t.
- The other side's handle, if `to` or a claim named one.
- The ratchet state: RK, CKs, CKr, DHs, DHr, Ns, Nr, PN, and the skipped keys.
- The outbox (§4.2).
- The message history.

**Kept apart from conversations:**
- Requests, as §3.1 bounds them.
- Tombstones until their t + 48 hours (§5).
- The scan's cursor.

**Storage and loss:**
- It's stored in the browser, encrypted under the wallet's vault key, and written only through the worker's messaging queue (§4.2).
- Deleting the wallet's data deletes it.
- Restoring from the recovery phrase brings back x, so new first messages work and old handles still receive. It doesn't bring back any conversation.

## 13. Open, to settle as we build

**Unlocking versus the expiry: decided, 36 hours (the owner, 2026-11-20).** Discovery needs x, and x is the spending key, available only while the wallet is unlocked. So a message reaches its reader only if they unlock within 36 hours, and the wallet says so. The alternatives stay on record, to revisit with users:
- **A longer expiry.** Seven days is about 70,000 envelopes at 10,000 a day, about 70 s of WebAssembly scanning on a fresh sync.
- **A discovery key that stays available while locked.** It can't be the Seedelf's key, so handles would need a messaging register of their own, which reopens §0's choice of key.

**Open:**
- **Proof of work:** the function (a plain hash, or a memory-hard one against GPUs) and the starting difficulty, measured in WebAssembly. Also its economics: the relay's storage is its rate cap times 36 hours.
- **The bounds on requests** (§3.1: 50 and 256 KiB) and the sizes (§9: 512 bytes to 32 KiB), checked against real use.
- **MAX_SKIP and the 48-hour lifetime of skipped keys.**
- **How long a browser keeps message history,** and whether the user picks.
- **To measure in the extension itself,** before §8's figures are relied on:
  - a 15,000-envelope scan in the service worker, in 200-envelope turns, stopped and resumed by its cursor;
  - the same on a slow laptop;
  - the worker's memory during it;
  - proof-of-work solving times;
  - a parallel scan from offscreen documents, if the single thread falls short;
  - the storage used by a hundred conversations with their skipped keys.
- **Test vectors for the session layer,** checked by an independent implementation as v1's were.
- **A model of §3 to §6** in a protocol verifier (ProVerif or Tamarin) before mainnet, then an outside review.

## 14. Against Signal

| | Signal | Here |
|---|---|---|
| What the server knows | Each message's recipient, and partly its sender | The IP address that posted each envelope, and when; never whom it's for (§11) |
| First message | Forward-secret through prekeys | Long-term key alone until Alice receives the first reply (§1.1) |
| Later messages | Double Ratchet | Double Ratchet: forward secrecy and recovery as §1.1 says |
| Authentication at the start | X3DH's DHs, with signed prekeys | Implicit, by the static DH in SK (§3); Bob learns a conversation identity, not a person |
| Ratchet header | Plain, or encrypted in the header-encryption variant | Inside the outer layer |
| Identity | A phone number or username, with safety numbers | A Seedelf handle. The sender is anonymous unless they claim or prove one. |
| Deniability | Yes | Yes, unless a proof Bob can show others is added (§7) |
| Message lifetime on the server | Until delivered, with a limit | 36 hours, delivered or not |
| Groups | Sender Keys | Later |
| Post-quantum | Yes (PQXDH and the ratchet's additions) | Later |
| Multi-device | Yes | No |

## 15. Phases

| Phase | What |
|---|---|
| 1 | Done: the v1 envelope, and its scan. |
| 2 | The relay: storage, the 36-hour expiry, proof of work, duplicates, the cursor. |
| 3 | Sessions: §3 to §6 in this crate, with vectors, property tests and the protocol model. |
| 4 | The wallet: WebAssembly bindings, the worker's queue, chunked scanning, encrypted local state, requests, a Messages screen, sender labels, and "message me at ⟨Seedelf⟩". |
| Later | Proving who you are, groups, post-quantum, delivery receipts, prekeys if users want them. |
