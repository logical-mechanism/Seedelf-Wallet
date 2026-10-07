//! The wallet's own cancels of DEX orders (`orders.rs`, chunk 24 Step 3): each
//! DEX's real order, from mainnet or preprod, cancelled through its real
//! script in the wallet's evaluator; and the script refusing the same cancel
//! without the canceller's signature. The fixtures were read from chain on
//! 2026-10-07 (`tests/fixtures/order_cancels.json`): an order spent by a real
//! owner cancel, its datum, and the reference UTxO its script is read from;
//! and the owner's stuck preprod SundaeSwap V3 order.

use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::conway::Tx;
use pallas_traverse::MultiEraTx;
use seedelf_core::build::Budgets;
use seedelf_core::eval;
use seedelf_core::orders::{
    self, Cancel, Credential, OrderToCancel, Protocol, Session, cancel_orders, read_order,
};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

fn params(preprod: bool) -> ProtocolParameters {
    let file = if preprod {
        include_str!("fixtures/epoch_params.json")
    } else {
        include_str!("fixtures/epoch_params_mainnet.json")
    };
    let rows: Value = serde_json::from_str(file).unwrap();
    let row = if rows.is_array() { &rows[0] } else { &rows };
    ProtocolParameters::from_koios(row).unwrap()
}

fn fixtures() -> Vec<Value> {
    serde_json::from_str(include_str!("fixtures/order_cancels.json")).unwrap()
}

/// A Koios row from a fixture's UTxO.
fn row(u: &Value) -> UtxoResponse {
    let address = Address::from_bech32(u["address"].as_str().unwrap()).unwrap();
    let payment_cred = match &address {
        Address::Shelley(s) => hex::encode(s.payment().as_hash()),
        _ => String::new(),
    };
    serde_json::from_value(json!({
        "tx_hash": u["tx_hash"],
        "tx_index": u["tx_index"],
        "address": u["address"],
        "value": u["value"],
        "stake_address": null,
        "payment_cred": payment_cred,
        "epoch_no": 0,
        "block_height": 0,
        "block_time": 0,
        "datum_hash": u.get("datum_hash").cloned().unwrap_or(Value::Null),
        "inline_datum": u.get("inline_datum").cloned().unwrap_or(Value::Null),
        "reference_script": u.get("reference_script").cloned().unwrap_or(Value::Null),
        "asset_list": u.get("asset_list").cloned().unwrap_or(json!([])),
        "is_spent": false,
    }))
    .unwrap()
}

fn protocol(name: &str) -> Protocol {
    serde_json::from_value(json!(name)).unwrap()
}

/// The order's owner as a session: the keys its datum names.
fn session_of(p: Protocol, datum: &[u8]) -> Session {
    let read = orders::read(p, datum).unwrap();
    let to = read.pays[0];
    let (Credential::Key(payment), Some(Credential::Key(stake))) = (to.payment, to.stake) else {
        panic!("{p:?}'s order doesn't pay a base address of keys");
    };
    Session { payment, stake }
}

fn address_of(s: &Session, preprod: bool) -> Address {
    Address::Shelley(ShelleyAddress::new(
        if preprod {
            Network::Testnet
        } else {
            Network::Mainnet
        },
        ShelleyPaymentPart::key_hash(s.payment),
        ShelleyDelegationPart::key_hash(s.stake),
    ))
}

/// One of the session's own UTxOs: ADA alone, at its address.
fn own(address: &Address, fill: u8, lovelace: u64) -> UtxoResponse {
    serde_json::from_value(json!({
        "tx_hash": hex::encode([fill; 32]),
        "tx_index": 0,
        "address": address.to_bech32().unwrap(),
        "value": lovelace.to_string(),
        "stake_address": null,
        "payment_cred": "",
        "epoch_no": 0,
        "block_height": 0,
        "block_time": 0,
        "datum_hash": null,
        "inline_datum": null,
        "asset_list": [],
        "is_spent": false,
    }))
    .unwrap()
}

struct Built {
    fixture: Value,
    preprod: bool,
    session: Session,
    order: UtxoResponse,
    datum: Vec<u8>,
    references: Vec<UtxoResponse>,
    funds: Vec<UtxoResponse>,
    collateral: UtxoResponse,
    address: Address,
    cancel: orders::FinalCancel,
}

fn build(f: &Value) -> Built {
    let preprod = f["network"] == "preprod";
    let p = protocol(f["protocol"].as_str().unwrap());
    let datum = hex::decode(f["datum"].as_str().unwrap()).unwrap();
    let session = session_of(p, &datum);
    let address = address_of(&session, preprod);
    let order = row(&f["order"]);
    let references: Vec<UtxoResponse> = f["reference"]
        .as_object()
        .map(|_| vec![row(&f["reference"])])
        .unwrap_or_default();
    let funds = vec![own(&address, 0xaa, 10_000_000)];
    let collateral = own(&address, 0xbb, 5_000_000);
    let params = params(preprod);
    let cancel = cancel_orders(&Cancel {
        params: &params,
        network_flag: preprod,
        session,
        address: &address,
        orders: &[OrderToCancel {
            utxo: order.clone(),
            datum: datum.clone(),
        }],
        funds: &funds,
        collateral: &collateral,
        references: &references,
    })
    .unwrap_or_else(|e| panic!("{} on {}: {e:#}", f["protocol"], f["network"]));
    Built {
        fixture: f.clone(),
        preprod,
        session,
        order,
        datum,
        references,
        funds,
        collateral,
        address,
        cancel,
    }
}

/// Everything the evaluator needs to run `b`'s transaction again.
fn known(b: &Built) -> Vec<eval::Resolved> {
    let mut known: Vec<eval::Resolved> = [b.order.clone(), b.collateral.clone()]
        .iter()
        .chain(&b.funds)
        .map(|r| eval::resolve_row(r).unwrap())
        .collect();
    for r in &b.references {
        let script = r.reference_script.as_ref().unwrap();
        let version = match script.kind.as_deref() {
            Some("plutusV1") => 1,
            Some("plutusV2") => 2,
            _ => 3,
        };
        known.push(
            eval::resolve_reference(
                r,
                version,
                &hex::decode(script.bytes.as_ref().unwrap()).unwrap(),
            )
            .unwrap(),
        );
    }
    known
}

fn evaluate(b: &Built, tx: &[u8]) -> Value {
    let p = params(b.preprod);
    eval::evaluate_with(
        tx,
        &known(b),
        &p.cost_model_v1,
        &p.cost_model_v2,
        &p.cost_model_v3,
        b.preprod,
    )
    .unwrap()
}

#[test]
fn the_table_reads_and_its_carried_scripts_are_what_they_say() {
    for preprod in [false, true] {
        let table = orders::table(preprod).unwrap();
        assert!(table.len() >= 9, "{} entries", table.len());
        for e in &table {
            assert_eq!(e.inline.is_some(), e.plutus == 1, "{:?}", e.protocol);
        }
    }
    // Every DEX the wallet routes on mainnet, bar Danogo (no order), has a cancel.
    let mainnet: Vec<Protocol> = orders::table(false)
        .unwrap()
        .iter()
        .map(|e| e.protocol)
        .collect();
    for p in [
        Protocol::Minswap,
        Protocol::MinswapV2,
        Protocol::MinswapStable,
        Protocol::SundaeSwap,
        Protocol::SundaeSwapV3,
        Protocol::WingRiders,
        Protocol::WingRidersV2,
        Protocol::WingRidersStableV2,
        Protocol::Splash,
    ] {
        assert!(mainnet.contains(&p), "{p:?}");
    }
}

#[test]
fn every_dex_order_is_cancelled_through_its_real_script() {
    for f in fixtures() {
        let b = build(&f);
        let name = format!("{} on {}", f["protocol"], f["network"]);
        let p = protocol(f["protocol"].as_str().unwrap());
        let tx = MultiEraTx::decode(&b.cancel.tx.tx_bytes.0).unwrap();
        let at = format!("{}#{}", b.order.tx_hash, b.order.tx_index);
        assert_eq!(b.cancel.covers, vec![at.clone()], "{name}");
        assert_eq!(b.cancel.stake_signs, p.signs_with_stake(), "{name}");

        // It runs: the wallet's evaluator measured it, and measures it again within what it declares.
        let answer = evaluate(&b, &b.cancel.tx.tx_bytes.0);
        assert!(answer.get("result").is_some(), "{name}: {answer}");
        assert_eq!(
            eval::declared_covers(&b.cancel.tx.tx_bytes.0, &answer).unwrap(),
            Ok(()),
            "{name}"
        );

        // The canceller is a required signer, and so is the payment key (the session's funds).
        let body: Tx = minicbor::decode(&b.cancel.tx.tx_bytes.0).unwrap();
        let signers: Vec<Hash<28>> = body
            .transaction_body
            .required_signers
            .map(|s| s.to_vec())
            .unwrap_or_default();
        let expect = if p.signs_with_stake() {
            b.session.stake
        } else {
            b.session.payment
        };
        assert!(signers.contains(&expect), "{name}");
        assert!(signers.contains(&b.session.payment), "{name}");

        // Everything goes back to the session.
        let own = b.address.to_vec();
        for out in tx.outputs() {
            assert_eq!(out.address().unwrap().to_vec(), own, "{name}");
        }
        let lovelace = |rows: &[UtxoResponse]| -> u64 {
            rows.iter().map(|r| r.value.parse::<u64>().unwrap()).sum()
        };
        let out: u64 = tx.outputs().iter().map(|o| o.value().coin()).sum();
        assert_eq!(
            out + b.cancel.fee,
            lovelace(std::slice::from_ref(&b.order)) + lovelace(&b.funds),
            "{name}"
        );
        if p == Protocol::Splash {
            // Output 0 is the order's own value exactly.
            let first = &tx.outputs()[0];
            assert_eq!(first.value().coin().to_string(), b.order.value, "{name}");
        }

        // A datum kept by hash is carried byte for byte: its hash is the order's. (Koios gives an inline
        // datum's hash too.)
        if let (Some(hash), None) = (&b.order.datum_hash, &b.order.inline_datum) {
            let carried: Vec<String> = tx
                .plutus_data()
                .iter()
                .map(|d| hex::encode(Hasher::<256>::hash(d.raw_cbor())))
                .collect();
            assert!(carried.contains(hash), "{name}: {carried:?} has no {hash}");
            assert_eq!(hex::encode(Hasher::<256>::hash(&b.datum)), *hash);
        }

        // The budgets are the order of the real cancel's.
        if let Some(real) = f["redeemer"]["unit"].as_object() {
            let mem: u64 = real["mem"].as_str().unwrap().parse().unwrap();
            let ours = b.cancel.budgets[0];
            assert!(
                ours.mem > mem / 3 && ours.mem < mem * 3,
                "{name}: {} vs {mem}",
                ours.mem
            );
        }
    }
}

#[test]
fn without_the_cancellers_signature_every_script_refuses() {
    for f in fixtures() {
        let b = build(&f);
        let name = format!("{} on {}", f["protocol"], f["network"]);
        let mut tx: Tx = minicbor::decode(&b.cancel.tx.tx_bytes.0).unwrap();
        tx.transaction_body.required_signers = None;
        let unsigned = minicbor::to_vec(&tx).unwrap();
        let answer = evaluate(&b, &unsigned);
        assert!(answer.get("error").is_some(), "{name}: {answer}");
        // And with the signers back, it runs again: the change is what the script refused.
        let answer = evaluate(&b, &b.cancel.tx.tx_bytes.0);
        assert!(Budgets::from_ogmios(&answer).is_ok(), "{name}");
    }
}

#[test]
fn an_order_another_key_owns_is_refused_before_anything_is_built() {
    for f in fixtures() {
        let b = build(&f);
        let preprod = b.preprod;
        let someone = Session {
            payment: Hash::new([0x11; 28]),
            stake: b.session.stake,
        };
        let params = params(preprod);
        let result = cancel_orders(&Cancel {
            params: &params,
            network_flag: preprod,
            session: someone,
            address: &address_of(&someone, preprod),
            orders: &[OrderToCancel {
                utxo: b.order.clone(),
                datum: b.datum.clone(),
            }],
            funds: &b.funds,
            collateral: &b.collateral,
            references: &b.references,
        });
        let error = result.err().map(|e| e.to_string()).unwrap_or_default();
        assert!(
            error.contains("isn't this session's to cancel"),
            "{}: {error}",
            f["protocol"]
        );
    }
}

#[test]
fn an_order_is_read_from_its_output() {
    for f in fixtures() {
        let preprod = f["network"] == "preprod";
        let order = row(&f["order"]);
        let address = Address::from_bech32(&order.address).unwrap().to_vec();
        let datum = hex::decode(f["datum"].as_str().unwrap()).unwrap();
        let (entry, read) = read_order(preprod, &address, &datum).unwrap().unwrap();
        assert_eq!(entry.protocol, protocol(f["protocol"].as_str().unwrap()));
        assert!(session_of(entry.protocol, &datum).owns(&read));
    }
    // A key's address isn't an order.
    let fixture = &fixtures()[0];
    let datum = hex::decode(fixture["datum"].as_str().unwrap()).unwrap();
    let s = session_of(Protocol::Minswap, &datum);
    assert!(
        read_order(false, &address_of(&s, false).to_vec(), &datum)
            .unwrap()
            .is_none()
    );
}

#[test]
fn the_owners_stuck_preprod_order_is_cancelled_with_its_stake_key() {
    let f = fixtures().into_iter().find(|f| f["stuck"] == true).unwrap();
    let b = build(&f);
    assert!(b.cancel.stake_signs);
    // Read from chain: the order, 3.28 tADA and 14 USDR, owned by the session's stake key.
    assert_eq!(
        hex::encode(b.session.stake),
        "92dcefd51649d9b7a190f6700827d3265d52fb8bfb7fadcfd7a58dec"
    );
    // SundaeSwap V3's order script used exactly this in every real single-key cancel.
    assert_eq!(
        (b.cancel.budgets[0].mem, b.cancel.budgets[0].steps),
        (106_527, 32_956_964)
    );
    let tx = MultiEraTx::decode(&b.cancel.tx.tx_bytes.0).unwrap();
    let mut tokens = 0;
    for out in tx.outputs() {
        for policy in out.value().assets() {
            for asset in policy.assets() {
                tokens += asset.output_coin().unwrap_or(0);
            }
        }
    }
    assert_eq!(tokens, 14_000_000);
    let _ = &b.fixture;
}

/// Bytes, if there are any.
type Raw = Option<Vec<u8>>;

/// A transaction's witness datums (entry 4) and redeemers (entry 5), raw, and
/// its body's script data hash: what the ledger hashes, as the transaction
/// carries them.
fn witness_raw(tx: &[u8]) -> (Raw, Raw, Raw) {
    let mut d = minicbor::Decoder::new(tx);
    d.array().unwrap();
    let body_start = d.position();
    d.skip().unwrap();
    let body: pallas_primitives::conway::TransactionBody =
        minicbor::decode(&tx[body_start..d.position()]).unwrap();
    let entries = d.map().unwrap().unwrap();
    let (mut datums, mut redeemers) = (None, None);
    for _ in 0..entries {
        let key = d.u64().unwrap();
        let start = d.position();
        d.skip().unwrap();
        let raw = tx[start..d.position()].to_vec();
        match key {
            4 => datums = Some(raw),
            5 => redeemers = Some(raw),
            _ => {}
        }
    }
    (datums, redeemers, body.script_data_hash.map(|h| h.to_vec()))
}

#[test]
fn the_script_data_hash_is_the_ledgers_for_every_plutus_version() {
    // Real cancels from chain: the hash each carries, recomputed from its own witness bytes.
    let vectors: Value =
        serde_json::from_str(include_str!("fixtures/cancel_integrity.json")).unwrap();
    let p = params(false);
    for (version, key, model) in [
        (1, "v1", &p.cost_model_v1),
        (2, "v2", &p.cost_model_v2),
        (3, "v3", &p.cost_model_v3),
    ] {
        let tx = hex::decode(vectors[key]["cbor"].as_str().unwrap()).unwrap();
        let (datums, redeemers, hash) = witness_raw(&tx);
        let ours =
            orders::integrity_hash(&redeemers.unwrap(), datums.as_deref(), version, model).unwrap();
        assert_eq!(Some(ours.to_vec()), hash, "Plutus V{version}");
    }
    // And every cancel the wallet builds carries the hash its own bytes give.
    for f in fixtures() {
        let b = build(&f);
        let tx = &b.cancel.tx.tx_bytes.0;
        let (datums, redeemers, hash) = witness_raw(tx);
        let version = orders::table(b.preprod)
            .unwrap()
            .into_iter()
            .find(|e| hex::encode(e.script) == b.order.payment_cred)
            .unwrap()
            .plutus;
        let p = params(b.preprod);
        let model = match version {
            1 => &p.cost_model_v1,
            2 => &p.cost_model_v2,
            _ => &p.cost_model_v3,
        };
        let ours =
            orders::integrity_hash(&redeemers.unwrap(), datums.as_deref(), version, model).unwrap();
        assert_eq!(
            Some(ours.to_vec()),
            hash,
            "{} on {}",
            f["protocol"],
            f["network"]
        );
    }
}
