//! The bytes `seedelf-verification`'s Lovejoin theorems are about are the
//! bytes the wallet trusts a pool by (1.8.1's release review, trust#1): its
//! `#import_uplc` reads the `.hex` files below, and core bundles its own copy
//! of the templates (`Set::V2`). Edit either, and this fails. It sits in this
//! crate, which is never published, since the files are outside it.
//!
//! And mainnet's v2 5 ₳ pool, the one the release's head start names, is
//! those templates applied to its seed (claims#2).

use seedelf_core::lovejoin::templates::{self, Set};

/// The scripts CLAIMS.md's Lovejoin rows are about: `Lovejoin.Template.Scripts`
/// imports the three templates, and `Lovejoin.Scripts` the reference holder,
/// which takes no parameters.
const MIX_LOGIC: &str =
    include_str!("../../../../seedelf-verification/Lovejoin/Template/Scripts/mix_logic.hex");
const MIX_BOX: &str =
    include_str!("../../../../seedelf-verification/Lovejoin/Template/Scripts/mix_box.hex");
const ONE_SHOT_MINT: &str =
    include_str!("../../../../seedelf-verification/Lovejoin/Template/Scripts/one_shot_mint.hex");
const REFERENCE_HOLDER: &str =
    include_str!("../../../../seedelf-verification/Lovejoin/Scripts/reference_holder.hex");

/// The hash of the script a `.hex` file holds.
fn hash(file: &str) -> [u8; 28] {
    templates::script_hash(&hex::decode(file.trim()).unwrap())
}

#[test]
fn the_proven_scripts_are_the_wallets_v2_templates() {
    let [one_shot_mint, mix_logic, mix_box, _] = templates::unapplied_hashes_in(Set::V2);
    assert_eq!(hash(MIX_LOGIC), mix_logic);
    assert_eq!(hash(MIX_BOX), mix_box);
    assert_eq!(hash(ONE_SHOT_MINT), one_shot_mint);
    assert_eq!(hash(REFERENCE_HOLDER), templates::REFERENCE_HOLDER_HASH);
    // v2's mix_logic, the one template v1's differs in.
    assert_ne!(mix_logic, templates::unapplied_hashes_in(Set::V1)[1]);
}

#[test]
fn mainnets_v2_pool_is_the_proven_templates_applied() {
    // The seed its launch (b1720b86…) spent.
    let seed: [u8; 32] =
        hex::decode("6db8a3133b88c66075173a5416290895398db6bd0b832c1be1af009e2648fc60")
            .unwrap()
            .try_into()
            .unwrap();
    let derived = templates::derive_in(Set::V2, &seed, 3).unwrap();
    assert_eq!(
        hex::encode(derived.policy()),
        "fcb3f5ec5f58d8fc31cf60408b77a1fe4f431880dc810bd12e8a9aa2"
    );
    assert_eq!(
        hex::encode(derived.mix_logic.hash),
        "a6a85074e56cf486a1c6620181902cf4726a7f5bb11878ae23eb99f5"
    );
    assert_eq!(
        hex::encode(derived.mix_box.hash),
        "dd94113cc07cbe0f0c331c9ba10477795ca90bfb1e3e348b40d15a31"
    );
}
