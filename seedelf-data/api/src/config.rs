//! Where the upstreams are, from the environment (`seedelf-data/.env` while
//! it's built locally, the service's environment file later). Every address
//! is config, so moving behind the tunnel changes values, not code.

use std::net::SocketAddr;

use anyhow::{Context, Result};

/// Loopback: there are no limits in front of the API yet (chunk 26's plan).
pub const DEFAULT_LISTEN: &str = "127.0.0.1:8099";

/// No `Debug`: the database URL holds a password, and nothing should print it.
pub struct Config {
    pub database_url: String,
    pub listen: SocketAddr,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = std::env::var("MAINNET_DATABASE_URL")
            .context("MAINNET_DATABASE_URL isn't set (see seedelf-data/.env.example)")?;
        let listen = std::env::var("DATA_LISTEN")
            .unwrap_or_else(|_| DEFAULT_LISTEN.to_string())
            .parse()
            .context("DATA_LISTEN isn't an address and port")?;
        Ok(Config {
            database_url,
            listen,
        })
    }
}
