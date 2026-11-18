//! The signing page `create`, `fund` and `util extract` serve, for real, on
//! 127.0.0.1:44203, against the CLI's offline mock Koios (tests/cli/harness.rs).
//!
//! - Each run serves under a path of its own, printed once the server holds
//!   the port. Before, a second run printed http://127.0.0.1:44203/ and then
//!   panicked on the taken port, and the page at the address it had just
//!   printed was the earlier run's, which signed the earlier transaction
//!   (chunk 51, r4#5).
//! - It answers only its own Host. Before, a site whose name it had rebound to
//!   127.0.0.1 read the unsigned transaction from it (chunk 51, r4#6).
//!
//! The port is fixed, so every test here is `#[serial]`, and needs it free.

#[path = "cli/harness.rs"]
mod harness;

use std::future::Future;
use std::time::{Duration, Instant};

use blstrs::Scalar;
use pallas_traverse::MultiEraTx;
use serial_test::serial;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use harness::*;
use seedelf_cli::commands::fund::{FundArgs, run};
use seedelf_cli::web_server::serving_url;

const HOST: &str = "127.0.0.1:44203";
const URL_PREFIX: &str = "http://127.0.0.1:44203";
/// The Seedelf the user picked first, then saw was the wrong contact.
const SEEDELF_A: &str = SAMPLE_SEEDELF;
/// 100 ADA in each run.
const LOVELACE: u64 = 100_000_000;

/// The Seedelf the user meant.
fn seedelf_b() -> String {
    format!("5eed0e1f{}bb", "00".repeat(27))
}

/// Fixed owners, so the parent and the child mount the same chain.
fn owner_a() -> Scalar {
    Scalar::from(0xA11CE_u64)
}

fn owner_b() -> Scalar {
    Scalar::from(0xB0B_u64)
}

/// The chain each run reads: Seedelfs A and B at the wallet contract, each
/// under its own owner's register, and the payer's 200 ADA.
async fn mount_chain(scenario: &mut Scenario) {
    scenario
        .mount_credential_utxos(vec![
            seedelf_utxo(owner_a(), 1, 1_500_000, SEEDELF_A),
            seedelf_utxo(owner_b(), 2, 1_500_000, &seedelf_b()),
        ])
        .await;
    scenario
        .mount_address_utxos(vec![address_utxo(
            &external_address_bech32(),
            3,
            200_000_000,
            &[],
        )])
        .await;
}

fn fund_args(seedelf: &str) -> FundArgs {
    FundArgs {
        address: external_address_bech32(),
        seedelf: seedelf.to_string(),
        lovelace: Some(LOVELACE),
        assets: vec![],
    }
}

/// A precondition, not what's tested: nothing else holds the port.
fn port_is_free() {
    drop(std::net::TcpListener::bind(HOST).unwrap_or_else(|e| {
        panic!("precondition: {HOST} must be free (stop whatever listens there): {e}")
    }));
}

/// `fund` to `seedelf`, serving its page for real, until `probe` ends: what
/// `probe` returns, given the address the run serves its page at. The run
/// stops serving once `probe` ends.
async fn while_serving<F, P, T>(seedelf: &str, probe: P) -> T
where
    P: FnOnce(String) -> F,
    F: Future<Output = T>,
{
    let mut scenario = Scenario::start().await;
    mount_chain(&mut scenario).await;
    let fund = run(fund_args(seedelf), PREPROD, VARIANT);
    let probing = async {
        let deadline = Instant::now() + Duration::from_secs(60);
        let url = loop {
            if let Some(url) = serving_url() {
                break url;
            }
            assert!(Instant::now() < deadline, "the run never served its page");
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        probe(url).await
    };
    let out = tokio::select! {
        ended = fund => panic!("fund stopped before the page was read: {ended:?}"),
        out = probing => out,
    };
    assert_eq!(serving_url(), None, "a run that stopped serves nothing");
    out
}

/// The path of a page's address.
fn path_of(url: &str) -> String {
    url.strip_prefix(URL_PREFIX)
        .unwrap_or_else(|| panic!("served at {URL_PREFIX}: {url}"))
        .to_string()
}

/// One request to the signing port: its status and the whole raw response.
/// `host` None sends HTTP/1.0 with no Host at all.
async fn get(path: &str, host: Option<&str>) -> (u16, String) {
    let mut stream = TcpStream::connect(HOST)
        .await
        .expect("the signing port answers");
    let request = match host {
        Some(host) => format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
        None => format!("GET {path} HTTP/1.0\r\n\r\n"),
    };
    stream
        .write_all(request.as_bytes())
        .await
        .expect("the request");
    let mut raw = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), stream.read_to_end(&mut raw))
        .await
        .expect("an answer in 10 s")
        .expect("the answer");
    let text = String::from_utf8_lossy(&raw).into_owned();
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    (status, text)
}

/// The transaction a page carries in its injected-data block, if any.
fn injected_tx(page: &str) -> Option<String> {
    const OPEN: &str = r#"{ "message": ""#;
    let start = page.find(OPEN)? + OPEN.len();
    let len = page[start..].find('"')?;
    Some(page[start..start + len].to_string())
}

/// The id a page shows for its transaction, from its injected-data block.
fn injected_id(page: &str) -> Option<String> {
    let block = &page[page.find(r#"{ "message": ""#)?..];
    let block = &block[..block.find('}')?];
    let value: serde_json::Value = serde_json::from_str(&format!("{block}}}")).ok()?;
    value["id"].as_str().map(str::to_string)
}

/// A transaction's id, as the CLI computes it: its body's hash.
fn id_of(tx: &str) -> String {
    hex::encode(seedelf_core::build::tx_id(&hex::decode(tx).expect("hex")).expect("a transaction"))
}

/// The value of the response header `name`, if it's there.
fn header<'a>(response: &'a str, name: &str) -> Option<&'a str> {
    let head = response.split("\r\n\r\n").next()?;
    head.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

/// What a transaction pays the wallet contract, and for whom.
fn describe(cbor: &str) -> String {
    let id = hex::decode(cbor)
        .ok()
        .and_then(|bytes| {
            MultiEraTx::decode(&bytes)
                .ok()
                .map(|tx| tx.hash().to_string())
        })
        .unwrap_or_else(|| "undecodable".to_string());
    let paid = decode_tx(cbor)
        .outputs_to(&wallet_address())
        .iter()
        .map(|o| {
            let owner = match &o.register {
                Some(r) if r.is_owned(owner_a()).unwrap_or(false) => "Seedelf A's owner",
                Some(r) if r.is_owned(owner_b()).unwrap_or(false) => "Seedelf B's owner",
                _ => "neither owner",
            };
            format!("{} lovelace for {owner}", o.lovelace)
        })
        .collect::<Vec<_>>()
        .join("; ");
    format!("tx {id}, {paid}")
}

/// Each run's page has an address of its own: an earlier run's, reloaded once
/// a later run serves, gets nothing, and neither does the port's root.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial]
async fn each_run_serves_its_page_at_an_address_of_its_own() {
    port_is_free();
    let (url_a, tx_a) = while_serving(SEEDELF_A, |url| async move {
        let (status, page) = get(&path_of(&url), Some(HOST)).await;
        assert_eq!(
            status, 200,
            "the page at the address printed loads:\n{page}"
        );
        let tx = injected_tx(&page).expect("the page carries its transaction");
        // And the id to look it up by, which signing doesn't change.
        assert_eq!(
            injected_id(&page),
            Some(id_of(&tx)),
            "the page carries its transaction's id:\n{page}"
        );

        let (status, root) = get("/", Some(HOST)).await;
        assert!(
            status == 404 && injected_tx(&root).is_none(),
            "the root serves nothing: {root}"
        );
        // Without its slash, the address leads to the page, whose files sit beside it.
        let (status, moved) = get(path_of(&url).trim_end_matches('/'), Some(HOST)).await;
        assert_eq!(status, 303, "{moved}");
        assert_eq!(header(&moved, "location"), Some(path_of(&url).as_str()));
        let (status, _) = get(&format!("{}index.js", path_of(&url)), Some(HOST)).await;
        assert_eq!(status, 200, "the page's script is beside it");
        (url, tx)
    })
    .await;
    assert!(
        describe(&tx_a).contains("for Seedelf A's owner"),
        "{}",
        describe(&tx_a)
    );

    let path_a = path_of(&url_a);
    let (url_b, earlier, tx_b) = while_serving(&seedelf_b(), |url| async move {
        let (_, earlier) = get(&path_a, Some(HOST)).await;
        let (status, page) = get(&path_of(&url), Some(HOST)).await;
        assert_eq!(status, 200, "the later run's page loads:\n{page}");
        (
            url,
            earlier,
            injected_tx(&page).expect("the later page's transaction"),
        )
    })
    .await;
    assert_ne!(url_a, url_b, "two runs, two addresses");
    assert!(
        describe(&tx_b).contains("for Seedelf B's owner"),
        "{}",
        describe(&tx_b)
    );
    assert!(
        earlier.starts_with("HTTP/1.1 404") && injected_tx(&earlier).is_none(),
        "the earlier run's page, reloaded while the later run serves, gets no transaction:\n{earlier}"
    );
}

/// The second run, as the parent's child process: `fund` to Seedelf B, for
/// real, while the earlier run holds the port. Does nothing in the parent.
#[tokio::test]
async fn second_fund_in_a_child_process() {
    if !is_child("second_fund_in_a_child_process") {
        return;
    }
    let mut scenario = Scenario::start().await;
    mount_chain(&mut scenario).await;
    let outcome = tokio::time::timeout(
        Duration::from_secs(60),
        run(fund_args(&seedelf_b()), PREPROD, VARIANT),
    )
    .await;
    match outcome {
        Ok(Ok(())) => println!("OUTCOME: ok"),
        Ok(Err(e)) => println!("OUTCOME: error: {e:#}"),
        Err(_) => println!("OUTCOME: still serving after 60 s"),
    }
}

/// A second run, while an earlier one still serves its page (left running in
/// another terminal), never prints an address: it says the page can't be
/// served, and stops. Before, it printed http://127.0.0.1:44203/ and panicked
/// on the taken port, and the page there was the earlier run's, which pays
/// Seedelf A.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial]
async fn a_second_run_never_announces_an_earlier_runs_page() {
    port_is_free();
    let (earlier_tx, still, (stdout, stderr)) = while_serving(SEEDELF_A, |url| async move {
        let (_, page) = get(&path_of(&url), Some(HOST)).await;
        let earlier_tx = injected_tx(&page).expect("the earlier run's page");
        let child = tokio::task::spawn_blocking(|| {
            run_child("second_fund_in_a_child_process", Duration::from_secs(180))
        })
        .await
        .expect("the second run");
        let (_, still) = get(&path_of(&url), Some(HOST)).await;
        (earlier_tx, injected_tx(&still), child)
    })
    .await;

    let second_tx = line_after(&stdout, "Tx Cbor: ").unwrap_or_else(|| {
        panic!("precondition: the second run never built its transaction\n{stdout}\n{stderr}")
    });
    assert_ne!(second_tx, earlier_tx, "two runs, two transactions");
    let announced: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with(URL_PREFIX))
        .collect();
    let outcome = line_after(&stdout, "OUTCOME: ").unwrap_or_default();
    let evidence = format!(
        "earlier run (fund -s A): {}\nsecond run (fund -s B): {}\nsecond run announced: {announced:?}\n\
         second run's outcome: {outcome}\nits stderr: {stderr}",
        describe(&earlier_tx),
        describe(&second_tx),
    );
    assert!(
        announced.is_empty(),
        "the second run printed an address:\n{evidence}"
    );
    assert!(
        !stderr.contains("panicked"),
        "the second run panicked:\n{evidence}"
    );
    assert!(
        outcome.starts_with("error:") && outcome.contains("can't be served"),
        "the second run says its page can't be served:\n{evidence}"
    );
    assert_eq!(
        still,
        Some(earlier_tx),
        "the earlier run's page is its own still"
    );
}

/// Only the server's own Host gets the page: a site whose name now leads to
/// 127.0.0.1 (DNS rebinding) sends its own, and gets neither a 2xx nor the
/// transaction. The page is never kept, nor shown in another site's frame.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial]
async fn the_page_answers_only_its_own_host() {
    port_is_free();
    let answers = while_serving(SEEDELF_A, |url| async move {
        let path = path_of(&url);
        let mut answers = Vec::new();
        for host in [
            Some(HOST),
            Some("localhost:44203"),
            Some("rebind.example:44203"),
            None,
        ] {
            answers.push((host, get(&path, host).await));
        }
        answers
    })
    .await;

    let tx =
        injected_tx(&answers[0].1.1).expect("the page at its own Host carries its transaction");
    assert!(describe(&tx).contains("100000000 lovelace for Seedelf A's owner"));
    for (host, (status, response)) in &answers {
        let own = matches!(host, Some(HOST) | Some("localhost:44203"));
        if own {
            assert_eq!(*status, 200, "Host {host:?} gets the page:\n{response}");
            assert_eq!(injected_tx(response).as_deref(), Some(tx.as_str()));
            assert_eq!(header(response, "cache-control"), Some("no-store"));
            assert_eq!(header(response, "x-frame-options"), Some("DENY"));
            assert_eq!(
                header(response, "content-security-policy"),
                Some("frame-ancestors 'none'")
            );
        } else {
            assert!(
                !(200..300).contains(status) && !response.contains(&tx),
                "Host {host:?} gets neither the page nor the transaction: status {status}\n{response}"
            );
        }
    }
}

/// A run serving its page, as the child process of
/// [`the_terminal_names_the_transaction_its_page_signs`]: `fund` to Seedelf A,
/// serving for real until it has read the page, then the id the page shows.
/// Does nothing in the parent.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fund_serving_its_page_in_a_child_process() {
    if !is_child("fund_serving_its_page_in_a_child_process") {
        return;
    }
    let id = while_serving(SEEDELF_A, |url| async move {
        let (_, page) = get(&path_of(&url), Some(HOST)).await;
        injected_id(&page).expect("the page shows its transaction's id")
    })
    .await;
    println!("PAGE ID: {id}");
}

/// The terminal names the transaction the page signs, with the page's
/// address: a submit the browser wallet doesn't confirm may have gone through
/// all the same, and its id is what to look up before running the command
/// again. No test failed without that line (chunk 51, r2tests#8).
#[test]
#[serial]
fn the_terminal_names_the_transaction_its_page_signs() {
    port_is_free();
    let (stdout, stderr) = run_child(
        "fund_serving_its_page_in_a_child_process",
        Duration::from_secs(180),
    );
    let printed = line_after(&stdout, "Tx Hash: ");
    let shown = line_after(&stdout, "PAGE ID: ");
    assert!(
        shown.is_some(),
        "precondition: the run served its page\n{stdout}\n{stderr}"
    );
    assert_eq!(
        printed, shown,
        "the terminal names the transaction the page shows\n{stdout}"
    );
}
