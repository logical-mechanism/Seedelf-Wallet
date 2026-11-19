//! Chunk 51, e7b#2: a DRep profile's address is the user's, up to the
//! ledger's one rule. The ledger reads an anchor's address as text of at most
//! 128 bytes of UTF-8 from protocol 9 (cardano-ledger's `instance DecCBOR
//! Url`, `textDecCBOR 128`; Conway's CDDL `url = text .size (0 .. 128)`), and
//! no Conway rule reads it further. Core's `anchor()` refused whitespace and
//! control characters on top of that, where the owner's rule (2026-10-19)
//! allows a warning at most. It keeps the rest: the address is trimmed and
//! needed, at most 128 bytes, and the hash is 64 hex characters.

use seedelf_core::staking::{MAX_ANCHOR_URL, anchor};

#[test]
fn an_anchor_takes_any_address_the_ledger_takes() {
    let hash = "ab".repeat(32);
    // A space, as a file name can have, and a scheme no form lists: text the ledger takes.
    for url in [
        "https://example.com/my profile.jsonld",
        "ar://T1rSp2mVhQ8bKcX7wE4yZ0aN6fLg3uJd5HqP9iOvB-_",
        "https://example.com/a\tb.jsonld",
        "https://example.com/d.jsonld\u{7}",
    ] {
        let a = anchor(url, &hash).unwrap_or_else(|e| panic!("{url:?}: {e}"));
        assert_eq!(a.url, url);
        assert_eq!(a.content_hash.as_ref(), &[0xab; 32]);
    }
    // Trimmed: what's around it is no part of it.
    assert_eq!(
        anchor("  https://example.com/a b.json \n", &hash)
            .unwrap()
            .url,
        "https://example.com/a b.json"
    );
}

#[test]
fn an_anchor_keeps_the_ledgers_limit_and_needs_an_address() {
    let hash = "ab".repeat(32);
    let err = |url: &str| anchor(url, &hash).unwrap_err().to_string();
    let most = format!("ar://{}", "a b".repeat(41));
    assert_eq!(most.len(), MAX_ANCHOR_URL);
    assert_eq!(anchor(&most, &hash).unwrap().url, most);
    assert!(err(&format!("{most}a")).contains("limit of 128"));
    assert!(err("   ").contains("address"));
    assert!(
        anchor("https://example.com/d.json", "abcd")
            .unwrap_err()
            .to_string()
            .contains("64 hex")
    );
}
