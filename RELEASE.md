# Release

How to check a `seedelf-cli` release you've downloaded, and how the maintainers make one. The `seedelf-cli` is the terminal wallet for Seedelf, a stealth wallet for Cardano; the [README](README.md) explains how it works.

The CLI's releases are on the repository's [Releases](https://github.com/logical-mechanism/Seedelf-Wallet/releases) page. Each is tagged with its version number, such as `0.7.0`; the CLI and the [contracts](seedelf-contracts/README.md) share that `0.x.y` version line. For each tag, the GitHub Actions workflow [release.yml](.github/workflows/release.yml) builds the CLI for Linux, Windows and macOS on GitHub's runners; then one job, which builds nothing, signs what they built with the release key and attaches the files to a release. Only that job reads the key, which is held in the repository's `release` environment, and only once a maintainer approves it. The Seedelf Wallet for Chrome is released separately, on its own `1.x` line: its packages, their commits and their zip hashes are in [releases.md](seedelf-platform/seedelf-web-wallet/docs/releases.md).

## Checking a release

A release carries these files:

| File | What it is |
|------|------------|
| `seedelf-cli-linux.tar.gz` | The Linux binary, `seedelf-cli.bin` |
| `seedelf-cli-macos.tar.gz` | The macOS binary, `seedelf-cli.bin`, built for `x86_64-apple-darwin` |
| `seedelf-cli-windows.zip` | The Windows binary, `seedelf-cli.exe` |
| `*.asc` beside each archive | The archive's detached GPG signature |
| `hashes.txt` | The SHA-256 of each binary and each archive |
| `hashes.txt.asc` | The hashes file's detached GPG signature |

Everything is signed with the release key, [util/pubkeys/seedelfwallet.asc](util/pubkeys/seedelfwallet.asc):

| Name                        | Fingerprint                                       |
|-----------------------------|---------------------------------------------------|
| release@logicalmechanism.io | 759F 3952 BE14 AF01 AFEE 5861 A1A0 A20E 21B9 9053 |

`hashes.txt` has two lines for each system, one for the binary and one for its archive:

```
Linux Binary: <sha256>  seedelf-cli.bin
Linux Compressed File: <sha256>  seedelf-cli-linux.tar.gz
Windows Binary: <SHA256>
Windows Compressed File: <SHA256>
macOS Binary: <sha256>  seedelf-cli.bin
macOS Compressed File: <sha256>  seedelf-cli-macos.tar.gz
```

Import the key, check the signatures, then compare the archive's SHA-256 with its `Compressed File` line, by eye. For Linux:

```bash
gpg --import seedelfwallet.asc
gpg --fingerprint release@logicalmechanism.io
gpg --verify seedelf-cli-linux.tar.gz.asc seedelf-cli-linux.tar.gz
gpg --verify hashes.txt.asc hashes.txt
sha256sum seedelf-cli-linux.tar.gz
```

Each `gpg --verify` should report a good signature from the release key, with the fingerprint above. After unpacking, the binary's SHA-256 should match its `Binary` line. On macOS, `shasum -a 256 seedelf-cli-macos.tar.gz` gives the hash. On Windows, PowerShell's `Get-FileHash seedelf-cli-windows.zip -Algorithm SHA256` gives it in capital letters, which is how `hashes.txt` writes Windows' lines.

## Making a release

This part is for the maintainers. A CLI release is the Rust workspace and the contracts, tagged `x.y.z`. release.yml runs on every tag that matches `*.*.*`, and a tag glob's `*` doesn't match a slash. So the Seedelf Wallet's tags contain a slash, `web-wallet/<version>`, and never start a CLI release; the wallet's own release procedure is in [development.md](seedelf-platform/seedelf-web-wallet/docs/development.md).

**The `release` environment** (Settings → Environments) is what holds the key: the maintainer as its required reviewer, with *Prevent self-review* off, since whoever pushes the tag approves the run; deployments from tags matching `*.*.*` alone; and `RELEASE_GPG_KEY` and `GPG_PASSPHRASE` as its secrets, never as the repository's. release.yml's build jobs get a read-only token and no secret, since they run every crate's build script; only its `sign-and-publish` job, which builds nothing, reads the key and can write.

Change the version, then run the command below in the repository's root, on `main` as GitHub has it: `git switch main && git pull --ff-only` first. On a stale `main` the push is refused, but the lines after it still tag and push a commit `main` doesn't hold, and release.yml builds that. Where `main` already has the version, as 0.8.0's PR set it, the `sed` and `cargo update` lines change nothing and `git commit` finds nothing to commit: the tag starts the release.

```bash
# set the version being released
version="0.8.0"
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

Wait for release.yml's three builds to pass, then approve its `sign-and-publish` job (*Review deployments* on the run's page). It signs the archives and `hashes.txt` and creates the release as a draft: edit its body, then publish it as the latest release. Then publish to crates.io with the command below, in the repository's root.

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

Version 1 of the contracts (variant 1 in `seedelf-core` and the CLI's `--variant` flag) is frozen on chain; its hashes and reference UTxOs are in [seedelf-contracts/README.md](./seedelf-contracts/README.md#deployed-contracts-version-1). So a rebuild that changes the contract hashes is deployed only as a new variant: put up its reference UTxOs, add it beside variant 1 in `seedelf-core`'s `constants.rs` and `references.rs` (variant 1 never changes), then list it in [seedelf-contracts/README.md](./seedelf-contracts/README.md) beside version 1.

## Re-releasing Tag

To redo a release, delete its tag locally and on GitHub, and its release on the Releases page, draft or not, since each run of `sign-and-publish` makes a new draft. Then tag and push it again as above. A version already published to crates.io can't be published again.

```bash
version="0.8.0"
git tag -d ${version}
git push origin --delete ${version}
```

## Checking for new versions of dependencies

```bash
cargo outdated
```
