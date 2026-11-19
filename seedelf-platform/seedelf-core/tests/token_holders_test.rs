//! Chunk 51, l6words#1: a spend of a token takes the UTxOs holding it first, by how much of it each holds, whatever
//! made them (`holding`), a token pool's way back of unknown making among them; the box rule and the purpose's order
//! are for what pays beside them. privacy.md's *Selection*, architecture.md's *Picking inputs*, flows.md's Send, the
//! WebAssembly's README and the privacy policy's 18 November entry say so (round seven's words: the lead's call, words
//! only in 1.9.2). These pin it. The backlog's line for choosing the holders by history too would change them, and
//! those words with them.

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset as Token, Assets};
use seedelf_core::build::{
    self, AddressPayment, Chain, Class, Histories, Origin, Payment, Purpose,
};
use seedelf_core::constants::get_config;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
/// "TOK".
const TOKEN_NAME: &str = "544f4b";
const ADA: u64 = 1_000_000;

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
    to: Address,
}

fn world() -> World {
    let chain = chain();
    let key = SecretKey::new(OsRng);
    World {
        wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
        chain,
        owner: Register::create(random_scalar()).unwrap(),
        signer: Hasher::<224>::hash(PrivateKey::from(key).public_key().as_ref()),
        to: ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
            ShelleyDelegationPart::Null,
        )
        .into(),
    }
}

/// What made a UTxO, as the extension classes it.
#[derive(Debug, Clone, Copy)]
enum Made {
    /// A box's way back a mix moved (`box:<tx>`, origin mixed).
    Mixed,
    /// A plain way back (`box:<tx>`, origin lovejoin).
    Plain,
    /// One whose making the wallet can't place (`box:<tx>+unknown:<tx>`, origin lovejoin).
    Unknown,
    /// Money made private from public account 0.
    Own,
}

/// A row of the balance: its name in a failure, the UTxO and what made it.
type Row = (&'static str, UtxoResponse, Made);

/// A wallet-contract UTxO of `w`'s, made by transaction `n`, holding `tok` of TOK where that's more than none.
fn utxo(w: &World, n: u8, lovelace: u64, tok: u64) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    UtxoResponse {
        tx_hash: format!("{n:02x}").repeat(32),
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
            (tok > 0)
                .then(|| Asset {
                    decimals: 0,
                    quantity: tok.to_string(),
                    policy_id: TOKEN_POLICY.to_string(),
                    asset_name: TOKEN_NAME.to_string(),
                    fingerprint: String::new(),
                })
                .into_iter()
                .collect(),
        ),
        ..Default::default()
    }
}

fn class(made: Made, tx: &str) -> Class {
    let (id, origin) = match made {
        Made::Mixed => (format!("box:{tx}"), Origin::Mixed),
        Made::Plain => (format!("box:{tx}"), Origin::Lovejoin),
        Made::Unknown => (format!("box:{tx}+unknown:{tx}"), Origin::Lovejoin),
        Made::Own => ("public:0".into(), Origin::Own),
    };
    Class { id, origin }
}

fn histories(rows: &[Row]) -> Histories {
    rows.iter()
        .fold(Histories::new(Purpose::Pay), |h, (_, u, made)| {
            h.with(&u.tx_hash, u.tx_index, class(*made, &u.tx_hash))
        })
}

fn tok(amount: u64) -> Assets {
    Assets::new()
        .add(Token::new(TOKEN_POLICY.into(), TOKEN_NAME.into(), amount).unwrap())
        .unwrap()
}

/// A Send of `amount` TOK and `lovelace` (at least what the payment needs) to someone's Seedelf.
fn send(w: &World, amount: u64, lovelace: u64) -> Vec<Payment> {
    let tokens = tok(amount);
    let least = build::minimum_seedelf_payment(&w.chain.params, &tokens).unwrap();
    vec![Payment {
        register: Register::create(random_scalar()).unwrap(),
        lovelace: lovelace.max(least),
        tokens,
    }]
}

/// A Make public of `amount` TOK, with 2 ₳.
fn public(w: &World, amount: u64) -> Vec<AddressPayment> {
    vec![AddressPayment {
        to: w.to.clone(),
        lovelace: 2 * ADA,
        tokens: tok(amount),
    }]
}

/// Whether exactly `inputs` pay the Send (`addresses` empty) or the Make public, as selection's attempt asks it.
fn pays(
    w: &World,
    inputs: &[&UtxoResponse],
    seedelfs: &[Payment],
    addresses: &[AddressPayment],
) -> bool {
    let inputs: Vec<UtxoResponse> = inputs.iter().map(|u| (*u).clone()).collect();
    if addresses.is_empty() {
        build::transfer_from(&w.chain, &inputs, seedelfs, &w.owner, w.signer)
    } else {
        build::sweep_many_from(&w.chain, &inputs, addresses, &w.owner, w.signer)
    }
    .and_then(|s| s.estimate().map(|_| ()))
    .is_ok()
}

/// What selection spends of `rows`, by their names, sorted.
fn picked(
    w: &World,
    rows: &[Row],
    seedelfs: &[Payment],
    addresses: &[AddressPayment],
) -> Vec<&'static str> {
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let h = histories(rows);
    let inputs = if addresses.is_empty() {
        build::transfer_apart(&w.chain, &available, &h, seedelfs, &w.owner, w.signer)
    } else {
        build::sweep_many_apart(&w.chain, &available, &h, addresses, &w.owner, w.signer)
    }
    .expect("the spend builds")
    .inputs();
    let mut names: Vec<&'static str> = inputs
        .iter()
        .map(|u| {
            rows.iter()
                .find(|(_, r, _)| r.tx_hash == u.tx_hash && r.tx_index == u.tx_index)
                .expect("a UTxO of the balance")
                .0
        })
        .collect();
    names.sort();
    names
}

#[test]
fn a_token_sent_comes_first_from_its_biggest_holder_whatever_made_it() {
    let w = world();
    let rows: Vec<Row> = vec![
        (
            "M, mixed, 1,000 TOK",
            utxo(&w, 0x0a, 4_700_000, 1_000),
            Made::Mixed,
        ),
        (
            "W, of unknown making, 2,000 TOK",
            utxo(&w, 0x0b, 4_700_000, 2_000),
            Made::Unknown,
        ),
        (
            "O, 20 ₳ made private",
            utxo(&w, 0x0d, 20 * ADA, 0),
            Made::Own,
        ),
    ];
    let (seedelfs, addresses) = (send(&w, 800, 0), public(&w, 800));
    let spends: [(&str, &[Payment], &[AddressPayment]); 2] =
        [("Send", &seedelfs, &[]), ("Make public", &[], &addresses)];
    for (spend, seedelfs, addresses) in spends {
        // Each way back alone pays 800 TOK: by the box rule M, the mixed one, would go.
        assert!(
            pays(&w, &[&rows[0].1], seedelfs, addresses),
            "{spend}: M alone pays"
        );
        assert!(
            pays(&w, &[&rows[1].1], seedelfs, addresses),
            "{spend}: W alone pays"
        );
        assert_eq!(
            picked(&w, &rows, seedelfs, addresses),
            vec![rows[1].0],
            "{spend}"
        );
    }
}

#[test]
fn money_made_private_holding_the_token_goes_after_a_box_holding_more() {
    let w = world();
    let rows: Vec<Row> = vec![
        (
            "M, mixed, 2,000 TOK",
            utxo(&w, 0x0a, 4_700_000, 2_000),
            Made::Mixed,
        ),
        (
            "P, made private, 1,000 TOK",
            utxo(&w, 0x0e, 4_700_000, 1_000),
            Made::Own,
        ),
    ];
    let seedelfs = send(&w, 800, 0);
    // By the purpose's order, money made private would go first: P alone pays.
    assert!(pays(&w, &[&rows[1].1], &seedelfs, &[]));
    assert_eq!(picked(&w, &rows, &seedelfs, &[]), vec![rows[0].0]);
}

#[test]
fn beside_the_holders_the_purposes_order_and_the_box_rule_still_pick() {
    let w = world();
    let rows: Vec<Row> = vec![
        (
            "W, of unknown making, 2,000 TOK",
            utxo(&w, 0x0b, 2_500_000, 2_000),
            Made::Unknown,
        ),
        (
            "U, of unknown making, 20 ₳",
            utxo(&w, 0x0c, 20 * ADA, 0),
            Made::Unknown,
        ),
        ("K, plain, 20 ₳", utxo(&w, 0x0f, 20 * ADA, 0), Made::Plain),
        (
            "O, 20 ₳ made private",
            utxo(&w, 0x0d, 20 * ADA, 0),
            Made::Own,
        ),
    ];
    let seedelfs = send(&w, 800, 10 * ADA);
    // W, the token's only holder, is short of the 10 ₳: what pays beside it is money made private, before any box.
    assert!(!pays(&w, &[&rows[0].1], &seedelfs, &[]));
    assert_eq!(
        picked(&w, &rows, &seedelfs, &[]),
        vec![rows[3].0, rows[0].0]
    );
}
