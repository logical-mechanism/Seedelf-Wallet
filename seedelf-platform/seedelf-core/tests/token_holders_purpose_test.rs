//! The UTxOs holding a token sent, by the box rule and the spend's purpose (`holding_by_rule`, and `select_script_inputs`
//! choosing between its spend and the one from the biggest holdings): 1.9.3's review of chunk 52, r3#2, r3#3 and r3#4,
//! and its last look at the fixes, F1, F3 and F4. Each pin failed on the code before its fix; r3#2's and r3#3's sent
//! what 1.9.2 sent.

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

const POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
/// "TOK" and "TWO".
const TOK: &str = "544f4b";
const TWO: &str = "54574f";
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

/// A wallet-contract UTxO of `w`'s, made by transaction `n`, holding `held` (token name, amount).
fn utxo(w: &World, n: u8, lovelace: u64, held: &[(&str, u64)]) -> UtxoResponse {
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
            held.iter()
                .map(|(name, q)| Asset {
                    decimals: 0,
                    quantity: q.to_string(),
                    policy_id: POLICY.to_string(),
                    asset_name: name.to_string(),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

fn tokens(held: &[(&str, u64)]) -> Assets {
    held.iter().fold(Assets::new(), |all, (name, q)| {
        all.add(Token::new(POLICY.into(), name.to_string(), *q).unwrap())
            .unwrap()
    })
}

type Row = (&'static str, UtxoResponse, Class);

fn histories(purpose: Purpose, rows: &[Row]) -> Histories {
    rows.iter().fold(Histories::new(purpose), |h, (_, u, c)| {
        h.with(&u.tx_hash, u.tx_index, c.clone())
    })
}

fn names(rows: &[Row], inputs: &[UtxoResponse]) -> Vec<&'static str> {
    let mut names: Vec<&'static str> = inputs
        .iter()
        .map(|u| {
            rows.iter()
                .find(|(_, r, _)| r.tx_hash == u.tx_hash)
                .expect("a row")
                .0
        })
        .collect();
    names.sort();
    names
}

fn mixed(tx: &str) -> Class {
    Class {
        id: format!("box:{tx}"),
        origin: Origin::Mixed,
    }
}

fn unknown_box(tx: &str) -> Class {
    Class {
        id: format!("box:{tx}+unknown:{tx}"),
        origin: Origin::Lovejoin,
    }
}

fn send(w: &World, held: &[(&str, u64)], lovelace: u64) -> Vec<Payment> {
    let t = tokens(held);
    let least = build::minimum_seedelf_payment(&w.chain.params, &t).unwrap();
    vec![Payment {
        register: Register::create(random_scalar()).unwrap(),
        lovelace: lovelace.max(least),
        tokens: t,
    }]
}

/// r3#3: a Send whose token money made private holds enough of, and a mixed box all of, with the ADA: the box pays
/// alone. By the rule the money made private goes first and the box pays its ADA, so that spend merges two histories;
/// the box alone is as good by the box rule (one box, mixed, either way). Of two alike by the rule, the one merging
/// fewer histories goes: the box alone, as 1.9.2 sent it.
#[test]
fn of_two_spends_alike_by_the_box_rule_the_one_merging_fewer_histories_goes() {
    let w = world();
    let o = utxo(&w, 0x01, 1_500_000, &[(TOK, 10)]);
    let m = utxo(&w, 0x02, 20 * ADA, &[(TOK, 20)]);
    let rows: Vec<Row> = vec![
        (
            "O, made private, 10 TOK, 1.5 ADA",
            o.clone(),
            Class {
                id: "public:0".into(),
                origin: Origin::Own,
            },
        ),
        ("M, mixed, 20 TOK, 20 ADA", m.clone(), mixed(&m.tx_hash)),
    ];
    let pay = send(&w, &[(TOK, 10)], 5 * ADA);
    let alone = build::transfer_from(&w.chain, &[m.clone()], &pay, &w.owner, w.signer)
        .and_then(|s| s.estimate().map(|_| ()));
    assert!(alone.is_ok(), "M alone pays: {alone:?}");
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let h = histories(Purpose::Pay, &rows);
    let spend = build::transfer_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer).unwrap();
    assert_eq!(
        names(&rows, &spend.inputs()),
        vec![rows[1].0],
        "M alone pays; merged: {:?}",
        h.merged(&spend.inputs())
            .iter()
            .map(|c| c.id.clone())
            .collect::<Vec<_>>()
    );
}

/// r3#2: a session's funding sells TOK. S, another session's money (the funding's last resort), holds 1,000; M, a mixed
/// box, 2,000; each pays alone. A funding takes a mixed box before another session's money, so the token comes from
/// M, as 1.9.2 sent it, and the funding is tied to no other session.
#[test]
fn a_fundings_token_comes_from_a_mixed_box_that_pays_alone_before_another_sessions_money() {
    let w = world();
    let s = utxo(&w, 0x03, 20 * ADA, &[(TOK, 1_000)]);
    let m = utxo(&w, 0x04, 20 * ADA, &[(TOK, 2_000)]);
    let rows: Vec<Row> = vec![
        (
            "S, session B's money, 1,000 TOK",
            s.clone(),
            Class {
                id: "session:B".into(),
                origin: Origin::Session,
            },
        ),
        ("M, mixed, 2,000 TOK", m.clone(), mixed(&m.tx_hash)),
    ];
    let fund = vec![AddressPayment {
        to: w.to.clone(),
        lovelace: 2 * ADA,
        tokens: tokens(&[(TOK, 800)]),
    }];
    for u in [&s, &m] {
        let alone = build::sweep_many_from(&w.chain, &[u.clone()], &fund, &w.owner, w.signer)
            .and_then(|s| s.estimate().map(|_| ()));
        assert!(alone.is_ok(), "pays alone: {alone:?}");
    }
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let h = histories(
        Purpose::Fund {
            session: Some("session:A".into()),
        },
        &rows,
    );
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &fund, &w.owner, w.signer).unwrap();
    assert_eq!(
        names(&rows, &spend.inputs()),
        vec![rows[1].0],
        "the mixed box"
    );
}

/// r3#2, the same with money made private, which would tie the session to the public account.
#[test]
fn a_fundings_token_comes_from_a_mixed_box_that_pays_alone_before_money_made_private() {
    let w = world();
    let o = utxo(&w, 0x05, 20 * ADA, &[(TOK, 1_000)]);
    let m = utxo(&w, 0x06, 20 * ADA, &[(TOK, 2_000)]);
    let rows: Vec<Row> = vec![
        (
            "O, made private from account 0, 1,000 TOK",
            o.clone(),
            Class {
                id: "public:0".into(),
                origin: Origin::Own,
            },
        ),
        ("M, mixed, 2,000 TOK", m.clone(), mixed(&m.tx_hash)),
    ];
    let fund = vec![AddressPayment {
        to: w.to.clone(),
        lovelace: 2 * ADA,
        tokens: tokens(&[(TOK, 800)]),
    }];
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let h = histories(
        Purpose::Fund {
            session: Some("session:A".into()),
        },
        &rows,
    );
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &fund, &w.owner, w.signer).unwrap();
    assert_eq!(
        names(&rows, &spend.inputs()),
        vec![rows[1].0],
        "the mixed box"
    );
}

/// r3#4: two tokens sent at once. U2, a box of unknown making, holds enough of both; U1, another, more of the first
/// alone. Each token's holders are chosen in turn, U1 for the first and U2 for the second, and U1 is then needless: as
/// few of unknown making as hold the rest is U2 alone (1.9.2's `holding` took both).
#[test]
fn two_tokens_sent_at_once_take_the_one_box_of_unknown_making_that_holds_both() {
    let w = world();
    let u1 = utxo(&w, 0x07, 10 * ADA, &[(TOK, 11)]);
    let u2 = utxo(&w, 0x08, 10 * ADA, &[(TOK, 10), (TWO, 10)]);
    let rows: Vec<Row> = vec![
        (
            "U1, unknown making, 11 TOK",
            u1.clone(),
            unknown_box(&u1.tx_hash),
        ),
        (
            "U2, unknown making, 10 TOK and 10 TWO",
            u2.clone(),
            unknown_box(&u2.tx_hash),
        ),
    ];
    let pay = send(&w, &[(TOK, 10), (TWO, 10)], 2 * ADA);
    let alone = build::transfer_from(&w.chain, &[u2.clone()], &pay, &w.owner, w.signer)
        .and_then(|s| s.estimate().map(|_| ()));
    assert!(alone.is_ok(), "U2 alone pays: {alone:?}");
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let h = histories(Purpose::Pay, &rows);
    let spend = build::transfer_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer).unwrap();
    assert_eq!(names(&rows, &spend.inputs()), vec![rows[1].0], "U2 alone");
}

fn class(id: &str, origin: Origin) -> Class {
    Class {
        id: id.into(),
        origin,
    }
}

/// F4, where r3#2 meets r3#3: a top-up of session A sells 10 TOK. O, session A's own money, holds 10 TOK and 1.5 ₳;
/// S, session B's money (a funding's last resort), 12 TOK and 20 ₳, and pays alone; R, a payment received, 10 ₳. The
/// rule's holders are O, beside R for the ADA; the spend from the biggest holding is S alone. Both are alike by the box
/// rule (no box), and each ties two histories: O and R session A and a payment received, S session A and session B,
/// since the top-up ties its session to whatever it spends. The tie keeps the rule's: O and R.
#[test]
fn a_top_ups_token_comes_from_its_own_sessions_money_before_another_sessions() {
    let w = world();
    let s = utxo(&w, 0x31, 20 * ADA, &[(TOK, 12)]);
    let o = utxo(&w, 0x32, 1_500_000, &[(TOK, 10)]);
    let r = utxo(&w, 0x33, 10 * ADA, &[]);
    let rows: Vec<Row> = vec![
        (
            "S, session B's money, 12 TOK, 20 ADA",
            s.clone(),
            class("session:B", Origin::Session),
        ),
        (
            "O, session A's own money, 10 TOK, 1.5 ADA",
            o.clone(),
            class("session:A", Origin::Session),
        ),
        (
            "R, received, 10 ADA",
            r.clone(),
            class("received:33", Origin::Received),
        ),
    ];
    let fund = vec![AddressPayment {
        to: w.to.clone(),
        lovelace: 2 * ADA,
        tokens: tokens(&[(TOK, 10)]),
    }];
    let pays = |inputs: &[UtxoResponse]| {
        build::sweep_many_from(&w.chain, inputs, &fund, &w.owner, w.signer)
            .and_then(|s| s.estimate().map(|_| ()))
            .is_ok()
    };
    assert!(pays(&[s.clone()]), "S pays alone");
    assert!(pays(&[o.clone(), r.clone()]), "O and R pay");
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let h = histories(
        Purpose::Fund {
            session: Some("session:A".into()),
        },
        &rows,
    );
    let spend =
        build::sweep_many_apart(&w.chain, &available, &h, &fund, &w.owner, w.signer).unwrap();
    assert_eq!(
        names(&rows, &spend.inputs()),
        vec![rows[1].0, rows[2].0],
        "O and R"
    );
}

/// F3: a Send of 10 TOK. H, made private, holds 15 TOK and 2.5 ₳ and is short alone; PILE, a payment received, holds
/// one TWO of TOK's policy at less than the least a change is sized at, so it adds less than nothing; M, a mixed box,
/// 10 ₳. H and M pay, and so do H and PILE, the change keeping TOK's policy anyway. Merging's first step, the holders
/// beside one UTxO of another class, leaves PILE out, so the box goes: a stranger's pile waits until no box pays.
#[test]
fn a_strangers_pile_stays_out_of_merging_where_a_box_pays_beside_the_holders() {
    let w = world();
    let p = &w.chain.params;
    let h = utxo(&w, 0x41, 2_500_000, &[(TOK, 15)]);
    let mut pile = utxo(&w, 0x42, 0, &[(TWO, 1)]);
    pile.value = (build::minimum_deposit(p, &tokens(&[(TWO, 1)])).unwrap() - 100_000).to_string();
    assert!(
        build::adds(p, &pile).unwrap() < 0,
        "PILE adds less than nothing"
    );
    let m = utxo(&w, 0x43, 10 * ADA, &[]);
    let rows: Vec<Row> = vec![
        (
            "H, made private, 15 TOK, 2.5 ADA",
            h.clone(),
            class("public:0", Origin::Own),
        ),
        (
            "PILE, received, 1 TWO",
            pile.clone(),
            class("received:42", Origin::Received),
        ),
        ("M, mixed, 10 ADA", m.clone(), mixed(&m.tx_hash)),
    ];
    let pay = send(&w, &[(TOK, 10)], 0);
    let pays = |inputs: &[UtxoResponse]| {
        build::transfer_from(&w.chain, inputs, &pay, &w.owner, w.signer)
            .and_then(|s| s.estimate().map(|_| ()))
            .is_ok()
    };
    assert!(!pays(&[h.clone()]), "H is short alone");
    assert!(
        pays(&[h.clone(), pile.clone()]) && pays(&[h.clone(), m.clone()]),
        "H pays beside PILE or M"
    );
    let available: Vec<UtxoResponse> = rows.iter().map(|(_, u, _)| u.clone()).collect();
    let hs = histories(Purpose::Pay, &rows);
    let spend = build::transfer_apart(&w.chain, &available, &hs, &pay, &w.owner, w.signer).unwrap();
    assert_eq!(
        names(&rows, &spend.inputs()),
        vec![rows[0].0, rows[2].0],
        "H and the box"
    );
}

/// F1: 400 UTxOs made private, each holding one NFT of its own, and a payment of all 400. The holders are chosen in
/// milliseconds: dropping the needless ones read every token over all the others again for each holder, which took
/// 5 s in release for this set alone, and a minute for the payment in parts, which chooses them at every part.
#[test]
fn the_holders_of_four_hundred_tokens_one_a_utxo_are_chosen_in_a_fraction_of_a_second() {
    let w = world();
    let mut available = Vec::new();
    let mut needed = Assets::new();
    let mut h = Histories::new(Purpose::Pay);
    for i in 0..400 {
        let name = hex::encode(format!("nft{i:05}"));
        let mut u = utxo(&w, 0, 2 * ADA, &[]);
        u.tx_hash = format!("{:064x}", 0x9000 + i);
        u.asset_list = Some(vec![Asset {
            decimals: 0,
            quantity: "1".into(),
            policy_id: POLICY.to_string(),
            asset_name: name.clone(),
            fingerprint: String::new(),
        }]);
        needed = needed
            .add(Token::new(POLICY.into(), name, 1).unwrap())
            .unwrap();
        h = h.with(&u.tx_hash, 0, class("public:0", Origin::Own));
        available.push(u);
    }
    let started = std::time::Instant::now();
    let ruled = build::holding_by_rule(&available, &needed, &h).unwrap();
    let took = started.elapsed();
    assert_eq!(ruled.len(), 400, "every one holds a token sent");
    assert!(
        took < std::time::Duration::from_secs(1),
        "the holders of 400 tokens took {took:?}"
    );
}
