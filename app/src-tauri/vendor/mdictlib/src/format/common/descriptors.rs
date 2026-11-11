//! The version-neutral boundary between wire grammars and the shared core.
//!
//! Every wire version parses its own bytes and then emits exactly one
//! [`ValidatedLayout`]. Nothing downstream of this module can observe which
//! grammar produced it: the descriptors carry only widened, range-checked,
//! limit-checked `u64` geometry plus the small set of statically selected
//! functions that remain version-specific after open.

use crate::error::{Error, Result};
use crate::format::common::encoding::TextEncoding;
use crate::limits::MemoryReservation;
use crate::types::Header;

/// One exact, already-validated byte range inside the source file.
///
/// A `SectionRange` is only ever constructed after the producing grammar has
/// proven containment against the real file length, so the core may use it
/// without re-checking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionRange {
    offset: u64,
    len: u64,
}

impl SectionRange {
    pub(crate) const fn new(offset: u64, len: u64) -> Self {
        Self { offset, len }
    }

    pub(crate) const fn offset(self) -> u64 {
        self.offset
    }

    /// Returns the exclusive end offset of this section.
    ///
    /// # Errors
    ///
    /// Returns an error if the end offset overflows `u64`.
    pub(crate) fn end(self) -> Result<u64> {
        self.offset
            .checked_add(self.len)
            .ok_or(Error::InvalidFormat("section range end overflow"))
    }
}

/// Exact checked ranges for every physical section of a dictionary file.
#[derive(Debug, Clone, Copy)]
pub struct SectionRanges {
    pub(crate) header: SectionRange,
    pub(crate) keyword_header: SectionRange,
    pub(crate) keyword_index: SectionRange,
    pub(crate) keyword_blocks: SectionRange,
    pub(crate) record_header: SectionRange,
    pub(crate) record_index: SectionRange,
    pub(crate) record_blocks: SectionRange,
}

impl SectionRanges {
    /// Proves the sections are contiguous, non-overlapping, and ordered.
    ///
    /// # Errors
    ///
    /// Returns an error if any section end overflows or a section does not
    /// begin exactly where its predecessor ended.
    pub(crate) fn verify_contiguous(&self) -> Result<()> {
        let ordered = [
            ("header", self.header),
            ("keyword header", self.keyword_header),
            ("keyword index", self.keyword_index),
            ("keyword blocks", self.keyword_blocks),
            ("record header", self.record_header),
            ("record index", self.record_index),
            ("record blocks", self.record_blocks),
        ];
        let mut expected = ordered[0].0;
        let mut cursor = self.header.offset();
        for (name, section) in ordered {
            if section.offset() != cursor {
                return Err(Error::InvalidData(format!(
                    "{name} section starts at {} but {expected} ended at {cursor}",
                    section.offset()
                )));
            }
            cursor = section.end()?;
            expected = name;
        }
        Ok(())
    }
}

/// One validated keyword block, independent of the grammar that produced it.
#[derive(Debug, Clone)]
pub struct KeyBlockDescriptor {
    /// Number of physical entries this block contains.
    pub entry_count: u64,
    /// Cumulative ordinal of this block's first entry.
    pub entry_start_index: u64,
    /// Decoded first-key summary declared by the keyword metadata.
    pub first_key: String,
    /// Decoded last-key summary declared by the keyword metadata.
    pub last_key: String,
    /// Absolute file offset of the compressed block.
    pub comp_offset: u64,
    /// Compressed block length, including its eight-byte envelope.
    pub comp_size: u64,
    /// Exact decompressed block length.
    pub decomp_size: u64,
}

/// One validated record block, independent of the grammar that produced it.
#[derive(Debug, Clone)]
pub struct RecordBlockDescriptor {
    /// Absolute file offset of the compressed block.
    pub comp_offset: u64,
    /// Compressed block length, including its eight-byte envelope.
    pub comp_size: u64,
    /// Cumulative offset of this block inside the decoded record stream.
    pub decomp_offset: u64,
    /// Exact decompressed block length.
    pub decomp_size: u64,
}

/// Locates the record block covering a decoded record offset.
pub(crate) fn find_record_block(
    blocks: &[RecordBlockDescriptor],
    record_offset: u64,
) -> Option<usize> {
    let mut left = 0usize;
    let mut right = blocks.len();
    while left < right {
        let mid = (left + right) / 2;
        let block = &blocks[mid];
        let end = block.decomp_offset.checked_add(block.decomp_size)?;
        if record_offset < block.decomp_offset {
            right = mid;
        } else if record_offset >= end {
            left = mid + 1;
        } else {
            return Some(mid);
        }
    }
    None
}

/// One decoded key row: a physical key and the record offset it starts at.
///
/// Both wire versions produce this shape. Version 1 widens a checked 32-bit
/// offset; version 2 reads a 64-bit offset directly.
#[derive(Debug, Clone)]
pub struct DecodedKeyRow {
    /// The decoded physical key.
    pub key: String,
    /// Start offset of this entry's record inside the decoded record stream.
    pub record_start: u64,
}

/// Everything a whole-key-block decoder needs, with no reference to the core.
pub struct KeyRowContext {
    /// Encoding used for key text inside key blocks.
    pub encoding: TextEncoding,
    /// Exact number of entries the keyword metadata declared for this block.
    pub expected_entries: u64,
    /// Total decoded record length, used to bound every record offset.
    pub total_decoded_record_len: u64,
}

/// Decodes one whole decompressed key block into physical key rows.
///
/// This is a plain function pointer, not a trait object: the version decision
/// selects one concrete non-capturing function during open, and the core then
/// calls it without any per-entry branch.
pub type DecodeKeyRows = fn(&[u8], &KeyRowContext) -> Result<Vec<DecodedKeyRow>>;

/// The set of wire operations that stay version-specific after open.
#[derive(Debug, Clone, Copy)]
pub struct WireOperations {
    /// Whole-key-block row decoder selected once during open.
    pub decode_key_rows: DecodeKeyRows,
}

/// Metadata reservations retained for the lifetime of one open dictionary.
#[derive(Debug)]
pub struct RetainedBudget {
    header: MemoryReservation,
    key_metadata: MemoryReservation,
    record_metadata: MemoryReservation,
}

impl RetainedBudget {
    pub(crate) const fn new(
        header: MemoryReservation,
        key_metadata: MemoryReservation,
        record_metadata: MemoryReservation,
    ) -> Self {
        Self {
            header,
            key_metadata,
            record_metadata,
        }
    }

    /// Returns the total accounted metadata bytes retained by this layout.
    ///
    /// # Errors
    ///
    /// Returns an error if the accounted total overflows `usize`.
    pub(crate) fn metadata_bytes(&self) -> Result<usize> {
        self.header
            .bytes()
            .checked_add(self.key_metadata.bytes())
            .and_then(|bytes| bytes.checked_add(self.record_metadata.bytes()))
            .ok_or(Error::InvalidFormat("metadata memory accounting overflow"))
    }
}

/// A fully validated, version-neutral description of one dictionary file.
///
/// Producing one of these is the last thing a wire grammar does. Consuming one
/// is the only way the shared core learns a file's geometry.
#[derive(Debug)]
pub struct ValidatedLayout {
    /// Parsed top-level header metadata.
    pub header: Header,
    /// Encoding used for physical keys.
    pub key_encoding: TextEncoding,
    /// Encoding used for record text, or `None` when records are opaque bytes.
    pub record_encoding: Option<TextEncoding>,
    /// Exact checked ranges for every physical section.
    pub sections: SectionRanges,
    /// Total physical entry count, reconciled across both indexes.
    pub total_entries: u64,
    /// Total length of the decoded record stream.
    pub total_decoded_record_len: u64,
    /// Validated keyword block descriptors in physical order.
    pub key_blocks: Box<[KeyBlockDescriptor]>,
    /// Validated record block descriptors in physical order.
    pub record_blocks: Box<[RecordBlockDescriptor]>,
    /// Statically selected lazy wire operations.
    pub wire: WireOperations,
    /// Retained metadata reservations against the aggregate budget.
    pub retained: RetainedBudget,
}

impl ValidatedLayout {
    /// Re-proves the invariants the core depends on, whatever produced them.
    ///
    /// Grammars validate as they parse; this is a cheap, allocation-free
    /// backstop that runs once per open so a future grammar cannot quietly
    /// hand the core a descriptor set that violates a core assumption.
    ///
    /// # Errors
    ///
    /// Returns an error if section geometry, cumulative ordinal coverage, or
    /// cumulative record coverage is inconsistent.
    pub(crate) fn verify(&self) -> Result<()> {
        self.sections.verify_contiguous()?;

        let mut expected_start = 0u64;
        for block in &self.key_blocks {
            if block.entry_start_index != expected_start {
                return Err(Error::InvalidData(format!(
                    "key block starts at ordinal {} but {expected_start} was expected",
                    block.entry_start_index
                )));
            }
            expected_start = block
                .entry_start_index
                .checked_add(block.entry_count)
                .ok_or(Error::InvalidFormat("keyword entry count overflow"))?;
        }
        if expected_start != self.total_entries {
            return Err(Error::InvalidData(format!(
                "key blocks cover {expected_start} entries but {} were declared",
                self.total_entries
            )));
        }

        let mut expected_offset = 0u64;
        for block in &self.record_blocks {
            if block.decomp_offset != expected_offset {
                return Err(Error::InvalidData(format!(
                    "record block starts at {} but {expected_offset} was expected",
                    block.decomp_offset
                )));
            }
            expected_offset = block
                .decomp_offset
                .checked_add(block.decomp_size)
                .ok_or(Error::InvalidFormat("record block offset overflow"))?;
        }
        if expected_offset != self.total_decoded_record_len {
            return Err(Error::InvalidData(format!(
                "record blocks cover {expected_offset} bytes but {} were declared",
                self.total_decoded_record_len
            )));
        }

        Ok(())
    }
}
