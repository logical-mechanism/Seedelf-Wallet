use reqwest::Error;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct BlockchainTip {
    pub hash: String,
    pub epoch_no: u64,
    pub abs_slot: u64,
    pub epoch_slot: u64,
    pub block_no: u64,
    pub block_time: u64,
}

/// Fetch the latest blockchain tip from Koios API
pub async fn tip(network_flag: bool) -> Result<Vec<BlockchainTip>, Error> {
    let network = if network_flag {
        "preprod"
    } else {
        "api"
    };
    let url = format!("https://{}.koios.rest/api/v1/tip", network);

    // Make the GET request and parse the JSON response
    let response = reqwest::get(&url)
        .await?
        .json::<Vec<BlockchainTip>>()
        .await?;

    Ok(response)
}
