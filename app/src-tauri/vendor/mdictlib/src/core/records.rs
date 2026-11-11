use std::ops::Deref;
use std::sync::Arc;

use super::keys::{DecodedKeyBlock, KeyBlockHit};
use super::{CachedFailure, CachedValue, MdictFile};
use crate::error::{Error, Result};
use crate::format::common::compression::decode_block;
use crate::format::common::descriptors::find_record_block;
use crate::limits::{
    MemoryReservation, checked_u64, checked_usize, try_clone_string, try_reserve_vec,
};
use crate::types::{KeyEntry, KeyOrdinal};

#[derive(Debug, Clone)]
pub(crate) struct RecordDescriptor {
    pub(crate) key: KeyEntry,
    pub(crate) start: u64,
    pub(crate) end: u64,
}

#[derive(Debug)]
pub(super) struct DecodedRecordBlock {
    bytes: Vec<u8>,
    _memory: MemoryReservation,
}

impl Deref for DecodedRecordBlock {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.bytes
    }
}

impl DecodedRecordBlock {
    pub(super) const fn memory_bytes(&self) -> usize {
        self._memory.bytes()
    }
}

impl MdictFile {
    pub(crate) fn record_at_ordinal(
        &self,
        ordinal: KeyOrdinal,
    ) -> Result<Option<RecordDescriptor>> {
        let Some(hit) = self.key_entry_at_ordinal(ordinal)? else {
            return Ok(None);
        };
        self.record_descriptor_from_hit(hit).map(Some)
    }

    pub(super) fn record_descriptor_at_position(
        &self,
        block_index: usize,
        entry_index: usize,
        entries: Arc<DecodedKeyBlock>,
    ) -> Result<RecordDescriptor> {
        self.record_descriptor_from_hit(KeyBlockHit {
            block_index,
            entry_index,
            entries,
        })
    }

    fn record_descriptor_from_hit(&self, hit: KeyBlockHit) -> Result<RecordDescriptor> {
        let KeyBlockHit {
            block_index,
            entry_index,
            entries,
        } = hit;
        let block = self
            .layout
            .key_blocks
            .get(block_index)
            .ok_or(Error::InvalidFormat("key block index out of range"))?;
        let entry_start_index = block.entry_start_index;
        let local_ordinal = u64::try_from(entry_index)
            .map_err(|_| Error::InvalidFormat("key entry index exceeds u64"))?;
        let ordinal = entry_start_index
            .checked_add(local_ordinal)
            .ok_or(Error::InvalidFormat("key ordinal overflow"))?;
        let entry = entries
            .get(entry_index)
            .ok_or(Error::InvalidFormat("key entry index out of range"))?;
        let start = entry.record_start;
        let key = try_clone_string(&entry.key, "record descriptor key")?;
        let end = if let Some(next) = entries.get(entry_index + 1) {
            next.record_start
        } else if block_index + 1 < self.key_block_count() {
            drop(entries);
            let next_block = self.decode_key_block(block_index + 1)?;
            next_block
                .first()
                .ok_or(Error::InvalidFormat("empty key block"))?
                .record_start
        } else {
            self.layout.total_decoded_record_len
        };
        if end < start {
            return Err(Error::InvalidData(format!(
                "record span decreases from {start} to {end}"
            )));
        }
        Ok(RecordDescriptor {
            key: KeyEntry::new(KeyOrdinal::new(ordinal), key),
            start,
            end,
        })
    }

    pub(crate) fn read_record_span(&self, start: u64, end: u64) -> Result<Vec<u8>> {
        let len = self.materialized_record_span_len(start, end)?;
        let _memory = self.memory.reserve(len, "materialized record")?;
        let mut output = Vec::new();
        try_reserve_vec(&mut output, len, "materialized record")?;
        self.visit_record_span(start, end, |chunk| {
            output.extend_from_slice(chunk);
            Ok(())
        })?;
        Ok(output)
    }

    pub(crate) fn visit_record_span<F>(&self, start: u64, end: u64, mut visitor: F) -> Result<()>
    where
        F: FnMut(&[u8]) -> Result<()>,
    {
        self.validate_record_span(start, end)?;

        let mut cursor = start;
        while cursor < end {
            let block_index = find_record_block(&self.layout.record_blocks, cursor).ok_or(
                Error::InvalidFormat("record offset not covered by record blocks"),
            )?;
            let block = &self.layout.record_blocks[block_index];
            let decoded = self.decode_record_block(block_index)?;
            let local_start = checked_usize(
                cursor
                    .checked_sub(block.decomp_offset)
                    .ok_or(Error::InvalidFormat("record block offset underflow"))?,
                "record block local start",
            )?;
            let block_end = block
                .decomp_offset
                .checked_add(block.decomp_size)
                .ok_or(Error::InvalidFormat("record block end overflow"))?;
            let chunk_end = u64::min(end, block_end);
            let local_end = checked_usize(
                chunk_end
                    .checked_sub(block.decomp_offset)
                    .ok_or(Error::InvalidFormat("record block offset underflow"))?,
                "record block local end",
            )?;
            if local_start > local_end || local_end > decoded.len() {
                return Err(Error::InvalidFormat("record block slice is out of range"));
            }
            visitor(&decoded[local_start..local_end])?;
            let local_end = u64::try_from(local_end)
                .map_err(|_| Error::InvalidFormat("record block offset exceeds u64"))?;
            let next_cursor = block
                .decomp_offset
                .checked_add(local_end)
                .ok_or(Error::InvalidFormat("record cursor overflow"))?;
            if next_cursor <= cursor {
                return Err(Error::InvalidFormat("record traversal made no progress"));
            }
            cursor = next_cursor;
        }

        Ok(())
    }

    fn decode_record_block(&self, index: usize) -> Result<Arc<DecodedRecordBlock>> {
        let mut cache = self
            .record_block_cache
            .lock()
            .map_err(|_| Error::InvalidFormat("record block cache mutex poisoned"))?;
        if let Some((cached_index, value)) = cache.as_ref()
            && *cached_index == index
        {
            return match value {
                CachedValue::Ready(data) => Ok(Arc::clone(data)),
                CachedValue::Failed(error) => Err(error.replay()),
            };
        }
        *cache = None;

        match self.decode_record_block_uncached(index) {
            Ok(decoded) => {
                *cache = Some((index, CachedValue::Ready(Arc::clone(&decoded))));
                Ok(decoded)
            }
            Err(error) => {
                if let Some(cached) = CachedFailure::capture(&error, &self.memory) {
                    *cache = Some((index, CachedValue::Failed(cached)));
                }
                Err(error)
            }
        }
    }

    fn decode_record_block_uncached(&self, index: usize) -> Result<Arc<DecodedRecordBlock>> {
        let block = self
            .layout
            .record_blocks
            .get(index)
            .ok_or(Error::InvalidFormat("record block index out of range"))?;
        let comp_size = checked_usize(block.comp_size, "record block compressed length")?;
        let decomp_size = checked_usize(block.decomp_size, "record block decompressed length")?;
        let retained_memory = self.memory.reserve(decomp_size, "decoded record block")?;
        let _compressed_memory = self.memory.reserve(comp_size, "compressed record block")?;
        let block_bytes =
            self.source
                .read_exact_at(block.comp_offset, comp_size, "record block")?;
        let bytes = decode_block(
            "record block",
            &block_bytes,
            decomp_size,
            &self.limits,
            self.checksum_policy,
        )?;
        let decoded = Arc::new(DecodedRecordBlock {
            bytes,
            _memory: retained_memory,
        });
        Ok(decoded)
    }

    pub(crate) fn validate_record_span(&self, start: u64, end: u64) -> Result<u64> {
        if end < start {
            return Err(Error::InvalidFormat("record range is inverted"));
        }
        let len = end
            .checked_sub(start)
            .ok_or(Error::InvalidFormat("record range overflow"))?;
        if end > self.layout.total_decoded_record_len {
            return Err(Error::InvalidFormat("record range exceeds record data"));
        }
        Ok(len)
    }

    fn materialized_record_span_len(&self, start: u64, end: u64) -> Result<usize> {
        let len = self.validate_record_span(start, end)?;
        let max = checked_u64(
            self.limits.materialized_record_bytes,
            "materialized record limit",
        )?;
        if len > max {
            return Err(Error::LimitExceeded {
                limit: "materialized_record_bytes",
                value: len,
                max,
            });
        }
        usize::try_from(len)
            .map_err(|_| Error::InvalidFormat("materialized record length exceeds usize"))
    }
}
