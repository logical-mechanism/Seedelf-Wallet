use warp::Filter;
use std::fs;
use std::net::SocketAddr;

/// Start a web server and inject a dynamic message into the HTML.
///
/// # Arguments
/// - `message`: The dynamic message to replace in the `injected-data` script.
pub async fn run_web_server(message: String) {
    let addr: SocketAddr = ([127, 0, 0, 1], 44203).into();
    println!("Starting server at http://{}/", addr);

    // Serve index.html with dynamic content
    let html_route = warp::path::end().map(move || {
        let mut html = fs::read_to_string("static/index.html").expect("Failed to read HTML file");
        // Replace the JSON content inside the injected-data script
        let dynamic_json = format!(r#"{{ "message": "{}" }}"#, message);
        html = html.replace(
            r#"{ "message": "Welcome to your dynamic Seedelf page!" }"#,
            &dynamic_json,
        );
        warp::reply::html(html)
    });

    // Serve index.js as a static file
    let js_route = warp::path("index.js").and(warp::fs::file("static/index.js"));

    // Serve favicon.ico
    let favicon_route = warp::path("favicon.ico").and(warp::fs::file("static/favicon.ico"));

    // Combine all routes
    let routes = html_route.or(js_route).or(favicon_route);

    // Run the server with graceful shutdown
    let (_, server) = warp::serve(routes).bind_with_graceful_shutdown(addr, shutdown_signal());
    server.await;

    println!("Server has stopped.");
}

/// Function to handle graceful shutdown via Ctrl-C
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl-C handler");
    println!("Shutdown signal received...");
}
