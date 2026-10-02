//! The transaction itself, decoded: what is in the bytes that are about to be
//! signed, rather than what they do to this wallet.
//!
//! [`cip30::inspect_tx`](crate::cip30::inspect_tx) answers "what does this do
//! to my account", which is the question the approval decision turns on, and
//! it reduces most of the body to tallies. This answers "what is in these
//! bytes", and emits structure where that one emits counts. The two are kept
//! apart on purpose: nothing here is load-bearing for a signature.
//!
//! [`decode_tx`] takes CBOR and a network name and nothing else — no account,
//! no keys, no UTxOs. So it makes no network call, a fixture file is a whole
//! test of it, and it cannot be wrong about the account because it never sees
//! one. The network is only used to name the Seedelf contract's address.
//!
//! Where Pallas keeps an item's original bytes ([`KeepRaw`]) they are the ones
//! reported, so a datum's hash is the hash of the bytes as written, not of a
//! re-encoding. A field this module doesn't know is reported by its number and
//! its raw hex rather than dropped: a view that silently omits what it doesn't
//! understand reads as "there is nothing else here".

use anyhow::{Result, anyhow, bail};
use pallas_addresses::{Address, ShelleyDelegationPart, ShelleyPaymentPart, StakePayload};
use pallas_codec::minicbor;
use pallas_codec::utils::{KeepRaw, Nullable};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::{Fragment, Metadatum, Relay, StakeCredential, conway};
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::staking::{drep_id, pool_id};
use serde::Serialize;

use crate::cip30::{MAX_TX_BYTES, check_nesting, network_flag, register_datum};

/// A transaction input, as the body names it: nothing says what it holds, and
/// finding out would cost a lookup per input on a transaction only being read.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Outpoint {
    pub tx_hash: String,
    pub index: u64,
}

/// A token and a quantity: the names in hex, the name as text where its bytes
/// are readable text, and the quantity as a decimal string (signed in a mint).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailAsset {
    pub policy_id: String,
    pub asset_name: String,
    /// The name's bytes as text, when they read as printable UTF-8.
    pub name_text: Option<String>,
    pub quantity: String,
}

/// An address as the output's bytes have it, and what kind of address it is.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailAddress {
    /// Bech32, or hex for a Byron address (which has no bech32 form).
    pub bech32: String,
    pub hex: String,
    /// "base", "enterprise", "pointer", "reward" or "byron".
    pub kind: String,
    /// What may spend it: "key" or "script". None for a reward or Byron address.
    pub payment: Option<String>,
    /// What stakes it: "key", "script" or "pointer"; none with no staking part.
    pub stake: Option<String>,
    /// "mainnet" or "testnet", as the address's own bytes say; none for Byron's.
    pub network: Option<String>,
    /// Seedelf Wallet's own contract, on the network asked for.
    pub seedelf: bool,
}

/// A register a Seedelf UTxO's datum holds: the two points, and whether a
/// payment under it could be spent by whoever knows its scalar
/// (`build::is_payable`, which an identity point fails).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailRegister {
    pub generator: String,
    pub public_value: String,
    pub payable: bool,
}

/// A script carried in an output, a witness set or the auxiliary data.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailScript {
    /// "native", "plutusV1", "plutusV2" or "plutusV3".
    pub kind: String,
    pub hash: String,
    /// The script's bytes, as the ledger counts them for its hash.
    pub size: usize,
    /// Where it is: "output" (a reference script), "witnesses" or "metadata".
    pub source: String,
}

/// One output, in body order.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailOutput {
    pub index: u64,
    pub address: DetailAddress,
    pub lovelace: String,
    pub assets: Vec<DetailAsset>,
    /// The datum written into the output, as it was written (hex).
    pub inline_datum: Option<String>,
    /// A datum named by its hash instead; the datum itself may be in the witness set.
    pub datum_hash: Option<String>,
    /// The register the inline datum holds, when it is one.
    pub register: Option<DetailRegister>,
    /// A script the output carries for others to read.
    pub script_ref: Option<DetailScript>,
    /// How the output is written: "legacy" (Shelley's list) or "postAlonzo" (Babbage's map).
    pub form: String,
}

/// A stake, DRep or committee credential.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailCredential {
    /// "key" or "script".
    pub kind: String,
    pub hash: String,
}

/// A link to off-chain text, with the hash that pins it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailAnchor {
    pub url: String,
    pub content_hash: String,
}

/// A governance action by the transaction that made it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailActionId {
    pub tx_hash: String,
    pub index: u32,
}

/// A certificate, each kind with its own fields.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DetailCert {
    /// The old registration, whose deposit the certificate doesn't say.
    StakeRegistration {
        credential: DetailCredential,
    },
    /// The old deregistration, whose refund the certificate doesn't say.
    StakeDeregistration {
        credential: DetailCredential,
    },
    StakeDelegation {
        credential: DetailCredential,
        pool: String,
    },
    PoolRegistration {
        pool: String,
        vrf_key_hash: String,
        pledge: String,
        cost: String,
        margin: String,
        reward_account: String,
        owners: Vec<String>,
        relays: Vec<String>,
        metadata: Option<DetailAnchor>,
    },
    PoolRetirement {
        pool: String,
        epoch: u64,
    },
    /// Conway's registration, with the deposit it pays.
    Registration {
        credential: DetailCredential,
        deposit: String,
    },
    /// Conway's deregistration, with the deposit it gets back.
    Deregistration {
        credential: DetailCredential,
        refund: String,
    },
    VoteDelegation {
        credential: DetailCredential,
        drep: String,
    },
    StakeVoteDelegation {
        credential: DetailCredential,
        pool: String,
        drep: String,
    },
    StakeRegistrationDelegation {
        credential: DetailCredential,
        pool: String,
        deposit: String,
    },
    VoteRegistrationDelegation {
        credential: DetailCredential,
        drep: String,
        deposit: String,
    },
    StakeVoteRegistrationDelegation {
        credential: DetailCredential,
        pool: String,
        drep: String,
        deposit: String,
    },
    CommitteeHotAuth {
        cold: DetailCredential,
        hot: DetailCredential,
    },
    CommitteeColdResign {
        cold: DetailCredential,
        anchor: Option<DetailAnchor>,
    },
    DrepRegistration {
        credential: DetailCredential,
        drep: String,
        deposit: String,
        anchor: Option<DetailAnchor>,
    },
    DrepDeregistration {
        credential: DetailCredential,
        drep: String,
        refund: String,
    },
    DrepUpdate {
        credential: DetailCredential,
        drep: String,
        anchor: Option<DetailAnchor>,
    },
}

/// A withdrawal of staking rewards.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailWithdrawal {
    /// The reward address, bech32.
    pub address: String,
    pub lovelace: String,
}

/// One vote cast on one governance action.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailVote {
    /// Who votes: "committee", "drep" or "pool", and whether by key or script.
    pub voter: String,
    pub credential: DetailCredential,
    pub action: DetailActionId,
    /// "yes", "no" or "abstain".
    pub vote: String,
    pub anchor: Option<DetailAnchor>,
}

/// A governance proposal.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailProposal {
    pub deposit: String,
    /// Where the deposit goes back to, bech32.
    pub reward_account: String,
    /// "parameterChange", "hardFork", "treasuryWithdrawals", "noConfidence",
    /// "updateCommittee", "newConstitution" or "information".
    pub action: String,
    /// The action this one follows on from, where its kind has one.
    pub follows: Option<DetailActionId>,
    /// A parameter change's parameters, each by its number and its value's
    /// raw CBOR: the ledger's numbering, re-encoded from what was decoded.
    pub parameters: Vec<UnknownField>,
    /// A treasury withdrawal's payments: reward address and amount.
    pub withdrawals: Vec<DetailWithdrawal>,
    /// The guardrail or committee script a parameter change or constitution names.
    pub script: Option<String>,
    /// A hard fork's protocol version, "major.minor".
    pub version: Option<String>,
    pub anchor: DetailAnchor,
}

/// A redeemer: which script run it is for, the argument it is run with, and
/// the budget claimed for it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailRedeemer {
    /// "spend", "mint", "cert", "reward", "vote", "propose", or the number for
    /// a tag this wallet doesn't know.
    pub tag: String,
    /// Which input, policy, certificate, withdrawal, vote or proposal, in the
    /// ledger's order for that tag.
    pub index: u64,
    /// The argument, as written (hex).
    pub data: String,
    pub mem: u64,
    pub steps: u64,
}

/// A datum carried in the witness set, named by an output's `datumHash`.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailDatum {
    /// The hash of the bytes as written: the one an output names.
    pub hash: String,
    pub hex: String,
    /// The register it holds, when it is one.
    pub register: Option<DetailRegister>,
}

/// A signature already in the witness set.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailSignature {
    pub public_key: String,
    /// The key's hash, as an address or `requiredSigners` names it.
    pub key_hash: String,
}

/// A metadatum, as the tree it is. `type` says which.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DetailMetadatum {
    Int { value: String },
    Bytes { hex: String, text: Option<String> },
    Text { text: String },
    List { items: Vec<DetailMetadatum> },
    Map { entries: Vec<DetailMetaEntry> },
}

/// One entry of a metadatum map.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailMetaEntry {
    pub key: DetailMetadatum,
    pub value: DetailMetadatum,
}

/// One label of the transaction's metadata, with everything under it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetailMetadata {
    /// The label, as a decimal string: labels go past what JSON holds exactly.
    pub label: String,
    pub value: DetailMetadatum,
}

/// Something in the bytes this wallet has no name for: where it is, the map
/// key it is under, and the value's raw CBOR.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnknownField {
    /// "body", "witnesses" or "metadata"; for a proposal's parameters, "parameters".
    pub at: String,
    pub field: String,
    pub hex: String,
}

/// Everything in a transaction's bytes, field by field.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TxDetail {
    pub tx_hash: String,
    /// The whole transaction, in bytes, and its body alone.
    pub size: usize,
    pub body_size: usize,
    /// The body's network id, when it names one: 0 a test network, 1 mainnet.
    pub network_id: Option<u8>,
    /// The transaction's validity flag: false means it is meant to fail its
    /// scripts, and the collateral is taken instead.
    pub valid: bool,
    /// Whether the witness set holds anything at all.
    pub witnessed: bool,
    pub inputs: Vec<Outpoint>,
    pub reference_inputs: Vec<Outpoint>,
    pub collateral: Vec<Outpoint>,
    pub outputs: Vec<DetailOutput>,
    /// What comes back from the collateral if a script refuses it.
    pub collateral_return: Option<DetailOutput>,
    /// The most the network takes of the collateral.
    pub total_collateral: Option<String>,
    pub fee: String,
    /// The slots it is valid between: `validFrom` from, `validUntil` until.
    pub valid_from: Option<u64>,
    pub valid_until: Option<u64>,
    /// Tokens minted (positive) or burned (negative).
    pub mint: Vec<DetailAsset>,
    pub certificates: Vec<DetailCert>,
    pub withdrawals: Vec<DetailWithdrawal>,
    pub votes: Vec<DetailVote>,
    pub proposals: Vec<DetailProposal>,
    /// Key hashes that must sign it beyond what its inputs need.
    pub required_signers: Vec<String>,
    pub script_data_hash: Option<String>,
    pub auxiliary_data_hash: Option<String>,
    pub treasury_value: Option<String>,
    pub donation: Option<String>,
    pub redeemers: Vec<DetailRedeemer>,
    pub scripts: Vec<DetailScript>,
    pub datums: Vec<DetailDatum>,
    pub signatures: Vec<DetailSignature>,
    /// Byron-era witnesses, which this wallet doesn't read further.
    pub bootstrap_witnesses: usize,
    pub metadata: Vec<DetailMetadata>,
    /// CIP-20's message (label 674), when there is one.
    pub note: Option<Vec<String>>,
    pub unknown: Vec<UnknownField>,
}

/// The transaction `tx_cbor` (hex) holds, field by field. `network` names the
/// network only to recognise Seedelf Wallet's contract; every address is read
/// from its own bytes.
pub fn decode_tx(network: &str, tx_cbor: &str) -> Result<TxDetail> {
    let flag = network_flag(network)?;
    let text = tx_cbor.trim();
    if text.len() > 2 * MAX_TX_BYTES {
        bail!("The wallet can't read this transaction: it's far larger than Cardano allows.");
    }
    let bytes = hex::decode(text).map_err(|_| anyhow!("The transaction isn't hex."))?;
    check_nesting(&bytes)?;
    // Exactly one transaction and nothing after it, so the hex the view shows
    // is the transaction and not a transaction with something appended.
    let mut whole = minicbor::Decoder::new(&bytes);
    match whole.skip() {
        Ok(()) if whole.position() == bytes.len() => {}
        Ok(()) => bail!("The wallet can't read this transaction: it has bytes after its end."),
        Err(e) => bail!("The wallet can't read this transaction: {e}"),
    }
    let tx = conway::MintedTx::decode_fragment(&bytes)
        .map_err(|e| anyhow!("The wallet can't read this transaction: {e}"))?;
    let body = &tx.transaction_body;
    let witnesses = &tx.transaction_witness_set;
    let contract = seedelf_contract(flag)?;

    let mut unknown = map_extras("body", body.raw_cbor(), &BODY_FIELDS)?;
    unknown.extend(map_extras(
        "witnesses",
        witnesses.raw_cbor(),
        &WITNESS_FIELDS,
    )?);

    let mut scripts = Vec::new();
    let mut outputs = Vec::new();
    for (i, out) in body.outputs.iter().enumerate() {
        let output = output_detail(Where::Output(i as u64), out, flag, &contract)?;
        if let Some(script) = &output.script_ref {
            scripts.push(script.clone());
        }
        outputs.push(output);
    }
    // Not one of the numbered outputs: the body holds it on its own, so its
    // `index` is 0 and says nothing.
    let collateral_return = body
        .collateral_return
        .as_ref()
        .map(|out| output_detail(Where::CollateralReturn, out, flag, &contract))
        .transpose()?;

    let mut mint = Vec::new();
    for (policy, names) in body.mint.iter().flat_map(|m| m.iter()) {
        for (name, quantity) in names.iter() {
            mint.push(asset(policy, name, i64::from(quantity).to_string()));
        }
    }

    let mut certificates = Vec::new();
    for cert in body.certificates.iter().flat_map(|c| c.iter()) {
        certificates.push(certificate(cert)?);
    }

    let mut withdrawals = Vec::new();
    for (account, amount) in body.withdrawals.iter().flat_map(|w| w.iter()) {
        withdrawals.push(DetailWithdrawal {
            address: reward_address(account)?,
            lovelace: amount.to_string(),
        });
    }

    let mut votes = Vec::new();
    for (voter, procedures) in body.voting_procedures.iter().flat_map(|v| v.iter()) {
        let (who, credential) = voter_parts(voter);
        for (action, procedure) in procedures.iter() {
            votes.push(DetailVote {
                voter: who.to_string(),
                credential: credential.clone(),
                action: DetailActionId {
                    tx_hash: hex::encode(action.transaction_id.as_ref()),
                    index: action.action_index,
                },
                vote: match procedure.vote {
                    conway::Vote::Yes => "yes",
                    conway::Vote::No => "no",
                    conway::Vote::Abstain => "abstain",
                }
                .to_string(),
                anchor: anchor_of(&procedure.anchor),
            });
        }
    }

    let mut proposals = Vec::new();
    for proposal in body.proposal_procedures.iter().flat_map(|p| p.iter()) {
        proposals.push(proposal_detail(proposal)?);
    }

    let (metadata, note, aux_scripts, aux_unknown) = match &tx.auxiliary_data {
        Nullable::Some(aux) => auxiliary(aux)?,
        _ => (Vec::new(), None, Vec::new(), Vec::new()),
    };
    unknown.extend(aux_unknown);

    for script in witness_scripts(witnesses) {
        scripts.push(script);
    }
    scripts.extend(aux_scripts);

    let datums = witnesses
        .plutus_data
        .iter()
        .flat_map(|set| set.iter())
        .map(|datum| {
            let hex = hex::encode(datum.raw_cbor());
            DetailDatum {
                hash: hex::encode(Hasher::<256>::hash(datum.raw_cbor()).as_ref()),
                register: register_detail(&hex),
                hex,
            }
        })
        .collect();

    let signatures = witnesses
        .vkeywitness
        .iter()
        .flat_map(|set| set.iter())
        .map(|w| DetailSignature {
            public_key: hex::encode(w.vkey.as_slice()),
            key_hash: hex::encode(Hasher::<224>::hash(w.vkey.as_slice()).as_ref()),
        })
        .collect();

    Ok(TxDetail {
        tx_hash: hex::encode(Hasher::<256>::hash(body.raw_cbor()).as_ref()),
        size: bytes.len(),
        body_size: body.raw_cbor().len(),
        network_id: body.network_id.map(u8::from),
        valid: tx.success,
        witnessed: witness_map_entries(witnesses.raw_cbor())? > 0,
        inputs: outpoints(body.inputs.iter()),
        reference_inputs: outpoints(body.reference_inputs.iter().flat_map(|r| r.iter())),
        collateral: outpoints(body.collateral.iter().flat_map(|c| c.iter())),
        outputs,
        collateral_return,
        total_collateral: body.total_collateral.map(|c| c.to_string()),
        fee: body.fee.to_string(),
        valid_from: body.validity_interval_start,
        valid_until: body.ttl,
        mint,
        certificates,
        withdrawals,
        votes,
        proposals,
        required_signers: body
            .required_signers
            .iter()
            .flat_map(|s| s.iter())
            .map(|h| hex::encode(h.as_ref()))
            .collect(),
        script_data_hash: body.script_data_hash.map(|h| hex::encode(h.as_ref())),
        auxiliary_data_hash: body
            .auxiliary_data_hash
            .as_ref()
            .map(|h| hex::encode(h.as_slice())),
        treasury_value: body.treasury_value.map(|c| c.to_string()),
        donation: body.donation.map(|d| u64::from(d).to_string()),
        redeemers: redeemers(witnesses.redeemer.as_ref())?,
        scripts,
        datums,
        signatures,
        bootstrap_witnesses: witnesses
            .bootstrap_witness
            .as_ref()
            .map_or(0, |set| set.len()),
        metadata,
        note,
        unknown,
    })
}

/// The body's map keys this module reads (`conway::PseudoTransactionBody`).
const BODY_FIELDS: [u64; 20] = [
    0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
];
/// The witness set's (`conway::MintedWitnessSet`).
const WITNESS_FIELDS: [u64; 8] = [0, 1, 2, 3, 4, 5, 6, 7];
/// The auxiliary data's, in Alonzo's tagged form (`PostAlonzoAuxiliaryData`).
const AUX_FIELDS: [u64; 5] = [0, 1, 2, 3, 4];

/// Seedelf Wallet's contract address on this network, and its script hash.
fn seedelf_contract(flag: bool) -> Result<Hash<28>> {
    let hash = get_config(VARIANT, flag)?.contract.wallet_contract_hash;
    match wallet_contract(flag, hash) {
        Address::Shelley(s) => Ok(*s.payment().as_hash()),
        _ => unreachable!("the wallet contract is a Shelley address"),
    }
}

fn outpoints<'a>(inputs: impl Iterator<Item = &'a conway::TransactionInput>) -> Vec<Outpoint> {
    inputs
        .map(|i| Outpoint {
            tx_hash: hex::encode(i.transaction_id.as_ref()),
            index: i.index,
        })
        .collect()
}

fn asset(policy: &conway::PolicyId, name: &[u8], quantity: String) -> DetailAsset {
    DetailAsset {
        policy_id: hex::encode(policy.as_ref()),
        asset_name: hex::encode(name),
        name_text: readable(name),
        quantity,
    }
}

/// Bytes as text, when they read as printable UTF-8: a token name or a
/// metadatum's bytes often are, and the hex is shown either way.
fn readable(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    (!text.is_empty() && !text.chars().any(|c| c.is_control())).then(|| text.to_string())
}

/// A reward address's bech32 form, from the bytes a withdrawal or a
/// certificate names it by.
fn reward_address(bytes: &[u8]) -> Result<String> {
    let address =
        Address::from_bytes(bytes).map_err(|e| anyhow!("a reward address is unreadable: {e}"))?;
    Ok(address.to_bech32().unwrap_or_else(|_| address.to_hex()))
}

fn credential(cred: &StakeCredential) -> DetailCredential {
    let (kind, hash) = match cred {
        StakeCredential::AddrKeyhash(h) => ("key", h),
        StakeCredential::ScriptHash(h) => ("script", h),
    };
    DetailCredential {
        kind: kind.to_string(),
        hash: hex::encode(hash.as_ref()),
    }
}

fn anchor_of(anchor: &Nullable<conway::Anchor>) -> Option<DetailAnchor> {
    match anchor {
        Nullable::Some(a) => Some(DetailAnchor {
            url: a.url.clone(),
            content_hash: hex::encode(a.content_hash.as_ref()),
        }),
        _ => None,
    }
}

/// A DRep's own id, from the credential it registers under.
fn drep_of(cred: &StakeCredential) -> String {
    drep_id(&match cred {
        StakeCredential::AddrKeyhash(h) => conway::DRep::Key(*h),
        StakeCredential::ScriptHash(h) => conway::DRep::Script(*h),
    })
}

fn voter_parts(voter: &conway::Voter) -> (&'static str, DetailCredential) {
    let key = |h: &Hash<28>| DetailCredential {
        kind: "key".to_string(),
        hash: hex::encode(h.as_ref()),
    };
    let script = |h: &Hash<28>| DetailCredential {
        kind: "script".to_string(),
        hash: hex::encode(h.as_ref()),
    };
    match voter {
        conway::Voter::ConstitutionalCommitteeKey(h) => ("committee", key(h)),
        conway::Voter::ConstitutionalCommitteeScript(h) => ("committee", script(h)),
        conway::Voter::DRepKey(h) => ("drep", key(h)),
        conway::Voter::DRepScript(h) => ("drep", script(h)),
        conway::Voter::StakePoolKey(h) => ("pool", key(h)),
    }
}

fn relay_text(relay: &Relay) -> String {
    let port = |p: &Nullable<u32>| match p {
        Nullable::Some(p) => format!(":{p}"),
        _ => String::new(),
    };
    match relay {
        Relay::SingleHostAddr(p, v4, v6) => {
            let host = match (v4, v6) {
                (Nullable::Some(v4), _) if v4.len() == 4 => v4
                    .iter()
                    .map(|o| o.to_string())
                    .collect::<Vec<_>>()
                    .join("."),
                (_, Nullable::Some(v6)) => hex::encode(v6.as_slice()),
                _ => "unnamed".to_string(),
            };
            format!("{host}{}", port(p))
        }
        Relay::SingleHostName(p, name) => format!("{name}{}", port(p)),
        Relay::MultiHostName(name) => name.clone(),
    }
}

fn certificate(cert: &conway::Certificate) -> Result<DetailCert> {
    use conway::Certificate as C;
    Ok(match cert {
        C::StakeRegistration(cred) => DetailCert::StakeRegistration {
            credential: credential(cred),
        },
        C::StakeDeregistration(cred) => DetailCert::StakeDeregistration {
            credential: credential(cred),
        },
        C::StakeDelegation(cred, pool) => DetailCert::StakeDelegation {
            credential: credential(cred),
            pool: pool_id(pool),
        },
        C::PoolRegistration {
            operator,
            vrf_keyhash,
            pledge,
            cost,
            margin,
            reward_account,
            pool_owners,
            relays,
            pool_metadata,
        } => DetailCert::PoolRegistration {
            pool: pool_id(operator),
            vrf_key_hash: hex::encode(vrf_keyhash.as_ref()),
            pledge: pledge.to_string(),
            cost: cost.to_string(),
            margin: format!("{}/{}", margin.numerator, margin.denominator),
            reward_account: reward_address(reward_account)?,
            owners: pool_owners
                .iter()
                .map(|o| hex::encode(o.as_ref()))
                .collect(),
            relays: relays.iter().map(relay_text).collect(),
            metadata: match pool_metadata {
                Nullable::Some(m) => Some(DetailAnchor {
                    url: m.url.clone(),
                    content_hash: hex::encode(m.hash.as_ref()),
                }),
                _ => None,
            },
        },
        C::PoolRetirement(pool, epoch) => DetailCert::PoolRetirement {
            pool: pool_id(pool),
            epoch: *epoch,
        },
        C::Reg(cred, deposit) => DetailCert::Registration {
            credential: credential(cred),
            deposit: deposit.to_string(),
        },
        C::UnReg(cred, refund) => DetailCert::Deregistration {
            credential: credential(cred),
            refund: refund.to_string(),
        },
        C::VoteDeleg(cred, drep) => DetailCert::VoteDelegation {
            credential: credential(cred),
            drep: drep_id(drep),
        },
        C::StakeVoteDeleg(cred, pool, drep) => DetailCert::StakeVoteDelegation {
            credential: credential(cred),
            pool: pool_id(pool),
            drep: drep_id(drep),
        },
        C::StakeRegDeleg(cred, pool, deposit) => DetailCert::StakeRegistrationDelegation {
            credential: credential(cred),
            pool: pool_id(pool),
            deposit: deposit.to_string(),
        },
        C::VoteRegDeleg(cred, drep, deposit) => DetailCert::VoteRegistrationDelegation {
            credential: credential(cred),
            drep: drep_id(drep),
            deposit: deposit.to_string(),
        },
        C::StakeVoteRegDeleg(cred, pool, drep, deposit) => {
            DetailCert::StakeVoteRegistrationDelegation {
                credential: credential(cred),
                pool: pool_id(pool),
                drep: drep_id(drep),
                deposit: deposit.to_string(),
            }
        }
        C::AuthCommitteeHot(cold, hot) => DetailCert::CommitteeHotAuth {
            cold: credential(cold),
            hot: credential(hot),
        },
        C::ResignCommitteeCold(cold, anchor) => DetailCert::CommitteeColdResign {
            cold: credential(cold),
            anchor: anchor_of(anchor),
        },
        C::RegDRepCert(cred, deposit, anchor) => DetailCert::DrepRegistration {
            credential: credential(cred),
            drep: drep_of(cred),
            deposit: deposit.to_string(),
            anchor: anchor_of(anchor),
        },
        C::UnRegDRepCert(cred, refund) => DetailCert::DrepDeregistration {
            credential: credential(cred),
            drep: drep_of(cred),
            refund: refund.to_string(),
        },
        C::UpdateDRepCert(cred, anchor) => DetailCert::DrepUpdate {
            credential: credential(cred),
            drep: drep_of(cred),
            anchor: anchor_of(anchor),
        },
    })
}

fn proposal_detail(proposal: &conway::ProposalProcedure) -> Result<DetailProposal> {
    use conway::GovAction as A;
    let id = |id: &Nullable<conway::GovActionId>| match id {
        Nullable::Some(id) => Some(DetailActionId {
            tx_hash: hex::encode(id.transaction_id.as_ref()),
            index: id.action_index,
        }),
        _ => None,
    };
    let script = |hash: &Nullable<conway::ScriptHash>| match hash {
        Nullable::Some(h) => Some(hex::encode(h.as_ref())),
        _ => None,
    };
    let mut detail = DetailProposal {
        deposit: proposal.deposit.to_string(),
        reward_account: reward_address(&proposal.reward_account)?,
        action: String::new(),
        follows: None,
        parameters: Vec::new(),
        withdrawals: Vec::new(),
        script: None,
        version: None,
        anchor: DetailAnchor {
            url: proposal.anchor.url.clone(),
            content_hash: hex::encode(proposal.anchor.content_hash.as_ref()),
        },
    };
    detail.action = match &proposal.gov_action {
        A::ParameterChange(previous, update, guardrail) => {
            detail.follows = id(previous);
            detail.script = script(guardrail);
            // The parameters by number, from the update re-encoded: the ledger
            // numbers them, and naming each in words here would go stale.
            let bytes = update
                .encode_fragment()
                .map_err(|e| anyhow!("a parameter change can't be read: {e}"))?;
            detail.parameters = map_fields(&bytes, "parameters")?
                .into_iter()
                .map(|(field, value)| UnknownField {
                    at: "parameters".to_string(),
                    field: field.to_string(),
                    hex: hex::encode(value),
                })
                .collect();
            "parameterChange"
        }
        A::HardForkInitiation(previous, (major, minor)) => {
            detail.follows = id(previous);
            detail.version = Some(format!("{major}.{minor}"));
            "hardFork"
        }
        A::TreasuryWithdrawals(payments, guardrail) => {
            detail.script = script(guardrail);
            for (account, amount) in payments.iter() {
                detail.withdrawals.push(DetailWithdrawal {
                    address: reward_address(account)?,
                    lovelace: amount.to_string(),
                });
            }
            "treasuryWithdrawals"
        }
        A::NoConfidence(previous) => {
            detail.follows = id(previous);
            "noConfidence"
        }
        A::UpdateCommittee(previous, ..) => {
            detail.follows = id(previous);
            "updateCommittee"
        }
        A::NewConstitution(previous, constitution) => {
            detail.follows = id(previous);
            detail.script = script(&constitution.guardrail_script);
            "newConstitution"
        }
        A::Information => "information",
    }
    .to_string();
    Ok(detail)
}

/// A script's kind, hash and size, from the bytes the ledger hashes.
fn plutus_script(version: u8, bytes: &[u8], source: &str) -> DetailScript {
    DetailScript {
        kind: format!("plutusV{version}"),
        hash: hex::encode(Hasher::<224>::hash_tagged(bytes, version).as_ref()),
        size: bytes.len(),
        source: source.to_string(),
    }
}

fn native_script(bytes: &[u8], source: &str) -> DetailScript {
    DetailScript {
        kind: "native".to_string(),
        hash: hex::encode(Hasher::<224>::hash_tagged(bytes, 0).as_ref()),
        size: bytes.len(),
        source: source.to_string(),
    }
}

/// Every script the witness set carries, in the ledger's key order.
fn witness_scripts(witnesses: &conway::MintedWitnessSet) -> Vec<DetailScript> {
    let mut scripts = Vec::new();
    for script in witnesses.native_script.iter().flat_map(|set| set.iter()) {
        scripts.push(native_script(script.raw_cbor(), "witnesses"));
    }
    for script in witnesses.plutus_v1_script.iter().flat_map(|set| set.iter()) {
        scripts.push(plutus_script(1, script.as_ref(), "witnesses"));
    }
    for script in witnesses.plutus_v2_script.iter().flat_map(|set| set.iter()) {
        scripts.push(plutus_script(2, script.as_ref(), "witnesses"));
    }
    for script in witnesses.plutus_v3_script.iter().flat_map(|set| set.iter()) {
        scripts.push(plutus_script(3, script.as_ref(), "witnesses"));
    }
    scripts
}

/// The register an inline datum or a witness datum holds, when it is one.
fn register_detail(datum_hex: &str) -> Option<DetailRegister> {
    let register = register_datum(datum_hex)?;
    Some(DetailRegister {
        payable: seedelf_core::build::is_payable(&register),
        generator: register.generator,
        public_value: register.public_value,
    })
}

/// Which output of the body this is, for its number and for an error that
/// names it.
enum Where {
    Output(u64),
    CollateralReturn,
}

impl Where {
    fn index(&self) -> u64 {
        match self {
            Where::Output(i) => *i,
            Where::CollateralReturn => 0,
        }
    }

    fn name(&self) -> String {
        match self {
            Where::Output(i) => format!("Output {i}"),
            Where::CollateralReturn => "The collateral return".to_string(),
        }
    }
}

fn output_detail(
    at: Where,
    out: &conway::MintedTransactionOutput,
    flag: bool,
    contract: &Hash<28>,
) -> Result<DetailOutput> {
    let (address_bytes, lovelace, assets, inline, datum_hash, script_ref, form) = match out {
        conway::PseudoTransactionOutput::Legacy(o) => {
            let (lovelace, assets) = legacy_value(&o.amount);
            (
                o.address.to_vec(),
                lovelace,
                assets,
                None,
                o.datum_hash.map(|h| hex::encode(h.as_ref())),
                None,
                "legacy",
            )
        }
        conway::PseudoTransactionOutput::PostAlonzo(o) => {
            let (lovelace, assets) = value(&o.value);
            let (inline, datum_hash) = match &o.datum_option {
                Some(conway::PseudoDatumOption::Data(d)) => {
                    (Some(hex::encode(d.0.raw_cbor())), None)
                }
                Some(conway::PseudoDatumOption::Hash(h)) => (None, Some(hex::encode(h.as_ref()))),
                None => (None, None),
            };
            let script_ref = o.script_ref.as_ref().map(|s| match &s.0 {
                conway::PseudoScript::NativeScript(n) => native_script(n.raw_cbor(), "output"),
                conway::PseudoScript::PlutusV1Script(p) => plutus_script(1, p.as_ref(), "output"),
                conway::PseudoScript::PlutusV2Script(p) => plutus_script(2, p.as_ref(), "output"),
                conway::PseudoScript::PlutusV3Script(p) => plutus_script(3, p.as_ref(), "output"),
            });
            (
                o.address.to_vec(),
                lovelace,
                assets,
                inline,
                datum_hash,
                script_ref,
                "postAlonzo",
            )
        }
    };
    Ok(DetailOutput {
        index: at.index(),
        address: address_detail(&address_bytes, flag, contract)
            .map_err(|e| anyhow!("{} has an unreadable address: {e}", at.name()))?,
        lovelace,
        assets,
        register: inline.as_deref().and_then(register_detail),
        inline_datum: inline,
        datum_hash,
        script_ref,
        form: form.to_string(),
    })
}

/// ADA and tokens in a Babbage-or-later value, tokens in the bytes' order.
fn value(value: &conway::Value) -> (String, Vec<DetailAsset>) {
    let mut assets = Vec::new();
    let lovelace = match value {
        conway::Value::Coin(c) => *c,
        conway::Value::Multiasset(c, multiasset) => {
            for (policy, names) in multiasset.iter() {
                for (name, quantity) in names.iter() {
                    assets.push(asset(policy, name, u64::from(quantity).to_string()));
                }
            }
            *c
        }
    };
    (lovelace.to_string(), assets)
}

/// The same for a Shelley-era output's value.
fn legacy_value(value: &pallas_primitives::alonzo::Value) -> (String, Vec<DetailAsset>) {
    let mut assets = Vec::new();
    let lovelace = match value {
        pallas_primitives::alonzo::Value::Coin(c) => *c,
        pallas_primitives::alonzo::Value::Multiasset(c, multiasset) => {
            for (policy, names) in multiasset.iter() {
                for (name, quantity) in names.iter() {
                    assets.push(asset(policy, name, quantity.to_string()));
                }
            }
            *c
        }
    };
    (lovelace.to_string(), assets)
}

fn address_detail(bytes: &[u8], flag: bool, contract: &Hash<28>) -> Result<DetailAddress> {
    let address = Address::from_bytes(bytes).map_err(|e| anyhow!("{e}"))?;
    let network = |n: pallas_addresses::Network| {
        match n {
            pallas_addresses::Network::Testnet => "testnet",
            pallas_addresses::Network::Mainnet => "mainnet",
            pallas_addresses::Network::Other(_) => "other",
        }
        .to_string()
    };
    let (kind, payment, stake, net, seedelf) = match &address {
        Address::Shelley(s) => {
            let payment = match s.payment() {
                ShelleyPaymentPart::Key(_) => "key",
                ShelleyPaymentPart::Script(_) => "script",
            };
            let (kind, stake) = match s.delegation() {
                ShelleyDelegationPart::Key(_) => ("base", Some("key")),
                ShelleyDelegationPart::Script(_) => ("base", Some("script")),
                ShelleyDelegationPart::Pointer(_) => ("pointer", Some("pointer")),
                ShelleyDelegationPart::Null => ("enterprise", None),
            };
            let seedelf = s.payment().is_script() && *s.payment().as_hash() == *contract;
            (
                kind,
                Some(payment),
                stake,
                Some(network(s.network())),
                seedelf && s.network() == address_network(flag),
            )
        }
        Address::Stake(s) => {
            let stake = match s.payload() {
                StakePayload::Stake(_) => "key",
                StakePayload::Script(_) => "script",
            };
            (
                "reward",
                None,
                Some(stake),
                Some(network(s.network())),
                false,
            )
        }
        Address::Byron(_) => ("byron", None, None, None, false),
    };
    Ok(DetailAddress {
        bech32: address.to_bech32().unwrap_or_else(|_| address.to_hex()),
        hex: address.to_hex(),
        kind: kind.to_string(),
        payment: payment.map(str::to_string),
        stake: stake.map(str::to_string),
        network: net,
        seedelf,
    })
}

fn address_network(flag: bool) -> pallas_addresses::Network {
    if flag {
        pallas_addresses::Network::Testnet
    } else {
        pallas_addresses::Network::Mainnet
    }
}

/// The redeemers, read from the bytes as written so each argument's hex is the
/// argument itself: a list of `[tag, index, data, [mem, steps]]`, or Conway's
/// map from `[tag, index]` to `[data, [mem, steps]]`.
fn redeemers(raw: Option<&KeepRaw<'_, conway::Redeemers>>) -> Result<Vec<DetailRedeemer>> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let bytes = raw.raw_cbor();
    let mut d = minicbor::Decoder::new(bytes);
    let unreadable = |e: minicbor::decode::Error| anyhow!("a redeemer isn't readable: {e}");
    let mut out = Vec::new();
    let ex_units = |d: &mut minicbor::Decoder<'_>| -> Result<(u64, u64)> {
        d.array().map_err(unreadable)?;
        let mem = d.u64().map_err(unreadable)?;
        let steps = d.u64().map_err(unreadable)?;
        Ok((mem, steps))
    };
    match d.datatype().map_err(unreadable)? {
        minicbor::data::Type::Map | minicbor::data::Type::MapIndef => {
            let entries = d.map().map_err(unreadable)?;
            let mut i = 0;
            while entries.is_none_or(|n| i < n) {
                if entries.is_none()
                    && d.datatype().map_err(unreadable)? == minicbor::data::Type::Break
                {
                    d.skip().map_err(unreadable)?;
                    break;
                }
                d.array().map_err(unreadable)?;
                let tag = d.u64().map_err(unreadable)?;
                let index = d.u64().map_err(unreadable)?;
                d.array().map_err(unreadable)?;
                let data = raw_next(&mut d)?;
                let (mem, steps) = ex_units(&mut d)?;
                out.push(DetailRedeemer {
                    tag: redeemer_tag(tag),
                    index,
                    data: hex::encode(data),
                    mem,
                    steps,
                });
                i += 1;
            }
        }
        _ => {
            let items = d.array().map_err(unreadable)?;
            let mut i = 0;
            while items.is_none_or(|n| i < n) {
                if items.is_none()
                    && d.datatype().map_err(unreadable)? == minicbor::data::Type::Break
                {
                    d.skip().map_err(unreadable)?;
                    break;
                }
                d.array().map_err(unreadable)?;
                let tag = d.u64().map_err(unreadable)?;
                let index = d.u64().map_err(unreadable)?;
                let data = raw_next(&mut d)?;
                let (mem, steps) = ex_units(&mut d)?;
                out.push(DetailRedeemer {
                    tag: redeemer_tag(tag),
                    index,
                    data: hex::encode(data),
                    mem,
                    steps,
                });
                i += 1;
            }
        }
    }
    Ok(out)
}

/// What a redeemer's tag number means. A number this wallet doesn't know is
/// reported as itself rather than guessed at.
fn redeemer_tag(tag: u64) -> String {
    match tag {
        0 => "spend",
        1 => "mint",
        2 => "cert",
        3 => "reward",
        4 => "vote",
        5 => "propose",
        _ => return tag.to_string(),
    }
    .to_string()
}

/// The bytes of the next CBOR item, exactly as written.
fn raw_next<'b>(d: &mut minicbor::Decoder<'b>) -> Result<&'b [u8]> {
    let start = d.position();
    d.skip()
        .map_err(|e| anyhow!("the transaction isn't valid CBOR: {e}"))?;
    Ok(&d.input()[start..d.position()])
}

/// A map's `(key, raw value)` entries, keys as numbers: the bytes' own order.
fn map_fields<'b>(bytes: &'b [u8], what: &str) -> Result<Vec<(u64, &'b [u8])>> {
    let mut d = minicbor::Decoder::new(bytes);
    let unreadable = |e: minicbor::decode::Error| anyhow!("the {what} isn't a readable map: {e}");
    let entries = d.map().map_err(unreadable)?;
    // Not sized by `entries`: whoever wrote the bytes chose it, and each entry
    // needs bytes to be read.
    let mut out = Vec::new();
    let mut i = 0;
    while entries.is_none_or(|n| i < n) {
        if entries.is_none() && d.datatype().map_err(unreadable)? == minicbor::data::Type::Break {
            break;
        }
        let key = d.u64().map_err(unreadable)?;
        out.push((key, raw_next(&mut d)?));
        i += 1;
    }
    Ok(out)
}

/// How many entries a witness set has: zero means the transaction carries no
/// signature, script or datum yet.
fn witness_map_entries(bytes: &[u8]) -> Result<usize> {
    Ok(map_fields(bytes, "witness set")?.len())
}

/// The map keys of `bytes` that aren't in `known`, each with its raw value.
fn map_extras(at: &str, bytes: &[u8], known: &[u64]) -> Result<Vec<UnknownField>> {
    Ok(map_fields(bytes, at)?
        .into_iter()
        .filter(|(key, _)| !known.contains(key))
        .map(|(key, value)| UnknownField {
            at: at.to_string(),
            field: key.to_string(),
            hex: hex::encode(value),
        })
        .collect())
}

/// The metadata, the CIP-20 note in it, the scripts the auxiliary data
/// carries, and any auxiliary field this wallet doesn't know.
type Auxiliary = (
    Vec<DetailMetadata>,
    Option<Vec<String>>,
    Vec<DetailScript>,
    Vec<UnknownField>,
);

fn auxiliary(aux: &KeepRaw<'_, conway::AuxiliaryData>) -> Result<Auxiliary> {
    let mut scripts = Vec::new();
    let mut unknown = Vec::new();
    let labels = match &**aux {
        conway::AuxiliaryData::Shelley(m) => Some(m),
        conway::AuxiliaryData::ShelleyMa(m) => {
            for script in m.auxiliary_scripts.iter().flatten() {
                let bytes = script
                    .encode_fragment()
                    .map_err(|e| anyhow!("a metadata script can't be read: {e}"))?;
                scripts.push(native_script(&bytes, "metadata"));
            }
            Some(&m.transaction_metadata)
        }
        conway::AuxiliaryData::PostAlonzo(m) => {
            // Its own map is inside a tag (#6.259), so the raw bytes are read
            // past that tag before its keys are looked at.
            let mut d = minicbor::Decoder::new(aux.raw_cbor());
            if d.tag().is_ok() {
                let inner = &aux.raw_cbor()[d.position()..];
                for (field, value) in map_fields(inner, "metadata")? {
                    match field {
                        1 => scripts.extend(script_list(value, 0, "metadata")?),
                        2 => scripts.extend(script_list(value, 1, "metadata")?),
                        3 => scripts.extend(script_list(value, 2, "metadata")?),
                        4 => scripts.extend(script_list(value, 3, "metadata")?),
                        _ => {}
                    }
                }
                unknown = map_extras("metadata", inner, &AUX_FIELDS)?;
            }
            m.metadata.as_ref()
        }
    };
    let Some(labels) = labels else {
        return Ok((Vec::new(), None, scripts, unknown));
    };
    let metadata = labels
        .iter()
        .map(|(label, value)| DetailMetadata {
            label: label.to_string(),
            value: metadatum(value),
        })
        .collect();
    Ok((metadata, note_of(labels), scripts, unknown))
}

/// A list of scripts in the auxiliary data, read from the bytes as written:
/// `version` 0 is a native script (a CBOR item), 1-3 a Plutus script's bytes.
fn script_list(value: &[u8], version: u8, source: &str) -> Result<Vec<DetailScript>> {
    let mut d = minicbor::Decoder::new(value);
    let unreadable =
        |e: minicbor::decode::Error| anyhow!("the metadata's scripts aren't a list: {e}");
    let items = d.array().map_err(unreadable)?;
    let mut scripts = Vec::new();
    let mut i = 0;
    while items.is_none_or(|n| i < n) {
        if items.is_none() && d.datatype().map_err(unreadable)? == minicbor::data::Type::Break {
            break;
        }
        scripts.push(if version == 0 {
            native_script(raw_next(&mut d)?, source)
        } else {
            plutus_script(version, d.bytes().map_err(unreadable)?, source)
        });
        i += 1;
    }
    Ok(scripts)
}

fn metadatum(value: &Metadatum) -> DetailMetadatum {
    match value {
        Metadatum::Int(i) => DetailMetadatum::Int {
            value: i128::from(*i).to_string(),
        },
        Metadatum::Bytes(b) => DetailMetadatum::Bytes {
            hex: hex::encode(b.as_slice()),
            text: readable(b.as_slice()),
        },
        Metadatum::Text(t) => DetailMetadatum::Text { text: t.clone() },
        Metadatum::Array(items) => DetailMetadatum::List {
            items: items.iter().map(metadatum).collect(),
        },
        Metadatum::Map(entries) => DetailMetadatum::Map {
            entries: entries
                .iter()
                .map(|(key, value)| DetailMetaEntry {
                    key: metadatum(key),
                    value: metadatum(value),
                })
                .collect(),
        },
    }
}

/// CIP-20's message (label 674): its lines, where it is written as the
/// standard says.
fn note_of(labels: &pallas_primitives::Metadata) -> Option<Vec<String>> {
    let Metadatum::Map(fields) = labels
        .iter()
        .find(|(label, _)| *label == 674)
        .map(|(_, m)| m)?
    else {
        return None;
    };
    fields.iter().find_map(|(k, v)| match (k, v) {
        (Metadatum::Text(k), Metadatum::Array(lines)) if k == "msg" => Some(
            lines
                .iter()
                .filter_map(|l| match l {
                    Metadatum::Text(t) => Some(t.clone()),
                    _ => None,
                })
                .collect(),
        ),
        (Metadatum::Text(k), Metadatum::Text(line)) if k == "msg" => Some(vec![line.clone()]),
        _ => None,
    })
}
