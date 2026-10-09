//! The public routes against the real db-sync, through `seedelf-data/.env`.
//! Ignored by default: `cargo test -- --ignored`. What's on chain moves, so
//! each test checks what must hold whatever it does: routes agree with each
//! other and with the private index, and transactions balance.

use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use seedelf_data_api::chain::Chain;
use seedelf_data_api::constants::{CONTRACT_HASH, MIXBOX_HASH, bytes};
use seedelf_data_api::state::AppState;
use serde_json::{Value, json};
use tower::ServiceExt;

/// The Seedelf contract's first transaction (block 11,305,805): its outputs are long spent.
const FIRST: &str = "1e491b15714b141f1bc8cbd3d5a4a801d5066ddd66d3d922492106790b506507";
const PAGE: &str = "order=tx_hash.asc,tx_index.asc&limit=1000";

fn chain() -> Chain {
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env"));
    Chain::connect(&std::env::var("MAINNET_DATABASE_URL").expect("seedelf-data/.env")).unwrap()
}

/// The public routes, with the tip read once.
async fn app() -> (Router, Chain) {
    let chain = chain();
    let state = AppState::new(chain.clone());
    state.set_tip(chain.tip().await.unwrap());
    let router = Router::new()
        .merge(seedelf_data_api::public::routes())
        .with_state(Arc::new(state));
    (router, chain)
}

async fn post(app: &Router, path: &str, body: Value) -> Value {
    let request = Request::post(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 64 << 20).await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "{path}: {}",
        String::from_utf8_lossy(&body)
    );
    serde_json::from_slice(&body).unwrap()
}

fn outpoints(rows: &Value) -> BTreeSet<String> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|r| format!("{}#{}", r["tx_hash"].as_str().unwrap(), r["tx_index"]))
        .collect()
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn the_contracts_listing_is_the_private_index() {
    let (app, chain) = app().await;
    for cred in [CONTRACT_HASH, MIXBOX_HASH] {
        // A block can land between the two reads, so they get three tries to agree.
        let mut agreed = false;
        for _ in 0..3 {
            let body = json!({ "_payment_credentials": [cred], "_extended": true });
            let listed = post(&app, &format!("/api/v1/credential_utxos?{PAGE}"), body).await;
            let rows = listed.as_array().unwrap();
            assert!(
                rows.iter()
                    .all(|r| r["payment_cred"] == cred && r["is_spent"] == false)
            );
            assert!(rows.iter().all(|r| r["inline_datum"]["bytes"].is_string()));
            let unspent: BTreeSet<String> = chain
                .unspent_now(&bytes(cred), false)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.reference)
                .collect();
            if outpoints(&listed) == unspent {
                agreed = true;
                break;
            }
        }
        assert!(
            agreed,
            "{cred}: the public listing and the private index differ"
        );
    }
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn a_page_after_any_outpoint_is_the_rest() {
    let (app, _) = app().await;
    let body = json!({ "_payment_credentials": [CONTRACT_HASH], "_extended": true });
    let all = post(
        &app,
        &format!("/api/v1/credential_utxos?{PAGE}"),
        body.clone(),
    )
    .await;
    let keys: Vec<(String, u64)> = all
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["tx_hash"].as_str().unwrap().to_string(),
                r["tx_index"].as_u64().unwrap(),
            )
        })
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted, "ordered by outpoint");
    let (hash, index) = &keys[keys.len() / 2];
    let path = format!(
        "/api/v1/credential_utxos?or=(tx_hash.gt.{hash},and(tx_hash.eq.{hash},tx_index.gt.{index}))&{PAGE}"
    );
    let rest = post(&app, &path, body).await;
    let rest: Vec<String> = outpoints(&rest).into_iter().collect();
    let expected: Vec<String> = keys[keys.len() / 2 + 1..]
        .iter()
        .map(|(h, i)| format!("{h}#{i}"))
        .collect();
    assert_eq!(rest, expected);
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn utxo_info_tells_spent_from_unspent() {
    let (app, _) = app().await;
    let body = json!({ "_payment_credentials": [CONTRACT_HASH], "_extended": true });
    let unspent = post(&app, &format!("/api/v1/credential_utxos?{PAGE}"), body).await;
    let mut refs: Vec<String> = outpoints(&unspent).into_iter().take(5).collect();
    refs.push(format!("{FIRST}#0"));
    let rows = post(
        &app,
        "/api/v1/utxo_info",
        json!({ "_utxo_refs": refs, "_extended": true }),
    )
    .await;
    for row in rows.as_array().unwrap() {
        let spent = row["tx_hash"] == FIRST;
        assert_eq!(row["is_spent"], spent, "{row}");
    }
    assert_eq!(rows.as_array().unwrap().len(), 6);
}

/// Lovelace as a number, from Koios's text.
fn ada(value: &Value) -> i128 {
    value.as_str().unwrap().parse().unwrap()
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn every_transaction_balances() {
    let (app, _) = app().await;
    // An account with a long, busy history, and the contract's transactions.
    let stake = "stake1uxkjkwuygxqf24wacumm8ph2nlhp9e0ahv37fshdr060cyc36wvr9";
    let page = "/api/v1/account_txs?order=block_height.desc,tx_hash.asc&offset=0&limit=20";
    let txs = post(&app, page, json!({ "_stake_address": stake })).await;
    let mut hashes: Vec<String> = txs
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["tx_hash"].as_str().unwrap().to_string())
        .collect();
    hashes.truncate(19);
    hashes.push(FIRST.into());
    let full = json!({
        "_tx_hashes": hashes, "_inputs": true, "_metadata": true, "_assets": true,
        "_withdrawals": true, "_certs": true, "_scripts": false, "_bytecode": false, "_governance": true,
    });
    let infos = post(&app, "/api/v1/tx_info", full).await;
    assert_eq!(infos.as_array().unwrap().len(), hashes.len());
    for tx in infos.as_array().unwrap() {
        if tx["valid_contract"] == false {
            continue;
        }
        let sum = |list: &Value, key: &str| {
            list.as_array()
                .unwrap()
                .iter()
                .map(|x| ada(&x[key]))
                .sum::<i128>()
        };
        let inputs = sum(&tx["inputs"], "value");
        let withdrawn = sum(&tx["withdrawals"], "amount");
        let outputs = sum(&tx["outputs"], "value");
        // db-sync's `deposit` is what certificates paid in, less what they gave back.
        let deposit: i128 = tx["deposit"].as_str().map_or(0, |d| d.parse().unwrap());
        assert_eq!(
            inputs + withdrawn,
            outputs + ada(&tx["fee"]) + deposit + ada(&tx["treasury_donation"]),
            "{}",
            tx["tx_hash"]
        );
        assert_eq!(ada(&tx["total_output"]), outputs);
    }

    // The spends-only shape names the same inputs.
    let spends = json!({
        "_tx_hashes": hashes, "_inputs": true, "_metadata": false, "_assets": false,
        "_withdrawals": false, "_certs": false, "_scripts": false, "_bytecode": false,
    });
    let spent = post(&app, "/api/v1/tx_info", spends).await;
    let inputs = |rows: &Value| -> HashSet<String> {
        rows.as_array()
            .unwrap()
            .iter()
            .flat_map(|t| t["inputs"].as_array().unwrap().clone())
            .map(|i| format!("{}#{}", i["tx_hash"].as_str().unwrap(), i["tx_index"]))
            .collect()
    };
    assert_eq!(inputs(&infos), inputs(&spent));
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn an_accounts_addresses_hold_its_outputs() {
    let (app, _) = app().await;
    let stake = "stake1uxkjkwuygxqf24wacumm8ph2nlhp9e0ahv37fshdr060cyc36wvr9";
    let rows = post(
        &app,
        "/api/v1/account_addresses",
        json!({ "_stake_addresses": [stake], "_empty": true }),
    )
    .await;
    let addresses: HashSet<String> = rows[0]["addresses"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_string())
        .collect();
    let info = post(
        &app,
        "/api/v1/account_info",
        json!({ "_stake_addresses": [stake] }),
    )
    .await;
    assert_eq!(info[0]["stake_address"], stake);
    // Every output paid under the key sits at one of its addresses.
    let page = "/api/v1/account_txs?order=block_height.desc,tx_hash.asc&offset=0&limit=20";
    let txs = post(&app, page, json!({ "_stake_address": stake })).await;
    let hashes: Vec<&str> = txs
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["tx_hash"].as_str().unwrap())
        .collect();
    let spends = json!({
        "_tx_hashes": hashes, "_inputs": true, "_metadata": false, "_assets": false,
        "_withdrawals": false, "_certs": false, "_scripts": false, "_bytecode": false,
    });
    let infos = post(&app, "/api/v1/tx_info", spends).await;
    for tx in infos.as_array().unwrap() {
        let touches = tx["inputs"]
            .as_array()
            .unwrap()
            .iter()
            .chain(tx["outputs"].as_array().unwrap())
            .any(|o| addresses.contains(o["payment_addr"]["bech32"].as_str().unwrap()));
        assert!(
            touches,
            "{} touches none of the account's addresses",
            tx["tx_hash"]
        );
    }
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn a_transactions_status_counts_the_blocks_since() {
    let (app, chain) = app().await;
    let rows = post(
        &app,
        "/api/v1/tx_status",
        json!({ "_tx_hashes": [FIRST, "00".repeat(32)] }),
    )
    .await;
    let tip = chain.tip().await.unwrap();
    let confirmations = rows[0]["num_confirmations"].as_i64().unwrap();
    assert!(
        (tip.height - 11_305_805 - confirmations).abs() <= 2,
        "{confirmations}"
    );
    assert!(rows[1]["num_confirmations"].is_null());
}
