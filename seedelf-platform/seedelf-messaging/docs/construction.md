# Seedelf Messaging v1: the construction

How a message is encrypted to a re-randomized Seedelf register, how its recipient finds and reads it, and why the pairing design was reviewed and set aside for v1. [security.md](security.md) covers what this guarantees and what it doesn't.

## 1. Notation

- BLS12-381, written additively. G1 and G2 are the prime-order subgroups, of order q, and GT ⊂ F\*p¹² is the pairing's target. e: G1 × G2 → GT is bilinear: e([a]P, [b]Q) = e(P, Q)^{ab}.
- G is the standard G1 generator, [k]P is scalar multiplication, and O is the identity.
- G1's cofactor is h₁ = 3 · 11² · 10177² · 859267² · 52437899² (126 bits). Its small factors are why every point read from outside is checked to be in G1 (§3.4, §4.4).
- A point's bytes are its 48-byte compressed encoding, the format blst uses and Seedelf datums hold.

## 2. Registers

A recipient with secret y has a register R = (g, v) with v = [y]g. A root register has g = G. A Seedelf datum's g is itself a re-randomized point, and nothing below needs g = G.

**Re-randomization.** Anyone holding R picks a nonzero scalar b and forms

    (p, w) = ([b]g, [b]v).

Then w = [b][y]g = [y]p. The relation holds with the same y, and no secret was needed to make the new register. Both points must use the same b: (p, [b′]v) with b′ ≠ b is no one's register.

**Matching.** The recipient tests [y]p = w. That's one G1 scalar multiplication and a comparison, with no pairing.

- **There are no false matches between different keys.** p has prime order and isn't O, so [y′]p = [y]p only when y′ ≡ y (mod q). Two recipients collide only if they hold the same key.
- **Two re-randomizations repeat only if b repeats,** since p = [b]g determines b. Over n envelopes the chance is about n²/2q.

**Unlinkability.** Deciding whether (p, w) re-randomizes (g, v) means deciding whether (g, v, p, w) is a Diffie–Hellman tuple. That's the DDH problem in G1. BLS12-381 is a type-3 pairing: there's no efficient map from G1 to G2, and a pairing can only test a G1 tuple against a G2 point that carries y. So DDH in G1 is believed hard (the XDH assumption), and Seedelf's on-chain registers already rely on it. It holds only while no [y]h for a G2 point h is public (§3.4).

## 3. The pairing design, reviewed

### 3.1 As proposed

The sender picks nonzero a and r, with h₀ a fixed public point in G2:

    C₁ = [r]p
    C₂ = [a]p + [r]w
    K  = e([a]p, h₀)

The recipient computes

    K′ = e(C₂, h₀) − e(C₁, [y]h₀)        (a quotient in GT, written additively)

### 3.2 Correctness

    e(C₂, h₀)    = e([a]p, h₀) + e([r]w, h₀) = e([a]p, h₀) + ry·e(p, h₀)
    e(C₁, [y]h₀) = e([r]p, [y]h₀)        = ry·e(p, h₀)

so K′ = e([a]p, h₀) = K. The identity is right. `the_pairing_identity_holds` (tests/register_algebra.rs) checks it with PEACE's H₀ and with a random G2 point.

### 3.3 What it reduces to

By bilinearity, the recipient's computation is a single pairing of a G1 point:

    K′ = e(C₂ − [y]C₁, h₀),   and   C₂ − [y]C₁ = [a]p + [r][y]p − [y][r]p = [a]p.

(C₁, C₂) is an ElGamal ciphertext of the point M = [a]p under the key (p, w). K = e(M, h₀) is a fixed, public function of M: anyone who learns M learns K, and the recipient gets M in G1 without a pairing. For one recipient, the pairing maps M into GT and adds no secrecy (`the_capsule_is_elgamal_on_a_p`).

### 3.4 What it needs

1. **[y]h₀ must never be public, nor [y]h for any G2 point h.** With [y]h₀, anyone computes K = e(C₂, h₀) − e(C₁, [y]h₀). Anyone could also link a re-randomized register to its owner: e(p, [y]h₀) = e(w, h₀) (`a_public_y_h0_would_break_confidentiality_and_unlinkability`). PEACE publishes its [sk]H₀ only masked by [hk]G2.
2. **Every point must be in G1 and not O.** A small-order ephemeral reveals y modulo h₁'s small factors to anyone who can tell whether a decryption succeeded. An identity register (O, O) matches every key.
3. **The header must be bound.** (C₁ + [s]p, C₂ + [s]w) and ([t]p, [t]w) both leave K unchanged (`the_capsule_and_register_are_malleable`), so the key derivation and the AEAD must cover them.
4. **a and r must be nonzero.**

### 3.5 Its assumption

An outsider who wants K must compute e(p, h₀)^{ry} from [r]p and [y]p. That's a bilinear Diffie–Hellman problem across G1 × G2. Solving CDH in G1 solves it, but no reduction the other way is known. ECIES needs only CDH in G1 (gap-DH for chosen-ciphertext security). So the pairing design never rests on a weaker assumption than ECIES, and possibly on a stronger one.

### 3.6 Its costs

- **Size:** four header points (192 bytes) where ECIES needs three (144).
- **Time:** one or two pairings per decryption, about 0.48 ms each measured (see the README), on top of the scalar multiplications.
- **A GT encoding.** The key derivation needs the bytes of an F_{p¹²} element, and there's no standard encoding. PEACE already has two: its Python hashes py_ecc's flat 12-coefficient form with blake2b-224, and its browser code goes through gnark's tower form and MiMC. blst keeps the tower form in its own order. A third encoding would have to be pinned, versioned and given vectors in every implementation.

### 3.7 Where the pairing earns its place

PEACE's transfer of decryption rights: a re-encryption key in G2 meets C₁ through the pairing. Single-recipient messaging never uses that. If Seedelf Messaging later needs transferable rights, a later version can carry PEACE's capsule, and v1 envelopes stay readable as v1.

**Decision (the owner, 2026-11-20):** v1 is ECIES on the re-randomized register.

## 4. v1: ECIES on a re-randomized register

### 4.1 Encrypt

Input: the recipient's register R = (g, v), checked as in §4.4, and a plaintext m of at most 65,536 bytes.

1. Draw nonzero scalars b and r from the operating system's generator.
2. p = [b]g, w = [b]v.
3. c = [r]p, the ephemeral point.
4. z = [r]w, the shared point.
5. H = 0x01 ‖ p ‖ w ‖ c, the 145-byte header.
6. key ‖ nonce = HKDF-SHA256(salt = `Seedelf-Messaging|v1|HKDF-SHA256|salt`, ikm = z, info = `Seedelf-Messaging|v1|AES-256-GCM|key|nonce` ‖ H, 44 bytes). The key is 32 bytes and the nonce 12.
7. ct = AES-256-GCM(key, nonce, aad = H, m): the ciphertext and its 16-byte tag.
8. The envelope is H ‖ ct.

### 4.2 Decrypt

With the secret y:

1. **Parse:** the version is 1, the length is 161 to 161 + 65,536 bytes, and p, w and c are each canonical, in G1 and not O. Anything else is refused before any arithmetic with y.
2. **Discover:** if [y]p ≠ w, the envelope isn't theirs.
3. **Shared point:** z = [y]c.
4. **Open:** derive the key and nonce from z and H, then open with aad = H. A failure releases nothing.

Correctness: [y]c = [y][r]p = [r][y]p = [r]w = z.

### 4.3 What is bound, and why

The whole header goes into both HKDF's info and the AEAD's associated data:

- **The version,** so another version's keys never coincide with v1's.
- **c,** as in ISO 18033-2's ECIES-KEM, which derives from c ‖ z. It makes the key encapsulation non-malleable.
- **p and w.** The recipient's shared point [y]c doesn't depend on them. Unbound, anyone could swap in another re-randomization of the same register and the envelope would still open, for instance a relay re-randomizing envelopes to tag them. Bound, every swap fails authentication (`a_rescaled_register_is_still_hers_but_fails_authentication`).

Either binding alone protects integrity. Both cost nothing, and each layer stays sound on its own.

**The nonce is derived, not sent.** Each envelope has a fresh r, so a fresh c and z, so a fresh key, and a nonce is used once under it. A repeat would need r to repeat, a broken generator that breaks everything else too. Deriving it saves 12 bytes.

**Domain separation:**
- The labels name the protocol, its version, the primitive and the purpose. They differ from PEACE's (`SLT|ECIES|AES-GCM|v1|`, `KEM|ECIES|AES-GCM|v1|`), and Seedelf's Schnorr challenge uses blake2b-224, a different hash altogether (`labels_separate_the_keys`).
- The shared point is only ever HKDF's input, never a key.
- Discovery has no hash and no label: it's the algebraic test of §2.

### 4.4 Encodings

- **Points:** 48-byte compressed G1. Only canonical encodings are accepted: a decoded point must re-encode to the same bytes, which refuses stray bits beside the infinity flag. Each point must be in the prime-order subgroup and not O.
- **Scalars** (`SecretKey::from_bytes`): 32 bytes, big-endian, with 0 < y < q.
- **The envelope** has no length prefix; the transport delimits it.
- **Why not PEACE's format:** PEACE writes its capsule as a Plutus constructor of byte strings, because its contracts read it. An off-chain envelope has no contract to read it, so v1 uses fixed positions and raw bytes, which are canonical by construction: one envelope, one byte string.

### 4.5 Test vectors

[tests/vectors/messaging_v1.json](../tests/vectors/messaging_v1.json) has four cases: empty, ASCII, every byte value under a re-randomized root generator, and UTF-8. Each gives every intermediate value: y, the root register, b, r, (p, w), c, z, the key, the nonce, the header and the envelope.

- `test_vectors_match_the_file` holds the code to the file. `RECORD_MESSAGING_VECTORS=1` rewrites it, for a deliberate change of format only.
- tests/vectors.rs reads the file through the public API alone.
- An independent implementation reproduced every value: noble-curves 2.0.1 for G1, with Node's WebCrypto for HKDF-SHA256 and AES-256-GCM, the same primitives a browser has.

### 4.6 Cost

The envelope is 161 bytes plus the plaintext.

| Operation | Work |
|---|---|
| Encrypt | Four G1 scalar multiplications |
| Parse | Three subgroup checks |
| Discover | One scalar multiplication |
| Decrypt | Two scalar multiplications: discovery again, then [y]c |
