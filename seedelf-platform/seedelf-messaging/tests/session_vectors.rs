//! The session vectors (tests/vectors/messaging_session_v1.json), read back
//! through the public API alone, as another implementation's reader would.
//! The unit test `session_vectors_match_the_file` holds the writing side to
//! them; an independent implementation reproduced every value.
//!
//! The public API draws its own randomness, so a reader here can follow a
//! transcript only up to its own first ratchet step: it reads every
//! first-contact message the responder received, with the responder's
//! handle and the protocol's stamp work, and checks F and every header and
//! inner message on the way. The continuation reads only beside the
//! conversation it continues, which this reader doesn't have: it's refused.
//!
//! The responder's handle is rebuilt as the wallet builds its own: from the
//! Seedelf the file records (its chain, name and datum register) and the
//! responder's messaging key, through `Seedelf::handle`, and it must be the
//! messaging register the file records, on the hashed base h_S.

use serde_json::Value;

use seedelf_messaging::session::{
    Chain, ENVELOPE_SIZES, FIRST_CONTACT_STAMP_BITS, FirstContact, Handle, Inbox, Received,
    Seedelf, open,
};
use seedelf_messaging::{Error, Register, SecretKey};

fn bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap()).unwrap()
}

fn secret(value: &Value) -> SecretKey {
    SecretKey::from_bytes(&bytes(value).try_into().unwrap()).unwrap()
}

fn point(value: &Value) -> [u8; 48] {
    bytes(value).try_into().unwrap()
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
    assert_eq!(
        file["first_contact_stamp_bits"].as_u64(),
        Some(u64::from(FIRST_CONTACT_STAMP_BITS))
    );
    let sessions = file["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 4);
    let (mut read, mut refused) = (0, 0);
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
        assert_eq!(
            first.stamp_digest().to_vec(),
            bytes(&session["stamp"]["digest"])
        );
        let handles: Vec<Handle> = match &session["seedelf"] {
            Value::Null => {
                assert!(session["handle"].is_null());
                Vec::new()
            }
            recorded_seedelf => {
                let seedelf = recorded_seedelf;
                let network = u8::try_from(seedelf["network"].as_u64().unwrap()).unwrap();
                let chain =
                    Chain::new(network, bytes(&seedelf["policy"]).try_into().unwrap()).unwrap();
                let datum = Register::from_bytes(
                    &point(&seedelf["generator"]),
                    &point(&seedelf["public_value"]),
                )
                .unwrap();
                assert_eq!(bytes(&seedelf["name"]), first.to());
                let seedelf_of = Seedelf::new(chain, first.to(), datum).unwrap();
                let handle = seedelf_of.handle(&responder).unwrap();
                let recorded = Register::from_bytes(
                    &point(&session["handle"]["generator"]),
                    &point(&session["handle"]["public_value"]),
                )
                .unwrap();
                assert_eq!(*handle.register(), recorded);
                assert_eq!(
                    handle.register().generator_bytes().to_vec(),
                    bytes(&seedelf["base"])
                );
                assert_eq!(
                    handle.register().public_value_bytes().to_vec(),
                    bytes(&seedelf["messaging_value"])
                );
                // On h_S, never the datum's generator; the initiator's key
                // takes another register of the same Seedelf.
                assert_ne!(handle.register().generator_bytes(), datum.generator_bytes());
                assert_ne!(seedelf_of.handle(&initiator).unwrap(), handle);
                vec![handle]
            }
        };

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
            assert_eq!(opened.stamp(), session["stamp"]["nonce"].as_u64());
            // Arrival times inside the window: t itself.
            let received = inbox.receive(&responder, &handles, &envelope, first.started_at());
            if handles.is_empty() {
                assert_eq!(received, Err(Error::UnverifiedContinuation));
                refused += 1;
                continue;
            }
            let Received::Request { cid, plaintext, .. } = received.unwrap() else {
                panic!("a first-contact message is a request")
            };
            assert_eq!(cid, first.cid());
            assert_eq!(plaintext, bytes(&send["plaintext"]));
            read += 1;
        }
        if let Some(request) = inbox.requests().get(first.cid()) {
            // The other side's key opens none of the responder's envelopes.
            assert!(request.read(&initiator).is_err());
        }
    }
    assert_eq!((read, refused), (7, 1));
}
