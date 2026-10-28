//! Musashi's protocol parameters in the shape core's builders take (Koios's
//! `epoch_params` row), from the bundled genesis. `live params` checks them
//! against the node: governance can move them after genesis.

use crate::limits;
use anyhow::{Context, Result};
use seedelf_koios::koios::ProtocolParameters;
use serde_json::{Value, json};

/// The parameters as a Koios row, from the genesis files.
pub fn musashi_row() -> Result<Value> {
    let g = limits::genesis()?;
    let pp = &g.shelley["protocolParams"];
    let prices = &g.alonzo["executionPrices"];
    let models = &g.alonzo["extraConfig"]["costModels"];
    // Alonzo's genesis prices a UTxO by the 8-byte word; Babbage on by the
    // byte, the word's price divided by 8 (34,482 / 8 = 4,310, as mainnet's).
    let per_word = g.alonzo["lovelacePerUTxOWord"].as_u64().context("lovelacePerUTxOWord")?;
    Ok(json!({
        "min_fee_a": pp["minFeeA"],
        "min_fee_b": pp["minFeeB"],
        "coins_per_utxo_size": (per_word / 8).to_string(),
        "key_deposit": pp["keyDeposit"],
        "drep_deposit": g.conway["dRepDeposit"],
        "price_mem": prices["priceMemory"],
        "price_step": prices["priceSteps"],
        "min_fee_ref_script_cost_per_byte": g.conway["minFeeRefScriptCostPerByte"],
        "cost_models": {
            "PlutusV1": models["PlutusV1"],
            "PlutusV2": models["PlutusV2"],
            "PlutusV3": models["PlutusV3"],
        },
    }))
}

pub fn musashi() -> Result<ProtocolParameters> {
    ProtocolParameters::from_koios(&musashi_row()?)
}

/// Mainnet's, as core's tests bundle them (epoch 658).
#[cfg(test)]
pub fn mainnet() -> Result<ProtocolParameters> {
    let rows: Value = serde_json::from_str(include_str!(
        "../../seedelf-platform/seedelf-core/tests/fixtures/epoch_params_mainnet.json"
    ))?;
    ProtocolParameters::from_koios(&rows[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Musashi's genesis V3 cost model is mainnet's, so a script costs there
    /// what it costs on mainnet, to the step. (Its Conway genesis carries an
    /// older 251-entry model; which one the chain runs is `live params`'s to
    /// check.)
    #[test]
    fn musashi_prices_scripts_as_mainnet_does() {
        let m = musashi().unwrap();
        let main = mainnet().unwrap();
        assert_eq!(m.cost_model_v3, main.cost_model_v3);
        assert_eq!(m.cost_model_v3.len(), 350);
        assert_eq!((m.min_fee_a, m.min_fee_b), (main.min_fee_a, main.min_fee_b));
        assert_eq!(m.coins_per_utxo_size, main.coins_per_utxo_size);
        assert_eq!((m.price_mem, m.price_step), (main.price_mem, main.price_step));
    }
}
