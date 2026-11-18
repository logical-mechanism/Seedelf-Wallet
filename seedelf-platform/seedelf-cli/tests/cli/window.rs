//! The UTxOs a spend from the contract draws on, at most 20 (chunk 51,
//! r2cli#1). The CLI reads the contract's UTxOs in Koios's
//! `order=tx_hash.asc,tx_index.asc` (seedelf-koios `utxo_pages`), and a payer
//! chooses its transaction's hash: varying a metadata nonce some 65,536 times
//! gives one starting 0x0000, below every hash the user holds. Each of that
//! transaction's 20 outputs pays the contract under a re-randomization of the
//! user's register, which sits on chain beside their Seedelf, so the user's
//! key owns them all. Each holds 30 (or 40) one-of tokens of a policy of its
//! own and the least ADA the CLI gives such a contract output, less than the
//! outputs the CLI splits its tokens into, 20 to an output, need. The 20 cost
//! the stranger about 40 ₳.
//!
//! When the 20 a spend took were the first 20 in that order, `sweep --all`,
//! `sweep -l`, `sweep --utxo`, `transfer` and `util mint` all failed on every
//! run, and no CLI command moved the user's 500 ₳. Each now takes its 20 by
//! what they bring (`rows::window`, `rows::by_worth`), and `--utxo` picks
//! among every UTxO the user owns.
//!
//! The mock answers `credential_utxos` as PostgREST does: in the order the
//! request names, and with none named, in the order the rows were added.

use std::cmp::Ordering;

use blstrs::Scalar;
use pallas_crypto::hash::Hasher;
use serde_json::json;
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, Respond, ResponseTemplate};

use seedelf_cli::commands::sweep::{self, SweepArgs};
use seedelf_cli::commands::transfer::{self, TransforArgs};
use seedelf_cli::commands::util::mint::{self, MintArgs};
use seedelf_core::assets::{Asset as CoreAsset, Assets};
use seedelf_core::build::{minimum_address_payment, minimum_deposit};
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_koios::koios::UtxoResponse;

use crate::harness::*;

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

/// `seed`'s hash, its first characters made `prefix`: a hash a payer ground.
fn ground(prefix: &str, seed: &str) -> String {
    format!("{prefix}{}", &hash_of(seed)[prefix.len()..])
}

fn as_assets(tokens: &[TokenAmount]) -> Assets {
    tokens
        .iter()
        .fold(Assets::new(), |all, (policy, name, qty)| {
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

/// The user's five UTxOs of 100 ₳ and their Seedelf, from earlier blocks;
/// then the stranger's one transaction, its hash starting `strangers_prefix`:
/// 20 piles of `tokens` tokens under re-randomizations of the user's register.
fn the_contract(scalar: Scalar, strangers_prefix: &str, tokens: usize) -> Contract {
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

    let strangers_hash = ground(strangers_prefix, "the stranger's transaction");
    for i in 0..20u8 {
        let pile = pile(0x10 + i, tokens);
        let least = wallet_minimum_lovelace_with_assets(&params, as_assets(&pile)).expect("least");
        // A pile brings less than the outputs its tokens need, at an address
        // or back in the contract: no spend can send it on its own ADA.
        let at_address = minimum_address_payment(&params, &external_address(), &as_assets(&pile))
            .expect("address payment");
        let deposit = minimum_deposit(&params, &as_assets(&pile)).expect("deposit");
        assert!(
            least < at_address && least < deposit,
            "a pile holds {least}, its outputs need {at_address} at an address, {deposit} back"
        );
        let mut row = wallet_utxo(scalar, 0, least, &pile);
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
    TransferTenFromOwnUtxo,
    Mint,
    MintFromOwnUtxo,
}

impl Command {
    /// Whether the user names one of their own UTxOs with `--utxo`.
    fn names_a_utxo(self) -> bool {
        matches!(
            self,
            Command::SweepTenFromOwnUtxo
                | Command::TransferTenFromOwnUtxo
                | Command::MintFromOwnUtxo
        )
    }
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

/// Serves `rows` as Koios does, in the order a request names, and records
/// them for the value checks.
async fn mount_in_koios_order(scenario: &mut Scenario, rows: Vec<UtxoResponse>) {
    scenario.mount_credential_utxos(rows.clone()).await;
    Mock::given(method("POST"))
        .and(path("/api/v1/credential_utxos"))
        .respond_with(AsKoiosOrders(rows))
        // Ahead of the harness's own answer.
        .with_priority(1)
        .mount(&scenario.server)
        .await;
}

async fn run(command: Command, strangers_prefix: &str, tokens: usize) -> Went {
    let mut scenario = Scenario::start().await;
    let contract = the_contract(scenario.scalar, strangers_prefix, tokens);
    for user in &contract.users {
        assert_eq!(
            contract.strangers_hash < user.0,
            strangers_prefix == "0000",
            "the stranger's hash should sort {} the user's",
            if strangers_prefix == "0000" {
                "below"
            } else {
                "above"
            }
        );
    }
    mount_in_koios_order(&mut scenario, contract.rows.clone()).await;
    scenario.mount_evaluate_mint(20).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    let own = command.names_a_utxo().then(|| {
        let (hash, index) = &contract.users[0];
        vec![format!("{hash}#{index}")]
    });
    let result = match command {
        Command::SweepAll => sweep::run(sweep_args(None, true, None), PREPROD, VARIANT).await,
        Command::SweepTen | Command::SweepTenFromOwnUtxo => {
            sweep::run(sweep_args(Some(TEN_ADA), false, own), PREPROD, VARIANT).await
        }
        Command::TransferTen | Command::TransferTenFromOwnUtxo => {
            transfer::run(
                TransforArgs {
                    seedelfs: vec![SAMPLE_SEEDELF.to_string()],
                    lovelaces: Some(vec![TEN_ADA]),
                    assets: vec![],
                    utxos: own,
                },
                PREPROD,
                VARIANT,
            )
            .await
        }
        Command::Mint | Command::MintFromOwnUtxo => {
            mint::run(
                MintArgs {
                    label: Some("r2cli".to_string()),
                    generator: None,
                    public_value: None,
                    utxos: own,
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
        _ if command.names_a_utxo() && tx.inputs != vec![went.users[0].clone()] => {
            Some(format!("spent {:?}, not the UTxO named", tx.inputs))
        }
        _ if went.users_spent.is_empty() => Some("spent none of the user's UTxOs".to_string()),
        _ => None,
    }
}

/// Every spend still pays from the user's own 500 ₳ with 20 of a stranger's
/// piles, of 30 tokens or of 40, at the lowest hashes: by what they bring,
/// the piles come last. Each case runs first as a control, with the
/// stranger's hash above the user's, which must pay, then with it below.
#[tokio::test]
#[serial]
async fn a_strangers_piles_at_the_lowest_hashes_never_hold_back_the_users_own_ada() {
    let commands = [
        Command::SweepAll,
        Command::SweepTen,
        Command::SweepTenFromOwnUtxo,
        Command::TransferTen,
        Command::TransferTenFromOwnUtxo,
        Command::Mint,
        Command::MintFromOwnUtxo,
    ];
    let mut failures = Vec::new();
    for tokens in [30, 40] {
        for command in commands {
            // The control: the stranger's hash above the user's, so Koios
            // lists the user's UTxOs first.
            let control = run(command, "ffff", tokens).await;
            if let Some(why) = wrong(command, &control) {
                panic!(
                    "control {command:?}, piles of {tokens}, the user's UTxOs listed first, {why}"
                );
            }
            let attacked = run(command, "0000", tokens).await;
            if let Some(why) = wrong(command, &attacked) {
                failures.push(format!("{command:?}, piles of {tokens}: {why}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "with 20 of a stranger's piles at the lowest hashes, the user's 500 ADA must still move:\n{}",
        failures.join("\n")
    );
}

/// One of the user's NFTs.
fn nft(n: u8) -> TokenAmount {
    (
        format!("{:02x}", 0xa0 + n).repeat(28),
        hex::encode("nft"),
        1,
    )
}

/// The UTxOs a spend draws on are those that bring most, whatever each
/// holds (chunk 51, l3cli#1 and l3money#2). A CLI spend leaves the user's ADA
/// beside their tokens: core's change puts the rest of it with the last 20.
/// Every UTxO of ADA alone came first, so 20 small ones, a stranger's at the
/// contract's least for 29 ₳ or the user's own receipts, filled the 20 and
/// shut out 450 ₳: a transfer or a sweep of 100 ₳ was refused, and
/// `sweep --all` sent the small ones and left the 450 ₳.
#[tokio::test]
#[serial]
async fn what_brings_most_is_taken_whatever_it_holds() {
    const HUNDRED_ADA: u64 = 100_000_000;
    // The user's Seedelf, 300 ₳ beside 3 NFTs and 150 ₳ beside 1, then
    // `alone` UTxOs of ADA alone of `each` lovelace.
    let layout = |scalar, alone: u64, each: u64| {
        let mut rows = vec![
            seedelf_utxo(scalar, 1, 1_500_000, SAMPLE_SEEDELF),
            wallet_utxo(scalar, 2, 300_000_000, &[nft(1), nft(2), nft(3)]),
            wallet_utxo(scalar, 3, 150_000_000, &[nft(4)]),
        ];
        rows.extend((0..alone).map(|i| wallet_utxo(scalar, 100 + i, each, &[])));
        rows
    };
    let token_change = [(tx_hash(2), 0), (tx_hash(3), 0)];
    let mut wrong = Vec::new();
    // A stranger's 20 at the contract's least, the user's own 25 receipts,
    // and 19, which always paid.
    for (alone, each) in [(20, 1_460_000), (25, 1_500_000), (19, 1_460_000)] {
        for command in ["transfer", "sweep", "sweep --all"] {
            let mut scenario = Scenario::start().await;
            let rows = layout(scenario.scalar, alone, each);
            scenario.mount_credential_utxos(rows).await;
            scenario.mount_evaluate(20).await;
            scenario.mount_collateral().await;
            scenario.mount_submit().await;
            let result = match command {
                "transfer" => {
                    transfer::run(
                        TransforArgs {
                            seedelfs: vec![SAMPLE_SEEDELF.to_string()],
                            lovelaces: Some(vec![HUNDRED_ADA]),
                            assets: vec![],
                            utxos: None,
                        },
                        PREPROD,
                        VARIANT,
                    )
                    .await
                }
                "sweep" => {
                    sweep::run(sweep_args(Some(HUNDRED_ADA), false, None), PREPROD, VARIANT).await
                }
                _ => sweep::run(sweep_args(None, true, None), PREPROD, VARIANT).await,
            };
            let case = format!("{command}, {alone} x {each} lovelace of ADA alone");
            if let Err(e) = result {
                wrong.push(format!("{case}: {e:#}"));
                continue;
            }
            let tx = decode_tx(&scenario.submitted_cbor().await);
            assert_sound_transaction(&tx, &scenario, &protocol_params().await);
            let spent = token_change
                .iter()
                .filter(|input| tx.inputs.contains(input))
                .count();
            // --all takes both; a payment of 100 ₳, one at least.
            if spent == 0 || (command == "sweep --all" && spent < 2) {
                wrong.push(format!("{case}: spent {:?}", tx.inputs));
            }
        }
    }
    assert!(
        wrong.is_empty(),
        "the 450 ₳ beside the user's NFTs is among the 20 a spend draws on:\n{}",
        wrong.join("\n")
    );
}

/// A token being sent is found wherever its UTxO sorts: those holding it
/// lead the 20 a spend draws on. 25 UTxOs of ADA alone, each bringing more
/// than the token's own, come first by what they bring, and Koios lists the
/// token's last.
#[tokio::test]
#[serial]
async fn a_token_sent_is_found_past_the_first_20() {
    let token: TokenAmount = ("dd".repeat(28), hex::encode("OWN"), 10);
    let sent = format!("{}.{}=5", token.0, token.1);
    for transfer_it in [true, false] {
        let mut scenario = Scenario::start().await;
        let mut rows: Vec<_> = (1..=25)
            .map(|n| wallet_utxo(scenario.scalar, n, 20_000_000, &[]))
            .collect();
        rows.push(wallet_utxo(
            scenario.scalar,
            90,
            2_000_000,
            std::slice::from_ref(&token),
        ));
        rows.push(seedelf_utxo(scenario.scalar, 91, 1_500_000, SAMPLE_SEEDELF));
        mount_in_koios_order(&mut scenario, rows).await;
        scenario.mount_evaluate(20).await;
        scenario.mount_collateral().await;
        scenario.mount_submit().await;

        let result = if transfer_it {
            transfer::run(
                TransforArgs {
                    seedelfs: vec![SAMPLE_SEEDELF.to_string()],
                    lovelaces: Some(vec![TEN_ADA]),
                    assets: vec![sent.clone()],
                    utxos: None,
                },
                PREPROD,
                VARIANT,
            )
            .await
        } else {
            let mut args = sweep_args(Some(TEN_ADA), false, None);
            args.assets = vec![sent.clone()];
            sweep::run(args, PREPROD, VARIANT).await
        };
        let command = if transfer_it { "transfer" } else { "sweep" };
        result.unwrap_or_else(|e| panic!("{command} of the token: {e:#}"));
        let tx = decode_tx(&scenario.submitted_cbor().await);
        assert_sound_transaction(&tx, &scenario, &protocol_params().await);
        assert!(
            tx.inputs.contains(&(tx_hash(90), 0)),
            "{command} spends the token's UTxO: {:?}",
            tx.inputs
        );
        let held_at = |address: &pallas_addresses::Address| -> u64 {
            tx.outputs_to(address)
                .iter()
                .filter_map(|o| o.assets.get(&(token.0.clone(), token.1.clone())))
                .sum()
        };
        if transfer_it {
            // The 5 paid to the Seedelf and the 5 of change, both in the contract.
            assert_eq!(held_at(&wallet_address()), 10, "{command}");
        } else {
            assert_eq!(held_at(&external_address()), 5, "{command} pays the 5");
        }
    }
}

/// A UTxO the spend would never take takes no place among the 20 (the
/// owner's list, §7 (2)): 20 of a stranger's UTxOs holding a reference script,
/// each with more ADA than any of the user's, at the lowest hashes, can't
/// hold back a transfer, a sweep or a mint.
#[tokio::test]
#[serial]
async fn utxos_a_spend_never_takes_hold_no_place_among_the_20() {
    for command in [Command::TransferTen, Command::SweepTen, Command::Mint] {
        let mut scenario = Scenario::start().await;
        let contract = the_contract(scenario.scalar, "ffff", 30);
        // The piles out, the reference scripts in.
        let mut rows: Vec<UtxoResponse> = contract
            .rows
            .into_iter()
            .filter(|u| u.tx_hash != contract.strangers_hash)
            .collect();
        let hash = ground("0000", "the stranger's reference scripts");
        for i in 0..20u64 {
            let mut row =
                with_reference_script(wallet_utxo(scenario.scalar, 0, 150_000_000, &[]), 100);
            row.tx_hash = hash.clone();
            row.tx_index = i;
            rows.push(row);
        }
        mount_in_koios_order(&mut scenario, rows).await;
        scenario.mount_evaluate_mint(20).await;
        scenario.mount_collateral().await;
        scenario.mount_submit().await;

        let result = match command {
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
            Command::SweepTen => {
                sweep::run(sweep_args(Some(TEN_ADA), false, None), PREPROD, VARIANT).await
            }
            _ => {
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
        result.unwrap_or_else(|e| panic!("{command:?}: {e:#}"));
        let tx = decode_tx(&scenario.submitted_cbor().await);
        assert_sound_transaction(&tx, &scenario, &protocol_params().await);
        assert!(
            tx.inputs.iter().all(|(spent, _)| *spent != hash)
                && tx.inputs.iter().any(|input| contract.users.contains(input)),
            "{command:?} pays from the user's own UTxOs: {:?}",
            tx.inputs
        );
    }
}
