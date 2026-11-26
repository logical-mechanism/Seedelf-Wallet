# Chunk 55 · The messaging key

**Status: 🚧 55a, the argument and the spec** (`web-wallet/messaging-key-spec`): protocol.md §21 specifies the key, the hashed base and the certificate, joint-security.md argues the two keys, and both were reviewed and attacked (2026-11-26); nothing is built. The plan was written 2026-11-26 on `web-wallet/messaging-key` from `main` (828cf7db) and merged as #418. **1.10.0 waits on it:** chunk 54's gate (54g) resumes for the release once this chunk's own gate (55h) is done. Each step gets its own branch, `web-wallet/messaging-key-<step>`, and its own PR from `main`, as chunk 54's steps do.

**The idea** came from a suggestion the owner pasted from ChatGPT (2026-11-26): "Maintain a single Seedelf identity while deriving independent spending and messaging secrets from the same recovery phrase using domain-separated HKDF. The spending secret authorizes the messaging public register through a domain-separated Schnorr proof that binds the messaging register to the Seedelf identity, network, and protocol version." It's chunk 54's call 21, the messaging-only key, with the binding made by a signature instead of a second Seedelf, so the handle stays one name.

**What the owner said (2026-11-26):**
- Why: "an honest reality is we have no money for human audits. If fable 5.2 cant find it then what can we really do about it"
- On 1.10.0 waiting: "I rather have that 1.10.0 be as safe as possible. This is the big feature we are building and waiting on it is ok. No one has found any bugs with the existing code base."
- "Then users who use preprod on the mainnet cant get into trouble and it would be in my opinion even safer to use on mainnet."
- "this seems like it perserves the ux ui I want but removes the issue with key sharing, besides the memory level bugs that we just have to hunt for when doing reviews after this work."
- On the public list and spam: "Right now that spam attack exists and having a list of seedelfs that message is just the same thing but focused."
- On when a certificate is made: "for max safety, a seedelf user that wants messaging needs to create that cert. It could happen when a user turns messaging on, since its off my default. Then if it exists just use it else create teh cert then start messaging."

**The specification stays [protocol.md](../../../seedelf-messaging/docs/protocol.md),** with [construction.md](../../../seedelf-messaging/docs/construction.md), [security.md](../../../seedelf-messaging/docs/security.md) and [joint-security.md](../../../seedelf-messaging/docs/joint-security.md). This plan says what changes, in what order, and what's the owner's to decide. joint-security.md is rewritten first (55a), as the root [CLAUDE.md](../../../../CLAUDE.md) asks of any change to the Seedelf key's uses.

**The marks:**
- **[code]:** read in this repository.
- **[choice]:** a call this plan makes, which the owner can overturn.
- **[measure]:** a figure only a prototype gives.
- **[assumed]:** nothing here proves it.

## The goal

- **One handle, two keys.** A Seedelf stays the one name to pay and to message. Messages reads and writes with a key of its own, x_m, derived from the phrase beside the Seedelf key x. For Messages, x signs one thing: a certificate naming x_m's register for a Seedelf.
- **A flaw in Messages' cryptography then can't spend funds.** Every use of a key on a stranger's input moves to x_m: the scan, the handshake's Diffie–Hellman, the keys proof and the reveal. So the static-DH oracle that joint-security.md §7.3 argued about is no longer on the key that spends; with the hashed base it's gone from x_m too (joint-security.md §7.4). What an x_m thief still gets is messages, and the power to pose to its owner as anyone, a "Verified" Seedelf included, which could mislead a payment (protocol.md §21.1; Fable's attack, 2026-11-26).
- **With x_m per network,** a flaw found on preprod can't read mainnet's messages either. Call 18's case, a tester using their mainnet phrase, no longer reaches mainnet funds through Messages' math.
- **What it doesn't change:** both keys live in the same WebAssembly module, so a memory-level bug, like the one 1.10.0's second review found at a lock, still reaches both. Those are hunted in review, as the owner said.

## What's already there

- **The key** [code]. x is `seedelf_key_v1_from_entropy(entropy, account)`: HKDF-SHA-256 of the BIP39 seed, salt `seedelf-wallet-v1`, info `seedelf-key` ‖ u32_be(account), 64 bytes reduced mod q. It takes no network, and it's frozen ([derivation.rs](../../../seedelf-crypto/src/derivation.rs), `seedelf_key_v1.json`). The Cardano account is a sibling derivation from the same seed ([keys-and-accounts.md](../keys-and-accounts.md)).
- **The worker hands Messages `keys.seedelf`** [code] (`messaging.ts`, `laneKey`), and every `messaging*` export reaches it through `SecretKey::from_scalar` (joint-security.md §4).
- **x's ten uses** (joint-security.md §4). Messaging's are use 4 (the reveal), 5 (reading), 6 and 6′ (the handshake, continuations), 7's scan tag, and 10 (the keys proof).
- **Handles are (name, register) pairs** this browser made or the user turned on (W8, W12; [architecture.md](../architecture.md), *Seedelf Messaging*). A first message names one in `to` and proves its base re-randomizes it (protocol.md §2, §3).
- **The relay** [code]: seedelf-data's `api/src/messaging/`, a pool per network, kept in memory with a snapshot, stamps priced by traffic, the off switch. It reads no chain (§17).
- **Nothing of Messages has shipped.** v1 can change in place, as call 16 changed it, and a development build's records are refused by their version (protocol.md §0, §20; chunk 54's call 19).

## The design

Each [choice] can be overturned; the owner's calls below list the ones that matter most.

- **x_m, the messaging key.** HKDF-SHA-256 of the BIP39 seed, with its own salt (`seedelf-messaging-v1` [choice]) and info (`seedelf-messaging-key` ‖ u32_be(account) ‖ the network's byte ‖ a generation byte [choice]; protocol.md §21.2), 64 bytes reduced mod q, refused if zero, as v1 is. From the seed, not from x, so it isn't a use of x [choice]. A sibling of the frozen v1, never a change to it, and frozen in its turn when Messages opens on mainnet (chunk 54's call 19).
- **A Seedelf's messaging register.** For a Seedelf S whose datum register is (g_S, u_S), with u_S = [x]g_S: M_S = (h_S, m_S), with m_S = [x_m]h_S, on a hashed base h_S = hash_to_G1(network ‖ N ‖ g_S ‖ u_S) (protocol.md §21.3; 55a's change to call 5). A restore rebuilds it from the chain and the phrase alone.
  - On g_S itself, a Seedelf someone else minted under the key has a generator they built, so turning it on would hand them [x_m]g_S: a static-DH answer on x_m. Nobody chooses a hashed base, so no certificate answers one.
- **S's certificate:** the version, the network, S's name, (g_S, u_S), m_S, a generation (0 [choice], the room rotation needs later), and one proof, under a label of its own, of both keys: x for u_S on g_S, and x_m for m_S on h_S (protocol.md §21.4).
  - x_m's half is the back-signature, so no one can bind someone else's messaging register to their own Seedelf.
  - One challenge over everything. Each nonce is derived from its key and everything the challenge covers (joint-security.md, rule 2), and no spending proof's hash function or input is shared (rule 3).
  - A test that the spending verifiers refuse its transcripts, as the reveal has.
  - It's a new use of x, and the only one Messages keeps.
- **A certificate is good only for the register it names,** read from the chain as a first message already reads the handle.
  - A Seedelf moved or removed leaves its certificates naming a register it no longer has, so they stop verifying. That's revocation, from the chain.
  - Replaying an old one needs a data source that lies about the register: the limit already accepted for paying by name (protocol.md §2).
- **Rotation, later:** a new generation of x_m and a move of the Seedelf together, so the old certificate dies with the old register. Not in this chunk.
- **Everything Messages did with x now uses x_m:** uses 4, 5, 6, 6′, 7's scan tag and 10.
  - `to` still names S, and the base proof shows p₀ re-randomizes M_S.
  - R_A = (p₀, [x_m]p₀).
  - The reveal's statement takes m_S where it took u_S (§19.2), and its check reads the certificate with the register at the press.
- **x_m spends nothing.** It never makes a spending or Lovejoin proof, and the funds scan never tests a register against it.
  - So a payment to a writer's R_A, which call 16 kept outside ("one key and one scan, so it can't be closed"), is never found or spent by the writer's wallet, and tells no one anything. That link closes.
- **The certificates live on the relay** (the owner, 2026-11-26; call 1): a list per network, which each wallet reads whole, never one Seedelf's, as the Seedelf names' list is read. So no read tells the server whom a wallet is about to write to.
  - The relay can withhold a certificate, as it can withhold envelopes, but it can't forge one.
- **A certificate is made when Messages is turned on** (the owner, 2026-11-26), which is off by default.
  - One already on the list that's good for the Seedelf's register and this wallet's m_S is used as it is. Otherwise the wallet makes one and posts it.
  - So a restore, or a second browser with the same phrase, finds its certificates there and posts nothing, since M_S is rebuilt from the chain and the phrase (call 5's hashed base).
  - Writing never waits on the writer's own certificate. A writer needs the reader's; its own is for being written to and for showing its Seedelf.

## What it costs in privacy

Today Messages names no Seedelf to any server, and nothing public says which Seedelfs read messages. The certificate list changes both. The owner accepted the list (call 2, 2026-11-26), and each change still needs a dated entry under the privacy policy's *Changes*:

- **The list is public:** anyone can read which Seedelfs have Messages turned on, and roughly when each first appeared. m_S links to nothing.
- **The relay sees the address that posts a Seedelf's certificate:** the first time Messages ties an IP address to a Seedelf.
- **Certificates that appear together** link their Seedelfs to one wallet, for anyone watching the list. So when Messages is turned on with several Seedelfs taking first messages, their certificates are posted apart, not as a batch (how far apart is 55e's [choice]), and the list keeps no times. Its pages follow the relay's own sequence, which a cursor needs (protocol.md §21.7), and the relay sees each post's address all the same.
- **A certificate for a Seedelf someone else minted** at a register built from the wallet's own, such as a sum of two, is a public, lasting proof that those registers share a key. The switch says so before such a Seedelf is turned on (protocol.md §21.8).
- **Spam is no easier than today, only aimed.** Anyone can already write a first message to every Seedelf on chain, at a stamp each; the list tells a troll which Seedelfs read. The answer to floods comes later (*Not in this chunk*).
- **A writer learns, before writing, whether a Seedelf takes messages.** It's the same fact the list shows, and it's better for the writer: today a message to a Seedelf with Messages off waits unread in the pool, and the writer can't tell.

## Constraints the plan follows

- **The argument before the code:** joint-security.md and protocol.md first, reviewed, then the crate (root CLAUDE.md, *One key, many uses*).
- **The frozen v1 derivation never changes,** and `seedelf_key_v1.json` is never edited.
- **One format change, in place,** as call 16's was: every vector file re-recorded once, deliberately, then reproduced by a clean-room implementation from the spec alone.
- **Chunk 54's rules hold:**
  - every state change goes through the worker's one queue;
  - nothing new reaches a server before the user turns Messages on;
  - no keep-alive (call 20);
  - en, es and ja;
  - every privacy note stays.
- **Preprod only, still** (call 17). Mainnet opens in a later release, as chunk 54 says.
- **Heavy jobs** (the models, a long fuzz) state their memory, cores and hours before they start, and run under check.sh's caps.
- **The relay deploys through `data-layer-deploy.yml` alone.**
- **Independent AI review is the bar** (no budget for human audits). Each review gets the code and the spec, never this plan's conclusions.

## Steps

### 55a ⬜ The argument and the spec

- **joint-security.md, for two keys.**
  - x's inventory: uses 1, 2 and 3, 7's funds part, 8 and 9, and the certificate. x_m's: what Messages does.
  - Part B (the funds) no longer needs the static-DH oracle, since x meets no point a stranger chose: say what replaces §7.3.
  - What's left to argue jointly is the certificate beside the spending and Lovejoin proofs: rules 2 and 3 for it, and the transcript test.
- **protocol.md:**
  - a new section for the certificate: its bytes, its proof, the reader's checks in order, and what it proves and doesn't. Written: §21, with a pointer in the opening and in §0;
  - §1.1's table: x_m stolen reveals messages and the power to pose to that side as anyone, a "Verified" label included, but spends nothing; x stolen gives the funds, and later first messages once its thief's certificate is the one good one (§21.9);
  - §2, §3, §16, §17 (the list's routes), §19 and §20: §21.9 lists what each becomes. They change in place in 55b, with the vectors, so until then they keep matching the code and its vector files (a 55a call, 2026-11-26).
  - construction.md only where it names the reader's key.
- **keys-and-accounts.md:** the new derivation, beside v1. Written: *Messages' key (chunk 55)*.
- **Weigh:**
  - M_S on a generator a stranger chose. Weighed: a hashed base instead (protocol.md §21.3), call 5;
  - one x_m per account and network, against one per Seedelf. Weighed: one per account and network, since the scan's cost grows with every key it tests, and a scan is the scaling limit (about 1 ms an envelope);
  - what a writer's wallet does when a Seedelf's certificate is missing or doesn't verify. Weighed: it writes nothing, does no work and says the Seedelf doesn't take messages; two good certificates for one register with different m_S count as none (protocol.md §21.5, §21.8).
- **Reviewed before 55b:** two models attacking the argument, as 1.10.0's written arguments were, and a fresh read of the spec. Done 2026-11-26: a fresh read of §21 (Sonnet) and two attacks on §21 and joint-security.md (Fable and Opus). None found a way to x or x_m, or to forge a spend, a certificate, a reveal or a first message, and both attacks found the claim that x_m needs no static DH sound. Their findings are folded in: the headline scoped (an x_m thief can forge a "Verified" label to its owner), the policy in the certificate, m_S in the reveal, re-certifying after a move left to the user, the key type and the base computed in the crate (55b, 55d), and call 9.

### 55b ⬜ The crate and seedelf-crypto

- **x_m's derivation** in seedelf-crypto, beside v1, with its own vectors file, frozen when mainnet opens.
- **The certificate** in seedelf-messaging: making, checking, its bytes. Its vectors are `messaging_certificate_v1.json`, recorded by `RECORD_MESSAGING_CERTIFICATE_VECTORS=1` [choice].
- **No API carries a base** (rule 1m): `start`, `reveal` and `receive` take (network, policy, N, g_S, u_S), with m_S where it's needed, and the crate computes h_S itself. A messaging register is built only through hash_to_G1, so a writer can't be handed one on another base (both attacks, 2026-11-26).
- **One maker call:** a certificate is made in one call that takes no commitment from outside, so k_m always meets one T_x (protocol.md §21.4).
- **The session layer and the reveal on x_m and M_S;** the four vector files re-recorded once.
- **Checks:**
  - a clean-room reproduction from the spec and the vector files alone;
  - a mutation pass;
  - the spending verifiers refusing a certificate's transcripts;
  - a soak, as 1.10.0's.
- **The relay's copy of the checks** (seedelf-data can't depend on the workspace), held to the certificate vectors.
- **The two CLAUDE.md files change with it:** the root's *One key, many uses* invariant and seedelf-platform's line that the crate's key is the Seedelf key, once the code has two keys.

### 55c ⬜ The relay

- **The list's routes, per network:** post one certificate; read the list in pages behind a cursor, as the pool is read.
- **Checks, as for an envelope:** points, sizes and both proofs. Priced with a stamp, with a cap per name and per pool.
- **On mainnet [choice; call 6],** each kept certificate is checked against the data layer's own view of the contract, and dropped once its register isn't the Seedelf's. So a flood of certificates under made-up registers can't push the real one out. Preprod has no chain on the data layer, so there it's the proofs and the caps alone.
- **Kept in memory with a snapshot,** as the pool is; the off switch covers it. Deployed before the wallet's upload.

### 55d ⬜ WebAssembly

- **x_m derived at unlock beside x, and held as x is:**
  - in an allocation of its own, wiped in place at `free()`;
  - gone with the instance `renewWasm` replaces at a lock;
  - never in JavaScript.
- **A key type of its own** (rule 8; both attacks, 2026-11-26): a `MessagingKey` class with none of the funds methods (no `isOwned`, `createProof`, `baseRegister` or one-time key). Every `messaging*` export takes only it, so passing x where x_m belongs fails at the call instead of quietly running on the spending key. The certificate's maker alone takes both keys, and refuses when [x_m]G = [x]G.
- **There are exports to make and check a certificate.** Making a certificate is the only Messages call that takes x.

### 55e ⬜ The worker

- **Certificates at the switch** (the owner, 2026-11-26): turning Messages on, and turning a Seedelf on, reads the list first. For each Seedelf that takes first messages, a certificate good for its register and this wallet's m_S is used; otherwise the wallet makes one and posts it, several apart from each other. A Seedelf made here while Messages is on gets one the same way. A handle becomes (name, register, m_S).
- **Reading the list** whole, at a first message's read and at a reveal's check. When else it's read, on each sync or less often, is 55e's [choice].
- **A first message goes only to a Seedelf whose certificate verifies** against the contract read the wallet already makes for it. The reveal's press checks the certificate with the register.
- **A Seedelf that moves under the key:** its handle goes, as now (`gone`), and only the user's turning it on again posts a new certificate, never the wallet by itself (protocol.md §21.8). The retired M_S stays a handle for 48 hours.
- **The funds scan never tests a register against x_m.** Check every `isOwned` caller [code].

### 55f ⬜ The screens

- **New message:** a Seedelf with no good certificate "doesn't take messages", before any work is done.
- **The switch:** one short line saying that turning a Seedelf on lists it publicly (call 2), in en, es and ja.
- **Call 18's warning,** re-worded for two keys (call 7, with chunk 54's call 22).
- **flows.md and the e2e tests** in the same commit.

### 55g ⬜ The models

- session.spthy and envelope.spthy with the handle's key x_m and the certificate binding M_S to S.
- A lemma that the spending key stays secret whatever Messages gives away, x_m included.
- Bounded runs under check.sh's caps, with their memory, cores and hours stated first.

### 55h ⬜ The gate

- **This chunk's review** across the crate, the relay, the worker and the screens, then a review of the merged fixes, cross-area.
- **The live run** between two preprod wallets, and the relay's off-switch drill.
- **Then chunk 54's 54g resumes** for 1.10.0's release steps.

## Not in this chunk

- **Rotation.** The generation in the format is there for it.
- **A key per Seedelf.**
- **A rate limit on first messages that costs a troll Seedelfs,** a backlog line when this chunk lands. A first message would carry a zero-knowledge proof that its writer holds one of the list's messaging registers, without saying which, and a tag that's the same for one writer to one reader in one period. The reader then takes a few per tag per period, so a flood needs many Seedelfs, each a mint in ADA. It uses x_m alone, and the list is the set it proves membership of. Its cost is to measure: making and checking such a proof takes time that grows with the list, which a troll could turn on the reader. Block, on chunk 54's 1.10.x list, comes first.
- **Mainnet** (call 17).
- **The CLI:** its x is random, with no phrase, so it has no x_m. Its Seedelfs get no certificate and take no messages. Today they take them, but nothing reads them.

## What doesn't change

- **The screens' shapes, the flows, the handle and the reveal's button.**
- **The envelope, the ratchet, the stamp and the pool,** and their rules, but for the key.
- **Spending, Lovejoin and the one-time keys:** x, as now.

## The owner's calls

Each has a recommendation, which the owner can overturn.

1. ✅ **Where certificates live: the relay** (the owner, 2026-11-26: "The relay will hold the certs. The relay does a lot here but its worth it for what is going on here.").
   - A list per network, read whole. It costs no ADA, a certificate posts in a second, and the trust is the relay's today: it can withhold, not forge. It fits the owner's rule that a certificate is made when Messages is turned on (call 2).
   - Set aside, on-chain metadata: permanent and readable by any indexer, but turning Messages on would then be a transaction, with a fee and a block's wait, that ties the certificate to the account that paid it, and the data layer and Koios would have to index it.
2. ✅ **What the list makes public, and when a certificate is made** (the owner, 2026-11-26): the list is accepted ("Right now that spam attack exists and having a list of seedelfs that message is just the same thing but focused"), and a certificate is made when Messages is turned on, or reused if one exists ("Then if it exists just use it else create teh cert then start messaging").
   - So anyone can read which Seedelfs take messages, and the relay sees which address posted each certificate. Both are said plainly in privacy.md, in the policy's dated entry and in one line at the switch.
   - Certificates are posted apart from each other, and the list keeps no times.
   - A certificate for every Seedelf at its mint, so the list wouldn't single out the ones that read, was weighed and set aside the same day.
3. ❓ **x_m per network.** **Recommended: yes.** It's what keeps a preprod flaw away from mainnet's messages.
4. ❓ **x_m from the seed.**
   - **Recommended: from the BIP39 seed,** a sibling of v1, so it isn't a use of x.
   - The alternative is HKDF of x, as the one-time keys are (use 8), which a CLI's random x could use too.
5. ✅ **M_S's base: a hashed one** (changed in 55a; the owner, 2026-11-26: "yes to the call 5 and call 9. I think they would work well.").
   - **Recommended: h_S = hash_to_G1(network ‖ N ‖ g_S ‖ u_S)** (protocol.md §21.3). A restore still rebuilds it from the chain and the phrase, nobody chooses the point, so no certificate is a static-DH answer on x_m, and a Seedelf's messaging register is never on another register's base.
   - The plan first recommended the Seedelf's own generator g_S. A Seedelf someone else minted under the key has a g_S they built from the wallet's public registers, and turning it on would then publish x_m times their point.
   - The cost is one hash to the curve each time a writer or the relay checks a certificate.
6. ❓ **The relay checking certificates against the chain on mainnet.**
   - **Recommended: yes,** against the data layer's own view, so made-up registers can't crowd out the real one.
   - The relay has read no chain until now, so this is a change to 54c's design.
7. ❓ **Call 18's warning after the split** (with chunk 54's call 22). Funds no longer depend on Messages' math, but a memory-level bug still reaches both keys.
   - **Recommended: keep a short warning until mainnet opens,** in the owner's words.
8. ❓ **Rotation later,** with the generation in the format now. **Recommended: yes.**
9. ✅ **Withdrawing a certificate: a withdrawal signed by x_m** (Opus's attack; the owner, 2026-11-26, as recommended). Turning Messages off leaves the Seedelf's certificate good on the public list, so it still reads as taking messages, and writers still pay a first message's stamp for nothing.
   - **Recommended: a withdrawal, signed by x_m, never x,** posted when the user turns Messages or that Seedelf off. It proves x_m on h_S over a hash of the one certificate it withdraws, so a later posting, made with a fresh aux, is other bytes that an old withdrawal can't take down. It's a new use of x_m, so joint-security.md and protocol.md §21 come first, in 55c.
   - The alternative is to say at the switch that turning off doesn't take the Seedelf off the list, and that moving it does.

## Unknowns

- **The list's size, and how often a wallet reads it** [measure]. About 280 bytes a certificate [assumed], so about 2.8 MB for 10,000 Seedelfs.
- **Whether any of the wallet's own flows moves a Seedelf's token to a new register,** such as a Max or a sweep [assumed not; checked in 55e]. One that did would end its certificate unseen.
- **Which certificate a writer takes when two verify** for the same register: two generations, which only rotation makes.
