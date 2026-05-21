use reqwest::Client;
use semver::Version;
use serde_json::Value;
use std::sync::RwLock;

/// Optional override for the GitHub API base URL used by the update check.
///
/// `None` in production, so the real `https://api.github.com` is used. Tests
/// point this at a local mock server so the suite makes no real network calls.
static GITHUB_BASE_OVERRIDE: RwLock<Option<String>> = RwLock::new(None);

/// Test seam: redirect the GitHub API base URL used by [`get_latest_version`].
///
/// Production code never calls this; pass `None` to restore the real host.
pub fn override_github_base(base: Option<String>) {
    *GITHUB_BASE_OVERRIDE
        .write()
        .expect("github base override lock poisoned") = base;
}

pub async fn get_latest_version() -> Result<String, Box<dyn std::error::Error>> {
    let base: String = GITHUB_BASE_OVERRIDE
        .read()
        .expect("github base override lock poisoned")
        .clone()
        .unwrap_or_else(|| "https://api.github.com".to_string());
    let url = format!("{base}/repos/logical-mechanism/Seedelf-Wallet/releases/latest");

    let client = Client::new();
    let response = client
        .get(url)
        .header("User-Agent", "seedelf") // GitHub requires this
        .send()
        .await?
        .error_for_status()?; // fails early if status isn't 200 OK

    let json: Value = response.json().await?;

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or("tag_name not found")?;

    Ok(tag.to_string())
}

// Helper function to compare versions
pub fn compare_versions(local: &str, latest: &str) -> bool {
    match (Version::parse(local), Version::parse(latest)) {
        (Ok(local_version), Ok(latest_version)) => local_version >= latest_version,
        _ => false, // If either version can't be parsed, assume it's not up to date
    }
}
