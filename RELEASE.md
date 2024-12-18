# Release

Change the version then run the command in the parent folder.

```bash
# set the version
version="0.2.2"
# update the toml files
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' aiken.toml
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-cli/Cargo.toml
# add, commit, and tag out
git add .
git commit -m "chore: tagging new release"
git push origin main
git tag ${version}
git push origin ${version}
```