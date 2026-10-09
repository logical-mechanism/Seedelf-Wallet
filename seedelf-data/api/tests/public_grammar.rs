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

const POOL: &str = "pool1gaztx97t53k47fr7282d70tje8323vvzx8pshgts30t9krw62tm";
const DREP: &str = "drep1yfzzwr8jznn02mzepvs6y9n4329eskzpgygjdh4ew28szpcd5hr4f";
const ACTION: &str = "gov_action17m7nv7839mw93hv889tqzj0umv9ckm780f0nq02fep78f50uedxqq6g5mt9";

#[tokio::test]
async fn pool_routes() {
    let list = "/api/v1/pool_list?pool_status=eq.registered\
        &select=pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch\
        &order=pool_id_bech32.asc";
    assert_eq!(get(&format!("{list}&offset=0&limit=1000")).await, OK);
    assert_eq!(get(&format!("{list}&offset=2000&limit=1000")).await, OK);
    assert_eq!(get(&format!("{list}&offset=10&limit=1000")).await, BAD);
    assert_eq!(get(&format!("{list}&offset=0&limit=10")).await, BAD);
    assert_eq!(get("/api/v1/pool_list").await, BAD);

    let info = "/api/v1/pool_info?select=pool_id_bech32,meta_json,margin,fixed_cost,pledge,live_pledge,\
        live_stake,live_saturation,live_delegators,block_count,pool_status,retiring_epoch";
    assert_eq!(
        post(info, json!({ "_pool_bech32_ids": [POOL] })).await.0,
        OK
    );
    assert_eq!(
        post(info, json!({ "_pool_bech32_ids": [DREP] })).await.0,
        BAD
    );
    assert_eq!(
        post("/api/v1/pool_info", json!({ "_pool_bech32_ids": [POOL] }))
            .await
            .0,
        BAD
    );
}

#[tokio::test]
async fn governance_routes() {
    let info = "/api/v1/drep_info?select=drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count";
    for drep in [DREP, "drep_always_abstain", "drep_always_no_confidence"] {
        assert_eq!(
            post(info, json!({ "_drep_ids": [drep] })).await.0,
            OK,
            "{drep}"
        );
    }
    let standing = format!("{info},deposit,meta_url,meta_hash");
    assert_eq!(post(&standing, json!({ "_drep_ids": [DREP] })).await.0, OK);
    assert_eq!(
        post(&format!("{info},meta_json"), json!({ "_drep_ids": [DREP] }))
            .await
            .0,
        BAD
    );
    assert_eq!(post(info, json!({ "_drep_ids": [POOL] })).await.0, BAD);

    for select in [
        "drep_id,is_valid,meta_json-%3Ebody-%3EgivenName",
        "drep_id,meta_json-%3Ebody-%3EgivenName",
    ] {
        let path = format!("/api/v1/drep_metadata?select={select}");
        assert_eq!(
            post(&path, json!({ "_drep_ids": [DREP] })).await.0,
            OK,
            "{select}"
        );
    }
    let whole = "/api/v1/drep_metadata?select=drep_id,meta_json";
    assert_eq!(post(whole, json!({ "_drep_ids": [DREP] })).await.0, BAD);

    let proposals = "/api/v1/proposal_list?ratified_epoch=is.null&enacted_epoch=is.null&dropped_epoch=is.null\
        &expired_epoch=is.null&select=proposal_id,proposal_tx_hash,proposal_index,proposal_type,proposed_epoch,\
        expiration,deposit,meta_url,meta_hash,meta_is_valid,title:meta_json-%3Ebody-%3E%3Etitle,\
        abstract:meta_json-%3Ebody-%3E%3Eabstract,block_time,withdrawal&order=proposed_epoch.desc,proposal_id.asc";
    assert_eq!(get(&format!("{proposals}&offset=0&limit=1000")).await, OK);
    assert_eq!(get(&format!("{proposals}&offset=0&limit=100")).await, BAD);

    let votes = format!(
        "/api/v1/vote_list?voter_id=eq.{DREP}&proposal_id=in.({ACTION})&select=proposal_id,vote,block_time&order=block_time.desc"
    );
    assert_eq!(get(&votes).await, OK);
    // Koios matches the voter's CIP-129 ID as text: the same DRep in CIP-105's form isn't the wallet's.
    let (_, bytes) = seedelf_data_api::ids::decode(DREP).unwrap();
    let cip105 = seedelf_data_api::ids::encode("drep", &bytes[1..]);
    assert_eq!(get(&votes.replace(DREP, &cip105)).await, BAD);
    let many = vec![ACTION; 41].join(",");
    assert_eq!(get(&votes.replace(ACTION, &many)).await, BAD);
}

#[tokio::test]
async fn asset_routes() {
    let handle = "/api/v1/asset_nft_address?_asset_policy=f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a\
        &_asset_name=000de14061746c61736d6f6f6e";
    assert_eq!(get(handle).await, OK);
    assert_eq!(get(&handle.replace("_asset_name", "asset_name")).await, BAD);
    let info = "/api/v1/asset_info?select=minting_tx_metadata,cip68_metadata";
    let token = json!([
        "d5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc",
        "537061636542756430"
    ]);
    assert_eq!(post(info, json!({ "_asset_list": [token] })).await.0, OK);
    assert_eq!(
        post(info, json!({ "_asset_list": [token, token] })).await.0,
        BAD
    );
    assert_eq!(
        post(
            "/api/v1/asset_info?select=minting_tx_metadata",
            json!({ "_asset_list": [token] })
        )
        .await
        .0,
        BAD
    );
}
