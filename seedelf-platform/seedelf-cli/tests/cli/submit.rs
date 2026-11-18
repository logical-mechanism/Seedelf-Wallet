//! Submitting through Koios. A submit Koios doesn't confirm (a 5xx, a 2xx
//! that isn't the transaction's id, no answer within the client's 30 s) may
//! still have gone through: the web wallet calls all three "maybe sent"
//! (koios.ts `KoiosBusyError`). Running the command again once it has landed
//! builds from what's left and pays the same Seedelf again. So the CLI names
//! the transaction it sent, to look up first, and never calls it refused or
//! unsent (chunk 51, r4#4 and r1#2).

use std::io::Read;
use std::net::TcpListener;
use std::time::Duration;

use serde_json::{Value, json};
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use seedelf_cli::commands::transfer::{TransforArgs, run};
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{SubmitError, override_endpoints, submit_tx};

use crate::harness::*;

/// A gateway's own page: Koios's proxy took the request, and the instance
/// behind it didn't answer in time.
const GATEWAY_504: &str = "<html><body><h1>504 Gateway Time-out</h1></body></html>";

/// A node's refusal, as Koios passes on cardano-submit-api's answer.
const NODE_REFUSAL: &str = r#"{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO ...))"],"kind":"ShelleyTxValidationError"},"tag":"TxValidationErrorInCardanoMode"},"tag":"TxCmdTxSubmitValidationError"},"tag":"TxSubmitFail"}"#;

/// `transfer` of 500 ₳ to another person's Seedelf, from two UTxOs of 600 ₳,
/// with Koios answering the submit with `answer`: what the CLI prints, and
/// the id of the transaction Koios was handed.
async fn transfer_answered(answer: ResponseTemplate) -> (String, String) {
    let mut scenario = Scenario::start().await;
    scenario
        .mount_credential_utxos(vec![
            wallet_utxo(scenario.scalar, 1, 600_000_000, &[]),
            wallet_utxo(scenario.scalar, 2, 600_000_000, &[]),
            seedelf_utxo(random_scalar(), 3, 1_500_000, SAMPLE_SEEDELF),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.mount_collateral().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/submittx"))
        .respond_with(answer)
        .mount(&scenario.server)
        .await;

    let err = run(
        TransforArgs {
            seedelfs: vec![SAMPLE_SEEDELF.to_string()],
            lovelaces: Some(vec![500_000_000]),
            assets: vec![],
            utxos: None,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect_err("Koios never confirmed the submit");
    let sent = hex::decode(scenario.submitted_cbor().await).expect("tx cbor hex");
    let sent_id = hex::encode(seedelf_core::build::tx_id(&sent).expect("tx id"));
    (format!("Error: {err:#}"), sent_id)
}

/// What the CLI prints for a submit Koios never confirmed names the
/// transaction sent, says it may have gone through and to look it up first,
/// and never calls it refused or unsent. The timeout case waits out the
/// client's 30 s.
#[tokio::test]
#[serial]
async fn a_submit_koios_never_confirmed_names_the_transaction_it_sent() {
    for (case, answer) in [
        (
            "a 504 from Koios's gateway",
            ResponseTemplate::new(504).set_body_raw(GATEWAY_504, "text/html"),
        ),
        // 202 is Koios's success; this one's body stops before the id's closing quote.
        (
            "a 202 whose body is cut off",
            ResponseTemplate::new(202).set_body_raw("\"5f2b", "application/json"),
        ),
        (
            "no answer within 30 s",
            ResponseTemplate::new(202)
                .set_body_json(json!(tx_hash(999)))
                .set_delay(Duration::from_secs(31)),
        ),
    ] {
        let (printed, sent_id) = transfer_answered(answer).await;
        let lower = printed.to_lowercase();
        assert!(
            printed.contains(&sent_id)
                && lower.contains("may have gone through")
                && lower.contains("before you run this again")
                && !lower.contains("reject")
                && !lower.contains("refused")
                && !lower.contains("nothing was sent"),
            "{case}: printed {printed:?}, for transaction {sent_id}"
        );
    }
}

/// `submit_tx` once, with `answer` mounted for this call alone: what it says.
async fn submit_answered(
    server: &MockServer,
    answer: ResponseTemplate,
) -> Result<Value, SubmitError> {
    let _only_now = Mock::given(method("POST"))
        .and(path("/api/v1/submittx"))
        .respond_with(answer)
        .mount_as_scoped(server)
        .await;
    said(submit_tx("84a0a0f5f6".to_string(), PREPROD).await)
}

fn said(outcome: anyhow::Result<Value>) -> Result<Value, SubmitError> {
    outcome.map_err(|e| {
        e.downcast::<SubmitError>()
            .unwrap_or_else(|e| panic!("a failed submit is a SubmitError: {e:#}"))
    })
}

/// `submit_tx` tells what didn't go from what may have: a refusal in the
/// node's words, a connection that never opened, a 429 or Koios's node down
/// are not sent; a 5xx, a connection lost after the request, or an answer
/// that isn't an id may have gone.
#[tokio::test]
#[serial]
async fn submit_tx_tells_a_refusal_from_a_submit_that_may_have_gone() {
    let scenario = Scenario::start().await;
    let server = &scenario.server;

    let id = tx_hash(7);
    assert_eq!(
        submit_answered(server, ResponseTemplate::new(202).set_body_json(json!(id))).await,
        Ok(json!(id)),
        "Koios's success is the transaction's id"
    );

    match submit_answered(
        server,
        ResponseTemplate::new(400).set_body_raw(NODE_REFUSAL, "application/json"),
    )
    .await
    {
        Err(SubmitError::Refused(why)) => {
            assert!(
                why.contains("ValueNotConservedUTxO"),
                "the node's words: {why}"
            )
        }
        other => panic!("a node's refusal is refused: {other:?}"),
    }
    let spent = r#"{"contents":"ConwayUtxowFailure (UtxoFailure (BadInputsUTxO ...))","tag":"TxSubmitFail"}"#;
    assert!(
        matches!(
            submit_answered(
                server,
                ResponseTemplate::new(400).set_body_raw(spent, "application/json")
            )
            .await,
            Err(SubmitError::Spent(_))
        ),
        "refused for an input already spent"
    );
    let node_down = r#"{"tag":"TxSubmitConnectionError","contents":"..."}"#;
    assert!(
        matches!(
            submit_answered(
                server,
                ResponseTemplate::new(400).set_body_raw(node_down, "application/json")
            )
            .await,
            Err(SubmitError::NotSent(_))
        ),
        "a Koios instance whose node was down sent nothing"
    );
    assert!(
        matches!(
            submit_answered(server, ResponseTemplate::new(429)).await,
            Err(SubmitError::NotSent(_))
        ),
        "Koios's gateway answers a 429 before passing anything on"
    );

    for (case, answer) in [
        (
            "a gateway's 504",
            ResponseTemplate::new(504).set_body_raw(GATEWAY_504, "text/html"),
        ),
        (
            "a 500",
            ResponseTemplate::new(500).set_body_string("Something went wrong"),
        ),
        (
            "a 202 that isn't an id",
            ResponseTemplate::new(202).set_body_json(json!({"tag": "TxSubmitFail"})),
        ),
    ] {
        assert!(
            matches!(
                submit_answered(server, answer).await,
                Err(SubmitError::MaybeSent(_))
            ),
            "{case} may have gone through"
        );
    }

    // A connection that never opened: nothing left the machine.
    let closed = TcpListener::bind("127.0.0.1:0").expect("a free port");
    let port = closed.local_addr().expect("its address").port();
    drop(closed);
    override_endpoints(Some(format!("http://127.0.0.1:{port}")), None);
    let never_opened = said(submit_tx("84a0a0f5f6".to_string(), PREPROD).await);

    // A connection Koios closes once it has the whole request, unanswered.
    let hangs_up = TcpListener::bind("127.0.0.1:0").expect("a free port");
    let port = hangs_up.local_addr().expect("its address").port();
    let taker = std::thread::spawn(move || {
        let (mut stream, _) = hangs_up.accept().expect("the submit's connection");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("a read timeout");
        // The head, then the transaction's 5 bytes.
        let (mut request, mut chunk) = (Vec::new(), [0u8; 4096]);
        while !request
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .is_some_and(|end| request.len() >= end + 4 + 5)
        {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => request.extend_from_slice(&chunk[..n]),
            }
        }
    });
    override_endpoints(Some(format!("http://127.0.0.1:{port}")), None);
    let hung_up = said(submit_tx("84a0a0f5f6".to_string(), PREPROD).await);
    taker.join().expect("the taker");
    override_endpoints(Some(server.uri()), Some(server.uri()));

    assert!(
        matches!(never_opened, Err(SubmitError::NotSent(_))),
        "a connection that never opened sent nothing: {never_opened:?}"
    );
    assert!(
        matches!(hung_up, Err(SubmitError::MaybeSent(_))),
        "a request Koios had and never answered may have gone: {hung_up:?}"
    );
}
