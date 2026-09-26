//! A note on a payment from the Cardano account: CIP-20's transaction
//! message, metadata label 674 holding `{ "msg": [lines] }`, which wallets
//! and explorers show with the transaction. Anyone can read it, for good.
//!
//! Pallas's builder can't stage metadata (`pallas-txbuilder` 0.35 writes
//! `None` for the auxiliary data), so, as with [`crate::staking`], a built
//! transaction is decoded, given the note and the hash of it that its body
//! must carry, and encoded again with its new hash: patched first, signed
//! after.

use anyhow::{Result, anyhow, bail};
use pallas_crypto::hash::Hasher;
use pallas_primitives::conway::{self, AuxiliaryData};
use pallas_primitives::{Fragment, KeyValuePairs, Metadatum, Nullable};
use pallas_txbuilder::BuiltTransaction;

use crate::build::tx_id;

/// CIP-20's metadata label.
pub const NOTE_LABEL: u64 = 674;

/// The longest note, in characters: one of CIP-20's lines, as Lace allows.
pub const MAX_NOTE_CHARS: usize = 64;

/// The ledger's longest metadata text, in bytes. A note longer than this
/// (possible outside ASCII) is split into several of CIP-20's lines.
const MAX_LINE_BYTES: usize = 64;

/// A note: one line of text, at most [`MAX_NOTE_CHARS`] characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    text: String,
    lines: Vec<String>,
}

impl Note {
    /// `text` as a note, trimmed; `None` when that leaves nothing. Refused:
    /// tabs, line breaks and other control characters, and more than
    /// [`MAX_NOTE_CHARS`] characters.
    pub fn new(text: &str) -> Result<Option<Note>> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }
        if text.chars().any(char::is_control) {
            bail!("A note is one line of text, with no tabs or line breaks");
        }
        let chars = text.chars().count();
        if chars > MAX_NOTE_CHARS {
            bail!("A note is at most {MAX_NOTE_CHARS} characters, not {chars}");
        }
        Ok(Some(Note {
            text: text.to_string(),
            lines: split(text),
        }))
    }

    /// CIP-20's lines, in order: one, unless the text is over 64 bytes.
    pub fn lines(&self) -> &[String] {
        &self.lines
    }

    /// The text as given, trimmed: what the review shows. Wallets reading it
    /// from the chain join the lines with spaces, so a line cut between
    /// characters (no space to cut at) reads there with one.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// `{674: {"msg": [lines]}}`, as a plain metadata map.
    fn auxiliary_data(&self) -> AuxiliaryData {
        let msg = Metadatum::Array(self.lines.iter().cloned().map(Metadatum::Text).collect());
        let message = Metadatum::Map(KeyValuePairs::Def(vec![(
            Metadatum::Text("msg".to_string()),
            msg,
        )]));
        AuxiliaryData::Shelley(KeyValuePairs::Def(vec![(NOTE_LABEL, message)]))
    }

    /// Sets the note, and its hash in the body, in `built`, an unsigned
    /// transaction, and returns it with its new hash.
    pub fn patch(&self, mut built: BuiltTransaction) -> Result<BuiltTransaction> {
        if built.signatures.is_some() {
            bail!("A transaction is patched before it's signed, not after");
        }
        let mut tx = conway::Tx::decode_fragment(&built.tx_bytes.0)
            .map_err(|e| anyhow!("The built transaction isn't a Conway transaction: {e}"))?;
        if matches!(tx.auxiliary_data, Nullable::Some(_))
            || tx.transaction_body.auxiliary_data_hash.is_some()
        {
            bail!("The transaction already has metadata");
        }
        let data = self.auxiliary_data();
        tx.transaction_body.auxiliary_data_hash =
            Some(Hasher::<256>::hash_cbor(&data).to_vec().into());
        tx.auxiliary_data = Nullable::Some(data);
        let bytes = tx
            .encode_fragment()
            .map_err(|e| anyhow!("Failed to encode the transaction: {e}"))?;
        built.tx_hash.0 = *tx_id(&bytes)?;
        built.tx_bytes.0 = bytes;
        Ok(built)
    }
}

/// `text` in lines of at most [`MAX_LINE_BYTES`] bytes, cut at the last
/// space that fits when there is one, else between characters.
fn split(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut rest = text;
    while rest.len() > MAX_LINE_BYTES {
        let mut cut = MAX_LINE_BYTES;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let (line, next) = match rest[..cut].rfind(' ') {
            Some(space) if space > 0 => (&rest[..space], &rest[space + 1..]),
            _ => (&rest[..cut], &rest[cut..]),
        };
        lines.push(line.to_string());
        rest = next;
    }
    lines.push(rest.to_string());
    lines
}
