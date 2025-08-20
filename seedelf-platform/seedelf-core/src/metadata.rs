use pallas_codec::minicbor;
use pallas_primitives::KeyValuePairs;
use pallas_primitives::alonzo::{AuxiliaryData, Metadata, Metadatum};

pub fn create_ecies(r_hex: String, c_b64: String) -> Vec<u8> {
    const CHUNK: usize = 64;

    #[inline]
    fn chunked_or_text(s: &str) -> Metadatum {
        if s.len() <= CHUNK {
            Metadatum::Text(s.to_string())
        } else {
            let mut parts = Vec::with_capacity(s.len().div_ceil(CHUNK));
            let mut i = 0;
            while i < s.len() {
                let end = (i + CHUNK).min(s.len());
                // safe for hex/base64 (ASCII)
                parts.push(Metadatum::Text(s[i..end].to_string()));
                i = end;
            }
            Metadatum::Array(parts)
        }
    }

    let md: Metadata = KeyValuePairs::from(vec![(
        44203u64,
        Metadatum::Map(KeyValuePairs::from(vec![
            (Metadatum::Text("element".into()), chunked_or_text(&r_hex)),
            (Metadatum::Text("cypher".into()), chunked_or_text(&c_b64)),
        ])),
    )]);

    let aux = AuxiliaryData::Shelley(md);
    minicbor::to_vec(&aux).unwrap_or_default()
}
