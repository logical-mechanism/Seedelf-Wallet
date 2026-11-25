# Seedelf Messaging v1: the construction

How a message is encrypted to a re-randomized Seedelf register, and how its recipient finds and reads it. [security.md](security.md) covers what this guarantees and what it doesn't.

## 1. Notation

- BLS12-381, written additively. G1 and G2 are the prime-order subgroups, of order q, and GT ⊂ F\*p¹² is the pairing's target. e: G1 × G2 → GT is bilinear: e([a]P, [b]Q) = e(P, Q)^{ab}.
- G is the standard G1 generator, [k]P is scalar multiplication, and O is the identity.
- G1's cofactor is h₁ = 3 · 11² · 10177² · 859267² · 52437899² (126 bits). Its small factors are why every point read from outside is checked to be in G1 (§4.4): a small-order point would reveal y modulo them.
- **The curve:** E: y² = x³ + 4 over F_p, and G1 its subgroup of prime order q, with

      p = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab (381 bits)
      q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001 (255 bits)

  Both come from BLS12-381's parameter z = −0xd201000000010000: q = z⁴ − z² + 1, p = (z − 1)²·q/3 + z, and #E(F_p) = h₁·q. This p is the field's prime, not an envelope's p (§2). Here z is the curve's parameter, not §4's shared point, and x and y are a point's coordinates, not a key (§2).
- **G** is the point with

      x = 0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb
      y = 0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1

  Its bytes are `97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb`.
- **A point's bytes** are its 48-byte compressed encoding, Zcash's for BLS12-381, which blst writes and Seedelf datums hold: x, below p, as 48 big-endian bytes. x < p < 2³⁸¹, so the top three bits are free and carry three flags in the first byte:
  - 0x80, compressed: always set;
  - 0x40, infinity: set only in O's bytes, `0xc0` then 47 zero bytes;
  - 0x20, the sign: set exactly when y > (p − 1)/2, the larger of y and p − y; clear in O's bytes.

  p ≡ 3 (mod 4), so a reader takes y = (x³ + 4)^((p + 1)/4) mod p, refuses x when y² ≠ x³ + 4, and takes p − y when y's size doesn't match the sign. §4.4 says which points are valid.

## 2. Registers

A recipient with secret y has a register R = (g, v) with v = [y]g. A root register has g = G. A Seedelf datum's g is itself a re-randomized point, and nothing below needs g = G.

**Re-randomization.** Anyone holding R picks a nonzero scalar b and forms

    (p, w) = ([b]g, [b]v).

Then w = [b][y]g = [y]p. The relation holds with the same y, and no secret was needed to make the new register. Both points must use the same b: (p, [b′]v) with b′ ≠ b is no one's register.

**Matching.** The recipient tests [y]p = w. That's one G1 scalar multiplication and a comparison, with no pairing. An envelope carries p and a tag of w, not w (§4): its recipient computes w = [y]p and compares tags.

- **There are no false matches between different keys.** p has prime order and isn't O, so [y′]p = [y]p only when y′ ≡ y (mod q). Two recipients collide only if they hold the same key, or their two w's tags collide: a SHA-256 collision.
- **Two re-randomizations repeat only if b repeats,** since p = [b]g determines b. Over n envelopes the chance is about n²/2q.

**Unlinkability.** Deciding whether (p, w) re-randomizes (g, v) means deciding whether (g, v, p, w) is a Diffie–Hellman tuple. That's the DDH problem in G1. BLS12-381 is a type-3 pairing: there's no efficient map from G1 to G2, and a pairing can only test a G1 tuple against a G2 point that carries y. So DDH in G1 is believed hard (the XDH assumption), and Seedelf's on-chain registers already rely on it. It holds only while no [y]h for a G2 point h is public: with one, anyone could test e(p, [y]h) = e(w, h). An envelope shows less than (p, w): p and a hash of w, which anyone holding w could compute, so it gives a distinguisher nothing (p, w) wouldn't.

## 3. Why there is no pairing

An earlier idea borrowed PEACE's capsule: C₁ = [r]p, C₂ = [a]p + [r]w, and the key e([a]p, h₀), which the recipient recovers as e(C₂, h₀) − e(C₁, [y]h₀). The identity holds, but by bilinearity that's e(C₂ − [y]C₁, h₀), and C₂ − [y]C₁ = [a]p. So for one recipient it is ElGamal on the point [a]p with a pairing on top. The pairing adds no secrecy, costs a fourth point, needs a GT byte encoding no standard fixes, and needs [y]h₀ kept secret. It only earns its place with PEACE's transfer of decryption rights, which messaging doesn't use. v1 is plain ECIES on the register (the owner, 2026-11-20).

## 4. v1: ECIES on a re-randomized register

### 4.1 Encrypt

Input: the recipient's register R = (g, v), checked as in §4.4, and a plaintext m of at most 65,536 bytes.

1. Draw nonzero scalars b and r from the operating system's generator. The session layer derives both from the message key and the ratchet salt instead (protocol.md §16.2).
2. p = [b]g, w = [b]v.
3. c = [r]p, the ephemeral point.
4. z = [r]w, the shared point.
5. tag = SHA-256(`Seedelf-Messaging|v1|envelope|tag` ‖ w), 32 bytes.
6. H = 0x01 ‖ p ‖ tag ‖ c, the 129-byte header. w itself is in no byte of the envelope.
7. key ‖ nonce = HKDF-SHA256(salt = `Seedelf-Messaging|v1|HKDF-SHA256|salt`, ikm = z, info = `Seedelf-Messaging|v1|AES-256-GCM|key|nonce` ‖ H, 44 bytes). The key is 32 bytes and the nonce 12.
8. ct = AES-256-GCM(key, nonce, aad = H, m): the ciphertext and AES-GCM's 16-byte tag.
9. The envelope is H ‖ ct:

       0x01 | p (48) | tag (32) | c (48) | AES-256-GCM ciphertext | AES-GCM's tag (16)

### 4.2 Decrypt

With the secret y:

1. **Scan** (`matches_envelope`): the version is 1, the length is 145 to 145 + 65,536 bytes, and p is canonical, in G1 and not O. Then w′ = [y]p, and unless SHA-256(`Seedelf-Messaging|v1|envelope|tag` ‖ w′) is the tag, compared in constant time, the envelope isn't theirs, and c is never looked at.
2. **Parse** (`Envelope::from_bytes`): c is checked as p was. y never touches a point that hasn't been checked. The tag is any 32 bytes: only the scan judges it.
3. **Shared point:** z = [y]c.
4. **Open:** derive the key and nonce from z and H, then open with aad = H. A failure releases nothing.

Correctness: [y]p = [y][b]g = [b]v = w, so the tags agree, and [y]c = [y][r]p = [r][y]p = [r]w = z.

### 4.3 What is bound, and why

The whole header goes into both HKDF's info and the AEAD's associated data:

- **The version,** so another version's keys never coincide with v1's.
- **c,** as in ISO 18033-2's ECIES-KEM, which derives from c ‖ z. It makes the key encapsulation non-malleable.
- **p and the tag, so w.** The recipient's shared point [y]c doesn't depend on them. Unbound, anyone who knew w could swap in another re-randomization of the same register, ([k]p, the tag of [k]w), and the envelope would still open. A relay doesn't know w, but the sender does. Bound, every swap fails authentication (`a_rescaled_register_is_still_hers_but_fails_authentication`). The tag binds w as SHA-256 does: another w with the same tag is a collision.

Either binding alone protects integrity. Both cost nothing, and each layer stays sound on its own.

**Why a tag, and not w.** (p, w) is a register of the recipient's key, and a Seedelf wallet treats every register of its key as its own: it counts a payment at the Seedelf contract, or a Lovejoin box, under one as received, and spends it. An envelope carrying w handed whoever read the pool a register to pay: under (p, w), to follow its reader into whatever the spend joins; under (p + g_S, w + v_S), to learn whether it was for the Seedelf S; under the sum of two envelopes' registers, to learn whether they share a reader. The spend answered on chain (the gate review's chain-reaction#1). With the tag:
- **Nothing in an envelope is a register of its recipient's key,** nor of any key a wallet holds. Its points are p and c, and a register of y on either needs [y]p or [y]c, which only the recipient can compute (`no_envelope_holds_a_register_of_its_readers_key`). (p, c) itself is a register of r, which no wallet holds: a payment to it waits for whoever knows r, and no wallet spends it by itself.
- **The scan costs what it did:** one multiplication, and one SHA-256 more.
- **Unlinkability is no weaker:** the tag is a function of w, so it tells no one more than w did (§2).

A conversation's own registers are the session layer's matter: protocol.md §2.

**The nonce is derived, not sent.** Each envelope has a fresh r, so a fresh c and z, so a fresh key, and a nonce is used once under it. A repeat would need r to repeat, a broken generator that breaks everything else too. In the session layer r comes from the message key and the salt, so a repeat needs a rolled-back state and a repeated salt (protocol.md §4.2). Deriving the nonce saves 12 bytes.

**Domain separation:**
- The labels name the protocol, its version, the primitive and the purpose. They differ from PEACE's (`SLT|ECIES|AES-GCM|v1|`, `KEM|ECIES|AES-GCM|v1|`), and Seedelf's Schnorr challenge uses blake2b-224, a different hash altogether (`labels_separate_the_keys`).
- The shared point is only ever HKDF's input, never a key.
- [y]p is only ever the tag's SHA-256 input, compared and dropped. The tag's label is no prefix of another label this crate hashes with SHA-256, and none is a prefix of it (`the_labels_are_prefix_free_within_each_function`).

### 4.4 Encodings

- **Points** (p and c): 48 bytes, §1's encoding. A point read is valid exactly when:
  - its compressed flag is set;
  - its infinity flag is clear. O's own bytes are refused as O, and any other bytes with the flag as a bad encoding;
  - x < p, and x³ + 4 is a square mod p;
  - it's in G1: [q]P = O, or a test equivalent to it. A point outside G1 is refused, never multiplied into G1 by h₁.

  So every point accepted re-encodes to its own bytes. The codes are protocol.md §19.3's: `invalid_encoding` for a flag or for x, `not_in_subgroup` for a point outside G1, and `identity_point` for O's bytes. x = 0 is the exception: its points, (0, ±2), are on the curve and outside G1, but blst refuses them as it decodes, so they're `invalid_encoding`.
- **The tag:** 32 bytes, any value. Nothing decodes it.
- **Scalars** (`SecretKey::from_bytes`): 32 bytes, big-endian, with 0 < y < q.
- **The envelope** has no length prefix; the transport delimits it.
- **Why not PEACE's format:** PEACE writes its capsule as a Plutus constructor of byte strings, because its contracts read it. An off-chain envelope has no contract to read it, so v1 uses fixed positions and raw bytes, which are canonical by construction: one envelope, one byte string.

### 4.5 Test vectors

[tests/vectors/messaging_v1.json](../tests/vectors/messaging_v1.json) has four cases: empty, ASCII, every byte value under a re-randomized root generator, and UTF-8. Each gives every intermediate value: y, the root register, b, r, (p, w), the tag, c, z, the key, the nonce, the header and the envelope. The file names w; the envelope doesn't hold it.

- `test_vectors_match_the_file` holds the code to the file. `RECORD_MESSAGING_VECTORS=1` rewrites it, for a deliberate change of format only.
- tests/vectors.rs reads the file through the public API alone, and checks w is in none of the envelope's bytes.
- An independent implementation reproduced every value of the file before the tag replaced w: noble-curves 2.0.1 for G1, with Node's WebCrypto for HKDF-SHA256 and AES-256-GCM, the same primitives a browser has. The file was re-recorded with the tag, and reproduced again with the other three vector files (2026-11-23, and 2026-11-24 as they are now): another model's harness, written from this document, protocol.md and the files alone, without the Rust, with no mismatch (protocol.md §16.6 says what of the other files it didn't reproduce).

### 4.6 Cost

The envelope is 145 bytes plus the plaintext.

| Operation | Work |
|---|---|
| Encrypt | Four G1 scalar multiplications and a SHA-256 |
| Scan | One subgroup check, one scalar multiplication and a SHA-256 |
| Open a match | The full parse's two subgroup checks, then two scalar multiplications: discovery again, then [y]c |
