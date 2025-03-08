# Release

Change the version, then run the command below in the parent folder.

```bash
# set the version
version="0.4.5"
# update the toml files
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-contracts/aiken.toml
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-cli/Cargo.toml
# add, commit, and tag out
git add .
git commit -m "chore: tagging ${version} release"
git push origin main
git tag ${version}
git push origin ${version}
```

Wait for all checks to pass, then edit the tagged release body for proper formatting. Update the release from draft to latest, then publish to crates.io with the command below in the parent folder.

```bash
cd seedelf-cli
cargo clean
cargo test --release
cargo clippy -- -D warnings
cargo fmt -- --check
cargo package
cargo publish
cd ..
```

## Recompiling

If a recompile is required and the contract hashes change, then the [seedelf-contracts/README.md](./seedelf-contracts/README.md) must be updated to reflect the changes.

## Re-releasing Tag

Removing a tagged release involves deleting it locally and deleting the tagged branch.

```bash
version="0.4.5"
git tag -d ${version}
git push origin --delete ${version}
```

## Checking for new versions of dependencies

```bash
cargo outdated
```