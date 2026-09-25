# Chunk 16: Lovejoin

[Lovejoin](https://github.com/logical-mechanism/Lovejoin) is a Cardano mixer. You lock fixed 10 ₳ boxes in a shared pool, anyone can mix boxes together, and the owner later takes a box out with a proof. This chunk builds it into the wallet in two places:

- **The last step of a private session's return.** When a session comes back with ADA to spare, that ADA goes through Lovejoin before it reaches the private balance.
- **A Lovejoin tile in the dApp browser,** used on its own.

**Why (the user, 2026-09-25):** a private session is a one-time account, and today its return lands in Seedelf linked to it. If several returned UTxOs are later spent together, those sessions are tied together on chain, which is the very thing private sessions exist to prevent. Lovejoin breaks the link between a session and the money it brings back. Transaction chaining matters here, and the user expects it to be "worth it". Branch: `web-wallet/lovejoin`, taken from `seedelf-web-wallet` after PR #262 merged.

## Decided (the user, 2026-09-25)

1. **No fee shards and no giveme.my in the chain.** The session pays every deposit and mix fee, and its own 5 ₳ UTxO is their collateral. giveme.my can't witness a chained transaction ([chunk 15](chunk-15-dapp-connector.md), *Private interactions*).
2. **The chain is built locally and optimistically.** Each transaction is built on the outputs of the one before it, without waiting for the chain. **Script budgets come from an evaluator running in WebAssembly.** Build for a healthy pool of boxes.
3. **Fan-out 3 wide.** Depth is a setting from 1 to 3, **default 2**.
   - Every output of each wave is mixed again in the next wave, as Lovejoin's own `strategy/fanout.ts` does. So which leaf is yours stays hidden whoever pays.
   - Depth 2 is 4 mixes per box, about 3.5 ₳, and 9 leaves (a 1 in 9 chance of linking).
4. **Each box is withdrawn on its own, after its own random delay.** The range is a setting, default **1–6 hours**.
   - The withdraw runs at the first unlock after the delay, since the proof needs the key.
   - giveme.my's collateral, fee paid from the box, into a **fresh Seedelf register** for each box.
   - The session is never on it.
5. **The boxes are owned by the Seedelf key.** A Lovejoin box's datum `{a, b}` with `b = x·a` has the same shape and encoding as a `Register`. So the scan the wallet already runs finds its boxes anywhere in the pool, after other people's mixes too, and after a restore.
6. **Tokens don't go through Lovejoin; it takes ADA only, in 10 ₳ boxes.** A session mixes as many 10 ₳ boxes as its spare ADA pays for.
   - The tokens and the leftover ADA come back directly, **merged into the session's own funding change**: the Seedelf UTxO its funding made, already linked to it on chain.
   - If that change has been spent, they come back in a new UTxO, as today.
7. **Which returns go through it:**
   - a swap that runs itself (after a fill or Stop; its approval says so)
   - hand-run Bring it back
   - site sessions
   - Bring everything back (each session gets its own chain)
8. **The standalone tile takes money from either side.**
   - **Private balance** goes through a one-time account.
   - **Public account** goes straight in, paying with the account and using its collateral.
   - Both end in the private balance, unlinked.
9. **Lovejoin's website is out of scope.** It's an unfinished idea; the feature belongs in the wallet. Ask the user if a Lovejoin doc looks wrong.
10. **One collateral for the whole chain.** The session's 5 ₳ UTxO is the collateral of every transaction in its chain, even within one block, as long as nothing spends it before the chain ends. The last transaction spends it back into Seedelf. Koios may not like chained submits; we'll see what happens.

## Found before planning (2026-09-25)

**The protocol** (contracts in `_reference/Lovejoin/contracts/validators/`):

- **Boxes and datums:** 10 ₳ ADA-only boxes (`denom_lovelace`, fixed on chain). The datum is `MixDatum { a, b }`, 48-byte compressed G1 points, `Constr 0 [bytes, bytes]`, with `a ≠ b`.
- **Deposits** aren't validated: any output at `mix_box` with a well-formed inline datum is a box.
- **Mix:** a withdraw-zero of `mix_logic` with `Mix { proofs }`, one N-way sigma-OR proof per input, N ≥ 2.
  - The N outputs sit at positions 0..N−1, each exactly 10 ₳, at the enterprise `mix_box` address, with an inline datum.
  - Later outputs must not be at `mix_box`.
  - Context: `blake2b_256(serialise_data(datum_0) ‖ … ‖ serialise_data(value)×N ‖ mix_hash)`.
  - A mix that no fee shard pays needs no signer and has no N ≥ 3 floor.
- **Withdraw:** `Owner { proofs }`, one Schnorr proof per box, **no signer**.
  - Context: `blake2b_256(serialise_data(tx.outputs) ‖ serialise_data(input refs) ‖ mix_hash)`.
  - It commits to every output, so nobody can redirect it.
  - The domain tag is `lovejoin/sigmajoin/v1/`, different from Seedelf's own proof, so a proof from one can't be replayed in the other.
- **Deployment:** preprod only. Mainnet's config hashes are still `null`. The preprod addresses are in `_reference/Lovejoin/artifacts/preprod/addresses.json`.

**Measured on preprod:**

| | Fee | Steps (limit 10 billion) |
|---|---|---|
| 3-box mix, wallet-paid | 0.877 ₳ | 5.73 billion |
| 3-box mix, shard-paid | 0.893 ₳ | 5.73 billion |
| 4-box mix, wallet-paid | 1.27 ₳ | 9.78 billion (why the width stays 3) |
| 4-box withdraw | 0.463 ₳ | |

- The pool held 98 boxes.
- A fan-out per 10 ₳ box costs about 0.9 ₳ at depth 1, 3.5 ₳ at depth 2 and 11.4 ₳ at depth 3.

**Check 1: local evaluation with Aiken's `uplc`.**
- I replayed five real preprod transactions:
  - a Lovejoin 4-box withdraw
  - wallet-paid 3- and 4-box mixes
  - a shard-paid mix
  - a 6-input Seedelf spend
- `uplc` **1.1.23 matched all 25 redeemers' on-chain budgets exactly**, natively and in WebAssembly (16–68 ms a transaction in Node), under both the 297- and the 350-parameter V3 cost models.
- `uplc` **1.1.21 isn't enough.** It reads the Plomin bitwise builtins only when there are exactly 297 parameters, so under protocol 11's 350 it mis-costs them (a 4-box mix ran out of budget by orders of magnitude). Separately, it failed all three mixes.
- 1.1.23 depends on Pallas 0.35.

**Size:**
- Our module is 484 KB gzipped today, and 697 KB with the evaluator linked in (+213 KB).
- On its own, the evaluator is a 309 KB module.

**Check 2: Pallas.**
- No version stages withdrawals: 0.33, 0.35 and 1.4.0 all write `withdrawals: None // TODO`. `RedeemerPurpose` has no `Reward`, and its script-data hashing is private.
- We patch them in, as `staking.rs` already patches certificates.
- **The workspace on Pallas 0.35:** `pallas-txbuilder`'s source is identical to 0.33's. The workspace compiled, and **every Rust test passed with only the version numbers changed**, the frozen key-derivation vectors included.

**Lovejoin's own UI has a trap:** its withdraw output has no datum, and it tells users to withdraw to "a Seedelf address". Seedelf's `wallet.ak` lets anyone spend a datum-less UTxO (`None -> True`). This is worth an issue on the Lovejoin repo; it doesn't affect us, since we write the register.

## Decided in the design (mine, for the user to overrule)

- **Pallas moves to 0.35 first,** as its own commit, before any Lovejoin code. `uplc` 1.1.23 needs it, and it leaves one copy of Pallas in the module.
- **One WebAssembly module,** with the evaluator in it (+213 KB gzipped). The builders can then evaluate inside Rust (draft → evaluate → finish in one call).
  - The other way is a second module of 309 KB, loaded only when needed.
- **Every script transaction evaluates locally,** today's Seedelf spends included (one Koios request fewer each).
  - Koios's `/ogmios` evaluate stays as a **check on the first transaction of each chain**, whose inputs are on chain. If the two disagree, the chain doesn't start. That's what a hard fork the evaluator doesn't know yet looks like, as protocol 11 was for 1.1.21, and it keeps the session's collateral safe.
- **Proof nonces are deterministic,** ported from Lovejoin (`offchain/src/crypto/nonce.ts`). Its test vectors (`crypto/test-vectors/`) then check our proofs byte for byte.
- **One chain per session, in this order:**
  1. The deposit (all its boxes in one transaction).
  2. Wave 0 of each box's tree.
  3. Wave 1 in a random order.
  4. The leftover's return.

  One change output carries the fee from each transaction to the next. The collateral UTxO is never spent until the return.
- **How many boxes:** the most `k` for which 10 ₳·k plus the chain's fees fits in what the session holds.
  - Held back: the 5 ₳ collateral, the tokens' minimum ADA, and the return's fee.
  - Example: 50 ₳ at depth 2 makes 3 boxes (30 ₳ in, about 10.5 ₳ of mix fees), and about 9 ₳ comes back directly with the collateral.
  - Under one box, the return is plain.
- **The leftover's return is the chain's last transaction** (decision 10). It spends the collateral UTxO back into Seedelf and also names it as its own collateral. The first build confirms that the ledger takes one UTxO as both: offline with phase one, then on preprod. If it doesn't, the return names the chain's last change output as its collateral instead.
- **Boxes aren't remembered, they're found.**
  - Other people's mixes move them, so the scan is the truth.
  - What's stored (sealed, per network) is a list of due times, one per box a chain put in.
  - At unlock, each due time that has passed withdraws one owned box.
  - A box found with no due time (after a restore) gets one drawn then.
- **The Private tab shows "In Lovejoin"** (count and ₳) under the balance. The Lovejoin page has **Withdraw now** for a box, which skips its delay and says what that costs in privacy.
- **A transaction in a chain that fails** (someone else's mix took a pool box first) is built again with fresh pool boxes, and so is everything after it.
- **Pool boxes for a mix** are drawn at random from the unspent boxes. Our own boxes and anything our unsent chains use are left out, as are boxes whose points don't decompress to valid G1 points.

## Design

**Rust: `seedelf-crypto`**
- A new `lovejoin` module:
  - FS hashes with the domain tag
  - the Schnorr prover
  - the DH-tuple sigma-OR prover (real branch plus simulated ones, XOR-composed challenges)
  - the verifiers (for tests)
  - deterministic nonces
- It uses blstrs, like the rest of the crate. Lovejoin's `crypto/ref` is verifiers only (blst), a reference, not code to take.

**Rust: `seedelf-core`**
- **`lovejoin.rs`:**
  - The preprod constants (bundled from `addresses.json`: the reference UTxO and its datum, the script hashes, the reference-script UTxOs and their scripts; mainnet `None`).
  - The builders:
    - `deposit`: a key account → k boxes plus change, key-signed.
    - `mix`: N boxes → N re-randomized boxes in a random order, plus the payer's change; the payer's collateral; reference inputs; the withdraw-zero.
    - `withdraw`: boxes → one fresh register at `10 ₳ − fee`; giveme.my collateral; the withdraw-zero.
  - The two contexts: Mix, and Owner with the V3 `TxOut` as the ledger encodes it.
- **`eval.rs`:** `uplc::tx::eval_phase_two_raw_with_protocol` over the built transaction and its resolved inputs (reference scripts included), giving `Budgets`. It sits next to `Budgets::from_ogmios`, which becomes the cross-check.
- **A script-withdrawal patch** (`staking.rs`, or its own file):
  - add `{reward account: 0}`
  - append the `Reward` redeemer
  - recompute the script data hash (our own copy of Pallas's `scriptdata.rs`)
  - recompute the body hash
  - Patch first, then sign, as `Staking::patch`.
- **The merge return:** a `ScriptSpend` with the session's key inputs, one Seedelf input (the funding change) and the session's collateral. Its output is one fresh register, or ⌈tokens/20⌉ of them.
- **Chains:** each builder takes the UTxOs the chain has made so far (its local view), not Koios rows only.

**WebAssembly** (`wasm/src/lib.rs`, a new `lovejoin.rs`):
- `buildLovejoinChain(request)`: the whole chain for a session or a standalone source, built, evaluated and signed. It returns each transaction's CBOR and hash, in order.
- `buildLovejoinWithdraw(request)`: one box into a fresh register, ready for giveme.my.
- `ownedBoxes(rows)`: the pool rows the Seedelf key owns (the `isOwned` check on `{a, b}`).
- `sessionReturn` gains the merge target and becomes a script spend when there is one.

**Worker**
- **`lovejoin.ts`:**
  - Read the pool: Koios `credential_utxos` on the `mix_box` hash, paged.
  - The chain runner: record every transaction before sending, send in order, rebuild from a failure, confirm by `tx_status`.
  - The withdraw schedule and its sealed due times.
  - It runs from the `seedelf.sessions` alarm and at unlock, like the swap runner.
- **`sessions.ts`:** `buildBack`, `claimBuild` and the runner's `bringBack` go through `lovejoin.ts` when the session has at least one box's spare ADA. The record gains `lovejoin?: { boxes, depth, txs }`, and the return waits for its chain.
- **Settings:** `lovejoin.depth` (1–3, default 2) and `lovejoin.delay` (a range in hours, default 1–6).

**UI**
- **The dApps page gets a Lovejoin tile.** Its page shows:
  - your boxes in the pool, and when each comes back
  - Withdraw now
  - *Mix*: from the private balance or the public account, in 10 ₳ steps, with the fee shown
- **The review of every return that uses it:** how many boxes, the fan-out, the fees, when the money comes back, and a *Bring it back directly* switch for that one return.
- **The swap approval** says a filled swap's ADA comes back through Lovejoin.
- **Settings:** *Lovejoin*, with depth and delay, and each depth's cost per box.
- **Home's Private tab:** *In Lovejoin*.

**Koios requests**
- A session's return with k boxes at depth 2:
  - one pool read
  - one evaluate cross-check
  - 4k + 2 submits
  - `tx_status` for the chain's last transaction until it's in
- A withdraw: one pool read (shared by every withdraw due at that unlock), giveme.my, and one submit.
- The reference UTxO and scripts are bundled, not queried.

## Build order

1. **Pallas 0.35** across the workspace. Every test green, the module rebuilt, the size noted.
2. **Local evaluation:**
   - `uplc` 1.1.23 in `seedelf-core`.
   - `ScriptSpend` evaluates locally.
   - The five recorded preprod transactions become fixtures that must match exactly.
   - The Koios cross-check.
3. **The script-withdrawal patch.** Rebuild the script data hash of the recorded Lovejoin withdraw and mix and compare it with their bodies.
4. **The `lovejoin` crypto,** with Lovejoin's test vectors: Schnorr, the sigma-OR at N 2, 3, 4 and 6, the negatives, and encoding parity.
5. **The builders:** deposit, mix and withdraw, each **evaluated offline against the deployed validators** (recorded pool boxes and the bundled scripts). A wrong context or proof fails here, not on chain.
6. **The chain runner and the session returns,** with the merge into the funding change, and the collateral-as-input question settled.
7. **The withdraw schedule and the pool scan.**
8. **The tile, the settings and the review screens.**
9. **A live preprod run, on the user's go-ahead:**
   - a session return with two boxes
   - a standalone from each side
   - the delayed withdraws
   - a chain rebuilt after a collision

## Tests

- **Rust:**
  - the KATs
  - replay of the recorded transactions (exact budgets)
  - builders evaluated against the real scripts
  - the patch's hashes
  - the choice of k
  - a withdraw's output is `is_payable`
- **Vitest:**
  - the runner: order, recording before sending, a rebuild after a failed middle transaction, a restart halfway through
  - the schedule: due times, restore, Withdraw now
  - the returns choosing Lovejoin or plain
- **Playwright:**
  - the tile's page
  - a return's review with the switch
  - Settings

## Risks and things to check

- **Chained submits through Koios's load-balanced tier:** a child can reach a node that hasn't seen its parent yet. Retry after a few seconds, and measure it on preprod.
- **Hard forks:** they can change the cost model faster than `uplc` releases, as protocol 11 did. The cross-check stops the chain rather than risk the collateral.
- **The pool's size:** the design assumes a healthy pool (decided). With too few fresh boxes for a tree, the return is plain and says why.
- **Collateral:** whether the last transaction can name the UTxO it spends as its own collateral (see *Decided in the design*).
- **Mainnet:** Lovejoin isn't deployed there, so the tile and the return step are preprod-only until it is.

## Built (2026-09-25, first session)

**Rust:**

- **`seedelf-core::eval`:** `uplc` 1.1.23 runs inside the wallet and answers in Ogmios's shape.
  - It evaluates against Koios rows, a chain's own unsent outputs, and bundled reference outputs (`references.rs`: Seedelf's four and Lovejoin's three).
  - The five recorded preprod transactions (`tests/fixtures/eval-preprod.json`) match to the unit.
- **`seedelf-core::withdraw_zero`:** the withdrawal, its `Reward` redeemer, and the script data hash recomputed.
  - That hash equals the recorded transactions' own.
  - `Budgets` gains `withdraw`, `with_margin` and `covers`.
- **`seedelf-crypto::lovejoin`:** Lovejoin's Schnorr and sigma-OR provers with its RFC 6979 nonces.
  - Byte for byte on its vectors: 30 Schnorr and 50 sigma-OR (N 2, 3, 4, 6, 8); its 84 negatives are refused.
  - The vectors are a credited subset, `tests/vectors/lovejoin_v1.json`.
- **`seedelf-core::lovejoin`:** `deposit`, `mix`, `withdraw`, `owner_context`, `chain`, and `boxes_affordable`.
  - Offline, against the deployed scripts: a mix of real pool boxes passes `mix_logic`, and deposit → mix → mix → withdraw chains before anything is on chain.
  - The withdraw context read from the recorded withdraw verifies that transaction's own proofs.
- **WebAssembly (`wasm/src/lovejoin.rs`):** `planLovejoin`, `buildLovejoinChain`, `lovejoinOwned`, `buildLovejoinWithdraw`, `finishLovejoinWithdraw`.
  - The chain is signed by the session's key: the deposit, the mixes, then the return of the last change, the collateral and any token UTxOs into fresh registers.

**Worker:**

- **`lovejoin.ts`:** reads the pool, plans, builds, schedules, and handles `status`, `withdrawDue` and `withdrawNow`.
- **`sessions.ts`:**
  - `buildBack` takes the chain unless the review asks for `direct`.
  - `sendBack` sends the chain in order, trying a child again up to 4 times when Koios hasn't seen its parent.
  - The kinds `deposit` and `mix` are recorded.
  - Due times are set once the deposit is in.
- **`sw.ts`:** runs the due withdraws at unlock and on the sessions alarm.
  - The unlock scan reads the pool only on a wallet that has used Lovejoin on this device, so Home's requests are unchanged for everyone else.
  - A restored wallet's boxes get their due times when the Lovejoin tile opens.
- **Settings:** `lovejoinDepth` and `lovejoinDelay`.
- **Requests:** `lovejoin-status` and `lovejoin-withdraw-now`.
- **History:** a withdraw is `lovejoin-withdraw` in the banner and the private Activity.

**UI:**

- The return reviews on Minswap's page and a site session's page show the boxes, the fan-out, the fees and when each box comes back, with **Bring it back directly instead**.
- Bring everything back counts the boxes.
- Settings gains a *Lovejoin* section (preprod), with each depth's cost.
- The dApps page gains a **Lovejoin** tile: your boxes in the pool, the next one due, and **Bring one back now**.

**Tests:**

| Where | New |
|---|---|
| `seedelf-core` | `eval_test` 5, `withdraw_zero_test` 5, `lovejoin_test` 11 |
| `seedelf-crypto` | `lovejoin_test` 6 |
| `seedelf-wasm` | `lovejoin_test` 4 |
| Vitest | `lovejoin.test.ts` 6: a 40 ₳ session's ten-transaction chain built, measured, sent in order and scheduled, against 20 recorded preprod pool boxes |

Totals: Rust 312, Vitest 273, Playwright 47 (unchanged).

**Departed from the design:**

- **Today's Seedelf spends still ask Koios to evaluate them.** Switching them would re-record most of the extension's fixtures, and Lovejoin doesn't need it. Local evaluation is used where chains need it.
- **The Koios cross-check on a chain's first transaction isn't built.** The recorded fixtures pin `uplc` against the chain instead.
- **The WebAssembly module is 739 KB gzipped,** not 697: Lovejoin's builders and the bundled references come on top of `uplc`.
- **The return is still a key-signed sweep into new registers,** not merged into the funding change (below). So the question of the collateral as an input doesn't arise yet: the return spends it as an ordinary input, and no script runs.
- **A chain that fails partway isn't rebuilt from where it stopped.** Its error shows. Boxes already deposited are the wallet's and are found by the scan, and bringing the session back again returns what's still at its account (plainly, or through a new chain).

**Not done yet** (after the first session; the second session built items 1 to 6, below):

1. The merge of the leftover and tokens into the session's funding change.
2. The tile's own mixing, from the private balance through a one-time account and from the public account.
3. The swap approval's words about Lovejoin. A swap that runs itself already goes through Lovejoin on its way back.
4. Home's *In Lovejoin* row (the dApps tile shows it instead).
5. The Koios cross-check.
6. End-to-end tests for the tile and the review.
7. **A live preprod run** (on the user's go-ahead): a session through Lovejoin, then its withdraws.

## Built (2026-09-25, second session)

**The merge into the funding change.**

- **Core:** `ScriptSpend::with_account(account, inputs, collateral)` makes a Seedelf spend also take a key account's UTxOs and put up that account's collateral instead of giveme.my's.
  - The redeemers point into the ledger's order of all the inputs, the account's included.
  - It refuses UTxOs under another key, a collateral holding tokens, and a UTxO spent twice.
  - **The proofs stay bound to a new one-time key** (privacy rule 1), never the account's. A site connected to a private session can ask the session's key to sign. A proof bound to it could then be replayed in a transaction the site built, if the user approved it. So the merged return has two signatures: the one-time key's and the session's.
  - `ScriptSpend::measure_locally(known)` drafts, measures in the wallet (`uplc`, with the bundled Seedelf references), finishes, and measures the finished transaction again.
- **WebAssembly:** `api::merged_return` builds it. `buildSessionReturn` and the Lovejoin chain's last transaction take `merge`, the funding's change.
  - The collateral is the session's 5 ₳ UTxO, which the return also spends. The ledger's rules don't forbid one UTxO as both; the live run confirms it.
  - Without a funding change to merge into, the return is the plain sweep into new registers, as before.
- **Worker:** `sessions.ts`'s `fundingChange` finds it: the private balance's UTxOs from the session's `out` transactions, not locked, up to four.
  - A return refused for spending something already spent makes the next contract read a full one, so a change spent elsewhere isn't offered again.
- **UI:** each return's review says *Into: The private UTxO its funding made* or *New private UTxOs*, and its privacy note follows.

**Mixing from the tile.**

- **From the private balance:** a mix session. Its funding is a one-time account paid what the boxes, their mixes and the deposit take (`lovejoin::funding_for`, which `boxes_affordable` gives back exactly), plus its 5 ₳ collateral.
  - The record has `mix: { boxes }` and `auto`, so the swap runner takes it. Once funded, it's the session's return through Lovejoin with that many boxes.
  - The leftover merges into the funding's change.
  - The pool is checked before the funding: each box needs `2 × mixes` other boxes.
- **From the public account:** `lovejoin::chain_from_account`.
  - The deposit takes as few ADA-only UTxOs as pay for it (largest first), signed by their keys.
  - Every mix pays from the change at `0/0` and puts up the account's collateral, signed by the change's key and the collateral's.
  - The change stays in the account; there's no return.
  - `Funding` and `Payer` now carry how many keys sign, so each fee covers the witnesses.
  - The account needs a collateral set aside (Settings, *Collateral*); the page says so otherwise.
- **The change floor:** a deposit or mix never leaves change under an output's least, so a chain can't be built to fail on chain.
- **UI:** the Lovejoin page has *Mix*:
  - from the private balance or the public account;
  - a count of boxes, 1 to 10;
  - what it takes (the mixes, their fees, the funding);
  - a review for each side;
  - the latest five mixes from the private balance, with how each is doing.

**The Koios cross-check.** Before a chain is used, Koios's Ogmios measures its first mix, given the unsent deposit as `additionalUtxo`.

- `eval::ogmios_utxos` writes the deposit's outputs. `eval::declared_covers` compares Ogmios's answer with the budgets the mix declares.
- **If the network measures more, or refuses a script, the chain doesn't start.**
  - A session's return comes back directly and says why (`lovejoinSkipped`, shown on its review; a mix session records it as `mix.skipped`).
  - A public mix refuses, and nothing is sent.
- A Koios error is thrown as it is, so the runner tries again later.
- So is a pool too small for the boxes: the return comes back directly.

**The swap approval** says that spare ADA goes through Lovejoin on the way back, with the depth and the wait from Settings.

**Home's *In Lovejoin* row** (`lovejoin-held`) is read from this device's schedule alone, with no Koios request: the boxes on their way back, what they hold, and when the next is due. It opens Lovejoin's page.

**A request left out of `rpc.ts`'s list is now a type error.** The worker drops an unlisted request as unknown, silently, which is how the first build of the funding preview failed.

**Tests:**

| Where | New |
|---|---|
| `seedelf-core` | `merge_test` 2 (the merged return passes the deployed wallet contract; the refusals), `eval_test` +2 (the cross-check on every recorded transaction; the Ogmios UTxOs), `lovejoin_test` +2 (funding for k boxes; the change floor) |
| `seedelf-wasm` | `session_test` +1 (the merged return), `lovejoin_test` +3 (the merged chain; the funding call; the public account's chain, one and two signing keys) |
| Vitest | `sessions.test.ts` +2 (merged, or new UTxOs when the change is gone); `lovejoin.test.ts` +5 (the cross-check's request, a disagreement, a refused script, a mix session end to end, the pool and box-count checks, a public mix) and `held` |
| Playwright | the Lovejoin page (both sides, the cost, a public mix sent, Home's row); a site session's return through Lovejoin, then directly |

Totals: Rust 322, WebAssembly (Node) 33, Vitest 280, Playwright 49. The module is 760 KB gzipped.

**Departed from the design:**

- **The merged return has two signers,** not one: the proofs stay on a one-time key (above).
- **A chain that fails partway still isn't rebuilt from where it stopped.** Once a deposit is recorded, the session's next return comes back directly rather than deposit again.
- **The tile's count is capped at 10 boxes,** and the pool must hold `2 × mixes` other boxes for each.

**Found in the user's first run on preprod (2026-09-25):**

- A 3-box mix from the private balance went through, return included.
- **Bring one back now failed with `InsufficientCollateral (DeltaCoin 434416) (Coin 434417)`.** The withdraw's fee was odd (289,611), and giveme.my's collateral return, 5 ₳ − 3/2 × fee rounded down, left half a lovelace less than the ledger's 150%, which it rounds up. The withdraw's fee is now rounded up to even, as every Seedelf spend's is. `lovejoin_test` checks the ledger's rule on a mix and on seven withdraws; on the old code it fails with those exact numbers. Mixes were never affected: their collateral return adds 1.
- **Bring one back now showed nothing but one box fewer.** The withdraw wasn't the watched transaction, and a dApp's page never showed Home's banner.
  - Now the withdraw is the watched transaction, as every send the user makes is.
  - Home's banner is a shared component (`PendingBanner`), passed through the dApps page to Lovejoin's. A withdraw or mix sent from there shows *sent, waiting for the network*, then that it's back, and Home keeps asking while the page is open.
  - The withdraws due by themselves stay out of the banner: they show in the private Activity.
- **A swap's return through Lovejoin stopped after its deposit and 6 of its 12 mixes, and the swap then waited for good.** The 7th mix's submit failed, most likely Koios not answering (a timeout the user also saw elsewhere at that moment).
  - The runner only brought a swap back once something arrived from outside. After a chain, everything at the account came from the chain itself, so it waited, and Stop waited too.
  - Now a return whose chain has started (a deposit or a mix recorded) brings what's left back directly, whatever Minswap lists.
  - The timeline said *filled* all through the chain; it says *coming back* once the deposit is recorded.
- **A chain's submit that Koios doesn't answer** (a timeout, a lost connection, 429, 5xx: `KoiosBusyError`) is sent again, up to 4 times, 10 s longer each time, as a submit Koios hasn't seen the parent of already was. Sending the same transaction again is safe.
- **Koios's public tier allows 100 requests every 10 s per IP address** (and 5,000 a day). Every request the worker makes now waits its turn under a shared limit of 60 every 10 s (`RateLimit`, `KOIOS_LIMIT` in `koios.ts`), retries included, so no burst (a 132-transaction chain, several screens reading) can reach it.

## Handoff to the third session (2026-09-25)

**The branch.** `web-wallet/lovejoin`, pushed through `18b4847`: the second session `7db8117`, then the live-test fixes `db35e24`, `8e65bc0` and `18b4847` (the stopped return, a submit Koios didn't answer, the rate limit, and this handoff). Nothing was left uncommitted. No PR yet.

- **Suites:** Rust 322, WebAssembly (Node) 33, Vitest 286, Playwright 49. `extension/dist/` holds the dev build, which the user loads directly.

**The user's live testing on preprod, where it stood:**

- **Worked:** a 3-box mix from the private balance, its return included (*Done*).
  - Not checked yet: whether that return merged into the funding's change, the collateral's first use as an input of the same transaction. On Cardanoscan, the one-time account's last transaction would show a collateral input and a script redeemer.
- **A MIN → ADA swap stopped partway:** its return deposited 3 boxes, then ran 6 of 12 mixes. The session account's payment key is `e39622e1…`; the order is `20aadac3…` and the deposit `952fd89f…`. The user pressed Stop.
  - With `18b4847`, reloading and unlocking brings the 12.6 ₳ of change and the 5 ₳ collateral back directly. Confirm with the user that it did.
- **Bring one back now:** it failed on the odd fee (fixed in `db35e24`), then once on a Koios timeout, which was transient. Confirm a withdraw landed.

**Decided for next (the user, 2026-09-25).** Both built in the third session (below).

1. **Mix my boxes again**, on the Lovejoin page: every box of the wallet's in the pool, fanned out again at the Settings depth.
   - **Paid from the private balance through a fresh one-time account**, like *Mix from the private balance*: one review, then it runs by itself, and what's left merges back.
   - The user chose this over the public account, which would tie it to boxes that may trace back to private sessions.
   - A sketch:
     - core: a chain that starts from the wallet's own `PoolBox`es, with no deposit;
     - WebAssembly: a call for it;
     - worker: a mix session that carries the boxes' outrefs, funded with their mixes' fees and the reserve, and whose runner builds that chain;
     - keep the due withdraws off those boxes while it runs, or the chain meets a spent box.
   - The user's reason: a chain cut short, or boxes someone else was mixing; a button to try again.
2. **A warning before auto-lock: a countdown in the wallet only.** In the last 2 minutes, a banner on every screen ("Locking in 1:30") with **Stay unlocked**.
   - The user turned down the toolbar badge, holding the lock while a chain is sent, and counting mouse movement as activity.
   - The deadline is the last activity (`seedelf.lastActivity`) plus the lock time; the auto-lock alarm checks it every minute.

**Offered, not decided (ask before building):**

- Each box's due time on the Lovejoin page, and a Cardanoscan link for each mix. (Progress while a mix runs was built in the third session.)
- Bring one back now preferring a box someone else has mixed since, which is better hidden.
- Recording public mixes so they can be resumed, and finishing the mixing from where it stopped with fresh pool boxes (the design's original rebuild). (Saying when a chain was cut short was built in the third session.)
- Home's banner for the withdraws that run by themselves.
- A *Through Lovejoin* switch on Make private: the user said "maybe not".

**Not done:**

- Forgetting a mix whose funding never landed (it stays in the page's list).
- The public Activity names a public mix's transactions as plain payments.
- Still to see live: a mix from the public account, the timed withdraws, and the collateral as an input.
- At the chunk's end: the roadmap tick, the handoff note, and the PR into `seedelf-web-wallet`.

**Gotchas:**

- A new request goes in `rpc.ts`'s `REQUEST_LIST` (a type error now), or the worker drops it without a word.
- After a Rust or WebAssembly change: `wasm/build.sh`, then `npm run build:ext`, so `dist/` has it.
- Every Koios request in the worker goes through `KOIOS_LIMIT` (60 every 10 s). Any `curl` checks from this machine use the user's IP allowance too.
- In tests, the fake Koios's `evaluation` can be a function of the request: a chain's cross-check sends `additionalUtxo`, a Seedelf spend doesn't.
- A merged return's proof is bound to a one-time key, never the session's.

## Built (2026-09-25, third session)

**Mix my boxes again** (the Lovejoin page, beside *Bring one back now*): every box of the wallet's in the pool, 10 at most, fanned out again at the Settings depth, paid from the private balance through a fresh one-time account.

- **Core:** `lovejoin::again`, a chain with no deposit. `chain`'s fan-out is now its own function (`fan_out`, with `fresh_for` drawing the pool's boxes, the wallet's own left out), and `again` starts it from boxes already in the pool.
  - `again_funding` and `again_affordable` plan the mixes alone, with the same reserve for the change. At depth 2, two boxes take 9.1 ₳.
- **WebAssembly:** `ChainRequest`, `PlanRequest` and `FundingRequest` take `again`.
  - An again chain pays its first mix from the session's largest ADA UTxO. Its other ADA UTxOs come back with the return, which merges into the funding's change as before.
- **Worker:**
  - `SessionService.againBuild` (request `lovejoin-again-build`) checks the pool first, then builds the funding, sent with `lovejoin-mix-private-submit`.
  - **How many boxes:** every one of the wallet's, as far as the pool has other boxes to mix them with (`2 × mixes` each) and one chain goes (`MAX_CHAIN_MIXES`, 130, the most a mix from the tile already makes: about 15 s to build). The first build stopped at 10; the user asked for any number (2026-09-25). At depth 2 a pool of about 100 boxes mixes 12 at a time, so the pool is what usually decides. The review says *2 of your 3 boxes* when it can't take them all, and to mix the rest once this is done.
  - The record is a mix session with `mix: { boxes, again }`. The runner builds its chain with no deposit.
  - The network's check measures the first mix with nothing extra, since all its inputs are on chain.
  - **While one runs, no box is withdrawn:** `SessionService.mixingAgain`, from the funding until the return is sent. Lovejoin asks it before `withdrawDue`, and *Bring one back now* refuses meanwhile. A second one is refused too, since it would spend the same boxes.
  - **Once its first mix is in, the boxes wait again** (`LovejoinService.reschedule`): the earliest due times go, and each box gets a fresh delay, as a deposit's boxes do.
  - Boxes that have left the pool by the time the funding lands: the chain is skipped, and it all comes back directly (`mix.skipped`).
- **UI:**
  - The review says what the funding pays for, the fan-out, and that each box waits again. Its privacy note says one of the three boxes going into each first mix is likely yours.
  - The page's list shows *2 boxes mixed again*.
  - While one runs, both buttons wait, and a note says why.

**The countdown before auto-lock.** In the last 2 minutes before the lock, every screen shows a banner, *Locking in 1:30*, with **Stay unlocked** (`LockCountdown.tsx`, in the app shell).

- **Where the deadline comes from:** the page asks the worker when it locks (`lock-deadline`: the last activity plus the lock time), and asking isn't activity.
  - It asks every 15 s, every 5 s while the countdown shows, and when the page comes back into view (the side panel and a tab put each other off).
  - At 0:00 it asks again, and asking past the deadline locks, rather than waiting up to a minute for the alarm.
- **What counts as activity:** while the countdown shows, a click or a key anywhere puts the lock off at once, as Stay unlocked does. Mouse movement doesn't count (the user's choice). There's no badge and no lock hold.
- **Mine, for the user to overrule:** with the 1-minute lock, the countdown shows for the last 30 s, not the whole minute.

**Progress while a chain goes** (the user asked, 2026-09-25; offered in the second session's handoff).

- **Measured first:** building a chain takes about 110 ms a mix in WebAssembly (Node; a 12-mix chain in 1.5 s), and the worker can't answer while it builds anyway. What takes the time is sending the transactions and the network taking them, so that's what the progress counts.
- **The record:** before a return's chain is sent, the session records it (`chain: { total, last, at }`). Its view (`SessionView.chain`) counts its transactions sent and those the runner has seen on chain, and says whether it stopped partway (`cut`: its return never went, and what was left came back directly).
- **Where it shows:**
  - The Lovejoin page's list: *Sending 7 of 13 transactions*, then *7 of 13 transactions on chain*, or *Stopped after 7 of 13 transactions; what was left came back directly*. The page reads the record every 2 s while a mix runs (no Koios); the on-chain count moves as the runner reads `tx_status`, every 20 s while the page is open.
  - A swap's timeline, once it's coming back: *Coming back through Lovejoin: 7 of 13 transactions on chain.*
  - A site session's page: a *Through Lovejoin* row until the chain is all on chain.
  - Every return's Send button while its chain goes: *Sending 7 of 10…*. The public account's mix too (`lovejoin-mix-public-progress`, kept in the worker's memory while it sends).
- **Fixed with it:** a session whose chain finished (its return sent) held every later return back from Lovejoin, since the rule was "a deposit is recorded". A site's session paid again later now goes through Lovejoin again. Only a chain that stopped partway sends the rest back directly.

**Also fixed:** the pool counts that `fits` and a return's chain checked against included the wallet's own boxes, which a mix never takes. They're counted out now. A return that stopped partway also counts a recorded mix, not only a deposit, as the chain having started.

**Tests:**

| Where | New |
|---|---|
| `seedelf-core` | `lovejoin_test` +3 (our boxes fanned out again, measured against the scripts; the refusals; the funding for the mixes alone) |
| `seedelf-wasm` | `lovejoin_test` +2 (a mix session's again chain, signed, its return taking the ADA it left alone; its funding) |
| Vitest | `lovejoin.test.ts` +5 (mixing again end to end, with the withdraws held and the due times drawn again; boxes gone before the funding landed; no box to mix; past ten boxes, as the pool allows; a chain's progress, one that stopped partway, and a finished one letting the next return through; the public mix's count); `wallet.test.ts` +1 (the deadline, and locking when asked past it) |
| Playwright | mixing again's review (2 of 3 boxes), and the mix listed; the countdown on Settings, Stay unlocked, then the lock at 0:00; a site session's return counting its chain on Send, then how much is on chain |

Totals: Rust 327, WebAssembly (Node) 33, Vitest 292, Playwright 52. The module is 762 KB gzipped.

## Handoff to the fourth session (2026-09-25)

- **Built and tested offline, not live:** *Mix my boxes again* (any number of boxes, as the pool allows), the chain progress, and the countdown. None has run on preprod yet.
- **A risk to watch live:** a long chain sits in the mempool all at once. A node's mempool holds about two blocks' worth (my understanding, not checked), about 65 mixes of 2.7 KB, so a chain past that may find submits waiting or refused until a block clears. The busy retries (10 to 40 s) should ride it out; if a chain stops there, the rest comes back directly and the progress says where it stopped. If it happens, the fix is sending a long chain in windows.
- **Still to confirm with the user,** from the third session's handoff:
  - the stopped MIN → ADA swap came back after `18b4847`;
  - a withdraw landed;
  - the merged return used the collateral as an input of the same transaction.
- **Offered, not decided:** the third session's list stands. Ask before building any of it.
- **The chunk ended here** (2026-09-25): the roadmap is ticked, and the PR into `seedelf-web-wallet` is open. The live runs above are what's left, in whichever session comes next.

## Out of scope

- Tokens through Lovejoin.
- Lovejoin's fee shards: we neither pay from them nor top them up.
- Lovejoin's website.
- Widths above 3.
- Background withdraws while the wallet is locked.

## Start here

1. `git fetch origin && git checkout web-wallet/lovejoin`.
2. Read, in order:
   - this file, starting with the latest *Handoff*
   - [architecture.md, *Private sessions*](../architecture.md#private-sessions)
   - [flows.md, *Contract round trip*](../flows.md#contract-round-trip)
   - [chunk-15b-swap-runner.md](chunk-15b-swap-runner.md), for how the runner records and resumes
   - in `_reference/Lovejoin/`: `CLAUDE.md`; then `contracts/validators/mix_logic.ak`, `mix_box.ak` and `fee_contract.ak`; then `offchain/src/crypto/` and `offchain/src/tx/mix.ts`
3. The checks' scratch code isn't kept. The measurements and results are above; build order step 2 records the five transactions again as fixtures.
