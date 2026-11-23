//! Where the upstreams are, from the environment (`seedelf-data/.env` while
//! it's built locally, the service's environment file later). Every address
//! is config, so moving behind the tunnel changes values, not code.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};

use crate::edge::Reserve;
use crate::messaging::reading::Reading;

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
    /// What one address may read of a pool in a day (`messaging::reading`).
    pub messaging_reading: Reading,
    /// What's kept of each day's share of the relay's traffic for posts and short pages (`edge::Reserve`).
    pub messaging_reserve: Reserve,
    /// Seedelf Messaging stopped: every relay route answers 410 Gone (`edge::limit`), the rest goes on.
    pub messaging_off: bool,
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
            trust_proxy: switch("DATA_TRUST_PROXY", optional("DATA_TRUST_PROXY").as_deref())?,
            egress_ceiling: gigabytes("DATA_EGRESS_GB_MONTH")?,
            messaging_egress_ceiling: gigabytes("DATA_MESSAGING_GB_MONTH")?,
            messaging_reading: reading(
                optional("DATA_MESSAGING_READ_MIB_DAY").as_deref(),
                optional("DATA_MESSAGING_READ_POOLS_DAY").as_deref(),
            )?,
            messaging_reserve: reserve(
                optional("DATA_MESSAGING_RESERVE_PERCENT").as_deref(),
                optional("DATA_MESSAGING_RESERVE_PAGE_KIB").as_deref(),
            )?,
            messaging_off: switch(
                "DATA_MESSAGING_OFF",
                optional("DATA_MESSAGING_OFF").as_deref(),
            )?,
            state_dir: optional("DATA_STATE_DIR")
                .or_else(|| optional("STATE_DIRECTORY"))
                .map(PathBuf::from),
        })
    }
}

/// `true` or `false` in a variable's value; unset is false. Anything else is
/// refused at start: a typo in a switch would otherwise run the API the
/// other way from the one its owner chose.
fn switch(name: &str, value: Option<&str>) -> Result<bool> {
    match value.map(str::trim) {
        None | Some("false") => Ok(false),
        Some("true") => Ok(true),
        Some(_) => bail!("{name} is true or false"),
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

/// A whole number from `least` to `most` in a variable's value, if it's set.
/// A value that isn't one is refused at start: a typo here would otherwise
/// run the relay on a limit nobody chose.
fn whole(name: &str, value: Option<&str>, least: u64, most: u64) -> Result<Option<u64>> {
    value
        .map(|value| match value.trim().parse::<u64>() {
            Ok(number) if (least..=most).contains(&number) => Ok(number),
            _ => Err(anyhow!("{name} is a whole number from {least} to {most}")),
        })
        .transpose()
}

/// The day's reading for each address: `DATA_MESSAGING_READ_MIB_DAY`, the
/// least in MiB, and `DATA_MESSAGING_READ_POOLS_DAY`, how many times a
/// pool's cap at least. Unset, each is [`Reading::DEFAULT`]'s.
fn reading(mib: Option<&str>, pools: Option<&str>) -> Result<Reading> {
    let default = Reading::DEFAULT;
    // At most a TiB a day, and a thousand pools: past any use, and far from overflowing.
    let floor = whole("DATA_MESSAGING_READ_MIB_DAY", mib, 1, 1 << 20)?;
    let pools = whole("DATA_MESSAGING_READ_POOLS_DAY", pools, 0, 1000)?;
    Ok(Reading {
        floor: floor.map_or(default.floor, |mib| mib << 20),
        pools: pools.unwrap_or(default.pools),
    })
}

/// The reserve of the relay's day: `DATA_MESSAGING_RESERVE_PERCENT`, the
/// part of a day's share kept for posts and short pages (0, none), and
/// `DATA_MESSAGING_RESERVE_PAGE_KIB`, the longest page sent from it. Unset,
/// each is [`Reserve::DEFAULT`]'s.
fn reserve(percent: Option<&str>, kib: Option<&str>) -> Result<Reserve> {
    let default = Reserve::DEFAULT;
    let percent = whole("DATA_MESSAGING_RESERVE_PERCENT", percent, 0, 100)?;
    // A page is at most 256 KiB of envelopes and its framing: 512 lets every page through.
    let kib = whole("DATA_MESSAGING_RESERVE_PAGE_KIB", kib, 1, 512)?;
    Ok(Reserve {
        part: percent.map_or(default.part, |percent| percent as f64 / 100.0),
        page: kib.map_or(default.page, |kib| (kib as usize) << 10),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_relays_reading_and_reserve_come_from_the_environment_or_their_defaults() {
        assert_eq!(reading(None, None).unwrap(), Reading::DEFAULT);
        assert_eq!(
            Reading::DEFAULT,
            Reading {
                floor: 256 << 20,
                pools: 8
            }
        );
        assert_eq!(
            reading(Some("1024"), Some("2")).unwrap(),
            Reading {
                floor: 1024 << 20,
                pools: 2
            }
        );
        // One alone leaves the other as it was.
        assert_eq!(reading(Some(" 64 "), None).unwrap().pools, 8);
        assert_eq!(reading(None, Some("0")).unwrap().floor, 256 << 20);

        assert_eq!(reserve(None, None).unwrap(), Reserve::DEFAULT);
        assert_eq!(
            Reserve::DEFAULT,
            Reserve {
                part: 0.10,
                page: 16 * 1024
            }
        );
        assert_eq!(
            reserve(Some("25"), Some("32")).unwrap(),
            Reserve {
                part: 0.25,
                page: 32 * 1024
            }
        );
        // No reserve at all.
        assert_eq!(reserve(Some("0"), None).unwrap().part, 0.0);
    }

    /// `DATA_MESSAGING_OFF` (the relay's off switch), read as
    /// `DATA_TRUST_PROXY` is: true or false, unset is false, and anything
    /// else is refused at start rather than guessed at.
    #[test]
    fn the_relays_off_switch_is_true_or_false() {
        let off = |value| switch("DATA_MESSAGING_OFF", value);
        assert!(!off(None).unwrap());
        assert!(!off(Some("false")).unwrap());
        assert!(off(Some("true")).unwrap());
        assert!(off(Some(" true ")).unwrap());
        for bad in ["TRUE", "yes", "1", "on", "off", "0"] {
            let error = off(Some(bad)).unwrap_err().to_string();
            assert_eq!(error, "DATA_MESSAGING_OFF is true or false", "{bad}");
        }
        // The proxy's switch is read the same way.
        assert!(switch("DATA_TRUST_PROXY", Some("true")).unwrap());
        assert!(switch("DATA_TRUST_PROXY", Some("ture")).is_err());
    }

    #[test]
    fn a_value_that_isnt_a_number_in_range_is_refused_at_start() {
        for bad in ["0", "-1", "1.5", "256MiB", "", "1048577"] {
            assert!(reading(Some(bad), None).is_err(), "{bad}");
        }
        for bad in ["-1", "eight", "1001"] {
            assert!(reading(None, Some(bad)).is_err(), "{bad}");
        }
        for bad in ["101", "10%", "0.1", "-5"] {
            assert!(reserve(Some(bad), None).is_err(), "{bad}");
        }
        for bad in ["0", "513", "16KiB"] {
            assert!(reserve(None, Some(bad)).is_err(), "{bad}");
        }
        let error = reading(Some("lots"), None).unwrap_err().to_string();
        assert_eq!(
            error,
            "DATA_MESSAGING_READ_MIB_DAY is a whole number from 1 to 1048576"
        );
    }
}
