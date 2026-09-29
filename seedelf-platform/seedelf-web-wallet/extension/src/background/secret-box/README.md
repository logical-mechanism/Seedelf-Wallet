# SecretBox (`SBV1`)

Password-based encryption for the wallet's vault: Argon2id (m = 19456 KiB, t = 2, p = 1) derives a 32-byte key, and ChaCha20-Poly1305 seals the secret. The 48-byte header (`"SBV1"` ‖ salt(32) ‖ nonce(12)) is the AEAD associated data.

These files are adapted from **Lace** (`lace-extension@2.4.0`, `packages/lib/core/src/secret-box/`).

- Copyright © 2021 IOHK.
- Licensed under the Apache License, Version 2.0. The full text is in [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0). The rest of this repository is MIT.

**Changes made by Logical Mechanism LLC:**

- Import `@noble/hashes` and `@noble/ciphers` directly instead of Lace's `@lace-lib/vendor` re-exports.
- Drop the legacy EMIP-003 path (`emip3.ts` and its fallback in `open`). This wallet only ever writes `SBV1`.
- Move `DERIVED_KEY_LEN` from `constants.ts` into `kdf.ts`.
- Shorten the doc comments.

Each file names its Lace original at the top.
