//! Coin selection keeping histories apart, when merging is the only way
//! (independent review M6, L39, L40): a payment the CLI's order pays is
//! never refused for having too many small UTxOs ahead of the boxes, merging
//! follows the purpose's order, and money with no history is kept apart by
//! the transaction that made it once the extension says so.

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build::{
    self, AddressPayment, Chain, Class, Histories, Origin, Payment, Purpose,
};
use seedelf_core::constants::get_config;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset as KoiosAsset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
/// About what a box back from Lovejoin brings: 10 ₳ less the withdraw's fee.
const BOX: u64 = 9_710_000;
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

/// A wallet-contract UTxO owned by `w`, made by the transaction `[a, b; 32]`
/// (two bytes, so a test can make hundreds), as Koios returns it.
fn owned(w: &World, a: u8, b: u8, lovelace: u64, tokens: &[(&str, u64)]) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    let mut hash = [a; 32];
    hash[31] = b;
    UtxoResponse {
        tx_hash: hex::encode(hash),
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
                .map(|(name, quantity)| KoiosAsset {
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

/// Each UTxO its own received payment, as the extension classes them.
fn received(u: &UtxoResponse) -> Class {
    class(&format!("received:{}", u.tx_hash), Origin::Received)
}

fn a_box(u: &UtxoResponse) -> Class {
    class(&format!("box:{}", u.tx_hash), Origin::Lovejoin)
}

fn histories(purpose: Purpose, utxos: &[(&UtxoResponse, Class)]) -> Histories {
    utxos.iter().fold(Histories::new(purpose), |h, (u, c)| {
        h.with(&u.tx_hash, u.tx_index, c.clone())
    })
}

fn key_address() -> Address {
    ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
        ShelleyDelegationPart::Null,
    )
    .into()
}

fn pay(lovelace: u64) -> Vec<AddressPayment> {
    vec![AddressPayment {
        to: key_address(),
        lovelace,
        tokens: Assets::new(),
    }]
}

/// A session's funding: `lovelace` and `tokens`, and its 5 ₳ collateral.
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

fn token(name: &str, amount: u64) -> Assets {
    Assets::new()
        .add(Asset::new(TOKEN_POLICY.to_string(), hex::encode(name), amount).unwrap())
        .unwrap()
}

fn outpoints(utxos: &[UtxoResponse]) -> Vec<String> {
    let mut v: Vec<String> = utxos
        .iter()
        .map(|u| format!("{}#{}", u.tx_hash, u.tx_index))
        .collect();
    v.sort();
    v
}

/// What paying `payments` from `available` spends, by the extension's
/// classes and by the CLI's order.
fn both(
    w: &World,
    available: &[UtxoResponse],
    h: &Histories,
    payments: &[AddressPayment],
) -> (
    anyhow::Result<build::ScriptSpend>,
    anyhow::Result<build::ScriptSpend>,
) {
    (
        build::sweep_many_apart(&w.chain, available, h, payments, &w.owner, w.signer),
        build::sweep_many(&w.chain, available, payments, &w.owner, w.signer),
    )
}

/// 30 received payments of 1.5 ₳ and 5 boxes: the small ones come first in
/// the history's order, and 27 of them are more computation than a
/// transaction may use (independent review M6).
#[test]
fn many_small_utxos_ahead_of_the_boxes_never_block_what_the_cli_order_pays() {
    let w = world();
    let small: Vec<UtxoResponse> = (0..30)
        .map(|i| owned(&w, 0x30, i, 1_500_000, &[]))
        .collect();
    let boxes: Vec<UtxoResponse> = (0..5).map(|i| owned(&w, 0xb0, i, BOX, &[])).collect();
    let available: Vec<UtxoResponse> = small.iter().chain(&boxes).cloned().collect();
    let mut known: Vec<(&UtxoResponse, Class)> = small.iter().map(|u| (u, received(u))).collect();
    known.extend(boxes.iter().map(|u| (u, a_box(u))));

    for purpose in [Purpose::Pay, Purpose::Mint, Purpose::Fund { session: None }] {
        let h = histories(purpose.clone(), &known);
        let (apart, blind) = both(&w, &available, &h, &pay(40 * ADA));
        let blind = blind.unwrap();
        let apart = apart.unwrap_or_else(|e| panic!("{purpose:?}: {e}"));
        // What the CLI's order pays with: the boxes, the largest.
        assert_eq!(outpoints(&blind.inputs()), outpoints(&boxes));
        assert_eq!(outpoints(&apart.inputs()), outpoints(&boxes), "{purpose:?}");
        // And it says what it merged.
        assert_eq!(h.merged(&apart.inputs()).len(), 5);
    }
}

/// The same with a token in each small UTxO: those the spend doesn't send go
/// behind the boxes (independent review M6).
#[test]
fn token_utxos_the_spend_doesnt_send_go_behind_the_boxes_when_merging_fails() {
    let w = world();
    let small: Vec<UtxoResponse> = (0..24)
        .map(|i| owned(&w, 0x31, i, 1_700_000, &[("nft", 1)]))
        .collect();
    let boxes: Vec<UtxoResponse> = (0..5).map(|i| owned(&w, 0xb1, i, BOX, &[])).collect();
    let available: Vec<UtxoResponse> = small.iter().chain(&boxes).cloned().collect();
    let mut known: Vec<(&UtxoResponse, Class)> = small.iter().map(|u| (u, received(u))).collect();
    known.extend(boxes.iter().map(|u| (u, a_box(u))));
    let h = histories(Purpose::Pay, &known);
    let (apart, _) = both(&w, &available, &h, &pay(40 * ADA));
    assert_eq!(outpoints(&apart.unwrap().inputs()), outpoints(&boxes));
}

/// When the purpose's order runs into the limit, the largest pure ADA of the
/// allowed tiers goes first, and the boxes still wait (independent review M6).
#[test]
fn a_failed_merge_tries_the_largest_first_before_the_boxes() {
    let w = world();
    // 25 ₳ of the user's own in 1 ₳ UTxOs, which a Send takes first, and two
    // received payments of 20 ₳.
    let own: Vec<UtxoResponse> = (0..25).map(|i| owned(&w, 0x32, i, ADA, &[])).collect();
    let big: Vec<UtxoResponse> = (0..2).map(|i| owned(&w, 0x42, i, 20 * ADA, &[])).collect();
    let boxes: Vec<UtxoResponse> = (0..3).map(|i| owned(&w, 0xb2, i, BOX, &[])).collect();
    let available: Vec<UtxoResponse> = own.iter().chain(&big).chain(&boxes).cloned().collect();
    let mut known: Vec<(&UtxoResponse, Class)> = own
        .iter()
        .map(|u| (u, class("public", Origin::Own)))
        .collect();
    known.extend(big.iter().map(|u| (u, received(u))));
    known.extend(boxes.iter().map(|u| (u, a_box(u))));
    let h = histories(Purpose::Pay, &known);
    let (apart, blind) = both(&w, &available, &h, &pay(45 * ADA));
    let spent = apart.unwrap().inputs();
    // No box: both payments and as few of the 1 ₳ UTxOs as pay.
    assert!(spent.len() <= 12, "{} inputs", spent.len());
    for b in &big {
        assert!(outpoints(&spent).contains(&format!("{}#0", b.tx_hash)));
    }
    assert!(
        !spent
            .iter()
            .any(|u| boxes.iter().any(|b| b.tx_hash == u.tx_hash))
    );
    // The CLI's order would have taken a box.
    assert!(
        blind
            .unwrap()
            .inputs()
            .iter()
            .any(|u| u.value == BOX.to_string())
    );
}

/// More than everything can pay stays "not enough", and more inputs than a
/// transaction can spend, in every order, still says so.
#[test]
fn what_no_order_pays_is_still_refused() {
    let w = world();
    let small: Vec<UtxoResponse> = (0..30)
        .map(|i| owned(&w, 0x33, i, 1_500_000, &[]))
        .collect();
    let known: Vec<(&UtxoResponse, Class)> = small.iter().map(|u| (u, received(u))).collect();
    let h = histories(Purpose::Pay, &known);
    let e = build::sweep_many_apart(&w.chain, &small, &h, &pay(100 * ADA), &w.owner, w.signer)
        .err()
        .unwrap();
    assert!(e.to_string().contains("Not enough ADA"), "{e}");
    // 40 ₳ from 1.5 ₳ UTxOs needs 27 of them: too many for any order.
    let e = build::sweep_many_apart(&w.chain, &small, &h, &pay(40 * ADA), &w.owner, w.signer)
        .err()
        .unwrap();
    assert!(e.to_string().contains("more computation"), "{e}");
}

/// Merging follows the purpose's order, not the size alone (independent
/// review L39).
#[test]
fn merging_takes_the_purposes_order_first() {
    let w = world();
    // A Send no single UTxO pays: own money first, then received.
    let own = owned(&w, 0x01, 0, 30 * ADA, &[]);
    let rec = owned(&w, 0x02, 0, 45 * ADA, &[]);
    let other = owned(&w, 0x03, 0, 30 * ADA, &[]);
    let available = [own.clone(), rec.clone(), other.clone()];
    let h = histories(
        Purpose::Pay,
        &[
            (&own, class("public", Origin::Own)),
            (&rec, received(&rec)),
            (&other, class("session:4", Origin::Session)),
        ],
    );
    // Before, the 45 ₳ received payment went first, as the largest.
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &pay(50 * ADA), &w.owner, w.signer)
            .unwrap();
    assert_eq!(
        outpoints(&spend.inputs()),
        outpoints(&[own.clone(), other.clone()])
    );
}

/// With a token sent, its UTxO and one UTxO of another class, by the
/// purpose's order, before three histories (independent review L39).
#[test]
fn a_token_send_merges_one_more_history_by_the_purposes_order() {
    let w = world();
    let tok = owned(&w, 0x01, 0, 2 * ADA, &[("tok", 5)]);
    let moved_in = owned(&w, 0x02, 0, 500 * ADA, &[]);
    let rec = owned(&w, 0x03, 0, 100 * ADA, &[]);
    let available = [tok.clone(), moved_in.clone(), rec.clone()];
    let of = [
        (&tok, received(&tok)),
        (&moved_in, class("public", Origin::Own)),
        (&rec, received(&rec)),
    ];

    // A swap's funding takes received money: the 100 ₳, never the move-in.
    let h = histories(Purpose::Fund { session: None }, &of);
    let spend = build::sweep_many_apart(
        &w.chain,
        &available,
        &h,
        &funding(50 * ADA, token("tok", 5)),
        &w.owner,
        w.signer,
    )
    .unwrap();
    assert_eq!(
        outpoints(&spend.inputs()),
        outpoints(&[tok.clone(), rec.clone()])
    );

    // A Send takes the user's own money first.
    let h = histories(Purpose::Pay, &of);
    let payment = Payment {
        register: Register::create(random_scalar())
            .unwrap()
            .rerandomize()
            .unwrap(),
        lovelace: 20 * ADA,
        tokens: token("tok", 5),
    };
    let spend =
        build::transfer_apart(&w.chain, &available, &h, &[payment], &w.owner, w.signer).unwrap();
    assert_eq!(
        outpoints(&spend.inputs()),
        outpoints(&[tok.clone(), moved_in.clone()])
    );

    // Two histories rather than more: its UTxO and the move-in, when each of
    // the received payments is short alone.
    let smalls: Vec<UtxoResponse> = (0..3).map(|i| owned(&w, 0x04, i, 4 * ADA, &[])).collect();
    let available: Vec<UtxoResponse> = [tok.clone(), moved_in.clone()]
        .into_iter()
        .chain(smalls.iter().cloned())
        .collect();
    let mut known = vec![
        (&tok, received(&tok)),
        (&moved_in, class("public", Origin::Own)),
    ];
    known.extend(smalls.iter().map(|u| (u, received(u))));
    let h = histories(Purpose::Fund { session: None }, &known);
    let spend = build::sweep_many_apart(
        &w.chain,
        &available,
        &h,
        &funding(3 * ADA, token("tok", 5)),
        &w.owner,
        w.signer,
    )
    .unwrap();
    assert_eq!(outpoints(&spend.inputs()), outpoints(&[tok, moved_in]));
}

/// The extension gives money with no history a class per transaction once
/// something else's history is known (independent review L40): two such are
/// kept apart like two payments received, and merging them is said. With
/// nothing known, however they're named, it picks as the CLI does.
#[test]
fn unknown_money_of_different_transactions_is_kept_apart_once_anything_is_known() {
    let w = world();
    let aged: Vec<UtxoResponse> = (0..2).map(|i| owned(&w, 0x0a, i, BOX, &[])).collect();
    let own = owned(&w, 0x01, 0, 10 * ADA, &[]);
    let rec = owned(&w, 0x02, 0, 10 * ADA, &[]);
    let available: Vec<UtxoResponse> = aged
        .iter()
        .cloned()
        .chain([own.clone(), rec.clone()])
        .collect();
    let unknown = |u: &UtxoResponse| class(&format!("unknown:{}", u.tx_hash), Origin::Unknown);

    // One "unknown" class: step 2 spends the two together, and nothing is merged.
    let mut one: Vec<(&UtxoResponse, Class)> =
        vec![(&own, class("public", Origin::Own)), (&rec, received(&rec))];
    let h = histories(Purpose::Pay, &one);
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &pay(15 * ADA), &w.owner, w.signer)
            .unwrap();
    assert_eq!(outpoints(&spend.inputs()), outpoints(&aged));
    assert!(h.merged(&spend.inputs()).is_empty());

    // One class each: they're two histories, merged no sooner than the rest, and said.
    one.extend(aged.iter().map(|u| (u, unknown(u))));
    let h = histories(Purpose::Pay, &one);
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &pay(15 * ADA), &w.owner, w.signer)
            .unwrap();
    assert_eq!(
        outpoints(&spend.inputs()),
        outpoints(&[own.clone(), rec.clone()])
    );
    let only_aged =
        build::sweep_many_apart(&w.chain, &aged, &h, &pay(15 * ADA), &w.owner, w.signer).unwrap();
    assert_eq!(h.merged(&only_aged.inputs()).len(), 2);

    // Nothing known, one class a transaction or none: the CLI's inputs.
    let blind =
        build::sweep_many(&w.chain, &available, &pay(15 * ADA), &w.owner, w.signer).unwrap();
    let named: Vec<(&UtxoResponse, Class)> = available.iter().map(|u| (u, unknown(u))).collect();
    let h = histories(Purpose::Pay, &named);
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &pay(15 * ADA), &w.owner, w.signer)
            .unwrap();
    assert_eq!(outpoints(&spend.inputs()), outpoints(&blind.inputs()));
}

/// A session's funding change carries what paid for it, a box say, with the
/// session's history (independent review L41): selection still takes it as
/// the session's money, never as a box.
#[test]
fn a_funding_change_carrying_a_box_is_still_the_sessions_money() {
    let w = world();
    let change = owned(&w, 0x01, 0, 20 * ADA, &[]);
    let rec = owned(&w, 0x02, 0, 20 * ADA, &[]);
    let later_box = owned(&w, 0x03, 0, 30 * ADA, &[]);
    let available = [change.clone(), rec.clone(), later_box.clone()];
    let of = |purpose: Purpose| {
        histories(
            purpose,
            &[
                (
                    &change,
                    class(
                        &format!("box:{}+session:3", "0a".repeat(32)),
                        Origin::Session,
                    ),
                ),
                (&rec, received(&rec)),
                (&later_box, a_box(&later_box)),
            ],
        )
    };
    let fund = |purpose: Purpose| {
        let spend = build::sweep_many_apart(
            &w.chain,
            &available,
            &of(purpose),
            &funding(5 * ADA, Assets::new()),
            &w.owner,
            w.signer,
        )
        .unwrap();
        outpoints(&spend.inputs())
    };
    // Session 3's top-up takes what its funding left first.
    let top_up = Purpose::Fund {
        session: Some("session:3".into()),
    };
    assert_eq!(fund(top_up), outpoints(std::slice::from_ref(&change)));
    // Another session's funding takes received money, leaving it for last.
    let other = Purpose::Fund {
        session: Some("session:4".into()),
    };
    assert_eq!(fund(other), outpoints(std::slice::from_ref(&rec)));
    // A Send takes it as a session's, before received money and boxes.
    let spend = build::sweep_many_apart(
        &w.chain,
        &available,
        &of(Purpose::Pay),
        &pay(15 * ADA),
        &w.owner,
        w.signer,
    )
    .unwrap();
    assert_eq!(outpoints(&spend.inputs()), outpoints(&[change]));
}
