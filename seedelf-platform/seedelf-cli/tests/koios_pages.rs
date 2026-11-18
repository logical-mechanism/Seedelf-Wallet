//! How seedelf-koios reads Koios in pages. Koios answers at most 1,000 rows a
//! request, and what it answers changes between requests: a block can spend a
//! UTxO, or add a transaction, in between. Read at `?offset=N`, a UTxO spent
//! ahead of a page's edge moved every later row up by one, so the row at the
//! edge was never read; a transaction added ahead moved them down, so one was
//! read twice (chunk 51, r1#1). These read pages after the last row of the one
//! before, as the web wallet's koios.ts `paged` does, and keep each row once.
//!
//! The mock stands in for Koios's PostgREST: at most 1,000 rows a request,
//! with `offset`, `limit`, `order` and the `or=`/`and=` filters on `tx_hash`,
//! `tx_index` and `block_height`, and with no `order` the rows in the order
//! they were added. Here, not in seedelf-koios, since its HTTP calls need the
//! runtime and the mock server this crate's tests have.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use seedelf_core::address::wallet_contract;
use seedelf_core::constants::get_config;
use seedelf_core::utxos::{assets_of, collect_all_wallet_utxos, get_credential_utxos};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{address_utxos, credential_transactions, override_endpoints};
use serde_json::{Value, json};
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

/// Koios's max-rows.
const MAX_ROWS: usize = 1000;
const PREPROD: bool = true;

/// A distinct 32-byte transaction hash for row `i` (splitmix64), so the order
/// the rows were added in isn't their hash order.
fn hash_of(i: u64) -> String {
    (1..=4u64)
        .map(|k| {
            let mut z = i.wrapping_add(k.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            format!("{:016x}", z ^ (z >> 31))
        })
        .collect()
}

/// A UTxO as Koios's `credential_utxos` and `address_utxos` list it.
fn row(tx_hash: &str, register: &Register, lovelace: u64, cred: &str, address: &str) -> Value {
    json!({
        "tx_hash": tx_hash,
        "tx_index": 0,
        "address": address,
        "value": lovelace.to_string(),
        "stake_address": null,
        "payment_cred": cred,
        "epoch_no": 290,
        "block_height": 3_000_000,
        "block_time": 1_700_000_000,
        "datum_hash": null,
        "inline_datum": {"bytes": hex::encode(register.to_vec().expect("register cbor")), "value": null},
        "reference_script": null,
        "asset_list": [],
        "is_spent": false
    })
}

/// A PostgREST condition on a row.
enum Cond {
    Cmp(String, String, String),
    Any(Vec<Cond>),
    All(Vec<Cond>),
}

fn cmp_of(col: &str, op_value: &str) -> Result<Cond, String> {
    let (op, value) = op_value
        .split_once('.')
        .ok_or_else(|| format!("unreadable filter {col}={op_value}"))?;
    if !["tx_hash", "tx_index", "block_height"].contains(&col) {
        return Err(format!("the mock doesn't filter on {col}"));
    }
    if !["eq", "neq", "gt", "gte", "lt", "lte"].contains(&op) {
        return Err(format!("the mock doesn't know the operator {op}"));
    }
    Ok(Cond::Cmp(col.into(), op.into(), value.into()))
}

/// `(a,b,…)` of a logic tree, each `col.op.value`, `or(…)` or `and(…)`.
fn tree_of(all: bool, list: &str) -> Result<Cond, String> {
    let inner = list
        .strip_prefix('(')
        .and_then(|s| s.strip_suffix(')'))
        .ok_or_else(|| format!("unreadable logic tree {list}"))?;
    let (mut items, mut depth, mut start) = (Vec::new(), 0, 0);
    for (i, c) in inner.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                items.push(&inner[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    items.push(&inner[start..]);
    let conds = items
        .into_iter()
        .map(|item| {
            if let Some(rest) = item.strip_prefix("or") {
                tree_of(false, rest)
            } else if let Some(rest) = item.strip_prefix("and") {
                tree_of(true, rest)
            } else {
                let (col, op_value) = item
                    .split_once('.')
                    .ok_or_else(|| format!("unreadable condition {item}"))?;
                cmp_of(col, op_value)
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(if all {
        Cond::All(conds)
    } else {
        Cond::Any(conds)
    })
}

fn order_of(a: &Value, b: &Value, col: &str) -> std::cmp::Ordering {
    match col {
        "tx_hash" => a[col].as_str().cmp(&b[col].as_str()),
        _ => a[col].as_u64().cmp(&b[col].as_u64()),
    }
}

fn holds(cond: &Cond, row: &Value) -> Result<bool, String> {
    Ok(match cond {
        Cond::Any(conds) => conds
            .iter()
            .map(|c| holds(c, row))
            .collect::<Result<Vec<_>, _>>()?
            .contains(&true),
        Cond::All(conds) => !conds
            .iter()
            .map(|c| holds(c, row))
            .collect::<Result<Vec<_>, _>>()?
            .contains(&false),
        Cond::Cmp(col, op, value) => {
            let ord = if col == "tx_hash" {
                row[col.as_str()]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(value.as_str())
            } else {
                let n: u64 = value
                    .parse()
                    .map_err(|_| format!("{col} isn't compared with a number: {value}"))?;
                row[col.as_str()].as_u64().unwrap_or_default().cmp(&n)
            };
            match op.as_str() {
                "eq" => ord.is_eq(),
                "neq" => ord.is_ne(),
                "gt" => ord.is_gt(),
                "gte" => ord.is_ge(),
                "lt" => ord.is_lt(),
                _ => ord.is_le(),
            }
        }
    })
}

/// What PostgREST answers for `request` over `rows`, in the order they were added.
fn page(rows: &[&Value], request: &Request) -> Result<Vec<Value>, String> {
    let (mut offset, mut limit) = (0usize, MAX_ROWS);
    let mut order: Vec<(String, bool)> = Vec::new();
    let mut conds: Vec<Cond> = Vec::new();
    for (key, value) in request.url.query_pairs() {
        match key.as_ref() {
            "offset" => offset = value.parse().map_err(|_| format!("bad offset {value}"))?,
            "limit" => limit = limit.min(value.parse().map_err(|_| format!("bad limit {value}"))?),
            "select" => {}
            "order" => {
                order = value
                    .split(',')
                    .map(|term| {
                        let mut parts = term.split('.');
                        let col = parts.next().unwrap_or_default().to_string();
                        (col, parts.next() == Some("desc"))
                    })
                    .collect()
            }
            "or" => conds.push(tree_of(false, &value)?),
            "and" => conds.push(tree_of(true, &value)?),
            col => conds.push(cmp_of(col, &value)?),
        }
    }
    let mut kept: Vec<&Value> = Vec::new();
    for row in rows {
        if conds
            .iter()
            .map(|c| holds(c, row))
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .all(|h| *h)
        {
            kept.push(row);
        }
    }
    kept.sort_by(|a, b| {
        order
            .iter()
            .fold(std::cmp::Ordering::Equal, |acc, (col, desc)| {
                acc.then_with(|| {
                    let ord = order_of(a, b, col);
                    if *desc { ord.reverse() } else { ord }
                })
            })
    });
    Ok(kept.into_iter().skip(offset).take(limit).cloned().collect())
}

/// Koios over a set of UTxOs asked for by `asked` (the body's one field):
/// `spent` leaves the set once the first request is answered.
struct Utxos {
    asked: (&'static str, Value),
    rows: Vec<Value>,
    spent: String,
    answered: AtomicUsize,
}

impl Respond for Utxos {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        if body[self.asked.0] != self.asked.1 {
            return ResponseTemplate::new(400).set_body_string("not the rows asked for");
        }
        let after_block = self.answered.fetch_add(1, Ordering::SeqCst) > 0;
        let live: Vec<&Value> = self
            .rows
            .iter()
            .filter(|r| !after_block || r["tx_hash"] != self.spent.as_str())
            .collect();
        match page(&live, request) {
            Ok(rows) => ResponseTemplate::new(200).set_body_json(rows),
            Err(why) => ResponseTemplate::new(400).set_body_string(why),
        }
    }
}

/// Every outpoint in `read`, with how many times it was read.
fn counted<'a>(read: impl Iterator<Item = (&'a str, u64)>) -> BTreeMap<String, usize> {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for (tx_hash, tx_index) in read {
        *seen.entry(format!("{tx_hash}#{tx_index}")).or_default() += 1;
    }
    seen
}

fn outpoint(r: &Value) -> String {
    format!("{}#{}", r["tx_hash"].as_str().unwrap(), r["tx_index"])
}

/// What the client asked for, each request's query cut short.
async fn asked(server: &MockServer) -> Vec<String> {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .iter()
        .map(|r| r.url.query().unwrap_or_default().chars().take(60).collect())
        .collect()
}

/// The balance the CLI reads from the contract (balance.rs) is whole when a
/// block spends another user's UTxO from the first page between the first
/// and second requests. The wallet's one UTxO, 25 ADA, is the first row of
/// the second page: read by offset, it was never read.
#[tokio::test]
#[serial]
async fn a_utxo_spent_between_two_pages_hides_no_other_utxo() {
    let config = get_config(1, PREPROD).expect("variant 1 config");
    let cred = hex::encode(config.contract.wallet_contract_hash);
    let address = wallet_contract(PREPROD, config.contract.wallet_contract_hash)
        .to_bech32()
        .expect("contract bech32");

    let user = random_scalar();
    let mine = Register::create(user)
        .and_then(Register::rerandomize)
        .expect("register");
    let theirs = Register::create(random_scalar())
        .and_then(Register::rerandomize)
        .expect("register");

    // 1,200 UTxOs at the contract, in the order they were added. The wallet's
    // one UTxO, 25 ADA, is the 1,001st: the first of the second page.
    const WALLET_AT: usize = 1000;
    const SPENT_AT: usize = 400;
    let rows: Vec<Value> = (0..1200u64)
        .map(|i| {
            let (register, lovelace) = if i as usize == WALLET_AT {
                (&mine, 25_000_000)
            } else {
                (&theirs, 2_000_000)
            };
            row(&hash_of(i), register, lovelace, &cred, &address)
        })
        .collect();
    let wallet_utxo = outpoint(&rows[WALLET_AT]);
    let spent = rows[SPENT_AT]["tx_hash"].as_str().unwrap().to_string();

    let server = MockServer::start().await;
    override_endpoints(Some(server.uri()), None);
    Mock::given(method("POST"))
        .and(path("/api/v1/credential_utxos"))
        .respond_with(Utxos {
            asked: ("_payment_credentials", json!([cred])),
            rows: rows.clone(),
            spent: spent.clone(),
            answered: Default::default(),
        })
        .mount(&server)
        .await;

    // What balance.rs reads and sums.
    let read = get_credential_utxos(config.contract.wallet_contract_hash, PREPROD)
        .await
        .expect("the contract's UTxOs");
    override_endpoints(None, None);
    let owned = collect_all_wallet_utxos(user, &config.contract.seedelf_policy_id, read.clone())
        .expect("owned UTxOs");
    let (lovelace, _) = assets_of(owned).expect("balance");

    let seen = counted(read.iter().map(|u| (u.tx_hash.as_str(), u.tx_index)));
    // Every UTxO at the contract for the whole read, each once.
    let missing: Vec<String> = rows
        .iter()
        .filter(|r| r["tx_hash"] != spent.as_str())
        .map(outpoint)
        .filter(|o| !seen.contains_key(o))
        .collect();
    let repeated: Vec<&String> = seen
        .iter()
        .filter(|(_, n)| **n > 1)
        .map(|(o, _)| o)
        .collect();
    assert!(
        missing.is_empty() && repeated.is_empty() && lovelace == 25_000_000,
        "a block spent {spent}#0 between the first and second requests ({:?}): \
         the read of {} rows missed {missing:?} (the wallet's 25 ADA UTxO is {wallet_utxo}) \
         and repeated {repeated:?}, so the CLI's balance is {lovelace} lovelace, not 25000000",
        asked(&server).await,
        read.len()
    );
}

/// An address's UTxOs are read the same way (`external sweep`, `fund`,
/// `create`, `util extract`): before, one request with no order took
/// whichever 1,000 Koios gave.
#[tokio::test]
#[serial]
async fn an_address_is_read_whole_in_pages_too() {
    let config = get_config(1, PREPROD).expect("variant 1 config");
    let address = wallet_contract(PREPROD, config.contract.wallet_contract_hash)
        .to_bech32()
        .expect("contract bech32");
    let address = address.as_str();
    let register = Register::create(random_scalar()).expect("register");
    let rows: Vec<Value> = (0..2500u64)
        .map(|i| row(&hash_of(i), &register, 1_000_000 + i, "", address))
        .collect();
    let spent = rows[1500]["tx_hash"].as_str().unwrap().to_string();

    let server = MockServer::start().await;
    override_endpoints(Some(server.uri()), None);
    Mock::given(method("POST"))
        .and(path("/api/v1/address_utxos"))
        .respond_with(Utxos {
            asked: ("_addresses", json!([address])),
            rows: rows.clone(),
            spent: spent.clone(),
            answered: Default::default(),
        })
        .mount(&server)
        .await;
    let read = address_utxos(address, PREPROD)
        .await
        .expect("the address's UTxOs");
    override_endpoints(None, None);

    let seen = counted(read.iter().map(|u| (u.tx_hash.as_str(), u.tx_index)));
    let missing = rows
        .iter()
        .filter(|r| r["tx_hash"] != spent.as_str())
        .filter(|r| !seen.contains_key(&outpoint(r)))
        .count();
    let repeated = seen.values().filter(|n| **n > 1).count();
    assert!(
        missing == 0 && repeated == 0,
        "of 2,500 UTxOs at the address, one spent between requests ({:?}), the read \
         of {} missed {missing} and repeated {repeated}",
        asked(&server).await,
        read.len()
    );
}

/// Koios's `credential_txs` over a history kept newest first, which gains a
/// transaction at the top once the first request is answered.
struct History {
    txs: Mutex<Vec<Value>>,
    landed: Value,
    answered: AtomicUsize,
}

impl Respond for History {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let mut txs = self.txs.lock().expect("history lock");
        if self.answered.fetch_add(1, Ordering::SeqCst) == 1 {
            txs.insert(0, self.landed.clone());
        }
        let rows: Vec<&Value> = txs.iter().collect();
        match page(&rows, request) {
            Ok(rows) => ResponseTemplate::new(200).set_body_json(rows),
            Err(why) => ResponseTemplate::new(400).set_body_string(why),
        }
    }
}

/// `tx_info` for the hashes asked for, with no inputs or outputs.
struct TxInfo;

impl Respond for TxInfo {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
        let txs: Vec<Value> = body["_tx_hashes"]
            .as_array()
            .map(|hashes| {
                hashes
                    .iter()
                    .map(|h| json!({"tx_hash": h, "block_height": 7, "inputs": [], "outputs": []}))
                    .collect()
            })
            .unwrap_or_default();
        ResponseTemplate::new(200).set_body_json(txs)
    }
}

/// `util history` lists each transaction once when one lands at the contract
/// between two of its pages, which moves the rest down one. It reads them 65
/// at a time, newest first, in a fixed order.
#[tokio::test]
#[serial]
async fn a_transaction_landing_between_two_history_pages_is_listed_once() {
    let history = |i: u64, height: u64| json!({"tx_hash": hash_of(i), "epoch_no": 290, "block_height": height, "block_time": 1_700_000_000});
    // 100 transactions, newest first, each in a block of its own.
    let txs: Vec<Value> = (0..100u64).map(|i| history(i, 5_000_000 - i)).collect();
    let server = MockServer::start().await;
    override_endpoints(Some(server.uri()), None);
    Mock::given(method("POST"))
        .and(path("/api/v1/credential_txs"))
        .respond_with(History {
            txs: Mutex::new(txs.clone()),
            landed: history(1_000, 5_000_001),
            answered: Default::default(),
        })
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/tx_info"))
        .respond_with(TxInfo)
        .mount(&server)
        .await;

    let listed = credential_transactions(PREPROD, &"ab".repeat(28))
        .await
        .expect("the history");
    override_endpoints(None, None);

    let seen = counted(listed.iter().map(|tx| (tx.tx_hash.as_str(), 0)));
    let repeated: Vec<&String> = seen
        .iter()
        .filter(|(_, n)| **n > 1)
        .map(|(t, _)| t)
        .collect();
    let missing = txs
        .iter()
        .filter(|t| !seen.contains_key(&format!("{}#0", t["tx_hash"].as_str().unwrap())))
        .count();
    assert!(
        repeated.is_empty() && missing == 0,
        "a transaction landed between the first and second requests ({:?}): of 100 \
         transactions the history missed {missing} and repeated {repeated:?}",
        asked(&server).await
    );
}
