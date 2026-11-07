# 1.8.1's release review: guard

Reviewer `guard`. My lens: the dApp guard (#367's `paidScripts` and the signer's refusal), the words, the docs #367 changed, and the release prep (`2a8060d3`). Read on the tree at `2a8060d3`.

**The short of it:** the guard holds. It catches every way a Conway transaction can name a reward account to pay into, in every encoding Pallas reads, for a public site and a private session alike, before the user is asked. It knows the classic pool and every head-start pool on both networks, the retired ones and mainnet's new v2 5 ₳ pool among them, and it refuses nothing the owner left out. What I found is narrower:

- a copy pool that holds none of the wallet's boxes isn't guarded, though the archived record says copies are;
- the privacy policy's body never mentions the new read: only its Changes entry does;
- no test covers the guard past the classic pool, or on a private session;
- the verified-critical files list `lj.warn.rewardsMoved` but record no round for it;
- a few docs are a little off.

The prep is clean. It needs no API deploy. The new pool's Cardanoscan entries are still owed, and they're the owner's to send.

**The repro:** `EXT/tests/zz-r181-guard-1.test.ts`. A copy is kept at `SCRATCH/review/guard/zz-r181-guard-1.test.ts`, and its run is in `SCRATCH/review/guard/repro-1.log`. It used the real WebAssembly and was run only by name. All 4 tests passed, and I deleted the file from the tree before returning. It showed:

1. **Every encoding of a public site's transaction is refused unasked, in `dapp.lovejoinRewards`'s words.** The cases:
   - a pool registration: in a plain array, in a tag-258 array, in an indefinite array, with a mainnet `f1` header on preprod, and as the second of two certificates;
   - a proposal's deposit return: in a plain array and in a tag-258 array;
   - a treasury withdrawal's payee: in a definite map, in an indefinite map, and in the second of two proposals.

   Three are asked, as the owner wants: another script's pool registration, a withdrawal from `mix_logic`'s own account, and an output whose stake part is `mix_logic`'s.
2. **A site on a private session is refused the same way:** a pool registration and a proposal's return. Another script's is asked.
3. **The pools it knows, in sw.ts's wiring** (`serviceDeps(new PoolDiscovery(...))`, the bundled head start): `mixLogicHashes` is the classic pool plus every head-start pool on each network. That's preprod 6 and mainnet 3, which takes in retired `dc6abe3b…` and v2 `fcb3f5ec…`. It asks nobody.
4. **A pool found since the head start is known. A verified copy discovery keeps is not** (guard#1).

## Findings

### guard#1 · low · `extension/src/background/lovejoin.ts:4599`: a copy pool isn't guarded, though the record says copies are

**What's wrong.** `mixLogicHashes` takes `readSet(network, true)`. That's the classic pool, discovery's `known` (the rule's pools and those handed over before) and the sealed copies that hold the wallet's boxes. A copy discovery keeps under `seedelf.lovejoinPools.<network>` that was never handed over, and holds none of the wallet's boxes, isn't in it: unread, or read once and found empty. That copy is a genuine pool, verified from the templates, which other wallets may use.

The record says otherwise:

- chunk 43's plan, Step 5 (`docs/archive/plans/chunk-43-lovejoin-reward-balance.md:120`): "every found pool's (`PoolView.mixLogicHash`, kept under `seedelf.lovejoinPools.<network>`)";
- its record (`:47`): "every pool `readSet` keeps, the classic and retired pools **and copies included**".

The code's own comment ("every pool the wallet reads") is accurate. The record isn't.

**Evidence.** Repro test 4. The preprod record is `{ pools: [earlier, REAL] }`, where REAL is the v2 token pool fixture, which WebAssembly verifies, as a later launch of an earlier pool's values. Then:

- `mixLogicHashes("preprod").has(mixLogicOf(REAL))` is `false`, while `discovery.copiesUnread("preprod")` lists `[REAL.id]`;
- with REAL alone in the record, it's `true`.

`readSet` never adds `copiesUnread` or the checked copies (`lovejoin.ts:2863-2896`).

**The failure.** Say a site's transaction registers a stake pool whose reward account is such a copy's `mix_logic`, or makes a proposal that names it as its deposit's return. The wallet doesn't refuse it: it asks, as for any script's. The user's deposit then lands where anyone may take it, and until someone does, it stops every mix and way back in that pool for wallets without chunk 43.

**The smallest fix, test first.** Flip repro test 4's first assertion to expect the copy's hash. Then make `mixLogicHashes` add every pool discovery keeps: a `kept` dependency from `serviceDeps`, returning each `FoundPool`'s ref, run through `mixLogicOf`. If the owner prefers the narrower set, correct the record's `:47` to "copies handed over or holding the wallet's boxes" instead.

### guard#2 · low · `docs/store/privacy-policy.md:46`: the policy's body never mentions the reward-account read

**What's wrong.** The read appears only in the Effective line's parenthetical (`:3`) and the dated Changes entry (`:93`): `grep "reward account"` finds only those two lines. The body doesn't name it where it says what the wallet asks the Cardano server:

- `:41`, "Whichever answers sees … Lovejoin's pools when you use Lovejoin …";
- `:45`, "Two reviews go to it before you press Send …";
- `:46`, the *Lovejoin's pools* bullet.

The house updates the body with each Changes entry. 30 October's change rewrote the *Koios* and *Lovejoin's pools* bullets (`51056dc5`), and 1.8.0's retirement is in the table row and in *Lovejoin's pools* (`0b75beaa`). #367 did neither.

**The failure.** Someone reading the policy as it stands isn't told, in the section on the services it talks to, that the Cardano server is asked for a Lovejoin pool's reward account before each mix and box's way back the wallet builds, and again at Send. Nothing is hidden, since Changes says it, but the body is incomplete.

**The fix.** One sentence in *Lovejoin's pools* (`:46`), for example: "Before each Lovejoin mix or box's way back it builds, and again as you send one kept for you, it asks what sits in that pool's reward account: one request a pool, the same for everyone, naming the pool."

### guard#3 · low (a test gap) · `extension/tests/dapp.test.ts:591`: no test holds the guard past the classic pool, or on a private session

**What's wrong.** The one extension test runs on `testBalances`' `LovejoinService`. That service has no `known`, no `pools` and no `copies`, so `readSet` returns the classic pool alone, and that pool is all the test proves. It's a public site's pool registration in a plain array, nothing more. The private-session tests build their own `DappService` (`privately()`, `dapp.test.ts:1135`) with no `lovejoin`, so the guard is off there. No test calls `mixLogicHashes`. The only reference to the refusal is `dapp.test.ts:601`.

**The failure.** Each of these would pass every suite:

- a change that drops discovery's pools from the guard, such as `readSet`'s quiet path or `serviceDeps.known`, leaving every token pool, the head start's v2 5 ₳ pool too, unguarded;
- a change that skips the refusal for a session (`holder`).

**The fix.** Take in repro tests 1 to 3:

- a session's refusal, with `lovejoin` given to the `DappService`;
- a proposal's return and a treasury payee through the signer;
- the known set, in sw.ts's wiring, on both networks, a pool found since included.

### guard#4 · low · `docs/i18n/verified-critical-es.json:480` (and `-ja.json:480`): `lj.warn.rewardsMoved` is listed as verified, but no round is recorded for it

**What's wrong.** #367 appended the key to both files' `keys`. Their `reviewer` notes end at 1.8.0's round: no entry says when it was back-translated, by whom, or in which frames. Only the archived plan says "back-translated without the English in view".

In 1.8.0 the feature PR added the keys (`431955dd`), and the release review back-translated them blind with a fresh agent and wrote the round down (`0b75beaa`).

**The failure.** The record of the accepted risk, where no native speaker has read these, claims a check it doesn't describe.

**My own back-translation (not blind: I had the English in view).** The meanings hold:

- es: "The network rejected it: the Lovejoin pool changed while it was being sent. Nothing was lost."
- ja: "Because the Lovejoin pool changed during sending, the network refused it. Nothing has been lost."

**The fix.** In this gate's fix round, a fresh agent back-translates es and ja blind, in the frames they show in:

- the stop reason, `lovejoin.detail.whyStopped` "Why it stopped: {{why}}." after `withoutStop`;
- a public chain's and a session's `stopped`;
- a withdraw's refusal.

Then both files' `reviewer` notes gain a 1.8.1 (chunk 43) entry.

### guard#5 · nit · `docs/architecture.md:680`: the Lovejoin diagram leaves out the new read

**What's wrong.** The diagram's arrow from `lovejoin.ts` to Koios lists the reads `lovejoin.ts` makes ("credential_utxos (mix_box), ogmios (first mix), submittx, tx_status, utxo_info, tx_info"), without `account_info` of the pool's `mix_logic`. And nothing in architecture.md's Lovejoin section says that a chain's first mix in each pool, or a withdraw, takes the balance. Only *What each costs* (`:749`) changed.

Chunk 43's *When it lands* asked for all three: "architecture.md's Lovejoin: `account_info` among its diagram's reads, a chain's first mix in each pool taking the balance, and *What each costs*".

**The fix.** Add `account_info (mix_logic)` to the arrow, and one clause to *A chain is built whole…*.

### guard#6 · nit · `docs/architecture.md:749`: the cost line counts a return across pools one read too many

**What's wrong.** It says "a return across pools one a pool and one for its collateral's 5 ₳ pool". But `acrossOf` reads `[...legs.map((l) => l.pool), c.collateralPool?.pool]` (`lovejoin.ts:4035`), and `rewardsIn` keeps one read a pool id (`lovejoin.ts:4625`, `new Map(... [p.id, p])`).

**The failure.** When the ADA leg is in the v2 5 ₳ pool, as it always is when the ADA goes in, the collateral's pool is that same pool and costs no extra read. The sentence is right only for a return with no ADA leg.

**The fix.** Say "one a pool, its collateral's 5 ₳ pool among them".

### guard#7 · nit · `docs/privacy.md:236` (and `docs/store/privacy-policy.md:93`): "the IP address that sends the transaction moments later" is too strong

**What's wrong.** The read is made at every build, a review's included. A review may never be sent, and a review kept for Send waits up to 10 minutes (`BUILT_TTL_MS`). The substance holds: the review's evaluate already names the pools, as `:236` and the policy's `:45` say.

**The fix.** Say "from the IP address that sends the transaction", or "…at review, as the pool read does".

### guard#8 · nit · `seedelf-platform/CLAUDE.md:97`: "Every Lovejoin builder takes a `&mut lovejoin::Rewards`" overstates

**What's wrong.** The deposit builders run no script and take none: `deposit`, `deposit_from` and `deposit_across` (`seedelf-core/src/lovejoin/mod.rs:675`, `:691`, `:718`).

**The fix.** Say "every Lovejoin builder that runs `mix_logic`", or list them as the plan's record does.

### guard#9 · nit · `wasm/README.md:92`: the `inspectDappTx` row doesn't list `paidScripts`

**What's wrong.** The row says what the summary returns, and the extension's refusal reads `paidScripts`, but the row doesn't name it. Proposals (chunk 39) aren't named either. `inspectSessionTx` (`:63`) refers to this row.

**The fix.** Add: "`paidScripts`, the scripts whose reward accounts it pays into (a pool registration's, a proposal's return, a treasury withdrawal's payee), by hash, each once, for the extension's Lovejoin refusal (chunk 43)".

### guard#10 · nit · `extension/src/ui/screens/ClaimAll.tsx:160`: `lj.rewardsMovedReview` can show inside a warning, unverified

**What's wrong.** `claimSubmit`'s `balancesHeld` (`sessions.ts:3352`) puts the stale review's own words into `failed[].error`. ClaimAll shows those inside `<Callout tone="warn">`, so `lj.rewardsMovedReview`, a machine draft, can appear in a warning, which `tests/i18n-worker-reasons.test.ts`'s rule wants `.warn.`-named and verified. This route isn't new: it shows every send error's own words, `sess.spentSince` and Koios's among them, none of them critical, and RUNTIME doesn't list it.

**My back-translation (not blind).** es: "The Lovejoin pool changed since you reviewed this. Review it again." ja: "After you checked, the Lovejoin pool changed. Please check again." Both are right.

**The fix.** For the owner: either list ClaimAll's failed route in RUNTIME and name its keys `.warn.`, or leave it as precedent. Not for 1.8.1 unless wanted.

## What I checked that held

**The guard's coverage.**

- `paidScripts` covers each way a Conway transaction names a reward account to pay into:
  - a pool registration's reward account, which covers a re-registration and a pool update, since they're the same certificate;
  - a proposal's deposit return;
  - a treasury withdrawal's payees.

  MIR certificates don't decode in Conway (Pallas `conway::Certificate` has none), and nothing else in the body names one.
- Pallas parses every reward-account form the ledger takes (`e0`, `e1`, `f0`, `f1` and 28 bytes; `parse_stake_fn` is lenient). A form it can't decode, such as an indefinite or tagged byte string, fails the whole read, and the transaction is refused.
- The encodings are proven by the repro: plain arrays, tag 258 and indefinite arrays; definite and indefinite maps; a second item; the other network's header.

**Where it runs.**

- The refusal sits in `readTx`, which comes before `ask`. `readTx` is the only way to a signature (`signTx`), for a public site and a private session alike (repro), and `sw.ts:273` wires `lovejoin` in.
- The refusal is `TxSignError.ProofGeneration` with English for the site (`siteError`), and it's counted as unprompted.
- Not refused, as the owner wants: another script's account, a withdrawal from `mix_logic`'s own account, and an output whose stake part is `mix_logic`'s (repro).
- No other path pays into the account:
  - Minswap-built session transactions refuse any certificate or proposal (`refuseOddities`, `sessions.ts:6847`);
  - the wallet's own builders write no pool registration or proposal.

**The pools it knows.**

- The classic pool, and every head-start pool on both networks, the retired 8131b1d pools and mainnet's `fcb3f5ec…` among them. Pools found since are included (repro). It asks nobody, with `known` quiet and the sealed copies read from the device.
- The backlog's "whose stake can't be delegated" holds for all three script sets: `mix_logic`'s publish handler accepts only `RegisterCredential` at cb5a5a3, 8131b1d and 29573c5.

**The words.**

- `dapp.lovejoinRewards`, `lj.rewardsMovedReview` and `lj.warn.rewardsMoved` are true of the code: the refusal's case, Send's stale read, and a chain stopped or a withdraw refused twice. In each, a phase-1 refusal loses nothing.
- Each is one line, none names Seedelf, and en, es and ja agree in meaning (my back-translations, not blind).
- `lj.warn.rewardsMoved` is in `critical-keys.json` and in both verified files. The `dapp.*` and "Review it again" keys aren't critical, as house precedent has it. All three are marked "machine" in both provenance files.

**privacy.md (`:236`).**

- The read names only the pool's `mix_logic` stake address.
- It's one address a request, never batched (`koios.ts:976`, `data-layer.ts:297`).
- It goes to the data layer first on mainnet, Koios for a part that's down or with Koios-only on, and Koios on preprod. *Known links*' "Koios means whichever answered" covers this bullet.
- It isn't routed through `koiosAlone`, rightly, since it names nothing of the wallet's.

**The privacy policy.**

- The Changes entry is dated 6 November 2026, #367's merge day (2026-11-06T23:43Z).
- The Effective date stays 6 November 2026, with its parenthetical extended.
- What the entry says is true: one request a pool, the same for everyone, the balance into the user's own change or the box's way back, and asked again at Send for a mix or return kept for it (`publicStart`, `backSubmit`, `claimSubmit`).

**The other docs.**

- **`wasm/README.md`:**
  - the `lovejoinMixLogic` row matches the code (`PoolNamed.poolRef`, `{ hash, stake }`);
  - each request's `rewards` matches its struct: `CollateralMixRequest`, `ChainRequest`, `AccountChainRequest`, the three withdraw requests, `api::SessionReturnRequest`.
- **The backlog:** its three new lines match the owner's calls.
- **`seedelf-platform/CLAUDE.md`:** its line on withdraw-zero is otherwise true.

**The prep (`2a8060d3`).**

- **The version:** `package.json` and its lock are at 1.8.1. The manifest and `__VERSION__` take it from `package.json` (`vite.config.ts:106`, `:112`).
- **The DRep lists:** only `recorded` moved, to 2026-11-07, the commit's UTC date. Nothing was renamed.
- **The new mainnet pool:**
  - its head-start fields match Koios's `utxo_info` for `b1720b86…#0/#1/#2` (one read): values 1,534,360, 3,616,090 and 15,934,070; block 14,167,059; time 1793998150; the NFT `fcb3f5ec…`/`lovejoin`; and the reference scripts `dd94113c…` (629 bytes) and `a6a85074…` (3,487 bytes);
  - its seed is output #3 of the retired 5 ₳ pool's launch transaction;
  - the head-start test verifies it as v2 from the bundled templates, and the baseline is green.
- **No API deploy:** nothing changed under `seedelf-data/` or in `tokens/list.json` since `497da3a3`, and the data layer has had v2's templates since 1.8.0.
- **No stale words:** no doc, store listing line or screen says mainnet lacks a v2 5 ₳ pool. releases.md's 1.8.0 line is history, and every other mention is conditional.
- **The Cardanoscan registry:** the new pool's four entries (`Mix Box v2 (5 ADA)` and the rest, registry version 3) are still owed through `npm run lovejoin-registry`, and they're the owner's to send. That's a release step, not a defect.
- **A note on `lovejoin-registry.test.ts`:** its `bundled.mainnet.pools.find((p) => p.boxLovelace === "5000000")` now has two matches on mainnet. It still picks the 8131b1d pool, by launch order.
