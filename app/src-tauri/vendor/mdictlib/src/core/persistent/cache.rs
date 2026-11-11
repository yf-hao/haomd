use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};

use super::format::{read_index_header, reject, validate_section_layout};
use super::{
    CHECKSUM_PAGE_BYTES, IndexHeader, MdictFile, SECTION_COUNT, SectionDescriptor, SectionKind,
};
use crate::error::{Error, Result};
use crate::format::common::checksum::adler32;
use crate::index::{KeyIndexOptions, KeyIndexRejection, KeyIndexSourceIdentity};
use crate::limits::{
    MemoryBudget, MemoryReservation, checked_usize, ensure_u64_ceiling, ensure_usize_limit,
    try_reserve_vec,
};
use crate::types::ChecksumPolicy;
use std::path::Path;

pub(crate) struct IndexSource {
    file: Mutex<File>,
    pub(super) len: u64,
    #[cfg(test)]
    read_operations: AtomicU64,
    #[cfg(test)]
    read_bytes: AtomicU64,
}

impl IndexSource {
    pub(super) fn new(file: File) -> Result<Self> {
        let len = file.metadata()?.len();
        Ok(Self {
            file: Mutex::new(file),
            len,
            #[cfg(test)]
            read_operations: AtomicU64::new(0),
            #[cfg(test)]
            read_bytes: AtomicU64::new(0),
        })
    }

    pub(super) fn read_exact(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
        let len_u64 = u64::try_from(len)
            .map_err(|_| reject(KeyIndexRejection::InvalidLayout("read length exceeds u64")))?;
        let end = offset
            .checked_add(len_u64)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("read range overflow")))?;
        if end > self.len {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "read range exceeds file length",
            )));
        }
        let mut output = Vec::new();
        try_reserve_vec(&mut output, len, "persistent key-index read")?;
        output.resize(len, 0);
        let mut file = self
            .file
            .lock()
            .map_err(|_| reject(KeyIndexRejection::InvalidLayout("index mutex poisoned")))?;
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(&mut output)?;
        self.record_read(len_u64);
        Ok(output)
    }

    pub(super) fn read_exact_into(&self, offset: u64, output: &mut [u8]) -> Result<()> {
        let len = u64::try_from(output.len())
            .map_err(|_| reject(KeyIndexRejection::InvalidLayout("read length exceeds u64")))?;
        let end = offset
            .checked_add(len)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("read range overflow")))?;
        if end > self.len {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "read range exceeds file length",
            )));
        }
        let mut file = self
            .file
            .lock()
            .map_err(|_| reject(KeyIndexRejection::InvalidLayout("index mutex poisoned")))?;
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(output)?;
        self.record_read(len);
        Ok(())
    }

    #[cfg(test)]
    fn record_read(&self, bytes: u64) {
        self.read_operations.fetch_add(1, AtomicOrdering::Relaxed);
        self.read_bytes.fetch_add(bytes, AtomicOrdering::Relaxed);
    }

    #[cfg(not(test))]
    const fn record_read(&self, _bytes: u64) {}

    #[cfg(test)]
    pub(super) fn read_counts(&self) -> (u64, u64) {
        (
            self.read_operations.load(AtomicOrdering::Relaxed),
            self.read_bytes.load(AtomicOrdering::Relaxed),
        )
    }
}

#[derive(Debug)]
pub(crate) struct VerifiedChunk {
    number: Option<u64>,
    bytes: Vec<u8>,
}

impl VerifiedChunk {
    const fn new() -> Self {
        Self {
            number: None,
            bytes: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct IndexBytes {
    bytes: Vec<u8>,
    _memory: MemoryReservation,
}

impl std::ops::Deref for IndexBytes {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.bytes
    }
}

#[derive(Debug)]
pub(crate) struct IndexText {
    text: String,
    _memory: MemoryReservation,
}

impl std::ops::Deref for IndexText {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        &self.text
    }
}

impl IndexText {
    fn as_str(&self) -> &str {
        &self.text
    }
}

/// Validated file-backed key index. Large section chunks remain lazy.
pub(crate) struct PersistentKeyIndex {
    source: IndexSource,
    header: IndexHeader,
    chunk_cache: Mutex<[VerifiedChunk; SECTION_COUNT]>,
    checksum_cache: Mutex<VerifiedChunk>,
    memory: Arc<MemoryBudget>,
    _cache_memory: MemoryReservation,
    max_row_bytes: usize,
    checksum_policy: ChecksumPolicy,
}

impl std::fmt::Debug for PersistentKeyIndex {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PersistentKeyIndex")
            .field("rows", &self.len())
            .field("bytes", &self.header.total_len)
            .finish_non_exhaustive()
    }
}

impl PersistentKeyIndex {
    pub(crate) fn source_identity(&self) -> KeyIndexSourceIdentity {
        self.header.source_identity
    }

    pub(crate) fn len(&self) -> u64 {
        self.header.source_identity.key_count
    }

    fn lock_chunk_cache(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, [VerifiedChunk; SECTION_COUNT]>> {
        self.chunk_cache.lock().map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "chunk cache mutex poisoned",
            ))
        })
    }

    pub(super) fn open_file(
        file: File,
        dictionary: &MdictFile,
        expected: &KeyIndexSourceIdentity,
        options: &KeyIndexOptions,
    ) -> Result<Self> {
        super::format::validate_options(options)?;
        let source = IndexSource::new(file)?;
        ensure_u64_ceiling("key_index_bytes", source.len, options.max_index_bytes)?;
        let header = read_index_header(
            &source,
            &dictionary.memory,
            options,
            options.checksum_policy,
        )?;
        if &header.source_identity != expected {
            return Err(reject(KeyIndexRejection::SourceIdentityMismatch));
        }
        super::query::validate_dictionary_identity(dictionary, expected)?;
        validate_section_layout(&source, &header)?;

        let chunk_bytes = checked_usize(
            u64::from(header.chunk_bytes),
            "persistent key-index chunk cache",
        )?;
        let chunk_cache_bytes =
            chunk_bytes
                .checked_mul(SECTION_COUNT)
                .ok_or(Error::InvalidFormat(
                    "persistent key-index chunk cache size overflow",
                ))?;
        let checksum_table_bytes = header
            .checksum_count
            .checked_mul(4)
            .ok_or(Error::InvalidFormat("persistent checksum table overflow"))?;
        let checksum_cache_bytes = checked_usize(
            if options.checksum_policy == ChecksumPolicy::Verify {
                checksum_table_bytes.min(u64::try_from(CHECKSUM_PAGE_BYTES).unwrap_or(u64::MAX))
            } else {
                0
            },
            "persistent checksum cache",
        )?;
        let cache_bytes =
            chunk_cache_bytes
                .checked_add(checksum_cache_bytes)
                .ok_or(Error::InvalidFormat(
                    "persistent key-index cache size overflow",
                ))?;
        let cache_memory = dictionary
            .memory
            .reserve(cache_bytes, "persistent key-index chunk cache")?;
        let mut chunk_cache = std::array::from_fn(|_| VerifiedChunk::new());
        for slot in &mut chunk_cache {
            try_reserve_vec(
                &mut slot.bytes,
                chunk_bytes,
                "persistent key-index chunk cache",
            )?;
        }
        let mut checksum_cache = VerifiedChunk::new();
        try_reserve_vec(
            &mut checksum_cache.bytes,
            checksum_cache_bytes,
            "persistent key-index checksum cache",
        )?;

        Ok(Self {
            source,
            header,
            chunk_cache: Mutex::new(chunk_cache),
            checksum_cache: Mutex::new(checksum_cache),
            memory: Arc::clone(&dictionary.memory),
            _cache_memory: cache_memory,
            max_row_bytes: dictionary.limits.decompressed_block_bytes,
            checksum_policy: options.checksum_policy,
        })
    }

    pub(super) fn section(&self, section: SectionKind) -> SectionDescriptor {
        self.header.sections[section.index()]
    }

    fn load_verified_chunk<'a>(
        &self,
        cache: &'a mut [VerifiedChunk; SECTION_COUNT],
        section: SectionKind,
        chunk: u64,
    ) -> Result<&'a [u8]> {
        let descriptor = self.section(section);
        if chunk >= descriptor.checksum_count {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "chunk index is out of range",
            )));
        }
        let checksum_index = descriptor
            .checksum_start
            .checked_add(chunk)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum index overflow")))?;
        let expected = (self.checksum_policy == ChecksumPolicy::Verify)
            .then(|| self.expected_checksum(checksum_index))
            .transpose()?;

        let chunk_bytes = u64::from(self.header.chunk_bytes);
        let relative = chunk
            .checked_mul(chunk_bytes)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("chunk offset overflow")))?;
        let remaining = descriptor
            .len
            .checked_sub(relative)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("chunk exceeds section")))?;
        let len = remaining.min(chunk_bytes);
        let offset = descriptor
            .offset
            .checked_add(relative)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("chunk offset overflow")))?;
        let len = checked_usize(len, "persistent key-index chunk length")?;
        let slot = cache.get_mut(section.index()).ok_or_else(|| {
            reject(KeyIndexRejection::InvalidLayout(
                "chunk cache section is out of range",
            ))
        })?;
        if slot.number == Some(chunk) && slot.bytes.len() == len {
            return Ok(&slot.bytes);
        }
        slot.number = None;
        slot.bytes.resize(len, 0);
        self.source.read_exact_into(offset, &mut slot.bytes)?;
        if let Some(expected) = expected {
            let actual = adler32(&slot.bytes);
            if expected != actual {
                slot.bytes.clear();
                return Err(reject(KeyIndexRejection::ChecksumMismatch {
                    section: section.name(),
                    chunk: Some(chunk),
                    expected,
                    actual,
                }));
            }
        }
        slot.number = Some(chunk);
        Ok(&slot.bytes)
    }

    pub(super) fn expected_checksum(&self, index: u64) -> Result<u32> {
        if index >= self.header.checksum_count {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "checksum index is out of range",
            )));
        }
        let byte_offset = index
            .checked_mul(4)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum offset overflow")))?;
        let page_bytes = u64::try_from(CHECKSUM_PAGE_BYTES).map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "checksum page exceeds u64",
            ))
        })?;
        let page = byte_offset / page_bytes;
        let page_start = page
            .checked_mul(page_bytes)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum page overflow")))?;
        let table_bytes =
            self.header.checksum_count.checked_mul(4).ok_or_else(|| {
                reject(KeyIndexRejection::InvalidLayout("checksum table overflow"))
            })?;
        let page_len = checked_usize(
            (table_bytes - page_start).min(page_bytes),
            "persistent checksum page length",
        )?;
        let mut cache = self.checksum_cache.lock().map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "checksum cache mutex poisoned",
            ))
        })?;
        if cache.number != Some(page) || cache.bytes.len() != page_len {
            cache.number = None;
            cache.bytes.resize(page_len, 0);
            let absolute = self
                .header
                .header_len
                .checked_add(page_start)
                .ok_or_else(|| {
                    reject(KeyIndexRejection::InvalidLayout(
                        "checksum table offset overflow",
                    ))
                })?;
            self.source.read_exact_into(absolute, &mut cache.bytes)?;
            cache.number = Some(page);
        }
        let relative = checked_usize(byte_offset - page_start, "persistent checksum offset")?;
        let end = relative
            .checked_add(4)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum offset overflow")))?;
        let bytes = cache.bytes.get(relative..end).ok_or_else(|| {
            reject(KeyIndexRejection::InvalidLayout(
                "checksum exceeds cached page",
            ))
        })?;
        Ok(u32::from_le_bytes(bytes.try_into().map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "invalid checksum table field",
            ))
        })?))
    }

    pub(super) fn read_section(
        &self,
        section: SectionKind,
        offset: u64,
        len: usize,
    ) -> Result<IndexBytes> {
        let descriptor = self.section(section);
        let len_u64 = u64::try_from(len)
            .map_err(|_| reject(KeyIndexRejection::InvalidLayout("section read exceeds u64")))?;
        let end = offset
            .checked_add(len_u64)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("section read overflow")))?;
        if end > descriptor.len {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "section read exceeds its bounds",
            )));
        }
        let memory = self
            .memory
            .reserve(len, "persistent key-index read result")?;
        let mut output = Vec::new();
        try_reserve_vec(&mut output, len, "persistent key-index read result")?;
        output.resize(len, 0);
        if len == 0 {
            return Ok(IndexBytes {
                bytes: output,
                _memory: memory,
            });
        }
        let mut cache = self.lock_chunk_cache()?;
        self.read_section_into_cached(&mut cache, section, offset, &mut output)?;
        Ok(IndexBytes {
            bytes: output,
            _memory: memory,
        })
    }

    pub(super) fn read_section_into_cached(
        &self,
        cache: &mut [VerifiedChunk; SECTION_COUNT],
        section: SectionKind,
        offset: u64,
        output: &mut [u8],
    ) -> Result<()> {
        let descriptor = self.section(section);
        let len_u64 = u64::try_from(output.len())
            .map_err(|_| reject(KeyIndexRejection::InvalidLayout("section read exceeds u64")))?;
        let end = offset
            .checked_add(len_u64)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("section read overflow")))?;
        if end > descriptor.len {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "section read exceeds its bounds",
            )));
        }
        if output.is_empty() {
            return Ok(());
        }
        let chunk_bytes = u64::from(self.header.chunk_bytes);
        let first = offset / chunk_bytes;
        let last = (end - 1) / chunk_bytes;
        for chunk in first..=last {
            let bytes = self.load_verified_chunk(cache, section, chunk)?;
            let chunk_start = chunk
                .checked_mul(chunk_bytes)
                .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("chunk offset overflow")))?;
            let chunk_end = chunk_start
                .checked_add(u64::try_from(bytes.len()).map_err(|_| {
                    reject(KeyIndexRejection::InvalidLayout("chunk length exceeds u64"))
                })?)
                .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("chunk end overflow")))?;
            let copy_start = offset.max(chunk_start);
            let copy_end = end.min(chunk_end);
            let source_start = checked_usize(copy_start - chunk_start, "chunk copy source")?;
            let source_end = checked_usize(copy_end - chunk_start, "chunk copy source")?;
            let target_start = checked_usize(copy_start - offset, "chunk copy target")?;
            let target_end = checked_usize(copy_end - offset, "chunk copy target")?;
            output[target_start..target_end].copy_from_slice(&bytes[source_start..source_end]);
        }
        Ok(())
    }

    fn read_array_cached<const N: usize>(
        &self,
        cache: &mut [VerifiedChunk; SECTION_COUNT],
        section: SectionKind,
        offset: u64,
    ) -> Result<[u8; N]> {
        let mut output = [0u8; N];
        self.read_section_into_cached(cache, section, offset, &mut output)?;
        Ok(output)
    }

    fn bound_at_cached(
        &self,
        cache: &mut [VerifiedChunk; SECTION_COUNT],
        index: u64,
    ) -> Result<u64> {
        if index > self.len() {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "text-bound index is out of range",
            )));
        }
        let offset = index.checked_mul(8).ok_or_else(|| {
            reject(KeyIndexRejection::InvalidLayout(
                "text-bound offset overflow",
            ))
        })?;
        Ok(u64::from_le_bytes(self.read_array_cached(
            cache,
            SectionKind::Bounds,
            offset,
        )?))
    }

    fn order_at_cached(
        &self,
        cache: &mut [VerifiedChunk; SECTION_COUNT],
        position: u64,
    ) -> Result<u32> {
        if position >= self.len() {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "order position is out of range",
            )));
        }
        let offset = position
            .checked_mul(4)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("order offset overflow")))?;
        Ok(u32::from_le_bytes(self.read_array_cached(
            cache,
            SectionKind::Order,
            offset,
        )?))
    }

    fn raw_digest_at_cached(
        &self,
        cache: &mut [VerifiedChunk; SECTION_COUNT],
        ordinal: u32,
    ) -> Result<u32> {
        if u64::from(ordinal) >= self.len() {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "raw-digest ordinal is out of range",
            )));
        }
        let offset = u64::from(ordinal).checked_mul(4).ok_or_else(|| {
            reject(KeyIndexRejection::InvalidLayout(
                "raw-digest offset overflow",
            ))
        })?;
        Ok(u32::from_le_bytes(self.read_array_cached(
            cache,
            SectionKind::Raw,
            offset,
        )?))
    }

    pub(super) fn bound_at(&self, index: u64) -> Result<u64> {
        let mut cache = self.lock_chunk_cache()?;
        self.bound_at_cached(&mut cache, index)
    }

    pub(super) fn raw_digest_at(&self, ordinal: u32) -> Result<u32> {
        let mut cache = self.lock_chunk_cache()?;
        self.raw_digest_at_cached(&mut cache, ordinal)
    }

    pub(super) fn order_at(&self, position: u64) -> Result<u32> {
        let mut cache = self.lock_chunk_cache()?;
        self.order_at_cached(&mut cache, position)
    }

    pub(super) fn row_text(&self, ordinal: u32) -> Result<IndexText> {
        if u64::from(ordinal) >= self.len() {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "text ordinal is out of range",
            )));
        }
        let start = self.bound_at(u64::from(ordinal))?;
        let end = self.bound_at(u64::from(ordinal) + 1)?;
        let len = end
            .checked_sub(start)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("text bounds are inverted")))?;
        if end > self.header.normalized_text_len {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "text bounds exceed text section",
            )));
        }
        let len = checked_usize(len, "persistent normalized key length")?;
        ensure_usize_limit("key_index_row_bytes", len, self.max_row_bytes)?;
        let bytes = self.read_section(SectionKind::Text, start, len)?;
        let IndexBytes {
            bytes,
            _memory: memory,
        } = bytes;
        let text = String::from_utf8(bytes).map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "normalized key is not UTF-8",
            ))
        })?;
        Ok(IndexText {
            text,
            _memory: memory,
        })
    }

    pub(super) fn lower_bound(&self, query: &str, inclusive_end: bool) -> Result<u64> {
        let mut left = 0u64;
        let mut right = self.len();
        while left < right {
            let middle = left + (right - left) / 2;
            let ordinal = self.order_at(middle)?;
            let row = self.row_text(ordinal)?;
            let goes_left = if inclusive_end {
                row.as_str() > query
            } else {
                row.as_str() >= query
            };
            if goes_left {
                right = middle;
            } else {
                left = middle + 1;
            }
        }
        Ok(left)
    }

    pub(super) fn equal_range(&self, query: &str) -> Result<Option<(u64, u64)>> {
        let start = self.lower_bound(query, false)?;
        let end = self.lower_bound(query, true)?;
        Ok((start < end).then_some((start, end)))
    }

    pub(super) fn ordinals_in(&self, start: u64, end: u64) -> Result<Vec<u32>> {
        let count = end
            .checked_sub(start)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("order range is inverted")))?;
        let count = checked_usize(count, "persistent key-index match count")?;
        let mut ordinals = Vec::new();
        try_reserve_vec(&mut ordinals, count, "persistent key-index matches")?;
        for position in start..end {
            ordinals.push(self.order_at(position)?);
        }
        Ok(ordinals)
    }
}

pub(crate) fn open(
    dictionary: &MdictFile,
    path: impl AsRef<Path>,
    expected: &KeyIndexSourceIdentity,
    options: &KeyIndexOptions,
) -> Result<PersistentKeyIndex> {
    PersistentKeyIndex::open_file(File::open(path)?, dictionary, expected, options)
}
