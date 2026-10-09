use std::sync::Arc;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::config::Config;
use seedelf_data_api::state::{AppState, watch_tip};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // seedelf-data/.env while it runs locally; a missing file is fine.
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    let state = Arc::new(AppState::new(Chain::connect(&config.database_url)?));
    tokio::spawn(watch_tip(state.clone()));

    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    info!(listen = %config.listen, "seedelf-data-api is listening");
    axum::serve(listener, seedelf_data_api::app(state))
        .with_graceful_shutdown(shutdown())
        .await?;
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
