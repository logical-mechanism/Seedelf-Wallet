use pallas_codec::minicbor;
use pallas_primitives::KeyValuePairs;
use pallas_primitives::alonzo::{AuxiliaryData, Metadata, Metadatum};
use seedelf_core::metadata;

#[test]
fn test_create_ecies_metadata() {
    let r_hex = "92c560122d070b53b9e202a2408d140569d92971d4b3418ed5b524ed046a9df75e9e1af5298a4081fb171408696547f4".to_string();
    let c_b64 =
        "U+MIgO4Q2GkxiYy0J/+iwM/cAklE3QjgL0qCkoZOhIUnFuC8OET2uVt36dq7UwWynLBRB6k=".to_string();
    let bytes = metadata::create_ecies(r_hex, c_b64);
    let hex = hex::encode(&bytes);
    println!("{:?}", hex);
}

#[test]
fn test_ecies_metadata() {
    // {
    //      44203: {
    //          "cypher": "n4JqX6W8DleNKc1Y1WVxZpz3WJL8FI/LvxvfH3SPeSZSlER6pFwVQbY=",
    //          "element": [
    //              "86db30c92a1184a6044f85fef76de6a1f3bd9f2ca26835d8",
    //              "93250392843f2dceeae82fd6f7bc0baf79c33a7ebcd84061"
    //          ]
    //      }
    //  }
    let md: Metadata = KeyValuePairs::from(vec![(
        44203u64,
        Metadatum::Map(KeyValuePairs::from(vec![
            (
                Metadatum::Text("element".into()),
                Metadatum::Array(vec![
                    Metadatum::Text("86db30c92a1184a6044f85fef76de6a1f3bd9f2ca26835d8".into()),
                    Metadatum::Text("93250392843f2dceeae82fd6f7bc0baf79c33a7ebcd84061".into()),
                ]),
            ),
            (
                Metadatum::Text("cypher".into()),
                Metadatum::Text("n4JqX6W8DleNKc1Y1WVxZpz3WJL8FI/LvxvfH3SPeSZSlER6pFwVQbY=".into()),
            ),
        ])),
    )]);

    let aux = AuxiliaryData::Shelley(md);
    let bytes: Vec<u8> = minicbor::to_vec(&aux).unwrap_or_default();
    let hex = hex::encode(&bytes);
    println!("{:?}", hex);
}

#[test]
fn test_simple_metadata() {
    let md: Metadata = KeyValuePairs::from(vec![(
        0u64,
        Metadatum::Map(KeyValuePairs::from(vec![(
            Metadatum::Int(44203.into()),
            Metadatum::Text("acab".into()),
        )])),
    )]);

    let aux = AuxiliaryData::Shelley(md);
    let bytes: Vec<u8> = minicbor::to_vec(&aux).unwrap_or_default();
    let hex = hex::encode(&bytes);
    println!("{:?}", hex);
}
