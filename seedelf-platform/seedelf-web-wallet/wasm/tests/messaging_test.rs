//! Seedelf Messaging through the WebAssembly layer (chunk 54's 54d, and
//! chunk 55's 55d: Messages' own key and its certificate): the session
//! vectors' first messages read at the full first-contact stamp, both vector
//! files' stamps found in slices, two wallets writing to each other through
//! nothing but the bindings' records, the reveal (54f), certificates made and
//! checked, the reveal and certificate vectors, and every refusal as its
//! code. Each wallet has a Seedelf key x
//! and a messaging key x_m, apart, as the web wallet derives them
//! (protocol.md §21.2), and a writer starts on the reader's certificate,
//! made with the reader's x and x_m (§21.4, §21.8). `node --test
//! tests/messaging.test.mjs` runs the same through the built module.

use std::fs;
use std::path::Path;

use blstrs::Scalar;
use seedelf_crypto::derivation;
use seedelf_crypto::register::Register as CryptoRegister;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_messaging::session::{
    CERTIFICATE_MAX_LEN, CERTIFICATE_MIN_LEN, Certificate, Conversation, REVEAL_MAX_LEN,
    REVEAL_MIN_LEN, Requests, Seedelf, Tombstones, WITHDRAWAL_LEN, Withdrawal, inner_capacity,
    open as open_envelope,
};
use seedelf_messaging::{Error, Register, SecretKey, encrypt_message};
use seedelf_wasm::api::scalar_from_hex;
use seedelf_wasm::messaging::{
    self, Answer, CertificateChecked, CertificateRequest, CheckCertificateRequest,
    CheckRevealRequest, ContinueRequest, ContinuesView, DeleteRequest, ExpireRequest,
    FindStampRequest, HandleHex, PostRequest, ReceiveRequest, ReceiveResult, ReceivedView,
    RegisterHex, RequestOf, RequestText, RevealChecked, RevealRequest, Secret, SendRequest,
    SetStampRequest, StartRequest,
};
use seedelf_wasm::{MessagingKey, SeedelfKey, messaging_certificate};
use serde_json::{Value, json};

const T: u64 = 1_800_000_000;

/// The network the wallets here write on.
const NET: &str = "preprod";

/// The other network: what each of the network's bindings is held to.
const ELSEWHERE: &str = "mainnet";

fn vectors(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../seedelf-messaging/tests/vectors")
        .join(name);
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// seedelf-crypto's key derivation vectors.
fn key_vectors(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../seedelf-crypto/tests/vectors")
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

/// A certificate for the Seedelf `name` at `register` under `network`,
/// made by the bindings with `sk` (x) and `m` (x_m), hex.
fn certify(sk: Scalar, m: Scalar, network: &str, name: &str, register: &CryptoRegister) -> String {
    done(
        messaging::certificate(
            sk,
            m,
            CertificateRequest {
                network: network.to_string(),
                name: name.to_string(),
                register: register_hex(register),
            },
        )
        .unwrap(),
    )
    .certificate
}

/// A certificate checked by the bindings under `network`.
fn check_certificate(network: &str, certificate: &str) -> Answer<CertificateChecked> {
    messaging::check_certificate(CheckCertificateRequest {
        network: network.to_string(),
        certificate: certificate.to_string(),
    })
    .unwrap()
}

/// m_S = [x_m]h_S for a Seedelf under `network`, computed by the crate from
/// the Seedelf and the key alone (protocol.md §21.3), not by the bindings.
fn messaging_value(network: &str, name: &str, register: &RegisterHex, x_m: Scalar) -> String {
    let point = |hex: &str| -> [u8; 48] { hex::decode(hex).unwrap().try_into().unwrap() };
    let register =
        Register::from_bytes(&point(&register.generator), &point(&register.public_value)).unwrap();
    let seedelf = Seedelf::new(
        messaging::chain(network).unwrap(),
        &hex::decode(name).unwrap(),
        register,
    )
    .unwrap();
    let key = SecretKey::from_scalar(x_m).unwrap();
    hex::encode(
        seedelf
            .handle(&key)
            .unwrap()
            .register()
            .public_value_bytes(),
    )
}

/// The network the bindings name a vector's chain by: the one whose byte
/// it has, when its policy is the Seedelf policy seedelf-core gives that
/// network. The bindings take no chain from outside (protocol.md §21.3), so
/// a vector under any other policy can't be read through them.
fn network_of(chain: &Value) -> Option<&'static str> {
    let network = match chain["network"].as_u64()? {
        0 => "preprod",
        1 => "mainnet",
        _ => return None,
    };
    let policy = hex::encode(messaging::chain(network).unwrap().policy());
    (chain["policy"].as_str()? == policy).then_some(network)
}

/// A wallet: its Seedelf key x and its messaging key x_m, apart, as the web
/// wallet's are; one Seedelf, a re-randomization of x's root register, as a
/// datum holds it; and that Seedelf's certificate, as the relay's list gives
/// it to a writer.
struct Wallet {
    sk: Scalar,
    m: Scalar,
    name: String,
    seedelf: CryptoRegister,
    certificate: String,
}

impl Wallet {
    fn new(name_byte: u8) -> Self {
        let (sk, m) = (random_scalar(), random_scalar());
        assert_ne!(sk, m);
        let seedelf = CryptoRegister::create(sk).unwrap().rerandomize().unwrap();
        // A Seedelf's name: 32 bytes under the 5eed0e1f prefix.
        let name = format!("5eed0e1f{}", hex::encode([name_byte; 28]));
        let certificate = certify(sk, m, NET, &name, &seedelf);
        Wallet {
            sk,
            m,
            name,
            seedelf,
            certificate,
        }
    }

    fn handles(&self) -> Vec<HandleHex> {
        vec![HandleHex {
            name: self.name.clone(),
            registers: vec![register_hex(&self.seedelf)],
        }]
    }

    /// What a writer starts with on this wallet's Seedelf: its name and
    /// register as the writer's read of the contract gives them, and its
    /// certificate from the list.
    fn start_request(&self, now: u64) -> StartRequest {
        StartRequest {
            network: NET.to_string(),
            name: self.name.clone(),
            register: register_hex(&self.seedelf),
            certificate: self.certificate.clone(),
            now,
        }
    }

    /// m_S, what the Seedelf's certificate names.
    fn messaging_value(&self) -> String {
        done(check_certificate(NET, &self.certificate)).messaging
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
        network: NET.to_string(),
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

/// `writer` starts a conversation with `reader`'s Seedelf, on its
/// certificate, with its messaging key, its stamp set at 4 bits: its ID and
/// record.
fn begin(writer: &Wallet, reader: &Wallet) -> (String, Secret) {
    let started = done(messaging::start(writer.m, reader.start_request(T)).unwrap());
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
            bob.m,
            receive_request(&first, T + 60, bob.handles(), vec![], None, Some(4)),
        )
        .unwrap(),
    );
    let accepted = done(
        messaging::accept(
            bob.m,
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
            alice.m,
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
fn sealed(to: &Register, mut inner: Vec<u8>, size: usize) -> String {
    inner.push(0x80);
    inner.resize(inner_capacity(size) + 1, 0);
    hex::encode(encrypt_message(to, &inner).unwrap().to_bytes())
}

/// The session vectors' first messages, read by their responder through the
/// bindings at the full 24 bits, as the wallet will: each envelope opened,
/// then received with the requests' record as the last call left it, then
/// read back, summarized and accepted. The responder's key is its messaging
/// key, and its handle the Seedelf as the chain gives it, its name and datum
/// register, from which the bindings compute M_S, the vector's `handle`.
/// Session 3's arrive last first; session 4's `replaces` names a
/// conversation the reader never had; session 2, a continuation without a
/// handle, is refused without the conversation it continues.
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
        let mut network = NET;
        if !session["handle"].is_null() {
            let seedelf = &session["seedelf"];
            network = network_of(seedelf).unwrap_or_else(|| {
                panic!(
                    "the session vectors' Seedelf is under network {} and policy {}: the \
                     bindings read only the wallet's chains, seedelf-core's policy on \
                     preprod or mainnet",
                    seedelf["network"], seedelf["policy"]
                )
            });
            assert_eq!(s(&seedelf["name"]), s(&session["to"]));
            let register = RegisterHex {
                generator: s(&seedelf["generator"]),
                public_value: s(&seedelf["public_value"]),
            };
            // The bindings' M_S is the vector's handle.
            assert_eq!(
                messaging_value(network, &s(&session["to"]), &register, bob),
                s(&session["handle"]["public_value"])
            );
            handles.push(HandleHex {
                name: s(&session["to"]),
                registers: vec![register],
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
            let mut request = receive_request(
                &envelope,
                at,
                handles.clone(),
                vec![],
                requests.as_deref(),
                None,
            );
            request.network = network.to_string();
            let answer = messaging::receive(bob, request).unwrap();
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
/// its records as the worker will: a start on the reader's certificate, its
/// stamp, first messages and a request, the reply, session messages both
/// ways, a continuation, a deletion and its tombstone's expiry. Each refusal
/// on the way is its code and leaves the records as they were. Every call
/// that reads, writes or proves takes the messaging key; the Seedelf keys
/// make the certificates and nothing else.
#[test]
fn two_wallets_write_through_the_bindings() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let other = Wallet::new(0xcc);
    let bits = Some(8);

    // Alice starts a conversation with Bob's Seedelf, on his certificate.
    let start = |request: StartRequest| messaging::start(alice.m, request).unwrap();
    let started = done(start(bob.start_request(T)));
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
    let elsewhere = done(start(other.start_request(T)));
    let elsewhere = stamped(&elsewhere.conversation, &elsewhere.digest, 4);
    let (_, to_other) = send(&elsewhere, b"not Bob's");
    let batch = vec![to_other.clone(), first.clone(), "01".repeat(512), to_other];
    assert_eq!(messaging::scan(bob.m, &batch).unwrap(), "0100");
    assert_eq!(messaging::scan(other.m, &batch).unwrap(), "1001");
    // Their Seedelf keys find none of it.
    assert_eq!(messaging::scan(bob.sk, &batch).unwrap(), "0000");
    assert_eq!(messaging::scan(other.sk, &batch).unwrap(), "0000");
    assert!(messaging::scan(bob.m, &["0x01".to_string()]).is_err());
    let opened = done(messaging::open(bob.m, &first).unwrap());
    assert_eq!(opened.cid, started.cid);
    assert_eq!(opened.kind, "first-contact");
    assert_eq!(
        (opened.t, opened.to.as_deref()),
        (Some(T), Some(bob.name.as_str()))
    );
    assert_eq!(opened.replaces, None);
    assert_eq!(
        refused(messaging::open(other.m, &first).unwrap()),
        "not_for_this_key"
    );

    // A first message is judged before any key: its stamp, then its handle and proof.
    let take = |envelope: &str, handles: Vec<HandleHex>, requests: Option<&str>, bits| {
        messaging::receive(
            bob.m,
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
            bob.m,
            RequestOf {
                requests: requests.clone(),
                cid: started.cid.clone(),
            },
        )
        .unwrap(),
    );
    assert_eq!(accepted.continues, None);
    let unknown = messaging::accept(
        bob.m,
        RequestOf {
            requests: accepted.requests.clone(),
            cid: started.cid.clone(),
        },
    )
    .unwrap();
    assert_eq!(refused(unknown), "unknown_conversation");
    let (mut b, reply) = send(&accepted.conversation, b"hello Alice");
    assert_eq!(reply.len(), 2 * 2048);

    // Alice reads it with her conversation's record, and her next is a session message.
    assert_eq!(
        messaging::scan(alice.m, std::slice::from_ref(&reply)).unwrap(),
        "1"
    );
    assert_eq!(
        messaging::scan(alice.sk, std::slice::from_ref(&reply)).unwrap(),
        "0"
    );
    let opened = done(messaging::open(alice.m, &reply).unwrap());
    assert_eq!((opened.kind, opened.t), ("session", None));
    let read = |sk: Scalar, envelope: &str, conversation: &Secret, now: u64| {
        messaging::receive(
            sk,
            receive_request(envelope, now, vec![], vec![conversation], None, None),
        )
        .unwrap()
    };
    // Before the reply, each message carries F (522 bytes to a 32-byte name)
    // and the stamp; after it, each is padded to that size anyway (protocol.md §9),
    // so the room for text is the same at both.
    let before = messaging::conversation_info(&a).unwrap();
    assert_eq!(before.sent_in_chain, 2);
    assert_eq!(
        before.max_text_len,
        32_768 - 145 - 1 - (1 + 522 + 8 + 56 + 32)
    );
    let result = done(read(alice.m, &reply, &a, T + 120));
    assert_eq!(plaintext_of(&result), b"hello Alice");
    assert!(result.requests.is_none());
    a = result.conversation.unwrap();
    let after = messaging::conversation_info(&a).unwrap();
    assert!(!after.sends_first_contact);
    assert_eq!(after.sent_in_chain, 0, "a new sending chain");
    assert_eq!(
        after.max_text_len,
        32_768 - 145 - 1 - (1 + 522 + 8 + 56 + 32)
    );
    assert_eq!(after.first_contact_left, None);
    // Without its conversation, a session message is one this browser no longer has.
    let missing = messaging::receive(
        alice.m,
        receive_request(&reply, T + 120, vec![], vec![], None, None),
    )
    .unwrap();
    assert_eq!(refused(missing), "unknown_conversation");
    let (a3, m1) = send(&a, b"one");
    let (a4, m2) = send(&a3, b"two");
    a = a4;
    assert_eq!(m1.len(), 2 * 2048);
    // Out of order: the second first, and the first is then missing until it comes.
    let result = done(read(bob.m, &m2, &b, T + 180));
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
        refused(read(bob.m, &m1, &gone, T + 181)),
        "key_used_or_deleted"
    );
    // Within them, it reads.
    let result = done(read(bob.m, &m1, &b, T + 181));
    assert_eq!(plaintext_of(&result), b"one");
    b = result.conversation.unwrap();
    assert_eq!(messaging::conversation_info(&b).unwrap().missing, 0);
    assert_eq!(
        refused(read(bob.m, &m1, &b, T + 182)),
        "key_used_or_deleted"
    );

    // Alice continues the conversation with its identities, and no handle.
    let continued = done(
        messaging::start_continuing(
            alice.m,
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
    let opened = done(messaging::open(bob.m, &fresh).unwrap());
    assert_eq!(opened.replaces.as_deref(), Some(started.cid.as_str()));
    assert_eq!(opened.to.as_deref(), Some(""));
    let without = messaging::receive(
        bob.m,
        receive_request(&fresh, T + 3660, bob.handles(), vec![], None, bits),
    )
    .unwrap();
    assert_eq!(refused(without), "unverified_continuation");
    let result = done(
        messaging::receive(
            bob.m,
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
    // Bob can't continue it under another's key, nor Alice under her
    // Seedelf key, and nobody starts one with themselves.
    let theirs = messaging::start_continuing(
        other.m,
        ContinueRequest {
            conversation: b.clone(),
            now: T,
        },
    )
    .unwrap();
    assert_eq!(refused(theirs), "not_for_this_key");
    let spending = messaging::start_continuing(
        alice.sk,
        ContinueRequest {
            conversation: a.clone(),
            now: T,
        },
    )
    .unwrap();
    assert_eq!(refused(spending), "not_for_this_key");
    assert_eq!(refused(start(alice.start_request(T))), "own_register");
    let mut nameless = bob.start_request(T);
    nameless.name = String::new();
    assert_eq!(refused(start(nameless)), "invalid_message");
    let mut bad = bob.start_request(T);
    bad.register.public_value = format!("c0{}", "00".repeat(47));
    assert_eq!(refused(start(bad)), "identity_point");
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
        messaging::receive(bob.m, request).unwrap()
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

/// A reader takes a first message with its messaging key x_m alone: its
/// Seedelf key x, the key of the Seedelf the message is addressed to, finds
/// it in no scan, opens nothing, and takes, accepts and reads no request,
/// as the handles it's given are the Seedelf's messaging register M_S under
/// the key passed, never x's register (protocol.md §21.6).
#[test]
fn a_first_message_is_taken_with_the_messaging_key_never_the_seedelf_key() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let (cid, a) = begin(&alice, &bob);
    let (_, first) = send(&a, b"hello Bob");
    let take = |key: Scalar, requests: Option<&str>| {
        messaging::receive(
            key,
            receive_request(&first, T + 60, bob.handles(), vec![], requests, Some(4)),
        )
        .unwrap()
    };

    // The Seedelf key.
    assert_eq!(
        messaging::scan(bob.sk, std::slice::from_ref(&first)).unwrap(),
        "0"
    );
    assert_eq!(
        refused(messaging::open(bob.sk, &first).unwrap()),
        "not_for_this_key"
    );
    assert_eq!(refused(take(bob.sk, None)), "not_for_this_key");

    // The messaging key.
    assert_eq!(
        messaging::scan(bob.m, std::slice::from_ref(&first)).unwrap(),
        "1"
    );
    assert_eq!(done(messaging::open(bob.m, &first).unwrap()).cid, cid);
    let result = done(take(bob.m, None));
    assert_eq!(plaintext_of(&result), b"hello Bob");
    let requests = result.requests.unwrap();

    // The request it made reads, and is accepted, with x_m only.
    let of = || RequestOf {
        requests: requests.clone(),
        cid: cid.clone(),
    };
    let texts: Vec<String> = done(messaging::read_request(bob.m, of()).unwrap())
        .messages
        .into_iter()
        .map(|m| match m {
            RequestText::Read { plaintext, .. } => plaintext.as_str().to_string(),
            RequestText::Refused { refused, .. } => panic!("{refused}"),
        })
        .collect();
    assert_eq!(texts, vec![hex::encode(b"hello Bob")]);
    // With x, the keys proof F carries, over w₀ = [x_m]p₀, isn't the key's.
    assert_eq!(
        refused(messaging::read_request(bob.sk, of()).unwrap()),
        "invalid_keys_proof"
    );
    assert_eq!(
        refused(messaging::accept(bob.sk, of()).unwrap()),
        "invalid_keys_proof"
    );
    let accepted = done(messaging::accept(bob.m, of()).unwrap());
    assert_eq!(
        messaging::conversation_info(&accepted.conversation)
            .unwrap()
            .role,
        "responder"
    );
}

/// The reveal vectors (protocol.md §19, §21.9) through the bindings: each
/// check under a chain the bindings name comes out as the file says at the
/// side it names, and each reveal reads as its Seedelf, the datum register
/// and m_S. A check under another policy can't be asked of the bindings,
/// which take the policy from seedelf-core alone; the crate's own tests
/// hold those.
#[test]
fn the_reveal_vectors_check_through_the_bindings() {
    let file = vectors("messaging_reveal_v1.json");
    let check = |network: &str, conversation: &Value, reveal: &str| {
        messaging::check_reveal(CheckRevealRequest {
            network: network.to_string(),
            conversation: Secret::from(s(conversation)),
            reveal: reveal.to_string(),
        })
        .unwrap()
    };
    let mut asked = [0, 0];
    for c in file["checks"].as_array().unwrap() {
        let Some(network) = network_of(c) else {
            continue;
        };
        let held = &file["conversations"][c["conversation"].as_u64().unwrap() as usize];
        let state = &held[format!("{}_state", c["side"].as_str().unwrap())];
        let answer = check(network, state, c["reveal"].as_str().unwrap());
        match c["result"].as_str().unwrap() {
            "ok" => {
                assert!(answer.done().is_some(), "{}", c["name"]);
                asked[0] += 1;
            }
            code => {
                assert_eq!(answer.refused(), Some(code), "{}", c["name"]);
                asked[1] += 1;
            }
        }
    }
    assert!(
        asked[0] > 0 && asked[1] > 0,
        "the reveal vectors' checks are under no chain the bindings read: {asked:?}"
    );
    for r in file["reveals"].as_array().unwrap() {
        let seedelf = &r["seedelf"];
        let network = network_of(seedelf).unwrap_or_else(|| {
            panic!(
                "the reveal vectors' Seedelf is under network {} and policy {}: the bindings \
                 read only the wallet's chains",
                seedelf["network"], seedelf["policy"]
            )
        });
        let held = &file["conversations"][r["conversation"].as_u64().unwrap() as usize];
        let register = RegisterHex {
            generator: s(&seedelf["generator"]),
            public_value: s(&seedelf["public_value"]),
        };
        assert_eq!(
            done(check(
                network,
                &held["responder_state"],
                r["reveal"].as_str().unwrap()
            )),
            RevealChecked {
                name: s(&seedelf["name"]),
                register: register.clone(),
                messaging: s(&seedelf["messaging_value"]),
            }
        );
        // m_S is the shower's messaging key on the Seedelf's base.
        let owner = scalar_from_hex(seedelf["messaging_secret_key"].as_str().unwrap()).unwrap();
        assert_eq!(
            messaging_value(network, &s(&seedelf["name"]), &register, owner),
            s(&seedelf["messaging_value"])
        );
    }
}

/// The reveal (protocol.md §19, §21.9) between two wallets: Alice, once Bob
/// has replied, shows him her Seedelf in a message of kind 0x02, which only
/// Bob checks. Her reveal is made with her messaging key, never her Seedelf
/// key, on her own certificate, and names the m_S it names. She can't show
/// Bob's Seedelf: his certificate names his m_S (`not_for_this_key`), and one
/// for another register doesn't name his Seedelf (`invalid_certificate`). A
/// reveal is read under the network it was made under, and refused under the
/// other.
#[test]
fn a_reveal_through_the_bindings() {
    // Two wallets: Alice writes first, Bob replies, Alice reads it.
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let started = done(messaging::start(alice.m, bob.start_request(T)).unwrap());
    let early = stamped(&started.conversation, &started.digest, 4);
    let (a, first) = send(&early, b"hello Bob");
    let request = done(
        messaging::receive(
            bob.m,
            receive_request(&first, T + 60, bob.handles(), vec![], None, Some(4)),
        )
        .unwrap(),
    );
    let accepted = done(
        messaging::accept(
            bob.m,
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
            alice.m,
            receive_request(&reply, T + 120, vec![], vec![&a], None, None),
        )
        .unwrap(),
    );
    let a = read.conversation.unwrap();

    let reveal =
        |sk: Scalar, conversation: &Secret, wallet: &Wallet, network: &str, certificate: &str| {
            messaging::reveal(
                sk,
                RevealRequest {
                    network: network.to_string(),
                    conversation: conversation.clone(),
                    name: wallet.name.clone(),
                    register: register_hex(&wallet.seedelf),
                    certificate: certificate.to_string(),
                },
            )
            .unwrap()
        };
    let own = &alice.certificate;
    // Not before the reply, not by Bob, and only with the conversation's own
    // key, her messaging key: never another's, nor her Seedelf key.
    assert_eq!(
        refused(reveal(alice.m, &early, &alice, NET, own)),
        "reveal_not_allowed"
    );
    assert_eq!(
        refused(reveal(bob.m, &b, &bob, NET, &bob.certificate)),
        "reveal_not_allowed"
    );
    // Bob's key on Alice's record, with his own Seedelf and certificate: the
    // conversation's identity isn't his.
    assert_eq!(
        refused(reveal(bob.m, &a, &bob, NET, &bob.certificate)),
        "not_for_this_key"
    );
    // Her certificate names her m_S, which neither Bob's key nor her Seedelf
    // key is.
    assert_eq!(
        refused(reveal(bob.m, &a, &alice, NET, own)),
        "not_for_this_key"
    );
    assert_eq!(
        refused(reveal(alice.sk, &a, &alice, NET, own)),
        "not_for_this_key"
    );
    // Alice can't show Bob's Seedelf: his certificate names his m_S, not
    // hers; and a certificate for another register, hers or his old one,
    // doesn't name that Seedelf.
    assert_eq!(
        refused(reveal(alice.m, &a, &bob, NET, &bob.certificate)),
        "not_for_this_key"
    );
    assert_eq!(
        refused(reveal(alice.m, &a, &bob, NET, own)),
        "invalid_certificate"
    );
    let moved = CryptoRegister::create(bob.sk)
        .unwrap()
        .rerandomize()
        .unwrap();
    let old = certify(bob.sk, bob.m, NET, &bob.name, &moved);
    assert_eq!(
        refused(reveal(alice.m, &a, &bob, NET, &old)),
        "invalid_certificate"
    );
    // Her Seedelf with a certificate that doesn't check, is the other
    // network's, or binds it to another messaging key (another wallet's
    // derivation, or x stolen: protocol.md §21.5).
    let mut bytes = hex::decode(own).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    assert_eq!(
        refused(reveal(alice.m, &a, &alice, NET, &hex::encode(bytes))),
        "invalid_certificate"
    );
    let elsewhere = certify(alice.sk, alice.m, ELSEWHERE, &alice.name, &alice.seedelf);
    assert_eq!(
        refused(reveal(alice.m, &a, &alice, NET, &elsewhere)),
        "invalid_certificate"
    );
    let another = certify(alice.sk, random_scalar(), NET, &alice.name, &alice.seedelf);
    assert_eq!(
        refused(reveal(alice.m, &a, &alice, NET, &another)),
        "not_for_this_key"
    );
    assert!(
        messaging::reveal(
            alice.m,
            RevealRequest {
                network: NET.to_string(),
                conversation: a.clone(),
                name: alice.name.clone(),
                register: register_hex(&alice.seedelf),
                certificate: "zz".to_string(),
            },
        )
        .is_err(),
        "a certificate that isn't hex throws"
    );

    // With her own certificate.
    let shown = done(reveal(alice.m, &a, &alice, NET, own));
    assert_eq!(shown.reveal.len(), 2 * REVEAL_MAX_LEN);
    assert_eq!((REVEAL_MIN_LEN, REVEAL_MAX_LEN), (274, 305));
    let mut plaintext = vec![0x02];
    plaintext.extend(hex::decode(&shown.reveal).unwrap());
    let (a, carried) = send(&a, &plaintext);
    // Padded to its first-contact size, as every message is (protocol.md §9), a
    // reveal is 2 KiB, like any short message: its size doesn't tell it apart.
    assert_eq!(carried.len(), 2 * 2048);
    let came = done(
        messaging::receive(
            bob.m,
            receive_request(&carried, T + 180, vec![], vec![&b], None, None),
        )
        .unwrap(),
    );
    assert_eq!(plaintext_of(&came), plaintext);
    let b = came.conversation.unwrap();
    let checked = |conversation: &Secret, reveal: &str, network: &str| {
        messaging::check_reveal(CheckRevealRequest {
            network: network.to_string(),
            conversation: conversation.clone(),
            reveal: reveal.to_string(),
        })
        .unwrap()
    };
    // Its m_S is the one Alice's certificate names: what Bob's press holds
    // the reveal to, with the register the chain gives the name.
    let alice_m_s = alice.messaging_value();
    assert_eq!(
        done(checked(&b, &shown.reveal, NET)),
        RevealChecked {
            name: alice.name.clone(),
            register: register_hex(&alice.seedelf),
            messaging: alice_m_s.clone(),
        }
    );
    assert_eq!(
        alice_m_s,
        messaging_value(NET, &alice.name, &register_hex(&alice.seedelf), alice.m)
    );
    assert_eq!(
        refused(checked(&a, &shown.reveal, NET)),
        "reveal_not_allowed"
    );
    assert_eq!(
        refused(checked(&b, &shown.reveal[..shown.reveal.len() - 2], NET)),
        "invalid_message"
    );
    // Under the other network, h_S is another point: the reveal doesn't verify.
    assert_eq!(
        refused(checked(&b, &shown.reveal, ELSEWHERE)),
        "invalid_reveal"
    );
    // One made under the other network, with that network's certificate,
    // reads there, and not here. (The bindings' MessagingKey is one
    // network's, so a wallet makes this one only with its other key, on a
    // conversation of that network: the JS tests hold that.)
    let there = done(reveal(alice.m, &a, &alice, ELSEWHERE, &elsewhere));
    let there_checked = done(checked(&b, &there.reveal, ELSEWHERE));
    assert_eq!(there_checked.name, alice.name);
    assert_eq!(there_checked.register, register_hex(&alice.seedelf));
    assert_eq!(
        there_checked.messaging,
        messaging_value(
            ELSEWHERE,
            &alice.name,
            &register_hex(&alice.seedelf),
            alice.m
        )
    );
    assert_ne!(there_checked.messaging, alice_m_s);
    assert_eq!(refused(checked(&b, &there.reveal, NET)), "invalid_reveal");
    // Under the other network, her preprod certificate doesn't check.
    assert_eq!(
        refused(reveal(alice.m, &a, &alice, ELSEWHERE, own)),
        "invalid_certificate"
    );

    assert!(
        messaging::check_reveal(CheckRevealRequest {
            network: NET.to_string(),
            conversation: b,
            reveal: "zz".to_string(),
        })
        .is_err()
    );
}

/// x_m through `MessagingKey`: from the phrase's entropy and from the phrase,
/// on both networks and at every account seedelf-crypto's vectors give, it's
/// the vectors' x_m (seedelf_messaging_key_v1.json), seen by the m_S a
/// certificate the bindings make with it names, which the crate computes
/// here from the vector's x_m. It's never the Seedelf key the same entropy
/// gives, and the two networks' keys are apart.
#[test]
fn the_messaging_key_is_the_vectors_on_both_networks() {
    let file = key_vectors("seedelf_messaging_key_v1.json");
    assert_eq!(file["spec"], "seedelf-messaging-key-v1");
    let name = format!("5eed0e1f{}", hex::encode([0x4d; 28]));
    let mut checked = [0, 0];
    for v in file["vectors"].as_array().unwrap() {
        // MessagingKey derives generation 0, v1's only one.
        if v["generation"] != 0 {
            continue;
        }
        let (index, net, other) = match v["network"].as_u64().unwrap() {
            0 => (0, "preprod", "mainnet"),
            1 => (1, "mainnet", "preprod"),
            n => panic!("network {n}"),
        };
        let account = v["account"].as_u64().unwrap() as u32;
        let phrase = s(&v["phrase"]);
        let entropy = derivation::phrase_to_entropy(&phrase).unwrap().to_vec();
        let seedelf = SeedelfKey::from_entropy(entropy.clone(), account).unwrap();
        let base = seedelf.base_register().unwrap();
        let register = RegisterHex {
            generator: base.generator.clone(),
            public_value: base.public_value.clone(),
        };
        // The m_S a certificate the bindings make with `key` names, under
        // `net`, and the one `messagingValue` gives.
        let m_s_under = |key: &MessagingKey, net: &str| -> String {
            let request = json!({ "network": net, "name": name, "register": register }).to_string();
            let made: Value =
                serde_json::from_str(&messaging_certificate(&seedelf, key, &request).unwrap())
                    .unwrap();
            let named = done(check_certificate(net, &s(&made["certificate"]))).messaging;
            let value: Value =
                serde_json::from_str(&seedelf_wasm::messaging_value(key, &request).unwrap())
                    .unwrap();
            assert_eq!(value, json!({ "messaging": named }));
            named
        };
        let m_s = |key: &MessagingKey| m_s_under(key, net);
        let x_m = scalar_from_hex(v["x_m"].as_str().unwrap()).unwrap();
        let want = messaging_value(net, &name, &register, x_m);
        let from_entropy = MessagingKey::from_entropy(entropy.clone(), account, net).unwrap();
        assert_eq!(from_entropy.network(), net);
        assert_eq!(
            m_s(&from_entropy),
            want,
            "{} / {account} / {net}",
            v["phrase"]
        );
        let from_phrase = MessagingKey::from_phrase(phrase.clone(), account, net).unwrap();
        assert_eq!(m_s(&from_phrase), want);
        assert_eq!(
            m_s(&MessagingKey::from_hex(&s(&v["x_m"]), net).unwrap()),
            want
        );
        // The vector's public value is G1^x_m, and isn't the Seedelf key's.
        let public = SeedelfKey::from_hex(&s(&v["x_m"])).unwrap();
        assert_eq!(
            public.base_register().unwrap().public_value,
            s(&v["public_value"])
        );
        assert_ne!(s(&v["public_value"]), base.public_value);
        // The certificates above took the two as two keys; x_m given as both is `same_key`.
        let request = json!({ "network": net, "name": name, "register": register }).to_string();
        let same: Value =
            serde_json::from_str(&messaging_certificate(&public, &from_entropy, &request).unwrap())
                .unwrap();
        assert_eq!(same, json!({ "refused": "same_key" }));
        // The other network's key is another: on that network's chain, its
        // m_S isn't this x_m's.
        let elsewhere = MessagingKey::from_entropy(entropy, account, other).unwrap();
        assert_eq!(elsewhere.network(), other);
        assert_ne!(
            m_s_under(&elsewhere, other),
            messaging_value(other, &name, &register, x_m)
        );
        checked[index] += 1;
    }
    // Every v1 phrase on each network, and account 1 once, on preprod.
    assert_eq!(checked, [8, 7]);
}

/// A certificate made through the bindings with a wallet's x and x_m, and
/// checked by anyone with no key: it's 273 to 304 bytes, names the Seedelf
/// and the m_S the crate computes from x_m, and checks only under the network
/// it was made for. Made again, it's other bytes for the same key; changed in
/// any part it doesn't check.
#[test]
fn a_certificate_round_trips() {
    let alice = Wallet::new(0xa1);
    let made = &alice.certificate;
    assert_eq!(made.len(), 2 * CERTIFICATE_MAX_LEN);
    assert_eq!((CERTIFICATE_MIN_LEN, CERTIFICATE_MAX_LEN), (273, 304));
    let want = CertificateChecked {
        name: alice.name.clone(),
        register: register_hex(&alice.seedelf),
        messaging: messaging_value(NET, &alice.name, &register_hex(&alice.seedelf), alice.m),
    };
    assert_eq!(done(check_certificate(NET, made)), want);
    // Its JSON, as JavaScript reads it.
    assert_eq!(
        json_of(check_certificate(NET, made)),
        json!({
            "name": alice.name,
            "register": { "generator": alice.seedelf.generator, "publicValue": alice.seedelf.public_value },
            "messaging": want.messaging,
        })
    );
    assert_eq!(
        json_of(
            messaging::certificate(
                alice.sk,
                alice.m,
                CertificateRequest {
                    network: NET.to_string(),
                    name: alice.name.clone(),
                    register: register_hex(&alice.seedelf),
                },
            )
            .unwrap()
        )
        .as_object()
        .unwrap()
        .keys()
        .collect::<Vec<_>>(),
        vec!["certificate"]
    );
    // Its head: version 1, the network's byte, generation 0, the chain's policy.
    let bytes = hex::decode(made).unwrap();
    let policy = seedelf_core::constants::get_config(seedelf_core::constants::VARIANT, true)
        .unwrap()
        .contract
        .seedelf_policy_id;
    assert_eq!(bytes[..3], [0x01, 0x00, 0x00]);
    assert_eq!(hex::encode(&bytes[3..31]), policy);
    // Another for the same Seedelf: another aux, other bytes, the same m_S.
    let again = certify(alice.sk, alice.m, NET, &alice.name, &alice.seedelf);
    assert_ne!(&again, made);
    assert_eq!(done(check_certificate(NET, &again)), want);
    // A 1-byte name: the shortest.
    let short = certify(alice.sk, alice.m, NET, "61", &alice.seedelf);
    assert_eq!(short.len(), 2 * CERTIFICATE_MIN_LEN);
    assert_eq!(done(check_certificate(NET, &short)).name, "61");
    // Under the other network, it doesn't check; one made there checks there.
    assert_eq!(
        refused(check_certificate(ELSEWHERE, made)),
        "invalid_certificate"
    );
    let there = certify(alice.sk, alice.m, ELSEWHERE, &alice.name, &alice.seedelf);
    assert_eq!(hex::decode(&there).unwrap()[1], 0x01);
    assert_eq!(
        done(check_certificate(ELSEWHERE, &there)).messaging,
        messaging_value(
            ELSEWHERE,
            &alice.name,
            &register_hex(&alice.seedelf),
            alice.m
        )
    );
    assert_eq!(
        refused(check_certificate(NET, &there)),
        "invalid_certificate"
    );
    // Each part changed: the version, the generation, the policy, the name,
    // a proof's byte, a byte more or less.
    let changed = |at: usize| {
        let mut bytes = bytes.clone();
        bytes[at] ^= 0x01;
        hex::encode(bytes)
    };
    assert_eq!(
        refused(check_certificate(NET, &changed(0))),
        "unsupported_version"
    );
    for at in [
        1,
        2,
        3,
        30,
        31,
        32,
        63,
        bytes.len() - 96,
        bytes.len() - 64,
        bytes.len() - 1,
    ] {
        assert_eq!(
            refused(check_certificate(NET, &changed(at))),
            "invalid_certificate",
            "byte {at}"
        );
    }
    assert_eq!(
        refused(check_certificate(NET, &format!("{made}00"))),
        "invalid_certificate"
    );
    assert_eq!(
        refused(check_certificate(NET, &made[..made.len() - 2])),
        "invalid_certificate"
    );
    assert_eq!(refused(check_certificate(NET, "")), "invalid_certificate");
    // m_S as the identity point: its own code, as everywhere.
    let at = bytes.len() - 96 - 48;
    let mut identity = bytes.clone();
    identity[at..at + 48].fill(0);
    identity[at] = 0xc0;
    assert_eq!(
        refused(check_certificate(NET, &hex::encode(identity))),
        "identity_point"
    );
    // Bytes that aren't hex throw.
    assert!(
        messaging::check_certificate(CheckCertificateRequest {
            network: NET.to_string(),
            certificate: "zz".to_string(),
        })
        .is_err()
    );
}

/// The wallet's own m_S for one of its Seedelfs, from the messaging key
/// alone (`messaging::value`, protocol.md §21.3, §21.8): what its own
/// certificate for that register names, and nothing it can't make from x_m.
/// Another register, another messaging key and the other network's chain
/// each give another; a register or name that isn't one is its code, and a
/// network the wallet has none of throws.
#[test]
fn a_seedelfs_own_messaging_value_is_its_certificates() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let value = |m: Scalar, network: &str, name: &str, register: &RegisterHex| {
        messaging::value(
            m,
            messaging::ValueRequest {
                network: network.to_string(),
                name: name.to_string(),
                register: register.clone(),
            },
        )
        .unwrap()
    };
    let register = register_hex(&alice.seedelf);
    let own = done(value(alice.m, NET, &alice.name, &register)).messaging;
    assert_eq!(own, alice.messaging_value());
    assert_eq!(own, messaging_value(NET, &alice.name, &register, alice.m));
    assert_eq!(
        json_of(value(alice.m, NET, &alice.name, &register)),
        json!({ "messaging": own })
    );
    // A certificate names it, and only Alice's keys make one that does.
    assert_ne!(own, bob.messaging_value());
    // Another register of the same key, after a move: another base.
    let moved = CryptoRegister::create(alice.sk)
        .unwrap()
        .rerandomize()
        .unwrap();
    let after = done(value(alice.m, NET, &alice.name, &register_hex(&moved))).messaging;
    assert_ne!(after, own);
    assert_eq!(
        after,
        done(check_certificate(
            NET,
            &certify(alice.sk, alice.m, NET, &alice.name, &moved)
        ))
        .messaging
    );
    // Another name, another messaging key, the other network's chain.
    assert_ne!(
        done(value(alice.m, NET, &bob.name, &register)).messaging,
        own
    );
    assert_ne!(
        done(value(bob.m, NET, &alice.name, &register)).messaging,
        own
    );
    assert_ne!(
        done(value(alice.m, ELSEWHERE, &alice.name, &register)).messaging,
        own
    );
    // It takes any register, as M_S is a hash's: no ownership is asked of x_m.
    assert_eq!(
        done(value(
            alice.m,
            NET,
            &alice.name,
            &register_hex(&bob.seedelf)
        ))
        .messaging,
        messaging_value(NET, &alice.name, &register_hex(&bob.seedelf), alice.m)
    );
    // What isn't a Seedelf.
    let mut identity = register.clone();
    identity.public_value = format!("c0{}", "00".repeat(47));
    assert_eq!(
        refused(value(alice.m, NET, &alice.name, &identity)),
        "identity_point"
    );
    assert_eq!(
        refused(value(alice.m, NET, "", &register)),
        "invalid_message"
    );
    assert!(
        messaging::value(
            alice.m,
            messaging::ValueRequest {
                network: "preview".to_string(),
                name: alice.name.clone(),
                register: register.clone(),
            },
        )
        .is_err()
    );
    // The binding's own, natively: a MessagingKey of the same x_m.
    let key = MessagingKey::from_hex(&hex::encode(alice.m.to_bytes_be()), NET).unwrap();
    let request = json!({ "network": NET, "name": alice.name, "register": register }).to_string();
    assert_eq!(
        serde_json::from_str::<Value>(&seedelf_wasm::messaging_value(&key, &request).unwrap())
            .unwrap(),
        json!({ "messaging": own })
    );
}

/// SHA-256 of `parts`, by cryptoxide, not the crate: what a relay's own
/// implementation would compute.
fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    cryptoxide::hashing::sha256(&parts.concat())
}

/// A withdrawal (protocol.md §21.7) through the bindings: the wallet's own
/// certificate taken down with its messaging key alone. Its 98 bytes are
/// version 1, the network's byte and the certificate's listing digest under
/// the pool's name, then the proof, which checks against that certificate
/// as the relay checks it and against no other; `digest` is what its post's
/// stamp is solved over. Another wallet's certificate, and the wallet's own
/// Seedelf certified under another messaging key, are `not_for_this_key`; a
/// certificate that doesn't check is refused with its code.
#[test]
fn a_withdrawal_takes_down_only_the_wallets_own_certificate() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let withdraw = |m: Scalar, network: &str, certificate: &str| {
        messaging::withdrawal(
            m,
            messaging::WithdrawalRequest {
                network: network.to_string(),
                certificate: certificate.to_string(),
            },
        )
        .unwrap()
    };
    let checks = |network: &str, withdrawal: &str, certificate: &str| {
        let chain = messaging::chain(network).unwrap();
        let certificate =
            Certificate::from_bytes(&chain, &hex::decode(certificate).unwrap()).unwrap();
        Withdrawal::from_bytes(&chain, &hex::decode(withdrawal).unwrap())
            .and_then(|withdrawal| withdrawal.check(&certificate))
    };
    for (network, byte, mine) in [
        (NET, 0x00, alice.certificate.clone()),
        (
            ELSEWHERE,
            0x01,
            certify(alice.sk, alice.m, ELSEWHERE, &alice.name, &alice.seedelf),
        ),
    ] {
        let made = done(withdraw(alice.m, network, &mine));
        assert_eq!(
            json_of(withdraw(alice.m, network, &mine))
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            vec!["digest", "withdrawal"],
            "its two fields, by name"
        );
        let bytes = hex::decode(&made.withdrawal).unwrap();
        assert_eq!((bytes.len(), WITHDRAWAL_LEN), (98, 98));
        assert_eq!(bytes[..2], [0x01, byte]);
        let pool = network.as_bytes();
        let listing = sha256(&[
            b"Seedelf-Messaging|v1|listing-stamp|",
            &[pool.len() as u8],
            pool,
            &hex::decode(&mine).unwrap(),
        ]);
        assert_eq!(bytes[2..34], listing, "the certificate's listing digest");
        let unlisting = sha256(&[
            b"Seedelf-Messaging|v1|unlisting-stamp|",
            &[pool.len() as u8],
            pool,
            &bytes,
        ]);
        assert_eq!(made.digest, hex::encode(unlisting), "its stamp's digest");
        // The relay's checks: it takes this certificate down, and no other.
        assert_eq!(checks(network, &made.withdrawal, &mine), Ok(()));
        let again = certify(alice.sk, alice.m, network, &alice.name, &alice.seedelf);
        assert_eq!(
            checks(network, &made.withdrawal, &again),
            Err(Error::InvalidWithdrawal),
            "a later posting, another aux, another digest"
        );
        let theirs = certify(bob.sk, bob.m, network, &bob.name, &bob.seedelf);
        assert_eq!(
            checks(network, &made.withdrawal, &theirs),
            Err(Error::InvalidWithdrawal)
        );
        // Under the other network's chain it doesn't read.
        let other = if network == NET { ELSEWHERE } else { NET };
        assert_eq!(
            Withdrawal::from_bytes(&messaging::chain(other).unwrap(), &bytes),
            Err(Error::InvalidWithdrawal)
        );
        // Changed in its proof, it doesn't check.
        let mut forged = bytes.clone();
        forged[97] ^= 0x01;
        assert_eq!(
            checks(network, &hex::encode(forged), &mine),
            Err(Error::InvalidWithdrawal)
        );
        // Made again: another aux, other bytes, the same certificate's.
        let second = done(withdraw(alice.m, network, &mine));
        assert_ne!(second.withdrawal, made.withdrawal);
        assert_ne!(second.digest, made.digest);
        assert_eq!(hex::decode(&second.withdrawal).unwrap()[..34], bytes[..34]);
        assert_eq!(checks(network, &second.withdrawal, &mine), Ok(()));
    }

    // Not the key's: another wallet's certificate, her own Seedelf certified
    // under another messaging key, and her Seedelf key in x_m's place.
    assert_eq!(
        refused(withdraw(alice.m, NET, &bob.certificate)),
        "not_for_this_key"
    );
    let another = certify(alice.sk, random_scalar(), NET, &alice.name, &alice.seedelf);
    assert_eq!(
        refused(withdraw(alice.m, NET, &another)),
        "not_for_this_key"
    );
    assert_eq!(
        refused(withdraw(alice.sk, NET, &alice.certificate)),
        "not_for_this_key"
    );
    // A certificate that doesn't check, by its code.
    let bytes = hex::decode(&alice.certificate).unwrap();
    let changed = |at: usize| {
        let mut bytes = bytes.clone();
        bytes[at] ^= 0x01;
        hex::encode(bytes)
    };
    assert_eq!(
        refused(withdraw(alice.m, NET, &changed(bytes.len() - 1))),
        "invalid_certificate"
    );
    assert_eq!(
        refused(withdraw(alice.m, NET, &changed(0))),
        "unsupported_version"
    );
    let cut = &alice.certificate[..alice.certificate.len() - 2];
    assert_eq!(refused(withdraw(alice.m, NET, cut)), "invalid_certificate");
    assert_eq!(refused(withdraw(alice.m, NET, "")), "invalid_certificate");
    let at = bytes.len() - 96 - 48;
    let mut identity = bytes.clone();
    identity[at..at + 48].fill(0);
    identity[at] = 0xc0;
    assert_eq!(
        refused(withdraw(alice.m, NET, &hex::encode(identity))),
        "identity_point"
    );
    let there = certify(alice.sk, alice.m, ELSEWHERE, &alice.name, &alice.seedelf);
    assert_eq!(
        refused(withdraw(alice.m, NET, &there)),
        "invalid_certificate"
    );
    // What isn't a request throws.
    for (network, certificate) in [("preview", alice.certificate.as_str()), (NET, "zz")] {
        assert!(
            messaging::withdrawal(
                alice.m,
                messaging::WithdrawalRequest {
                    network: network.to_string(),
                    certificate: certificate.to_string(),
                },
            )
            .is_err()
        );
    }
    // The binding's own, natively: a MessagingKey of the same x_m.
    let key = MessagingKey::from_hex(&hex::encode(alice.m.to_bytes_be()), NET).unwrap();
    let request = json!({ "network": NET, "certificate": alice.certificate }).to_string();
    let answer: Value =
        serde_json::from_str(&seedelf_wasm::messaging_withdrawal(&key, &request).unwrap()).unwrap();
    assert_eq!(
        checks(
            NET,
            answer["withdrawal"].as_str().unwrap(),
            &alice.certificate
        ),
        Ok(())
    );
}

/// The certificate vectors' good withdrawals replayed through the bindings:
/// each made again with its messaging key on its certificate. The bindings
/// draw their own aux, so the proof is other bytes, checked as the relay
/// checks one; what comes before it (version, network and the certificate's
/// listing digest) is the vector's, and each digest is recomputed from its
/// labels. Checking a withdrawal is the relay's, and the crate's tests hold
/// the vectors' refusals.
#[test]
fn the_vectors_withdrawals_are_made_again_through_the_bindings() {
    let file = vectors("messaging_certificate_v1.json");
    assert_eq!(
        file["listing_stamp_label"],
        "Seedelf-Messaging|v1|listing-stamp|"
    );
    assert_eq!(
        file["unlisting_stamp_label"],
        "Seedelf-Messaging|v1|unlisting-stamp|"
    );
    let certificates = file["certificates"].as_array().unwrap();
    let mut pools = std::collections::BTreeSet::new();
    for w in file["withdrawals"].as_array().unwrap() {
        let pool = w["pool"].as_str().unwrap();
        let network = network_of(&json!({
            "network": w["network"],
            "policy": certificates[w["certificate"].as_u64().unwrap() as usize]["policy"],
        }))
        .unwrap_or_else(|| panic!("{}: under no chain the bindings read", w["name"]));
        assert_eq!(network, pool);
        pools.insert(pool);
        let certificate =
            s(&certificates[w["certificate"].as_u64().unwrap() as usize]["certificate"]);
        let vector = hex::decode(s(&w["withdrawal"])).unwrap();
        // The vector's own digests, from their labels.
        let listing = sha256(&[
            b"Seedelf-Messaging|v1|listing-stamp|",
            &[pool.len() as u8],
            pool.as_bytes(),
            &hex::decode(&certificate).unwrap(),
        ]);
        assert_eq!(s(&w["digest"]), hex::encode(listing));
        assert_eq!(vector[2..34], listing);
        let unlisting = |bytes: &[u8]| {
            hex::encode(sha256(&[
                b"Seedelf-Messaging|v1|unlisting-stamp|",
                &[pool.len() as u8],
                pool.as_bytes(),
                bytes,
            ]))
        };
        assert_eq!(s(&w["unlisting_digest"]), unlisting(&vector));
        // Made again by the bindings with the vector's key.
        let x_m = scalar_from_hex(w["messaging_secret_key"].as_str().unwrap()).unwrap();
        let made = done(
            messaging::withdrawal(
                x_m,
                messaging::WithdrawalRequest {
                    network: network.to_string(),
                    certificate: certificate.clone(),
                },
            )
            .unwrap(),
        );
        let bytes = hex::decode(&made.withdrawal).unwrap();
        assert_ne!(bytes, vector, "the bindings' own aux");
        assert_eq!(bytes[..34], vector[..34], "{}", w["name"]);
        assert_eq!(made.digest, unlisting(&bytes));
        let chain = messaging::chain(network).unwrap();
        let held = Certificate::from_bytes(&chain, &hex::decode(&certificate).unwrap()).unwrap();
        for withdrawal in [&bytes, &vector] {
            assert_eq!(
                Withdrawal::from_bytes(&chain, withdrawal).and_then(|w| w.check(&held)),
                Ok(()),
                "{}",
                w["name"]
            );
        }
        // And through the export, with a MessagingKey of that network.
        let key =
            MessagingKey::from_hex(w["messaging_secret_key"].as_str().unwrap(), network).unwrap();
        let request = json!({ "network": network, "certificate": certificate }).to_string();
        let answer: Value =
            serde_json::from_str(&seedelf_wasm::messaging_withdrawal(&key, &request).unwrap())
                .unwrap();
        let exported = hex::decode(answer["withdrawal"].as_str().unwrap()).unwrap();
        assert_eq!(exported[..34], vector[..34]);
        assert_eq!(answer["digest"], json!(unlisting(&exported)));
    }
    assert_eq!(
        pools.len(),
        2,
        "the withdrawal vectors are on both networks"
    );
}

/// The certificate vectors (protocol.md §21.4) through the bindings: each
/// good certificate checks under its network and names its Seedelf and m_S;
/// each refusal under a chain the bindings name comes out as the file says;
/// one the bindings make with a vector's two keys, from an aux of their own,
/// is other bytes for the same m_S; and a writer starts on each good one.
#[test]
fn the_certificate_vectors_check_through_the_bindings() {
    let file = vectors("messaging_certificate_v1.json");
    assert_eq!(file["version"], 1);
    assert_eq!(file["networks"], json!({ "preprod": 0, "mainnet": 1 }));
    let mut networks = std::collections::BTreeSet::new();
    for c in file["certificates"].as_array().unwrap() {
        let network = network_of(c).unwrap_or_else(|| panic!("{}: under no chain", c["name"]));
        networks.insert(network);
        let seedelf = &c["seedelf"];
        let register = RegisterHex {
            generator: s(&seedelf["generator"]),
            public_value: s(&seedelf["public_value"]),
        };
        let want = CertificateChecked {
            name: s(&seedelf["name"]),
            register: register.clone(),
            messaging: s(&c["messaging_value"]),
        };
        assert_eq!(
            done(check_certificate(network, &s(&c["certificate"]))),
            want,
            "{}",
            c["name"]
        );
        let (x, x_m) = (
            scalar_from_hex(c["spend_secret_key"].as_str().unwrap()).unwrap(),
            scalar_from_hex(c["messaging_secret_key"].as_str().unwrap()).unwrap(),
        );
        assert_eq!(
            messaging_value(network, &want.name, &register, x_m),
            want.messaging
        );
        // Under the other network, it doesn't check.
        let other = if network == "preprod" {
            "mainnet"
        } else {
            "preprod"
        };
        assert_eq!(
            refused(check_certificate(other, &s(&c["certificate"]))),
            "invalid_certificate"
        );
        // Made again by the bindings with its two keys.
        let made = done(
            messaging::certificate(
                x,
                x_m,
                CertificateRequest {
                    network: network.to_string(),
                    name: want.name.clone(),
                    register: register.clone(),
                },
            )
            .unwrap(),
        )
        .certificate;
        assert_ne!(made, s(&c["certificate"]));
        assert_eq!(done(check_certificate(network, &made)), want);
        // A writer starts on it.
        let start = StartRequest {
            network: network.to_string(),
            name: want.name.clone(),
            register,
            certificate: s(&c["certificate"]),
            now: T,
        };
        assert!(
            messaging::start(random_scalar(), start)
                .unwrap()
                .done()
                .is_some()
        );
    }
    assert_eq!(
        networks.len(),
        2,
        "the certificate vectors are on both networks"
    );
    let mut asked = std::collections::BTreeMap::<String, usize>::new();
    for r in file["refusals"].as_array().unwrap() {
        let Some(network) = network_of(r) else {
            continue;
        };
        let answer = check_certificate(network, &s(&r["certificate"]));
        let result = answer.refused().unwrap_or("ok");
        assert_eq!(result, s(&r["result"]), "{}", r["name"]);
        *asked.entry(result.to_string()).or_default() += 1;
    }
    for code in [
        "ok",
        "invalid_certificate",
        "invalid_encoding",
        "not_in_subgroup",
        "identity_point",
        "unsupported_version",
    ] {
        assert!(
            asked.contains_key(code),
            "no refusal vector gives {code}: {asked:?}"
        );
    }
}

/// A certificate is refused for one key given as both keys (`same_key`) and
/// for a register that isn't the Seedelf key's (`not_owned`), whichever key
/// the register is of, before either key meets it. A network that isn't
/// `preprod` or `mainnet` is the worker's mistake, not a refusal: every call
/// that takes one throws (seedelf-core has no Seedelf policy for it), so the
/// crate's `unknown_network`, a network byte the chain doesn't know, never
/// reaches the bindings but has its code.
#[test]
fn a_certificate_refuses_one_key_twice_and_another_keys_register() {
    let (alice, bob) = (Wallet::new(0xa1), Wallet::new(0xb0));
    let make = |sk: Scalar, m: Scalar, register: &CryptoRegister, network: &str| {
        messaging::certificate(
            sk,
            m,
            CertificateRequest {
                network: network.to_string(),
                name: alice.name.clone(),
                register: register_hex(register),
            },
        )
    };
    assert_eq!(
        refused(make(alice.sk, alice.sk, &alice.seedelf, NET).unwrap()),
        "same_key"
    );
    assert_eq!(
        refused(make(alice.m, alice.m, &alice.seedelf, NET).unwrap()),
        "same_key"
    );
    // Bob's Seedelf, the messaging key's own root register, and a register of
    // Alice's x on x_m's: none is x's to prove.
    let root_of_m = CryptoRegister::create(alice.m).unwrap();
    for register in [&bob.seedelf, &root_of_m] {
        assert_eq!(
            refused(make(alice.sk, alice.m, register, NET).unwrap()),
            "not_owned"
        );
    }
    // x_m given where x belongs: Alice's Seedelf isn't its register.
    assert_eq!(
        refused(make(alice.m, alice.sk, &alice.seedelf, NET).unwrap()),
        "not_owned"
    );
    // A register that isn't one: its point's code.
    let mut identity = register_hex(&alice.seedelf);
    identity.public_value = format!("c0{}", "00".repeat(47));
    let answer = messaging::certificate(
        alice.sk,
        alice.m,
        CertificateRequest {
            network: NET.to_string(),
            name: alice.name.clone(),
            register: identity,
        },
    )
    .unwrap();
    assert_eq!(refused(answer), "identity_point");
    let nameless = messaging::certificate(
        alice.sk,
        alice.m,
        CertificateRequest {
            network: NET.to_string(),
            name: String::new(),
            register: register_hex(&alice.seedelf),
        },
    )
    .unwrap();
    assert_eq!(refused(nameless), "invalid_message");

    // A network the wallet has no chain for throws, in each call that takes one.
    assert_eq!(messaging::code(Error::UnknownNetwork), "unknown_network");
    let (a, _) = answered(&alice, &bob);
    for network in ["preview", "Preprod", "mainnet ", "", "0"] {
        assert!(messaging::chain(network).is_err(), "{network:?}");
        assert!(make(alice.sk, alice.m, &alice.seedelf, network).is_err());
        assert!(
            messaging::check_certificate(CheckCertificateRequest {
                network: network.to_string(),
                certificate: alice.certificate.clone(),
            })
            .is_err()
        );
        let mut start = alice.start_request(T);
        start.network = network.to_string();
        assert!(messaging::start(bob.m, start).is_err());
        let mut receive = receive_request("00", T, alice.handles(), vec![], None, None);
        receive.network = network.to_string();
        assert!(messaging::receive(alice.m, receive).is_err());
        assert!(
            messaging::reveal(
                alice.m,
                RevealRequest {
                    network: network.to_string(),
                    conversation: a.clone(),
                    name: alice.name.clone(),
                    register: register_hex(&alice.seedelf),
                    certificate: alice.certificate.clone(),
                },
            )
            .is_err()
        );
        assert!(
            messaging::check_reveal(CheckRevealRequest {
                network: network.to_string(),
                conversation: a.clone(),
                reveal: "00".to_string(),
            })
            .is_err()
        );
    }
    // The two the wallet has: their bytes, and the policy of the variant each reads.
    for (network, byte, preprod) in [("preprod", 0x00, true), ("mainnet", 0x01, false)] {
        let chain = messaging::chain(network).unwrap();
        assert_eq!(chain.network(), byte);
        let policy = seedelf_core::constants::get_config(seedelf_core::constants::VARIANT, preprod)
            .unwrap()
            .contract
            .seedelf_policy_id;
        assert_eq!(hex::encode(chain.policy()), policy);
    }
}

/// A writer starts only on a certificate that checks under its network and
/// names exactly the Seedelf its own read of the contract gives: the same
/// name and the same register. One for the Seedelf's old register, another
/// Seedelf's, another name's, the other network's, or one changed in a byte
/// is `invalid_certificate`, and no conversation starts.
#[test]
fn a_start_takes_only_a_certificate_for_the_chain_reads_seedelf() {
    let (alice, bob, other) = (Wallet::new(0xa1), Wallet::new(0xb0), Wallet::new(0xcc));
    let start = |request: StartRequest| messaging::start(alice.m, request).unwrap();
    assert!(start(bob.start_request(T)).done().is_some());

    // Bob's Seedelf moved: the chain read gives a new register, the
    // certificate names the old one. Then a certificate for the new one.
    let moved = CryptoRegister::create(bob.sk)
        .unwrap()
        .rerandomize()
        .unwrap();
    let mut request = bob.start_request(T);
    request.register = register_hex(&moved);
    assert_eq!(refused(start(request)), "invalid_certificate");
    let mut request = bob.start_request(T);
    request.register = register_hex(&moved);
    request.certificate = certify(bob.sk, bob.m, NET, &bob.name, &moved);
    assert!(start(request).done().is_some());
    // The chain read is the new register; the certificate is for a register
    // the chain doesn't give the name now.
    let mut request = bob.start_request(T);
    request.register = register_hex(&moved);
    request.certificate = bob.certificate.clone();
    assert_eq!(refused(start(request)), "invalid_certificate");

    // Another Seedelf's certificate under Bob's name and register.
    let mut request = bob.start_request(T);
    request.certificate = other.certificate.clone();
    assert_eq!(refused(start(request)), "invalid_certificate");
    // Bob's certificate for his register, under another name.
    let mut request = bob.start_request(T);
    request.name = other.name.clone();
    assert_eq!(refused(start(request)), "invalid_certificate");
    // The same Seedelf, the same keys, the other network's certificate:
    // refused whichever network the start reads under.
    let there = certify(bob.sk, bob.m, ELSEWHERE, &bob.name, &bob.seedelf);
    let mut request = bob.start_request(T);
    request.certificate = there.clone();
    assert_eq!(refused(start(request)), "invalid_certificate");
    let mut request = bob.start_request(T);
    request.network = ELSEWHERE.to_string();
    assert_eq!(refused(start(request)), "invalid_certificate");
    let mut request = bob.start_request(T);
    request.network = ELSEWHERE.to_string();
    request.certificate = there;
    assert!(start(request).done().is_some());
    // Changed in a byte of its proof, or cut.
    let mut bytes = hex::decode(&bob.certificate).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    let mut request = bob.start_request(T);
    request.certificate = hex::encode(bytes);
    assert_eq!(refused(start(request)), "invalid_certificate");
    let mut request = bob.start_request(T);
    request.certificate = String::new();
    assert_eq!(refused(start(request)), "invalid_certificate");
    // A certificate that isn't hex throws.
    let mut request = bob.start_request(T);
    request.certificate = "zz".to_string();
    assert!(messaging::start(alice.m, request).is_err());

    // The conversation it starts is on M_S: Bob's messaging key reads its
    // first message, under the handle of the register the chain gives.
    let (_, a) = begin(&alice, &bob);
    let (_, first) = send(&a, b"hi");
    assert_eq!(
        messaging::scan(bob.m, std::slice::from_ref(&first)).unwrap(),
        "1"
    );
}

/// What isn't the wallet's request throws, and changes nothing: a
/// conversation's record that doesn't read, records that hold one
/// conversation twice, hex that isn't, a handle's name past 32 bytes, a
/// network the wallet has none of. A requests' record that doesn't read is a
/// refusal instead
/// (`a_requests_record_that_doesnt_read_is_refused_with_its_version`).
#[test]
fn what_isnt_a_request_throws() {
    let (alice, bob) = (Wallet::new(1), Wallet::new(2));
    let started = done(messaging::start(alice.m, bob.start_request(T)).unwrap());
    let a = stamped(&started.conversation, &started.digest, 4);
    let (_, envelope) = send(&a, b"hi");
    let request = |conversations: Vec<Secret>, requests: Option<&str>, handles| ReceiveRequest {
        network: NET.to_string(),
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
    let mut preview = request(vec![], None, bob.handles());
    preview.network = "preview".to_string();
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
        preview,
    ] {
        assert!(messaging::receive(bob.m, broken).is_err());
    }
    // A request and a conversation of one ID.
    let result = done(messaging::receive(bob.m, request(vec![], None, bob.handles())).unwrap());
    let requests = result.requests.unwrap();
    let accepted = done(
        messaging::accept(
            bob.m,
            RequestOf {
                requests: requests.clone(),
                cid: started.cid.clone(),
            },
        )
        .unwrap(),
    );
    let twice = request(vec![accepted.conversation], Some(&requests), bob.handles());
    let error = messaging::receive(bob.m, twice).unwrap_err().to_string();
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
        Error::InvalidCertificate,
        Error::NotOwned,
        Error::SameKey,
        Error::UnknownNetwork,
        Error::InvalidWithdrawal,
    ];
    assert_eq!(
        messaging::code(Error::InvalidKeysProof),
        "invalid_keys_proof"
    );
    assert_eq!(messaging::code(Error::RequestFull), "request_full");
    assert_eq!(
        [
            Error::InvalidCertificate,
            Error::NotOwned,
            Error::SameKey,
            Error::UnknownNetwork,
            Error::InvalidWithdrawal,
        ]
        .map(messaging::code),
        [
            "invalid_certificate",
            "not_owned",
            "same_key",
            "unknown_network",
            "invalid_withdrawal",
        ]
    );
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
/// result's absent record left out, the requests that name a network, and
/// the numbers the worker works by.
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
        "network": "preprod", "envelope": "01", "now": 1, "firstContactBits": 8,
        "handles": [{ "name": "61", "registers": [{ "generator": "aa", "publicValue": "bb" }] }],
    }))
    .unwrap();
    assert_eq!(request.network, "preprod");
    assert_eq!(request.first_contact_bits, Some(8));
    assert_eq!(request.handles[0].registers[0].public_value, "bb");
    assert!(request.conversations.is_empty() && request.requests.is_none());
    // A request that names no network doesn't read: it throws.
    assert!(
        serde_json::from_value::<ReceiveRequest>(json!({ "envelope": "01", "now": 1 })).is_err()
    );
    let start: StartRequest = serde_json::from_value(json!({
        "network": "mainnet", "name": "61", "register": { "generator": "aa", "publicValue": "bb" },
        "certificate": "cc", "now": 2,
    }))
    .unwrap();
    assert_eq!(
        (
            start.network.as_str(),
            start.name.as_str(),
            start.register.public_value.as_str()
        ),
        ("mainnet", "61", "bb")
    );
    assert_eq!((start.certificate.as_str(), start.now), ("cc", 2));
    assert!(
        serde_json::from_value::<StartRequest>(json!({
            "network": "preprod", "name": "61", "register": { "generator": "aa", "publicValue": "bb" }, "now": 2,
        }))
        .is_err(),
        "a start without a certificate"
    );
    let certificate: CertificateRequest = serde_json::from_value(json!({
        "network": "preprod", "name": "61", "register": { "generator": "aa", "publicValue": "bb" },
    }))
    .unwrap();
    assert_eq!(certificate.register.generator, "aa");
    let check: CheckCertificateRequest =
        serde_json::from_value(json!({ "network": "preprod", "certificate": "dd" })).unwrap();
    assert_eq!(check.certificate, "dd");
    let reveal = json!({
        "network": "preprod", "conversation": "00", "name": "61",
        "register": { "generator": "aa", "publicValue": "bb" }, "certificate": "ff",
    });
    let read: RevealRequest = serde_json::from_value(reveal.clone()).unwrap();
    assert_eq!(
        (read.network.as_str(), read.certificate.as_str()),
        ("preprod", "ff")
    );
    let mut without = reveal;
    without.as_object_mut().unwrap().remove("certificate");
    assert!(
        serde_json::from_value::<RevealRequest>(without).is_err(),
        "a reveal without a certificate"
    );
    let value: messaging::ValueRequest = serde_json::from_value(json!({
        "network": "mainnet", "name": "61", "register": { "generator": "aa", "publicValue": "bb" },
    }))
    .unwrap();
    assert_eq!(
        (value.network.as_str(), value.name.as_str()),
        ("mainnet", "61")
    );
    assert_eq!(
        serde_json::to_value(RevealChecked {
            name: "61".to_string(),
            register: RegisterHex {
                generator: "aa".to_string(),
                public_value: "bb".to_string(),
            },
            messaging: "ee".to_string(),
        })
        .unwrap(),
        json!({ "name": "61", "register": { "generator": "aa", "publicValue": "bb" }, "messaging": "ee" })
    );
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
/// `p` isn't the key's; only one that isn't hex throws. The key is the
/// messaging key: a Seedelf key matches none.
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
    let scan = |key: Scalar, batch: &[String]| json_of(messaging::scan(key, batch).unwrap());
    assert_eq!(scan(bob.m, &batch), json!("01001"));
    assert_eq!(scan(other.m, &batch), json!("10010"));
    assert_eq!(scan(alice.m, &batch), json!("00000"));
    for wallet in [&alice, &bob, &other] {
        assert_eq!(scan(wallet.sk, &batch), json!("00000"));
    }
    // All of a batch the key's, or none: the same length.
    let three = vec![to_bob; 3];
    assert_eq!(scan(bob.m, &three), json!("111"));
    assert_eq!(scan(other.m, &three), json!("000"));
    assert_eq!(scan(bob.m, &[]), json!(""));
    assert!(messaging::scan(bob.m, &["0x01".to_string()]).is_err());
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
                bob.m,
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
            bob.m,
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
    let accepted = done(messaging::accept(bob.m, RequestOf { requests, cid }).unwrap());
    let (_, reply) = send(&accepted.conversation, b"hello Alice");
    let read = done(
        messaging::receive(
            alice.m,
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
            bob.m,
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
    let key = SecretKey::from_scalar(bob.m).unwrap();
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
            bob.m,
            receive_request(envelope, T + 300, vec![], vec![&b], None, None),
        )
        .unwrap()
    };
    assert_eq!(refused(take(&kept[&1001])), "too_far_ahead");
    assert_eq!(refused(take(&kept[&max_auth])), "too_far_ahead");
    assert_eq!(refused(take(&kept[&(max_auth + 1)])), "decryption_failed");

    // A forgery of message 1,001, on the same header, sealed to Bob's
    // conversation identity: its ratchet ciphertext is 32 bytes of nothing.
    let key = SecretKey::from_scalar(bob.m).unwrap();
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
                    bob.m,
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
            json_of(messaging::accept(bob.m, of()).expect("accept refuses, not throws")),
            json_of(
                messaging::read_request(bob.m, of()).expect("read_request refuses, not throws"),
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
        messaging::receive(bob.m, request).unwrap()
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
