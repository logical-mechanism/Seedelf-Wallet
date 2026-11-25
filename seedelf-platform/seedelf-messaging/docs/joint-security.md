# One key for spending and messaging: joint security

A Seedelf wallet has one secret scalar, x. It spends every Seedelf and every Lovejoin box the wallet holds, and it is also the wallet's messaging key: "your spending seedelf address is also your name to message, of course rerandomized" (the owner, 2026-11-22). A separate messaging key with its own published register was considered and declined, for one way to handle all the privacy features. The owner keeps one as a fallback, not built (2026-11-24): a key derived for messaging alone, with a Seedelf made for it as the messaging address (the wallet's chunk 54 plan, the owner's calls). It would be a new derivation beside the frozen v1, never a change to it.

This document is the argument that sharing x is safe, and the conditions it rests on:

- §2 says why we depart from NIST's rule against it;
- §4 lists every use of x in the code, crate by crate;
- §5 states the rules every use must keep;
- §6 and §7 give a theorem and its proof, game by game, in the random-oracle model, and §7.3 a tighter form of the funds' half inside the algebraic group model;
- §7.4 says which steps are new and what has been pushed on, §8 what isn't covered, and §9 the gaps found: each that touched the key since fixed; one that costs deniability and not the key, open; and one that cost a message's secrecy under a random source that repeats, guarded since, with what the guard can't see.

**Status.** An argument in the random-oracle model under gap assumptions, in the style of Degabriele, Lehmann, Paterson, Smart and Strefler's Theorem 2. It's written for an outside cryptographer to check, and nobody outside has checked it yet. A fresh-context review found real errors in its first draft, folded in (§10). Its arguments for the three Messaging proofs and §7.2's reduction were then written out by one model and attacked by another, and what they found is folded in too (2026-11-24, §10). The step §7.3 leaned on a sentence for was then proved inside the algebraic group model, the proof written by one model and attacked by another the same day (§7.3, §10). That's AI review by two models, not an audit: no person has checked any of it, and it stays unaudited. It isn't machine-checked, and it doesn't prove anything about the code beyond what §4's inventory and the tests listed in §10 hold the code to.

**What it gives today:**
- **Part B (the funds) stands on its own:** a reduction from forging a spend to the discrete log with a decision oracle and static-DH answers (§6). Its one step beyond gap assumptions, starting a conversation, uses static-DH answers where an attacker sees only blinded ones.
- **Inside the algebraic group model, Part B has a second form, and that step is proved there** (§7.3). For an algebraic attacker, forging a spend or finding x reduces tightly, with no oracle and no fork, to the (q_C + 1)-discrete-log problem, q_C being the distinct class-C generators the user started a conversation to, and to the plain discrete log when there are none. Outside that model the first form is still the argument, and that the blinded answers give nothing more is still a belief there.
- **Part A (messaging) is conditional.** It says sharing x doesn't break any messaging property that has a random-oracle reduction. None of them has one yet: security.md's properties are argued informally, and the Tamarin model is symbolic. Tamarin's Diffie–Hellman theory has no addition of exponents, so a response z = r + c·x can't be in that model at all.
- **Deniability isn't its claim** (§8). What it found about it is §9's open gap: the key is safe whatever the random source does, and deniability needs the source to have been sound.

## 1. Why it needs an argument

Key reuse isn't safe by default. Degabriele, Lehmann, Paterson, Smart and Strefler, *On the Joint Security of Encryption and Signature in EMV* (CT-RSA 2012, ePrint 2011/615), §3, forge a signature on a chosen message from EMV's RSA decryption oracle on the same key. Their §4.4 and Theorem 2 show the opposite for elliptic curves: ECIES-KEM and EC-Schnorr on one key pair are jointly secure in the random-oracle model if gap-DLP and gap-DH are hard. The proof works because each scheme's oracle can be simulated inside the other's reduction, and that needs the two schemes' hash queries to be told apart.

Seedelf asks more of x than one signature scheme and one KEM. It has four Schnorr-type proofs (the spend's, Lovejoin's, the reveal's and the keys proof's), a KEM, a handshake with static Diffie–Hellman, discovery tests, and two key derivations (§4). And x's public side isn't one public key but many registers (g, [x]g) on different bases. The argument below extends Theorem 2 to that, and says where the extension needed something new.

## 2. Departing from NIST SP 800-56A

NIST SP 800-56A Rev. 3, §5.6.3.2, item 5:

> A static key pair may be used in more than one key-establishment scheme. However, one static public/private key pair shall not be used for different purposes (for example, a digital-signature key pair is not to be used for key establishment or vice versa; key-usage restrictions could be enforced by a CA when generating certificates) with the following possible exception for ECC and FIPS 186-type FFC domain parameters: when requesting the (initial) certificate for a public static key-establishment key, the key-establishment private key associated with the public key may be used to sign the certificate request.

Seedelf breaks this rule on purpose: x proves spending (a signature-like use) and establishes keys (ECIES and the handshake).

**Why we depart:**
- **It's a rule of practice, not an attack.** It exists because a combined analysis is usually missing and is easy to get wrong (§1). This document is that analysis.
- **NIST makes one exception itself:** a key-establishment key may sign its own certificate request. That's a single proof of possession, far narrower than Seedelf's reuse, but it shows the rule gives way where a use is understood.
- **The product needs it:** a Seedelf is the handle you message, and the handle's register is the spending register. A separate messaging key would need its own published register, and a second key to look after.

**What we give up:**
- **Key separation as defence in depth.** A flaw in any use is a flaw in the funds key. That's why the bug bounty covers any flaw in messaging that exposes the Seedelf key (SECURITY.md).
- **Read-only delegation.** Whatever reads can spend (security.md, "One key for spending and reading").
- **Compromise of one is compromise of both.**

## 3. Setting

- **The group:** G1 of BLS12-381, written additively, of prime order q (255 bits, log₂ q ≈ 254.86), generator G. [k]P is scalar multiplication.
- **q − 1 = 2³² · 3 · 11 · 19 · 10177 · 125527 · 859267 · 906349² · 2508409 · 2529403 · 52437899 · 254760293²**, checked by multiplication with each factor a probable prime. It matters for §5's rule 1.
- **E(F_p) has small subgroups outside G1:** G1's cofactor is h₁ = 3 · 11² · 10177² · 859267² · 52437899² (≈ 2¹²⁶). So x applied to an unchecked point can leak x modulo these primes (rule 5).
- **x** is uniform in [1, q − 1]: the web wallet's frozen v1 derivation (seedelf-crypto/src/derivation.rs: HKDF-SHA-256 of the BIP39 seed, 64 bytes reduced mod q), or the CLI's random scalar in its wallet file.
- **A register of x** is (g, u) with u = [x]g, both points in G1 and not O.

**Assumptions:**
- **DLP:** given (G, [x]G), find x.
- **gap-DLP:** DLP, with an oracle that decides whether (G, [a]G, [b]G, [ab]G) is a Diffie–Hellman tuple (a DDH oracle).
- **gap-DH:** given (G, [a]G, [b]G), compute [ab]G, with a DDH oracle.
- **What Part B asks of the DDH oracle** is one question only: "is W = [x]P?", for points P and W in G1 and the instance's own x. Every query in §7.2 is (G, X, P, W). That's the oracle of Abdalla, Bellare and Rogaway's strong Diffie–Hellman assumption, weaker than the full one gap-DLP gives. Inside the algebraic group model Part B asks no oracle at all: the two points' representations answer the question (§7.3).
- **Static DH (Brown and Gallant):** DLP stays hard given at most q_s answers [x]P to points P of the solver's choice. §7.2 needs it, and §7.3 says why that's the proof's need, not the attacker's.
- **n-DL:** given (G, [x]G, [x²]G, …, [xⁿ]G), find x. 1-DL is DLP. §7.3's form of Part B needs it in place of static DH, with n = q_C + 1. Its best known attack is the one on static DH with n answers (rule 1's table).
- **XDH** (DDH hard in G1): unlinkability only, which is a separate claim (§8).

**Random oracles.** Every hash below is modelled as a random oracle, and §5's rule 3 says why they can be treated as independent ones. Blake2b with different output lengths is a different function: the digest length is in its parameter block.

**A hash reduced mod q.** The challenges of uses 4 and 10, and the base proof's, are SHA-256's 32 bytes reduced mod q, as use 3's is blake2b-256's. That isn't uniform on [0, q): 2²⁵⁶ = 2q + r with r ≈ 0.21·q, so a value below r has three preimages and the rest two. Every simulator below draws the 32 bytes and reduces them, as the hash does, so no step rests on uniformity. But a guessed challenge is right with probability up to 3/2²⁵⁶, where a uniform one would give 1/q. A nonce, or b, is HMAC-SHA-512's 64 bytes reduced mod q, within 2⁻²⁵⁹ of uniform.

| Name | Function | Input starts with | Used by |
|---|---|---|---|
| H_spend | blake2b-224 | g (a compressed point) | Use 2's challenge |
| H_lj | blake2b-256 | `lovejoin/sigmajoin/v1/` ‖ 0x01 | Use 3's challenge |
| H_rev | SHA-256 | `Seedelf-Messaging\|v1\|session\|reveal` | Use 4's challenge |
| H_kdf | HKDF-SHA-256 | a salt that's a `Seedelf-Messaging\|v1\|…` label or a fresh secret | Uses 5 and 6 |
| N_spend | HMAC-SHA-512, keyed by x | `seedelf/schnorr/nonce/v1` | Use 2's nonce |
| N_rev | HMAC-SHA-512, keyed by x | `Seedelf-Messaging\|v1\|session\|reveal-nonce` | Use 4's nonce |
| N_b | HMAC-SHA-512, keyed by x | `Seedelf-Messaging\|v1\|session\|base-scalar` | Use 6's b, the writer's blinding |
| N_k | HMAC-SHA-512, keyed by b | `Seedelf-Messaging\|v1\|session\|base-nonce` | The base proof's nonce (not a use of x) |
| H_keys | SHA-256 | `Seedelf-Messaging\|v1\|session\|keys\|handle`, or `…\|session\|keys\|continuation` | Use 10's challenge (the continuation form uses no x) |
| N_keys | HMAC-SHA-512, keyed by x | `Seedelf-Messaging\|v1\|session\|keys-nonce\|a` | Use 10's nonce |
| N_e, N_s | HMAC-SHA-512, keyed by e_A and by s_A | `…\|session\|keys-nonce\|e`, `…\|keys-nonce\|s` | The keys proof's other two nonces (not uses of x) |
| H_tag | SHA-256 | `Seedelf-Messaging\|v1\|envelope\|tag` | The scan's tag (use 7): over w when sealing, over [x]p when the wallet scans |
| N_lj | RFC 6979's HMAC-SHA-256 DRBG over x and SHA-256(`lovejoin/sigmajoin/v1/` ‖ …) | | Use 3's nonce |
| H_ot | HKDF-SHA-256, salt `seedelf-one-time-key-v1`, ikm x | | Use 8 |
| H_ed | SHA-512 of x's 32 bytes, inside Ed25519 | | Use 9 (CLI) |

## 4. The inventory: every use of x

Found by reading every crate, the CLI, the WebAssembly bindings and the extension's worker (2026-11-22), and brought up to date for the 1.10.0 gate review's protocol change: use 10, the keys proof, and the envelope's tag in place of w (2026-11-23). §10 says how to repeat the sweep. Line numbers are at this document's commit.

| # | Use | What x computes | What leaves the wallet | Where |
|---|---|---|---|---|
| 1 | Registers | (g, [x]g) on a base the wallet re-randomized with a fresh d, from its root (G, [x]G) | The register, on chain | seedelf-crypto/src/register.rs:58 (`create`), :117 (`rerandomize`) |
| 2 | The spending proof (Schnorr, checked on chain, frozen as variant 1) | T = [r]g; c = blake2b-224(g ‖ T ‖ u ‖ vkh) over the raw bytes; z = r + c·x. r = HMAC-SHA-512(x, `seedelf/schnorr/nonce/v1` ‖ g ‖ u ‖ vkh ‖ 32 random bytes) mod q | (T, z) in the redeemer | seedelf-crypto/src/schnorr.rs:114 (`create_proof`), :72 (the nonce), :172; validator seedelf-contracts lib/schnorr.ak at 5b82530 |
| 3 | Lovejoin's owner proof (Schnorr, to withdraw a box) | t = [r]a; c = blake2b-256(`lovejoin/sigmajoin/v1/` ‖ 0x01 ‖ a ‖ b ‖ t ‖ ctx) mod q; z = r + c·x. r from RFC 6979 over x and SHA-256(tag ‖ a ‖ b ‖ ctx), deterministic | (t, z) in the redeemer | seedelf-crypto/src/lovejoin.rs:199 (`prove_schnorr`), :130 (the nonce) |
| 4 | The verified reveal (CDS OR-proof, protocol.md §19.2) | z₁ = k₁ + c₁·x, c₁ + c₂ = SHA-256(label ‖ cid ‖ p₀ ‖ A ‖ w₀ ‖ len ‖ N ‖ g_S ‖ u_S ‖ T₁ ‖ T₁′ ‖ T₂) mod q. k₁ = HMAC-SHA-512(x, nonce label ‖ 0x01 ‖ statement ‖ c₂ ‖ z₂ ‖ aux) mod q | The reveal, inside the ratchet, to the other side | seedelf-messaging/src/session/reveal.rs:199 (`prove_seedelf`), :170 (the nonce, through session/draw.rs:86, `hedged_scalar`), :304 (`Conversation::reveal`) |
| 5 | Reading (ECIES decapsulation) | [x]c for the envelope's c, then HKDF. A session reader then checks c = [r]p, with r = HKDF(salt, mk, `…\|ratchet\|envelope-ephemeral`) mod q (protocol.md §16.2) | Nothing directly: whether it opened shows in behaviour | seedelf-messaging/src/envelope.rs:140 (`decrypt_message`, [x]c at :145); the check is session/conversation.rs:495 (`check_envelope`) |
| 6 | The handshake's Diffie–Hellman (protocol.md §3, §16.2) | As reader: w₀ = [x]p₀ on a base the base proof or a held conversation binds; then, once the keys proof verifies (it needs no x beyond w₀), [x]E_A, [x]A, and in the first ratchet step [x]S_A, S_A being the header key every message of the request shares. As writer: b = HMAC-SHA-512(x, `…\|session\|base-scalar` ‖ g_S ‖ v_S ‖ F's head ‖ 32 random bytes) mod q (protocol.md §16.2), then A = [x]p₀ on p₀ = [b]g_S, the reader's handle re-randomized by b; and [x]w₀ | A, in F; b never leaves, and the base proof shows it, or the reader's key, under a nonce keyed by b. Every DH value goes only into HKDF. A and w₀ go into every message's associated data, which the other side can solve for from the AES-GCM tags (rule 1) | session/conversation.rs:159 (b, through session/first_contact.rs:494, `base_scalar`), :182 (A), :202 ([x]w₀), :280 (the reader's w₀), :284–286 (its [x]E_A and [x]A, after the keys proof at :281), :289 (x as RatchetInitBob's key); session/ratchet.rs:598 (the first step's [x]S_A) |
| 6′ | Continuations (protocol.md §6) | The new F's A = [x]p₀ on the old conversation's base | A, in F: the writer's old public value | session/conversation.rs:121 (`continue_with`, its [x] at :131), session/inbox.rs:780 (`judge`, its [x] at :787) |
| 7 | Ownership tests | Is [x]g = u? The scan asks whether SHA-256(`…\|envelope\|tag` ‖ [x]p) is the envelope's tag, compared in constant time | Nothing directly: what the wallet spends, scans, refuses or answers | seedelf-crypto/src/register.rs:185 (`is_owned`, which compares points with blst's masked equality); seedelf-core/src/lovejoin/mod.rs:498; seedelf-core/src/utxos.rs:68, :163, :601; seedelf-messaging/src/register.rs:107 (`matches_register`), envelope.rs:158 (`matches_envelope`, the scan), :76 (`Envelope::is_for`), :206 (`tag_matches`); reveal.rs:318–319; conversation.rs:107 (own handle refused), :131 (a continuation's own side); session/inbox.rs:693 (`receive_opened`: a register under a first message's `to` counts for its base proof only if it's the reader's) |
| 8 | One-time signing keys (web wallet) | HKDF-SHA-256(salt `seedelf-one-time-key-v1`, ikm = x, info = a fresh 32-byte seed): an Ed25519 key whose hash is the proof's vkh | Its public key and signatures, in the transaction | seedelf-web-wallet/wasm/src/lib.rs:2077 (`one_time_key`) |
| 9 | The CLI's external address key (CLI only) | Ed25519's key pair of x's 32 bytes as a seed; its public key, as 32 bytes, is in turn the seed of the address's Ed25519 key | That second key's public key and signatures | seedelf-crypto/src/convert.rs:23; seedelf-cli/src/commands/external/sweep.rs:29, :65, external/balance.rs |
| 10 | The keys proof in F (protocol.md §3, §16.2), from a handle only: E_A's and S_A's keys, AND A's key OR the reader's w₀'s (Cramer–Damgård–Schoenmakers) | z₁ = k₁ + c₁·x on p₀ = [b]g_S, for A = [x]p₀, which the prover computes itself. c₁ + c₂ = SHA-256(`…\|keys\|handle` ‖ M ‖ T_e ‖ T_s ‖ T₁ ‖ T₂) mod q, where M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″, T₁ = [k₁]p₀, and T₂ = [z₂]p₀ − [c₂]w₀ from the drawn c₂, z₂. k₁ = HMAC-SHA-512(x, `…\|keys-nonce\|a` ‖ M ‖ T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux) mod q | c₁, c₂, z₁, z₂, with z_e and z_s, in F: to the reader and whoever holds its key | session/first_contact.rs:765 (`KeysStatement::prove_handle`, its nonces through session/draw.rs:118, `hedged_or_draws`), from `Conversation::begin` (session/conversation.rs:147, the call at :193–194) for `Origin::Handle` only |

**Who calls them:**
- **Use 2** (the only caller of z = r + c·x on chain): seedelf-core's `ScriptSpend::proven` (build.rs:1854); the wasm's `prove_with` (lib.rs:2595) for merge, mint, launch, transfer, withdraw and remove; wasm/src/lovejoin.rs:2980 (a session's return); seedelf-core/src/lovejoin/box_value.rs:316 (a measurement with a made-up key); the CLI's `spend::prove_and_submit` (commands/spend.rs:43); and the JS export `SeedelfKey.createProof` (wasm lib.rs:7002), which nothing in the extension calls.
- **Use 3:** seedelf-core/src/lovejoin/mod.rs:1680, after every box is checked as owned (:1504); the wasm's withdraws through `our_box` (wasm/src/lovejoin.rs:2724).
- **Use 4:** the wasm's `messagingReveal`; the worker's "Show my Seedelf".
- **Uses 5 to 7** reach x through `SecretKey::from_scalar` (wasm/src/messaging.rs:281) in every `messaging*` export, and the worker's contract scans and balances through `isOwned`. Some ownership tests run on registers a stranger chose: a site's transaction in the signing view (extension tx-view.ts:329, dapp.ts:2409) and a payee's register (wasm lib.rs:3342). Each is a DDH bit (rule 4).
- **Use 8:** every Seedelf spend's signer: wasm lib.rs:1380, :2658, :2973, :3374, :3891, :3910, :3930, :5804, :5962, wasm lovejoin.rs:2962. `signScriptSpend` (lib.rs:5947) signs only what the worker built (extension script-spend.ts:430, lovejoin.ts:8179). A dApp can't reach it, and no CIP-30 path makes a Seedelf proof (wasm/src/cip30.rs never calls one).
- **Use 10:** the wasm's `messagingStart` (the worker's start and Start again), through `Conversation::start`. `start_continuing` makes the continuation form, which proves e_A and s_A and uses no x.

**What isn't a use of x** (checked, so a reviewer needn't look):
- **Lovejoin's mix proofs** (`prove_sigma_or`) use each mix's fresh witnesses (seedelf-core/src/lovejoin/mod.rs:1035), never x.
- **The base proof in F** (protocol.md §16.2) is designated-verifier: it shows the writer knows b with p₀ = [b]g_S, or knows the reader's key y with v_S = [y]g_S. The writer proves b's branch and simulates the other, with a nonce keyed by b, not x (N_k); the reader checks it from g_S, v_S and p₀ alone. Neither side uses x. But b is derived from x (use 6) and blinds the writer's A = [x][b]g_S, so b's secrecy matters to x: rule 1's A bullet, rule 2's last item, and §9.
- **The keys proof's E_A and S_A branches,** and its continuation form, use e_A and s_A (N_e, N_s), never x.
- **The CLI's one-time keys** are random (commands/spend.rs:26). convert.rs:9–11's comment, that use 9's key is the one-time key a proof binds to, is out of date.
- **The Cardano account** (CIP-1852) is a sibling derivation from the same phrase, not from x.
- **`baseRegister`** in the worker: (G, [x]G) as the account's identifier and, hashed, as a local record's owner (extension wallet.ts:558, contract-scan.ts:245). It's a register (use 1), never written to chain as it is.
- **No G2 point** carries x, and nothing pairs with x anywhere: a [x]h in G2 would hand everyone a DDH oracle and end unlinkability (construction.md §2).
- **Storage and export** (the vault keeps the phrase's entropy, the CLI its encrypted file, and the CLI's `util expose-key` prints x on request) are outside this argument.

## 5. The rules

The theorem's hypotheses, seven of them. Each is a condition on the code, and §10 says which tests hold it.

### Rule 1: nothing outputs [x]P for a point P someone else chose, unless [x]P is already public

A static Diffie–Hellman oracle on x, even a slow one, cuts the cost of finding x. With d answers and d | q − 1, Brown–Gallant and Cheon find x in about √(q/d) + √d operations, against √q ≈ 2^127.4 without them. 2³² divides q − 1, so any number of answers up to 2³² finds a usable d:

| Answers | Cost of finding x |
|---|---|
| none | about 2^127.4 |
| 2²⁰ | about 2^117.4 |
| 2³² | about 2^111.4 |

Where x meets a point the wallet didn't choose, and what leaves:
- **Uses 5 and 6, the DH values** ([x]c, [x]E_A, [x]A, [x]S_A, [x]w₀): only into HKDF. Each point is bound before the wallet acts on what follows:
  - E_A, S_A, and from a handle A, by the keys proof (use 10's check), S_A being the header key every message of a request shares;
  - A in a continuation, by equality with a held value;
  - p₀, by the base proof against a register of the reader's own key, or a held base. The base proof's other branch is its register's key, so a register of another key under the handle's name (one the Seedelf held before it came to this wallet) would let that key's holder prove any p₀: the reader passes over any register under the name that isn't its key's (session/inbox.rs:693, an ownership test of use 7);
  - c by c = [r]p and p by p = [o]p₀, both checked once the message decrypts.

  A request replayed from storage (`Request::read`, `Inbox::accept`, a join) isn't checked again for its window, stamp or base proof: it rests on the record's sealing, since only the wallet writes that record, after those checks passed. The keys proof is checked again on every replay, and the rule that every message carries the first's header key both when the record is read and on every replay.

  [x]p (the scan) and [x]c (opening) are computed before those checks can run: [x]p goes only into the scan's tag, a SHA-256 compared in constant time, and [x]c only into HKDF, and nothing is shown or answered before every check has passed (rule 4).
- **Use 6, the reader's w₀ = [x]p₀, in the associated data.** It's unhashed there in effect: whoever holds a message's key gets one GF(2¹²⁸)-linear equation in w₀'s three GCM blocks from each AES-GCM tag, so the other side recovers w₀ from three replies. That's safe because that side already knew w₀. A first message from a handle proves, for a register (g_S, v_S) of the reader's key, that the writer knows b with p₀ = [b]g_S, or the reader's key, so knows w₀ (= [b]v_S); and a continuation is read only when verified, on a base and values both sides had. Third parties hold no message keys.
- **Use 6, the writer's A = [x]p₀:** p₀ = [b]g_S with b the writer's secret and g_S the reader's. So (p₀, A) is a uniformly random register of x, which anyone can make by re-randomizing a public one: a *blinded* answer. It stays blinded only while b is secret and uniform: anyone who learns b gets [x]g_S = [b⁻¹]A on a g_S of their own choosing. b is N_b's output, keyed by x, so it's secret and uniform whatever the random source does (rule 2's last item).
- **Use 6′, a continuation's A = [x]p₀** on a base the other side chose: published only for a verified continuation (§6), where that side already knew it. It made p₀ = [b]g_S and proved it knows b (or the reader's key), so it knows [x]p₀ = [b]v_S; or its AES-GCM tag held w₀ = [x]p₀ in the associated data. protocol.md §3, "w₀ in it is load-bearing", is why both stay.
- **Uses 2, 3, 4 and 10, the proofs,** only for a true statement whose public value is already public. For a register (g, u) with u ≠ [x]g, the challenge is computable from public values, so z = r + c·x gives [x]g = ([z]g − T)/c. So:
  - use 2's `create_proof` refuses a register x doesn't own (schnorr.rs:128, added with this document; every caller already checked, but at about 12 call sites);
  - use 3's `prove_schnorr` computes u itself, and every withdraw checks each box is owned first (lovejoin/mod.rs:1504);
  - use 4 refuses unless A = [x]p₀ and the Seedelf's register is x's (reveal.rs:318–319);
  - use 10's prover checks the A it's given: it computes [x]p₀ on F's base and refuses any other A (session/first_contact.rs:806–811), and `begin` makes the base itself; F carries A anyway (use 6). The OR's other branch is the reader's own w₀, so the proof convinces only the reader, given a sound random source when it's made (§9).
- **Use 1:** registers on bases the wallet itself randomized.

### Rule 2: no nonce, and no b, rests on the random source alone

Uses 2, 3, 4 and 10 all compute z = r + c·x. One r under two different challenges, in the same use or in any two of them, gives x = (z − z′)/(c − c′), whatever the bases. So:
- **Use 2:** r = HMAC-SHA-512(x, `seedelf/schnorr/nonce/v1` ‖ g ‖ u ‖ vkh ‖ aux), and the challenge covers g, T, u and vkh, with T = [r]g.
- **Use 3:** r = RFC 6979(x, SHA-256(tag ‖ a ‖ b ‖ ctx)), and the challenge covers a, b, t and ctx, with t = [r]a. Deterministic: proving the same box under the same ctx twice gives the same proof.
- **Use 4:** k₁ = HMAC-SHA-512(x, `…|reveal-nonce` ‖ 0x01 ‖ cid ‖ p₀ ‖ A ‖ w₀ ‖ len ‖ N ‖ g_S ‖ u_S ‖ c₂ ‖ z₂ ‖ aux). The challenge also covers T₂ = [z₂]p₀ − [c₂]w₀, which is why c₂ and z₂ are in the message. Until this document's change k₁ came from the random source alone (the gap in §7.1).
- **Use 10:** k₁ = HMAC-SHA-512(x, `…|keys-nonce|a` ‖ M ‖ T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux), with M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″.
  - k_e and k_s are HMAC-SHA-512, keyed by e_A and by s_A, over their labels ‖ M ‖ c₂ ‖ z₂ ‖ aux. One aux serves all three, drawn after c₂ and z₂, which come after the base proof's draws.
  - The challenge covers M, T_e, T_s, T₁ = [k₁]p₀ and T₂ = [z₂]p₀ − [c₂]w₀, and (M, c₂, z₂, aux) fixes each of them, M fixing the three keys. So one input gives one proof, and anything else three new nonces.
  - A zero nonce draws c₂, z₂ and aux again and derives all three again: one helper draws and derives them together (session/draw.rs, `hedged_or_draws`), never `hedged_scalar` once for each, which redraws only its own aux.
  - Its first design drew an aux for each nonce and left T_e and T_s out of k₁: a source that repeated every draw but aux_e put one k₁ under two challenges, and x = (z₁ − z₁′)/(c₁ − c₁′) from two F (§9).
- **The writer's b and the base proof's k** (protocol.md §16.2, §16.3). Neither is x, but b blinds A, and a b given away unblinds A into [x]g_S, a static-DH answer on a generator the attacker chose (rule 1). So:
  - b = HMAC-SHA-512(x, `…|session|base-scalar` ‖ g_S ‖ v_S ‖ F's head ‖ aux_b) mod q, F's head being F's bytes before p₀ (cid, t, `to`, `replaces`). Keyed by x, b is secret even when the source is predictable, and it's new for each handle, name, time and cid.
  - k = HMAC-SHA-512(b, `…|session|base-nonce` ‖ g_S ‖ v_S ‖ p₀ ‖ F′ ‖ c₂ ‖ z₂ ‖ aux_k) mod q, with c₂ and z₂ the simulated branch's (the reader's key's), and the base challenge covers g_S, v_S, p₀, T₁, T₂ and F′, with T₁ = [k]g_S and T₂ = [z₂]g_S − [c₂]v_S. So one k never meets two challenges, which would give b = (z₁ − z₁′)/(c₁ − c₁′). A zero k draws c₂, z₂ and aux_k again, through the same helper.
  - k is keyed by b, the witness it hides, as RFC 6979 keys a nonce by the signing key: the proof then depends on b alone, and x meets one HMAC here (N_b), not two.
  - Until this change both came from the source alone, in the order b, cid, e_A, s_A, k. A stuck source gave k = b, and z = b(1 + c) gave b away from one F (§9).
- **Across uses:** N_spend, N_rev, N_b and N_keys are one function, HMAC-SHA-512 keyed by x, on messages whose first bytes differ (`seedelf/…` against `Seedelf-…|reveal-nonce`, `…|base-scalar` and `…|keys-nonce|a`). N_k, N_e and N_s are HMAC-SHA-512 keyed by b, e_A and s_A, under labels of their own. N_lj is HMAC-SHA-256. So the nonces and b are independent functions of their inputs, and no two uses share one except by a collision.

So a random source that fails or repeats costs x nothing: the same statement gives the same proof again, two different statements get independent nonces, and b stays secret.

- **No other drawn value meets x:** e_A, s_A, the ratchet keys, the ratchet salt and Lovejoin's witnesses never combine with it. The reveal's and the keys proof's simulated c₂ and z₂ reach z₁ only through c₁ = c − c₂, and their nonces cover them; the base proof's reach only b's response, and its nonce covers them. The envelope's r is HKDF of the message key and the salt, no longer a draw. A failing source costs secrecy and unlinkability there, and, through the proofs' drawn c₂ and z₂, deniability (§9).

### Rule 3: no two uses hash the same input under one function

- **H_spend** is blake2b-224, with no domain tag, frozen on chain. Cardano uses blake2b-224 too: key hashes of 32-byte keys, and script and policy hashes, which are long but start with a language tag byte (0x00 to 0x03). A spend's challenge input is 172 bytes from the wallet (three points, then a 28-byte vkh) and starts with a compressed point's flag byte, 0x80 to 0xBF. The first byte and the length separate them.
- **H_lj and Cardano's own blake2b-256** (transaction and datum hashes): Lovejoin's challenges start with `lovejoin/sigmajoin/v1/`, which no CBOR transaction body or datum does.
- **SHA-256:**
  - raw SHA-256 runs over labelled inputs (`Seedelf-Messaging|v1|session|{reveal,base,stamp,keys|handle,keys|continuation}`, the envelope's `Seedelf-Messaging|v1|envelope|tag`, the relay's `Seedelf-Messaging|v1|stamp|`, Lovejoin's `lovejoin/sigmajoin/v1/` for N_lj's message, and the worker's `seedelf.contract.owner.`, which comes before the base register's two points in hex, a dot between them, and names a local record's owner (extension contract-scan.ts, `ownerOf`; it holds no secret, §4), none a prefix of another, and over the two stamps' unlabelled `digest ‖ nonce`, which are 40 bytes, shorter than any labelled input;
  - HMAC-SHA-256 and HKDF-SHA-256 are keyed by labels that differ from each other (`Seedelf-Messaging|v1|…|salt`, `seedelf-one-time-key-v1`, `seedelf-wallet-v1`), or by fresh secrets (rk, the ratchet's salt, chain keys). Under one key (the ratchet salt and mk) HKDF-SHA-256 takes three infos, `…|ratchet|{message,outer,envelope-ephemeral}`, none a prefix of another;
  - x itself enters SHA-256 as H_ot's ikm, under the key `seedelf-one-time-key-v1`, and in N_lj's DRBG. That DRBG's first HMAC is keyed by 32 zero bytes, with x in the message after RFC 6979's 32 bytes of 0x01 and a 0x00: separated by that prefix, since nothing else in Seedelf uses a zero HMAC key.
- **SHA-512:** HMAC-SHA-512 keyed by x (N_spend, N_rev, N_b, N_keys), by b (N_k), or by e_A and s_A (N_e, N_s), whose inner hash is at least 128 bytes, with labels none of which is a prefix of another (`…|session|base` is a prefix of `…|base-scalar` and `…|base-nonce`, but it is raw SHA-256's: another function); Ed25519's expansion of a 32-byte seed (use 9 and the one-time keys); BIP39's PBKDF2 over the phrase. They differ in key or in length.

Treating these as independent random oracles is the standard step of "oracle cloning" by domain separation (Bellare, Davis and Günther, *Separate Your Domains*, EUROCRYPT 2020). A reviewer should check this table against the code more than anything else in this section.

### Rule 4: decision bits are only DDH answers

The wallet's behaviour shows some bits that depend on x: whether an envelope is its own (the scan and what it fetches), whether a first message is accepted (and answered), and whether a register is its own (what it spends, what it refuses). Each is a function of whether some (P, [x]P) relation holds, or of an AEAD check under a key that HKDF derived from [x]P. So the most any of them gives an attacker is a DDH oracle on x, and of that only the question "is W = [x]P?" (§3). That's why the theorem needs gap-DLP and gap-DH, not DLP and CDH, exactly as Theorem 2 does.

- **The scan** compares the envelope's tag with H_tag([x]p). Its bit is still at most a DDH answer: in the random-oracle model, a tag the scan accepts is H_tag(W) for a W the attacker hashed, and the answer says whether W = [x]p.
- **Since the keys proof,** accepting a first message is no longer a DDH answer on a point the writer chose: every point the reader multiplies is bound first (rule 1). What is left: the scan's tag of [x]p, the outer layer's opening before c is checked, and the ownership tests.
- **Whether a reveal verifies isn't one of these bits.** Checking a reveal uses no key: `Conversation::verify_reveal` (session/reveal.rs:340) reads the w₀ the reader stored when it took the first message, and the binding's `check_reveal` (wasm/src/messaging.rs:769) takes none.

### Rule 5: every point is checked before x touches it

Canonical encoding, in G1, not O: register.rs's `is_valid` (and blst's `from_compressed`), and the messaging crate's `decode_point` at every parse (security.md, "Order of checks"). Without it, x applied to a point of small order outside G1 leaks x modulo h₁'s small primes (§3), as ElfTalk's unchecked decompression did.

### Rule 6: x never meets G2

There's no pairing anywhere x is used. A public [x]h in G2 would decide DDH for x in G1 for everyone: unlinkability would be gone, though not x.

### Rule 7: a spend's proofs are bound to a one-time key of the wallet's own, which signs that transaction alone

A spending proof is bound to a vkh, and the validator checks that vkh among the transaction's signers. So a proof under a key someone else holds spends the register, and so does a one-time key's signature on a transaction the wallet didn't build. x is safe either way; the funds aren't. So:
- **Proofs only under the hash of a fresh one-time key the wallet just made.** Every caller of use 2 passes `key_hash(one_time_key(x, seed))` for a fresh seed (§4, use 8), or the CLI's fresh random key. The JS export `createProof` takes any vkh, and nothing calls it.
- **That key signs only the transaction its proofs are in.** `sign_with_collateral_key` (wasm lib.rs:5954) signs any transaction that lists the key and carries giveme.my's signature. The worker passes it only the transaction it built, with that transaction's own seed (script-spend.ts:430, lovejoin.ts:8179).

Both are conditions on the worker and the CLI, which hold x and so are trusted with it. Nothing below makes them true.

## 6. The theorem

**The game.** The attacker gets the wallet's published registers, and oracles that do what the wallet does with x:
- **Spend** any set of its registers in a transaction whose other parts (outputs, other inputs) the attacker chooses. The wallet makes a fresh one-time key, proves each register under its hash, and signs that transaction alone (rule 7).
- **Lovejoin's owner proof** on any of its boxes, under any ctx.
- **Reveal**, in any conversation the wallet started and that has been answered, of any of its Seedelfs.
- **Open** any envelope and say what it holds, **scan** any bytes, **start** a conversation to any handle, **receive** any first or later message and answer it, **continue** any conversation.
- **Every random oracle**, and the network and relay: it can drop, reorder, replay and forge.
- **In Part B, the wallet's random source too.** The attacker may choose every value the wallet draws: that's what "a source that fails" means below. A seed it repeats gives one one-time key to two spends, and each of that key's signatures is still on a transaction the wallet built, which is all B5 uses. Part A is for a sound source: secrecy doesn't survive a failing one (§8).

**The wallet in this game is the web wallet.** Its one-time keys come from x (use 8), so choosing its draws gives the attacker none of them. The CLI draws each one-time key from the random source alone (seedelf-cli/src/commands/spend.rs:26). Whoever predicts that source holds the key a CLI proof is bound to, and can sign another transaction that carries the proof. So under a predictable source Part B doesn't cover a CLI spend. Seedelf Messaging doesn't run in the CLI.

**Theorem (informal).** In the random-oracle model, with §3's hashes as independent random oracles, and the code keeping rules 1 to 7:

**(A) Messaging keeps its claims, where it has them.** Let P be a property of uses 5 to 7 (security.md's properties, or the handshake's secrecy and authentication), argued in the random-oracle model by a reduction R_P to an assumption Z_P. Then P still holds, with Z_P, against an attacker that also has the oracles of uses 1 to 4, 8 and 10. The loss is at most

    q_pf · (q_H + q_pf) / q + ε_key

where q_pf is the number of proofs made, keys proofs included, q_H the attacker's hash queries, and ε_key the chance the attacker queries a keyed oracle under its key: N_spend, N_rev, N_b, N_keys, N_lj or H_ot under x itself, which R_P can use as x, or N_e, N_s or N_k under e_A, s_A or b, at most the advantage of finding the discrete log of E_A or S_A on p₀, or of p₀ on g_S. The terms for e_A and s_A need a sound source: a stuck one prints both in F (§8). The term for b is the discrete log of p₀ on a g_S the attacker chose, which this document doesn't reduce to the ordinary one (§7.3). No such R_P exists yet (Status).

**(B) Spending proofs stay unforgeable.** Say an attacker gets, with probability ε, a transaction accepted that spends a register of x the wallet didn't sign for. Then either:
- it forged an Ed25519 signature under one of the wallet's one-time keys, which are independent of x (A3), or found another key with the same blake2b-224 hash; or
- it made a fresh spending proof, under a vkh of its own.

From the second, an algorithm of about twice the attacker's running time finds x with probability about ε′²/q_H − ε′/2²²⁴, where ε′ = ε − δ and δ is the simulation's loss plus the first case's chance, added up in B5. It needs a DDH oracle, asked only "is W = [x]P?" (§3), and q_s static Diffie–Hellman answers, q_s being the number of distinct handle generators the wallet started a conversation to: a second start to one generator reuses the first's answer (§7.3). Use 10 adds none. The same holds for Lovejoin's owner proof (1/q in place of 1/2²²⁴).

**(B), inside the algebraic group model.** Against an algebraic attacker (§7.3), the second case needs no oracle and no fork. An algorithm that runs the attacker once finds x from (G, [x]G, …, [x^(q_C+1)]G) with probability at least ε − δ − (q_H + 1)/2²²⁴, δ being B5's loss. q_C is the number of distinct class-C generators the wallet started a conversation to (§7.3). It's at most q_s, and it's 0 unless the user writes to a handle built on its own public points whose public value is no plain multiple of its generator. With q_C = 0 the problem is the plain discrete log. Both statements of (B) are true, in different models: this one says more, and asks more of the attacker.

**Corollary.** No efficient attacker forges a spending proof for x, and so none finds x, since x makes one. Under gap-DLP with a static-DH oracle, the best known attack is §5's table at q_s answers. For an algebraic attacker it's the same table at q_C + 1 powers, and the plain discrete log's cost at q_C = 0.

**The CLI's external address** (use 9) is spent by Ed25519 alone, under a key that's a hash of x and so independent of x's other uses in the random-oracle model (A3). (B) says nothing more about it.

## 7. The proof

### 7.1 Part A: proofs inside messaging's reductions

This is Theorem 2's first half (DLPSS §4.4, "Security of the KEM component"), done once for each proof system and for the two derived keys.

- **Game A0:** P's game, with every oracle of §6.
- **Game A1: nonces drawn.** Replace N_spend, N_rev, N_lj, N_b, N_keys, N_e, N_s and N_k with fresh uniform values for each distinct input, the same value for a repeated one.
  - A0 and A1 differ only if the attacker queries one of those functions with its key: x, or e_A, s_A or b. In the random-oracle model nothing else in its view depends on how they're computed, which is ε_key: for x, and for e_A, s_A and b at most the advantage of finding the discrete log of E_A or S_A on p₀, or of p₀ on g_S. For e_A and s_A that needs a sound source: they're draws, and a stuck source prints them in F as c₂ and z₂ (§8). The attacker then computes N_e and N_s itself, and this step isn't valid for them. Part B never takes it for them: B holds e_A, s_A and b, and computes N_e, N_s and N_k as the wallet does (§7.2).
  - **This step is where the old reveal failed.** With k₁ drawn from the random source alone, a source that repeats gives one k₁ to two challenges, and A1's "fresh value per input" isn't what the wallet did: the real wallet then leaks x. Rule 2 makes the nonce a function of everything the challenge covers, so A1 holds whatever the source does. The old drawn b failed the same way: a b that a stuck source gave away wasn't a fresh value either.
  - N_keys's input holds everything H_keys's does but T₁, which follows from it, so A1 holds for it whatever the source does. N_e's and N_s's inputs fix their challenge too (M fixes the three keys, so T_e, T_s and T₁ follow), and N_k's holds everything the base challenge does but T₁ and T₂, which follow from it. So none of them meets two challenges, whatever the source does: that's rule 2. It isn't secrecy: A1 holds for N_e and N_s only while e_A and s_A are secret (above).
- **Game A2: proofs simulated.** Answer each proof query without x, by the honest-verifier zero-knowledge simulator, and program the proof's random oracle:
  - **Use 2:** draw c uniform in [0, 2²²⁴) and z uniform mod q; set T = [z]g − [c]u; program H_spend(g ‖ T ‖ u ‖ vkh) := c.
  - **Use 3:** likewise, with H_lj's 256-bit output chosen uniformly and c its value mod q.
  - **Use 4:** take c₂, z₂ and aux from the random source, as the prover does (session/reveal.rs:176–178). Draw H_rev's 32-byte output h, and set c = h mod q and c₁ = c − c₂. Draw z₁ uniform mod q, and compute T₁ = [z₁]p₀ − [c₁]A, T₁′ = [z₁]g_S − [c₁]u_S and T₂ = [z₂]p₀ − [c₂]w₀ as the reader does; if T₁ is O, draw z₁ again. Program H_rev at the statement and those commitments as h. A repeated (statement, c₂, z₂, aux) gets the answer it got.
  - **Use 10, by a simulator that holds e_A and s_A** (Part B's, which has them): take c₂, z₂ and aux from the random source, as the prover does (session/draw.rs:123–125). Make k_e and k_s by their real HMACs, and T_e = [k_e]p₀ and T_s = [k_s]p₀. Draw H_keys's 32-byte output h, and set c = h mod q and c₁ = c − c₂. Draw z₁ uniform mod q, and set T₁ = [z₁]p₀ − [c₁]A, drawing z₁ again if it's O, and T₂ = [z₂]p₀ − [c₂]w₀. Program H_keys(label ‖ M ‖ T_e ‖ T_s ‖ T₁ ‖ T₂) := h, and answer z_e = k_e + c·e_A and z_s = k_s + c·s_A. Only A's branch is simulated. It needs A (rule 1) and w₀. A repeated (M, c₂, z₂, aux) gets the answer it got.
  - **Use 10, by one that doesn't** (a reduction of Part A that plants its instance in E_A or S_A): the same, but it draws z_e and z_s uniform too, and sets T_e = [z_e]p₀ − [c]E_A and T_s = [z_s]p₀ − [c]S_A.
  - **Why it's the same:** in A1 each proof is a Schnorr (or CDS) transcript with a uniform nonce. The simulator's response stands for the nonce z − c·x (z₁ − c₁·x in uses 4 and 10), uniform as the real one is, and the rest is the same function of it and of the hash's answer.
  - **What each is exact under.** Use 4's simulator, and use 10's first: once N_rev and N_keys are A1's fresh values, the answer is distributed exactly as the wallet's proof, whatever the random source does, since both take c₂, z₂ and aux from it. They part only when the real nonce is 0 and the prover draws again (about 1/q), when a simulated nonce's 64 bytes reduced mod q miss uniform (2⁻²⁵⁹), or when the programming fails (below). Uses 2 and 3: the same, up to the zero values a draw excludes (about 1/q each). Use 10's second: only while N_e and N_s are fresh values to the attacker too, so only with a sound source. An attacker that chooses the draws holds e_A, s_A and aux, checks z_e − c·e_A against k_e's HMAC, and tells this simulator from the wallet; a stuck source prints e_A and s_A in F by itself (§8). Part B uses the first.
  - **Where it fails:** only if the point being programmed was already queried. T is uniform in G, so that's at most (q_H + q_pf)/q for each proof, in all four uses. (2⁻²²⁴, the spend's challenge space, matters only to the fork in B5.)
  - **It needs u to be public,** which rule 1 makes sure of: no proof is made for a register that isn't x's.
  - **Rule 3 makes the programming invisible to the other uses:** H_spend, H_lj, H_rev and H_keys each take inputs no other use hashes, so another computation queries one only to verify such a proof, where a programmed answer is what the real proof's would be (receiving a first message verifies keys proofs, under the reader's own w₀); and no proof queries H_kdf.
- **Game A3: derived keys drawn.** Replace H_ot(x, ·) and H_ed(x) with fresh keys, which differ only on a query under x (ε_key again). The one-time and external keys' Ed25519 signatures are then made with keys independent of x.

In A3, x appears only in uses 1 and 5 to 7, which is P's own game. So R_P applies as it stands. ∎(A)

### 7.2 Part B: messaging inside the forking reduction

The reduction B gets a DLP instance X = [x]G, a DDH oracle, of which it asks only "is W = [x]P?" (§3), and a static-DH oracle (P ↦ [x]P, at most q_s calls). It runs the attacker and simulates every oracle of §6 without x, taking each value the wallet would draw from the attacker (§6). It also makes the wallet's one-time keys itself, so it can sign as rule 7 says: one key for each seed, and the same key for a seed the attacker repeats.

- **Game B1: registers.** Each register the wallet publishes is ([d]G, [d]X) for a fresh d that B keeps, as re-randomization makes them. The root is (G, X).
- **Game B2: the nonces and keys derived from x drawn,** as A1 and A3: N_spend, N_rev, N_lj, N_b and N_keys, H_ot and H_ed. N_e, N_s and N_k stay as they are: B holds e_A and s_A, which the attacker chose, and b, which is N_b's answer. If the attacker ever queries a keyed oracle under some x′ with [x′]G = X, B outputs x′. For the four keyed by x itself (HMAC-SHA-512), B tests a query's key in the form HMAC gives it, padded with zero bytes to the hash's block: its first 32 bytes are the candidate x′, so x's 32 bytes with zero bytes after them are caught as x's alone are.
- **Game B3: proofs simulated,** as A2, keys proofs included, use 10's by the simulator that holds e_A and s_A: B knows each statement's u (rule 1).
- **Game B4: messaging simulated:**
  - **The scan and ownership tests** (use 7): is (G, X, g, u) a DH tuple? The DDH oracle answers. The scan has no u to test, only the envelope's tag: an envelope (p, tag) is the wallet's exactly when H_tag's table holds a query W answered with that tag and (G, X, p, W) is a DH tuple, which the DDH oracle decides. With no such query the wallet would have accepted with probability about 2⁻²⁵⁶, which B counts as a refusal.
  - **Opening an envelope** (use 5): as in ECIES's gap-DH proof (Abdalla–Bellare–Rogaway; Cramer–Shoup). B keeps H_kdf's table. For an envelope with c and header H, if the attacker already queried H_kdf at (salt, Z, info ‖ H) with (G, X, c, Z) a DH tuple, that answer is the key. Otherwise B draws one, and gives it to any later query whose Z the DDH oracle accepts.
  - **Receiving a first message** (use 6, as reader):
    - **The keys proof,** checked before SK, needs w₀ = [x]p₀. B finds it in H_keys's table: a proof that verifies was made with a query whose M holds the true w₀, which B recognises with the DDH oracle on (G, X, p₀, W). With no such query B refuses, and the wallet would have accepted with probability at most 3/2²⁵⁶ (§3). (Or B checks the proof last, with the w₀ that H_tag's table gives, below: every refusal is silent, so the order is B's.) In a continuation the reader's value is one of the two held values, which B has.
    - SK = H_kdf([x]E_A ‖ [x]A, info ‖ F) and the first step's KDF_RK(SK, [x]S_A) are handled the same way, with two and one DDH checks. If the attacker never queried the right inputs, B draws the keys, as it does an envelope's, keeps them for a later query the oracle accepts, and opens with them as the wallet would. So no AES-GCM forgery term is lost here.
    - The associated data needs w₀ = [x]p₀ itself. The envelope gives only the tag of the register's public value, but the scan's simulation gives the W behind it: H_tag's query W with (G, X, p, W) a DH tuple, so W = [x]p. The wallet reads a message only if p = [o]p₀ and c = [r]p for the message's outer scalar o and envelope scalar r (conversation.rs:495). Both come from the message key, which B now has, and the salt. So B checks p = [o]p₀ and c = [r]p itself and sets w₀ = [o⁻¹]W, which is [x]p₀ whenever the wallet would read the message. No static-DH answer is needed.
    - **One condition:** the wallet checks the keys proof before SK, and the message's AES-GCM tag before the envelope (conversation.rs:281 before :287, and the ratchet's decryption at :444 before the envelope's check at :456). Where B can't tell which refusal the wallet would give, the refusals must look the same to the attacker, and they do: the keys proof, the AES-GCM tag and the envelope's checks refuse alike, and protocol.md §2 drops each without a word.
  - **Starting a conversation** (use 6, as writer) to a handle (g_S, v_S):
    - B draws b as N_b's answer (B2), sets p₀ = [b]g_S, and gets [x]g_S from the static-DH oracle, so A = [b][x]g_S is the real value. One more answer for q_s, unless B has [x]g_S from an earlier start to the same generator: it keeps each answer.
    - B knows b, so it makes the base proof as the wallet does, k from N_k under b, simulating the reader's-key branch as the wallet does.
    - B makes the keys proof by programming H_keys (A2), with the A it already has and w₀ = [b]v_S. No new answer.
    - [x]w₀ only enters H_kdf, which B handles with the DDH oracle on (G, X, w₀, ·). It looks in H_kdf's table before it draws SK: an attacker that chooses the draws can make a start repeat, F and all, and may have asked for that SK already.
  - **Continuing** (use 6′): the A it publishes is [x]p₀ for an old p₀, which B already has from that conversation's start or first message.
  - **Revealing** (use 4): simulated as in B3, since A and the Seedelf's register are known to B.
- **Game B5: forking.** The attacker's transaction spends a register (g*, u*) of x that the wallet didn't sign for, with a proof (T*, z*) under some vkh*.
  - **If vkh* is the hash of one of the wallet's one-time keys,** the transaction carries a signature the wallet didn't make (rule 7), under that key or under another key with the same blake2b-224 hash: an Ed25519 forgery under a key independent of x (A3), or a second preimage, at most n_v·q_H/2²²⁴ for the wallet's n_v one-time keys. B gives up; that's the first case of (B).
  - **Otherwise the query wasn't programmed:** B3 programs H_spend only at points (g ‖ T ‖ u ‖ vkh) whose vkh is a wallet key.
  - **The fork:** by the general forking lemma (Pointcheval–Stern; Bellare–Neven), B reruns the attacker with the same coins and a fresh answer at the H_spend query for (g* ‖ T* ‖ u* ‖ vkh*). It gets (z*, c*) and (z**, c**) with c* ≠ c** with probability about ε²/q_H − ε/2²²⁴.
  - **The answer:** since u* = [x]g*, [z* − z**]g* = [c* − c**]u*, so x = (z* − z**)/(c* − c**). B doesn't need log_G g*.
  - **Both runs replay the same oracle answers before the fork.** The DDH and static-DH oracles are deterministic, so the simulation is consistent across the fork. q_s at most doubles.
  - **Neither a keys proof nor a reveal is a spending proof.** B3 programs H_keys and H_rev, never H_spend, so the fork is untouched. Each still holds Schnorr transcripts under x: a keys proof's (T₁, c₁, z₁) on (p₀, A), and a reveal's two, (T₁, c₁, z₁) on (p₀, A) and (T₁′, c₁, z₁) on (g_S, u_S), the Seedelf's own register as it stands on chain, with no re-randomization to find. One passes the deployed verifier, for its register (g, u) or for [d](g, u), only if blake2b-224(g ‖ T ‖ u ‖ vkh) is c₁ as an integer, for a vkh the attacker can sign under: for a reveal on the Seedelf's register, blake2b-224(g_S ‖ T₁′ ‖ u_S ‖ vkh) = c₁. That needs c₁ below 2²²⁴, which has probability at most 3·2²²⁴/2²⁵⁶ ≈ 2^−30.4 a proof (about 2^−30.9 with a sound source), and which no one steers: c₁ = c − c₂, and c is a hash over T₁ = [k₁]p₀, whose k₁ is keyed by x over c₂. Then each pair tried, a multiple d of the register and a vkh, is one chance in 2²²⁴: the tries are counted in pairs, not in key hashes alone, though a d only helps where a UTxO sits at [d](g, u). Two tests run such transcripts through seedelf-crypto's `prove`, the chain's verifier, and Lovejoin's `verify_schnorr`, and each is refused: `no_keys_proof_transcript_passes_the_chain_verifier` (session/tests/keys_proof.rs) for a keys proof's, and `the_spending_verifiers_refuse_a_reveals_transcripts_and_its_share_is_none_of_their_challenges` (session/tests/reveal.rs) for a reveal's two, of three reveals, the reader's own two among them: on each register and two [d] of it, under three vkhs. It also shows the share's shape for those reveals, 2²²⁴ or more as an integer, where the chain's challenge is below it; it shows nothing of the reveal's own challenge.
  - **The loss:** ε′ = ε − δ, where δ is at most the sum of: the first case's chance, an Ed25519 forgery's and n_v·q_H/2²²⁴; a programming collision, q_pf·(q_H + q_pf)/q; a real nonce of 0 drawn again, q_pf/q; a simulated nonce's 64 bytes reduced mod q, q_pf·2⁻²⁵⁹; and, for each envelope the attacker delivers, a tag met by chance, 2⁻²⁵⁶, and a keys proof's challenge guessed, 3/2²⁵⁶. q_pf counts every proof made, of all four uses. ε_key isn't in it: B turns such a query into x.

The same fork works for Lovejoin's owner proof, at H_lj. And a reveal or a keys proof that convinces the wallet as reader forks, by the CDS proof's special soundness, to the writer's key or to x. Two accepting proofs on the same commitments with different challenges differ in c₁ or in c₂. If in c₁, (z₁ − z₁′)/(c₁ − c₁′) is the writer's key: for a reveal that one scalar is the key of both A and the Seedelf's register, and with different keys there the commitments fix c₁, so the fork lands on c₂. If in c₂, (z₂ − z₂′)/(c₂ − c₂′) is the key of w₀ on p₀, the reader's own x. The base proof forks the same way, to b or to the key of the reader's register. The forged proof's hash point is never one B programmed: a keys proof B made is for an F that names someone else's handle, and a reveal B made is for another statement. ∎(B)

### 7.3 Where Part B needs the static-DH oracle, and why that's the proof's need

One step of B4 needs [x]P for a point P the attacker chose: **starting** a conversation to its handle needs [x]g_S.
- **Why B can't avoid it.** It must output A = [x]p₀ and, in the first envelope, a header and keys built on [o]w₀ = [o][x_B]p₀. With p₀ = [b]g_S, it knows w₀ = [b]v_S but not A. With p₀ = [β]G it knows A = [β]X but not w₀, which needs the attacker's key x_B on B's point. One of the two cross values is always missing, and simulating the base proof or the keys proof doesn't supply it. Without w₀, B could still answer every hashed use of it late (the keys proof's challenge, the envelope's tag, each HKDF input), though only with a decision oracle on four free points, which is more than "is W = [x]P?". The use it can't answer late is the unhashed one: w₀ is in the clear in every message's associated data (protocol.md §16.1). B would have to put an AES-GCM tag over bytes it doesn't have, and then check the other side's tags over them.
- **Why the design has it.** It puts R_A on R_B's base on purpose: the static DH between them is in the session secret (protocol.md §2, the second review).
- **Receiving doesn't need it.** The keys proof's own hash query gives w₀, through the DDH oracle, and H_tag's table gives it again (B4).

**What the attacker actually gets is less:**
- Starting gives it (p₀, A) blinded by b: a random register of x, which it could make itself. b ↦ [b]g_S is one-to-one onto G1 without O, so (p₀, A) is uniform over x's registers whatever g_S is.
- **In the plain random-oracle model, that this costs nothing while b stays secret is a belief, not a proof.** The blinded answers are random multiples with fresh unknown factors, and Cheon's attack needs [x^d]G on one base, which no chain of blinded answers gives. But a start shows more than (p₀, A): the base proof, the keys proof, and what is sealed under w₀ = [b]v_S. An attacker that holds the handle's key y can make all of that itself, from a public register of x re-randomized and w₀ = [y]p₀. One that doesn't can't open the envelope. A reduction there is handed neither y nor w₀ (above), so that's a reason, not a proof.
- **What was tried** (2026-11-24): three attempts to break it, by two models, over handles of many shapes. A key y that's unknown and tied to x; a known y on a base tied to x; chains through an earlier A; blinded answers paired with the scan's timing; continuations and reveals used as oracles; a register copied from another wallet's; a pairing; the curve's endomorphism. None found an attack on x: in each case the attacker either holds y, and can produce everything a start shows by itself, or can't open the envelope, and sees uniform points and hash outputs.
- b stays secret even with a failing random source, since it's keyed by x (rule 2's last item). When b was drawn alone, a failing source made each start a real static-DH answer (§9).

**Inside the algebraic group model, the step is proved** (2026-11-24). The proof was written by one model and attacked by another, which redid its algebra and found it to hold. No person has checked it. It's kept with that review's files, not in this repository: what follows is its result, its model and its limits.

- **The model.** The algebraic group model (Fuchsbauer, Kiltz and Loss) with random oracles. With every point the attacker hands the wallet, or puts in a random-oracle query, it gives how that point was made from the points the wallet has put out: a representation. That representations come with random-oracle queries, when they're made, is that model's usual convention (Fuchsbauer, Plouviez and Seurin, EUROCRYPT 2020), not an assumption beyond it. The proof uses it twice. Two representations answer "is W = [x]P?", so no oracle is asked. And a forged proof's commitment, represented before its challenge exists, gives x, so nothing is forked. The attacker may choose the wallet's random source, as in §6.
- **Three classes of handle,** by the representation of (g_S, v_S):
  - **Readable:** v_S is a constant multiple y of g_S, whatever g_S is built on, an earlier A included. The reduction sets p₀ = [β]G for a fresh β, so A = [β]X and w₀ = [y·β]G: the wallet's own values for the b that β stands for, and x never above the first power. A chain of starts through earlier answers is cut by each fresh β. In this game, with one wallet and the attacker as everyone else, every honestly made handle is here.
  - **Known generator:** g_S doesn't depend on x. The reduction keeps b and knows log_G g_S, so A = [b·log_G g_S]X and w₀ = [b]v_S. Exact too.
  - **Class C, the rest:** g_S depends on x and v_S is no constant multiple of it: (X, G), say, or an earlier A with a public value unrelated to it. With p₀ = [β]G, every point that gates the conversation's keys, w₀ itself among them, is a quotient of two polynomials in x that is no polynomial, and no algebraic attacker writes one without handing over x. So what the wallet sent there is opaque to it, and the reduction sends an encryption of zeros. Or the reduction keeps b and takes A from one more power of x, with nothing opaque.
- **w₀ in the associated data,** the obstruction above, is met in each class: y gives it, b gives it, or no one can reach a key it's bound into.
- **What is proved,** for an attacker that wins §6's funds game with probability ε. Both problems are met tightly, ε and not ε²/q_H, and δ is B5's loss:

  | What the user started | The funds reduce to | It needs |
  |---|---|---|
  | No class-C conversation | DLP: ε ≤ Adv + δ + (q_H + 1)/2²²⁴ | Nothing of AES-GCM, and any random source |
  | Class-C conversations too | DLP, with q_e·ε_ind + q_d·ε_int added to that bound | AES-256-GCM secure under a key never revealed, and S, below |
  | Class-C conversations, to q_C distinct generators | (q_C + 1)-DL: ε ≤ Adv + δ + (q_H + 1)/2²²⁴ | Nothing of AES-GCM, no S, and any random source |

  q_e is the envelopes the wallet seals in class-C conversations, q_d the envelopes delivered to it, and ε_ind and ε_int AES-256-GCM's advantages for one chosen plaintext and for a forgery.
- **S: no AES-GCM key and nonce of a class-C conversation seals two different plaintexts.** With a sound random source it holds. Under one that repeats, or one the attacker chooses, it didn't until 2026-11-24 (§9). It now holds as long as the wallet's storage still holds what it wrote, since the wallet refuses a new conversation under an ID it holds. With storage rolled back or wiped along with the source it can fail, and then the table's last line is what stands.
- **What it doesn't cover:**
  - anything outside the algebraic group model. In the plain random-oracle model §7.2 as it stands, with its static-DH answers, its decision oracle and its fork, is still the argument;
  - a handle made of points with no algebraic representation: bytes decompressed into a point, or a register copied from someone else's on chain. With a y the attacker gives, the readable class's argument still goes through. Without one no attack is known, and the claim that nothing is gained is a knowledge assumption, which this model can't state;
  - many wallets at once, and anything of Part A.

**One other route,** not taken here:
- **A different design:** A on a base of the writer's own. It would cost the static DH between R_A and R_B, and it's a format change. Not proposed.

**The bound, honestly.** In the plain random-oracle model, under the static-DH assumption, Part B loses at most §5's table, at q_s answers. q_s counts only the distinct handle generators the user starts a conversation to, since a second start to one generator needs no new answer. So the attacker can't drive it past what the user does, and use 10 adds none. The oracle the proof uses does answer chains of points, an earlier A among them, so the assumption at q_s answers is as weak as the table says, though the wallet hands out no such answer. For an algebraic attacker the same figures stand at q_C + 1 powers in place of q_s answers, and only on the last line of the table above: about 2^117.4 at 2²⁰ class-C generators and 2^111.4 at 2³², and the plain discrete log's 2^127.4 wherever the first two lines apply. 2²⁰ is far beyond any wallet's life, and even 2³² leaves about 2^111.

### 7.4 What's routine and what's new

**Routine:**
- Part A's simulation of each proof (DLPSS §4.4; the Schnorr and CDS simulators).
- ECIES's gap-DH simulation, and the forking lemma.

**New, and where a reviewer should push.** Each was pushed on 2026-11-24, by the model that wrote the arguments out and the one that attacked them (§10). What that left is said with each:
1. **Many bases.** x's public side is a set of registers, not one key. B handles it by re-randomizing X (B1), and extraction needs no log_G g* (B5). We believe this is sound. It's the step to check that the attacker can't gain from registers it re-randomized itself.
   - **Pushed:** each proof is simulated from its own public value alone (A2). Each challenge covers its base and public value, so a transcript moved to [d](g, u) answers another hash input. And a combination of transcripts across bases must meet one hash, not a sum of several the attacker arranges. Nothing found.
2. **Four proof systems on one key:** the spend's, Lovejoin's, the reveal's and the keys proof's. That's rule 2, and the hedging, as the hypothesis that keeps A1 true when the random source fails. Before this document the reveal didn't meet it, and the keys proof's first design didn't either (§9).
   - **Pushed:** with every draw the attacker's to choose, each proof is still a function of its nonce's key and message, and no nonce meets two challenges. What it found is beside the key: the simulated branch's draws (§9).
3. **The handshake's identity on the reader's base** (§7.3): the only place the proof needs more than gap assumptions, and only for conversations the user starts. It's the weakest step, and it rests on b staying secret, which rule 2 keeps whatever the random source does.
   - **Pushed:** attempts to break it found nothing on x. Inside the algebraic group model it's now proved, and Part B with it, to the (q_C + 1)-discrete-log problem and, without class-C conversations, to the plain discrete log (§7.3). The attack on that proof found the repeated start (§9). In the plain random-oracle model the step is still a belief.
4. **The funds game** (§6, rule 7): a spend is safe only if its proofs are bound to a fresh key of the wallet's that signs nothing else. That's a rule about the worker, not about x.
   - **Pushed:** under a predictable source it doesn't cover the CLI (§6), and a reveal's transcript on the Seedelf's own register has a bound and, since, a test (B5).
5. **Decision bits beyond decryption:** the scan, acceptance, what the wallet spends. Rule 4 claims each is a DDH answer. That claim is checked against the code in §4, not proved.
   - **Pushed,** in the crate and its bindings: each bit is computable from "is W = [x]P?" and the attacker's own hash queries (B4), and a reveal's check isn't one of them (rule 4). Left: timing. A relay that times a wallet's reads against envelopes it sealed itself gets that answer a page at a time. It's an oracle for linking, not on x, and it's declared (§8), not measured.
6. **Domain separation** (rule 3), across functions that Cardano and Lovejoin also use.
   - **Pushed** for Messaging's own labels: where each pair first differs, in raw SHA-256 and under HMAC-SHA-512 keyed by x. Not checked again: SHA-512's other uses (Ed25519, BIP39), and HKDF taken as one oracle though it's HMAC twice. Routine, and still to do.

**Where the next reviewer should push instead:**
- **§7.3's proof,** which now exists and has been attacked once:
  - how far its convention on random-oracle queries reaches: it's the model's usual one, and it's where the oracle and the fork went;
  - handles made of points with no algebraic representation, which it doesn't cover;
  - the game with many wallets, where an honest third party's handle is one the reduction makes;
  - class C's three game steps, whose probabilities are stated and not carried through;
  - ε_key's term for b (§6), which the same model should give and nobody has written.
- **The send's salt,** drawn alone (§9): its derivation, before it's built.
- **Part A:** write one reduction R_P, for any Messaging property, so Part A says something.
- **The simulated draws' fix** (§9), before it's built: it's a new use of x.
- **The oracle model:** rule 3 across SHA-512's every use, and HKDF as it's built.
- **And it should be a person.** Everything above is two models' work (Status).

## 8. What this doesn't cover

- **Side channels.** Timing, caches, and the WebAssembly engine, which promises nothing about timing (security.md, "Before production"). Whether the module's time depends on x was measured on 2026-11-24, with nothing found above the measurement's floor: security.md, *Assumptions*, says what was measured and what wasn't. The scan has no early return: it answers one digit an envelope, at the same cost whether the envelope is ours (the wasm's `scan`; `tag_matches` compares in constant time). What the wallet does next with one that is ours, opening it and taking it in, takes time a watcher can measure: a timing signal of the kind rule 4 counts.
- **The random source, beyond the hedging.** Rule 2 keeps the four proofs' nonces, the writer's b and the base proof's k safe from a failing source. Secrecy and unlinkability don't survive one: e_A, s_A, the ratchet keys and the ratchet salt are drawn alone, and so are the base proof's, the reveal's and the keys proof's simulated c₂ and z₂, which a source that repeats them would repeat in two readers' proofs. A source stuck on one value also writes e_A and s_A into F, as the base and keys proofs' simulated c₂ and z₂: x and b still never appear and no nonce repeats, but the first messages' secrecy then rests on the static DH alone, so a later theft of the writer's key reads them too once aux_b, the same stuck value, is guessed. Deniability doesn't survive one either (§9). And a source that repeats can make two sends share an AES-GCM key and nonce where the wallet's storage no longer holds the first (§9, the repeated start).
- **Deniability** is not this document's claim. Use 10 and the base proof are both designated-verifier, so with a sound random source neither adds evidence a third party could check. With a source that had failed when a proof was made, the proof's printed c₂ and z₂ can show anyone which branch was simulated, and the proof is then evidence (§9; protocol.md §7 says what a reader can then show).
- **Unlinkability** (XDH): another model's job, the outer envelope's and then unlinkability's.
- **The handshake's own security.** Part A carries over whatever it has. Its symbolic proofs are the Tamarin model ([model/](../model/)), and there's no computational proof of it here.
- **The contracts' correctness:** seedelf-verification, for Seedelf's three scripts and Lovejoin v2's (mix_logic's Owner withdrawal included, in every transaction). Part B takes the validators as they're stated there: Seedelf's frozen variant 1 hashes raw bytes with blake2b-224, takes z of any length below q, and needs the vkh in the extra signatories; Lovejoin's owner proof is bound to its ctx, a blake2b-256 hash of the outputs, the input references and the mix box's script hash (`owner_context`, seedelf-core/src/lovejoin/mod.rs:1307).
- **Many wallets at once.** The reductions are for one key. Against many wallets they lose a factor of up to the number of keys, as any discrete-log scheme's do.
- **Storage and export of x:** the vault, the CLI's wallet file, `util expose-key`. Nor what a lock leaves in memory. On a lock the web wallet frees its key objects, and each overwrites x where it lies before releasing it (the wasm's `Wiped`, since 2026-11-24: before, the freed cell still held the key). A copy a call left on the WebAssembly stack isn't reached by that: the worker scrubs the stack's top 512 KiB after a lock's frees, and after each derivation of keys, before a later call can copy stale stack bytes into the heap (`scrubStack`). A copy a later call built into the heap is reached by neither, and the review found bytes of the Seedelf key there after a lock: so a lock ends by replacing the module's instance and zeroing the old one's whole memory (`renewWasm`). What can still hold a copy is outside the module: JavaScript's own strings and the browser's memory. So wiping is best effort (the wallet's docs/keys-and-accounts.md, "Lock and wipe").
- **The CLI's external key (use 9),** beyond its being a hash of x. Its seed is the Ed25519 public key of x's bytes, so anything that ever published that public key would give the address away. Nothing does: a rule to keep, not a flaw.
- **Quantum attackers:** x falls to Shor, as every Cardano key does.

## 9. Gaps found

### Fixed: the writer's b and the base proof's k

Found by the fresh-context review (§10), and fixed in the change after the reveal's. Both came from the random source alone, in the order b, cid, e_A, s_A, k:
- a stuck source gave k = b, and then z = b(1 + c) gave b away from one F;
- one b and one k under two F′ gave b = (z − z′)/(c − c′);
- a predictable source gave b outright.

b unblinds A into [x]g_S, a static-DH answer on a generator the attacker chose. So with a failing source, each conversation the user started to an attacker's handle handed one out. Not x, and only as many answers as conversations the user started, but exactly what rule 1 forbids.

**The fix,** the reveal's hedge (rule 2's last item):
- protocol.md §16.2: b = HMAC-SHA-512 keyed by x over the handle, F's head and 32 drawn bytes, and k = HMAC-SHA-512 keyed by b over the handle, p₀, F′ and 32 drawn bytes. §3 and §16.3 follow: cid is drawn first, since b covers it.
- Two choices made in building it: b's message holds F's head in F's own encoding, so cid and `replaces` too; and k is keyed by b, not x, the witness it hides, so x meets one new HMAC, not two.
- The session vectors were re-recorded with b's and k's messages and HMACs, and the reveal vectors too, since their conversations start from a handle: a deliberate format change. The relay's and v1's vectors are byte for byte as they were, and the reveal's 31 checks give the results they gave.
- Later, in the 1.10.0 gate review, the base proof became designated-verifier (protocol.md §16.2): b's branch or the reader's key's, so the reader can make one itself. k's message gained the simulated branch's c₂ and z₂, for the reason the reveal's holds them, and a zero k draws all three again.

### Fixed before it was built: the keys proof's nonce

The 1.10.0 gate review added use 10, the keys proof, to bind E_A, S_A and A before the reader multiplies them by x. Both design reviews of its first draft found the same gap:
- k₁'s message left out T_e and T_s, and each of the three nonces drew its own aux;
- so a source that repeated every draw but aux_e gave one k₁ under two challenges, and x = (z₁ − z₁′)/(c₁ − c₁′) from two F.

**The fix** is rule 2's use 10: one draw of c₂, z₂ and aux for all three nonces, each nonce's message holding everything its challenge covers, and one helper that draws and derives them together, all again on a zero. A third review varied every subset of a start's eight draws then (cid, aux_b, e_A, s_A, aux_k, aux, c₂, z₂), and t, and no pair gave x, e_A, s_A or b. The tests now vary each of a start's ten draws (the base proof's c₂ and z₂ came with its designated-verifier form) and every subset of them, and the three mutants each give a secret away under a single varied draw (§10).

### Fixed: the reveal's nonce

**The reveal's k₁** came from the operating system's generator alone. Two reveals sharing a k₁ under different challenges give x away, and x spends. The spending proof's nonce was hedged for exactly this reason (chunk 51, t1a#6), and the reveal didn't follow it. Fixed with this document:
- protocol.md §19.2: k₁ is HMAC-SHA-512 keyed by x over the statement, the simulated branch's c₂ and z₂, and 32 drawn bytes;
- the reader's own reveal derives k₂ the same way;
- the reveal's vectors were re-recorded, a deliberate format change. The proofs changed and nothing else did: the conversations, and every check's result, are as they were.

The handoff that found it proposed HMAC over the statement and aux alone. That isn't enough: the challenge also covers T₂, built from the drawn c₂ and z₂, so a source that repeats aux but not them would put one k₁ under two challenges. They're in the message for that reason.

### Fixed: use 2's guard

It came out of the same sweep. `create_proof` made a proof for any register it was given, so the rule that no proof is made for a register x doesn't own rested on every caller. They all keep it today, but there are about 12 of them, and a JS export (`createProof`) took any register. It now refuses one, at the cost of one scalar multiplication per input.

### Open: the simulated branch's draws

Found when the written arguments were attacked (2026-11-24, §10). It costs deniability, which isn't this document's claim (§8), and not the key.

In the base proof, the keys proof and the reveal, the writer simulates the reader's branch with a challenge share c₂ and a response z₂. It draws both from the random source alone (session/draw.rs:123–124, `hedged_or_draws`; session/reveal.rs:176–177, `hedged_nonce`) and prints both in the proof. Rule 2 covers them only as far as x needs: each nonce's message holds them, so no nonce meets two challenges.
- **x and b are safe whatever those draws are:** §7.1's simulators take them from the source as the prover does.
- **Deniability needs them to have come from a sound source.**
  - A source stuck on one value prints c₂ = z₂ in both of F's proofs and in a reveal, with E_A = S_A = [c₂]p₀. One that repeats prints one c₂ in two proofs. One that a third party could predict prints the c₂ it predicted.
  - A proof the designated reader makes with its own key shows such a relation only with probability about 1/q a try: there c₂ = c − c₁ is fixed by the hash, after the commitments.
  - So anyone can then tell that the reader's branch was the simulated one, and the proof is a plain one: the keys proof of the writer's key on p₀, a reveal of the Seedelf's key, bound to cid, p₀, A and w₀, and the base proof of b. protocol.md §7 says what a reader can then show others.
- **Beside it, with the writer's key.** b, k and each k₁ are HMACs under x, or under b, over 32 drawn bytes. Whoever later holds x and can guess those bytes can check them against a proof, and no proof of the reader's would pass. A sound source leaves the bytes unguessable. No derivation takes this away: it comes with deriving anything from the key.
- **The fix, not built yet:** derive c₂ and z₂ as the nonces are, by an HMAC under the prover's key over the statement and the 32 drawn bytes. A stuck or repeating source then prints values that look drawn. It changes only what a writer does: the reader's check and every format stay, and the session and reveal vectors are re-recorded. It would publish values derived from x, so it's a new use of x: §4's inventory and §5 to §7 take it in before it's built (§10's rule).

### Guarded: a repeated start

Found by the attack on §7.3's proof (2026-11-24, §10), at the side condition that proof had left open. It cost a message's secrecy and integrity, not the key.

A new conversation's ID, its e_A and s_A and its first message's salt are all drawn, and b is derived from drawn bytes. Its t is the clock rounded down to ten minutes, and its stamp is searched from 0. So a start is a function of the key, the handle, the name, t and the draws, and a send a function of the state, the text and the salt. With a random source that repeats (stuck, or a machine's snapshot restored twice), or one an attacker chooses, a second start to the same handle inside the same ten minutes, or a second continuation of one conversation, made the first one's conversation again: the same F, SK and chain keys.
- **What it gave.** The first message of each was sealed under one AES-GCM key and nonce, at both layers, with two different texts. A relay that only watches gets text₁ ⊕ text₂. One that acts can work out both layers' authentication keys and alter a first message so that its reader accepts it. Nothing of x: every Diffie–Hellman value still went only into HKDF, and no nonce met two challenges (rule 2).
- **Why it could happen.** The binding's `start` builds a conversation without an inbox, so the crate's own refusal of a held ID (`Inbox::insert`) never ran, and the worker wrote the new conversation in the place of the one it held.
- **The guard** (extension/src/background/messaging.ts: `refuseHeld`, `tombstoned`, `addConversation`). A start, a start again or a continuation whose conversation ID the wallet already holds on that network, as a conversation, as a request the inbox lists or as a tombstone, is refused before anything is written, stamped or sealed. Accepting a request whose ID a tombstone holds is refused the same way. And a new conversation never takes a record's ID that exists.
- **What the guard can't see.** It's as good as what storage remembers. A snapshot of the machine restored twice rolls the records back with the random source, so any send then repeats. So does a wipe followed by the same draws in the same ten minutes: Remove wallet, Start Messages again, or the deletion of a conversation that can't be read. Under those, §7.3's side condition S can still fail, and what stands for the funds is the line of its table that needs neither S nor AES-GCM.
- **The remedy, not built yet,** is in the crate: derive a send's salt from the message key, the drawn bytes and the plaintext, so a repeated draw with another text gives another salt. It re-records the vectors, and it belongs with the other change from drawn to derived, the proofs' c₂ and z₂ (above).

## 10. Keeping it true

**The rule** (root CLAUDE.md, "Core protocol invariants"): a new use of x updates §4's inventory and §5 to §7 first, and nothing may output [x]P for a point someone else chose.

**The sweep,** to repeat it. Search the code for:
- `sk: Scalar`, `&Scalar`, `key.scalar()` and `SecretKey::from_scalar` in seedelf-crypto, seedelf-core, seedelf-messaging, seedelf-web-wallet/wasm/src and seedelf-cli/src;
- `keys.seedelf` and `seedelf.` in seedelf-web-wallet/extension/src/background;
- `create_proof`, `prove_schnorr`, `one_time_key`, `convert::`, `G2`, `pairing`.

Each hit is a use in §4's table, a caller of one, or a new use, which needs this document first.

**What the tests hold:**
- **Rule 1, use 2:** schnorr.rs's `a_register_the_key_doesnt_own_gets_no_proof_which_would_reveal_sk_times_g`, and proptest_crypto.rs's `schnorr_proof_refuses_a_register_the_scalar_doesnt_own`.
- **Rule 1, use 4:** reveal.rs's `a_reveal_names_a_seedelf_of_the_key_and_the_key_is_the_conversations`.
- **Rule 1, use 10:** session/tests/keys_proof.rs's `the_keys_proof_is_made_only_from_a_handle_and_only_for_begins_a`.
- **Rule 1, the points x meets:** session/tests/keys_proof.rs's `e_a_a_and_s_a_on_another_register_are_refused_on_every_path`, `a_stored_request_whose_first_message_fails_never_raises_x_to_another_header_key` (the record refused for its header key alone) and `a_register_of_another_key_under_the_readers_name_binds_no_base`; session/tests/linking.rs's `an_envelope_whose_c_is_on_another_register_is_refused_on_every_path`, `an_envelope_whose_p_is_on_another_register_and_c_is_honest_is_refused`, `no_session_envelope_holds_a_register_of_either_sides_key`; tests/envelope.rs's `no_envelope_holds_a_register_of_its_readers_key`; and seedelf-crypto's tests/register_test.rs `is_owned_compares_points_not_hex_strings`.
- **Rule 2:**
  - schnorr.rs's `a_stuck_random_source_still_gives_each_statement_and_key_its_own_nonce`;
  - session/tests/reveal.rs's `a_stuck_random_source_still_gives_each_statement_its_own_nonce` and `the_nonce_is_hmac_sha512_of_the_statement_under_the_key`;
  - the reveal vectors, which hold every byte of each nonce's message and HMAC;
  - session/tests/first_contact.rs's `a_stuck_random_source_still_keeps_b_secret_and_gives_each_proof_its_own_k`, `b_and_k_are_hmac_sha512_of_their_specified_messages` and `the_start_draws_in_the_documented_order`, for b and k;
  - the session vectors, which hold every byte of b's and k's messages and HMACs, and of the keys proof's three, and session/tests/vectors.rs's `the_files_b_and_k_are_the_hmacs_of_their_specified_messages`, which rebuilds them all from the file's other values;
  - for use 10 and the base proof's k, session/tests/keys_proof.rs: `no_subset_of_a_starts_draws_varied_gives_x_e_s_or_b` (each of a start's ten draws varied while the others repeat, then every subset of them, and t: no pair gives x, e_A, s_A or b, and no nonce repeats), `each_nonce_is_hmac_sha512_of_its_specified_message` (byte for byte), and `the_three_nonce_mutants_each_give_a_secret_away` (an aux each; k₁ over M and aux alone; k_e and k_s without c₂ and z₂: each caught by a single varied draw).
- **Rule 3:** session/tests/ratchet.rs's `the_labels_are_prefix_free_within_each_function`, the keys proof's and the envelope's tag labels included; and session/tests/keys_proof.rs's `no_keys_proof_transcript_passes_the_chain_verifier` (seedelf-crypto's `prove` refuses a keys proof's (T₁, z₁) for (p₀, A) and for [d](p₀, A)), and session/tests/reveal.rs's `the_spending_verifiers_refuse_a_reveals_transcripts_and_its_share_is_none_of_their_challenges` (the spending verifiers refuse a reveal's two transcripts, on (p₀, A) and on the Seedelf's own register, for three reveals, the reader's own two among them; B5).
- **§9's guard on a repeated start:** the extension's tests/messaging-start-held.test.ts. A second start, a second continuation, a start under an ID a tombstone holds or a listed request has, a record's ID that's taken, and a request accepted again after its conversation was deleted: each with the first press's draws replayed, and each refused with nothing written. A control with a sound source goes through.
- **Rule 5:** tests/invalid_inputs.rs, and the parsers' refusals throughout.
- **A mutation pass** over the new rules (2026-11-22): 13 mutants, 12 killed. Each part of the nonce's message removed (the label, the branch, the statement, c, z, aux), the key replaced, half the HMAC reduced, the old drawn nonce, the writer's branch byte made the reader's, aux drawn first, and create_proof's guard removed: each made a test fail. The survivor keeps a zero nonce instead of drawing aux again, an event of probability 2⁻²⁵⁵ that no test can reach.
- **A second, over b and k** (2026-11-22): 28 mutants, 27 killed. Each label changed or removed; each part of b's message removed (the handle, F's head, aux) or reordered, and each field of the head (cid, t, `to`, `replaces`); each part of k's message removed (the handle, p₀, F′, aux); b not keyed by x, k not keyed by b; the old drawn b, the old drawn k, and k = b; the draw order changed three ways (b's aux before cid, k's aux before e_A, the old order); and the shared hedge's key zeroed or little-endian, or half its HMAC reduced. The survivor is the same 2⁻²⁵⁵ zero kept.
- **A clean-room check** of the new §19.2: protocol.md §19.6, "Checked again". And of §16.2's b and k: protocol.md §16.6, "Checked again" (2026-11-22). The keys proof and the designated-verifier base proof have had theirs since: another model's harness, written from protocol.md, construction.md and the vector files alone, reproduced the session and reveal files, both proofs included (2026-11-23), and again as the files are now (2026-11-24). protocol.md §16.6, "Checked again, after call 16", says what it didn't reproduce. Their mutation passes so far (2026-11-23): the three nonce mutants applied to the crate's own prover, each killed, and the gate's spec review's 30 over call 16's checks, both verifiers included (protocol.md §16.6).

**Review.** A fresh-context Claude review read the first draft and the code (2026-11-22). What it found, now folded in:
- b's secrecy rested on the random source alone (§9, since fixed);
- receiving needs no static-DH answer (§7.2), so q_s is only the conversations the user starts;
- the first draft's funds game gave the attacker proofs under any vkh and signatures on any transaction, so its win condition wasn't a funds condition (rule 7, §6);
- w₀ in the associated data is recoverable by the other side (rule 1);
- Part A rests on reductions that don't exist yet (Status);
- the loss terms, rule 3's reasons, and the inventory's gaps.

One claim of the review's was wrong: that seedelf-verification leaves Lovejoin out; it covers Lovejoin v2 (§8).

The 1.10.0 gate review (2026-11-23) changed the protocol before release, and its design reviews read this document against it. What they found, now folded in:
- the keys proof's first draft gave x away under a source that repeated every draw but one (§9);
- F's plain base proof made a first message attributable to its writer once a payment tied (p₀, A) to the writer's wallet; the base proof is now designated-verifier;
- a stored request whose first message failed made the reader raise x to the next message's header key; every message of a request must now share the first's, at parse and in `accept_with`;
- rule 1 as first worded was broken by the scan and by opening, which multiply p and c before they can be checked;
- the theorem needed use 10 in §6, A1, A2, B3 to B5 and §7.3, and B4 a way to find w₀ before the keys proof is decided.

**The written arguments** (2026-11-24). One model wrote out, for the base proof, the keys proof and the reveal, the statement, a simulator, an extractor and what a failing source can do to each nonce, each against the code, and §7.2's reduction step by step. Another model, given that draft, the spec and the code, attacked it. Neither found anything that exposes x. The draft and the attack's notes are kept with that review's files, not in this repository. What they found, now folded in:
- the simulated branch's draws rest on the random source alone, which costs deniability under a failing source (§9, open);
- rule 4 counted a reveal's check, which uses no key;
- A2's simulators for uses 4 and 10 drew c₁ where the code takes c₂ and z₂ from the source, use 10's simulated two branches that a failing source lets the attacker check, and A1 was claimed for N_e and N_s whatever the source does (§7.1);
- §6's game never gave the attacker the random source, and under a predictable one it doesn't cover the CLI;
- q_s counted starts, not handle generators, and the DDH oracle was stated wider than it's used (§3, §6);
- B5 said nothing of a reveal's transcript on the Seedelf's own register, and its loss terms weren't added up, some of them missing or loose (§7.2);
- §7.3's sentence on the generic group model read as a result. It's a belief.

What held:
- the three proofs' statements, bytes and nonce derivations, as §4 and protocol.md give them;
- the simulators, as §7.1 now states them, and special soundness in every case of the OR-proofs (§7.2);
- that no nonce meets two challenges, whatever the draws;
- §7.2's simulation of every call that uses x.

What stays open:
- §7.3's static-DH step, proved since inside the algebraic group model (below), and ε_key's term for b, which waits on an argument of the same kind;
- Part A, conditional as before;
- the oracle model: HKDF as one oracle, and rule 3 beyond Messaging's labels. Routine, and not done (§7.4);
- deniability's condition and its fix (§9);
- timing, which can give a relay a linking oracle a page at a time: declared (§8), not measured.

It's AI review by two models, not an audit, and no person has checked the arguments.

**§7.3's proof** (2026-11-24, after the above). One model wrote out the proof of §7.3's step in the algebraic group model, against the code. Another, given the proof, the spec and the code, attacked it. It redid the three classes, the argument on degrees, the test "is W = [x]P?" from two representations, the reading of x off a forged proof, and the count of powers. It sorted each handle shape it could think of into a class, and checked class C's claim by brute force over a small field. The algebra held, and so did the loss terms. The proof and the attack's notes are kept with that review's files, not in this repository. What the attack found:
- the proof's side condition S failed in the code: the repeated start (§9), guarded since;
- four places where the proof's text said less than its argument: that it speaks of algebraic attackers only, that the associated data's two points are among those the attacker holds, that w₀ itself gates class C, and that an honestly made handle is readable only in the game with one wallet. Fixed in the proof.

What stands is §7.3's table, with its limits. What stays open there: how far the model reaches, points with no representation, many wallets, class C's game steps carried through, and S where storage was rolled back or wiped (§7.4, §9). It's AI review by two models again, and no person has checked it.

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
- G. Fuchsbauer, A. Plouviez, Y. Seurin. *Blind Schnorr Signatures and Signed ElGamal Encryption in the Algebraic Group Model.* EUROCRYPT 2020.
- RFC 6979 (deterministic nonces); BIP-340 (synthetic nonces with auxiliary randomness).
