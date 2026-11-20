//! l6reference#8 (trace check): every offline test `cargo test --workspace --locked` skips (an `#[ignore]` that is
//! neither a live Koios test nor the fixture recorder, which runs only on purpose) is named in development.md's
//! release checks, in checklist item 1 and in part 1's block, as `--test <file> -- --ignored`: CI runs no ignored
//! test (web-wallet.yml's `cargo test --workspace --locked`), so the release checks are the only place one runs.

use std::path::{Path, PathBuf};

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if path.is_dir() {
            if !matches!(name.as_str(), "target" | "node_modules" | "dist" | ".git") {
                rust_files(&path, out);
            }
        } else if name.ends_with(".rs") {
            out.push(path);
        }
    }
}

#[test]
fn every_offline_ignored_test_is_in_the_release_checks() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let dev = std::fs::read_to_string(root.join("seedelf-web-wallet/docs/development.md")).unwrap();
    let item1 = dev
        .lines()
        .find(|l| l.starts_with("1. **The automated layers:**"))
        .expect("checklist item 1");
    let block = dev
        .split("### 1. On the release branch")
        .nth(1)
        .and_then(|s| s.split("```bash").nth(1))
        .and_then(|s| s.split("```").next())
        .expect("part 1's block");

    let mut files = Vec::new();
    rust_files(root, &mut files);
    files.sort();
    let mut missing = Vec::new();
    let mut offline = Vec::new();
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            let line = line.trim();
            if !line.starts_with("#[ignore") {
                continue;
            }
            let function = lines[i + 1..]
                .iter()
                .find_map(|l| l.trim().split("fn ").nth(1))
                .and_then(|s| s.split('(').next())
                .unwrap_or("?")
                .to_string();
            if line.contains("live") || function == "record_the_extensions_session_swap_fixture" {
                continue;
            }
            let stem = file.file_stem().unwrap().to_string_lossy().to_string();
            let run = format!("--test {stem} -- --ignored");
            offline.push(format!("{stem}::{function}"));
            if !item1.contains(&run) || !block.contains(&run) {
                missing.push(format!(
                    "{}:{} {function} (`{run}`: in item 1 {}, in part 1's block {})",
                    file.strip_prefix(root).unwrap().display(),
                    i + 1,
                    item1.contains(&run),
                    block.contains(&run)
                ));
            }
        }
    }
    println!("offline ignored tests: {offline:?}");
    assert!(
        missing.is_empty(),
        "an offline test `cargo test --workspace --locked` skips runs in no check ({} of them):\n{}",
        missing.len(),
        missing.join("\n")
    );
}
