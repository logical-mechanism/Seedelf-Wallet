# seedelf-messaging

Seedelf Messaging's library: end-to-end encryption of a byte payload to a re-randomized Seedelf register, and its discovery by the recipient (Phase 1), one-to-one conversations on top of it, with the Double Ratchet inside the envelope (the session layer, chunk 54's 54a), what a post to the relay must be (54c), and the verified reveal of a writer's Seedelf (54f).

It's a library only, with no network, no storage and no clock. The relay is the data layer's ([seedelf-data](../../seedelf-data/README.md#seedelf-messagings-relay)), which keeps its own copy of the `relay` module's checks. There's no UI: the wallet's WebAssembly module binds it ([seedelf-wasm](../seedelf-web-wallet/wasm/README.md), chunk 54's 54d), and the wallet's worker calls it (54e, [architecture.md](../seedelf-web-wallet/docs/architecture.md#seedelf-messaging)), under the wallet's Messages screens (54f). It's unaudited, and outside the bug bounty except a flaw in it that exposes the Seedelf key: [docs/security.md](docs/security.md) says what holds and what doesn't. The Seedelf key is also the messaging key, and [docs/joint-security.md](docs/joint-security.md) argues why that's safe: every use of the key, the rules they keep, and a proof in the random-oracle model.

## What it does

A recipient's register is (g, v) with v = [y]g: a root register (G, [y]G), or any Seedelf datum's.

1. **The sender re-randomizes it** to (p, w) = ([b]g, [b]v), with no secret needed.
2. **The sender encrypts** under a key derived from [r]w, publishing p, a tag of w and c = [r]p (ECIES with HKDF-SHA256 and AES-256-GCM). The tag is SHA-256 of a label and w: never w itself, so no envelope holds a register of its recipient's key, which a payment could be aimed at.
3. **The recipient finds their envelopes** by testing whether the tag is that of [y]p: one scalar multiplication and one SHA-256, no pairing.
4. **The recipient reads them** with [y]c = [r]w.

```rust
use seedelf_messaging::{Envelope, SecretKey, decrypt_message, encrypt_message, matches_envelope};

let alice = SecretKey::generate();
let bytes = encrypt_message(&alice.register(), b"hello")?.to_bytes();

assert!(matches_envelope(&alice, &bytes)?); // the scan: checks p, compares the tag of [y]p
let envelope = Envelope::from_bytes(&bytes)?; // checks every point
assert_eq!(decrypt_message(&alice, &envelope)?, b"hello");
```

| API | |
|---|---|
| `SecretKey::{generate, from_bytes, from_scalar, register}` | The recipient's y. `from_scalar` takes a Seedelf wallet's scalar. |
| `Register::{from_bytes, to_bytes, generator_bytes, public_value_bytes}` | A checked (g, v), in the bytes a Seedelf datum holds. |
| `rerandomize_register`, `matches_register` | Re-randomization and discovery. |
| `matches_envelope` | The scan: whether an envelope's raw bytes are yours. It checks p, not c, and compares the tag in constant time, so an envelope that isn't yours costs one subgroup check, one multiplication and one SHA-256. |
| `encrypt_message`, `decrypt_message` | One envelope, up to 64 KiB of plaintext. |
| `Envelope::{from_bytes, to_bytes, is_for}` | The wire format. |

Every refusal is an `Error` variant, never a panic.

## The envelope (v1)

```text
0x01 | p (48) | tag (32) | c (48) | AES-256-GCM ciphertext | AES-GCM tag (16)
```

- **Size:** 145 bytes plus the plaintext.
- **The header** (version, p, the tag of w, c) is both the HKDF info's tail and the AEAD's associated data, so a change to any byte fails.
- **The nonce** is derived with the key, not sent, since every envelope's key is new.

[docs/construction.md](docs/construction.md) has the mathematics and the exact key schedule. [tests/vectors/messaging_v1.json](tests/vectors/messaging_v1.json) has every intermediate value for four cases. An independent implementation (noble-curves and WebCrypto) reproduced the file byte for byte before call 16 put the tag in w's place; the file has been re-recorded since, and not reproduced again yet.

## Why no pairing

An earlier idea used PEACE's pairing capsule. For one recipient it reduces to ElGamal with a pairing that adds nothing, so v1 is plain ECIES ([docs/construction.md §3](docs/construction.md#3-why-there-is-no-pairing)).

## Sessions

The `session` module builds [docs/protocol.md](docs/protocol.md) §3 to §6: the sender of a first message makes both conversation identities on one base, a first-contact block F carries what the reader needs and proves, to the reader alone, that the base comes from the handle it names and that its writer knows the keys of the other points the reader's key meets, a stamp of proof of work prices a stranger's first message, a static DH in the session secret proves the writer holds their identity's key, and the Double Ratchet runs inside v1 envelopes padded to 512 bytes, 2, 8 or 32 KiB, each bound to its conversation by its p and its c. Before a reply, a writer has a request's share, 16 first-contact messages and 64 KiB, which is all a reader keeps of it. §16 fixes every byte and rule, and §20 what 1.10.0 freezes for later versions. Once answered, the side that wrote first can show the other one of its Seedelfs (`Conversation::reveal`, `Conversation::verify_reveal`): a designated-verifier proof bound to the conversation, which convinces the reader alone (§19).

```rust
use seedelf_messaging::relay::find_stamp;
use seedelf_messaging::session::{FIRST_CONTACT_STAMP_BITS, Handle, Inbox, Received};

let mut alice_inbox = Inbox::new();
let cid = alice_inbox.start(&alice, &bob_register, bob_name, now)?; // a Seedelf's register and name
let digest = alice_inbox.stamp_digest(cid)?; // about 7 s of work in a browser: solve it in slices
alice_inbox.set_stamp(cid, find_stamp(&digest, FIRST_CONTACT_STAMP_BITS, 0, u64::MAX).unwrap())?;
let envelope = alice_inbox.send(cid, b"hello Bob")?; // store the state with it, then post

let mut bob_inbox = Inbox::new();
let bob_handles = [Handle::new(bob_name, bob_register)?]; // every register of his key each of his Seedelfs has held
let Received::Request { plaintext, .. } = bob_inbox.receive(&bob, &bob_handles, &envelope, now)? else { unreachable!() };
bob_inbox.accept(&bob, cid)?; // a request until Bob replies
let reply = bob_inbox.send(cid, b"hello")?;
```

| API | |
|---|---|
| `Conversation::{start, start_continuing, stamp_digest, set_stamp, send, receive, expire, missing, max_text_len, first_contact_left, to_bytes, from_bytes}` | One side of a conversation. Every operation that fails leaves it as it was; its bytes are versioned and hold its secrets. Before a reply, `first_contact_left` says what's left of the request's share. |
| `Inbox::{start, start_continuing, stamp_digest, set_stamp, send, receive, accept, delete, expire, from_parts}` | One network's conversations, requests and tombstones, with §5 and §6's rules over them. `set_first_contact_bits` is for tests and tuning. |
| `Handle` | One of the reader's Seedelfs, by name and register, which a first message's proof is checked against: only a register of the reader's key counts. |
| `Requests`, `Tombstones`, `Continues` | Strangers' first messages, bounded, each within its share, and holding no state; deleted conversations' IDs until t + 48 hours and 7 days, whatever the clock; what a `replaces` amounts to. |
| `open`, `Opened`, `FirstContact`, `Header` | An envelope opened and parsed, every point checked, before any conversation sees it. |

The caller passes `now`, in Unix seconds by the reader's clock, and stores what each state gives: protocol.md §4.2 says in what order.

## Posting to the relay

The `relay` module says what the relay keeps and what a post costs: [docs/protocol.md](docs/protocol.md) §17 fixes every byte. A post is `nonce (8) ‖ envelope`, and its proof of work is the leading zero bits of SHA-256 over the envelope's digest and the nonce.

```rust
use seedelf_messaging::relay::{check_envelope, post_body, solve_stamp};

check_envelope(&envelope)?; // what the relay checks: the version, one of the four sizes, the points
let nonce = solve_stamp("mainnet", &envelope, 18)?; // the price, in bits, the relay named
let body = post_body(nonce, &envelope); // POST /messaging/v1/mainnet/envelopes
```

| API | |
|---|---|
| `check_envelope` | Whether the relay keeps an envelope, and if not, why. |
| `stamp_digest`, `stamp_bits` | The digest that binds the work to the envelope and the pool, and the work a nonce shows. |
| `find_stamp`, `solve_stamp` | A nonce meeting a price: in a slice of nonces, so a caller can yield between slices, or all at once. |
| `post_body` | The bytes to post. |

## Dependencies

| Crate | Why |
|---|---|
| `blstrs` 0.7.1 | G1 arithmetic. It's already the workspace's BLS12-381 library (seedelf-crypto, the WebAssembly module): blst's audited C and assembly behind a safe API. |
| `hkdf` 0.12.4 | The only crate Phase 1 added to the lockfile. |
| `hmac` 0.12.1 | The ratchet's chain keys. Already in the lockfile, under `hkdf`. |
| `sha2`, `aes-gcm` | Already in the lockfile. |
| `rand_core` (`OsRng`), `zeroize`, `ff`, `group` | Randomness, wiping, and the curve traits. |

`blst` directly would mean unsafe FFI here, and arkworks would be a second, slower curve stack next to blstrs. Nothing here uses a pairing.

## Tests

`cargo test -p seedelf-messaging` takes about 10 seconds, the session layer's simulation and Phase 1H's pool most of it; CI runs it with the workspace.

| File | What it covers |
|---|---|
| tests/register_algebra.rs | Tests 1–3: the register algebra. |
| tests/envelope.rs | Tests 4, 6–10, 12, 14 and 15: round trips, the wrong key, tampering with every part, a mixed collection, serialization, versions. |
| tests/invalid_inputs.rs | Test 11: every bad point in every position, bad scalars, and what the scan leaves to the full parse. |
| tests/properties.rs | Phase 1G's properties, with proptest. |
| tests/seedelf_registers.rs | A Seedelf datum's register as the recipient, read with the wallet's own scalar. |
| tests/vectors.rs, `src/tests.rs` | Test 13: the vectors, the key schedule's binding and labels, decryption forced past discovery, and secrets absent from envelopes. |
| tests/pool.rs | Phase 1H: 10 recipients and 1,000 envelopes in one pool. Each scans the raw bytes and reads exactly theirs. |
| src/session/tests/first_contact.rs | Sessions, part 1: F's layout and refusals, the base proof and the stamp's digest, SK on both sides and its binding, both inits, the identities. |
| src/session/tests/ratchet.rs | Part 2: KDF_RK, KDF_CK, ENCRYPT's salt, the envelope's scalars, the labels, skipping within and across chains, MAX_SKIP in all, the stored keys' cap, the 48 hours. |
| src/session/tests/state.rs, `rules.rs` | Part 3: storage at every step, sized exactly, corrupted states, failures changing nothing, padding, parsing, the skipped keys as runs in the order stored (a ratchet key used twice, one encoding for a list, eviction's order through storage), the versions, and §5 and §6's rules, tombstones under a clock set back among them. |
| src/session/tests/adversarial.rs | Part 4: protocol-review.md §E's cases 1–3 and 6–14, one test each. |
| src/session/tests/linking.rs | Part 5: calls 12 and 13. Envelopes aimed at a reader's second handle or at the sum of two, a base on the sum, the reader's handles, the stamp checked first, every envelope at its identity times the outer scalar, its c on another register on every path, its p on one with c the honest one, and no envelope holding a register of either side's key. |
| src/session/tests/keys_proof.rs | Part 6: call 16's keys proof. The base proof's designated verifier, and a register of another key under the reader's name binding no base, E_A, A and S_A on another register on every path, the reader's own F, the nonces over every subset of a start's draws, the three mutants, the chain verifier. |
| src/session/tests/far.rs | Part 7: "too far ahead" only for a message that authenticates at the conversation's identity, forged and genuine, on every chain, at the bound and past it, counted in chain steps. |
| src/session/tests/share.rs | Part 8: a request's share. A first-contact header past it doesn't parse; the writer's 16 and 64 KiB, refused before the chain moves; joins past it or past 256 KiB refused before the replay, never pushing a request out; a new request never pushing itself out; the writer's stored count; stored requests held to it. |
| src/session/tests/vectors.rs, tests/session_vectors.rs | The session vectors, written from fixed draws and read back through the public API, with b, the proofs' nonces and each envelope's scalars rebuilt from the file alone. |
| src/session/tests/reveal.rs, tests/reveal_vectors.rs | The reveal (§19): who may make and check one, its binding to the conversation, name and register, every bit flipped, the reader's own forgery verifying, every malformed reveal's code, and its vectors, read back through the public API. |
| tests/old_records.rs | The records development builds wrote before call 16 (tests/fixtures/old_records_v1.json), refused by their version through the public API; the tombstones' still read. |
| tests/session_properties.rs | Any schedule of sends, out-of-order deliveries, duplicates, losses and restarts; both sides first; resets; skipped keys' 48 hours. |
| tests/simulation.rs | Two wallets over a 36-hour relay, killed at every point of §4.2 and locked past 36 hours, a writer's share used up before a reply; cases 4 and 5. `SIMULATION_SEEDS=n` runs more than 24 seeds. |
| src/relay.rs | What the relay keeps and the stamp: the relay's vectors, every refusal, session envelopes of each size kept, the stamp's binding and its first nonce. |

`RECORD_MESSAGING_VECTORS=1 cargo test -p seedelf-messaging --lib` rewrites the envelope's vectors, `RECORD_MESSAGING_SESSION_VECTORS=1` the session's (in a release build: it searches 24-bit stamps), `RECORD_MESSAGING_RELAY_VECTORS=1` the relay's, which the data layer's copy of the checks is held to, and `RECORD_MESSAGING_REVEAL_VECTORS=1` the reveal's. That's for a deliberate change of format only: other implementations are held to them. The envelope's, the session's and the reveal's were reproduced by independent implementations (noble-curves and WebCrypto), the session's written from protocol.md §16 alone and the reveal's from §19, before call 16 re-recorded all four; none has been reproduced since (protocol.md §16.6).

## Measured performance

```bash
cargo run --release -p seedelf-messaging --example pool_bench -- 10000 10
```

Measured on an Intel Core i5-12400F (one thread, `powersave` governor), Linux 7.0, rustc 1.98.1, release profile, 2026-11-20. The plaintexts were 256 bytes, so each envelope was 417 bytes. That was before call 16 put a tag in w's place: an envelope was then 161 bytes more than its plaintext, and the scan checked p and w. It now checks p alone and hashes [y]p, one subgroup check fewer and one SHA-256 more, and the full parse checks two points; the multiplication is unchanged.

| Operation | 1,000 messages | 10,000 messages |
|---|---|---|
| Key and root register (10 of them) | 122 µs | 79 µs |
| Re-randomize a register | 161 µs | 157 µs |
| Encrypt, to bytes | 309 µs | 310 µs |
| **Scan raw bytes** (`matches_envelope`: two subgroup checks, one test) | **179 µs** | **180 µs** |
| Full parse, for comparison (three subgroup checks) | 155 µs | 165 µs |
| Discovery on a parsed envelope, for comparison | 74 µs | 78 µs |
| Open a match (full parse, then decrypt) | 330 µs | 307 µs |

One recipient's scan took 179 ms for 1,000 envelopes and 1.80 s for 10,000 (100 and 1,000 matched). A full parse followed by discovery costs about 0.23 ms an envelope, so scanning raw bytes saves about a fifth.

**In WebAssembly,** built as the wallet builds its module (wasm-bindgen 0.2.128, clang 21, the `wasm-release` profile) and run in Node 24 (V8, Chrome's engine) on the same machine:

| Operation | WebAssembly | Against native |
|---|---|---|
| Scan raw bytes | 1.02 ms | about 5.7× |
| Full parse | 0.88 ms | about 5.5× |
| Open a match | 1.77 ms | about 5.7× |
| Encrypt | 2.2 ms | about 7× |

Without blst's x86 assembly, the scan is the scaling limit. A 36-hour pool at 10,000 envelopes a day takes about 15 s to scan on a fresh sync ([docs/protocol.md §8](docs/protocol.md#8-what-each-message-costs)). The size-optimized profile measured the same as `-O3`. That harness was a scratch crate outside the repo. The wallet's module now measures its own, through its bindings (`node scale.mjs messaging`, [seedelf-wasm's README](../seedelf-web-wallet/wasm/README.md)): 0.97 ms an envelope in Node, 1.09 ms in a Chrome worker.

## Next

The protocol's Tamarin model is [model/](model/) (54b): `model/check.sh` proves it in Docker.

Chunk 54's plan ([chunk-54-messaging.md](../seedelf-web-wallet/docs/plans/chunk-54-messaging.md)) has the rest: the gate (54g), and what the model could cover next. The relay (54c) is built, in the data layer, and so are the WebAssembly bindings (54d), the worker (54e) and the screens (54f).
