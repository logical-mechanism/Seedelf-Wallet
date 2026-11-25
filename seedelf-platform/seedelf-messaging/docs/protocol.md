# Seedelf Messaging: the one-to-one protocol (draft)

The draft for review: conversations, forward secrecy and post-compromise security, built on the v1 envelope of [construction.md](construction.md). The envelope is built, and so is the session layer of §3 to §6, in this crate's `session` module (chunk 54's 54a). §16 fixes every byte and rule the build decided. The relay is built too, in the data layer (54c), and §17 fixes what it takes and gives. A first message now carries a stamp and a proof that its base comes from the handle it names, and every envelope is bound to its conversation (calls 12 and 13, 2026-11-21), so no writer can learn whether two Seedelfs are one wallet's (§2). The wallet's worker is built too (54e), and §18 fixes what a message's plaintext holds. The screens (54f) add the verified reveal: the side that wrote first may show the other one of its Seedelfs, by a proof only the reader can check, while the writer's random source was sound when it made it (§19; call 15, 2026-11-21; §7 has the condition). The protocol is modelled in Tamarin ([model/](../model/), 54b), and the design is refined as it's built.

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
| Proving who you are | The side that wrote first may show one of its Seedelfs once the other side has replied, by a proof that convinces only the reader, as long as the writer's random source was sound when it made it (§7, §19; call 15, 2026-11-21). A proof the reader could show others stays undecided until users ask for it (§7). |
| First-contact stamp | A first message to a new conversation carries proof of work over its first-contact block, 2²⁴ attempts, which the reader checks before computing any key (§3; call 12, 2026-11-21). |
| Unlinkable handles | A first message proves its base re-randomizes the handle it names, and every envelope goes to its conversation identity re-randomized by a scalar from the message key, which the reader checks (§2; call 13, 2026-11-21). Since call 16, every other point the reader's key meets is bound too, and no envelope holds a register of anyone's key (§2, §3). |
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

**Building the session layer (54a)** decided what the reviews left open, each marked [choice] in §16, and found one thing the wallet must handle: a first message is refused once its t is 48 hours old, so a conversation nobody has read within 48 hours of its start can never begin, however many first messages follow (§16.4, "A first message's life"). The vectors were reproduced by an implementation written from §16 alone, before call 16 changed them, and again as they are now, from the spec and the files alone (2026-11-23 and 2026-11-24; §16.6 says what wasn't).

**Modelling the protocol (54b),** in Tamarin ([model/](../model/)), states as lemmas what §1.1 says of each long-term key, each side's state and one message key, §3's hold on R_A, agreement both ways, out of order included, §5's rule on a cid, §6's continuations and §19's verified reveal. Every lemma was proved before call 16 (2026-11-22, the model's README); call 16 and the gate changed the models, and check.sh proved them again (2026-11-23, 2026-11-24) but for `heal_keys_secret`, which holds by a run on the model without two actions it doesn't read, and four traces and `answers_alike` with its two controls, argued, not checked (the model's README). Its review added to this spec: what a stolen x_B allows before Bob's first reply, key-compromise impersonation (§1.1, §7), and why w₀ must stay in the associated data (§3). Its follow-up models the outer envelope. Before call 16 its lemmas watched only the envelope's p, so they never showed that the outer scalar's check was enough (the model README). Since call 16 they state that the reader's checks of the outer scalar and of the envelope's ephemeral point (§4.1), and of F's keys and base proofs (§3), are each needed, each with a control that drops it, and that together, within the model's assumptions, they make the reader take no first message or reply in which any point its key touched is aimed at another of its registers, unless the reader's own key was stolen first (2026-11-23). That its reactions so tell no writer that two handles are one wallet's, and no responder who wrote, is argued, not checked: the model's pair for it, `answers_alike`, has no result. That key makes both proofs' designated-verifier branches, and tests the link with no reaction. Continuations are argued from first contact, not checked. Its lemmas also state that Bob's replies open to x_A alone, and that one kept message key writes nothing on the wire, where AES-GCM's tag can be redone with the key; and its pairs, that the bare envelope, with a tag of w in its header, is unlinkable, by observational equivalence. Before call 16 those three were proved for the envelope as it was, with w in its header and a drawn r, and with call 16's they were proved again (2026-11-23).

**The second review (2026-11-20),** recorded in [protocol-review.md](protocol-review.md), changed:
- **Who controls R_A.** R_A is now made on R_B's base, and a static DH between them goes into the session secret, so only R_A's key holder can start a session (§2, §3). This also settles which conversations count as continuations (§6), and what the labels may claim (§7).
- **A smaller first-contact block,** so a first message fits the smallest envelope (§3, §9).
- **Requests:** bounded, and holding no state until the reader replies (§3.1).
- **The send and receive state machine** (§4.2).
- **Tombstones** kept until t + 48 hours (§5).
- **"Missing", never "expired"** (§6).
- **What each compromise reveals** (§1.1), and the metadata wording (§11).

**The 1.10.0 gate review (call 16, 2026-11-23)** changed, before any of this shipped, what a stranger could still learn or cause:
- **No envelope holds a register.** An envelope carried (p, w), a register of its reader's key, which anyone reading the pool could pay and watch for its spend. It now carries a tag of w in place of w (§2, §16.1).
- **Every point the reader's key meets is bound first.** Call 13 bound p₀ and the envelope's p; c, E_A, A and S_A were free, so a writer could build one on another register's generator and learn from the reply whether that register was the reader's. The envelope's c is now derived from the message key and checked with p, and F's keys proof shows the writer knows the keys of E_A, A and S_A (§2, §3, §16.2).
- **First messages are deniable.** F's base proof was a plain proof, which a payment watched could tie to the writer's wallet. Both of F's proofs are now designated-verifier (§3, §7). That rests on the writer's random source being sound when it makes them, as was found when their written arguments were attacked (2026-11-24, §7).
- **A request's share.** A request holds at most 16 first-contact messages and 64 KiB, and a writer sends no more than that before a reply; a join never pushes another request out (§3.1, §16.4). Before, one request's joins could push out every other.
- **"Too far ahead" only when it's true.** A message past MAX_SKIP was flagged whatever it held, so one forged envelope made a conversation look dead. It's now flagged only if it authenticates (§6, §16.4).
- **Tombstones a clock can't reopen** (§5), skipped keys stored as runs (§16.5), every record a development build wrote refused by its version (§16.5), and what 1.10.0 freezes for later versions (§20). That freeze starts when Messages opens on mainnet (the owner, 2026-11-24): until then a format may still change (§20).

## 1. Layers

Every message is three layers deep:

1. **Discovery.** The envelope's register (p, w) is a fresh re-randomization of one of the recipient's registers, and the envelope carries p and a tag of w, never w (§16.1). The recipient computes [x]p and compares its tag (`matches_envelope`), one test per envelope however many conversations they have.
2. **The outer envelope:** v1 as built. ECIES to (p, w), opened with [x]c. Every envelope has this one format, so the relay can't tell a first message from a reply by its layout. It also hides everything inside from everyone without x. Its key is static, so it gives no forward secrecy.
3. **The inner message:** the Double Ratchet (§4), whose keys give forward secrecy and recover after a compromise, as §1.1 says.

### 1.1 What each compromise reveals

Alice wrote first; Bob was written to.

| Compromised | Reveals | Doesn't reveal |
|---|---|---|
| Bob's x_B | Which envelopes are Bob's, and their outer layers: cids, ratchet headers, first-contact blocks. The content of every message Alice sent before she received Bob's first reply. Stolen before that reply reaches her, the power to forge it and take the conversation over from her side. | Anything Bob sent: his replies are sealed to R_A, which x_B doesn't open. Anything Alice sent after receiving Bob's first reply. |
| Alice's x_A | Which envelopes are Alice's, and their outer layers. | Any content: the session secret also needs e_A or x_B (§3). |
| Either x | The power to pose as that side in new conversations and in continuations (§6). The power to pose to that side as anyone: any R_A, and a continuation of any of its conversations, which it would label "Continues" (key-compromise impersonation, as in X3DH). The Seedelf's funds, since x spends. | The content of existing conversations' later messages. |
| One message key | That message. | Any other. |
| A conversation's current state (the device) | Its stored history and skipped keys, and its messages until a ratchet round trip the attacker only watches. | Messages after that round trip. Nothing protects against an attacker who uses the stolen state to step into the conversation. |
| An old copy of the state | Messages sent after the copy was taken, until the next ratchet step. | Messages before the copy. |
| The browser's data at rest | Without the wallet's password: that Messages is on for a network (a setting), that it was used, how many conversations each network has and roughly how long each is (its record's padded size), roughly how much a read found for it that isn't taken in yet, and how much strangers' requests and the messages waiting to be posted hold (the padded sizes of the records that hold them), and, once a step's WebAssembly has trapped and locked the wallet, which step it was, the scan or the take (a mark that isn't sealed). Records are sealed under a key that exists only while unlocked, and each conversation's is named by an ID of its own. While unlocked, everything stored, history included. | Without the password, anything in a record. |
| The relay | §11's metadata. It can also withhold, delay, reorder and replay envelopes (§5, §6). | Content, or a message it could forge. Whom an envelope is for, from its bytes: only timing can test that (§11). No envelope holds a register of its reader's key, or of any key a wallet holds, so neither the relay nor anyone reading the pool can pay one and watch the chain for who spends it (§2). |

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
- **Addressing.** Every message to Bob, the first included, goes to R_B re-randomized by a scalar the message derives (§4.1), fresh each time, and every message to Alice to R_A likewise. The envelope carries that register's generator p and a tag of its public value, never the value itself (§16.1), so nothing in it is a register of either side's key. Each side finds its messages with its usual scan.
- **Which handle.** Bob's Seedelfs all share x, and a re-randomization hides which of them it came from. So the first-contact block names the handle in `to` and proves the base re-randomizes it (§3). `to` is verified, not claimed.
- **Linking two handles.** Two registers of one key add up to a register of that key: (g₁ + g₂, v₁ + v₂) belongs to x whenever (g₁, v₁) and (g₂, v₂) both do, and to no one otherwise.
  - So a writer who aims a message at the sum of two Seedelfs' registers, or at a second Seedelf's register while naming the first, learns from any reply that both are one wallet's. Bob's scan matches either, since every register of his key is his, and the reader can't see it happen: every point is a multiple of every other.
  - **What closes it.** The base must be a re-randomization of the one handle named, which the proof in F shows (§3). Every envelope goes to its conversation identity re-randomized by a scalar derived from the message key, which the reader checks once the message decrypts (§4.1), so an envelope aimed anywhere else is dropped. And the envelope's ephemeral point c is its generator times a second scalar the message key derives, checked with it (§16.2): a c built on another register would open the envelope exactly when that register is the reader's.
  - Each is needed: with the proof alone, a writer could still aim the envelope of an honest first message, or of any later message, at the sum or at another handle; with the generator's check alone, it could keep the envelope's p and build its c on another register.
  - Every failure is dropped without a word, as a message that doesn't authenticate is. Nothing tells the writer.
  - **Payments** ask the same question by other means: a Seedelf wallet spends what's paid to any register of its key, so a payment under a register, and the chain watched for its spend, says whether the register is the wallet's. No envelope offers one: it carries p and a tag of w, not w (§16.1), and a register on its p or c needs [x]p or [x]c, which only its reader can compute. What a writer can pay is what it already knows is the reader's: the handle it wrote to, and R_B. The reader of a first message can pay R_A, the writer's own register in F, and learn whatever the writer's spend of it shows: one key reads both sides, and one scan finds both, so that can't be closed.

## 3. The first message (Alice → Bob)

Alice holds Bob's handle register (g_S, v_S).

1. **Identities and keys.** Alice makes:
   - a random 16-byte conversation ID, cid;
   - R_B and R_A (§2), with R_B = ([b]g_S, [b]v_S). b isn't drawn: it's an HMAC under Alice's key x_A of the handle, the start of F and 32 random bytes (§16.2). So it stays secret even when her random source fails, and it's new for each handle and each start of F: cid, time, name and `replaces`. It must stay secret: it blinds A = [x_A][b]g_S, and whoever learns it gets [x_A]g_S on a generator they chose ([joint-security.md](joint-security.md), rule 1);
   - a session ephemeral e_A, with E_A = [e_A]p₀;
   - a ratchet key s_A, with S_A = [s_A]p₀.
2. **The first-contact block:**

       F = cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | p₀ (48) | A (48) | E_A (48) | base proof (0 or 128) | keys proof (192 or 96)

   - **t:** when Alice started the conversation, in Unix seconds, big-endian.
   - **to:** a length byte, then the handle's asset name. Empty only in a continuation (§6).
   - **replaces:** a length byte, then the cid of a conversation this one continues (§6), or nothing. Required when `to` is empty.
   - **The base proof:** present exactly when `to` is, 128 bytes. A proof that Alice knows b with p₀ = [b]g_S for the handle (g_S, v_S) named in `to`, OR knows that handle's own key, with the rest of F in its challenge and its nonce derived from b and everything the challenge covers (§16.2). It's an OR-proof (Cramer, Damgård and Schoenmakers), designated-verifier: Alice proves the first branch and simulates the second.
     - Anyone but Bob has only the first branch, so only a writer who re-randomized that one handle can make it: it makes `to` verified, and keeps p₀ off the sum of two handles (§2).
     - Bob holds the second, so he could have made one for any p₀ himself: it shows no one else who wrote, while Alice's random source was sound when she made it (§7).
   - **The keys proof:** that Alice knows the keys, on p₀, of E_A and of her first ratchet key S_A (every message's header key, step 6), and, from a handle, of A OR of w₀, Bob's value. 192 bytes from a handle; 96 in a continuation, which proves E_A's and S_A's alone, since its A and w₀ are values both sides already hold (§6). Its challenge covers p₀, A, w₀, E_A, S_A and F before it, and each of its three nonces is derived from its key and everything the challenge covers (§16.2).
     - So every point Bob's key meets in a first message is one whose key the writer has shown it knows: a point built on another register's generator, which would authenticate exactly when that register is Bob's, can't be in one (§2).
     - It's designated-verifier the same way: w₀'s branch is Bob's own key, so Bob could have made it for any A. It shows no one else who wrote on the same condition (§7).
     - It's made only from a handle with A's key (joint-security.md, use 10): Alice's wallet computes A = [x_A]p₀ itself, and refuses to prove any other A.
   - **w₀ isn't sent:** Bob computes it as [x_B]p₀.
3. **The stamp.** Alice finds an 8-byte nonce such that SHA-256 of F's digest and the nonce has at least 24 leading zero bits (§16.2, §16.4): about 7 seconds of a browser's time on average.
   - It prices a stranger's first message to one reader, which the relay's price can't target: the relay can't tell first messages from replies.
   - F holds the reader's base and its proofs, and is bound into SK, so the work can't be moved to another reader or another conversation.
   - Replies and later messages pay nothing more.
4. **The session secret** comes from F, not from any one envelope:

       SK = HKDF-SHA256(salt = "Seedelf-Messaging|v1|session|salt",
                        ikm  = [e_A]w₀ ‖ [x_A]w₀,
                        info = "Seedelf-Messaging|v1|session|SK" ‖ F)

   Bob computes the same input as [x_B]E_A ‖ [x_B]A.
   - **The second half is a static DH between R_A and R_B,** as X3DH's DH1 is. Only the holder of A's key can compute it.
   - So a first message Bob can read was written by whoever controls R_A. A writer naming a register they don't control can't start a session, so Bob's replies can't be sent to a third party's mailbox.
   - It's implicit, as X3DH's DH1 is: SK, not a signature, shows who controls R_A, and F's keys proof adds only that its writer knows A's key or w₀'s. F's two proofs are designated-verifier, so nothing in a first message is something Bob could show anyone else, while Alice's random source was sound when she made them: he could have made all of it, SK included, himself (§7).
5. **Starting the ratchet,** as the Double Ratchet's `RatchetInitAlice` (§4.1). R_B stands in for a signed prekey: Bob's initial ratchet key pair is (x_B, w₀) on the base p₀, which is the "long-term key only" decision. Alice computes (RK, CKs) = KDF_RK(SK, [s_A]w₀).
6. **Every message until Alice receives Bob's first reply** is a first-contact message:

       0x01 | F | stamp (8) | ratchet header (56) | ratchet ciphertext

   - **The ratchet header** is S_A ‖ PN ‖ N: a 48-byte point and two big-endian u32 counters. Every first-contact message carries the same S_A, the one the keys proof covers.
   - **The associated data** is cid ‖ R_A ‖ R_B ‖ ratchet header, with R_A = p₀ ‖ A and R_B = p₀ ‖ w₀. It binds both identities to every message, as X3DH's associated data does.
   - **w₀ in it is load-bearing, beside the base proof.** A writer can choose A, E_A and S_A as multiples of the handle's generator and so compute SK on any p₀ without w₀. Three things tie a first message to a base its writer can use: the base proof (step 2), whose maker knows b, or Bob's key, and so w₀ (= [b]v_S); the keys proof, whose simulated branch needs w₀ = [x_B]p₀; and the AES-GCM tag, which needs it too. With none of them, a reader would accept any p₀, and its continuation (§6) would publish [x_B]p₀ for a p₀ of the attacker's choosing: a static-DH oracle on the spending key. Each closes it alone; keep all three. Found while modelling (54b), before the proofs existed.
   - **Sending:** the message is padded (§9) and sealed in an outer envelope to R_B re-randomized by the message's outer scalar (§4.1).
   - F, the stamp, E_A and S_A stay the same in each. Alice switches to `0x02` once a reply from Bob decrypts.

**Bob's side,** for a `0x01` whose cid he doesn't know. Every point was checked, canonical, in G1 and not O, when the envelope was opened. Then, in order, each check before anything costlier, and each binding a point before the next step raises it to Bob's key:
1. Refuse it if t is more than 48 hours old or more than an hour ahead (§5).
2. Refuse it if the stamp shows less than 24 bits of work. Nothing about F is computed before this.
3. With a `to`: refuse it unless `to` names one of Bob's handles and the base proof verifies against a register of his key that handle has held. Without one: refuse it unless it's a verified continuation of one of Bob's conversations (§6). Either way p₀ is now bound.
4. Refuse it unless every message of the request carries the first's header key. Compute w₀ = [x_B]p₀, and refuse it unless the keys proof verifies for w₀ and that header key: E_A, A and S_A are now bound too.
5. Compute SK from [x_B]E_A ‖ [x_B]A. Run `RatchetInitBob(SK, (x_B, w₀))` and decrypt, on a copy of the state (§4.2). Check the envelope went to R_B re-randomized by the message's outer scalar (§4.1), and that its c is [r]p (§16.2).
6. If it authenticates, it's a request (§3.1). If anything fails, nothing is kept, and nothing tells the writer (§2).

- **Whichever message arrives first starts the session.** Its counter N shows how many came before it.
- **Until Alice receives Bob's first reply,** what she sends is keyed from secrets x_B alone can rebuild. There's no forward secrecy for those messages against a later theft of x_B (§1.1).

### 3.1 Requests

A conversation someone else started is a request until the reader replies.

- **What it keeps:** F and the `0x01` messages as they arrived, as bytes, and no ratchet state. The wallet decrypts them in memory to show them, and builds the state from F when the reader replies. `RatchetInitBob` is deterministic in F and x_B, so nothing is lost by waiting.
- **The bounds:** at most 50 requests and 256 KiB of them per network (§13), and each request within its share: 16 first-contact messages and 64 KiB of their inner messages, all its writer sends before a reply (§16.4). A new request past either bound pushes the oldest out, never itself. A later `0x01` with a request's cid, F and header key joins it only within its share and the 256 KiB; past them it's refused (`RequestFull`), and a join never pushes another request out.
- **Replying** accepts the request: it becomes a conversation (§4).
- **Deleting** leaves a tombstone (§5).
- **Ignoring** leaves the request until the bounds push it out.
- A request never notifies its sender of anything.

## 4. Session messages

### 4.1 The ratchet's choices

The Double Ratchet is specified in Signal's [*The Double Ratchet Algorithm*](https://signal.org/docs/specifications/doubleratchet/), revision 4 (2025-11-04), by Trevor Perrin (editor), Moxie Marlinspike and Rolfe Schmidt (revision 3+). The crate follows its §3, without the header encryption of its §4 or the post-quantum ratchets of its §5 and §6. Its names are used as it defines them: RatchetInitAlice, RatchetInitBob, RatchetEncrypt, RatchetDecrypt, TrySkippedMessageKeys, SkipMessageKeys and DHRatchet; GENERATE_DH, DH, KDF_RK, KDF_CK, HEADER, CONCAT and ENCRYPT; its state RK, CKs, CKr, DHs, DHr, Ns, Nr and PN; and MAX_SKIP. Where this document says otherwise, this document holds. The crate runs it with these choices:

| Piece | Choice |
|---|---|
| DH | G1, on the conversation's base p₀: a key pair is (s, [s]p₀), and DH(s, P) = [s]P, compressed. A received point must be canonical, in G1 and not O. |
| GENERATE_DH | A scalar uniform in [1, q − 1] and its point on p₀ (§16.1): s_A at the start, and a new one in each DHRatchet (§16.3). |
| HEADER | `DHs (48) \| PN (4) \| N (4)`, the counters big-endian u32 (§16.1). |
| AD and CONCAT | AD is cid ‖ R_A ‖ R_B, 208 bytes, the same both ways. CONCAT(AD, header) is the two side by side, with no lengths, since each part's length is fixed: §16.1's 264-byte associated data, which is ENCRYPT's ad. |
| Bob's first key pair | (x_B, w₀): his long-term key on p₀ stands in for the signed prekey (§3). Only a scratch state holds it (§16.2). |
| KDF_RK(rk, dh) | HKDF-SHA256(salt = rk, ikm = dh, info = "Seedelf-Messaging\|v1\|ratchet\|root"), 64 bytes: the new root key, then a chain key, as Signal's §7.2 recommends. |
| KDF_CK(ck) | HMAC-SHA256(ck, 0x01) is the message key; HMAC-SHA256(ck, 0x02) is the next chain key, as Signal's §7.2 recommends. |
| ENCRYPT(mk, m, ad) | A fresh random 16-byte salt; key ‖ nonce = HKDF-SHA256(salt = salt, ikm = mk, info = "Seedelf-Messaging\|v1\|ratchet\|message"), 44 bytes; the output is salt ‖ AES-256-GCM(key, nonce, ad, m). Signal's §7.2 recommends AES-256-CBC with HMAC instead, its keys and IV from HKDF under a zero salt: here the salt is drawn and sent, and also derives the envelope's o and r (§16.2). |
| Header encryption | None: the outer layer already hides the header from everyone without x. |
| The envelope's register | The other side's conversation identity re-randomized by the message's outer scalar o, derived from the message key and the ratchet salt (§16.2), not a random b; the envelope's ephemeral point is [r]p, its r derived the same way, not drawn. The reader checks p = [o]p₀ and c = [r]p once the message decrypts. It binds every envelope to its conversation, so none can be aimed at another register of the reader's (§2). |
| MAX_SKIP | 1,000 keys skipped by one message in all, across the chain it ends and the chain it starts, not per chain as Signal's SkipMessageKeys bounds them (§16.4); each stored key deleted 48 hours after it was stored, and at most 2,000 stored. No message makes the reader store more. One past the bound is refused, and said to be too far ahead only if it authenticates, which the reader learns by stepping its chain on a copy, at most 4,096 keys, storing none (§6, §16.4). |

Inside the outer layer, a session message is:

    0x02 | cid (16) | ratchet header (56) | ratchet ciphertext

The associated data is cid ‖ R_A ‖ R_B ‖ ratchet header, as in §3. It goes to the recipient's conversation identity re-randomized by its outer scalar.

**The recipient:**
1. Scans.
2. Opens the outer layer with [x]c.
3. Looks up the cid.
4. Runs the ratchet, then checks the envelope's p and c against the message's outer scalar and its envelope scalar.

### 4.2 The state machine

**Reusing a message key is the one mistake the ratchet can't survive.** In an extension it's easy to make: two screens sending at once, or a worker stopped mid-send.

- **One queue.** The worker's messaging service runs every operation on conversation state in one queue: sends, receives, replies to requests and deletions. No two operations read the same state.
- **Scanners never write.** Anything scanning in parallel (offscreen documents, if §13 needs them) returns indexes and nothing else.
- **One record per conversation, written whole.** The ratchet state and the outbox live in the same record, so one write moves both: it happens or it doesn't. No IndexedDB transaction is needed.

**Sending:**
1. In the queue: advance the sending chain, build the envelope, and write the record with the new state and the envelope in the outbox, marked `pending`. A first-contact message past the request's share (§3.1) is refused before the chain moves, and nothing is written.
2. Out of the queue: solve the proof of work and post the stored bytes.
3. In the queue: mark it `posted` once the relay takes it or says it already has it.

After a restart, every `pending` envelope is posted again, the same bytes. A message key is never used for anything else.

**Receiving:**
1. Outside the queue: read the relay's pages from the saved cursor, and scan them. Once the read and that sync's posts end, the new cursor is saved, in a record of its own; then what the scan found is saved to the take's own record, and taken from it between syncs, never during one (the wallet's architecture.md, *Seedelf Messaging*).
2. In the queue: decrypt against a copy of the state. Skipped keys, ratchet steps and counters change only the copy. The copy is kept only if the message authenticates, as the Double Ratchet requires (§4.1).
3. Write the record with the new state and the message. Once a read's envelopes are all taken, they go from the take's record.

A restart asks no page again: the next read goes on from the saved cursor, and the take from its record. A restart between 3 and the take record's write decrypts the envelope again: its key is gone, so it's dropped as a duplicate (§5). What a stop catches before it's in the take's record is lost, and counted.

**What the salt does and doesn't do.** Even a message key used twice gives two unrelated AES-GCM keys and nonces, unless the random source failed too. That protects confidentiality, not correctness: the reader still takes one message per key, and the second is lost. It's a net under the state machine, not a substitute for it.
- **The salt is a send's only fresh value,** for the outer layer as for the inner: the envelope's o and r come from the message key and the salt (§16.2). So a message key used twice with the salt repeated too, the random source's second fault, repeats the whole envelope header, and with it the outer key and nonce, for two inner messages. Before call 16 a drawn r kept the two outer layers apart in that double fault.

**Restoring old storage** (a copied browser profile) rolls a conversation back. Its next messages reuse counters the other side has already used, and they're dropped. The salt keeps that from becoming a leak, and the conversation may need starting again (§6). It keeps it only while the random source is sound: the salt is drawn, so storage rolled back together with a source that repeats seals another text under a key and nonce already used (§13).

## 5. Duplicates and replays

1. **A `0x01` for a cid the reader has,** as a conversation or a request, counts only if its F is the stored F. Then it's a ratchet message of that conversation. Otherwise it's dropped. It never starts the conversation again.
2. **A `0x01` for an unknown cid** is refused if its t is more than 48 hours old or more than an hour ahead of the reader's clock, if its stamp shows too little work, or if, with a `to`, its proof doesn't show its base re-randomizes that handle of the reader's, or, without one, it isn't a verified continuation of one of the reader's conversations (§3). A `to` whose proof fails isn't saved by `replaces`.
3. **Deleting a conversation or request keeps its cid as a tombstone,** which refuses the cid whatever the reader's clock says, until an expiry past t + 48 hours and 7 days, with t from its F.
   - Rule 2 refuses its `0x01`s after t + 48 hours, by a clock that's right. The 7 days are a margin [choice], 24 bytes a deletion: a clock that ran ahead by less than that for an expiry, then was set right, can't delete a tombstone rule 2 still needs, and reopen the cid. Before call 16 a tombstone held only while now ≤ t + 48 hours, so one expiry by a clock a day ahead did.
   - Timed from t, not from the deletion: a tombstone timed from the deletion could expire up to an hour early, when t ran ahead of the reader's clock.
4. **A ratchet message whose key was used or deleted is dropped.** A replayed session message does nothing.
5. **The relay drops an envelope whose exact bytes it holds.** A re-post after its 36 hours, with new proof of work, meets rules 1–4. Only a holder of the reader's x could re-wrap an inner message in new bytes.
6. **Both sides writing first at once makes two conversations.** Each is valid.
7. **No separate envelope ID is needed.** The cid with F, and the ratchet's counters, identify every message.

The reader's clock judges rule 2, and when rule 3's tombstones go. A clock set far wrong moves the window with it. One set back can't reopen a deleted cid: only an expiry by a clock more than 7 days ahead, while the window would still take the cid's first messages, deletes a tombstone early.

## 6. Lost messages and lost conversations

- **A gap in the counters is a missing message.** It may have expired, been withheld by the relay, or not arrived yet, and the wallet can't tell which. So the wallet says "1 message missing", never "expired".
- **A message the ratchet can't reach is dropped:**
  - one more than MAX_SKIP keys ahead;
  - one whose skipped key passed its 48 hours.

  A session message more than MAX_SKIP keys ahead that authenticates, with its envelope at the conversation's identity, is refused as too far ahead: the wallet says the conversation can't continue, and offers to start again. The reader learns it authenticates by stepping its chain on a copy, at most 4,096 keys, storing none (§16.4). Anything else past the bound is dropped as a forgery is, so no one but the other side can make a conversation look dead.
- **A message that doesn't authenticate is dropped** without a word, since anyone can address an envelope to a handle.
- **A writer's share.** Until the reader replies, a writer sends at most 16 first-contact messages, and 64 KiB of them (§3.1). Past either, nothing more goes until a reply decrypts. If none can come (the reader's reply lost, or never sent), only starting again reaches the reader, as a new request. And while the reader's store is full of others' requests, a writer's later first messages are dropped there, and the writer isn't told.
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
| Verified ⟨handle⟩ | The reader was written to and replied, and the other side then showed that handle with §19's proof, for the register the chain gives it now | The other side holds that handle's key, as a fresh read of the chain gave it when the reveal was checked. It convinces the reader alone, on the condition below. |

`to` shows which of the reader's handles a first message was written to: verified by its base proof (§3), not claimed. Verified to the reader: anyone else must know b to make the proof, but the reader could have made it with its own key.

Every label assumes the reader's own x is safe. With it, anyone can pose to the reader as any R_A, as a continuation of any of its conversations (§1.1), and as any handle in a reveal, whose proof the reader's key can make (§19), as it can make F's two proofs (§3).

- **The handle proof is designated-verifier, and bound to the conversation** (§19, call 15, the owner, 2026-11-21): a proof that A and the handle's register share a key, or that its maker knows w₀'s key, with the conversation's ID and both identities in its challenge. Bob could have made it himself, so it convinces only him, and conversations stay deniable, as Signal's are, on one condition (below). It proves someone holding that Seedelf's key is writing, not who a person is: its use is tying a conversation to a Seedelf Bob already knows.
  - **A plain proof** Bob could show to anyone, evidence of who wrote to him, stays open until users ask for one.
- **First messages are deniable too.** F's base proof and keys proof are designated-verifier in the same way: each is an OR-proof whose other branch is Bob's own key (§3). So Bob could have made a whole first message himself, its proofs and SK included, for any (p₀, A) he likes, any public register of the writer's among them: a Seedelf of hers re-randomized, or her identity from a conversation with someone else. A first message whose writer's random source was sound (below) shows no one else who wrote it, to whom or when, even after a payment Bob watched has tied its R_A to the writer's wallet (§2): Bob could have built the same F on that register himself.
  - **Before this,** the base proof was a plain Schnorr proof of b, which only a writer who knew b could make: once a payment tied R_A to the writer's wallet, F showed anyone that that wallet had written first to the named Seedelf at t.
- **Deniability needs the writer's random source to have been sound** (found 2026-11-24, when the proofs' written arguments were attacked; [joint-security.md](joint-security.md) §9). In each of F's two proofs and in a reveal, the writer simulates the reader's branch with a challenge share c₂ and a response z₂. It draws both from the random source alone and prints both in the proof (§16.2, §19.2). The key is safe whatever that source does, since the proved branch's nonce is derived from the key (§16.2). Deniability isn't.
  - **What a failed source leaves.** One that was stuck on a value prints c₂ = z₂ in both of F's proofs and in a reveal, and E_A = S_A = [c₂]p₀. One that repeats prints one c₂ in two proofs. One that someone could predict prints the c₂ they predicted. A proof Bob makes with his own key shows no such relation, but by a chance of about 1/q a try: there c₂ is what the hash leaves, once the commitments are fixed (§19.2).
  - **What that shows, to anyone.** That Bob's branch was the simulated one, so the writer's was proved. F's keys proof then reads as a plain proof that its maker knows A's key on p₀, and a reveal as a plain proof that its maker holds the Seedelf's key, bound to cid, p₀, A and w₀. A reader who shows such an F (with w₀ and the header key, which its check needs) beside such a reveal shows anyone that whoever holds that Seedelf's key started this conversation, to `to`, at t. A payment that ties R_A to a wallet (§2) does the reveal's part: F then shows that that wallet did.
  - **What stays deniable.** What was said. Every message key is one Bob holds too, so he could have written any message.
  - **And with the writer's key.** Whoever later holds it, and can guess the 32 bytes drawn for a proof, can check the proof's derived values: b, so p₀, and each nonce. No proof of Bob's making passes that check. A sound source leaves the bytes unguessable.
  - **Not closed yet.** Deriving c₂ and z₂ from the key, as the nonces are, closes the first of the two. It isn't built yet (security.md, "Before production").
- **Nothing in a message authorizes a transaction.** A payment request or an escrow invitation, if one is ever a message type, opens the ordinary Send or escrow screen filled in, under the sender's label, and is confirmed there like any other. These are labels, not blocks: the user decides.

## 8. What each message costs

Measured on the same machine as the README: an Intel Core i5-12400F, one thread. The WebAssembly figures come from a scratch harness built the way the wallet builds its module (wasm-bindgen 0.2.128, clang 21, the `wasm-release` profile) and run in Node 24, whose V8 is Chrome's engine. The wallet's size-optimized profile measured the same as `-O3`.

| Step | Native | WebAssembly |
|---|---|---|
| Scan an envelope (`matches_envelope`) | 0.18 ms | 1.02 ms |
| Full parse | 0.16 ms | 0.88 ms |
| Open a match (full parse, then decrypt) | 0.31 ms | 1.77 ms |
| Encrypt an envelope | 0.31 ms | 2.2 ms |

These were measured before call 16, when the scan checked p and w and the full parse three points. The scan now checks p alone and hashes [x]p, one subgroup check fewer and one SHA-256 more; the full parse checks two points. The multiplication, the cost that matters, is unchanged.

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
- The wallet's own `isOwned` row test, measured at 0.73 ms a row in the module (wasm/README.md) before call 16 made it compare points, agrees with these figures: like the scan it checks one point and multiplies once, and it also decompresses the public value where the scan hashes [x]p.
- These figures are Node's, on one fast desktop. §13 lists what to measure in the extension itself before the figures are relied on.

**Per matched envelope,** a conversation's ratchet adds:
- one multiplication for the outer layer;
- two to check the envelope, [o]p₀ and [r]p;
- three when a message starts a ratchet step (a new key pair and two DH);
- symmetric work.

**A conversation's first message:**
- **Sending** costs twenty multiplications: the outer envelope's four, p₀ and w₀, A, E_A and [e_A]w₀, [x_A]w₀, S_A and [s_A]w₀, the base proof's three ([k]g_S and T₂'s two) and the keys proof's five (T_e, T_s, T₁ and T₂'s two). Each later `0x01` costs only the outer four. The stamp adds 2²⁴ SHA-256 attempts on average, about 7 s of WebAssembly (§16.4).
- **Receiving** costs twenty-two: discovery, the outer layer, the base proof's four, w₀, the keys proof's eight, [x_B]E_A, [x_B]A, the ratchet step's three and the envelope's two. That's plus the subgroup checks on p₀, A, E_A and S_A, and two SHA-256 for the stamp.

**A message past MAX_SKIP** costs a held conversation at most 4,097 chain steps (KDF_CK, two HMAC-SHA256 each) and the tag, one multiplication more on a new header key, and the envelope's two if it authenticates; nothing is stored (§16.4). A forgery whose header is further ahead costs nothing.

## 9. Size and padding

- **Overhead:**
  - The outer layer adds 145 bytes: the version, p, w's 32-byte tag, c and AES-GCM's 16-byte tag (§16.1).
  - Inside it, an `0x02` adds 105 bytes: the type, the cid, the ratchet header, and the ratchet ciphertext's 16-byte salt and 16-byte tag.
  - An `0x01` adds F and the stamp in place of the cid, F + 97 bytes: 588–635 from a handle (F's 491–538), 379 for a continuation (F's 282).
- **Padding:** the inner message is padded to fill one of four envelope sizes: 512 bytes, 2, 8 and 32 KiB. A post, nonce and envelope, is at most 8 + 32,768 bytes (§17.2).
  - The method: 0x80, then zeros, stripped on reading.
  - The four sizes hold 366, 1,902, 8,046 and 32,622 inner bytes.
  - **Every message is padded to its first-contact size** (the owner, 2026-11-23): either side's, before a reply and after one, is padded to the envelope its plaintext would take as a first-contact message of its conversation, F + 97 bytes and the plaintext. So no message is smaller than 2 KiB, and a reply's coming changes the size of nothing either side sends.
  - 2 KiB holds 1,283 bytes of plaintext to a Seedelf's 32-byte name (1,267 with `replaces`), 1,314 under a 1-byte `to`, and 1,523 in a continuation; 8 KiB 7,427 (7,411, 7,458 and 7,667); and 32 KiB, the most a message carries, 32,003 (31,987, 32,034 and 32,243). These are bytes of the session layer's plaintext, the wallet's kind byte among them (§18), so a wallet's text has one byte less: 1,282 bytes in 2 KiB to a Seedelf's 32-byte name. Before a reply, the writer's share bounds it too (§16.4).
  - No message a 1.10.0 writer sends is 512 bytes: no `0x01` fits it, a continuation's included, and every `0x02` is padded past it. A reader takes it all the same (§16.1).
- **What size still says:** only roughly how long a message's text is, given its conversation's F. A first message, a reply and any later message look alike. This reverses the earlier choice, which padded each message to the smallest size that held it: a first-contact message, 2 KiB or more, could be told from a short reply, 512 bytes, and the writer's next short post told the relay that a reply had come. It costs four times the bytes of short traffic: a pool holds a quarter as many short messages, and every reader downloads four times as much of them.

## 10. The relay

§17 fixes the details as built (54c); the protocol needs only this:

- **The relay stores bytes.** It keeps no recipient, sender, account or key.
- **Size:** exactly one of §9's four sizes, so at most 32 KiB an envelope.
- **Envelopes are deleted after 36 hours.** Deleting doesn't unsend: anyone who downloaded the pool keeps copies. What protects old envelopes is forward secrecy, not deletion.
- **One relay.** The wallet uses one relay; choosing another isn't offered right now. That's what lets the relay price posts by where they come from.
- **Proof of work, priced by traffic** (2026-11-20). Every envelope carries proof of work over its own bytes and the pool's name, so the work can't be moved to other bytes or the other pool. It holds no time: once an envelope has expired, the same stamp posts it again, at any price its work still meets (§17.3). The price is per sending address:
  - a light base, which someone sending a few messages an hour never notices;
  - rising with the address's posts over a short recent window, so one source posting hundreds pays more for each;
  - IPv6 counted by its /56, so one host can't spread over fresh addresses (§17.4);
  - a global floor that rises when the whole pool grows unusually fast, against floods spread over many addresses;
  - a ceiling an honest browser can meet; past it a post is refused, not priced.

  The relay names the price it wants, and a post refused for too little work is solved again for the same envelope bytes. As a price, it lets an honest user behind the same address as a flooder through, only slower.
- **A cap per address** (2026-11-21). Every reader downloads and scans every envelope, so what the pool holds from one address over its 36 hours is bounded, whatever work it does. Past it, the address waits until its oldest posts expire, an honest user behind it too. The relay's counts live in memory for their window only and are never logged.
- **A day's reading per address** (the 1.10.0 gate): what one address downloads from a pool in a rolling day is capped, counted in memory by the hour, so one reader can't spend the relay's traffic for everyone (§17.5).
- **Duplicates.** The relay drops an envelope whose bytes it already holds.
- **Clients download everything after their cursor,** in pages. At 10,000 envelopes a day, 36 hours is about 15,000 envelopes, roughly 30 MB at 2 KiB each, the smallest a message is (§9). A cursor is exact, so a client that comes back from another address is known by it (§11).
- **An off switch.** A 410 on every route under `/messaging/v1/` stops Messages for every wallet: each starts no solve or post on that pool, and asks a page once an hour and at each unlock, until one gets an answer other than the 410 (§20).

**What 36 hours means:**
- **A reader who doesn't unlock the wallet within 36 hours misses whatever was sent meanwhile,** first messages included, and the sender can't tell. Discovery needs x, which is available only while the wallet is unlocked (§13).
- **The ratchet survives the gap:** the counters let the next message decrypt, and the wallet shows what's missing (§6).
- **A message shows as sent, with when it expires, never as delivered.** Delivery receipts would be messages of their own: possible later.

## 11. What the relay and others learn

**From the cryptography:** an envelope's bytes say nothing of whom it's for (DDH in G1), and nothing of what's inside without the reader's x. None holds a register of anyone's key, so no one can pay one and watch the chain for its spend (§2).

**From the network,** which no cryptography here hides, the relay and anyone watching learn:
- the IP address and time each envelope is posted, its size, and its proof of work;
- when each envelope came: anyone who polls a pool learns each arrival to the second, from its pages. A post's `already` answer, and a full pool's `Retry-After`, say it only to 10 minutes (§17.2);
- how many envelopes and bytes each address has posted: lately, to price its posts, and in each hour, kept 36 hours after it, to cap what it has in the pool (§10). The relay keeps these counts in memory, never tied to an envelope, and never logs them;
- how many bytes of pages each address was sent in each hour, and how many of them under the reserve (§17.5), each kept a day after the hour ends, to cap what it reads in a day: in memory, never which pages or cursors, never logged (§10);
- each client's IP address and when it syncs, so when each wallet is online;
- where each sync starts: the cursor the client's last sync ended at, which is exact, so the relay could tell a wallet that comes back from a new address. The relay's code keeps no table of cursors;
- the prices on every page, which are those of the reader's address: whoever shares it (a household, a VPN's exit, the other /64s of a /56) can watch how much it posts;
- timing. A reply posted soon after a message hints at a conversation, more so when few wallets are online. Over time such hints can link the two sides of a conversation. A wallet's syncs keep their grid (each minute's alarm, and while a page is on screen the worker's one 10-second grid, which every page shown polls on), and ask the same pages and post the same bytes, whatever its envelopes hold: it takes in its own between its syncs, never during one, and stops before each tick it expects. But a request it makes off that grid while it takes them in (a page's read as it opens or comes into view, a read of the chain, which on mainnet the relay's server also serves, a connected site's call) can come up to about 2.5 s late on a slow laptop, and later on a slower one, by the step under way (measured in the wallet's architecture.md, *Seedelf Messaging*), or between two of another run of requests: whoever times such requests, and posts envelopes sealed to a register, as anyone can at the relay's price, can test over many of them whether that register is the wallet's. That's the relay, anyone watching the connection, and on preprod Koios, which answers the chain reads there. And while the wallet's dApp connector is on, any web page that can call the wallet, connected or not, times its own calls directly: with nothing posted it sees when the wallet takes in an envelope of its own, and with an envelope it posts it tests a register in few tries (the wallet's privacy.md, *Seedelf Messaging*).
- what a reply opens. Once a reply has come that the thread shows, the side that wrote first can write past the first messages' share (§3.1), show one of its Seedelfs (§19), and isn't asked to start again once 48 hours pass (§16.4). What its user then posts, or doesn't, can tell the relay that a reply came, as answering soon after one does. A reply the thread doesn't show (a control kind, §18) opens none of them, and nothing a take does seals or posts a message.

**What the relay can also do:** withhold, delay, reorder or replay envelopes (§5, §6). It can't read, address or forge them.

**What's claimed and what isn't:** no envelope names its recipient or sender, and no writer can learn from a reader's replies whether two Seedelfs are one wallet's (§2). That's about replies: a payment is another question, below, and so is the timing above. Nor is it claimed that the timing of a wallet's requests is hidden from the relay or the server it reads the chain through (the owner, 2026-11-24): they see when a wallet asks and how often, what the wallet does about it is what it does, not a guarantee, and timing that depends on the key isn't part of that. There's no claim of anonymity against an observer who watches the whole network.

**What the wallet and the privacy policy say:** the relay can't read messages, or tell from a message whom it's for. It sees the IP address that reads and posts and when, the cursor a wallet returns with, and counts each address's posts and reads, in memory, against floods.

**The other side of a conversation learns:**
- the writer of a first message learns the handle they wrote to;
- the one written to learns a stranger's conversation identity, and whatever the stranger chooses to say. R_A = (p₀, A) is a register of the writer's key, which the reader can pay: a payment under it, or under it added to a Seedelf's register, that the writer's wallet spends, or a Lovejoin box under it that the wallet brings back, tells the reader on chain whether the writer holds that Seedelf, and whether two of its requests have one writer. One key reads both sides and one scan finds both, so that can't be closed (§2). Anyone who pays the sum of any two registers on chain asks the same of the wallet that spends it;
- what F's t says: the writer's clock, rounded down to 10 minutes, so a writer's clock that's far off shows in all its first messages;
- nothing it can prove to anyone else, while the writer's random source was sound when it made F's two proofs: they're designated-verifier, so the reader could have made the whole first message itself. §7 says what a failed source lets it show;
- if the writer reveals one of its Seedelfs (§19), the reader learns that Seedelf, and nothing it can prove to anyone else, on the same condition (§7);
- if the reader answers a first message from two browsers of one key, the writer gets two genuine replies; an honest writer reads the first and drops the other, and a writer that kept both could tell the two browsers apart.

**A holder of the reader's x learns** §1.1's first two rows.

## 12. Local state

**Per conversation:**
- cid, F, R_A, R_B and t.
- The other side's Seedelf: the one this side wrote to, or the one the other side revealed, once verified (§19).
- The ratchet state: RK, CKs, CKr, DHs, DHr, Ns, Nr, PN, and the skipped keys.
- Until a reply decrypts, at the side that wrote first: what it has sent of the request's share (§3.1).
- The outbox (§4.2).
- The message history.

**Kept apart from conversations:**
- Requests, as §3.1 bounds them.
- Tombstones until their t + 48 hours and 7 days (§5).
- The scan's cursor.

**Versions.** Each record starts with its version (§16.5). One of a version this build doesn't read is refused at that byte, never misread, so the wallet can tell an older record from a newer: the records development builds wrote before call 16 are version 1, which 1.10.0 refuses. A conversation whose record a later version wrote is kept as it is and never opened: its messages are passed over as they come.

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
  - **Call 16** found the proof and the outer scalar left four more points free, the envelope's c and F's E_A, A and S_A, each of which a writer could build on another register's generator. It bound them: c by a second scalar the message key derives, checked with p, and the rest by F's keys proof (§2, §3).
- **The bounds on requests** (§3.1: 50 and 256 KiB) and the sizes (§9: 2 to 32 KiB written, and 512 bytes read too), checked against real use. A request's share, 16 first-contact messages and 64 KiB, is one every later reader takes at least, and every writer keeps toward a reader that may run 1.10.0, once the freeze starts (§20).
- **MAX_SKIP, the 2,000 stored skipped keys and their 48-hour lifetime** (§16.4), the 4,096 keys a reader steps to learn whether a message past MAX_SKIP authenticates, and the tombstones' 7-day margin (§5).
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
- **The proofs' simulated draws** (2026-11-24). c₂ and z₂ are drawn alone, so deniability needs the writer's random source to have been sound (§7). Deriving them isn't built yet (security.md, "Before production").
- **A send's salt is drawn** (2026-11-24). It's a send's only fresh value (§4.2), so a message key used again with the same salt repeats a key and nonce at both layers. The writer's rule on a held cid (§16.4) stops a random source that repeats from starting one conversation twice, for as long as the wallet's storage holds what it wrote. With storage rolled back, or wiped, the same source can still do it. Deriving the salt from the message key, the drawn bytes and the plaintext, so that another text gets another salt, isn't built yet. It re-records the vectors, and belongs with the item above.
- **An outside review** of the protocol before mainnet. The model of §3 to §6 is built: [model/](../model/) (54b, Tamarin).

## 14. Against Signal

| | Signal | Here |
|---|---|---|
| What the server knows | Each message's recipient, and partly its sender | The IP address that posted each envelope, and when; never whom it's for (§11) |
| First message | Forward-secret through prekeys | Long-term key alone until Alice receives the first reply (§1.1) |
| Later messages | Double Ratchet | Double Ratchet: forward secrecy and recovery as §1.1 says |
| Authentication at the start | X3DH's DHs, with signed prekeys | Implicit, by the static DH in SK, with F's keys proof that the writer knows each key Bob's meets (§3); Bob learns a conversation identity, not a person |
| Ratchet header | Plain, or encrypted in the header-encryption variant | Inside the outer layer |
| Identity | A phone number or username, with safety numbers | A Seedelf handle. The sender is anonymous unless they reveal one (§19). |
| Deniability | Yes | Yes, while the writer's random source was sound when it made them: F's two proofs and a reveal each convince only their reader, who could have made them (§3, §19). A source that had failed can leave them plain proofs anyone checks; what was said stays deniable (§7) |
| Message lifetime on the server | Until delivered, with a limit | 36 hours, delivered or not |
| Groups | Sender Keys | Later |
| Post-quantum | Yes (PQXDH and the ratchet's additions) | Later |
| Multi-device | Yes | No |

## 15. Phases

| Phase | What |
|---|---|
| 1 | Done: the v1 envelope, and its scan. |
| 2 | The relay: storage, the 36-hour expiry, proof of work, duplicates, the cursor. Built (§17), in the data layer (54c), with a day's reading per address and an off switch since the 1.10.0 gate. |
| 3 | Sessions: §3 to §6 in this crate, with vectors, property tests and the protocol model. Built (§16), with vectors independently reproduced before call 16 re-recorded them and again since (§16.6 says what wasn't), and modelled in Tamarin ([model/](../model/), 54b): every lemma proved before call 16, and again with call 16's rules but for those the model's README names and argues for. |
| 4 | The wallet: WebAssembly bindings, the worker's queue, chunked scanning, encrypted local state, requests, a Messages screen, sender labels, "message me at ⟨Seedelf⟩", and the verified reveal (§19). Built (54d to 54f′), and in the 1.10.0 gate's review (54g), with call 16. |
| Later | A proof of who you are that others can check, groups, post-quantum, delivery receipts, prekeys if users want them. |

## 16. The session layer as built (54a)

§3 to §6 are built in this crate's `session` module, as plain Rust with no network, no storage and no clock: the caller passes `now`, by the reader's clock, and stores the bytes each state gives. This section fixes every byte and every rule the build had to decide, so another implementation needs nothing else. Choices made while building, not in the reviews, are marked [choice].

### 16.1 Encodings

- **Points:** 48-byte compressed G1. Every point read is canonical, in G1 and not O (construction.md §4.4). A point computed and hashed may be O, as the base proof's and the keys proof's commitments (§16.2) and a reveal's (§19.2) may: it's hashed as O's compressed encoding (construction.md §1), `0xc0` then 47 zero bytes. A point that is a KDF's input (a DH output, or z) is its 48 compressed bytes too.
- **Scalars:** 32 bytes, big-endian. Every scalar drawn (e_A, s_A, every ratchet key) is uniform in [1, q − 1]. A scalar from a hash, an HMAC or HKDF (the proofs' challenges, b and the proofs' nonces, the outer scalar o and the envelope's r) is its output as a big-endian integer, reduced mod q. b and the nonces aren't drawn: each is an HMAC over 32 drawn bytes and what it must cover (§16.2). The proofs' simulated c₂ and z₂ are drawn. Nor are o and r: each is HKDF of the message key under the ratchet's salt (§16.2).
- **Counters** PN and N: u32, big-endian. **t:** u64, big-endian, Unix seconds.
- **F:** `cid (16) | t (8) | len (1) | to (len, at most 32) | len (1, 0 or 16) | replaces | p₀ (48) | A (48) | E_A (48) | base proof | keys proof` (§3). `to` is the asset name's raw bytes, not hex.
  - **The base proof**, `c₁ (32) | c₂ (32) | z₁ (32) | z₂ (32)`, is there exactly when `to`'s length isn't 0. An F with an empty `to` must have a `replaces`: it's a continuation. Anything else is refused.
  - **The keys proof** follows, in the form `to` sets: from a handle `c₁ (32) | c₂ (32) | z₁ (32) | z₂ (32) | z_e (32) | z_s (32)`, in a continuation `c (32) | z_e (32) | z_s (32)`.
  - Every one of the proofs' scalars must be below q, and any may be 0. They're read in that order, after the points; one not below q is refused as the parse reaches it.
  - So F is 282 bytes for a continuation, and 491 to 538 from a handle.
  - **F′** is F before its proofs: what the base proof's challenge covers.
  - **F″** is F before its keys proof, F′ and the base proof: what the keys proof covers, inside its M (§16.2).
  - **F's head** is F's bytes before p₀, `cid | t | len | to | len | replaces`: what b covers, since p₀ follows from b.
- **The ratchet header:** `DHs (48) | PN (4) | N (4)`, 56 bytes.
- **The associated data:** `cid (16) | p₀ | A | p₀ | w₀ | header (56)`, 264 bytes: cid ‖ R_A ‖ R_B ‖ header. w₀ must stay in it (§3).
- **The ratchet ciphertext:** `salt (16) | AES-256-GCM ciphertext | tag (16)`.
- **Inner messages:** `0x01 | F | stamp (8, big-endian) | header | ratchet ciphertext` and `0x02 | cid | header | ratchet ciphertext`. Any other type byte is refused.
- **Padding:** `inner | 0x80 | 0x00…` to `size − 145` bytes, where size is the smallest of 512, 2,048, 8,192 and 32,768 that holds, with the marker, the message's first-contact form, F + 97 bytes and its plaintext, and never less than its own inner message (§9; the owner, 2026-11-23): either side's, before a reply and after one. A plaintext whose first-contact form fits no size is refused (`MessageTooLarge`), after a reply too, and the state is as it was. A reader takes any of the four sizes, 512 included [choice: a sender may pad up], and refuses any other length, or padding whose last nonzero byte isn't `0x80`.
- **The outer envelope:** v1 (construction.md §4), with the padded inner message as its plaintext, to the recipient's conversation identity re-randomized by the message's outer scalar o (§16.2): v1's b is o, and its r is the envelope's r (§16.2), neither drawn. The identity is R_B = (p₀, w₀) for the initiator's messages, R_A = (p₀, A) for the responder's. So every session envelope is exactly 512, 2,048, 8,192 or 32,768 bytes (a 1.10.0 writer's 2,048 and up), its p is [o]p₀ and its c is [r]p, and it carries the tag of [o]V, V the recipient's public value on p₀, never [o]V itself:

      0x01 | p (48) | tag (32) | c (48) | AES-256-GCM ciphertext | AES-GCM's tag (16)

  with tag = SHA-256(`Seedelf-Messaging|v1|envelope|tag` ‖ [o]V). The 0x01 is the envelope's version, not an inner message's type. Nothing in an envelope is a register of either side's key (§2): (p, c) is one of r's, which no wallet holds.

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
| The outer scalar o | HKDF-SHA256(salt = ENCRYPT's salt, ikm = mk, info = `Seedelf-Messaging\|v1\|ratchet\|outer`), 64 bytes, as a big-endian integer mod q. The envelope goes to ([o]p₀, [o]V), V the recipient's public value on p₀. An o of 0 (probability about 2⁻²⁵⁵) sends nothing, and a retry draws a new salt. |
| The envelope's r | HKDF-SHA256(salt = ENCRYPT's salt, ikm = mk, info = `Seedelf-Messaging\|v1\|ratchet\|envelope-ephemeral`), 64 bytes, as a big-endian integer mod q. The envelope's ephemeral point is c = [r]([o]p₀). An r of 0 sends nothing, as an o of 0 doesn't. The reader checks c with p (§16.4). |
| The ratchet | §4.1's RatchetEncrypt and RatchetDecrypt, with TrySkippedMessageKeys, SkipMessageKeys and DHRatchet, run as *The ratchet, as run* below says. |
| b | For the handle (g_S, v_S): HMAC-SHA-512(key = x_A as 32 big-endian bytes, message = `Seedelf-Messaging\|v1\|session\|base-scalar` ‖ g_S ‖ v_S ‖ F's head ‖ aux_b), the points compressed and aux_b 32 drawn bytes; its 64 bytes as a big-endian integer, reduced mod q. A b of 0 (probability about 2⁻²⁵⁵) draws aux_b again. Then p₀ = [b]g_S and w₀ = [b]v_S. |
| The base proof | For the handle (g_S, v_S) and p₀ = [b]g_S, an OR-proof: b with p₀ = [b]g_S, or the handle's key y with v_S = [y]g_S. The writer draws c₂, then z₂ (each uniform in [1, q − 1]), then aux_k, 32 bytes; T₂ = [z₂]g_S − [c₂]v_S; k = HMAC-SHA-512(key = b as 32 big-endian bytes, message = `Seedelf-Messaging\|v1\|session\|base-nonce` ‖ g_S ‖ v_S ‖ p₀ ‖ F′ ‖ c₂ ‖ z₂ ‖ aux_k), reduced mod q as b is, a k of 0 drawing c₂, z₂ and aux_k again; T₁ = [k]g_S; c = SHA-256(`Seedelf-Messaging\|v1\|session\|base` ‖ g_S ‖ v_S ‖ p₀ ‖ T₁ ‖ T₂ ‖ F′) mod q, the points compressed; c₁ = c − c₂; z₁ = k + c₁·b. The reader, from public values only, computes T₁′ = [z₁]g_S − [c₁]p₀ and T₂′ = [z₂]g_S − [c₂]v_S and accepts if the same hash over them, mod q, is c₁ + c₂, compared in F_q, never as raw bytes. Any commitment may be O, hashed as O's compressed encoding, `0xc0` then 47 zero bytes: T₁′ is O for a proof with k = 0, which only b's holder can make and which gives b away, and the proof verifies. The reader's own proof, b's branch simulated and the second proved with y, verifies too. |
| The keys proof, from a handle | With M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″, the points compressed and S_A the first ratchet key, every first-contact message's header key: a proof of log_{p₀} E_A AND log_{p₀} S_A AND (log_{p₀} A OR log_{p₀} w₀). The writer computes A = [x_A]p₀ itself and proves no other A. It draws c₂, then z₂ (each uniform in [1, q − 1]), then aux, 32 bytes; T₂ = [z₂]p₀ − [c₂]w₀; k_e = HMAC-SHA-512(key = e_A, message = `Seedelf-Messaging\|v1\|session\|keys-nonce\|e` ‖ M ‖ c₂ ‖ z₂ ‖ aux) and k_s = HMAC-SHA-512(key = s_A, message = `Seedelf-Messaging\|v1\|session\|keys-nonce\|s` ‖ M ‖ c₂ ‖ z₂ ‖ aux), each reduced mod q; T_e = [k_e]p₀, T_s = [k_s]p₀; k₁ = HMAC-SHA-512(key = x_A, message = `Seedelf-Messaging\|v1\|session\|keys-nonce\|a` ‖ M ‖ T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux) mod q, T₁ = [k₁]p₀; c = SHA-256(`Seedelf-Messaging\|v1\|session\|keys\|handle` ‖ M ‖ T_e ‖ T_s ‖ T₁ ‖ T₂) mod q; c₁ = c − c₂, z₁ = k₁ + c₁·x_A, z_e = k_e + c·e_A, z_s = k_s + c·s_A. Every key is its 32 big-endian bytes. Any of the three nonces 0 draws c₂, z₂ and aux again and derives all three again. The reader, with w₀ = [x_B]p₀ and the message's header key as S_A, computes T_e′ = [z_e]p₀ − [c]E_A, T_s′ = [z_s]p₀ − [c]S_A, T₁′ = [z₁]p₀ − [c₁]A and T₂′ = [z₂]p₀ − [c₂]w₀ with c = c₁ + c₂, and accepts if the same hash over them, mod q, is c₁ + c₂, compared in F_q. A commitment at O is hashed as `0xc0` then 47 zero bytes. |
| The keys proof, in a continuation | The same M, with A and w₀ the two values both sides hold (§16.3): a proof of log_{p₀} E_A AND log_{p₀} S_A, which uses neither side's key. The writer draws aux, 32 bytes; k_e = HMAC-SHA-512(key = e_A, message = `…\|keys-nonce\|e` ‖ M ‖ aux) and k_s = HMAC-SHA-512(key = s_A, message = `…\|keys-nonce\|s` ‖ M ‖ aux), each mod q, a 0 drawing aux again for both; c = SHA-256(`Seedelf-Messaging\|v1\|session\|keys\|continuation` ‖ M ‖ T_e ‖ T_s) mod q; z_e = k_e + c·e_A, z_s = k_s + c·s_A. The reader accepts if the same hash over T_e′ = [z_e]p₀ − [c]E_A and T_s′ = [z_s]p₀ − [c]S_A, mod q, is c. |
| The stamp | digest = SHA-256(`Seedelf-Messaging\|v1\|session\|stamp` ‖ F); its work is the leading zero bits of SHA-256(digest ‖ nonce (8, big-endian)), counted from the most significant bit of the first byte, as the relay's stamp's are (§17.3). |

Every label is its ASCII bytes, with no length or terminator. In the table, `\|` is Markdown's escape for `|`; the labels are:

    Seedelf-Messaging|v1|session|salt          SK's salt
    Seedelf-Messaging|v1|session|SK            SK's info, before F
    Seedelf-Messaging|v1|session|base-scalar   b's HMAC
    Seedelf-Messaging|v1|session|base-nonce    the base proof's k's HMAC
    Seedelf-Messaging|v1|session|base          the base proof's challenge
    Seedelf-Messaging|v1|session|keys-nonce|e  the keys proof's k_e's HMAC
    Seedelf-Messaging|v1|session|keys-nonce|s  the keys proof's k_s's HMAC
    Seedelf-Messaging|v1|session|keys-nonce|a  the keys proof's k₁'s HMAC, keyed by x_A
    Seedelf-Messaging|v1|session|keys|handle   the keys proof's challenge, from a handle
    Seedelf-Messaging|v1|session|keys|continuation   the keys proof's challenge, in a continuation
    Seedelf-Messaging|v1|session|stamp         the stamp's digest
    Seedelf-Messaging|v1|ratchet|root          KDF_RK's info
    Seedelf-Messaging|v1|ratchet|message       ENCRYPT's info
    Seedelf-Messaging|v1|ratchet|outer         the outer scalar's info
    Seedelf-Messaging|v1|ratchet|envelope-ephemeral   the envelope's r's info

The three infos HKDF takes under one key (ENCRYPT's salt and mk) are none of them a prefix of another, and within each of raw SHA-256 and HMAC-SHA-512 no label is a prefix of another (joint-security.md, rule 3). The envelope's tag label, `Seedelf-Messaging|v1|envelope|tag`, is the v1 envelope's (construction.md §4.1).

**The ratchet, as run.** §4.1's algorithm, with this document's rules in its steps.
- **Sending** (RatchetEncrypt): mk and the next CKs from KDF_CK(CKs); the header is DHs's public key, PN and Ns; then Ns + 1. ENCRYPT(mk, m, ad) takes §16.1's associated data for this header as ad, and a fresh salt; o and r come from mk and that salt. A first-contact message past its share is refused before CKs moves (§16.4).
- **Receiving** (RatchetDecrypt), on a copy of the state that's kept only if every step passes (§4.2):
  1. **A stored key** for the header's ratchet key and N, the first in the order stored: if now ≤ its time + 48 h, it opens the message (step 6) and is removed, and step 8 follows; past that, the message is refused as used or deleted (`KeyUsedOrDeleted`).
  2. **The current receiving key** (the header's key is DHr): with no receiving chain the message doesn't authenticate (`DecryptionFailed`); with N < Nr it's refused as used (`KeyUsedOrDeleted`).
  3. **The count,** before any key is derived: N − Nr on DHr; for a new key, N, plus PN − Nr when there's a receiving chain and PN > Nr. Past MAX_SKIP, or with N = 2³² − 1, nothing below runs, and §16.4's read-only path decides.
  4. **A new key:** while there's a receiving chain and Nr < PN, KDF_CK(CKr) gives a message key and the next CKr, and the key is stored with DHr, Nr and now as its time, and Nr + 1. Then PN = Ns, Ns = Nr = 0, DHr = the header's key, (RK, CKr) = KDF_RK(RK, DH(DHs, DHr)), a new DHs is drawn, and (RK, CKs) = KDF_RK(RK, DH(DHs, DHr)).
  5. **The chain:** while Nr < N, a key is stored the same way, and Nr + 1. Then mk and the next CKr from KDF_CK(CKr), and Nr = N + 1.
  6. **Open:** the salt is the ratchet ciphertext's first 16 bytes; the key and nonce come from it and mk as ENCRYPT's do, and AES-256-GCM opens the rest under the associated data (`DecryptionFailed`).
  7. **The cap:** past 2,000 stored keys, the first stored are deleted, each counted missing.
  8. **The envelope:** p = [o]p₀ and c = [r]p, o and r from mk and the salt (`WrongEnvelopeRegister`). A request's stored messages, replayed without their envelopes, were checked when they came (§16.4).

**Why o and r are derived, not drawn.** Each binds one of the envelope's points to the conversation: p = [o]p₀ to its identity, and c = [r]p to the envelope's own generator. A writer who drew c could build it on any register, [r′]g′, and seal under [r′]v′: the envelope would open exactly when (g′, v′) is a register of the reader's key, and a reply would say so (§2). Derived from mk, both are the writer's to compute and the reader's to check, once the message decrypts.
- **The salt is a send's only fresh value,** for the outer layer as for the inner. A message key used twice (a rolled-back state, §4.2) with a fresh salt gives other o, r, outer key and nonce, as it gives another inner key and nonce. With the salt repeated too, a second fault in the random source, the whole envelope header repeats, and with it the outer key and nonce.
- **Before this, r was drawn,** after the salt, and the reader checked p alone.

**Why b and the proofs' nonces are derived, not drawn** ([joint-security.md](joint-security.md), rule 2). All are hedged as the reveal's nonce is (§19.2), so a random source that fails, repeats or is predictable costs nothing here.
- **b blinds A.** (p₀, A) = ([b]g_S, [b][x_A]g_S) is a random register of x_A while b is secret. Whoever learns b gets [x_A]g_S = [b⁻¹]A on a generator of their choosing: a static Diffie–Hellman answer on the spending key. Keyed by x_A, b is secret whatever the source does. Its message holds the handle and F's head, so another handle, cid, time, name or `replaces` gives another b.
- **k must never meet two challenges,** or b = (z₁ − z₁′)/(c₁ − c₁′). Its message holds everything the challenge covers except T₁, which follows from k: T₂ follows from c₂ and z₂. So the same values give the same proof again, and anything else gives another k.
- **k is keyed by b,** the witness it hides, as RFC 6979 keys a nonce by the signing key. The proof then depends on b alone, and x_A meets one HMAC here, not two. A k keyed by x_A would add nothing: k only has to stay as secret as b.
- **Before this, both were drawn,** in the order b, cid, e_A, s_A, k. A stuck source gave k = b, and then z = b(1 + c) gave b away from one F.
- **The keys proof's three nonces share one draw.** k₁ under two challenges gives x_A = (z₁ − z₁′)/(c₁ − c₁′), and k_e or k_s gives e_A or s_A. (M, c₂, z₂, aux) fixes everything the challenge covers, M fixing the keys, so each nonce's message holds all four, and k₁'s T_e and T_s too. One draw serves all three: with an aux each, a source that repeated every draw but one would leave the other nonces under a new challenge, and the proof's first draft gave x_A away from two first messages that way (joint-security.md §9).
- **The simulated c₂ and z₂ are still drawn alone** (§16.3). No key rests on them: each nonce's message holds them. Deniability does: §7 says what a failed source leaves in them.

**Why the keys proof.** Bob raises E_A, A and S_A to his key: [x_B]E_A and [x_B]A into SK, [x_B]S_A into the first ratchet step. Without a proof, a writer could put one of them on another register's generator, (g′, v′), and derive its half from v′: the first message would authenticate exactly when (g′, v′) is a register of Bob's key, and Bob's reply would say so (§2). With it, each is a point whose key the writer knows, so its Diffie–Hellman value is one the writer could compute anyway. It's checked before any of them meets Bob's key: only w₀ = [x_B]p₀ comes first, on a p₀ the base proof or a held base binds. Every message of a request must carry the first's header key, since the scratch state's ratchet key is x_B until one message authenticates (§3, Bob's side, step 4): a request read from storage is held to it when its record is read, and again when it's replayed.

### 16.3 Random draws

Every random value comes from the operating system. To make vectors, each operation draws in a fixed order. The vectors name each draw, so the order is this crate's generator's, not something another implementation must follow or the file can pin:

- **Starting from a handle:** cid, then 32 bytes aux_b for b (the re-randomization of the handle into R_B, §16.2), then e_A, s_A, then the base proof's c₂, z₂ and 32 bytes aux_k, then the keys proof's c₂, z₂ and 32 bytes aux: ten draws. A b of 0 draws aux_b again, before anything else is drawn. A zero nonce in either proof draws that proof's c₂, z₂ and aux again, in the same order, and derives all its nonces again.
- **Starting a continuation:** cid, e_A, s_A, then the keys proof's 32 bytes aux: four draws. There's no b and no base proof: the base is the old one, with no handle to prove. A zero k_e or k_s draws aux again.
- **The stamp** isn't drawn: the vectors take the first nonce from 0 with enough work. The wallet searches as it likes.
- **Sending:** the ratchet's salt alone; the envelope's b and r are the outer scalar and the envelope's r (§16.2), not draws.
- **A ratchet step on receiving:** the new DHs scalar.
- **Requests:** authenticating a request's message runs RatchetInitBob and the request's messages on a scratch state, whose ratchet step draws a key that's thrown away with it. The kept state's DHs is drawn when the reply builds it, at its first stored message's step. The vectors give only the draws of states that are kept.

**Starting a continuation, from the writer's side** (§6). The writer becomes the new conversation's initiator, whichever side it was:
- p₀ is the old p₀;
- the new w₀ is the other side's old public value: the old w₀ if the writer started the old conversation, the old A if it was written to;
- the new A is the writer's own [x]p₀, its old public value;
- `replaces` is the old cid, and `to` is empty: the old base has no handle to prove (§6), and nobody holds its b;
- everything else is §3 with these values, so R_A and R_B, and the associated data, follow the new roles.

### 16.4 The rules, exactly

- **The window:** a first message for an unknown cid is read only if now ≤ t + 48 h and t ≤ now + 1 h, both ends included.
- **A first message for an unknown cid,** once inside the window, in this order:
  - **the stamp** shows at least 24 bits [choice];
  - **with a `to`,** the reader holds a handle of that name, and the proof verifies against one of the registers of the reader's key that name has held [choice: the wallet passes every register it knows for each of its Seedelfs, since a Seedelf's datum can change while a message is on its way]. A register of another key under the name, one the Seedelf held before it came to this wallet, is passed over: the proof's other branch is that register's key, so its holder could prove any p₀;
  - **without one,** it's a verified continuation (§6): its `replaces` names one of the reader's conversations, its p₀ is that conversation's, and A and [x_B]p₀ are that conversation's A and w₀, in either order;
  - **then** every message's header key must be the first message's, and then come w₀ = [x_B]p₀ and the keys proof (§16.2);
  - **then** SK and the ratchet, on a copy, and the envelope's check.

  A stamp under 24 bits, an unknown `to`, a base proof that doesn't verify, an unverified continuation without a handle and a keys proof that doesn't verify are each refused with nothing kept.
- **A first-contact header** has PN 0 and N below 16, or its message doesn't parse [choice]: only the initiator's first chain sends first-contact messages, within a request's share (below).
- **The envelope:** every message's, on every path (a request's first message and later joins, a conversation's messages, and one past MAX_SKIP), is checked once it decrypts: its p must be [o]p₀ and its c [r]p. A message that fails is refused, and the state is as it was. A request's stored messages were checked when they came, and are replayed without their envelopes [choice].
- **A known cid's stamp** isn't checked again: a later `0x01` of a request or conversation is judged by F alone [choice].
- **Starting** names a handle, 1 to 32 bytes; only a continuation has no `to` [choice].
- **Never a second conversation under a cid the writer holds** (2026-11-24). A writer's wallet refuses a start, a start again or a continuation whose cid it already holds, as a conversation, as a request its inbox lists or as a tombstone, before anything of the new one is written, stamped or sealed, and refuses to accept a request whose cid a tombstone holds. It's a rule the writer keeps for itself: no reader can see it or hold a writer to it. The cid comes from the draws, as e_A, s_A and each send's salt do, and t is rounded down to 10 minutes. So a random source that repeats, inside those 10 minutes, would make the first conversation again with every one of its keys, and seal a second text under the first message's key and nonce, at both layers. This crate's `Inbox` refuses a cid it holds as a conversation or a request; `Conversation::start` and `start_continuing` build one with no inbox, so the wallet's worker checks before it keeps one ([joint-security.md](joint-security.md) §9, which says what the check can't see; §13).
- **Tombstones:** held whatever now says, from the deletion until an `expire` at a now past t + 48 h + 7 days (the margin [choice]) deletes them. Deleting a request or a conversation leaves one; a request pushed out by the bounds doesn't [choice].
- **A known cid:** a `0x01` counts only with F byte for byte the stored F; it's refused at the initiator, whose own F it is [choice]. A `0x02` for a request not yet replied to is refused [choice].
- **Skipping:** one message may make the reader skip at most MAX_SKIP = 1,000 keys in all: the old receiving chain's remainder (PN − Nr, when there is a receiving chain and PN > Nr; nothing otherwise) plus the new chain's N [choice: in all, not per chain]. The bound is checked before any key is derived or stored. N = 2³² − 1 is refused, so Nr never wraps.
- **Past the bound,** a session message of a held conversation is authenticated read-only, storing no key and drawing nothing:
  - for a new header key, the receiving half of a ratchet step, KDF_RK(RK, DH(DHs, key))'s chain key, stepped N times, with the old chain's PN − Nr counted (when there's a receiving chain and PN > Nr), though none of its keys is derived; on the current chain, CKr stepped N − Nr times;
  - at most MAX_AUTH_STEPS = 4,096 in all [choice], counted as MAX_SKIP is, so at most 4,097 KDF_CK with the message's own key; past it nothing is derived;
  - then the tag, then the envelope's p and c.

  Only if all pass is it refused as too far ahead (`TooFarAhead`): the conversation can't take it, and the wallet says so (§6). Otherwise it's refused as a message that doesn't authenticate, `DecryptionFailed`, or `WrongEnvelopeRegister` for its envelope, and nothing tells the writer. N = 2³² − 1, which no chain sends, is refused that way too. A first-contact message is never authenticated past the bound, at a held conversation or at a request's scratch state, whose ratchet key is the reader's long-term key: it's refused as `DecryptionFailed`. With the header rule above, none from the wire can be past it.
- **Skipped keys:** usable while now ≤ stored + 48 h. At most 2,000 are stored per conversation [choice]; past that the ones stored first are deleted, in the order stored, not by their times, as `expire` deletes the expired ones, and each counts as missing. A lookup takes the first stored key for a header's ratchet key and N.
- **Missing:** the skipped keys still stored, plus those deleted unused. A message that arrives for a stored key stops being missing.
- **Replays:** a message whose key was used, in the current receiving chain or among the stored keys, is refused as used. A replay from an earlier chain whose keys are gone can't be told from a forgery without keeping old chains' keys: it runs as a new chain on a copy and fails to authenticate. Either way nothing changes.
- **Requests:** "oldest" means first to arrive, not lowest t, since t is the writer's to choose [choice]. A later `0x01` joins its request only with, in this order:
  - the stored F, byte for byte (else `DifferentFirstContact`);
  - a header not already held (else `KeyUsedOrDeleted`, so a page read twice stays a duplicate);
  - the first stored message's header key (else `InvalidKeysProof`);
  - room: at most 16 messages and 64 KiB in its request, its share [choice], and 256 KiB of requests in all (else `RequestFull`).

  All of these come before the request is replayed, so a join they refuse derives no key. Then it joins if it reads after the stored messages, in their order and with their times, as processing each on arrival would read it. So a request shows exactly what its conversation will hold: a message that arrives more than 48 hours after a later one skipped its key is refused there, as it would be in the conversation. The bytes counted are the stored inner messages, unpadded.
  - **A join never pushes another request out.** Only a new request, with its own stamp, pushes the oldest out until both bounds hold, never itself. So while the store is full of others' requests, a writer's later first messages are refused there, and the writer isn't told.
  - With one header key, PN 0 and N below 16, a request holds at most 16 messages, a replay derives at most 16 keys a message, and accepting a request leaves at most 15 skipped keys.
  - **A stored request** holds 1 to 16 messages and at most 64 KiB, each with the first's F and header key and an N of its own, or its record doesn't read. Replayed, it isn't checked again for its window, its stamp or its base proof, which were checked when its first message came: the record is the wallet's own sealed write. Its header keys and keys proof are checked again.
- **The writer's share:** before a reply, an initiator sends at most 16 first-contact messages and 64 KiB of their inner messages, unpadded, as the reader counts them [choice]. Past either, sending is refused (`RequestFull`) before the chain moves. The state keeps the count until a reply decrypts (§16.5). The longest text a message may carry, `max_text_len`, is the largest envelope's room for it as a first-contact message (§9), at either side, before a reply and after one; before a reply, the smaller of that and the share's, 0 once it's used up. `first_contact_left` gives the messages and bytes left.
- **Replying to a request:** RatchetInitBob, then each stored message in the order it arrived, with its arrival time as now. That builds exactly the state processing each on arrival would have.
- **Continuations:** judged when the request arrives, against the reader's conversations only, not its requests [choice]. Without a handle, only a verified one is read.
- **One's own handle:** starting a conversation with a register of one's own key is refused, since R_A would be R_B [choice].
- **A first message's life.** Every first message carries the conversation's t, so the window refuses all of them once t is 48 hours old, unless the reader already holds the cid as a request or a conversation. A writer with no reply after 48 hours can't know whether the reader has the conversation. Only a new conversation, with a new t, reaches a reader who hasn't. The two-wallet simulation meets this whenever a reader stays locked through a conversation's first 48 hours.

### 16.5 The stored state

The wallet's private format, versioned by its first byte; another implementation needn't read it. Every record is parsed in full and checked: points, the ratchet key's two halves, counts, flags and trailing bytes. A record of a version this build doesn't read is refused at its first byte (`UnsupportedStateVersion`, with the version), so an older record is told from a newer one: the conversations and requests development builds wrote before call 16 are version 1.

- **A conversation** (version 2): `2 | role (1) | len (2) | F | w₀ (48) | RK (32) | flags (1) | CKs (32)? | CKr (32)? | DHs secret (32) | DHs public (48) | DHr (48)? | stamp (8)? | sent before a reply (4)? | Ns (4) | Nr (4) | PN (4) | lost (8) | runs (2) | runs × ( DH (48) | count (2) | count × ( N (4) | mk (32) | stored at (8) ) )`. It holds the conversation's secrets: the wallet seals it under the vault key, and the crate writes it into a buffer sized exactly, so no copy is left behind by its growth.
  - **Flags:** bit 0 is CKs, bit 1 CKr, bit 2 DHr, bit 3 the stamp, which only an initiator has, and bit 4 the count of what was sent before a reply, which an initiator has exactly while it has no CKr. Any other bit is refused.
  - **Sent before a reply:** the bytes of the first-contact inner messages sealed so far, unpadded, at most 64 KiB, with Ns at most 16 beside it (§16.4).
  - **The ratchet key is never the identity key** (2026-11-24). No stored state's DHs public is its own side's identity key on p₀, A for an initiator and w₀ for a responder: that key's secret is x. Only a responder's scratch state holds it, while a request's messages are replayed, until its first message's ratchet step replaces it, and that state is never returned or written. A record whose DHs public is that key doesn't read (`InvalidState`); accepting a request returns no such state, giving the first message's own refusal, or `DecryptionFailed`, where the replay leaves one; and the wallet's bindings refuse to write one (`record_of`).
  - **The skipped keys,** as runs of the list in the order stored: a run is the longest stretch of keys on one ratchet key, which is written once. The other side picks its ratchet keys and may use one again, so one key can head two runs; two adjacent runs never share one, each run holds at least one key, and the counts add up to at most 2,000, so a list has one encoding. Read back, the list is the same, in the same order, which lookups search and eviction takes from (§16.4). Each distinct ratchet key's encoding is decoded and checked once.
- **Requests** (version 2): `2 | next sequence (8) | count (2) | count × (sequence (8) | continues (1, then a cid for 1 or 2) | messages (2) | messages × (arrived at (8) | len (4) | inner message))`. No secrets. Each request holds 1 to 16 messages and at most 64 KiB, all with the first's F and header key, PN 0 and an N each its own (§16.4).
- **Tombstones** (version 1, its layout unchanged): `1 | count (4) | count × (cid (16) | t (8))`.

### 16.6 Vectors

[tests/vectors/messaging_session_v1.json](../tests/vectors/messaging_session_v1.json) has four conversations with every intermediate value: F with its two proofs and its stamp, both DHs and SK, each init, every chain and message key, ENCRYPT's key and nonce, each outer scalar and envelope scalar, each ratchet step, each inner message, and each envelope. It was re-recorded for call 16, and again in the 1.10.0 gate for §9's padding: nine session sends went from 512 bytes to 2,048, and only their `envelope_size` and `envelope` changed.

1. A first contact to a Seedelf's handle under its full 32-byte name, replies both ways, and a pair delivered out of order. Both first messages are 2 KiB, and so is every reply.
2. The responder continuing that conversation with its identities, which the reader's rules call verified. Nothing of session 1's ratchet or messages enters it: a continuation is a new conversation (§16.3), which takes from the old one only its cid, as `replaces`, its p₀, as `base`, and its two public values, the writer's as A and the other side's as w₀. Session 1's responder writes it, so its `initiator_public` and `responder_public` are session 1's `responder_public` and `initiator_public`, and its two secret keys are session 1's, swapped. Each can be checked against session 1.
3. The smallest first contact (a root register under a 1-byte `to`, no `replaces`, F of 491 bytes): three first-contact messages of 1,314 bytes of plaintext (the most a 2 KiB envelope holds), 1,315 (8 KiB) and none (2 KiB), read last first. No first-contact message fits 512 bytes, and no message is padded to it (§9).
4. A fresh start from a handle under its full name with a `replaces` (F at its largest, 538 bytes), whose base proof's and keys proof's challenge hashes are both at least q, so a reader that compared either unreduced would refuse it; an 8 KiB message; and a ratchet step that skips the rest of the old receiving chain (PN − Nr = 1), whose skipped message is read last. Its draws come from the first label that gives both hashes at least q.

**Encodings.** Every byte string is lowercase hex, `to` included: the hex of its raw bytes. `t`, `at`, `delivers`, `envelope_size` and the stamp's `bits`, `nonce` and `work` are JSON numbers. An absent value (`handle`, `replaces`, `base_scalar`, `base_proof`, `ratchet_step`) is null; `continues` is present only in a continuation.

**The fields.** Each session gives:
- `name`, and for a continuation `continues`, the name of the session it continues;
- `initiator_secret_key` (x_A) and `responder_secret_key` (x_B);
- `handle` (`generator`, `public_value`; null for a continuation), `t`, `to` and `replaces`;
- the start's `draws` by name, the file's keys sorted (§16.3): `cid`, `e_A`, `s_A` and `aux_keys`, the keys proof's 32 bytes, and from a handle also `aux_b`, the base proof's `base_c2`, `base_z2` and `aux_k`, and the keys proof's `keys_c2` and `keys_z2`;
- `base_scalar`: null for a continuation, else b's HMAC: its `message`, its 64-byte output `hmac`, and `scalar` (b);
- `base_proof`: null for a continuation, else F′ as `first_contact_prefix`, the `nonce` (its HMAC's `message` and `hmac`, and `scalar`, k), the `commitments` `t1` and `t2`, the `challenge` as SHA-256 gives it and `challenge_scalar` (it mod q), and `c1`, `c2`, `z1` and `z2`, which are F's 128 bytes before the keys proof;
- `keys_proof`: its `form` (`handle` or `continuation`), `message` (M), the `nonces` `e`, `s` and, from a handle, `a`, each its HMAC's `message` and `hmac` and its `scalar`; the `commitments` `t_e`, `t_s` and, from a handle, `t1` and `t2`; the `challenge` and `challenge_scalar`; and the `proof`, `c1`, `c2`, `z1`, `z2`, `z_e` and `z_s` from a handle or `c`, `z_e` and `z_s` in a continuation: F's last 192 or 96 bytes;
- `stamp`: `digest`, `bits`, `nonce`, the `hash` of digest and nonce, and its `work`. The file's `first_contact_stamp_bits` is 24, and each stamp's nonce is the first from 0 with that work;
- §3's values: `base` (p₀), `initiator_public` (A), `responder_public` (w₀), `ephemeral` (E_A), `ratchet_public` (S_A), `first_contact` (F), `ephemeral_dh` ([e_A]w₀), `static_dh` ([x_A]w₀), `session_key` (SK), `init_dh` ([s_A]w₀), and RatchetInitAlice's `root_key` and `sending_chain_key`.

The file also has `version` (1), `description`, `envelope_sizes`, `first_contact_stamp_bits`, and `labels`: `session_salt`, `session_info`, `base_scalar_label`, `base_nonce_label`, `base_label`, `keys_handle_label`, `keys_continuation_label`, `keys_nonce_e_label`, `keys_nonce_s_label`, `keys_nonce_a_label`, `stamp_label`, `root_info`, `message_info`, `outer_info` and `envelope_ephemeral_info`, §16.2's strings.

Then `events`, in order:
- **A send:** `from` (initiator or responder), `kind` (`first-contact` or `session`), `plaintext`, `chain_key` (before it), `message_key`, `next_chain_key`, `header`, `associated_data`, ENCRYPT's `salt`, `aes_key` and `nonce`, `ratchet_ciphertext`, `inner` (the inner message, unpadded), `envelope_size`, the outer scalar's HKDF output `outer_okm` and the scalar `outer_scalar`, the envelope scalar's `envelope_ephemeral_okm` and the scalar `envelope_ephemeral_scalar` (r), and `envelope`. The salt is a send's only draw: the envelope is v1 (construction.md §4) with b = o and r, its p = [o]p₀, its tag that of [o]V and its c = [r]p.
- **A receive:** `by`, `at` (the reader's now), `delivers` (the index in `events` of the send it reads), `header`, `plaintext`, and `ratchet_step`, null when it made none. A step gives `receiving_dh` (the DH output of the old DHs and the header's key), `root_key` (RK after the receiving half), `receiving_chain_key`, `new_ratchet_secret` and `new_ratchet_public`, `sending_dh` (the DH output of the new key and the header's key), `next_root_key` and `sending_chain_key`. A responder's first step starts from RK = SK and DHs = (x_B, w₀).
- **The responder's first receive** is the request accepted at once: RatchetInitBob, then that message's step, with its draw. Replying later rebuilds the same state, since it replays each stored message with the time it arrived (§16.3, Requests).
- **`plaintext`** is the session layer's input and output, as bytes. The wallet's start with §18's kind byte. These vectors' have none: no plaintext here starts with 0x01 or 0x02, so none reads as §18's text or reveal. The reveal file's `plaintext` has its kind byte (§19.6).

**`base_proof_checks`:** fourteen cases of how a reader takes F and its base proof for a handle (§16.1, §16.2). Each gives its `name`, the `handle` it's checked against (always a valid register), `first_contact` (F) and the `result`.
- **The result** is `ok`, `invalid_base_proof`, or the code of a fault in parsing F. Codes are the crate's errors in snake case, as seedelf-wasm names them.
- **F is parsed first,** field by field as §16.1 lays it out, and the first fault takes §19.3's code for it: `invalid_message` for a length (`to` over 32 bytes, `replaces` not 0 or 16, F too short), an F with neither `to` nor `replaces`, a proof's scalar not below q, or bytes left over; `invalid_encoding`, `not_in_subgroup` or `identity_point` for a point.
- **An F without a `to`** has no proof: it's judged as a continuation (§6, §16.4), never against a handle, so no check holds one.
- **They pin what the sessions don't:**
  - c₁ + c₂ compared with the hash mod q, in F_q: session 4's challenge hash, at least q; the shares swapped; and c₁ + 1 with c₂ − 1, the same sum on other commitments;
  - a commitment at O, which verifies;
  - the reader's own proof, its second branch made with its key alone, which verifies: why F proves nothing to anyone else, given sound draws (§7);
  - the named register, not another of the same key;
  - F′ in the challenge: a proof made without it;
  - z below q: session 1's own proof with z₁ + q, which a reader that reduced z would accept;
  - the parse codes, for F's points and its length, and the order fields are read in: a bad p₀ before a z not below q.

**What the file doesn't pin.** It has no other refusals. These are pinned only by §3, §6 and §16.4's text, and held by the crate's unit tests (session/tests/), not by these bytes:
- the window, and whether its ends are included;
- the stamp's threshold;
- a known cid's F, and a `0x01` refused at its initiator;
- a `0x02` for a request;
- a continuation's verification;
- the keys proof's refusals, and every message of a request on the first's header key;
- the envelope's checks, p = [o]p₀ and c = [r]p;
- MAX_SKIP counted in all, N = 2³² − 1, and a message past the bound authenticated before it's called too far ahead, within MAX_AUTH_STEPS;
- the skipped keys' 48 hours, the 2,000 stored and the order they go in;
- a first-contact header's PN 0 and N below 16, and a request's share at the writer and the reader;
- tombstones and their margin;
- a used key's replay;
- padding's edges, and type bytes: every `0x02` send in the file is 3 to 23 bytes of plaintext, so the file pins only that a short session message is 2,048 bytes. Session 3's `0x01` sends of 1,314 and 1,315 bytes are at a size's edge, and no `0x02` send is. §9's rule at each size's edge, with the conversation's own F and the marker byte, is held by `every_message_is_padded_to_its_first_contact_size` (session/tests/state.rs) alone. `0x02` sends at the edges are to be added to the file before §20's freeze starts;
- several registers for one name, and one of another key's under it.

A `checks` list for them, as the reveal's file has (§19.6), is still to do.

**Checked independently** (2026-11-20): a script written from this section, protocol.md and construction.md alone, without reading the Rust, reproduced every value in all three sessions with noble-curves 2.0.1 for G1 and Node 24's WebCrypto for HKDF-SHA256, HMAC-SHA256 and AES-256-GCM: 281 session values, the labels and sizes, and v1's 40. Where it had to guess, this section now says what it found.

**Checked again** (2026-11-21, after calls 12 and 13), the same way, by a new script that read no Rust: every value in all four sessions, 451 session values and v1's 42 with the labels, and each stamp's nonce found as the first from 0 with 24 bits. Its first pass, over three sessions, showed what the bytes didn't pin: a challenge stored reduced, a step that ignored PN, F with both `to` and `replaces`, and an 8 KiB envelope. Session 4 was added for them, and each wrong reading now changes values. Its notes on the file's fields are folded in above.

**Checked again** (2026-11-22, after b and k were hedged, [joint-security.md](joint-security.md) §9): a new script, written from §3, §16 and construction.md without reading the Rust, reproduced every value of the re-recorded file on its first run: b's and k's messages, HMACs and scalars, and everything that follows from them in all four sessions, each stamp's nonce found as the first from 0 with 24 bits.
- **What it found pinned.** Changing one rule at a time, the bytes pin every part of b's and k's messages, their keys and their reduction. They don't pin the draw order, since the file names each draw (§16.3 now says so), and before `base_proof_checks` they pinned no reader refusal.
- **What it found unwritten,** now folded in above: how c is compared and a T′ of O (§16.2), the labels written plainly, a continuation's `to` (§16.3), "once inside the window" (§16.4), the first receive, session 3, `continues` and the parse codes (here), and §5's rule 2.
- **The checks.** `base_proof_checks` was added for the base proof's reader rules, in three rounds as the script found what each round left unpinned. It judged all thirteen from the text alone.
- **On the final file** it matches 537 of 537, and v1's 43: the sessions' 482 values, the checks' results, and each check's F and handle rebuilt from its own values. The one thing it still had to assume is which y the sign flag selects, which construction.md §4.4 leaves to blst's format; no value depends on it.
  - (2026-11-23) The sign rule is now construction.md §1's, which gives G's coordinates too. It was construction.md's §1, not its §4.4, that named blst's format. Bytes alone can't pin the rule: a decoder and an encoder that both took the other root would hold −P for every P and write every byte the same. G's coordinates pin it: G built from them must encode to the bytes construction.md §1 gives, which v1's cases 1, 2 and 4, session 3's handle and reveal 2's register hold as their generator.

**Since call 16** the file has been re-recorded: F with its designated-verifier base proof and its keys proof, each envelope's derived r, the envelope's tag of w, and session 3 re-planned. Every independent check above was of a file before it; the one below is of the files as they are now. The mutation passes over §3 to §6's rules (security.md, *The session layer*) predate call 16 too. Of call 16's rules, the envelope's c check and the keys proof's nonces have had mutants run against the tests (joint-security.md §10), and so have its rules in §16.4 and §16.5 (2026-11-23): too far ahead, the request's share at both ends, the runs, the tombstones' margin and the versions, 26 mutants, 25 killed. The survivor drops a stored request's bound of 16 messages, which the rule that each N is its own already enforces, since N is below 16; the bound only spares the parse the work. A third pass (2026-11-23, the gate's spec review) ran 30 mutants over call 16's checks, the keys proof's and the base proof's verifiers included: 27 were killed; a join's bound of 16 messages is equivalent, since past the header rules no message reaches it; and p = [o]p₀ and a stored request's header-key rule held only once their tests were added (session/tests/linking.rs, far.rs and keys_proof.rs). The rule that a base proof counts only against a register of the reader's key came after it, with a test that fails without it (keys_proof.rs). What holds the file to §16.2 meanwhile is the crate's own tests, which rebuild from the file alone, without the crate's builders, b and the proofs' nonces with their messages and HMACs, the proofs' commitments, and each envelope's o, r, p and c.

**Checked again, after call 16** (2026-11-23): another model, given only protocol.md, construction.md and the four vector files, without the Rust, wrote a harness that reproduced them: 924 comparisons, no mismatch. **And after §9's padding** (2026-11-24): that harness, changed from that day's spec alone, reproduced the files as they are now: 1,283 comparisons, no mismatch. Neither reproduced:
- the reveal file's stored states and the two F's they hold, which it parsed and checked for consistency only (§19.6);
- the exact bytes of base check 5, of reveal checks 11 and 12, and of relay posts 0 to 3, 9 and 10: their recorded results are confirmed;
- anything at an `0x02` size's edge, since the file has none (above).

**What the spec still leaves unpinned,** as that check found, to settle before §20's freeze starts:
- the recipes and draws of the negative-case fixtures: `base_proof_checks` here, the reveal file's `checks` (§19.6) and the relay file's refused posts (§17.7);
- the handle's register for the reveal file's two conversations (§19.6);
- which refusal wins for an envelope with both a bad length and a bad version (§17.2, §17.7): the relay file's own description reads the version first;
- §16.4's `max_text_len`: "the share's" room is never defined;
- which refusal wins for a first-contact message both too large and past its share;
- §16.5's role byte values, and its integers' byte order;
- §16.1's "and never less than its own inner message", which never binds in v1.

**The crate's tests:**
- `session_vectors_match_the_file` holds the code to the file. `RECORD_MESSAGING_SESSION_VECTORS=1` rewrites it, for a deliberate change of format only (it never touches messaging_v1.json).
- tests/session_vectors.rs reads it through the public API.

## 17. The relay as built (54c)

The relay is a part of the data layer, seedelf-data's `api/src/messaging/`, on the same server, behind the same edge and deploys, with buckets and a monthly traffic ceiling of its own (chunk 54's call 1, the owner, 2026-11-21). The data layer's [README](../../../seedelf-data/README.md#seedelf-messagings-relay) is its reference for operators. This section fixes every byte a wallet sends it and reads from it, so a wallet needs nothing else. Choices made while building are marked [choice].

### 17.1 Pools

- **One per network, named in the path:** `mainnet` and `preprod` (call 4). A Seedelf's x is the same on every network (derivation.rs), so with one pool every wallet would scan and open the other network's messages too, before what they name refused them (§20). Two keep each network's cap, prices and traffic its own.
- **The pool's name is in the stamp** (§17.3), so work done for one pool isn't accepted by the other.
- **The Seedelf Wallet reaches preprod's pool alone for now** (the owner, 2026-11-24): it opens Messages on mainnet in a later release, and §20's freeze starts then.
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
| 4 | **The price** (§17.4) is within its ceiling, and the post fits **the address's window** (§17.4) | 429, with `Retry-After`: `too many posts from this address for now` when the address's own posts took the price past its ceiling, `too many posts to this pool for now` when the floor alone did, and `this address's share of the pool is full for now` for the window |
| 5 | **The stamp** shows at least the price | 402, `{"error": …, "price": <bits>}` |
| 6 | **Room** in the pool | 503 `the pool is full`, with `Retry-After`: when the oldest envelope expires, rounded up to 10 minutes, so 600, 1,200 and so on to 3,600 |
| 7 | **The points:** p (bytes 1 to 48) and c (81 to 128) each canonical, in G1 and not O (construction.md §4.4), so no reader ever parses garbage (call 3). The tag between them (49 to 80) is any 32 bytes: only its reader can judge it | 400, counted against the address's own price (§17.4) |

Kept, the answer is 200 `{"kept": "new", "expires": <Unix seconds>}`, the relay's now and 36 hours, exactly; `already` carries the held copy's `expires`, rounded down to 10 minutes [choice]. The relay's own refusals carry `{"error": "<words>"}`. One more: a 503 `busy`, with `Retry-After`, from an address new to the relay while its prices or its windows already count 200,000 addresses (§17.4).

- **Already held comes before the price** [choice], so a wallet that re-posts its stored bytes after a restart (§4.2) gets 200 even when its address's price has risen since. It tells the poster that the pool holds those bytes, which anyone can learn by downloading it, and when that copy expires to 10 minutes only, so not the second it came (§11).
- **The window comes with the price, before the stamp** [choice], so a post with any nonce, 0 say, learns its wait from the 429 without solving. It's checked again as the post is kept, so posts from one address at once can't pass it together.
- **The points come after the price and room** [choice]: they're the costly check (two subgroup checks), so a sender pays its work, and a full pool refuses, before the relay spends on them. A post refused at them raises its own address's price, so one solved stamp pays for only so many.
- **A 402 is solved again for the same bytes** at the price it names (§10). The wallet marks a message posted on either 200 (§4.2, step 3), and shows "sent, expires at" from `expires`.
- **What the Seedelf Wallet does with the rest** is §20's. Among it: a 408 makes that size wait a minute; a 5xx but 503, which a proxy gives for a relay it can't reach, is no answer, never held against the envelope, and the next posting run starts after it; and a 402 whose price the post's work already meets is an answer it doesn't know, three of which in a row set the envelope aside for its user to send again.
- **The edge** answers before any of this, in this order, each with its words as `error`:
  - a 403 `only Seedelf Wallet reads this` to a browser's request that isn't CORS or comes from an origin that isn't the wallet's (one with neither header passes);
  - a 410 `messaging is stopped` on every `/messaging/` path while Messages is stopped (§20), its body unread;
  - a 503 `over the traffic allowance` once the API's traffic allowance, or the day's share of it, is spent, on every route but `/health`, or `messaging is over its traffic allowance` once messaging's own is, where it has one, each with `Retry-After` 3600;
  - a 400 `this route takes no body` to a request with a body on a route that takes none (1.10.0 sends no body with a `GET`), and a 413 `the body is larger than this route takes` to one whose declared length is past its route's, 8 + 32,768 bytes for a post: both in JSON with CORS, unread, at once, the connection closed;
  - a 429 `too many requests at once`, `Retry-After` 1, past 16 of the address's requests in flight on the relay's routes (an IPv6 address by its /64), each counted until its answer is read; and a 503 `busy`, `Retry-After` 30, past 512 in flight on them from every address;
  - a 429 `slow down`, `Retry-After` its wait, when the address's messaging bucket is empty (300 units, refilled 10 a second: a post costs 4, a page 1 and 1 for every 16 KiB it sends); and a 503 `busy`, `Retry-After` 30, to an address new to the buckets while they count 200,000.

  Then it reads the body whole within 10 s: a 408 `the request's body didn't arrive in time` for one too slow, and a 408 `the request's body didn't arrive` for one that broke off, never a 400; a 413 past the route's limit as it's read. Each closes the connection. In front of it, Caddy refuses a body past 64 KiB with a 413 of its own and closes a connection past the server's 8,192 with a 502, neither with CORS: to a wallet, a fetch that fails. Messaging's buckets and places in flight are its own, so catching up on messages never makes the wallet's other reads wait; and while messaging has a traffic allowance of its own, a flood of messages never spends the rest's.

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

What's counted is units, by a table of the price's own (the owner, 2026-11-23):

| Envelope | Units |
|---|---|
| 512 or 2,048 bytes | 1 |
| 8,192 bytes | 16 |
| 32,768 bytes | 64 |

So a short message padded to 2 KiB (§9) costs what a 512-byte one does, and a long one what it did. The window below keeps its own units, 512 bytes each. Each sending address has a count of its recent units, an IPv4 address whole and an IPv6 address by its /56, so the /64s of one allocation are one address [choice] (a /56 is usually one customer's, though some networks give several customers one), and everyone together has one. Both halve every 10 minutes. A post's price, its own units u counted:

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
- **Kept posts are counted** in both counts, and a post refused at its points (§17.2) in its own address's alone, so no one raises the price everyone pays with posts that are never kept. The counts live in the relay's memory, an address's until it has decayed below a hundredth of a unit (about an hour after one short post), and are never logged or saved.
- **What it means for a sender:** a short message alone costs 18 bits, about 0.1 s; a 32 KiB one, 20. One address can send 31 short messages in a burst before the first extra bit, and stays under the ceiling while its recent units stay under 224: about 15 short messages a minute, kept up until the window below stops it. A busy pool raises everyone's price by a bit for each doubling of its traffic past `quiet`, which at mainnet's numbers is about 100,000 short envelopes a day.
- **What it doesn't stop.** A GPU computes SHA-256 thousands of times faster than a browser, so it outpays the price, though not the window. A sender with many addresses (an IPv6 /48 holds 256 /56s) meets only the floor and a window for each. Such a sender can fill a pool, and posts are then refused until the oldest expire. The cap bounds what that costs the server and every reader. Many addresses can also hold the relay's places in flight (§17.2), and spend messaging's day of traffic by reading alone (§17.5): the edge's totals keep that from the wallet's other reads, but Messages has nowhere else to go. In reserve: a memory-hard puzzle that stays cheap to check (§13), and a larger droplet.

**The window** (2026-11-21). The price slows a sender; the window bounds what one address makes every reader download and scan. For each address, keyed as the price's count is, the relay counts the posts the pool kept from it, as envelopes and as units of 512 bytes, whatever the price counts, hour by hour. Each hour's counts are kept until 36 hours after the hour ends, when everything posted in it has expired. A post that would take the address past either limit is refused:

| Pool | envelopes | units |
|---|---|---|
| mainnet | 1,000 | 4,096 (2 MiB) |
| preprod | 1,000 | 4,096 (2 MiB) |

The owner's [choice], to tune with real use; the same on both pools, so a wallet meets the same limits on preprod.

- **Refused with a 429** whose `Retry-After` is when enough of the address's oldest hours will have aged out for this post, if it posts nothing meanwhile: at most 37 hours. When the price refuses too, the 429 waits for the later of the two.
- **The page says 0** for each size the window refuses now (§17.5), as past the ceiling, so a wallet knows before solving.
- **What it means for a sender:** 1,000 messages in any 36 hours, short or long, and at most 2 MiB of them: 64 of 32 KiB, or 256 of 8 KiB. A burst of 1,000 short ones waits up to 37 hours for the next; spread out, about 27 an hour can go on indefinitely (each hour is counted with the 36 before it). Everyone behind one address shares its window.
- **What it means for a reader:** one address adds at most 1,000 envelopes, about a second of trial scanning at about 1 ms each, and 2 MiB to download. Filling mainnet's 64 MiB pool takes about 32 addresses' windows, of short envelopes or long ones alike, since every short message is 2 KiB (§9).
- **Counts, never envelopes:** an address's entry is how many envelopes and units it posted in each hour, not which. In memory only, never in the pool's file, so a restart starts every window empty, and never logged. The relay keeps at most 200,000 addresses' windows; past it, as for the prices, a new address's post is a 503 `busy`.

### 17.5 Reading

`GET /messaging/v1/{pool}/envelopes`, for the first page, then `?after=<cursor>` with the last page's cursor: a decimal u64 with no sign. Any other query is a 400. The answer is `application/octet-stream`, not compressed, with its true `Content-Length`:

```text
version (1) = 1 | flags (1) | cursor (8) | prices (4) | count (2) | count × (length (4) | envelope)
```

- **Whole envelopes,** in the order they came, at most 256 KiB of them and always at least one when any follows the cursor.
- **cursor:** what to ask from next. Every envelope a pool keeps gets the next number, starting from the Unix time in microseconds when the pool was loaded [choice], so a number says nothing of when its envelope came, and a pool that lost what it held still numbers above every cursor it gave out. A page with nothing more after it carries the last number given out, as an empty page does.
- **flags:** bit 0 (1), another page follows now; bit 1 (2), a gap: something after the cursor is gone (expired, or lost to a crash), or the cursor isn't one this pool gave out, in which case the page starts from the oldest envelope held. A wallet with no cursor is told of no gap.
- **prices:** the bits a post from the reader's address would be asked now, for 512, 2,048, 8,192 and 32,768 bytes in that order; 0 when it would be refused, past the ceiling or past the address's window (§17.4). A wallet solves at these and is spared a 402 unless the price rises before it posts. Where one is 0, a wallet may post with nonce 0 to learn for how long: the relay counts before it checks work, so the 429's `Retry-After` is the real wait (a 402 names the price instead, if the refusal has passed). The Seedelf Wallet does, and counts it down.
- **A day's reading** (§10): what one address, keyed as §17.4's counts are, is sent of a pool's pages in a rolling day, counted by the hour in memory, is at most 512 MiB of mainnet's and 256 MiB of preprod's [choice]. A page counts as it's made, read or not; the page that passes the budget is sent, and after it a page is a 429 `this address has read its share of the pool for the day`, whose `Retry-After` is when enough of the address's oldest hours age out, at most 25 hours. Posts go on. A page's bytes count against the traffic allowance and the edge's bucket as they're handed on, not as its reader receives them: behind Caddy, nearly the whole page.
- **The reserve,** only while messaging has a traffic allowance of its own: once messaging's traffic for the day is down to its last tenth, a page holds what fits in 16 KiB as sent, whole envelopes, with bit 0 set when more follow [choice]. An envelope that can't fit by itself, a 32 KiB one, is a page of its own, up to 32,788 bytes, so no reader stops at it. Each address reads at most 16 MiB of the reserve a day, both pools together [choice], counted as the day's reading is: past it, its pages are the same 429, `this address has read its share of the pool for the day`, whose `Retry-After` is when enough of its oldest hours of the reserve age out, or a minute past midnight UTC, when the next day's share begins, whichever is first. Posts go on.
- **The wallet's loop** (54e): at most 16 pages a sync, one after the other while bit 0 is set, and the rest at the next sync, from where the read ended. The read's cursor is saved once the read and that sync's posts end, in a record of its own, and what the read found is taken afterwards, from a record of the take's (§4.2). On a gap after a cursor of its own, it says that messages sent meanwhile may never arrive. Envelopes read twice are harmless: §5's rules refuse them.

### 17.6 Kept and lost

- **36 hours from when it came:** kept while now < came + 36 h, by the server's clock. A re-post after that is new, with new work (§5, rule 5).
- **Saved** to the server's state directory every minute and at shutdown, and read at start, so a deploy keeps what's waiting (call 2). A shutdown leaves a mark beside each pool's file saying it holds everything. A pool read without the mark tells every earlier cursor of a gap, since what came after its last save is gone. A pool file that can't be read at start is left as it was, and gets no mark until a save of the pool succeeds, so the next start that reads it tells of a gap too.
- **Nothing else is kept:** no recipient, sender, account or key; the counts of §17.4 in memory only; no log of a request (the data layer's README, *What it sees and keeps*).

### 17.7 Vectors

[tests/vectors/messaging_relay_v1.json](../tests/vectors/messaging_relay_v1.json), written by this crate's `relay` module:

- **posts:** 21 envelopes and what the relay makes of each: the four sizes kept; each refusal of §17.2's shape and points (two other versions, five wrong lengths, and each kind of bad point in p and in c), named as `check_envelope` names them; and two envelopes whose tags are all zero bytes and all 0xff, kept, since the tag isn't a point.
- **The layout:** `points_at` (1 and 81, where p and c start) and `tag_at` and `tag_len` (49 and 32).
- **stamps:** six. Each names its envelope in `envelope`, by a post's `name`, and gives the `pool`, the price as `bits`, the `digest`, the `nonce` as a JSON number (the first from 0 that meets the price), the `hash`, its work as `zeros`, and `post`, the post's first 8 bytes: the nonce, big-endian. The whole post is `post` and then that envelope.
- **The constants:** `max_stamp_bits` (32) is `solve_stamp`'s bound (§17.3), not a price: a wallet solves none above 26 bits (§20). `nonce_len` is the stamp's 8 bytes, and `sizes` are §9's four.
- **What the file doesn't pin:** the page (§17.5), which §20 freezes once its freeze starts; §17.2's rows 1, 3, 4, 5 and 6 (the stamps pin a stamp's work, not row 5's refusal); and §17.4's price and window. They're pinned only by §17's text, and held by the relay's own tests (seedelf-data's `api/tests/messaging.rs` and the unit tests in `api/src/messaging/`), not by these bytes. Page vectors are still to do.
- **Checked independently** with the other three vector files (2026-11-23 and 2026-11-24): §16.6 says how, and what of this file wasn't reproduced.
- `relay_vectors_match_the_file` holds the crate to the file, and `RECORD_MESSAGING_RELAY_VECTORS=1` rewrites it, for a deliberate change of format only. The relay's copy of the checks, which the data layer can't take from this crate, is held to the same file (seedelf-data's `api/src/messaging/check.rs`), and its tests post every envelope in it through the whole app.

## 18. The wallet's messages (54e)

What a message's plaintext holds, above the session layer, which takes it as bytes (§16). [choice]

```text
kind (1) | body
```

- **`0x01`: text,** the body UTF-8.
- **`0x02`: a reveal,** the body §19.3's: the writer's Seedelf and its proof (54f). A changed reveal is a new kind, never a changed `0x02`, once §20's freeze starts.
- **Kinds `0x01` to `0x7F` are content.** One a reader doesn't know is kept with its body, inside the history's budget, and shown as a message this version can't show, never guessed at, so a later version can show it. 1.10.0 reads `0x00` and an empty plaintext the same way, so neither is ever a control. A kind added later (a payment request that opens Send filled in, §7) is read by the versions that know it, and said to be unreadable by the rest, as versions before 54f say of a reveal: so it may go to any side (§20).
- **Kinds `0x80` to `0xFF` are control:** what a later version tells the other side's wallet, such as which kinds it reads (§20). In a session message of a conversation the reader holds, one it doesn't know adds no entry, no unread count and no preview. Its ratchet has still stepped: the session layer decrypted it. So it still counts in two places: a first-contact message starts or joins a request whatever it holds (§3.1), which the list shows; and at the side that wrote first, the first session message to decrypt ends its first contact (§3, step 6), though 1.10.0 opens nothing for the user on one its thread doesn't show (§11). No version sends one there to a side that may not read it (§20).
- **The kind byte counts in the text's room:** the longest text a message carries is the session layer's `max_text_len` less one byte. Before a reply, `max_text_len` is held to the request's share too (§16.4).
- **Nothing in a message changes a label or authorizes anything** (§7): a kind is content, as text is.

## 19. The verified reveal (54f)

The side that wrote first may show the other which Seedelf it holds (call 15, the owner, 2026-11-21: "allow alice to reveal but only in the rachet part so its not in the first message"). It's a message of its own kind (§18) carrying a designated-verifier proof bound to the conversation, built in this crate's `session` module (`Conversation::reveal`, `Conversation::verify_reveal`, `Reveal`). Choices made while building are marked [choice].

### 19.1 Who and when

- **Only the initiator reveals, and only once a reply from the other side has decrypted** (it sends `0x02` session messages, §4.1). Its earlier messages are first-contact messages, which a later theft of x_B reads (§1.1), and the other side hasn't answered yet. The crate refuses anything else.
- **Only in a session message.** A reveal is never in F or in a first-contact message. A reader takes one only from a session message (inner type `0x02`) of a conversation it replied in; one inside a first-contact message, or a request's, isn't checked, and shows as a Seedelf that couldn't be verified.
- **Only the responder checks one.** At the initiator a reveal proves nothing: w₀'s key, the other side's, makes one for any Seedelf (§19.2). The crate refuses to check one there.
- **Any of the writer's Seedelfs,** since they all share its key x, and as often as it likes: the latest that verifies names the other side.

### 19.2 The proof

The conversation gives cid, p₀, A = [x_A]p₀ (the initiator's identity) and w₀ = [x_B]p₀ (the responder's). The Seedelf gives its name N, 1 to 32 bytes (the asset name's raw bytes, not hex), and its datum's register (g_S, u_S), with u_S = [x_A]g_S for the writer's key.

**The statement's bytes,** which the challenge and both nonces cover, with every point compressed (48 bytes):

    statement = cid (16) ‖ p₀ ‖ A ‖ w₀ ‖ len(N) (1) ‖ N ‖ g_S ‖ u_S

The statement is an OR of two: **log_{g_S} u_S = log_{p₀} A** (a Chaum–Pedersen proof that the Seedelf's register and A share a key), or **the prover knows log_{p₀} w₀** (a Schnorr proof of the reader's own key). It's a Fiat–Shamir OR-proof (Cramer, Damgård and Schoenmakers, 1994). The writer proves the first and simulates the second.

**The challenge** is SHA-256 over, in order:

    label ‖ statement ‖ T₁ ‖ T₁′ ‖ T₂

with label the ASCII bytes of `Seedelf-Messaging|v1|session|reveal`, with no length or terminator. c is that hash as a big-endian integer, reduced mod q (§16.1). A commitment the reader computes may be O (z₁ = c₁ = 0 makes T₁ and T₁′ O, and such a proof is valid): it's hashed as O's compressed encoding, `0xc0` then 47 zero bytes, the only place in a reveal a point may be O (F's two proofs' commitments may be too, §16.2).

**The writer** (branch 1 real, branch 2 simulated):
1. Draws c₂, then z₂, each uniform in [1, q − 1], then 32 bytes aux [choice: the order, for the vectors]. c₂ and z₂ are drawn alone, not derived: the key doesn't rest on them, and deniability does (§19.5).
2. **The nonce,** hedged: k₁ = HMAC-SHA-512(key = x_A as 32 big-endian bytes, message = nonce label ‖ 0x01 ‖ statement ‖ c₂ ‖ z₂ ‖ aux), its 64 bytes a big-endian integer reduced mod q. The nonce label is the ASCII bytes of `Seedelf-Messaging|v1|session|reveal-nonce`, with no length or terminator, and 0x01 says branch 1 is the one proved. c₂ and z₂ are 32 bytes big-endian. A k₁ of 0 (probability about 2⁻²⁵⁵) draws aux again.
   - **Why hedged:** the message holds everything the challenge covers (the statement, and T₂ through c₂ and z₂; T₁ and T₁′ follow from k₁). So a random source that fails or repeats gives the same proof again, never one k₁ under two challenges, which would give x_A away: z₁ − z₁′ = (c₁ − c₁′)·x_A. x_A also spends the Seedelf. [joint-security.md](joint-security.md), rule 2.
3. T₁ = [k₁]p₀, T₁′ = [k₁]g_S, T₂ = [z₂]p₀ − [c₂]w₀.
4. c from the challenge; c₁ = c − c₂ mod q; z₁ = k₁ + c₁·x_A mod q.

**The reader:**
1. T₁ = [z₁]p₀ − [c₁]A, T₁′ = [z₁]g_S − [c₁]u_S, T₂ = [z₂]p₀ − [c₂]w₀.
2. Accepts if c₁ + c₂ ≡ c (mod q), c computed over these.

**The reader's own reveal.** The responder can make one for any Seedelf, simulating branch 1 and proving branch 2 with x_B: it draws c₁, then z₁, then 32 bytes aux; k₂ = HMAC-SHA-512(key = x_B as 32 big-endian bytes, message = nonce label ‖ 0x02 ‖ statement ‖ c₁ ‖ z₁ ‖ aux) mod q, as the writer's k₁ is, a k₂ of 0 drawing aux again; T₁ = [z₁]p₀ − [c₁]A, T₁′ = [z₁]g_S − [c₁]u_S, T₂ = [k₂]p₀; c₂ = c − c₁ mod q; z₂ = k₂ + c₂·x_B mod q. It verifies like the writer's. That's what keeps a conversation deniable: shown to anyone else, a reveal proves nothing, since the reader could have made it. It holds while the writer's c₂ and z₂ came from a sound random source: the reader's own c₂ is what the hash leaves, so it can't copy a relation a failed source printed in the writer's (§19.5). The wallet never makes one; the vectors do (§19.6).

### 19.3 The bytes

    plaintext = 0x02 | reveal                                         (§18)
    reveal    = len (1) | N (len) | g_S (48) | u_S (48) | c₁ (32) | c₂ (32) | z₁ (32) | z₂ (32)

- **226 to 257 bytes,** 227 to 258 with the kind byte. A Seedelf's name is 32 bytes, so a reveal's plaintext is 258. Its writer pads it to its first-contact size, as every message (§9): always 2 KiB, which holds it with room to spare.
- **The register travels with the name** [choice], so the reader checks the proof before anything reads the chain, and a reveal that doesn't verify reaches nothing.
- **Parsing** reads the fields in order, each refused as it's read: len, which must be 1 to 32; N; g_S, then u_S, each canonical, in G1 and not O (§16.1); then c₁, c₂, z₁, z₂, each below q, and any may be 0; then nothing may follow. Nothing about the conversation changes on a refusal.
- **The codes** (seedelf-wasm's, the crate's error in snake case): len outside 1 to 32, bytes running out at any field or left over after z₂, or a scalar not below q is `invalid_message`; a point that isn't the canonical compressed encoding of a point on the curve (bad flag bits, O's flags with any other bit set, x not below p, no point for x) is `invalid_encoding`, and so are (0, ±2), the points with x = 0 (construction.md §4.4); any other point on the curve outside G1 is `not_in_subgroup`; O, as `0xc0` then 47 zero bytes, is `identity_point`. A proof that doesn't verify is `invalid_reveal`; a check at the initiator, or a reveal made at the responder or before a reply, is `reveal_not_allowed`. The wallet's own rules (§19.1's session message, §19.4's chain register) have no code: they show a reveal as failed.

### 19.4 The reader's checks, in order

1. **A session message** of a conversation in which the reader is the responder (§19.1). The wallet checks the inner type; the crate parses before it checks the side, so a reveal that doesn't parse is refused as §19.3 says whichever side checks it. It checks the side before the proof: at the writer's side the proof is never checked, and any reveal that parses is `reveal_not_allowed`.
2. **It parses** (§19.3).
3. **The proof verifies** for the conversation's cid, p₀, A and w₀ (§19.2).
4. **The register is the Seedelf's now** [choice]: the wallet reads the contract fresh, whole, as Send's pay-by-name reads it, and looks the name up in it, never in a view kept from before the reveal came, which a Seedelf's move would leave behind. Its datum's register must be (g_S, u_S). A register the Seedelf no longer holds fails: a Seedelf can move to another owner. The writer can reveal again.
5. **Then the other side is labelled** "Verified ⟨Seedelf⟩" (§7). Of several, the latest to come that verified names it.

Steps 1 to 3 run as the message is received, in the worker's queue (§4.2), with no request. Step 4 runs only when the user asks, from the thread [choice]: a read of the chain right after a reveal came would tell the server whom it was for. It's one read of the whole contract, out of the queue, for every reveal of that conversation still waiting; one that fails leaves them waiting for the user to ask again. The read comes from the reader's IP address, as Send's does, and made soon after a reveal arrived, it hints to the server that one did. A failure at any step says only that a Seedelf was shown and couldn't be verified, never its name: a name shown unverified would be a tool for phishing.

### 19.5 What it proves, and what it doesn't

- **It proves** that whoever holds the conversation's other identity (R_A, which only its key could have started, §3) holds the key of the register the chain gives the Seedelf's name when it was checked.
- **It proves who holds a key, not who a person is:** "someone with that Seedelf is messaging you". Its use is tying the conversation to a Seedelf the reader already knows: a contact, or someone who posted "message me at ⟨Seedelf⟩".
- **To the reader alone** (§19.2). Not to anyone the reader shows it to, while the writer's random source was sound when it made the proof. If it had failed, the printed c₂ and z₂ can show anyone that branch 2 was the simulated one, and the reveal then reads as a plain proof that its maker holds the Seedelf's key, bound to this conversation's cid, p₀, A and w₀ (§7 has the whole condition).
- **Bound to the conversation:** its challenge holds the cid, both identities, and the Seedelf's name and register, so it can't be moved to another conversation, name or register.
- **It says nothing later.** A Seedelf can move to another owner after it was checked. The reveal's message keeps its time, and the label stands until a later one verifies.
- **It links nothing else.** The writer's other Seedelfs share its key, but no one without that key can tell two registers of one key apart from two keys' (DDH, §2).
- **Forward secrecy** covers it as any message sent after the first reply (§1.1).
- **A stolen x_B shows Bob anything.** A thief of the reader's key can make a reveal for any Seedelf (§19.2) in a conversation it starts with Bob, and Bob's wallet would call it verified. That's key-compromise impersonation, which designated-verifier proofs have by design, and which the static DH already allows for starting conversations (§1.1): whoever has x_B has the Seedelf's funds too. Labels made before a theft stay as they were.

### 19.6 Vectors

[tests/vectors/messaging_reveal_v1.json](../tests/vectors/messaging_reveal_v1.json), written by this crate's `session` module from fixed draws:

- **`conversations`:** two conversations from Alice to Bob's handle, each answered (Alice's first message, Bob's reply, Alice reading it). Each gives `initiator_secret_key` (x_A), `responder_secret_key` (x_B), `cid`, `base` (p₀), `initiator_public` (A), `responder_public` (w₀), and both sides' stored states, `initiator_state` and `responder_state` (§16.5), which are this crate's own, for its public-API test: another implementation needn't read them. The tests' helper started both conversations, stamping at 8 bits (session/tests/support.rs), not §16.4's 24, so each `initiator_state` holds an 8-bit stamp. Reading a stored state doesn't judge its stamp.
- **`reveals`:** three, each with its `conversation` (an index), `made_by` (`initiator` or `responder`), the `seedelf` (`name`, `generator`, `public_value`), its `draws` by name (drawn `c2`, `z2`, `aux` from the initiator and `c1`, `z1`, `aux` from the responder, in that order; the file's keys are sorted), the `nonce` (its `branch`, the HMAC's `message` and its 64-byte output `hmac`, and the `scalar` k₁ or k₂), the `commitments` (`t1`, `t1_seedelf`, `t2`), the `challenge` as SHA-256 gave it and as a scalar (`challenge_scalar`), the `proof` (`c1`, `c2`, `z1`, `z2`), the `reveal`'s bytes and its `plaintext` (with the kind byte):
  1. Alice's Seedelf under its full 32-byte name;
  2. Alice's root register (G, [x_A]G) under a 1-byte name;
  3. Carol's Seedelf, made by the reader with its own key, whose challenge is at least q (the first draws that give one, which the test asserts): it verifies, which is why a reveal convinces no one else (§19.5 says when).
- **`checks`:** 31, each a reveal's bytes, the `conversation` and `side` it's checked at, and its `result`: `ok`, or the refusal's code, the crate's error in snake case as seedelf-wasm names it (`reveal_not_allowed`, `invalid_reveal`, `invalid_message`, `invalid_encoding`, `not_in_subgroup`, `identity_point`). They cover:
  - each reveal at the reader, and two at the writer's side;
  - another conversation of the same two keys, another name, another register of the same key;
  - each share and response moved or swapped, and another key's Seedelf proved with Alice's;
  - a reader's own reveal whose T₁ and T₁′ are O;
  - each way parsing refuses, among them O's flags with a stray bit or the sign flag, a point without the compression flag, and x equal to p;
  - three with two faults at once, to show the order fields are read in: the name before g_S, the points before the scalars, and leftover bytes last;
  - at the writer's side, a reveal that doesn't parse, refused as unparsed (parsing comes before the side), and one that parses but doesn't verify, refused as `reveal_not_allowed` (the side comes before the proof).
- The file also has `version` (1), `description`, `label` and `nonce_label` (§19.2's), `kind` (2) and `group_order` (q, big-endian hex). Every byte string is lowercase hex.
- `reveal_vectors_match_the_file` holds the code to the file. `RECORD_MESSAGING_REVEAL_VECTORS=1` rewrites it, for a deliberate change of format only, and never touches the other vectors files. tests/reveal_vectors.rs reads it through the public API.

**Checked independently** (2026-11-22): a script written from this section, §16.1 and construction.md alone, without reading the Rust, reproduced every value with noble-curves 2.0.1 and Node 24's SHA-256: both conversations' identities, each reveal's commitments, challenge, proof, bytes and plaintext, every check's result, and q, 76 comparisons in all, and again after the checks were added (78). Where it had to guess (which code each refusal is, the order parsing reads in, how O is hashed, the draws' order), this section now says, and the checks of a commitment at O and of the parsing order were added for it.

**Checked again** (2026-11-22, after the hedged nonce, [joint-security.md](joint-security.md) §9): a new script, written from §19, §18, §16.1 and construction.md without reading the Rust, reproduced every value of the re-recorded file on its first run, each nonce's message, HMAC and scalar included. It then changed one rule at a time to see which the file pins, and found five it didn't: the side checked before parsing, the scalars read before the points, leftover bytes read before the points, O's flags with a stray bit taken as O, and x ≥ p. It also found gaps in the text: the statement's bytes weren't defined once, nor N's encoding, x_B's encoding or a zero k₂. This section now says each, and the eight checks after the first 23 were added for them. On the final file it matches 84 of 84: 53 values and 31 checks. Re-recorded the same day for §16.2's derived b, which changes both conversations: the same script matches 84 of 84 again, and every check gives the result it gave.

**Checked again, since call 16,** with the other three vector files (2026-11-23 and 2026-11-24): §16.6 says how, and what of this file wasn't reproduced.

## 20. What 1.10.0 freezes

**The freeze starts when Messages opens on mainnet** (the owner, 2026-11-24). The Seedelf Wallet opens Messages on preprod only for now, so what this section freezes is frozen by the release that opens Messages on mainnet. It names 1.10.0 because that's the version it describes today. Until then a later release may still change a format, or what the relay's v1 routes take and answer, where a review finds a flaw, and preprod's conversations and its pool may then be reset.

No message says which version wrote it, and a writer writing first can't learn which version its reader runs. 1.10.0 stays in use after later versions ship. So toward a side that may run 1.10.0, every later writer sends only what 1.10.0 accepts, within its bounds, and every later reader accepts at least what 1.10.0 writes (call 16). A later reader may accept more than 1.10.0 does, and a later writer may send more to a side that has said it reads it: what two later versions agree between them is theirs. And every relay keeps, on `/messaging/v1/`, what 1.10.0 asks of it and reads from it.

**Formats:**
- **A later format is a new envelope version, inner type or plaintext kind,** never a change to v1's: its envelope, its inner types `0x01` and `0x02`, F, text (kind `0x01`) or the reveal (kind `0x02`), every byte, label and check §16.1, §16.2, §19.2 and §19.3 fix of them, and the rules of §16.4 a writer must meet (the window, the stamp, the header rule, the share and MAX_SKIP). 1.10.0 passes over an envelope of another version before it decodes any point (construction.md §4.2), and refuses an inner type it doesn't know before the ratchet runs (§16.1). That message's key is never derived: once a later message decrypts, it's a skipped key, and the conversation counts it missing from then on (§16.4). The v1 route refuses another envelope version today (§17.2).
- **A writer sends a new envelope version, inner type or first-contact format only to a side that has said it reads it.** 1.10.0 says nothing, so silence means v1. A later version says what it reads in a control kind (§18), never in the two places where 1.10.0 still acts on one:
  - **not in a first-contact message,** alone or joining a request. 1.10.0 starts or joins a request for every first-contact message that authenticates, whatever it holds (§3.1): the request is listed, a join moves it up the list, and a new one can push out the oldest.
  - **not as the first reply to the side that wrote first.** There the first session message that decrypts is the reply, a control kind's too, and ends 1.10.0's first contact (§3, step 6): its messages go as session messages from then, while it holds its user's share, Show my Seedelf and the prompt to start again as they were until a reply its thread shows comes (§11). A later version's first reply there is one 1.10.0 shows, and a control kind follows it.

  A new content kind may go to any side: 1.10.0 keeps it and says it can't show it (below), as §18 plans.
- **First contact stays v1's while `/messaging/v1/` serves.** A writer can't learn which version reads a Seedelf: one key can run in several wallets, and a Seedelf changes hands. So every first message to a handle is a v1 first contact, inner type `0x01`, with what 1.10.0 checks:
  - F as §16.1 lays it out. It's positional, with no length, so a field added to it is garbage to 1.10.0;
  - a stamp of at least 24 bits over F (§16.2);
  - a t that its reader's clock puts inside the window when it's read: now ≤ t + 48 h and t ≤ now + 1 h, both ends included (§16.4). t is the writer's clock (1.10.0 rounds it down to 10 minutes);
  - PN 0 and N below 16 in every header, and at most 16 messages and 64 KiB of their inner messages, unpadded, before a reply (§3.1, §16.4).

  A later reader asks no more of one: at most 24 bits, and at least that window and that share. A first contact of a new type, with limits of its own, goes only where it's known to be read, such as a continuation (§6) between two sides that have both said they read it.
- **Plaintext kinds** (§18). `0x01` to `0x7F` are content: one 1.10.0 doesn't know is kept with its body, inside the history's budget, and shown as a message it can't show. 1.10.0 reads `0x00` and an empty plaintext that way too, so neither can be a control. `0x80` to `0xFF` are control: in a session message of a conversation 1.10.0 holds, one it doesn't know adds no entry, no unread count and no preview, and its ratchet still steps. As the first reply, it's the reply all the same (above).
- **Sizes, padding and the skip** (§9, §16.1, §16.4). Toward a reader that may run 1.10.0, a writer seals only to 512, 2,048, 8,192 or 32,768 bytes, padded with `0x80` then zeros, to the smallest size that holds the message or a larger one. A 1.10.0 writer pads every message, either side's, to its first-contact size (§9), so a reply's coming changes no size it sends. A later writer may pad less, and 1.10.0 reads it; but one that pads a conversation's messages to the smallest size again brings back what §9 closed: its next short post after a reply tells the relay that one came. One message never makes that reader skip more than MAX_SKIP = 1,000 keys, counted in all as §16.4 counts them. Every message the reader can't decrypt (lost, expired, or of a type it doesn't read) is a key it skips: after more than 1,000 of them in a row the conversation can't go on. 1.10.0 then says it can't continue when the next message to reach it is at most 4,096 keys ahead (MAX_AUTH_STEPS), and drops one further ahead without a word. A later reader takes at least the four sizes, padded up, and a skip of 1,000 in all; it may take more. 1.10.0's own are its 2,000 stored skipped keys, each kept 48 hours, and its 50 requests and 256 KiB of them a network: a writer can't count on more room out of order than that, nor on a request being kept.
- **No label names the network,** and a Seedelf's key is the same on every network (§17.1). So a copy of an envelope from one pool, stamped again for the other, is that network's reader's to scan and open. It's refused there by what it names, silently: a Seedelf that isn't a handle on that network (a Seedelf's name holds part of the ID of a transaction on its own chain, so it's a Seedelf on one network only), or a cid that network's inbox doesn't hold. That holds while every reader keeps its handles, conversations, requests and tombstones per network. A later format may bind the network in what it authenticates.

**The relay** (§17). 1.10.0 has the relay's origin built in, one for both pools, and reaches it with no host permission of its own, through CORS. Its content security policy lets it reach the relay at that origin and nowhere else, so a redirect elsewhere fails: the relay answers there, both pools, for as long as a 1.10.0 wallet may ask, and a pool or a route that's retired answers 410 there for good. Where Chrome's access to sites, which the dApp connector asks for, is granted, CORS doesn't apply, and 1.10.0 reads the answers of whatever is in front of the relay too.
- **The routes:** `GET` and `POST /messaging/v1/{pool}/envelopes`, the pool `mainnet` or `preprod`. A post is §17.2's body, the nonce (8, big-endian) then the envelope, as `application/octet-stream`, its work §17.3's stamp, unchanged. 1.10.0 sends no body with a `GET`. A v1 relay may come to keep more than it does now, but never refuses for good a post it keeps now, and never changes the puzzle: a new puzzle or a stricter check is a new route over the same pools.
- **CORS:** every answer carries CORS headers for the wallet's origin, refusals and the 410 included, and a post's preflight is answered. `Retry-After` is exposed: unexposed, 1.10.0 reads every wait as a minute.
- **A true `Content-Length`,** where an answer has one: 1.10.0 refuses an answer whose length says it's past its bound before it reads a byte. Every JSON answer stays under 4,096 bytes and arrives within 30 s of its head.
- **The page** is a 200 of version 1: its 16-byte header, prices for the four sizes in that order, a count, then each entry as a 4-byte length and its bytes, with nothing after the last. Whole entries, at least one whenever a v1 envelope follows the cursor, at most 256 KiB of them, unknown lengths included, and 264,208 bytes in all. A bound that cuts pages shorter, as the reserve does (§17.5), keeps whole entries, and sends an envelope longer than its cut as a page of its own: a refusal there would stop every 1.10.0 reader at that cursor.
  - **1.10.0 refuses, whole, a page whose layout or bounds break.** It says the relay can't be reached and asks the same cursor at its next sync, so such a page stops it there for as long as the pool serves it.
  - **It steps over an entry whose length isn't one of the four sizes,** and never reads it again. It reads flag bits 0 and 1 only: a later relay sets bits 2 to 7 only for what a 1.10.0 reader may ignore, and a page that must be read another way is a new page version on a new route.
  - **The cursor** is the page's big-endian u64, sent back in decimal as `?after=`; the first page is asked with no query. Every `after=` that is a decimal u64 gets a page, never a 400: a cursor above every number the pool has given out (after a move, or a lost file) starts from its oldest envelope with bit 1 set, and a page with nothing more after it, an empty one included, carries the last number given out. 1.10.0 checks neither that cursors grow nor that entries come in order: one numbering covers every v1 envelope a pool holds, whichever route posted it, and a cursor never passes one not yet sent. A v1 page may leave out entries a 1.10.0 reader can't read. Bit 0 is set only when another page follows now, and a page that sets it moves the cursor: one that doesn't ends that sync's read. Bit 1 is read only after a cursor of the wallet's own, and a gap is told across the relay's restarts (§17.6).
  - **The prices:** 0 is refused for now, and 1.10.0 then posts that size with nonce 0 to learn its wait. A price above 26 bits makes that size wait a minute, for the next page to say again.
  - **Its pace:** at most 16 pages a sync, the rest at the next; a sync each minute while unlocked, and every 10 s while a wallet page is on screen. It waits 30 s for a page's head and 120 s more for its body. It keeps its pace on the monotonic clock, so a device clock set back holds no request.
  - **What that pace needs of the relay:** 1.10.0 paces itself to 280 units in any 30 s, a page counted as 17 and a post as 4, inside the edge's messaging bucket of 300 units refilled 10 a second (§17.2); a stingier bucket or heavier weights meet its own pace with `slow down`, which it shows as the relay unreachable. Every wallet behind one address shares its bucket and its places in flight, and 1.10.0 has at most a page and a post in flight a network. It pads every short message to 2 KiB, which today's relay prices as one unit, as it does 512 bytes (§17.4): a relay that priced 2 KiB by its bytes would bring chat to its ceiling four times sooner. A page's body has the 120 s 1.10.0 waits, so a full page arrives at about 18 kbit/s, where the relay gives it as long; today's proxy gives an answer 60 s, about 35 kbit/s. A post's body has 10 s today at the proxy and the edge, about 26 kbit/s up for 32 KiB: a slower one is cut off, a 408 or no answer (below). And 16 pages a minute read a full pool within its 36 hours only while pages that say more follows hold about 2 KiB or more on average (256 KiB today, 16 KiB under the reserve), and while an address's day's reading is more than a full pool (eight times, today).
- **A post's answers:** the head within 30 s. 1.10.0 reads a body only from a 200, a 402 or a 429, a JSON object of at most 4,096 bytes in within 30 s more, and of it only `kept`, `expires`, `price` and `error`: a later relay may add fields.
  - **200:** `expires` is a JSON number of Unix seconds. `kept` is exactly `"new"` for an envelope kept now, and its `expires` is then the relay's now and 36 hours, which 1.10.0 measures its clock against (§17.6). It takes any other `kept` as already held.
  - **402:** `price` is a whole number of bits, more than the post's work showed: a 402 that names no more is an answer 1.10.0 doesn't know (below). 1.10.0 solves the same bytes again at it, up to four posts in a run. Past 26 bits it waits instead: the 402's `Retry-After`, or a minute.
  - **429,** by its `error`, word for word: `too many requests at once`, every request to the relay waits a second; `slow down`, every post of that network waits its `Retry-After`, and every request to the relay up to a minute; any other words, or none (a body that doesn't read among them), only posts of that envelope's size wait, for its `Retry-After`. So a size's refusal never uses the edge's two, and a refusal of every post is a `slow down` or a 503.
  - **The three strings** 1.10.0 branches on, `too many requests at once`, `slow down` and `this address has read its share of the pool for the day` (a page's, below), are frozen byte for byte. A relay's own words for its other 429s may change, but never into one of them.
  - **503:** every post of that network waits its `Retry-After`. Every bound a relay adds answers this way, a 503 with a short `Retry-After`, as `busy` does with 30: never a 400, a 413, a 429 with new words, an empty page that says more follows, or a cursor past a v1 envelope not yet sent.
  - **408:** that size waits a minute. A body that came slowly or broke off is a 408, or the connection closed, never a 400.
  - **400 or 413:** never to be posted. 1.10.0 keeps the bytes and posts them again only when its user asks. So nothing answers either to a post that could be kept later: not for a policy, for capacity, or for a body that came slowly or broke off.
  - **410:** the off switch (below).
  - **No answer:** a fetch that fails, no head within 30 s, a 200's or 402's body past 4,096 bytes or later than 30 s, a run's fourth 402, and any 5xx but 503. The run stops there, and the next starts after that envelope, which goes again later and is never set aside.
  - **Anything else,** another status or a body that doesn't read, is an answer 1.10.0 doesn't know: the run stops there, the next starts after that envelope, and after three in a row within an unlock it's set aside for its user to send again.
- **A page's other answers:** a 410 is the off switch. A 429 whose `error` is exactly `this address has read its share of the pool for the day` holds that pool's pages for its `Retry-After`, at most 25 hours (a minute without one), while posts go on: so every refusal of a page for the day, whatever its key (an address, its share of the reserve), is that 429, or 1.10.0 asks again at every sync. Today the only refusals of a page for the day that aren't that 429 are the server's own allowance, for everyone: the 503s `messaging is over its traffic allowance` and `over the traffic allowance`, `Retry-After` 3600. `too many requests at once` holds every request a second and ends that sync's read, saying nothing; any other 429 holds every request for its `Retry-After`, at most a minute, and says the relay can't be reached. Any other answer, a 503 among them, says the relay can't be reached, and the page is asked again at the next sync, whatever its `Retry-After`.
- **`Retry-After`** is a positive whole number of seconds. 1.10.0 reads it as a number, and a missing, zero, negative or unreadable one (an HTTP date) as a minute; it waits at most 37 hours on a post's, and 25 hours on the day's reading. It keeps a post's waits in memory, and, until a lock, in session storage, with its strikes and where its next run starts, by each envelope's stamp digest: a worker Chrome starts again goes on from them. The work it solved is kept only while its worker runs, and Chrome stops an idle worker after about 30 s: a worker started again solves the same bytes again, and one started after a lock, with no copy of the waits, may ask inside a `Retry-After`, as often as each minute's sync, and the relay answers as before.
- **Kept and lost** (§17.6): an envelope is kept 36 hours from when it came, by the relay's clock, and a fresh answer's `expires` is exactly the relay's now and 36 hours: 1.10.0 measures its clock against it, and any other figure shows its user a clock that's off. An envelope already held is answered `already`, with when its copy expires, rounded down to 10 minutes, and isn't kept longer for it.
- **The off switch:** a 410 on any route under `/messaging/v1/`, whatever its body. 1.10.0 then stops that network's Messages: it starts no solve or post there, a solve under way gives up, and it asks one page an hour until a page gets an answer other than a 410; a page that gets no answer is asked again at the next sync. A lock ends the stop: each unlock's first sync asks a page as any does, and a message sent before that page's answer can still be posted, and gets the 410 too. So a stopped relay answers 410 on every v1 route, posts included, until it's back.
- **1.10.0 solves no price above 26 bits,** about 30 s of a browser's time on average: room above the pools' 24-bit ceiling (§17.4), so the ceiling can be raised that far and 1.10.0 still pays it. The first-contact stamp is apart: always 24 bits.

**Time.** Every first-contact rule runs on the two device clocks: t is the writer's (1.10.0 rounds it down to 10 minutes), and now is the reader's. The relay's clock decides only how long it keeps an envelope. 1.10.0 measures its own clock against a fresh answer's `expires`, and only says how far off it is: nothing runs on the relay's time.
