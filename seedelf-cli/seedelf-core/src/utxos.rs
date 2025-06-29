use crate::assets::{Asset, Assets, string_to_u64};
use crate::constants::{Config, MAXIMUM_TOKENS_PER_UTXO, MAXIMUM_WALLET_UTXOS, get_config};
use crate::transaction::wallet_minimum_lovelace_with_assets;
use blstrs::Scalar;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{
    UtxoResponse, address_utxos, contains_policy_id, credential_utxos, extract_bytes_with_logging,
};

/// collects all the wallet utxos owned by some scalar.
pub async fn collect_all_wallet_utxos(
    sk: Scalar,
    network_flag: bool,
    variant: u64,
) -> Vec<UtxoResponse> {
    let mut all_utxos: Vec<UtxoResponse> = Vec::new();

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(sk) {
                        // its owned but lets not count the seedelf in the balance
                        if !contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id)
                        {
                            all_utxos.push(utxo.clone());
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
    all_utxos
}

/// Find a specific seedelf's datum and all the utxos owned by a scalar. The maximum amount of utxos is limited by a upper bound.
pub async fn find_seedelf_and_wallet_utxos(
    sk: Scalar,
    seedelf: String,
    network_flag: bool,
    variant: u64,
) -> (Option<Register>, Vec<UtxoResponse>) {
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();
    let mut number_of_utxos: u64 = 0;

    let mut seedelf_datum: Option<Register> = None;
    let mut found_seedelf: bool = false;
    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    if !found_seedelf
                        && contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id)
                    {
                        let asset_name = utxo
                            .asset_list
                            .as_ref()
                            .and_then(|vec| {
                                vec.iter()
                                    .find(|asset| {
                                        asset.policy_id == config.contract.seedelf_policy_id
                                    })
                                    .map(|asset| &asset.asset_name)
                            })
                            .unwrap();
                        if asset_name == &seedelf {
                            found_seedelf = true;
                            seedelf_datum = Some(inline_datum.clone());
                        }
                    }
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(sk) {
                        // its owned but it can't hold a seedelf
                        if !contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id)
                        {
                            if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                                // we hit the max utxos allowed in a single tx
                                println!("Maximum UTxOs");
                                break;
                            }
                            usable_utxos.push(utxo);
                            number_of_utxos += 1;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
    (seedelf_datum, usable_utxos)
}

/// Find a specific seedelf.
pub async fn find_seedelf_utxo(
    seedelf: String,
    network_flag: bool,
    variant: u64,
) -> Option<UtxoResponse> {
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });
    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                if contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id) {
                    let asset_name = utxo
                        .asset_list
                        .as_ref()
                        .and_then(|vec| {
                            vec.iter()
                                .find(|asset| asset.policy_id == config.contract.seedelf_policy_id)
                                .map(|asset| &asset.asset_name)
                        })
                        .unwrap();
                    if asset_name == &seedelf {
                        // we found it so stop searching
                        return Some(utxo);
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
    None
}

// Find wallet utxos owned by some scalar. The maximum amount of utxos is limited by a upper bound.
pub async fn collect_wallet_utxos(
    sk: Scalar,
    network_flag: bool,
    variant: u64,
) -> Vec<UtxoResponse> {
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });
    let mut number_of_utxos: u64 = 0;

    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();

    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(sk) {
                        // its owned but it can't hold a seedelf
                        if !contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id)
                        {
                            if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                                // we hit the max utxos allowed in a single tx
                                println!("Maximum UTxOs");
                                break;
                            }
                            usable_utxos.push(utxo);
                            number_of_utxos += 1;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
    usable_utxos
}

/// Collect all the address utxos that are not an assumed collateral utxo.
pub async fn collect_address_utxos(address: &str, network_flag: bool) -> Vec<UtxoResponse> {
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();
    // This should probably be some generalized function later
    match address_utxos(address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                // get the lovelace on this utxo
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if let Some(assets) = &utxo.asset_list {
                    if assets.is_empty() && lovelace == 5_000_000 {
                        // its probably a collateral utxo
                    } else {
                        // its probably not a collateral utxo
                        usable_utxos.push(utxo);
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
    usable_utxos
}

/// Collect all the address utxos that are not an assumed collateral utxo.
pub async fn collect_all_address_utxos(address: &str, network_flag: bool) -> Vec<UtxoResponse> {
    let mut usable_utxos: Vec<UtxoResponse> = Vec::new();
    // This should probably be some generalized function later
    match address_utxos(address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                usable_utxos.push(utxo);
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
    usable_utxos
}

// lets assume that the lovelace here initially accounts for the estimated fee, like 1 ada or something
// use largest first algo but account for change
pub fn select(utxos: Vec<UtxoResponse>, lovelace: u64, tokens: Assets) -> Vec<UtxoResponse> {
    do_select(utxos, lovelace, tokens, lovelace)
}
pub fn do_select(
    mut utxos: Vec<UtxoResponse>,
    lovelace: u64,
    tokens: Assets,
    lovelace_goal: u64,
) -> Vec<UtxoResponse> {
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

        b_group_key
            .cmp(&a_group_key)
            .then_with(|| string_to_u64(b.value.clone()).cmp(&string_to_u64(a.value.clone())))
    });

    for utxo in utxos.clone() {
        // the value from koios is the lovelace
        let value: u64 = string_to_u64(utxo.value.clone()).unwrap();

        let mut utxo_assets: Assets = Assets::new();
        let mut added: bool = false;

        // lets keep track if we found any assets while searching
        if let Some(assets) = utxo.clone().asset_list {
            if !assets.is_empty() {
                for token in assets.clone() {
                    utxo_assets = utxo_assets.add(Asset::new(
                        token.policy_id,
                        token.asset_name,
                        string_to_u64(token.quantity).unwrap(),
                    ));
                }
                // if this utxo has the assets we need but we haven't found it all yet then add it
                if utxo_assets.any(tokens.clone()) && !found_assets.contains(tokens.clone()) {
                    selected_utxos.push(utxo.clone());
                    current_lovelace_sum += value;
                    found_assets = found_assets.merge(utxo_assets.clone());
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
            found_assets = found_assets.merge(utxo_assets);
        }

        // we know we found enough lovelace and assets
        if current_lovelace_sum >= lovelace && found_assets.contains(tokens.clone()) {
            // but is it enough to account for the min ada for the token change as we will assume there will always be a change utxo
            let change_assets: Assets = found_assets.separate(tokens.clone());
            let number_of_change_assets: u64 = change_assets.len();
            let minimum: u64 = wallet_minimum_lovelace_with_assets(change_assets.clone());
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
        selected_utxos
    } else {
        // not enough utxos to pay for what you are trying to do so return the empty utxo set
        Vec::new()
    }
}

/// Calculate the total assets of a list of utxos.
pub fn assets_of(utxos: Vec<UtxoResponse>) -> (u64, Assets) {
    let mut found_assets: Assets = Assets::new();
    let mut current_lovelace_sum: u64 = 0;

    for utxo in utxos.clone() {
        let value: u64 = string_to_u64(utxo.value.clone()).unwrap();
        current_lovelace_sum += value;

        if let Some(assets) = utxo.clone().asset_list {
            if !assets.is_empty() {
                let mut utxo_assets: Assets = Assets::new();

                for token in assets.clone() {
                    utxo_assets = utxo_assets.add(Asset::new(
                        token.policy_id,
                        token.asset_name,
                        string_to_u64(token.quantity).unwrap(),
                    ));
                }

                found_assets = found_assets.merge(utxo_assets.clone());
            }
        }
    }
    (current_lovelace_sum, found_assets)
}

/// Find a seedelf that contains the label and print the match.
pub async fn find_all_seedelfs(label: String, network_flag: bool, variant: u64) -> Vec<String> {
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    let mut matches = Vec::new();
    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                if contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id) {
                    let asset_name = utxo
                        .asset_list
                        .as_ref()
                        .and_then(|vec| {
                            vec.iter()
                                .find(|asset| asset.policy_id == config.contract.seedelf_policy_id)
                                .map(|asset| &asset.asset_name)
                        })
                        .unwrap();
                    if asset_name.to_lowercase().contains(&label.to_lowercase()) {
                        // we found it so print it
                        matches.push(asset_name.to_string());
                    }
                }
            }
            matches
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
}

/// Find a seedelf that contains the label and print the match.
pub async fn count_lovelace_and_utxos(network_flag: bool, variant: u64) -> (usize, u64, u64) {
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            let mut total_lovelace: u64 = 0;
            let mut total_seedelfs: u64 = 0;
            for utxo in utxos.clone() {
                // count if a utxo holds a seedelf policy id
                if contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id) {
                    total_seedelfs += 1;
                }
                // count the lovelace on the utxo
                let value: u64 = string_to_u64(utxo.value.clone()).unwrap();
                total_lovelace += value;
            }
            (utxos.len(), total_lovelace, total_seedelfs)
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}\nWait a few moments and try again.");
            std::process::exit(1);
        }
    }
}

pub fn parse_tx_utxos(utxos: Vec<String>) -> Result<Vec<(String, u64)>, String> {
    utxos
        .into_iter()
        .map(|s| {
            let parts: Vec<&str> = s.split('#').collect();
            if parts.len() != 2 {
                return Err(format!("Invalid input format: {}", s));
            }

            let tx_hash = parts[0].to_string();
            let index = parts[1]
                .parse::<u64>()
                .map_err(|_| format!("Invalid index in input: {}", s))?;

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
