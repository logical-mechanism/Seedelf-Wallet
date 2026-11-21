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

**The 2026-11-20 review** added:
- the session secret drawn from the first-contact block, which every message carries until the first reply (§3);
- the state rules and per-message randomness (§4.2);
- duplicates and replays (§5);
- lost messages and conversations (§6);
- sender labels (§7);
- the WebAssembly costs (§8);
- what the relay learns (§11).

It also raised the trade between unlocking and the expiry: 36 hours stands (§13).

## 1. Layers

Every message is three layers deep:

1. **Discovery.** The envelope's register (p, w) is a fresh re-randomization of one of the recipient's registers. The recipient tests [x]p = w (`matches_envelope`), one test per envelope however many conversations they have.
2. **The outer envelope:** v1 as built. ECIES to (p, w), opened with [x]c. Every envelope has this one format, so the relay can't tell a first message from a reply. It also hides everything inside from everyone without x. Its key is static, so it gives no forward secrecy.
3. **The inner message:** the Double Ratchet (§4), whose keys give forward secrecy and recover after a compromise.

**If x is stolen,** the thief can find every envelope addressed to x and open the outer layer of each. That reveals conversation IDs, ratchet public keys, counters and first-contact blocks. It also reveals the content of messages sent before a first reply, because their keys come from x (§3). It doesn't reveal the content of anything after a first reply. x is also the spending key, so the Seedelf's funds go with it.

## 2. Identities

- **The handle.** A Seedelf's datum register (g_S, [x]g_S) is public on chain. Alice reads it through the data layer, so the binding from handle to register is only as honest as that read. That's the trusted-source limit already accepted for paying by name.
- **Conversation identities.** Alice makes both, because a re-randomization needs no secret:
  - **R_B, "random Bob":** (p₀, w₀) = ([b]g_S, [b]v_S), a re-randomization of Bob's handle register. It's Bob's, though he didn't make it.
  - **R_A, "random Alice":** a re-randomization of any register of Alice's: her Seedelf's datum register, or her root register (G, [x_A]G) if she has no Seedelf.
- **Linking.** No one without x can link a conversation identity to a Seedelf or to another conversation (DDH in G1).
  - Alice knows R_B is Bob's, since she chose him.
  - Bob knows R_A only as a stranger.
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

       F = cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | R_A (96) | R_B (96) | E_A (48)

   - **t:** when Alice started the conversation, in Unix seconds, big-endian.
   - **to:** a length byte, then the handle's asset name (empty allowed).
   - **replaces:** a length byte, then the cid of a conversation this one replaces (§6), or nothing.
3. **The session secret** comes from F, not from any one envelope:

       SK = HKDF-SHA256(salt = "Seedelf-Messaging|v1|session|salt", ikm = [e_A]w₀,
                        info = "Seedelf-Messaging|v1|session|SK" ‖ F)

   Bob computes the same input as [x_B]E_A.
4. **Starting the ratchet,** as the Double Ratchet specification's `RatchetInitAlice`. R_B stands in for a signed prekey: Bob's initial ratchet key pair is (x_B, w₀) on the base p₀, which is the "long-term key only" decision. Alice computes (RK, CKs) = KDF_RK(SK, [s_A]w₀).
5. **Every message until Bob's first reply** is a first-contact message:

       0x01 | F | ratchet header (56) | ratchet ciphertext

   - **The ratchet header** is S_A ‖ PN ‖ N: a 48-byte point and two big-endian u32 counters.
   - **The associated data** is cid ‖ R_A ‖ R_B ‖ ratchet header, binding both identities to every message, as X3DH's associated data does.
   - **Sending:** the message is padded (§9) and sealed in an outer envelope to a fresh re-randomization of R_B.
   - F, E_A and S_A stay the same in each. Alice switches to `0x02` once a reply from Bob decrypts.

**Bob's side,** for a `0x01` whose cid he doesn't know:
1. Refuse it if t is more than 48 hours old or more than an hour ahead (§5).
2. Check that R_B is his: [x_B]p₀ = w₀.
3. Check that every point in F is canonical, in G1 and not O.
4. Derive SK from [x_B]E_A, run `RatchetInitBob(SK, (x_B, w₀))`, and decrypt.

If any step fails, nothing is stored.

- **Whichever message arrives first starts the session.** Its counter N shows how many came before it, whether they expired or are still to come.
- **Accepting** is a matter of replying. Ignoring is silence, and Alice learns nothing either way.
- **Until Bob replies,** every message Alice sends is keyed from secrets x_B alone can rebuild: there's no forward secrecy against a later theft of x_B. Bob's first reply brings in his fresh ratchet key, and from then on there is.

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
| MAX_SKIP | 1,000 skipped keys per chain, each deleted 48 hours after it was stored. Nothing reaches the relay's readers later than 36 hours. |

Inside the outer layer, a session message is:

    0x02 | cid (16) | ratchet header (56) | ratchet ciphertext

The associated data is cid ‖ R_A ‖ R_B ‖ ratchet header, as in §3. It goes to a fresh re-randomization of the recipient's conversation identity.

**The recipient:**
1. Scans.
2. Opens the outer layer with [x]c.
3. Looks up the cid.
4. Runs the ratchet.

### 4.2 State rules

**Reusing a message key is the one mistake the ratchet can't survive,** and an extension makes it easy: two screens sending at once, or a worker stopped between posting an envelope and saving its state.

- **One writer.** The wallet's background worker owns every conversation's state. Screens ask it to send and receive, and nothing else writes the state.
- **Save before sending.** Advance the chain, save the new state, then post. If posting fails, post the same envelope bytes again, or encrypt anew under the next key. Never encrypt anything else under a key already used.
- **Save after reading.** Decrypt, then save the advanced state and the message together. A worker stopped before saving decrypts the same envelope again next time, which is harmless.
- **A safety net.** ENCRYPT's random salt means that even a bug that used a message key twice would give two different AES keys, not a repeated key and nonce.

## 5. Duplicates and replays

1. **A `0x01` for a cid the reader already has** is a ratchet message of that conversation. It never starts the conversation again.
2. **A `0x01` for an unknown cid** is refused if its t is more than 48 hours old or more than an hour ahead. An envelope kept past the relay's 36 hours and posted again starts nothing.
3. **A deleted conversation's cid is remembered for 48 hours,** so its first-contact messages don't come back as a stranger's.
4. **A ratchet message whose key was used or deleted is dropped.** A replayed session message does nothing.
5. **The relay drops an envelope whose exact bytes it already holds.**
6. **Both sides writing first at once makes two conversations.** Each is valid, and the wallet shows both.

## 6. Lost messages and lost conversations

- **An expired message** leaves a gap in the counters. When a skipped key reaches its 48 hours unused, the wallet can say "1 message in this conversation expired before it arrived", which is better than nothing.
- **A lost conversation** (the wallet's data deleted, or a new browser) can't be read. An `0x02` for an unknown cid shows as a message from a conversation this browser no longer has. To go on, either side that still knows the other's identity starts a new conversation (§3):
  - Alice can always write to Bob's handle.
  - Bob can write to R_A only if he still has it.
- **Linking the new to the old.** A new conversation may name the old cid in `replaces`. If the reader still has that conversation, the wallet shows the new one as its continuation. Only the two parties, and a holder of their x, ever see a cid, because it travels only inside the encryption.

## 7. Who a sender is

What the wallet says about the other side, and what it never does:

- **To the one who wrote first:** the other side is the owner of the handle they wrote to. Only that key can read the first message, so any reply that decrypts in the conversation came from it.
- **To the one written to:** the other side is a stranger. If Alice's messages say who she is, that's shown as her claim, never as verified, and no message's content changes the label.
- **`to`** shows which of the reader's handles a first message named.
- **Nothing in a message starts a payment or a signature.** A payment request, if one ever becomes a message type, opens the ordinary Send screen filled in, under the sender's label, and is confirmed there like any payment. These are labels, not blocks: the user decides.
- **Proving a handle stays undecided until users ask for it.** Two designs are open:
  - **A plain Chaum–Pedersen proof** that R_A and Alice's Seedelf register share a key. Bob can show it to anyone, so it's evidence of who wrote to him.
  - **A designated-verifier proof.** It convinces only Bob, because Bob could have made it himself, so the conversation stays deniable, as Signal's are.

## 8. What each message costs

Measured on the same machine as the README: an Intel Core i5-12400F, one thread. The WebAssembly figures come from a scratch harness built the way the wallet builds its module (wasm-bindgen 0.2.128, clang 21, the `wasm-release` profile) and run in Node 24, whose V8 is Chrome's engine. The wallet's size-optimized profile measured the same as `-O3`.

| Step | Native | WebAssembly |
|---|---|---|
| Scan an envelope (`matches_envelope`) | 0.18 ms | 1.02 ms |
| Full parse | 0.16 ms | 0.88 ms |
| Open a match (full parse, then decrypt) | 0.31 ms | 1.77 ms |
| Encrypt an envelope | 0.31 ms | 2.2 ms |

**Scale:**
- A 36-hour pool at 10,000 envelopes a day (about 15,000) takes about 2.7 s to scan natively and about 15 s in the wallet on a fresh sync.
- Keeping up scans only what's new, about 10 s of work a day at that rate.
- **The WebAssembly scan is the scaling limit.** At ten times the traffic, a fresh sync takes minutes.
- The first lever is scanning on several cores (Web Workers from an offscreen document), unmeasured.
- The worker scans in chunks with a saved cursor, so Chrome stopping it mid-scan loses nothing.

**A conversation's ratchet** adds, per matched envelope:
- one multiplication for the outer layer;
- three when a message starts a ratchet step (a new key pair and two DH);
- symmetric work.

**A conversation's first message:**
- **Sending** costs twelve multiplications: the outer envelope's four, R_A's two, R_B's two, E_A and its DH, S_A and its DH. Each later `0x01` costs only the outer four.
- **Receiving** costs seven: discovery, the outer layer, R_B's check and [x_B]E_A, then the ratchet step's three ([x_B]S_A, a new key pair and its DH). That's plus the subgroup checks on R_A, R_B, E_A and S_A.

## 9. Size and padding

- **Overhead:**
  - The outer layer adds 161 bytes.
  - Inside it, an `0x02` adds 105 bytes and an `0x01` 355–403. The ratchet ciphertext carries its 16-byte salt and 16-byte tag.
- **Padding:** the inner message is padded to one of a few fixed sizes, so envelopes come in a handful of lengths. The relay can't tell first messages from replies, or short messages from long ones, beyond the size.
  - The method: 0x80, then zeros, stripped on reading.
  - The sizes are open (§13); for instance envelopes of 0.5, 2, 8 and 64 KiB.

## 10. The relay

Phase 2 settles the details; the protocol needs only this:

- **The relay stores bytes.** It keeps no recipient, sender, account or key.
- **Envelopes are deleted after 36 hours.** Deleting doesn't unsend: anyone who downloaded the pool keeps copies. What protects old envelopes is forward secrecy, not deletion.
- **Proof of work.** Every envelope carries proof of work over its own bytes, so the work can't be reused. The difficulty is the relay's to raise.
- **Duplicates.** The relay drops an envelope whose bytes it already holds.
- **Clients download everything after their cursor.** At 10,000 envelopes a day, 36 hours is about 15,000 envelopes, roughly 7.5 MB at 0.5 KiB each.

**What 36 hours means:**
- **A reader who doesn't unlock the wallet within 36 hours misses whatever was sent meanwhile,** first messages included, and the sender can't tell. Discovery needs x, which is available only while the wallet is unlocked (§13).
- **The ratchet survives the gap:** the counters let the next message decrypt, and the wallet can say what expired (§6).
- **A message shows as sent, with when it expires, never as delivered.** Delivery receipts would be messages of their own: possible later.

## 11. What the relay and others learn

**The relay, and anyone watching the network, learns:**
- the IP address and time each envelope is posted, its size class and its proof of work;
- each client's IP address and when it syncs, so when each wallet is online;
- timing: a reply posted soon after a message hints at a conversation, more so when few wallets are online.

**It never learns:**
- whom an envelope is for;
- who is in a conversation;
- anything inside an envelope.

**The other side of a conversation learns:**
- the writer of a first message learns the handle they wrote to;
- the one written to learns a stranger's conversation identity, and whatever the stranger chooses to say.

**A holder of the reader's x learns:** everything in §1.

## 12. Local state

**Per conversation:**
- cid, R_A, R_B and t.
- Alice's E_A and F until Bob replies.
- The other side's handle, if `to` or a claim named one.
- The ratchet state: RK, CKs, CKr, DHs, DHr, Ns, Nr, PN, and the skipped keys.
- The message history.

**Kept with the conversations:** the cids of conversations deleted in the last 48 hours (§5).

**Storage and loss:**
- It's stored in the browser, encrypted under the wallet's vault key, and written only by the background worker (§4.2).
- Deleting the wallet's data deletes it.
- Restoring from the recovery phrase brings back x, so new first messages work and old handles still receive. It doesn't bring back any conversation.

## 13. Open, to settle as we build

**Unlocking versus the expiry: decided, 36 hours (the owner, 2026-11-20).** Discovery needs x, and x is the spending key, available only while the wallet is unlocked. So a message reaches its reader only if they unlock within 36 hours, and the wallet says so. The alternatives stay on record, to revisit with users:
- **A longer expiry.** Seven days is about 70,000 envelopes at 10,000 a day, about 70 s of WebAssembly scanning on a fresh sync.
- **A discovery key that stays available while locked.** It can't be the Seedelf's key, so handles would need a messaging register of their own, which reopens §0's choice of key.

**Open:**
- **Proof of work:** the function (a plain hash, or a memory-hard one against GPUs) and the starting difficulty, measured in WebAssembly. Also its economics: the relay's storage is its rate cap times 36 hours.
- **Padding sizes.**
- **MAX_SKIP and the 48-hour lifetime of skipped keys.**
- **How long a browser keeps message history,** and whether the user picks.
- **What the wallet does with a stranger's first message:** shown, collapsed, or held for the user.
- **Scanning on several cores,** measured, if pools grow.
- **Test vectors for the session layer,** checked by an independent implementation as v1's were.
- **A model of §3 to §5** in a protocol verifier (ProVerif or Tamarin) before mainnet, then an outside review.

## 14. Against Signal

| | Signal | Here |
|---|---|---|
| What the server knows | Each message's recipient, and partly its sender | The IP address that posted each envelope, and when; never whom it is for (§11) |
| First message | Forward-secret through prekeys | Long-term key alone until the first reply |
| Later messages | Double Ratchet | Double Ratchet, the same guarantees |
| Ratchet header | Plain, or encrypted in the header-encryption variant | Inside the outer layer |
| Identity | A phone number or username, with safety numbers | A Seedelf handle. The sender is anonymous unless they claim or prove a handle. |
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
| 4 | The wallet: WebAssembly bindings, the worker as the one writer, chunked scanning, encrypted local state, a Messages screen, sender labels, and "message me at ⟨Seedelf⟩". |
| Later | Proving who you are, groups, post-quantum, delivery receipts, prekeys if users want them. |
