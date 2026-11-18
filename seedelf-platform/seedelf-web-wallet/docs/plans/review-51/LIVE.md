# Chunk 51 · The live preprod runs

Test wallet A, restored in a fresh profile each run, on a copy of the fix branch's dev build (`npm run build:ext` on `web-wallet/whole-review-fixes`). Each flow submitted a real preprod transaction and waited for it to confirm.

## Run 1: round one's fixes (build from `02f73991`, source unchanged at `417fff13`), 2026-11-18

`node e2e/live/run.mjs all`, 13:02 to 13:06 UTC. Hosts contacted: preprod.koios.rest and www.giveme.my, nothing else.

| Flow | Transaction |
|---|---|
| mint live1-skdw (paid by the public account) | [d385b5e9…614d](https://preprod.cardanoscan.io/transaction/d385b5e94e66f82d35dd25df5e6681217aee82795c8ac79951d640e6e6fb614d) |
| move in 25.5 ₳ | [d2321dbc…48de](https://preprod.cardanoscan.io/transaction/d2321dbccfac35dd65af3d2e5af636d84881cf5581777e869d72d41d6efa48de) |
| mint live2-skdw (paid by the private balance) | [e19bc5fd…d645](https://preprod.cardanoscan.io/transaction/e19bc5fdc11923422e8b89abffc6c8f1335653435d5e43c2de01de619e04d645) |
| send privately 3.3 ₳ to live1-skdw | [bae24242…cdd5](https://preprod.cardanoscan.io/transaction/bae242429316cb6f55b07a69b3276abd430c784f83cd00ef6a8bd638f5b3cdd5) |
| make public 5.5 ₳ | [9f989bd3…55da](https://preprod.cardanoscan.io/transaction/9f989bd3162ad0ce05a8b3227eebe30f9eddcfe9e444504e287f9410d6f855da) |
| remove live2-skdw | [9e7e992c…4f77](https://preprod.cardanoscan.io/transaction/9e7e992c140d3debeb5f2ebc242a6348efc3d68453a8366188d73610780c4f77) |

Each review's figures and the balances after it agree: the move-in left the public account by 25.672409 ₳ (25.5 and a 0.172409 ₳ fee), and the Seedelf removed came back as 1.503814 ₳ (its 1.74986 ₳ less a 0.246046 ₳ fee).

`node e2e/live/run.mjs staking`, 13:07 to 13:10 UTC, on the same build. Hosts contacted: preprod.koios.rest alone.

| Flow | Transaction |
|---|---|
| stake with TPREP (the pool page warned it's oversaturated, 364%) | [471b57e0…e560](https://preprod.cardanoscan.io/transaction/471b57e084250fd58c657a5ee22423367d04e5eb0f6a93bc62e748dae096e560) |
| voting power to Always no confidence | [de2a25e5…c722](https://preprod.cardanoscan.io/transaction/de2a25e5331672dd62c142efb36b3f1ae74a738cb2d23b18b33bab5ac80ec722) |
| voting power to Always abstain | [4efa526b…ba90](https://preprod.cardanoscan.io/transaction/4efa526b629637d2944180257a957e780c24b9e563b6d3535e15ca6c48d9ba90) |
| stake with LOGIC | [9ce57a9f…8ba7](https://preprod.cardanoscan.io/transaction/9ce57a9fc5d1afdb28c1a171c45ff3371329542ce8271d686833a1331a2a8ba7) |

## Run 2: the final build (`0dce8a6b`), 2026-11-18

Round four changed only the CLI, the swap page, a session's record and the proof tooling, none of which these flows reach.

`node e2e/live/run.mjs all`, 18:00 to 18:04 UTC. Hosts contacted: preprod.koios.rest and www.giveme.my, nothing else.

| Flow | Transaction |
|---|---|
| mint live1-f38o (paid by the public account) | [c32aa09a…f9f9](https://preprod.cardanoscan.io/transaction/c32aa09af2f25457737200e4f940b9da378bd00fb811e328ba60af5ab54bf9f9) |
| move in 25.5 ₳ | [fb4a8701…4d9d](https://preprod.cardanoscan.io/transaction/fb4a870125cfc096735d66a55b34e866335126561f0fcf3f3e0ffb8919b74d9d) |
| mint live2-f38o (paid by the private balance) | [90906123…4738](https://preprod.cardanoscan.io/transaction/90906123eee6704f8723b8b1e167c1a0e46cf452df4204921707364fcf724738) |
| send privately 3.3 ₳ to live1-f38o | [9b681652…c0bf](https://preprod.cardanoscan.io/transaction/9b681652a4722bdb92b9a0348a5a4a24e8a3fa9b57107bff82847376826ec0bf) |
| make public 5.5 ₳ | [12455391…35b3](https://preprod.cardanoscan.io/transaction/12455391d97769918d86ac0d4abb50d4281e1fc500d0311c10535037e12635b3) |
| remove live2-f38o | [92116387…bf66](https://preprod.cardanoscan.io/transaction/92116387a73141f5227685df8f054e65bea3f1c1ca9e051532b3cc2f7d26bf66) |

`node e2e/live/run.mjs staking`, 18:04 to 18:06 UTC. Hosts contacted: preprod.koios.rest alone.

| Flow | Transaction |
|---|---|
| stake with TPREP | [60a20c41…5881](https://preprod.cardanoscan.io/transaction/60a20c4198b1c6f6b129d31ae0f0c5dc0ad33058492815bdaf24ad76a5205881) |
| voting power to Always no confidence | [8e04e21d…d9dc](https://preprod.cardanoscan.io/transaction/8e04e21df6a1abc4302a4c5f6899891f839acbeca1d2a5b365d232e579edd9dc) |
| voting power to Always abstain | [d93684af…6630](https://preprod.cardanoscan.io/transaction/d93684afdcdddb991727a746a409e80f612be2b295ca1943d86206ae43306630) |
| stake with LOGIC | [6046bd8e…0fb1](https://preprod.cardanoscan.io/transaction/6046bd8e13d1c5f0869d993d12b654a52383493177b3d197c5f2737a6d8c0fb1) |

**Not run live:** a session's return, a swap and Bring one back, which the fixes also touched. Minswap is mainnet's alone, and test wallet A's held boxes are the owner's to keep. The fakes and the worker tests cover them.
