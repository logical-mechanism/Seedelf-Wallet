//! What the private index watches on mainnet. Copies of values the wallet and
//! the CLI hold; the tests below fail if any of them drifts from its source.

/// The Seedelf contract (validators/wallet.ak, variant 1), as a payment credential:
/// `seedelf-platform/seedelf-core/src/constants.rs`.
pub const CONTRACT_HASH: &str = "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469";

/// The minting policy of Seedelf names: `seedelf-core/src/constants.rs`.
pub const SEEDELF_POLICY: &str = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";

/// Every Seedelf name starts with these four bytes (the root README's token name scheme).
pub const SEEDELF_PREFIX: &str = "5eed0e1f";

/// Lovejoin's mix box on mainnet: `seedelf-web-wallet/extension/src/networks.ts`.
pub const MIXBOX_HASH: &str = "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad";

/// Mainnet's Shelley era began at slot 4,492,800, Unix second 1,596,059,091,
/// and every slot since lasts a second: a slot's time is the slot plus this.
pub const SHELLEY_OFFSET: i64 = 1_591_566_291;

/// When `slot` began, in Unix seconds: every row and tip the private index
/// gives is from Shelley on, and both its sources agree on this exactly.
pub fn slot_time(slot: i64) -> i64 {
    slot + SHELLEY_OFFSET
}

/// Decodes one of the hashes above.
pub fn bytes(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("a constant is hex"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CORE: &str = include_str!("../../../seedelf-platform/seedelf-core/src/constants.rs");
    const NETWORKS: &str =
        include_str!("../../../seedelf-platform/seedelf-web-wallet/extension/src/networks.ts");

    #[test]
    fn the_contract_and_policy_match_seedelf_core() {
        assert!(CORE.contains(&format!("\"{CONTRACT_HASH}\"")));
        assert!(CORE.contains(&format!("\"{SEEDELF_POLICY}\"")));
    }

    #[test]
    fn the_mix_box_matches_the_wallets_mainnet() {
        assert!(NETWORKS.contains(&format!("mixBox: \"{MIXBOX_HASH}\"")));
    }

    #[test]
    fn a_slot_has_its_blocks_time() {
        // The contract's first live output (block 11,330,824), as db-sync times it.
        assert_eq!(slot_time(144_889_937), 1_736_456_228);
        // Shelley's first slot.
        assert_eq!(slot_time(4_492_800), 1_596_059_091);
    }

    #[test]
    fn hashes_decode_to_28_bytes() {
        for hash in [CONTRACT_HASH, SEEDELF_POLICY, MIXBOX_HASH] {
            assert_eq!(bytes(hash).len(), 28);
        }
        assert_eq!(bytes(SEEDELF_PREFIX), [0x5e, 0xed, 0x0e, 0x1f]);
    }
}
