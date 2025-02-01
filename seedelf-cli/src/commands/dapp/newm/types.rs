use seedelf_cli::koios::InlineDatum;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct Wallet {
    pub pkh: String,
    pub sc: String,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct Token {
    pub pid: String,
    pub tkn: String,
    pub amt: u64,
}

impl Token {
    pub fn new(pid: String, tkn: String, amt: u64) -> Self {
        Self { pid, tkn, amt }
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct SaleDatum {
    pub owner: Wallet,
    pub bundle: Token,
    pub cost: Token,
    pub max_bundle_size: u64,
}

pub fn extract_token(inline_datum: &Option<InlineDatum>, bundle_flag: bool) -> Option<Token> {
    let position: usize = if bundle_flag {1} else {2};
    inline_datum
        .as_ref()
        .and_then(|datum| match &datum.value {
            Value::Object(value_map) => value_map.get("fields"),
            _ => None,
        })
        .and_then(|fields| match fields {
            Value::Array(fields) => fields.get(position), // Get the third element
            _ => None,
        })
        .and_then(|field| match field {
            Value::Object(field_map) => field_map.get("fields"),
            _ => None,
        })
        .and_then(|fields| match fields {
            Value::Array(fields) => {
                // Extract the pid, tkn, and amt fields
                let pid = fields.get(0).and_then(|field| match field {
                    Value::Object(obj) => obj.get("bytes").and_then(|b| b.as_str().map(String::from)),
                    _ => None,
                })?;

                let tkn = fields.get(1).and_then(|field| match field {
                    Value::Object(obj) => obj.get("bytes").and_then(|b| b.as_str().map(String::from)),
                    _ => None,
                })?;

                let amt = fields.get(2).and_then(|field| match field {
                    Value::Object(obj) => obj.get("int").and_then(|i| i.as_u64()),
                    _ => None,
                })?;

                Some(Token::new(pid, tkn, amt))
            }
            _ => None,
        })
}
