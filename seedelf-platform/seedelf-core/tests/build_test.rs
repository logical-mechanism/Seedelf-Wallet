//! The network-free builders: move-in from a Cardano account into the wallet
//! contract. Every transaction is decoded and checked: value conserved, no
//! output below its minimum, every contract output an owned, valid register,
//! and the fee covering the signed size.

use std::collections::BTreeMap;

use pallas_addresses::Address;
use pallas_primitives::alonzo::{MaybeIndefArray, PlutusData};
use pallas_primitives::conway::DatumOption;
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::Output;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::Assets;
use seedelf_core::build::{self, MoveInAmount, fake_signer, linear_fee, minimum_deposit};
use seedelf_core::constants::get_config;
use seedelf_core::transaction::calculate_min_required_utxo;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

struct World {
    params: ProtocolParameters,
    account: CardanoAccount,
    sk: blstrs::Scalar,
    owner: Register,
    wallet: Address,
    change: Address,
}

fn world() -> World {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let sk = random_scalar();
    let config = get_config(1, true).unwrap();
    World {
        params: params(),
        change: account.base_address(true, Role::Receive, 0).unwrap(),
        account,
        sk,
        owner: Register::create(sk).unwrap(),
        wallet: wallet_contract(true, config.contract.wallet_contract_hash),
    }
}

fn token(name: &str, quantity: u64) -> Asset {
    Asset {
        decimals: 0,
        quantity: quantity.to_string(),
        policy_id: POLICY.to_string(),
        asset_name: hex::encode(name),
        fingerprint: String::new(),
    }
}

/// A UTxO at the account's receive address `index`.
fn utxo(w: &World, n: u8, index: u32, lovelace: u64, assets: Vec<Asset>) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: 0,
        address: w
            .account
            .base_address(true, Role::Receive, index)
            .unwrap()
            .to_bech32()
            .unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(w.account.key_hash(Role::Receive, index).unwrap()),
        asset_list: Some(assets),
        ..Default::default()
    }
}

struct Out {
    address: Address,
    lovelace: u64,
    assets: BTreeMap<(String, String), u64>,
    register: Option<Register>,
    raw: Output,
}

struct Decoded {
    inputs: Vec<String>,
    outputs: Vec<Out>,
    fee: u64,
    size_signed: u64,
}

fn decode(built: &build::MoveIn, signers: usize) -> Decoded {
    let mut signed = built.tx.clone();
    for _ in 0..signers {
        signed = signed.sign(fake_signer()).unwrap();
    }
    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    let outputs = tx
        .outputs()
        .iter()
        .map(|o| {
            let mut assets = BTreeMap::new();
            let mut raw = Output::new(o.address().unwrap(), o.value().coin());
            for policy in o.value().assets() {
                for asset in policy.assets() {
                    let qty = asset.output_coin().unwrap();
                    assets.insert(
                        (hex::encode(*policy.policy()), hex::encode(asset.name())),
                        qty,
                    );
                    raw = raw
                        .add_asset(*policy.policy(), asset.name().to_vec(), qty)
                        .unwrap();
                }
            }
            let register = o.datum().and_then(|d| register_of(d.into()));
            if let Some(r) = &register {
                raw = raw.set_inline_datum(r.to_vec().unwrap());
            }
            Out {
                address: o.address().unwrap(),
                lovelace: o.value().coin(),
                assets,
                register,
                raw,
            }
        })
        .collect();
    Decoded {
        inputs: tx.inputs().iter().map(|i| hex::encode(*i.hash())).collect(),
        outputs,
        fee: tx.fee().unwrap(),
        size_signed: signed.tx_bytes.0.len() as u64,
    }
}

fn register_of(datum: DatumOption) -> Option<Register> {
    let DatumOption::Data(wrapped) = datum else {
        return None;
    };
    let PlutusData::Constr(constr) = &*wrapped else {
        return None;
    };
    let fields = match &constr.fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    let bytes = |pd: &PlutusData| match pd {
        PlutusData::BoundedBytes(b) => Some(hex::encode::<&[u8]>(b)),
        _ => None,
    };
    Some(Register::new(
        bytes(fields.first()?)?,
        bytes(fields.get(1)?)?,
    ))
}

/// The checks every move-in must pass.
fn assert_sound(w: &World, available: &[UtxoResponse], built: &build::MoveIn) -> Decoded {
    let signers = built
        .inputs
        .iter()
        .map(|u| u.payment_cred.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let tx = decode(built, signers);

    // Value is conserved: inputs = outputs + fee, per token too.
    let spent: Vec<&UtxoResponse> = tx
        .inputs
        .iter()
        .map(|h| {
            available
                .iter()
                .find(|u| &u.tx_hash == h)
                .expect("input is an available UTxO")
        })
        .collect();
    let in_lovelace: u64 = spent.iter().map(|u| u.value.parse::<u64>().unwrap()).sum();
    let out_lovelace: u64 = tx.outputs.iter().map(|o| o.lovelace).sum();
    assert_eq!(in_lovelace, out_lovelace + tx.fee, "lovelace conserved");
    let mut in_assets: BTreeMap<(String, String), u64> = BTreeMap::new();
    for u in &spent {
        for a in u.asset_list.iter().flatten() {
            *in_assets
                .entry((a.policy_id.clone(), a.asset_name.clone()))
                .or_default() += a.quantity.parse::<u64>().unwrap();
        }
    }
    let mut out_assets: BTreeMap<(String, String), u64> = BTreeMap::new();
    for o in &tx.outputs {
        for (k, q) in &o.assets {
            *out_assets.entry(k.clone()).or_default() += q;
        }
    }
    assert_eq!(in_assets, out_assets, "tokens conserved");

    // The fee covers the transaction once every input's key has signed.
    assert_eq!(tx.fee, built.fee);
    assert!(
        tx.fee >= linear_fee(tx.size_signed),
        "fee {} < {}",
        tx.fee,
        linear_fee(tx.size_signed)
    );
    assert!(
        tx.fee < linear_fee(tx.size_signed) + 1_000,
        "fee isn't wildly high"
    );

    for o in &tx.outputs {
        let minimum = calculate_min_required_utxo(o.raw.clone(), &w.params).unwrap();
        assert!(
            o.lovelace >= minimum,
            "output {} below its minimum {}",
            o.lovelace,
            minimum
        );
        if o.address == w.wallet {
            let register = o
                .register
                .as_ref()
                .expect("contract outputs carry a register");
            assert!(register.is_valid().unwrap(), "register points are valid");
            assert!(register.is_owned(w.sk).unwrap(), "register is the owner's");
            assert_ne!(
                register.generator, w.owner.generator,
                "register is re-randomized"
            );
        } else {
            assert_eq!(o.address, w.change, "anything else is change to 0/0");
            assert!(o.register.is_none());
        }
    }
    // Never a 5 ADA pure-ADA UTxO.
    for u in &spent {
        assert!(
            !(u.value == "5000000" && u.asset_list.as_ref().is_none_or(|a| a.is_empty())),
            "collateral spent"
        );
    }
    tx
}

fn deposits(w: &World, tx: &Decoded) -> (u64, usize) {
    let outs: Vec<&Out> = tx
        .outputs
        .iter()
        .filter(|o| o.address == w.wallet)
        .collect();
    (outs.iter().map(|o| o.lovelace).sum(), outs.len())
}

#[test]
fn moves_an_amount_from_pure_ada_first_and_leaves_collateral() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 5_000_000, vec![]),
        utxo(&w, 2, 0, 10_000_000, vec![]),
        utxo(&w, 3, 1, 3_000_000, vec![token("nft", 1)]),
        utxo(&w, 4, 2, 50_000_000, vec![]),
    ];
    let built = build::move_in(
        &w.params,
        &available,
        MoveInAmount::Lovelace(20_000_000),
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);

    assert_eq!(
        tx.inputs,
        vec![hex::encode([4u8; 32])],
        "the largest pure-ADA UTxO covers it"
    );
    assert_eq!(deposits(&w, &tx), (20_000_000, 1));
    assert_eq!(built.lovelace, 20_000_000);
    assert_eq!(built.change_lovelace, 50_000_000 - 20_000_000 - built.fee);
    assert!(built.tokens.items.is_empty());
}

#[test]
fn adds_inputs_until_the_change_is_valid() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 10_000_000, vec![]),
        utxo(&w, 2, 3, 9_000_000, vec![]),
    ];
    // 9.5 ADA from the 10 ADA UTxO would leave dust change, so both are spent.
    let built = build::move_in(
        &w.params,
        &available,
        MoveInAmount::Lovelace(9_500_000),
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);
    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(built.change_lovelace, 19_000_000 - 9_500_000 - built.fee);
}

#[test]
fn picked_tokens_move_in_full_and_the_rest_come_back() {
    let w = world();
    let available = vec![
        utxo(
            &w,
            1,
            0,
            2_000_000,
            vec![token("tUSDM", 700), token("keep", 1)],
        ),
        utxo(&w, 2, 1, 1_500_000, vec![token("tUSDM", 300)]),
        utxo(&w, 3, 2, 30_000_000, vec![]),
    ];
    let picked = vec![(POLICY.to_string(), hex::encode("tUSDM"))];
    let built = build::move_in(
        &w.params,
        &available,
        MoveInAmount::Lovelace(5_000_000),
        &picked,
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);

    assert_eq!(tx.inputs.len(), 3, "both tUSDM UTxOs, plus ADA");
    let contract: Vec<&Out> = tx
        .outputs
        .iter()
        .filter(|o| o.address == w.wallet)
        .collect();
    assert_eq!(contract.len(), 1);
    assert_eq!(
        contract[0]
            .assets
            .get(&(POLICY.to_string(), hex::encode("tUSDM"))),
        Some(&1000)
    );
    let change: Vec<&Out> = tx
        .outputs
        .iter()
        .filter(|o| o.address == w.change)
        .collect();
    assert_eq!(change.len(), 1);
    assert_eq!(
        change[0]
            .assets
            .get(&(POLICY.to_string(), hex::encode("keep"))),
        Some(&1)
    );
    assert!(
        !change[0]
            .assets
            .contains_key(&(POLICY.to_string(), hex::encode("tUSDM")))
    );
    assert_eq!(built.tokens.items.len(), 1);
    assert_eq!(built.change_tokens.items.len(), 1);
}

#[test]
fn max_moves_everything_but_the_fee_and_the_change_floor() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 5_000_000, vec![]),
        utxo(&w, 2, 0, 12_345_678, vec![]),
        utxo(&w, 3, 4, 2_000_000, vec![token("keep", 5)]),
    ];
    let built = build::move_in(
        &w.params,
        &available,
        MoveInAmount::Max,
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);

    assert_eq!(tx.inputs.len(), 2, "everything but the collateral");
    let change: Vec<&Out> = tx
        .outputs
        .iter()
        .filter(|o| o.address == w.change)
        .collect();
    assert_eq!(change.len(), 1);
    let floor = calculate_min_required_utxo(change[0].raw.clone(), &w.params).unwrap();
    assert!(
        change[0].lovelace >= floor && change[0].lovelace < floor + 100_000,
        "change keeps about its minimum"
    );
    assert_eq!(
        built.lovelace,
        14_345_678 - built.fee - built.change_lovelace
    );

    // With no tokens staying, Max leaves no change at all.
    let pure = vec![
        utxo(&w, 7, 0, 8_000_000, vec![]),
        utxo(&w, 8, 1, 4_000_000, vec![]),
    ];
    let all = build::move_in(
        &w.params,
        &pure,
        MoveInAmount::Max,
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .unwrap();
    let tx = assert_sound(&w, &pure, &all);
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(all.change_lovelace, 0);
    assert_eq!(all.lovelace, 12_000_000 - all.fee);
}

#[test]
fn many_tokens_split_twenty_to_an_output() {
    let w = world();
    let tokens: Vec<Asset> = (0..25).map(|i| token(&format!("t{i:02}"), 1)).collect();
    let picked: Vec<(String, String)> = tokens
        .iter()
        .map(|t| (t.policy_id.clone(), t.asset_name.clone()))
        .collect();
    let available = vec![
        utxo(&w, 1, 0, 3_000_000, tokens),
        utxo(&w, 2, 1, 40_000_000, vec![]),
    ];
    let built = build::move_in(
        &w.params,
        &available,
        MoveInAmount::Lovelace(10_000_000),
        &picked,
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);
    assert_eq!(deposits(&w, &tx), (10_000_000, 2));
    assert_eq!(built.deposit_outputs, 2);
}

#[test]
fn explains_what_is_wrong() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 5_000_000, vec![]),
        utxo(&w, 2, 0, 10_000_000, vec![token("nft", 1)]),
    ];
    let err = |amount, picked: &[(String, String)]| {
        build::move_in(
            &w.params, &available, amount, picked, &w.owner, &w.wallet, &w.change,
        )
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default()
    };
    assert!(
        err(MoveInAmount::Lovelace(500_000), &[]).contains("needs at least"),
        "below a contract output's minimum"
    );
    assert!(
        err(MoveInAmount::Lovelace(9_900_000), &[]).contains("Not enough ADA"),
        "more than there is"
    );
    assert!(
        err(
            MoveInAmount::Lovelace(2_000_000),
            &[(POLICY.to_string(), hex::encode("absent"))]
        )
        .contains("doesn't hold")
    );
    let only_collateral = vec![utxo(&w, 3, 0, 5_000_000, vec![])];
    let e = build::move_in(
        &w.params,
        &only_collateral,
        MoveInAmount::Max,
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
    )
    .err()
    .unwrap();
    assert!(e.to_string().contains("nothing"), "{e}");
    assert!(minimum_deposit(&w.params, &Assets::new()).unwrap() > 1_000_000);
}
