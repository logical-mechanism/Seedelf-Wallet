use reqwest::Client;
use semver::Version;
use serde_json::Value;

pub async fn get_latest_version() -> Result<String, Box<dyn std::error::Error>> {
    let url = "https://api.github.com/repos/logical-mechanism/Seedelf-Wallet/releases/latest";

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
