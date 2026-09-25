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
use seedelf_core::build::{self, AccountAmount, AccountPay, Payee, fake_signer, minimum_deposit};
use seedelf_core::constants::get_config;
use seedelf_core::staking::Staking;
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

fn decode(built: &build::AccountPayment, signers: usize) -> Decoded {
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
fn assert_sound(w: &World, available: &[UtxoResponse], built: &build::AccountPayment) -> Decoded {
    assert_paid(w, available, built, None)
}

/// The checks every account payment must pass; a send's outputs to `to` are
/// the payment.
fn assert_paid(
    w: &World,
    available: &[UtxoResponse],
    built: &build::AccountPayment,
    to: Option<&Address>,
) -> Decoded {
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

    // The fee covers the transaction once every input's key has signed, by
    // the ledger's own formula: 44 lovelace a byte plus 155,381 (the
    // fixture's min_fee_a and min_fee_b).
    assert_eq!(tx.fee, built.fee);
    assert_eq!((w.params.min_fee_a, w.params.min_fee_b), (44, 155_381));
    let ledger_minimum = 44 * tx.size_signed + 155_381;
    assert!(
        tx.fee >= ledger_minimum,
        "fee {} < {ledger_minimum}",
        tx.fee
    );
    assert!(tx.fee < ledger_minimum + 1_000, "fee isn't wildly high");

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
            assert!(
                o.address == w.change || Some(&o.address) == to,
                "anything else is the payment or change to 0/0"
            );
            assert!(o.register.is_none());
        }
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
fn moves_an_amount_from_pure_ada_first() {
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
        AccountAmount::Lovelace(20_000_000),
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
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
        AccountAmount::Lovelace(9_500_000),
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
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
    let picked = vec![(POLICY.to_string(), hex::encode("tUSDM"), 1000)];
    let built = build::move_in(
        &w.params,
        &available,
        AccountAmount::Lovelace(5_000_000),
        &picked,
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
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
fn part_of_a_token_moves_in_and_the_rest_comes_back() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 2_000_000, vec![token("tUSDM", 700)]),
        utxo(&w, 2, 1, 1_500_000, vec![token("tUSDM", 300)]),
        utxo(&w, 3, 2, 30_000_000, vec![]),
    ];
    let picked = vec![(POLICY.to_string(), hex::encode("tUSDM"), 250)];
    let built = build::move_in(
        &w.params,
        &available,
        AccountAmount::Lovelace(5_000_000),
        &picked,
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);
    let key = (POLICY.to_string(), hex::encode("tUSDM"));
    let held_at = |addr: &Address| -> u64 {
        tx.outputs
            .iter()
            .filter(|o| o.address == *addr)
            .filter_map(|o| o.assets.get(&key))
            .sum()
    };
    assert_eq!(held_at(&w.wallet), 250);
    assert_eq!(held_at(&w.change), 750);
    assert_eq!(built.tokens.items[0].amount, 250);
    assert_eq!(built.change_tokens.items[0].amount, 750);
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
        AccountAmount::Max,
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);

    assert_eq!(
        tx.inputs.len(),
        3,
        "everything it's given, a 5 ADA UTxO too"
    );
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
        19_345_678 - built.fee - built.change_lovelace
    );

    // With no tokens staying, Max leaves no change at all.
    let pure = vec![
        utxo(&w, 7, 0, 8_000_000, vec![]),
        utxo(&w, 8, 1, 4_000_000, vec![]),
    ];
    let all = build::move_in(
        &w.params,
        &pure,
        AccountAmount::Max,
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
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
    let picked: Vec<(String, String, u64)> = tokens
        .iter()
        .map(|t| (t.policy_id.clone(), t.asset_name.clone(), 1))
        .collect();
    let available = vec![
        utxo(&w, 1, 0, 3_000_000, tokens),
        utxo(&w, 2, 1, 40_000_000, vec![]),
    ];
    let built = build::move_in(
        &w.params,
        &available,
        AccountAmount::Lovelace(10_000_000),
        &picked,
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &built);
    assert_eq!(deposits(&w, &tx), (10_000_000, 2));
    assert_eq!(built.outputs, 2);
}

#[test]
fn explains_what_is_wrong() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 5_000_000, vec![]),
        utxo(&w, 2, 0, 10_000_000, vec![token("nft", 1)]),
    ];
    let err = |amount, picked: &[(String, String, u64)]| {
        build::move_in(
            &w.params,
            &available,
            amount,
            picked,
            &w.owner,
            &w.wallet,
            &w.change,
            &Staking::none(),
        )
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default()
    };
    assert!(
        err(AccountAmount::Lovelace(500_000), &[]).contains("needs at least"),
        "below a contract output's minimum"
    );
    assert!(
        err(AccountAmount::Lovelace(14_900_000), &[]).contains("Not enough ADA"),
        "more than there is"
    );
    assert!(
        err(
            AccountAmount::Lovelace(2_000_000),
            &[(POLICY.to_string(), hex::encode("absent"), 1)]
        )
        .contains("doesn't hold")
    );
    assert!(
        err(
            AccountAmount::Lovelace(2_000_000),
            &[(POLICY.to_string(), hex::encode("nft"), 2)]
        )
        .contains("holds only 1")
    );
    assert!(
        err(
            AccountAmount::Lovelace(2_000_000),
            &[(POLICY.to_string(), hex::encode("nft"), 0)]
        )
        .contains("more than none")
    );
    let e = build::move_in(
        &w.params,
        &[],
        AccountAmount::Max,
        &[],
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
    )
    .err()
    .unwrap();
    assert!(e.to_string().contains("nothing"), "{e}");
    assert!(minimum_deposit(&w.params, &Assets::new()).unwrap() > 1_000_000);
}

// ---------------------------------------------------------------------------
// Send: the Cardano account pays an address
// ---------------------------------------------------------------------------

/// Someone else's address: another account of the same phrase.
fn elsewhere() -> Address {
    CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap()
}

fn paid_to<'a>(tx: &'a Decoded, to: &Address) -> Vec<&'a Out> {
    tx.outputs.iter().filter(|o| o.address == *to).collect()
}

#[test]
fn sends_an_amount_and_part_of_a_token_to_an_address() {
    let w = world();
    let to = elsewhere();
    let available = vec![
        utxo(&w, 1, 0, 5_000_000, vec![]),
        utxo(
            &w,
            2,
            0,
            2_000_000,
            vec![token("tUSDM", 1000), token("keep", 1)],
        ),
        utxo(&w, 3, 2, 30_000_000, vec![]),
    ];
    let picked = vec![(POLICY.to_string(), hex::encode("tUSDM"), 250)];
    let built = build::account_send(
        &w.params,
        &available,
        AccountAmount::Lovelace(3_000_000),
        &picked,
        &to,
        true,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_paid(&w, &available, &built, Some(&to));

    let paid = paid_to(&tx, &to);
    assert_eq!(paid.len(), 1, "one output pays");
    // The web wallet's collateral payment relies on this: its 5 ADA is output 0.
    assert_eq!(tx.outputs[0].address, to, "the payment is the first output");
    assert_eq!(paid[0].lovelace, 3_000_000);
    let key = (POLICY.to_string(), hex::encode("tUSDM"));
    assert_eq!(paid[0].assets.get(&key), Some(&250));
    assert_eq!(paid[0].assets.len(), 1, "only the picked token goes");
    assert_eq!(built.outputs, 1);
    assert!(deposits(&w, &tx).1 == 0, "nothing goes into the contract");
    let change: u64 = paid_to(&tx, &w.change)
        .iter()
        .filter_map(|o| o.assets.get(&key))
        .sum();
    assert_eq!(change, 750, "the rest of the token comes back");
    assert_eq!(built.change_tokens.items.len(), 2, "tUSDM's rest and keep");
}

#[test]
fn send_max_pays_everything_but_the_fee_and_the_change_floor() {
    let w = world();
    let to = elsewhere();
    let available = vec![
        utxo(&w, 1, 0, 5_000_000, vec![]),
        utxo(&w, 2, 0, 12_345_678, vec![]),
        utxo(&w, 3, 4, 2_000_000, vec![token("keep", 5)]),
    ];
    let built = build::account_send(
        &w.params,
        &available,
        AccountAmount::Max,
        &[],
        &to,
        true,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_paid(&w, &available, &built, Some(&to));
    assert_eq!(
        tx.inputs.len(),
        3,
        "everything it's given, a 5 ADA UTxO too"
    );
    assert_eq!(paid_to(&tx, &to)[0].lovelace, built.lovelace);
    assert_eq!(
        built.lovelace,
        19_345_678 - built.fee - built.change_lovelace
    );
    assert_eq!(built.change_tokens.items.len(), 1, "the token stays");
}

#[test]
fn send_refuses_what_would_lose_money() {
    let w = world();
    let available = vec![utxo(&w, 2, 0, 20_000_000, vec![token("nft", 1)])];
    let err = |to: &Address, lovelace| {
        build::account_send(
            &w.params,
            &available,
            AccountAmount::Lovelace(lovelace),
            &[],
            to,
            true,
            &w.change,
            &Staking::none(),
        )
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default()
    };
    // A script (the wallet contract itself: the output would carry no datum).
    assert!(err(&w.wallet, 2_000_000).contains("normal preprod address"));
    // Mainnet, from preprod.
    let mainnet = w.account.base_address(false, Role::Receive, 0).unwrap();
    assert!(err(&mainnet, 2_000_000).contains("normal preprod address"));
    // Below the output's minimum.
    assert!(err(&elsewhere(), 500_000).contains("needs at least"));
    // More than there is.
    assert!(err(&elsewhere(), 19_990_000).contains("for this payment"));
}

#[test]
fn a_payment_of_exactly_the_minimum_is_valid() {
    let w = world();
    let to = elsewhere();
    let available = vec![
        utxo(
            &w,
            2,
            0,
            2_000_000,
            vec![token("tUSDM", 1000), token("nft", 1)],
        ),
        utxo(&w, 3, 2, 30_000_000, vec![]),
    ];
    let picked = vec![
        (POLICY.to_string(), hex::encode("tUSDM"), 400),
        (POLICY.to_string(), hex::encode("nft"), 1),
    ];
    let tokens = Assets {
        items: picked
            .iter()
            .map(|(p, n, q)| seedelf_core::assets::Asset::new(p.clone(), n.clone(), *q).unwrap())
            .collect(),
    };

    // To an address: one output, at exactly its minimum.
    let minimum = build::minimum_address_payment(&w.params, &to, &tokens).unwrap();
    assert_eq!(
        minimum,
        build::Payee::Address(&to)
            .minimum(&w.params, &tokens)
            .unwrap()
    );
    assert!(minimum > 1_000_000 && minimum < 2_000_000, "{minimum}");
    let sent = build::account_send(
        &w.params,
        &available,
        AccountAmount::Lovelace(minimum),
        &picked,
        &to,
        true,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_paid(&w, &available, &sent, Some(&to));
    assert_eq!(paid_to(&tx, &to)[0].lovelace, minimum);
    let short = build::account_send(
        &w.params,
        &available,
        AccountAmount::Lovelace(minimum - 1),
        &picked,
        &to,
        true,
        &w.change,
        &Staking::none(),
    );
    assert!(short.is_err(), "a lovelace less is refused");

    // Into Seedelf: the deposit's minimum.
    let deposit = minimum_deposit(&w.params, &tokens).unwrap();
    let payee = build::Payee::Seedelf {
        owner: &w.owner,
        wallet_addr: &w.wallet,
    };
    assert_eq!(deposit, payee.minimum(&w.params, &tokens).unwrap());
    let moved = build::move_in(
        &w.params,
        &available,
        AccountAmount::Lovelace(deposit),
        &picked,
        &w.owner,
        &w.wallet,
        &w.change,
        &Staking::none(),
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &moved);
    assert_eq!(deposits(&w, &tx), (deposit, 1));

    // A payment to a seedelf is one contract output, as a deposit of up to 20 tokens is.
    assert_eq!(
        build::minimum_seedelf_payment(&w.params, &tokens).unwrap(),
        deposit
    );
}

// ---------------------------------------------------------------------------
// The Cardano account pays someone's seedelf
// ---------------------------------------------------------------------------

#[test]
fn funds_a_seedelf_under_a_fresh_copy_of_its_register() {
    let w = world();
    // The register a seedelf sits under: already a re-randomization of its
    // owner's base register (the world's `sk`).
    let found = w.owner.clone().rerandomize().unwrap();
    let tokens: Vec<Asset> = (0..25).map(|i| token(&format!("t{i:02}"), 3)).collect();
    let picked: Vec<(String, String, u64)> = tokens
        .iter()
        .map(|t| (t.policy_id.clone(), t.asset_name.clone(), 2))
        .collect();
    let available = vec![
        utxo(&w, 1, 0, 3_000_000, tokens),
        utxo(&w, 2, 1, 40_000_000, vec![]),
    ];
    let seedelf = Payee::Seedelf {
        owner: &found,
        wallet_addr: &w.wallet,
    };
    let fund = |amount, picked: &[(String, String, u64)]| {
        build::account_send_many(
            &w.params,
            &available,
            &[AccountPay::new(seedelf, amount, picked)],
            true,
            &w.change,
            &Staking::none(),
            None,
        )
    };
    let built = fund(AccountAmount::Lovelace(10_000_000), &picked).unwrap();
    // Every contract output is the owner's, valid, and re-randomized.
    let tx = assert_sound(&w, &available, &built);
    assert_eq!(deposits(&w, &tx), (10_000_000, 2), "20 tokens to an output");
    for o in tx.outputs.iter().filter(|o| o.address == w.wallet) {
        let paid = o.register.as_ref().unwrap();
        assert_ne!(paid.generator, found.generator, "never the register found");
        assert_ne!(paid.public_value, found.public_value);
        assert!(!paid.is_owned(random_scalar()).unwrap());
    }
    // The rest of each token comes back to the account.
    assert_eq!(built.change_tokens.items.len(), 25);
    assert!(built.change_tokens.items.iter().all(|a| a.amount == 1));

    // Max pays everything the account holds, less the fee and the change floor.
    let max = fund(AccountAmount::Max, &[]).unwrap();
    let tx = assert_sound(&w, &available, &max);
    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(deposits(&w, &tx).0, max.lovelace);
}

#[test]
fn paying_a_seedelf_refuses_a_register_that_would_lose_the_money() {
    let w = world();
    let available = vec![utxo(&w, 1, 0, 20_000_000, vec![])];
    let err = |recipient: &Register, lovelace| {
        let seedelf = Payee::Seedelf {
            owner: recipient,
            wallet_addr: &w.wallet,
        };
        build::account_send_many(
            &w.params,
            &available,
            &[AccountPay::new(
                seedelf,
                AccountAmount::Lovelace(lovelace),
                &[],
            )],
            true,
            &w.change,
            &Staking::none(),
            None,
        )
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default()
    };
    let identity = format!("c0{}", "00".repeat(47));
    let generator = Register::create(random_scalar()).unwrap().generator;
    for bad in [
        // Anyone could prove the key to an identity public value, and take it.
        Register::new(generator.clone(), identity.clone()),
        // An identity generator, or points that aren't on the curve, lock it for good.
        Register::new(identity, w.owner.public_value.clone()),
        Register::new("00".repeat(48), "00".repeat(48)),
        Register::new(generator, "zz".into()),
    ] {
        assert!(
            err(&bad, 2_000_000).contains("register isn't valid"),
            "{bad:?}"
        );
    }
    // A good register still has the minimums and the balance to meet.
    assert!(err(&w.owner, 500_000).contains("needs at least"));
    assert!(err(&w.owner, 19_990_000).contains("for this payment"));
}

// ---------------------------------------------------------------------------
// Several recipients in one payment from the Cardano account
// ---------------------------------------------------------------------------

#[test]
fn pays_several_recipients_in_order_each_its_own_amount_and_tokens() {
    let w = world();
    let to = elsewhere();
    let found = w.owner.clone().rerandomize().unwrap();
    let seedelf = Payee::Seedelf {
        owner: &found,
        wallet_addr: &w.wallet,
    };
    let tusdm = |q| vec![(POLICY.to_string(), hex::encode("tUSDM"), q)];
    let available = vec![
        utxo(
            &w,
            1,
            0,
            2_000_000,
            vec![token("tUSDM", 1000), token("keep", 1)],
        ),
        utxo(&w, 2, 1, 30_000_000, vec![]),
    ];
    let recipients = [
        AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(3_000_000),
            &tusdm(250),
        ),
        AccountPay::new(seedelf, AccountAmount::Lovelace(4_000_000), &tusdm(100)),
        AccountPay::new(Payee::Address(&to), AccountAmount::Lovelace(2_000_000), &[]),
    ];
    let built = build::account_send_many(
        &w.params,
        &available,
        &recipients,
        true,
        &w.change,
        &Staking::none(),
        None,
    )
    .unwrap();
    let tx = assert_paid(&w, &available, &built, Some(&to));

    let key = (POLICY.to_string(), hex::encode("tUSDM"));
    let shape: Vec<(bool, u64, Option<u64>)> = tx
        .outputs
        .iter()
        .take(3)
        .map(|o| {
            (
                o.address == w.wallet,
                o.lovelace,
                o.assets.get(&key).copied(),
            )
        })
        .collect();
    assert_eq!(
        shape,
        vec![
            (false, 3_000_000, Some(250)),
            (true, 4_000_000, Some(100)),
            (false, 2_000_000, None),
        ],
        "each recipient as asked, in order, before the change"
    );
    assert_eq!(tx.outputs[0].address, to);
    assert_eq!(tx.outputs[2].address, to);
    let paid = tx.outputs[1].register.as_ref().unwrap();
    assert_ne!(
        paid.generator, found.generator,
        "a fresh copy of the Seedelf's register"
    );
    assert_eq!(built.paid, vec![3_000_000, 4_000_000, 2_000_000]);
    assert_eq!(built.lovelace, 9_000_000);
    assert_eq!(built.outputs, 3);
    assert_eq!(built.tokens.items[0].amount, 350);
    let change: u64 = paid_to(&tx, &w.change)
        .iter()
        .filter_map(|o| o.assets.get(&key))
        .sum();
    assert_eq!(change, 650, "the rest of the token comes back");
}

#[test]
fn several_recipients_refuse_max_too_much_and_no_one() {
    let w = world();
    let to = elsewhere();
    let available = vec![
        utxo(&w, 1, 0, 2_000_000, vec![token("tUSDM", 1000)]),
        utxo(&w, 2, 1, 30_000_000, vec![]),
    ];
    let tusdm = |q| vec![(POLICY.to_string(), hex::encode("tUSDM"), q)];
    let err = |recipients: &[AccountPay]| {
        build::account_send_many(
            &w.params,
            &available,
            recipients,
            true,
            &w.change,
            &Staking::none(),
            None,
        )
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default()
    };
    let two = |a, b| {
        [
            AccountPay::new(Payee::Address(&to), a, &[]),
            AccountPay::new(Payee::Address(&to), b, &[]),
        ]
    };
    assert!(
        err(&two(AccountAmount::Max, AccountAmount::Lovelace(2_000_000)))
            .contains("Max pays a single recipient")
    );
    assert!(
        err(&two(
            AccountAmount::Lovelace(20_000_000),
            AccountAmount::Lovelace(20_000_000)
        ))
        .contains("for this payment")
    );
    // Their tokens together can't be more than the account holds.
    let greedy = [
        AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(2_000_000),
            &tusdm(600),
        ),
        AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(2_000_000),
            &tusdm(401),
        ),
    ];
    assert!(err(&greedy).contains("holds only 1000"));
    assert!(err(&[]).contains("someone to pay"));
    assert!(
        err(&[AccountPay::new(
            Payee::Nobody,
            AccountAmount::Lovelace(0),
            &[]
        )])
        .contains("someone to pay")
    );
    let identity = format!("c0{}", "00".repeat(47));
    let lost = Register::new(
        Register::create(random_scalar()).unwrap().generator,
        identity,
    );
    let bad = Payee::Seedelf {
        owner: &lost,
        wallet_addr: &w.wallet,
    };
    assert!(
        err(&[AccountPay::new(
            bad,
            AccountAmount::Lovelace(2_000_000),
            &[]
        )])
        .contains("register isn't valid")
    );
    let script = Payee::Address(&w.wallet);
    assert!(
        err(&[AccountPay::new(
            script,
            AccountAmount::Lovelace(2_000_000),
            &[]
        )])
        .contains("normal preprod address")
    );
}

#[test]
fn a_transaction_over_the_size_limit_is_refused_in_words() {
    let w = world();
    let to = elsewhere();
    let available = vec![utxo(&w, 1, 0, 1_000_000_000, vec![])];
    let recipients: Vec<AccountPay> = (0..300)
        .map(|_| AccountPay::new(Payee::Address(&to), AccountAmount::Lovelace(1_500_000), &[]))
        .collect();
    let e = build::account_send_many(
        &w.params,
        &available,
        &recipients,
        true,
        &w.change,
        &Staking::none(),
        None,
    )
    .err()
    .unwrap()
    .to_string();
    assert!(e.contains("over the network's limit of 16384"), "{e}");
    // Well under it, the same payments are fine.
    assert!(
        build::account_send_many(
            &w.params,
            &available,
            &recipients[..20],
            true,
            &w.change,
            &Staking::none(),
            None,
        )
        .is_ok()
    );
}
