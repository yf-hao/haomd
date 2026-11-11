//! The version 1 record section.
//!
//! A 16-byte header of four 32-bit big-endian fields, a flat index of
//! eight-byte compressed/decompressed size pairs, and the record blocks they
//! describe. The index length must be exactly `block_count * 8`, against
//! version 2's `block_count * 16`.

use std::mem;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::format::common::checked::{
    add_u64, checked_usize, ensure_u64_limit, ensure_usize_limit, mul_u64,
};
use crate::format::common::cursor::Cursor;
use crate::format::common::descriptors::{RecordBlockDescriptor, SectionRange};
use crate::format::common::source::FileSource;
use crate::limits::{MemoryBudget, try_reserve_vec};
use crate::types::Limits;

/// Bytes in the version 1 record header: four `u32` fields.
const RECORD_HEADER_LEN: u64 = 16;

/// Bytes per version 1 record index row: two `u32` sizes.
const RECORD_INDEX_ROW_LEN: u64 = 8;

/// Exact validated ranges for the three record subsections.
pub(super) struct RecordSectionRanges {
    pub(super) header: SectionRange,
    pub(super) index: SectionRange,
    pub(super) blocks: SectionRange,
}

/// The parsed version 1 record section.
pub(super) struct RecordSection {
    pub(super) num_entries: u64,
    pub(super) total_decompressed_len: u64,
    pub(super) blocks: Box<[RecordBlockDescriptor]>,
    pub(super) retained_bytes: usize,
    pub(super) sections: RecordSectionRanges,
}

/// Parses and validates the whole version 1 record section.
///
/// # Errors
///
/// Returns an error if the index length is not exactly `block_count * 8`, a
/// declared size exceeds a limit, the block ranges do not exactly cover the
/// declared section, or any range falls outside the file.
pub(super) fn parse_record_section(
    source: &FileSource,
    record_section_offset: u64,
    limits: &Limits,
    memory: &Arc<MemoryBudget>,
) -> Result<RecordSection> {
    let header_len = checked_usize(RECORD_HEADER_LEN, "record section header length")?;
    let _header_memory = memory.reserve(header_len, "record section header")?;
    let header_bytes =
        source.read_exact_at(record_section_offset, header_len, "record section header")?;

    let mut cursor = Cursor::new(&header_bytes);
    let num_blocks = cursor.read_u32_be_widened("record num_blocks")?;
    let num_entries = cursor.read_u32_be_widened("record num_entries")?;
    let index_len = cursor.read_u32_be_widened("record index length")?;
    let blocks_len = cursor.read_u32_be_widened("record blocks length")?;

    let (num_blocks, index_len_usize) = validate_record_header(num_blocks, index_len, limits)?;
    let index_offset = add_u64(
        record_section_offset,
        RECORD_HEADER_LEN,
        "record index offset overflow",
    )?;
    let blocks_offset = add_u64(index_offset, index_len, "record blocks offset overflow")?;
    source.ensure_range(index_offset, index_len, "record block index")?;
    source.ensure_range(blocks_offset, blocks_len, "record block section")?;

    let _index_memory = memory.reserve(index_len_usize, "record block index")?;
    let retained_bytes = num_blocks
        .checked_mul(mem::size_of::<RecordBlockDescriptor>())
        .ok_or(Error::InvalidFormat("record metadata size overflow"))?;
    let _metadata_memory = memory.reserve(retained_bytes, "record block metadata")?;
    let index_bytes = source.read_exact_at(index_offset, index_len_usize, "record block index")?;

    let mut cursor = Cursor::new(&index_bytes);
    let mut blocks = Vec::new();
    try_reserve_vec(&mut blocks, num_blocks, "record block metadata")?;
    let mut comp_offset = blocks_offset;
    let mut decomp_offset = 0u64;
    let mut total_comp = 0u64;

    for _ in 0..num_blocks {
        let comp_size = cursor.read_u32_be_widened("record block compressed size")?;
        let decomp_size = cursor.read_u32_be_widened("record block decompressed size")?;
        validate_record_block_sizes(comp_size, decomp_size, limits)?;
        source.ensure_range(comp_offset, comp_size, "record block")?;
        let next_comp_offset = add_u64(comp_offset, comp_size, "record block offset overflow")?;
        let next_decomp_offset =
            add_u64(decomp_offset, decomp_size, "record block offset overflow")?;
        blocks.push(RecordBlockDescriptor {
            comp_offset,
            comp_size,
            decomp_offset,
            decomp_size,
        });
        comp_offset = next_comp_offset;
        decomp_offset = next_decomp_offset;
        total_comp = add_u64(total_comp, comp_size, "record block length overflow")?;
    }

    if total_comp != blocks_len {
        return Err(Error::InvalidData(format!(
            "record blocks length mismatch: header={blocks_len}, summed={total_comp}"
        )));
    }
    if !cursor.is_empty() {
        return Err(Error::InvalidData(format!(
            "record block index has {} trailing bytes",
            cursor.remaining()
        )));
    }
    let expected_blocks_end = add_u64(
        blocks_offset,
        blocks_len,
        "record block section end overflow",
    )?;
    if comp_offset != expected_blocks_end {
        return Err(Error::InvalidData(
            "record block ranges do not cover the declared section".to_owned(),
        ));
    }

    Ok(RecordSection {
        num_entries,
        total_decompressed_len: decomp_offset,
        blocks: blocks.into_boxed_slice(),
        retained_bytes,
        sections: RecordSectionRanges {
            header: SectionRange::new(record_section_offset, RECORD_HEADER_LEN),
            index: SectionRange::new(index_offset, index_len),
            blocks: SectionRange::new(blocks_offset, blocks_len),
        },
    })
}

fn validate_record_header(
    num_blocks: u64,
    index_len: u64,
    limits: &Limits,
) -> Result<(usize, usize)> {
    let expected_index_len = mul_u64(
        num_blocks,
        RECORD_INDEX_ROW_LEN,
        "record index length overflow",
    )?;
    if index_len != expected_index_len {
        return Err(Error::InvalidData(format!(
            "record index length mismatch: header={index_len}, expected={expected_index_len}"
        )));
    }
    ensure_u64_limit("record_index_bytes", index_len, limits.record_index_bytes)?;
    let index_len = checked_usize(index_len, "record index length")?;
    let num_blocks = checked_usize(num_blocks, "record block count")?;
    let metadata_bytes = num_blocks
        .checked_mul(mem::size_of::<RecordBlockDescriptor>())
        .ok_or(Error::InvalidFormat("record block metadata size overflow"))?;
    ensure_usize_limit(
        "record_block_metadata_bytes",
        metadata_bytes,
        limits.block_metadata_bytes,
    )?;
    Ok((num_blocks, index_len))
}

fn validate_record_block_sizes(comp_size: u64, decomp_size: u64, limits: &Limits) -> Result<()> {
    ensure_u64_limit(
        "record_block_compressed_bytes",
        comp_size,
        limits.compressed_block_bytes,
    )?;
    ensure_u64_limit(
        "record_block_decompressed_bytes",
        decomp_size,
        limits.decompressed_block_bytes,
    )?;
    if comp_size < 8 {
        return Err(Error::InvalidData(format!(
            "record block is {comp_size} bytes; at least 8 are required"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_an_eight_byte_row_per_record_block() {
        // Version 2's sixteen-byte rows must not be accepted here.
        assert!(validate_record_header(2, 16, &Limits::new()).is_ok());
        let error = validate_record_header(2, 32, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
        let error = validate_record_header(2, 15, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_oversized_record_blocks_before_they_can_be_read() {
        let limits = Limits::new();
        let oversized = u64::try_from(limits.decompressed_block_bytes).unwrap() + 1;
        let error = validate_record_block_sizes(8, oversized, &limits).unwrap_err();
        assert!(matches!(error, Error::LimitExceeded { .. }));
    }

    #[test]
    fn rejects_blocks_smaller_than_the_shared_envelope() {
        let error = validate_record_block_sizes(7, 0, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }
}
