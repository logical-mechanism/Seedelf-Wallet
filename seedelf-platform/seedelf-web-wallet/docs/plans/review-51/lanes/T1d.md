# Lane T1d

Returned by the workflow's agent `a4818d441a2741aab`, written here by the lead from its structured answer.

## Findings (9)

### t1d#1 · low · An account launch whose collateral can't come back as an output: no test fails without the refusal

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:503`
- **Who:** user · **Since:** 84c2775f (2026-10-17, chunk 34d); first tag containing it web-wallet/1.6.0 (earlier releases are untagged) · **Confidence:** confirmed-by-run

**Scenario:**

The public account launches a pool (launch_from_account, the web wallet's buildAccountLaunch at wasm lib.rs:2601) with a collateral too small to cover 3/2 of the fee and still come back as an output. The collateral is either the one the wallet set aside (request.collateral) or one picked by account_collateral (build.rs:3824), which sorts the available UTxOs but never filters them. With the check, the launch is refused in words: "The public account's collateral is too small to put up for this launch". With it removed, on preprod's parameters and default terms, a 1 ₳ collateral gives a built and measured launch with a fee of 0.428774 ₳ and a collateral return of 0.356839 ₳ (1.2 ₳ gives 0.556839 ₳). Both are under the least an ADA-only output there holds (about 0.98 ₳), so the node refuses the signed launch at submit. No funds move; the user gets the node's error instead of the wallet's words.

**Evidence:**

Change, in my copy only, at launch.rs:503: `if collateral_back\n < address_minimum_lovelace_with_assets(` became `if false\n && collateral_back\n < address_minimum_lovelace_with_assets(`. Then I ran `cargo test -p seedelf-core --test lovejoin_launch_test` (8 passed, 0 failed) and `cargo test -p seedelf-core --lib --tests` (356 passed, 0 failed). seedelf-wasm's 16 native test targets also passed (305 tests) with this and every other survivor applied together. Every account launch in the tests puts up a 5 ₳ collateral (lovejoin_launch_test.rs:391, :513), or none, and account_collateral then picks a large pure-ADA row. The probe test in `fix` passes on the real code and fails under the change with: ["1000000 lovelace put up: built, fee 428774, collateral return Some(356839) lovelace", "1200000 lovelace put up: built, fee 428774, collateral return Some(556839) lovelace"].

**Fix:**

Add this test to seedelf-core/tests/lovejoin_launch_test.rs (it uses the file's world, account_row and terms helpers). I ran it: it passes on the real code and fails under the mutant.

#[test]
fn an_account_launch_refuses_a_collateral_too_small_to_come_back() {
    let w = world(true);
    let change = Address::from_bech32(&account_row(true, [0x0a; 28], 0, 1, None).address).unwrap();
    let available = vec![account_row(true, [0x0a; 28], 0x51, 40_000_000, None)];
    let mut built = Vec::new();
    for lovelace in [1_000_000u64, 1_200_000] {
        let collateral = account_row(true, [0x0a; 28], 0x5c, lovelace, None);
        match lovejoin::launch_from_account(&w.chain, &available, Some(&collateral), &terms(), true, &change, None) {
            Err(e) => assert!(e.to_string().contains("collateral is too small"), "{lovelace}: {e}"),
            Ok(launch) => {
                let done = launch.measure_locally().unwrap();
                let tx = MultiEraTx::decode(&done.tx.tx_bytes.0).unwrap();
                built.push(format!("{lovelace} lovelace put up: built, fee {}, collateral return {:?} lovelace", done.fee.total, tx.collateral_return().map(|o| o.value().coin())));
            }
        }
    }
    assert!(built.is_empty(), "{built:#?}");
}

The same family: the account mint's identical check at build.rs:3747 ("The Cardano account's UTxOs are too small to put up as collateral"). Its words appear in no test under seedelf-core/tests, seedelf-web-wallet/wasm/tests or extension/tests, so it likely has the same gap. I didn't mutate it: it isn't on R3b's list.

**Known check:**

Searched seedelf-web-wallet/docs/backlog.md and docs/archive/plans/ for 'too small to put up', 'collateral is too small', 'collateral return', 'mutant' and 'untested guard'. The only hits are 1.6.0's review, which gave its 15 untested guards tests, and 1.9.0's mutants lane. Neither names this check.

### t1d#2 · low · A cancel's collateral holding a token or a datum: no test fails without the refusal

- **Where:** `seedelf-platform/seedelf-core/src/orders.rs:736`
- **Who:** stranger · **Since:** aef01f72 (2026-10-07, Stop cancels every order itself); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

cancel_orders is handed a collateral row that holds a token, an inline datum or a datum hash. Anyone can send such a UTxO to the session's address. With the check, the cancel is refused: "The session's collateral must hold ADA alone". With it removed, the cancel builds and measures, but its collateral return is ADA alone (`Output::new(c.address.clone(), back)`, orders.rs:1030). On the MinswapV2 mainnet fixture: fee 0.236014 ₳, collateral return 4.645979 ₳ with no token. The ledger refuses that cancel after the session signs it, because a collateral's tokens must come back in its return. With a datum instead, the cancel builds and the ledger takes it. Today nothing reaches this check: the worker only ever puts up a 5 ₳ row of ADA alone or a plainAda row as collateral (sessions.ts:1052 collateralFits, :1081 plainAda, :4218-4219 cancelOf). This check backs that TypeScript filter up.

**Evidence:**

Change, in my copy only: deleted the line `bail!("The session's collateral must hold ADA alone");` at orders.rs:743, removing the whole check, token and datum parts both. Then I ran `cargo test -p seedelf-core --test orders_test` (26 passed) and `--lib --tests` (356 passed). The combined seedelf-wasm run also passed (305). Every cancel in the tests puts up `own(&s.address, 0xbb, …)`, a row of ADA alone (orders_test.rs:97-115). The probe in `fix` passes on the real code and fails under the change with: ["a token: built, fee 236014, collateral return (lovelace, policies) Some((4645979, 0))", "an inline datum: built, fee 236014, …", "a datum hash: built, fee 236014, …"]. I didn't run the token and datum parts as separate mutants: with the whole check gone no test failed, so neither part can fail one alone.

**Fix:**

Add this to seedelf-core/tests/orders_test.rs (it uses Setup, fixture, own and SESSION_COLLATERAL from that file). I ran it: it passes on the real code and fails under the mutant.

fn with_extra(row: &UtxoResponse, what: &str) -> UtxoResponse {
    let mut r = row.clone();
    match what {
        "a token" => r.asset_list = Some(serde_json::from_value(json!([{ "decimals": 0, "quantity": "7", "fingerprint": "", "policy_id": "c0".repeat(28), "asset_name": "" }])).unwrap()),
        "an inline datum" => r.inline_datum = Some(InlineDatum { bytes: "d87980".to_string(), value: Value::Null }),
        "a datum hash" => r.datum_hash = Some(hex::encode([0x5d; 32])),
        "a reference script" => r.reference_script = Some(serde_json::from_value(json!({ "hash": hex::encode([0x5c; 28]), "size": 14, "type": "plutusV3", "bytes": "4d01000033222220051200120011" })).unwrap()),
        _ => panic!("{what}"),
    }
    r
}

#[test]
fn a_cancels_collateral_holding_a_token_or_a_datum_is_refused() {
    let s = Setup::of(&fixture("MinswapV2", "mainnet"));
    let funds = vec![own(&s.address, 0xaa, 10_000_000)];
    let plain = own(&s.address, 0xbb, SESSION_COLLATERAL);
    let mut outcomes = Vec::new();
    for what in ["a token", "an inline datum", "a datum hash"] {
        match s.cancel(&[s.order()], &funds, &with_extra(&plain, what)) {
            Err(e) if format!("{e:#}").contains("must hold ADA alone") => {}
            Err(e) => outcomes.push(format!("{what}: refused in other words: {e:#}")),
            Ok(c) => {
                let tx = MultiEraTx::decode(&c.tx.tx_bytes.0).unwrap();
                let back = tx.collateral_return().map(|o| (o.value().coin(), o.value().assets().len()));
                outcomes.push(format!("{what}: built, fee {}, collateral return (lovelace, policies) {back:?}", c.fee));
            }
        }
    }
    assert!(outcomes.is_empty(), "{outcomes:#?}");
}

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'must hold ADA alone', 'collateral must', 'collateralFits' (chunk-34 only, about Lovejoin's collateral), 'plainAda' (chunk-32 only, how found collateral is used), 'mutant' and 'untested guard'. Nothing names this check or a gap in its tests.

### t1d#3 · low · A cancel built on a datum other than the one its order holds: no test fails without the check

- **Where:** `seedelf-platform/seedelf-core/src/orders.rs:762`
- **Who:** nobody · **Since:** aef01f72 (2026-10-07); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

The datum bytes in OrderToCancel don't match the order: they differ from its inline datum, or don't hash to its datum hash, or the order holds no datum at all. With the check, each case is refused in words. With all three arms removed: (1) an inline order given its datum in other bytes (the same data, its field list re-encoded) builds a cancel (fee 0.236014 ₳), so ownership was decided on bytes the order's script never sees; (2) an order by hash given other bytes is refused by the evaluator ("missing required datum"); (3) an order holding no datum is refused by the evaluator ("missing required inline datum or datum hash in script input"). In every case the order's own script runs on its real datum, and everything goes back to the session, so nothing pays elsewhere. Nothing reaches the check today: the worker takes the bytes from the row's inline datum or from Koios's datum_info for its hash (sessions.ts cancelOf, a trusted source), and check_cancels takes them from the swap's own bytes (order_at).

**Evidence:**

Change, in my copy only, to all three arms at orders.rs:764, 769 and 773: `if false && hex::decode(&inline.bytes)? != order.datum`, `if false && hex::encode(Hasher::<256>::hash(&order.datum)) != *hash`, and `(None, None) => {}`. Then I ran `--test orders_test` (26 passed) and `--lib --tests` (356 passed). The combined seedelf-wasm run also passed (305). Every test's OrderToCancel takes the datum its row holds: Setup::order, and with_datum at orders_test.rs:631 keeps the row and the bytes in step. The probe in `fix` passes on the real code and fails under the change with: ["an inline order given its datum in other bytes: built, fee 236014", "an order by hash given its datum in other bytes: refused in other words: The wallet couldn't evaluate the transaction: missing required datum …", "an order holding no datum: refused in other words: … missing required inline datum or datum hash in script input"].

**Fix:**

Add this to seedelf-core/tests/orders_test.rs. I ran it: it passes on the real code and fails under the mutant.

fn rewritten(datum: &[u8]) -> Vec<u8> {
    let mut d = PlutusData::decode_fragment(datum).unwrap();
    let PlutusData::Constr(c) = &mut d else { panic!("not a constructor") };
    c.fields = match &c.fields {
        MaybeIndefArray::Def(v) => MaybeIndefArray::Indef(v.clone()),
        MaybeIndefArray::Indef(v) => MaybeIndefArray::Def(v.clone()),
    };
    let out = d.encode_fragment().unwrap();
    assert_ne!(out, datum);
    out
}

#[test]
fn a_cancel_is_built_only_on_the_datum_its_order_holds() {
    let mut outcomes = Vec::new();
    let mut expect = |what: &str, s: &Setup, order: OrderToCancel, words: &str| {
        let funds = vec![own(&s.address, 0xaa, 10_000_000)];
        let collateral = own(&s.address, 0xbb, SESSION_COLLATERAL);
        match s.cancel(&[order], &funds, &collateral) {
            Err(e) if format!("{e:#}").contains(words) => {}
            Err(e) => outcomes.push(format!("{what}: refused in other words: {e:#}")),
            Ok(c) => outcomes.push(format!("{what}: built, fee {}", c.fee)),
        }
    };
    let v2 = Setup::of(&fixture("MinswapV2", "mainnet"));
    expect("an inline order given its datum in other bytes", &v2, OrderToCancel { utxo: v2.order.clone(), datum: rewritten(&v2.datum) }, "isn't the one it holds");
    let v1 = Setup::of(&fixture("Minswap", "mainnet"));
    expect("an order by hash given its datum in other bytes", &v1, OrderToCancel { utxo: v1.order.clone(), datum: rewritten(&v1.datum) }, "isn't the one its hash names");
    let mut bare = v2.order.clone();
    bare.inline_datum = None;
    bare.datum_hash = None;
    expect("an order holding no datum", &v2, OrderToCancel { utxo: bare, datum: v2.datum.clone() }, "holds no datum");
    assert!(outcomes.is_empty(), "{outcomes:#?}");
}

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for "isn't the one it holds", "isn't the one its hash names", 'holds no datum', 'mutant' and 'untested guard'. No match.

### t1d#4 · low · A cancel spending a session row that holds a datum or a script: no test fails without the refusal

- **Where:** `seedelf-platform/seedelf-core/src/orders.rs:894`
- **Who:** stranger · **Since:** aef01f72 (2026-10-07); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

One of the session's funds rows holds an inline datum, a datum hash or a reference script: a stranger's UTxO at the session's address. With the check, the cancel is refused: "holds a datum or a script, so a cancel can't spend it". With it removed, a row with an inline datum or a datum hash gets spent into the cancel (built, fee 0.236014 ₳). The ledger takes that, since key-locked inputs need no datum, and the row's ADA comes back with the change. A row with a reference script is still refused, but in eval::resolve_row's words ("holds a reference script, which the wallet can't evaluate with yet"). Nothing reaches the check today: the worker passes only plainAda rows as funds (sessions.ts:4218, :4234).

**Evidence:**

Change, in my copy only, at orders.rs:895-896: `if row.inline_datum.is_some() || row.datum_hash.is_some() || row.reference_script.is_some()\n {` became `if false\n {`. Then I ran `--test orders_test` (26 passed) and `--lib --tests` (356 passed). The combined seedelf-wasm run also passed (305). Every test's funds are own(...) rows of ADA alone. The probe in `fix` passes on the real code and fails under the change with: ["an inline datum: built, fee 236014, spending [36acb169…#3, aaaa…#0]", "a datum hash: built, fee 236014, spending [36acb169…#3, aaaa…#0]", "a reference script: refused in other words: UTxO aaaa…#0 holds a reference script, which the wallet can't evaluate with yet"].

**Fix:**

Add this to seedelf-core/tests/orders_test.rs, with the `with_extra` helper given in t1d#2's fix. I ran it: it passes on the real code and fails under the mutant.

#[test]
fn a_cancel_never_spends_a_session_row_holding_a_datum_or_a_script() {
    let s = Setup::of(&fixture("MinswapV2", "mainnet"));
    let collateral = own(&s.address, 0xbb, SESSION_COLLATERAL);
    let fund = own(&s.address, 0xaa, 10_000_000);
    let mut outcomes = Vec::new();
    for what in ["an inline datum", "a datum hash", "a reference script"] {
        match s.cancel(&[s.order()], &[with_extra(&fund, what)], &collateral) {
            Err(e) if format!("{e:#}").contains("holds a datum or a script") => {}
            Err(e) => outcomes.push(format!("{what}: refused in other words: {e:#}")),
            Ok(c) => {
                let tx = MultiEraTx::decode(&c.tx.tx_bytes.0).unwrap();
                outcomes.push(format!("{what}: built, fee {}, spending {:?}", c.fee, inputs_of(&tx)));
            }
        }
    }
    assert!(outcomes.is_empty(), "{outcomes:#?}");
}

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'holds a datum or a script', 'plainAda', 'mutant' and 'untested guard'. No match about this check.

### t1d#5 · low · A reference holding two lovejoin NFTs, or its policy's one token under another name: no test fails without the check

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:318`
- **Who:** nobody · **Since:** 4550b9ef (2026-10-17, chunk 34a); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

A reference UTxO at the holder holds the genuine pool policy's token in quantity 2, or holds one token of that policy not named lovejoin. With the check, verify_pool refuses it as Rejected::NotOneNft. With the quantity half removed, or the name half, verify_pool trusts it. No chain can hold either: one_shot_mint mints exactly one token, named lovejoin, in a single event (Lovejoin 29573c5 validators/one_shot_mint.ak pins `asset_name == #"6c6f76656a6f696e"` and `quantity == 1`), and a token under any other policy is refused as WrongSeed. So only a reference made up offline reaches the check, and the ledger refuses any transaction that reads a UTxO that doesn't exist. The existing NotOneNft case (lovejoin_pools_test.rs:507) adds an asset under another policy, which the one-policy pattern at :312 refuses.

**Evidence:**

Changes, in my copy only, each applied alone, at pool.rs:318: `(name.as_slice() == NFT_NAME && u64::from(quantity) == 1)` became `(name.as_slice() == NFT_NAME)` (g1d), or `(u64::from(quantity) == 1)` (g1e). For each, `--test lovejoin_pools_test` passed (41) and `--lib --tests` passed (356). Both removed together passed in the combined seedelf-wasm run (305). The probe in `fix` passes on the real code. Under g1d it fails with `2 of lovejoin … left: None, right: Some(NotOneNft)`; under g1e with `1 of junk … left: None, right: Some(NotOneNft)`. The other shape mutants (the one-policy pattern rewritten as find_map, NotAtHolder, the network, the stake credential, the reference script, AdaPool) are all caught by verify_pool_refuses_what_isnt_a_genuine_token_pool.

**Fix:**

Add this to seedelf-core/tests/lovejoin_pools_test.rs (it uses LJ_POLICY, LJ_SEED and lj_datum from that file). I ran it: it passes on the real code and fails under each mutant.

fn holding(name: &[u8], quantity: u64, datum: &[u8]) -> Resolved {
    let address: Address = ShelleyAddress::new(Network::Testnet, ShelleyPaymentPart::Script(Hash::new(templates::REFERENCE_HOLDER_HASH)), ShelleyDelegationPart::Null).into();
    let output = Output::new(address, 2_000_000).add_asset(Hash::new(LJ_POLICY), name.to_vec(), quantity).unwrap().set_inline_datum(datum.to_vec());
    Resolved { tx_hash: [0x45; 32], index: 0, output: output.build_babbage_raw().unwrap().encode_fragment().unwrap() }
}

#[test]
fn a_reference_holding_other_than_one_lovejoin_nft_is_no_pool() {
    let datum = lj_datum().encode();
    for (name, quantity) in [(&b"lovejoin"[..], 2u64), (&b"junk"[..], 1)] {
        assert_eq!(lovejoin::verify_pool(true, &holding(name, quantity, &datum), LJ_SEED, &[]).err(), Some(Rejected::NotOneNft), "{quantity} of {}", String::from_utf8_lossy(name));
    }
}

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'NotOneNft', 'lovejoin NFT', 'mutant' and 'untested guard'. No match. R3b's own note says the reader hides other tokens beside the NFT; that is a different point.

### t1d#6 · low · A v2 pool whose datum names another mix_logic: no test fails without the L check

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:415`
- **Who:** pool-launcher · **Since:** The check came in 4550b9ef (2026-10-17, chunk 34a; web-wallet/1.6.0). Its only pin was lost in 41b7ca8c (2026-11-05, chunk 44a; first tag web-wallet/1.8.0). · **Confidence:** confirmed-by-run

**Scenario:**

A pool-launcher launches on the v2 set with a datum naming v2's M and F but another L′; one_shot_mint never checks the three hashes. derive_for(seed, L′) matches neither set, so it falls back to v2 (templates.rs:179-191). M then matches, because v2's M is applied over v2's own L. So only pool.rs:415 refuses this pool, as WrongScripts. With that line removed, the wallet trusts and shows the pool. Its mixes would still run: the wallet builds from the derived scripts, mix_box takes L as its parameter, and mix_logic reads only M from the datum. The only on-chain reader of the datum's L is fee_contract, which the wallet never uses. So the harm is a pool shown that the wallet's own rule says isn't genuine. The existing wrong-L case (lovejoin_pools_test.rs:485-494) uses the TokenV1 preprod fixture, where v2's M differs from the datum's, so the M check at :414 refuses it first. That case pinned :415 until 41b7ca8c replaced `templates::derive` (the V1 set alone) with `derive_for`.

**Evidence:**

Change, in my copy only: deleted the line `|| datum.mix_logic_hash != derived.mix_logic.hash` at pool.rs:415. `--test lovejoin_pools_test` passed (41), `--lib --tests` passed (356), and the combined seedelf-wasm run passed (305). The M half (:414), the F half (:416) and the whole check, each removed alone, do fail verify_pool_refuses_what_isnt_a_genuine_token_pool at :473 and :493. The probe in `fix` builds a v2 datum from LJ_SEED's derive_in(V2) with mix_logic_hash = [1; 28]. On the real code it passes (WrongScripts); under the change it fails with `left: None, right: Some(WrongScripts)`. History: `git show 41b7ca8c -- seedelf-platform/seedelf-core/src/lovejoin/pool.rs` shows `- let derived = templates::derive(&seed.0, seed.1)…` replaced by `+ let derived = templates::derive_for(&seed.0, seed.1, &datum.mix_logic_hash)`. On-chain reads of the datum's L at Lovejoin 29573c5: only fee_contract.ak:114. mix_box.ak:40 is `validator mix_box(mix_logic_script_hash)`, and mix_logic.ak reads `reference_datum.mix_script_hash`. the_wallet_trusts_lovejoins_preprod_pool asserts the fixture is Version::TokenV1.

**Fix:**

Add this to seedelf-core/tests/lovejoin_pools_test.rs. I ran it: it passes on the real code and fails under the mutant. Or run verify_pool_refuses_what_isnt_a_genuine_token_pool's three wrong-hash cases on a v2 datum as well.

#[test]
fn a_v2_datum_naming_another_mix_logic_is_wrong_scripts() {
    let derived = templates::derive_in(templates::Set::V2, &LJ_SEED.0, LJ_SEED.1).unwrap();
    let genuine = ReferenceDatum { mix_box_hash: derived.mix_box.hash, mix_logic_hash: derived.mix_logic.hash, fee_hash: derived.fee_contract.hash, ..lj_datum() };
    let holder = templates::REFERENCE_HOLDER_HASH;
    let verify = |d: &ReferenceDatum| lovejoin::verify_pool(true, &candidate_output(derived.policy(), &d.encode(), None, false, None, holder), LJ_SEED, &[]);
    assert_eq!(verify(&genuine).unwrap().version, Version::V2);
    let wrong = ReferenceDatum { mix_logic_hash: [1; 28], ..genuine };
    assert_eq!(verify(&wrong).err(), Some(Rejected::WrongScripts));
}

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'WrongScripts', 'derive_for', 'mutant' and 'untested guard'. chunk-44-lovejoin-v2.md:30 says that with no match derive_for returns V2's scripts "so verify_pool refuses in its old order". It still refuses, but at the M check, and the plan doesn't say the L check lost its test. No other match.

### t1d#7 · low · A finished launch that isn't the pool meant: no test fails without launched_pool's checks

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:699`
- **Who:** nobody · **Since:** 02239cef (2026-10-17, chunk 34b); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

launched_pool is the last check before the web wallet signs a launch (wasm lib.rs:2611, :2702). It verifies the pool in the finished bytes (:699) and that both scripts are read from the holder (:701). Every test feeds it a launch the wallet just built with its own seed, which passes both checks by construction. With :701 removed, Lovejoin's own preprod launch, whose scripts sit at a key address, reads back as a launch to sign (the probe gets Ok). With :699's verify_pool replaced by the same derivation without its checks, a launch read back under a seed it didn't spend is still refused, but only by :701, in its words: "The launch doesn't publish its scripts at the holder". A launch whose outputs held its seed's scripts at the holder beside a datum or NFT that isn't that seed's would be signed. Only a construction bug in the wallet's own builder reaches either check.

**Evidence:**

Changes, in my copy only, each applied alone. g14a, launch.rs:701: `if !pool.inline_scripts.is_empty()` became `if false && !pool.inline_scripts.is_empty()`. g14b, launch.rs:699-700: `verify_pool(network_flag, reference, seed, &outputs)…?` was replaced by `let (_, datum) = candidate(…)?; let derived = templates::derive_for(&seed.0, seed.1, &datum.mix_logic_hash)?; let pool = super::pool::pool_of(network_flag, reference, seed, &datum, &derived, &outputs);`. For each, `--test lovejoin_launch_test` passed (8) and `--lib --tests` passed (356). Both together passed in the combined seedelf-wasm run (305). Both probes in `fix` pass on the real code. Under g14a, the Lovejoin-launch probe gets Ok (an empty error string). Under g14b, the wrong-seed probe is refused only in :701's words.

**Fix:**

Add the first test to seedelf-core/tests/lovejoin_pools_test.rs (it uses the file's json helper and LJ_SEED) and the second to lovejoin_launch_test.rs (it uses world, owned, terms and finished). I ran both: each passes on the real code and fails under its mutant.

#[test]
fn a_launch_whose_scripts_arent_at_the_holder_isnt_the_wallets() {
    let doc = json(include_str!("fixtures/lovejoin-token-preprod.json"));
    let mint = hex::decode(doc["txs"][0]["cbor"].as_str().unwrap()).unwrap();
    let why = lovejoin::launched_pool(true, &mint, LJ_SEED).err().map(|e| e.to_string()).unwrap_or_default();
    assert!(why.contains("doesn't publish its scripts at the holder"), "{why}");
}

#[test]
fn a_launch_read_back_under_another_seed_isnt_trusted() {
    let w = world(true);
    let inputs = vec![owned(&w, 0x31, 30_000_000, None)];
    let launch = lovejoin::launch(&w.chain, &inputs, &terms(), true, &w.owner, w.signer).unwrap();
    let done = finished(&w, &launch);
    let why = lovejoin::launched_pool(true, &done.tx.tx_bytes.0, ([0x32; 32], 1)).err().map(|e| e.to_string()).unwrap_or_default();
    assert!(why.contains("isn't one the wallet trusts"), "{why}");
}

A stronger pin for :699 would be a launch whose outputs hold its seed's scripts at the holder beside a reference datum naming another fee hash, refused as WrongScripts.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'launched_pool' (only chunk-34-token-pools.md:490, which describes it), 'mutant' and 'untested guard'. No gap recorded.

### t1d#8 · low · The bundled order table's load checks: no test fails without them, and as written none can

- **Where:** `seedelf-platform/seedelf-core/src/orders.rs:225`
- **Who:** nobody · **Since:** aef01f72 (2026-10-07); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

table() refuses three kinds of bad row in the bundled orders.json: a carried Plutus V1 script that isn't its row's pinned hash (:225), a row with no place or two places to read its script from (:231), and a carried script that isn't V1 (:234). The bundled file is right today, so with each check removed it still loads and every test passes. table()'s only input is the bundled file (`const TABLE: &str = include_str!("orders.json")`, :56), so no test can hand it a bad row. If orders.json were edited wrongly, these checks would refuse the table at load, and every cancel would fail in words, instead of cancels going out carrying a script the ledger rejects. The table test (orders_test.rs:212) checks that only V1 rows are carried (`e.inline.is_some() == (e.plutus == 1)`), not their hashes.

**Evidence:**

Changes, in my copy only, each applied alone: orders.rs:225 `if false && script_hash(row.plutus, &bytes) != script`, :231 `if false && reference.is_none() == inline.is_none()`, :234 `if false && inline.is_some() && row.plutus != 1`. For each, `cargo test -p seedelf-core --lib --test orders_test` passed (28). Nothing else in seedelf-core reaches orders.rs: grep finds `orders` only in orders.rs, lib.rs's `pub mod orders`, and tests/orders_test.rs. g20a's first try also passed the orders_test file alone, before I stopped its crate phase. All three together passed in the combined seedelf-wasm run (305).

**Fix:**

Split table() into `table_from(json: &str, network_flag: bool)`, keeping `table(f) = table_from(TABLE, f)`. Then test, each refused in words: a row whose carried script doesn't hash to its `script`, a row with both `reference` and `inline` and one with neither, and a carried script on a Plutus V2 row.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'orders.json' (chunk-24, -27 and -47 describe the table and its checks, but no test gap), 'mutant' and 'untested guard'. No match.

### t1d#9 · low · A cancel declaring less than its finished bytes measure: no test fails without the check

- **Where:** `seedelf-platform/seedelf-core/src/orders.rs:1102`
- **Who:** user · **Since:** aef01f72 (2026-10-07); first tag containing it web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

build_cancel measures a draft and settles the fee from it. It then measures the finished cancel and returns it only if the draft's budgets cover what the finished one uses; otherwise it retries with a 1% margin. With the check replaced by `true`, every test passes. In every fixture the first pass's budgets already cover the finished cancel: several_orders_of_one_plutus_version_cancel_in_one_transaction re-evaluates each built cancel and asserts eval::declared_covers. So the retry is never reached in any test. If a DEX script's cost moved with the fee or the declared budgets (the case the retry's comment describes: "used a hair more than the draft's"), the cancel would go out declaring less than it uses, and the node would refuse it in phase two after the user signed Stop's cancel.

**Evidence:**

Change, in my copy only, at orders.rs:1102-1106: `if budgets.iter().zip(&used).all(|(ours, theirs)| ours.mem >= theirs.mem && ours.steps >= theirs.steps) {` became `if true {`, so the first pass always returns. `cargo test -p seedelf-core --lib --test orders_test` passed (28), including the eval::declared_covers assertion near orders_test.rs:978. The combined seedelf-wasm run passed too (305), including session_test's own cancels of the order fixtures.

**Fix:**

Give the settle loop a seam a test can drive. For example, factor the acceptance into `fn covers(ours: &[Budget], theirs: &[Budget]) -> bool` with a unit test at its boundary (equal passes, one unit short of mem or steps fails), and let build_cancel take its first budgets in a lib test (orders.rs's tests module), seeded 1% under what the draft measures. Then assert that the cancel returned after the second pass declares budgets that cover a fresh evaluation (eval::declared_covers).

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for 'budgets did not settle', 'declared_covers' (chunk-16 only, about Lovejoin), 'mutant' and 'untested guard'. No match.

## Guards (61)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:411` | Trusting a pool whose NFT policy isn't one_shot_mint(seed) (WrongSeed) | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473, unwrap_err on an Ok pool) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:414` | A datum naming another mix_box (M) or fee (F) hash; the whole WrongScripts check | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473/:493) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:415` | A v2 datum naming another mix_logic (L) hash | none: masked on the TokenV1 fixture by :414; probe a_v2_datum_naming_another_mix_logic_is_wrong_scripts pins it (t1d#6) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:331` | A reference candidate not at reference_holder (NotAtHolder) | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:302` | A candidate at the holder on the other network (at_holder's network check) | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:542) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:337` | A candidate with a stake credential | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:340` | A candidate carrying a reference script | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:312` | A candidate holding assets of another policy beside the NFT (exactly one policy, one name) | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473, with nft_policy rewritten as find_map) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:318` | The NFT's quantity other than 1, or its name other than lovejoin | none (t1d#5) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:349` | A 10 ₳ ADA pool on the generalized scripts (AdaPool) | lovejoin_pools_test.rs verify_pool_refuses_what_isnt_a_genuine_token_pool (:473) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:158` | A reference datum that isn't constructor 0 in tag-121 form | lovejoin_vectors_test.rs the_vectors_try_what_they_say (:541 'constructor 0 as tag 102') and the_data_layers_vectors_are_this_crates_own |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:170` | A reference datum with other than exactly eight fields (nine accepted when relaxed) | lovejoin_vectors_test.rs the_vectors_try_what_they_say ('nine fields') and the_data_layers_vectors_are_this_crates_own |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:177` | box_lovelace <= 0 | none: equivalent mutant, since 0 < max_fee < box_lovelace (:183) refuses the same datums |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:183` | max_fee of 0, or max_fee not under box_lovelace | lovejoin_pools_test.rs a_reference_datum_is_held_to_one_shot_mints_ranges (:652), each half |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:189` | An ADA pool's datum naming a token | lovejoin_vectors_test.rs the_vectors_try_what_they_say ('an ADA pool naming a token') and the_data_layers_vectors_are_this_crates_own |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:194` | A token policy that isn't 28 bytes | lovejoin_vectors_test.rs the_vectors_try_what_they_say ('a 27-byte policy') |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:197` | A token name over 32 bytes | lovejoin_pools_test.rs a_reference_datum_is_held_to_one_shot_mints_ranges (:652) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:202` | A token quantity of 0 | lovejoin_pools_test.rs a_reference_datum_is_held_to_one_shot_mints_ranges (:652) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:142` | A script hash in the datum that isn't 28 bytes | lovejoin_vectors_test.rs the_vectors_try_what_they_say ('a 27-byte mix_box hash') |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:280` | Decoding an output at the holder nested past MAX_DEPTH | lovejoin_pools_test.rs a_script_at_the_holder_under_a_datum_too_deep_to_read_is_no_reference (:644, 3 references instead of 2) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:449` | Reading a pool's script by reference from a UTxO not at the holder | lovejoin_pools_test.rs the_wallet_trusts_lovejoins_preprod_pool (:390, 3 references instead of 1) |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:451` | Reading by reference a PlutusV3 script that isn't byte for byte the derived one | lovejoin_pools_test.rs a_script_at_the_holder_under_a_datum_too_deep_to_read_is_no_reference, v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee, every_chain_transaction_balances_with_a_take ('missing and/or unexpected validator(s)') |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:602` | A new box under today's min-UTxO (BelowMinimum) | lovejoin_pools_test.rs a_pool_isnt_usable_unregistered_too_small_or_unable_to_come_back (:2489), a_box_already_there_is_asked_only_about_its_way_back, a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:638` | A box that can't pay its own way back counted usable (CantComeBack) | lovejoin_pools_test.rs a_pool_isnt_usable_unregistered_too_small_or_unable_to_come_back (:2500), a_box_already_there_is_asked_only_about_its_way_back |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:165` | Launching a pool of a Seedelf identifier token | lovejoin_launch_test.rs a_launch_refuses_what_isnt_a_pool_to_start (:208) |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:168` | Launching a 10 ₳ ADA pool (check_terms) | none alone: masked by verify_derived's AdaPool refusal in the same words; with :239 removed too, wasm lovejoin_flows_test.rs an_ada_pool_starts_from_the_seedelf_balance (:771) and the core test an_ada_pool_launches_at_any_amount_but_the_classic_pools catch the pair |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:217` | A launch datum one_shot_mint would refuse (round trip) | lovejoin_launch_test.rs a_launch_refuses_what_isnt_a_pool_to_start (:222, the later refusal lacks 'one_shot_mint') |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:239` | A launch whose own outputs don't make a pool the wallet trusts (verify_derived) | none: self-check of outputs built from the same derived scripts; no input through the public API reaches it |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:247` | A launch whose pool wouldn't read its scripts from the holder (shaped) | none: self-check, as :239 |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:182` | A launch (launch, launch_from_account) whose boxes couldn't be made or come back | lovejoin_launch_test.rs a_launch_refuses_what_isnt_a_pool_to_start (:208, the box too small to come back) |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:406` | A private launch_apart of an unusable pool | lib test lovejoin::launch::tests::a_private_launch_derives_a_seeds_scripts_once_and_measures_a_way_back_once (launch.rs:789, count (1, 0) instead of (1, 1)); no refusal test |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:189` | check_usable itself (both call sites) | the lib test above and lovejoin_launch_test.rs a_launch_refuses_what_isnt_a_pool_to_start |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:309` | A private launch spending a Seedelf UTxO that holds tokens | lovejoin_launch_test.rs a_launch_refuses_what_isnt_a_pool_to_start (:248) |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:479` | An account launch whose inputs can't cover the outputs, the deposit and the fee (checked subtraction) | lovejoin_launch_test.rs the_public_account_launches_a_pool_the_wallet_trusts (:404), an_account_launch_takes_tokens_only_when_ada_alone_doesnt_pay (:467), an_account_launch_never_spends_a_utxo_carrying_a_reference_script (:525): one input taken where two pay |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:503` | An account launch whose collateral return would be under an output's least after 3/2 of the fee | none (t1d#1) |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:643` | An account launch spending a UTxO the evaluator refuses (a stranger's reference script) | lovejoin_launch_test.rs an_account_launch_never_spends_a_utxo_carrying_a_reference_script (:525) |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:699` | Signing a launch whose finished bytes don't verify as the pool meant | none (t1d#7) |
| `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:701` | Signing a launch whose scripts aren't read from the holder | none (t1d#7) |
| `seedelf-platform/seedelf-core/src/orders.rs:309` | Session::owns: an order another key cancels | orders_test.rs an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (:1266) |
| `seedelf-platform/seedelf-core/src/orders.rs:309` | Session::owns: an order paying anyone but the session | orders_test.rs an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (:1266), an_order_another_key_owns_is_refused_before_anything_is_built (:369) |
| `seedelf-platform/seedelf-core/src/orders.rs:309` | Session::owns: an order naming no payee | none: equivalent mutant, since every OrderRead comes from read() and every arm names a payee |
| `seedelf-platform/seedelf-core/src/orders.rs:612` | An order carrying a reference script | orders_test.rs an_order_no_script_can_spend_is_refused_by_its_form (:1609), an_order_its_own_cancel_cant_spend_is_found_before_the_swap_is_signed (:1809) |
| `seedelf-platform/seedelf-core/src/orders.rs:614` | An order with an inline datum at a Plutus V1 script | orders_test.rs an_order_no_script_can_spend_is_refused_by_its_form (:1583), an_order_its_own_cancel_cant_spend_is_found_before_the_swap_is_signed (:1797) |
| `seedelf-platform/seedelf-core/src/orders.rs:444` | Decoding an order datum nested past MAX_DEPTH | orders_test.rs a_datum_nested_too_deep_is_refused_unread (native stack overflow, the orders_test binary aborts with SIGABRT) |
| `seedelf-platform/seedelf-core/src/orders.rs:513` | A SundaeSwap V4 order with a chained datum, or other constraint modules | orders_test.rs an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (:1278: 'a datum for the destination', 'another order module') |
| `seedelf-platform/seedelf-core/src/orders.rs:418` | V4 constraints that only begin with basic_order then fee_constraint (the length check) | orders_test.rs an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (:1278 'no fee constraint') |
| `seedelf-platform/seedelf-core/src/orders.rs:556` | A Splash datum whose twelve fields aren't of their types (the whole check, and each of its 10 parts) | orders_test.rs a_splash_datum_reads_only_with_every_field_of_its_type (:1535, every field); the whole check and the fee field also an_order_its_own_cancel_cant_spend_is_found_before_the_swap_is_signed (:1775) |
| `seedelf-platform/seedelf-core/src/orders.rs:225` | A bundled V1 order script that isn't its pinned hash | none (t1d#8) |
| `seedelf-platform/seedelf-core/src/orders.rs:231` | A table row with no place, or two, to read its script from | none (t1d#8) |
| `seedelf-platform/seedelf-core/src/orders.rs:234` | A carried order script that isn't Plutus V1 | none (t1d#8) |
| `seedelf-platform/seedelf-core/src/orders.rs:736` | A cancel's collateral holding tokens or a datum | none (t1d#2) |
| `seedelf-platform/seedelf-core/src/orders.rs:762` | A cancel built on a datum other than the one its order holds | none (t1d#3) |
| `seedelf-platform/seedelf-core/src/orders.rs:831` | Reading an order's script from a reference that doesn't hold the pinned script | orders_test.rs a_spent_reference_still_gives_its_script_and_the_cancel_carries_it (:1410) |
| `seedelf-platform/seedelf-core/src/orders.rs:894` | A cancel spending a session row with a datum or a script | none (t1d#4) |
| `seedelf-platform/seedelf-core/src/orders.rs:956` | Overflow adding the refund, KEEP_AT_FEE and the collateral (keep decision) | orders_test.rs an_order_reported_near_what_a_u64_holds_never_overflows_its_cancel ('attempt to add with overflow' at orders.rs:956) |
| `seedelf-platform/seedelf-core/src/orders.rs:958` | Underflow subtracting that from the inputs (keep decision) | orders_test.rs a_splash_cancel_spends_the_collateral_only_when_nothing_else_can_pay ('attempt to subtract with overflow' at orders.rs:958) |
| `seedelf-platform/seedelf-core/src/orders.rs:986` | A Splash cancel whose output 0 isn't the order's exact value (the refund, and its tokens at :988) | orders_test.rs a_splash_cancel_is_paid_from_the_change_a_swap_leaves, a_splash_cancel_spends_the_collateral_only_when_nothing_else_can_pay, a_larger_collateral_spent_leaves_an_exact_one_behind, an_order_reported_near_what_a_u64_holds_never_overflows_its_cancel (Splash's script refuses) |
| `seedelf-platform/seedelf-core/src/orders.rs:1022` | A collateral return under an output's least, or a collateral not covering 3/2 of the fee | orders_test.rs the_collateral_return_is_held_to_the_least_an_output_holds (:910) |
| `seedelf-platform/seedelf-core/src/orders.rs:1102` | Sending a cancel whose declared budgets don't cover what its finished bytes measure | none (t1d#9) |
| `seedelf-platform/seedelf-core/src/orders.rs:1437` | A cancel's script data hash as Pallas computes it (wrong with witness datums) | orders_test.rs the_script_data_hash_is_the_ledgers_for_every_plutus_version (:492) |
| `seedelf-platform/seedelf-core/src/orders.rs:1387` | Plutus V1's legacy language view in that hash | orders_test.rs the_script_data_hash_is_the_ledgers_for_every_plutus_version (:471) |

## Checked and holds

- pool.rs:411 WrongSeed: verify_pool_refuses_what_isnt_a_genuine_token_pool fails (:473, unwrap_err on an Ok pool: the fake NFT is trusted).
- pool.rs:414-417 WrongScripts: the whole check, the M half and the F half each fail verify_pool_refuses_what_isnt_a_genuine_token_pool. The L half doesn't (t1d#6).
- pool.rs:331-351 candidate's shape: NotAtHolder, the network, StakeCredential, ReferenceScript, the one-policy pattern (rewritten as find_map) and AdaPool each fail verify_pool_refuses_what_isnt_a_genuine_token_pool (:473; the network at :542).
- pool.rs:174-218 the datum's ranges: 0 < max_fee and max_fee < box_lovelace (each half), name ≤ 32 bytes and quantity > 0 each fail a_reference_datum_is_held_to_one_shot_mints_ranges (:652). The ADA pool's empty token fields, the 28-byte policy, the 28-byte hashes, the eight fields and constructor 0 each fail only lovejoin_vectors_test.rs (the_vectors_try_what_they_say at :541, and the_data_layers_vectors_are_this_crates_own).
- pool.rs:280 post_alonzo's depth check: a_script_at_the_holder_under_a_datum_too_deep_to_read_is_no_reference fails (:644, 3 references instead of 2).
- pool.rs:449-451 pool_of's held(): without at_holder, the_wallet_trusts_lovejoins_preprod_pool fails (:390, 3 references instead of 1); without the byte-for-byte match, a_script_at_the_holder…, v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee and every_chain_transaction_balances_with_a_take fail (the evaluator: missing and/or unexpected validator).
- pool.rs:602 BelowMinimum and :638 CantComeBack: a_pool_isnt_usable_unregistered_too_small_or_unable_to_come_back fails (:2489, and :2500 Ok(Usable { box_minimum: 1663660, withdraw_fee: 0, back: 0 })), as does a_box_already_there_is_asked_only_about_its_way_back; BelowMinimum also fails a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for.
- launch.rs:165 the Seedelf identifier token: a_launch_refuses_what_isnt_a_pool_to_start fails (:208, the launch is built).
- launch.rs:217 the datum's round trip: a_launch_refuses_what_isnt_a_pool_to_start fails (:222). The later refusal says "Its datum isn't a token pool's", without 'one_shot_mint'.
- launch.rs:182/189/406 check_usable: the function and the made() call site fail a_launch_refuses_what_isnt_a_pool_to_start (:208, the box too small to come back). The launch_apart call site fails only the lib test's count (launch.rs:789, (1, 0) instead of (1, 1)).
- launch.rs:309 ADA-only private inputs: a_launch_refuses_what_isnt_a_pool_to_start fails (:248).
- launch.rs:479 the account launch's checked change: the_public_account_launches_a_pool_the_wallet_trusts (:404), an_account_launch_takes_tokens_only_when_ada_alone_doesnt_pay (:467) and an_account_launch_never_spends_a_utxo_carrying_a_reference_script (:525) all fail: one input is taken where two pay.
- launch.rs:643 the evaluable filter: an_account_launch_never_spends_a_utxo_carrying_a_reference_script fails (:525, the scripted UTxO is spent).
- orders.rs:309 Session::owns: without the canceller check, an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are fails (:1266 'MinswapV2 on mainnet, canceller another's'); without the payee check, it fails too ('Minswap on mainnet, receiver another's'), and so does an_order_another_key_owns_is_refused_before_anything_is_built (:369).
- orders.rs:611-618 unspendable: each half fails an_order_no_script_can_spend_is_refused_by_its_form (:1609, :1583) and an_order_its_own_cancel_cant_spend_is_found_before_the_swap_is_signed (:1809, :1797); the refusal then comes in the evaluator's words.
- orders.rs:444 read's depth check: a_datum_nested_too_deep_is_refused_unread overflows the native stack, and the orders_test binary aborts with SIGABRT.
- orders.rs:513 and :418 V4's one fill: the chained datum, the constraints and the length check each fail an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (:1278: 'a datum for the destination', 'another order module', 'no fee constraint').
- orders.rs:556-568 Splash's typed fields: the whole check and each of its ten parts fail a_splash_datum_reads_only_with_every_field_of_its_type (:1535, 'field N as …' for fields 0-8 and 11).
- orders.rs:831 the reference holds the pinned script: a_spent_reference_still_gives_its_script_and_the_cancel_carries_it fails (:1410, missing and/or unexpected validator).
- orders.rs:955-958 the overflow-checked keep decision: a plain add fails an_order_reported_near_what_a_u64_holds_never_overflows_its_cancel (attempt to add with overflow); a plain subtract fails a_splash_cancel_spends_the_collateral_only_when_nothing_else_can_pay (attempt to subtract with overflow).
- orders.rs:986-988 Splash's exact refund as output 0: dropping the refund, or its tokens, fails four Splash tests (a_splash_cancel_is_paid_from_the_change_a_swap_leaves, …_spends_the_collateral_only_when_nothing_else_can_pay, a_larger_collateral_spent_leaves_an_exact_one_behind, an_order_reported_near_what_a_u64_holds_…). Splash's script refuses the cancel.
- orders.rs:1022-1026 the cancel's collateral return: without the least, or the least and the 3/2 cover both, the_collateral_return_is_held_to_the_least_an_output_holds fails (:910: the 1.2 ₳ collateral is built, not refused).
- orders.rs:1437 with_integrity and :1387 V1's legacy view: the_script_data_hash_is_the_ledgers_for_every_plutus_version fails (:492 Minswap's hash; :471 Plutus V1's).

## Notes

- Merged duplicates: R3b lists 30 guards and none repeats. Several entries hold more than one check, so I split them into 84 mutants, one per check (the `guards` list gives each line).
- Mutants no test can catch, which I don't count as findings. pool.rs:177 (box_lovelace > 0) is implied by 0 < max_fee < box_lovelace at :183. orders.rs:309 `!order.pays.is_empty()` can't be false: every OrderRead comes from read() (orders.rs:574), and every arm names a payee; the only callers are cancel_orders:776 and wasm lib.rs:735. launch.rs:239 (verify_derived) and :247 (inline scripts) self-check outputs that shaped() builds from the same derived scripts, so no input through the public API reaches them.
- launch.rs:168, check_terms' 10 ₳ arm: removed alone, nothing fails, because verify_derived's AdaPool refuses the same launch in words that still contain 'copy of the classic pool'. With :239 removed too, the launch is built, and launched_pool refuses it: "The launch makes no reference UTxO the wallet would read". That fails the wasm test lovejoin_flows_test.rs an_ada_pool_starts_from_the_seedelf_balance (:771), as my first combined run showed. So the 10 ₳ refusal has two layers, and only the pair is pinned.
- Caught, but not by the test the lane named. pool.rs:449 is caught by the_wallet_trusts_lovejoins_preprod_pool, not :905. pool.rs:158, :170, :189, :194 and :142 are caught only by lovejoin_vectors_test.rs (the vectors shared with the data layer), not by :649. launch.rs:406 is caught only by the lib test's count of measures: no test launches an unusable pool through launch_apart, the path the web wallet's private launch takes (wasm lib.rs:2692). orders.rs:444 is caught by a native stack overflow that aborts the whole orders_test binary, which loses the other tests' results when it fires.
- Guards 21 and 24 back up TypeScript filters: the worker's collateralFits (sessions.ts:1052) and plainAda (:1081, used by cancelOf at :4218-4219) keep a stranger's rows out before WebAssembly sees them. Whether a Vitest test pins those filters is for a TypeScript lens; I didn't try it.
- build.rs:3747, the account mint's collateral-return check, has the same shape as t1d#1. Its words appear in no test (grep of seedelf-core/tests, wasm/tests and extension/tests). I didn't mutate it: it isn't on R3b's list.
- The extension's Vitest tests reach these Rust guards only through TREE's prebuilt wasm/pkg, which a Rust mutant can't change, so I didn't run them (as the brief says). seedelf-cli doesn't call orders, launch or pool code (grep: 0 files).
- seedelf-wasm's native suite (16 targets, 305 tests), run twice with every survivor applied together. First run, with launch.rs:168 included: 304 passed, 1 failed (the pair above). Second run, with every survivor except launch.rs:168: 305 passed. Its lovejoin_proven_bytes_test includes four script hex files from seedelf-verification/, outside seedelf-platform; I copied just those files (data, nothing built) into my second copy.
- Each probe test in the findings' `fix` was appended to a second copy's test files. All 8 pass on the real code, and each fails under its mutant (9 probe-and-mutant runs). Results and probe logs are kept in SCRATCH/r51/work/T1d/results/ (tmpfs).
- Interruption: to save time, I stopped the batch runner with SIGINT during g20a's crate phase. Its `finally` restored orders.rs; I stopped the one orphaned test binary (mine, checked by its CARGO_TARGET_DIR) and confirmed by cmp that every copy matched TREE. I then ran the last 11 orders.rs mutants with `--lib --test orders_test`, which is all of seedelf-core that reaches orders.rs.
- The machine's load average was 23 to 68 throughout (other lanes), so crate phases took 1 to 9 minutes each. Timings in the logs reflect that.

## Coverage

I tried all 30 of R3b's guards (none repeats), as 84 mutants, each of a different check. 78 of them ran one at a time in my copy of seedelf-platform. Each ran its named test file first, then, if nothing failed, the whole seedelf-core crate (--lib --tests: 31 targets, 356 tests, 6 ignored). The exception is the last 11 orders.rs mutants, which ran --lib plus orders_test only (28 tests), since nothing else in the crate reaches orders.rs. Five more were never run apart, as their results are implied: g21's token and datum parts and g22's three arms, because removing each whole check failed nothing. g1de (the NFT's name and quantity together) ran only in the combined wasm runs. 27 checks that failed no seedelf-core test (the survivors and the equivalent ones) also ran in two combined runs of seedelf-wasm's native suite (305 tests); in the second, 305 passed. 9 probe tests (the tests a fix would add) ran in a second copy, at baseline and each under its mutant. Not run: the extension's Vitest tests (they reach these guards only through TREE's prebuilt wasm/pkg); seedelf-cli (it doesn't use these modules); live and ignored tests; Playwright. I didn't mutate guards outside R3b's list, such as build.rs:3747, ReferenceDatum::decode's own depth check at pool.rs:152, or orders.rs:1022's fee overflow check. Every copy, target directory and cache log of mine was removed at the end: $HOME/.cache/seedelf-review-51/T1d (with its probe copy), T1d-target, and my logs. TREE was never written (git diff of seedelf-core and wasm is empty).
