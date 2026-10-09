use std::net::SocketAddr;
use std::sync::Arc;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::config::Config;
use seedelf_data_api::decimals::Decimals;
use seedelf_data_api::edge::{self, Edge, Egress};
use seedelf_data_api::kupo::Kupo;
use seedelf_data_api::state::{AppState, watch_kupo, watch_tip};
use seedelf_data_api::submit::Submit;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // seedelf-data/.env while it runs locally; a missing file is fine.
    let _ = dotenvy::dotenv();
    let mut filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    // Libraries that log a request's contents when asked for detail (the
    // database driver logs every query's parameters at debug, axum's
    // rejections quote bodies): held where RUST_LOG can't raise them.
    for quiet in [
        "tokio_postgres=info",
        "postgres_protocol=info",
        "hyper=warn",
        "hyper_util=warn",
        "reqwest=warn",
        "h2=warn",
        "tower_http=warn",
        "axum::rejection=off",
    ] {
        filter = filter.add_directive(quiet.parse()?);
    }
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let config = Config::from_env()?;
    let decimals = match &config.token_decimals {
        Some(path) => Decimals::load(path)?,
        None => Decimals::default(),
    };
    info!(tokens = decimals.len(), "token decimals");
    let kupo = config.kupo_url.as_deref().map(Kupo::new).transpose()?;
    info!(kupo = kupo.is_some(), "the private index's second source");
    let state = Arc::new(
        AppState::new(Chain::connect(&config.database_url)?)
            .with_decimals(decimals)
            .with_kupo(kupo),
    );
    tokio::spawn(watch_tip(state.clone()));
    tokio::spawn(watch_kupo(state.clone()));
    let submit = Arc::new(Submit::new(config.submit_api_url, config.ogmios_url)?);
    let egress = Egress::new(
        config.egress_ceiling,
        config.state_dir.map(|dir| dir.join("egress.json")),
    );
    let edge = Arc::new(Edge::new(
        config.trust_proxy,
        config.origins.clone(),
        egress,
    ));
    tokio::spawn(edge::keep(edge.clone()));
    info!(
        origins = config.origins.len(),
        trust_proxy = config.trust_proxy,
        egress_ceiling = config.egress_ceiling.is_some(),
        "the edge's limits"
    );

    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    info!(listen = %config.listen, "seedelf-data-api is listening");
    let app = seedelf_data_api::app(state, submit, edge.clone(), &config.origins);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    // The month's traffic, written down before the server stops.
    edge.egress.flush();
    Ok(())
}

/// Ctrl-C, or systemd's SIGTERM.
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut term) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            term.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
}
