# Lane T1k

Returned by the workflow's agent `a8c836e1ba6798c50`, written here by the lead from its structured answer.

## Findings (14)

### t1k#1 · low · A stranger's datum that realigns into a register (a field that isn't a 48-byte byte string): no test fails without registerOf's length or type check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/chain.ts:49`
- **Who:** stranger · **Since:** aad95b12 (2026-09-27, launch review H4); in every tag from web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

registerOf is the wallet's own filter on every contract row, and anyone can make one. Remove chain.ts:49's `head.arg !== POINT_BYTES` and it reads A, constructor 0 of [a 49-byte string, a 48-byte list [bytes23, bytes22]] (`d879825831<48 bytes>40 8257<23 bytes>56<22 bytes>`), as the register (the string's first 48 bytes, the list's 48 bytes). Remove :44's `head.major !== 2` and it reads B, constructor 0 of [48, [bytes95]] (`d87982 1830 81585f<45 bytes>5830<48 bytes>`), as two points. Both are well-formed Plutus data. Reasoned, not run: a stranger who knows one of the user's registers (a Seedelf's datum) could grind d until the misread pair is (g^d, u^d). That's three fixed bytes, odds about 3e-7 a try, a few million point additions. They then pay that datum to the contract. The wallet would count a UTxO the validator can never spend (its public_value isn't a byte string), and private spends that pick it would fail. Today both checks refuse A and B. No test pins either: chain.test.ts's 47-byte and 49-byte cases are refused under each mutant by the bounds check and the trailing-byte check instead.

**Evidence:**

In T1k's copy, each mutant alone, run with tests/chain.test.ts (12 tests). chain.ts:49 `if (head.arg !== POINT_BYTES || next + POINT_BYTES > b.length) return undefined;` -> `if (next + POINT_BYTES > b.length) return undefined;`: 12/12 passed. chain.ts:44 `if (!head || head.major !== 2) return undefined;` -> `if (!head) return undefined;`: 12/12 passed. Four more checks are unpinned but reach no harm, each mutant passing chain.test.ts: :67 `length !== POINT_BYTES` (a short chunked point, which WebAssembly can't decode afterwards), :61 `chunk.arg === null` (a nested indefinite chunk), :103 the field count, and :110 the indefinite list's break (also balances and contract-scan, 33 tests). :61, :103 and :110 change only ill-formed CBOR. :63 is an equivalent mutant: :67 refuses the same inputs. Caught: :112 trailing bytes, :98 constructor tag and :96 general form, by 'skips anything that isn't a two-point register'. An RFC 8949 reader (scratch wellformed.py) says A = tag 121 [bytes49, [bytes23, bytes22]] and B = tag 121 [48, [bytes95]], both well-formed and nothing after. A demonstration test with A, B and the four ill-formed shapes (copy only, deleted) passed on TREE's code, 18/18. Under each mutant it failed exactly its own case, and the :63 mutant failed none.

**Fix:**

Add to chain.test.ts's 'skips anything that isn't a two-point register' list: `d879825831${g}4082${'57'}${'11'.repeat(23)}56${'22'.repeat(22)}` (pins :49), `d87982183081585f${'33'.repeat(45)}5830${u}` (pins :44), `d879825f5817${g.slice(0, 46)}ff5830${u}` (:67), `d8799f5f5f5830${g}ff5830${u}ff` (:61), `d879815830${g}5830${u}` (:103), `d8799f5830${g}5830${u}00` (:110). With g = 'ab'*48 and u = 'cd'*48 as in the file, each fails under its own mutant only. The same shapes may be worth adding to seedelf-koios register_of_datum's tests; whether it has them wasn't checked.

**Known check:**

rg 'registerOf', 'pointAt', '48-byte', 'two-point' across docs/backlog.md and docs/archive/plans: only chunk-26-data-layer.md:178, which names registerOf as the wallet's own filter; nothing about its tests.

### t1k#2 · low · A Seedelf name located at a row without that token, or at one this wallet has just spent: no test fails without the names loop's two checks

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:335`
- **Who:** user · **Since:** c8573d5f (2026-10-09) · **Confidence:** confirmed-by-run

**Scenario:**

readIndexView builds each Seedelf name's locator from the index's names answer. Drop `seedelfTokenOf(at, contract.seedelfPolicyId) === name` and a name is located at whatever row the answer pairs it with. Send then rebuilds that row with the name in its asset_list (seedelfRow, :420), so WebAssembly's recipient_register holds-the-token check passes on the rebuilt row and the payment goes to that row's register; reaching that takes a data layer that mispairs, which is out of scope. Drop `!spent.has(outpoint(at))` and a Seedelf this wallet has just removed keeps its locator until the index's names answer drops it. Paying that name then pays the removed row's register, which is the user's own, so nothing is lost. No test that drives the private index makes either condition false.

**Evidence:**

T1k's copy, contract-scan.ts:335 `if (seedelfTokenOf(at, contract.seedelfPolicyId) === name && !spent.has(outpoint(at))) seedelfs[name] = locatorOf(at);`. Changed to `if (!spent.has(outpoint(at))) ...`: every test file that builds a fakeIndex passed, 15 files, 250/250 (contract-scan, private-index, feed, run-traps-review-fixes, wasm-review-fixes, lovejoin-index, lovejoin-discovery, lovejoin-found-later, lovejoin-merged-review, lovejoin-round2-sessions, lovejoin-round2-retire, lovejoin-discovery-review-fixes, lovejoin-token-feed, lovejoin-screens-review, lovejoin-pools). Changed to `if (seedelfTokenOf(at, contract.seedelfPolicyId) === name) ...`: the same files plus lovejoin-crediting-review-fixes and dapp-lovejoin-rewards, 17 files, 271/271. tests/fake-index.ts:96's names route lists only unspent rows that hold the name, so neither condition is ever false in a test.

**Fix:**

In private-index.test.ts: (1) a names answer whose row for a name doesn't hold it, so view.seedelfs[name] is undefined; (2) one of this wallet's Seedelf outpoints in the spent set (spent.ts) while the names route still lists it, so view.seedelfs[name] is undefined.

**Known check:**

rg 'seedelfs[name]', 'locatorOf', 'names route', 'stale locator' in docs/backlog.md and docs/archive/plans: none.

### t1k#3 · low · A contract read whose keys change between batches kept as one wallet's: no test fails without `same`'s check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:137`
- **Who:** user · **Since:** 2fa91556 (2026-09-27, launch review H5 #52) for :137; c8573d5f (2026-10-09) for :233 · **Confidence:** confirmed-by-run

**Scenario:**

readKoiosView (:137) and readIndexView (:233) check ownership 200 rows per turn of the wallet's queue. `same` ends the read when a turn's keys aren't the first turn's. The lane's test, contract-scan.test.ts 'ends cleanly when a lock gets in partway', only locks. A locked wallet's withKeys throws WalletLocked by itself (wallet.ts:507), so that test passes with the check gone. Without the check, a scan that spans Remove wallet and a restore of another phrase checks some batches under wallet A's keys and the rest under B's, and keeps one view. B's private balance would then list A's UTxOs, which B's key can't spend, until the next full read. A lock and unlock of the same wallet changes nothing either way.

**Evidence:**

T1k's copy. :137 `if (keys !== started) throw new WalletLocked(t("worker.locked"));` deleted: the first pass (contract-scan, private-index, restore-scan, accounts-switch-reading, balances, remove-wallet, chain-lock, settle-across-lock, unlock-waits: 124/124) and a wide pass (contract-scan, private-index, incoming, coin-control, transfer, maybe-sent, withdraw, send, mint, handlers, accounts, wallet, lock-screens: 213/213) all passed. :233's copy deleted: 11 files 153/153, then 15 files 273/273. One earlier run of those 15 failed only because restore-scan's 'offers 5 ₳ where the account's ADA alone is each under 5 ₳...' hit its 5,000 ms timeout under load; the rerun passed, so that was no catch.

**Fix:**

contract-scan.test.ts: in manyRows, lock and unlock again (a new Keys object), or remove the wallet and restore another phrase, between two OWNED_BATCH turns. The read must reject with WalletLocked and keep nothing in session. Do the same for readIndexView's `ours` batches in private-index.test.ts.

**Known check:**

rg 'keys !== started', 'same(keys)', 'lock gets in partway', 'restore partway' in docs/backlog.md and docs/archive/plans: none.

### t1k#4 · low · A watch reading the feed from a cursor newer than its transaction's first try: no test fails without cover's choice of cursor

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/feed.ts:143`
- **Who:** user · **Since:** e69697b4 (2026-10-09, the 26b review's fixes) · **Confidence:** confirmed-by-run

**Scenario:**

Readings go on noting cursors every few minutes while a watch waits, so a watch usually has one cursor from before its send and newer ones after it. cover must read `since` from the newest cursor at or before the earliest covered send. Replace `cursors.filter((c) => c.got <= first).at(-1)!` with `cursors.at(-1)!`, or :142's Math.min with Math.max, and a transaction that landed before the newest cursor's point is never in the `since` answer. The watch never sees it land from the feed, which is the lane's 'calling a landed transaction not on chain'. Every feed test either has no cursor after the send or covers one send, so both mutants pass.

**Evidence:**

T1k's copy. feed.ts:143 `return { cursor: cursors.filter((c) => c.got <= first).at(-1)!.cursor, covered };` -> `return { cursor: cursors.at(-1)!.cursor, covered };`, and feed.ts:142 `Math.min(` -> `Math.max(`: each passed 15 files, 205/205 (feed, lovejoin-planner, lovejoin-token-feed, pending-alarm, pending-watch-busy, pending-activity, mempool-watch, private-landing, unseen-send-time, resend-send-time, maybe-sent, settle-across-lock, chain-in-view, withdraw, transfer). A two-case test of cover (copy only) passed on TREE's code. It failed both cases under :143's mutant and one under :142's. Caught: dropping :140's covered filter, by feed.test.ts 'asks tx_status for one sent before every cursor kept, and reads the rest of its group from the feed' (a TypeError on the missing cursor).

**Fix:**

feed.test.ts, a unit test of cover: `const cursors = [{ cursor: 'older', got: 1_000 }, { cursor: 'newer', got: 5_000 }]`. `cover(cursors, [{ txHash: 'aa', feed: 'contract', sentAt: 3_000 }]).cursor` must be 'older', and so must the cursor for sends at 2_000 and 6_000 together. Better still, add a chainStatus case with a cursor noted after the send and the transaction landing between the two cursors.

**Known check:**

rg 'cover(', 'cursor newer', 'first try', 'cursor' in docs/backlog.md and docs/archive/plans: backlog.md:47 lists other cursor paths; nothing about cover's choice or its tests.

### t1k#5 · low · A session swap or cancel carrying certificates, withdrawals, votes, proposals, mints, a missing witness or unknown inputs: no test fails without refuseOddities' refusals of them

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6867`
- **Who:** stranger · **Since:** b858d22e (2026-09-24, private swaps); :6858's `complete` term from 78869714 (2026-10-06); the refusal keys were renamed in 5f7348bf · **Confidence:** confirmed-by-run

**Scenario:**

refuseOddities is the only thing that refuses these in a transaction a session's key signs. inspectSessionTx (wasm/src/lib.rs:6447) reads the transaction with cip30::inspect_tx, which reports certificates rather than refusing them, and withinFunding counts outputs and the fee, not deposits. With :6867's `s.certificates.length ||` gone, a Minswap order build that adds Shelley stake registrations (certificate 0, which needs no witness) for keys Minswap holds would be signed. Each takes a 2 ₳ key deposit out of the session's funds, and only those keys can get it back. That is reasoned, not run, and today the check refuses it. Of refuseOddities' terms only three are pinned: other signers (othersSign), the key list (:6862) and the treasury donation (:6871).

**Evidence:**

T1k's copy, each mutant alone. First pass: sessions, order-cancel-check, direct-swaps, 123 tests. Wide pass: every swap and session test file, 31 files, 429 tests. Both passed for each of these: :6867 without `s.certificates.length ||`; without `(s.withdrawals.length && !allow.direct) ||`; without `s.votes ||`; without `|| s.proposals.length`; :6870 `if (s.mint.length) throw ...` deleted; :6858 without `|| (!others && !s.complete)`; and :6858's `s.unknownInputs.length ||` plus :6865's `if (s.unknownInputs.length) throw ...` deleted together. Each of those two alone also passed, and :6865 alone is dead code behind :6858. Caught: othersSign by direct-swaps 'pauses rather than sign one that spends a key's UTxO that isn't the session's, or needs a signature beyond its collateral owner's'; the key list by sundae-orders 'never signs with the stake key for a cancel that spends no V3 order' and 'pauses rather than sign a V3 cancel without the stake key, which couldn't work' (wide pass only); the donation by sessions 'pauses rather than sign a swap that gives ADA to the treasury, which no output shows'. direct-swaps' withdrawal test ('pauses rather than sign one that withdraws anything...') reaches directSpends' own check, because allow.direct skips this one.

**Fix:**

sessions.test.ts, beside the treasury case: order builds from fixtures/swap-tx.ts carrying (a) a certificate-0 stake registration, (b) a zero withdrawal from a script reward address, (c) a mint, (d) a vote or proposal, (e) a witness the session can't give (complete false) and (f) an input Koios doesn't list. Each must pause with its own words ('it does something with staking or governance.', 'it mints or burns tokens.', 'it needs someone else's signature too.', 'it spends UTxOs the wallet couldn't find.'). Add one Stop cancel carrying a certificate.

**Known check:**

rg 'refuseOddities', 'staking or governance', 'mints or burns', 'certificate' in docs/backlog.md and docs/archive/plans: chunk-15b-swap-runner.md:48/106 and chunk-24-dapp-additions.md:58/210/221 describe it; backlog.md's certificate lines (21, 156, 182) are about other paths; none is about these tests.

### t1k#6 · low · Minswap's order build with a second fee output, or a fee output carrying a token: no test fails without checkOrder's one-ADA-only-fee rule

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6697`
- **Who:** stranger · **Since:** ab5695a3 (2026-09-27, launch review #21) · **Confidence:** confirmed-by-run

**Scenario:**

checkOrder lets through one output that is neither the session's nor an order: Minswap's fee, ADA alone, no more than the quoted aggregator fee. Drop `!fee &&` and a build can pay several fee-sized outputs. Drop `!o.tokens &&` and a token-for-ADA swap's tokens can sit in the 'fee' output beside up to the quoted fee in ADA. withinFunding passes that (tokens out stay within what was funded), so every token funded for the swap could go to Minswap's address while an order is still placed. The direct path's twin rules are pinned ('pays a contract other than Danogo's pools, or a second fee', '... or a fee carrying a token'); the order path's aren't.

**Evidence:**

T1k's copy. sessions.ts:6697 `if (!fee && !o.tokens && o.lovelace <= aggregatorFee) {` -> `if (!o.tokens && o.lovelace <= aggregatorFee) {`, and -> `if (!fee && o.lovelace <= aggregatorFee) {`: each passed sessions, sundae-orders and order-cancel-check (104 tests), then all 31 swap and session test files (429 tests). Caught: the cap (`&& o.lovelace <= aggregatorFee` dropped), by sessions.test.ts 'pauses rather than sign a swap that pays anyone but the session, an order made out to it, and Minswap's quoted fee'. 'Stranger' here is Minswap's build-tx answer, which the session checks rather than trusts.

**Fix:**

Extend that sessions.test.ts case with a build carrying two ADA-only outputs each within the quoted fee, and one whose fee-sized output carries a token. Each must pause with 'it pays an address that isn't this session's.'

**Known check:**

rg 'checkOrder', 'second fee', 'fee carrying a token' in docs/backlog.md and docs/archive/plans: checkOrder appears in 5 archived plans as design; nothing about these tests.

### t1k#7 · low · Minswap's order build paying out more of a token than was funded, or a token that wasn't: no test fails without withinFunding's token limit

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6581`
- **Who:** stranger · **Since:** e7d411ee (2026-09-24) · **Confidence:** confirmed-by-run

**Scenario:**

withinFunding bounds what an order build pays away from the session's account. Its ADA half is pinned; its token half isn't. A session's account can hold more than its funding: its address is public once funded, and anything paid there or come back sits beside the funding. With :6581 deleted, a build that pays out more of a token than the swap was funded with, or a token it wasn't funded with, is signed. The direct path's equivalent (withinNet, 'sells more of the token than was funded') is pinned.

**Evidence:**

T1k's copy. sessions.ts:6581 `if (!funded || quantity > BigInt(funded.quantity)) throw new Refused(t("sess.refuse.warn.moreTokens"));` deleted: sessions, swap-runner and direct-swaps (128 tests) passed, then all 31 swap and session files (429 tests). Caught: the ADA limit (:6578), the fee counted in it (:6572) and the call itself (:4174), each by sessions.test.ts 'pauses rather than sign a swap that pays out more than was funded for it'.

**Fix:**

sessions.test.ts, beside 'pays out more than was funded': an order build that pays out more of the funded token than was funded, and one that pays out a token never funded. Each must pause with 'it pays out tokens that weren't funded for the swap.'

**Known check:**

rg 'withinFunding', 'tokens that weren't funded' in docs/backlog.md and docs/archive/plans: backlog.md:113 (❓ V4's cap, which withinFunding alone bounds) is about the ADA side; nothing about the token half's test.

### t1k#8 · low · A token Minswap lists by its exact ID but marks unverified, treated as verified: no test fails without the is_verified check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1902`
- **Who:** stranger · **Since:** c703ee2c (2026-09-27, launch review #20) · **Confidence:** confirmed-by-run

**Scenario:**

verified() asks Minswap's token search with only_verified: true and keeps only a row with the exact ID and `is_verified !== false`. Drop the flag check, and an answer that lists a look-alike token by its own ID with is_verified: false makes the quote say verified and lets outBuild fund a swap into it. Today it's refused. The test covers a look-alike whose ID Minswap doesn't list (the ID check, caught) but not an unverified row with the exact ID. Reaching it takes a Minswap answer that contradicts its own only_verified filter.

**Evidence:**

T1k's copy. sessions.ts:1902 `const verified = found.some((t) => t.token_id === id && t.is_verified !== false);` -> `const verified = found.some((t) => t.token_id === id);`: sessions.test.ts (61 tests) passed, then all 31 swap and session files (429 tests). Caught: the exact-ID half and outBuild's refusal (:1919), by sessions.test.ts 'is verified only for ADA, a token the wallet lists, or one Minswap verifies by its ID; the wallet won't fund one that isn't'.

**Fix:**

In that test, a tokens answer `[{ token_id: fake, ticker: 'SNEK', is_verified: false }]`: the quote must say verified false, and outBuild must reject with "won't swap into it".

**Known check:**

rg 'is_verified', 'only_verified', 'unverified' in docs/backlog.md and docs/archive/plans: no hit for the first two; nothing about this test.

### t1k#9 · low · Review offered on the swap form when the private balance can't fund the quote, the amount is more than what's held, or the token is unverified: no test fails without Swaps.tsx's ready gate

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:761`
- **Who:** user · **Since:** e1f524ac (2026-09-27) · **Confidence:** confirmed-by-run

**Scenario:**

adaShort and maxAdaIn are pinned (swap-form.test.ts), but the form's use of them isn't. The screen tests render statically, before any quote, so `current` is never set and `ready` is false whatever its other terms say. Dropping `!short`, `!tooMuch` or `!unverified` from :761, or :812's fresh-quote adaShort check, passes every swap screen test. Review would then be pressable. The worker's outBuild still refuses (no ADA to fund it, or an unverified token), so no money moves; the gate is only the form's own.

**Evidence:**

T1k's copy. Swaps.tsx:761 `const ready = !!current && !tooMuch && !short && !unverified && !quoteError;` with `!short &&`, `!tooMuch &&` or `!unverified &&` removed, and :812 `if (adaShort(seedelf.lovelace, quote)) return false;` deleted: each passed swap-page, swap-form, swap-hidden-balances, swap-page-words, swap-lovejoin-way, screens, collateral-reserve-review-fixes, swap-order-open and pool-swap-landing (192 tests). Caught: adaShort itself, both terms (swap-form 'says what ADA is short for a quote's funding and collateral'), and maxAdaIn's four terms (collateral-reserve-review-fixes). Playwright wasn't run; an e2e step may cover the gate.

**Fix:**

Move the gate into ui/swap.ts as a pure function, e.g. reviewReady({ quoted, tooMuch, short, unverified, quoteError }), and unit-test it in swap-form.test.ts. Or add an e2e step: a private balance short of the funding plus the 5 ₳ collateral keeps Review off and says 'Not enough ADA'.

**Known check:**

rg 'adaShort', 'ready', 'Not enough ADA' in docs/backlog.md and docs/archive/plans: nothing about this gate's tests.

### t1k#10 · low · A staking review's 'Public account after' off by the fee, the deposit, the refund or the rewards: no test fails without its sum

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Staking.tsx:1021`
- **Who:** user · **Since:** d423b79a (2026-10-05) · **Confidence:** confirmed-by-run

**Scenario:**

StakingReview's after row is total - fee - deposit + refund. The lane's test, staking-screen.test.ts:98, checks the withdrawal's note ('Your balance stays the same, but for the fee.'), not this row. No test reads review-after-public on a staking review. So each of these passes. Adding the withdrawal shows a 57.475311 ₳ withdrawal as 57.475311 ₳ more than the account will hold. Dropping the deposit puts a first delegation 2 ₳ high. Dropping the refund puts Stop staking 2 ₳ low. Dropping the fee is also missed.

**Evidence:**

T1k's copy. Staking.tsx:1021 `lovelace={BigInt(total) - BigInt(summary.fee) - BigInt(summary.deposit) + BigInt(summary.refund)}` changed four ways: `+ BigInt(summary.withdrawal)` added, `- BigInt(summary.deposit)` dropped, `+ BigInt(summary.refund)` dropped, `- BigInt(summary.fee)` dropped. Each passed staking-screen, governance-screen, review-layout, review-totals-incoming, i18n-screens and ui-safety (80 tests). The after row is pinned for payment and Lovejoin reviews (review-totals-incoming, lovejoin-merged-screens), not for staking.

**Fix:**

staking-screen.test.ts with the file's total '10465475311': a stop review (withdrawal 57475311, refund 2000000, fee 172673) must show 'Public account after 10,467.302638 ₳', and a first delegation (deposit 2000000, fee 172673) must show '10,463.302638 ₳'.

**Known check:**

rg 'Public account after', 'after row', 'review-after' in docs/backlog.md and docs/archive/plans: backlog.md:53 (❓ a pool's reward balance in Public account after) is about Lovejoin's reviews; nothing about the staking review's test.

### t1k#11 · low · Stop staking offered while the rewards are locked: no test fails without the button's locked gate

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Staking.tsx:645`
- **Who:** user · **Since:** d423b79a (2026-10-05) · **Confidence:** confirmed-by-run

**Scenario:**

With the key registered, rewards above 0 and no vote delegation (rewardsLocked), the Stop staking row is disabled with 'Delegate your voting power first: stopping withdraws the rewards'. Without `locked ||` it can be pressed. The build then fails in core with RewardsLocked (staking.rs:212, pinned), so no money moves, but the page offers what the ledger refuses.

**Evidence:**

T1k's copy. Staking.tsx:645 `disabled={locked || !!why || busy}` -> `disabled={!!why || busy}`: 18 files passed, 326 tests (staking-screen, governance-screen, screens, rewards-screen, delegations-screen, home-says, withdraw-refused-locked, i18n-screens, ui-safety, format, staking, screens-wiring-review-fixes, screens-nits-review-fixes, hide-balances-forms, pool-return-screen, lock-screens, shown-text, review-layout). No test calls rewardsLocked or renders Staking with locked rewards.

**Fix:**

staking-screen.test.ts: render Staking with staking { registered: true, rewards: '57475311', drep: null }. The Stop staking button must be disabled and titled 'Delegate your voting power first: stopping withdraws the rewards'.

**Known check:**

rg 'delegateFirstStop', 'rewardsLocked', 'Stop staking' in docs/backlog.md and docs/archive/plans: no hit for the first two; the Stop staking hits are usability notes, not this test.

### t1k#12 · low · Staking with a retired pool offered: no test fails without the pool page's retired check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Pools.tsx:356`
- **Who:** user · **Since:** 8b9c3cd7 (2026-10-02); the line was last changed in d423b79a · **Confidence:** confirmed-by-run

**Scenario:**

A pool whose details say status 'retired' has its 'Stake with ...' button disabled with 'This pool has retired'. Without the check the button works. Nothing else refuses a retired pool: the review only adds pool.warn.retired (Staking.tsx:870), and no check in staking.ts, staking.rs or the WebAssembly looks at it. So the user signs, and the node refuses the delegation at submit.

**Evidence:**

T1k's copy. Pools.tsx:356 `const why = blocked ?? (details?.status === "retired" ? t("pools.retired") : undefined);` -> `const why = blocked;`: staking-screen, screens, i18n-screens, ui-safety (the two files that import Pools are among them), governance-screen, delegations-screen, rewards-screen, pool-return-screen, staking and shown-text all passed (201 tests).

**Fix:**

PoolPage isn't exported. Render Pools on a row whose details come back with status 'retired', or export PoolPage. The stake button must be disabled and titled 'This pool has retired'.

**Known check:**

rg 'pools.retired', 'retired pool' in docs/backlog.md and docs/archive/plans: the retired-pool lines (backlog.md:88, 93-96; review-1.8.1.md) are Lovejoin's retired pools, not stake pools.

### t1k#13 · low · A DRep retirement built without Koios's deposit: no Vitest test fails without the worker's check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:523`
- **Who:** user · **Since:** 3e96a162 (2026-10-04) · **Confidence:** confirmed-by-run

**Scenario:**

Retiring returns exactly the deposit that was paid. The worker refuses when Koios's drep_info row has no positive deposit ('The server didn't say this DRep's deposit...'). Without that check, the build goes to WebAssembly with deposit '0', and core's own copy (staking.rs:309) refuses it in nearly the same words. Nothing is built either way; the worker's check just has no test.

**Evidence:**

T1k's copy. staking.ts:523 `if (action.kind === "drep-retire" && !/^[1-9]\d*$/.test(drepRow?.deposit ?? "")) {` -> `if (false && ...) {`: governance, staking, drep-deposit-off, governance-screen, dapp-governance, staking-screen, withdraw-refused-locked, rewards-screen, delegations-screen and dreps all passed (129 tests). Core's copy is pinned: making staking.rs:309's check dead failed a_drep_refuses_what_the_ledger_would.

**Fix:**

governance.test.ts: a registered DRep whose drep_info row has deposit null, and one with "0". staking.build('preprod', { kind: 'drep-retire' }) must reject with "didn't say this DRep's deposit".

**Known check:**

rg 'noDeposit', 'drep-retire', 'drep_deposit', 'retirement' in docs/backlog.md and docs/archive/plans: chunk-21-governance.md describes the retirement; nothing about this test.

### t1k#14 · low · A transaction Minswap built that the wallet can't read (not 4 items, no outputs, an output without a value, an inline datum not wrapped in tag 24): no test fails without builtOutputs' refusals

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:509`
- **Who:** nobody · **Since:** unknown (not looked up) · **Confidence:** confirmed-by-run

**Scenario:**

builtOutputs throws on a transaction it can't read, so inspect turns it into 'cannot read' before any check passes. Each of its four refusals can be deleted with every swap test passing. No reachable harm was found: each removal concerns a transaction the ledger itself refuses (a 3-item array, a body with no outputs, an output with no value, an inline datum outside tag 24), or one where parsing still throws a TypeError further on that ends in the same refusal. That wasn't traced for every shape.

**Evidence:**

T1k's copy, each alone. minswap.ts:509 `if (tx[0] !== 0x84) throw ...`, :520 `if (!outputs) throw ...`, :532 `if (value === undefined) throw ...` and :544 `if (tag.major !== 6 || tag.n !== 24n) throw ...` deleted: each passed order-cancel-check and sessions (91 tests), then all 31 swap and session files (429 tests).

**Fix:**

A unit test of builtOutputs in order-cancel-check.test.ts: a 3-item array, a body without key 1, an output map without key 1, and a map output whose datum option is [1, bytes] without tag 24. Each must throw its own words.

**Known check:**

rg 'builtOutputs', 'notFourItems', 'datumNotWrapped' in docs/backlog.md and docs/archive/plans: nothing about its tests.

## Guards (53)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/chain.ts:84` | E6: a datum that isn't exactly constructor 0 of two 48-byte strings with nothing after being read as a register | Caught in part: chain.test.ts 'skips anything that isn't a two-point register' kills :112 (trailing bytes), :98 (constructor tag) and :96 (general form); 'goes by the bytes, never the datum's JSON' kills :98 too. None for :44 and :49 (t1k#1), nor :61, :67, :103, :110. :63 is an equivalent mutant. |
| `seedelf-platform/seedelf-crypto/src/register.rs:176` | E6: a register with an identity point counted as anyone's (Rust; the extension reaches it only through wasm/pkg, so only Rust tests count) | register_test.rs identity_register_is_owned_by_no_key, identity_public_value_is_owned_by_no_key and identity_generator_is_owned_by_no_key all fail with :190's check dead. The public-value half alone fails identity_public_value_is_owned_by_no_key. The generator half alone is an equivalent mutant (8/8 pass). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:489` | E6: a contract UTxO counted as ours unless g^x == u, and a WebAssembly trap read as 'not ours' | isOwned -> true: balances.test.ts 'owns none of the real contract UTxOs, or another phrase's' plus 36 more in 6 files. Trap rethrow (:499) deleted: private-index.test.ts 'seals nothing from a read the WebAssembly trapped in, and checks the row again next time'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:474` | E6: a Seedelf's UTxO, or one carrying a reference script, counted in the private balance | Reference-script half: withdraw.test.ts 'leaves a UTxO carrying a reference script out of the balance and of Max'. Seedelf half: balances.test.ts 'finds the 12-word phrase's contract UTxOs, Seedelf and Cardano account' and contract-scan.test.ts 'keeps another wallet's Seedelf as where it is, so a contract full of junk still fits and still pays'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:67` | E6: a stranger's deep datum JSON or native script kept, overflowing JSON.stringify, structuredClone or storage | koios.test.ts 'drops a datum's JSON and cuts a reference script to what prices it, however deep they nest (launch review H4)' kills all three: no trim, datum JSON kept, script JSON kept. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:92` | E6: a UTxO whose reference script Koios gives no bytes for offered to a payment | measurable -> true: coin-control.test.ts 'aren't offered for a UTxO no payment can take: one holding a reference script Koios doesn't give (launch review #12)'. None for the size half at :96 (see notes). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:135` | E6: a contract read begun under one wallet's keys kept or sealed under another's | none (t1k#3). The named 'ends cleanly when a lock gets in partway' passes without it, and the same goes for :233's copy. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:264` | E6: another phrase's sealed contract record taken for this wallet's | private-index.test.ts 'never takes another wallet's record for this one's' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:335` | E6: a Seedelf name located at a row without its token, or a spent Seedelf's locator kept | none (t1k#2) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/incoming.ts:113` | E6: a freed send, or two sends spending one UTxO, counted as money on its way | Every-input-held dropped: incoming.test.ts 'builds no second withdrawal of them while the first is on its way, as the forms offer none' and 'counts the rewards again once the payment is refused or let go'. Conflict dropped: 'counts neither of two sent transactions that spend the same UTxO: only one of them can land'. None for `inputs.length > 0` (:124, see notes). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/incoming.ts:158` | E6: rewards a send withdraws taken beyond what the reading counts, or counted twice | incoming.test.ts 'never shows the rewards a payment withdrew on top of its change, however the reading reads' kills take-all and the dropped landed clause; 'takes all the rewards a reading from before an epoch's counts, when the payment took more' kills the dropped cap. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/data-layer.ts:136` | E6: a submit that may have reached the node resent as never sent | data-layer.test.ts 'is maybe sent on a timeout once it went out, and asks Koios nothing yet' (timeout term), and 'is maybe sent on a 502...' and '... on a 504...' (the final 'maybe'). The lane's named test didn't fail under either mutant. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:1204` | E6: a 429 read as maybe sent, and a 5xx, lost or unreadable answer read as refused | 429: koios.test.ts 'says whether a submit Koios didn't answer may have gone through: not when it only asked to slow down' and maybe-sent.test.ts. 5xx: dapp-maybe-sent.test.ts 'is answered with its id, kept as sent, and sent again until a submit is taken'. Lost: the same koios test and 19 more. Unreadable: submit-answer.test.ts 'that's cut off after a 2xx status is maybe sent'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:1326` | E6: a UTxO skipped or counted twice across pages | koios.test.ts 'misses no UTxO when one before the page's end is spent between pages, and counts each once (launch review #31)', and 'pages 1000 rows at a time until a short page, each after the last row of the one before'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/feed.ts:137` | E6: a watch reading a feed from a cursor newer than its transaction's first try | Covered filter (:140): feed.test.ts 'asks tx_status for one sent before every cursor kept, and reads the rest of its group from the feed'. None for the cursor choice at :142-143 (t1k#4). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6659` | E7a checkOrder: a swap paying anything but the session, its own orders and one ADA-only fee | sessions.test.ts 'pauses rather than sign a swap that pays anyone but the session, an order made out to it, and Minswap's quoted fee' (key under another stake part, not ours, contract under another stake part, fee cap, other address, other contract, no order); order-cancel-check.test.ts 'pauses rather than sign a Minswap V1 order holding its datum inline...' (why); sundae-orders.test.ts 'refuses one under another staking part, owned by another key, paying elsewhere, or for a session without its own stake key' (stakeSigns) and 'takes Minswap's staking part at V3's order script alone'. None for the fee's once and ADA-only rules at :6697 (t1k#6). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6571` | E7a withinFunding: an order swap paying out more ADA (fee included) or tokens than funded | sessions.test.ts 'pauses rather than sign a swap that pays out more than was funded for it' kills the ADA limit, the fee counted and the call at :4174. None for the token limit at :6581 (t1k#7). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4261` | E7a cancelsChecked: signing a swap whose orders' cancels can't be built, are refused, or cost over 3 ₳ | order-cancel-check.test.ts 'is refused by Review it myself as by the runner, and nothing is kept to send' (the check) and 'pauses rather than sign one whose cancel would cost more than Stop's own cancel may pay' (the cost cap). None for the count at :4288 (see notes). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6850` | E7a refuseOddities: other signers, unknown inputs, certificates, withdrawals, votes, proposals, mints, a donation, wrong cancel keys | othersSign: direct-swaps.test.ts '...or needs a signature beyond its collateral owner's'. Key list: sundae-orders.test.ts 'never signs with the stake key for a cancel that spends no V3 order' (wide pass). Donation: sessions.test.ts 'pauses rather than sign a swap that gives ADA to the treasury, which no output shows'. None for certificates, withdrawals, votes, proposals, mints, complete or unknown inputs (t1k#5). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6718` | E7a directSpends: a Danogo swap spending anything but Danogo's pools and a signed collateral, or withdrawing | direct-swaps.test.ts: 'puts up the session's own UTxO as collateral...', 'spends anyone else's UTxO but a Danogo pool's', 'whose collateral isn't signed by its owner already, or is a contract's', 'withdraws anything, or from a script that isn't Danogo's or a spent pool's'. Rows Koios doesn't list: sessions.test.ts 'pauses rather than sign a swap that spends UTxOs that aren't the session's...' (wide pass only). The 'f' check at :6754 is an equivalent mutant (see notes). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6771` | E7a checkDirect: a Danogo swap paying anything but the session, each pool recreated once, and one ADA-only fee | direct-swaps.test.ts 'pays the pools' script anywhere but where a spent pool was, or twice for one', 'pays the session's key under someone else's staking part, even fee-sized', 'pays a contract other than Danogo's pools, or a second fee', and 'pays the proceeds as Minswap's fee, a fee a lovelace over, or a fee carrying a token'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6807` | E7a checkProceeds: a Danogo swap giving less than the approved minimum | direct-swaps.test.ts 'pauses rather than sign one that gives the session less than the approved minimum', and 'counts no more network fee with the proceeds than a pool swap takes...' (the 3 ₳ cap). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6826` | E7a withinNet: a Danogo swap's net spend, fees or tokens beyond what was funded | direct-swaps.test.ts 'pauses rather than sign one that takes more of the session's ADA than was funded, into a pool', 'whose network fee and Minswap's take more than the funded costs...', and 'pauses rather than sign one that sells more of the token than was funded'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:863` | E7a quotesTheAsk: an estimate for another amount or pair | swap-quote-ask.test.ts 'refuses another amount, another pair, paths that don't add up or don't end on the tokens, and none' (pair, path ends, path sum); 'builds no Review it myself on an estimate asked for again for another amount (C40)' (routeOf's use). None for the amount_in field alone at :864 (see notes). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1603` | E7a: a route through an unchecked DEX or one the check can't follow, at quote (1603), order (4145-4152) and Review it myself (3202-3209) | Each of the six refusals fails its own tests in swap-routes.test.ts or direct-swaps.test.ts, e.g. 'pauses a funded swap whose fresh route goes through a DEX the wallet can't check...' and 'is refused if Minswap routes so anyway, whichever DEXes, on either network...'. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:342` | E7a excludedProtocols: routing through a DEX off MAINNET_PROTOCOLS, and Djed on both networks | Unchecked list: swap-routes.test.ts 'asks Minswap to leave out every DEX it offers that the wallet doesn't check...'. Djed on mainnet: sessions.test.ts 'leaves out of mainnet's routing the DEXes whose orders the check refuses...'. Djed on preprod: 'leaves Splash out of routing on preprod...'. The two Djed mutants were caught in the wide pass only. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4158` | E7a: placing an order when the fresh quote is under the approved minimum | swap-runner.test.ts 'builds the swap again by hand from the funding that copy spent...' and 'is the placed order's, once one is...'; swap-page-words.test.ts 'pauses so on the worker: approved through Danogo's pools...' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4163` | E7a slippageKeeping: Minswap's own minimum going under the approved one after a dip | swap-runner.test.ts 'is the approved one after a dip within the slippage, asked with the slippage that keeps Minswap's own there' (no dip handling, wrong minimum), and 'leaves Minswap's minimum, amount_out / (1 + slippage%) rounded down, at the least or above, a step under the bound' (the step). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4156` | E7a: a swap approved against Danogo's pools placed as an order | direct-swaps.test.ts 'pauses rather than place an order once Minswap routes it through one, before anything's built' (:4156), and 'pauses rather than sign an order build-tx makes of it...' (:4172). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4195` | E7a: Stop's cancel paying anyone but the session, or a cancel fee over 3 ₳ | sessions.test.ts 'cancels an order with the wallet's own cancel, everything back for a small fee, and pauses rather than sign one with a large fee (chunk 24, Step 3)' kills both. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:831` | E7a checkAsk: a malformed amount or token ID, the same token twice, slippage outside 0.1-20% | sessions.test.ts 'refuses an ask before Minswap sees it' kills all five, including the upper slippage bound alone. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1919` | E7a: funding a swap into a token that's neither ADA, listed, nor verified by Minswap by its exact ID | sessions.test.ts 'is verified only for ADA, a token the wallet lists, or one Minswap verifies by its ID...' kills outBuild's refusal and the exact-ID check. None for the is_verified flag at :1902 (t1k#8). |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/swap.ts:180` | E7a adaShort plus Swaps.tsx's ready gate: Review off when the balance can't fund the quote and collateral | adaShort and its collateral term: swap-form.test.ts 'says what ADA is short for a quote's funding and collateral'. None for Swaps.tsx:761's gate or :812 (t1k#9). |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/swap.ts:131` | E7a maxAdaIn: Max leaving out costs, collateral, reserve and FEE_ROOM | Each of the four terms dropped fails collateral-reserve-review-fixes.test.ts 'funds the ADA amount Max gives, with the collateral's mix where a 5 ₳ pool would take it' and up to 6 more. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:508` | E7a builtOutputs: an unreadable transaction throws before any check passes | none (t1k#14) |
| `seedelf-platform/seedelf-core/src/staking.rs:207` | E7b: a withdrawal of less than the whole balance, or from a key whose vote isn't delegated | RewardsLocked: staking_test.rs refuses_what_the_ledger_would. Whole balance: a_send_spends_the_rewards_too, a_move_in_spends_the_rewards_too, an_account_mint_spends_the_rewards_too and 2 more. |
| `seedelf-platform/seedelf-core/src/staking.rs:253` | E7b: Stop without the withdrawal, with a refund other than the deposit paid, or on an unregistered key | No withdrawal: withdrawing_and_stopping_bring_the_rewards_and_the_deposit_back, each_action_is_the_certificate_the_state_needs and refuses_what_the_ledger_would. Refund: each_action_is_the_certificate_the_state_needs (UnReg 2 ₳, not the 3 ₳ key_deposit). Unregistered: refuses_what_the_ledger_would. |
| `seedelf-platform/seedelf-core/src/staking.rs:238` | E7b: a first registration carrying anything but the current key_deposit | StakeRegDeleg: each_action_is_the_certificate_the_state_needs, the_first_delegation_pays_the_deposit_and_signs_with_the_stake_key and a_staking_transaction_still_spends_a_utxo_and_explains_a_shortfall. VoteRegDeleg: each_action_is_the_certificate_the_state_needs. |
| `seedelf-platform/seedelf-core/src/staking.rs:289` | E7b: a DRep registration with a guessed deposit | a_drep_refuses_what_the_ledger_would |
| `seedelf-platform/seedelf-core/src/staking.rs:309` | E7b: a DRep retirement with a refund of 0 | a_drep_refuses_what_the_ledger_would |
| `seedelf-platform/seedelf-core/src/staking.rs:315` | E7b: retiring while the vote is on the account's own DRep, without moving it to abstain | updating_retiring_and_voting_are_the_drep_keys |
| `seedelf-platform/seedelf-core/src/staking.rs:443` | E7b: an underflow when a deposit exceeds inputs plus rewards and refund | every_drep_transaction_builds_soundly ('Not enough ADA' for a 400 ₳ UTxO against the 500 ₳ deposit), not the named a_staking_transaction_still_spends_a_utxo_and_explains_a_shortfall. |
| `seedelf-platform/seedelf-core/src/staking.rs:457` | E7b: a patch after signing, or over a body already holding certificates, withdrawals or votes | a_patch_happens_before_signing_and_nothing_to_patch_changes_nothing kills both checks. |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:301` | E7b check_paths: signing a UTxO not under the account's payment key at its path (Rust; Vitest can't see it) | wasm/tests/api_test.rs staking::refuses_what_the_ledger_would (api_test.rs:3372); move_in::refuses_a_utxo_that_is_not_at_its_path; move_in::spends_the_payment_keys_money_whatever_its_staking_part; move_in::send_refuses_what_would_lose_money; account_mint::refuses_what_it_must_not_sign_or_write; account_mint::puts_up_the_collateral_set_aside_and_signs_for_it. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:529` | E7b: Withdraw or Stop while a send on its way withdraws the same rewards | incoming.test.ts 'has Stop staking and Withdraw rewards wait for a payment that withdrew the rewards' and staking.test.ts 'changes pool, delegates the vote, withdraws and stops, each its own pending kind'. They kill the whole check, Stop alone and Withdraw alone. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:523` | E7b: a DRep retirement built without Koios's positive deposit | none in Vitest (t1k#13); core's copy is pinned by a_drep_refuses_what_the_ledger_would. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:562` | E7b: a retirement review leaving out, or inventing, the move of the account's own vote | governance.test.ts 'says a retirement moves the account's own vote from the build's own read, as its transaction does' kills both. The state.registered term is an equivalent mutant (see notes). |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:384` | E7b send: sending a kept transaction other than the one reviewed, on the other network, or past its 10 minutes | Hash: mint.test.ts and transfer.test.ts 'refuses to send anything but the reviewed transaction', send.test.ts, minted-by.test.ts. Network: handlers.test.ts 'switches networks in a mainnet build... nothing kept sent on the other', mint and transfer. TTL: mint and transfer. staking.test.ts alone catches none of the three. |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/governance.ts:164` | E7b: an action shown open for votes in the epoch it expires in | governance.test.ts 'show an action's own words as Koios read them, and nothing that rewrites a line' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Staking.tsx:1021` | E7b: a staking review's 'Public account after' counting rewards twice or leaving out a fee, deposit or refund | none (t1k#10) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Staking.tsx:645` | E7b: Stop staking offered while the rewards are locked | none (t1k#11) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Pools.tsx:356` | E7b: delegating to a retired pool | none (t1k#12) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Voting.tsx:130` | E7b: delegating the vote to a retired or never-registered DRep | governance-screen.test.ts "won't send a vote to a DRep that has retired or never registered, and says which (Koios's two words)" |

## Checked and holds

- E6 balances.ts:489: isOwned -> true fails 37 tests in 6 files (balances 'owns none of the real contract UTxOs, or another phrase's' got 57962658 lovelace, not 0); deleting the trap rethrow fails private-index 'seals nothing from a read the WebAssembly trapped in...'. The lane had found no test.
- E6 register.rs:176: with the identity check dead, register_test.rs identity_register_is_owned_by_no_key, identity_public_value_is_owned_by_no_key and identity_generator_is_owned_by_no_key fail.
- E6 balances.ts:474: both halves pinned (withdraw 'leaves a UTxO carrying a reference script out of the balance and of Max'; balances and contract-scan for a Seedelf's UTxO).
- E6 koios.ts:67: no trim, datum JSON kept and script JSON kept each fail koios.test.ts '...however deep they nest (launch review H4)'.
- E6 koios.ts:92: measurable -> true fails coin-control '...a reference script Koios doesn't give (launch review #12)'.
- E6 contract-scan.ts:264: dropping the owner test fails private-index 'never takes another wallet's record for this one's'.
- E6 incoming.ts:113: freed-send and conflict mutants fail incoming.test.ts (5 tests and 1).
- E6 incoming.ts:158: all three changes to the take fail incoming.test.ts's rewards cases.
- E6 data-layer.ts:136: timeout -> koios and 5xx -> koios fail data-layer's 'is maybe sent on a timeout...' and '...on a 502/504...'.
- E6 koios.ts:1204: 429 read as maybe sent, and 5xx, lost or unreadable answers read as refused, each fail (koios, maybe-sent, dapp-maybe-sent, submit-answer).
- E6 koios.ts:1326: dropping the keyset cursor fails koios 'misses no UTxO when one before the page's end is spent between pages...'.
- E6 feed.ts:137: dropping the covered filter fails feed 'asks tx_status for one sent before every cursor kept...'.
- E7a checkOrder: 10 of 12 sub-checks pinned (sessions, order-cancel-check, sundae-orders).
- E7a withinFunding: the ADA limit, the fee in it and the call are pinned by sessions 'pauses rather than sign a swap that pays out more than was funded for it'.
- E7a cancelsChecked: the check and its 3 ₳ cost cap are pinned by order-cancel-check.
- E7a directSpends, checkDirect, checkProceeds and withinNet: every reachable sub-check is pinned by direct-swaps.test.ts (unknown rows by sessions.test.ts).
- E7a quotesTheAsk: pair, path ends, path sum and routeOf's use are pinned by swap-quote-ask.test.ts.
- E7a route checks: all six refusals at quote, order and Review it myself are pinned by swap-routes and direct-swaps; excludedProtocols' three lists are pinned by swap-routes and sessions.
- E7a PriceMoved, slippageKeeping (all three), Danogo's nowOrder (both), Stop's cancel (both), checkAsk (all five) and outBuild's verified refusal are pinned.
- E7a ui/swap.ts adaShort (both terms) and maxAdaIn (all four terms) are pinned by swap-form and collateral-reserve-review-fixes.
- E7b staking.rs: all 13 mutants across 207, 238, 253, 289, 309, 315, 443 and 457 fail staking_test.rs.
- E7b wasm lib.rs:301 check_paths: dead, it fails 6 api_test.rs tests, including staking::refuses_what_the_ledger_would. The lane hadn't checked this.
- E7b staking.ts:529 rewardsOnTheWay: the whole check and each kind alone are pinned (incoming, staking).
- E7b staking.ts:562 ownVoteMoves: invented and left out are both pinned by governance.test.ts.
- E7b script-spend.ts:384: the hash, network and TTL refusals are each pinned through mint, transfer, handlers, send and minted-by tests.
- E7b governance.ts:164: expiration instead of expiration - 1 fails governance.test.ts.
- E7b Voting.tsx:130: unregistered -> false fails governance-screen "won't send a vote to a DRep that has retired or never registered...". The lane had found no test.

## Notes

- Method: three rsync copies of TREE's seedelf-platform under $HOME/.cache/seedelf-review-51/T1k (copy a, plus b and c for parallel batches), each with a symlink to TREE's node_modules, and Cargo at T1k-target. One mutant at a time per copy, applied by exact text replacement (one occurrence asserted) and put back from TREE's bytes before the next. Each copy was diffed against TREE after every batch: 0 differences. Every copy and the target are removed. TREE has 0 tracked changes, and I added nothing to it.
- Only committed tests were counted. Other verifiers' untracked r51-* tests in TREE were never run. Two demonstration tests (registerOf shapes, cover) lived only in copy c and are deleted; their cases are in t1k#1's and t1k#4's fixes.
- First passes ran the lane's named tests plus that area's files. Every TS mutant that survived was run again over a wide set: every swap and session test (31 files, 429 tests) for E7a, or the area's 10-15 files for E6. The wide pass caught 4 first-pass survivors: refuseOddities' key list, directSpends' unknown rows, and excludedProtocols' two Djed entries.
- Load average was about 70 on 12 cores. One wide run failed only on a 5,000 ms timeout: restore-scan 'offers 5 ₳ where the account's ADA alone is each under 5 ₳, or holds tokens...', under contract-scan.ts:233's mutant. The rerun passed 273/273, so it isn't counted as a catch. That test may flake under load. Every other catch failed on an assertion or a mutant-caused error (a TypeError reading a missing cursor; the call-stack overflow koios's H4 test expects). None was an environment error.
- Rust guards the extension reaches through WebAssembly were mutated in Rust and checked only with cargo, because wasm/pkg in the copies was TREE's build. That covers register.rs, wasm/src/lib.rs check_paths and staking.rs.
- 'stranger' on the E7a findings (t1k#5 to t1k#8) means Minswap's estimate or build-tx answer: a third-party service that the session checks rather than trusts, and not one of the brief's trusted data sources. No finding claims a live bug: every guard holds today, and each finding is a missing test.
- Uncaught sub-checks kept out of findings as equivalent or unreachable. chain.ts:63 (`length > POINT_BYTES` inside the chunk loop) is equivalent, since :67 refuses the same inputs. register.rs:190's generator-identity half is equivalent: identity^x is the identity, which only an identity public value matches, and the other half refuses that. staking.ts:562's `state.registered` term is equivalent, since stakeInfoOf gives drep null for an unregistered key. sessions.ts:6754's `w.account.charAt(0) !== "f"` is redundant: `stakes` holds only script hashes.
- More uncaught sub-checks, unreachable today. sessions.ts:4288's `checked.length !== orders.length` needs WebAssembly's own checkOrderCancels to answer short. sessions.ts:864's `est.amount_in !== ask.amount` overlaps the path-sum check; it differs only if Minswap's amount_in contradicts its own paths, and then only the approval's 'amount in' figure is off. incoming.ts:124's `inputs.length > 0` matters only for a kept transaction the wallet can't read (inputsOf returns []). koios.ts:96's size half needs Koios's size and bytes to disagree, and core's reference_script_size refuses that UTxO in every build anyway (utxos.rs:363). None of these four is caught by its area's wide pass.
- Lane test names that didn't pin their guard. E6#6's 'ends cleanly when a lock gets in partway' passes without `same`. E6#11's 'is maybe sent when Koios calls spent what a lost connection may have sent' failed under neither submitFallback mutant; data-layer's 502, 504 and timeout cases did. E7b#6's staking.rs net is caught by every_drep_transaction_builds_soundly, not the shortfall test. E7b#14's staking-screen.test.ts:98 checks the withdrawal note, not the after row. For E7b#12, staking.test.ts alone pins none of send's refusals; other flows' tests do.
- Lanes that said none found or not checked, but a test pins the guard: E6#2 (balances.ts:489), E7b#8 (check_paths, api_test.rs:3372) and E7b#17 (Voting.tsx:130, governance-screen).
- For the owner: of the E7a gaps, t1k#5's certificate term matters most. withinFunding counts outputs and the fee, not deposits, so if that refusal ever regressed, a build could add witness-free certificate-0 registrations that each take 2 ₳ of the session's funds where its maker can reclaim them. A test there is cheap.
- No memory, CLAUDE.md or skill was written or edited. No network calls were made, apart from what the copies' tests do under their own fakes.

## Coverage

Tried all 53 lane guards: E6's 15, E7a's 20 and E7b's 18. None was duplicated across lanes, since the three lanes cover different files. Order followed the brief: first the guards whose test was none or unknown (E6#2, E6#8, E7b#8, #10, #12, #15, #16, #17), then those on a stranger's input (E6#0, #1, #3, #4, #5 and the Minswap checks), then the rest. In all I ran 168 mutants: E6 43, E7a 93, E7b 32. That is 155 Vitest and 13 cargo staking_test, plus 3 crypto and 1 wasm Rust mutants run by hand. On top came 30 wide-pass reruns and 11 demonstration runs. Not tried: the 'reads token by token' performance property of chain.ts:84 (no simple mutant); blstrs's own torsion refusal (third-party code); koios.ts submitTx's TxSubmitConnectionError retry and paged()'s 'nothing new' stop (a hang guard, not the money one); stake()'s own call to check_paths apart from the shared check; refuseSent and laterParts in script-spend.ts. Playwright wasn't run (the brief forbids it), so e2e may pin the UI gates in t1k#9 to t1k#12. Rust guards were checked only by their crate's named test files (staking_test, register_test, api_test), not the whole workspace.
