//! The store's WebAssembly module checks integer overflow in core, crypto and
//! koios: `[profile.wasm-release]`'s per-package overrides in the workspace
//! Cargo.toml (#332), the profile `seedelf-web-wallet/wasm/build.sh` builds
//! the module with. Nothing else fails without them: every test build checks
//! overflow anyway, and the module's own tests pass on a module built without
//! them (1.7.0's release review, pr332#1, x-mut-rs#2). This reads the
//! settings, not the module: which crate's code keeps the checks is rustc's
//! call (the profile's comment says how).

use std::collections::BTreeMap;

/// The crates whose overflow the store's module checks.
const CHECKED: [&str; 3] = ["seedelf-core", "seedelf-crypto", "seedelf-koios"];

/// `s` cut at each `at` outside quotes, braces and brackets.
fn split(s: &str, at: char) -> Vec<String> {
    let (mut parts, mut part, mut quoted, mut depth) = (Vec::new(), String::new(), false, 0);
    for c in s.chars() {
        match c {
            '"' => quoted = !quoted,
            '{' | '[' if !quoted => depth += 1,
            '}' | ']' if !quoted => depth -= 1,
            c if c == at && !quoted && depth == 0 => {
                parts.push(std::mem::take(&mut part));
                continue;
            }
            _ => {}
        }
        part.push(c);
    }
    parts.push(part);
    parts
}

/// A dotted name with its quotes dropped: `a."b".c` is `a.b.c`.
fn name(dotted: &str) -> String {
    split(dotted, '.')
        .iter()
        .map(|s| s.trim().trim_matches('"'))
        .collect::<Vec<_>>()
        .join(".")
}

/// `key = value` under `table`, an inline table's settings each by its own.
fn put(settings: &mut BTreeMap<String, String>, table: &str, line: &str) {
    let [key, value] = <[String; 2]>::try_from(split(line, '=')).unwrap_or_default();
    let (key, value) = (name(&key), value.trim());
    if key.is_empty() || value.is_empty() {
        return;
    }
    let key = if table.is_empty() {
        key
    } else {
        format!("{table}.{key}")
    };
    match value.strip_prefix('{').and_then(|v| v.strip_suffix('}')) {
        Some(inline) => {
            for setting in split(inline, ',') {
                put(settings, &key, &setting);
            }
        }
        None => {
            settings.insert(key, value.to_string());
        }
    }
}

/// Each setting of a TOML file by its whole dotted name, as Cargo reads it:
/// `[a.b]` then `c.d = 1`, or `c = { d = 1 }`, is `a.b.c.d`. Only what a
/// manifest's tables use: a multi-line array's items are passed over.
fn settings(toml: &str) -> BTreeMap<String, String> {
    let mut settings = BTreeMap::new();
    let mut table = String::new();
    for line in toml.lines() {
        let line = split(line, '#').swap_remove(0);
        let line = line.trim();
        match line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            Some(header) => table = name(header.trim_matches(['[', ']'])),
            None => put(&mut settings, &table, line),
        }
    }
    settings
}

/// Which of [`CHECKED`] a module built with `manifest`'s wasm-release
/// doesn't check overflow in: a package's own setting, else the profile's.
fn unchecked(manifest: &str) -> Vec<&'static str> {
    let settings = settings(manifest);
    let profile = "profile.wasm-release";
    CHECKED
        .into_iter()
        .filter(|package| {
            let checks = settings
                .get(&format!("{profile}.package.{package}.overflow-checks"))
                .or_else(|| settings.get(&format!("{profile}.overflow-checks")));
            checks.map(String::as_str) != Some("true")
        })
        .collect()
}

#[test]
fn the_store_module_checks_overflow_in_core_crypto_and_koios() {
    assert_eq!(
        unchecked(include_str!("../../Cargo.toml")),
        Vec::<&str>::new()
    );
    // The profile the store's module is built with, and the module it makes.
    let build = include_str!("../../seedelf-web-wallet/wasm/build.sh");
    assert!(
        build
            .lines()
            .any(|l| l.starts_with("cargo build ") && l.contains(" --profile wasm-release")),
        "build.sh doesn't build the module with wasm-release"
    );
    assert!(build.contains("wasm32-unknown-unknown/wasm-release/seedelf_wasm.wasm"));
}

#[test]
fn the_settings_are_read_in_each_form_cargo_takes() {
    let forms = [
        "[profile.wasm-release]\npackage.seedelf-koios.overflow-checks = true\n\
         [profile.wasm-release.package.seedelf-core]\noverflow-checks = true # checked\n\
         [profile.wasm-release.package.\"seedelf-crypto\"]\noverflow-checks = true",
        "[profile.wasm-release.package]\nseedelf-core = { overflow-checks = true }\n\
         \"seedelf-crypto\" = { overflow-checks = true, opt-level = \"z\" }\n\
         seedelf-koios.overflow-checks = true",
        "[profile.wasm-release]\npackage = { seedelf-core = { overflow-checks = true }, \
         seedelf-crypto = { overflow-checks = true }, seedelf-koios = { overflow-checks = true } }",
        "[profile.wasm-release]\noverflow-checks = true",
    ];
    for form in forms {
        assert_eq!(unchecked(form), Vec::<&str>::new(), "{form}");
    }
    // Off, or left out (release's default, which wasm-release inherits), is
    // unchecked.
    let off = "[profile.wasm-release]\noverflow-checks = true\n\
               [profile.wasm-release.package.seedelf-core]\noverflow-checks = false";
    assert_eq!(unchecked(off), ["seedelf-core"]);
    assert_eq!(
        unchecked("[profile.wasm-release]\ninherits = \"release\""),
        CHECKED
    );
}
