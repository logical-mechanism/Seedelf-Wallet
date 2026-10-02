//! The transaction view's decoder (`seedelf_wasm::decode`), checked against
//! `cardano-cli debug transaction view` for every transaction in
//! `fixtures/decode-txs.json`, so the expected values aren't this wallet's own
//! output frozen: a tool that shares no code with it says what is in the bytes.
//!
//! `fixtures/record-decode.mjs` records that fixture — real preprod
//! transactions the wallet and others built, and ones cardano-cli builds for
//! what no recording covers (certificates, metadata, a mint and a burn,
//! governance). What the view can't express — a register in a datum, Seedelf
//! Wallet's own contract, CIP-20's note, a field the wallet has no name for —
//! is checked here against the bytes instead.

use std::collections::BTreeSet;

use pallas_codec::minicbor;
use pallas_codec::utils::{Bytes, Nullable, Set};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::{Fragment, TransactionInput, alonzo, conway};
use seedelf_wasm::decode::{DetailMetadatum, TxDetail, decode_tx};
use serde_json::Value;

/// Every transaction recorded, with what cardano-cli made of it.
struct Recorded {
    name: String,
    cbor: String,
    tx_id: String,
    view: Value,
}

fn recorded() -> Vec<Recorded> {
    let doc: Value = serde_json::from_str(include_str!("fixtures/decode-txs.json")).unwrap();
    doc["txs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tx| Recorded {
            name: tx["name"].as_str().unwrap().to_string(),
            cbor: tx["cbor"].as_str().unwrap().to_string(),
            tx_id: tx["txId"].as_str().unwrap().to_string(),
            view: tx["view"].clone(),
        })
        .collect()
}

fn one(name: &str) -> (TxDetail, Value) {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == name)
        .unwrap_or_else(|| panic!("no {name} in the fixture"));
    (decode_tx("preprod", &tx.cbor).unwrap(), tx.view)
}

/// "273922 Lovelace" as the number.
fn lovelace(text: &str) -> u64 {
    text.split_whitespace().next().unwrap().parse().unwrap()
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| a.iter().map(|v| v.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

/// The outpoints our decode found, written as cardano-cli writes them.
fn ours(outpoints: &[seedelf_wasm::decode::Outpoint]) -> Vec<String> {
    outpoints
        .iter()
        .map(|o| format!("{}#{}", o.tx_hash, o.index))
        .collect()
}

/// `{"lovelace": n, "policy <hex>": {"asset <hex> (name)": q}}` as ADA and a
/// sorted list of `(policy, name, quantity)`, which is how a value compares
/// whatever order it was written in.
fn amount(value: &Value) -> (u64, BTreeSet<(String, String, i128)>) {
    let mut ada = 0;
    let mut tokens = BTreeSet::new();
    for (key, held) in value.as_object().unwrap() {
        if key == "lovelace" {
            ada = held.as_u64().unwrap();
            continue;
        }
        let policy = key.strip_prefix("policy ").unwrap().trim().to_string();
        for (asset, quantity) in held.as_object().unwrap() {
            // "asset <hex>", or "asset <hex> (the name as text)".
            let name = asset
                .strip_prefix("asset")
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            tokens.insert((policy.clone(), name, quantity.as_i64().unwrap() as i128));
        }
    }
    (ada, tokens)
}

fn our_assets(assets: &[seedelf_wasm::decode::DetailAsset]) -> BTreeSet<(String, String, i128)> {
    assets
        .iter()
        .map(|a| {
            (
                a.policy_id.clone(),
                a.asset_name.clone(),
                a.quantity.parse().unwrap(),
            )
        })
        .collect()
}

/// Every transaction in the fixture, field by field against cardano-cli's
/// reading of the same bytes. One loop, so another transaction in the fixture
/// is checked the same way without touching this test.
#[test]
fn cardano_cli_reads_every_fixture_the_same_way() {
    for tx in recorded() {
        let detail = decode_tx("preprod", &tx.cbor)
            .unwrap_or_else(|e| panic!("{}: the wallet couldn't read it: {e}", tx.name));
        let view = &tx.view;
        let at = |what: &str| format!("{}: {what}", tx.name);

        // The id, from cardano-cli's own `transaction txid`.
        assert_eq!(detail.tx_hash, tx.tx_id, "{}", at("the id"));
        assert_eq!(detail.size, tx.cbor.len() / 2, "{}", at("the size"));

        assert_eq!(
            ours(&detail.inputs),
            strings(&view["inputs"]),
            "{}",
            at("inputs")
        );
        assert_eq!(
            ours(&detail.reference_inputs),
            strings(&view["reference inputs"]),
            "{}",
            at("reference inputs")
        );
        assert_eq!(
            ours(&detail.collateral),
            strings(&view["collateral inputs"]),
            "{}",
            at("collateral inputs")
        );
        assert_eq!(
            detail.fee.parse::<u64>().unwrap(),
            lovelace(view["fee"].as_str().unwrap()),
            "{}",
            at("the fee")
        );

        // Outputs: in body order, with their addresses, amounts and datums.
        let outputs = view["outputs"].as_array().unwrap();
        assert_eq!(detail.outputs.len(), outputs.len(), "{}", at("outputs"));
        for (i, (ours_out, theirs)) in detail.outputs.iter().zip(outputs).enumerate() {
            let at = |what: &str| format!("{}: output {i}'s {what}", tx.name);
            assert_eq!(ours_out.index, i as u64, "{}", at("index"));
            assert_eq!(
                ours_out.address.bech32,
                theirs["address"].as_str().unwrap(),
                "{}",
                at("address")
            );
            let (ada, tokens) = amount(&theirs["amount"]);
            assert_eq!(
                ours_out.lovelace.parse::<u64>().unwrap(),
                ada,
                "{}",
                at("ADA")
            );
            assert_eq!(our_assets(&ours_out.assets), tokens, "{}", at("tokens"));
            // cardano-cli writes a datum hash as the string, an inline datum as a tree.
            // cardano-cli writes an unresolved datum hash as the string, and a
            // datum it has — written into the output, or in the witness set
            // under that hash — as the tree.
            match &theirs["datum"] {
                Value::String(hash) => {
                    assert_eq!(
                        ours_out.datum_hash.as_deref(),
                        Some(hash.as_str()),
                        "{}",
                        at("datum hash")
                    );
                    assert!(ours_out.inline_datum.is_none(), "{}", at("inline datum"));
                }
                Value::Object(_) => match (&ours_out.inline_datum, &ours_out.datum_hash) {
                    (Some(_), _) => {}
                    // It could only read the tree because the witness set holds
                    // that datum, so our reading must hold it under that hash.
                    (None, Some(hash)) => assert!(
                        detail.datums.iter().any(|d| d.hash == *hash),
                        "{}",
                        at("the datum its hash names")
                    ),
                    (None, None) => panic!("{}", at("a datum")),
                },
                _ => assert!(
                    ours_out.datum_hash.is_none() && ours_out.inline_datum.is_none(),
                    "{}",
                    at("no datum")
                ),
            }
            match &theirs["reference script"] {
                Value::Object(script) => {
                    let cbor = script["referenceScript"]["script"]["cborHex"]
                        .as_str()
                        .unwrap();
                    let carried = ours_out
                        .script_ref
                        .as_ref()
                        .unwrap_or_else(|| panic!("{}", at("reference script")));
                    assert_eq!(
                        carried.size,
                        cbor.len() / 2,
                        "{}",
                        at("reference script size")
                    );
                    assert_eq!(
                        carried.source,
                        "output",
                        "{}",
                        at("reference script source")
                    );
                }
                _ => assert!(
                    ours_out.script_ref.is_none(),
                    "{}",
                    at("no reference script")
                ),
            }
        }

        // The collateral's own fields.
        match &view["return collateral"] {
            Value::Object(back) => {
                let ours_back = detail
                    .collateral_return
                    .as_ref()
                    .expect("a collateral return");
                assert_eq!(
                    ours_back.address.bech32,
                    back["address"].as_str().unwrap(),
                    "{}",
                    at("the collateral return's address")
                );
                assert_eq!(
                    ours_back.lovelace.parse::<u64>().unwrap(),
                    amount(&back["amount"]).0,
                    "{}",
                    at("the collateral return's ADA")
                );
            }
            _ => assert!(
                detail.collateral_return.is_none(),
                "{}",
                at("no collateral return")
            ),
        }
        assert_eq!(
            detail
                .total_collateral
                .as_deref()
                .map(|t| t.parse::<u64>().unwrap()),
            view["total collateral"].as_u64(),
            "{}",
            at("the total collateral")
        );

        // Mint and burn, with their signs.
        let minted: BTreeSet<_> = our_assets(&detail.mint);
        match &view["mint"] {
            Value::Object(_) => assert_eq!(minted, amount(&view["mint"]).1, "{}", at("the mint")),
            _ => assert!(minted.is_empty(), "{}", at("no mint")),
        }

        // Withdrawals, by reward address and amount.
        let withdrawals: Vec<(String, u64)> = detail
            .withdrawals
            .iter()
            .map(|w| (w.address.clone(), w.lovelace.parse().unwrap()))
            .collect();
        let theirs: Vec<(String, u64)> = view["withdrawals"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|w| {
                        (
                            w["address"].as_str().unwrap().to_string(),
                            lovelace(w["amount"].as_str().unwrap()),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(withdrawals, theirs, "{}", at("withdrawals"));

        // The validity range, both ends.
        assert_eq!(
            detail.valid_from,
            view["validity range"]["lower bound"].as_u64(),
            "{}",
            at("the lower validity bound")
        );
        assert_eq!(
            detail.valid_until,
            view["validity range"]["upper bound"].as_u64(),
            "{}",
            at("the upper validity bound")
        );

        assert_eq!(
            detail.required_signers.iter().collect::<BTreeSet<_>>(),
            strings(&view["required signers (payment key hashes needed for scripts)"])
                .iter()
                .collect(),
            "{}",
            at("the required signers")
        );

        // Certificates and governance: how many, in the same order.
        let certificates = view["certificates"].as_array().map_or(0, |a| a.len());
        assert_eq!(
            detail.certificates.len(),
            certificates,
            "{}",
            at("certificates")
        );
        let proposals = view["governance actions"].as_array().map_or(0, |a| a.len());
        assert_eq!(detail.proposals.len(), proposals, "{}", at("proposals"));
        let votes: usize = view["voters"].as_object().map_or(0, |v| {
            v.values()
                .map(|actions| actions.as_object().map_or(0, |a| a.len()))
                .sum()
        });
        assert_eq!(detail.votes.len(), votes, "{}", at("votes"));
        assert_eq!(
            detail
                .donation
                .as_deref()
                .map(|d| d.parse::<u64>().unwrap())
                .unwrap_or(0),
            view["treasuryDonation"].as_u64().unwrap_or(0),
            "{}",
            at("the treasury donation")
        );
        assert_eq!(
            detail
                .treasury_value
                .as_deref()
                .map(|t| t.parse::<u64>().unwrap()),
            view["currentTreasuryValue"].as_u64(),
            "{}",
            at("the current treasury value")
        );

        // The witness set: scripts by hash, datums and redeemers by count.
        let their_scripts: BTreeSet<String> = view["scripts"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|s| s["script hash"].as_str().unwrap().to_string())
                    .collect()
            })
            .unwrap_or_default();
        let our_scripts: BTreeSet<String> = detail
            .scripts
            .iter()
            .filter(|s| s.source == "witnesses")
            .map(|s| s.hash.clone())
            .collect();
        assert_eq!(
            our_scripts,
            their_scripts,
            "{}",
            at("the witness set's scripts")
        );
        assert_eq!(
            detail.datums.len(),
            view["datums"].as_array().map_or(0, |a| a.len()),
            "{}",
            at("datums")
        );
        let their_redeemers = view["redeemers"].as_array().map_or(0, |a| a.len());
        assert_eq!(
            detail.redeemers.len(),
            their_redeemers,
            "{}",
            at("redeemers")
        );
        assert_eq!(
            detail.signatures.len(),
            view["witnesses"].as_array().map_or(0, |a| a.len()),
            "{}",
            at("signatures")
        );

        // Metadata, by label.
        let their_labels: BTreeSet<String> = view["metadata"]
            .as_object()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        let our_labels: BTreeSet<String> =
            detail.metadata.iter().map(|m| m.label.clone()).collect();
        assert_eq!(our_labels, their_labels, "{}", at("the metadata's labels"));

        // Nothing in the bytes went unreported.
        assert!(
            detail.unknown.is_empty(),
            "{}: {:?}",
            at("unknown fields"),
            detail.unknown
        );
    }
}

/// A redeemer's argument is the bytes as written, not a re-encoding: the hex
/// shown is a verbatim slice of the transaction. They come in the bytes' own
/// order, whatever that is, with each one's own index to say which run it is
/// for — the transfer's two are written 1 then 0.
#[test]
fn a_redeemers_argument_is_the_bytes_as_written() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "transfer")
        .unwrap();
    let detail = decode_tx("preprod", &tx.cbor).unwrap();
    assert_eq!(detail.redeemers.len(), 2, "the transfer spends two inputs");
    assert_eq!(
        detail
            .redeemers
            .iter()
            .map(|r| r.index)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([0, 1]),
        "one for each input"
    );
    for redeemer in &detail.redeemers {
        assert_eq!(redeemer.tag, "spend");
        assert!(redeemer.mem > 0 && redeemer.steps > 0, "a measured budget");
        assert!(
            tx.cbor.contains(&redeemer.data),
            "the argument is a slice of the transaction"
        );
    }
}

/// The ex-units cardano-cli reports, redeemer by redeemer.
#[test]
fn the_budgets_match_cardano_clis() {
    let (detail, view) = one("transfer");
    for (ours, theirs) in detail
        .redeemers
        .iter()
        .zip(view["redeemers"].as_array().unwrap())
    {
        let units = &theirs["redeemer"]["execution units"];
        assert_eq!(ours.mem, units["memory"].as_u64().unwrap());
        assert_eq!(ours.steps, units["steps"].as_u64().unwrap());
    }
}

/// A Seedelf output says so, and its datum is read as the register it is —
/// neither of which cardano-cli knows to say.
#[test]
fn a_seedelf_outputs_datum_reads_as_a_register() {
    let (detail, _) = one("transfer");
    let seedelf: Vec<_> = detail
        .outputs
        .iter()
        .filter(|o| o.address.seedelf)
        .collect();
    assert_eq!(
        seedelf.len(),
        2,
        "the payment and the change both go to the contract"
    );
    for out in seedelf {
        assert_eq!(out.address.payment.as_deref(), Some("script"));
        assert_eq!(out.address.kind, "enterprise");
        assert_eq!(out.address.network.as_deref(), Some("testnet"));
        let register = out.register.as_ref().expect("a register datum");
        assert_eq!(register.generator.len(), 96, "a compressed G1 point");
        assert_eq!(register.public_value.len(), 96);
        assert!(
            register.payable,
            "the wallet never pays a register it couldn't spend"
        );
        // The hex is the datum as written, and the register came out of it.
        assert!(
            out.inline_datum
                .as_ref()
                .unwrap()
                .contains(&register.generator)
        );
    }
}

/// The same transaction read on the other network: the contract's address
/// isn't this network's, so nothing claims to be a Seedelf output.
#[test]
fn the_contract_is_only_recognised_on_its_own_network() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "transfer")
        .unwrap();
    let detail = decode_tx("mainnet", &tx.cbor).unwrap();
    assert!(detail.outputs.iter().all(|o| !o.address.seedelf));
    // Everything else reads the same: an address says which network it is for.
    assert!(
        detail
            .outputs
            .iter()
            .all(|o| o.address.network.as_deref() == Some("testnet"))
    );
}

/// CIP-20's note, where there is one written as the standard says.
#[test]
fn the_note_is_read_only_where_cip20_writes_one() {
    let (certificates, _) = one("certificates");
    assert_eq!(
        certificates.note.as_deref(),
        Some(
            [
                "Seedelf Wallet".to_string(),
                "a note anyone can read".to_string()
            ]
            .as_slice()
        )
    );
    // Minswap's swap writes its own data under 674 beside the message: the
    // note is the message alone, and the metadata still shows both.
    let (swap, _) = one("minswap-swap");
    assert_eq!(
        swap.note.as_deref(),
        Some(["Minswap: Aggregator Market Order".to_string()].as_slice())
    );
    let label = swap
        .metadata
        .iter()
        .find(|m| m.label == "674")
        .expect("label 674");
    let DetailMetadatum::Map { entries } = &label.value else {
        panic!("674 is a map");
    };
    let keys: Vec<String> = entries
        .iter()
        .filter_map(|e| match &e.key {
            DetailMetadatum::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        keys,
        ["extraData", "msg"],
        "everything under 674, not only the message"
    );
}

/// Metadata is the tree it is, each kind of metadatum as itself.
#[test]
fn metadata_is_decoded_as_a_tree() {
    let (detail, _) = one("certificates");
    let label = detail
        .metadata
        .iter()
        .find(|m| m.label == "1")
        .expect("label 1");
    let DetailMetadatum::Map { entries } = &label.value else {
        panic!("label 1 is a map");
    };
    let find = |name: &str| {
        entries
            .iter()
            .find(|e| matches!(&e.key, DetailMetadatum::Text { text } if text == name))
            .map(|e| e.value.clone())
            .unwrap_or_else(|| panic!("no {name}"))
    };
    assert!(matches!(find("n"), DetailMetadatum::Int { value } if value == "42"));
    assert!(
        matches!(find("b"), DetailMetadatum::Bytes { hex, text } if hex == "deadbeef" && text.is_none()),
        "bytes that aren't text show as hex alone"
    );
    assert!(matches!(find("list"), DetailMetadatum::List { items } if items.len() == 3));
    assert!(matches!(find("map"), DetailMetadatum::Map { entries } if entries.len() == 1));
}

/// Every certificate kind the wallet's own staking writes, in full.
#[test]
fn certificates_are_read_in_full() {
    let (detail, _) = one("certificates");
    let kinds: Vec<&str> = detail
        .certificates
        .iter()
        .map(|c| match c {
            seedelf_wasm::decode::DetailCert::StakeRegistration { .. } => "stakeRegistration",
            seedelf_wasm::decode::DetailCert::Registration { .. } => "registration",
            seedelf_wasm::decode::DetailCert::StakeDelegation { .. } => "stakeDelegation",
            seedelf_wasm::decode::DetailCert::VoteDelegation { .. } => "voteDelegation",
            other => panic!("unexpected certificate {other:?}"),
        })
        .collect();
    assert_eq!(kinds, ["registration", "stakeDelegation", "voteDelegation"]);
    let json = serde_json::to_value(&detail.certificates).unwrap();
    assert_eq!(json[0]["deposit"], "2000000", "the deposit it pays");
    assert_eq!(
        json[1]["pool"], "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy",
        "the pool, as a pool id"
    );
    assert_eq!(json[2]["drep"], "drep_always_abstain");
    assert_eq!(json[0]["credential"]["kind"], "key");
}

/// A governance proposal and a vote, with what they point at.
#[test]
fn governance_is_read_in_full() {
    let (detail, view) = one("governance");
    let proposal = &detail.proposals[0];
    assert_eq!(proposal.action, "information");
    assert_eq!(proposal.deposit, "100000000000");
    assert_eq!(proposal.anchor.url, "https://example.com/info");
    assert_eq!(proposal.anchor.content_hash, "0".repeat(64));
    assert_eq!(
        proposal.reward_account,
        view["governance actions"][0]["return address"]["credential"]["keyHash"]
            .as_str()
            .map(|hash| {
                // cardano-cli names the credential; we name the address it makes.
                assert!(proposal.reward_account.starts_with("stake_test1"));
                assert!(proposal.reward_account.len() > 50, "{hash}");
                proposal.reward_account.clone()
            })
            .unwrap()
    );
    let vote = &detail.votes[0];
    assert_eq!(vote.voter, "drep");
    assert_eq!(vote.vote, "yes");
    assert_eq!(vote.credential.kind, "key");
    assert_eq!(vote.action.index, 0);
    assert_eq!(vote.action.tx_hash, "3".repeat(64));
}

/// A native script in the witness set: the hash cardano-cli computes, from the
/// bytes as written.
#[test]
fn a_native_scripts_hash_is_the_ledgers() {
    let (detail, view) = one("mint");
    let script = detail
        .scripts
        .iter()
        .find(|s| s.source == "witnesses")
        .expect("the policy");
    assert_eq!(script.kind, "native");
    assert_eq!(
        script.hash,
        view["scripts"][0]["script hash"].as_str().unwrap()
    );
    // The policy it mints under is that script.
    assert!(detail.mint.iter().all(|m| m.policy_id == script.hash));
    let quantities: Vec<&str> = detail.mint.iter().map(|m| m.quantity.as_str()).collect();
    assert!(
        quantities.contains(&"5") && quantities.contains(&"-3"),
        "a mint and a burn"
    );
    let names: Vec<Option<&str>> = detail.mint.iter().map(|m| m.name_text.as_deref()).collect();
    assert!(
        names.contains(&Some("Seedelf")),
        "a name that reads as text says so"
    );
}

/// A token name that isn't text shows as hex alone, with no guess at it.
#[test]
fn a_token_name_that_isnt_text_shows_as_hex() {
    let (detail, _) = one("payment");
    let asset = detail
        .outputs
        .iter()
        .flat_map(|o| &o.assets)
        .find(|a| a.asset_name == "00ff10")
        .expect("the token");
    assert!(asset.name_text.is_none());
}

/// Whether the witness set holds anything, and whether anything has signed it:
/// a transaction can carry its redeemers and no signature yet, as the wallet's
/// own script spends do until Send.
#[test]
fn the_witness_set_says_what_it_holds() {
    let (payment, _) = one("payment");
    assert!(
        !payment.witnessed,
        "cardano-cli builds it with an empty witness set"
    );
    assert!(payment.signatures.is_empty());
    let (transfer, _) = one("transfer");
    assert!(
        transfer.witnessed,
        "the wallet's transfer carries its redeemers"
    );
    assert!(
        transfer.signatures.is_empty(),
        "and nothing signs it until Send"
    );
    assert_eq!(transfer.redeemers.len(), 2);
}

// ---------------------------------------------------------------------------
// Bytes the view has to refuse rather than panic or hang
// ---------------------------------------------------------------------------

/// Every hostile shape: it errors in words, and nothing panics or runs away.
#[test]
fn hostile_bytes_are_refused() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "payment")
        .unwrap()
        .cbor;
    let cases: Vec<(&str, String)> = vec![
        ("nothing at all", String::new()),
        ("not hex", "not hex at all".to_string()),
        (
            "an odd number of hex digits",
            tx[..tx.len() - 1].to_string(),
        ),
        ("cut short", tx[..tx.len() / 2].to_string()),
        ("one byte", "84".to_string()),
        ("not a transaction", "a16474657374f4".to_string()),
        // An array of 20 items where four belong.
        ("the wrong shape", "94".to_string() + &"f6".repeat(20)),
        // A list saying it holds 2^32 items, with none.
        (
            "a count longer than the bytes",
            "84a0009a00000000ffffff".to_string(),
        ),
        ("bytes after the end", format!("{tx}f6")),
        (
            "nested past the limit",
            "9f".repeat(400) + &"ff".repeat(400),
        ),
    ];
    for (what, bytes) in cases {
        let answer = decode_tx("preprod", &bytes);
        assert!(answer.is_err(), "{what} was read as a transaction");
    }
}

/// A transaction far larger than the ledger allows is refused before anything
/// decodes it, so a site can't make the view do that work.
#[test]
fn an_enormous_transaction_is_refused_before_it_is_read() {
    let huge = "00".repeat(200 * 1024);
    let error = decode_tx("preprod", &huge).unwrap_err().to_string();
    assert!(error.contains("far larger than Cardano allows"), "{error}");
}

/// A network the wallet isn't on.
#[test]
fn an_unknown_network_is_refused() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "payment")
        .unwrap()
        .cbor;
    assert!(
        decode_tx("sanchonet", &tx)
            .unwrap_err()
            .to_string()
            .contains("unknown network")
    );
}

// ---------------------------------------------------------------------------
// What the fixtures can't hold: fields no builder here writes
// ---------------------------------------------------------------------------

/// The transaction's four items, as raw slices.
fn items(tx: &[u8]) -> Vec<&[u8]> {
    let mut d = minicbor::Decoder::new(tx);
    assert_eq!(
        d.array().unwrap(),
        Some(4),
        "a transaction is a list of four"
    );
    (0..4)
        .map(|_| {
            let start = d.position();
            d.skip().unwrap();
            &tx[start..d.position()]
        })
        .collect()
}

/// The same transaction with `field` added to its body: a field no version of
/// Cardano has, to stand for one a later version will.
fn with_body_field(tx_hex: &str, field: u64, value: &[u8]) -> String {
    let tx = hex::decode(tx_hex).unwrap();
    let parts = items(&tx);
    let mut d = minicbor::Decoder::new(parts[0]);
    let entries = d.map().unwrap().unwrap();
    let mut body = Vec::new();
    let mut e = minicbor::Encoder::new(&mut body);
    e.map(entries + 1).unwrap();
    for _ in 0..entries {
        let start = d.position();
        d.skip().unwrap();
        d.skip().unwrap();
        e.writer_mut()
            .extend_from_slice(&parts[0][start..d.position()]);
    }
    e.u64(field).unwrap();
    e.writer_mut().extend_from_slice(value);
    let mut out = Vec::new();
    let mut e = minicbor::Encoder::new(&mut out);
    e.array(4).unwrap();
    e.writer_mut().extend_from_slice(&body);
    for part in &parts[1..] {
        e.writer_mut().extend_from_slice(part);
    }
    hex::encode(out)
}

/// A field this wallet has no name for is reported, not dropped.
#[test]
fn an_unknown_field_is_reported_rather_than_dropped() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "payment")
        .unwrap()
        .cbor;
    // Key 6 is Shelley's update proposal, which Conway dropped; 23 is nobody's yet.
    let hacked = with_body_field(&tx, 23, &hex::decode("820102").unwrap());
    let detail = decode_tx("preprod", &hacked).unwrap();
    assert_eq!(detail.unknown.len(), 1);
    assert_eq!(detail.unknown[0].at, "body");
    assert_eq!(detail.unknown[0].field, "23");
    assert_eq!(detail.unknown[0].hex, "820102");
    // Everything else still reads.
    assert_eq!(detail.outputs.len(), 3);
    // And the id changed with the body, as it must.
    assert_ne!(
        detail.tx_hash,
        recorded()
            .into_iter()
            .find(|t| t.name == "payment")
            .unwrap()
            .tx_id
    );
}

/// A transaction marked to fail its scripts says so: the collateral is what
/// would be taken, not the inputs.
#[test]
fn the_validity_flag_is_shown() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "payment")
        .unwrap()
        .cbor;
    assert!(decode_tx("preprod", &tx).unwrap().valid);
    let bytes = hex::decode(&tx).unwrap();
    let parts = items(&bytes);
    let mut out = Vec::new();
    let mut e = minicbor::Encoder::new(&mut out);
    e.array(4).unwrap();
    e.writer_mut().extend_from_slice(parts[0]);
    e.writer_mut().extend_from_slice(parts[1]);
    e.bool(false).unwrap();
    e.writer_mut().extend_from_slice(parts[3]);
    assert!(!decode_tx("preprod", &hex::encode(out)).unwrap().valid);
}

/// A Plutus V2 script in the auxiliary data. Pallas gives a *Conway*
/// transaction *alonzo's* auxiliary data, whose typed form knows only keys 0-2
/// and reads key 2 as Plutus V1, so a V2 or V3 script there would be dropped
/// without a word: it's read from the raw bytes instead.
#[test]
fn a_plutus_v2_script_in_the_metadata_isnt_dropped() {
    let tx = recorded()
        .into_iter()
        .find(|tx| tx.name == "certificates")
        .unwrap()
        .cbor;
    let bytes = hex::decode(&tx).unwrap();
    let parts = items(&bytes);
    // Its auxiliary data is Alonzo's tagged map, #6.259({0: the metadata}).
    // Key 3 is added to it: a list holding one Plutus V2 script.
    let mut d = minicbor::Decoder::new(parts[3]);
    assert_eq!(d.tag().unwrap(), minicbor::data::Tag::new(259));
    let entries = d.map().unwrap().unwrap();
    let mut aux = Vec::new();
    let mut e = minicbor::Encoder::new(&mut aux);
    e.tag(minicbor::data::Tag::new(259)).unwrap();
    e.map(entries + 1).unwrap();
    for _ in 0..entries {
        let start = d.position();
        d.skip().unwrap();
        d.skip().unwrap();
        e.writer_mut()
            .extend_from_slice(&parts[3][start..d.position()]);
    }
    e.u8(3).unwrap();
    e.array(1).unwrap();
    e.bytes(&hex::decode("0102030405").unwrap()).unwrap();

    let mut out = Vec::new();
    let mut e = minicbor::Encoder::new(&mut out);
    e.array(4).unwrap();
    for part in &parts[..3] {
        e.writer_mut().extend_from_slice(part);
    }
    e.writer_mut().extend_from_slice(&aux);

    let detail = decode_tx("preprod", &hex::encode(out)).unwrap();
    let carried = detail
        .scripts
        .iter()
        .find(|s| s.source == "metadata")
        .expect("the script in the metadata");
    assert_eq!(carried.kind, "plutusV2");
    assert_eq!(carried.size, 5);
    // Its hash is the ledger's: the language's tag byte, then the script.
    assert_eq!(
        carried.hash,
        hex::encode(Hasher::<224>::hash_tagged(&hex::decode("0102030405").unwrap(), 2).as_ref())
    );
    // The metadata still reads, and nothing went unreported.
    assert!(detail.metadata.iter().any(|m| m.label == "674"));
    assert!(detail.note.is_some());
    assert!(detail.unknown.is_empty(), "{:?}", detail.unknown);
}

/// A Shelley-era output, written as a list rather than a map: the form says so,
/// and its value and datum hash still read.
#[test]
fn a_legacy_output_is_read_as_one() {
    let policy: Hash<28> = Hash::new(
        hex::decode("84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255")
            .unwrap()
            .try_into()
            .unwrap(),
    );
    let address =
        hex::decode("60a3d6d926176be50d7d03ecaf007932b670592111602201ae9c20d438").unwrap();
    let names =
        pallas_codec::utils::KeyValuePairs::from(vec![(Bytes::from(b"token".to_vec()), 7u64)]);
    let assets = alonzo::Multiasset::from(vec![(policy, names)]);
    let output = conway::PseudoTransactionOutput::Legacy(alonzo::TransactionOutput {
        address: Bytes::from(address),
        amount: alonzo::Value::Multiasset(4_000_000, assets),
        datum_hash: Some(Hash::new([9u8; 32])),
    });
    let body = conway::TransactionBody {
        inputs: Set::from(vec![TransactionInput {
            transaction_id: Hash::new([1u8; 32]),
            index: 0,
        }]),
        outputs: vec![output],
        fee: 170_000,
        ttl: None,
        certificates: None,
        withdrawals: None,
        auxiliary_data_hash: None,
        validity_interval_start: None,
        mint: None,
        script_data_hash: None,
        collateral: None,
        required_signers: None,
        network_id: None,
        collateral_return: None,
        total_collateral: None,
        reference_inputs: None,
        voting_procedures: None,
        proposal_procedures: None,
        treasury_value: None,
        donation: None,
    };
    let tx = conway::Tx {
        transaction_body: body,
        transaction_witness_set: conway::WitnessSet {
            vkeywitness: None,
            native_script: None,
            bootstrap_witness: None,
            plutus_v1_script: None,
            plutus_data: None,
            redeemer: None,
            plutus_v2_script: None,
            plutus_v3_script: None,
        },
        success: true,
        auxiliary_data: Nullable::Null,
    };
    let detail = decode_tx("preprod", &hex::encode(tx.encode_fragment().unwrap())).unwrap();
    let out = &detail.outputs[0];
    assert_eq!(out.form, "legacy");
    assert_eq!(out.lovelace, "4000000");
    assert_eq!(out.assets.len(), 1);
    assert_eq!(out.assets[0].name_text.as_deref(), Some("token"));
    assert_eq!(out.assets[0].quantity, "7");
    assert_eq!(out.datum_hash.as_deref(), Some(&"09".repeat(32)[..]));
    assert_eq!(out.address.kind, "enterprise");
    assert_eq!(out.address.payment.as_deref(), Some("key"));
    assert!(out.address.stake.is_none());
    assert!(!detail.witnessed, "an empty witness set is no witness");
}
