use pallas_codec::minicbor;
use pallas_primitives::KeyValuePairs;
use pallas_primitives::alonzo::{AuxiliaryData, Metadata, Metadatum};

#[test]
fn test_ecies_metadata() {
    // {0: {44203: {"cypher": "n4JqX6W8DleNKc1Y1WVxZpz3WJL8FI/LvxvfH3SPeSZSlER6pFwVQbY=", "element": ["86db30c92a1184a6044f85fef76de6a1f3bd9f2ca26835d8", "93250392843f2dceeae82fd6f7bc0baf79c33a7ebcd84061"]}
    let md: Metadata = KeyValuePairs::from(vec![(
        0u64,
        Metadatum::Map(KeyValuePairs::from(vec![(
            Metadatum::Int(44203.into()),
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
                    Metadatum::Text(
                        "n4JqX6W8DleNKc1Y1WVxZpz3WJL8FI/LvxvfH3SPeSZSlER6pFwVQbY=".into(),
                    ),
                ),
            ])),
        )])),
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
