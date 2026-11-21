# seedelf-messaging

Phase 1 of Seedelf Messaging: end-to-end encryption of a byte payload to a re-randomized Seedelf register, and its discovery by the recipient.

It's a library only. There's no relay and no UI, and nothing in the wallet uses it yet. It's unaudited: [docs/security.md](docs/security.md) says what holds and what doesn't.

## What it does

A recipient's register is (g, v) with v = [y]g: a root register (G, [y]G), or any Seedelf datum's.

1. **The sender re-randomizes it** to (p, w) = ([b]g, [b]v), with no secret needed.
2. **The sender encrypts** under a key derived from [r]w, publishing c = [r]p (ECIES with HKDF-SHA256 and AES-256-GCM).
3. **The recipient finds their envelopes** by testing [y]p = w: one scalar multiplication, no pairing.
4. **The recipient reads them** with [y]c = [r]w.

```rust
use seedelf_messaging::{Envelope, SecretKey, decrypt_message, encrypt_message};

let alice = SecretKey::generate();
let bytes = encrypt_message(&alice.register(), b"hello")?.to_bytes();

let envelope = Envelope::from_bytes(&bytes)?; // checks every point first
assert!(envelope.is_for(&alice));
assert_eq!(decrypt_message(&alice, &envelope)?, b"hello");
```

| API | |
|---|---|
| `SecretKey::{generate, from_bytes, from_scalar, register}` | The recipient's y. `from_scalar` takes a Seedelf wallet's scalar. |
| `Register::{from_bytes, to_bytes, generator_bytes, public_value_bytes}` | A checked (g, v), in the bytes a Seedelf datum holds. |
| `rerandomize_register`, `matches_register` | Re-randomization and discovery. |
| `encrypt_message`, `decrypt_message` | One envelope, up to 64 KiB of plaintext. |
| `Envelope::{from_bytes, to_bytes, is_for, register}` | The wire format. |

Every refusal is an `Error` variant, never a panic.

## The envelope (v1)

```text
0x01 | p (48) | w (48) | c (48) | AES-256-GCM ciphertext | tag (16)
```

- **Size:** 161 bytes plus the plaintext.
- **The header** (version, p, w, c) is both the HKDF info's tail and the AEAD's associated data, so a change to any byte fails.
- **The nonce** is derived with the key, not sent, since every envelope's key is new.

[docs/construction.md](docs/construction.md) has the mathematics and the exact key schedule. [tests/vectors/messaging_v1.json](tests/vectors/messaging_v1.json) has every intermediate value for four cases, which an independent implementation (noble-curves and WebCrypto) reproduces byte for byte.

## Why no pairing

An earlier idea used PEACE's pairing capsule. For one recipient it reduces to ElGamal with a pairing that adds nothing, so v1 is plain ECIES ([docs/construction.md §3](docs/construction.md#3-why-there-is-no-pairing)).

## Dependencies

| Crate | Why |
|---|---|
| `blstrs` 0.7.1 | G1 arithmetic. It's already the workspace's BLS12-381 library (seedelf-crypto, the WebAssembly module): blst's audited C and assembly behind a safe API. |
| `hkdf` 0.12.4 | The only crate new to the lockfile. |
| `sha2`, `aes-gcm` | Already in the lockfile. |
| `rand_core` (`OsRng`), `zeroize`, `ff`, `group` | Randomness, wiping, and the curve traits. |

`blst` directly would mean unsafe FFI here, and arkworks would be a second, slower curve stack next to blstrs. Nothing here uses a pairing.

## Tests

`cargo test -p seedelf-messaging` takes about 4 seconds; CI runs it with the workspace.

| File | What it covers |
|---|---|
| tests/register_algebra.rs | Tests 1–3: the register algebra. |
| tests/envelope.rs | Tests 4, 6–10, 12, 14 and 15: round trips, the wrong key, tampering with every part, a mixed collection, serialization, versions. |
| tests/invalid_inputs.rs | Test 11: every bad point in every position, and bad scalars. |
| tests/properties.rs | Phase 1G's properties, with proptest. |
| tests/seedelf_registers.rs | A Seedelf datum's register as the recipient, read with the wallet's own scalar. |
| tests/vectors.rs, `src/tests.rs` | Test 13: the vectors, the key schedule's binding and labels, decryption forced past discovery, and secrets absent from envelopes. |
| tests/pool.rs | Phase 1H: 10 recipients and 1,000 envelopes in one pool. Each finds and reads exactly theirs. |

`RECORD_MESSAGING_VECTORS=1 cargo test -p seedelf-messaging --lib` rewrites the vectors. That's for a deliberate change of format only: other implementations are held to them.

## Measured performance

```bash
cargo run --release -p seedelf-messaging --example pool_bench -- 10000 10
```

Measured on an Intel Core i5-12400F (one thread, `powersave` governor), Linux 7.0, rustc 1.98.1, release profile, 2026-11-20. The plaintexts were 256 bytes, so each envelope was 417 bytes.

| Operation | 1,000 messages | 10,000 messages |
|---|---|---|
| Key and root register | 79 µs | 75 µs |
| Re-randomize a register | 153 µs | 153 µs |
| Encrypt, to bytes | 307 µs | 309 µs |
| Parse an envelope (three subgroup checks) | 152 µs | 154 µs |
| Discovery, per header | 72 µs | 74 µs |
| Decrypt a matched message | 151 µs | 152 µs |

One recipient's whole scan took 72 ms for 1,000 envelopes and 738 ms for 10,000 (100 and 1,000 matched). Parsing every envelope first costs about twice the scan.

## Next

[docs/protocol.md](docs/protocol.md) is the draft for what comes after: one-to-one conversations with the Double Ratchet inside this envelope, conversation identities the first sender makes for both sides, and a relay that keeps envelopes 36 hours behind proof of work. It's for review; none of it is built.
