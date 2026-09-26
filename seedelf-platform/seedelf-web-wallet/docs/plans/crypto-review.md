# Crypto review (2026-09-25)

A review of the web wallet's cryptography after chunk 16. It checked how randomness is drawn, where it's drawn needlessly, and whether a secret can leak. Branch `web-wallet/crypto-review`, from `web-wallet/lovejoin`.

**Scope:**

- `seedelf-crypto`: the derivation, the Seedelf Schnorr prover, Lovejoin's provers, registers.
- The parts of `seedelf-core` the wallet uses: script spends, Lovejoin's mixes and withdraws.
- The WebAssembly crate.
- The worker: the vault, SecretBox, the private store, sessions, the dApp connector, Lovejoin, the content scripts and the manifest.
- The UI has its own review. It was touched here only where a worker secret reached it.

## Fixed on this branch

| # | Severity | What | Fix |
|---|---|---|---|
| 1 | High | **A one-time session account could be used twice.** A new session took the next index from the sealed session record, and that record is only on this device. A restored wallet, one removed and restored, the same phrase in another browser, or a record that failed to open all start again at 0. Two sessions on one key are linked on chain. | Before funding a session, the worker asks Koios which of the next 20 indexes' stake keys any address has used (`account_addresses`, one request), and takes the first that none has (`SessionService.freshIndex`). Bring back and Bring everything back now build in turn with the sends: a save they overlapped could roll the record back. |
| 2 | Medium | **The vault's entropy reached every open UI page.** The UI's `chrome.storage.onChanged` listener was given session storage's changes, the entropy among them at every unlock and lock. | The UI listens to `chrome.storage.local.onChanged` alone. |
| 3 | Medium | **A Seedelf proof's nonce was only as good as the random source.** A repeated nonce on two statements reveals the Seedelf key: every private UTxO, and every Lovejoin box. | The nonce is hedged: HMAC-SHA-512 keyed by the scalar, over the register, the one-time key's hash and 32 fresh random bytes (`schnorr::proof_nonce`). The verifier is unchanged, and the CLI gets it too. |
| 4 | Medium | **Lovejoin withdraws came back in a burst** (privacy). Boxes are withdrawn only while unlocked, and the minute alarm stopped once no swap or chain ran. So after a lock that outlasted their delays (1–6 hours against a 15-minute lock), every due box went back to back at the next unlock. That undid much of the random delay. | The user's call (2026-09-25): "even if they all came out in a burst then delay them so its not a chunk." One box a run; each of the others due waits a fresh 5 to 60 minutes, drawn on its own (`WITHDRAW_SPREAD_MS`). The alarm keeps running while boxes wait and the wallet is unlocked. |
| 5 | Medium | **Drafts went to Koios's Ogmios** for their budgets. A draft carries valid proofs, so Koios learned which contract UTxOs an IP address owns, even for a review never sent. | The user's call: the wallet's own evaluator. `buildMint`, `buildTransfer`, `buildWithdraw` and `buildRemove` prove and measure in one WebAssembly call (`ScriptSpend::measure_locally`), a request fewer each. The recorded preprod transfer's fee comes out the same, or 602 lovelace less: the scripts see the signers sorted by hash, so a one-time key hash that sorts before giveme.my's (about 7% of them) is found a step sooner. The account-paid mint keeps Ogmios: its draft is public-account data, and a public UTxO may carry a reference script the evaluator doesn't take yet. |
| 6 | Low | **Lovejoin's withdraw delays used `Math.random`**, whose state can be worked out from its outputs. The delay is what keeps a withdraw from being matched to its deposit. | `secureRandom()`: 53 bits from `crypto.getRandomValues`. |
| 7 | Low | **Content scripts could read `chrome.storage.local`** (Chrome's default), which holds the sealed vault and the unsealed settings. The connector's bridge runs in every site's renderer. | The worker sets local and session storage to `TRUSTED_CONTEXTS` at every start. The call is checked on Chrome 153; an older Chrome that refuses it keeps the default. |
| 8 | Low | **A connected site could hang the worker.** The CBOR reader read past the end of what a site passed to `submitTx` or `signTx`, and `84bf` looped forever. | Every read is bounded: a length or count longer than what's left throws. `tests/cbor.test.ts`. |
| 9 | Low | **dApp approval ids were a count that started again with the worker.** A window still showing an old request 1 could answer a new one. | `crypto.randomUUID()`. |
| 10 | Low | **Two connects from one site** (two tabs, or `enable()` twice) could leave it on the public account after the user had funded a private session for it. | Funding is refused once the site is connected, both at build and at send. |
| 11 | Info | **Randomness and the key were used where nothing needed them.** Sizing an output drew two random scalars and did three multiplications a call. A Lovejoin withdraw's first, thrown-away build was proven with the Seedelf key. | A fixed register for sizing (every datum is the same size), and a fixed stand-in proof. |
| 12 | Info | **Secret wipes could be optimized away.** Plain `fill(0)` and assignment before a free are dead stores to the compiler. | `zeroize` for the scalar on `free()`, the rebuilt phrase, the BIP39 seed, and the HKDF and one-time key material. `bip39`'s `zeroize` feature wipes its mnemonics. |

## Checked and fine

- **Randomness:** `getrandom`'s `js` backend (`crypto.getRandomValues`), and a failure throws rather than yielding zeros. The places it's drawn:
  - 32 bytes of phrase entropy;
  - a full-size re-randomization scalar per output, the same `d` on both points;
  - a 32-byte seed per one-time key;
  - SecretBox's 32-byte salt and 12-byte nonce, fresh per seal;
  - the private store's 24-byte XChaCha nonce per write;
  - Lovejoin's mix scalars, permutations and pool picks. The shuffle's modulo bias is under 2⁻⁵⁵.
- **Nonces:**
  - Lovejoin's Schnorr and sigma-OR proofs use RFC 6979 deterministic nonces over everything the challenge binds. A simulated branch's challenge and response are indistinguishable from the real one's.
  - The Seedelf proof binds the one-time key's hash (the rollback-replay rule).
  - A merged return's proofs bind a fresh one-time key, never the session key a site can ask to sign.
- **Derivation:** the frozen v1 derivation is unchanged; wiping doesn't change outputs, and the vectors pass. The one-time key is HKDF(scalar, fresh seed), so the seed alone gives nothing.
- **Vault and records:**
  - SecretBox binds its whole header as associated data. Changing the password reseals under a fresh salt.
  - The private store's key is its own HKDF domain, zeroed after each use.
  - The password check is the AEAD tag. The back-off is enforced in the worker.
  - The phrase check compares in constant time.
- **Boundaries:**
  - Messages need the extension's id and origin. The dApp port needs a tab and an https or localhost origin taken from Chrome.
  - No `externally_connectable` and no `web_accessible_resources`.
  - The CSP allows no other script.
  - No `console` output, and no key material in errors.
  - CIP-8 signs a `Sig_structure`, so a site's message can never be a transaction signature.
- **Lock:** it frees all three key objects in WebAssembly (the Cardano keys wipe themselves) and clears session storage.

## Kept as it is

1. **The vault's KDF matches Lace** (the user's call, 2026-09-25: "match what Lace does").
   - It's Argon2id with m = 19456 KiB, t = 2, p = 1, which is OWASP's minimum. Lace's `packages/lib/core/src/secret-box/kdf.ts` has exactly these values.
   - A stolen profile allows guesses on the order of 10⁴ a second per GPU (each takes about 76 MiB of memory traffic).
   - Stronger parameters would need an `SBV2` magic and a reseal at the next unlock.

## Not fixed: for later

1. **The entropy stays in `chrome.storage.session` while unlocked.** That is what lets a restarted worker stay unlocked.
   - Any extension page can read it. There's no store only the worker can read.
   - The CSP and the fix above leave only the wallet's own pages able to see it.
   - Changing this means asking for the password after every idle worker restart.
2. **The same session index on preprod and mainnet is the same key.** The derivation is frozen, and nothing is on mainnet yet.
   - Keeping each network's indexes apart (the probe asking the other network too, or split ranges) would stop testnet activity linking to mainnet sessions.
3. **Smaller items:**
   - Caches that survive a lock: the session reads' times and seen UTxOs, and the connector's refused-until times.
   - The password isn't Unicode-normalized, so the same password typed on another keyboard could fail.
   - The Minswap aggregator is trusted for the order it builds: `withinFunding` bounds the amount, not the receiver.
