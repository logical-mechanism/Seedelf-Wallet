//! Against Musashi, through the relay in Docker (`leios-relay`, IOG's
//! `cardano-node-testnet:rc-2026w43`, synced in `~/leios-musashi/data`):
//! its `cardano-cli` queries and submits, and files go through
//! `~/leios-musashi/work`, which the container sees as `/work`. The key, the
//! pool, the Seedelf references and every run's record live in
//! `~/leios-musashi`, never in the repo.
//!
//! Every script transaction is mended for Dijkstra before it's signed
//! ([`crate::dijkstra`]): as core builds them, the node refuses them all.
//!
//! ```text
//! live key                 make the throwaway key (once) and print its address
//! live status              the node's tip, its mempool, the key's ADA
//! live params              the chain's parameters now, against the genesis
//! live decode              the wallet's transactions through the node's own Dijkstra decoder
//! live faucet              ask the faucet once (it wants a person)
//! live split N ADA [N ADA]…  N outputs of ADA each, from the largest UTxO, in one transaction
//!
//! live launch              register mix_logic, then launch an ADA pool of 5 ₳ boxes
//! live deposit N           N boxes into the pool
//! live mixes N W           N mixes of W boxes, independent of each other, sent at once
//! live chain W [all|K] [burst N]
//!                          a chain, W wide, two waves deep, sent whole or K at a
//!                          time as the wallet sends today; a burst of N small
//!                          payments first, to fill the RB ahead of it
//! live chain W [all|K] [burst N] [depth D]
//!                          D waves deep instead (Lovejoin's depth: 1 to 3)
//!
//! live single              one small payment, alone
//! live burst N chained|parallel
//!                          N small payments, each spending the one before's
//!                          change, or each its own 3 ₳ coin (`live split N 3` first)
//!
//! live report              every run recorded, in one table
//!
//! live seedelf-deploy      variant 1's two reference scripts on Musashi
//! live seedelf-fund N ADA  N Seedelf UTxOs of ADA each, under the harness's own Seedelf
//! live seedelf K [chained|parallel] [inputs I]
//!                          K Seedelf spends, each paying 2 ₳ to another Seedelf
//!                          from I UTxOs, each spending the one before's change,
//!                          or each its own; the key's own collateral, as
//!                          giveme.my isn't on Musashi
//! ```

use crate::{dijkstra, measure, params};
use anyhow::{Context, Result, anyhow, bail};
use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::Fragment;
use pallas_primitives::conway::{PseudoDatumOption, ScriptRef, TransactionOutput};
use pallas_txbuilder::{BuildConway, Input, Output, ScriptKind, StagingTransaction};
use rand_core::{OsRng, RngCore};
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{self, Chain, Payment, add_witnesses, linear_fee, tx_id};
use seedelf_core::constants::{Config, Reference, VARIANT, get_config};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{self, Coin, Payer, PoolBox, Protocol, Terms};
use seedelf_core::references;
use seedelf_core::transaction::calculate_min_required_utxo;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse, register_of_datum};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CONTAINER: &str = "leios-relay";
/// What a pool's box holds: any amount but the classic pool's 10 ₳ makes an
/// ADA pool on Lovejoin's generalized scripts.
const BOX_LOVELACE: u64 = 5_000_000;
const COLLATERAL: &str = "5000000";

pub fn run(args: &[String]) -> Result<()> {
    let arg = |i: usize| args.get(i).map(String::as_str);
    let num = |i: usize, what: &str| -> Result<usize> { Ok(arg(i).with_context(|| what.to_string())?.parse()?) };
    match arg(0) {
        Some("key") => key(),
        Some("status") => status(),
        Some("params") => params_check(),
        Some("decode") => decode(),
        Some("faucet") => faucet(),
        Some("split") => {
            let mut groups = Vec::new();
            for i in (1..args.len()).step_by(2) {
                groups.push((num(i, "how many")?, num(i + 1, "how much ADA each")? as u64 * 1_000_000));
            }
            split(&groups)
        }
        Some("launch") => launch(),
        Some("deposit") => deposit(num(1, "how many boxes")?),
        Some("mixes") => mixes(num(1, "how many")?, num(2, "how wide")?),
        Some("chain") => {
            let window = match arg(2) {
                None | Some("all") => usize::MAX,
                Some(k) => k.parse()?,
            };
            let mut burst = 0;
            let mut depth = 2;
            let mut i = 3;
            while let Some(word) = arg(i) {
                match word {
                    "burst" => burst = num(i + 1, "how many")?,
                    "depth" => depth = num(i + 1, "how deep")? as u32,
                    _ => bail!("chain: burst N or depth D"),
                }
                i += 2;
            }
            chain(num(1, "how wide")?, window, burst, depth)
        }
        Some("single") => single(),
        Some("report") => report(),
        Some("burst") => burst(num(1, "how many")?, arg(2) != Some("parallel")),
        Some("seedelf-deploy") => seedelf_deploy(),
        Some("seedelf-fund") => seedelf_fund(num(1, "how many")?, num(2, "how much ADA each")? as u64 * 1_000_000),
        Some("seedelf") => {
            let inputs = if arg(3) == Some("inputs") { num(4, "how many inputs")? } else { 1 };
            seedelf_spends(num(1, "how many")?, arg(2) != Some("parallel"), inputs)
        }
        _ => bail!("live: see src/live.rs for the steps"),
    }
}

// ---------------------------------------------------------------------------
// The node

fn home() -> Result<PathBuf> {
    Ok(PathBuf::from(std::env::var("HOME")?).join("leios-musashi"))
}

/// `cardano-cli` in the relay's container, its answer as text.
fn cli(args: &[&str]) -> Result<String> {
    let out = Command::new("docker")
        .arg("exec")
        .arg(CONTAINER)
        .arg("cardano-cli")
        .args(args)
        .output()
        .context("docker exec")?;
    if !out.status.success() {
        bail!("cardano-cli {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8(out.stdout)?)
}

fn cli_json(args: &[&str]) -> Result<Value> {
    Ok(serde_json::from_str(&cli(args)?)?)
}

/// Whether each of `ids` is in the node's mempool, in one `docker exec`.
fn in_mempool(ids: &[[u8; 32]]) -> Result<Vec<bool>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let script = ids
        .iter()
        .map(|id| format!("cardano-cli query tx-mempool tx-exists {}", hex::encode(id)))
        .collect::<Vec<_>>()
        .join("; ");
    let out = Command::new("docker").args(["exec", CONTAINER, "sh", "-c", &script]).output()?;
    let text = String::from_utf8(out.stdout)?;
    let mut exists: HashMap<String, bool> = HashMap::new();
    for v in serde_json::Deserializer::from_str(&text).into_iter::<Value>() {
        let v = v?;
        exists.insert(v["txId"].as_str().unwrap_or("").to_string(), v["exists"].as_bool().unwrap_or(false));
    }
    ids.iter()
        .map(|id| exists.get(&hex::encode(id)).copied().context("the mempool didn't answer for one"))
        .collect()
}

/// The throwaway key.
struct Key {
    sk: SecretKey,
    /// The secret's bytes, for `cardano-cli`'s own signing-key file.
    raw: [u8; 32],
    hash: Hash<28>,
    address: Address,
}

impl Key {
    fn sign(&self, tx: &[u8]) -> Result<Vec<u8>> {
        sign_with(tx, &[&self.sk])
    }
}

fn sign_with(tx: &[u8], keys: &[&SecretKey]) -> Result<Vec<u8>> {
    let id = tx_id(tx)?;
    let witnesses: Vec<_> = keys.iter().map(|k| (k.public_key(), k.sign(id))).collect();
    add_witnesses(tx, &witnesses)
}

fn key_file() -> Result<PathBuf> {
    Ok(home()?.join("keys").join("payment.skey"))
}

fn write_secret(path: &PathBuf, bytes: &[u8]) -> Result<()> {
    std::fs::create_dir_all(path.parent().expect("a folder"))?;
    std::fs::write(path, hex::encode(bytes))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn load_key() -> Result<Key> {
    let hex_key = std::fs::read_to_string(key_file()?).context("no key yet: `live key` makes one")?;
    let bytes: [u8; 32] = hex::decode(hex_key.trim())?.try_into().map_err(|_| anyhow!("a key is 32 bytes"))?;
    let sk = SecretKey::from(bytes);
    let hash = Hasher::<224>::hash(sk.public_key().as_ref());
    Ok(Key {
        sk,
        raw: bytes,
        hash,
        address: crate::synth::key_address(hash),
    })
}

fn key() -> Result<()> {
    let path = key_file()?;
    if !path.exists() {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        write_secret(&path, &bytes)?;
    }
    println!("{}", load_key()?.address.to_bech32()?);
    Ok(())
}

/// A key nobody holds: where reference scripts sit for good.
fn holder() -> Address {
    crate::synth::key_address(Hasher::<224>::hash(b"seedelf-leios reference holder"))
}

/// Every UTxO at `address`, as Koios rows (what core's builders take).
fn utxos(address: &Address) -> Result<Vec<UtxoResponse>> {
    let bech = address.to_bech32()?;
    let answer = cli_json(&["query", "utxo", "--address", &bech, "--output-json"])?;
    let mut rows = Vec::new();
    for (at, v) in answer.as_object().context("a map of UTxOs")? {
        if !v["referenceScript"].is_null() {
            // The wallet's evaluator refuses a UTxO carrying a script.
            continue;
        }
        let (tx_hash, index) = at.split_once('#').context("txid#index")?;
        let mut assets = Vec::new();
        let mut lovelace = 0;
        for (policy, names) in v["value"].as_object().context("a value")? {
            if policy == "lovelace" {
                lovelace = names.as_u64().context("lovelace")?;
                continue;
            }
            for (name, q) in names.as_object().context("assets")? {
                assets.push(json!({ "policy_id": policy, "asset_name": name, "quantity": q.to_string(), "decimals": 0, "fingerprint": "" }));
            }
        }
        let inline = v["inlineDatumRaw"].as_str().map(|raw| json!({ "bytes": raw, "value": v["inlineDatum"] }));
        rows.push(serde_json::from_value(json!({
            "tx_hash": tx_hash, "tx_index": index.parse::<u64>()?,
            "address": v["address"], "value": lovelace.to_string(),
            "stake_address": null, "payment_cred": payment_cred(address),
            "epoch_no": 0, "block_height": 0, "block_time": 0,
            "datum_hash": null, "inline_datum": inline,
            "reference_script": null, "asset_list": assets, "is_spent": false,
        }))?);
    }
    rows.sort_by_key(|r: &UtxoResponse| std::cmp::Reverse(r.value.parse::<u64>().unwrap_or(0)));
    Ok(rows)
}

fn payment_cred(address: &Address) -> String {
    match address {
        Address::Shelley(s) => hex::encode(s.payment().as_hash().as_ref()),
        _ => String::new(),
    }
}

fn lovelace(row: &UtxoResponse) -> u64 {
    row.value.parse().unwrap_or(0)
}

fn at(row: &UtxoResponse) -> String {
    format!("{}#{}", row.tx_hash, row.tx_index)
}

/// A UTxO this harness made and knows the bytes of, as a Koios row.
fn row_of(r: &Resolved) -> Result<UtxoResponse> {
    let TransactionOutput::PostAlonzo(o) = minicbor::decode::<TransactionOutput>(&r.output)? else {
        bail!("a legacy output");
    };
    let address = Address::from_bytes(&o.address)?;
    let coin = match &o.value {
        pallas_primitives::conway::Value::Coin(c) | pallas_primitives::conway::Value::Multiasset(c, _) => *c,
    };
    let inline = match &o.datum_option {
        Some(PseudoDatumOption::Data(d)) => Some(json!({ "bytes": hex::encode(d.0.encode_fragment().map_err(|e| anyhow!("{e}"))?), "value": null })),
        _ => None,
    };
    let mut row = crate::synth::row(r.tx_hash, r.index, &address, coin, inline);
    row.payment_cred = payment_cred(&address);
    Ok(row)
}

/// The chain's parameters as core's builders take them, read from the node.
fn chain_params() -> Result<ProtocolParameters> {
    let pp = cli_json(&["query", "protocol-parameters"])?;
    let row = json!({
        "min_fee_a": pp["txFeePerByte"], "min_fee_b": pp["txFeeFixed"],
        "coins_per_utxo_size": pp["utxoCostPerByte"].to_string(),
        "key_deposit": pp["stakeAddressDeposit"], "drep_deposit": pp["dRepDeposit"],
        "price_mem": pp["executionUnitPrices"]["priceMemory"],
        "price_step": pp["executionUnitPrices"]["priceSteps"],
        "min_fee_ref_script_cost_per_byte": pp["minFeeRefScriptCostPerByte"],
        "cost_models": {
            "PlutusV1": pp["costModels"]["PlutusV1"],
            "PlutusV2": pp["costModels"]["PlutusV2"],
            "PlutusV3": pp["costModels"]["PlutusV3"],
        },
    });
    ProtocolParameters::from_koios(&row)
}

fn status() -> Result<()> {
    println!("{}", cli(&["query", "tip"])?);
    println!("{}", cli(&["query", "tx-mempool", "info"])?);
    if let Ok(key) = load_key() {
        let rows = utxos(&key.address)?;
        let total: u64 = rows.iter().map(lovelace).sum();
        println!("{}: {} UTxOs, {:.6} ADA", key.address.to_bech32()?, rows.len(), total as f64 / 1e6);
    }
    Ok(())
}

fn params_check() -> Result<()> {
    let pp = cli_json(&["query", "protocol-parameters"])?;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("musashi").join("protocol-parameters.json");
    std::fs::write(&path, serde_json::to_string_pretty(&pp)?)?;
    let genesis = params::musashi()?;
    let now = chain_params()?;
    println!("saved {}", path.display());
    println!(
        "Plutus V3 cost model: {} entries, {} the genesis's (mainnet's)",
        now.cost_model_v3.len(),
        if now.cost_model_v3 == genesis.cost_model_v3 { "the same as" } else { "NOT" }
    );
    for key in [
        "maxBlockBodySize",
        "maxTxSize",
        "maxTxExecutionUnits",
        "maxBlockExecutionUnits",
        "maxEndorserBlockTxsSize",
        "maxEndorserBlockReferencesSize",
        "maxEndorserBlockExecutionUnits",
        "maxRefScriptSizePerEndorserBlock",
        "maxRefScriptSizePerBlock",
        "leiosVotePeriodLength",
        "leiosDiffusionPeriodLength",
        "leiosAnnouncementPeriodLength",
        "refInputsCostPerDatumByte",
        "refInputsCostPerMultiAssetPolicy",
        "protocolVersion",
    ] {
        println!("{key}: {}", pp.get(key).map_or("(not listed)".into(), |v| v.to_string()));
    }
    Ok(())
}

/// Writes `tx` where the container sees it, as a Dijkstra text envelope, and
/// returns that path.
fn put(tx: &[u8], name: &str) -> Result<String> {
    let work = home()?.join("work");
    std::fs::create_dir_all(&work)?;
    let envelope = json!({ "type": "Tx DijkstraEra", "description": "", "cborHex": hex::encode(tx) });
    std::fs::write(work.join(name), serde_json::to_string(&envelope)?)?;
    Ok(format!("/work/{name}"))
}

/// The wallet's transactions through the node's own decoder: as built, then
/// mended.
fn decode() -> Result<()> {
    let p = params::musashi()?;
    let set = measure::all(&p)?;
    let mut rows: Vec<&measure::Measured> = set.txs.iter().collect();
    for (_, chain) in &set.chains {
        rows.extend(chain.iter().take(2));
    }
    let said = |r: Result<String>| r.map_or_else(|e| first_line(&e.to_string()), |id| format!("decodes, {}", id.trim()));
    for m in rows {
        let file = put(&m.tx, "decode.json")?;
        println!("{}", m.kind);
        println!("  as built: {}", said(cli(&["dijkstra", "transaction", "txid", "--tx-file", &file])));
        if let (true, Some(change)) = (m.redeemers() > 0, m.change) {
            let mended = dijkstra::mend(&m.tx, &p, change, m.signers, &m.known)?;
            let file = put(&mended.tx, "decode.json")?;
            println!("  mended:   {}", said(cli(&["dijkstra", "transaction", "txid", "--tx-file", &file])));
        }
    }
    Ok(())
}

fn first_line(s: &str) -> String {
    s.lines().filter(|l| !l.trim().is_empty()).take(3).collect::<Vec<_>>().join(" / ")
}

fn faucet() -> Result<()> {
    let key = load_key()?;
    let url = format!(
        "https://faucet.leios.play.dev.cardano.org/send-money?type=default&address={}",
        key.address.to_bech32()?
    );
    let out = Command::new("curl").args(["-sS", "-m", "60", "-w", "\nHTTP %{http_code}\n", &url]).output()?;
    println!("{}", String::from_utf8_lossy(&out.stdout));
    Ok(())
}

/// Seconds since the epoch.
fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn submit(tx: &[u8], name: &str) -> Result<()> {
    let file = put(tx, &format!("{name}.json"))?;
    cli(&["dijkstra", "transaction", "submit", "--tx-file", &file]).map(|_| ())
}

/// Waits until `tx_hash#index` is on the ledger.
fn wait_for(tx_hash: &[u8; 32], index: u64, most: Duration) -> Result<()> {
    let at = format!("{}#{index}", hex::encode(tx_hash));
    let started = Instant::now();
    while started.elapsed() < most {
        let answer = cli_json(&["query", "utxo", "--tx-in", &at, "--output-json"])?;
        if answer.as_object().is_some_and(|m| !m.is_empty()) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    bail!("{at} isn't on the ledger after {} s", most.as_secs())
}

/// Submits a key-signed transaction and waits for its first output.
fn send_and_wait(tx: &[u8], what: &str) -> Result<[u8; 32]> {
    let id = *tx_id(tx)?;
    submit(tx, &format!("{what}-{}", hex::encode(&id[..4])))?;
    println!("{what} {}: waiting for it", hex::encode(id));
    wait_for(&id, 0, Duration::from_secs(1800))?;
    println!("  on the ledger");
    Ok(id)
}

// ---------------------------------------------------------------------------
// Payments that run no script: nothing for Dijkstra to mend

/// A key-signed payment from `inputs` to `outputs`, the change back to the
/// key, last.
fn pay(key: &Key, p: &ProtocolParameters, inputs: &[UtxoResponse], outputs: &[Output]) -> Result<Vec<u8>> {
    let total: u64 = inputs.iter().map(lovelace).sum();
    let paid: u64 = outputs.iter().map(|o| o.lovelace).sum();
    let stage = |fee: u64| -> Result<Vec<u8>> {
        let mut tx = StagingTransaction::new();
        for r in inputs {
            let hash: [u8; 32] = hex::decode(&r.tx_hash)?.try_into().map_err(|_| anyhow!("a hash"))?;
            tx = tx.input(Input::new(Hash::new(hash), r.tx_index));
        }
        for o in outputs {
            tx = tx.output(o.clone());
        }
        let change = total.checked_sub(paid + fee).context("not enough to pay that")?;
        tx = tx.output(Output::new(key.address.clone(), change)).fee(fee);
        Ok(tx.build_conway_raw().map_err(|e| anyhow!("{e:?}"))?.tx_bytes.0)
    };
    let mut fee = 170_000;
    for _ in 0..5 {
        let needed = linear_fee(p, key.sign(&stage(fee)?)?.len() as u64);
        if needed <= fee {
            break;
        }
        fee = needed;
    }
    key.sign(&stage(fee)?)
}

/// For each `(n, each)`, `n` outputs of `each` lovelace, in one transaction.
fn split(groups: &[(usize, u64)]) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let rows = utxos(&key.address)?;
    let largest = rows.first().context("the key holds nothing yet")?;
    let outputs: Vec<Output> = groups
        .iter()
        .flat_map(|&(n, each)| vec![Output::new(key.address.clone(), each); n])
        .collect();
    send_and_wait(&pay(&key, &p, std::slice::from_ref(largest), &outputs)?, "split")?;
    Ok(())
}

/// The key's UTxOs of exactly `value`, ADA alone.
fn coins_of(key: &Key, value: u64) -> Result<Vec<UtxoResponse>> {
    Ok(utxos(&key.address)?
        .into_iter()
        .filter(|r| lovelace(r) == value && r.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .collect())
}

fn collateral(key: &Key) -> Result<UtxoResponse> {
    utxos(&key.address)?
        .into_iter()
        .find(|r| r.value == COLLATERAL)
        .context("no 5 ₳ UTxO for collateral: `live split 2 5`")
}

/// Fee coins for `n` transactions at once: the key's ADA-only UTxOs of 10 to
/// 100 ₳ (the 40 ₳ split, and what mixes paid back), picked at random, so
/// runs that overlap seldom reach for the same one.
fn fee_coins(key: &Key, n: usize) -> Result<Vec<UtxoResponse>> {
    let mut coins: Vec<UtxoResponse> = utxos(&key.address)?
        .into_iter()
        .filter(|r| (10_000_000..=100_000_000).contains(&lovelace(r)) && r.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .collect();
    for i in (1..coins.len()).rev() {
        coins.swap(i, (OsRng.next_u64() % (i as u64 + 1)) as usize);
    }
    if coins.len() < n {
        bail!("{} coins of 10 to 100 ₳, and {n} are needed: `live split {n} 40`", coins.len());
    }
    Ok(coins.into_iter().take(n).collect())
}

fn single() -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let coin = fee_coins(&key, 1)?;
    let tx = pay(&key, &p, &coin, &[Output::new(key.address.clone(), 2_000_000)])?;
    watch("single", vec![step("payment", tx, Some(0))?], usize::MAX, json!({}))
}

/// `n` small payments to the key itself: each spending the change of the one
/// before (`chained`), or each its own 3 ₳ coin.
fn burst_steps(key: &Key, p: &ProtocolParameters, n: usize, chained: bool) -> Result<Vec<Step>> {
    let mut steps = Vec::with_capacity(n);
    if chained {
        let mut from = utxos(&key.address)?.into_iter().next().context("nothing to pay with")?;
        for i in 0..n {
            let tx = pay(key, p, std::slice::from_ref(&from), &[Output::new(key.address.clone(), 2_000_000)])?;
            let outputs = eval::resolve_outputs(&tx)?;
            from = row_of(&outputs[1])?;
            steps.push(step(&format!("payment {}", i + 1), tx, Some(0))?);
        }
    } else {
        let coins = coins_of(key, 3_000_000)?;
        if coins.len() < n {
            bail!("{} coins of 3 ₳, and {n} are needed: `live split {n} 3`", coins.len());
        }
        for (i, coin) in coins.iter().take(n).enumerate() {
            // 1.5 ₳: a 3 ₳ coin less 2 ₳ and the fee leaves change under the
            // least an output may hold, and the node refuses it.
            let tx = pay(key, p, std::slice::from_ref(coin), &[Output::new(key.address.clone(), 1_500_000)])?;
            steps.push(step(&format!("payment {}", i + 1), tx, Some(0))?);
        }
    }
    Ok(steps)
}

fn burst(n: usize, chained: bool) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let steps = burst_steps(&key, &p, n, chained)?;
    let name = format!("burst-{n}-{}", if chained { "chained" } else { "parallel" });
    watch(&name, steps, usize::MAX, json!({ "chained": chained }))
}

// ---------------------------------------------------------------------------
// Sending and watching

/// One of a run's transactions, signed, and where it went.
struct Step {
    kind: String,
    tx: Vec<u8>,
    id: [u8; 32],
    /// An output of it at the key's address that nothing later in the run
    /// spends: on the ledger once that is. None: watched in the mempool.
    witness: Option<u64>,
    sent: Option<f64>,
    landed: Option<Landing>,
}

fn step(kind: &str, tx: Vec<u8>, witness: Option<u64>) -> Result<Step> {
    Ok(Step {
        kind: kind.to_string(),
        id: *tx_id(&tx)?,
        tx,
        witness,
        sent: None,
        landed: None,
    })
}

#[derive(Debug, Clone)]
struct Landing {
    at: f64,
    slot: u64,
    block: u64,
}

fn node_log() -> Result<PathBuf> {
    Ok(home()?.join("data").join("node.log"))
}

/// The slots of the blocks our node adopted that certified an EB, from what
/// its log gained after `offset` (`Mempool.SwitchedToCertifyingView` names
/// the new tip).
fn certifying_slots(offset: u64) -> Result<HashSet<u64>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(node_log()?)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    Ok(text
        .lines()
        .filter(|l| l.contains("SwitchedToCertifyingView"))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|v| v["data"]["tip"]["slot"].as_u64())
        .collect())
}

/// KleioScan's answer for `path` on Musashi (its db-sync), if it has one.
fn kleio(path: &str) -> Option<Value> {
    let url = format!("https://kleioscan.com/api/musashi{path}");
    let out = Command::new("curl").args(["-sS", "-m", "20", &url]).output().ok()?;
    let v: Value = serde_json::from_slice(&out.stdout).ok()?;
    v.get("error").is_none().then_some(v)
}

/// Where KleioScan puts `id`: its block, its place in it, and whether that
/// block certified an EB (so the transaction was in the EB: a certifying
/// RB carries none of its own). Waits up to two minutes for it to index.
fn kleio_landing(id: &[u8; 32], blocks: &mut HashMap<String, bool>) -> Option<(u64, u64, bool)> {
    for _ in 0..24 {
        if let Some(tx) = kleio(&format!("/txs/{}", hex::encode(id))) {
            let hash = tx["block_hash"].as_str()?.to_string();
            let certifies = match blocks.get(&hash) {
                Some(c) => *c,
                None => {
                    let c = kleio(&format!("/blocks/{hash}"))?["has_leios_cert"].as_bool()?;
                    blocks.insert(hash, c);
                    c
                }
            };
            return Some((tx["block_no"].as_u64()?, tx["block_index"].as_u64()?, certifies));
        }
        std::thread::sleep(Duration::from_secs(5));
    }
    None
}

/// The most of a run looked up on KleioScan: its API is public, so a burst is
/// sampled.
const KLEIO_MOST: usize = 40;

/// Sends `steps` in order, at most `window` in flight, as soon as each is
/// taken; watches each onto the ledger; then says where each landed, and
/// records the run in `~/leios-musashi/runs`.
fn watch(name: &str, mut steps: Vec<Step>, window: usize, notes: Value) -> Result<()> {
    let key = load_key()?;
    println!(
        "{name}: {} transactions, built and signed; sending {}",
        steps.len(),
        if window == usize::MAX { "all at once".to_string() } else { format!("{window} at a time") }
    );
    let started = now();
    let log_offset = std::fs::metadata(node_log()?)?.len();
    let deadline = Instant::now() + Duration::from_secs(3600);
    let mut refused: Vec<Value> = Vec::new();
    let tip_now = || -> Result<Landing> {
        let tip = cli_json(&["query", "tip"])?;
        Ok(Landing {
            at: now(),
            slot: tip["slot"].as_u64().unwrap_or(0),
            block: tip["block"].as_u64().unwrap_or(0),
        })
    };
    loop {
        // What's on the ledger since the last look landed in a block adopted
        // since; the tip read after the look is that block, or one after it
        // (one read before can miss a block adopted in between).
        let pending: Vec<usize> = (0..steps.len()).filter(|&i| steps[i].sent.is_some() && steps[i].landed.is_none()).collect();
        if !pending.is_empty() {
            let on_ledger: HashSet<String> = if pending.iter().any(|&i| steps[i].witness.is_some()) {
                utxos(&key.address)?.iter().map(at).collect()
            } else {
                HashSet::new()
            };
            let watched: Vec<usize> = pending.iter().copied().filter(|&i| steps[i].witness.is_none()).collect();
            let in_pool = in_mempool(&watched.iter().map(|&i| steps[i].id).collect::<Vec<_>>())?;
            let here = tip_now()?;
            let mut landed_now = 0;
            for &i in &pending {
                let s = &mut steps[i];
                let landed = match s.witness {
                    Some(ix) => on_ledger.contains(&format!("{}#{ix}", hex::encode(s.id))),
                    None => !in_pool[watched.iter().position(|&w| w == i).expect("watched")],
                };
                if landed {
                    s.landed = Some(here.clone());
                    landed_now += 1;
                }
            }
            if landed_now > 0 {
                println!("  t+{:.0}s block {} (slot {}): {landed_now} on the ledger", here.at - started, here.block, here.slot);
            }
        }
        let flying = steps.iter().filter(|s| s.sent.is_some() && s.landed.is_none()).count();
        let mut room = window.saturating_sub(flying);
        let mut sent_now = 0;
        for s in steps.iter_mut().filter(|s| s.sent.is_none()) {
            if room == 0 {
                break;
            }
            match submit(&s.tx, &format!("{name}-{}", hex::encode(&s.id[..4]))) {
                Ok(()) => {
                    s.sent = Some(now());
                    room -= 1;
                    sent_now += 1;
                }
                Err(e) => {
                    // A full mempool, most likely: try again next look. The
                    // same refusal ten times over is the transaction's own.
                    let why = first_line(&e.to_string());
                    let again = refused.iter().filter(|r| r["kind"] == json!(s.kind)).count();
                    if again >= 10 {
                        bail!("{} is refused, ten times over: {why}", s.kind);
                    }
                    refused.push(json!({ "kind": s.kind, "at": now() - started, "why": why }));
                    break;
                }
            }
        }
        if sent_now > 0 {
            println!("  t+{:.0}s sent {sent_now}", now() - started);
        }
        if steps.iter().all(|s| s.landed.is_some()) {
            break;
        }
        if Instant::now() > deadline {
            bail!("{name} isn't all on the ledger after an hour");
        }
        std::thread::sleep(Duration::from_millis(700));
    }

    let certifying = certifying_slots(log_offset)?;
    let every = (steps.len() / KLEIO_MOST).max(1);
    let mut blocks = HashMap::new();
    let mut record = Vec::new();
    let mut by_block: Vec<(u64, u64, usize, usize)> = Vec::new();
    for (i, s) in steps.iter().enumerate() {
        let l = s.landed.as_ref().expect("landed");
        let via_eb = certifying.contains(&l.slot);
        let kleio = (i % every == 0 || i + 1 == steps.len()).then(|| kleio_landing(&s.id, &mut blocks)).flatten();
        match by_block.iter_mut().find(|b| b.0 == l.block) {
            Some(b) => {
                if via_eb { b.3 += 1 } else { b.2 += 1 }
            }
            None => by_block.push((l.block, l.slot, usize::from(!via_eb), usize::from(via_eb))),
        }
        record.push(json!({
            "kind": s.kind, "id": hex::encode(s.id), "size": s.tx.len(),
            "sent": s.sent.map(|t| t - started), "landed": l.at - started,
            "block": l.block, "slot": l.slot, "via": if via_eb { "certified EB" } else { "RB" },
            "kleio": kleio.map(|(b, i, c)| json!({ "block": b, "index": i, "certified_eb": c })),
        }));
    }
    if steps.len() <= 12 {
        println!("\n| Tx | Sent (s) | On the ledger (s) | Block | Our node says | KleioScan says |");
        println!("|---|---:|---:|---:|---|---|");
        for r in &record {
            let kleio_says = match &r["kleio"] {
                Value::Null => "-".to_string(),
                k => format!(
                    "{} (block {}, #{})",
                    if k["certified_eb"].as_bool() == Some(true) { "certified EB" } else { "RB" },
                    k["block"],
                    k["index"]
                ),
            };
            println!(
                "| {} | {:.1} | {:.1} | {} | {} | {kleio_says} |",
                r["kind"].as_str().unwrap_or(""),
                r["sent"].as_f64().unwrap_or(0.0),
                r["landed"].as_f64().unwrap_or(0.0),
                r["block"],
                r["via"].as_str().unwrap_or("")
            );
        }
    }
    println!("\n| Block | Slot | In its RB | In its certified EB |");
    println!("|---:|---:|---:|---:|");
    for (block, slot, rb, eb) in &by_block {
        println!("| {block} | {slot} | {rb} | {eb} |");
    }
    let disagree = record
        .iter()
        .filter(|r| !r["kleio"].is_null() && (r["kleio"]["certified_eb"].as_bool() == Some(true)) != (r["via"] == "certified EB"))
        .count();
    let last = record.last().and_then(|r| r["landed"].as_f64()).unwrap_or(0.0);
    println!(
        "\nall {} on the ledger after {last:.0} s, across {} blocks; KleioScan disagrees with our node on {disagree}; {} sends refused and tried again",
        steps.len(),
        by_block.len(),
        refused.len()
    );
    let runs = home()?.join("runs");
    std::fs::create_dir_all(&runs)?;
    let file = runs.join(format!("{}-{name}.json", started as u64));
    std::fs::write(
        &file,
        serde_json::to_string_pretty(&json!({ "name": name, "started": started, "window": if window == usize::MAX { Value::Null } else { json!(window) }, "notes": notes, "refused": refused, "txs": record }))?,
    )?;
    println!("recorded in {}", file.display());
    Ok(())
}

// ---------------------------------------------------------------------------
// Lovejoin

/// The pool this harness launched, rebuilt from its launch's own bytes.
fn pool() -> Result<Protocol> {
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(home()?.join("pool.json")).context("no pool yet: `live launch`")?)?;
    let tx = hex::decode(saved["tx"].as_str().context("tx")?)?;
    let seed_hash: [u8; 32] = hex::decode(saved["seed"].as_str().context("seed")?)?.try_into().map_err(|_| anyhow!("seed"))?;
    lovejoin::launched_pool(true, &tx, (seed_hash, saved["seed_index"].as_u64().context("seed index")?))
}

fn launch() -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let ada_alone = |rows: Vec<UtxoResponse>| -> Vec<UtxoResponse> {
        rows.into_iter().filter(|r| r.asset_list.as_ref().is_none_or(|a| a.is_empty())).collect()
    };
    let rows = ada_alone(utxos(&key.address)?);
    let collateral = collateral(&key)?;
    let chain = measure::chain(&p)?;
    let terms = Terms {
        token: None,
        box_lovelace: BOX_LOVELACE,
        max_fee: 1_000_000,
    };
    // The launch as core builds it, for its seed and its scripts. Core
    // registers `mix_logic` with Shelley's certificate 0, which Dijkstra
    // decodes no more ("Certificates without deposits are no longer
    // supported"), so it's registered first, on its own, with Conway's
    // certificate 7 and the publish redeemer that certificate needs the
    // script's witness for: Lovejoin's `mix_logic` allows RegisterCredential.
    let dry = lovejoin::launch_from_account(&chain, &rows, Some(&collateral), &terms, true, &key.address, None)?;
    let seed = dry.seed;
    register_script(&key, &dry.derived.mix_logic, seed, &rows, &collateral, p.key_deposit)?;

    let rows = ada_alone(utxos(&key.address)?);
    let built = lovejoin::launch_from_account(&chain, &rows, Some(&collateral), &terms, false, &key.address, None)?;
    if built.seed != seed {
        bail!("the launch would spend another seed now: run it again");
    }
    let known: Vec<Resolved> = rows.iter().map(eval::resolve_row).collect::<Result<_>>()?;
    let finished = built.measure_locally()?;
    let tx = finished.tx.tx_bytes.0;
    let outputs = eval::resolve_outputs(&tx)?.len();
    let mended = dijkstra::mend(&tx, &p, outputs - 1, 1, &known)?;
    let signed = key.sign(&mended.tx)?;
    send_and_wait(&signed, "launch")?;
    let pool = lovejoin::launched_pool(true, &signed, seed)?;
    std::fs::write(
        home()?.join("pool.json"),
        serde_json::to_string_pretty(&json!({
            "tx": hex::encode(&signed), "seed": hex::encode(seed.0), "seed_index": seed.1,
            "mix_box": hex::encode(pool.mix_box_hash), "mix_logic": hex::encode(pool.mix_logic_hash),
            "id": hex::encode(pool.id),
        }))?,
    )?;
    println!("pool {}: mix_box {}", hex::encode(pool.id), hex::encode(pool.mix_box_hash));
    Ok(())
}

/// Registers `script`'s stake credential with certificate 7 (a deposit, and
/// the script's own witness, its publish redeemer), built by the node's
/// `cardano-cli`, paid from a UTxO that isn't the launch's `seed`.
fn register_script(
    key: &Key,
    script: &lovejoin::templates::Script,
    seed: ([u8; 32], u64),
    rows: &[UtxoResponse],
    collateral: &UtxoResponse,
    deposit: u64,
) -> Result<()> {
    let work = home()?.join("work");
    let mut wrapped = minicbor::Encoder::new(Vec::new());
    wrapped.bytes(&script.cbor)?;
    let envelope = json!({ "type": "PlutusScriptV3", "description": "", "cborHex": hex::encode(wrapped.into_writer()) });
    std::fs::write(work.join("mix_logic.plutus"), serde_json::to_string(&envelope)?)?;
    let hash = cli(&["hash", "script", "--script-file", "/work/mix_logic.plutus"])?;
    if hash.trim() != hex::encode(script.hash) {
        bail!("the node hashes mix_logic as {}, the wallet as {}", hash.trim(), hex::encode(script.hash));
    }
    let deposit = deposit.to_string();
    cli(&[
        "dijkstra", "stake-address", "registration-certificate",
        "--stake-script-file", "/work/mix_logic.plutus",
        "--key-reg-deposit-amt", &deposit,
        "--out-file", "/work/register.cert",
    ])?;
    let seed_at = format!("{}#{}", hex::encode(seed.0), seed.1);
    let pay = rows
        .iter()
        .rev()
        .find(|r| at(r) != seed_at && at(r) != at(collateral) && lovelace(r) >= 10_000_000)
        .context("no UTxO of 10 ₳ or more besides the seed and the collateral")?;
    let address = key.address.to_bech32()?;
    let (pay_at, col_at) = (at(pay), at(collateral));
    cli(&[
        "dijkstra", "transaction", "build",
        "--tx-in", &pay_at,
        "--tx-in-collateral", &col_at,
        "--certificate-file", "/work/register.cert",
        "--certificate-script-file", "/work/mix_logic.plutus",
        "--certificate-redeemer-value", "0",
        "--change-address", &address,
        "--out-file", "/work/register.body",
    ])?;
    let skey = json!({ "type": "PaymentSigningKeyShelley_ed25519", "description": "", "cborHex": format!("5820{}", hex::encode(key.raw)) });
    std::fs::write(work.join("payment.skey.json"), serde_json::to_string(&skey)?)?;
    let signed = cli(&[
        "dijkstra", "transaction", "sign",
        "--tx-body-file", "/work/register.body",
        "--signing-key-file", "/work/payment.skey.json",
        "--out-file", "/work/register.signed",
    ]);
    let _ = std::fs::remove_file(work.join("payment.skey.json"));
    signed?;
    cli(&["dijkstra", "transaction", "submit", "--tx-file", "/work/register.signed"])?;
    let id: Value = serde_json::from_str(&cli(&["dijkstra", "transaction", "txid", "--tx-file", "/work/register.signed"])?)?;
    let id: [u8; 32] = hex::decode(id["txhash"].as_str().context("txhash")?)?.try_into().map_err(|_| anyhow!("a hash"))?;
    println!("mix_logic's registration {}: waiting for it", hex::encode(id));
    wait_for(&id, 0, Duration::from_secs(1800))?;
    Ok(())
}

/// The pool's boxes on the ledger now, in a random order.
fn boxes(pool: &Protocol) -> Result<Vec<PoolBox>> {
    let rows = utxos(&pool.mix_box_address())?;
    let mut boxes: Vec<PoolBox> = rows.iter().filter_map(|r| PoolBox::from_row(r, pool)).collect();
    for i in (1..boxes.len()).rev() {
        boxes.swap(i, (OsRng.next_u64() % (i as u64 + 1)) as usize);
    }
    Ok(boxes)
}

fn deposit(n: usize) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let pool = pool()?;
    let coin = Coin::from_row(utxos(&key.address)?.first().context("nothing to pay with")?)?;
    // The pool's other boxes: nobody's, as far as a mix can tell.
    let owners = (0..n)
        .map(|_| Register::create(schnorr::random_scalar())?.rerandomize())
        .collect::<Result<Vec<_>>>()?;
    let made = lovejoin::deposit(&p, &pool, &[coin], &owners, &key.address, 1)?;
    send_and_wait(&key.sign(&made.tx.tx_bytes.0)?, "deposit")?;
    println!("the pool holds {} boxes", boxes(&pool)?.len());
    Ok(())
}

/// A mix of `inputs`, paid from `fee` by the key, mended and signed: its
/// boxes and its change.
fn mix_step(key: &Key, p: &ProtocolParameters, pool: &Protocol, inputs: &[PoolBox], fee: &Coin, collateral: &Coin) -> Result<(Vec<u8>, Vec<PoolBox>, Coin)> {
    let width = inputs.len();
    let payer = Payer {
        fee: fee.clone(),
        collateral: Some(collateral.clone()),
        address: key.address.clone(),
        signers: 1,
    };
    let mixed = lovejoin::mix(p, pool, inputs, &payer)?;
    let mut known: Vec<Resolved> = inputs.iter().map(|b| b.utxo.clone()).collect();
    known.push(fee.utxo.clone());
    known.push(collateral.utxo.clone());
    known.extend(pool.references.iter().cloned());
    let mended = dijkstra::mend(&mixed.tx.tx_bytes.0, p, width, 1, &known)?;
    let signed = key.sign(&mended.tx)?;
    let outputs = eval::resolve_outputs(&signed)?;
    let boxes = outputs
        .iter()
        .take(width)
        .map(|o| PoolBox::from_resolved(o.clone(), pool).context("a mixed box"))
        .collect::<Result<Vec<_>>>()?;
    let change = Coin {
        lovelace: mixed.change.lovelace - (mended.fee_after - mended.fee_before),
        utxo: outputs[width].clone(),
    };
    Ok((signed, boxes, change))
}

fn mixes(n: usize, width: usize) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let pool = pool()?;
    let collateral = Coin::from_row(&collateral(&key)?)?;
    let coins = fee_coins(&key, n)?;
    let mut fresh = boxes(&pool)?;
    if fresh.len() < n * width {
        bail!("the pool holds {} boxes; {n} mixes {width} wide take {}: `live deposit`", fresh.len(), n * width);
    }
    let mut steps = Vec::new();
    for (i, coin) in coins.iter().enumerate() {
        let inputs: Vec<PoolBox> = fresh.drain(..width).collect();
        let (tx, _, _) = mix_step(&key, &p, &pool, &inputs, &Coin::from_row(coin)?, &collateral)?;
        steps.push(step(&format!("mix {}", i + 1), tx, Some(width as u64))?);
    }
    watch(&format!("mixes-{n}-w{width}"), steps, usize::MAX, json!({ "width": width }))
}

/// A chain built as `lovejoin::chain_across` builds one, a mix at a time, each
/// mended for Dijkstra before the next is built on its real outputs: a mend
/// changes the transaction's id, and the next spends by id.
fn chain_steps(key: &Key, p: &ProtocolParameters, pool: &Protocol, width: usize, depth: u32, fee_row: &UtxoResponse) -> Result<Vec<Step>> {
    let collateral = Coin::from_row(&collateral(key)?)?;
    let mut fresh = boxes(pool)?;
    // Each mix draws width − 1 others: (width^depth − 1) of them in all.
    let needed = width.pow(depth) - 1;
    if fresh.len() < needed {
        bail!("the pool holds {} boxes; a {width}-wide chain {depth} deep draws {needed}: `live deposit`", fresh.len());
    }
    let owner = Register::create(schnorr::random_scalar())?.rerandomize()?;
    let made = lovejoin::deposit(p, pool, &[Coin::from_row(fee_row)?], std::slice::from_ref(&owner), &key.address, 1)?;
    let deposit = key.sign(&made.tx.tx_bytes.0)?;
    let deposited = eval::resolve_outputs(&deposit)?;
    let mut change = Coin {
        lovelace: made.change.lovelace,
        utxo: deposited.last().context("change")?.clone(),
    };
    let mut steps = vec![step("deposit", deposit.clone(), None)?];
    let mut wave = vec![PoolBox::from_resolved(deposited[0].clone(), pool).context("our box")?];
    for _ in 0..depth {
        let mut next = Vec::new();
        for ours in &wave {
            let mut inputs = vec![ours.clone()];
            inputs.extend(fresh.drain(..width - 1));
            let (tx, boxes, paid) = mix_step(key, p, pool, &inputs, &change, &collateral)?;
            next.extend(boxes);
            change = paid;
            steps.push(step(&format!("mix {}", steps.len()), tx, None)?);
        }
        wave = next;
    }
    // The last mix's change stays.
    if let Some(last) = steps.last_mut() {
        last.witness = Some(width as u64);
    }
    Ok(steps)
}

fn chain(width: usize, window: usize, burst_n: usize, depth: u32) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let pool = pool()?;
    let fee_row = fee_coins(&key, 1)?.remove(0);
    let mut steps = Vec::new();
    if burst_n > 0 {
        // From the largest UTxO, never the chain's own coin.
        steps.extend(burst_steps(&key, &p, burst_n, true)?);
    }
    steps.extend(chain_steps(&key, &p, &pool, width, depth, &fee_row)?);
    let name = format!(
        "chain-w{width}-{}{}{}",
        if window == usize::MAX { "all".into() } else { format!("k{window}") },
        if burst_n > 0 { format!("-burst{burst_n}") } else { String::new() },
        if depth != 2 { format!("-depth{depth}") } else { String::new() }
    );
    // The window is the chain's: a burst ahead of it goes whole.
    let window = if window == usize::MAX { window } else { window + burst_n };
    watch(&name, steps, window, json!({ "width": width, "burst": burst_n, "depth": depth }))
}

// ---------------------------------------------------------------------------
// Seedelf

/// Variant 1's scripts at the references this harness put on Musashi: the
/// same hashes as mainnet's and preprod's, at their own UTxOs.
fn seedelf_chain(p: &ProtocolParameters) -> Result<(Chain, Vec<Resolved>)> {
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(home()?.join("seedelf.json")).context("no references yet: `live seedelf-deploy`")?)?;
    let mut refs = Vec::new();
    let mut hashes = Vec::new();
    for role in ["wallet", "seedelf"] {
        let tx = hex::decode(saved[role].as_str().context(role)?)?;
        let outputs = eval::resolve_outputs(&tx)?;
        hashes.push(outputs[1].tx_hash);
        refs.push(outputs[1].clone());
    }
    let contract = get_config(VARIANT, true)?.contract;
    let config = Config {
        contract,
        reference: Reference {
            wallet_reference_utxo: hashes[0],
            seedelf_reference_utxo: hashes[1],
        },
    };
    Ok((
        Chain {
            params: p.clone(),
            network_flag: true,
            config,
        },
        refs,
    ))
}

/// The script a bundled reference output carries.
fn reference_script(output_hex: &str) -> Result<Vec<u8>> {
    let TransactionOutput::PostAlonzo(o) = minicbor::decode::<TransactionOutput>(&hex::decode(output_hex)?)? else {
        bail!("a legacy output");
    };
    match o.script_ref.context("no script")?.0 {
        ScriptRef::PlutusV3Script(s) => Ok(s.as_ref().to_vec()),
        _ => bail!("not a V3 script"),
    }
}

fn seedelf_deploy() -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let mut saved = json!({});
    for (role, output) in [("wallet", references::PREPROD_WALLET), ("seedelf", references::PREPROD_SEEDELF)] {
        let script = reference_script(output)?;
        let reference = Output::new(holder(), 0).set_inline_script(ScriptKind::PlutusV3, script.clone());
        let least = calculate_min_required_utxo(reference.clone(), &p)? + 1_000_000;
        let reference = Output::new(holder(), least).set_inline_script(ScriptKind::PlutusV3, script);
        // Core reads each at index 1.
        let from = fee_coins(&key, 1)?;
        let tx = pay(&key, &p, &from, &[Output::new(key.address.clone(), 2_000_000), reference])?;
        send_and_wait(&tx, &format!("seedelf-{role}-reference"))?;
        saved[role] = json!(hex::encode(&tx));
    }
    std::fs::write(home()?.join("seedelf.json"), serde_json::to_string_pretty(&saved)?)?;
    let (chain, _) = seedelf_chain(&p)?;
    println!(
        "references at {} and {}",
        hex::encode(chain.config.reference.wallet_reference_utxo),
        hex::encode(chain.config.reference.seedelf_reference_utxo)
    );
    Ok(())
}

/// The harness's own Seedelf key: a scalar, kept beside the payment key.
fn seedelf_sk() -> Result<Scalar> {
    let path = home()?.join("keys").join("seedelf.sk");
    if !path.exists() {
        write_secret(&path, &schnorr::random_scalar().to_bytes_be())?;
    }
    let bytes: [u8; 32] = hex::decode(std::fs::read_to_string(&path)?.trim())?.try_into().map_err(|_| anyhow!("32 bytes"))?;
    Option::from(Scalar::from_bytes_be(&bytes)).context("not a scalar")
}

fn seedelf_fund(n: usize, each: u64) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let owner = Register::create(seedelf_sk()?)?;
    let contract = wallet_contract(true, get_config(VARIANT, true)?.contract.wallet_contract_hash);
    let outputs = (0..n)
        .map(|_| Ok(Output::new(contract.clone(), each).set_inline_datum(owner.clone().rerandomize()?.to_vec()?)))
        .collect::<Result<Vec<_>>>()?;
    let from = utxos(&key.address)?.into_iter().next().context("nothing to pay with")?;
    send_and_wait(&pay(&key, &p, &[from], &outputs)?, "seedelf-fund")?;
    println!("the Seedelf holds {} UTxOs", seedelf_rows()?.len());
    Ok(())
}

/// The harness's Seedelf UTxOs on the ledger.
fn seedelf_rows() -> Result<Vec<UtxoResponse>> {
    let sk = seedelf_sk()?;
    let contract = wallet_contract(true, get_config(VARIANT, true)?.contract.wallet_contract_hash);
    Ok(utxos(&contract)?
        .into_iter()
        .filter(|r| {
            r.inline_datum
                .as_ref()
                .and_then(|d| hex::decode(&d.bytes).ok())
                .and_then(|b| register_of_datum(&b))
                .is_some_and(|reg| reg.is_owned(sk).unwrap_or(false))
        })
        .collect())
}

/// A Seedelf spend of `inputs` paying 2 ₳ to another Seedelf, the change back
/// under fresh registers, the key's own collateral, mended and signed by the
/// one-time key and the key: the transaction and its change.
fn seedelf_step(key: &Key, chain: &Chain, refs: &[Resolved], inputs: &[UtxoResponse], known: &[Resolved], collateral: &UtxoResponse) -> Result<(Vec<u8>, UtxoResponse)> {
    let sk = seedelf_sk()?;
    let owner = Register::create(sk)?;
    let one_time = SecretKey::new(OsRng);
    let signer = Hasher::<224>::hash(one_time.public_key().as_ref());
    let payment = Payment {
        register: Register::create(schnorr::random_scalar())?,
        lovelace: 2_000_000,
        tokens: Default::default(),
    };
    let mut all_known = known.to_vec();
    all_known.extend(refs.iter().cloned());
    let built = build::transfer_from(chain, inputs, &[payment], &owner, signer)?
        .with_account(key.hash, &[], collateral)?
        .proven(|register, vkh| schnorr::create_proof(register.clone(), sk, vkh.to_string()))?
        .measure_locally(&all_known)?;
    let tx = built.tx.tx_bytes.0;
    // What the mend needs to see: every input, reference and collateral.
    all_known.extend(inputs.iter().map(eval::resolve_row).collect::<Result<Vec<_>>>()?);
    all_known.push(eval::resolve_row(collateral)?);
    let change_at = seedelf_change(&tx, sk)?;
    let mended = dijkstra::mend(&tx, &chain.params, change_at, 2, &all_known)?;
    let signed = sign_with(&mended.tx, &[&one_time, &key.sk])?;
    let outputs = eval::resolve_outputs(&signed)?;
    Ok((signed.clone(), row_of(&outputs[seedelf_change(&signed, sk)?])?))
}

fn seedelf_change(tx: &[u8], sk: Scalar) -> Result<usize> {
    for (i, o) in eval::resolve_outputs(tx)?.iter().enumerate() {
        let Ok(TransactionOutput::PostAlonzo(o)) = minicbor::decode::<TransactionOutput>(&o.output) else { continue };
        let Some(PseudoDatumOption::Data(d)) = &o.datum_option else { continue };
        let bytes = d.0.encode_fragment().map_err(|e| anyhow!("{e}"))?;
        if register_of_datum(&bytes).is_some_and(|r| r.is_owned(sk).unwrap_or(false)) {
            return Ok(i);
        }
    }
    bail!("no change back to the Seedelf")
}

fn seedelf_spends(k: usize, chained: bool, per: usize) -> Result<()> {
    let key = load_key()?;
    let p = chain_params()?;
    let (chain, refs) = seedelf_chain(&p)?;
    let collateral = collateral(&key)?;
    let mut rows = seedelf_rows()?;
    let needed = if chained { per } else { k * per };
    if rows.len() < needed {
        bail!("the Seedelf holds {} UTxOs, and {needed} are needed: `live seedelf-fund`", rows.len());
    }
    let mut steps = Vec::new();
    let mut known = Vec::new();
    let mut carried: Option<UtxoResponse> = None;
    for i in 0..k {
        let inputs: Vec<UtxoResponse> = match (&carried, chained) {
            // Each spends the change before it, and nothing else.
            (Some(c), true) => vec![c.clone()],
            _ => rows.drain(..per).collect(),
        };
        let (tx, change) = seedelf_step(&key, &chain, &refs, &inputs, &known, &collateral)?;
        known.extend(eval::resolve_outputs(&tx)?);
        carried = Some(change);
        // A spend's change is at the contract, not the key: watched in the
        // mempool, but for an unchained spend's, which stays.
        steps.push(step(&format!("Seedelf spend {}", i + 1), tx, None)?);
    }
    let name = format!("seedelf-{k}-{}-in{per}", if chained { "chained" } else { "parallel" });
    watch(&name, steps, usize::MAX, json!({ "chained": chained, "inputs": per }))
}

// ---------------------------------------------------------------------------
// The record

/// Every run in `~/leios-musashi/runs`, a line each: where KleioScan put each
/// transaction where it looked one up, our node's look elsewhere.
fn report() -> Result<()> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(home()?.join("runs"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    println!("| Run | Window | Txs | First on the ledger (s) | All on the ledger (s) | Blocks | In an RB | In a certified EB |");
    println!("|---|---|---:|---:|---:|---:|---:|---:|");
    for f in files {
        let d: Value = serde_json::from_str(&std::fs::read_to_string(&f)?)?;
        let txs = d["txs"].as_array().context("txs")?;
        let mut blocks = HashSet::new();
        let (mut rb, mut eb) = (0, 0);
        for t in txs {
            let (block, in_eb) = match &t["kleio"] {
                Value::Null => (t["block"].as_u64().unwrap_or(0), t["via"] == "certified EB"),
                k => (k["block"].as_u64().unwrap_or(0), k["certified_eb"].as_bool() == Some(true)),
            };
            blocks.insert(block);
            if in_eb { eb += 1 } else { rb += 1 }
        }
        let landed: Vec<f64> = txs.iter().filter_map(|t| t["landed"].as_f64()).collect();
        println!(
            "| {} | {} | {} | {:.0} | {:.0} | {} | {rb} | {eb} |",
            d["name"].as_str().unwrap_or(""),
            d["window"].as_u64().map_or("all".to_string(), |w| w.to_string()),
            txs.len(),
            landed.iter().cloned().fold(f64::INFINITY, f64::min),
            landed.iter().cloned().fold(0.0, f64::max),
            blocks.len()
        );
    }
    Ok(())
}
