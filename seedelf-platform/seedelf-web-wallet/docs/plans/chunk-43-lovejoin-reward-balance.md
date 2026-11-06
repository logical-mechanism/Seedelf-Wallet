# Chunk 43 · Lovejoin's reward balance

Branch `web-wallet/lovejoin-reward-balance`, from `main`.

**Status: 🚧 in progress, for 1.8.1.** Planned 2026-11-04; the owner picked it for 1.8.1 on 2026-11-06. Steps 1, 2, 3 and 5 are built (*Built so far*, below). The edge case's live run is declined (the owner, 2026-11-06, below). A small chunk: the wallet's Lovejoin transactions withdraw whatever sits in `mix_logic`'s reward account, where today they always withdraw 0.

- **Every Mix and every Owner withdrawal the wallet builds withdraws exactly 0 from `mix_logic`'s script reward account** ([withdraw_zero.rs](../../../seedelf-core/src/withdraw_zero.rs)`:96`). `mix_logic` is a withdraw-zero validator: that withdrawal is what runs it, once a transaction.
- **The ledger takes a withdrawal only of the account's whole balance** ([staking.rs](../../../seedelf-core/src/staking.rs)`:16-17`), and refuses anything else as `WithdrawalsNotInRewards`, which [koios.ts](../../extension/src/background/koios.ts)`:701` words today.
- **Anyone can put money there, with no witness of `mix_logic`'s.** Register a stake pool that names its reward address as the pool's reward account, then retire it: POOLREAP refunds the pool's 500 ₳ deposit into the account, which is registered, as withdraw-zero needs. A pool paying its rewards there does it too, and so does a governance action's deposit coming back.
- **From then on every withdraw-zero transaction is refused,** in phase 1, so no collateral is lost, until someone withdraws the balance. Whoever does keeps it.

| Step | Status |
|---|---|
| 1 · Core: the amount, and where it goes | ✅ |
| 2 · WebAssembly: the requests carry it | ✅ |
| 3 · The worker: the read, Send's read, the refusal | ✅ |
| 4 · Tests, and a live run on preprod | ✅ every suite; the edge case's live run declined |
| 5 · The guard: the wallet never pays into `mix_logic`'s account | ✅ |

## What the owner decided (2026-11-04)

- **It isn't a security issue, and nothing is at risk:** "Like we literalyl have it so empty datums just become free money."
- **The wallet's builder handles it,** so that "whoever is the lucky winner gets that 500 going to their Seedelf or something": "making our mix logic in the wallet account for this".
- **Planned now, built later,** as this chunk.

**And on 2026-11-06,** picking it for 1.8.1: "We want this case to be rare and if it happens default to lucky winner such that everything just continues on as normal." Also: "make sure that the wallet at least does not allow a user to set that stake key for anything" (Step 5).

## Built so far

**Steps 1 and 2, 2026-11-06,** on this branch. Core's suite and the WebAssembly crate's pass, with clippy clean. Where the build departs from the plan below:

- **A `Rewards` hands a balance over only once a transaction is built** (`balance` to read it, `taken` once built), so a build that fails takes nothing. A chain that fails part-way keeps what its earlier mixes took, so the public account's chain, which tries again with one more UTxO (`chain_from_account_at`), starts each try from a copy. `Rewards::of` drops a balance of 0.
- **Every builder takes `&mut Rewards` as its last argument:** `mix`, `mix_giveme`, the three withdraws, `chain`, `chain_from`, `chain_across`, `again`, `again_at`, `collateral_tail` and `collateral_mix`. The tests pass `&mut Rewards::none()`, and the two way-back probes (`way_back`, `usable`) do too.
- **`withdraw_paid`: the balance counts toward the register's minimum,** so the account makes up only what the boxes and the balance still fall short of. Its change is as before unless the box can't pay its way back, which is when `withdraw_paid` is used: then the balance covers the top-up.
- **`Mix`, `Withdraw` and `ChainTx` carry `taken`.** The WebAssembly results add no field: `returned` and a withdraw's `lovelace` count the balance, and the worker can read what its own transactions withdraw from the bytes it holds (`txWithdrawals`, as `withdrawingOf` does).
- **The requests' field is `rewards`, `{ <mix_logic hash>: <lovelace, a decimal string> }`** (`RewardsIn`), on `ChainRequest`, `CollateralMixRequest`, `AccountChainRequest`, the three withdraws' and `api::SessionReturnRequest`. A hash that isn't 28 bytes, or an amount a u64 doesn't hold, is refused in words.
- **The export is `lovejoinMixLogic`:** `{ network, poolRef }` in, the classic pool without a `poolRef`, `{ hash, stake }` out. wasm/README.md names it and every request's `rewards`.

**Steps 3 and 5, 2026-11-06.** The extension's Vitest suite passes with the new tests (`lovejoin-reward-balance.test.ts`, and in `koios.test.ts`, `dapp.test.ts`, wasm's `cip30_test.rs`); the 1.5.0 replay's trace now has one `account_info` before each box's way back. Where the build departs from the plan:

- **The read is `LovejoinService.rewardsIn`,** in [lovejoin-rewards.ts](../../extension/src/background/lovejoin-rewards.ts)'s rules. A session's chain keeps its reads on its `ChainCall` (`rewardsOf`), so each pool is read once a build, its stale rebuilds and four's fall to three included; `acrossOf` adds its legs' pools to the same reads.
- **A read account_info doesn't answer is 0,** as before, and marked `unread`: never taken at Send for a balance that moved. A figure that's no whole number, or past all the ADA there is, is 0 too.
- **What counts as on its way:** what the wallet sent and still holds as spent (`heldSent`, `goingOut`'s either), and a chain being sent, its unsent first mix included: its reservation now keeps `takes`, what it withdraws by account, and `holdOnly` keeps a held step's. A chain kept for Send doesn't count: Send's read catches two that took one balance. The rule is account.ts's: on its way and read at least as much, 0; read less, that one landed, and what's read is new.
- **Send's read** is `rewardsMoved`, of the accounts a kept chain's transactions withdraw from (`balances`, readsFor), in `publicStart`, `backSubmit` and `claimSubmit`, a `StaleReviewError` in `lj.rewardsMovedReview`'s words. A runner's return is built and sent at once, and isn't asked.
- **The refusal** is koios.ts's `RewardsChangedError`, staking's words still. A chain it stops says `lj.warn.rewardsMoved` (`pumpPublicNow`, sessions.ts `pump`). `withdrawOne` builds again once, in its submit's catch, with giveme.my asked again; refused again, it's a `KoiosError` in those words, its due time back.
- **No cache of the balance:** each withdraw of Bring every box back reads it, 9 reads for 9 boxes. A cache would need forcing at Send and after a refusal, and the plan priced one read a withdraw.
- **Step 5:** the summary names `paidScripts` (cip30.rs: a pool registration's reward account, a proposal's return, a treasury withdrawal's payee, where each is a script's), and `DappService` refuses one among `LovejoinService.mixLogicHashes` (every pool `readSet` keeps, the classic and retired pools and copies included, asking nobody), in `dapp.lovejoinRewards`'s words, before the user is asked.
- **The words:** `lj.rewardsMovedReview`, `lj.warn.rewardsMoved` (accuracy-critical, back-translated without the English in view, in verified-critical-es/ja.json) and `dapp.lovejoinRewards`, in en, es and ja.
- **Landed with it:** privacy.md's Lovejoin *What Koios learns*, the privacy policy's entry under *Changes* (dated 6 November 2026), architecture.md's *What each costs*, and `seedelf-platform/CLAUDE.md`'s *Things that bite*.

## Why the wallet can take it

- **The contracts accept any amount, so they don't change:** no new pool, variant or Lovejoin version.
  - By reading: `mix_logic`'s withdraw handler names its account `_account` and never reads the withdrawals (Lovejoin's `contracts/validators/mix_logic.ak:46`, at `cb5a5a3`, the classic pool's mainnet commit, and at `8131b1d`, the token-pool templates).
  - `mix_box` asks only that `mix_logic`'s credential withdraws (`mix_box.ak:62`, `pairs.has_key`; its header: "The amount is unconstrained").
  - Step 4 runs the real scripts with an amount that isn't 0.
- **The balance moves only two ways.** It grows at an epoch's start (rewards, a retired pool's deposit, an action's deposit). A transaction that runs `mix_logic`, anyone's Lovejoin mix or withdraw, takes all of it: nothing else can withdraw a script's account. So once one has taken it, it's 0 until the next epoch starts.
- **Every check before the submit runs only the scripts, which ignore the amount:** the wallet's own measure (`seedelf_core::eval`), the network's check of a chain's first mix (Koios's Ogmios, lovejoin.ts `crossCheck`), and giveme.my's, which is "not full phase-1 ledger validation or a balance check" (`check_valid_tx` in its source). Only the submit sees a wrong amount, and it refuses it at no cost.

## Step 1 · Core

- **A `Rewards` beside the protocol:** each pool's balance by its `mix_logic` hash. It hands a pool's balance to the first transaction there that asks for it, and 0 after: the first takes it all. Empty, every builder builds today's transaction, and the existing tests pass with it added.
- **The patch writes it.** `WithdrawZero` (`withdraw_zero.rs:56`) gains the lovelace it withdraws, where `(account, 0)` is at `:96`. The name stays: withdraw-zero is the pattern's, and the amount is 0 nearly always.
- **A mix puts it in its change,** the one output the scripts leave free: its first N are boxes of exactly the box value. In `mix_with` ([lovejoin/mod.rs](../../../seedelf-core/src/lovejoin/mod.rs)`:899`), `WithdrawZero::new` at `:968` and the patch at `:1033` take it. The change is the payer's ADA plus it, less the fee, in two places:
  - the output staged at `:975-981`;
  - `Mix::change` at `:1108-1111`, computed apart, which the next mix and a session's return build on as an unsent input.
  - The proofs bind only the boxes (`ctx`, `:931-939`), so nothing else moves. The amount's few bytes are priced as the fee settles (`:1081-1093`).
  - It's a figure from outside the wallet: added with `checked_add`, and refused in words past a u64 ([`seedelf-platform/CLAUDE.md`](../../../CLAUDE.md)'s rule).
- **An Owner withdrawal puts it in the Seedelf register its boxes come back into,** whoever pays. `withdraw` and `withdraw_private` have no other output, and for `withdraw_paid` it's the private side rather than the account, as the owner's "going to their Seedelf" has it.
  - `into_register` (`:1391-1406`) adds it for all three, and the patch at `:1484` writes it. `withdraw_paid`'s change to the account stays as it is (`:1434-1444`, `:1588-1597`).
  - `CantPayBack` and `PrivateTooSmall` (`:1574-1587`) read `into_register`, so they count it.
  - The Owner proofs bind the outputs (`owner_context`, `:1171`). They're made after it's staged, as now.
- **A chain takes each pool's once, whatever part asks first:**
  - `fan_out` (`:2380`) passes it to each mix (`:2407`), so only its first in a pool takes any;
  - `chain_across`'s legs (`:2149`, `Leg` at `:2137`) are a pool each;
  - `again_at` (`:2225`), `collateral_tail` (`:2259`) and `collateral_mix` (`:2298`, its `mix_giveme` at `:2316`) ask too.
  - One `Rewards` for the whole chain matters: a mix session into the 5 ₳ pool mixes its collateral there too, and that tail's mix must withdraw 0 once the chain's first mix has taken it.
- **Unchanged:** a deposit and a Bootstrap (no script runs), a pool's start, and the way-back probes, `way_back` (`box_value.rs:281`) and `comes_back` (`pool.rs:618`), which build a withdraw to judge a pool. They stay at 0, so a pool's verdict never moves with a windfall.

### Where it ends up

| Transaction | Built for | The balance goes to | Then |
|---|---|---|---|
| `mix` | a session's chain: a return, a mix from the private balance, Mix my boxes again | the change, at the session's one-time account | each mix pays from the one before's change; the session's return sweeps the last into the private balance (`with_return`, wasm `lovejoin.rs:1753`) |
| `mix` | a mix from the public account, and Mix again from it | the change, at the public account | it stays there: a public chain has no return |
| `mix_giveme` | a session's collateral, mixed once: its chain's tail, that mix built again, a direct return's tail | the change, at the session's account | the sweep after it brings it into the private balance (`lovejoin.rs:1801`, `:479`, `:398`) |
| `withdraw` | a box's way back, under giveme.my's collateral | the fresh Seedelf register | the private balance |
| `withdraw_paid` | Bring one back, the public account paying | the register | the private balance; the account's change as before |
| `withdraw_private` | Bring one back, a private UTxO paying | the register | the private balance |

## Step 2 · WebAssembly

- **Each request carries `rewards`,** `{ <mix_logic hash>: <lovelace> }`, `#[serde(default)]`: none is 0 everywhere, today's transactions ([lovejoin.rs](../../wasm/src/lovejoin.rs)).
  - `ChainRequest` (`:1295`), one map for the chain's pool, each leg's (`LegRequest`, `:1030`) and the collateral's 5 ₳ pool;
  - `api::SessionReturnRequest` ([lib.rs](../../wasm/src/lib.rs)`:922`), for a direct return's tail (`direct_tail`, `:1420`);
  - back in lovejoin.rs, `CollateralMixRequest` (`:420`), `AccountChainRequest` (`:2025`), and the three withdraws' (`:2503`, `:2585`, `:2701`).
- **A small export gives a pool's `mix_logic` hash and stake address** from `protocol_of` (`:110`), the classic pool's included, as a launch's result already does (`mix_logic_stake`, `lib.rs:2564`). It's pure, so the worker keeps it per pool.
- **The figures that come back count it:** `ChainResult::returned` (`:1402`), which is what a public chain leaves in the account, and a withdraw's `lovelace`.

## Step 3 · The worker

- **One read, where it builds.** A helper in [lovejoin.ts](../../extension/src/background/lovejoin.ts) asks `accountInfo` for each pool's `mix_logic` stake address and takes `rewards_available` (no row: 0). It's asked before `unstale` (`:4156`), so a stale pool's rebuilds and four-wide's fallback to three reuse it, in:
  - `fanOut` (`:3524`), with the collateral pool's where `collateralAsked` (`:790`) asks for one, and `acrossOf` (`:3639`), each leg's;
  - `tailChain` (`:4031`), `publicBuild` (`:4311`), `publicAgainBuild` (`:4467`), and each branch of `withdrawOne` (`:6883`);
  - and in [sessions.ts](../../extension/src/background/sessions.ts), a direct return (`buildSessionReturn`, `:4560`) whose collateral goes into the 5 ₳ pool.
- **What the wallet's own transactions on their way take counts as taken.** Koios and the data layer report a balance one of them withdraws until its block, and the ledger takes only one. So the next build in that pool leaves it out, as for the account's own rewards (`withdrawingOf`, [incoming.ts](../../extension/src/background/incoming.ts)`:176`, used at [account.ts](../../extension/src/background/account.ts)`:184-193`). The worker holds those bytes: a chain being sent, a withdraw kept as sent.
- **No screen passes it:** the UI's requests stay as they are.

## Step 5 · The guard

The owner, 2026-11-06: "the wallet at least does not allow a user to set that stake key for anything."

- **How money gets there.** `mix_logic`'s publish handler accepts only `RegisterCredential`: at the classic pool's `cb5a5a3` and at v2's `29573c5`, `mix_logic.ak` ("Delegation, redelegation, and governance certs are rejected by the same default"). So its credential can't be delegated, and no staking rewards ever arrive. What does arrive is named by someone's transaction, with no witness of `mix_logic`'s:
  - a stake pool's registration naming the account as its reward account: its deposit back at retirement, and the pool's own rewards;
  - a proposal naming it as its deposit's return address;
  - a treasury withdrawal paying it.
- **The wallet's own transactions name none of these.** Only a site's transaction can, through the dApp signer, public or private.
- **Proposed:** the signer refuses a transaction that names a known pool's `mix_logic` reward account in any of the three, in its own words, as it refuses a session's stake key (`dapp.sessionStakeKey`, [dapp.ts](../../extension/src/background/dapp.ts)).
  - **WebAssembly** ([cip30.rs](../../wasm/src/cip30.rs)): the summary drops a script's reward account today (`Cert::credential`, `Proposal::credential` and `recipients` are key hashes only). It gains the script hashes those three name.
  - **The worker:** the known pools' `mix_logic` hashes, the classic pool's (`lovejoinMixLogic`) and every found pool's (`PoolView.mixLogicHash`, kept under `seedelf.lovejoinPools.<network>`). One among the script hashes is refused, before the user is asked.
  - **A key of its own,** read through a function, in en, es and ja.
- **Not covered:** a pool no device has found yet, and an address whose stake part is `mix_logic`'s. That address puts nothing in the account (its stake can't be delegated), so it's left alone unless the owner wants it refused too.

## Where the balance comes from

- **`account_info`, as the account's own rewards are read.** On mainnet the data layer first, then Koios for a part that's down or with the Koios-only switch on ([data-layer.ts](../../extension/src/background/data-layer.ts)`:297`, the root [CLAUDE.md](../../../../CLAUDE.md)); on preprod, Koios.
  - The data layer takes a script's stake address (`stake_bytes`, [ids.rs](../../../../seedelf-data/api/src/ids.rs)`:36`, header `0xf1`). Its `rewards_available` counts every kind, a refunded pool deposit included, less the withdrawals ([account.rs](../../../../seedelf-data/api/src/public/account.rs)`:143`, `:254`). Nothing changes there.
  - A pool's start already asks it about the same address, at Send ([lovejoin-launch.ts](../../extension/src/background/lovejoin-launch.ts)`:413`).
  - It names the pool, never the wallet's own, so it goes as any public read does, not through `koiosAlone`.
- **A wrong figure costs nothing.** An index behind at an epoch's start, or one that lies, gets the transaction refused before any script runs. So it's never checked against a second source.
- **Request cost: one `account_info` per pool a build mixes in or withdraws from, never per mix.**
  - A chain in one pool: 1. A return across pools: one per pool, and one for its collateral's 5 ₳ pool. A box's withdraw: 1.
  - A chain kept for Send: one more per pool at Send. A withdraw built again after a refusal: one more.
  - On mainnet the data layer's edge charges 4 units for it (`dataCost`: one user's live SQL) and keeps no answer; on Koios's public tier it's one request. Beside a chain's 4k + 2 ([architecture.md](../architecture.md)'s *What each costs*), it's one or two more.

## When the balance moves between build and send

**How a chain goes today.** It's built whole and signed before any of it is sent, so every amount is fixed at the build.
- A reviewed one waits up to 10 minutes for Send (`BUILT_TTL_MS`, lovejoin.ts `:148`, sessions.ts `:228`).
- lovejoin.ts's `pumpChain` (`:437`) sends it in order, at most `CHAIN_WINDOW` (`:294`; `CHAIN_WINDOW_FOUR` for four-box mixes, `:300`) in the mempool at once.
- A refusal that isn't Koios being busy or behind (`chainRetryMs`, `:236`) stops it: `pumpPublicNow`'s catch (`:4825`), sessions.ts's `pump` (`:5019`). Its unfinished boxes lose their due times (lovejoin.ts `chainEnded`, `:5082`) and wait, not mixed yet, for Mix my boxes again. A session's rest comes back directly (`chainSoFar`, sessions.ts `:1264`).
- This refusal reads as staking's today: "Your staking rewards changed since you reviewed this. Review it again."

**Proposed, the simplest that's correct:**

1. **The refusal gets a type.** koios.ts throws a `RewardsChangedError`, a `KoiosError` as `SpentInputError` is (`:625`), where `stakingRefusal` (`:700`) finds it, in staking's words as now.
   - Lovejoin's flows tell it by its type, never its text, and say their own words: a key of its own, read through a function, never a module-level `t()`, and named `.warn.` where a warning shows it (`tests/i18n-worker-reasons.test.ts`).
   - The data layer hands the node's refusal on as it came (`data-layer.ts:393`), so koios.ts is the one place.
2. **Send reads again.** A chain kept for Send reads each of its pools' balances where it starts: lovejoin.ts's `publicStart` (`:4609`, beside its `lj.mixTooOld` check at `:4616`), and a reviewed return's, `backSubmit` (sessions.ts `:3124`) and Bring everything back's `claimSubmit` (`:3188`).
   - One that moved is a stale review (`StaleReviewError`): "Review it again", before anything is sent.
   - A runner's chain is built and sent at once, and skips this.
3. **A withdraw is built again once.** `withdrawOne` takes a refusal as never sent and gives its box's due time back (`:7028-7043`). On this one it reads again and builds once more at once, with giveme.my's witness asked again where it's giveme.my's. Refused again, it goes as now.
4. **A chain refused while it's sent stops,** as any refusal stops it, in its own words, and what it left takes the ways a chain cut short already has. That needs the balance to move in the minutes a chain is sent: an epoch starting, or another wallet's Lovejoin transaction in the seconds after Send's read.

**Not proposed: building the rest of a cut chain again** (call 2).
- A chain is known by its last transaction's hash (`pumpPublicNow`'s `id`, `:4719`; `ChainGone`; sessions.ts's `pendingHere` and a session's `chain.last`; `chainEnded`). So a rest built again is a new chain resuming the old, as a collateral's mix built again is (`tailChain`, `resumes`, `chainSoFar`'s `from`).
- Core would have to build the rest of a fan-out in its own shape: every output of a wave mixed in the next, so the payer never singles out the wallet's box. `again_at` fans out from the wallet's boxes alone.
- That's a chunk of its own, worth it if cut chains turn up.

## Step 4 · Tests

- **Core** ([lovejoin_test.rs](../../../seedelf-core/tests/lovejoin_test.rs), beside `a_mix_of_pool_boxes_passes_mix_logic`, `:228`, and `a_mix_under_givemes_collateral_passes_mix_logic`, `:430`):
  - **a mix with a balance** (say 500 ₳): its body withdraws exactly that from `mix_logic`'s reward account. Its change output and `Mix::change` both hold the payer's ADA plus it, less the fee, and inputs plus the withdrawal equal outputs plus the fee;
  - **the local evaluation passes:** `mix_with` measures the finished transaction against the bundled scripts (`:1096`), and `withdraw_with` each round, so building at all is the scripts passing with an amount that isn't 0;
  - **the same under giveme.my's collateral; each withdraw,** the register holding it and `withdraw_paid`'s change not; **and a chain across two pools,** whose first mix in each withdraws that pool's balance and every later one 0, its last change carrying both;
  - **an empty `Rewards` builds what it builds today;** a balance that passes a u64 with the change is refused in words;
  - **mainnet's bundled scripts the same** ([lovejoin_mainnet_test.rs](../../../seedelf-core/tests/lovejoin_mainnet_test.rs), paying the ledger's minimum fee as `a_mainnet_mix_and_withdraw_pay_the_ledgers_minimum`, `:299`, checks today), and a token pool's ([lovejoin_pools_test.rs](../../../seedelf-core/tests/lovejoin_pools_test.rs));
  - [withdraw_zero_test.rs](../../../seedelf-core/tests/withdraw_zero_test.rs): the patch writes the amount it's given (`a_patch_adds_the_withdrawal_and_its_redeemer`, `:85`).
- **WebAssembly** (`wasm/tests/lovejoin_test.rs`, `lovejoin_across_test.rs`): a request's `rewards` reaches each pool's first mix and no other, the tail's in its own pool included; none is 0; `returned` counts it.
- **The worker:**
  - [koios.test.ts](../../extension/tests/koios.test.ts): `WithdrawalsNotInRewardsCERTS` is a `RewardsChangedError`, still in staking's words (`:364`);
  - a build asks `account_info` once for each pool's `mix_logic` and sends the figures, and one the wallet's own chain on its way takes counts as 0. The fakes answer `account_info` by stake address ([fakes.ts](../../extension/tests/fakes.ts)`:248`), and an address they don't know is 0, so every test today builds as it does;
  - Send after the balance moved is a stale review, with nothing reserved, recorded or sent;
  - a withdraw refused once (`rejectSubmit`, `:233`) is built again with the new figure and sent; refused twice, its due time goes back;
  - a chain refused while it's sent stops in Lovejoin's words, never staking's ([chain-resend.test.ts](../../extension/tests/chain-resend.test.ts), through `pumpChain`).
- **The edge case's live run is declined** (the owner, 2026-11-06: "setting this edge case up is going to be a hassle and will take over a week to prove it"). What it would add is the ledger's own rule, that a withdrawal takes exactly the balance: the scripts' side runs in every core test with the real bytes, and a wrong figure is refused at no cost. What follows is kept as the way to do it, should it ever be wanted.
- **Live on preprod,** with the private test wallet ([development.md](../development.md)'s live runs), before it's called done:
  - register a preprod stake pool whose reward account is a test pool's `mix_logic` account, and retire it at the next epoch: its 500 tADA deposit lands there as that epoch starts;
  - then send a mix chain and a box's withdraw: the first takes the 500 tADA, the rest withdraw 0, and all of it lands;
  - use a pool only the tests use, and time it for when the build is ready: until someone takes it, everyone's mixes and withdraws in that pool are refused;
  - nothing on mainnet: real money isn't a test.

## Privacy

- **No new link.** The withdrawal is the pool's own account, the same for everyone, and the balance lands in an output the transaction has anyway: a mix's change, the payer's own, or the register a box comes back into. That output stands out by its amount, as any amount does: Seedelf doesn't hide amounts ([privacy.md](../privacy.md)'s *What is hidden and what isn't*), and every box still holds exactly the box value.
- **The read names the pool, never the wallet:** the same `account_info` for every wallet that uses the pool, from the IP address that sends the transaction moments later, as the pool read before it already tells the server. It's still a new request, so privacy.md's Lovejoin *What Koios learns* gains it, and the [privacy policy](../store/privacy-policy.md) a dated entry under *Changes*, in the same PR ([the plans README](README.md)).

## Out of scope

- **The contracts,** Seedelf's and Lovejoin's: unchanged, as above.
- **The data layer:** nothing changes there.
- **The CLI:** it builds no Lovejoin transaction.
- **A read per mix:** a chain's first mix in each pool takes it all.

## The owner's calls

1. ❓ **A line on a review that takes a balance.** A return's review and a public mix's show what comes back with it counted, which can be far more than went in.
   - **Recommended:** one short line, only when there is one, naming it as what was left in the pool's reward account for anyone to take. Nothing elsewhere: Activity shows the amount, and Transaction details the withdrawal, as for any.
2. ❓ **Building the rest of a cut chain again** (*Not proposed*, above).
   - **Recommended: not now.** It needs the balance to move in the minutes a chain is sent, the chain then stops as a lock would stop it, and nothing is lost.

## When it lands

- [architecture.md](../architecture.md)'s Lovejoin: `account_info` among its diagram's reads, a chain's first mix in each pool taking the balance, and *What each costs*.
- privacy.md and the privacy policy, as above.
- [`seedelf-platform/CLAUDE.md`](../../../CLAUDE.md)'s *Things that bite*: `withdraw_zero.rs` withdraws the account's balance, 0 nearly always.
- Then this file moves to the archive, as [the plans README](README.md) says.
