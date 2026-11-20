# The owner's live run on 1.9.2's dev build (26794c40), 2026-11-19

Run by the owner in the fix worktree: `node e2e/live/run.mjs all && node e2e/live/run.mjs staking`. Each transaction is confirmed on preprod (Koios tx_status: 17 to 29 confirmations for `all`, 8 to 12 for `staking`, read just after).

## all (ended 15:56:04 UTC)

Hosts contacted: preprod.koios.rest and www.giveme.my, nothing else.

| Flow | Transaction |
|---|---|
| mint live1-avu0 (paid by the public account) | https://preprod.cardanoscan.io/transaction/329e1f21b9aabd0f3ed4e3ee12ffdf3b02ed2befba1eaf05d480cad01bba829b |
| move in 25.5 ₳ | https://preprod.cardanoscan.io/transaction/7e686fdaab4fedcaaeb2e9f1520c13353e24dc4b642b6dcc953d8c5f643e973f |
| mint live2-avu0 (paid by the private balance) | https://preprod.cardanoscan.io/transaction/f53ef51bd1c13a0e31725102200904a3bc555ca59f1c52aa0082ab658007387e |
| send privately 3.3 ₳ to live1-avu0 | https://preprod.cardanoscan.io/transaction/7b9649f36d6e9c7120a21cbc1321352c0cc9d3cb719523375e48cbca731163c1 |
| make public 5.5 ₳ | https://preprod.cardanoscan.io/transaction/211b15c6e84dfe66ebfbcc1c01217d9b9f563c09ffb4fa9dc38a3a23fe99ba87 |
| remove live2-avu0 | https://preprod.cardanoscan.io/transaction/299217beb2755c8d17cb89b03b9087fc8b08da72be6dc748a51f7a21990e37e7 |

After: Seedelf balance 3,112.372508 ₳, Cardano 5,653.594532 ₳.

## staking (15:56:07 to 15:58:14 UTC)

Hosts contacted: preprod.koios.rest alone.

| Flow | Transaction |
|---|---|
| stake with TPREP | https://preprod.cardanoscan.io/transaction/ec242fbe5f310cd2401c3bbaf9310d5e3a07b10e081d6d2dac65e8ff0dcfd776 |
| voting power to Always no confidence | https://preprod.cardanoscan.io/transaction/3b88c079ee9475fff0c88ea5c9125bb0d9262169aacc726db4b7479521760595 |
| voting power to Always abstain | https://preprod.cardanoscan.io/transaction/6d80b0ccced11aba567d15d47df277880294d744f4ef4e2cfd81091b61bde4b8 |
| stake with LOGIC | https://preprod.cardanoscan.io/transaction/610e4255493cc0ff944e83402934920fa1c68b0626929b02a7ba4caf39279d97 |

After: Seedelf balance 3,112.372508 ₳, Cardano 5,652.90384 ₳.

# The lead's live run on round seven's build (2b609796), 2026-11-19

`node e2e/live/run.mjs all`, then `node e2e/live/run.mjs staking`, in the fix branch's tree, on the dev build its checks left (round seven's code, 1.9.2's version). All ten confirmed on preprod (Koios tx_status, read just after: 1 to 12 confirmations).

## all (ended 18:58:25 UTC)

Hosts contacted: preprod.koios.rest and www.giveme.my, nothing else.

| Flow | Transaction |
|---|---|
| mint live1-ubbx (paid by the public account) | https://preprod.cardanoscan.io/transaction/7e36077b0ddbb98a4e24346c87834cab93467e2ba3f4ede862a8914c53f5845b |
| move in 25.5 ₳ | https://preprod.cardanoscan.io/transaction/7957d23fa9a3e1501f9a8b4523637e03fcc7f385aeb90005a1310ab46a66b67d |
| mint live2-ubbx (paid by the private balance) | https://preprod.cardanoscan.io/transaction/19c417e711ac5b8dc5a38fb8e210940799c11d24d33b47fe946f99eb732ba574 |
| send privately 3.3 ₳ to live1-ubbx | https://preprod.cardanoscan.io/transaction/e84911699ca25ca183af02e95f0d98a410280e5ac3765a508077423d9fa2bb88 |
| make public 5.5 ₳ | https://preprod.cardanoscan.io/transaction/0a557d2f1d06b1631ce314a5c022a446376e73d5168f7ddd1f4f901269fc5bb0 |
| remove live2-ubbx | https://preprod.cardanoscan.io/transaction/4368b3712ff4573a6a82eec00869d11bb1b4b21a945656f2c0ae0a29f498ea7b |

## staking (ended 18:59:54 UTC)

Hosts contacted: preprod.koios.rest alone.

| Flow | Transaction |
|---|---|
| stake with TPREP | https://preprod.cardanoscan.io/transaction/a888b734baa6b82cca0cd1605c0b65cbec19cf2ddc6cd26d039530e37a9120c1 |
| voting power to Always no confidence | https://preprod.cardanoscan.io/transaction/75406907c167740941f950382ce80ff6fc432109ef6de7c7d222b459e2477694 |
| voting power to Always abstain | https://preprod.cardanoscan.io/transaction/c7ee6e2c70c72035cf99de4de72ff7ac8e846d3ad6c2d83300e1ea77427de194 |
| stake with LOGIC | https://preprod.cardanoscan.io/transaction/c87d1de72b754c266f9f9a1ddc323343366bb4fc95ad0d8dbafbf8142871b97d |

# The lead's live run on round eight's build, main merged in (9fd7b58e), 2026-11-19

`node e2e/live/run.mjs all`, then `node e2e/live/run.mjs staking`, on the dev build round eight's checks left. All ten confirmed on preprod (Koios tx_status: 1 to 20 confirmations).

## all (ended 21:53:27 UTC)

Hosts contacted: preprod.koios.rest and www.giveme.my, nothing else.

| Flow | Transaction |
|---|---|
| mint live1-1qhb (paid by the public account) | https://preprod.cardanoscan.io/transaction/015799977d44c6008638d7aace63b6fb016e08e9e7cd4333660a1900eb752b51 |
| move in 25.5 ₳ | https://preprod.cardanoscan.io/transaction/7e45a94a97dcd888e29bbe1614a1eb3c71e0782bdb5669f56e420baf519321b8 |
| mint live2-1qhb (paid by the private balance) | https://preprod.cardanoscan.io/transaction/e8eea167ecf476f8d54784ce572f25d971afc4a6c3e46ee5b6ccf69823fe3522 |
| send privately 3.3 ₳ to live1-1qhb | https://preprod.cardanoscan.io/transaction/a4fc1413a3df78b36e3b0bd2afab36425840f422bd956a2ed32296f222fcf351 |
| make public 5.5 ₳ | https://preprod.cardanoscan.io/transaction/7ddd6bb2f78c884255da6c3e9fb3546cc393d13a40247020ecf3f042f1235c25 |
| remove live2-1qhb | https://preprod.cardanoscan.io/transaction/b6a42917e309f5a0d5fcf52168dcb1397311eb566e81a81b484bc8d756bcaba3 |

## staking (ended 21:55:09 UTC)

Hosts contacted: preprod.koios.rest alone.

| Flow | Transaction |
|---|---|
| stake with TPREP | https://preprod.cardanoscan.io/transaction/0dc2c643fdedc728bba688aa1d2c1ea9bb47477b6f8c6fe5f1722e00b61f0a05 |
| voting power to Always no confidence | https://preprod.cardanoscan.io/transaction/c3bdd981c71ebaa1aaf1d267bb5b7ee27a5ea197947fb2d96ef4479193f3c758 |
| voting power to Always abstain | https://preprod.cardanoscan.io/transaction/05b953fd598f201b58ab6c9711cd1f750e0aac35a8bf4a8109c92c83ca7d19b1 |
| stake with LOGIC | https://preprod.cardanoscan.io/transaction/dd738abbca74e3938d0c924bf85f9d8d7c830d42f967ad59d6b7e20e7eae070f |

# The lead's live run on the final build, round nine (fd107595), 2026-11-20 UTC

`node e2e/live/run.mjs all`, then `node e2e/live/run.mjs staking`, on the dev build the final checks left. All ten confirmed on preprod (Koios tx_status: 1 to 14 confirmations).

## all (ended 00:03:10 UTC)

Hosts contacted: preprod.koios.rest and www.giveme.my, nothing else.

| Flow | Transaction |
|---|---|
| mint live1-ndea (paid by the public account) | https://preprod.cardanoscan.io/transaction/09e24679f4d51c5946d51c071f83ad1a1314a8a17cbc76494659b90ac57d3b5f |
| move in 25.5 ₳ | https://preprod.cardanoscan.io/transaction/6eafc2eebc78c71669384b9fe2cbebdf99fa2b0263fb3b006faa10ce846a11e0 |
| mint live2-ndea (paid by the private balance) | https://preprod.cardanoscan.io/transaction/1bab698cc80fe25a3a0ef300bf31c2c8cebb149218d4a84a7182863133180b57 |
| send privately 3.3 ₳ to live1-ndea | https://preprod.cardanoscan.io/transaction/2ec3a554be1b15cbb15b07f83fdd05885d8249365caad090d2b4a27a95f9f40f |
| make public 5.5 ₳ | https://preprod.cardanoscan.io/transaction/46b8b51d268a77434ef2f8dd52d8ade459008f96920e4a88dce2f65a9758ae37 |
| remove live2-ndea | https://preprod.cardanoscan.io/transaction/ba16c7033d32049abdf7a81e1ff2d258e7605d59f028350819cb9ace3ffd8ef0 |

## staking (ended 00:05:06 UTC)

Hosts contacted: preprod.koios.rest alone.

| Flow | Transaction |
|---|---|
| stake with TPREP | https://preprod.cardanoscan.io/transaction/d1bf94e9b3d14f4c28a6a71f9249ae0d06b0ef1b99fa8e15ab435e90281b473f |
| voting power to Always no confidence | https://preprod.cardanoscan.io/transaction/e1d0864f0d4cbe98e5a66731d92bc62276414a22e5cd09332e19319cc990fb44 |
| voting power to Always abstain | https://preprod.cardanoscan.io/transaction/54b098e2d664e9c8e9df573c9dc5b850fc57008d4b4df28376e6f67603a3b9f2 |
| stake with LOGIC | https://preprod.cardanoscan.io/transaction/82236432d53383c473b89421b329e321ba625cc3a8eed7ec4796926d9330eb7c |
