use std::fs;
use std::net::SocketAddr;
use warp::Filter;
use colored::Colorize;
/// Start a web server and inject a dynamic message into the HTML.
///
/// # Arguments
/// - `message`: The dynamic message to replace in the `injected-data` script.
pub async fn run_web_server(message: String, network_flag: bool) {
    let addr: SocketAddr = ([127, 0, 0, 1], 44203).into();
    println!("{} {}", "\nStarting server at".bright_cyan(), format!("http://{}/", addr.to_string()).bright_white());
    println!("{}", "Hit Ctrl-C To Stop Server".bright_yellow());

    // Serve index.html with dynamic content
    let html_route = warp::path::end().map(move || {
        let mut html = fs::read_to_string("static/index.html").expect("Failed to read HTML file");
        // Replace the JSON content inside the injected-data script
        let dynamic_json = format!(r#"{{ "message": "{}" }}"#, message);
        html = html.replace(
            r#"{ "message": "ACAB000000000000" }"#,
            &dynamic_json,
        );
        if network_flag {
            html = html.replace(
                r#"{ "network": "FADECAFE00000000" }"#,
                format!(r#"{{ "network": "{}" }}"#, "preprod.").as_str(),
            );
        }
        warp::reply::html(html)
    });

    // Serve index.js as a static file
    let js_route = warp::path("index.js").and(warp::fs::file("static/index.js"));

    // Serve favicon.ico
    let favicon_route = warp::path("favicon.ico").and(warp::fs::file("static/favicon.ico"));

    // Serve index.css
    let css_route = warp::path("index.css").and(warp::fs::file("static/index.css"));

    // Combine all routes
    let routes = html_route.or(js_route).or(favicon_route).or(css_route);

    // Run the server with graceful shutdown
    let (_, server) = warp::serve(routes).bind_with_graceful_shutdown(addr, shutdown_signal());
    server.await;

    println!("{}", "Server has stopped.".bright_purple());
}

/// Function to handle graceful shutdown via Ctrl-C
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl-C handler");
    println!("{}", "\nShutdown signal received...".red());
}
