//! The reveal vectors (tests/vectors/messaging_reveal_v1.json), read back
//! through the public API alone. The unit test `reveal_vectors_match_the_file`
//! holds the writing side to them.
//!
//! Every reveal parses to its Seedelf and back to its bytes, under the file's
//! chain, and its messaging register is the one `Seedelf::handle` takes of
//! that Seedelf with the messaging key the file records; every check comes
//! out as the file says at the side it names, read under the check's chain,
//! from the conversation's stored state. The reader's own reveal (made with
//! its key, not the Seedelf's) verifies like the others: why a reveal
//! convinces no one else.

use serde_json::Value;

use seedelf_messaging::session::{
    Chain, Conversation, REVEAL_MAX_LEN, REVEAL_MIN_LEN, Reveal, Seedelf,
};
use seedelf_messaging::{Error, Register, SecretKey};

fn bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap()).unwrap()
}

fn point(value: &Value) -> [u8; 48] {
    bytes(value).try_into().unwrap()
}

fn point32(value: &Value) -> [u8; 32] {
    bytes(value).try_into().unwrap()
}

fn chain(value: &Value) -> Chain {
    let network = u8::try_from(value["network"].as_u64().unwrap()).unwrap();
    Chain::new(network, bytes(&value["policy"]).try_into().unwrap()).unwrap()
}

fn code(error: Error) -> &'static str {
    match error {
        Error::InvalidReveal => "invalid_reveal",
        Error::RevealNotAllowed => "reveal_not_allowed",
        Error::InvalidMessage => "invalid_message",
        Error::InvalidEncoding => "invalid_encoding",
        Error::NotInSubgroup => "not_in_subgroup",
        Error::IdentityPoint => "identity_point",
        other => panic!("unexpected refusal {other:?}"),
    }
}

#[test]
fn every_reveal_and_check_reads_through_the_public_api() {
    let file: Value =
        serde_json::from_str(include_str!("vectors/messaging_reveal_v1.json")).unwrap();
    assert_eq!(file["version"], 1);
    assert_eq!(file["kind"], 2);
    let conversations: Vec<(Conversation, Conversation)> = file["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let initiator = Conversation::from_bytes(&bytes(&c["initiator_state"])).unwrap();
            let responder = Conversation::from_bytes(&bytes(&c["responder_state"])).unwrap();
            assert_eq!(initiator.cid(), responder.cid());
            assert_eq!(initiator.cid().0.to_vec(), bytes(&c["cid"]));
            assert_eq!(
                initiator.initiator_register(),
                Register::from_bytes(&point(&c["base"]), &point(&c["initiator_public"])).unwrap()
            );
            assert_eq!(
                responder.responder_register(),
                Register::from_bytes(&point(&c["base"]), &point(&c["responder_public"])).unwrap()
            );
            (initiator, responder)
        })
        .collect();
    assert_eq!(conversations.len(), 2);

    let read_under = chain(&file["chain"]);
    let reveals = file["reveals"].as_array().unwrap();
    assert_eq!(reveals.len(), 3);
    for r in reveals {
        let body = bytes(&r["reveal"]);
        assert!((REVEAL_MIN_LEN..=REVEAL_MAX_LEN).contains(&body.len()));
        let reveal = Reveal::from_bytes(&read_under, &body).unwrap();
        assert_eq!(reveal.to_bytes(), body);
        let shown = &r["seedelf"];
        assert_eq!(chain(shown), read_under);
        assert_eq!(reveal.name(), &bytes(&shown["name"])[..]);
        let datum =
            Register::from_bytes(&point(&shown["generator"]), &point(&shown["public_value"]))
                .unwrap();
        assert_eq!(*reveal.register(), datum);
        // The handle, rebuilt as its wallet builds it, is the one shown.
        let owner = SecretKey::from_bytes(&point32(&shown["messaging_secret_key"])).unwrap();
        let handle = Seedelf::new(read_under, reveal.name(), datum)
            .unwrap()
            .handle(&owner)
            .unwrap();
        assert_eq!(reveal.seedelf(), handle.seedelf());
        assert_eq!(reveal.messaging_register(), handle.register());
        assert_eq!(reveal.messaging_register(), handle.register());
        assert_eq!(
            reveal.messaging_register().generator_bytes().to_vec(),
            bytes(&shown["base"])
        );
        assert_eq!(
            reveal.messaging_register().public_value_bytes().to_vec(),
            bytes(&shown["messaging_value"])
        );
        assert_ne!(datum.generator_bytes(), handle.register().generator_bytes());
        let plaintext = bytes(&r["plaintext"]);
        assert_eq!(plaintext[0], 2);
        assert_eq!(&plaintext[1..], &body[..]);
        let (_, responder) = &conversations[r["conversation"].as_u64().unwrap() as usize];
        assert_eq!(responder.verify_reveal(&reveal), Ok(()), "{}", r["name"]);
    }

    let checks = file["checks"].as_array().unwrap();
    assert!(checks.len() >= 20);
    for c in checks {
        let (initiator, responder) = &conversations[c["conversation"].as_u64().unwrap() as usize];
        let at = match c["side"].as_str().unwrap() {
            "initiator" => initiator,
            "responder" => responder,
            side => panic!("no side {side}"),
        };
        let result = match Reveal::from_bytes(&chain(c), &bytes(&c["reveal"]))
            .and_then(|r| at.verify_reveal(&r))
        {
            Ok(()) => "ok",
            Err(error) => code(error),
        };
        assert_eq!(result, c["result"].as_str().unwrap(), "{}", c["name"]);
    }
}
