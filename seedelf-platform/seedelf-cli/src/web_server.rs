use mime_guess::MimeGuess;
use rust_embed::RustEmbed;
use std::net::SocketAddr;
use tokio::signal;
use warp::{Filter, http::Response};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Asset;

/// Helper to build a `warp::http::Response<Vec<u8>>` with the correct Content-Type.
fn serve_bytes(path: &'static str, data: Vec<u8>) -> impl warp::Reply {
    let mime = MimeGuess::from_path(path).first_or_octet_stream();
    Response::builder()
        .header("content-type", mime.as_ref())
        .body(data)
}

pub(crate) async fn run_web_server(message: String, network_flag: bool) {
    let addr: SocketAddr = ([127, 0, 0, 1], 44203).into();

    let html = warp::path::end().map(move || {
        let file = Asset::get("index.html").expect("index.html not found");
        let mut html = String::from_utf8(file.data.into_owned()).unwrap();

        let dyn_msg = format!(r#"{{ "message": "{message}" }}"#);
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
