use std::net::SocketAddr;
use std::sync::Arc;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::config::Config;
use seedelf_data_api::decimals::Decimals;
use seedelf_data_api::edge::{self, Edge, Egress};
use seedelf_data_api::kupo::Kupo;
use seedelf_data_api::state::{AppState, watch_kupo, watch_tip};
use seedelf_data_api::submit::Submit;
use tracing::Level;
use tracing::info;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::filter::{FilterExt, LevelFilter, Targets};
use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // seedelf-data/.env while it runs locally; a missing file is fine.
    let _ = dotenvy::dotenv();
    let env = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    // Libraries that log a request's contents when asked for detail (the
    // database driver logs every query's parameters at debug, axum's
    // rejections quote bodies): held in a filter of their own, which every
    // line must pass as well as RUST_LOG's, so no directive there (however
    // narrow its target) can raise them.
    let quiet = Targets::new()
        .with_default(LevelFilter::TRACE)
        .with_target("tokio_postgres", Level::INFO)
        .with_target("postgres_protocol", Level::INFO)
        .with_target("hyper", Level::WARN)
        .with_target("hyper_util", Level::WARN)
        .with_target("reqwest", Level::WARN)
        .with_target("h2", Level::WARN)
        .with_target("tower_http", Level::WARN)
        .with_target("axum::rejection", LevelFilter::OFF);
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(env.and(quiet)))
        .init();

    let config = Config::from_env()?;
    let decimals = Decimals::bundled();
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
