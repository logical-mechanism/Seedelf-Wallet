# Seedelf - A Cardano Stealth Wallet

**Seedelf** is a stealth wallet for Cardano: it hides the receiver and the spender of the funds inside it. It's for Cardano users who want to be paid, and to pay, without those payments being tied to them.

Seedelf is a smart contract. Each payment goes into it under a fresh datum that looks random from the outside. A spend proves knowledge of the owner's secret key with a non-interactive variant of Schnorr's Σ-protocol for the Discrete Logarithm Relation, instead of a signature from a known key. It should be computationally infeasible to deduce the intended receiver or spender of UTxOs inside this wallet. The amounts and tokens stay visible (see [Wallet Limitations](#wallet-limitations)).

## Using Seedelf

There are two ways to use it:

- **The [Seedelf Wallet](./seedelf-platform/seedelf-web-wallet/README.md),** for Chrome: a Cardano wallet with Seedelf built in. Its public account is an ordinary Cardano account, and its private balance is Seedelf. **Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/seedelf-wallet/dkefopeefhophfkjkkdebhoklagjdmcp).**
- **The [seedelf-cli](./seedelf-platform/README.md),** a wallet for the terminal, on Linux, Windows, and macOS. Install it with `cargo install seedelf-cli`, or download a signed binary from the [latest release](https://github.com/logical-mechanism/Seedelf-Wallet/releases/latest) ([checking a release](./RELEASE.md#checking-a-release)).

The rest of this page is the protocol behind both: what a Seedelf is, how a stealth address works, and what can break its privacy.

## What is a Seedelf?

The wallet name, **Seedelf**, comes from the prefix of the identifier token, `5eed0e1f` ("seed elf"). A Seedelf is one of these tokens, an NFT that works like an ADA Handle for the wallet contract. It sits in the contract under its owner's root datum, the public Register (see [Terminology](#terminology)), which a payer re-randomizes into a fresh one for each payment (see [Stealth Address](#stealth-address)).

Its primary purpose is to locate the root datum for re-randomization. Alice can ask Bob to pay her Seedelf. Bob finds the UTxO inside the contract that holds Alice's Seedelf token, and uses its datum to re-randomize a new datum for Alice. Bob then sends the funds to the contract under this new datum.

### Seedelf Personalization

The token name scheme:

```
5eed0e1f | personal | Idx | Tx
```

The name is 32 bytes, 64 hex characters: 8 for the prefix, 30 for the personal tag, 2 for Tx#Idx, and 24 for Tx#Id. Tx#Id and Tx#Idx come from the output reference of the first input of the transaction that mints it. The personal tag is the minter's choice, cut to 15 bytes; a shorter tag leaves more of the Tx#Id in the name.

**Note: Not all personal tags can be converted into ASCII.**

For example, the personal tag below can't be converted to ASCII, but it can still be displayed in hex.

```
seedelf: 5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea

username: 00000acab00000018732122c62aea8

display name: 00000acab00000018732122c62aea8
```

But some do convert and can be displayed correctly.

```
seedelf: 5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449f

username: 5b416e6369656e744b72616b656e5d

display name: [AncientKraken]
```

The personal tag gives a Seedelf a custom touch, and it can be used to search for one.

## What is a Stealth Wallet?

A stealth wallet hides the receiver and spender of funds inside the contract. Below is a quick overview of how the wallet contract works.

### Terminology

`G1`: The base $\mathbb{G}_{1}$ generator from BLS12-381, the elliptic curve that Cardano's Plutus scripts have built-in operations for.

`Generator`: An element of the curve that produces more curve elements through scalar multiplication.

`Public Value`: The user's public value element; this information is known publicly.

`Register`: The datum consisting of the generator and the public value.

`Re-randomizing`: Allows constructing a new register from an existing one, by scaling both of its elements by the same random integer (see [Stealth Address](#stealth-address)).

### Spendability

The Register contains the generator and the public value for some UTxO.

```rust
pub type Register {
  // the generator, #<Bls12_381, G1>
  generator: ByteArray,
  // the public value, #<Bls12_381, G1>
  public_value: ByteArray,
}
```

A UTxO is spendable if the transaction can prove the knowledge of the secret key using a non-interactive zero-knowledge (NIZK) Schnorr Σ-protocol. A valid proof has the form:

$$
g^{z} = g^r u^c,
$$

where $z = r + c \cdot x$ and $u = g^{x}$. The value $g$ is the generator, and $u$ is the public value. The secret value is $x$. The value $r$ is a fresh secret integer, a nonce, the prover picks for each proof, and $c$ is the challenge. The current implementation uses the Fiat-Shamir heuristic for non-interactivity: $c$ is a hash of $g$, $g^{r}$, $u$ and the hash of a one-time signing key (see [Removing Funds](#removing-funds)).

#### Spendability Proof

$$
g^{z} = g^{r +c \cdot x} = g^{r} g^{x \cdot c} = g^{r} (g^{x})^{c}  = g^{r} u^{c}
$$

$$
\blacksquare
$$ 


### Stealth Address

A register defines a type of public address used to produce private addresses. A user wishing to create a stealth address for another user will find their public address and re-randomize the Register as the new datum of a future UTxO.

A user selects a random integer, $d$, and constructs a new register.

$$
(g, u) \rightarrow (g^{d}, u^{d}) \rightarrow (h, v)
$$

The new Register appears random from the outside viewer and can not be inverted back into the public Register because we assume the Elliptic Curve Decisional-Diffie-Hellman (ECDDH) problem is hard. The scalar multiplication of the Register maintains spendability while providing privacy about who owns the UTxO.

#### Re-randomization Spendability Proof

$$
h^{z} = h^{r} v^{c}
$$

$$
(g^{d})^{z} = (g^{d})^{r +c \cdot x} = (g^{d})^{r} (g^{x})^{d \cdot c} = (g^{d})^{r} (u^{d})^{c}
$$

$$
(g^{z})^{d} = (g^{r})^{d} (u^{c})^{d}
$$

$$
g^{z} = g^{r} u^{c}
$$

$$
\blacksquare
$$

The proof of re-randomization reduces to proving the original Schnorr Σ-protocol.

### Finding Spendable UTxOs From The Set

The contract holds many UTxOs, each under its own register. A user can always find their UTxOs by searching the UTxO set at the contract address and finding all the registers that satisfy $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ for the user's secret $x$.

## Wallet Limitations

The wallet is just a smart contract. It is bound by the cpu and memory units of the underlying blockchain, meaning that a UTxO can only hold so many tokens before it becomes unspendable due to space and time limitations. In this implementation, the value is not hidden nor mixed in any way, shape, or fashion. This contract is equivalent to generating addresses using a hierarchical deterministic wallet. However, instead of keeping the root key private and generating the address when requested, it is now public via a datum. Consequently, address generation is the sender's responsibility, not the receiver's.

Sending funds requires a correct and equal $d$ value applied to both register elements. Incorrectly applied $d$ values will result in a stuck UTxO inside the contract.

$$
(g, u) \rightarrow (g^{d}, u^{d'}) \quad \text{where } d \neq d'
$$

This Register would become unspendable, resulting in lost funds.

The contract does not verify that a Register's points lie in the prime-order subgroup of BLS12-381.
If a point carries any torsion component (a part outside that subgroup, i.e., it fails a subgroup membership check), the resulting on-chain Register becomes unspendable, as the validator will never consider it valid, resulting in lost funds. The CLI and the Seedelf Wallet make only torsion-free Registers, and check a Register's points before they pay it (`is_payable` in [seedelf-core's build.rs](./seedelf-platform/seedelf-core/src/build.rs)). If you bring your own points, you must check each one with a subgroup check, such as `is_torsion_free()` in the `blstrs` crate (or multiply it by the cofactor), before you pay a Register made from them.

Neither point may be the identity either: a Register whose public value is the identity can be spent by anyone.

A UTxO at the contract with no datum, or with a datum that isn't a Register, can be spent by anyone too. The contract lets such a UTxO go, so that a malformed payment is never locked for good.

### De-Anonymizing Attacks

There exist multiple attacks that are known to break the privacy of this wallet.

- **A bad $d$ value.** A small $d$ value may be brute-forced. Selecting a $d$ value on the order of $2^{254}$ circumvents the brute-force attack.
- **A $d$ value that isn't destroyed after the transaction.** The $d$ value is toxic waste in this context. If the $d$ values are known for some users, it becomes trivial to invert their Registers into the original form, losing all privacy.
- **Tainted collateral UTxOs.** On Cardano, a transaction that runs a script must carry a collateral UTxO, which pays block producers for validating a transaction whose script fails. The collateral UTxO has to be associated with a payment credential, so by definition it isn't anonymous, and its ownership is known the entire time. An outside user can watch the collateral UTxOs in transactions to reveal a user's actions.

Privacy is preserved if $d$ is large and destroyed after use, and the collateral UTxO is shared (see [Defeating The Collateral Problem](#defeating-the-collateral-problem)).

#### De-Anonymizing Via IP Tracking

The CLI communicates with `koios.rest`, a third-party API, and `giveme.my`, a collateral service. These services track IP addresses as part of their abuse prevention and DoS protection mechanisms. Every Seedelf spend is submitted through Koios and goes to `giveme.my` for its collateral, each from your IP address, so either service can group your private spends as one person's, and tie them to whatever else that address asks for, though the chain can't. The CLI's `create`, `fund` and `util extract` aren't Seedelf spends: a browser wallet you connect over CIP-30 (the standard way a web page talks to a Cardano browser wallet) signs and submits them. The CLI also asks `api.github.com` for its latest version on almost every command.

The [Seedelf Wallet](./seedelf-platform/seedelf-web-wallet/README.md) for Chrome talks to the same two services, and to CoinGecko (prices), Minswap (swaps) and Blockfrost's IPFS gateway (NFT images) for the features that need them; its [privacy.md](./seedelf-platform/seedelf-web-wallet/docs/privacy.md) says who learns what. On mainnet it reads and submits through its own server first, `mainnet.seedelf.logicalmechanism.io` ([seedelf-data](./seedelf-data/README.md)), and through Koios for any part that server can't answer. That server sees your IP address and what Koios would: your public account and the transactions you send, never which Seedelf UTxOs are yours until you spend them. Its proxy and API log no IP address and no request path, and it keeps IP addresses only in memory, to limit requests. The transactions it receives reach the network through its own Cardano node. Settings → Network → *Read Cardano through Koios only* turns it off, so the wallet reads through Koios alone; on preprod, Cardano's test network, it always does.

Neither the CLI nor the Seedelf Wallet has Tor built in. `koios.rest` does not support Tor access. `giveme.my` does support Tor access, but the CLI doesn't use it. For maximum privacy when engaging in sensitive activity, consider routing traffic through a trusted VPN that doesn't log activity, not using a personal device, or using an unidentifiable IP.

**Please note that `crates.io` and `github.com` track IP addresses when using `cargo install` and `git clone`, respectively.**

### Troll Attacks

The design of the wallet contract opens users to a troll attack: Alice pays Bob's Seedelf a UTxO overloaded with a large but useless reference script. Alice pays significantly more fees to create this UTxO. Bob pays more than usual to spend it, but less than Alice paid. The attack exists, but it's useless: it gains Alice nothing, and costs her more than it costs Bob.

### Implicit Tracking Methods

The [De-Anonymizing Attacks](#de-anonymizing-attacks) above track a user directly, and they are not feasible as long as the privacy-preserving techniques there are followed. However, implicit tracking methods (ITMs) exist even under the assumption of privacy preservation.

The first ITM is entering the wallet for the first time, as an ordinary Cardano wallet (a CIP-30 wallet for the CLI, the public account in the Seedelf Wallet) has to pay to mint the original Seedelf. This requirement means that an outside wallet, $\omega$, is now linked to a Seedelf, $\sigma$. The receivability and spendability of $\sigma$ remain hidden. Still, this linking will taint $\omega$ as a wallet that has interacted with the Seedelf protocol and is attempting to be stealthy. After funding $\sigma$, the user may use the CLI's `util mint` command to do a stealth Seedelf mint, paid from Seedelf funds, producing $\sigma^{'}$ with no link to $\omega$. The original $\sigma$ may be removed after $\sigma^{'}$ is minted.

The second ITM is the linkability of sequential UTxOs via the transaction fee. The owner is hidden and unknown during a transaction. Still, it is safe to assume that the UTxO that pays the transaction fee remains under the original owner's control. Thus, the ownership could be implicitly linked if the fee-paying UTxO chain returns to $\omega$. Entering and exiting with different wallets will break the linkability. Enter with $\omega$ then exit with $\omega^{'}$. Or even better, never leave Seedelf.

The third ITM is a flood attack on the protocol itself. The stealthiness of the Seedelf protocol relies on a healthy population of Seedelfs as the probability of ownership, $\rho(o)$, should be proportional to $1 / \vert \sigma \vert$, where $\vert \sigma \vert$ is the number of Seedelfs in the contract. In the ideal case, $\rho(o) \rightarrow 0$ because $\vert \sigma \vert \gg 1$. In practice, users will have many $\sigma$ such that the number of unique Seedelfs is less than the total number of Seedelfs. However, these two magnitudes should roughly be comparable, i.e., $\vert \sigma \vert \sim \vert \sigma_{u} \vert$, where $\vert \sigma_{u} \vert$ is the number of uniquely owned Seedelfs, assuming an honest distribution and a healthy population of Seedelfs. The issue here is that any rich bad actor may own a significant portion of $\vert \sigma \vert$, causing a flood attack. In the flood attack case, users sending funds into the contract have a massively increased $\rho(o)$ because $\vert \sigma_{u} \vert$ tends towards $\vert \sigma_{0} \vert$, the absolute minimum amount of honest actors in the system thus in the worst case limit, $\rho(o) \rightarrow 1 / \vert \sigma_{0} \vert$. The only solution here is encouraging healthy and honest use of the Seedelf protocol, ensuring that $\vert \sigma_{0} \vert \sim \vert \sigma_{u} \vert \sim \vert \sigma \vert$.

### Wallet File Storage

This section is about the CLI. The Seedelf Wallet for Chrome keeps no such file: its keys come from a recovery phrase, sealed in the browser under a password (see its [keys-and-accounts.md](./seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md#password-and-vault)).

When the CLI creates a wallet, it saves a file to the default `$HOME/.seedelf` folder. The file is encrypted with AES-256-GCM, under a key derived from a password with Argon2id, so it takes the password to decrypt. The CLI requires a password that meets these requirements.

```bash
# Minimum Length: At Least 14 Characters.
# Uppercase Letter: Requires At Least One Uppercase Character.
# Lowercase Letter: Requires At Least One Lowercase Character.
# Number: Requires At Least One Digit.
# Special Character: Requires At Least One Special Symbol.
```

The CLI attempts to help the user with the password requirements above. Still, ultimately, it is up to the user to select a sufficiently complex password. The wallet file has this structure:

```json
{
  "salt": "salt_here",
  "nonce": "nonce here",
  "data": "encrypted_data_here"
}
```

The wallet's secret key is generated randomly, from the randomness the operating system provides. The user must store the file or its contents safely: failing to do so may result in a lost or corrupted file, and with it the funds.

### Data Layer Reliance

Neither the CLI nor the Seedelf Wallet runs its own Cardano node. The CLI relies heavily on `koios.rest` for the data layer, providing UTxO information and transaction evaluation. The Seedelf Wallet for Chrome, on mainnet, relies first on its own data layer ([seedelf-data](./seedelf-data/README.md)), which reads its own Cardano node and two chain indexers, db-sync and Kupo, and on Koios for any part it can't answer; on preprod, Koios alone. Due to the wallet architecture, neither can spend a user's funds, as that would require knowledge of a user's secret key. Both are trusted to report the chain truthfully, though, as any wallet without its own node trusts its data source: a payment to a Seedelf goes under the register the data source reports for that name, and a payment to an ADA Handle (a `$name` that stands for an address) goes to the address it reports for that handle, so a data source that lied about either could redirect the payment. What either could also do is misreport the chain: hide UTxOs, or repeat a user's registers in UTxOs that don't exist, which would show a wrong balance until a transaction built on them is refused by the chain. The other bad case for the data layer is restricting access to the data necessary for Seedelf to function correctly; the Chrome wallet then falls back to Koios, part by part. So as long as the services it reads are fair, and one of them answers, Seedelf should be safe to use.

## Happy Path Test Scripts

The [happy path test scripts](./seedelf-contracts/happy-path-scripts/README.md) follow Alice and Bob as they use their Seedelfs, with `cardano-cli` on preprod. They create and burn Seedelfs, send funds to a Seedelf, and spend from one Seedelf to another. They're a test harness for the contracts, not a wallet. They use the contracts' current source, which isn't the version on mainnet and preprod ([the contracts' README](./seedelf-contracts/README.md#deployed-contracts-version-1) has that one), so what they make is invisible to the CLI and the Seedelf Wallet. They do show how each step works.

### Creating A Seedelf

The scripts save each Seedelf locally inside a file. This file is a simple way to store the secret value $x$ and the original register values.

### Removing Funds

Removing funds is a simple process. Given a secret value $x$, search the UTxO set for all registers that satisfy the condition that $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$, except the one that holds your Seedelf token: it stays in place, so others can keep finding your root Register (the CLI's `remove` burns it). Each UTxO a user wishes to spend requires an NIZK proof, as shown below.

```rust
/// The zero-knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic. The vkh used here is a one-time
/// pad for the proof to prevent rollback attacks.
///
pub type Proof {
  // this is z = r + c * x as a byte array
  z_b: ByteArray,
  // this is the g^r compressed G1Element
  g_r_b: ByteArray,
  // one-time use signature
  vkh: VerificationKeyHash,
}
```

These ZK elements, combined with a register, are the only required knowledge to spend a UTxO. The spent funds can be sent to any address outside the contract, or recombined into a new UTxO inside it under a new re-randomized register. The transaction must also be signed by a random one-time key, whose verification key hash, `vkh`, goes into the Fiat-Shamir transform. Without it, a proof could be reused: a transaction can drop out of the mempool during a rollback event, and a malicious user could pick off its proof and resubmit it. Having a random key sign the transaction, and binding the proof to that key's hash, entirely circumvents this.

### Sending Funds

Sending funds works similarly to removing funds, but instead of sending funds out of the contract, the sender spends them back into the contract under a new re-randomized register, made from the Register beside the recipient's Seedelf token. This act preserves privacy. An outside user should only see random UTxOs collected and sent to a new random register. The link between Alice and Bob should remain hidden.

## Note On Non-Mixability

Spendability is always in the hands of the original owner. It is safe to assume a singular owner if two UTxOs from the contract are inside the same transaction. If two different users spent UTxOs together inside a single transaction, then there would be no way to ensure that one of the parties does not lose or steal funds. If Alice and Bob work together, then either Alice or Bob will have the chance of losing funds. Inside real mixers, the possibility of losing funds does not exist as the spendability is arbitrary, and that is what makes the mixing work. Seedelf is purely for stealth, not for mixing. The Seedelf Wallet for Chrome offers mixing separately, through [Lovejoin](https://github.com/logical-mechanism/Lovejoin), a different contract that has had no third-party audit.

## Defeating The Collateral Problem

The `seedelf-cli` uses the [Cardano Collateral Provider](https://giveme.my/), `giveme.my`. Every user shares the same collateral UTxO, so on chain the collateral says nothing about who is spending, which defeats the tainted-collateral attack (see [De-Anonymizing Attacks](#de-anonymizing-attacks)). `giveme.my` itself still sees your IP address with each spend (see [De-Anonymizing Via IP Tracking](#de-anonymizing-via-ip-tracking)). The Seedelf Wallet uses `giveme.my`'s collateral for its Seedelf spends too, and for some of its Lovejoin transactions. Where a transaction already names one of the wallet's own key accounts, such as the public account, that account puts up its own collateral instead. Its [privacy.md](./seedelf-platform/seedelf-web-wallet/docs/privacy.md) has which transactions use which.

## What's In This Repository

- [seedelf-platform/](./seedelf-platform/README.md): the `seedelf-cli` and the Rust crates it's built from, and the [Seedelf Wallet](./seedelf-platform/seedelf-web-wallet/README.md) for Chrome.
- [seedelf-contracts/](./seedelf-contracts/README.md): the contracts, written in Aiken, with the deployed version's script hashes and reference UTxOs, and [AUDIT.md](./seedelf-contracts/AUDIT.md), a security review of a later revision of their source than the one on chain.
- [seedelf-data/](./seedelf-data/README.md): the Seedelf Wallet's mainnet data layer, the API at `mainnet.seedelf.logicalmechanism.io`.
- [seedelf-verification/](./seedelf-verification/README.md): machine-checked proofs, in Lean 4, of exactly when each deployed script accepts a transaction, on the scripts' bytes as deployed; its [CLAIMS.md](./seedelf-verification/CLAIMS.md) says what they cover and where they stop.
- [RELEASE.md](./RELEASE.md): how to check a CLI release you downloaded, and how one is made.

For contributors: the Seedelf Wallet's design starts at its [architecture.md](./seedelf-platform/seedelf-web-wallet/docs/architecture.md).

## Contact

For support and bugs, open a [GitHub issue](https://github.com/logical-mechanism/Seedelf-Wallet/issues) or a support ticket in the [Seedelf Discord](https://discord.gg/r8VwV2jGBy). For questions, suggestions, or concerns, please get in touch with support@logicalmechanism.io or join the Discord. Security vulnerabilities go by email only: see [SECURITY.md](./SECURITY.md).
