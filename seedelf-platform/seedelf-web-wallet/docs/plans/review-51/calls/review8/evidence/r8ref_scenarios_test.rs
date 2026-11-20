//! Review eight's scratch scenarios (never in the tree): balances that show what an unpinned part of round eight's
//! rule decides, run with and without a mutation switch (R8REF_MUT).

use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::Assets;
use seedelf_core::build::{self, Chain, Class, Histories, Origin, Payment, Purpose};
use seedelf_core::constants::get_config;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const ADA: u64 = 1_000_000;

struct World {
    chain: Chain,
    owner: Register,
    wallet: Address,
    signer: Hash<28>,
}

fn world() -> World {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    let chain = Chain {
        params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    };
    let key = SecretKey::new(OsRng);
    World {
        wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
        chain,
        owner: Register::create(random_scalar()).unwrap(),
        signer: Hasher::<224>::hash(PrivateKey::from(key).public_key().as_ref()),
    }
}

fn utxo(w: &World, n: u32, lovelace: u64, token: Option<&str>) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    UtxoResponse {
        tx_hash: format!("{n:08x}").repeat(8),
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
            token
                .map(|name| Asset {
                    decimals: 0,
                    quantity: "1".into(),
                    policy_id: TOKEN_POLICY.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .into_iter()
                .collect(),
        ),
        ..Default::default()
    }
}

fn send(_w: &World, lovelace: u64) -> Vec<Payment> {
    vec![Payment {
        register: Register::create(random_scalar()).unwrap(),
        lovelace,
        tokens: Assets::new(),
    }]
}

fn pays(w: &World, inputs: &[&UtxoResponse], lovelace: u64) -> bool {
    let inputs: Vec<UtxoResponse> = inputs.iter().map(|u| (*u).clone()).collect();
    build::transfer_from(&w.chain, &inputs, &send(w, lovelace), &w.owner, w.signer)
        .and_then(|s| s.estimate().map(|_| ()))
        .is_ok()
}

fn most(w: &World, inputs: &[&UtxoResponse]) -> u64 {
    let (mut lo, mut hi) = (2 * ADA, inputs.iter().map(|u| u.value.parse::<u64>().unwrap()).sum::<u64>());
    assert!(pays(w, inputs, lo) && !pays(w, inputs, hi));
    while hi - lo > 1_000 {
        let mid = lo + (hi - lo) / 2;
        if pays(w, inputs, mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Known.kept: M, money made private holding a pool's token, so a's change keeps it; T, a plain way back of that
/// pool, 6.5 ₳ and its token (beside that change it pays all its ADA, 6.5 ₳; beside an ADA change 6.31 ₳); X, a mixed
/// box of 6.4 ₳ of ADA alone. A Send just under what M and X pay: M and T pay too, M alone doesn't. By rule 4, of
/// as many boxes the one a mix moved: M and X.
#[test]
fn known_kept_scenario() {
    let w = world();
    let m = utxo(&w, 0x0100_0001, 10 * ADA, Some("pooltoken"));
    let t = utxo(&w, 0x0100_0002, 6_500_000, Some("pooltoken"));
    let x = utxo(&w, 0x0100_0003, 6_400_000, None);
    let lovelace = most(&w, &[&m, &x]) - 50_000;
    assert!(pays(&w, &[&m, &t], lovelace), "M and T pay");
    assert!(!pays(&w, &[&m], lovelace), "M alone is short");
    assert!(!pays(&w, &[&x], lovelace) && !pays(&w, &[&t], lovelace));
    let h = Histories::new(Purpose::Pay)
        .with(&m.tx_hash, 0, Class { id: "public:0".into(), origin: Origin::Own })
        .with(&t.tx_hash, 0, Class { id: format!("box:{}", t.tx_hash), origin: Origin::Lovejoin })
        .with(&x.tx_hash, 0, Class { id: format!("box:{}", x.tx_hash), origin: Origin::Mixed });
    let available = vec![m.clone(), t.clone(), x.clone()];
    let picked = build::transfer_apart(&w.chain, &available, &h, &send(&w, lovelace), &w.owner, w.signer)
        .expect("builds")
        .inputs();
    let names: Vec<&str> = picked
        .iter()
        .map(|u| if u.tx_hash == m.tx_hash { "M" } else if u.tx_hash == t.tx_hash { "T" } else { "X" })
        .collect();
    println!("known_kept_scenario: a Send of {lovelace}: spent {names:?}");
    let mut sorted = names.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, vec!["M", "X"], "of as many boxes, the one a mix moved");
}

/// short_whole: 22 plain ways back of 13.19 ₳ (290.18 ₳ together, short of a 290 ₳ Send by its fee) beside 10 of
/// unknown making of 10 ₳: nothing of 22 inputs pays, 23 are too many, so the payment is too large for one
/// transaction and goes in parts. The pass before the first box of unknown making grows all of the rest without
/// them, the 22 plain ones, which are short.
#[test]
fn short_whole_scenario() {
    let w = world();
    let mut available = Vec::new();
    let mut h = Histories::new(Purpose::Pay);
    for i in 0..22u32 {
        let u = utxo(&w, 0x0200_0000 + i, 13_190_000, None);
        h = h.with(&u.tx_hash, 0, Class { id: format!("box:{}", u.tx_hash), origin: Origin::Lovejoin });
        available.push(u);
    }
    for i in 0..10u32 {
        let u = utxo(&w, 0x0300_0000 + i, 10 * ADA, None);
        h = h.with(
            &u.tx_hash,
            0,
            Class { id: format!("box:{0}+unknown:{0}", u.tx_hash), origin: Origin::Lovejoin },
        );
        available.push(u);
    }
    let plain: Vec<&UtxoResponse> = available[..22].iter().collect();
    assert!(!pays(&w, &plain, 290 * ADA), "the 22 plain ones are short");
    let e = build::transfer_apart(&w.chain, &available, &h, &send(&w, 290 * ADA), &w.owner, w.signer)
        .map(|s| s.inputs().len())
        .expect_err("nothing of 22 inputs pays");
    println!("short_whole_scenario: refused: {e} (too many: {}, short: {})", build::is_too_many(&e), build::is_short(&e));
    assert!(build::is_too_many(&e), "refused as too many for one transaction, so it goes in parts: {e}");
}
