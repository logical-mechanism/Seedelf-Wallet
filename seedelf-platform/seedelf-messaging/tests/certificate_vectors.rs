//! The certificate vectors (tests/vectors/messaging_certificate_v1.json),
//! read back through the public API alone, as another implementation's
//! reader would. The unit test `certificate_vectors_match_the_file` holds
//! the writing side to them.
//!
//! Every good certificate checks under its chain and names its Seedelf and
//! the handle `Seedelf::handle` takes of it with the file's messaging key.
//! Its every intermediate value is rebuilt here from docs/protocol.md
//! §21.3 and §21.4's formulas, with HMAC-SHA-512, SHA-256 and RFC 9380's
//! hash to G1 called directly, never the crate's own helpers, and so is its
//! listing digest under its pool, which the relay's public function gives
//! too. Every refusal comes out as the file says, read under its chain, and
//! the three that are a good certificate with a scalar plus q are found to
//! be exactly that: refused, where a reader that reduced would take them.
//!
//! Every withdrawal (§21.7) is rebuilt the same way from the certificate it
//! names and the formulas, reads, and checks against that certificate; each
//! withdrawal refusal comes out as the file says, against the certificate
//! it gives.

use blstrs::{G1Affine, G1Projective, Scalar};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256, Sha512};

use seedelf_messaging::relay::{
    LISTING_STAMP_LABEL, UNLISTING_STAMP_LABEL, listing_digest, stamp_digest, unlisting_digest,
};
use seedelf_messaging::session::{
    CERTIFICATE_MAX_LEN, CERTIFICATE_MIN_LEN, Certificate, Chain, HANDLE_BASE_DST, NETWORK_MAINNET,
    NETWORK_PREPROD, Seedelf, WITHDRAWAL_LEN, Withdrawal,
};
use seedelf_messaging::{Error, Register, SecretKey, matches_register};

fn bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap()).unwrap()
}

fn point(value: &Value) -> G1Projective {
    G1Projective::from(G1Affine::from_compressed(&bytes(value).try_into().unwrap()).unwrap())
}

fn secret(value: &Value) -> SecretKey {
    SecretKey::from_bytes(&bytes(value).try_into().unwrap()).unwrap()
}

fn network(value: &Value) -> u8 {
    u8::try_from(value["network"].as_u64().unwrap()).unwrap()
}

fn chain(value: &Value) -> Chain {
    Chain::new(network(value), bytes(&value["policy"]).try_into().unwrap()).unwrap()
}

/// A big-endian integer of any length, mod q.
fn mod_q(bytes: &[u8]) -> Scalar {
    let base = Scalar::from(256u64);
    bytes.iter().fold(Scalar::from(0u64), |acc, &byte| {
        acc * base + Scalar::from(u64::from(byte))
    })
}

fn scalar(value: &Value) -> Scalar {
    Option::from(Scalar::from_bytes_be(&bytes(value).try_into().unwrap())).unwrap()
}

fn hmac_sha512(key: &[u8], message: &[u8]) -> Vec<u8> {
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(key).unwrap();
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

fn code(error: Error) -> &'static str {
    match error {
        Error::InvalidCertificate => "invalid_certificate",
        Error::UnsupportedVersion(_) => "unsupported_version",
        Error::InvalidEncoding => "invalid_encoding",
        Error::NotInSubgroup => "not_in_subgroup",
        Error::IdentityPoint => "identity_point",
        Error::InvalidWithdrawal => "invalid_withdrawal",
        other => panic!("unexpected refusal {other:?}"),
    }
}

#[test]
fn every_certificate_and_refusal_reads_through_the_public_api() {
    let file: Value =
        serde_json::from_str(include_str!("vectors/messaging_certificate_v1.json")).unwrap();
    assert_eq!(file["version"], 1);
    let label = |name: &str| file[name].as_str().unwrap().as_bytes().to_vec();
    assert_eq!(label("label"), b"Seedelf-Messaging|v1|certificate");
    assert_eq!(
        label("nonce_m_label"),
        b"Seedelf-Messaging|v1|certificate-nonce|m"
    );
    assert_eq!(
        label("nonce_x_label"),
        b"Seedelf-Messaging|v1|certificate-nonce|x"
    );
    assert_eq!(label("handle_base_dst"), HANDLE_BASE_DST);
    assert_eq!(
        label("listing_stamp_label"),
        b"Seedelf-Messaging|v1|listing-stamp|"
    );
    assert_eq!(label("listing_stamp_label"), LISTING_STAMP_LABEL);
    assert_eq!(file["networks"]["preprod"], u64::from(NETWORK_PREPROD));
    assert_eq!(file["networks"]["mainnet"], u64::from(NETWORK_MAINNET));

    let certificates = file["certificates"].as_array().unwrap();
    assert_eq!(certificates.len(), 4);
    let (mut lengths, mut networks, mut unreduced) = (Vec::new(), Vec::new(), 0);
    for vector in certificates {
        let name = vector["name"].as_str().unwrap();
        let chain = chain(vector);
        let (spend, messaging) = (
            secret(&vector["spend_secret_key"]),
            secret(&vector["messaging_secret_key"]),
        );
        let shown = &vector["seedelf"];
        let seedelf_name = bytes(&shown["name"]);
        let (g_s, u_s) = (point(&shown["generator"]), point(&shown["public_value"]));
        let datum = Register::from_bytes(&g_s.to_compressed(), &u_s.to_compressed()).unwrap();
        assert!(matches_register(&spend, &datum), "{name}");
        assert!(!matches_register(&messaging, &datum), "{name}");
        let seedelf = Seedelf::new(chain, &seedelf_name, datum).unwrap();

        // h_S, hashed here from §21.3's message.
        let base_message = [
            &[chain.network()][..],
            chain.policy(),
            &[seedelf_name.len() as u8],
            &seedelf_name,
            &g_s.to_compressed(),
            &u_s.to_compressed(),
        ]
        .concat();
        assert_eq!(bytes(&shown["base_message"]), base_message, "{name}");
        let h_s = G1Projective::hash_to_curve(&base_message, &label("handle_base_dst"), &[]);
        assert_eq!(point(&shown["base"]), h_s, "{name}");
        assert_ne!(h_s, g_s, "{name}");
        let m_s = h_s * scalar(&vector["messaging_secret_key"]);
        assert_eq!(point(&vector["messaging_value"]), m_s, "{name}");

        // The certificate checks, and names that Seedelf and its handle.
        let body = bytes(&vector["certificate"]);
        assert!((CERTIFICATE_MIN_LEN..=CERTIFICATE_MAX_LEN).contains(&body.len()));
        let certificate = Certificate::from_bytes(&chain, &body).unwrap();
        assert_eq!(certificate.to_bytes(), body, "{name}");
        assert_eq!(certificate.seedelf(), &seedelf, "{name}");
        assert!(certificate.is_for(&seedelf), "{name}");
        let handle = seedelf.handle(&messaging).unwrap();
        assert_eq!(certificate.handle(), &handle, "{name}");
        assert_eq!(handle.register().generator_bytes(), h_s.to_compressed());
        assert_eq!(handle.register().public_value_bytes(), m_s.to_compressed());

        // The statement, every byte before c.
        let statement = [
            &[0x01, chain.network(), 0x00][..],
            chain.policy(),
            &[seedelf_name.len() as u8],
            &seedelf_name,
            &g_s.to_compressed(),
            &u_s.to_compressed(),
            &m_s.to_compressed(),
        ]
        .concat();
        assert_eq!(bytes(&vector["statement"]), statement, "{name}");
        assert_eq!(&body[..body.len() - 96], &statement[..], "{name}");
        assert_eq!(vector["version"], 1);
        assert_eq!(vector["generation"], 0);

        // k_m keyed by x_m, then k_x keyed by x over T_m too.
        let aux = bytes(&vector["draws"]["aux"]);
        let message_m = [&label("nonce_m_label")[..], &statement, &aux].concat();
        assert_eq!(bytes(&vector["nonce_m"]["message"]), message_m, "{name}");
        let okm = hmac_sha512(&bytes(&vector["messaging_secret_key"]), &message_m);
        assert_eq!(bytes(&vector["nonce_m"]["hmac"]), okm, "{name}");
        let k_m = mod_q(&okm);
        assert_eq!(scalar(&vector["nonce_m"]["scalar"]), k_m);
        let t_m = h_s * k_m;
        assert_eq!(point(&vector["t_m"]), t_m, "{name}");
        let message_x = [
            &label("nonce_x_label")[..],
            &statement,
            &t_m.to_compressed(),
            &aux,
        ]
        .concat();
        assert_eq!(bytes(&vector["nonce_x"]["message"]), message_x, "{name}");
        let okm = hmac_sha512(&bytes(&vector["spend_secret_key"]), &message_x);
        assert_eq!(bytes(&vector["nonce_x"]["hmac"]), okm, "{name}");
        let k_x = mod_q(&okm);
        assert_eq!(scalar(&vector["nonce_x"]["scalar"]), k_x);
        let t_x = g_s * k_x;
        assert_eq!(point(&vector["t_x"]), t_x, "{name}");

        // The challenge and the responses.
        let hash: [u8; 32] = Sha256::new()
            .chain_update(label("label"))
            .chain_update(&statement)
            .chain_update(t_x.to_compressed())
            .chain_update(t_m.to_compressed())
            .finalize()
            .into();
        assert_eq!(bytes(&vector["challenge"]), hash, "{name}");
        unreduced += usize::from(Option::<Scalar>::from(Scalar::from_bytes_be(&hash)).is_none());
        let c = mod_q(&hash);
        let (x, x_m) = (
            scalar(&vector["spend_secret_key"]),
            scalar(&vector["messaging_secret_key"]),
        );
        let (z_x, z_m) = (k_x + c * x, k_m + c * x_m);
        for (field, value) in [("c", c), ("z_x", z_x), ("z_m", z_m)] {
            assert_eq!(scalar(&vector[field]), value, "{name}: {field}");
        }
        assert_eq!(
            &body[body.len() - 96..],
            &[c.to_bytes_be(), z_x.to_bytes_be(), z_m.to_bytes_be()].concat()[..]
        );
        // What a reader recomputes from the bytes alone.
        assert_eq!(g_s * z_x - u_s * c, t_x);
        assert_eq!(h_s * z_m - m_s * c, t_m);

        // Its listing digest under its pool's name: the relay's function,
        // and §21.7's formula, SHA-256(label ‖ len(pool) ‖ pool ‖ bytes).
        let pool = vector["pool"].as_str().unwrap();
        let expected_pool = if chain.network() == NETWORK_MAINNET {
            "mainnet"
        } else {
            "preprod"
        };
        assert_eq!(pool, expected_pool, "{name}");
        let digest = listing_digest(pool, &body).unwrap();
        assert_eq!(digest.to_vec(), bytes(&vector["listing_digest"]), "{name}");
        let by_hand: [u8; 32] = Sha256::new()
            .chain_update(label("listing_stamp_label"))
            .chain_update([pool.len() as u8])
            .chain_update(pool.as_bytes())
            .chain_update(&body)
            .finalize()
            .into();
        assert_eq!(digest, by_hand, "{name}");
        // Never an envelope's stamp digest, nor the other pool's.
        assert_ne!(digest, stamp_digest(pool, &body).unwrap());
        let other_pool = if pool == "mainnet" {
            "preprod"
        } else {
            "mainnet"
        };
        assert_ne!(digest, listing_digest(other_pool, &body).unwrap());

        // Read under the other network, it doesn't check.
        let other = if chain.network() == NETWORK_PREPROD {
            NETWORK_MAINNET
        } else {
            NETWORK_PREPROD
        };
        let elsewhere = Chain::new(other, *chain.policy()).unwrap();
        assert_eq!(
            Certificate::from_bytes(&elsewhere, &body).err(),
            Some(Error::InvalidCertificate)
        );
        // The same keys make another for the same Seedelf, with the same
        // handle; given the other way round, or one for both, they make none.
        let fresh = Certificate::make(&spend, &messaging, &seedelf).unwrap();
        assert_ne!(fresh.to_bytes(), body);
        assert_eq!(fresh.handle(), &handle);
        assert!(Certificate::from_bytes(&chain, &fresh.to_bytes()).is_ok());
        assert_eq!(
            Certificate::make(&messaging, &spend, &seedelf).err(),
            Some(Error::NotOwned)
        );
        assert_eq!(
            Certificate::make(&spend, &spend, &seedelf).err(),
            Some(Error::SameKey)
        );
        lengths.push(body.len());
        networks.push(chain.network());
    }
    lengths.sort_unstable();
    assert_eq!(lengths, [273, 273, 304, 304]);
    networks.sort_unstable();
    assert_eq!(networks, [0, 0, 1, 1]);
    assert!(unreduced >= 1, "a challenge hash at least q");

    let refusals = file["refusals"].as_array().unwrap();
    assert!(refusals.len() >= 69);
    let goods: Vec<Vec<u8>> = certificates
        .iter()
        .map(|c| bytes(&c["certificate"]))
        .collect();
    let q: [u8; 32] = bytes(&file["group_order"]).try_into().unwrap();
    let mut results = std::collections::BTreeSet::new();
    let mut plus_q = 0;
    for refusal in refusals {
        // A scalar at or past q, less q: a good certificate again, for the
        // ones that are a good certificate's scalar plus q.
        let body = bytes(&refusal["certificate"]);
        if body.len() == CERTIFICATE_MAX_LEN {
            for at in [body.len() - 96, body.len() - 64, body.len() - 32] {
                let scalar: [u8; 32] = body[at..at + 32].try_into().unwrap();
                if scalar < q {
                    continue;
                }
                let mut reduced = body.clone();
                let mut borrow = 0i16;
                for i in (0..32).rev() {
                    let digit = i16::from(scalar[i]) - i16::from(q[i]) - borrow;
                    reduced[at + i] = digit.rem_euclid(256) as u8;
                    borrow = i16::from(digit < 0);
                }
                if goods.contains(&reduced) {
                    assert_eq!(
                        refusal["result"], "invalid_certificate",
                        "{}",
                        refusal["name"]
                    );
                    plus_q += 1;
                }
            }
        }
        let result = match Certificate::from_bytes(&chain(refusal), &bytes(&refusal["certificate"]))
        {
            Ok(_) => "ok",
            Err(error) => code(error),
        };
        assert_eq!(
            result,
            refusal["result"].as_str().unwrap(),
            "{}",
            refusal["name"]
        );
        results.insert(result);
    }
    assert_eq!(
        plus_q, 3,
        "c, z_x and z_m, each a good certificate's plus q"
    );
    assert_eq!(
        results.into_iter().collect::<Vec<_>>(),
        [
            "identity_point",
            "invalid_certificate",
            "invalid_encoding",
            "not_in_subgroup",
            "ok",
            "unsupported_version",
        ]
    );
}

/// `body` with its 32-byte value at `at` less q, when it's at least q.
fn minus_q(body: &[u8], at: usize, q: &[u8; 32]) -> Option<Vec<u8>> {
    let value: [u8; 32] = body[at..at + 32].try_into().unwrap();
    if value < *q {
        return None;
    }
    let mut out = body.to_vec();
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let digit = i16::from(value[i]) - i16::from(q[i]) - borrow;
        out[at + i] = digit.rem_euclid(256) as u8;
        borrow = i16::from(digit < 0);
    }
    Some(out)
}

#[test]
fn every_withdrawal_and_its_refusal_reads_through_the_public_api() {
    let file: Value =
        serde_json::from_str(include_str!("vectors/messaging_certificate_v1.json")).unwrap();
    let label = |name: &str| file[name].as_str().unwrap().as_bytes().to_vec();
    assert_eq!(
        label("withdrawal_label"),
        b"Seedelf-Messaging|v1|withdrawal"
    );
    assert_eq!(
        label("withdrawal_nonce_label"),
        b"Seedelf-Messaging|v1|withdrawal-nonce"
    );
    assert_eq!(
        label("unlisting_stamp_label"),
        b"Seedelf-Messaging|v1|unlisting-stamp|"
    );
    assert_eq!(label("unlisting_stamp_label"), UNLISTING_STAMP_LABEL);
    let certificates = file["certificates"].as_array().unwrap();
    let withdrawals = file["withdrawals"].as_array().unwrap();
    assert_eq!(withdrawals.len(), certificates.len());
    let (mut goods, mut indices, mut unreduced) = (Vec::new(), Vec::new(), 0);
    for vector in withdrawals {
        let name = vector["name"].as_str().unwrap();
        let index = vector["certificate"].as_u64().unwrap() as usize;
        indices.push(index);
        let held = &certificates[index];
        let chain = chain(held);
        assert_eq!(network(vector), chain.network(), "{name}");
        let pool = vector["pool"].as_str().unwrap();
        assert_eq!(pool, chain.pool(), "{name}");
        let posted = bytes(&held["certificate"]);
        let certificate = Certificate::from_bytes(&chain, &posted).unwrap();

        // The digest it names: the certificate's listing digest.
        let digest = certificate.listing_digest();
        assert_eq!(digest, listing_digest(pool, &posted).unwrap());
        assert_eq!(digest.to_vec(), bytes(&held["listing_digest"]), "{name}");
        assert_eq!(digest.to_vec(), bytes(&vector["digest"]), "{name}");

        // On the certificate's messaging register, with its messaging key.
        let (h_s, m_s) = (point(&vector["base"]), point(&vector["messaging_value"]));
        let register = certificate.handle().register();
        assert_eq!(register.generator_bytes(), h_s.to_compressed());
        assert_eq!(register.public_value_bytes(), m_s.to_compressed());
        assert_eq!(point(&held["seedelf"]["base"]), h_s);
        assert_eq!(point(&held["messaging_value"]), m_s);
        assert_eq!(
            vector["messaging_secret_key"], held["messaging_secret_key"],
            "{name}"
        );
        let x_m = scalar(&vector["messaging_secret_key"]);
        assert_eq!(h_s * x_m, m_s);

        // k, T, c and z from §21.7's formulas.
        let statement = [&[0x01, chain.network()][..], &digest].concat();
        assert_eq!(bytes(&vector["statement"]), statement, "{name}");
        let aux = bytes(&vector["draws"]["aux"]);
        let message = [
            &label("withdrawal_nonce_label")[..],
            &statement,
            &h_s.to_compressed(),
            &m_s.to_compressed(),
            &aux,
        ]
        .concat();
        assert_eq!(bytes(&vector["nonce"]["message"]), message, "{name}");
        let okm = hmac_sha512(&bytes(&vector["messaging_secret_key"]), &message);
        assert_eq!(bytes(&vector["nonce"]["hmac"]), okm, "{name}");
        let k = mod_q(&okm);
        assert_eq!(scalar(&vector["nonce"]["scalar"]), k);
        let t = h_s * k;
        assert_eq!(point(&vector["t"]), t, "{name}");
        let hash: [u8; 32] = Sha256::new()
            .chain_update(label("withdrawal_label"))
            .chain_update(&statement)
            .chain_update(h_s.to_compressed())
            .chain_update(m_s.to_compressed())
            .chain_update(t.to_compressed())
            .finalize()
            .into();
        assert_eq!(bytes(&vector["challenge"]), hash, "{name}");
        unreduced += usize::from(Option::<Scalar>::from(Scalar::from_bytes_be(&hash)).is_none());
        let c = mod_q(&hash);
        let z = k + c * x_m;
        assert_eq!(scalar(&vector["c"]), c, "{name}");
        assert_eq!(scalar(&vector["z"]), z, "{name}");
        let body = [&statement[..], &c.to_bytes_be(), &z.to_bytes_be()].concat();
        assert_eq!(bytes(&vector["withdrawal"]), body, "{name}");
        assert_eq!(body.len(), WITHDRAWAL_LEN);
        assert_eq!(h_s * z - m_s * c, t);

        // It reads, names that certificate, and checks against it.
        let withdrawal = Withdrawal::from_bytes(&chain, &body).unwrap();
        assert_eq!(withdrawal.to_bytes(), body);
        assert_eq!(withdrawal.digest(), &digest);
        assert_eq!(withdrawal.check(&certificate), Ok(()), "{name}");

        // Its post's stamp digest, under its pool.
        let unlisting = unlisting_digest(pool, &body).unwrap();
        assert_eq!(
            unlisting.to_vec(),
            bytes(&vector["unlisting_digest"]),
            "{name}"
        );
        let by_hand: [u8; 32] = Sha256::new()
            .chain_update(label("unlisting_stamp_label"))
            .chain_update([pool.len() as u8])
            .chain_update(pool.as_bytes())
            .chain_update(&body)
            .finalize()
            .into();
        assert_eq!(unlisting, by_hand);

        // The messaging key withdraws afresh; the Seedelf key never does.
        let messaging = secret(&vector["messaging_secret_key"]);
        let fresh = Withdrawal::make(&messaging, &certificate).unwrap();
        assert_ne!(fresh.to_bytes(), body);
        assert_eq!(fresh.check(&certificate), Ok(()));
        assert_eq!(
            Withdrawal::make(&secret(&held["spend_secret_key"]), &certificate).err(),
            Some(Error::NotForThisKey)
        );
        // Neither reads as the other.
        assert_eq!(
            Certificate::from_bytes(&chain, &body).err(),
            Some(Error::InvalidCertificate)
        );
        assert_eq!(
            Withdrawal::from_bytes(&chain, &posted).err(),
            Some(Error::InvalidWithdrawal)
        );
        goods.push(body);
    }
    assert_eq!(indices, [0, 1, 2, 3]);
    assert!(unreduced >= 1, "a challenge hash at least q");

    let q: [u8; 32] = bytes(&file["group_order"]).try_into().unwrap();
    let refusals = file["withdrawal_refusals"].as_array().unwrap();
    assert!(refusals.len() >= 25);
    let (mut results, mut plus_q) = (std::collections::BTreeSet::new(), 0);
    for refusal in refusals {
        let against = &refusal["against"];
        let certificate =
            Certificate::from_bytes(&chain(against), &bytes(&against["certificate"])).unwrap();
        let body = bytes(&refusal["withdrawal"]);
        let result = match Withdrawal::from_bytes(&chain(refusal), &body)
            .and_then(|withdrawal| withdrawal.check(&certificate))
        {
            Ok(()) => "ok",
            Err(error) => code(error),
        };
        assert_eq!(
            result,
            refusal["result"].as_str().unwrap(),
            "{}",
            refusal["name"]
        );
        results.insert(result);
        // A good withdrawal with c or z plus q: refused, where a reader that
        // reduced would take it.
        if body.len() == WITHDRAWAL_LEN {
            for at in [34, 66] {
                if minus_q(&body, at, &q).is_some_and(|reduced| goods.contains(&reduced)) {
                    assert_eq!(result, "invalid_withdrawal", "{}", refusal["name"]);
                    plus_q += 1;
                }
            }
        }
    }
    assert_eq!(plus_q, 2, "c and z, each a good withdrawal's plus q");
    assert_eq!(
        results.into_iter().collect::<Vec<_>>(),
        ["invalid_withdrawal", "ok", "unsupported_version"]
    );
}
