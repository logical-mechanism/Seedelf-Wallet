//! Seedelf Messaging through the WebAssembly layer (chunk 54's 54d): the
//! session vectors' first messages read at the full first-contact stamp,
//! both vector files' stamps found in slices, two wallets writing to each
//! other through nothing but the bindings' records, the reveal (54f), and
//! every refusal as its code. `node --test tests/messaging.test.mjs` runs the same through
//! the built module.

use std::fs;
use std::path::Path;

use blstrs::Scalar;
use seedelf_crypto::register::Register as CryptoRegister;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_messaging::session::{
    Conversation, Requests, Tombstones, inner_capacity, open as open_envelope,
};
use seedelf_messaging::{Error, SecretKey, encrypt_message};
use seedelf_wasm::api::scalar_from_hex;
use seedelf_wasm::messaging::{
    self, Answer, CheckRevealRequest, ContinueRequest, ContinuesView, DeleteRequest, ExpireRequest,
    FindStampRequest, HandleHex, PostRequest, ReceiveRequest, ReceiveResult, ReceivedView,
    RegisterHex, RequestOf, RequestText, RevealChecked, RevealRequest, Secret, SendRequest,
    SetStampRequest, StartRequest,
};
use serde_json::{Value, json};

const T: u64 = 1_800_000_000;

fn vectors(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../seedelf-messaging/tests/vectors")
        .join(name);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// The records development builds wrote before the gate's call 16, as the
/// crate's tests keep them.
fn old_records() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../seedelf-messaging/tests/fixtures/old_records_v1.json");
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// An answer as JavaScript reads it.
fn json_of<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).unwrap()
}

fn s(value: &Value) -> String {
    value.as_str().unwrap().to_string()
}

fn done<T: std::fmt::Debug>(answer: Answer<T>) -> T {
    match answer {
        Answer::Done(value) => value,
        Answer::Refused { refused, .. } => panic!("refused: {refused}"),
    }
}

fn refused<T: std::fmt::Debug>(answer: Answer<T>) -> &'static str {
    answer
        .refused()
        .unwrap_or_else(|| panic!("expected a refusal, got {answer:?}"))
}

fn register_hex(register: &CryptoRegister) -> RegisterHex {
    RegisterHex {
        generator: register.generator.clone(),
        public_value: register.public_value.clone(),
    }
}

/// A wallet: its key and one Seedelf, a re-randomization of its root
/// register, as a datum holds it.
struct Wallet {
    sk: Scalar,
    name: String,
    seedelf: CryptoRegister,
}

impl Wallet {
    fn new(name_byte: u8) -> Self {
        let sk = random_scalar();
        let seedelf = CryptoRegister::create(sk).unwrap().rerandomize().unwrap();
        // A Seedelf's name: 32 bytes under the 5eed0e1f prefix.
        let name = format!("5eed0e1f{}", hex::encode([name_byte; 28]));
        Wallet { sk, name, seedelf }
    }

    fn handles(&self) -> Vec<HandleHex> {
        vec![HandleHex {
            name: self.name.clone(),
            registers: vec![register_hex(&self.seedelf)],
        }]
    }
}

/// What a request's `receive` takes, all the records given.
fn receive_request(
    envelope: &str,
    now: u64,
    handles: Vec<HandleHex>,
    conversations: Vec<&Secret>,
    requests: Option<&str>,
    bits: Option<u32>,
) -> ReceiveRequest {
    ReceiveRequest {
        envelope: envelope.to_string(),
        now,
        handles,
        conversations: conversations.into_iter().cloned().collect(),
        requests: requests.map(str::to_string),
        tombstones: None,
        first_contact_bits: bits,
    }
}

/// A first-contact stamp at `bits`, found in slices of 4,096 as the worker
/// will, and set.
fn stamped(conversation: &Secret, digest: &str, bits: u32) -> Secret {
    let mut from = 0;
    let nonce = loop {
        let found = done(
            messaging::find_stamp(FindStampRequest {
                digest: digest.to_string(),
                bits,
                from,
                attempts: 4096,
            })
            .unwrap(),
        );
        if let Some(nonce) = found.nonce {
            break nonce;
        }
        from += 4096;
    };
    let set = done(
        messaging::set_stamp(SetStampRequest {
            conversation: conversation.clone(),
            nonce,
        })
        .unwrap(),
    );
    assert!(set.bits >= bits);
    set.conversation
}

fn send(conversation: &Secret, text: &[u8]) -> (Secret, String) {
    let sent = done(
        messaging::send(SendRequest {
            conversation: conversation.clone(),
            plaintext: Secret::of(text),
        })
        .unwrap(),
    );
    (sent.conversation, sent.envelope)
}

fn plaintext_of(result: &ReceiveResult) -> Vec<u8> {
    match &result.received {
        ReceivedView::Message { plaintext, .. } | ReceivedView::Request { plaintext, .. } => {
            hex::decode(plaintext.as_str()).unwrap()
        }
    }
}

/// `writer` starts a conversation with `reader`'s Seedelf, its stamp set at
/// 4 bits: its ID and record.
fn begin(writer: &Wallet, reader: &Wallet) -> (String, Secret) {
    let started = done(
        messaging::start(
            writer.sk,
            StartRequest {
                handle: register_hex(&reader.seedelf),
                to: reader.name.clone(),
                now: T,
            },
        )
        .unwrap(),
    );
    let stamped = stamped(&started.conversation, &started.digest, 4);
    (started.cid, stamped)
}

/// Alice writes first to Bob's Seedelf, Bob accepts and replies, and Alice
/// reads the reply: each side's record then.
fn answered(alice: &Wallet, bob: &Wallet) -> (Secret, Secret) {
    let (cid, a) = begin(alice, bob);
    let (a, first) = send(&a, b"hello Bob");
    let request = done(
        messaging::receive(
            bob.sk,
            receive_request(&first, T + 60, bob.handles(), vec![], None, Some(4)),
        )
        .unwrap(),
    );
    let accepted = done(
        messaging::accept(
            bob.sk,
            RequestOf {
                requests: request.requests.unwrap(),
                cid,
            },
        )
        .unwrap(),
    );
    let (b, reply) = send(&accepted.conversation, b"hello Alice");
    let read = done(
        messaging::receive(
            alice.sk,
            receive_request(&reply, T + 120, vec![], vec![&a], None, None),
        )
        .unwrap(),
    );
    (read.conversation.unwrap(), b)
}

/// The longest text the record's next message carries.
fn most(record: &Secret) -> usize {
    json_of(messaging::conversation_info(record).unwrap())["maxTextLen"]
        .as_u64()
        .unwrap() as usize
}

/// `inner` padded as the session layer pads it, `0x80` then zeros, to fill
/// an envelope of `size` bytes, and sealed to `to` with plain v1, as anyone
/// who knows the register can.
fn sealed(to: &seedelf_messaging::Register, mut inner: Vec<u8>, size: usize) -> String {
    inner.push(0x80);
    inner.resize(inner_capacity(size) + 1, 0);
    hex::encode(encrypt_message(to, &inner).unwrap().to_bytes())
}

/// The session vectors' first messages, read by their responder through the
/// bindings at the full 24 bits, as the wallet will: each envelope opened,
/// then received with the requests' record as the last call left it, then
/// read back, summarized and accepted. Session 3's arrive last first; session
/// 4's `replaces` names a conversation the reader never had; session 2, a
/// continuation without a handle, is refused without the conversation it
/// continues.
#[test]
fn the_vectors_first_messages_read_through_the_bindings() {
    let file = vectors("messaging_session_v1.json");
    assert_eq!(file["first_contact_stamp_bits"], 24);
    let mut read = 0;
    for session in file["sessions"].as_array().unwrap() {
        let bob = scalar_from_hex(session["responder_secret_key"].as_str().unwrap()).unwrap();
        let events = session["events"].as_array().unwrap();
        let send_of = |i: u64| &events[i as usize]["send"];
        let mut handles = Vec::new();
        if !session["handle"].is_null() {
            handles.push(HandleHex {
                name: s(&session["to"]),
                registers: vec![RegisterHex {
                    generator: s(&session["handle"]["generator"]),
                    public_value: s(&session["handle"]["public_value"]),
                }],
            });
        }
        // The responder's receives of first-contact messages, until it sends.
        let firsts: Vec<&Value> = events
            .iter()
            .take_while(|e| e.get("send").is_none_or(|s| s["from"] == "initiator"))
            .filter_map(|e| e.get("receive"))
            .collect();
        assert!(!firsts.is_empty());
        let mut requests: Option<String> = None;
        let mut arrivals = Vec::new();
        let mut texts = Vec::new();
        for receive in firsts {
            let sent = send_of(receive["delivers"].as_u64().unwrap());
            assert_eq!(sent["kind"], "first-contact");
            let envelope = s(&sent["envelope"]);
            let at = receive["at"].as_u64().unwrap();
            let opened = done(messaging::open(bob, &envelope).unwrap());
            assert_eq!(opened.kind, "first-contact");
            assert_eq!(opened.t, session["t"].as_u64());
            assert_eq!(opened.to.as_deref(), session["to"].as_str());
            assert_eq!(opened.replaces.as_deref(), session["replaces"].as_str());
            let answer = messaging::receive(
                bob,
                receive_request(
                    &envelope,
                    at,
                    handles.clone(),
                    vec![],
                    requests.as_deref(),
                    None,
                ),
            )
            .unwrap();
            if session["handle"].is_null() {
                assert_eq!(refused(answer), "unverified_continuation");
                requests = None;
                break;
            }
            let result = done(answer);
            assert_eq!(
                plaintext_of(&result),
                hex::decode(s(&receive["plaintext"])).unwrap()
            );
            let ReceivedView::Request {
                cid, new, evicted, ..
            } = &result.received
            else {
                panic!("a first message is a request");
            };
            assert_eq!(*cid, opened.cid);
            assert_eq!(*new, requests.is_none());
            assert!(evicted.is_empty());
            assert!(result.conversation.is_none());
            requests = result.requests.clone();
            arrivals.push(at);
            texts.push(hex::decode(s(&receive["plaintext"])).unwrap());
            read += 1;
        }
        let Some(requests) = requests else { continue };
        let info = done(messaging::requests_info(&requests).unwrap());
        assert_eq!(info.len(), 1);
        let request = &info[0];
        assert_eq!(request.t, session["t"].as_u64().unwrap());
        assert_eq!(request.to, s(&session["to"]));
        assert_eq!(request.arrivals, arrivals);
        assert_eq!(
            request.continues,
            session["replaces"].as_str().map(|cid| ContinuesView {
                cid: cid.to_string(),
                verified: false,
            })
        );
        let shown = done(
            messaging::read_request(
                bob,
                RequestOf {
                    requests: requests.clone(),
                    cid: request.cid.clone(),
                },
            )
            .unwrap(),
        );
        let shown: Vec<(u64, Vec<u8>)> = shown
            .messages
            .into_iter()
            .map(|m| match m {
                RequestText::Read { at, plaintext } => {
                    (at, hex::decode(plaintext.as_str()).unwrap())
                }
                RequestText::Refused { refused, .. } => panic!("{refused}"),
            })
            .collect();
        assert_eq!(
            shown,
            arrivals.iter().copied().zip(texts).collect::<Vec<_>>()
        );
        let accepted = done(
            messaging::accept(
                bob,
                RequestOf {
                    requests,
                    cid: request.cid.clone(),
                },
            )
            .unwrap(),
        );
        assert!(done(messaging::requests_info(&accepted.requests).unwrap()).is_empty());
        assert_eq!(accepted.continues, request.continues);
        let conversation = messaging::conversation_info(&accepted.conversation).unwrap();
        assert_eq!(conversation.cid, request.cid);
        assert_eq!(conversation.role, "responder");
        assert_eq!(conversation.to, request.to);
        assert!(!conversation.sends_first_contact);
        assert_eq!(conversation.stamp, None);
    }
    // Sessions 1, 3 and 4: two, three and two first messages.
    assert_eq!(read, 7);
}

/// Both vector files' stamps, found in slices at their own work: the
/// session's at 24 bits over F's digest, the relay's at its price over the
/// post's digest, which the bindings compute. Any slice that starts at or
/// before the first nonce with the work finds that nonce.
#[test]
fn the_vectors_stamps_are_found_in_slices() {
    for session in vectors("messaging_session_v1.json")["sessions"]
        .as_array()
        .unwrap()
    {
        let stamp = &session["stamp"];
        let nonce = stamp["nonce"].as_u64().unwrap();
        let find = |from: u64, attempts: u64| {
            done(
                messaging::find_stamp(FindStampRequest {
                    digest: s(&stamp["digest"]),
                    bits: 24,
                    from,
                    attempts,
                })
                .unwrap(),
            )
            .nonce
        };
        assert_eq!(find(nonce - 3000, 3001), Some(nonce));
        assert_eq!(find(nonce - 3000, 3000), None);
        assert_eq!(find(nonce, 1), Some(nonce));
    }
    let relay = vectors("messaging_relay_v1.json");
    for stamp in relay["stamps"].as_array().unwrap() {
        // A stamp names its envelope among the posts.
        let post = relay["posts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|post| post["name"] == stamp["envelope"])
            .unwrap();
        let (envelope, nonce) = (s(&post["envelope"]), stamp["nonce"].as_u64().unwrap());
        let digest = messaging::relay_digest(stamp["pool"].as_str().unwrap(), &envelope).unwrap();
        assert_eq!(digest, s(&stamp["digest"]));
        let found = messaging::find_stamp(FindStampRequest {
            digest,
            bits: stamp["bits"].as_u64().unwrap() as u32,
            from: nonce.saturating_sub(500),
            attempts: 501,
        })
        .unwrap();
        assert_eq!(done(found).nonce, Some(nonce));
        let body = messaging::post_body(PostRequest {
            nonce,
            envelope: envelope.clone(),
        })
        .unwrap();
        assert_eq!(hex::encode(&body[..8]), s(&stamp["post"]));
        assert_eq!(hex::encode(&body[8..]), envelope);
    }
    let digest = s(&relay["stamps"][0]["digest"]);
    let too_hard = messaging::find_stamp(FindStampRequest {
        digest: digest.clone(),
        bits: 33,
        from: 0,
        attempts: 1,
    })
    .unwrap();
    assert_eq!(refused(too_hard), "stamp_too_hard");
    // What isn't a request throws: a digest that isn't 32 bytes, a pool's name past 255.
    assert!(
        messaging::find_stamp(FindStampRequest {
            digest: digest[2..].to_string(),
            bits: 8,
            from: 0,
            attempts: 1,
        })
        .is_err()
    );
    assert!(messaging::relay_digest(&"p".repeat(256), "01").is_err());
}

/// Two wallets write to each other through the bindings alone, each keeping
/// its records as the worker will: a start, its stamp, first messages and a
/// request, the reply, session messages both ways, a continuation, a
/// deletion and its tombstone's expiry. Each refusal on the way is its code
/// and leaves the records as they were.
#[test]
fn two_wallets_write_through_the_bindings() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let other = Wallet::new(0xcc);
    let bits = Some(8);

    // Alice starts a conversation with Bob's Seedelf.
    let start = |handle: &CryptoRegister, to: &str, now: u64| {
        messaging::start(
            alice.sk,
            StartRequest {
                handle: register_hex(handle),
                to: to.to_string(),
                now,
            },
        )
        .unwrap()
    };
    let started = done(start(&bob.seedelf, &bob.name, T));
    let unstamped = messaging::send(SendRequest {
        conversation: started.conversation.clone(),
        plaintext: Secret::of(b"too soon"),
    })
    .unwrap();
    assert_eq!(refused(unstamped), "unstamped");
    let info = messaging::conversation_info(&started.conversation).unwrap();
    assert_eq!((info.role, info.t, info.stamp), ("initiator", T, None));
    assert_eq!(info.to, bob.name);
    assert!(info.sends_first_contact);
    let mut a = stamped(&started.conversation, &started.digest, 8);
    let stamp = messaging::conversation_info(&a).unwrap().stamp.unwrap();
    let (a1, first) = send(&a, b"hello Bob");
    a = a1;
    assert_eq!(first.len(), 2 * 2048, "a first message to a Seedelf's name");
    let (a2, second) = send(&a, b"are you there?");
    a = a2;

    // Bob's scan finds it among others' envelopes, and opening says what it is.
    let elsewhere = done(start(&other.seedelf, &other.name, T));
    let elsewhere = stamped(&elsewhere.conversation, &elsewhere.digest, 4);
    let (_, to_other) = send(&elsewhere, b"not Bob's");
    let batch = vec![to_other.clone(), first.clone(), "01".repeat(512), to_other];
    assert_eq!(messaging::scan(bob.sk, &batch).unwrap(), "0100");
    assert_eq!(messaging::scan(other.sk, &batch).unwrap(), "1001");
    assert!(messaging::scan(bob.sk, &["0x01".to_string()]).is_err());
    let opened = done(messaging::open(bob.sk, &first).unwrap());
    assert_eq!(opened.cid, started.cid);
    assert_eq!(opened.kind, "first-contact");
    assert_eq!(
        (opened.t, opened.to.as_deref()),
        (Some(T), Some(bob.name.as_str()))
    );
    assert_eq!(opened.replaces, None);
    assert_eq!(
        refused(messaging::open(other.sk, &first).unwrap()),
        "not_for_this_key"
    );

    // A first message is judged before any key: its stamp, then its handle and proof.
    let take = |envelope: &str, handles: Vec<HandleHex>, requests: Option<&str>, bits| {
        messaging::receive(
            bob.sk,
            receive_request(envelope, T + 60, handles, vec![], requests, bits),
        )
        .unwrap()
    };
    if stamp.bits < 24 {
        assert_eq!(
            refused(take(&first, bob.handles(), None, None)),
            "stamp_too_low"
        );
    }
    assert_eq!(refused(take(&first, vec![], None, bits)), "unknown_handle");
    let mut wrong = bob.handles();
    wrong[0].registers = vec![register_hex(&other.seedelf)];
    assert_eq!(
        refused(take(&first, wrong, None, bits)),
        "invalid_base_proof"
    );
    // Every register a Seedelf has held is tried: an older one first is no matter.
    let mut held = bob.handles();
    held[0]
        .registers
        .insert(0, register_hex(&CryptoRegister::create(bob.sk).unwrap()));
    let result = done(take(&first, held, None, bits));
    assert_eq!(plaintext_of(&result), b"hello Bob");
    let requests = result.requests.unwrap();
    let joined = done(take(&second, bob.handles(), Some(&requests), bits));
    assert!(matches!(
        joined.received,
        ReceivedView::Request { new: false, .. }
    ));
    let requests = joined.requests.unwrap();
    let again = take(&second, bob.handles(), Some(&requests), bits);
    assert_eq!(refused(again), "key_used_or_deleted");

    // Bob replies: the request becomes his conversation.
    let accepted = done(
        messaging::accept(
            bob.sk,
            RequestOf {
                requests: requests.clone(),
                cid: started.cid.clone(),
            },
        )
        .unwrap(),
    );
    assert_eq!(accepted.continues, None);
    let unknown = messaging::accept(
        bob.sk,
        RequestOf {
            requests: accepted.requests.clone(),
            cid: started.cid.clone(),
        },
    )
    .unwrap();
    assert_eq!(refused(unknown), "unknown_conversation");
    let (mut b, reply) = send(&accepted.conversation, b"hello Alice");
    assert_eq!(reply.len(), 2 * 512);

    // Alice reads it with her conversation's record, and her next is a session message.
    assert_eq!(
        messaging::scan(alice.sk, std::slice::from_ref(&reply)).unwrap(),
        "1"
    );
    let opened = done(messaging::open(alice.sk, &reply).unwrap());
    assert_eq!((opened.kind, opened.t), ("session", None));
    let read = |sk: Scalar, envelope: &str, conversation: &Secret, now: u64| {
        messaging::receive(
            sk,
            receive_request(envelope, now, vec![], vec![conversation], None, None),
        )
        .unwrap()
    };
    // Before the reply, each message carries F (522 bytes to a 32-byte name)
    // and the stamp: less room for text.
    let before = messaging::conversation_info(&a).unwrap();
    assert_eq!(before.sent_in_chain, 2);
    assert_eq!(
        before.max_text_len,
        32_768 - 145 - 1 - (1 + 522 + 8 + 56 + 32)
    );
    let result = done(read(alice.sk, &reply, &a, T + 120));
    assert_eq!(plaintext_of(&result), b"hello Alice");
    assert!(result.requests.is_none());
    a = result.conversation.unwrap();
    let after = messaging::conversation_info(&a).unwrap();
    assert!(!after.sends_first_contact);
    assert_eq!(after.sent_in_chain, 0, "a new sending chain");
    assert_eq!(after.max_text_len, 32_768 - 145 - 1 - 105);
    assert_eq!(after.first_contact_left, None);
    // Without its conversation, a session message is one this browser no longer has.
    let missing = messaging::receive(
        alice.sk,
        receive_request(&reply, T + 120, vec![], vec![], None, None),
    )
    .unwrap();
    assert_eq!(refused(missing), "unknown_conversation");
    let (a3, m1) = send(&a, b"one");
    let (a4, m2) = send(&a3, b"two");
    a = a4;
    assert_eq!(m1.len(), 2 * 512);
    // Out of order: the second first, and the first is then missing until it comes.
    let result = done(read(bob.sk, &m2, &b, T + 180));
    assert_eq!(plaintext_of(&result), b"two");
    b = result.conversation.unwrap();
    assert_eq!(messaging::conversation_info(&b).unwrap().missing, 1);
    // Expired past its 48 hours, the skipped key is gone: the first is never read.
    let expired = messaging::expire(ExpireRequest {
        now: T + 180 + 48 * 3600 + 1,
        conversation: Some(b.clone()),
        tombstones: None,
    })
    .unwrap();
    assert!(expired.tombstones.is_none());
    let gone = expired.conversation.unwrap();
    assert_eq!(messaging::conversation_info(&gone).unwrap().missing, 1);
    assert_eq!(
        refused(read(bob.sk, &m1, &gone, T + 181)),
        "key_used_or_deleted"
    );
    // Within them, it reads.
    let result = done(read(bob.sk, &m1, &b, T + 181));
    assert_eq!(plaintext_of(&result), b"one");
    b = result.conversation.unwrap();
    assert_eq!(messaging::conversation_info(&b).unwrap().missing, 0);
    assert_eq!(
        refused(read(bob.sk, &m1, &b, T + 182)),
        "key_used_or_deleted"
    );

    // Alice continues the conversation with its identities, and no handle.
    let continued = done(
        messaging::start_continuing(
            alice.sk,
            ContinueRequest {
                conversation: a.clone(),
                now: T + 3600,
            },
        )
        .unwrap(),
    );
    assert_eq!(
        messaging::conversation_info(&continued.conversation)
            .unwrap()
            .to,
        ""
    );
    let c = stamped(&continued.conversation, &continued.digest, 8);
    let (_, fresh) = send(&c, b"again");
    let opened = done(messaging::open(bob.sk, &fresh).unwrap());
    assert_eq!(opened.replaces.as_deref(), Some(started.cid.as_str()));
    assert_eq!(opened.to.as_deref(), Some(""));
    let without = messaging::receive(
        bob.sk,
        receive_request(&fresh, T + 3660, bob.handles(), vec![], None, bits),
    )
    .unwrap();
    assert_eq!(refused(without), "unverified_continuation");
    let result = done(
        messaging::receive(
            bob.sk,
            receive_request(&fresh, T + 3660, bob.handles(), vec![&b], None, bits),
        )
        .unwrap(),
    );
    let info = done(messaging::requests_info(result.requests.as_ref().unwrap()).unwrap());
    assert_eq!(
        info[0].continues,
        Some(ContinuesView {
            cid: started.cid.clone(),
            verified: true
        })
    );
    // Bob can't continue it under Alice's key, and nobody starts one with themselves.
    let theirs = messaging::start_continuing(
        other.sk,
        ContinueRequest {
            conversation: b.clone(),
            now: T,
        },
    )
    .unwrap();
    assert_eq!(refused(theirs), "not_for_this_key");
    assert_eq!(
        refused(start(&alice.seedelf, &alice.name, T)),
        "own_register"
    );
    assert_eq!(refused(start(&bob.seedelf, "", T)), "invalid_message");
    let mut bad = register_hex(&bob.seedelf);
    bad.public_value = format!("c0{}", "00".repeat(47));
    let bad = messaging::start(
        alice.sk,
        StartRequest {
            handle: bad,
            to: bob.name.clone(),
            now: T,
        },
    )
    .unwrap();
    assert_eq!(refused(bad), "identity_point");
    let long = messaging::send(SendRequest {
        conversation: a.clone(),
        plaintext: Secret::of(&vec![b'x'; 33_000]),
    })
    .unwrap();
    assert_eq!(refused(long), "message_too_large");

    // Bob deletes the conversation: its ID is a tombstone until t + 48 hours
    // and 7 days, whatever the clock says meanwhile.
    let deleted = done(
        messaging::delete(DeleteRequest {
            cid: started.cid.clone(),
            conversation: Some(b.clone()),
            requests: None,
            tombstones: None,
        })
        .unwrap(),
    );
    assert!(deleted.deleted);
    let (_, m3) = send(&a, b"three");
    let after = |tombstones: &str, now: u64| {
        let mut request = receive_request(&m3, now, vec![], vec![], None, None);
        request.tombstones = Some(tombstones.to_string());
        messaging::receive(bob.sk, request).unwrap()
    };
    assert_eq!(refused(after(&deleted.tombstones, T + 200)), "deleted");
    assert_eq!(refused(after(&deleted.tombstones, T - 3600)), "deleted");
    let expire = |now: u64| {
        messaging::expire(ExpireRequest {
            now,
            conversation: None,
            tombstones: Some(deleted.tombstones.clone()),
        })
        .unwrap()
    };
    // Past the window's 48 hours it's kept, for the margin.
    assert_eq!(
        expire(T + 48 * 3600 + 1).tombstones.as_ref(),
        Some(&deleted.tombstones)
    );
    let expired = expire(T + 48 * 3600 + 7 * 24 * 3600 + 1);
    assert!(expired.conversation.is_none());
    let tombstones = expired.tombstones.unwrap();
    assert_ne!(tombstones, deleted.tombstones);
    assert_eq!(refused(after(&tombstones, T + 200)), "unknown_conversation");
    // Deleting what isn't held deletes nothing.
    let nothing = done(
        messaging::delete(DeleteRequest {
            cid: started.cid.clone(),
            conversation: None,
            requests: None,
            tombstones: Some(tombstones),
        })
        .unwrap(),
    );
    assert!(!nothing.deleted);
}

/// The reveal (protocol.md §19) through the bindings: the vectors' checks
/// come out as the file says, and Alice, once Bob has replied, shows him her
/// Seedelf in a message of kind 0x02, which only Bob checks.
#[test]
fn a_reveal_through_the_bindings() {
    let file = vectors("messaging_reveal_v1.json");
    let check = |conversation: &Value, reveal: &str| {
        messaging::check_reveal(CheckRevealRequest {
            conversation: Secret::from(s(conversation)),
            reveal: reveal.to_string(),
        })
        .unwrap()
    };
    for c in file["checks"].as_array().unwrap() {
        let held = &file["conversations"][c["conversation"].as_u64().unwrap() as usize];
        let state = &held[format!("{}_state", c["side"].as_str().unwrap())];
        let answer = check(state, c["reveal"].as_str().unwrap());
        match c["result"].as_str().unwrap() {
            "ok" => assert!(answer.done().is_some(), "{}", c["name"]),
            code => assert_eq!(answer.refused(), Some(code), "{}", c["name"]),
        }
    }
    for r in file["reveals"].as_array().unwrap() {
        let held = &file["conversations"][r["conversation"].as_u64().unwrap() as usize];
        assert_eq!(
            done(check(
                &held["responder_state"],
                r["reveal"].as_str().unwrap()
            )),
            RevealChecked {
                name: s(&r["seedelf"]["name"]),
                register: RegisterHex {
                    generator: s(&r["seedelf"]["generator"]),
                    public_value: s(&r["seedelf"]["public_value"]),
                },
            }
        );
    }

    // Two wallets: Alice writes first, Bob replies, Alice reads it.
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let started = done(
        messaging::start(
            alice.sk,
            StartRequest {
                handle: register_hex(&bob.seedelf),
                to: bob.name.clone(),
                now: T,
            },
        )
        .unwrap(),
    );
    let early = stamped(&started.conversation, &started.digest, 4);
    let (a, first) = send(&early, b"hello Bob");
    let request = done(
        messaging::receive(
            bob.sk,
            receive_request(&first, T + 60, bob.handles(), vec![], None, Some(4)),
        )
        .unwrap(),
    );
    let accepted = done(
        messaging::accept(
            bob.sk,
            RequestOf {
                requests: request.requests.unwrap(),
                cid: started.cid.clone(),
            },
        )
        .unwrap(),
    );
    let (b, reply) = send(&accepted.conversation, b"hello Alice");
    let read = done(
        messaging::receive(
            alice.sk,
            receive_request(&reply, T + 120, vec![], vec![&a], None, None),
        )
        .unwrap(),
    );
    let a = read.conversation.unwrap();

    let reveal = |sk: Scalar, conversation: &Secret, wallet: &Wallet| {
        messaging::reveal(
            sk,
            RevealRequest {
                conversation: conversation.clone(),
                name: wallet.name.clone(),
                register: register_hex(&wallet.seedelf),
            },
        )
        .unwrap()
    };
    // Not before the reply, not by Bob, and only a Seedelf of Alice's key.
    assert_eq!(
        refused(reveal(alice.sk, &early, &alice)),
        "reveal_not_allowed"
    );
    assert_eq!(refused(reveal(bob.sk, &b, &bob)), "reveal_not_allowed");
    assert_eq!(refused(reveal(alice.sk, &a, &bob)), "not_for_this_key");
    let shown = done(reveal(alice.sk, &a, &alice));
    assert_eq!(shown.reveal.len(), 2 * 257);
    let mut plaintext = vec![0x02];
    plaintext.extend(hex::decode(&shown.reveal).unwrap());
    let (a, carried) = send(&a, &plaintext);
    // 105 bytes of a session message and the reveal's 258 fit the smallest
    // envelope's 366 since the envelope carries a tag of w in place of w:
    // a reveal's size doesn't tell it from a short message.
    assert_eq!(carried.len(), 2 * 512);
    let came = done(
        messaging::receive(
            bob.sk,
            receive_request(&carried, T + 180, vec![], vec![&b], None, None),
        )
        .unwrap(),
    );
    assert_eq!(plaintext_of(&came), plaintext);
    let b = came.conversation.unwrap();
    let checked = |conversation: &Secret, reveal: &str| {
        messaging::check_reveal(CheckRevealRequest {
            conversation: conversation.clone(),
            reveal: reveal.to_string(),
        })
        .unwrap()
    };
    assert_eq!(
        done(checked(&b, &shown.reveal)),
        RevealChecked {
            name: alice.name.clone(),
            register: register_hex(&alice.seedelf),
        }
    );
    assert_eq!(refused(checked(&a, &shown.reveal)), "reveal_not_allowed");
    assert_eq!(
        refused(checked(&b, &shown.reveal[..shown.reveal.len() - 2])),
        "invalid_message"
    );
    assert!(
        messaging::check_reveal(CheckRevealRequest {
            conversation: b,
            reveal: "zz".to_string(),
        })
        .is_err()
    );
}

/// What isn't the wallet's request throws, and changes nothing: a
/// conversation's record that doesn't read, records that hold one
/// conversation twice, hex that isn't, a handle's name past 32 bytes. A
/// requests' record that doesn't read is a refusal instead
/// (`a_requests_record_that_doesnt_read_is_refused_with_its_version`).
#[test]
fn what_isnt_a_request_throws() {
    let (alice, bob) = (Wallet::new(1), Wallet::new(2));
    let started = done(
        messaging::start(
            alice.sk,
            StartRequest {
                handle: register_hex(&bob.seedelf),
                to: bob.name.clone(),
                now: T,
            },
        )
        .unwrap(),
    );
    let a = stamped(&started.conversation, &started.digest, 4);
    let (_, envelope) = send(&a, b"hi");
    let request = |conversations: Vec<Secret>, requests: Option<&str>, handles| ReceiveRequest {
        envelope: envelope.clone(),
        now: T,
        handles,
        conversations,
        requests: requests.map(str::to_string),
        tombstones: None,
        first_contact_bits: Some(4),
    };
    let mut cut = started.conversation.as_str().to_string();
    cut.truncate(cut.len() - 2);
    for broken in [
        request(vec![Secret::from(cut)], None, bob.handles()),
        request(vec![Secret::from("zz".to_string())], None, bob.handles()),
        request(vec![], Some("zz"), bob.handles()),
        request(
            vec![],
            None,
            vec![HandleHex {
                name: "00".repeat(33),
                registers: vec![register_hex(&bob.seedelf)],
            }],
        ),
    ] {
        assert!(messaging::receive(bob.sk, broken).is_err());
    }
    // A request and a conversation of one ID.
    let result = done(messaging::receive(bob.sk, request(vec![], None, bob.handles())).unwrap());
    let requests = result.requests.unwrap();
    let accepted = done(
        messaging::accept(
            bob.sk,
            RequestOf {
                requests: requests.clone(),
                cid: started.cid.clone(),
            },
        )
        .unwrap(),
    );
    let twice = request(vec![accepted.conversation], Some(&requests), bob.handles());
    let error = messaging::receive(bob.sk, twice).unwrap_err().to_string();
    assert!(error.contains("twice"), "{error}");
    assert!(messaging::conversation_info(&Secret::from("01".to_string())).is_err());
    assert!(messaging::requests_info("0").is_err());
    assert_eq!(
        refused(messaging::requests_info("").unwrap()),
        "invalid_state"
    );
}

/// Each of the crate's refusals has its own code, in snake case: the worker
/// branches on them.
#[test]
fn every_refusal_has_its_own_code() {
    let errors = [
        Error::InvalidEncoding,
        Error::NotInSubgroup,
        Error::IdentityPoint,
        Error::InvalidScalar,
        Error::UnsupportedVersion(2),
        Error::InvalidLength,
        Error::PlaintextTooLarge,
        Error::NotForThisKey,
        Error::DecryptionFailed,
        Error::InvalidPadding,
        Error::InvalidMessage,
        Error::MessageTooLarge,
        Error::OutsideWindow,
        Error::Deleted,
        Error::DifferentFirstContact,
        Error::TooFarAhead,
        Error::KeyUsedOrDeleted,
        Error::UnknownConversation,
        Error::UnexpectedMessage,
        Error::OwnRegister,
        Error::ChainExhausted,
        Error::InvalidState,
        Error::UnsupportedStateVersion(2),
        Error::StampTooHard,
        Error::StampTooLow,
        Error::Unstamped,
        Error::UnknownHandle,
        Error::InvalidBaseProof,
        Error::UnverifiedContinuation,
        Error::InvalidKeysProof,
        Error::RequestFull,
        Error::WrongEnvelopeRegister,
        Error::RevealNotAllowed,
        Error::InvalidReveal,
    ];
    assert_eq!(
        messaging::code(Error::InvalidKeysProof),
        "invalid_keys_proof"
    );
    assert_eq!(messaging::code(Error::RequestFull), "request_full");
    let codes: std::collections::BTreeSet<&str> =
        errors.iter().map(|e| messaging::code(*e)).collect();
    assert_eq!(codes.len(), errors.len());
    for code in codes {
        assert!(
            code.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
            "{code}"
        );
    }
    // The relay's vectors name the envelope's refusals the same way.
    for post in vectors("messaging_relay_v1.json")["posts"]
        .as_array()
        .unwrap()
    {
        if let Some(name) = post["error"].as_str() {
            assert!(errors.iter().any(|e| messaging::code(*e) == name), "{name}");
        }
    }
}

/// The JSON JavaScript reads: camelCase, a refusal alone as `{ refused }`,
/// with the record's `version` for `unsupported_state_version` only, a
/// result's absent record left out, and the numbers the worker works by.
#[test]
fn the_answers_json() {
    let refusal: Answer<ReceiveResult> = Answer::Refused {
        refused: "stamp_too_low",
        version: None,
    };
    assert_eq!(
        serde_json::to_value(&refusal).unwrap(),
        json!({ "refused": "stamp_too_low" })
    );
    let old = old_records();
    let refusal =
        messaging::requests_info(&s(&old["requests_two_requests_three_messages"])).unwrap();
    assert_eq!(refusal.refused(), Some("unsupported_state_version"));
    assert_eq!(
        serde_json::to_value(&refusal).unwrap(),
        json!({ "refused": "unsupported_state_version", "version": 1 })
    );
    let message = ReceiveResult {
        received: ReceivedView::Message {
            cid: "00".repeat(16),
            plaintext: Secret::of(b"hi"),
        },
        conversation: Some(Secret::of(b"state")),
        requests: None,
    };
    assert_eq!(
        serde_json::to_value(Answer::Done(message)).unwrap(),
        json!({
            "received": { "kind": "message", "cid": "00".repeat(16), "plaintext": "6869" },
            "conversation": hex::encode(b"state"),
        })
    );
    let request = ReceiveResult {
        received: ReceivedView::Request {
            cid: "11".repeat(16),
            plaintext: Secret::of(b""),
            new: true,
            evicted: vec!["22".repeat(16)],
        },
        conversation: None,
        requests: Some("01".to_string()),
    };
    assert_eq!(
        serde_json::to_value(Answer::Done(request)).unwrap(),
        json!({
            "received": { "kind": "request", "cid": "11".repeat(16), "plaintext": "", "new": true, "evicted": ["22".repeat(16)] },
            "requests": "01",
        })
    );
    let request: ReceiveRequest = serde_json::from_value(json!({
        "envelope": "01", "now": 1, "firstContactBits": 8,
        "handles": [{ "name": "61", "registers": [{ "generator": "aa", "publicValue": "bb" }] }],
    }))
    .unwrap();
    assert_eq!(request.first_contact_bits, Some(8));
    assert_eq!(request.handles[0].registers[0].public_value, "bb");
    assert!(request.conversations.is_empty() && request.requests.is_none());
    assert_eq!(
        serde_json::to_value(messaging::constants()).unwrap(),
        json!({
            "firstContactStampBits": 24,
            "maxStampBits": 32,
            "envelopeSizes": [512, 2048, 8192, 32768],
            "firstContactMaxAge": 172_800,
            "firstContactMaxAhead": 3600,
            "skippedKeyLifetime": 172_800,
            "maxRequests": 50,
            "maxRequestBytes": 262_144,
            "maxRequestMessages": 16,
            "maxOneRequestBytes": 65_536,
            "maxAuthSteps": 4096,
            "priceCeilingBits": 26,
            "requestsVersion": 2,
        })
    );
    // A secret's Debug shows none of it.
    assert_eq!(format!("{:?}", Secret::of(b"key")), "Secret(..)");
}

/// The scan's answer is one digit for each envelope, in order, `1` where it's
/// the key's and `0` where it isn't: a string as long as the batch, whatever
/// matched, each digit written the same way for a match and a miss, so the
/// answer's size and its making say nothing of which matched (the 1.10.0
/// gate's scan-timing#1). An envelope that isn't a v1 envelope with a valid
/// `p` isn't the key's; only one that isn't hex throws.
#[test]
fn the_scan_answers_one_digit_an_envelope() {
    let (alice, bob, other) = (Wallet::new(0xa1), Wallet::new(0xb0), Wallet::new(0xcc));
    let to = |reader: &Wallet| send(&begin(&alice, reader).1, b"hi").1;
    let (to_bob, to_other) = (to(&bob), to(&other));
    let junk = "01".repeat(512);
    let batch = [
        to_other.clone(),
        to_bob.clone(),
        junk,
        to_other.clone(),
        to_bob.clone(),
    ];
    let scan = |key: &Wallet, batch: &[String]| json_of(messaging::scan(key.sk, batch).unwrap());
    assert_eq!(scan(&bob, &batch), json!("01001"));
    assert_eq!(scan(&other, &batch), json!("10010"));
    assert_eq!(scan(&alice, &batch), json!("00000"));
    // All of a batch the key's, or none: the same length.
    let three = vec![to_bob; 3];
    assert_eq!(scan(&bob, &three), json!("111"));
    assert_eq!(scan(&other, &three), json!("000"));
    assert_eq!(scan(&bob, &[]), json!(""));
    assert!(messaging::scan(bob.sk, &["0x01".to_string()]).is_err());
}

/// A writer's share of what a reader keeps before a reply (protocol.md
/// §3.1): 16 first-contact messages and 64 KiB of their inner messages.
/// `firstContactLeft` says what's left of it, each message taking its text
/// and `perMessage` more; `maxTextLen` follows it, 0 once it's used up; and a
/// send past it is refused, `request_full`, with no record (the wallet's is
/// as it was). The reader takes all sixteen as one request. After a reply,
/// and at the responder, there's no share.
#[test]
fn a_writers_share_is_sixteen_first_messages_and_64_kib() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let constants = json_of(messaging::constants());
    let (cid, mut a) = begin(&alice, &bob);
    // F to a 32-byte name, without `replaces`: 522 bytes. A first-contact
    // message adds its type, the stamp, the ratchet header, salt and tag.
    let per_message = 522 + 1 + 8 + 56 + 32;
    let info = json_of(messaging::conversation_info(&a).unwrap());
    assert_eq!(
        info["firstContactLeft"],
        json!({ "messages": 16, "bytes": 65_536, "perMessage": per_message })
    );
    assert_eq!(
        info["firstContactLeft"]["messages"],
        constants["maxRequestMessages"]
    );
    assert_eq!(
        info["firstContactLeft"]["bytes"],
        constants["maxOneRequestBytes"]
    );
    // The envelope binds first: 32 KiB less its 145, the padding's marker,
    // and the message's own.
    assert_eq!(info["maxTextLen"], json!(32_768 - 145 - 1 - per_message));

    let mut requests: Option<String> = None;
    let mut bytes = 65_536;
    let mut texts = Vec::new();
    for i in 0..16 {
        let text = format!("message {i}");
        let (next, envelope) = send(&a, text.as_bytes());
        a = next;
        bytes -= text.len() + per_message;
        let left = &json_of(messaging::conversation_info(&a).unwrap())["firstContactLeft"];
        assert_eq!(
            *left,
            json!({ "messages": 15 - i, "bytes": bytes, "perMessage": per_message })
        );
        let result = done(
            messaging::receive(
                bob.sk,
                receive_request(
                    &envelope,
                    T + 60,
                    bob.handles(),
                    vec![],
                    requests.as_deref(),
                    Some(4),
                ),
            )
            .unwrap(),
        );
        requests = result.requests;
        texts.push(text.into_bytes());
    }
    let info = json_of(messaging::conversation_info(&a).unwrap());
    assert_eq!(info["maxTextLen"], 0);
    let past = messaging::send(SendRequest {
        conversation: a.clone(),
        plaintext: Secret::of(b"one too many"),
    })
    .unwrap();
    assert_eq!(refused(past), "request_full");

    // Bob holds all sixteen as one request, and reads them in order.
    let requests = requests.unwrap();
    let held = json_of(messaging::requests_info(&requests).unwrap());
    assert_eq!(held[0]["arrivals"].as_array().unwrap().len(), 16);
    let shown = done(
        messaging::read_request(
            bob.sk,
            RequestOf {
                requests: requests.clone(),
                cid: cid.clone(),
            },
        )
        .unwrap(),
    );
    let shown: Vec<Vec<u8>> = shown
        .messages
        .into_iter()
        .map(|m| match m {
            RequestText::Read { plaintext, .. } => hex::decode(plaintext.as_str()).unwrap(),
            RequestText::Refused { refused, .. } => panic!("{refused}"),
        })
        .collect();
    assert_eq!(shown, texts);

    // He replies; once Alice reads it, neither side has a share.
    let accepted = done(messaging::accept(bob.sk, RequestOf { requests, cid }).unwrap());
    let (_, reply) = send(&accepted.conversation, b"hello Alice");
    let read = done(
        messaging::receive(
            alice.sk,
            receive_request(&reply, T + 120, vec![], vec![&a], None, None),
        )
        .unwrap(),
    );
    for record in [read.conversation.as_ref().unwrap(), &accepted.conversation] {
        assert_eq!(
            json_of(messaging::conversation_info(record).unwrap())["firstContactLeft"],
            Value::Null
        );
    }

    // The bytes: two of the largest fit, and then not even an empty one.
    let (_, mut a) = begin(&alice, &bob);
    for _ in 0..2 {
        a = send(&a, &vec![b'x'; most(&a)]).0;
    }
    let inner = 32_768 - 145 - 1;
    let info = json_of(messaging::conversation_info(&a).unwrap());
    assert_eq!(
        info["firstContactLeft"],
        json!({ "messages": 14, "bytes": 65_536 - 2 * inner, "perMessage": per_message })
    );
    assert_eq!(info["maxTextLen"], 0);
    let past = messaging::send(SendRequest {
        conversation: a,
        plaintext: Secret::of(b""),
    })
    .unwrap();
    assert_eq!(refused(past), "request_full");
}

/// A later first message of a request is judged before any key meets it: on
/// another header key than the request's first, `invalid_keys_proof`; past
/// the requests' 256 KiB in all, `request_full`, a join never pushing
/// another request out. Both are silent drops for the worker, and give no
/// record. Only a new request, with its own stamp, pushes the oldest out,
/// never itself.
#[test]
fn a_join_is_judged_before_any_key_and_pushes_no_request_out() {
    let bob = Wallet::new(0xb0);
    let writers: Vec<Wallet> = (0..9).map(|i| Wallet::new(0x10 + i)).collect();
    let take = |envelope: &str, requests: Option<&str>| {
        messaging::receive(
            bob.sk,
            receive_request(envelope, T + 60, bob.handles(), vec![], requests, Some(4)),
        )
        .unwrap()
    };
    let inner = 32_768 - 145 - 1;

    // Eight requests of one 32 KiB first message each: within 256 KiB.
    let mut requests: Option<String> = None;
    let mut firsts = Vec::new();
    for writer in &writers[..8] {
        let (cid, record) = begin(writer, &bob);
        let (record, envelope) = send(&record, &vec![b'x'; most(&record)]);
        assert_eq!(envelope.len(), 2 * 32_768);
        let result = done(take(&envelope, requests.as_deref()));
        let ReceivedView::Request { new, evicted, .. } = &result.received else {
            panic!("a first message is a request");
        };
        assert!(*new && evicted.is_empty());
        requests = result.requests;
        firsts.push((cid, record, envelope));
    }
    let requests = requests.unwrap();
    let held = json_of(messaging::requests_info(&requests).unwrap());
    let bytes: u64 = held
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["bytes"].as_u64().unwrap())
        .sum();
    assert_eq!(bytes, 8 * inner as u64);

    // The first writer's first message again, on another header key.
    let (cid0, record0, envelope0) = &firsts[0];
    let key = SecretKey::from_scalar(bob.sk).unwrap();
    let opened = open_envelope(&key, &hex::decode(envelope0).unwrap()).unwrap();
    let mut forged = opened.to_bytes().to_vec();
    let at = 1 + opened.first_contact().unwrap().len() + 8;
    let elsewhere = hex::decode(&register_hex(&bob.seedelf).generator).unwrap();
    forged[at..at + 48].copy_from_slice(&elsewhere);
    let to = Conversation::from_bytes(&hex::decode(record0.as_str()).unwrap())
        .unwrap()
        .responder_register();
    let forged = sealed(&to, forged, 32_768);
    assert_eq!(
        refused(take(&forged, Some(&requests))),
        "invalid_keys_proof"
    );

    // Its second, 1,000 bytes of text: within its own share, not the 256 KiB.
    let (record0, second) = send(record0, &[b'y'; 1000]);
    assert_eq!(refused(take(&second, Some(&requests))), "request_full");
    // A short third fits, and joins.
    let (_, third) = send(&record0, b"z");
    let joined = done(take(&third, Some(&requests)));
    let ReceivedView::Request { new, evicted, .. } = &joined.received else {
        panic!("a join is a request's");
    };
    assert!(!*new && evicted.is_empty());
    let requests = joined.requests.unwrap();

    // A ninth writer's first message is a new request: it pushes the oldest
    // out, the first writer's, and never itself.
    let (cid8, record8) = begin(&writers[8], &bob);
    let (_, envelope8) = send(&record8, &vec![b'x'; most(&record8)]);
    let result = done(take(&envelope8, Some(&requests)));
    let ReceivedView::Request {
        cid, new, evicted, ..
    } = &result.received
    else {
        panic!("a first message is a request");
    };
    assert!(*new);
    assert_eq!(
        (cid, evicted.as_slice()),
        (&cid8, std::slice::from_ref(cid0))
    );
}

/// "Too far ahead" is said only of a session message that authenticates at
/// its conversation's identity and whose envelope's p and c check: past
/// MAX_SKIP (1,000 keys) and within `maxAuthSteps` (4,096), a genuine one is
/// `too_far_ahead`, the conversation can't take it; a forgery past MAX_SKIP,
/// and anything past `maxAuthSteps`, is `decryption_failed`, as any forgery
/// is. So the worker can trust the code. None gives a record: the
/// conversation's is as it was, and reads the chain's first message after.
#[test]
fn too_far_ahead_is_said_only_of_a_message_that_authenticates() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let (a, b) = answered(&alice, &bob);
    let max_auth = json_of(messaging::constants())["maxAuthSteps"]
        .as_u64()
        .expect("the constants give maxAuthSteps") as u32;
    // Alice's next chain, sent natively: its message N makes Bob step N keys.
    let mut chain = Conversation::from_bytes(&hex::decode(a.as_str()).unwrap()).unwrap();
    let mut kept = std::collections::BTreeMap::new();
    for n in 0..=max_auth + 1 {
        let envelope = chain.send(b"far").unwrap();
        if [0, 1001, max_auth, max_auth + 1].contains(&n) {
            kept.insert(n, hex::encode(envelope));
        }
    }
    let take = |envelope: &str| {
        messaging::receive(
            bob.sk,
            receive_request(envelope, T + 300, vec![], vec![&b], None, None),
        )
        .unwrap()
    };
    assert_eq!(refused(take(&kept[&1001])), "too_far_ahead");
    assert_eq!(refused(take(&kept[&max_auth])), "too_far_ahead");
    assert_eq!(refused(take(&kept[&(max_auth + 1)])), "decryption_failed");

    // A forgery of message 1,001, on the same header, sealed to Bob's
    // conversation identity: its ratchet ciphertext is 32 bytes of nothing.
    let key = SecretKey::from_scalar(bob.sk).unwrap();
    let far = open_envelope(&key, &hex::decode(&kept[&1001]).unwrap()).unwrap();
    let mut forged = vec![0x02];
    forged.extend_from_slice(&far.cid().0);
    forged.extend_from_slice(&far.header().to_bytes());
    forged.extend_from_slice(&[0; 32]);
    let forged = sealed(&chain.responder_register(), forged, 512);
    assert_eq!(refused(take(&forged)), "decryption_failed");

    let first = done(take(&kept[&0]));
    assert_eq!(plaintext_of(&first), b"far");
}

/// A requests' record the crate doesn't read is a refusal from each export
/// that reads it, never a throw: `unsupported_state_version` with the
/// record's version, older than this build's (`requestsVersion`) for a
/// development build's record, newer for a later version's, or
/// `invalid_state` for one that doesn't parse. Only bytes that aren't hex
/// throw.
#[test]
fn a_requests_record_that_doesnt_read_is_refused_with_its_version() {
    let old = old_records();
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let (cid, a) = begin(&alice, &bob);
    let (_, envelope) = send(&a, b"hello Bob");
    let records = [
        (
            s(&old["requests_two_requests_three_messages"]),
            json!({ "refused": "unsupported_state_version", "version": 1 }),
        ),
        (
            format!("03{}", "00".repeat(10)),
            json!({ "refused": "unsupported_state_version", "version": 3 }),
        ),
        ("02".to_string(), json!({ "refused": "invalid_state" })),
        (String::new(), json!({ "refused": "invalid_state" })),
    ];
    for (record, refusal) in &records {
        let of = || RequestOf {
            requests: record.clone(),
            cid: cid.clone(),
        };
        let answers = [
            json_of(
                messaging::receive(
                    bob.sk,
                    receive_request(
                        &envelope,
                        T + 60,
                        bob.handles(),
                        vec![],
                        Some(record),
                        Some(4),
                    ),
                )
                .expect("receive refuses, not throws"),
            ),
            json_of(messaging::accept(bob.sk, of()).expect("accept refuses, not throws")),
            json_of(
                messaging::read_request(bob.sk, of()).expect("read_request refuses, not throws"),
            ),
            json_of(messaging::requests_info(record).expect("requests_info refuses, not throws")),
            json_of(
                messaging::delete(DeleteRequest {
                    cid: cid.clone(),
                    conversation: None,
                    requests: Some(record.clone()),
                    tombstones: None,
                })
                .expect("delete refuses, not throws"),
            ),
        ];
        for answer in answers {
            assert_eq!(answer, *refusal, "{record:.8}");
        }
    }
    // The build's own, to tell an older record from a newer one: what a
    // record written now starts with.
    let written = done(
        messaging::delete(DeleteRequest {
            cid: cid.clone(),
            conversation: None,
            requests: None,
            tombstones: None,
        })
        .unwrap(),
    );
    assert_eq!(
        json_of(messaging::constants())["requestsVersion"],
        json!(hex::decode(&written.requests).unwrap()[0])
    );
    assert_eq!(written.requests[..2], *"02");
    assert!(messaging::requests_info("zz").is_err());
}

/// messagingDelete takes a conversation's record the crate doesn't read (a
/// development build's, a later version's, or damaged) as absent: nothing
/// of it is deleted, so it leaves no tombstone, since its `t` can't be read,
/// and the wallet deletes the record itself. A request of that ID still
/// goes, with its tombstone. Only bytes that aren't hex throw.
#[test]
fn delete_takes_a_conversation_record_that_doesnt_read_as_absent() {
    let old = old_records();
    let nothing = json!({
        "deleted": false,
        "requests": hex::encode(Requests::new().to_bytes()),
        "tombstones": hex::encode(Tombstones::new().to_bytes()),
    });
    for record in [
        s(&old["initiator_answered"]),
        s(&old["responder_with_five_skipped_keys_in_two_chains"]),
        "ff".repeat(40),
        "02".to_string(),
    ] {
        let deleted = messaging::delete(DeleteRequest {
            cid: "00".repeat(16),
            conversation: Some(Secret::from(record)),
            requests: None,
            tombstones: None,
        })
        .expect("a record that doesn't read is absent");
        assert_eq!(json_of(deleted), nothing);
    }

    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let (cid, a) = begin(&alice, &bob);
    let (_, envelope) = send(&a, b"hello Bob");
    let take = |requests: Option<&str>, tombstones: Option<String>| {
        let mut request =
            receive_request(&envelope, T + 60, bob.handles(), vec![], requests, Some(4));
        request.tombstones = tombstones;
        messaging::receive(bob.sk, request).unwrap()
    };
    let requests = done(take(None, None)).requests.unwrap();
    let deleted = json_of(
        messaging::delete(DeleteRequest {
            cid: cid.clone(),
            conversation: Some(Secret::from(s(&old["initiator_unanswered"]))),
            requests: Some(requests),
            tombstones: None,
        })
        .unwrap(),
    );
    assert_eq!(deleted["deleted"], true);
    assert_eq!(
        json_of(messaging::requests_info(&s(&deleted["requests"])).unwrap()),
        json!([])
    );
    assert_eq!(
        refused(take(None, Some(s(&deleted["tombstones"])))),
        "deleted"
    );
    assert!(
        messaging::delete(DeleteRequest {
            cid,
            conversation: Some(Secret::from("zz".to_string())),
            requests: None,
            tombstones: None,
        })
        .is_err()
    );
}
