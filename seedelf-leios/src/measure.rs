//! The wallet's own transactions, built offline by core's builders exactly as
//! the web wallet builds them, and measured with its evaluator (Aiken's
//! `uplc`, which matches the chain to the step): their size, their budgets and
//! their fee are what decide how many go in a block of each kind.

use crate::dijkstra;
use crate::limits::Capacity;
use crate::synth;
use anyhow::{Context, Result, anyhow};
use pallas_codec::minicbor;
use pallas_primitives::Fragment;
use pallas_primitives::conway::{self, PseudoTransactionOutput, Redeemers, ScriptRef, TransactionOutput};
use seedelf_core::build::{self, Chain, Payment};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{self, Funding, Leg, PoolBox, Protocol};
use seedelf_core::lovejoin::{Terms, launch_from_account, launched_pool};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::ProtocolParameters;

/// One of the wallet's transactions, as built.
#[derive(Debug, Clone)]
pub struct Measured {
    pub kind: String,
    /// Unsigned, exactly as the builder returned it.
    pub tx: Vec<u8>,
    /// How many keys sign it: its size counts their witnesses.
    pub signers: usize,
    /// The output a Dijkstra mend takes its fee rise from (the payer's
    /// change). None where an output can't move after the fact: a withdraw's
    /// proofs bind every output.
    pub change: Option<usize>,
    /// Every input, reference input and collateral it names.
    pub known: Vec<Resolved>,
}

impl Measured {
    fn conway(&self) -> conway::Tx {
        conway::Tx::decode_fragment(&self.tx).expect("built by core")
    }

    /// Its size as it goes out, signed.
    pub fn size(&self) -> u64 {
        dijkstra::signed_size(&self.conway(), self.signers).expect("encodes")
    }

    /// (memory, steps) its scripts declare, all together.
    pub fn units(&self) -> (u64, u64) {
        match self.conway().transaction_witness_set.redeemer {
            Some(Redeemers::List(l)) => l.iter().fold((0, 0), |(m, s), r| (m + r.ex_units.mem, s + r.ex_units.steps)),
            Some(Redeemers::Map(m)) => m
                .iter()
                .fold((0, 0), |(a, s), (_, v)| (a + v.ex_units.mem, s + v.ex_units.steps)),
            None => (0, 0),
        }
    }

    pub fn redeemers(&self) -> usize {
        match self.conway().transaction_witness_set.redeemer {
            Some(Redeemers::List(l)) => l.len(),
            Some(Redeemers::Map(m)) => m.len(),
            None => 0,
        }
    }

    pub fn fee(&self) -> u64 {
        self.conway().transaction_body.fee
    }

    /// The reference scripts it reads, in bytes: what a block's
    /// reference-script cap counts.
    pub fn ref_script_bytes(&self) -> u64 {
        let tx = self.conway();
        let refs = tx.transaction_body.reference_inputs.iter().flat_map(|s| s.iter());
        tx.transaction_body
            .inputs
            .iter()
            .chain(refs)
            .filter_map(|i| {
                self.known
                    .iter()
                    .find(|r| r.tx_hash == *i.transaction_id && r.index == i.index)
            })
            .filter_map(|r| match minicbor::decode::<TransactionOutput>(&r.output) {
                Ok(PseudoTransactionOutput::PostAlonzo(o)) => o.script_ref.map(|s| match s.0 {
                    ScriptRef::PlutusV3Script(s) => s.as_ref().len() as u64,
                    _ => 0,
                }),
                _ => None,
            })
            .sum()
    }

    /// What it takes of a block.
    pub fn capacity(&self) -> Capacity {
        let (mem, steps) = self.units();
        Capacity {
            bytes: self.size(),
            mem,
            steps,
            ref_script_bytes: self.ref_script_bytes(),
        }
    }
}

/// What every Seedelf spend is built against on a testnet: variant 1's
/// scripts at preprod's references (the same bytes and hashes Musashi's
/// would carry: a script's hash doesn't depend on the network).
pub fn chain(params: &ProtocolParameters) -> Result<Chain> {
    Ok(Chain {
        params: params.clone(),
        network_flag: true,
        config: get_config(VARIANT, true)?,
    })
}

/// The output of `tx` that goes back to `sk`'s Seedelf: the change.
fn seedelf_change(tx: &[u8], sk: blstrs::Scalar) -> Result<usize> {
    let tx = conway::Tx::decode_fragment(tx).map_err(|e| anyhow!("{e}"))?;
    for (i, output) in tx.transaction_body.outputs.iter().enumerate() {
        let PseudoTransactionOutput::PostAlonzo(o) = output else { continue };
        let Some(conway::PseudoDatumOption::Data(data)) = &o.datum_option else { continue };
        let bytes = data.0.encode_fragment().map_err(|e| anyhow!("{e}"))?;
        if seedelf_koios::koios::register_of_datum(&bytes).is_some_and(|r| r.is_owned(sk).unwrap_or(false)) {
            return Ok(i);
        }
    }
    Err(anyhow!("no change back to the Seedelf"))
}

/// A private Send: `inputs` Seedelf UTxOs of 10 ₳ paying 5 ₳ to another
/// Seedelf, giveme.my's collateral, the change back under fresh registers.
/// Signed by the one-time key and giveme.my.
pub fn seedelf_send(params: &ProtocolParameters, inputs: usize) -> Result<Measured> {
    let sk = schnorr::random_scalar();
    let owner = Register::create(sk)?;
    let rows = (0..inputs)
        .map(|i| synth::seedelf_row(synth::tx_hash(), i as u64, 10_000_000, &owner.clone().rerandomize()?))
        .collect::<Result<Vec<_>>>()?;
    let to = Register::create(schnorr::random_scalar())?;
    let payment = Payment {
        register: to,
        lovelace: 5_000_000,
        tokens: Default::default(),
    };
    let built = build::transfer_from(&chain(params)?, &rows, &[payment], &owner, synth::key())?
        .proven(|register, vkh| schnorr::create_proof(register.clone(), sk, vkh.to_string()))?
        .measure_locally(&[])?;
    let tx = built.tx.tx_bytes.0;
    let mut known: Vec<Resolved> = rows.iter().map(eval::resolve_row).collect::<Result<_>>()?;
    known.extend(eval::seedelf_references(true)?);
    known.push(giveme_collateral()?);
    Ok(Measured {
        kind: format!("Seedelf send, {inputs} in"),
        change: Some(seedelf_change(&tx, sk)?),
        tx,
        signers: 2,
        known,
    })
}

/// giveme.my's collateral UTxO on preprod, as the mend's collateral check
/// needs its value: 5 ₳ (the CLI's `collateral_input`).
fn giveme_collateral() -> Result<Resolved> {
    let address = seedelf_core::address::collateral_address(true);
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(2)?.u8(0)?.bytes(&address.to_vec())?.u8(1)?.u64(5_000_000)?;
    Ok(Resolved {
        tx_hash: seedelf_core::constants::PREPROD_COLLATERAL_UTXO,
        index: 0,
        output: e.into_writer(),
    })
}

/// A Seedelf spend that puts up a key account's own collateral instead of
/// giveme.my's (`ScriptSpend::with_account`, a private session's return):
/// the shape the harness can send on Musashi, where giveme.my isn't.
pub fn seedelf_spend_own_collateral(params: &ProtocolParameters) -> Result<Measured> {
    let sk = schnorr::random_scalar();
    let owner = Register::create(sk)?;
    let row = synth::seedelf_row(synth::tx_hash(), 0, 20_000_000, &owner.clone().rerandomize()?)?;
    let account = synth::key();
    let address = synth::key_address(account);
    let collateral = synth::row(synth::tx_hash(), 0, &address, 5_000_000, None);
    let built = build::ScriptSpend::new(&chain(params)?, std::slice::from_ref(&row), &owner, synth::key())?
        .with_account(account, std::slice::from_ref(&collateral), &collateral)?
        .proven(|register, vkh| schnorr::create_proof(register.clone(), sk, vkh.to_string()))?
        .measure_locally(&[])?;
    let tx = built.tx.tx_bytes.0;
    let mut known = vec![eval::resolve_row(&row)?, eval::resolve_row(&collateral)?];
    known.extend(eval::seedelf_references(true)?);
    Ok(Measured {
        kind: "Seedelf spend, own collateral".into(),
        change: Some(seedelf_change(&tx, sk)?),
        tx,
        signers: 2,
        known,
    })
}

/// A pool launched from the public account, ADA alone at `box_lovelace` a
/// box (any amount but the classic pool's 10 ₳), and the pool it makes.
pub fn launch(params: &ProtocolParameters, box_lovelace: u64) -> Result<(Measured, Protocol)> {
    let account = synth::key();
    let address = synth::key_address(account);
    let available = vec![
        synth::row(synth::tx_hash(), 0, &address, 200_000_000, None),
        synth::row(synth::tx_hash(), 0, &address, 5_000_000, None),
    ];
    let terms = Terms {
        token: None,
        box_lovelace,
        max_fee: 1_000_000,
    };
    let launch = launch_from_account(&chain(params)?, &available, Some(&available[1]), &terms, true, &address, None)?;
    let seed = launch.seed;
    let built = launch.measure_locally()?;
    let tx = built.tx.tx_bytes.0;
    let pool = launched_pool(true, &tx, seed)?;
    let outputs = conway::Tx::decode_fragment(&tx).map_err(|e| anyhow!("{e}"))?.transaction_body.outputs.len();
    Ok((
        Measured {
            kind: format!("Lovejoin launch (ADA pool, {} ₳ a box)", box_lovelace / 1_000_000),
            tx,
            signers: 1,
            change: Some(outputs - 1),
            known: available.iter().map(eval::resolve_row).collect::<Result<_>>()?,
        },
        pool,
    ))
}

/// A chain through Lovejoin as the wallet builds one (`lovejoin::chain_across`):
/// a deposit of one box, then that box fanned out `depth` waves, `width`
/// boxes a mix, every mix paid from the one before's change by a session's
/// one key. The pool's other boxes are made up.
pub fn lovejoin_chain(params: &ProtocolParameters, protocol: &Protocol, width: usize, depth: u32) -> Result<(Vec<Measured>, Vec<PoolBox>, blstrs::Scalar)> {
    let session = synth::key_address(synth::key());
    let funding = Funding {
        coins: vec![synth::coin(&session, 100_000_000)?],
        collateral: Some(synth::coin(&session, 5_000_000)?),
        address: session,
        deposit_signers: 1,
        mix_signers: 1,
    };
    let pool: Vec<PoolBox> = (0..40).map(|_| synth::pool_box(protocol)).collect::<Result<_>>()?;
    let sk = schnorr::random_scalar();
    let owners = vec![Register::create(sk)?.rerandomize()?];
    let leg = Leg {
        protocol,
        owners: &owners,
        pool: &pool,
    };
    let built = lovejoin::chain_across(params, &funding, &[], &[leg], depth, width)?;
    let mut known: Vec<Resolved> = funding.coins.iter().map(|c| c.utxo.clone()).collect();
    known.push(funding.collateral.as_ref().context("collateral")?.utxo.clone());
    known.extend(pool.iter().map(|b| b.utxo.clone()));
    known.extend(protocol.references.iter().cloned());
    let mut txs = Vec::new();
    for (i, step) in built.txs.iter().enumerate() {
        let tx = step.tx.tx_bytes.0.clone();
        let mixes = built.txs[..i].iter().filter(|t| t.kind == "mix").count();
        txs.push(Measured {
            kind: if step.kind == "mix" {
                format!("Lovejoin mix {}, {width} wide", mixes + 1)
            } else {
                "Lovejoin deposit".into()
            },
            // A mix's outputs: its boxes, then the change; a deposit's: the
            // box, then the change.
            change: Some(if step.kind == "mix" { width } else { 1 }),
            signers: 1,
            known: known.clone(),
            tx: tx.clone(),
        });
        known.extend(eval::resolve_outputs(&tx)?);
    }
    Ok((txs, built.leaves, sk))
}

/// One of our boxes brought back into a Seedelf (`lovejoin::withdraw`): paid
/// from the box, with giveme.my's collateral and its signature alone.
pub fn withdraw(params: &ProtocolParameters, protocol: &Protocol, leaf: &PoolBox, sk: &blstrs::Scalar, known: &[Resolved]) -> Result<Measured> {
    let destination = Register::create(*sk)?.rerandomize()?;
    let built = lovejoin::withdraw(params, protocol, std::slice::from_ref(leaf), sk, destination)?;
    let mut known = known.to_vec();
    known.push(giveme_collateral()?);
    Ok(Measured {
        kind: "Lovejoin withdraw, 1 box".into(),
        tx: built.tx.tx_bytes.0,
        signers: 1,
        change: None,
        known,
    })
}

/// Everything `numbers` reports, built once.
pub struct Set {
    pub txs: Vec<Measured>,
    /// The chains, by width: deposit then mixes.
    pub chains: Vec<(usize, Vec<Measured>)>,
}

pub fn all(params: &ProtocolParameters) -> Result<Set> {
    let mut txs = Vec::new();
    for k in [1, 2, 5, 10, 20] {
        txs.push(seedelf_send(params, k).with_context(|| format!("Seedelf send of {k}"))?);
    }
    txs.push(seedelf_spend_own_collateral(params)?);
    let (launched, pool) = launch(params, 5_000_000)?;
    txs.push(launched);
    let mut chains = Vec::new();
    for width in [3, 4] {
        let (chain, leaves, sk) = lovejoin_chain(params, &pool, width, 2)?;
        if width == 3 {
            let known = chain.last().map(|m| {
                let mut k = m.known.clone();
                k.extend(eval::resolve_outputs(&m.tx).unwrap_or_default());
                k
            });
            txs.push(withdraw(params, &pool, &leaves[0], &sk, &known.unwrap_or_default())?);
        }
        chains.push((width, chain));
    }
    Ok(Set { txs, chains })
}
