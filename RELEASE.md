# Release

Change the version then run the command in the parent folder.

```bash
# set the version
version="0.3.5"
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

Publish to crates.io with this command.

```bash
cargo package
cargo publish --dry-run
```

## Recompiling

If a recompile is required to change the contract hashes, then the `seedelf-contracts/README.md` must be updated to reflect the changes. 

## Re-releasing Tag

Removing a tagged release involves deleting it locally and deleting the tagged branch.

```bash
version="0.3.5"
git tag -d ${version}
git push origin --delete ${version}
```
