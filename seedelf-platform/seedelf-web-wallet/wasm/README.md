# seedelf-wasm

The WebAssembly bindings the web wallet uses for Seedelf cryptography. It is a thin layer over [seedelf-crypto](../../seedelf-crypto/): every protocol rule is enforced there, and this crate only adapts it for JavaScript.

## API

| Export | What it does |
|---|---|
| `SeedelfKey` | Holds the secret scalar inside WebAssembly memory. |
| `SeedelfKey.fromPhrase(phrase, account)` | The wallet's key from a 12-, 15- or 24-word phrase, using the frozen v1 derivation (`seedelf-crypto::derivation`). Throws with a reason on an invalid phrase. |
| `SeedelfKey.random()`, `SeedelfKey.fromHex()` | Dev/test constructors only. |
| `key.baseRegister()` | Returns the base register `(G1, G1^x)`. |
| `key.isOwned(register)` | Whether this key can spend a UTxO with this register. |
| `key.createProof(register, vkh)` | Returns a Schnorr proof `{ z, gR }` bound to the one-time key hash `vkh` (28 bytes, hex). |
| `key.free()` | Drops the key and overwrites the scalar. |
| `generatePhrase()` | A new 24-word recovery phrase from the secure random source. |
| `validatePhrase(phrase)` | Accepts 12, 15 or 24 words, the lengths Lace accepts. Throws with a user-facing reason (word count, unknown word N, checksum). Case and extra whitespace are ignored. |
| `Register` | `{ generator, publicValue }`: compressed G1 points in hex. |
| `rerandomize(register)` | Returns `(g^d, u^d)` with a fresh `d` that is thrown away. |
| `isValidRegister(register)` | On-curve and torsion-free check. |
| `registerToDatum(register)` | Inline-datum bytes (PlutusData CBOR). |
| `verifyProof(register, z, gR, vkh)` | Off-chain mirror of the validator's check. |

## Build

```bash
./build.sh    # → pkg/seedelf_wasm.js, pkg/seedelf_wasm_bg.wasm, .d.ts
```

**Requirements:**

- the `wasm32-unknown-unknown` Rust target
- `clang` with a wasm32 backend, because `blst` is C code
- `llvm-ar` (Ubuntu names it `llvm-ar-18` and similar; the script finds it)
- `wasm-bindgen-cli` at the exact version of the `wasm-bindgen` crate in `Cargo.lock`. The script checks the version and prints the install command.

The output is an ES module (`--target web`). Load it with `init()` or `initSync()`.

## Test

From `seedelf-platform/`:

```bash
cargo test -p seedelf-wasm                                        # native, the plain-Rust layer
./seedelf-web-wallet/wasm/build.sh
node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"            # the built package, from JS
```

Both suites check the same pinned vectors as `seedelf-crypto`, so the WebAssembly build is known to match native Rust byte for byte:

- `seedelf-crypto`'s `random_register` vector
- the frozen key-derivation vectors in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`
