use mime_guess::MimeGuess;
use rust_embed::RustEmbed;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::signal;
use warp::{Filter, http::Response};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Asset;

/// Test seam: capture the transaction CBOR handed to [`run_web_server`].
///
/// `create`, `fund`, and `extract` finish by serving a local CIP30 signing
/// site and blocking on Ctrl-C, which would hang an automated test. When the
/// capture seam is armed, `run_web_server` instead records the CBOR and returns
/// immediately. Production never arms it, so the signing site always serves.
static CAPTURE_ARMED: AtomicBool = AtomicBool::new(false);
static CAPTURED_CBOR: Mutex<Option<String>> = Mutex::new(None);

/// Arm the CBOR capture seam, clearing any previously captured value.
///
/// While armed, [`run_web_server`] stores its `message` (the tx CBOR) and
/// returns without serving the signing site.
pub fn arm_cbor_capture() {
    *CAPTURED_CBOR.lock().expect("cbor capture lock poisoned") = None;
    CAPTURE_ARMED.store(true, Ordering::SeqCst);
}

/// Disarm the capture seam and return the CBOR captured since [`arm_cbor_capture`].
pub fn take_captured_cbor() -> Option<String> {
    CAPTURE_ARMED.store(false, Ordering::SeqCst);
    CAPTURED_CBOR
        .lock()
        .expect("cbor capture lock poisoned")
        .take()
}

/// Helper to build a `warp::http::Response<Vec<u8>>` with the correct Content-Type.
fn serve_bytes(path: &'static str, data: Vec<u8>) -> impl warp::Reply {
    let mime = MimeGuess::from_path(path).first_or_octet_stream();
    Response::builder()
        .header("content-type", mime.as_ref())
        .body(data)
}

pub(crate) async fn run_web_server(message: String, network_flag: bool) {
    // Test seam: when armed, record the tx CBOR and return instead of serving
    // the signing site (which would block on Ctrl-C and hang the test).
    if CAPTURE_ARMED.load(Ordering::SeqCst) {
        *CAPTURED_CBOR.lock().expect("cbor capture lock poisoned") = Some(message);
        return;
    }

    let addr: SocketAddr = ([127, 0, 0, 1], 44203).into();

    let html = warp::path::end().map(move || {
        let file = Asset::get("index.html").expect("index.html not found");
        let mut html = String::from_utf8(file.data.into_owned()).unwrap();

        // Escape the message via serde_json so embedded quotes, backslashes,
        // or angle brackets can't break out of the JSON literal or inject HTML.
        let escaped = serde_json::to_string(&message).unwrap_or_else(|_| "\"\"".to_string());
        let dyn_msg = format!(r#"{{ "message": {escaped} }}"#);
        html = html.replace(r#"{ "message": "ACAB000000000000" }"#, &dyn_msg);

        let net_repl = if network_flag {
            r#"{ "network": "preprod." }"#
        } else {
            r#"{ "network": "" }"#
        };
        html = html.replace(r#"{ "network": "FADECAFE00000000" }"#, net_repl);

        warp::reply::html(html)
    });

    let js = warp::path("index.js").map(|| {
        let file = Asset::get("index.js").expect("index.js not found");
        serve_bytes("index.js", file.data.into_owned())
    });
    let css = warp::path("index.css").map(|| {
        let file = Asset::get("index.css").expect("index.css not found");
        serve_bytes("index.css", file.data.into_owned())
    });
    let ico = warp::path("favicon.ico").map(|| {
        let file = Asset::get("favicon.ico").expect("favicon.ico not found");
        serve_bytes("favicon.ico", file.data.into_owned())
    });

    let routes = html.or(js).or(css).or(ico);

    let shutdown = async {
        let _ = signal::ctrl_c().await;
    };

    warp::serve(routes)
        .bind_with_graceful_shutdown(addr, shutdown)
        .1
        .await;
}
