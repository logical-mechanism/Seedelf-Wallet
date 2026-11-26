# Two keys for spending and messaging: joint security

A Seedelf wallet has two secret scalars from one recovery phrase. The Seedelf key x spends every Seedelf and every Lovejoin box the wallet holds. Messages' key x_m reads, writes and proves in Seedelf Messaging. x_m comes from the same BIP39 seed under another HKDF salt and info, one for each account and network (protocol.md §21.2). A certificate binds it to each Seedelf: one proof, under one challenge, of x for the Seedelf's register (g_S, u_S) and of x_m for its messaging register M_S = (h_S, [x_m]h_S), whose base h_S is a hash of the Seedelf (§21.3, §21.4). The handle stays the Seedelf. The owner chose the split on 2026-11-26 (chunk 55), so that a flaw in Messages' cryptography can't spend funds. What it can still give a thief of x_m is messages, and the power to pose to the key's owner as anyone, a "Verified" Seedelf included, which could mislead the owner into a payment (§8).

**Specified, not built.** The code still uses x for both until chunk 55's steps 55b to 55e land ([the plan](../../seedelf-web-wallet/docs/plans/chunk-55-messaging-key.md)). This document argues the design as protocol.md §21 specifies it. Its inventory (§4) names today's code, where every use takes x, and says which key each takes once chunk 55 is built. The one-key version of this document, the argument for the code as it is today, is at commit c096eab9:

    git show c096eab9:seedelf-platform/seedelf-messaging/docs/joint-security.md

This document:
- §1 says why two keys still need an argument, and §2 how much of NIST's rule against reuse is now kept;
- §3 sets out the setting, §4 lists every use of each key, crate by crate, and §5 states the rules every use must keep;
- §6 and §7 give a theorem in three parts and its proof, game by game, in the random-oracle model, and §7.4 says what became of the one-key proof's weakest step;
- §7.5 says which steps are new, §8 what isn't covered, §9 the gaps found and which key each concerns once chunk 55 is built, and §10 how to keep it true.

**Status.** An argument in the random-oracle model under gap assumptions, in the style of Degabriele, Lehmann, Paterson, Smart and Strefler's Theorem 2, written for an outside cryptographer to check. Nobody outside has checked it.
- **The one-key version** was reviewed by AI models: a fresh-context review, then its arguments written out by one model and attacked by another, and its §7.3 step proved in the algebraic group model and attacked the same way (2026-11-22 to 2026-11-24, §10). What it found that still applies is folded in.
- **This version** had chunk 55's step 55a review (2026-11-26): a fresh read of protocol.md §21 (Sonnet), and two attacks on §21 and this document (Fable, Opus). None found a way to x or x_m, or a forgery of a spend or a certificate. Both found §7.4's claim sound, that neither key gives a static-DH answer. Their findings are folded in (§10).
- **It's AI review, not an audit:** no person has checked any of it, and it stays unaudited. It isn't machine-checked, and it holds the code to nothing until chunk 55 is built and §10's tests exist.

**What it gives, once built:**
- **(B) The funds rest on gap-DLP alone** (§6). Forging a spend reduces to the discrete log of x with a decision oracle asked only "is W = [x]P?". No static-DH answers, no powers of x, no algebraic group model: x meets a stranger's point only in ownership tests and in proofs for its own registers, the certificate's among them. It holds against an attacker that holds x_m, so whatever Messages gives away, x_m itself included, spends no funds.
- **(C) x_m stays secret on the same terms.** Finding x_m reduces to its discrete log with the same kind of oracle. The one-key proof's weakest step, a static-DH answer for each handle the user writes to first, is gone for x_m too: the base a writer starts on is a hashed point, which a reduction programs (§7.4). It holds against an attacker that holds x.
- **x_m stolen still costs something:** messages, and the power to pose to its owner as anyone, a "Verified" Seedelf included (key-compromise impersonation, §8). That could mislead a payment, but it forges none.
- **(A) Messaging's properties stay conditional:** they carry over from any random-oracle reduction of them, and none exists yet.
- **The certificate is where the keys meet.** Its x half keeps rules 1 to 3 beside the spend's and Lovejoin's proofs, its two nonces keep each half from the other key, and its binding of M_S to a Seedelf rests on x (B′).
- **Deniability isn't its claim** (§8).

## 1. Why it still needs an argument

Key reuse isn't safe by default. Degabriele, Lehmann, Paterson, Smart and Strefler, *On the Joint Security of Encryption and Signature in EMV* (CT-RSA 2012, ePrint 2011/615), §3, forge a signature on a chosen message from EMV's RSA decryption oracle on the same key. Their §4.4 and Theorem 2 show the opposite for elliptic curves: ECIES-KEM and EC-Schnorr on one key pair are jointly secure in the random-oracle model if gap-DLP and gap-DH are hard. The proof works because each scheme's oracle can be simulated inside the other's reduction, and that needs the two schemes' hash queries to be told apart.

Splitting the key still leaves each key with several uses (§4):
- **x** makes three Schnorr-type proofs, the spend's (use 2), Lovejoin's owner proof (use 3) and the certificate's x half (use 11x), and two key derivations, the web wallet's one-time keys (use 8) and the CLI's Ed25519 key (use 9). Its public side is many registers (g, [x]g) on different bases.
- **x_m** has a KEM (use 5), a handshake with static Diffie–Hellman (uses 6 and 6′), two Schnorr-type proofs, the keys proof (use 10) and the reveal (use 4), the scan's tests (use 7m), and the certificate's other half (use 11m). Its public side is the messaging registers (h_S, [x_m]h_S) and each conversation's (p₀, A).
- **The certificate couples them:** one challenge over both halves, and two nonces, each keyed by its own key. Built wrong, it's where Messages could still reach x.

The argument below extends Theorem 2 to each key's uses and to the certificate between them, and says where that needed something new.

## 2. NIST SP 800-56A

NIST SP 800-56A Rev. 3, §5.6.3.2, item 5:

> A static key pair may be used in more than one key-establishment scheme. However, one static public/private key pair shall not be used for different purposes (for example, a digital-signature key pair is not to be used for key establishment or vice versa; key-usage restrictions could be enforced by a CA when generating certificates) with the following possible exception for ECC and FIPS 186-type FFC domain parameters: when requesting the (initial) certificate for a public static key-establishment key, the key-establishment private key associated with the public key may be used to sign the certificate request.

The one-key design broke this rule on purpose: x proved spending and established keys. Chunk 55 keeps most of it.

**How much of the departure is left:**
- **x now keeps the rule.** It's a signature-like key: three proofs of knowledge, ownership tests, and two derivations, hashes of x that are neither of the rule's purposes. It establishes no key. In the code as it is, x still does everything Messages does too.
- **x_m's half of the certificate is close to NIST's own exception:** a key-establishment key proving possession for its own certificate. It's the back-signature, the proof that whoever named m_S knows its key. It differs in form: it's one half of an AND-proof under x's challenge, not a signature on a request to a CA, and x stands where the CA would.
- **x_m still departs, by less.** Beside key establishment (the KEM and the handshake's Diffie–Hellman) it makes two proofs the exception doesn't cover: the keys proof's A branch, which shows a first message's writer holds A's key, and the reveal's branch 1, which shows a Seedelf. So x_m still needs this document's analysis: rules 1m and 2m, and Part C. A failure there costs x_m (below), and spends nothing.

**Why that much stays:**
- **It's a rule of practice, not an attack.** It exists because a combined analysis is usually missing and is easy to get wrong (§1). This document is that analysis.
- **The handshake needs it.** The keys proof binds a first message's points before the reader's key meets them, and the static DH between R_A and R_B keeps a reader's replies out of a third party's mailbox (protocol.md §3). Both use the conversation's key, x_m.

**What the split gains:**
- **A flaw in Messages can't spend funds.** A flaw in any of x_m's uses costs x_m (protocol.md §1.1, §21.9):
  - the messages sealed to it;
  - the power to pose as the wallet;
  - the power to pose to the wallet's user as anyone (key-compromise impersonation), a reveal included. The thief proves the reveal's branch 2 with the reader's own x_m, so the wallet shows "Verified ⟨N⟩" for any Seedelf with a good certificate. That could mislead the user into a payment, but it forges none (Part B).

  The bug bounty covers a flaw in Messages that exposes the Seedelf key (SECURITY.md). After the split, that's a flaw in the certificate's x half or in rule 8.
- **Preprod stays apart from mainnet.** x_m is per network, so a flaw found on preprod reads no mainnet message. x is the same on every network.

**What it still gives up:**
- **Key separation inside Messages:** a flaw in any of x_m's uses reaches all of them.
- **Read-only delegation inside Messages:** whatever reads can write and pose. It no longer spends.
- **x still reaches Messages:** whoever holds x can certify a messaging register of its own choosing for the wallet's Seedelfs (protocol.md §21.9). It reads no message sealed to x_m. Later first messages are another matter. The thief certifies its own m_S before the owner does, or moves the Seedelf and certifies it there. It's then the one good certificate, since the owner's wallet posts nothing on a conflict (§21.8), and writers who read the list write to the thief.

## 3. Setting

- **The group:** G1 of BLS12-381, written additively, of prime order q (255 bits, log₂ q ≈ 254.86), generator G. [k]P is scalar multiplication.
- **q − 1 = 2³² · 3 · 11 · 19 · 10177 · 125527 · 859267 · 906349² · 2508409 · 2529403 · 52437899 · 254760293²**, checked by multiplication with each factor a probable prime. It matters for rule 1.
- **E(F_p) has small subgroups outside G1:** G1's cofactor is h₁ = 3 · 11² · 10177² · 859267² · 52437899² (≈ 2¹²⁶). So a key applied to an unchecked point can leak it modulo these primes (rule 5).
- **x** is uniform in [1, q − 1]: the web wallet's frozen v1 derivation (seedelf-crypto/src/derivation.rs: HKDF-SHA-256 of the BIP39 seed, salt `seedelf-wallet-v1`, 64 bytes reduced mod q), or the CLI's random scalar in its wallet file.
- **x_m** (specified, not built) is HKDF-SHA-256 of the same seed, salt `seedelf-messaging-v1`, info `seedelf-messaging-key` ‖ u32_be(account) ‖ network ‖ generation, 64 bytes reduced mod q (protocol.md §21.2). There's one for each account, network and generation, and v1 has generation 0x00 alone. The CLI has none.
- **The two are independent.** Under different salts, HKDF's outputs over one seed are independent random values. That holds in the random-oracle model, or with HMAC-SHA-256 a pseudorandom function keyed through its message input (the dual-PRF assumption that TLS 1.3's analyses make). It fails only if the attacker evaluates the derivation at the wallet's own seed, which takes its phrase: at least 128 bits for 12 words, 256 for 24. Call that ε_seed, at most about q_H · 2⁻¹²⁸. The one-key argument had the same term, unstated. Every reduction below picks the other key itself.
- **A register of x** is (g, u) with u = [x]g, both points in G1 and not O. **A register of x_m** is (h, [x_m]h): a Seedelf's M_S, a conversation's R_A = (p₀, A), or, at its reader, R_B = (p₀, w₀).
- **h_S,** a Seedelf's messaging base, is hash_to_G1(network ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S), policy being the Seedelf policy's 28-byte hash, under the DST `Seedelf-Messaging|v1|handle-base|BLS12381G1_XMD:SHA-256_SSWU_RO_`: RFC 9380's `BLS12381G1_XMD:SHA-256_SSWU_RO_` (protocol.md §21.3). RFC 9380 gives that construction as indifferentiable from a random oracle to G1. So a proof may model it as one, H_base below, and program it, as the proof of BLS signatures does, in single-stage games such as these.

**Assumptions:**
- **DLP:** given (G, [x]G), find x.
- **gap-DLP:** DLP, with an oracle that decides whether (G, [a]G, [b]G, [ab]G) is a Diffie–Hellman tuple (a DDH oracle).
- **gap-DH:** given (G, [a]G, [b]G), compute [ab]G, with a DDH oracle.
- **What Parts B and C ask of the DDH oracle** is one question: "is W = [x]P?" in B, "is W = [x_m]P?" in C, for points P and W in G1. Every query is (G, X, P, W) with X the instance. That's the oracle of Abdalla, Bellare and Rogaway's strong Diffie–Hellman assumption, weaker than the full one gap-DLP gives. Inside the algebraic group model neither part asks any oracle: two points' representations answer the question (§7.4).
- **Static DH (Brown and Gallant) and n-DL: no part needs either now.** Rule 1's table says what static-DH answers would cost, which is why rules 1 and 1m forbid them. The one-key Part B needed static DH in the plain random-oracle model, and n-DL in its algebraic form (c096eab9, §7.3; §7.4 here).
- **XDH** (DDH hard in G1): unlinkability only, which is a separate claim (§8).

**Random oracles.** Every hash below is modelled as a random oracle, and rule 3 says why they can be treated as independent ones. Blake2b with different output lengths is a different function: the digest length is in its parameter block. H_base is a random oracle to G1, built on SHA-256 queries that rule 3 keeps apart from every other.

**A hash reduced mod q.** The challenges of uses 4, 10 and 11, and the base proof's, are SHA-256's 32 bytes reduced mod q, as use 3's is blake2b-256's. That isn't uniform on [0, q): 2²⁵⁶ = 2q + r with r ≈ 0.21·q, so a value below r has three preimages and the rest two. Every simulator below draws the 32 bytes and reduces them, as the hash does, so no step rests on uniformity. But a guessed challenge is right with probability up to 3/2²⁵⁶, where a uniform one would give 1/q. A nonce, or b, is HMAC-SHA-512's 64 bytes reduced mod q, within 2⁻²⁵⁹ of uniform.

| Name | Function | Input starts with | Used by |
|---|---|---|---|
| H_spend | blake2b-224 | g (a compressed point) | Use 2's challenge |
| H_lj | blake2b-256 | `lovejoin/sigmajoin/v1/` ‖ 0x01 | Use 3's challenge |
| H_cert | SHA-256 | `Seedelf-Messaging\|v1\|certificate` | Use 11's challenge, over both halves |
| H_rev | SHA-256 | `Seedelf-Messaging\|v1\|session\|reveal` | Use 4's challenge |
| H_keys | SHA-256 | `Seedelf-Messaging\|v1\|session\|keys\|handle`, or `…\|session\|keys\|continuation` | Use 10's challenge (the continuation form uses no key) |
| H_tag | SHA-256 | `Seedelf-Messaging\|v1\|envelope\|tag` | The scan's tag (use 7m): over w when sealing, over [x_m]p when the wallet scans |
| H_base | RFC 9380's hash_to_G1, DST `Seedelf-Messaging\|v1\|handle-base\|BLS12381G1_XMD:SHA-256_SSWU_RO_`, over network ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S | Inside, SHA-256 over 64 zero bytes ‖ … (b₀), then over b₀ ‖ 0x01 ‖ DST′ (b₁) and (b₀ ⊕ bᵢ₋₁) ‖ i ‖ DST′ (b₂ to b₄), 98 bytes each (rule 3) | h_S: uses 1m, 4, 6 and 11m |
| H_kdf | HKDF-SHA-256 | a salt that's a `Seedelf-Messaging\|v1\|…` label or a fresh secret | Uses 5 and 6 |
| H_x, H_xm | HKDF-SHA-256 of the BIP39 seed, salts `seedelf-wallet-v1` and `seedelf-messaging-v1` | | x and x_m themselves |
| N_spend | HMAC-SHA-512, keyed by x | `seedelf/schnorr/nonce/v1` | Use 2's nonce |
| N_cert_x | HMAC-SHA-512, keyed by x | `Seedelf-Messaging\|v1\|certificate-nonce\|x` | Use 11x's nonce, k_x |
| N_cert_m | HMAC-SHA-512, keyed by x_m | `Seedelf-Messaging\|v1\|certificate-nonce\|m` | Use 11m's nonce, k_m |
| N_rev | HMAC-SHA-512, keyed by x_m | `Seedelf-Messaging\|v1\|session\|reveal-nonce` | Use 4's nonce |
| N_b | HMAC-SHA-512, keyed by x_m | `Seedelf-Messaging\|v1\|session\|base-scalar` | Use 6's b, the writer's blinding |
| N_k | HMAC-SHA-512, keyed by b | `Seedelf-Messaging\|v1\|session\|base-nonce` | The base proof's nonce (no key's use) |
| N_keys | HMAC-SHA-512, keyed by x_m | `Seedelf-Messaging\|v1\|session\|keys-nonce\|a` | Use 10's nonce |
| N_e, N_s | HMAC-SHA-512, keyed by e_A and by s_A | `…\|session\|keys-nonce\|e`, `…\|keys-nonce\|s` | The keys proof's other two nonces (no key's use) |
| N_lj | RFC 6979's HMAC-SHA-256 DRBG over x and SHA-256(`lovejoin/sigmajoin/v1/` ‖ …) | | Use 3's nonce |
| H_ot | HKDF-SHA-256, salt `seedelf-one-time-key-v1`, ikm x | | Use 8 |
| H_ed | SHA-512 of x's 32 bytes, inside Ed25519 | | Use 9 (CLI) |

Until 55b is built, the code keys N_rev, N_b and N_keys by x, and has no H_cert, N_cert_x, N_cert_m, H_base or H_xm.

## 4. The inventory: every use of each key

Found by reading every crate, the CLI, the WebAssembly bindings and the extension's worker (2026-11-22), brought up to date for the 1.10.0 gate review's protocol change (2026-11-23), and split between the two keys for chunk 55 (2026-11-26). §10 says how to repeat the sweep. "Where" is today's code, at commit c096eab9, where every use takes x; each table says which key its uses take once chunk 55 is built. The uses keep their one-key numbers. 1m, 7x and 7m are the splits, and 11x and 11m the certificate's halves.

### 4.1 x's uses

These take x today and once chunk 55 is built.

| # | Use | What x computes | What leaves the wallet | Where |
|---|---|---|---|---|
| 1 | Registers | (g, [x]g) on a base the wallet re-randomized with a fresh d, from its root (G, [x]G) | The register, on chain | seedelf-crypto/src/register.rs:58 (`create`), :117 (`rerandomize`) |
| 2 | The spending proof (Schnorr, checked on chain, frozen as variant 1) | T = [r]g; c = blake2b-224(g ‖ T ‖ u ‖ vkh) over the raw bytes; z = r + c·x. r = HMAC-SHA-512(x, `seedelf/schnorr/nonce/v1` ‖ g ‖ u ‖ vkh ‖ 32 random bytes) mod q | (T, z) in the redeemer | seedelf-crypto/src/schnorr.rs:114 (`create_proof`), :72 (the nonce), :172; validator seedelf-contracts lib/schnorr.ak at 5b82530 |
| 3 | Lovejoin's owner proof (Schnorr, to withdraw a box) | t = [r]a; c = blake2b-256(`lovejoin/sigmajoin/v1/` ‖ 0x01 ‖ a ‖ b ‖ t ‖ ctx) mod q; z = r + c·x. r from RFC 6979 over x and SHA-256(tag ‖ a ‖ b ‖ ctx), deterministic | (t, z) in the redeemer | seedelf-crypto/src/lovejoin.rs:199 (`prove_schnorr`), :130 (the nonce) |
| 7x | Ownership tests, for funds | Is [x]g = u? For what the wallet spends, shows and refuses, and which Seedelfs it holds, so which it may turn on for Messages | Nothing directly: what the wallet spends, shows, refuses or turns on | seedelf-crypto/src/register.rs:185 (`is_owned`, which compares points with blst's masked equality); seedelf-core/src/lovejoin/mod.rs:498; seedelf-core/src/utxos.rs:68, :163, :601; the worker's contract scans and balances (`isOwned`) |
| 8 | One-time signing keys (web wallet) | HKDF-SHA-256(salt `seedelf-one-time-key-v1`, ikm = x, info = a fresh 32-byte seed): an Ed25519 key whose hash is the proof's vkh | Its public key and signatures, in the transaction | seedelf-web-wallet/wasm/src/lib.rs:2077 (`one_time_key`) |
| 9 | The CLI's external address key (CLI only) | Ed25519's key pair of x's 32 bytes as a seed; its public key, as 32 bytes, is in turn the seed of the address's Ed25519 key | That second key's public key and signatures | seedelf-crypto/src/convert.rs:23; seedelf-cli/src/commands/external/sweep.rs:29, :65, external/balance.rs |
| 11x | The certificate's x half (§4.3) | T_x = [k_x]g_S and z_x = k_x + c·x, for a Seedelf of the wallet's own, with k_x keyed by x | c and z_x, in the certificate on the relay's public list | Not built (§4.3) |

### 4.2 x_m's uses

These take x today, and x_m once chunk 55 is built. Where a use's text names h_S, m_S or §21.9's statement, today's code has g_S, the handle's v_S or u_S, and §19.2's statement.

| # | Use | What x_m computes | What leaves the wallet | Where (today, with x) |
|---|---|---|---|---|
| 1m | Messaging registers | M_S = (h_S, [x_m]h_S) for each Seedelf the wallet turns on (protocol.md §21.3), and each conversation's R_A = (p₀, [x_m]p₀) (use 6) | m_S in the certificate; A in F | M_S: not built. R_A: use 6's |
| 4 | The verified reveal (CDS OR-proof, protocol.md §19.2, as §21.9 changes it) | z₁ = k₁ + c₁·x_m, for branch 1, log_{h_S} m_S = log_{p₀} A. c₁ + c₂ = SHA-256(label ‖ statement ‖ T₁ ‖ T₁′ ‖ T₂) mod q, the statement being cid ‖ p₀ ‖ A ‖ w₀ ‖ len(N) ‖ N ‖ g_S ‖ u_S ‖ m_S, with T₁ = [k₁]p₀ and T₁′ = [k₁]h_S. k₁ = HMAC-SHA-512(x_m, nonce label ‖ 0x01 ‖ statement ‖ c₂ ‖ z₂ ‖ aux) mod q | The reveal, inside the ratchet, to the other side: len ‖ N ‖ g_S ‖ u_S ‖ m_S ‖ c₁ ‖ c₂ ‖ z₁ ‖ z₂, 274 to 305 bytes. It carries m_S, so the reader checks the proof before any read of the chain or the list, then applies §21.5's conflict rule at the press | seedelf-messaging/src/session/reveal.rs:199 (`prove_seedelf`), :170 (the nonce, through session/draw.rs:86, `hedged_scalar`), :304 (`Conversation::reveal`) |
| 5 | Reading (ECIES decapsulation) | [x_m]c for the envelope's c, then HKDF. A session reader then checks c = [r]p, with r = HKDF(salt, mk, `…\|ratchet\|envelope-ephemeral`) mod q (protocol.md §16.2) | Nothing directly: whether it opened shows in behaviour | seedelf-messaging/src/envelope.rs:140 (`decrypt_message`, the multiplication at :145); the check is session/conversation.rs:495 (`check_envelope`) |
| 6 | The handshake's Diffie–Hellman (protocol.md §3, §16.2) | As reader: w₀ = [x_m]p₀ on a base the base proof (against the reader's M_S) or a held conversation binds; then, once the keys proof verifies (it needs no key beyond w₀), [x_m]E_A, [x_m]A, and in the first ratchet step [x_m]S_A, S_A being the header key every message of the request shares. As writer: b = HMAC-SHA-512(x_m, `…\|session\|base-scalar` ‖ h_S ‖ m_S ‖ F's head ‖ 32 random bytes) mod q, then A = [x_m]p₀ on p₀ = [b]h_S, the reader's messaging register re-randomized by b; and [x_m]w₀ | A, in F; b never leaves, and the base proof shows it, or the reader's key, under a nonce keyed by b. Every DH value goes only into HKDF. A and w₀ go into every message's associated data, which the other side can solve for from the AES-GCM tags (rule 1m) | session/conversation.rs:159 (b, through session/first_contact.rs:494, `base_scalar`), :182 (A), :202 ([x]w₀), :280 (the reader's w₀), :284–286 (its [x]E_A and [x]A, after the keys proof at :281), :289 (x as RatchetInitBob's key); session/ratchet.rs:598 (the first step's [x]S_A) |
| 6′ | Continuations (protocol.md §6) | The new F's A = [x_m]p₀ on the old conversation's base | A, in F: the writer's old public value | session/conversation.rs:121 (`continue_with`, its multiplication at :131), session/inbox.rs:780 (`judge`, its multiplication at :787) |
| 7m | Ownership tests, in Messages | The scan: is SHA-256(`…\|envelope\|tag` ‖ [x_m]p) the envelope's tag, compared in constant time. And is a register x_m's: one's own handle refused, a continuation's own side, a register under a first message's `to` counting for its base proof only if it's the reader's, and the reveal's guard | Nothing directly: what the wallet scans, refuses or answers | seedelf-messaging/src/register.rs:107 (`matches_register`), envelope.rs:158 (`matches_envelope`, the scan), :76 (`Envelope::is_for`), :206 (`tag_matches`); session/reveal.rs:318–319; session/conversation.rs:107 (own handle refused), :131 (a continuation's own side); session/inbox.rs:693 (`receive_opened`) |
| 10 | The keys proof in F (protocol.md §3, §16.2), from a handle only: E_A's and S_A's keys, AND A's key OR the reader's w₀'s (Cramer–Damgård–Schoenmakers) | z₁ = k₁ + c₁·x_m on p₀ = [b]h_S, for A = [x_m]p₀, which the prover computes itself. c₁ + c₂ = SHA-256(`…\|keys\|handle` ‖ M ‖ T_e ‖ T_s ‖ T₁ ‖ T₂) mod q, where M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″, T₁ = [k₁]p₀, and T₂ = [z₂]p₀ − [c₂]w₀ from the drawn c₂, z₂. k₁ = HMAC-SHA-512(x_m, `…\|keys-nonce\|a` ‖ M ‖ T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux) mod q | c₁, c₂, z₁, z₂, with z_e and z_s, in F: to the reader and whoever holds its key | session/first_contact.rs:765 (`KeysStatement::prove_handle`, its nonces through session/draw.rs:118, `hedged_or_draws`), from `Conversation::begin` (session/conversation.rs:147, the call at :193–194) for `Origin::Handle` only |
| 11m | The certificate's x_m half (§4.3) | T_m = [k_m]h_S and z_m = k_m + c·x_m, with k_m keyed by x_m | m_S, c and z_m, in the certificate | Not built (§4.3) |

### 4.3 Use 11, the certificate

Specified in protocol.md §21.4, not built. For a Seedelf N of the wallet's own, with register (g_S, u_S) and M_S = (h_S, m_S):
- **statement** = version ‖ network ‖ generation ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S ‖ m_S, 177 to 208 bytes, policy being the Seedelf policy's 28-byte hash;
- **k_m** = HMAC-SHA-512(x_m, `Seedelf-Messaging|v1|certificate-nonce|m` ‖ statement ‖ aux) mod q, T_m = [k_m]h_S;
- **k_x** = HMAC-SHA-512(x, `Seedelf-Messaging|v1|certificate-nonce|x` ‖ statement ‖ T_m ‖ aux) mod q, T_x = [k_x]g_S;
- **c** = SHA-256(`Seedelf-Messaging|v1|certificate` ‖ statement ‖ T_x ‖ T_m) mod q;
- **z_x** = k_x + c·x (use 11x) and **z_m** = k_m + c·x_m (use 11m), with one aux of 32 drawn bytes for both, drawn again for a zero nonce.

**What leaves:** statement ‖ c ‖ z_x ‖ z_m, 273 to 304 bytes, on the relay's public list (§21.7). **When:** only after g_S and u_S are checked canonical, in G1 and not O, then u_S = [x]g_S and m_S = [x_m]h_S. **One maker** (§21.4, "One maker, one derivation"): both nonce derivations and H_cert's input are fixed by the version byte, and a certificate is made in one call that takes no commitment from outside. It's the only function that takes both keys, and it refuses when [x_m]G = [x]G (rule 8). **Where, once built:** 55b puts it in seedelf-messaging, 55d gives the WebAssembly one export that makes one, the only Messages call that takes x, and 55e calls it at the switch (§21.8). Checking one takes no key.

**Who calls them:**
- **Use 2** (the only caller of z = r + c·x on chain): seedelf-core's `ScriptSpend::proven` (build.rs:1854); the wasm's `prove_with` (lib.rs:2595) for merge, mint, launch, transfer, withdraw and remove; wasm/src/lovejoin.rs:2980 (a session's return); seedelf-core/src/lovejoin/box_value.rs:316 (a measurement with a made-up key); the CLI's `spend::prove_and_submit` (commands/spend.rs:43); and the JS export `SeedelfKey.createProof` (wasm lib.rs:7002), which nothing in the extension calls.
- **Use 3:** seedelf-core/src/lovejoin/mod.rs:1680, after every box is checked as owned (:1504); the wasm's withdraws through `our_box` (wasm/src/lovejoin.rs:2724).
- **Use 7x:** the worker's contract scans and balances, through `isOwned`. Some tests run on registers a stranger chose: a site's transaction in the signing view (extension tx-view.ts:329, dapp.ts:2409) and a payee's register (wasm lib.rs:3342). Each is a DDH bit (rule 4).
- **Use 8:** every Seedelf spend's signer: wasm lib.rs:1380, :2658, :2973, :3374, :3891, :3910, :3930, :5804, :5962, wasm lovejoin.rs:2962. `signScriptSpend` (lib.rs:5947) signs only what the worker built (extension script-spend.ts:430, lovejoin.ts:8179). A dApp can't reach it, and no CIP-30 path makes a Seedelf proof (wasm/src/cip30.rs never calls one).
- **Uses 4 to 7m and 10, today:** they reach the key through `SecretKey::from_scalar` (wasm/src/messaging.rs:281) in every `messaging*` export, which the worker hands x (`keys.seedelf`, through `laneKey` in background/messaging.ts). Once 55d is built, every `messaging*` export takes x_m, derived at unlock beside x, and none takes x but the one that makes a certificate.
- **Use 4:** the wasm's `messagingReveal`; the worker's "Show my Seedelf", which once built is offered only for a Seedelf with a good certificate (§21.8).
- **Use 10:** the wasm's `messagingStart` (the worker's start and Start again), through `Conversation::start`. `start_continuing` makes the continuation form, which proves e_A and s_A and uses no key.
- **Use 11:** not built. The worker at the switch, and when a Seedelf is turned on, or made in this browser while Messages is on (§21.8).

**What isn't a use of x,** once chunk 55 is built (checked, so a reviewer needn't look):
- **Messages' cryptography:** uses 4 to 6′, 7m and 10 are x_m's. In today's code they're x's.
- **x_m's derivation:** from the BIP39 seed under its own salt and info, a sibling of v1, not from x (§21.2).
- **Lovejoin's mix proofs** (`prove_sigma_or`) use each mix's fresh witnesses (seedelf-core/src/lovejoin/mod.rs:1035), never x.
- **The base proof in F** (protocol.md §16.2) is designated-verifier: it shows the writer knows b with p₀ = [b]h_S, or knows the reader's key with m_S = [x_m]h_S. The writer proves b's branch and simulates the other, with a nonce keyed by b (N_k); the reader checks it from public values alone. b is derived from x_m (use 6) and blinds the writer's A: rule 1m's A bullet, rule 2m, and §9.
- **The keys proof's E_A and S_A branches,** and its continuation form, use e_A and s_A (N_e, N_s).
- **The CLI's one-time keys** are random (commands/spend.rs:26). convert.rs:9–11's comment, that use 9's key is the one-time key a proof binds to, is out of date.
- **The Cardano account** (CIP-1852) is a sibling derivation from the same phrase, not from x.
- **`baseRegister`** in the worker: (G, [x]G) as the account's identifier and, hashed, as a local record's owner (extension wallet.ts:558, contract-scan.ts:245). It's a register (use 1), never written to chain as it is.
- **No G2 point** carries either key, and nothing pairs with one (rule 6).
- **Storage and export** (the vault keeps the phrase's entropy, from which both keys come, the CLI its encrypted file, and the CLI's `util expose-key` prints x on request) are outside this argument.

**What isn't a use of x_m:**
- **Anything of the funds:** the funds scan, spends, Lovejoin's proofs and the one-time keys (rule 8).
- **The certificate's x half:** k_x is keyed by x alone.
- **The Seedelf's register** (g_S, u_S): an input to h_S and bytes in a statement, never multiplied by x_m.

## 5. The rules

The theorem's hypotheses. Rules 1, 2 and 7 are x's, rules 1m and 2m are x_m's, rules 3 to 6 cover both keys, and rule 8 keeps them apart. Each is a condition on the code, and §10 says which tests hold it. For x_m and the certificate, those are tests chunk 55 must add.

### 5.1 x

#### Rule 1: nothing outputs [x]P for a point P someone else chose, unless [x]P is already public

A static Diffie–Hellman oracle on a key, even a slow one, cuts the cost of finding it. With d answers and d | q − 1, Brown–Gallant and Cheon find the key in about √(q/d) + √d operations, against √q ≈ 2^127.4 without them. 2³² divides q − 1, so any number of answers up to 2³² finds a usable d:

| Answers | Cost of finding the key |
|---|---|
| none | about 2^127.4 |
| 2²⁰ | about 2^117.4 |
| 2³² | about 2^111.4 |

x meets a point a stranger chose only in ownership tests, and in proofs for registers it owns, whose public value is already public:
- **Ownership tests (7x):** is [x]g = u, for registers on chain, in a site's transaction or a payee's. Only bits leave (rule 4).
- **Uses 2, 3 and 11x, the proofs,** only for a true statement. For a register (g, u) with u ≠ [x]g, the challenge is computable from public values, so z = r + c·x gives [x]g = ([z]g − T)/c. So:
  - use 2's `create_proof` refuses a register x doesn't own (schnorr.rs:128; every caller already checked, but at about 12 call sites);
  - use 3's `prove_schnorr` computes u itself, and every withdraw checks each box is owned first (lovejoin/mod.rs:1504);
  - use 11x refuses unless g_S and u_S are canonical, in G1 and not O, then unless u_S = [x]g_S (protocol.md §21.4, step 1).
- **A stranger's generator is fine there.** A payer re-randomized every register the wallet is paid at, and a Seedelf someone else minted under the key may have a g_S built from the wallet's public registers. A Schnorr proof on (g, u), both public, gives no [x]P that isn't public, and anyone could simulate it.
- **Use 1:** registers on bases the wallet itself randomized.
- **Nothing else,** once chunk 55 is built: x meets no envelope's, F's or ratchet header's point (rule 8). So x gives no static-DH answer at all, and the table is the reason for the rule, not a bound on what's given.

#### Rule 2: no nonce rests on the random source alone

Uses 2, 3 and 11x all compute z = r + c·x. One r under two different challenges, in the same use or in any two of them, gives x = (z − z′)/(c − c′), whatever the bases. So:
- **Use 2:** r = HMAC-SHA-512(x, `seedelf/schnorr/nonce/v1` ‖ g ‖ u ‖ vkh ‖ aux), and the challenge covers g, T, u and vkh, with T = [r]g.
- **Use 3:** r = RFC 6979(x, SHA-256(tag ‖ a ‖ b ‖ ctx)), and the challenge covers a, b, t and ctx, with t = [r]a. Deterministic: proving the same box under the same ctx twice gives the same proof.
- **Use 11x:** k_x = HMAC-SHA-512(x, `…|certificate-nonce|x` ‖ statement ‖ T_m ‖ aux). The challenge covers the statement, T_x and T_m, and T_x follows from k_x, so one k_x means one challenge.
  - T_m = [k_m]h_S, with k_m keyed by x_m over the statement and aux (rule 2m). One aux serves both halves, so a source that repeats it gives the same certificate again, and one that changes it changes both nonces.
  - **T_m in k_x's message is x's margin.** Whatever the x_m half does, a deviating implementation's or a bug's, another T_m gives another k_x. So k_x never meets two challenges, and x doesn't depend on how k_m is made. k_m has no such margin (rule 2m).
  - k_x is keyed by x alone. Whoever holds x_m computes k_m and T_m, and nothing of k_x, so z_x says nothing of x. A k_x anyone could compute from x_m would give x = (z_x − k_x)/c from one certificate (rule 8).
  - A zero k_x or k_m draws aux again and derives both again.
- **Across uses:** N_spend and N_cert_x are HMAC-SHA-512 keyed by x, on messages whose first bytes differ (`seedelf/…` against `Seedelf-…`). N_lj is HMAC-SHA-256. x_m's nonces are under another key, with labels apart from these (rule 3), so even an x_m equal to x (probability 1/q) would share none.

So a random source that fails or repeats costs x nothing: the same statement gives the same proof again, and two different statements get independent nonces.

#### Rule 7: a spend's proofs are bound to a one-time key of the wallet's own, which signs that transaction alone

A spending proof is bound to a vkh, and the validator checks that vkh among the transaction's signers. So a proof under a key someone else holds spends the register, and so does a one-time key's signature on a transaction the wallet didn't build. x is safe either way; the funds aren't. So:
- **Proofs only under the hash of a fresh one-time key the wallet just made.** Every caller of use 2 passes `key_hash(one_time_key(x, seed))` for a fresh seed (use 8), or the CLI's fresh random key. The JS export `createProof` takes any vkh, and nothing calls it.
- **That key signs only the transaction its proofs are in.** `sign_with_collateral_key` (wasm lib.rs:5954) signs any transaction that lists the key and carries giveme.my's signature. The worker passes it only the transaction it built, with that transaction's own seed (script-spend.ts:430, lovejoin.ts:8179).

Both are conditions on the worker and the CLI, which hold x and so are trusted with it. Nothing below makes them true.

### 5.2 x_m

#### Rule 1m: nothing outputs [x_m]P for a point P someone else chose, unless [x_m]P is already public

Rule 1's table applies to x_m as to x. A hashed point is no one's choice. Where x_m meets a point the wallet didn't choose, and what leaves:
- **Uses 5 and 6, the DH values** ([x_m]c, [x_m]E_A, [x_m]A, [x_m]S_A, [x_m]w₀): only into HKDF. Each point is bound before the wallet acts on what follows:
  - E_A, S_A, and from a handle A, by the keys proof (use 10's check), S_A being the header key every message of a request shares;
  - A in a continuation, by equality with a held value;
  - p₀, by the base proof against the reader's own M_S, or a held base. The base proof's other branch is its register's key, so a register of another key under the handle's name would let that key's holder prove any p₀: the reader passes over any register under the name that isn't its key's (session/inbox.rs:693, an ownership test of use 7m). Once built, those are the Seedelf's M_S, a retired one among them until 48 hours after a move (protocol.md §21.8);
  - c by c = [r]p and p by p = [o]p₀, both checked once the message decrypts.

  A request replayed from storage (`Request::read`, `Inbox::accept`, a join) isn't checked again for its window, stamp or base proof: it rests on the record's sealing, since only the wallet writes that record, after those checks passed. The keys proof is checked again on every replay, and the rule that every message carries the first's header key both when the record is read and on every replay.

  [x_m]p (the scan) and [x_m]c (opening) are computed before those checks can run: [x_m]p goes only into the scan's tag, a SHA-256 compared in constant time, and [x_m]c only into HKDF, and nothing is shown or answered before every check has passed (rule 4).
- **Use 6, the reader's w₀ = [x_m]p₀, in the associated data.** It's unhashed there in effect: whoever holds a message's key gets one GF(2¹²⁸)-linear equation in w₀'s three GCM blocks from each AES-GCM tag, so the other side recovers w₀ from three replies. That's safe because that side already knew w₀. A first message from a handle proves, for the reader's M_S = (h_S, m_S), that the writer knows b with p₀ = [b]h_S, or the reader's key, so knows w₀ (= [b]m_S); and a continuation is read only when verified, on a base and values both sides had. Third parties hold no message keys.
- **Use 6, the writer's A = [x_m]p₀:** p₀ = [b]h_S, with b the writer's secret and h_S the reader's hashed base. So (p₀, A) is a uniformly random register of x_m: a *blinded* answer. In the one-key design a leaked b unblinded A into [x]g_S on a generator the attacker chose. Now it would give [x_m]h_S, x_m on a hashed point, which no one chose and which a reduction makes itself (§7.4). The hedge on b stays (rule 2m), but no key rests on it.
- **Use 6′, a continuation's A = [x_m]p₀** on a base the other side chose: published only for a verified continuation (§6), where that side already knew it. It made p₀ = [b]h_S and proved it knows b (or the reader's key), so it knows [x_m]p₀ = [b]m_S; or its AES-GCM tag held w₀ = [x_m]p₀ in the associated data. protocol.md §3, "w₀ in it is load-bearing", is why both stay.
- **Uses 4, 10 and 11m, the proofs,** only for a true statement whose public value is already public:
  - use 4 refuses unless A = [x_m]p₀, m_S = [x_m]h_S and the Seedelf's certificate is good (protocol.md §21.9; today, reveal.rs:318–319 checks A and (g_S, u_S) against x);
  - use 10's prover computes [x_m]p₀ on F's base and refuses any other A (session/first_contact.rs:806–811), and `begin` makes the base itself. The OR's other branch is the reader's own w₀, so the proof convinces only the reader, given a sound random source when it's made (§9);
  - use 11m refuses unless m_S = [x_m]h_S (§21.4, step 1).
- **Use 1m:** M_S on a hashed base. Nobody chooses h_S, so publishing m_S answers no static-DH question (protocol.md §21.3). R_A sits on the reader's hashed base, re-randomized by b.

So x_m gives no static-DH answer either. On g_S, the plan's first design, a Seedelf minted under the key from the wallet's own registers would have made m_S one (§7.4).

**Where it's enforced, once built: no API carries a base.**
- start, reveal and receive take (network, policy, N, g_S, u_S), with m_S where there's one, and compute h_S in the crate.
- A messaging register's type is built only through hash_to_G1, so no caller hands x_m a base of its own.
- Today the worker passes registers: the handles (wasm/src/messaging.rs, about :225–257), start's handle (:577) and reveal's Seedelf (:725). So both are 55b's and 55d's to build, and §10 names the test.

#### Rule 2m: no nonce, and no b, rests on the random source alone

Uses 4, 10 and 11m all compute z = k + c·x_m, and one k under two challenges gives x_m. So:
- **Use 4:** k₁ = HMAC-SHA-512(x_m, `…|reveal-nonce` ‖ 0x01 ‖ statement ‖ c₂ ‖ z₂ ‖ aux), the statement §21.9's. The challenge also covers T₂ = [z₂]p₀ − [c₂]w₀, which is why c₂ and z₂ are in the message. In the one-key design k₁ first came from the random source alone (§9).
- **Use 10:** k₁ = HMAC-SHA-512(x_m, `…|keys-nonce|a` ‖ M ‖ T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux), with M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″.
  - k_e and k_s are HMAC-SHA-512, keyed by e_A and by s_A, over their labels ‖ M ‖ c₂ ‖ z₂ ‖ aux. One aux serves all three, drawn after c₂ and z₂, which come after the base proof's draws.
  - The challenge covers M, T_e, T_s, T₁ = [k₁]p₀ and T₂ = [z₂]p₀ − [c₂]w₀, and (M, c₂, z₂, aux) fixes each of them, M fixing the three keys. So one input gives one proof, and anything else three new nonces.
  - A zero nonce draws c₂, z₂ and aux again and derives all three again: one helper draws and derives them together (session/draw.rs, `hedged_or_draws`), never `hedged_scalar` once for each, which redraws only its own aux.
  - Its first design drew an aux for each nonce and left T_e and T_s out of k₁: a source that repeated every draw but aux_e put one k₁ under two challenges, and gave the key away from two F (§9).
- **Use 11m:** k_m = HMAC-SHA-512(x_m, `…|certificate-nonce|m` ‖ statement ‖ aux). The statement and aux fix T_m, then k_x and T_x (rule 2), so the whole challenge. With an aux for each half, a source that repeated aux_m and not aux_x would put k_m under two challenges, and x_m = (z_m − z_m′)/(c − c′).
  - **k_m is hedged only while one (statement, aux) always gives one T_x.** Its message can't cover T_x, which comes after it. So both nonce derivations and H_cert's input are fixed by the version byte, and the wallet makes a certificate in one call that takes no commitment from outside (protocol.md §21.4, "One maker, one derivation").
  - A second derivation of k_x under the same version, another implementation's or a changed one's, would, with a repeated aux, put k_m under two challenges and give x_m. x has no such dependence (rule 2).
- **The writer's b and the base proof's k** (protocol.md §16.2, §16.3):
  - b = HMAC-SHA-512(x_m, `…|session|base-scalar` ‖ h_S ‖ m_S ‖ F's head ‖ aux_b) mod q, F's head being F's bytes before p₀ (cid, t, `to`, `replaces`). Keyed by x_m, b is secret even when the source is predictable, and it's new for each handle, name, time and cid.
  - k = HMAC-SHA-512(b, `…|session|base-nonce` ‖ h_S ‖ m_S ‖ p₀ ‖ F′ ‖ c₂ ‖ z₂ ‖ aux_k) mod q, with c₂ and z₂ the simulated branch's (the reader's key's). The base challenge covers h_S, m_S, p₀, T₁, T₂ and F′, with T₁ = [k]h_S and T₂ = [z₂]h_S − [c₂]m_S. So one k never meets two challenges, which would give b = (z₁ − z₁′)/(c₁ − c₁′). A zero k draws c₂, z₂ and aux_k again, through the same helper.
  - k is keyed by b, the witness it hides, as RFC 6979 keys a nonce by the signing key: the proof then depends on b alone, and x_m meets one HMAC here (N_b), not two.
  - In the one-key design both first came from the source alone, in the order b, cid, e_A, s_A, k. A stuck source gave k = b, and z = b(1 + c) gave b away from one F (§9).
- **Across uses:** N_rev, N_b, N_keys and N_cert_m are one function, HMAC-SHA-512 keyed by x_m, on messages whose labels differ (`…|reveal-nonce`, `…|base-scalar`, `…|keys-nonce|a`, `…|certificate-nonce|m`). N_k, N_e and N_s are HMAC-SHA-512 keyed by b, e_A and s_A, under labels of their own. So the nonces and b are independent functions of their inputs, and no two uses share one except by a collision.

So a random source that fails or repeats costs x_m nothing: the same statement gives the same proof again, two different statements get independent nonces, and b stays secret.

- **No other drawn value meets x_m:** e_A, s_A, the ratchet keys and the ratchet salt never combine with it. The reveal's and the keys proof's simulated c₂ and z₂ reach z₁ only through c₁ = c − c₂, and their nonces cover them; the base proof's reach only b's response, and its nonce covers them. The envelope's r is HKDF of the message key and the salt, not a draw. A failing source costs secrecy and unlinkability there, and, through the proofs' drawn c₂ and z₂, deniability (§9).

### 5.3 Both keys

#### Rule 3: no two uses hash the same input under one function

- **H_spend** is blake2b-224, with no domain tag, frozen on chain.
  - Cardano uses blake2b-224 too: key hashes of 32-byte keys, and script and policy hashes, which are long but start with a language tag byte (0x00 to 0x03). A spend's challenge input is 172 bytes from the wallet (three points, then a 28-byte vkh) and starts with a compressed point's flag byte, 0x80 to 0xBF. The first byte and the length separate them.
  - **A certificate's x half against the spend's verifier.** A spend's challenge is blake2b-224 over the raw bytes of g ‖ T ‖ u ‖ vkh, a hash no reduction programs. A certificate's (T_x, z_x) can be mauled into a pair for any challenge t, T′ = T_x + [c − t]u_S. But T′ is then fixed by t, so a spend needs blake2b-224(g_S ‖ T′ ‖ u_S ‖ vkh) = t, for a vkh the attacker can sign under: a chance of about 2⁻²²⁴ a try, what a forger has with no certificate at all (B5).
- **H_lj and Cardano's own blake2b-256** (transaction and datum hashes): Lovejoin's challenges start with `lovejoin/sigmajoin/v1/`, which no CBOR transaction body or datum does.
- **SHA-256:**
  - raw SHA-256 runs over labelled inputs: `Seedelf-Messaging|v1|session|{reveal,base,stamp,keys|handle,keys|continuation}`, `Seedelf-Messaging|v1|certificate`, the envelope's `Seedelf-Messaging|v1|envelope|tag`, the relay's `Seedelf-Messaging|v1|stamp|` and, for a certificate's post, `Seedelf-Messaging|v1|listing-stamp|` (protocol.md §21.7), Lovejoin's `lovejoin/sigmajoin/v1/` for N_lj's message, and the worker's `seedelf.contract.owner.`, which comes before the base register's two points in hex, a dot between them, and names a local record's owner (extension contract-scan.ts, `ownerOf`; it holds no secret, §4). None is a prefix of another. It also runs over the three stamps' unlabelled `digest ‖ nonce`, which are 40 bytes, shorter than any labelled input;
  - **outside the rule:** the worker's `envelopeHash` (extension background/messaging.ts:1075), an unlabelled SHA-256 over bytes the relay serves, taken before any check, which names an envelope in a mark or the skip list. Its input is public and its output only a local name, so a query it shares with another use gives no one anything that use's reduction must hide: anyone can make the same query;
  - **H_base's inputs.** RFC 9380's expand_message_xmd hashes b₀ over 64 zero bytes ‖ msg ‖ I2OSP(128, 2) ‖ 0x00 ‖ DST′, then b₁ over b₀ ‖ 0x01 ‖ DST′, and b₂ to b₄ over (b₀ ⊕ bᵢ₋₁) ‖ i ‖ DST′. Each of b₁ to b₄'s inputs is 98 bytes here: the DST is 64 bytes, ending in the suite's ID, and DST′ is it and its length, 65.
    - No other raw SHA-256 input starts with 64 zero bytes, since each starts with an ASCII label or is a stamp's 40 bytes.
    - b₁ to b₄'s inputs start with b₀ or b₀ ⊕ bᵢ₋₁, built from outputs of SHA-256 itself. They match another input's ASCII label (at least 21 bytes, `Seedelf-Messaging|v1|` or another) only by chance, about 2⁻¹⁶⁸ a query, and a stamp's 40 bytes are another length.
    - So H_base's queries are apart from every other use's, as RFC 9380 asks of a hash shared with other uses. No other hash to the curve exists in the workspace;
  - HMAC-SHA-256 and HKDF-SHA-256 are keyed by labels that differ from each other (`Seedelf-Messaging|v1|…|salt`, `seedelf-one-time-key-v1`, `seedelf-wallet-v1`, `seedelf-messaging-v1`), or by fresh secrets (rk, the ratchet's salt, chain keys). Under one key (the ratchet salt and mk) HKDF-SHA-256 takes three infos, `…|ratchet|{message,outer,envelope-ephemeral}`, none a prefix of another. Each HMAC-SHA-256 input starts with its key xored with ipad or opad, and no key here is 64 bytes of 0x36 or 0x5c, so none starts as b₀'s does;
  - the seed enters HKDF-SHA-256 under the two salts, and x itself enters SHA-256 as H_ot's ikm, under the key `seedelf-one-time-key-v1`, and in N_lj's DRBG. That DRBG's first HMAC is keyed by 32 zero bytes, with x in the message after RFC 6979's 32 bytes of 0x01 and a 0x00: separated by that prefix, since nothing else in Seedelf uses a zero HMAC key. x_m enters no SHA-256 but as an HMAC-SHA-512 key.
- **SHA-512:** HMAC-SHA-512 keyed by x (N_spend, N_cert_x), by x_m (N_rev, N_b, N_keys, N_cert_m), by b (N_k), or by e_A and s_A (N_e, N_s), whose inner hash is at least 128 bytes. No label of one is a prefix of another, across both keys. `…|session|base` is a prefix of `…|base-scalar` and `…|base-nonce`, and `…|certificate` of `…|certificate-nonce|x` and `…|certificate-nonce|m`, but each shorter one is raw SHA-256's, another function. Then there's Ed25519's expansion of a 32-byte seed (use 9 and the one-time keys), and BIP39's PBKDF2 over the phrase. They differ in key or in length.

Treating these as independent random oracles is the standard step of "oracle cloning" by domain separation (Bellare, Davis and Günther, *Separate Your Domains*, EUROCRYPT 2020). A reviewer should check this rule against the code more than anything else in this section, once the certificate and H_base are built.

#### Rule 4: decision bits are only DDH answers

The wallet's behaviour shows bits that depend on its keys. Each is a function of whether some (P, [k]P) relation holds for one key k, or of an AEAD check under a key HKDF derived from [x_m]P. So the most any of them gives an attacker is a DDH oracle on that key, and of that only the question "is W = [k]P?" (§3). That's why the theorem needs gap-DLP and gap-DH, not DLP and CDH, exactly as Theorem 2 does.

- **x's bits:** what the wallet spends, shows and refuses, and which Seedelfs it holds, so which it may turn on and which a `to` names as its own (7x).
- **x_m's bits:** whether an envelope is its own (the scan, and what it fetches), whether a first message is accepted (and answered), and which messaging registers are its own (7m).
  - **The scan** compares the envelope's tag with H_tag([x_m]p). Its bit is still at most a DDH answer: in the random-oracle model, a tag the scan accepts is H_tag(W) for a W the attacker hashed, and the answer says whether W = [x_m]p.
  - **Since the keys proof,** accepting a first message is no longer a DDH answer on a point the writer chose: every point the reader multiplies is bound first (rule 1m). What's left: the scan's tag of [x_m]p, the outer layer's opening before c is checked, and the ownership tests.
  - **Whether a reveal verifies isn't one of these bits.** Checking a reveal uses no key: `Conversation::verify_reveal` (session/reveal.rs:340) reads the w₀ the reader stored when it took the first message, and the binding's `check_reveal` (wasm/src/messaging.rs:769) takes none. Once built, the reveal carries m_S and its proof is checked first. The press then reads the chain and the list, and applies §21.5's conflict rule: none of that takes a key either.
- **A bit that depends on both,** such as accepting a first message to N (N must be a Seedelf of x's, and M_S a register of x_m's), is a function of one DDH answer on each key. Each part's reduction holds the other key, and answers that one itself.

#### Rule 5: every point is checked before a key touches it

Canonical encoding, in G1, not O: register.rs's `is_valid` (and blst's `from_compressed`), and the messaging crate's `decode_point` at every parse (security.md, "Order of checks"). The certificate's maker checks g_S and u_S so before x meets them in its ownership test, and its checker checks every point before it multiplies one (protocol.md §21.4). h_S is RFC 9380's output, in G1 by its cofactor clearing, and refused if O. Without these checks, a key applied to a point of small order outside G1 leaks it modulo h₁'s small primes (§3), as ElfTalk's unchecked decompression did.

#### Rule 6: neither key meets G2

There's no pairing anywhere either key is used. A public [x]h or [x_m]h in G2 would decide DDH in G1 for that key for everyone: unlinkability would be gone, though not the key.

### 5.4 Rule 8: the keys stay apart

- **x_m is in no funds use.** The funds scan never tests a register against x_m, x_m makes no spending or Lovejoin proof, and no one-time key derives from it (protocol.md §21.6). So x_m holds nothing. Funds sent to a register of x_m, R_A among them, are stranded: the wallet never finds or spends them, and nothing in it offers to pay one.
- **x meets no point of Messages.** No envelope's, first-contact block's or ratchet header's point reaches x: the scan, opening, the handshake, continuations, the keys proof and the reveal take x_m. The one Messages call that takes x makes a certificate, for a Seedelf of the wallet's own (§4.3).
- **Neither half's nonce follows from the other key:** k_x is keyed by x alone, and k_m by x_m alone (§21.4).

**Why:** Part B hands the attacker x_m. That's sound only if nothing that holds x answers Messages' inputs but the certificate's maker, on the wallet's own Seedelfs, and if no funds hang on x_m. Part C, which hands the attacker x, doesn't lean on this rule.

**Where it's enforced, once built:**
- **A WebAssembly class of its own,** `MessagingKey`, holds x_m, with no funds method: no `isOwned`, no `createProof`, no `baseRegister`, no one-time key. Every `messaging*` export takes only it.
- **The certificate's maker is the only function that takes both keys,** and it refuses when [x_m]G = [x]G, the case (probability 1/q) in which the two keys would be one.
- **Today neither exists:** the worker hands every `messaging*` export x itself (§4.3, "Who calls them"). Both are 55b's and 55d's to build, and §10 names the test.

## 6. The theorem

**The games.** The attacker gets the wallet's published registers and certificates, and oracles that do what the wallet does with its keys:
- **Funds, with x:**
  - **Spend** any set of its registers in a transaction whose other parts (outputs, other inputs) the attacker chooses. The wallet makes a fresh one-time key, proves each register under its hash, and signs that transaction alone (rule 7).
  - **Lovejoin's owner proof** on any of its boxes, under any ctx.
  - **Certify** any of its Seedelfs: the wallet makes a certificate with its own M_S, under the draws it's given, as it does at the switch and whenever the list holds none that's good (protocol.md §21.8).
- **Messages, with x_m:** **reveal**, in any conversation the wallet started and that has been answered, any of its Seedelfs with a good certificate. **Open** any envelope and say what it holds, **scan** any bytes, **start** a conversation to any handle, **receive** any first or later message and answer it, **continue** any conversation.
- **What the wallet shows:** which registers it spends, shows and refuses, and which Seedelfs it holds and turns on.
- **Every random oracle,** H_base among them, **and the network and relay:** it can drop, reorder, replay and forge envelopes, and withhold, drop or post certificates. The chain data source is honest (§8).
- **In Parts B and C, the wallet's random source too.** The attacker may choose every value the wallet draws: that's what "a source that fails" means below. A seed it repeats gives one one-time key to two spends, and each of that key's signatures is still on a transaction the wallet built, which is all B5 uses. Part A is for a sound source: secrecy doesn't survive a failing one (§8).
- **And the other key.** Part B gives the attacker x_m, every network's; Part C gives it x. Each reduction picks the other key itself (§3).

**The wallet in this game is the web wallet.** Its one-time keys come from x (use 8), so choosing its draws gives the attacker none of them. The CLI draws each one-time key from the random source alone (seedelf-cli/src/commands/spend.rs:26). Whoever predicts that source holds the key a CLI proof is bound to, and can sign another transaction that carries the proof. So under a predictable source Part B doesn't cover a CLI spend. The CLI has no x_m and runs no Messages.

**Theorem (informal).** In the random-oracle model, with §3's hashes as independent random oracles, and the code keeping rules 1 to 8:

**(A) Messaging keeps its claims, where it has them.** Let P be a property of x_m's uses 5 to 7m (security.md's properties, or the handshake's secrecy and authentication), argued in the random-oracle model by a reduction R_P to an assumption Z_P. Then P still holds, with Z_P, against an attacker that also has the oracles of x_m's proofs (uses 4, 10 and 11m) and every funds oracle. The loss is at most

    q_pf · (q_H + q_pf) / q + ε_key + ε_seed

where:
- q_pf is the number of x_m's proofs made (keys proofs, reveals and certificates), and q_H the attacker's hash queries;
- ε_key is the chance the attacker queries a keyed oracle under its key: N_rev, N_b, N_keys or N_cert_m under x_m, which R_P can use as x_m, or N_e, N_s or N_k under e_A, s_A or b. That's at most the advantage of finding the discrete log of E_A or S_A on p₀, or of p₀ on h_S;
- the terms for e_A and s_A need a sound source: a stuck one prints both in F (§8);
- the term for b is the discrete log of p₀ on h_S for an attacker that may hold the reader's key, which this document doesn't reduce to the ordinary one: a reduction that plants its instance in p₀ needs w₀ = [b]m_S, which only the reader's key gives.

x's oracles cost nothing: R_P picks x and runs them as the wallet does. P takes as given that N's certificate binds the reader's own M_S, which (B′) proves. No such R_P exists yet (Status).

**(B) Spending proofs stay unforgeable, whatever Messages gives away.** Say an attacker that holds x_m gets, with probability ε, a transaction accepted that spends a register of x the wallet didn't sign for. Then either:
- it forged an Ed25519 signature under one of the wallet's one-time keys, which are independent of x (B2), or found another key with the same blake2b-224 hash; or
- it made a fresh spending proof, under a vkh of its own.

From the second, an algorithm of about twice the attacker's running time finds x with probability about ε′²/q_H − ε′/2²²⁴, where ε′ = ε − δ and δ is the simulation's loss plus the first case's chance, added up in B5. It needs a DDH oracle, asked only "is W = [x]P?" (§3), and nothing else: no static-DH answer and no power of x. The same holds for Lovejoin's owner proof (1/q in place of 1/2²²⁴).

**(B′) The certificate's binding.** Say an attacker that holds x_m makes, with probability ε, a certificate good for one of the wallet's Seedelfs whose statement the wallet didn't certify. That's either one naming another m_S, or one naming the wallet's own m_S for a Seedelf it never turned on, which would opt that Seedelf in to Messages. Then the same reduction, forking at H_cert, finds x with probability about ε′²/q_H − ε′·3/2²⁵⁶. So no one without x points one of the wallet's Seedelfs at a messaging register, or turns one on.

**(C) x_m stays secret, whatever the funds give away.** Say an attacker that holds x, with every oracle above, outputs x_m with probability ε. Then an algorithm of about the attacker's running time finds x_m from [x_m]G with probability at least ε − δ_C (§7.3). It needs a DDH oracle asked only "is W = [x_m]P?", and nothing else: no static-DH answer, however many conversations the user starts.

**(C′) x_m's proofs are proofs of knowledge.** Say an attacker makes, with probability ε, one of these:
- the wallet accept, as reader, a base proof, a keys proof or a reveal;
- a certificate good for a register (h, m) of x_m whose statement the wallet didn't certify.

Forking it at that proof's challenge yields a witness, with probability about ε′²/q_H − ε′·3/2²⁵⁶ (§7.3):
- for a proof the wallet accepts as reader, the writer-side witness (b for a base proof, the key of A for a keys proof or a reveal) or the reader's, x_m;
- for a certificate, x_m.

So an attacker that makes the wallet accept such a proof without holding its writer-side witness finds x_m.

**Corollary.** No efficient attacker forges a spending proof for x, and so none finds x, since x makes one. None finds x_m, or proves with it. Under gap-DLP, the best known attack on either key is the discrete log's, about 2^127.4: Brown–Gallant's and Cheon's need static-DH answers or powers of the key, and neither key gives any. x_m is one per network, so that holds for each network's.

**The CLI's external address** (use 9) is spent by Ed25519 alone, under a key that's a hash of x and so independent of x's other uses in the random-oracle model (B2). (B) says nothing more about it.

## 7. The proof

### 7.1 Part A: x_m's proofs inside messaging's reductions

This is Theorem 2's first half (DLPSS §4.4, "Security of the KEM component"), done once for each of x_m's proof systems. x's uses need no step here: R_P picks x itself (§3) and runs them, the certificate's x half among them, as the wallet does.

- **Game A0:** P's game, with every oracle of §6.
- **Game A1: nonces drawn.** Replace N_rev, N_b, N_keys, N_cert_m, N_e, N_s and N_k with fresh uniform values for each distinct input, the same value for a repeated one.
  - A0 and A1 differ only if the attacker queries one of those functions with its key: x_m, or e_A, s_A or b. In the random-oracle model nothing else in its view depends on how they're computed, which is ε_key. For e_A and s_A that needs a sound source: they're draws, and a stuck source prints them in F as c₂ and z₂ (§8). The attacker then computes N_e and N_s itself, and this step isn't valid for them. Part C never takes it for them: it holds e_A, s_A and b, and computes N_e, N_s and N_k as the wallet does (§7.3).
  - **This step is where the old reveal failed.** With k₁ drawn from the random source alone, a source that repeats gives one k₁ to two challenges, and A1's "fresh value per input" isn't what the wallet did: the real wallet then leaks its key. Rule 2m makes the nonce a function of everything the challenge covers, so A1 holds whatever the source does. The old drawn b failed the same way: a b that a stuck source gave away wasn't a fresh value either.
  - N_keys's input holds everything H_keys's does but T₁, which follows from it, so A1 holds for it whatever the source does. N_e's and N_s's inputs fix their challenge too (M fixes the three keys, so T_e, T_s and T₁ follow), and N_k's holds everything the base challenge does but T₁ and T₂, which follow from it. N_cert_m's input fixes T_m, then k_x and T_x, so the certificate's challenge. So none of them meets two challenges, whatever the source does: that's rule 2m. It isn't secrecy: A1 holds for N_e and N_s only while e_A and s_A are secret (above).
- **Game A2: proofs simulated.** Answer each proof query without x_m, by the honest-verifier zero-knowledge simulator, and program the proof's random oracle:
  - **Use 4:** take c₂, z₂ and aux from the random source, as the prover does (session/reveal.rs:176–178). Draw H_rev's 32-byte output h, and set c = h mod q and c₁ = c − c₂. Draw z₁ uniform mod q, and compute T₁ = [z₁]p₀ − [c₁]A, T₁′ = [z₁]h_S − [c₁]m_S and T₂ = [z₂]p₀ − [c₂]w₀ as the reader does; if T₁ is O, draw z₁ again. Program H_rev at the statement and those commitments as h. A repeated (statement, c₂, z₂, aux) gets the answer it got.
  - **Use 10, by a simulator that holds e_A and s_A** (Part C's, which has them): take c₂, z₂ and aux from the random source, as the prover does (session/draw.rs:123–125). Make k_e and k_s by their real HMACs, and T_e = [k_e]p₀ and T_s = [k_s]p₀. Draw H_keys's 32-byte output h, and set c = h mod q and c₁ = c − c₂. Draw z₁ uniform mod q, and set T₁ = [z₁]p₀ − [c₁]A, drawing z₁ again if it's O, and T₂ = [z₂]p₀ − [c₂]w₀. Program H_keys(label ‖ M ‖ T_e ‖ T_s ‖ T₁ ‖ T₂) := h, and answer z_e = k_e + c·e_A and z_s = k_s + c·s_A. Only A's branch is simulated. It needs A (rule 1m) and w₀. A repeated (M, c₂, z₂, aux) gets the answer it got.
  - **Use 10, by one that doesn't** (a reduction of Part A that plants its instance in E_A or S_A): the same, but it draws z_e and z_s uniform too, and sets T_e = [z_e]p₀ − [c]E_A and T_s = [z_s]p₀ − [c]S_A.
  - **Use 11m, with x's half real:** take aux from the random source, as the wallet does. Draw H_cert's 32-byte output h, set c = h mod q, and draw z_m uniform mod q; set T_m = [z_m]h_S − [c]m_S, drawing z_m again if it's O. Make k_x by its real HMAC over the statement, that T_m and aux, drawing aux again for a zero k_x as the wallet does, and T_x = [k_x]g_S. Program H_cert(label ‖ statement ‖ T_x ‖ T_m) := h, and answer z_x = k_x + c·x. A repeated (statement, aux) gets the answer it got.
  - **Why it's the same:** in A1 each proof is a Schnorr, CDS or AND transcript with a uniform nonce. The simulator's response stands for the nonce: z₁ − c₁·x_m in uses 4 and 10, z_m − c·x_m in use 11m, uniform as the real one is. The rest is the same function of it and of the hash's answer. In use 11m, k_x then has the input the wallet's would, since T_m does.
  - **What each is exact under.** Use 4's simulator, use 10's first and use 11m's: once N_rev, N_keys and N_cert_m are A1's fresh values, the answer is distributed exactly as the wallet's proof, whatever the random source does, since both take the same draws from it. They part only when the real nonce is 0 and the prover draws again (about 1/q), when a simulated nonce's 64 bytes reduced mod q miss uniform (2⁻²⁵⁹), or when the programming fails (below). Use 10's second: only while N_e and N_s are fresh values to the attacker too, so only with a sound source. An attacker that chooses the draws holds e_A, s_A and aux, checks z_e − c·e_A against k_e's HMAC, and tells this simulator from the wallet; a stuck source prints e_A and s_A in F by itself (§8). Part C uses the first.
  - **Where it fails:** only if the point being programmed was already queried. T₁ or T_m is uniform in G, so that's at most (q_H + q_pf)/q for each proof.
  - **It needs the public value to be public,** which rule 1m makes sure of: no proof is made for a register that isn't x_m's.
  - **Rule 3 makes the programming invisible to the other uses:** H_rev, H_keys and H_cert each take inputs no other use hashes, so another computation queries one only to verify such a proof, where a programmed answer is what the real proof's would be (receiving a first message verifies keys proofs, under the reader's own w₀; a writer checks certificates); and no proof queries H_kdf.

In A2, x_m appears only in uses 1m and 5 to 7m, which is P's own game. So R_P applies as it stands. ∎(A)

### 7.2 Part B: the funds, with x_m handed over

The reduction B gets a DLP instance X = [x]G and a DDH oracle, of which it asks only "is W = [x]P?" (§3). It draws x_m, every network's, uniformly as the derivation gives it (§3), and hands it to the attacker: only a query at the wallet's own seed, ε_seed, tells this from the real derivation. It runs the attacker and simulates every funds oracle without x, taking each value the wallet would draw from the attacker (§6). It also makes the wallet's one-time keys itself, so it can sign as rule 7 says: one key for each seed, and the same key for a seed the attacker repeats.

- **Game B1: registers.** Each register the wallet publishes is ([d]G, [d]X) for a fresh d that B keeps, as re-randomization makes them. The root is (G, X).
- **Game B2: the nonces and keys derived from x drawn:** N_spend, N_lj, N_cert_x, H_ot and H_ed get fresh values for each distinct input, as A1 does. The one-time and external keys' Ed25519 signatures are then made with keys independent of x. If the attacker ever queries one under some x′ with [x′]G = X, B outputs x′. For the two keyed by x itself through HMAC-SHA-512, B tests a query's key in the form HMAC gives it, padded with zero bytes to the hash's block: its first 32 bytes are the candidate x′, so x's 32 bytes with zero bytes after them are caught as x's alone are. x_m's keyed functions (N_rev, N_b, N_keys, N_cert_m) B computes as the wallet does: it holds x_m.
- **Game B3: x's proofs simulated,** programming each proof's random oracle:
  - **Use 2:** draw c uniform in [0, 2²²⁴) and z uniform mod q; set T = [z]g − [c]u; program H_spend(g ‖ T ‖ u ‖ vkh) := c.
  - **Use 3:** likewise, with H_lj's 256-bit output chosen uniformly and c its value mod q.
  - **Use 11x, with x_m's half real:** take aux from the random source, as the wallet does. Make k_m by its real HMAC under x_m, and T_m = [k_m]h_S, drawing aux again for a zero k_m as the wallet does. Draw H_cert's 32-byte output h, set c = h mod q, and draw z_x uniform mod q; set T_x = [z_x]g_S − [c]u_S, drawing z_x again if it's O. Program H_cert(label ‖ statement ‖ T_x ‖ T_m) := h, and answer z_m = k_m + c·x_m. A repeated (statement, aux) gets the answer it got.
  - **Why it's the same:** in B2, k_x is a fresh value for each distinct (statement, T_m, aux), and T_m is fixed by (statement, aux), so k_x is fresh for each new (statement, aux) and repeats with it. z_x − c·x stands for it, uniform and nonzero as the real one is (T_x = O stands for a real k_x of 0, which the wallet draws again). What the attacker knows of x_m, x_m itself included, doesn't help it tell: k_x's key is x alone (rule 8). So the answer is the wallet's, whatever the source does. Uses 2 and 3: the same, up to the zero values a draw excludes (about 1/q each).
  - **Where it fails:** only if the point being programmed was already queried. T and T_x are uniform in G, so that's at most (q_H + q_pf)/q for each proof. (2⁻²²⁴, the spend's challenge space, matters only to the fork in B5.)
  - **It needs u to be public,** which rule 1 makes sure of. For a Seedelf the attacker minted under the key, B decides u_S = [x]g_S with the DDH oracle, as the wallet's own test would.
  - **Rule 3 makes the programming invisible to the other uses:** H_spend, H_lj and H_cert each take inputs no other use hashes, so another computation queries one only to verify such a proof, where a programmed answer is what the real proof's would be.
- **Game B4: Messages, run as the wallet runs them.** B holds x_m, so it opens, scans, starts, receives, continues and reveals as the wallet does. Nothing there takes x (rule 8), but Messages depends on two things that do: which Seedelfs are the wallet's, so its handles, which the DDH oracle decides, and the certificates, which B3 makes. The other ownership tests (7x) are DDH answers too: is (G, X, g, u) a DH tuple? That's all of B4. The one-key B4's simulation of the scan, opening, receiving and starting moves to Part C (§7.3), where x_m is the secret.
- **Game B5: forking.** The attacker's transaction spends a register (g*, u*) of x that the wallet didn't sign for, with a proof (T*, z*) under some vkh*.
  - **If vkh* is the hash of one of the wallet's one-time keys,** the transaction carries a signature the wallet didn't make (rule 7), under that key or under another key with the same blake2b-224 hash: an Ed25519 forgery under a key independent of x (B2), or a second preimage, at most n_v·q_H/2²²⁴ for the wallet's n_v one-time keys. B gives up; that's the first case of (B).
  - **Otherwise the query wasn't programmed:** B3 programs H_spend only at points (g ‖ T ‖ u ‖ vkh) whose vkh is a wallet key.
  - **The fork:** by the general forking lemma (Pointcheval–Stern; Bellare–Neven), B reruns the attacker with the same coins and a fresh answer at the H_spend query for (g* ‖ T* ‖ u* ‖ vkh*). It gets (z*, c*) and (z**, c**) with c* ≠ c** with probability about ε²/q_H − ε/2²²⁴.
  - **The answer:** since u* = [x]g*, [z* − z**]g* = [c* − c**]u*, so x = (z* − z**)/(c* − c**). B doesn't need log_G g*.
  - **Both runs replay the same oracle answers before the fork.** The DDH oracle is deterministic, and B's own draws (x_m among them) are its coins, so the simulation is consistent across the fork.
  - **A certificate is no spending proof.** B3 programs H_cert, never H_spend, so the fork is untouched. And a certificate is simulatable without x (B3), so it gives a forger nothing it couldn't make itself.
    - Concretely, its transcript (T_x, c, z_x) is on (g_S, u_S), the Seedelf's own register, where its token sits. It can be mauled into a pair for any challenge t: T′ = T_x + [c − t]u_S verifies with z_x under t.
    - But T′ is then fixed by t, so a spend needs blake2b-224(g_S ‖ T′ ‖ u_S ‖ vkh) = t, for a vkh the attacker can sign under. That's a chance of about 2⁻²²⁴ a try, what a forger has with no certificate at all, and it holds because H_spend is never programmed. The same goes for [d](g_S, u_S), and for Lovejoin's verifier, at about 3/2²⁵⁶ a try.
    - The test 55b adds is in §10.
  - **x_m's transcripts bear on no spend.** A keys proof's or a reveal's transcripts are now under x_m, on registers of x_m, which are no register of x but with probability 1/q.
  - **The loss:** ε′ = ε − δ, where δ is at most the sum of:
    - the first case's chance, an Ed25519 forgery's and n_v·q_H/2²²⁴;
    - a programming collision, q_pf·(q_H + q_pf)/q;
    - a real nonce of 0 drawn again, q_pf/q;
    - a simulated nonce's 64 bytes reduced mod q, q_pf·2⁻²⁵⁹;
    - and ε_seed.

    q_pf counts x's proofs made: spends, Lovejoin proofs and certificates. ε_key isn't in it: B turns such a query into x. The one-key B5's envelope terms are gone, since B opens envelopes with x_m as the wallet does.

The same fork works for Lovejoin's owner proof, at H_lj. ∎(B)

**(B′), the binding.** The forged certificate's statement is one the wallet never certified: another m_S, or the wallet's own m_S for a Seedelf it never turned on, which the attacker can compute since it holds x_m. So its H_cert point isn't one B3 programmed, and only x's half stands in the attacker's way. B forks there, as in B5. Two accepting certificates on the same (statement, T_x, T_m) with c ≠ c′ give [z_x − z_x′]g_S = [c − c′]u_S, and (g_S, u_S) is the wallet's register, so x = (z_x − z_x′)/(c − c′). Two answers of SHA-256 reduced mod q coincide with probability at most 3/2²⁵⁶, the fork's term in place of B5's 1/2²²⁴. ∎(B′)

**Why Part B needs no static-DH answer:** x makes no start, opens nothing, and proves nothing on a point a stranger chose but its own registers (rule 1). The one-key proof's need came from B4's start (c096eab9, §7.3), which x no longer makes.

### 7.3 Part C: x_m inside the reduction

The reduction B_C gets X_m = [x_m]G and a DDH oracle, of which it asks only "is W = [x_m]P?". It draws x itself (§3), hands it to the attacker, and runs every funds oracle as the wallet does, x's half of every certificate included. It takes each value the wallet would draw from the attacker (§6).

- **Game C1: hashed bases programmed.** B_C answers each new query to H_base, the attacker's or the wallet's, with [η]G for a fresh η uniform in [1, q − 1], and keeps η. A random oracle to G1 gives a uniform point, so this is exact but for O, which the real one gives with probability 1/q a query and the wallet refuses: q_H/q in all.
- **Game C2: registers.** Each of the wallet's messaging registers is (h_S, [η_S]X_m), with η_S = log_G h_S from C1. Each R_A comes from a start (C5).
- **Game C3: the nonces keyed by x_m drawn,** as A1: N_rev, N_b, N_keys and N_cert_m. If the attacker queries one under some x_m′ with [x_m′]G = X_m, B_C outputs x_m′, testing the padded key as B2 does. N_e, N_s and N_k stay as they are: B_C holds e_A and s_A, which the attacker chose, and b, which is N_b's answer.
- **Game C4: proofs simulated,** as A2: reveals, keys proofs by the simulator that holds e_A and s_A, and certificates by use 11m's, with x's half real. B_C knows each statement's public value (rule 1m, C2).
- **Game C5: Messages simulated,** as the one-key Part B's B4, with x_m, X_m and (h_S, m_S) where it had x, X and (g_S, v_S):
  - **The scan and ownership tests** (use 7m): is (G, X_m, h, m) a DH tuple? The DDH oracle answers, or C2 for the wallet's own M_S. The scan has no public value to test, only the envelope's tag: an envelope (p, tag) is the wallet's exactly when H_tag's table holds a query W answered with that tag and (G, X_m, p, W) is a DH tuple, which the DDH oracle decides. With no such query the wallet would have accepted with probability about 2⁻²⁵⁶, which B_C counts as a refusal.
  - **Opening an envelope** (use 5): as in ECIES's gap-DH proof (Abdalla–Bellare–Rogaway; Cramer–Shoup). B_C keeps H_kdf's table. For an envelope with c and header H, if the attacker already queried H_kdf at (salt, Z, info ‖ H) with (G, X_m, c, Z) a DH tuple, that answer is the key. Otherwise B_C draws one, and gives it to any later query whose Z the DDH oracle accepts.
  - **Receiving a first message** (use 6, as reader):
    - **The keys proof,** checked before SK, needs w₀ = [x_m]p₀. B_C finds it in H_keys's table: a proof that verifies was made with a query whose M holds the true w₀, which B_C recognises with the DDH oracle on (G, X_m, p₀, W). With no such query B_C refuses, and the wallet would have accepted with probability at most 3/2²⁵⁶ (§3). (Or B_C checks the proof last, with the w₀ that H_tag's table gives, below: every refusal is silent, so the order is B_C's.) In a continuation the reader's value is one of the two held values, which B_C has.
    - SK = H_kdf([x_m]E_A ‖ [x_m]A, info ‖ F) and the first step's KDF_RK(SK, [x_m]S_A) are handled the same way, with two and one DDH checks. If the attacker never queried the right inputs, B_C draws the keys, as it does an envelope's, keeps them for a later query the oracle accepts, and opens with them as the wallet would. So no AES-GCM forgery term is lost here.
    - The associated data needs w₀ = [x_m]p₀ itself. The envelope gives only the tag of the register's public value, but the scan's simulation gives the W behind it: H_tag's query W with (G, X_m, p, W) a DH tuple, so W = [x_m]p. The wallet reads a message only if p = [o]p₀ and c = [r]p for the message's outer scalar o and envelope scalar r (conversation.rs:495). Both come from the message key, which B_C now has, and the salt. So B_C checks p = [o]p₀ and c = [r]p itself and sets w₀ = [o⁻¹]W, which is [x_m]p₀ whenever the wallet would read the message.
    - **One condition:** the wallet checks the keys proof before SK, and the message's AES-GCM tag before the envelope (conversation.rs:281 before :287, and the ratchet's decryption at :444 before the envelope's check at :456). Where B_C can't tell which refusal the wallet would give, the refusals must look the same to the attacker, and they do: the keys proof, the AES-GCM tag and the envelope's checks refuse alike, and protocol.md §2 drops each without a word.
  - **Starting a conversation** (use 6, as writer) to a handle (h_S, m_S), h_S the writer's own hash of N's register (protocol.md §21.3):
    - B_C draws b as N_b's answer (C3) and sets p₀ = [b]h_S. It knows η = log_G h_S (C1), so A = [b·η]X_m is the real value, and w₀ = [b]m_S. **Both are known, so no static-DH answer is needed.** The one-key proof always lacked one of the two, since its base g_S was the attacker's (§7.4).
    - B_C knows b, so it makes the base proof as the wallet does, k from N_k under b, simulating the reader's-key branch as the wallet does.
    - B_C makes the keys proof by programming H_keys (C4), with that A and w₀.
    - [x_m]w₀ only enters H_kdf, which B_C handles with the DDH oracle on (G, X_m, w₀, ·). It looks in H_kdf's table before it draws SK: an attacker that chooses the draws can make a start repeat, F and all, and may have asked for that SK already.
  - **Continuing** (use 6′): the A it publishes is [x_m]p₀ for an old p₀, which B_C already has from that conversation's start or first message.
  - **Revealing** (use 4): simulated as in C4, since A and the Seedelf's M_S are known to B_C.
- **The win: x_m itself.** The attacker outputs some x_m′, and B_C checks [x_m′]G = X_m. There's no fork, so the reduction is tight: B_C finds x_m with probability at least ε − δ_C, where δ_C is at most the sum of:
  - C1's q_H/q;
  - a programming collision, q_pf·(q_H + q_pf)/q, with q_pf here x_m's proofs (keys proofs, reveals, certificates);
  - a real nonce of 0 drawn again, q_pf/q;
  - a simulated nonce's 64 bytes reduced mod q, q_pf·2⁻²⁵⁹;
  - for each envelope the attacker delivers, a tag met by chance, 2⁻²⁵⁶, and a keys proof's challenge guessed, 3/2²⁵⁶;
  - and ε_seed.

  ε_key isn't in it: B_C turns such a query into x_m. ∎(C)

**(C′), extraction.** The one-key Part B forked at H_spend, on a spend forgery. x_m has no spend, so (C)'s target is x_m itself, with no fork. What forks instead is any proof the attacker gets accepted, each at its own challenge's hash, by the general forking lemma, with B_C's simulation as above (the DDH oracle and C1's programmed points replay before the fork, as B5 says). The fork yields one of the proof's witnesses, which one depending on how the attacker made the proof:
- **A keys proof or a reveal the wallet accepts as reader.** Two accepting proofs on the same commitments with different challenges differ in c₁ or in c₂. If in c₁, (z₁ − z₁′)/(c₁ − c₁′) is the writer's key. For a reveal that one scalar is the key of both A and the Seedelf's m_S on h_S, and with different keys there the commitments fix c₁, so the fork lands on c₂. If in c₂, (z₂ − z₂′)/(c₂ − c₂′) is the key of w₀ on p₀: the reader's own x_m.
- **A base proof the wallet accepts:** the same, to b or to the key of the reader's M_S, x_m.
- **A certificate good for a register (h, m) of x_m, under a statement the wallet didn't certify:** (z_m − z_m′)/(c − c′) = x_m. h is the hash of the statement's own Seedelf, so the wallet's own m_S fits only the wallet's own statement. Such a certificate shows a value [x_m]h on a hashed point the wallet never multiplied, and the back-signature makes it a proof of x_m besides.
- **The fork's hash point is never one B_C programmed:** a keys proof B_C made names someone else's handle, since the wallet refuses its own (7m); a reveal B_C made is for another statement; and a certificate B_C made is for a statement of the wallet's own.

Each yields its witness with probability about ε′²/q_H − ε′·3/2²⁵⁶, with ε′ = ε − δ_C. So a proof the wallet accepts from an attacker that doesn't hold the writer-side witness gives x_m. ∎(C′)

### 7.4 What became of the static-DH step

**In the one-key proof,** one step of Part B needed [x]P for a point the attacker chose: starting a conversation to its handle needed [x]g_S.
- With p₀ = [b]g_S, a reduction knew w₀ = [b]v_S but not A. With p₀ = [β]G it knew A = [β]X but not w₀, which needs the handle's key on the reduction's point.
- w₀ is unhashed in every message's associated data, so it couldn't be answered late.
- That step was argued under static DH in the plain random-oracle model: rule 1's table at q_s answers, and a belief that blinded answers give nothing more, which three attempts by two models failed to break (2026-11-24).
- It was proved inside the algebraic group model, over three classes of handle. The worst, class C, a generator built from x's own points, reduced to the (q_C + 1)-discrete-log problem under a side condition S on AES-GCM (c096eab9, §7.3).

**After chunk 55:**
- **x starts nothing,** so Part B meets no such step.
- **x_m starts on a hashed base.** h_S is H_base's output over N's register, which the writer computes itself (protocol.md §21.3; a certificate carries no h_S), and p₀ = [b]h_S. A reduction that programs H_base knows log_G h_S, so it has both A and w₀ (C5).
  - Every handle falls in the one-key proof's "known generator" class, where that proof was already exact.
  - Class C can't arise: a hash output depends on nothing anyone can steer toward X_m.
- **So the step needs neither static DH nor the algebraic group model.** Neither does anything it carried: q_s, q_C, AES-GCM's terms and the side condition S.
- **Inside the algebraic group model the decision oracles go too,** as the one-key §7.3 showed: two representations answer "is W = [x_m]P?" (or [x]P), so Parts B and C are then the plain discrete log. Neither part needs that model.
- **b's secrecy no longer guards a key.** Nothing in Part C rests on it: a leaked b gives [x_m]h_S = [b⁻¹]A, which B_C makes as [η]X_m. That's the argument behind BLS signatures: [x]H(m) for any number of messages costs x nothing in the random-oracle model.

**What it rests on:**
- **H_base as a programmable random oracle to G1.** RFC 9380's indifferentiability result gives that for single-stage games such as these, with SHA-256 a random oracle and H_base's queries kept apart from its other uses (rule 3).
- **Every base x_m multiplies into an output is a hash or a bound one:** h_S, the writer's p₀ = [b]h_S, a reader's p₀ that the base proof binds to its M_S, a continuation's old base. That's rule 1m. 55b's tests must hold it: a writer computes h_S itself, and never takes a base from the list or from a message.

**What would bring it back:** M_S on g_S, which the chunk 55 plan's design and its call 5 proposed before §21.3 chose the hash. A Seedelf minted under the key from the wallet's own registers would then put x_m exactly where the one-key proof had x, class C and all.

This section's claim is new with this version. Both of 55a's attacks found it sound (2026-11-26, §10). It's still the first step for a person to check (§7.5).

### 7.5 What's routine and what's new

**Routine:**
- Part A's simulation of each proof (DLPSS §4.4; the Schnorr, CDS and AND-proof simulators).
- ECIES's gap-DH simulation, and the forking lemma.
- Programming a hash into the group, as BLS signatures' proof does.

**New, and where a reviewer should push.** Items 4 to 8 were pushed on in the one-key version (2026-11-24, §10), and what that left is said with each. Items 1 to 3 and 9 are new with this version, and were pushed on by 55a's two attacks (2026-11-26, §10), which found nothing that reaches a key.
1. **Two keys from one seed** (§3): independent in the random-oracle model, or under HMAC as a dual PRF, but for ε_seed. Push: that no use of either key feeds the other's derivation, and the salts and infos as built.
2. **The certificate beside x's other proofs** (rules 2 and 3, B3): one challenge over two halves, k_m first, k_x over T_m, one aux. Its x half is simulated with x_m's half real (B3), and its x_m half with x's half real (A2). Push: that each simulator is exact when the attacker holds the other key and chooses the source, and that no certificate's transcript is a spend's (B5, and the test in §10).
3. **The hashed base** (§7.4), which takes the static-DH step out of Part C. Push: indifferentiability as applied here, rule 3's separation of H_base, and every place x_m meets a base.
4. **Many bases.** Each key's public side is a set of registers, not one key. B handles x's by re-randomizing X (B1), and extraction needs no log_G g* (B5); B_C handles x_m's by programming H_base (C1). The step to check is that the attacker can't gain from registers it re-randomized itself.
   - **Pushed** for x: each proof is simulated from its own public value alone. Each challenge covers its base and public value, so a transcript moved to [d](g, u) answers another hash input. And a combination of transcripts across bases must meet one hash, not a sum of several the attacker arranges. Nothing found.
5. **Six proof systems on two keys:** x's spend, Lovejoin's and certificate half, and x_m's reveal, keys proof and certificate half. That's rules 2 and 2m, and the hedging, as the hypothesis that keeps A1 and B2 true when the random source fails. In the one-key design the reveal didn't meet it at first, and the keys proof's first design didn't either (§9).
   - **Pushed** for all but the certificate: with every draw the attacker's to choose, each proof is still a function of its nonce's key and message, and no nonce meets two challenges. What it found is beside the key: the simulated branch's draws (§9). The certificate's nonces were confirmed by §21's review (2026-11-26).
6. **The funds game** (§6, rule 7): a spend is safe only if its proofs are bound to a fresh key of the wallet's that signs nothing else. That's a rule about the worker, not about x.
   - **Pushed:** under a predictable source it doesn't cover the CLI (§6). The certificate's transcript on the Seedelf's own register has a bound (B5), and will have a test (§10).
7. **Decision bits beyond decryption:** the scan, acceptance, what the wallet spends. Rule 4 claims each is a DDH answer. That claim is checked against the code in §4, not proved.
   - **Pushed,** in the crate and its bindings: each bit is computable from "is W = [k]P?" and the attacker's own hash queries (C5), and a reveal's check isn't one of them (rule 4). Left: timing. A relay that times a wallet's reads against envelopes it sealed itself gets that answer a page at a time. It's an oracle for linking, not on a key, and it's declared (§8), not measured.
8. **Domain separation** (rule 3), across functions that Cardano and Lovejoin also use.
   - **Pushed** for Messaging's own labels: where each pair first differs, in raw SHA-256 and under HMAC-SHA-512. Not checked again: SHA-512's other uses (Ed25519, BIP39), and HKDF taken as one oracle though it's HMAC twice. Routine, and still to do. The certificate's labels and H_base's inputs are new, and not built.
9. **Rule 8,** the separation, is a property of code not written yet. Its tests (§10) are what make Part B's "attacker that holds x_m" honest.

**Where the next reviewer should push:**
- **The code against this document,** once 55b to 55e are built: rule 8's and rule 1m's enforcement points (§5), and rule 3's table against every SHA-256 input as built.
- **ε_key's term for b** (§6), which no one has reduced to the ordinary discrete log.
- **The send's salt and the simulated draws' fix** (§9), before either is built: the fix is a new use of x_m.
- **Part A:** write one reduction R_P, for any Messaging property, so Part A says something.
- **The oracle model:** rule 3 across SHA-512's every use, HKDF as it's built, and H_base.
- **And it should be a person.** Everything here is models' work (Status).

## 8. What this doesn't cover

- **Memory-level bugs.** x and x_m live in the same WebAssembly module (protocol.md §21.1), held the same way (the plan's 55d). A bug that reads the module's memory reaches both, and Part B's attacker that holds x_m isn't one that reads the module. Those bugs are hunted in review (the owner, 2026-11-26).
- **Side channels.** Timing, caches, and the WebAssembly engine, which promises nothing about timing (security.md, "Before production"). Whether the module's time depends on its key was measured on 2026-11-24, with x in Messages' roles, and nothing was found above the measurement's floor: security.md, *Assumptions*, says what was measured and what wasn't. It's measured again with x_m once built. The scan has no early return: it answers one digit an envelope, at the same cost whether the envelope is ours (the wasm's `scan`; `tag_matches` compares in constant time). What the wallet does next with one that is ours, opening it and taking it in, takes time a watcher can measure: a timing signal of the kind rule 4 counts.
- **A data source that lies about a register.** A certificate is good for N only against N's register in the reader's own read of the contract (protocol.md §21.5). A source that lies about it can make an old certificate good again, a replay, or offer a made-up register beside a certificate its maker made. A writer then writes to the wrong M_S. That costs messages and spends nothing, since the writer pays nothing. It's the limit already accepted for paying by name (protocol.md §2).
- **Re-certifying after a move is the user's action.** A Seedelf that moves gets its new certificate only when the user turns it on again (protocol.md §21.8). Were it automatic, a lying data source that showed a turned-on Seedelf at some other register would learn from whether the wallet posts whether that register is the wallet's: an ownership bit on x (rule 4), handed to whoever runs the source.
- **A certificate for a Seedelf someone else minted** at a register built from the wallet's own, such as the sum of two, is a public and lasting proof that x knows that register's key, so that those registers share a key (protocol.md §21.8, §2). The switch says so before such a Seedelf is turned on. It costs linking, not a key: the certificate's x half is a proof on public values (rule 1).
- **The relay sees each certificate post's address** (protocol.md §11, §21.7), and so which Seedelfs an address has turned on. Posting apart hides them from a reader of the list, not from the relay.
- **The relay withholding certificates.** It can withhold or drop one, and then writers who read its list can't write to that Seedelf. It can't forge one (B′).
- **x stolen.** The thief can certify its own m_S for the wallet's Seedelfs (§21.5, §21.8).
  - Beside the wallet's certificate, that leaves the Seedelf taking first messages from no one.
  - Before it, or after moving the Seedelf with x and certifying it there, the thief's is the one good certificate, since the owner's wallet posts nothing on a conflict. Writers who read the list then write to the thief, and the wallet says another key holds that Seedelf's messages.
  - It reads no message sealed to x_m (C). Moving the Seedelf is the owner's way back, though the thief can move it too.
- **x_m stolen.** The thief reads what's sealed to x_m, up to forward secrecy, and can pose as the wallet (protocol.md §1.1). It can also pose to the wallet's user as anyone: key-compromise impersonation, which designated-verifier proofs have by design.
  - That now includes a reveal. The thief starts a conversation to the wallet and reveals any Seedelf with a good certificate, proving branch 2 with the reader's own x_m on w₀, and the wallet shows "Verified ⟨N⟩" (protocol.md §21.9).
  - protocol.md §19.5's answer, that whoever has x_B has the funds too, no longer holds: x_m spends nothing. So a stolen x_m can mislead the user, a payment included, but it forges no spend (B).
- **The random source, beyond the hedging.** Rules 2 and 2m keep every proof's nonce, the writer's b and the base proof's k safe from a failing source. Secrecy and unlinkability don't survive one:
  - e_A, s_A, the ratchet keys and the ratchet salt are drawn alone, and so are the base proof's, the reveal's and the keys proof's simulated c₂ and z₂, which a source that repeats them would repeat in two readers' proofs.
  - A source stuck on one value also writes e_A and s_A into F, as the base and keys proofs' simulated c₂ and z₂. x_m and b still never appear, and no nonce repeats. But the first messages' secrecy then rests on the static DH alone, so a later theft of the writer's x_m reads them too, once aux_b, the same stuck value, is guessed.
  - Deniability doesn't survive one either (§9).
  - A source that repeats can make two sends share an AES-GCM key and nonce where the wallet's storage no longer holds the first (§9, the repeated start).
- **Deniability** is not this document's claim.
  - Use 10 and the base proof are both designated-verifier, so with a sound random source neither adds evidence a third party could check. With a source that had failed when a proof was made, the proof's printed c₂ and z₂ can show anyone which branch was simulated, and the proof is then evidence (§9; protocol.md §7 says what a reader can then show).
  - The certificate isn't deniable, by design. It's a public proof that the holder of a Seedelf's key named m_S, so that Messages is on for that Seedelf (the plan's call 2). It names no conversation.
- **Unlinkability** (XDH): another model's job, the outer envelope's and then unlinkability's. M_S on independent hashed bases can't be told to share x_m without it, as registers of x can't (protocol.md §21.3). What can link Seedelfs is when their certificates appear, which §21.7 meets by posting them apart.
- **The handshake's own security.** Part A carries over whatever it has. Its symbolic proofs are the Tamarin model ([model/](../model/)), which 55g gives x_m and the certificate, and there's no computational proof of it here.
- **The contracts' correctness:** seedelf-verification, for Seedelf's three scripts and Lovejoin v2's (mix_logic's Owner withdrawal included, in every transaction). Part B takes the validators as they're stated there: Seedelf's frozen variant 1 hashes raw bytes with blake2b-224, takes z of any length below q, and needs the vkh in the extra signatories; Lovejoin's owner proof is bound to its ctx, a blake2b-256 hash of the outputs, the input references and the mix box's script hash (`owner_context`, seedelf-core/src/lovejoin/mod.rs:1307).
- **Many wallets at once.** The reductions are for one wallet. Against many they lose a factor of up to the number of keys, as any discrete-log scheme's do.
- **Storage and export of either key:** the vault, the CLI's wallet file, `util expose-key`. Nor what a lock leaves in memory.
  - On a lock the web wallet frees its key objects, and each overwrites its key where it lies before releasing it (the wasm's `Wiped`, since 2026-11-24: before, the freed cell still held the key). 55d holds x_m the same way.
  - A copy a call left on the WebAssembly stack isn't reached by that. The worker scrubs the stack's top 512 KiB after a lock's frees, and after each derivation of keys, before a later call can copy stale stack bytes into the heap (`scrubStack`).
  - A copy a later call built into the heap is reached by neither, and the review found bytes of the Seedelf key there after a lock. So a lock ends by replacing the module's instance and zeroing the old one's whole memory (`renewWasm`).
  - What can still hold a copy is outside the module: JavaScript's own strings and the browser's memory. So wiping is best effort (the wallet's docs/keys-and-accounts.md, "Lock and wipe").
- **The CLI.** It has no x_m (protocol.md §21.2): its Seedelfs get no certificate and take no messages. Its spends are Part B's only under a sound source (§6). Its external key (use 9) is covered only as a hash of x. Its seed is the Ed25519 public key of x's bytes, so anything that ever published that public key would give the address away. Nothing does: a rule to keep, not a flaw.
- **Quantum attackers:** both keys fall to Shor, as every Cardano key does.

## 9. Gaps found

Each was found in the one-key design, where the key in each was x. Each now says which key it concerns once chunk 55 is built. Writing this version found no new gap in protocol.md §21. What it found is a step taken away (§7.4) and tests 55b must add (§10).

### Fixed: the writer's b and the base proof's k

Found by the fresh-context review (§10), and fixed in the change after the reveal's. Both came from the random source alone, in the order b, cid, e_A, s_A, k:
- a stuck source gave k = b, and then z = b(1 + c) gave b away from one F;
- one b and one k under two F′ gave b = (z − z′)/(c − c′);
- a predictable source gave b outright.

b unblinded A into [x]g_S, a static-DH answer on a generator the attacker chose. So with a failing source, each conversation the user started to an attacker's handle handed one out. Not x, and only as many answers as conversations the user started, but exactly what rule 1 forbade.

**The fix,** the reveal's hedge (rule 2m's b and k):
- protocol.md §16.2: b = HMAC-SHA-512 keyed by the writer's key over the handle, F's head and 32 drawn bytes, and k = HMAC-SHA-512 keyed by b over the handle, p₀, F′ and 32 drawn bytes. §3 and §16.3 follow: cid is drawn first, since b covers it.
- Two choices made in building it: b's message holds F's head in F's own encoding, so cid and `replaces` too; and k is keyed by b, the witness it hides, not by the key, so the key meets one new HMAC, not two.
- The session vectors were re-recorded with b's and k's messages and HMACs, and the reveal vectors too, since their conversations start from a handle: a deliberate format change. The relay's and v1's vectors are byte for byte as they were, and the reveal's 31 checks give the results they gave.
- Later, in the 1.10.0 gate review, the base proof became designated-verifier (protocol.md §16.2): b's branch or the reader's key's, so the reader can make one itself. k's message gained the simulated branch's c₂ and z₂, for the reason the reveal's holds them, and a zero k draws all three again.

**Once chunk 55 is built:** b is keyed by x_m and blinds A = [x_m]p₀ on p₀ = [b]h_S. A leaked b would give [x_m]h_S on a hashed base, which no one chose: no longer what rule 1m forbids, and nothing Part C rests on (§7.4). The hedge stays: it costs nothing, and rule 2m has no exceptions.

### Fixed before it was built: the keys proof's nonce

The 1.10.0 gate review added use 10, the keys proof, to bind E_A, S_A and A before the reader multiplies them by its key. Both design reviews of its first draft found the same gap:
- k₁'s message left out T_e and T_s, and each of the three nonces drew its own aux;
- so a source that repeated every draw but aux_e gave one k₁ under two challenges, and the key = (z₁ − z₁′)/(c₁ − c₁′) from two F.

**The fix** is rule 2m's use 10: one draw of c₂, z₂ and aux for all three nonces, each nonce's message holding everything its challenge covers, and one helper that draws and derives them together, all again on a zero. A third review then varied every subset of a start's eight draws (cid, aux_b, e_A, s_A, aux_k, aux, c₂, z₂), and t, and no pair gave the key, e_A, s_A or b. The tests now vary each of a start's ten draws (the base proof's c₂ and z₂ came with its designated-verifier form) and every subset of them, and the three mutants each give a secret away under a single varied draw (§10).

**Once chunk 55 is built:** k₁ is keyed by x_m. The same repeat would have given x_m: messages, not funds.

### Fixed: the reveal's nonce

**The reveal's k₁** came from the operating system's generator alone. Two reveals sharing a k₁ under different challenges give the key away, and in the one-key design that key spent. The spending proof's nonce was hedged for exactly this reason (chunk 51, t1a#6), and the reveal didn't follow it. Fixed with the one-key version of this document:
- protocol.md §19.2: k₁ is HMAC-SHA-512 keyed by the writer's key over the statement, the simulated branch's c₂ and z₂, and 32 drawn bytes;
- the reader's own reveal derives k₂ the same way;
- the reveal's vectors were re-recorded, a deliberate format change. The proofs changed and nothing else did: the conversations, and every check's result, are as they were.

The handoff that found it proposed HMAC over the statement and aux alone. That isn't enough: the challenge also covers T₂, built from the drawn c₂ and z₂, so a source that repeats aux but not them would put one k₁ under two challenges. They're in the message for that reason.

**Once chunk 55 is built:** k₁ is keyed by x_m, over §21.9's statement.

### Fixed: use 2's guard

It came out of the same sweep. `create_proof` made a proof for any register it was given, so the rule that no proof is made for a register x doesn't own rested on every caller. They all keep it today, but there are about 12 of them, and a JS export (`createProof`) took any register. It now refuses one, at the cost of one scalar multiplication per input.

**Once chunk 55 is built:** x's, unchanged. The certificate's x half has the same guard from its first draft, behind rule 5's point checks (protocol.md §21.4, step 1).

### Open: the simulated branch's draws

Found when the written arguments were attacked (2026-11-24, §10). It costs deniability, which isn't this document's claim (§8), and not the key.

In the base proof, the keys proof and the reveal, the writer simulates the reader's branch with a challenge share c₂ and a response z₂. It draws both from the random source alone (session/draw.rs:123–124, `hedged_or_draws`; session/reveal.rs:176–177, `hedged_nonce`) and prints both in the proof. Rule 2m covers them only as far as the key needs: each nonce's message holds them, so no nonce meets two challenges.
- **The key and b are safe whatever those draws are:** §7.1's simulators take them from the source as the prover does.
- **Deniability needs them to have come from a sound source.**
  - A source stuck on one value prints c₂ = z₂ in both of F's proofs and in a reveal, with E_A = S_A = [c₂]p₀. One that repeats prints one c₂ in two proofs. One that a third party could predict prints the c₂ it predicted.
  - A proof the designated reader makes with its own key shows such a relation only with probability about 1/q a try: there c₂ = c − c₁ is fixed by the hash, after the commitments.
  - So anyone can then tell that the reader's branch was the simulated one, and the proof is a plain one: the keys proof of the writer's key on p₀, a reveal of the Seedelf's key, bound to cid, p₀, A and w₀, and the base proof of b. protocol.md §7 says what a reader can then show others.
- **Beside it, with the writer's key.** b, k and each k₁ are HMACs under the writer's key, or under b, over 32 drawn bytes. Whoever later holds that key and can guess those bytes can check them against a proof, and no proof of the reader's would pass. A sound source leaves the bytes unguessable. No derivation takes this away: it comes with deriving anything from the key.
- **The fix, not built yet:** derive c₂ and z₂ as the nonces are, by an HMAC under the prover's key over the statement and the 32 drawn bytes. A stuck or repeating source then prints values that look drawn. It changes only what a writer does: the reader's check and every format stay, and the session and reveal vectors are re-recorded. It would publish values derived from the key, so it's a new use: §4 and §5 to §7 take it in before it's built (§10's rule).

**Once chunk 55 is built:** all three proofs are x_m's, and so is the fix's new use. The certificate has no simulated branch: both its halves are proved, and it's public by design (§8).

### Guarded: a repeated start

Found by the attack on the one-key §7.3 proof (2026-11-24, §10), at the side condition that proof had left open. It cost a message's secrecy and integrity, not the key.

A new conversation's ID, its e_A and s_A and its first message's salt are all drawn, and b is derived from drawn bytes. Its t is the clock rounded down to ten minutes, and its stamp is searched from 0. So a start is a function of the key, the handle, the name, t and the draws, and a send a function of the state, the text and the salt. With a random source that repeats (stuck, or a machine's snapshot restored twice), or one an attacker chooses, a second start to the same handle inside the same ten minutes, or a second continuation of one conversation, made the first one's conversation again: the same F, SK and chain keys.
- **What it gave.** The first message of each was sealed under one AES-GCM key and nonce, at both layers, with two different texts. A relay that only watches gets text₁ ⊕ text₂. One that acts can work out both layers' authentication keys and alter a first message so that its reader accepts it. Nothing of the key: every Diffie–Hellman value still went only into HKDF, and no nonce met two challenges (rule 2m).
- **Why it could happen.** The binding's `start` builds a conversation without an inbox, so the crate's own refusal of a held ID (`Inbox::insert`) never ran, and the worker wrote the new conversation in the place of the one it held.
- **The guard** (extension/src/background/messaging.ts: `refuseHeld`, `tombstoned`, `addConversation`). A start, a start again or a continuation whose conversation ID the wallet already holds on that network, as a conversation, as a request the inbox lists or as a tombstone, is refused before anything is written, stamped or sealed. Accepting a request whose ID a tombstone holds is refused the same way. And a new conversation never takes a record's ID that exists.
- **What the guard can't see.** It's as good as what storage remembers. A snapshot of the machine restored twice rolls the records back with the random source, so any send then repeats. So does a wipe followed by the same draws in the same ten minutes: Remove wallet, Start Messages again, or the deletion of a conversation that can't be read. Under those it can still happen. In the one-key proof the side condition S then failed, and the funds stood on the line of its table that needed neither S nor AES-GCM.
- **The remedy, not built yet,** is in the crate: derive a send's salt from the message key, the drawn bytes and the plaintext, so a repeated draw with another text gives another salt. It re-records the vectors, and it belongs with the other change from drawn to derived, the proofs' c₂ and z₂ (above).

**Once chunk 55 is built:** x_m's conversations. No part of the theorem needs S now (§7.4), so it costs a message's secrecy and integrity, and neither key.

## 10. Keeping it true

**The rule** (root CLAUDE.md, "Core protocol invariants"): a new use of x or x_m updates §4's inventory and §5 to §7 first. Nothing may output [x]P or [x_m]P for a point someone else chose, and nothing that holds one key answers the other key's inputs (rule 8).

**The sweep,** to repeat it. Search the code for:
- `sk: Scalar`, `&Scalar`, `key.scalar()` and `SecretKey::from_scalar` in seedelf-crypto, seedelf-core, seedelf-messaging, seedelf-web-wallet/wasm/src and seedelf-cli/src;
- `keys.seedelf`, `laneKey` and `seedelf.` in seedelf-web-wallet/extension/src/background;
- `create_proof`, `prove_schnorr`, `one_time_key`, `convert::`, `G2`, `pairing`;
- once chunk 55 is built, x_m's type and its WebAssembly handle, `hash_to`, and every export that takes x: only the certificate's may be a `messaging*` one.

Each hit is a use in §4's tables, a caller of one, or a new use, which needs this document first.

**What the tests hold today,** on the one-key code. Where a test's key changes once chunk 55 is built, the new key is in brackets.
- **Rule 1, use 2:** schnorr.rs's `a_register_the_key_doesnt_own_gets_no_proof_which_would_reveal_sk_times_g`, and proptest_crypto.rs's `schnorr_proof_refuses_a_register_the_scalar_doesnt_own`.
- **Rule 1, use 4** [x_m, rule 1m]: reveal.rs's `a_reveal_names_a_seedelf_of_the_key_and_the_key_is_the_conversations`.
- **Rule 1, use 10** [x_m]: session/tests/keys_proof.rs's `the_keys_proof_is_made_only_from_a_handle_and_only_for_begins_a`.
- **Rule 1, the points the key meets** [x_m, rule 1m]: session/tests/keys_proof.rs's `e_a_a_and_s_a_on_another_register_are_refused_on_every_path`, `a_stored_request_whose_first_message_fails_never_raises_x_to_another_header_key` (the record refused for its header key alone) and `a_register_of_another_key_under_the_readers_name_binds_no_base`; session/tests/linking.rs's `an_envelope_whose_c_is_on_another_register_is_refused_on_every_path`, `an_envelope_whose_p_is_on_another_register_and_c_is_honest_is_refused`, `no_session_envelope_holds_a_register_of_either_sides_key`; tests/envelope.rs's `no_envelope_holds_a_register_of_its_readers_key`. And, for x (7x), seedelf-crypto's tests/register_test.rs `is_owned_compares_points_not_hex_strings`.
- **Rule 2:**
  - schnorr.rs's `a_stuck_random_source_still_gives_each_statement_and_key_its_own_nonce`;
  - [x_m, rule 2m, for the rest] session/tests/reveal.rs's `a_stuck_random_source_still_gives_each_statement_its_own_nonce` and `the_nonce_is_hmac_sha512_of_the_statement_under_the_key`;
  - the reveal vectors, which hold every byte of each nonce's message and HMAC;
  - session/tests/first_contact.rs's `a_stuck_random_source_still_keeps_b_secret_and_gives_each_proof_its_own_k`, `b_and_k_are_hmac_sha512_of_their_specified_messages` and `the_start_draws_in_the_documented_order`, for b and k;
  - the session vectors, which hold every byte of b's and k's messages and HMACs, and of the keys proof's three, and session/tests/vectors.rs's `the_files_b_and_k_are_the_hmacs_of_their_specified_messages`, which rebuilds them all from the file's other values;
  - for use 10 and the base proof's k, session/tests/keys_proof.rs: `no_subset_of_a_starts_draws_varied_gives_x_e_s_or_b` (each of a start's ten draws varied while the others repeat, then every subset of them, and t: no pair gives the key, e_A, s_A or b, and no nonce repeats), `each_nonce_is_hmac_sha512_of_its_specified_message` (byte for byte), and `the_three_nonce_mutants_each_give_a_secret_away` (an aux each; k₁ over M and aux alone; k_e and k_s without c₂ and z₂: each caught by a single varied draw).
- **Rule 3:**
  - session/tests/ratchet.rs's `the_labels_are_prefix_free_within_each_function`, the keys proof's and the envelope's tag labels included;
  - session/tests/keys_proof.rs's `no_keys_proof_transcript_passes_the_chain_verifier` (seedelf-crypto's `prove` refuses a keys proof's (T₁, z₁) for (p₀, A) and for [d](p₀, A));
  - session/tests/reveal.rs's `the_spending_verifiers_refuse_a_reveals_transcripts_and_its_share_is_none_of_their_challenges` (the spending verifiers refuse a reveal's two transcripts, on (p₀, A) and on the Seedelf's own register, for three reveals, the reader's own two among them).
  - Once chunk 55 is built, the last two run x_m's transcripts on x_m's registers, which hold no funds of the wallet's. They stay, as tests of the spending verifiers' separation, and the certificate's test below takes their place for the funds.
- **§9's guard on a repeated start:** the extension's tests/messaging-start-held.test.ts. A second start, a second continuation, a start under an ID a tombstone holds or a listed request has, a record's ID that's taken, and a request accepted again after its conversation was deleted: each with the first press's draws replayed, and each refused with nothing written. A control with a sound source goes through.
- **Rule 5:** tests/invalid_inputs.rs, and the parsers' refusals throughout.
- **The mutation passes** (2026-11-22): over the reveal's hedge and use 2's guard, 13 mutants, 12 killed; over b and k, 28 mutants, 27 killed. Each survivor keeps a zero nonce instead of drawing aux again, an event of probability 2⁻²⁵⁵ that no test can reach. Since then (2026-11-23), the three nonce mutants were applied to the crate's own prover, each killed, and the gate's spec review ran 30 over call 16's checks (protocol.md §16.6). The one-key version's §10 lists every mutant.
- **The clean-room checks:** protocol.md §19.6 and §16.6, "Checked again": another model's harness, written from the spec and the vector files alone, reproduced the session and reveal files, both F proofs included (2026-11-22 to 2026-11-24). §16.6 says what it didn't reproduce.

**What chunk 55 must add,** in 55b unless said. None of it exists yet:
- **Rule 1, use 11:** a certificate refused for a register x doesn't own, and for an m_S that isn't [x_m]h_S. A g_S or u_S that isn't canonical, in G1 and not O is refused before x meets it, and a test shows the ownership test isn't reached.
- **Rule 1m, uses 4 and 10:**
  - the reveal refused unless A = [x_m]p₀, m_S = [x_m]h_S and the Seedelf's certificate is good, and the keys proof's A check on x_m;
  - a reader checking a reveal's proof, with the m_S it carries, before any read of the chain or the list, then refusing at the press under §21.5's conflict rule.
- **Rule 1m, no API carries a base** (55b and 55d), named `no_messaging_api_takes_a_base`. start, reveal and receive take (network, policy, N, g_S, u_S[, m_S]) and compute h_S in the crate, and the messaging register type has no public constructor but the one through hash_to_G1.
- **Rule 2, use 11:**
  - k_m and k_x byte for byte from their specified messages, in `messaging_certificate_v1.json` and a test that rebuilds them, as vectors.rs does b's and k's;
  - a stuck source giving the same certificate again, and a varied aux giving no key;
  - mutants, each caught: an aux for each half, k_x keyed by x_m or by both keys, k_m without the statement. k_x without T_m is caught by the byte vectors alone: with one maker, T_m is a function of the statement and aux, so no behaviour shows it;
  - a test that shows why there's one maker (rule 2m): a second derivation of k_x, under the same aux, gives x_m.
- **Rule 3, the transcript:** a certificate's (T_x, z_x), and pairs mauled from it to other challenges, refused by seedelf-crypto's `prove`, the chain's verifier, and by Lovejoin's `verify_schnorr`, for (g_S, u_S) and two [d] of it, under several vkhs, as the reveal's test does.
- **Rule 3, the labels:** the prefix test with `…|certificate`, `…|certificate-nonce|x`, `…|certificate-nonce|m` and `…|listing-stamp|`. And a test that every raw SHA-256 input but H_base's and `envelopeHash`'s starts with an ASCII label of at least 21 bytes or is a 40-byte stamp, so none starts with 64 zero bytes.
- **Rule 8:**
  - the funds scan never tests a register against x_m: every `isOwned` caller (55e), and a payment to a register of x_m that the wallet doesn't find;
  - no envelope, F or ratchet-header path reaches x: the `messaging*` exports take x_m, and only the certificate's export takes x (55d);
  - the WebAssembly `MessagingKey` class has no funds method and every `messaging*` export takes only it (55d), named `messaging_key_has_no_funds_methods`;
  - the certificate's maker refuses when [x_m]G = [x]G, named `certificate_maker_refuses_one_key_for_both`;
  - k_x not computable from x_m: the mutant above.
- **x_m's derivation:** its own vectors file beside `seedelf_key_v1.json`, which stays as it is, with the account, network and generation bytes each varied.
- **A clean-room reproduction** of the certificate's file and of the four re-recorded ones from the spec alone, and a mutation pass (the plan's 55b).

**Reviews of the one-key version** (2026-11-22 to 2026-11-24). Section numbers in this record are that version's (c096eab9). What they found is folded in above where it still holds.

A fresh-context Claude review read the first draft and the code (2026-11-22). What it found:
- b's secrecy rested on the random source alone (§9, since fixed);
- receiving needs no static-DH answer, so q_s was only the conversations the user starts;
- the first draft's funds game gave the attacker proofs under any vkh and signatures on any transaction, so its win condition wasn't a funds condition (rule 7, §6);
- w₀ in the associated data is recoverable by the other side (rule 1);
- Part A rests on reductions that don't exist yet (Status);
- the loss terms, rule 3's reasons, and the inventory's gaps.

One claim of the review's was wrong: that seedelf-verification leaves Lovejoin out; it covers Lovejoin v2 (§8).

The 1.10.0 gate review (2026-11-23) changed the protocol before release, and its design reviews read the document against it. What they found:
- the keys proof's first draft gave the key away under a source that repeated every draw but one (§9);
- F's plain base proof made a first message attributable to its writer once a payment tied (p₀, A) to the writer's wallet; the base proof is now designated-verifier;
- a stored request whose first message failed made the reader raise its key to the next message's header key; every message of a request must now share the first's, at parse and in `accept_with`;
- rule 1 as first worded was broken by the scan and by opening, which multiply p and c before they can be checked;
- the theorem needed use 10 in §6, A1, A2, B3 to B5 and §7.3, and B4 a way to find w₀ before the keys proof is decided.

**The written arguments** (2026-11-24). One model wrote out, for the base proof, the keys proof and the reveal, the statement, a simulator, an extractor and what a failing source can do to each nonce, each against the code, and §7.2's reduction step by step. Another model, given that draft, the spec and the code, attacked it. Neither found anything that exposes the key. The draft and the attack's notes are kept with that review's files, not in this repository. What they found:
- the simulated branch's draws rest on the random source alone, which costs deniability under a failing source (§9, open);
- rule 4 counted a reveal's check, which uses no key;
- A2's simulators for uses 4 and 10 drew c₁ where the code takes c₂ and z₂ from the source, use 10's simulated two branches that a failing source lets the attacker check, and A1 was claimed for N_e and N_s whatever the source does;
- §6's game never gave the attacker the random source, and under a predictable one it doesn't cover the CLI;
- q_s counted starts, not handle generators, and the DDH oracle was stated wider than it's used;
- B5 said nothing of a reveal's transcript on the Seedelf's own register, and its loss terms weren't added up, some of them missing or loose;
- §7.3's sentence on the generic group model read as a result. It's a belief.

What held: the three proofs' statements, bytes and nonce derivations; the simulators, as §7.1 states them, and special soundness in every case of the OR-proofs; that no nonce meets two challenges, whatever the draws; and §7.2's simulation of every call that used the key. What stayed open: §7.3's static-DH step and ε_key's term for b; Part A; the oracle model; deniability's condition and its fix; and timing.

**§7.3's proof** (2026-11-24, after the above). One model wrote out the proof of §7.3's step in the algebraic group model, against the code. Another, given the proof, the spec and the code, attacked it: it redid the three classes, the argument on degrees, the test "is W = [x]P?" from two representations, the reading of x off a forged proof, and the count of powers, sorted each handle shape it could think of into a class, and checked class C's claim by brute force over a small field. The algebra held, and so did the loss terms. What the attack found:
- the proof's side condition S failed in the code: the repeated start (§9), guarded since;
- four places where the proof's text said less than its argument, fixed in the proof.

After chunk 55 no part needs that step (§7.4 here), and its proof is kept with that review's files.

**This version: 55a's review** (2026-11-26). A fresh read of protocol.md §21 (Sonnet) came first. It found no way to recover x or x_m, forge a certificate or forge a spend, and confirmed §21.4's nonces: one aux, k_x over the statement, T_m and aux, and k_m over the statement and aux. What it changed is in §21: the maker's point checks before x meets them, the spend's challenge stated exactly, the labels across functions, and conflicts counted by distinct m_S.

Then two independent attacks on §21 and this document (Fable, Opus). Neither found a way to x or x_m, or a forgery. Both found §7.4's claim sound: neither key gives a static-DH answer, and Part C needs none. What they found, folded in here and in §21:
- the headline's "never funds" said too much. A thief of x_m can pose to its owner as anyone, a "Verified" reveal of any certified Seedelf included, which could mislead a payment, and protocol.md §19.5's answer to that no longer holds (§8). What stays exact is that no spend is forged (B);
- "x reads no message" was wrong for later first messages, which go to a thief's certificate once it's the one good one (§2, §8);
- (B′) covered only another m_S, not the wallet's own m_S for a Seedelf never turned on; and (C′) named an event no game can observe, so it's now stated as extraction;
- k_m is hedged only while one (statement, aux) gives one T_x: one maker, one derivation (rule 2m). T_m in k_x's message is x's margin (rule 2), and that mutant only the byte vectors catch (above);
- the certificate's spend bound named c below 2²²⁴, and so did the one-key version's for a reveal's c₁. The operative bound is about 2⁻²²⁴ a try, mauled pair or none, since H_spend is never programmed (B5, rule 3). The test asserting c's shape is dropped;
- rule 3 didn't name the worker's `envelopeHash` or the listing stamp's label, and misstated b₁'s input;
- §21 gained the policy's hash in h_S and the statement, a reveal that carries m_S, and the enforcement points for rules 8 and 1m (§5, and the tests above);
- §8 gained re-certifying as the user's action, the lasting proof a certificate gives for a Seedelf minted at a sum of the wallet's registers, and the relay's view of each post's address.

It's still AI review, not an audit.

A review from the same model family shares this document's framing and blind spots, and a second model's attack is still not a person's. Neither replaces security.md's "Before production" item: an outside cryptographer's review, starting from this document.

## References

- J. P. Degabriele, A. Lehmann, K. G. Paterson, N. P. Smart, M. Strefler. *On the Joint Security of Encryption and Signature in EMV.* CT-RSA 2012; ePrint 2011/615. §3, §4.1, Theorem 1, §4.4, Theorem 2.
- K. G. Paterson, J. C. N. Schuldt, M. Stam, S. Thomson. *On the Joint Security of Encryption and Signature, Revisited.* ASIACRYPT 2011.
- NIST SP 800-56A Rev. 3, §5.6.3.2.
- M. Abdalla, M. Bellare, P. Rogaway. *The Oracle Diffie-Hellman Assumptions and an Analysis of DHIES.* CT-RSA 2001.
- R. Cramer, V. Shoup. *Design and Analysis of Practical Public-Key Encryption Schemes Secure against Adaptive Chosen Ciphertext Attack.* SIAM J. Computing 33, 2003.
- D. Pointcheval, J. Stern. *Security Arguments for Digital Signatures and Blind Signatures.* J. Cryptology 13, 2000.
- M. Bellare, G. Neven. *Multi-Signatures in the Plain Public-Key Model and a General Forking Lemma.* CCS 2006.
- R. Cramer, I. Damgård, B. Schoenmakers. *Proofs of Partial Knowledge and Simplified Design of Witness Hiding Protocols.* CRYPTO 1994.
- D. R. L. Brown, R. P. Gallant. *The Static Diffie-Hellman Problem.* ePrint 2004/306.
- J. H. Cheon. *Security Analysis of the Strong Diffie-Hellman Problem.* EUROCRYPT 2006.
- M. Bellare, H. Davis, F. Günther. *Separate Your Domains: NIST PQC KEMs, Oracle Cloning and Read-Only Indifferentiability.* EUROCRYPT 2020.
- G. Fuchsbauer, E. Kiltz, J. Loss. *The Algebraic Group Model and its Applications.* CRYPTO 2018.
- D. Boneh, B. Lynn, H. Shacham. *Short Signatures from the Weil Pairing.* ASIACRYPT 2001; J. Cryptology 17, 2004.
- U. Maurer, R. Renner, C. Holenstein. *Indifferentiability, Impossibility Results on Reductions, and Applications to the Random Oracle Methodology.* TCC 2004.
- T. Ristenpart, H. Shacham, T. Shrimpton. *Careful with Composition: Limitations of the Indifferentiability Framework.* EUROCRYPT 2011.
- E. Brier, J.-S. Coron, T. Icart, D. Madore, H. Randriam, M. Tibouchi. *Efficient Indifferentiable Hashing into Ordinary Elliptic Curves.* CRYPTO 2010.
- RFC 9380, *Hashing to Elliptic Curves* (2023).
- H. Krawczyk. *Cryptographic Extraction and Key Derivation: The HKDF Scheme.* CRYPTO 2010.
- RFC 6979 (deterministic nonces); BIP-340 (synthetic nonces with auxiliary randomness).
