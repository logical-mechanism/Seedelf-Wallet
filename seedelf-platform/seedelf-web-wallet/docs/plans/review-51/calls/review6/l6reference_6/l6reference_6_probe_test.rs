//! l6reference#6's probe: a funding's last resort in a merge, another session's money, where the purpose's order alone
//! decides it (as many boxes either way, none of them mixed or of unknown making): past the input limit, and with a
//! token sent. Nothing in the reference or the Rust suites holds it (its rule-5 baseline is selection's own plain
//! build, and its balances hold another session's money only beside no more payments than one transaction spends).

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset as Token, Assets};
use seedelf_core::build::{self, AddressPayment, Chain, Class, Histories, Origin, Purpose};
use seedelf_core::constants::get_config;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
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

fn received(u: &UtxoResponse) -> Class {
    class(&format!("received:{}", u.tx_hash), Origin::Received)
}

fn key_address() -> Address {
    ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
        ShelleyDelegationPart::Null,
    )
    .into()
}

/// A new session's funding: `lovelace` and `tokens` to its one-time account, and its 5 ₳ collateral.
fn funding(lovelace: u64, tokens: Assets) -> Vec<AddressPayment> {
    vec![
        AddressPayment {
            to: key_address(),
            lovelace,
            tokens,
        },
        AddressPayment {
            to: key_address(),
            lovelace: 5 * ADA,
            tokens: Assets::new(),
        },
    ]
}

/// Whether exactly `inputs` pay `pay`, as selection's attempt asks it: built, and its computation estimated.
fn pays_with(w: &World, inputs: &[UtxoResponse], pay: &[AddressPayment]) -> anyhow::Result<()> {
    build::sweep_many_from(&w.chain, inputs, pay, &w.owner, w.signer)
        .and_then(|s| s.estimate())
        .map(|_| ())
}

/// What selection spends of `known` for a new session's funding (`session:7`).
fn spent(w: &World, known: &[(&UtxoResponse, Class)], pay: &[AddressPayment]) -> Vec<UtxoResponse> {
    let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
    let h = known.iter().fold(
        Histories::new(Purpose::Fund {
            session: Some("session:7".into()),
        }),
        |h, (u, c)| h.with(&u.tx_hash, u.tx_index, c.clone()),
    );
    build::sweep_many_apart(&w.chain, &available, &h, pay, &w.owner, w.signer)
        .unwrap()
        .inputs()
}

fn has(inputs: &[UtxoResponse], u: &UtxoResponse) -> bool {
    inputs
        .iter()
        .any(|i| i.tx_hash == u.tx_hash && i.tx_index == u.tx_index)
}

/// Past the input limit: 25 payments received of 2 ₳, S, another session's money of 8 ₳, and L, a plain way back of
/// 24.71 ₳. A new session's funding of 46 ₳ and its 5 ₳ collateral: no set without a box pays in one transaction, L
/// beside received money pays, and L beside S and fewer payments pays too. One box either way, none mixed: the
/// purpose's order decides, and it takes another session's money only where nothing else pays.
#[test]
fn past_the_input_limit_a_funding_leaves_another_sessions_money_out_where_as_many_boxes_pay_without_it() {
    let w = world();
    let payments: Vec<UtxoResponse> = (0..25u8).map(|i| owned(&w, 0x50 + i, 2 * ADA, &[])).collect();
    let s = owned(&w, 0x90, 8 * ADA, &[]);
    let l = owned(&w, 0x30, 24_710_000, &[]);
    let pay = funding(46 * ADA, Assets::new());
    let with = |first: &[&UtxoResponse], n: usize| -> Vec<UtxoResponse> {
        first
            .iter()
            .map(|u| (*u).clone())
            .chain(payments[..n].iter().cloned())
            .collect()
    };
    // The premises: without a box, 22 inputs hold too little and 23 are too many; L beside the payments pays, and so
    // does L beside S and fewer of them.
    assert!(build::is_too_many(&pays_with(&w, &with(&[&s], 22), &pay).unwrap_err()));
    let beside_l = (0..=21)
        .find(|&n| pays_with(&w, &with(&[&l], n), &pay).is_ok())
        .expect("L pays beside some payments");
    let beside_l_and_s = (0..=20)
        .find(|&n| pays_with(&w, &with(&[&l, &s], n), &pay).is_ok())
        .expect("L and S pay beside some payments");
    assert!(beside_l_and_s < beside_l);

    let mut known: Vec<(&UtxoResponse, Class)> = payments.iter().map(|u| (u, received(u))).collect();
    known.push((&s, class("session:3", Origin::Session)));
    known.push((&l, class(&format!("box:{}", l.tx_hash), Origin::Lovejoin)));
    let inputs = spent(&w, &known, &pay);
    let line = format!(
        "spent {} inputs: L {}, another session's money {}; L pays beside {beside_l} payments, L and S beside \
         {beside_l_and_s}",
        inputs.len(),
        has(&inputs, &l),
        has(&inputs, &s),
    );
    println!("{line}");
    assert!(has(&inputs, &l) && !has(&inputs, &s), "{line}");
}

/// With a token sent, within the input limit: T holds 2 ₳ and the 5 of it sent, R1 and R2 are payments received of
/// 6 ₳, S another session's money of 20 ₳. A new session's funding of 5 ₳, the token and its 5 ₳ collateral: T beside
/// R1 and R2 pays, and T beside S. The purpose's last resorts wait for the merge, so T, R1 and R2.
#[test]
fn a_fundings_token_send_merges_received_money_before_another_sessions() {
    let w = world();
    let t = owned(&w, 0x01, 2 * ADA, &[("tok", 5)]);
    let r1 = owned(&w, 0x02, 6 * ADA, &[]);
    let r2 = owned(&w, 0x03, 6 * ADA, &[]);
    let s = owned(&w, 0x04, 20 * ADA, &[]);
    let tok = Assets::new()
        .add(Token::new(TOKEN_POLICY.to_string(), hex::encode("tok"), 5).unwrap())
        .unwrap();
    let pay = funding(5 * ADA, tok);
    // The premises: T alone and T beside either payment hold no more than what's paid out; T, R1 and R2 pay, and so do
    // T and S.
    pays_with(&w, &[t.clone(), r1.clone(), r2.clone()], &pay).expect("T, R1 and R2 pay");
    pays_with(&w, &[t.clone(), s.clone()], &pay).expect("T and S pay");
    let known = [
        (&t, class("public:0", Origin::Own)),
        (&r1, received(&r1)),
        (&r2, received(&r2)),
        (&s, class("session:3", Origin::Session)),
    ];
    let inputs = spent(&w, &known, &pay);
    let line = format!(
        "spent {} inputs: T {}, R1 {}, R2 {}, another session's money {}",
        inputs.len(),
        has(&inputs, &t),
        has(&inputs, &r1),
        has(&inputs, &r2),
        has(&inputs, &s),
    );
    println!("{line}");
    assert!(!has(&inputs, &s), "{line}");
}
