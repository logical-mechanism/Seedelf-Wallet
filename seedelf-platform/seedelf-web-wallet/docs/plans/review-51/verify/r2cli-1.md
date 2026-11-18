# r2cli#1: verification

From lane R2cli, graded high by its finder.

## Trace: confirmed, high

The finding holds as described. I traced every cited line in FIXTREE and ran a test of my own that shows it.

**How the stranger gets in.** Since 48a4c977 (r1#1's fix), the CLI reads the contract's UTxOs in Koios's `order=tx_hash.asc,tx_index.asc` (koios.rs:227). Whoever pays chooses their transaction's hash by grinding it. So 20 outputs of one transaction become the user's first 20 owned rows. Each output is under a re-randomization of the user's register, which sits public beside their Seedelf, and each is a pile of tokens holding less ADA than its tokens' outputs need.
- In the run, each pile holds 30 tokens and 1,991,220 lovelace, the CLI's own least for such a contract output.
- Its tokens need 2,629,100 lovelace at an address.
- All 20 cost the stranger about 40 ₳.

**What fails:**
- **`sweep --all`** (sweep.rs:166, r4#2's fix): `rows::sweepable` caps at 20 in Koios's order before `by_worth` sorts. The user's five 100 ₳ rows are marked "Later". `most_that_fit` then drops every pile and fails. It prints "Past what one transaction takes (run sweep --all again): 5" and names no pile.
- **`sweep -l`, `transfer` and `util mint`** draw on `collect_wallet_utxos`'s first 20 (utxos.rs:147-176), which are all piles. `select_script_inputs` comes up short every time.
- **`sweep --utxo <own>`** filters only those 20, so it answers "No Usuable UTxOs Found".

No CLI command moves the 500 ₳. Nothing changes between runs, so it fails on every run until a CLI release. With the same rows and the stranger's hash above the user's, all five commands send.

**Since.** The 20-row window is old. But main read Koios with no order, so piles landed after the rows the user already held. The freeze came only once those rows were spent. The fixes made it immediate, and the payer chooses it.

**Grade: high.** A stranger strands funds with no way out in the CLI. r4#1 was graded high for that, and CLI wallets can't be imported into the web wallet.

**Known check.** owner-calls §7 (2) and (4) overlap, but don't cover this: their recommended fixes leave it open (see known_ref).

**Evidence:**

**Trace in FIXTREE** (`web-wallet/whole-review-fixes`, HEAD f88560c4). `git status` shows only web wallet docs and extension tests modified, so the CLI, core and koios code below is the committed code.

1. **The order.** seedelf-koios/src/koios.rs:227 has `let mut query = format!("order=tx_hash.asc,tx_index.asc&limit={PAGE_SIZE}");`.
   - Pages are joined in that order (:220-259). seedelf-core/src/utxos.rs:15-24 `get_credential_utxos` passes the rows on unchanged.
   - Blame: 48a4c977.
   - main's `credential_utxos` sent only `offset`, with no `order` (`git show main:...koios.rs`).
2. **The stranger's rows are the user's.** utxos.rs:41 `at_wallet_contract` accepts the contract's script payment part under any stake part. `is_owned(sk)` accepts any re-randomization (g^d, u^d) of the user's register.
3. **The window.** utxos.rs:147-176 `collect_wallet_utxos` keeps owned rows without a Seedelf, in input order, with no filter, until `if number_of_utxos >= MAXIMUM_WALLET_UTXOS { break; }` (:166; 20 at constants.rs:94).
   - Callers: transfer.rs:102, sweep.rs:181 (`-l` and `--utxo`), util/mint.rs:68.
   - `--utxo` is `filter_utxos` over those 20 (sweep.rs:195-199, transfer.rs:127-131, mint.rs:94-98). An empty result bails with "No Usuable UTxOs Found".
4. **Selection.** transfer → `transfer_apart`, sweep → `sweep_many`, and mint → `mint_apart` (build.rs:3028) all reach `select_script_inputs` (build.rs:2549).
   - `Histories::default()` takes the blind path: the rows holding the tokens sent, then the rest with ADA-only rows first. It tries k = 0..=20.
   - With only piles, every try is NotEnough: "Not enough ADA in the Seedelf balance for this, its fee and the change".
5. **`sweep --all`** (sweep.rs:159-178; blame 64379c03, fcb22df7):
   - `collect_all_wallet_utxos` (no cap), then `rows::sweepable(owned_utxos, wallet_contract_size, 20, ..)`. At rows.rs:155, `taken.len() == at_most` sends the rest to `Stay::Later` in the given order.
   - Then `most_that_fit(rows::by_worth(rows, &paid)?, ..)`: `by_worth` sorts only the 20 kept.
   - Its short path (rows.rs:270-281) drops the pile that brings least, one per build. With rows empty it returns `Err` (:284-285), and the local `short` list is dropped. `print_stayed` then lists only the user's own 5 as "Later".
   - external/sweep.rs:45-51 runs `by_worth` before `sweepable`, with no cap. That is the safe shape.
6. **No other way out:**
   - `remove` spends only a Seedelf's UTxO.
   - util/migrate.rs is a stub ("implement this when required").
   - fund, create, external sweep and extract spend other addresses or datum-less UTxOs.
   - keys-and-accounts.md:13 and the web wallet's README.md:112 say a CLI wallet can't be imported into the web wallet.

**Run** (my test only, from FIXTREE/seedelf-platform):

```
systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --locked -p seedelf-cli --test r51_r2cli_1 -- --nocapture
```

Exit 101.
- **The mock:** it answers `credential_utxos` as PostgREST does: in the order the request names, and in insertion order when none is named.
- **The rows:** the user's 5 × 100 ₳ (hashes from blake2b) and their Seedelf, then the stranger's one transaction, its hash prefixed `0000`, with 20 outputs. Each output holds 30 one-of tokens under its own policy and 1,991,220 lovelace.
- **Controls:** each command first runs with the stranger's hash prefixed `ffff`, and all five sent.
- **Attacked:** with `0000`, all five sent nothing.

**Fix check** in a copy (`~/.cache/seedelf-review-51/verify-r2cli_1-trace`, its own `CARGO_TARGET_DIR`, removed afterwards):
- The changes: `by_worth` before `sweepable` in `sweep --all`. For `sweep`, `transfer` and `util mint`, a CLI `rows::window`: `collect_all_wallet_utxos`, then `by_worth` with `build::minimum_deposit`, then `truncate(20)`.
- r51_r2cli_1 passed (exit 0). Every attacked command sent, spending the user's rows.
- The CLI's `cli` integration test target: 56 passed and 1 changed. `sweep::sweep_all_goes_when_a_strangers_tokens_total_past_a_u64` pins the first-found inputs [1, 2, 10..=27]. By worth, the sweep takes the user's rows 10..=29 and leaves all three junk rows.

**Known:** **Not known as such.** Two owner calls overlap with it, and neither covers it.

**The overlap:** owner-calls.md §7, "The CLI fixer's notes", items (2) and (4). They are also fix-branches.md "For the owner" #2 and #4, and FINDINGS.md:90.
- **(2)** says 20 *refused* UTxOs (reference scripts, overflow) fill the window of `transfer`, `sweep -l` and `util mint`. Its recommendation, "Refuse first, then take the window", wouldn't close this finding. Short piles pass `eval::refusal` and `fitting`, so they would still fill the window.
- **(4)** says "`sweep --all` takes the first 20 found, not the largest", with the recommendation "keep". It doesn't see that the first 20 can be 20 short piles, so the sweep fails on every run.
- Neither names the tx_hash order that 48a4c977 made the window's order.
- verify/r4-2.md's fix notes said "Better, cap at 20 after those filters, so junk can't take slots in the window." The fix capped before sorting by worth.

**What I searched:**
- backlog.md: the CLI section has only the 21+-token sweep line. The "first 20" hits are the web wallet's dApp keys.
- archive/plans/: 'first 20', 'window', 'grind' and 'tx_hash.asc' gave only web wallet or unrelated hits.
- The review-51 folder (INDEX, FINDINGS, owner-calls, fix-branches, verify/, lanes/): only the items above, and r1#1's verification, which recommended the tx_hash keyset order.
- SECURITY.md: no exclusion applies. A stranger is the cause, and the data source stays honest.
- The root README's Troll Attacks paragraph covers reference scripts only.
- The platform README.md:195 documents the 20 cap and "run it again for the rest", which this breaks.

**Fix notes:**

**The class:** a key the payer chooses decides which of the user's UTxOs a CLI spend may draw on. Today that key is Koios's tx_hash order, through the 20-row cap. Its members:
- `sweep --all`'s cap in `rows::sweepable`.
- `utxos::collect_wallet_utxos`, which serves `transfer`, `sweep -l`, `sweep --utxo` and `util mint`.

These are already safe:
- `external sweep` sorts by worth first, with no cap.
- `balance` reads every row, with no cap.
- The web wallet chooses among every owned row.

Keep r1#1's keyset paging, which needs a fixed order. Just never let that order pick the window.

1. **`sweep --all`** (sweep.rs:166-172): run `rows::by_worth` over every owned row before `rows::sweepable`, as external/sweep.rs:45-51 does, and hand `most_that_fit` that order unchanged.
   - Piles that bring less than their outputs need then sort last. They take a slot only when fewer than 20 better rows exist, and `most_that_fit` drops them as Short.
   - When the build still fails, name the short rows. rows.rs:279 and :285 drop `short` on the Err paths, and `print_stayed` then tells the user that their own rows are "Past what one transaction takes (run sweep --all again)", which is false.
2. **The window of `transfer`, `sweep` and `util mint`** (transfer.rs:102, sweep.rs:181, util/mint.rs:68): take every owned row (`collect_all_wallet_utxos`) and order it by worth, using `build::minimum_deposit` as the need, since change goes back to the contract. Then take 20.
   - Do it in the CLI, not in core's `select_script_inputs`, which the web wallet shares.
   - Fold in owner-call §7 (2): drop what `select_script_inputs` refuses (`eval::refusal`, and rows `fitting` would leave out) before taking 20.
3. **Checked in a copy.** The changes: `by_worth` before `sweepable`, and a CLI `rows::window` (`by_worth`, then `truncate(20)`) in sweep.rs, transfer.rs and util/mint.rs.
   - r51_r2cli_1 passes.
   - Of the CLI's 57 integration tests, only `sweep::sweep_all_goes_when_a_strangers_tokens_total_past_a_u64` changes. It pins the first-found inputs [1, 2, 10..=27]. By worth, the sweep takes the user's own rows 10..=29 and leaves all three junk rows, so its expected inputs change with the fix.

**For the owner:** README.md:195 ("the first 20 the CLI finds") and :152 (`--utxo` picks only among them) change with the fix, as does which UTxOs are spent together. The window part therefore needs the owner, together with §7 (2). The `sweep --all` part keeps its fix's own claim, and needs no call.

It's CLI-only (seedelf-cli; core is untouched), for a CLI patch release.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-cli/tests/r51_r2cli_1.rs`

Result: **On FIXTREE, the test fails because of the bug.** Exit 101, no compiler warnings, finished in 2.85s. Each line in brackets below stands for a command's full output, cut short here.

```
     Running tests/r51_r2cli_1.rs (target/debug/deps/r51_r2cli_1-be6fd872a58e70f9)
running 1 test
each pile: 30 tokens, 1991220 lovelace (its outputs at an address need 2629100); the 20 cost the stranger 39824400 lovelace
[control sweep --all] Not Swept: 5 / Past what one transaction takes (run sweep --all again): 5 / Total Fee: 1786260 / Transaction Successfully Submitted!
[attacked sweep --all] Not Swept: 5 / Past what one transaction takes (run sweep --all again): 5   (the 5 are the user's own rows; no pile is named)
SweepAll: control sent, spending 5 of the user's UTxOs; with the stranger's hash below the user's: sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
SweepTen: control sent, spending 1 of the user's UTxOs; with the stranger's hash below the user's: sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
SweepTenFromOwnUtxo: control sent, spending 1 of the user's UTxOs; with the stranger's hash below the user's: sent nothing: No Usuable UTxOs Found
TransferTen: control sent, spending 1 of the user's UTxOs; with the stranger's hash below the user's: sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
Mint: control sent, spending 1 of the user's UTxOs; with the stranger's hash below the user's: sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
thread 'a_strangers_piles_at_the_lowest_hashes_never_hold_back_the_users_own_ada' panicked at seedelf-cli/tests/r51_r2cli_1.rs:353:5:
with 20 of a stranger's piles at the lowest hashes, the user's 500 ADA must still move:
SweepAll sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
SweepTen sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
SweepTenFromOwnUtxo sent nothing: No Usuable UTxOs Found
TransferTen sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
Mint sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.85s
```

**In a fixed copy, it passes.** The copy was removed afterwards. Exit 0:

```
SweepAll: … with the stranger's hash below the user's: sent, spending 5 of the user's UTxOs
SweepTen / SweepTenFromOwnUtxo / TransferTen / Mint: … sent, spending 1 of the user's UTxOs
test result: ok. 1 passed; 0 failed
```

```
//! Chunk 51, finding r2cli#1: a stranger's piles of tokens, sorted ahead of
//! the user's own UTxOs, take every one of the 20 a CLI spend draws on.
//!
//! The CLI asks Koios for the contract's UTxOs in `order=tx_hash.asc,
//! tx_index.asc` (seedelf-koios `utxo_pages`, since 48a4c977), and a payer
//! chooses its transaction's hash: varying a metadata nonce some 65,536 times
//! gives one starting 0x0000, below every hash the user holds. Each of that
//! transaction's 20 outputs pays the contract under a re-randomization of the
//! user's register, which sits on chain beside their Seedelf, so the user's key
//! owns them all. Each holds 30 one-of tokens of a policy of its own and the
//! least ADA the CLI gives such a contract output (about 1.99 ₳), less than
//! the outputs the CLI splits its tokens into, 20 to an output, need. The 20
//! cost the stranger about 40 ₳.
//!
//! The user holds 500 ₳ of their own in five UTxOs. Every command that pays
//! must still pay from them: `sweep --all` sends them (it sends "the first 20
//! it can spend together … run it again for the rest", the README says), and
//! `sweep -l`, `sweep --utxo`, `transfer` and `util mint` pay from them. Each
//! case runs first as a control, with the stranger's hash above the user's,
//! which must pay, then with it below.
//!
//! The mock answers `credential_utxos` as PostgREST does: in the order the
//! request names, and with none named, in the order the rows were added (the
//! user's first, the stranger's later). Drives the real commands against the
//! CLI's offline mock Koios, reusing `tests/cli/harness.rs` as is.

#[path = "cli/harness.rs"]
mod harness;

use std::cmp::Ordering;

use blstrs::Scalar;
use harness::*;
use pallas_crypto::hash::Hasher;
use seedelf_cli::commands::sweep::{self, SweepArgs};
use seedelf_cli::commands::transfer::{self, TransforArgs};
use seedelf_cli::commands::util::mint::{self, MintArgs};
use seedelf_core::assets::{Asset as CoreAsset, Assets};
use seedelf_core::build::minimum_address_payment;
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_koios::koios::UtxoResponse;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, Respond, ResponseTemplate};

const TEN_ADA: u64 = 10_000_000;

/// `credential_utxos` as PostgREST answers it: in the order the request's
/// `order` names, and with none, in the order the rows were added. One page
/// holds them all, so a later one (after the last row, or at an offset) is
/// empty.
struct AsKoiosOrders(Vec<UtxoResponse>);

impl Respond for AsKoiosOrders {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let query: Vec<(String, String)> = request
            .url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        if query
            .iter()
            .any(|(k, v)| k == "or" || (k == "offset" && v != "0"))
        {
            return ResponseTemplate::new(200).set_body_json(json!([]));
        }
        let mut rows = self.0.clone();
        if let Some((_, order)) = query.iter().find(|(k, _)| k == "order") {
            let keys: Vec<(&str, bool)> = order
                .split(',')
                .map(|key| {
                    let mut parts = key.split('.');
                    let column = parts.next().unwrap_or_default();
                    (column, parts.any(|p| p == "desc"))
                })
                .collect();
            rows.sort_by(|a, b| {
                keys.iter()
                    .fold(Ordering::Equal, |so_far, (column, descending)| {
                        so_far.then_with(|| {
                            let by = match *column {
                                "tx_hash" => a.tx_hash.cmp(&b.tx_hash),
                                "tx_index" => a.tx_index.cmp(&b.tx_index),
                                "block_height" => a.block_height.cmp(&b.block_height),
                                "block_time" => a.block_time.cmp(&b.block_time),
                                other => panic!("this mock can't order by {other}"),
                            };
                            if *descending { by.reverse() } else { by }
                        })
                    })
            });
        }
        ResponseTemplate::new(200).set_body_json(serde_json::to_value(&rows).expect("utxo json"))
    }
}

/// A 32-byte hash, in hex, made from `seed`.
fn hash_of(seed: &str) -> String {
    hex::encode(Hasher::<256>::hash(seed.as_bytes()))
}

fn as_assets(tokens: &[TokenAmount]) -> Assets {
    tokens.iter().fold(Assets::new(), |all, (policy, name, qty)| {
        all.add(CoreAsset::new(policy.clone(), name.clone(), *qty).expect("asset"))
            .expect("assets")
    })
}

/// The contract's UTxOs, in the order they were added, and the user's own
/// outpoints among them.
struct Contract {
    rows: Vec<UtxoResponse>,
    users: Vec<(String, u64)>,
    strangers_hash: String,
}

/// The user's five UTxOs of 100 ₳ and their Seedelf, from earlier blocks; then
/// the stranger's one transaction, its hash starting `strangers_prefix`: 20
/// piles of 30 tokens under re-randomizations of the user's register.
fn the_contract(scalar: Scalar, strangers_prefix: &str) -> Contract {
    let params = recorded_params();
    let mut rows = Vec::new();
    let mut users = Vec::new();
    for i in 0..5u64 {
        let mut row = wallet_utxo(scalar, 0, 100_000_000, &[]);
        row.tx_hash = hash_of(&format!("the user's payment {i}"));
        row.block_height = 3_000_000 + i;
        users.push((row.tx_hash.clone(), row.tx_index));
        rows.push(row);
    }
    // The Seedelf whose register the stranger read; a transfer pays it.
    let mut seedelf = seedelf_utxo(scalar, 0, 1_500_000, SAMPLE_SEEDELF);
    seedelf.tx_hash = hash_of("the user's seedelf");
    seedelf.block_height = 2_900_000;
    rows.push(seedelf);

    let strangers_hash = format!(
        "{strangers_prefix}{}",
        &hash_of("the stranger's transaction")[strangers_prefix.len()..]
    );
    for i in 0..20u8 {
        let tokens = pile(0x10 + i, 30);
        let least =
            wallet_minimum_lovelace_with_assets(&params, as_assets(&tokens)).expect("least");
        // A pile brings less than the outputs its tokens need at an address
        // (rows.rs `worth` < 0): the CLI can't send it on its own ADA.
        let needs = minimum_address_payment(&params, &external_address(), &as_assets(&tokens))
            .expect("address payment");
        assert!(least < needs, "a pile holds {least}, its outputs need {needs}");
        let mut row = wallet_utxo(scalar, 0, least, &tokens);
        row.tx_hash = strangers_hash.clone();
        row.tx_index = u64::from(i);
        row.block_height = 3_100_000;
        rows.push(row);
    }
    Contract {
        rows,
        users,
        strangers_hash,
    }
}

#[derive(Debug, Clone, Copy)]
enum Command {
    SweepAll,
    SweepTen,
    SweepTenFromOwnUtxo,
    TransferTen,
    Mint,
}

/// What a run did: its error, if any, and the transaction it sent.
struct Went {
    error: Option<String>,
    sent: Option<DecodedTx>,
    users_spent: Vec<(String, u64)>,
    users: Vec<(String, u64)>,
}

fn sweep_args(lovelace: Option<u64>, all: bool, utxos: Option<Vec<String>>) -> SweepArgs {
    SweepArgs {
        address: Some(external_address_bech32()),
        lovelace,
        all,
        assets: vec![],
        ada_handle: None,
        utxos,
    }
}

async fn run(command: Command, strangers_prefix: &str) -> Went {
    let mut scenario = Scenario::start().await;
    let contract = the_contract(scenario.scalar, strangers_prefix);
    for user in &contract.users {
        let below = contract.strangers_hash < user.0;
        assert_eq!(
            below,
            strangers_prefix == "0000",
            "the stranger's hash should sort {} the user's",
            if strangers_prefix == "0000" { "below" } else { "above" }
        );
    }
    // The harness's mount records every outpoint for the value checks; the
    // answer itself comes from the ordering mock, ahead of the harness's.
    scenario.mount_credential_utxos(contract.rows.clone()).await;
    Mock::given(method("POST"))
        .and(path("/api/v1/credential_utxos"))
        .respond_with(AsKoiosOrders(contract.rows.clone()))
        .with_priority(1)
        .mount(&scenario.server)
        .await;
    scenario.mount_evaluate_mint(20).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    let result = match command {
        Command::SweepAll => sweep::run(sweep_args(None, true, None), PREPROD, VARIANT).await,
        Command::SweepTen => {
            sweep::run(sweep_args(Some(TEN_ADA), false, None), PREPROD, VARIANT).await
        }
        Command::SweepTenFromOwnUtxo => {
            let (hash, index) = &contract.users[0];
            let own = vec![format!("{hash}#{index}")];
            sweep::run(sweep_args(Some(TEN_ADA), false, Some(own)), PREPROD, VARIANT).await
        }
        Command::TransferTen => {
            transfer::run(
                TransforArgs {
                    seedelfs: vec![SAMPLE_SEEDELF.to_string()],
                    lovelaces: Some(vec![TEN_ADA]),
                    assets: vec![],
                    utxos: None,
                },
                PREPROD,
                VARIANT,
            )
            .await
        }
        Command::Mint => {
            mint::run(
                MintArgs {
                    label: Some("r2cli".to_string()),
                    generator: None,
                    public_value: None,
                    utxos: None,
                },
                PREPROD,
                VARIANT,
            )
            .await
        }
    };

    let sent = if scenario.requests_to("/api/v1/submittx").await > 0 {
        let tx = decode_tx(&scenario.submitted_cbor().await);
        assert_sound_transaction(&tx, &scenario, &protocol_params().await);
        Some(tx)
    } else {
        None
    };
    let users_spent = sent.as_ref().map_or(Vec::new(), |tx| {
        contract
            .users
            .iter()
            .filter(|u| tx.inputs.contains(u))
            .cloned()
            .collect()
    });
    Went {
        error: result.err().map(|e| format!("{e:#}")),
        sent,
        users_spent,
        users: contract.users,
    }
}

/// Why `went` isn't what `command` must do with the user's 500 ₳, if it isn't.
fn wrong(command: Command, went: &Went) -> Option<String> {
    let Some(tx) = &went.sent else {
        return Some(format!(
            "sent nothing: {}",
            went.error.as_deref().unwrap_or("no error")
        ));
    };
    if let Some(error) = &went.error {
        return Some(format!("sent, then failed: {error}"));
    }
    let to_address: Vec<&DecodedOutput> = tx.outputs_to(&external_address());
    match command {
        Command::SweepAll if went.users_spent.len() != went.users.len() => Some(format!(
            "spent {} of the user's 5 UTxOs",
            went.users_spent.len()
        )),
        Command::SweepAll if to_address.len() != tx.outputs.len() => {
            Some("sent some of it elsewhere than the address".to_string())
        }
        Command::SweepTen | Command::SweepTenFromOwnUtxo
            if !to_address.iter().any(|o| o.lovelace == TEN_ADA) =>
        {
            Some("didn't pay the address 10 ADA".to_string())
        }
        Command::SweepTenFromOwnUtxo if tx.inputs != vec![went.users[0].clone()] => {
            Some(format!("spent {:?}, not the UTxO named", tx.inputs))
        }
        _ if went.users_spent.is_empty() => Some("spent none of the user's UTxOs".to_string()),
        _ => None,
    }
}

#[tokio::test]
async fn a_strangers_piles_at_the_lowest_hashes_never_hold_back_the_users_own_ada() {
    let params = recorded_params();
    let pile_ada = wallet_minimum_lovelace_with_assets(&params, as_assets(&pile(0x10, 30)))
        .expect("least");
    let needs = minimum_address_payment(&params, &external_address(), &as_assets(&pile(0x10, 30)))
        .expect("address payment");
    eprintln!(
        "each pile: 30 tokens, {pile_ada} lovelace (its outputs at an address need {needs}); \
         the 20 cost the stranger {} lovelace",
        20 * pile_ada
    );

    let commands = [
        Command::SweepAll,
        Command::SweepTen,
        Command::SweepTenFromOwnUtxo,
        Command::TransferTen,
        Command::Mint,
    ];
    let mut failures = Vec::new();
    for command in commands {
        // The control: the stranger's hash above the user's, so Koios lists
        // the user's UTxOs first.
        let control = run(command, "ffff").await;
        if let Some(why) = wrong(command, &control) {
            panic!("control {command:?}, the user's UTxOs listed first, {why}");
        }
        let attacked = run(command, "0000").await;
        let verdict = wrong(command, &attacked);
        eprintln!(
            "{command:?}: control sent, spending {} of the user's UTxOs; with the stranger's \
             hash below the user's: {}",
            control.users_spent.len(),
            match &verdict {
                None => format!("sent, spending {} of the user's UTxOs", attacked.users_spent.len()),
                Some(why) => why.clone(),
            }
        );
        if let Some(why) = verdict {
            failures.push(format!("{command:?} {why}"));
        }
    }
    assert!(
        failures.is_empty(),
        "with 20 of a stranger's piles at the lowest hashes, the user's 500 ADA must still move:\n{}",
        failures.join("\n")
    );
}
```

## Impact: confirmed, high

The impact holds at high. A stranger can make a CLI user's whole private balance unspendable by every CLI spend, on every run, until the CLI's code changes.

**What the stranger needs, and what it costs.**
- One of the user's registers. It is public beside any Seedelf, and one register covers every Seedelf under the same key.
- 20 contract outputs, each a pile of 21 or more tokens at about the ledger's least (roughly 1.8 to 2.0 ₳). The CLI re-packs tokens 20 to an output, so each pile needs more ADA than it holds, alone or together.
- A payment transaction whose body is ground to a 0x0000 hash prefix. That takes about 65,000 hashes: seconds.
- Total cost: about 37 to 41 ₳. The stranger gains nothing, and the ADA lands in the victim's wallet as junk that can't be spent.
- The stranger controls every input. Koios's `order=tx_hash.asc` (48a4c977) then puts the piles first for every existing CLI user, at once.

**What the user loses.** All of it is stuck, through every CLI command:
- `sweep --all` keeps the 20 piles as its window and parks the user's own rows as Later. It drops the piles one by one as Short, then fails with 'run sweep --all again'. It names no pile.
- `sweep -l`, `transfer` and `util mint` draw on the same first 20 piles and fail as Not enough.
- `--utxo <own row>` filters only inside that window: 'No Usuable UTxOs Found'.
- `fund` still works, so any new money joins the stuck balance.

**Ways out: none in the CLI or the app.**
- `remove` spends only the Seedelf's own UTxO.
- `util extract` takes only datum-less UTxOs.
- `external sweep` sweeps the key address, not the contract.
- `util migrate` does nothing.
- `util expose-key` prints only the scalar. Spending with it needs hand-written Schnorr-proof code.
- The web wallet can't import a CLI wallet (keys-and-accounts.md:13; web-wallet README:112).
- Waiting changes nothing. The funds aren't lost on chain, but they leave only through a fixed CLI or custom code.

**Why high.** That is the review's own line for high. r4#1 was confirmed high because a stranger stranded CLI funds and recovery needed custom code. r4#2's severity tiebreak put r4#2 at medium because transfer and sweep -l still paid, "below high, where r4#1 sits because there funds are stranded". Here every spend fails. No owner rule settles it: the fix removes a failure and adds no refusal.

**Is it known?** Partly. owner-calls.md §7 (the CLI fixer's notes 2 and 4; fix-branches.md 'For the owner' 2 and 4) records:
- (2) the 20-UTxO window of transfer, sweep -l and util mint, picked before the refusals.
- (4) sweep --all taking the first 20 found, with the recommendation "keep".

None of them says:
- that the order is now the payer's choice;
- that short piles, which no filter refuses, take the slots;
- that sweep --all, the escape left for refused junk, is frozen too.

64379c03's message even lists "a pile of tokens … stopped any sweep" as fixed. And (2)'s recommendation, "refuse first, then take the window", would not stop short piles. So this is a defect in the fix tree, not a duplicate.

**The finder's own words.**
- The 41 ₳ cost is about right. Tighter shapes are near 37 ₳.
- The "main: oldest first" part is plausible but unverifiable offline. Koios's default order for credential_utxos isn't in the local koios-artifacts copy.

**For the owner: CLI 0.7.0 is likely exposed too.** It has the same window under Koios's default order. If that order is oldest first, the shipped CLI reaches the same freeze after the user's next spends, because their change sorts after the piles. It is reached at once for a Seedelf funded after the piles land. Its sweep --all carries no short-row handling. The fix tree makes the freeze immediate and removes the escape timing gave.

**Evidence:**

I traced FIXTREE HEAD. `git status` shows no CLI, koios or core file modified, so HEAD equals the working copy for these.

**1. The order.** seedelf-koios/src/koios.rs:227, in utxo_pages: `format!("order=tx_hash.asc,tx_index.asc&limit={PAGE_SIZE}")`. Pages run on by keyset, and credential_utxos returns the rows in that order. main's version (`git show main:…koios.rs`, credential_utxos) sent only an offset, with no order. 48a4c977's message says this came from r1#1: "credential and address reads page by key (tx_hash, tx_index)". A transaction's outputs share its hash, and anyone can grind that hash by changing its body.

**2. Where the window is taken.**
- seedelf-core/src/utxos.rs, collect_wallet_utxos: `if number_of_utxos >= MAXIMUM_WALLET_UTXOS { break; }` runs in Koios's order. MAXIMUM_WALLET_UTXOS is 20 (constants.rs:94).
- Its callers are transfer.rs:101-102, sweep.rs:180-181 and util/mint.rs:67-68.
- `--utxo` goes through `utxos::filter_utxos(owned_utxos, …)`, which filters inside those 20 only: sweep.rs:195-196, transfer.rs `Some(selected)`, mint.rs `Some(selected)`. The README:152 documents this.

**3. `sweep --all`.**
- sweep.rs:159-176 runs `collect_all_wallet_utxos`, then `rows::sweepable(owned_utxos, …, MAXIMUM_WALLET_UTXOS as usize, &mut stayed)`, then `rows::most_that_fit(rows::by_worth(rows, &paid)?, …)`.
- rows.rs:155: `if taken.len() == at_most || … { stayed.push((utxo, Stay::Later)) }`. The only rows sweepable sets aside before the cap are Unpriced (:151), Tokens/overflow (:179) and past MOST_KINDS (:184).
- So the 20 lowest-hash piles are taken, and the user's rows become Later.
- most_that_fit (rows.rs:270-285) removes one negative-worth row per failed build. It never refills from Later, and returns Err once rows is empty. On that path `short` is dropped unprinted.
- By contrast, external/sweep.rs runs `rows::by_worth(all_utxos, …)` before sweepable, with usize::MAX.

**4. Why every pile is short.**
- build.rs token_chunks and change_outputs split tokens `MAXIMUM_TOKENS_PER_UTXO` (20) to an output.
- A contract output of 30 or 40 tokens at its ledger least holds less than the 2 outputs the CLI re-makes, plus its fee share.
- select_script_inputs' blind path sorts only `available`, the window, by (holds_tokens, Reverse(lovelace)) and tries 1..=n. Every choice is NotEnough.

**5. No way out.**
- remove.rs:56-71 uses find_seedelf_utxo and build::remove on the Seedelf UTxO only.
- util/expose_key.rs prints the BLS scalar only.
- util/migrate.rs is a stub ("implement this when required").
- external/sweep.rs sweeps the dApp key address.
- util extract takes datum-less rows only.
- keys-and-accounts.md:13: CLI wallets have "no import path". seedelf-web-wallet/README.md:112: "No import or migration in either direction".

**6. The fix's own claim.** 64379c03 says "A pile of tokens sent with less ADA than its outputs need … stopped any sweep" and "sweep --all takes the first 20 UTxOs it can spend after those checks". README:195 says "run it again for the rest". Neither holds when 20 short piles come first.

**7. Precedent.**
- verify/r4-1.md: confirmed high, because "the user's ADA … can't leave through any tool Seedelf ships. Recovery needs custom code".
- verify/r4-2.md, severity tiebreak: "That keeps it below high, where r4#1 sits because there funds are stranded."

**8. Known check.**
- owner-calls.md:71, §7 (2) and (4), and fix-branches.md:24 and :26: the window and the "first 20 found", with no word on order, short piles or sweep --all freezing.
- seedelf-platform/README.md:152 and :195: the cap and `--utxo`'s window are documented, not a stranger filling it.
- Root README "Troll Attacks" (:185-187): reference scripts only.
- backlog.md "The CLI" (:185-187): only the 21+ tokens default.
- I grepped archive/plans/ for 'first 20|MAXIMUM_WALLET_UTXOS|20 UTxOs|collect_wallet_utxos': only web-wallet Max text and chunk-08's use.
- review-51 INDEX, lanes and verify, for 'first 20|20-UTxO|tx_hash.asc|grind': only r1#1's fix proposal (the order's origin), r4#2's remark that junk reaches the 20 "sooner or later", and owner-calls §7.
- I couldn't check Koios's default credential_utxos order offline. The local koios-artifacts copy (adf93d2, 2022) predates credential_utxos.

**Known:** Partial overlap only, so not known:
- owner-calls.md §7, "The CLI fixer's notes" (2): "The 20-UTxO window of transfer, sweep -l and util mint is picked before the refusals, so 20 refused UTxOs leave nothing to spend". It recommends refusing first, then taking the window.
- owner-calls.md §7 (4): "sweep --all takes the first 20 found, not the largest". It recommends keeping that.
- The same two items in fix-branches.md 'For the owner, from the CLI's fixer' #2 and #4.
- seedelf-platform/README.md Limits (:195) and the `--utxo` line (:152) document the 20 cap and `--utxo`'s window as limits.

None of these records that 48a4c977 made the window's order the payer's choice (tx_hash). None records that short piles, which no filter refuses, fill it. None records that sweep --all, the escape that refused junk leaves, is frozen too. And (2)'s recommended fix would not cover short piles.

**Fix notes:**

This must be fixed before the fix tree ships. Fix the class: no CLI window may take its order from Koios's paging order, or from any key a payer controls.

1. **`sweep --all`** (sweep.rs:166-172): run `rows::by_worth` over every owned row before `rows::sweepable`, as external/sweep.rs does. Piles then sort last and take slots only when fewer than 20 better rows exist. most_that_fit already drops them as Short and sends the rest. This needs no owner call: it makes 64379c03's own claim true. When the build still fails, print the Short rows by outpoint instead of only "run sweep --all again" for rows a re-run will never reach.

2. **`collect_wallet_utxos`** (transfer, sweep -l, util mint): take the 20 after select_script_inputs' own refusals (eval::refusal, fitting), in a worth order: ADA alone by size, then token rows by what they bring. Or hand select_script_inputs every owned row and cap its inputs at 20. This joins owner call §7 (2). Tell the owner that "refuse first" alone doesn't cover short piles, and that (4)'s "keep" no longer holds under a payer-chosen order.

3. **`--utxo`**: filter among every owned row (collect_all_wallet_utxos), not the window, so the user's explicit pick is always a way out. It adds no refusal. README:152 changes with it.

4. **Tests**: piles at the lowest tx_hash and the user's rows after them, for sweep --all, sweep -l, sweep --utxo, transfer and util mint. Use piles of 30 and of 40 tokens, so combining can't rescue them.

5. **Related**: r2a#3 (owner-calls §1, packing by value size rather than 20 tokens an output) would let most piles carry themselves in a sweep to a key address. That narrows this, but doesn't close transfer's case, where a pile at the contract's exact least is short by its fee share. The window fix is needed either way.

6. **For the owner**: CLI 0.7.0, the latest CLI tag and in the bounty's scope, likely reaches the same freeze after the user's next spends, since change sorts after the piles if Koios's default order is oldest first. A CLI patch should carry 1 to 3 whatever the fix tree's timing. One look at Koios's default order for credential_utxos would settle how fast 0.7.0 gets there.
