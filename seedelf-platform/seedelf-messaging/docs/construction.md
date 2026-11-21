# Seedelf Messaging v1: the construction

How a message is encrypted to a re-randomized Seedelf register, and how its recipient finds and reads it. [security.md](security.md) covers what this guarantees and what it doesn't.

## 1. Notation

- BLS12-381, written additively. G1 and G2 are the prime-order subgroups, of order q, and GT ⊂ F\*p¹² is the pairing's target. e: G1 × G2 → GT is bilinear: e([a]P, [b]Q) = e(P, Q)^{ab}.
- G is the standard G1 generator, [k]P is scalar multiplication, and O is the identity.
- G1's cofactor is h₁ = 3 · 11² · 10177² · 859267² · 52437899² (126 bits). Its small factors are why every point read from outside is checked to be in G1 (§4.4): a small-order point would reveal y modulo them.
- A point's bytes are its 48-byte compressed encoding, the format blst uses and Seedelf datums hold.

## 2. Registers

A recipient with secret y has a register R = (g, v) with v = [y]g. A root register has g = G. A Seedelf datum's g is itself a re-randomized point, and nothing below needs g = G.

**Re-randomization.** Anyone holding R picks a nonzero scalar b and forms

    (p, w) = ([b]g, [b]v).

Then w = [b][y]g = [y]p. The relation holds with the same y, and no secret was needed to make the new register. Both points must use the same b: (p, [b′]v) with b′ ≠ b is no one's register.

**Matching.** The recipient tests [y]p = w. That's one G1 scalar multiplication and a comparison, with no pairing.

- **There are no false matches between different keys.** p has prime order and isn't O, so [y′]p = [y]p only when y′ ≡ y (mod q). Two recipients collide only if they hold the same key.
- **Two re-randomizations repeat only if b repeats,** since p = [b]g determines b. Over n envelopes the chance is about n²/2q.

**Unlinkability.** Deciding whether (p, w) re-randomizes (g, v) means deciding whether (g, v, p, w) is a Diffie–Hellman tuple. That's the DDH problem in G1. BLS12-381 is a type-3 pairing: there's no efficient map from G1 to G2, and a pairing can only test a G1 tuple against a G2 point that carries y. So DDH in G1 is believed hard (the XDH assumption), and Seedelf's on-chain registers already rely on it. It holds only while no [y]h for a G2 point h is public: with one, anyone could test e(p, [y]h) = e(w, h).

## 3. Why there is no pairing

An earlier idea borrowed PEACE's capsule: C₁ = [r]p, C₂ = [a]p + [r]w, and the key e([a]p, h₀), which the recipient recovers as e(C₂, h₀) − e(C₁, [y]h₀). The identity holds, but by bilinearity that's e(C₂ − [y]C₁, h₀), and C₂ − [y]C₁ = [a]p. So for one recipient it is ElGamal on the point [a]p with a pairing on top. The pairing adds no secrecy, costs a fourth point, needs a GT byte encoding no standard fixes, and needs [y]h₀ kept secret. It only earns its place with PEACE's transfer of decryption rights, which messaging doesn't use. v1 is plain ECIES on the register (the owner, 2026-11-20).

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
