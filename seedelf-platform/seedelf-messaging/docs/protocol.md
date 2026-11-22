# Seedelf Messaging: the one-to-one protocol (draft)

The draft for review: conversations, forward secrecy and post-compromise security, built on the v1 envelope of [construction.md](construction.md). The envelope is built, and so is the session layer of §3 to §6, in this crate's `session` module (chunk 54's 54a). §16 fixes every byte and rule the build decided. The relay is built too, in the data layer (54c), and §17 fixes what it takes and gives. A first message now carries a stamp and a proof that its base comes from the handle it names, and every envelope is bound to its conversation (calls 12 and 13, 2026-11-21), so no writer can learn whether two Seedelfs are one wallet's (§2). The wallet's worker is built too (54e), and §18 fixes what a message's plaintext holds. The screens (54f) add the verified reveal: the side that wrote first may show the other one of its Seedelfs, by a proof only the reader can check (§19; call 15, 2026-11-21). The protocol model is still to come, and the design is refined as it's built.

Notation is construction.md's: additive G1 of BLS12-381, [k]P for scalar multiplication, registers (g, v) with v = [x]g.

## 0. Decided (the owner, 2026-11-20)

| Area | Decision |
|---|---|
| Key encapsulation | ECIES on re-randomized registers: the v1 envelope. |
| Long-term key | The Seedelf's own key x. A Seedelf is the handle: "message me at ⟨Seedelf⟩". |
| Identities | The sender of a first message makes both conversation identities. |
| First message | Protected by the recipient's long-term key alone until they reply. No prekeys, so the relay holds no key material. A review asked for prekeys; declined for now, to revisit with users. |
| Relay | Keeps envelopes 36 hours, then deletes them, even though a reader must unlock within that time to receive (§13). Proof of work against spam. Senders' IP addresses are seen, as the data layer already sees them. The wallet uses one relay, which prices each address's posts by its recent traffic, and says so (§10). |
| Local state | Conversations live in the browser. Deleting the wallet's data loses them. |
| Proving who you are | The side that wrote first may show one of its Seedelfs once the other side has replied, by a proof that convinces only the reader (§19; call 15, 2026-11-21). A proof the reader could show others stays undecided until users ask for it (§7). |
| First-contact stamp | A first message to a new conversation carries proof of work over its first-contact block, 2²⁴ attempts, which the reader checks before computing any key (§3; call 12, 2026-11-21). |
| Unlinkable handles | A first message proves its base re-randomizes the handle it names, and every envelope goes to its conversation identity re-randomized by a scalar from the message key, which the reader checks (§2; call 13, 2026-11-21). |
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

**Building the session layer (54a)** decided what the reviews left open, each marked [choice] in §16, and found one thing the wallet must handle: a first message is refused once its t is 48 hours old, so a conversation nobody has read within 48 hours of its start can never begin, however many first messages follow (§16.4, "A first message's life"). The vectors were reproduced by an implementation written from §16 alone (§16.6).

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
- **Addressing.** Every message to Bob, the first included, goes to R_B re-randomized by a scalar the message derives (§4.1), fresh each time, and every message to Alice to R_A likewise. Each side finds its messages with its usual scan.
- **Which handle.** Bob's Seedelfs all share x, and a re-randomization hides which of them it came from. So the first-contact block names the handle in `to` and proves the base re-randomizes it (§3). `to` is verified, not claimed.
- **Linking two handles.** Two registers of one key add up to a register of that key: (g₁ + g₂, v₁ + v₂) belongs to x whenever (g₁, v₁) and (g₂, v₂) both do, and to no one otherwise.
  - So a writer who aims a message at the sum of two Seedelfs' registers, or at a second Seedelf's register while naming the first, learns from any reply that both are one wallet's. Bob's scan matches either, since every register of his key is his, and the reader can't see it happen: every point is a multiple of every other.
  - **Two rules close it.** The base must be a re-randomization of the one handle named, which the proof in F shows (§3). And every envelope goes to its conversation identity re-randomized by a scalar derived from the message key, which the reader checks once the message decrypts (§4.1), so an envelope aimed anywhere else is dropped.
  - Each is needed: with the proof alone, a writer could still aim the envelope of an honest first message, or of any later message, at the sum or at another handle.
  - Either failure is dropped without a word, as a message that doesn't authenticate is. Nothing tells the writer.
  - Seedelf payments share the property, at the cost of a payment and a spend to watch for. That's outside messaging.

## 3. The first message (Alice → Bob)

Alice holds Bob's handle register (g_S, v_S).

1. **Identities and keys.** Alice makes:
   - R_B and R_A (§2), with R_B = ([b]g_S, [b]v_S);
   - a random 16-byte conversation ID, cid;
   - a session ephemeral e_A, with E_A = [e_A]p₀;
   - a ratchet key s_A, with S_A = [s_A]p₀.
2. **The first-contact block:**

       F = cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | p₀ (48) | A (48) | E_A (48) | proof (0 or 64)

   - **t:** when Alice started the conversation, in Unix seconds, big-endian.
   - **to:** a length byte, then the handle's asset name. Empty only in a continuation (§6).
   - **replaces:** a length byte, then the cid of a conversation this one continues (§6), or nothing. Required when `to` is empty.
   - **proof:** present exactly when `to` is. A Schnorr proof that p₀ = [b]g_S for the handle (g_S, v_S) named in `to`, with the rest of F in its challenge (§16.2): 64 bytes. Only a writer who re-randomized that one handle can make it, so it makes `to` verified, and keeps p₀ off the sum of two handles (§2).
   - **w₀ isn't sent:** Bob computes it as [x_B]p₀.
3. **The stamp.** Alice finds an 8-byte nonce such that SHA-256 of F's digest and the nonce has at least 24 leading zero bits (§16.2, §16.4): about 7 seconds of a browser's time on average.
   - It prices a stranger's first message to one reader, which the relay's price can't target: the relay can't tell first messages from replies.
   - F holds the reader's base and its proof, and is bound into SK, so the work can't be moved to another reader or another conversation.
   - Replies and later messages pay nothing more.
4. **The session secret** comes from F, not from any one envelope:

       SK = HKDF-SHA256(salt = "Seedelf-Messaging|v1|session|salt",
                        ikm  = [e_A]w₀ ‖ [x_A]w₀,
                        info = "Seedelf-Messaging|v1|session|SK" ‖ F)

   Bob computes the same input as [x_B]E_A ‖ [x_B]A.
   - **The second half is a static DH between R_A and R_B,** as X3DH's DH1 is. Only the holder of A's key can compute it.
   - So a first message Bob can read was written by whoever controls R_A. A writer naming a register they don't control can't start a session, so Bob's replies can't be sent to a third party's mailbox.
   - It's implicit: there's no proof to carry, and nothing Bob could show anyone else.
5. **Starting the ratchet,** as the Double Ratchet specification's `RatchetInitAlice`. R_B stands in for a signed prekey: Bob's initial ratchet key pair is (x_B, w₀) on the base p₀, which is the "long-term key only" decision. Alice computes (RK, CKs) = KDF_RK(SK, [s_A]w₀).
6. **Every message until Alice receives Bob's first reply** is a first-contact message:

       0x01 | F | stamp (8) | ratchet header (56) | ratchet ciphertext

   - **The ratchet header** is S_A ‖ PN ‖ N: a 48-byte point and two big-endian u32 counters.
   - **The associated data** is cid ‖ R_A ‖ R_B ‖ ratchet header, with R_A = p₀ ‖ A and R_B = p₀ ‖ w₀. It binds both identities to every message, as X3DH's associated data does.
   - **Sending:** the message is padded (§9) and sealed in an outer envelope to R_B re-randomized by the message's outer scalar (§4.1).
   - F, the stamp, E_A and S_A stay the same in each. Alice switches to `0x02` once a reply from Bob decrypts.

**Bob's side,** for a `0x01` whose cid he doesn't know. Every point was checked, canonical, in G1 and not O, when the envelope was opened. Then, in order, each check before anything costlier:
1. Refuse it if t is more than 48 hours old or more than an hour ahead (§5).
2. Refuse it if the stamp shows less than 24 bits of work. Nothing about F is computed before this.
3. With a `to`: refuse it unless `to` names one of Bob's handles and the proof verifies against a register that handle has held. Without one: refuse it unless it's a verified continuation of one of Bob's conversations (§6).
4. Compute w₀ = [x_B]p₀, then SK from [x_B]E_A ‖ [x_B]A. Run `RatchetInitBob(SK, (x_B, w₀))` and decrypt, on a copy of the state (§4.2). Check the envelope went to R_B re-randomized by the message's outer scalar (§4.1).
5. If it authenticates, it's a request (§3.1). If anything fails, nothing is kept.

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
| The envelope's register | The other side's conversation identity re-randomized by the message's outer scalar o, derived from the message key and the ratchet salt (§16.2), not a random b. The reader checks the envelope's generator is [o]p₀ once the message decrypts. It binds every envelope to its conversation, so none can be aimed at another register of the reader's (§2). |
| MAX_SKIP | 1,000 skipped keys per chain, each deleted 48 hours after it was stored. No message derives more than MAX_SKIP keys. |

Inside the outer layer, a session message is:

    0x02 | cid (16) | ratchet header (56) | ratchet ciphertext

The associated data is cid ‖ R_A ‖ R_B ‖ ratchet header, as in §3. It goes to the recipient's conversation identity re-randomized by its outer scalar.

**The recipient:**
1. Scans.
2. Opens the outer layer with [x]c.
3. Looks up the cid.
4. Runs the ratchet, then checks the envelope's register against the message's outer scalar.

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
2. **A `0x01` for an unknown cid** is refused if its t is more than 48 hours old or more than an hour ahead of the reader's clock, if its stamp shows too little work, or if it neither proves its base re-randomizes one of the reader's handles nor verifiably continues one of the reader's conversations (§3).
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
  - Either side that still has the conversation can restart it this way, with the old identities, and with no `to`: the old base has no handle to prove.
  - A first message with `replaces` that names a handle, with its proof, shows as a new request that says it continues the old one, unverified. That's how a side that lost its state writes fresh to a handle.
  - One without a handle that isn't §6's match is refused: its base would be proven by nothing.

## 7. Who a sender is

What the wallet says about the other side:

| Label | When | What it means |
|---|---|---|
| ⟨handle⟩ | The reader wrote first, to that handle | The other side holds that handle's key, as the chain read gave it. Only that key opens the first message. |
| Unknown sender | The reader was written to | The other side controls this conversation's R_A (§3), and nothing more. |
| Says they're ⟨handle⟩ (unverified) | A message names a handle | Nothing: a claim. No message's content changes a label, and the wallet never shows one: it would be a tool for phishing. |
| Continues ⟨conversation⟩ | §6's match | The same keys as the old conversation. |
| Says it continues ⟨conversation⟩ (unverified) | A `replaces` without §6's match, in a first message from a handle | Nothing. |
| Verified ⟨handle⟩ | The reader was written to and replied, and the other side then showed that handle with §19's proof, for the register the chain gives it now | The other side holds that handle's key, as a fresh read of the chain gave it when the reveal was checked. It convinces the reader alone. |

`to` shows which of the reader's handles a first message was written to: verified by its proof (§3), not claimed.

- **The handle proof is designated-verifier, and bound to the conversation** (§19, call 15, the owner, 2026-11-21): a proof that A and the handle's register share a key, or that its maker knows w₀'s key, with the conversation's ID and both identities in its challenge. Bob could have made it himself, so it convinces only him, and conversations stay deniable, as Signal's are. It proves someone holding that Seedelf's key is writing, not who a person is: its use is tying a conversation to a Seedelf Bob already knows.
  - **A plain proof** Bob could show to anyone, evidence of who wrote to him, stays open until users ask for one.
- **Nothing in a message authorizes a transaction.** A payment request or an escrow invitation, if one is ever a message type, opens the ordinary Send or escrow screen filled in, under the sender's label, and is confirmed there like any other. These are labels, not blocks: the user decides.

## 8. What each message costs

Measured on the same machine as the README: an Intel Core i5-12400F, one thread. The WebAssembly figures come from a scratch harness built the way the wallet builds its module (wasm-bindgen 0.2.128, clang 21, the `wasm-release` profile) and run in Node 24, whose V8 is Chrome's engine. The wallet's size-optimized profile measured the same as `-O3`.

| Step | Native | WebAssembly |
|---|---|---|
| Scan an envelope (`matches_envelope`) | 0.18 ms | 1.02 ms |
| Full parse | 0.16 ms | 0.88 ms |
| Open a match (full parse, then decrypt) | 0.31 ms | 1.77 ms |
| Encrypt an envelope | 0.31 ms | 2.2 ms |

**In the wallet's own module** (54d), through its bindings and called as the worker will call them: `messagingScan` takes 200 envelopes a call as JSON of hex, with a turn of the event loop between calls. Measured with `node scale.mjs messaging` ([seedelf-wasm's README](../../seedelf-web-wallet/wasm/README.md)) on the same machine, 2026-11-21, and in a module worker in headless Chrome 157, the engine the extension's service worker runs, with a scratch harness running the same steps:

| Step | Node 24 | Chrome 157, a worker |
|---|---|---|
| Scan an envelope | 0.97 ms | 1.09 ms |
| Scan 15,000 envelopes | 14.6 s | 16.3 s |
| Open a match (`messagingOpen`) | 1.9 ms | 2.1 ms |
| Receive a message that takes a ratchet step, with its record | 5.7 ms | 6.1 ms |

The bindings' JSON and hex cost nothing measurable beside the scalar multiplication: the scan matches the scratch harness's 1.02 ms.

**Scale:**
- A 36-hour pool at 10,000 envelopes a day (about 15,000) takes about 2.7 s to scan natively and about 15 s in WebAssembly on a fresh sync: 14.6 s in the wallet's module in Node, 16.3 s in Chrome's worker.
- Keeping up scans only what's new, about 10 s of WebAssembly work a day at that rate.
- **The WebAssembly scan is the scaling limit.**
- The wallet's own `isOwned` row test, measured at 0.73 ms a row in the module (wasm/README.md), agrees with these figures: it checks one point where the scan checks two.
- These figures are Node's, on one fast desktop. §13 lists what to measure in the extension itself before the figures are relied on.

**Per matched envelope,** a conversation's ratchet adds:
- one multiplication for the outer layer;
- one to check the envelope's register, [o]p₀;
- three when a message starts a ratchet step (a new key pair and two DH);
- symmetric work.

**A conversation's first message:**
- **Sending** costs thirteen multiplications: the outer envelope's four, p₀ and w₀, A, E_A and [e_A]w₀, [x_A]w₀, S_A and [s_A]w₀, and the proof's [k]g_S. Each later `0x01` costs only the outer four. The stamp adds 2²⁴ SHA-256 attempts on average, about 7 s of WebAssembly (§16.4).
- **Receiving** costs eleven: discovery, the outer layer, the proof's two, w₀, [x_B]E_A, [x_B]A, the ratchet step's three and the envelope's check. That's plus the subgroup checks on p₀, A, E_A and S_A, and two SHA-256 for the stamp.

## 9. Size and padding

- **Overhead:**
  - The outer layer adds 161 bytes.
  - Inside it, an `0x02` adds 105 bytes: the type, the cid, the ratchet header, and the ratchet ciphertext's 16-byte salt and 16-byte tag.
  - An `0x01` adds F and the stamp in place of the cid: 332–379 bytes from a handle (F's 235–282), 283 for a continuation (F's 186).
- **Padding:** the inner message is padded to fill one of four envelope sizes: 512 bytes, 2, 8 and 32 KiB. 32 KiB is the largest, under the relay's 64 KiB request limit.
  - The method: 0x80, then zeros, stripped on reading.
  - The smallest envelope holds 350 inner bytes: an `0x02` with up to 245 bytes of text; a continuation's `0x01` with up to 67; a first message from a handle with up to 18 under a 1-byte `to`.
  - A first message to a Seedelf, whose name is 32 bytes, never fits 512 bytes: it's at least 2 KiB, which holds 1,523 bytes of text (1,507 with `replaces`).
- **What size still says:** a first message to a Seedelf is a 2 KiB envelope, a size the relay also sees for every reply of 246 to 1,781 bytes of text, but never for a short one. So it can tell a first message from a short reply, not from a longer one. Doubling the smallest size would hide that, at the cost of doubling the pool for every short message; it's documented instead.

## 10. The relay

§17 fixes the details as built (54c); the protocol needs only this:

- **The relay stores bytes.** It keeps no recipient, sender, account or key.
- **Size:** exactly one of §9's four sizes, so at most 32 KiB an envelope.
- **Envelopes are deleted after 36 hours.** Deleting doesn't unsend: anyone who downloaded the pool keeps copies. What protects old envelopes is forward secrecy, not deletion.
- **One relay.** The wallet uses one relay; choosing another isn't offered right now. That's what lets the relay price posts by where they come from.
- **Proof of work, priced by traffic** (2026-11-20). Every envelope carries proof of work over its own bytes, so the work can't be reused. The price is per sending address:
  - a light base, which someone sending a few messages an hour never notices;
  - rising with the address's posts over a short recent window, so one source posting hundreds pays more for each;
  - IPv6 counted by prefix, a /64 at least, so one host can't spread over fresh addresses;
  - a global floor that rises when the whole pool grows unusually fast, against floods spread over many addresses;
  - a ceiling an honest browser can meet; past it a post is refused, not priced.

  The relay names the price it wants, and a post refused for too little work is solved again for the same envelope bytes. It's a price, not a cap, so an honest user behind the same address as a flooder still gets through, only slower. The counts live in memory for their window only and are never logged.
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
- for a short window, how many envelopes each address has posted, which the relay keeps in memory to price posts (§10) and never logs;
- each client's IP address and when it syncs, so when each wallet is online;
- timing. A reply posted soon after a message hints at a conversation, more so when few wallets are online. Over time such hints can link the two sides of a conversation.

**What the relay can also do:** withhold, delay, reorder or replay envelopes (§5, §6). It can't read, address or forge them.

**What's claimed and what isn't:** no envelope names its recipient or sender, and no writer can learn from a reader's replies whether two Seedelfs are one wallet's (§2). There's no claim of anonymity against an observer who watches the whole network.

**What the wallet and the privacy policy say:** the relay can't read messages or tell whom they're for. It sees the IP address that posts each envelope and when, and counts each address's recent posts, in memory, to stop floods.

**The other side of a conversation learns:**
- the writer of a first message learns the handle they wrote to;
- the one written to learns a stranger's conversation identity, and whatever the stranger chooses to say;
- if the writer reveals one of its Seedelfs (§19), the reader learns that Seedelf, and nothing it can prove to anyone else.

**A holder of the reader's x learns** §1.1's first two rows.

## 12. Local state

**Per conversation:**
- cid, F, R_A, R_B and t.
- The other side's Seedelf: the one this side wrote to, or the one the other side revealed, once verified (§19).
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
- **Proof of work's numbers.** Set in §17.4 (54c) from a measured attempt: about 425 ns of WebAssembly, and the first-contact stamp's 24 bits (§16.4) from the same figure. Open is tuning both with real use, and timing them in the extension itself (54d). Hashcash over SHA-256 comes first. If GPUs prove the problem, a memory-hard puzzle that stays cheap to check, such as Equihash, is in reserve. Not one whose check costs the relay as much as an attempt, such as Argon2. Also its economics: the relay's storage is its rate cap times 36 hours.
- **A first-contact stamp: decided (call 12, the owner, 2026-11-21).** An 8-byte nonce after F, whose work over F the reader checks before any key is computed (§3). Writers solve at 24 bits [choice], and readers ask the same: a reader that asked more would drop honest first messages, since there's no way to tell writers.
- **Proving the base comes from the named handle: decided (call 13, the owner, 2026-11-21),** with the envelope's binding it turned out to need (§2). As proposed, the proof alone left the envelope free: a writer could aim an honest first message's envelope, or any later one's, at the sum of two handles or at a second handle, and a reply would still link them. Binding each envelope to its conversation by the message's outer scalar closes that, at no bytes and one multiplication a message. `to` is now required except in a continuation, and a continuation without a handle must be verified.
- **The bounds on requests** (§3.1: 50 and 256 KiB) and the sizes (§9: 512 bytes to 32 KiB), checked against real use.
- **MAX_SKIP, the 2,000 stored skipped keys and their 48-hour lifetime** (§16.4).
- **How long a browser keeps message history: decided (call 10, the owner, 2026-11-21).** Until the user deletes it, within about 5 MB of the extension's storage across every conversation; past it, the oldest messages go first, and the thread says so (the wallet's architecture.md, *Seedelf Messaging*).
- **To measure in the extension itself,** before §8's figures are relied on:
  - a 15,000-envelope scan in the service worker, in 200-envelope turns, stopped and resumed by its cursor;
  - the same on a slow laptop;
  - the worker's memory during it;
  - proof-of-work solving times;
  - a parallel scan from offscreen documents, if the single thread falls short;
  - the storage used by a hundred conversations with their skipped keys.

  54d measured the scan and both stamps in the wallet's module, in Node and in a Chrome worker (§8, §17.3). The extension's own service worker, its memory, a slow laptop and the storage are 54e's.
- **Restarting a conversation that was never read.** A first message older than 48 hours is refused by a reader who hasn't seen the conversation (§16.4). The worker (54e) marks a conversation it started that has had no reply in those 48 hours, and starts it again, on the user's word, as a new conversation to the same handle; a conversation the ratchet can no longer reach is continued with its identities (§6). Whether the screens offer it or the wallet does it by itself is 54f's.
- **A model of §3 to §6** in a protocol verifier (ProVerif or Tamarin) before mainnet, then an outside review.

## 14. Against Signal

| | Signal | Here |
|---|---|---|
| What the server knows | Each message's recipient, and partly its sender | The IP address that posted each envelope, and when; never whom it's for (§11) |
| First message | Forward-secret through prekeys | Long-term key alone until Alice receives the first reply (§1.1) |
| Later messages | Double Ratchet | Double Ratchet: forward secrecy and recovery as §1.1 says |
| Authentication at the start | X3DH's DHs, with signed prekeys | Implicit, by the static DH in SK (§3); Bob learns a conversation identity, not a person |
| Ratchet header | Plain, or encrypted in the header-encryption variant | Inside the outer layer |
| Identity | A phone number or username, with safety numbers | A Seedelf handle. The sender is anonymous unless they reveal one (§19). |
| Deniability | Yes | Yes: a reveal convinces only its reader (§19) |
| Message lifetime on the server | Until delivered, with a limit | 36 hours, delivered or not |
| Groups | Sender Keys | Later |
| Post-quantum | Yes (PQXDH and the ratchet's additions) | Later |
| Multi-device | Yes | No |

## 15. Phases

| Phase | What |
|---|---|
| 1 | Done: the v1 envelope, and its scan. |
| 2 | The relay: storage, the 36-hour expiry, proof of work, duplicates, the cursor. Built (§17), in the data layer (54c). |
| 3 | Sessions: §3 to §6 in this crate, with vectors, property tests and the protocol model. Built (§16), with independently reproduced vectors; the model is 54b. |
| 4 | The wallet: WebAssembly bindings, the worker's queue, chunked scanning, encrypted local state, requests, a Messages screen, sender labels, "message me at ⟨Seedelf⟩", and the verified reveal (§19). |
| Later | A proof of who you are that others can check, groups, post-quantum, delivery receipts, prekeys if users want them. |

## 16. The session layer as built (54a)

§3 to §6 are built in this crate's `session` module, as plain Rust with no network, no storage and no clock: the caller passes `now`, by the reader's clock, and stores the bytes each state gives. This section fixes every byte and every rule the build had to decide, so another implementation needs nothing else. Choices made while building, not in the reviews, are marked [choice].

### 16.1 Encodings

- **Points:** 48-byte compressed G1, canonical, in G1 and not O (construction.md §4.4). A point that is a KDF's input (a DH output, or z) is its 48 compressed bytes too.
- **Scalars:** 32 bytes, big-endian. Every scalar drawn (b, e_A, s_A, k, every ratchet key, the envelope's r) is uniform in [1, q − 1]. A scalar from a hash (the proof's challenge, the outer scalar) is the hash's bytes as a big-endian integer, reduced mod q.
- **Counters** PN and N: u32, big-endian. **t:** u64, big-endian, Unix seconds.
- **F:** `cid (16) | t (8) | len (1) | to (len, at most 32) | len (1, 0 or 16) | replaces | p₀ (48) | A (48) | E_A (48) | c (32) | z (32)` (§3). `to` is the asset name's raw bytes, not hex.
  - The proof's c and z are there exactly when `to`'s length isn't 0. An F with an empty `to` must have a `replaces`: it's a continuation. Anything else is refused.
  - z must be below q; c is any 32 bytes.
  - So F is 186 bytes for a continuation, and 235 to 282 from a handle.
  - **F′** is F without c and z: what the proof's challenge covers.
- **The ratchet header:** `DHs (48) | PN (4) | N (4)`, 56 bytes.
- **The associated data:** `cid (16) | p₀ | A | p₀ | w₀ | header (56)`, 264 bytes: cid ‖ R_A ‖ R_B ‖ header.
- **The ratchet ciphertext:** `salt (16) | AES-256-GCM ciphertext | tag (16)`.
- **Inner messages:** `0x01 | F | stamp (8, big-endian) | header | ratchet ciphertext` and `0x02 | cid | header | ratchet ciphertext`. Any other type byte is refused.
- **Padding:** `inner | 0x80 | 0x00…` to `size − 161` bytes, where size is the smallest of 512, 2,048, 8,192 and 32,768 that holds the inner message and the marker. A reader takes any of the four sizes [choice: a sender may pad up], and refuses any other length, or padding whose last nonzero byte isn't `0x80`.
- **The outer envelope:** v1 (construction.md §4), with the padded inner message as its plaintext, to the recipient's conversation identity re-randomized by the message's outer scalar o (§16.2): v1's b is o, and its r is drawn. The identity is R_B = (p₀, w₀) for the initiator's messages, R_A = (p₀, A) for the responder's. So every session envelope is exactly 512, 2,048, 8,192 or 32,768 bytes, and its p is [o]p₀.

### 16.2 The key schedule

| Step | Definition |
|---|---|
| SK | HKDF-SHA256(salt = `Seedelf-Messaging\|v1\|session\|salt`, ikm = [e_A]w₀ ‖ [x_A]w₀, info = `Seedelf-Messaging\|v1\|session\|SK` ‖ F), 32 bytes. The responder's ikm is [x_B]E_A ‖ [x_B]A. |
| RatchetInitAlice | DHs = (s_A, S_A), DHr = w₀, (RK, CKs) = KDF_RK(SK, [s_A]w₀), Ns = Nr = PN = 0. |
| RatchetInitBob | DHs = (x_B, w₀), RK = SK. A scratch state only: the first message's ratchet step replaces DHs, so no stored state ever holds x_B. |
| DH(s, P) | [s]P, compressed. Key pairs are (s, [s]p₀). |
| KDF_RK(rk, dh) | HKDF-SHA256(salt = rk, ikm = dh, info = `Seedelf-Messaging\|v1\|ratchet\|root`), 64 bytes: RK′ then CK. |
| KDF_CK(ck) | mk = HMAC-SHA256(key = ck, message = the one byte `0x01`); ck′ = HMAC-SHA256(key = ck, message = `0x02`). |
| ENCRYPT(mk, m, ad) | key ‖ nonce = HKDF-SHA256(salt = a fresh 16-byte salt, ikm = mk, info = `Seedelf-Messaging\|v1\|ratchet\|message`), 44 bytes; the output is salt ‖ AES-256-GCM(key, nonce, ad, m). |
| The outer scalar o | HKDF-SHA256(salt = ENCRYPT's salt, ikm = mk, info = `Seedelf-Messaging\|v1\|ratchet\|outer`), 64 bytes, as a big-endian integer mod q. The envelope goes to ([o]p₀, [o]V), V the recipient's public value on p₀. An o of 0 (probability 2⁻²⁵⁴) sends nothing, and a retry draws a new salt. |
| The ratchet | The Double Ratchet specification's RatchetEncrypt, RatchetDecrypt, SkipMessageKeys and DHRatchet, with §16.4's bounds. |
| The base proof | For the handle (g_S, v_S) and p₀ = [b]g_S: T = [k]g_S; c = SHA-256(`Seedelf-Messaging\|v1\|session\|base` ‖ g_S ‖ v_S ‖ p₀ ‖ T ‖ F′), the points compressed; z = k + (c mod q)·b mod q. The reader computes T′ = [z]g_S − [c mod q]p₀ and accepts if the same hash with T′ is c. |
| The stamp | digest = SHA-256(`Seedelf-Messaging\|v1\|session\|stamp` ‖ F); its work is the leading zero bits of SHA-256(digest ‖ nonce (8, big-endian)), counted from the most significant bit of the first byte, as the relay's stamp's are (§17.3). |

### 16.3 Random draws

Every random value comes from the operating system. To make vectors, each operation draws in a fixed order:

- **Starting from a handle:** b (the re-randomization of the handle into R_B), cid, e_A, s_A, then the proof's k.
- **Starting a continuation:** cid, e_A, s_A. There's no b and no k: the base is the old one, with no handle to prove.
- **The stamp** isn't drawn: the vectors take the first nonce from 0 with enough work. The wallet searches as it likes.
- **Sending:** the ratchet's salt, then the outer envelope's r. Its b is the outer scalar, not a draw.
- **A ratchet step on receiving:** the new DHs scalar.
- **Requests:** authenticating a request's message runs RatchetInitBob and the request's messages on a scratch state, whose ratchet step draws a key that's thrown away with it. The kept state's DHs is drawn when the reply builds it, at its first stored message's step. The vectors give only the draws of states that are kept.

**Starting a continuation, from the writer's side** (§6). The writer becomes the new conversation's initiator, whichever side it was:
- p₀ is the old p₀;
- the new w₀ is the other side's old public value: the old w₀ if the writer started the old conversation, the old A if it was written to;
- the new A is the writer's own [x]p₀, its old public value;
- `replaces` is the old cid, and `to` is the writer's to choose (empty in the vectors);
- everything else is §3 with these values, so R_A and R_B, and the associated data, follow the new roles.

### 16.4 The rules, exactly

- **The window:** a first message for an unknown cid is read only if now ≤ t + 48 h and t ≤ now + 1 h, both ends included.
- **A first message for an unknown cid,** past the window, in this order:
  - **the stamp** shows at least 24 bits [choice];
  - **with a `to`,** the reader holds a handle of that name, and the proof verifies against one of the registers that name has held [choice: the wallet passes every register it knows for each of its Seedelfs, since a Seedelf's datum can change while a message is on its way];
  - **without one,** it's a verified continuation (below);
  - **then** SK and the ratchet, on a copy, and the envelope's check.

  A stamp under 24 bits, an unknown `to`, a proof that doesn't verify and an unverified continuation without a handle are each refused with nothing kept.
- **The envelope:** every message's, on every path (a request's first message and later joins, a conversation's messages), is checked once it decrypts: its p must be [o]p₀. A message that fails is refused, and the state is as it was. A request's stored messages were checked when they came, and are replayed without their envelopes [choice].
- **A known cid's stamp** isn't checked again: a later `0x01` of a request or conversation is judged by F alone [choice].
- **Starting** names a handle, 1 to 32 bytes; only a continuation has no `to` [choice].
- **Tombstones:** held while now ≤ t + 48 h; `expire` deletes the rest. Deleting a request or a conversation leaves one; a request pushed out by the bounds doesn't [choice].
- **A known cid:** a `0x01` counts only with F byte for byte the stored F; it's refused at the initiator, whose own F it is [choice]. A `0x02` for a request not yet replied to is refused [choice].
- **Skipping:** one message may make the reader skip at most MAX_SKIP = 1,000 keys in all: the old receiving chain's remainder (PN − Nr, when there is a receiving chain) plus the new chain's N [choice: in all, not per chain]. The bound is checked before any key is derived. N = 2³² − 1 is refused, so Nr never wraps.
- **Skipped keys:** usable while now ≤ stored + 48 h. At most 2,000 are stored per conversation [choice]; past that the oldest are deleted, as `expire` deletes the expired ones, and each counts as missing.
- **Missing:** the skipped keys still stored, plus those deleted unused. A message that arrives for a stored key stops being missing.
- **Replays:** a message whose key was used, in the current receiving chain or among the stored keys, is refused as used. A replay from an earlier chain whose keys are gone can't be told from a forgery without keeping old chains' keys: it runs as a new chain on a copy and fails to authenticate. Either way nothing changes.
- **Requests:** "oldest" means first to arrive, not lowest t, since t is the writer's to choose [choice]. A later `0x01` joins its request only with the stored F, a header not already held, and if it reads after the stored messages, in their order and with their times, as processing each on arrival would read it. So a request shows exactly what its conversation will hold: a message that arrives more than 48 hours after a later one skipped its key is refused there, as it would be in the conversation. The bytes counted are the stored inner messages, unpadded. After every addition the oldest requests go until both bounds hold.
- **Replying to a request:** RatchetInitBob, then each stored message in the order it arrived, with its arrival time as now. That builds exactly the state processing each on arrival would have.
- **Continuations:** judged when the request arrives, against the reader's conversations only, not its requests [choice]. Without a handle, only a verified one is read.
- **One's own handle:** starting a conversation with a register of one's own key is refused, since R_A would be R_B [choice].
- **A first message's life.** Every first message carries the conversation's t, so the window refuses all of them once t is 48 hours old, unless the reader already holds the cid as a request or a conversation. A writer with no reply after 48 hours can't know whether the reader has the conversation. Only a new conversation, with a new t, reaches a reader who hasn't. The two-wallet simulation meets this whenever a reader stays locked through a conversation's first 48 hours.

### 16.5 The stored state

The wallet's private format, versioned by its first byte; another implementation needn't read it. Every record is parsed in full and checked: points, the ratchet key's two halves, counts, flags and trailing bytes.

- **A conversation** (version 1): `1 | role (1) | len (2) | F | w₀ (48) | RK (32) | flags (1) | CKs (32)? | CKr (32)? | DHs secret (32) | DHs public (48) | DHr (48)? | stamp (8)? | Ns (4) | Nr (4) | PN (4) | lost (8) | count (2) | count × (DH (48) | N (4) | mk (32) | stored at (8))`. Flags bit 0 is CKs, bit 1 CKr, bit 2 DHr, bit 3 the stamp, which only an initiator has. It holds the conversation's secrets: the wallet seals it under the vault key.
- **Requests** (version 1): `1 | next sequence (8) | count (2) | count × (sequence (8) | continues (1, then a cid for 1 or 2) | messages (2) | messages × (arrived at (8) | len (4) | inner message))`. No secrets.
- **Tombstones** (version 1): `1 | count (4) | count × (cid (16) | t (8))`.

### 16.6 Vectors

[tests/vectors/messaging_session_v1.json](../tests/vectors/messaging_session_v1.json) has four conversations with every intermediate value: F with its proof and stamp, both DHs and SK, each init, every chain and message key, ENCRYPT's key and nonce, each outer scalar, each ratchet step, each inner message, and each envelope with its draws.

1. A first contact to a Seedelf's handle under its full 32-byte name, replies both ways, and a pair delivered out of order. Both first messages are 2 KiB.
2. The responder continuing that conversation with its identities, which the reader's rules call verified.
3. The smallest first contact (a root register under a 1-byte `to`, no `replaces`), with 18 and 19 bytes of text, read last first.
4. A fresh start from a handle under its full name with a `replaces` (F at its largest, 282 bytes), whose proof's challenge is at least q, so F carries it unreduced; an 8 KiB message; and a ratchet step that skips the rest of the old receiving chain (PN − Nr = 1), whose skipped message is read last.

**Encodings.** Every byte string is lowercase hex, `to` included: the hex of its raw bytes. `t`, `at`, `delivers`, `envelope_size` and the stamp's `bits`, `nonce` and `work` are JSON numbers. An absent value (`handle`, `replaces`, `base_proof`, `ratchet_step`) is null.

**The fields.** Each session gives:
- `name`, and for a continuation `continues`, the name of the session it continues;
- `initiator_secret_key` (x_A) and `responder_secret_key` (x_B);
- `handle` (`generator`, `public_value`; null for a continuation), `t`, `to` and `replaces`;
- the start's `draws` (`cid`, `e_A`, `s_A`, and `b` and `k` from a handle);
- `base_proof`: null for a continuation, else F′ as `first_contact_prefix`, T as `commitment`, `challenge`, `challenge_scalar` (c mod q) and `response`;
- `stamp`: `digest`, `bits`, `nonce`, the `hash` of digest and nonce, and its `work`. The file's `first_contact_stamp_bits` is 24, and each stamp's nonce is the first from 0 with that work;
- §3's values: `base` (p₀), `initiator_public` (A), `responder_public` (w₀), `ephemeral` (E_A), `ratchet_public` (S_A), `first_contact` (F), `ephemeral_dh` ([e_A]w₀), `static_dh` ([x_A]w₀), `session_key` (SK), `init_dh` ([s_A]w₀), and RatchetInitAlice's `root_key` and `sending_chain_key`.

The file also has `version` (1), `description`, `envelope_sizes`, `first_contact_stamp_bits`, and `labels`: `session_salt`, `session_info`, `base_label`, `stamp_label`, `root_info`, `message_info` and `outer_info`, §16.2's strings.

Then `events`, in order:
- **A send:** `from` (initiator or responder), `kind` (`first-contact` or `session`), `plaintext`, `chain_key` (before it), `message_key`, `next_chain_key`, `header`, `associated_data`, ENCRYPT's `salt`, `aes_key` and `nonce`, `ratchet_ciphertext`, `inner` (the inner message, unpadded), `envelope_size`, the outer scalar's HKDF output `outer_okm` and the scalar `outer_scalar`, the envelope's draw `outer_r`, and `envelope`.
- **A receive:** `by`, `at` (the reader's now), `delivers` (the index in `events` of the send it reads), `header`, `plaintext`, and `ratchet_step`, null when it made none. A step gives `receiving_dh` (the DH output of the old DHs and the header's key), `root_key` (RK after the receiving half), `receiving_chain_key`, `new_ratchet_secret` and `new_ratchet_public`, `sending_dh` (the DH output of the new key and the header's key), `next_root_key` and `sending_chain_key`. A responder's first step starts from RK = SK and DHs = (x_B, w₀).

**Checked independently** (2026-11-20): a script written from this section, protocol.md and construction.md alone, without reading the Rust, reproduced every value in all three sessions with noble-curves 2.0.1 for G1 and Node 24's WebCrypto for HKDF-SHA256, HMAC-SHA256 and AES-256-GCM: 281 session values, the labels and sizes, and v1's 40. Where it had to guess, this section now says what it found.

**Checked again** (2026-11-21, after calls 12 and 13), the same way, by a new script that read no Rust: every value in all four sessions, 451 session values and v1's 42 with the labels, and each stamp's nonce found as the first from 0 with 24 bits. Its first pass, over three sessions, showed what the bytes didn't pin: a challenge stored reduced, a step that ignored PN, F with both `to` and `replaces`, and an 8 KiB envelope. Session 4 was added for them, and each wrong reading now changes values. Its notes on the file's fields are folded in above.

- `session_vectors_match_the_file` holds the code to the file. `RECORD_MESSAGING_SESSION_VECTORS=1` rewrites it, for a deliberate change of format only (it never touches messaging_v1.json).
- tests/session_vectors.rs reads it through the public API.

## 17. The relay as built (54c)

The relay is a part of the data layer, seedelf-data's `api/src/messaging/`, on the same server, behind the same edge and deploys, with buckets and a monthly traffic ceiling of its own (chunk 54's call 1, the owner, 2026-11-21). The data layer's [README](../../../seedelf-data/README.md#seedelf-messagings-relay) is its reference for operators. This section fixes every byte a wallet sends it and reads from it, so a wallet needs nothing else. Choices made while building are marked [choice].

### 17.1 Pools

- **One per network, named in the path:** `mainnet` and `preprod` (call 4). A Seedelf's x is the same on every network (derivation.rs), so one pool would show a preprod message to the mainnet wallet.
- **The pool's name is in the stamp** (§17.3), so work done for one pool isn't accepted by the other.
- **What each holds:** at most 64 MiB of envelopes on mainnet and 8 MiB on preprod [choice]. Past it, a post is refused until the oldest expire.

### 17.2 Posting

`POST /messaging/v1/{pool}/envelopes`, `Content-Type: application/octet-stream`, the body:

```text
nonce (8, big-endian) | envelope
```

At most 8 + 32,768 bytes. The checks run cheapest first, and the first that fails answers:

| Order | Check | Answer when it fails |
|---|---|---|
| 1 | The body holds a nonce: at least 8 bytes | 400 |
| 2 | **The shape:** version 1, and exactly 512, 2,048, 8,192 or 32,768 bytes (§9, §16.1) | 400 |
| 3 | **Already held,** by the stamp's digest (§17.3): the same bytes in the same pool | 200 `already`, whatever the stamp |
| 4 | **The price** (§17.4) is within its ceiling | 429, with `Retry-After` |
| 5 | **The stamp** shows at least the price | 402, `{"error": …, "price": <bits>}` |
| 6 | **The points:** p, w and c each canonical, in G1 and not O (construction.md §4.4), so no reader ever parses garbage (call 3) | 400 |
| 7 | **Room** in the pool | 503, with `Retry-After` |

Kept, the answer is 200 `{"kept": "new", "expires": <Unix seconds>}`; `already` carries the held copy's `expires`. The relay's own refusals carry `{"error": "<words>"}`. One more: a 503 `busy`, with `Retry-After`, from an address new to the relay while it already counts 200,000 (§17.4).

- **Already held comes before the price** [choice], so a wallet that re-posts its stored bytes after a restart (§4.2) gets 200 even when its address's price has risen since. Anyone can download the pool, so this tells no one anything.
- **The points come after the price** [choice]: they're the costly check (three subgroup checks, about 0.16 ms natively), so a sender pays its work before the relay spends on them.
- **A 402 is solved again for the same bytes** at the price it names (§10). The wallet marks a message posted on either 200 (§4.2, step 3), and shows "sent, expires at" from `expires`.
- **The edge** answers before any of this: a 429 when the address's messaging bucket is empty (a post costs 4 units, a page 1 plus 1 for every 16 KiB it sends), a 503 once messaging's traffic allowance for the day is spent, and a 413 for a body over 8 + 32,768 bytes (axum's, in plain text). These buckets and this allowance are messaging's alone: catching up on messages never makes the wallet's other reads wait, and a flood of messages never spends their traffic.

### 17.3 The stamp

```text
digest = SHA-256("Seedelf-Messaging|v1|stamp|" ‖ len(pool) (1) ‖ pool ‖ envelope)
work   = the leading zero bits of SHA-256(digest ‖ nonce (8, big-endian))
```

- **Bits count from the most significant bit of the hash's first byte.** A stamp meets a price of b bits when its work is at least b.
- **Bound to the envelope's bytes and the pool,** so it can't be reused for another envelope or moved to the other pool. The digest also identifies the envelope for the duplicate check.
- **Each attempt is one SHA-256 block** (40 bytes), whatever the envelope's size.
- **Solving:** any nonce that meets the price is taken. The crate's `solve_stamp` takes the first from 0, which makes the vectors [choice], and `find_stamp` searches a slice, so the worker can yield between slices (54d). It refuses more than 32 bits (`MAX_STAMP_BITS`).
- **Measured** (2026-11-21, Intel Core i5-12400F, the sha2 crate built as the wallet's module is, run in Node 24): about **425 ns an attempt** in WebAssembly, 160 ns natively. b bits take 2^b attempts on average: 18 bits about 0.11 s, 20 about 0.45 s, 24 about 7 s. The number of attempts is geometric, so one time in twenty takes three times the average or more.
  - **In the wallet's module** (54d, `scale.mjs messaging` and the same steps in a Chrome 157 worker), solved in slices of 2^16 attempts with a turn of the event loop between: 422 ns an attempt in Node 24 and 438 ns in Chrome, so 24 bits take about 7.1 and 7.4 s on average. 64 relay stamps at 18 bits averaged 0.13 and 0.12 s. 16 first-contact stamps at 24 bits averaged 6.4 and 10.9 s, with medians of 6.1 and 7.7 s; the longest of the 32 took 33 s. Sixteen geometric draws don't settle a mean, so the attempt's cost is the figure to plan by.
  - A slow laptop's figures are still to measure.

### 17.4 The price

What's counted is units of 512 bytes, so an envelope is 1, 4, 16 or 64 units. Each sending address has a count of its recent units, an IPv4 address whole and an IPv6 address by its /64, and everyone together has one. Both halve every 10 minutes. A post's price, its own units u counted:

```text
bits = base + ⌊(mine + u) / 32⌋ + floor
floor = 0 when all + u < quiet, else ⌊log₂((all + u) / quiet)⌋ + 1
```

| Pool | base | quiet | ceiling | per bit | half-life |
|---|---|---|---|---|---|
| mainnet | 18 bits | 1,000 units | 24 bits | 32 units | 10 minutes |
| preprod | 16 bits | 200 units | 24 bits | 32 units | 10 minutes |

All [choice], to tune with real use.

- **Past the ceiling a post is refused,** not priced: a 429 whose `Retry-After` is when the counts will have decayed enough, if nothing else is posted meanwhile, in 15 s steps and at most an hour.
- **Only kept posts are counted.** The counts live in the relay's memory, an address's until it has decayed below a hundredth of a unit (about an hour after one short post), and are never logged or saved.
- **What it means for a sender:** a short message alone costs 18 bits, about 0.1 s; a 32 KiB one, 20. One address can send 31 short messages in a burst before the first extra bit, and stays under the ceiling while its recent units stay under 224: about 15 short messages a minute, kept up indefinitely. A busy pool raises everyone's price by a bit for each doubling of its traffic past `quiet`, which at mainnet's numbers is about 100,000 short envelopes a day.
- **What it doesn't stop.** A GPU computes SHA-256 thousands of times faster than a browser, and a sender with many addresses (an IPv6 /48 holds 65,536 /64s) meets only the floor. Such a sender can fill a pool, and posts are then refused until the oldest expire. The cap bounds what that costs the server and every reader. In reserve: a memory-hard puzzle that stays cheap to check (§13), and a larger droplet.

### 17.5 Reading

`GET /messaging/v1/{pool}/envelopes`, for the first page, then `?after=<cursor>` with the last page's cursor: a decimal u64 with no sign. Any other query is a 400. The answer is `application/octet-stream`, not compressed:

```text
version (1) = 1 | flags (1) | cursor (8) | prices (4) | count (2) | count × (length (4) | envelope)
```

- **Whole envelopes,** in the order they came, at most 256 KiB of them and always at least one when any follows the cursor.
- **cursor:** what to ask from next. Every envelope a pool keeps gets the next number, starting from the Unix time in microseconds when the pool was loaded [choice], so a number says nothing of when its envelope came, and a pool that lost what it held still numbers above every cursor it gave out. An empty page's cursor is the last number given out.
- **flags:** bit 0 (1), another page follows now; bit 1 (2), a gap: something after the cursor is gone (expired, or lost to a crash), or the cursor isn't one this pool gave out, in which case the page starts from the oldest envelope held. A wallet with no cursor is told of no gap.
- **prices:** the bits a post from the reader's address would be asked now, for 512, 2,048, 8,192 and 32,768 bytes in that order; 0 when it would be refused. A wallet solves at these and is spared a 402 unless the price rises before it posts.
- **The wallet's loop** (54e): read pages until bit 0 is clear, saving the cursor after each; on a gap, say that messages sent meanwhile may never arrive. Envelopes read twice are harmless: §5's rules refuse them.

### 17.6 Kept and lost

- **36 hours from when it came:** kept while now < came + 36 h, by the server's clock. A re-post after that is new, with new work (§5, rule 5).
- **Saved** to the server's state directory every minute and at shutdown, and read at start, so a deploy keeps what's waiting (call 2). A shutdown leaves a mark beside each pool's file saying it holds everything. A pool read without the mark tells every earlier cursor of a gap, since what came after its last save is gone.
- **Nothing else is kept:** no recipient, sender, account or key; the counts of §17.4 in memory only; no log of a request (the data layer's README, *What it sees and keeps*).

### 17.7 Vectors

[tests/vectors/messaging_relay_v1.json](../tests/vectors/messaging_relay_v1.json), written by this crate's `relay` module:

- **posts:** 20 envelopes and what the relay makes of each: the four sizes kept, then each refusal of §17.2's shape and points (two other versions, five wrong lengths, and each kind of bad point in p, w and c), named as `check_envelope` names them.
- **stamps:** six, with the envelope, the pool, the price, the digest, the first nonce from 0 that meets it, the hash and its work.
- `relay_vectors_match_the_file` holds the crate to the file, and `RECORD_MESSAGING_RELAY_VECTORS=1` rewrites it, for a deliberate change of format only. The relay's copy of the checks, which the data layer can't take from this crate, is held to the same file (seedelf-data's `api/src/messaging/check.rs`), and its tests post every envelope in it through the whole app.

## 18. The wallet's messages (54e)

What a message's plaintext holds, above the session layer, which takes it as bytes (§16). [choice]

```text
kind (1) | body
```

- **`0x01`: text,** the body UTF-8.
- **`0x02`: a reveal,** the body §19.3's: the writer's Seedelf and its proof (54f).
- **Any other kind** is shown as a message this version can't show, never guessed at. A kind added later (a payment request that opens Send filled in, §7) is read by the versions that know it, and said to be unreadable by the rest, as versions before 54f say of a reveal.
- **The kind byte counts in the text's room:** the longest text a message carries is the session layer's `max_text_len` less one byte.
- **Nothing in a message changes a label or authorizes anything** (§7): a kind is content, as text is.

## 19. The verified reveal (54f)

The side that wrote first may show the other which Seedelf it holds (call 15, the owner, 2026-11-21: "allow alice to reveal but only in the rachet part so its not in the first message"). It's a message of its own kind (§18) carrying a designated-verifier proof bound to the conversation, built in this crate's `session` module (`Conversation::reveal`, `Conversation::verify_reveal`, `Reveal`). Choices made while building are marked [choice].

### 19.1 Who and when

- **Only the initiator reveals, and only once a reply from the other side has decrypted** (it sends `0x02` session messages, §4.1). Its earlier messages are first-contact messages, which a later theft of x_B reads (§1.1), and the other side hasn't answered yet. The crate refuses anything else.
- **Only in a session message.** A reveal is never in F or in a first-contact message. A reader takes one only from a session message (inner type `0x02`) of a conversation it replied in; one inside a first-contact message, or a request's, isn't checked, and shows as a Seedelf that couldn't be verified.
- **Only the responder checks one.** At the initiator a reveal proves nothing: w₀'s key, the other side's, makes one for any Seedelf (§19.2). The crate refuses to check one there.
- **Any of the writer's Seedelfs,** since they all share its key x, and as often as it likes: the latest that verifies names the other side.

### 19.2 The proof

The conversation gives cid, p₀, A = [x_A]p₀ (the initiator's identity) and w₀ = [x_B]p₀ (the responder's). The Seedelf gives its name N, 1 to 32 bytes, and its datum's register (g_S, u_S), with u_S = [x_A]g_S for the writer's key.

The statement is an OR of two: **log_{g_S} u_S = log_{p₀} A** (a Chaum–Pedersen proof that the Seedelf's register and A share a key), or **the prover knows log_{p₀} w₀** (a Schnorr proof of the reader's own key). It's a Fiat–Shamir OR-proof (Cramer, Damgård and Schoenmakers, 1994). The writer proves the first and simulates the second.

**The challenge** is SHA-256 over, in order, with every point compressed (48 bytes):

    label ‖ cid (16) ‖ p₀ ‖ A ‖ w₀ ‖ len(N) (1) ‖ N ‖ g_S ‖ u_S ‖ T₁ ‖ T₁′ ‖ T₂

with label the ASCII bytes of `Seedelf-Messaging|v1|session|reveal`, with no length or terminator. c is that hash as a big-endian integer, reduced mod q (§16.1). A commitment the reader computes may be O (z₁ = c₁ = 0 makes T₁ and T₁′ O, and such a proof is valid): it's hashed as O's compressed encoding, `0xc0` then 47 zero bytes, the only place a point here may be O.

**The writer** (branch 1 real, branch 2 simulated):
1. Draws k₁, then c₂, then z₂, each uniform in [1, q − 1] [choice: the order, for the vectors].
2. T₁ = [k₁]p₀, T₁′ = [k₁]g_S, T₂ = [z₂]p₀ − [c₂]w₀.
3. c from the challenge; c₁ = c − c₂ mod q; z₁ = k₁ + c₁·x_A mod q.

**The reader:**
1. T₁ = [z₁]p₀ − [c₁]A, T₁′ = [z₁]g_S − [c₁]u_S, T₂ = [z₂]p₀ − [c₂]w₀.
2. Accepts if c₁ + c₂ ≡ c (mod q), c computed over these.

**The reader's own reveal.** The responder can make one for any Seedelf, simulating branch 1 and proving branch 2 with x_B: it draws k₂, then c₁, then z₁; T₁ = [z₁]p₀ − [c₁]A, T₁′ = [z₁]g_S − [c₁]u_S, T₂ = [k₂]p₀; c₂ = c − c₁ mod q; z₂ = k₂ + c₂·x_B mod q. It verifies like the writer's. That's what keeps a conversation deniable: shown to anyone else, a reveal proves nothing, since the reader could have made it. The wallet never makes one; the vectors do (§19.6).

### 19.3 The bytes

    plaintext = 0x02 | reveal                                         (§18)
    reveal    = len (1) | N (len) | g_S (48) | u_S (48) | c₁ (32) | c₂ (32) | z₁ (32) | z₂ (32)

- **226 to 257 bytes,** 227 to 258 with the kind byte. A Seedelf's name is 32 bytes, so a reveal's plaintext is 258: a 2 KiB envelope, the size of every reply of 246 to 1,781 bytes of text (§9).
- **The register travels with the name** [choice], so the reader checks the proof before anything reads the chain, and a reveal that doesn't verify reaches nothing. It costs a 2 KiB envelope where a name alone would fit 512 bytes.
- **Parsing** reads the fields in order, each refused as it's read: len, which must be 1 to 32; N; g_S, then u_S, each canonical, in G1 and not O (§16.1); then c₁, c₂, z₁, z₂, each below q, and any may be 0; then nothing may follow. Nothing about the conversation changes on a refusal.
- **The codes** (seedelf-wasm's, the crate's error in snake case): len outside 1 to 32, bytes running out at any field or left over after z₂, or a scalar not below q is `invalid_message`; a point that isn't the canonical compressed encoding of a point on the curve (bad flag bits, x not below p, no point for x) is `invalid_encoding`; one on the curve outside G1 is `not_in_subgroup`; O is `identity_point`. A proof that doesn't verify is `invalid_reveal`; a check at the initiator, or a reveal made at the responder or before a reply, is `reveal_not_allowed`. The wallet's own rules (§19.1's session message, §19.4's chain register) have no code: they show a reveal as failed.

### 19.4 The reader's checks, in order

1. **A session message** of a conversation in which the reader is the responder (§19.1). The wallet checks the inner type; the crate parses before it checks the side, so a reveal that doesn't parse is refused as §19.3 says whichever side checks it.
2. **It parses** (§19.3).
3. **The proof verifies** for the conversation's cid, p₀, A and w₀ (§19.2).
4. **The register is the Seedelf's now** [choice]: the wallet reads the contract fresh, whole, as Send's pay-by-name reads it, and looks the name up in it, never in a view kept from before the reveal came, which a Seedelf's move would leave behind. Its datum's register must be (g_S, u_S). A register the Seedelf no longer holds fails: a Seedelf can move to another owner. The writer can reveal again.
5. **Then the other side is labelled** "Verified ⟨Seedelf⟩" (§7). Of several, the latest to come that verified names it.

Steps 1 to 3 run as the message is received, in the worker's queue (§4.2). Step 4 reads the chain after the page, out of the queue, once for every reveal waiting; a read that fails leaves them waiting, tried again a minute on [choice]. A failure at any step says only that a Seedelf was shown and couldn't be verified, never its name: a name shown unverified would be a tool for phishing.

### 19.5 What it proves, and what it doesn't

- **It proves** that whoever holds the conversation's other identity (R_A, which only its key could have started, §3) holds the key of the register the chain gives the Seedelf's name when it was checked.
- **It proves who holds a key, not who a person is:** "someone with that Seedelf is messaging you". Its use is tying the conversation to a Seedelf the reader already knows: a contact, or someone who posted "message me at ⟨Seedelf⟩".
- **To the reader alone** (§19.2). Not to anyone the reader shows it to.
- **Bound to the conversation:** its challenge holds the cid, both identities, and the Seedelf's name and register, so it can't be moved to another conversation, name or register.
- **It says nothing later.** A Seedelf can move to another owner after it was checked. The reveal's message keeps its time, and the label stands until a later one verifies.
- **It links nothing else.** The writer's other Seedelfs share its key, but no one without that key can tell two registers of one key apart from two keys' (DDH, §2).
- **Forward secrecy** covers it as any message sent after the first reply (§1.1).
- **A stolen x_B shows Bob anything.** A thief of the reader's key can make a reveal for any Seedelf (§19.2) in a conversation it starts with Bob, and Bob's wallet would call it verified. That's key-compromise impersonation, which designated-verifier proofs have by design, and which the static DH already allows for starting conversations (§1.1): whoever has x_B has the Seedelf's funds too. Labels made before a theft stay as they were.

### 19.6 Vectors

[tests/vectors/messaging_reveal_v1.json](../tests/vectors/messaging_reveal_v1.json), written by this crate's `session` module from fixed draws:

- **`conversations`:** two conversations from Alice to Bob's handle, each answered (Alice's first message, Bob's reply, Alice reading it). Each gives `initiator_secret_key` (x_A), `responder_secret_key` (x_B), `cid`, `base` (p₀), `initiator_public` (A), `responder_public` (w₀), and both sides' stored states, `initiator_state` and `responder_state` (§16.5), which are this crate's own, for its public-API test: another implementation needn't read them.
- **`reveals`:** three, each with its `conversation` (an index), `made_by` (`initiator` or `responder`), the `seedelf` (`name`, `generator`, `public_value`), its `draws` by name (drawn `k1`, `c2`, `z2` from the initiator and `k2`, `c1`, `z1` from the responder, in that order; the file's keys are sorted), the `commitments` (`t1`, `t1_seedelf`, `t2`), the `challenge` as SHA-256 gave it and as a scalar (`challenge_scalar`), the `proof` (`c1`, `c2`, `z1`, `z2`), the `reveal`'s bytes and its `plaintext` (with the kind byte):
  1. Alice's Seedelf under its full 32-byte name;
  2. Alice's root register (G, [x_A]G) under a 1-byte name;
  3. Carol's Seedelf, made by the reader with its own key, whose challenge is at least q: it verifies, which is why a reveal convinces no one else.
- **`checks`:** 23, each a reveal's bytes, the `conversation` and `side` it's checked at, and its `result`: `ok`, or the refusal's code, the crate's error in snake case as seedelf-wasm names it (`reveal_not_allowed`, `invalid_reveal`, `invalid_message`, `invalid_encoding`, `not_in_subgroup`, `identity_point`). They cover each reveal at the reader, two at the writer's side, another conversation of the same two keys, another name, another register of the same key, each share and response moved or swapped, another key's Seedelf proved with Alice's, a reader's own reveal whose T₁ and T₁′ are O, and each way parsing refuses, one of them two faults at once, to show the order fields are read in.
- The file also has `version` (1), `description`, `label` (§19.2's), `kind` (2) and `group_order` (q, big-endian hex). Every byte string is lowercase hex.
- `reveal_vectors_match_the_file` holds the code to the file. `RECORD_MESSAGING_REVEAL_VECTORS=1` rewrites it, for a deliberate change of format only, and never touches the other vectors files. tests/reveal_vectors.rs reads it through the public API.

**Checked independently** (2026-11-22): a script written from this section, §16.1 and construction.md alone, without reading the Rust, reproduced every value with noble-curves 2.0.1 and Node 24's SHA-256: both conversations' identities, each reveal's commitments, challenge, proof, bytes and plaintext, every check's result, and q, 76 comparisons in all, and again after the checks were added (78). Where it had to guess (which code each refusal is, the order parsing reads in, how O is hashed, the draws' order), this section now says, and the checks of a commitment at O and of the parsing order were added for it.
