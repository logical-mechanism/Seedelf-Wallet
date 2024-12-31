# Release

Change the version then run the command in the parent folder.

```bash
# set the version
version="0.3.4"
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

Publish to crates.io

```bash
cargo package
cargo publish --dry-run
```

## Recompiling

If a recompile is required and it changes the contract hashes then the README inside of seedelf-contracts must be updated before release.