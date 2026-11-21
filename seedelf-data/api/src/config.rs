//! Where the upstreams are, from the environment (`seedelf-data/.env` while
//! it's built locally, the service's environment file later). Every address
//! is config, so moving behind the tunnel changes values, not code.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};

/// Loopback: on the VPS, Caddy is in front (deploy/README.md).
pub const DEFAULT_LISTEN: &str = "127.0.0.1:8099";

/// No `Debug`: the database URL holds a password, and nothing should print it.
pub struct Config {
    pub database_url: String,
    /// The Seedelf-only Kupo: the private index reads db-sync alone without it.
    pub kupo_url: Option<String>,
    pub listen: SocketAddr,
    /// cardano-submit-api and Ogmios: the submit part answers 503 without them.
    pub submit_api_url: Option<String>,
    pub ogmios_url: Option<String>,
    /// The wallet's origins, `chrome-extension://<id>`, that CORS lets read answers.
    pub origins: Vec<String>,
    /// Behind Caddy on loopback: the client is the last `X-Forwarded-For` address.
    pub trust_proxy: bool,
    /// The month's ceiling on the API's own traffic, in bytes.
    pub egress_ceiling: Option<u64>,
    /// The relay's share of it, at most, in bytes: messaging stops there, the rest goes on.
    pub messaging_egress_ceiling: Option<u64>,
    /// Where the month's traffic is kept: systemd's `StateDirectory`, or `DATA_STATE_DIR`.
    pub state_dir: Option<PathBuf>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = std::env::var("MAINNET_DATABASE_URL")
            .context("MAINNET_DATABASE_URL isn't set (see seedelf-data/.env.example)")?;
        let listen = std::env::var("DATA_LISTEN")
            .unwrap_or_else(|_| DEFAULT_LISTEN.to_string())
            .parse()
            .context("DATA_LISTEN isn't an address and port")?;
        let optional = |name: &str| std::env::var(name).ok().filter(|url| !url.is_empty());
        Ok(Config {
            database_url,
            kupo_url: optional("MAINNET_KUPO_URL"),
            listen,
            submit_api_url: optional("MAINNET_SUBMIT_API_URL"),
            ogmios_url: optional("MAINNET_OGMIOS_URL"),
            origins: optional("DATA_ORIGINS")
                .map(|list| {
                    list.split(',')
                        .map(|origin| origin.trim().to_string())
                        .filter(|origin| !origin.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            // A typo here would put every client in Caddy's one bucket: refuse it.
            trust_proxy: match optional("DATA_TRUST_PROXY").as_deref() {
                None | Some("false") => false,
                Some("true") => true,
                Some(_) => bail!("DATA_TRUST_PROXY is true or false"),
            },
            egress_ceiling: gigabytes("DATA_EGRESS_GB_MONTH")?,
            messaging_egress_ceiling: gigabytes("DATA_MESSAGING_GB_MONTH")?,
            state_dir: optional("DATA_STATE_DIR")
                .or_else(|| optional("STATE_DIRECTORY"))
                .map(PathBuf::from),
        })
    }
}

/// A number of GB above 0 in `name`, as bytes, if it's set.
fn gigabytes(name: &str) -> Result<Option<u64>> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .map(|gb| match gb.parse::<f64>() {
            Ok(gb) if gb.is_finite() && gb > 0.0 => Ok((gb * 1e9) as u64),
            _ => Err(anyhow!("{name} is a number of GB above 0")),
        })
        .transpose()
}
