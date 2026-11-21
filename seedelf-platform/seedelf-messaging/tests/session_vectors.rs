//! The session vectors (tests/vectors/messaging_session_v1.json), read back
//! through the public API alone, as another implementation's reader would.
//! The unit test `session_vectors_match_the_file` holds the writing side to
//! them; an independent implementation reproduced every value.
//!
//! The public API draws its own randomness, so a reader here can follow a
//! transcript only up to its own first ratchet step: it reads every
//! first-contact message the responder received, and checks F and every
//! header and inner message on the way.

use serde_json::Value;

use seedelf_messaging::SecretKey;
use seedelf_messaging::session::{ENVELOPE_SIZES, FirstContact, Inbox, Received, open};

fn bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap()).unwrap()
}

fn secret(value: &Value) -> SecretKey {
    SecretKey::from_bytes(&bytes(value).try_into().unwrap()).unwrap()
}

#[test]
fn every_first_contact_message_reads_through_the_public_api() {
    let file: Value =
        serde_json::from_str(include_str!("vectors/messaging_session_v1.json")).unwrap();
    assert_eq!(file["version"], 1);
    assert_eq!(
        file["envelope_sizes"].as_array().unwrap().len(),
        ENVELOPE_SIZES.len()
    );
    let sessions = file["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 3);
    let mut read = 0;
    for session in sessions {
        let initiator = secret(&session["initiator_secret_key"]);
        let responder = secret(&session["responder_secret_key"]);
        let first = FirstContact::from_bytes(&bytes(&session["first_contact"])).unwrap();
        assert_eq!(first.started_at(), session["t"].as_u64().unwrap());
        assert_eq!(first.to(), &bytes(&session["to"])[..]);
        assert_eq!(first.base_bytes().to_vec(), bytes(&session["base"]));
        assert_eq!(
            first.initiator_bytes().to_vec(),
            bytes(&session["initiator_public"])
        );
        assert_eq!(first.cid().0.to_vec(), bytes(&session["draws"]["cid"]));

        let mut inbox = Inbox::new();
        for event in session["events"].as_array().unwrap() {
            let Some(send) = event.get("send") else {
                continue;
            };
            let envelope = bytes(&send["envelope"]);
            assert_eq!(
                envelope.len() as u64,
                send["envelope_size"].as_u64().unwrap()
            );
            let to_responder = send["from"] == "initiator";
            let reader = if to_responder { &responder } else { &initiator };
            let opened = open(reader, &envelope).unwrap();
            assert_eq!(opened.to_bytes(), &bytes(&send["inner"])[..]);
            assert_eq!(opened.header().to_bytes().to_vec(), bytes(&send["header"]));
            if send["kind"] != "first-contact" {
                continue;
            }
            assert!(to_responder);
            assert_eq!(opened.first_contact(), Some(&first));
            // Arrival times inside the window: t itself.
            let received = inbox
                .receive(&responder, &envelope, first.started_at())
                .unwrap();
            let Received::Request { cid, plaintext, .. } = received else {
                panic!("a first-contact message is a request")
            };
            assert_eq!(cid, first.cid());
            assert_eq!(plaintext, bytes(&send["plaintext"]));
            read += 1;
        }
        // The other side's key opens none of the responder's envelopes.
        let request = inbox.requests().get(first.cid()).unwrap();
        assert!(request.read(&initiator).is_err());
    }
    assert_eq!(read, 6);
}
