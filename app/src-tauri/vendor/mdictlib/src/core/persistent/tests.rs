use super::build::SectionScratchWriter;
use super::cache::IndexSource;
use super::format::{
    align8, chunk_count, parse_header, push_i128, push_u32, push_u64, read_index_header,
    read_u32_file, scratch_file,
};
use super::sort::{ArenaRecord, RunRecord, SortBuffer, merge_runs, write_sorted_run};
use super::{
    ENDIAN_MARKER, HEADER_BYTES, HEADER_CHECKSUM_BYTES, HEADER_FIELDS_BYTES, HEADER_PREFIX_BYTES,
    MAGIC, MAX_MERGE_FAN_IN, MIN_CHUNK_BYTES, SECTION_COUNT, SectionDescriptor, SectionKind,
};
use crate::format::common::checksum::adler32;
use crate::index::KeyIndexOptions;
use crate::index::{
    KEY_INDEX_FORMAT_REVISION, KEY_INDEX_NORMALIZATION_REVISION, KEY_INDEX_PARSER_REVISION,
};
use crate::limits::MemoryBudget;
use crate::types::ChecksumPolicy;
use std::io::{Seek, SeekFrom, Write};
use std::mem::size_of;
use std::sync::Arc;

fn parseable_header(text_chunks: u64) -> (Vec<u8>, u64, usize) {
    let chunk_bytes = u64::try_from(MIN_CHUNK_BYTES).unwrap();
    let key_count = 1u64;
    let normalized_text_len = text_chunks.checked_mul(chunk_bytes).unwrap();
    let section_lengths = [normalized_text_len, 16, 4, 4];
    let checksum_counts = section_lengths.map(|len| chunk_count(len, chunk_bytes).unwrap());
    let checksum_count = checksum_counts.iter().copied().sum::<u64>();
    let header_len = u64::try_from(HEADER_BYTES).unwrap();

    let mut descriptors = [SectionDescriptor::EMPTY; SECTION_COUNT];
    let mut offset = align8(header_len + checksum_count * 4).unwrap();
    let mut checksum_start = 0u64;
    for index in 0..SECTION_COUNT {
        offset = align8(offset).unwrap();
        descriptors[index] = SectionDescriptor {
            offset,
            len: section_lengths[index],
            checksum_start,
            checksum_count: checksum_counts[index],
        };
        offset = offset.checked_add(section_lengths[index]).unwrap();
        checksum_start = checksum_start.checked_add(checksum_counts[index]).unwrap();
    }
    let total_len = offset;

    let mut header = Vec::new();
    header.extend_from_slice(&MAGIC);
    push_u32(&mut header, KEY_INDEX_FORMAT_REVISION);
    push_u32(&mut header, ENDIAN_MARKER);
    push_u64(&mut header, header_len);
    push_u64(&mut header, total_len);
    push_u32(&mut header, KEY_INDEX_PARSER_REVISION);
    push_u32(&mut header, KEY_INDEX_NORMALIZATION_REVISION);
    push_u32(&mut header, u32::try_from(chunk_bytes).unwrap());
    push_u32(&mut header, u32::try_from(SECTION_COUNT).unwrap());
    push_u64(&mut header, 1234);
    push_i128(&mut header, 5678);
    push_u64(&mut header, key_count);
    push_u64(&mut header, normalized_text_len);
    for descriptor in descriptors {
        push_u64(&mut header, descriptor.offset);
        push_u64(&mut header, descriptor.len);
        push_u64(&mut header, descriptor.checksum_start);
        push_u64(&mut header, descriptor.checksum_count);
    }
    assert_eq!(header.len(), HEADER_FIELDS_BYTES);
    let checksum_at = usize::try_from(header_len).unwrap() - HEADER_CHECKSUM_BYTES;
    header.resize(checksum_at, 0);
    let checksum = adler32(&header);
    push_u32(&mut header, checksum);
    assert_eq!(header.len(), usize::try_from(header_len).unwrap());

    (header, total_len, usize::try_from(checksum_count).unwrap())
}

#[test]
fn fixed_header_size_does_not_depend_on_checksum_count() {
    let (small, small_total_len, small_checksums) = parseable_header(1);
    let (large, large_total_len, large_checksums) = parseable_header(65_536);
    let options = KeyIndexOptions::new().with_chunk_bytes(MIN_CHUNK_BYTES);
    assert_eq!(small.len(), HEADER_BYTES);
    assert_eq!(large.len(), HEADER_BYTES);
    assert!(large_checksums > small_checksums);
    assert_eq!(
        parse_header(&small, small_total_len, &options)
            .unwrap()
            .checksum_count,
        u64::try_from(small_checksums).unwrap()
    );
    assert_eq!(
        parse_header(&large, large_total_len, &options)
            .unwrap()
            .checksum_count,
        u64::try_from(large_checksums).unwrap()
    );
}

#[test]
fn eager_open_reads_the_same_fixed_bytes_for_small_and_large_indexes() {
    let options = KeyIndexOptions::new().with_chunk_bytes(MIN_CHUNK_BYTES);
    for text_chunks in [1, 65_536] {
        let (header, total_len, _) = parseable_header(text_chunks);
        let mut file = tempfile::tempfile().unwrap();
        file.set_len(total_len).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file.write_all(&header).unwrap();
        file.flush().unwrap();
        let source = IndexSource::new(file).unwrap();
        let memory = Arc::new(MemoryBudget::new(HEADER_BYTES * 2));
        read_index_header(&source, &memory, &options, ChecksumPolicy::Verify).unwrap();
        assert_eq!(
            source.read_counts(),
            (
                2,
                u64::try_from(HEADER_PREFIX_BYTES + HEADER_BYTES).unwrap()
            )
        );
    }
}

#[test]
fn streaming_checksums_match_one_shot_adler_across_write_boundaries() {
    let bytes = (0..20_000)
        .map(|index| u8::try_from(index % 251).unwrap())
        .collect::<Vec<_>>();
    let mut writer = SectionScratchWriter::new(
        tempfile::tempfile().unwrap(),
        257,
        4096,
        ChecksumPolicy::Verify,
    )
    .unwrap();
    for part in bytes.chunks(333) {
        writer.write_all(part).unwrap();
    }
    let section = writer.into_section(SectionKind::Text).unwrap();
    let expected = bytes.chunks(4096).map(adler32).collect::<Vec<_>>();
    assert_eq!(section.checksums, expected);
}

#[test]
fn shared_sort_arena_grows_amortized_and_accounts_retained_capacity() {
    const ROWS: usize = 10_000;
    const KEY_BYTES: usize = 16;
    const LIMIT: usize = 1024 * 1024;
    let mut buffer = SortBuffer::default();
    let mut capacity_changes = 0usize;
    for ordinal in 0..ROWS {
        let before = (buffer.normalized.capacity(), buffer.records.capacity());
        buffer.reserve_record(KEY_BYTES, LIMIT).unwrap();
        let start = buffer.normalized.len();
        buffer.normalized.extend_from_slice(&[b'!'; KEY_BYTES]);
        buffer.records.push(ArenaRecord {
            start,
            len: 0,
            ordinal: u32::try_from(ordinal).unwrap(),
        });
        let after = (buffer.normalized.capacity(), buffer.records.capacity());
        capacity_changes += usize::from(before != after);
        assert!(buffer.allocated_bytes().unwrap() <= LIMIT);
    }
    assert!(
        capacity_changes < 64,
        "capacity changed {capacity_changes} times"
    );
    assert!(capacity_changes < ROWS / 100);
}

#[test]
fn merge_runs_handles_more_than_the_maximum_fan_in() {
    let directory = tempfile::tempdir().unwrap();
    let options = KeyIndexOptions::new()
        .with_build_memory_bytes(64 * 1024)
        .with_scratch_directory(directory.path());
    let run_count = MAX_MERGE_FAN_IN + 1;
    let mut runs = scratch_file(&options, Some(directory.path())).unwrap();
    let mut maximum_record_bytes = 0usize;
    for ordinal in 0..run_count {
        let normalized = format!("key-{:03}", run_count - ordinal - 1);
        maximum_record_bytes = maximum_record_bytes.max(
            normalized
                .len()
                .checked_add(size_of::<RunRecord>() + 12)
                .unwrap(),
        );
        let mut records = SortBuffer {
            normalized: normalized.into_bytes(),
            records: vec![ArenaRecord {
                start: 0,
                len: 7,
                ordinal: u32::try_from(ordinal).unwrap(),
            }],
        };
        write_sorted_run(&mut runs, &mut records).unwrap();
    }
    runs.flush().unwrap();

    let mut cancelled = || false;
    let mut order = merge_runs(
        runs,
        u64::try_from(run_count).unwrap(),
        u64::try_from(run_count).unwrap(),
        maximum_record_bytes,
        &options,
        Some(directory.path()),
        &mut cancelled,
    )
    .unwrap();
    order.file.seek(SeekFrom::Start(0)).unwrap();
    let actual = (0..run_count)
        .map(|_| read_u32_file(&mut order.file).unwrap())
        .collect::<Vec<_>>();
    let expected = (0..run_count)
        .rev()
        .map(|ordinal| u32::try_from(ordinal).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    assert_eq!(
        order.file.stream_position().unwrap(),
        order.file.metadata().unwrap().len()
    );
}
