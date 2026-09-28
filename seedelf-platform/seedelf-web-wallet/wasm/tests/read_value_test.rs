//! A site's amount (`getUtxos(amount)`, `getCollateral`) is read with a
//! bound on how many policies and tokens it names, so a site can't make the
//! WebAssembly allocate without end (independent review M15).

use seedelf_wasm::cip30::{self, MAX_VALUE_ENTRIES};

const POLICY: &str = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";

/// `[coin, { policy: { name: 1, ... } }]` with `names` token names under one
/// policy, each a two-byte name, in indefinite-length maps.
fn amount(names: usize) -> String {
    let entries: String = (0..names).map(|i| format!("42{:04x}01", i)).collect();
    format!("82{}bf581c{POLICY}bf{entries}ffff", "1a004c4b40")
}

#[test]
fn an_amount_naming_up_to_the_bound_is_read() {
    // The policy counts as one entry of its own.
    let (lovelace, tokens) = cip30::read_value(&amount(MAX_VALUE_ENTRIES - 1)).unwrap();
    assert_eq!(lovelace, 5_000_000);
    assert_eq!(tokens.len(), MAX_VALUE_ENTRIES - 1);
}

#[test]
fn an_amount_naming_more_is_refused_as_it_is_read() {
    let err = cip30::read_value(&amount(MAX_VALUE_ENTRIES)).unwrap_err();
    assert!(err.to_string().contains("more than 1000 tokens"), "{err}");
    // Zero quantities count too: they're read all the same.
    let zeros: String = (0..MAX_VALUE_ENTRIES * 4).map(|_| "4000").collect();
    let err = cip30::read_value(&format!("8200bf40bf{zeros}ffff")).unwrap_err();
    assert!(err.to_string().contains("more than"), "{err}");
    // The review's shape: millions of `40 01` under an empty policy name.
    let flood: String = (0..200_000).map(|_| "4001").collect();
    assert!(cip30::read_value(&format!("8200bf40bf{flood}ffff")).is_err());
}
