# Chunk 51 · The lanes

Each lane is one finder agent with [COMMON.md](COMMON.md) as its brief. The plan's lanes are kept; the largest are read by two agents each, split by file or by line range (`a` and `b`), so that each agent can read its own paths in full. Line counts leave out tests.

Paths are relative to `seedelf-platform/` unless they start with `seedelf-verification/`, `.github/` or another top-level folder; `ext/` is `seedelf-web-wallet/extension/` and `wasm/` is `seedelf-web-wallet/wasm/`.

## The Rust crates

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| R1 | `seedelf-crypto/src/`, `seedelf-koios/src/` | 2.5k | The prover against `schnorr.ak` (5b82530); the nonce and randomness; wiping secrets; the Lovejoin proofs against Lovejoin's `schnorr.ak`, `sigma_or.ak`, `dhtuple.ak` (29573c5); `cardano.rs`; how Koios's answers are parsed |
| R2a | `seedelf-core/src/build.rs` | 3.9k | Fees and `settle`; the ledger's limits; budgets matched by purpose and index; `measure_locally`; `pay_rest`, `max_inputs`, `carry`; change and minimums; `is_payable`; `apart`; overflow |
| R2b | `seedelf-core/src/{transaction,eval,cbor,note,staking,withdraw_zero,utxos,assets,address,constants,references,data_structures,lib}.rs` | 3.3k | The patches, applied before signing; local evaluation; selection; sums of assets; sorting own addresses from strangers' |
| R3a | `seedelf-core/src/lovejoin/{mod,box_value,value}.rs` | 3.1k | Mixes, withdraws, chains, collateral tails, `mix_giveme`; box values; the reward balance |
| R3b | `seedelf-core/src/lovejoin/{pool,templates,launch}.rs`, `seedelf-core/src/orders.rs`, `orders.json` | 3.4k | Deriving and verifying a pool; a launch; DEX cancels and `check_cancels`; the integrity hash |
| R4 | `seedelf-cli/src/`, `seedelf-cli/static/`, `seedelf-display/src/` | 3.2k | `create`, `fund`, `util extract`, which still build inline; the secret key file; the signing site at `127.0.0.1:44203` |

## The WebAssembly crate

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| W1a | `wasm/src/lib.rs`, lines 3300 to 4700 (payments in parts) and the bindings that call them | 1.4k | `fit_part`, `in_parts`, `chained`, `reserving`, `carry_kept`, `max_in_parts`; what each part pays against what was asked; sums of row values |
| W1b | `wasm/src/lib.rs`, the rest | 5.5k | Every other binding: what each trusts from TypeScript; `plan_return`; `Holdings::spare`, `holding_enough`; signing |
| W2 | `wasm/src/{cip30,decode}.rs` | 4.1k | A site's transaction, decoded: own and foreign inputs, outputs, certificates, proposals, the validity window, required signers. Whatever signTx shows must come from here |
| W3 | `wasm/src/lovejoin.rs` | 3.0k | Chains, collateral tails and withdraws; the funding sums |

## The extension's worker and screens

`bg/` is `ext/src/background/`, `ui/` is `ext/src/ui/`, `shared/` is `ext/src/shared/`.

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| E1a | `bg/lovejoin.ts` lines 1 to 4000, `bg/lovejoin-pools.ts` | 4.7k | Waits and returns; held boxes; retired pools; races over a pool's reward balance |
| E1b | `bg/lovejoin.ts` lines 4000 to the end, `bg/lovejoin-launch.ts`, `bg/lovejoin-rewards.ts` | 4.6k | The same |
| E2a | `bg/sessions.ts` lines 1 to 3450, `bg/{connector,collateral,runs}.ts` | 3.8k | Funding, returns and disconnects; Stop; the one-time account's index |
| E2b | `bg/sessions.ts` lines 3450 to the end, `bg/parts.ts` | 4.1k | The same; a part stopped mid-landing |
| E3a | `bg/{dapp,dapp-window,tx-view}.ts`, `ext/src/content/`, `shared/dapp.ts`, `ext/src/manifest.ts` | 3.7k | The boundary with untrusted sites: each CIP-30 method's arguments, the queue, the bridge, permissions, the CSP |
| E3b | `ui/{dapp,sites}.ts`, `ui/screens/{DappApprovals,SiteSessions,ConnectedSites,Dapps}.tsx` | 3.3k | Each approval, its last look before sending, and the account or network changing underneath it |
| E4a | `bg/{vault,private-store,storage,storage-access,wallet,accounts,account,preferences,wasm}.ts`, `bg/secret-box/`, `shared/{password,preferences,fingerprint}.ts`, `ui/screens/{Create,Restore,Unlock,Settings}.tsx`, `ui/delete-phrase.ts` | 4.6k | Keys at rest and in memory; lock and unlock; Remove wallet, Forgot password, a password change |
| E4b | `shared/rpc.ts`, `bg/{sw,handlers,ui-port}.ts` | 4.5k | The message boundary: what a content script or a page can reach |
| E5 | `bg/{send,transfer,move-in,mint,withdraw,script-spend,destination,coin-control,pending,spent,sent-txs,short,cbor}.ts`, `shared/{recipients,handles,seedelf-name,histories,label}.ts` | 4.3k | Each money flow, from the user's ask to the signed transaction; a payment that may already have gone out; histories kept apart |
| E6 | `bg/{koios,data-layer,chain,balances,activity,feed,incoming,private-index,contract-scan,minted-by,nft-image,prices,contacts}.ts` | 5.8k | Chain reads with any stranger's rows in them; the data layer's fallback to Koios; caching across a network or account switch |
| E7a | `bg/minswap.ts`, `ui/swap.ts`, `ui/screens/Swaps.tsx` | 4.4k | Order building and cancels; quotes against what's built |
| E7b | `bg/{staking,governance}.ts`, `ui/screens/{Staking,Governance,Voting,Delegations,Rewards,Pools}.tsx`, `ui/dreps.ts` | 4.3k | Certificates and deposits; votes |
| E8a | `ui/screens/{Lovejoin,LovejoinLaunch}.tsx`, `ui/components/{LovejoinReturn,BringAllBack}.tsx` | 5.6k | Every figure on a private-side review against what's built; which button still works in each state |
| E8b | `ui/screens/{ClaimAll,Transfer,Withdraw,MoveIn,CreateSeedelf,RemoveSeedelf,Collateral}.tsx` | 2.5k | The same |
| E9a | `ui/screens/{Activity,CardanoSend,Home,Onboarding,Receive,Tokens,Utxos}.tsx`, and the components they show money with | 6.0k | The same for the public side |
| E9b | The other `ui/*.ts(x)`, `shared/open-in.ts`, `ext/src/i18n/`, the other components | 6.5k | `format.ts`'s rounding and parsing; the critical keys (`.warn.`, `.privacy.`); a translated string compared, parsed or stored |

## Build, CI and docs

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| B1 | `.github/workflows/{web-wallet,release,continuous-integration}.yml`, `wasm/build.sh`, `ext/scripts/`, the Vite configs, `ext/package.json` and its lock, `Cargo.toml` and its lock, `rust-toolchain.toml` | ~3k | Whether the zip is the commit; the tag glob; what a store build turns on; loose pins; a script that fetches at build time |
| D1 | The wallet's README, `privacy.md`, `keys-and-accounts.md`, `architecture.md`, `store/privacy-policy.md`, SECURITY.md, the root README's limits | — | Each claim about what the code does, checked against it. A light pass: no refuters |

## The proofs

| ID | Paths | Lines | Look hardest at |
|---|---|---|---|
| V1 | Fresh context: the Aiken source at `5b82530`, stdlib v2.2.0, and the definitions of `Seedelf/Every/{Typed,PolicyTyped}.lean` with their helpers, proofs stripped (`r51/v1/` in the scratchpad) | ~1k | Does `walletAccepts`, `schnorrProve` or `policyAccepts` accept exactly what the source accepts? Chunk 49's step 4 |
| V2 | Fresh context: Lovejoin's v2 source at `29573c5`, stdlib v4.0.0, and `Lovejoin/Every/Readable*.lean`, proofs stripped (`r51/v2/`) | ~2k | The same, for mix_logic, mix_box and one_shot_mint |
| V3 | `seedelf-verification/`: `extract*.sh`, `Seedelf/Scripts/`, `Lovejoin/{,V2/,Template/}Scripts/`, `lakefile.lean`, `lake-manifest.json`, `check.sh`, `tally.py`, `Audit/count.py`, `gen-*.py` | ~4k | Whether the proved bytes are the deployed ones; how `check.sh` reads a verdict; whether each generator writes what it says |
| V4a | `seedelf-verification/Seedelf/*.lean` (specs and controls, not generated instances), `Slice/` | ~10k read | Step limits; vacuous hypotheses; a control for each Valid; what `isUnsuccessful` means at our pin |
| V4b | `seedelf-verification/Lovejoin/*.lean` (classic), `Lovejoin/V2/`, `Lovejoin/AnyTx/` (specs and controls) | ~10k read | The same |
| V5 | `seedelf-verification/{CLAIMS,README}.md`, the `Every/` READMEs, `Audit/README.md` | — | Each claim against its theorem; each cited theorem exists, sits in a family `check.sh` runs by default, and keeps its axiom guard; the trusted base said plainly |

V1 and V2 get their own brief instead of COMMON.md, so that nothing tells them what to expect. The extracts are made by `tools/strip_proofs.py` (in this folder): definitions in full, theorems as statements only.

## Then

- **Cross lenses,** with every lane's output: X1 what's shown is what's signed, X2 a stranger's input end to end, X3 one rule in several copies, X4 across time, T1 tests that pin the guards.
- **A completeness critic** on this file and every output, then a gap round of up to five finders.
- **Verifiers by stakes** (the plan's *Verifying the findings*), code findings first.
