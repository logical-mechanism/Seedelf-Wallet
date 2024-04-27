# 5eed0e1f - A Stealth Wallet

- pronounced Seed Elf

## What is Seed Elf?

**Seed Elf** is a token identifier to locate primary addresses inside the stealth wallet contract. The token allows the creation of a personalized random token name so that each address can have a username. A seed elf allows an address to be personalized touch while maintaining privacy.

Its main purpose is for ease of locating a primary address. User A can ask user B to send funds to their seed elf. User B can find the UTxO that holds the seed elf and will use that registry and a random integer to generate a new private address for user A.


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

The stealth wallet contract is token agnostic, allowing any NFT  to be the locator token. We suggested using a seed elf.

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

This registry would become unspendable.

### De-Anonymizing Attacks

Two attacks are known to break the privacy of this implementation. The first attack comes from picking a bad d value. A small d value may be able to be brute-forced. The brute-force attack is circumvented by selecting a d value on the order of $2^{256}$. The second attack comes from not properly destroying the d value information after the transaction. The d value is considered toxic waste in this context. If the d values are known for some users then it becomes trivial to invert the registry into the original form and lose all privacy.

Privacy is preserved as long as d is large and destroyed after use. This type of wallet can not be staked.

## Happy Path Testing Scripts

These contracts require PlutusV3.

- TODO