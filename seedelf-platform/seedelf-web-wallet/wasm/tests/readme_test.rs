//! The README's export table is the module's API, so every name JavaScript
//! calls is in it. 1.6.0's release review (321-lj-rust-data#2) found 14
//! missing, every one added since 1.5.0, and two rows describing 1.5.0's
//! requests: this catches the first kind, a row's fields are the review's.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// The names a source exports to JavaScript: each `js_name` and `js_class`,
/// and the item a bare `#[wasm_bindgen]` exports under its own name.
fn exports(source: &str) -> BTreeSet<String> {
    let ident = |s: &str| -> String {
        s.trim_start_matches(|c: char| c == '"' || c.is_whitespace())
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect()
    };
    let mut names = BTreeSet::new();
    for key in ["js_name", "js_class"] {
        for (at, _) in source.match_indices(key) {
            if let Some(value) = source[at + key.len()..].trim_start().strip_prefix('=') {
                names.insert(ident(value));
            }
        }
    }
    let lines: Vec<&str> = source.lines().map(str::trim).collect();
    for (i, line) in lines.iter().enumerate() {
        if *line != "#[wasm_bindgen]" {
            continue;
        }
        // The item it's on, past any other attributes.
        if let Some(item) = lines[i + 1..].iter().find(|l| !l.starts_with("#[")) {
            for kind in ["pub fn ", "pub struct ", "pub enum "] {
                if let Some(rest) = item.strip_prefix(kind) {
                    names.insert(ident(rest));
                }
            }
        }
    }
    names.remove("");
    names
}

/// Whether `name` is in `text` as a whole word, not inside a longer name.
fn names(text: &str, name: &str) -> bool {
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    text.match_indices(name).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + name.len()..].chars().next();
        !before.is_some_and(word) && !after.is_some_and(word)
    })
}

#[test]
fn the_readme_names_every_export() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let readme = fs::read_to_string(crate_dir.join("README.md")).unwrap();
    let mut exported = BTreeSet::new();
    for entry in fs::read_dir(crate_dir.join("src")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            exported.extend(exports(&fs::read_to_string(&path).unwrap()));
        }
    }
    // The table's own: the key, both accounts, a register, a few dozen calls.
    assert!(exported.len() > 80, "found only {exported:?}");
    let missing: Vec<&String> = exported.iter().filter(|n| !names(&readme, n)).collect();
    assert!(
        missing.is_empty(),
        "wasm/README.md's export table doesn't name {missing:?}"
    );
}
