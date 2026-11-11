//! The version 1 keyword section.
//!
//! Version 1 carries a 16-byte keyword header of four 32-bit big-endian
//! fields, stores its keyword metadata **raw**, and writes summaries with a
//! one-byte length and no terminator. It has neither the version 2
//! decompressed-size field nor the version 2 keyword-header checksum, so there
//! is nothing to validate the header against before its own geometry is
//! reconciled against the file.
//!
//! Every field is widened at the read site, so no `u32` reaches the section
//! arithmetic below.

use std::mem;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::format::common::checked::{
    add_u64, checked_usize, ensure_u64_ceiling, ensure_u64_limit, ensure_usize_limit, mul_u64,
};
use crate::format::common::cursor::Cursor;
use crate::format::common::descriptors::{
    DecodedKeyRow, KeyBlockDescriptor, KeyRowContext, SectionRange, WireOperations,
};
use crate::format::common::encoding::TextEncoding;
use crate::format::common::source::FileSource;
use crate::limits::{MemoryBudget, try_reserve_vec};
use crate::types::{Header, Limits, OpenOptions};

/// Bytes in the version 1 keyword header: four `u32` fields.
const KEYWORD_HEADER_LEN: u64 = 16;

/// Smallest possible keyword metadata row: a `u32` entry count, two one-byte
/// summary lengths with empty summaries, and two `u32` block sizes.
const MIN_KEY_INFO_ROW_LEN: u64 = 4 + 1 + 1 + 4 + 4;

/// The version 1 lazy wire operations, selected once during open.
pub(super) const WIRE_OPERATIONS: WireOperations = WireOperations { decode_key_rows };

/// Exact validated ranges for the three keyword subsections.
pub(super) struct KeywordSectionRanges {
    pub(super) header: SectionRange,
    pub(super) index: SectionRange,
    pub(super) blocks: SectionRange,
}

/// The parsed version 1 keyword section.
pub(super) struct KeywordSection {
    pub(super) num_entries: u64,
    pub(super) blocks: Box<[KeyBlockDescriptor]>,
    pub(super) record_section_offset: u64,
    pub(super) retained_bytes: usize,
    pub(super) sections: KeywordSectionRanges,
}

/// Parses and validates the whole version 1 keyword section.
///
/// # Errors
///
/// Returns an error if the file declares encryption, a declared size exceeds a
/// limit, the raw metadata does not describe exactly the declared blocks, the
/// summed entry counts or block sizes disagree with the header, or any block
/// range falls outside the file.
pub(super) fn parse_keyword_section(
    source: &FileSource,
    header: &Header,
    key_encoding: TextEncoding,
    keyword_section_offset: u64,
    options: &OpenOptions,
    memory: &Arc<MemoryBudget>,
) -> Result<KeywordSection> {
    // No authorized version 1 artifact declares encryption, and no framing for
    // it has been established. Refuse rather than guess at a transformation.
    let encryption = header.encryption_mode();
    if encryption.has_keyword_header() || encryption.has_keyword_index() {
        return Err(Error::Unsupported(
            "encrypted MDict version 1 keyword sections",
        ));
    }

    let header_len = checked_usize(KEYWORD_HEADER_LEN, "keyword section header length")?;
    let _header_memory = memory.reserve(header_len, "keyword section header")?;
    let raw_header =
        source.read_exact_at(keyword_section_offset, header_len, "keyword section header")?;

    let mut cursor = Cursor::new(&raw_header);
    let num_blocks = cursor.read_u32_be_widened("keyword num_blocks")?;
    let num_entries = cursor.read_u32_be_widened("keyword num_entries")?;
    let key_info_len = cursor.read_u32_be_widened("keyword index length")?;
    let key_blocks_len = cursor.read_u32_be_widened("keyword blocks length")?;

    ensure_u64_limit(
        "key_index_bytes",
        key_info_len,
        options.limits.key_index_bytes,
    )?;
    let num_blocks =
        validate_keyword_header_counts(num_blocks, num_entries, key_info_len, &options.limits)?;

    let key_info_offset = add_u64(
        keyword_section_offset,
        KEYWORD_HEADER_LEN,
        "keyword index offset overflow",
    )?;
    let key_blocks_offset = add_u64(
        key_info_offset,
        key_info_len,
        "keyword blocks offset overflow",
    )?;
    let record_section_offset = add_u64(
        key_blocks_offset,
        key_blocks_len,
        "record section offset overflow",
    )?;
    source.ensure_range(key_info_offset, key_info_len, "keyword index")?;
    source.ensure_range(key_blocks_offset, key_blocks_len, "keyword block section")?;

    // Version 1 keyword metadata is stored raw: no envelope, no checksum, no
    // decompression step.
    let key_info_len_usize = checked_usize(key_info_len, "keyword index length")?;
    let _raw_memory = memory.reserve(key_info_len_usize, "raw keyword index")?;
    let key_info = source.read_exact_at(key_info_offset, key_info_len_usize, "keyword index")?;

    let decoded_summary_bytes = key_encoding.max_decoded_len(key_info_len_usize)?;
    let retained_bytes = decoded_summary_bytes
        .checked_add(
            num_blocks
                .checked_mul(mem::size_of::<KeyBlockDescriptor>())
                .ok_or(Error::InvalidFormat("keyword metadata size overflow"))?,
        )
        .ok_or(Error::InvalidFormat("keyword metadata size overflow"))?;
    let _metadata_memory = memory.reserve(retained_bytes, "keyword block metadata")?;

    let blocks = parse_keyword_index_entries(
        &key_info,
        num_blocks,
        key_encoding,
        key_blocks_offset,
        &options.limits,
    )?;

    let total_entries = blocks
        .last()
        .map(|block| {
            add_u64(
                block.entry_start_index,
                block.entry_count,
                "keyword entry count overflow",
            )
        })
        .transpose()?
        .unwrap_or(0);
    if total_entries != num_entries {
        return Err(Error::InvalidData(format!(
            "keyword entry count mismatch: header={num_entries}, summed={total_entries}"
        )));
    }

    let total_comp = blocks.iter().try_fold(0u64, |acc, block| {
        add_u64(acc, block.comp_size, "keyword blocks length overflow")
    })?;
    if total_comp != key_blocks_len {
        return Err(Error::InvalidData(format!(
            "keyword blocks length mismatch: header={key_blocks_len}, summed={total_comp}"
        )));
    }

    for block in &blocks {
        source.ensure_range(block.comp_offset, block.comp_size, "keyword block")?;
    }

    Ok(KeywordSection {
        num_entries,
        record_section_offset,
        blocks: blocks.into_boxed_slice(),
        retained_bytes,
        sections: KeywordSectionRanges {
            header: SectionRange::new(keyword_section_offset, KEYWORD_HEADER_LEN),
            index: SectionRange::new(key_info_offset, key_info_len),
            blocks: SectionRange::new(key_blocks_offset, key_blocks_len),
        },
    })
}

fn validate_keyword_header_counts(
    num_blocks: u64,
    num_entries: u64,
    key_info_len: u64,
    limits: &Limits,
) -> Result<usize> {
    if num_blocks > num_entries {
        return Err(Error::InvalidData(format!(
            "keyword block count {num_blocks} exceeds entry count {num_entries}"
        )));
    }
    let minimum_index_len = mul_u64(
        num_blocks,
        MIN_KEY_INFO_ROW_LEN,
        "minimum keyword index length overflow",
    )?;
    if minimum_index_len > key_info_len {
        return Err(Error::InvalidData(format!(
            "keyword index length {key_info_len} cannot contain {num_blocks} blocks"
        )));
    }

    let num_blocks = checked_usize(num_blocks, "keyword block count")?;
    let metadata_bytes = num_blocks
        .checked_mul(mem::size_of::<KeyBlockDescriptor>())
        .ok_or(Error::InvalidFormat("keyword block metadata size overflow"))?;
    ensure_usize_limit(
        "keyword_block_metadata_bytes",
        metadata_bytes,
        limits.block_metadata_bytes,
    )?;
    Ok(num_blocks)
}

fn parse_keyword_index_entries(
    bytes: &[u8],
    num_blocks: usize,
    encoding: TextEncoding,
    key_blocks_offset: u64,
    limits: &Limits,
) -> Result<Vec<KeyBlockDescriptor>> {
    let minimum_len = num_blocks
        .checked_mul(checked_usize(
            MIN_KEY_INFO_ROW_LEN,
            "minimum keyword index row length",
        )?)
        .ok_or(Error::InvalidFormat(
            "minimum keyword index length overflow",
        ))?;
    if minimum_len > bytes.len() {
        return Err(Error::InvalidData(format!(
            "keyword index has {} bytes but {num_blocks} blocks require at least {minimum_len}",
            bytes.len()
        )));
    }

    let mut cursor = Cursor::new(bytes);
    let mut blocks = Vec::new();
    try_reserve_vec(&mut blocks, num_blocks, "keyword block metadata")?;
    let mut comp_offset = key_blocks_offset;
    let mut entry_start_index = 0u64;

    for _ in 0..num_blocks {
        let entry_count = cursor.read_u32_be_widened("keyword block entry count")?;
        let first_key = read_summary(&mut cursor, encoding, "keyword block first key")?;
        let last_key = read_summary(&mut cursor, encoding, "keyword block last key")?;
        let comp_size = cursor.read_u32_be_widened("keyword block compressed size")?;
        let decomp_size = cursor.read_u32_be_widened("keyword block decompressed size")?;

        validate_key_block_sizes(entry_count, comp_size, decomp_size, encoding, limits)?;
        let next_comp_offset = add_u64(comp_offset, comp_size, "keyword block offset overflow")?;
        let next_entry_start_index = add_u64(
            entry_start_index,
            entry_count,
            "keyword entry index overflow",
        )?;

        blocks.push(KeyBlockDescriptor {
            entry_count,
            entry_start_index,
            first_key,
            last_key,
            comp_offset,
            comp_size,
            decomp_size,
        });

        comp_offset = next_comp_offset;
        entry_start_index = next_entry_start_index;
    }

    if !cursor.is_empty() {
        return Err(Error::InvalidData(format!(
            "keyword index has {} trailing bytes",
            cursor.remaining()
        )));
    }

    Ok(blocks)
}

/// Reads one version 1 summary: a one-byte length in encoding units followed
/// by exactly that many units, with no terminator.
fn read_summary(
    cursor: &mut Cursor<'_>,
    encoding: TextEncoding,
    context: &'static str,
) -> Result<String> {
    let units = usize::from(cursor.read_u8(context)?);
    let len = units
        .checked_mul(encoding.unit_size())
        .ok_or(Error::InvalidFormat("keyword summary length overflow"))?;
    let bytes = cursor.read_bytes(len, context)?;
    encoding.decode(bytes, context)
}

fn validate_key_block_sizes(
    entry_count: u64,
    comp_size: u64,
    decomp_size: u64,
    encoding: TextEncoding,
    limits: &Limits,
) -> Result<()> {
    if entry_count == 0 {
        return Err(Error::InvalidData(
            "keyword blocks must contain at least one entry".to_owned(),
        ));
    }
    ensure_u64_ceiling(
        "keyword_block_entries",
        entry_count,
        limits.key_block_entries,
    )?;
    ensure_u64_limit(
        "keyword_block_compressed_bytes",
        comp_size,
        limits.compressed_block_bytes,
    )?;
    ensure_u64_limit(
        "keyword_block_decompressed_bytes",
        decomp_size,
        limits.decompressed_block_bytes,
    )?;
    if comp_size < 8 {
        return Err(Error::InvalidData(format!(
            "keyword block is {comp_size} bytes; at least 8 are required"
        )));
    }

    // A version 1 row is a four-byte record offset plus a terminated key, so
    // the smallest possible entry is four bytes plus one terminator unit.
    let unit_size = u64::try_from(encoding.unit_size())
        .map_err(|_| Error::InvalidFormat("encoding unit size exceeds u64"))?;
    let minimum_entry_bytes = add_u64(4, unit_size, "minimum keyword entry size overflow")?;
    let minimum_decompressed_len = mul_u64(
        entry_count,
        minimum_entry_bytes,
        "minimum keyword block size overflow",
    )?;
    if minimum_decompressed_len > decomp_size {
        return Err(Error::InvalidData(format!(
            "keyword block declares {entry_count} entries in {decomp_size} decompressed bytes"
        )));
    }
    Ok(())
}

/// Decodes one whole decompressed version 1 key block into physical rows.
///
/// Each row is a **four-byte** big-endian record offset — widened here, so no
/// 32-bit value escapes into the shared descriptors — followed by an
/// encoding-terminated key.
///
/// # Errors
///
/// Returns an error if the block is truncated, declares more or fewer entries
/// than its metadata, contains a record offset beyond the decoded record
/// stream, decreases its record offsets, or holds undecodable key text.
fn decode_key_rows(bytes: &[u8], context: &KeyRowContext) -> Result<Vec<DecodedKeyRow>> {
    let mut cursor = Cursor::new(bytes);
    let expected_count = checked_usize(context.expected_entries, "decoded key entry count")?;
    let mut entries = Vec::new();
    try_reserve_vec(&mut entries, expected_count, "decoded key entries")?;
    let mut previous_record_start = None;
    while !cursor.is_empty() {
        if entries.len() == expected_count {
            return Err(Error::InvalidData(format!(
                "key block contains data after its declared {expected_count} entries"
            )));
        }
        let record_start = cursor.read_u32_be_widened("key block record offset")?;
        if record_start > context.total_decoded_record_len {
            return Err(Error::InvalidData(format!(
                "record start {record_start} exceeds total record bytes {}",
                context.total_decoded_record_len
            )));
        }
        if let Some(previous) = previous_record_start
            && previous > record_start
        {
            return Err(Error::InvalidData(format!(
                "record starts decrease inside key block from {previous} to {record_start}"
            )));
        }
        previous_record_start = Some(record_start);
        let start = cursor.offset();
        let (key_bytes, next_offset) =
            context
                .encoding
                .split_terminated(bytes, start, "key block entry key")?;
        let key = context.encoding.decode(key_bytes, "key block entry key")?;
        let key_len = next_offset
            .checked_sub(start)
            .ok_or(Error::InvalidFormat("key block cursor underflow"))?;
        cursor.read_bytes(key_len, "key block entry key bytes")?;
        entries.push(DecodedKeyRow { key, record_start });
    }
    if entries.len() != expected_count {
        return Err(Error::InvalidData(format!(
            "key block entry count mismatch: expected {expected_count}, decoded {}",
            entries.len()
        )));
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_block_count_that_cannot_fit_the_raw_metadata() {
        // Fourteen bytes is the smallest possible row, so two blocks need 28.
        let error = validate_keyword_header_counts(2, 2, 27, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
        assert!(validate_keyword_header_counts(2, 2, 28, &Limits::new()).is_ok());
    }

    #[test]
    fn rejects_more_blocks_than_entries() {
        let error = validate_keyword_header_counts(3, 2, 4096, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_implausible_key_block_entry_count() {
        // Two entries need at least 2 * (4 + 1) = 10 decompressed bytes.
        let error =
            validate_key_block_sizes(2, 8, 9, TextEncoding::Utf8, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
        assert!(validate_key_block_sizes(2, 8, 10, TextEncoding::Utf8, &Limits::new()).is_ok());
    }

    #[test]
    fn rejects_oversized_key_blocks_before_they_can_be_read() {
        let limits = Limits::new();
        let oversized = u64::try_from(limits.compressed_block_bytes).unwrap() + 1;
        let error =
            validate_key_block_sizes(1, oversized, 9, TextEncoding::Utf8, &limits).unwrap_err();
        assert!(matches!(error, Error::LimitExceeded { .. }));
    }

    #[test]
    fn summary_lengths_count_encoding_units() {
        let mut cursor = Cursor::new(&[0x02, b'a', 0x00, b'b', 0x00]);
        let summary = read_summary(&mut cursor, TextEncoding::Utf16Le, "test summary").unwrap();
        assert_eq!(summary, "ab");
        assert!(cursor.is_empty());
    }

    #[test]
    fn empty_summaries_are_representable() {
        let mut cursor = Cursor::new(&[0x00]);
        let summary = read_summary(&mut cursor, TextEncoding::Utf8, "test summary").unwrap();
        assert!(summary.is_empty());
    }

    #[test]
    fn truncated_summaries_are_refused() {
        let mut cursor = Cursor::new(&[0x04, b'a']);
        let error = read_summary(&mut cursor, TextEncoding::Utf8, "test summary").unwrap_err();
        assert!(matches!(error, Error::Truncated { .. }));
    }
}
