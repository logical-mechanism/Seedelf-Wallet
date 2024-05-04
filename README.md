# 5eed0e1f - A Stealth Wallet

- pronounced Seed Elf

## What is Seed Elf?

**Seed Elf** is a token identifier used to locate the primary address of a user inside the stealth wallet contract. A seed elf allows a stealth address to have a personalized touch while maintaining privacy.

Its main purpose is for the ease of locating a primary address. User Alice can ask Bob to send funds to their seed elf. Bob can find the UTxO that holds the seed elf and will use that registry and a random integer to generate a new UTxO for Alice.

```
5eed0e1f | personal | XX | txid
8 for prefix, 30 for personal, 2 for txIdx, 24 for txId
```

Not all personal tags will be able to be converted into ASCII.

For example, the personal tag below can't convert to ASCII but it can still be displayed in hex.

```
seed elf: 5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea

username: 00000acab00000018732122c62aea8

display name: 00000acab00000018732122c62aea8
```

But some do convert and can be displayed correctly.

```
5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2

username: 5b416e6369656e744b72616b656e5d

display name: [AncientKraken]
```

The stealth wallet contract is token agnostic, allowing any NFT to be the locator token. We suggest using a seed elf.

## What is a Stealth Wallet?

Below is a quick overview of the stealth wallet contract using the BLS12-381 curve.


### Terminology

`Generator`: An element of the curve that will produce more elements of the curve with scaler multiplication.

`G1`: The base g1 generator..

`Public Key`: The public key element of the curve, this information is known publicly.

`Registry`: The datum consisting the generator and the public key.

`Re-Randomizing`: The construction of a new registry from an existing and valid registry.

### Spendability

The registry contains the generator and the public key for some UTxO. A UTxO is spendable if the transaction can provide proof of knowledge of the secret key using a Schnorr signature.

A register in the UTxO Set, $(g, u)$, can be spent if the equation below is satisfied.

$$
g^{z} = g^r u^c
$$

Where $z = r + cx$ and $u = g^{x}$. The current implementation uses the Fiat-Shamir heuristic for non-interactivity.

### Spendability Proof

$$
g^{z} = g^{r +cx} = g^{r} u^{c} = g^{r} (g^{x})^{c} = g^{r} g^{xc} \\ \blacksquare
$$ 

### Stealth Address

A register defines a public address used to produce a private address. A user wishing to create a stealth address for another user will find the public address and re-randomize the register as the new datum of a future UTxO.

A user selects a random integer, d, and constructs a new registry.

$$
(g, u) \rightarrow (g^{d}, u^{d})
$$

From the outside viewer, the new registry appears random and can not be inverted back into the public registry because we assume the Decisional-Diffie-Hellman (DDH) problem is hard. The scalar multiplication of the registry maintains spendability while providing privacy about who owns the UTxO.

### Re-Randomization Spendability Proof

$$
(g^{d})^{z} = (g^{d})^{r +cx} = (g^{d})^{r} (u^{d})^{c} = (g^{d})^{r} ((g^{d})^{x})^{c} = g^{dr} g^{dxc} \\ \blacksquare
$$

### Finding Spendable UTxOs From The Set

In the contract, there will be many UTxOs with unique registries. A user can always find their UTxOs by searching the UTxO set from the contract and finding the registry such that $(g', u') \rightarrow (g')^{x} = u'$ holds for some secret x.

### Wallet Limitations

The wallet is just a smart contract. It is bound by the cpu and memory units of the underlying blockchain, meaning that a UTxO can only hold so many tokens before it becomes unspendable due to space and time limitations. In this implementation, the value is not hidden nor mixed in any way, shape, or fashion. This contract is equivalent to generating addresses using a hierarchical deterministic wallet.

Sending funds requires a correct and equal d value applied to both elements of the registry. Incorrectly applied d values will be stuck inside the contract as seen in the example below.

$$
(g, u) \rightarrow (g^{d}, u^{d'}) \quad \text{where } d \neq d'
$$

This registry would become unspendable, resulting in lost funds for both Bob and Alice.

### De-Anonymizing Attacks

Two attacks are known to break the privacy of this implementation. The first attack comes from picking a bad d value. A small d value may be able to be brute-forced. The brute-force attack is circumvented by selecting a d value on the order of $2^{254}$. The second attack comes from not properly destroying the d value information after the transaction. The d value is considered toxic waste in this context. If the d values are known for some users then it becomes trivial to invert the registry into the original form and lose all privacy.

Privacy is preserved as long as d is large and destroyed after use. This type of wallet can not be staked.

## Happy Path Testing Scripts

These contracts require PlutusV3 and the Conway era. The happy paths follow Alice and Bob as they interact with their seed elf wallets. The scripts will allow each user to create seed elfs, send tokens to another seed elf, and remove their tokens. The happy path has very basic functionality but it does serve as an example as how a seed elf wallet would work. In a real production environment, this type of contract would have to be integrated natively at the wallet level.

### Creating A Seed Elf

Use `01_createAddressUTxO` to create a seed elf from either Alice or Bob. This will produce a file inside a folder called `addrs`. This file is a simple way to store the secret value x and the original registry values.

An example seed elf file is shown below.
```json
{
    "a": "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    "b": "a2e4786cbc52f9e2f5266ed7fcabe88e01ba92e652c8be79b994c522724bba015ccdd038f42aa03f907a0f6ffe16fc4c",
    "secret": 6626762640525735488664943722689229887125200532629070040776184331198666927087
}
```

Be sure to keep it safe!

### Removing Funds

Removing funds is a simple process. Given a secret value x, search the UTxO set for all registies that satify the condition that $(g', u') \rightarrow (g')^{x} = u'$ which do not contain your seed elf token. The seed elf UTxO may be removed but typically it is left inside the contract for location purposes. Each UTxO that a user wishes to spend requires a ZK proof to spend it, as shown below.


```rust
pub type ZK {
  // this is z = r + c*x, where x is the secret
  z: ByteArray,
  // this is the g^r compressed G1Element, where g is the registry generator
  g_r: ByteArray,
}
```

These ZK element combined with a registry is the only required knowledge to spend a UTxO. The spent UTxOs can be sent to any non seed elf wallet or can be recombined into a new UTxO inside the seed elf wallet with a new re-randomzied registry.

### Sending Funds

Sending funds works very similarly to removing funds but the funds are sent to a re-randomized regsitry given by finding the registry on some other seed elf token. Bob could gire-randomized UTxOs to Bob's new re-randomized registry. This act should perserve privacy. An outside user should only see random UTxOs being collected and sent to a new random registry. The link between Alice and Bob should remain hidden.


### Non-Mixablility

Spendability is always in the hands of the original owner. If two UTxOs are being spent then it is safe to assume it is the same owner because if two different users spent UTxOs together inside of a single transaction then there would be no way to ensure funds are not lost or stolen by one of the parties. If Alice and Bob are working together then either Alice or Bob has the chance of losing funds. Inside of real mixers the chance of losing funds does not exist as the spendability is arbitrary thus ensuring the mixing probably exists. This is not the case inside the seed elf wallet.