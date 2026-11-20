//! l6still#1 (round six's focused last look): a token pool's way back is weighed by its ADA less its token's least
//! (`box_weight`), which understates what it pays where the spend has change anyway (the token adds only the change's
//! extra least). So T, a token pool's way back of 6.0 ₳ and its token, weighs less than K, a 4.71 ₳ way back of the
//! 5 ₳ pool, though T pays about 1.1 ₳ more, and the merge orders try T only after K. The box rule says, of the choices
//! that build: (1) nothing 1e1b0647's order by size alone paid in one transaction is refused or split into parts;
//! (2) as few boxes of unknown making as pay; (3) as few boxes as pay.

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::Assets;
use seedelf_core::build::{
    self, AddressPayment, Chain, Class, Histories, Origin, Payment, Purpose,
};
use seedelf_core::constants::get_config;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const ADA: u64 = 1_000_000;
/// A way back of mainnet's 5 ₳ pool: 5 ₳ less the withdraw's fee.
const SMALL: u64 = 4_710_000;
/// A token pool's way back of 6.0 ₳ with its token (a pool of about 6.3 ₳ boxes).
const TOKEN_BOX: u64 = 6_000_000;

fn chain() -> Chain {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    Chain {
        params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    }
}

struct World {
    chain: Chain,
    owner: Register,
    wallet: Address,
    signer: Hash<28>,
}

fn world() -> World {
    let chain = chain();
    let key = SecretKey::new(OsRng);
    World {
        wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
        chain,
        owner: Register::create(random_scalar()).unwrap(),
        signer: Hasher::<224>::hash(PrivateKey::from(key).public_key().as_ref()),
    }
}

/// A wallet-contract UTxO owned by `w`, as Koios returns it (mint_test.rs's `owned`).
fn owned(w: &World, n: u8, lovelace: u64, tokens: &[(&str, u64)]) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: 0,
        address: w.wallet.to_bech32().unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(w.chain.config.contract.wallet_contract_hash),
        inline_datum: Some(InlineDatum {
            bytes: hex::encode(register.to_vec().unwrap()),
            value: json!({
                "constructor": 0,
                "fields": [{"bytes": register.generator}, {"bytes": register.public_value}]
            }),
        }),
        asset_list: Some(
            tokens
                .iter()
                .map(|(name, quantity)| Asset {
                    decimals: 0,
                    quantity: quantity.to_string(),
                    policy_id: TOKEN_POLICY.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

fn class(id: &str, origin: Origin) -> Class {
    Class {
        id: id.into(),
        origin,
    }
}

fn histories(purpose: Purpose, utxos: &[(&UtxoResponse, Class)]) -> Histories {
    utxos.iter().fold(Histories::new(purpose), |h, (u, c)| {
        h.with(&u.tx_hash, u.tx_index, c.clone())
    })
}

fn outpoints(utxos: &[UtxoResponse]) -> Vec<String> {
    let mut v: Vec<String> = utxos
        .iter()
        .map(|u| format!("{}#{}", u.tx_hash, u.tx_index))
        .collect();
    v.sort();
    v
}

fn paying(lovelace: u64) -> Payment {
    Payment {
        register: Register::create(random_scalar())
            .unwrap()
            .rerandomize()
            .unwrap(),
        lovelace,
        tokens: Assets::new(),
    }
}

fn key_address() -> Address {
    ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
        ShelleyDelegationPart::Null,
    )
    .into()
}

fn to_address(lovelace: u64) -> Vec<AddressPayment> {
    vec![AddressPayment {
        to: key_address(),
        lovelace,
        tokens: Assets::new(),
    }]
}

/// A session's funding: `lovelace` and its 5 ₳ collateral, to its one-time account.
fn funding(lovelace: u64) -> Vec<AddressPayment> {
    [lovelace, 5 * ADA]
        .into_iter()
        .map(|lovelace| AddressPayment {
            to: key_address(),
            lovelace,
            tokens: Assets::new(),
        })
        .collect()
}

/// Exactly `inputs` paying Seedelfs `seedelf` (`pay` empty) or `pay`, as selection's attempt asks: built, and its
/// computation estimated.
fn pays_with(
    w: &World,
    inputs: &[UtxoResponse],
    seedelf: &[Payment],
    pay: &[AddressPayment],
) -> anyhow::Result<()> {
    if pay.is_empty() {
        build::transfer_from(&w.chain, inputs, seedelf, &w.owner, w.signer)
    } else {
        build::sweep_many_from(&w.chain, inputs, pay, &w.owner, w.signer)
    }
    .and_then(|s| s.estimate())
    .map(|_| ())
}

/// What selection spends over `known` for `purpose`, or its refusal.
fn selected(
    w: &World,
    purpose: Purpose,
    known: &[(&UtxoResponse, Class)],
    seedelf: &[Payment],
    pay: &[AddressPayment],
) -> anyhow::Result<Vec<UtxoResponse>> {
    let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
    let h = histories(purpose, known);
    if pay.is_empty() {
        build::transfer_apart(&w.chain, &available, &h, seedelf, &w.owner, w.signer)
            .map(|s| s.inputs())
    } else {
        build::sweep_many_apart(&w.chain, &available, &h, pay, &w.owner, w.signer)
            .map(|s| s.inputs())
    }
}

fn short(r: anyhow::Result<()>) -> bool {
    r.is_err_and(|e| build::is_short(&e))
}

/// The premise of every case: T weighs less than K, though it holds more ADA.
fn weighs_less(w: &World, t: &UtxoResponse, k: &UtxoResponse) {
    let (wt, wk) = (
        build::adds(&w.chain.params, t).unwrap(),
        build::adds(&w.chain.params, k).unwrap(),
    );
    println!("adds(T) = {wt}, adds(K) = {wk}");
    assert!(wt > 0 && wt < wk, "T must weigh less than K: {wt} vs {wk}");
}

/// A (rule 3): O, 5 ₳ made private; K, a plain way back of 4.71 ₳; T, a token pool's way back of 6.0 ₳ and its token
/// (mixed, or plain). 8 ₳ out: O and K are short, O and T pay with one box. Selection must spend O and T, not O, K
/// and T (K's history merged, and one more input's fee).
#[test]
fn a_token_pools_way_back_that_pays_where_a_heavier_box_falls_short_is_the_one_box_merged() {
    let w = world();
    let o = owned(&w, 0x01, 5 * ADA, &[]);
    let k = owned(&w, 0x61, SMALL, &[]);
    let t = owned(&w, 0x70, TOKEN_BOX, &[("pooltoken", 1)]);
    weighs_less(&w, &t, &k);
    let mut wrong = Vec::new();
    for t_origin in [Origin::Mixed, Origin::Lovejoin] {
        let known: Vec<(&UtxoResponse, Class)> = vec![
            (&o, class("public:0", Origin::Own)),
            (&k, class(&format!("box:{}", k.tx_hash), Origin::Lovejoin)),
            (&t, class(&format!("box:{}", t.tx_hash), t_origin)),
        ];
        let seedelf = [paying(8 * ADA)];
        let spends: [(&str, Purpose, Vec<AddressPayment>); 3] = [
            ("a Send of 8 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
            ("a Make public of 8 ₳", Purpose::Pay, to_address(8 * ADA)),
            (
                "a new session's funding of 3 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(3 * ADA),
            ),
        ];
        for (name, purpose, pay) in spends {
            assert!(
                short(pays_with(&w, &[o.clone(), k.clone()], &seedelf, &pay)),
                "{name}: O and K must be short"
            );
            pays_with(&w, &[o.clone(), t.clone()], &seedelf, &pay)
                .unwrap_or_else(|e| panic!("{name}: O and T must pay: {e}"));
            let spent = selected(&w, purpose, &known, &seedelf, &pay);
            let line = match &spent {
                Ok(s) if outpoints(s) == outpoints(&[o.clone(), t.clone()]) => continue,
                Ok(s) if outpoints(s) == outpoints(&[o.clone(), k.clone(), t.clone()]) => {
                    format!("{name}, T {t_origin:?}: spent O, K and T, two boxes where O and T, one, pay")
                }
                Ok(s) => format!("{name}, T {t_origin:?}: spent {} inputs", s.len()),
                Err(e) => format!("{name}, T {t_origin:?}: refused: {e}"),
            };
            println!("{line}");
            wrong.push(line);
        }
    }
    assert!(
        wrong.is_empty(),
        "rule 3, as few boxes as pay, fails where T weighs less than K:\n{}",
        wrong.join("\n")
    );
}

/// B (rule 1): K and T as in A, beside 21 payments received of 5 ₳. 108 ₳ out: the 21 and T pay in one transaction of
/// 22 inputs, as 1e1b0647 and 550a368f built it; the 21 and K are short, K, T and 20 of them too, and K, T and the 21
/// are more than one transaction spends. Selection must build the 21 and T; HEAD refuses it as too many, so a Send to
/// one Seedelf goes in parts and one to two Seedelfs at once is refused.
#[test]
fn a_token_pools_way_back_beside_payments_at_the_input_limit_still_goes_in_one_transaction() {
    let w = world();
    let k = owned(&w, 0x61, SMALL, &[]);
    let t = owned(&w, 0x70, TOKEN_BOX, &[("pooltoken", 1)]);
    weighs_less(&w, &t, &k);
    let received: Vec<UtxoResponse> = (0..21u8).map(|i| owned(&w, 0x10 + i, 5 * ADA, &[])).collect();
    let with = |boxes: &[&UtxoResponse], n: usize| -> Vec<UtxoResponse> {
        boxes
            .iter()
            .map(|u| (*u).clone())
            .chain(received[..n].iter().cloned())
            .collect()
    };
    let mut wrong = Vec::new();
    let payments: [(&str, Vec<Payment>); 2] = [
        ("a Send of 108 ₳ to one Seedelf", vec![paying(108 * ADA)]),
        (
            "a Send of 54 ₳ to each of two Seedelfs",
            vec![paying(54 * ADA), paying(54 * ADA)],
        ),
    ];
    for (name, seedelf) in &payments {
        pays_with(&w, &with(&[&t], 21), seedelf, &[])
            .unwrap_or_else(|e| panic!("{name}: the 21 and T must pay: {e}"));
        assert!(short(pays_with(&w, &with(&[&k], 21), seedelf, &[])), "{name}: the 21 and K must be short");
        assert!(
            short(pays_with(&w, &with(&[&k, &t], 20), seedelf, &[])),
            "{name}: K, T and 20 must be short"
        );
        assert!(
            pays_with(&w, &with(&[&k, &t], 21), seedelf, &[]).is_err_and(|e| build::is_too_many(&e)),
            "{name}: K, T and the 21 must be too many"
        );
        for t_origin in [Origin::Mixed, Origin::Lovejoin] {
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&k, class(&format!("box:{}", k.tx_hash), Origin::Lovejoin)),
                (&t, class(&format!("box:{}", t.tx_hash), t_origin)),
            ];
            known.extend(
                received
                    .iter()
                    .map(|r| (r, class(&format!("received:{}", r.tx_hash), Origin::Received))),
            );
            let line = match selected(&w, Purpose::Pay, &known, seedelf, &[]) {
                Ok(s) if outpoints(&s) == outpoints(&with(&[&t], 21)) => continue,
                Ok(s) => format!("{name}, T {t_origin:?}: built with {} inputs", s.len()),
                Err(e) => format!(
                    "{name}, T {t_origin:?}: refused (too many: {}): {e}",
                    build::is_too_many(&e)
                ),
            };
            println!("{line}");
            wrong.push(line);
        }
    }
    assert!(
        wrong.is_empty(),
        "rule 1 fails: what went as one transaction is refused (a Send in parts, two Seedelfs refused):\n{}",
        wrong.join("\n")
    );
}

/// C (rule 2): O 5 ₳ made private; UA, a way back of 4.71 ₳ of unknown making; UT, a token pool's way back of 6.0 ₳
/// and its token, of unknown making. 8 ₳ out: O and UA are short, O and UT pay with one box of unknown making.
/// Selection must spend O and UT, not both boxes of unknown making.
#[test]
fn of_two_boxes_of_unknown_making_a_token_pools_way_back_that_pays_is_the_only_one_merged() {
    let w = world();
    let o = owned(&w, 0x01, 5 * ADA, &[]);
    let ua = owned(&w, 0x30, SMALL, &[]);
    let ut = owned(&w, 0x31, TOKEN_BOX, &[("pooltoken", 1)]);
    weighs_less(&w, &ut, &ua);
    let known: Vec<(&UtxoResponse, Class)> = vec![
        (&o, class("public:0", Origin::Own)),
        (
            &ua,
            class(&format!("box:{0}+unknown:{0}", ua.tx_hash), Origin::Lovejoin),
        ),
        (
            &ut,
            class(&format!("box:{0}+unknown:{0}", ut.tx_hash), Origin::Lovejoin),
        ),
    ];
    let seedelf = [paying(8 * ADA)];
    let spends: [(&str, Purpose, Vec<AddressPayment>); 3] = [
        ("a Send of 8 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
        ("a Make public of 8 ₳", Purpose::Pay, to_address(8 * ADA)),
        (
            "a new session's funding of 3 ₳ and its 5 ₳ collateral",
            Purpose::Fund {
                session: Some("session:7".into()),
            },
            funding(3 * ADA),
        ),
    ];
    let mut wrong = Vec::new();
    for (name, purpose, pay) in spends {
        assert!(
            short(pays_with(&w, &[o.clone(), ua.clone()], &seedelf, &pay)),
            "{name}: O and UA must be short"
        );
        pays_with(&w, &[o.clone(), ut.clone()], &seedelf, &pay)
            .unwrap_or_else(|e| panic!("{name}: O and UT must pay: {e}"));
        let line = match selected(&w, purpose, &known, &seedelf, &pay) {
            Ok(s) if outpoints(&s) == outpoints(&[o.clone(), ut.clone()]) => continue,
            Ok(s) if outpoints(&s) == outpoints(&[o.clone(), ua.clone(), ut.clone()]) => {
                format!("{name}: spent O, UA and UT, two boxes of unknown making where one pays")
            }
            Ok(s) => format!("{name}: spent {} inputs", s.len()),
            Err(e) => format!("{name}: refused: {e}"),
        };
        println!("{line}");
        wrong.push(line);
    }
    assert!(
        wrong.is_empty(),
        "rule 2, as few boxes of unknown making as pay, fails where UT weighs less than UA:\n{}",
        wrong.join("\n")
    );
}
