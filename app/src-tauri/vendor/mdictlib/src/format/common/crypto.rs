//! Cryptographic primitives shared by every wire version.
//!
//! Only algorithms are shared here. Section framing — which bytes are
//! encrypted, how a key is derived, and where a checksum comes from — is
//! version-specific and lives in the corresponding grammar module.

use crate::error::{Error, Result};

const RIPEMD128_R: [usize; 64] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5,
    2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4,
    13, 3, 7, 15, 14, 5, 6, 2,
];

const RIPEMD128_RP: [usize; 64] = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12,
    4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5,
    12, 2, 13, 9, 7, 10, 14,
];

const RIPEMD128_S: [u32; 64] = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15,
    9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14,
    15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
];

const RIPEMD128_SP: [u32; 64] = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12,
    7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14,
    6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
];

/// Decodes 32 hexadecimal digits into the 16-byte value they describe.
///
/// # Errors
///
/// Returns an error if the text is not exactly 32 hexadecimal digits.
pub fn decode_hex_16(text: &str) -> Result<[u8; 16]> {
    if text.len() != 32 {
        return Err(Error::InvalidData(
            "registration code must be 32 hex digits".to_owned(),
        ));
    }
    let mut out = [0u8; 16];
    for (index, chunk) in text.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_nibble(chunk[0])?;
        let low = hex_nibble(chunk[1])?;
        out[index] = (high << 4) | low;
    }
    Ok(out)
}

fn hex_nibble(byte: u8) -> Result<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(Error::InvalidData(
            "registration code contains non-hex bytes".to_owned(),
        )),
    }
}

pub fn ripemd128(bytes: &[u8]) -> [u8; 16] {
    let mut state = [0x67452301u32, 0xefcdab89u32, 0x98badcfeu32, 0x10325476u32];

    let mut chunks = bytes.chunks_exact(64);
    for chunk in &mut chunks {
        let block: &[u8; 64] = chunk
            .try_into()
            .expect("chunks_exact always yields complete RIPEMD blocks");
        ripemd128_compress(&mut state, block);
    }

    let remainder = chunks.remainder();
    let mut tail = [0u8; 128];
    tail[..remainder.len()].copy_from_slice(remainder);
    tail[remainder.len()] = 0x80;
    let padded_len = if remainder.len() < 56 { 64 } else { 128 };
    let bit_len = u64::try_from(bytes.len())
        .unwrap_or(u64::MAX)
        .wrapping_mul(8);
    tail[padded_len - 8..padded_len].copy_from_slice(&bit_len.to_le_bytes());
    for chunk in tail[..padded_len].chunks_exact(64) {
        let block: &[u8; 64] = chunk
            .try_into()
            .expect("RIPEMD padding consists of complete blocks");
        ripemd128_compress(&mut state, block);
    }

    let mut out = [0u8; 16];
    for (chunk, word) in out.chunks_exact_mut(4).zip(state) {
        chunk.copy_from_slice(&word.to_le_bytes());
    }
    out
}

fn ripemd128_compress(state: &mut [u32; 4], chunk: &[u8; 64]) {
    let mut words = [0u32; 16];
    for (idx, word) in words.iter_mut().enumerate() {
        let start = idx * 4;
        *word = u32::from_le_bytes([
            chunk[start],
            chunk[start + 1],
            chunk[start + 2],
            chunk[start + 3],
        ]);
    }

    let [h0, h1, h2, h3] = *state;
    let (mut a, mut b, mut c, mut d) = (h0, h1, h2, h3);
    let (mut aa, mut bb, mut cc, mut dd) = (h0, h1, h2, h3);

    for idx in 0..64 {
        let tmp = a
            .wrapping_add(f(idx, b, c, d))
            .wrapping_add(words[RIPEMD128_R[idx]])
            .wrapping_add(k(idx))
            .rotate_left(RIPEMD128_S[idx]);
        a = d;
        d = c;
        c = b;
        b = tmp;

        let tmp_p = aa
            .wrapping_add(fp(idx, bb, cc, dd))
            .wrapping_add(words[RIPEMD128_RP[idx]])
            .wrapping_add(kp(idx))
            .rotate_left(RIPEMD128_SP[idx]);
        aa = dd;
        dd = cc;
        cc = bb;
        bb = tmp_p;
    }

    state[0] = h1.wrapping_add(c).wrapping_add(dd);
    state[1] = h2.wrapping_add(d).wrapping_add(aa);
    state[2] = h3.wrapping_add(a).wrapping_add(bb);
    state[3] = h0.wrapping_add(b).wrapping_add(cc);
}

fn f(idx: usize, x: u32, y: u32, z: u32) -> u32 {
    match idx {
        0..=15 => x ^ y ^ z,
        16..=31 => (x & y) | (!x & z),
        32..=47 => (x | !y) ^ z,
        _ => (x & z) | (y & !z),
    }
}

fn fp(idx: usize, x: u32, y: u32, z: u32) -> u32 {
    match idx {
        0..=15 => (x & z) | (y & !z),
        16..=31 => (x | !y) ^ z,
        32..=47 => (x & y) | (!x & z),
        _ => x ^ y ^ z,
    }
}

fn k(idx: usize) -> u32 {
    match idx {
        0..=15 => 0x00000000,
        16..=31 => 0x5a827999,
        32..=47 => 0x6ed9eba1,
        _ => 0x8f1bbcdc,
    }
}

fn kp(idx: usize) -> u32 {
    match idx {
        0..=15 => 0x50a28be6,
        16..=31 => 0x5c4dd124,
        32..=47 => 0x6d703ef3,
        _ => 0x00000000,
    }
}

pub fn salsa20_8_xor(data: &mut [u8], key: &[u8; 16]) {
    for (counter, chunk) in data.chunks_mut(64).enumerate() {
        let keystream = salsa20_8_block(key, counter as u64);
        for (dst, src) in chunk.iter_mut().zip(keystream.iter()) {
            *dst ^= *src;
        }
    }
}

fn salsa20_8_block(key: &[u8; 16], counter: u64) -> [u8; 64] {
    let constants = *b"expand 16-byte k";
    let k0 = u32::from_le_bytes([key[0], key[1], key[2], key[3]]);
    let k1 = u32::from_le_bytes([key[4], key[5], key[6], key[7]]);
    let k2 = u32::from_le_bytes([key[8], key[9], key[10], key[11]]);
    let k3 = u32::from_le_bytes([key[12], key[13], key[14], key[15]]);

    let state = [
        u32::from_le_bytes([constants[0], constants[1], constants[2], constants[3]]),
        k0,
        k1,
        k2,
        k3,
        u32::from_le_bytes([constants[4], constants[5], constants[6], constants[7]]),
        0,
        0,
        counter as u32,
        (counter >> 32) as u32,
        u32::from_le_bytes([constants[8], constants[9], constants[10], constants[11]]),
        k0,
        k1,
        k2,
        k3,
        u32::from_le_bytes([constants[12], constants[13], constants[14], constants[15]]),
    ];

    let mut working = state;
    for _ in 0..4 {
        working = double_round(working);
    }
    for (dst, src) in working.iter_mut().zip(state.iter()) {
        *dst = dst.wrapping_add(*src);
    }

    let mut out = [0u8; 64];
    for (idx, word) in working.iter().enumerate() {
        out[idx * 4..idx * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out
}

fn double_round(state: [u32; 16]) -> [u32; 16] {
    row_round(column_round(state))
}

fn column_round(mut state: [u32; 16]) -> [u32; 16] {
    quarter_round(&mut state, 0, 4, 8, 12);
    quarter_round(&mut state, 5, 9, 13, 1);
    quarter_round(&mut state, 10, 14, 2, 6);
    quarter_round(&mut state, 15, 3, 7, 11);
    state
}

fn row_round(mut state: [u32; 16]) -> [u32; 16] {
    quarter_round(&mut state, 0, 1, 2, 3);
    quarter_round(&mut state, 5, 6, 7, 4);
    quarter_round(&mut state, 10, 11, 8, 9);
    quarter_round(&mut state, 15, 12, 13, 14);
    state
}

fn quarter_round(state: &mut [u32; 16], a: usize, b: usize, c: usize, d: usize) {
    state[b] ^= state[a].wrapping_add(state[d]).rotate_left(7);
    state[c] ^= state[b].wrapping_add(state[a]).rotate_left(9);
    state[d] ^= state[c].wrapping_add(state[b]).rotate_left(13);
    state[a] ^= state[d].wrapping_add(state[c]).rotate_left(18);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn ripemd128_matches_known_vectors() {
        assert_eq!(hex(&ripemd128(b"")), "cdf26213a150dc3ecb610f18f6b38b46");
        assert_eq!(hex(&ripemd128(b"a")), "86be7afa339d0fc7cfc785e72f578d33");
    }

    #[test]
    fn salsa20_8_is_symmetric() {
        let key = [0x11u8; 16];
        let mut data = b"hello encrypted header".to_vec();
        salsa20_8_xor(&mut data, &key);
        salsa20_8_xor(&mut data, &key);
        assert_eq!(data, b"hello encrypted header");
    }

    #[test]
    fn rejects_malformed_registration_codes() {
        assert!(decode_hex_16("0011").is_err());
        assert!(decode_hex_16("zz00112233445566778899aabbccddee").is_err());
        assert!(decode_hex_16("000102030405060708090a0b0c0d0e0f").is_ok());
    }
}
