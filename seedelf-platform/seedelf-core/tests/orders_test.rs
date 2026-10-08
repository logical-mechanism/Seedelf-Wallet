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
use pallas_codec::utils::{Int, MaybeIndefArray};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::conway::{BigInt, Constr, PlutusData, Tx};
use pallas_primitives::{BoundedBytes, Fragment};
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{BuildConway, Input, Output, ScriptKind, StagingTransaction};
use seedelf_core::build::Budgets;
use seedelf_core::cbor::MAX_DEPTH;
use seedelf_core::eval;
use seedelf_core::orders::{
    self, Cancel, Credential, OrderToCancel, Protocol, Session, cancel_orders, read_order,
};
use seedelf_koios::koios::{InlineDatum, ProtocolParameters, ReferenceScript, UtxoResponse};
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

// ---------------------------------------------------------------------------
// The 1.3.0 review: a session's cancel as the worker asks for it, several
// orders at once, each half of `owns`, refusals put in words, and datums and
// rows no script can spend.
// ---------------------------------------------------------------------------

/// The fixture of `protocol` on `network` (not the stuck one).
fn fixture(protocol: &str, network: &str) -> Value {
    fixtures()
        .into_iter()
        .find(|f| f["protocol"] == protocol && f["network"] == network && f["stuck"] != true)
        .unwrap_or_else(|| panic!("no {protocol} order on {network}"))
}

/// A fixture's order, ready to cancel: its owner as the session, at the
/// session's own address.
struct Setup {
    preprod: bool,
    protocol: Protocol,
    session: Session,
    address: Address,
    order: UtxoResponse,
    datum: Vec<u8>,
    references: Vec<UtxoResponse>,
    params: ProtocolParameters,
}

impl Setup {
    fn of(f: &Value) -> Self {
        let preprod = f["network"] == "preprod";
        let protocol = protocol(f["protocol"].as_str().unwrap());
        let datum = hex::decode(f["datum"].as_str().unwrap()).unwrap();
        let session = session_of(protocol, &datum);
        Setup {
            preprod,
            protocol,
            session,
            address: address_of(&session, preprod),
            order: row(&f["order"]),
            datum,
            references: f["reference"]
                .as_object()
                .map(|_| vec![row(&f["reference"])])
                .unwrap_or_default(),
            params: params(preprod),
        }
    }

    fn order(&self) -> OrderToCancel {
        OrderToCancel {
            utxo: self.order.clone(),
            datum: self.datum.clone(),
        }
    }

    fn cancel(
        &self,
        orders: &[OrderToCancel],
        funds: &[UtxoResponse],
        collateral: &UtxoResponse,
    ) -> anyhow::Result<orders::FinalCancel> {
        self.cancel_with(orders, funds, collateral, &self.references)
    }

    fn cancel_with(
        &self,
        orders: &[OrderToCancel],
        funds: &[UtxoResponse],
        collateral: &UtxoResponse,
        references: &[UtxoResponse],
    ) -> anyhow::Result<orders::FinalCancel> {
        cancel_orders(&Cancel {
            params: &self.params,
            network_flag: self.preprod,
            session: self.session,
            address: &self.address,
            orders,
            funds,
            collateral,
            references,
        })
    }

    /// Runs `tx` in the wallet's evaluator, knowing `rows` and the references.
    fn evaluate(&self, tx: &[u8], rows: &[UtxoResponse]) -> Value {
        let mut known: Vec<eval::Resolved> =
            rows.iter().map(|r| eval::resolve_row(r).unwrap()).collect();
        for r in &self.references {
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
        eval::evaluate_with(
            tx,
            &known,
            &self.params.cost_model_v1,
            &self.params.cost_model_v2,
            &self.params.cost_model_v3,
            self.preprod,
        )
        .unwrap()
    }
}

fn outpoint(u: &UtxoResponse) -> String {
    format!("{}#{}", u.tx_hash, u.tx_index)
}

/// `order` moved to another outpoint: `fill` × 32 as its transaction's hash.
fn moved(order: &UtxoResponse, fill: u8) -> UtxoResponse {
    let mut o = order.clone();
    o.tx_hash = hex::encode([fill; 32]);
    o.tx_index = 0;
    o
}

/// `order` holding `datum` instead, in the form it holds its own: inline, or
/// by hash.
fn with_datum(order: &UtxoResponse, datum: &[u8]) -> UtxoResponse {
    let mut o = order.clone();
    match &mut o.inline_datum {
        Some(inline) => inline.bytes = hex::encode(datum),
        None => o.datum_hash = Some(hex::encode(Hasher::<256>::hash(datum))),
    }
    o
}

/// A transaction's spent inputs, `hash#index`.
fn inputs_of(tx: &MultiEraTx) -> Vec<String> {
    tx.inputs()
        .iter()
        .map(|i| format!("{}#{}", i.hash(), i.index()))
        .collect()
}

/// What `rows` hold, in lovelace.
fn lovelace_of(rows: &[UtxoResponse]) -> u64 {
    rows.iter().map(|r| r.value.parse::<u64>().unwrap()).sum()
}

/// A transaction's outputs' lovelace, in order.
fn coins(tx: &MultiEraTx) -> Vec<u64> {
    tx.outputs().iter().map(|o| o.value().coin()).collect()
}

/// The token quantities a transaction's outputs hold, in all.
fn tokens_out(tx: &MultiEraTx) -> u64 {
    let mut total = 0;
    for out in tx.outputs() {
        for policy in out.value().assets() {
            for asset in policy.assets() {
                total += asset.output_coin().unwrap_or(0);
            }
        }
    }
    total
}

fn tokens_in(rows: &[UtxoResponse]) -> u64 {
    rows.iter()
        .flat_map(|r| r.asset_list.iter().flatten())
        .map(|a| a.quantity.parse::<u64>().unwrap())
        .sum()
}

fn constr(index: u64, fields: Vec<PlutusData>) -> PlutusData {
    PlutusData::Constr(Constr {
        tag: 121 + index,
        any_constructor: None,
        fields: MaybeIndefArray::Def(fields),
    })
}

fn bytes(b: &[u8]) -> PlutusData {
    PlutusData::BoundedBytes(BoundedBytes::from(b.to_vec()))
}

fn int(n: i64) -> PlutusData {
    PlutusData::BigInt(BigInt::Int(Int::from(n)))
}

/// A constructor's fields, to edit.
fn fields(d: &mut PlutusData) -> &mut Vec<PlutusData> {
    let PlutusData::Constr(c) = d else {
        panic!("not a constructor")
    };
    match &mut c.fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    }
}

/// Another key, nobody's.
const OTHER: [u8; 28] = [0xee; 28];

/// A base address of keys that isn't the session's, as a datum holds one.
fn other_address() -> PlutusData {
    constr(
        0,
        vec![
            constr(0, vec![bytes(&OTHER)]),
            constr(0, vec![constr(0, vec![constr(0, vec![bytes(&OTHER)])])]),
        ],
    )
}

/// The ADA-only output of exactly 5 ADA a session's return puts up as
/// Lovejoin's collateral (the worker's `collateralFits`).
const SESSION_COLLATERAL: u64 = 5_000_000;

/// The least an output of ADA alone at a mainnet base address holds:
/// (160 + 67 bytes) × 4,310 lovelace a byte.
const LEAST_ADA_OUTPUT: u64 = 978_370;

/// A Splash order's refund must be its value exactly, so its cancel's fee
/// comes from the session's own change: what a swap leaves beside the 5 ADA
/// collateral (its 2 ADA of room less the swap's fee, about 1.2 to 1.9 ADA)
/// pays it, and the collateral stays where it is. Given as the worker gives
/// them: the collateral among the funds.
#[test]
fn a_splash_cancel_is_paid_from_the_change_a_swap_leaves() {
    let s = Setup::of(&fixture("Splash", "mainnet"));
    let collateral = own(&s.address, 0xbb, SESSION_COLLATERAL);
    for change in [1_200_000, 1_500_000, 1_700_000, 1_900_000] {
        let funds = vec![collateral.clone(), own(&s.address, 0xaa, change)];
        let built = s
            .cancel(&[s.order()], &funds, &collateral)
            .unwrap_or_else(|e| panic!("{change} lovelace of change: {e:#}"));
        let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
        assert_eq!(built.covers, vec![outpoint(&s.order)]);
        // Output 0 is the order's own value, exactly.
        assert_eq!(
            tx.outputs()[0].value().coin().to_string(),
            s.order.value,
            "{change}"
        );
        // The collateral isn't spent: the session keeps it for its return.
        assert!(!inputs_of(&tx).contains(&outpoint(&collateral)), "{change}");
        let out: u64 = coins(&tx).iter().sum();
        assert_eq!(
            out + built.fee,
            lovelace_of(std::slice::from_ref(&s.order)) + change,
            "{change}"
        );
        assert_eq!(tokens_out(&tx), tokens_in(std::slice::from_ref(&s.order)));
    }
}

/// The collateral is spent only when the session's other funds can't pay the
/// fee and a change output: with no change, or too little.
#[test]
fn a_splash_cancel_spends_the_collateral_only_when_nothing_else_can_pay() {
    let s = Setup::of(&fixture("Splash", "mainnet"));
    let collateral = own(&s.address, 0xbb, SESSION_COLLATERAL);
    for change in [None, Some(500_000), Some(1_000_000)] {
        let mut funds = vec![collateral.clone()];
        funds.extend(change.map(|c| own(&s.address, 0xaa, c)));
        let built = s
            .cancel(&[s.order()], &funds, &collateral)
            .unwrap_or_else(|e| panic!("{change:?} of change: {e:#}"));
        let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
        assert_eq!(
            tx.outputs()[0].value().coin().to_string(),
            s.order.value,
            "{change:?}"
        );
        assert!(
            inputs_of(&tx).contains(&outpoint(&collateral)),
            "{change:?}"
        );
        let out: u64 = coins(&tx).iter().sum();
        assert_eq!(
            out + built.fee,
            lovelace_of(std::slice::from_ref(&s.order)) + lovelace_of(&funds),
            "{change:?}"
        );
        // Everything but the refund comes back as one output: an exact 5 ADA
        // beside it would leave the rest under the least an output holds.
        assert_eq!(tx.outputs().len(), 2, "{change:?}");
    }
}

/// When no UTxO of exactly 5 ADA is left, the worker puts up the account's
/// largest of ADA alone. Spent for the fee, it leaves an exact 5 ADA of ADA
/// alone behind, so the session's return still finds a collateral for
/// Lovejoin. Whether it can is decided once, at a 1 ADA fee, so the
/// cancel's outputs don't change while its fee settles: 6.5 ADA can't.
#[test]
fn a_larger_collateral_spent_leaves_an_exact_one_behind() {
    let s = Setup::of(&fixture("Splash", "mainnet"));
    let collateral = own(&s.address, 0xbb, 8_000_000);
    let built = s
        .cancel(&[s.order()], std::slice::from_ref(&collateral), &collateral)
        .unwrap_or_else(|e| panic!("{e:#}"));
    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    assert!(inputs_of(&tx).contains(&outpoint(&collateral)));
    assert_eq!(tx.outputs()[0].value().coin().to_string(), s.order.value);
    let own_bytes = s.address.to_vec();
    let kept = tx
        .outputs()
        .iter()
        .skip(1)
        .filter(|o| {
            o.value().coin() == SESSION_COLLATERAL
                && o.value().assets().is_empty()
                && o.datum().is_none()
                && o.address().unwrap().to_vec() == own_bytes
        })
        .count();
    assert_eq!(kept, 1, "{:?}", coins(&tx));
    let out: u64 = coins(&tx).iter().sum();
    assert_eq!(out + built.fee, 4_500_000 + 8_000_000);

    let smaller = own(&s.address, 0xbb, 6_500_000);
    let built = s
        .cancel(&[s.order()], std::slice::from_ref(&smaller), &smaller)
        .unwrap_or_else(|e| panic!("{e:#}"));
    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    assert!(inputs_of(&tx).contains(&outpoint(&smaller)));
    assert_eq!(tx.outputs().len(), 2, "{:?}", coins(&tx));
    let out: u64 = coins(&tx).iter().sum();
    assert_eq!(out + built.fee, 4_500_000 + 6_500_000);
}

/// The collateral's return is an output, held to the least an output holds:
/// a collateral too small to leave one is refused in words, before the node
/// would; one just big enough is put up.
#[test]
fn the_collateral_return_is_held_to_the_least_an_output_holds() {
    let s = Setup::of(&fixture("MinswapV2", "mainnet"));
    let funds = vec![own(&s.address, 0xaa, 10_000_000)];
    let small = own(&s.address, 0xbb, 1_200_000);
    let refused = s
        .cancel(&[s.order()], &funds, &small)
        .err()
        .map(|e| format!("{e:#}"))
        .unwrap_or_default();
    assert!(refused.contains("collateral"), "{refused}");
    // 1.4 ADA covers 1.5 times the fee and leaves the least an output holds.
    let enough = own(&s.address, 0xbb, 1_400_000);
    let built = s
        .cancel(&[s.order()], &funds, &enough)
        .unwrap_or_else(|e| panic!("{e:#}"));
    let body: Tx = minicbor::decode(&built.tx.tx_bytes.0).unwrap();
    let back = match body.transaction_body.collateral_return.unwrap() {
        pallas_primitives::conway::PseudoTransactionOutput::PostAlonzo(o) => match o.value {
            pallas_primitives::conway::Value::Coin(c) => c,
            _ => panic!("a collateral return holding tokens"),
        },
        pallas_primitives::conway::PseudoTransactionOutput::Legacy(o) => match o.amount {
            pallas_primitives::alonzo::Value::Coin(c) => c,
            _ => panic!("a collateral return holding tokens"),
        },
    };
    assert!(back >= LEAST_ADA_OUTPUT, "{back}");
    assert_eq!(back, 1_400_000 - built.fee * 3 / 2);
}

/// Several orders of one Plutus version share a cancel ([`orders::group`]):
/// each order placed twice, at outpoints that sort either side of the
/// session's fund, so every redeemer's index is the ledger's. A Splash order
/// goes alone.
#[test]
fn several_orders_of_one_plutus_version_cancel_in_one_transaction() {
    for f in fixtures() {
        let s = Setup::of(&f);
        let name = format!("{} on {}", f["protocol"], f["network"]);
        let first = moved(&s.order, 0x01);
        let second = moved(&s.order, 0xfe);
        let orders = [
            OrderToCancel {
                utxo: first.clone(),
                datum: s.datum.clone(),
            },
            OrderToCancel {
                utxo: second.clone(),
                datum: s.datum.clone(),
            },
        ];
        let funds = vec![own(&s.address, 0xaa, 10_000_000)];
        let collateral = own(&s.address, 0xbb, SESSION_COLLATERAL);
        let built = s
            .cancel(&orders, &funds, &collateral)
            .unwrap_or_else(|e| panic!("{name}: {e:#}"));
        if s.protocol == Protocol::Splash {
            // Splash holds output 0 to its order's value: one order a cancel.
            assert_eq!(built.covers, vec![outpoint(&first)], "{name}");
            let rest = s
                .cancel(&orders[1..], &funds, &collateral)
                .unwrap_or_else(|e| panic!("{name}: {e:#}"));
            assert_eq!(rest.covers, vec![outpoint(&second)], "{name}");
            continue;
        }
        assert_eq!(
            built.covers,
            vec![outpoint(&first), outpoint(&second)],
            "{name}"
        );
        assert_eq!(built.budgets.len(), 2, "{name}");
        // It runs again, within what it declares, with both orders known.
        let mut rows = vec![first.clone(), second.clone(), collateral.clone()];
        rows.extend(funds.iter().cloned());
        let answer = s.evaluate(&built.tx.tx_bytes.0, &rows);
        assert!(answer.get("result").is_some(), "{name}: {answer}");
        assert_eq!(
            eval::declared_covers(&built.tx.tx_bytes.0, &answer).unwrap(),
            Ok(()),
            "{name}"
        );
        let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
        let own = s.address.to_vec();
        for out in tx.outputs() {
            assert_eq!(out.address().unwrap().to_vec(), own, "{name}");
        }
        let out: u64 = coins(&tx).iter().sum();
        assert_eq!(
            out + built.fee,
            2 * lovelace_of(std::slice::from_ref(&s.order)) + lovelace_of(&funds),
            "{name}"
        );
        assert_eq!(
            tokens_out(&tx),
            2 * tokens_in(std::slice::from_ref(&s.order)),
            "{name}"
        );
        let body: Tx = minicbor::decode(&built.tx.tx_bytes.0).unwrap();
        let signers: Vec<Hash<28>> = body
            .transaction_body
            .required_signers
            .map(|s| s.to_vec())
            .unwrap_or_default();
        let canceller = if s.protocol.signs_with_stake() {
            s.session.stake
        } else {
            s.session.payment
        };
        assert!(signers.contains(&canceller), "{name}");
        assert!(signers.contains(&s.session.payment), "{name}");
        // A datum kept by hash is carried once, however many orders name it.
        if s.order.inline_datum.is_none() {
            assert_eq!(tx.plutus_data().len(), 1, "{name}");
        }
    }
}

/// `datum` made out to `to` instead of `from`: each of `from`'s keys swapped
/// for `to`'s, byte for byte.
fn rekeyed(datum: &[u8], from: &Session, to: &Session) -> Vec<u8> {
    let text = hex::encode(datum)
        .replace(&hex::encode(from.payment), &hex::encode(to.payment))
        .replace(&hex::encode(from.stake), &hex::encode(to.stake));
    hex::decode(text).unwrap()
}

/// A Plutus V1 order and a V2 one of the same session never share a cancel:
/// one language view a transaction. The first asked for goes first, and the
/// next cancel takes the other.
#[test]
fn orders_of_two_plutus_versions_are_cancelled_apart() {
    let v1 = Setup::of(&fixture("Minswap", "mainnet"));
    let v2 = Setup::of(&fixture("MinswapV2", "mainnet"));
    let datum = rekeyed(&v2.datum, &v2.session, &v1.session);
    let read = orders::read(Protocol::MinswapV2, &datum).unwrap();
    assert!(v1.session.owns(&read), "re-keyed to the V1 order's owner");
    let second = with_datum(&v2.order, &datum);
    let orders = [
        v1.order(),
        OrderToCancel {
            utxo: second.clone(),
            datum,
        },
    ];
    let funds = vec![own(&v1.address, 0xaa, 10_000_000)];
    let collateral = own(&v1.address, 0xbb, SESSION_COLLATERAL);
    let both = |orders: &[OrderToCancel]| {
        v1.cancel_with(orders, &funds, &collateral, &v2.references)
            .unwrap_or_else(|e| panic!("{e:#}"))
    };
    let first = both(&orders);
    assert_eq!(first.covers, vec![outpoint(&v1.order)]);
    let body: Tx = minicbor::decode(&first.tx.tx_bytes.0).unwrap();
    assert!(body.transaction_witness_set.plutus_v1_script.is_some());
    assert!(body.transaction_witness_set.plutus_v2_script.is_none());
    assert!(body.transaction_body.reference_inputs.is_none());
    let next = both(&orders[1..]);
    assert_eq!(next.covers, vec![outpoint(&second)]);
    // The other way around, the V2 order goes first, alone.
    let reversed = [orders[1].clone(), orders[0].clone()];
    assert_eq!(both(&reversed).covers, vec![outpoint(&second)]);
}

/// `Session::owns` holds both halves apart: an order paying the session but
/// cancelled by another key isn't the session's, nor one cancelled by the
/// session's key that pays anyone else too; and a datum naming a script or a
/// SundaeSwap V1 alternate as canceller isn't read at all. Each is refused by
/// the cancel too.
#[test]
fn an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are() {
    enum Expect {
        NotOurs,
        Unread,
    }
    let mut seen = 0;
    for f in fixtures() {
        let s = Setup::of(&f);
        let base = PlutusData::decode_fragment(&s.datum).unwrap();
        let edit = |change: &dyn Fn(&mut PlutusData)| {
            let mut d = base.clone();
            change(&mut d);
            d.encode_fragment().unwrap()
        };
        let own_address = s.session.address();
        let payment = s.session.payment;
        let mut variants: Vec<(&str, Vec<u8>, Expect)> = Vec::new();
        match s.protocol {
            Protocol::Minswap | Protocol::MinswapStable => {
                variants.push((
                    "receiver another's",
                    edit(&|d| fields(d)[1] = other_address()),
                    Expect::NotOurs,
                ));
            }
            Protocol::MinswapV2 => {
                variants.push((
                    "canceller another's",
                    edit(&|d| fields(d)[0] = constr(0, vec![bytes(&OTHER)])),
                    Expect::NotOurs,
                ));
                variants.push((
                    "refund another's",
                    edit(&|d| fields(d)[1] = other_address()),
                    Expect::NotOurs,
                ));
                variants.push((
                    "success another's",
                    edit(&|d| fields(d)[3] = other_address()),
                    Expect::NotOurs,
                ));
                for script in 1..=3 {
                    variants.push((
                        "canceller a script",
                        edit(&|d| fields(d)[0] = constr(script, vec![bytes(payment.as_ref())])),
                        Expect::Unread,
                    ));
                }
            }
            Protocol::SundaeSwap => {
                for alternate in [payment.as_ref(), &OTHER[..]] {
                    variants.push((
                        "an alternate",
                        edit(&|d| {
                            let addresses = &mut fields(d)[1];
                            fields(addresses)[1] = constr(0, vec![bytes(alternate)]);
                        }),
                        Expect::Unread,
                    ));
                }
            }
            Protocol::SundaeSwapV3 | Protocol::SundaeSwapStable => {
                variants.push((
                    "owner another's",
                    edit(&|d| fields(d)[1] = constr(0, vec![bytes(&OTHER)])),
                    Expect::NotOurs,
                ));
                variants.push((
                    "destination another's",
                    edit(&|d| fields(d)[3] = constr(0, vec![other_address(), constr(0, vec![])])),
                    Expect::NotOurs,
                ));
            }
            Protocol::WingRiders => {
                variants.push((
                    "owner another's",
                    edit(&|d| {
                        let inner = &mut fields(d)[0];
                        fields(inner)[1] = bytes(&OTHER);
                    }),
                    Expect::NotOurs,
                ));
                variants.push((
                    "beneficiary another's",
                    edit(&|d| {
                        let inner = &mut fields(d)[0];
                        fields(inner)[0] = other_address();
                    }),
                    Expect::NotOurs,
                ));
            }
            Protocol::WingRidersV2 | Protocol::WingRidersStableV2 => {
                variants.push((
                    "beneficiary another's",
                    edit(&|d| fields(d)[1] = other_address()),
                    Expect::NotOurs,
                ));
            }
            Protocol::Splash => {
                variants.push((
                    "cancelling key another's",
                    edit(&|d| fields(d)[10] = bytes(&OTHER)),
                    Expect::NotOurs,
                ));
                variants.push((
                    "redeemer address another's",
                    edit(&|d| fields(d)[9] = other_address()),
                    Expect::NotOurs,
                ));
            }
        }
        for (what, datum, expect) in variants {
            let name = format!("{} on {}, {what}", f["protocol"], f["network"]);
            let wanted = match expect {
                Expect::NotOurs => {
                    let read = orders::read(s.protocol, &datum)
                        .unwrap_or_else(|e| panic!("{name}: {e:#}"));
                    assert!(!s.session.owns(&read), "{name}");
                    // Each variant changes one half only: the other still names the session.
                    let pays_session = read.pays.contains(&own_address);
                    let canceller = if s.protocol.signs_with_stake() {
                        s.session.stake
                    } else {
                        s.session.payment
                    };
                    assert!(pays_session || read.signer == canceller, "{name}");
                    "isn't this session's to cancel"
                }
                Expect::Unread => {
                    assert!(orders::read(s.protocol, &datum).is_err(), "{name}");
                    "aren't in the shape the wallet reads"
                }
            };
            let order = with_datum(&s.order, &datum);
            let error = s
                .cancel(
                    &[OrderToCancel { utxo: order, datum }],
                    &[own(&s.address, 0xaa, 10_000_000)],
                    &own(&s.address, 0xbb, SESSION_COLLATERAL),
                )
                .err()
                .map(|e| e.to_string())
                .unwrap_or_default();
            assert!(error.contains(wanted), "{name}: {error}");
            seen += 1;
        }
    }
    assert!(seen >= 30, "{seen} variants");
}

/// A DEX order script that refuses the wallet's cancel is named as the DEX's,
/// with the order, never as the Seedelf contract. Each datum has one field
/// the reader skips made bytes, which its script can't decode.
#[test]
fn a_dex_script_that_refuses_the_cancel_is_named_not_seedelf() {
    for (protocol, from, to) in [
        // MinswapV2's max batcher fee, and SundaeSwap V3's max protocol fee.
        ("MinswapV2", "1a000dbba0", "44000dbba0"),
        ("SundaeSwapV3", "1a00138800", "4400138800"),
    ] {
        let s = Setup::of(&fixture(protocol, "mainnet"));
        let text = hex::encode(&s.datum);
        assert_eq!(text.matches(from).count(), 1, "{protocol}");
        let datum = hex::decode(text.replace(from, to)).unwrap();
        assert!(
            s.session.owns(&orders::read(s.protocol, &datum).unwrap()),
            "{protocol}: the reader still reads it"
        );
        let order = with_datum(&s.order, &datum);
        let error = s
            .cancel(
                &[OrderToCancel {
                    utxo: order.clone(),
                    datum,
                }],
                &[own(&s.address, 0xaa, 10_000_000)],
                &own(&s.address, 0xbb, SESSION_COLLATERAL),
            )
            .err()
            .map(|e| format!("{e:#}"))
            .unwrap_or_default();
        assert!(error.contains(protocol), "{error}");
        assert!(error.contains(&outpoint(&order)), "{error}");
        assert!(!error.contains("Seedelf"), "{error}");
        // An ordinary word first: the worker lowers the first letter to make it a clause.
        assert!(error.starts_with("The DEX's order script"), "{error}");
    }
}

/// A reference spent by its holder (SundaeSwap V3's mainnet one sits at
/// Sundae's own key) still gives its script: checked against the pinned hash,
/// the cancel carries it in its witnesses instead of reading it.
#[test]
fn a_spent_reference_still_gives_its_script_and_the_cancel_carries_it() {
    for f in fixtures() {
        if !f["reference"].is_object() {
            continue;
        }
        let s = Setup::of(&f);
        let name = format!("{} on {}", f["protocol"], f["network"]);
        let mut spent = s.references[0].clone();
        spent.is_spent = true;
        let funds = vec![own(&s.address, 0xaa, 10_000_000)];
        let collateral = own(&s.address, 0xbb, SESSION_COLLATERAL);
        let built = s
            .cancel_with(
                &[s.order()],
                &funds,
                &collateral,
                std::slice::from_ref(&spent),
            )
            .unwrap_or_else(|e| panic!("{name}: {e:#}"));
        let body: Tx = minicbor::decode(&built.tx.tx_bytes.0).unwrap();
        assert!(body.transaction_body.reference_inputs.is_none(), "{name}");
        let entry = orders::table(s.preprod)
            .unwrap()
            .into_iter()
            .find(|e| hex::encode(e.script) == s.order.payment_cred)
            .unwrap();
        let w = &body.transaction_witness_set;
        let carried: Vec<Hash<28>> = match entry.plutus {
            2 => {
                assert!(w.plutus_v3_script.is_none(), "{name}");
                w.plutus_v2_script
                    .iter()
                    .flat_map(|s| s.iter())
                    .map(|s| Hasher::<224>::hash_tagged(s.as_ref(), 2))
                    .collect()
            }
            _ => {
                assert!(w.plutus_v2_script.is_none(), "{name}");
                w.plutus_v3_script
                    .iter()
                    .flat_map(|s| s.iter())
                    .map(|s| Hasher::<224>::hash_tagged(s.as_ref(), 3))
                    .collect()
            }
        };
        assert_eq!(carried, vec![entry.script], "{name}");
        assert!(w.plutus_v1_script.is_none(), "{name}");
        let mut rows = vec![s.order.clone(), collateral.clone()];
        rows.extend(funds.iter().cloned());
        let answer = s.evaluate(&built.tx.tx_bytes.0, &rows);
        assert!(answer.get("result").is_some(), "{name}: {answer}");
        assert_eq!(
            eval::declared_covers(&built.tx.tx_bytes.0, &answer).unwrap(),
            Ok(()),
            "{name}"
        );
        // Under the worker's cap on a cancel's fee (3 ADA).
        assert!(built.fee <= 3_000_000, "{name}: {}", built.fee);

        // A spent row holding another script isn't taken.
        let mut other = spent.clone();
        let script = other.reference_script.as_mut().unwrap();
        script.bytes = Some("4e4d01000033222220051200120011".to_string());
        let refused = s
            .cancel_with(&[s.order()], &funds, &collateral, &[other])
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(
            refused.contains("doesn't hold the order's script"),
            "{name}: {refused}"
        );
        // Nor is a cancel built without the row at all.
        let missing = s
            .cancel_with(&[s.order()], &funds, &collateral, &[])
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(missing.contains("doesn't have"), "{name}: {missing}");
    }
}

/// `n` levels of one-item arrays around a 0.
fn nested_arrays(n: usize) -> Vec<u8> {
    let mut v = vec![0x81; n];
    v.push(0x00);
    v
}

/// `n` levels of indefinite arrays.
fn nested_indefinite(n: usize) -> Vec<u8> {
    let mut v = vec![0x9f; n];
    v.push(0x00);
    v.extend(std::iter::repeat_n(0xff, n));
    v
}

/// `n` levels of one-pair maps.
fn nested_maps(n: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(2 * n + 1);
    for _ in 0..n {
        v.extend([0xa1, 0x00]);
    }
    v.push(0x00);
    v
}

/// `n` levels of constructors, `Constr 0 [Constr 0 [...]]`.
fn nested_constrs(n: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(3 * n + 1);
    for _ in 0..n {
        v.extend([0xd8, 0x79, 0x81]);
    }
    v.push(0x00);
    v
}

/// Anyone can pay an order's address an output with any datum (a spent Splash
/// order's address is read whole), and the datum decoder recurses a call a
/// level: one nested past `MAX_DEPTH` is refused unread, before it can
/// overflow the stack.
#[test]
fn a_datum_nested_too_deep_is_refused_unread() {
    let all = [
        Protocol::Minswap,
        Protocol::MinswapV2,
        Protocol::MinswapStable,
        Protocol::SundaeSwap,
        Protocol::SundaeSwapV3,
        Protocol::SundaeSwapStable,
        Protocol::WingRiders,
        Protocol::WingRidersV2,
        Protocol::WingRidersStableV2,
        Protocol::Splash,
    ];
    let deep = [
        nested_arrays(MAX_DEPTH + 1),
        nested_arrays(100_000),
        nested_indefinite(100_000),
        nested_maps(100_000),
        nested_constrs(100_000),
    ];
    for p in all {
        for datum in &deep {
            let error = orders::read(p, datum).unwrap_err().to_string();
            assert!(
                error.contains("aren't in the shape the wallet reads"),
                "{p:?}: {error}"
            );
        }
    }
    // At Splash's script, as the worker reads what's at a spent order's address.
    let s = Setup::of(&fixture("Splash", "mainnet"));
    let address = Address::from_bech32(&s.order.address).unwrap().to_vec();
    assert!(read_order(false, &address, &nested_arrays(100_000)).is_err());
    assert!(read_order(false, &address, &s.datum).unwrap().is_some());
}

/// Splash's script decodes its whole datum, so a datum with any of its twelve
/// fields of the wrong type is no order the session can cancel: it isn't
/// read, and never the session's.
#[test]
fn a_splash_datum_reads_only_with_every_field_of_its_type() {
    let s = Setup::of(&fixture("Splash", "mainnet"));
    let base = PlutusData::decode_fragment(&s.datum).unwrap();
    assert!(
        s.session
            .owns(&orders::read(Protocol::Splash, &s.datum).unwrap())
    );
    let edit = |change: &dyn Fn(&mut PlutusData)| {
        let mut d = base.clone();
        change(&mut d);
        d.encode_fragment().unwrap()
    };
    let wrong: Vec<(usize, PlutusData)> = vec![
        (0, int(0)),
        (1, int(0)),
        (2, bytes(&[0x00])),
        (2, constr(0, vec![bytes(&[]), int(0)])),
        (3, bytes(&[0x00])),
        (4, bytes(&[0x00])),
        (5, bytes(&[0x00])),
        (6, int(0)),
        (7, constr(0, vec![int(1), bytes(&[0x01])])),
        (7, int(1)),
        (8, bytes(&[0x00])),
        (9, bytes(&[0x00])),
        (10, int(0)),
        (11, bytes(&[0x00])),
        (11, PlutusData::Array(MaybeIndefArray::Def(vec![int(0)]))),
    ];
    for (i, field) in wrong {
        let datum = edit(&|d| fields(d)[i] = field.clone());
        assert!(
            orders::read(Protocol::Splash, &datum).is_err(),
            "field {i} as {field:?}"
        );
    }
    // Eleven fields or thirteen: not Splash's.
    let short = edit(&|d| {
        fields(d).pop();
    });
    let long = edit(&|d| fields(d).push(int(0)));
    assert!(orders::read(Protocol::Splash, &short).is_err());
    assert!(orders::read(Protocol::Splash, &long).is_err());
    // Re-encoded with definite lists, it still reads.
    let again = edit(&|_| {});
    assert!(
        s.session
            .owns(&orders::read(Protocol::Splash, &again).unwrap())
    );
}

/// A small Plutus V2 script, to sit on a row as its reference script.
const SOME_SCRIPT: &str = "4e4d01000033222220051200120011";

/// What no script can spend is refused by its form, in words, before the
/// evaluator: a Plutus V1 order holding its datum inline (the ledger refuses
/// one), and an order carrying a reference script.
#[test]
fn an_order_no_script_can_spend_is_refused_by_its_form() {
    for protocol in ["Minswap", "SundaeSwap", "WingRiders"] {
        let s = Setup::of(&fixture(protocol, "mainnet"));
        let mut order = s.order.clone();
        order.inline_datum = Some(InlineDatum {
            bytes: hex::encode(&s.datum),
            value: Value::Null,
        });
        order.datum_hash = None;
        let error = s
            .cancel(
                &[OrderToCancel {
                    utxo: order,
                    datum: s.datum.clone(),
                }],
                &[own(&s.address, 0xaa, 10_000_000)],
                &own(&s.address, 0xbb, SESSION_COLLATERAL),
            )
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(
            error.contains("holds its datum inline"),
            "{protocol}: {error}"
        );
    }
    for protocol in ["MinswapV2", "Minswap"] {
        let s = Setup::of(&fixture(protocol, "mainnet"));
        let mut order = s.order.clone();
        order.reference_script = Some(ReferenceScript {
            hash: None,
            size: Some(15),
            kind: Some("plutusV2".to_string()),
            bytes: Some(SOME_SCRIPT.to_string()),
        });
        let error = s
            .cancel(
                &[OrderToCancel {
                    utxo: order,
                    datum: s.datum.clone(),
                }],
                &[own(&s.address, 0xaa, 10_000_000)],
                &own(&s.address, 0xbb, SESSION_COLLATERAL),
            )
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(
            error.contains("carries a reference script"),
            "{protocol}: {error}"
        );
    }
}

/// A swap's transaction placing `order` (its address, value and datum) at
/// output 1, after the session's change at output 0: its datum inline or by
/// hash (then carried in the witnesses, as Minswap's V1 orders come), and a
/// script on it when `script` is given. Built only to be read back.
fn swap_placing(
    session: &Address,
    order: &UtxoResponse,
    datum: &[u8],
    inline: bool,
    script: Option<&[u8]>,
) -> Vec<u8> {
    let mut out = Output::new(
        Address::from_bech32(&order.address).unwrap(),
        order.value.parse().unwrap(),
    );
    for a in order.asset_list.iter().flatten() {
        let policy: [u8; 28] = hex::decode(&a.policy_id).unwrap().try_into().unwrap();
        out = out
            .add_asset(
                Hash::new(policy),
                hex::decode(&a.asset_name).unwrap(),
                a.quantity.parse().unwrap(),
            )
            .unwrap();
    }
    let mut tx = StagingTransaction::new()
        .input(Input::new(Hash::new([0x77; 32]), 0))
        .output(Output::new(session.clone(), 3_000_000));
    if inline {
        out = out.set_inline_datum(datum.to_vec());
    } else {
        out = out.set_datum_hash(Hasher::<256>::hash(datum));
        tx = tx.datum(datum.to_vec());
    }
    if let Some(bytes) = script {
        out = out.set_inline_script(ScriptKind::PlutusV2, bytes.to_vec());
    }
    tx.output(out)
        .fee(200_000)
        .build_conway_raw()
        .unwrap()
        .tx_bytes
        .0
}

/// [`orders::check_cancels`] on `tx`'s outputs `indexes`, for `s`'s session.
fn check_swap(
    s: &Setup,
    tx: &[u8],
    indexes: &[u64],
    references: &[UtxoResponse],
) -> Vec<orders::CancelCheck> {
    orders::check_cancels(&orders::SwapCheck {
        params: &s.params,
        network_flag: s.preprod,
        session: s.session,
        address: &s.address,
        tx_cbor: tx,
        orders: indexes,
        references,
    })
    .unwrap()
}

/// Every real order, as a swap places it, checks out: its cancel builds and
/// runs through its real script before the session signs the swap.
#[test]
fn every_real_order_a_swap_places_checks_out_by_its_cancel() {
    for f in fixtures() {
        let s = Setup::of(&f);
        let name = format!("{} on {}", f["protocol"], f["network"]);
        let inline = s.order.inline_datum.is_some();
        let tx = swap_placing(&s.address, &s.order, &s.datum, inline, None);
        let swap = MultiEraTx::decode(&tx).unwrap().hash();
        let checks = check_swap(&s, &tx, &[1], &s.references);
        assert_eq!(checks.len(), 1, "{name}");
        let c = &checks[0];
        assert_eq!(c.why, None, "{name}");
        assert_eq!(c.index, 1, "{name}");
        assert_eq!(c.order, format!("{swap}#1"), "{name}");
        assert_eq!(c.protocol, Some(s.protocol), "{name}");
        assert!(c.fee.is_some_and(|fee| fee <= 3_000_000), "{name}: {c:?}");
        // Its reference spent by whoever held it, the cancel still builds, carrying the script.
        if let Some(reference) = s.references.first() {
            let mut spent = reference.clone();
            spent.is_spent = true;
            let checks = check_swap(&s, &tx, &[1], &[spent]);
            assert_eq!(checks[0].why, None, "{name}");
            // Without the row at all, it can't be checked, and isn't passed.
            let checks = check_swap(&s, &tx, &[1], &[]);
            let why = checks[0].why.clone().unwrap_or_default();
            assert!(why.contains("doesn't have"), "{name}: {why}");
        }
    }
}

/// How the wallet words an order script's refusal of its cancel.
const SCRIPT_REFUSED: &str = "The DEX's order script refused the wallet's cancel";

/// What the reader alone lets through but no script can spend is found by
/// building the order's cancel before the swap is signed: datums malformed in
/// fields the reader skips, a Plutus V1 order's datum held inline, a script on
/// an order.
#[test]
fn an_order_its_own_cancel_cant_spend_is_found_before_the_swap_is_signed() {
    type Edit = fn(&mut PlutusData);
    let malformed: [(&str, &str, Edit, &str); 6] = [
        (
            "SundaeSwapV3",
            "a 7th field",
            |d| fields(d).push(int(0)),
            SCRIPT_REFUSED,
        ),
        (
            "SundaeSwapV3",
            "details as Constr 6",
            |d| fields(d)[4] = constr(6, vec![]),
            SCRIPT_REFUSED,
        ),
        (
            "SundaeSwapStable",
            "a 7th field",
            |d| fields(d).push(int(0)),
            SCRIPT_REFUSED,
        ),
        (
            "MinswapV2",
            "a 10th field",
            |d| fields(d).push(int(0)),
            SCRIPT_REFUSED,
        ),
        (
            "MinswapStable",
            "a 7th field",
            |d| fields(d).push(int(0)),
            SCRIPT_REFUSED,
        ),
        (
            "Splash",
            "an Int as bytes",
            |d| fields(d)[8] = bytes(&[0x00]),
            "aren't in the shape the wallet reads",
        ),
    ];
    for (protocol, what, edit, wanted) in malformed {
        let s = Setup::of(&fixture(protocol, "mainnet"));
        let name = format!("{protocol} with {what}");
        let mut d = PlutusData::decode_fragment(&s.datum).unwrap();
        edit(&mut d);
        let datum = d.encode_fragment().unwrap();
        if wanted == SCRIPT_REFUSED {
            // The reader takes it for the session's: only its script can tell.
            let read = orders::read(s.protocol, &datum).unwrap();
            assert!(s.session.owns(&read), "{name}");
        }
        let tx = swap_placing(&s.address, &s.order, &datum, true, None);
        let checks = check_swap(&s, &tx, &[1], &s.references);
        let why = checks[0].why.clone().unwrap_or_default();
        assert!(why.contains(wanted), "{name}: {why}");
        assert!(checks[0].fee.is_none(), "{name}");
        // The same datum re-encoded unchanged checks out: it's the edit the script refuses.
        let same = PlutusData::decode_fragment(&s.datum)
            .unwrap()
            .encode_fragment()
            .unwrap();
        let tx = swap_placing(&s.address, &s.order, &same, true, None);
        assert_eq!(
            check_swap(&s, &tx, &[1], &s.references)[0].why,
            None,
            "{name}"
        );
    }
    // A Plutus V1 order holding its datum inline: the ledger never lets its script spend it.
    for protocol in ["Minswap", "SundaeSwap", "WingRiders"] {
        let s = Setup::of(&fixture(protocol, "mainnet"));
        let tx = swap_placing(&s.address, &s.order, &s.datum, true, None);
        let why = check_swap(&s, &tx, &[1], &s.references)[0]
            .why
            .clone()
            .unwrap_or_default();
        assert!(why.contains("holds its datum inline"), "{protocol}: {why}");
    }
    // An order carrying a script.
    for protocol in ["MinswapV2", "Minswap"] {
        let s = Setup::of(&fixture(protocol, "mainnet"));
        let inline = s.order.inline_datum.is_some();
        let script = hex::decode(SOME_SCRIPT).unwrap();
        let tx = swap_placing(&s.address, &s.order, &s.datum, inline, Some(&script));
        let why = check_swap(&s, &tx, &[1], &s.references)[0]
            .why
            .clone()
            .unwrap_or_default();
        assert!(
            why.contains("carries a reference script"),
            "{protocol}: {why}"
        );
    }
}

/// What isn't an order the swap places can't be checked, and isn't passed:
/// the session's own change, an output the swap doesn't have, and an order
/// whose datum the swap names but doesn't carry. A swap that can't be read is
/// an error.
#[test]
fn what_isnt_an_order_a_swap_places_never_checks_out() {
    let s = Setup::of(&fixture("Minswap", "mainnet"));
    let tx = swap_placing(&s.address, &s.order, &s.datum, false, None);
    let checks = check_swap(&s, &tx, &[0, 1, 7], &[]);
    let whys: Vec<String> = checks
        .iter()
        .map(|c| c.why.clone().unwrap_or_default())
        .collect();
    assert!(whys[0].contains("doesn't sit at a script"), "{whys:?}");
    assert_eq!(checks[0].protocol, None);
    assert_eq!(checks[1].why, None, "{whys:?}");
    assert_eq!(checks[1].protocol, Some(Protocol::Minswap));
    assert!(whys[2].contains("has no output 7"), "{whys:?}");
    // The datum named by hash but not carried.
    let mut bare: Tx = minicbor::decode(&tx).unwrap();
    bare.transaction_witness_set.plutus_data = None;
    let bare = minicbor::to_vec(&bare).unwrap();
    let why = check_swap(&s, &bare, &[1], &[])[0]
        .why
        .clone()
        .unwrap_or_default();
    assert!(why.contains("doesn't carry the datum"), "{why}");
    // Not a transaction at all.
    assert!(
        orders::check_cancels(&orders::SwapCheck {
            params: &s.params,
            network_flag: s.preprod,
            session: s.session,
            address: &s.address,
            tx_cbor: &[0x01, 0x02],
            orders: &[0],
            references: &[],
        })
        .is_err()
    );
}
