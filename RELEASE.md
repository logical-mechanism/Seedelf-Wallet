# Release

Update version in `aiken.toml` and `seedelf-cli/Cargo.toml`.

```bash
version="0.2.2"
git add .
git commit -m "chore: tagging new release"
git push origin main
git tag ${version}
git push origin ${version}
```