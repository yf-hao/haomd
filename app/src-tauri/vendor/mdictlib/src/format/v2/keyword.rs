//! The version 2 keyword section: a checksummed 44-byte header, a compressed
//! and optionally encrypted keyword index, and the key blocks it describes.
//!
//! This module also owns the version 2 lazy key-row grammar
//! ([`decode_key_rows`]), which the core reaches only through the statically
//! selected [`WIRE_OPERATIONS`].

use std::mem;
use std::sync::Arc;

use super::crypto::{decrypt_keyword_header_block, decrypt_keyword_index_block};
use crate::error::{Error, Result};
use crate::format::common::checked::{
    checked_usize, ensure_u64_ceiling, ensure_u64_limit, ensure_usize_limit,
};
use crate::format::common::compression::decode_block;
use crate::format::common::cursor::Cursor;
use crate::format::common::descriptors::{
    DecodedKeyRow, KeyBlockDescriptor, KeyRowContext, SectionRange, WireOperations,
};
use crate::format::common::encoding::TextEncoding;
use crate::format::common::source::FileSource;
use crate::limits::{MemoryBudget, try_reserve_vec};
use crate::types::{ChecksumPolicy, Header, Limits, OpenOptions};

/// The version 2 lazy wire operations, selected once during open.
pub(super) const WIRE_OPERATIONS: WireOperations = WireOperations { decode_key_rows };

/// Exact validated ranges for the three keyword subsections.
pub(super) struct KeywordSectionRanges {
    pub(super) header: SectionRange,
    pub(super) index: SectionRange,
    pub(super) blocks: SectionRange,
}

/// The parsed version 2 keyword section.
pub(super) struct KeywordSection {
    pub(super) num_entries: u64,
    pub(super) blocks: Box<[KeyBlockDescriptor]>,
    pub(super) record_section_offset: u64,
    pub(super) retained_bytes: usize,
    pub(super) sections: KeywordSectionRanges,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeywordIndexLayout {
    Canonical,
    LegacyLittleEndianChecksumWithoutSummaryTerminators,
}

/// Parses and validates the whole version 2 keyword section.
///
/// # Errors
///
/// Returns an error if the keyword header checksum fails under both accepted
/// byte orders, a declared size exceeds a limit, the index does not describe
/// exactly the declared blocks, or any block range falls outside the file.
pub(super) fn parse_keyword_section(
    source: &FileSource,
    header: &Header,
    key_encoding: TextEncoding,
    keyword_section_offset: u64,
    options: &OpenOptions,
    memory: &Arc<MemoryBudget>,
) -> Result<KeywordSection> {
    let _header_memory = memory.reserve(44, "keyword section header")?;
    let mut raw_header =
        source.read_exact_at(keyword_section_offset, 44, "keyword section header")?;
    let checksum_bytes = [
        raw_header[40],
        raw_header[41],
        raw_header[42],
        raw_header[43],
    ];

    if header.encryption_mode().has_keyword_header() {
        let passcode = options.passcode.as_ref().ok_or(Error::MissingPasscode)?;
        decrypt_keyword_header_block(&mut raw_header[..40], passcode)?;
    }
    let layout =
        detect_keyword_index_layout(&raw_header[..40], checksum_bytes, options.checksum_policy)?;

    let mut cursor = Cursor::new(&raw_header[..40]);
    let num_blocks = cursor.read_u64_be("keyword num_blocks")?;
    let num_entries = cursor.read_u64_be("keyword num_entries")?;
    let key_index_decomp_len = cursor.read_u64_be("keyword index decompressed length")?;
    let key_index_comp_len = cursor.read_u64_be("keyword index compressed length")?;
    let key_blocks_len = cursor.read_u64_be("keyword blocks length")?;

    ensure_u64_limit(
        "key_index_decompressed_bytes",
        key_index_decomp_len,
        options.limits.key_index_bytes,
    )?;
    ensure_u64_limit(
        "key_index_compressed_bytes",
        key_index_comp_len,
        options.limits.key_index_bytes,
    )?;
    if key_index_comp_len < 8 {
        return Err(Error::InvalidData(format!(
            "keyword index block is {key_index_comp_len} bytes; at least 8 are required"
        )));
    }
    let num_blocks = validate_keyword_header_counts(
        num_blocks,
        num_entries,
        key_index_decomp_len,
        key_encoding,
        layout,
        &options.limits,
    )?;

    let key_index_offset = keyword_section_offset
        .checked_add(44)
        .ok_or(Error::InvalidFormat("keyword index offset overflow"))?;
    let key_blocks_offset = key_index_offset
        .checked_add(key_index_comp_len)
        .ok_or(Error::InvalidFormat("keyword blocks offset overflow"))?;
    let record_section_offset = key_blocks_offset
        .checked_add(key_blocks_len)
        .ok_or(Error::InvalidFormat("record section offset overflow"))?;
    source.ensure_range(key_index_offset, key_index_comp_len, "keyword index block")?;
    source.ensure_range(key_blocks_offset, key_blocks_len, "keyword block section")?;

    let key_index_comp_len_usize =
        checked_usize(key_index_comp_len, "keyword index compressed length")?;
    let _compressed_memory =
        memory.reserve(key_index_comp_len_usize, "compressed keyword index")?;
    let mut key_index_bytes = source.read_exact_at(
        key_index_offset,
        key_index_comp_len_usize,
        "keyword index block",
    )?;
    if header.encryption_mode().has_keyword_index() {
        if key_index_bytes.len() < 8 {
            return Err(Error::truncated(
                "keyword index block",
                8,
                key_index_bytes.len(),
            ));
        }
        let block_checksum = u32::from_be_bytes([
            key_index_bytes[4],
            key_index_bytes[5],
            key_index_bytes[6],
            key_index_bytes[7],
        ]);
        decrypt_keyword_index_block(block_checksum, &mut key_index_bytes[8..]);
    }
    let key_index_decomp_len =
        checked_usize(key_index_decomp_len, "keyword index decompressed length")?;
    let _decoded_memory = memory.reserve(key_index_decomp_len, "decoded keyword index")?;
    let decoded_summary_bytes = key_encoding.max_decoded_len(key_index_decomp_len)?;
    let retained_bytes = decoded_summary_bytes
        .checked_add(
            num_blocks
                .checked_mul(mem::size_of::<KeyBlockDescriptor>())
                .ok_or(Error::InvalidFormat("keyword metadata size overflow"))?,
        )
        .ok_or(Error::InvalidFormat("keyword metadata size overflow"))?;
    let _metadata_memory = memory.reserve(retained_bytes, "keyword block metadata")?;
    let decoded = decode_block(
        "keyword index block",
        &key_index_bytes,
        key_index_decomp_len,
        &options.limits,
        options.checksum_policy,
    )?;

    let blocks = parse_keyword_index_entries(
        &decoded,
        num_blocks,
        key_encoding,
        layout,
        key_blocks_offset,
        &options.limits,
    )?;
    let total_entries = blocks
        .last()
        .map(|block| {
            block
                .entry_start_index
                .checked_add(block.entry_count)
                .ok_or(Error::InvalidFormat("keyword entry count overflow"))
        })
        .transpose()?
        .unwrap_or(0);
    if total_entries != num_entries {
        return Err(Error::InvalidData(format!(
            "keyword entry count mismatch: header={num_entries}, summed={total_entries}"
        )));
    }

    let total_comp = blocks
        .iter()
        .try_fold(0u64, |acc, block| acc.checked_add(block.comp_size))
        .ok_or(Error::InvalidFormat("keyword blocks length overflow"))?;
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
            header: SectionRange::new(keyword_section_offset, 44),
            index: SectionRange::new(key_index_offset, key_index_comp_len),
            blocks: SectionRange::new(key_blocks_offset, key_blocks_len),
        },
    })
}

fn detect_keyword_index_layout(
    header: &[u8],
    checksum_bytes: [u8; 4],
    checksum_policy: ChecksumPolicy,
) -> Result<KeywordIndexLayout> {
    let actual = crate::format::common::checksum::adler32(header);
    let canonical_checksum = u32::from_be_bytes(checksum_bytes);
    if actual == canonical_checksum {
        return Ok(KeywordIndexLayout::Canonical);
    }

    let legacy_checksum = u32::from_le_bytes(checksum_bytes);
    if actual == legacy_checksum {
        return Ok(KeywordIndexLayout::LegacyLittleEndianChecksumWithoutSummaryTerminators);
    }

    if checksum_policy == ChecksumPolicy::Skip {
        return Ok(KeywordIndexLayout::Canonical);
    }
    Err(Error::ChecksumMismatch {
        context: "keyword section header",
        expected: canonical_checksum,
        actual,
    })
}

fn validate_keyword_header_counts(
    num_blocks: u64,
    num_entries: u64,
    key_index_decomp_len: u64,
    encoding: TextEncoding,
    layout: KeywordIndexLayout,
    limits: &Limits,
) -> Result<usize> {
    if num_blocks > num_entries {
        return Err(Error::InvalidData(format!(
            "keyword block count {num_blocks} exceeds entry count {num_entries}"
        )));
    }
    let minimum_index_len = num_blocks
        .checked_mul(minimum_keyword_index_entry_bytes(encoding, layout)?)
        .ok_or(Error::InvalidFormat(
            "minimum keyword index length overflow",
        ))?;
    if minimum_index_len > key_index_decomp_len {
        return Err(Error::InvalidData(format!(
            "keyword index length {key_index_decomp_len} cannot contain {num_blocks} blocks"
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

fn minimum_keyword_index_entry_bytes(
    encoding: TextEncoding,
    layout: KeywordIndexLayout,
) -> Result<u64> {
    let unit_size = u64::try_from(encoding.unit_size())
        .map_err(|_| Error::InvalidFormat("encoding unit size exceeds u64"))?;
    let summary_terminators = match layout {
        KeywordIndexLayout::Canonical => 2,
        KeywordIndexLayout::LegacyLittleEndianChecksumWithoutSummaryTerminators => 0,
    };
    28u64
        .checked_add(
            unit_size
                .checked_mul(summary_terminators)
                .ok_or(Error::InvalidFormat("keyword index entry size overflow"))?,
        )
        .ok_or(Error::InvalidFormat("keyword index entry size overflow"))
}

fn parse_keyword_index_entries(
    bytes: &[u8],
    num_blocks: usize,
    encoding: TextEncoding,
    layout: KeywordIndexLayout,
    key_blocks_offset: u64,
    limits: &Limits,
) -> Result<Vec<KeyBlockDescriptor>> {
    let minimum_len = num_blocks
        .checked_mul(checked_usize(
            minimum_keyword_index_entry_bytes(encoding, layout)?,
            "minimum keyword index entry length",
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
        let entry_count = cursor.read_u64_be("keyword block entry count")?;
        let first_units = usize::from(cursor.read_u16_be("keyword block first key size")?);
        let first_len =
            first_units
                .checked_mul(encoding.unit_size())
                .ok_or(Error::InvalidFormat(
                    "keyword block first key length overflow",
                ))?;
        let first_bytes = cursor.read_bytes(first_len, "keyword block first key")?;
        let first_key = encoding.decode(first_bytes, "keyword block first key")?;
        if layout == KeywordIndexLayout::Canonical {
            let terminator =
                cursor.read_bytes(encoding.unit_size(), "keyword block first key terminator")?;
            if terminator.iter().any(|byte| *byte != 0) {
                return Err(Error::InvalidFormat(
                    "invalid keyword block first-key terminator",
                ));
            }
        }

        let last_units = usize::from(cursor.read_u16_be("keyword block last key size")?);
        let last_len = last_units
            .checked_mul(encoding.unit_size())
            .ok_or(Error::InvalidFormat(
                "keyword block last key length overflow",
            ))?;
        let last_bytes = cursor.read_bytes(last_len, "keyword block last key")?;
        let last_key = encoding.decode(last_bytes, "keyword block last key")?;
        if layout == KeywordIndexLayout::Canonical {
            let terminator =
                cursor.read_bytes(encoding.unit_size(), "keyword block last key terminator")?;
            if terminator.iter().any(|byte| *byte != 0) {
                return Err(Error::InvalidFormat(
                    "invalid keyword block last-key terminator",
                ));
            }
        }

        let comp_size = cursor.read_u64_be("keyword block compressed size")?;
        let decomp_size = cursor.read_u64_be("keyword block decompressed size")?;

        validate_key_block_sizes(entry_count, comp_size, decomp_size, encoding, limits)?;
        let next_comp_offset = comp_offset
            .checked_add(comp_size)
            .ok_or(Error::InvalidFormat("keyword block offset overflow"))?;
        let next_entry_start_index = entry_start_index
            .checked_add(entry_count)
            .ok_or(Error::InvalidFormat("keyword entry index overflow"))?;

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

    let minimum_entry_bytes = 8u64
        .checked_add(
            u64::try_from(encoding.unit_size())
                .map_err(|_| Error::InvalidFormat("encoding unit size exceeds u64"))?,
        )
        .ok_or(Error::InvalidFormat("minimum keyword entry size overflow"))?;
    let minimum_decompressed_len = entry_count
        .checked_mul(minimum_entry_bytes)
        .ok_or(Error::InvalidFormat("minimum keyword block size overflow"))?;
    if minimum_decompressed_len > decomp_size {
        return Err(Error::InvalidData(format!(
            "keyword block declares {entry_count} entries in {decomp_size} decompressed bytes"
        )));
    }
    Ok(())
}

/// Decodes one whole decompressed version 2 key block into physical rows.
///
/// Each row is an eight-byte big-endian record offset followed by an
/// encoding-terminated key. The block must contain exactly the number of
/// entries its keyword metadata declared, with no trailing bytes.
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
        let record_start = cursor.read_u64_be("key block record offset")?;
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
    fn canonical_layout_wins_when_checksum_byte_order_is_ambiguous() {
        let header = [
            0x33, 0xcc, 0xfe, 0xfe, 0x7a, 0xb6, 0xef, 0xf1, 0xf7, 0x3d, 0x49, 0x33, 0xfe, 0x9d,
            0xcc, 0xde, 0x76, 0x81, 0x21, 0xb5, 0x05, 0x43, 0x33, 0xb7, 0x29, 0x65, 0x5c, 0xf8,
            0xc0, 0x1f, 0xbc, 0x66, 0x17, 0xe3, 0x48, 0x9f, 0xd1, 0x63, 0x5b, 0x91,
        ];
        let checksum_bytes = crate::format::common::checksum::adler32(&header).to_be_bytes();
        assert_eq!(checksum_bytes, [0xe4, 0x15, 0x15, 0xe4]);
        assert_eq!(
            detect_keyword_index_layout(&header, checksum_bytes, ChecksumPolicy::Verify).unwrap(),
            KeywordIndexLayout::Canonical
        );
    }

    #[test]
    fn rejects_block_count_that_cannot_fit_the_index() {
        let error = validate_keyword_header_counts(
            2,
            2,
            1,
            TextEncoding::Utf8,
            KeywordIndexLayout::Canonical,
            &Limits::new(),
        )
        .unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_implausible_key_block_entry_count() {
        let error =
            validate_key_block_sizes(2, 8, 9, TextEncoding::Utf8, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_oversized_key_blocks_before_they_can_be_read() {
        let limits = Limits::new();
        let oversized = u64::try_from(limits.compressed_block_bytes).unwrap() + 1;
        let error =
            validate_key_block_sizes(1, oversized, 9, TextEncoding::Utf8, &limits).unwrap_err();
        assert!(matches!(error, Error::LimitExceeded { .. }));
    }
}
