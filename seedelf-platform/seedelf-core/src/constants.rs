use hex_literal::hex;

/// The current variant of Seedelf
pub const VARIANT: u64 = 1;

pub struct Contract {
    pub wallet_contract_hash: [u8; 28],
    pub seedelf_policy_id: &'static str,
    pub wallet_contract_size: u64,
    pub seedelf_contract_size: u64,
}

pub struct Reference {
    pub wallet_reference_utxo: [u8; 32],
    pub seedelf_reference_utxo: [u8; 32],
}

pub struct Config {
    pub contract: Contract,
    pub reference: Reference,
}

/// We can store all variants of the contracts inside this function then call it whenever we need it.
pub fn get_config(variant: u64, network: bool) -> Option<Config> {
    match variant {
        1 => {
            let reference: Reference = if network {
                Reference {
                    wallet_reference_utxo: hex!(
                        "96fbddac63c55284fbbaa3c216ef1c0f460019e8643a889a189d5b5f7ddd71d6"
                    ),
                    seedelf_reference_utxo: hex!(
                        "f620a4e949bfbefbf2892d39d0777439f3acfbf850eae9b007c6558ba8ef4db4"
                    ),
                }
            } else {
                Reference {
                    wallet_reference_utxo: hex!(
                        "51f12c1a5c2b0558a284628d81b06dee50b27693242fe35618c5f921730c0527"
                    ),
                    seedelf_reference_utxo: hex!(
                        "f3955f42f660fae8b3e4dcf664011876cf769d87aa8450dc73171b4f6b5f520b"
                    ),
                }
            };
            let contract: Contract = Contract {
                wallet_contract_hash: hex!(
                    "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469"
                ),
                seedelf_policy_id: "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255",
                wallet_contract_size: 629,
                seedelf_contract_size: 519,
            };
            Some(Config {
                contract,
                reference,
            })
        }
        _ => None, // unsupported variant
    }
}

// support the [LOGIC] stakepool
pub const PREPROD_STAKE_HASH: [u8; 28] =
    hex!("86c769419aaa673c963da04e4b5bae448d490e2ceac902cb82e4da76");
pub const MAINNET_STAKE_HASH: [u8; 28] =
    hex!("fcfc7701b1df42061202efa9c96968a481bbd6a0676efb7afa87ebf1");

// collateral info for giveme.my
pub const COLLATERAL_HASH: [u8; 28] =
    hex!("7c24c22d1dc252d31f6022ff22ccc838c2ab83a461172d7c2dae61f4");
pub const COLLATERAL_PUBLIC_KEY: [u8; 32] =
    hex!("fa2025e788fae01ce10deffff386f992f62a311758819e4e3792887396c171ba");

pub const PREPROD_COLLATERAL_UTXO: [u8; 32] =
    hex!("1d388e615da2dca607e28f704130d04e39da6f251d551d66d054b75607e0393f");
pub const MAINNET_COLLATERAL_UTXO: [u8; 32] =
    hex!("e62351eacbdd001aee77a91805840d2b81f77feebbf2439fb01b79e76c42c839");

// ADA Handle Policy Ids
pub const ADA_HANDLE_POLICY_ID: &str = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";

// these maximums are estimated
pub const MAXIMUM_WALLET_UTXOS: u64 = 20;
pub const MAXIMUM_TOKENS_PER_UTXO: u64 = 20;

// protocol parameters
pub const OVERHEAD_COST: u64 = 160;
pub const UTXO_COST_PER_BYTE: u64 = 4_310;

pub const MEM_COST_NUMERATOR: u64 = 577;
pub const MEM_COST_DENOMINATOR: u64 = 10_000;
pub const CPU_COST_NUMERATOR: u64 = 721;
pub const CPU_COST_DENOMINATOR: u64 = 10_000_000;

pub fn plutus_v3_cost_model() -> Vec<i64> {
    vec![
        100788, 420, 1, 1, 1000, 173, 0, 1, 1000, 59957, 4, 1, 11183, 32, 201305, 8356, 4, 16000,
        100, 16000, 100, 16000, 100, 16000, 100, 16000, 100, 16000, 100, 100, 100, 16000, 100,
        94375, 32, 132994, 32, 61462, 4, 72010, 178, 0, 1, 22151, 32, 91189, 769, 4, 2, 85848,
        123203, 7305, -900, 1716, 549, 57, 85848, 0, 1, 1, 1000, 42921, 4, 2, 24548, 29498, 38, 1,
        898148, 27279, 1, 51775, 558, 1, 39184, 1000, 60594, 1, 141895, 32, 83150, 32, 15299, 32,
        76049, 1, 13169, 4, 22100, 10, 28999, 74, 1, 28999, 74, 1, 43285, 552, 1, 44749, 541, 1,
        33852, 32, 68246, 32, 72362, 32, 7243, 32, 7391, 32, 11546, 32, 85848, 123203, 7305, -900,
        1716, 549, 57, 85848, 0, 1, 90434, 519, 0, 1, 74433, 32, 85848, 123203, 7305, -900, 1716,
        549, 57, 85848, 0, 1, 1, 85848, 123203, 7305, -900, 1716, 549, 57, 85848, 0, 1, 955506,
        213312, 0, 2, 270652, 22588, 4, 1457325, 64566, 4, 20467, 1, 4, 0, 141992, 32, 100788, 420,
        1, 1, 81663, 32, 59498, 32, 20142, 32, 24588, 32, 20744, 32, 25933, 32, 24623, 32,
        43053543, 10, 53384111, 14333, 10, 43574283, 26308, 10, 16000, 100, 16000, 100, 962335, 18,
        2780678, 6, 442008, 1, 52538055, 3756, 18, 267929, 18, 76433006, 8868, 18, 52948122, 18,
        1995836, 36, 3227919, 12, 901022, 1, 166917843, 4307, 36, 284546, 36, 158221314, 26549, 36,
        74698472, 36, 333849714, 1, 254006273, 72, 2174038, 72, 2261318, 64571, 4, 207616, 8310, 4,
        1293828, 28716, 63, 0, 1, 1006041, 43623, 251, 0, 1, 100181, 726, 719, 0, 1, 100181, 726,
        719, 0, 1, 100181, 726, 719, 0, 1, 107878, 680, 0, 1, 95336, 1, 281145, 18848, 0, 1,
        180194, 159, 1, 1, 158519, 8942, 0, 1, 159378, 8813, 0, 1, 107490, 3298, 1, 106057, 655, 1,
        1964219, 24520, 3,
    ]
}
