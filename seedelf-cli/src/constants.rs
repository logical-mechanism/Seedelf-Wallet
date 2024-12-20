pub const WALLET_CONTRACT_HASH: &str = "6a3fee2fe7c8be0ab2548728d37d2efa3eed55b3ab1c4f2e0de6d140";
pub const SEEDELF_POLICY_ID: &str = "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5";
pub const SCRIPT_REFERENCE_HASH: &str = "8e511d37053024c30870a6c7e59d9947bec0d25d42ec4e953e302fa1";

pub const MAINNET_STAKE_HASH: &str = "07ac7dee6c82177096b70ccf21cfb8965c1fb08e079f9ca4af4b2b3e";
pub const PREPROD_STAKE_HASH: &str = "86c769419aaa673c963da04e4b5bae448d490e2ceac902cb82e4da76";

pub const PREPROD_WALLET_REFERENCE_UTXO: &str = "4ec8f5a0eed8e5567db96b43de59b57c3dc8a8abd88c70ca26f8989346e31889";
pub const PREPROD_SEEDELF_REFERENCE_UTXO: &str = "46d48857d704091e19f28818363e5b44bffac53379aa703811d88bc3c0276319";

pub const MAINNET_WALLET_REFERENCE_UTXO: &str = "";
pub const MAINNET_SEEDELF_REFERENCE_UTXO: &str = "";

pub const COLLATERAL_HASH: &str = "7c24c22d1dc252d31f6022ff22ccc838c2ab83a461172d7c2dae61f4";
pub const COLLATERAL_PUBLIC_KEY: &str = "fa2025e788fae01ce10deffff386f992f62a311758819e4e3792887396c171ba";

pub const PREPROD_COLLATERAL_UTXO: &str = "1d388e615da2dca607e28f704130d04e39da6f251d551d66d054b75607e0393f";
pub const MAINNET_COLLATERAL_UTXO: &str = "";

// This maximum is estimated
pub const MAXIMUM_WALLET_UTXOS: u64 = 20;
pub const MAXIMUM_TOKENS_PER_UTXO: u64 = 1;

// protocol parameters
pub const OVERHEAD_COST: u64 = 160;
pub const UTXO_COST_PER_BYTE: u64 = 4_310;

pub const MEM_COST_NUMERATOR: u64 = 577;
pub const MEM_COST_DENOMINATOR: u64 = 10_000;
pub const CPU_COST_NUMERATOR: u64 = 721;
pub const CPU_COST_DENOMINATOR: u64 = 10_000_000;

pub fn plutus_v3_cost_model() -> Vec<i64> {
    vec![
        100788,
        420,
        1,
        1,
        1000,
        173,
        0,
        1,
        1000,
        59957,
        4,
        1,
        11183,
        32,
        201305,
        8356,
        4,
        16000,
        100,
        16000,
        100,
        16000,
        100,
        16000,
        100,
        16000,
        100,
        16000,
        100,
        100,
        100,
        16000,
        100,
        94375,
        32,
        132994,
        32,
        61462,
        4,
        72010,
        178,
        0,
        1,
        22151,
        32,
        91189,
        769,
        4,
        2,
        85848,
        123203,
        7305,
        -900,
        1716,
        549,
        57,
        85848,
        0,
        1,
        1,
        1000,
        42921,
        4,
        2,
        24548,
        29498,
        38,
        1,
        898148,
        27279,
        1,
        51775,
        558,
        1,
        39184,
        1000,
        60594,
        1,
        141895,
        32,
        83150,
        32,
        15299,
        32,
        76049,
        1,
        13169,
        4,
        22100,
        10,
        28999,
        74,
        1,
        28999,
        74,
        1,
        43285,
        552,
        1,
        44749,
        541,
        1,
        33852,
        32,
        68246,
        32,
        72362,
        32,
        7243,
        32,
        7391,
        32,
        11546,
        32,
        85848,
        123203,
        7305,
        -900,
        1716,
        549,
        57,
        85848,
        0,
        1,
        90434,
        519,
        0,
        1,
        74433,
        32,
        85848,
        123203,
        7305,
        -900,
        1716,
        549,
        57,
        85848,
        0,
        1,
        1,
        85848,
        123203,
        7305,
        -900,
        1716,
        549,
        57,
        85848,
        0,
        1,
        955506,
        213312,
        0,
        2,
        270652,
        22588,
        4,
        1457325,
        64566,
        4,
        20467,
        1,
        4,
        0,
        141992,
        32,
        100788,
        420,
        1,
        1,
        81663,
        32,
        59498,
        32,
        20142,
        32,
        24588,
        32,
        20744,
        32,
        25933,
        32,
        24623,
        32,
        43053543,
        10,
        53384111,
        14333,
        10,
        43574283,
        26308,
        10,
        16000,
        100,
        16000,
        100,
        962335,
        18,
        2780678,
        6,
        442008,
        1,
        52538055,
        3756,
        18,
        267929,
        18,
        76433006,
        8868,
        18,
        52948122,
        18,
        1995836,
        36,
        3227919,
        12,
        901022,
        1,
        166917843,
        4307,
        36,
        284546,
        36,
        158221314,
        26549,
        36,
        74698472,
        36,
        333849714,
        1,
        254006273,
        72,
        2174038,
        72,
        2261318,
        64571,
        4,
        207616,
        8310,
        4,
        1293828,
        28716,
        63,
        0,
        1,
        1006041,
        43623,
        251,
        0,
        1,
        100181,
        726,
        719,
        0,
        1,
        100181,
        726,
        719,
        0,
        1,
        100181,
        726,
        719,
        0,
        1,
        107878,
        680,
        0,
        1,
        95336,
        1,
        281145,
        18848,
        0,
        1,
        180194,
        159,
        1,
        1,
        158519,
        8942,
        0,
        1,
        159378,
        8813,
        0,
        1,
        107490,
        3298,
        1,
        106057,
        655,
        1,
        1964219,
        24520,
        3
    ]
}
