//! The list of certificates through the whole app, offline (web wallet
//! chunk 55's 55c; docs/protocol.md §21.7): the certificate vectors posted
//! as a wallet posts them, every check's order and answer, a Seedelf's two,
//! the cap and never an eviction, pages behind a cursor, the day's reading,
//! the edge and the off switch on the new routes, and a restart that keeps
//! the list. No source is up. Each pool's view of the chain is a Koios on
//! loopback that holds every Seedelf a test posts where its certificate says
//! it is, so check 8 passes here and the list is what's tested; the chain
//! check's own tests are messaging_chain.rs.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use axum::response::Response;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress, Part};
use seedelf_data_api::messaging::certificate::{
    NETWORK_MAINNET, NETWORK_PREPROD, POLICY, check_certificate, listing_digest,
};
use seedelf_data_api::messaging::check::{stamp_bits, stamp_digest};
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::reading::Reading;
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Listing, POOLS, Relay};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{KoiosMock, Made};
use seedelf_data_api::messaging::view::{Koios, View};

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";
const CERTIFICATES: &str = "/messaging/v1/preprod/certificates";
const ENVELOPES: &str = "/messaging/v1/preprod/envelopes";

/// The app, and each pool's Koios, which holds each Seedelf a post names
/// where its certificate says it is, as the post is sent.
struct App {
    router: Router,
    chains: Vec<(&'static str, KoiosMock)>,
}

impl App {
    /// The chain holds the Seedelf a certificate post to `path` names at
    /// the register it names: a post that isn't a certificate's shape holds
    /// nothing.
    fn follow(&self, path: &str, body: &[u8]) {
        let Some((_, chain)) = self
            .chains
            .iter()
            .find(|(pool, _)| path.contains(&format!("/{pool}/")))
        else {
            return;
        };
        let Some(certificate) = body.get(8..).filter(|c| c.len() > 33) else {
            return;
        };
        let n = certificate[31] as usize;
        if let (Some(name), Some(register)) = (
            certificate.get(32..32 + n),
            certificate.get(32 + n..32 + n + 96),
        ) && path.ends_with("/certificates")
        {
            chain.hold(name, register);
        }
    }
}

struct Relayed {
    app: App,
    edge: Arc<Edge>,
    relay: Arc<Relay>,
}

fn relayed(relay: Relay) -> Relayed {
    relayed_as(relay, false)
}

/// The app with `relay`, 1 MB of messaging's traffic for today, and
/// messaging `off` (`DATA_MESSAGING_OFF`) or on.
fn relayed_as(relay: Relay, off: bool) -> Relayed {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(
        Edge::new(true, vec![WALLET.to_string()], Egress::new(None, None))
            .with_messaging_egress(Egress::with_share_today(1_000_000))
            .with_messaging_off(off),
    );
    let chains: Vec<(&'static str, KoiosMock)> = ["mainnet", "preprod"]
        .into_iter()
        .map(|pool| (pool, KoiosMock::start()))
        .collect();
    // Nothing kept: these tests move one name between registers within a
    // minute, which the chain never does (the cache's own tests are
    // messaging_chain.rs's).
    let relay = chains.iter().fold(relay, |relay, (pool, chain)| {
        let koios = Koios::with(&chain.url, Duration::from_secs(5), Duration::ZERO).unwrap();
        relay.with_view(pool, View::Koios(koios))
    });
    let relay = Arc::new(relay);
    let router = seedelf_data_api::app(
        state,
        submit,
        edge.clone(),
        relay.clone(),
        &[WALLET.to_string()],
    );
    Relayed {
        app: App { router, chains },
        edge,
        relay,
    }
}

/// A price a test pays at once: 1 bit, whatever is posted.
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

/// Both pools at [`CHEAP`], their lists as they are.
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

/// Preprod's pool at [`CHEAP`], its list's cap three short certificates.
static SMALL_LIST: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: CHEAP,
    window: WINDOW,
    list: Listing {
        network: NETWORK_PREPROD,
        cap: 3 * 273,
    },
}];

/// As messaging.rs's: a bit more for every 0.8 of the address's recent
/// units, from a base of 1, to a ceiling of 3. A first short post costs 2
/// bits and the next 3; the third is past the ceiling.
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

/// Preprod's pool at [`CHEAP`], with a window of three posts.
static SMALL_WINDOW: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: CHEAP,
    window: Limits {
        envelopes: 3,
        units: 4096,
    },
    list: POOLS[1].list,
}];

fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_certificate_v1.json"
    ))
    .unwrap()
}

fn relay_vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_relay_v1.json"
    ))
    .unwrap()
}

fn hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

/// A short certificate of its own for preprod: Seedelf `i`'s, 273 bytes.
fn short(i: u64) -> Vec<u8> {
    Made::preprod(&[0x5e], 100 + i, 3).bytes()
}

/// `certificate` with its last byte changed: z_m's, so the shape and the
/// points pass and the proof doesn't.
fn broken(certificate: &[u8]) -> Vec<u8> {
    let mut bytes = certificate.to_vec();
    *bytes.last_mut().unwrap() ^= 1;
    bytes
}

/// A post to `pool` with at least `bits` of work.
fn paid(pool: &str, certificate: &[u8], bits: u32) -> Vec<u8> {
    let digest = listing_digest(pool, certificate);
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= bits).unwrap();
    [&nonce.to_be_bytes()[..], certificate].concat()
}

/// A post with too little work for any price.
fn unpaid(pool: &str, certificate: &[u8]) -> Vec<u8> {
    let digest = listing_digest(pool, certificate);
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) == 0).unwrap();
    [&nonce.to_be_bytes()[..], certificate].concat()
}

/// A post with nonce 0, unsolved.
fn nonce_zero(certificate: &[u8]) -> Vec<u8> {
    [&0u64.to_be_bytes()[..], certificate].concat()
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

async fn send(app: &App, request: Request<Body>) -> Response {
    app.router.clone().oneshot(request).await.unwrap()
}

/// A post's status, its JSON and its `Retry-After`.
async fn post_to(
    app: &App,
    path: &str,
    client: &str,
    body: Vec<u8>,
) -> (StatusCode, Value, Option<u64>) {
    app.follow(path, &body);
    let response = send(app, request(client, Method::POST, path, body)).await;
    let status = response.status();
    let retry = response
        .headers()
        .get(header::RETRY_AFTER)
        .map(|value| value.to_str().unwrap().parse().unwrap());
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap(), retry)
}

async fn post(app: &App, client: &str, body: Vec<u8>) -> (StatusCode, Value) {
    let (status, body, _) = post_to(app, CERTIFICATES, client, body).await;
    (status, body)
}

#[derive(Debug)]
struct Page {
    flags: u8,
    cursor: u64,
    price: u8,
    /// Each entry's kind and bytes.
    entries: Vec<(u8, Vec<u8>)>,
    len: usize,
}

impl Page {
    fn certificates(&self) -> Vec<Vec<u8>> {
        self.entries
            .iter()
            .filter(|(kind, _)| *kind == 1)
            .map(|(_, bytes)| bytes.clone())
            .collect()
    }
}

/// A page of the list, parsed from its format (src/messaging/list.rs,
/// `encode`).
fn parse(bytes: &[u8]) -> Page {
    assert_eq!(bytes[0], 1);
    let count = u16::from_be_bytes([bytes[11], bytes[12]]) as usize;
    let mut at = 13;
    let mut entries = vec![];
    for _ in 0..count {
        let kind = bytes[at];
        let len = u16::from_be_bytes([bytes[at + 1], bytes[at + 2]]) as usize;
        entries.push((kind, bytes[at + 3..at + 3 + len].to_vec()));
        at += 3 + len;
    }
    assert_eq!(at, bytes.len());
    Page {
        flags: bytes[1],
        cursor: u64::from_be_bytes(bytes[2..10].try_into().unwrap()),
        price: bytes[10],
        entries,
        len: bytes.len(),
    }
}

async fn page_of(app: &App, path: &str, client: &str, after: Option<u64>) -> Page {
    let path = match after {
        Some(after) => format!("{path}?after={after}"),
        None => path.to_string(),
    };
    let response = send(app, request(client, Method::GET, &path, vec![])).await;
    assert_eq!(response.status(), StatusCode::OK, "{path}");
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/octet-stream"
    );
    parse(&to_bytes(response.into_body(), 1 << 20).await.unwrap())
}

async fn page(app: &App, client: &str, after: Option<u64>) -> Page {
    page_of(app, CERTIFICATES, client, after).await
}

/// An envelope page's four prices.
async fn envelope_prices(app: &App, client: &str) -> [u8; 4] {
    let response = send(app, request(client, Method::GET, ENVELOPES, vec![])).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    bytes[10..14].try_into().unwrap()
}

/// The vectors through the app, read as the relay reads a post: every
/// refusal whose policy is the pool's posted, paid, to its network's pool,
/// each from an address of its own, and answered 400 with its words; then
/// every good certificate listed, and its bytes again "already". A refusal
/// that names a held certificate's Seedelf, register and m_S, with a broken
/// proof, is "already" once that one is held: check 3 before check 7.
#[tokio::test]
async fn every_vector_is_judged_through_the_app_as_the_crate_judges_it() {
    let Relayed { app, relay, .. } = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let v = vectors();
    let pool_of = |vector: &Value| match vector["network"].as_u64().unwrap() as u8 {
        NETWORK_MAINNET => "mainnet",
        _ => "preprod",
    };
    let ours = |vector: &Value| hex(vector["policy"].as_str().unwrap()) == POLICY;
    let path = |pool: &str| format!("/messaging/v1/{pool}/certificates");
    let mut refused = vec![];
    for (i, vector) in v["refusals"].as_array().unwrap().iter().enumerate() {
        let name = vector["name"].as_str().unwrap();
        let certificate = hex(vector["certificate"].as_str().unwrap());
        if !ours(vector) || vector["result"] == "ok" {
            continue;
        }
        let pool = pool_of(vector);
        let client = format!("203.0.{}.{}", i / 250, i % 250);
        let (status, body, _) =
            post_to(&app, &path(pool), &client, paid(pool, &certificate, 1)).await;
        // Past 304 bytes the body is past what the route takes: the edge's
        // 413, before the relay reads it.
        let expected = if certificate.len() > 304 {
            StatusCode::PAYLOAD_TOO_LARGE
        } else {
            StatusCode::BAD_REQUEST
        };
        assert_eq!(status, expected, "{name}: {body}");
        assert!(body["error"].is_string(), "{name}");
        refused.push((pool, certificate));
    }
    assert!(refused.len() >= 55, "{}", refused.len());
    assert_eq!(relay.health()["preprod"]["certificates"], 0);
    assert_eq!(relay.health()["mainnet"]["certificates"], 0);
    // A vector read under another policy: the relay reads every certificate
    // under the variant's, so what it makes of one is its own reading's.
    let judged =
        |certificate: &[u8], network: u8| match check_certificate(certificate, network, &POLICY) {
            Ok(()) => StatusCode::OK,
            Err(_) if certificate.len() > 304 => StatusCode::PAYLOAD_TOO_LARGE,
            Err(_) => StatusCode::BAD_REQUEST,
        };
    for vector in v["refusals"].as_array().unwrap() {
        if !ours(vector) {
            let certificate = hex(vector["certificate"].as_str().unwrap());
            let pool = pool_of(vector);
            let network = vector["network"].as_u64().unwrap() as u8;
            let (status, body, _) = post_to(
                &app,
                &path(pool),
                "198.51.100.9",
                paid(pool, &certificate, 1),
            )
            .await;
            assert_eq!(
                status,
                judged(&certificate, network),
                "{}: {body}",
                vector["name"]
            );
        }
    }
    // Every good certificate is listed in its own network's pool, its stamp
    // solved over the file's listing digest, and refused at the other's
    // shape; its bytes again are "already".
    for vector in v["certificates"].as_array().unwrap() {
        let name = vector["name"].as_str().unwrap();
        let certificate = hex(vector["certificate"].as_str().unwrap());
        let pool = pool_of(vector);
        assert_eq!(vector["pool"], pool, "{name}");
        let digest: [u8; 32] = hex(vector["listing_digest"].as_str().unwrap())
            .try_into()
            .unwrap();
        assert_eq!(listing_digest(pool, &certificate), digest, "{name}");
        let other = if pool == "mainnet" {
            "preprod"
        } else {
            "mainnet"
        };
        let (status, body, _) = post_to(
            &app,
            &path(other),
            "198.51.100.1",
            paid(other, &certificate, 1),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{name}: {body}");
        let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= 1).unwrap();
        let solved = [&nonce.to_be_bytes()[..], &certificate].concat();
        let (status, body, _) = post_to(&app, &path(pool), "198.51.100.1", solved).await;
        assert_eq!(status, StatusCode::OK, "{name}: {body}");
        assert!(body["kept"] == "new" || body["kept"] == "already", "{name}");
        let (status, body, _) =
            post_to(&app, &path(pool), "198.51.100.2", nonce_zero(&certificate)).await;
        assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
        // It names the certificate held, by its listing digest: the file's.
        assert_eq!(body["digest"], vector["listing_digest"], "{name}: {body}");
        assert_eq!(body.as_object().unwrap().len(), 2, "{name}: {body}");
    }
    // Each pool holds one certificate for each distinct listing the file's
    // good ones name in its network (statement less its head: N, the
    // register and m_S).
    let listings = |network: u8| {
        let mut seen = std::collections::BTreeSet::new();
        for vector in v["certificates"].as_array().unwrap() {
            let certificate = hex(vector["certificate"].as_str().unwrap());
            if certificate[1] == network {
                seen.insert(certificate[31..certificate.len() - 96].to_vec());
            }
        }
        seen.len()
    };
    assert_eq!(
        relay.health()["preprod"]["certificates"],
        listings(NETWORK_PREPROD)
    );
    assert_eq!(
        relay.health()["mainnet"]["certificates"],
        listings(NETWORK_MAINNET)
    );
    // A refusal for a held listing with a broken proof: "already".
    let mut already = 0;
    for (pool, certificate) in &refused {
        let (status, body, _) =
            post_to(&app, &path(pool), "198.51.100.3", nonce_zero(certificate)).await;
        if status == StatusCode::OK {
            assert_eq!(body["kept"], "already");
            already += 1;
        }
    }
    assert!(already >= 5, "{already}");
    assert_eq!(
        relay.health()["preprod"]["certificates"],
        listings(NETWORK_PREPROD)
    );
    // Each pool's list holds its network's.
    let listed = page(&app, "192.0.2.1", None).await.certificates();
    assert_eq!(listed.len(), listings(NETWORK_PREPROD));
    for certificate in listed {
        assert_eq!(certificate[1], NETWORK_PREPROD);
    }
}

/// The test's maker makes what the relay lists: a short and a long name,
/// and every good certificate's bytes come back from a page as posted.
#[tokio::test]
async fn a_certificate_is_listed_and_every_reader_reads_it() {
    let Relayed { app, relay, .. } = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let start = page(&app, "203.0.113.9", None).await;
    assert!(start.entries.is_empty());
    assert_eq!((start.flags, start.len), (0, 13));
    let made = [
        Made::preprod(&[0x5e], 2, 3).bytes(),
        Made::preprod(&[0x5e; 32], 2, 3).bytes(),
    ];
    assert_eq!(made.each_ref().map(|m| m.len()), [273, 304]);
    for certificate in &made {
        let (status, body) = post(&app, "203.0.113.7", paid("preprod", certificate, 1)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let digest: String = listing_digest("preprod", certificate)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(body, serde_json::json!({ "kept": "new", "digest": digest }));
    }
    let read = page(&app, "203.0.113.9", Some(start.cursor)).await;
    assert_eq!(read.flags, 0);
    assert_eq!(read.certificates(), made.to_vec());
    assert!(read.entries.iter().all(|(kind, _)| *kind == 1));
    let again = page(&app, "203.0.113.9", Some(read.cursor)).await;
    assert!(again.entries.is_empty());
    assert_eq!(again.cursor, read.cursor);
    // A reader with no cursor reads them all, told of no gap.
    let fresh = page(&app, "198.51.100.1", None).await;
    assert_eq!((fresh.flags, fresh.certificates()), (0, made.to_vec()));
    assert_eq!(relay.health()["preprod"]["certificates"], 2);
    assert_eq!(relay.health()["preprod"]["envelopes"], 0);
}

/// §21.7's rows 1 to 5 through the app, each before the next: a body
/// without a nonce; the shape before the price; "already" before the price
/// and the stamp; the price and the window before the stamp; and the stamp,
/// a 402 naming the price.
#[tokio::test]
async fn the_cheap_checks_come_first_and_already_before_the_price() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &LOW_CEILING));
    let me = "203.0.113.7";
    // 1: no nonce.
    let (status, body) = post(&app, me, vec![0; 7]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "a post is a nonce, then a certificate");
    // A fresh address is asked 2 bits; an unpaid post is told so.
    assert_eq!(page(&app, me, None).await.price, 2);
    let (status, body) = post(&app, me, unpaid("preprod", &short(1))).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(body["price"], 2);
    // Two listed: the address is past the ceiling, and the page says 0.
    for (i, bits) in [(1, 2), (2, 3)] {
        let (status, body) = post(&app, me, paid("preprod", &short(i), bits)).await;
        assert_eq!(
            (status, &body["kept"]),
            (StatusCode::OK, &"new".into()),
            "{i}"
        );
    }
    assert_eq!(page(&app, me, None).await.price, 0);
    // 4: a new certificate, nonce 0, learns its wait without solving.
    let (status, body, retry) = post_to(&app, CERTIFICATES, me, nonce_zero(&short(3))).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"], "too many posts from this address for now");
    assert!(retry.unwrap() % 15 == 0 && retry.unwrap() <= 3600);
    // 3: a held one is "already", nonce 0, past the ceiling, and so is the
    // same listing with a fresh aux, other bytes.
    let (status, body) = post(&app, me, nonce_zero(&short(1))).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    let fresh_aux = Made {
        nonce: 9,
        ..Made::preprod(&[0x5e], 101, 3)
    }
    .bytes();
    assert_ne!(fresh_aux, short(1));
    let (status, body) = post(&app, me, nonce_zero(&fresh_aux)).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    // 2: the shape before the price, whatever the address's count.
    let mut version = short(4);
    version[0] = 2;
    let (status, body) = post(&app, me, nonce_zero(&version)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "not a version 1 certificate");
    let mut mainnets = short(4);
    mainnets[1] = NETWORK_MAINNET;
    let (status, _) = post(&app, me, nonce_zero(&mainnets)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(&app, me, nonce_zero(&short(4)[..272])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // An envelope isn't a certificate.
    let envelope = hex(relay_vectors()["posts"][0]["envelope"].as_str().unwrap());
    let (status, _) = post(&app, me, nonce_zero(&envelope[..300])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Another address is priced as ever.
    assert_eq!(page(&app, "198.51.100.1", None).await.price, 2);
}

/// A certificate is priced and counted as a 512-byte envelope from its
/// address (§21.7's row 4): it moves the envelope page's prices as a short
/// envelope does, fills the address's window as one, and the list's page
/// says what the envelope page says for 512 bytes.
#[tokio::test]
async fn a_certificate_counts_as_a_short_envelope_in_the_price_and_the_window() {
    // The pools as they are: 16 bits on preprod, 18 on mainnet.
    let Relayed { app, .. } = relayed(Relay::new(None));
    let me = "203.0.113.7";
    assert_eq!(page(&app, me, None).await.price, 16);
    let mainnet = page_of(&app, "/messaging/v1/mainnet/certificates", me, None).await;
    assert_eq!(mainnet.price, 18);
    let (status, body) = post(&app, me, unpaid("preprod", &short(1))).await;
    assert_eq!(
        (status, &body["price"]),
        (StatusCode::PAYMENT_REQUIRED, &16.into())
    );
    // Work done for mainnet's list is no work at preprod's, nor is work over
    // an envelope's stamp digest of the same bytes (§21.7's own label).
    let (status, _) = post(&app, me, paid("mainnet", &short(1), 16)).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    let digest = stamp_digest("preprod", &short(1));
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= 16).unwrap();
    let envelope_work = [&nonce.to_be_bytes()[..], &short(1)].concat();
    let (status, _) = post(&app, me, envelope_work).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    let (status, body) = post(&app, me, paid("preprod", &short(1), 16)).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));

    let Relayed { app, .. } = relayed(Relay::with_pools(None, &SMALL_WINDOW));
    for i in 0..3 {
        let (status, body) = post(&app, me, paid("preprod", &short(i), 1)).await;
        assert_eq!(status, StatusCode::OK, "{i}: {body}");
    }
    // Three certificates fill a window of three: no envelope fits, and the
    // list's page says 0 too.
    assert_eq!(envelope_prices(&app, me).await, [0; 4]);
    assert_eq!(page(&app, me, None).await.price, 0);
    let (status, body, retry) =
        post_to(&app, CERTIFICATES, me, paid("preprod", &short(3), 1)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        body["error"],
        "this address's share of the pool is full for now"
    );
    assert!(retry.unwrap() > 36 * 3600);
    // Another address posts as before.
    let other = "198.51.100.1";
    assert_eq!(envelope_prices(&app, other).await, [1; 4]);
    assert_eq!(page(&app, other, None).await.price, 1);
    let (status, _) = post(&app, other, paid("preprod", &short(3), 1)).await;
    assert_eq!(status, StatusCode::OK);
}

/// §21.7's row 6, and never an eviction: a Seedelf at its register takes
/// two m_S at most, a third is a 409 whatever room the list has, and the
/// two held are read and "already" as before.
#[tokio::test]
async fn a_seedelf_takes_two_certificates_and_a_third_is_refused() {
    let Relayed { app, relay, .. } = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let me = "203.0.113.7";
    let value = |x_m: u64| Made::preprod(&[0x5e], 2, x_m).bytes();
    for x_m in [3, 4] {
        let (status, body) = post(&app, me, paid("preprod", &value(x_m), 1)).await;
        assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));
    }
    let (status, body) = post(&app, me, paid("preprod", &value(5), 1)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body,
        serde_json::json!({ "error": "two certificates for this Seedelf already" })
    );
    // The same name at another register is another Seedelf; another name
    // at the same register too.
    let moved = Made::preprod(&[0x5e], 3, 5).bytes();
    let renamed = Made::preprod(&[0x5f], 2, 5).bytes();
    for certificate in [&moved, &renamed] {
        let (status, body) = post(&app, me, paid("preprod", certificate, 1)).await;
        assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));
    }
    // Both held are still "already", and nothing was pushed out.
    for x_m in [3, 4] {
        let (status, body) = post(&app, me, nonce_zero(&value(x_m))).await;
        assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    }
    assert_eq!(
        page(&app, me, None).await.certificates(),
        vec![value(3), value(4), moved, renamed]
    );
    assert_eq!(relay.health()["preprod"]["certificates"], 4);
}

/// The cap: a full list is a 503 to every certificate it doesn't hold,
/// with an hour's `Retry-After`; it pushes none out however many come;
/// what it holds is still "already".
#[tokio::test]
async fn a_full_list_is_a_503_and_pushes_nothing_out() {
    let Relayed { app, relay, .. } = relayed(Relay::with_pools(None, &SMALL_LIST));
    for i in 0..3 {
        let (status, body) = post(&app, "203.0.113.7", paid("preprod", &short(i), 1)).await;
        assert_eq!(status, StatusCode::OK, "{i}: {body}");
    }
    let held = page(&app, "192.0.2.1", None).await;
    for (i, client) in (3..8).zip([
        "203.0.113.7",
        "198.51.100.1",
        "198.51.100.2",
        "2001:db8::1",
        "198.51.100.3",
    ]) {
        let (status, body, retry) =
            post_to(&app, CERTIFICATES, client, paid("preprod", &short(i), 1)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{client}");
        assert_eq!(body["error"], "the list is full");
        assert_eq!(retry, Some(3600));
    }
    // A long one doesn't fit either.
    let long = Made::preprod(&[0x5e; 32], 9, 3).bytes();
    let (status, _) = post(&app, "203.0.113.7", paid("preprod", &long, 1)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let (status, body) = post(&app, "203.0.113.9", nonce_zero(&short(0))).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    let after = page(&app, "192.0.2.1", None).await;
    assert_eq!(after.certificates(), held.certificates());
    assert_eq!(after.certificates(), vec![short(0), short(1), short(2)]);
    assert!(after.entries.iter().all(|(kind, _)| *kind == 1));
    assert_eq!(relay.health()["preprod"]["certificates"], 3);
}

/// §21.7's rows 6 and 7: room comes before the proof, so a broken proof
/// for a Seedelf with two, or to a full list, is told of the room and costs
/// no proof check; then the proof, a 400 counted against its address's own
/// price, as an envelope's bad point is, and nobody else's.
#[tokio::test]
async fn room_comes_before_the_proof_and_a_bad_proof_costs_its_address() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &SMALL_LIST));
    let me = "203.0.113.7";
    let value = |x_m: u64| Made::preprod(&[0x5e], 2, x_m).bytes();
    for x_m in [3, 4] {
        let (status, _) = post(&app, me, paid("preprod", &value(x_m), 1)).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _) = post(&app, me, paid("preprod", &broken(&value(5)), 1)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(&app, me, paid("preprod", &short(1), 1)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = post(&app, me, paid("preprod", &broken(&short(2)), 1)).await;
    assert_eq!(
        (status, &body["error"]),
        (StatusCode::SERVICE_UNAVAILABLE, &"the list is full".into())
    );

    let Relayed { app, relay, .. } = relayed(Relay::with_pools(None, &LOW_CEILING));
    assert_eq!(page(&app, me, None).await.price, 2);
    let (status, body) = post(&app, me, paid("preprod", &broken(&short(1)), 2)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "the certificate's proof doesn't check");
    // A bad point is refused there too, and named as one.
    let mut point = short(2);
    point[40] ^= 0xff;
    let (status, body) = post(&app, me, paid("preprod", &point, 3)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("point"), "{body}");
    // Two refused: past the ceiling, for its address alone.
    assert_eq!(page(&app, me, None).await.price, 0);
    assert_eq!(page(&app, "198.51.100.1", None).await.price, 2);
    assert_eq!(relay.health()["preprod"]["certificates"], 0);
}

/// Pages behind a cursor: at most 64 KiB of entries a page, always one,
/// bit 0 while more follow, every certificate once and in order; then only
/// what's new; and a cursor the list never gave is a gap, the page from the
/// oldest.
#[tokio::test]
async fn the_list_pages_in_order_behind_a_cursor() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let start = page(&app, "192.0.2.1", None).await;
    // 64 KiB holds 215 certificates of 304 bytes: 220 make two pages.
    let made: Vec<Vec<u8>> = (0..220)
        .map(|i| Made::preprod(&[0x5e; 32], 1000 + i, 3).bytes())
        .collect();
    for (i, certificate) in made.iter().enumerate() {
        let client = format!("10.0.{}.{}", i / 200, i % 200);
        let (status, body) = post(&app, &client, paid("preprod", certificate, 1)).await;
        assert_eq!(status, StatusCode::OK, "{i}: {body}");
    }
    let first = page(&app, "192.0.2.1", Some(start.cursor)).await;
    assert_eq!(first.flags, 1);
    assert_eq!(first.entries.len(), 64 * 1024 / 304);
    assert!(first.len <= 13 + 64 * 1024 + 3 * first.entries.len());
    let second = page(&app, "192.0.2.1", Some(first.cursor)).await;
    assert_eq!(second.flags, 0);
    let read: Vec<Vec<u8>> = first
        .certificates()
        .into_iter()
        .chain(second.certificates())
        .collect();
    assert_eq!(read, made);
    // Caught up, then only what's new.
    let caught_up = page(&app, "192.0.2.1", Some(second.cursor)).await;
    assert!(caught_up.entries.is_empty());
    let (status, _) = post(&app, "203.0.113.7", paid("preprod", &short(1), 1)).await;
    assert_eq!(status, StatusCode::OK);
    let next = page(&app, "192.0.2.1", Some(caught_up.cursor)).await;
    assert_eq!((next.flags, next.certificates()), (0, vec![short(1)]));
    // A cursor the list never gave: a gap, and the page from the oldest.
    let strange = page(&app, "192.0.2.1", Some(next.cursor + 1_000_000)).await;
    assert_eq!(strange.flags, 3);
    assert_eq!(strange.certificates(), made[..first.entries.len()].to_vec());
    // The query is a cursor or nothing.
    for query in [
        "?after=",
        "?after=-1",
        "?since=1",
        "?after=1&x=2",
        "?after=0x10",
    ] {
        let path = format!("{CERTIFICATES}{query}");
        let response = send(&app, request("192.0.2.1", Method::GET, &path, vec![])).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
    }
    let response = send(
        &app,
        request(
            "192.0.2.1",
            Method::GET,
            "/messaging/v1/elsewhere/certificates",
            vec![],
        ),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let (status, _, _) = post_to(
        &app,
        "/messaging/v1/elsewhere/certificates",
        "192.0.2.1",
        paid("preprod", &short(2), 1),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// A list page counts in the address's day of reading, the pool's, as an
/// envelope page does: past it, both are the day's 429, and posts go on.
#[tokio::test]
async fn a_list_page_counts_in_the_days_reading_with_the_pools() {
    let relay = Relay::with_pools(None, &CHEAP_POOLS).with_reading(Reading {
        floor: 2_000,
        pools: 0,
    });
    let Relayed { app, .. } = relayed(relay);
    for i in 0..4 {
        let (status, _) = post(&app, "203.0.113.7", paid("preprod", &short(i), 1)).await;
        assert_eq!(status, StatusCode::OK);
    }
    // 13 + 4 × 276 = 1,117 bytes a page: the second passes 2,000, and is sent.
    let me = "203.0.113.9";
    for _ in 0..2 {
        assert_eq!(page(&app, me, None).await.certificates().len(), 4);
    }
    for path in [CERTIFICATES, ENVELOPES] {
        let response = send(&app, request(me, Method::GET, path, vec![])).await;
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS, "{path}");
        let retry: u64 = response.headers()[header::RETRY_AFTER]
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!((24 * 3600 + 1..=25 * 3600).contains(&retry), "{retry}");
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1 << 10).await.unwrap())
                .unwrap();
        assert_eq!(
            body["error"],
            "this address has read its share of the pool for the day"
        );
    }
    // Its posts go on, and another address reads.
    let (status, _) = post(&app, me, paid("preprod", &short(9), 1)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        page(&app, "198.51.100.1", None).await.certificates().len(),
        5
    );
    // The other pool has a day of its own.
    let mainnet = page_of(&app, "/messaging/v1/mainnet/certificates", me, None).await;
    assert!(mainnet.entries.is_empty());
}

/// The edge on the new routes, as on the envelopes': a 413 past a nonce
/// and the longest certificate, a 400 for a body on a GET, the 403 for a
/// web page's request, CORS, no compression, messaging's own bucket, and
/// its traffic counted toward messaging's allowance.
#[tokio::test]
async fn the_edge_stands_in_front_of_the_list_as_of_the_pool() {
    let Relayed { app, edge, .. } = relayed(Relay::with_pools(None, &CHEAP_POOLS));
    let response = send(
        &app,
        request(
            "203.0.113.7",
            Method::POST,
            CERTIFICATES,
            vec![0; 8 + 304 + 1],
        ),
    )
    .await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
    // At its most, the route has it: a long name's certificate, paid.
    let long = Made::preprod(&[0x5e; 32], 2, 3).bytes();
    let body = paid("preprod", &long, 1);
    assert_eq!(body.len(), 8 + 304);
    let (status, _) = post(&app, "203.0.113.7", body).await;
    assert_eq!(status, StatusCode::OK);
    // A GET with a body.
    let response = send(
        &app,
        request("203.0.113.7", Method::GET, CERTIFICATES, vec![b'x'; 10]),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 10).await.unwrap()).unwrap();
    assert_eq!(body["error"], "this route takes no body");
    // A web page's request.
    let mut elsewhere = request("203.0.113.9", Method::GET, CERTIFICATES, vec![]);
    elsewhere
        .headers_mut()
        .insert(header::ORIGIN, "https://example.com".parse().unwrap());
    assert_eq!(send(&app, elsewhere).await.status(), StatusCode::FORBIDDEN);
    // CORS, uncompressed, no-store.
    let mut asking = request("203.0.113.9", Method::GET, CERTIFICATES, vec![]);
    asking
        .headers_mut()
        .insert(header::ACCEPT_ENCODING, "gzip".parse().unwrap());
    let response = send(&app, asking).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
    assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    // The page's bytes count toward messaging's allowance.
    let before = edge.messaging_egress.used();
    let read = page(&app, "203.0.113.9", None).await;
    assert_eq!(edge.messaging_egress.used() - before, read.len as u64);
    assert_eq!(read.len, 13 + 3 + 304);
    // Messaging's bucket, emptied, holds the list's routes, not the rest.
    let ip = "198.51.100.5".parse().unwrap();
    edge.take_in(Part::Messaging, ip, 1.0, std::time::Instant::now())
        .unwrap();
    edge.charge_in(Part::Messaging, ip, 16 << 20);
    let response = send(
        &app,
        request("198.51.100.5", Method::GET, CERTIFICATES, vec![]),
    )
    .await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let (status, _) = post(&app, "198.51.100.5", paid("preprod", &short(1), 1)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let response = send(
        &app,
        request("198.51.100.5", Method::GET, "/api/v1/tip", vec![]),
    )
    .await;
    assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    // Messaging's allowance spent: the list's routes are refused too.
    edge.messaging_egress.add(1_000_000);
    let response = send(
        &app,
        request("192.0.2.7", Method::GET, CERTIFICATES, vec![]),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

/// The off switch covers the list (§21.7): every request to its routes is
/// a 410 with CORS, a post's body unread, so nothing is listed; the
/// preflight is answered as ever.
#[tokio::test]
async fn with_messaging_off_the_lists_routes_are_gone_and_nothing_is_listed() {
    let Relayed { app, relay, .. } = relayed_as(Relay::with_pools(None, &CHEAP_POOLS), true);
    let routes = [
        (Method::GET, CERTIFICATES.to_string(), vec![]),
        (Method::GET, format!("{CERTIFICATES}?after=5"), vec![]),
        (
            Method::POST,
            CERTIFICATES.to_string(),
            paid("preprod", &short(1), 1),
        ),
        (
            Method::POST,
            "/messaging/v1/mainnet/certificates".to_string(),
            nonce_zero(&short(2)),
        ),
        (
            Method::GET,
            "/messaging/v1/elsewhere/certificates".to_string(),
            vec![],
        ),
    ];
    for (method, path, body) in routes {
        let response = send(&app, request("203.0.113.7", method, &path, body)).await;
        assert_eq!(response.status(), StatusCode::GONE, "{path}");
        assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
        let bytes = to_bytes(response.into_body(), 1 << 10).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body, serde_json::json!({ "error": "messaging is stopped" }));
    }
    assert_eq!(relay.health()["preprod"]["certificates"], 0);
    let preflight = Request::builder()
        .method(Method::OPTIONS)
        .uri(CERTIFICATES)
        .header(header::ORIGIN, WALLET)
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
        .body(Body::empty())
        .unwrap();
    let response = send(&app, preflight).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
}

/// A restart keeps the list, in a file of its own beside the pool's: after
/// a clean stop, every certificate, no gap for a cursor given before, and
/// each still "already"; after a crash, an earlier cursor is told of a gap
/// and its page starts from the oldest; a file this build can't read is
/// left as it was, and nothing is marked clean beside it until a save.
#[tokio::test]
async fn a_restart_keeps_the_list() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-list-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("messaging-preprod.list");
    let mark = dir.join("messaging-preprod.list.clean");
    let reader = "203.0.113.9";
    let cursor = {
        let Relayed { app, relay, .. } = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        for i in 0..2 {
            let (status, _) = post(&app, "203.0.113.7", paid("preprod", &short(i), 1)).await;
            assert_eq!(status, StatusCode::OK);
        }
        let read = page(&app, reader, None).await;
        let (status, _) = post(&app, "203.0.113.7", paid("preprod", &short(2), 1)).await;
        assert_eq!(status, StatusCode::OK);
        relay.save(true);
        assert!(file.exists() && mark.exists());
        // The pool's own file and mark are apart.
        assert!(dir.join("messaging-preprod.pool").exists());
        assert!(dir.join("messaging-preprod.clean").exists());
        read.cursor
    };
    // The list file: its header, then each entry's number, kind, length and
    // bytes, then its withdrawn digests, none, then the re-check's place,
    // none yet: its time and a 0.
    assert_eq!(
        std::fs::read(&file).unwrap().len(),
        21 + 3 * (11 + 273) + 4 + 9
    );
    {
        let Relayed { app, relay, .. } = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        assert!(!mark.exists());
        assert_eq!(relay.health()["preprod"]["certificates"], 3);
        assert_eq!(relay.health()["mainnet"]["certificates"], 0);
        let after = page(&app, reader, Some(cursor)).await;
        assert_eq!((after.flags, after.certificates()), (0, vec![short(2)]));
        let (status, body) = post(&app, "198.51.100.1", nonce_zero(&short(0))).await;
        assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
        // Saved without the mark, as the minute's save is: then a crash.
        relay.save(false);
    }
    {
        let Relayed { app, .. } = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        let after = page(&app, reader, Some(cursor)).await;
        assert_eq!(after.flags, 2);
        assert_eq!(after.certificates(), vec![short(0), short(1), short(2)]);
        assert_eq!(page(&app, "198.51.100.1", None).await.flags, 0);
    }
    // A list file another build wrote: read as nothing, moved aside as
    // `messaging-preprod.list.unreadable.<Unix seconds>`, never overwritten;
    // the list starts again, saved and marked as a new one is.
    let other = [&[2u8][..], &[0; 20]].concat();
    std::fs::write(&file, &other).unwrap();
    {
        let Relayed { relay, .. } = relayed(Relay::with_pools(Some(&dir), &CHEAP_POOLS));
        assert_eq!(relay.health()["preprod"]["certificates"], 0);
        assert!(!file.exists());
        let aside: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .starts_with("messaging-preprod.list.unreadable.")
            })
            .collect();
        assert_eq!(aside.len(), 1, "{aside:?}");
        assert_eq!(std::fs::read(&aside[0]).unwrap(), other);
        relay.save(true);
        assert!(file.exists() && mark.exists());
        assert_eq!(std::fs::read(&aside[0]).unwrap(), other);
        assert!(dir.join("messaging-preprod.clean").exists());
    }
    std::fs::remove_dir_all(&dir).unwrap();
}
