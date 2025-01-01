# Seedelf - A Cardano Stealth Wallet

**Seedelf** is a stealth wallet that hides the receiver and spender using a non-interactive variant of Schnorr's Σ-protocol for the Discrete Logarithm Relation. It is not possible to deduce the intended receiver or spender of UTxOs inside this wallet.

The [seedelf-cli](./seedelf-cli/README.md) is available on Linux, Windows, and MacOS.

## What is a Seedelf?

The wallet name, **Seedelf**, comes from the prefix of the identifier token used to locate the datum of a UTxO inside the wallet contract. A seedelf allows the root datum to be easily located and provides a personalized touch while maintaining privacy.

Its main purpose is for the ease of locating the datum for re-randomization. Alice can ask Bob to send funds to their seedelf. Bob can find the UTxO that holds the seedelf token inside the contract and will use that datum to re-randomize a new datum for Alice. Bob will then send funds to the contract with this new randomized datum.

### Seedelf Personalization

The token name scheme:

```
5eed0e1f | personal | Idx | Tx
```

8 for prefix, 30 for personal, 2 for Tx#Idx, 24 for Tx#Id.

Not all personal tags will be able to be converted into ASCII.

For example, the personal tag below can't convert to ASCII but it can still be displayed in hex.

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

The purpose of the personal tag is to create a custom touch for a seedelf that can be used for search purposes.

## What is a Stealth Wallet?

A stealth wallet hides the receiver and spender of funds inside the contract. Below is a quick overview of how the wallet contract works.

### Terminology

`Generator`: An element of the curve that will produce more elements of the curve with scaler multiplication.

`G1`: The base $\mathbb{G}_{1}$ generator from BLS12-381.

`Public Value`: The public value element of the curve, this information is known publicly.

`Register`: The datum consisting the generator and the public value.

`Re-randomizing`: The construction of a new register from an existing register.

### Spendability

The register contains the generator and the public key for some UTxO. 

```rust
pub type Register {
  /// the generator, #<Bls12_381, G1>
  generator: ByteArray,
  /// the public value, #<Bls12_381, G1>
  public_value: ByteArray,
}
```

A UTxO is spendable if the transaction can provide proof of knowledge of the secret key using a non-interactive zero knowledge Schnorr proof. A valid proof has the form:

$$
g^{z} = g^r u^c,
$$

where $z = r + c \cdot x$ and $u = g^{x}$. The value $g$ is the generator and $u$ is the public value. The secret value is $x$. The current implementation uses the Fiat-Shamir heuristic for non-interactivity.

#### Spendability Proof

$$
g^{z} = g^{r +c \cdot x} = g^{r} g^{x \cdot c} = g^{r} (g^{x})^{c}  = g^{r} u^{c}
$$

$$
\blacksquare
$$ 


### Stealth Address

A register defines a type of public address used to produce private addresses. A user wishing to create a stealth address for another user will find their public address and re-randomize the register as the new datum of a future UTxO.

A user selects a random integer, $d$, and constructs a new register.

$$
(g, u) \rightarrow (g^{d}, u^{d}) \rightarrow (h, v)
$$

From the outside viewer, the new register appears random and can not be inverted back into the public register because we assume the Elliptic Curve Decisional-Diffie-Hellman (ECDDH) problem is hard. The scalar multiplication of the register maintains spendability while providing privacy about who owns the UTxO.

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

The proof of re-randomization reduces to proving the original Schnorr proof.

### Finding Spendable UTxOs From The Set

In the contract, there will be many UTxOs with unique registers. A user can always find their UTxOs by searching the UTxO set at the contract address and finding all the registers that satisfy $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ for the user's secret $x$.

### Wallet Limitations

The wallet is just a smart contract. It is bound by the cpu and memory units of the underlying blockchain, meaning that a UTxO can only hold so many tokens before it becomes unspendable due to space and time limitations. In this implementation, the value is not hidden nor mixed in any way, shape, or fashion. This contract is equivalent to generating addresses using a hierarchical deterministic wallet, but instead of keeping the root key private and generating the address when asked, it is now public via a datum, and address generation is the sender's duty and not the receiver's.

Sending funds requires a correct and equal $d$ value applied to both elements of the register. Incorrectly applied $d$ values will result in a stuck UTxO inside the contract.

$$
(g, u) \rightarrow (g^{d}, u^{d'}) \quad \text{where } d \neq d'
$$

This register would become unspendable, resulting in lost funds.

### De-Anonymizing Attacks

There exist multiple attacks that are known to break the privacy of this wallet. The first attack comes from picking a bad $d$ value. A small $d$ value may be able to be brute-forced. The brute-force attack is circumvented by selecting a $d$ value on the order of $2^{254}$. The second attack comes from not properly destroying the $d$ value information after the transaction. The $d$ value is considered toxic waste in this context. If the $d$ values are known for some users then it becomes trivial to invert the register into the original form thus losing all privacy. The third attack is tainted collateral UTxOs. On the Cardano blockchain, a collateral must be put into a transaction to be taken if the transaction fails when being placed into the block. The collateral has to be on a payment credential which means that the collateral UTxO by definition isn't anonymous and the ownership is known the entire time. This means that an outside user could track a user's actions by simply watching which collaterals were used during transactions.

Privacy is preserved as long as $d$ is large and destroyed after use and the collateral used in the transaction is unconnectable to the original owner.

## Happy Path Test Scripts

The happy path for testing follows Alice and Bob as they interact with their seedelf wallets. The scripts will allow each user to create and delete seedelfs, send tokens to another seedelf, and remove their tokens. The happy path has very basic functionality but it does serve as an example as how a seedelf wallet would work.

### Creating A seedelf

A seedelf will be saved locally inside a file. This file is a simple way to store the secret value $x$ and the original register values.

An example seedelf file is shown below.
```json
{
  "a": "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
  "b": "8912c5a3e0a3f6dfeee8ab7e1559ad2ff40c4caf32c952593a1ab8863662c26e795176b3bb8930c58f566c53a885452c",
  "secret": 50932149572198509980040270467982453407914038612833920156636550490899997953674
}
```

### Removing Funds

Removing funds is a simple process. Given a secret value $x$, search the UTxO set for all registies that satify the condition that $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ which do not contain your seedelf token. The seedelf UTxO may be removed but typically it is left inside the contract for location purposes. Each UTxO that a user wishes to spend requires a NIZK proof to spend it, as shown below.

```rust
/// The zero knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic. The vkh is used as a one time
/// pad for the proof to prevent rollback attacks.
///
pub type Proof {
  // this is z = r + c * x as a bytearray
  z_b: ByteArray,
  // this is the g^r compressed G1Element
  g_r_b: ByteArray,
  // one time use signature
  vkh: VerificationKeyHash,
}
```

These ZK element combined with a register is the only required knowledge to spend a UTxO. The spent UTxOs can be sent to any non-seedelf wallet or can be recombined into a new UTxO inside the seedelf wallet with a new re-randomzied register. A random key signature is required to create a one-time pad for the proof as funds could be respendable without it due to the transaction being dropped during a rollback event and a user being able to pick off the proof and resubmit. This is completely circumvented by having a random key sign the transaction and using that verification key hash inside of the Fiat-Shamir transform.

### Sending Funds

Sending funds works very similarly to removing funds but the funds are sent to a new re-randomized register given by finding the register on some other seedelf token. This act perserves privacy. An outside user should only see random UTxOs being collected and sent to a new random register. The link between Alice and Bob should remain hidden.

### Non-Mixablility

Spendability is always in the hands of the original owner. If two UTxOs are being spent then it is safe to assume it is the same owner because if two different users spent UTxOs together inside of a single transaction then there would be no way to ensure funds are not lost or stolen by one of the parties. If Alice and Bob are working together then either Alice or Bob has the chance of losing funds. Inside of real mixers the chance of losing funds does not exist as the spendability is arbitrary thus ensuring the mixing probably exists. This is not the case inside the seedelf wallet. This wallet is purely just for stealth not for mixing.

## Defeating The Collateral Problem

The `seedelf-cli` uses the [Cardano collateral provider](https://giveme.my/). Every user will share the same collateral UTxO thus defeating the collateral problem.

## The **seedelf-cli**

Users can interact with the wallet protocol via the [seedelf-cli](./seedelf-cli/README.md).

## Contact

For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io.