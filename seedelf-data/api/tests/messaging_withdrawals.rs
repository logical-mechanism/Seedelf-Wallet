//! Withdrawals through the whole app, offline (chunk 55's call 9; §21.7's
//! "A withdrawal" and "Posting one"): every check's order and answer, a
//! taken withdrawal's removal in the next page and the room it frees, a
//! withdrawal lasting (check 3′), across a restart too, the file's
//! withdrawals and refusals posted as a wallet posts them, and the edge on
//! the route. Each pool reads a Koios on loopback that holds each Seedelf
//! where its certificate says.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress};
use seedelf_data_api::messaging::certificate::{listing_digest, unlisting_digest};
use seedelf_data_api::messaging::check::stamp_bits;
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::view::{Koios, View};
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Listing, POOLS, Relay};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::{Value, json};
use tower::ServiceExt;

mod common;
use common::{KoiosMock, Made};

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";
const WITHDRAWALS: &str = "/messaging/v1/preprod/withdrawals";
const CERTIFICATES: &str = "/messaging/v1/preprod/certificates";

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

/// Room for two short certificates and a withdrawal's 64 bytes (its
/// removal's and its digest's): after one is withdrawn, one more fits, and
/// a byte less wouldn't.
static TWO_AND_A_WITHDRAWAL: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: CHEAP,
    window: WINDOW,
    list: Listing {
        network: 0,
        cap: 2 * 273 + 64,
    },
}];

/// A first short post costs 2 bits, the next 3; a third is past the
/// ceiling.
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

struct Relayed {
    app: Router,
    relay: Arc<Relay>,
    /// Each pool's Koios.
    chains: [KoiosMock; 2],
}

impl Relayed {
    fn chain(&self, pool: &str) -> &KoiosMock {
        &self.chains[usize::from(pool == "preprod")]
    }
}

fn relayed(relay: Relay) -> Relayed {
    relayed_as(relay, false)
}

fn relayed_as(relay: Relay, off: bool) -> Relayed {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(
        Edge::new(true, vec![WALLET.to_string()], Egress::new(None, None))
            .with_messaging_egress(Egress::with_share_today(10_000_000))
            .with_messaging_off(off),
    );
    let chains = [KoiosMock::start(), KoiosMock::start()];
    let view = |chain: &KoiosMock| {
        View::Koios(Koios::with(&chain.url, Duration::from_secs(5), Duration::ZERO).unwrap())
    };
    let relay = Arc::new(
        relay
            .with_view("mainnet", view(&chains[0]))
            .with_view("preprod", view(&chains[1])),
    );
    let app = seedelf_data_api::app(state, submit, edge, relay.clone(), &[WALLET.to_string()]);
    Relayed { app, relay, chains }
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

/// A post's status, its JSON (null when it has none) and its `Retry-After`.
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        retry,
    )
}

fn paid(digest: [u8; 32], bytes: &[u8], bits: u32) -> Vec<u8> {
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= bits).unwrap();
    [&nonce.to_be_bytes()[..], bytes].concat()
}

fn unpaid(digest: [u8; 32], bytes: &[u8]) -> Vec<u8> {
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) == 0).unwrap();
    [&nonce.to_be_bytes()[..], bytes].concat()
}

fn withdrawal_post(pool: &str, withdrawal: &[u8], bits: u32) -> Vec<u8> {
    paid(unlisting_digest(pool, withdrawal), withdrawal, bits)
}

/// Lists `made`'s certificate on preprod, the chain holding it there first.
async fn list(relayed: &Relayed, made: &Made, client: &str, bits: u32) {
    relayed.chain("preprod").hold(&made.name, &made.register());
    let body = paid(made.digest("preprod"), &made.bytes(), bits);
    let (status, answer, _) = post(&relayed.app, CERTIFICATES, client, body).await;
    assert_eq!(
        (status, &answer["kept"]),
        (StatusCode::OK, &"new".into()),
        "{answer}"
    );
}

/// A page of preprod's list after `after`: its flags, cursor, price and
/// entries.
async fn page(app: &Router, client: &str, after: Option<u64>) -> (u8, u64, u8, Vec<(u8, Vec<u8>)>) {
    let uri = match after {
        Some(after) => format!("{CERTIFICATES}?after={after}"),
        None => CERTIFICATES.to_string(),
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

/// Taken, a withdrawal answers 200 `{"withdrawn": true}`; its certificate
/// goes, a removal entry naming it in the next page; its Seedelf has room
/// for another m_S; and the list's room comes back, less the 64 bytes the
/// removal and the kept digest count.
#[tokio::test]
async fn a_taken_withdrawal_is_a_removal_in_the_next_page_and_frees_room() {
    let relayed = relayed(Relay::with_pools(None, &TWO_AND_A_WITHDRAWAL));
    let (app, relay) = (&relayed.app, &relayed.relay);
    let a = Made::preprod(b"a", 2, 3);
    let b = Made::preprod(b"a", 2, 4);
    for made in [&a, &b] {
        list(&relayed, made, "203.0.113.7", 1).await;
    }
    let cursor = page(app, "192.0.2.1", None).await.1;
    // A Seedelf's third, and a third short certificate: no room for either.
    let c = Made::preprod(b"a", 2, 5);
    relayed.chain("preprod").hold(&c.name, &c.register());
    let (status, _, _) = post(
        app,
        CERTIFICATES,
        "203.0.113.7",
        paid(c.digest("preprod"), &c.bytes(), 1),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let d = Made::preprod(b"d", 4, 3);
    relayed.chain("preprod").hold(&d.name, &d.register());
    let (status, body, _) = post(
        app,
        CERTIFICATES,
        "203.0.113.7",
        paid(d.digest("preprod"), &d.bytes(), 1),
    )
    .await;
    assert_eq!(
        (status, &body["error"]),
        (StatusCode::SERVICE_UNAVAILABLE, &"the list is full".into())
    );
    // A's withdrawal, proved with its own messaging key.
    let (status, body, _) = post(
        app,
        WITHDRAWALS,
        "203.0.113.9",
        withdrawal_post("preprod", &a.withdrawal("preprod", 3), 1),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::OK, json!({ "withdrawn": true }))
    );
    let (flags, _, _, entries) = page(app, "192.0.2.1", Some(cursor)).await;
    assert_eq!(
        (flags, entries),
        (0, vec![(2, a.digest("preprod").to_vec())])
    );
    assert_eq!(relay.health()["preprod"]["certificates"], 1);
    assert_eq!(relay.health()["preprod"]["withdrawn"], 1);
    // The Seedelf's slot is free, and the list has room for exactly one more.
    let (status, body, _) = post(
        app,
        CERTIFICATES,
        "203.0.113.7",
        paid(c.digest("preprod"), &c.bytes(), 1),
    )
    .await;
    assert_eq!(
        (status, &body["kept"]),
        (StatusCode::OK, &"new".into()),
        "{body}"
    );
    let (status, _, _) = post(
        app,
        CERTIFICATES,
        "203.0.113.7",
        paid(d.digest("preprod"), &d.bytes(), 1),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    // The same withdrawal again: nothing held under its digest now.
    let (status, body, _) = post(
        app,
        WITHDRAWALS,
        "203.0.113.9",
        withdrawal_post("preprod", &a.withdrawal("preprod", 3), 1),
    )
    .await;
    assert_eq!(
        (status, &body["error"]),
        (StatusCode::NOT_FOUND, &"no such certificate".into())
    );
}

/// §21.7's withdrawal rows in their order, each before the next: the
/// length, the shape (before the digest is looked up), the digest held
/// (before the price), the price and the window, the stamp, then the proof,
/// counted against the address's own price.
#[tokio::test]
async fn every_withdrawal_check_answers_in_its_order() {
    let relayed = relayed(Relay::with_pools(None, &LOW_CEILING));
    let app = &relayed.app;
    let me = "203.0.113.7";
    let e = Made::preprod(b"e", 2, 3);
    list(&relayed, &e, "198.51.100.1", 2).await;
    let good = e.withdrawal("preprod", 3);
    // 1: the length, whatever else.
    for len in [0, 97] {
        let (status, body, _) = post(app, WITHDRAWALS, me, vec![0; 8 + len]).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{len}");
        assert_eq!(
            body["error"],
            "a post is a nonce, then a withdrawal: 106 bytes"
        );
    }
    let (status, _, _) = post(app, WITHDRAWALS, me, vec![0; 8 + 99]).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    // 2: the shape, before the digest is looked up: another version,
    // mainnet's network byte, c past q.
    let with = |at: usize, byte: u8| {
        let mut bytes = good.clone();
        bytes[at] = byte;
        [&0u64.to_be_bytes()[..], &bytes].concat()
    };
    for (body, words) in [
        (with(0, 2), "not a version 1 withdrawal"),
        (with(1, 1), "not a withdrawal for this pool's network"),
        (
            with(34, 0xff),
            "a scalar in the withdrawal isn't below the group order",
        ),
        (
            with(66, 0xff),
            "a scalar in the withdrawal isn't below the group order",
        ),
    ] {
        let (status, answer, _) = post(app, WITHDRAWALS, me, body).await;
        assert_eq!(
            (status, &answer["error"]),
            (StatusCode::BAD_REQUEST, &words.into())
        );
    }
    // 3: a digest the list doesn't hold, unpaid: a 404 before the price.
    let nobody = Made::preprod(b"nobody", 2, 3).withdrawal("preprod", 3);
    let (status, answer, _) = post(
        app,
        WITHDRAWALS,
        me,
        [&0u64.to_be_bytes()[..], &nobody].concat(),
    )
    .await;
    assert_eq!(
        (status, &answer["error"]),
        (StatusCode::NOT_FOUND, &"no such certificate".into())
    );
    // 5: the stamp, priced as a short envelope: 2 bits for a fresh address.
    let (status, answer, _) = post(
        app,
        WITHDRAWALS,
        me,
        unpaid(unlisting_digest("preprod", &good), &good),
    )
    .await;
    assert_eq!(
        (status, &answer["price"]),
        (StatusCode::PAYMENT_REQUIRED, &2.into())
    );
    // A stamp over the listing digest, a certificate's, isn't a withdrawal's.
    let (listing, unlisting) = (
        listing_digest("preprod", &good),
        unlisting_digest("preprod", &good),
    );
    let nonce = (0u64..)
        .find(|&n| stamp_bits(&listing, n) >= 2 && stamp_bits(&unlisting, n) < 2)
        .unwrap();
    let wrong = [&nonce.to_be_bytes()[..], &good].concat();
    let (status, _, _) = post(app, WITHDRAWALS, me, wrong).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    // 6: proved with another key, paid: a 400, counted against the address.
    let forged = e.withdrawal("preprod", 99);
    let (status, answer, _) =
        post(app, WITHDRAWALS, me, withdrawal_post("preprod", &forged, 2)).await;
    assert_eq!(
        (status, &answer["error"]),
        (
            StatusCode::BAD_REQUEST,
            &"the withdrawal's proof doesn't check".into()
        )
    );
    assert_eq!(page(app, me, None).await.2, 3);
    assert_eq!(relayed.relay.health()["preprod"]["certificates"], 1);
    // Taken, at the price now; the address is past the ceiling after it.
    let (status, answer, _) =
        post(app, WITHDRAWALS, me, withdrawal_post("preprod", &good, 3)).await;
    assert_eq!(
        (status, answer),
        (StatusCode::OK, json!({ "withdrawn": true }))
    );
    assert_eq!(page(app, me, None).await.2, 0);
    // 4: past the ceiling, a withdrawal of a held certificate, nonce 0,
    // learns its wait without solving.
    let f = Made::preprod(b"f", 3, 3);
    list(&relayed, &f, "198.51.100.2", 2).await;
    let (status, answer, retry) = post(
        app,
        WITHDRAWALS,
        me,
        [&0u64.to_be_bytes()[..], &f.withdrawal("preprod", 3)].concat(),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(answer["error"], "too many posts from this address for now");
    assert!(retry.unwrap() > 0);
}

/// A withdrawal lasts (check 3′): the withdrawn certificate's own bytes,
/// re-posted by anyone who kept them, are a 409 `withdrawn` before the
/// price, across a restart too; the same Seedelf, register and m_S made
/// with a fresh aux, another digest, is listed as ever.
#[tokio::test]
async fn a_withdrawal_lasts_and_a_fresh_certificate_is_taken() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-withdrawn-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let g = Made::preprod(b"g", 2, 3);
    {
        let relayed = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        list(&relayed, &g, "203.0.113.7", 1).await;
        let (status, _, _) = post(
            &relayed.app,
            WITHDRAWALS,
            "203.0.113.7",
            withdrawal_post("preprod", &g.withdrawal("preprod", 3), 1),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        // Its bytes again, unpaid: refused before the price, by any address.
        let (status, body, _) = post(
            &relayed.app,
            CERTIFICATES,
            "198.51.100.1",
            [&0u64.to_be_bytes()[..], &g.bytes()].concat(),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::CONFLICT, json!({ "error": "withdrawn" }))
        );
        relayed.relay.save(true);
    }
    // Saved with the list: the restart refuses them too.
    let relayed = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
    assert_eq!(relayed.relay.health()["preprod"]["withdrawn"], 1);
    relayed.chain("preprod").hold(&g.name, &g.register());
    let (status, body, _) = post(
        &relayed.app,
        CERTIFICATES,
        "198.51.100.1",
        paid(g.digest("preprod"), &g.bytes(), 1),
    )
    .await;
    assert_eq!(
        (status, &body["error"]),
        (StatusCode::CONFLICT, &"withdrawn".into())
    );
    // The owner turns Messages on again: a fresh aux, other bytes, kept.
    let again = Made {
        nonce: 2,
        ..Made::preprod(b"g", 2, 3)
    };
    assert_ne!(again.digest("preprod"), g.digest("preprod"));
    let (status, body, _) = post(
        &relayed.app,
        CERTIFICATES,
        "203.0.113.7",
        paid(again.digest("preprod"), &again.bytes(), 1),
    )
    .await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));
    // While it's held, the old bytes are "already": check 3 before 3′.
    let (status, body, _) = post(
        &relayed.app,
        CERTIFICATES,
        "198.51.100.1",
        paid(g.digest("preprod"), &g.bytes(), 1),
    )
    .await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// Withdraws `made`'s certificate from preprod, as its owner does.
async fn withdraw(relayed: &Relayed, made: &Made, client: &str) -> (StatusCode, Value) {
    let body = withdrawal_post("preprod", &made.withdrawal("preprod", made.x_m), 1);
    let (status, answer, _) = post(&relayed.app, WITHDRAWALS, client, body).await;
    (status, answer)
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// One Seedelf at one register, listed and withdrawn in a loop, each time
/// with a fresh aux: 128 times, then no certificate is listed for it there,
/// whatever its m_S, with words that say why. At 127, one more is listed
/// and a second isn't, so two listed then never make 129. Each loop left a
/// removal and a digest, so the cap bounds the loop; moving the Seedelf, a
/// new register, starts it fresh.
#[tokio::test]
async fn a_seedelf_withdrawn_128_times_at_its_register_takes_no_more_until_it_moves() {
    let relayed = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let posting = |nonce: u64, x_m: u64| Made {
        nonce,
        ..Made::preprod(b"loop", 2, x_m)
    };
    let words = "this Seedelf was withdrawn too often at this register: move it to list it again";
    for i in 0..128u64 {
        let client = format!("198.51.100.{}", i % 8);
        list(&relayed, &posting(100 + i, 3), &client, 1).await;
        if i == 127 {
            // Another m_S beside the last: refused, as it too could go.
            let other = posting(900, 4);
            let body = paid(other.digest("preprod"), &other.bytes(), 1);
            let (status, answer, _) = post(&relayed.app, CERTIFICATES, &client, body).await;
            assert_eq!(
                (status, &answer["error"]),
                (StatusCode::CONFLICT, &words.into())
            );
        }
        let (status, answer) = withdraw(&relayed, &posting(100 + i, 3), &client).await;
        assert_eq!(
            (status, answer),
            (StatusCode::OK, json!({ "withdrawn": true })),
            "{i}"
        );
    }
    assert_eq!(relayed.relay.health()["preprod"]["withdrawn"], 128);
    for made in [posting(500, 3), posting(501, 4)] {
        let body = paid(made.digest("preprod"), &made.bytes(), 1);
        let (status, answer, _) = post(&relayed.app, CERTIFICATES, "203.0.113.7", body).await;
        assert_eq!(
            (status, &answer["error"]),
            (StatusCode::CONFLICT, &words.into())
        );
        // Before the price: unpaid, the same.
        let unpaid = [&0u64.to_be_bytes()[..], &made.bytes()].concat();
        let (status, _, _) = post(&relayed.app, CERTIFICATES, "203.0.113.8", unpaid).await;
        assert_eq!(status, StatusCode::CONFLICT);
    }
    // Every withdrawn one is still refused as withdrawn.
    let old = posting(100, 3);
    let (status, answer, _) = post(
        &relayed.app,
        CERTIFICATES,
        "203.0.113.9",
        paid(old.digest("preprod"), &old.bytes(), 1),
    )
    .await;
    assert_eq!(
        (status, &answer["error"]),
        (StatusCode::CONFLICT, &"withdrawn".into())
    );
    // Moved: a new register, listed as ever.
    list(&relayed, &Made::preprod(b"loop", 3, 3), "203.0.113.7", 1).await;
}

/// An `already` names the certificate held, by its listing digest, which
/// may be another posting's bytes: a wallet that made its certificate again
/// with a fresh aux withdraws the one the list holds, and its own is then
/// listed.
#[tokio::test]
async fn an_already_names_the_bytes_held_so_their_withdrawal_takes_them() {
    let relayed = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let first = Made::preprod(b"lena", 2, 3);
    let again = Made {
        nonce: 2,
        ..Made::preprod(b"lena", 2, 3)
    };
    assert_ne!(first.digest("preprod"), again.digest("preprod"));
    relayed
        .chain("preprod")
        .hold(&first.name, &first.register());
    let (status, answer, _) = post(
        &relayed.app,
        CERTIFICATES,
        "203.0.113.7",
        paid(first.digest("preprod"), &first.bytes(), 1),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        answer,
        json!({ "kept": "new", "digest": hex_of(&first.digest("preprod")) })
    );
    let (status, answer, _) = post(
        &relayed.app,
        CERTIFICATES,
        "203.0.113.8",
        [&0u64.to_be_bytes()[..], &again.bytes()].concat(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        answer,
        json!({ "kept": "already", "digest": hex_of(&first.digest("preprod")) })
    );
    // The held bytes' withdrawal takes them; the fresh posting's would be a 404.
    let (status, _) = withdraw(&relayed, &again, "203.0.113.8").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = withdraw(&relayed, &first, "203.0.113.8").await;
    assert_eq!(status, StatusCode::OK);
    let (status, answer, _) = post(
        &relayed.app,
        CERTIFICATES,
        "203.0.113.8",
        paid(again.digest("preprod"), &again.bytes(), 1),
    )
    .await;
    assert_eq!(
        answer,
        json!({ "kept": "new", "digest": hex_of(&again.digest("preprod")) }),
        "{status}"
    );
}

/// A taken withdrawal is saved before its answer: a crash right after it,
/// with no minute's save, still finds the certificate gone and its digest
/// kept.
#[tokio::test]
async fn a_taken_withdrawal_is_saved_before_its_answer() {
    let dir = std::env::temp_dir().join(format!(
        "seedelf-relay-withdrawal-saved-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mona = Made::preprod(b"mona", 2, 3);
    {
        let relayed = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        list(&relayed, &mona, "203.0.113.7", 1).await;
        let (status, _) = withdraw(&relayed, &mona, "203.0.113.7").await;
        assert_eq!(status, StatusCode::OK);
        // Dropped here with no save: a crash.
    }
    let relayed = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
    assert_eq!(relayed.relay.health()["preprod"]["certificates"], 0);
    assert_eq!(relayed.relay.health()["preprod"]["withdrawn"], 1);
    relayed.chain("preprod").hold(&mona.name, &mona.register());
    let (status, answer, _) = post(
        &relayed.app,
        CERTIFICATES,
        "198.51.100.1",
        paid(mona.digest("preprod"), &mona.bytes(), 1),
    )
    .await;
    assert_eq!(
        (status, &answer["error"]),
        (StatusCode::CONFLICT, &"withdrawn".into())
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

/// A withdrawal whose save fails is put back: a 503 `can't save now`, its
/// certificate listed again after its removal, so a reader who read the
/// removal reads it again, and its digest not kept; withdrawn again once
/// the list saves, it's taken, and the file holds that.
#[tokio::test]
async fn a_withdrawal_whose_save_fails_is_put_back_and_answers_503() {
    let dir = std::env::temp_dir().join(format!(
        "seedelf-relay-withdrawal-unsaved-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("messaging-preprod.list");
    let rosa = Made::preprod(b"rosa", 2, 3);
    {
        let relayed = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        list(&relayed, &rosa, "203.0.113.7", 1).await;
        relayed.relay.save(false);
        let before = page(&relayed.app, "203.0.113.7", None).await.1;
        // A folder where the list's file goes: every save fails.
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        let body = withdrawal_post("preprod", &rosa.withdrawal("preprod", rosa.x_m), 1);
        let (status, answer, retry) = post(&relayed.app, WITHDRAWALS, "203.0.113.7", body).await;
        assert_eq!(
            (status, answer, retry),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "error": "can't save now" }),
                Some(60)
            )
        );
        assert_eq!(relayed.relay.health()["preprod"]["certificates"], 1);
        assert_eq!(relayed.relay.health()["preprod"]["withdrawn"], 0);
        let (flags, _, _, entries) = page(&relayed.app, "203.0.113.7", Some(before)).await;
        assert_eq!(
            (flags, entries),
            (
                0,
                vec![(2, rosa.digest("preprod").to_vec()), (1, rosa.bytes())]
            )
        );
        // Its bytes aren't withdrawn: posted again, they're "already".
        let (status, answer, _) = post(
            &relayed.app,
            CERTIFICATES,
            "198.51.100.1",
            paid(rosa.digest("preprod"), &rosa.bytes(), 1),
        )
        .await;
        assert_eq!(
            (status, &answer["kept"]),
            (StatusCode::OK, &"already".into())
        );
        // The disk back: taken.
        std::fs::remove_dir(&file).unwrap();
        let (status, answer) = withdraw(&relayed, &rosa, "203.0.113.7").await;
        assert_eq!(
            (status, answer),
            (StatusCode::OK, json!({ "withdrawn": true }))
        );
        // Dropped with no save: a crash.
    }
    let relayed = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
    assert_eq!(relayed.relay.health()["preprod"]["certificates"], 0);
    assert_eq!(relayed.relay.health()["preprod"]["withdrawn"], 1);
    std::fs::remove_dir_all(&dir).unwrap();
}

fn hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

/// The file's withdrawals as a wallet posts them: its good certificates
/// listed in their pools, the refusals posted first, answered by the
/// route's checks (a 413 or 400 for its length or shape, a 404 for a digest
/// the list doesn't hold, a 400 for a proof that doesn't check against the
/// certificate the file checks it against), then each good withdrawal
/// taken, its stamp solved over the file's `unlisting_digest`. A refusal
/// whose digest names a held certificate other than the one the file checks
/// it against isn't posted: the relay checks a withdrawal against the
/// certificate its digest names, and the unit replay (certificate.rs) holds
/// every refusal to the file.
#[tokio::test]
async fn the_files_withdrawals_are_taken_and_its_refusals_refused_through_the_app() {
    let file: Value = serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_certificate_v1.json"
    ))
    .unwrap();
    let relayed = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let app = &relayed.app;
    let mut held = vec![];
    for vector in file["certificates"].as_array().unwrap() {
        let pool = vector["pool"].as_str().unwrap();
        let certificate = hex(vector["certificate"].as_str().unwrap());
        let n = certificate[31] as usize;
        relayed
            .chain(pool)
            .hold(&certificate[32..32 + n], &certificate[32 + n..32 + n + 96]);
        let body = paid(listing_digest(pool, &certificate), &certificate, 1);
        let (status, _, _) = post(
            app,
            &format!("/messaging/v1/{pool}/certificates"),
            "198.51.100.1",
            body,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{}", vector["name"]);
        held.push((pool, listing_digest(pool, &certificate)));
    }
    let (mut posted, mut skipped) = (0, 0);
    for (i, vector) in file["withdrawal_refusals"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        if vector["result"] == "ok" {
            continue;
        }
        let name = vector["name"].as_str().unwrap();
        let pool = match vector["network"].as_u64().unwrap() {
            1 => "mainnet",
            _ => "preprod",
        };
        let withdrawal = hex(vector["withdrawal"].as_str().unwrap());
        let body = withdrawal_post(pool, &withdrawal, 1);
        let shape = seedelf_data_api::messaging::certificate::check_withdrawal_shape(
            &withdrawal,
            vector["network"].as_u64().unwrap() as u8,
        );
        let against = &vector["against"];
        let against_pool = match against["network"].as_u64().unwrap() {
            1 => "mainnet",
            _ => "preprod",
        };
        let against_digest =
            listing_digest(against_pool, &hex(against["certificate"].as_str().unwrap()));
        let expected = if body.len() > 106 {
            StatusCode::PAYLOAD_TOO_LARGE
        } else if shape.is_err() {
            StatusCode::BAD_REQUEST
        } else {
            let digest: [u8; 32] = withdrawal[2..34].try_into().unwrap();
            match (
                held.contains(&(pool, digest)),
                digest == against_digest && pool == against_pool,
            ) {
                (false, _) => StatusCode::NOT_FOUND,
                (true, true) => StatusCode::BAD_REQUEST,
                (true, false) => {
                    skipped += 1;
                    continue;
                }
            }
        };
        posted += 1;
        let client = format!("203.0.113.{i}");
        let (status, answer, _) = post(
            app,
            &format!("/messaging/v1/{pool}/withdrawals"),
            &client,
            body,
        )
        .await;
        assert_eq!(status, expected, "{name}: {answer}");
    }
    assert!(
        posted >= 20 && skipped <= 5,
        "{posted} posted, {skipped} skipped"
    );
    assert_eq!(relayed.relay.health()["preprod"]["certificates"], 2);
    assert_eq!(relayed.relay.health()["mainnet"]["certificates"], 2);
    for vector in file["withdrawals"].as_array().unwrap() {
        let name = vector["name"].as_str().unwrap();
        let pool = vector["pool"].as_str().unwrap();
        let withdrawal = hex(vector["withdrawal"].as_str().unwrap());
        let digest: [u8; 32] = hex(vector["unlisting_digest"].as_str().unwrap())
            .try_into()
            .unwrap();
        assert_eq!(unlisting_digest(pool, &withdrawal), digest, "{name}");
        let (status, answer, _) = post(
            app,
            &format!("/messaging/v1/{pool}/withdrawals"),
            "198.51.100.2",
            paid(digest, &withdrawal, 1),
        )
        .await;
        assert_eq!(
            (status, answer),
            (StatusCode::OK, json!({ "withdrawn": true })),
            "{name}"
        );
    }
    for pool in ["preprod", "mainnet"] {
        assert_eq!(relayed.relay.health()[pool]["certificates"], 0);
        assert_eq!(relayed.relay.health()[pool]["withdrawn"], 2);
    }
}

/// The edge on the route, as on the list's: the off switch's 410, unread;
/// a GET with a body refused unread; one without, no such method; CORS on
/// the answer.
#[tokio::test]
async fn the_edge_and_the_off_switch_stand_in_front_of_withdrawals() {
    let off = relayed_as(Relay::with_pools(None, &CHEAP_POOLS), true);
    let h = Made::preprod(b"h", 2, 3);
    let body = withdrawal_post("preprod", &h.withdrawal("preprod", 3), 1);
    let response = off
        .app
        .clone()
        .oneshot(request(
            "203.0.113.7",
            Method::POST,
            WITHDRAWALS,
            body.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::GONE);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);

    let relayed = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let get = |body: Vec<u8>| request("203.0.113.7", Method::GET, WITHDRAWALS, body);
    let response = relayed.app.clone().oneshot(get(vec![1; 10])).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let response = relayed.app.clone().oneshot(get(vec![])).await.unwrap();
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    let (status, _, _) = post(
        &relayed.app,
        "/messaging/v1/elsewhere/withdrawals",
        "203.0.113.7",
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    list(&relayed, &h, "203.0.113.7", 1).await;
    let response = relayed
        .app
        .clone()
        .oneshot(request("203.0.113.7", Method::POST, WITHDRAWALS, body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
}
