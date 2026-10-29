# v-pr338-3-trace: pr338#3, the Leios entry leaves out reading others' transactions in Dijkstra's three-element shape

**Verdict: partly. Severity: low.** I'm highly confident in the code facts (two scratch tests on HEAD settled them) and in the CDDL text. How much it matters is medium: it bites only once mainnet reaches Dijkstra.

## What holds

- **The roadmap entry on HEAD says nothing about the wallet reading someone else's transaction.** `post-release-roadmap.md` :405–:409 is the whole item 8 entry, as PR #338 wrote it. :406 covers building only: redeemers as a list, certificate 0, "The fix is a Pallas update, or patches in core". :409 ("What Leios would change in the wallet") lists `pumpChain`, the chained spend's wait and fees on reference inputs. `git grep -i "dijkstra|three-element|4-item|leios"` over the docs on `6bca8bec` finds only that entry, so no other doc covers the point.
- **Dijkstra's shape is real, and the ledger recommends it.** The ledger's own CDDL (`IntersectMBO/cardano-ledger` master, `eras/dijkstra/impl/cddl/data/dijkstra.cddl`, last changed `9d20aed5eb` on 2026-10-22, fetched read-only) says:
  - `mempool_transaction = [ transaction_body, transaction_witness_set, auxiliary_data/ nil ] / [transaction_body, transaction_witness_set, true, auxiliary_data/ nil]`
  - "In Dijkstra we're deprecating the `is_valid` flag in submitted transactions … it's strongly recommended to encode transactions without the flag."
  - So dApp libraries have good reason to emit the three-element form. That makes step 2 of the scenario likely, not hypothetical. The run's README rests on what it saw IO's load send; the CDDL backs it.
- **Both WebAssembly readers refuse it.**
  - Pallas 0.35.1's `PseudoTx` is a 4-field array with `#[n(2)] pub success: bool` (`pallas-primitives-0.35.1/src/conway/model.rs:1597–1598`).
  - minicbor-derive 0.15.3 decodes array fields by position (`src/decode.rs:341–346`), so position 2 meets `null` where it wants a bool.
  - `cip30.rs:1029` (`conway::Tx::decode_fragment`, signTx's `inspect`) and `decode.rs:633` (`conway::MintedTx::decode_fragment`, Transaction details) both answer "The wallet can't read this transaction: unexpected type null at position 125: expected bool" (scratch test below).

## Narrower or different than stated

1. **On HEAD a site's three-element transaction never reaches WebAssembly.** The worker's own TypeScript CBOR reader refuses it first:
   - `cbor.ts:123` (`bodyField`, behind `bodyOutpoints`/`txInputs`) and `cbor.ts:209` (`txId`) both have `if (tx[0] !== 0x84) throw new Error(t("worker.cbor.notFourItems"));`.
   - `dapp.ts:2104` `signTx` calls `bodyOutpoints(bytes, 0)` inside a try. Its catch at :2107 throws `invalid((lng) => t("dapp.cannotReadTx", { lng }))`.
   - So the site hears `{ code: -1 (InvalidRequest), info: "The wallet can't read this transaction." }`, and there's no prompt. Scenario step 3's Pallas message is never shown. Step 4's outcome holds: no signature and no prompt. Transaction details opens only from a prompt (`tx-view.ts` reads a site's bytes from the connector's queue), so there are no details either.
2. **It reaches further than signTx.**
   - **CIP-30 `submitTx`** is refused too: `dapp.ts:2468` `id = txId(bytes)`, then :2470 `invalid(dapp.cannotReadTx)`, and Koios is never asked. Yet the node would take the transaction. The wallet needs only its id, and `build::tx_id` computes that from either shape (scratch test). The refusal is purely the TS `0x84` check.
   - **A Minswap-built swap in a private session** goes through the same readers:
     - `minswap.ts:352` `buildTx` returns Minswap's CBOR.
     - `sessions.ts:4171–4173` runs `bodyOutpoints` and `builtOutputs`; `minswap.ts:463` has the same `0x84` check, and so has `witnessedKeys` at :517.
     - Then comes `inspectSessionTx`, which is cip30's `inspect`.
     - If Minswap's builder follows the CDDL's recommendation, the swap is refused with `sess.cannotRead`.
   - The finding names only CIP-30's signTx and Transaction details.
3. **The proposed fix names only the Rust half.** "read a site's transaction with Pallas's Conway decoder" would send whoever plans the Dijkstra release to Pallas. A Pallas update alone wouldn't help, for two reasons:
   - The worker's TS readers would still refuse the shape before WebAssembly sees it.
   - The Rust call sites name `conway::Tx` and `conway::MintedTx` explicitly.
4. **"It also can't read Dijkstra's new fields" needs care.**
   - Pallas's Conway body is a derived `#[cbor(map)]`, and minicbor-derive skips unknown keys (`_ => __d777.skip()?`, `src/decode.rs:361–367`). So a *four-element* Dijkstra transaction carrying the new keys 23–27 (`sub_transactions`, `required_top_level_guards`, `direct_deposits`, …) isn't refused by `inspect`.
   - Instead, the signing prompt's summary silently leaves those keys out. `decode.rs`'s `map_extras` lists them as unknown fields in Transaction details.
   - Key 14 becomes `guards = nonempty_set<addr_keyhash> / nonempty_oset<credential>`, and its credential form would fail Pallas's `RequiredSigners`.
   - I didn't trace this further. It's outside this finding, and it's future work.
5. **Scope.** The README line the finding quotes ("only meets it where it reads others' from the chain") is on `web-wallet/leios-musashi`, which the brief puts outside this review. Only the roadmap entry counts. On HEAD the wallet reads no transaction CBOR from the chain at all: `koios.ts` and `data-layer.ts` have no `tx_cbor`. The other two `conway::Tx` decodes, `lovejoin.rs:308` and `lib.rs:1510`, read the wallet's own built transactions.

## Also seen, beyond the finding

The same CDDL comment goes on: "In the next era the `is_valid` flag will not be allowed in mempool transactions at all." Pallas 0.35 writes Conway's four-element form, so the wallet's own transactions are deprecated under Dijkstra and refused in the era after. The roadmap entry doesn't say so. The README's "Dijkstra still takes it" is true only for Dijkstra.

## Repro

Two scratch tests on HEAD. Both are deleted; `git status` shows only the review folder.

- **`extension/tests/zz-review-v-pr338-3-trace-1.test.ts`** (`npx vitest run` on that file alone): 2 failed, 1 passed, as expected if the finding is real.
  - Test 1 (wanted: the TS readers take the three-element form) **failed**. `bodyOutpoints`, `txId` and `builtOutputs` each threw "not a 4-item transaction array".
  - Test 2 (wanted: a site's signTx of `83…a0f6` gets a prompt like `84…a0f5f6`) **failed**. The site heard `{"failure":{"code":-1,"info":"The wallet can't read this transaction."}}` with 0 prompts, while the four-element control got 1 prompt.
  - Test 3 (HEAD) **passed**:
    - signTx and submitTx of the three-element form are both rejected with `{ code: APIError.InvalidRequest, info: "The wallet can't read this transaction." }`;
    - `t.koios.submitted` is unchanged;
    - `wasm.decodeTx(Preprod, three)` throws "The wallet can't read this transaction: unexpected type null at position 114: expected bool", while the four-element form decodes.
- **`wasm/tests/zz_review_v-pr338-3-trace_1.rs`** (`cargo test --locked -p seedelf-wasm --test zz_review_v-pr338-3-trace_1`): 2 passed, 2 failed, as expected if real.
  - `control_the_conway_shape_reads_in_both` passed: `inspect_tx` signs `0/0` and `decode_tx` is Ok.
  - `head_pallas_conway_tx_refuses_the_three_element_shape` passed: `conway::Tx` and `conway::MintedTx` both give "unexpected type null at position 125: expected bool", and `build::tx_id(three)` is Ok.
  - `wanted_cip30_inspect_reads_the_three_element_shape` **failed**: "The wallet can't read this transaction: unexpected type null at position 125: expected bool".
  - `wanted_decode_tx_reads_the_three_element_shape` **failed**, with the same message.
- **Network:** one read-only `gh api` listing of the cardano-ledger tree and one read of `dijkstra.cddl`, saved under my scratch folder. Nothing written, no Koios.

## Fix advice

- Put the read side in the entry, at :409 or as a fourth sub-bullet. It should name both readers, plus the deprecation the CDDL states. Suggested text:

  > Reading others' transactions: Dijkstra recommends `[body, witnesses, metadata]`, without Conway's `true`. The worker's CBOR reader (`cbor.ts`, `minswap.ts`, four items only) and WebAssembly's Conway decoders (`cip30.rs` `inspect`, `decode.rs`) refuse it. So a site's `signTx` and `submitTx`, and a swap Minswap builds, would be refused. The era after Dijkstra refuses the wallet's own four-element form in the mempool.

- Keep it as one short clause if the owner wants the entry terse. Still name both layers: a fix that names only Pallas would leave the TS reader refusing the shape.
- The finding's suggested test, a seedelf-wasm test of `inspect` on three elements, would pin only the second layer. A TS test that a site's `signTx` of `83…` is refused (as test 3 above) would pin the first. Neither is needed for 1.7.0: this is a docs change for a later release.
