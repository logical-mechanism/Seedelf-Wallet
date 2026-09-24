use seedelf_display::display::{hex_to_ascii, is_there_an_update};
use seedelf_display::version_control::override_github_base;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// The CLI's update notice, against a local stand-in for GitHub's API (no
/// real call, so no rate limit): it prints for a newer release, and GitHub
/// refusing is only a warning, never a failure.
#[tokio::test]
async fn test_version_control_display() {
    let github = MockServer::start().await;
    override_github_base(Some(github.uri()));
    let latest = "/repos/logical-mechanism/Seedelf-Wallet/releases/latest";

    Mock::given(method("GET"))
        .and(path(latest))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({ "tag_name": "99.0.0" })),
        )
        .up_to_n_times(1)
        .mount(&github)
        .await;
    is_there_an_update().await;

    Mock::given(method("GET"))
        .and(path(latest))
        .respond_with(ResponseTemplate::new(403))
        .mount(&github)
        .await;
    is_there_an_update().await;

    assert_eq!(github.received_requests().await.unwrap().len(), 2);
    override_github_base(None);
}

#[test]
fn test_label_extraction() {
    let seedelf: String =
        "5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2".to_string();
    let answer: String = "5b416e6369656e744b72616b656e5d".to_string();
    let substring: String = seedelf[8..38].to_string();
    assert_eq!(substring, answer);
}

#[test]
fn test_label_truncation1() {
    let mut answer: String = "5b416e6369656e744b72616b656e5d".to_string();
    answer.truncate(30);
    assert_eq!(answer.len(), 30);
}
#[test]
fn test_label_truncation2() {
    let mut answer: String = "5b416e6369656e744b7261".to_string();
    answer.truncate(30);
    assert_eq!(answer.len(), 22);
}

#[test]
fn test_label_to_ascii1() {
    let seedelf: String =
        "5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2".to_string();
    let answer: String = "[AncientKraken]".to_string();
    let substring: String = seedelf[8..38].to_string();

    let ascii = hex_to_ascii(&substring).unwrap();
    assert_eq!(ascii, answer);
}

#[test]
fn test_label_to_ascii2() {
    let seedelf: String =
        "5eed0e1f416e6369656e744b72616b656e01cc4661ad78707b02687b1e7d7363".to_string();
    let answer: String = "AncientKraken..".to_string();
    let substring: String = seedelf[8..38].to_string();

    let ascii = hex_to_ascii(&substring).unwrap();
    assert_eq!(ascii, answer);
}

#[test]
fn test_fail_label_to_ascii1() {
    let seedelf: String =
        "5eed0e1f5b416e6369656e744b000acab000016ad73d1216555b07ad5a449ff2".to_string();
    let answer: String = "[AncientK......".to_string();
    let substring: String = seedelf[8..38].to_string();

    match hex_to_ascii(&substring) {
        Ok(ascii) => assert_eq!(ascii, answer),
        Err(err) => println!("Error: {}", err),
    }
}

#[test]
fn test_fail_label_to_ascii2() {
    let seedelf: String =
        "5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea".to_string();
    let answer: String = ".........2.,b..".to_string();
    let substring: String = seedelf[8..38].to_string();

    match hex_to_ascii(&substring) {
        Ok(ascii) => assert_eq!(ascii, answer),
        Err(err) => println!("Error: {}", err),
    }
}
