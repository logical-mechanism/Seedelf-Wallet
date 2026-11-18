use anyhow::{Context, Result, anyhow};
use colored::Colorize;
use mime_guess::MimeGuess;
use rand_core::{OsRng, RngCore};
use rust_embed::RustEmbed;
use seedelf_core::build;
use seedelf_display::display;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::signal;
use warp::host::Authority;
use warp::http::header::{HeaderMap, HeaderValue};
use warp::http::{Response, StatusCode, Uri};
use warp::path::FullPath;
use warp::{Filter, Rejection, Reply};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Asset;

/// Where the signing page is served: on this machine only.
const ADDRESS: ([u8; 4], u16) = ([127, 0, 0, 1], 44203);

/// The Hosts the server answers: its own address, by number or by name. A
/// request for any other comes from a page elsewhere whose name now leads
/// here (DNS rebinding), and it gets nothing (chunk 51, r4#6).
const OWN_HOSTS: [&str; 2] = ["127.0.0.1:44203", "localhost:44203"];

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

/// Where the run in progress serves its signing page, once the server holds
/// its port; `None` before and after.
static SERVING: Mutex<Option<String>> = Mutex::new(None);

/// Test seam: the address [`run_web_server`] serves its page at, as it
/// prints it, while it serves. Each run's is its own, and a test can't read
/// what the run prints.
pub fn serving_url() -> Option<String> {
    SERVING.lock().expect("serving lock poisoned").clone()
}

/// Clears [`SERVING`] when the server stops, however it stops.
struct Serving;

impl Drop for Serving {
    fn drop(&mut self) {
        *SERVING.lock().expect("serving lock poisoned") = None;
    }
}

/// Helper to build a `warp::http::Response<Vec<u8>>` with the correct Content-Type.
fn serve_bytes(path: &'static str, data: Vec<u8>) -> impl warp::Reply {
    let mime = MimeGuess::from_path(path).first_or_octet_stream();
    Response::builder()
        .header("content-type", mime.as_ref())
        .body(data)
}

/// `text` as a JSON string for a `<script type="application/json">` block.
/// serde_json escapes its quotes and backslashes, so it can't leave the JSON
/// string; `<`, `>` and `&` are escaped too, as JSON's unicode escapes, which
/// JSON.parse reads back, so no `</script>` or `<!--` in it can end the block
/// or start HTML (chunk 51, r4#9). Every caller passes hex.
fn json_string(text: &str) -> String {
    serde_json::to_string(text)
        .unwrap_or_else(|_| "\"\"".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
}

/// The signing page, with `message` (the tx CBOR), its id `tx_id`, and the
/// network in it.
fn signing_page(message: &str, tx_id: &str, network_flag: bool) -> String {
    let file = Asset::get("index.html").expect("index.html not found");
    let html = String::from_utf8(file.data.into_owned()).expect("index.html is UTF-8");

    let dyn_msg = format!(
        r#"{{ "message": {}, "id": {} }}"#,
        json_string(message),
        json_string(tx_id)
    );
    let net_repl = if network_flag {
        r#"{ "network": "preprod." }"#
    } else {
        r#"{ "network": "" }"#
    };
    html.replace(r#"{ "message": "ACAB000000000000" }"#, &dyn_msg)
        .replace(r#"{ "network": "FADECAFE00000000" }"#, net_repl)
}

/// Serves the signing page for `message`, a transaction's CBOR as hex, until
/// Ctrl-C.
///
/// Each run serves under a random path of its own, printed once the server
/// holds its port: an earlier run's server, still holding the port, can't
/// stand in for this one, and a page from an earlier run, reloaded, gets
/// nothing here (chunk 51, r4#5). A port another run holds is an error, said
/// before any address is printed.
///
/// The transaction's id goes with it, printed here and shown on the page
/// before the wallet signs: a submit the wallet doesn't confirm may have gone
/// through all the same, and the id is what to look up before running the
/// command again (chunk 51).
pub(crate) async fn run_web_server(message: String, network_flag: bool) -> Result<()> {
    // Test seam: when armed, record the tx CBOR and return instead of serving
    // the signing site (which would block on Ctrl-C and hang the test).
    if CAPTURE_ARMED.load(Ordering::SeqCst) {
        *CAPTURED_CBOR.lock().expect("cbor capture lock poisoned") = Some(message);
        return Ok(());
    }

    // Its body's hash, which the wallet's signature doesn't change.
    let tx_id: String = hex::encode(build::tx_id(
        &hex::decode(&message).context("The transaction to sign isn't hex")?,
    )?);

    let addr: SocketAddr = ADDRESS.into();
    let mut token = [0u8; 16];
    OsRng.fill_bytes(&mut token);
    let run: String = hex::encode(token);
    let home: String = format!("/{run}/");
    let url: String = format!("http://{addr}{home}");
    let page: String = signing_page(&message, &tx_id, network_flag);

    let own_host = warp::host::optional()
        .and_then(|authority: Option<Authority>| async move {
            match authority {
                Some(authority) if OWN_HOSTS.iter().any(|own| authority == *own) => Ok(()),
                _ => Err(warp::reject::not_found()),
            }
        })
        .untuple_one();

    let base = warp::path(run);
    let html = base
        .clone()
        .and(warp::path::end())
        .and(warp::path::full())
        .map(move |full: FullPath| {
            // The page's own files sit beside it, so its address ends in a slash.
            if !full.as_str().ends_with('/') {
                let to: Uri = home.parse().expect("the page's path is a URI");
                return warp::redirect::see_other(to).into_response();
            }
            warp::reply::html(page.clone()).into_response()
        });

    let js = base
        .clone()
        .and(warp::path("index.js"))
        .and(warp::path::end())
        .map(|| {
            let file = Asset::get("index.js").expect("index.js not found");
            serve_bytes("index.js", file.data.into_owned())
        });
    let css = base
        .clone()
        .and(warp::path("index.css"))
        .and(warp::path::end())
        .map(|| {
            let file = Asset::get("index.css").expect("index.css not found");
            serve_bytes("index.css", file.data.into_owned())
        });
    let ico = base
        .and(warp::path("favicon.ico"))
        .and(warp::path::end())
        .map(|| {
            let file = Asset::get("favicon.ico").expect("favicon.ico not found");
            serve_bytes("favicon.ico", file.data.into_owned())
        });

    // Never kept by the browser, and never shown inside another site's page.
    let mut headers = HeaderMap::new();
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("frame-ancestors 'none'"),
    );

    let routes = own_host
        .and(html.or(js).or(css).or(ico))
        .recover(|_: Rejection| async {
            Ok::<_, Infallible>(warp::reply::with_status(
                "Not this run's signing page: open the address the CLI printed.",
                StatusCode::NOT_FOUND,
            ))
        })
        .with(warp::reply::with::headers(headers));

    let shutdown = async {
        let _ = signal::ctrl_c().await;
    };

    let (_, server) = warp::serve(routes)
        .try_bind_with_graceful_shutdown(addr, shutdown)
        .map_err(|e| {
            anyhow!(
                "The signing page can't be served at http://{addr}/ ({e}). Another run may still be serving its own: stop it with Ctrl-C, then run this again"
            )
        })?;

    *SERVING.lock().expect("serving lock poisoned") = Some(url.clone());
    let _serving = Serving;
    println!("\nTx Hash: {}", tx_id.bright_cyan());
    display::signing_page_address(&url);
    server.await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whatever a message holds, it can't end its JSON block or start HTML,
    /// and the page reads it back unchanged (chunk 51, r4#9), and its id
    /// beside it.
    #[test]
    fn a_message_stays_inside_its_json_block() {
        let message = r#"84a0</script><script>alert("x")</script><!-- & \ "#;
        let id = "ab".repeat(32);
        let page = signing_page(message, &id, false);
        let open = r#"<script id="injected-data" type="application/json">"#;
        let start = page.find(open).expect("the injected block") + open.len();
        let end = start + page[start..].find("</script>").expect("the block's end");
        let block = &page[start..end];
        assert!(
            !block.contains(['<', '>', '&']),
            "the block holds no angle bracket or ampersand: {block}"
        );
        let read: serde_json::Value = serde_json::from_str(block).expect("the block is JSON");
        assert_eq!(read["message"], message);
        assert_eq!(read["id"], id.as_str());
    }
}
