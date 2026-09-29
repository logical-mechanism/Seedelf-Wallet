use seedelf_display::version_control::{
    compare_versions, get_latest_version, override_github_base,
};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[test]
fn same_version() {
    assert!(compare_versions("0.4.6", "0.4.6"))
}

#[test]
fn need_to_update() {
    assert!(!compare_versions("0.4.5", "0.4.6"))
}

#[test]
fn major_minor_tests() {
    assert!(compare_versions("0.5.5", "0.4.6"))
}

const LATEST: &str = "/repos/logical-mechanism/Seedelf-Wallet/releases/latest";

/// The update check against a local stand-in for GitHub's API, through the
/// `override_github_base` seam: no real network call, so no rate limit (the
/// live API answers 403 to CI runners that ask too often). One test, since
/// the seam is process-wide.
#[tokio::test]
async fn reads_the_latest_release_tag() {
    let github = MockServer::start().await;
    override_github_base(Some(github.uri()));

    // The tag of the latest release, asked for with the User-Agent GitHub requires.
    Mock::given(method("GET"))
        .and(path(LATEST))
        .and(header("User-Agent", "seedelf"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "tag_name": "0.4.10", "name": "v0.4.10" })),
        )
        .up_to_n_times(1)
        .mount(&github)
        .await;
    assert_eq!(get_latest_version().await.unwrap(), "0.4.10");

    // An answer without a tag is an error, not a version.
    Mock::given(method("GET"))
        .and(path(LATEST))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .up_to_n_times(1)
        .mount(&github)
        .await;
    let missing = get_latest_version().await.unwrap_err().to_string();
    assert!(missing.contains("tag_name not found"), "{missing}");

    // So is a refusal, such as GitHub's rate limit.
    Mock::given(method("GET"))
        .and(path(LATEST))
        .respond_with(ResponseTemplate::new(403))
        .mount(&github)
        .await;
    let limited = get_latest_version().await.unwrap_err().to_string();
    assert!(limited.contains("403"), "{limited}");

    override_github_base(None);
}
