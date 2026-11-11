//! Version 2 keyword-section encryption framing.
//!
//! The algorithms themselves live in [`crate::format::common::crypto`]. This
//! module owns only the version 2 decisions: which bytes are covered, how the
//! keyword-index key is derived from the block checksum, and how passcode
//! material unlocks the keyword header.

use crate::error::Result;
use crate::format::common::crypto::{decode_hex_16, ripemd128, salsa20_8_xor};
use crate::types::Passcode;

/// Decrypts a version 2 keyword index block in place.
///
/// The key is derived from the block's own big-endian ADLER32 checksum, so no
/// caller-supplied material is required.
pub fn decrypt_keyword_index_block(checksum: u32, data: &mut [u8]) {
    let mut key_material = checksum.to_be_bytes().to_vec();
    key_material.extend_from_slice(&[0x95, 0x36, 0x00, 0x00]);
    let key = ripemd128(&key_material);

    let mut previous = 0x36u8;
    for (index, byte) in data.iter_mut().enumerate() {
        let cipher = *byte;
        let swapped = cipher.rotate_left(4);
        *byte = swapped ^ (index as u8) ^ key[index % key.len()] ^ previous;
        previous = cipher;
    }
}

/// Decrypts a passcode-protected version 2 keyword header in place.
///
/// # Errors
///
/// Returns an error if the passcode's registration code is malformed.
pub fn decrypt_keyword_header_block(data: &mut [u8], passcode: &Passcode) -> Result<()> {
    let key = derive_keyword_header_key(passcode)?;
    salsa20_8_xor(data, &key);
    Ok(())
}

fn derive_keyword_header_key(passcode: &Passcode) -> Result<[u8; 16]> {
    let mut encrypted_hash = decode_hex_16(&passcode.reg_code_hex)?;
    let user_hash = ripemd128(passcode.user_id.as_bytes());
    salsa20_8_xor(&mut encrypted_hash, &user_hash);
    Ok(encrypted_hash)
}

#[cfg(test)]
fn encrypt_keyword_index_block(checksum: u32, data: &mut [u8]) {
    let mut key_material = checksum.to_be_bytes().to_vec();
    key_material.extend_from_slice(&[0x95, 0x36, 0x00, 0x00]);
    let key = ripemd128(&key_material);

    let mut previous = 0x36u8;
    for (index, byte) in data.iter_mut().enumerate() {
        let plain = *byte;
        *byte = (plain ^ (index as u8) ^ key[index % key.len()] ^ previous).rotate_left(4);
        previous = *byte;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyword_index_cipher_round_trips() {
        let checksum = 0x12345678;
        let mut payload = b"example payload".to_vec();
        encrypt_keyword_index_block(checksum, &mut payload);
        decrypt_keyword_index_block(checksum, &mut payload);
        assert_eq!(payload, b"example payload");
    }
}
