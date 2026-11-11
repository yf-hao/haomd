use std::mem::size_of;
use std::ops::Deref;
use std::sync::Arc;

use super::{CachedFailure, CachedValue, MdictFile};
use crate::error::{Error, Result};
use crate::format::common::compression::decode_block;
use crate::format::common::descriptors::{DecodedKeyRow, KeyRowContext};
use crate::limits::{MemoryReservation, checked_usize, try_clone_string, try_reserve_vec};
use crate::types::{KeyEntry, KeyOrdinal};

/// One decoded key row, as produced by whichever wire grammar this file uses.
pub(super) type DecodedKeyEntry = DecodedKeyRow;

#[derive(Debug)]
pub(super) struct DecodedKeyBlock {
    entries: Vec<DecodedKeyEntry>,
    _memory: MemoryReservation,
}

impl Deref for DecodedKeyBlock {
    type Target = [DecodedKeyEntry];

    fn deref(&self) -> &Self::Target {
        &self.entries
    }
}

impl DecodedKeyBlock {
    pub(super) const fn memory_bytes(&self) -> usize {
        self._memory.bytes()
    }
}

pub(super) struct KeyBlockHit {
    pub(super) block_index: usize,
    pub(super) entry_index: usize,
    pub(super) entries: Arc<DecodedKeyBlock>,
}

impl MdictFile {
    pub(crate) fn key_at_ordinal(&self, ordinal: KeyOrdinal) -> Result<Option<KeyEntry>> {
        let Some(hit) = self.key_entry_at_ordinal(ordinal)? else {
            return Ok(None);
        };
        Ok(Some(KeyEntry::new(
            ordinal,
            try_clone_string(&hit.entries[hit.entry_index].key, "physical key result")?,
        )))
    }

    pub(crate) fn keys_at_ordinals(
        &self,
        ordinals: &[KeyOrdinal],
    ) -> Result<Vec<Option<KeyEntry>>> {
        let mut results = Vec::new();
        try_reserve_vec(&mut results, ordinals.len(), "batched key results")?;
        results.resize_with(ordinals.len(), || None);
        let mut requests = Vec::new();
        try_reserve_vec(&mut requests, ordinals.len(), "batched key requests")?;

        for (input_index, ordinal) in ordinals.iter().copied().enumerate() {
            let ordinal_value = ordinal.get();
            if ordinal_value >= self.len() {
                continue;
            }

            let block_index =
                self.find_key_block_by_ordinal(ordinal_value)?
                    .ok_or(Error::InvalidFormat(
                        "key ordinal not covered by key blocks",
                    ))?;
            let block = self
                .layout
                .key_blocks
                .get(block_index)
                .ok_or(Error::InvalidFormat("key block index out of range"))?;
            let entry_offset = ordinal_value
                .checked_sub(block.entry_start_index)
                .ok_or(Error::InvalidFormat("key ordinal underflow"))?;
            let entry_index = usize::try_from(entry_offset)
                .map_err(|_| Error::InvalidFormat("key ordinal exceeds usize"))?;
            requests.push((block_index, entry_index, input_index, ordinal));
        }

        requests.sort_unstable_by_key(|(block_index, _, _, _)| *block_index);

        let mut range_start = 0usize;
        while range_start < requests.len() {
            let block_index = requests[range_start].0;
            let mut range_end = range_start + 1;
            while range_end < requests.len() && requests[range_end].0 == block_index {
                range_end += 1;
            }

            let entries = self.decode_key_block(block_index)?;
            for (_, entry_index, input_index, ordinal) in &requests[range_start..range_end] {
                let entry = entries.get(*entry_index).ok_or_else(|| {
                    Error::InvalidData(format!(
                        "key ordinal {} resolved past decoded block length {}",
                        ordinal.get(),
                        entries.len()
                    ))
                })?;
                results[*input_index] = Some(KeyEntry::new(
                    *ordinal,
                    try_clone_string(&entry.key, "batched physical key result")?,
                ));
            }

            range_start = range_end;
        }

        Ok(results)
    }

    pub(super) fn key_entry_at_ordinal(&self, ordinal: KeyOrdinal) -> Result<Option<KeyBlockHit>> {
        let ordinal_value = ordinal.get();
        if ordinal_value >= self.len() {
            return Ok(None);
        }

        let block_index =
            self.find_key_block_by_ordinal(ordinal_value)?
                .ok_or(Error::InvalidFormat(
                    "key ordinal not covered by key blocks",
                ))?;
        let block = self
            .layout
            .key_blocks
            .get(block_index)
            .ok_or(Error::InvalidFormat("key block index out of range"))?;
        let entry_offset = ordinal_value
            .checked_sub(block.entry_start_index)
            .ok_or(Error::InvalidFormat("key ordinal underflow"))?;
        let entry_index = usize::try_from(entry_offset)
            .map_err(|_| Error::InvalidFormat("key ordinal exceeds usize"))?;
        let entries = self.decode_key_block(block_index)?;
        if entry_index >= entries.len() {
            return Err(Error::InvalidData(format!(
                "key ordinal {ordinal_value} resolved past decoded block length {}",
                entries.len()
            )));
        }
        Ok(Some(KeyBlockHit {
            block_index,
            entry_index,
            entries,
        }))
    }

    pub(super) fn decode_key_block(&self, index: usize) -> Result<Arc<DecodedKeyBlock>> {
        let mut cache = self
            .key_block_cache
            .lock()
            .map_err(|_| Error::InvalidFormat("key block cache mutex poisoned"))?;
        if let Some((cached_index, value)) = cache.as_ref()
            && *cached_index == index
        {
            return match value {
                CachedValue::Ready(entries) => Ok(Arc::clone(entries)),
                CachedValue::Failed(error) => Err(error.replay()),
            };
        }

        let result = (|| {
            if self.layout.key_blocks.get(index).is_none() {
                return Err(Error::InvalidFormat("key block index out of range"));
            }
            let previous_last = if index == 0 {
                None
            } else if let Some((cached_index, value)) = cache.as_ref()
                && cached_index.checked_add(1) == Some(index)
            {
                Some(match value {
                    CachedValue::Ready(previous) => {
                        previous
                            .last()
                            .ok_or(Error::InvalidFormat("empty decoded key block"))?
                            .record_start
                    }
                    CachedValue::Failed(error) => return Err(error.replay()),
                })
            } else {
                let previous = self.decode_key_block_uncached(index - 1)?;
                Some(
                    previous
                        .last()
                        .ok_or(Error::InvalidFormat("empty decoded key block"))?
                        .record_start,
                )
            };
            *cache = None;

            let entries = self.decode_key_block_uncached(index)?;
            if let Some(previous_last) = previous_last {
                let current_first = entries
                    .first()
                    .ok_or(Error::InvalidFormat("empty decoded key block"))?
                    .record_start;
                if previous_last > current_first {
                    return Err(Error::InvalidData(format!(
                        "record starts decrease across key blocks from {previous_last} to {current_first}"
                    )));
                }
            }
            Ok(entries)
        })();

        match result {
            Ok(entries) => {
                *cache = Some((index, CachedValue::Ready(Arc::clone(&entries))));
                Ok(entries)
            }
            Err(error) => {
                if let Some(cached) = CachedFailure::capture(&error, &self.memory) {
                    *cache = Some((index, CachedValue::Failed(cached)));
                }
                Err(error)
            }
        }
    }

    fn decode_key_block_uncached(&self, index: usize) -> Result<Arc<DecodedKeyBlock>> {
        let block = self
            .layout
            .key_blocks
            .get(index)
            .ok_or(Error::InvalidFormat("key block index out of range"))?;
        let comp_size = checked_usize(block.comp_size, "key block compressed length")?;
        let decomp_size = checked_usize(block.decomp_size, "key block decompressed length")?;
        let entry_count = checked_usize(block.entry_count, "key block entry count")?;
        let decoded_text_bytes = self.layout.key_encoding.max_decoded_len(decomp_size)?;
        let retained_bytes = decoded_text_bytes
            .checked_add(
                entry_count
                    .checked_mul(size_of::<DecodedKeyEntry>())
                    .ok_or(Error::InvalidFormat("decoded key metadata size overflow"))?,
            )
            .ok_or(Error::InvalidFormat("decoded key block size overflow"))?;
        let retained_memory = self.memory.reserve(retained_bytes, "decoded key block")?;
        let _compressed_memory = self.memory.reserve(comp_size, "compressed key block")?;
        let _decoded_memory = self.memory.reserve(decomp_size, "raw decoded key block")?;

        let block_bytes = self
            .source
            .read_exact_at(block.comp_offset, comp_size, "key block")?;
        let decoded = decode_block(
            "key block",
            &block_bytes,
            decomp_size,
            &self.limits,
            self.checksum_policy,
        )?;
        let context = KeyRowContext {
            encoding: self.layout.key_encoding,
            expected_entries: block.entry_count,
            total_decoded_record_len: self.layout.total_decoded_record_len,
        };
        let parsed = (self.layout.wire.decode_key_rows)(&decoded, &context)?;
        let first = parsed
            .first()
            .ok_or(Error::InvalidFormat("empty decoded key block"))?;
        let last = parsed
            .last()
            .ok_or(Error::InvalidFormat("empty decoded key block"))?;
        if !self.key_summary_matches(&first.key, &block.first_key)?
            || !self.key_summary_matches(&last.key, &block.last_key)?
        {
            return Err(Error::InvalidFormat(
                "keyword block summaries do not match decoded boundary keys",
            ));
        }
        let entries = Arc::new(DecodedKeyBlock {
            entries: parsed,
            _memory: retained_memory,
        });
        Ok(entries)
    }

    fn key_summary_matches(&self, decoded_key: &str, index_summary: &str) -> Result<bool> {
        let decoded_len = self.normalizer.normalized_len(decoded_key)?;
        let summary_len = self.normalizer.normalized_len(index_summary)?;
        let memory_len = decoded_len
            .checked_add(summary_len)
            .ok_or(Error::InvalidFormat("normalized key summary size overflow"))?;
        let _memory = self
            .memory
            .reserve(memory_len, "normalized key block summaries")?;
        Ok(self.normalizer.normalize(decoded_key)? == self.normalizer.normalize(index_summary)?)
    }

    fn find_key_block_by_ordinal(&self, ordinal: u64) -> Result<Option<usize>> {
        let blocks = &self.layout.key_blocks;
        let mut left = 0usize;
        let mut right = blocks.len();
        while left < right {
            let mid = (left + right) / 2;
            let block = &blocks[mid];
            let block_end = block
                .entry_start_index
                .checked_add(block.entry_count)
                .ok_or(Error::InvalidFormat("keyword entry count overflow"))?;
            if ordinal < block.entry_start_index {
                right = mid;
            } else if ordinal >= block_end {
                left = mid + 1;
            } else {
                return Ok(Some(mid));
            }
        }
        Ok(None)
    }
}
