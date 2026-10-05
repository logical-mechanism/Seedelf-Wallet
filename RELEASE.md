# Release

This is the CLI's release: the Rust workspace and the contracts, on the `0.x.y` line, tagged `x.y.z`, which [release.yml](.github/workflows/release.yml) builds, signs and publishes. The Seedelf Wallet for Chrome is a separate `1.x` line with its own procedure in [development.md](seedelf-platform/seedelf-web-wallet/docs/development.md); it isn't tagged, and a tag for it must carry a slash (`web-wallet/<version>`) or release.yml ships signed CLI binaries off it.

Change the version, then run the command below in the parent folder.

```bash
# set the version
version="0.4.10"
# update the toml files
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-contracts/aiken.toml
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-platform/Cargo.toml
sed -i '0,/^seedelf-core = ".*"/s//seedelf-core = "'${version}'"/' seedelf-platform/Cargo.toml
sed -i '0,/^seedelf-crypto = ".*"/s//seedelf-crypto = "'${version}'"/' seedelf-platform/Cargo.toml
sed -i '0,/^seedelf-display = ".*"/s//seedelf-display = "'${version}'"/' seedelf-platform/Cargo.toml
sed -i '0,/^seedelf-koios = ".*"/s//seedelf-koios = "'${version}'"/' seedelf-platform/Cargo.toml
# Cargo.lock is tracked, and CI builds with --locked: move the workspace's own entries with it
cargo update --workspace --manifest-path seedelf-platform/Cargo.toml
# add, commit, and tag out
git add seedelf-contracts/aiken.toml seedelf-platform/Cargo.toml seedelf-platform/Cargo.lock
git commit -m "chore: tagging ${version} release"
git push origin main
git tag ${version}
git push origin ${version}
```

Wait for all checks to pass, then edit the tagged release body for proper formatting. Update the release from draft to latest, then publish to crates.io with the command below in the parent folder.

```bash
cd seedelf-platform
cargo clean
cargo fmt -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace --release
cargo publish -p seedelf-crypto
sleep 3
cargo publish -p seedelf-koios
sleep 3
cargo publish -p seedelf-display
sleep 3
cargo publish -p seedelf-core
sleep 3
cargo publish -p seedelf-cli
cd ..
```

## Recompiling

Variant 1 is frozen on chain, so a rebuild that changes the contract hashes is deployed only as a new variant: put up its reference UTxOs, add it beside variant 1 in `seedelf-core`'s `constants.rs` and `references.rs` (variant 1 never changes), then list it in [seedelf-contracts/README.md](./seedelf-contracts/README.md) beside version 1.

## Re-releasing Tag

Removing a tagged release involves deleting it locally and deleting the tagged branch.

```bash
version="0.4.10"
git tag -d ${version}
git push origin --delete ${version}
```

## Checking for new versions of dependencies

```bash
cargo outdated
```