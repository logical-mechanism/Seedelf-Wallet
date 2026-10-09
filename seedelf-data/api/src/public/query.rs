//! A request's query string, read the way `koios.ts` writes it: PostgREST's
//! syntax, but only the exact shapes the wallet sends, in its order. Anything
//! else is a 400, so no one can compose a query the wallet never makes.

use percent_encoding::percent_decode_str;

use crate::state::ApiError;

/// What a request that isn't one of the wallet's is told.
pub const NOT_ASKED: ApiError = ApiError::Bad("not a request Seedelf Wallet makes");

/// The pairs of a query string, percent-decoded, taken in order.
pub struct Query {
    pairs: Vec<(String, String)>,
    next: usize,
}

impl Query {
    pub fn parse(raw: Option<&str>) -> Result<Query, ApiError> {
        let decode = |text: &str| {
            percent_decode_str(text)
                .decode_utf8()
                .map(|text| text.into_owned())
                .map_err(|_| NOT_ASKED)
        };
        let mut pairs = Vec::new();
        for part in raw
            .unwrap_or_default()
            .split('&')
            .filter(|part| !part.is_empty())
        {
            let (key, value) = part.split_once('=').ok_or(NOT_ASKED)?;
            pairs.push((decode(key)?, decode(value)?));
        }
        Ok(Query { pairs, next: 0 })
    }

    /// The next pair's value, if its key is `key`.
    pub fn optional(&mut self, key: &str) -> Option<String> {
        let (k, value) = self.pairs.get(self.next)?;
        (k == key).then(|| {
            self.next += 1;
            value.clone()
        })
    }

    /// The next pair's value: its key must be `key`.
    pub fn value(&mut self, key: &str) -> Result<String, ApiError> {
        self.optional(key).ok_or(NOT_ASKED)
    }

    /// The next pair must be exactly `key=value`.
    pub fn exactly(&mut self, key: &str, value: &str) -> Result<(), ApiError> {
        if self.value(key)? == value {
            Ok(())
        } else {
            Err(NOT_ASKED)
        }
    }

    /// Nothing may be left.
    pub fn end(self) -> Result<(), ApiError> {
        if self.next == self.pairs.len() {
            Ok(())
        } else {
            Err(NOT_ASKED)
        }
    }

    /// No query string at all.
    pub fn none(raw: Option<&str>) -> Result<(), ApiError> {
        Query::parse(raw)?.end()
    }
}

/// A count or an offset: plain decimal digits, as the wallet writes them.
pub fn natural(text: &str) -> Result<i64, ApiError> {
    if text.is_empty() || text.len() > 12 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(NOT_ASKED);
    }
    text.parse().map_err(|_| NOT_ASKED)
}

/// `prefix<n>`, as in `gt.12345`.
pub fn after(text: &str, prefix: &str) -> Result<i64, ApiError> {
    natural(text.strip_prefix(prefix).ok_or(NOT_ASKED)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairs_are_taken_in_order() {
        let mut q = Query::parse(Some("order=tx_hash.asc,tx_index.asc&limit=1000")).unwrap();
        assert!(q.optional("block_height").is_none());
        q.exactly("order", "tx_hash.asc,tx_index.asc").unwrap();
        assert_eq!(q.value("limit").unwrap(), "1000");
        q.end().unwrap();
    }

    #[test]
    fn values_are_percent_decoded() {
        let mut q = Query::parse(Some("select=drep_id,meta_json-%3Ebody-%3EgivenName")).unwrap();
        assert_eq!(
            q.value("select").unwrap(),
            "drep_id,meta_json->body->givenName"
        );
    }

    #[test]
    fn anything_else_is_refused() {
        let mut q = Query::parse(Some("limit=1&offset=2")).unwrap();
        assert!(q.exactly("limit", "2").is_err());
        assert!(Query::parse(Some("limit")).is_err());
        assert!(Query::none(Some("limit=1")).is_err());
        assert!(Query::none(None).is_ok());
        let mut q = Query::parse(Some("limit=1")).unwrap();
        assert!(q.value("offset").is_err());
    }

    #[test]
    fn numbers_are_plain_digits() {
        assert_eq!(natural("1000").unwrap(), 1000);
        for bad in ["", "-1", "+1", "1e3", " 1", "1234567890123"] {
            assert!(natural(bad).is_err(), "{bad}");
        }
        assert_eq!(after("gt.42", "gt.").unwrap(), 42);
        assert!(after("gte.42", "gt.").is_err());
    }
}
