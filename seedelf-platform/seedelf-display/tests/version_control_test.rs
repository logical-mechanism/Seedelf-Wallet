use seedelf_display::version_control::{compare_versions, get_latest_version};

#[test]
fn same_version() {
    assert_eq!(compare_versions("0.4.6", "0.4.6"), true)
}

#[test]
fn need_to_update() {
    assert_eq!(compare_versions("0.4.5", "0.4.6"), false)
}

#[test]
fn major_minor_tests() {
    assert_eq!(compare_versions("0.5.5", "0.4.6"), true)
}

#[tokio::test]
async fn get_latest_version_from_github() {
    match get_latest_version().await {
        Ok(tag) => assert_eq!(tag, env!("CARGO_PKG_VERSION")),
        Err(e) => panic!("Failed to fetch latest version: {}", e),
    }
}
