//! The private index against a scripted Kupo, with db-sync unreachable: a
//! fork under a cursor answers `reset`, and a source that can't answer
//! leaves a 503. Offline: the Kupo here is a few routes on loopback.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{Path, RawQuery, State};
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::constants::{CONTRACT_HASH, SHELLEY_OFFSET};
use seedelf_data_api::cursor::stable_slot;
use seedelf_data_api::kupo::Kupo;
use seedelf_data_api::state::AppState;
use serde_json::{Value, json};
use tower::ServiceExt;

/// A chain of blocks every 20 slots, ending a few seconds ago, and the
/// contract's outputs on it.
struct Script {
    /// Slot to header hash.
    blocks: BTreeMap<i64, String>,
    outputs: Vec<Output>,
}

#[derive(Clone)]
struct Output {
    tx: String,
    created: i64,
    spent: Option<(i64, String)>,
}

impl Script {
    fn tip(&self) -> i64 {
        *self.blocks.keys().next_back().unwrap()
    }

    fn checkpoint(&self, slot: i64) -> Value {
        match self.blocks.range(..=slot).next_back() {
            Some((slot, hash)) => json!({ "slot_no": slot, "header_hash": hash }),
            None => Value::Null,
        }
    }

    /// The blocks after `from` replaced by others: a fork.
    fn fork(&mut self, from: i64) {
        for (slot, hash) in self.blocks.range_mut(from..) {
            *hash = format!("{:064x}", slot + 1);
        }
    }
}

type Shared = Arc<Mutex<Script>>;

fn now_slot() -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    now - SHELLEY_OFFSET
}

fn answer(script: &Script, body: Value) -> Response {
    (
        [("x-most-recent-checkpoint", script.tip().to_string())],
        axum::Json(body),
    )
        .into_response()
}

async fn checkpoints(State(script): State<Shared>) -> Response {
    let script = script.lock().unwrap();
    let tip = script.checkpoint(script.tip());
    answer(&script, json!([tip]))
}

async fn checkpoint(State(script): State<Shared>, Path(slot): Path<i64>) -> Response {
    let script = script.lock().unwrap();
    let point = script.checkpoint(slot);
    answer(&script, point)
}

/// Kupo's filters, inclusive, as the API sends them.
async fn matches(
    State(script): State<Shared>,
    Path((cred, _)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> Response {
    let script = script.lock().unwrap();
    let query = query.unwrap_or_default();
    let flag = |name: &str| query.split('&').any(|part| part == name);
    let bound = |name: &str| {
        query.split('&').find_map(|part| {
            part.strip_prefix(name)?
                .strip_prefix('=')
                .map(|v| v.parse::<i64>().unwrap())
        })
    };
    let list: Vec<Value> = script
        .outputs
        .iter()
        .filter(|_| cred == CONTRACT_HASH)
        .filter(|o| !flag("unspent") || o.spent.is_none())
        .filter(|o| !flag("spent") || o.spent.is_some())
        .filter(|o| bound("created_before").is_none_or(|b| o.created <= b))
        .filter(|o| bound("created_after").is_none_or(|b| o.created >= b))
        .filter(|o| bound("spent_after").is_none_or(|b| o.spent.as_ref().is_some_and(|s| s.0 >= b)))
        .map(|o| {
            json!({
                "transaction_index": 0,
                "transaction_id": o.tx,
                "output_index": 0,
                "address": "addr1wx2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6qxqzvvt",
                "value": { "coins": 1500000 },
                "datum_hash": null,
                "datum": "d87980",
                "datum_type": "inline",
                "script_hash": null,
                "script": null,
                "created_at": script.checkpoint(o.created),
                "spent_at": o.spent.as_ref().map(|(slot, by)| json!({
                    "slot_no": slot,
                    "header_hash": script.blocks[slot],
                    "transaction_id": by,
                    "input_index": 0,
                    "redeemer": "d87980",
                })),
            })
        })
        .collect();
    answer(&script, Value::Array(list))
}

/// The scripted Kupo on a loopback port, and its script.
async fn scripted_kupo() -> (String, Shared) {
    let tip = now_slot() - 5;
    let blocks = (0..60)
        .map(|n| tip - 20 * n)
        .map(|slot| (slot, format!("{slot:064x}")))
        .collect::<BTreeMap<_, _>>();
    let first = *blocks.keys().next().unwrap();
    let outputs = vec![
        // Settled and unspent.
        Output {
            tx: "aa".repeat(32),
            created: first + 20,
            spent: None,
        },
        // Settled, then spent after the cursor.
        Output {
            tx: "bb".repeat(32),
            created: first + 40,
            spent: Some((tip - 20, "dd".repeat(32))),
        },
        // Made after the cursor.
        Output {
            tx: "cc".repeat(32),
            created: tip - 40,
            spent: None,
        },
    ];
    let script = Arc::new(Mutex::new(Script { blocks, outputs }));
    let app = Router::new()
        .route("/checkpoints", get(checkpoints))
        .route("/checkpoints/{slot}", get(checkpoint))
        .route("/matches/{cred}/{*rest}", get(matches))
        .with_state(script.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await });
    (url, script)
}

/// The private routes, with db-sync nowhere and Kupo's tip read once.
async fn app(url: &str) -> (Router, Arc<AppState>) {
    let kupo = Kupo::new(url).unwrap();
    let state = Arc::new(
        AppState::new(Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap())
            .with_kupo(Some(kupo.clone())),
    );
    state.set_kupo_tip(kupo.tip().await.unwrap());
    let router = seedelf_data_api::private::routes().with_state(state.clone());
    (router, state)
}

async fn get_json(app: &Router, path: &str) -> (StatusCode, Value) {
    let request = Request::get(path).body(Body::empty()).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

fn refs(rows: &Value) -> Vec<String> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|r| r["ref"].as_str().unwrap()[..2].to_string())
        .collect()
}

#[tokio::test]
async fn kupo_answers_while_db_sync_is_down_and_a_fork_resets() {
    let (url, script) = scripted_kupo().await;
    let (app, state) = app(&url).await;

    let (status, snapshot) = get_json(&app, "/seedelf/v1/mainnet/contract/snapshot").await;
    assert_eq!(status, StatusCode::OK);
    let tip = script.lock().unwrap().tip();
    let stable = stable_slot(tip);
    let cursor = snapshot["cursor"].as_str().unwrap().to_string();
    assert!(cursor.starts_with(&format!("{stable}.")));
    // Spent after the cursor, so still in the settled view.
    assert_eq!(refs(&snapshot["rows"]), ["aa", "bb"]);
    assert_eq!(snapshot["tip"]["slot"], tip);

    let since = format!("/seedelf/v1/mainnet/contract/since/{cursor}");
    let (status, changes) = get_json(&app, &since).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(refs(&changes["created"]), ["cc"]);
    assert_eq!(changes["spent"][0]["ref"], format!("{}#0", "bb".repeat(32)));
    assert_eq!(changes["spent"][0]["by"], "dd".repeat(32));
    assert!(changes.get("reset").is_none());

    // The cursor's own block is forked away: the wallet starts again.
    script.lock().unwrap().fork(stable - 100);
    state.set_kupo_tip(Kupo::new(&url).unwrap().tip().await.unwrap());
    let (status, reset) = get_json(&app, &since).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reset["reset"], true);
    assert_ne!(reset["cursor"].as_str().unwrap(), cursor);
}

#[tokio::test]
async fn with_no_source_fresh_the_private_index_is_behind() {
    let (url, _) = scripted_kupo().await;
    let (app, state) = app(&url).await;
    // A cursor ahead of every source's tip: no one can say what's after it.
    let ahead = format!(
        "/seedelf/v1/mainnet/contract/since/{}.{}",
        stable_slot(now_slot()) + 2_000,
        "00".repeat(32)
    );
    assert_eq!(
        get_json(&app, &ahead).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );

    // Kupo's tip an hour old: nothing answers.
    state.set_kupo_tip(seedelf_data_api::chain::Block {
        slot: now_slot() - 3_600,
        hash: "00".repeat(32),
    });
    let (status, body) = get_json(&app, "/seedelf/v1/mainnet/names").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "behind");
}
