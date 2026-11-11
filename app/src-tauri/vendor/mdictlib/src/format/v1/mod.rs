//! The MDict major version 1 wire grammar.
//!
//! Version 1 declares its geometry in 32-bit big-endian fields, carries an
//! unchecksummed 16-byte keyword header, stores its keyword metadata raw, and
//! writes key summaries with one-byte lengths and no terminators.
//!
//! Every 32-bit field is widened at the read site, so no `u32` participates in
//! section arithmetic. This module may not reference the core, the MDX/MDD
//! facades, or [`crate::format::v2`]. Its only output is a
//! [`ValidatedLayout`].
//!
//! # Scope
//!
//! Implemented from evidence: unencrypted files whose key and record blocks
//! use the shared eight-byte envelope. Encryption is refused outright — no
//! authorized artifact declares it and no framing has been established.

mod keyword;
mod record;

use crate::error::{Error, Result};
use crate::format::LayoutRequest;
use crate::format::common::descriptors::{RetainedBudget, SectionRanges, ValidatedLayout};
use crate::format::common::encoding::TextEncoding;

/// Parses a version 1 file into the shared validated layout.
///
/// # Errors
///
/// Returns an error if the keyword or record sections are malformed, exceed a
/// configured limit, declare inconsistent counts, or do not fit the file.
pub(crate) fn parse_layout(request: LayoutRequest<'_>) -> Result<ValidatedLayout> {
    let LayoutRequest {
        source,
        header_section,
        kind,
        options,
        memory,
    } = request;

    let header_memory = memory.reserve(header_section.retained_bytes, "parsed header")?;
    let key_encoding = TextEncoding::for_keys(kind, &header_section.header)?;
    let record_encoding = TextEncoding::for_records(kind, &header_section.header)?;

    let keys = keyword::parse_keyword_section(
        source,
        &header_section.header,
        key_encoding,
        header_section.keyword_section_offset,
        options,
        memory,
    )?;
    let key_metadata_memory = memory.reserve(keys.retained_bytes, "keyword block metadata")?;

    let records =
        record::parse_record_section(source, keys.record_section_offset, &options.limits, memory)?;
    let record_metadata_memory = memory.reserve(records.retained_bytes, "record block metadata")?;

    if keys.num_entries != records.num_entries {
        return Err(Error::InvalidData(format!(
            "entry count mismatch between key index ({}) and record index ({})",
            keys.num_entries, records.num_entries
        )));
    }

    let sections = SectionRanges {
        header: header_section.section,
        keyword_header: keys.sections.header,
        keyword_index: keys.sections.index,
        keyword_blocks: keys.sections.blocks,
        record_header: records.sections.header,
        record_index: records.sections.index,
        record_blocks: records.sections.blocks,
    };

    Ok(ValidatedLayout {
        header: header_section.header,
        key_encoding,
        record_encoding,
        sections,
        total_entries: keys.num_entries,
        total_decoded_record_len: records.total_decompressed_len,
        key_blocks: keys.blocks,
        record_blocks: records.blocks,
        wire: keyword::WIRE_OPERATIONS,
        retained: RetainedBudget::new(header_memory, key_metadata_memory, record_metadata_memory),
    })
}
