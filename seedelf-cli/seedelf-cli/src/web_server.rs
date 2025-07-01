use colored::Colorize;
use std::net::SocketAddr;
use warp::{Filter, http::Response};
use rust_embed::RustEmbed;
use mime_guess::MimeGuess;

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

pub async fn run_web_server(message: String, network_flag: bool) {
    let addr: SocketAddr = ([127, 0, 0, 1], 44203).into();
    println!(
        "{} {}",
        "\nStarting server at".bright_cyan(),
        format!("http://{addr}/").bright_white()
    );
    println!("{}", "Hit Ctrl-C To Stop Server".bright_yellow());

    // HTML route with injection
    let html = warp::path::end().map(move || {
        let file = Asset::get("index.html").expect("index.html not found");
        let mut html = String::from_utf8(file.data.into_owned()).unwrap();

        let dyn_msg = format!(r#"{{ "message": "{}" }}"#, message);
        html = html.replace(r#"{ "message": "ACAB000000000000" }"#, &dyn_msg);

        let net_repl = if network_flag {
            r#"{ "network": "preprod." }"#
        } else {
            r#"{ "network": "" }"#
        };
        html = html.replace(r#"{ "network": "FADECAFE00000000" }"#, net_repl);

        warp::reply::html(html)
    });

    // JS, CSS, and favicon routes
    let js    = warp::path("index.js").map(|| {
        let file = Asset::get("index.js").expect("index.js not found");
        serve_bytes("index.js", file.data.into_owned())
    });
    let css   = warp::path("index.css").map(|| {
        let file = Asset::get("index.css").expect("index.css not found");
        serve_bytes("index.css", file.data.into_owned())
    });
    let ico   = warp::path("favicon.ico").map(|| {
        let file = Asset::get("favicon.ico").expect("favicon.ico not found");
        serve_bytes("favicon.ico", file.data.into_owned())
    });

    // Combine all routes
    let routes = html.or(js).or(css).or(ico);

    // Run server with graceful shutdown
    let (_addr, server) = warp::serve(routes)
        .bind_with_graceful_shutdown(addr, async {
            tokio::signal::ctrl_c()
                .await
                .expect("Failed to install Ctrl-C handler");
            println!("\n{}", "Shutdown signal received...".red());
        });

    server.await;
    println!("{}", "Server has stopped.".bright_purple());
}
