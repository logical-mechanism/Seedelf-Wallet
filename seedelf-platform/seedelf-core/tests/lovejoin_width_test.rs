//! How many boxes one Lovejoin mix can take (its width, N), measured: the
//! numbers behind the wallet's fan-out of three, and what four would need.
//! The write-up is `seedelf-web-wallet/docs/lovejoin-mix-width.md`.
//!
//! The wallet's mix has one shape: N boxes and the one-time account's one fee
//! UTxO in; the N new boxes and its change out; its own collateral; the pool's
//! three reference inputs; `mix_logic`'s zero withdrawal. No fee shard. What it
//! costs is set by N, and a little by where the fee input sorts among the
//! boxes, since each `mix_box` spend pays for its own position.
//!
//! - Offline: N = 2 to 6 on the classic pool, preprod's and mainnet's, and on
//!   the token pool Lovejoin launched on preprod to test PR #163 (the
//!   generalized contracts), each measured with the wallet's evaluator (`uplc`,
//!   which matches the chain exactly) under a limit far past the ledger's, so
//!   the widths the ledger refuses are costed too. The harness here builds the
//!   mix as `lovejoin::mix` does, which the first test checks.
//! - Live (`--ignored`): the same transactions, their synthetic boxes passed
//!   as `additionalUtxo`, measured by each network itself through Koios's
//!   Ogmios, beside the limits the network has today. Nothing is signed or
//!   sent, and nothing costs a lovelace.
//!
//! ```text
//! cargo test -p seedelf-core --test lovejoin_width_test -- --nocapture
//! cargo test -p seedelf-core --test lovejoin_width_test -- --ignored --nocapture
//! ```

use blstrs::{G1Projective, Scalar};
use ff::Field;
use group::Group;
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::conway::{
    CostModels, ExUnits, PlutusData, PseudoDatumOption, Redeemer, RedeemerTag, ScriptRef,
    TransactionOutput,
};
use pallas_primitives::{Fragment, MaybeIndefArray};
use pallas_traverse::{Era, MultiEraOutput, MultiEraTx};
use pallas_txbuilder::{
    BuildConway, BuiltTransaction, Input, Output, ScriptKind, StagingTransaction,
};
use rand_core::{OsRng, RngCore};
use seedelf_core::build::{
    Budget, MAX_TX_BUDGET, MAX_TX_SIZE, fake_signer, linear_fee, reference_script_fee,
};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{self, Coin, Payer, PoolBox, Protocol};
use seedelf_core::transaction::computation_fee;
use seedelf_core::withdraw_zero::WithdrawZero;
use seedelf_crypto::lovejoin as crypto;
use seedelf_koios::koios::ProtocolParameters;
use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};

/// What the ledger lets a transaction use, CPU steps and memory, and a block,
/// CPU steps: what decides how many boxes a mix can take, and how many mixes
/// a block holds.
#[derive(Debug, Clone, Copy)]
struct Limits {
    tx_steps: u64,
    tx_mem: u64,
    block_steps: u64,
}

/// The most the wallet's builder lets a mix use (`MAX_TX_BUDGET`, mainnet's
/// limits), and a block's CPU on both networks, as of 2026-10-16.
const WALLET: Limits = Limits {
    tx_steps: MAX_TX_BUDGET.steps,
    tx_mem: MAX_TX_BUDGET.mem,
    block_steps: 20_000_000_000,
};

impl Limits {
    /// A network's limits as Koios's `epoch_params` lists them.
    fn of(row: &Value) -> Self {
        let get = |key: &str| row[key].as_u64().unwrap_or_else(|| panic!("{key}: {row}"));
        Limits {
            tx_steps: get("max_tx_ex_steps"),
            tx_mem: get("max_tx_ex_mem"),
            block_steps: get("max_block_ex_steps"),
        }
    }

    fn fits(&self, used: Budget) -> bool {
        used.steps <= self.tx_steps && used.mem <= self.tx_mem
    }
}

/// Far past any ledger's limit, so a width the ledger refuses is still costed.
const NO_LIMIT: (u64, u64) = (200_000_000_000, 1_000_000_000);

/// The widths measured.
const WIDTHS: std::ops::RangeInclusive<usize> = 2..=6;

/// `mix_box`'s spend redeemer, the unit `Constr 0 []` (it reads none).
const UNIT: [u8; 3] = [0xd8, 0x79, 0x80];

/// One deployment of Lovejoin's scripts, and what each of its boxes holds.
struct Pool {
    name: &'static str,
    network_flag: bool,
    mix_box_hash: [u8; 28],
    mix_logic_hash: [u8; 28],
    references: Vec<Resolved>,
    script_bytes: u64,
    box_lovelace: u64,
    /// A token pool's token: its policy, its name, and how many a box holds.
    token: Option<([u8; 28], Vec<u8>, u64)>,
    params: ProtocolParameters,
}

fn epoch_params(network_flag: bool) -> Value {
    let rows: Value = if network_flag {
        serde_json::from_str(include_str!("fixtures/epoch_params.json"))
    } else {
        serde_json::from_str(include_str!("fixtures/epoch_params_mainnet.json"))
    }
    .expect("fixture");
    rows[0].clone()
}

fn classic(network_flag: bool) -> Pool {
    let protocol = Protocol::of(network_flag).unwrap();
    Pool {
        name: if network_flag {
            "classic, preprod"
        } else {
            "classic, mainnet"
        },
        network_flag,
        mix_box_hash: protocol.mix_box_hash,
        mix_logic_hash: protocol.mix_logic_hash,
        references: protocol.references,
        script_bytes: protocol.script_bytes,
        box_lovelace: protocol.denom,
        token: None,
        params: ProtocolParameters::from_koios(&epoch_params(network_flag)).unwrap(),
    }
}

/// The script a reference output carries, if any.
fn reference_script(output: &[u8]) -> Option<Vec<u8>> {
    let TransactionOutput::PostAlonzo(output) = minicbor::decode(output).ok()? else {
        return None;
    };
    match output.script_ref?.0 {
        ScriptRef::PlutusV3Script(s) => Some(s.as_ref().to_vec()),
        _ => None,
    }
}

/// Lovejoin's token-pool test launch on preprod, from the transactions that
/// made its three references, each checked by its hash; both scripts are
/// checked against the hashes the launch recorded.
fn token_preprod() -> Pool {
    let doc: Value =
        serde_json::from_str(include_str!("fixtures/lovejoin-token-preprod.json")).unwrap();
    let hash28 = |key: &str| -> [u8; 28] {
        hex::decode(doc[key].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap()
    };
    let references: Vec<Resolved> = doc["txs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tx| {
            let outputs =
                eval::resolve_outputs(&hex::decode(tx["cbor"].as_str().unwrap()).unwrap()).unwrap();
            assert_eq!(
                hex::encode(outputs[0].tx_hash),
                tx["hash"].as_str().unwrap(),
                "the fixture's {} transaction is the one recorded",
                tx["role"]
            );
            outputs[0].clone()
        })
        .collect();
    let (mix_box_hash, mix_logic_hash) = (hash28("mix_box_hash"), hash28("mix_logic_hash"));
    let mut script_bytes = 0;
    for (reference, expected) in references[1..].iter().zip([mix_box_hash, mix_logic_hash]) {
        let script = reference_script(&reference.output).expect("a V3 reference script");
        let mut preimage = vec![0x03];
        preimage.extend(&script);
        assert_eq!(*Hasher::<224>::hash(&preimage), expected);
        script_bytes += script.len() as u64;
    }
    Pool {
        name: "token pool, preprod",
        network_flag: true,
        mix_box_hash,
        mix_logic_hash,
        references,
        script_bytes,
        box_lovelace: doc["box_lovelace"].as_u64().unwrap(),
        token: Some((
            hash28("token_policy"),
            hex::decode(doc["token_name"].as_str().unwrap()).unwrap(),
            doc["token_quantity"].as_str().unwrap().parse().unwrap(),
        )),
        params: ProtocolParameters::from_koios(&epoch_params(true)).unwrap(),
    }
}

impl Pool {
    fn mix_box_address(&self) -> Vec<u8> {
        let mut raw = vec![if self.network_flag { 0x70 } else { 0x71 }];
        raw.extend(self.mix_box_hash);
        raw
    }

    /// `serialise_data` of a box's value, as the mix context takes it: an ADA
    /// box is `{"": {"": lovelace}}`, a token box adds `{policy: {name: Q}}`.
    fn box_value_data(&self) -> Vec<u8> {
        let mut e = minicbor::Encoder::new(Vec::new());
        e.map(1 + u64::from(self.token.is_some())).unwrap();
        e.bytes(&[]).unwrap().map(1).unwrap();
        e.bytes(&[]).unwrap().u64(self.box_lovelace).unwrap();
        if let Some((policy, name, quantity)) = &self.token {
            e.bytes(policy).unwrap().map(1).unwrap();
            e.bytes(name).unwrap().u64(*quantity).unwrap();
        }
        e.into_writer()
    }

    fn box_output(&self, datum: Vec<u8>) -> Output {
        let output = Output::new(
            pallas_addresses::Address::from_bytes(&self.mix_box_address()).unwrap(),
            self.box_lovelace,
        )
        .set_inline_datum(datum);
        match &self.token {
            None => output,
            Some((policy, name, quantity)) => output
                .add_asset(Hash::new(*policy), name.clone(), *quantity)
                .unwrap(),
        }
    }

    fn slot_config(&self) -> (u64, u64, u32) {
        if self.network_flag {
            (1_655_769_600_000, 86_400, 1_000)
        } else {
            (1_596_059_091_000, 4_492_800, 1_000)
        }
    }
}

/// An output's CBOR as the ledger keeps it: `{0: address, 1: value, 2: datum}`.
fn output_cbor(
    address: &[u8],
    lovelace: u64,
    pool_token: Option<&Pool>,
    datum: Option<&[u8]>,
) -> Vec<u8> {
    let token = pool_token.and_then(|p| p.token.as_ref());
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(2 + u64::from(datum.is_some())).unwrap();
    e.u8(0).unwrap().bytes(address).unwrap().u8(1).unwrap();
    match token {
        None => {
            e.u64(lovelace).unwrap();
        }
        Some((policy, name, quantity)) => {
            e.array(2).unwrap().u64(lovelace).unwrap().map(1).unwrap();
            e.bytes(policy).unwrap().map(1).unwrap();
            e.bytes(name).unwrap().u64(*quantity).unwrap();
        }
    }
    if let Some(datum) = datum {
        e.u8(2).unwrap().array(2).unwrap().u8(1).unwrap();
        e.tag(minicbor::data::Tag::new(24))
            .unwrap()
            .bytes(datum)
            .unwrap();
    }
    e.into_writer()
}

/// The one-time account's base address (its own payment and stake keys), as
/// every session's is.
fn session_address(network_flag: bool) -> Vec<u8> {
    let mut raw = vec![if network_flag { 0x00 } else { 0x01 }];
    raw.extend([0x51; 28]);
    raw.extend([0x52; 28]);
    raw
}

fn random_scalar() -> Scalar {
    loop {
        let s = Scalar::random(&mut OsRng);
        if !bool::from(s.is_zero()) {
            return s;
        }
    }
}

/// Where the session's fee input sorts among a mix's inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeeAt {
    First,
    Middle,
    Last,
}

/// What a mix is made of: its boxes (someone's, made up here), the session's
/// fee UTxO and its collateral. All of it is synthetic; only the pool's
/// references are on chain.
struct Inputs {
    boxes: Vec<(Resolved, G1Projective, G1Projective)>,
    fee: Coin,
    fee_at: FeeAt,
    collateral: Coin,
}

/// A box's tx hash starts `0x20 + 0x10·i`, so the boxes sort in order, and the
/// fee input's first byte places it first, between the middle two, or last.
fn inputs(pool: &Pool, n: usize, fee_at: FeeAt) -> Inputs {
    let boxes = (0..n)
        .map(|i| {
            let mut tx_hash = [0u8; 32];
            OsRng.fill_bytes(&mut tx_hash);
            tx_hash[0] = 0x20 + 0x10 * i as u8;
            let a = G1Projective::generator() * random_scalar();
            let b = a * random_scalar();
            let datum =
                lovejoin::mix_datum(&crypto::point_to_bytes(&a), &crypto::point_to_bytes(&b));
            let output = output_cbor(
                &pool.mix_box_address(),
                pool.box_lovelace,
                Some(pool),
                Some(&datum),
            );
            (
                Resolved {
                    tx_hash,
                    index: 0,
                    output,
                },
                a,
                b,
            )
        })
        .collect();
    let first = match fee_at {
        FeeAt::First => 0x01,
        FeeAt::Middle => 0x18 + 0x10 * (n / 2) as u8,
        FeeAt::Last => 0xf0,
    };
    let coin = |first_byte: u8, lovelace: u64| Coin {
        utxo: Resolved {
            tx_hash: [first_byte; 32],
            index: 0,
            output: output_cbor(&session_address(pool.network_flag), lovelace, None, None),
        },
        lovelace,
    };
    Inputs {
        boxes,
        fee: coin(first, 50_000_000),
        fee_at,
        collateral: coin(0xcc, 5_000_000),
    }
}

fn input(utxo: &Resolved) -> Input {
    Input::new(Hash::new(utxo.tx_hash), utxo.index)
}

fn constr(index: u64, fields: Vec<PlutusData>) -> PlutusData {
    PlutusData::Constr(pallas_primitives::Constr {
        tag: 121 + index,
        any_constructor: None,
        fields: MaybeIndefArray::Indef(fields),
    })
}

fn bytes_data(bytes: &[u8]) -> PlutusData {
    PlutusData::BoundedBytes(bytes.to_vec().into())
}

/// What one redeemer used, by purpose and index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Used {
    tag: &'static str,
    index: u32,
    budget: Budget,
}

/// Every script in `tx` measured by the wallet's evaluator, past any limit.
fn measure(pool: &Pool, tx: &[u8], known: &[Resolved]) -> Vec<Used> {
    let decoded = MultiEraTx::decode(tx).unwrap();
    let pairs: Vec<(Vec<u8>, Vec<u8>)> = decoded
        .inputs()
        .iter()
        .chain(decoded.reference_inputs().iter())
        .map(|i| {
            let utxo = known
                .iter()
                .find(|r| r.tx_hash == **i.hash() && r.index == i.index())
                .expect("a known UTxO");
            let mut e = minicbor::Encoder::new(Vec::new());
            e.array(2)
                .unwrap()
                .bytes(&utxo.tx_hash)
                .unwrap()
                .u64(utxo.index)
                .unwrap();
            (e.into_writer(), utxo.output.clone())
        })
        .collect();
    let cost_models = minicbor::to_vec(CostModels {
        plutus_v1: None,
        plutus_v2: None,
        plutus_v3: Some(pool.params.cost_model_v3.clone()),
    })
    .unwrap();
    let results = uplc::tx::eval_phase_two_raw(
        tx,
        &pairs,
        Some(&cost_models),
        NO_LIMIT,
        pool.slot_config(),
        true,
        |_| (),
    )
    .unwrap_or_else(|e| panic!("{}: a script failed: {e}", pool.name));
    let mut used: Vec<Used> = results
        .into_iter()
        .map(|(redeemer, result)| {
            let redeemer: Redeemer = minicbor::decode(&redeemer).unwrap();
            let cost = result.cost();
            Used {
                tag: match redeemer.tag {
                    RedeemerTag::Spend => "spend",
                    RedeemerTag::Reward => "withdraw",
                    _ => "other",
                },
                index: redeemer.index,
                budget: Budget {
                    mem: cost.mem as u64,
                    steps: cost.cpu as u64,
                },
            }
        })
        .collect();
    used.sort_by_key(|u| (u.tag, u.index));
    used
}

/// A mix, built as the wallet builds one, and what it costs.
struct Mix {
    pool: &'static str,
    n: usize,
    fee_at: FeeAt,
    tx: Vec<u8>,
    /// Every UTxO it spends or reads, the made-up ones included.
    known: Vec<Resolved>,
    /// The made-up UTxOs alone, for Ogmios's `additionalUtxo`.
    synthetic: Vec<Resolved>,
    used: Vec<Used>,
    total: Budget,
    size: u64,
    fee: u64,
}

/// `lovejoin::mix`, step for step, for a pool whose box may hold a token:
/// the same inputs, outputs, references, collateral, zero withdrawal and fee.
fn build(pool: &Pool, given: &Inputs) -> Mix {
    let n = given.boxes.len();
    let mut sorted: Vec<&(Resolved, G1Projective, G1Projective)> = given.boxes.iter().collect();
    sorted.sort_by_key(|(u, _, _)| (u.tx_hash, u.index));

    let mut perm: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() {
        perm.swap(i, (OsRng.next_u64() % (i as u64 + 1)) as usize);
    }
    let ys: Vec<Scalar> = (0..n).map(|_| random_scalar()).collect();
    let mut outputs = vec![(G1Projective::identity(), G1Projective::identity()); n];
    for (i, (_, a, b)) in sorted.iter().enumerate() {
        outputs[perm[i]] = (a * ys[i], b * ys[i]);
    }
    let datums: Vec<Vec<u8>> = outputs
        .iter()
        .map(|(a, b)| lovejoin::mix_datum(&crypto::point_to_bytes(a), &crypto::point_to_bytes(b)))
        .collect();
    let mut preimage = datums.concat();
    for _ in 0..n {
        preimage.extend(pool.box_value_data());
    }
    preimage.extend(pool.mix_box_hash);
    let ctx = crypto::blake2b_256(&preimage);
    let proofs = sorted
        .iter()
        .enumerate()
        .map(|(i, (_, a, b))| {
            let branches = crypto::prove_sigma_or(a, b, &outputs, perm[i], &ys[i], &ctx).unwrap();
            constr(
                0,
                vec![PlutusData::Array(MaybeIndefArray::Indef(
                    branches
                        .iter()
                        .map(|br| {
                            constr(
                                0,
                                vec![
                                    bytes_data(&br.t0),
                                    bytes_data(&br.t1),
                                    bytes_data(&br.c),
                                    bytes_data(&br.z),
                                ],
                            )
                        })
                        .collect(),
                ))],
            )
        })
        .collect();
    let redeemer = constr(1, vec![PlutusData::Array(MaybeIndefArray::Indef(proofs))])
        .encode_fragment()
        .unwrap();
    let withdraw = WithdrawZero::new(&pool.mix_logic_hash, pool.network_flag, &redeemer).unwrap();

    let mut all: Vec<Input> = sorted.iter().map(|(u, _, _)| input(u)).collect();
    all.push(input(&given.fee.utxo));
    all.sort_by_key(|i| (i.tx_hash.0, i.txo_index));
    let session =
        pallas_addresses::Address::from_bytes(&session_address(pool.network_flag)).unwrap();
    let draft = Budget {
        mem: 14_000_000,
        steps: 10_000_000_000,
    };
    let stage = |fee: u64, used: Option<&[Used]>| -> BuiltTransaction {
        let budget = |tag: &str, index: usize| {
            used.and_then(|u| u.iter().find(|u| u.tag == tag && u.index as usize == index))
                .map(|u| u.budget)
                .unwrap_or(draft)
        };
        let mut tx = StagingTransaction::new();
        for (utxo, _, _) in &sorted {
            let at = all.iter().position(|i| *i == input(utxo)).unwrap();
            let b = budget("spend", at);
            tx = tx.input(input(utxo)).add_spend_redeemer(
                input(utxo),
                UNIT.to_vec(),
                Some(pallas_txbuilder::ExUnits {
                    mem: b.mem,
                    steps: b.steps,
                }),
            );
        }
        tx = tx.input(input(&given.fee.utxo));
        for datum in &datums {
            tx = tx.output(pool.box_output(datum.clone()));
        }
        tx = tx.output(Output::new(session.clone(), given.fee.lovelace - fee));
        for reference in &pool.references {
            tx = tx.reference_input(input(reference));
        }
        tx = tx
            .collateral_input(input(&given.collateral.utxo))
            .collateral_output(Output::new(
                session.clone(),
                given.collateral.lovelace - (fee * 3 / 2 + 1),
            ))
            .fee(fee)
            .language_view(ScriptKind::PlutusV3, pool.params.cost_model_v3.clone());
        let built = tx.build_conway_raw().unwrap();
        let w = budget("withdraw", 0);
        withdraw
            .patch(
                built,
                ExUnits {
                    mem: w.mem,
                    steps: w.steps,
                },
                &pool.params.cost_model_v3,
            )
            .unwrap()
    };

    let mut known: Vec<Resolved> = given.boxes.iter().map(|(u, _, _)| u.clone()).collect();
    known.push(given.fee.utxo.clone());
    known.push(given.collateral.utxo.clone());
    let synthetic = known.clone();
    known.extend(pool.references.iter().cloned());

    let used = measure(pool, &stage(1_000_000, None).tx_bytes.0, &known);
    let script_fee = reference_script_fee(&pool.params, pool.script_bytes).unwrap();
    // Priced as `lovejoin::mix` prices it: signed by the session's one key.
    let price = |tx: &BuiltTransaction| {
        let size = tx.clone().sign(fake_signer()).unwrap().tx_bytes.0.len() as u64;
        let fee = linear_fee(&pool.params, size)
            + used
                .iter()
                .map(|u| computation_fee(&pool.params, u.budget.mem, u.budget.steps))
                .sum::<u64>()
            + script_fee;
        (size, fee)
    };
    let mut fee = 1_000_000;
    for _ in 0..5 {
        let (_, needed) = price(&stage(fee, Some(&used)));
        if needed <= fee && fee - needed < 1_000 {
            break;
        }
        fee = needed;
    }
    let tx = stage(fee, Some(&used));
    let (size, _) = price(&tx);
    let tx = tx.tx_bytes.0;
    let finished = measure(pool, &tx, &known);
    assert_eq!(finished, used, "a finished mix measures as its draft did");
    let total = used
        .iter()
        .fold(Budget { mem: 0, steps: 0 }, |a, u| Budget {
            mem: a.mem + u.budget.mem,
            steps: a.steps + u.budget.steps,
        });
    Mix {
        pool: pool.name,
        n,
        fee_at: given.fee_at,
        tx,
        known,
        synthetic,
        used,
        total,
        size,
        fee,
    }
}

fn pools() -> Vec<Pool> {
    vec![classic(true), classic(false), token_preprod()]
}

fn percent(part: u64, whole: u64) -> f64 {
    part as f64 * 100.0 / whole as f64
}

impl Mix {
    fn mix_logic(&self) -> Budget {
        self.used
            .iter()
            .find(|u| u.tag == "withdraw")
            .unwrap()
            .budget
    }
}

/// A mix's line of the table, against `limits`.
fn row(mix: &Mix, limits: Limits) -> String {
    let spare = limits.tx_steps as i128 - mix.total.steps as i128;
    format!(
        "{:<20} N={} fee {:<6} | steps {:>14} ({:>6.2}% of {}) spare {:>15} | mix_logic {:>14} | mem {:>9} ({:>5.2}% of {}) | {:>5} B | fee {:.6} ₳ | {} a block",
        mix.pool,
        mix.n,
        format!("{:?}", mix.fee_at),
        mix.total.steps,
        percent(mix.total.steps, limits.tx_steps),
        limits.tx_steps,
        spare,
        mix.mix_logic().steps,
        mix.total.mem,
        percent(mix.total.mem, limits.tx_mem),
        limits.tx_mem,
        mix.size,
        mix.fee as f64 / 1e6,
        limits.block_steps / mix.total.steps,
    )
}

/// Lovejoin's token-pool launch on preprod spent this UTxO: the seed its
/// scripts are derived from.
const LJ_SEED: ([u8; 32], u64) = (
    hex_literal::hex!("5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b"),
    2,
);

/// `lovejoin::mix` of `given`'s boxes in `protocol`'s pool, paid as the
/// harness pays.
fn wallets_mix(pool: &Pool, protocol: &Protocol, given: &Inputs) -> anyhow::Result<lovejoin::Mix> {
    let boxes: Vec<PoolBox> = given
        .boxes
        .iter()
        .map(|(u, _, _)| PoolBox::from_resolved(u.clone(), protocol).unwrap())
        .collect();
    let payer = Payer {
        fee: given.fee.clone(),
        collateral: Some(given.collateral.clone()),
        address: pallas_addresses::Address::from_bytes(&session_address(pool.network_flag))
            .unwrap(),
        signers: 1,
    };
    lovejoin::mix(&pool.params, protocol, &boxes, &payer)
}

/// What `tx` declares each script may use, by purpose and index, in
/// [`measure`]'s order: the budgets the ledger holds it to, which the
/// evaluator never reads (it measures each script on what's left).
fn declared(tx: &[u8]) -> Vec<Used> {
    let mut declared: Vec<Used> = MultiEraTx::decode(tx)
        .unwrap()
        .redeemers()
        .iter()
        .map(|r| Used {
            tag: match r.tag() {
                RedeemerTag::Spend => "spend",
                RedeemerTag::Reward => "withdraw",
                _ => "other",
            },
            index: r.index(),
            budget: Budget {
                mem: r.ex_units().mem,
                steps: r.ex_units().steps,
            },
        })
        .collect();
    declared.sort_by_key(|u| (u.tag, u.index));
    declared
}

/// The harness is the wallet's builder: `lovejoin::mix` given the same boxes
/// and fee input declares the budgets the harness measures, redeemer by
/// redeemer, and pays the same fee for as many bytes. On the classic pools,
/// and on the token pool with its scripts read by reference, as the harness
/// reads them. The wallet reads this pool's inline (they're at a key address,
/// not the holder): then it declares what each of its scripts uses. A test
/// that measured the wallet's transaction again saw what it uses, never what
/// it declares, so budgets staged on the wrong redeemers passed (1.6.0's
/// release review, 312#1).
#[test]
fn the_harness_builds_the_wallets_mix() {
    let token = token_preprod();
    let inline =
        lovejoin::verify_pool(true, &token.references[0], LJ_SEED, &token.references[1..]).unwrap();
    assert_eq!(inline.inline_scripts.len(), 2);
    let by_reference = Protocol {
        references: token.references.clone(),
        inline_scripts: Vec::new(),
        script_bytes: token.script_bytes,
        ..inline.clone()
    };
    let pools = [
        (classic(true), Protocol::of(true).unwrap()),
        (classic(false), Protocol::of(false).unwrap()),
        (token_preprod(), by_reference),
    ];
    for (pool, protocol) in &pools {
        for n in [3, 4] {
            for fee_at in [FeeAt::First, FeeAt::Last] {
                let given = inputs(pool, n, fee_at);
                let ours = build(pool, &given);
                let wallets = wallets_mix(pool, protocol, &given).unwrap();
                let tx = &wallets.tx.tx_bytes.0;
                let at = format!("{} N={n} {fee_at:?}", pool.name);
                assert_eq!(declared(tx), ours.used, "{at}");
                assert_eq!(measure(pool, tx, &ours.known), ours.used, "{at}");
                assert_eq!(wallets.fee, ours.fee, "{at}");
                assert_eq!(tx.len(), ours.tx.len(), "{at}");
            }
        }
    }
    for n in [3, 4] {
        let given = inputs(&token, n, FeeAt::Last);
        let ours = build(&token, &given);
        let wallets = wallets_mix(&token, &inline, &given).unwrap();
        let tx = &wallets.tx.tx_bytes.0;
        assert_eq!(MultiEraTx::decode(tx).unwrap().plutus_v3_scripts().len(), 2);
        assert_eq!(
            declared(tx),
            measure(&token, tx, &ours.known),
            "scripts inline, N={n}"
        );
        assert!(
            WALLET.fits(
                declared(tx)
                    .iter()
                    .fold(Budget { mem: 0, steps: 0 }, |a, u| Budget {
                        mem: a.mem + u.budget.mem,
                        steps: a.steps + u.budget.steps,
                    })
            )
        );
    }
}

/// The wallet's builder refuses a mix the ledger would: five boxes is over.
/// Their `mix_logic` alone runs past the 14 billion steps the wallet's
/// evaluator lets a transaction's scripts use together, so the measure
/// refuses them, before the sum of their budgets is checked (1.6.0's release
/// review, 312#0: the next test reaches that).
#[test]
fn the_wallet_refuses_five_boxes() {
    for flag in [true, false] {
        let pool = classic(flag);
        let protocol = Protocol::of(flag).unwrap();
        let given = inputs(&pool, 5, FeeAt::First);
        let refused = wallets_mix(&pool, &protocol, &given).unwrap_err();
        assert!(
            refused
                .to_string()
                .contains("withdraw 0: execution went over budget"),
            "{refused:#}"
        );
    }
}

/// The wallet's builder refuses a mix whose scripts together need more
/// computation than a transaction may use (`MAX_TX_BUDGET`), though each
/// fits. The network's check of a chain's first mix goes through Ogmios,
/// which gives each script a whole transaction's limit, so this sum is all
/// that stands between such a mix and the node's refusal, and what has a
/// chain four wide fall back to three. Four boxes fit today by about 1%;
/// under a cost model 2% dearer they measure about 10.08 billion steps, past
/// the ledger's 10 billion, though `mix_logic` alone still fits and the
/// wallet's evaluator lets a transaction run 14 billion, so only the sum
/// refuses them, in its own words (1.6.0's release review, 312#0: no test
/// reached it before).
#[test]
fn the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation() {
    for flag in [true, false] {
        let mut pool = classic(flag);
        for cost in &mut pool.params.cost_model_v3 {
            *cost = *cost * 102 / 100;
        }
        let protocol = Protocol::of(flag).unwrap();
        for fee_at in [FeeAt::First, FeeAt::Last] {
            let given = inputs(&pool, 4, fee_at);
            let harness = build(&pool, &given);
            let shown = row(&harness, WALLET);
            assert!(
                harness.used.iter().all(|u| WALLET.fits(u.budget)),
                "{shown}"
            );
            assert!(!WALLET.fits(harness.total), "{shown}");
            assert!(harness.total.steps < 14_000_000_000, "{shown}");
            let refused = wallets_mix(&pool, &protocol, &given).unwrap_err();
            assert!(
                refused.to_string().contains(
                    "Mixing 4 boxes at once needs more computation than a transaction may use"
                ),
                "{shown}: {refused:#}"
            );
        }
    }
}

/// Every width on every pool, with the fee input in each place. Run with
/// `--nocapture` for the table.
#[test]
fn every_width_measured() {
    for pool in pools() {
        for n in WIDTHS {
            let mut worst: Option<Mix> = None;
            for fee_at in [FeeAt::First, FeeAt::Middle, FeeAt::Last] {
                let mix = build(&pool, &inputs(&pool, n, fee_at));
                println!("{}", row(&mix, WALLET));
                if worst
                    .as_ref()
                    .is_none_or(|w| mix.total.steps > w.total.steps)
                {
                    worst = Some(mix);
                }
            }
            let worst = worst.unwrap();
            let shown = row(&worst, WALLET);
            assert_eq!(WALLET.fits(worst.total), n <= 4, "{shown}");
            // Memory is never what binds, nor the size.
            assert!(worst.total.mem < WALLET.tx_mem / 4, "{shown}");
            assert!(worst.size < MAX_TX_SIZE, "{shown}");
            match n {
                // Three leaves about two fifths of a transaction's CPU.
                3 => assert!(
                    percent(worst.total.steps, WALLET.tx_steps) < 60.0,
                    "{shown}"
                ),
                // Four fits, by under two percent.
                4 => assert!(
                    percent(worst.total.steps, WALLET.tx_steps) > 98.0,
                    "{shown}"
                ),
                // Six wouldn't fit a block, let alone a transaction.
                6 => assert!(worst.total.steps > WALLET.block_steps, "{shown}"),
                _ => {}
            }
            println!();
        }
    }
}

/// A UTxO as Ogmios v6 takes it in `additionalUtxo`.
fn ogmios_row(utxo: &Resolved) -> Value {
    let output = MultiEraOutput::decode(Era::Conway, &utxo.output).unwrap();
    let value = output.value();
    let mut amounts = serde_json::Map::new();
    amounts.insert("ada".into(), json!({ "lovelace": value.coin() }));
    for policy in value.assets() {
        let mut names = serde_json::Map::new();
        for asset in policy.assets() {
            names.insert(
                hex::encode(asset.name()),
                json!(asset.output_coin().unwrap_or(0)),
            );
        }
        amounts.insert(hex::encode(policy.policy()), Value::Object(names));
    }
    let mut row = json!({
        "transaction": { "id": hex::encode(utxo.tx_hash) },
        "index": utxo.index,
        "address": output.address().unwrap().to_bech32().unwrap(),
        "value": amounts,
    });
    if let Some(PseudoDatumOption::Data(data)) = output.datum() {
        row["datum"] = json!(hex::encode(data.raw_cbor()));
    }
    row
}

fn koios(network_flag: bool) -> &'static str {
    if network_flag {
        "https://preprod.koios.rest/api/v1"
    } else {
        "https://api.koios.rest/api/v1"
    }
}

fn curl(url: &str, body: Option<&Value>) -> Value {
    let mut args = vec![
        "-sS",
        "--max-time",
        "120",
        "-H",
        "content-type: application/json",
    ];
    if body.is_some() {
        args.extend(["-X", "POST", "--data-binary", "@-"]);
    }
    let mut child = Command::new("curl")
        .args(&args)
        .arg(url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("curl");
    let mut stdin = child.stdin.take().unwrap();
    if let Some(body) = body {
        stdin.write_all(body.to_string().as_bytes()).unwrap();
    }
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("{url}: {}", String::from_utf8_lossy(&out.stdout)))
}

/// The network's own measure of each mix, through Koios's Ogmios: it must be
/// the wallet's, budget for budget, wherever each script fits a transaction's
/// limit; past it, the network refuses. Each line is against the limits the
/// network has as it runs, so after a parameter change it says which widths
/// fit now.
#[test]
#[ignore = "live Koios"]
fn the_network_measures_each_width_as_the_wallet_does() {
    for flag in [true, false] {
        let live = &curl(
            &format!(
                "{}/epoch_params?limit=1&order=epoch_no.desc&select=epoch_no,max_tx_ex_steps,max_tx_ex_mem,max_block_ex_steps,max_block_ex_mem,cost_models",
                koios(flag)
            ),
            None,
        )[0];
        let same_model =
            live["cost_models"]["PlutusV3"] == epoch_params(flag)["cost_models"]["PlutusV3"];
        println!(
            "{}: epoch {}, a transaction {} steps and {} memory, a block {} steps and {} memory; V3 cost model {}",
            if flag { "preprod" } else { "mainnet" },
            live["epoch_no"],
            live["max_tx_ex_steps"],
            live["max_tx_ex_mem"],
            live["max_block_ex_steps"],
            live["max_block_ex_mem"],
            if same_model {
                "as bundled"
            } else {
                "CHANGED since the fixture"
            },
        );
        assert!(same_model, "re-record the epoch_params fixture first");
        let limits = Limits::of(live);
        for pool in pools().into_iter().filter(|p| p.network_flag == flag) {
            for n in WIDTHS {
                let mix = build(&pool, &inputs(&pool, n, FeeAt::First));
                let answer = curl(
                    &format!("{}/ogmios", koios(flag)),
                    Some(&json!({
                        "jsonrpc": "2.0",
                        "method": "evaluateTransaction",
                        "params": {
                            "transaction": { "cbor": hex::encode(&mix.tx) },
                            "additionalUtxo": mix.synthetic.iter().map(ogmios_row).collect::<Vec<_>>(),
                        },
                    })),
                );
                println!("{}", row(&mix, limits));
                // Ogmios gives each script a whole transaction's limit, so it
                // measures a mix whose scripts each fit, even if their sum
                // doesn't; the ledger takes it only if the sum fits too.
                let each_fits = mix.used.iter().all(|u| limits.fits(u.budget));
                if each_fits {
                    let mut theirs: Vec<Used> = answer["result"]
                        .as_array()
                        .unwrap_or_else(|| panic!("{} N={n}: {answer}", pool.name))
                        .iter()
                        .map(|r| Used {
                            tag: if r["validator"]["purpose"] == "spend" {
                                "spend"
                            } else {
                                "withdraw"
                            },
                            index: r["validator"]["index"].as_u64().unwrap() as u32,
                            budget: Budget {
                                mem: r["budget"]["memory"].as_u64().unwrap(),
                                steps: r["budget"]["cpu"].as_u64().unwrap(),
                            },
                        })
                        .collect();
                    theirs.sort_by_key(|u| (u.tag, u.index));
                    assert_eq!(theirs, mix.used, "{} N={n}", pool.name);
                    println!(
                        "    the network measures the same{}",
                        if limits.fits(mix.total) {
                            ", and it fits"
                        } else {
                            ", but the whole is over a transaction's limit"
                        }
                    );
                } else {
                    let error = answer["error"].to_string();
                    assert!(answer["result"].is_null(), "{} N={n}: {answer}", pool.name);
                    println!(
                        "    the network refuses it: {}",
                        &error[..error.len().min(300)]
                    );
                }
            }
        }
        println!();
    }
}
