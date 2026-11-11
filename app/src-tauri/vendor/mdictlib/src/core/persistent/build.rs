use std::fs::{File, OpenOptions as FsOpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::mem::size_of;
use std::path::Path;

use super::MdictFile;
use super::format::{
    build_header, check_cancelled, chunk_count, scratch_file, validate_options, write_built_index,
    write_u32, write_u64,
};
use super::sort::{
    ArenaRecord, RunRecord, SortBuffer, merge_runs, write_sorted_order, write_sorted_run,
};
use super::{BuiltIndex, HEADER_BYTES, SectionFile, SectionKind};
use crate::core::locator::raw_digest;
use crate::error::{Error, Result};
use crate::index::{KeyIndexBuild, KeyIndexOptions, KeyIndexSourceIdentity};
use crate::limits::try_reserve_vec;
use crate::types::{ChecksumPolicy, ContainerKind};

pub(crate) fn build_to_writer<W, C>(
    dictionary: &MdictFile,
    destination: &mut W,
    options: &KeyIndexOptions,
    mut cancelled: C,
) -> Result<KeyIndexBuild>
where
    W: Write + Seek + ?Sized,
    C: FnMut() -> bool,
{
    let mut built = build_index(dictionary, options, None, &mut cancelled)?;
    write_built_index(&mut built, destination, options.chunk_bytes, &mut cancelled)?;
    ensure_source_unchanged(
        dictionary,
        built.report.source_identity,
        "building persistent key index",
    )?;
    Ok(built.report)
}

pub(crate) fn build_to_path<P, C>(
    dictionary: &MdictFile,
    path: P,
    options: &KeyIndexOptions,
    mut cancelled: C,
) -> Result<KeyIndexBuild>
where
    P: AsRef<Path>,
    C: FnMut() -> bool,
{
    let path = path.as_ref();
    let fallback = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .or(Some(Path::new(".")));
    let mut built = build_index(dictionary, options, fallback, &mut cancelled)?;
    let mut destination = FsOpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)?;
    write_built_index(
        &mut built,
        &mut destination,
        options.chunk_bytes,
        &mut cancelled,
    )?;
    destination.flush()?;
    destination.sync_all()?;
    drop(destination);

    ensure_source_unchanged(
        dictionary,
        built.report.source_identity,
        "building persistent key index",
    )?;
    Ok(built.report)
}

pub(crate) struct BufferedScratchWriter {
    file: File,
    buffer: Vec<u8>,
    capacity: usize,
}

impl BufferedScratchWriter {
    pub(super) fn new(file: File, capacity: usize) -> Result<Self> {
        let mut buffer = Vec::new();
        try_reserve_vec(&mut buffer, capacity, "key-index scratch write buffer")?;
        Ok(Self {
            file,
            buffer,
            capacity,
        })
    }

    fn flush_buffer(&mut self) -> std::io::Result<()> {
        if !self.buffer.is_empty() {
            self.file.write_all(&self.buffer)?;
            self.buffer.clear();
        }
        Ok(())
    }

    pub(super) fn into_file(mut self) -> Result<File> {
        self.flush()?;
        Ok(self.file)
    }
}

impl Write for BufferedScratchWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        if input.is_empty() {
            return Ok(0);
        }
        if self.buffer.is_empty() && input.len() >= self.capacity {
            return self.file.write(input);
        }
        if self.buffer.len() == self.capacity {
            self.flush_buffer()?;
        }
        let available = self.capacity.saturating_sub(self.buffer.len());
        let written = available.min(input.len());
        self.buffer.extend_from_slice(&input[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.flush_buffer()?;
        self.file.flush()
    }
}

struct IncrementalAdler32 {
    a: u32,
    b: u32,
}

impl IncrementalAdler32 {
    const MODULUS: u32 = 65_521;
    const REDUCTION_BLOCK_BYTES: usize = 5_552;

    const fn new() -> Self {
        Self { a: 1, b: 0 }
    }

    fn update(&mut self, bytes: &[u8]) {
        for block in bytes.chunks(Self::REDUCTION_BLOCK_BYTES) {
            for byte in block {
                self.a += u32::from(*byte);
                self.b += self.a;
            }
            self.a %= Self::MODULUS;
            self.b %= Self::MODULUS;
        }
    }

    const fn finish(&self) -> u32 {
        (self.b << 16) | self.a
    }
}

pub(crate) struct SectionScratchWriter {
    inner: BufferedScratchWriter,
    chunk_bytes: usize,
    chunk_len: usize,
    checksum: Option<IncrementalAdler32>,
    checksums: Vec<u32>,
    len: u64,
}

impl SectionScratchWriter {
    pub(super) fn new(
        file: File,
        buffer_bytes: usize,
        chunk_bytes: usize,
        checksum_policy: ChecksumPolicy,
    ) -> Result<Self> {
        Ok(Self {
            inner: BufferedScratchWriter::new(file, buffer_bytes)?,
            chunk_bytes,
            chunk_len: 0,
            checksum: (checksum_policy == ChecksumPolicy::Verify).then(IncrementalAdler32::new),
            checksums: Vec::new(),
            len: 0,
        })
    }

    fn finish_chunk(&mut self) -> std::io::Result<()> {
        self.checksums.try_reserve(1).map_err(|_| {
            std::io::Error::other("could not allocate persistent index checksum table")
        })?;
        self.checksums
            .push(self.checksum.as_ref().map_or(0, IncrementalAdler32::finish));
        self.chunk_len = 0;
        if self.checksum.is_some() {
            self.checksum = Some(IncrementalAdler32::new());
        }
        Ok(())
    }

    pub(super) fn into_section(mut self, kind: SectionKind) -> Result<SectionFile> {
        if self.chunk_len != 0 {
            self.finish_chunk()?;
        }
        let mut file = self.inner.into_file()?;
        if file.metadata()?.len() != self.len {
            return Err(Error::InvalidFormat(
                "key-index scratch section length mismatch",
            ));
        }
        file.seek(SeekFrom::Start(0))?;
        Ok(SectionFile {
            kind,
            file,
            len: self.len,
            checksums: self.checksums,
        })
    }
}

impl Write for SectionScratchWriter {
    fn write(&mut self, mut input: &[u8]) -> std::io::Result<usize> {
        let written = input.len();
        while !input.is_empty() {
            let remaining = self.chunk_bytes - self.chunk_len;
            let count = remaining.min(input.len());
            let bytes = &input[..count];
            self.inner.write_all(bytes)?;
            if let Some(checksum) = self.checksum.as_mut() {
                checksum.update(bytes);
            }
            self.chunk_len += count;
            self.len = self
                .len
                .checked_add(u64::try_from(count).unwrap_or(u64::MAX))
                .ok_or_else(|| std::io::Error::other("persistent index section overflow"))?;
            input = &input[count..];
            if self.chunk_len == self.chunk_bytes {
                self.finish_chunk()?;
            }
        }
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

pub(crate) fn scratch_write_buffer_bytes(options: &KeyIndexOptions) -> usize {
    options
        .chunk_bytes
        .min(options.build_memory_bytes / 16)
        .max(1)
}

fn build_index<C>(
    dictionary: &MdictFile,
    options: &KeyIndexOptions,
    fallback_scratch: Option<&Path>,
    cancelled: &mut C,
) -> Result<BuiltIndex>
where
    C: FnMut() -> bool,
{
    validate_options(options)?;
    if dictionary.kind != ContainerKind::Mdx {
        return Err(Error::Unsupported("persistent key indexes for MDD"));
    }
    if dictionary.len() > u64::from(u32::MAX) {
        return Err(Error::LimitExceeded {
            limit: "key_index_entries",
            value: dictionary.len(),
            max: u64::from(u32::MAX),
        });
    }

    let before = source_identity(dictionary)?;
    let metadata_plan = build_metadata_plan(dictionary.len(), options)?;
    let scratch_buffer_bytes = scratch_write_buffer_bytes(options);
    let mut text = SectionScratchWriter::new(
        scratch_file(options, fallback_scratch)?,
        scratch_buffer_bytes,
        options.chunk_bytes,
        options.checksum_policy,
    )?;
    let mut bounds = SectionScratchWriter::new(
        scratch_file(options, fallback_scratch)?,
        scratch_buffer_bytes,
        options.chunk_bytes,
        options.checksum_policy,
    )?;
    let mut raw = SectionScratchWriter::new(
        scratch_file(options, fallback_scratch)?,
        scratch_buffer_bytes,
        options.chunk_bytes,
        options.checksum_policy,
    )?;
    let mut runs = BufferedScratchWriter::new(
        scratch_file(options, fallback_scratch)?,
        scratch_buffer_bytes,
    )?;
    let mut buffer = SortBuffer::default();
    let mut buffer_bytes = 0usize;
    let mut maximum_record_bytes = size_of::<RunRecord>() + 12;
    let mut run_count = 0u64;
    let mut normalized_text_len = 0u64;
    write_u64(&mut bounds, 0)?;

    let mut built_rows = 0u64;
    for block_index in 0..dictionary.key_block_count() {
        check_cancelled(cancelled, "building persistent key index")?;
        let entries = match dictionary.decode_key_block(block_index) {
            Ok(entries) => entries,
            Err(error) => {
                if source_identity(dictionary)? != before {
                    return Err(Error::SourceChanged {
                        operation: "building persistent key index",
                    });
                }
                return Err(error);
            }
        };
        let block = dictionary
            .layout
            .key_blocks
            .get(block_index)
            .ok_or(Error::InvalidFormat("key block index out of range"))?;
        for (entry_index, entry) in entries.iter().enumerate() {
            if entry_index != 0 {
                check_cancelled(cancelled, "building persistent key index")?;
            }
            let ordinal_u64 = block
                .entry_start_index
                .checked_add(
                    u64::try_from(entry_index)
                        .map_err(|_| Error::InvalidFormat("key ordinal exceeds u64"))?,
                )
                .ok_or(Error::InvalidFormat("key ordinal overflow"))?;
            let ordinal = u32::try_from(ordinal_u64).map_err(|_| Error::LimitExceeded {
                limit: "key_index_entries",
                value: ordinal_u64,
                max: u64::from(u32::MAX),
            })?;
            let arena_record_bytes = size_of::<ArenaRecord>();
            let scratch_record_overhead = size_of::<RunRecord>() + 12;
            let single_limit = options.build_memory_bytes / 4;
            let ascii_upper = entry.key.len().checked_add(arena_record_bytes);
            let (reserve_len, expected_normalized_len, planned_record_bytes) =
                if entry.key.is_ascii()
                    && ascii_upper.is_some_and(|record_bytes| record_bytes <= single_limit)
                {
                    (entry.key.len(), None, ascii_upper.unwrap_or(single_limit))
                } else {
                    let normalized_len = dictionary.normalizer.normalized_len(&entry.key)?;
                    let record_bytes = normalized_len
                        .checked_add(arena_record_bytes)
                        .ok_or(Error::InvalidFormat("key-index sort record size overflow"))?;
                    if record_bytes > single_limit {
                        return Err(Error::LimitExceeded {
                            limit: "key_index_build_memory_bytes",
                            value: u64::try_from(record_bytes).unwrap_or(u64::MAX),
                            max: u64::try_from(single_limit).unwrap_or(u64::MAX),
                        });
                    }
                    (normalized_len, Some(normalized_len), record_bytes)
                };
            let next_buffer = buffer_bytes
                .checked_add(planned_record_bytes)
                .ok_or(Error::InvalidFormat("key-index sort buffer size overflow"))?;
            if !buffer.is_empty() && next_buffer > options.build_memory_bytes / 2 {
                write_sorted_run(&mut runs, &mut buffer)?;
                run_count = run_count
                    .checked_add(1)
                    .ok_or(Error::InvalidFormat("key-index run count overflow"))?;
                buffer.clear();
                buffer_bytes = 0;
            }

            buffer.reserve_record(reserve_len, options.build_memory_bytes)?;
            let normalized_start = buffer.normalized.len();
            dictionary
                .normalizer
                .normalize_bytes_into(&entry.key, &mut buffer.normalized);
            let normalized_len = buffer
                .normalized
                .len()
                .checked_sub(normalized_start)
                .ok_or(Error::InvalidFormat("normalized key arena underflow"))?;
            if expected_normalized_len.is_some_and(|expected| normalized_len != expected) {
                return Err(Error::InvalidFormat(
                    "normalized key length changed during construction",
                ));
            }
            if normalized_len > reserve_len {
                return Err(Error::InvalidFormat(
                    "normalized key exceeded its reserved upper bound",
                ));
            }
            let record_bytes = normalized_len
                .checked_add(scratch_record_overhead)
                .ok_or(Error::InvalidFormat("key-index sort record size overflow"))?;
            if record_bytes > single_limit {
                return Err(Error::LimitExceeded {
                    limit: "key_index_build_memory_bytes",
                    value: u64::try_from(record_bytes).unwrap_or(u64::MAX),
                    max: u64::try_from(single_limit).unwrap_or(u64::MAX),
                });
            }

            let next_normalized_text_len = normalized_text_len
                .checked_add(
                    u64::try_from(normalized_len)
                        .map_err(|_| Error::InvalidFormat("normalized key length exceeds u64"))?,
                )
                .ok_or(Error::InvalidFormat("normalized text length overflow"))?;
            if next_normalized_text_len > metadata_plan.maximum_text_bytes {
                let text_checksums = chunk_count(
                    next_normalized_text_len,
                    u64::try_from(options.chunk_bytes)
                        .map_err(|_| Error::InvalidFormat("key-index chunk length exceeds u64"))?,
                )?;
                let required = metadata_plan
                    .fixed_checksum_count
                    .checked_add(text_checksums)
                    .and_then(|count| count.checked_mul(4))
                    .and_then(|bytes| {
                        u64::try_from(HEADER_BYTES)
                            .ok()
                            .and_then(|header| header.checked_add(bytes))
                    })
                    .ok_or(Error::InvalidFormat("key-index metadata length overflow"))?;
                return Err(Error::LimitExceeded {
                    limit: "key_index_metadata_bytes",
                    value: required,
                    max: metadata_plan.limit,
                });
            }
            text.write_all(&buffer.normalized[normalized_start..])?;
            normalized_text_len = next_normalized_text_len;
            write_u64(&mut bounds, normalized_text_len)?;
            write_u32(&mut raw, raw_digest(&entry.key))?;

            buffer.records.push(ArenaRecord {
                start: normalized_start,
                len: normalized_len,
                ordinal,
            });
            buffer_bytes = buffer_bytes
                .checked_add(planned_record_bytes)
                .ok_or(Error::InvalidFormat("key-index sort buffer size overflow"))?;
            maximum_record_bytes = maximum_record_bytes.max(record_bytes);
            built_rows = built_rows
                .checked_add(1)
                .ok_or(Error::InvalidFormat("key-index row count overflow"))?;
        }
    }
    if built_rows != dictionary.len() {
        return Err(Error::InvalidFormat("key-index source row count mismatch"));
    }
    let text = text.into_section(SectionKind::Text)?;
    let bounds = bounds.into_section(SectionKind::Bounds)?;
    let raw = raw.into_section(SectionKind::Raw)?;

    let expected_bounds = dictionary
        .len()
        .checked_add(1)
        .and_then(|count| count.checked_mul(8))
        .ok_or(Error::InvalidFormat("key-index bounds length overflow"))?;
    if bounds.len != expected_bounds
        || raw.len
            != dictionary
                .len()
                .checked_mul(4)
                .ok_or(Error::InvalidFormat("key-index raw length overflow"))?
    {
        return Err(Error::InvalidFormat(
            "key-index physical section length mismatch",
        ));
    }

    let order = if run_count == 0 {
        let mut order = SectionScratchWriter::new(
            scratch_file(options, fallback_scratch)?,
            scratch_buffer_bytes,
            options.chunk_bytes,
            options.checksum_policy,
        )?;
        write_sorted_order(&mut order, &mut buffer)?;
        drop(buffer);
        order.into_section(SectionKind::Order)?
    } else {
        if !buffer.is_empty() {
            write_sorted_run(&mut runs, &mut buffer)?;
            run_count = run_count
                .checked_add(1)
                .ok_or(Error::InvalidFormat("key-index run count overflow"))?;
        }
        drop(buffer);
        merge_runs(
            runs.into_file()?,
            run_count,
            dictionary.len(),
            maximum_record_bytes,
            options,
            fallback_scratch,
            cancelled,
        )?
    };

    let sections = [text, bounds, raw, order];
    let (header, descriptors, total_len) =
        build_header(&sections, before, normalized_text_len, options)?;

    let report = KeyIndexBuild {
        source_identity: before,
        bytes_written: total_len,
    };
    Ok(BuiltIndex {
        header,
        sections,
        descriptors,
        report,
    })
}

#[derive(Debug, Clone, Copy)]
struct BuildMetadataPlan {
    fixed_checksum_count: u64,
    maximum_text_bytes: u64,
    limit: u64,
}

fn build_metadata_plan(rows: u64, options: &KeyIndexOptions) -> Result<BuildMetadataPlan> {
    let chunk_bytes = u64::try_from(options.chunk_bytes)
        .map_err(|_| Error::InvalidFormat("key-index chunk length exceeds u64"))?;
    let bounds_bytes = rows
        .checked_add(1)
        .and_then(|count| count.checked_mul(8))
        .ok_or(Error::InvalidFormat("key-index bounds length overflow"))?;
    let ordinal_bytes = rows
        .checked_mul(4)
        .ok_or(Error::InvalidFormat("key-index ordinal length overflow"))?;
    let bounds_checksum_count = chunk_count(bounds_bytes, chunk_bytes)?;
    let ordinal_checksum_count = chunk_count(ordinal_bytes, chunk_bytes)?;
    let fixed_checksum_count = ordinal_checksum_count
        .checked_mul(2)
        .and_then(|count| count.checked_add(bounds_checksum_count))
        .ok_or(Error::InvalidFormat("key-index checksum count overflow"))?;
    let header_bytes = u64::try_from(HEADER_BYTES)
        .map_err(|_| Error::InvalidFormat("key-index header length exceeds u64"))?;
    let limit = u64::try_from(options.max_metadata_bytes).unwrap_or(u64::MAX);
    let available_checksum_bytes = limit
        .checked_sub(header_bytes)
        .ok_or(Error::LimitExceeded {
            limit: "key_index_metadata_bytes",
            value: header_bytes,
            max: limit,
        })?;
    let checksum_slots = available_checksum_bytes / 4;
    if fixed_checksum_count > checksum_slots {
        let required = fixed_checksum_count
            .checked_mul(4)
            .and_then(|bytes| header_bytes.checked_add(bytes))
            .ok_or(Error::InvalidFormat("key-index metadata length overflow"))?;
        return Err(Error::LimitExceeded {
            limit: "key_index_metadata_bytes",
            value: required,
            max: limit,
        });
    }
    let maximum_text_bytes = checksum_slots
        .checked_sub(fixed_checksum_count)
        .and_then(|count| count.checked_mul(chunk_bytes))
        .unwrap_or(u64::MAX);
    Ok(BuildMetadataPlan {
        fixed_checksum_count,
        maximum_text_bytes,
        limit,
    })
}

pub(crate) fn source_identity(dictionary: &MdictFile) -> Result<KeyIndexSourceIdentity> {
    let current = dictionary.source.current_identity()?;
    if current.len != dictionary.source.len() {
        return Err(Error::SourceChanged {
            operation: "reading key-index source identity",
        });
    }
    Ok(KeyIndexSourceIdentity {
        source_bytes: current.len,
        source_modified_unix_nanos: current.modified_unix_nanos,
        key_count: dictionary.len(),
    })
}

fn ensure_source_unchanged(
    dictionary: &MdictFile,
    expected: KeyIndexSourceIdentity,
    operation: &'static str,
) -> Result<()> {
    if source_identity(dictionary)? != expected {
        return Err(Error::SourceChanged { operation });
    }
    Ok(())
}
