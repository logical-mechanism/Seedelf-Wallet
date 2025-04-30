# Seedelf - A Cardano Stealth Wallet

**Seedelf** is a stealth wallet that hides the receiver and spender using a non-interactive variant of Schnorr's Σ-protocol for the Discrete Logarithm Relation. It should be computationally infeasible to deduce the intended receiver or spender of UTxOs inside this wallet.

The [seedelf-cli](./seedelf-cli/README.md) is available on Linux, Windows, and MacOS.

## What is a Seedelf?

The wallet name, **Seedelf**, comes from the prefix of the identifier token used to locate the datum of a UTxO inside the wallet contract. The root datum becomes readily available by searching for a specific seedelf token, providing a personalized touch while maintaining privacy.

Its primary purpose is to locate the root datum for re-randomization. Alice can ask Bob to send funds to their seedelf. Bob can find the UTxO that holds the seedelf token inside the contract and will use that datum to re-randomize a new datum for Alice. Bob will then send funds to the contract with this new randomized datum.

### Seedelf Personalization

The token name scheme:

```
5eed0e1f | personal | Idx | Tx
```

The token name scheme has these lengths: 8 for the prefix, 30 for personal, 2 for Tx#Idx, and 24 for Tx#Id.

**Note: Not all personal tags can be converted into ASCII.**

For example, the personal tag below can't be converted to ASCII, but it can still be displayed in hex.

```
seedelf: 5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea

username: 00000acab00000018732122c62aea8

display name: 00000acab00000018732122c62aea8
```

But some do convert and can be displayed correctly.

```
5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2

username: 5b416e6369656e744b72616b656e5d

display name: [AncientKraken]
```

The personal tag creates a custom touch for a seedelf that can be used for search purposes.

## What is a Stealth Wallet?

A stealth wallet hides the receiver and spender of funds inside the contract. Below is a quick overview of how the wallet contract works.

### Terminology

`G1`: The base $\mathbb{G}_{1}$ generator from BLS12-381.

`Generator`: An element of the curve that will produce more curve elements with scalar multiplication.

`Public Value`: The user's public value element; this information is known publicly.

`Register`: The datum consisting of the generator and the public value.

`Re-randomizing`: Allows constructing a new register from an existing one.

### Spendability

The Register contains the generator and the public key for some UTxO. 

```rust
pub type Register {
  /// the generator, #<Bls12_381, G1>
  generator: ByteArray,
  /// the public value, #<Bls12_381, G1>
  public_value: ByteArray,
}
```

A UTxO is spendable if the transaction can prove the secret key's knowledge using a non-interactive zero-knowledge Schnorr Σ-protocol. A valid proof has the form:

$$
g^{z} = g^r u^c,
$$

where $z = r + c \cdot x$ and $u = g^{x}$. The value $g$ is the generator, and $u$ is the public value. The secret value is $x$. The current implementation uses the Fiat-Shamir heuristic for non-interactivity.

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

In the contract, there will be many UTxOs with unique registers. A user can always find their UTxOs by searching the UTxO set at the contract address and finding all the registers that satisfy $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ for the user's secret $x$.

## Wallet Limitations

The wallet is just a smart contract. It is bound by the cpu and memory units of the underlying blockchain, meaning that a UTxO can only hold so many tokens before it becomes unspendable due to space and time limitations. In this implementation, the value is not hidden nor mixed in any way, shape, or fashion. This contract is equivalent to generating addresses using a hierarchical deterministic wallet, but instead of keeping the root key private and generating the address when asked, it is now public via a datum, and address generation is the sender's duty and not the receiver's.

Sending funds requires a correct and equal $d$ value applied to both register elements. Incorrectly applied $d$ values will result in a stuck UTxO inside the contract.

$$
(g, u) \rightarrow (g^{d}, u^{d'}) \quad \text{where } d \neq d'
$$

This Register would become unspendable, resulting in lost funds.

### De-Anonymizing Attacks

There exist multiple attacks that are known to break the privacy of this wallet. The first attack is picking a bad $d$ value. A small $d$ value may be able to be brute-forced. Selecting a $d$ value on the order of $2^{254}$ circumvents the brute-force attack. The second attack does not correctly destroy the $d$ value information after the transaction. The $d$ value is considered toxic waste in this context. If the $d$ values are known for some users, it becomes trivial to invert the Register into the original form, thus losing all privacy. The third attack is tainted collateral UTxOs. On the Cardano blockchain, a collateral UTxO must be placed into a transaction as it incentivizes block producers to validate a failed transaction from the mempool. The collateral UTxO has to be associated with a payment credential, which means that the collateral UTxO, by definition, isn't anonymous, and the ownership is known the entire time. An outside user can watch collateral UTxOs inside a transaction to reveal a user's actions.

Privacy is preserved if $d$ is large and destroyed after use, and the collateral UTxO is shared.

#### De-Anonymizing Via IP Tracking

Seedelf communicates with third-party APIs such as `koios.rest` and `giveme.my`. These services track IP addresses as part of their abuse prevention and DoS protection mechanisms. `koios.rest` currently does not support access via Tor. Be aware that your public IP is linked with your Koios API requests. `giveme.my` does support Tor access, offering a more privacy-conscious alternative when needed but is not implemented at the CLI level. Consider routing traffic through a trusted VPN that doesn't log activity. Do not use Seedelf from a personal device or identifiable IP for maximum privacy when engaging in sensitive activity. 

We're actively and continuously exploring options for Tor access to all services Seedelf depends on, ensuring a more secure future.

**Please note that `crate.io` and `github.com` track IP addresses when using `cargo install` and `git clone`, respectively.**

### Troll Attacks

The design of the wallet contract opens users to a troll attack by overloading a UTxO with a large but useless reference script. Creating this UTxO results in the user, Alice, paying significantly more fees for that transaction, while Bob will pay more but less than Alice to spend that resulting UTxO. It's a useless troll attack that exists. The attack does not favor Alice and will cost her more to execute than it will be for Bob to spend the UTxO.

### Implicit Tracking Methods

As noted above, direct tracking methods are not feasible as long as the privacy-preserving techniques are followed. However, implicit tracking methods (ITMs) exist even under the assumption of privacy preservation.

The first ITM is entering the wallet for the first time as a CIP30 wallet will have to be used to mint the original seedelf. This requirement means that an outside wallet, $\omega$, is now linked to a seedelf, $\sigma$. The receivability and spendability of $\sigma$ remain hidden, but this linking will taint $\omega$ as a wallet that has interacted with Seedelf and is attempting to be stealthy. The user may use the `util mint` command to do a stealth seedelf mint producing $\sigma^{'}$, dropping all linkability with $\omega$, after the funding of $\sigma$. The original $\sigma$ may be removed after $\sigma^{'}$ is minted.

The second ITM is the linkability of sequential UTxOs via the transaction fee. The owner is hidden and unknown during a transaction, but it is safe to assume that the UTxO that pays the transaction fee remains under the original owner's control. Thus, the ownership could be implicitly linked if the fee-paying UTxO chain returns to $\omega$. Entering and exiting with different wallets will break the linkability. Enter with $\omega$ then exit with $\omega^{'}$. Or even better, never leave Seedelf.

The third ITM is a flood attack on the protocol itself. The stealthiness of the Seedelf protocol relies on a healthy population of seedelfs as the probability of ownership, $\rho(o)$, should be proportional as $1 / \vert \sigma \vert$, where $\vert \sigma \vert$ is the number of seedelfs in the contract. In the ideal case, $\rho(o) \rightarrow 0$ because $\vert \sigma \vert \gg 1$. In practice, users will have many $\sigma$ such that the number of unique seedelfs is less than the total number of seedelfs though these two magnitudes should roughly be comparable, i.e., $\vert \sigma \vert \sim \vert \sigma_{u} \vert$, where $\vert \sigma_{u} \vert$ is the number of uniquely owned seedelfs, assuming an honest distribution and a healthy population of seedelfs. The issue here is any rich bad actor may own a significant portion of $\vert \sigma \vert$ causing a flood attack. In the flood attack case, users sending funds into the contract have a massively increased $\rho(o)$ because $\vert \sigma_{u} \vert$ tends towards $\vert \sigma_{0} \vert$, the absolute minimum amount of honest actors in the system thus in the worst case limit, $\rho(o) \rightarrow 1 / \vert \sigma_{0} \vert$. The only solution here is encouraging healthy and honest use of the Seedelf protocol, ensuring that $\vert \sigma_{0} \vert \sim \vert \sigma_{u} \vert \sim \vert \sigma \vert$.

## Happy Path Test Scripts

The happy path for testing follows Alice and Bob as they interact with their seedelf wallets. The scripts will allow users to create and delete seedelfs, send tokens to another seedelf, and remove their tokens. The happy path has basic functionality, but it does serve as an example of how a seedelf wallet would work.

### Creating A seedelf

A seedelf will be saved locally inside a file. This file is a simple way to store the secret value $x$ and the original register values.

### Removing Funds

Removing funds is a simple process. Given a secret value $x$, search the UTxO set for all registries that satisfy the condition that $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ which do not contain your seedelf token. Each UTxO a user wishes to spend requires NIZK proof, as shown below.

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

These ZK elements combined with a register are the only required knowledge to spend a UTxO. The spent UTxOs can be sent to any non-seedelf wallet or recombined into a new UTxO inside the seedelf wallet with a new re-randomized register. A random key signature is required to create a one-time pad for the proof, as funds could be re-spent without it because a transaction can drop mempool during a rollback event, and a malicious user can pick off the proof and resubmit. The re-spending of the proof is entirely circumvented by having a random key sign the transaction and using that verification key hash inside the Fiat-Shamir transform.

### Sending Funds

Sending funds works similarly to removing funds, but instead of sending funds out of the contract, they spend them back in the contract with a new re-randomized register by finding the Register on some other seedelf token. This act preserves privacy. An outside user should only see random UTxOs collected and sent to a new random register. The link between Alice and Bob should remain hidden.

### Non-Mixability

Spendability is always in the hands of the original owner. It is safe to assume a singular owner if two UTxOs from the contract are inside the same transaction. If two different users spent UTxOs together inside a single transaction, then there would be no way to ensure that one of the parties does not lose or steal funds. If Alice and Bob work together, then either Alice or Bob will have the chance of losing funds. Inside real mixers, the possibility of losing funds does not exist as the spendability is arbitrary, thus ensuring the mixing probably exists. The seedelf wallet is purely for stealth, not for mixing.

## Defeating The Collateral Problem

The `seedelf-cli` uses the [Cardano collateral provider](https://giveme.my/). Every user will share the same collateral UTxO, thus defeating the collateral problem.

## The **seedelf-cli**

Users can interact with the wallet protocol via the [seedelf-cli](./seedelf-cli/README.md).

## Contact

For questions, suggestions, or concerns, please contact support@logicalmechanism.io or join the [Seedelf Discord](https://discord.gg/r8VwV2jGBy).