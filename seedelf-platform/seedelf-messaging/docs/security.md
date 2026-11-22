# Seedelf Messaging v1: security notes

What the crate guarantees, under which assumptions, and what it doesn't. Unaudited. Seedelf Messaging is outside the bug bounty ([SECURITY.md](../../../SECURITY.md)), except a flaw in it that exposes the Seedelf key.

- **The v1 envelope** (Phase 1, most of this file) is a cryptographic foundation. On its own it has no sender authentication, no forward secrecy and no replay protection.
- **The session layer** (chunk 54's 54a: [protocol.md](protocol.md) §3 to §6, exact in §16) builds those on it: conversations, the Double Ratchet, and the rules for replays, requests and continuations. What each compromise reveals is protocol.md §1.1. What its tests establish is [below](#the-session-layer).
- **The verified reveal** (54f, [protocol.md](protocol.md) §19) lets the side that wrote first show the other one of its Seedelfs, by a designated-verifier proof. What it proves and what it doesn't is [below](#the-verified-reveal).
- The relay is built, in the data layer (54c, protocol.md §17): it checks a post's shape, points and proof of work, and can't read it. There's no key distribution beyond a Seedelf's public register. The protocol is modelled in Tamarin: [model/](../model/) (54b).

## What the tests establish, and what they don't

The tests are finite, and they show the code does what [construction.md](construction.md) says on the inputs they try:

- The register algebra, over many random values.
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
- The joint security of one key for spending and reading ([joint-security.md](joint-security.md) argues it).

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
   - **A public G2 multiple of y,** such as [y]h (construction.md §2).
   - **Metadata:** timing, the network, and the plaintext's length, since the envelope is 161 + |m| bytes with no padding.
   - **Datum registers:** when the recipient's register is a Seedelf datum, the sender knows which Seedelf they wrote to.
   - **A reaction to a sum of registers.** (g₁ + g₂, v₁ + v₂) is a register of y exactly when both (g₁, v₁) and (g₂, v₂) are. So any visible reaction to a bare v1 envelope addressed to the sum, such as a reply, links the two, and so does one to an envelope addressed to a second register of y. Seedelf's own registers share the property. The session layer closes it for messages: a first message proves its base comes from the one handle it names, and every envelope is bound to its conversation identity ([protocol.md](protocol.md) §2).
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

**One scalar, many uses:** spending proofs, Lovejoin's owner proofs, the verified reveal, reading, the handshake's Diffie–Hellman, discovery, and the one-time signing keys.

**Joint security: [joint-security.md](joint-security.md).** It lists every use of x in the code, the rules each must keep, and a theorem with its proof, game by game, extending Degabriele, Lehmann, Paterson, Smart and Strefler's Theorem 2 (ECIES-KEM and EC-Schnorr on one key, CT-RSA 2012). It's argued in the random-oracle model under gap assumptions. One step, starting a conversation, needs a static Diffie–Hellman assumption, for answers the attacker only ever sees blinded (its §7.3). One gap is open: the writer's b is drawn from the random source alone, so a failing source unblinds them (its §9). The messaging half is conditional on reductions not written yet. Unaudited: its outside review is below, under "Before production". It also says why we depart from NIST SP 800-56A's rule against one key pair for signatures and key establishment.

**What it means in practice:**
- **Whatever reads can spend.** A client or service that scans for a Seedelf holds its spending key, and there's no read-only delegation under this choice. A scanning-only key would have to be a separate key, which means revisiting the choice.
- **Decryption sits next to the spending key.** Any oracle on [x]·(an attacker's point), beyond what ECIES allows, would be an oracle on the spending key. The subgroup, identity and canonical-encoding checks are what make that safe. They're mandatory, and the tests hold them. joint-security.md's rule 1 lists every place x meets a point someone else chose.
- **Compromise of one is compromise of both.**
- **Anyone can message any Seedelf,** since its register is public. Spam is the relay's concern: proof of work priced by traffic, which a GPU can outpay, and a cap on what one address has in the pool (protocol.md §17.4), which a sender with many addresses can get around.
- **No new derivation:** the wallet's frozen v1 derivation stays as it is.

## Implementation notes

- **`SecretKey`** has no `Clone`, no `PartialEq` and no byte export, and its `Debug` prints `SecretKey(..)`. Its bytes are wiped on drop. Copies inside blst and stack temporaries aren't, so wiping is best effort.
- **The shared point, key and nonce** live in `Zeroizing` buffers.
- **No unsafe code:** `#![forbid(unsafe_code)]`.
- **No panics on untrusted input.** Two `expect`s guard invariants that no input reaches: a stored key is canonical, and HKDF's output length is a constant.
- **Randomness** is the operating system's (`OsRng`), with zero scalars redrawn.
- **Order of checks:** the scan (`matches_envelope`) checks p and w before y touches p, and the full parse checks c before [y]c. y never touches an unchecked point. An envelope that isn't the reader's never has c checked, which saves a subgroup check on each (README, "Measured performance").

## What ElfTalk taught

ElfTalk (2025) was earlier Register-based messaging. Its review shaped v1:

- **Every point is decompressed with checks.** ElfTalk used `from_compressed_unchecked` on peer keys and ciphertext points: no subgroup check, a small-subgroup leak of the key.
- **No identity in the clear.** ElfTalk's messages carried the recipient's root public value as both `receiver` and `sender`, linking every message to its recipient.
- **Nothing derived from the plaintext is public.** ElfTalk published a hash of the message point, which lets anyone test guesses at short messages.
- **Authenticated encryption.** ElfTalk's masked point had no authentication and was malleable.
- **Full-width scalars.** ElfTalk cut a hash to 64 bits to make its proxy scalar.
- **Errors, not panics,** on every input.

ElfTalk's ratchet and proof-of-work are out of Phase 1's scope. The proof-of-work idea is worth a look for Phase 2's spam limits.

## The session layer

### What its tests establish

- **Vectors** for every layer: F with its proof and stamp, SK, both inits, every chain and message key, ENCRYPT, the outer scalar, the padding, the inner messages and the envelopes. An implementation written from protocol.md §16 alone, without reading the Rust (noble-curves and WebCrypto), reproduced them byte for byte.
- **Handles stay unlinkable through replies** (calls 12 and 13): src/session/tests/linking.rs aims an honest message's envelope at a reader's second handle and at the sum of two, and builds a base on the sum, and each is refused with nothing kept. The first-contact stamp is checked before the proof and any key.
- **protocol-review.md §E's 14 adversarial cases,** one test each: src/session/tests/adversarial.rs, with cases 4 and 5 in tests/simulation.rs.
- **Every rule of §3 to §6 is load-bearing in the tests:** a mutation pass removed or weakened each rule in turn, 39 of them, and a test failed every time. Calls 12 and 13's 21 rules had their own pass (2026-11-21). One survived at first, a stored request replayed after a restart, and a test now holds it.
- **Properties:** any schedule of sends, out-of-order deliveries, duplicates, losses and restarts reads each message once, changes nothing on a duplicate, and counts exactly the lost messages it skipped as missing.
- **A two-wallet simulation** over a relay that keeps envelopes 36 hours, with the worker killed at every point of §4.2 and locks past 36 hours. No message shows twice, no message key seals two envelopes, every refusal is explained, the missing counts are exact, and the conversation is still live at the end.
- **Stored states,** requests and tombstones round-trip, and every truncation, extension and unknown version is refused.

### What they don't

- **Secrecy, forward secrecy, recovery and authentication** rest on the Double Ratchet's and X3DH's analyses, adapted here. [The model](../model/README.md) (54b) states them as lemmas and checks them symbolically, within the assumptions its README lists: every lemma but four on how a continuation is labelled is proved. A symbolic proof says nothing of the primitives' strength, of timing, or of the code: the tests hold the code to §16, and the model holds §16 to its claims.
- **Constant time,** as for the envelope.

### Implementation notes

- **A conversation's secrets** (its root, chain, message and ratchet keys) are wiped on drop, and its `Debug` shows none of them. Copies that a `Vec`'s growth leaves behind, and blst's internals, aren't wiped: best effort, as for `SecretKey`.
- **x never enters a stored state.** The responder's RatchetInitBob state holds it only until the first message's ratchet step replaces it, and a test looks for it in the stored bytes.
- **Every operation that can fail works on a copy** and keeps it only on success. Tests compare a state's bytes before and after every refusal.
- **Every point** from an envelope, F or a header is checked before a key touches it. A stored state's points and ratchet key are checked again on reading.
- **No unsafe code, and no panic on untrusted input.** The `expect`s guard fixed output lengths, a ratchet key the crate itself stored, and a receiving chain the step before just made.

## The verified reveal

A Fiat–Shamir OR-proof (Cramer, Damgård and Schoenmakers) that the revealed Seedelf's register and the initiator's identity A share a key (Chaum–Pedersen), or that its maker knows the key of the reader's identity w₀ (protocol.md §19.2). The writer proves the first; the reader holds the second.

**What it proves, to the reader:**
- Whoever holds A's key, so whoever started the conversation (the static DH in SK, protocol.md §3), holds the key of the register it names. The wallet then checks the chain gives the Seedelf's name that register now.
- Nothing about a person: "someone with that Seedelf is writing". Its use is tying a conversation to a Seedelf the reader already knows.

**What it doesn't:**
- **Anything to anyone else.** The reader could have made the same proof with its own key, so a reveal it shows others proves nothing: the conversation stays deniable, as Signal's are. Witness indistinguishability makes the writer's proof and the reader's look alike (up to about 2/q: drawn scalars are never 0).
- **Anything after it was checked.** It's checked against a fresh read of the contract, never a view kept from before, but a Seedelf can move to another owner afterwards; the reveal's message keeps the time it came.
- **Anything against a stolen x_B.** A thief of the reader's key makes reveals for any Seedelf, in conversations it starts with the reader: key-compromise impersonation, inherent to designated-verifier proofs and already open through the static DH. That key spends the Seedelf too.
- **Any link between the writer's Seedelfs.** They share its key, but under DDH no one without it can tell.
- **A plain proof** someone else could check: not built, until users ask for one (protocol.md §7).

**What the tests establish** (src/session/tests/reveal.rs, tests/reveal_vectors.rs):
- Who may make one (the initiator, once a reply has decrypted, for a Seedelf of its own key) and who may check one (the responder), each refusal tested.
- Binding: another conversation of the same keys, another name, another register of the same key, a share or response moved or swapped, and another key's Seedelf proved with the writer's own each fail; so does every single-bit change to a reveal's bytes.
- The reader's own forgery verifies, and one made without its key doesn't.
- Every malformed reveal is refused with its code, the length read first.
- Vectors reproduced byte for byte by an implementation written from protocol.md alone (noble-curves and SHA-256), and a mutation pass: all 25 of the proof's and parser's rules are load-bearing in the tests.
- The nonce's hedge (protocol.md §19.2): with the random source stuck, one statement gives one proof, and every part of the statement, the simulated branch, the key and the branch gives another nonce. Its own mutation pass and a second clean-room check are in [joint-security.md](joint-security.md) §10.

## Before production

- An external review of the construction and the code.
- Written arguments for IND-CCA2 and for unlinkability, with the per-envelope base.
- An outside review of the spending-and-messaging argument, [joint-security.md](joint-security.md), starting from its §7.4.
- A constant-time review of the WebAssembly build. WebAssembly engines promise nothing about timing.
- An outside review of the protocol, its model (54b), and the reveal's proof, which the model doesn't cover.
- The relay's price and window tuned with real use, and a memory-hard puzzle if GPUs flood it (protocol.md §17.4).
- A dependency audit (cargo-audit or cargo-deny) for this crate in CI.
