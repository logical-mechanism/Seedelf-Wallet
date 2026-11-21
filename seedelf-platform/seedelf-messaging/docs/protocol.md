# Seedelf Messaging: the one-to-one protocol (draft)

The draft for review: conversations, forward secrecy and post-compromise security, built on the v1 envelope of [construction.md](construction.md). Only that envelope is built. Everything else here is a design to agree on before any chunk work.

Notation is construction.md's: additive G1 of BLS12-381, [k]P for scalar multiplication, registers (g, v) with v = [x]g.

## 0. Decided (the owner, 2026-11-20)

| Area | Decision |
|---|---|
| Key encapsulation | ECIES on re-randomized registers: the v1 envelope. |
| Long-term key | The Seedelf's own key x. A Seedelf is the handle: "message me at ⟨Seedelf⟩". |
| Identities | The sender of a first message makes both conversation identities. |
| First message | Protected by the recipient's long-term key alone. No prekeys, so the relay holds no key material. |
| Relay | Keeps envelopes 36 hours, then deletes them. Proof of work against spam. Senders' IP addresses are seen, as the data layer already sees them. |
| Local state | Conversations live in the browser. Deleting the wallet's data loses them. |
| Proving who you are | Undecided until users ask for it (§9). |
| Groups | Later, on top of one-to-one sessions. |
| Post-quantum | Later. |

## 1. Layers

Every message is three layers deep:

1. **Discovery.** The envelope's register (p, w) is a fresh re-randomization of one of the recipient's registers. The recipient tests [x]p = w: one scalar multiplication per envelope, however many conversations they have.
2. **The outer envelope:** v1 as built. ECIES to (p, w), opened with [x]c. Every envelope has this one format, so the relay can't tell a first message from a reply. It also hides the conversation ID and the ratchet header from everyone without x. Its key is static, so it gives no forward secrecy.
3. **The inner message:** the Double Ratchet (§4), whose keys give forward secrecy and recover after a compromise.

**If x is stolen,** the thief can find every envelope addressed to x and open the outer layer of each. That reveals conversation IDs, ratchet public keys, counters, and the content of first messages (§3). It doesn't reveal the content of anything sent after a first reply. x is also the spending key, so the Seedelf's funds go with it.

## 2. Identities

- **The handle.** A Seedelf's datum register (g_S, [x]g_S) is public on chain. Alice reads it through the data layer, so the binding from handle to register is only as honest as that read. This is the trusted-source limit already accepted for paying by name.
- **Conversation identities.** Alice makes both, because a re-randomization needs no secret:
  - **R_B, "random Bob":** the register of Alice's first envelope, (p₀, w₀) = ([b]g_S, [b]v_S). It's Bob's, found by his usual scan, though he didn't make it.
  - **R_A, "random Alice":** a re-randomization of any register of Alice's: her Seedelf's datum register, or her root register (G, [x_A]G) if she has no Seedelf. Bob's replies to it are found by her usual scan.
- **Linking.** No one without x can link a conversation identity to a Seedelf or to another conversation (DDH in G1).
  - Alice knows R_B is Bob's, since she chose him.
  - Bob knows R_A only as a stranger.
- **Addressing.** Every later message to Bob goes to a fresh re-randomization of R_B, and every message to Alice to one of R_A.
- **Which handle.** Bob's Seedelfs all share x, and a re-randomization hides which of them it came from. So Bob can't tell which handle Alice wrote to unless she says. The first message carries an optional `to` field (§3).

## 3. The first message (Alice → Bob)

Alice holds Bob's handle register (g_S, v_S).

1. **The outer envelope's points.** It fixes R_B = (p₀, w₀), its ephemeral c₀ = [e]p₀ and the shared point z₀ = [e]w₀ = [x_B]c₀ (construction.md §4.1).
2. **The session secret.**

       SK = HKDF-SHA256(salt = "Seedelf-Messaging|v1|session|salt", ikm = z₀,
                        info = "Seedelf-Messaging|v1|session|SK" ‖ header₀)

   header₀ is the outer header, and the separate labels keep SK apart from the outer layer's own key.
3. **Starting the ratchet,** as the Double Ratchet specification's `RatchetInitAlice`, with Bob's conversation identity standing in for a signed prekey. Bob's initial ratchet key pair is (x_B, w₀) on the base p₀. This is the "long-term key only" decision.
   - Alice draws s_A and sends S_A = [s_A]p₀.
   - She computes (RK, CKs) = KDF_RK(SK, [s_A]w₀).
4. **The inner message:**

       0x01 | cid (16) | to (1 + 0–32) | R_A (96) | ratchet header (56) | ratchet ciphertext

   - **cid:** a random 16-byte conversation ID.
   - **to:** a length byte, then the handle's asset name (empty allowed).
   - **The ratchet header** is S_A ‖ PN ‖ N: a 48-byte point and two big-endian u32 counters.
   - **The ratchet's associated data** is cid ‖ R_A ‖ R_B ‖ ratchet header, which binds both identities to every message, as X3DH's AD does.
5. **Sending.** The inner message is padded (§6) and becomes the outer envelope's plaintext.

**Bob's side.** Bob finds the envelope, opens the outer layer, and sees `0x01` and a cid he doesn't know: a message from a stranger. He runs `RatchetInitBob(SK, (x_B, w₀))` and decrypts.

- **Accepting** is a matter of replying. Ignoring is silence, and Alice learns nothing either way.
- **Until Bob replies,** every message Alice sends is keyed from secrets that x_B alone can rebuild: there's no forward secrecy against a later theft of x_B. Bob's first reply brings in his fresh ratchet key, and from then on there is.

## 4. Session messages

The Double Ratchet runs as specified, with these choices:

| Piece | Choice |
|---|---|
| DH | G1, on the conversation's base p₀: a key pair is (s, [s]p₀), and DH(s, P) = [s]P, compressed. A received point must be canonical, in G1 and not O. |
| KDF_RK(rk, dh) | HKDF-SHA256(salt = rk, ikm = dh, info = "Seedelf-Messaging\|v1\|ratchet\|root"), 64 bytes: the new root key, then a chain key. |
| KDF_CK(ck) | HMAC-SHA256(ck, 0x01) is the message key; HMAC-SHA256(ck, 0x02) is the next chain key. |
| ENCRYPT(mk, m, ad) | AES-256-GCM, with key and nonce = HKDF-SHA256(ikm = mk, info = "Seedelf-Messaging\|v1\|ratchet\|message"), 44 bytes. Each mk is used once. |
| Header encryption | None: the outer layer already hides the header from everyone without x. |
| MAX_SKIP | 1,000 skipped keys per chain, each deleted 48 hours after it was stored. The relay keeps nothing longer than 36 hours, so a skipped message can't arrive later than that. |

The inner message is:

    0x02 | cid (16) | ratchet header (56) | ratchet ciphertext

The associated data is cid ‖ R_A ‖ R_B ‖ ratchet header, as in §3. It goes to a fresh re-randomization of the recipient's conversation identity.

**The recipient:**
1. Scans.
2. Opens the outer layer with [x]c.
3. Looks up the cid.
4. Runs the ratchet.

An unknown cid on a `0x02` message is a conversation this browser no longer has, for instance after the wallet's data was deleted. The wallet says so; that conversation needs a new first message.

## 5. What each message costs

| Step | Work |
|---|---|
| Scanning | Two subgroup checks and one scalar multiplication (`matches_envelope`). About 0.18 ms per envelope natively (README). |
| A matched envelope | The full parse's three subgroup checks, one more multiplication for the outer layer, three when it starts a ratchet step (a new key pair and two DH), and symmetric work. |
| A first message | Eight multiplications to send: the outer envelope's four, R_A's two, S_A and its DH. Three to receive, plus checks on R_A and S_A. |

## 6. Size and padding

- **Overhead:**
  - The outer layer adds 161 bytes.
  - The inner message adds 89 bytes (`0x02`) or 186–218 (`0x01`).
- **Padding:** the inner message is padded to one of a few fixed sizes, so envelopes come in a handful of lengths. The relay can't tell first messages from replies or short messages from long ones, beyond the bucket.
  - The method: 0x80, then zeros, stripped on reading.
  - The sizes are open (§10); for instance envelopes of 0.5, 2, 8 and 64 KiB.

## 7. The relay

Phase 2 settles the details; the protocol needs only this:

- **The relay stores bytes.** It keeps no recipient, sender, account or key.
- **Envelopes are deleted after 36 hours.** Deleting doesn't unsend: anyone who downloaded the pool keeps copies. What protects old envelopes is forward secrecy, not deletion.
- **Every envelope carries proof of work** over its own bytes, so the work can't be reused. The difficulty is the relay's to raise.
- **Clients download everything after their cursor.** At 10,000 envelopes a day, 36 hours is about 15,000 envelopes: roughly 7.5 MB at 0.5 KiB each, and about 2.7 s to scan natively for a fresh sync.

**What 36 hours means:**
- A recipient offline for longer misses whatever was sent meanwhile, first messages included, and the sender can't tell.
- The ratchet survives the gap, because the counters let the next message decrypt; the lost messages are simply lost.
- The sender's client should show a message as sent, with when it expires, never as delivered.
- Delivery receipts would be messages of their own: possible later.

## 8. Local state

**Per conversation:**
- cid, R_A and R_B.
- The other side's handle, if `to` or a claim named one.
- The ratchet state: RK, CKs, CKr, DHs, DHr, Ns, Nr, PN, and the skipped keys.
- The message history.

**Storage and loss:**
- It's stored in the browser, encrypted under the wallet's vault key.
- Deleting the wallet's data deletes it.
- Restoring from the recovery phrase brings back x, so new first messages work and old handles still receive. It doesn't bring back any conversation.

## 9. Proving who you are

Alice is anonymous by default.

- **She can always say who she is in a message.** Bob's wallet shows that as her claim, never as verified.
- **A proof that R_A belongs to her Seedelf stays undecided until users ask for it.** Two designs are open:
  - **A plain Chaum–Pedersen proof** that R_A and her Seedelf register share a key. Bob can show it to anyone, so it's evidence of who wrote to him.
  - **A designated-verifier proof.** It convinces only Bob, because Bob could have made it himself, which keeps the conversation deniable as Signal's are.

## 10. Open, to settle before or during the chunks

- **Proof of work:** the function (a plain hash, or a memory-hard one against GPUs) and the starting difficulty: seconds of a laptop's time in WebAssembly, measured, not guessed.
- **Padding sizes.**
- **MAX_SKIP and the lifetime of skipped keys,** checked against 36 hours.
- **How long a browser keeps message history,** and whether the user picks.
- **What the wallet does with a stranger's first message:** shown, collapsed, or held for the user.
- **Test vectors for the session layer,** checked by an independent implementation as v1's were.
- **A model of §3 and §4** in a protocol verifier (ProVerif or Tamarin) before mainnet, then an outside review.

## 11. Against Signal

| | Signal | Here |
|---|---|---|
| Who the server knows | Each message's recipient, and partly its sender | Neither: an envelope names no one |
| First message | Forward-secret through prekeys | Long-term key alone until the first reply |
| Later messages | Double Ratchet | Double Ratchet, the same guarantees |
| Ratchet header | Plain, or encrypted in the header-encryption variant | Inside the outer layer |
| Identity | A phone number or username, with safety numbers | A Seedelf handle. The sender is anonymous unless they claim or prove a handle. |
| Deniability | Yes | Yes, unless a proof Bob can show others is added (§9) |
| Message lifetime on the server | Until delivered, with a limit | 36 hours, delivered or not |
| Groups | Sender Keys | Later |
| Post-quantum | Yes (PQXDH and the ratchet's additions) | Later |
| Multi-device | Yes | No |

## 12. Phases

| Phase | What |
|---|---|
| 1 | Done: the v1 envelope. |
| 2 | The relay: storage, the 36-hour expiry, proof of work, the cursor. |
| 3 | Sessions: §3 and §4 in this crate, with vectors, property tests and the protocol model. |
| 4 | The wallet: WebAssembly bindings, encrypted local state, a Messages screen, and "message me at ⟨Seedelf⟩". |
| Later | Proving who you are, groups, post-quantum, delivery receipts. |
