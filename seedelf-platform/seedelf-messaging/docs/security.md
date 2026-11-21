# Seedelf Messaging v1: security notes

What Phase 1 guarantees, under which assumptions, and what it doesn't. This is a cryptographic foundation, not a messaging protocol: there's no sender authentication, no forward secrecy, no replay protection, no relay and no key distribution yet. Unaudited.

## What the tests establish, and what they don't

The tests are finite, and they show the code does what [construction.md](construction.md) says on the inputs they try:

- The register algebra and the pairing identity, over many random values.
- Round trips for every plaintext kind, up to the 64 KiB limit.
- Refusal of every malformed, non-canonical, off-curve, small-order and identity point in every position, and of zero and out-of-range scalars, as structured errors.
- Rejection of every single-bit change to the header and the ciphertext, of truncation, extension and register swaps, including a swap the recipient still recognizes as theirs.
- No false matches: 10 recipients and 1,000 envelopes in one pool, and in property tests.
- Byte-for-byte agreement with an independent implementation (noble-curves and WebCrypto).
- No secret in an envelope's bytes or in a key's `Debug`.

The tests don't establish, and can't:
- Confidentiality (IND-CCA2).
- Unlinkability.
- Constant-time behaviour.
- The quality of the operating system's randomness.
- The joint security of one key for spending and reading.

Those rest on the arguments and assumptions below.

## Assumptions

- **CDH is hard in G1,** and gap-DH for chosen-ciphertext security: confidentiality.
- **DDH is hard in G1 (XDH):** unlinkability.
- **HKDF-SHA256 is a good KDF,** modelled as a random oracle in the proofs cited.
- **AES-256-GCM is a secure AEAD.**
- **The operating system's generator is sound.**
- **blst's scalar multiplication is constant-time in the scalar,** as blst documents. This crate doesn't verify it.

## The ten properties

1. **Recipient confidentiality.**
   - ECIES-KEM with an AEAD is IND-CCA2 in the random-oracle model under gap-DH (Shoup's analysis for ISO 18033-2; Abdalla, Bellare and Rogaway for DHIES).
   - v1 differs in two ways: each envelope's base p is the sender's own re-randomization of g, and (p, w) is bound into the key derivation. Any well-formed (p′, w′) a querier can make for the recipient is [b′](g, v), and [y]c′ is then the same Diffie–Hellman value standard ECIES computes with key (g, v). So the standard argument should carry over. It isn't written out here.
2. **Discovery privacy.**
   - Headers say nothing a relay can use about recipients (3).
   - A relay does see what each client downloads and when. Downloading everything hides interest; downloading selectively doesn't.
   - Scanning costs one scalar multiplication per header after parsing (README, "Measured performance").
3. **Register unlinkability.** Under XDH, no one without y can tell whether two envelopes go to the same recipient, or link an envelope to a known register. That holds except for:
   - **The sender,** who knows b.
   - **A public G2 multiple of y,** such as [y]h (construction.md §3.4).
   - **Metadata:** timing, the network, and the plaintext's length, since the envelope is 161 + |m| bytes with no padding.
   - **Datum registers:** when the recipient's register is a Seedelf datum, the sender knows which Seedelf they wrote to.
4. **Secret-key compromise.** y reads every envelope ever sent to any of its registers, past and future. With the key reuse chosen for later, it's also the key that spends the Seedelf.
5. **Ciphertext integrity.** A change to any byte is rejected (AEAD, with the header bound). That's integrity against third parties, not proof of who sent it: anyone with the recipient's register can make an envelope that opens.
6. **Recipient key substitution.**
   - An envelope can't be redirected: opening needs y, and re-addressing needs the plaintext.
   - A relay can't swap in another register of the same recipient, because it's bound.
   - A sender can always encrypt the same plaintext to someone else.
7. **Replay.** An envelope can be replayed verbatim and opens again. Nothing in v1 is a timestamp, a counter or a message ID. A recipient can drop duplicates by the envelope's hash; Phase 2 decides where.
8. **Sender authentication.** None. Envelopes are anonymous, and a "from" written in the plaintext proves nothing.
   - **When added,** it must bind both parties and the header: for instance a signature over H and the recipient's register, inside the ciphertext, or an authenticated KEM such as HPKE's Auth mode. That avoids surreptitious forwarding and unknown-key-share. Neither arises today, because no identity is claimed.
   - **Behaviour that reveals whether an envelope opened** (auto-replies, read receipts, fetch patterns) is an oracle. With every point checked it reveals nothing of y, but it does reveal that the envelope was the recipient's: a discovery-privacy leak.
9. **Forward secrecy.** None. y is static, so a later compromise reads earlier messages. Ratchets or one-time prekeys are later work.
10. **Cross-protocol key reuse.** The labels name the protocol, the version and the purpose, and the shared point is only ever the KDF's input (construction.md §4.3). Reusing the Seedelf key is below.

## One key for spending and reading

Later, a Seedelf's own on-chain register is the recipient and the wallet's scalar x reads (the owner, 2026-11-20). Phase 1 changes nothing in the wallet. tests/seedelf_registers.rs shows the formats and the algebra already line up: a datum's register is a recipient, `SecretKey::from_scalar(x)` reads, and seedelf-crypto's `is_owned` agrees.

**One scalar, two uses:**
- **Spending:** Schnorr proofs, z = ρ + c·x with c = blake2b-224(g ‖ [ρ]g ‖ u ‖ vkh).
- **Reading:** ECIES decryption, [x]c.

**Joint security.** Degabriele, Lehmann, Paterson, Smart and Strefler, *On the Joint Security of Encryption and Signature in EMV* (CT-RSA 2012), show EC-Schnorr signatures and ECIES-KEM can share a key pair in the random-oracle model. To be checked against the paper before it's relied on. Seedelf differs in ways the result doesn't cover:
- Bases change per register.
- Proofs are bound to a one-time key hash.
- Proof nonces are hedged with HMAC-SHA-512.
- The two hashes are different functions.

Not proven here.

**What it means in practice:**
- **Whatever reads can spend.** A client or service that scans for a Seedelf holds its spending key, and there's no read-only delegation under this choice. A scanning-only key would have to be a separate key, which means revisiting the choice.
- **Decryption sits next to the spending key.** Any oracle on [x]·(an attacker's point), beyond what ECIES allows, would be an oracle on the spending key. The subgroup, identity and canonical-encoding checks are what make that safe. They're mandatory, and the tests hold them.
- **Compromise of one is compromise of both.**
- **Anyone can message any Seedelf,** since its register is public. Spam is a relay concern (Phase 2).
- **No new derivation:** the wallet's frozen v1 derivation stays as it is.

## Implementation notes

- **`SecretKey`** has no `Clone`, no `PartialEq` and no byte export, and its `Debug` prints `SecretKey(..)`. Its bytes are wiped on drop. Copies inside blst and stack temporaries aren't, so wiping is best effort.
- **The shared point, key and nonce** live in `Zeroizing` buffers.
- **No unsafe code:** `#![forbid(unsafe_code)]`.
- **No panics on untrusted input.** Two `expect`s guard invariants that no input reaches: a stored key is canonical, and HKDF's output length is a constant.
- **Randomness** is the operating system's (`OsRng`), with zero scalars redrawn.
- **Parsing order:** all three points are checked before y is used on any of them. Checking c only after a match would save a third of parsing for envelopes that aren't the reader's; that's a measured optimization for later, not a change to the order of checks against y.

## What ElfTalk taught

ElfTalk (2025) was earlier Register-based messaging. Its review shaped v1:

- **Every point is decompressed with checks.** ElfTalk used `from_compressed_unchecked` on peer keys and ciphertext points: no subgroup check, a small-subgroup leak of the key.
- **No identity in the clear.** ElfTalk's messages carried the recipient's root public value as both `receiver` and `sender`, linking every message to its recipient.
- **Nothing derived from the plaintext is public.** ElfTalk published a hash of the message point, which lets anyone test guesses at short messages.
- **Authenticated encryption.** ElfTalk's masked point had no authentication and was malleable.
- **Full-width scalars.** ElfTalk cut a hash to 64 bits to make its proxy scalar.
- **Errors, not panics,** on every input.

ElfTalk's ratchet and proof-of-work are out of Phase 1's scope. The proof-of-work idea is worth a look for Phase 2's spam limits.

## Before production

- An external review of the construction and the code.
- Written arguments for IND-CCA2 and for unlinkability, with the per-envelope base.
- The spending-and-reading argument, checked against the literature.
- A constant-time review of the WebAssembly build. WebAssembly engines promise nothing about timing.
- Plaintext padding to fixed sizes.
- Replay handling, sender authentication and forward secrecy, each as a design, not a patch.
- Spam and resource limits at the relay.
- A dependency audit (cargo-audit or cargo-deny) for this crate in CI.
