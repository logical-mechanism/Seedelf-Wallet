//! Offline: every public route takes the wallet's own requests (they get as
//! far as the database, which isn't here, so 503) and refuses anything else
//! with a 400, before it reaches the database.

use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use seedelf_data_api::chain::Chain;
use seedelf_data_api::state::AppState;
use serde_json::{Value, json};
use tower::ServiceExt;

const CONTRACT: &str = "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469";
const TX: &str = "1e491b15714b141f1bc8cbd3d5a4a801d5066ddd66d3d922492106790b506507";
const STAKE: &str = "stake1u9c0yhlklkdd7vcwkvv2cjrgnw48y82jmm2ulk3vxe2qupsv2va8g";
const ADDRESS: &str = "addr1wx2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6g9nk02v";
const PAGE: &str = "order=tx_hash.asc,tx_index.asc&limit=1000";

fn app() -> Router {
    // Nothing listens there: no tip is ever read, so a request that gets past its grammar is a 503.
    let chain = Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap();
    Router::new()
        .merge(seedelf_data_api::public::routes())
        .with_state(Arc::new(AppState::new(chain)))
}

async fn get(path: &str) -> StatusCode {
    let request = Request::get(path).body(Body::empty()).unwrap();
    app().oneshot(request).await.unwrap().status()
}

async fn post(path: &str, body: Value) -> (StatusCode, String) {
    let request = Request::post(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

/// Past the grammar: the database is all that's missing.
const OK: StatusCode = StatusCode::SERVICE_UNAVAILABLE;
const BAD: StatusCode = StatusCode::BAD_REQUEST;

#[tokio::test]
async fn utxo_routes() {
    let creds = json!({ "_payment_credentials": [CONTRACT], "_extended": true });
    let path = format!("/api/v1/credential_utxos?{PAGE}");
    assert_eq!(post(&path, creds.clone()).await.0, OK);
    let after = format!(
        "/api/v1/credential_utxos?block_height=gt.11305804&or=(tx_hash.gt.{TX},and(tx_hash.eq.{TX},tx_index.gt.0))&{PAGE}"
    );
    assert_eq!(post(&after, creds.clone()).await.0, OK);
    for (path, body) in [
        (
            path.clone(),
            json!({ "_payment_credentials": [CONTRACT], "_extended": false }),
        ),
        (path.clone(), json!({ "_payment_credentials": [CONTRACT] })),
        (
            path.clone(),
            json!({ "_payment_credentials": [], "_extended": true }),
        ),
        (
            path.clone(),
            json!({ "_payment_credentials": ["zz"], "_extended": true }),
        ),
        (
            path.clone(),
            json!({ "_payment_credentials": vec![CONTRACT; 2], "_extended": true }),
        ),
        ("/api/v1/credential_utxos".into(), creds.clone()),
        (format!("{path}&offset=1000"), creds.clone()),
    ] {
        assert_eq!(post(&path, body.clone()).await.0, BAD, "{path} {body}");
    }

    let addresses = json!({ "_addresses": [ADDRESS], "_extended": true });
    assert_eq!(
        post(&format!("/api/v1/address_utxos?{PAGE}"), addresses.clone())
            .await
            .0,
        OK
    );
    // The same script's preprod address.
    let (_, bytes) = seedelf_data_api::ids::decode(ADDRESS).unwrap();
    let preprod = seedelf_data_api::ids::encode("addr_test", &[&[0x70], &bytes[1..]].concat());
    let testnet = json!({ "_addresses": [preprod], "_extended": true });
    assert_eq!(
        post(&format!("/api/v1/address_utxos?{PAGE}"), testnet)
            .await
            .0,
        BAD
    );

    let refs = json!({ "_utxo_refs": [format!("{TX}#0")], "_extended": true });
    assert_eq!(post("/api/v1/utxo_info", refs).await.0, OK);
    let bad = json!({ "_utxo_refs": [format!("{TX}#x")], "_extended": true });
    assert_eq!(post("/api/v1/utxo_info", bad).await.0, BAD);
    assert_eq!(
        post("/api/v1/datum_info", json!({ "_datum_hashes": [TX] }))
            .await
            .0,
        OK
    );
}

#[tokio::test]
async fn ledger_routes() {
    assert_eq!(get("/api/v1/tip").await, OK);
    assert_eq!(get("/api/v1/tip?limit=1").await, BAD);
    assert_eq!(get("/api/v1/epoch_params?limit=1").await, OK);
    assert_eq!(get("/api/v1/epoch_params").await, BAD);
    assert_eq!(get("/api/v1/epoch_params?_epoch_no=500").await, BAD);
    assert_eq!(
        get("/api/v1/totals?select=epoch_no,supply&order=epoch_no.desc&limit=1").await,
        OK
    );
    assert_eq!(get("/api/v1/totals").await, BAD);
    assert_eq!(
        post("/api/v1/tx_status", json!({ "_tx_hashes": [TX] }))
            .await
            .0,
        OK
    );
    let many: Vec<String> = (0..101).map(|i| format!("{i:064x}")).collect();
    assert_eq!(
        post("/api/v1/tx_status", json!({ "_tx_hashes": many }))
            .await
            .0,
        BAD
    );
}

#[tokio::test]
async fn account_routes() {
    let keys = json!({ "_stake_addresses": [STAKE], "_empty": true });
    assert_eq!(post("/api/v1/account_addresses", keys).await.0, OK);
    let unused = json!({ "_stake_addresses": [STAKE], "_empty": false });
    assert_eq!(post("/api/v1/account_addresses", unused).await.0, BAD);
    assert_eq!(
        post(
            "/api/v1/account_info",
            json!({ "_stake_addresses": [STAKE] })
        )
        .await
        .0,
        OK
    );
    assert_eq!(
        post(
            "/api/v1/account_info",
            json!({ "_stake_addresses": ["stake1"] })
        )
        .await
        .0,
        BAD
    );

    let page = "/api/v1/account_txs?order=block_height.desc,tx_hash.asc&offset=0&limit=20";
    assert_eq!(post(page, json!({ "_stake_address": STAKE })).await.0, OK);
    let since = "/api/v1/account_txs?order=block_height.desc,tx_hash.asc&limit=1000";
    let after = json!({ "_stake_address": STAKE, "_after_block_height": 14000000 });
    assert_eq!(post(since, after.clone()).await.0, OK);
    // A page is 20; "since" takes no offset and gives up to 1,000.
    assert_eq!(post(since, json!({ "_stake_address": STAKE })).await.0, BAD);
    assert_eq!(post(page, after).await.0, BAD);
    let wide = "/api/v1/account_txs?order=block_height.desc,tx_hash.asc&offset=0&limit=1000";
    assert_eq!(post(wide, json!({ "_stake_address": STAKE })).await.0, BAD);
}

#[tokio::test]
async fn tx_info_takes_the_wallets_two_shapes() {
    let activity = json!({
        "_tx_hashes": [TX], "_inputs": true, "_metadata": true, "_assets": true,
        "_withdrawals": true, "_certs": true, "_scripts": false, "_bytecode": false, "_governance": true,
    });
    assert_eq!(post("/api/v1/tx_info", activity.clone()).await.0, OK);
    let spends = json!({
        "_tx_hashes": [TX], "_inputs": true, "_metadata": false, "_assets": false,
        "_withdrawals": false, "_certs": false, "_scripts": false, "_bytecode": false,
    });
    assert_eq!(post("/api/v1/tx_info", spends).await.0, OK);
    let mut scripts = activity.clone();
    scripts["_scripts"] = json!(true);
    assert_eq!(post("/api/v1/tx_info", scripts).await.0, BAD);
    let mut many = activity;
    many["_tx_hashes"] = json!((0..21).map(|i| format!("{i:064x}")).collect::<Vec<_>>());
    assert_eq!(post("/api/v1/tx_info", many).await.0, BAD);
}

#[tokio::test]
async fn a_refusal_says_why_and_nothing_of_the_request() {
    let (status, body) = post("/api/v1/tx_status", json!({ "_tx_hashes": ["secret"] })).await;
    assert_eq!(status, BAD);
    assert_eq!(body, r#"{"error":"not a request Seedelf Wallet makes"}"#);
}
