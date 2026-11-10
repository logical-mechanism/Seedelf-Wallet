# 1.9.0's release review: the completeness critic

Round one's last agent: what the lanes missed, and its disputes of their grades.

## Coverage

Completeness. I listed every file `git diff --stat web-wallet/1.8.1 8d7c4b0c` shows (55, less #374's seedelf-cli files and #376's version strings in Cargo.toml, aiken.toml, CLAUDE.md and RELEASE.md) and matched each to the lanes that read it. Every changed file had at least one reader. Only three small test hunks went unquoted by any lane: direct-swaps.test.ts:609, sessions.test.ts:245/338 and order-cancel-check.test.ts:58. I read them: they follow the new exclude lists and add V4 to REAL, nothing more.

The main open gap was the attacker lane, which stopped before it ran anything. I closed most of it myself.

**Probes.** A worktree at 8d7c4b0c (now removed; the main tree is clean), target `~/.cache/seedelf-review-1.9.0/target-critic` (seeded from cip30-rust's, left in place). 11 Rust probes in `seedelf-wasm`, all in a Plutus-shaped body: a script data hash, a spend redeemer, the site's collateral. The command was `cargo test -j 4 -p seedelf-wasm --test critic_probe_test -- --nocapture` under MemoryMax=8G, and all 11 passed. Code is in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/critic/critic_probe_test.rs, output in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/critic/critic_probe_run.log.

**Timing.** I timed cip30-rust#5's large transaction in the built WebAssembly (the main tree's wasm/pkg, opt-level z) under Node. The script and requests are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/critic/timing/.

**Code read.** inspect's input, collateral, output and key_releases paths. The worker's resolve(), its kept outputs, how approvals are created and changed, and outputsOf. checkOrder and withinFunding. orders.rs's group() and the path that carries a spent reference's script. Chunk 47's plan. The e2e test.

**Not done.** No e2e or Playwright, no Koios, no Minswap calls. No es/ja rendering, no back-translation, no package build.

## Findings

### critic#1 (nit, #373, confirmed-by-run): The documented datum-left-out limit isn't only the owner's input: a stake-key withdrawal or certificate as the proof gets only the note too, with the stake key alone signing

**Files:** seedelf-platform/seedelf-web-wallet/docs/architecture.md:563, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1832

**Claim.** `key_releases` is set by one of three things: `names_key`, a required signer that's one of the account's keys, or a contract input in a body with no script data hash (cip30.rs:1832-1838).

A Plutus script can take any key-witnessed part of the body as proof of its owner, because it sees withdrawals and certificates as well as signatories. The owner's input is one such proof, and the docs cover it. A withdrawal from the owner's stake address or a certificate by its stake key are others.

Suppose the datum is kept by hash and left out of the witness set the wallet is shown, and added after signing. Then nothing sets `key_releases`: only the note shows, and only the stake key signs.

architecture.md:563 lists just "a contract taking the owner's input as its proof whose datum is kept by hash and left out". The root is the same as that limit, but the list should be wider. Known contracts with key owners check `extra_signatories`, so this is a doc line, not a hole a known dApp opens.

**Evidence.** critic_probe_test.rs p8 and p9: a Plutus-shaped body (script data hash, spend redeemer, site collateral), contract TX_B#0 holding 50 ₳ and a token, datum_hash set and not carried, no required signers, output 49.8 ₳ and the token to a stranger.
- p8 adds the account's stake address withdrawing 0.
- p9 adds StakeDelegation(account stake key, pool 0x55…).
- p10 is the documented owner-input case, for comparison.

Output:
`p8: contract_inputs=1 contract_lovelace=50000000 released_lovelace=49800000 released_tokens=["1"] key_releases=false names_key=false signs=["stake"] net=0 scripts=true`
`p9: … released_lovelace=49800000 … key_releases=false names_key=false signs=["stake"] net=0`
`p10: … key_releases=false names_key=false signs=["0/0"] net=-2000000`

Control p11, the same withdrawal with the datum inline and naming the stake key: `key_releases=true names_key=true signs=["stake"]`.

**Scenario.** An order sits at a Plutus V2 script, its datum kept by hash, and the script accepts a withdrawal from the owner's stake address as proof.

1. A site sends a transaction that spends the order with a 0 ₳ withdrawal from the account's stake address. Conway takes only the whole reward balance, so 0 needs an empty balance. It sets a script data hash and lists no required signer.
2. The window shows a total of 0 ₳, the withdrawal row, "signs with your stake key", Pays: 49.8 ₳ and the token to the site, and the note "It spends 1 contract UTxO holding 50 ₳ and tokens". There is no warning and no switch.
3. The site adds the datum to the witness set and submits.

**Fix.** Widen architecture.md:563's third limit to any proof that isn't a required signer: the owner's input, a withdrawal, a certificate or a vote, with the datum kept by hash and left out.

## Disputes

- **mutants#1:** The grade is medium, but this is a missing test and the behaviour holds. In a Plutus-shaped body (script data hash, spend redeemer, collateral), critic probe p1 gives the payment key as required signer key_releases=true, released 49.8 ₳ and 1 token, signs ["0/0"]. p2 gives the same for the stake key, signs ["stake"]. p3, p4 and p11 (a datum naming the key, inline or carried by hash, no required signer) all give names_key=true and key_releases=true. Cross's probe gave key_releases=true on the 11 real mainnet cancels re-keyed to a session, each with a real script data hash. The severity table puts "a real path with no test" at low.
- **mutants#2:** Also a missing test, graded medium. Critic p6 runs the untested shape: the account's input holds the same token, which comes back to it, while the contract's goes to a stranger. Result: released_tokens=["1"], released_lovelace=50000000. put_in is subtracted per asset (cip30.rs:1120-1124), so the account's own token can't hide the contract's. Low by the table.
- **mutants#3:** Also a missing test, graded medium. By reading, the yes can't carry over. A sign-tx approval is made once with crypto.randomUUID() (dapp.ts:1570) and never rewritten: only a connect approval is, for funding (dapp.ts:1454). ack is `ackFor === currentId` (DappApprovals.tsx:126). The e2e step can't fail, as mutants say: it waits for `done` and opens a new connectorWindow (extension.spec.ts:5865-5873). Low, with the queued case left as a gap.
- **cip30-rust checked_ok: "Q1: the payment key as a required signer over a found contract input sets keyReleases … (cip30_test.rs:2193)", "the stake key as a required signer (cip30_test.rs:2279)" and "an inline datum naming the payment key or the stake key, with no required signer, sets keyReleases and shows contractYours (cip30_test.rs:2339, 2357)":** The cited tests can't show these lines. Tests 2193, 2279 and 2339 build their bodies with script_data_hash None, so the native-script clause alone sets key_releases; mutants e and f survive them. Test 2357 has key_00 as a required signer through releasing() and asserts only names_key. The conclusions still hold, on critic p1, p2, p3 and p11 in Plutus-shaped bodies.
- **mutants checked_ok: "A native-script UTxO unlocked by the account's key, spent in a body that also has a script data hash, gets only the note … This matches the limitation architecture.md:563 documents ('a native script's input in a transaction that also runs Plutus')":** This doesn't match the documented limit. cip30-rust#2 is right that nothing has to run Plutus: one output with a datum hash, plus that datum as a supplemental datum, makes the ledger require a script data hash. So the site decides whether the native clause applies, and the documented "also runs Plutus" understates the case.
- **dapp-ui checked_ok: "Q2: … the e2e's second request and a queued next one start off too":** The e2e's second request is sent only after the first window has closed (extension.spec.ts:5865-5873), so it mounts fresh state and can't show a carried-over yes. No run reached a request queued in the same window. The claim holds by reading only (see mutants#3 above).
- **dapp-ui checked_ok: "Q3: … with the stake key alone, it shows 'couldn't find' instead":** Listed here as fine, but cip30-rust#4 rightly reports it as a low finding: the note "Only your stake key signs here" reads as reassurance, and stake key alone is exactly SundaeSwap V3's and V4's cancel. The case is narrower than #4 makes it, though. An order signed through the same site in the last 20 minutes is found from the kept outputs, which carry its datum: `every` (dapp.ts:1804-1806, 2816-2825), so the warning shows. What falls through is an order the data source hasn't indexed yet that was placed elsewhere, or through another site, since kept rows match by origin. Low stands.
- **i18n#2:** Small inaccuracy: namesKey counts the DRep key only when the site was given governance. keys_of sets drep only with governance (cip30.rs:466-470), and of_hash checks it only then (cip30.rs:484-491). The finding's point stands.

## Gaps left open

- routes#4's free check: an unsigned build-tx of a V4 order for a sender. Every lane's brief allowed only estimate calls. It matters because every 1.9.0 stablecoin swap routes through V4 today. A build in another shape (a fixed staking part, a third module) would be paused only after funding, costing two fees on every V4 swap.
- V4's validators aren't public, so nobody knows what config_token/OrderConfig and the extension field do on the scoop path, or whether Sundae can swap modules without a new order script. The dry run proves only the Cancel path, which is what Stop uses. Whether a fill pays only the destination and takes no more than the cap rests on the SDK and on what was seen on chain.
- Prevalence of cip30-rust#1's false alarm in real position dApps (Indigo CDPs, lending, stake vaults, listing updates): no lane read one from chain. It decides whether #1 stays medium. A CDP adjust with the owner in an inline datum would show contractYours and the whole position as "Leaves a contract, not to you".
- A second sign-tx queued in the same window: holds by reading only. Vitest can't mount DappApprovals, and the e2e's second request is a fresh window. This is the only path where a yes could carry over.
- The new warning, released row and Sign switch at 400×605 in es and ja: never rendered. The es strings are longer, and the switch sits right over Sign (CW-1).
- A blind back-translation of #373's five critical keys: i18n read en first, and no native speaker has read them. The warning and the switch are the bounty fix's whole user-facing part.
- The 4 live Minswap protocol names the wallet doesn't know are still unknown. If routeOf's re-ask ever sends one the validator refuses, that is what turns routes#1's raw 400 and endless retry into a real event.
- The package build was not redone from 8d7c4b0c (cross reasoned its reproducibility from the tree). It matters for the zip hash that releases.md records.

## What holds

- Attacker gap (the attacker lane ran nothing): no new way past the warning beyond cip30-rust#2 (native clause the site can turn off), #4 (unfound input, stake key alone), #6 (up to 10 ₳ as fee), the documented limits, and critic#1. The arithmetic held in every probe.
- p1/p2 (Plutus-shaped bounty shape): the payment key 0/0 as required signer gives key_releases=true, released 49800000 and 1 token, signs ["0/0"]. The stake key gives the same, signs ["stake"].
- p3/p4/p11: a datum naming the account's key, with no required signer in a Plutus body, gives names_key=true and key_releases=true. This holds inline (payment key), carried by hash in the witness set, and inline naming the stake key with a 0 withdrawal.
- p5 control: a Plutus body with no key and no datum gives key_releases=false and contract_inputs=1, so only the note shows.
- p6: the account's own token of the same kind passing through doesn't hide the contract's. released_tokens=["1"], released_lovelace=50000000.
- p7: a collateral return to the account's own base address never counts as reaching it: returned_lovelace=0, released_lovelace=49800000. `returned` sums body.outputs alone (cip30.rs:1353-1381), and the collateral return has its own variable (cip30.rs:1297-1319).
- Reference inputs never count as contract inputs: only body.inputs feed contract_held (cip30.rs:1255-1275). A donation or a deposit is never credited against what's released: only the fee is, capped at 10 ₳ (cip30.rs:1101-1133).
- A sign-tx approval is fixed once made: random id (dapp.ts:1570), and only connect approvals are rewritten (dapp.ts:1454). So a switch held per id can't follow a changed transaction.
- The kept outputs of transactions signed for the same site (every output, for 20 minutes) carry their inline datum and datum hash (dapp.ts:2816-2825), so namesKey and the warning work on an order that site placed minutes before, before Koios lists it.
- cip30-rust#5 holds in the built WebAssembly too (main tree wasm/pkg, opt-level z, Node). On 880 contract inputs keeping one 30 KB datum by hash (62,807 bytes), inspectDappTx takes 837 and 828 ms with the datum carried, against 23 and 7 ms without it. sign_tx runs inspect again, so an approved request costs about 1.7 s on the worker.
- On mainnet only SundaeSwapV4 and SundaeSwapStable are Plutus V3 (orders.json). group() keeps one cancel to one Plutus version (orders.rs:674-684), so a split V4 + MinswapV2 route gets two cancels. A pinned reference spent since is carried from its row (orders.rs:835-836).
- checkOrder takes V4 only under the session's own staking part (type 1, part === stake) or none (type 7). Minswap's fixed-part exception is keyed to SUNDAE_V3's script and stake (sessions.ts:6653, 6674-6678).
- The unquoted test hunks (direct-swaps.test.ts:609, sessions.test.ts:245/338, order-cancel-check.test.ts:58) only follow the new exclude lists and add V4's real order to REAL. Root CLAUDE.md and RELEASE.md change only #376's 0.7.0 version strings.
