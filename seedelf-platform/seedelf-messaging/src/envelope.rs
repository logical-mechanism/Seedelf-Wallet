use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::Error;
use crate::keys::{SecretKey, random_nonzero_scalar};
use crate::register::{POINT_LEN, Register, decode_point, matches_register, rerandomize_with};

/// The envelope format this library writes and reads.
pub const VERSION: u8 = 1;

/// The largest plaintext an envelope carries: 64 KiB.
pub const MAX_PLAINTEXT_LEN: usize = 65_536;

/// Bytes before the ciphertext: version, `p`, `w`, `c`.
pub const HEADER_LEN: usize = 1 + 3 * POINT_LEN;

/// AES-GCM's tag.
const TAG_LEN: usize = 16;

/// An envelope's size beyond its plaintext's: the header and the tag.
pub const ENVELOPE_OVERHEAD: usize = HEADER_LEN + TAG_LEN;

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// HKDF-SHA256's salt. Every label names the protocol and its version, so
/// keys from another protocol, or another version of this one, never match.
pub(crate) const KDF_SALT: &[u8] = b"Seedelf-Messaging|v1|HKDF-SHA256|salt";

/// HKDF-SHA256's info, before the header: the output is the AES-256-GCM key
/// then its nonce.
pub(crate) const KDF_INFO: &[u8] = b"Seedelf-Messaging|v1|AES-256-GCM|key|nonce";

/// One encrypted message.
///
/// ```text
/// version (1) || p (48) || w (48) || c (48) || AES-256-GCM ciphertext || tag (16)
/// ```
///
/// `(p, w)` is a fresh re-randomization of the recipient's register, which
/// the recipient recognizes and no one else can link to it. `c = [r]p` is the
/// sender's ephemeral point; the shared point is `[r]w = [y]c`. The header
/// (the first 145 bytes) goes into both the key derivation and the AEAD's
/// associated data, so a change to any of it fails decryption.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Envelope {
    register: Register,
    ephemeral: G1Affine,
    ciphertext: Vec<u8>,
}

impl Envelope {
    /// The re-randomized register `(p, w)` the envelope is addressed to.
    pub fn register(&self) -> &Register {
        &self.register
    }

    /// Whether the envelope is addressed to `key`: [`matches_register`] on its
    /// register. Discovery only: [`decrypt_message`] still authenticates.
    pub fn is_for(&self, key: &SecretKey) -> bool {
        matches_register(key, &self.register)
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
    /// Checks the version, the length and every point (canonical, in the
    /// prime-order subgroup, not the identity) before anything else is done
    /// with them. Doesn't decrypt. To scan a pool, [`matches_envelope`] first
    /// is cheaper: it skips `c` for the envelopes that aren't the reader's.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        Ok(Self {
            register: register_of(bytes)?,
            ephemeral: point_at(bytes, 2)?,
            ciphertext: bytes[HEADER_LEN..].to_vec(),
        })
    }

    /// `version || p || w || c`.
    pub(crate) fn header(&self) -> [u8; HEADER_LEN] {
        header(&self.register, &self.ephemeral)
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
/// [`Error::NotForThisKey`] if its register isn't `key`'s;
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
/// Checks the version, the length, and `p` and `w` as [`Envelope::from_bytes`]
/// does, then tests `[y]p == w`. It leaves `c` and the ciphertext alone, so
/// an envelope that isn't the reader's costs two subgroup checks and one
/// scalar multiplication, not three and one. `Ok(true)` only says the
/// envelope is the reader's to open: [`Envelope::from_bytes`] then checks
/// `c` before `key` ever touches it, and [`decrypt_message`] authenticates.
pub fn matches_envelope(key: &SecretKey, bytes: &[u8]) -> Result<bool, Error> {
    Ok(matches_register(key, &register_of(bytes)?))
}

/// The version and length checks, then the register `(p, w)`, checked.
fn register_of(bytes: &[u8]) -> Result<Register, Error> {
    let (&version, _) = bytes.split_first().ok_or(Error::InvalidLength)?;
    if version != VERSION {
        return Err(Error::UnsupportedVersion(version));
    }
    if bytes.len() < ENVELOPE_OVERHEAD || bytes.len() > ENVELOPE_OVERHEAD + MAX_PLAINTEXT_LEN {
        return Err(Error::InvalidLength);
    }
    Ok(Register::from_checked(
        point_at(bytes, 0)?,
        point_at(bytes, 1)?,
    ))
}

/// Header point `i` (0 = `p`, 1 = `w`, 2 = `c`), checked. The caller has
/// checked the length.
fn point_at(bytes: &[u8], i: usize) -> Result<G1Affine, Error> {
    let start = 1 + i * POINT_LEN;
    let chunk: &[u8; POINT_LEN] = bytes
        .get(start..start + POINT_LEN)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(Error::InvalidLength)?;
    decode_point(chunk)
}

/// [`encrypt_message`] with given `b` and `r`, both nonzero. Only the test
/// vectors pass fixed ones.
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
    let ephemeral = (register.generator() * r).to_affine();
    let shared = Zeroizing::new((register.public_value() * r).to_compressed());
    let header = header(&register, &ephemeral);
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
        register,
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

fn header(register: &Register, ephemeral: &G1Affine) -> [u8; HEADER_LEN] {
    let mut out = [0u8; HEADER_LEN];
    out[0] = VERSION;
    out[1..1 + 2 * POINT_LEN].copy_from_slice(&register.to_bytes());
    out[1 + 2 * POINT_LEN..].copy_from_slice(&ephemeral.to_compressed());
    out
}
