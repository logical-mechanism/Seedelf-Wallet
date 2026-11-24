use std::io::IsTerminal;
use std::sync::Arc;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::config::Config;
use seedelf_data_api::decimals::Decimals;
use seedelf_data_api::edge::{self, Edge, Egress};
use seedelf_data_api::kupo::Kupo;
use seedelf_data_api::messaging::{self, Relay};
use seedelf_data_api::public::history;
use seedelf_data_api::state::{AppState, watch_kupo, watch_tip};
use seedelf_data_api::submit::{Submit, watch_node};
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
    // Colour in a terminal only: under systemd it's escape codes in the journal.
    let fmt = tracing_subscriber::fmt::layer().with_ansi(std::io::stdout().is_terminal());
    tracing_subscriber::registry()
        .with(fmt.with_filter(env.and(quiet)))
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
    tokio::spawn(history::keep_filled(state.clone()));
    let submit = Arc::new(Submit::new(config.submit_api_url, config.ogmios_url)?);
    tokio::spawn(watch_node(submit.clone()));
    let egress = Egress::new(
        config.egress_ceiling,
        config.state_dir.as_ref().map(|dir| dir.join("egress.json")),
    );
    let messaging_egress = Egress::new(
        config.messaging_egress_ceiling,
        config
            .state_dir
            .as_ref()
            .map(|dir| dir.join("messaging-egress.json")),
    );
    let edge = Arc::new(
        Edge::new(config.trust_proxy, config.origins.clone(), egress)
            .with_messaging_egress(messaging_egress)
            .with_reserve(config.messaging_reserve)
            .with_caps(config.edge_caps)
            .with_messaging_off(config.messaging_off),
    );
    tokio::spawn(edge::keep(edge.clone()));
    let caps = config.edge_caps;
    info!(
        origins = config.origins.len(),
        trust_proxy = config.trust_proxy,
        egress_ceiling = config.egress_ceiling.is_some(),
        messaging_egress_ceiling = config.messaging_egress_ceiling.is_some(),
        in_flight_messaging_address = caps.messaging_address,
        in_flight_data_address = caps.data_address,
        in_flight_messaging = caps.messaging,
        in_flight_data = caps.data,
        answers_mib = caps.answer_bytes >> 20,
        compressing = caps.compressing,
        connections = config.connections,
        "the edge's limits"
    );
    let relay = Arc::new(
        Relay::new(config.state_dir.as_deref())
            .with_reading(config.messaging_reading)
            .with_reserve_read(config.messaging_reserve_read),
    );
    tokio::spawn(messaging::keep(relay.clone()));
    info!(
        off = config.messaging_off,
        saved = config.state_dir.is_some(),
        read_mib_day = config.messaging_reading.floor >> 20,
        read_pools_day = config.messaging_reading.pools,
        reserve_percent = (config.messaging_reserve.part * 100.0).round() as u64,
        reserve_page_kib = config.messaging_reserve.page >> 10,
        reserve_read_mib_day = config.messaging_reserve_read >> 20,
        "the messaging relay"
    );

    // Each connection with the kernel's deadline on what it sends and a
    // small send buffer (serve.rs).
    let listener = seedelf_data_api::serve::listen(config.listen)?;
    info!(listen = %config.listen, "seedelf-data-api is listening");
    let app = seedelf_data_api::app(state, submit, edge.clone(), relay.clone(), &config.origins);
    // Until the signal, and then for at most the stop's deadline: what's
    // still open after it is dropped (serve.rs).
    seedelf_data_api::serve::serve_with(listener, app, shutdown(), config.connections).await?;
    // The month's traffic, and the pools as they are, written down before
    // the server stops: nothing more comes in now, so the pools' files are
    // marked clean.
    edge.egress.flush();
    edge.messaging_egress.flush();
    relay.save(true);
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
