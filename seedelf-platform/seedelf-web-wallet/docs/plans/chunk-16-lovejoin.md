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

**Not done yet:**

1. **A live preprod run** (on the user's go-ahead):
   - a session's return through Lovejoin, merged into its funding change
   - a mix from each side
   - the delayed withdraws
   - the collateral as an input of the same transaction
2. Forgetting a mix whose funding never landed (it stays in the page's list).
3. The public Activity names a public mix's transactions as plain payments.

## Out of scope

- Tokens through Lovejoin.
- Lovejoin's fee shards: we neither pay from them nor top them up.
- Lovejoin's website.
- Widths above 3.
- Background withdraws while the wallet is locked.

## Start here

1. `git fetch origin && git checkout web-wallet/lovejoin`.
2. Read, in order:
   - this file
   - [architecture.md, *Private sessions*](../architecture.md#private-sessions)
   - [flows.md, *Contract round trip*](../flows.md#contract-round-trip)
   - [chunk-15b-swap-runner.md](chunk-15b-swap-runner.md), for how the runner records and resumes
   - in `_reference/Lovejoin/`: `CLAUDE.md`; then `contracts/validators/mix_logic.ak`, `mix_box.ak` and `fee_contract.ak`; then `offchain/src/crypto/` and `offchain/src/tx/mix.ts`
3. The checks' scratch code isn't kept. The measurements and results are above; build order step 2 records the five transactions again as fixtures.
