use crate::assets::{Asset, Assets, string_to_u64};
use crate::constants::{MAXIMUM_TOKENS_PER_UTXO, MAXIMUM_WALLET_UTXOS};
use crate::transaction::wallet_minimum_lovelace_with_assets;
use anyhow::{Context, Result, anyhow, bail};
use blstrs::Scalar;
use hex;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{
    UtxoResponse, address_utxos, contains_policy_id, credential_utxos, extract_bytes_with_logging,
};

pub async fn get_credential_utxos(
    wallet_contract_hash: [u8; 28],
    network_flag: bool,
) -> Result<Vec<UtxoResponse>> {
    let utxos: Vec<UtxoResponse> =
        credential_utxos(hex::encode(wallet_contract_hash).as_str(), network_flag)
            .await
            .context("Failed To Get Credential UTxOs")?;
    Ok(utxos)
}

pub async fn get_address_utxos(address: &str, network_flag: bool) -> Result<Vec<UtxoResponse>> {
    let utxos: Vec<UtxoResponse> = address_utxos(address, network_flag)
        .await
        .context("Failed To Get Address UTxOs")?;
    Ok(utxos)
}

/// collects all the wallet utxos owned by some scalar.
pub fn collect_all_wallet_utxos(
    sk: Scalar,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let mut all_utxos: Vec<UtxoResponse> = Vec::new();
    for utxo in utxos {
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scaler
            if inline_datum
                .is_owned(sk)
                .context("Failed To Construct Points")?
            {
                // its owned but lets not count the seedelf in the balance
                if !contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
                    all_utxos.push(utxo.clone());
                }
            }
        }
    }
    Ok(all_utxos)
}

/// Find a specific seedelf's datum and all the utxos owned by a scalar. The maximum amount of utxos is limited by a upper bound.
pub fn find_seedelf_and_wallet_utxos(
    sk: Scalar,
    seedelf: String,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<(Option<Register>, Vec<UtxoResponse>)> {
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();
    let mut number_of_utxos: u64 = 0;

    let mut seedelf_datum: Option<Register> = None;
    let mut found_seedelf: bool = false;

    for utxo in utxos {
        // Extract bytes
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            if !found_seedelf && contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
                let asset_name = utxo
                    .asset_list
                    .as_ref()
                    .and_then(|vec| {
                        vec.iter()
                            .find(|asset| asset.policy_id == seedelf_policy_id)
                            .map(|asset| &asset.asset_name)
                    })
                    .context("Can't Produce Asset Name")?;
                if asset_name == &seedelf {
                    found_seedelf = true;
                    seedelf_datum = Some(inline_datum.clone());
                }
            }
            // utxo must be owned by this secret scaler
            if inline_datum
                .is_owned(sk)
                .context("Failed To Construct Points")?
            {
                // its owned but it can't hold a seedelf
                if !contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
                    if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                        // we hit the max utxos allowed in a single tx
                        break;
                    }
                    usable_utxos.push(utxo);
                    number_of_utxos += 1;
                }
            }
        }
    }
    Ok((seedelf_datum, usable_utxos))
}

/// Find a specific seedelf.
pub fn find_seedelf_utxo(
    seedelf: String,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Option<UtxoResponse>> {
    for utxo in utxos {
        if contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
            let asset_name = utxo
                .asset_list
                .as_ref()
                .and_then(|vec| {
                    vec.iter()
                        .find(|asset| asset.policy_id == seedelf_policy_id)
                        .map(|asset| &asset.asset_name)
                })
                .context("Can't Produce Asset Name")?;
            if asset_name == &seedelf {
                // we found it so stop searching
                return Ok(Some(utxo));
            }
        }
    }
    Ok(None)
}

// Find wallet utxos owned by some scalar. The maximum amount of utxos is limited by a upper bound.
pub fn collect_wallet_utxos(
    sk: Scalar,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let mut number_of_utxos: u64 = 0;
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();

    for utxo in utxos {
        // Extract bytes
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scaler
            if inline_datum
                .is_owned(sk)
                .context("Failed To Construct Points")?
            {
                // its owned but it can't hold a seedelf
                if !contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
                    if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                        // we hit the max utxos allowed in a single tx
                        break;
                    }
                    usable_utxos.push(utxo);
                    number_of_utxos += 1;
                }
            }
        }
    }
    Ok(usable_utxos)
}

/// Collect all the address utxos that are not an assumed collateral utxo.
pub fn collect_address_utxos(utxos: Vec<UtxoResponse>) -> Result<Vec<UtxoResponse>> {
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();
    // loop all the utxos found from the address
    for utxo in utxos {
        // get the lovelace on this utxo
        let lovelace: u64 = utxo.value.parse::<u64>().context("Invalid Lovelace")?;
        if let Some(assets) = &utxo.asset_list {
            if assets.is_empty() && lovelace == 5_000_000 {
                // its probably a collateral utxo
            } else {
                // its probably not a collateral utxo
                usable_utxos.push(utxo);
            }
        }
    }
    Ok(usable_utxos)
}

// lets assume that the lovelace here initially accounts for the estimated fee, like 1 ada or something
// use largest first algo but account for change
pub fn select(
    utxos: Vec<UtxoResponse>,
    lovelace: u64,
    tokens: Assets,
) -> Result<Vec<UtxoResponse>> {
    do_select(utxos, lovelace, tokens, lovelace).context("Do Select Failed")
}
pub fn do_select(
    mut utxos: Vec<UtxoResponse>,
    lovelace: u64,
    tokens: Assets,
    lovelace_goal: u64,
) -> Result<Vec<UtxoResponse>> {
    let mut selected_utxos: Vec<UtxoResponse> = Vec::new();

    let mut current_lovelace_sum: u64 = 0;
    let mut found_enough: bool = false;

    // all the found assets
    let mut found_assets: Assets = Assets::new();

    // sort by largest ada first
    // (empty asset lists first)
    utxos.sort_by(|a, b| {
        let a_group_key = a.asset_list.as_ref().is_some_and(|list| list.is_empty());
        let b_group_key = b.asset_list.as_ref().is_some_and(|list| list.is_empty());

        b_group_key.cmp(&a_group_key).then_with(|| {
            string_to_u64(b.value.clone())
                .into_iter()
                .cmp(string_to_u64(a.value.clone()))
        })
    });

    for utxo in utxos.clone() {
        // the value from koios is the lovelace
        let value: u64 = string_to_u64(utxo.value.clone()).context("Invalid UTxO Value")?;

        let mut utxo_assets: Assets = Assets::new();
        let mut added: bool = false;

        // lets keep track if we found any assets while searching
        if let Some(assets) = utxo.clone().asset_list {
            if !assets.is_empty() {
                for token in assets.clone() {
                    utxo_assets = utxo_assets
                        .add(
                            Asset::new(
                                token.policy_id,
                                token.asset_name,
                                string_to_u64(token.quantity).context("Invalid Asset Amount")?,
                            )
                            .context("Invalid Asset")?,
                        )
                        .context("Can't Add Assets")?;
                }
                // if this utxo has the assets we need but we haven't found it all yet then add it
                if utxo_assets.any(tokens.clone()) && !found_assets.contains(tokens.clone()) {
                    selected_utxos.push(utxo.clone());
                    current_lovelace_sum += value;
                    found_assets = found_assets
                        .merge(utxo_assets.clone())
                        .context("Can't Merge Assets")?;
                    added = true;
                }
            } else {
                // no tokens here just lovelace so add it
                if current_lovelace_sum < lovelace {
                    selected_utxos.push(utxo.clone());
                    current_lovelace_sum += value;
                    added = true;
                }
            }
        }

        // the utxo is not pure ada and doesnt contain what you need but you need ada because you already found the tokens so add it
        if !added && current_lovelace_sum < lovelace && found_assets.contains(tokens.clone()) {
            selected_utxos.push(utxo.clone());
            current_lovelace_sum += value;
            found_assets = found_assets
                .merge(utxo_assets)
                .context("Can't Merge Assets")?;
        }

        // we know we found enough lovelace and assets
        if current_lovelace_sum >= lovelace && found_assets.contains(tokens.clone()) {
            // but is it enough to account for the min ada for the token change as we will assume there will always be a change utxo
            let change_assets: Assets = found_assets
                .separate(tokens.clone())
                .context("Can't Separate Assets")?;
            let number_of_change_assets: u64 = change_assets.len();
            let minimum: u64 = wallet_minimum_lovelace_with_assets(change_assets.clone())
                .context("Invalid Minimum Lovelace")?;
            // we need to calculate how many multiple change utxos we need
            let multiplier: u64 = if number_of_change_assets > MAXIMUM_TOKENS_PER_UTXO {
                // add one due to floor division
                (number_of_change_assets / MAXIMUM_TOKENS_PER_UTXO) + 1
            } else {
                1
            };
            // we need lovelace for the goal and the change here
            if current_lovelace_sum - multiplier * minimum >= lovelace_goal {
                // it is!
                found_enough = true;
                break;
            } else {
                // its not, try again but increase the lovelace by the minimum we would need
                return do_select(
                    utxos.clone(),
                    lovelace + multiplier * minimum,
                    tokens.clone(),
                    lovelace_goal,
                );
            }
        }
    }
    if found_enough {
        // we found enough utxos to pay for it
        Ok(selected_utxos)
    } else {
        // not enough utxos to pay for what you are trying to do so return the empty utxo set
        Ok(Vec::new())
    }
}

/// Calculate the total assets of a list of utxos.
pub fn assets_of(utxos: Vec<UtxoResponse>) -> Result<(u64, Assets)> {
    let mut found_assets: Assets = Assets::new();
    let mut current_lovelace_sum: u64 = 0;

    for utxo in utxos.clone() {
        let value: u64 = string_to_u64(utxo.value.clone()).context("Invalid UTxO Value")?;
        current_lovelace_sum += value;

        if let Some(assets) = utxo.clone().asset_list
            && !assets.is_empty()
        {
            let mut utxo_assets: Assets = Assets::new();

            for token in assets.clone() {
                let new_asset = Asset::new(
                    token.policy_id,
                    token.asset_name,
                    string_to_u64(token.quantity).context("Invalid Token Quantity")?,
                )
                .context("Fail To Construct Asset")?;
                utxo_assets = utxo_assets.add(new_asset).context("Can't Add Assets")?;
            }

            found_assets = found_assets
                .merge(utxo_assets.clone())
                .context("Can't Merge Assets")?;
        }
    }
    Ok((current_lovelace_sum, found_assets))
}

/// Find a seedelf that contains the label and print the match.
pub fn find_all_seedelfs(
    label: String,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<Vec<String>> {
    let mut matches = Vec::new();
    for utxo in utxos {
        if contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
            let asset_name = utxo
                .asset_list
                .as_ref()
                .and_then(|vec| {
                    vec.iter()
                        .find(|asset| asset.policy_id == seedelf_policy_id)
                        .map(|asset| &asset.asset_name)
                })
                .context("Can't Produce Asset Name")?;
            if asset_name.to_lowercase().contains(&label.to_lowercase()) {
                // we found it so print it
                matches.push(asset_name.to_string());
            }
        }
    }
    Ok(matches)
}

/// Find a seedelf that contains the label and print the match.
pub fn count_lovelace_and_utxos(
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Result<(usize, u64, u64)> {
    let mut total_lovelace: u64 = 0;
    let mut total_seedelfs: u64 = 0;

    for utxo in utxos.clone() {
        // count if a utxo holds a seedelf policy id
        if contains_policy_id(&utxo.asset_list, seedelf_policy_id) {
            total_seedelfs += 1;
        }
        // count the lovelace on the utxo
        let value: u64 =
            string_to_u64(utxo.value.clone()).context("failed to parse lovelace value")?;
        total_lovelace += value;
    }
    Ok((utxos.len(), total_lovelace, total_seedelfs))
}

pub fn parse_tx_utxos(utxos: Vec<String>) -> Result<Vec<(String, u64)>> {
    utxos
        .into_iter()
        .map(|s| {
            let parts: Vec<&str> = s.split('#').collect();
            if parts.len() != 2 {
                bail!("Invalid input format: {s}");
            }

            let tx_hash = parts[0].to_string();
            let index = parts[1]
                .parse::<u64>()
                .map_err(|_| anyhow!("Invalid index in input: {s}"))?;

            Ok((tx_hash, index))
        })
        .collect()
}

pub fn filter_utxos(utxos: Vec<UtxoResponse>, targets: Vec<(String, u64)>) -> Vec<UtxoResponse> {
    // For fast lookup, convert to a HashSet
    use std::collections::HashSet;

    let target_set: HashSet<(String, u64)> = targets.into_iter().collect();

    utxos
        .into_iter()
        .filter(|u| target_set.contains(&(u.tx_hash.clone(), u.tx_index)))
        .collect()
}
