use pallas_txbuilder::Output;
use pallas_primitives::Fragment;

pub fn calculate_min_required_utxo(output: Output) -> u64 {
    // we need the output in the post alonzo form so we can encode it
    let output_cbor_length: u64 = output.build_babbage_raw().unwrap().encode_fragment().unwrap().len().try_into().unwrap();
    // 160 is overhead constant, 4310 is the utxoCostPerByte
    let overhead_cost: u64 = 160;
    let utxo_cost_per_byte: u64 = 4310;
    // sum the overhead and length times the cost per byte
    (overhead_cost + output_cbor_length) * utxo_cost_per_byte
}