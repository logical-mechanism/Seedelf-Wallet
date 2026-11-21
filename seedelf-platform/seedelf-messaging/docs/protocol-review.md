# The protocol's second review (2026-11-20)

A reflection on a review of [protocol.md](protocol.md), brought by the owner, finding by finding, against the spec, [construction.md](construction.md) and the crate as built. The spec's changes are listed in its §0. This file keeps the reasoning behind them, including what was rejected and why.

Severity is for the design as specified before this review:
- **Blocker:** wrong as written, and fixed before sessions are built.
- **Medium:** a real gap, fixed in the spec.
- **Low:** a documentation or wording fix.

## Findings

### 1. Who controls the reply register R_A

**Severity: Medium (High once a handle proof exists). Valid. Modified: an implicit static DH, not a proof.**

**The scenario.** Mallory re-randomizes Alice's public register and starts a conversation with Bob using it as R_A.
- Bob replies to re-randomizations of R_A.
- Alice's scan finds the replies, opens their outer layer, and finds an unknown cid.
- Mallory can't find or open them.

So Bob's replies go to a third party's mailbox. Mallory reads nothing and gains no identity, because R_A means nothing to Bob. As written, it was nuisance and misdirection, not impersonation.

**Where it bites.** With a future handle proof ("R_A shares a key with Alice's Seedelf") not bound to the session:
- Alice talks to Mallory, sending R_A and the proof.
- Mallory reuses both in a new conversation with Carol.
- Carol sees "verified Alice" on a session whose key is Mallory's.

That's identity misbinding, an unknown-key-share attack.

**The correction.** R_A is made on R_B's base, (p₀, [x_A]p₀), and the session secret takes a static DH, [x_A]w₀ = [x_B]A (X3DH's DH1).
- Only R_A's key holder can derive SK, so an unowned R_A can't start a session.
- A lifted proof can't attach to a new session, since a new conversation has a new base.
- There's no proof to carry, and nothing Bob could show anyone, so it stays deniable.
- F shrinks: R_A's base and R_B's w₀ needn't be sent.

**The complexity:** one multiplication on each side, no new bytes, a change to F's layout before any vectors exist.

**Rejected: an explicit Schnorr proof of R_A.** It costs bytes and a verification, and it creates a transferable artifact. The static DH gives the same assurance, implicitly.

### 2. Continuations by cid

**Severity: Low. Valid in principle. Modified.**

As written, knowing an old cid was enough to be shown as a continuation. Only the parties and holders of their x ever see a cid, so the practical risk was small: a cid reaches Mallory only from a party, who could just as well hand over the state. But a label shouldn't rest on knowing a value.

**The correction:** a continuation is shown only when the new conversation reuses the old identities (the same p₀, and A and w₀ in either order). The static DH from finding 1 then proves the writer holds the old key. Anything else shows "says it continues", unverified.
- When the state is lost, nothing is claimed; nothing impossible is asked.
- **The complexity:** a comparison of three points.

### 3. State concurrency and crash recovery

**Severity: Blocker. Valid. Accepted, modified.**

"One writer" didn't say one queue. Two overlapping sends in the one worker could read the same chain key. With the nonce derived from the message key, that would have repeated an AES-GCM key and nonce, without the salt the first review added.

**The correction** is §4.2's state machine:
- one queue for every state operation;
- one record per conversation holding the ratchet state and the outbox, so a single write is atomic;
- persist, then post the stored bytes, then mark posted;
- after a restart, re-post the same bytes;
- decrypt on a copy, kept only if it authenticates.

Not adopted: IndexedDB. The wallet's sealed records are written whole, one key a write, which is all the atomicity this needs.

**The salt's limits:** it stops a reused message key from repeating a key and nonce, unless the random source failed too. It doesn't stop the reader dropping the second message. The spec says so.

**Rollback** (an old profile restored) loses messages and may need a restart, but leaks nothing.

### 4. The replay window and tombstones

**Severity: Low. Valid. Modified.**

A first message with stamp t is accepted while now ∈ [t − 1 h, t + 48 h]. A tombstone kept 48 hours from deletion expires before t + 48 hours whenever the deletion came before t, which happens when t ran up to an hour ahead of the reader's clock. Then a replay in the last hour was taken as a new request.

**The minimum, and sufficient, tombstone lifetime is until t + 48 hours,** keyed on F's t. After that, the window refuses the replay by itself.

**The consequence even before the fix** was a duplicate request, never touched state: a known cid never restarts a conversation.

**Also added:** a `0x01` under a known cid must carry the stored F, or it's dropped.

**No separate envelope ID is needed:** the cid with F and the ratchet's counters identify every message, and the relay's duplicate check uses bytes.

**Re-posts with new proof of work** meet the same rules.

**Clock:** the reader's clock judges. A clock set far wrong moves the window with it; that's documented.

### 5. Missing messages and the ratchet's limits

**Severity: Medium. Valid. Accepted.**

**"Expired before it arrived" overclaimed.** A gap might be expiry, a relay withholding the message, or a message still to come. Now it's "missing".

**The rest:**
- No message derives more than MAX_SKIP keys.
- State changes from skipping are on a copy, kept only if the message authenticates, as the Double Ratchet specification already requires; the spec now says so.
- Beyond MAX_SKIP, or past a skipped key's 48 hours, the message is dropped. A conversation that keeps failing so is offered a restart.

**Forged huge counters** need the cid, so only the parties and holders of their x can even send them, and they're bounded anyway.

### 6. Spam and the reader's storage

**Severity: Medium (a blocker before public use, not before sessions). Valid. Accepted, modified.**

As written, every authenticated stranger's first message created ratchet state for good. With proof of work, an attacker pays about a second per envelope and costs the reader about 5–10 ms of WebAssembly and a record. CPU favours the reader; storage didn't.

**The correction is §3.1's requests:**
- bounded at 50 and 256 KiB per network, the oldest going first;
- holding F and the raw messages, never ratchet state;
- the state built from F when the reader replies. That's safe because `RatchetInitBob` is deterministic in F and x.

There's no per-sender table, since senders are pseudonymous. Proof of work plus the relay's per-IP and storage caps (chunk 54's 54c) are what's needed before public use.

Flooding can still push real requests out of a full list. That's inherent in anonymous first contact, and documented.

### 7. Padding and message type

**Severity: Low. Valid. Modified.**

With the old 0.5 KiB smallest size, no first message fit, so every short envelope was certainly a reply. That's a real if minor leak: it told the relay when conversations start.

**The correction was the smaller F (from finding 1),** not bigger buckets:
- Sizes are now 512 B, 2, 8 and 32 KiB.
- The smallest holds a reply with 245 bytes of text or a first message with 91 (43 with full `to` and `replaces`).
- The residual, a first message with 92–245 bytes of text a size up, is documented, not padded away. Doubling the smallest size doubles the pool to hide one weak signal.

### 8. What a label may claim

**Severity: Medium. Valid. Accepted.**

The terms were loose. §7 now has a table.

| Label | Established by |
|---|---|
| ⟨handle⟩ (writer's view) | Only the handle's key opens the first message. |
| Unknown sender (reader's view) | Control of R_A, by the static DH, and nothing more. |
| Continues | Finding 2's match. |
| Verified ⟨handle⟩ | Only a future proof bound to F. |
| Claims | Unverified, and they never change a label. |

**Unknown-key-share and key substitution** are closed by the static DH and by F inside SK and the associated data. A swapped E_A or S_A can't produce a session without x_A. Messages never authorize transactions.

### 9. Forward secrecy and recovery claims

**Severity: Low (wording). Valid. Accepted.**

"Double Ratchet, the same guarantees" overclaimed. §1.1 now has a table of what each compromise reveals. The exact moment:
- Bob's messages are forward-secret from the first.
- Alice's are forward-secret once she has received Bob's first reply. Messages she sends after his reply exists but before she has downloaded it are still keyed from x_B.
- Recovery after a compromise needs a full ratchet round trip after it, against an attacker who only watches.

With the static DH, x_A alone reveals no content; x_B reveals Alice's pre-reply messages, as before.

No prekeys and no post-quantum stay as decided; their consequences are in the table.

### 10. Performance

**Severity: none. Accepted as a list of measurements.**

The figures are Node's on one fast desktop: 1.02 ms a scan in WebAssembly. They're consistent with the wallet's own measured `isOwned`, 0.73 ms a row in the module, which checks one point where the scan checks two. They justify the architecture at about 10,000 envelopes a day.

§13 lists what to measure in the extension itself before relying on them:
- the service worker in 200-envelope turns, stopped and resumed;
- a slow laptop;
- memory;
- proof-of-work times;
- offscreen parallel scanning;
- storage.

Nothing was invented.

### 11. What the relay learns

**Severity: Low (wording). Valid. Accepted.**

"Never learns whom it is for" was true of the bytes, not of the network. §11 now separates:
- what the cryptography gives;
- what the network reveals, timing correlation over time included;
- what the relay can do (withhold, delay, reorder, replay).

It claims nothing against a global observer.

## A. Blockers before sessions are built

1. The state machine (finding 3).
2. The static DH and F's new layout (findings 1 and 7). Both change the key schedule and bytes, so they precede any vectors.
3. Commit on authentication and MAX_SKIP's bound (finding 5).
4. The rules on a known cid and tombstones (finding 4).

Requests (finding 6) block public use, not the crate.

## B. Accepted, documented limitations

- **Before the first reply,** Alice's messages are protected by x_B alone.
- **A 36-hour expiry,** so a reader must unlock in time.
- **Network metadata:** IP addresses, timing, sizes and sync times.
- **A relay can withhold** messages, which show as missing.
- **Flooding** can push out requests.
- **The residual size signal** of §9.
- **The reader's clock** judges replay windows.
- **No recovery against an active attacker** holding stolen state.
- **Not post-quantum.**
- **Conversations are lost** with the browser's data.

## C. New concerns this reflection found

- **Identity misbinding** through an unbound future handle proof (finding 1). It's closed structurally now, and the binding rule is written into §7.
- **A known cid's `0x01` with a different F** wasn't covered; now it's dropped.
- **The tombstone's one-hour gap** under clock skew.
- **F carried two derivable points,** 96 bytes, which was the cause of finding 7.
- **The salt's protection depends on the random source:** a failed generator removes it. Noted.

## D. The spec changes made

All in protocol.md, with the section numbers kept:
- §0's record;
- §1.1, new;
- §2's R_A;
- §3's F, SK and Bob's steps;
- §3.1, new;
- §4.1's MAX_SKIP bound;
- §4.2's state machine;
- §5's rules 1, 3 and 7;
- §6's wording and continuations;
- §7's table;
- §8's counts;
- §9's sizes;
- §10's size limit;
- §11's split;
- §12's state;
- §13's measurements;
- §14's rows.

The crate is unchanged: none of this touches the v1 envelope.

## E. Adversarial tests for the session layer

1. **An unowned R_A:** a first message naming someone else's register never yields a session for its reader, and its owner sees only unknown-cid envelopes.
2. **A lifted R_A from another conversation** (another base) is refused.
3. **Two sends racing in the queue:** distinct counters, no repeated message key.
4. **Killing the worker** after the write and before the post, then after the post and before the mark: re-posted bytes are the same, the relay keeps one copy, and the reader gets one message.
5. **Receiving killed** between the record write and the cursor: no duplicate message, no state change on the second pass.
6. **A replay of a deleted request's first message** at t + 47 h 59 m with t an hour ahead (refused) and at t + 48 h + 1 s (refused by the window).
7. **A `0x01` with a known cid and a different F:** dropped, with state unchanged.
8. **Counters at Nr + MAX_SKIP and + MAX_SKIP + 1;** and a forged huge counter with a bad tag: no state change, bounded work.
9. **A skipped key used after 48 hours:** dropped; the message shows as missing.
10. **Requests:** 51 strangers, and 256 KiB plus one: the oldest drops; replying to the survivor builds the same state as eager processing would have.
11. **Continuation:** with the old identities shown as continuing; with a fresh p₀ and a correct cid shown as unverified; with the state lost shown as unverified.
12. **Rollback:** an older state copy re-sending; the reader drops those, and no AES-GCM key and nonce repeats.
13. **Sizes:** an `0x01` with 91 bytes of text fits 512 B, and with 92 doesn't; an `0x02` at 245 and 246.
14. **Both sides writing first:** two independent valid conversations.

## F. What the review overstated or got wrong

- **Finding 1 framed the risk as impersonation.** Without a handle proof there's no identity to impersonate; the real issues were misdirected replies, and misbinding for any future proof. Its suggested fix (a Schnorr proof) was heavier than needed.
- **Finding 3 suggested IndexedDB transactions.** Whole-record writes already give the atomicity.
- **Finding 4's replay "acceptance"** could only ever create a duplicate request, never touch an existing conversation's state.
- **Finding 6's "permanent ratchet state" was accurate for the spec as written,** but the CPU exhaustion it lists favours the reader by about 100 to 1 against proof of work.
- **Finding 7's remedy of larger buckets** wasn't needed once F was trimmed.

**And this author's own earlier overclaims,** corrected here:
- "the same guarantees" as Signal;
- "expired before it arrived";
- the relay "never learns" whom an envelope is for, unqualified.
