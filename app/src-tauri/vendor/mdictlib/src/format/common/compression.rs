use crate::error::{Error, Result};
use crate::format::common::checksum::verify_adler32;
use crate::limits::{ensure_usize_limit, try_reserve_vec};
use crate::types::{ChecksumPolicy, Limits};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressionType {
    None,
    Lzo,
    Zlib,
}

pub fn decode_block(
    context: &'static str,
    block: &[u8],
    expected_decompressed_len: usize,
    limits: &Limits,
    checksum_policy: ChecksumPolicy,
) -> Result<Vec<u8>> {
    if block.len() < 8 {
        return Err(Error::truncated(context, 8, block.len()));
    }
    ensure_usize_limit(
        "compressed_block_bytes",
        block.len(),
        limits.compressed_block_bytes,
    )?;
    ensure_usize_limit(
        "decompressed_block_bytes",
        expected_decompressed_len,
        limits.decompressed_block_bytes,
    )?;

    let comp_type = parse_comp_type(&block[..4])?;
    let checksum = u32::from_be_bytes([block[4], block[5], block[6], block[7]]);
    let payload = &block[8..];

    let decoded = match comp_type {
        CompressionType::None => {
            decode_uncompressed_block(context, payload, expected_decompressed_len)?
        }
        CompressionType::Zlib => {
            decode_zlib_block(context, payload, expected_decompressed_len, checksum_policy)?
        }
        CompressionType::Lzo => decode_lzo_block(context, payload, expected_decompressed_len)?,
    };

    if decoded.len() != expected_decompressed_len {
        return Err(Error::InvalidData(format!(
            "{context} decompressed to {} bytes, expected {expected_decompressed_len}",
            decoded.len()
        )));
    }

    if checksum_policy == ChecksumPolicy::Verify {
        verify_adler32(context, &decoded, checksum)?;
    }
    Ok(decoded)
}

fn decode_uncompressed_block(
    context: &'static str,
    payload: &[u8],
    expected_decompressed_len: usize,
) -> Result<Vec<u8>> {
    if payload.len() != expected_decompressed_len {
        return Err(Error::InvalidData(format!(
            "{context} contains {} uncompressed bytes, expected {expected_decompressed_len}",
            payload.len()
        )));
    }
    let mut output = Vec::new();
    try_reserve_vec(&mut output, payload.len(), context)?;
    output.extend_from_slice(payload);
    Ok(output)
}

fn decode_zlib_block(
    context: &'static str,
    payload: &[u8],
    expected_decompressed_len: usize,
    checksum_policy: ChecksumPolicy,
) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    try_reserve_vec(&mut output, expected_decompressed_len, context)?;
    output.resize(expected_decompressed_len, 0);
    let mut decompressor = miniz_oxide::inflate::core::DecompressorOxide::new();
    let flags = miniz_oxide::inflate::core::inflate_flags::TINFL_FLAG_PARSE_ZLIB_HEADER
        | miniz_oxide::inflate::core::inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
    let flags = if checksum_policy == ChecksumPolicy::Skip {
        flags | miniz_oxide::inflate::core::inflate_flags::TINFL_FLAG_IGNORE_ADLER32
    } else {
        flags
    };
    let (status, input_read, actual) =
        miniz_oxide::inflate::core::decompress(&mut decompressor, payload, &mut output, 0, flags);
    if status != miniz_oxide::inflate::TINFLStatus::Done {
        return Err(Error::InvalidData(format!(
            "invalid or oversized zlib block in {context}: {status:?}"
        )));
    }
    if input_read != payload.len() {
        return Err(Error::InvalidData(format!(
            "zlib block in {context} has {} trailing compressed bytes",
            payload.len() - input_read
        )));
    }
    if actual != expected_decompressed_len {
        return Err(Error::InvalidData(format!(
            "{context} decompressed to {actual} bytes, expected {expected_decompressed_len}"
        )));
    }
    Ok(output)
}

#[cfg(feature = "lzo")]
fn decode_lzo_block(
    context: &'static str,
    payload: &[u8],
    expected_decompressed_len: usize,
) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    try_reserve_vec(&mut output, expected_decompressed_len, context)?;
    output.resize(expected_decompressed_len, 0);
    let actual = lzokay::decompress::decompress(payload, &mut output)
        .map_err(|_| Error::InvalidData(format!("invalid lzo block in {context}")))?;
    if actual != expected_decompressed_len {
        return Err(Error::InvalidData(format!(
            "{context} decompressed to {actual} bytes, expected {expected_decompressed_len}"
        )));
    }
    Ok(output)
}

#[cfg(not(feature = "lzo"))]
fn decode_lzo_block(
    _context: &'static str,
    _payload: &[u8],
    _expected_decompressed_len: usize,
) -> Result<Vec<u8>> {
    Err(Error::Unsupported(
        "LZO compressed blocks (enable the `lzo` feature)",
    ))
}

pub fn parse_comp_type(bytes: &[u8]) -> Result<CompressionType> {
    match bytes {
        [0, 0, 0, 0] => Ok(CompressionType::None),
        [1, 0, 0, 0] => Ok(CompressionType::Lzo),
        [2, 0, 0, 0] => Ok(CompressionType::Zlib),
        _ => Err(Error::InvalidData(format!(
            "unknown compression tag: {:02x?}",
            bytes
        ))),
    }
}

#[cfg(test)]
pub fn encode_zlib_block(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + data.len());
    out.extend_from_slice(&[2, 0, 0, 0]);
    out.extend_from_slice(&crate::format::common::checksum::adler32(data).to_be_bytes());
    out.extend_from_slice(&miniz_oxide::deflate::compress_to_vec_zlib(data, 6));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_zlib_block() {
        let block = encode_zlib_block(b"hello mdict");
        let decoded = decode_block(
            "test block",
            &block,
            11,
            &Limits::new(),
            ChecksumPolicy::Verify,
        )
        .unwrap();
        assert_eq!(decoded, b"hello mdict");
    }

    #[test]
    fn rejects_unknown_compression_tag() {
        let block = [9, 0, 0, 0, 0, 0, 0, 0];
        let error = decode_block(
            "test block",
            &block,
            0,
            &Limits::new(),
            ChecksumPolicy::Verify,
        )
        .unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn mutated_zlib_blocks_do_not_panic() {
        let block = encode_zlib_block(b"hello mdict");
        for index in 0..block.len() {
            let mut mutated = block.clone();
            mutated[index] ^= 0x5a;
            let result = std::panic::catch_unwind(|| {
                let _ = decode_block(
                    "mutated zlib block",
                    &mutated,
                    11,
                    &Limits::new(),
                    ChecksumPolicy::Verify,
                );
            });
            assert!(result.is_ok(), "decode_block panicked at byte {index}");
        }
    }

    #[test]
    fn rejects_zlib_output_larger_than_the_declared_length() {
        let block = encode_zlib_block(&vec![b'x'; 16 * 1024]);
        let error = decode_block(
            "bounded zlib block",
            &block,
            16,
            &Limits::new(),
            ChecksumPolicy::Verify,
        )
        .unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_trailing_bytes_after_a_complete_zlib_stream() {
        let mut block = encode_zlib_block(b"hello mdict");
        block.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let error = decode_block(
            "trailing zlib block",
            &block,
            11,
            &Limits::new(),
            ChecksumPolicy::Verify,
        )
        .unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn skip_policy_ignores_zlib_inner_checksum_but_verify_rejects_it() {
        let mut block = encode_zlib_block(b"hello mdict");
        let last = block.len() - 1;
        block[last] ^= 0x01;

        let skipped = decode_block(
            "zlib checksum skip",
            &block,
            11,
            &Limits::new(),
            ChecksumPolicy::Skip,
        )
        .unwrap();
        assert_eq!(skipped, b"hello mdict");

        let verified = decode_block(
            "zlib checksum verify",
            &block,
            11,
            &Limits::new(),
            ChecksumPolicy::Verify,
        );
        assert!(matches!(verified, Err(Error::InvalidData(_))));
    }

    #[cfg(feature = "lzo")]
    #[test]
    fn decodes_lzo_lookbehind_matches() {
        // Hand-authored LZO1X stream: prime with the literal `abc`, copy a
        // three-byte M2 match at distance three, then emit the M4 terminator.
        // This exercises an actual lookbehind opcode independently of the
        // literal-only encoder used by the whole-file fixtures.
        let payload = [20, b'a', b'b', b'c', 0x48, 0, 17, 0, 0];
        let decoded = b"abcabc";
        let mut block = Vec::new();
        block.extend_from_slice(&[1, 0, 0, 0]);
        block.extend_from_slice(&crate::format::common::checksum::adler32(decoded).to_be_bytes());
        block.extend_from_slice(&payload);

        assert_eq!(
            decode_block(
                "matched lzo block",
                &block,
                decoded.len(),
                &Limits::new(),
                ChecksumPolicy::Verify,
            )
            .unwrap(),
            decoded
        );
    }
}
