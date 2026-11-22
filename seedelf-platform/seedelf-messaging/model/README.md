# The session model (54b)

A symbolic model of [protocol.md](../docs/protocol.md) §3 to §6, as built (§16), in [Tamarin](https://tamarin-prover.com) 1.12.0: first contact with the static DH, the Double Ratchet, the reader's rule on a cid, and continuations. [session.spthy](session.spthy) is the model and [check.sh](check.sh) proves it. Chunk 54's 54b.

It checks the design, not the Rust: nothing here reads the crate. The vectors, the adversarial tests and the mutation pass hold the code to §16 ([security.md](../docs/security.md), *The session layer*); this holds §16 to its claims.

```bash
./check.sh               # every lemma, then each configuration's wellformedness checks
./check.sh m1_secret     # some lemmas
LOGS=/tmp/m ./check.sh   # keep the logs
```

It needs Docker. The first run builds the image from [Dockerfile](Dockerfile): Tamarin 1.12.0 and Maude 3.5.1, each pinned by its release's SHA-256, on a pinned Ubuntu 24.04. Every lemma then runs in its own container with no network and a memory cap (`CAP`), `PAR` at a time.

**It's heavy.** A lemma takes from seconds to 30 minutes, and up to 8 GB, and the whole run took an hour at the defaults: run it when the machine is otherwise idle. Each run gets `CAP` of memory with no swap and `CPUS` cores, `PAR` at a time, so the defaults (5, 1 core, 8 GB) take at most 40 GB and 5 cores, and `PAR=1` one run's 8 GB and a core. Tamarin's runtime would take every core otherwise, and its heap is held under `CAP`, where GHC compacts in place instead of copying.

## What it shows

Each lemma is one claim of protocol.md, proved for every trace: any number of conversations, every principal in both roles, and the compromises its configuration allows.

| Lemma | Configuration | Claim |
|---|---|---|
| `keys1_secret` to `keys4_secret`, `keys4_secret_guarded`, `heal_keys_secret` | sessions | Each root and chain key of the initiator's, one step at a time (`[reuse]`; the guarded twin restates keys4's claim) |
| `responder_keys2_secret`, `responder_keys4_secret` | sessions | The same for the responder's keys in a session the initiator started (`[reuse]`) |
| `responder_accepted_the_initiators_f` | sessions | The responder accepted the initiator's own F, unless its key was stolen before it accepted, or her state (`[reuse]`) |
| `initiator_agreement_r1`, `_r2` | sessions | The initiator reads only replies the responder sent, with the same cid, R_A and R_B (`[reuse]`) |
| `responder_agreement_m1`, `_m3`, `_m4` | sessions | The responder reads only what the holder of A's key sent, in that session |
| `m1_secret` | sessions | A first message is open to the reader's key, and nothing else (§1.1) |
| `m3_forward_secret`, `m4_forward_secret` | sessions | After the first reply, only a theft before it, or the state, opens the initiator's messages |
| `m4_heals_after_a_reply_the_attacker_only_watched` | sessions | After a stolen state, the next message is secret once a genuine reply is read |
| `r1_forward_secret`, `r2_forward_secret` | sessions | The responder's messages are forward-secret: only its key stolen before it accepted a first message, or the initiator's state, opens them |
| `static_dh_secret`, `static_dh_holds_r_a` | sessions | The static DH, [x_R]A for A of P's key, is secret unless one of the two keys was stolen first; so a session whose A is P's key is accepted only if P started it, with that F (`[reuse]`) |
| `executable`, `m1_open_to_a_later_reader_key`, `initiator_state_opens_m3_and_r2`, `reader_key_before_the_reply_takes_over`, `reader_key_lets_anyone_pose_to_the_reader` | sessions | Traces that must exist: a whole conversation, and each limit §1.1 states |
| `responder_heal_keys_secret_with_its_state`, `r2_heals_after_the_responder_state`, `responder_state_opens_m3` | `-D=RESPONDER_STATE` | The responder's stolen state opens m3, and its next reply heals |
| `static_dh_secret_with_continuations`, `continuation_message_secret`, `continues_shown_to_the_old_responder`, `_initiator` | `-D=CONTINUATIONS` | The static DH stays secret with continuations about; a continuation's message is secret; "Continues" shows both ways |
| `first_message_replays_without_the_cid_rule` | `-D=NO_CID_RULE` | Without §5's rule, a first message is read twice |
| Four lemmas on continuations' authentication | `-D=CONTINUATIONS_UNFINISHED` | Not run: they didn't finish (assumption 14) |

check.sh proves every lemma above but the four of assumption 14, and each configuration's wellformedness checks pass (2026-11-22). A lemma's "unless" names the only compromises that break it. Anything it doesn't name, the attacker may do at any time: hold every other key, and read, drop, reorder, replay and forge every message, as the relay can (§11).

**§1.1:**
- **x_B (the reader's key)** opens the first messages (`m1_secret` names it, and `m1_open_to_a_later_reader_key` finds it working after the reply). Stolen before the first reply reaches Alice, it takes the conversation over from her side (`reader_key_before_the_reply_takes_over`). Stolen later, it opens nothing more: `m3_forward_secret`, `m4_forward_secret`, `r1_forward_secret`, `r2_forward_secret`.
- **x_A (the writer's key)** opens nothing: no secrecy lemma names it.
- **A stolen state,** either side's, taken after its first reply, opens messages until the next reply the attacker didn't write (`initiator_state_opens_m3_and_r2`, `responder_state_opens_m3`). After that each side's next message is secret again: `m4_heals_after_a_reply_the_attacker_only_watched`, and `r2_heals_after_the_responder_state` with `-D=RESPONDER_STATE`.
- **Key-compromise impersonation:** the reader's own key lets anyone pose to it as any R_A (`reader_key_lets_anyone_pose_to_the_reader`).

**§3 to §6:**
- **The static DH holds R_A:** a reader accepts a session whose A is P's key only if P started it, with the same cid, R_A, R_B and F (`static_dh_holds_r_a`). So no unknown-key share, and no replies sent to a mailbox the writer doesn't hold.
- **Both sides agree** on cid, R_A, R_B and every message (`responder_agreement_m1` to `_m4`, `initiator_agreement_r1` and `_r2`). A key stolen once the session runs can't forge into it: only a theft before the reader's first step excuses a later message, or a stolen state, which §1.1 says lets the attacker step in. For m4 the initiator's state is excused if stolen at any time, as `responder_keys4_secret` states it, not only before m4 is read: that lemma timed, which m4's would need, didn't finish in 30 minutes.
- **Continuations:** a continuation's message is secret unless the old other side's key is stolen (`continuation_message_secret`), the static DH stays secret with continuations about (`static_dh_secret_with_continuations`), and "Continues" is reachable both ways. The label's own lemma didn't finish (assumption 14).
- **§5's rule on a cid is needed:** without it, a first message is read twice (`first_message_replays_without_the_cid_rule`).

## What building and reviewing it found

A reviewer with no context read the model against protocol.md (2026-11-21). Its findings changed both.

- **w₀ in the associated data is load-bearing.** A writer can choose A, E_A and S_A on the handle's generator and compute SK on any base, so only the tag, which needs w₀ = [x_B]p₀, ties a first message to a base its writer can use. Without it, a reader's continuation would publish [x_B]p₀ for a base the attacker chose: a static-DH oracle on the spending key. protocol.md §3 now says so. Call 13's base proof (54a′) later added a second guard on the same point.
- **A stolen x_B, before Bob's first reply reaches Alice,** takes the conversation over from her side; and the reader's own key lets anyone pose to it, "Continues" included. Both are in protocol.md §1.1 and §7 now.
- **A request the bounds push out leaves no tombstone** (§16.4, a [choice]). So after a flood of 50 requests, a re-post of a first message, with new proof of work after the relay's 36 hours and within t + 48 hours, reads again as a new request. It changes no conversation; the reader sees a request twice. Tombstoning evicted requests would close it, at the cost of a tombstone per evicted request. It's the owner's call (chunk 54's plan).
- **The `[reuse]` lemmas first helped nothing** (2026-11-22). Their guard, `K(k)`, never meets a key (*How it's built*), so no later proof could close on one; and each one split the search on every message the attacker sent. With nine in view, most of the later lemmas ran out of an hour or of 12.5 GB. Guarded on the key, each lemma takes minutes. The claims didn't change: a guard on the attacker deriving a key says at least as much as one on its sending it.
- **Two lemmas were first stated false.** `r1_forward_secret` and `r2_forward_secret` excused a theft of Bob's key only before he accepted Alice's own F. With Bob's key, the attacker writes another first message with her cid, p₀, A and w₀ ([x_B]A and w₀ are its to compute), Bob accepts it and replies under keys it knows. That's §1.1's key-compromise impersonation, which `reader_key_lets_anyone_pose_to_the_reader` shows. Their excuse now names a theft before Bob accepted any first message, as their claim in this README always said. Found while proving them (2026-11-22), from where the search went.
- **The model's own first version** let a stolen state open nothing: the attacker decrypted only with the associated data, and no state reveal carried w₀, its one part not on the wire. Decryption is key-only now, as AES-GCM allows, and each state reveal carries w₀.

## What the model assumes

Where a symbolic model is weaker than the protocol, or this one narrower. A reviewer should read these first.

1. **Perfect cryptography.** Tamarin's attacker controls the network and computes only what the equations allow: Diffie–Hellman in a prime-order group, where [a]P and [b]P never give [ab]P; AES-GCM, read with the key alone and accepted only under its key and associated data; HKDF and HMAC as one-way functions. Nothing about bounds, timing or side channels.
2. **No outer envelope.** The attacker sees every inner message, F, cid and headers included. That only gives it more, since the outer layer authenticates nothing: anyone can seal to a register. One claim rests on the outer layer and goes unchecked here: §1.1's "x_B opens nothing Bob sent" when x_B is stolen before Bob reads the first message. Bob's replies are then keyed to the attacker's ratchet key, and only their seal to R_A (x_A) hides them. So `r1_forward_secret` excuses a theft before Bob accepts.
3. **Handles are root registers,** (G, [x]G), one per principal. The attacker can compute [x]P for any P it knows the discrete log of, as it can over a Seedelf datum's own generator. Several registers of one key, and their sums, aren't modelled; §11 lists the link that sums give.
4. **The base a reader accepts is an honest writer's p₀, or G^k for a k the attacker chose.** It was the model's main restriction; since calls 12 and 13 (54a′), the reader enforces it.
   - **Why it's there.** The reader publishes [t]p₀, its ratchet key, on whatever base the writer chose. With p₀ an arbitrary term, Tamarin's search never closes.
   - **Why nothing is lost.** Two rules tie a first message to a base its writer can use (protocol.md §3). F's base proof shows p₀ = [b]g_S for the handle named in `to`, so its writer knows b: over the model's one generator G, that base is G^k. And the tag's associated data holds w₀ = [x_B]p₀, which the attacker knows, without x_B, for G^k through the handle, and for an honest conversation's base once w₀ is out (a stolen state, or a continuation). A continuation carries no proof, but must be on one of the reader's own conversations' bases (§6). All of these are in the model. With x_B, the reader is compromised, and every lemma lets the attacker win there.
   - **What's left out:** a base proved over another register of x_B than the root one (3). Its writer knows b over that register's generator, so it gains what a G^k session gives. That's argued, not checked. The proof's own soundness is the crate's tests' (54a′), not the model's.
5. **Every point is valid.** The symbolic group has no identity and no small subgroup, so §3's point checks are the code's and the tests' (54a), not the model's.
6. **A bounded conversation:** one first-contact message, two full round trips (m1, r1, m3, r2, m4), and one continuation link (a continuation isn't continued again). Out-of-order delivery, skipped keys, MAX_SKIP, the requests' bounds, every clock (the 48-hour window, tombstones, expiry) and proof of work aren't here: they're counters and times, which the tests and the mutation pass cover.
7. **§5's rules are one restriction:** a reader takes a given cid's first message once. That's what the cid table, the tombstones and the window aim at, and the model shows it's needed. The code keeps it, but for the evicted-request gap above.
8. **Requests are read eagerly.** 54a's tests show replying builds exactly the state eager processing would (§16.4).
9. **Reading is two rules,** deriving the keys from the header, then authenticating. A message that fails leaves the model's state stuck where the code leaves it unchanged, which removes only traces in which the failure changed nothing.
10. **ENCRYPT's salt is left out.** A message key is used once in the model, and the salt is a net for a key used twice (§4.2), which only a rollback does. The model has no rollback.
11. **State theft:** each side's record after its first reply, taken once, then or later, which also stands for an old copy: the initiator's in the sessions' configuration, the responder's in its own (13). Not modelled: both at once, a state before the first reply, and one message key alone (§1.1's row, which the one-way KDF chain gives).
    - **Some lemmas name the initiator's state where it opens nothing:** `responder_keys2_secret` and `r1_forward_secret`. Tamarin finishes them only that way; without the excuse it has to refute every branch the state would end, and ran past 12 GB. They still say everything about traces where no state is stolen.
12. **F is one value bound into SK, and through it into every key:** cid, t, `replaces`, p₀, A and E_A. `t` is any public value. `to` and its base proof (call 13, 54a′) are left out: `to` changes only a label, and what the proof gives the reader, a base its writer can use, is assumption 4. The first-contact stamp (call 12) sits after F, and it and the envelope's outer scalar (§4.1) are about spam and unlinkability, which no lemma here claims (2, 6).
13. **Four configurations,** since Tamarin's search grows with every rule that publishes something, and with every compromise. Each lemma is proved where its own compromises are.
    - **The sessions** steal long-term keys and the initiator's state, and have no continuations. Their attacker misses what a continuation publishes: fresh powers of p₀, a message under a key it can't derive, and the old identities. Of those only w₀ isn't otherwise public, and in the protocol a continuation is sealed to the other side, so no one else sees it there.
    - **The responder's state** (`-D=RESPONDER_STATE`) is the sessions with the responder's state stolen instead of the initiator's. With both in one model, Tamarin ran past 14 GB on the third key; a lemma about one side's state doesn't need the other's.
    - **The continuations** (`-D=CONTINUATIONS`) have no ratchet and no state theft. Their attacker misses the ratchet's fresh powers of p₀ and its ciphertexts, which no continuation's SK depends on.
    - **The cid check** (`-D=NO_CID_RULE`) is the sessions without §5's rule.
14. **Four continuation lemmas don't finish** in an hour at 12 GB each: the static DH's hold with continuations, agreement on a continuation's first message, "Continues" only from the old other side, and the reader's key forging "Continues". They're in the model under `-D=CONTINUATIONS_UNFINISHED`, and check.sh doesn't run them. What stands in for them:
    - `static_dh_secret_with_continuations`: [x_R]A for A of an honest P's key stays secret unless one of the two keys is stolen, with continuations about. To be accepted with A = P's key, a writer must produce a tag under a key derived from that static DH, so only P's own message can be.
    - The sessions' `static_dh_holds_r_a` and `reader_key_lets_anyone_pose_to_the_reader`, which cover any honest base, an old conversation's included, so a forged continuation too.
    - The step from these to the label is argued, not checked.
    - **Tried again once the guards were fixed** (2026-11-22): their static DH lemma is proved (79 steps), and three of the four ran out of an hour at 4 GB again; the fourth, the reader's key forging "Continues", wasn't tried.
15. **The verified reveal isn't modelled** (54f, protocol.md §19). A reveal is a message of its own kind inside the ratchet, sent only after the first reply, so its secrecy and who could have sent it are any session message's, which the lemmas above cover. Its proof isn't: an OR-proof that the Seedelf's register and A share a key, or that its maker knows w₀'s. Its soundness and its deniability (the reader can make one, so it convinces no one else) rest on the Cramer–Damgård–Schoenmakers argument, the crate's tests, a mutation pass and vectors reproduced from protocol.md alone (security.md, *The verified reveal*). A lemma with the proof as an abstract function, that a reader labels a Seedelf only when that Seedelf's key holder sent the reveal or the reader's own key is stolen, is the owner's to ask for.

## How it's built

- **Rules,** following §16: `I_*` are the initiator's steps, `R_*` the responder's, `C_Derive` and `C_Send_*` a continuation by either side, and `R_Label_*` the reader's "Continues" match, judged when the request arrives (`judged_on_arrival`). `Reveal_ltk`, `Reveal_state_initiator` and `Reveal_state_responder` are the compromises.
- **No step raises received points to a power on more than two bases,** and no step publishes a key it computed from a point it was given: reads are split into deriving the keys, then authenticating, and a continuation into deriving, then sending, once per kind of base. Tamarin's precomputation and search don't finish otherwise.
- **Each step's root key and chain key are proved secret one step at a time** (`keys1_secret` to `keys4_secret`, `heal_keys_secret`, `responder_keys2_secret` and `_keys4_secret`), and the initiator's agreement lemmas too. Each is a `[reuse]` lemma the later ones in its configuration assume, proved in its own run; check.sh runs them all. In the continuations, `static_dh_secret_with_continuations` does the same for the static DH.
- **A keys lemma guards on the key itself,** `KU(rk)` and `KU(ck)`, the attacker deriving that key, so a later proof that reaches the key closes there. Two other guards fail, and the first version had both:
  - **`K(k)`** never fires: in a lemma, `K` is the attacker sending a message into the protocol (Tamarin's ISEND), and a key is never sent. It only split the search on every message the attacker sent.
  - **`KU(k)` with k = rk or ck** fires on every term the attacker derives, and the equality splits the search on each one.
  - **`keys4_secret` is the exception:** in the key-guarded form Tamarin didn't prove it in two hours at 12 GB, in the `KU(k)` form it takes minutes. So it's stated that way, `keys4_secret_guarded` restates it guarded on each key (proved from it in 21 steps), and the lemmas after see only the twin.
- **An all-traces lemma sees only the `[reuse]` lemmas its proof rests on** (`hide_lemma`), so the others cost it nothing. Hiding a lemma only drops an assumption. **A trace lemma sees them all:** they cut every branch where the attacker would build a message it has no key for.
- **Each trace lemma names its trace step by step:** `executable` the whole conversation, message by message, and the others the honest exchange up to their theft; `reader_key_before_the_reply_takes_over` with no reply from Bob at all, and `reader_key_lets_anyone_pose_to_the_reader` on a base and a cid no honest initiator used. Naming more only narrows what the lemma says exists, and it keeps Tamarin's search on that trace.
- **The responder's side stands on lemmas about the first message:** `static_dh_secret` and `static_dh_holds_r_a` for its agreement, and `responder_accepted_the_initiators_f` for its keys, since `responder_keys2_secret` and `_keys4_secret` name the initiator's own F.
- **A tactic, `states_then_keys`,** ranks the goals of the lemmas Tamarin's default ranking stalled on: the protocol's states first, so a `[reuse]` lemma has the rule instances it matches, then what the attacker knows of fresh values and of keys, Diffie–Hellman case splits late, and how the attacker built a message last. A ranking changes how long a proof takes, never what it proves.
- **`KeyOn(P, p₀, A)`** is an observer rule that publishes nothing. A lemma can't write "A = [x_P]p₀" with a power in its formula, so it says KeyOn.

## Why Tamarin and not ProVerif

The plan named ProVerif by default. ProVerif takes Diffie–Hellman as an equation, and the registers need it with any point as the base: p₀ is itself a power of G, and w₀, E_A and the DH outputs are powers of p₀. Its completion of `exp(exp(P, x), y) = exp(exp(P, y), x)` didn't finish on a one-line model. Tamarin's built-in theory takes any base.
