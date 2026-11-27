//! What the relay's tests share: a Seedelf's certificate and its
//! withdrawal, made as a wallet makes them (docs/protocol.md §21.4, §21.7),
//! and a Koios that answers `asset_utxos` from what a test says the chain
//! holds, on loopback.

// Each test binary takes what it needs of this.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use blstrs::{G1Projective, Scalar};
use group::{Curve, Group};
use seedelf_data_api::constants::{CONTRACT_HASH, SEEDELF_POLICY};
use seedelf_data_api::messaging::certificate::{
    HANDLE_BASE_DST, LABEL, NETWORK_PREPROD, POLICY, WITHDRAWAL_LABEL, listing_digest,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// A big-endian integer, mod q.
fn mod_q(bytes: &[u8]) -> Scalar {
    let base = Scalar::from(256u64);
    bytes.iter().fold(Scalar::from(0u64), |acc, &byte| {
        acc * base + Scalar::from(u64::from(byte))
    })
}

fn point(p: G1Projective) -> Vec<u8> {
    p.to_affine().to_compressed().to_vec()
}

/// A Seedelf named `name`, its register (g_S, u_S) with g_S = [register]G
/// and u_S = [x]g_S, and its certificate, made as §21.4 makes one but with
/// the nonces from `nonce` rather than HMAC: the relay checks a proof,
/// never how its nonces were drawn. Two that differ in `nonce` alone are
/// other bytes for the same listing, a repost with a fresh aux.
pub struct Made {
    pub network: u8,
    pub name: Vec<u8>,
    pub register: u64,
    pub x: u64,
    pub x_m: u64,
    pub nonce: u64,
}

impl Made {
    pub fn preprod(name: &[u8], register: u64, x_m: u64) -> Self {
        Made {
            network: NETWORK_PREPROD,
            name: name.to_vec(),
            register,
            x: 7,
            x_m,
            nonce: 1,
        }
    }

    pub fn mainnet(name: &[u8], register: u64, x_m: u64) -> Self {
        Made {
            network: seedelf_data_api::messaging::certificate::NETWORK_MAINNET,
            ..Made::preprod(name, register, x_m)
        }
    }

    /// g_S, u_S, h_S and m_S.
    fn points(&self) -> (G1Projective, G1Projective, G1Projective, G1Projective) {
        let g = G1Projective::generator() * Scalar::from(self.register);
        let u = g * Scalar::from(self.x);
        let base_message = [&[self.network][..], &POLICY, &self.seedelf(g, u)].concat();
        let h = G1Projective::hash_to_curve(&base_message, HANDLE_BASE_DST, &[]);
        assert!(!bool::from(h.is_identity()));
        (g, u, h, h * Scalar::from(self.x_m))
    }

    fn seedelf(&self, g: G1Projective, u: G1Projective) -> Vec<u8> {
        [
            &[self.name.len() as u8][..],
            &self.name,
            &point(g),
            &point(u),
        ]
        .concat()
    }

    /// Its datum register, `g_S ‖ u_S`: what the chain holds it at.
    pub fn register(&self) -> Vec<u8> {
        let (g, u, ..) = self.points();
        [point(g), point(u)].concat()
    }

    pub fn bytes(&self) -> Vec<u8> {
        let (g, u, h, m) = self.points();
        let (x, x_m) = (Scalar::from(self.x), Scalar::from(self.x_m));
        let statement = [
            &[1, self.network, 0][..],
            &POLICY,
            &self.seedelf(g, u),
            &point(m),
        ]
        .concat();
        let (k_x, k_m) = (
            Scalar::from(2 * self.nonce + 11),
            Scalar::from(2 * self.nonce + 12),
        );
        let hash = Sha256::new()
            .chain_update(LABEL)
            .chain_update(&statement)
            .chain_update(point(g * k_x))
            .chain_update(point(h * k_m))
            .finalize();
        let c = mod_q(&hash);
        let (z_x, z_m) = (k_x + c * x, k_m + c * x_m);
        [
            statement,
            c.to_bytes_be().to_vec(),
            z_x.to_bytes_be().to_vec(),
            z_m.to_bytes_be().to_vec(),
        ]
        .concat()
    }

    /// Its listing digest under `pool`.
    pub fn digest(&self, pool: &str) -> [u8; 32] {
        listing_digest(pool, &self.bytes())
    }

    /// A withdrawal of its certificate from `pool`'s list, made as §21.7
    /// makes one, its nonce from `nonce` rather than HMAC, proved with
    /// `x_m`: its own messaging key, or another to make a bad one.
    pub fn withdrawal(&self, pool: &str, x_m: u64) -> Vec<u8> {
        let (_, _, h, m) = self.points();
        let statement = [&[1, self.network][..], &self.digest(pool)].concat();
        let k = Scalar::from(2 * self.nonce + 1013);
        let hash = Sha256::new()
            .chain_update(WITHDRAWAL_LABEL)
            .chain_update(&statement)
            .chain_update(point(h))
            .chain_update(point(m))
            .chain_update(point(h * k))
            .finalize();
        let c = mod_q(&hash);
        let z = k + c * Scalar::from(x_m);
        [
            statement,
            c.to_bytes_be().to_vec(),
            z.to_bytes_be().to_vec(),
        ]
        .concat()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A register's inline datum, `121([_ g, u])`, as Seedelf Wallet writes one.
pub fn datum(register: &[u8]) -> String {
    hex(&[
        &[0xd8, 0x79, 0x9f, 0x58, 0x30][..],
        &register[..48],
        &[0x58, 0x30],
        &register[48..],
        &[0xff],
    ]
    .concat())
}

/// Koios's row for a contract UTxO holding the Seedelf `name` under the
/// datum `register`, as `asset_utxos` lists one with `_extended`.
pub fn contract_row(name: &[u8], register: &[u8]) -> Value {
    json!({
        "tx_hash": "ab".repeat(32),
        "tx_index": 0,
        "address": "addr_test1wz2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6qxqzvvt",
        "value": "1500000",
        "stake_address": null,
        "payment_cred": CONTRACT_HASH,
        "epoch_no": 200,
        "block_height": 3_000_000,
        "block_time": 1_800_000_000,
        "datum_hash": null,
        "inline_datum": { "bytes": datum(register), "value": { "constructor": 0, "fields": [] } },
        "reference_script": null,
        "asset_list": [{ "policy_id": SEEDELF_POLICY, "asset_name": hex(name), "quantity": "1" }],
        "is_spent": false,
    })
}

/// What the Koios on loopback holds and how it answers.
#[derive(Default)]
pub struct KoiosState {
    /// Each name's rows, by its hex.
    pub rows: HashMap<String, Vec<Value>>,
    /// How many requests came, and the last one's body: counts alone, so a
    /// test that measures the heap measures none of this.
    pub asked: usize,
    pub last: Value,
    /// Each answer waits this long first.
    pub delay: Duration,
    /// Answered with this status instead, when set, and this
    /// `Retry-After`.
    pub status: Option<u16>,
    pub retry_after: Option<String>,
    pub flying: usize,
    pub most_flying: usize,
}

/// A Koios on loopback: `POST /api/v1/asset_utxos` answers the rows held for
/// the name it's asked about, every other name none.
#[derive(Clone)]
pub struct KoiosMock {
    /// Its API's base, `…/api/v1`.
    pub url: String,
    pub state: Arc<Mutex<KoiosState>>,
}

impl KoiosMock {
    /// Serves from a std listener, so a synchronous helper inside a test's
    /// runtime can start one.
    pub fn start() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/api/v1", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(KoiosState::default()));
        let app = Router::new()
            .route("/api/v1/asset_utxos", post(asset_utxos))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await });
        KoiosMock { url, state }
    }

    /// The chain holds the Seedelf `name` at the contract, under `register`.
    pub fn hold(&self, name: &[u8], register: &[u8]) {
        self.rows(name, vec![contract_row(name, register)]);
    }

    /// The rows Koios lists for the Seedelf `name`.
    pub fn rows(&self, name: &[u8], rows: Vec<Value>) {
        self.state.lock().unwrap().rows.insert(hex(name), rows);
    }

    /// How many times it was asked.
    pub fn asked(&self) -> usize {
        self.state.lock().unwrap().asked
    }
}

async fn asset_utxos(State(state): State<Arc<Mutex<KoiosState>>>, body: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let (delay, status, rows) = {
        let mut state = state.lock().unwrap();
        state.asked += 1;
        state.last = body.clone();
        state.flying += 1;
        state.most_flying = state.most_flying.max(state.flying);
        let name = body["_asset_list"][0][1].as_str().unwrap_or_default();
        let rows = state.rows.get(name).cloned().unwrap_or_default();
        (state.delay, (state.status, state.retry_after.clone()), rows)
    };
    tokio::time::sleep(delay).await;
    state.lock().unwrap().flying -= 1;
    match status {
        (Some(status), retry_after) => {
            let mut response = StatusCode::from_u16(status).unwrap().into_response();
            if let Some(after) = retry_after {
                response
                    .headers_mut()
                    .insert(header::RETRY_AFTER, after.parse().unwrap());
            }
            response
        }
        (None, _) => axum::Json(Value::Array(rows)).into_response(),
    }
}
