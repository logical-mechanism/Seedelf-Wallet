# **seedelf-contracts**

The folder holds the Seedelf wallet smart contracts. [Aiken](https://aiken-lang.org/) is used to write the **Seedelf** smart contracts. The folder contains the happy path scripts. These files are used for testing purposes only. Users wishing to use the Seedelf wallet are encouraged to use the [Seedelf Wallet](../seedelf-platform/seedelf-web-wallet/README.md) for Chrome or [seedelf-cli](../seedelf-platform/README.md).

## Building

Compile the contracts with the `compile.sh` script. 

The random seed used in production is `acabcafe`.

## Deployed contracts: version 1

Version 1 is what's on chain, on mainnet and on preprod. The CLI and the Seedelf Wallet use it, and every Seedelf and every private UTxO is under it. It's frozen.

- **Source:** commit `5b82530` (package 0.2.1), built with Aiken v1.1.9 and stdlib v2.2.0, with the seed `acabcafe`. That commit's `contracts/` holds the deployed scripts, byte for byte.
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

**This folder isn't version 1.** Its source, `contracts/` and `hashes/` are a later revision, optimized and built with newer Aiken and stdlib versions, and it was never deployed. `compile.sh` builds that revision, so its hashes aren't version 1's. [AUDIT.md](AUDIT.md) reviews that revision too (package 0.4.10, Aiken v1.1.19), not the version 1 scripts on chain.

**A new hash is a new variant.** Never copy `hashes/` into seedelf-core's constants, and never change version 1's values there: a wallet pointed at an undeployed script shows no funds and can't spend. Putting a new build on chain means new reference UTxOs and a new variant (`--variant 2`) beside version 1, which stays for the funds already under it. seedelf-core's `tests/constants_test.rs` pins version 1.

## Testing

The command below will run all the tests.
```bash
aiken check
```

## Contact

For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io.