//! §21.7's check 8 through the whole app, offline (chunk 55's call 6): a
//! certificate is listed only for its Seedelf's register now.
//!
//! - **Preprod** reads a Koios on loopback, which a test fills and slows:
//!   the register now is kept, any other is a 409, a chain that can't be
//!   read is a 503 and nothing is kept, the check comes after the proof,
//!   answers are kept a minute, at most four requests go at once, and
//!   nothing is checked again once listed.
//! - **Mainnet** reads the private index's names answer, here made from a
//!   scripted Kupo with db-sync unreachable: its register is kept, a move
//!   leaves a removal entry at the next sweep, and a withdrawn digest goes
//!   with its register.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{ConnectInfo, RawQuery, State};
use axum::http::{Method, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use seedelf_data_api::chain::{Block, Chain};
use seedelf_data_api::constants::{CONTRACT_HASH, SEEDELF_POLICY, SHELLEY_OFFSET};
use seedelf_data_api::edge::{Edge, Egress, Stopped};
use seedelf_data_api::kupo::Kupo;
use seedelf_data_api::messaging::certificate::{listing_digest, unlisting_digest};
use seedelf_data_api::messaging::check::stamp_bits;
use seedelf_data_api::messaging::list::seedelf_key;
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::view::{Budget, KOIOS_DEADLINE, KOIOS_KEPT, Koios, View};
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, POOLS, Relay, Round};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::{Value, json};
use tower::ServiceExt;

mod common;
use common::{KoiosMock, Made, contract_row, datum};

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";

const CHEAP: Prices = Prices {
    base: 1,
    per_bit: 1e9,
    quiet: 1e12,
    ceiling: 24,
    half_life: Duration::from_secs(600),
};

const WINDOW: Limits = Limits {
    envelopes: 1000,
    units: 4096,
};

static CHEAP_POOLS: [Config; 2] = [
    Config {
        name: "mainnet",
        cap: 64 << 20,
        prices: CHEAP,
        window: WINDOW,
        list: POOLS[0].list,
    },
    Config {
        name: "preprod",
        cap: 8 << 20,
        prices: CHEAP,
        window: WINDOW,
        list: POOLS[1].list,
    },
];

/// As messaging.rs's: a first short post costs 2 bits, the next 3, and a
/// third is past the ceiling. A post refused and counted against its
/// address shows as the next one's price.
static LOW_CEILING: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: Prices {
        base: 1,
        per_bit: 0.8,
        quiet: 1e12,
        ceiling: 3,
        half_life: Duration::from_secs(600),
    },
    window: WINDOW,
    list: POOLS[1].list,
}];

/// Preprod's list with room for one certificate with a 4-byte name, 276
/// bytes, and not two.
static ONE_ROOM: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: CHEAP,
    window: WINDOW,
    list: seedelf_data_api::messaging::Listing {
        network: 0,
        cap: 300,
    },
}];

fn app(relay: Relay) -> (Router, Arc<Relay>) {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    app_with(relay, state)
}

fn app_with(relay: Relay, state: Arc<AppState>) -> (Router, Arc<Relay>) {
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(
        Edge::new(true, vec![WALLET.to_string()], Egress::new(None, None))
            .with_messaging_egress(Egress::with_share_today(10_000_000)),
    );
    let relay = Arc::new(relay);
    let router = seedelf_data_api::app(state, submit, edge, relay.clone(), &[WALLET.to_string()]);
    (router, relay)
}

fn request(client: &str, method: Method, path: &str, body: Vec<u8>) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-forwarded-for", client)
        .header(header::ORIGIN, WALLET)
        .header("sec-fetch-mode", "cors")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(body))
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50000".parse::<SocketAddr>().unwrap(),
    ));
    request
}

/// A post's status, its JSON and its `Retry-After`.
async fn post(
    app: &Router,
    path: &str,
    client: &str,
    body: Vec<u8>,
) -> (StatusCode, Value, Option<u64>) {
    let response = app
        .clone()
        .oneshot(request(client, Method::POST, path, body))
        .await
        .unwrap();
    let status = response.status();
    let retry = response
        .headers()
        .get(header::RETRY_AFTER)
        .map(|value| value.to_str().unwrap().parse().unwrap());
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap(), retry)
}

/// A post to `pool` with at least `bits` over the stamp's digest `digest`.
fn paid(digest: [u8; 32], bytes: &[u8], bits: u32) -> Vec<u8> {
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= bits).unwrap();
    [&nonce.to_be_bytes()[..], bytes].concat()
}

fn certificate_post(pool: &str, certificate: &[u8]) -> Vec<u8> {
    paid(listing_digest(pool, certificate), certificate, 1)
}

fn path(pool: &str) -> String {
    format!("/messaging/v1/{pool}/certificates")
}

/// A page of the list: its flags, cursor, price and entries.
async fn page(app: &Router, pool: &str, after: Option<u64>) -> (u8, u64, u8, Vec<(u8, Vec<u8>)>) {
    page_for(app, pool, after, "192.0.2.1").await
}

/// What a certificate post from `client` would be asked now.
async fn price(app: &Router, client: &str) -> u8 {
    page_for(app, "preprod", None, client).await.2
}

async fn page_for(
    app: &Router,
    pool: &str,
    after: Option<u64>,
    client: &str,
) -> (u8, u64, u8, Vec<(u8, Vec<u8>)>) {
    let uri = match after {
        Some(after) => format!("{}?after={after}", path(pool)),
        None => path(pool),
    };
    let response = app
        .clone()
        .oneshot(request(client, Method::GET, &uri, vec![]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    let count = u16::from_be_bytes([bytes[11], bytes[12]]) as usize;
    let (mut at, mut entries) = (13, vec![]);
    for _ in 0..count {
        let len = u16::from_be_bytes([bytes[at + 1], bytes[at + 2]]) as usize;
        entries.push((bytes[at], bytes[at + 3..at + 3 + len].to_vec()));
        at += 3 + len;
    }
    let cursor = u64::from_be_bytes(bytes[2..10].try_into().unwrap());
    (bytes[1], cursor, bytes[10], entries)
}

/// The relay with preprod's view on `koios` and mainnet's nowhere.
fn preprod(pools: &'static [Config], koios: Koios) -> (Router, Arc<Relay>) {
    app(Relay::with_pools(None, pools).with_view("preprod", View::Koios(koios)))
}

/// The same, saving to `dir`.
fn preprod_in(dir: &std::path::Path, koios: Koios) -> (Router, Arc<Relay>) {
    app(Relay::with_pools(Some(dir), &CHEAP_POOLS).with_view("preprod", View::Koios(koios)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

const NOT_NOW: &str = "not this Seedelf's register now";

/// The register now is kept; a register the chain doesn't hold the name at,
/// a name it doesn't hold, one held outside the contract, twice, or under a
/// datum that isn't a register, are each a 409 and listed nowhere. Koios is
/// asked as seedelf-koios's `nft_utxo` asks it.
#[tokio::test]
async fn a_certificate_for_its_seedelfs_register_now_is_kept_and_any_other_is_a_409() {
    let koios = KoiosMock::start();
    let (app, relay) = preprod(
        &CHEAP_POOLS,
        Koios::with(&koios.url, KOIOS_DEADLINE, KOIOS_KEPT).unwrap(),
    );
    let alice = Made::preprod(b"alice", 2, 3);
    koios.hold(&alice.name, &alice.register());
    let (status, body, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &alice.bytes()),
    )
    .await;
    assert_eq!(
        (status, &body["kept"]),
        (StatusCode::OK, &"new".into()),
        "{body}"
    );
    let asked = koios.state.lock().unwrap().last.clone();
    assert_eq!(
        asked,
        json!({ "_asset_list": [[SEEDELF_POLICY, hex(b"alice")]], "_extended": true })
    );
    let refused = [
        // Alice's name at a register the chain doesn't hold it at.
        ("a made-up register", Made::preprod(b"alice", 9, 3), None),
        // A name the chain holds nowhere.
        ("no such Seedelf", Made::preprod(b"nobody", 2, 3), None),
        // At an address that isn't the contract's.
        (
            "outside the contract",
            Made::preprod(b"outside", 2, 3),
            Some(vec![{
                let mut row = contract_row(b"outside", &Made::preprod(b"outside", 2, 3).register());
                row["payment_cred"] = json!("00".repeat(28));
                row
            }]),
        ),
        // In two rows, which nft_utxo takes as none.
        (
            "twice",
            Made::preprod(b"twice", 2, 3),
            Some(vec![
                contract_row(b"twice", &Made::preprod(b"twice", 2, 3).register()),
                contract_row(b"twice", &Made::preprod(b"twice", 2, 3).register()),
            ]),
        ),
        // Under a datum that isn't a register.
        (
            "no register",
            Made::preprod(b"noregister", 2, 3),
            Some(vec![{
                let mut row = contract_row(b"noregister", &[0; 96]);
                row["inline_datum"]["bytes"] = json!("d87980");
                row
            }]),
        ),
    ];
    for (i, (what, made, rows)) in refused.into_iter().enumerate() {
        if let Some(rows) = rows {
            koios.rows(&made.name, rows);
        }
        let client = format!("198.51.100.{i}");
        let (status, body, _) = post(
            &app,
            &path("preprod"),
            &client,
            certificate_post("preprod", &made.bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{what}: {body}");
        assert_eq!(body["error"], NOT_NOW, "{what}");
    }
    assert_eq!(relay.health()["preprod"]["certificates"], 1);
    assert_eq!(relay.health()["preprod"]["chain"], "koios");
    // A spent row beside the one unspent: the unspent one's register.
    let bob = Made::preprod(b"bob", 4, 3);
    let mut spent = contract_row(b"bob", &[0; 96]);
    spent["is_spent"] = json!(true);
    koios.rows(
        &bob.name,
        vec![spent, contract_row(b"bob", &bob.register())],
    );
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.8",
        certificate_post("preprod", &bob.bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// A chain that can't be read, unreachable, slow past the deadline or
/// failing, is a 503 with a minute's wait, and nothing is kept; once the
/// chain answers, the same post is kept. Every post that reaches the proof
/// is counted against its address, whatever comes of it: a 503 from the
/// chain, a 409 and a kept one alike, so one solved stamp can't be posted
/// again and again for proofs and reads of the chain.
#[tokio::test]
async fn an_unreachable_slow_or_failing_chain_is_a_503_and_nothing_is_kept() {
    let made = Made::preprod(b"carol", 2, 3);
    let body = paid(listing_digest("preprod", &made.bytes()), &made.bytes(), 2);
    // Nothing listens on port 1.
    let nowhere = Koios::with("http://127.0.0.1:1/api/v1", KOIOS_DEADLINE, KOIOS_KEPT).unwrap();
    let (app, relay) = preprod(&LOW_CEILING, nowhere);
    let (status, answer, retry) = post(&app, &path("preprod"), "203.0.113.7", body.clone()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{answer}");
    assert_eq!(answer["error"], "can't check the chain now");
    assert_eq!(retry, Some(60));
    assert_eq!(relay.health()["preprod"]["certificates"], 0);
    // Counted: the address's next post costs a bit more.
    assert_eq!(price(&app, "203.0.113.7").await, 3);

    // Slow past the deadline, then failing: each a 503, from addresses of
    // their own.
    let koios = KoiosMock::start();
    koios.hold(&made.name, &made.register());
    koios.state.lock().unwrap().delay = Duration::from_millis(800);
    let quick = Koios::with(&koios.url, Duration::from_millis(200), Duration::ZERO).unwrap();
    let (app, relay) = preprod(&LOW_CEILING, quick);
    let started = std::time::Instant::now();
    let (status, _, _) = post(&app, &path("preprod"), "203.0.113.8", body.clone()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        started.elapsed() < Duration::from_millis(700),
        "{:?}",
        started.elapsed()
    );
    {
        let mut state = koios.state.lock().unwrap();
        state.delay = Duration::ZERO;
        state.status = Some(500);
    }
    let (status, _, _) = post(&app, &path("preprod"), "203.0.113.9", body.clone()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(relay.health()["preprod"]["certificates"], 0);
    // The chain answers: kept, and counted too.
    koios.state.lock().unwrap().status = None;
    let me = "198.51.100.7";
    let (status, answer, _) = post(&app, &path("preprod"), me, body).await;
    assert_eq!((status, &answer["kept"]), (StatusCode::OK, &"new".into()));
    assert_eq!(price(&app, me).await, 3);
    // A 409 is counted too: the address is past the ceiling now.
    let other = Made::preprod(b"carol", 5, 3).bytes();
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        me,
        paid(listing_digest("preprod", &other), &other, 3),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(price(&app, me).await, 0);
}

/// Check 8 comes last: a bad proof is a 400, and every check before it
/// answers, without a read of the chain.
#[tokio::test]
async fn the_chain_is_read_last_so_earlier_refusals_cost_no_read() {
    let koios = KoiosMock::start();
    let (app, _) = preprod(
        &ONE_ROOM,
        Koios::with(&koios.url, KOIOS_DEADLINE, KOIOS_KEPT).unwrap(),
    );
    let made = Made::preprod(b"dave", 2, 3);
    koios.hold(&made.name, &made.register());
    let mut broken = made.bytes();
    *broken.last_mut().unwrap() ^= 1;
    let (status, body, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &broken),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let unpaid = [&0u64.to_be_bytes()[..], &made.bytes()].concat();
    let (status, _, _) = post(&app, &path("preprod"), "203.0.113.7", unpaid).await;
    assert!(status == StatusCode::PAYMENT_REQUIRED || status == StatusCode::OK);
    let asked_before = koios.asked();
    assert!(asked_before <= 1);
    // Listed, then: already held, the list full, and a Seedelf's two, none
    // of them read.
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &made.bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let asked = koios.asked();
    let (status, body, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &made.bytes()),
    )
    .await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    let other = Made::preprod(b"erin", 2, 3);
    koios.hold(&other.name, &other.register());
    let (status, body, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &other.bytes()),
    )
    .await;
    assert_eq!(
        (status, &body["error"]),
        (StatusCode::SERVICE_UNAVAILABLE, &"the list is full".into())
    );
    assert_eq!(koios.asked(), asked);
}

/// Koios's answers are kept a minute: a Seedelf's second certificate, a
/// made-up register for it, and a name it doesn't hold, asked twice, ask
/// once each. A failure is never kept, and a kept answer goes when its
/// time is over.
#[tokio::test]
async fn a_repeated_post_asks_koios_once_a_minute() {
    let koios = KoiosMock::start();
    let (app, _) = preprod(
        &CHEAP_POOLS,
        Koios::with(&koios.url, KOIOS_DEADLINE, KOIOS_KEPT).unwrap(),
    );
    let frank = |x_m: u64| Made::preprod(b"frank", 2, x_m);
    koios.hold(b"frank", &frank(3).register());
    for x_m in [3, 4] {
        let (status, _, _) = post(
            &app,
            &path("preprod"),
            "203.0.113.7",
            certificate_post("preprod", &frank(x_m).bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    let made_up = Made::preprod(b"frank", 9, 5).bytes();
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.8",
        certificate_post("preprod", &made_up),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(koios.asked(), 1);
    for x_m in [3, 4] {
        let nobody = Made::preprod(b"nobody", 2, x_m).bytes();
        let (status, _, _) = post(
            &app,
            &path("preprod"),
            "203.0.113.9",
            certificate_post("preprod", &nobody),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
    }
    assert_eq!(koios.asked(), 2);

    // A failure isn't kept.
    let koios = KoiosMock::start();
    koios.state.lock().unwrap().status = Some(502);
    let (app, _) = preprod(
        &CHEAP_POOLS,
        Koios::with(
            &koios.url,
            Duration::from_secs(5),
            Duration::from_millis(300),
        )
        .unwrap(),
    );
    let grace = |x_m: u64| Made::preprod(b"grace", 2, x_m);
    koios.hold(b"grace", &grace(3).register());
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &grace(3).bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    koios.state.lock().unwrap().status = None;
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &grace(3).bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(koios.asked(), 2);
    // Its time over, asked again.
    tokio::time::sleep(Duration::from_millis(400)).await;
    let (status, _, _) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &grace(4).bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(koios.asked(), 3);
}

/// At most four requests to Koios at once, the rest waiting their turn
/// within the deadline.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn at_most_four_requests_go_to_koios_at_once() {
    let koios = KoiosMock::start();
    koios.state.lock().unwrap().delay = Duration::from_millis(250);
    let (app, relay) = preprod(
        &CHEAP_POOLS,
        Koios::with(&koios.url, KOIOS_DEADLINE, KOIOS_KEPT).unwrap(),
    );
    let mut posts = tokio::task::JoinSet::new();
    for i in 0..10u64 {
        let made = Made::preprod(format!("henry{i}").as_bytes(), 2 + i, 3);
        koios.hold(&made.name, &made.register());
        let (app, body) = (app.clone(), certificate_post("preprod", &made.bytes()));
        posts.spawn(async move {
            post(&app, &path("preprod"), &format!("198.51.100.{i}"), body)
                .await
                .0
        });
    }
    while let Some(status) = posts.join_next().await {
        assert_eq!(status.unwrap(), StatusCode::OK);
    }
    let most = koios.state.lock().unwrap().most_flying;
    assert!((1..=4).contains(&most), "{most}");
    assert_eq!(koios.asked(), 10);
    assert_eq!(relay.health()["preprod"]["certificates"], 10);
}

/// Preprod's slow re-check (§21.7): each Seedelf the list knows, listed or
/// withdrawn, asked of Koios one a step, and a round at most once a day.
/// One that moved is dropped at once, a removal entry in the next page; a
/// withdrawn one's digest goes after three rounds that find it elsewhere;
/// one still there stays. The mainnet sweep reads no Koios.
fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Withdraws `made`'s certificate from preprod, as its owner does.
async fn withdraw(app: &Router, made: &Made) -> StatusCode {
    let withdrawal = made.withdrawal("preprod", made.x_m);
    let body = paid(unlisting_digest("preprod", &withdrawal), &withdrawal, 1);
    post(
        app,
        "/messaging/v1/preprod/withdrawals",
        "203.0.113.7",
        body,
    )
    .await
    .0
}

/// Lists each on preprod, Koios holding it where its certificate says.
async fn list_all(app: &Router, koios: &KoiosMock, made: &[&Made]) {
    for made in made {
        koios.hold(&made.name, &made.register());
        let (status, body, _) = post(
            app,
            &path("preprod"),
            "203.0.113.7",
            certificate_post("preprod", &made.bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
}

/// Steps the re-check at `now` until it asks nothing more: how many asked.
async fn steps(relay: &Relay, rounds: &mut HashMap<&'static str, Round>, now: i64) -> usize {
    let mut asked = 0;
    while relay.recheck_step(rounds, now).await {
        asked += 1;
        assert!(asked < 100, "a re-check that never ends");
    }
    asked
}

/// The name Koios was asked about last.
fn asked_about(koios: &KoiosMock) -> Vec<u8> {
    let last = koios.state.lock().unwrap().last.clone();
    let name = last["_asset_list"][0][1].as_str().unwrap().to_string();
    (0..name.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&name[i..i + 2], 16).unwrap())
        .collect()
}

/// Preprod's slow re-check: a round asks about each Seedelf the list
/// knows, one a step, then nothing until a day after it began. A Seedelf
/// found elsewhere is asked again 10 minutes on, and only that second
/// answer drops its certificate, for a removal, or counts toward forgetting
/// its withdrawn digests; one back by then is kept. Koios unread judges
/// nothing.
#[tokio::test]
async fn preprods_recheck_asks_once_a_day_and_drops_only_what_a_second_ask_finds_moved() {
    let koios = KoiosMock::start();
    let fresh = Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO).unwrap();
    let (app, relay) = preprod(&CHEAP_POOLS, fresh);
    let (ivan, judy, kim) = (
        Made::preprod(b"ivan", 2, 3),
        Made::preprod(b"judy", 4, 3),
        Made::preprod(b"kim", 6, 3),
    );
    list_all(&app, &koios, &[&ivan, &judy, &kim]).await;
    assert_eq!(withdraw(&app, &kim).await, StatusCode::OK);
    let cursor = page(&app, "preprod", None).await.1;
    // Ivan and Kim move.
    koios.hold(&ivan.name, &Made::preprod(b"ivan", 7, 3).register());
    koios.hold(&kim.name, &Made::preprod(b"kim", 8, 3).register());
    assert_eq!(relay.sweep_once().await, 0);
    let asked = koios.asked();
    let mut rounds = HashMap::new();
    let start = unix_now();
    // A round: one request a step, three Seedelfs, then nothing due; and
    // nothing dropped yet.
    assert_eq!(steps(&relay, &mut rounds, start).await, 3);
    assert_eq!(koios.asked(), asked + 3);
    assert_eq!(page(&app, "preprod", Some(cursor)).await.3, vec![]);
    assert_eq!(relay.health()["preprod"]["certificates"], 2);
    // Not yet 10 minutes: nothing.
    assert_eq!(steps(&relay, &mut rounds, start + 599).await, 0);
    // Ten: Ivan and Kim asked again, found elsewhere again: Ivan's
    // certificate goes, and Kim's absence counts once.
    assert_eq!(steps(&relay, &mut rounds, start + 600).await, 2);
    let (flags, _, _, entries) = page(&app, "preprod", Some(cursor)).await;
    assert_eq!(
        (flags, entries),
        (
            0,
            vec![(2, listing_digest("preprod", &ivan.bytes()).to_vec())]
        )
    );
    assert_eq!(relay.health()["preprod"]["certificates"], 1);
    assert_eq!(relay.health()["preprod"]["withdrawn"], 1);
    // An hour on, nothing is asked: once a day.
    assert_eq!(steps(&relay, &mut rounds, start + 3600).await, 0);
    assert_eq!(koios.asked(), asked + 5);
    // Two days more: Judy and Kim each day, then Kim again; found elsewhere
    // a third time, his digest goes. Judy, still there, stays.
    for day in 1..=2 {
        let now = start + day * 25 * 3600;
        assert_eq!(steps(&relay, &mut rounds, now).await, 2, "day {day}");
        assert_eq!(steps(&relay, &mut rounds, now + 600).await, 1, "day {day}");
    }
    assert_eq!(relay.health()["preprod"]["withdrawn"], 0);
    assert_eq!(relay.health()["preprod"]["certificates"], 1);
    assert_eq!(page(&app, "preprod", None).await.3[0], (1, judy.bytes()));
    // Judy found elsewhere once, and back by the second ask: kept.
    let day = start + 3 * 25 * 3600;
    koios.hold(&judy.name, &[0; 96]);
    assert_eq!(steps(&relay, &mut rounds, day).await, 1);
    koios.hold(&judy.name, &judy.register());
    assert_eq!(steps(&relay, &mut rounds, day + 600).await, 1);
    assert_eq!(relay.health()["preprod"]["certificates"], 1);
    // Koios can't be read: nothing is judged, the second ask's twice.
    koios.hold(&judy.name, &[0; 96]);
    let day = start + 4 * 25 * 3600;
    assert_eq!(steps(&relay, &mut rounds, day).await, 1);
    koios.state.lock().unwrap().status = Some(500);
    steps(&relay, &mut rounds, day + 600).await;
    assert_eq!(steps(&relay, &mut rounds, day + 3 * 3600).await, 0);
    assert_eq!(relay.health()["preprod"]["certificates"], 1);
}

/// Koios's day's budget: the re-check takes only what posts leave, so a
/// post still has its check once the re-check has stopped; a post past the
/// whole day's is a 503 until the day ends; and the next day the round goes
/// on where it stopped, the Seedelfs in their keys' order.
#[tokio::test]
async fn the_recheck_takes_only_what_the_days_budget_leaves_posts_and_goes_on_the_next_day() {
    let koios = KoiosMock::start();
    let budget = Budget {
        a_day: 6,
        for_posts: 2,
    };
    let view = Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO)
        .unwrap()
        .with_budget(budget);
    let (app, relay) = preprod(&CHEAP_POOLS, view);
    let made: Vec<Made> = (0..3u8)
        .map(|i| Made::preprod(&[b'b', i], u64::from(i) + 2, 3))
        .collect();
    list_all(&app, &koios, &made.iter().collect::<Vec<_>>()).await;
    let mut order: Vec<&Made> = made.iter().collect();
    order.sort_by_key(|made| seedelf_key(&made.name, &made.register()));
    let now = unix_now();
    let mut rounds = HashMap::new();
    // Three asked at posts, one by the re-check: then it stops short of the
    // two kept for posts.
    assert_eq!(steps(&relay, &mut rounds, now).await, 1);
    assert_eq!(asked_about(&koios), order[0].name);
    assert_eq!(koios.asked(), 4);
    let more: Vec<Made> = (3..6u8)
        .map(|i| Made::preprod(&[b'b', i], u64::from(i) + 2, 3))
        .collect();
    list_all(&app, &koios, &[&more[0], &more[1]]).await;
    koios.hold(&more[2].name, &more[2].register());
    let (status, body, retry) = post(
        &app,
        &path("preprod"),
        "203.0.113.7",
        certificate_post("preprod", &more[2].bytes()),
    )
    .await;
    assert_eq!(
        (status, &body["error"]),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            &"can't check the chain now".into()
        )
    );
    let until_tomorrow = (now.div_euclid(86_400) + 1) * 86_400 - unix_now();
    let retry = retry.unwrap() as i64;
    assert!(
        (until_tomorrow - 2..=until_tomorrow + 2).contains(&retry),
        "{retry}"
    );
    assert_eq!(koios.asked(), 6);
    // The next day: on from its place, not from the start.
    let tomorrow = (now.div_euclid(86_400) + 1) * 86_400 + 60;
    assert!(relay.recheck_step(&mut rounds, tomorrow).await);
    let mut walked = vec![asked_about(&koios)];
    while relay.recheck_step(&mut rounds, tomorrow).await {
        walked.push(asked_about(&koios));
    }
    let mut all: Vec<&Made> = made.iter().chain(&more[..2]).collect();
    all.sort_by_key(|made| seedelf_key(&made.name, &made.register()));
    let first = seedelf_key(&order[0].name, &order[0].register());
    let rest: Vec<Vec<u8>> = all
        .iter()
        .filter(|made| seedelf_key(&made.name, &made.register()) > first)
        .map(|made| made.name.clone())
        .collect();
    assert_eq!(walked, rest);
}

/// A 429 stops every request to Koios for its `Retry-After`: the post that
/// met it and every one after are a 503 that says so, and neither a post
/// nor the re-check asks Koios until then. A run of five failures stops
/// them for an hour.
#[tokio::test]
async fn a_429_or_a_run_of_failures_stops_every_request_to_koios_for_a_while() {
    let koios = KoiosMock::start();
    let view = Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO).unwrap();
    let (app, relay) = preprod(&CHEAP_POOLS, view);
    let (lea, max) = (Made::preprod(b"lea", 2, 3), Made::preprod(b"max", 4, 3));
    list_all(&app, &koios, &[&lea]).await;
    koios.hold(&max.name, &max.register());
    {
        let mut state = koios.state.lock().unwrap();
        state.status = Some(429);
        state.retry_after = Some("120".into());
    }
    let asked = koios.asked();
    for client in ["203.0.113.8", "203.0.113.9"] {
        let (status, _, retry) = post(
            &app,
            &path("preprod"),
            client,
            certificate_post("preprod", &max.bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!((118..=120).contains(&retry.unwrap()), "{retry:?}");
    }
    assert_eq!(koios.asked(), asked + 1);
    let mut rounds = HashMap::new();
    let now = unix_now();
    assert_eq!(steps(&relay, &mut rounds, now).await, 0);
    assert_eq!(koios.asked(), asked + 1);
    // Past it, Koios answers again.
    koios.state.lock().unwrap().status = None;
    assert_eq!(steps(&relay, &mut rounds, now + 121).await, 1);
    assert_eq!(koios.asked(), asked + 2);

    let koios = KoiosMock::start();
    let view = Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO).unwrap();
    let (app, _) = preprod(&CHEAP_POOLS, view);
    koios.hold(&max.name, &max.register());
    koios.state.lock().unwrap().status = Some(500);
    for i in 0..5 {
        let (status, _, retry) = post(
            &app,
            &path("preprod"),
            &format!("198.51.100.{i}"),
            certificate_post("preprod", &max.bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let wait = if i < 4 { 60..=60 } else { 3598..=3600 };
        assert!(wait.contains(&retry.unwrap()), "{i}: {retry:?}");
    }
    assert_eq!(koios.asked(), 5);
    koios.state.lock().unwrap().status = None;
    let (status, _, retry) = post(
        &app,
        &path("preprod"),
        "198.51.100.9",
        certificate_post("preprod", &max.bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!((3590..=3600).contains(&retry.unwrap()), "{retry:?}");
    assert_eq!(koios.asked(), 5);
}

/// A pool the off switch stops is neither swept nor re-checked: what moved
/// stays until it's on again.
#[tokio::test]
async fn a_stopped_pool_is_neither_rechecked_nor_swept() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-stopped-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let koios = KoiosMock::start();
    let (script, state) = mainnet_view().await;
    let nina = Made::preprod(b"nina", 2, 3);
    let otto = Made::mainnet(&seedelf(9), 2, 3);
    script.lock().unwrap().outputs = vec![(otto.name.clone(), otto.register())];
    let relay_in = |stopped: Stopped| {
        Relay::with_pools(Some(&dir), &CHEAP_POOLS)
            .with_view(
                "preprod",
                View::Koios(Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO).unwrap()),
            )
            .with_view("mainnet", View::index(state.clone()))
            .with_stopped(stopped)
    };
    {
        let (app, relay) = app_with(relay_in(Stopped::none()), state.clone());
        list_all(&app, &koios, &[&nina]).await;
        let (status, _, _) = post(
            &app,
            &path("mainnet"),
            "203.0.113.7",
            certificate_post("mainnet", &otto.bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        relay.save(true);
    }
    // Both move.
    koios.hold(&nina.name, &[0; 96]);
    script.lock().unwrap().outputs = vec![(
        otto.name.clone(),
        Made::mainnet(&seedelf(9), 5, 3).register(),
    )];
    new_block(&state, 2);
    let (_, relay) = app_with(
        relay_in(Stopped::of(["preprod", "mainnet"]).unwrap()),
        state.clone(),
    );
    let asked = koios.asked();
    let mut rounds = HashMap::new();
    let now = unix_now();
    assert_eq!(steps(&relay, &mut rounds, now).await, 0);
    assert_eq!(steps(&relay, &mut rounds, now + 600).await, 0);
    assert_eq!(relay.sweep_once().await, 0);
    assert_eq!(koios.asked(), asked);
    for pool in ["preprod", "mainnet"] {
        assert_eq!(relay.health()[pool]["certificates"], 1, "{pool}");
    }
    relay.save(true);
    drop(relay);
    // On again: both go.
    let (_, relay) = app_with(relay_in(Stopped::none()), state.clone());
    assert_eq!(relay.sweep_once().await, 1);
    assert_eq!(steps(&relay, &mut rounds, now).await, 1);
    assert_eq!(steps(&relay, &mut rounds, now + 600).await, 1);
    for pool in ["preprod", "mainnet"] {
        assert_eq!(relay.health()[pool]["certificates"], 0, "{pool}");
    }
    std::fs::remove_dir_all(&dir).unwrap();
}

/// The round's place is saved with the list: a restart mid-round goes on
/// from it, and one after a round asks nothing until a day after it began.
#[tokio::test]
async fn the_rechecks_round_goes_on_from_its_place_after_a_restart() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-round-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let koios = KoiosMock::start();
    let restart = || {
        preprod_in(
            &dir,
            Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO).unwrap(),
        )
    };
    let made: Vec<Made> = (0..3u8)
        .map(|i| Made::preprod(&[b'r', i], u64::from(i) + 2, 3))
        .collect();
    let mut order: Vec<&Made> = made.iter().collect();
    order.sort_by_key(|made| seedelf_key(&made.name, &made.register()));
    let now = unix_now();
    {
        let (app, relay) = restart();
        list_all(&app, &koios, &made.iter().collect::<Vec<_>>()).await;
        assert!(relay.recheck_step(&mut HashMap::new(), now).await);
        assert_eq!(asked_about(&koios), order[0].name);
        relay.save(false);
    }
    {
        let (_, relay) = restart();
        let mut rounds = HashMap::new();
        assert!(relay.recheck_step(&mut rounds, now + 5).await);
        assert_eq!(asked_about(&koios), order[1].name);
        assert!(relay.recheck_step(&mut rounds, now + 5).await);
        assert_eq!(asked_about(&koios), order[2].name);
        assert!(!relay.recheck_step(&mut rounds, now + 5).await);
        relay.save(true);
    }
    let (_, relay) = restart();
    let mut rounds = HashMap::new();
    let asked = koios.asked();
    assert_eq!(steps(&relay, &mut rounds, now + 3600).await, 0);
    assert_eq!(koios.asked(), asked);
    assert_eq!(steps(&relay, &mut rounds, now + 86_400).await, 3);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// A post whose request is dropped while the chain is read, its client
/// gone, is counted against its address all the same: the next post from
/// it costs more.
#[tokio::test]
async fn a_post_dropped_while_the_chain_is_read_is_counted_against_its_address() {
    let koios = KoiosMock::start();
    let made = Made::preprod(b"pia", 2, 3);
    koios.hold(&made.name, &made.register());
    koios.state.lock().unwrap().delay = Duration::from_secs(3);
    let view = Koios::with(&koios.url, KOIOS_DEADLINE, Duration::ZERO).unwrap();
    let (app, _) = preprod(&LOW_CEILING, view);
    let me = "203.0.113.7";
    assert_eq!(price(&app, me).await, 2);
    let body = paid(listing_digest("preprod", &made.bytes()), &made.bytes(), 2);
    let posting = {
        let app = app.clone();
        tokio::spawn(async move {
            app.oneshot(request(me, Method::POST, &path("preprod"), body))
                .await
        })
    };
    let started = std::time::Instant::now();
    while koios.asked() == 0 {
        assert!(started.elapsed() < Duration::from_secs(5), "never asked");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    posting.abort();
    assert!(posting.await.unwrap_err().is_cancelled());
    assert_eq!(price(&app, me).await, 3);
}

/// The scripted Kupo mainnet's names answer is made from: every output at
/// the contract is unspent, each holding one Seedelf under the policy.
#[derive(Default)]
struct Script {
    /// Each output's Seedelf name and register.
    outputs: Vec<(Vec<u8>, Vec<u8>)>,
}

type Shared = Arc<Mutex<Script>>;

fn now_slot() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        - SHELLEY_OFFSET
}

async fn matches(State(script): State<Shared>, RawQuery(query): RawQuery) -> Response {
    let script = script.lock().unwrap();
    assert!(query.unwrap_or_default().contains("unspent"));
    let tip = now_slot() - 5;
    let list: Vec<Value> = script
        .outputs
        .iter()
        .enumerate()
        .map(|(i, (name, register))| {
            json!({
                "transaction_index": 0,
                "transaction_id": format!("{i:064x}"),
                "output_index": 0,
                "address": "addr1wx2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6qxqzvvt",
                "value": { "coins": 1500000, "assets": { format!("{SEEDELF_POLICY}.{}", hex(name)): 1 } },
                "datum_hash": null,
                "datum": datum(register),
                "datum_type": "inline",
                "script_hash": null,
                "created_at": { "slot_no": tip - 100, "header_hash": "00".repeat(32) },
                "spent_at": null,
            })
        })
        .collect();
    (
        [("x-most-recent-checkpoint", tip.to_string())],
        axum::Json(Value::Array(list)),
    )
        .into_response()
}

/// The scripted Kupo, and the state that reads it as the private index's
/// one source, its tip fresh.
async fn mainnet_view() -> (Shared, Arc<AppState>) {
    let script: Shared = Arc::default();
    let kupo = Router::new()
        .route("/matches/{cred}/{*rest}", get(matches))
        .with_state(script.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, kupo).await });
    let state = Arc::new(
        AppState::new(Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap())
            .with_kupo(Some(Kupo::new(&url).unwrap())),
    );
    new_block(&state, 1);
    (script, state)
}

/// A new block at Kupo: the names answer is made again.
fn new_block(state: &AppState, n: u64) {
    state.set_kupo_tip(Block {
        slot: now_slot() - 5,
        hash: format!("{n:064x}"),
    });
}

/// A real Seedelf name: the policy's prefix and a tag.
fn seedelf(tag: u8) -> Vec<u8> {
    vec![0x5e, 0xed, 0x0e, 0x1f, tag]
}

/// Mainnet's view through the private index: a certificate for its
/// Seedelf's register now is kept, another register or name is a 409; a
/// move leaves a removal entry at the next sweep, and the Seedelf's new
/// register is kept; a stale index is a 503 and drops nothing.
#[tokio::test]
async fn mainnets_view_is_the_private_indexs_and_a_move_leaves_a_removal() {
    let (script, state) = mainnet_view().await;
    let alice = Made::mainnet(&seedelf(1), 2, 3);
    let bob = Made::mainnet(&seedelf(2), 4, 3);
    script.lock().unwrap().outputs = vec![
        (alice.name.clone(), alice.register()),
        (bob.name.clone(), bob.register()),
    ];
    let relay =
        Relay::with_pools(None, &CHEAP_POOLS).with_view("mainnet", View::index(state.clone()));
    let (app, relay) = app_with(relay, state.clone());
    assert_eq!(relay.health()["mainnet"]["chain"], "index");
    let mainnet = path("mainnet");
    let (status, body, _) = post(
        &app,
        &mainnet,
        "203.0.113.7",
        certificate_post("mainnet", &alice.bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for made in [
        Made::mainnet(&seedelf(1), 9, 3),
        Made::mainnet(&seedelf(7), 2, 3),
    ] {
        let (status, body, _) = post(
            &app,
            &mainnet,
            "203.0.113.8",
            certificate_post("mainnet", &made.bytes()),
        )
        .await;
        assert_eq!(
            (status, &body["error"]),
            (StatusCode::CONFLICT, &NOT_NOW.into())
        );
    }
    let (_, cursor, _, entries) = page(&app, "mainnet", None).await;
    assert_eq!(entries, vec![(1, alice.bytes())]);
    // Nothing moved: the sweep drops nothing.
    assert_eq!(relay.sweep_once().await, 0);

    // Alice moves, and a block comes: the sweep drops her certificate, a
    // removal entry naming it by its listing digest in the next page.
    let moved = Made::mainnet(&seedelf(1), 6, 3);
    script.lock().unwrap().outputs[0] = (moved.name.clone(), moved.register());
    new_block(&state, 2);
    assert_eq!(relay.sweep_once().await, 1);
    let (flags, _, _, entries) = page(&app, "mainnet", Some(cursor)).await;
    assert_eq!(
        (flags, entries),
        (
            0,
            vec![(2, listing_digest("mainnet", &alice.bytes()).to_vec())]
        )
    );
    assert_eq!(relay.health()["mainnet"]["certificates"], 0);
    // Her old register is refused, her new one kept.
    let (status, _, _) = post(
        &app,
        &mainnet,
        "203.0.113.7",
        certificate_post("mainnet", &alice.bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _, _) = post(
        &app,
        &mainnet,
        "203.0.113.7",
        certificate_post("mainnet", &moved.bytes()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // The index stale, an hour behind: a post is a 503, and the sweep drops
    // nothing, though Alice moved again.
    script.lock().unwrap().outputs[0] = (moved.name.clone(), alice.register());
    state.set_kupo_tip(Block {
        slot: now_slot() - 3_600,
        hash: "ff".repeat(32),
    });
    let (status, body, retry) = post(
        &app,
        &mainnet,
        "203.0.113.7",
        certificate_post("mainnet", &bob.bytes()),
    )
    .await;
    assert_eq!(
        (status, &body["error"], retry),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            &"can't check the chain now".into(),
            Some(60)
        )
    );
    assert_eq!(relay.sweep_once().await, 0);
    assert_eq!(relay.health()["mainnet"]["certificates"], 1);
    // A view of no Seedelf at all drops nothing either.
    script.lock().unwrap().outputs.clear();
    new_block(&state, 3);
    assert_eq!(relay.sweep_once().await, 0);
    assert_eq!(relay.health()["mainnet"]["certificates"], 1);
}

/// A withdrawn digest on mainnet: its bytes are refused at check 3′ while
/// its Seedelf is at that register, and the sweep forgets it only once the
/// Seedelf has been found elsewhere three sweeps in a row, each on a new
/// tip: one view that passes (a rollback, a source behind, one stuck on a
/// tip) forgets nothing. Forgotten, the same bytes meet the chain check
/// instead.
#[tokio::test]
async fn mainnets_sweep_forgets_a_withdrawn_digest_after_three_sweeps_elsewhere() {
    let (script, state) = mainnet_view().await;
    let carol = Made::mainnet(&seedelf(3), 2, 3);
    let dave = Made::mainnet(&seedelf(4), 8, 3);
    script.lock().unwrap().outputs = vec![
        (carol.name.clone(), carol.register()),
        (dave.name.clone(), dave.register()),
    ];
    let relay =
        Relay::with_pools(None, &CHEAP_POOLS).with_view("mainnet", View::index(state.clone()));
    let (app, relay) = app_with(relay, state.clone());
    let mainnet = path("mainnet");
    for made in [&carol, &dave] {
        let (status, _, _) = post(
            &app,
            &mainnet,
            "203.0.113.7",
            certificate_post("mainnet", &made.bytes()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    let withdrawal = carol.withdrawal("mainnet", carol.x_m);
    let body = paid(
        seedelf_data_api::messaging::certificate::unlisting_digest("mainnet", &withdrawal),
        &withdrawal,
        1,
    );
    let (status, answer, _) = post(
        &app,
        "/messaging/v1/mainnet/withdrawals",
        "203.0.113.7",
        body,
    )
    .await;
    assert_eq!(
        (status, answer),
        (StatusCode::OK, json!({ "withdrawn": true }))
    );
    assert_eq!(relay.health()["mainnet"]["withdrawn"], 1);
    let (status, answer, _) = post(
        &app,
        &mainnet,
        "203.0.113.9",
        certificate_post("mainnet", &carol.bytes()),
    )
    .await;
    assert_eq!(
        (status, &answer["error"]),
        (StatusCode::CONFLICT, &"withdrawn".into())
    );
    let withdrawn = || relay.health()["mainnet"]["withdrawn"].clone();
    let at = |register: Vec<u8>, block: u64| {
        script.lock().unwrap().outputs[0] = (carol.name.clone(), register);
        new_block(&state, block);
    };
    let moved = Made::mainnet(&seedelf(3), 5, 3).register();
    // Elsewhere twice, then back: kept, and the count starts again.
    at(moved.clone(), 2);
    assert_eq!(relay.sweep_once().await, 0);
    at(moved.clone(), 3);
    assert_eq!(relay.sweep_once().await, 0);
    assert_eq!(withdrawn(), 1);
    at(carol.register(), 4);
    relay.sweep_once().await;
    assert_eq!(withdrawn(), 1);
    // Elsewhere at one tip, swept again and again: one view, counted once.
    at(moved.clone(), 5);
    for _ in 0..5 {
        assert_eq!(relay.sweep_once().await, 0);
    }
    assert_eq!(withdrawn(), 1);
    // Elsewhere on two tips more, three in a row: forgotten, and Dave is
    // kept.
    for block in 6..8 {
        assert_eq!(withdrawn(), 1, "block {block}");
        at(moved.clone(), block);
        assert_eq!(relay.sweep_once().await, 0);
    }
    assert_eq!(withdrawn(), 0);
    assert_eq!(relay.health()["mainnet"]["certificates"], 1);
    let (status, answer, _) = post(
        &app,
        &mainnet,
        "203.0.113.9",
        certificate_post("mainnet", &carol.bytes()),
    )
    .await;
    assert_eq!(
        (status, &answer["error"]),
        (StatusCode::CONFLICT, &NOT_NOW.into())
    );
    let _ = CONTRACT_HASH;
}
