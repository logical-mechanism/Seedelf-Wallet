# Seedelf Messaging v1: security notes

What the crate guarantees, under which assumptions, and what it doesn't. Unaudited. Seedelf Messaging is outside the bug bounty ([SECURITY.md](../../../SECURITY.md)), except a flaw in it that exposes the Seedelf key.

**A test on preprod, for now** (the owner, 2026-11-24). The Seedelf Wallet opens Messages on preprod only: on mainnet its Messages page has no switch, and nothing of mainnet's reaches the relay. That doesn't keep mainnet funds out of the test. The Seedelf key comes from the recovery phrase and an account index alone, so one phrase has the same key on preprod and on mainnet, and Messages reads and writes with that key ([joint-security.md](joint-security.md) lists every use of it). A flaw here that nobody has found yet, if it exposed the key, would expose the key that holds that phrase's mainnet funds. And two things reach mainnet with no flaw at all: a first message hands its reader a register of the writer's key (protocol.md §11), and the wallet contract is the same on both networks, so a reader on preprod can pay that register on mainnet, alone or added to a mainnet Seedelf's register, and learn from what the writer's mainnet wallet spends which mainnet spends, and which mainnet Seedelf, are the preprod writer's; and the scan matches any register of the key and names no network, so an envelope sealed to a mainnet Seedelf's on-chain register and posted to preprod's pool is one the wallet takes in, and the timing tests (protocol.md §11) reach mainnet Seedelfs too. So the test is for a wallet that isn't a mainnet wallet: the Messages page says so, and nothing enforces it. And the formats, with what the relay's v1 routes take and answer, are frozen only from the release that opens Messages on mainnet ([protocol.md](protocol.md) §20): until then a review's finding may still change them, and preprod's conversations and its pool may then be reset.

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
- Byte-for-byte agreement with an independent implementation (noble-curves and WebCrypto), before call 16 re-recorded the vectors with the tag in w's place, and again since, by another model's harness written from the spec and the vector files alone (2026-11-23 and 2026-11-24; construction.md §4.5).
- No secret in an envelope's bytes or in a key's `Debug`.

The tests don't establish, and can't:
- Confidentiality (IND-CCA2).
- Unlinkability.
- Constant-time behaviour.
- The quality of the operating system's randomness.
- The joint security of the Seedelf key and Messages' key, and of the certificate between them ([joint-security.md](joint-security.md) argues it).

Those rest on the arguments and assumptions below.

## Assumptions

- **CDH is hard in G1,** and gap-DH for chosen-ciphertext security: confidentiality.
- **DDH is hard in G1 (XDH):** unlinkability.
- **HKDF-SHA256 is a good KDF,** modelled as a random oracle in the proofs cited.
- **AES-256-GCM is a secure AEAD.**
- **The operating system's generator is sound.**
- **blst's scalar multiplication is constant-time in the scalar,** as blst documents. This crate doesn't verify it.
- **The timing of a wallet's requests isn't hidden** from the relay or from the server it reads the chain through (the owner, 2026-11-24): they see when a wallet asks and how often, and Messages doesn't claim otherwise. What the Seedelf Wallet does so that its requests keep their times whatever its envelopes hold is what it does, not a guarantee, with its stated limits in the wallet's privacy.md. Content, the keys and the recovery phrase aren't in this assumption, and neither is timing that depends on a key, the WebAssembly module's work with x_m or x: that stays in scope (*Before production*).
- **Whether the module's time depends on the key was measured, not proved** (2026-11-24). dudect's method (a fixed class against random ones, Welch's t, the bar |t| > 4.5) in Node 24's V8, on one desktop and one pinned core, over the scan, a proof, an open, a first-contact receive, and keys of a shape (few bits set, leading zeros): no test of the key crossed the bar, where the smallest dependence it could have seen was about 140 ns in one scan of about 0.71 ms, about 85 ns in one multiplication and about 0.2 ns a bit. The multiplication is blst's portable C path on wasm32 (GLV, 5-bit windows, the table read whole under a mask): in the built module its loops are counted and nothing branches on a key digit. One effect was found, and it's of public bytes: a repeated point in an envelope makes the scan about 0.3 µs faster, whatever the key. Not covered: Chrome's worker, the engine's compiled machine code, a native constant-time tool, the Rust side's SHA-2, HMAC, HKDF and AES-GCM read as WebAssembly, and session messages after first contact, a start, an accept, the reveal and the derivation at unlock.

## The ten properties

1. **Recipient confidentiality.**
   - ECIES-KEM with an AEAD is IND-CCA2 in the random-oracle model under gap-DH (Shoup's analysis for ISO 18033-2; Abdalla, Bellare and Rogaway for DHIES).
   - v1 differs in two ways: each envelope's base p is the sender's own re-randomization of g, and p and w's tag, so w, are bound into the key derivation (construction.md §4.3). Any well-formed (p′, w′) a querier can make for the recipient is [b′](g, v), and [y]c′ is then the same Diffie–Hellman value standard ECIES computes with key (g, v). So the standard argument should carry over. It isn't written out here.
2. **Discovery privacy.**
   - Headers say nothing a relay can use about recipients (3).
   - A relay does see what each client downloads and when. Downloading everything hides interest; downloading selectively doesn't.
   - Scanning costs one scalar multiplication per header after parsing (README, "Measured performance").
3. **Register unlinkability.** Under XDH, no one without y can tell whether two envelopes go to the same recipient, or link an envelope to a known register. That holds except for:
   - **The sender,** who knows b.
   - **A public G2 multiple of y,** such as [y]h (construction.md §2).
   - **Metadata:** timing, the network, and the plaintext's length, since the envelope is 145 + |m| bytes with no padding.
   - **Datum registers:** when the recipient's register is a Seedelf datum, the sender knows which Seedelf they wrote to.
   - **A reaction to a sum of registers.** (g₁ + g₂, v₁ + v₂) is a register of y exactly when both (g₁, v₁) and (g₂, v₂) are. So any visible reaction to a bare v1 envelope addressed to the sum, such as a reply, links the two, and so does one to an envelope addressed to a second register of y. Seedelf's own registers share the property. The session layer closes it for messages ([protocol.md](protocol.md) §2, §3):
     - a first message proves its base comes from the one handle it names;
     - it proves its writer knows the key, on that base, of every other point the reader's key meets in it (E_A, A and the first ratchet key), so none can be built on another register's generator;
     - every message of a request carries the first's ratchet key;
     - every envelope is bound to its conversation identity, its p and its c both.

     And no session envelope holds a register of its reader's key, so no payment can be aimed at one to watch who spends it (construction.md §4.3).

   The model states the property symbolically for the bare envelope, by observational equivalence ([model/](../model/README.md), *Unlinkability*): no attacker without y tells envelopes to one recipient from envelopes to one and another, or envelopes to a known register from envelopes to a key no one holds. It was proved with w in the header, and again with the tag of w that call 16 puts there (2026-11-23). There DDH holds by construction, so it's no substitute for the XDH argument (*Before production*). It also states the binding: a reader takes no first message aimed at another of its handles, whichever of its points is aimed there, unless its own key was stolen first, and the writer takes no reply aimed at one of its handles at all; without each check it would (*The outer envelope*). Before call 16 that lemma watched only the envelope's p; with call 16's checks it watches every point, and it and its controls ran as they must (2026-11-23).
4. **Secret-key compromise.** y reads every envelope ever sent to any of its registers, past and future. In the Seedelf Wallet y is Messages' own key x_m, which spends nothing (*Two keys*, below).
5. **Ciphertext integrity.** A change to any byte is rejected (AEAD, with the header bound). That's integrity against third parties, not proof of who sent it: anyone with the recipient's register can make an envelope that opens.
6. **Recipient key substitution.**
   - An envelope can't be redirected: opening needs y, and re-addressing needs the plaintext.
   - A relay can't swap in another register of the same recipient, because it's bound.
   - A sender can always encrypt the same plaintext to someone else.
7. **Replay.** An envelope can be replayed verbatim and opens again. Nothing in v1 is a timestamp, a counter or a message ID. A recipient can drop duplicates by the envelope's hash; Phase 2 decides where.
8. **Sender authentication.** None in the bare envelope. Envelopes are anonymous, and a "from" written in the plaintext proves nothing.
   - **When added,** it must bind both parties and the header: for instance a signature over H and the recipient's register, inside the ciphertext, or an authenticated KEM such as HPKE's Auth mode. That avoids surreptitious forwarding and unknown-key-share. Neither arises in the bare envelope, because no identity is claimed.
   - **The session layer adds it** ([protocol.md](protocol.md) §3): the static DH in the session secret shows the writer holds its identity's key, and both sides' identities are in every message's associated data. A first message's two proofs, that its base comes from the named handle and that its writer knows the keys the reader's key meets, are designated-verifier: they convince the reader, who could have made them, and no one else, while the writer's random source was sound when it made them (*The verified reveal*, below, has the condition).
   - **Behaviour that reveals whether an envelope opened** (auto-replies, read receipts, fetch patterns) is an oracle. With every point checked it reveals nothing of y, but it does reveal that the envelope was the recipient's: a discovery-privacy leak. The session layer's rules leave a writer no reaction that depends on a register other than the conversation's: every point the reader's key meets is bound first (protocol.md §2).
9. **Forward secrecy.** None. y is static, so a later compromise reads earlier messages. Ratchets or one-time prekeys are later work.
10. **Cross-protocol key reuse.** The labels name the protocol, the version and the purpose, and the shared point is only ever the KDF's input (construction.md §4.3). The Seedelf key's one use in Messages, the certificate, is below.

## Two keys: spending and reading

Since chunk 55 (the owner, 2026-11-26) Messages reads and writes with a key of its own, x_m, one per network, derived from the wallet's recovery phrase beside the Seedelf key x (protocol.md §21.2). x spends. For Messages it makes one thing: the certificate that binds a Seedelf to its messaging register M_S = (h_S, [x_m]h_S), whose base is a hash of the Seedelf (protocol.md §21.3, §21.4). Before chunk 55, x read too: one key for spending and reading (the owner, 2026-11-20), argued in joint-security.md as it was at commit c096eab9. tests/seedelf_registers.rs still shows the envelope's formats and algebra line up with any register of a key, as Phase 1 found.

**x_m's uses:** reading, discovery, the handshake's Diffie–Hellman, the keys proof, the verified reveal, the certificate's other half, and the withdrawal. **x's, in Messages:** the certificate's x half alone. Its other uses are the wallet's: spending proofs, Lovejoin's owner proofs and the one-time signing keys.

**Joint security: [joint-security.md](joint-security.md).** It lists every use of each key in the code, the rules each must keep, and a theorem with its proof, game by game, extending Degabriele, Lehmann, Paterson, Smart and Strefler's Theorem 2 (ECIES-KEM and EC-Schnorr on one key, CT-RSA 2012), in the random-oracle model under gap assumptions:
- **the funds** reduce to the discrete log of x with only a decision oracle, against an attacker that holds x_m;
- **x_m stays secret** on the same terms, against one that holds x. The one-key version's static Diffie–Hellman step is gone, since the base a writer starts on is a hashed point (its §7.4);
- **the messaging half** is conditional on reductions not written yet.

It's AI review, not an audit: its outside review is below, under "Before production". It also says how far Seedelf now keeps NIST SP 800-56A's rule against one key pair for signatures and key establishment.

**What it means in practice:**
- **A flaw in Messages can't spend funds.** x_m spends nothing: the funds scan never tests a register against it, and it makes no spending or Lovejoin proof and no one-time key (protocol.md §21.6; joint-security.md, rule 8). Funds sent to a register of x_m are stranded: the wallet never finds or spends them.
- **What a thief of x_m gets** (protocol.md §1.1): the messages sealed to it, up to forward secrecy, the power to pose as the wallet, and the power to pose to its owner as anyone, a "Verified ⟨Seedelf⟩" reveal included, which could mislead the owner into a payment. Never funds.
- **What a thief of x gets:** the funds, and the power to certify a messaging register of its own for the wallet's Seedelfs, so that later first messages go to it, or, beside the wallet's certificate, to no one (protocol.md §21.5). Not the messages sealed to x_m, which isn't derived from x.
- **Whatever reads can write and pose, but not spend.** There's still no read-only delegation inside Messages: a scanning-only key would be a third key.
- **Decryption sits next to the messaging key.** Any oracle on [x_m]·(an attacker's point), beyond what ECIES allows, would be an oracle on x_m. The subgroup, identity and canonical-encoding checks are what make that safe. They're mandatory, and the tests hold them. joint-security.md's rule 1m lists every place x_m meets a point someone else chose, and its rule 1 the few places x does.
- **Both keys live in one WebAssembly module,** so a bug that reads its memory reaches both (protocol.md §21.1).
- **Anyone can message any Seedelf with a certificate,** since the list of them is public. Spam is the relay's concern: proof of work priced by traffic, which a GPU can outpay, and a cap on what one address has in the pool (protocol.md §17.4), which a sender with many addresses can get around. Readers with many addresses can also hold the relay's places in flight and spend its day of traffic by asking alone: the edge's totals keep that from the data layer's other routes, but Messages has no fallback (protocol.md §17.2, §17.5).
- **A new derivation, beside the frozen v1:** x_m's, seedelf-crypto's `messaging_key_v1`. v1 stays as it is.

## Implementation notes

- **`SecretKey`** has no `Clone`, no `PartialEq` and no byte export, and its `Debug` prints `SecretKey(..)`. Its bytes are wiped on drop. Copies inside blst and stack temporaries aren't, so wiping is best effort.
- **The shared point, key and nonce** live in `Zeroizing` buffers.
- **No unsafe code:** `#![forbid(unsafe_code)]`.
- **No panics on untrusted input.** Two `expect`s guard invariants that no input reaches: a stored key is canonical, and HKDF's output length is a constant.
- **Randomness** is the operating system's (`OsRng`), with zero scalars redrawn. The scalars the key's safety rests on aren't drawn alone: the writer's b is HMAC-SHA-512 keyed by x_m over 32 drawn bytes, the handle and F's head (it has no challenge); the reveal's nonce, the base proof's k, the keys proof's k_e, k_s and k₁ (k₁ keyed by x_m), the certificate's k_m and k_x, and the withdrawal's k are each HMAC-SHA-512 over 32 drawn bytes and everything its challenge covers; and the envelope's o and r are HKDF of the message key and the salt (protocol.md §16.2, §19.2; joint-security.md, rule 2). The three proofs' simulated c₂ and z₂ are drawn alone: the key doesn't rest on them, and deniability does (*The verified reveal*). A conversation's ID, its ephemeral and ratchet keys and each send's salt are drawn alone too. So the wallet refuses a start, a start again or a continuation whose conversation ID it already holds: a random source that repeated would otherwise make the first conversation again, and seal two texts under one AES-GCM key and nonce (joint-security.md §9, which says what that guard can't see).
- **Order of checks:** the scan (`matches_envelope`) checks p before y touches it, then compares SHA-256(`…|envelope|tag` ‖ [y]p) with the envelope's tag in constant time, and the full parse checks c before [y]c. y never touches an unchecked point. An envelope that isn't the reader's never has c checked, which saves a subgroup check on each (README, "Measured performance").

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

- **Vectors** for every layer: F with its two proofs and stamp, SK, both inits, every chain and message key, ENCRYPT, the envelope's two scalars, the padding, the inner messages and the envelopes. An implementation written from protocol.md §16 alone, without reading the Rust (noble-curves and WebCrypto), reproduced them byte for byte before call 16 re-recorded them. The re-recorded files were reproduced on 2026-11-23, and on 2026-11-24 as they are now with §9's padding, by another model's harness written from protocol.md, construction.md and the files alone. Not reproduced: the reveal file's stored states, the exact bytes of a few checks and posts, whose results are confirmed, and a session message at a size's edge, which the file doesn't have (protocol.md §16.6).
- **Handles stay unlinkable through replies** (calls 12 and 13): src/session/tests/linking.rs aims an honest message's envelope at a reader's second handle and at the sum of two, and builds a base on the sum, and each is refused with nothing kept. The first-contact stamp is checked before the proof and any key.
- **protocol-review.md §E's 14 adversarial cases,** one test each: src/session/tests/adversarial.rs, with cases 4 and 5 in tests/simulation.rs.
- **Every rule of §3 to §6 is load-bearing in the tests:** a mutation pass removed or weakened each rule in turn, 39 of them, and a test failed every time. Calls 12 and 13's 21 rules had their own pass (2026-11-21). One survived at first, a stored request replayed after a restart, and a test now holds it. Both passes predate call 16, whose rules have had passes of their own (protocol.md §16.6).
- **Properties:** any schedule of sends, out-of-order deliveries, duplicates, losses and restarts reads each message once, changes nothing on a duplicate, and counts exactly the lost messages it skipped as missing.
- **A two-wallet simulation** over a relay that keeps envelopes 36 hours, with the worker killed at every point of §4.2 and locks past 36 hours. No message shows twice, no message key seals two envelopes, every refusal is explained, the missing counts are exact, and the conversation is still live at the end.
- **Stored states,** requests and tombstones round-trip, and every truncation, extension and unknown version is refused.

### What they don't

- **Secrecy, forward secrecy, recovery and authentication** rest on the Double Ratchet's and X3DH's analyses, adapted here. [The model](../model/README.md) (54b) states them as lemmas and checks them symbolically, within the assumptions its README lists: every lemma was proved before call 16 (2026-11-22), and again with call 16's and the gate's changes (2026-11-24) but for one claim and three traces, as the model's README says: `heal_keys_secret` holds by a run on the model without two actions it doesn't read, and the traces are argued, not checked. The outer envelope has a model of its own beside it: the v1 envelope; the binding of every point the reader's key touches, by the outer scalar's check, the ephemeral point's, the keys proof and the designated-verifier base proof; Bob's replies sealed to R_A; and a kept message key on the wire, proved again with call 16's rules (2026-11-23). That the reader's own key passes each designated-verifier branch is shown for the keys proof (2026-11-24), and for the base proof argued, not checked: that trace's search didn't finish. A symbolic proof says nothing of the primitives' strength, of timing, or of the code: the tests hold the code to §16, and the model holds §16 to its claims.
- **Constant time,** as for the envelope.

### Implementation notes

- **A conversation's secrets** (its root, chain, message and ratchet keys) are wiped on drop, and its `Debug` shows none of them. Copies that a `Vec`'s growth leaves behind, and blst's internals, aren't wiped: best effort, as for `SecretKey`.
- **x_m never enters a stored state.** The responder's RatchetInitBob state holds it only until the first message's ratchet step replaces it, and a test looks for it in the stored bytes.
- **Every operation that can fail works on a copy** and keeps it only on success. Tests compare a state's bytes before and after every refusal.
- **Every point** from an envelope, F or a header is checked before a key touches it. A stored state's points and ratchet key are checked again on reading.
- **No unsafe code, and no panic on untrusted input.** The `expect`s guard fixed output lengths, a ratchet key the crate itself stored, and a receiving chain the step before just made.

## The verified reveal

A Fiat–Shamir OR-proof (Cramer, Damgård and Schoenmakers) that the revealed Seedelf's register and the initiator's identity A share a key (Chaum–Pedersen), or that its maker knows the key of the reader's identity w₀ (protocol.md §19.2). The writer proves the first; the reader holds the second.

**What it proves, to the reader:**
- Whoever holds A's key, so whoever started the conversation (the static DH in SK, protocol.md §3), holds the key of the register it names. The wallet then checks the chain gives the Seedelf's name that register now.
- Nothing about a person: "someone with that Seedelf is writing". Its use is tying a conversation to a Seedelf the reader already knows.

**What it doesn't:**
- **Anything to anyone else, while the writer's random source was sound when it made the proof.** The reader could have made the same proof with its own key, so a reveal it shows others proves nothing: the conversation stays deniable, as Signal's are. Witness indistinguishability makes the writer's proof and the reader's look alike (up to about 3/q: each has three scalars that are never 0, and not the same three). The first message is deniable the same way: its base proof and keys proof each have the reader's key as their other branch, so the reader could have made a whole first message, for any of the writer's public registers (protocol.md §7).
  - **The condition** (found 2026-11-24, [joint-security.md](joint-security.md) §9). The writer simulates the reader's branch with a challenge share c₂ and a response z₂ that it draws from the random source alone, and prints both in the proof. The key doesn't rest on them. Looking alike does. A source that was stuck, repeating or predictable when the proof was made leaves a relation among the printed draws: c₂ = z₂, one c₂ in two proofs, or a c₂ someone predicted. The reader's own proof shows one only with probability about 1/q, since its c₂ is fixed by the hash after its commitments. So anyone can then tell which branch was simulated. A reveal then reads as a plain proof of the Seedelf's key, bound to the conversation, and a first message's keys proof as a plain proof of the writer's key on p₀. What was said stays deniable. protocol.md §7 says what a reader can then show others.
  - **And against the writer's own key.** Whoever later holds it, and can guess the 32 bytes drawn for a proof, can check that proof's derived values, which the reader's own proof wouldn't pass. A sound source leaves those bytes unguessable.
- **Anything after it was checked.** It's checked against a fresh read of the contract, never a view kept from before, but a Seedelf can move to another owner afterwards; the reveal's message keeps the time it came.
- **Anything against a stolen x_B.** A thief of the reader's key makes reveals for any Seedelf, in conversations it starts with the reader: key-compromise impersonation, inherent to designated-verifier proofs and already open through the static DH. Since chunk 55 that key, x_m, spends nothing: the thief has the label alone, which could mislead the reader into a payment (protocol.md §1.1, §19.5).
- **Any link between the writer's Seedelfs.** They share its key, but under DDH no one without it can tell.
- **A plain proof** someone else could check: not built, until users ask for one (protocol.md §7).

**What the tests establish** (src/session/tests/reveal.rs, tests/reveal_vectors.rs):
- Who may make one (the initiator, once a reply has decrypted, for a Seedelf of its own key) and who may check one (the responder), each refusal tested.
- Binding: another conversation of the same keys, another name, another register of the same key, a share or response moved or swapped, and another key's Seedelf proved with the writer's own each fail; so does every single-bit change to a reveal's bytes.
- The reader's own forgery verifies, and one made without its key doesn't.
- Every malformed reveal is refused with its code, the length read first.
- Vectors reproduced byte for byte by an implementation written from protocol.md alone (noble-curves and SHA-256), and again since call 16 but for the file's stored states and the exact bytes of two checks (protocol.md §16.6), and a mutation pass: all 25 of the proof's and parser's rules are load-bearing in the tests.
- The nonce's hedge (protocol.md §19.2): with the random source stuck, one statement gives one proof, and every part of the statement, the simulated branch, the key and the branch gives another nonce. Its own mutation pass and a second clean-room check are in [joint-security.md](joint-security.md) §10.

## Before production

- An external review of the construction and the code.
- Written arguments for IND-CCA2 and for unlinkability, with the per-envelope base. Neither is written yet. What was written out on 2026-11-24 belongs to the next item.
- An outside review of the spending-and-messaging argument, [joint-security.md](joint-security.md), starting from its §7.4.
  - **What exists now:** its arguments for the base proof, the keys proof and the reveal (each one's statement, a simulator, an extractor, and its nonce under a failing random source), and its reduction for the funds, written out by one model and attacked by another (2026-11-24, its §10). Nothing that exposes the key was found. That's AI review by two models: no person has checked it.
  - **And since, the same day:** a proof, inside the algebraic group model, that a start's blinded answer gives an algebraic attacker nothing more, written by one model and attacked by the other, which found its algebra to hold (its §7.3). The attack found one thing in the code, a start repeated under a random source that repeats, guarded since (its §9).
  - **Still open there:** that proof outside its model, and for a handle made of points with no algebraic representation; the game with many wallets; a reduction for any property of Messaging itself (its Part A); and its oracle model (its §7.4).
- **A send's salt, derived.** It's drawn alone, so a random source that repeats, with storage rolled back or wiped, can still seal two texts under one key and nonce (joint-security.md §9). Deriving it from the message key, the drawn bytes and the plaintext isn't built yet. It belongs with the next item's change.
- **The proofs' simulated draws, derived.** Deniability rests on c₂ and z₂, which a writer draws from the random source alone (*The verified reveal*). The fix is to derive them from the prover's key over the statement and 32 drawn bytes, as the nonces are. It isn't built yet. It changes only what a writer does. It would publish values derived from x_m, so it's a new use of x_m, which joint-security.md's inventory and argument take in before it's built (its §9).
- A constant-time review of the WebAssembly build. WebAssembly engines promise nothing about timing.
- An outside review of the protocol, its model (54b), and the reveal's proof: the model checks who could have made one, not the proof's soundness or deniability. Its soundness and its simulation now have a written argument, checked by two models as the item on joint-security.md says, and no further. Its deniability has the condition *The verified reveal* gives.
- The relay's price and window tuned with real use, and a memory-hard puzzle if GPUs flood it (protocol.md §17.4).
- A dependency audit (cargo-audit or cargo-deny) for this crate in CI.
