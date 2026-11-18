# **seedelf-contracts**

The smart contracts of Seedelf, a stealth wallet for Cardano, written in [Aiken](https://aiken-lang.org/). There are three: the wallet contract, which holds every private UTxO (each payment to a Seedelf); the minting policy for Seedelfs, the `5eed0e1f…` NFTs a payer looks up; and an always-false script, which holds the reference scripts of the other two. The root [README](../README.md) explains how they work. This folder is for anyone who wants to read the contracts, check the deployed ones, or build them. To use Seedelf, use the [Seedelf Wallet](../seedelf-platform/seedelf-web-wallet/README.md) for Chrome or the [seedelf-cli](../seedelf-platform/README.md).

The folder also holds the [happy path scripts](happy-path-scripts/README.md), a `cardano-cli` test harness for preprod. These files are used for testing purposes only.

## Deployed contracts: version 1

Version 1 is what's on chain, on mainnet and on preprod (Cardano's test network); seedelf-core and the CLI's `--variant` flag call it variant 1. The CLI and the Seedelf Wallet use it, and every Seedelf and every private UTxO is under it. It's frozen: a Cardano script can't be changed once it's on chain, and none of the three has an upgrade path.

- **Source:** commit `5b82530` (version 0.2.1 in its `aiken.toml`), built with Aiken v1.1.9 and stdlib v2.2.0, with the seed `acabcafe`. The seed is a constant applied to each script as a parameter; the scripts never read it, so it changes only their hashes. That commit's `seedelf-contracts/contracts/` holds the deployed scripts, byte for byte, and its build script is `seedelf-contracts/complete_build.sh`.
- **Hashes:**

```bash
# version 1
wallet:       94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469  # 629 bytes
seedelf:      84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255  # 519 bytes
always_false: 6777ba4dc8c3043377201624502d92636381144700d49983258b75db  # holds the reference UTxOs
```

- **Reference UTxOs**, held by the always-false script:
  - mainnet: wallet `51f12c1a5c2b0558a284628d81b06dee50b27693242fe35618c5f921730c0527#1`, seedelf `f3955f42f660fae8b3e4dcf664011876cf769d87aa8450dc73171b4f6b5f520b#1`.
  - preprod: wallet `96fbddac63c55284fbbaa3c216ef1c0f460019e8643a889a189d5b5f7ddd71d6#1`, seedelf `f620a4e949bfbefbf2892d39d0777439f3acfbf850eae9b007c6558ba8ef4db4#1`.

### Checking version 1

To check the committed scripts' hashes without a build, run `cardano-cli conway transaction policyid` on each file, the same command the build script uses to write `hashes/`:

```bash
dir=$(mktemp -d)
for n in wallet seedelf always_false; do
  git show 5b82530:seedelf-contracts/contracts/${n}_contract.plutus > "$dir/${n}_contract.plutus"
  cardano-cli conway transaction policyid --script-file "$dir/${n}_contract.plutus"
done
```

Each should print its hash above. seedelf-verification, the formal proofs about version 1 (below), makes the same check in Python, in [`extract.sh`](../seedelf-verification/extract.sh), before its proofs read the scripts.

seedelf-core keeps a copy of the reference outputs, byte for byte as they sit on chain, in [`src/references.rs`](../seedelf-platform/seedelf-core/src/references.rs). Its [`tests/constants_test.rs`](../seedelf-platform/seedelf-core/tests/constants_test.rs) checks that each carries a script with these hashes and sizes, at the always-false script's address, on each network. The test reads that copy, not the chain: to check the chain's copies, look up the reference UTxOs above with a Cardano node or an explorer.

To rebuild with that commit's own build script, you need `aiken` v1.1.9 (which fetches stdlib v2.2.0 from GitHub itself), `cardano-cli`, `python3` and python's `cbor2` on your `PATH`. It writes `plutus.json`, `contracts/` and `hashes/`:

```bash
git worktree add ../seedelf-v1 5b82530
cd ../seedelf-v1/seedelf-contracts
./complete_build.sh
cat hashes/wallet.hash hashes/seedelf.hash hashes/always_false.hash
```

Compare its `hashes/` with the hashes above. The repository's own checks are on the committed bytes, not on a rebuild.

### This folder isn't version 1

This folder's source, `contracts/` and `hashes/` are a later, optimized revision that was never deployed, so their hashes aren't version 1's. The committed `contracts/` and `hashes/` were built with Aiken v1.1.19 and stdlib v3.0.0; `aiken.toml` now pins Aiken v1.1.24 and stdlib v4.0.0, so a rebuild today needn't match them either. [AUDIT.md](AUDIT.md) reviews this later revision, not the version 1 scripts on chain.

## What's been checked

- [AUDIT.md](AUDIT.md): a security review of the later revision's Aiken source, not of version 1.
- [seedelf-verification](../seedelf-verification/README.md): machine-checked proofs, in Lean 4, of exactly when each of version 1's scripts accepts a transaction, on its bytes as deployed. Its [CLAIMS.md](../seedelf-verification/CLAIMS.md) says what they cover and where they stop.

## Building

Compile the contracts with the `compile.sh` script. It needs `aiken`, `cardano-cli`, `python3` and python's `cbor2`, and it rewrites `plutus.json`, `contracts/` and `hashes/`. It applies the seed `acabcafe`, as version 1's build did.

## Testing

The command below will run all the tests.
```bash
aiken check
```

## For contributors

**A new hash is a new variant.** Never copy `hashes/` into seedelf-core's constants, and never change version 1's values there: a wallet pointed at an undeployed script shows no funds and can't spend. Putting a new build on chain means new reference UTxOs and a new variant beside version 1 (`--variant 2` in the CLI), which stays for the funds already under it. seedelf-core's `tests/constants_test.rs` pins version 1.

## Contact

For support and bugs, open a [GitHub issue](https://github.com/logical-mechanism/Seedelf-Wallet/issues) or a support ticket in the [Seedelf Discord](https://discord.gg/r8VwV2jGBy). For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io. Security vulnerabilities go by email only: see [SECURITY.md](../SECURITY.md).
