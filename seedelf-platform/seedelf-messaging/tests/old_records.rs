//! Records written by development builds before call 16, the 1.10.0 gate's
//! protocol change (tests/fixtures/old_records_v1.json, recorded from the
//! tree at 3ab5bf9f): read through the public API, as the wallet reads its
//! sealed records. Each conversation's and the requests' record is refused
//! by its version at its first byte, never misread or half read, so the
//! wallet can tell an older record from a newer one; the tombstones' layout
//! didn't change, so their record reads and writes back as it was.

use serde_json::Value;

use seedelf_messaging::Error;
use seedelf_messaging::session::{
    Conversation, ConversationId, Requests, STATE_VERSION, Tombstones,
};

fn record(file: &Value, name: &str) -> Vec<u8> {
    hex::decode(file[name].as_str().unwrap()).unwrap()
}

#[test]
fn development_records_are_refused_by_their_version() {
    let file: Value = serde_json::from_str(include_str!("fixtures/old_records_v1.json")).unwrap();
    assert_eq!(STATE_VERSION, 2);
    for name in [
        "initiator_unanswered",
        "initiator_answered",
        "responder_with_five_skipped_keys_in_two_chains",
    ] {
        let bytes = record(&file, name);
        assert_eq!(bytes[0], 1, "{name}");
        assert_eq!(
            Conversation::from_bytes(&bytes).err(),
            Some(Error::UnsupportedStateVersion(1)),
            "{name}"
        );
    }
    let requests = record(&file, "requests_two_requests_three_messages");
    assert_eq!(
        Requests::from_bytes(&requests).err(),
        Some(Error::UnsupportedStateVersion(1))
    );
    // A record written now carries the newer version.
    assert_eq!(Requests::new().to_bytes()[0], 2);

    let bytes = record(&file, "tombstones_one");
    let tombstones = Tombstones::from_bytes(&bytes).unwrap();
    assert_eq!((tombstones.len(), bytes[0]), (1, 1));
    let cid = ConversationId(bytes[5..21].try_into().unwrap());
    assert!(tombstones.holds(cid));
    assert_eq!(tombstones.to_bytes(), bytes);
}
