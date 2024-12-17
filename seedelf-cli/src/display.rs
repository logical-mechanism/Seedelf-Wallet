use crate::koios::tip;

pub async fn block_number_and_time(network_flag: bool) {
    match tip(network_flag).await {
        Ok(tips) => {
            if let Some(tip) = tips.get(0) {
                println!("\nBlock Number: {} @ Time: {}", tip.block_no, tip.block_time);
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch blockchain tip: {}\nWait a few moments and try again.", err);
        }
    }

}

pub fn preprod_text(network_flag: bool) {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }
}