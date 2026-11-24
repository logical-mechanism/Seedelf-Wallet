use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use hkdf::Hkdf;
use hmac::digest::CtOutput;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::Error;
use crate::keys::{SecretKey, random_nonzero_scalar};
use crate::register::{POINT_LEN, Register, decode_point, rerandomize_with};

/// The envelope format this library writes and reads.
pub const VERSION: u8 = 1;

/// The largest plaintext an envelope carries: 64 KiB.
pub const MAX_PLAINTEXT_LEN: usize = 65_536;

/// The envelope's tag of `w`: a SHA-256 output.
const ENVELOPE_TAG_LEN: usize = 32;

/// Bytes before the ciphertext: version, `p`, the tag of `w`, `c`.
pub const HEADER_LEN: usize = 1 + POINT_LEN + ENVELOPE_TAG_LEN + POINT_LEN;

/// Where `c` starts: after the version, `p` and the tag.
const EPHEMERAL_AT: usize = 1 + POINT_LEN + ENVELOPE_TAG_LEN;

/// AES-GCM's tag.
const AEAD_TAG_LEN: usize = 16;

/// An envelope's size beyond its plaintext's: the header and AES-GCM's tag.
pub const ENVELOPE_OVERHEAD: usize = HEADER_LEN + AEAD_TAG_LEN;

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// HKDF-SHA256's salt. Every label names the protocol and its version, so
/// keys from another protocol, or another version of this one, never match.
pub(crate) const KDF_SALT: &[u8] = b"Seedelf-Messaging|v1|HKDF-SHA256|salt";

/// HKDF-SHA256's info, before the header: the output is the AES-256-GCM key
/// then its nonce.
pub(crate) const KDF_INFO: &[u8] = b"Seedelf-Messaging|v1|AES-256-GCM|key|nonce";

/// The tag's label, before `w`: the tag is SHA-256 of the two.
pub(crate) const ENVELOPE_TAG_LABEL: &[u8] = b"Seedelf-Messaging|v1|envelope|tag";

/// One encrypted message.
///
/// ```text
/// version (1) || p (48) || tag (32) || c (48) || AES-256-GCM ciphertext || tag (16)
/// ```
///
/// `(p, w)` is a fresh re-randomization of the recipient's register, which
/// the recipient recognizes and no one else can link to it. The envelope
/// carries `p` and a tag of `w`, SHA-256(`ENVELOPE_TAG_LABEL` ‖ `w`), never
/// `w` itself, so nothing in it is a register of the recipient's key, which
/// the recipient's wallet would spend a payment to: the recipient computes
/// `w = [y]p` and compares tags. `c = [r]p` is the sender's ephemeral
/// point; the shared point is `[r]w = [y]c`. The header (the first 129
/// bytes) goes into both the key derivation and the AEAD's associated data,
/// so a change to any of it fails decryption.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Envelope {
    generator: G1Affine,
    tag: [u8; ENVELOPE_TAG_LEN],
    ephemeral: G1Affine,
    ciphertext: Vec<u8>,
}

impl Envelope {
    /// Whether the envelope is addressed to `key`: its tag is the tag of
    /// `[y]p`, compared in constant time. Discovery only: [`decrypt_message`]
    /// still authenticates.
    pub fn is_for(&self, key: &SecretKey) -> bool {
        tag_matches(key, &self.generator, &self.tag)
    }

    /// The envelope's bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER_LEN + self.ciphertext.len());
        out.extend_from_slice(&self.header());
        out.extend_from_slice(&self.ciphertext);
        out
    }

    /// An envelope from untrusted bytes.
    ///
    /// Checks the version, the length, and `p` and `c` (canonical, in the
    /// prime-order subgroup, not the identity) before anything else is done
    /// with them; the tag is any 32 bytes. Doesn't decrypt. To scan a pool,
    /// [`matches_envelope`] first is cheaper: it skips `c` for the envelopes
    /// that aren't the reader's.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        let (generator, tag) = generator_and_tag(bytes)?;
        Ok(Self {
            generator,
            tag,
            ephemeral: point_at(bytes, EPHEMERAL_AT)?,
            ciphertext: bytes[HEADER_LEN..].to_vec(),
        })
    }

    /// `p`, the generator the envelope's register is on.
    pub(crate) fn generator_point(&self) -> G1Affine {
        self.generator
    }

    /// `c`, the sender's ephemeral point.
    pub(crate) fn ephemeral_point(&self) -> G1Affine {
        self.ephemeral
    }

    /// `version || p || tag || c`.
    pub(crate) fn header(&self) -> [u8; HEADER_LEN] {
        header(&self.generator, &self.tag, &self.ephemeral)
    }
}

/// Encrypts `plaintext` to the owner of `recipient`.
///
/// Re-randomizes the register with a fresh `b`, makes a fresh ephemeral
/// `c = [r]p`, derives the AES-256-GCM key and nonce from the shared point
/// `[r]w` and the header, and seals the plaintext with the header as
/// associated data. `b` and `r` come from the operating system's generator.
pub fn encrypt_message(recipient: &Register, plaintext: &[u8]) -> Result<Envelope, Error> {
    seal(
        recipient,
        &random_nonzero_scalar(),
        &random_nonzero_scalar(),
        plaintext,
    )
}

/// Decrypts and authenticates an envelope with the recipient's key.
///
/// [`Error::NotForThisKey`] if its tag isn't `key`'s;
/// [`Error::DecryptionFailed`] if any byte of it was changed.
pub fn decrypt_message(key: &SecretKey, envelope: &Envelope) -> Result<Vec<u8>, Error> {
    if !envelope.is_for(key) {
        return Err(Error::NotForThisKey);
    }
    let shared =
        Zeroizing::new((G1Projective::from(envelope.ephemeral) * key.scalar()).to_compressed());
    open(&shared, &envelope.header(), &envelope.ciphertext)
}

/// Whether an envelope's raw bytes are addressed to `key`: the scan of a pool.
///
/// Checks the version, the length, and `p` as [`Envelope::from_bytes`] does,
/// then tests whether the tag is SHA-256(label ‖ `[y]p`), in constant time.
/// It leaves `c` and the ciphertext alone, so an envelope that isn't the
/// reader's costs one subgroup check, one scalar multiplication and one
/// SHA-256. `Ok(true)` only says the envelope is the reader's to open:
/// [`Envelope::from_bytes`] then checks `c` before `key` ever touches it, and
/// [`decrypt_message`] authenticates.
pub fn matches_envelope(key: &SecretKey, bytes: &[u8]) -> Result<bool, Error> {
    let (generator, tag) = generator_and_tag(bytes)?;
    Ok(tag_matches(key, &generator, &tag))
}

/// The version and length checks, then `p`, checked, and the tag.
fn generator_and_tag(bytes: &[u8]) -> Result<(G1Affine, [u8; ENVELOPE_TAG_LEN]), Error> {
    let (&version, _) = bytes.split_first().ok_or(Error::InvalidLength)?;
    if version != VERSION {
        return Err(Error::UnsupportedVersion(version));
    }
    if bytes.len() < ENVELOPE_OVERHEAD || bytes.len() > ENVELOPE_OVERHEAD + MAX_PLAINTEXT_LEN {
        return Err(Error::InvalidLength);
    }
    let generator = point_at(bytes, 1)?;
    let tag = bytes
        .get(1 + POINT_LEN..EPHEMERAL_AT)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(Error::InvalidLength)?;
    Ok((generator, tag))
}

/// The header point starting at byte `start` (1 for `p`, [`EPHEMERAL_AT`]
/// for `c`), checked. The caller has checked the length.
fn point_at(bytes: &[u8], start: usize) -> Result<G1Affine, Error> {
    let chunk: &[u8; POINT_LEN] = bytes
        .get(start..start + POINT_LEN)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(Error::InvalidLength)?;
    decode_point(chunk)
}

/// SHA-256(`ENVELOPE_TAG_LABEL` ‖ `w`), `w` compressed: what an envelope
/// carries in place of `w`.
pub(crate) fn envelope_tag(w: &[u8; POINT_LEN]) -> CtOutput<Sha256> {
    CtOutput::new(
        Sha256::new()
            .chain_update(ENVELOPE_TAG_LABEL)
            .chain_update(w)
            .finalize(),
    )
}

/// The scan's test: whether `tag` is the tag of `[y]p`. digest's `CtOutput`
/// compares with subtle's `ConstantTimeEq`, so the time it takes says nothing
/// of how much of the tag matched. `[y]p` is a static Diffie–Hellman value on
/// a point someone else chose: it goes into the hash and nowhere else, and
/// its bytes are wiped.
fn tag_matches(key: &SecretKey, generator: &G1Affine, tag: &[u8; ENVELOPE_TAG_LEN]) -> bool {
    let w = Zeroizing::new((G1Projective::from(*generator) * key.scalar()).to_compressed());
    envelope_tag(&w) == CtOutput::new((*tag).into())
}

/// [`encrypt_message`] with given `b` and `r`, both nonzero. The test vectors
/// pass fixed ones, and the session layer derives both from the message key
/// (docs/protocol.md §16.2).
pub(crate) fn seal(
    recipient: &Register,
    b: &Scalar,
    r: &Scalar,
    plaintext: &[u8],
) -> Result<Envelope, Error> {
    if plaintext.len() > MAX_PLAINTEXT_LEN {
        return Err(Error::PlaintextTooLarge);
    }
    let register = rerandomize_with(recipient, b);
    let generator = register.generator_point();
    let ephemeral = (register.generator() * r).to_affine();
    let shared = Zeroizing::new((register.public_value() * r).to_compressed());
    let tag = envelope_tag(&register.public_value_bytes())
        .into_bytes()
        .into();
    let header = header(&generator, &tag, &ephemeral);
    let okm = derive_key_and_nonce(&shared, &header);
    let ciphertext = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm[..KEY_LEN]))
        .encrypt(
            Nonce::from_slice(&okm[KEY_LEN..]),
            Payload {
                msg: plaintext,
                aad: &header,
            },
        )
        // AES-GCM refuses only plaintexts of 64 GiB and more.
        .map_err(|_| Error::PlaintextTooLarge)?;
    Ok(Envelope {
        generator,
        tag,
        ephemeral,
        ciphertext,
    })
}

/// Opens `ciphertext` with the key and nonce derived from `shared` and `header`.
pub(crate) fn open(
    shared: &[u8; POINT_LEN],
    header: &[u8; HEADER_LEN],
    ciphertext: &[u8],
) -> Result<Vec<u8>, Error> {
    let okm = derive_key_and_nonce(shared, header);
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm[..KEY_LEN]))
        .decrypt(
            Nonce::from_slice(&okm[KEY_LEN..]),
            Payload {
                msg: ciphertext,
                aad: header,
            },
        )
        .map_err(|_| Error::DecryptionFailed)
}

/// HKDF-SHA256: salt [`KDF_SALT`], input the compressed shared point, info
/// [`KDF_INFO`] then the header; 44 bytes out, the key then the nonce.
///
/// Every envelope has its own `r`, so its own shared point and `c`, so its
/// own key: one nonce per key, derived rather than sent.
pub(crate) fn derive_key_and_nonce(
    shared: &[u8; POINT_LEN],
    header: &[u8; HEADER_LEN],
) -> Zeroizing<[u8; KEY_LEN + NONCE_LEN]> {
    let mut okm = Zeroizing::new([0u8; KEY_LEN + NONCE_LEN]);
    Hkdf::<Sha256>::new(Some(KDF_SALT), shared)
        .expand_multi_info(&[KDF_INFO, header], okm.as_mut())
        // HKDF-SHA256 refuses only outputs over 8,160 bytes.
        .expect("44 bytes is within HKDF-SHA256's limit");
    okm
}

fn header(
    generator: &G1Affine,
    tag: &[u8; ENVELOPE_TAG_LEN],
    ephemeral: &G1Affine,
) -> [u8; HEADER_LEN] {
    let mut out = [0u8; HEADER_LEN];
    out[0] = VERSION;
    out[1..1 + POINT_LEN].copy_from_slice(&generator.to_compressed());
    out[1 + POINT_LEN..EPHEMERAL_AT].copy_from_slice(tag);
    out[EPHEMERAL_AT..].copy_from_slice(&ephemeral.to_compressed());
    out
}
