//! The Double Ratchet, with docs/protocol.md §4.1's choices.
//!
//! Every method here changes `self` freely: the caller runs it on a copy and
//! keeps the copy only on success (§4.2), which is what makes a failed
//! message leave no trace.

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::Error;
use crate::keys::{scalar_from_bytes, scalar_mod_q};
use crate::register::{POINT_LEN, decode_point};
use crate::session::draw::Draw;
use crate::session::first_contact::Reader;
use crate::session::secret::Secret32;

/// The most keys one message may make the reader skip, across the chain it
/// ends and the chain it starts.
pub const MAX_SKIP: u32 = 1000;

/// The most skipped keys a conversation stores. Past it, the oldest are
/// deleted and their messages count as missing.
pub const MAX_STORED_SKIPPED: usize = 2 * MAX_SKIP as usize;

/// The most keys a session message past [`MAX_SKIP`] may make the reader
/// step past, counted as [`MAX_SKIP`] is, to learn whether it authenticates:
/// 4,096, a choice (docs/protocol.md §16.4), about a week of one address
/// posting at the relay's cap. Stepping stores no key, and the message is
/// still refused, as too far ahead only if it authenticates. Past it, the
/// message is refused as one that doesn't authenticate, with nothing derived.
pub const MAX_AUTH_STEPS: u32 = 1 << 12;

/// How long a skipped key is kept: 48 hours from when it was stored. It's
/// usable while `now ≤ stored + 48 h`.
pub const SKIPPED_KEY_LIFETIME: u64 = 48 * 3600;

/// A ratchet header: the sender's ratchet public key, then `PN` and `N`.
pub const RATCHET_HEADER_LEN: usize = POINT_LEN + 4 + 4;

/// The ratchet ciphertext's salt.
pub const RATCHET_SALT_LEN: usize = 16;

/// What the ratchet ciphertext adds to the plaintext: the salt and the tag.
pub const RATCHET_OVERHEAD: usize = RATCHET_SALT_LEN + 16;

/// KDF_RK's HKDF info.
pub(crate) const ROOT_INFO: &[u8] = b"Seedelf-Messaging|v1|ratchet|root";

/// ENCRYPT's HKDF info.
pub(crate) const MESSAGE_INFO: &[u8] = b"Seedelf-Messaging|v1|ratchet|message";

/// The outer scalar's HKDF info.
pub(crate) const OUTER_INFO: &[u8] = b"Seedelf-Messaging|v1|ratchet|outer";

/// The envelope's ephemeral scalar's HKDF info. Under one key (the salt and
/// mk) HKDF takes three infos, this one, [`MESSAGE_INFO`] and [`OUTER_INFO`],
/// none a prefix of another.
pub(crate) const ENVELOPE_EPHEMERAL_INFO: &[u8] =
    b"Seedelf-Messaging|v1|ratchet|envelope-ephemeral";

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[cfg(test)]
thread_local! {
    /// KDF_CK calls on this thread, so a test can bound a message's work.
    pub(crate) static KDF_CK_CALLS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// KDF_RK(rk, dh) = HKDF-SHA256(salt = rk, ikm = dh,
/// info = "Seedelf-Messaging|v1|ratchet|root"), 64 bytes: the new root key,
/// then a chain key.
pub(crate) fn kdf_rk(rk: &Secret32, dh: &[u8; POINT_LEN]) -> (Secret32, Secret32) {
    let mut okm = Zeroizing::new([0u8; 64]);
    Hkdf::<Sha256>::new(Some(rk.bytes()), dh)
        .expand(ROOT_INFO, okm.as_mut())
        .expect("64 bytes is within HKDF-SHA256's limit");
    let mut root = Secret32::zero();
    let mut chain = Secret32::zero();
    root.as_mut().copy_from_slice(&okm[..32]);
    chain.as_mut().copy_from_slice(&okm[32..]);
    (root, chain)
}

/// KDF_CK(ck): the message key HMAC-SHA256(ck, 0x01) and the next chain key
/// HMAC-SHA256(ck, 0x02). Returns the next chain key, then the message key.
pub(crate) fn kdf_ck(ck: &Secret32) -> (Secret32, Secret32) {
    #[cfg(test)]
    KDF_CK_CALLS.with(|calls| calls.set(calls.get() + 1));
    let hmac = |byte: u8| {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(ck.bytes())
            .expect("HMAC takes a key of any length");
        mac.update(&[byte]);
        Secret32::from_bytes(mac.finalize().into_bytes().into())
    };
    let message = hmac(0x01);
    let next = hmac(0x02);
    (next, message)
}

/// ENCRYPT's key and nonce: HKDF-SHA256(salt = salt, ikm = mk,
/// info = "Seedelf-Messaging|v1|ratchet|message"), 44 bytes.
pub(crate) fn message_key_and_nonce(
    mk: &Secret32,
    salt: &[u8; RATCHET_SALT_LEN],
) -> Zeroizing<[u8; KEY_LEN + NONCE_LEN]> {
    let mut okm = Zeroizing::new([0u8; KEY_LEN + NONCE_LEN]);
    Hkdf::<Sha256>::new(Some(salt), mk.bytes())
        .expand(MESSAGE_INFO, okm.as_mut())
        .expect("44 bytes is within HKDF-SHA256's limit");
    okm
}

/// The outer scalar's 64 bytes: HKDF-SHA256(salt = salt, ikm = mk,
/// info = "Seedelf-Messaging|v1|ratchet|outer").
pub(crate) fn outer_okm(mk: &Secret32, salt: &[u8; RATCHET_SALT_LEN]) -> Zeroizing<[u8; 64]> {
    let mut okm = Zeroizing::new([0u8; 64]);
    Hkdf::<Sha256>::new(Some(salt), mk.bytes())
        .expand(OUTER_INFO, okm.as_mut())
        .expect("64 bytes is within HKDF-SHA256's limit");
    okm
}

/// The outer scalar `o`: [`outer_okm`] as a big-endian integer mod the group
/// order. A message's envelope goes to the other side's identity
/// re-randomized by `o`, so its reader can check the envelope belongs to the
/// conversation (docs/protocol.md §16.2). Zero only with probability about
/// 2⁻²⁵⁵.
pub(crate) fn outer_scalar(mk: &Secret32, salt: &[u8; RATCHET_SALT_LEN]) -> Scalar {
    scalar_mod_q(outer_okm(mk, salt).as_ref())
}

/// The envelope's ephemeral scalar's 64 bytes: HKDF-SHA256(salt = salt,
/// ikm = mk, info = "Seedelf-Messaging|v1|ratchet|envelope-ephemeral").
pub(crate) fn envelope_ephemeral_okm(
    mk: &Secret32,
    salt: &[u8; RATCHET_SALT_LEN],
) -> Zeroizing<[u8; 64]> {
    let mut okm = Zeroizing::new([0u8; 64]);
    Hkdf::<Sha256>::new(Some(salt), mk.bytes())
        .expand(ENVELOPE_EPHEMERAL_INFO, okm.as_mut())
        .expect("64 bytes is within HKDF-SHA256's limit");
    okm
}

/// The envelope's ephemeral scalar `r`: [`envelope_ephemeral_okm`] as a
/// big-endian integer mod the group order. A message's envelope has
/// `c = [r]p`, so its reader can check `c` is the writer's own and not a
/// point built on another register (docs/protocol.md §16.2). Zero only with
/// probability about 2⁻²⁵⁵.
pub(crate) fn envelope_ephemeral_scalar(mk: &Secret32, salt: &[u8; RATCHET_SALT_LEN]) -> Scalar {
    scalar_mod_q(envelope_ephemeral_okm(mk, salt).as_ref())
}

/// ENCRYPT(mk, m, ad) with a given salt: `salt ‖ AES-256-GCM(key, nonce, ad, m)`.
pub(crate) fn encrypt(
    mk: &Secret32,
    salt: &[u8; RATCHET_SALT_LEN],
    plaintext: &[u8],
    ad: &[u8],
) -> Result<Vec<u8>, Error> {
    let okm = message_key_and_nonce(mk, salt);
    let sealed = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm[..KEY_LEN]))
        .encrypt(
            Nonce::from_slice(&okm[KEY_LEN..]),
            Payload {
                msg: plaintext,
                aad: ad,
            },
        )
        .map_err(|_| Error::MessageTooLarge)?;
    let mut out = Vec::with_capacity(RATCHET_SALT_LEN + sealed.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// DECRYPT: the salt from the front, then AES-256-GCM.
pub(crate) fn decrypt(mk: &Secret32, ciphertext: &[u8], ad: &[u8]) -> Result<Vec<u8>, Error> {
    if ciphertext.len() < RATCHET_OVERHEAD {
        return Err(Error::InvalidMessage);
    }
    let (salt, sealed) = ciphertext.split_at(RATCHET_SALT_LEN);
    let okm = message_key_and_nonce(mk, salt.try_into().expect("16 bytes"));
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm[..KEY_LEN]))
        .decrypt(
            Nonce::from_slice(&okm[KEY_LEN..]),
            Payload {
                msg: sealed,
                aad: ad,
            },
        )
        .map_err(|_| Error::DecryptionFailed)
}

/// A ratchet header: `DH ‖ PN ‖ N`, the counters big-endian.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Header {
    pub(crate) dh: G1Affine,
    pub(crate) pn: u32,
    pub(crate) n: u32,
}

impl Header {
    /// The sender's ratchet public key, compressed.
    pub fn ratchet_key_bytes(&self) -> [u8; POINT_LEN] {
        self.dh.to_compressed()
    }

    /// `PN`: how many messages the sender's previous sending chain had.
    pub fn previous_count(&self) -> u32 {
        self.pn
    }

    /// `N`: this message's number in its sending chain.
    pub fn number(&self) -> u32 {
        self.n
    }

    /// The header's 56 bytes.
    pub fn to_bytes(&self) -> [u8; RATCHET_HEADER_LEN] {
        let mut out = [0u8; RATCHET_HEADER_LEN];
        out[..POINT_LEN].copy_from_slice(&self.dh.to_compressed());
        out[POINT_LEN..POINT_LEN + 4].copy_from_slice(&self.pn.to_be_bytes());
        out[POINT_LEN + 4..].copy_from_slice(&self.n.to_be_bytes());
        out
    }

    pub(crate) fn read(reader: &mut Reader<'_>) -> Result<Self, Error> {
        Ok(Self {
            dh: decode_point(&reader.array()?)?,
            pn: u32::from_be_bytes(reader.array()?),
            n: u32::from_be_bytes(reader.array()?),
        })
    }
}

/// A ratchet key pair on the conversation's base: `(s, [s]p₀)`.
#[derive(Clone, Debug)]
pub(crate) struct KeyPair {
    /// The scalar's canonical big-endian bytes.
    pub(crate) secret: Secret32,
    pub(crate) public: G1Affine,
}

impl KeyPair {
    pub(crate) fn generate(base: &G1Affine, draw: &mut dyn Draw) -> Self {
        let scalar = draw.scalar();
        Self {
            secret: Secret32::from_bytes(scalar.to_bytes_be()),
            public: (G1Projective::from(*base) * scalar).to_affine(),
        }
    }

    /// DH(s, P) = [s]P, compressed. `point` was checked when it was read.
    pub(crate) fn dh(&self, point: &G1Affine) -> Zeroizing<[u8; POINT_LEN]> {
        let scalar =
            scalar_from_bytes(self.secret.bytes()).expect("a stored ratchet key is canonical");
        Zeroizing::new((G1Projective::from(*point) * scalar).to_compressed())
    }
}

/// A skipped message key, stored until it's used or its 48 hours pass.
#[derive(Clone, Debug)]
pub(crate) struct Skipped {
    pub(crate) dh: G1Affine,
    pub(crate) n: u32,
    pub(crate) mk: Secret32,
    pub(crate) stored_at: u64,
}

/// A stored skipped key, after its run's ratchet key: `N (4) | mk (32) |
/// stored at (8)`.
const SKIPPED_KEY_LEN: usize = 4 + 32 + 8;

/// A run's ratchet key and count, before its keys.
const RUN_HEAD_LEN: usize = POINT_LEN + 2;

/// The skipped keys' runs, in the order stored: each the longest stretch of
/// consecutive keys on one ratchet key. One ratchet key can head two runs,
/// since the other side picks its keys and may use one again.
fn runs(skipped: &[Skipped]) -> impl Iterator<Item = &[Skipped]> {
    skipped.chunk_by(|one, next| one.dh == next.dh)
}

/// The bytes [`write_skipped`] writes for `skipped`.
pub(crate) fn skipped_len(skipped: &[Skipped]) -> usize {
    2 + runs(skipped)
        .map(|run| RUN_HEAD_LEN + run.len() * SKIPPED_KEY_LEN)
        .sum::<usize>()
}

/// The stored skipped keys, as runs in the order stored (docs/protocol.md
/// §16.5): `runs (2) | runs × ( DH (48) | count (2) | count × ( N (4) | mk
/// (32) | stored at (8) ) )`. Each run's ratchet key is written once.
pub(crate) fn write_skipped(skipped: &[Skipped], out: &mut Vec<u8>) {
    // At most MAX_STORED_SKIPPED keys, and so runs, which fit a u16.
    out.extend_from_slice(&(runs(skipped).count() as u16).to_be_bytes());
    for run in runs(skipped) {
        out.extend_from_slice(&run[0].dh.to_compressed());
        out.extend_from_slice(&(run.len() as u16).to_be_bytes());
        for key in run {
            out.extend_from_slice(&key.n.to_be_bytes());
            out.extend_from_slice(key.mk.bytes());
            out.extend_from_slice(&key.stored_at.to_be_bytes());
        }
    }
}

/// The skipped keys [`write_skipped`] wrote, which end a stored state, with
/// `left` the bytes left in it. At most [`MAX_STORED_SKIPPED`] runs and keys
/// in all, each run at least one key, and two adjacent runs never on one
/// ratchet key, so a list has one encoding. Each ratchet key's encoding is
/// decoded and checked once, however many runs it heads.
pub(crate) fn read_skipped(reader: &mut Reader<'_>, left: usize) -> Result<Vec<Skipped>, Error> {
    let runs = usize::from(u16::from_be_bytes(reader.array()?));
    if runs > MAX_STORED_SKIPPED {
        return Err(Error::InvalidState);
    }
    // The keys end the record, so the bytes left give their number exactly
    // when it's well formed: room for all of them at once, so no copy of a
    // key is left behind by the list's growth.
    let keys = left.saturating_sub(2 + runs * RUN_HEAD_LEN) / SKIPPED_KEY_LEN;
    let mut skipped = Vec::with_capacity(keys.min(MAX_STORED_SKIPPED));
    let mut decoded: BTreeMap<[u8; POINT_LEN], G1Affine> = BTreeMap::new();
    let mut previous = None;
    for _ in 0..runs {
        let encoding: [u8; POINT_LEN] = reader.array()?;
        let count = usize::from(u16::from_be_bytes(reader.array()?));
        if previous == Some(encoding) || count == 0 || skipped.len() + count > MAX_STORED_SKIPPED {
            return Err(Error::InvalidState);
        }
        previous = Some(encoding);
        let dh = match decoded.entry(encoding) {
            Entry::Occupied(known) => *known.get(),
            Entry::Vacant(new) => *new.insert(decode_point(&encoding)?),
        };
        for _ in 0..count {
            skipped.push(Skipped {
                dh,
                n: u32::from_be_bytes(reader.array()?),
                mk: Secret32::from_bytes(reader.array()?),
                stored_at: u64::from_be_bytes(reader.array()?),
            });
        }
    }
    Ok(skipped)
}

/// The Double Ratchet's state: the specification's RK, CKs, CKr, DHs, DHr,
/// Ns, Nr, PN and MKSKIPPED, and a count of skipped keys deleted unused.
#[derive(Clone, Debug)]
pub(crate) struct Ratchet {
    pub(crate) rk: Secret32,
    pub(crate) cks: Option<Secret32>,
    pub(crate) ckr: Option<Secret32>,
    pub(crate) dhs: KeyPair,
    pub(crate) dhr: Option<G1Affine>,
    pub(crate) ns: u32,
    pub(crate) nr: u32,
    pub(crate) pn: u32,
    /// In the order they were stored, first stored first: the order lookups
    /// search in, eviction takes from, and storage keeps.
    pub(crate) skipped: Vec<Skipped>,
    /// Skipped keys deleted before their message arrived.
    pub(crate) lost: u64,
}

impl Ratchet {
    /// RatchetInitAlice: `(RK, CKs) = KDF_RK(SK, DH(DHs, DHr))`.
    pub(crate) fn init_alice(sk: &Secret32, dhs: KeyPair, bob: G1Affine) -> Self {
        let (rk, cks) = kdf_rk(sk, &dhs.dh(&bob));
        Self {
            rk,
            cks: Some(cks),
            ckr: None,
            dhs,
            dhr: Some(bob),
            ns: 0,
            nr: 0,
            pn: 0,
            skipped: Vec::new(),
            lost: 0,
        }
    }

    /// RatchetInitBob: `RK = SK`, and Bob's key pair as DHs. Only ever a
    /// scratch state: the first message's ratchet step replaces DHs.
    pub(crate) fn init_bob(sk: Secret32, dhs: KeyPair) -> Self {
        Self {
            rk: sk,
            cks: None,
            ckr: None,
            dhs,
            dhr: None,
            ns: 0,
            nr: 0,
            pn: 0,
            skipped: Vec::new(),
            lost: 0,
        }
    }

    /// RatchetEncrypt's chain step: the header and the message key, with
    /// `Ns` advanced.
    pub(crate) fn next_sending(&mut self) -> Result<(Header, Secret32), Error> {
        let cks = self.cks.as_ref().ok_or(Error::InvalidState)?;
        let ns_after = self.ns.checked_add(1).ok_or(Error::ChainExhausted)?;
        let (next, mk) = kdf_ck(cks);
        let header = Header {
            dh: self.dhs.public,
            pn: self.pn,
            n: self.ns,
        };
        self.cks = Some(next);
        self.ns = ns_after;
        Ok((header, mk))
    }

    /// RatchetDecrypt, with the bound that no message skips more than
    /// [`MAX_SKIP`] keys in all, and skipped keys usable for 48 hours.
    /// Returns the plaintext and the message key that opened it.
    ///
    /// Past the bound it's [`Error::TooFarAhead`] with nothing derived,
    /// whether the message authenticates or not: the conversation says which
    /// ([`Ratchet::authenticate_far`]).
    ///
    /// `ad_prefix` is `cid ‖ R_A ‖ R_B`; the header follows it in the
    /// associated data.
    pub(crate) fn decrypt(
        &mut self,
        base: &G1Affine,
        header: &Header,
        ciphertext: &[u8],
        ad_prefix: &[u8],
        now: u64,
        draw: &mut dyn Draw,
    ) -> Result<(Vec<u8>, Secret32), Error> {
        let mut ad = Vec::with_capacity(ad_prefix.len() + RATCHET_HEADER_LEN);
        ad.extend_from_slice(ad_prefix);
        ad.extend_from_slice(&header.to_bytes());

        // TrySkippedMessageKeys.
        if let Some(i) = self
            .skipped
            .iter()
            .position(|key| key.dh == header.dh && key.n == header.n)
        {
            if now
                > self.skipped[i]
                    .stored_at
                    .saturating_add(SKIPPED_KEY_LIFETIME)
            {
                return Err(Error::KeyUsedOrDeleted);
            }
            let plaintext = decrypt(&self.skipped[i].mk, ciphertext, &ad)?;
            let used = self.skipped.remove(i);
            return Ok((plaintext, used.mk));
        }

        let new_chain = self.dhr != Some(header.dh);
        if !new_chain {
            // Alice before Bob's first reply has DHr = w₀ and no CKr: nothing
            // on that key is a message to her.
            if self.ckr.is_none() {
                return Err(Error::DecryptionFailed);
            }
            if header.n < self.nr {
                return Err(Error::KeyUsedOrDeleted);
            }
        }

        // The bound, before any key is derived.
        if self.skip_count(header, new_chain) > u64::from(MAX_SKIP) {
            return Err(Error::TooFarAhead);
        }
        // N = u32::MAX would leave Nr past the counter's range.
        if header.n == u32::MAX {
            return Err(Error::TooFarAhead);
        }

        if new_chain {
            self.skip_to(header.pn, now);
            self.dh_ratchet(base, header.dh, draw);
        }
        self.skip_to(header.n, now);
        let ckr = self
            .ckr
            .as_ref()
            .expect("a receiving chain exists after the ratchet step");
        let (next, mk) = kdf_ck(ckr);
        self.ckr = Some(next);
        self.nr = header.n + 1;
        let plaintext = decrypt(&mk, ciphertext, &ad)?;
        self.evict();
        Ok((plaintext, mk))
    }

    /// The keys a message makes the reader skip, in all: the old receiving
    /// chain's remainder (PN − Nr) when a new header key ends one, then the
    /// message's chain up to N. On the current chain the caller has checked
    /// N isn't below Nr.
    fn skip_count(&self, header: &Header, new_chain: bool) -> u64 {
        let old = match (&self.ckr, new_chain) {
            (Some(_), true) => u64::from(header.pn.saturating_sub(self.nr)),
            _ => 0,
        };
        let new = if new_chain {
            u64::from(header.n)
        } else {
            u64::from(header.n - self.nr)
        };
        old + new
    }

    /// The message key of a message [`Ratchet::decrypt`] refused as too far
    /// ahead, if the message authenticates (docs/protocol.md §16.4). It reads
    /// the state and changes nothing: it stores no key and draws nothing.
    ///
    /// - **A new header key:** the receiving half of the DH step,
    ///   `KDF_RK(RK, DH(DHs, key))`'s chain key, stepped N times. The old
    ///   chain's remainder, PN − Nr, counts against the bound as it does
    ///   against [`MAX_SKIP`], though none of its keys is derived.
    /// - **The current chain:** CKr stepped N − Nr times.
    ///
    /// At most [`MAX_AUTH_STEPS`] in all, else [`Error::DecryptionFailed`]
    /// with nothing derived; then the tag, the text wiped and dropped, and
    /// [`Error::DecryptionFailed`] if it fails. Only a held conversation's
    /// session message comes here, never a request's scratch state, whose
    /// ratchet key is the reader's long-term key.
    pub(crate) fn authenticate_far(
        &self,
        header: &Header,
        ciphertext: &[u8],
        ad_prefix: &[u8],
    ) -> Result<Secret32, Error> {
        let new_chain = self.dhr != Some(header.dh);
        let reachable = new_chain || (self.ckr.is_some() && header.n >= self.nr);
        // No sending chain reaches N = u32::MAX: it stops a message before.
        if !reachable
            || header.n == u32::MAX
            || self.skip_count(header, new_chain) > u64::from(MAX_AUTH_STEPS)
        {
            return Err(Error::DecryptionFailed);
        }
        let (mut ck, steps) = match (&self.ckr, new_chain) {
            (_, true) => (kdf_rk(&self.rk, &self.dhs.dh(&header.dh)).1, header.n),
            (Some(ckr), false) => (ckr.clone(), header.n - self.nr),
            (None, false) => return Err(Error::DecryptionFailed),
        };
        for _ in 0..steps {
            ck = kdf_ck(&ck).0;
        }
        let mk = kdf_ck(&ck).1;
        let mut ad = Vec::with_capacity(ad_prefix.len() + RATCHET_HEADER_LEN);
        ad.extend_from_slice(ad_prefix);
        ad.extend_from_slice(&header.to_bytes());
        // Only whether it authenticates: the text isn't the caller's.
        drop(Zeroizing::new(decrypt(&mk, ciphertext, &ad)?));
        Ok(mk)
    }

    /// SkipMessageKeys: store the receiving chain's keys up to `until`.
    /// Nothing without a receiving chain, as the specification's
    /// `if state.CKr != None`: Alice before Bob's first reply has DHr = w₀
    /// and no CKr, whatever PN a header claims.
    fn skip_to(&mut self, until: u32, now: u64) {
        let Some(dhr) = self.dhr else { return };
        while self.nr < until {
            let Some(ckr) = self.ckr.as_ref() else { return };
            let (next, mk) = kdf_ck(ckr);
            self.ckr = Some(next);
            self.skipped.push(Skipped {
                dh: dhr,
                n: self.nr,
                mk,
                stored_at: now,
            });
            self.nr += 1;
        }
    }

    /// DHRatchet.
    fn dh_ratchet(&mut self, base: &G1Affine, theirs: G1Affine, draw: &mut dyn Draw) {
        self.pn = self.ns;
        self.ns = 0;
        self.nr = 0;
        self.dhr = Some(theirs);
        let (rk, ckr) = kdf_rk(&self.rk, &self.dhs.dh(&theirs));
        self.rk = rk;
        self.ckr = Some(ckr);
        self.dhs = KeyPair::generate(base, draw);
        let (rk, cks) = kdf_rk(&self.rk, &self.dhs.dh(&theirs));
        self.rk = rk;
        self.cks = Some(cks);
    }

    /// Past [`MAX_STORED_SKIPPED`], delete the skipped keys stored first: in
    /// the list's order, which storage keeps, not by their times.
    fn evict(&mut self) {
        if self.skipped.len() > MAX_STORED_SKIPPED {
            let excess = self.skipped.len() - MAX_STORED_SKIPPED;
            self.skipped.drain(..excess);
            self.lost += excess as u64;
        }
    }

    /// Delete the skipped keys whose 48 hours have passed.
    pub(crate) fn expire(&mut self, now: u64) {
        let before = self.skipped.len();
        self.skipped
            .retain(|key| now <= key.stored_at.saturating_add(SKIPPED_KEY_LIFETIME));
        self.lost += (before - self.skipped.len()) as u64;
    }
}
