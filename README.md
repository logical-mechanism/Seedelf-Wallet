# Seedelf - A Cardano Stealth Wallet

The seedelf wallet is stealth smart wallet that hides the receiver and spender using Schnorr proofs on the BLS12-381 curve.

## What is a Seedelf?

**Seedelf** is a token identifier used to locate the datum of a user inside the wallet contract. A seedelf allows the datum to have a personalized touch while maintaining privacy similar to how ADAHandle work but with a slight twist.

Its main purpose is for the ease of locating the datum for address generation. Alice can ask Bob to send funds to their seedelf. Bob can find the UTxO that holds the seedelf token and will use that registry and a random integer to generate a new address for Alice.

Token name scheme:

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

The stealth wallet contract is token agnostic, allowing any NFT to be the locator token. We suggest using a seedelf token.

## What is a Stealth Wallet?

Below is a quick overview of the wallet contract using the BLS12-381 curve.

### Terminology

`Generator`: An element of the curve that will produce more elements of the curve with scaler multiplication.

`G1`: The base g1 generator.

`Public Key`: The public key element of the curve, this information is known publicly.

`Registry`: The datum consisting the generator and the public key.

`Re-Randomizing`: The construction of a new registry from an existing and valid registry.

### Spendability

The registry contains the generator and the public key for some UTxO. A UTxO is spendable if the transaction can provide proof of knowledge of the secret key using a Schnorr signature.

A register in the UTxO Set, $(g, u)$, can be spent if a valid Schnorr proof exist of the form:

$$
g^{z} = g^r u^c,
$$

where $z = r + c \cdot x$ and $u = g^{x}$. The current implementation uses the Fiat-Shamir heuristic for non-interactivity.

#### Spendability Proof

$$
g^{z} = g^{r +c \cdot x} = g^{r} g^{x \cdot c} = g^{r} (g^{x})^{c}  = g^{r} u^{c}
$$

$$
\blacksquare
$$ 


### Stealth Address

A register defines a public address used to produce a private address. A user wishing to create a stealth address for another user will find the public address and re-randomize the register as the new datum of a future UTxO.

A user selects a random integer, d, and constructs a new registry.

$$
(g, u) \rightarrow (g^{d}, u^{d})
$$

From the outside viewer, the new registry appears random and can not be inverted back into the public registry because we assume the Elliptic Curve Decisional-Diffie-Hellman (ECDDH) problem is hard. The scalar multiplication of the registry maintains spendability while providing privacy about who owns the UTxO.

#### Re-Randomization Spendability Proof

$$
h \leftarrow g^{d}
$$

$$
v \leftarrow u^{d}
$$

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

In the contract, there will be many UTxOs with unique registries. A user can always find their UTxOs by searching the UTxO set at the contract address and finding all the registries that satisfy $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ holds for the user's secret $x$.

### Wallet Limitations

The wallet is just a smart contract. It is bound by the cpu and memory units of the underlying blockchain, meaning that a UTxO can only hold so many tokens before it becomes unspendable due to space and time limitations. In this implementation, the value is not hidden nor mixed in any way, shape, or fashion. This contract is equivalent to generating addresses using a hierarchical deterministic wallet.

Sending funds requires a correct and equal `d` value applied to both elements of the registry. Incorrectly applied `d` values will be stuck inside the contract as seen in the example below.

$$
(g, u) \rightarrow (g^{d}, u^{d'}) \quad \text{where } d \neq d'
$$

This registry would become unspendable, resulting in lost funds for both Bob and Alice.

### De-Anonymizing Attacks

Three attacks are known to break the privacy of this implementation. The first attack comes from picking a bad `d` value. A small `d` value may be able to be brute-forced. The brute-force attack is circumvented by selecting a `d` value on the order of $2^{254}$. The second attack comes from not properly destroying the `d` value information after the transaction. The `d` value is considered toxic waste in this context. If the `d` values are known for some users then it becomes trivial to track the registry into the original form and lose all privacy. The third attack is tainted collateral UTxOs. On the Cardano blockchain, a collateral must be put into a transaction to be taken if the transaction fails when being placed into the block. The collateral has to be on a payment credential which means that the UTxO isn't anonymous to start with then it is known the entire time. This means that an outside user could track a wallet by simply watching which collaterals were used.

Privacy is preserved as long as `d` is large and destroyed after use and the collateral used in the transaction is unconnectable to the original owner.. This type of wallet can not be staked.

## Happy Path Testing Scripts

The happy paths follow Alice and Bob as they interact with their seedelf wallets. The scripts will allow each user to create and delete seedelfs, send tokens to another seedelf, and remove their tokens. The happy path has very basic functionality but it does serve as an example as how a seedelf wallet would work.

### Creating A seedelf

A seedelf will be saved locally inside a file. This file is a simple way to store the secret value $x$ and the original registry values.

An example seedelf file is shown below.
```json
{
    "a": "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    "b": "a2e4786cbc52f9e2f5266ed7fcabe88e01ba92e652c8be79b994c522724bba015ccdd038f42aa03f907a0f6ffe16fc4c",
    "secret": 6626762640525735488664943722689229887125200532629070040776184331198666927087
}
```

Be sure to keep it safe!

### Removing Funds

Removing funds is a simple process. Given a secret value x, search the UTxO set for all registies that satify the condition that $(\alpha, \beta) \rightarrow \alpha^{x} = \beta$ which do not contain your seedelf token. The seedelf UTxO may be removed but typically it is left inside the contract for location purposes. Each UTxO that a user wishes to spend requires a ZK proof to spend it, as shown below.

```rust
/// The zero knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic. The vkh is used as a one time
/// pad for the proof to prevent rollback attacks.
///
pub type WalletRedeemer {
  // this is z = r + c * x as a bytearray
  z_b: ByteArray,
  // this is the g^r compressed G1Element
  g_r_b: ByteArray,
  // one time use signature
  sig: VerificationKeyHash,
}
```

These ZK element combined with a registry is the only required knowledge to spend a UTxO. The spent UTxOs can be sent to any non-seedelf wallet or can be recombined into a new UTxO inside the seedelf wallet with a new re-randomzied registry.

### Sending Funds

Sending funds works very similarly to removing funds but the funds are sent to a re-randomized regsitry given by finding the registry on some other seedelf token. Bob could gire-randomized UTxOs to Bob's new re-randomized registry. This act should perserve privacy. An outside user should only see random UTxOs being collected and sent to a new random registry. The link between Alice and Bob should remain hidden.

### Non-Mixablility

Spendability is always in the hands of the original owner. If two UTxOs are being spent then it is safe to assume it is the same owner because if two different users spent UTxOs together inside of a single transaction then there would be no way to ensure funds are not lost or stolen by one of the parties. If Alice and Bob are working together then either Alice or Bob has the chance of losing funds. Inside of real mixers the chance of losing funds does not exist as the spendability is arbitrary thus ensuring the mixing probably exists. This is not the case inside the seedelf wallet.

## Defeating The Collateral Problem

TODO

## The Seedelf Application

TODO