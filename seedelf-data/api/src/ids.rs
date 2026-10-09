//! The IDs the public routes take and give: CIP-5's bech32 (addresses, stake
//! addresses, pools) and CIP-129's DRep and governance action IDs. db-sync
//! holds bytes. Koios turns them into text with pg_cardano, which the home
//! Postgres doesn't have, so the API does it here.

use bech32::{Bech32, Hrp};

/// `bytes` as bech32 under `hrp`.
pub fn encode(hrp: &str, bytes: &[u8]) -> String {
    let hrp = Hrp::parse(hrp).expect("a constant HRP");
    bech32::encode::<Bech32>(hrp, bytes).expect("an ID is short enough for bech32")
}

/// The HRP and bytes of a lowercase bech32 string: what the wallet sends, and
/// nothing else. One spelling per ID: the decoder also takes a Bech32m
/// checksum and stray padding bits, which would let one pool or DRep be
/// asked for under several names (and cached, and worked out, under each).
pub fn decode(text: &str) -> Option<(String, Vec<u8>)> {
    if text.bytes().any(|b| b.is_ascii_uppercase()) {
        return None;
    }
    let (hrp, bytes) = bech32::decode(text).ok()?;
    let canonical = bech32::encode::<Bech32>(hrp, &bytes).ok()?;
    (canonical == text).then(|| (hrp.to_string(), bytes))
}

/// A mainnet address's bytes (`address.raw`): Shelley addresses only, as `addr1…`.
pub fn address_bytes(text: &str) -> Option<Vec<u8>> {
    let (hrp, bytes) = decode(text)?;
    // The header's network nibble is 1 on mainnet; types 0–7 are Shelley's.
    (hrp == "addr" && bytes.len() >= 29 && bytes[0] & 0x0f == 1 && bytes[0] >> 4 <= 7)
        .then_some(bytes)
}

/// A mainnet stake address's bytes (`stake_address.hash_raw`): its header and credential.
pub fn stake_bytes(text: &str) -> Option<Vec<u8>> {
    let (hrp, bytes) = decode(text)?;
    (hrp == "stake" && bytes.len() == 29 && (bytes[0] == 0xe1 || bytes[0] == 0xf1)).then_some(bytes)
}

/// A pool ID's key hash (`pool_hash.hash_raw`).
pub fn pool_bytes(text: &str) -> Option<Vec<u8>> {
    let (hrp, bytes) = decode(text)?;
    (hrp == "pool" && bytes.len() == 28).then_some(bytes)
}

/// A DRep, as `drep_hash` keys it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Drep {
    /// A credential: its hash, and whether it's a script's.
    Credential { raw: Vec<u8>, script: bool },
    /// `drep_always_abstain` or `drep_always_no_confidence`: db-sync's `view`, with no hash.
    Predefined(&'static str),
}

pub const ALWAYS_ABSTAIN: &str = "drep_always_abstain";
pub const ALWAYS_NO_CONFIDENCE: &str = "drep_always_no_confidence";

impl Drep {
    /// A DRep ID as Koios takes one: CIP-129 (`drep1…`, a header byte and the hash),
    /// CIP-105 (`drep1…` or `drep_script1…`, the hash alone), or a predefined one.
    pub fn parse(text: &str) -> Option<Drep> {
        match text {
            ALWAYS_ABSTAIN => return Some(Drep::Predefined(ALWAYS_ABSTAIN)),
            ALWAYS_NO_CONFIDENCE => return Some(Drep::Predefined(ALWAYS_NO_CONFIDENCE)),
            _ => {}
        }
        let (hrp, bytes) = decode(text)?;
        match (hrp.as_str(), bytes.len()) {
            ("drep", 29) if bytes[0] == 0x22 || bytes[0] == 0x23 => Some(Drep::Credential {
                raw: bytes[1..].to_vec(),
                script: bytes[0] == 0x23,
            }),
            ("drep", 28) => Some(Drep::Credential {
                raw: bytes,
                script: false,
            }),
            ("drep_script", 28) => Some(Drep::Credential {
                raw: bytes,
                script: true,
            }),
            _ => None,
        }
    }
}

/// A DRep's CIP-129 ID: `drep1…` over a header byte (0x22 a key, 0x23 a script) and the hash.
pub fn drep_id(raw: &[u8], script: bool) -> String {
    let mut bytes = Vec::with_capacity(raw.len() + 1);
    bytes.push(if script { 0x23 } else { 0x22 });
    bytes.extend_from_slice(raw);
    encode("drep", &bytes)
}

/// A constitutional committee member's hot credential, CIP-129: `cc_hot1…`
/// over a header byte (0x02 a key, 0x03 a script) and the hash.
pub fn cc_hot_id(raw: &[u8], script: bool) -> String {
    let mut bytes = Vec::with_capacity(raw.len() + 1);
    bytes.push(if script { 0x03 } else { 0x02 });
    bytes.extend_from_slice(raw);
    encode("cc_hot", &bytes)
}

/// What Koios shows for a DRep: its CIP-129 ID, or db-sync's `view` for a predefined one.
pub fn drep_shown(raw: Option<&[u8]>, script: bool, view: &str) -> String {
    match raw {
        Some(raw) => drep_id(raw, script),
        None => view.to_string(),
    }
}

/// A governance action's CIP-129 ID: `gov_action1…` over its transaction's hash and its index.
pub fn gov_action_id(tx_hash: &[u8], index: u8) -> String {
    let mut bytes = tx_hash.to_vec();
    bytes.push(index);
    encode("gov_action", &bytes)
}

/// A governance action's transaction hash and index, from its CIP-129 ID.
pub fn gov_action_parts(text: &str) -> Option<(Vec<u8>, u8)> {
    let (hrp, bytes) = decode(text)?;
    (hrp == "gov_action" && bytes.len() == 33).then(|| (bytes[..32].to_vec(), bytes[32]))
}

/// Lowercase hex of exactly `len` bytes, decoded.
pub fn hex_bytes(text: &str, len: usize) -> Option<Vec<u8>> {
    if text.len() != len * 2 {
        return None;
    }
    hex_any(text)
}

/// Lowercase hex of any even length (an asset name can be empty), decoded.
pub fn hex_any(text: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    if !text.len().is_multiple_of(2) {
        return None;
    }
    text.as_bytes()
        .chunks(2)
        .map(|pair| Some(digit(pair[0])? << 4 | digit(pair[1])?))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mainnet IDs as Koios gave them (the wallet's tests/fixtures/governance.json).
    const DREP: &str = "drep1yfzzwr8jznn02mzepvs6y9n4329eskzpgygjdh4ew28szpcd5hr4f";
    const GOV_ACTION: &str =
        "gov_action17m7nv7839mw93hv889tqzj0umv9ckm780f0nq02fep78f50uedxqq6g5mt9";
    const GOV_ACTION_TX: &str = "f6fd3678f12edc58dd8739560149fcdb0b8b6fc77a5f303d49c87c74d1fccb4c";

    #[test]
    fn an_id_has_one_spelling() {
        let (hrp, bytes) = decode(DREP).unwrap();
        // The same bytes under Bech32m's checksum: the decoder alone would take it.
        let hrp = bech32::Hrp::parse(&hrp).unwrap();
        let other = bech32::encode::<bech32::Bech32m>(hrp, &bytes).unwrap();
        assert!(bech32::decode(&other).is_ok());
        assert_eq!(decode(&other), None);
        assert!(decode(DREP).is_some());
    }

    #[test]
    fn a_cip129_drep_id_reads_back_as_written() {
        let Some(Drep::Credential { raw, script }) = Drep::parse(DREP) else {
            panic!("a CIP-129 DRep ID");
        };
        assert_eq!((raw.len(), script), (28, false));
        assert_eq!(drep_id(&raw, script), DREP);
        // The same DRep in CIP-105's form names the same credential.
        assert_eq!(
            Drep::parse(&encode("drep", &raw)),
            Some(Drep::Credential {
                raw: raw.clone(),
                script: false
            })
        );
        assert_eq!(
            Drep::parse(&encode("drep_script", &raw)),
            Some(Drep::Credential { raw, script: true })
        );
        assert_eq!(
            Drep::parse(ALWAYS_ABSTAIN),
            Some(Drep::Predefined(ALWAYS_ABSTAIN))
        );
    }

    #[test]
    fn a_gov_action_id_reads_back_as_written() {
        let (hash, index) = gov_action_parts(GOV_ACTION).unwrap();
        assert_eq!((hash, index), (hex_bytes(GOV_ACTION_TX, 32).unwrap(), 0));
        let hash = hex_bytes(GOV_ACTION_TX, 32).unwrap();
        assert_eq!(gov_action_id(&hash, index), GOV_ACTION);
    }

    #[test]
    fn only_mainnet_shelley_addresses_and_stake_addresses() {
        let stake = encode("stake", &[[0xe1].as_slice(), &[7; 28]].concat());
        assert_eq!(stake_bytes(&stake).unwrap().len(), 29);
        assert!(
            stake_bytes(&encode(
                "stake_test",
                &[[0xe0].as_slice(), &[7; 28]].concat()
            ))
            .is_none()
        );
        assert!(stake_bytes(&stake.to_uppercase()).is_none());

        let enterprise = encode("addr", &[[0x61].as_slice(), &[7; 28]].concat());
        assert_eq!(address_bytes(&enterprise).unwrap()[0], 0x61);
        let base = encode("addr", &[[0x01].as_slice(), &[7; 56]].concat());
        assert_eq!(address_bytes(&base).unwrap().len(), 57);
        assert!(
            address_bytes(&encode(
                "addr_test",
                &[[0x60].as_slice(), &[7; 28]].concat()
            ))
            .is_none()
        );
        assert!(address_bytes(&encode("addr", &[[0x80].as_slice(), &[7; 28]].concat())).is_none());
        assert!(pool_bytes(&encode("pool", &[7; 28])).is_some());
        assert!(pool_bytes(&encode("pool", &[7; 29])).is_none());
    }

    #[test]
    fn hex_is_lowercase_and_even() {
        assert_eq!(hex_bytes("00ff", 2), Some(vec![0, 255]));
        assert_eq!(hex_bytes("00FF", 2), None);
        assert_eq!(hex_bytes("00f", 2), None);
        assert_eq!(hex_any(""), Some(vec![]));
        assert_eq!(hex_any("0g"), None);
    }
}
